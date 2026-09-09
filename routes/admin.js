// routes/admin.js
// Reporting endpoints for the admin dashboard. Every route here requires
// a logged-in staff member with the 'admin' role — financial/reporting data
// is not shown to 'staff' accounts, who only handle day-to-day order processing.
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/summary — headline numbers for a dashboard homepage
router.get('/summary', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const totalRevenue = db.prepare(`SELECT COALESCE(SUM(total),0) AS sum FROM orders WHERE payment_status = 'paid'`).get().sum;
  const pendingOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'`).get().n;
  const lowStock = db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock_qty <= 10 AND is_active = 1').get().n;
  const totalProducts = db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active = 1').get().n;

  res.json({
    total_orders: totalOrders,
    total_revenue_kes: totalRevenue,
    pending_orders: pendingOrders,
    low_stock_products: lowStock,
    total_products: totalProducts,
  });
});

// GET /api/admin/low-stock — products at or below a threshold (default 10)
router.get('/low-stock', (req, res) => {
  const threshold = Number(req.query.threshold) || 10;
  const rows = db.prepare(`
    SELECT p.id, p.name, p.code, p.stock_qty, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.stock_qty <= ? AND p.is_active = 1
    ORDER BY p.stock_qty ASC
  `).all(threshold);
  res.json(rows);
});

// GET /api/admin/sales-by-category — revenue breakdown, useful for reporting
router.get('/sales-by-category', (req, res) => {
  const rows = db.prepare(`
    SELECT c.name AS category, SUM(oi.unit_price * oi.qty) AS revenue_kes, SUM(oi.qty) AS units_sold
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN categories c ON c.id = p.category_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.payment_status = 'paid'
    GROUP BY c.name
    ORDER BY revenue_kes DESC
  `).all();
  res.json(rows);
});

// GET /api/admin/top-products — best sellers by units sold
router.get('/top-products', (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const rows = db.prepare(`
    SELECT oi.product_name, SUM(oi.qty) AS units_sold, SUM(oi.unit_price * oi.qty) AS revenue_kes
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.payment_status = 'paid'
    GROUP BY oi.product_name
    ORDER BY units_sold DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

module.exports = router;
