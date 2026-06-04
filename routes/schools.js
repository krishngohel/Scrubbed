const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NOW = new Date().toISOString();
const SEED_SCHOOLS = [
  {
    name: 'Baylor College of Medicine', short_name: 'Baylor', slug: 'bcm',
    location: 'Houston, TX', is_active: true,
    mission_snippet: 'Improving health for people worldwide through innovation in education, research, and patient care.',
    prompts_url: 'https://www.bcm.edu/education/school-of-medicine/md-program/admissions/secondary-application',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'bcm-1', prompt_text: 'Why do you want to attend Baylor College of Medicine? Be specific about what draws you to our community, curriculum, or mission.', word_limit: 350 },
      { prompt_id: 'bcm-2', prompt_text: 'Describe your most meaningful clinical or patient care experience. What did it reveal to you about medicine or about yourself?', word_limit: 350 },
      { prompt_id: 'bcm-3', prompt_text: 'Tell us about a time you worked in a team to address a complex problem in a healthcare or research setting. What was your role and what did you learn?', word_limit: 300 },
    ],
  },
  {
    name: 'McGovern Medical School at UTHealth Houston', short_name: 'McGovern Medical', slug: 'mcgovern',
    location: 'Houston, TX', is_active: true,
    mission_snippet: 'Training physicians to serve the diverse communities of Texas and beyond.',
    prompts_url: 'https://med.uth.edu/admissions/application-information/secondary-application/',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'mcgovern-1', prompt_text: 'What experiences have shaped your commitment to serving underserved populations? How do you see that commitment manifesting in your career as a physician?', word_limit: 300 },
      { prompt_id: 'mcgovern-2', prompt_text: 'Describe a significant challenge you faced in your path to medicine and explain how you navigated it.', word_limit: 350 },
      { prompt_id: 'mcgovern-3', prompt_text: 'Why McGovern Medical School? Be specific about what draws you to our program and Houston as a training environment.', word_limit: 300 },
    ],
  },
  {
    name: 'Texas A&M College of Medicine', short_name: 'Texas A&M', slug: 'tamu-medicine',
    location: 'Bryan, TX', is_active: true,
    mission_snippet: 'Educating physicians committed to service, integrity, and rural health.',
    prompts_url: 'https://medicine.tamu.edu/admissions/apply/',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'tamu-1', prompt_text: 'Describe an experience that demonstrates your commitment to community or service. How has it influenced your vision of the kind of physician you want to become?', word_limit: 350 },
      { prompt_id: 'tamu-2', prompt_text: 'Why Texas A&M College of Medicine? How does our focus on rural health, primary care, and service align with your goals?', word_limit: 300 },
    ],
  },
  {
    name: 'Texas Tech UHSC — Paul L. Foster School of Medicine', short_name: 'PLFSOM El Paso', slug: 'ttuhsc-elpaso',
    location: 'El Paso, TX', is_active: true,
    mission_snippet: 'Training physicians to serve the U.S.–Mexico border region with excellence and cultural humility.',
    prompts_url: 'https://plfsom.ttuhsc.edu/admissions/',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'ttuhsc-elpaso-1', prompt_text: 'Why the Paul L. Foster School of Medicine? How does our focus on border health and global health align with your career aspirations?', word_limit: 350 },
      { prompt_id: 'ttuhsc-elpaso-2', prompt_text: 'Describe your most significant experience with a culturally or linguistically diverse patient population. What did you learn and how will it shape your practice?', word_limit: 350 },
    ],
  },
  {
    name: 'Texas Tech UHSC — School of Medicine', short_name: 'TTUHSC Lubbock', slug: 'ttuhsc-lubbock',
    location: 'Lubbock, TX', is_active: true,
    mission_snippet: 'Committed to improving the health of people in West Texas through education, research, and compassionate care.',
    prompts_url: 'https://www.ttuhsc.edu/medicine/admissions/',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'ttuhsc-lubbock-1', prompt_text: 'Why do you want to practice medicine in West Texas? How do your background and experiences align with our mission to serve rural and underserved communities?', word_limit: 350 },
      { prompt_id: 'ttuhsc-lubbock-2', prompt_text: 'Describe a moment when you witnessed or experienced health disparity. What did it teach you and how does it inform your goals as a future physician?', word_limit: 350 },
    ],
  },
  {
    name: 'UT Health San Antonio — Long School of Medicine', short_name: 'Long School of Medicine', slug: 'uthscsa',
    location: 'San Antonio, TX', is_active: true,
    mission_snippet: 'Preparing compassionate, culturally competent physicians to serve South Texas and beyond.',
    prompts_url: 'https://lsom.uthscsa.edu/admissions/secondary-application/',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'uthscsa-1', prompt_text: 'How have your experiences with diverse populations prepared you to practice medicine in South Texas? Provide specific examples.', word_limit: 350 },
      { prompt_id: 'uthscsa-2', prompt_text: 'Describe a time when you were part of a healthcare team or community effort. What was your contribution and what did you learn about collaboration in medicine?', word_limit: 300 },
    ],
  },
  {
    name: 'UTMB School of Medicine', short_name: 'UTMB', slug: 'utmb',
    location: 'Galveston, TX', is_active: true,
    mission_snippet: 'Pioneering health care, discovery, and learning since 1891.',
    prompts_url: 'https://www.utmb.edu/som/admissions/how-to-apply',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'utmb-1', prompt_text: 'Why UTMB? What aspects of our program, location, or mission are most meaningful to you and how do they connect to your goals in medicine?', word_limit: 300 },
      { prompt_id: 'utmb-2', prompt_text: 'Describe a patient encounter or clinical experience that challenged or changed how you think about medicine and the role of a physician.', word_limit: 400 },
    ],
  },
  {
    name: 'UT Southwestern Medical Center', short_name: 'UT Southwestern', slug: 'utsw',
    location: 'Dallas, TX', is_active: true,
    mission_snippet: 'Educating tomorrow\'s physicians and scientists through research-intensive medical training.',
    prompts_url: 'https://www.utsouthwestern.edu/education/medical-school/admissions/how-to-apply/secondary-application.html',
    prompts_updated_at: NOW,
    prompts: [
      { prompt_id: 'utsw-1', prompt_text: 'Why do you want to attend UT Southwestern? Describe specific aspects of our program, curriculum, or research environment that align with your professional goals.', word_limit: 300 },
      { prompt_id: 'utsw-2', prompt_text: 'Describe a situation where you faced a significant failure or setback. How did you respond, and what did the experience teach you about yourself?', word_limit: 400 },
      { prompt_id: 'utsw-3', prompt_text: 'How have your research experiences informed your decision to pursue medicine? What questions did they leave you with?', word_limit: 400 },
    ],
  },
];

