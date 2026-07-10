'use strict';
const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { AMCAS_CYCLE, AMCAS_SOURCE_URL, AMCAS_LIMITS, checkLimit } = require('../lib/amcas-limits');

const router = express.Router();

// AMCAS limits — public config (no auth)
router.get('/amcas-limits', (_req, res) => {
  res.json({ cycle: AMCAS_CYCLE, source_url: AMCAS_SOURCE_URL, limits: AMCAS_LIMITS });
});

router.post('/amcas-check', authMiddleware, (req, res) => {
  const { section, text } = req.body;
  if (!section) return res.status(400).json({ error: 'section required' });
  const result = checkLimit(section, text);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Prompt overlap — keyword clustering (no LLM)
const THEME_KEYWORDS = {
  diversity: ['diversity', 'background', 'identity', 'perspective', 'unique', 'underrepresented', 'culture'],
  adversity: ['challenge', 'adversity', 'difficult', 'obstacle', 'failure', 'setback', 'hardship', 'overcome'],
  why_school: ['why our', 'why this', 'interest in', 'at our school', 'at this institution', 'fit with'],
  leadership: ['leadership', 'lead', 'initiative', 'founded', 'president', 'organize'],
  research: ['research', 'laboratory', 'hypothesis', 'publication', 'investigation'],
  service: ['community', 'volunteer', 'service', 'underserved', 'outreach', 'advocacy'],
  clinical: ['clinical', 'patient', 'shadowing', 'physician', 'hospital', 'medicine'],
  why_medicine: ['why medicine', 'why do you want', 'pursue medicine', 'become a physician', 'motivation'],
};

function classifyPrompt(text) {
  const lower = String(text || '').toLowerCase();
  const themes = [];
  for (const [theme, words] of Object.entries(THEME_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) themes.push(theme);
  }
  return themes.length ? themes : ['general'];
}

router.post('/prompt-overlap', authMiddleware, async (req, res) => {
  const { school_slugs } = req.body;
  if (!Array.isArray(school_slugs) || school_slugs.length === 0) {
    return res.status(400).json({ error: 'school_slugs array required' });
  }
  const { data: schools } = await supabase
    .from('schools')
    .select('slug, name, short_name, prompts')
    .in('slug', school_slugs);
  const items = [];
  for (const school of schools || []) {
    for (const p of school.prompts || []) {
      const themes = classifyPrompt(p.prompt_text);
      items.push({
        school_slug: school.slug,
        school_name: school.short_name || school.name,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        themes,
        primary_theme: themes[0],
      });
    }
  }
  const clusters = {};
  for (const item of items) {
    const key = item.primary_theme;
    if (!clusters[key]) clusters[key] = { theme: key, prompts: [], schools: new Set() };
    clusters[key].prompts.push(item);
    clusters[key].schools.add(item.school_name);
  }
  const result = Object.values(clusters).map((c) => ({
    theme: c.theme,
    count: c.prompts.length,
    schools: [...c.schools],
    base_prompt: c.prompts[0],
    prompts: c.prompts,
    reuse_tip: c.count > 1
      ? `Adapt one outline across ${c.count} prompts tagged "${c.theme}" — cite the same vault entries, adjust school connection points.`
      : null,
  }));
  res.json({ clusters: result.sort((a, b) => b.count - a.count) });
});

module.exports = router;
