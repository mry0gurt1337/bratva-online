(() => {
'use strict';
const { BOARD, GROUPS, C, ICONS, cellXY, rentOf } = window.G;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const app = $('#app');
const QUICK = ['👊', '😂', '💸', '🔥', '🤝', 'Ну ты жук', 'Стрелка?', 'Везёт же'];

let token = LS.get('bratva_token', null);
let myId = null;
let st = null;
let screen = null;
let deadline = null;
let profile = LS.get('bratva_profile', { name: '', icon: ICONS[0] });
let shareUrl = location.origin;
const urlRoom = new URLSearchParams(location.search).get('room') || '';
const seen = { log: 0, dice: 0, move: 0, fx: 0, turnKey: '' };
const disp = {};        // отображаемая позиция фишек
const animating = {};
const prevMoney = {};
let sheetKey = '';

// ---------- Сеть ----------
const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
socket.on('connect', () => { setConn(true); socket.emit('hello', { token }); });
socket.on('disconnect', () => setConn(false));
socket.on('connect_error', () => { if (!screen) app.innerHTML = '<section class="screen home"><div class="logo"><h1>БРАТВА</h1><div class="logo-sub pulse">Сервер просыпается, до минуты…</div></div></section>'; });
socket.on('you', (info) => {
  if (info) { myId = info.id; token = info.token; LS.set('bratva_token', token); return; }
  if (token && !st) toast('Старая сходка закрылась — создай новую');
  else if (token && st && st.status === 'PLAYING') toast('Сервер перезапустился — сходка потерялась. Создай новую');
  myId = null; st = null; token = null; LS.set('bratva_token', null);
  render();
});
socket.on('state', (s) => {
  const first = !st || st.code !== s.code;
  st = s;
  deadline = s.remaining != null ? Date.now() + s.remaining : null;
  if (first) syncSeen();
  render();
});
socket.on('err', (m) => { toast(m); SFX.play('bad'); });

function syncSeen() {
  seen.log = st.logs.length ? st.logs[st.logs.length - 1].id : 0;
  seen.dice = st.dice ? st.dice.seq : 0;
  seen.move = st.lastMove ? st.lastMove.seq : 0;
  seen.fx = st.fx ? st.fx.seq : 0;
  st.players.forEach((p) => { disp[p.id] = p.pos; prevMoney[p.id] = p.money; });
}

if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  fetch('/api/info').then((r) => r.json()).then((d) => { if (d.urls && d.urls[0]) { shareUrl = d.urls[0]; if (screen === 'lobby') renderLobby(); } }).catch(() => {});
}

const meP = () => st && st.players.find((p) => p.id === myId);
const byId = (id) => st && st.players.find((p) => p.id === id);
const curP = () => st && st.players[st.turn];

function render() {
  const want = !st || !myId ? 'home' : st.status === 'LOBBY' ? 'lobby' : st.status === 'PLAYING' ? 'game' : 'over';
  if (want === 'game') {
    if (screen !== 'game') buildGame();
    screen = 'game';
    return updateGame();
  }
  if (want === 'over' && screen === 'game') {
    // даём доиграть анимациям, потом финальный экран
    updateGame();
    screen = 'over-pending';
    SFX.play('win');
    return setTimeout(() => { if (st && st.status === 'GAMEOVER') { screen = 'over'; renderOver(); } }, 1600);
  }
  if (want === 'over' && screen === 'over-pending') return;
  screen = want;
  if (want === 'home') renderHome();
  else if (want === 'lobby') renderLobby();
  else renderOver();
}

// ---------- Главный экран ----------
function renderHome() {
  app.innerHTML = `
  <section class="screen home">
    <div class="logo">
      <div class="logo-top">монополия девяностых</div>
      <h1>БРАТВА</h1>
      <div class="logo-sub">крышуй точки · забивай стрелки · не попадись ОМОНу</div>
    </div>
    <div class="card form">
      <label for="name">Погоняло</label>
      <input id="name" maxlength="12" placeholder="Например, Кабан" value="${esc(profile.name)}" autocomplete="off" enterkeyhint="done">
      <label>Фишка</label>
      <div class="icons">${ICONS.map((i) => `<button class="ico ${i === profile.icon ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div>
      <button class="btn gold big" id="create">Создать сходку</button>
      <div class="or"><span>или зайти по коду</span></div>
      <div class="row">
        <input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="0000" value="${esc(urlRoom)}">
        <button class="btn" id="join">Войти</button>
      </div>
    </div>
    <button class="link" id="rules">Как играть</button>
  </section>`;
  const nameEl = $('#name');
  nameEl.addEventListener('input', () => { profile.name = nameEl.value; LS.set('bratva_profile', profile); });
  $$('.ico').forEach((b) => b.onclick = () => {
    profile.icon = b.dataset.icon; LS.set('bratva_profile', profile);
    $$('.ico').forEach((x) => x.classList.toggle('on', x === b)); SFX.play('click');
  });
  $('#create').onclick = () => {
    if (!profile.name.trim()) { nameEl.focus(); return toast('Введи погоняло'); }
    socket.emit('create', { name: profile.name, icon: profile.icon });
  };
  $('#join').onclick = () => {
    const code = $('#code').value.trim();
    if (!profile.name.trim()) { nameEl.focus(); return toast('Введи погоняло'); }
    if (!/^\d{4}$/.test(code)) return toast('Код — 4 цифры');
    socket.emit('join', { code, name: profile.name, icon: profile.icon });
  };
  $('#rules').onclick = showRules;
  if (urlRoom && !profile.name) nameEl.focus();
}

// ---------- Лобби ----------
function renderLobby() {
  const host = st.hostId === myId;
  const link = `${shareUrl}/?room=${st.code}`;
  const full = st.players.length >= C.MAX_PLAYERS;
  app.innerHTML = `
  <section class="screen lobby">
    <div class="lobby-head">
      <div class="muted up">Код сходки</div>
      <div class="code">${esc(st.code)}</div>
    </div>
    <div class="card qr-card">
      <img class="qr" src="/api/qr?u=${encodeURIComponent(link)}" alt="QR-код для входа">
      <div class="qr-text">
        <b>Позови братву</b>
        <span>Наведи камеру телефона на код — игра откроется сразу с этой сходкой.</span>
        <code>${esc(link)}</code>
        <button class="btn small" id="copy">Скопировать ссылку</button>
      </div>
    </div>
    <div class="list-title">Братва <span>${st.players.length}/${C.MAX_PLAYERS}</span></div>
    <div class="plist">
      ${st.players.map((p) => `
        <div class="pl" style="--c:${p.color}">
          <span class="av">${p.icon}</span>
          <span class="nm">${esc(p.name)}</span>
          ${p.id === st.hostId ? '<span class="tag gold">босс</span>' : ''}
          ${p.bot ? '<span class="tag">бот</span>' : ''}
          ${p.id === myId ? '<span class="tag me">ты</span>' : ''}
          ${!p.connected ? '<span class="tag off">нет связи</span>' : ''}
          ${host && p.id !== myId ? `<button class="x" data-kick="${p.id}" aria-label="Убрать">✕</button>` : ''}
        </div>`).join('')}
    </div>
    ${host ? `
      <div class="settings">
        <div class="muted up">Длина партии</div>
        <div class="seg">${[10, 20, 30, 0].map((n) => `<button data-rounds="${n}" class="${st.settings.rounds === n ? 'on' : ''}">${n ? n + ' кругов' : 'до конца'}</button>`).join('')}</div>
        <button class="glok-toggle ${st.settings.glok ? 'on' : ''}" id="glokT"><span class="gt-av">👮‍♂️</span><span><b>Надзиратель Дима Глок</b><small>${st.settings.glok ? 'Придёт в случайный момент и всё испортит' : 'Выключен. Скучно будет…'}</small></span><i></i></button>
        <div class="hint">${st.settings.rounds ? 'Когда круги закончатся, победит самый богатый (деньги + точки).' : 'Играем, пока не останется один. Может затянуться на час+.'}</div>
      </div>
      <div class="row">
        <button class="btn" id="bot" ${full ? 'disabled' : ''}>+ Бот</button>
        <button class="btn gold grow" id="start" ${st.players.length < 2 ? 'disabled' : ''}>${st.players.length < 2 ? 'Ждём братву…' : 'Начать замес'}</button>
      </div>` : `${st.settings.glok ? '<div class="hint center-t">👮 В этой партии дежурит надзиратель Дима Глок</div>' : ''}<div class="wait pulse">Ждём, когда босс начнёт…</div>`}
    <div class="row center"><button class="link" id="rules">Как играть</button><button class="link" id="leave">Выйти</button></div>
  </section>`;
  $('#copy').onclick = () => copyText(link);
  $$('[data-kick]').forEach((b) => b.onclick = () => socket.emit('kick', { id: b.dataset.kick }));
  $$('[data-rounds]').forEach((b) => b.onclick = () => socket.emit('settings', { rounds: Number(b.dataset.rounds) }));
  if ($('#glokT')) $('#glokT').onclick = () => socket.emit('settings', { glok: !st.settings.glok });
  if ($('#bot')) $('#bot').onclick = () => socket.emit('addBot');
  if ($('#start')) $('#start').onclick = () => socket.emit('start');
  $('#leave').onclick = () => socket.emit('leave');
  $('#rules').onclick = showRules;
}

// ---------- Игра ----------
function cellHTML(c) {
  const { x, y } = cellXY(c.id);
  const corner = c.id % 5 === 0;
  return `<div class="cell ${corner ? 'corner' : ''} t-${c.type}" id="cell${c.id}" data-cell="${c.id}"
    style="grid-column:${x + 1};grid-row:${y + 1};${c.group ? `--g:${GROUPS[c.group]}` : ''}">
    ${c.group ? '<i class="stripe"></i>' : ''}
    <span class="em">${c.emoji}</span>
    <span class="nm">${c.name}</span>
    ${c.price ? `<span class="pr">$${c.price}</span>` : ''}
    <span class="lvl"></span>
  </div>`;
}

function buildGame() {
  syncSeen();
  app.innerHTML = `
  <section class="screen game">
    <header class="topbar">
      <div class="tb-left"><span class="brand">БРАТВА</span><span class="pill" id="round"></span></div>
      <div class="tb-right">
        <span class="conn" id="conn" title="Связь с сервером"></span>
        <button class="icon-btn" id="snd" aria-label="Звук"></button>
        <button class="icon-btn" id="menu" aria-label="Меню">☰</button>
      </div>
    </header>
    <div class="layout">
      <div class="board-wrap"><div class="board" id="board">
        ${BOARD.map(cellHTML).join('')}
        <div class="center">
          <div class="watermark">БРАТВА</div>
          <div class="heat" id="heat"></div>
          <div class="dice" id="dice"><div class="die" id="d1"></div><div class="die" id="d2"></div></div>
          <div class="status" id="status"></div>
          <button class="btn gold roll" id="roll">Бросить кости</button>
          <div class="timer" id="timer"><i id="timerbar"></i></div>
        </div>
        <div class="tokens" id="tokens"></div>
      </div></div>
      <aside class="side">
        <div class="players" id="players"></div>
        <div class="feed">
          <div class="log" id="log"></div>
          <div class="chat">
            <div class="quick">${QUICK.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
            <form id="chatf" autocomplete="off"><input id="chatin" maxlength="80" placeholder="Написать братве…" enterkeyhint="send"><button class="btn small" aria-label="Отправить">➤</button></form>
          </div>
        </div>
      </aside>
    </div>
    <div class="sheet-back" id="sheetback"><div class="sheet" id="sheet"></div></div>
  </section>`;
  $('#roll').onclick = () => { socket.emit('roll'); $('#roll').disabled = true; SFX.vibe(15); };
  $('#snd').onclick = () => { SFX.on = !SFX.on; updSound(); };
  $('#menu').onclick = showMenu;
  $$('[data-q]').forEach((b) => b.onclick = () => socket.emit('chat', { text: b.dataset.q }));
  $('#chatf').onsubmit = (e) => { e.preventDefault(); const i = $('#chatin'); if (i.value.trim()) socket.emit('chat', { text: i.value }); i.value = ''; i.blur(); };
  $$('.cell').forEach((c) => c.onclick = () => showCellInfo(Number(c.dataset.cell)));
  $('#log').innerHTML = '';
  st.logs.forEach((l) => appendLog(l, false));
  sheetKey = '';
  updSound();
  setConn(socket.connected);
}

function updSound() { const b = $('#snd'); if (b) b.textContent = SFX.on ? '🔊' : '🔇'; }
function setConn(ok) { const c = $('#conn'); if (c) c.classList.toggle('bad', !ok); if (!ok && st) toast('Связь потеряна, переподключаюсь…'); }

function updateGame() {
  const me = meP(), cp = curP(), mine = cp && cp.id === myId;
  $('#round').textContent = `Круг ${st.round}${st.settings.rounds ? ' / ' + st.settings.rounds : ''}`;

  // клетки
  BOARD.forEach((c) => {
    const el = $('#cell' + c.id), pr = st.props[c.id];
    const owner = pr && byId(pr.owner);
    el.classList.toggle('owned', !!owner);
    el.classList.toggle('omon-here', st.omon === c.id);
    el.classList.toggle('sealed', !!(st.sealed && st.sealed.cell === c.id && st.round <= st.sealed.until));
    if (owner) el.style.setProperty('--o', owner.color); else el.style.removeProperty('--o');
    if (c.type === 'prop') {
      $('.pr', el).textContent = owner ? `💸$${rentOf(st.props, c.id)}` : `$${c.price}`;
      $('.lvl', el).textContent = pr && pr.level ? '★'.repeat(pr.level) : '';
    }
  });

  // розыск
  $('#heat').innerHTML = `<span class="lbl">розыск</span>` + Array.from({ length: C.MAX_HEAT }, (_, i) => `<span class="fl ${i < st.heat ? 'on' : ''}">🔥</span>`).join('');
  $('#board').classList.toggle('raid', st.omon !== null);

  // кубики
  if (st.dice && st.dice.seq !== seen.dice) { seen.dice = st.dice.seq; rollDice(st.dice.a, st.dice.b); }
  else if (st.dice && !$('#d1').dataset.v) { setDie($('#d1'), st.dice.a); setDie($('#d2'), st.dice.b); }
  else if (!st.dice && !$('#d1').dataset.v) { setDie($('#d1'), 5); setDie($('#d2'), 2); }

  // перемещение
  if (st.lastMove && st.lastMove.seq !== seen.move) {
    seen.move = st.lastMove.seq;
    const m = st.lastMove;
    hop(m.pid, m.from, m.steps, m.delay || 0);
  }
  st.players.forEach((p) => { if (!animating[p.id]) disp[p.id] = p.pos; });
  drawTokens();

  // игроки
  const counts = {};
  Object.values(st.props).forEach((v) => { counts[v.owner] = (counts[v.owner] || 0) + 1; });
  $('#players').innerHTML = st.players.map((p, i) => {
    const delta = prevMoney[p.id] != null ? p.money - prevMoney[p.id] : 0;
    return `<div class="pc ${i === st.turn ? 'turn' : ''} ${p.bankrupt ? 'dead' : ''} ${p.id === myId ? 'me' : ''}" style="--c:${p.color}" data-pid="${p.id}">
      <div class="pc-top"><span class="av">${p.icon}</span><span class="nm">${esc(p.name)}</span>${p.jail ? '<span title="В тюрьме">🔒</span>' : ''}${!p.connected ? '<span title="Нет связи">📴</span>' : ''}</div>
      <div class="money">${p.bankrupt ? 'РАЗОРЁН' : '$' + p.money}${delta ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>` : ''}</div>
      <div class="stats"><span title="Авторитет">👑${p.auth}</span><span title="Братки">🥊${p.goons}</span><span title="Точки">🏠${counts[p.id] || 0}</span></div>
    </div>`;
  }).join('');
  st.players.forEach((p) => { prevMoney[p.id] = p.money; });
  const turnCard = $('.pc.turn');
  if (turnCard && turnCard.scrollIntoView && $('#players').scrollWidth > $('#players').clientWidth) {
    $('#players').scrollTo({ left: turnCard.offsetLeft - 8, behavior: 'smooth' });
  }

  // статус и кнопка
  const roll = $('#roll');
  const name = cp ? esc(cp.name) : '';
  let status = '';
  if (st.phase === 'ROLL') status = mine ? '<b>Твой ход!</b>' : `Ходит <b style="color:${cp.color}">${name}</b>`;
  else if (st.phase === 'MOVING') status = `<b style="color:${cp.color}">${name}</b> едет…`;
  else if (st.phase === 'DECIDE') status = mine ? '<b>Решай!</b>' : `<b style="color:${cp.color}">${name}</b> ${pendingText(st.pending)}`;
  else if (st.phase === 'ANIM') status = '…';
  else if (st.phase === 'GLOK') status = '👮 <b>Дима Глок</b> наводит порядок…';
  $('#status').innerHTML = status;
  roll.hidden = !(mine && st.phase === 'ROLL');
  roll.disabled = false;

  // мой ход — звук
  const key = `${st.turn}:${st.round}:${st.phase}`;
  if (mine && st.phase === 'ROLL' && key !== seen.turnKey) { SFX.play('turn'); SFX.vibe([30, 40, 30]); }
  seen.turnKey = key;

  // лента
  st.logs.forEach((l) => { if (l.id > seen.log) { seen.log = l.id; appendLog(l, true); } });

  // эффекты
  if (st.fx && st.fx.seq !== seen.fx) { seen.fx = st.fx.seq; showFx(st.fx); }

  // задание Глока
  updateGlokTask();

  // окно решения
  if (mine && st.phase === 'DECIDE' && st.pending) openSheet(st.pending);
  else closeSheet();

  if (me && me.bankrupt && !$('.spectator')) {
    $('#status').insertAdjacentHTML('afterend', '<div class="spectator">ты разорён — смотришь игру</div>');
  }
}

function pendingText(q) {
  if (!q) return 'думает';
  const c = q.cell != null ? `«${BOARD[q.cell].name}»` : '';
  return { BUY: `думает купить ${c}`, UPGRADE: `прокачивает ${c}?`, GYM: 'выбирает братка', CASINO: 'у рулетки…', STRELKA: `на чужой точке ${c}`, JAIL: 'сидит в тюрьме' }[q.type] || 'думает';
}


// ---------- Задания Димы Глока ----------
let glokSeq = 0, glokEl = null;
function updateGlokTask() {
  const t = st.glokTask;
  if (!t) return closeGlokTask();
  if (t.seq === glokSeq && glokEl) {
    const tapped = t.taps.includes(myId);
    const b = $('.glok-btn', glokEl);
    if (b && tapped) { b.disabled = true; b.textContent = t.kind === 'race' ? 'Нажал! Ждём…' : 'Ну-ну…'; }
    return;
  }
  closeGlokTask();
  glokSeq = t.seq;
  const me = meP();
  const dead = !me || me.bankrupt;
  SFX.play('glok'); SFX.vibe([100, 60, 100]);
  flash('ДИМА ГЛОК ПРИШЁЛ', 'glok');
  const isRace = t.kind === 'race';
  glokEl = document.createElement('div');
  glokEl.className = 'overlay show glok-task';
  glokEl.innerHTML = `<div class="fx glok-fx"><div class="glok-card">
    <div class="glok-badge"><span class="glok-face">👮‍♂️</span><span class="glok-shades">🕶️</span></div>
    <div class="glok-name">ДИМА ГЛОК</div>
    <div class="glok-role">надзиратель</div>
    <div class="glok-line">«${esc(t.line)}»</div>
    <div class="glok-title">${isRace ? 'КТО ПЕРВЫЙ — ТОМУ $' + t.prize : 'ХАЛЯВА ОТ ДИМЫ'}</div>
    <div class="glok-text">${isRace ? 'Жми кнопку быстрее всех. Тормозам — ничего.' : 'Дима сегодня щедрый. Бери, пока дают… или нет?'}</div>
    <button class="btn ${isRace ? 'gold' : 'red'} big glok-btn" ${dead ? 'disabled' : ''}>${isRace ? 'Я ЗДЕСЬ!' : 'ЗАБРАТЬ $200 👀'}</button>
    <div class="sh-timer"><i class="glok-bar" style="animation-duration:${t.ms}ms"></i></div>
  </div></div>`;
  document.body.appendChild(glokEl);
  const btn = $('.glok-btn', glokEl);
  btn.onclick = () => { socket.emit('glok', { seq: t.seq }); btn.disabled = true; SFX.play('click'); SFX.vibe(20); btn.textContent = isRace ? 'Нажал! Ждём…' : 'Ну-ну…'; };
}
function closeGlokTask() {
  if (glokEl) { const e = glokEl; e.classList.remove('show'); setTimeout(() => e.remove(), 250); glokEl = null; }
}

// ---------- Кубики ----------
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function setDie(el, v) {
  el.dataset.v = v;
  el.innerHTML = PIPS[v].map((n) => `<i style="grid-area:${Math.ceil(n / 3)}/${((n - 1) % 3) + 1}"></i>`).join('');
}
function rollDice(a, b) {
  const d1 = $('#d1'), d2 = $('#d2');
  d1.classList.add('rolling'); d2.classList.add('rolling');
  SFX.play('dice');
  let n = 0;
  const iv = setInterval(() => {
    setDie(d1, 1 + Math.floor(Math.random() * 6)); setDie(d2, 1 + Math.floor(Math.random() * 6));
    if (++n >= 9) {
      clearInterval(iv); setDie(d1, a); setDie(d2, b);
      d1.classList.remove('rolling'); d2.classList.remove('rolling');
      if (a === b) { $('#dice').classList.add('double'); setTimeout(() => $('#dice') && $('#dice').classList.remove('double'), 1200); }
    }
  }, 70);
}

// ---------- Фишки ----------
function hop(pid, from, steps, delay) {
  animating[pid] = true;
  disp[pid] = from;
  setTimeout(() => {
    let i = 0;
    const step = () => {
      if (!st) return;
      i++;
      disp[pid] = (from + i) % C.N;
      drawTokens(pid);
      SFX.play('hop');
      if (i < steps) setTimeout(step, C.HOP_MS);
      else { animating[pid] = false; const p = byId(pid); if (p) disp[pid] = p.pos; setTimeout(drawTokens, 120); }
    };
    if (steps > 0) step(); else { animating[pid] = false; drawTokens(); }
  }, delay);
}

function drawTokens(hopPid) {
  const layer = $('#tokens');
  if (!layer || !st) return;
  const groups = {};
  st.players.forEach((p) => { if (!p.bankrupt) (groups[disp[p.id]] = groups[disp[p.id]] || []).push(p.id); });
  const seenIds = new Set();
  st.players.forEach((p, idx) => {
    let el = $(`.tok[data-pid="${p.id}"]`, layer);
    if (p.bankrupt) { if (el) el.remove(); return; }
    seenIds.add(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tok'; el.dataset.pid = p.id;
      el.style.setProperty('--c', p.color);
      el.textContent = p.icon;
      layer.appendChild(el);
    }
    const pos = disp[p.id], g = groups[pos] || [p.id], k = g.indexOf(p.id), n = g.length;
    const { x, y } = cellXY(pos);
    // фишки встают рядком в нижней части клетки, чтобы не закрывать название
    const spread = n > 1 ? Math.min(3.4, 10 / (n - 1)) : 0;
    el.style.left = `${((x + 0.5) / 6) * 100}%`;
    el.style.top = `${((y + 0.85) / 6) * 100}%`;
    el.style.setProperty('--dx', `${(k - (n - 1) / 2) * spread}cqw`);
    el.style.setProperty('--dy', `${n > 1 && k % 2 ? -1.2 : 0}cqw`);
    el.classList.toggle('turn', st.players[st.turn] && st.players[st.turn].id === p.id);
    el.classList.toggle('me', p.id === myId);
    if (hopPid === p.id) { el.classList.remove('hopping'); void el.offsetWidth; el.classList.add('hopping'); }
  });
  $$('.tok[data-pid]', layer).forEach((el) => { if (!seenIds.has(el.dataset.pid)) el.remove(); });
  let om = $('.tok.omon', layer);
  if (st.omon !== null) {
    if (!om) { om = document.createElement('div'); om.className = 'tok omon'; om.textContent = '🚔'; layer.appendChild(om); }
    const { x, y } = cellXY(st.omon);
    om.style.left = `${((x + 0.5) / 6) * 100}%`;
    om.style.top = `${((y + 0.5) / 6) * 100}%`;
  } else if (om) om.remove();
}

// ---------- Лента ----------
const SOUND_BY_KIND = { glok: '', buy: 'buy', rent: 'cash', salary: 'cash', win: 'cash', loss: 'lose', sell: 'lose', omon: 'siren', jail: 'bad', police: 'bad', bankrupt: 'lose', goon: 'click', chat: 'chat', join: 'turn' };
function appendLog(l, live) {
  const box = $('#log');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'e k-' + l.kind;
  if (l.kind === 'chat') {
    const p = byId(l.pid);
    div.innerHTML = `<b style="color:${p ? p.color : '#fff'}">${esc(l.name || '?')}:</b> ${esc(l.text)}`;
    if (live) bubble(l.pid, l.text);
  } else div.textContent = l.text;
  box.appendChild(div);
  while (box.children.length > 60) box.firstChild.remove();
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (nearBottom || !live) box.scrollTop = box.scrollHeight;
  if (live) {
    const snd = SOUND_BY_KIND[l.kind];
    if (snd && !(l.kind === 'omon' && !/выехал/.test(l.text))) SFX.play(snd);
    if (l.kind === 'omon' && /выехал/.test(l.text)) flash('ОМОН ВЫЕХАЛ', 'omon');
    if (l.kind === 'bankrupt') flash(l.text.replace('💀 ', ''), 'dead');
  }
}

function bubble(pid, text) {
  const card = $(`.pc[data-pid="${pid}"]`);
  const tok = $(`.tok[data-pid="${pid}"]`);
  const host = tok || card;
  if (!host) return;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  host.appendChild(b);
  setTimeout(() => b.remove(), 2600);
}

// ---------- Эффекты: стрелка, карточка, казино ----------
function showFx(fx) {
  if (fx.type === 'strelka') {
    const a = byId(fx.a), o = byId(fx.o);
    if (!a || !o) return;
    SFX.play('fight'); SFX.vibe([60, 50, 120]);
    const ov = overlay(`
      <div class="fx strelka">
        <div class="fx-title">СТРЕЛКА</div>
        <div class="fx-sub">«${esc(BOARD[fx.cell].name)}»</div>
        <div class="vs">
          <div class="side-a" style="--c:${a.color}"><div class="fx-av">${a.icon}</div><div class="fx-nm">${esc(a.name)}</div><div class="fx-pw" data-final="${fx.aP}">?</div><div class="fx-roll">🎲 ${fx.aRoll} + сила ${fx.aP - fx.aRoll}</div></div>
          <div class="vs-x">VS</div>
          <div class="side-o" style="--c:${o.color}"><div class="fx-av">${o.icon}</div><div class="fx-nm">${esc(o.name)}</div><div class="fx-pw" data-final="${fx.oP}">?</div><div class="fx-roll">🎲 ${fx.oRoll} + сила ${fx.oP - fx.oRoll}</div></div>
        </div>
        <div class="fx-res ${fx.win ? 'good' : 'badr'}">${fx.win ? `${esc(a.name)} отжал точку!` : `${esc(o.name)} отбился`}</div>
      </div>`, 2500);
    let n = 0;
    const iv = setInterval(() => {
      $$('.fx-pw', ov).forEach((e) => { e.textContent = n < 10 ? 1 + Math.floor(Math.random() * 12) : e.dataset.final; });
      if (++n > 10) { clearInterval(iv); ov.classList.add('done'); SFX.play(fx.win ? 'cash' : 'lose'); }
    }, 70);
  } else if (fx.type === 'glok') {
    SFX.play(fx.result ? 'cash' : 'glok'); SFX.vibe([80, 40, 80]);
    closeGlokTask();
    overlay(`<div class="fx glok-fx">
      <div class="glok-card">
        <div class="glok-badge"><span class="glok-face">👮‍♂️</span><span class="glok-shades">🕶️</span></div>
        <div class="glok-name">ДИМА ГЛОК</div>
        <div class="glok-role">надзиратель</div>
        ${fx.line ? `<div class="glok-line">«${esc(fx.line)}»</div>` : ''}
        <div class="glok-title">${esc(fx.title)}</div>
        <div class="glok-text">${esc(fx.text)}</div>
      </div></div>`, fx.result ? 2600 : 3000);
    if (!fx.result) flash('ДИМА ГЛОК ПРИШЁЛ', 'glok');
  } else if (fx.type === 'card') {
    SFX.play('card');
    const p = byId(fx.pid);
    overlay(`<div class="fx card-fx"><div class="cf-inner"><div class="cf-top">📞 Звонок с зоны</div><div class="cf-who">${p ? esc(p.name) : ''}</div><div class="cf-text">${esc(fx.text)}</div></div></div>`, 1700);
  } else if (fx.type === 'casino') {
    const p = byId(fx.pid);
    const reel = ['🍒', '🍋', '💎', '7️⃣', '🔔', '⭐'];
    const final = fx.jackpot ? ['7️⃣', '7️⃣', '7️⃣'] : fx.win ? ['💎', '💎', '🍒'] : ['🍋', '🔔', '🍒'];
    const ov = overlay(`<div class="fx casino"><div class="fx-title">КАЗИНО</div><div class="fx-sub">${p ? esc(p.name) : ''} ставит $${fx.bet}</div><div class="reels"><span>🍒</span><span>🍋</span><span>💎</span></div><div class="fx-res ${fx.win ? 'good' : 'badr'}">${fx.jackpot ? `ДЖЕКПОТ +$${fx.bet * 5}` : fx.win ? `+$${fx.bet * 2}` : `−$${fx.bet}`}</div></div>`, 1450);
    const spans = $$('.reels span', ov);
    let n = 0;
    const iv = setInterval(() => {
      spans.forEach((s, i) => { s.textContent = n > 6 + i * 2 ? final[i] : reel[Math.floor(Math.random() * reel.length)]; });
      SFX.play('tick');
      if (++n > 12) { clearInterval(iv); ov.classList.add('done'); SFX.play(fx.win ? 'win' : 'lose'); }
    }, 70);
  }
}

function overlay(html, ms) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = html;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  setTimeout(() => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 300); }, ms);
  ov.onclick = () => ov.remove();
  return ov;
}
function flash(text, cls) {
  const f = document.createElement('div');
  f.className = 'flash ' + cls;
  f.textContent = text;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1800);
}

