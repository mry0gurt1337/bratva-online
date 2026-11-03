// Мини-игры клеток «Монополии»: Сауна — «Кто дольше», Порт — «Контрабанда», Ломбард — «Оценщик», Ресторан — «Тост».
// (Рынок — «Напёрстки» — сделан в glasses.js.) Итог считает сервер; здесь сцена и управление.
// Каждая игра: start(pub, { onEnd(res) }) → { reveal(fx), close() }.
window.Minis = (() => {
  const S0 = () => window.SFX || { play() {}, vibe() {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function shell(cls, kicker, title) {
    const root = document.createElement('div');
    root.className = 'mg-ov ' + cls;
    root.innerHTML = `<div class="mg-scene"><div class="mg-head"><small>${kicker}</small><b class="mg-title">${title}</b></div><div class="mg-body"></div><div class="mg-foot"></div></div>`;
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('show'));
    let closed = false;
    const api = {
      root, body: root.querySelector('.mg-body'), foot: root.querySelector('.mg-foot'), title: root.querySelector('.mg-title'),
      get closed() { return closed; },
      close() { if (closed) return; closed = true; root.classList.remove('show'); setTimeout(() => root.remove(), 300); },
      async result(fx) { // общий финал: текст итога от сервера
        api.title.innerHTML = `<span class="${fx.won ? 'pos' : 'neg'}">${fx.won ? 'Есть!' : 'Мимо'}</span>`;
        api.foot.innerHTML = `<div class="mg-res ${fx.won ? 'good' : 'bad'}">${fx.text || ''}</div>`;
        S0().play(fx.won ? 'casino-win' : 'bad'); S0().vibe(fx.won ? [60, 40, 120] : 40);
        if (fx.won && window.BR && window.BR.coinBurst) window.BR.coinBurst(root.querySelector('.mg-scene'), 24);
        await sleep(2600); api.close();
      },
    };
    return api;
  }

  // ---------- Сауна: «Кто дольше» ----------
  // Держишь кнопку — сидишь в парилке. Сосед выйдет в свой момент (по нему видно, что сдаёт). Вышел после него —
  // выиграл. Пересидел свой предел — отрубился. Сердце подсказывает, сколько ещё можешь.
  function sauna(pub, { onEnd }) {
    const ui = shell('mg-sauna', 'Сауна · кто дольше', 'Зажми кнопку и сиди');
    const man = (cls, towel) => `<svg viewBox="0 0 120 160" class="sa-man ${cls}"><ellipse cx="60" cy="150" rx="38" ry="7" fill="rgba(0,0,0,.35)"/>
      <path d="M22 150 C24 104 40 92 60 92 C80 92 96 104 98 150Z" fill="#e2a57e"/><path d="M26 128 H94 L98 150 H22Z" fill="${towel}"/>
      <circle cx="60" cy="62" r="26" fill="#e8b08a"/><path d="M34 54 C36 32 84 32 86 54 C78 44 42 44 34 54Z" fill="${towel}"/>
      <circle cx="51" cy="64" r="2.6" fill="#2a1a12"/><circle cx="69" cy="64" r="2.6" fill="#2a1a12"/><path class="sa-mouth" d="M52 76 Q60 80 68 76" stroke="#7a3a28" stroke-width="2.4" fill="none"/>
      <g class="sa-sweat"><path d="M40 70 q2 6 0 8 q-2 -2 0 -8Z" fill="#bfe8ff"/><path d="M80 58 q2 6 0 8 q-2 -2 0 -8Z" fill="#bfe8ff"/></g></svg>`;
    ui.body.innerHTML = `<div class="sa-room"><i class="sa-steam"></i><i class="sa-steam s2"></i><i class="sa-door"></i>
        <div class="sa-thermo"><i></i><b>80°</b></div>
        <div class="sa-bench"><div class="sa-me">${man('me', '#f2efe6')}<small>Ты</small></div><div class="sa-opp">${man('opp', '#c9d6e8')}<small>Сосед</small></div></div></div>
      <div class="sa-heart"><span>Сердце</span><i><em></em></i><b>90</b></div>
      <div class="mg-hint">Сосед сдаёт — вытирает пот, качается, потом встаёт. Выйди <b>после</b> него, но раньше, чем сердце упрётся в красное</div>`;
    ui.foot.innerHTML = `<button class="mg-hold" id="saHold">ЗАЖМИ — СИДИШЬ</button>`;
    const btn = ui.foot.querySelector('#saHold'), room = ui.body.querySelector('.sa-room'), opp = ui.body.querySelector('.sa-opp');
    const heart = ui.body.querySelector('.sa-heart em'), bpmEl = ui.body.querySelector('.sa-heart b'), thermo = ui.body.querySelector('.sa-thermo i'), tEl = ui.body.querySelector('.sa-thermo b');
    let t0 = 0, held = false, done = false, raf = 0, oppGone = false, beatT = 0;
    const startAt = performance.now() + 8000; // не зажал за 8 с — не зашёл в парилку
    function finish(release, why) {
      if (done) return; done = true; cancelAnimationFrame(raf);
      btn.disabled = true; btn.textContent = why;
      onEnd({ release: +release.toFixed(2) });
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!t0 && now >= startAt) return finish(0, 'Не зашёл');
      if (!t0) return;
      const t = (now - t0) / 1000, k = clamp(t / pub.tFaint, 0, 1.2);
      const bpm = Math.round(90 + 100 * k * k);
      heart.style.width = Math.min(100, k * 100) + '%'; heart.parentElement.classList.toggle('red', k > 0.82);
      bpmEl.textContent = bpm; thermo.style.height = Math.min(100, 30 + t * 6) + '%'; tEl.textContent = Math.round(80 + t * 4) + '°';
      room.style.setProperty('--heat', Math.min(1, t / 14).toFixed(2));
      if (now - beatT > 60000 / bpm) { beatT = now; heart.parentElement.classList.remove('beat'); void heart.offsetWidth; heart.parentElement.classList.add('beat'); if (k > 0.7) S0().play('tick', 0.3); }
      // сосед сдаёт заранее: потеет и качается за 2.5 с до выхода
      opp.classList.toggle('weak', t > pub.tOpp - 2.5);
      if (!oppGone && t >= pub.tOpp) { oppGone = true; opp.classList.add('gone'); ui.title.textContent = 'Сосед вышел! Выходи'; S0().play('turn'); }
      if (t >= pub.tFaint) { room.classList.add('faint'); return finish(t, 'Отрубился'); }
    }
    const press = (e) => { e.preventDefault(); if (done) return; held = true; if (!t0) t0 = performance.now(); btn.classList.add('on'); btn.textContent = 'ДЕРЖИШЬСЯ…'; ui.title.textContent = 'Держись'; };
    const release = () => { if (!held || done) return; held = false; finish((performance.now() - t0) / 1000, 'Вышел'); };
    btn.addEventListener('pointerdown', press); addEventListener('pointerup', release); addEventListener('pointercancel', release);
    raf = requestAnimationFrame(frame);
    return { reveal: async (fx) => { cancelAnimationFrame(raf); removeEventListener('pointerup', release); removeEventListener('pointercancel', release); await ui.result(fx); }, close: ui.close };
  }

  // ---------- Порт: «Контрабанда» ----------
  // Жми «Груз» — грузчик несёт ящик на катер. Патруль шарит прожектором по причалу: перед ним мигает сирена.
  // Если прожектор застал тебя с ящиком — груз конфискуют. 20 секунд.
  function smuggle(pub, { onEnd }) {
    const ui = shell('mg-port', 'Порт · контрабанда', 'Грузи ящики на катер');
    ui.body.innerHTML = `<canvas class="pt-cv"></canvas><div class="pt-hud"><span>Ящиков: <b class="pt-n">0</b></span><span class="pt-alarm">ПАТРУЛЬ!</span><span>Время: <b class="pt-t">20</b></span></div>
      <div class="mg-hint">Не неси ящик, когда прожектор идёт по причалу — перед этим мигает сирена</div>`;
    ui.foot.innerHTML = `<button class="mg-hold" id="ptGo">ГРУЗ</button>`;
    const cv = ui.body.querySelector('canvas'), g = cv.getContext('2d'), nEl = ui.body.querySelector('.pt-n'), tEl = ui.body.querySelector('.pt-t'), alarm = ui.body.querySelector('.pt-alarm'), btn = ui.foot.querySelector('#ptGo');
    const W = 360, H = 260; let dpr = 1;
    const fit = () => { dpr = Math.min(2, devicePixelRatio || 1); const w = cv.clientWidth; cv.width = w * dpr; cv.height = w * (H / W) * dpr; };
    fit();
    const S = { t: 0, n: 0, carry: -1, done: false, ph: 'calm', phT: 3 + Math.random() * 1.5, light: -1, stack: 8 };
    let last = performance.now(), raf = 0, acc = 0;
    btn.onclick = () => { if (S.done || S.carry >= 0) return; S.carry = 0; S0().play('click'); btn.disabled = true; };
    function end(ok) { if (S.done) return; S.done = true; btn.disabled = true; onEnd({ ok, crates: S.n }); ui.title.textContent = ok ? 'Катер отчалил' : 'Накрыли!'; if (!ok) S0().play('siren'); }
    function step(dt) {
      if (S.done) return;
      S.t += dt; tEl.textContent = Math.max(0, Math.ceil(pub.seconds - S.t));
      if (S.t >= pub.seconds) return end(true);
      S.phT -= dt;
      if (S.phT <= 0) {
        if (S.ph === 'calm') { S.ph = 'warn'; S.phT = 1.0; S0().play('siren', 0.4); }
        else if (S.ph === 'warn') { S.ph = 'sweep'; S.phT = 1.6; S.light = 0; }
        else { S.ph = 'calm'; S.phT = 1.6 + Math.random() * 2.6; S.light = -1; }
      }
      alarm.classList.toggle('on', S.ph !== 'calm');
      if (S.ph === 'sweep') S.light = 1 - S.phT / 1.6;
      if (S.carry >= 0) {
        S.carry += dt / 0.95;
        if (S.ph === 'sweep') return end(false);
        if (S.carry >= 1) { S.carry = -1; S.n += 1; nEl.textContent = S.n; S0().play('cash', 0.5); btn.disabled = false; }
      }
    }
    function draw() {
      const k = cv.width / W; g.setTransform(k, 0, 0, k, 0, 0);
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0a1222'); sky.addColorStop(1, '#13233a'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = '#0b2a40'; g.fillRect(0, 150, W, 110);                                                         // вода
      g.strokeStyle = 'rgba(120,180,220,.18)'; for (let i = 0; i < 6; i++) { const y = 165 + i * 15; g.beginPath(); for (let x = 0; x <= W; x += 12) g.lineTo(x, y + Math.sin(x * 0.05 + S.t * 2 + i) * 2); g.stroke(); }
      g.fillStyle = '#4a3a2a'; g.fillRect(0, 140, 230, 18); g.fillStyle = '#3a2c1e'; for (let x = 10; x < 230; x += 40) g.fillRect(x, 158, 8, 60); // причал
      // штабель ящиков
      const left = Math.max(0, S.stack - S.n);
      for (let i = 0; i < Math.min(8, left); i++) { const x = 14 + (i % 3) * 24, y = 116 - Math.floor(i / 3) * 22; g.fillStyle = '#8a6a3a'; g.fillRect(x, y, 22, 22); g.strokeStyle = '#4a3418'; g.strokeRect(x + .5, y + .5, 21, 21); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 22, y + 22); g.stroke(); }
      // катер
      const bx = 250, by = 132 + Math.sin(S.t * 1.6) * 2;
      g.fillStyle = '#20262e'; g.beginPath(); g.moveTo(bx, by + 10); g.lineTo(bx + 100, by + 10); g.lineTo(bx + 88, by + 30); g.lineTo(bx + 8, by + 30); g.fill();
      g.fillStyle = '#39424e'; g.fillRect(bx + 50, by - 8, 30, 18); g.fillStyle = '#ffd88a'; g.fillRect(bx + 56, by - 4, 6, 5); g.fillRect(bx + 68, by - 4, 6, 5);
      for (let i = 0; i < Math.min(12, S.n); i++) { g.fillStyle = '#8a6a3a'; g.fillRect(bx + 8 + (i % 4) * 10, by + 2 - Math.floor(i / 4) * 8, 9, 8); }
      // грузчик
      const px = S.carry >= 0 ? 80 + S.carry * 175 : 70, py = 116;
      g.fillStyle = '#1a1a20'; g.fillRect(px - 6, py, 12, 24); g.beginPath(); g.arc(px, py - 6, 7, 0, 7); g.fillStyle = '#e2b08a'; g.fill();
      g.fillStyle = '#2a2a33'; g.fillRect(px - 8, py - 13, 16, 5);
      if (S.carry >= 0) { g.fillStyle = '#8a6a3a'; g.fillRect(px - 11, py - 4 + Math.sin(S.t * 18) * 1.5, 22, 18); }
      // патрульный катер и прожектор
      const pxp = S.ph === 'calm' ? -60 : 30;
      g.fillStyle = '#d8dde6'; g.fillRect(pxp, 196, 60, 14); g.fillStyle = Math.sin(S.t * 18) > 0 ? '#ff2a3d' : '#2a6aff'; g.fillRect(pxp + 24, 188, 10, 8);
      if (S.ph === 'warn') { g.fillStyle = 'rgba(255,40,60,.12)'; g.fillRect(0, 0, W, H); }
      if (S.ph === 'sweep') {
        const lx = S.light * 240;
        g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(lx, 140, 0, lx, 140, 70); gr.addColorStop(0, 'rgba(230,240,255,.75)'); gr.addColorStop(1, 'rgba(230,240,255,0)');
        g.fillStyle = gr; g.fillRect(lx - 70, 70, 140, 140);
        g.fillStyle = 'rgba(230,240,255,.1)'; g.beginPath(); g.moveTo(pxp + 30, 196); g.lineTo(lx - 50, 140); g.lineTo(lx + 50, 140); g.fill();
        g.globalCompositeOperation = 'source-over';
      }
    }
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; acc += dt;
      step(dt);
      if (acc >= 1 / 31) { acc = 0; draw(); }
      if (!ui.closed) raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return { reveal: async (fx) => { S.done = true; await ui.result(fx); cancelAnimationFrame(raf); }, close: () => { cancelAnimationFrame(raf); ui.close(); } };
  }

  // ---------- Ломбард: «Оценщик» ----------
  // Скупщик называет цену — настоящая заметно выше или ниже. По весу, камням и состоянию прикинь, куда.
  function appraise(pub, { onEnd }) {
    const ui = shell('mg-lombard', 'Ломбард · оценщик', 'Дороже или дешевле?');
    const answers = [];
    const render = (k) => {
      const it = pub.items[k];
      ui.body.innerHTML = `<div class="lb-card"><div class="lb-pic"><img src="art-${it.img}.webp" alt=""></div>
          <div class="lb-info"><small>Вещь ${k + 1} из 3</small><b>${it.name}</b><span>${it.amount} ${it.unit} · ${it.cond}</span></div></div>
        <div class="lb-offer">Скупщик: «Даю <b>$${it.offer}</b>, больше никто не даст»</div>
        <div class="lb-rule">${pub.rule}</div>`;
      ui.foot.innerHTML = `<div class="lb-btns"><button class="btn" data-a="down">Дешевле</button><button class="btn gold" data-a="up">Дороже</button></div>`;
      ui.foot.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
        answers.push(b.dataset.a); S0().play('click');
        if (answers.length < 3) render(answers.length);
        else { ui.foot.innerHTML = '<div class="mg-res">Скупщик считает…</div>'; onEnd({ answers }); }
      });
    };
    render(0);
    return {
      reveal: async (fx) => {
        ui.body.innerHTML = `<div class="lb-list">${pub.items.map((it, k) => {
          const truth = fx.values[k] > fx.offers[k] ? 'up' : 'down', ok = k < fx.right, counted = k <= fx.right;
          return `<div class="lb-row ${ok ? 'good' : counted ? 'bad' : 'off'}"><img src="art-${it.img}.webp" alt=""><span><b>${it.name}</b><small>давал $${fx.offers[k]} · стоит $${fx.values[k]}</small></span><em>${truth === 'up' ? 'дороже' : 'дешевле'}</em></div>`;
        }).join('')}</div>`;
        await ui.result(fx);
      },
      close: ui.close,
    };
  }

  // ---------- Ресторан: «Тост» ----------
  // Три фразы тоста: жми, когда бегунок в золотой зоне. С каждой фразой он быстрее.
  function toast(pub, { onEnd }) {
    const ui = shell('mg-toast', 'Ресторан · тост', 'Скажи тост');
    const LINES = ['Ну, за тех, кто в пути…', '…за тех, кто держит слово…', '…и за пацанов, что держат район!'];
    ui.body.innerHTML = `<div class="ts-table"><i class="ts-glass"></i><i class="ts-glass g2"></i><i class="ts-glass g3"></i></div>
      <div class="ts-lines">${LINES.map((l, k) => `<div class="ts-line" data-k="${k}">${l}</div>`).join('')}</div>
      <div class="ts-bar"><i class="ts-zone"></i><i class="ts-zone in"></i><em class="ts-mark"></em></div>
      <div class="mg-hint">Жми, когда бегунок в золотой середине. Хороший тост — каждый за столом скинется тебе</div>`;
    ui.foot.innerHTML = `<button class="mg-hold" id="tsGo">СКАЗАТЬ</button>`;
    const mark = ui.body.querySelector('.ts-mark'), btn = ui.foot.querySelector('#tsGo');
    let k = 0, score = 0, raf = 0, t0 = performance.now(), done = false, pos = 0;
    const speeds = [0.55, 0.8, 1.1];
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const t = (now - t0) / 1000;
      pos = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * speeds[Math.min(2, k)]);
      mark.style.left = (pos * 100).toFixed(2) + '%';
    }
    btn.onclick = () => {
      if (done) return;
      const q = clamp(1 - Math.abs(pos - 0.5) / 0.5 * 1.15, 0, 1);
      score += q;
      const line = ui.body.querySelector(`.ts-line[data-k="${k}"]`);
      line.classList.add('said', q > 0.8 ? 'great' : q > 0.45 ? 'ok' : 'meh');
      S0().play(q > 0.8 ? 'cash' : q > 0.45 ? 'click' : 'bad'); S0().vibe(15);
      k++; t0 = performance.now() - Math.random() * 400;
      if (k >= 3) { done = true; cancelAnimationFrame(raf); btn.disabled = true; ui.body.querySelectorAll('.ts-glass').forEach((g) => g.classList.add('clink')); S0().play('card'); onEnd({ score: +score.toFixed(2) }); }
    };
    raf = requestAnimationFrame(frame);
    return { reveal: async (fx) => { cancelAnimationFrame(raf); await ui.result(fx); }, close: () => { cancelAnimationFrame(raf); ui.close(); } };
  }

  return { sauna, smuggle, appraise, toast };
})();
