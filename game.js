(() => {
'use strict';
const { BOARD, GROUPS, C, cellXY, rentOf } = window.G;
const { CHARS, portrait } = window.ART;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const app = $('#app');
const QUICK = ['👊', '😂', '💸', '🔥', '🤝', 'Ну ты жук', 'Стрелка?', 'Везёт же', 'Дима, нет!'];
const CHAR_KEYS = Object.keys(CHARS);

let token = LS.get('bratva_token', null);
let session = LS.get('bratva_session', null);       // сессия Telegram (подписана сервером)
let me = LS.get('bratva_me', null);                 // профиль из Telegram
let device = LS.get('bratva_device', null);
if (!device) { device = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); LS.set('bratva_device', device); }
let profile = LS.get('bratva_profile', { name: '', char: 'boec' });
if (!CHARS[profile.char]) profile.char = 'boec';
let config = { tg: false, bot: '' };
let myId = null, st = null, screen = null, deadline = null;
let shareUrl = location.origin;
const urlRoom = new URLSearchParams(location.search).get('room') || '';
const seen = { log: 0, dice: 0, move: 0, fx: 0, turnKey: '' };
const disp = {}, animating = {}, prevMoney = {};
let sheetKey = '';
const portraitCache = {};
const pic = (key) => portraitCache[key] || (portraitCache[key] = portrait(key, key));
const avatar = (p) => (p && p.photo ? `<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">` : pic(p && p.char));

// ---------- Telegram Mini App ----------
const inTelegram = /tgWebAppData=/.test(location.hash) || /tgWebAppData=/.test(location.search);
function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
async function telegramAppLogin() {
  try {
    await loadScript('https://telegram.org/js/telegram-web-app.js');
    const W = window.Telegram && window.Telegram.WebApp;
    if (!W) return;
    W.ready(); W.expand();
    try { W.setHeaderColor('#0b0a10'); W.setBackgroundColor('#0b0a10'); W.disableVerticalSwipes && W.disableVerticalSwipes(); } catch {}
    const sp = W.initDataUnsafe && W.initDataUnsafe.start_param;
    if (sp && /^\d{4}$/.test(sp) && !urlRoomState.code) urlRoomState.code = sp;
    if (W.initData) await authWith('/api/auth/webapp', { initData: W.initData });
  } catch {}
}
const urlRoomState = { code: urlRoom };
async function authWith(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) return toast(d.error || 'Не получилось войти');
    session = d.session; me = d.profile;
    LS.set('bratva_session', session); LS.set('bratva_me', me);
    if (!profile.name) { profile.name = me.name.slice(0, 12); LS.set('bratva_profile', profile); }
    if (screen === 'home') renderHome();
    toast(`Здорово, ${me.name}!`);
  } catch { toast('Нет связи с сервером'); }
}
window.onTelegramAuth = (user) => authWith('/api/auth/telegram', user);
function logout() { session = null; me = null; LS.set('bratva_session', null); LS.set('bratva_me', null); renderHome(); }

fetch('/api/config').then((r) => r.json()).then((d) => { config = d; if (screen === 'home') renderHome(); }).catch(() => {});
if (inTelegram) telegramAppLogin();

// ---------- Сеть ----------
const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
socket.on('connect', () => { setConn(true); socket.emit('hello', { token }); });
socket.on('disconnect', () => setConn(false));
socket.on('connect_error', () => {
  if (!screen) app.innerHTML = '<section class="screen home"><div class="logo"><h1>БРАТВА</h1><div class="logo-sub pulse">Сервер просыпается, до минуты…</div></div></section>';
});
socket.on('you', (info) => {
  if (info) { myId = info.id; token = info.token; LS.set('bratva_token', token); return; }
  if (token && st && st.status === 'PLAYING') toast('Сервер перезапустился — сходка потерялась. Создай новую');
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
const ident = () => ({ session, device });

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
    updateGame();
    screen = 'over-pending';
    closeGlokTask();
    SFX.play('victory');
    return setTimeout(() => { if (st && st.status === 'GAMEOVER') { screen = 'over'; renderOver(); } }, 1600);
  }
  if (want === 'over' && screen === 'over-pending') return;
  if (screen === 'top' && (want === 'home' || want === 'over')) return;
  screen = want;
  if (want === 'home') renderHome();
  else if (want === 'lobby') renderLobby();
  else renderOver();
}

// ---------- Главный экран ----------
function charCard(k, on) {
  const c = CHARS[k];
  return `<button class="char ${on ? 'on' : ''}" data-char="${k}" aria-label="${c.name}">
    <span class="char-pic">${pic(k)}</span><b>${c.name}</b><small>${c.perk}</small></button>`;
}

