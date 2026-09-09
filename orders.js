// routes/orders.js
const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

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
router.post('/', (req, res) => {
  const { items, delivery_zone, delivery_address, phone, customer_name } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must include at least one item' });
  }
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1');
  const orderItems = [];
  let subtotal = 0;
  let vatTotal = 0;

  for (const item of items) {
    const product = getProduct.get(item.product_id);
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

  const createOrder = db.transaction(() => {
    let customerId = null;
    if (phone) {
      const upsertCustomer = db.prepare(`
        INSERT INTO customers (name, phone) VALUES (?, ?)
        ON CONFLICT(phone) DO UPDATE SET name = excluded.name
      `);
      upsertCustomer.run(customer_name || null, phone);
      customerId = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone).id;
    }

    const orderResult = db.prepare(`
      INSERT INTO orders (order_code, customer_id, delivery_zone, delivery_fee, delivery_address, phone, subtotal, vat_total, total, status, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')
    `).run(orderCode, customerId, delivery_zone || null, deliveryFee, delivery_address || null, phone, subtotal, vatTotal, total);

    const orderId = orderResult.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty)
      VALUES (?, ?, ?, ?, ?)
    `);
    const decrementStock = db.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?');

    for (const oi of orderItems) {
      insertItem.run(orderId, oi.product.id, oi.product.name, oi.unit_price, oi.qty);
      decrementStock.run(oi.qty, oi.product.id);
    }

    return orderId;
  });

  const orderId = createOrder();

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
});

// GET /api/orders — list orders (staff only)
router.get('/', requireAuth, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM orders';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/orders/:id — single order with items
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ ...order, items });
});

// PUT /api/orders/:id/status — update order status (staff only, e.g. mark fulfilled/delivered)
router.put('/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'paid', 'fulfilled', 'delivered', 'cancelled'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });
  }
  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
  res.json({ updated: true });
});

module.exports = router;
