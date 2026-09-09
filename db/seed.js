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
  { name: 'Red Onions', code: '2800350', unit: '1kg', price: 140, original_price: 160, category: 'Fresh produce', vat_rate: 0, stock_qty: 100,
