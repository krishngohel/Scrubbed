'use strict';
const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { assessVaultReadiness } = require('../lib/vault-readiness');
const { assessVaultStats, HOUR_SECTIONS } = require('../lib/vault-stats');

const router = express.Router();
router.use(authMiddleware);

async function loadVaultFiles(userId) {
  const { data: files, error } = await supabase
    .from('files')
    .select('id, name, type, template_id, content, meta')
    .eq('user_id', userId)
    .neq('template_id', 'secondary-outline');
  return { files: files || [], error };
}

// GET /vault/readiness — used by secondaries page before outline generation
router.get('/readiness', async (req, res) => {
  const { files, error } = await loadVaultFiles(req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(assessVaultReadiness(files));
});

async function loadGoalHours(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('goal_hours')
    .eq('id', userId)
    .maybeSingle();
  // Missing column (schema not migrated yet) or any read error → default targets
  if (error) return {};
  return (data && data.goal_hours) || {};
}

// GET /vault/stats — hour totals + per-section breakdown for dashboard
router.get('/stats', async (req, res) => {
  const [{ files, error }, goals] = await Promise.all([
    loadVaultFiles(req.user.id),
    loadGoalHours(req.user.id),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.json(assessVaultStats(files, goals));
});

// GET /vault/goals — current hour targets (custom where set, defaults elsewhere)
router.get('/goals', async (req, res) => {
  const goals = await loadGoalHours(req.user.id);
  res.json({
    sections: HOUR_SECTIONS.map((sec) => {
      const custom = Number(goals[sec.id]);
      const hasCustom = Number.isFinite(custom) && custom > 0;
      return {
        id: sec.id,
        label: sec.label,
        targetHours: hasCustom ? custom : sec.targetHours,
        defaultTargetHours: sec.targetHours,
        customTarget: hasCustom && custom !== sec.targetHours,
      };
    }),
  });
});

// PUT /vault/goals — replace custom hour targets. Body: { clinical: 500, ... }
// Omitted / null / default-valued sections revert to the built-in target.
router.put('/goals', async (req, res) => {
  const body = req.body || {};
  const goals = {};
  for (const sec of HOUR_SECTIONS) {
    const raw = body[sec.id];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 99999) {
      return res.status(400).json({ error: `Invalid target for ${sec.label} — use a number between 1 and 99,999.` });
    }
    const rounded = Math.round(n * 10) / 10;
    if (rounded !== sec.targetHours) goals[sec.id] = rounded;
  }
  const { error } = await supabase
    .from('profiles')
    .update({ goal_hours: goals })
    .eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, goals });
});

module.exports = router;
