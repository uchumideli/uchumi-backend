// routes/promo-banners.js
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/promo-banners — public, the storefront pulls these to fill the
// advertisement slots placed every couple of rows in the product grid.
router.get('/', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT * FROM promo_banners
      WHERE is_active = 1
      ORDER BY sort_order ASC, created_at ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load promo banners' });
  }
});

// POST /api/promo-banners — add a new banner (admin only)
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { image_url, title, link_url, sort_order } = req.body;
    if (!image_url) {
      return res.status(400).json({ error: 'image_url is required' });
    }
    const result = await db.run(
      'INSERT INTO promo_banners (image_url, title, link_url, sort_order) VALUES (?, ?, ?, ?)',
      [image_url, title || null, link_url || null, sort_order || 0]
    );
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create promo banner' });
  }
});

// PUT /api/promo-banners/:id — edit or archive a banner (admin only)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM promo_banners WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Banner not found' });

    const fields = ['image_url', 'title', 'link_url', 'sort_order', 'is_active'];
    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const merged = { ...existing, ...updates };

    await db.run(
      'UPDATE promo_banners SET image_url=?, title=?, link_url=?, sort_order=?, is_active=? WHERE id=?',
      [merged.image_url, merged.title, merged.link_url, merged.sort_order, merged.is_active, req.params.id]
    );
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update promo banner' });
  }
});

// DELETE /api/promo-banners/:id — permanently remove a banner (admin only)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.run('DELETE FROM promo_banners WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete promo banner' });
  }
});

module.exports = router;
