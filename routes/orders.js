// routes/orders.js
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function generateOrderCode() {
  const n = Math.floor(100000 + Math.random() * 899999);
  return `UCH${n}`;
}

const DELIVERY_FEES = {
  'Nairobi CBD': 150,
  'Westlands / Parklands': 200,
  'Kilimani / Kileleshwa': 200,
  'Karen / Langata': 300,
  'Outside Nairobi': 500,
};

// POST /api/orders — create a new order from the cart
// Body: { items: [{product_id, qty}], delivery_zone, delivery_address, phone, customer_name }
router.post('/', async (req, res) => {
  try {
    const { items, delivery_zone, delivery_address, phone, customer_name } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must include at least one item' });
    }
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const orderItems = [];
    let subtotal = 0;
    let vatTotal = 0;

    for (const item of items) {
      const product = await db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', [item.product_id]);
      if (!product) {
        return res.status(400).json({ error: `Product ${item.product_id} not found or unavailable` });
      }
      if (product.stock_qty < item.qty) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
      }
      const lineTotal = product.price * item.qty;
      subtotal += lineTotal;
      if (product.vat_rate > 0) {
        vatTotal += Math.round(lineTotal * product.vat_rate / (100 + product.vat_rate));
      }
      orderItems.push({ product, qty: item.qty, unit_price: product.price });
    }

    const deliveryFee = DELIVERY_FEES[delivery_zone] ?? 150;
    const total = subtotal + deliveryFee;
    const orderCode = generateOrderCode();

    const orderId = await db.transaction(async (tx) => {
      let customerId = null;
      if (phone) {
        await tx.run(`
          INSERT INTO customers (name, phone) VALUES (?, ?)
          ON CONFLICT(phone) DO UPDATE SET name = excluded.name
        `, [customer_name || null, phone]);
        const customerRow = await tx.get('SELECT id FROM customers WHERE phone = ?', [phone]);
        customerId = customerRow.id;
      }

      const orderResult = await tx.run(`
        INSERT INTO orders (order_code, customer_id, delivery_zone, delivery_fee, delivery_address, phone, subtotal, vat_total, total, status, payment_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')
      `, [orderCode, customerId, delivery_zone || null, deliveryFee, delivery_address || null, phone, subtotal, vatTotal, total]);

      const newOrderId = orderResult.lastInsertRowid;

      for (const oi of orderItems) {
        await tx.run(`
          INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty)
          VALUES (?, ?, ?, ?, ?)
        `, [newOrderId, oi.product.id, oi.product.name, oi.unit_price, oi.qty]);

        await tx.run('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?', [oi.qty, oi.product.id]);
      }

      return newOrderId;
    });

    // --- M-Pesa payment trigger goes here ---
    // This is intentionally last in the build order. Once Daraja credentials
    // are confirmed reusable, call the STK push here, e.g.:
    //
    //   const stk = await triggerMpesaStkPush({ phone, amount: total, accountRef: orderCode });
    //
    // The Daraja callback (a separate route, see routes/mpesa.js placeholder)
    // will then update payment_status to 'paid' and mpesa_receipt once confirmed.

    res.status(201).json({
      order_id: orderId,
      order_code: orderCode,
      subtotal,
      vat_total: vatTotal,
      delivery_fee: deliveryFee,
      total,
      payment_status: 'unpaid',
      message: 'Order created. Payment step will be wired up once M-Pesa integration is added.',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET /api/orders — list orders (staff only)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM orders';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// GET /api/orders/:id — single order with items
router.get('/:id', async (req, res) => {
  try {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
    res.json({ ...order, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load order' });
  }
});

// PUT /api/orders/:id/status — update order status (staff only, e.g. mark fulfilled/delivered)
router.put('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'paid', 'fulfilled', 'delivered', 'cancelled'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });
    }
    const result = await db.run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

module.exports = router;