// GET /schools — public, returns all active schools with their prompts
router.get('/', async (req, res) => {
  const select = 'id, name, short_name, slug, location, mission_snippet, prompts, prompts_updated_at';
  const { data, error } = await supabase
    .from('schools')
    .select(select)
    .eq('is_active', true)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });

  if (!data || data.length === 0) {
    const { error: insertErr } = await supabase.from('schools').upsert(SEED_SCHOOLS, { onConflict: 'slug' });
    if (insertErr) console.error('School seed error:', insertErr.message);
    const { data: seeded } = await supabase.from('schools').select(select).eq('is_active', true).order('name');
    return res.json(seeded || []);
  }

  // Restore seed prompts for any school whose prompts were wiped to []
  const emptySchools = data.filter(s => !s.prompts || s.prompts.length === 0);
  if (emptySchools.length > 0) {
    await Promise.all(emptySchools.map(s => {
      const seed = SEED_SCHOOLS.find(seed => seed.slug === s.slug);
      if (!seed) return Promise.resolve();
      return supabase.from('schools')
        .update({ prompts: seed.prompts, prompts_updated_at: seed.prompts_updated_at })
        .eq('slug', s.slug);
    }));
    const { data: restored } = await supabase.from('schools').select(select).eq('is_active', true).order('name');
    return res.json(restored || []);
  }

  res.json(data);
});

// POST /schools/:slug/refresh-prompts — auth required, fetches and extracts prompts via Claude
router.post('/:slug/refresh-prompts', authMiddleware, async (req, res) => {
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('id, name, prompts_url, prompts, prompts_updated_at')
    .eq('slug', req.params.slug)
    .single();

  if (schoolErr || !school) return res.status(404).json({ error: 'School not found.' });
  if (!school.prompts_url) return res.status(400).json({ error: 'No prompts URL configured for this school.' });

  let html;
  try {
    const fetchRes = await fetch(school.prompts_url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Scrubbed/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    html = await fetchRes.text();
  } catch (err) {
    return res.status(502).json({ error: `Could not fetch school page: ${err.message}` });
  }

  // Strip script/style tags to reduce token count
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .slice(0, 40000);

  let prompts = [];
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Extract all secondary essay prompts from this medical school admissions page HTML for ${school.name}.

Return ONLY a JSON array, no other text, no markdown fences. Each item: { "prompt_id": "<slug>-<n>", "prompt_text": "<full prompt question>", "word_limit": <number or null> }

If no prompts are found yet (page says "coming soon", is empty, or shows a previous year), return [].

HTML:
${cleanHtml}`,
      }],
    });

    const raw = msg.content[0].text.trim();
    prompts = JSON.parse(raw);
    if (!Array.isArray(prompts)) prompts = [];
  } catch (err) {
    console.error('Prompt extraction error:', err);
    // Don't fail the request — return empty prompts with a warning
    prompts = [];
  }

  // If Claude found nothing, preserve existing prompts — don't overwrite with []
  if (prompts.length === 0) {
    return res.json({
      prompts: school.prompts || [],
      prompts_updated_at: school.prompts_updated_at,
      no_new_prompts: true,
    });
  }

  const { error: updateErr } = await supabase
    .from('schools')
    .update({ prompts, prompts_updated_at: new Date().toISOString() })
    .eq('id', school.id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  res.json({ prompts, prompts_updated_at: new Date().toISOString() });
});

module.exports = router;
