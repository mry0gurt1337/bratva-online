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

// Клиентские файлы лежат в public/ (локально) или прямо рядом с server.js (версия для хостинга без папок)
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const G = require(path.join(PUB, 'shared.js'));
const ART = require(path.join(PUB, 'art.js'));
const { BOARD, C } = G;
const CHARS = ART.CHARS;

const PORT = Number(process.env.PORT) || 3000;
const SPEED = process.env.FAST ? 0.02 : 1; // FAST=1 — ускоренный режим для тестов
const T = (x) => Math.max(1, Math.round(x * SPEED));
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
const PUBLIC_RE = /^(index\.html|style\.css|game\.js|sound\.js|shared\.js|art\.js|manifest\.json|icon\.svg|icon-\d+\.png|sfx-[a-z0-9-]+\.mp3)$/;
app.get('/:f?', (req, res, next) => {
  const f = req.params.f || 'index.html';
  if (!PUBLIC_RE.test(f)) return next();
  res.sendFile(path.join(PUB, f), { maxAge: f.endsWith('.mp3') || f.endsWith('.png') ? '7d' : 0 });
});

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => score(a) - score(b));
}
app.get('/api/info', (req, res) => res.json({ urls: lanIPs().map((ip) => `http://${ip}:${PORT}`) }));
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
const cleanChar = (s) => (CHARS[s] ? s : 'boec');
const has = (p, ch) => p && p.char === ch;

function makePlayer(r, name, char, account, bot = false) {
  const used = r.players.map((p) => p.color);
  return {
    id: crypto.randomBytes(4).toString('hex'),
    token: bot ? null : crypto.randomBytes(16).toString('hex'),
    name, char, icon: CHARS[char].emoji, color: G.COLORS.find((c) => !used.includes(c)) || G.COLORS[0],
    account: account || null, bot, connected: true, socketId: null,
    ...freshStats(),
  };
}
const freshStats = () => ({
  money: C.START_MONEY, auth: 0, goons: 0, pos: 0, jail: 0, bankrupt: false, doubles: 0, extra: false,
  st: { strelkaWon: 0, strelkaTotal: 0, glok: 0, rentIn: 0, rentOut: 0, casino: 0, jail: 0, bought: 0, maxMoney: C.START_MONEY },
});

function newRoom(code) {
  return {
    code, hostId: null, status: 'LOBBY', settings: { rounds: 20, glok: true }, players: [],
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
      id: p.id, name: p.name, char: p.char, icon: p.icon, color: p.color, money: p.money, auth: p.auth,
      goons: p.goons, pos: p.pos, jail: p.jail, bankrupt: p.bankrupt, bot: p.bot,
      connected: p.bot || p.connected, tg: !!(p.account && p.account.tg), photo: p.account && p.account.photo,
    })),
    turn: r.turn, phase: r.phase, pending: r.pending, props: r.props, heat: r.heat, omon: r.omon, pot: r.pot, inflation: r.inflation || 1,
    logs: r.logs, dice: r.dice, lastMove: r.lastMove, fx: r.fx, round: r.round,
    winner: r.winner, standings: r.standings, titles: r.titles, sealed: r.sealed,
    offers: r.offers.map(({ id, from, to, cell, price, mode, until }) => ({ id, from, to, cell, price, mode, ms: Math.max(0, until - Date.now()) })),
    glokTask: r.glokTask ? { kind: r.glokTask.kind, seq: r.glokTask.seq, prize: r.glokTask.prize, ms: T(r.glokTask.ms), line: r.glokTask.line, taps: r.glokTask.taps } : null,
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
const buyPrice = (p, c) => (has(p, 'baryga') ? Math.round((c.price * 0.85) / 5) * 5 : c.price);
const power = (p) => p.auth + p.goons + (has(p, 'boec') ? 2 : 0);
const track = (p) => { p.st.maxMoney = Math.max(p.st.maxMoney, p.money); };

function armTimer(r) {
  const p = cur(r);
  if (p.bot) return later(r, T(900 + rnd(700)), () => botAct(r));
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
  p.pos += steps;
  if (p.pos >= N) {
    p.pos -= N;
    const sal = C.SALARY + (has(p, 'buhgalter') ? 60 : 0);
    p.money += sal; track(p);
    log(r, `${p.name} заглянул в Общак: +$${sal}`, 'salary', { pid: p.id });
  }
}

