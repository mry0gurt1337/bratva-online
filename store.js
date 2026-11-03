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
      await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS bonus_spins int NOT NULL DEFAULT 0`);
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
const blank = (key) => ({ key, coins: 0, items: [], equip: {}, daily_on: null, streak: 0, earned_on: null, earned_today: 0, spent: 0, bought: 0, spin_on: null, bonus_spins: 0 });
function norm(w) {
  const d = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : x || null);
  return { coins: +w.coins, items: w.items || [], equip: w.equip || {}, daily_on: d(w.daily_on), streak: +w.streak, earned_on: d(w.earned_on), earned_today: +w.earned_today, spin_on: d(w.spin_on), bonus_spins: +(w.bonus_spins || 0) };
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

module.exports = { init, record, addRespect, top, count, playerStats, wallet, credit, spend, setEquip, claimDaily, useSpin, grantItem, recordPayment, findPayment, get kind() { return pool ? 'postgres' : 'file'; } };
