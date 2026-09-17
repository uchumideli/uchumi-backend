// db/db.js
// Database layer using Turso (libSQL) — a hosted, SQLite-compatible database
// with a genuinely persistent free tier. This is the fix for the problem where
// Render's free web service wipes its local filesystem on every deploy.
//
// Locally (no TURSO_DATABASE_URL set), this same client falls back to a local
// SQLite file automatically, so development/testing works exactly the same
// way it always did — no separate code path needed.

const path = require('path');
const { createClient } = require('@libsql/client');

const LOCAL_DB_PATH = path.join(__dirname, 'uchumi.sqlite');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${LOCAL_DB_PATH}`,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

// ---- small async helpers so route files stay close to how they read before ----

async function get(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows[0] || null;
}

async function all(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows;
}

async function run(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return { lastInsertRowid: Number(rs.lastInsertRowid), changes: rs.rowsAffected };
}

// Runs a group of statements atomically. `fn` receives a `tx` object with the
// same get/all/run shape as above, scoped to the transaction.
async function transaction(fn) {
  const tx = await client.transaction('write');
  const txHelpers = {
    get: async (sql, args = []) => {
      const rs = await tx.execute({ sql, args });
      return rs.rows[0] || null;
    },
    all: async (sql, args = []) => {
      const rs = await tx.execute({ sql, args });
      return rs.rows;
    },
    run: async (sql, args = []) => {
      const rs = await tx.execute({ sql, args });
      return { lastInsertRowid: Number(rs.lastInsertRowid), changes: rs.rowsAffected };
    },
  };
  try {
    const result = await fn(txHelpers);
    await tx.commit();
    return result;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function initSchema() {
  await client.execute('PRAGMA foreign_keys = ON');

  const statements = [
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      unit TEXT,
      price INTEGER NOT NULL,
      original_price INTEGER,
      category_id INTEGER REFERENCES categories(id),
      image_url TEXT,
      vat_rate INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT UNIQUE,
      email TEXT,
      date_of_birth TEXT,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      status TEXT NOT NULL DEFAULT 'pending',
      delivery_zone TEXT,
      delivery_fee INTEGER NOT NULL DEFAULT 0,
      delivery_address TEXT,
      phone TEXT,
      subtotal INTEGER NOT NULL,
      vat_total INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      payment_method TEXT DEFAULT 'mpesa',
      mpesa_receipt TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      qty INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      address TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS promo_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT NOT NULL,
      title TEXT,
      link_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      placement TEXT NOT NULL DEFAULT 'grid',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }

  // Safety migration for databases created before role/is_active existed.
  const cols = await client.execute("PRAGMA table_info(admin_users)");
  const colNames = cols.rows.map(c => c.name);
  if (!colNames.includes('role')) {
    await client.execute("ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff'");
    await client.execute("UPDATE admin_users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM admin_users)");
  }
  if (!colNames.includes('is_active')) {
    await client.execute('ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }

  // branch_id on products: NULL means "available at every branch" (this is
  // how all existing products behave). A specific branch_id means the
  // product only shows up when that branch is selected.
  const productCols = await client.execute("PRAGMA table_info(products)");
  const productColNames = productCols.rows.map(c => c.name);
  if (!productColNames.includes('branch_id')) {
    await client.execute('ALTER TABLE products ADD COLUMN branch_id INTEGER REFERENCES branches(id)');
  }
  // is_draft: set on newly bulk-imported products so they land in a staging
  // area instead of appearing on the storefront right away. An admin reviews
  // each one (adds a photo, confirms quantity/branch) then publishes it,
  // which clears this flag and sets is_active. Existing/manually-added
  // products default to 0 (never drafts) so nothing already live is affected.
  if (!productColNames.includes('is_draft')) {
    await client.execute('ALTER TABLE products ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0');
  }

  // Delivery-related columns on orders: which branch fulfilled it, the
  // customer's coordinates at checkout, and the distance used to price it.
  const orderCols = await client.execute("PRAGMA table_info(orders)");
  const orderColNames = orderCols.rows.map(c => c.name);
  if (!orderColNames.includes('branch_id')) {
    await client.execute('ALTER TABLE orders ADD COLUMN branch_id INTEGER REFERENCES branches(id)');
  }
  if (!orderColNames.includes('customer_lat')) {
    await client.execute('ALTER TABLE orders ADD COLUMN customer_lat REAL');
  }
  if (!orderColNames.includes('customer_lng')) {
    await client.execute('ALTER TABLE orders ADD COLUMN customer_lng REAL');
  }
  if (!orderColNames.includes('distance_km')) {
    await client.execute('ALTER TABLE orders ADD COLUMN distance_km REAL');
  }

  // placement on promo_banners: existing banners created before this column
  // existed default to 'grid' (their original behavior — ad slots inside the
  // product listing). New 'hero' banners appear in the top carousel instead.
  const bannerCols = await client.execute("PRAGMA table_info(promo_banners)");
  const bannerColNames = bannerCols.rows.map(c => c.name);
  if (!bannerColNames.includes('placement')) {
    await client.execute("ALTER TABLE promo_banners ADD COLUMN placement TEXT NOT NULL DEFAULT 'grid'");
  }

  // Customer accounts: registration fields added on top of the original
  // lightweight "captured at checkout" customer record. Existing customer
  // rows (from guest checkouts before this feature existed) simply have
  // these as NULL — they're not registered accounts, just delivery contacts.
  const customerCols = await client.execute("PRAGMA table_info(customers)");
  const customerColNames = customerCols.rows.map(c => c.name);
  for (const col of ['first_name', 'last_name', 'date_of_birth', 'password_hash']) {
    if (!customerColNames.includes(col)) {
      await client.execute(`ALTER TABLE customers ADD COLUMN ${col} TEXT`);
    }
  }
  // Unique index on email so two accounts can't register with the same
  // address — safe to add even with existing data, since old guest-checkout
  // rows all have a NULL email (SQLite allows multiple NULLs in a unique index).
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers(email)');

  // Forgot-password: a one-time token emailed to the customer, with an
  // expiry so an old, unused reset link can't be used indefinitely.
  if (!customerColNames.includes('reset_token')) {
    await client.execute('ALTER TABLE customers ADD COLUMN reset_token TEXT');
  }
  if (!customerColNames.includes('reset_token_expires')) {
    await client.execute('ALTER TABLE customers ADD COLUMN reset_token_expires TEXT');
  }

  // Staff/admin profile fields: phone, national ID, first/last name, email.
  // Existing accounts (like the default admin created from env vars) simply
  // have these as NULL until someone fills them in via the dashboard —
  // nothing about logging in with username/password changes.
  const staffCols = await client.execute("PRAGMA table_info(admin_users)");
  const staffColNames = staffCols.rows.map(c => c.name);
  for (const col of ['first_name', 'last_name', 'phone', 'national_id', 'email', 'reset_token', 'reset_token_expires']) {
    if (!staffColNames.includes(col)) {
      await client.execute(`ALTER TABLE admin_users ADD COLUMN ${col} TEXT`);
    }
  }
  // Unique index on email, same reasoning as customers — old accounts
  // without an email are all NULL, which SQLite allows multiple of.
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email)');

  // branch_id on staff: NULL means "super-admin — not tied to one branch,
  // sees and manages everything." A specific branch_id scopes a
  // 'branch_admin' or 'staff' account to that one branch for the purposes
  // of who they can manage. It does NOT restrict which orders they can see —
  // order visibility stays open to any logged-in staff account, by design.
  if (!staffColNames.includes('branch_id')) {
    await client.execute('ALTER TABLE admin_users ADD COLUMN branch_id INTEGER REFERENCES branches(id)');
  }
}

module.exports = { client, get, all, run, transaction, initSchema };
