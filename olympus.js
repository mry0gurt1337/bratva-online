'use strict';
// Bratva Olympus — слот 6×5 без линий: выигрыш от 8 одинаковых символов в любом месте,
// каскады, сферы-множители от Глока, бесплатные спины с копящимся множителем. Считается только на сервере.
// Особенности: «Удар Глока» — если спин выиграл без сфер, Глок иногда сам бросает 1–2 сферы;
// бонус «Беспредел» (только покупкой) — в каждом бесплатном спине гарантирована сфера.
const crypto = require('crypto');
const COLS = 6, ROWS = 5, CELLS = COLS * ROWS, MAX_WIN = 25000;
// выплаты в ставках за 8–9 / 10–11 / 12+ символов
const PAY = {
  crown:  [10, 25, 50],
  chain:  [2.5, 10, 25],
  merin:  [2, 5, 15],
  pidjak: [1.5, 2, 12],
  konyak: [1, 1.5, 10],
  pager:  [0.8, 1.2, 8],
  t:      [0.5, 1, 5],
  k:      [0.4, 0.9, 4],
  d:      [0.25, 0.75, 2],
};
const SCATTER_PAY = { 4: 3, 5: 5, 6: 100 };
const W = { crown: 2.2, chain: 3.4, merin: 4.2, pidjak: 5, konyak: 5.8, pager: 6.6, t: 8, k: 8.8, d: 9.6 };
// сферы: в базе и в бонусе свои таблицы — в бонусе крупные выпадают чаще
const MULTS = [[2, 150], [3, 110], [4, 80], [5, 70], [6, 45], [8, 40], [10, 40], [12, 26], [15, 24], [20, 20], [25, 14], [50, 8], [100, 4], [250, 1.2], [500, 0.45], [1000, 0.15]];
const MULTS_FS = MULTS.map(([v, w]) => [v, v >= 10 ? w * 1.6 : w]);
const CFG = { k: 1.14, scatter: 0.0165, multBase: 0.0033, multFs: 0.0085, fsSpins: 15, fsRetrigger: 5, strike: 0.05, strikeTwo: 0.25, ante: 1.31 };
const rnd = () => crypto.randomInt(1 << 30) / (1 << 30);
const SYMS = Object.keys(W), WSUM = SYMS.reduce((s, k) => s + W[k], 0);
const msum = (t) => t.reduce((s, m) => s + m[1], 0), MSUM = msum(MULTS), MSUM_FS = msum(MULTS_FS);
function orb(fs) { const t = fs ? MULTS_FS : MULTS; let y = rnd() * (fs ? MSUM_FS : MSUM); for (const [v, w] of t) { if ((y -= w) < 0) return v; } return 2; }

function pick(fs, ante) {
  const x = rnd();
  if (x < CFG.scatter * (ante ? CFG.ante : 1)) return 'S';
  if (x < CFG.scatter * (ante ? CFG.ante : 1) + (fs ? CFG.multFs : CFG.multBase)) {
    return 'M' + orb(fs);
  }
  let y = rnd() * WSUM;
  for (const k of SYMS) { if ((y -= W[k]) < 0) return k; }
  return 'd';
}
const tier = (n) => (n >= 12 ? 2 : n >= 10 ? 1 : 0);

// Один спин с каскадами. Возвращает шаги для анимации.
// strikeMode: 'base' — «Удар Глока» с шансом, если выигрыш без сфер; 'super' — сфера гарантирована всегда
function spin(fs, ante, strikeMode) {
  let grid = Array.from({ length: CELLS }, () => pick(fs, ante));
  const first = grid.slice();
  const steps = [];
  let win = 0;
  for (;;) {
    const cnt = {};
    grid.forEach((s) => { if (PAY[s]) cnt[s] = (cnt[s] || 0) + 1; });
    const winners = Object.keys(cnt).filter((s) => cnt[s] >= 8);
    if (!winners.length) break;
    const remove = [], parts = [];
    let pay = 0;
    for (const s of winners) {
      const p = PAY[s][tier(cnt[s])] * CFG.k;
      pay += p; parts.push({ s, n: cnt[s], p });
      grid.forEach((x, i) => { if (x === s) remove.push(i); });
    }
    win += pay;
    // гравитация: в каждом столбце оставшиеся падают вниз, сверху новые
    const next = [], fresh = [];
    for (let c = 0; c < COLS; c++) {
      const col = [];
      for (let r = 0; r < ROWS; r++) { const i = c * ROWS + r; if (!remove.includes(i)) col.push(grid[i]); }
      const add = ROWS - col.length;
      const neu = Array.from({ length: add }, () => pick(fs, ante));
      next.push(...neu, ...col);
      fresh.push(add);
    }
    steps.push({ remove, pay: +pay.toFixed(2), parts, grid: next, fresh });
    grid = next;
  }
  // Удар Глока: сфера прилетает на клетку без сферы и Общака
  let strike = null;
  const hasM = grid.some((s) => s[0] === 'M');
  if ((strikeMode === 'base' && win > 0 && !hasM && rnd() < CFG.strike) || (strikeMode === 'super' && !hasM)) {
    const free = grid.map((s, i) => (s[0] !== 'M' && s !== 'S' ? i : -1)).filter((i) => i >= 0);
    const n = strikeMode === 'base' && rnd() < CFG.strikeTwo ? 2 : 1;
    strike = [];
    for (let k = 0; k < n && free.length; k++) {
      const j = free.splice(Math.floor(rnd() * free.length), 1)[0];
      const v = orb(fs || strikeMode === 'super');
      grid[j] = 'M' + v; strike.push({ i: j, v });
    }
  }
  const mults = grid.map((s, i) => (s[0] === 'M' ? { i, v: +s.slice(1) } : null)).filter(Boolean);
  const multSum = mults.reduce((s, m) => s + m.v, 0);
  const scat = grid.filter((s) => s === 'S').length;
  return { first, steps, win: +win.toFixed(2), mults, multSum, scat, end: grid, strike };
}

