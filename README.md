# Uchumi Supermarkets — Backend

A standalone backend for the online store: products, orders, customers, stock,
and basic reporting. Built with Node.js, Express, and SQLite (via
`better-sqlite3`). No dependency on Odoo or any other external system.

## Getting started

### Option A — no install, run it in the browser (Replit)

1. Go to [replit.com](https://replit.com) and create a free account
2. Create a new Repl → "Import from upload" (or drag this whole `uchumi-backend`
   folder in)
3. Click **Run** — Replit installs dependencies, seeds the database
   automatically on first boot, and starts the server
4. Replit gives you a public URL (something like
   `https://uchumi-backend.yourname.repl.co`) — use that instead of
   `localhost:4000` everywhere below

### Option B — run it on your own computer

Requires [Node.js](https://nodejs.org) installed first.

```bash
npm install
npm start         # database is created and seeded automatically on first run
```

Check it's running:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/products
```

The database seeds itself automatically the first time the server starts —
no separate seed step needed. If you ever want to reset it back to the
original sample data, delete `db/uchumi.sqlite` and restart the server (or
run `npm run seed` directly).

## What's included

- **`db/db.js`** — database schema (categories, products, customers, orders, order_items)
- **`db/seed.js`** — loads the 18 real products already validated in the front-end prototype
- **`routes/products.js`** — list/search products, get one, create/update (admin)
- **`routes/orders.js`** — create an order from a cart, list/view orders, update status
- **`routes/admin.js`** — dashboard summary, low-stock report, sales by category, top products

## API quick reference

| Method | Endpoint                          | Purpose                              |
|--------|------------------------------------|---------------------------------------|
| GET    | `/api/products`                    | List products (`?category=`, `?q=`)  |
| GET    | `/api/products/:id`                | Single product                        |
| Method | Endpoint                          | Purpose                              | Auth required |
|--------|------------------------------------|---------------------------------------|:---:|
| POST   | `/api/auth/login`                  | Staff login, returns a JWT token      | — |
| GET    | `/api/auth/me`                     | Confirm a token is still valid        | ✅ |
| POST   | `/api/auth/change-password`        | Change your own password              | ✅ |
| GET    | `/api/products`                    | List products (`?category=`, `?q=`)  | — |
| GET    | `/api/products/:id`                | Single product                        | — |
| GET    | `/api/products/meta/categories`    | List categories                       | — |
| POST   | `/api/products`                    | Create product                        | ✅ |
| PUT    | `/api/products/:id`                | Update product                        | ✅ |
| POST   | `/api/orders`                      | Create an order (checkout)            | — |
| GET    | `/api/orders`                      | List orders (`?status=`)             | ✅ |
| GET    | `/api/orders/:id`                  | Single order with items               | — ⚠️ see note below |
| PUT    | `/api/orders/:id/status`           | Update order status                   | ✅ |
| GET    | `/api/admin/summary`               | Dashboard headline numbers            | ✅ |
| GET    | `/api/admin/low-stock`             | Products at/below stock threshold     | ✅ |
| GET    | `/api/admin/sales-by-category`     | Revenue breakdown by category         | ✅ |
| GET    | `/api/admin/top-products`          | Best sellers by units sold            | ✅ |

**⚠️ Known gap:** `GET /api/orders/:id` is currently left open (no login required)
so a future "track my order" feature could use it without needing customer
accounts. The downside: order IDs are sequential, so someone could guess
other customers' order numbers and see their phone/address. Fine for now
while this is still in development — but tighten this (e.g. require the
order code *and* phone number to match) before real customers use it.

## Authentication

A default staff login is created automatically the first time the server starts:

- **Username:** `admin` (or whatever you set as `ADMIN_USERNAME` in `.env`)
- **Password:** `ChangeMe123!` (or whatever you set as `ADMIN_PASSWORD` in `.env`)

**Change this password after your first login** — call
`POST /api/auth/change-password` with your current and new password, or ask
me to add a "change password" screen to the dashboard.

Login returns a JWT token valid for 12 hours. The admin dashboard handles
this automatically — you just log in through its login screen.

## Next steps (in the order we agreed)

1. ✅ Backend + database — **done**
2. ✅ Admin dashboard UI — **done**
3. ✅ Authentication — **done, this is it**
4. **Import the full ~3,000 SKU catalog** — replace/extend `db/seed.js`, or build a CSV import script
5. **Connect the front-end prototype to this backend** — replace the mock `cart`/`renderCart()` JS logic with real `fetch()` calls to these endpoints
6. **Add M-Pesa last** — a new `routes/mpesa.js` that:
   - Calls Safaricom's Daraja STK Push API using the credentials confirmed reusable from Odoo (see `.env.example`)
   - Exposes a callback endpoint Safaricom calls once the customer approves payment, which updates `orders.payment_status` and `orders.mpesa_receipt`

## Before going live

- **Set a real `JWT_SECRET`** in `.env` — a long random string, not the default placeholder.
- **Change the default admin password** immediately after first login.
- **Tighten the `GET /api/orders/:id` gap** noted above.
- **Move off SQLite to PostgreSQL** if you expect high concurrent traffic — SQLite is genuinely fine for a single-store setup at moderate volume, but Postgres is the safer default at real e-commerce scale.
- **Host this somewhere persistent** — Render, Railway, or a small VPS. This backend needs to run continuously, unlike the static front-end file.
