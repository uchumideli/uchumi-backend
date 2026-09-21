// routes/announcements.js
// Short rotating text messages shown in an animated ticker on the storefront
// (e.g. "Free delivery on orders over KES 2,000!"). Simple by design — just
// a message, a display order, and whether it's currently active.
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/announcements — public, the storefront ticker pulls these.
// ?include_inactive=1 (admin only) shows hidden ones too, for the dashboard.
router.get('/', async (req, res) => {
  try {
    const showInactiveToo = req.query.include_inactive === '1' && await isRequestingAdmin(req);
    let sql = 'SELECT * FROM announcements';
    if (!showInactiveToo) sql += ' WHERE is_active = 1';
    sql += ' ORDER BY sort_order ASC, created_at ASC';
    const rows = await db.all(sql);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

async function isRequestingAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return false;
  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth');
    const payload = jwt.verify(token, JWT_SECRET);
    return ['admin', 'branch_admin'].includes(payload.role);
  } catch (e) {
    return false;
  }
}

const VALID_ANIMATIONS = ['fade', 'slide', 'typewriter', 'zoom', 'flip'];

// GET /api/announcements/settings — public, the storefront ticker uses this
// to know which animation style to play. Must be defined before PUT /:id so
// "settings" doesn't get mistaken for an announcement id.
router.get('/settings', async (req, res) => {
  try {
    const row = await db.get("SELECT value FROM settings WHERE key = 'ticker_animation'");
    res.json({ animation: (row && VALID_ANIMATIONS.includes(row.value)) ? row.value : 'fade' });
  } catch (e) {
    console.error(e);
    res.json({ animation: 'fade' }); // never block the ticker over a settings read failure
  }
});

// PUT /api/announcements/settings — admin/branch_admin picks the animation style
router.put('/settings', requireAuth, requireRole('admin', 'branch_admin'), async (req, res) => {
  try {
    const { animation } = req.body;
    if (!VALID_ANIMATIONS.includes(animation)) {
      return res.status(400).json({ error: `Animation must be one of: ${VALID_ANIMATIONS.join(', ')}` });
    }
    await db.run(
      "INSERT INTO settings (key, value) VALUES ('ticker_animation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [animation]
    );
    res.json({ updated: true, animation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update animation setting' });
  }
});

// POST /api/announcements — add a message (admin/branch_admin)
router.post('/', requireAuth, requireRole('admin', 'branch_admin'), async (req, res) => {
  try {
    const { message, sort_order } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    const result = await db.run(
      'INSERT INTO announcements (message, sort_order) VALUES (?, ?)',
      [message.trim(), sort_order || 0]
    );
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// PUT /api/announcements/:id — edit, reorder, or hide/show a message
router.put('/:id', requireAuth, requireRole('admin', 'branch_admin'), async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Announcement not found' });

    const fields = ['message', 'sort_order', 'is_active'];
    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const merged = { ...existing, ...updates };

    await db.run(
      'UPDATE announcements SET message=?, sort_order=?, is_active=? WHERE id=?',
      [merged.message, merged.sort_order, merged.is_active, req.params.id]
    );
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

// DELETE /api/announcements/:id
router.delete('/:id', requireAuth, requireRole('admin', 'branch_admin'), async (req, res) => {
  try {
    await db.run('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

module.exports = router;
