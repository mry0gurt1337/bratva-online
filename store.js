'use strict';
// Хранилище: статистика для топа, кошельки (монеты, покупки), платежи Telegram Stars.
// Если задан DATABASE_URL — Postgres (например, Neon), иначе — JSON-файл рядом с сервером
// (на бесплатном хостинге файл стирается при перезапуске, поэтому для продакшена нужна база).
const fs = require('fs');
const path = require('path');

const FILE = process.env.STATS_FILE || path.join(__dirname, 'data', 'stats.json');
let pool = null;
let mem = { players: {}, wallets: {}, payments: {} };
let saveTimer = null;

async function init() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      const url = process.env.DATABASE_URL;
      const local = /@(localhost|127\.0\.0\.1)[:/]|sslmode=disable/.test(url);
      pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 4 });
      await pool.query(`CREATE TABLE IF NOT EXISTS players (
        key text PRIMARY KEY, tg boolean NOT NULL DEFAULT false, name text NOT NULL, username text, photo text, char text,
        games int NOT NULL DEFAULT 0, wins int NOT NULL DEFAULT 0, top3 int NOT NULL DEFAULT 0,
        best bigint NOT NULL DEFAULT 0, total bigint NOT NULL DEFAULT 0,
        strelka_won int NOT NULL DEFAULT 0, strelka_total int NOT NULL DEFAULT 0, bankrupts int NOT NULL DEFAULT 0,
        glok int NOT NULL DEFAULT 0, titles int NOT NULL DEFAULT 0, updated timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS respect int NOT NULL DEFAULT 0`);
      await pool.query(`CREATE TABLE IF NOT EXISTS wallets (
        key text PRIMARY KEY, coins int NOT NULL DEFAULT 0 CHECK (coins >= 0),
        items jsonb NOT NULL DEFAULT '[]', equip jsonb NOT NULL DEFAULT '{}',
        daily_on date, streak int NOT NULL DEFAULT 0, earned_on date, earned_today int NOT NULL DEFAULT 0,
        spent int NOT NULL DEFAULT 0, bought int NOT NULL DEFAULT 0, updated timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS spin_on date`);
      await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS bucks int NOT NULL DEFAULT 5000 CHECK (bucks >= 0)`);
      await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS bucks_on date`);
      await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS bonus_spins int NOT NULL DEFAULT 0`);
      // «бонусные» бабки из долга общака — заперты, пока не выполнен отыгрыш
      await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS bonus int NOT NULL DEFAULT 0 CHECK (bonus >= 0)`);
      await pool.query(SOCIAL_SQL);
      await pool.query(`CREATE TABLE IF NOT EXISTS payments (
        charge_id text PRIMARY KEY, key text NOT NULL, pack text NOT NULL, stars int NOT NULL, coins int NOT NULL,
        tg_user bigint, created timestamptz NOT NULL DEFAULT now(), refunded boolean NOT NULL DEFAULT false)`);
      console.log('  База: Postgres подключена');
      return;
    } catch (e) {
      console.error('  База: не удалось подключиться к Postgres, пишу в файл.', e.message);
      pool = null;
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mem = raw.players ? raw : { players: raw, wallets: {}, payments: {} }; // старый формат — только игроки
    mem.wallets = mem.wallets || {}; mem.payments = mem.payments || {};
    mem.soc = mem.soc || null;
  } catch { mem = { players: {}, wallets: {}, payments: {} }; }
  console.log('  База: файл ' + FILE);
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(mem)); } catch (e) { console.error('stats save', e.message); }
  }, 400);
}
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Статистика ----------
async function record(rows) {
  for (const x of rows) {
    if (pool) {
      await pool.query(`INSERT INTO players (key, tg, name, username, photo, char, games, wins, top3, best, total, strelka_won, strelka_total, bankrupts, glok, titles, updated)
        VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$9,$10,$11,$12,$13,$14,now())
        ON CONFLICT (key) DO UPDATE SET tg=EXCLUDED.tg, name=EXCLUDED.name, username=COALESCE(EXCLUDED.username, players.username),
          photo=COALESCE(EXCLUDED.photo, players.photo), char=EXCLUDED.char, games=players.games+1, wins=players.wins+EXCLUDED.wins,
          top3=players.top3+EXCLUDED.top3, best=GREATEST(players.best, EXCLUDED.best), total=players.total+EXCLUDED.total,
          strelka_won=players.strelka_won+EXCLUDED.strelka_won, strelka_total=players.strelka_total+EXCLUDED.strelka_total,
          bankrupts=players.bankrupts+EXCLUDED.bankrupts, glok=players.glok+EXCLUDED.glok, titles=players.titles+EXCLUDED.titles, updated=now()`,
        [x.key, !!x.tg, x.name, x.username || null, x.photo || null, x.char, x.win ? 1 : 0, x.top3 ? 1 : 0, x.worth, x.strelkaWon, x.strelkaTotal, x.bankrupt ? 1 : 0, x.glok, x.titles]);
    } else {
      const o = mem.players[x.key] || (mem.players[x.key] = { key: x.key, games: 0, wins: 0, top3: 0, best: 0, total: 0, strelka_won: 0, strelka_total: 0, bankrupts: 0, glok: 0, titles: 0, respect: 0 });
      Object.assign(o, { tg: !!x.tg, name: x.name, username: x.username || o.username || null, photo: x.photo || o.photo || null, char: x.char, updated: new Date().toISOString() });
      o.games += 1; o.wins += x.win ? 1 : 0; o.top3 += x.top3 ? 1 : 0; o.best = Math.max(o.best, x.worth); o.total += x.worth;
      o.strelka_won += x.strelkaWon; o.strelka_total += x.strelkaTotal; o.bankrupts += x.bankrupt ? 1 : 0; o.glok += x.glok; o.titles += x.titles;
    }
  }
  if (!pool) saveSoon();
}

async function addRespect(key, n, name) {
  if (pool) {
    await pool.query(`INSERT INTO players (key, name, respect) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET respect = players.respect + $3`, [key, name || 'Игрок', n]);
  } else {
    const o = mem.players[key] || (mem.players[key] = { key, name: name || 'Игрок', games: 0, wins: 0, top3: 0, best: 0, total: 0, strelka_won: 0, strelka_total: 0, bankrupts: 0, glok: 0, titles: 0, respect: 0 });
    o.respect = (o.respect || 0) + n;
    saveSoon();
  }
}

