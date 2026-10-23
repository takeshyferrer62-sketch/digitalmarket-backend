/**
 * ============================================================================
 * 🌌 DIGITALMARKET - SERVIDOR MAESTRO SEGURO (V8)
 * ============================================================================
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(process.cwd(), 'digitalmarket_api.db');

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH);

const BOT_TOKEN = process.env.BOT_TOKEN || '8743289252:AAFkSdl8O8VtQlvkRpnvHbwZShApI65XSNw';
const OFFICIAL_CHANNEL_URL = process.env.OFFICIAL_CHANNEL_URL || 'https://t.me/DigitalMarketOfertas';
const CHANNEL_ID = process.env.CHANNEL_ID || '-1004310833438';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://digitalmarket-mini-app.vercel.app';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1bbUrb5xAxO5I29gnCWq_kFNioXIjQQXxyrWbyncpIhA'; 

// Credenciales Bybit API V5
const BYBIT_API_KEY = process.env.BYBIT_API_KEY || 'A0jigK3XHeIDOVkGgr';
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET || 'xvBwjKohgZ8pKcz7Dac5zzBfLN2D8yPK6whx';
const BYBIT_BASE_URL = 'https://api.bybit.com';

const SCHEMA_SQL = `
PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    full_name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    payment_method TEXT,
    membership_plan TEXT NOT NULL DEFAULT 'FREE',
    membership_expires_at TEXT,
    marketing_opt_in INTEGER NOT NULL DEFAULT 1,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    referred_by INTEGER,
    referral_code TEXT UNIQUE,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    loyalty_points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
    discount_code TEXT
);
CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    UNIQUE(cart_id, product_id)
);
CREATE TABLE IF NOT EXISTS discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    percent_off INTEGER NOT NULL,
    min_items INTEGER NOT NULL DEFAULT 2,
    max_uses INTEGER NOT NULL DEFAULT 1000,
    used_count INTEGER NOT NULL DEFAULT 0,
    festival_name TEXT NOT NULL,
    valid_months TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    discount_code TEXT,
    shipping_status TEXT NOT NULL DEFAULT 'PREPARANDO_ENVIO',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    provider TEXT NOT NULL,
    provider_tx_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    amount_cents INTEGER NOT NULL,
    txid_proof TEXT
);
CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

db.exec(SCHEMA_SQL);

// Migraciones seguras en bloques try/catch independientes
const safeAddColumn = (sql) => {
  try { db.exec(sql); } catch (e) {}
};

safeAddColumn("ALTER TABLE users ADD COLUMN phone TEXT;");
safeAddColumn("ALTER TABLE users ADD COLUMN address TEXT;");
safeAddColumn("ALTER TABLE users ADD COLUMN payment_method TEXT;");
safeAddColumn("ALTER TABLE users ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0;");
safeAddColumn("ALTER TABLE users ADD COLUMN membership_plan TEXT NOT NULL DEFAULT 'FREE';");
safeAddColumn("ALTER TABLE users ADD COLUMN membership_expires_at TEXT;");
safeAddColumn("ALTER TABLE users ADD COLUMN referral_code TEXT;");

const EXCHANGE_RATES = { RUB: 110.0, CUP: 830.0, MLC: 625.0, CLASICA: 630.0 };

function calculateConversions(centsUSD) {
  const usdVal = centsUSD / 100;
  return {
    RUB: (usdVal * EXCHANGE_RATES.RUB).toFixed(2),
    CUP: (usdVal * EXCHANGE_RATES.CUP).toFixed(2),
    MLC: (usdVal * EXCHANGE_RATES.MLC).toFixed(2),
    CLASICA: (usdVal * EXCHANGE_RATES.CLASICA).toFixed(2)
  };
}

async function fetchProductsFromGoogleSheet() {
  if (!GOOGLE_SHEET_ID) {
    return [
      { id: 1, sku: 'DIG-STR-001', name: '[⭐] Cuenta Netflix (Perfil HD/4K)', description: 'Acceso automatizado.', price_cents: 1550, price_decimal: '15.50', currency: 'USD', product_type: 'DIGITAL', stock: 999, is_active: 1 },
      { id: 2, sku: 'WB-ELE-001', name: '[📦] Smartwatch Deportivo Pro', description: 'Reloj inteligente con monitor cardíaco.', price_cents: 4500, price_decimal: '45.00', currency: 'USD', product_type: 'PHYSICAL', stock: 10, is_active: 1 }
    ];
  }

  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv`;
    const res = await fetch(csvUrl);
    const csvText = await res.text();
    
    const parseCSV = (text) => {
      const lines = text.split('\n');
      return lines.map(line => {
        const row = [];
        let inQuotes = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            row.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        row.push(current.trim());
        return row;
      });
    };

    const rows = parseCSV(csvText);
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    const products = [];

    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      if (!cols || cols.length === 0 || cols[0] === '') continue;

      const p = {};
      headers.forEach((h, index) => {
        p[h] = cols[index] ? cols[index].trim().replace(/^"|"$/g, '') : '';
      });

      const isActive = String(p.is_active || '1').trim();
      if (isActive === '1' || isActive.toLowerCase() === 'true' || isActive === '') {
        products.push({
          id: Number(p.id) || i,
          sku: p.sku || `SKU-${i}`,
          name: p.name || 'Producto sin nombre',
          description: p.description || '',
          price_cents: Number(p.price_cents) || 100,
          price_decimal: p.price_decimal || '1.00',
          currency: 'USD',
          product_type: (p.product_type || 'DIGITAL').toUpperCase(),
          stock: Number(p.stock) || 100,
          is_active: 1
        });
      }
    }
    return products;
  } catch (err) {
    console.error('❌ Error leyendo Google Sheet:', err.message);
    return [];
  }
}

// Endpoints Express
app.post('/api/telegram-webhook', async (req, res) => { res.status(200).json({ ok: true }); });

app.post('/api/users/sync', (req, res) => {
  const { telegramId, fullName, username, refCode } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'telegramId requerido' });

  let referredById = null;
  if (refCode) {
    const referrer = db.prepare("SELECT id FROM users WHERE referral_code = ?").get(refCode);
    if (referrer) referredById = referrer.id;
  }

  const generatedRefCode = `ref_${telegramId}`;
  try {
    db.prepare(`
      INSERT INTO users (telegram_id, username, full_name, referred_by, referral_code) 
      VALUES (?, ?, ?, ?, ?) 
      ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, full_name=excluded.full_name
    `).run(telegramId, username, fullName, referredById, generatedRefCode);
  } catch (err) {}

  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  res.json({ success: true, user });
});

app.post('/api/users/info', (req, res) => {
  const { telegramId, fullName, phone, address, payment } = req.body;
  db.prepare(`UPDATE users SET full_name = ?, phone = ?, address = ?, payment_method = ? WHERE telegram_id = ?`).run(fullName, phone, address, payment, telegramId);
  res.json({ success: true });
});

app.post('/api/wallet/deposit', (req, res) => {
  const { telegramId, amountUSD, paymentMethod, txProof } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const amountCents = Math.round(Number(amountUSD) * 100);
  if (isNaN(amountCents) || amountCents <= 0) return res.status(400).json({ error: 'Monto inválido' });

  db.prepare(`INSERT INTO support_tickets (user_id, subject, message) VALUES (?, ?, ?)`).run(
    user.id, 
    `Recarga de Billetera: $${amountUSD} USD vía ${paymentMethod}`, 
    `Comprobante/TXID: ${txProof || 'Pendiente de confirmación'}`
  );

  res.json({ success: true, message: 'Solicitud de recarga registrada.' });
});

app.post('/api/membership/upgrade', (req, res) => {
  const { telegramId, plan } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const costUSD = plan === 'STANDARD' ? 1.99 : plan === 'PREMIUM' ? 2.99 : 0;
  const costCents = Math.round(costUSD * 100);

  if (user.balance_cents < costCents) {
    return res.status(400).json({ error: 'Saldo insuficiente en tu billetera.' });
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE users SET balance_cents = balance_cents - ?, membership_plan = ?, membership_expires_at = ? WHERE id = ?`).run(costCents, plan, expiresAt, user.id);

  const updatedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
  res.json({ success: true, user: updatedUser });
});

app.post('/api/support', (req, res) => {
  const { telegramId, subject, message } = req.body;
  const user = db.prepare(`SELECT id FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  db.prepare(`INSERT INTO support_tickets (user_id, subject, message) VALUES (?, ?, ?)`).run(user.id, subject, message);
  res.json({ success: true });
});

app.get('/api/products', async (req, res) => {
  const products = await fetchProductsFromGoogleSheet();
  res.json(products.map(p => ({ ...p, price_usd: p.price_decimal, conversions: calculateConversions(p.price_cents) })));
});

app.post('/api/cart/apply-coupon', (req, res) => {
  const { telegramId, code } = req.body;
  const cleanCode = String(code).trim().toUpperCase();
  try {
    const user = db.prepare(`SELECT id FROM users WHERE telegram_id = ?`).get(telegramId);
    const disc = db.prepare(`SELECT * FROM discounts WHERE code = ? AND is_active = 1`).get(cleanCode);
    if (!disc) throw new Error('Cupón inválido');
    let cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id);
    if (!cart) { db.prepare(`INSERT INTO carts (user_id) VALUES (?)`).run(user.id); cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id); }
    db.prepare(`UPDATE carts SET discount_code = ? WHERE id = ?`).run(cleanCode, cart.id);
    res.json({ success: true, discount: disc });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/cart/:telegramId', async (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(req.params.telegramId);
  if (!user) return res.json({ items: [], subtotalCents: 0, totalCents: 0 });
  let cart = db.prepare(`SELECT * FROM carts WHERE user_id = ?`).get(user.id);
  if (!cart) { db.prepare(`INSERT INTO carts (user_id) VALUES (?)`).run(user.id); cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id); }

  const cartItems = db.prepare(`SELECT product_id, quantity FROM cart_items WHERE cart_id = ?`).all(cart.id);
  const allProducts = await fetchProductsFromGoogleSheet();

  const items = [];
  let subtotalCents = 0;
  for (const ci of cartItems) {
    const prod = allProducts.find(p => p.id === ci.product_id);
    if (prod) {
      subtotalCents += prod.price_cents * ci.quantity;
      items.push({
        product_id: prod.id,
        name: prod.name,
        price_cents: prod.price_cents,
        price_decimal: prod.price_decimal,
        quantity: ci.quantity,
        total_usd: (prod.price_cents * ci.quantity / 100).toFixed(2),
        conversions: calculateConversions(prod.price_cents * ci.quantity)
      });
    }
  }

  let discountCents = 0;
  let totalItems = items.reduce((acc, i) => acc + i.quantity, 0);

  if (cart.discount_code) {
    const disc = db.prepare(`SELECT percent_off, min_items FROM discounts WHERE code = ?`).get(cart.discount_code);
    if (disc && totalItems >= disc.min_items) discountCents = Math.floor((subtotalCents * disc.percent_off) / 100);
  }

  const subtotalAfterCoupon = Math.max(0, subtotalCents - discountCents);
  let walletIncentiveCents = 0;
  if (user.membership_plan === 'STANDARD') {
    walletIncentiveCents = Math.floor(subtotalAfterCoupon * 0.005);
  } else if (user.membership_plan === 'PREMIUM') {
    walletIncentiveCents = Math.floor(subtotalAfterCoupon * 0.012);
  }

  const totalCentsWallet = Math.max(0, subtotalAfterCoupon - walletIncentiveCents);

  res.json({
    items,
    subtotalCents,
    totalUSD: (totalCentsWallet / 100).toFixed(2),
    walletTotalCents: totalCentsWallet,
    discountUSD: (discountCents / 100).toFixed(2),
    walletDiscountUSD: (walletIncentiveCents / 100).toFixed(2),
    discountCode: cart.discount_code,
    conversions: calculateConversions(totalCentsWallet),
    totalItems,
    membershipPlan: user.membership_plan
  });
});

app.post('/api/cart/add', (req, res) => {
  const { telegramId, productId, quantity = 1 } = req.body;
  const user = db.prepare(`SELECT id FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  let cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id);
  if (!cart) { db.prepare(`INSERT INTO carts (user_id) VALUES (?)`).run(user.id); cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id); }
  
  db.prepare(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = quantity + ?`).run(cart.id, productId, quantity, quantity);
  res.json({ success: true });
});

app.delete('/api/cart/item', (req, res) => {
  const { telegramId, productId } = req.body;
  const user = db.prepare(`SELECT id FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id);
  if (cart) {
    db.prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`).run(cart.id, productId);
  }
  res.json({ success: true });
});

app.post('/api/orders/checkout', async (req, res) => {
  const { telegramId, provider } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const cartRes = db.prepare(`SELECT id, discount_code FROM carts WHERE user_id = ?`).get(user.id);
  if (!cartRes) return res.status(400).json({ error: 'Carrito vacío' });

  const cartItems = db.prepare(`SELECT product_id, quantity FROM cart_items WHERE cart_id = ?`).all(cartRes.id);
  if (cartItems.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

  const allProducts = await fetchProductsFromGoogleSheet();

  let subtotalCents = 0;
  const items = [];
  for (const ci of cartItems) {
    const prod = allProducts.find(p => p.id === ci.product_id);
    if (prod) {
      subtotalCents += prod.price_cents * ci.quantity;
      items.push({ ...prod, quantity: ci.quantity });
    }
  }

  let discountCents = 0;
  let totalItems = items.reduce((acc, i) => acc + i.quantity, 0);

  if (cartRes.discount_code) {
    const disc = db.prepare(`SELECT percent_off, min_items FROM discounts WHERE code = ?`).get(cartRes.discount_code);
    if (disc && totalItems >= disc.min_items) discountCents = Math.floor((subtotalCents * disc.percent_off) / 100);
  }

  let subtotalAfterCoupon = Math.max(0, subtotalCents - discountCents);
  let finalTotalCents = subtotalAfterCoupon;

  if (provider === 'WALLET_BALANCE') {
    let walletIncentiveCents = 0;
    if (user.membership_plan === 'STANDARD') {
      walletIncentiveCents = Math.floor(subtotalAfterCoupon * 0.005);
    } else if (user.membership_plan === 'PREMIUM') {
      walletIncentiveCents = Math.floor(subtotalAfterCoupon * 0.012);
    }
    finalTotalCents = Math.max(0, subtotalAfterCoupon - walletIncentiveCents);

    if (user.balance_cents < finalTotalCents) {
      return res.status(400).json({ error: 'Saldo insuficiente en tu billetera virtual.' });
    }
  }

  const orderCode = `DM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const initialStatus = provider === 'WALLET_BALANCE' ? 'PAID' : 'PENDING_PAYMENT';
  const initialShipping = provider === 'WALLET_BALANCE' ? 'PROCESANDO_ENTREGA' : 'PREPARANDO_ENVIO';

  const ordIns = db.prepare(`INSERT INTO orders (order_code, user_id, status, subtotal_cents, discount_cents, total_cents, currency, discount_code, shipping_status) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?)`).run(orderCode, user.id, initialStatus, subtotalCents, discountCents, finalTotalCents, cartRes.discount_code, initialShipping);
  const orderId = ordIns.lastInsertRowid;

  const itemStmt = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_type, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const item of items) {
    itemStmt.run(orderId, item.id, item.name, item.product_type, item.quantity, item.price_cents, item.price_cents * item.quantity);
  }

  const paymentStatus = provider === 'WALLET_BALANCE' ? 'SUCCESS' : 'PENDING';
  db.prepare(`INSERT INTO payments (order_id, provider, provider_tx_id, status, amount_cents) VALUES (?, ?, ?, ?, ?)`).run(orderId, provider, `${provider}-${orderCode}`, paymentStatus, finalTotalCents);

  if (provider === 'WALLET_BALANCE') {
    const pointsEarned = Math.floor(finalTotalCents / 100);
    db.prepare(`UPDATE users SET balance_cents = balance_cents - ?, loyalty_points = loyalty_points + ? WHERE id = ?`).run(finalTotalCents, pointsEarned, user.id);
  }

  db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`).run(cartRes.id);
  db.prepare(`UPDATE carts SET discount_code = NULL WHERE id = ?`).run(cartRes.id);

  const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(orderCode);
  res.json({ success: true, order, totalUSD: (finalTotalCents / 100).toFixed(2), conversions: calculateConversions(finalTotalCents) });
});

app.get('/api/orders/:telegramId', (req, res) => {
  const user = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(req.params.telegramId);
  if (!user) return res.json([]);
  res.json(db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC").all(user.id));
});

app.delete('/api/orders/:orderId', (req, res) => {
  const orderId = req.params.orderId;
  db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
  db.prepare("DELETE FROM payments WHERE order_id = ?").run(orderId);
  db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
  res.json({ success: true });
});

app.delete('/api/orders/all/:telegramId', (req, res) => {
  const user = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(req.params.telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  
  const userOrders = db.prepare("SELECT id FROM orders WHERE user_id = ?").all(user.id);
  for (const ord of userOrders) {
    db.prepare("DELETE FROM order_items WHERE order_id = ?").run(ord.id);
    db.prepare("DELETE FROM payments WHERE order_id = ?").run(ord.id);
  }
  db.prepare("DELETE FROM orders WHERE user_id = ?").run(user.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🚀 DigitalMarket Servidor Maestro V8 activo en puerto ${PORT}`);
});
