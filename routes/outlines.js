'use strict';
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { assessVaultReadiness } = require('../lib/vault-readiness');
const { getPlanLimits, isPaidSubscriber } = require('../lib/plan-limits');
const {
  loadProfile,
  checkGenerationAllowed,
  incrementGeneration,
  getUsage,
  sleep,
  STARTER_FREE_REGENS,
} = require('../lib/generation-caps');

const router = express.Router();
router.use(authMiddleware);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
});

// In-memory vault context cache: userId -> { context, buildAt }
const _vaultCache = new Map();
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchVaultFiles(userId) {
  const { data } = await supabase
    .from('files')
    .select('name, type, template_id, content, meta')
    .eq('user_id', userId)
    .neq('template_id', 'secondary-outline');
  return data || [];
}

async function ensureVaultReady(userId, res) {
  const files = await fetchVaultFiles(userId);
  const readiness = assessVaultReadiness(files);
  if (!readiness.ready) {
    res.status(403).json({
      error: 'Your Vault needs more content before generating outlines. Add experience logs and activities first.',
      limit_type: 'vault_insufficient',
      missing: readiness.missing,
      readiness,
    });
    return null;
  }
  return readiness;
}

// GET /outlines/usage — generation meter for UI
router.get('/usage', async (req, res) => {
  const usage = await getUsage(req.user.id);
  if (!usage) return res.status(404).json({ error: 'Profile not found.' });
  res.json(usage);
});

