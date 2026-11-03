// «Погоня» — мини-игра с видом сверху. Уходишь от ментов по ночному району:
// ведёшь машину пальцем (или стрелками), объезжаешь машины и баррикады, собираешь нитро и бабки.
// Продержался до конца — ушёл. Три удара или менты догнали — приняли.
window.Chase = (() => {
  const W = 360, H = 640;                 // логические размеры, канвас масштабируется под экран
  const ROAD_L = 62, ROAD_R = 298;        // края дороги
  const CAR_W = 34, CAR_H = 62;
  const CIV = ['#c9c2b8', '#7a1e2a', '#2c4a7a', '#3d5a3a', '#8a6a2a', '#5a5a62', '#e0d6c0'];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function start({ seconds = 22, title = 'ПОГОНЯ', onEnd }) {
    const root = document.createElement('div');
    root.className = 'chase';
    root.innerHTML = `
      <canvas></canvas>
      <div class="ch-hud">
        <div class="ch-top"><b>${title}</b><span class="ch-hp"></span></div>
        <div class="ch-bar"><span>До отрыва</span><i><em class="ch-esc"></em></i></div>
        <div class="ch-bar cops"><span>Менты</span><i><em class="ch-cop"></em></i></div>
      </div>
      <div class="ch-msg"><b>3</b><small>Веди пальцем по экрану — уходи от ментов</small></div>`;
    document.body.appendChild(root);
    const cv = root.querySelector('canvas'), g = cv.getContext('2d');
    const msg = root.querySelector('.ch-msg'), hpEl = root.querySelector('.ch-hp');
    const escEl = root.querySelector('.ch-esc'), copEl = root.querySelector('.ch-cop');
    let scale = 1, offX = 0, offY = 0;
    function fit() {
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
      scale = Math.min(innerWidth / W, innerHeight / H) * dpr;
      offX = (cv.width - W * scale) / 2; offY = (cv.height - H * scale) / 2;
    }
    fit(); addEventListener('resize', fit);

    // ---- состояние ----
    const S = {
      t: 0, run: false, over: false, speed: 260, scroll: 0, x: (ROAD_L + ROAD_R) / 2, tx: (ROAD_L + ROAD_R) / 2,
      hp: 3, cop: 0.18, nitro: 0, inv: 0, shake: 0, cash: 0, spawn: 0.8, pick: 3,
      cars: [], items: [], sparks: [], skids: [], blocks: [],
    };
    // фон: дома по краям
    const houses = [];
    for (let y = -H; y < H * 2; y += rnd(70, 120)) {
      houses.push({ side: 0, y, h: rnd(60, 110), c: rnd(0, 1), win: Math.random() });
      houses.push({ side: 1, y: y + rnd(0, 40), h: rnd(60, 110), c: rnd(0, 1), win: Math.random() });
    }

    // ---- управление ----
    const toX = (clientX) => {
      const r = cv.getBoundingClientRect();
      return ((clientX - r.left) * (cv.width / r.width) - offX) / scale;
    };
    const onPtr = (e) => { if (!S.over) S.tx = Math.max(ROAD_L + CAR_W / 2, Math.min(ROAD_R - CAR_W / 2, toX(e.clientX))); };
    cv.addEventListener('pointerdown', (e) => { onPtr(e); cv.setPointerCapture && cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') onPtr(e); });
    const keys = {};
    const kd = (e) => { keys[e.key] = true; }, ku = (e) => { keys[e.key] = false; };
    addEventListener('keydown', kd); addEventListener('keyup', ku);

    // ---- спавн ----
    function spawnCar() {
      const lane = rnd(ROAD_L + 24, ROAD_R - 24);
      if (S.cars.some((c) => Math.abs(c.y + 80) < 110 && Math.abs(c.x - lane) < 46)) return;
      S.cars.push({ x: lane, y: -80, v: rnd(90, 170), color: CIV[(Math.random() * CIV.length) | 0], w: rnd(30, 36), h: rnd(56, 70), drift: rnd(-12, 12) });
    }
    function spawnBlock() {
      const gap = rnd(ROAD_L + 50, ROAD_R - 50);
      S.blocks.push({ y: -40, gap, gw: 74 });
    }
    function spawnItem() {
      S.items.push({ x: rnd(ROAD_L + 20, ROAD_R - 20), y: -30, kind: Math.random() < 0.45 ? 'nitro' : 'cash' });
    }
    function sparks(x, y, n, col) {
      for (let i = 0; i < n; i++) S.sparks.push({ x, y, vx: rnd(-160, 160), vy: rnd(-200, 60), life: rnd(0.3, 0.7), col: col || (Math.random() < 0.5 ? '#ffd34d' : '#ff8a3d') });
    }
    function hit(x, y) {
      if (S.inv > 0) return;
      S.hp -= 1; S.inv = 1.1; S.shake = 0.45; S.cop = Math.min(1, S.cop + 0.2); S.speed = Math.max(200, S.speed - 60);
      sparks(x, y, 26);
      window.SFX && SFX.play('bad'); window.SFX && SFX.vibe && SFX.vibe([80]);
      if (S.hp <= 0) end(false, 'Разбил тачку — приняли');
    }

    // ---- рисование ----
    function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function car(x, y, w, h, body, opts = {}) {
      g.save(); g.translate(x, y); if (opts.rot) g.rotate(opts.rot);
      // тень
      g.fillStyle = 'rgba(0,0,0,.45)'; rr(-w / 2 + 3, -h / 2 + 5, w, h, 8); g.fill();
      // кузов
      const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
      gr.addColorStop(0, shade(body, -0.35)); gr.addColorStop(0.5, body); gr.addColorStop(1, shade(body, -0.35));
      g.fillStyle = gr; rr(-w / 2, -h / 2, w, h, 8); g.fill();
      // стёкла
      g.fillStyle = 'rgba(20,28,40,.92)';
      rr(-w / 2 + 4, -h / 2 + h * 0.2, w - 8, h * 0.18, 4); g.fill();
      rr(-w / 2 + 5, h * 0.12, w - 10, h * 0.14, 4); g.fill();
      // крыша
      g.fillStyle = shade(body, 0.12); rr(-w / 2 + 6, -h / 2 + h * 0.4, w - 12, h * 0.22, 4); g.fill();
      // фары / стопы
      // все едут вверх: фары спереди (сверху), стопы сзади
      g.fillStyle = '#fff3c4'; g.fillRect(-w / 2 + 3, -h / 2 + 1, 7, 3); g.fillRect(w / 2 - 10, -h / 2 + 1, 7, 3);
      g.fillStyle = '#ff3b3b'; g.fillRect(-w / 2 + 3, h / 2 - 4, 7, 3); g.fillRect(w / 2 - 10, h / 2 - 4, 7, 3);
      if (opts.cop) {
        const on = Math.floor(S.t * 8) % 2;
        g.fillStyle = '#e8e8ee'; g.fillRect(-w / 2 + 3, -4, w - 6, 8);
        g.fillStyle = on ? '#ff2a3d' : '#3a0a10'; g.fillRect(-w / 2 + 6, -h / 2 + h * 0.42, (w - 12) / 2, 5);
        g.fillStyle = on ? '#1a2a5a' : '#2a6aff'; g.fillRect(0, -h / 2 + h * 0.42, (w - 12) / 2, 5);
        g.globalCompositeOperation = 'lighter';
        const lg = g.createRadialGradient(on ? -6 : 6, -h * 0.05, 2, on ? -6 : 6, -h * 0.05, 70);
        lg.addColorStop(0, on ? 'rgba(255,40,60,.55)' : 'rgba(40,110,255,.55)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = lg; g.fillRect(-80, -80, 160, 160);
        g.globalCompositeOperation = 'source-over';
      }
      g.restore();
    }
    function shade(hex, k) {
      const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
      const f = (c) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
      return `rgb(${f(r)},${f(gg)},${f(b)})`;
    }
    function draw() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#07060b'; g.fillRect(0, 0, cv.width, cv.height);
      const sh = S.shake > 0 ? S.shake * 10 : 0;
      g.setTransform(scale, 0, 0, scale, offX + rnd(-sh, sh) * scale, offY + rnd(-sh, sh) * scale);
      g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
      // тротуары и дома
      g.fillStyle = '#17141d'; g.fillRect(0, 0, ROAD_L, H); g.fillRect(ROAD_R, 0, W - ROAD_R, H);
      const span = H * 3;
      houses.forEach((h) => {
        const y = ((h.y + S.scroll * 0.9) % span + span) % span - H;
        const x = h.side ? ROAD_R + 12 : 0, w = ROAD_L - 12;
        g.fillStyle = h.c > 0.5 ? '#221d2b' : '#1c1a22'; g.fillRect(x, y, w, h.h - 8);
        g.fillStyle = '#2c2636'; g.fillRect(x, y, w, 4);
        for (let wy = y + 12; wy < y + h.h - 16; wy += 16) for (let wx = x + 6; wx < x + w - 6; wx += 14) {
          if (((wx * 7 + wy * 3) | 0) % 5 < (h.win * 4) | 0) { g.fillStyle = (wx + wy) % 3 ? '#ffcf6b' : '#ff7ab8'; g.globalAlpha = .55; g.fillRect(wx, wy, 6, 7); g.globalAlpha = 1; }
        }
      });
      // бордюры
      g.fillStyle = '#3a3442'; g.fillRect(ROAD_L - 6, 0, 6, H); g.fillRect(ROAD_R, 0, 6, H);
      // асфальт
      const ag = g.createLinearGradient(ROAD_L, 0, ROAD_R, 0);
      ag.addColorStop(0, '#1b1a20'); ag.addColorStop(0.5, '#23222a'); ag.addColorStop(1, '#1b1a20');
      g.fillStyle = ag; g.fillRect(ROAD_L, 0, ROAD_R - ROAD_L, H);
      // разметка
      g.fillStyle = 'rgba(240,230,200,.55)';
      const lane = (ROAD_R - ROAD_L) / 3;
      for (let k = 1; k < 3; k++) for (let y = (S.scroll % 60) - 60; y < H; y += 60) g.fillRect(ROAD_L + lane * k - 2, y, 4, 30);
      // фонари — пятна света
      g.globalCompositeOperation = 'lighter';
      for (let y = (S.scroll * 1 % 220) - 220; y < H; y += 220) {
        [ROAD_L + 6, ROAD_R - 6].forEach((lx) => {
          const lg = g.createRadialGradient(lx, y, 4, lx, y, 90); lg.addColorStop(0, 'rgba(255,190,90,.22)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = lg; g.fillRect(lx - 90, y - 90, 180, 180);
        });
      }
      g.globalCompositeOperation = 'source-over';
      // следы
      g.fillStyle = 'rgba(0,0,0,.35)'; S.skids.forEach((s) => g.fillRect(s.x, s.y, 3, 10));
      // баррикады
      S.blocks.forEach((b) => {
        const segs = [[ROAD_L, b.gap - b.gw / 2], [b.gap + b.gw / 2, ROAD_R]];
        segs.forEach(([a, c]) => {
          for (let x = a; x < c - 2; x += 20) {
            g.fillStyle = ((x / 20) | 0) % 2 ? '#e8e8ee' : '#d01c2c'; g.fillRect(x, b.y - 6, Math.min(20, c - x), 12);
          }
        });
        g.fillStyle = '#ffd34d'; g.font = '700 10px Manrope, sans-serif'; g.textAlign = 'center'; g.fillText('ДПС', segs[0][1] - 18, b.y - 10);
      });
      // бонусы
      S.items.forEach((it) => {
        g.save(); g.translate(it.x, it.y);
        g.globalCompositeOperation = 'lighter';
        const lg = g.createRadialGradient(0, 0, 2, 0, 0, 26); lg.addColorStop(0, it.kind === 'nitro' ? 'rgba(80,180,255,.7)' : 'rgba(255,210,80,.7)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = lg; g.fillRect(-26, -26, 52, 52); g.globalCompositeOperation = 'source-over';
        if (it.kind === 'nitro') { g.fillStyle = '#2a8aff'; rr(-7, -11, 14, 22, 4); g.fill(); g.fillStyle = '#cfe6ff'; g.fillRect(-4, -8, 8, 4); }
        else { g.fillStyle = '#3c8a3c'; rr(-11, -7, 22, 14, 3); g.fill(); g.fillStyle = '#f5d27a'; g.fillRect(-2, -7, 4, 14); }
        g.restore();
      });
      // гражданские
      S.cars.forEach((c) => car(c.x, c.y, c.w, c.h, c.color, { front: 'down' }));
      // фары игрока
      g.globalCompositeOperation = 'lighter';
      const py = H * 0.74;
      const hl = g.createLinearGradient(0, py - 30, 0, py - 200);
      hl.addColorStop(0, 'rgba(255,240,190,.28)'); hl.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = hl; g.beginPath(); g.moveTo(S.x - 12, py - 28); g.lineTo(S.x - 60, py - 210); g.lineTo(S.x + 60, py - 210); g.lineTo(S.x + 12, py - 28); g.fill();
      if (S.nitro > 0) { const ng = g.createRadialGradient(S.x, py + 40, 2, S.x, py + 40, 30); ng.addColorStop(0, 'rgba(90,180,255,.9)'); ng.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = ng; g.fillRect(S.x - 30, py + 10, 60, 60); }
      g.globalCompositeOperation = 'source-over';
      // игрок
      if (!(S.inv > 0 && Math.floor(S.t * 14) % 2)) car(S.x, py, CAR_W, CAR_H, '#141418', { rot: (S.tx - S.x) * 0.006, front: 'up' });
      // менты сзади
      const copY = H + 30 - S.cop * 150;
      car(S.x * 0.6 + (ROAD_L + ROAD_R) / 2 * 0.4 - 22, copY, 34, 64, '#e8e8ee', { cop: true, front: 'up' });
      if (S.cop > 0.5) car(S.x * 0.5 + (ROAD_L + ROAD_R) / 2 * 0.5 + 26, copY + 40, 34, 64, '#e8e8ee', { cop: true, front: 'up' });
      // искры
      S.sparks.forEach((s) => { g.fillStyle = s.col; g.globalAlpha = Math.max(0, s.life * 1.6); g.fillRect(s.x, s.y, 2.4, 2.4); });
      g.globalAlpha = 1;
      // мигалки по краям, когда менты близко
      if (S.cop > 0.55) {
        const on = Math.floor(S.t * 6) % 2;
        const eg = g.createLinearGradient(0, 0, 40, 0); eg.addColorStop(0, on ? 'rgba(255,30,50,.45)' : 'rgba(30,80,255,.45)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = eg; g.fillRect(0, 0, 40, H);
        const eg2 = g.createLinearGradient(W, 0, W - 40, 0); eg2.addColorStop(0, on ? 'rgba(30,80,255,.45)' : 'rgba(255,30,50,.45)'); eg2.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = eg2; g.fillRect(W - 40, 0, 40, H);
      }
      g.restore();
    }

    // ---- логика ----
    const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
    function step(dt) {
      S.t += dt;
      if (!S.run) return;
      const prog = Math.min(1, S.t / seconds);
      const k = keys.ArrowLeft || keys.a ? -1 : keys.ArrowRight || keys.d ? 1 : 0;
      if (k) S.tx = Math.max(ROAD_L + CAR_W / 2, Math.min(ROAD_R - CAR_W / 2, S.tx + k * 320 * dt));
      const px = S.x;
      S.x += (S.tx - S.x) * Math.min(1, dt * 9);
      if (Math.abs(S.x - px) > 2.2) S.skids.push({ x: S.x - 10, y: H * 0.74 + 24 }, { x: S.x + 8, y: H * 0.74 + 24 });
      const target = 300 + prog * 140 + (S.nitro > 0 ? 220 : 0);
      S.speed += (target - S.speed) * Math.min(1, dt * 1.5);
      S.scroll += S.speed * dt;
      S.nitro = Math.max(0, S.nitro - dt); S.inv = Math.max(0, S.inv - dt); S.shake = Math.max(0, S.shake - dt);
      // менты понемногу догоняют, нитро и чистая езда — отрываешься
      S.cop += dt * (0.018 + prog * 0.02) - (S.nitro > 0 ? dt * 0.12 : 0) - dt * 0.012;
      S.cop = Math.max(0.05, S.cop);
      if (S.cop >= 1) return end(false, 'Менты догнали — приняли');
      // спавн
      S.spawn -= dt;
      if (S.spawn <= 0) { spawnCar(); if (Math.random() < 0.35 + prog * 0.3) spawnCar(); S.spawn = rnd(0.45, 0.9) - prog * 0.25; }
      S.pick -= dt; if (S.pick <= 0) { spawnItem(); S.pick = rnd(2.2, 3.6); }
      if (prog > 0.25 && Math.random() < dt * (0.12 + prog * 0.18) && !S.blocks.some((b) => b.y < 160)) spawnBlock();
      // движение объектов
      const py = H * 0.74;
      S.cars.forEach((c) => { c.y += (S.speed - c.v) * dt; c.x += Math.sin(S.t * 1.3 + c.y * 0.01) * c.drift * dt; });
      S.items.forEach((it) => { it.y += S.speed * dt; });
      S.blocks.forEach((b) => { b.y += S.speed * dt; });
      S.skids.forEach((s) => { s.y += S.speed * dt; });
      S.sparks.forEach((s) => { s.x += s.vx * dt; s.y += (s.vy + S.speed * 0.6) * dt; s.vy += 400 * dt; s.life -= dt; });
      S.cars = S.cars.filter((c) => c.y < H + 100);
      S.items = S.items.filter((it) => it.y < H + 40 && !it.got);
      S.blocks = S.blocks.filter((b) => b.y < H + 40);
      S.skids = S.skids.filter((s) => s.y < H + 20).slice(-200);
      S.sparks = S.sparks.filter((s) => s.life > 0);
      // столкновения
      S.cars.forEach((c) => {
        if (!c.hit && overlap(S.x, py, CAR_W - 6, CAR_H - 8, c.x, c.y, c.w - 4, c.h - 6)) { c.hit = true; c.drift = (c.x < S.x ? -1 : 1) * 160; c.v = 40; hit((S.x + c.x) / 2, (py + c.y) / 2); }
      });
      S.blocks.forEach((b) => {
        if (b.done || Math.abs(b.y - py) > CAR_H / 2) return;
        b.done = true;
        if (Math.abs(S.x - b.gap) > b.gw / 2 - CAR_W / 2 + 4) hit(S.x, b.y);
        else { S.cop = Math.max(0.05, S.cop - 0.06); }
      });
      S.items.forEach((it) => {
        if (!it.got && overlap(S.x, py, CAR_W, CAR_H, it.x, it.y, 24, 24)) {
          it.got = true;
          if (it.kind === 'nitro') { S.nitro = 1.6; S.inv = Math.max(S.inv, 1.6); window.SFX && SFX.play('buy'); }
          else { S.cash += 1; S.cop = Math.max(0.05, S.cop - 0.05); window.SFX && SFX.play('cash'); }
          sparks(it.x, it.y, 12, it.kind === 'nitro' ? '#7ac4ff' : '#ffd34d');
        }
      });
      // HUD
      escEl.style.width = (prog * 100).toFixed(1) + '%';
      copEl.style.width = (S.cop * 100).toFixed(1) + '%';
      hpEl.innerHTML = '<i></i>'.repeat(Math.max(0, S.hp)) + '<i class="off"></i>'.repeat(3 - Math.max(0, S.hp));
      if (prog >= 1) end(true, 'Ушёл от погони!');
    }

    let last = performance.now(), raf = 0, sirenT = 0;
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      step(dt); draw();
      if (S.run && (sirenT -= dt) <= 0) { window.SFX && SFX.play('siren', 0.45); sirenT = 3.6; }
      if (!S.closed) raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    // отсчёт
    let n = 3;
    const cd = setInterval(() => {
      n -= 1;
      if (n > 0) { msg.querySelector('b').textContent = n; window.SFX && SFX.play('tick'); }
      else { clearInterval(cd); msg.classList.add('hide'); S.run = true; S.t = 0; window.SFX && SFX.play('turn'); }
    }, 800);

    function end(ok, text) {
      if (S.over) return;
      S.over = true; S.run = false;
      msg.classList.remove('hide');
      msg.innerHTML = `<b class="${ok ? 'ok' : 'bad'}">${ok ? 'УШЁЛ!' : 'ПРИНЯЛИ'}</b><small>${text}${S.cash ? ` · бабок подобрал: ${S.cash}` : ''}</small>`;
      window.SFX && SFX.play(ok ? 'casino-win' : 'jail');
      setTimeout(() => { close(); onEnd && onEnd(ok, S.cash); }, 1900);
    }
    function close() {
      S.closed = true; cancelAnimationFrame(raf); clearInterval(cd);
      removeEventListener('resize', fit); removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      root.classList.add('out'); setTimeout(() => root.remove(), 300);
    }
    return { abort() { if (!S.over) { S.over = true; close(); } } };
  }
  return { start };
})();