function doRoll(r) {
  if (r.phase !== 'ROLL') return;
  const p = cur(r);
  const a = d6(), b = d6(), dbl = a === b;
  r.dice = { a, b, seq: (r.dice ? r.dice.seq : 0) + 1, by: p.id };
  log(r, `${p.name} бросил ${a} + ${b}${dbl ? ' — ДУБЛЬ!' : ''}`, 'dice', { pid: p.id });
  r.phase = 'MOVING';
  r.pending = null;
  if (dbl) {
    p.doubles += 1;
    if (p.doubles >= 3) {
      p.doubles = 0; p.extra = false;
      log(r, `Три дубля подряд — ${p.name} привлёк внимание ментов`, 'police', { pid: p.id });
      sync(r);
      return later(r, T(1100), () => { sendToJail(r, p); afterAction(r); });
    }
    p.extra = true;
  } else { p.doubles = 0; p.extra = false; }
  const from = p.pos, steps = a + b;
  moveBy(r, p, steps);
  r.lastMove = { pid: p.id, from, steps, seq: ++r.moveSeq, delay: 700 };
  sync(r);
  later(r, T(700 + steps * C.HOP_MS + 250), () => land(r));
}

function sendToJail(r, p) {
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
        log(r, `💰 ${p.name} встал ровно на Общак и забрал джекпот $${won}!`, 'win', { pid: p.id });
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
      let t = Math.max(20, Math.round((p.money * 0.1) / 10) * 10);
      if (has(p, 'advokat')) t = Math.round(t / 20) * 10;
      log(r, `Налоговая: ${p.name} заносит $${t} — деньги ушли в Общак`, 'loss', { pid: p.id });
      pay(r, p, t, null);
      return afterAction(r, 300);
    }
    case 'police': sendToJail(r, p); return afterAction(r, 400);
    case 'jail': log(r, `${p.name} навестил кентов в тюрьме`, 'info'); return afterAction(r);
    default: return afterAction(r);
  }
}

function landProp(r, p, c) {
  const pr = r.props[c.id];
  if (!pr) {
    const price = buyPrice(p, c);
    if (p.money >= price) return ask(r, { type: 'BUY', cell: c.id, price });
    log(r, `${p.name} не тянет «${c.name}» ($${price})`, 'info');
    return afterAction(r);
  }
  if (pr.owner === p.id) {
    if (pr.level < C.MAX_LEVEL && p.money >= c.up) return ask(r, { type: 'UPGRADE', cell: c.id, price: c.up, level: pr.level });
    return afterAction(r);
  }
  const owner = byId(r, pr.owner);
  if (!owner || owner.bankrupt) return afterAction(r);
  if (r.sealed && r.sealed.cell === c.id && r.round <= r.sealed.until) {
    log(r, `«${c.name}» опечатана Димой Глоком — ${p.name} проходит бесплатно`, 'glok');
    return afterAction(r);
  }
  const rent = G.rentOf(r.props, c.id) * (r.inflation || 1);
  return ask(r, { type: 'STRELKA', cell: c.id, rent, owner: owner.id, ownerName: owner.name, my: power(p), his: power(owner) });
}

// ---------- Карточки «Звонок с зоны» ----------
const others = (r, p) => r.players.filter((o) => o !== p && !o.bankrupt);
const CARDS = [
  { t: 'Братва подогнала подогрев: +$100', f: (r, p) => { p.money += 100; } },
  { t: 'Нашёл заначку в старой куртке: +$50', f: (r, p) => { p.money += 50; } },
  { t: 'Адвокат выставил счёт: −$80', f: (r, p) => pay(r, p, 80, null) },
  { t: 'Сбор с района: каждый платит тебе $25', f: (r, p) => others(r, p).forEach((o) => pay(r, o, 25, p)) },
  { t: 'Скинулся на общак: по $20 каждому', f: (r, p) => others(r, p).forEach((o) => pay(r, p, 20, o)) },
  { t: 'Порешал вопрос красиво: авторитет +1', f: (r, p) => { p.auth += 1; } },
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
  log(r, `📞 ${p.name}: ${card.t}`, 'card', { pid: p.id });
  r.fx = { type: 'card', text: card.t, pid: p.id, seq: ++r.fxSeq };
  if (card.move != null) {
    r.phase = 'ANIM';
    sync(r);
    return later(r, T(1700), () => {
      const from = p.pos, steps = (card.move - from + N) % N;
      moveBy(r, p, steps);
      r.lastMove = { pid: p.id, from, steps, seq: ++r.moveSeq, delay: 0 };
      sync(r);
      later(r, T(steps * C.HOP_MS + 300), () => land(r));
    });
  }
  card.f(r, p); track(p);
  afterAction(r, 1700);
}