const SORTS = {
  wins: 'p.wins DESC, p.games ASC',
  rate: '(p.wins::float / GREATEST(p.games,1)) DESC, p.wins DESC',
  best: 'p.best DESC',
  strelka: 'p.strelka_won DESC, p.strelka_total ASC',
  respect: 'p.respect DESC, p.wins DESC',
  games: 'p.games DESC',
};
async function top(sort = 'wins', limit = 50) {
  if (!SORTS[sort]) sort = 'wins';
  let rows;
  if (pool) {
    const where = sort === 'rate' ? 'WHERE p.games >= 3' : sort === 'respect' ? 'WHERE p.respect > 0' : 'WHERE p.games > 0';
    rows = (await pool.query(`SELECT p.*, w.equip FROM players p LEFT JOIN wallets w ON w.key = p.key ${where} ORDER BY ${SORTS[sort]} LIMIT $1`, [limit])).rows;
  } else {
    const val = { wins: (o) => o.wins * 1e6 - o.games, rate: (o) => (o.games >= 3 ? o.wins / o.games : -1) * 1e6 + o.wins, best: (o) => o.best, strelka: (o) => o.strelka_won * 1e6 - o.strelka_total, respect: (o) => (o.respect || 0) * 1e6 + o.wins, games: (o) => o.games }[sort];
    rows = Object.values(mem.players).filter((o) => (sort === 'respect' ? o.respect > 0 : o.games > 0)).sort((a, b) => val(b) - val(a)).slice(0, limit)
      .map((o) => ({ ...o, equip: (mem.wallets[o.key] || {}).equip || {} }));
  }
  return rows.map((o) => ({
    key: o.key, tg: o.tg, name: o.name, username: o.username, photo: o.photo, char: o.char,
    games: +o.games, wins: +o.wins, top3: +o.top3, best: +o.best, avg: o.games ? Math.round(o.total / o.games) : 0,
    strelkaWon: +o.strelka_won, strelkaTotal: +o.strelka_total, bankrupts: +o.bankrupts, glok: +o.glok, titles: +o.titles,
    respect: +(o.respect || 0), equip: o.equip || {},
  }));
}
async function playerStats(key) {
  let o;
  if (pool) o = (await pool.query('SELECT games, wins, best, strelka_won, respect FROM players WHERE key=$1', [key])).rows[0];
  else o = mem.players[key];
  o = o || {};
  return { games: +(o.games || 0), wins: +(o.wins || 0), best: +(o.best || 0), strelka: +(o.strelka_won || 0), respect: +(o.respect || 0) };
}
async function count() {
  if (pool) return +(await pool.query('SELECT count(*) FROM players WHERE games > 0')).rows[0].count;
  return Object.values(mem.players).filter((o) => o.games > 0).length;
}

// ---------- Кошельки ----------
const blank = (key) => ({ key, coins: 0, items: [], equip: {}, daily_on: null, streak: 0, earned_on: null, earned_today: 0, spent: 0, bought: 0, spin_on: null, bonus_spins: 0, bucks: 5000, bucks_on: null, bonus: 0 });
function norm(w) {
  const d = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : x || null);
  return { coins: +w.coins, items: w.items || [], equip: w.equip || {}, daily_on: d(w.daily_on), streak: +w.streak, earned_on: d(w.earned_on), earned_today: +w.earned_today, spin_on: d(w.spin_on), bonus_spins: +(w.bonus_spins || 0), bucks: w.bucks == null ? 5000 : +w.bucks, bucks_on: d(w.bucks_on), bonus: +(w.bonus || 0) };
}
async function wallet(key) {
  if (pool) {
    const r = await pool.query('SELECT * FROM wallets WHERE key=$1', [key]);
    return norm(r.rows[0] || blank(key));
  }
  return norm(mem.wallets[key] || blank(key));
}
function memW(key) { return mem.wallets[key] || (mem.wallets[key] = blank(key)); }

// Начислить монеты; source='game' учитывает дневной лимит. Возвращает, сколько реально начислено.
async function credit(key, amount, source, cap) {
  amount = Math.max(0, Math.floor(amount));
  if (!amount) return 0;
  if (pool) {
    if (source === 'game') {
      const w = await wallet(key);
      const done = w.earned_on === today() ? w.earned_today : 0;
      amount = Math.max(0, Math.min(amount, cap - done));
      if (!amount) return 0;
      await pool.query(`INSERT INTO wallets (key, coins, earned_on, earned_today) VALUES ($1,$2,CURRENT_DATE,$2)
        ON CONFLICT (key) DO UPDATE SET coins = wallets.coins + $2, earned_today = $3 + $2, earned_on = CURRENT_DATE, updated = now()`, [key, amount, done]);
      return amount;
    }
    await pool.query(`INSERT INTO wallets (key, coins) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET coins = wallets.coins + $2, updated = now()`, [key, amount]);
    return amount;
  }
  const w = memW(key);
  if (source === 'game') {
    if (w.earned_on !== today()) { w.earned_on = today(); w.earned_today = 0; }
    amount = Math.max(0, Math.min(amount, cap - w.earned_today));
    w.earned_today += amount;
  }
  w.coins += amount;
  saveSoon();
  return amount;
}

// Списать монеты (атомарно). Если item — добавить в инвентарь. Возвращает новый кошелёк или null, если не хватило.
async function spend(key, amount, item) {
  if (pool) {
    const r = await pool.query(`UPDATE wallets SET coins = coins - $2, spent = spent + $2,
        items = CASE WHEN $3::text IS NULL OR items ? $3::text THEN items ELSE items || to_jsonb($3::text) END, updated = now()
      WHERE key = $1 AND coins >= $2 AND ($3::text IS NULL OR NOT items ? $3::text) RETURNING *`, [key, amount, item || null]);
    return r.rows[0] ? norm(r.rows[0]) : null;
  }
  const w = memW(key);
  if (w.coins < amount || (item && w.items.includes(item))) return null;
  w.coins -= amount; w.spent += amount;
  if (item) w.items.push(item);
  saveSoon();
  return norm(w);
}

async function setEquip(key, slot, item) {
  if (pool) {
    await pool.query(`INSERT INTO wallets (key, equip) VALUES ($1, jsonb_build_object($2::text, $3::text))
      ON CONFLICT (key) DO UPDATE SET equip = CASE WHEN $3::text IS NULL THEN wallets.equip - $2::text ELSE wallets.equip || jsonb_build_object($2::text, $3::text) END, updated = now()`, [key, slot, item]);
  } else {
    const w = memW(key);
    if (item) w.equip[slot] = item; else delete w.equip[slot];
    saveSoon();
  }
  return wallet(key);
}

// Ежедневный бонус: +daily, серия до 7 дней даёт до +30 сверху
async function claimDaily(key, ladder) {
  const w = await wallet(key);
  const t = today();
  if (w.daily_on === t) return { ok: false, wallet: w };
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streak = w.daily_on === y ? (w.streak % 7) + 1 : 1; // неделя по кругу: после 7-го дня снова 1-й
  const amount = ladder[streak - 1];
  const spin = streak === 7 ? 1 : 0; // 7-й день серии — бонусный прокрут колеса
  if (pool) {
    const r = await pool.query(`INSERT INTO wallets (key, coins, daily_on, streak, bonus_spins) VALUES ($1,$2,CURRENT_DATE,$3,$4)
      ON CONFLICT (key) DO UPDATE SET coins = wallets.coins + $2, daily_on = CURRENT_DATE, streak = $3, bonus_spins = wallets.bonus_spins + $4, updated = now()
      WHERE wallets.daily_on IS DISTINCT FROM CURRENT_DATE RETURNING *`, [key, amount, streak, spin]);
    if (!r.rows[0]) return { ok: false, wallet: await wallet(key) };
    return { ok: true, amount, streak, spin, wallet: norm(r.rows[0]) };
  }
  const m = memW(key);
  m.coins += amount; m.daily_on = t; m.streak = streak; m.bonus_spins = (m.bonus_spins || 0) + spin;
  saveSoon();
  return { ok: true, amount, streak, spin, wallet: norm(m) };
}

