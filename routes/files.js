const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const files = db.prepare(
    'SELECT id, name, type, template_id, content, meta, created_at, updated_at FROM files WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user.id);
  res.json(files.map(f => ({ ...f, content: JSON.parse(f.content), meta: JSON.parse(f.meta) })));
});

router.post('/', (req, res) => {
  const { name, type, template_id, content, meta } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type are required.' });
  const result = db.prepare(
    'INSERT INTO files (user_id, name, type, template_id, content, meta) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), type, template_id || null, JSON.stringify(content || {}), JSON.stringify(meta || {}));
  res.status(201).json({ id: result.lastInsertRowid, name, type });
});

router.put('/:id', (req, res) => {
  const { name, content, meta } = req.body;
  const file = db.prepare('SELECT id FROM files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  db.prepare(
    'UPDATE files SET name = ?, content = ?, meta = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).run(name, JSON.stringify(content || {}), JSON.stringify(meta || {}), req.params.id, req.user.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const file = db.prepare('SELECT id FROM files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
