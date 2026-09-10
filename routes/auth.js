// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await db.get('SELECT * FROM admin_users WHERE username = ?', [username]);
    if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username: user.username, role: user.role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me — used by the dashboard to confirm a stored token is still valid
router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// POST /api/auth/change-password — logged-in user changes their own password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const user = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.user.sub]);
    if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const newHash = bcrypt.hashSync(new_password, 10);
    await db.run('UPDATE admin_users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ---- Staff account management (admin role only) ----

// GET /api/auth/users — list all staff accounts
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.all('SELECT id, username, role, is_active, created_at FROM admin_users ORDER BY created_at ASC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load staff accounts' });
  }
});

// POST /api/auth/users — create a new staff account
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: 'Username and a password of at least 8 characters are required' });
    }
    const finalRole = role === 'admin' ? 'admin' : 'staff';
    const existing = await db.get('SELECT id FROM admin_users WHERE username = ?', [username]);
    if (existing) {
      return res.status(400).json({ error: 'That username is already taken' });
    }
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, finalRole]);
    res.status(201).json({ id: result.lastInsertRowid, username, role: finalRole });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
});

// PUT /api/auth/users/:id — update a staff account's role or active status
router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const target = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.id === req.user.sub && req.body.is_active === 0) {
      return res.status(400).json({ error: "You can't deactivate your own account" });
    }
    if (target.id === req.user.sub && req.body.role === 'staff') {
      return res.status(400).json({ error: "You can't remove your own admin rights — ask another admin to do it" });
    }

    const role = req.body.role === 'admin' ? 'admin' : (req.body.role === 'staff' ? 'staff' : target.role);
    const isActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : target.is_active;

    await db.run('UPDATE admin_users SET role = ?, is_active = ? WHERE id = ?', [role, isActive, target.id]);
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update staff account' });
  }
});

module.exports = router;
