'use strict';
// Хранилище статистики для топа. Если задан DATABASE_URL — Postgres (например, Neon),
// иначе — JSON-файл рядом с сервером (на бесплатном хостинге сбрасывается при перезапуске).
const fs = require('fs');
const path = require('path');

const FILE = process.env.STATS_FILE || path.join(__dirname, 'data', 'stats.json');
let pool = null;
let mem = {};
let saveTimer = null;

async function init() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
      await pool.query(`CREATE TABLE IF NOT EXISTS players (
        key text PRIMARY KEY, tg boolean NOT NULL DEFAULT false, name text NOT NULL, username text, photo text, char text,
        games int NOT NULL DEFAULT 0, wins int NOT NULL DEFAULT 0, top3 int NOT NULL DEFAULT 0,
        best bigint NOT NULL DEFAULT 0, total bigint NOT NULL DEFAULT 0,
        strelka_won int NOT NULL DEFAULT 0, strelka_total int NOT NULL DEFAULT 0, bankrupts int NOT NULL DEFAULT 0,
        glok int NOT NULL DEFAULT 0, titles int NOT NULL DEFAULT 0, updated timestamptz NOT NULL DEFAULT now())`);
      console.log('  База: Postgres подключена');
      return;
    } catch (e) {
      console.error('  База: не удалось подключиться к Postgres, пишу в файл.', e.message);
      pool = null;
    }
  }
  try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = {}; }
  console.log('  База: файл ' + FILE);
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(mem)); } catch (e) { console.error('stats save', e.message); }
  }, 500);
}

// row: { key, tg, name, username, photo, char, win, top3, worth, strelkaWon, strelkaTotal, bankrupt, glok, titles }
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
      const o = mem[x.key] || (mem[x.key] = { key: x.key, games: 0, wins: 0, top3: 0, best: 0, total: 0, strelka_won: 0, strelka_total: 0, bankrupts: 0, glok: 0, titles: 0 });
      Object.assign(o, { tg: !!x.tg, name: x.name, username: x.username || o.username || null, photo: x.photo || o.photo || null, char: x.char, updated: new Date().toISOString() });
      o.games += 1; o.wins += x.win ? 1 : 0; o.top3 += x.top3 ? 1 : 0; o.best = Math.max(o.best, x.worth); o.total += x.worth;
      o.strelka_won += x.strelkaWon; o.strelka_total += x.strelkaTotal; o.bankrupts += x.bankrupt ? 1 : 0; o.glok += x.glok; o.titles += x.titles;
    }
  }
  if (!pool) saveSoon();
}

const SORTS = {
  wins: 'wins DESC, games ASC',
  rate: '(wins::float / GREATEST(games,1)) DESC, wins DESC',
  best: 'best DESC',
  strelka: 'strelka_won DESC, strelka_total ASC',
  games: 'games DESC',
};
async function top(sort = 'wins', limit = 50) {
  if (!SORTS[sort]) sort = 'wins';
  let rows;
  if (pool) {
    const minGames = sort === 'rate' ? 'WHERE games >= 3' : '';
    rows = (await pool.query(`SELECT * FROM players ${minGames} ORDER BY ${SORTS[sort]} LIMIT $1`, [limit])).rows;
  } else {
    const val = { wins: (o) => o.wins * 1e6 - o.games, rate: (o) => (o.games >= 3 ? o.wins / o.games : -1) * 1e6 + o.wins, best: (o) => o.best, strelka: (o) => o.strelka_won * 1e6 - o.strelka_total, games: (o) => o.games }[sort];
    rows = Object.values(mem).sort((a, b) => val(b) - val(a)).slice(0, limit);
  }
  return rows.map((o) => ({
    key: o.key, tg: o.tg, name: o.name, username: o.username, photo: o.photo, char: o.char,
    games: +o.games, wins: +o.wins, top3: +o.top3, best: +o.best, avg: o.games ? Math.round(o.total / o.games) : 0,
    strelkaWon: +o.strelka_won, strelkaTotal: +o.strelka_total, bankrupts: +o.bankrupts, glok: +o.glok, titles: +o.titles,
  }));
}

async function count() {
  if (pool) return +(await pool.query('SELECT count(*) FROM players')).rows[0].count;
  return Object.keys(mem).length;
}

module.exports = { init, record, top, count, get kind() { return pool ? 'postgres' : 'file'; } };