// Бесплатные спины: множитель копится весь бонус. Всё в ставках.
function freeSpins(sup, already = 0) {
  let left = CFG.fsSpins, acc = 0, fsTotal = 0;
  const spins = [];
  while (left > 0 && spins.length < 100) {
    left--;
    const s = spin(true, false, sup ? 'super' : null);
    if (s.win && s.multSum) acc += s.multSum;
    const w = s.win * (s.win && acc ? acc : 1);
    const extra = s.scat >= 3 ? CFG.fsRetrigger : 0;
    left += extra;
    fsTotal += w + (SCATTER_PAY[Math.min(6, s.scat)] || 0);
    spins.push({ ...s, acc, total: +w.toFixed(2), extra });
    if (already + fsTotal >= MAX_WIN) break;
  }
  return { spins, total: +fsTotal.toFixed(2), super: !!sup };
}

// Полная игра: базовый спин + бонус, если выпал. Всё в ставках (x).
// buy = купленный бонус: базовый спин гарантированно с 4+ Общаками; buy === 'super' — бонус «Беспредел»
function play(ante = false, buy = false) {
  const sup = buy === 'super';
  let base = spin(false, ante, 'base');
  for (let k = 0; buy && base.scat < 4 && k < 20000; k++) base = spin(false, false, 'base');
  let total = base.win * (base.win && base.multSum ? base.multSum : 1);
  const scatPay = SCATTER_PAY[Math.min(6, base.scat)] || 0;
  total += scatPay;
  const res = { base: { ...base, total: +total.toFixed(2), scatPay }, fs: null };
  if (base.scat >= 4) {
    res.fs = freeSpins(sup, total);
    total += res.fs.total;
  }
  res.x = +Math.min(MAX_WIN, total).toFixed(2);
  res.capped = total >= MAX_WIN;
  return res;
}

const BUY_PRICE = 72;    // цены подобраны прогоном: отдача покупок около 95%
const SUPER_PRICE = 215;
module.exports = { BUY_PRICE, SUPER_PRICE, play, spin, freeSpins, PAY, SCATTER_PAY, COLS, ROWS, MAX_WIN, CFG, W, MULTS };

if (require.main === module) {
  const N = Number(process.argv[2]) || 300000, ante = process.argv[3] === 'ante', buy = process.argv[3] === 'buy' ? true : process.argv[3] === 'super' ? 'super' : false;
  let tot = 0, hits = 0, fs = 0, big = 0, max = 0, fsTot = 0;
  for (let i = 0; i < N; i++) { const r = play(ante, buy); tot += r.x; if (r.x > 0) hits++; if (r.fs) { fs++; fsTot += r.fs.total; } if (r.x >= 100) big++; if (r.x > max) max = r.x; }
  const cost = buy === 'super' ? SUPER_PRICE : buy ? BUY_PRICE : ante ? 1.25 : 1;
  console.log(`спинов ${N}${ante ? ' (повышенная ставка)' : ''}: отдача ${(100 * tot / N / cost).toFixed(2)}%, выигрышных ${(100 * hits / N).toFixed(1)}%, бонус раз в ${(N / Math.max(1, fs)).toFixed(0)}, средний бонус x${(fsTot / Math.max(1, fs)).toFixed(1)}, x100+ раз в ${(N / Math.max(1, big)).toFixed(0)}, максимум x${max}`);
}