// ---------- Окно решения ----------
function rentRows(id) {
  const c = BOARD[id];
  return `<div class="rents">${[0, 1, 2, 3].map((l) => `<div><span>${l ? '★'.repeat(l) : 'база'}</span><b>$${c.rent * Math.pow(2, l)}</b></div>`).join('')}</div>`;
}
function openSheet(q) {
  const key = JSON.stringify(q);
  if (key === sheetKey) return;
  sheetKey = key;
  const me = meP();
  let html = '';
  const c = q.cell != null ? BOARD[q.cell] : null;
  const head = (emoji, title, sub, color) => `<div class="sh-head" style="--g:${color || 'var(--gold)'}"><span class="sh-em">${emoji}</span><div><div class="sh-title">${title}</div>${sub ? `<div class="sh-sub">${sub}</div>` : ''}</div></div>`;
  const btns = (list) => `<div class="sh-btns">${list.map(([v, label, cls]) => `<button class="btn ${cls || ''}" data-choice="${esc(v)}">${label}</button>`).join('')}</div>`;
  switch (q.type) {
    case 'BUY':
      html = head(c.emoji, c.name, 'Ничья точка. Берём под крышу?', GROUPS[c.group]) +
        `<div class="sh-info"><div>Цена <b class="neg">$${c.price}</b></div><div>У тебя <b>$${me.money}</b></div></div>` + rentRows(c.id) +
        `<div class="hint">Обе точки одного цвета — рента ×2. Покупка поднимает розыск 🔥.</div>` +
        btns([['yes', `Крышевать за $${c.price}`, 'gold'], ['no', 'Пас']]);
      break;
    case 'UPGRADE':
      html = head(c.emoji, `Прокачка «${c.name}»`, `Уровень ${'★'.repeat(q.level) || 'база'} → ${'★'.repeat(q.level + 1)}`, GROUPS[c.group]) +
        `<div class="sh-info"><div>Рента сейчас <b>$${rentOf(st.props, c.id)}</b></div><div>Станет <b class="pos">$${c.rent * Math.pow(2, q.level + 1)}</b></div></div>` +
        btns([['yes', `Прокачать за $${q.price}`, 'gold'], ['no', 'Не сейчас']]);
      break;
    case 'GYM':
      html = head('🥊', 'Качалка', 'Нанять братка?') +
        `<div class="sh-info"><div>Братков <b>${me.goons}/${C.MAX_GOONS}</b></div><div>Цена <b class="neg">$${q.price}</b></div></div>` +
        `<div class="hint">Браток садится вместо тебя (менты, ОМОН) и добавляет +1 к силе на стрелке.</div>` +
        btns([['yes', `Нанять за $${q.price}`, 'gold'], ['no', 'Уйти']]);
      break;
    case 'CASINO':
      html = head('🎰', 'Казино «Три топора»', 'Шанс 42% удвоить, 5% — джекпот ×5') +
        btns([...q.bets.map((b) => [String(b), `Ставка $${b}`, b === q.bets[q.bets.length - 1] ? 'red' : '']), ['skip', 'Не играю']]);
      break;
    case 'STRELKA': {
      const o = byId(q.owner);
      const myPow = me.auth + me.goons, oPow = o ? o.auth + o.goons : 0;
      html = head('⚔️', 'Чужая территория', `«${c.name}» держит ${esc(q.ownerName)}`, o && o.color) +
        `<div class="sh-info"><div>Доля хозяину <b class="neg">$${q.rent}</b></div><div>Штраф за слив <b class="neg">$${q.rent * 2}</b></div></div>` +
        `<div class="power"><div><span>Ты</span><b>🎲 + ${myPow}</b></div><div class="vs-x">VS</div><div><span>${esc(q.ownerName)}</span><b>🎲 + ${oPow}</b></div></div>` +
        `<div class="hint">Сила = авторитет + братки. Победа — точка твоя (−1 звезда), +1 авторитет. Ничья за хозяином.</div>` +
        btns([['pay', `Заплатить $${q.rent}`], ['fight', 'Забить стрелку', 'red']]);
      break;
    }
    case 'JAIL':
      html = head('🔒', 'Ты в тюрьме', 'Сидишь один ход') +
        btns([['pay', `Залог $${q.bail} и бросить`, 'gold'], ['wait', 'Отсидеть ход']]);
      break;
  }
  html += `<div class="sh-timer"><i id="shbar"></i></div>`;
  $('#sheet').innerHTML = html;
  $$('#sheet [data-choice]').forEach((b) => b.onclick = () => {
    SFX.play('click'); SFX.vibe(10);
    socket.emit('decide', { choice: b.dataset.choice });
    $$('#sheet [data-choice]').forEach((x) => x.disabled = true);
  });
  $$('#sheet [data-choice]').forEach((b) => { if ((b.dataset.choice === 'yes' || /^\d+$/.test(b.dataset.choice)) && me.money < Number(b.dataset.choice === 'yes' ? q.price : b.dataset.choice)) b.disabled = true; });
  $('#sheetback').classList.add('show');
}
function closeSheet() {
  if (!sheetKey) return;
  sheetKey = '';
  const b = $('#sheetback');
  if (b) b.classList.remove('show');
}