function renderHome() {
  const tgBlock = me
    ? `<div class="me-chip">${me.photo ? `<img src="${esc(me.photo)}" alt="" referrerpolicy="no-referrer">` : '<span class="me-ph">✈️</span>'}
        <div><b>${esc(me.name)}</b><small>Вход через Telegram · в топе под этим именем</small></div>
        ${inTelegram ? '' : '<button class="link small-link" id="logout">выйти</button>'}</div>`
    : config.tg && config.bot && !inTelegram
      ? `<div class="tg-login"><div class="tg-hint">Войди через Telegram, чтобы попасть в топ с аватаркой</div><div id="tgw"></div></div>`
      : '';
  app.innerHTML = `
  <section class="screen home">
    <div class="logo">
      <div class="logo-top">монополия девяностых</div>
      <h1>БРАТВА</h1>
      <div class="logo-sub">крышуй точки · забивай стрелки · не попадись ОМОНу</div>
    </div>
    ${tgBlock}
    <div class="card form">
      <label for="name">Погоняло</label>
      <input id="name" maxlength="12" placeholder="Например, Кабан" value="${esc(profile.name)}" autocomplete="off" enterkeyhint="done">
      <label>Персонаж <span class="lbl-hint">у каждого своя фишка</span></label>
      <div class="chars">${CHAR_KEYS.map((k) => charCard(k, k === profile.char)).join('')}</div>
      <button class="btn gold big" id="create">Создать сходку</button>
      <div class="or"><span>или зайти по коду</span></div>
      <div class="row">
        <input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="0000" value="${esc(urlRoomState.code)}">
        <button class="btn" id="join">Войти</button>
      </div>
    </div>
    <div class="row centered home-links"><button class="btn small" id="top">🏆 Топ братвы</button><button class="btn small" id="rules">📖 Как играть</button></div>
  </section>`;
  const nameEl = $('#name');
  nameEl.addEventListener('input', () => { profile.name = nameEl.value; LS.set('bratva_profile', profile); });
  $$('.char').forEach((b) => b.onclick = () => {
    profile.char = b.dataset.char; LS.set('bratva_profile', profile);
    $$('.char').forEach((x) => x.classList.toggle('on', x === b)); SFX.play('click');
  });
  const sel = $('.char.on'); if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
  const go = (ev, extra) => {
    if (!profile.name.trim() && !me) { nameEl.focus(); return toast('Введи погоняло'); }
    socket.emit(ev, { name: profile.name.trim() || (me && me.name), char: profile.char, ...ident(), ...extra });
  };
  $('#create').onclick = () => go('create');
  $('#join').onclick = () => {
    const code = $('#code').value.trim();
    if (!/^\d{4}$/.test(code)) return toast('Код — 4 цифры');
    go('join', { code });
  };
  $('#rules').onclick = showRules;
  $('#top').onclick = () => renderTop();
  if ($('#logout')) $('#logout').onclick = logout;
  if ($('#tgw')) {
    const s = document.createElement('script');
    s.async = true; s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', config.bot);
    s.setAttribute('data-size', 'large'); s.setAttribute('data-radius', '12');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    $('#tgw').appendChild(s);
  }
  if (urlRoomState.code && !profile.name && !me) nameEl.focus();
}

// ---------- Топ ----------
let topSort = 'wins';
async function renderTop() {
  screen = 'top';
  const tabs = [['wins', 'Победы'], ['rate', 'Винрейт'], ['best', 'Капитал'], ['strelka', 'Стрелки'], ['games', 'Партии']];
  app.innerHTML = `
  <section class="screen top">
    <div class="top-head"><button class="icon-btn" id="back" aria-label="Назад">←</button><h2>Топ братвы</h2><span></span></div>
    <div class="seg tabs">${tabs.map(([k, l]) => `<button data-sort="${k}" class="${k === topSort ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="top-list" id="toplist"><div class="wait pulse">Загружаю…</div></div>
  </section>`;
  $('#back').onclick = () => { screen = null; render(); };
  $$('[data-sort]').forEach((b) => b.onclick = () => { topSort = b.dataset.sort; renderTop(); });
  try {
    const d = await (await fetch('/api/top?sort=' + topSort)).json();
    if (screen !== 'top') return;
    const myKey = me ? 'tg:' + me.id : 'guest:' + device;
    const medal = ['🥇', '🥈', '🥉'];
    const val = (r) => ({
      wins: `<b>${r.wins}</b><small>побед</small>`,
      rate: `<b>${r.games ? Math.round((r.wins / r.games) * 100) : 0}%</b><small>${r.wins}/${r.games}</small>`,
      best: `<b>$${r.best}</b><small>рекорд</small>`,
      strelka: `<b>${r.strelkaWon}</b><small>из ${r.strelkaTotal}</small>`,
      games: `<b>${r.games}</b><small>партий</small>`,
    }[topSort]);
    $('#toplist').innerHTML = d.rows.length ? d.rows.map((r, i) => `
      <div class="top-row ${r.key === myKey ? 'me' : ''}">
        <span class="t-place">${medal[i] || i + 1}</span>
        <span class="t-av">${r.photo ? `<img src="${esc(r.photo)}" alt="" referrerpolicy="no-referrer">` : pic(r.char)}</span>
        <span class="t-name"><b>${esc(r.name)}${r.tg ? ' <i class="tg-badge" title="Telegram">✈</i>' : ''}</b>
          <small>${r.username ? '@' + esc(r.username) + ' · ' : ''}${CHARS[r.char] ? CHARS[r.char].name : ''} · ${r.games} парт.${r.titles ? ` · 🏅${r.titles}` : ''}</small></span>
        <span class="t-val">${val(r)}</span>
      </div>`).join('') + (d.db === 'file' ? '<div class="hint center-t">Топ хранится без базы и обнулится при перезапуске сервера. Подключи базу — см. README.</div>' : '')
      : '<div class="wait">Пока пусто. Сыграй первую партию — и ты в топе.</div>';
  } catch { $('#toplist').innerHTML = '<div class="wait">Не загрузилось. Проверь связь.</div>'; }
}

// ---------- Лобби ----------
function renderLobby() {
  const host = st.hostId === myId;
  const link = `${shareUrl}/?room=${st.code}`;
  const full = st.players.length >= C.MAX_PLAYERS;
  const mine = meP();
  app.innerHTML = `
  <section class="screen lobby">
    <div class="lobby-head"><div class="muted up">Код сходки</div><div class="code">${esc(st.code)}</div></div>
    <div class="card qr-card">
      <img class="qr" src="/api/qr?u=${encodeURIComponent(link)}" alt="QR-код для входа">
      <div class="qr-text">
        <b>Позови братву</b>
        <span>Наведи камеру телефона на код — игра откроется сразу с этой сходкой.</span>
        <code>${esc(link)}</code>
        <div class="row"><button class="btn small" id="copy">Скопировать</button>${navigator.share ? '<button class="btn small" id="share">Отправить</button>' : ''}</div>
      </div>
    </div>
    <div class="list-title">Братва <span>${st.players.length}/${C.MAX_PLAYERS}</span></div>
    <div class="plist">
      ${st.players.map((p) => `
        <div class="pl" style="--c:${p.color}">
          <span class="pl-pic">${avatar(p)}</span>
          <span class="nm"><b>${esc(p.name)}</b><small>${CHARS[p.char].emoji} ${CHARS[p.char].name} — ${CHARS[p.char].perk}</small></span>
          ${p.id === st.hostId ? '<span class="tag gold">босс</span>' : ''}
          ${p.bot ? '<span class="tag">бот</span>' : ''}
          ${p.tg ? '<span class="tag tgt">✈</span>' : ''}
          ${p.id === myId ? '<span class="tag me">ты</span>' : ''}
          ${!p.connected ? '<span class="tag off">нет связи</span>' : ''}
          ${host && p.id !== myId ? `<button class="x" data-kick="${p.id}" aria-label="Убрать">✕</button>` : ''}
        </div>`).join('')}
    </div>
    ${mine ? `<div class="muted up">Сменить персонажа</div><div class="chars mini">${CHAR_KEYS.map((k) => charCard(k, k === mine.char)).join('')}</div>` : ''}
    ${host ? `
      <div class="settings">
        <div class="muted up">Длина партии</div>
        <div class="seg">${[10, 20, 30, 0].map((n) => `<button data-rounds="${n}" class="${st.settings.rounds === n ? 'on' : ''}">${n ? n + ' кругов' : 'до конца'}</button>`).join('')}</div>
        <button class="glok-toggle ${st.settings.glok ? 'on' : ''}" id="glokT"><span class="gt-av">${pic('glok')}</span><span><b>Смотрящий Дима Глок</b><small>${st.settings.glok ? 'Придёт в любой момент и всё испортит' : 'Выключен. Скучно будет…'}</small></span><i></i></button>
        <div class="hint">${st.settings.rounds ? 'Когда круги закончатся, победит самый богатый (деньги + точки).' : 'Играем, пока не останется один. С 25-го круга начинается беспредел — рента растёт.'}</div>
      </div>
      <div class="row">
        <button class="btn" id="bot" ${full ? 'disabled' : ''}>+ Бот</button>
        <button class="btn gold grow" id="start" ${st.players.length < 2 ? 'disabled' : ''}>${st.players.length < 2 ? 'Ждём братву…' : 'Начать замес'}</button>
      </div>` : `${st.settings.glok ? '<div class="hint center-t">😎 В этой партии район держит Дима Глок</div>' : ''}<div class="wait pulse">Ждём, когда босс начнёт…</div>`}
    <div class="row centered"><button class="link" id="rules">Как играть</button><button class="link" id="leave">Выйти</button></div>
  </section>`;
  $('#copy').onclick = () => copyText(link);
  if ($('#share')) $('#share').onclick = () => navigator.share({ title: 'Братва', text: `Заходи на сходку ${st.code}`, url: link }).catch(() => {});
  $$('[data-kick]').forEach((b) => b.onclick = () => socket.emit('kick', { id: b.dataset.kick }));
  $$('[data-rounds]').forEach((b) => b.onclick = () => socket.emit('settings', { rounds: Number(b.dataset.rounds) }));
  $$('.chars.mini .char').forEach((b) => b.onclick = () => {
    profile.char = b.dataset.char; LS.set('bratva_profile', profile);
    socket.emit('setChar', { char: b.dataset.char }); SFX.play('click');
  });
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
    ${c.price ? `<span class="pr">$${c.price}</span>` : c.type === 'start' ? '<span class="pr pot" id="potcell"></span>' : ''}
    <span class="lvl"></span>
  </div>`;
}