// ---------- Деньги и банкротство ----------
// to === null — деньги уходят в джекпот Общака
function pay(r, p, amount, to) {
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
  log(r, `💀 ${p.name} разорён и выбывает`, 'bankrupt', { pid: p.id });
}
function netWorth(r, p) {
  if (p.bankrupt) return 0;
  return p.money + Object.entries(r.props).filter(([, v]) => v.owner === p.id)
    .reduce((s, [k, v]) => s + G.cellValue(+k, v.level), 0);
}

// ---------- Решения ----------
const DEFAULTS = { BUY: 'no', UPGRADE: 'no', GYM: 'no', CASINO: 'skip', STRELKA: 'pay', JAIL: 'wait' };
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
      if (choice === 'yes' && pr && pr.owner === p.id && pr.level < C.MAX_LEVEL && p.money >= c.up) {
        p.money -= c.up; pr.level += 1; heat(r, 1);
        log(r, `${p.name} прокачал «${c.name}» до ${'★'.repeat(pr.level)}`, 'buy', { pid: p.id });
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
      const bet = Number(choice);
      if (q.bets.includes(bet) && p.money >= bet) {
        p.st.casino += 1;
        const x = rnd(100);
        const jack = has(p, 'shuler') ? 8 : 5, winAt = has(p, 'shuler') ? 55 : 47;
        if (x < jack) { p.money += bet * 4; heat(r, 1); log(r, `🎰 ДЖЕКПОТ! ${p.name} сорвал $${bet * 5}`, 'win', { pid: p.id }); }
        else if (x < winAt) { p.money += bet; heat(r, 1); log(r, `🎰 ${p.name} поднял $${bet * 2} на ставке $${bet}`, 'win', { pid: p.id }); }
        else { pay(r, p, bet, null); log(r, `🎰 ${p.name} проиграл $${bet} — фишки ушли в Общак`, 'loss', { pid: p.id }); }
        track(p);
        r.fx = { type: 'casino', pid: p.id, bet, win: x < winAt, jackpot: x < jack, seq: ++r.fxSeq };
        delay = 1500;
      }
      break;
    }
    case 'STRELKA': {
      const owner = byId(r, q.owner), pr = r.props[q.cell];
      if (!owner || owner.bankrupt || !pr || pr.owner !== owner.id) break;
      if (choice === 'fight') { strelka(r, p, owner, q); delay = 2600; }
      else {
        log(r, `${p.name} заплатил $${q.rent} → ${owner.name}`, 'rent', { pid: p.id });
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
      return endTurn(r);
  }
  afterAction(r, delay);
}

function strelka(r, p, owner, q) {
  const aRoll = d6(), oRoll = d6();
  const aP = aRoll + power(p), oP = oRoll + power(owner);
  const win = aP > oP; // ничья — за хозяином
  heat(r, 2);
  p.st.strelkaTotal += 1;
  r.fx = { type: 'strelka', seq: ++r.fxSeq, a: p.id, o: owner.id, aRoll, oRoll, aP, oP, win, cell: q.cell };
  const c = BOARD[q.cell];
  if (win) {
    const pr = r.props[q.cell];
    pr.owner = p.id; pr.level = Math.max(0, pr.level - 1);
    p.auth += 1; owner.auth = Math.max(0, owner.auth - 1);
    p.st.strelkaWon += 1;
    log(r, `⚔️ СТРЕЛКА: ${p.name} (${aP}) против ${owner.name} (${oP}) — «${c.name}» отжата!`, 'strelka', { pid: p.id });
  } else {
    const pen = q.rent * 2;
    p.auth = Math.max(0, p.auth - 1);
    if (p.goons > 0) p.goons -= 1;
    log(r, `⚔️ СТРЕЛКА: ${p.name} (${aP}) против ${owner.name} (${oP}) — слил, штраф $${pen}`, 'strelka', { pid: p.id });
    const paid = pay(r, p, pen, owner);
    owner.st.rentIn += paid;
  }
}

