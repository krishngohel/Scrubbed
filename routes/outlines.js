'use strict';
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
});

// Per-plan limits — outlines_per_month: null = unlimited
const PLAN_LIMITS = {
  monthly:  { outlines_per_month: 30,  regen_per_prompt: 3, max_tokens: 2000 },
  annual:   { outlines_per_month: 80,  regen_per_prompt: 5, max_tokens: 2400 },
  cycle:    { outlines_per_month: 15,  regen_per_prompt: 2, max_tokens: 1800 },
  _default: { outlines_per_month: 30,  regen_per_prompt: 3, max_tokens: 2000 },
};

// In-memory vault context cache: userId -> { context, buildAt }
const _vaultCache = new Map();
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000;

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
    .select('subscription_status, plan_type')
    .eq('id', req.user.id)
    .single();
  if (profile?.subscription_status !== 'pro') {
    return res.status(403).json({ error: 'Secondary AI requires a Pro subscription.' });
  }

  const limits = PLAN_LIMITS[profile?.plan_type] || PLAN_LIMITS._default;

  // Monthly outline count check
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('files')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('template_id', 'secondary-outline')
    .gte('created_at', monthStart.toISOString());
  if (count >= limits.outlines_per_month) {
    return res.status(429).json({
      error: `You've reached your ${limits.outlines_per_month} outline limit for this month. Upgrade to Annual for more outlines.`,
      limit_type: 'monthly_outlines',
      limit: limits.outlines_per_month,
    });
  }

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
  let outlineText = await generateOutlineText(vaultContext, school, prompt, limits.max_tokens);
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
        regen_limit: limits.regen_per_prompt,
      },
    })
    .select('id, name, type, template_id, content, meta, created_at, updated_at')
    .single();

  if (saveErr) return res.status(500).json({ error: saveErr.message });
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
    .select('subscription_status, plan_type')
    .eq('id', req.user.id)
    .single();
  if (profile?.subscription_status !== 'pro') {
    return res.status(403).json({ error: 'Secondary AI requires a Pro subscription.' });
  }

  const limits = PLAN_LIMITS[profile?.plan_type] || PLAN_LIMITS._default;
  const meta = file.meta || {};
  const regenCount = meta.regen_count ?? 0;
  const regenLimit = meta.regen_limit ?? limits.regen_per_prompt;

  if (regenCount >= regenLimit) {
    return res.status(429).json({
      error: `Regeneration limit reached (${regenLimit} per outline on your plan).`,
      limit_type: 'regen',
      regen_count: regenCount,
      regen_limit: regenLimit,
    });
  }

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
  let outlineText = await generateOutlineText(vaultContext, school, prompt, limits.max_tokens);
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

async function generateOutlineText(vaultContext, school, prompt, maxTokens) {
  // Mock mode: set ANTHROPIC_API_KEY=mock in Netlify env vars to test without API calls
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'mock') {
    const hasVault = vaultContext && vaultContext.length > 0;
    return `**Hook — a specific clinical moment**
- ${hasVault ? 'Draw from the strongest scene-level entry in your vault — cite it by name and date when you write.' : 'Add vault documents to get entry-specific pointers here.'}
- What was the setting? Who was there? What made this moment different from a routine shift?

**Body P1 — Clinical Experience**
- ${hasVault ? 'Use your clinical hours entries as source material for this section.' : 'Upload a clinical hours log to get a specific entry pointer here.'}
- Which patient interaction shifted how you think about care? Name the setting, not the takeaway — build the scene around what made it visible.
- Connect this section to ${school.name}'s stated mission${school.mission_snippet ? ` (${school.mission_snippet})` : ''} — reference their priority by name.

**Body P2 — Research / Academic**
- ${hasVault ? 'Use your research log entries as source material.' : 'Upload a research log to get a specific entry pointer here.'}
- What surprised you in the work? What question did it leave you with?

**Body P3 — Community / Service**
- ${hasVault ? 'Use your volunteer or shadowing records as source material.' : 'Upload volunteer hours to get a specific entry pointer here.'}
- What systemic gap did you observe firsthand? What relationship made it concrete?

**Closing — forward-looking, school-specific**
- What do you want your training to make possible? Answer in your own words, then name one concrete ${school.name} program or feature that supports it.

**Writing Notes**
- Common mistake on this prompt type: restating the school's mission back at it instead of showing fit through your own material.

---
*[MOCK OUTLINE — set ANTHROPIC_API_KEY in Netlify to generate real outlines]*`;
  }

  const systemPrompt = `You are a medical school admissions advisor helping an applicant STRUCTURE their own secondary essay. You are producing a planning framework — never essay content. AMCAS/CASPA/TMDSAS certification requires the essay to be entirely the applicant's own words, so nothing you output may be usable in the essay itself.

ABSOLUTE RULES — violating any of these makes the output unusable:
1. NEVER WRITE ESSAY PROSE. No complete or near-complete sentences that could appear in an essay — not as examples, not as "Do:" illustrations, not as fill-in-the-blank templates. Every bullet must be a directive ("Describe the moment when...") or a question ("What changed for you when...?") addressed to the applicant.
2. NEVER SUPPLY INSIGHTS, REALIZATIONS, OR CONCLUSIONS. You identify WHERE an insight belongs in the structure; the applicant supplies the insight. Never state what an experience means, what they learned, or what they realized.
3. NO FIRST-PERSON PHRASING. Never write anything in the applicant's voice ("I realized...", "I want...", "I am drawn to..."). Never prescribe emotional beats as written-out phrasing. Technique guidance is fine ("ground this in a specific moment, not an abstraction").
4. CITE VAULT ENTRIES, NEVER NARRATE THEM. Reference entries by name, setting, and date, and say WHY they fit this prompt. Never retell what happened in the entry or state what it means. "Use your [entry name] experience (date) as source material for this section" — nothing more.
5. NEVER FABRICATE. If no vault entry matches a theme the prompt asks about, say so explicitly and suggest what KIND of memory the applicant should add to their vault. Do not invent a plausible-sounding experience.
6. COMMON-MISTAKE WARNINGS STAY AT PATTERN LEVEL. Describing a failure mode ("applicants often restate the school's mission back at it") is fine. Supplying a fix sentence is not.
7. MISSION LOCK: Every body section must direct the applicant to connect their material to ${school.short_name || 'this school'}'s specific stated priorities — as a factual pointer ("reference [named program] by name here"), never as drafted content.
8. SCALE TO WORD LIMIT: <300 words → 2 body sections. 300–500 words → 3 sections. 500+ words → 3 sections with richer connection points.`;

  const wordLimitNote = prompt.word_limit
    ? `WORD LIMIT: ${prompt.word_limit} words. Scale the outline depth accordingly — this determines how many body sections to write and how many bullets per section.`
    : 'WORD LIMIT: Not specified — default to 3 body sections with 4–5 bullets each.';

  const hasVault = vaultContext && vaultContext.trim().length > 0;

  const schoolBlock = `SCHOOL: ${school.name}
MISSION: ${school.mission_snippet || '(not provided — use the school name and write mission-aligned bullets based on their reputation and location)'}
SECONDARY PROMPT: "${prompt.prompt_text}"
${wordLimitNote}

━━━ STEP 1: CLASSIFY THE PROMPT ━━━
Before writing, identify which type this prompt is, then use that classification to decide which vault experiences to prioritize:

• WHY THIS SCHOOL — mission fit, specific programs, curriculum, dual degree, clinical partners, location
• DIVERSITY / UNIQUE PERSPECTIVE — what background, identity, or experience makes this applicant different
• CHALLENGE / ADVERSITY / GROWTH — a difficulty overcome; what it required and what it built
• RESEARCH / SCHOLARLY INTEREST — academic work, intellectual curiosity, evidence-based medicine
• COMMUNITY SERVICE / ADVOCACY — underserved work, systemic awareness, patient populations
• CLINICAL EXPERIENCE — direct patient care, shadowing, specific observations
• WHY MEDICINE / MOTIVATION — the origin and evolution of the applicant's commitment

━━━ STEP 2: SELECT SOURCE MATERIAL (CITE, NEVER NARRATE) ━━━
${hasVault
  ? `The student's application record is in the message above. Identify the 2–4 entries whose themes best match this prompt's classification. For each selected entry you may reference ONLY: its name, its setting (where/when/who), and one factual reason it fits this prompt and this school's priorities. Do NOT retell what happened in the entry or state what it means — that is the applicant's job.
