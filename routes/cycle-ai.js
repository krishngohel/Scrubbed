'use strict';
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { assessVaultReadiness } = require('../lib/vault-readiness');
const { getPlanLimits, isPaidSubscriber } = require('../lib/plan-limits');
const {
  loadProfile, checkGenerationAllowed, incrementGeneration, sleep,
} = require('../lib/generation-caps');

const router = express.Router();
router.use(authMiddleware);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
});

async function fetchVaultContext(userId) {
  const { data: files } = await supabase
    .from('files')
    .select('name, type, template_id, content, meta')
    .eq('user_id', userId)
    .neq('template_id', 'secondary-outline');
  if (!files?.length) return '';
  return files.map((f) => {
    const rows = f.content?.rows;
    const preview = Array.isArray(rows) ? `${rows.length} rows` : 'document';
    return `=== ${f.name} [${f.template_id || f.type}] (${preview}) ===`;
  }).join('\n\n');
}

async function runGeneration(userId, profile, generationType, taskBlock, maxTokens) {
  const gate = await checkGenerationAllowed(userId, profile, { generationType });
  if (!gate.ok) return { error: gate.body, status: gate.status };
  if (gate.delayMs) await sleep(gate.delayMs);

  const files = await supabase
    .from('files')
    .select('name, type, template_id, content, meta')
    .eq('user_id', userId)
    .neq('template_id', 'secondary-outline');
  const readiness = assessVaultReadiness(files.data || []);
  if (!readiness.ready) {
    return { error: { error: 'Vault not ready', limit_type: 'vault_insufficient', missing: readiness.missing }, status: 403 };
  }

  const vaultContext = await fetchVaultContext(userId);
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'mock') {
    const mock = `**[MOCK ${generationType}]**\n- Vault-based talking points only\n- Write in your own words\n---`;
    await incrementGeneration(userId, gate.profile, { consumesSlot: true, generationType, priority: gate.priority, throttled: gate.throttled });
    return { text: mock };
  }

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: [{
      type: 'text',
      text: `You produce essay OUTLINES only — structure and talking points from the applicant's Vault. Never write essay prose or complete sentences usable in a final application. Bullets are directives and questions only.`,
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `VAULT:\n\n${vaultContext}`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: taskBlock },
      ],
    }],
  });
  const text = msg.content?.[0]?.text;
  if (!text) return { error: { error: 'Generation failed' }, status: 500 };
  await incrementGeneration(userId, gate.profile, { consumesSlot: true, generationType, priority: gate.priority, throttled: gate.throttled });
  return { text };
}

async function paidGate(req, res) {
  const profile = await loadProfile(req.user.id);
  if (!isPaidSubscriber(profile)) {
    res.status(403).json({ error: 'Paid plan required for AI generation.' });
    return null;
  }
  return profile;
}

router.post('/personal-statement', async (req, res) => {
  const profile = await paidGate(req, res);
  if (!profile) return;
  const limits = getPlanLimits(profile.plan_type);
  const task = `Generate an AMCAS Personal Statement OUTLINE (5,300 char limit) from the Vault.

Sections:
**Narrative arc** — which vault experiences anchor opening, development, and closing (name entries only)
**Themes to weave** — 3–5 theme bullets tied to named vault entries
**Experience map** — which entries support which beats (no prose)
**What to avoid** — pattern-level notes

Never draft paragraphs.`;
  const out = await runGeneration(req.user.id, profile, 'personal-statement', task, limits.max_tokens);
  if (out.error) return res.status(out.status).json(out.error);
  res.json({ outline: out.text, generation_type: 'personal-statement' });
});

router.post('/work-activities', async (req, res) => {
  const profile = await paidGate(req, res);
  if (!profile) return;
  const limits = getPlanLimits(profile.plan_type);
  const task = `Generate Work & Activities OUTLINE guidance from the Vault (up to 15 AMCAS entries, 700 chars each).

Sections:
**Suggested entries** — list vault files/logs as candidate activities with setting/date only
**Per-entry talking points** — for each, 4–6 bullets the applicant writes themselves (no prose)
**Most meaningful candidates** — flag top 3 entries and one-line factual reason each fits the 1,325-char reflection box
**What to avoid**

Never draft 700-char descriptions.`;
  const out = await runGeneration(req.user.id, profile, 'work-activities', task, limits.max_tokens);
  if (out.error) return res.status(out.status).json(out.error);
  res.json({ outline: out.text, generation_type: 'work-activities' });
});

router.post('/interview', async (req, res) => {
  const profile = await paidGate(req, res);
  if (!profile) return;
  const { school_name, school_slug, mission_snippet } = req.body;
  if (!school_name && !school_slug) return res.status(400).json({ error: 'school_name or school_slug required' });
  let schoolLabel = school_name;
  if (school_slug) {
    const { data } = await supabase.from('schools').select('name, short_name, mission_snippet').eq('slug', school_slug).single();
    if (data) schoolLabel = data.short_name || data.name;
  }
  const limits = getPlanLimits(profile.plan_type);
  const task = `Generate INTERVIEW PREP outlines for ${schoolLabel}${mission_snippet ? ` (mission: ${mission_snippet})` : ''} from the Vault.

Sections:
**Likely behavioral questions** — 6–10 questions tied to vault themes
**STAR talking-point outlines** — for each question, bullet structure only (Situation/Task/Action/Result prompts referencing named vault entries — no scripted answers)
**MMI-style scenarios** — 2–3 ethical/scenario prompts with bullet frameworks only
**School-specific angles** — factual pointers to programs/mission

Never write word-for-word answers.`;
  const out = await runGeneration(req.user.id, profile, 'interview-prep', task, limits.max_tokens);
  if (out.error) return res.status(out.status).json(out.error);
  res.json({ outline: out.text, generation_type: 'interview-prep', school: schoolLabel });
});

module.exports = router;