function afterAction(r, delay = 0) {
  if (r.status !== 'PLAYING') return;
  if (delay) {
    r.phase = 'ANIM'; r.pending = null;
    sync(r);
    return later(r, T(delay), () => afterAction(r, 0));
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
      log(r, '🚨 ОМОН выехал на облаву!', 'omon');
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
  const hit = r.players.filter((p) => !p.bankrupt && p.pos === r.omon);
  if (!hit.length) return;
  for (const p of hit) {
    if (p.goons > 0) { p.goons -= 1; log(r, `ОМОН накрыл ${p.name} — браток присел за него`, 'omon', { pid: p.id }); }
    else {
      const fine = has(p, 'reshala') ? Math.round(C.OMON_FINE / 2) : C.OMON_FINE;
      log(r, `ОМОН повязал ${p.name}: штраф $${fine}`, 'omon', { pid: p.id }); pay(r, p, fine, null);
    }
  }
  r.omon = null; r.heat = 0;
  log(r, 'Облава закончена, розыск сброшен', 'info');
}

// ---------- Смотрящий Дима Глок ----------
// Бандит, который держит район. Приходит между ходами и устраивает движ.
const GLOK_LINES = [
  'Чё, пацаны, без меня веселитесь?', 'Район мой, правила мои.', 'Ничего личного, просто бизнес.',
  'Скучно мне что-то, братва…', 'Кто тут самый борзый?', 'Сюрприз, бродяги!', 'Я ненадолго. Наверное.',
  'Расслабились? Зря.', 'Дима пришёл — Дима решает.',
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
    return { title: 'НА ЧАЙ', text: 'Каждый заносит Диме по $25. Деньги ушли в Общак.' };
  } },
  { w: 2, f(r) {
    const p = active(r)[rnd(active(r).length)];
    p.money += 150; track(p);
    return { title: 'ДИМА ДОБРЫЙ', text: `${p.name} получает $150. Просто так. Не привыкай.` };
  } },
  { w: 2, f(r) {
    const t = two(r); if (!t) return null;
    [t[0].pos, t[1].pos] = [t[1].pos, t[0].pos];
    return { title: 'ПЕРЕСАДКА', text: `${t[0].name} и ${t[1].name} поменялись местами. Дима так видит.` };
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
    return { title: 'ВСЕ НАЗАД!', text: 'Дима сказал отойти. Все отползают на 3 клетки назад.' };
  } },
  { w: 2, f(r) {
    const owned = Object.keys(r.props).filter((k) => !has(byId(r, r.props[k].owner), 'reshala'));
    if (!owned.length) return null;
    const cell = +owned[rnd(owned.length)];
    r.sealed = { cell, until: r.round + 2 };
    const o = byId(r, r.props[cell].owner);
    return { title: 'ТОЧКА ЗАКРЫТА', text: `«${cellName(cell)}» (${o ? o.name : '—'}) — Дима закрыл на 2 круга. Ренты нет.` };
  } },
  { w: 1, f(r) {
    if (r.omon !== null) return null;
    r.heat = C.MAX_HEAT; r.omon = C.POLICE;
    return { title: 'СДАЛ ВСЕХ', text: 'Дима позвонил кому надо. ОМОН уже выехал на район.' };
  } },
  { w: 2, f(r) {
    r.players.forEach((p) => { p.jail = 0; });
    r.heat = 0; r.omon = null;
    return { title: 'ДИМА ПОРЕШАЛ', text: 'У Димы днюха: все на свободе, розыск сброшен.' };
  } },
  { w: 2, f(r) {
    const p = victims(r).filter((x) => x.goons > 0).sort((a, b) => b.goons - a.goons)[0];
    if (!p) return null;
    p.goons -= 1;
    return { title: 'ПЕРЕМАНИЛ', text: `Дима переманил братка у ${p.name}. «У меня платят лучше».` };
  } },
  { w: 2, f(r) {
    if (r.pot < 100) return null;
    const x = r.pot; r.pot = 0;
    return { title: 'ОБНЕС ОБЩАК', text: `Дима забрал весь джекпот Общака — $${x}. «Я же смотрящий».` };
  } },
  { w: 3, challenge: 'race' },
  { w: 3, challenge: 'trap' },
];

