// routes/products.js
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// This route is public (storefront browsing needs no login), but admins
// viewing the dashboard can optionally see archived products too by passing
// ?include_inactive=1 with a valid admin token. A customer request without
// a valid admin token always gets active products only, regardless of the
// query param — this check never widens access for anyone but a real admin.
function isRequestingAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.role === 'admin';
  } catch (e) {
    return false;
  }
}

// GET /api/products — list active products (or all, for an admin who asks for it)
router.get('/', (req, res) => {
  const { category, q, include_inactive } = req.query;
  const showInactiveToo = include_inactive === '1' && isRequestingAdmin(req);

  let sql = `
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
  `;
  const conditions = [];
  const params = [];

  if (!showInactiveToo) conditions.push('p.is_active = 1');
  if (category) { conditions.push('c.name = ?'); params.push(category); }
  if (q) { conditions.push('(p.name LIKE ? OR p.code LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY p.name ASC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/products/:id — single product detail
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(row);
});

// GET /api/categories — list all categories
router.get('/meta/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
  res.json(rows);
});

// POST /api/products — create a new product (staff only)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { name, code, unit, price, original_price, category_id, vat_rate, description, stock_qty, image_url } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  const result = db.prepare(`
    INSERT INTO products (name, code, unit, price, original_price, category_id, vat_rate, description, stock_qty, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, code || null, unit || null, price, original_price || null, category_id || null, vat_rate || 0, description || null, stock_qty || 0, image_url || null);

  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/products/:id — update stock, price, etc. (staff only)
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const fields = ['name', 'code', 'unit', 'price', 'original_price', 'category_id', 'vat_rate', 'description', 'stock_qty', 'is_active', 'image_url'];
  const updates = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const merged = { ...existing, ...updates };

  db.prepare(`
    UPDATE products SET name=?, code=?, unit=?, price=?, original_price=?, category_id=?, vat_rate=?, description=?, stock_qty=?, is_active=?, image_url=?
    WHERE id=?
  `).run(merged.name, merged.code, merged.unit, merged.price, merged.original_price, merged.category_id, merged.vat_rate, merged.description, merged.stock_qty, merged.is_active, merged.image_url, req.params.id);

  res.json({ updated: true });
});

// DELETE /api/products/:id — permanently remove a product (staff only).
// Blocked if the product appears in any past order, since that would break
// order history. Archive it instead (PUT with is_active: 0) in that case.
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const orderCount = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?').get(req.params.id).n;
  if (orderCount > 0) {
    return res.status(400).json({
      error: `This product appears in ${orderCount} past order(s) and can't be permanently deleted. Archive it instead to hide it from the store.`
    });
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
