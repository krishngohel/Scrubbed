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
  const outlineText = await generateOutlineText(vaultContext, school, prompt, limits.max_tokens);
  if (outlineText instanceof Error) {
    return res.status(500).json({ error: outlineText.message });
  }

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
  const outlineText = await generateOutlineText(vaultContext, school, prompt, limits.max_tokens);
  if (outlineText instanceof Error) {
    return res.status(500).json({ error: outlineText.message });
  }

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
    return `**Hook**
- ${hasVault ? 'Opening with a specific moment drawn from your vault record' : '[Add vault documents to get personalized hooks]'}
- Sets up the central tension: clinical exposure meeting research curiosity

**Body P1 — Clinical Experience**
- ${hasVault ? 'References experiences found in your vault' : '[Upload clinical hours log to populate this section]'}
- Connects directly to ${school.name}'s mission: ${school.mission_snippet || 'community-focused care'}
- Talking point: patient interaction that shifted your perspective
- Talking point: skill developed under supervising physician

**Body P2 — Research / Academic**
- ${hasVault ? 'Draws from research log entries in your vault' : '[Upload research log to populate this section]'}
- Ties methodology experience to evidence-based medicine values
- Talking point: specific finding or moment of discovery
- Talking point: how this shapes your approach as a future physician

**Body P3 — Community / Service**
- ${hasVault ? 'Pulls from volunteer or shadowing records' : '[Upload volunteer hours to populate this section]'}
- Aligns with ${school.name}'s emphasis on underserved populations
- Talking point: relationship built with a specific patient or community member
- Talking point: systemic gap you observed and want to address

**Conclusion**
- Forward-looking: how your background prepares you to contribute to ${school.name}'s mission
- Specific program or faculty interest (add during editing)

---
*[MOCK OUTLINE — set ANTHROPIC_API_KEY in Netlify to generate real outlines]*`;
  }

  const systemPrompt = `You are a medical school admissions consultant who has reviewed thousands of secondary applications and coached applicants into top MD programs. Your specialty is translating raw application data into tightly structured essay outlines that adcoms remember.

You are writing a SECONDARY ESSAY OUTLINE — a writer's blueprint, not the essay itself. A great outline gives the applicant a clear, executable instruction for every sentence they will write. Vague guidance wastes their time. Specific guidance wins interviews.

ABSOLUTE RULES — break any of these and the outline is worthless:
1. ZERO placeholder brackets. Never write [insert X], [describe Y], [add experience], or any variation. Every bullet is a complete, specific instruction the writer can act on immediately.
2. VAULT DATA IS GOLD: If the student record contains any named experience, organization, supervisor, patient population, research finding, date, or outcome — use it by name in the outline. "Your 180 hours at St. David's ER" beats "your clinical experience" every time.
3. NO VAULT = VIVID SPECIFICITY ANYWAY: If no record exists, describe the type of moment so concretely the writer immediately knows what memory to reach for. "The moment a patient thanked you by name" beats "a meaningful patient interaction."
4. MISSION LOCK: Every body section must name ${school.short_name || 'this school'} and connect the experience to their specific stated mission — not to medicine in general.
5. TALKING POINTS ARE VERB-LED INSTRUCTIONS: Start every bullet with an action verb — "Describe...", "Name...", "Explain...", "Connect...", "Contrast...", "Quote..." — followed by what to say and why it matters here.
6. SCALE TO WORD LIMIT: <300 words → 2 tight body sections, 4 bullets each. 300–500 words → 3 sections, 4 bullets each. 500+ words → 3 sections, 5 bullets each with richer connection points.
7. CLOSE SPECIFICALLY: The conclusion must name ${school.short_name || 'this school'} and reference something concrete — a program, a curriculum feature, a faculty research area, a clinical partner — not just "your mission."`;

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

━━━ STEP 2: SELECT THE BEST MATERIAL ━━━
${hasVault
  ? `The student's full application record is in the message above. Scan it now and identify:
- The SINGLE strongest hook moment (a specific scene with sensory detail, not a summary)
- The 2–3 experiences most directly relevant to this prompt type and this school's mission
- Any metric, name, organization, or outcome that can replace a generic description
Use only what is in the record. Do not invent details.`
  : `No vault documents have been uploaded. Write the outline using vivid, specific language that tells the applicant exactly what TYPE of memory to use — specific enough that they immediately know which experience fits, without using bracket placeholders.`}

━━━ STEP 3: WRITE THE OUTLINE ━━━
Use these exact bold headers. Under each, write 4–5 complete-sentence bullet points that tell the writer what to open with, what to say, what detail to name, and why it lands for ${school.name}.

**Hook — [name the scene or moment type]**
One specific, present-tense or past-tense scene. Sensory, grounded, not reflective. The reader should be able to picture it. Name the place, person, or moment.

**Body P1 — [name the experience or theme]**
The most directly relevant experience for this prompt. Tie it to ${school.name}'s mission by name. 4–5 verb-led bullets.

**Body P2 — [name the experience or theme]**
Second strongest thread — shows a different dimension. 4–5 verb-led bullets.

**Body P3 — [name the experience or theme, or label "Bridge / Synthesis" if tying P1 and P2 together]**
Include only if word limit supports it. Can be a third experience or a thematic synthesis. 4–5 verb-led bullets.

**Closing — [forward-looking, school-specific]**
2–3 sentences in the final essay. Name ${school.name} and something concrete about their program. No "I hope to" or "I believe" openings.

━━━ STEP 4: WRITING NOTES ━━━
After the outline, add this section with 2–4 bullets:

**Writing Notes**
Strategic callouts only: why this hook is the right one, what the most common mistake is on this prompt type, any school-specific nuance (curriculum feature, patient population, research focus) worth weaving in, what to cut first if over the word limit.`;

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
              : `STUDENT'S APPLICATION RECORD: No documents uploaded yet.\n\nWrite the outline using vivid, specific language — concrete enough that the applicant immediately knows which memory to use, but without bracket placeholders.`,
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

  // Meta fields: skip internal/system keys, label them clearly
  const skipMeta = new Set(['regen_count', 'regen_limit', 'prompt_id', 'school_slug', 'short_name']);
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
