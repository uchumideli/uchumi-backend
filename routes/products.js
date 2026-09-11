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
// ?branch_id= filters to products available at that branch OR available
// everywhere (branch_id IS NULL on the product) — see db/db.js comment.
router.get('/', async (req, res) => {
  try {
    const { category, q, include_inactive, branch_id } = req.query;
    const showInactiveToo = include_inactive === '1' && isRequestingAdmin(req);

    let sql = `
      SELECT p.*, c.name AS category_name, b.name AS branch_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN branches b ON b.id = p.branch_id
    `;
    const conditions = [];
    const params = [];

    if (!showInactiveToo) conditions.push('p.is_active = 1');
    if (category) { conditions.push('c.name = ?'); params.push(category); }
    if (q) { conditions.push('(p.name LIKE ? OR p.code LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (branch_id) { conditions.push('(p.branch_id IS NULL OR p.branch_id = ?)'); params.push(branch_id); }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY p.name ASC';

    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// GET /api/products/:id — single product detail
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `, [req.params.id]);

    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load product' });
  }
});

// GET /api/categories — list all categories
router.get('/meta/categories', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM categories ORDER BY name ASC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

// POST /api/products — create a new product (staff only)
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, code, unit, price, original_price, category_id, vat_rate, description, stock_qty, image_url, branch_id } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ error: 'name and price are required' });
    }
    const result = await db.run(`
      INSERT INTO products (name, code, unit, price, original_price, category_id, vat_rate, description, stock_qty, image_url, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, code || null, unit || null, price, original_price || null, category_id || null, vat_rate || 0, description || null, stock_qty || 0, image_url || null, branch_id || null]);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id — update stock, price, etc. (staff only)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const fields = ['name', 'code', 'unit', 'price', 'original_price', 'category_id', 'vat_rate', 'description', 'stock_qty', 'is_active', 'image_url', 'branch_id'];
    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const merged = { ...existing, ...updates };

    await db.run(`
      UPDATE products SET name=?, code=?, unit=?, price=?, original_price=?, category_id=?, vat_rate=?, description=?, stock_qty=?, is_active=?, image_url=?, branch_id=?
      WHERE id=?
    `, [merged.name, merged.code, merged.unit, merged.price, merged.original_price, merged.category_id, merged.vat_rate, merged.description, merged.stock_qty, merged.is_active, merged.image_url, merged.branch_id, req.params.id]);

    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id — permanently remove a product (staff only).
// Blocked if the product appears in any past order, since that would break
// order history. Archive it instead (PUT with is_active: 0) in that case.
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const orderCountRow = await db.get('SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?', [req.params.id]);
    const orderCount = orderCountRow.n;
    if (orderCount > 0) {
      return res.status(400).json({
        error: `This product appears in ${orderCount} past order(s) and can't be permanently deleted. Archive it instead to hide it from the store.`
      });
    }

    await db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// POST /api/products/bulk-import — create/update many products at once (admin only)
// Body: { products: [{ name, code, unit, price, vat_rate, stock_qty, is_active, category }] }
// Each product's `category` is a plain category NAME (not an id) — any
// category name not already in the database is created automatically.
// Matching is done by `code`: an existing product with the same code gets
// updated; a new code creates a new product. This is how re-running an
// import (e.g. an updated price list) stays safe to repeat.
router.post('/bulk-import', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products must be a non-empty array' });
    }

    let created = 0;
    let updated = 0;
    const errors = [];

    // Cache category name -> id lookups/creations across the whole batch,
    // since many rows usually share the same category.
    const categoryCache = {};
    async function getOrCreateCategoryId(name) {
      if (!name) return null;
      const trimmed = name.trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      if (categoryCache[key]) return categoryCache[key];

      // Case-insensitive match against existing categories first, so
      // "Fresh Produce" and "Fresh produce" don't become two categories.
      const existingCat = await db.get('SELECT id, name FROM categories WHERE LOWER(name) = ?', [key]);
      if (existingCat) {
        categoryCache[key] = existingCat.id;
        return existingCat.id;
      }

      await db.run('INSERT INTO categories (name) VALUES (?)', [trimmed]);
      const cat = await db.get('SELECT id FROM categories WHERE name = ?', [trimmed]);
      categoryCache[key] = cat.id;
      return cat.id;
    }

    for (const p of products) {
      try {
        if (!p.name || p.price == null) {
          errors.push(`Skipped "${p.name || '(no name)'}" — missing name or price`);
          continue;
        }
        const categoryId = await getOrCreateCategoryId(p.category);
        const existing = p.code ? await db.get('SELECT id FROM products WHERE code = ?', [p.code]) : null;

        if (existing) {
          await db.run(`
            UPDATE products SET name=?, unit=?, price=?, category_id=?, vat_rate=?, stock_qty=?, is_active=?
            WHERE id=?
          `, [p.name, p.unit || null, p.price, categoryId, p.vat_rate || 0, p.stock_qty || 0, p.is_active !== false ? 1 : 0, existing.id]);
          updated++;
        } else {
          await db.run(`
            INSERT INTO products (name, code, unit, price, category_id, vat_rate, stock_qty, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [p.name, p.code || null, p.unit || null, p.price, categoryId, p.vat_rate || 0, p.stock_qty || 0, p.is_active !== false ? 1 : 0]);
          created++;
        }
      } catch (rowError) {
        errors.push(`Failed on "${p.name}": ${rowError.message}`);
      }
    }

    res.json({ created, updated, errors, total: products.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Bulk import failed' });
  }
});

module.exports = router;
