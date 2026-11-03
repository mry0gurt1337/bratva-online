'use strict';
// БРАТВА — сервер. Вся логика игры живёт здесь: клиенты только присылают
// «бросить», «купить», «стрелка», а кубики и деньги считает сервер.
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const store = require('./store.js');
const tg = require('./tgauth.js');
const bot = require('./tgbot.js');

// Клиентские файлы лежат в public/ (локально) или прямо рядом с server.js (версия для хостинга без папок)
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const G = require(path.join(PUB, 'shared.js'));
const ART = require(path.join(PUB, 'art.js'));
const { BOARD, C, SHOP, GIFTS, PACKS, BOOST, EARN } = G;
const PREMIUM = new Set(Object.values(SHOP).filter((x) => x.kind === 'char').map((x) => x.char));
const CHARS = ART.CHARS;

const PORT = Number(process.env.PORT) || 3000;
const SPEED = process.env.FAST ? 0.02 : 1; // FAST=1 — ускоренный режим для тестов
const T = (x) => Math.max(1, Math.round(x * SPEED));
// Темп партии: чтобы игроки успевали прочитать, что произошло
const PACE = 1.6;   // все паузы «показать результат» длиннее в 1.6 раза
const BEAT = 1300;  // минимальная пауза после любого хода перед передачей хода
const TURN_MS = 45000;      // время на ход
const OFFLINE_MS = 12000;   // если игрок отвалился — ждём меньше
const N = C.N;

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
const PUBLIC_RE = /^(index\.html|style\.css|game\.js|sound\.js|shared\.js|art\.js|icons\.js|manifest\.json|icon\.svg|logo\.svg|logo-mark\.svg|icon-\d+\.png|sfx-[a-z0-9-]+\.mp3|art-[a-z0-9-]+\.(?:png|jpe?g|webp))$/;
app.get('/:f?', (req, res, next) => {
  const f = req.params.f || 'index.html';
  if (!PUBLIC_RE.test(f)) return next();
  res.sendFile(path.join(PUB, f), { maxAge: /\.(mp3|png|jpe?g|webp)$/.test(f) ? '7d' : 0 });
});

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => score(a) - score(b));
}
app.get('/api/info', (req, res) => res.json({ urls: lanIPs().map((ip) => `http://${ip}:${PORT}`) }));
app.get('/api/assets', (req, res) => {
  // картинки, которые положили рядом с игрой (art-*.png/jpg/webp) — подхватываются автоматически
  try { res.json(fs.readdirSync(PUB).filter((f) => /^art-[a-z0-9-]+\.(png|jpe?g|webp)$/.test(f))); } catch { res.json([]); }
});
app.get('/api/config', (req, res) => res.json({ tg: tg.enabled, bot: tg.botUsername, db: store.kind }));
app.get('/api/qr', async (req, res) => {
  const u = String(req.query.u || '');
  if (!/^https?:\/\/\S{1,200}$/.test(u)) return res.status(400).end();
  try {
    const svg = await QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111014', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'max-age=3600').send(svg);
  } catch { res.status(500).end(); }
});
app.post('/api/auth/telegram', (req, res) => {
  const prof = tg.checkWidget(req.body || {});
  if (!prof) return res.status(401).json({ error: 'Telegram не подтвердил вход' });
  res.json({ session: tg.sign(prof), profile: prof });
});
app.post('/api/auth/webapp', (req, res) => {
  const prof = tg.checkWebApp((req.body || {}).initData);
  if (!prof) return res.status(401).json({ error: 'Telegram не подтвердил вход' });
  res.json({ session: tg.sign(prof), profile: prof });
});
// ---------- Кошелёк и магазин ----------
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(req.path, e); res.status(500).json({ error: 'Ошибка сервера, попробуй ещё раз' }); });
const who = (req) => account(req.body || {});
const hits = new Map(); // простой лимит запросов на ip
function limited(req, n = 30) {
  const k = req.ip + req.path, now = Date.now(), h = hits.get(k) || [];
  const fresh = h.filter((t) => now - t < 10000); fresh.push(now); hits.set(k, fresh);
  return fresh.length > n;
}
setInterval(() => hits.clear(), 60000).unref();

app.post('/api/me', wrap(async (req, res) => {
  const a = who(req);
  if (!a) return res.status(400).json({ error: 'Нет профиля' });
  res.json({ wallet: await store.wallet(a.key), stats: await store.playerStats(a.key), tg: a.tg, stars: bot.enabled && a.tg });
}));
app.post('/api/daily', wrap(async (req, res) => {
  const a = who(req);
  if (!a || limited(req, 5)) return res.status(429).json({ error: 'Не так быстро' });
  res.json(await store.claimDaily(a.key, EARN.daily));
}));
app.post('/api/buy', wrap(async (req, res) => {
  const a = who(req), id = String((req.body || {}).item || '');
  const it = SHOP[id];
  if (!a || !it) return res.status(400).json({ error: 'Нет такого товара' });
  if (limited(req, 10)) return res.status(429).json({ error: 'Не так быстро' });
  const w = await store.spend(a.key, it.price, id);
  if (!w) {
    const cur = await store.wallet(a.key);
    return res.status(402).json({ error: cur.items.includes(id) ? 'Уже куплено' : `Не хватает монет: нужно ${it.price} монет` });
  }
  // сразу надеваем купленное
  const slot = it.kind === 'char' ? null : it.kind;
  res.json({ wallet: slot ? await store.setEquip(a.key, slot, id) : w });
}));
app.post('/api/equip', wrap(async (req, res) => {
  const a = who(req), { slot, item } = req.body || {};
  if (!a || !['frame', 'dice', 'title', 'theme'].includes(slot)) return res.status(400).json({ error: 'Не тот слот' });
  const w = await store.wallet(a.key);
  if (item && (!SHOP[item] || SHOP[item].kind !== slot || !w.items.includes(item))) return res.status(400).json({ error: 'Сначала купи' });
  res.json({ wallet: await store.setEquip(a.key, slot, item || null) });
}));
app.post('/api/stars/invoice', wrap(async (req, res) => {
  const prof = tg.verify((req.body || {}).session);
  if (!bot.enabled) return res.status(503).json({ error: 'Оплата ещё не подключена' });
  if (!prof) return res.status(401).json({ error: 'Войди через Telegram, чтобы купить монеты' });
  if (limited(req, 6)) return res.status(429).json({ error: 'Не так быстро' });
  res.json({ link: await bot.invoiceLink(prof, String(req.body.pack || '')) });
}));
app.get('/api/terms', (req, res) => res.type('text/plain; charset=utf-8').send(bot.TERMS));
// Webhook Telegram: проверяем секрет, который сами выдали при setWebhook
app.post('/tg/hook', (req, res) => {
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== bot.HOOK_SECRET) return res.sendStatus(403);
  bot.handle(req.body || {}).catch((e) => console.error('tg hook', e.message)).finally(() => res.sendStatus(200));
});
// Возврат Stars (только для админа): списывает монеты и возвращает звёзды
app.post('/api/admin/refund', wrap(async (req, res) => {
  if (!process.env.ADMIN_KEY || req.get('x-admin-key') !== process.env.ADMIN_KEY) return res.sendStatus(403);
  const p = await store.findPayment(String((req.body || {}).charge || ''));
  if (!p) return res.status(404).json({ error: 'Платёж не найден' });
  if (!(await store.spend(p.key, p.coins))) return res.status(409).json({ error: 'Монеты уже потрачены — вернуть нельзя' });
  await bot.refund(p.charge_id || p.chargeId);
  res.json({ ok: true });
}));

app.get('/api/top', async (req, res) => {
  try { res.json({ rows: await store.top(String(req.query.sort || 'wins')), total: await store.count(), db: store.kind }); }
  catch (e) { console.error(e); res.status(500).json({ rows: [] }); }
});

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 8192 });

// ---------- Состояние ----------
const rooms = new Map();   // code -> room
const tokens = new Map();  // секретный токен игрока -> code комнаты
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));
const d6 = () => crypto.randomInt(1, 7);
const rnd = (n) => crypto.randomInt(n);
const BOT_NAMES = ['Шрам', 'Кабан', 'Седой', 'Лютый', 'Боцман', 'Хмурый', 'Гвоздь', 'Сиплый', 'Косой'];

function newCode() {
  let c;
  do { c = String(crypto.randomInt(1000, 10000)); } while (rooms.has(c));
  return c;
}
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
const cleanChar = (s) => (CHARS[s] && !CHARS[s].secret ? s : 'boec');
const has = (p, ch) => p && p.char === ch;

function makePlayer(r, name, char, account, bot = false) {
  const used = r.players.map((p) => p.color);
  return {
    id: crypto.randomBytes(4).toString('hex'),
    token: bot ? null : crypto.randomBytes(16).toString('hex'),
    name, char, color: G.COLORS.find((c) => !used.includes(c)) || G.COLORS[0],
    account: account || null, bot, connected: true, socketId: null,
    cos: {}, owned: [], wantBoost: false, boosted: false, gifts: 0,
    ...freshStats(),
  };
}
const freshStats = () => ({
  money: C.START_MONEY, auth: 0, goons: 0, pos: 0, jail: 0, bankrupt: false, doubles: 0, extra: false,
  st: { strelkaWon: 0, strelkaTotal: 0, glok: 0, rentIn: 0, rentOut: 0, casino: 0, jail: 0, bought: 0, maxMoney: C.START_MONEY },
});

function newRoom(code) {
  return {
    code, hostId: null, status: 'LOBBY', settings: { rounds: 20, glok: true, boosts: true }, players: [],
    turn: 0, phase: null, pending: null, props: {}, heat: 0, omon: null, pot: 0,
    logs: [], logSeq: 0, dice: null, lastMove: null, moveSeq: 0, fx: null, fxSeq: 0,
    round: 1, winner: null, standings: null, titles: null, deck: [], sealed: null,
    glokTask: null, glokCont: null, turnsSinceGlok: 0, offers: [],
    deadline: null, deadlineTotal: null, _timer: null, emptySince: null,
  };
}

function log(r, text, kind = 'info', extra = {}) {
  r.logs.push({ id: ++r.logSeq, text, kind, ...extra });
  if (r.logs.length > 40) r.logs.shift();
}

