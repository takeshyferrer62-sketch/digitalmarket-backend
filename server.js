/**
 * ============================================================================
 * 🌌 DIGITALMARKET - SERVIDOR MAESTRO UNIFICADO V4 (Google Sheets Robusto)
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

try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT;"); } catch(e){}
try { db.exec("ALTER TABLE users ADD COLUMN address TEXT;"); } catch(e){}
try { db.exec("ALTER TABLE users ADD COLUMN payment_method TEXT;"); } catch(e){}
try { db.exec("ALTER TABLE users ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0;"); } catch(e){}

const EXCHANGE_RATES = { RUB: 95.0, CUP: 320.0, MLC: 280.0, CLASICA: 300.0 };

function calculateConversions(centsUSD) {
  const usdVal = centsUSD / 100;
  return { RUB: (usdVal * EXCHANGE_RATES.RUB).toFixed(2), CUP: (usdVal * EXCHANGE_RATES.CUP).toFixed(2), MLC: (usdVal * EXCHANGE_RATES.MLC).toFixed(2), CLASICA: (usdVal * EXCHANGE_RATES.CLASICA).toFixed(2) };
}

// ============================================================================
// 📊 LECTOR DINÁMICO DE GOOGLE SHEETS ROBUSTO (CON PARSER DE COMAS)
// ============================================================================

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

function seedDiscounts() {
  try {
    db.exec(`INSERT OR IGNORE INTO discounts (code, percent_off, min_items, festival_name, valid_months) VALUES ('MAMAS20', 20, 2, 'Día de la Madre', '1,2,3,4,5,6,7,8,9,10,11,12')`);
    db.exec(`INSERT OR IGNORE INTO discounts (code, percent_off, min_items, festival_name, valid_months) VALUES ('XMAS30', 30, 3, 'Navidad', '1,2,3,4,5,6,7,8,9,10,11,12')`);
  } catch (e) {}
}
seedDiscounts();

// ============================================================================
// 📢 SCHEDULER DE CANAL
// ============================================================================

async function callTelegram(method, payload = {}) {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return data.ok ? data.result : null;
  } catch (err) { return null; }
}

class ChannelAutomationScheduler {
  async triggerAutomatedCampaignPost() {
    const products = await fetchProductsFromGoogleSheet();
    const featured = products[Math.floor(Math.random() * products.length)] || products[0];

    let message = `🎉 <b>¡OFERTA ESPECIAL EN DIGITALMARKET!</b> 🎉\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (featured) {
      message += `🔥 <b>Producto Destacado:</b>\n▫️ <b>${featured.name}</b> — <b>${featured.price_decimal} USD</b>\n<i>${featured.description}</i>\n\n`;
    }
    message += '🛒 ¡Haz clic abajo para abrir la tienda y comprar! 👇';
    
    await callTelegram('sendMessage', {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🚀 Abrir Mini App', web_app: { url: WEB_APP_URL } }]] }
    });
  }
  startScheduler() {
    setInterval(() => { this.triggerAutomatedCampaignPost(); }, 12 * 60 * 60 * 1000);
  }
}
new ChannelAutomationScheduler().startScheduler();

// ============================================================================
// ⚡ BYBIT AUTO-PAY CHECKER
// ============================================================================

async function checkBybitDeposits() {
  try {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const queryString = 'coin=USDT';
    const signaturePayload = timestamp + BYBIT_API_KEY + recvWindow + queryString;
    const signature = crypto.createHmac('sha256', BYBIT_API_SECRET).update(signaturePayload).digest('hex');

    const res = await fetch(`${BYBIT_BASE_URL}/v5/asset/deposit/query-record?${queryString}`, {
      method: 'GET',
      headers: { 'X-BAPI-API-KEY': BYBIT_API_KEY, 'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-SIGN': signature, 'X-BAPI-RECV-WINDOW': recvWindow }
    });
    const data = await res.json();
    if (data.retCode === 0 && data.result && data.result.rows) {
      const pendingOrders = db.prepare("SELECT o.*, p.id as pay_id FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.status = 'PENDING_PAYMENT' AND p.provider = 'USDT_BYBIT'").all();
      for (const ord of pendingOrders) {
        const matched = data.result.rows.find(d => Number(d.amount) >= (ord.total_cents / 100) && d.status === 3);
        if (matched) {
          db.prepare("UPDATE orders SET status = 'PAID', shipping_status = 'PROCESANDO_ENTREGA' WHERE id = ?").run(ord.id);
          db.prepare("UPDATE payments SET status = 'SUCCESS', provider_tx_id = ? WHERE id = ?").run(matched.txID, ord.pay_id);
        }
      }
    }
  } catch (err) {}
}
setInterval(checkBybitDeposits, 2 * 60 * 1000);

// ============================================================================
// 🌐 ENDPOINTS EXPRESS
// ============================================================================

app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  if (update.message && (update.message.text?.startsWith('/start') || update.message.text?.startsWith('/menu'))) {
    await callTelegram('sendMessage', {
      chat_id: update.message.chat.id,
      text: `🌌 <b>¡Bienvenido a DigitalMarket Oficial!</b> 🚀\n\nTodo nuestro catálogo y compras operan en nuestra Mini App.`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🛍️ Abrir Tienda (Mini App)', web_app: { url: WEB_APP_URL } }]] }
    });
  }
  res.status(200).json({ ok: true });
});

app.post('/api/users/sync', (req, res) => {
  const { telegramId, fullName, username } = req.body;
  db.prepare(`INSERT INTO users (telegram_id, username, full_name, referral_code) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, full_name=excluded.full_name`).run(telegramId, username, fullName, `ref_${telegramId}`);
  res.json({ success: true, user: db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId) });
});

app.post('/api/users/info', (req, res) => {
  const { telegramId, fullName, phone, address, payment } = req.body;
  db.prepare(`UPDATE users SET full_name = ?, phone = ?, address = ?, payment_method = ? WHERE telegram_id = ?`).run(fullName, phone, address, payment, telegramId);
  res.json({ success: true });
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
  if (!cart) { db.prepare(`INSERT INTO carts (user_id) VALUES (?)`).run(user.id); cart = db.prepare(`SELECT * FROM carts WHERE user_id = ?`).get(user.id); }

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

  const totalCents = Math.max(0, subtotalCents - discountCents);
  res.json({
    items,
    subtotalCents,
    totalUSD: (totalCents / 100).toFixed(2),
    discountUSD: (discountCents / 100).toFixed(2),
    discountCode: cart.discount_code,
    conversions: calculateConversions(totalCents),
    totalItems
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
  const cartRes = db.prepare(`SELECT id, discount_code FROM carts WHERE user_id = ?`).get(user.id);
  const cartItems = db.prepare(`SELECT product_id, quantity FROM cart_items WHERE cart_id = ?`).all(cartRes.id);
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

  const totalCents = Math.max(0, subtotalCents - discountCents);
  const orderCode = `DM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const ordIns = db.prepare(`INSERT INTO orders (order_code, user_id, status, subtotal_cents, discount_cents, total_cents, currency, discount_code, shipping_status) VALUES (?, ?, 'PENDING_PAYMENT', ?, ?, ?, 'USD', ?, 'PREPARANDO_ENVIO')`).run(orderCode, user.id, subtotalCents, discountCents, totalCents, cartRes.discount_code);
  const orderId = ordIns.lastInsertRowid;

  const itemStmt = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_type, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const item of items) {
    itemStmt.run(orderId, item.id, item.name, item.product_type, item.quantity, item.price_cents, item.price_cents * item.quantity);
  }

  db.prepare(`INSERT INTO payments (order_id, provider, provider_tx_id, status, amount_cents) VALUES (?, ?, ?, 'PENDING', ?)`).run(orderId, provider || 'USDT_BYBIT', `${provider}-${orderCode}`, totalCents);

  db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`).run(cartRes.id);
  db.prepare(`UPDATE carts SET discount_code = NULL WHERE id = ?`).run(cartRes.id);

  const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(orderCode);

  if (provider === 'TELEGRAM_STARS') {
    const stars = Math.max(1, Math.ceil((totalCents / 100) * 50));
    await callTelegram('sendInvoice', {
      chat_id: telegramId,
      title: `Orden #${orderCode}`,
      description: `Compra en DigitalMarket`,
      payload: orderCode,
      currency: 'XTR',
      prices: [{ label: 'Estrellas', amount: stars }]
    });
  }

  res.json({ success: true, order, totalUSD: (totalCents / 100).toFixed(2), conversions: calculateConversions(totalCents) });
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
  console.log(`🚀 DigitalMarket Servidor Maestro V4 activo en puerto ${PORT}`);
});