// ---------- Таймер ----------
function tickTimer() {
  requestAnimationFrame(tickTimer);
  if (screen !== 'game' || !st) return;
  const bar = $('#timerbar'), sbar = $('#shbar');
  const frac = deadline && st.total ? Math.max(0, (deadline - Date.now()) / st.total) : 0;
  if (bar) { bar.style.transform = `scaleX(${frac})`; bar.parentElement.classList.toggle('low', frac > 0 && frac < 0.25); }
  if (sbar) sbar.style.transform = `scaleX(${frac})`;
}
requestAnimationFrame(tickTimer);

// ---------- Инфо о клетке, меню, правила ----------
function showCellInfo(id) {
  const c = BOARD[id];
  const pr = st && st.props[id];
  const o = pr && byId(pr.owner);
  const desc = {
    start: `Проходишь — получаешь $${C.SALARY}.`, gym: `Можно нанять братка за $${C.GOON_PRICE} (макс ${C.MAX_GOONS}).`,
    jail: 'Просто навестить кентов. Сюда отправляют менты.', card: 'Тянешь карточку «Звонок с зоны» — может повезти, а может и нет.',
    casino: 'Ставки $50–200. 42% — удвоил, 5% — джекпот ×5.', tax: 'Отдаёшь 10% налички (минимум $20).',
    police: 'Отправляют в тюрьму. Браток может сесть вместо тебя.',
  }[c.type];
  modal(`<div class="sh-head" style="--g:${c.group ? GROUPS[c.group] : 'var(--gold)'}"><span class="sh-em">${c.emoji}</span><div><div class="sh-title">${c.name}</div>
    <div class="sh-sub">${c.type === 'prop' ? (o ? `Крыша: <b style="color:${o.color}">${esc(o.name)}</b>${pr.level ? ' ' + '★'.repeat(pr.level) : ''}` : `Свободна · $${c.price}`) : ''}</div></div></div>
    ${c.type === 'prop' ? rentRows(id) + `<div class="hint">Прокачка: $${c.up} за звезду. Полный район — рента ×2 на базе.${o ? ` Сейчас рента: <b>$${rentOf(st.props, id)}</b>` : ''}</div>` : `<p class="desc">${desc}</p>`}`);
}

