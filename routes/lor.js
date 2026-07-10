'use strict';
const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const LOR_STATUSES = ['asked', 'committed', 'submitted', 'declined'];

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('lor_writers')
    .select('*')
    .eq('user_id', req.user.id)
    .order('request_date', { ascending: false, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/', async (req, res) => {
  const { writer_name, relationship, request_date, status, notes, reminder_at } = req.body;
  if (!writer_name?.trim()) return res.status(400).json({ error: 'writer_name required' });
  const { data, error } = await supabase
    .from('lor_writers')
    .insert({
      user_id: req.user.id,
      writer_name: writer_name.trim(),
      relationship: relationship || null,
      request_date: request_date || null,
      status: status || 'asked',
      notes: notes || null,
      reminder_at: reminder_at || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', async (req, res) => {
  const allowed = ['writer_name', 'relationship', 'request_date', 'status', 'notes', 'reminder_at'];
  const updates = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  const { data, error } = await supabase
    .from('lor_writers')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('lor_writers')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.get('/meta/statuses', (_req, res) => res.json({ statuses: LOR_STATUSES }));

module.exports = router;