function maybeGlok(r, cont) {
  r.turnsSinceGlok = (r.turnsSinceGlok || 0) + 1;
  const chance = process.env.GLOK_ALWAYS ? 100 : 16;
  if (!r.settings.glok || r.round < 2 || r.turnsSinceGlok < 4 || rnd(100) >= chance || active(r).length < 2) return cont();
  r.turnsSinceGlok = 0;
  const pool = GLOK_EVENTS.flatMap((e) => Array(e.w).fill(e));
  for (let i = 0; i < 6; i++) {
    const ev = pool[rnd(pool.length)];
    if (ev.challenge) return glokChallenge(r, ev.challenge, cont);
    const res = ev.f(r);
    if (!res) continue;
    log(r, `😎 Дима Глок: ${res.title} — ${res.text}`, 'glok');
    r.fx = { type: 'glok', title: res.title, text: res.text, line: GLOK_LINES[rnd(GLOK_LINES.length)], seq: ++r.fxSeq };
    r.phase = 'GLOK'; r.pending = null;
    sync(r);
    return later(r, T(3400), cont);
  }
  cont();
}

function glokChallenge(r, kind, cont) {
  const ms = 6000;
  const task = { kind, seq: ++r.fxSeq, prize: kind === 'race' ? 150 : 100, ms, taps: [], line: GLOK_LINES[rnd(GLOK_LINES.length)] };
  r.glokTask = task;
  r.phase = 'GLOK'; r.pending = null;
  log(r, kind === 'race' ? '😎 Дима Глок: кто первый нажмёт — получит $150!' : '😎 Дима Глок раздаёт халяву… подозрительно', 'glok');
  active(r).filter((p) => p.bot).forEach((p) => {
    if (kind === 'trap' && rnd(100) >= 35) return;
    setTimeout(() => safe(() => glokTap(r, p, task.seq)), T(1200 + rnd(3500)));
  });
  r.glokCont = cont;
  sync(r);
  later(r, T(ms), () => finishGlok(r));
}

function glokTap(r, p, seq) {
  const t = r.glokTask;
  if (!t || t.seq !== seq || p.bankrupt || t.taps.includes(p.id)) return;
  t.taps.push(p.id);
  if (t.kind === 'race') finishGlok(r);
  else sync(r);
}

