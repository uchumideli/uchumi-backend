// middleware/auth.js
// Protects staff-only routes. Customer-facing routes (browsing products,
// placing an order) stay open — only reporting and write/edit actions
// require a logged-in staff member.

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-going-live';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Login required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session, please log in again' });
  }
}

module.exports = { requireAuth, JWT_SECRET };