function showMenu() {
  const m = modal(`<div class="menu">
    <button class="btn" data-a="rules">📖 Как играть</button>
    <button class="btn" data-a="sound">${SFX.on ? '🔇 Выключить звук' : '🔊 Включить звук'}</button>
    <button class="btn" data-a="link">🔗 Ссылка на игру</button>
    <button class="btn red" data-a="quit">🏳️ Сдаться и выйти</button>
  </div>`);
  $$('[data-a]', m).forEach((b) => b.onclick = () => {
    const a = b.dataset.a;
    m.closeModal();
    if (a === 'rules') showRules();
    if (a === 'sound') { SFX.on = !SFX.on; updSound(); }
    if (a === 'link') copyText(`${shareUrl}/?room=${st.code}`);
    if (a === 'quit' && confirm('Точно сдаться? Твои точки уйдут банку.')) socket.emit('leave');
  });
}

function showRules() {
  modal(`<div class="rules">
    <h2>Как играть</h2>
    <p>🎲 Бросаешь две кости и идёшь по кругу. Прошёл <b>Общак</b> — получи $${C.SALARY}. Дубль — ходишь ещё раз, три дубля подряд — к ментам.</p>
    <p>🏪 <b>Свободная точка</b> — можно взять под крышу. Своя — прокачать до ★★★ (каждая звезда удваивает ренту). Оба цвета района у тебя — рента ×2.</p>
    <p>⚔️ <b>Чужая точка</b> — плати долю или забивай <b>стрелку</b>: 🎲 + авторитет + братки против хозяина. Выиграл — точка твоя. Слил — штраф ×2 и минус браток.</p>
    <p>🥊 <b>Качалка</b> — нанимай братков ($${C.GOON_PRICE}). Они сидят за тебя и дают силу на стрелках.</p>
    <p>🔥 <b>Розыск</b> растёт от покупок, прокачек, стрелок и выигрышей. На 5 огоньках выезжает <b>ОМОН</b> и едет против хода. Кого накроет — штраф $${C.OMON_FINE} или минус браток.</p>
    <p>👮 <b>Надзиратель Дима Глок</b> приходит когда захочет: шмонает богатых, путает ведомости, гоняет всех назад, опечатывает точки и даёт «задания». Иногда кнопку надо жать быстрее всех, а иногда это ловушка. Отключается в лобби.</p>
    <p>💸 Не хватает денег — точки автоматически скидываются банку за полцены. Ушёл в минус совсем — выбываешь.</p>
    <p>🏆 Побеждает последний оставшийся, или самый богатый, когда кончатся круги.</p>
  </div>`);
}