function publicState(r) {
  return {
    code: r.code, hostId: r.hostId, status: r.status, settings: r.settings,
    players: r.players.map((p) => ({
      id: p.id, name: p.name, char: p.char, color: p.color, money: p.money, auth: p.auth,
      goons: p.goons, pos: p.pos, jail: p.jail, bankrupt: p.bankrupt, bot: p.bot,
      connected: p.bot || p.connected, tg: !!(p.account && p.account.tg), photo: p.account && p.account.photo,
      frame: p.cos.frame || null, dice: p.cos.dice || null, title: p.cos.title || null,
      boost: p.boosted || p.wantBoost, gifts: p.gifts,
    })),
    turn: r.turn, phase: r.phase, pending: r.pending, props: r.props, heat: r.heat, omon: r.omon, pot: r.pot, inflation: r.inflation || 1,
    logs: r.logs, dice: r.dice, lastMove: r.lastMove, fx: r.fx, round: r.round,
    winner: r.winner, standings: r.standings, titles: r.titles, sealed: r.sealed,
    offers: r.offers.map(({ id, from, to, cell, price, mode, until }) => ({ id, from, to, cell, price, mode, ms: Math.max(0, until - Date.now()) })),
    crowd: r.crowd ? { seq: r.crowd.seq, a: r.crowd.a, o: r.crowd.o, cell: r.crowd.cell, joins: r.crowd.joins, ms: T(r.crowd.ms) } : null,
    event: r.event && r.event.round === r.round ? { id: r.event.id, title: r.event.title, text: r.event.text } : null, finale: finalStretch(r),
    glokTask: r.glokTask ? { seq: r.glokTask.seq, prize: r.glokTask.prize, ms: T(r.glokTask.ms), line: r.glokTask.line, taps: r.glokTask.taps } : null,
    remaining: r.deadline ? Math.max(0, r.deadline - Date.now()) : null, total: r.deadlineTotal,
  };
}
const sync = (r) => io.to(r.code).emit('state', publicState(r));

// ---------- Таймеры ----------
function clearTimer(r) { clearTimeout(r._timer); r._timer = null; r.deadline = null; r.deadlineTotal = null; }
function later(r, ms, fn) {
  clearTimer(r);
  r._timer = setTimeout(() => { r._timer = null; safe(fn); }, ms);
}
function withDeadline(r, ms, fn) {
  later(r, ms, fn);
  r.deadline = Date.now() + ms;
  r.deadlineTotal = ms;
}
function safe(fn) { try { fn(); } catch (e) { console.error('[game error]', e); } }

// ---------- Ход ----------
const cur = (r) => r.players[r.turn];
const byId = (r, id) => r.players.find((p) => p.id === id);
const active = (r) => r.players.filter((p) => !p.bankrupt);
const heat = (r, n) => { r.heat = Math.min(C.MAX_HEAT, r.heat + n); };
const cellName = (id) => BOARD[id].name;
const goonPrice = (p) => (has(p, 'gromila') ? 30 : C.GOON_PRICE);
const maxGoons = (p) => (has(p, 'gromila') ? 4 : C.MAX_GOONS);
const buyPrice = (p, c) => (has(p, 'baryga') ? Math.round((c.price * 0.8) / 5) * 5 : c.price);
const upPrice = (p, c) => (has(p, 'baryga') ? Math.round((c.up * 0.8) / 5) * 5 : c.up);
// Сила на стрелке: авторитет (не больше 3) + братки.
// Спортик держит свои точки: +1 к защите.
// Защитник получает +1 за свою землю и +1 за каждую звезду точки — прокачанную точку отжать труднее.
const AUTH_CAP = 3;
const power = (p) => Math.min(AUTH_CAP, p.auth) + p.goons;
const defense = (r, owner, cell) => power(owner) + 1 + ((r.props[cell] && r.props[cell].level) || 0) + (has(owner, 'boec') ? 1 : 0);
// шанс победы нападающего: кубик+сила против кубик+защита, ничья за хозяином
const winChance = (my, his) => { let w = 0; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + my > b + his) w++; return Math.round((w / 36) * 100); };
const track = (p) => { p.st.maxMoney = Math.max(p.st.maxMoney, p.money); };

function armTimer(r) {
  const p = cur(r);
  if (p.bot) return later(r, T(1700 + rnd(1100)), () => botAct(r));
  withDeadline(r, T(p.connected ? TURN_MS : OFFLINE_MS), () => autoAct(r));
}

function startTurn(r) {
  if (r.status !== 'PLAYING') return;
  const p = cur(r);
  if (p.jail > 0) { r.phase = 'DECIDE'; r.pending = { type: 'JAIL', bail: C.BAIL }; }
  else { r.phase = 'ROLL'; r.pending = null; }
  armTimer(r);
  sync(r);
}

function moveBy(r, p, steps) {
  if (has(p, 'shchipach') && steps > 1) {
    const passed = new Set(); for (let k = 1; k < steps; k++) passed.add((p.pos + k) % N);
    others(r, p).filter((o) => passed.has(o.pos) && !has(o, 'budka')).forEach((o) => {
      const got = pay(r, o, 15, p);
      if (got) log(r, `Щипач ${p.name} проехал мимо ${o.name} и вытащил $${got}`, 'rent', { pid: p.id });
    });
  }
  p.pos += steps;
  if (p.pos >= N) {
    p.pos -= N;
    const sal = (C.SALARY + (has(p, 'buhgalter') ? 40 : 0)) * (eventOn(r, 'gold') ? 2 : 1);
    // Общак своих не бросает: самому бедному — подъёмные сверху
    const al = active(r);
    const poorest = al.length > 2 && al.every((o) => o === p || netWorth(r, o) > netWorth(r, p));
    const help = poorest ? C.CATCHUP : 0;
    p.money += sal + help; track(p);
    log(r, `${p.name} заглянул в Общак: +$${sal}${help ? ` и ещё +$${help} — Общак своих не бросает` : ''}`, 'salary', { pid: p.id });
  }
}

function doRoll(r) {
  if (r.phase !== 'ROLL') return;
  const p = cur(r);
  const a = d6(), b = d6(), dbl = a === b;
  r.dice = { a, b, seq: (r.dice ? r.dice.seq : 0) + 1, by: p.id, skin: p.cos.dice || null };
  log(r, `${p.name} бросил ${a} + ${b}${dbl ? ' — ДУБЛЬ!' : ''}`, 'dice', { pid: p.id });
  r.phase = 'MOVING';
  r.pending = null;
  if (dbl) {
    p.doubles += 1;
    if (p.doubles >= 3) {
      p.doubles = 0; p.extra = false;
      log(r, `Три дубля подряд — ${p.name} привлёк внимание ментов`, 'police', { pid: p.id });
      sync(r);
      return later(r, T(2200), () => { sendToJail(r, p); afterAction(r); });
    }
    p.extra = true;
  } else { p.doubles = 0; p.extra = false; }
  const from = p.pos, steps = a + b;
  moveBy(r, p, steps);
  r.lastMove = { pid: p.id, from, steps, seq: ++r.moveSeq, delay: 1000 };
  sync(r);
  later(r, T(1000 + steps * C.HOP_MS + 600), () => land(r));
}

function sendToJail(r, p) {
  if (has(p, 'budka')) { log(r, `Будку не закрыть — у него всё схвачено`, 'goon', { pid: p.id }); return; }
  p.st.jail += 1;
  if (has(p, 'advokat')) {
    p.pos = C.JAIL; p.extra = false; p.doubles = 0;
    log(r, `Адвокат ${p.name} отмазался прямо в отделении — сидеть не будет`, 'goon', { pid: p.id });
    return;
  }
  if (p.goons > 0) {
    p.goons -= 1;
    log(r, `Браток взял вину на себя — ${p.name} на свободе`, 'goon', { pid: p.id });
    return;
  }
  p.pos = C.JAIL; p.jail = 1; p.extra = false; p.doubles = 0;
  log(r, `${p.name} уехал в тюрьму — пропускает ход`, 'jail', { pid: p.id });
}

function ask(r, pending) {
  r.phase = 'DECIDE';
  r.pending = pending;
  armTimer(r);
  sync(r);
}

function land(r) {
  const p = cur(r);
  if (r.omon !== null && p.pos === r.omon) {
    omonCheck(r);
    if (p.bankrupt) return afterAction(r);
  }
  const c = BOARD[p.pos];
  switch (c.type) {
    case 'start':
      if (r.pot > 0) {
        const won = r.pot; r.pot = 0; p.money += won; track(p);
        log(r, `${p.name} встал ровно на Общак и забрал джекпот $${won}!`, 'win', { pid: p.id });
        r.fx = { type: 'pot', pid: p.id, amount: won, seq: ++r.fxSeq };
        return afterAction(r, 1800);
      }
      return afterAction(r);
    case 'prop': return landProp(r, p, c);
    case 'gym':
      if (p.goons < maxGoons(p) && p.money >= goonPrice(p)) return ask(r, { type: 'GYM', price: goonPrice(p), max: maxGoons(p) });
      log(r, `${p.name} покачался в Качалке — без найма`, 'info', { pid: p.id });
      return afterAction(r);
    case 'casino': {
      const bets = [50, 100, 200].filter((x) => x <= p.money);
      if (bets.length) return ask(r, { type: 'CASINO', bets });
      log(r, `${p.name} постоял у Казино — денег на фишки нет`, 'info');
      return afterAction(r);
    }
    case 'card': return drawCard(r, p);
    case 'tax': {
      // налог с капитала: деньги + точки — богатый платит больше
      let t = Math.max(20, Math.round((netWorth(r, p) * 0.1) / 10) * 10);
      if (has(p, 'advokat')) t = Math.round(t / 20) * 10;
      if (has(p, 'budka')) { log(r, `Налоговая: к Будке не сунулись`, 'info', { pid: p.id }); return afterAction(r, 300); }
      log(r, `Налоговая: ${p.name} заносит $${t} — деньги ушли в Общак`, 'loss', { pid: p.id });
      pay(r, p, t, null);
      return afterAction(r, 300);
    }
    case 'police':
      if (has(p, 'oboroten')) {
        log(r, `Оборотень ${p.name} зашёл к своим в отдел — сидеть не будет`, 'goon', { pid: p.id });
        return afterAction(r, 400);
      }
      sendToJail(r, p); return afterAction(r, 400);
    case 'jail': log(r, `${p.name} навестил кентов в тюрьме`, 'info'); return afterAction(r);
    default: return afterAction(r);
  }
}