// GET /outlines
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('files')
    .select('id, name, type, template_id, content, meta, created_at, updated_at')
    .eq('user_id', req.user.id)
    .eq('template_id', 'secondary-outline')
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /outlines/generate
router.post('/generate', async (req, res) => {
  const { school_slug, prompt_id, custom_school, custom_prompt } = req.body;
  const isCustom = !!(custom_school && custom_prompt);
  if (!isCustom && (!school_slug || !prompt_id)) {
    return res.status(400).json({ error: 'Provide school_slug + prompt_id, or custom_school + custom_prompt.' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_status, plan_type, generations_this_period, generation_period_start, cycle_started_at, cycle_expires_at, generation_throttle_count, renews_at')
    .eq('id', req.user.id)
    .single();
  if (!isPaidSubscriber(profile)) {
    return res.status(403).json({ error: 'Secondary AI requires a paid subscription.' });
  }

  const limits = getPlanLimits(profile?.plan_type);
  const fullProfile = await loadProfile(req.user.id) || profile;
  const gate = await checkGenerationAllowed(req.user.id, fullProfile, { generationType: 'secondary-outline' });
  if (!gate.ok) return res.status(gate.status).json(gate.body);
  if (gate.delayMs) await sleep(gate.delayMs);

  if (!(await ensureVaultReady(req.user.id, res))) return;

  let school, prompt;
  if (isCustom) {
    school = {
      name: custom_school.name,
      short_name: custom_school.short_name || custom_school.name,
      mission_snippet: custom_school.mission_snippet || '',
    };
    prompt = {
      prompt_text: custom_prompt.prompt_text,
      word_limit: custom_prompt.word_limit ?? null,
    };
  } else {
    const { data: dbSchool, error: schoolErr } = await supabase
      .from('schools')
      .select('name, short_name, mission_snippet, prompts')
      .eq('slug', school_slug)
      .single();
    if (schoolErr || !dbSchool) return res.status(404).json({ error: 'School not found.' });
    const dbPrompt = dbSchool.prompts?.find(p => p.prompt_id === prompt_id);
    if (!dbPrompt) return res.status(404).json({ error: 'Prompt not found.' });
    school = dbSchool;
    prompt = dbPrompt;
  }

  const vaultContext = await getCachedVaultContext(req.user.id);
  let outlineText = await generateOutlineText(vaultContext, school, prompt, limits.max_tokens, {
    priority: gate.priority,
    throttled: gate.throttled,
  });
  if (outlineText instanceof Error) {
    return res.status(500).json({ error: outlineText.message });
  }
  outlineText = await leakCheckOutline(outlineText);

  const promptWords = prompt.prompt_text.split(/\s+/).slice(0, 6).join(' ');
  const tileName = `${school.short_name} – ${promptWords}${prompt.prompt_text.split(/\s+/).length > 6 ? '…' : ''} Outline`;

  const { data: saved, error: saveErr } = await supabase
    .from('files')
    .insert({
      user_id: req.user.id,
      name: tileName,
      type: 'document',
      template_id: 'secondary-outline',
      content: { outline: outlineText },
      meta: {
        school_slug: school_slug || null,
        school_name: school.name,
        short_name: school.short_name,
        prompt_text: prompt.prompt_text,
        word_limit: prompt.word_limit,
        prompt_id: prompt_id || null,
        regen_count: 0,
        regen_limit: limits.regen_per_prompt ?? STARTER_FREE_REGENS,
      },
    })
    .select('id, name, type, template_id, content, meta, created_at, updated_at')
    .single();

  if (saveErr) return res.status(500).json({ error: saveErr.message });
  await incrementGeneration(req.user.id, gate.profile, {
    consumesSlot: true,
    generationType: 'secondary-outline',
    priority: gate.priority,
    throttled: gate.throttled,
  });
  res.status(201).json(saved);
});

// POST /outlines/:id/regenerate
router.post('/:id/regenerate', async (req, res) => {
  const { data: file, error: fetchErr } = await supabase
    .from('files')
    .select('id, name, meta, template_id')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .eq('template_id', 'secondary-outline')
    .single();
  if (fetchErr || !file) return res.status(404).json({ error: 'Outline not found.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_status, plan_type, generations_this_period, generation_period_start, cycle_started_at, cycle_expires_at, generation_throttle_count, renews_at')
    .eq('id', req.user.id)
    .single();
  if (!isPaidSubscriber(profile)) {
    return res.status(403).json({ error: 'Secondary AI requires a paid subscription.' });
  }

  const limits = getPlanLimits(profile?.plan_type);
  const meta = file.meta || {};
  const regenCount = meta.regen_count ?? 0;
  const isStarter = profile.plan_type === 'starter';
  const regenLimit = meta.regen_limit ?? limits.regen_per_prompt ?? STARTER_FREE_REGENS;

  if (!isStarter && limits.regen_per_prompt != null && regenCount >= regenLimit) {
    return res.status(429).json({
      error: `Regeneration limit reached (${regenLimit} per outline on your plan).`,
      limit_type: 'regen',
      regen_count: regenCount,
      regen_limit: regenLimit,
    });
  }

  const fullProfile = await loadProfile(req.user.id) || profile;
  const gate = await checkGenerationAllowed(req.user.id, fullProfile, {
    isRegen: true,
    regenCount,
    generationType: 'secondary-outline',
  });
  if (!gate.ok) return res.status(gate.status).json(gate.body);
  if (gate.delayMs) await sleep(gate.delayMs);

  if (!(await ensureVaultReady(req.user.id, res))) return;

  // Re-fetch school + prompt from DB or fall back to stored meta
  let school, prompt;
  if (meta.school_slug) {
    const { data: dbSchool } = await supabase
      .from('schools')
      .select('name, short_name, mission_snippet, prompts')
      .eq('slug', meta.school_slug)
      .single();
    if (dbSchool) {
      school = dbSchool;
      prompt = dbSchool.prompts?.find(p => p.prompt_id === meta.prompt_id) || {
        prompt_text: meta.prompt_text,
        word_limit: meta.word_limit,
      };
    }
  }
  if (!school) {
    school = {
      name: meta.school_name || 'School',
      short_name: meta.short_name || meta.school_name || 'School',
      mission_snippet: '',
    };
    prompt = { prompt_text: meta.prompt_text, word_limit: meta.word_limit };
  }

  const vaultContext = await getCachedVaultContext(req.user.id);
  let outlineText = await generateOutlineText(vaultContext, school, prompt, limits.max_tokens, {
    priority: gate.priority,
    throttled: gate.throttled,
  });
  if (outlineText instanceof Error) {
    return res.status(500).json({ error: outlineText.message });
  }
  outlineText = await leakCheckOutline(outlineText);

  const { data: updated, error: updateErr } = await supabase
    .from('files')
    .update({
      content: { outline: outlineText },
      meta: { ...meta, regen_count: regenCount + 1, regen_limit: regenLimit },
    })
    .eq('id', req.params.id)
    .select('id, name, type, template_id, content, meta, created_at, updated_at')
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });
  if (gate.consumesSlot) {
    await incrementGeneration(req.user.id, gate.profile, {
      consumesSlot: true,
      generationType: 'secondary-outline-regen',
      priority: gate.priority,
      throttled: gate.throttled,
    });
  }
  res.json(updated);
});

// DELETE /outlines/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('files')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .eq('template_id', 'secondary-outline');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getCachedVaultContext(userId) {
  const cached = _vaultCache.get(userId);
  if (cached && Date.now() - cached.buildAt < VAULT_CACHE_TTL_MS) {
    return cached.context;
  }
  const { data: files } = await supabase
    .from('files')
    .select('name, type, template_id, content, meta')
    .eq('user_id', userId)
    .neq('template_id', 'secondary-outline');
  const context = buildVaultContext(files || []);
  _vaultCache.set(userId, { context, buildAt: Date.now() });
  return context;
}

async function generateOutlineText(vaultContext, school, prompt, maxTokens, opts = {}) {
  const hasVault = vaultContext && vaultContext.trim().length > 0;

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'mock') {
    return `**Your strongest material for this prompt**
- Clinical Hour Log — cite setting/date only; fits patient-facing themes in this prompt
- Volunteer Hour Log — cite setting/date only; fits community/advocacy angle

**Angles to develop**
- Which specific shift or patient interaction from Clinical Hour Log should anchor the opening scene?
- What systemic gap did you observe in Volunteer Hour Log — name the setting, not the takeaway?
- How does ${school.short_name || school.name}'s mission connect to one named program (reference by name only)?
- No vault entry for research — add Research Log to your Vault if this prompt asks about scholarly work

**School connection points**
- ${school.name}${school.mission_snippet ? ` — mission focus: ${school.mission_snippet}` : ''}
- Name one concrete program, clinic, or curriculum feature at ${school.short_name || school.name} worth referencing

**What to avoid**
- Restating the school's mission back at them instead of showing fit through your own vault material
- Drafting sentences you could paste into the essay — bullets are planning prompts only

---
*[MOCK OUTLINE — set ANTHROPIC_API_KEY in Netlify to generate real outlines]*`;
  }

  const systemPrompt = `OUTPUT FORMAT — use these exact bold section headers:

**Your strongest material for this prompt**
2–4 bullets. Each cites one vault entry by exact name with one-line factual fit (setting/date only).

**Angles to develop**
4–8 short bullets: questions and directives tied to named vault entries only.

**School connection points**
2–4 factual pointers to ${school.short_name || school.name}'s mission, programs, or priorities — no drafted sentences.

**What to avoid**
1–2 pattern-level notes (common mistakes on this prompt type).`;

  const wordLimitNote = prompt.word_limit
    ? `WORD LIMIT: ${prompt.word_limit} words — scale number of angles accordingly (fewer bullets if under 300 words).`
    : 'WORD LIMIT: Not specified — default to 4–6 angles.';

  const schoolBlock = `SCHOOL: ${school.name}
MISSION: ${school.mission_snippet || '(not provided — use school name and known priorities only)'}
SECONDARY PROMPT: "${prompt.prompt_text}"
${wordLimitNote}

Classify the prompt type (why school, diversity, challenge, research, service, clinical, why medicine) to decide which vault entries to prioritize.

The student's Vault is in the message above. Select only entries that exist. For themes with no matching entry, use the "No vault entry for [theme]" format.

${systemPrompt}

Write the scaffold using the four section headers. Directives and questions only — zero pasteable prose.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: `You are a medical school admissions advisor helping an applicant PLAN their own secondary essay. You produce a personalized scaffold built exclusively from their Vault — never essay content. AMCAS/CASPA/TMDSAS certification requires the essay to be entirely the applicant's own words.

ABSOLUTE RULES:
1. NEVER WRITE ESSAY PROSE. No complete or near-complete sentences usable in a final essay. Every bullet is a directive, question, or factual pointer — max ~40 words per bullet.
2. NEVER SUPPLY INSIGHTS OR CONCLUSIONS. Identify WHERE material belongs; the applicant supplies meaning.
3. NO FIRST-PERSON APPLICANT VOICE. Never write "I realized...", "I want...", "I am drawn to...".
4. VAULT-ONLY CITATIONS. Reference entries by exact name, setting, and date. Never retell what happened or invent experiences.
5. IF NO VAULT ENTRY MATCHES A THEME, write: "No vault entry for [theme] — add [type] to your Vault." Never fabricate.
6. SCHOOL POINTERS ARE FACTUAL ONLY. Name programs, missions, or features — never draft connection sentences.`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `STUDENT'S VAULT:\n\n${vaultContext}`,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: schoolBlock,
          },
        ],
      }],
    });
    const text = msg.content?.[0]?.text;
    if (!text) return new Error('AI generation returned no content. Please try again.');
    return text;
  } catch (err) {
    console.error('Outline generation error:', err);
    return new Error('AI generation failed. Please try again.');
  }
}

