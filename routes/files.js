'use strict';
const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const SELECT = 'id, name, type, template_id, content, meta, created_at, updated_at';

// List view: strip heavy PDF payloads — clients fetch GET /files/:id when
// they actually need the document. Cuts vault load from megabytes to kilobytes.
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('files')
    .select(SELECT)
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  for (const f of data) {
    if (f.content && f.content.pdf && f.content.dataUrl) {
      f.content = { ...f.content, dataUrl: null, has_data: true };
    }
  }
  res.json(data);
});

// Single file with full content (including PDF data)
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('files')
    .select(SELECT)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'File not found.' });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { name, type, template_id, content, meta } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type are required.' });
  const { data, error } = await supabase
    .from('files')
    .insert({
      user_id: req.user.id,
      name: name.trim(),
      type,
      template_id: template_id || null,
      content: content || {},
      meta: meta || {},
    })
    .select('id, name, type')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', async (req, res) => {
  const { name, content, meta } = req.body;
  // Only update fields that were actually sent — a missing name no longer nulls it out
  const updates = {};
  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (content !== undefined) updates.content = content || {};
  if (meta !== undefined) updates.meta = meta || {};
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  const { error } = await supabase
    .from('files')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('files')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
