/**
 * ============================================================================
 * 🌌 DIGITALMARKET BACKEND API (Versión Completa y Definitiva)
 * ============================================================================
 */

'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(process.cwd(), 'digitalmarket_api.db');

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH);

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    full_name TEXT NOT NULL,
    marketing_opt_in INTEGER NOT NULL DEFAULT 1,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    referred_by INTEGER,
    referral_code TEXT UNIQUE,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    price_cents INTEGER NOT NULL,
    price_decimal TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    product_type TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
    discount_code TEXT
);
CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
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
`;

db.exec(SCHEMA_SQL);

// Tasas de cambio referenciales
const EXCHANGE_RATES = {
  RUB: 95.0,
  CUP: 320.0,
  MLC: 280.0,
  CLASICA: 300.0
};

function seedDatabaseFull() {
  try {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN IMMEDIATE');
    db.exec("DELETE FROM cart_items");
    db.exec("DELETE FROM products");
    db.exec("DELETE FROM categories");
    db.exec("DELETE FROM discounts");

    db.exec(`INSERT INTO categories (id, slug, name, product_type, description) VALUES (1, 'dig-descargables', 'Artículos Digitales (Telegram Stars ⭐)', 'DIGITAL', 'Cuentas de streaming e IA')`);
    db.exec(`INSERT INTO categories (id, slug, name, product_type, description) VALUES (2, 'fis-preventa', 'Artículos Físicos (Preventa / Stock)', 'PHYSICAL', 'Gadgets y electrónica')`);

    const allProducts = [
      ['DIG-STR-001', 1, '[⭐] Cuenta Netflix (Perfil HD/4K)', 'Acceso automatizado.', 1550, '15.50', 'DIGITAL', 999],
      ['DIG-STR-002', 1, '[⭐] Xuper TV / IPTV Premium (1 Mes)', 'Acceso al mejor contenido en vivo.', 199, '1.99', 'DIGITAL', 999],
      ['DIG-AI-101', 1, '[⭐] ChatGPT Plus / OpenAI (Acceso Pro)', 'Acceso avanzado con GPT-4o.', 2499, '24.99', 'DIGITAL', 999],
      ['WB-ELE-001', 2, '[📦] Smartwatch Deportivo Pro', 'Reloj inteligente con monitor cardíaco.', 4500, '45.00', 'PHYSICAL', 10],
      ['YM-CMP-101', 2, '[📦] SSD NVMe M.2 1TB Alta Velocidad', 'Unidad de estado sólido 3500 MB/s.', 6800, '68.00', 'PHYSICAL', 15]
    ];

    const prodStmt = db.prepare(`
      INSERT INTO products (sku, category_id, name, description, price_cents, price_decimal, currency, product_type, stock, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, 1)
    `);

    for (const [sku, catId, name, desc, cents, dec, type, stock] of allProducts) {
      prodStmt.run(sku, catId, name, desc, cents, dec, type, stock);
    }

    // Cupones Festivos de Campaña
    const discountsSeed = [
      ['MAMAS20', 20, 2, 'Día de la Madre (Mayo)', '1,2,3,4,5,6,7,8,9,10,11,12'],
      ['XMAS30', 30, 3, 'Navidad (Diciembre)', '1,2,3,4,5,6,7,8,9,10,11,12'],
      ['BLACKFRIDAY35', 35, 3, 'Black Friday (Noviembre)', '1,2,3,4,5,6,7,8,9,10,11,12']
    ];

    const discStmt = db.prepare(`
      INSERT INTO discounts (code, percent_off, min_items, max_uses, used_count, festival_name, valid_months, is_active)
      VALUES (?, ?, ?, 1000, 0, ?, ?, 1)
    `);

    for (const [code, pct, minIt, festName, months] of discountsSeed) {
      discStmt.run(code, pct, minIt, festName, months);
    }

    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    console.error('Error en seed:', err.message);
  }
}

seedDatabaseFull();

function calculateConversions(centsUSD) {
  const usdVal = centsUSD / 100;
  return {
    RUB: (usdVal * EXCHANGE_RATES.RUB).toFixed(2),
    CUP: (usdVal * EXCHANGE_RATES.CUP).toFixed(2),
    MLC: (usdVal * EXCHANGE_RATES.MLC).toFixed(2),
    CLASICA: (usdVal * EXCHANGE_RATES.CLASICA).toFixed(2)
  };
}

function centsToDecimalStr(cents) {
  const n = Number(cents);
  const dollars = Math.floor(Math.abs(n) / 100);
  const rem = String(Math.abs(n) % 100).padStart(2, '0');
  return `${dollars}.${rem}`;
}

app.post('/api/users/sync', (req, res) => {
  const { telegramId, fullName, username } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'telegramId requerido' });

  db.prepare(`INSERT INTO users (telegram_id, username, full_name, referral_code) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, full_name=excluded.full_name`).run(telegramId, username, fullName, `ref_${telegramId}`);
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  res.json({ success: true, user });
});

app.get('/api/categories', (req, res) => {
  res.json(db.prepare(`SELECT * FROM categories WHERE is_active = 1`).all());
});

app.get('/api/products', (req, res) => {
  const { type } = req.query;
  let query = `SELECT * FROM products WHERE is_active = 1`;
  const params = [];
  if (type) { query += ` AND product_type = ?`; params.push(type); }
  
  const rawProducts = db.prepare(query).all(...params);
  const products = rawProducts.map(p => {
    const conv = calculateConversions(p.price_cents);
    return {
      ...p,
      price_usd: p.price_decimal,
      conversions: conv
    };
  });

  res.json(products);
});

app.get('/api/discounts', (req, res) => {
  res.json(db.prepare(`SELECT * FROM discounts WHERE is_active = 1`).all());
});

app.post('/api/cart/apply-coupon', (req, res) => {
  const { telegramId, code } = req.body;
  const cleanCode = String(code).trim().toUpperCase();

  try {
    const user = db.prepare(`SELECT id FROM users WHERE telegram_id = ?`).get(telegramId);
    if (!user) throw new Error('Usuario no encontrado');

    const disc = db.prepare(`SELECT * FROM discounts WHERE code = ? AND is_active = 1`).get(cleanCode);
    if (!disc) throw new Error('Código de descuento inválido o expirado.');

    const cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id);
    if (!cart) throw new Error('El carrito está vacío.');

    const totalItemsRes = db.prepare(`SELECT SUM(quantity) AS total FROM cart_items WHERE cart_id = ?`).get(cart.id);
    const totalItems = totalItemsRes ? totalItemsRes.total : 0;

    if (totalItems < disc.min_items) {
      throw new Error(`Este cupón festivo (${disc.festival_name}) requiere un mínimo de ${disc.min_items} artículos en el carrito.`);
    }

    db.prepare(`UPDATE carts SET discount_code = ? WHERE id = ?`).run(cleanCode, cart.id);
    res.json({ success: true, discount: disc });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/cart/:telegramId', (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(req.params.telegramId);
  if (!user) return res.json({ items: [], subtotalCents: 0, totalCents: 0 });

  let cart = db.prepare(`SELECT * FROM carts WHERE user_id = ?`).get(user.id);
  if (!cart) {
    db.prepare(`INSERT INTO carts (user_id) VALUES (?)`).run(user.id);
    cart = db.prepare(`SELECT * FROM carts WHERE user_id = ?`).get(user.id);
  }

  const items = db.prepare(`
    SELECT ci.quantity, p.id AS product_id, p.name, p.price_cents, p.price_decimal, p.currency, p.product_type 
    FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ?
  `).all(cart.id);

  let subtotalCents = items.reduce((acc, i) => acc + i.price_cents * i.quantity, 0);
  let discountCents = 0;
  let totalItems = items.reduce((acc, i) => acc + i.quantity, 0);

  if (cart.discount_code) {
    const disc = db.prepare(`SELECT percent_off, min_items FROM discounts WHERE code = ?`).get(cart.discount_code);
    if (disc && totalItems >= disc.min_items) {
      discountCents = Math.floor((subtotalCents * disc.percent_off) / 100);
    }
  }

  const totalCents = Math.max(0, subtotalCents - discountCents);
  const totalUSD = centsToDecimalStr(totalCents);
  const discountUSD = centsToDecimalStr(discountCents);
  const conversions = calculateConversions(totalCents);

  const processedItems = items.map(i => {
    return {
      ...i,
      total_usd: (i.price_cents * i.quantity / 100).toFixed(2),
      conversions: calculateConversions(i.price_cents * i.quantity)
    };
  });

  res.json({
    items: processedItems,
    subtotalCents,
    totalUSD,
    discountUSD,
    discountCode: cart.discount_code,
    conversions,
    totalItems
  });
});

app.post('/api/cart/add', (req, res) => {
  const { telegramId, productId, quantity = 1 } = req.body;
  const user = db.prepare(`SELECT id FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  let cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id);
  if (!cart) {
    db.prepare(`INSERT INTO carts (user_id) VALUES (?)`).run(user.id);
    cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id);
  }

  const existing = db.prepare(`SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?`).get(cart.id, productId);
  if (existing) {
    db.prepare(`UPDATE cart_items SET quantity = quantity + ? WHERE cart_id = ? AND product_id = ?`).run(quantity, cart.id, productId);
  } else {
    db.prepare(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)`).run(cart.id, productId, quantity);
  }

  res.json({ success: true });
});

app.delete('/api/cart/:telegramId', (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(req.params.telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const cart = db.prepare(`SELECT id FROM carts WHERE user_id = ?`).get(user.id);
  if (cart) {
    db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`).run(cart.id);
    db.prepare(`UPDATE carts SET discount_code = NULL WHERE id = ?`).run(cart.id);
  }
  res.json({ success: true });
});

