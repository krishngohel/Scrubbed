const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GET /outlines — returns all of the user's saved secondary outlines
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

// POST /outlines/generate — generates and saves an outline (pro only)
router.post('/generate', async (req, res) => {
  const { school_slug, prompt_id } = req.body;
  if (!school_slug || !prompt_id) {
    return res.status(400).json({ error: 'school_slug and prompt_id are required.' });
  }

  // Pro gate
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_status')
    .eq('id', req.user.id)
    .single();
  if (profile?.subscription_status !== 'pro') {
    return res.status(403).json({ error: 'Secondary AI requires a Pro subscription.' });
  }

  // Get school + prompt
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('name, short_name, mission_snippet, prompts')
    .eq('slug', school_slug)
    .single();
  if (schoolErr || !school) return res.status(404).json({ error: 'School not found.' });

  const prompt = school.prompts?.find(p => p.prompt_id === prompt_id);
  if (!prompt) return res.status(404).json({ error: 'Prompt not found.' });

  // Get all user vault files (excluding previous outlines to avoid circular context)
  const { data: files, error: filesErr } = await supabase
    .from('files')
    .select('name, type, template_id, content, meta')
    .eq('user_id', req.user.id)
    .neq('template_id', 'secondary-outline');
  if (filesErr) return res.status(500).json({ error: filesErr.message });

  const vaultContext = buildVaultContext(files);

  // Generate outline with Claude
  let outlineText;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are an expert pre-medical application advisor helping a student prepare secondary essays.

STUDENT'S APPLICATION RECORD:
${vaultContext || 'No vault documents uploaded yet.'}

SCHOOL: ${school.name}
SCHOOL MISSION: ${school.mission_snippet}
PROMPT: "${prompt.prompt_text}"
WORD LIMIT: ${prompt.word_limit ?? 'not specified'}

Write a detailed secondary essay OUTLINE (not the full essay) that:
- Opens with a specific hook drawn from one experience in their record
- Selects the 2–3 most relevant experiences from their record for this prompt
- Ties those experiences to this school's specific mission
- Gives concrete talking points for each paragraph
- Closes with a forward-looking sentence about their goals

Format with clear section headers (Hook, Body P1, Body P2, Body P3, Conclusion), bullet points under each, and specific references to their record by name. Be concrete, not generic.`,
      }],
    });
    outlineText = msg.content[0].text;
  } catch (err) {
    console.error('Outline generation error:', err);
    return res.status(500).json({ error: 'AI generation failed. Please try again.' });
  }

  // Build tile name: "[Short Name] – [first ~6 words of prompt]… Outline"
  const promptWords = prompt.prompt_text.split(/\s+/).slice(0, 6).join(' ');
  const tileName = `${school.short_name} – ${promptWords}${prompt.prompt_text.split(/\s+/).length > 6 ? '…' : ''} Outline`;

  // Save as a vault file
  const { data: saved, error: saveErr } = await supabase
    .from('files')
    .insert({
      user_id: req.user.id,
      name: tileName,
      type: 'document',
      template_id: 'secondary-outline',
      content: { outline: outlineText },
      meta: {
        school_slug,
        school_name: school.name,
        short_name: school.short_name,
        prompt_text: prompt.prompt_text,
        word_limit: prompt.word_limit,
        prompt_id,
      },
    })
    .select('id, name, type, template_id, content, meta, created_at, updated_at')
    .single();

  if (saveErr) return res.status(500).json({ error: saveErr.message });
  res.status(201).json(saved);
});

function buildVaultContext(files) {
  if (!files || files.length === 0) return '';

  // Priority order for context building
  const priority = ['personal-statement', 'activity-description', 'clinical-hours', 'research-log', 'volunteer-hours', 'shadowing-log', 'work-record'];
  const sorted = [...files].sort((a, b) => {
    const ai = priority.indexOf(a.template_id ?? '');
    const bi = priority.indexOf(b.template_id ?? '');
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const sections = [];
  let totalChars = 0;
  const CHAR_LIMIT = 18000; // ~4,500 tokens, leaves room for the rest of the prompt

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

  // Meta fields
  for (const [k, v] of Object.entries(meta)) {
    if (v && typeof v === 'string') lines.push(`${k}: ${v}`);
  }

  // Content — handle both spreadsheet rows and document sections
  if (content.rows && Array.isArray(content.rows)) {
    for (const row of content.rows.slice(0, 20)) {
      const vals = Object.values(row).filter(Boolean).join(' | ');
      if (vals) lines.push(vals);
    }
  } else if (content.sections && Array.isArray(content.sections)) {
    for (const sec of content.sections) {
      if (sec.title) lines.push(`[${sec.title}]`);
      if (sec.text) lines.push(sec.text.slice(0, 600));
    }
  } else {
    // Flat content object
    for (const [k, v] of Object.entries(content)) {
      if (v && typeof v === 'string' && v.trim()) lines.push(`${k}: ${v.slice(0, 400)}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

module.exports = router;
