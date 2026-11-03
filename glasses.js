// «Четыре бокала» — мини-игра Клуба. Бармен ставит четыре разных бокала, накрывает медными колпаками и тасует.
// Следи за нужным и выбирай. Раскладку, тасовку и подмену решает сервер; здесь только анимация.
// Шулер видит подмену. Остальные игроки смотрят ту же сцену без выбора.
window.Glasses = (() => {
  const NAMES = { ring: 'Перстень', konyak: 'Коньяк', vodka: 'Водка', klof: 'Клофелин' };
  const PRIZE = { ring: '+$240', konyak: '+$90', vodka: '+1 авторитет', klof: 'обчистят на $80' };
  const S0 = () => window.SFX || { play() {}, vibe() {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // свои рисунки бокалов
  const GLASS = {
    ring: `<svg viewBox="0 0 80 110"><defs><linearGradient id="glG" x1="0" x2="1"><stop offset="0" stop-color="#7a4d0b"/><stop offset=".45" stop-color="#ffe08a"/><stop offset="1" stop-color="#a0640e"/></linearGradient></defs>
      <path d="M14 10 H66 C66 44 54 58 40 60 C26 58 14 44 14 10Z" fill="url(#glG)"/><path d="M18 14 H62 C61 40 51 52 40 54 C29 52 19 40 18 14Z" fill="#3a2404" opacity=".55"/>
      <rect x="37" y="60" width="6" height="30" fill="url(#glG)"/><ellipse cx="40" cy="96" rx="20" ry="6" fill="url(#glG)"/>
      <circle cx="40" cy="34" r="10" fill="none" stroke="#ffe7a8" stroke-width="3.5"/><path d="M40 21 l4 4 -4 4 -4 -4z" fill="#b6f0ff"/><circle class="gl-twinkle" cx="46" cy="22" r="2.5" fill="#fff"/></svg>`,
    konyak: `<svg viewBox="0 0 80 110"><path d="M16 26 C10 54 22 72 40 72 C58 72 70 54 64 26Z" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.55)" stroke-width="2"/>
      <path d="M13 50 C16 66 26 72 40 72 C54 72 64 66 67 50Z" fill="#c26a12" opacity=".9"/><path d="M14 50 H66" stroke="#ffcf7a" stroke-width="1.5" opacity=".7"/>
      <rect x="37.5" y="72" width="5" height="18" fill="rgba(255,255,255,.45)"/><ellipse cx="40" cy="96" rx="18" ry="5" fill="rgba(255,255,255,.4)"/><path d="M22 32 C20 42 22 50 26 56" stroke="#fff" stroke-width="2.5" opacity=".5" fill="none"/></svg>`,
    vodka: `<svg viewBox="0 0 80 110"><path d="M20 30 L60 30 L52 96 L28 96Z" fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.6)" stroke-width="2"/>
      <path d="M22 44 L58 44 L52 94 L28 94Z" fill="rgba(210,235,255,.35)"/><path d="M22 44 L58 44" stroke="#eaf6ff" stroke-width="1.5"/>
      <rect x="26" y="94" width="28" height="6" rx="2" fill="rgba(255,255,255,.5)"/><path d="M26 36 L31 90" stroke="#fff" stroke-width="2.5" opacity=".45"/>
      <circle cx="47" cy="58" r="1.4" fill="#fff" opacity=".8"/><circle cx="40" cy="72" r="1.1" fill="#fff" opacity=".7"/></svg>`,
    klof: `<svg viewBox="0 0 80 110"><rect x="20" y="16" width="40" height="84" rx="4" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.55)" stroke-width="2"/>
      <rect x="22" y="40" width="36" height="58" rx="3" fill="#6fd4c4" opacity=".55"/><path d="M22 40 H58" stroke="#cffff6" stroke-width="1.5"/>
      <ellipse cx="40" cy="84" rx="7" ry="4" fill="#fff"/><circle class="gl-fizz" cx="36" cy="74" r="1.6" fill="#fff"/><circle class="gl-fizz f2" cx="44" cy="68" r="1.2" fill="#fff"/><circle class="gl-fizz f3" cx="40" cy="60" r="1.4" fill="#fff"/>
      <path d="M26 22 V92" stroke="#fff" stroke-width="2.5" opacity=".4"/></svg>`,
  };
  // напёрстки: шарик и пусто, деревянный напёрсток
  const THIMBLE_IN = {
    ball: `<svg viewBox="0 0 80 110"><ellipse cx="40" cy="98" rx="16" ry="4" fill="rgba(0,0,0,.4)"/><circle cx="40" cy="86" r="12" fill="#e8402f"/><circle cx="36" cy="82" r="4" fill="#ffb4a8"/></svg>`,
    empty: `<svg viewBox="0 0 80 110"><ellipse cx="40" cy="98" rx="14" ry="3" fill="rgba(0,0,0,.25)"/></svg>`,
  };
  const THIMBLE = `<svg viewBox="0 0 90 120" class="gl-tin-svg"><defs><linearGradient id="glTh" x1="0" x2="1"><stop offset="0" stop-color="#4a2a14"/><stop offset=".35" stop-color="#b07a44"/><stop offset=".55" stop-color="#e2b07a"/><stop offset="1" stop-color="#3a200c"/></linearGradient></defs>
    <path d="M24 10 Q45 0 66 10 L80 108 H10Z" fill="url(#glTh)"/><rect x="6" y="100" width="78" height="12" rx="4" fill="url(#glTh)" stroke="#2a1606" stroke-width="1"/>
    <g fill="#2a1606" opacity=".35">${Array.from({ length: 18 }, (_, k) => `<circle cx="${26 + (k % 6) * 8}" cy="${26 + Math.floor(k / 6) * 14}" r="1.6"/>`).join('')}</g><path d="M34 12 L26 98" stroke="#fff" stroke-width="4" opacity=".22"/></svg>`;
  const TIN = `<svg viewBox="0 0 90 120" class="gl-tin-svg"><defs><linearGradient id="glTin" x1="0" x2="1"><stop offset="0" stop-color="#5a2c12"/><stop offset=".3" stop-color="#e09a5a"/><stop offset=".5" stop-color="#ffd6a8"/><stop offset=".7" stop-color="#c47a3c"/><stop offset="1" stop-color="#4a220c"/></linearGradient></defs>
    <path d="M14 4 H76 L86 112 H4Z" fill="url(#glTin)"/><rect x="6" y="100" width="78" height="12" rx="3" fill="url(#glTin)" stroke="#3a1a08" stroke-width="1"/>
    <path d="M12 30 H78 M10 54 H80" stroke="#3a1a08" stroke-width="1.2" opacity=".5"/><path d="M30 10 L24 98" stroke="#fff" stroke-width="4" opacity=".28"/></svg>`;

  function start({ start, swaps, cheat, sees, spectator, name, onPick, mode }) {
    const th = mode === 'thimble', N = start.length;
    const root = document.createElement('div');
    root.className = 'gl-ov' + (th ? ' thimble' : '');
    root.innerHTML = `<div class="gl-scene">
      <div class="gl-head"><small>${th ? (spectator ? `Рынок · ${name || ''} у напёрсточника` : 'Рынок · Напёрстки') : spectator ? `Клуб · ${name || ''} за стойкой` : 'Клуб · Четыре бокала'}</small><b class="gl-title">${th ? 'Смотри, где шарик' : 'Запоминай бокалы'}</b></div>
      <div class="gl-bar"><i class="gl-neon"></i><div class="gl-row"></div><i class="gl-counter"></i></div>
      ${th ? `<div class="gl-legend th"><span class="gl-chip ring"><b>Угадал</b><small>+$125</small></span><span class="gl-chip klof"><b>Мимо</b><small>ставка $50 сгорела</small></span><span class="gl-shills">«Я только что выиграл!» — подставной в толпе</span></div>`
        : `<div class="gl-legend">${['ring', 'konyak', 'vodka', 'klof'].map((k) => `<span class="gl-chip ${k}"><b>${NAMES[k]}</b><small>${PRIZE[k]}</small></span>`).join('')}</div>`}
      <div class="gl-msg"></div><div class="gl-timer"><i></i></div>
    </div>`;
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('show'));
    const row = root.querySelector('.gl-row'), title = root.querySelector('.gl-title'), msg = root.querySelector('.gl-msg');
    // cup: { id (что внутри), slot, el }
    const cups = start.map((id, slot) => {
      const el = document.createElement('div'); el.className = 'gl-cup'; el.dataset.id = id;
      el.innerHTML = `<div class="gl-glass">${(th ? THIMBLE_IN : GLASS)[id]}</div><div class="gl-tin">${th ? THIMBLE : TIN}</div><i class="gl-shadow"></i>`;
      row.appendChild(el);
      return { id, slot, el };
    });
    const X = (slot) => `${slot * 100}%`;
    const place = (c) => { c.el.style.transform = `translateX(${X(c.slot)})`; };
    cups.forEach(place);
    let closed = false, picked = null, timerRaf = 0;
    const at = (slot) => cups.find((c) => c.slot === slot);

    async function swapAnim(a, b, ms, k) {
      const A = at(a), B = at(b);
      if (!A || !B) return;
      const w = row.clientWidth / N, lift = Math.min(36, w * 0.35);
      const mk = (c, to, front) => c.el.animate([
        { transform: `translateX(${X(c.slot)})` },
        { transform: `translateX(calc(${X(c.slot)} + ${(to - c.slot) * w / 2}px)) translateY(${front ? lift : -lift}px) scale(${front ? 1.08 : 0.92})`, offset: 0.5 },
        { transform: `translateX(${X(to)})` }], { duration: ms, easing: 'cubic-bezier(.45,0,.35,1)' });
      const front = k % 2 === 0;
      A.el.style.zIndex = front ? 3 : 1; B.el.style.zIndex = front ? 1 : 3;
      const p1 = mk(A, b, front), p2 = mk(B, a, !front);
      S0().play('card', 0.4);
      await Promise.all([p1.finished, p2.finished]).catch(() => {});
      A.slot = b; B.slot = a; place(A); place(B);
    }

    async function run() {
      title.textContent = th ? 'Смотри, где шарик' : 'Запоминай бокалы';
      await sleep(th ? 1300 : 1700);
      if (closed) return;
      // колпаки опускаются
      cups.forEach((c) => c.el.classList.add('covered')); S0().play('fight', 0.35);
      title.textContent = th ? (spectator ? 'Крутит напёрстки' : 'Следи за шариком') : spectator ? 'Бармен тасует' : 'Следи за перстнем';
      await sleep(650);
      for (let k = 0; k < swaps.length && !closed; k++) {
        const ms = Math.max(210, 560 - k * 45);
        await swapAnim(swaps[k][0], swaps[k][1], ms, k);
        await sleep(40);
      }
      if (cheat && !closed) {
        // бармен щёлкнул зажигалкой — вспышка, и бокалы поменялись
        root.classList.add('blink'); S0().play('tick');
        const A = at(cheat[0]), B = at(cheat[1]);
        A.slot = cheat[1]; B.slot = cheat[0]; place(A); place(B);
        await sleep(160); root.classList.remove('blink');
        if (sees && !spectator) { msg.innerHTML = '<span class="gl-cheat"><b>Подмена!</b> ты Шулер — видел, куда ушёл перстень</span>'; at(cheat[1]).el.classList.add('hint'); S0().play('siren', 0.3); }
      }
      if (closed) return;
      if (spectator) { title.textContent = 'Выбирает…'; return; }
      title.textContent = th ? 'Где шарик? Выбирай' : 'Где перстень? Выбирай';
      root.classList.add('choose');
      cups.forEach((c) => { c.el.onclick = () => choose(c); });
      const t0 = performance.now(), dur = 20000, bar = root.querySelector('.gl-timer i');
      const tick = () => { const k = Math.min(1, (performance.now() - t0) / dur); bar.style.width = (100 - k * 100) + '%'; if (k < 1 && picked == null && !closed) timerRaf = requestAnimationFrame(tick); else if (k >= 1 && picked == null) choose(cups[Math.floor(Math.random() * 4)]); };
      tick();
    }
    function choose(c) {
      if (picked != null || closed) return;
      picked = c.slot; cancelAnimationFrame(timerRaf);
      root.classList.remove('choose'); c.el.classList.add('picked');
      title.textContent = 'Поднимаем…'; S0().play('click'); S0().vibe(20);
      onPick && onPick(c.slot);
    }
    // напёрстки: итог от сервера — final[slot] (ball | empty); palm — шарик ушёл в рукав
    async function revealThimble(fx) {
      if (closed) return;
      const mine = at(fx.pick);
      if (mine) mine.el.classList.add('picked', 'open');
      // показываем по правде сервера: где был шарик
      cups.forEach((c) => { const id = fx.final[c.slot]; c.el.querySelector('.gl-glass').innerHTML = THIMBLE_IN[id]; });
      S0().play(fx.won ? 'casino-win' : 'bad'); S0().vibe(fx.won ? [60, 40, 160] : 40);
      title.innerHTML = fx.won ? '<span class="pos">Угадал! +$125</span>' : '<span class="neg">Мимо</span>';
      root.querySelectorAll('.gl-chip').forEach((ch) => ch.classList.toggle('won', ch.classList.contains(fx.won ? 'ring' : 'klof')));
      await sleep(900);
      cups.forEach((c) => c.el.classList.add('open'));
      msg.textContent = fx.palm ? 'Шарика не было ни под одним: напёрсточник скинул его в рукав' : '';
      await sleep(2300);
      close();
    }
    // результат от сервера: final[slot] — что под каждым колпаком
    async function reveal(fx) {
      if (closed) return;
      // на случай рассинхрона расставляем по данным сервера
      fx.final.forEach((id, slot) => { const c = cups.find((x) => x.id === id); if (c) { c.slot = slot; place(c); } });
      const mine = at(fx.idx);
      if (mine) { mine.el.classList.add('picked', 'open'); }
      const good = fx.got === 'ring' || fx.got === 'konyak' || fx.got === 'vodka';
      S0().play(fx.got === 'ring' ? 'casino-win' : good ? 'cash' : 'bad');
      S0().vibe(fx.got === 'ring' ? [60, 40, 160] : 40);
      title.innerHTML = `${NAMES[fx.got]}: <span class="${good ? 'pos' : 'neg'}">${PRIZE[fx.got].replace('обчистят', 'обчистили')}</span>`;
      root.querySelectorAll('.gl-chip').forEach((ch) => ch.classList.toggle('won', ch.classList.contains(fx.got)));
      if (fx.got === 'ring' && window.BR && window.BR.coinBurst) window.BR.coinBurst(root.querySelector('.gl-scene'), 30);
      if (fx.got === 'klof') root.classList.add('dizzy');
      await sleep(900);
      cups.forEach((c) => c.el.classList.add('open'));
      msg.textContent = fx.cheat ? 'Бармен подменил бокал вспышкой зажигалки' : '';
      await sleep(2300);
      close();
    }
    function close() { if (closed) return; closed = true; cancelAnimationFrame(timerRaf); root.classList.remove('show'); setTimeout(() => root.remove(), 300); }
    run();
    return { reveal: th ? revealThimble : reveal, close };
  }
  return { start };
})();
