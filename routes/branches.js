// routes/branches.js
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/branches — list all branches (public, the storefront needs this
// for the "choose your branch" picker before showing anything else)
router.get('/', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM branches ORDER BY name ASC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load branches' });
  }
});

// POST /api/branches — create a new branch (admin only)
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, address, latitude, longitude } = req.body;
    if (!name || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'name, latitude, and longitude are required' });
    }
    const result = await db.run(
      'INSERT INTO branches (name, address, latitude, longitude) VALUES (?, ?, ?, ?)',
      [name, address || null, latitude, longitude]
    );
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create branch' });
  }
});

// PUT /api/branches/:id — edit a branch's details or GPS coordinates (admin only)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM branches WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Branch not found' });

    const fields = ['name', 'address', 'latitude', 'longitude'];
    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const merged = { ...existing, ...updates };

    await db.run(
      'UPDATE branches SET name=?, address=?, latitude=?, longitude=? WHERE id=?',
      [merged.name, merged.address, merged.latitude, merged.longitude, req.params.id]
    );
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update branch' });
  }
});

module.exports = router;
