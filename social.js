'use strict';
// Социальный слой «Братвы»: глобальный чат, кореша (друзья) с онлайн-статусом и приглашениями,
// кланы с общаком, долг из общака с отыгрышем, ночное колесо района (00:00 по Москве).
// Все события — soc:* на том же сокете. Деньги считает только сервер, всё в «бабках».
const crypto = require('crypto');
let cron = null;
try { cron = require('node-cron'); } catch { /* без node-cron работает страховочная проверка раз в минуту */ }

const TZ = 'Europe/Moscow';
const mskDay = (t = Date.now()) => new Date(t + 3 * 3600000).toISOString().slice(0, 10); // Москва — UTC+3 круглый год

// ---------- фильтр мата ----------
// Слово приводим к «скелету»: латиница-двойники → кириллица, ё → е, убираем всё кроме букв, схлопываем повторы.
// Корни подобраны так, чтобы не задевать обычные слова («тебе», «страхуем», «мудрый», «мандарин», «небо»).
const LOOK = { a: 'а', b: 'б', c: 'с', e: 'е', k: 'к', m: 'м', h: 'н', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'и', '3': 'з', '0': 'о', '@': 'а', '6': 'б', 'ё': 'е' };
const BAD = [
  /^(о|а|по|на|от|за|ни|до|вы|при|об|раз|с|у|под|пере)?ху[йеяию]/,
  /п[ие]зд/,
  /^(за|у|вы|от|на|по|раз|разъ|съ|въ|до|при|про|недо|пере|ъ)?еб(а|у|л|н|и|о|ыв|ись|ош)/,
  /долбо[её]?б/, /^бл[яь]/, /^муд(ак|ил|оз|ач)/, /^пид[оа]?р/, /^педик/, /^г[ао]ндон/, /залуп/, /шлю[хш]/,
  /^сук(а|и|ин|ой|у)$/, /^суч(к|ар|ий)/, /^манд(а|ой|у|ы)$/, /^дроч/, /^ебл/,
];
function skeleton(w) {
  let s = '';
  for (const ch of w.toLowerCase()) s += LOOK[ch] || ch;
  s = s.replace(/[^а-я]/g, '');
  return s.replace(/(.)\1+/g, '$1');
}
function cleanText(text) {
  let bad = false;
  const out = text.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const sk = skeleton(tok);
    if (sk && BAD.some((re) => re.test(sk))) { bad = true; return '*'.repeat(Math.min(6, Math.max(3, tok.length))); }
    return tok;
  }).join('');
  return { text: out, bad };
}
// Ссылки в общем чате скрываем — частый спам
const LINK = /(https?:\/\/|www\.|t\.me\/|@[a-z0-9_]{5,}bot\b|\b[a-z0-9-]{2,}\.(ru|com|net|org|me|io|xyz|top|su|рф)\b)/i;

