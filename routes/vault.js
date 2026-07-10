'use strict';
const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { assessVaultReadiness } = require('../lib/vault-readiness');
const { assessVaultStats } = require('../lib/vault-stats');

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

// GET /vault/stats — hour totals + per-section breakdown for dashboard
router.get('/stats', async (req, res) => {
  const { files, error } = await loadVaultFiles(req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(assessVaultStats(files));
});

module.exports = router;
