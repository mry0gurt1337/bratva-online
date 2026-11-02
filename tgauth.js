'use strict';
// Вход через Telegram: проверка подписи данных от Telegram + выдача своей сессии.
// Нужны переменные окружения TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME.
const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const SECRET = process.env.SESSION_SECRET || (BOT_TOKEN ? crypto.createHash('sha256').update('bratva:' + BOT_TOKEN).digest('hex') : crypto.randomBytes(32).toString('hex'));
const MAX_AGE = 24 * 3600; // данные от Telegram старше суток не принимаем

const b64 = (s) => Buffer.from(s).toString('base64url');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function profile(u) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Без имени';
  return { key: 'tg:' + u.id, tg: true, id: String(u.id), name, username: u.username || null, photo: /^https:\/\//.test(u.photo_url || '') ? u.photo_url : null };
}

// Виджет «Войти через Telegram» на обычном сайте
function checkWidget(data) {
  if (!BOT_TOKEN || !data || !data.hash || !data.id) return null;
  const { hash, ...rest } = data;
  const check = Object.keys(rest).sort().filter((k) => rest[k] != null).map((k) => `${k}=${rest[k]}`).join('\n');
  const key = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const h = crypto.createHmac('sha256', key).update(check).digest('hex');
  if (!safeEq(h, String(hash))) return null;
  if (Date.now() / 1000 - Number(data.auth_date) > MAX_AGE) return null;
  return profile(data);
}

// Игра, открытая внутри Telegram (Mini App)
function checkWebApp(initData) {
  if (!BOT_TOKEN || typeof initData !== 'string' || initData.length > 4096) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const h = crypto.createHmac('sha256', key).update(check).digest('hex');
  if (!safeEq(h, hash)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > MAX_AGE) return null;
  try { return profile(JSON.parse(p.get('user'))); } catch { return null; }
}

// Наша сессия: подписанный токен, живёт 60 дней
function sign(prof) {
  const body = b64(JSON.stringify({ ...prof, exp: Math.floor(Date.now() / 1000) + 60 * 86400 }));
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!safeEq(good, sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

module.exports = { checkWidget, checkWebApp, sign, verify, enabled: !!BOT_TOKEN, botUsername: BOT_USERNAME };
