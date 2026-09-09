// db/db.js
// Single SQLite database file — this is the source of truth for the whole store.
// Swappable for PostgreSQL/MySQL later without changing the route logic much,
// since queries are kept simple and centralized here.

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'uchumi.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  unit TEXT,
  price INTEGER NOT NULL,           -- stored in whole KES to avoid float rounding issues
  original_price INTEGER,           -- optional, for "deals" / sale pricing
  category_id INTEGER REFERENCES categories(id),
  image_url TEXT,
  vat_rate INTEGER NOT NULL DEFAULT 0,  -- 0 or 16 (percent)
  description TEXT,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT UNIQUE,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending -> paid -> fulfilled -> delivered / cancelled
  delivery_zone TEXT,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  delivery_address TEXT,
  phone TEXT,
  subtotal INTEGER NOT NULL,
  vat_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_method TEXT DEFAULT 'mpesa',
  mpesa_receipt TEXT,               -- filled in once M-Pesa integration is added
  payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid -> paid -> failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,     -- snapshot, in case product name changes later
  unit_price INTEGER NOT NULL,    -- snapshot of price at time of order
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`);

module.exports = db;