function modal(html) {
  const back = document.createElement('div');
  back.className = 'sheet-back show modal';
  back.innerHTML = `<div class="sheet"><button class="close" aria-label="Закрыть">✕</button>${html}</div>`;
  document.body.appendChild(back);
  back.closeModal = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 250); };
  back.onclick = (e) => { if (e.target === back || e.target.classList.contains('close')) back.closeModal(); };
  return back;
}

// ---------- Финал ----------
function renderOver() {
  const w = byId(st.winner);
  const host = st.hostId === myId;
  const medals = ['🥇', '🥈', '🥉'];
  app.innerHTML = `
  <section class="screen over">
    <div class="confetti">${Array.from({ length: 36 }, (_, i) => `<i style="left:${Math.random() * 100}%;animation-delay:${Math.random() * 2}s;background:${['#ffcc33', '#ff4757', '#3d8bff', '#2ed573', '#b56bff'][i % 5]}"></i>`).join('')}</div>
    <div class="crown">👑</div>
    <h1 class="win-name" style="color:${w ? w.color : '#fff'}">${w ? esc(w.name) : 'Никто'}</h1>
    <div class="win-sub">${w && w.id === myId ? 'Город твой. Уважение.' : 'забрал весь город'}</div>
    <div class="standings">
      ${(st.standings || []).map((s, i) => { const p = byId(s.id); if (!p) return ''; return `
        <div class="st-row ${p.id === myId ? 'me' : ''}" style="--c:${p.color}">
          <span class="pl-place">${medals[i] || i + 1}</span><span class="av">${p.icon}</span><span class="nm">${esc(p.name)}</span>
          <span class="worth">${s.bankrupt ? 'разорён' : '$' + s.worth}</span>
        </div>`; }).join('')}
    </div>
    <div class="row">
      ${host ? '<button class="btn gold grow" id="again">Ещё партию</button>' : '<div class="wait">Босс может начать новую партию</div>'}
      <button class="btn" id="out">Выйти</button>
    </div>
  </section>`;
  if ($('#again')) $('#again').onclick = () => socket.emit('rematch');
  $('#out').onclick = () => socket.emit('leave');
}

// ---------- Утилиты ----------
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
function copyText(text) {
  const ok = () => toast('Ссылка скопирована');
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(ok, () => fallback());
  fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, 999);
    let done = false;
    try { done = document.execCommand('copy'); } catch {}
    ta.remove();
    if (done) ok(); else prompt('Скопируй ссылку:', text);
  }
}

// пока сервер не ответил — показываем главный экран
if (!token) render();
else setTimeout(() => { if (!screen) render(); }, 1500);
})();