// Текущая доля с точки: базовая рента × беспредел × Коммерсант × события района
function rentNow(r, cell, owner) {
  let x = G.rentOf(r.props, cell) * (r.inflation || 1);
  if (owner && has(owner, 'kommers')) x *= 1.15;
  if (eventOn(r, 'rush')) x *= 2;
  if (finalStretch(r)) x *= 1.5;
  return Math.round(x / 5) * 5;
}
const netW = (r, p) => netWorth(r, p);
const isLeader = (r, p) => { const al = active(r); return al.length > 1 && al.every((o) => o === p || netW(r, o) < netW(r, p)); };

function landProp(r, p, c) {
  const pr = r.props[c.id];
  if (!pr) {
    const price = buyPrice(p, c);
    if (p.money >= price) return ask(r, { type: 'BUY', cell: c.id, price });
    log(r, `${p.name} не тянет «${c.name}» ($${price})`, 'info');
    return afterAction(r);
  }
  if (pr.owner === p.id) {
    if (pr.level < C.MAX_LEVEL && p.money >= upPrice(p, c)) return ask(r, { type: 'UPGRADE', cell: c.id, price: upPrice(p, c), level: pr.level });
    return afterAction(r);
  }
  const owner = byId(r, pr.owner);
  if (!owner || owner.bankrupt) return afterAction(r);
  if (r.sealed && r.sealed.cell === c.id && r.round <= r.sealed.until) {
    log(r, `«${c.name}» опечатана Глоком — ${p.name} проходит бесплатно`, 'glok');
    return afterAction(r);
  }
  const rent = rentNow(r, c.id, owner);
  const my = power(p) + (eventOn(r, 'peredel') ? 2 : 0), his = defense(r, owner, c.id);
  const leader = isLeader(r, owner) && active(r).length >= 3;
  return ask(r, { type: 'STRELKA', cell: c.id, rent, owner: owner.id, ownerName: owner.name, my, his, chance: winChance(my, his), level: r.props[c.id].level,
    noFight: has(owner, 'budka'), crowd: leader && !has(owner, 'budka') });
}

// ---------- Карточки «Звонок с зоны» ----------
const others = (r, p) => r.players.filter((o) => o !== p && !o.bankrupt);
const CARDS = [
  { t: 'Братва подогнала подогрев: +$100', f: (r, p) => { p.money += 100; } },
  { t: 'Нашёл заначку в старой куртке: +$50', f: (r, p) => { p.money += 50; } },
  { t: 'Адвокат выставил счёт: −$80', f: (r, p) => pay(r, p, 80, null) },
  { t: 'Сбор с района: каждый платит тебе $25', f: (r, p) => others(r, p).forEach((o) => pay(r, o, 25, p)) },
  { t: 'Скинулся на общак: по $20 каждому', f: (r, p) => others(r, p).forEach((o) => pay(r, p, 20, o)) },
  { t: 'Порешал вопрос красиво: авторитет +1', f: (r, p) => { p.auth = Math.min(AUTH_CAP, p.auth + 1); } },
  { t: 'Кто-то стуканул: розыск +2', f: (r) => heat(r, 2) },
  { t: 'Связи в прокуратуре: розыск обнулён', f: (r) => { r.heat = 0; r.omon = null; } },
  { t: 'В бригаду пришёл новый браток', f: (r, p) => { p.goons = Math.min(maxGoons(p), p.goons + 1); } },
  { t: 'Срочно вызывают на Рублёвку', move: 19 },
  { t: 'Прямиком к ментам!', f: (r, p) => sendToJail(r, p) },
  { t: 'Проверка бизнеса: $20 за каждую точку и звезду', f: (r, p) => {
    const n = Object.values(r.props).filter((v) => v.owner === p.id).reduce((s, v) => s + 1 + v.level, 0);
    if (n) pay(r, p, n * 20, null);
  } },
  { t: 'Нашёл ключ от общака: забирай половину джекпота', f: (r, p) => { const h = Math.floor(r.pot / 2); r.pot -= h; p.money += h; } },
];
function drawCard(r, p) {
  if (!r.deck.length) r.deck = shuffle(CARDS.map((_, i) => i));
  const card = CARDS[r.deck.pop()];
  log(r, `${p.name}: ${card.t}`, 'card', { pid: p.id });
  r.fx = { type: 'card', text: card.t, pid: p.id, seq: ++r.fxSeq };
  if (card.move != null) {
    r.phase = 'ANIM';
    sync(r);
    return later(r, T(3200), () => {
      const from = p.pos, steps = (card.move - from + N) % N;
      moveBy(r, p, steps);
      r.lastMove = { pid: p.id, from, steps, seq: ++r.moveSeq, delay: 0 };
      sync(r);
      later(r, T(steps * C.HOP_MS + 600), () => land(r));
    });
  }
  const before = p.money;
  card.f(r, p);
  const d = p.money - before;
  if (!p.bankrupt && d && has(p, 'ekstrasens')) {
    const k = d > 0 ? Math.round(d * 0.5) : Math.round(-d * 0.5);
    p.money += k;
    log(r, `Экстрасенс ${p.name} всё предвидел: ${d > 0 ? '+' : 'вернул '}$${k}`, 'card', { pid: p.id });
  } else if (!p.bankrupt && d < 0 && has(p, 'budka')) { p.money -= d; log(r, `Будке это не грозит — деньги при нём`, 'card', { pid: p.id }); }
  track(p);
  afterAction(r, 2000);
}

// ---------- Деньги и банкротство ----------
// to === null — деньги уходят в джекпот Общака
function pay(r, p, amount, to) {
  if (r._glok && has(p, 'budka')) amount *= 2; // на Будку действует только Глок — и бьёт вдвое
  p.money -= amount;
  if (p.money < 0) liquidate(r, p);
  const paid = Math.max(0, p.money < 0 ? amount + p.money : amount);
  if (to && !to.bankrupt) { to.money += paid; track(to); }
  else if (!to) r.pot += Math.floor(paid / 2); // половина — в джекпот Общака, половина сгорает
  if (p.money < 0) bankrupt(r, p);
  return paid;
}
function liquidate(r, p) {
  const mine = Object.entries(r.props)
    .filter(([, v]) => v.owner === p.id)
    .map(([k, v]) => ({ id: +k, value: Math.floor(G.cellValue(+k, v.level) / 2) }))
    .sort((a, b) => a.value - b.value);
  while (p.money < 0 && mine.length) {
    const m = mine.shift();
    delete r.props[m.id];
    p.money += m.value;
    log(r, `${p.name} скинул «${cellName(m.id)}» банку за $${m.value}`, 'sell', { pid: p.id });
  }
}
function bankrupt(r, p) {
  if (p.bankrupt) return;
  p.bankrupt = true; p.money = 0; p.jail = 0; p.extra = false;
  for (const [k, v] of Object.entries(r.props)) if (v.owner === p.id) delete r.props[k];
  r.offers = r.offers.filter((o) => o.from !== p.id && o.to !== p.id);
  log(r, `${p.name} разорён и выбывает`, 'bankrupt', { pid: p.id });
}
function netWorth(r, p) {
  if (p.bankrupt) return 0;
  return p.money + Object.entries(r.props).filter(([, v]) => v.owner === p.id)
    .reduce((s, [k, v]) => s + G.cellValue(+k, v.level), 0);
}

// ---------- Решения ----------
const DEFAULTS = { BUY: 'no', UPGRADE: 'no', GYM: 'no', CASINO: 'skip', OCHKO: 'stand', STRELKA: 'pay', JAIL: 'wait' };