// ── QA leak-check pass ───────────────────────────────────────────────────────
// Flags lines that read as draftable essay content: first-person essay phrasing,
// narrated vault content, or prose pasteable into a final essay.

const LEAK_PATTERNS = [
  /\bI (realized|realize|learned|felt|feel|knew|know|saw|understood|understand|discovered|found|wanted|want|am drawn|was drawn|hope|believe|aspire|will|chose|decided|experienced|became|grew)\b/i,
  /\bI['’]m\s/i,
  /\bI['’]ve\s/i,
  /\bmy (journey|passion|calling|desire|commitment|goal|dream) (to|for|is|was)\b/i,
  /\btaught me that\b/i,
  /\bshowed me that\b/i,
  /\bmade me realize\b/i,
  /\bthis experience (taught|showed|demonstrated|revealed)\b/i,
  /\bas a (future|aspiring) (physician|doctor|medical student)\b/i,
  /\b(through|from) this experience,?\s/i,
  /\bwhat I learned\b/i,
  /\bI have always\b/i,
  /\bI am (committed|dedicated|passionate)\b/i,
  /\b(?:^|\s)(?:For|Through|During) (?:this|my) (?:experience|time|work)\b/i,
];

function findLeaks(outlineText) {
  const leaks = [];
  for (const rawLine of outlineText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*[') || line.startsWith('**')) continue;
    const isBullet = line.startsWith('-') || line.startsWith('•');
    if (!isBullet) continue;
    const bulletText = line.replace(/^[-•]\s*/, '');
    // Questions directed at applicant are usually OK
    if (bulletText.endsWith('?') && !/\bI (realized|learned|felt|want)\b/i.test(bulletText)) continue;
    if (LEAK_PATTERNS.some(p => p.test(bulletText))) {
      leaks.push(rawLine);
    }
    // Flag declarative prose: complete sentence without ? that looks essay-like
    if (!bulletText.endsWith('?') && bulletText.length > 60 && /\b(is|was|are|were|has|have|had)\b/.test(bulletText) && !/^No vault entry/i.test(bulletText)) {
      leaks.push(rawLine);
    }
  }
  return [...new Set(leaks)];
}

// If leaks are found, one cheap repair call rewrites flagged lines into
// directives/questions. If repair fails or still leaks, flagged lines are stripped.
async function leakCheckOutline(outlineText) {
  let leaks = findLeaks(outlineText);
  if (leaks.length === 0) return outlineText;
  console.warn(`Leak-check: ${leaks.length} flagged line(s)`);

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'mock') {
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'You fix essay-outline frameworks that must contain zero draftable essay content. Rewrite ONLY the flagged lines so each becomes a directive or question addressed to the applicant — no first-person applicant voice, no supplied insights or conclusions, no narrated experiences. Preserve which vault entry / topic each line points at. Return the FULL corrected outline verbatim except for the flagged lines. Output only the outline text.',
        messages: [{
          role: 'user',
          content: `OUTLINE:\n${outlineText}\n\nFLAGGED LINES:\n${leaks.join('\n')}`,
        }],
      });
      const repaired = msg.content?.[0]?.text;
      if (repaired && findLeaks(repaired).length === 0) return repaired;
    } catch (err) {
      console.error('Leak-check repair failed:', err);
    }
  }

  // Fallback: strip flagged lines outright — safe beats complete.
  leaks = new Set(findLeaks(outlineText));
  return outlineText.split('\n').filter(l => !leaks.has(l)).join('\n');
}

