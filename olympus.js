'use strict';
// Bratva Olympus — слот 6×5 без линий: выигрыш от 8 одинаковых символов в любом месте,
// каскады, сферы-множители от Глока, бесплатные спины с копящимся множителем. Считается только на сервере.
const crypto = require('crypto');
const COLS = 6, ROWS = 5, CELLS = COLS * ROWS, MAX_WIN = 15000;
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
const MULTS = [[2, 200], [3, 140], [4, 100], [5, 80], [6, 50], [8, 40], [10, 34], [12, 22], [15, 18], [20, 14], [25, 10], [50, 5], [100, 2.5], [250, 0.8], [500, 0.3], [1000, 0.1]];
const CFG = { k: 1.72, scatter: 0.0165, multBase: 0.0028, multFs: 0.0085, fsSpins: 15, fsRetrigger: 5 };
const rnd = () => crypto.randomInt(1 << 30) / (1 << 30);
const SYMS = Object.keys(W), WSUM = SYMS.reduce((s, k) => s + W[k], 0), MSUM = MULTS.reduce((s, m) => s + m[1], 0);

function pick(fs, ante) {
  const x = rnd();
  if (x < CFG.scatter * (ante ? 1.19 : 1)) return 'S';
  if (x < CFG.scatter * (ante ? 1.19 : 1) + (fs ? CFG.multFs : CFG.multBase)) {
    let y = rnd() * MSUM;
    for (const [v, w] of MULTS) { if ((y -= w) < 0) return 'M' + v; }
    return 'M2';
  }
  let y = rnd() * WSUM;
  for (const k of SYMS) { if ((y -= W[k]) < 0) return k; }
  return 'd';
}
const tier = (n) => (n >= 12 ? 2 : n >= 10 ? 1 : 0);

// Один спин с каскадами. Возвращает шаги для анимации.
function spin(fs, ante) {
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
  const mults = grid.map((s, i) => (s[0] === 'M' ? { i, v: +s.slice(1) } : null)).filter(Boolean);
  const multSum = mults.reduce((s, m) => s + m.v, 0);
  const scat = grid.filter((s) => s === 'S').length;
  return { first, steps, win: +win.toFixed(2), mults, multSum, scat, end: grid };
}

// Полная игра: базовый спин + бонус, если выпал. Всё в ставках (x).
function play(ante = false) {
  const base = spin(false, ante);
  let total = base.win * (base.win && base.multSum ? base.multSum : 1);
  const scatPay = SCATTER_PAY[Math.min(6, base.scat)] || 0;
  total += scatPay;
  const res = { base: { ...base, total: +total.toFixed(2), scatPay }, fs: null };
  if (base.scat >= 4) {
    let left = CFG.fsSpins, acc = 0, fsTotal = 0;
    const spins = [];
    while (left > 0 && spins.length < 100) {
      left--;
      const s = spin(true, false);
      if (s.win && s.multSum) acc += s.multSum;
      const w = s.win * (s.win && acc ? acc : 1);
      const extra = s.scat >= 3 ? CFG.fsRetrigger : 0;
      left += extra;
      fsTotal += w + (SCATTER_PAY[Math.min(6, s.scat)] || 0);
      spins.push({ ...s, acc, total: +w.toFixed(2), extra });
      if (total + fsTotal >= MAX_WIN) break;
    }
    res.fs = { spins, total: +fsTotal.toFixed(2) };
    total += fsTotal;
  }
  res.x = +Math.min(MAX_WIN, total).toFixed(2);
  res.capped = total >= MAX_WIN;
  return res;
}

module.exports = { play, spin, PAY, SCATTER_PAY, COLS, ROWS, MAX_WIN, CFG, W };

if (require.main === module) {
  const N = Number(process.argv[2]) || 300000, ante = process.argv[3] === 'ante';
  let tot = 0, hits = 0, fs = 0, big = 0, max = 0, fsTot = 0;
  for (let i = 0; i < N; i++) { const r = play(ante); tot += r.x; if (r.x > 0) hits++; if (r.fs) { fs++; fsTot += r.fs.total; } if (r.x >= 100) big++; if (r.x > max) max = r.x; }
  const cost = ante ? 1.25 : 1;
  console.log(`спинов ${N}${ante ? ' (повышенная ставка)' : ''}: отдача ${(100 * tot / N / cost).toFixed(2)}%, выигрышных ${(100 * hits / N).toFixed(1)}%, бонус раз в ${(N / Math.max(1, fs)).toFixed(0)}, средний бонус x${(fsTot / Math.max(1, fs)).toFixed(1)}, x100+ раз в ${(N / Math.max(1, big)).toFixed(0)}, максимум x${max}`);
}
