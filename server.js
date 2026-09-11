// server.js
// Entry point for the Uchumi Supermarkets backend.
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const db = require('./db/db');
const { seedProducts, seedBranches, ensureDefaultAdmin } = require('./db/seed');

const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');
const branchesRouter = require('./routes/branches');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'uchumi-backend' });
});

app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/branches', branchesRouter);

// --- M-Pesa routes go here once credentials are confirmed reusable ---
// app.use('/api/mpesa', require('./routes/mpesa'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

async function start() {
  // Creates tables if they don't exist yet, and runs any needed safety migrations.
  // Safe to call every boot — CREATE TABLE IF NOT EXISTS never touches existing data.
  await db.initSchema();

  // Auto-seed products on first boot only — never re-runs once products exist,
  // so admin edits to price/stock are never silently overwritten on restart.
  const productCountRow = await db.get('SELECT COUNT(*) AS n FROM products');
  if (productCountRow.n === 0) {
    console.log('Database is empty — running initial product seed...');
    await seedProducts();
  }

  // Safe to call every boot — only inserts branches that don't already exist
  // (ON CONFLICT DO UPDATE on name), so admin edits to branch GPS/address
  // made via the dashboard are never overwritten by this.
  const branchCountRow = await db.get('SELECT COUNT(*) AS n FROM branches');
  if (branchCountRow.n === 0) {
    console.log('No branches found — seeding default branches...');
    await seedBranches();
  }

  // Safe to call every boot — only creates an admin account if none exists yet.
  await ensureDefaultAdmin();

  app.listen(PORT, () => {
    console.log(`Uchumi backend running on http://localhost:${PORT}`);
    console.log(process.env.TURSO_DATABASE_URL
      ? 'Connected to Turso — data persists across restarts and deploys.'
      : 'No TURSO_DATABASE_URL set — using a local file. This will NOT persist on Render redeploys.');
  });
}

start().catch(e => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
