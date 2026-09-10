// db/seed.js
// Populates the database with starting categories and the real products
// already validated in the front-end prototype. Safe to re-run — it clears
// and re-inserts rather than duplicating.
//
// Run with: npm run seed

const bcrypt = require('bcryptjs');
const db = require('./db');

const CATEGORIES = ['Staples', 'Fresh produce', 'Dairy', 'Cleaning', 'Household', 'Snacks'];

const PRODUCTS = [
  { name: 'Jogoo Maize Meal', code: '155303600', unit: '2kg', price: 160, original_price: 180, category: 'Staples', vat_rate: 0, stock_qty: 120, description: 'Fortified maize flour milled to Grade 1 standard — the everyday base for ugali and porridge in most Kenyan homes.' },
  { name: 'Sunrice Basmati', code: '164692', unit: '5kg', price: 1530, category: 'Staples', vat_rate: 0, stock_qty: 60, description: 'Long-grain aromatic basmati rice, ideal for pilau, biryani, and everyday plain rice dishes.' },
  { name: 'Fresh Fri Veg Cooking Oil', code: '187765', unit: '5L', price: 1599, original_price: 1750, category: 'Staples', vat_rate: 16, stock_qty: 45, description: 'Cholesterol-free vegetable cooking oil fortified with Vitamin E — suitable for frying, cooking, and baking.' },
  { name: 'Kabras Sugar', code: '172558', unit: '2kg', price: 311, category: 'Staples', vat_rate: 0, stock_qty: 90, description: 'Refined white sugar for tea, baking, and everyday cooking.' },
  { name: 'H/Crust Wholemeal Bread', code: '154124700', unit: '400g', price: 60, category: 'Staples', vat_rate: 0, stock_qty: 80, description: 'Sliced wholemeal bread, a fibre-rich choice for breakfast sandwiches and toast.' },

  { name: 'Sukuma Wiki', code: '2700170', unit: '500g bunch', price: 40, original_price: 50, category: 'Fresh produce', vat_rate: 0, stock_qty: 150, description: 'Fresh collard greens (kale), a Kenyan kitchen staple typically fried with onions and tomatoes as a side dish.' },
  { name: 'Tomatoes', code: '2800130', unit: '1kg', price: 120, original_price: 140, category: 'Fresh produce', vat_rate: 0, stock_qty: 100, description: 'Fresh ripe tomatoes, essential for stews, salads, and everyday cooking.' },
  { name: 'Red Onions', code: '2800350', unit: '1kg', price: 140, original_price: 160, category: 'Fresh produce', vat_rate: 0, stock_qty: 100, description: 'Fresh red onions used as a base for most Kenyan stews and sauces.' },
  { name: 'Kampala Bananas', code: '2802900', unit: '1kg', price: 105, category: 'Fresh produce', vat_rate: 0, stock_qty: 70, description: 'Sweet dessert bananas, ready to eat as a snack or use in baking and smoothies.' },

  { name: 'Brookside Dairy Best Milk', code: '113679', unit: '500ml', price: 63, category: 'Dairy', vat_rate: 0, stock_qty: 200, description: 'UHT whole milk with 3.5% butterfat, no refrigeration needed until opened — great for tea, cereal, and cooking.' },
  { name: 'Delamere Vanilla Yoghurt', code: '222314', unit: '450ml', price: 180, category: 'Dairy', vat_rate: 16, stock_qty: 55, description: 'Creamy vanilla-flavoured yoghurt with real vanilla pods, a wholesome snack or breakfast addition.' },
  { name: 'Egg', code: '168450', unit: '1 piece', price: 18, category: 'Dairy', vat_rate: 0, stock_qty: 500, description: 'Fresh chicken egg, a versatile protein source for breakfast, baking, and cooking.' },

  { name: 'Menengai Cream Bar Soap', code: '135431700', unit: '1kg', price: 219, category: 'Cleaning', vat_rate: 16, stock_qty: 75, description: 'Quality bar soap with glycerin and super power foam for effective everyday hand and body washing.' },
  { name: 'Sunlight 2in1 Quad Pack', code: '155790', unit: '3.5kg', price: 1295, original_price: 1450, category: 'Cleaning', vat_rate: 16, stock_qty: 30, description: '2-in-1 hand wash powder for laundry — cleans and cares for fabric in one wash.' },

  { name: 'Tena White Toilet Paper', code: '135203500', unit: '10s', price: 550, original_price: 600, category: 'Household', vat_rate: 16, stock_qty: 40, description: 'Soft, strong 2-ply toilet paper for everyday household use.' },
  { name: 'Keringet Mineral Water', code: '150314900', unit: '1L', price: 95, category: 'Household', vat_rate: 16, stock_qty: 150, description: 'Natural still mineral water, bottled for everyday hydration.' },

  { name: 'Tropical Heat Tomato Crisps', code: '164162', unit: '100g', price: 115, category: 'Snacks', vat_rate: 16, stock_qty: 90, description: 'Crunchy tomato-flavoured potato crisps, a popular snack for any time of day.' },
  { name: 'McVities Original Digestive', code: '205939218', unit: '250g', price: 305, category: 'Snacks', vat_rate: 16, stock_qty: 65, description: 'Classic wheat digestive biscuits, a source of fibre, perfect with tea or on their own.' },
];

function seedProducts() {
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  const getCategoryId = db.prepare('SELECT id FROM categories WHERE name = ?');
  const insertProduct = db.prepare(`
    INSERT INTO products (name, code, unit, price, original_price, category_id, vat_rate, description, stock_qty)
    VALUES (@name, @code, @unit, @price, @original_price, @category_id, @vat_rate, @description, @stock_qty)
    ON CONFLICT(code) DO UPDATE SET
      name=excluded.name, unit=excluded.unit, price=excluded.price,
      original_price=excluded.original_price, category_id=excluded.category_id,
      vat_rate=excluded.vat_rate, description=excluded.description, stock_qty=excluded.stock_qty
  `);

  const seed = db.transaction(() => {
    for (const name of CATEGORIES) insertCategory.run(name);

    for (const p of PRODUCTS) {
      const cat = getCategoryId.get(p.category);
      insertProduct.run({
        name: p.name,
        code: p.code,
        unit: p.unit,
        price: p.price,
        original_price: p.original_price || null,
        category_id: cat.id,
        vat_rate: p.vat_rate,
        description: p.description,
        stock_qty: p.stock_qty,
      });
    }
  });

  seed();
  console.log(`Seed complete: ${CATEGORIES.length} categories, ${PRODUCTS.length} products.`);
}

// Creates a default admin login only if no admin user exists yet.
// Safe to call on every server boot — never overwrites an existing account
// or a password that's already been changed.
function ensureDefaultAdmin() {
  const existingAdmin = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
  if (existingAdmin) return;

  const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
  const defaultPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)').run(defaultUsername, hash, 'admin');
  console.log(`Created default admin login — username: "${defaultUsername}", password: "${defaultPassword}"`);
  console.log('IMPORTANT: change this password after your first login.');
}

function runSeed() {
  seedProducts();
  ensureDefaultAdmin();
}

// Only auto-run when executed directly (`npm run seed`).
// When required as a module (server.js auto-seed check), it just exports the functions.
if (require.main === module) {
  runSeed();
}

module.exports = { runSeed, seedProducts, ensureDefaultAdmin };