// ---------- Казино «Три топора» ----------
// Три игры: однорукий бандит, рулетка, очко (21 на 36 карт). Всё считает сервер.
const SLOT_SYMS = [['cherry', 30, 3], ['lemon', 25, 4], ['bell', 20, 6], ['diamond', 15, 10], ['seven', 10, 25]];
const SLOT_NAMES = { cherry: 'вишни', lemon: 'лимона', bell: 'колокола', diamond: 'бриллианта', seven: 'семёрки' };
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RANKS = [['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['В', 2], ['Д', 3], ['К', 4], ['Т', 11]];
const SUITS = ['s', 'h', 'd', 'c']; // пики, черви, бубны, трефы
const cardVal = (c) => RANKS.find(([r]) => r === c.r)[1];
const handSum = (h) => h.reduce((s, c) => s + cardVal(c), 0);
const golden = (h) => h.length === 2 && h.every((c) => c.r === 'Т');

function slotSpin() {
  const total = SLOT_SYMS.reduce((s, x) => s + x[1], 0);
  const one = () => { let x = rnd(total); for (const sym of SLOT_SYMS) { if ((x -= sym[1]) < 0) return sym; } return SLOT_SYMS[0]; };
  return [one(), one(), one()];
}
// Выплата игроку (прибыль). Шулер получает +50% к выигрышу.
function casinoWin(r, p, profit, text, extraFx) {
  if (has(p, 'shuler') && profit > 0) profit = Math.round(profit * 1.5);
  p.money += profit; track(p); heat(r, 1);
  log(r, `${p.name}: ${text} — +$${profit}`, 'win', { pid: p.id });
  return profit;
}
function casinoLose(r, p, bet, text) {
  pay(r, p, bet, null);
  log(r, `${p.name}: ${text} — −$${bet}`, 'loss', { pid: p.id });
}

function casinoPlay(r, p, q, choice) {
  const [game, b, pick] = String(choice).split(':');
  const bet = Number(b);
  if (game === 'skip' || !q.bets.includes(bet) || p.money < bet) { log(r, `${p.name} прошёл мимо казино`, 'info'); return 0; }
  p.st.casino += 1;
  if (game === 'slots') {
    const reels = slotSpin();
    const syms = reels.map((x) => x[0]);
    let profit = 0, text;
    if (syms[0] === syms[1] && syms[1] === syms[2]) { profit = bet * (reels[0][2] - 1); text = syms[0] === 'seven' ? 'ТРИ СЕМЁРКИ, ДЖЕКПОТ' : `три ${SLOT_NAMES[syms[0]]}`; }
    else if (syms[0] === syms[1] || syms[1] === syms[2] || syms[0] === syms[2]) { profit = Math.round(bet * 0.2); text = 'пара на автомате'; }
    const won = profit > 0 ? casinoWin(r, p, profit, text, {}) : 0;
    if (!profit) casinoLose(r, p, bet, 'автомат съел ставку');
    r.fx = { type: 'slots', pid: p.id, bet, reels: syms, won, seq: ++r.fxSeq };
    return 3000;
  }
  if (game === 'roulette') {
    const color = ['red', 'black', 'zero'].includes(pick) ? pick : 'red';
    const n = rnd(37);
    const res = n === 0 ? 'zero' : RED.has(n) ? 'red' : 'black';
    const name = { red: 'красное', black: 'чёрное', zero: 'зеро' };
    let won = 0;
    if (res === color) won = casinoWin(r, p, bet * (color === 'zero' ? 35 : 1), `рулетка, ${n} ${name[res]}`, {});
    else casinoLose(r, p, bet, `рулетка, выпало ${n} ${name[res]}, а ставил на ${name[color]}`);
    r.fx = { type: 'roulette', pid: p.id, bet, n, color, res, won, seq: ++r.fxSeq };
    return 4200;
  }
  if (game === 'ochko') {
    const deck = shuffle(RANKS.flatMap(([rk]) => SUITS.map((st) => ({ r: rk, s: st }))));
    const hand = [deck.pop(), deck.pop()], dealer = [deck.pop(), deck.pop()];
    r._ochko = { deck, dealer };
    log(r, `${p.name} сел играть в очко на $${bet}`, 'info', { pid: p.id });
    if (golden(hand) || handSum(hand) === 21) { r.pending = { type: 'OCHKO', bet, hand, dealer: [dealer[0]] }; return ochkoFinish(r, p, r.pending); }
    ask(r, { type: 'OCHKO', bet, hand, sum: handSum(hand), dealer: has(p, 'shuler') ? dealer : [dealer[0]], peek: has(p, 'shuler') });
    return 'ochko';
  }
  return 0;
}

function ochkoStep(r, p, q, choice) {
  if (choice === 'hit' && r._ochko) {
    q.hand.push(r._ochko.deck.pop());
    q.sum = handSum(q.hand);
    if (q.sum < 21) { ask(r, q); return 'more'; }
  }
  return ochkoFinish(r, p, q);
}

function ochkoFinish(r, p, q) {
  const o = r._ochko || { dealer: q.dealer, deck: [] };
  const me = handSum(q.hand), gold = golden(q.hand);
  let d = handSum(o.dealer);
  if (me <= 21 || gold) while (d < 17 && o.deck.length) { o.dealer.push(o.deck.pop()); d = handSum(o.dealer); }
  let result, won = 0;
  if (gold) { result = 'golden'; won = casinoWin(r, p, Math.round(q.bet * 1.5), 'ЗОЛОТОЕ ОЧКО (два туза)', {}); }
  else if (me > 21) { result = 'bust'; casinoLose(r, p, q.bet, `перебор ${me}`); }
  else if (me === 21 && q.hand.length === 2) { result = 'natural'; won = casinoWin(r, p, Math.round(q.bet * 1.5), 'очко с раздачи', {}); }
  else if (d > 21 || me > d) { result = 'win'; won = casinoWin(r, p, q.bet, `очко ${me} против ${d}`, {}); }
  else if (me === d) { result = 'push'; log(r, `${p.name}: ничья в очко, ${me} на ${d} — ставка вернулась`, 'info', { pid: p.id }); }
  else { result = 'lose'; casinoLose(r, p, q.bet, `очко ${me} против ${d} у крупье`); }
  r._ochko = null;
  r.fx = { type: 'ochko', pid: p.id, bet: q.bet, hand: q.hand, dealer: o.dealer, me, d, result, won, seq: ++r.fxSeq };
  return 3000;
}
function autoAct(r) {
  if (r.status !== 'PLAYING') return;
  const p = cur(r);
  if (r.phase === 'ROLL') { log(r, `${p.name} уснул — кости брошены за него`, 'info'); return doRoll(r); }
  if (r.phase === 'DECIDE' && r.pending) resolve(r, DEFAULTS[r.pending.type]);
}

function resolve(r, choice) {
  if (r.phase !== 'DECIDE' || !r.pending) return;
  const p = cur(r), q = r.pending;
  r.pending = null;
  clearTimer(r);
  let delay = 0;
  switch (q.type) {
    case 'BUY': {
      const c = BOARD[q.cell];
      if (choice === 'yes' && p.money >= q.price && !r.props[q.cell]) {
        p.money -= q.price;
        r.props[q.cell] = { owner: p.id, level: 0 };
        p.st.bought += 1;
        heat(r, 1);
        const mono = G.ownsGroup(r.props, p.id, c.group);
        log(r, `${p.name} взял под крышу «${c.name}»${mono ? ' — весь район его!' : ''}`, 'buy', { pid: p.id });
      } else log(r, `${p.name} прошёл мимо «${c.name}»`, 'info');
      break;
    }
    case 'UPGRADE': {
      const c = BOARD[q.cell], pr = r.props[q.cell];
      if (choice === 'yes' && pr && pr.owner === p.id && pr.level < C.MAX_LEVEL && p.money >= upPrice(p, c)) {
        p.money -= upPrice(p, c); pr.level += 1; heat(r, 1);
        log(r, `${p.name} прокачал «${c.name}» до ${pr.level} ${pr.level === 1 ? 'звезды' : 'звёзд'}`, 'buy', { pid: p.id });
      }
      break;
    }
    case 'GYM':
      if (choice === 'yes' && p.money >= q.price && p.goons < maxGoons(p)) {
        p.money -= q.price; p.goons += 1;
        log(r, `${p.name} нанял братка (теперь ${p.goons})`, 'goon', { pid: p.id });
      }
      break;
    case 'CASINO': {
      const d = casinoPlay(r, p, q, choice);
      if (d === 'ochko') return; // ждём решений в очко
      delay = d;
      break;
    }
    case 'OCHKO': {
      const d = ochkoStep(r, p, q, choice);
      if (d === 'more') return;
      delay = d;
      break;
    }
    case 'STRELKA': {
      const owner = byId(r, q.owner), pr = r.props[q.cell];
      if (!owner || owner.bankrupt || !pr || pr.owner !== owner.id) break;
      if (choice === 'fight' && q.noFight) choice = 'pay';
      if (choice === 'crowd' && q.crowd) return startCrowd(r, p, owner, q);
      if (choice === 'fight') { strelka(r, p, owner, q); delay = 2600; }
      else {
        log(r, `${p.name} отдал долю $${q.rent}, хозяин — ${owner.name}`, 'rent', { pid: p.id });
        const paid = pay(r, p, q.rent, owner);
        p.st.rentOut += paid; owner.st.rentIn += paid;
      }
      break;
    }
    case 'JAIL':
      if (choice === 'pay' && p.money >= q.bail) {
        pay(r, p, q.bail, null); p.jail = 0;
        log(r, `${p.name} занёс залог $${q.bail} и вышел`, 'info', { pid: p.id });
        r.phase = 'ROLL';
        armTimer(r);
        return sync(r);
      }
      p.jail = 0;
      log(r, `${p.name} отсидел ход`, 'jail', { pid: p.id });
      if (has(p, 'sidelets')) { p.money += 60; p.auth = Math.min(AUTH_CAP, p.auth + 1); track(p); log(r, `Сиделец ${p.name} вышел с понтом: +$60 и авторитет`, 'goon', { pid: p.id }); }
      return endTurn(r);
  }
  afterAction(r, delay);
}

function strelka(r, p, owner, q, crew = []) {
  const aRoll = d6(), oRoll = d6();
  const bonus = (eventOn(r, 'peredel') ? 2 : 0) + crew.length * CROWD_POWER;
  const aP = aRoll + power(p) + bonus, oP = oRoll + defense(r, owner, q.cell);
  const win = aP > oP; // ничья — за хозяином
  heat(r, 2);
  p.st.strelkaTotal += 1;
  r.fx = { type: 'strelka', seq: ++r.fxSeq, a: p.id, o: owner.id, aRoll, oRoll, aP, oP, win, cell: q.cell, crew: crew.map((x) => x.id) };
  // подмога: при победе каждому по $50 с хозяина, при сливе — каждый платит хозяину $40
  crew.forEach((x) => {
    if (win) { const g = pay(r, owner, 50, x); if (g) log(r, `${x.name} вписался в наезд и снял с ${owner.name} $${g}`, 'strelka', { pid: x.id }); }
    else { const g = pay(r, x, 40, owner); if (g) log(r, `${x.name} вписался зря — отдал ${owner.name} $${g}`, 'strelka', { pid: x.id }); }
  });
  const c = BOARD[q.cell];
  if (win) {
    const pr = r.props[q.cell];
    pr.owner = p.id; pr.level = 0; // при отжиме все звёзды слетают
    p.auth = Math.min(AUTH_CAP, p.auth + 1); owner.auth = Math.max(0, owner.auth - 1);
    p.st.strelkaWon += 1;
    // по понятиям: прежнему хозяину откуп — половина цены точки
    const ransom = Math.round(c.price / 2 / 10) * 10;
    const paidR = pay(r, p, ransom, owner);
    log(r, `Стрелка: ${p.name} ${aP} против ${owner.name} ${oP} — «${c.name}» отжата, откуп $${paidR}, звёзды слетели`, 'strelka', { pid: p.id });
  } else {
    const pen = q.rent * (has(p, 'advokat') ? 1 : 2); // адвокат отмазывает от двойного штрафа
    if (p.goons > 0) p.goons -= 1; else p.auth = Math.max(0, p.auth - 1);
    log(r, `Стрелка: ${p.name} ${aP} против ${owner.name} ${oP} — слил, штраф $${pen}`, 'strelka', { pid: p.id });
    const paid = pay(r, p, pen, owner);
    owner.st.rentIn += paid;
  }
}

// ---------- Наезд толпой ----------
// Если хозяин точки — самый богатый, можно позвать остальных вписаться. Каждый вписавшийся даёт +2 к силе.
const CROWD_POWER = 2, CROWD_MS = 8000;
function startCrowd(r, p, owner, q) {
  const seq = ++r.fxSeq;
  r.crowd = { seq, a: p.id, o: owner.id, cell: q.cell, q, joins: [], ms: CROWD_MS };
  r.phase = 'CROWD'; r.pending = null;
  log(r, `${p.name} зовёт братву на наезд против ${owner.name} — кто впишется?`, 'strelka', { pid: p.id });
  // боты вписываются, если хозяин сильно впереди
  others(r, p).filter((x) => x.bot && x !== owner).forEach((x) => {
    if (rnd(100) < 65) setTimeout(() => safe(() => crowdJoin(r, x, seq)), T(1500 + rnd(4000)));
  });
  sync(r);
  later(r, T(CROWD_MS), () => finishCrowd(r));
}
function crowdJoin(r, x, seq) {
  const c = r.crowd;
  if (!c || c.seq !== seq || x.bankrupt || x.id === c.a || x.id === c.o || c.joins.includes(x.id)) return;
  c.joins.push(x.id);
  sync(r);
}
function finishCrowd(r) {
  const c = r.crowd;
  if (!c) return;
  r.crowd = null; clearTimer(r);
  const p = byId(r, c.a), owner = byId(r, c.o);
  if (!p || !owner || owner.bankrupt || p.bankrupt || !r.props[c.cell] || r.props[c.cell].owner !== owner.id) return afterAction(r);
  const crew = c.joins.map((id) => byId(r, id)).filter((x) => x && !x.bankrupt);
  log(r, crew.length ? `В наезд вписались: ${crew.map((x) => x.name).join(', ')} (+${crew.length * CROWD_POWER} к силе)` : 'Никто не вписался — идёт один', 'strelka', { pid: p.id });
  r.phase = 'DECIDE';
  strelka(r, p, owner, c.q, crew);
  afterAction(r, 2600);
}

// ---------- События района и финал ----------
const EVENTS = [
  { id: 'rush', title: 'ЧАС ПИК', text: 'Весь круг доля со всех точек ×2.' },
  { id: 'gold', title: 'ЖИРНЫЙ КРУГ', text: 'Весь круг Общак платит вдвое.' },
  { id: 'peredel', title: 'ПЕРЕДЕЛ', text: 'Весь круг нападающий на стрелке получает +2 к силе.' },
  { id: 'raid', title: 'ОБЛАВА', text: 'Розыск сразу +2. Осторожнее с покупками.', now: (r) => heat(r, 2) },
  { id: 'default', title: 'ДЕФОЛТ', text: 'У всех сгорает 10% наличных — половина уходит в Общак.', now: (r) => active(r).forEach((p) => { if (!has(p, 'budka')) pay(r, p, Math.round(p.money * 0.1), null); }) },
  { id: 'amnesty', title: 'АМНИСТИЯ', text: 'Все выходят из тюрьмы, розыск обнулён.', now: (r) => { r.players.forEach((p) => { p.jail = 0; }); r.heat = 0; r.omon = null; } },
];
const eventOn = (r, id) => !!(r.event && r.event.id === id && r.event.round === r.round);
const finalStretch = (r) => !!(r.settings.rounds && r.round > r.settings.rounds - 3);
function roundStart(r) {
  r.event = null;
  const R = r.settings.rounds;
  if (R && r.round === R - 2) {
    r.fx = { type: 'event', title: 'ПОСЛЕДНИЕ ДЕНЬКИ', text: 'Осталось 3 круга. Доля со всех точек ×1.5 до конца игры.', seq: ++r.fxSeq };
    log(r, 'Последние деньки: 3 круга до конца, доля ×1.5', 'omon');
    return;
  }
  if (r.round >= 3 && r.round % 3 === 0) {
    const e = EVENTS[rnd(EVENTS.length)];
    r.event = { id: e.id, title: e.title, text: e.text, round: r.round };
    if (e.now) e.now(r);
    r.fx = { type: 'event', title: e.title, text: e.text, seq: ++r.fxSeq };
    log(r, `Событие района — ${e.title.toLowerCase()}: ${e.text}`, 'omon');
  }
}

function afterAction(r, delay = 0, paused = false) {
  if (r.status !== 'PLAYING') return;
  if (!paused) {
    // всегда даём секунду-две посмотреть результат хода
    delay = Math.max(Math.round(delay * PACE), BEAT);
    r.phase = 'ANIM'; r.pending = null;
    sync(r);
    return later(r, T(delay), () => afterAction(r, 0, true));
  }
  if (checkWin(r)) return;
  const p = cur(r);
  if (p.extra && !p.bankrupt && !p.jail) {
    p.extra = false;
    log(r, `${p.name} кидает ещё раз — дубль`, 'info');
    r.phase = 'ROLL'; r.pending = null;
    armTimer(r);
    return sync(r);
  }
  p.extra = false;
  endTurn(r);
}

// ---------- ОМОН ----------
function omonStep(r) {
  if (r.omon === null) {
    if (r.heat >= C.MAX_HEAT) {
      r.omon = C.POLICE;
      log(r, 'ОМОН выехал на облаву', 'omon');
      omonCheck(r);
    }
    return;
  }
  for (let i = 0; i < 2 && r.omon !== null; i++) {
    r.omon = (r.omon - 1 + N) % N;
    omonCheck(r);
  }
}
function omonCheck(r) {
  const hit = r.players.filter((p) => !p.bankrupt && p.pos === r.omon && !has(p, 'oboroten') && !has(p, 'budka'));
  const wolf = active(r).find((p) => has(p, 'oboroten'));
  if (!hit.length) return;
  for (const p of hit) {
    if (p.goons > 0) { p.goons -= 1; log(r, `ОМОН накрыл ${p.name} — браток присел за него`, 'omon', { pid: p.id }); }
    else {
      const fine = has(p, 'reshala') ? Math.round(C.OMON_FINE / 2) : C.OMON_FINE;
      log(r, `ОМОН повязал ${p.name}: штраф $${fine}${wolf ? ` — половина ушла Оборотню ${wolf.name}` : ''}`, 'omon', { pid: p.id });
      if (wolf) { pay(r, p, Math.floor(fine / 2), wolf); pay(r, p, Math.ceil(fine / 2), null); } else pay(r, p, fine, null);
    }
  }
  r.omon = null; r.heat = 0;
  log(r, 'Облава закончена, розыск сброшен', 'info');
}

// ---------- Смотрящий Глок ----------
// Бандит, который держит район. Приходит между ходами и устраивает движ.
const GLOK_LINES = [
  'Чё, пацаны, без меня веселитесь?', 'Район мой, правила мои.', 'Ничего личного, просто бизнес.',
  'Скучно мне что-то, братва…', 'Кто тут самый борзый?', 'Сюрприз, бродяги!', 'Я ненадолго. Наверное.',
  'Расслабились? Зря.', 'Глок пришёл — Глок решает.',
];
const victims = (r) => active(r).filter((p) => !has(p, 'reshala')); // Решалу Глок не трогает
const richest = (r) => victims(r).slice().sort((a, b) => b.money - a.money)[0];
const poorest = (r) => active(r).slice().sort((a, b) => a.money - b.money)[0];
const two = (r) => { const a = shuffle(victims(r).slice()); return a.length >= 2 ? [a[0], a[1]] : null; };
const hurt = (p, amount) => { p.st.glok += amount; };
const GLOK_EVENTS = [
  { w: 3, f(r) {
    const a = richest(r), b = poorest(r);
    if (!a || a === b) return null;
    const x = Math.max(20, Math.round((a.money * 0.15) / 10) * 10);
    hurt(a, pay(r, a, x, b));
    return { title: 'ШМОН', text: `Отобрал у ${a.name} $${x} и отдал ${b.name}. «Делиться надо!»` };
  } },
  { w: 3, f(r) {
    if (!victims(r).length) return null;
    victims(r).forEach((p) => hurt(p, pay(r, p, 25, null)));
    return { title: 'НА ЧАЙ', text: 'Каждый заносит Глоку по $25. Деньги ушли в Общак.' };
  } },
  { w: 2, f(r) {
    const p = active(r)[rnd(active(r).length)];
    p.money += 150; track(p);
    return { title: 'ГЛОК ДОБРЫЙ', text: `${p.name} получает $150. Просто так. Не привыкай.` };
  } },
  { w: 2, f(r) {
    const t = two(r); if (!t) return null;
    [t[0].pos, t[1].pos] = [t[1].pos, t[0].pos];
    return { title: 'ПЕРЕСАДКА', text: `${t[0].name} и ${t[1].name} поменялись местами. Глок так видит.` };
  } },
  { w: 1, f(r) {
    const t = two(r); if (!t) return null;
    const d = Math.abs(t[0].money - t[1].money);
    hurt(t[0].money > t[1].money ? t[0] : t[1], d);
    [t[0].money, t[1].money] = [t[1].money, t[0].money];
    track(t[0]); track(t[1]);
    return { title: 'ПЕРЕПУТАЛ БАБКИ', text: `${t[0].name} и ${t[1].name} обменялись ВСЕМИ деньгами. Упс.` };
  } },
  { w: 2, f(r) {
    active(r).forEach((p) => { p.pos = (p.pos - 3 + N) % N; });
    return { title: 'ВСЕ НАЗАД!', text: 'Глок сказал отойти. Все отползают на 3 клетки назад.' };
  } },
  { w: 2, f(r) {
    const owned = Object.keys(r.props).filter((k) => !has(byId(r, r.props[k].owner), 'reshala'));
    if (!owned.length) return null;
    const cell = +owned[rnd(owned.length)];
    r.sealed = { cell, until: r.round + 2 };
    const o = byId(r, r.props[cell].owner);
    return { title: 'ТОЧКА ЗАКРЫТА', text: `«${cellName(cell)}» (${o ? o.name : '—'}) — Глок закрыл на 2 круга. Ренты нет.` };
  } },
  { w: 1, f(r) {
    if (r.omon !== null) return null;
    r.heat = C.MAX_HEAT; r.omon = C.POLICE;
    return { title: 'СДАЛ ВСЕХ', text: 'Глок позвонил кому надо. ОМОН уже выехал на район.' };
  } },
  { w: 2, f(r) {
    r.players.forEach((p) => { p.jail = 0; });
    r.heat = 0; r.omon = null;
    return { title: 'ГЛОК ПОРЕШАЛ', text: 'У Глока днюха: все на свободе, розыск сброшен.' };
  } },
  { w: 2, f(r) {
    const p = victims(r).filter((x) => x.goons > 0).sort((a, b) => b.goons - a.goons)[0];
    if (!p) return null;
    p.goons -= 1;
    return { title: 'ПЕРЕМАНИЛ', text: `Глок переманил братка у ${p.name}. «У меня платят лучше».` };
  } },
  { w: 2, f(r) {
    if (r.pot < 100) return null;
    const x = r.pot; r.pot = 0;
    return { title: 'ОБНЕС ОБЩАК', text: `Глок забрал весь джекпот Общака — $${x}. «Я же смотрящий».` };
  } },
  { w: 6, challenge: true },
];

function maybeGlok(r, cont) {
  r.turnsSinceGlok = (r.turnsSinceGlok || 0) + 1;
  const chance = process.env.GLOK_ALWAYS ? 100 : 16;
  if (!r.settings.glok || r.round < 2 || r.turnsSinceGlok < 4 || rnd(100) >= chance || active(r).length < 2) return cont();
  r.turnsSinceGlok = 0;
  // с Будки Глок берёт своё при каждом приходе
  active(r).filter((p) => has(p, 'budka')).forEach((p) => {
    const t = Math.max(30, Math.round((netWorth(r, p) * 0.08) / 10) * 10);
    const g = pay(r, p, t, null);
    if (g) log(r, `Глок напомнил Будке, кто тут главный: −$${g}`, 'glok', { pid: p.id });
  });
  const pool = GLOK_EVENTS.flatMap((e) => Array(e.w).fill(e));
  for (let i = 0; i < 6; i++) {
    const ev = pool[rnd(pool.length)];
    if (ev.challenge) return glokChallenge(r, pickGlokKind(r), cont);
    r._glok = true;
    let res; try { res = ev.f(r); } finally { r._glok = false; }
    if (!res) continue;
    log(r, `Глок: ${res.title.toLowerCase()} — ${res.text}`, 'glok');
    r.fx = { type: 'glok', title: res.title, text: res.text, line: GLOK_LINES[rnd(GLOK_LINES.length)], seq: ++r.fxSeq };
    r.phase = 'GLOK'; r.pending = null;
    sync(r);
    return later(r, T(5200), cont);
  }
  cont();
}

// Задание Глока. Снаружи всегда выглядит одинаково: «кто первый нажмёт — заберёт $N».
// Что внутри — честная халява или одна из подстав — знает только сервер.
// Чем дальше партия, тем больше подстав и тем они злее.
const GLOK_KINDS = {
  real:   { from: 1,  w: (rd) => (rd < 6 ? 55 : rd < 14 ? 40 : 32) },  // честно: первый забирает
  fine:   { from: 1,  w: (rd) => (rd < 6 ? 45 : 22) },                  // подстава: первый платит штраф
  marked: { from: 6,  w: () => 14 },                                    // меченые купюры: деньги дали, но менты приняли
  goon:   { from: 6,  w: () => 12 },                                    // развод: забрал братка и ещё денег
  humble: { from: 12, w: () => 12 },                                    // Глок любит скромных: всем, кто НЕ жал, по $50
  double: { from: 14, w: () => 10 },                                    // двойная подстава: первый платит вдвое, второй — штраф
};
function pickGlokKind(r) {
  const opts = Object.entries(GLOK_KINDS).filter(([, v]) => r.round >= v.from).map(([k, v]) => [k, v.w(r.round)]);
  let x = rnd(opts.reduce((s, [, w]) => s + w, 0));
  for (const [k, w] of opts) { if ((x -= w) < 0) return k; }
  return 'real';
}

function glokChallenge(r, kind, cont) {
  const ms = 7000;
  const prize = [100, 150, 200][rnd(3)];
  const task = { kind, seq: ++r.fxSeq, prize, ms, taps: [], line: GLOK_LINES[rnd(GLOK_LINES.length)] };
  r.glokTask = task;
  r.phase = 'GLOK'; r.pending = null;
  log(r, `Глок: кто первый нажмёт — заберёт $${prize}`, 'glok');
  // боты не знают, что внутри, — жмут одинаково при любом раскладе
  active(r).filter((p) => p.bot).forEach((p) => {
    if (rnd(100) >= 70) return;
    setTimeout(() => safe(() => glokTap(r, p, task.seq)), T(1500 + rnd(4500)));
  });
  r.glokCont = cont;
  sync(r);
  later(r, T(ms), () => finishGlok(r));
}

function glokTap(r, p, seq) {
  const t = r.glokTask;
  if (!t || t.seq !== seq || p.bankrupt || t.taps.includes(p.id)) return;
  t.taps.push(p.id);
  // у «двойной подставы» ждём второго, чтобы наказать и его; остальные закрываются по первому нажатию
  if (t.kind !== 'double' || t.taps.length >= 2) return finishGlok(r);
  sync(r);
}

function finishGlok(r) {
  const t = r.glokTask;
  if (!t) return;
  r.glokTask = null;
  clearTimer(r);
  const first = byId(r, t.taps[0]), second = byId(r, t.taps[1]);
  const prize = t.prize;
  r._glok = true;
  let title, text;
  if (!first) {
    title = 'НИКТО?!';
    text = t.kind === 'real' ? `Все проспали. Глок забрал $${prize} себе.` : 'Никто не повёлся — а там была подстава. Скучные вы, братва.';
  } else switch (t.kind) {
    case 'real':
      first.money += prize; track(first);
      title = 'ЧЕСТНО!'; text = `${first.name} самый шустрый: +$${prize}. Глок сегодня добрый.`; break;
    case 'fine':
      hurt(first, pay(r, first, prize, null));
      title = 'ЭТО БЫЛА ПОДСТАВА'; text = `Халявы нет! ${first.name} платит Глоку $${prize}. Ха-ха.`; break;
    case 'marked':
      first.money += prize; track(first);
      sendToJail(r, first);
      title = 'МЕЧЕНЫЕ КУПЮРЫ'; text = `${first.name} забрал $${prize}, но купюры были мечены — менты уже ждали.`; break;
    case 'goon': {
      const lostGoon = first.goons > 0; if (lostGoon) first.goons -= 1;
      hurt(first, pay(r, first, Math.round(prize / 2), null));
      title = 'РАЗВОД'; text = `${first.name} нажал и${lostGoon ? ' лишился братка, и' : ''} отдал $${Math.round(prize / 2)}. Бесплатный сыр — сам знаешь где.`; break;
    }
    case 'humble': {
      const good = active(r).filter((p) => p.id !== first.id);
      good.forEach((p) => { p.money += 50; track(p); });
      title = 'ГЛОК ЛЮБИТ СКРОМНЫХ'; text = `${first.name} полез первым — ничего не получит. Остальным по $50 за терпение.`; break;
    }
    case 'double':
      hurt(first, pay(r, first, prize * 2, null));
      if (second) hurt(second, pay(r, second, prize, null));
      title = 'ДВОЙНАЯ ПОДСТАВА'; text = `${first.name} платит $${prize * 2}${second ? `, ${second.name} — $${prize}` : ''}. Глок ржёт.`; break;
  }
  r._glok = false;
  log(r, `Глок: ${text}`, 'glok');
  r.fx = { type: 'glok', title, text, line: '', seq: ++r.fxSeq, result: true };
  sync(r);
  const cont = r.glokCont; r.glokCont = null;
  later(r, T(4400), () => cont && cont());
}

// ---------- Сделки между игроками ----------
// mode 'sell': from продаёт свою точку to за price; mode 'buy': from хочет купить точку to за price
const OFFER_MS = 25000;
function makeOffer(r, from, d) {
  if (r.status !== 'PLAYING' || from.bankrupt) return 'Сейчас нельзя';
  const to = byId(r, d.to);
  const cell = Number(d.cell), price = Math.round(Number(d.price));
  const mode = d.mode === 'buy' ? 'buy' : 'sell';
  if (!to || to === from || to.bankrupt) return 'Нет такого игрока';
  if (!BOARD[cell] || BOARD[cell].type !== 'prop') return 'Не та клетка';
  if (!Number.isFinite(price) || price < 1 || price > 9999) return 'Цена от $1 до $9999';
  const pr = r.props[cell];
  const seller = mode === 'sell' ? from : to, buyer = mode === 'sell' ? to : from;
  if (!pr || pr.owner !== seller.id) return 'Эта точка не у продавца';
  if (buyer.money < price) return `У ${buyer.name} нет $${price}`;
  if (r.offers.some((o) => o.from === from.id)) return 'Сначала дождись ответа на прошлое предложение';
  if (r.offers.filter((o) => o.to === to.id).length >= 2) return `${to.name} уже завален предложениями`;
  const offer = { id: crypto.randomBytes(3).toString('hex'), from: from.id, to: to.id, cell, price, mode, until: Date.now() + T(OFFER_MS) };
  r.offers.push(offer);
  log(r, mode === 'sell' ? `${from.name} предлагает ${to.name} купить «${cellName(cell)}» за $${price}` : `${from.name} хочет выкупить у ${to.name} «${cellName(cell)}» за $${price}`, 'trade', { pid: from.id });
  setTimeout(() => safe(() => {
    if (r.offers.includes(offer)) { r.offers = r.offers.filter((o) => o !== offer); log(r, `Сделка по «${cellName(cell)}» сгорела — не ответили`, 'info'); sync(r); }
  }), T(OFFER_MS));
  if (to.bot) setTimeout(() => safe(() => botOffer(r, offer)), T(1500 + rnd(1500)));
  sync(r);
  return null;
}
function replyOffer(r, p, id, accept) {
  const o = r.offers.find((x) => x.id === id);
  if (!o || o.to !== p.id) return;
  r.offers = r.offers.filter((x) => x !== o);
  const from = byId(r, o.from), to = p;
  const seller = o.mode === 'sell' ? from : to, buyer = o.mode === 'sell' ? to : from;
  const pr = r.props[o.cell];
  if (!accept) { log(r, `${p.name} отказался от сделки по «${cellName(o.cell)}»`, 'info'); return sync(r); }
  if (!from || from.bankrupt || !pr || pr.owner !== seller.id || buyer.money < o.price || r.status !== 'PLAYING') {
    log(r, `Сделка по «${cellName(o.cell)}» сорвалась`, 'info');
    return sync(r);
  }
  buyer.money -= o.price; seller.money += o.price; track(seller);
  pr.owner = buyer.id;
  log(r, `Сделка: ${buyer.name} купил «${cellName(o.cell)}» у ${seller.name} за $${o.price}`, 'trade-ok', { pid: buyer.id });
  r.fx = { type: 'deal', seq: ++r.fxSeq, buyer: buyer.id, seller: seller.id, cell: o.cell, price: o.price };
  sync(r);
}
function botOffer(r, o) {
  if (!r.offers.includes(o)) return;
  const bot = byId(r, o.to), val = G.cellValue(o.cell, (r.props[o.cell] || { level: 0 }).level);
  const ok = o.mode === 'sell' ? o.price <= val * 1.1 && bot.money - o.price > 200 : o.price >= val * 1.5;
  replyOffer(r, bot, o.id, ok);
}

function endTurn(r) {
  omonStep(r);
  if (checkWin(r)) return;
  maybeGlok(r, () => nextTurn(r));
}

function nextTurn(r) {
  if (checkWin(r)) return;
  const len = r.players.length;
  let n = r.turn, wrapped = false;
  for (let i = 0; i < len; i++) {
    n = (n + 1) % len;
    if (n === 0) wrapped = true;
    if (!r.players[n].bankrupt) break;
  }
  if (wrapped) {
    r.round += 1;
    // в бесконечной партии со временем начинается беспредел — чтобы игра не тянулась вечно
    const inf = r.settings.rounds ? 1 : r.round >= 40 ? 3 : r.round >= 25 ? 2 : 1;
    if (inf !== (r.inflation || 1)) { r.inflation = inf; log(r, `Беспредел: вся рента теперь ×${inf}`, 'omon'); }
    if (r.settings.rounds && r.round > r.settings.rounds) return finish(r, 'rounds');
    roundStart(r);
  }
  r.turn = n;
  startTurn(r);
}

function checkWin(r) {
  if (r.status !== 'PLAYING') return true;
  if (active(r).length <= 1) { finish(r, 'last'); return true; }
  return false;
}

// Титулы по итогам партии — для веселья и скриншотов
function titles(r) {
  const ps = r.players;
  const best = (fn, min = 1) => { const s = ps.slice().sort((a, b) => fn(b) - fn(a))[0]; return s && fn(s) >= min ? s : null; };
  const out = [];
  const add = (p, emoji, title, desc) => p && out.push({ pid: p.id, emoji, title, desc });
  add(best((p) => p.st.strelkaWon), 'sword', 'Отморозок', 'Больше всех отжал на стрелках');
  add(best((p) => p.st.rentIn, 50), 'house', 'Рантье', 'Больше всех собрал ренты');
  add(best((p) => p.st.glok, 50), 'skull', 'Любимчик Глока', 'Больше всех пострадал от Глока');
  add(best((p) => p.st.casino, 2), 'slots', 'Лудоман', 'Не вылезал из казино');
  add(best((p) => p.st.jail, 2), 'c-tyurma', 'Сиделец', 'Чаще всех уезжал к ментам');
  add(best((p) => p.st.maxMoney, 0), 'coin', 'Олигарх', 'Самая толстая пачка за игру');
  return out;
}

function finish(r, reason) {
  clearTimer(r);
  r.status = 'GAMEOVER'; r.phase = null; r.pending = null; r.offers = []; r.glokTask = null;
  r.standings = r.players
    .map((p) => ({ id: p.id, worth: netWorth(r, p), bankrupt: p.bankrupt }))
    .sort((a, b) => (a.bankrupt - b.bankrupt) || (b.worth - a.worth));
  r.winner = r.standings[0] ? r.standings[0].id : null;
  r.titles = titles(r);
  const w = byId(r, r.winner);
  log(r, reason === 'rounds' ? `Круги вышли. Самый богатый — ${w ? w.name : '—'}` : `${w ? w.name : 'Никто'} забрал весь город`, 'win');
  sync(r);
  // в топ — только живые игроки, боты не считаются; одиночные партии с ботами тоже идут (по-честному)
  const rows = r.standings.map((s, i) => {
    const p = byId(r, s.id);
    if (!p || p.bot || !p.account) return null;
    return {
      key: p.account.key, tg: p.account.tg, name: p.account.tg ? p.account.name : p.name, username: p.account.username, photo: p.account.photo,
      char: p.char, win: i === 0, top3: i < 3, worth: s.worth, strelkaWon: p.st.strelkaWon, strelkaTotal: p.st.strelkaTotal,
      bankrupt: p.bankrupt, glok: p.st.glok, titles: r.titles.filter((t) => t.pid === p.id).length,
    };
  }).filter(Boolean);
  if (rows.length) store.record(rows).catch((e) => console.error('stats', e.message));
  // монеты за партию (с дневным лимитом)
  r.standings.forEach((s, i) => {
    const p = byId(r, s.id);
    if (!p || p.bot || !p.account) return;
    store.credit(p.account.key, EARN.game + (i === 0 ? EARN.win : 0), 'game', EARN.dayCap)
      .then((n) => { if (n && p.socketId) io.to(p.socketId).emit('earned', { amount: n, win: i === 0 }); })
      .catch((e) => console.error('earn', e.message));
  });
  r.players.forEach((p) => { p.boosted = false; p.wantBoost = false; });
}

// ---------- Боты ----------
function botAct(r) {
  if (r.status !== 'PLAYING') return;
  const p = cur(r);
  if (!p.bot) return;
  if (r.phase === 'ROLL') return doRoll(r);
  if (r.phase !== 'DECIDE' || !r.pending) return;
  const q = r.pending;
  let c = DEFAULTS[q.type];
  switch (q.type) {
    case 'BUY': c = p.money - q.price >= 150 ? 'yes' : 'no'; break;
    case 'UPGRADE': c = p.money - q.price >= 300 ? 'yes' : 'no'; break;
    case 'GYM': c = p.goons < 2 && p.money > 350 ? 'yes' : 'no'; break;
    case 'CASINO': {
      if (p.money < 600 || rnd(3) === 0) { c = 'skip'; break; }
      const g = ['slots', 'roulette', 'ochko'][rnd(3)];
      c = g === 'roulette' ? `roulette:${q.bets[0]}:${rnd(2) ? 'red' : 'black'}` : `${g}:${q.bets[0]}`;
      break;
    }
    case 'OCHKO': c = q.sum < 17 ? 'hit' : 'stand'; break;
    case 'STRELKA': {
      c = q.noFight ? 'pay' : (q.chance >= 58 && p.money > q.rent * 2) || q.chance >= 75 ? 'fight' : q.crowd && q.chance >= 20 && rnd(2) ? 'crowd' : 'pay';
      break;
    }
    case 'JAIL': c = p.money > 500 ? 'pay' : 'wait'; break;
  }
  resolve(r, c);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Комнаты ----------
function startGame(r) {
  r.players = shuffle(r.players);
  r.players.forEach((p) => {
    Object.assign(p, freshStats());
    if (p.boosted) p.money = Math.round(C.START_MONEY * (1 + BOOST.pct / 100));
  });
  Object.assign(r, {
    status: 'PLAYING', turn: 0, props: {}, heat: 0, omon: null, pot: 0, round: 1, inflation: 1,
    winner: null, standings: null, titles: null, dice: null, lastMove: null, fx: null, deck: [],
    sealed: null, glokTask: null, glokCont: null, turnsSinceGlok: 0, offers: [], crowd: null, event: null,
  });
  r.players.filter((p) => p.boosted).forEach((p) => log(r, `${p.name} взял подъёмные: старт $${p.money}`, 'buy', { pid: p.id }));
  log(r, `Сходка началась! Первым ходит ${r.players[0].name}`, 'start');
  // Тайный персонаж: иногда одному из игроков выпадает Будка
  r.players.forEach((p) => { if (p.baseChar) { p.char = p.baseChar; p.baseChar = null; } });
  if (process.env.BUDKA_ALWAYS || rnd(100) < 18) {
    const p = r.players[rnd(r.players.length)];
    p.baseChar = p.char; p.char = 'budka';
    log(r, `Тайный персонаж! ${p.name} в этой партии — БУДКА. На него действует только Глок`, 'glok', { pid: p.id });
    r.fx = { type: 'secret', pid: p.id, seq: ++r.fxSeq };
  }
  startTurn(r);
}

function removePlayer(r, p) {
  r.players = r.players.filter((x) => x !== p);
  if (p.token) tokens.delete(p.token);
  if (r.hostId === p.id) {
    const h = r.players.find((x) => !x.bot);
    r.hostId = h ? h.id : null;
  }
  if (!r.players.some((x) => !x.bot)) { clearTimer(r); rooms.delete(r.code); return false; }
  return true;
}

function surrender(r, p) {
  if (p.bankrupt) return;
  const wasTurn = cur(r) === p;
  log(r, `${p.name} покинул город`, 'info');
  bankrupt(r, p);
  if (checkWin(r)) return;
  if (wasTurn && r.phase !== 'GLOK') { clearTimer(r); r.pending = null; endTurn(r); }
  else sync(r);
}

// Кто это: аккаунт Telegram (подписанная сессия) или гость с id устройства
function account(d) {
  const s = tg.verify(d.session);
  if (s) return { key: s.key, tg: true, name: s.name, username: s.username, photo: s.photo };
  const dev = String(d.device || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  return dev.length >= 12 ? { key: 'guest:' + dev, tg: false } : null;
}

io.on('connection', (socket) => {
  let me = null; // { r, p }
  let lastChat = 0, lastOffer = 0;
  const err = (m) => socket.emit('err', m);
  const on = (ev, fn) => socket.on(ev, (d) => safe(() => fn(d && typeof d === 'object' ? d : {})));

  function bind(r, p) {
    me = { r, p };
    p.socketId = socket.id; p.connected = true;
    clearTimeout(p._leaveTimer);
    r.emptySince = null;
    socket.join(r.code);
    socket.emit('you', { id: p.id, token: p.token, code: r.code });
    if (r.status === 'PLAYING' && cur(r) === p && (r.phase === 'ROLL' || r.phase === 'DECIDE')) armTimer(r);
    sync(r);
  }
  function unbind() {
    if (!me) return;
    socket.leave(me.r.code);
    me = null;
    socket.emit('you', null);
  }

  on('hello', ({ token }) => {
    const code = tokens.get(token);
    const r = code && rooms.get(code);
    const p = r && r.players.find((x) => x.token === token);
    if (!p) { if (token) tokens.delete(token); return socket.emit('you', null); }
    bind(r, p);
  });

  async function loadCos(p) {
    if (!p.account) return;
    const w = await store.wallet(p.account.key);
    p.owned = w.items;
    p.cos = { frame: w.equip.frame, dice: w.equip.dice, title: w.equip.title };
  }
  const canUse = (p, ch) => !PREMIUM.has(ch) || p.owned.includes('char-' + ch);
  async function enter(r, d) {
    const acc = account(d);
    let name = cleanName(acc && acc.tg && !d.name ? acc.name : d.name);
    if (!name) { err('Введи погоняло'); return null; }
    if (r.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = name.slice(0, 10) + ' ' + (r.players.length + 1);
    const p = makePlayer(r, name, cleanChar(d.char), acc);
    await loadCos(p).catch(() => {});
    if (!canUse(p, p.char)) { err(`${CHARS[p.char].name} — премиум-персонаж. Взял Спортика`); p.char = 'boec'; p.icon = null; }
    if (me) return null; // пока грузились, сокет уже куда-то зашёл
    if (r.players.length >= C.MAX_PLAYERS) { err('Мест нет'); return null; }
    r.players.push(p);
    if (!r.hostId) r.hostId = p.id;
    tokens.set(p.token, r.code);
    return p;
  }

  const onA = (ev, fn) => socket.on(ev, (d) => fn(d && typeof d === 'object' ? d : {}).catch((e) => { console.error('[socket]', ev, e); err('Ошибка, попробуй ещё раз'); }));
  let entering = false;
  onA('create', async (d) => {
    if (me || entering) return err('Ты уже в комнате');
    if (!cleanName(d.name) && !tg.verify(d.session)) return err('Введи погоняло');
    entering = true;
    const r = newRoom(newCode());
    rooms.set(r.code, r);
    const p = await enter(r, d).finally(() => { entering = false; });
    if (!p) return rooms.delete(r.code);
    log(r, `${p.name} собрал сходку`, 'start');
    bind(r, p);
  });

  onA('join', async (d) => {
    if (me || entering) return err('Ты уже в комнате');
    const r = rooms.get(String(d.code || '').trim());
    if (!r) return err('Нет такой сходки — проверь код');
    if (r.status !== 'LOBBY') return err('Игра уже идёт');
    if (r.players.length >= C.MAX_PLAYERS) return err(`Мест нет (макс ${C.MAX_PLAYERS})`);
    entering = true;
    const p = await enter(r, d).finally(() => { entering = false; });
    if (!p) return;
    if (r.status !== 'LOBBY') { r.players = r.players.filter((x) => x !== p); tokens.delete(p.token); return err('Игра уже идёт'); }
    log(r, `${p.name} примкнул к братве`, 'join');
    bind(r, p);
  });

  const host = () => me && me.r.hostId === me.p.id;

  on('addBot', () => {
    if (!host() || me.r.status !== 'LOBBY') return;
    const r = me.r;
    if (r.players.length >= C.MAX_PLAYERS) return err('Мест нет');
    const free = BOT_NAMES.filter((n) => !r.players.some((p) => p.name === 'Бот ' + n));
    const keys = Object.keys(CHARS).filter((k) => !CHARS[k].secret), freeChars = keys.filter((k) => !r.players.some((p) => p.char === k));
    const ch = (freeChars.length ? freeChars : keys)[rnd((freeChars.length ? freeChars : keys).length)];
    r.players.push(makePlayer(r, 'Бот ' + (free[rnd(free.length)] || 'Х'), ch, null, true));
    sync(r);
  });

  on('kick', ({ id }) => {
    if (!host() || me.r.status !== 'LOBBY') return;
    const r = me.r, p = byId(r, id);
    if (!p || p === me.p) return;
    const s = p.socketId && io.sockets.sockets.get(p.socketId);
    removePlayer(r, p);
    if (s) { s.leave(r.code); s.emit('you', null); s.emit('err', 'Тебя убрали со сходки'); }
    sync(r);
  });

  on('setChar', ({ char }) => {
    if (!me || me.r.status !== 'LOBBY' || !CHARS[char] || CHARS[char].secret) return;
    if (!canUse(me.p, char)) return err(`${CHARS[char].name} открывается в магазине`);
    me.p.char = char;
    sync(me.r);
  });

  on('settings', ({ rounds, glok, boosts }) => {
    if (!host() || me.r.status !== 'LOBBY') return;
    if ([15, 20, 25].includes(rounds)) me.r.settings.rounds = rounds;
    if (typeof glok === 'boolean') me.r.settings.glok = glok;
    if (typeof boosts === 'boolean') { me.r.settings.boosts = boosts; if (!boosts) me.r.players.forEach((p) => { p.wantBoost = false; }); }
    sync(me.r);
  });

  // Обновить косметику после покупки в магазине
  onA('cos', async () => { if (me) { await loadCos(me.p); sync(me.r); } });
  // «Подъёмные»: отмечаем желание в лобби, монеты списываются при старте
  onA('boost', async ({ on: want }) => {
    if (!me || me.r.status !== 'LOBBY') return;
    if (want && !me.r.settings.boosts) return err('Босс отключил бусты в этой сходке');
    if (want) {
      if (!me.p.account) return err('Нужен профиль');
      const w = await store.wallet(me.p.account.key);
      if (w.coins < BOOST.price) return err(`Нужно ${BOOST.price} монет — загляни в магазин`);
    }
    me.p.wantBoost = !!want;
    sync(me.r);
  });
  let starting = false;
  onA('start', async () => {
    if (!host() || me.r.status !== 'LOBBY' || starting) return;
    if (me.r.players.length < 2) return err('Нужно минимум двое');
    starting = true;
    const r = me.r;
    try {
      for (const p of r.players) {
        p.boosted = false;
        if (p.wantBoost && r.settings.boosts && p.account) p.boosted = !!(await store.spend(p.account.key, BOOST.price));
        p.wantBoost = false;
      }
      if (r.status === 'LOBBY' && r.players.length >= 2) startGame(r);
    } finally { starting = false; }
  });
  // Подарки: монеты списываются у дарителя, получателю — уважуха в топ
  let lastGift = 0;
  onA('gift', async ({ to, gift }) => {
    if (!me) return;
    const g = GIFTS.find((x) => x.id === gift), r = me.r, target = byId(r, to);
    if (!g || !target || target === me.p) return;
    if (Date.now() - lastGift < 1500) return err('Не так быстро');
    lastGift = Date.now();
    if (!me.p.account) return err('Нужен профиль');
    if (!(await store.spend(me.p.account.key, g.price))) return err(`Не хватает монет: ${g.name} стоит ${g.price} монет`);
    target.gifts = (target.gifts || 0) + 1;
    log(r, `${me.p.name} подарил ${target.name}: ${g.name}`, 'gift', { pid: me.p.id });
    io.to(r.code).emit('gift', { from: me.p.id, to: target.id, gift: g.id });
    if (target.account) store.addRespect(target.account.key, g.price, target.account.tg ? target.account.name : target.name).catch(() => {});
    socket.emit('spent', { amount: g.price });
    sync(r);
  });

  on('rematch', () => {
    if (me) me.r.players.forEach((p) => { p.boosted = false; p.wantBoost = false; });
    if (!host() || me.r.status !== 'GAMEOVER') return;
    const r = me.r;
    r.status = 'LOBBY'; r.phase = null; r.props = {}; r.winner = null; r.standings = null; r.titles = null;
    r.players.forEach((p) => { Object.assign(p, freshStats()); if (p.baseChar) { p.char = p.baseChar; p.baseChar = null; } });
    log(r, 'Новая сходка — ждём братву', 'start');
    sync(r);
  });

  const myTurn = () => me && me.r.status === 'PLAYING' && cur(me.r) === me.p;
  on('glok', ({ seq }) => { if (me && me.r.status === 'PLAYING') glokTap(me.r, me.p, seq); });
  on('crowd', ({ seq }) => { if (me && me.r.status === 'PLAYING') crowdJoin(me.r, me.p, seq); });
  on('roll', () => { if (myTurn() && me.r.phase === 'ROLL') doRoll(me.r); });
  on('decide', ({ choice }) => { if (myTurn() && me.r.phase === 'DECIDE') resolve(me.r, String(choice)); });
  on('offer', (d) => {
    if (!me) return;
    if (Date.now() - lastOffer < 2000) return err('Не так быстро');
    lastOffer = Date.now();
    const e = makeOffer(me.r, me.p, d);
    if (e) err(e);
  });
  on('offerReply', ({ id, accept }) => { if (me) replyOffer(me.r, me.p, String(id), !!accept); });

  on('chat', ({ text }) => {
    if (!me) return;
    const now = Date.now();
    if (now - lastChat < 700) return;
    lastChat = now;
    text = String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
    if (!text) return;
    log(me.r, text, 'chat', { pid: me.p.id, name: me.p.name });
    sync(me.r);
  });

  on('leave', () => {
    if (!me) return;
    const { r, p } = me;
    unbind();
    if (r.status === 'PLAYING') surrender(r, p);
    if (p.token) tokens.delete(p.token);
    if (r.status !== 'PLAYING') {
      if (removePlayer(r, p)) sync(r);
    } else if (!r.players.some((x) => !x.bot && x.token && tokens.has(x.token))) {
      clearTimer(r); rooms.delete(r.code);
    }
  });

  socket.on('disconnect', () => safe(() => {
    if (!me) return;
    const { r, p } = me;
    if (p.socketId !== socket.id) return;
    p.connected = false;
    if (r.status === 'LOBBY') {
      p._leaveTimer = setTimeout(() => safe(() => {
        if (!p.connected && rooms.get(r.code) === r && r.status === 'LOBBY' && removePlayer(r, p)) sync(r);
      }), 60000);
    } else if (r.status === 'PLAYING' && cur(r) === p && (r.phase === 'ROLL' || r.phase === 'DECIDE')) {
      armTimer(r);
    }
    if (!r.players.some((x) => !x.bot && x.connected)) r.emptySince = Date.now();
    sync(r);
  }));
});

setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.emptySince && now - r.emptySince > 20 * 60000) {
      clearTimer(r);
      r.players.forEach((p) => p.token && tokens.delete(p.token));
      rooms.delete(r.code);
    }
  }
}, 60000).unref();

store.init().then(() => server.listen(PORT, '0.0.0.0', async () => {
  const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (bot.enabled) bot.setup(publicUrl, PACKS);
  const urls = lanIPs().map((ip) => `http://${ip}:${PORT}`);
  console.log('\n  БРАТВА — сервер запущен');
  console.log(`  Telegram-вход: ${tg.enabled ? 'включён (@' + tg.botUsername + ')' : 'выключен (нет TELEGRAM_BOT_TOKEN)'}`);
  console.log(`  На этом ПК: http://localhost:${PORT}`);
  urls.forEach((u) => console.log(`  Для друзей (Wi-Fi): ${u}`));
  if (urls[0] && !process.env.FAST && !process.env.RENDER) {
    try { console.log('\n' + (await QRCode.toString(urls[0], { type: 'terminal', small: true }))); } catch {}
  }
  console.log('  Остановить сервер: Ctrl + C\n');
}));

module.exports = { rooms };
