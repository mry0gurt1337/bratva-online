// «Налёт» — мини-игра: ночная трасса, впереди броневик инкассаторов. Догоняешь, таранишь сзади —
// из дверей вылетают мешки, подбираешь их на дороге. Седьмой таран вскрывает двери: мешки дождём.
// Сверху шарит прожектор вертолёта: под ним шкала ментов растёт втрое быстрее. Шкала полная или
// три аварии — приняли, мешки потеряны. Продержался 25 секунд — ушёл с добычей.
// Ведёшь машину пальцем по экрану (вверх-вниз тоже) или стрелками.
window.Heist = (() => {
  const W = 360, H = 640;
  const ROAD_L = 48, ROAD_R = 312, LANES = [92, 180, 268];
  const CAR_W = 34, CAR_H = 64, VAN_W = 50, VAN_H = 98;
  const DUR = 25, BAG_MAX = 24, RAMS_FOR_JACKPOT = 7;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;
  const S0 = () => window.SFX || { play() {}, vibe() {} };

  function start({ onEnd, bag = 15 }) {
    const root = document.createElement('div');
    root.className = 'chase heist';
    root.innerHTML = `
      <canvas></canvas>
      <div class="ch-hud">
        <div class="ch-top"><b>НАЛЁТ</b><span class="hs-bags"><i class="hs-bag"></i><em>0</em><small>× $${bag}</small></span><span class="ch-hp"></span></div>
        <div class="ch-bar"><span>Время</span><i><em class="ch-esc"></em></i></div>
        <div class="ch-bar cops"><span>Менты</span><i><em class="ch-cop"></em></i></div>
        <div class="hs-lit">ЗАСВЕТИЛСЯ</div>
      </div>
      <div class="ch-msg"><b>3</b><small>Тарань броневик сзади — из него вылетают мешки. Не попадай под прожектор вертолёта</small></div>`;
    document.body.appendChild(root);
    const cv = root.querySelector('canvas'), g = cv.getContext('2d');
    const msg = root.querySelector('.ch-msg'), hpEl = root.querySelector('.ch-hp'), bagEl = root.querySelector('.hs-bags em');
    const timeEl = root.querySelector('.ch-esc'), copEl = root.querySelector('.ch-cop'), litEl = root.querySelector('.hs-lit');
    let scale = 1, offX = 0, offY = 0, dpr = 1;
    function fit() {
      dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
      scale = Math.min(innerWidth / W, innerHeight / H) * dpr;
      offX = (cv.width - W * scale) / 2; offY = (cv.height - H * scale) / 2;
    }
    fit(); addEventListener('resize', fit);

    const S = {
      t: 0, run: false, over: false, closed: false, speed: 330, scroll: 0, slow: 0,
      x: 180, y: 520, tx: 180, ty: 520, hp: 3, inv: 0, shake: 0, flash: 0,
      cop: 0.1, lit: false, bags: 0, rams: 0, ramCd: 0, jackpot: false,
      van: { x: 180, y: 150, lane: 1, vy: 0, cd: 2, wob: 0, open: 0, dents: [] },
      heli: { x: 180, y: 300, r: 62 },
      cars: [], drops: [], spikes: [], sparks: [], texts: [], skids: [], cops: [], spawn: 1.2,
    };

    // ---- управление: палец ведёт машину по дороге (по вертикали — в нижних двух третях) ----
    const toXY = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * (cv.width / r.width) - offX) / scale, ((e.clientY - r.top) * (cv.height / r.height) - offY) / scale]; };
    let grab = null;
    const onPtr = (e) => {
      if (S.over) return;
      const [x, y] = toXY(e);
      if (!grab) grab = { x, y, sx: S.tx, sy: S.ty };
      // относительное ведение: палец не закрывает машину
      S.tx = clamp(grab.sx + (x - grab.x) * 1.15, ROAD_L + CAR_W / 2, ROAD_R - CAR_W / 2);
      S.ty = clamp(grab.sy + (y - grab.y) * 1.15, 210, H - 60);
    };
    cv.addEventListener('pointerdown', (e) => { grab = null; onPtr(e); cv.setPointerCapture && cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') onPtr(e); });
    cv.addEventListener('pointerup', () => { grab = null; });
    const keys = {};
    const kd = (e) => { keys[e.key] = true; }, ku = (e) => { keys[e.key] = false; };
    addEventListener('keydown', kd); addEventListener('keyup', ku);

    // ---- эффекты ----
    function sparks(x, y, n, col, up = 1) { for (let k = 0; k < n; k++) S.sparks.push({ x, y, vx: rnd(-160, 160), vy: rnd(-220, 40) * up, life: rnd(0.3, 0.7), col }); }
    function text(x, y, s, col) { S.texts.push({ x, y, s, col, life: 1 }); }
    function dropBag(x, y, power = 1) {
      S.drops.push({ x, y, vx: rnd(-110, 110) * power, vy: rnd(120, 230) * power, rot: rnd(0, 6), vr: rnd(-8, 8), z: 0, vz: rnd(120, 220), got: false });
    }
    function crash(x, y, why) {
      if (S.inv > 0) return;
      S.hp -= 1; S.inv = 1.2; S.shake = 0.5; S.flash = 0.25; S.cop = Math.min(1, S.cop + 0.12); S.speed = Math.max(240, S.speed - 70);
      sparks(x, y, 22, '#ffb020'); S0().play('fight'); S0().vibe([60, 40, 120]);
      if (S.hp <= 0) end(false, why || 'Разбил тачку — приняли');
    }
    function ram() {
      const v = S.van;
      S.rams += 1; S.ramCd = 0.55; S.shake = 0.35; v.vy = -260; v.wob = 1; S.speed = Math.max(260, S.speed - 30);
      v.dents.push({ x: rnd(-VAN_W / 2 + 8, VAN_W / 2 - 8), s: rnd(3, 6) });
      sparks(v.x, v.y + VAN_H / 2, 18, '#ffd34d');
      S0().play('boom', 0.5); S0().vibe(40);
      if (S.rams >= RAMS_FOR_JACKPOT && !S.jackpot) {
        // двери вскрыты: мешки дождём, замедление на мгновение
        S.jackpot = true; v.open = 1; S.slow = 0.7; S.flash = 0.45; S.shake = 0.8;
        for (let k = 0; k < 9; k++) dropBag(v.x + rnd(-14, 14), v.y + VAN_H / 2, 1.4);
        text(v.x, v.y + 70, 'ДВЕРИ НАСТЕЖЬ!', '#ffd34d'); S0().play('casino-win'); S0().vibe([80, 40, 80, 40, 200]);
      } else {
        for (let k = 0; k < (Math.random() < 0.35 ? 2 : 1); k++) dropBag(v.x + rnd(-12, 12), v.y + VAN_H / 2);
        text(v.x, v.y + 70, S.jackpot ? 'ДОБИВАЙ!' : `ТАРАН ${S.rams}/${RAMS_FOR_JACKPOT}`, '#ffe7a8');
        // после третьего тарана броневик начинает бросать шипы
        // шипы летят в соседнюю полосу, мигают предупреждением и только потом становятся опасными
        if (S.rams >= 3 && Math.random() < 0.55) { const l = [0, 1, 2].filter((k) => k !== v.lane); S.spikes.push({ x: LANES[l[Math.floor(Math.random() * l.length)]], y: v.y + VAN_H / 2 + 10, w: 80, arm: 0.7 }); }
      }
    }

    // ---- рисование ----
    function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function glow(x, y, r, col, a) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col.replace('A', a)); gr.addColorStop(1, col.replace('A', 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    function car(x, y, body, o = {}) {
      const w = o.w || CAR_W, h = o.h || CAR_H;
      g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot);
      g.fillStyle = 'rgba(0,0,0,.45)'; rr(-w / 2 + 3, -h / 2 + 6, w, h, 9); g.fill();
      const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0); gr.addColorStop(0, body); gr.addColorStop(0.5, o.hi || '#ffffff33'); gr.addColorStop(1, body);
      g.fillStyle = body; rr(-w / 2, -h / 2, w, h, 9); g.fill();
      g.fillStyle = gr; g.globalAlpha = 0.35; rr(-w / 2, -h / 2, w, h, 9); g.fill(); g.globalAlpha = 1;
      g.fillStyle = '#0b0f18'; rr(-w / 2 + 5, -h / 2 + 12, w - 10, 14, 4); g.fill(); rr(-w / 2 + 5, h / 2 - 20, w - 10, 10, 3); g.fill(); // стёкла
      g.fillStyle = '#ffffff22'; rr(-w / 2 + 6, -h / 2 + 30, w - 12, h - 56, 4); g.fill();                                        // крыша
      if (o.cop) { const ph = Math.sin(S.t * 22) > 0; g.fillStyle = ph ? '#ff2a3d' : '#2a6aff'; rr(-8, -4, 7, 6, 2); g.fill(); g.fillStyle = ph ? '#2a6aff' : '#ff2a3d'; rr(1, -4, 7, 6, 2); g.fill(); }
      g.fillStyle = '#ff3346'; g.fillRect(-w / 2 + 3, h / 2 - 3, 7, 3); g.fillRect(w / 2 - 10, h / 2 - 3, 7, 3);                  // стопы
      g.fillStyle = '#fff6d6'; g.fillRect(-w / 2 + 3, -h / 2, 7, 3); g.fillRect(w / 2 - 10, -h / 2, 7, 3);                        // фары
      g.restore();
    }
    function van() {
      const v = S.van, x = v.x, y = v.y, w = VAN_W, h = VAN_H;
      g.save(); g.translate(x + Math.sin(S.t * 40) * v.wob * 2, y); g.rotate(Math.sin(S.t * 30) * v.wob * 0.04);
      g.fillStyle = 'rgba(0,0,0,.5)'; rr(-w / 2 + 4, -h / 2 + 8, w, h, 7); g.fill();
      g.fillStyle = '#4a5a3c'; rr(-w / 2, -h / 2, w, h, 7); g.fill();                                     // броня
      g.fillStyle = '#3a4830'; rr(-w / 2 + 4, -h / 2 + 28, w - 8, h - 40, 4); g.fill();                    // крыша кузова
      g.strokeStyle = '#2a3422'; g.lineWidth = 2; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(-w / 2 + 8, -h / 2 + 36 + k * 13); g.lineTo(w / 2 - 8, -h / 2 + 36 + k * 13); g.stroke(); }
      g.fillStyle = '#c9b25a'; g.fillRect(-w / 2, -h / 2 + 22, w, 4);                                     // жёлтая полоса
      g.fillStyle = '#0b0f18'; rr(-w / 2 + 6, -h / 2 + 6, w - 12, 12, 3); g.fill();                         // лобовое
      for (const d of v.dents) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(d.x, h / 2 - 6, d.s, 0, 7); g.fill(); }
      // задние двери: открываются после джекпота
      const o = v.open;
      g.fillStyle = '#56684a';
      g.save(); g.translate(-w / 2, h / 2); g.rotate(o * 1.2); g.fillRect(0, -2, w / 2, 5); g.restore();
      g.save(); g.translate(w / 2, h / 2); g.rotate(-o * 1.2); g.fillRect(-w / 2, -2, w / 2, 5); g.restore();
      g.fillStyle = '#ff3346'; g.fillRect(-w / 2 + 2, h / 2 - 4, 8, 4); g.fillRect(w / 2 - 10, h / 2 - 4, 8, 4);
      g.restore();
      // красные стопы светятся на асфальт
      g.globalCompositeOperation = 'lighter'; glow(x, y + h / 2 + 18, 46, 'rgba(255,40,60,A)', 0.28); g.globalCompositeOperation = 'source-over';
    }
    function bagShape(x, y, rot, s = 1) {
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
      g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(2, 8, 11, 5, 0, 0, 7); g.fill();
      g.fillStyle = '#b8a27a'; g.beginPath(); g.moveTo(-10, 8); g.quadraticCurveTo(-13, -6, -5, -9); g.lineTo(5, -9); g.quadraticCurveTo(13, -6, 10, 8); g.closePath(); g.fill();
      g.fillStyle = '#8a7650'; g.fillRect(-6, -12, 12, 4);
      g.fillStyle = '#2f8a52'; g.font = '900 11px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, 0);
      g.restore();
    }
    function draw() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#05040a'; g.fillRect(0, 0, cv.width, cv.height);
      const sh = S.shake > 0 ? S.shake * 9 : 0;
      g.setTransform(scale, 0, 0, scale, offX + rnd(-sh, sh) * dpr, offY + rnd(-sh, sh) * dpr);
      g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
      // обочины и асфальт
      g.fillStyle = '#0d0c12'; g.fillRect(0, 0, W, H);
      const asp = g.createLinearGradient(ROAD_L, 0, ROAD_R, 0); asp.addColorStop(0, '#1a1a20'); asp.addColorStop(0.5, '#23232a'); asp.addColorStop(1, '#1a1a20');
      g.fillStyle = asp; g.fillRect(ROAD_L, 0, ROAD_R - ROAD_L, H);
      // полосы
      const off = S.scroll % 60;
      g.fillStyle = '#d9d2c0aa';
      for (const lx of [136, 224]) for (let y = -60 + off; y < H; y += 60) g.fillRect(lx - 2, y, 4, 30);
      g.fillStyle = '#e8c45a'; g.fillRect(ROAD_L + 4, 0, 3, H); g.fillRect(ROAD_R - 7, 0, 3, H);
      // отбойники и фонари с пятнами света
      const lo = S.scroll % 200;
      g.fillStyle = '#5a5a66'; g.fillRect(ROAD_L - 8, 0, 6, H); g.fillRect(ROAD_R + 2, 0, 6, H);
      g.globalCompositeOperation = 'lighter';
      for (let y = -200 + lo; y < H + 200; y += 200) { glow(ROAD_L + 30, y, 110, 'rgba(255,190,110,A)', 0.22); glow(ROAD_R - 30, y + 100, 110, 'rgba(255,190,110,A)', 0.22); }
      g.globalCompositeOperation = 'source-over';
      for (let y = -200 + lo; y < H + 200; y += 200) { g.fillStyle = '#2a2a33'; g.fillRect(ROAD_L - 18, y - 2, 20, 4); g.fillRect(ROAD_R - 2, y + 98, 20, 4); g.fillStyle = '#fff2c8'; g.beginPath(); g.arc(ROAD_L + 2, y, 3, 0, 7); g.arc(ROAD_R - 2, y + 100, 3, 0, 7); g.fill(); }
      // следы шин
      g.fillStyle = 'rgba(0,0,0,.16)'; S.skids.forEach((s) => g.fillRect(s.x - 1.5, s.y, 3, 9));
      // шипы
      S.spikes.forEach((s) => { if (s.arm > 0) { g.globalAlpha = Math.floor(S.t * 10) % 2 ? 0.9 : 0.35; g.strokeStyle = '#ff3346'; g.lineWidth = 2; g.strokeRect(s.x - s.w / 2 - 4, s.y - 12, s.w + 8, 20); } g.fillStyle = '#3a3a44'; g.fillRect(s.x - s.w / 2, s.y - 4, s.w, 8); g.fillStyle = '#c9ccd6'; for (let k = -s.w / 2 + 4; k < s.w / 2; k += 8) { g.beginPath(); g.moveTo(s.x + k, s.y - 4); g.lineTo(s.x + k + 4, s.y - 10); g.lineTo(s.x + k + 8, s.y - 4); g.fill(); } g.globalAlpha = 1; });
      // мешки на дороге и в полёте
      S.drops.forEach((d) => { if (!d.got) bagShape(d.x, d.y - d.z * 0.4, d.rot, 1 + d.z / 260); });
      // машины
      S.cars.forEach((c) => car(c.x, c.y, c.col, { rot: c.rot }));
      van();
      S.cops.forEach((c) => car(c.x, c.y, '#e8e8ee', { cop: true }));
      // игрок с фарами
      g.globalCompositeOperation = 'lighter';
      const cone = (dx) => { const gr = g.createLinearGradient(S.x, S.y - 30, S.x, S.y - 190); gr.addColorStop(0, 'rgba(255,245,210,.32)'); gr.addColorStop(1, 'rgba(255,245,210,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(S.x + dx, S.y - 30); g.lineTo(S.x + dx * 4 - 34, S.y - 190); g.lineTo(S.x + dx * 4 + 34, S.y - 190); g.closePath(); g.fill(); };
      cone(-10); cone(10);
      g.globalCompositeOperation = 'source-over';
      if (!(S.inv > 0 && Math.floor(S.t * 14) % 2)) car(S.x, S.y, '#14141a', { hi: '#9aa3b555' });
      // прожектор вертолёта и тень вертолёта
      const hl = S.heli;
      g.globalCompositeOperation = 'lighter';
      glow(hl.x, hl.y, hl.r * 1.5, 'rgba(210,230,255,A)', S.lit ? 0.5 : 0.32);
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = S.lit ? 'rgba(255,90,90,.8)' : 'rgba(210,230,255,.35)'; g.lineWidth = 2; g.setLineDash([6, 6]); g.beginPath(); g.arc(hl.x, hl.y, hl.r, 0, 7); g.stroke(); g.setLineDash([]);
      const hx = hl.x * 0.4 + 108, hy = 128;
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(hx, hy, 20, 9, 0, 0, 7); g.fill(); g.fillRect(hx + 14, hy - 2, 30, 4);
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 3; const ra = S.t * 30; g.beginPath(); g.moveTo(hx + Math.cos(ra) * 34, hy + Math.sin(ra) * 12); g.lineTo(hx - Math.cos(ra) * 34, hy - Math.sin(ra) * 12); g.stroke();
      // искры, надписи
      g.globalCompositeOperation = 'lighter';
      S.sparks.forEach((s) => { g.fillStyle = s.col; g.globalAlpha = Math.min(1, s.life * 2); g.fillRect(s.x, s.y, 3, 3); });
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      S.texts.forEach((t) => { g.globalAlpha = Math.min(1, t.life * 1.6); g.font = '400 18px "Dela Gothic One", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#000'; g.fillText(t.s, t.x + 1, t.y + 2); g.fillStyle = t.col; g.fillText(t.s, t.x, t.y); });
      g.globalAlpha = 1;
      // мигалки ментов снизу, когда догоняют
      if (S.cop > 0.45) { g.globalCompositeOperation = 'lighter'; const ph = Math.sin(S.t * 14) > 0; glow(W / 2, H + 40, 260, ph ? 'rgba(255,40,60,A)' : 'rgba(40,100,255,A)', (S.cop - 0.45) * 0.9); g.globalCompositeOperation = 'source-over'; }
      // скорость: линии по краям
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
      for (let k = 0; k < 8; k++) { const y = (S.scroll * 2.2 + k * 97) % H; g.beginPath(); g.moveTo(k % 2 ? 10 : W - 10, y); g.lineTo(k % 2 ? 10 : W - 10, y + 40); g.stroke(); }
      if (S.flash > 0) { g.fillStyle = `rgba(255,240,200,${S.flash})`; g.fillRect(0, 0, W, H); }
      g.restore();
    }

    // ---- логика ----
    function step(dt) {
      S.t += dt;
      if (!S.run) return;
      if (S.slow > 0) { S.slow -= dt; dt *= 0.35; }
      const prog = Math.min(1, S.t / DUR);
      const kx = (keys.ArrowLeft || keys.a ? -1 : 0) + (keys.ArrowRight || keys.d ? 1 : 0), ky = (keys.ArrowUp || keys.w ? -1 : 0) + (keys.ArrowDown || keys.s ? 1 : 0);
      if (kx || ky) { S.tx = clamp(S.tx + kx * 330 * dt, ROAD_L + CAR_W / 2, ROAD_R - CAR_W / 2); S.ty = clamp(S.ty + ky * 330 * dt, 210, H - 60); }
      const px = S.x;
      S.x += (S.tx - S.x) * Math.min(1, dt * 10); S.y += (S.ty - S.y) * Math.min(1, dt * 8);
      if (Math.abs(S.x - px) > 2.5) S.skids.push({ x: S.x - 11, y: S.y + 26 }, { x: S.x + 11, y: S.y + 26 });
      S.speed += (340 + prog * 120 - S.speed) * Math.min(1, dt * 1.2);
      S.scroll += S.speed * dt;
      ['inv', 'shake', 'flash', 'ramCd'].forEach((k) => { S[k] = Math.max(0, S[k] - dt); });
      // броневик: меняет полосы, после таранов злее
      const v = S.van;
      v.cd -= dt; if (v.cd <= 0) { v.lane = [0, 1, 2].filter((l) => l !== v.lane)[Math.floor(Math.random() * 2)]; v.cd = rnd(1.1, 2.4) - Math.min(0.7, S.rams * 0.1); }
      v.x += (LANES[v.lane] - v.x) * Math.min(1, dt * (1.6 + S.rams * 0.2));
      v.vy += (0 - v.vy) * Math.min(1, dt * 3); v.y = clamp(v.y + v.vy * dt + (150 - v.y) * dt * 1.5, 110, 200);
      v.wob = Math.max(0, v.wob - dt * 2.5); if (v.open) v.open = Math.min(1, v.open + dt * 3);
      // прожектор: плавный путь по дороге, с ростом розыска тянется к игроку
      const hl = S.heli, hunt = 0.18 + prog * 0.3;
      const lx = 180 + Math.sin(S.t * 0.83) * 100 + Math.sin(S.t * 1.91) * 30, ly = 380 + Math.sin(S.t * 0.61 + 1) * 140;
      hl.x += ((lx * (1 - hunt) + S.x * hunt) - hl.x) * Math.min(1, dt * 1.4); hl.y += ((ly * (1 - hunt) + S.y * hunt) - hl.y) * Math.min(1, dt * 1.4);
      S.lit = Math.hypot(S.x - hl.x, S.y - hl.y) < hl.r;
      S.cop += dt * (S.lit ? 0.07 : 0.016) - dt * 0.006;
      S.cop = clamp(S.cop, 0.05, 1);
      if (S.lit && Math.random() < dt * 2) S0().play('tick', 0.3);
      if (S.cop >= 1) return end(false, 'Вертолёт навёл ментов — приняли');
      // машины в полосах
      S.spawn -= dt;
      if (S.spawn <= 0) { const free = [0, 1, 2].filter((l) => l !== v.lane), lane = free[Math.floor(Math.random() * free.length)]; S.cars.push({ x: LANES[lane] + rnd(-10, 10), y: -80, v: rnd(120, 200), col: ['#c9c2b8', '#7a1e2a', '#2c4a7a', '#3d5a3a', '#8a6a2a'][Math.floor(Math.random() * 5)], rot: 0, hit: false }); S.spawn = rnd(0.9, 1.6) - prog * 0.4; }
      S.cars.forEach((c) => {
        c.y += (S.speed - c.v) * dt; if (c.hit) { c.rot += dt * 4; c.x += c.vx * dt; }
        // броневик отпихивает машину, которая оказалась у него на пути
        if (!c.hit && overlap(c.x, c.y, CAR_W, CAR_H, v.x, v.y, VAN_W + 4, VAN_H + 10)) { c.hit = true; c.vx = (c.x < v.x ? -1 : 1) * 220; c.v = 30; sparks((c.x + v.x) / 2, c.y, 14, '#ffb020'); v.wob = Math.max(v.wob, 0.6); S0().play('fight', 0.3); }
      });
      S.spikes.forEach((s) => { s.y += S.speed * 0.55 * dt; s.arm = Math.max(0, (s.arm || 0) - dt); });
      S.skids.forEach((s) => { s.y += S.speed * dt; });
      // мешки: летят, падают, кувыркаются, потом лежат на дороге и уезжают назад
      S.drops.forEach((d) => {
        if (d.z > 0 || d.vz > 0) { d.z += d.vz * dt; d.vz -= 700 * dt; if (d.z <= 0) { d.z = 0; d.vz = d.vz < -120 ? -d.vz * 0.35 : 0; d.vx *= 0.6; } }
        d.x = clamp(d.x + d.vx * dt, ROAD_L + 12, ROAD_R - 12); d.vx *= 1 - dt * 1.5;
        d.y += (d.z > 0 ? d.vy * 0.6 : S.speed * 0.5) * dt; d.rot += d.vr * dt * (d.z > 0 ? 1 : 0.2);
      });
      // менты сзади появляются, когда шкала растёт
      if (S.cop > 0.55 && S.cops.length < 1 + Math.floor((S.cop - 0.55) * 6)) S.cops.push({ x: LANES[Math.floor(Math.random() * 3)], y: H + 60 });
      S.cops.forEach((c) => { c.x += (S.x - c.x) * dt * 0.8; c.y += ((S.y + 120 - (S.cop - 0.55) * 160) - c.y) * dt * 0.9; });
      S.sparks.forEach((s) => { s.x += s.vx * dt; s.y += (s.vy + S.speed * 0.5) * dt; s.vy += 500 * dt; s.life -= dt; });
      S.texts.forEach((t) => { t.y -= 40 * dt; t.life -= dt; });
      S.cars = S.cars.filter((c) => c.y < H + 120); S.spikes = S.spikes.filter((s) => s.y < H + 30);
      S.drops = S.drops.filter((d) => !d.got && d.y < H + 30); S.sparks = S.sparks.filter((s) => s.life > 0);
      S.texts = S.texts.filter((t) => t.life > 0); S.skids = S.skids.filter((s) => s.y < H + 10).slice(-240);
      // столкновения
      if (overlap(S.x, S.y, CAR_W - 4, CAR_H, v.x, v.y, VAN_W - 6, VAN_H)) {
        // сзади (машина ниже середины броневика) — таран и отскок; спереди сбоку — авария
        if (S.y > v.y + 6) {
          if (S.ramCd <= 0) ram();
          S.y = Math.max(S.y, v.y + VAN_H / 2 + CAR_H / 2 + 2); S.ty = Math.max(S.ty, S.y + 24);
        } else if (S.ramCd <= 0) { crash(S.x, S.y - 20, 'Влетел в броневик сбоку — приняли'); S.x += (S.x < v.x ? -1 : 1) * 26; S.tx = S.x; }
      }
      S.cars.forEach((c) => { if (!c.hit && overlap(S.x, S.y, CAR_W - 6, CAR_H - 8, c.x, c.y, CAR_W - 4, CAR_H - 6)) { c.hit = true; c.vx = (c.x < S.x ? -1 : 1) * 140; c.v = 60; crash((S.x + c.x) / 2, (S.y + c.y) / 2); } });
      S.spikes.forEach((s) => { if (!s.done && !(s.arm > 0) && Math.abs(s.y - S.y) < 12 && Math.abs(s.x - S.x) < s.w / 2 + CAR_W / 2 - 6) { s.done = true; crash(S.x, S.y, 'Пробил колёса на шипах — приняли'); } });
      S.cops.forEach((c) => { if (overlap(S.x, S.y, CAR_W - 6, CAR_H - 10, c.x, c.y, CAR_W - 6, CAR_H - 10)) crash(S.x, S.y + 20, 'Менты прижали — приняли'); });
      S.drops.forEach((d) => {
        if (!d.got && d.z < 18 && overlap(S.x, S.y, CAR_W + 6, CAR_H, d.x, d.y, 22, 22) && S.bags < BAG_MAX) {
          d.got = true; S.bags += 1; S.cop = Math.max(0.05, S.cop - 0.015);
          text(d.x, d.y - 10, '+$' + bag, '#7ef0a8'); sparks(d.x, d.y, 10, '#7ef0a8'); S0().play('cash', 0.6); S0().vibe(15);
          bagEl.textContent = S.bags; bagEl.parentElement.classList.remove('bump'); void bagEl.offsetWidth; bagEl.parentElement.classList.add('bump');
        }
      });
      // HUD
      timeEl.style.width = (prog * 100).toFixed(1) + '%';
      copEl.style.width = (S.cop * 100).toFixed(1) + '%';
      litEl.classList.toggle('on', S.lit);
      hpEl.innerHTML = '<i></i>'.repeat(Math.max(0, S.hp)) + '<i class="off"></i>'.repeat(3 - Math.max(0, S.hp));
      if (prog >= 1) end(true, `Ушёл с добычей: ${S.bags} ${S.bags % 10 === 1 && S.bags % 100 !== 11 ? 'мешок' : S.bags % 10 >= 2 && S.bags % 10 <= 4 && (S.bags % 100 < 12 || S.bags % 100 > 14) ? 'мешка' : 'мешков'} · $${S.bags * bag}`);
    }

    let last = performance.now(), raf = 0, sirenT = 0;
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      step(dt); draw();
      if (S.run && S.cop > 0.5 && (sirenT -= dt) <= 0) { S0().play('siren', 0.4); sirenT = 3.4; }
      if (!S.closed) raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    hpEl.innerHTML = '<i></i><i></i><i></i>';
    let n = 3;
    const cd = setInterval(() => {
      n -= 1;
      if (n > 0) { msg.querySelector('b').textContent = n; S0().play('tick'); }
      else { clearInterval(cd); msg.classList.add('hide'); S.run = true; S.t = 0; S0().play('turn'); }
    }, 900);

    function end(ok, txt) {
      if (S.over) return;
      S.over = true; S.run = false;
      msg.classList.remove('hide');
      msg.innerHTML = `<b class="${ok ? 'ok' : 'bad'}">${ok ? 'УШЁЛ!' : 'ПРИНЯЛИ'}</b><small>${txt}${!ok && S.bags ? ` · мешки (${S.bags}) достались ментам` : ''}</small>`;
      S0().play(ok ? 'casino-win' : 'jail');
      setTimeout(() => { close(); onEnd && onEnd(ok, ok ? S.bags : 0); }, 2100);
    }
    function close() {
      S.closed = true; cancelAnimationFrame(raf); clearInterval(cd);
      removeEventListener('resize', fit); removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      root.classList.add('out'); setTimeout(() => root.remove(), 300);
    }
    return { abort() { if (!S.over) { S.over = true; close(); } }, _S: S, _ram: ram };
  }
  return { start, BAG_MAX };
})();
