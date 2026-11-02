'use strict';
// БРАТВА — сервер. Вся логика игры живёт здесь: клиенты только присылают
// «бросить», «купить», «стрелка», а кубики и деньги считает сервер.
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const fs = require('fs');
// Клиентские файлы лежат в public/ (локально) или прямо рядом с server.js (версия для хостинга без папок)
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const G = require(path.join(PUB, 'shared.js'));
const { BOARD, C } = G;

const PORT = Number(process.env.PORT) || 3000;
const SPEED = process.env.FAST ? 0.02 : 1; // FAST=1 — ускоренный режим для тестов
const T = (x) => Math.max(1, Math.round(x * SPEED));
const TURN_MS = 45000;      // время на ход
const OFFLINE_MS = 12000;   // если игрок отвалился — ждём меньше
const N = C.N;

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // за прокси хостинга (Render и т.п.)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
if (PUB !== __dirname) app.use(express.static(PUB));
else {
  const PUBLIC_FILES = new Set(['index.html', 'style.css', 'game.js', 'sound.js', 'shared.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-512.png']);
  app.get('/:f?', (req, res, next) => {
    const f = req.params.f || 'index.html';
    if (!PUBLIC_FILES.has(f)) return next();
    res.sendFile(path.join(PUB, f));
  });
}

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // домашние сети вперёд (192.168.*, 10.*), виртуалки и VPN — в конец
  const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => score(a) - score(b));
}
app.get('/api/info', (req, res) => res.json({ urls: lanIPs().map((ip) => `http://${ip}:${PORT}`) }));
app.get('/api/qr', async (req, res) => {
  const u = String(req.query.u || '');
  if (!/^https?:\/\/\S{1,200}$/.test(u)) return res.status(400).end();
  try {
    const svg = await QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111014', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'max-age=3600').send(svg);
  } catch { res.status(500).end(); }
});

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 4096 });

// ---------- Состояние ----------
const rooms = new Map();   // code -> room
const tokens = new Map();  // секретный токен игрока -> code комнаты
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));
const d6 = () => crypto.randomInt(1, 7);
const rnd = (n) => crypto.randomInt(n);
const BOT_NAMES = ['Шрам', 'Кабан', 'Седой', 'Лютый', 'Боцман', 'Хмурый', 'Гвоздь'];

function newCode() {
  let c;
  do { c = String(crypto.randomInt(1000, 10000)); } while (rooms.has(c));
  return c;
}
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
const cleanIcon = (s) => (G.ICONS.includes(s) ? s : G.ICONS[0]);

function makePlayer(r, name, icon, bot = false) {
  const used = r.players.map((p) => p.color);
  return {
    id: crypto.randomBytes(4).toString('hex'),
    token: bot ? null : crypto.randomBytes(16).toString('hex'),
    name, icon, color: G.COLORS.find((c) => !used.includes(c)) || G.COLORS[0],
    bot, connected: !bot ? true : true, socketId: null,
    ...freshStats(),
  };
}
const freshStats = () => ({ money: C.START_MONEY, auth: 0, goons: 0, pos: 0, jail: 0, bankrupt: false, doubles: 0, extra: false });

