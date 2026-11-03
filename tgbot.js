'use strict';
// Telegram-бот игры: кнопка «Играть», продажа монет за Telegram Stars, поддержка.
// Работает через webhook: Telegram сам присылает события на наш сервер.
const crypto = require('crypto');
const store = require('./store.js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = (process.env.TG_API_BASE || 'https://api.telegram.org') + '/bot' + TOKEN;
const HOOK_SECRET = crypto.createHash('sha256').update('hook:' + TOKEN).digest('hex').slice(0, 32);
const SUPPORT = process.env.SUPPORT_CONTACT || ''; // например, @kaiser_support
let PACKS = [];
let appUrl = '';

async function api(method, params) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(`${method}: ${d.description || r.status}`);
  return d.result;
}

const TERMS = `Условия «Братвы»

• Монеты — внутриигровая валюта. Их нельзя вывести, обменять на деньги или передать вне игры.
• Монеты тратятся только на оформление (рамки, кубики, титулы), персонажей и подарки. В казино игры монеты не ставятся — там только игровые $ внутри партии.
• Покупка происходит через Telegram Stars. Если монеты не пришли в течение 5 минут — напиши /paysupport, разберёмся и вернём Stars.
• Возврат возможен, если монеты не потрачены.
• Нажимая «Оплатить», ты подтверждаешь, что прочитал эти условия.`;

async function setup(publicUrl, packs) {
  PACKS = packs;
  appUrl = publicUrl;
  if (!TOKEN || !/^https:\/\//.test(publicUrl)) { if (TOKEN) console.log('  Telegram-бот: нет https-адреса (PUBLIC_URL) — webhook не настроен'); return false; }
  try {
    await api('setWebhook', { url: `${publicUrl}/tg/hook`, secret_token: HOOK_SECRET, allowed_updates: ['message', 'pre_checkout_query'], drop_pending_updates: false });
    await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: publicUrl } } });
    await api('setMyCommands', { commands: [
      { command: 'start', description: 'Открыть игру' },
      { command: 'terms', description: 'Условия покупок' },
      { command: 'paysupport', description: 'Помощь с оплатой' },
    ] });
    console.log('  Telegram-бот: webhook и кнопка «Играть» настроены');
    return true;
  } catch (e) { console.error('  Telegram-бот: не удалось настроить —', e.message); return false; }
}

// Ссылка на оплату пакета монет. payload связывает платёж с аккаунтом.
async function invoiceLink(prof, packId) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error('Нет такого пакета');
  const payload = JSON.stringify({ k: prof.key, p: pack.id, n: crypto.randomBytes(4).toString('hex') });
  return api('createInvoiceLink', {
    title: `${pack.coins} монет — ${pack.label}`,
    description: `${pack.coins} монет в «Братву»: персонажи, рамки, кубики, титулы и подарки братве.`,
    payload, currency: 'XTR', prices: [{ label: `${pack.coins} монет`, amount: pack.stars }],
  });
}

function parsePayload(s) {
  try { const o = JSON.parse(s); return o && typeof o.k === 'string' && o.k.startsWith('tg:') ? o : null; } catch { return null; }
}

async function handle(u) {
  // 1) Telegram спрашивает «можно ли продать?» — ответить надо за 10 секунд
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query, o = parsePayload(q.invoice_payload);
    const pack = o && PACKS.find((p) => p.id === o.p);
    const ok = !!(pack && q.currency === 'XTR' && q.total_amount === pack.stars && o.k === 'tg:' + q.from.id);
    await api('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Платёж не прошёл проверку. Открой магазин в игре и попробуй ещё раз.' });
    return;
  }
  const m = u.message;
  if (!m) return;
  // 2) Оплата прошла — начисляем монеты (один раз на charge_id)
  if (m.successful_payment) {
    const sp = m.successful_payment, o = parsePayload(sp.invoice_payload);
    const pack = o && PACKS.find((p) => p.id === o.p);
    if (!pack) return console.error('payment: неизвестный пакет', sp.invoice_payload);
    const fresh = await store.recordPayment({ chargeId: sp.telegram_payment_charge_id, key: o.k, pack: pack.id, stars: sp.total_amount, coins: pack.coins, tgUser: m.from && m.from.id });
    if (fresh) await api('sendMessage', { chat_id: m.chat.id, text: `Готово: +${pack.coins} монет на счёт. Заходи в магазин.`, reply_markup: playButton() }).catch(() => {});
    return;
  }
  const text = (m.text || '').trim();
  if (/^\/start\b/.test(text)) {
    const code = (text.split(' ')[1] || '').replace(/\D/g, '').slice(0, 4);
    return api('sendMessage', {
      chat_id: m.chat.id,
      text: `БРАТВА — монополия девяностых\n\nКрышуй точки, забивай стрелки, не попадись ОМОНу и Глоку.${code ? `\n\nТебя зовут на сходку ${code}.` : '\n\nСоздай сходку и кинь ссылку друзьям прямо в чат.'}`,
      reply_markup: playButton(code),
    });
  }
  if (/^\/terms\b/.test(text)) return api('sendMessage', { chat_id: m.chat.id, text: TERMS });
  if (/^\/(paysupport|support)\b/.test(text)) {
    return api('sendMessage', { chat_id: m.chat.id, text: `Помощь с оплатой\n\nОпиши проблему одним сообщением: что покупал, когда и сколько Stars списалось.${SUPPORT ? ` Или напиши напрямую: ${SUPPORT}` : ''}\n\nВажно: поддержка Telegram не может помочь с покупками внутри ботов — пиши сюда.` });
  }
}

function playButton(code) {
  if (!appUrl) return undefined;
  return { inline_keyboard: [[{ text: 'Играть', web_app: { url: code ? `${appUrl}/?room=${code}` : appUrl } }]] };
}

async function refund(chargeId) {
  const p = await store.findPayment(chargeId);
  if (!p) throw new Error('Платёж не найден');
  return api('refundStarPayment', { user_id: Number(p.tg_user || p.tgUser), telegram_payment_charge_id: chargeId });
}

module.exports = { setup, handle, invoiceLink, refund, HOOK_SECRET, enabled: !!TOKEN, TERMS };