function attach(io, { store, account, cleanName, CHARS, G, monopolyRooms, durakRooms }) {
  const { CLANS, CLAN } = G;
  const CLAN_IDS = Object.keys(CLANS);
  const FAST = !!process.env.FAST;
  const LOAN_HOURS = FAST ? 0 : CLAN.loan.minHours;
  const SWITCH_MS = CLAN.switchDays * 86400000;
  const bonusRateOf = (clan) => (clan === 'delovye' ? CLAN.delovyeBonus : 0);
  const fmt = (n) => Number(n).toLocaleString('ru-RU');

  // ---------- онлайн (presence) ----------
  const online = new Map();       // key -> Set(socket.id)
  const offTimers = new Map();    // key -> таймер «ушёл из сети» (даём 5 с на переподключение)
  const isOnline = (key) => online.has(key);
  async function notifyFriends(key, isOn) {
    const keys = await store.friendKeys(key).catch(() => []);
    for (const k of keys) if (online.has(k)) io.to('u:' + k).emit('soc:presence', { key, online: isOn });
  }

  // ---------- антиспам чата ----------
  const MUTE_STEPS = [15, 60, 300]; // секунды: каждое новое нарушение — дольше
  const flood = new Map();          // id (ключ или ip) -> { last, strikes, until, lastText, lastTextAt }
  const fl = (id) => flood.get(id) || (flood.set(id, { last: 0, strikes: 0, until: 0, lastText: '', lastTextAt: 0 }), flood.get(id));
  setInterval(() => { const t = Date.now(); for (const [k, v] of flood) if (v.until < t && t - v.last > 3600000) flood.delete(k); }, 600000).unref();
  // Проверка частоты: больше 1 сообщения в секунду — мут. Возвращает null или текст отказа.
  function rate(ids, text) {
    const t = Date.now(), recs = ids.map(fl);
    const muted = recs.find((r) => r.until > t);
    if (muted) return { mute: Math.ceil((muted.until - t) / 1000) };
    if (recs.some((r) => t - r.last < 1000)) {
      for (const r of recs) { r.until = t + MUTE_STEPS[Math.min(r.strikes, MUTE_STEPS.length - 1)] * 1000; r.strikes++; }
      return { mute: Math.ceil((recs[0].until - t) / 1000), flood: true };
    }
    if (recs.some((r) => r.lastText === text && t - r.lastTextAt < 30000)) return { error: 'Не повторяйся' };
    for (const r of recs) { r.last = t; r.lastText = text; r.lastTextAt = t; }
    return null;
  }

  // ---------- клан: состояние для клиента ----------
  async function clanView(key) {
    const [m, loan, w, last, games] = await Promise.all([
      store.clanMember(key), store.loanActive(key), store.wallet(key), store.clanLastEvent(), store.playerStats(key).then((s) => s.games),
    ]);
    const clans = {};
    for (const id of CLAN_IDS) clans[id] = await store.clanInfo(id);
    const my = m && m.clan ? m : null;
    const info = my ? clans[my.clan] : null;
    return {
      clans, me: m, loan, last, bank: w.bucks, bonus: w.bonus, games,
      head: !!(info && info.head && info.head.key === key),
      canSwitchAt: m && m.changed ? Date.parse(m.changed) + SWITCH_MS : 0,
      loanMax: my ? Math.max(0, Math.min(my.clan === 'fartovye' ? CLAN.loan.capFartovye : CLAN.loan.cap, Math.floor(info.treasury * CLAN.loan.share))) : 0,
      loanMult: my && my.clan === 'fartovye' ? CLAN.loan.multFartovye : CLAN.loan.mult,
      loanReadyAt: my ? Date.parse(my.joined) + LOAN_HOURS * 3600000 : 0,
    };
  }
  const pushTreasury = (clan) => store.clanInfo(clan).then((i) => i && io.to('clan:' + clan).emit('soc:treasury', { clan, treasury: i.treasury, members: i.members, head: i.head && i.head.key, boosts: i.boosts, minPct: i.minPct })).catch(() => {});

  // ---------- хуки для мини-игр ----------
  // Награда/выигрыш в бабках: автоотчисление в общак. credit — сколько зачислить, profit — чистый выигрыш.
  async function reward(key, credit, profit) {
    const r = await store.clanReward(key, credit, profit, { bonusRateOf, autoRepayPct: CLAN.loan.autoRepayPct });
    if (r.cut) {
      io.to('u:' + key).emit('soc:cut', { cut: r.cut, repaid: r.repaid });
      const m = await store.clanMember(key); if (m && m.clan) pushTreasury(m.clan);
    }
    return r.bank;
  }
  // Оборот для отыгрыша долга. В зачёт идут только игры против системы (слот, столы только с ботами).
  // Игры против живых людей — с коэффициентом 0.1, иначе двое друзей накрутят оборот, перекидывая бабки.
  async function onBet(key, amount, { pve }) {
    const w = Math.round(amount * (pve ? 1 : CLAN.loan.pvp) * 100) / 100;
    const r = await store.wagerAdd(key, w, 10);
    if (r) io.to('u:' + key).emit('soc:wager', r);
    return r;
  }
  // Подъёмные: Бойцы — до 2 000, буст «Подогрев» — до 3 000
  async function refillTo(key) {
    const m = await store.clanMember(key);
    if (!m || !m.clan) return G.DURAK.refillTo;
    if (await store.clanBoostOn(m.clan, 'podogrev')) return CLAN.refill.boost;
    return m.clan === 'boytsy' ? CLAN.refill.boytsy : G.DURAK.refillTo;
  }
  async function noFee(key) { const m = await store.clanMember(key); return !!(m && m.clan && await store.clanBoostOn(m.clan, 'bezkomissii')); }

  // ---------- ночное колесо района ----------
  let running = false;
  async function runWheel(day = mskDay(), forceClan) {
    if (running) return null;
    running = true;
    try {
      if (await store.clanEventDay(day)) return null;
      const clan = forceClan && CLANS[forceClan] ? forceClan : CLAN_IDS[crypto.randomInt(CLAN_IDS.length)];
      const r = await store.clanEvent(day, clan, { ...CLAN.wheel, doubleBoost: 'stavka' });
      if (!r) return null;
      console.log(`  Колесо района ${day}: ${CLANS[clan].name}, ${r.members} чел. по ${r.each}`);
      io.emit('soc:wheel', { day, clan, members: r.members, each: r.each, double: r.double });
      for (const k of r.keys) io.to('u:' + k).emit('soc:paid', { amount: r.each, clan });
      pushTreasury(clan);
      return r;
    } finally { running = false; }
  }
  // Бесплатный Render засыпает: если в полночь сервер спал, колесо прокрутится при первом пробуждении.
  if (cron && !FAST) cron.schedule('0 0 * * *', () => runWheel().catch((e) => console.error('[wheel]', e)), { timezone: TZ });
  const catchUp = () => { if (!FAST) runWheel().catch((e) => console.error('[wheel]', e)); };
  setInterval(catchUp, 60000).unref();

  // ---------- где сейчас игрок (для приглашений) ----------
  function whereIs(key) {
    for (const r of monopolyRooms().values()) if (r.status === 'LOBBY' && r.players.some((p) => p.account && p.account.key === key)) return { kind: 'room', code: r.code, full: r.players.length >= G.C.MAX_PLAYERS };
    const dr = durakRooms();
    if (dr) for (const r of dr.values()) if (r.status !== 'PLAYING' && r.players.some((p) => p.account && p.account.key === key && !p.left)) return { kind: 'durak', code: r.code, full: r.players.length >= r.max };
    return null;
  }

  io.on('connection', (socket) => {
    let acc = null, name = '', char = 'boec';
    const ip = String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
    const on = (ev, fn) => socket.on(ev, (d, ack) => {
      const cb = typeof ack === 'function' ? ack : () => {};
      Promise.resolve().then(() => fn(d && typeof d === 'object' ? d : {}, cb)).catch((e) => { console.error('[social]', ev, e); cb({ error: 'Ошибка сервера, попробуй ещё раз' }); });
    });
    const need = (cb) => { if (!acc) { cb({ error: 'Сначала назовись в профиле' }); return false; } return true; };

    // Антиспам как middleware Socket.IO: пакет soc:chat не дойдёт до обработчика, если игрок в муте или флудит
    socket.use(([ev, d, ack], next) => {
      if (ev !== 'soc:chat') return next();
      const cb = typeof ack === 'function' ? ack : () => {};
      if (!acc) return cb({ error: 'Сначала назовись в профиле' });
      const text = String((d && d.text) || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!text) return cb({ error: 'Пустое сообщение' });
      const lim = rate(['k:' + acc.key, 'ip:' + ip], text);
      if (lim && lim.mute) { socket.emit('soc:muted', { seconds: lim.mute }); return cb({ error: `${lim.flood ? 'Не флуди. ' : ''}Мут: ещё ${lim.mute} с`, mute: lim.mute }); }
      if (lim) return cb(lim);
      d.text = text;
      next();
    });

    on('soc:hello', async (d, cb) => {
      const a = account(d);
      const nm = cleanName(a && a.tg && !d.name ? a.name : d.name);
      if (!a || !nm) return cb({ error: 'Нужен профиль' });
      const first = !acc || acc.key !== a.key;
      if (acc && first) socket.leave('u:' + acc.key);
      acc = a; name = nm; char = CHARS[d.char] && !CHARS[d.char].secret ? d.char : 'boec';
      await store.socUser({ key: a.key, name, char, photo: a.photo, tg: a.tg });
      socket.join('u:' + a.key);
      const m = await store.clanMember(a.key);
      if (m && m.clan) { socket.join('clan:' + m.clan); store.clanTouch(a.key).catch(() => {}); }
      if (first) {
        clearTimeout(offTimers.get(a.key)); offTimers.delete(a.key);
        const set = online.get(a.key) || new Set();
        const wasOff = !set.size;
        set.add(socket.id); online.set(a.key, set);
        if (wasOff) notifyFriends(a.key, true);
      }
      const fl = await store.friendList(a.key);
      catchUp();
      cb({ key: a.key, requests: fl.filter((f) => f.rel === 'in').length, onlineFriends: fl.filter((f) => f.rel === 'friend' && isOnline(f.key)).length, clan: m && m.clan, last: await store.clanLastEvent() });
    });

    // ---------- чат ----------
    on('soc:chat:open', async (d, cb) => { socket.join('global_chat'); cb({ history: await store.chatHistory(50), online: online.size }); });
    on('soc:chat:close', (d, cb) => { socket.leave('global_chat'); cb({ ok: true }); });
    on('soc:chat', async (d, cb) => {
      const c = cleanText(d.text);
      let text = c.text;
      if (LINK.test(text)) text = text.replace(new RegExp(LINK.source, 'gi'), '[ссылка скрыта]');
      const m = await store.chatAdd({ key: acc.key, name, char, text });
      const out = { ...m, photo: acc.photo || null, tg: !!acc.tg };
      io.to('global_chat').emit('soc:chat', out);
      cb({ ok: true, filtered: c.bad });
    });

    // ---------- друзья ----------
    on('soc:friends', async (d, cb) => {
      if (!need(cb)) return;
      const list = await store.friendList(acc.key);
      const here = whereIs(acc.key);
      cb({ list: list.map((f) => ({ ...f, online: isOnline(f.key) })), here });
    });
    on('soc:search', async (d, cb) => {
      if (!need(cb)) return;
      const q = String(d.q || '').replace(/[\u0000-\u001f%_\\]/g, '').trim().slice(0, 12);
      if (q.length < 2) return cb({ list: [] });
      const rel = Object.fromEntries((await store.friendList(acc.key)).map((f) => [f.key, f.rel]));
      cb({ list: (await store.socFind(q, acc.key, 20)).map((u) => ({ ...u, rel: rel[u.key] || null, online: isOnline(u.key) })) });
    });
    on('soc:friend:add', async (d, cb) => {
      if (!need(cb)) return;
      const to = String(d.key || '').slice(0, 64);
      const target = (await store.socUsers([to]))[to];
      if (!target) return cb({ error: 'Игрок не найден' });
      const r = await store.friendRequest(acc.key, to);
      if (r.error) return cb(r);
      if (r.status === 'sent') io.to('u:' + to).emit('soc:request', { key: acc.key, name, char, photo: acc.photo || null });
      if (r.status === 'accepted') {
        io.to('u:' + to).emit('soc:friend', { key: acc.key, name, online: true });
        socket.emit('soc:presence', { key: to, online: isOnline(to) });
      }
      cb(r);
    });
    on('soc:friend:answer', async (d, cb) => {
      if (!need(cb)) return;
      const from = String(d.key || '').slice(0, 64);
      const ok = await store.friendRespond(acc.key, from, !!d.accept);
      if (ok && d.accept) io.to('u:' + from).emit('soc:friend', { key: acc.key, name, online: true });
      cb({ ok, online: isOnline(from) });
    });
    on('soc:friend:remove', async (d, cb) => {
      if (!need(cb)) return;
      await store.friendRemove(acc.key, String(d.key || '').slice(0, 64));
      cb({ ok: true });
    });
    // Позвать кореша туда, где ты сейчас сидишь (лобби «Монополии» или стол «Дурака»)
    on('soc:invite', async (d, cb) => {
      if (!need(cb)) return;
      const to = String(d.key || '').slice(0, 64);
      if (!(await store.areFriends(acc.key, to))) return cb({ error: 'Звать можно только корешей' });
      if (!isOnline(to)) return cb({ error: 'Кореш не в сети' });
      const here = whereIs(acc.key);
      if (!here) return cb({ error: 'Сначала создай сходку или сядь за стол' });
      if (here.full) return cb({ error: 'Мест больше нет' });
      io.to('u:' + to).emit('soc:invite', { from: { key: acc.key, name, char, photo: acc.photo || null }, kind: here.kind, code: here.code });
      cb({ ok: true });
    });

    // ---------- кланы ----------
    const reply = async (cb, extra) => cb({ ...(await clanView(acc.key)), ...(extra || {}) });
    on('soc:clan', async (d, cb) => { if (!need(cb)) return; await reply(cb); });
    on('soc:clan:join', async (d, cb) => {
      if (!need(cb)) return;
      const clan = String(d.clan || '');
      if (!CLANS[clan]) return cb({ error: 'Нет такого клана' });
      const old = await store.clanMember(acc.key);
      const r = await store.clanJoin(acc.key, clan, { switchMs: SWITCH_MS, defPct: CLAN.defPct });
      if (r.error) return cb(r);
      if (old && old.clan) { socket.leave('clan:' + old.clan); io.in('u:' + acc.key).socketsLeave('clan:' + old.clan); pushTreasury(old.clan); }
      io.in('u:' + acc.key).socketsJoin('clan:' + clan);
      pushTreasury(clan);
      await reply(cb, { joined: clan });
    });
    on('soc:clan:leave', async (d, cb) => {
      if (!need(cb)) return;
      const m = await store.clanMember(acc.key);
      const r = await store.clanLeave(acc.key);
      if (r.error) return cb(r);
      io.in('u:' + acc.key).socketsLeave('clan:' + m.clan);
      pushTreasury(m.clan);
      await reply(cb);
    });
    on('soc:clan:pct', async (d, cb) => {
      if (!need(cb)) return;
      const pct = Math.round(Number(d.pct));
      if (!(pct >= 0 && pct <= CLAN.maxPct)) return cb({ error: `От 0 до ${CLAN.maxPct}%` });
      if (!(await store.clanSetPct(acc.key, pct))) return cb({ error: 'Сначала вступи в клан' });
      await reply(cb);
    });
    on('soc:clan:min', async (d, cb) => {
      if (!need(cb)) return;
      const m = await store.clanMember(acc.key);
      if (!m || !m.clan || (await store.clanHead(m.clan)) !== acc.key) return cb({ error: 'Это решает старший клана' });
      const pct = Math.round(Number(d.pct));
      if (!(pct >= 0 && pct <= CLAN.maxPct)) return cb({ error: `От 0 до ${CLAN.maxPct}%` });
      await store.clanSetMin(m.clan, pct);
      pushTreasury(m.clan);
      await reply(cb);
    });
    on('soc:clan:give', async (d, cb) => {
      if (!need(cb)) return;
      const amount = Math.floor(Number(d.amount));
      if (!(amount >= CLAN.minGive && amount <= 10000000)) return cb({ error: `Взнос от ${CLAN.minGive} бабок` });
      const r = await store.clanGive(acc.key, amount, bonusRateOf);
      if (r.error) return cb(r);
      pushTreasury(r.member.clan);
      await reply(cb, { given: r });
    });
    on('soc:clan:boost', async (d, cb) => {
      if (!need(cb)) return;
      const b = CLAN.boosts[d.id];
      if (!b) return cb({ error: 'Нет такого буста' });
      const m = await store.clanMember(acc.key);
      if (!m || !m.clan || (await store.clanHead(m.clan)) !== acc.key) return cb({ error: 'Бусты покупает старший клана' });
      const r = await store.clanBoost(m.clan, d.id, b.price, CLAN.boostHours);
      if (r.error) return cb(r);
      io.to('clan:' + m.clan).emit('soc:boost', { id: d.id, name: b.name, by: name, until: r.until });
      pushTreasury(m.clan);
      await reply(cb);
    });
    on('soc:loan:take', async (d, cb) => {
      if (!need(cb)) return;
      if (!acc.tg && !FAST) return cb({ error: 'Брать в долг можно только с входом через Telegram' });
      const m = await store.clanMember(acc.key);
      if (!m || !m.clan) return cb({ error: 'Сначала вступи в клан' });
      if (Date.now() - Date.parse(m.joined) < LOAN_HOURS * 3600000) return cb({ error: `Долг дают через ${CLAN.loan.minHours} ч после вступления` });
      if ((await store.playerStats(acc.key)).games < CLAN.loan.minGames) return cb({ error: `Сначала сыграй ${CLAN.loan.minGames} партии в «Монополию»` });
      const far = m.clan === 'fartovye';
      const r = await store.loanTake(acc.key, Math.floor(Number(d.amount)), {
        mult: far ? CLAN.loan.multFartovye : CLAN.loan.mult, cap: far ? CLAN.loan.capFartovye : CLAN.loan.cap, share: CLAN.loan.share, min: CLAN.loan.min,
      });
      if (r.error) return cb(r);
      pushTreasury(m.clan);
      await reply(cb, { took: r.loan });
    });
    on('soc:loan:repay', async (d, cb) => {
      if (!need(cb)) return;
      const amount = Math.floor(Number(d.amount));
      if (!(amount > 0)) return cb({ error: 'Сколько вернуть?' });
      const r = await store.loanRepay(acc.key, amount);
      if (r.error) return cb(r);
      pushTreasury(r.member.clan);
      await reply(cb, { repaid: r.repaid });
    });

    socket.on('disconnect', () => {
      if (!acc) return;
      const key = acc.key, set = online.get(key);
      if (!set) return;
      set.delete(socket.id);
      if (set.size) return;
      online.delete(key);
      offTimers.set(key, setTimeout(() => { offTimers.delete(key); if (!online.has(key)) notifyFriends(key, false); }, FAST ? 50 : 5000));
    });
  });

  return { reward, onBet, refillTo, noFee, runWheel, isOnline, cleanText, mskDay, fmt };
}

module.exports = { attach, cleanText, mskDay };
