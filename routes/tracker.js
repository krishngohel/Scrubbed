'use strict';
const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const STATUSES = {
  secondary: ['not_started', 'in_progress', 'submitted'],
  interview: ['none', 'invited', 'scheduled', 'completed'],
  decision: ['pending', 'accepted', 'rejected', 'waitlisted'],
  waitlist: ['none', 'active', 'accepted_off_waitlist', 'removed'],
};

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('application_schools')
    .select('*')
    .eq('user_id', req.user.id)
    .order('secondary_deadline', { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/', async (req, res) => {
  const { school_name, school_slug, secondary_status, secondary_deadline, interview_status, interview_date, decision_status, waitlist_status, notes } = req.body;
  if (!school_name?.trim()) return res.status(400).json({ error: 'school_name required' });
  const { data, error } = await supabase
    .from('application_schools')
    .insert({
      user_id: req.user.id,
      school_name: school_name.trim(),
      school_slug: school_slug || null,
      secondary_status: secondary_status || 'not_started',
      secondary_deadline: secondary_deadline || null,
      interview_status: interview_status || 'none',
      interview_date: interview_date || null,
      decision_status: decision_status || 'pending',
      waitlist_status: waitlist_status || 'none',
      notes: notes || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', async (req, res) => {
  const allowed = ['school_name', 'school_slug', 'secondary_status', 'secondary_deadline', 'interview_status', 'interview_date', 'decision_status', 'waitlist_status', 'notes', 'sort_order'];
  const updates = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  const { data, error } = await supabase
    .from('application_schools')
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
    .from('application_schools')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.get('/meta/statuses', (_req, res) => res.json(STATUSES));

module.exports = router;
