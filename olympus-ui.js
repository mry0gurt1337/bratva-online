// Bratva Olympus — клиент: анимация каскадов, сфер-множителей и бонуса. Результат приходит с сервера.
window.Olympus = (() => {
  const COLS = 6, ROWS = 5;
  const IMG = { crown: 'art-crown.webp', chain: 'art-gift-chain.webp', merin: 'art-gift-merin.webp', pidjak: 'art-gift-pidjak.webp', konyak: 'art-gift-konyak.webp', pager: 'art-gift-pager.webp', S: 'art-pack-p330.webp' };
  const LET = {};
  // Младшие символы — собственные гранёные камни в золотой оправе (своя графика, не копия чужих слотов)
  const GEM = {
    konyak: { c: ['#d1fae5', '#10b981', '#064e3b'], shape: 'octa' },   // изумруд, ступенчатая огранка
    pager:  { c: ['#ffe4e6', '#e11d48', '#4c0519'], shape: 'oval' },   // рубин, овал
    t:      { c: ['#e0f2fe', '#0ea5e9', '#0c4a6e'], shape: 'marq' },   // сапфир, маркиза
    k:      { c: ['#fef9c3', '#eab308', '#713f12'], shape: 'heart' },  // цитрин, сердце
    d:      { c: ['#f3e8ff', '#a855f7', '#3b0764'], shape: 'round' },  // аметист, круг
  };
  function gem(k) {
    const g = GEM[k], [l, m, d] = g.c, id = 'g' + k;
    const defs = `<defs><linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l}"/><stop offset=".45" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></linearGradient>
      <linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#d9a237"/><stop offset="1" stop-color="#7a4d0b"/></linearGradient></defs>`;
    const F = (pts, o) => `<polygon points="${pts}" fill="${o}"/>`;
    let body = '';
    if (g.shape === 'octa') body = `<polygon points="30,8 70,8 92,30 92,70 70,92 30,92 8,70 8,30" fill="url(#${id}r)"/><polygon points="33,15 67,15 85,33 85,67 67,85 33,85 15,67 15,33" fill="url(#${id}a)"/>`
      + F('33,15 67,15 58,30 42,30', 'rgba(255,255,255,.45)') + F('15,33 30,42 30,58 15,67', 'rgba(255,255,255,.18)') + F('85,33 70,42 70,58 85,67', 'rgba(0,0,0,.25)') + F('33,85 67,85 58,70 42,70', 'rgba(0,0,0,.3)')
      + `<rect x="30" y="30" width="40" height="40" fill="url(#${id}a)" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>` + F('30,30 70,30 58,42 42,42', 'rgba(255,255,255,.3)');
    if (g.shape === 'oval') body = `<ellipse cx="50" cy="50" rx="34" ry="44" fill="url(#${id}r)"/><ellipse cx="50" cy="50" rx="28" ry="38" fill="url(#${id}a)"/>`
      + F('50,12 66,30 50,40 34,30', 'rgba(255,255,255,.4)') + F('34,30 50,40 50,60 26,50', 'rgba(255,255,255,.15)') + F('66,30 74,50 50,60 50,40', 'rgba(0,0,0,.18)') + F('26,50 50,60 50,88 34,72', 'rgba(0,0,0,.22)') + F('74,50 66,72 50,88 50,60', 'rgba(0,0,0,.35)');
    if (g.shape === 'marq') body = `<path d="M50 4 Q90 50 50 96 Q10 50 50 4Z" fill="url(#${id}r)"/><path d="M50 12 Q83 50 50 88 Q17 50 50 12Z" fill="url(#${id}a)"/>`
      + F('50,12 62,36 50,50 38,36', 'rgba(255,255,255,.45)') + F('38,36 50,50 38,64 24,50', 'rgba(255,255,255,.15)') + F('62,36 76,50 62,64 50,50', 'rgba(0,0,0,.2)') + F('38,64 50,50 62,64 50,88', 'rgba(0,0,0,.32)');
    if (g.shape === 'heart') body = `<path d="M50 92 L10 46 A22 22 0 0 1 50 22 A22 22 0 0 1 90 46 Z" fill="url(#${id}r)"/><path d="M50 84 L17 46 A16 16 0 0 1 50 30 A16 16 0 0 1 83 46 Z" fill="url(#${id}a)"/>`
      + F('50,30 36,26 22,36 34,46', 'rgba(255,255,255,.45)') + F('50,30 64,26 78,36 66,46', 'rgba(255,255,255,.2)') + F('34,46 50,56 50,84 17,46', 'rgba(0,0,0,.15)') + F('66,46 83,46 50,84 50,56', 'rgba(0,0,0,.32)') + F('34,46 50,30 66,46 50,56', 'rgba(255,255,255,.12)');
    if (g.shape === 'round') body = `<circle cx="50" cy="50" r="44" fill="url(#${id}r)"/><circle cx="50" cy="50" r="37" fill="url(#${id}a)"/>`
      + Array.from({ length: 8 }, (_, i) => { const a = (i * 45 * Math.PI) / 180, b = ((i + 1) * 45 * Math.PI) / 180, P = (r, t) => `${(50 + r * Math.cos(t)).toFixed(1)},${(50 + r * Math.sin(t)).toFixed(1)}`; return F(`${P(37, a)} ${P(37, b)} ${P(18, (a + b) / 2)}`, i < 3 ? 'rgba(0,0,0,.3)' : i > 4 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.12)'); }).join('')
      + `<polygon points="${Array.from({ length: 8 }, (_, i) => { const t = ((i * 45 + 22.5) * Math.PI) / 180; return `${(50 + 18 * Math.cos(t)).toFixed(1)},${(50 + 18 * Math.sin(t)).toFixed(1)}`; }).join(' ')}" fill="url(#${id}a)" stroke="rgba(255,255,255,.4)" stroke-width="1"/>`;
    return `<svg class="oy-gem" viewBox="0 0 100 100">${defs}${body}<ellipse cx="38" cy="26" rx="9" ry="4" fill="rgba(255,255,255,.65)" transform="rotate(-30 38 26)"/></svg>`;
  }
  const NAMES = { crown: 'Корона', chain: 'Цепь', merin: 'Мерин', pidjak: 'Пиджак', konyak: 'Изумруд', pager: 'Рубин', t: 'Сапфир', k: 'Цитрин', d: 'Аметист', S: 'Общак' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = () => window.SFX || { play() {}, vibe() {} };
  const fmt = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const multCls = (v) => (v >= 100 ? 'm-red' : v >= 20 ? 'm-purple' : v >= 8 ? 'm-blue' : 'm-green');

  // Сфера Глока: стеклянный шар с молнией внутри и кольцом-орбитой. Цвет — по силе множителя.
  const ORB_C = { 'm-green': ['#d1fae5', '#10b981', '#022c22'], 'm-blue': ['#dbeafe', '#3b82f6', '#0b1d4d'], 'm-purple': ['#f3e8ff', '#a855f7', '#2e0a4f'], 'm-red': ['#ffe4e6', '#f43f5e', '#4c0519'] };
  const ORB_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${Object.entries(ORB_C).map(([k, [l, m, d]]) => `
    <radialGradient id="og-${k}" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="${l}"/><stop offset=".35" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></radialGradient>`).join('')}
    <radialGradient id="og-shine" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs></svg>`;
  function orbHTML(v) {
    const c = multCls(v);
    return `<span class="oy-orb2 ${c}"><svg viewBox="0 0 100 100" class="oy-orb-svg">
      <ellipse class="oy-orbit" cx="50" cy="50" rx="47" ry="16" fill="none" stroke="${ORB_C[c][0]}" stroke-width="2.2" stroke-dasharray="6 9" opacity=".75"/>
      <circle cx="50" cy="50" r="36" fill="url(#og-${c})"/>
      <path class="oy-bolt-in" d="M56 18 L38 52 L51 52 L42 82 L64 44 L51 44 Z" fill="#fff9d6" opacity=".85"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6"/>
      <ellipse cx="38" cy="32" rx="13" ry="8" fill="url(#og-shine)" transform="rotate(-28 38 32)"/></svg><b>×${v}</b></span>`;
  }
  function sym(s) {
    if (s[0] === 'M') return orbHTML(+s.slice(1));
    if (GEM[s]) return gem(s);
    return `<img class="oy-img ${s === 'S' ? 'oy-scat' : ''}" src="${IMG[s]}" alt="" draggable="false">`;
  }

  // Каркас автомата. Возвращает объект для анимации.
  function mount(host, opts = {}) {
    host.innerHTML = `${ORB_DEFS}<div class="oy ${opts.compact ? 'compact' : ''}">
      <div class="oy-top"><div class="oy-glok"><span class="oy-glok-pic">${opts.glok || ''}</span><i class="oy-bolt"></i></div>
        <div class="oy-title"><b>BRATVA</b><span>OLYMPUS</span></div>
        <div class="oy-acc" hidden><small>множитель</small><b>×0</b></div></div>
      <div class="oy-fs" hidden><span>Бесплатные спины</span><b>0</b></div>
      <div class="oy-frame"><div class="oy-grid"></div><div class="oy-tumble" hidden></div></div>
      <div class="oy-winline"><span class="oy-msg">${opts.msg || 'Удачи, братва'}</span><b class="oy-win"></b></div>
    </div>`;
    const v = { root: host.querySelector('.oy'), grid: host.querySelector('.oy-grid'), msg: host.querySelector('.oy-msg'), win: host.querySelector('.oy-win'),
      acc: host.querySelector('.oy-acc'), fs: host.querySelector('.oy-fs'), tumble: host.querySelector('.oy-tumble'), glok: host.querySelector('.oy-glok'), cells: [] };
    // стартовое поле — просто красиво
    const demo = Array.from({ length: COLS * ROWS }, (_, i) => ['crown', 'chain', 'merin', 'pidjak', 'konyak', 'pager', 't', 'k', 'd'][(i * 7 + (i % 5) * 3) % 9]);
    draw(v, demo, null);
    return v;
  }
  // Рисуем поле. from[i] — с какой высоты (в клетках) падает символ i; null — без анимации.
  // tease — номер столбца, после которого остальные падают медленно (выпал 3-й Общак)
  function draw(v, grid, from, speed = 1, tease = -1) {
    const extra = (c) => (tease >= 0 && c > tease ? 520 * (c - tease) : 0);
    v.grid.innerHTML = grid.map((s, i) => {
      const c = Math.floor(i / ROWS), r = i % ROWS;
      const f = from ? from[i] : 0;
      return `<div class="oy-cell ${f ? 'drop' : ''} ${tease >= 0 && c > tease ? 'slow' : ''}" data-i="${i}" style="grid-column:${c + 1};grid-row:${r + 1};--from:${f}; --d:${((c * 70 + (ROWS - r) * 22) / speed + extra(c)).toFixed(0)}ms; --t:${((tease >= 0 && c > tease ? 620 : 400) / speed).toFixed(0)}ms">${sym(s)}</div>`;
    }).join('') + (tease >= 0 ? Array.from({ length: COLS - tease - 1 }, (_, k) => `<i class="oy-colglow" style="grid-column:${tease + k + 2};grid-row:1 / ${ROWS + 1};--d:${(((tease + k + 1) * 70) / speed + extra(tease + k + 1) - 300).toFixed(0)}ms"></i>`).join('') : '');
    v.cells = [...v.grid.querySelectorAll('.oy-cell')];
    return tease >= 0 ? extra(COLS - 1) : 0;
  }
  function teaseCol(grid) { // столбец, где появился 3-й Общак (если всего их 3+, а 4-й ещё может выпасть)
    let n = 0;
    for (let c = 0; c < COLS; c++) { for (let r = 0; r < ROWS; r++) if (grid[c * ROWS + r] === 'S') n++; if (n >= 3) return c < COLS - 1 ? c : -1; }
    return -1;
  }
  const rectIn = (el, host) => { const r = el.getBoundingClientRect(), h = host.getBoundingClientRect(); return { x: r.left - h.left + r.width / 2, y: r.top - h.top + r.height / 2, w: r.width }; };
  // фишка с суммой над группой выигравших символов, потом летит в счётчик выигрыша
  function chip(v, cells, text, big) {
    const host = v.root, pts = cells.map((el) => rectIn(el, host));
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const c = document.createElement('div'); c.className = 'oy-chip' + (big ? ' big' : ''); c.textContent = text;
    c.style.left = x + 'px'; c.style.top = y + 'px';
    host.appendChild(c);
    const t = rectIn(v.win, host);
    setTimeout(() => { c.classList.add('fly'); c.style.transform = `translate(calc(-50% + ${t.x - x}px), calc(-50% + ${t.y - y}px)) scale(.5)`; }, 520);
    setTimeout(() => c.remove(), 1100);
  }
  // сфера отрывается от поля и летит в цель (счётчик множителя или выигрыша)
  function flyOrb(v, el, v2, target) {
    return new Promise((ok) => {
      const host = v.root, a = rectIn(el, host), b = rectIn(target, host);
      const f = document.createElement('div'); f.className = 'oy-flyorb'; f.innerHTML = orbHTML(v2);
      f.style.cssText = `left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.w}px`;
      host.appendChild(f);
      el.classList.add('orb-gone');
      requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transform = `translate(-50%,-50%) translate(${b.x - a.x}px, ${b.y - a.y}px) scale(.45)`; f.style.opacity = '.2'; }));
      setTimeout(() => { f.remove(); ok(); }, 560);
    });
  }
  function stamp(v, target, text) {
    const host = v.root, p = rectIn(target, host), st = document.createElement('div');
    st.className = 'oy-stamp'; st.textContent = text; st.style.left = p.x + 'px'; st.style.top = p.y - Math.max(26, p.w * 0.12) + 'px'; // над счётчиком, не на цифрах
    host.appendChild(st); setTimeout(() => st.remove(), 900);
  }
  // Высоты падения для первого поля: всё сверху
  const allFrom = () => Array.from({ length: COLS * ROWS }, () => ROWS + 1);
  // Высоты для каскада: выжившие сползают, новые — сверху
  function cascadeFrom(prev, step) {
    const from = [];
    for (let c = 0; c < COLS; c++) {
      const keep = [];
      for (let r = 0; r < ROWS; r++) { const i = c * ROWS + r; if (!step.remove.includes(i)) keep.push(r); }
      const add = ROWS - keep.length;
      for (let r = 0; r < ROWS; r++) from[c * ROWS + r] = r < add ? add + 1 : r - keep[r - add];
    }
    return from;
  }

  // Анимация одного спина (база или бесплатный). Возвращает выигрыш в ставках.
  function sparks(el, n = 10, col) {
    const r = el.getBoundingClientRect(), host = el.closest('.oy-frame'), hr = host.getBoundingClientRect();
    for (let k = 0; k < n; k++) {
      const p = document.createElement('i'); p.className = 'oy-spark';
      const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 50;
      p.style.cssText = `left:${r.left - hr.left + r.width / 2}px;top:${r.top - hr.top + r.height / 2}px;--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;${col ? `background:${col};box-shadow:0 0 6px ${col}` : ''}`;
      host.appendChild(p); setTimeout(() => p.remove(), 700);
    }
  }
  function blast(v, el, big) {
    const host = v.root.querySelector('.oy-frame'), r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const b = document.createElement('div'); b.className = 'oy-blast' + (big ? ' big' : '');
    b.style.left = (r.left - hr.left + r.width / 2) + 'px'; b.style.top = (r.top - hr.top + r.height / 2) + 'px';
    b.innerHTML = '<i class="f"></i><i class="w"></i>' + Array.from({ length: 8 }, (_, k) => `<i class="d" style="--a:${k * 45 + Math.random() * 20}deg;--l:${26 + Math.random() * 30}px"></i>`).join('');
    host.appendChild(b); setTimeout(() => b.remove(), 800);
  }
  function shake(v, big) { const x = v.root; x.classList.remove('shk', 'shk2'); void x.offsetWidth; x.classList.add(big ? 'shk2' : 'shk'); setTimeout(() => x.classList.remove('shk', 'shk2'), 600); }
  function combo(v, n) {
    if (n < 2) return;
    const c = document.createElement('div'); c.className = 'oy-combo c' + Math.min(n, 5);
    c.innerHTML = `<small>каскад</small><b>×${n}</b>`;
    v.root.querySelector('.oy-frame').appendChild(c); setTimeout(() => c.remove(), 1000);
  }
  const LINES = { win: ['Красиво зашло!', 'Вот это я понимаю', 'Делись, бродяга', 'Фартануло!'], big: ['Ну ты даёшь!', 'Общак лопнет!', 'Это беспредел!'], lose: ['Мимо, братва', 'Не твой день', 'Крути ещё', 'Глок всё видит'], mult: ['Держи множитель!', 'От Глока с любовью', 'Умножаю!'] };
  function say(v, kind) {
    const old = v.root.querySelector('.oy-say'); if (old) old.remove();
    const b = document.createElement('div'); b.className = 'oy-say'; const L = LINES[kind]; b.textContent = L[Math.floor(Math.random() * L.length)];
    v.root.querySelector('.oy-top').appendChild(b); setTimeout(() => b.remove(), 2200);
  }
  function fireworks(host, n = 6) {
    for (let k = 0; k < n; k++) setTimeout(() => {
      const f = document.createElement('div'); f.className = 'oy-fw';
      f.style.left = (15 + Math.random() * 70) + '%'; f.style.top = (15 + Math.random() * 45) + '%';
      const col = ['#ffd34d', '#ff4d6d', '#7ef0a8', '#c084fc', '#60a5fa'][k % 5];
      f.innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * (360 / 14)}deg;--c:${col}"></i>`).join('');
      host.appendChild(f); setTimeout(() => f.remove(), 1100);
      S().play('boom', 0.25);
    }, k * 260);
  }
  function countUp(el, from, to, ms) {
    const t0 = performance.now();
    const f = (now) => { const k = Math.min(1, (now - t0) / ms); el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }
  function zapAt(v, el) {
    const host = v.root, p = rectIn(el, host), z = document.createElement('div');
    z.className = 'oy-zap at'; z.style.left = p.x + 'px'; z.style.height = p.y + 30 + 'px';
    z.innerHTML = '<svg viewBox="0 0 100 300" preserveAspectRatio="none"><path d="M60 0 L35 120 L58 120 L30 300 L80 100 L55 100 L75 0Z"/></svg>';
    host.appendChild(z); host.classList.add('oy-flash'); setTimeout(() => { z.remove(); host.classList.remove('oy-flash'); }, 600);
  }
  function lightning(v) {
    const z = document.createElement('div'); z.className = 'oy-zap';
    z.innerHTML = '<svg viewBox="0 0 100 300" preserveAspectRatio="none"><path d="M60 0 L35 120 L58 120 L30 300 L80 100 L55 100 L75 0Z"/></svg>';
    v.root.querySelector('.oy-frame').appendChild(z); v.root.classList.add('oy-flash');
    setTimeout(() => { z.remove(); v.root.classList.remove('oy-flash'); }, 600);
  }
  // Заставка бонуса: Общаки слетаются в центр, Глок, лучи, счётчик спинов набегает до 15
  async function bonusIntro(v, scats, sup) {
    const host = v.root, frame = host.querySelector('.oy-frame'), c = rectIn(frame, host);
    scats.forEach((el, k) => {
      const a = rectIn(el, host), f = document.createElement('div'); f.className = 'oy-flyscat'; f.innerHTML = el.innerHTML;
      f.style.cssText = `left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.w}px`; host.appendChild(f);
      setTimeout(() => { f.style.transform = `translate(-50%,-50%) translate(${c.x - a.x}px, ${c.y - a.y}px) scale(1.6) rotate(${k % 2 ? 20 : -20}deg)`; f.style.opacity = '0'; }, 60 + k * 90);
      setTimeout(() => f.remove(), 900 + k * 90);
    });
    await sleep(700);
    const b = document.createElement('div'); b.className = 'oy-intro' + (sup ? ' super' : '');
    b.innerHTML = `<div class="oy-rays"></div><div class="oy-intro-in"><div class="oy-intro-glok">${v.glok.querySelector('.oy-glok-pic').innerHTML}</div>
      <small>${sup ? 'Бонус «Беспредел»' : 'Общак вскрыт'}</small><b class="oy-intro-n">0</b><span>${sup ? 'спинов · сфера в каждом' : 'бесплатных спинов'}</span><em>множитель копится весь бонус</em></div>`;
    host.appendChild(b);
    S().play('victory'); S().vibe([80, 50, 160]);
    const n = b.querySelector('.oy-intro-n');
    for (let k = 1; k <= 15; k++) { await sleep(55); n.textContent = k; if (k % 3 === 0) S().play('tick', 0.4); }
    n.classList.add('done'); fireworks(b, sup ? 8 : 5);
    await sleep(1500);
    b.classList.add('out'); await sleep(300); b.remove();
  }
  async function banner(v, title, sub, cls = '') {
    const b = document.createElement('div'); b.className = 'oy-banner ' + cls;
    b.innerHTML = `<b>${title}</b>${sub ? `<small>${sub}</small>` : ''}`;
    v.root.querySelector('.oy-frame').appendChild(b);
    await sleep(1500); b.classList.add('out'); await sleep(300); b.remove();
  }
  async function spinAnim(v, s, o) {
    const sp = o.speed || 1, bet = o.bet || 1;
    v.tumble.hidden = true;
    const tc = o.fs ? -1 : teaseCol(s.first);
    const slowMs = draw(v, s.first, allFrom(), sp, tc);
    S().play('dice', 0.4);
    // каждый столбец приземляется со своим стуком
    for (let c = 0; c < COLS; c++) setTimeout(() => { S().play('tick', 0.25); if (c === COLS - 1) shake(v); }, (c * 70) / sp + (tc >= 0 && c > tc ? 520 * (c - tc) : 0) + 380 / sp);
    if (tc >= 0) { // интрига: Общаки уже на поле светятся, остальные столбцы падают медленно
      setTimeout(() => { v.root.classList.add('tease'); v.cells.forEach((el, i) => s.first[i] === 'S' && Math.floor(i / ROWS) <= tc && el.classList.add('tease')); S().play('siren', 0.25); }, ((tc + 1) * 70) / sp + 380 / sp);
    }
    // Общаки и сферы при приземлении вспыхивают
    s.first.forEach((x, i) => {
      if (x !== 'S' && x[0] !== 'M') return;
      const c = Math.floor(i / ROWS), at = (c * 70) / sp + (tc >= 0 && c > tc ? 520 * (c - tc) : 0) + 400 / sp;
      setTimeout(() => { if (v.cells[i]) { v.cells[i].classList.add('land'); sparks(v.cells[i], 10, x === 'S' ? '#7ef0a8' : '#c084fc'); S().play(x === 'S' ? 'card' : 'tick', 0.5); } }, at);
    });
    await sleep(900 / sp + slowMs);
    v.root.classList.remove('tease');
    v.grid.querySelectorAll('.oy-colglow').forEach((g) => g.remove());
    let run = 0;
    let prev = s.first;
    for (const st of s.steps) {
      st.remove.forEach((i) => v.cells[i] && v.cells[i].classList.add('win'));
      // над каждой группой — сколько она принесла
      st.parts.forEach((p) => { const cells = st.remove.filter((i) => prev[i] === p.s).map((i) => v.cells[i]).filter(Boolean); if (cells.length) chip(v, cells, '+' + fmt(Math.round(p.p * bet * 100) / 100), p.p >= 5); });
      run += st.pay;
      v.tumble.hidden = false; v.tumble.innerHTML = `${st.parts.map((p) => `<span>${p.n}× ${NAMES[p.s]}</span>`).join('')}<b>${fmt(st.pay * bet)}</b>`;
      countUp(v.win, (run - st.pay) * bet, run * bet, 500 / sp); v.msg.textContent = st.pay >= 5 ? 'Жирно!' : 'Каскад';
      S().play('cash', 0.6); S().vibe(15);
      await sleep(650 / sp);
      const chain = s.steps.indexOf(st) + 1, bigPay = st.pay >= 5;
      st.remove.forEach((i, n) => { if (v.cells[i]) { v.cells[i].classList.add('pop'); if (sp < 2.2 || n % 3 === 0) blast(v, v.cells[i], bigPay); } });
      S().play(bigPay || chain >= 3 ? 'boom' : 'fight', bigPay ? 0.7 : 0.45); S().vibe(bigPay ? [40, 30, 60] : 25);
      shake(v, bigPay || chain >= 3); combo(v, chain);
      await sleep(260 / sp);
      draw(v, st.grid, cascadeFrom(prev, st), sp);
      S().play('tick', 0.35);
      prev = st.grid;
      await sleep(620 / sp);
    }
    // Удар Глока: поле темнеет, молния бьёт в клетку — там появляется сфера
    if (s.strike && s.strike.length) {
      v.root.classList.add('strike'); v.glok.classList.add('throw'); S().play('glok', 0.8);
      v.msg.textContent = 'УДАР ГЛОКА';
      await sleep(380 / sp);
      for (const m of s.strike) {
        const el = v.cells[m.i]; if (!el) continue;
        zapAt(v, el); S().play('boom', 0.6); S().vibe([30, 20, 80]); shake(v, true);
        el.innerHTML = orbHTML(m.v); el.classList.remove('land'); void el.offsetWidth; el.classList.add('land', 'strike-in');
        blast(v, el, true); sparks(el, 14, '#c084fc');
        await sleep(420 / sp);
      }
      v.glok.classList.remove('throw'); v.root.classList.remove('strike');
    }
    // сферы: каждая летит в счётчик и ставит штамп «×N»
    if (s.win && s.mults.length) {
      v.glok.classList.add('throw'); S().play('glok', 0.7); lightning(v); say(v, 'mult');
      const target = o.fs ? v.acc : v.win;
      let sum = 0;
      for (const m of s.mults) {
        const el = v.cells[m.i]; if (!el) continue;
        el.classList.add('orb-pulse'); await sleep(140 / sp);
        await flyOrb(v, el, m.v, target);
        sum += m.v; stamp(v, target, '×' + m.v); S().play('cash', 0.5); S().vibe(20);
        if (!o.fs) { v.msg.textContent = `×${sum}`; } else { target.classList.remove('up'); void target.offsetWidth; target.classList.add('up'); }
      }
      shake(v, true);
      await sleep(250 / sp);
      v.glok.classList.remove('throw');
      return { win: run, mult: s.multSum };
    }
    return { win: run, mult: 0 };
  }

  async function bigWin(host, x, bet) {
    if (x < 20) return;
    const lvl = x >= 1000 ? ['КОРОЛЬ РАЙОНА', 'legend'] : x >= 250 ? ['ЛЕГЕНДАРНЫЙ ЗАНОС', 'legend'] : x >= 100 ? ['БЕСПРЕДЕЛ', 'epic'] : x >= 50 ? ['ОГРОМНЫЙ ВЫИГРЫШ', 'mega'] : ['КРУПНЫЙ ВЫИГРЫШ', 'big'];
    const el = document.createElement('div');
    el.className = `oy-big ${lvl[1]}`;
    el.innerHTML = `<div class="oy-rays"></div><div class="oy-big-in"><small>×${fmt(x)}</small><b>${lvl[0]}</b><em>0</em></div>`;
    host.appendChild(el);
    S().play('victory'); S().vibe([60, 40, 160]);
    const em = el.querySelector('em'), total = x * bet, t0 = performance.now(), dur = x >= 250 ? 3200 : x >= 100 ? 2500 : 1800;
    await new Promise((ok) => {
      const f = (now) => { const k = Math.min(1, (now - t0) / dur); em.textContent = fmt(Math.round(total * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(f); else ok(); };
      requestAnimationFrame(f);
    });
    if (window.BR && window.BR.coinBurst) window.BR.coinBurst(el, 40);
    fireworks(el, x >= 250 ? 22 : x >= 100 ? 14 : 8);
    await sleep(x >= 250 ? 2600 : 1400);
    el.classList.add('out'); await sleep(300); el.remove();
  }

  // Полная анимация результата сервера.
  async function animate(v, r, o = {}) {
    const bet = o.bet || 1, sp = o.speed || 1;
    v.acc.hidden = true; v.fs.hidden = true; v.win.textContent = ''; v.msg.textContent = 'Крутим…';
    const b = await spinAnim(v, r.base, { speed: sp, bet });
    let shown = b.win;
    if (b.mult) {
      shown = b.win * b.mult;
      v.msg.textContent = `${fmt(b.win * bet)} × ${b.mult}`;
      countUp(v.win, b.win * bet, shown * bet, 900 / sp);
      v.win.classList.remove('pump'); void v.win.offsetWidth; v.win.classList.add('pump');
      S().play('casino-win'); await sleep(1100 / sp);
    }
    if (r.base.scatPay) { shown += r.base.scatPay; v.win.textContent = fmt(shown * bet); }
    if (r.fs) {
      // бонус
      v.root.classList.add('bonus');
      const sc = v.cells.filter((el, i) => r.base.end[i] === 'S'); sc.forEach((el) => el.classList.add('scat-hit'));
      S().play('glok'); S().vibe([100, 60, 100]);
      v.msg.textContent = 'ОБЩАК!';
      if (r.fs.super) v.root.classList.add('super');
      await bonusIntro(v, sc, !!r.fs.super);
      let left = 15, total = shown;
      v.fs.hidden = false; v.acc.hidden = false;
      const fsp = sp * (o.fsSpeed || 1.6);
      for (const s of r.fs.spins) {
        left--; v.fs.querySelector('b').textContent = left;
        const res = await spinAnim(v, s, { speed: fsp, bet });
        v.acc.querySelector('b').textContent = '×' + s.acc;
        total += s.total + (s.scat >= 4 ? 0 : 0);
        v.win.textContent = fmt(total * bet);
        if (s.extra) { left += s.extra; v.fs.querySelector('b').textContent = left; v.msg.textContent = `+${s.extra} спинов`; S().play('casino-win'); await banner(v, `+${s.extra} СПИНОВ`, '', 'fs'); }
        if (res.win && s.acc) { v.msg.textContent = `×${s.acc}`; await sleep(300); }
      }
      v.root.classList.remove('bonus', 'super');
      await banner(v, 'БОНУС ОКОНЧЕН', `выигрыш ${fmt(Math.round(r.fs.total * bet))} · ×${fmt(r.fs.total)}`, 'end');
    }
    v.win.textContent = r.x ? fmt(Math.round(r.x * bet)) : '';
    v.msg.textContent = r.x ? (r.capped ? 'Максимальный выигрыш!' : 'Выигрыш') : 'Мимо. Ещё разок?';
    if (r.x) S().play(r.x >= 5 ? 'casino-win' : 'cash');
    say(v, r.x >= 20 ? 'big' : r.x > 0 ? 'win' : 'lose');
    if (r.x >= 5) { v.win.classList.add('pump'); setTimeout(() => v.win.classList.remove('pump'), 900); }
    if (r.x >= 10) fireworks(v.root, r.x >= 50 ? 10 : 5);
    if (o.bigHost) await bigWin(o.bigHost, r.x, bet);
  }

  // ---------- отдельный режим на «бабки» ----------
  const BETS = [10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2500, 5000, 10000];
  let busy = false, betI = 3, ante = false, auto = 0, bank = null;
  function show() {
    const B = window.BR;
    B.setScreen('olympus');
    const app = document.getElementById('app');
    app.innerHTML = `<section class="screen oy-screen">
      <div class="top-head"><button class="icon-btn" id="oyBack" aria-label="Назад">${B.ic('back')}</button><h2></h2><span class="dk-bank" id="oyBank"><i class="bucks"></i>${bank == null ? '…' : fmt(bank)}</span></div>
      <div id="oyHost"></div>
      <div class="oy-ctl">
        <button class="oy-small" id="oyInfo">${B.ic('book')}<span>Выплаты</span></button>
        <div class="oy-bet"><button id="oyMinus">−</button><div><small>ставка</small><b id="oyBetV"></b></div><button id="oyPlus">+</button></div>
        <button class="oy-spin" id="oySpin" aria-label="Крутить"><i></i></button>
        <button class="oy-small ${ante ? 'on' : ''}" id="oyAnte">${B.ic('bolt')}<span>Ставка+</span></button>
        <button class="oy-small" id="oyAuto">${B.ic('dice')}<span>Авто 10</span></button>
      </div>
      <button class="oy-buy" id="oyBuy"><span>Купить бонус</span><b id="oyBuyV"></b><small>15 спинов сразу · или «Беспредел»</small></button>
      <div class="dk-note oy-note">Играем на зелёные «бабки» — их нельзя купить. Ставка+ (+25%) — бонус выпадает почти втрое чаще. Максимальный выигрыш ×25 000.</div>
    </section>`;
    const v = mount(document.getElementById('oyHost'), { glok: B.avatar({ char: 'glok' }) });
    const BUY = 72, SUPER = 215;
    const upd = () => { document.getElementById('oyBetV').innerHTML = `<i class="bucks"></i>${fmt(BETS[betI] * (ante ? 1.25 : 1))}`; document.getElementById('oyBuyV').innerHTML = `<i class="bucks"></i>${fmt(BETS[betI] * BUY)}`; };
    upd();
    document.getElementById('oyBack').onclick = () => { auto = 0; if (!busy) B.home(); else B.toast('Дождись конца спина'); };
    document.getElementById('oyMinus').onclick = () => { if (!busy && betI > 0) { betI--; upd(); S().play('tick'); } };
    document.getElementById('oyPlus').onclick = () => { if (!busy && betI < BETS.length - 1) { betI++; upd(); S().play('tick'); } };
    document.getElementById('oyAnte').onclick = (e) => { if (busy) return; ante = !ante; e.currentTarget.classList.toggle('on', ante); upd(); };
    document.getElementById('oyInfo').onclick = paytable;
    document.querySelector('.oy-bet div').onclick = () => {
      if (busy) return;
      const m = B.modal(`<div class="oy-bets"><h2>Ставка</h2><p class="hint">На счету ${fmt(bank)} бабок</p>
        <div class="oy-bgrid">${BETS.map((x, i) => `<button data-b="${i}" class="${i === betI ? 'on' : ''}" ${bank != null && x > bank ? 'disabled' : ''}><b>${fmt(x)}</b><small>до ${x * 25000 >= 1e6 ? fmt(x * 25000 / 1e6) + ' млн' : fmt(x * 25000)}</small></button>`).join('')}</div>
        <div class="oy-bq"><button data-q="min">Мин</button><button data-q="half">Средняя</button><button data-q="max">Макс по банку</button></div></div>`);
      m.querySelectorAll('[data-b]').forEach((x) => x.onclick = () => { betI = +x.dataset.b; upd(); S().play('tick'); m.closeModal(); });
      m.querySelectorAll('[data-q]').forEach((x) => x.onclick = () => {
        const q = x.dataset.q, ok = BETS.map((v, i) => [v, i]).filter(([v]) => bank == null || v <= bank);
        if (q === 'min') betI = 0;
        else if (q === 'max') betI = ok.length ? ok[ok.length - 1][1] : 0;
        else { const t = (bank || 0) / 200; betI = ok.reduce((best, [v, i]) => (Math.abs(v - t) < Math.abs(BETS[best] - t) ? i : best), 0); }
        upd(); S().play('tick'); m.closeModal();
      });
    };
    const spinOnce = async (buy = false) => { // buy: false | true | 'super'
      if (busy) return false;
      busy = true; document.getElementById('oySpin').classList.add('busy');
      let d;
      try { d = await B.api('/api/olympus', { bet: BETS[betI], ante, buy }); }
      catch (e) { B.toast(e.message); busy = false; document.getElementById('oySpin').classList.remove('busy'); auto = 0; return false; }
      bank = d.bank - d.win; document.getElementById('oyBank').innerHTML = `<i class="bucks"></i>${fmt(bank)}`;
      await animate(v, d.r, { bet: d.bet, bigHost: document.querySelector('.oy-screen'), speed: auto ? 1.4 : 1 });
      bank = d.bank; const bk = document.getElementById('oyBank'); if (bk) bk.innerHTML = `<i class="bucks"></i>${fmt(bank)}`;
      busy = false; const sb = document.getElementById('oySpin'); if (sb) sb.classList.remove('busy');
      return true;
    };
    document.getElementById('oySpin').onclick = () => spinOnce();
    document.getElementById('oyBuy').onclick = () => {
      if (busy) return;
      const bet = BETS[betI], p1 = bet * BUY, p2 = bet * SUPER;
      const card = (id, title, price, text, cls) => `<button class="oy-bcard ${cls}" data-buy="${id}" ${bank != null && bank < price ? 'disabled' : ''}>
        <span class="oy-bc-orb">${id === 'super' ? orbHTML(100) : sym('S')}</span><b>${title}</b><small>${text}</small><em><i class="bucks"></i>${fmt(price)}</em></button>`;
      const m = B.modal(`<div class="oy-buym"><h2>Купить бонус</h2><p class="hint">Ставка ${fmt(bet)} · на счету ${fmt(bank)} бабок</p>
        <div class="oy-bcards">${card('fs', 'Бонус', p1, '15 бесплатных спинов, множитель копится', '')}${card('super', 'Беспредел', p2, '15 спинов, в каждом гарантирована сфера Глока', 'sup')}</div>
        <p class="hint">Только за бабки. Отдача покупок около 95%.</p></div>`);
      m.querySelectorAll('[data-buy]').forEach((x) => x.onclick = () => { m.closeModal(); spinOnce(x.dataset.buy === 'super' ? 'super' : true); });
    };
    document.getElementById('oyAuto').onclick = async (e) => {
      if (auto) { auto = 0; e.currentTarget.classList.remove('on'); return; }
      auto = 10; e.currentTarget.classList.add('on');
      while (auto > 0 && document.getElementById('oySpin')) { auto--; if (!(await spinOnce())) break; await new Promise((r) => setTimeout(r, 350)); }
      auto = 0; const a = document.getElementById('oyAuto'); if (a) a.classList.remove('on');
    };
    if (bank == null) B.api('/api/me', {}).then((d) => { bank = d.wallet.bucks; const bk = document.getElementById('oyBank'); if (bk) bk.innerHTML = `<i class="bucks"></i>${fmt(bank)}`; }).catch(() => {});
  }
  function paytable() {
    const B = window.BR;
    const P = [['crown', [10, 25, 50]], ['chain', [2.5, 10, 25]], ['merin', [2, 5, 15]], ['pidjak', [1.5, 2, 12]], ['konyak', [1, 1.5, 10]], ['pager', [0.8, 1.2, 8]], ['t', [0.5, 1, 5]], ['k', [0.4, 0.9, 4]], ['d', [0.25, 0.75, 2]]];
    const k = 1.14;
    B.modal(`<div class="rules oy-pay"><h2>Bratva Olympus</h2>
      <p>Поле 6×5 без линий. Выигрыш — 8 и больше одинаковых символов в любом месте. Выигравшие взрываются, сверху падают новые — каскад идёт, пока есть выигрыш.</p>
      <div class="oy-ptab"><div class="h"><span></span><b>8–9</b><b>10–11</b><b>12+</b></div>${P.map(([s, v]) => `<div><span class="pt-s">${sym(s)}</span>${v.map((x) => `<b>×${+(x * k).toFixed(2)}</b>`).join('')}</div>`).join('')}</div>
      <p><b>Сферы Глока</b> ×2…×1000 падают на поле. Если спин выиграл — все сферы складываются и умножают выигрыш.</p>
      <p><b>Удар Глока</b> — если спин выиграл, а сфер нет, Глок иногда сам бросает на поле одну-две сферы.</p>
      <p><b>Общак</b> (пачка денег) — 4 и больше в любом месте: 15 бесплатных спинов. В бонусе множитель копится на весь бонус, 3 Общака — ещё +5 спинов. За 4/5/6 Общаков сразу ×3/×5/×100.</p>
      <p><b>Купить бонус</b> — ×72 от ставки, сразу 15 бесплатных спинов. <b>Беспредел</b> — ×215: те же 15 спинов, но в каждом гарантирована сфера Глока, а крупные сферы падают чаще. Только за бабки.</p><p>Ставка+ стоит на 25% дороже — бонус выпадает почти втрое чаще. Отдача около 95%. Максимум ×25 000.</p></div>`);
  }
  return { mount, animate, show, sym };
})();
