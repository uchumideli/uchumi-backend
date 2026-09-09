// routes/products.js
const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/products — list all active products, optionally filtered by category or search query
router.get('/', (req, res) => {
  const { category, q } = req.query;
  let sql = `
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = 1
  `;
  const params = [];

  if (category) {
    sql += ' AND c.name = ?';
    params.push(category);
  }
  if (q) {
    sql += ' AND (p.name LIKE ? OR p.code LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
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
router.post('/', requireAuth, (req, res) => {
  const { name, code, unit, price, original_price, category_id, vat_rate, description, stock_qty } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  const result = db.prepare(`
    INSERT INTO products (name, code, unit, price, original_price, category_id, vat_rate, description, stock_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, code || null, unit || null, price, original_price || null, category_id || null, vat_rate || 0, description || null, stock_qty || 0);

  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/products/:id — update stock, price, etc. (staff only)
router.put('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const fields = ['name', 'code', 'unit', 'price', 'original_price', 'category_id', 'vat_rate', 'description', 'stock_qty', 'is_active'];
  const updates = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const merged = { ...existing, ...updates };

  db.prepare(`
    UPDATE products SET name=?, code=?, unit=?, price=?, original_price=?, category_id=?, vat_rate=?, description=?, stock_qty=?, is_active=?
    WHERE id=?
  `).run(merged.name, merged.code, merged.unit, merged.price, merged.original_price, merged.category_id, merged.vat_rate, merged.description, merged.stock_qty, merged.is_active, req.params.id);

  res.json({ updated: true });
});

module.exports = router;