function newRoom(code) {
  return {
    code, hostId: null, status: 'LOBBY', settings: { rounds: 20, glok: true }, players: [],
    turn: 0, phase: null, pending: null, props: {}, heat: 0, omon: null,
    logs: [], logSeq: 0, dice: null, lastMove: null, moveSeq: 0, fx: null, fxSeq: 0,
    round: 1, winner: null, standings: null, deck: [], sealed: null, glokTask: null, glokCont: null, turnsSinceGlok: 0,
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
      id: p.id, name: p.name, icon: p.icon, color: p.color, money: p.money, auth: p.auth,
      goons: p.goons, pos: p.pos, jail: p.jail, bankrupt: p.bankrupt, bot: p.bot,
      connected: p.bot || p.connected,
    })),
    turn: r.turn, phase: r.phase, pending: r.pending, props: r.props, heat: r.heat, omon: r.omon,
    logs: r.logs, dice: r.dice, lastMove: r.lastMove, fx: r.fx, round: r.round,
    winner: r.winner, standings: r.standings, sealed: r.sealed,
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
    p.money += C.SALARY;
    log(r, `${p.name} заглянул в Общак: +$${C.SALARY}`, 'salary', { pid: p.id });
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
    case 'prop': return landProp(r, p, c);
    case 'gym':
      if (p.goons < C.MAX_GOONS && p.money >= C.GOON_PRICE) return ask(r, { type: 'GYM', price: C.GOON_PRICE });
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
      const t = Math.max(20, Math.round((p.money * 0.1) / 10) * 10);
      log(r, `Налоговая: ${p.name} заносит $${t} (10%)`, 'loss', { pid: p.id });
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
    if (p.money >= c.price) return ask(r, { type: 'BUY', cell: c.id, price: c.price });
    log(r, `${p.name} не тянет «${c.name}» ($${c.price})`, 'info');
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
  const rent = G.rentOf(r.props, c.id);
  return ask(r, { type: 'STRELKA', cell: c.id, rent, owner: owner.id, ownerName: owner.name });
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
  { t: 'В бригаду пришёл новый браток', f: (r, p) => { p.goons = Math.min(C.MAX_GOONS, p.goons + 1); } },
  { t: 'Срочно вызывают на Рублёвку', move: 19 },
  { t: 'Прямиком к ментам!', f: (r, p) => sendToJail(r, p) },
  { t: 'Проверка бизнеса: $20 за каждую точку и звезду', f: (r, p) => {
    const n = Object.values(r.props).filter((v) => v.owner === p.id).reduce((s, v) => s + 1 + v.level, 0);
    if (n) pay(r, p, n * 20, null);
  } },
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
  card.f(r, p);
  afterAction(r, 1700);
}