// Human-readable labels for template IDs so Claude understands what each file is
const TEMPLATE_LABELS = {
  'personal-statement':  'Personal Statement',
  'activity-description':'Activity Description',
  'clinical-hours':      'Clinical Hours Log',
  'research-log':        'Research Log',
  'volunteer-hours':     'Volunteer Hours Log',
  'shadowing-log':       'Shadowing Log',
  'employment-record':   'Employment Record',
};

function buildVaultContext(files) {
  if (!files || files.length === 0) return '';

  const priority = [
    'personal-statement', 'activity-description', 'clinical-hours',
    'research-log', 'volunteer-hours', 'shadowing-log', 'employment-record',
  ];
  const sorted = [...files].sort((a, b) => {
    const ai = priority.indexOf(a.template_id ?? '');
    const bi = priority.indexOf(b.template_id ?? '');
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const sections = [];
  let totalChars = 0;
  const CHAR_LIMIT = 20000; // ~5k tokens for vault context

  for (const file of sorted) {
    if (totalChars >= CHAR_LIMIT) break;
    const section = formatFileForContext(file);
    if (section) {
      sections.push(section);
      totalChars += section.length;
    }
  }

  return sections.join('\n\n');
}

function formatFileForContext(file) {
  const content = file.content || {};
  const meta = file.meta || {};
  const typeLabel = TEMPLATE_LABELS[file.template_id] || file.template_id || file.type || 'Document';
  const lines = [`=== ${file.name.toUpperCase()} [${typeLabel}] ===`];

  // Theme tags (Section 2: manual tag-on-upload, used for prompt-theme matching)
  if (Array.isArray(meta.theme_tags) && meta.theme_tags.length > 0) {
    lines.push(`Theme tags: ${meta.theme_tags.join(', ')}`);
  }
  if (meta.setting) lines.push(`Setting: ${meta.setting}`);
  if (meta.turning_point) lines.push(`Tension/turning point: ${meta.turning_point}`);

  // Meta fields: skip internal/system keys, label them clearly
  const skipMeta = new Set(['regen_count', 'regen_limit', 'prompt_id', 'school_slug', 'short_name', 'theme_tags', 'setting', 'turning_point']);
  for (const [k, v] of Object.entries(meta)) {
    if (skipMeta.has(k)) continue;
    if (v && (typeof v === 'string' || typeof v === 'number')) {
      const label = k.replace(/_/g, ' ');
      lines.push(`${label}: ${v}`);
    }
  }

  if (content.rows && Array.isArray(content.rows)) {
    // Spreadsheet: include column headers so Claude knows what each value means
    const cols = content.cols;
    if (cols && Array.isArray(cols) && cols.length > 0) {
      lines.push(`Columns: ${cols.join(' | ')}`);
    }
    for (const row of content.rows.slice(0, 30)) {
      let vals;
      if (cols && Array.isArray(row)) {
        // row is an array aligned to cols
        vals = row.map((v, i) => (v ? `${cols[i] || i}: ${v}` : '')).filter(Boolean).join(' | ');
      } else if (typeof row === 'object') {
        vals = Object.entries(row)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
          .join(' | ');
      } else {
        vals = String(row);
      }
      if (vals) lines.push(vals);
    }
  } else if (content.sections && Array.isArray(content.sections)) {
    for (const sec of content.sections) {
      if (sec.label) lines.push(`\n[${sec.label}]`);
      if (sec.content) {
        const text = String(sec.content).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) lines.push(text.slice(0, 900));
      }
    }
  } else if (content.outline) {
    // Skip secondary outlines — they are generated output, not source material
    return '';
  } else {
    for (const [k, v] of Object.entries(content)) {
      if (!v || typeof v !== 'string' || !v.trim()) continue;
      const text = v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(`${k.replace(/_/g, ' ')}: ${text.slice(0, 500)}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

module.exports = router;
