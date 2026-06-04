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
  monthly:  { outlines_per_month: 30,  regen_per_prompt: 3, max_tokens: 1500 },
  annual:   { outlines_per_month: 80,  regen_per_prompt: 5, max_tokens: 2000 },
  cycle:    { outlines_per_month: 15,  regen_per_prompt: 2, max_tokens: 1200 },
  _default: { outlines_per_month: 30,  regen_per_prompt: 3, max_tokens: 1500 },
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
  const systemPrompt = `You are an expert pre-medical application advisor helping a student write secondary essay outlines. Be specific, concrete, and reference the student's actual experiences from their record by name. Never write generic advice — every bullet point should cite something from their record.`;

  const wordLimitNote = prompt.word_limit ? `Word limit: ${prompt.word_limit} words` : 'No word limit specified';

  const schoolBlock = `SCHOOL: ${school.name}
MISSION: ${school.mission_snippet || '(not provided)'}
PROMPT: "${prompt.prompt_text}"
${wordLimitNote}

Write a detailed secondary essay OUTLINE (not the full essay) with these sections:
- Hook: One specific opening moment drawn from their record (name it explicitly)
- Body P1–P3: The 2–3 most relevant experiences from their record, each tied to this school's mission with 3–4 concrete talking points
- Conclusion: A forward-looking sentence connecting their goals to this specific school

Format: use bold headers (Hook, Body P1, Body P2, Body P3, Conclusion), bullet points under each. Reference vault items by name throughout.`;

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
            text: `STUDENT'S APPLICATION RECORD:\n${vaultContext || 'No vault documents uploaded yet. Write a general outline framework with placeholder brackets like [specific experience] that the student should fill in.'}`,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: schoolBlock,
          },
        ],
      }],
    });
    return msg.content[0].text;
  } catch (err) {
    console.error('Outline generation error:', err);
    return new Error('AI generation failed. Please try again.');
  }
}

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
  const CHAR_LIMIT = 16000; // ~4k tokens, leaves room for school + prompt

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
  const lines = [`=== ${file.name.toUpperCase()} (${file.template_id || file.type}) ===`];

  for (const [k, v] of Object.entries(meta)) {
    if (v && typeof v === 'string') lines.push(`${k}: ${v}`);
  }

  if (content.rows && Array.isArray(content.rows)) {
    for (const row of content.rows.slice(0, 20)) {
      const vals = Object.values(row).filter(Boolean).join(' | ');
      if (vals) lines.push(vals);
    }
  } else if (content.sections && Array.isArray(content.sections)) {
    for (const sec of content.sections) {
      if (sec.label) lines.push(`[${sec.label}]`);
      if (sec.content) lines.push(String(sec.content).slice(0, 600));
    }
  } else {
    for (const [k, v] of Object.entries(content)) {
      if (v && typeof v === 'string' && v.trim()) lines.push(`${k}: ${v.slice(0, 400)}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

module.exports = router;
