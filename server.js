/**
 * ============================================================================
 * 🌌 DIGITALMARKET - SERVIDOR AUTÓNOMO UNIFICADO (Backend + Bot en Render 24/7)
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
const BOT_USERNAME = process.env.BOT_USERNAME || 'digitalmarketr_bot';

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

function centsToDecimalStr(cents) {
  const n = Number(cents);
  const dollars = Math.floor(Math.abs(n) / 100);
  const rem = String(Math.abs(n) % 100).padStart(2, '0');
  return `${dollars}.${rem}`;
}

// ============================================================================
// 🤖 LÓGICA DEL BOT DE TELEGRAM INTEGRADA
// ============================================================================

const couponSessions = new Map();

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

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⭐ Artículos Digitales', callback_data: 'shop:digital' },
        { text: '📦 Artículos Físicos', callback_data: 'shop:physical' },
      ],
      [
        { text: '🛒 Mi Carrito', callback_data: 'cart:view' },
        { text: '🎁 Promociones y Campañas', callback_data: 'menu:promos' },
      ],
      [
        { text: '🛟 Soporte', callback_data: 'menu:support' }
      ]
    ]
  };
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
      text: `✅ <b>¡Pago con Telegram Stars recibido!</b>\n\nTu orden ha sido procesada con éxito.`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] }
    });
    return;
  }

  if (u.message && u.message.text) {
    const msg = u.message;
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text.trim();

    if (couponSessions.has(telegramId) && !text.startsWith('/')) {
      couponSessions.delete(telegramId);
      
      const disc = db.prepare("SELECT * FROM discounts WHERE code = ? AND is_active = 1").get(text.toUpperCase());
      let replyMsg = '';
      if (disc) {
        db.prepare("UPDATE carts SET discount_code = ? WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)").run(disc.code, telegramId);
        replyMsg = `✅ <b>¡Campaña Festiva Aplicada con Éxito!</b>\nDisfrutas de un <b>${disc.percent_off}% de descuento</b> (${disc.festival_name}).`;
      } else {
        replyMsg = `❌ <b>No se pudo aplicar el cupón:</b> Código inválido o expirado.`;
      }

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: replyMsg,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Ver Carrito', callback_data: 'cart:view' }],
            [{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]
          ]
        }
      });
      return;
    }

    db.prepare(`INSERT INTO users (telegram_id, username, full_name, referral_code) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, full_name=excluded.full_name`).run(telegramId, msg.from.username || null, [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '), `ref_${telegramId}`);

    if (text.startsWith('/start') || text.startsWith('/menu')) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `🌌 <b>Bienvenido a DigitalMarket Bot</b>\n\n⚡ Tienda autónoma 24/7 con campañas y conversiones directas.`,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard()
      });
    }
  } else if (u.callback_query) {
    const cb = u.callback_query;
    const chatId = cb.message.chat.id;
    const telegramId = cb.from.id;
    const data = cb.data;

    if (data === 'shop:digital' || data === 'shop:physical') {
      const type = data === 'shop:digital' ? 'DIGITAL' : 'PHYSICAL';
      const products = db.prepare("SELECT * FROM products WHERE is_active = 1 AND product_type = ?").all(type);
      
      let text = `📂 <b>Catálogo (${type}):</b>\n\n`;
      const rows = [];
      for (const p of products) {
        const c = calculateConversions(p.price_cents);
        text += `▫️ <b>${p.name}</b>\n` +
                `   • USD: <b>${p.price_decimal} $</b>\n` +
                `   • RUB: ~${c.RUB} ₽ | CUP: ~${c.CUP} CUP\n` +
                `<i>${p.description}</i>\n\n`;
        rows.push([{ text: `➕ Añadir ${p.name}`, callback_data: `buy:${p.id}` }]);
      }
      rows.push([{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]);
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
    } else if (data.startsWith('buy:')) {
      const productId = Number(data.split(':')[1]);
      const user = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(telegramId);
      if (user) {
        let cart = db.prepare("SELECT id FROM carts WHERE user_id = ?").get(user.id);
        if (!cart) {
          db.prepare("INSERT INTO carts (user_id) VALUES (?)").run(user.id);
          cart = db.prepare("SELECT id FROM carts WHERE user_id = ?").get(user.id);
        }
        db.prepare("INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, 1) ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = quantity + 1").run(cart.id, productId);
      }
      await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Añadido al carrito' });
    } else if (data === 'cart:view') {
      const user = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(telegramId);
      let text = `🛒 <b>Tu Carrito de Compras:</b>\n\n`;
      const keyboardRows = [];

      if (user) {
        const cart = db.prepare("SELECT * FROM carts WHERE user_id = ?").get(user.id);
        const items = cart ? db.prepare("SELECT ci.quantity, p.name, p.price_cents FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ?").all(cart.id) : [];

        if (items.length > 0) {
          let subtotalCents = 0;
          for (const item of items) {
            subtotalCents += item.price_cents * item.quantity;
            const c = calculateConversions(item.price_cents * item.quantity);
            text += `▫️ <b>${item.name}</b> (x${item.quantity}) — ${(item.price_cents * item.quantity / 100).toFixed(2)} USD\n`;
          }

          let discountCents = 0;
          let totalItems = items.reduce((acc, i) => acc + i.quantity, 0);
          if (cart.discount_code) {
            const disc = db.prepare("SELECT * FROM discounts WHERE code = ?").get(cart.discount_code);
            if (disc && totalItems >= disc.min_items) {
              discountCents = Math.floor((subtotalCents * disc.percent_off) / 100);
              text += `\n🎟️ Cupón aplicado: <code>${disc.code}</code> (-${(discountCents/100).toFixed(2)} USD)\n`;
            }
          }

          const totalCents = Math.max(0, subtotalCents - discountCents);
          const tc = calculateConversions(totalCents);

          text += `\n⚡ <b>Total a Pagar:</b>\n` +
                  `   • <b>${(totalCents/100).toFixed(2)} USD</b>\n` +
                  `   • 🇷🇺 RUB: <b>~${tc.RUB} ₽</b>\n` +
                  `   • 🇨🇺 CUP: <b>~${tc.CUP} CUP</b>\n\n`;

          keyboardRows.push([{ text: '🎟️ Canjear Cupón de Campaña', callback_data: 'cart:coupon_prompt' }]);
          keyboardRows.push([{ text: '⚡ USDT (Automatizado Bybit API)', callback_data: 'pay:usdt' }]);
          keyboardRows.push([{ text: '⭐ Telegram Stars', callback_data: 'pay:stars' }]);
          keyboardRows.push([{ text: '🇷🇺 SBP / RUB (Rusia)', callback_data: 'pay:sbp' }]);
          keyboardRows.push([{ text: '🇨🇺 Transfermóvil (Cuba)', callback_data: 'pay:transfermovil' }]);
          keyboardRows.push([{ text: '🗑️ Vaciar Carrito', callback_data: 'cart:clear' }]);
        } else {
          text += `⚪ <i>Tu carrito está vacío.</i>`;
        }
      } else {
        text += `⚪ <i>Tu carrito está vacío.</i>`;
      }

      keyboardRows.push([{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]);
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboardRows } });
    } else if (data === 'cart:clear') {
      const user = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(telegramId);
      if (user) {
        const cart = db.prepare("SELECT id FROM carts WHERE user_id = ?").get(user.id);
        if (cart) {
          db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cart.id);
          db.prepare("UPDATE carts SET discount_code = NULL WHERE id = ?").run(cart.id);
        }
      }
      await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Carrito vaciado' });
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🛒 <b>Tu Carrito:</b> Vacío.`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] } });
    } else if (data === 'cart:coupon_prompt') {
      couponSessions.set(telegramId, true);
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: `🎟️ <b>Canjear Cupón Festivo</b>\nEscribe el código de tu cupón de campaña (ej. <code>MAMAS20</code>, <code>XMAS30</code>, <code>BLACKFRIDAY35</code>):\n\n<i>(Se requiere un mínimo de 2 artículos).</i>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [ [{ text: '❌ Cancelar', callback_data: 'cart:view' }] ] }
      });
    } else if (data === 'menu:promos') {
      const discounts = db.prepare("SELECT * FROM discounts WHERE is_active = 1").all();
      let text = `🎁 <b>Campañas y Ofertas Festivas Activas</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      for (const d of discounts) {
        text += `🎉 <b>${d.festival_name}</b>\n   ▫️ Código: <code>${d.code}</code>\n   ▫️ Descuento: <b>${d.percent_off}% OFF</b>\n\n`;
      }
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Unirse al Canal Oficial', url: OFFICIAL_CHANNEL_URL }],
            [{ text: '🛒 Ir a mi Carrito', callback_data: 'cart:view' }],
            [{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]
          ]
        }
      });
    } else if (data.startsWith('pay:')) {
      const provider = data === 'pay:usdt' ? 'USDT_BYBIT' : data === 'pay:stars' ? 'TELEGRAM_STARS' : data === 'pay:sbp' ? 'SBP_RUB' : 'TRANSFERMOVIL';
      const user = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(telegramId);
      
      if (provider === 'TELEGRAM_STARS') {
        // Generar factura stars directa
        const cart = db.prepare("SELECT id FROM carts WHERE user_id = ?").get(user.id);
        const items = db.prepare("SELECT ci.quantity, p.name, p.price_cents FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ?").all(cart.id);
        const subtotal = items.reduce((acc, i) => acc + i.price_cents * i.quantity, 0);
        const stars = Math.max(1, Math.ceil((subtotal / 100) * 50));
        
        await callTelegram('sendInvoice', {
          chat_id: chatId,
          title: `Pedido DigitalMarket`,
          description: `Compra de artículos digitales`,
          payload: `DM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          currency: 'XTR',
          prices: [{ label: 'Estrellas', amount: stars }]
        });
        return;
      }

      let msg = `✅ <b>¡Orden Generada con Éxito!</b>\n\n`;
      if (provider === 'USDT_BYBIT') {
        msg += `⚡ <b>Pago USDT Automatizado (Bybit API):</b>\nEnvía los USDT a nuestra dirección oficial en red TRC20/TON y la API validará tu depósito automáticamente.`;
      } else if (provider === 'SBP_RUB') {
        msg += `🇷🇺 <b>Datos de Pago SBP / RUB:</b>\n• Teléfono SBP: <code>+79252481911</code>\n• Tarjeta directa: <code>2200 2479 5577 1879</code>\n\n<i>Envía tu comprobante con tu código de usuario.</i>`;
      } else if (provider === 'TRANSFERMOVIL') {
        msg += `🇨🇺 <b>Datos de Pago Transfermóvil (Cuba):</b>\n• Tarjeta CUP: <code>9204 1299 7694 7558</code>\n• Tarjeta Clásica/MLC: <code>9760 0390 0983 2477</code>\n\n<i>Envía la captura del comprobante.</i>`;
      }

      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: msg,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] }
      });
    } else if (data === 'menu:support') {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🛟 <b>Soporte Técnico:</b>\nEscríbenos ante cualquier duda con tu pago.`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] } });
    } else if (data === 'menu:home') {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🌌 <b>Menú Principal</b>`, parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() });
    }
  }
}

// ============================================================================
// 🌐 ENDPOINTS EXPRESS (API + Webhook de Telegram)
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

app.get('/api/products', (req, res) => {
  const products = db.prepare("SELECT * FROM products WHERE is_active = 1").all();
  res.json(products.map(p => ({ ...p, price_usd: p.price_decimal, conversions: calculateConversions(p.price_cents) })));
});

// ============================================================================
// 📢 SCHEDULER DE CANAL
// ============================================================================

class ChannelAutomationScheduler {
  constructor(db) {
    this.db = db;
  }
  async triggerAutomatedCampaignPost() {
    const activeDiscount = this.db.prepare("SELECT * FROM discounts WHERE is_active = 1 LIMIT 1").get();
    const featuredProduct = this.db.prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1").get();

    let message = `🎉 <b>¡OFERTA ESPECIAL Y CAMPAÑA EN DIGITALMARKET!</b> 🎉\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (activeDiscount) {
      message += `✨ <b>Campaña Activa: ${activeDiscount.festival_name}</b>\n`;
      message += `▫️ Llévate un <b>${activeDiscount.percent_off}% de descuento</b> aplicando el código: <code>${activeDiscount.code}</code>\n\n`;
    }
    if (featuredProduct) {
      message += `🔥 <b>Producto Destacado:</b>\n▫️ <b>${featuredProduct.name}</b> — <b>${featuredProduct.price_decimal} USD</b>\n\n`;
    }
    message += '🛒 ¡Haz clic abajo para entrar al bot y canjear tus cupones! 👇';
    
    await callTelegram('sendMessage', {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🚀 Abrir Tienda y Bot', url: `https://t.me/${BOT_USERNAME}?start=promo` }]] }
    });
  }
  startScheduler() {
    setTimeout(() => { this.triggerAutomatedCampaignPost(); }, 10000);
    setInterval(() => { this.triggerAutomatedCampaignPost(); }, 12 * 60 * 60 * 1000);
    console.log('📢 [ChannelAutomationScheduler] Programador de canal iniciado.');
  }
}

app.listen(PORT, () => {
  console.log(`🚀 DigitalMarket Servidor Autónomo unificado en puerto ${PORT}`);
  new ChannelAutomationScheduler(db).startScheduler();
});