// ---------- Деньги и банкротство ----------
function pay(r, p, amount, to) {
  p.money -= amount;
  if (p.money < 0) liquidate(r, p);
  const paid = p.money < 0 ? amount + p.money : amount;
  if (to && !to.bankrupt) to.money += Math.max(0, paid);
  if (p.money < 0) bankrupt(r, p);
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
      if (choice === 'yes' && p.money >= c.price && !r.props[q.cell]) {
        p.money -= c.price;
        r.props[q.cell] = { owner: p.id, level: 0 };
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
      if (choice === 'yes' && p.money >= C.GOON_PRICE && p.goons < C.MAX_GOONS) {
        p.money -= C.GOON_PRICE; p.goons += 1;
        log(r, `${p.name} нанял братка (теперь ${p.goons})`, 'goon', { pid: p.id });
      }
      break;
    case 'CASINO': {
      const bet = Number(choice);
      if (q.bets.includes(bet) && p.money >= bet) {
        const x = rnd(100);
        if (x < 5) { p.money += bet * 4; heat(r, 1); log(r, `🎰 ДЖЕКПОТ! ${p.name} сорвал $${bet * 5}`, 'win', { pid: p.id }); }
        else if (x < 47) { p.money += bet; heat(r, 1); log(r, `🎰 ${p.name} поднял $${bet * 2} на ставке $${bet}`, 'win', { pid: p.id }); }
        else { pay(r, p, bet, null); log(r, `🎰 ${p.name} проиграл $${bet}`, 'loss', { pid: p.id }); }
        r.fx = { type: 'casino', pid: p.id, bet, win: x < 47, jackpot: x < 5, seq: ++r.fxSeq };
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
        pay(r, p, q.rent, owner);
      }
      break;
    }
    case 'JAIL':
      if (choice === 'pay' && p.money >= q.bail) {
        p.money -= q.bail; p.jail = 0;
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
  const aP = aRoll + p.auth + p.goons, oP = oRoll + owner.auth + owner.goons;
  const win = aP > oP; // ничья — за хозяином
  heat(r, 2);
  r.fx = { type: 'strelka', seq: ++r.fxSeq, a: p.id, o: owner.id, aRoll, oRoll, aP, oP, win, cell: q.cell };
  const c = BOARD[q.cell];
  if (win) {
    const pr = r.props[q.cell];
    pr.owner = p.id; pr.level = Math.max(0, pr.level - 1);
    p.auth += 1; owner.auth = Math.max(0, owner.auth - 1);
    log(r, `⚔️ СТРЕЛКА: ${p.name} (${aP}) против ${owner.name} (${oP}) — «${c.name}» отжата!`, 'strelka', { pid: p.id });
  } else {
    const pen = q.rent * 2;
    p.auth = Math.max(0, p.auth - 1);
    if (p.goons > 0) p.goons -= 1;
    log(r, `⚔️ СТРЕЛКА: ${p.name} (${aP}) против ${owner.name} (${oP}) — слил, штраф $${pen}`, 'strelka', { pid: p.id });
    pay(r, p, pen, owner);
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
    else { log(r, `ОМОН повязал ${p.name}: штраф $${C.OMON_FINE}`, 'omon', { pid: p.id }); pay(r, p, C.OMON_FINE, null); }
  }
  r.omon = null; r.heat = 0;
  log(r, 'Облава закончена, розыск сброшен', 'info');
}


// ---------- Надзиратель Дима Глок ----------
// Приходит в случайный момент между ходами и устраивает движ.
const GLOK_LINES = [
  'Так-так-так… кто тут у нас?', 'Скучно мне что-то, братва.', 'Надзиратель Глок на смене!',
  'Ничего личного, просто работа.', 'Расслабились? Зря.', 'Сюрприз, граждане!', 'Опять без меня веселитесь?',
];
const richest = (r) => active(r).slice().sort((a, b) => b.money - a.money)[0];
const poorest = (r) => active(r).slice().sort((a, b) => a.money - b.money)[0];
const two = (r) => { const a = shuffle(active(r).slice()); return a.length >= 2 ? [a[0], a[1]] : null; };
const GLOK_EVENTS = [
  { w: 3, f(r) {
    const a = richest(r), b = poorest(r);
    if (!a || a === b) return null;
    const x = Math.max(20, Math.round(a.money * 0.15 / 10) * 10);
    pay(r, a, x, b);
    return { title: 'ШМОН', text: `Отобрал у ${a.name} $${x} и отдал ${b.name}. «Делиться надо!»` };
  } },
  { w: 3, f(r) {
    active(r).forEach((p) => pay(r, p, 25, null));
    return { title: 'НА ЧАЙ', text: 'Каждый скидывается Диме по $25. Без вопросов.' };
  } },
  { w: 2, f(r) {
    const p = active(r)[rnd(active(r).length)];
    p.money += 150;
    return { title: 'ДИМА ДОБРЫЙ', text: `${p.name} получает $150. Просто так. Не привыкай.` };
  } },
  { w: 2, f(r) {
    const t = two(r); if (!t) return null;
    [t[0].pos, t[1].pos] = [t[1].pos, t[0].pos];
    return { title: 'ПЕРЕКЛИЧКА', text: `${t[0].name} и ${t[1].name} поменялись местами. Глок так видит.` };
  } },
  { w: 1, f(r) {
    const t = two(r); if (!t) return null;
    [t[0].money, t[1].money] = [t[1].money, t[0].money];
    return { title: 'ПЕРЕПУТАЛ ВЕДОМОСТИ', text: `${t[0].name} и ${t[1].name} обменялись ВСЕМИ деньгами. Упс.` };
  } },
  { w: 2, f(r) {
    active(r).forEach((p) => { p.pos = (p.pos - 3 + N) % N; });
    return { title: 'ВСЕМ ЛЕЧЬ!', text: 'Все отползают на 3 клетки назад. Мордой в пол!' };
  } },
  { w: 2, f(r) {
    const owned = Object.keys(r.props);
    if (!owned.length) return null;
    const cell = +owned[rnd(owned.length)];
    r.sealed = { cell, until: r.round + 2 };
    const o = byId(r, r.props[cell].owner);
    return { title: 'ОПЕЧАТАНО', text: `«${cellName(cell)}» (${o ? o.name : '—'}) закрыта на 2 круга. Ренты нет.` };
  } },
  { w: 1, f(r) {
    if (r.omon !== null) return null;
    r.heat = C.MAX_HEAT; r.omon = C.POLICE;
    return { title: 'ВЫЗВАЛ ОМОН', text: 'Дима позвонил куда надо. ОМОН уже выехал.' };
  } },
  { w: 2, f(r) {
    r.players.forEach((p) => { p.jail = 0; });
    r.heat = 0; r.omon = null;
    return { title: 'АМНИСТИЯ', text: 'У Димы день рождения: все на свободе, розыск сброшен.' };
  } },
  { w: 2, f(r) {
    const p = active(r).filter((x) => x.goons > 0).sort((a, b) => b.goons - a.goons)[0];
    if (!p) return null;
    p.goons -= 1;
    return { title: 'ИСПРАВРАБОТЫ', text: `Забрал братка у ${p.name} — пусть картошку чистит.` };
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
    log(r, `👮 Дима Глок: ${res.title} — ${res.text}`, 'glok');
    r.fx = { type: 'glok', title: res.title, text: res.text, line: GLOK_LINES[rnd(GLOK_LINES.length)], seq: ++r.fxSeq };
    r.phase = 'GLOK'; r.pending = null;
    sync(r);
    return later(r, T(3200), cont);
  }
  cont();
}

function glokChallenge(r, kind, cont) {
  const ms = 6000;
  const task = { kind, seq: ++r.fxSeq, prize: kind === 'race' ? 150 : 100, ms, taps: [], line: GLOK_LINES[rnd(GLOK_LINES.length)] };
  r.glokTask = task;
  r.phase = 'GLOK'; r.pending = null;
  log(r, kind === 'race' ? '👮 Дима Глок: кто первый нажмёт — получит $150!' : '👮 Дима Глок раздаёт халяву… подозрительно', 'glok');
  // боты тоже участвуют: в гонке жмут быстро, в ловушку попадаются иногда
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
}

function finishGlok(r) {
  const t = r.glokTask;
  if (!t) return;
  r.glokTask = null;
  clearTimer(r);
  let title, text;
  if (t.kind === 'race') {
    const w = byId(r, t.taps[0]);
    if (w) { w.money += t.prize; title = 'ЕСТЬ ПОБЕДИТЕЛЬ'; text = `${w.name} самый шустрый: +$${t.prize}. Остальные — тормоза.`; }
    else { title = 'НИКТО?!'; text = 'Все проспали. Дима обиделся и забрал деньги себе.'; }
  } else {
    const losers = t.taps.map((id) => byId(r, id)).filter(Boolean);
    losers.forEach((p) => pay(r, p, t.prize, null));
    title = 'ЭТО БЫЛА ЛОВУШКА';
    text = losers.length ? `Халявы нет! ${losers.map((p) => p.name).join(', ')} — штраф по $${t.prize}. Ха-ха.` : 'Никто не повёлся. Скучные вы, братва.';
  }
  log(r, `👮 Дима Глок: ${text}`, 'glok');
  r.fx = { type: 'glok', title, text, line: '', seq: ++r.fxSeq, result: true };
  sync(r);
  const cont = r.glokCont; r.glokCont = null;
  later(r, T(2800), () => cont && cont());
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

function finish(r, reason) {
  clearTimer(r);
  r.status = 'GAMEOVER'; r.phase = null; r.pending = null;
  r.standings = r.players
    .map((p) => ({ id: p.id, worth: netWorth(r, p), bankrupt: p.bankrupt }))
    .sort((a, b) => (a.bankrupt - b.bankrupt) || (b.worth - a.worth));
  r.winner = r.standings[0] ? r.standings[0].id : null;
  const w = byId(r, r.winner);
  log(r, reason === 'rounds' ? `Круги вышли. Самый богатый — ${w ? w.name : '—'}` : `👑 ${w ? w.name : 'Никто'} забрал весь город!`, 'win');
  sync(r);
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
      const o = byId(r, q.owner);
      const edge = p.auth + p.goons - (o ? o.auth + o.goons : 0);
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
    status: 'PLAYING', turn: 0, props: {}, heat: 0, omon: null, round: 1,
    winner: null, standings: null, dice: null, lastMove: null, fx: null, deck: [],
    sealed: null, glokTask: null, glokCont: null, turnsSinceGlok: 0,
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

io.on('connection', (socket) => {
  let me = null; // { r, p }
  let lastChat = 0;
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

  on('create', ({ name, icon }) => {
    if (me) return err('Ты уже в комнате');
    name = cleanName(name);
    if (!name) return err('Введи погоняло');
    const r = newRoom(newCode());
    const p = makePlayer(r, name, cleanIcon(icon));
    r.players.push(p); r.hostId = p.id;
    rooms.set(r.code, r); tokens.set(p.token, r.code);
    log(r, `${name} собрал сходку`, 'start');
    bind(r, p);
  });

  on('join', ({ code, name, icon }) => {
    if (me) return err('Ты уже в комнате');
    name = cleanName(name);
    if (!name) return err('Введи погоняло');
    const r = rooms.get(String(code || '').trim());
    if (!r) return err('Нет такой сходки — проверь код');
    if (r.status !== 'LOBBY') return err('Игра уже идёт');
    if (r.players.length >= C.MAX_PLAYERS) return err(`Мест нет (макс ${C.MAX_PLAYERS})`);
    if (r.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = (name.slice(0, 10) + ' ' + (r.players.length + 1));
    const p = makePlayer(r, name, cleanIcon(icon));
    r.players.push(p); tokens.set(p.token, r.code);
    log(r, `${name} примкнул к братве`, 'join');
    bind(r, p);
  });

  const host = () => me && me.r.hostId === me.p.id;

  on('addBot', () => {
    if (!host() || me.r.status !== 'LOBBY') return;
    const r = me.r;
    if (r.players.length >= C.MAX_PLAYERS) return err('Мест нет');
    const free = BOT_NAMES.filter((n) => !r.players.some((p) => p.name === 'Бот ' + n));
    const icons = G.ICONS.filter((i) => !r.players.some((p) => p.icon === i));
    const p = makePlayer(r, 'Бот ' + (free[rnd(free.length)] || 'Х'), icons.length ? icons[rnd(icons.length)] : G.ICONS[rnd(G.ICONS.length)], true);
    r.players.push(p);
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
    r.status = 'LOBBY'; r.phase = null; r.props = {}; r.winner = null; r.standings = null;
    r.players.forEach((p) => Object.assign(p, freshStats()));
    log(r, 'Новая сходка — ждём замес', 'start');
    sync(r);
  });

  const myTurn = () => me && me.r.status === 'PLAYING' && cur(me.r) === me.p;
  on('glok', ({ seq }) => { if (me && me.r.status === 'PLAYING') glokTap(me.r, me.p, seq); });
  on('roll', () => { if (myTurn() && me.r.phase === 'ROLL') doRoll(me.r); });
  on('decide', ({ choice }) => { if (myTurn() && me.r.phase === 'DECIDE') resolve(me.r, String(choice)); });

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
    if (p.socketId !== socket.id) return; // уже переподключился с другой вкладки
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

// Пустые комнаты чистим через 20 минут
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

server.listen(PORT, '0.0.0.0', async () => {
  const urls = lanIPs().map((ip) => `http://${ip}:${PORT}`);
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║   БРАТВА — сервер запущен            ║');
  console.log('  ╚══════════════════════════════════════╝\n');
  console.log(`  На этом ПК:      http://localhost:${PORT}`);
  urls.forEach((u) => console.log(`  Для друзей (Wi-Fi): ${u}`));
  if (urls[0] && !process.env.FAST) {
    try { console.log('\n' + (await QRCode.toString(urls[0], { type: 'terminal', small: true }))); } catch {}
    console.log('  Наведи камеру телефона на QR — откроется игра.');
  }
  console.log('  Остановить сервер: Ctrl + C\n');
});

module.exports = { rooms };
