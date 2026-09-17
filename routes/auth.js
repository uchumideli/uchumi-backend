// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db/db');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');
const { sendEmail } = require('../lib/mail');

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

    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role, branch_id: user.branch_id }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username: user.username, role: user.role, branch_id: user.branch_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me — used by the dashboard to confirm a stored token is still valid
router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, branch_id: req.user.branch_id });
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

// POST /api/auth/forgot-password — same pattern as the customer-facing one:
// always responds the same way whether or not the username/email exists,
// so nobody can use this to probe which staff accounts exist.
router.post('/forgot-password', async (req, res) => {
  const genericResponse = { message: "If that email has a staff account, we've sent a password reset link to it." };
  try {
    const { email, frontend_url } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await db.get('SELECT * FROM admin_users WHERE email = ? AND is_active = 1', [email]);
    if (!user) {
      return res.json(genericResponse);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    await db.run('UPDATE admin_users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [token, expires, user.id]);

    const base = frontend_url || process.env.DASHBOARD_URL || '';
    const resetLink = `${base}${base.includes('?') ? '&' : '?'}reset_token=${token}`;

    await sendEmail({
      to: email,
      subject: 'Reset your Uchumi staff dashboard password',
      html: `
        <p>Hi ${user.first_name || user.username},</p>
        <p>Someone requested a password reset for your Uchumi staff dashboard account. If this was you, click below to set a new password:</p>
        <p><a href="${resetLink}" style="background:#FF000E;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Reset my password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      `,
    });

    res.json(genericResponse);
  } catch (e) {
    console.error(e);
    res.json(genericResponse);
  }
});

// POST /api/auth/reset-password — body: { token, new_password }
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await db.get('SELECT * FROM admin_users WHERE reset_token = ?', [token]);
    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired — request a new one' });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    await db.run('UPDATE admin_users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [hash, user.id]);

    res.json({ message: 'Password updated — you can now log in with your new password.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ---- Staff account management (admin role only) ----

// GET /api/auth/users — list staff accounts. A super-admin (branch_id NULL)
// sees everyone; a branch_admin only sees staff belonging to their own branch.
router.get('/users', requireAuth, requireRole('admin', 'branch_admin'), async (req, res) => {
  try {
    let sql = `
      SELECT u.id, u.username, u.role, u.is_active, u.created_at, u.first_name, u.last_name, u.phone, u.national_id, u.email, u.branch_id, b.name AS branch_name
      FROM admin_users u
      LEFT JOIN branches b ON b.id = u.branch_id
    `;
    const params = [];
    if (req.user.role === 'branch_admin') {
      sql += ' WHERE u.branch_id = ?';
      params.push(req.user.branch_id);
    }
    sql += ' ORDER BY u.created_at ASC';
    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load staff accounts' });
  }
});

// POST /api/auth/users — create a new staff account.
// A branch_admin can only create plain 'staff' accounts, and only for their
// own branch — they can't create other admins/branch_admins or assign a
// different branch, no matter what the request body says.
router.post('/users', requireAuth, requireRole('admin', 'branch_admin'), async (req, res) => {
  try {
    const { username, password, role, first_name, last_name, phone, national_id, email, branch_id } = req.body;
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: 'Username and a password of at least 8 characters are required' });
    }

    let finalRole, finalBranchId;
    if (req.user.role === 'branch_admin') {
      finalRole = 'staff';
      finalBranchId = req.user.branch_id;
    } else {
      finalRole = ['admin', 'branch_admin', 'staff'].includes(role) ? role : 'staff';
      finalBranchId = finalRole === 'admin' ? null : (branch_id || null);
      if (finalRole === 'branch_admin' && !finalBranchId) {
        return res.status(400).json({ error: 'A branch_admin must be assigned to a branch' });
      }
    }

    const existing = await db.get('SELECT id FROM admin_users WHERE username = ?', [username]);
    if (existing) {
      return res.status(400).json({ error: 'That username is already taken' });
    }
    if (email) {
      const existingEmail = await db.get('SELECT id FROM admin_users WHERE email = ?', [email]);
      if (existingEmail) {
        return res.status(400).json({ error: 'That email is already used by another staff account' });
      }
    }
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run(
      `INSERT INTO admin_users (username, password_hash, role, first_name, last_name, phone, national_id, email, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, hash, finalRole, first_name || null, last_name || null, phone || null, national_id || null, email || null, finalBranchId]
    );
    res.status(201).json({ id: result.lastInsertRowid, username, role: finalRole, branch_id: finalBranchId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
});

// PUT /api/auth/users/:id — update a staff account's role, branch, active
// status, or profile details. A branch_admin can only touch staff within
// their own branch, and can't change anyone's role or branch assignment.
router.put('/users/:id', requireAuth, requireRole('admin', 'branch_admin'), async (req, res) => {
  try {
    const target = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (req.user.role === 'branch_admin') {
      if (target.branch_id !== req.user.branch_id) {
        return res.status(403).json({ error: 'You can only manage staff in your own branch' });
      }
      if (req.body.role !== undefined || req.body.branch_id !== undefined) {
        return res.status(403).json({ error: "You can't change a staff member's role or branch" });
      }
    }

    if (target.id === req.user.sub && req.body.is_active === 0) {
      return res.status(400).json({ error: "You can't deactivate your own account" });
    }
    if (target.id === req.user.sub && req.body.role === 'staff') {
      return res.status(400).json({ error: "You can't remove your own admin rights — ask another admin to do it" });
    }

    if (req.body.email !== undefined && req.body.email) {
      const existingEmail = await db.get('SELECT id FROM admin_users WHERE email = ? AND id != ?', [req.body.email, target.id]);
      if (existingEmail) {
        return res.status(400).json({ error: 'That email is already used by another staff account' });
      }
    }

    const role = ['admin', 'branch_admin', 'staff'].includes(req.body.role) ? req.body.role : target.role;
    const isActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : target.is_active;
    const branchId = req.body.branch_id !== undefined ? (req.body.branch_id || null) : target.branch_id;

    const profileFields = ['first_name', 'last_name', 'phone', 'national_id', 'email'];
    const updates = {};
    for (const f of profileFields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const merged = { ...target, ...updates };

    await db.run(
      `UPDATE admin_users SET role=?, is_active=?, branch_id=?, first_name=?, last_name=?, phone=?, national_id=?, email=? WHERE id=?`,
      [role, isActive, branchId, merged.first_name, merged.last_name, merged.phone, merged.national_id, merged.email, target.id]
    );
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update staff account' });
  }
});

module.exports = router;
