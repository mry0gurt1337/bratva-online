'use strict';
// «Дурак» внутри «Братвы»: подкидной и переводной, 24/36 карт, 2–6 игроков, шулерство по желанию.
// Ставки — в «бабках» (бесплатная валюта, не покупается). Монеты за места платит сама игра.
const crypto = require('crypto');
const fs = require('fs'), path = require('path');
const G = require(fs.existsSync(path.join(__dirname, 'public', 'shared.js')) ? './public/shared.js' : './shared.js'); // в плоском пакете всё в одной папке
const D = G.DURAK;

const SPEED = process.env.FAST ? 0.02 : 1;
const T = (x) => Math.max(1, Math.round(x * SPEED));
const rnd = (n) => crypto.randomInt(n);
const MOVE_MS = 25000, TAKE_MS = 7000, BOT_MS = [900, 1700];
const SUITS = ['s', 'h', 'd', 'c'];
const QUICK = ['Красава', 'Ха-ха', 'Бито', 'Ну ты жук', 'Шулер!', 'Беру', 'Везёт же', 'Мир'];
const COLORS = G.COLORS;

function attach(io, { store, account, cleanName, CHARS, social }) {
  const rooms = new Map();
  const tokens = new Map(); // token -> { code, id }

  // ---------- карты ----------
  const cardId = (c) => c.r + c.s;
  const parse = (id) => { const m = /^(\d{1,2})([shdc])$/.exec(String(id)); return m ? { r: +m[1], s: m[2] } : null; };
  function newDeck(n) {
    const from = n === 24 ? 9 : 6, d = [];
    for (const s of SUITS) for (let r = from; r <= 14; r++) d.push({ r, s });
    for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  const beats = (a, d, trump) => (d.s === a.s && d.r > a.r) || (d.s === trump && a.s !== trump);

  // ---------- комнаты ----------
  function code() { let c; do c = String(1000 + rnd(9000)); while (rooms.has(c)); return c; }
  function newRoom(opts) {
    const tier = D.tiers[opts.tier] ? opts.tier : 'dvor';
    const T_ = D.tiers[tier];
    const r = {
      code: code(), tier, stake: T_.stakes.includes(+opts.stake) ? +opts.stake : T_.stakes[0],
      mode: opts.mode === 'per' ? 'per' : 'pod', deckN: +opts.deck === 24 ? 24 : 36,
      max: Math.min(6, Math.max(2, +opts.max || 4)), cheat: !!opts.cheat, priv: !!opts.priv,
      hostId: null, dealer: null, status: 'LOBBY', players: [], logs: [], logId: 0, seq: 0,
      deck: [], trump: null, table: [], attacker: 0, defender: 1, phase: null, passed: [], took: false,
      deadline: null, timer: null, order: [], durak: null, results: null, discard: 0, bout: 0, caught: null, chat: [],
    };
    rooms.set(r.code, r);
    return r;
  }
  const byId = (r, id) => r.players.find((p) => p.id === id);
  const alive = (r) => r.players.filter((p) => !p.out);
  const log = (r, text, kind = 'info') => { r.logs.push({ id: ++r.logId, text, kind }); if (r.logs.length > 60) r.logs.shift(); };

  function view(r, me) {
    return {
      code: r.code, tier: r.tier, stake: r.stake, mode: r.mode, deckN: r.deckN, max: r.max, cheat: r.cheat, priv: r.priv,
      hostId: r.hostId, status: r.status, dealer: r.dealer, seq: r.seq,
      players: r.players.map((p) => ({ id: p.id, name: p.name, char: p.char, color: p.color, bot: p.bot, photo: p.photo, frame: p.frame, back: p.back,
        n: p.hand.length, out: p.out, place: p.place, connected: p.bot || p.connected, bank: p.bot ? null : p.bank, left: !!p.left })),
      hand: me ? me.hand.map(cardId) : [],
      deck: r.deck.length, trump: r.trump ? cardId(r.trump) : null, table: r.table.map((t) => ({ a: cardId(t.a), d: t.d ? cardId(t.d) : null })),
      attacker: r.players[r.attacker] ? r.players[r.attacker].id : null, defender: r.players[r.defender] ? r.players[r.defender].id : null,
      phase: r.phase, passed: r.passed, discard: r.discard, limit: limit(r),
      remaining: r.deadline ? Math.max(0, r.deadline - Date.now()) : null, logs: r.logs.slice(-25), results: r.results,
      caught: r.caught, chat: r.chat.slice(-6), falseCatch: r.falseCatch || [],
    };
  }
  function sync(r) {
    r.seq++;
    for (const p of r.players) if (!p.bot && p.socketId) io.to(p.socketId).emit('dk:state', view(r, p));
    if (r.dealer && r.dealer.socketId) io.to(r.dealer.socketId).emit('dk:state', view(r, null));
  }
  function lobbyList() {
    return [...rooms.values()].filter((r) => r.status === 'LOBBY' && !r.priv && r.players.length < r.max)
      .map((r) => ({ code: r.code, tier: r.tier, stake: r.stake, mode: r.mode, deckN: r.deckN, max: r.max, cheat: r.cheat, dealer: r.dealer && r.dealer.name,
        players: r.players.map((p) => ({ char: p.char, photo: p.photo, name: p.name })) }));
  }

  // ---------- партия ----------
  const limit = (r) => Math.min(r.bout === 1 ? 5 : 6, r.boutStartHand || 6);
  const unbeaten = (r) => r.table.filter((t) => !t.d).length;
  const ranksOnTable = (r) => new Set(r.table.flatMap((t) => (t.d ? [t.a.r, t.d.r] : [t.a.r])));
  const nextAlive = (r, i) => { for (let k = 1; k <= r.players.length; k++) { const j = (i + k) % r.players.length; if (!r.players[j].out) return j; } return i; };
  const attackers = (r) => r.players.filter((p, i) => !p.out && i !== r.defender);

  function clearT(r) { clearTimeout(r.timer); r.timer = null; r.deadline = null; }
  function arm(r, ms) {
    clearT(r);
    r.deadline = Date.now() + T(ms);
    r.timer = setTimeout(() => safe(() => onTimeout(r)), T(ms));
    scheduleBots(r);
  }
  function safe(fn) { try { fn(); } catch (e) { console.error('[durak]', e); } }

  async function start(r) {
    if (r.status !== 'LOBBY' || r.players.length < 2) return;
    // ставки: сначала проверяем всех, потом списываем
    for (const p of r.players.filter((x) => !x.bot)) {
      const w = p.account ? await store.wallet(p.account.key) : null;
      if (!w || w.bucks < r.stake) { const h = byId(r, r.hostId); [p, h].forEach((x) => x && x.socketId && io.to(x.socketId).emit('dk:err', `${p.name}: не хватает бабок на ставку ${r.stake}`)); return; }
    }
    for (const p of r.players.filter((x) => !x.bot)) {
      const left = p.account ? await store.bucksAdd(p.account.key, -r.stake) : null;
      if (left == null) { p.socketId && io.to(p.socketId).emit('dk:err', `Не хватает бабок на ставку ${r.stake}`); return; }
      p.bank = left; p.paid = true;
    }
    r.status = 'PLAYING'; r.order = []; r.durak = null; r.results = null; r.discard = 0; r.bout = 0; r.caught = null;
    r.deck = newDeck(r.deckN);
    r.trump = r.deck[0]; // нижняя карта колоды — козырь, берётся последней
    r.players.forEach((p) => { p.hand = []; p.out = false; p.place = null; p.left = false; });
    for (let k = 0; k < 6; k++) for (const p of r.players) if (r.deck.length) p.hand.push(r.deck.pop());
    r.players.forEach(sortHand.bind(null, r));
    // первым ходит тот, у кого младший козырь
    let best = -1, bestR = 99;
    r.players.forEach((p, i) => p.hand.forEach((c) => { if (c.s === r.trump.s && c.r < bestR) { bestR = c.r; best = i; } }));
    r.attacker = best >= 0 ? best : rnd(r.players.length);
    log(r, `Раздача. Козырь — ${suitName(r.trump.s)}. ${best >= 0 ? `Первым ходит ${r.players[r.attacker].name}: младший козырь` : `Первым ходит ${r.players[r.attacker].name}`}`, 'start');
    newBout(r);
  }
  const suitName = (s) => ({ s: 'пики', h: 'черви', d: 'бубны', c: 'трефы' }[s]);
  const RN = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
  function sortHand(r, p) { p.hand.sort((a, b) => (a.s === r.trump.s) - (b.s === r.trump.s) || a.r - b.r || a.s.localeCompare(b.s)); }

  function newBout(r) {
    r.bout++;
    r.defender = nextAlive(r, r.attacker);
    r.table = []; r.passed = []; r.phase = 'attack'; r.took = false; r.caught = null; r.falseCatch = [];
    r.boutStartHand = r.players[r.defender].hand.length;
    sync(r); arm(r, MOVE_MS);
  }

  function canThrow(r, p, c) {
    const i = r.players.indexOf(p);
    if (p.out || i === r.defender || !p.hand.some((x) => x.r === c.r && x.s === c.s)) return false;
    if (r.table.length >= limit(r)) return false;
    if (!r.took && unbeaten(r) + 1 > r.players[r.defender].hand.length) return false;
    if (r.took && r.table.length + 1 > r.boutStartHand) return false;
    if (!r.table.length) return i === r.attacker; // первый ход — только ходящий
    return ranksOnTable(r).has(c.r);
  }
  function take(arr, c) { const k = arr.findIndex((x) => x.r === c.r && x.s === c.s); return k >= 0 ? arr.splice(k, 1)[0] : null; }

  function act(r, p, a) {
    if (r.status !== 'PLAYING' || !p || p.out) return false;
    const i = r.players.indexOf(p), isDef = i === r.defender;
    if (a.type === 'throw') {
      const c = parse(a.card); if (!c || !canThrow(r, p, c)) return false;
      take(p.hand, c); r.table.push({ a: c, d: null, by: p.id }); r.passed = [];
      log(r, `${p.name} ${r.table.length === 1 ? 'ходит' : 'подкидывает'}`, 'throw');
      return after(r);
    }
    if (a.type === 'beat' && isDef && !r.took) {
      const c = parse(a.card), slot = r.table[+a.slot];
      if (!c || !slot || slot.d || !p.hand.some((x) => x.r === c.r && x.s === c.s)) return false;
      const ok = beats(slot.a, c, r.trump.s);
      if (!ok && !r.cheat) return false;
      take(p.hand, c); slot.d = c; slot.cheat = !ok;
      return after(r);
    }
    if (a.type === 'transfer' && isDef && !r.took && r.mode === 'per') {
      const c = parse(a.card);
      if (!c || r.table.some((t) => t.d) || !r.table.length || r.table.some((t) => t.a.r !== c.r) || !p.hand.some((x) => x.r === c.r && x.s === c.s)) return false;
      const nd = nextAlive(r, r.defender);
      if (nd === i || r.players[nd].hand.length < r.table.length + 1) return false;
      take(p.hand, c); r.table.push({ a: c, d: null, by: p.id });
      r.attacker = r.defender; r.defender = nd; r.passed = []; r.boutStartHand = r.players[nd].hand.length;
      log(r, `${p.name} переводит на ${r.players[nd].name}`, 'transfer');
      return after(r);
    }
    if (a.type === 'take' && isDef && !r.took && unbeaten(r) > 0) {
      r.took = true; r.phase = 'take'; r.passed = [];
      log(r, `${p.name} берёт`, 'take');
      sync(r); arm(r, TAKE_MS);
      return true;
    }
    if (a.type === 'pass' && !isDef && r.table.length && !r.passed.includes(p.id)) {
      r.passed.push(p.id);
      return after(r);
    }
    if (a.type === 'catch' && r.cheat && !isDef && r.table.some((t) => t.d) && !(r.falseCatch || []).includes(p.id) && !r.table.some((t) => t.cheat)) {
      (r.falseCatch = r.falseCatch || []).push(p.id);
      log(r, `${p.name} зря наехал — шулерства не было`, 'cheat');
      sync(r); return true;
    }
    if (a.type === 'catch' && r.cheat && !isDef && r.table.some((t) => t.cheat) && !(r.falseCatch || []).includes(p.id)) {
      const def = r.players[r.defender];
      r.caught = { by: p.id, who: def.id };
      log(r, `${p.name} поймал ${def.name} на шулерстве — всё со стола забирает`, 'cheat');
      r.took = true; r.passed = attackers(r).map((x) => x.id);
      return endBout(r);
    }
    return false;
  }

  function after(r) {
    const def = r.players[r.defender];
    // защитник отбил всё и подкидывать нечего/все пасанули — бито
    const allPassed = attackers(r).every((x) => r.passed.includes(x.id) || !x.hand.length);
    if (r.took) { if (allPassed || r.table.length >= r.boutStartHand) return endBout(r); sync(r); arm(r, TAKE_MS); return true; }
    if (r.table.length && unbeaten(r) === 0 && (allPassed || r.table.length >= limit(r) || !def.hand.length)) return endBout(r);
    r.phase = unbeaten(r) ? 'defend' : 'attack';
    sync(r); arm(r, unbeaten(r) || !r.table.length ? MOVE_MS : 12000);
    return true;
  }

  function endBout(r) {
    clearT(r);
    const def = r.players[r.defender];
    if (r.took) {
      for (const t of r.table) { def.hand.push(t.a); if (t.d) def.hand.push(t.d); }
      sortHand(r, def);
    } else {
      r.discard += r.table.reduce((n, t) => n + 1 + (t.d ? 1 : 0), 0);
      log(r, r.table.some((t) => t.cheat) ? 'Бито. Шулер не пойман' : 'Бито', 'bito');
    }
    r.lastTable = r.table; r.table = [];
    // добор: сначала ходивший, потом по кругу, защитник последним
    const order = [];
    for (let k = 0; k < r.players.length; k++) { const j = (r.attacker + k) % r.players.length; if (j !== r.defender) order.push(j); }
    order.push(r.defender);
    for (const j of order) { const p = r.players[j]; while (p.hand.length < 6 && r.deck.length && !p.out) p.hand.push(r.deck.pop()); sortHand(r, p); }
    // кто вышел
    if (!r.deck.length) r.players.forEach((p) => { if (!p.out && !p.hand.length) { p.out = true; r.order.push(p.id); p.place = r.order.length; log(r, `${p.name} вышел`, 'out'); } });
    const left = alive(r);
    if (left.length <= 1) return finish(r, left[0] || null);
    // следующий ходящий
    const took = r.took;
    if (took) r.attacker = nextAlive(r, r.defender);
    else r.attacker = def.out ? nextAlive(r, r.defender) : r.defender;
    newBout(r);
    return true;
  }

  async function finish(r, durak) {
    clearT(r);
    r.status = 'OVER'; r.phase = null; r.durak = durak ? durak.id : null;
    if (durak) { durak.place = r.players.length; log(r, `${durak.name} — ДУРАК`, 'durak'); } else log(r, 'Ничья — все вышли одновременно', 'durak');
    // расчёт ставок: дурак и сбежавшие теряют ставку, остальные делят её (минус 5% в общак)
    const losers = r.players.filter((p) => p.id === r.durak || p.left);
    const winners = r.players.filter((p) => !losers.includes(p));
    const lostPot = losers.reduce((s, p) => s + (p.bot && !p.left ? r.stake * 0.5 : r.stake), 0);
    const share = winners.length ? Math.floor((lostPot * (1 - D.fee)) / winners.length) : 0;
    const shareNoFee = winners.length ? Math.floor(lostPot / winners.length) : 0;
    const humans = r.players.filter((x) => !x.bot).length;
    const res = [];
    for (const p of r.players) {
      const win = winners.includes(p);
      let delta = win ? share : -r.stake;
      if (!p.bot && p.account && p.paid && !p.left) {
        // буст клана «Без комиссии» — с выигрыша не сгорают 5%
        const my = win && social && await social.noFee(p.account.key) ? shareNoFee : share;
        if (win) delta = my;
        const back = win ? r.stake + my : 0;
        // выигрыш — через общак клана (автоотчисление с чистого выигрыша)
        if (back) p.bank = social ? await social.reward(p.account.key, back, my) : await store.bucksAdd(p.account.key, back);
        // оборот для отыгрыша долга: стол только с ботами — как игра против системы, с людьми — ×0.1
        if (social) social.onBet(p.account.key, r.stake, { pve: humans === 1 }).then((w) => { if (w) p.bank = w.bank; }).catch(() => {});
        // монеты за место — платит игра
        if (win) {
          const amt = Math.round((p.place === 1 ? D.coins.first : D.coins.rest) * (humans > 1 ? 1 : 0.5));
          store.credit(p.account.key, amt, 'game', G.EARN.dayCap).then((n) => { if (n && p.socketId) io.to(p.socketId).emit('earned', { amount: n, place: p.place }); }).catch(() => {});
        }
      }
      p.paid = false;
      res.push({ id: p.id, name: p.name, delta, place: p.place, durak: p.id === r.durak });
    }
    // чаевые дилеру — платит игра
    if (r.dealer && r.dealer.key) {
      const tip = Math.round(r.stake * D.tiers[r.tier].tip);
      (social ? social.reward(r.dealer.key, tip, tip) : store.bucksAdd(r.dealer.key, tip)).then((b) => { r.dealer.bank = b; if (r.dealer.socketId) io.to(r.dealer.socketId).emit('dk:tip', { amount: tip }); sync(r); }).catch(() => {});
    }
    r.results = res.sort((a, b) => (a.place || 99) - (b.place || 99));
    r.players = r.players.filter((p) => !p.left);
    sync(r);
  }

  function onTimeout(r) {
    r.timer = null; r.deadline = null;
    if (r.status !== 'PLAYING') return;
    const def = r.players[r.defender];
    if (r.took) return endBout(r);
    if (!r.table.length) { // ходящий уснул — ходим младшей картой
      const p = r.players[r.attacker];
      return act(r, p, { type: 'throw', card: cardId(p.hand[0]) });
    }
    if (unbeaten(r)) { log(r, `${def.name} не успел — берёт`, 'take'); return act(r, def, { type: 'take' }); }
    r.passed = attackers(r).map((x) => x.id);
    return endBout(r);
  }

  // ---------- боты ----------
  function scheduleBots(r) {
    clearTimeout(r.botT);
    if (r.status !== 'PLAYING' || !r.players.some((p) => p.bot && !p.out)) return;
    r.botT = setTimeout(() => safe(() => botStep(r)), T(BOT_MS[0] + rnd(BOT_MS[1] - BOT_MS[0])));
  }
  function botStep(r) {
    if (r.status !== 'PLAYING') return;
    const tr = r.trump.s, late = r.deck.length < 4;
    const val = (c) => c.r + (c.s === tr ? 20 : 0);
    // ловим шулера
    if (r.cheat && r.table.some((t) => t.cheat) && rnd(100) < 45) {
      const b = attackers(r).find((p) => p.bot);
      if (b) return act(r, b, { type: 'catch' });
    }
    const def = r.players[r.defender];
    if (def.bot && !r.took && unbeaten(r)) {
      // перевод, если дёшево
      if (r.mode === 'per' && !r.table.some((t) => t.d)) {
        const rk = r.table[0].a.r, c = def.hand.find((x) => x.r === rk && (x.s !== tr || late));
        if (c && act(r, def, { type: 'transfer', card: cardId(c) })) return;
      }
      const k = r.table.findIndex((t) => !t.d);
      const opts = def.hand.filter((c) => beats(r.table[k].a, c, tr)).sort((a, b) => val(a) - val(b));
      const c = opts[0];
      if (c && (c.s !== tr || late || r.table.length > 2 || val(c) < 30)) { act(r, def, { type: 'beat', slot: k, card: cardId(c) }); return; }
      act(r, def, { type: 'take' }); return;
    }
    // атакующие боты
    for (const p of attackers(r).filter((x) => x.bot && x.hand.length)) {
      if (r.passed.includes(p.id)) continue;
      if (!r.table.length) { if (r.players.indexOf(p) === r.attacker) { act(r, p, { type: 'throw', card: cardId(p.hand.slice().sort((a, b) => val(a) - val(b))[0]) }); return; } continue; }
      const ranks = ranksOnTable(r);
      const c = p.hand.filter((x) => ranks.has(x.r) && (x.s !== tr || late) && x.r < 13 + (late ? 2 : 0)).sort((a, b) => val(a) - val(b))[0];
      if (c && canThrow(r, p, c)) { act(r, p, { type: 'throw', card: cardId(c) }); return; }
      if (!unbeaten(r) || r.took) { act(r, p, { type: 'pass' }); return; }
    }
    scheduleBots(r);
  }

  // ---------- сокеты ----------
  const BOT_NAMES = ['Бот Шрам', 'Бот Косой', 'Бот Кабан', 'Бот Гвоздь', 'Бот Лютый', 'Бот Седой', 'Бот Хмурый', 'Бот Боцман'];
  function addPlayer(r, name, char, acc, bot, extra = {}) {
    const used = r.players.map((p) => p.color);
    const p = { id: crypto.randomBytes(4).toString('hex'), token: bot ? null : crypto.randomBytes(16).toString('hex'), name, char, account: acc || null, bot,
      color: COLORS.find((c) => !used.includes(c)) || COLORS[0], hand: [], out: false, place: null, connected: true, socketId: null, photo: acc && acc.photo, ...extra };
    r.players.push(p);
    if (p.token) tokens.set(p.token, { code: r.code, id: p.id });
    return p;
  }

  io.on('connection', (socket) => {
    let me = null; // { r, p } или { r, dealer: true }
    const err = (m) => socket.emit('dk:err', m);
    const on = (ev, fn) => socket.on(ev, (d) => Promise.resolve().then(() => fn(d && typeof d === 'object' ? d : {})).catch((e) => { console.error('[durak]', ev, e); err('Ошибка, попробуй ещё раз'); }));
    const host = () => me && me.p && me.r.hostId === me.p.id;

    async function cos(acc) {
      if (!acc) return { bank: null };
      const w = await store.wallet(acc.key);
      return { bank: w.bucks, frame: w.equip.frame || null, back: w.equip.back || null };
    }
    function bind(r, p) { if (!p.left) p.bot = false; me = { r, p }; p.socketId = socket.id; p.connected = true; socket.emit('dk:you', { id: p.id, token: p.token, code: r.code }); sync(r); }
    function leave() {
      if (!me) return;
      const { r, p } = me;
      if (me.dealer) { if (r.dealer && r.dealer.socketId === socket.id) { r.dealer = null; log(r, 'Дилер ушёл'); sync(r); } me = null; return; }
      if (r.status === 'PLAYING' && !p.out) {
        // сбежал: ставка сгорает, за него доигрывает бот
        p.left = true; p.bot = true; p.name = p.name + ' (бот)'; p.socketId = null;
        log(r, `${p.name.replace(' (бот)', '')} сбежал — ставка сгорела, за него доигрывает бот`, 'leave');
        tokens.delete(p.token);
        if (r.hostId === p.id) { const h = r.players.find((x) => !x.bot); r.hostId = h ? h.id : null; }
        scheduleBots(r); sync(r);
      } else {
        r.players = r.players.filter((x) => x !== p); tokens.delete(p.token);
        if (r.hostId === p.id) { const h = r.players.find((x) => !x.bot); r.hostId = h ? h.id : null; }
        if (!r.players.some((x) => !x.bot)) { clearT(r); rooms.delete(r.code); } else sync(r);
      }
      me = null; socket.emit('dk:you', null);
    }

    on('dk:lobby', async (d) => {
      const acc = account(d);
      let bank = null;
      if (acc) { const refill = await store.bucksRefill(acc.key, D.refillBelow, social ? await social.refillTo(acc.key) : D.refillTo); bank = refill != null ? refill : (await store.wallet(acc.key)).bucks; if (refill != null) socket.emit('dk:refill', { bank }); }
      socket.emit('dk:lobby', { tables: lobbyList(), bank });
    });
    on('dk:create', async (d) => {
      const acc = account(d); if (!acc) return err('Нужен профиль');
      if (me) leave();
      const c = await cos(acc);
      const tier = D.tiers[d.tier] ? d.tier : 'dvor', T_ = D.tiers[tier], stake = T_.stakes.includes(+d.stake) ? +d.stake : T_.stakes[0];
      if (c.bank < stake) return err(`Не хватает бабок: нужно ${stake}`);
      if (T_.minBank && c.bank < T_.minBank) return err(`В Подпольный клуб пускают от ${T_.minBank} бабок`);
      const r = newRoom({ ...d, tier, stake });
      const p = addPlayer(r, cleanName(acc.tg && !d.name ? acc.name : d.name) || 'Игрок', CHARS[d.char] && !CHARS[d.char].secret ? d.char : 'boec', acc, false, c);
      r.hostId = p.id; log(r, `${p.name} накрыл стол`, 'start');
      bind(r, p);
    });
    on('dk:join', async (d) => {
      const acc = account(d); if (!acc) return err('Нужен профиль');
      const r = rooms.get(String(d.code || '').replace(/\D/g, ''));
      if (!r) return err('Нет такого стола');
      if (r.status !== 'LOBBY' && r.status !== 'OVER') return err('Там уже играют');
      if (r.players.length >= r.max) return err('Мест нет');
      const c = await cos(acc);
      if (c.bank < r.stake) return err(`Не хватает бабок: ставка ${r.stake}`);
      if (me) leave();
      const p = addPlayer(r, cleanName(acc.tg && !d.name ? acc.name : d.name) || 'Игрок', CHARS[d.char] && !CHARS[d.char].secret ? d.char : 'boec', acc, false, c);
      if (!r.hostId) r.hostId = p.id;
      log(r, `${p.name} сел за стол`, 'join');
      bind(r, p);
    });
    on('dk:resume', (d) => {
      const t = tokens.get(String(d.token || '')); if (!t) return socket.emit('dk:you', null);
      const r = rooms.get(t.code), p = r && byId(r, t.id);
      if (!p) return socket.emit('dk:you', null);
      bind(r, p);
    });
    on('dk:bot', () => {
      if (!host() || me.r.status === 'PLAYING' || me.r.players.length >= me.r.max) return;
      const r = me.r, names = BOT_NAMES.filter((n) => !r.players.some((p) => p.name === n));
      const chars = Object.keys(CHARS).filter((k) => !CHARS[k].secret);
      addPlayer(r, names[rnd(names.length)] || 'Бот', chars[rnd(chars.length)], null, true, { back: ['back-gold', 'back-neon', 'back-camo', 'back-zek', null][rnd(5)] });
      sync(r);
    });
    on('dk:kick', ({ id }) => {
      if (!host() || me.r.status === 'PLAYING') return;
      const p = byId(me.r, id); if (!p || !p.bot) return;
      me.r.players = me.r.players.filter((x) => x !== p); sync(me.r);
    });
    on('dk:start', () => { if (host() && (me.r.status === 'LOBBY' || me.r.status === 'OVER')) { me.r.status = 'LOBBY'; start(me.r); } });
    on('dk:act', (a) => { if (me && me.p && !me.dealer) act(me.r, me.p, { type: String(a.type), card: a.card, slot: a.slot }); });
    on('dk:chat', ({ text }) => {
      if (!me || !me.p) return;
      const t = QUICK.includes(text) ? text : String(text || '').replace(/[<>]/g, '').slice(0, 60).trim();
      if (!t) return;
      me.r.chat.push({ id: me.p.id, text: t, at: Date.now() }); if (me.r.chat.length > 20) me.r.chat.shift();
      sync(me.r);
    });
    on('dk:dealer', async (d) => {
      // сесть дилером: платишь бабками, держишь стол, игра платит чаевые за каждую партию
      const acc = account(d); if (!acc) return err('Нужен профиль');
      const r = rooms.get(String(d.code || '')); if (!r) return err('Нет такого стола');
      if (r.dealer) return err('Дилер уже есть');
      if (me && me.p && me.r === r) return err('Ты уже сидишь игроком');
      const fee = r.stake * D.dealerFee;
      const bank = await store.bucksAdd(acc.key, -fee);
      if (bank == null) return err(`Чтобы сесть дилером, нужно ${fee} бабок`);
      const w = await store.wallet(acc.key);
      r.dealer = { name: cleanName(acc.tg && !d.name ? acc.name : d.name) || 'Дилер', char: CHARS[d.char] ? d.char : 'advokat', photo: acc.photo, key: acc.key, socketId: socket.id, bank, felt: w.equip.felt || null };
      me = { r, dealer: true };
      log(r, `${r.dealer.name} сел дилером`, 'dealer');
      socket.emit('dk:you', { dealer: true, code: r.code });
      sync(r);
    });
    on('dk:leave', () => leave());
    socket.on('disconnect', () => safe(() => {
      if (!me) return;
      if (me.dealer) return leave();
      const { r, p } = me; p.connected = false; p.socketId = null; sync(r);
      // в лобби убираем через минуту, в игре — доигрывает бот после таймаута хода
      setTimeout(() => safe(() => { if (!p.connected && rooms.get(r.code) === r) { if (r.status === 'PLAYING' && !p.out) { p.bot = true; scheduleBots(r); } else if (r.status !== 'PLAYING') { r.players = r.players.filter((x) => x !== p); if (r.hostId === p.id) { const h = r.players.find((x) => !x.bot); r.hostId = h ? h.id : null; } if (!r.players.some((x) => !x.bot)) rooms.delete(r.code); else sync(r); } } }), T(60000));
    }));
  });

  // пустые столы убираем
  setInterval(() => { for (const [k, r] of rooms) if (!r.players.some((p) => !p.bot && p.connected) && !r.dealer) { clearT(r); clearTimeout(r.botT); rooms.delete(k); } }, 5 * 60000).unref();
  return { rooms, _act: act, _start: start, _new: newRoom, _add: addPlayer, beats };
}

module.exports = { attach };