// Колесо фортуны: один бесплатный прокрут в день + бонусные. Возвращает true, если прокрут списан.
async function useSpin(key) {
  if (pool) {
    await pool.query(`INSERT INTO wallets (key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
    const r = await pool.query(`UPDATE wallets SET spin_on = CASE WHEN spin_on IS DISTINCT FROM CURRENT_DATE THEN CURRENT_DATE ELSE spin_on END,
        bonus_spins = CASE WHEN spin_on IS DISTINCT FROM CURRENT_DATE THEN bonus_spins ELSE bonus_spins - 1 END, updated = now()
      WHERE key = $1 AND (spin_on IS DISTINCT FROM CURRENT_DATE OR bonus_spins > 0) RETURNING key`, [key]);
    return !!r.rows[0];
  }
  const w = memW(key);
  if (w.spin_on !== today()) w.spin_on = today();
  else if ((w.bonus_spins || 0) > 0) w.bonus_spins -= 1;
  else return false;
  saveSoon();
  return true;
}
// «Бабки» — бесплатная валюта столов «Дурака». Не покупается. delta < 0 — списание (null, если не хватает).
async function bucksAdd(key, delta) {
  delta = Math.round(delta);
  if (pool) {
    await pool.query(`INSERT INTO wallets (key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
    const r = await pool.query(`UPDATE wallets SET bucks = bucks + $2, updated = now() WHERE key = $1 AND bucks + $2 >= 0 RETURNING bucks`, [key, delta]);
    return r.rows[0] ? +r.rows[0].bucks : null;
  }
  const w = memW(key);
  if (w.bucks == null) w.bucks = 5000;
  if (w.bucks + delta < 0) return null;
  w.bucks += delta; saveSoon();
  return w.bucks;
}
// Подъёмные: раз в день, если бабок меньше min — докидываем до to
async function bucksRefill(key, min, to) {
  if (pool) {
    await pool.query(`INSERT INTO wallets (key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
    const r = await pool.query(`UPDATE wallets SET bucks = $3, bucks_on = CURRENT_DATE, updated = now()
      WHERE key = $1 AND bucks < $2 AND bucks_on IS DISTINCT FROM CURRENT_DATE RETURNING bucks`, [key, min, to]);
    return r.rows[0] ? +r.rows[0].bucks : null;
  }
  const w = memW(key);
  if (w.bucks == null) w.bucks = 5000;
  if (w.bucks >= min || w.bucks_on === today()) return null;
  w.bucks = to; w.bucks_on = today(); saveSoon();
  return w.bucks;
}

// Выдать предмет бесплатно (приз колеса). false — если уже есть.
async function grantItem(key, item) {
  if (pool) {
    const r = await pool.query(`INSERT INTO wallets (key, items) VALUES ($1, jsonb_build_array($2::text))
      ON CONFLICT (key) DO UPDATE SET items = wallets.items || to_jsonb($2::text), updated = now() WHERE NOT wallets.items ? $2::text RETURNING key`, [key, item]);
    return !!r.rows[0];
  }
  const w = memW(key);
  if (w.items.includes(item)) return false;
  w.items.push(item); saveSoon();
  return true;
}

// ---------- Платежи Stars (идемпотентно по charge_id) ----------
async function recordPayment(p) {
  if (pool) {
    const r = await pool.query(`INSERT INTO payments (charge_id, key, pack, stars, coins, tg_user) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING charge_id`,
      [p.chargeId, p.key, p.pack, p.stars, p.coins, p.tgUser || null]);
    if (!r.rows[0]) return false;
    await pool.query(`INSERT INTO wallets (key, coins, bought) VALUES ($1,$2,$2) ON CONFLICT (key) DO UPDATE SET coins = wallets.coins + $2, bought = wallets.bought + $2, updated = now()`, [p.key, p.coins]);
    return true;
  }
  if (mem.payments[p.chargeId]) return false;
  mem.payments[p.chargeId] = { ...p, created: new Date().toISOString() };
  const w = memW(p.key); w.coins += p.coins; w.bought += p.coins;
  saveSoon();
  return true;
}
async function findPayment(chargeId) {
  if (pool) return (await pool.query('SELECT * FROM payments WHERE charge_id=$1', [chargeId])).rows[0] || null;
  return mem.payments[chargeId] || null;
}

// =====================================================================
// Социальный слой: игроки для поиска, друзья, глобальный чат, кланы, общак, долги, ночное колесо.
// Деньги — только «бабки». В Postgres каждая денежная операция — одна транзакция с блокировкой строк
// в одном порядке: участник клана → клан → кошелёк. Так деньги не теряются при обрыве связи
// и нет взаимных блокировок.
// =====================================================================
const SOCIAL_SQL = `
CREATE TABLE IF NOT EXISTS social_users (
  key text PRIMARY KEY, name text NOT NULL, name_lc text NOT NULL, char text, photo text,
  tg boolean NOT NULL DEFAULT false, seen timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS social_users_seen ON social_users (seen DESC);
CREATE TABLE IF NOT EXISTS friendships (
  id bigserial PRIMARY KEY, user_id text NOT NULL, friend_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','accepted')),
  created timestamptz NOT NULL DEFAULT now(), CHECK (user_id <> friend_id));
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair ON friendships (LEAST(user_id, friend_id), GREATEST(user_id, friend_id));
CREATE INDEX IF NOT EXISTS friendships_user ON friendships (user_id);
CREATE INDEX IF NOT EXISTS friendships_friend ON friendships (friend_id);
CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY, key text NOT NULL, name text NOT NULL, char text, text text NOT NULL,
  created timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS clans (
  id text PRIMARY KEY, treasury bigint NOT NULL DEFAULT 0 CHECK (treasury >= 0),
  min_pct int NOT NULL DEFAULT 0 CHECK (min_pct BETWEEN 0 AND 20), boosts jsonb NOT NULL DEFAULT '{}',
  updated timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS clan_members (
  key text PRIMARY KEY, clan text REFERENCES clans(id), pct int NOT NULL DEFAULT 5 CHECK (pct BETWEEN 0 AND 20),
  contributed bigint NOT NULL DEFAULT 0, debt bigint NOT NULL DEFAULT 0 CHECK (debt >= 0),
  joined timestamptz, changed timestamptz, seen timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS clan_members_clan ON clan_members (clan, contributed DESC);
CREATE TABLE IF NOT EXISTS clan_ledger (
  id bigserial PRIMARY KEY, clan text NOT NULL, key text, kind text NOT NULL, amount bigint NOT NULL,
  created timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS loans (
  id bigserial PRIMARY KEY, key text NOT NULL, clan text NOT NULL, amount int NOT NULL CHECK (amount > 0),
  wager_target bigint NOT NULL, wager_current numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','burned')),
  created timestamptz NOT NULL DEFAULT now(), closed timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS loans_one_active ON loans (key) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS clan_events (
  day date PRIMARY KEY, clan text NOT NULL, members int NOT NULL DEFAULT 0, each_amount int NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0, created timestamptz NOT NULL DEFAULT now());
`;

class Soft extends Error {}            // понятная игроку ошибка: транзакция откатывается, игрок видит текст
const fail = (m) => { throw new Soft(m); };
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}
async function guard(fn) {
  try { return await fn(); } catch (e) { if (e instanceof Soft) return { error: e.message }; throw e; }
}
function S() {
  if (!mem.soc) mem.soc = { users: {}, friends: [], chat: [], clans: {}, members: {}, ledger: [], loans: [], events: {}, seq: 0 };
  return mem.soc;
}
const iso = (x) => (x instanceof Date ? x.toISOString() : x || null);
const nowIso = () => new Date().toISOString();
const sid = () => ++S().seq;
function ledgerMem(clan, key, kind, amount) {
  const l = S().ledger; l.push({ clan, key, kind, amount, created: nowIso() });
  if (l.length > 3000) l.splice(0, l.length - 3000);
}
// кошелёк внутри транзакции (создаём, если нет) — заблокирован до конца транзакции
async function lockWallet(c, key) {
  await c.query('INSERT INTO wallets (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  return (await c.query('SELECT * FROM wallets WHERE key=$1 FOR UPDATE', [key])).rows[0];
}

async function socInit(clanIds) {
  if (pool) { for (const id of clanIds) await pool.query('INSERT INTO clans (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]); return; }
  const s = S();
  for (const id of clanIds) s.clans[id] = s.clans[id] || { id, treasury: 0, min_pct: 0, boosts: {} };
  saveSoon();
}

// ---------- игроки (для поиска друзей) ----------
const pubU = (o) => o && { key: o.key, name: o.name, char: o.char || null, photo: o.photo || null, tg: !!o.tg, seen: iso(o.seen) };
async function socUser(u) {
  const lc = u.name.toLowerCase();
  if (pool) {
    await pool.query(`INSERT INTO social_users (key, name, name_lc, char, photo, tg, seen) VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, name_lc=EXCLUDED.name_lc, char=EXCLUDED.char,
        photo=COALESCE(EXCLUDED.photo, social_users.photo), tg=EXCLUDED.tg, seen=now()`, [u.key, u.name, lc, u.char || null, u.photo || null, !!u.tg]);
    return;
  }
  const s = S(), old = s.users[u.key] || {};
  s.users[u.key] = { key: u.key, name: u.name, name_lc: lc, char: u.char || null, photo: u.photo || old.photo || null, tg: !!u.tg, seen: nowIso() };
  saveSoon();
}
async function socFind(q, except, limit = 20) {
  q = String(q).toLowerCase();
  if (pool) {
    const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const r = await pool.query(`SELECT * FROM social_users WHERE name_lc LIKE $1 AND key <> $2
      ORDER BY (name_lc = $3) DESC, (name_lc LIKE $4) DESC, seen DESC LIMIT $5`, [like, except, q, q.replace(/[\\%_]/g, (m) => '\\' + m) + '%', limit]);
    return r.rows.map(pubU);
  }
  return Object.values(S().users).filter((u) => u.key !== except && u.name_lc.includes(q))
    .sort((a, b) => (b.name_lc === q) - (a.name_lc === q) || b.name_lc.startsWith(q) - a.name_lc.startsWith(q) || (b.seen > a.seen ? 1 : -1))
    .slice(0, limit).map(pubU);
}
async function socUsers(keys) {
  if (!keys.length) return {};
  if (pool) {
    const r = await pool.query('SELECT * FROM social_users WHERE key = ANY($1)', [keys]);
    return Object.fromEntries(r.rows.map((o) => [o.key, pubU(o)]));
  }
  return Object.fromEntries(keys.filter((k) => S().users[k]).map((k) => [k, pubU(S().users[k])]));
}

// ---------- друзья ----------
const FRIENDS_MAX = 200, PENDING_MAX = 30;
// Заявка. Если второй уже звал тебя — сразу дружба. Возвращает { status: 'sent' | 'accepted' | 'friends' } или { error }
async function friendRequest(from, to) {
  if (from === to) return { error: 'Это ты сам' };
  if (pool) return guard(() => tx(async (c) => {
    const ex = (await c.query(`SELECT * FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1) FOR UPDATE`, [from, to])).rows[0];
    if (ex) {
      if (ex.status === 'accepted') return { status: 'friends' };
      if (ex.user_id === from) return { status: 'sent' };
      await c.query(`UPDATE friendships SET status='accepted' WHERE id=$1`, [ex.id]);
      return { status: 'accepted' };
    }
    const n = (await c.query(`SELECT count(*) FILTER (WHERE status='accepted') a, count(*) FILTER (WHERE status='pending' AND user_id=$1) p
      FROM friendships WHERE user_id=$1 OR friend_id=$1`, [from])).rows[0];
    if (+n.a >= FRIENDS_MAX) fail(`Больше ${FRIENDS_MAX} корешей не бывает`);
    if (+n.p >= PENDING_MAX) fail('Слишком много заявок без ответа. Подожди, пока ответят');
    const ins = await c.query(`INSERT INTO friendships (user_id, friend_id, status) VALUES ($1,$2,'pending') ON CONFLICT DO NOTHING RETURNING id`, [from, to]);
    return { status: ins.rows[0] ? 'sent' : 'friends' };
  }));
  const s = S();
  const ex = s.friends.find((f) => (f.user_id === from && f.friend_id === to) || (f.user_id === to && f.friend_id === from));
  if (ex) {
    if (ex.status === 'accepted') return { status: 'friends' };
    if (ex.user_id === from) return { status: 'sent' };
    ex.status = 'accepted'; saveSoon(); return { status: 'accepted' };
  }
  const mine = s.friends.filter((f) => f.user_id === from || f.friend_id === from);
  if (mine.filter((f) => f.status === 'accepted').length >= FRIENDS_MAX) return { error: `Больше ${FRIENDS_MAX} корешей не бывает` };
  if (mine.filter((f) => f.status === 'pending' && f.user_id === from).length >= PENDING_MAX) return { error: 'Слишком много заявок без ответа. Подожди, пока ответят' };
  s.friends.push({ id: sid(), user_id: from, friend_id: to, status: 'pending', created: nowIso() });
  saveSoon();
  return { status: 'sent' };
}
// Ответ на заявку: accept=true — дружба, false — заявка удаляется
async function friendRespond(me, from, accept) {
  if (pool) {
    const r = accept
      ? await pool.query(`UPDATE friendships SET status='accepted' WHERE user_id=$1 AND friend_id=$2 AND status='pending' RETURNING id`, [from, me])
      : await pool.query(`DELETE FROM friendships WHERE user_id=$1 AND friend_id=$2 AND status='pending' RETURNING id`, [from, me]);
    return !!r.rows[0];
  }
  const s = S(), i = s.friends.findIndex((f) => f.user_id === from && f.friend_id === me && f.status === 'pending');
  if (i < 0) return false;
  if (accept) s.friends[i].status = 'accepted'; else s.friends.splice(i, 1);
  saveSoon();
  return true;
}
async function friendRemove(me, other) {
  if (pool) { await pool.query(`DELETE FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)`, [me, other]); return; }
  const s = S(); s.friends = s.friends.filter((f) => !((f.user_id === me && f.friend_id === other) || (f.user_id === other && f.friend_id === me)));
  saveSoon();
}
// Все связи игрока: rel = 'friend' | 'in' (зовут тебя) | 'out' (зовёшь ты)
async function friendList(key) {
  let rows;
  if (pool) rows = (await pool.query(`SELECT user_id, friend_id, status FROM friendships WHERE user_id=$1 OR friend_id=$1`, [key])).rows;
  else rows = S().friends.filter((f) => f.user_id === key || f.friend_id === key);
  const other = (f) => (f.user_id === key ? f.friend_id : f.user_id);
  const users = await socUsers(rows.map(other));
  return rows.map((f) => {
    const k = other(f), u = users[k] || { key: k, name: 'Игрок', char: null };
    return { ...u, rel: f.status === 'accepted' ? 'friend' : f.user_id === key ? 'out' : 'in' };
  });
}
async function friendKeys(key) { return (await friendList(key)).filter((f) => f.rel === 'friend').map((f) => f.key); }
async function areFriends(a, b) {
  if (pool) return !!(await pool.query(`SELECT 1 FROM friendships WHERE status='accepted' AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1))`, [a, b])).rows[0];
  return S().friends.some((f) => f.status === 'accepted' && ((f.user_id === a && f.friend_id === b) || (f.user_id === b && f.friend_id === a)));
}

// ---------- глобальный чат ----------
const CHAT_KEEP = 2000;
async function chatAdd(m) {
  if (pool) {
    const r = (await pool.query(`INSERT INTO chat_messages (key, name, char, text) VALUES ($1,$2,$3,$4) RETURNING id, created`, [m.key, m.name, m.char || null, m.text])).rows[0];
    if (+r.id % 100 === 0) pool.query('DELETE FROM chat_messages WHERE id < $1', [+r.id - CHAT_KEEP]).catch(() => {});
    return { id: +r.id, key: m.key, name: m.name, char: m.char || null, text: m.text, at: iso(r.created) };
  }
  const s = S(), msg = { id: sid(), key: m.key, name: m.name, char: m.char || null, text: m.text, at: nowIso() };
  s.chat.push(msg); if (s.chat.length > CHAT_KEEP) s.chat.splice(0, s.chat.length - CHAT_KEEP);
  saveSoon();
  return msg;
}
async function chatHistory(limit = 50) {
  if (pool) {
    const r = await pool.query('SELECT * FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT $1) t ORDER BY id', [limit]);
    return r.rows.map((m) => ({ id: +m.id, key: m.key, name: m.name, char: m.char, text: m.text, at: iso(m.created) }));
  }
  return S().chat.slice(-limit);
}

// ---------- кланы ----------
const memberOut = (m) => m && { key: m.key, clan: m.clan || null, pct: +m.pct, contributed: +m.contributed, debt: +m.debt, joined: iso(m.joined), changed: iso(m.changed), seen: iso(m.seen) };
const liveBoosts = (b) => Object.fromEntries(Object.entries(b || {}).filter(([, t]) => Date.parse(t) > Date.now()));
async function clanMember(key) {
  if (pool) return memberOut((await pool.query('SELECT * FROM clan_members WHERE key=$1', [key])).rows[0]);
  const m = S().members[key];
  return m ? memberOut(m) : null;
}
// Сводка клана: казна, буст, кол-во, старший (главный вкладчик), топ-10 вкладчиков
async function clanInfo(id) {
  let c, n, top;
  if (pool) {
    c = (await pool.query('SELECT * FROM clans WHERE id=$1', [id])).rows[0];
    if (!c) return null;
    n = +(await pool.query('SELECT count(*) FROM clan_members WHERE clan=$1', [id])).rows[0].count;
    top = (await pool.query(`SELECT m.key, m.contributed, u.name, u.char, u.photo FROM clan_members m LEFT JOIN social_users u ON u.key = m.key
      WHERE m.clan=$1 ORDER BY m.contributed DESC, m.joined ASC LIMIT 10`, [id])).rows;
  } else {
    const s = S(); c = s.clans[id];
    if (!c) return null;
    const ms = Object.values(s.members).filter((m) => m.clan === id);
    n = ms.length;
    top = ms.sort((a, b) => b.contributed - a.contributed || (a.joined < b.joined ? -1 : 1)).slice(0, 10)
      .map((m) => ({ key: m.key, contributed: m.contributed, ...(s.users[m.key] ? { name: s.users[m.key].name, char: s.users[m.key].char, photo: s.users[m.key].photo } : {}) }));
  }
  top = top.map((t) => ({ key: t.key, name: t.name || 'Игрок', char: t.char || null, photo: t.photo || null, contributed: +t.contributed }));
  return { id, treasury: +c.treasury, minPct: +c.min_pct, boosts: liveBoosts(c.boosts), members: n, head: top[0] || null, top };
}
async function clanHead(id) { const i = await clanInfo(id); return i && i.head ? i.head.key : null; }
async function clanBoostOn(id, boost) {
  if (!id) return false;
  const b = pool ? ((await pool.query('SELECT boosts FROM clans WHERE id=$1', [id])).rows[0] || {}).boosts : (S().clans[id] || {}).boosts;
  return !!(b && b[boost] && Date.parse(b[boost]) > Date.now());
}
async function clanJoin(key, clan, { switchMs, defPct }) {
  const check = (m) => {
    if (m && m.clan === clan) fail('Ты уже в этом клане');
    if (m && +m.debt > 0) fail('Сначала верни долг общаку');
    if (m && m.changed && Date.now() - Date.parse(iso(m.changed)) < switchMs) fail(`Клан можно менять раз в ${Math.round(switchMs / 86400000)} дня`);
  };
  if (pool) return guard(() => tx(async (c) => {
    const m = (await c.query('SELECT * FROM clan_members WHERE key=$1 FOR UPDATE', [key])).rows[0];
    check(m);
    const r = await c.query(`INSERT INTO clan_members (key, clan, pct, contributed, debt, joined, changed, seen) VALUES ($1,$2,$3,0,0,now(),now(),now())
      ON CONFLICT (key) DO UPDATE SET clan=$2, pct=$3, contributed=0, joined=now(), changed=now(), seen=now() RETURNING *`, [key, clan, defPct]);
    await c.query(`INSERT INTO clan_ledger (clan, key, kind, amount) VALUES ($1,$2,'join',0)`, [clan, key]);
    return { member: memberOut(r.rows[0]) };
  }));
  return guard(async () => {
    const s = S(), m = s.members[key];
    check(m);
    s.members[key] = { key, clan, pct: defPct, contributed: 0, debt: 0, joined: nowIso(), changed: nowIso(), seen: nowIso() };
    ledgerMem(clan, key, 'join', 0); saveSoon();
    return { member: memberOut(s.members[key]) };
  });
}
async function clanLeave(key) {
  if (pool) return guard(() => tx(async (c) => {
    const m = (await c.query('SELECT * FROM clan_members WHERE key=$1 FOR UPDATE', [key])).rows[0];
    if (!m || !m.clan) fail('Ты не в клане');
    if (+m.debt > 0) fail('Сначала верни долг общаку');
    await c.query(`UPDATE clan_members SET clan=NULL, contributed=0, changed=now() WHERE key=$1`, [key]);
    await c.query(`INSERT INTO clan_ledger (clan, key, kind, amount) VALUES ($1,$2,'leave',0)`, [m.clan, key]);
    return { ok: true };
  }));
  return guard(async () => {
    const m = S().members[key];
    if (!m || !m.clan) fail('Ты не в клане');
    if (m.debt > 0) fail('Сначала верни долг общаку');
    ledgerMem(m.clan, key, 'leave', 0);
    m.clan = null; m.contributed = 0; m.changed = nowIso(); saveSoon();
    return { ok: true };
  });
}
async function clanSetPct(key, pct) {
  if (pool) return !!(await pool.query('UPDATE clan_members SET pct=$2 WHERE key=$1 AND clan IS NOT NULL RETURNING key', [key, pct])).rows[0];
  const m = S().members[key]; if (!m || !m.clan) return false;
  m.pct = pct; saveSoon(); return true;
}
async function clanSetMin(clan, pct) {
  if (pool) { await pool.query('UPDATE clans SET min_pct=$2, updated=now() WHERE id=$1', [clan, pct]); return; }
  S().clans[clan].min_pct = pct; saveSoon();
}
async function clanTouch(key) {
  if (pool) { await pool.query('UPDATE clan_members SET seen=now() WHERE key=$1', [key]); return; }
  const m = S().members[key]; if (m) { m.seen = nowIso(); saveSoon(); }
}

// Деньги в общак. Сначала гасится долг (без бонуса Деловых), остальное — взнос (+бонус, если есть).
// Возвращает { repaid, toTreasury, bonus }
function splitGive(amount, debt, bonusRate) {
  const repaid = Math.min(debt, amount), rest = amount - repaid;
  const bonus = Math.floor(rest * bonusRate);
  return { repaid, bonus, toTreasury: amount + bonus };
}
// Ручной взнос из основного баланса
async function clanGive(key, amount, bonusRateOf) {
  if (pool) return guard(() => tx(async (c) => {
    const m = (await c.query('SELECT * FROM clan_members WHERE key=$1 FOR UPDATE', [key])).rows[0];
    if (!m || !m.clan) fail('Сначала вступи в клан');
    await c.query('SELECT 1 FROM clans WHERE id=$1 FOR UPDATE', [m.clan]);
    const w = await lockWallet(c, key);
    if (+w.bucks < amount) fail(`Не хватает бабок: на счету ${w.bucks}`);
    const g = splitGive(amount, +m.debt, bonusRateOf(m.clan));
    const bank = +(await c.query('UPDATE wallets SET bucks = bucks - $2, updated=now() WHERE key=$1 RETURNING bucks', [key, amount])).rows[0].bucks;
    const tr = +(await c.query('UPDATE clans SET treasury = treasury + $2, updated=now() WHERE id=$1 RETURNING treasury', [m.clan, g.toTreasury])).rows[0].treasury;
    const mm = (await c.query('UPDATE clan_members SET contributed = contributed + $2, debt = debt - $3 WHERE key=$1 RETURNING *', [key, amount - g.repaid, g.repaid])).rows[0];
    await c.query(`INSERT INTO clan_ledger (clan, key, kind, amount) VALUES ($1,$2,$3,$4)`, [m.clan, key, g.repaid ? 'repay+give' : 'give', g.toTreasury]);
    return { bank, treasury: tr, member: memberOut(mm), ...g };
  }));
  return guard(async () => {
    const s = S(), m = s.members[key];
    if (!m || !m.clan) fail('Сначала вступи в клан');
    const w = memW(key); if (w.bucks == null) w.bucks = 5000;
    if (w.bucks < amount) fail(`Не хватает бабок: на счету ${w.bucks}`);
    const g = splitGive(amount, m.debt, bonusRateOf(m.clan));
    w.bucks -= amount; s.clans[m.clan].treasury += g.toTreasury; m.contributed += amount - g.repaid; m.debt -= g.repaid;
    ledgerMem(m.clan, key, g.repaid ? 'repay+give' : 'give', g.toTreasury); saveSoon();
    return { bank: w.bucks, treasury: s.clans[m.clan].treasury, member: memberOut(m), ...g };
  });
}
// Выигрыш/награда в бабках с автоотчислением в общак.
// credit — сколько зачислить всего (например, вернувшаяся ставка + выигрыш), profit — чистый выигрыш (с него процент).
// pct = max(свой процент, минимум клана); при долге — не меньше autoRepayPct.
async function clanReward(key, credit, profit, { bonusRateOf, autoRepayPct }) {
  credit = Math.max(0, Math.round(credit)); profit = Math.max(0, Math.min(credit, Math.round(profit)));
  const cutOf = (m, minPct) => {
    if (!m || !m.clan || !profit) return 0;
    let pct = Math.max(+m.pct, +minPct);
    if (+m.debt > 0) pct = Math.max(pct, autoRepayPct);
    return Math.floor((profit * pct) / 100);
  };
  if (pool) return tx(async (c) => {
    const m = (await c.query('SELECT * FROM clan_members WHERE key=$1 FOR UPDATE', [key])).rows[0];
    let cut = 0, g = null;
    if (m && m.clan) {
      const cl = (await c.query('SELECT min_pct FROM clans WHERE id=$1 FOR UPDATE', [m.clan])).rows[0];
      cut = cutOf(m, cl.min_pct);
      if (cut) {
        g = splitGive(cut, +m.debt, bonusRateOf(m.clan));
        await c.query('UPDATE clans SET treasury = treasury + $2, updated=now() WHERE id=$1', [m.clan, g.toTreasury]);
        await c.query('UPDATE clan_members SET contributed = contributed + $2, debt = debt - $3 WHERE key=$1', [key, cut - g.repaid, g.repaid]);
        await c.query(`INSERT INTO clan_ledger (clan, key, kind, amount) VALUES ($1,$2,'auto',$3)`, [m.clan, key, g.toTreasury]);
      }
    }
    await lockWallet(c, key);
    const bank = +(await c.query('UPDATE wallets SET bucks = bucks + $2, updated=now() WHERE key=$1 RETURNING bucks', [key, credit - cut])).rows[0].bucks;
    return { bank, cut, repaid: g ? g.repaid : 0 };
  });
  const s = S(), m = s.members[key], w = memW(key);
  if (w.bucks == null) w.bucks = 5000;
  const cut = m && m.clan ? cutOf(m, s.clans[m.clan].min_pct) : 0;
  let g = null;
  if (cut) {
    g = splitGive(cut, m.debt, bonusRateOf(m.clan));
    s.clans[m.clan].treasury += g.toTreasury; m.contributed += cut - g.repaid; m.debt -= g.repaid;
    ledgerMem(m.clan, key, 'auto', g.toTreasury);
  }
  w.bucks += credit - cut; saveSoon();
  return { bank: w.bucks, cut, repaid: g ? g.repaid : 0 };
}
// Буст клана за счёт казны (покупает старший). Действует hours часов; повторная покупка продлевает.
async function clanBoost(clan, id, price, hours) {
  const until = (prev) => new Date(Math.max(Date.now(), Date.parse(prev || 0) || 0) + hours * 3600000).toISOString();
  if (pool) return guard(() => tx(async (c) => {
    const cl = (await c.query('SELECT * FROM clans WHERE id=$1 FOR UPDATE', [clan])).rows[0];
    if (+cl.treasury < price) fail(`В общаке не хватает: нужно ${price}`);
    const t = until((cl.boosts || {})[id]);
    await c.query(`UPDATE clans SET treasury = treasury - $2, boosts = boosts || jsonb_build_object($3::text, $4::text), updated=now() WHERE id=$1`, [clan, price, id, t]);
    await c.query(`INSERT INTO clan_ledger (clan, kind, amount) VALUES ($1,$2,$3)`, [clan, 'boost:' + id, -price]);
    return { until: t };
  }));
  return guard(async () => {
    const cl = S().clans[clan];
    if (cl.treasury < price) fail(`В общаке не хватает: нужно ${price}`);
    const t = until(cl.boosts[id]);
    cl.treasury -= price; cl.boosts[id] = t; ledgerMem(clan, null, 'boost:' + id, -price); saveSoon();
    return { until: t };
  });
}

// ---------- долг из общака ----------
const loanOut = (l) => l && { id: +l.id, clan: l.clan, amount: +l.amount, target: +l.wager_target, current: Math.floor(+l.wager_current), status: l.status, created: iso(l.created) };
async function loanActive(key) {
  if (pool) return loanOut((await pool.query(`SELECT * FROM loans WHERE key=$1 AND status='active'`, [key])).rows[0]);
  return loanOut(S().loans.find((l) => l.key === key && l.status === 'active'));
}
// Взять в долг: деньги уходят из казны в «бонусный» баланс, долг записывается на участника
async function loanTake(key, amount, { mult, cap, share, min }) {
  const check = (m, treasury) => {
    if (!m || !m.clan) fail('Сначала вступи в клан');
    if (+m.debt > 0) fail('Сначала верни прошлый долг');
    const max = Math.min(cap, Math.floor(treasury * share));
    if (max < min) fail(`В общаке мало денег: долг даётся от ${min}, а сейчас можно максимум ${Math.max(0, max)}`);
    if (amount < min || amount > max) fail(`Можно взять от ${min} до ${max}`);
  };
  if (pool) return guard(() => tx(async (c) => {
    const m = (await c.query('SELECT * FROM clan_members WHERE key=$1 FOR UPDATE', [key])).rows[0];
    const cl = m && m.clan ? (await c.query('SELECT * FROM clans WHERE id=$1 FOR UPDATE', [m.clan])).rows[0] : { treasury: 0 };
    check(m, +cl.treasury);
    if ((await c.query(`SELECT 1 FROM loans WHERE key=$1 AND status='active'`, [key])).rows[0]) fail('У тебя уже есть долг');
    await c.query('UPDATE clans SET treasury = treasury - $2, updated=now() WHERE id=$1', [m.clan, amount]);
    await c.query('UPDATE clan_members SET debt = debt + $2 WHERE key=$1', [key, amount]);
    await lockWallet(c, key);
    const bonus = +(await c.query('UPDATE wallets SET bonus = bonus + $2, updated=now() WHERE key=$1 RETURNING bonus', [key, amount])).rows[0].bonus;
    const l = (await c.query(`INSERT INTO loans (key, clan, amount, wager_target) VALUES ($1,$2,$3,$4) RETURNING *`, [key, m.clan, amount, amount * mult])).rows[0];
    await c.query(`INSERT INTO clan_ledger (clan, key, kind, amount) VALUES ($1,$2,'loan',$3)`, [m.clan, key, -amount]);
    return { loan: loanOut(l), bonus };
  }));
  return guard(async () => {
    const s = S(), m = s.members[key];
    check(m, m && m.clan ? s.clans[m.clan].treasury : 0);
    if (s.loans.some((l) => l.key === key && l.status === 'active')) fail('У тебя уже есть долг');
    s.clans[m.clan].treasury -= amount; m.debt += amount;
    const w = memW(key); w.bonus = (w.bonus || 0) + amount;
    const l = { id: sid(), key, clan: m.clan, amount, wager_target: amount * mult, wager_current: 0, status: 'active', created: nowIso() };
    s.loans.push(l); ledgerMem(m.clan, key, 'loan', -amount); saveSoon();
    return { loan: loanOut(l), bonus: w.bonus };
  });
}
// Ставка из «бонусного» баланса (только пока есть активный долг). null — бонуса не хватает.
async function bonusBet(key, cost) {
  if (pool) {
    const r = await pool.query(`UPDATE wallets SET bonus = bonus - $2, updated=now() WHERE key=$1 AND bonus >= $2
      AND EXISTS (SELECT 1 FROM loans WHERE key=$1 AND status='active') RETURNING bonus`, [key, cost]);
    return r.rows[0] ? +r.rows[0].bonus : null;
  }
  const w = memW(key);
  if (!S().loans.some((l) => l.key === key && l.status === 'active') || (w.bonus || 0) < cost) return null;
  w.bonus -= cost; saveSoon(); return w.bonus;
}
async function bonusAdd(key, amount) {
  if (pool) return +(await pool.query('UPDATE wallets SET bonus = bonus + $2, updated=now() WHERE key=$1 RETURNING bonus', [key, amount])).rows[0].bonus;
  const w = memW(key); w.bonus = (w.bonus || 0) + amount; saveSoon(); return w.bonus;
}
// Засчитать оборот. Выполнил отыгрыш — бонус переходит в основной баланс. Бонус кончился — долг «сгорел» (но остаётся долгом).
// Возвращает null (нет долга) или { current, target, done, moved, burned, bank, bonus }
async function wagerAdd(key, amount, minBet) {
  if (!(amount > 0)) return null;
  if (pool) return tx(async (c) => {
    const l = (await c.query(`SELECT * FROM loans WHERE key=$1 AND status='active' FOR UPDATE`, [key])).rows[0];
    if (!l) return null;
    const cur = +l.wager_current + amount, target = +l.wager_target;
    const w = await lockWallet(c, key);
    if (cur >= target) {
      const moved = +w.bonus;
      const nw = (await c.query('UPDATE wallets SET bucks = bucks + bonus, bonus = 0, updated=now() WHERE key=$1 RETURNING bucks', [key])).rows[0];
      await c.query(`UPDATE loans SET wager_current=$2, status='done', closed=now() WHERE id=$1`, [l.id, target]);
      return { current: target, target, done: true, moved, bank: +nw.bucks, bonus: 0 };
    }
    if (+w.bonus < minBet) {
      await c.query('UPDATE wallets SET bonus = 0, updated=now() WHERE key=$1', [key]);
      await c.query(`UPDATE loans SET wager_current=$2, status='burned', closed=now() WHERE id=$1`, [l.id, cur]);
      return { current: Math.floor(cur), target, burned: true, bank: +w.bucks, bonus: 0 };
    }
    await c.query('UPDATE loans SET wager_current=$2 WHERE id=$1', [l.id, cur]);
    return { current: Math.floor(cur), target, bank: +w.bucks, bonus: +w.bonus };
  });
  const l = S().loans.find((x) => x.key === key && x.status === 'active');
  if (!l) return null;
  const w = memW(key); if (w.bucks == null) w.bucks = 5000;
  l.wager_current += amount;
  let res;
  if (l.wager_current >= l.wager_target) {
    const moved = w.bonus || 0;
    w.bucks += moved; w.bonus = 0; l.wager_current = l.wager_target; l.status = 'done'; l.closed = nowIso();
    res = { current: l.wager_target, target: l.wager_target, done: true, moved, bank: w.bucks, bonus: 0 };
  } else if ((w.bonus || 0) < minBet) {
    w.bonus = 0; l.status = 'burned'; l.closed = nowIso();
    res = { current: Math.floor(l.wager_current), target: l.wager_target, burned: true, bank: w.bucks, bonus: 0 };
  } else res = { current: Math.floor(l.wager_current), target: l.wager_target, bank: w.bucks, bonus: w.bonus };
  saveSoon();
  return res;
}
// Вернуть долг из основного баланса
async function loanRepay(key, amount) {
  if (pool) return guard(() => tx(async (c) => {
    const m = (await c.query('SELECT * FROM clan_members WHERE key=$1 FOR UPDATE', [key])).rows[0];
    if (!m || !(+m.debt > 0)) fail('Долга нет');
    await c.query('SELECT 1 FROM clans WHERE id=$1 FOR UPDATE', [m.clan]);
    const w = await lockWallet(c, key);
    const amt = Math.min(amount, +m.debt, +w.bucks); // не хватает на всё — гасим, сколько есть
    if (amt <= 0) fail('На счету нет бабок');
    const bank = +(await c.query('UPDATE wallets SET bucks = bucks - $2, updated=now() WHERE key=$1 RETURNING bucks', [key, amt])).rows[0].bucks;
    const tr = +(await c.query('UPDATE clans SET treasury = treasury + $2, updated=now() WHERE id=$1 RETURNING treasury', [m.clan, amt])).rows[0].treasury;
    const mm = (await c.query('UPDATE clan_members SET debt = debt - $2 WHERE key=$1 RETURNING *', [key, amt])).rows[0];
    await c.query(`INSERT INTO clan_ledger (clan, key, kind, amount) VALUES ($1,$2,'repay',$3)`, [m.clan, key, amt]);
    return { bank, treasury: tr, member: memberOut(mm), repaid: amt };
  }));
  return guard(async () => {
    const s = S(), m = s.members[key];
    if (!m || !(m.debt > 0)) fail('Долга нет');
    const w = memW(key);
    const amt = Math.min(amount, m.debt, w.bucks);
    if (amt <= 0) fail('На счету нет бабок');
    w.bucks -= amt; s.clans[m.clan].treasury += amt; m.debt -= amt;
    ledgerMem(m.clan, key, 'repay', amt); saveSoon();
    return { bank: w.bucks, treasury: s.clans[m.clan].treasury, member: memberOut(m), repaid: amt };
  });
}

// ---------- ночное колесо района ----------
// Один раз в сутки (day — дата по Москве). Повторный вызов за тот же день ничего не делает (null).
async function clanEvent(day, clan, cfg) {
  const since = new Date(Date.now() - cfg.activeDays * 86400000).toISOString();
  const calc = (treasury, n, double) => {
    const mult = double ? 2 : 1;
    const each = n ? Math.min(cfg.perCap * mult, Math.floor((treasury * cfg.share * mult) / n)) : 0;
    return { fromTreasury: each * n, each: each + (n ? cfg.bonus * mult : 0), double };
  };
  if (pool) return tx(async (c) => {
    const ins = await c.query(`INSERT INTO clan_events (day, clan) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING day`, [day, clan]);
    if (!ins.rows[0]) return null;
    const cl = (await c.query('SELECT * FROM clans WHERE id=$1 FOR UPDATE', [clan])).rows[0];
    const keys = (await c.query('SELECT key FROM clan_members WHERE clan=$1 AND seen > $2 ORDER BY key', [clan, since])).rows.map((x) => x.key);
    const double = !!(cl.boosts && cl.boosts[cfg.doubleBoost] && Date.parse(cl.boosts[cfg.doubleBoost]) > Date.now());
    const r = calc(+cl.treasury, keys.length, double);
    if (keys.length) {
      await c.query('UPDATE clans SET treasury = treasury - $2, updated=now() WHERE id=$1', [clan, r.fromTreasury]);
      await c.query('INSERT INTO wallets (key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [keys]);
      await c.query('UPDATE wallets SET bucks = bucks + $2, updated=now() WHERE key = ANY($1)', [keys, r.each]);
      await c.query(`INSERT INTO clan_ledger (clan, kind, amount) VALUES ($1,'wheel',$2)`, [clan, -r.fromTreasury]);
    }
    await c.query('UPDATE clan_events SET members=$2, each_amount=$3, total=$4 WHERE day=$1', [day, keys.length, r.each, r.each * keys.length]);
    return { day, clan, members: keys.length, each: r.each, total: r.each * keys.length, fromTreasury: r.fromTreasury, double, keys };
  });
  const s = S();
  if (s.events[day]) return null;
  const cl = s.clans[clan];
  const keys = Object.values(s.members).filter((m) => m.clan === clan && m.seen > since).map((m) => m.key).sort();
  const double = !!(cl.boosts[cfg.doubleBoost] && Date.parse(cl.boosts[cfg.doubleBoost]) > Date.now());
  const r = calc(cl.treasury, keys.length, double);
  cl.treasury -= r.fromTreasury;
  for (const k of keys) { const w = memW(k); if (w.bucks == null) w.bucks = 5000; w.bucks += r.each; }
  if (keys.length) ledgerMem(clan, null, 'wheel', -r.fromTreasury);
  s.events[day] = { day, clan, members: keys.length, each_amount: r.each, total: r.each * keys.length, created: nowIso() };
  saveSoon();
  return { day, clan, members: keys.length, each: r.each, total: r.each * keys.length, fromTreasury: r.fromTreasury, double, keys };
}
async function clanLastEvent() {
  const out = (e) => e && { day: e.day instanceof Date ? e.day.toISOString().slice(0, 10) : String(e.day).slice(0, 10), clan: e.clan, members: +e.members, each: +e.each_amount, total: +e.total };
  if (pool) return out((await pool.query('SELECT day::text AS day, clan, members, each_amount, total FROM clan_events ORDER BY day DESC LIMIT 1')).rows[0]);
  const days = Object.keys(S().events).sort();
  return out(S().events[days[days.length - 1]]);
}
async function clanEventDay(day) {
  if (pool) return !!(await pool.query('SELECT 1 FROM clan_events WHERE day=$1', [day])).rows[0];
  return !!S().events[day];
}

module.exports = { init, record, addRespect, top, count, playerStats, wallet, credit, spend, setEquip, claimDaily, useSpin, grantItem, bucksAdd, bucksRefill, recordPayment, findPayment,
  socInit, socUser, socFind, socUsers, friendRequest, friendRespond, friendRemove, friendList, friendKeys, areFriends, chatAdd, chatHistory,
  clanMember, clanInfo, clanHead, clanBoostOn, clanJoin, clanLeave, clanSetPct, clanSetMin, clanTouch, clanGive, clanReward, clanBoost,
  loanActive, loanTake, bonusBet, bonusAdd, wagerAdd, loanRepay, clanEvent, clanLastEvent, clanEventDay,
  get kind() { return pool ? 'postgres' : 'file'; } };
