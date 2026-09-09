// server.js
// Entry point for the Uchumi Supermarkets backend.
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const db = require('./db/db');
const { seedProducts, ensureDefaultAdmin } = require('./db/seed');

const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 4000;

// Auto-seed products on first boot only — never re-runs once products exist,
// so admin edits to price/stock are never silently overwritten on restart.
const productCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (productCount === 0) {
  console.log('Database is empty — running initial product seed...');
  seedProducts();
}

// Safe to call every boot — only creates an admin account if none exists yet.
ensureDefaultAdmin();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'uchumi-backend' });
});

app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);

// --- M-Pesa routes go here once credentials are confirmed reusable ---
// app.use('/api/mpesa', require('./routes/mpesa'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Uchumi backend running on http://localhost:${PORT}`);
});
