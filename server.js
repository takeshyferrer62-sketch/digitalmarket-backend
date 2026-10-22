/**
 * ============================================================================
 * 🌌 DIGITALMARKET - SERVIDOR Y BOT DE MARKETING Y ANUNCIOS (Mini App Powered)
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

const BOT_TOKEN = process.env.BOT_TOKEN || '8743289252:AAFkSdl8O8VtQlvkRpnvHbwZShApI65XSNw';
const OFFICIAL_CHANNEL_URL = process.env.OFFICIAL_CHANNEL_URL || 'https://t.me/DigitalMarketOfertas';
const CHANNEL_ID = process.env.CHANNEL_ID || '-1004310833438';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://digitalmarketrapp.vercel.app'; // URL de la Mini App desplegada
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'Yunier!289';

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
    loyalty_points INTEGER NOT NULL DEFAULT 0,
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
    shipping_status TEXT NOT NULL DEFAULT 'PREPARANDO_ENVIO',
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

try { db.exec("ALTER TABLE users ADD COLUMN loyalty_points INTEGER NOT NULL DEFAULT 0;"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN shipping_status TEXT NOT NULL DEFAULT 'PREPARANDO_ENVIO';"); } catch(e){}

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

// ============================================================================
// 🤖 NUEVO BOT DE TELEGRAM (Enfoque de Marketing, Banners, Cupones y WebApp)
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
  } catch (err) {
    console.error(`❌ [Telegram API ${method}]:`, err.message);
    return null;
  }
}

async function handleTelegramUpdate(u) {
  if (u.pre_checkout_query) {
    await callTelegram('answerPreCheckoutQuery', { pre_checkout_query_id: u.pre_checkout_query.id, ok: true });
    return;
  }

  if (u.message && u.message.successful_payment) {
    const chatId = u.message.chat.id;
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>¡Pago con Telegram Stars recibido!</b>\n\nTu orden ha sido procesada con éxito en la Mini App.`,
      parse_mode: 'HTML'
    });
    return;
  }

  if (u.message && u.message.text) {
    const msg = u.message;
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text.trim();

    // Registrar o actualizar usuario
    let referredById = null;
    if (text.startsWith('/start ref_')) {
      const refCode = text.replace('/start ', '').trim();
      const referrer = db.prepare("SELECT id FROM users WHERE referral_code = ?").get(refCode);
      if (referrer) referredById = referrer.id;
    }

    let existingUser = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
    if (!existingUser) {
      db.prepare(`INSERT INTO users (telegram_id, username, full_name, referred_by, referral_code) VALUES (?, ?, ?, ?, ?)`)
        .run(telegramId, msg.from.username || null, [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '), referredById, `ref_${telegramId}`);
    }

    if (text.startsWith('/start') || text.startsWith('/menu')) {
      const welcomeCaption = `🌌 <b>¡Bienvenido a DigitalMarket Oficial!</b> 🚀\n\n` +
                             `Todo nuestro catálogo, pagos automatizados, referidos y puntos de fidelidad ahora operan en nuestra ultrarrápida <b>Mini App</b>.\n\n` +
                             `🔥 <i>Haz clic en el botón de abajo para explorar preventas, cuentas digitales, cupones activos y ofertas exclusivas.</i>`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: welcomeCaption,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛍️ Abrir Tienda (Mini App)', web_app: { url: WEB_APP_URL } }],
            [{ text: '🎁 Ver Cupones y Campañas Activas', callback_data: 'bot:promo_banner' }],
            [{ text: '🏆 Logros y Comunidad', callback_data: 'bot:success_story' }]
          ]
        }
      });
    }
  } else if (u.callback_query) {
    const cb = u.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    if (data === 'bot:promo_banner') {
      const activeDiscounts = db.prepare("SELECT * FROM discounts WHERE is_active = 1").all();
      let text = `🎁 <b>¡Cupones y Campañas Flash Disponibles!</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      for (const d of activeDiscounts) {
        text += `✨ <b>${d.festival_name}</b>\n   ▫️ Código: <code>${d.code}</code>\n   ▫️ Descuento: <b>${d.percent_off}% OFF</b>\n\n`;
      }
      text += `💡 <i>Copia tu código y utilízalo al pagar en la Mini App.</i>`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛍️ Ir a Comprar en la Mini App', web_app: { url: WEB_APP_URL } }],
            [{ text: '⬅️ Menú Principal', callback_data: 'bot:home' }]
          ]
        }
      });
      await callTelegram('answerCallbackQuery', { callback_query_id: cb.id });
    } else if (data === 'bot:success_story') {
      const text = `🏆 <b>¡Logros y Testimonios de la Comunidad!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                   `📦 Más de <b>500+ envíos y entregas digitales</b> realizadas con éxito en Rusia y Cuba.\n` +
                   `⭐ Procesamiento de pagos optimizado con USDT, Telegram Stars, SBP y Transfermóvil.\n\n` +
                   `¡Sé parte de nuestra red de clientes satisfechos!`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Abrir Mini App', web_app: { url: WEB_APP_URL } }],
            [{ text: '⬅️ Menú Principal', callback_data: 'bot:home' }]
          ]
        }
      });
      await callTelegram('answerCallbackQuery', { callback_query_id: cb.id });
    } else if (data === 'bot:home') {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `🌌 <b>Menú Principal - DigitalMarket</b>`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛍️ Abrir Tienda (Mini App)', web_app: { url: WEB_APP_URL } }],
            [{ text: '🎁 Ver Cupones y Campañas Activas', callback_data: 'bot:promo_banner' }],
            [{ text: '🏆 Logros y Comunidad', callback_data: 'bot:success_story' }]
          ]
        }
      });
      await callTelegram('answerCallbackQuery', { callback_query_id: cb.id });
    }
  }
}

// ============================================================================
// 🌐 ENDPOINTS EXPRESS (API para la Mini App + Broadcast de Anuncios)
// ============================================================================

app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  try {
    await handleTelegramUpdate(update);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('❌ Error en webhook:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
  const products = db.prepare("SELECT * FROM products WHERE is_active = 1").all();
  res.json(products.map(p => ({ ...p, price_usd: p.price_decimal, conversions: calculateConversions(p.price_cents) })));
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
  const earnedPoints = Math.floor(totalCents / 100);

  try {
    db.exec('BEGIN IMMEDIATE');
    const ordIns = db.prepare(`INSERT INTO orders (order_code, user_id, status, subtotal_cents, discount_cents, total_cents, currency, discount_code, shipping_status) VALUES (?, ?, 'PENDING_PAYMENT', ?, ?, ?, 'USD', ?, 'PREPARANDO_ENVIO')`).run(orderCode, user.id, subtotalCents, discountCents, totalCents, cartRes.discount_code);
    const orderId = ordIns.lastInsertRowid;

    const itemStmt = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_type, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const item of items) {
      itemStmt.run(orderId, item.product_id, item.name, item.product_type, item.quantity, item.price_cents, item.price_cents * item.quantity);
    }

    db.prepare(`INSERT INTO payments (order_id, provider, provider_tx_id, status, amount_cents) VALUES (?, ?, ?, 'PENDING', ?)`).run(orderId, provider || 'USDT_BYBIT', `${provider}-${orderCode}`, totalCents);
    db.prepare(`UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?`).run(earnedPoints, user.id);

    db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`).run(cartRes.id);
    db.prepare(`UPDATE carts SET discount_code = NULL WHERE id = ?`).run(cartRes.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(orderCode);
  res.json({ success: true, order, totalUSD: centsToDecimalStr(totalCents), conversions: calculateConversions(totalCents) });
});

// Endpoint Admin para Broadcast de Anuncios y Campañas
app.post('/api/admin/broadcast', async (req, res) => {
  const { secret, message, imageUrl } = req.body;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'No autorizado' });
  if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

  const users = db.prepare("SELECT telegram_id FROM users WHERE is_blocked = 0").all();
  let successCount = 0;

  for (const u of users) {
    let sent = null;
    const markup = {
      inline_keyboard: [
        [{ text: '🛍️ Abrir Tienda (Mini App)', web_app: { url: WEB_APP_URL } }],
        [{ text: '🎁 Ver Cupones Flash', callback_data: 'bot:promo_banner' }]
      ]
    };

    if (imageUrl) {
      sent = await callTelegram('sendPhoto', {
        chat_id: u.telegram_id,
        photo: imageUrl,
        caption: message,
        parse_mode: 'HTML',
        reply_markup: markup
      });
    } else {
      sent = await callTelegram('sendMessage', {
        chat_id: u.telegram_id,
        text: message,
        parse_mode: 'HTML',
        reply_markup: markup
      });
    }

    if (sent) successCount++;
    await new Promise(r => setTimeout(r, 50));
  }

  res.json({ success: true, totalSent: successCount });
});

function centsToDecimalStr(cents) {
  const n = Number(cents);
  const dollars = Math.floor(Math.abs(n) / 100);
  const rem = String(Math.abs(n) % 100).padStart(2, '0');
  return `${dollars}.${rem}`;
}

app.listen(PORT, () => {
  console.log(`🚀 DigitalMarket - Servidor de Marketing y Anuncios activo en puerto ${PORT}`);
});