app.post('/api/orders/checkout', (req, res) => {
  const { telegramId, provider } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const cartRes = db.prepare(`SELECT id, discount_code FROM carts WHERE user_id = ?`).get(user.id);
  if (!cartRes) return res.status(400).json({ error: 'Carrito vacío' });

  const items = db.prepare(`SELECT ci.quantity, p.id AS product_id, p.name, p.price_cents, p.product_type FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ?`).all(cartRes.id);
  if (items.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

  let subtotalCents = items.reduce((acc, i) => acc + i.price_cents * i.quantity, 0);
  let discountCents = 0;
  let totalItems = items.reduce((acc, i) => acc + i.quantity, 0);

  if (cartRes.discount_code) {
    const disc = db.prepare(`SELECT percent_off, min_items FROM discounts WHERE code = ?`).get(cartRes.discount_code);
    if (disc && totalItems >= disc.min_items) {
      discountCents = Math.floor((subtotalCents * disc.percent_off) / 100);
    }
  }

  const totalCents = Math.max(0, subtotalCents - discountCents);
  const orderCode = `DM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const totalUSD = centsToDecimalStr(totalCents);
  const conversions = calculateConversions(totalCents);

  try {
    db.exec('BEGIN IMMEDIATE');
    const ordIns = db.prepare(`INSERT INTO orders (order_code, user_id, status, subtotal_cents, discount_cents, total_cents, currency, discount_code) VALUES (?, ?, 'PENDING_PAYMENT', ?, ?, ?, 'USD', ?)`).run(orderCode, user.id, subtotalCents, discountCents, totalCents, cartRes.discount_code);
    const orderId = ordIns.lastInsertRowid;

    const itemStmt = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_type, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const item of items) {
      itemStmt.run(orderId, item.product_id, item.name, item.product_type, item.quantity, item.price_cents, item.price_cents * item.quantity);
    }

    db.prepare(`INSERT INTO payments (order_id, provider, provider_tx_id, status, amount_cents) VALUES (?, ?, ?, 'PENDING', ?)`).run(orderId, provider || 'USDT_BYBIT', `${provider}-${orderCode}`, totalCents);

    db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`).run(cartRes.id);
    db.prepare(`UPDATE carts SET discount_code = NULL WHERE id = ?`).run(cartRes.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(orderCode);
  res.json({
    success: true,
    order,
    totalUSD,
    conversions
  });
});

// ============================================================================
// 📢 AUTOMATIZACIÓN DE CAMPAÑAS Y OFERTAS HACIA EL CANAL OFICIAL
// ============================================================================

class ChannelAutomationScheduler {
  constructor(db) {
    this.db = db;
    this.botToken = process.env.BOT_TOKEN || '8743289252:AAFkSdl8O8VtQlvkRpnvHbwZShApI65XSNw';
    this.channelId = process.env.CHANNEL_ID || '-1004310833438';
    this.botUsername = process.env.BOT_USERNAME || 'digitalmarketr_bot';
    this.apiBase = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendToChannel(text, replyMarkup = null) {
    if (!this.botToken || this.botToken.includes('REEMPLAZAR')) {
      console.log('⚠️ [Canal Scheduler]: BOT_TOKEN no configurado para publicar en el canal.');
      return;
    }
    try {
      const payload = {
        chat_id: this.channelId,
        text: text,
        parse_mode: 'HTML'
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;

      const res = await fetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`❌ [Error publicando en canal ${this.channelId}]:`, data.description);
      } else {
        console.log(`✅ [Campaña publicada con éxito en el canal ${this.channelId}]`);
      }
    } catch (err) {
      console.error(`❌ [Excepción publicando en canal]:`, err.message);
    }
  }

  async triggerAutomatedCampaignPost() {
    const activeDiscount = this.db.prepare("SELECT * FROM discounts WHERE is_active = 1 LIMIT 1").get();
    const featuredProduct = this.db.prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1").get();

    let message = `🎉 <b>¡OFERTA ESPECIAL Y CAMPAÑA EN DIGITALMARKET!</b> 🎉\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (activeDiscount) {
      message += `✨ <b>Campaña Activa: ${activeDiscount.festival_name}</b>\n`;
      message += `▫️ Llévate un <b>${activeDiscount.percent_off}% de descuento</b> aplicando el código: <code>${activeDiscount.code}</code>\n`;
      message += `▫️ <i>(A partir de ${activeDiscount.min_items} artículos en el carrito).</i>\n\n`;
    }

    if (featuredProduct) {
      const usd = featuredProduct.price_decimal;
      message += `🔥 <b>Producto Destacado:</b>\n`;
      message += `▫️ <b>${featuredProduct.name}</b> — <b>${usd} USD</b>\n`;
      message += `▫️ <i>${featuredProduct.description}</i>\n\n`;
    }

    message += '🛒 ¡Haz clic abajo para entrar al bot, armar tu carrito y canjear tus cupones festivos! 👇';
    const keyboard = { inline_keyboard: [[{ text: '🚀 Abrir Tienda y Bot', url: `https://t.me/${this.botUsername}?start=promo` }]] };

    await this.sendToChannel(message, keyboard);
  }

  startScheduler() {
    setTimeout(() => { this.triggerAutomatedCampaignPost(); }, 10000);
    setInterval(() => { this.triggerAutomatedCampaignPost(); }, 12 * 60 * 60 * 1000);
    console.log('📢 [ChannelAutomationScheduler] Programador de ofertas y campañas iniciado.');
  }
}

const scheduler = new ChannelAutomationScheduler(db);
scheduler.startScheduler();

app.listen(PORT, () => {
  console.log(`🚀 DigitalMarket Backend API (Versión Completa) en puerto ${PORT}`);
});