If a theme this prompt asks about has NO matching entry, state that plainly in the outline and suggest what kind of memory the applicant should add to their vault. Never invent or embellish an experience.`
  : `No vault documents have been uploaded. Describe the TYPE of memory the applicant should reach for in each section — specific enough that they know which experience fits — phrased entirely as directives and questions. No bracket placeholders, no example prose.`}

━━━ STEP 3: WRITE THE FRAMEWORK ━━━
Use these exact bold headers. Under each, write 3–5 bullets. Every bullet is either a directive to the applicant or a question for them to answer — never prose they could paste into the essay.

**Hook — [name the scene type to open with]**
Direct the applicant to a specific moment: which vault entry to draw from (name/setting/date only), and questions that surface the concrete scene ("What was the setting? Who was there? What made this moment different?").

**Body P1 — [name the experience or theme]**
The most relevant material for this prompt. Cite the entry, then questions/directives that surface what the applicant should articulate. Include one factual school pointer ("connect this to ${school.short_name || school.name}'s [named program/priority] — reference it by name").

**Body P2 — [name the experience or theme]**
Second strongest thread — a different dimension. Same rules.

**Body P3 — [third theme, or "Bridge / Synthesis"]**
Include only if word limit supports it.

**Closing — [forward-looking, school-specific]**
Questions that surface the applicant's own forward-looking point, plus a factual pointer to something concrete at ${school.name} worth naming. Do not draft any closing language.

━━━ STEP 4: WRITING NOTES ━━━
After the framework, add 2–4 bullets:

**Writing Notes**
Pattern-level guidance only: why this structure fits this prompt type, the most common mistake applicants make on it (described as a failure mode, never with a fix sentence), school-specific facts worth weaving in, what to cut first if over the word limit.

REMINDER: Output must contain zero sentences usable in the final essay. Directives and questions only.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: hasVault
              ? `STUDENT'S APPLICATION RECORD:\n\n${vaultContext}`
              : `STUDENT'S APPLICATION RECORD: No documents uploaded yet.\n\nWrite the framework using directives and questions only — specific enough that the applicant knows which type of memory to reach for, with no bracket placeholders and no example prose.`,
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
  /\bI (realized|realize|learned|felt|feel|knew|know|saw|understood|understand|discovered|found|wanted|want|am drawn|was drawn|hope|believe|aspire|will|chose|decided)\b/i,
  /\bI['’]m\s/i,
  /\bmy (journey|passion|calling|desire|commitment) (to|for|is)\b/i,
  /\btaught me that\b/i,
  /\bshowed me that\b/i,
  /\bmade me realize\b/i,
];

function findLeaks(outlineText) {
  const leaks = [];
  for (const rawLine of outlineText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*[')) continue;
    // Quoted first-person inside a question directed AT the applicant is still a leak
    // if it reads as pasteable prose — flag any first-person match outside a question.
    if (LEAK_PATTERNS.some(p => p.test(line)) && !line.endsWith('?')) {
      leaks.push(rawLine);
    }
  }
  return leaks;
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
