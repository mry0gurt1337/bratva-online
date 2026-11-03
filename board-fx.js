// Живой слой поля «Монополии»: свет от источников, фоновая жизнь с реакцией на ход и «сочность» событий.
// Всё рисуется кодом на двух canvas: под фишками (свет, дым, трещины, голуби) и над всем (деньги, искры).
// Принципы (по методике ref2game):
//  - каждое событие отвечает тремя слоями по времени: мгновенный (вспышка, тряска), короткий (частицы,
//    деньги летят), долгий (след, дым, свет в окнах);
//  - частица — чистая функция (событие, возраст, номер), случайность — детерминированный хеш, не Math.random;
//  - у каждого повтора свой период (несоизмеримые синусы), свои амплитуда и фаза; редкие события — в окнах
//    с разбросом и пропусками; после крупных событий фон молчит;
//  - каждая фоновая система реагирует на игрока: голуби взлетают, мотыльки разлетаются, патруль чаще при розыске.
window.BFX = (() => {
  const G = () => window.G;
  let board = null, cv = null, cx = null, sky = null, sx = null, W = 0, H = 0, SW = 0, SH = 0, dpr = 1, raf = 0, getSt = null;
  const T0 = performance.now();
  const now = () => (performance.now() - T0) / 1000;
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // детерминированный «случай»: одно и то же событие всегда рисуется одинаково
  const rnd = (a, b = 0) => { let h = Math.imul((a * 374761393) ^ (b * 668265263), 1274126177) | 0; h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const lerp = (a, b, t) => a + (b - a) * t;

  let cells = [], center = null;           // прямоугольники клеток и центра в координатах поля (CSS px)
  const ev = [], skyEv = [];               // события: { type, t, seed, ... }
  let quietUntil = 0, nextRare = 0, seedN = 1;
  const lit = {};                           // cell -> { t: когда включился свет, lvl, color }
  const emitted = [];                       // для автопроверок: где рисовали эмиттеры
  let snap = null;                          // прошлое состояние игры для сравнения

  // ---------- спрайты свечения (кэш по цвету) ----------
  const glowCache = {};
  function glow(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color); gr.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (glowCache[color] = c);
  }
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  function blob(c, x, y, r, color, a) { if (a <= 0.003 || r <= 0) return; c.globalAlpha = Math.min(1, a); c.drawImage(glow(color), x - r, y - r, r * 2, r * 2); c.globalAlpha = 1; }

  // ---------- общий ветер с порывами ----------
  function wind(t, x) {
    const front = ((t * 0.07) % 1.6) - 0.3; // фронт порыва бежит по полю
    const gust = Math.exp(-Math.pow((x - front) / 0.18, 2));
    return 0.35 * Math.sin(t * 0.211 + x * 1.3) + 0.2 * Math.sin(t * 0.537 + 1.7 + x * 2.9) + 0.9 * gust;
  }

  // ---------- размеры ----------
  function measure() {
    if (!board || !cv) return;
    const br = cv.getBoundingClientRect();
    W = br.width; H = br.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cells = G().BOARD.map((c) => {
      const el = document.getElementById('cell' + c.id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left - br.left, y = r.top - br.top;
      return { id: c.id, x, y, w: r.width, h: r.height, cx: x + r.width / 2, cy: y + r.height / 2, slug: c.slug, type: c.type };
    });
    const ce = board.querySelector('.center');
    if (ce) { const r = ce.getBoundingClientRect(); center = { x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height }; }
    SW = innerWidth; SH = innerHeight;
    sky.width = Math.round(SW * dpr); sky.height = Math.round(SH * dpr);
    sx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!pigeons.length) initPigeons();
  }

  // ---------- подключение ----------
  function attach(boardEl, stateGetter) {
    detach();
    board = boardEl; getSt = stateGetter;
    cv = document.createElement('canvas'); cv.className = 'bfx-board';
    const tok = board.querySelector('.tokens'); board.insertBefore(cv, tok);
    cx = cv.getContext('2d');
    sky = document.createElement('canvas'); sky.className = 'bfx-sky';
    document.body.appendChild(sky);
    sx = sky.getContext('2d');
    snap = null; ev.length = 0; skyEv.length = 0; pigeons.length = 0;
    requestAnimationFrame(() => { measure(); loop(); });
    if (!attach.bound) { attach.bound = true; addEventListener('resize', () => setTimeout(measure, 60)); document.addEventListener('visibilitychange', () => { if (!document.hidden && board) loop(); }); }
  }
  function detach() {
    cancelAnimationFrame(raf); raf = 0;
    if (cv) cv.remove(); if (sky) sky.remove();
    board = cv = cx = sky = sx = null;
  }
  const alive = () => board && board.isConnected;

  // ---------- координаты ----------
  const cellAt = (id) => cells[id];
  function elCenter(el) { // экранные координаты центра элемента
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }
  function boardToScreen(x, y) { const r = cv.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; }
  function screenToBoard(x, y) { const r = cv.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; }
  const tokEl = (pid) => board && board.querySelector(`.tok[data-pid="${pid}"]`);
  const cardMoney = (pid) => document.querySelector(`.pc[data-pid="${pid}"] .money`) || document.querySelector(`.pc[data-pid="${pid}"]`);

  // ---------- голуби: сидят на крышах, взлетают от фишек, возвращаются ----------
  const pigeons = [];
  const PERCH = [1, 4, 8, 11, 13, 17, 19, 6];
  function initPigeons() {
    const n = reduce ? 3 : 6;
    for (let i = 0; i < n; i++) pigeons.push({ i, cell: PERCH[i % PERCH.length], ox: 0.22 + rnd(i, 1) * 0.56, oy: 0.2 + rnd(i, 2) * 0.12, st: 'idle', t: 0, face: rnd(i, 3) > 0.5 ? 1 : -1, back: 0 });
  }
  function perchXY(p) { const c = cellAt(p.cell); return c ? { x: c.x + c.w * p.ox, y: c.y + c.h * p.oy } : { x: -50, y: -50 }; }
  function scare(cellId, t, soft) {
    for (const p of pigeons) {
      if (p.st !== 'idle') continue;
      const same = p.cell === cellId, near = Math.abs(p.cell - cellId) === 1 || Math.abs(p.cell - cellId) === 19;
      if (!same && !(near && !soft)) continue;
      // короткий «заметил» — потом взлёт; соседи взлетают с запаздыванием
      p.st = 'notice'; p.t = t + (same ? 0.05 : 0.25 + rnd(p.i, t * 10) * 0.3);
      const a = perchXY(p);
      // улетают за край поля, с перелётом
      const ex = a.x < W / 2 ? -W * 0.2 : W * 1.2, ey = a.y - H * (0.15 + rnd(p.i, 9) * 0.25);
      p.from = a; p.to = { x: ex, y: ey }; p.face = ex > a.x ? 1 : -1;
    }
  }
  function updPigeons(t) {
    const st = getSt && getSt();
    for (const p of pigeons) {
      if (p.st === 'notice' && t >= p.t) { p.st = 'flee'; p.t0 = t; }
      if (p.st === 'flee' && t - p.t0 > 1.4) { p.st = 'away'; p.back = t + 7 + rnd(p.i, Math.floor(t)) * 9; }
      if (p.st === 'away' && t >= p.back) {
        // возвращаются на свободную от фишек крышу
        const busy = new Set(st ? st.players.map((x) => x.pos) : []);
        const free = PERCH.filter((c) => !busy.has(c));
        p.cell = free.length ? free[Math.floor(rnd(p.i, Math.floor(t * 3)) * free.length)] : p.cell;
        p.ox = 0.25 + rnd(p.i, t) * 0.5;
        const to = perchXY(p);
        p.from = { x: to.x < W / 2 ? -W * 0.15 : W * 1.15, y: to.y - H * 0.3 }; p.to = to; p.face = to.x > p.from.x ? 1 : -1;
        p.st = 'return'; p.t0 = t;
      }
      if (p.st === 'return' && t - p.t0 > 1.8) { p.st = 'idle'; p.face = rnd(p.i, t) > 0.5 ? 1 : -1; }
    }
  }
  function drawPigeon(c, x, y, s, face, flap, peck, shadowY) {
    if (shadowY != null) { c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x, shadowY, s * 0.9, s * 0.3, 0, 0, 7); c.fill(); }
    c.save(); c.translate(x, y); c.scale(face, 1);
    if (flap != null) { // крылья
      const a = Math.sin(flap) * 0.9;
      c.fillStyle = '#8d93a3';
      c.beginPath(); c.moveTo(-s * 0.2, -s * 0.2); c.lineTo(-s * 0.5, -s * (0.2 + 1.3 * a)); c.lineTo(s * 0.4, -s * 0.25); c.fill();
    }
    c.fillStyle = '#6f7585'; c.beginPath(); c.ellipse(0, 0, s, s * 0.6, -0.15, 0, 7); c.fill();           // тело
    c.fillStyle = '#4c5160'; c.beginPath(); c.moveTo(-s * 0.8, -s * 0.1); c.lineTo(-s * 1.5, s * 0.1); c.lineTo(-s * 0.8, s * 0.3); c.fill(); // хвост
    const hy = -s * 0.55 + peck * s * 0.75, hx = s * 0.75 + peck * s * 0.25;
    c.fillStyle = '#7fd1b9'; c.beginPath(); c.arc(hx * 0.8, hy * 0.6 + s * 0.05, s * 0.32, 0, 7); c.fill();   // перламутровая шея
    c.fillStyle = '#5b6070'; c.beginPath(); c.arc(hx, hy, s * 0.36, 0, 7); c.fill();                          // голова
    c.fillStyle = '#e9b44c'; c.beginPath(); c.moveTo(hx + s * 0.3, hy - s * 0.05); c.lineTo(hx + s * 0.62, hy + s * 0.06); c.lineTo(hx + s * 0.3, hy + s * 0.12); c.fill(); // клюв
    c.fillStyle = '#ff7a3d'; c.beginPath(); c.arc(hx + s * 0.1, hy - s * 0.08, s * 0.07, 0, 7); c.fill();     // глаз
    c.restore();
  }
  function drawPigeons(c, t) {
    const s0 = Math.max(3.2, (cells[1] ? cells[1].w : 40) * 0.1);
    for (const p of pigeons) {
      if (p.st === 'away') continue;
      if (p.st === 'idle' || p.st === 'notice') {
        const a = perchXY(p);
        // клюёт в своём ритме: окна с разбросом, не по метроному
        const k = (t * (0.37 + rnd(p.i, 4) * 0.21) + rnd(p.i, 5) * 10) % 1;
        const peck = p.st === 'notice' ? -0.35 : k < 0.12 ? Math.sin((k / 0.12) * Math.PI) : 0;
        drawPigeon(c, a.x, a.y, s0, p.face, null, peck, a.y + s0 * 0.55);
      } else {
        const u = clamp((t - p.t0) / (p.st === 'flee' ? 1.4 : 1.8));
        const e = p.st === 'flee' ? u * u : ease(u);
        const x = lerp(p.from.x, p.to.x, e), y = lerp(p.from.y, p.to.y, e) - Math.sin(u * Math.PI) * H * 0.08;
        const ground = lerp(p.from.y, p.to.y, e) + s0 * (p.st === 'flee' ? 1 + u * 6 : 7 - u * 6);
        drawPigeon(c, x, y, s0 * (1 + Math.sin(u * Math.PI) * 0.35), p.face, t * 26 + p.i, 0, ground);
      }
    }
  }

  // ---------- фон: окна, неон, фонари, пар, мотыльки, патруль ----------
  const NEON = { kazino: ['#ff3fa4', '#3fe0ff'], klub: ['#b56bff', '#ff4fd8'], sauna: ['#ff8a5c', '#ffd27a'], bank: ['#7dffb0', '#f5c542'], rublevka: ['#ffe39a', '#ffffff'], port: ['#6fc3ff', '#ffe39a'] };
  const STEAM = { shaurma: 0.42, sauna: 0.36, restoran: 0.4, port: 0.3, kachalka: 0 };
  function drawAmbient(c, t, st) {
    c.globalCompositeOperation = 'lighter';
    const omon = st && st.omon != null;
    for (const cl of cells) {
      if (!cl) continue;
      const pr = st && st.props[cl.id], owner = pr && st.players.find((p) => p.id === pr.owner);
      const L = lit[cl.id];
      // окна: тёплый свет, мерцание суммой несоизмеримых синусов, у каждой клетки свои периоды
      const f = 0.86 + 0.06 * Math.sin(t * (1.13 + rnd(cl.id, 1) * 0.7) + cl.id) + 0.05 * Math.sin(t * (2.71 + rnd(cl.id, 2)) + cl.id * 3.1) + 0.03 * Math.sin(t * 7.3 + cl.id * 1.7);
      let on = cl.type === 'prop' ? (owner ? 1 : 0.32) : 0.55;
      if (L) on *= clamp((t - L.t) / 1.2) * 0.6 + 0.4 + (L.lvl || 0) * 0.15; // свет включается по очереди после покупки
      if (omon && rnd(cl.id, Math.floor(t * 9)) > 0.93) on *= 0.4;          // при ОМОНе свет дёргается
      const n = cl.type === 'prop' ? 2 + Math.min(2, pr ? pr.level : 0) : 2;
      for (let k = 0; k < n; k++) {
        const kx = 0.3 + (k % 2) * 0.4 + (rnd(cl.id, 10 + k) - 0.5) * 0.12, ky = 0.36 + Math.floor(k / 2) * 0.16 + (rnd(cl.id, 20 + k) - 0.5) * 0.08;
        blob(c, cl.x + cl.w * kx, cl.y + cl.h * ky, cl.w * 0.24, 'rgba(255,190,100,1)', 0.22 * on * f);
      }
      // подсветка хозяина снизу — читается, чья точка
      if (owner) blob(c, cl.cx, cl.y + cl.h * 0.95, cl.w * 0.6, rgba(owner.color, 1), 0.26 + 0.07 * Math.sin(t * 1.7 + cl.id));
      // свежая покупка: пульс цветом хозяина, затухает
      if (L && L.color && t - L.t < 3.5) blob(c, cl.cx, cl.cy, cl.w * 1.1, rgba(L.color, 1), 0.7 * Math.pow(1 - (t - L.t) / 3.5, 1.5));
      // неон вывесок, иногда «спотыкается» (редкое событие)
      const ne = NEON[cl.slug];
      if (ne) {
        const stutter = rnd(cl.id, Math.floor(t / 0.11)) > 0.985 ? 0.15 : 1;
        const sw = 0.5 + 0.5 * Math.sin(t * (0.9 + rnd(cl.id, 7) * 0.4));
        blob(c, cl.cx, cl.y + cl.h * 0.25, cl.w * 0.45, rgba(ne[0], 1), 0.16 * sw * stutter * (owner ? 1.3 : 1));
        blob(c, cl.cx, cl.y + cl.h * 0.3, cl.w * 0.35, rgba(ne[1], 1), 0.12 * (1 - sw) * stutter * (owner ? 1.3 : 1));
      }
    }
    // фонари в углах центра + мотыльки (разлетаются, когда рядом проходит фишка)
    if (center) {
      const pts = [[center.x, center.y], [center.x + center.w, center.y], [center.x + center.w, center.y + center.h], [center.x, center.y + center.h]];
      pts.forEach(([x, y], i) => {
        const fl = 0.8 + 0.08 * Math.sin(t * (3.1 + i * 0.37) + i) + 0.06 * Math.sin(t * (5.3 + i * 0.71)) + (omon ? 0.15 * Math.sin(t * 13 + i) : 0);
        blob(c, x, y, center.w * 0.22, 'rgba(255,214,140,1)', 0.22 * fl);
        blob(c, x, y, center.w * 0.05, 'rgba(255,245,220,1)', 0.5 * fl);
        const sc = mothScare[i] ? clamp(1 - (t - mothScare[i]) / 2.5) : 0;
        for (let m = 0; m < 3; m++) {
          const r = center.w * (0.035 + rnd(i, m) * 0.03) * (1 + sc * 3);
          const mx = x + Math.sin(t * (2.3 + m * 0.61) + m) * r, my = y + Math.sin(t * (3.7 + m * 0.43) + m * 2) * r * 0.7;
          blob(c, mx, my, center.w * 0.012, 'rgba(255,240,200,1)', 0.8 * (1 - sc * 0.5));
        }
      });
    }
    c.globalCompositeOperation = 'source-over';
    // пар и дым из труб гнётся общим ветром
    for (const cl of cells) {
      if (!cl || !STEAM[cl.slug]) continue;
      const bx = cl.x + cl.w * (0.5 + (rnd(cl.id, 30) - 0.5) * 0.3), by = cl.y + cl.h * 0.18;
      for (let k = 0; k < 6; k++) {
        const per = 2.6 + rnd(cl.id, 40 + k) * 1.3, a = ((t + rnd(cl.id, 50 + k) * per) % per) / per;
        const w = wind(t, bx / W);
        const x = bx + a * cl.w * (0.15 + w * 0.5) + Math.sin(a * 5 + k) * cl.w * 0.04, y = by - a * cl.h * 0.6;
        blob(c, x, y, cl.w * (0.1 + a * 0.22), 'rgba(225,222,232,1)', STEAM[cl.slug] * 0.75 * Math.sin(a * Math.PI));
      }
    }
    // ОМОН: мигалки красят клетки вокруг себя
    const om = board.querySelector('.tok.omon');
    if (om) {
      const r = om.getBoundingClientRect(), p = screenToBoard(r.left + r.width / 2, r.top + r.height / 2);
      c.globalCompositeOperation = 'lighter';
      const ph = Math.sin(t * 9.4) > 0;
      blob(c, p.x, p.y, W * 0.34, ph ? 'rgba(255,40,60,1)' : 'rgba(50,110,255,1)', 0.6);
      for (let k = 0; k < 2; k++) { // вращающиеся лучи
        const ang = t * 4.2 + k * Math.PI;
        const col = k ? 'rgba(60,120,255,' : 'rgba(255,60,80,';
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, W * 0.45);
        g.addColorStop(0, col + '.35)'); g.addColorStop(1, col + '0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(p.x, p.y); c.arc(p.x, p.y, W * 0.45, ang - 0.3, ang + 0.3); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }
    // редкое: патруль по раме — чаще, когда растёт розыск; молчит после крупных событий
    const heat = st ? st.heat || 0 : 0;
    if (!nextRare) nextRare = t + 20 + rnd(7, 1) * 30;
    if (t > nextRare && t > quietUntil && heat >= 1) {
      ev.push({ type: 'patrol', t, seed: seedN++, dir: rnd(seedN, 3) > 0.5 ? 1 : -1, side: Math.floor(rnd(seedN, 4) * 4) });
      nextRare = t + (35 + rnd(seedN, 5) * 60) / (1 + heat * 0.6);
    } else if (t > nextRare && heat < 1) nextRare = t + 15;
  }

  // ---------- события ----------
  function fire(type, o = {}) {
    if (!alive()) return;
    const t = now() + (o.delay || 0) / 1000;
    const e = { type, t, seed: seedN++, ...o };
    if (['boom', 'strelka', 'glok'].includes(type)) quietUntil = Math.max(quietUntil, t + 7);
    if (['notes', 'coins'].includes(type)) skyEv.push(e); else ev.push(e);
    // где эмиттер — для автопроверки «эффект там, где событие»
    if (o.cell != null && cellAt(o.cell)) { const c = cellAt(o.cell); emitted.push({ type, cell: o.cell, x: c.cx, y: c.cy, rect: { x: c.x, y: c.y, w: c.w, h: c.h }, at: Date.now() }); if (emitted.length > 50) emitted.shift(); }
    if (type === 'buy' || type === 'up') lit[o.cell] = { t, lvl: o.lvl || 0, color: o.color };
    return e;
  }
  // шаг фишки по клетке: пыль из-под фишки, голуби и мотыльки реагируют
  const mothScare = [0, 0, 0, 0];
  function step(cellId) {
    if (!alive()) return;
    const t = now();
    scare(cellId, t, false);
    const corner = { 0: 0, 5: 1, 10: 2, 15: 3 }[cellId];
    if (corner != null) mothScare[corner] = t;
    ev.push({ type: 'dust', t, seed: seedN++, cell: cellId });
  }

  // одна вспышка-кольцо
  function ring(c, x, y, R, a, life, col, wmul = 1) {
    const u = a / life; if (u < 0 || u > 1) return;
    c.strokeStyle = col.replace('A', (1 - u) * 0.9); c.lineWidth = Math.max(1, R * 0.08 * (1 - u) * wmul);
    c.beginPath(); c.arc(x, y, R * ease(u), 0, 7); c.stroke();
  }
  // трещины подрыва: зубчатые, с ветками, растут от центра кончиками вперёд
  function cracks(e, R) {
    if (e.cr) return e.cr;
    const out = [], n = 6 + Math.floor(rnd(e.seed, 1) * 3);
    const grow = (x, y, ang, len, depth, k, d0) => {
      let px = x, py = y, d = d0;
      const segs = 5 + Math.floor(rnd(e.seed, k) * 3);
      for (let s = 0; s < segs; s++) {
        ang += (rnd(e.seed, k * 31 + s) - 0.5) * 0.9;
        const l = (len / segs) * (0.7 + rnd(e.seed, k * 17 + s) * 0.6);
        const nx = px + Math.cos(ang) * l, ny = py + Math.sin(ang) * l;
        out.push({ x1: px, y1: py, x2: nx, y2: ny, d, w: (depth ? 0.5 : 1) * (1 - s / segs * 0.6) });
        d += l / R; px = nx; py = ny;
        if (depth < 1 && rnd(e.seed, k * 7 + s) > 0.62) grow(px, py, ang + (rnd(e.seed, k + s) > 0.5 ? 0.8 : -0.8), len * 0.45, depth + 1, k * 13 + s + 100, d);
      }
    };
    for (let i = 0; i < n; i++) grow(0, 0, (i / n) * Math.PI * 2 + rnd(e.seed, i + 50) * 0.6, R * (0.7 + rnd(e.seed, i + 60) * 0.5), 0, i + 1, 0);
    return (e.cr = out);
  }
  function drawEvents(c, t, st) {
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i], a = t - e.t;
      if (a < 0) continue;
      const cl = e.cell != null ? cellAt(e.cell) : null;
      const S = cl ? cl.w : W / 6;
      let done = false;
      switch (e.type) {
        case 'dust': {
          const tk = tokEl(e.pid) || null;
          const x = cl.cx, y = cl.y + cl.h * 0.8;
          for (let k = 0; k < 4; k++) { const u = a / 0.6, dx = (rnd(e.seed, k) - 0.5) * S * 0.6 * u; blob(c, x + dx, y - u * S * 0.1, S * (0.08 + u * 0.12), 'rgba(170,160,150,1)', 0.35 * (1 - u)); }
          done = a > 0.6; void tk; break;
        }
        case 'buy': case 'up': {
          c.globalCompositeOperation = 'lighter';
          blob(c, cl.cx, cl.cy, S * 1.3, 'rgba(255,220,120,1)', 1 - a / 0.3);                                // мгновенно: вспышка
          ring(c, cl.cx, cl.cy, S * 1.0, a, 0.8, 'rgba(255,214,102,A)', 1.4);
          ring(c, cl.cx, cl.cy, S * 0.7, a - 0.12, 0.7, 'rgba(255,255,230,A)', 0.8);                                     // кольцо
          const n = e.type === 'up' ? 14 : 8;
          for (let k = 0; k < n; k++) {                                                                      // коротко: искры-звёзды
            const ang = rnd(e.seed, k) * 6.28, sp = S * (0.5 + rnd(e.seed, k + 9) * 0.7), u = clamp(a / 1.3);
            blob(c, cl.cx + Math.cos(ang) * sp * ease(u), cl.cy + Math.sin(ang) * sp * ease(u) - u * S * 0.3, S * 0.11, 'rgba(255,240,170,1)', 1 - u);
          }
          c.globalCompositeOperation = 'source-over';
          done = a > 1.4; break;
        }
        case 'boom': {
          const R = S * 1.35;
          // долго: подпалина + трещины — тёмная декаль, гаснет за ~9 с
          const cr = cracks(e, R), grow = clamp(a / 0.28), scar = a < 2.5 ? 1 : 1 - (a - 2.5) / 6.5;
          c.lineCap = 'round'; c.lineJoin = 'round';
          // трещины только на клетках: сукно в центре не трескается
          c.save();
          if (center) { c.beginPath(); c.rect(0, 0, W, H); c.roundRect ? c.roundRect(center.x, center.y, center.w, center.h, center.w * 0.04) : c.rect(center.x, center.y, center.w, center.h); c.clip('evenodd'); }
          if (scar > 0) {
            const sg = c.createRadialGradient(cl.cx, cl.cy, 0, cl.cx, cl.cy, R * 0.95);
            sg.addColorStop(0, `rgba(12,6,4,${0.85 * scar})`); sg.addColorStop(0.55, `rgba(40,20,10,${0.55 * scar})`); sg.addColorStop(1, 'rgba(40,20,10,0)');
            c.fillStyle = sg; c.beginPath(); c.arc(cl.cx, cl.cy, R * 0.95 * ease(a / 0.2), 0, 7); c.fill();
            c.strokeStyle = `rgba(4,2,2,${scar})`;
            for (const s of cr) { if (s.d > grow * 1.4) continue; c.lineWidth = Math.max(1.2, S * 0.06 * s.w); c.beginPath(); c.moveTo(cl.cx + s.x1, cl.cy + s.y1); c.lineTo(cl.cx + s.x2, cl.cy + s.y2); c.stroke(); }
            c.strokeStyle = `rgba(200,175,150,${scar * 0.4})`; // светлая отбитая кромка
            for (const s of cr) { if (s.d > grow * 1.4) continue; c.lineWidth = Math.max(0.6, S * 0.012); c.beginPath(); c.moveTo(cl.cx + s.x1 + 1.2, cl.cy + s.y1 + 1.2); c.lineTo(cl.cx + s.x2 + 1.2, cl.cy + s.y2 + 1.2); c.stroke(); }
          }
          c.globalCompositeOperation = 'lighter';
          // жар в трещинах остывает от кончиков к центру и краснеет
          for (const s of cr) {
            const heat = clamp(1 - (a - 0.1 - (1 - Math.min(1, s.d)) * 0.6) / 0.8) * (s.d <= grow * 1.4 ? 1 : 0);
            if (heat <= 0) continue;
            c.strokeStyle = `rgba(255,${Math.round(40 + 150 * heat * heat)},20,${0.95 * heat})`; c.lineWidth = Math.max(0.8, S * 0.03 * s.w);
            c.beginPath(); c.moveTo(cl.cx + s.x1, cl.cy + s.y1); c.lineTo(cl.cx + s.x2, cl.cy + s.y2); c.stroke();
          }
          c.restore(); c.globalCompositeOperation = 'lighter';
          blob(c, cl.cx, cl.cy, R * 2.2, 'rgba(255,240,200,1)', 1.2 * (1 - a / 0.22));                          // вспышка
          for (let k = 0; k < 7; k++) {                                                                       // огненный шар: клубы, которые растут и темнеют
            const u = clamp((a - k * 0.03) / (0.75 + rnd(e.seed, k + 600) * 0.4)); if (u <= 0 || u >= 1) continue;
            const ang = rnd(e.seed, k + 610) * 6.28, d = R * 0.45 * ease(u);
            blob(c, cl.cx + Math.cos(ang) * d, cl.cy + Math.sin(ang) * d - u * S * 0.35, R * (0.45 + u * 0.4), u < 0.4 ? 'rgba(255,170,60,1)' : 'rgba(230,80,30,1)', 1.1 * (1 - u));
          }
          ring(c, cl.cx, cl.cy, R * 2.6, a, 0.5, 'rgba(255,236,200,A)', 0.9);                               // ударная волна
          for (let k = 0; k < 22; k++) {                                                                      // искры
            const ang = rnd(e.seed, k + 200) * 6.28, sp = R * (1 + rnd(e.seed, k + 230) * 1.6), u = clamp(a / (0.4 + rnd(e.seed, k) * 0.4));
            if (u >= 1) continue;
            const x = cl.cx + Math.cos(ang) * sp * ease(u), y = cl.cy + Math.sin(ang) * sp * ease(u) + u * u * S * 0.3;
            c.strokeStyle = `rgba(255,200,90,${1 - u})`; c.lineWidth = Math.max(1, S * 0.02);
            c.beginPath(); c.moveTo(x, y); c.lineTo(x - Math.cos(ang) * S * 0.12 * (1 - u), y - Math.sin(ang) * S * 0.12 * (1 - u)); c.stroke();
          }
          c.globalCompositeOperation = 'source-over';
          for (let k = 0; k < 12; k++) {                                                                      // обломки с тенью
            const life = 0.9 + rnd(e.seed, k + 300) * 0.5, u = clamp(a / life);
            if (u >= 1) continue;
            const ang = rnd(e.seed, k + 310) * 6.28, d = R * (0.6 + rnd(e.seed, k + 320) * 1.1) * ease(u), h = Math.sin(u * Math.PI) * S * (0.4 + rnd(e.seed, k + 330) * 0.5);
            const x = cl.cx + Math.cos(ang) * d, y = cl.cy + Math.sin(ang) * d, sz = S * (0.05 + rnd(e.seed, k + 340) * 0.06);
            c.fillStyle = `rgba(0,0,0,${0.4 * (1 - u)})`; c.beginPath(); c.ellipse(x, y, sz, sz * 0.45, 0, 0, 7); c.fill();
            c.save(); c.translate(x, y - h); c.rotate(a * 9 + k); c.fillStyle = k % 3 ? '#5a4f4a' : '#7a6a5c';
            c.beginPath(); c.moveTo(-sz, -sz * 0.6); c.lineTo(sz * 0.8, -sz); c.lineTo(sz, sz * 0.5); c.lineTo(-sz * 0.4, sz); c.fill(); c.restore();
          }
          for (let k = 0; k < 14; k++) {                                                                      // пыль катится кольцом, потом дымка
            const ang = (k / 14) * 6.28 + rnd(e.seed, k + 400) * 0.4, u = clamp((a - 0.1) / 2.4);
            if (u <= 0 || u >= 1) continue;
            const d = R * (0.4 + 1.1 * ease(u));
            blob(c, cl.cx + Math.cos(ang) * d, cl.cy + Math.sin(ang) * d * 0.8 - u * S * 0.2, S * (0.25 + u * 0.4), 'rgba(170,155,140,1)', 0.6 * (1 - u));
          }
          for (let k = 0; k < 8; k++) {                                                                       // столб дыма с ветром
            const per = 1.9 + rnd(e.seed, k + 500), u = ((a + rnd(e.seed, k + 510) * per) % per) / per;
            const fade = clamp(1 - (a - 3) / 4);
            if (a < 0.3 || fade <= 0) continue;
            blob(c, cl.cx + u * S * wind(t, cl.cx / W) * 0.8, cl.cy - u * S * 1.5, S * (0.18 + u * 0.4), u < 0.25 ? 'rgba(90,70,60,1)' : 'rgba(130,125,130,1)', 0.7 * Math.sin(u * Math.PI) * fade);
          }
          done = a > 9.2; break;
        }
        case 'strelka': {
          c.globalCompositeOperation = 'lighter';
          for (let k = 0; k < 5; k++) { // вспышки выстрелов в разных точках клетки
            const tt = k * 0.11, u = (a - tt) / 0.08;
            if (u > 0 && u < 1) blob(c, cl.x + cl.w * (0.2 + rnd(e.seed, k) * 0.6), cl.y + cl.h * (0.25 + rnd(e.seed, k + 5) * 0.5), S * 0.35, 'rgba(255,220,140,1)', 1 - u);
          }
          for (let k = 0; k < 16; k++) {
            const ang = rnd(e.seed, k + 20) * 6.28, u = clamp(a / 0.5);
            blob(c, cl.cx + Math.cos(ang) * S * 0.8 * ease(u), cl.cy + Math.sin(ang) * S * 0.8 * ease(u), S * 0.05, 'rgba(255,190,90,1)', 1 - u);
          }
          if (e.win) ring(c, cl.cx, cl.cy, S * 1.1, a - 0.5, 0.6, 'rgba(255,214,102,A)');
          c.globalCompositeOperation = 'source-over';
          for (let k = 0; k < 7; k++) { // гильзы остаются на клетке
            const x = cl.x + cl.w * (0.15 + rnd(e.seed, k + 40) * 0.7), y = cl.y + cl.h * (0.55 + rnd(e.seed, k + 50) * 0.35);
            const u = clamp(a / 0.35), fade = clamp(1 - (a - 4) / 2);
            c.save(); c.translate(x, y - Math.sin(u * Math.PI) * S * 0.15); c.rotate(rnd(e.seed, k) * 3 + a * (u < 1 ? 12 : 0));
            c.fillStyle = `rgba(214,170,70,${fade})`; c.fillRect(-S * 0.025, -S * 0.01, S * 0.05, S * 0.02); c.restore();
          }
          for (let k = 0; k < 6; k++) { // пороховой дым
            const u = clamp((a - 0.1) / 3.5);
            if (u <= 0 || u >= 1) continue;
            blob(c, cl.cx + (rnd(e.seed, k + 60) - 0.5) * S * 0.8 + u * S * wind(t, 0.5) * 0.5, cl.cy - u * S * 0.6, S * (0.22 + u * 0.35), 'rgba(195,190,195,1)', 0.6 * (1 - u));
          }
          done = a > 6; break;
        }
        case 'jail': {
          const u = a / 2.4;
          c.fillStyle = `rgba(0,0,0,${0.5 * Math.sin(clamp(u) * Math.PI)})`;
          for (let k = 1; k < 6; k++) c.fillRect(cl.x + (cl.w * k) / 6 - S * 0.02, cl.y, S * 0.04, cl.h);
          c.globalCompositeOperation = 'lighter';
          blob(c, cl.cx, cl.y + cl.h * 0.1, S * 0.9, 'rgba(160,190,255,1)', 0.35 * Math.sin(clamp(u) * Math.PI));
          c.globalCompositeOperation = 'source-over';
          done = a > 2.4; break;
        }
        case 'police': {
          c.globalCompositeOperation = 'lighter';
          const ph = Math.sin(a * 14) > 0, f = clamp(1 - (a - 1.8) / 0.6);
          blob(c, cl.cx, cl.cy, S * 1.6, ph ? 'rgba(255,50,70,1)' : 'rgba(50,110,255,1)', 0.55 * f);
          c.globalCompositeOperation = 'source-over';
          done = a > 2.4; break;
        }
        case 'ash': {
          for (let k = 0; k < 10; k++) {
            const u = clamp((a - rnd(e.seed, k) * 0.6) / 2.6);
            if (u <= 0 || u >= 1) continue;
            blob(c, cl.x + cl.w * rnd(e.seed, k + 10) + u * S * 0.4 * wind(t, 0.3), cl.y + cl.h * (0.8 - u * 0.9), S * 0.06, 'rgba(90,86,90,1)', 0.7 * (1 - u));
          }
          done = a > 3.3; break;
        }
        case 'glok': { // свет гаснет, луч прожектора находит игрока
          const tk = tokEl(e.pid), p = tk ? (() => { const r = tk.getBoundingClientRect(); return screenToBoard(r.left + r.width / 2, r.top + r.height / 2); })() : { x: W / 2, y: H / 2 };
          const inA = clamp(a / 0.2), outA = clamp(1 - (a - 2.6) / 0.6), dark = 0.62 * inA * outA;
          const r = lerp(W * 0.9, W * 0.1, ease((a - 0.15) / 0.7));
          const g = c.createRadialGradient(p.x, p.y, r * 0.55, p.x, p.y, r);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${dark})`);
          c.fillStyle = g; c.fillRect(0, 0, W, H);
          c.fillStyle = `rgba(0,0,0,${dark})`; c.beginPath(); c.rect(0, 0, W, H); c.arc(p.x, p.y, r, 0, 7, true); c.fill('evenodd');
          c.globalCompositeOperation = 'lighter'; blob(c, p.x, p.y, r * 0.8, 'rgba(255,240,200,1)', 0.18 * inA * outA); c.globalCompositeOperation = 'source-over';
          done = a > 3.3; break;
        }
        case 'patrol': { // огоньки патрульной машины едут по раме
          const u = a / 6, side = e.side;
          if (u > 1) { done = true; break; }
          const s = e.dir > 0 ? u : 1 - u, m = W * 0.012;
          const x = side === 0 || side === 2 ? s * W : side === 1 ? W - m : m, y = side === 1 || side === 3 ? s * H : side === 0 ? m : H - m;
          c.globalCompositeOperation = 'lighter';
          const ph = Math.sin(a * 16) > 0, f = Math.sin(u * Math.PI);
          blob(c, x, y, W * 0.12, ph ? 'rgba(255,50,70,1)' : 'rgba(50,110,255,1)', 0.35 * f);
          c.globalCompositeOperation = 'source-over';
          break;
        }
        default: done = true;
      }
      if (done) ev.splice(i, 1);
    }
  }
  // деньги и монеты летят по дуге (экранные координаты, над всем)
  function noteShape(c, x, y, s, rot, green) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = green ? '#3fae6a' : '#e6b84a'; c.strokeStyle = green ? '#1f5e37' : '#8a5f10'; c.lineWidth = Math.max(1, s * 0.08);
    if (green) { c.fillRect(-s, -s * 0.5, s * 2, s); c.strokeRect(-s, -s * 0.5, s * 2, s); c.fillStyle = '#bff2cf'; c.fillRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6); }
    else { c.beginPath(); c.arc(0, 0, s * 0.7, 0, 7); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,220,.7)'; c.beginPath(); c.arc(-s * 0.2, -s * 0.2, s * 0.22, 0, 7); c.fill(); }
    c.restore();
  }
  function drawSky(c, t) {
    for (let i = skyEv.length - 1; i >= 0; i--) {
      const e = skyEv[i], a = t - e.t;
      if (a < 0) continue;
      const A = typeof e.from === 'function' ? e.from() : e.from, B = typeof e.to === 'function' ? e.to() : e.to;
      if (!A || !B) { skyEv.splice(i, 1); continue; }
      const n = e.n || 6, life = 0.75;
      let all = true;
      for (let k = 0; k < n; k++) {
        const u = (a - k * 0.06) / life;
        if (u < 0) { all = false; continue; }
        if (u >= 1) { if (!e.hit) { e.hit = true; if (e.onHit) e.onHit(); } continue; }
        all = false;
        const j = (rnd(e.seed, k) - 0.5) * 40, eu = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        const x = lerp(A.x + j * 0.4, B.x, eu), y = lerp(A.y, B.y, eu) - Math.sin(u * Math.PI) * (60 + Math.abs(j));
        noteShape(c, x, y, e.size || 7, (rnd(e.seed, k + 7) - 0.5) * 3 + u * (e.type === 'coins' ? 0 : 6), e.type === 'notes');
      }
      if (all) skyEv.splice(i, 1);
    }
  }

  // ---------- главный цикл ----------
  let frames = 0, fpsT = 0, fps = 60;
  function loop() {
    cancelAnimationFrame(raf);
    if (!alive()) { detach(); return; }
    if (document.hidden) return;
    raf = requestAnimationFrame(loop);
    const t = now(), st = getSt && getSt();
    frames++; if (t - fpsT > 1) { fps = frames / (t - fpsT); frames = 0; fpsT = t; }
    const br = cv.getBoundingClientRect();
    if (Math.abs(br.width - W) > 1 || Math.abs(br.height - H) > 1 || SW !== innerWidth || SH !== innerHeight) measure();
    cx.clearRect(0, 0, W, H);
    if (!reduce) { drawAmbient(cx, t, st); updPigeons(t); drawPigeons(cx, t); }
    drawEvents(cx, t, st);
    sx.clearRect(0, 0, SW, SH);
    drawSky(sx, t);
  }

  // ---------- что изменилось в партии → какие эффекты ----------
  // Вызывается из updateGame. moveMs — сколько ещё едет фишка (эффекты на клетке ждут, пока она доедет).
  function update(st, moveMs = 0) {
    if (!alive() || !st) return;
    const cur = { props: JSON.parse(JSON.stringify(st.props || {})), money: Object.fromEntries(st.players.map((p) => [p.id, p.money])), bank: Object.fromEntries(st.players.map((p) => [p.id, !!p.bankrupt])), log: st.logs.length ? st.logs[st.logs.length - 1].id : 0 };
    const prev = snap; snap = cur;
    if (!prev) return;
    const col = (pid) => { const p = st.players.find((x) => x.id === pid); return p ? p.color : '#f5c542'; };
    const boughtBy = {};
    for (const [id, v] of Object.entries(cur.props)) {
      const o = prev.props[id];
      if (!o || o.owner !== v.owner) { fire('buy', { cell: +id, color: col(v.owner), lvl: v.level, delay: moveMs }); boughtBy[v.owner] = +id; scare(+id, now() + moveMs / 1000, true); }
      else if (v.level > o.level) fire('up', { cell: +id, color: col(v.owner), lvl: v.level, delay: moveMs });
    }
    for (const [id, o] of Object.entries(prev.props)) if (!cur.props[id] && cur.bank[o.owner]) fire('ash', { cell: +id, delay: moveMs });
    // переводы денег: пара «минус у одного = плюс у другого» — пачки летят от фишки к фишке
    const d = Object.keys(cur.money).map((pid) => ({ pid, v: cur.money[pid] - (prev.money[pid] != null ? prev.money[pid] : cur.money[pid]) })).filter((x) => x.v);
    const pos = d.filter((x) => x.v > 0), neg = d.filter((x) => x.v < 0);
    const used = new Set();
    const bump = (pid) => () => { const m = cardMoney(pid); if (m) { m.classList.remove('bfx-bump'); void m.offsetWidth; m.classList.add('bfx-bump'); } };
    const count = (v) => Math.max(3, Math.min(12, Math.round(Math.abs(v) / 25)));
    for (const n of neg) {
      const p = pos.find((x) => !used.has(x) && x.v === -n.v);
      if (p) {
        used.add(p);
        skyEv.push({ type: 'notes', t: now() + moveMs / 1000 + 0.15, seed: seedN++, n: count(n.v), from: () => elCenter(tokEl(n.pid)) || elCenter(cardMoney(n.pid)), to: () => elCenter(tokEl(p.pid)) || elCenter(cardMoney(p.pid)), onHit: bump(p.pid) });
      } else if (boughtBy[n.pid] != null) {
        const cell = boughtBy[n.pid];
        skyEv.push({ type: 'notes', t: now() + moveMs / 1000, seed: seedN++, n: count(n.v), from: () => elCenter(cardMoney(n.pid)), to: () => { const c = cellAt(cell); return c && boardToScreen(c.cx, c.cy); } });
      } else {
        skyEv.push({ type: 'notes', t: now() + moveMs / 1000, seed: seedN++, n: count(n.v), from: () => elCenter(cardMoney(n.pid)), to: () => center && boardToScreen(center.x + center.w / 2, center.y + center.h / 2) });
      }
    }
    for (const p of pos) {
      if (used.has(p)) continue;
      skyEv.push({ type: 'coins', t: now() + moveMs / 1000 + 0.1, seed: seedN++, n: count(p.v), size: 6, from: () => { const tk = elCenter(tokEl(p.pid)); return tk || (center && boardToScreen(center.x + center.w / 2, center.y + center.h / 2)); }, to: () => elCenter(cardMoney(p.pid)), onHit: bump(p.pid) });
    }
    // события из ленты
    for (const l of st.logs) {
      if (l.id <= prev.log) continue;
      if (l.kind === 'jail') fire('jail', { cell: 5, delay: moveMs });
      else if (l.kind === 'police') fire('police', { cell: 15, delay: moveMs });
      else if (l.kind === 'bankrupt') { const p = st.players.find((x) => x.id === l.pid); if (p) fire('ash', { cell: p.pos, delay: moveMs }); }
    }
  }

  return {
    attach, detach, fire, step, update, measure,
    // для автопроверок
    debug: () => ({ fps: Math.round(fps), events: ev.length + skyEv.length, emitted: emitted.slice(), cells: cells.map((c) => c && { id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }), pigeons: pigeons.map((p) => p.st) }),
    _now: now,
  };
})();