function buildGame() {
  syncSeen();
  app.innerHTML = `
  <section class="screen game">
    <header class="topbar">
      <div class="tb-left"><span class="brand">БРАТВА</span><span class="pill" id="round"></span><span class="pill hot" id="infl" hidden></span></div>
      <div class="tb-right">
        <span class="conn" id="conn" title="Связь с сервером"></span>
        <button class="icon-btn" id="trade" aria-label="Сделка">🤝</button>
        <button class="icon-btn" id="snd" aria-label="Звук"></button>
        <button class="icon-btn" id="menu" aria-label="Меню">☰</button>
      </div>
    </header>
    <div class="layout">
      <div class="board-wrap"><div class="board" id="board">
        ${BOARD.map(cellHTML).join('')}
        <div class="center">
          <div class="watermark">БРАТВА</div>
          <div class="center-top"><div class="heat" id="heat"></div><div class="pot-badge" id="pot"></div></div>
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
    <div class="offers" id="offers"></div>
  </section>`;
  $('#roll').onclick = () => { socket.emit('roll'); $('#roll').disabled = true; SFX.vibe(15); };
  $('#snd').onclick = () => { SFX.on = !SFX.on; updSound(); };
  $('#menu').onclick = showMenu;
  $('#trade').onclick = showTrade;
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
  const mine = curP() && curP().id === myId, cp = curP();
  $('#round').textContent = `Круг ${st.round}${st.settings.rounds ? ' / ' + st.settings.rounds : ''}`;
  const infl = $('#infl');
  infl.hidden = !(st.inflation > 1);
  infl.textContent = `🔥 рента ×${st.inflation}`;

  BOARD.forEach((c) => {
    const el = $('#cell' + c.id), pr = st.props[c.id];
    const owner = pr && byId(pr.owner);
    el.classList.toggle('owned', !!owner);
    el.classList.toggle('omon-here', st.omon === c.id);
    el.classList.toggle('sealed', !!(st.sealed && st.sealed.cell === c.id && st.round <= st.sealed.until));
    if (owner) el.style.setProperty('--o', owner.color); else el.style.removeProperty('--o');
    if (c.type === 'prop') {
      $('.pr', el).textContent = owner ? `💸$${rentOf(st.props, c.id) * (st.inflation || 1)}` : `$${c.price}`;
      $('.lvl', el).textContent = pr && pr.level ? '★'.repeat(pr.level) : '';
    }
  });
  const pc = $('#potcell'); if (pc) pc.textContent = st.pot ? `🏦$${st.pot}` : '';

  $('#heat').innerHTML = `<span class="lbl">розыск</span>` + Array.from({ length: C.MAX_HEAT }, (_, i) => `<span class="fl ${i < st.heat ? 'on' : ''}">🔥</span>`).join('');
  $('#pot').innerHTML = st.pot ? `джекпот Общака <b>$${st.pot}</b>` : '';
  $('#board').classList.toggle('raid', st.omon !== null);

  if (st.dice && st.dice.seq !== seen.dice) { seen.dice = st.dice.seq; rollDice(st.dice.a, st.dice.b); }
  else if (!$('#d1').dataset.v) { setDie($('#d1'), st.dice ? st.dice.a : 5); setDie($('#d2'), st.dice ? st.dice.b : 2); }

  if (st.lastMove && st.lastMove.seq !== seen.move) {
    seen.move = st.lastMove.seq;
    hop(st.lastMove.pid, st.lastMove.from, st.lastMove.steps, st.lastMove.delay || 0);
  }
  st.players.forEach((p) => { if (!animating[p.id]) disp[p.id] = p.pos; });
  drawTokens();

  const counts = {};
  Object.values(st.props).forEach((v) => { counts[v.owner] = (counts[v.owner] || 0) + 1; });
  $('#players').innerHTML = st.players.map((p, i) => {
    const delta = prevMoney[p.id] != null ? p.money - prevMoney[p.id] : 0;
    return `<div class="pc ${i === st.turn ? 'turn' : ''} ${p.bankrupt ? 'dead' : ''} ${p.id === myId ? 'me' : ''}" style="--c:${p.color}" data-pid="${p.id}">
      <span class="pc-pic">${avatar(p)}</span>
      <div class="pc-body">
        <div class="pc-top"><span class="nm">${esc(p.name)}</span>${p.jail ? '<span title="В тюрьме">🔒</span>' : ''}${!p.connected ? '<span title="Нет связи">📴</span>' : ''}</div>
        <div class="money">${p.bankrupt ? 'РАЗОРЁН' : '$' + p.money}${delta ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>` : ''}</div>
        <div class="stats"><span title="Авторитет">👑${p.auth}</span><span title="Братки">🥊${p.goons}</span><span title="Точки">🏠${counts[p.id] || 0}</span></div>
      </div>
    </div>`;
  }).join('');
  st.players.forEach((p) => { prevMoney[p.id] = p.money; });
  const turnCard = $('.pc.turn'), pl = $('#players');
  if (turnCard && pl.scrollWidth > pl.clientWidth) pl.scrollTo({ left: turnCard.offsetLeft - 8, behavior: 'smooth' });

  const roll = $('#roll');
  const name = cp ? esc(cp.name) : '';
  let status = '';
  if (st.phase === 'ROLL') status = mine ? '<b>Твой ход!</b>' : `Ходит <b style="color:${cp.color}">${name}</b>`;
  else if (st.phase === 'MOVING') status = `<b style="color:${cp.color}">${name}</b> едет…`;
  else if (st.phase === 'DECIDE') status = mine ? '<b>Решай!</b>' : `<b style="color:${cp.color}">${name}</b> ${pendingText(st.pending)}`;
  else if (st.phase === 'ANIM') status = '…';
  else if (st.phase === 'GLOK') status = '😎 <b>Дима Глок</b> решает вопросики…';
  $('#status').innerHTML = status;
  roll.hidden = !(mine && st.phase === 'ROLL');
  roll.disabled = false;
  const meNow = meP();
  $('#trade').hidden = !meNow || meNow.bankrupt;

  const key = `${st.turn}:${st.round}:${st.phase}`;
  if (mine && st.phase === 'ROLL' && key !== seen.turnKey) { SFX.play('turn'); SFX.vibe([30, 40, 30]); }
  seen.turnKey = key;

  st.logs.forEach((l) => { if (l.id > seen.log) { seen.log = l.id; appendLog(l, true); } });
  if (st.fx && st.fx.seq !== seen.fx) { seen.fx = st.fx.seq; showFx(st.fx); }
  updateGlokTask();
  updateOffers();

  if (mine && st.phase === 'DECIDE' && st.pending) openSheet(st.pending);
  else closeSheet();

  if (meNow && meNow.bankrupt && !$('.spectator')) $('#status').insertAdjacentHTML('afterend', '<div class="spectator">ты разорён — смотришь игру</div>');
}

function pendingText(q) {
  if (!q) return 'думает';
  const c = q.cell != null ? `«${BOARD[q.cell].name}»` : '';
  return { BUY: `думает купить ${c}`, UPGRADE: `прокачивает ${c}?`, GYM: 'выбирает братка', CASINO: 'у рулетки…', STRELKA: `на чужой точке ${c}`, JAIL: 'сидит в тюрьме' }[q.type] || 'думает';
}

// ---------- Задания Димы Глока ----------
let glokSeq = 0, glokEl = null;
function glokCard(inner) {
  return `<div class="fx glok-fx"><div class="glok-card">
    <div class="glok-badge">${pic('glok')}</div>
    <div class="glok-name">ДИМА ГЛОК</div>
    <div class="glok-role">смотрящий за районом</div>${inner}</div></div>`;
}
function updateGlokTask() {
  const t = st.glokTask;
  if (!t) return closeGlokTask();
  if (t.seq === glokSeq && glokEl) {
    const b = $('.glok-btn', glokEl);
    if (b && t.taps.includes(myId)) { b.disabled = true; b.textContent = t.kind === 'race' ? 'Нажал! Ждём…' : 'Ну-ну…'; }
    return;
  }
  closeGlokTask();
  glokSeq = t.seq;
  const mp = meP(), dead = !mp || mp.bankrupt, isRace = t.kind === 'race';
  SFX.play('glok'); SFX.vibe([100, 60, 100]);
  flash('ДИМА ГЛОК ПРИШЁЛ', 'glok');
  glokEl = document.createElement('div');
  glokEl.className = 'overlay show glok-task';
  glokEl.innerHTML = glokCard(`
    <div class="glok-line">«${esc(t.line)}»</div>
    <div class="glok-title">${isRace ? 'КТО ПЕРВЫЙ — ТОМУ $' + t.prize : 'ХАЛЯВА ОТ ДИМЫ'}</div>
    <div class="glok-text">${isRace ? 'Жми кнопку быстрее всех. Тормозам — ничего.' : 'Дима сегодня щедрый. Бери, пока дают… или не надо?'}</div>
    <button class="btn ${isRace ? 'gold' : 'red'} big glok-btn" ${dead ? 'disabled' : ''}>${isRace ? 'Я ЗДЕСЬ!' : 'ЗАБРАТЬ $200 👀'}</button>
    <div class="sh-timer"><i class="glok-bar" style="animation-duration:${t.ms}ms"></i></div>`);
  document.body.appendChild(glokEl);
  const btn = $('.glok-btn', glokEl);
  btn.onclick = () => { socket.emit('glok', { seq: t.seq }); btn.disabled = true; SFX.play('click'); SFX.vibe(20); btn.textContent = isRace ? 'Нажал! Ждём…' : 'Ну-ну…'; };
}
function closeGlokTask() {
  if (glokEl) { const e = glokEl; e.classList.remove('show'); setTimeout(() => e.remove(), 250); glokEl = null; }
}

// ---------- Сделки ----------
function updateOffers() {
  const box = $('#offers');
  if (!box) return;
  const list = (st.offers || []).filter((o) => o.to === myId || o.from === myId);
  const key = list.map((o) => o.id).join(',');
  if (box.dataset.key === key) return;
  const fresh = list.some((o) => o.to === myId && !(box.dataset.key || '').includes(o.id));
  box.dataset.key = key;
  if (fresh) { SFX.play('trade'); SFX.vibe([40, 30, 40]); }
  box.innerHTML = list.map((o) => {
    const from = byId(o.from), to = byId(o.to), c = BOARD[o.cell];
    if (!from || !to) return '';
    const incoming = o.to === myId;
    const text = o.mode === 'sell'
      ? (incoming ? `<b>${esc(from.name)}</b> продаёт тебе «${c.name}»` : `Ты предложил ${esc(to.name)} купить «${c.name}»`)
      : (incoming ? `<b>${esc(from.name)}</b> хочет выкупить твою «${c.name}»` : `Ты хочешь выкупить у ${esc(to.name)} «${c.name}»`);
    return `<div class="offer ${incoming ? 'in' : 'out'}" style="--g:${GROUPS[c.group]}">
      <span class="of-em">${c.emoji}</span><div class="of-text">${text}<div class="of-price">за <b>$${o.price}</b> <small>(цена банка $${c.price})</small></div></div>
      ${incoming ? `<div class="of-btns"><button class="btn small gold" data-ok="${o.id}">Да</button><button class="btn small" data-no="${o.id}">Нет</button></div>` : '<span class="of-wait pulse">ждём…</span>'}
      <i class="of-bar" style="animation-duration:${o.ms}ms"></i></div>`;
  }).join('');
  $$('[data-ok]', box).forEach((b) => b.onclick = () => { socket.emit('offerReply', { id: b.dataset.ok, accept: true }); b.closest('.offer').remove(); });
  $$('[data-no]', box).forEach((b) => b.onclick = () => { socket.emit('offerReply', { id: b.dataset.no, accept: false }); b.closest('.offer').remove(); });
}

function showTrade() {
  const mp = meP();
  if (!mp || mp.bankrupt) return;
  const others = st.players.filter((p) => p.id !== myId && !p.bankrupt);
  if (!others.length) return toast('Не с кем торговать');
  let to = others[0].id, mode = 'sell', cell = null;
  const m = modal('<div id="tradebox"></div>');
  const draw = () => {
    const owner = mode === 'sell' ? myId : to;
    const cells = Object.entries(st.props).filter(([, v]) => v.owner === owner).map(([k]) => +k);
    if (!cells.includes(cell)) cell = cells[0] ?? null;
    const c = cell != null ? BOARD[cell] : null;
    const toP = byId(to);
    $('#tradebox', m).innerHTML = `
      <div class="sh-head"><span class="sh-em">🤝</span><div><div class="sh-title">Сделка</div><div class="sh-sub">Точки можно продавать и покупать друг у друга</div></div></div>
      <div class="muted up">С кем</div>
      <div class="tr-people">${others.map((p) => `<button class="tr-p ${p.id === to ? 'on' : ''}" data-to="${p.id}" style="--c:${p.color}"><span class="pl-pic">${avatar(p)}</span>${esc(p.name)}</button>`).join('')}</div>
      <div class="seg two"><button data-mode="sell" class="${mode === 'sell' ? 'on' : ''}">Продать свою</button><button data-mode="buy" class="${mode === 'buy' ? 'on' : ''}">Купить у ${esc(toP.name)}</button></div>
      <div class="muted up">Точка</div>
      <div class="tr-cells">${cells.length ? cells.map((k) => { const b = BOARD[k], pr = st.props[k]; return `<button class="tr-c ${k === cell ? 'on' : ''}" data-cell="${k}" style="--g:${GROUPS[b.group]}">${b.emoji} ${b.name}${pr.level ? ' ' + '★'.repeat(pr.level) : ''}</button>`; }).join('') : `<div class="hint">${mode === 'sell' ? 'У тебя пока нет точек' : 'У него нет точек'}</div>`}</div>
      ${c ? `<div class="muted up">Цена</div>
      <div class="tr-price"><button class="btn small" data-d="-50">−50</button><input id="trp" inputmode="numeric" value="${c.price}"><button class="btn small" data-d="50">+50</button></div>
      <div class="hint">Цена банка $${c.price}${st.props[cell].level ? ` + звёзды $${c.up * st.props[cell].level}` : ''}. У ${mode === 'sell' ? esc(toP.name) : 'тебя'} $${mode === 'sell' ? toP.money : mp.money}.</div>
      <button class="btn gold big" id="trgo">Предложить</button>` : ''}`;
    $$('[data-to]', m).forEach((b) => b.onclick = () => { to = b.dataset.to; draw(); });
    $$('[data-mode]', m).forEach((b) => b.onclick = () => { mode = b.dataset.mode; cell = null; draw(); });
    $$('[data-cell]', m).forEach((b) => b.onclick = () => { cell = +b.dataset.cell; draw(); });
    $$('[data-d]', m).forEach((b) => b.onclick = () => { const i = $('#trp', m); i.value = Math.max(1, (parseInt(i.value, 10) || 0) + Number(b.dataset.d)); });
    if ($('#trgo', m)) $('#trgo', m).onclick = () => {
      const price = parseInt($('#trp', m).value, 10);
      if (!(price > 0)) return toast('Укажи цену');
      socket.emit('offer', { to, cell, price, mode });
      SFX.play('click');
      m.closeModal();
    };
  };
  draw();
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
    if (!d1.isConnected) return clearInterval(iv);
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
      SFX.play('hop', 0.7);
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
  const alive = new Set();
  st.players.forEach((p) => {
    let el = $(`.tok[data-pid="${p.id}"]`, layer);
    if (p.bankrupt) { if (el) el.remove(); return; }
    alive.add(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tok'; el.dataset.pid = p.id;
      el.style.setProperty('--c', p.color);
      layer.appendChild(el);
    }
    if (el.dataset.char !== p.char) { el.dataset.char = p.char; el.innerHTML = pic(p.char); }
    const pos = disp[p.id], g = groups[pos] || [p.id], k = g.indexOf(p.id), n = g.length;
    const { x, y } = cellXY(pos);
    const spread = n > 1 ? Math.min(3.4, 10 / (n - 1)) : 0;
    el.style.left = `${((x + 0.5) / 6) * 100}%`;
    el.style.top = `${((y + 0.82) / 6) * 100}%`;
    el.style.setProperty('--dx', `${(k - (n - 1) / 2) * spread}cqw`);
    el.style.setProperty('--dy', `${n > 1 && k % 2 ? -1.2 : 0}cqw`);
    el.classList.toggle('turn', st.players[st.turn] && st.players[st.turn].id === p.id);
    el.classList.toggle('me', p.id === myId);
    if (hopPid === p.id) { el.classList.remove('hopping'); void el.offsetWidth; el.classList.add('hopping'); }
  });
  $$('.tok[data-pid]', layer).forEach((el) => { if (!alive.has(el.dataset.pid)) el.remove(); });
  let om = $('.tok.omon', layer);
  if (st.omon !== null) {
    if (!om) { om = document.createElement('div'); om.className = 'tok omon'; om.textContent = '🚔'; layer.appendChild(om); }
    const { x, y } = cellXY(st.omon);
    om.style.left = `${((x + 0.5) / 6) * 100}%`;
    om.style.top = `${((y + 0.5) / 6) * 100}%`;
  } else if (om) om.remove();
}

// ---------- Лента ----------
const SOUND_BY_KIND = { buy: 'buy', rent: 'cash', salary: 'cash', loss: 'bad', sell: 'bad', jail: 'jail', police: 'jail', bankrupt: 'bankrupt', goon: 'click', chat: 'chat', join: 'turn', 'trade-ok': 'buy' };
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
  if (!live) return;
  if (l.kind === 'omon' && /выехал/.test(l.text)) { SFX.play('omon'); flash('ОМОН ВЫЕХАЛ', 'omon'); }
  else if (l.kind === 'omon' && /БЕСПРЕДЕЛ/.test(l.text)) { SFX.play('omon'); flash('БЕСПРЕДЕЛ', 'omon'); }
  else if (l.kind === 'omon') SFX.play('jail');
  else if (SOUND_BY_KIND[l.kind]) SFX.play(SOUND_BY_KIND[l.kind]);
  if (l.kind === 'bankrupt') flash(l.text.replace('💀 ', ''), 'dead');
}

function bubble(pid, text) {
  const host = $(`.tok[data-pid="${pid}"]`) || $(`.pc[data-pid="${pid}"]`);
  if (!host) return;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  host.appendChild(b);
  setTimeout(() => b.remove(), 2600);
}

// ---------- Эффекты ----------
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
          <div style="--c:${a.color}"><div class="fx-av">${avatar(a)}</div><div class="fx-nm">${esc(a.name)}</div><div class="fx-pw" data-final="${fx.aP}">?</div><div class="fx-roll">🎲 ${fx.aRoll} + сила ${fx.aP - fx.aRoll}</div></div>
          <div class="vs-x">VS</div>
          <div style="--c:${o.color}"><div class="fx-av">${avatar(o)}</div><div class="fx-nm">${esc(o.name)}</div><div class="fx-pw" data-final="${fx.oP}">?</div><div class="fx-roll">🎲 ${fx.oRoll} + сила ${fx.oP - fx.oRoll}</div></div>
        </div>
        <div class="fx-res ${fx.win ? 'good' : 'badr'}">${fx.win ? `${esc(a.name)} отжал точку!` : `${esc(o.name)} отбился`}</div>
      </div>`, 2500);
    let n = 0;
    const iv = setInterval(() => {
      $$('.fx-pw', ov).forEach((e) => { e.textContent = n < 10 ? 1 + Math.floor(Math.random() * 12) : e.dataset.final; });
      if (++n > 10) { clearInterval(iv); ov.classList.add('done'); SFX.play(fx.win ? 'strelka-win' : 'strelka-lose'); }
    }, 70);
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
      SFX.play('tick', 0.5);
      if (++n > 12) { clearInterval(iv); ov.classList.add('done'); SFX.play(fx.win ? 'casino-win' : 'lose'); }
    }, 70);
  } else if (fx.type === 'glok') {
    SFX.play(fx.result ? 'cash' : 'glok'); SFX.vibe([80, 40, 80]);
    closeGlokTask();
    overlay(glokCard(`${fx.line ? `<div class="glok-line">«${esc(fx.line)}»</div>` : ''}<div class="glok-title">${esc(fx.title)}</div><div class="glok-text">${esc(fx.text)}</div>`), fx.result ? 2600 : 3200);
    if (!fx.result) flash('ДИМА ГЛОК ПРИШЁЛ', 'glok');
  } else if (fx.type === 'pot') {
    const p = byId(fx.pid);
    SFX.play('casino-win');
    overlay(`<div class="fx casino"><div class="fx-title">ДЖЕКПОТ</div><div class="fx-sub">${p ? esc(p.name) : ''} встал ровно на Общак</div><div class="pot-big">+$${fx.amount}</div></div>`, 1800).classList.add('done');
  } else if (fx.type === 'deal') {
    const b = byId(fx.buyer), s = byId(fx.seller), c = BOARD[fx.cell];
    flash(`🤝 ${c.name}: $${fx.price}`, 'deal');
    if (b && s) bubble(fx.buyer, `Забрал ${c.name}`);
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
  const c = BOARD[id], k = (st && st.inflation) || 1;
  return `<div class="rents">${[0, 1, 2, 3].map((l) => `<div><span>${l ? '★'.repeat(l) : 'база'}</span><b>$${c.rent * Math.pow(2, l) * k}</b></div>`).join('')}</div>`;
}
function openSheet(q) {
  const key = JSON.stringify(q);
  if (key === sheetKey) return;
  sheetKey = key;
  const mp = meP();
  let html = '';
  const c = q.cell != null ? BOARD[q.cell] : null;
  const head = (emoji, title, sub, color) => `<div class="sh-head" style="--g:${color || 'var(--gold)'}"><span class="sh-em">${emoji}</span><div><div class="sh-title">${title}</div>${sub ? `<div class="sh-sub">${sub}</div>` : ''}</div></div>`;
  const btns = (list) => `<div class="sh-btns">${list.map(([v, label, cls]) => `<button class="btn ${cls || ''}" data-choice="${esc(v)}">${label}</button>`).join('')}</div>`;
  switch (q.type) {
    case 'BUY':
      html = head(c.emoji, c.name, 'Ничья точка. Берём под крышу?', GROUPS[c.group]) +
        `<div class="sh-info"><div>Цена <b class="neg">$${q.price}</b>${q.price < c.price ? '<small class="perk">скидка Барыги</small>' : ''}</div><div>У тебя <b>$${mp.money}</b></div></div>` + rentRows(c.id) +
        `<div class="hint">Обе точки одного цвета — рента ×2. Покупка поднимает розыск 🔥.</div>` +
        btns([['yes', `Крышевать за $${q.price}`, 'gold'], ['no', 'Пас']]);
      break;
    case 'UPGRADE':
      html = head(c.emoji, `Прокачка «${c.name}»`, `Уровень ${'★'.repeat(q.level) || 'база'} → ${'★'.repeat(q.level + 1)}`, GROUPS[c.group]) +
        `<div class="sh-info"><div>Рента сейчас <b>$${rentOf(st.props, c.id) * (st.inflation || 1)}</b></div><div>Станет <b class="pos">$${c.rent * Math.pow(2, q.level + 1) * (st.inflation || 1)}</b></div></div>` +
        btns([['yes', `Прокачать за $${q.price}`, 'gold'], ['no', 'Не сейчас']]);
      break;
    case 'GYM':
      html = head('🥊', 'Качалка', 'Нанять братка?') +
        `<div class="sh-info"><div>Братков <b>${mp.goons}/${q.max}</b></div><div>Цена <b class="neg">$${q.price}</b></div></div>` +
        `<div class="hint">Браток садится вместо тебя (менты, ОМОН) и добавляет +1 к силе на стрелке.</div>` +
        btns([['yes', `Нанять за $${q.price}`, 'gold'], ['no', 'Уйти']]);
      break;
    case 'CASINO':
      html = head('🎰', 'Казино «Три топора»', mp.char === 'shuler' ? 'Шулер: 55% удвоить, 8% джекпот ×5' : 'Шанс 42% удвоить, 5% — джекпот ×5') +
        btns([...q.bets.map((b) => [String(b), `Ставка $${b}`, b === q.bets[q.bets.length - 1] ? 'red' : '']), ['skip', 'Не играю']]);
      break;
    case 'STRELKA':
      html = head('⚔️', 'Чужая территория', `«${c.name}» держит ${esc(q.ownerName)}`, byId(q.owner) && byId(q.owner).color) +
        `<div class="sh-info"><div>Доля хозяину <b class="neg">$${q.rent}</b></div><div>Штраф за слив <b class="neg">$${q.rent * 2}</b></div></div>` +
        `<div class="power"><div><span>Ты</span><b>🎲 + ${q.my}</b></div><div class="vs-x">VS</div><div><span>${esc(q.ownerName)}</span><b>🎲 + ${q.his}</b></div></div>` +
        `<div class="hint">Сила = авторитет + братки (+2 у Бойца). Победа — точка твоя (−1 звезда), +1 авторитет. Ничья за хозяином.</div>` +
        btns([['pay', `Заплатить $${q.rent}`], ['fight', 'Забить стрелку', 'red']]);
      break;
    case 'JAIL':
      html = head('🔒', 'Ты в тюрьме', 'Сидишь один ход') +
        btns([['pay', `Залог $${q.bail} и бросить`, 'gold'], ['wait', 'Отсидеть ход']]);
      break;
  }
  html += `<div class="sh-timer"><i id="shbar"></i></div>`;
  $('#sheet').innerHTML = html;
  $$('#sheet [data-choice]').forEach((b) => {
    const v = b.dataset.choice;
    const cost = v === 'yes' ? q.price : /^\d+$/.test(v) ? Number(v) : v === 'pay' && q.type === 'JAIL' ? q.bail : 0;
    if (cost && mp.money < cost) b.disabled = true;
    b.onclick = () => {
      SFX.play('click'); SFX.vibe(10);
      socket.emit('decide', { choice: v });
      $$('#sheet [data-choice]').forEach((x) => { x.disabled = true; });
    };
  });
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

// ---------- Инфо, меню, правила ----------
function showCellInfo(id) {
  const c = BOARD[id];
  const pr = st && st.props[id];
  const o = pr && byId(pr.owner);
  const desc = {
    start: `Проходишь — получаешь $${C.SALARY}. Встал ровно — забираешь джекпот (половина всех штрафов и налогов)${st && st.pot ? `: сейчас <b>$${st.pot}</b>` : ''}.`,
    gym: `Можно нанять братка за $${C.GOON_PRICE} (макс ${C.MAX_GOONS}).`,
    jail: 'Просто навестить кентов. Сюда отправляют менты.', card: 'Тянешь карточку «Звонок с зоны» — может повезти, а может и нет.',
    casino: 'Ставки $50–200. 42% — удвоил, 5% — джекпот ×5.', tax: 'Отдаёшь 10% налички (минимум $20).',
    police: 'Отправляют в тюрьму. Браток может сесть вместо тебя.',
  }[c.type];
  modal(`<div class="sh-head" style="--g:${c.group ? GROUPS[c.group] : 'var(--gold)'}"><span class="sh-em">${c.emoji}</span><div><div class="sh-title">${c.name}</div>
    <div class="sh-sub">${c.type === 'prop' ? (o ? `Крыша: <b style="color:${o.color}">${esc(o.name)}</b>${pr.level ? ' ' + '★'.repeat(pr.level) : ''}` : `Свободна · $${c.price}`) : ''}</div></div></div>
    ${c.type === 'prop' ? rentRows(id) + `<div class="hint">Прокачка: $${c.up} за звезду. Полный район — рента ×2 на базе.${o ? ` Сейчас рента: <b>$${rentOf(st.props, id) * (st.inflation || 1)}</b>` : ''}</div>` : `<p class="desc">${desc}</p>`}`);
}

function showMenu() {
  const m = modal(`<div class="menu">
    <button class="btn" data-a="trade">🤝 Предложить сделку</button>
    <button class="btn" data-a="chars">🎭 Кто есть кто</button>
    <button class="btn" data-a="rules">📖 Как играть</button>
    <button class="btn" data-a="sound">${SFX.on ? '🔇 Выключить звук' : '🔊 Включить звук'}</button>
    <button class="btn" data-a="link">🔗 Ссылка на игру</button>
    <button class="btn red" data-a="quit">🏳️ Сдаться и выйти</button>
  </div>`);
  $$('[data-a]', m).forEach((b) => b.onclick = () => {
    const a = b.dataset.a;
    m.closeModal();
    if (a === 'trade') showTrade();
    if (a === 'chars') showChars();
    if (a === 'rules') showRules();
    if (a === 'sound') { SFX.on = !SFX.on; updSound(); }
    if (a === 'link') copyText(`${shareUrl}/?room=${st.code}`);
    if (a === 'quit' && confirm('Точно сдаться? Твои точки уйдут банку.')) socket.emit('leave');
  });
}

function showChars() {
  modal(`<div class="rules"><h2>Кто есть кто</h2>${st.players.map((p) => `
    <div class="who" style="--c:${p.color}"><span class="pl-pic">${avatar(p)}</span><div><b>${esc(p.name)}</b> — ${CHARS[p.char].name}<small>${CHARS[p.char].perk}</small></div></div>`).join('')}</div>`);
}

function showRules() {
  modal(`<div class="rules">
    <h2>Как играть</h2>
    <p>🎲 Бросаешь две кости и идёшь по кругу. Прошёл <b>Общак</b> — получи $${C.SALARY}. Встал на него ровно — забираешь <b>джекпот</b>: туда падает половина всех налогов и штрафов.</p>
    <p>🏪 <b>Свободная точка</b> — можно взять под крышу. Своя — прокачать до ★★★ (каждая звезда удваивает ренту). Оба цвета района у тебя — рента ×2.</p>
    <p>⚔️ <b>Чужая точка</b> — плати долю или забивай <b>стрелку</b>: 🎲 + авторитет + братки против хозяина. Выиграл — точка твоя. Слил — штраф ×2 и минус браток.</p>
    <p>🤝 <b>Сделки</b> — в любой момент можно продать свою точку или выкупить чужую. Кнопка 🤝 вверху.</p>
    <p>🎭 <b>Персонажи</b> — у каждого своя фишка: Боец сильнее на стрелках, Барыга покупает дешевле, Адвокат не сидит, Шулер везуч в казино, Решала неприкасаем для Глока, Бухгалтер получает больше с Общака, Громила нанимает братков за полцены.</p>
    <p>🔥 <b>Розыск</b> растёт от покупок, прокачек, стрелок и казино. На 5 огоньках выезжает <b>ОМОН</b>. Кого накроет — штраф или минус браток.</p>
    <p>😎 <b>Дима Глок</b> — смотрящий за районом. Приходит когда захочет: шмонает богатых, путает бабки, гоняет всех назад, закрывает точки, обносит джекпот и даёт «задания». Иногда кнопку надо жать быстрее всех, а иногда это подстава.</p>
    <p>🏆 Побеждает последний оставшийся или самый богатый, когда кончатся круги. Результаты идут в <b>Топ братвы</b>.</p>
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
    <div class="win-pic" style="--c:${w ? w.color : '#fff'}">${w ? avatar(w) : ''}<span class="crown">👑</span></div>
    <h1 class="win-name" style="color:${w ? w.color : '#fff'}">${w ? esc(w.name) : 'Никто'}</h1>
    <div class="win-sub">${w && w.id === myId ? 'Город твой. Уважение.' : 'забрал весь город'}</div>
    <div class="standings">
      ${(st.standings || []).map((s, i) => { const p = byId(s.id); if (!p) return ''; return `
        <div class="st-row ${p.id === myId ? 'me' : ''}" style="--c:${p.color}">
          <span class="pl-place">${medals[i] || i + 1}</span><span class="pl-pic">${avatar(p)}</span><span class="nm">${esc(p.name)}</span>
          <span class="worth">${s.bankrupt ? 'разорён' : '$' + s.worth}</span>
        </div>`; }).join('')}
    </div>
    ${(st.titles || []).length ? `<div class="list-title">Титулы партии</div><div class="titles">${st.titles.map((t) => { const p = byId(t.pid); return p ? `<div class="title-card" style="--c:${p.color}"><span class="tc-em">${t.emoji}</span><b>${t.title}</b><span>${esc(p.name)}</span><small>${t.desc}</small></div>` : ''; }).join('')}</div>` : ''}
    <div class="row">
      ${host ? '<button class="btn gold grow" id="again">Ещё партию</button>' : '<div class="wait">Босс может начать новую партию</div>'}
      <button class="btn" id="top">🏆 Топ</button>
      <button class="btn" id="out">Выйти</button>
    </div>
  </section>`;
  if ($('#again')) $('#again').onclick = () => socket.emit('rematch');
  $('#out').onclick = () => socket.emit('leave');
  $('#top').onclick = () => { renderTop().then(() => { const b = $('#back'); if (b) b.onclick = () => { screen = 'over'; renderOver(); }; }); };
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
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(ok, fallback);
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

if (!token) render();
else setTimeout(() => { if (!screen) render(); }, 1500);
})();
