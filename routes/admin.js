// routes/admin.js
// Reporting endpoints for the admin dashboard. Requires a logged-in 'admin'
// or 'branch_admin' — day-to-day 'staff' accounts don't see financial reports.
//
// Every route accepts optional ?branch_id=, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD
// query params to scope a report. A branch_admin's own branch is always
// enforced server-side regardless of what ?branch_id= says in the request —
// they can only ever see their own branch's numbers.
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'branch_admin'));

// Resolves the effective branch filter and date range for a request, and
// builds the WHERE clause fragment + params every report below shares.
function resolveReportFilters(req) {
  const effectiveBranchId = req.user.role === 'branch_admin' ? req.user.branch_id : (req.query.branch_id || null);
  const conditions = [`o.payment_status = 'paid'`];
  const params = [];
  if (effectiveBranchId) {
    conditions.push('o.branch_id = ?');
    params.push(effectiveBranchId);
  }
  if (req.query.from) {
    conditions.push('o.created_at >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    // Include the whole "to" day, not just midnight of it.
    conditions.push('o.created_at <= ?');
    params.push(req.query.to + ' 23:59:59');
  }
  return { where: conditions.join(' AND '), params, effectiveBranchId };
}

// GET /api/admin/summary — headline numbers for a dashboard homepage
router.get('/summary', async (req, res) => {
  try {
    const { where, params, effectiveBranchId } = resolveReportFilters(req);

    const totalOrdersRow = await db.get(`SELECT COUNT(*) AS n FROM orders o WHERE ${effectiveBranchId ? 'o.branch_id = ?' : '1=1'}`, effectiveBranchId ? [effectiveBranchId] : []);
    const totalRevenueRow = await db.get(`SELECT COALESCE(SUM(o.total),0) AS sum FROM orders o WHERE ${where}`, params);
    const pendingRow = await db.get(`SELECT COUNT(*) AS n FROM orders o WHERE o.status = 'pending' ${effectiveBranchId ? 'AND o.branch_id = ?' : ''}`, effectiveBranchId ? [effectiveBranchId] : []);

    const productConditions = ['is_active = 1'];
    const productParams = [];
    if (effectiveBranchId) {
      productConditions.push('(branch_id IS NULL OR branch_id = ?)');
      productParams.push(effectiveBranchId);
    }
    const lowStock = (await db.get(`SELECT COUNT(*) AS n FROM products WHERE ${productConditions.join(' AND ')} AND stock_qty <= 10`, productParams)).n;
    const totalProducts = (await db.get(`SELECT COUNT(*) AS n FROM products WHERE ${productConditions.join(' AND ')}`, productParams)).n;

    res.json({
      total_orders: totalOrdersRow.n,
      total_revenue_kes: totalRevenueRow.sum,
      pending_orders: pendingRow.n,
      low_stock_products: lowStock,
      total_products: totalProducts,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// GET /api/admin/low-stock — products at or below a threshold (default 10)
router.get('/low-stock', async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || 10;
    const effectiveBranchId = req.user.role === 'branch_admin' ? req.user.branch_id : (req.query.branch_id || null);

    const conditions = ['p.stock_qty <= ?', 'p.is_active = 1'];
    const params = [threshold];
    if (effectiveBranchId) {
      conditions.push('(p.branch_id IS NULL OR p.branch_id = ?)');
      params.push(effectiveBranchId);
    }

    const rows = await db.all(`
      SELECT p.id, p.name, p.code, p.stock_qty, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.stock_qty ASC
    `, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load low-stock report' });
  }
});

// GET /api/admin/stock-report — inventory-wide numbers: total value tied up
// in stock, unit counts, out-of-stock/low-stock counts, a breakdown by
// category, and the products holding the most capital (price × quantity).
router.get('/stock-report', async (req, res) => {
  try {
    const effectiveBranchId = req.user.role === 'branch_admin' ? req.user.branch_id : (req.query.branch_id || null);
    const conditions = ['p.is_active = 1'];
    const params = [];
    if (effectiveBranchId) {
      conditions.push('(p.branch_id IS NULL OR p.branch_id = ?)');
      params.push(effectiveBranchId);
    }
    const where = conditions.join(' AND ');

    const totals = await db.get(`
      SELECT
        COALESCE(SUM(p.price * p.stock_qty), 0) AS total_value_kes,
        COALESCE(SUM(p.stock_qty), 0) AS total_units,
        COUNT(*) AS total_products,
        SUM(CASE WHEN p.stock_qty = 0 THEN 1 ELSE 0 END) AS out_of_stock_count,
        SUM(CASE WHEN p.stock_qty > 0 AND p.stock_qty <= 10 THEN 1 ELSE 0 END) AS low_stock_count
      FROM products p
      WHERE ${where}
    `, params);

    const byCategory = await db.all(`
      SELECT c.name AS category, COUNT(*) AS product_count,
             COALESCE(SUM(p.stock_qty), 0) AS units,
             COALESCE(SUM(p.price * p.stock_qty), 0) AS value_kes
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where}
      GROUP BY c.name
      ORDER BY value_kes DESC
    `, params);

    const topValue = await db.all(`
      SELECT p.name, p.code, p.stock_qty, p.price, (p.price * p.stock_qty) AS value_kes
      FROM products p
      WHERE ${where}
      ORDER BY value_kes DESC
      LIMIT 10
    `, params);

    res.json({
      total_value_kes: totals.total_value_kes,
      total_units: totals.total_units,
      total_products: totals.total_products,
      out_of_stock_count: totals.out_of_stock_count,
      low_stock_count: totals.low_stock_count,
      by_category: byCategory,
      top_value_items: topValue,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load stock report' });
  }
});

// GET /api/admin/sales-by-category — revenue breakdown, useful for reporting
router.get('/sales-by-category', async (req, res) => {
  try {
    const { where, params } = resolveReportFilters(req);
    const rows = await db.all(`
      SELECT c.name AS category, SUM(oi.unit_price * oi.qty) AS revenue_kes, SUM(oi.qty) AS units_sold
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN categories c ON c.id = p.category_id
      JOIN orders o ON o.id = oi.order_id
      WHERE ${where}
      GROUP BY c.name
      ORDER BY revenue_kes DESC
    `, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load sales by category' });
  }
});

// GET /api/admin/top-products — best sellers by units sold
router.get('/top-products', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const { where, params } = resolveReportFilters(req);
    const rows = await db.all(`
      SELECT oi.product_name, SUM(oi.qty) AS units_sold, SUM(oi.unit_price * oi.qty) AS revenue_kes
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE ${where}
      GROUP BY oi.product_name
      ORDER BY units_sold DESC
      LIMIT ?
    `, [...params, limit]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load top products' });
  }
});

// GET /api/admin/sales-by-branch — revenue per branch, for a super-admin
// comparing branches side by side. Not meaningful for a branch_admin (who
// only ever sees their own branch anyway), but harmless either way.
router.get('/sales-by-branch', async (req, res) => {
  try {
    const { where, params } = resolveReportFilters(req);
    const rows = await db.all(`
      SELECT b.name AS branch_name, COUNT(DISTINCT o.id) AS order_count, COALESCE(SUM(o.total),0) AS revenue_kes
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE ${where}
      GROUP BY b.name
      ORDER BY revenue_kes DESC
    `, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load sales by branch' });
  }
});

// GET /api/admin/orders-report — the raw order list behind a report, for
// a CSV export. Same filters as everything else here.
router.get('/orders-report', async (req, res) => {
  try {
    const effectiveBranchId = req.user.role === 'branch_admin' ? req.user.branch_id : (req.query.branch_id || null);
    const conditions = [];
    const params = [];
    if (effectiveBranchId) { conditions.push('o.branch_id = ?'); params.push(effectiveBranchId); }
    if (req.query.from) { conditions.push('o.created_at >= ?'); params.push(req.query.from); }
    if (req.query.to) { conditions.push('o.created_at <= ?'); params.push(req.query.to + ' 23:59:59'); }

    let sql = `
      SELECT o.order_code, o.created_at, b.name AS branch_name, o.status, o.payment_status,
             o.subtotal, o.vat_total, o.delivery_fee, o.total, o.phone
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
    `;
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY o.created_at DESC';

    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load orders report' });
  }
});

module.exports = router;