function finishGlok(r) {
  const t = r.glokTask;
  if (!t) return;
  r.glokTask = null;
  clearTimer(r);
  let title, text;
  if (t.kind === 'race') {
    const w = byId(r, t.taps[0]);
    if (w) { w.money += t.prize; track(w); title = 'ЕСТЬ ПОБЕДИТЕЛЬ'; text = `${w.name} самый шустрый: +$${t.prize}. Остальные — тормоза.`; }
    else { title = 'НИКТО?!'; text = 'Все проспали. Дима обиделся и забрал деньги себе.'; }
  } else {
    const losers = t.taps.map((id) => byId(r, id)).filter((p) => p && !p.bankrupt);
    losers.forEach((p) => hurt(p, pay(r, p, t.prize, null)));
    title = 'ЭТО БЫЛА ПОДСТАВА';
    text = losers.length ? `Халявы нет! ${losers.map((p) => p.name).join(', ')} — штраф по $${t.prize}. Ха-ха.` : 'Никто не повёлся. Скучные вы, братва.';
  }
  log(r, `😎 Дима Глок: ${text}`, 'glok');
  r.fx = { type: 'glok', title, text, line: '', seq: ++r.fxSeq, result: true };
  sync(r);
  const cont = r.glokCont; r.glokCont = null;
  later(r, T(2800), () => cont && cont());
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
  log(r, mode === 'sell' ? `🤝 ${from.name} предлагает ${to.name} купить «${cellName(cell)}» за $${price}` : `🤝 ${from.name} хочет выкупить у ${to.name} «${cellName(cell)}» за $${price}`, 'trade', { pid: from.id });
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
  log(r, `🤝 Сделка: ${buyer.name} купил «${cellName(o.cell)}» у ${seller.name} за $${o.price}`, 'trade-ok', { pid: buyer.id });
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
    if (inf !== (r.inflation || 1)) { r.inflation = inf; log(r, `🔥 БЕСПРЕДЕЛ: вся рента теперь ×${inf}`, 'omon'); }
    if (r.settings.rounds && r.round > r.settings.rounds) return finish(r, 'rounds');
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
  add(best((p) => p.st.strelkaWon), '🔪', 'Отморозок', 'Больше всех отжал на стрелках');
  add(best((p) => p.st.rentIn, 50), '🏢', 'Рантье', 'Больше всех собрал ренты');
  add(best((p) => p.st.glok, 50), '🤡', 'Любимчик Глока', 'Больше всех пострадал от Димы');
  add(best((p) => p.st.casino, 2), '🎰', 'Лудоман', 'Не вылезал из казино');
  add(best((p) => p.st.jail, 2), '⛓️', 'Сиделец', 'Чаще всех уезжал к ментам');
  add(best((p) => p.st.maxMoney, 0), '💵', 'Олигарх', 'Самая толстая пачка за игру');
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
  log(r, reason === 'rounds' ? `Круги вышли. Самый богатый — ${w ? w.name : '—'}` : `👑 ${w ? w.name : 'Никто'} забрал весь город!`, 'win');
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
    case 'CASINO': c = p.money > 900 && rnd(2) ? '100' : 'skip'; break;
    case 'STRELKA': {
      const edge = q.my - q.his;
      c = (edge >= 2 && p.money > q.rent * 2) || edge >= 4 ? 'fight' : 'pay';
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
  r.players.forEach((p) => Object.assign(p, freshStats()));
  Object.assign(r, {
    status: 'PLAYING', turn: 0, props: {}, heat: 0, omon: null, pot: 0, round: 1, inflation: 1,
    winner: null, standings: null, titles: null, dice: null, lastMove: null, fx: null, deck: [],
    sealed: null, glokTask: null, glokCont: null, turnsSinceGlok: 0, offers: [],
  });
  log(r, `Замес начался! Первым ходит ${r.players[0].name}`, 'start');
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

  function enter(r, d) {
    const acc = account(d);
    let name = cleanName(acc && acc.tg && !d.name ? acc.name : d.name);
    if (!name) return err('Введи погоняло');
    if (r.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = name.slice(0, 10) + ' ' + (r.players.length + 1);
    const p = makePlayer(r, name, cleanChar(d.char), acc);
    r.players.push(p);
    if (!r.hostId) r.hostId = p.id;
    tokens.set(p.token, r.code);
    return p;
  }

  on('create', (d) => {
    if (me) return err('Ты уже в комнате');
    if (!cleanName(d.name) && !tg.verify(d.session)) return err('Введи погоняло');
    const r = newRoom(newCode());
    rooms.set(r.code, r);
    const p = enter(r, d);
    if (!p) return rooms.delete(r.code);
    log(r, `${p.name} собрал сходку`, 'start');
    bind(r, p);
  });

  on('join', (d) => {
    if (me) return err('Ты уже в комнате');
    const r = rooms.get(String(d.code || '').trim());
    if (!r) return err('Нет такой сходки — проверь код');
    if (r.status !== 'LOBBY') return err('Игра уже идёт');
    if (r.players.length >= C.MAX_PLAYERS) return err(`Мест нет (макс ${C.MAX_PLAYERS})`);
    const p = enter(r, d);
    if (!p) return;
    log(r, `${p.name} примкнул к братве`, 'join');
    bind(r, p);
  });

  const host = () => me && me.r.hostId === me.p.id;

  on('addBot', () => {
    if (!host() || me.r.status !== 'LOBBY') return;
    const r = me.r;
    if (r.players.length >= C.MAX_PLAYERS) return err('Мест нет');
    const free = BOT_NAMES.filter((n) => !r.players.some((p) => p.name === 'Бот ' + n));
    const keys = Object.keys(CHARS), freeChars = keys.filter((k) => !r.players.some((p) => p.char === k));
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
    if (!me || me.r.status !== 'LOBBY' || !CHARS[char]) return;
    me.p.char = char; me.p.icon = CHARS[char].emoji;
    sync(me.r);
  });

  on('settings', ({ rounds, glok }) => {
    if (!host() || me.r.status !== 'LOBBY') return;
    if ([0, 10, 20, 30].includes(rounds)) me.r.settings.rounds = rounds;
    if (typeof glok === 'boolean') me.r.settings.glok = glok;
    sync(me.r);
  });

  on('start', () => {
    if (!host() || me.r.status !== 'LOBBY') return;
    if (me.r.players.length < 2) return err('Нужно минимум двое');
    startGame(me.r);
  });

  on('rematch', () => {
    if (!host() || me.r.status !== 'GAMEOVER') return;
    const r = me.r;
    r.status = 'LOBBY'; r.phase = null; r.props = {}; r.winner = null; r.standings = null; r.titles = null;
    r.players.forEach((p) => Object.assign(p, freshStats()));
    log(r, 'Новая сходка — ждём замес', 'start');
    sync(r);
  });

  const myTurn = () => me && me.r.status === 'PLAYING' && cur(me.r) === me.p;
  on('glok', ({ seq }) => { if (me && me.r.status === 'PLAYING') glokTap(me.r, me.p, seq); });
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
