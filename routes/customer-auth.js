// routes/customer-auth.js
// Customer-facing accounts — separate from the staff/admin login system in
// routes/auth.js. Customer JWTs are marked { type: 'customer' } so they can
// never be mistaken for a staff token, even though both are signed with the
// same JWT_SECRET.
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function issueCustomerToken(customer) {
  return jwt.sign({ sub: customer.id, type: 'customer' }, JWT_SECRET, { expiresIn: '30d' });
}

function publicCustomer(customer) {
  return {
    id: customer.id,
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone: customer.phone,
    email: customer.email,
    date_of_birth: customer.date_of_birth,
  };
}

// Verifies a customer's token from the Authorization header. Unlike the
// staff requireAuth, a missing/invalid token here doesn't block the request —
// routes that need a logged-in customer check req.customer themselves.
async function attachCustomerIfPresent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.type === 'customer') {
        const customer = await db.get('SELECT * FROM customers WHERE id = ?', [payload.sub]);
        if (customer) req.customer = customer;
      }
    } catch (e) {
      // Invalid/expired token — treated the same as not being logged in.
    }
  }
  next();
}

function requireCustomerAuth(req, res, next) {
  if (!req.customer) return res.status(401).json({ error: 'Please log in to continue' });
  next();
}

// POST /api/customer-auth/register
router.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, phone, email, date_of_birth, password } = req.body;
    if (!first_name || !last_name || !phone || !email || !password) {
      return res.status(400).json({ error: 'First name, last name, phone, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingEmail = await db.get('SELECT id FROM customers WHERE email = ?', [email]);
    if (existingEmail) {
      return res.status(400).json({ error: 'An account with that email already exists — try logging in instead' });
    }
    const existingPhone = await db.get('SELECT id, password_hash FROM customers WHERE phone = ?', [phone]);
    if (existingPhone && existingPhone.password_hash) {
      return res.status(400).json({ error: 'An account with that phone number already exists — try logging in instead' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const fullName = `${first_name} ${last_name}`.trim();

    let customerId;
    if (existingPhone) {
      // This phone was used for a past guest checkout — upgrade that record
      // into a real account instead of creating a duplicate customer.
      await db.run(
        `UPDATE customers SET name=?, first_name=?, last_name=?, email=?, date_of_birth=?, password_hash=? WHERE id=?`,
        [fullName, first_name, last_name, email, date_of_birth || null, hash, existingPhone.id]
      );
      customerId = existingPhone.id;
    } else {
      const result = await db.run(
        `INSERT INTO customers (name, first_name, last_name, phone, email, date_of_birth, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [fullName, first_name, last_name, phone, email, date_of_birth || null, hash]
      );
      customerId = result.lastInsertRowid;
    }

    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
    const token = issueCustomerToken(customer);
    res.status(201).json({ token, customer: publicCustomer(customer) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/customer-auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const customer = await db.get('SELECT * FROM customers WHERE email = ?', [email]);
    if (!customer || !customer.password_hash || !bcrypt.compareSync(password, customer.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    const token = issueCustomerToken(customer);
    res.json({ token, customer: publicCustomer(customer) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/customer-auth/me — used by the storefront to confirm a stored token is still valid
router.get('/me', attachCustomerIfPresent, requireCustomerAuth, (req, res) => {
  res.json(publicCustomer(req.customer));
});

module.exports = { router, attachCustomerIfPresent, requireCustomerAuth };
