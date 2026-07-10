'use strict';
const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { assessVaultReadiness } = require('../lib/vault-readiness');

const router = express.Router();
router.use(authMiddleware);

// GET /vault/readiness — used by secondaries page before outline generation
router.get('/readiness', async (req, res) => {
  const { data: files, error } = await supabase
    .from('files')
    .select('id, name, type, template_id, content, meta')
    .eq('user_id', req.user.id)
    .neq('template_id', 'secondary-outline');
  if (error) return res.status(500).json({ error: error.message });

  const result = assessVaultReadiness(files || []);
  res.json(result);
});

module.exports = router;
