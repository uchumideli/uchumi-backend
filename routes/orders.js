// routes/orders.js
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { attachCustomerIfPresent, requireCustomerAuth } = require('./customer-auth');

const router = express.Router();

function generateOrderCode() {
  const n = Math.floor(100000 + Math.random() * 899999);
  return `UCH${n}`;
}

const KES_PER_KM = 50;

// 2-hour delivery windows, 8am to 10pm, matching what the storefront offers.
const VALID_DELIVERY_SLOTS = [
  '08:00-10:00', '10:00-12:00', '12:00-14:00', '14:00-16:00',
  '16:00-18:00', '18:00-20:00', '20:00-22:00',
];

// Nairobi is a fixed UTC+3 with no daylight saving, so this stays correct
// year-round without needing a timezone library.
function nairobiNow() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}

// A slot is only valid if it's one of the real options AND its end time
// hasn't already passed today, in Nairobi time — the same rule the
// storefront uses to gray out past slots, enforced again here so nobody
// can bypass that by calling the API directly.
function isSlotStillAvailable(slot) {
  if (!VALID_DELIVERY_SLOTS.includes(slot)) return false;
  const [, endTime] = slot.split('-');
  const [endHour, endMin] = endTime.split(':').map(Number);
  const now = nairobiNow();
  const slotEndMinutes = endHour * 60 + endMin;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMinutes <= slotEndMinutes;
}

// Straight-line ("as the crow flies") distance between two GPS points, in km.
// Not actual driving distance — that would require a paid mapping API.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// POST /api/orders — create a new order from the cart
// Body: { items: [{product_id, qty}], branch_id, customer_lat, customer_lng, delivery_address, phone, customer_name, delivery_slot }
router.post('/', attachCustomerIfPresent, async (req, res) => {
  try {
    const { items, branch_id, customer_lat, customer_lng, delivery_address, phone, customer_name, delivery_slot } = req.body;

    if (delivery_slot && !isSlotStillAvailable(delivery_slot)) {
      return res.status(400).json({ error: 'That delivery time has already passed — please choose another slot.' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must include at least one item' });
    }
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    if (!branch_id) {
      return res.status(400).json({ error: 'A branch must be selected' });
    }
    if (customer_lat == null || customer_lng == null) {
      return res.status(400).json({ error: 'Customer location (GPS) is required to calculate delivery' });
    }

    const branch = await db.get('SELECT * FROM branches WHERE id = ?', [branch_id]);
    if (!branch) {
      return res.status(400).json({ error: 'Selected branch not found' });
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
        // A lost sale is still useful information — log it so staff can see
        // what customers actually wanted to buy but couldn't.
        db.run(
          `INSERT INTO stock_alerts (product_id, product_name, requested_qty, available_qty, branch_id, customer_phone)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [product.id, product.name, item.qty, product.stock_qty, branch_id || null, phone || null]
        ).catch(e => console.error('Failed to log stock alert:', e));
        return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
      }
      const lineTotal = product.price * item.qty;
      subtotal += lineTotal;
      if (product.vat_rate > 0) {
        vatTotal += Math.round(lineTotal * product.vat_rate / (100 + product.vat_rate));
      }
      orderItems.push({ product, qty: item.qty, unit_price: product.price });
    }

    const distanceKm = haversineKm(branch.latitude, branch.longitude, customer_lat, customer_lng);
    const deliveryFee = Math.max(0, Math.round(distanceKm * KES_PER_KM));
    const total = subtotal + deliveryFee;
    const orderCode = generateOrderCode();

    const orderId = await db.transaction(async (tx) => {
      let customerId = null;
      if (req.customer) {
        // Logged-in customer — link the order to their real account directly.
        customerId = req.customer.id;
      } else if (phone) {
        await tx.run(`
          INSERT INTO customers (name, phone) VALUES (?, ?)
          ON CONFLICT(phone) DO UPDATE SET name = excluded.name
        `, [customer_name || null, phone]);
        const customerRow = await tx.get('SELECT id FROM customers WHERE phone = ?', [phone]);
        customerId = customerRow.id;
      }

      const orderResult = await tx.run(`
        INSERT INTO orders (order_code, customer_id, branch_id, customer_lat, customer_lng, distance_km, delivery_fee, delivery_address, phone, subtotal, vat_total, total, delivery_slot, status, payment_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')
      `, [orderCode, customerId, branch_id, customer_lat, customer_lng, distanceKm, deliveryFee, delivery_address || null, phone, subtotal, vatTotal, total, delivery_slot || null]);

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
      distance_km: Math.round(distanceKm * 10) / 10,
      branch_name: branch.name,
      delivery_slot: delivery_slot || null,
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
    let sql = `
      SELECT o.*, b.name AS branch_name
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
    `;
    const params = [];
    if (status) {
      sql += ' WHERE o.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY o.created_at DESC';
    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// GET /api/orders/mine — a logged-in customer's own order history.
// Must be defined before GET /:id so "mine" doesn't get mistaken for an order id.
router.get('/mine', attachCustomerIfPresent, requireCustomerAuth, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT o.*, b.name AS branch_name
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.customer_id = ?
      ORDER BY o.created_at DESC
    `, [req.customer.id]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load your orders' });
  }
});

// GET /api/orders/:id — single order with items
router.get('/:id', async (req, res) => {
  try {
    const order = await db.get(`
      SELECT o.*, b.name AS branch_name, c.name AS customer_full_name, c.email AS customer_email
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ?
    `, [req.params.id]);
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
