const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('files')
    .select('id, name, type, template_id, content, meta, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
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
  const { error } = await supabase
    .from('files')
    .update({ name, content: content || {}, meta: meta || {} })
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
