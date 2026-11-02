(() => {
'use strict';
const { BOARD, GROUPS, C, cellXY, rentOf, SHOP, GIFTS, PACKS, BOOST, EARN } = window.G;
const { CHARS, portrait } = window.ART;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const app = $('#app');
const QUICK = ['Красава', 'Ха-ха', 'Плати давай', 'Жара пошла', 'Мир', 'Ну ты жук', 'Стрелка?', 'Везёт же', 'Дима, нет!'];
const ic = (n, cls) => window.IC.ic(n, cls);
const COIN = ic('coin', 'coin');
const cellIc = (c) => ic('c-' + c.slug, 'cell-ic');
const giftIc = (g, cls) => ic('g-' + g.id, cls || 'gift-ic');
const stars = (n) => (n ? `<span class="stars">${ic('star').repeat(n)}</span>` : '');
const placeBadge = (i) => `<span class="place p${i + 1}">${i + 1}</span>`;
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
let ASSETS = new Set();
const assetFor = (name) => ['png', 'webp', 'jpg', 'jpeg'].map((e) => `art-${name}.${e}`).find((f) => ASSETS.has(f));
// pic — круглое лицо персонажа (для аватарок), medal — полный медальон с подписью (для выбора)
const pic = (key) => {
  const a = assetFor(key === 'glok' ? 'face-glok' : 'face-' + key);
  if (a) return `<img src="${a}" alt="" class="art-img">`;
  return portraitCache[key] || (portraitCache[key] = portrait(key, key));
};
const medal = (key) => {
  const a = assetFor('char-' + key);
  return a ? `<img src="${a}" alt="" class="art-medal">` : pic(key);
};
const avatar = (p) => (p && p.photo ? `<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">` : pic(p && p.char));
const fr = (p) => (p && p.frame ? ' ' + p.frame : '');                     // класс рамки
const ttl = (t) => (t && SHOP[t] ? `<i class="ttl ${t}">${SHOP[t].name}</i>` : '');
const PREMIUM = Object.fromEntries(Object.entries(SHOP).filter(([, v]) => v.kind === 'char').map(([k, v]) => [v.char, { id: k, price: v.price }]));
const owns = (id) => !!(wallet && wallet.items.includes(id));
const charOpen = (k) => !PREMIUM[k] || !wallet || owns(PREMIUM[k].id); // пока кошелёк грузится — верим сохранённому выбору

// ---------- Кошелёк ----------
let wallet = null, starsOk = false;
const todayStr = () => new Date().toISOString().slice(0, 10);
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ident(), ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ошибка');
  return d;
}
async function loadWallet() {
  try { const d = await api('/api/me', {}); wallet = d.wallet; myStats = d.stats || myStats; starsOk = d.stars; refreshCoins(); } catch (e) { console.warn('wallet', e.message); }
}
function coinChip() { return `<button class="coin-chip" data-shop>${COIN}<b>${wallet ? wallet.coins : '…'}</b><span class="plus">${ic('plus')}</span></button>`; }
function refreshCoins() {
  $$('.coin-chip b').forEach((b) => { b.textContent = wallet ? wallet.coins : '…'; });
  const d = $('#daily'); if (d) d.hidden = !wallet || wallet.daily_on === todayStr();
}
function bindShopButtons(root = document) { $$('[data-shop]', root).forEach((b) => b.onclick = () => renderShop(b.dataset.shop || 'coins')); }

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
    loadWallet().then(() => { if (screen === 'home') renderHome(); });
    toast(`Здорово, ${me.name}!`);
  } catch { toast('Нет связи с сервером'); }
}
window.onTelegramAuth = (user) => authWith('/api/auth/telegram', user);
function logout() { session = null; me = null; LS.set('bratva_session', null); LS.set('bratva_me', null); renderHome(); }

fetch('/api/config').then((r) => r.json()).then((d) => { config = d; if (screen === 'home') renderHome(); }).catch(() => {});
const assetsReady = fetch('/api/assets').then((r) => r.json()).then((list) => {
  ASSETS = new Set(list);
  if (!list.length) return;
  if (screen === 'home') renderHome(); else if (screen === 'lobby') renderLobby(); else if (screen === 'game') { buildGame(); updateGame(); }
}).catch(() => {});
if (inTelegram) telegramAppLogin();

// ---------- Сеть ----------
const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
socket.on('connect', () => { setConn(true); socket.emit('hello', { token }); });
socket.on('disconnect', () => setConn(false));
socket.on('connect_error', () => {
  if (!screen) app.innerHTML = '<section class="screen home"><div class="logo"><img class="logo-img" src="logo.svg" alt="Братва"><div class="logo-sub pulse">Сервер просыпается, до минуты…</div></div></section>';
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
  if (pendingBots > 0 && st.status === 'LOBBY' && st.hostId === myId && st.players.length < 4) { pendingBots--; setTimeout(() => socket.emit('addBot'), 120); }
  else if (st.status !== 'LOBBY' || st.players.length >= 4) pendingBots = 0;
});
socket.on('err', (m) => { toast(m); SFX.play('bad'); });
socket.on('spent', ({ amount }) => { if (wallet) { wallet.coins -= amount; refreshCoins(); } });
socket.on('earned', ({ amount, win }) => { if (wallet) { wallet.coins += amount; refreshCoins(); } setTimeout(() => toast(`+${amount} монет ${win ? 'за победу' : 'за партию'}`), 2500); });
socket.on('gift', (g) => giftFx(g));
const ident = () => ({ session, device });
loadWallet().then(() => { if (screen === 'home') renderHome(); });

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
  // игра стартовала, пока человек был в магазине/персонажах из лобби — возвращаем за стол
  if ((screen === 'shop' || screen === 'chars') && st && st.status === 'PLAYING' && render.last === 'LOBBY') { screen = null; toast('Замес начался!'); }
  render.last = st ? st.status : null;
  if (screen === 'shop' || screen === 'chars') return; // свои экраны закрываются кнопкой «назад»
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
  if (want === 'home' && screen === 'home') return;
  screen = want;
  if (want === 'home') renderHome();
  else if (want === 'lobby') { renderLobby(); const ts = tableSheet.open; if (ts && ts.isConnected) ts.redraw(); }
  else renderOver();
}

// ---------- Главный экран ----------
function charCard(k, on) {
  const c = CHARS[k], open = charOpen(k);
  return `<button class="char ${on ? 'on' : ''} ${open ? '' : 'locked'}" data-char="${k}" aria-label="${c.name}">
    <span class="char-pic">${medal(k)}</span>${ASSETS.has('art-char-' + k + '.webp') ? '' : `<b>${c.name}</b>`}<small>${c.perk}</small>
    ${open ? '' : `<span class="lock">${ic('lock')}${PREMIUM[k].price}${COIN}</span>`}</button>`;
}
function pickChar(b, after) {
  const k = b.dataset.char;
  if (!charOpen(k)) return renderShop('chars', k);
  profile.char = k; LS.set('bratva_profile', profile);
  $$('.char', b.parentElement).forEach((x) => x.classList.toggle('on', x === b)); SFX.play('click');
  if (after) after(k);
}

// ---------- Главное меню ----------
let myStats = null, pendingBots = 0;
const SKYLINE = [['tyurma', 4, 30, .9], ['bank', 18, 34, 1], ['kazino', 38, 40, 1.15], ['rublevka', 62, 36, 1.05], ['sto', 84, 26, .85], ['larek', 0, 20, .8], ['shaurma', 76, 20, .8], ['kachalka', 26, 22, .8]];
function skyline() {
  const front = ['larek', 'shaurma', 'kachalka'];
  return SKYLINE.filter(([k]) => assetFor('cell-' + k)).map(([k, x, w, sc]) => `<img src="${assetFor('cell-' + k)}" alt="" class="sky-b ${front.includes(k) ? 'front' : ''}" style="left:${x}%;width:${w}%;--s:${sc}">`).join('');
}
function embers() { return Array.from({ length: 16 }, () => `<i style="left:${Math.random() * 100}%;animation-delay:${(Math.random() * 8).toFixed(1)}s;animation-duration:${(6 + Math.random() * 6).toFixed(1)}s"></i>`).join(''); }
const myName = () => (profile.name || '').trim() || (me && me.name) || '';
const myAva = () => (me && me.photo ? `<img src="${esc(me.photo)}" alt="" referrerpolicy="no-referrer">` : pic(profile.char));
const myFrame = () => (wallet && wallet.equip && wallet.equip.frame ? ' ' + wallet.equip.frame : '');
const dailyReady = () => !!(wallet && wallet.daily_on !== todayStr());

function renderHome() {
  screen = 'home';
  if (wallet && !charOpen(profile.char)) { profile.char = 'boec'; LS.set('bratva_profile', profile); }
  const ch = CHARS[profile.char];
  const title = wallet && wallet.equip && wallet.equip.title;
  app.innerHTML = `
  <section class="screen menu">
    <div class="menu-bg"><div class="city-glow"></div><div class="skyline">${skyline()}</div><div class="fog"></div><div class="embers">${embers()}</div></div>
    <header class="menu-top">
      <button class="profile-chip" id="prof">
        <span class="pp-av${myFrame()}">${myAva()}</span>
        <span class="pp-txt"><b>${esc(myName() || 'Без погоняла')}</b>${title ? ttl(title) : `<small>${myName() ? 'Профиль' : 'Нажми, чтобы назваться'}</small>`}</span>
      </button>
      ${coinChip()}
    </header>
    <div class="menu-logo"><img class="logo-img" src="logo.svg" alt="Братва — монополия девяностых" width="1000" height="400"></div>
    <div class="hero">
      <button class="hero-arrow" data-dir="-1" aria-label="Предыдущий">${ic('back')}</button>
      <div class="hero-stage" id="heroPic">
        <div class="hero-light"></div>
        <div class="hero-pic ${charOpen(profile.char) ? '' : 'locked'}">${medal(profile.char)}</div>
        <div class="hero-plinth"></div>
      </div>
      <button class="hero-arrow next" data-dir="1" aria-label="Следующий">${ic('back')}</button>
    </div>
    <div class="hero-info"><b>${ch.name}</b><span>${ch.perk}</span></div>
    <div class="menu-cta">
      <button class="btn-play" id="play"><span>Играть</span><i class="shine"></i></button>
    </div>
    <nav class="dock">
      <button data-shop="coins">${ic('cart')}<span>Магазин</span></button>
      <button id="chars">${ic('masks')}<span>Персонажи</span></button>
      <button id="daily" class="${dailyReady() ? 'hot' : ''}">${ic('calendar')}<span>Бонус</span>${dailyReady() ? '<i class="dot"></i>' : ''}</button>
      <button id="top">${ic('trophy')}<span>Топ</span></button>
      <button id="rules">${ic('book')}<span>Правила</span></button>
    </nav>
  </section>`;
  bindShopButtons(app);
  $$('.hero-arrow').forEach((b) => b.onclick = () => {
    const open = CHAR_KEYS.filter(charOpen);
    const list = open.length ? open : CHAR_KEYS;
    const i = list.indexOf(profile.char);
    profile.char = list[(i + Number(b.dataset.dir) + list.length) % list.length];
    LS.set('bratva_profile', profile); SFX.play('click');
    renderHome();
    const h = $('.hero-pic'); if (h) h.classList.add(Number(b.dataset.dir) > 0 ? 'in-r' : 'in-l');
  });
  $('#heroPic').onclick = () => renderChars();
  $('#chars').onclick = () => renderChars();
  $('#prof').onclick = () => profileSheet();
  $('#play').onclick = () => playSheet();
  $('#daily').onclick = async () => { if (dailyReady()) { await claimDaily(); renderHome(); } else toast('Бонус уже забран — приходи завтра'); };
  $('#rules').onclick = showRules;
  $('#top').onclick = () => renderTop();
  if (urlRoomState.code && !renderHome.invited) { renderHome.invited = true; setTimeout(() => playSheet('code'), 300); }
}

function needName(then) {
  if (myName()) return then();
  profileSheet(then);
}

function playSheet(mode) {
  const m = modal(`<div class="play-sheet">
    <div class="ps-title">Куда едем?</div>
    <button class="mode-card friends" data-mode="friends">
      <span class="mc-ic">${ic('deal')}</span>
      <span class="mc-txt"><b>Сходка с друзьями</b><small>Создай стол и позови братву по ссылке или QR</small></span>
      <span class="mc-go">${ic('back')}</span>
    </button>
    <button class="mode-card bots" data-mode="bots">
      <span class="mc-ic">${ic('dice')}</span>
      <span class="mc-txt"><b>Против ботов</b><small>Быстрая партия: ты и трое ботов</small></span>
      <span class="mc-go">${ic('back')}</span>
    </button>
    <div class="code-card">
      <div class="cc-head">${ic('link')}<b>${urlRoomState.code ? 'Тебя позвали на сходку' : 'Войти по коду'}</b></div>
      <div class="code-boxes">${[0, 1, 2, 3].map((i) => `<input inputmode="numeric" pattern="[0-9]*" maxlength="1" class="cbox" data-i="${i}" value="${esc((urlRoomState.code || '')[i] || '')}">`).join('')}</div>
      <button class="btn gold big" id="joinGo">Войти</button>
    </div>
  </div>`);
  const boxes = $$('.cbox', m);
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => { b.value = b.value.replace(/\D/g, '').slice(-1); if (b.value && boxes[i + 1]) boxes[i + 1].focus(); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
    b.addEventListener('paste', (e) => { const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4); if (t.length === 4) { e.preventDefault(); boxes.forEach((x, k) => { x.value = t[k]; }); } });
  });
  if (mode === 'code') setTimeout(() => (boxes.find((x) => !x.value) || $('#joinGo', m)).focus(), 350);
  const go = (ev, extra) => needName(() => { m.closeModal(); socket.emit(ev, { name: myName(), char: profile.char, ...ident(), ...extra }); });
  $$('[data-mode]', m).forEach((b) => b.onclick = () => {
    SFX.play('click');
    if (b.dataset.mode === 'bots') pendingBots = 3;
    go('create');
  });
  $('#joinGo', m).onclick = () => {
    const code = boxes.map((x) => x.value).join('');
    if (!/^\d{4}$/.test(code)) { toast('Код — 4 цифры'); return boxes[0].focus(); }
    go('join', { code });
  };
}

async function profileSheet(then) {
  const m = modal('<div id="profbox"></div>');
  const draw = () => {
    const st2 = myStats || { games: 0, wins: 0, best: 0, strelka: 0, respect: 0 };
    const title = wallet && wallet.equip && wallet.equip.title;
    $('#profbox', m).innerHTML = `
      <div class="prof-head">
        <span class="prof-av${myFrame()}">${myAva()}</span>
        <div><div class="prof-name">${esc(myName() || 'Новичок')}</div>${title ? ttl(title) : ''}${me ? `<div class="prof-tg">${ic('telegram')}${me.username ? '@' + esc(me.username) : 'Telegram'}</div>` : ''}</div>
      </div>
      <label class="prof-lbl" for="pname">Погоняло</label>
      <div class="row"><input id="pname" maxlength="12" placeholder="Например, Кабан" value="${esc(profile.name)}" autocomplete="off" enterkeyhint="done"><button class="btn gold" id="psave">${then ? 'Дальше' : 'Сохранить'}</button></div>
      <div class="prof-stats">
        <div><b>${st2.games}</b><small>партий</small></div><div><b>${st2.wins}</b><small>побед</small></div>
        <div><b>${st2.games ? Math.round((st2.wins / st2.games) * 100) : 0}%</b><small>винрейт</small></div><div><b>$${st2.best}</b><small>рекорд</small></div>
      </div>
      ${me ? (inTelegram ? '' : '<button class="link" id="plogout">Выйти из Telegram</button>')
        : config.tg && config.bot && !inTelegram ? `<div class="tg-login"><div class="tg-hint">Войди через Telegram: аватарка в топе и покупки за Stars</div><div id="tgw"></div></div>` : ''}
      <div class="row prof-links"><button class="btn small" data-shop="frame">${ic('frame')}Рамки</button><button class="btn small" data-shop="title">${ic('tag')}Титулы</button><button class="btn small" data-shop="dice">${ic('dice')}Кубики</button></div>`;
    const inp = $('#pname', m);
    const save = () => {
      const v = inp.value.replace(/\s+/g, ' ').trim();
      if (!v) { toast('Введи погоняло'); return inp.focus(); }
      profile.name = v; LS.set('bratva_profile', profile);
      SFX.play('click'); m.closeModal();
      if (screen === 'home') renderHome();
      if (then) setTimeout(then, 260);
    };
    $('#psave', m).onclick = save;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    if (then) setTimeout(() => inp.focus(), 300);
    if ($('#plogout', m)) $('#plogout', m).onclick = () => { m.closeModal(); logout(); };
    $$('[data-shop]', m).forEach((b) => b.onclick = () => { m.closeModal(); renderShop(b.dataset.shop); });
    if ($('#tgw', m)) {
      const sc = document.createElement('script');
      sc.async = true; sc.src = 'https://telegram.org/js/telegram-widget.js?22';
      sc.setAttribute('data-telegram-login', config.bot); sc.setAttribute('data-size', 'large'); sc.setAttribute('data-radius', '12');
      sc.setAttribute('data-onauth', 'onTelegramAuth(user)');
      $('#tgw', m).appendChild(sc);
    }
  };
  draw();
  if (!myStats) { await loadWallet(); if (m.isConnected) draw(); }
}

function renderChars(from) {
  screen = 'chars';
  const back = () => { if (from === 'lobby') { screen = null; render(); } else renderHome(); };
  app.innerHTML = `
  <section class="screen chars-screen">
    <div class="top-head"><button class="icon-btn" id="back" aria-label="Назад">${ic('back')}</button><h2>Персонажи</h2>${coinChip().replace(' data-shop', '')}</div>
    <div class="hint center-t">У каждого своя способность. Выбери, с кем пойдёшь на дело.</div>
    <div class="char-grid">${CHAR_KEYS.map((k) => {
      const c = CHARS[k], open = charOpen(k), on = profile.char === k;
      return `<button class="char-tile ${on ? 'on' : ''} ${open ? '' : 'locked'}" data-k="${k}">
        <span class="ct-pic">${medal(k)}</span>
        <b>${c.name}</b><small>${c.perk}</small>
        <span class="ct-state">${on ? `${ic('check')}Выбран` : open ? 'Выбрать' : `${ic('lock')}${PREMIUM[k].price}${COIN}`}</span>
      </button>`;
    }).join('')}</div>
  </section>`;
  $('#back').onclick = back;
  $$('.char-tile').forEach((b) => b.onclick = () => {
    const k = b.dataset.k;
    if (!charOpen(k)) return renderShop('chars', k);
    profile.char = k; LS.set('bratva_profile', profile); SFX.play('buy');
    if (from === 'lobby' && st) socket.emit('setChar', { char: k });
    back();
  });
}

// ---------- Топ ----------
let topSort = 'wins';
async function renderTop() {
  screen = 'top';
  const tabs = [['wins', 'Победы'], ['rate', 'Винрейт'], ['best', 'Капитал'], ['strelka', 'Стрелки'], ['respect', 'Уважуха']];
  app.innerHTML = `
  <section class="screen top">
    <div class="top-head"><button class="icon-btn" id="back" aria-label="Назад">${ic('back')}</button><h2>Топ братвы</h2><span></span></div>
    <div class="seg tabs">${tabs.map(([k, l]) => `<button data-sort="${k}" class="${k === topSort ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="top-list" id="toplist"><div class="wait pulse">Загружаю…</div></div>
  </section>`;
  $('#back').onclick = () => { screen = null; render(); };
  $$('[data-sort]').forEach((b) => b.onclick = () => { topSort = b.dataset.sort; renderTop(); });
  try {
    const d = await (await fetch('/api/top?sort=' + topSort)).json();
    if (screen !== 'top') return;
    const myKey = me ? 'tg:' + me.id : 'guest:' + device;
    const val = (r) => ({
      wins: `<b>${r.wins}</b><small>побед</small>`,
      rate: `<b>${r.games ? Math.round((r.wins / r.games) * 100) : 0}%</b><small>${r.wins}/${r.games}</small>`,
      best: `<b>$${r.best}</b><small>рекорд</small>`,
      strelka: `<b>${r.strelkaWon}</b><small>из ${r.strelkaTotal}</small>`,
      games: `<b>${r.games}</b><small>партий</small>`,
      respect: `<b>${r.respect}</b><small>монет в подарках</small>`,
    }[topSort]);
    $('#toplist').innerHTML = d.rows.length ? d.rows.map((r, i) => `
      <div class="top-row ${r.key === myKey ? 'me' : ''}">
        <span class="t-place">${placeBadge(i)}</span>
        <span class="t-av${r.equip && r.equip.frame ? ' ' + r.equip.frame : ''}">${r.photo ? `<img src="${esc(r.photo)}" alt="" referrerpolicy="no-referrer">` : pic(r.char)}</span>
        <span class="t-name"><b>${esc(r.name)}${r.tg ? ` <i class="tg-badge" title="Telegram">${ic('telegram')}</i>` : ''}</b>${ttl(r.equip && r.equip.title)}
          <small>${r.username ? '@' + esc(r.username) + ' · ' : ''}${CHARS[r.char] ? CHARS[r.char].name : ''} · ${r.games} парт.${r.titles ? ` · титулов: ${r.titles}` : ''}</small></span>
        <span class="t-val">${val(r)}</span>
      </div>`).join('') + (d.db === 'file' ? '<div class="hint center-t">Топ хранится без базы и обнулится при перезапуске сервера. Подключи базу — см. README.</div>' : '')
      : '<div class="wait">Пока пусто. Сыграй первую партию — и ты в топе.</div>';
  } catch { $('#toplist').innerHTML = '<div class="wait">Не загрузилось. Проверь связь.</div>'; }
}

// ---------- Лобби ----------
function seatHTML(p, host) {
  const c = CHARS[p.char];
  return `<div class="seat" style="--c:${p.color}" data-pid="${p.id}">
    ${host && p.id !== myId ? `<button class="seat-x" data-kick="${p.id}" aria-label="Убрать">${ic('close')}</button>` : ''}
    <span class="seat-av${fr(p)}">${avatar(p)}</span>
    <b class="seat-name">${esc(p.name)}</b>
    ${p.title ? ttl(p.title) : `<small class="seat-char">${c.name}</small>`}
    <span class="seat-tags">
      ${p.id === st.hostId ? `<i class="st-tag gold" title="Босс">${ic('crown')}</i>` : ''}
      ${p.bot ? '<i class="st-tag">бот</i>' : ''}
      ${p.tg ? `<i class="st-tag tg">${ic('telegram')}</i>` : ''}
      ${p.boost ? `<i class="st-tag gold" title="Подъёмные">${ic('briefcase')}</i>` : ''}
      ${!p.connected ? `<i class="st-tag off">${ic('offline')}</i>` : ''}
      ${p.id === myId ? '<i class="st-tag me">ты</i>' : ''}
    </span>
  </div>`;
}
function renderLobby() {
  const host = st.hostId === myId;
  const mine = meP();
  const empty = C.MAX_PLAYERS - st.players.length;
  const set = st.settings;
  app.innerHTML = `
  <section class="screen menu lobby2">
    <div class="menu-bg dim"><div class="city-glow"></div><div class="skyline">${skyline()}</div><div class="fog"></div></div>
    <header class="lb-top">
      <button class="icon-btn" id="leave" aria-label="Выйти">${ic('back')}</button>
      <button class="lb-code" id="invite"><small>Сходка</small><b>${esc(st.code)}</b></button>
      <button class="icon-btn" id="invite2" aria-label="Позвать">${ic('share')}</button>
    </header>
    <div class="seats">
      ${st.players.map((p) => seatHTML(p, host)).join('')}
      ${Array.from({ length: empty }, (_, k) => `<button class="seat empty" data-empty="${k}">
        <span class="seat-plus">${ic('plus')}</span><b>Свободно</b><small>${host ? (k === 0 ? 'Позвать или бот' : 'Позвать') : 'Ждём братву'}</small></button>`).join('')}
    </div>
    <div class="lb-panel">
      ${mine ? `<div class="lb-me">
        <span class="lb-me-pic">${medal(mine.char)}</span>
        <div class="lb-me-txt"><b>${CHARS[mine.char].name}</b><small>${CHARS[mine.char].perk}</small></div>
        <button class="btn small" id="chgChar">${ic('masks')}Сменить</button>
      </div>` : ''}
      ${mine && set.boosts ? `<button class="boost-toggle ${mine.boost ? 'on' : ''}" id="boostT"><span class="bt-ic">${ic('briefcase')}</span><span><b>Подъёмные +${BOOST.pct}%</b><small>Старт $${Math.round(C.START_MONEY * (1 + BOOST.pct / 100))} · ${BOOST.price} монет при старте · у тебя ${wallet ? wallet.coins : '…'}</small></span><i></i></button>` : ''}
      <button class="lb-rules" id="tableSet" ${host ? '' : 'disabled'}>
        <span class="lr-chip">${ic('flag')}${set.rounds ? set.rounds + ' кругов' : 'До конца'}</span>
        <span class="lr-chip ${set.glok ? 'on' : ''}">${ic('bolt')}Глок ${set.glok ? 'в деле' : 'выкл'}</span>
        <span class="lr-chip ${set.boosts ? 'on' : ''}">${ic('briefcase')}Бусты ${set.boosts ? 'да' : 'нет'}</span>
        ${host ? `<span class="lr-edit">${ic('menu')}</span>` : ''}
      </button>
    </div>
    <footer class="lb-bar">
      ${host ? `<button class="btn-play small-play" id="start" ${st.players.length < 2 ? 'disabled' : ''}><span>${st.players.length < 2 ? 'Ждём братву' : 'Начать замес'}</span><i class="shine"></i></button>`
        : '<div class="lb-wait"><span class="dots"><i></i><i></i><i></i></span>Ждём, когда босс начнёт</div>'}
    </footer>
  </section>`;
  $('#leave').onclick = () => socket.emit('leave');
  $('#invite').onclick = $('#invite2').onclick = () => inviteSheet();
  $$('[data-kick]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); socket.emit('kick', { id: b.dataset.kick }); });
  $$('[data-empty]').forEach((b) => b.onclick = () => (host ? emptySeatSheet() : inviteSheet()));
  $$('.seat[data-pid]').forEach((el) => el.onclick = () => { if (el.dataset.pid !== myId) showGifts(el.dataset.pid); });
  if ($('#chgChar')) $('#chgChar').onclick = () => renderChars('lobby');
  if ($('#boostT')) $('#boostT').onclick = () => socket.emit('boost', { on: !mine.boost });
  if (host) $('#tableSet').onclick = () => tableSheet();
  if ($('#start')) $('#start').onclick = () => socket.emit('start');
}
function inviteLink() { return `${shareUrl}/?room=${st.code}`; }
function inviteSheet() {
  const link = inviteLink();
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Заходи на сходку ' + st.code + ' — играем в Братву')}`;
  const m = modal(`<div class="invite">
    <div class="ps-title">Позови братву</div>
    <div class="inv-qr"><img src="/api/qr?u=${encodeURIComponent(link)}" alt="QR-код"></div>
    <div class="inv-code"><small>Код сходки</small><b>${esc(st.code)}</b></div>
    <div class="inv-link">${esc(link)}</div>
    <div class="inv-btns">
      <a class="btn gold" href="${tgShare}" target="_blank" rel="noopener">${ic('telegram')}В Telegram</a>
      <button class="btn" id="invCopy">${ic('copy')}Ссылка</button>
      ${navigator.share ? `<button class="btn" id="invShare">${ic('share')}Ещё</button>` : ''}
    </div>
  </div>`);
  $('#invCopy', m).onclick = () => copyText(link);
  if ($('#invShare', m)) $('#invShare', m).onclick = () => navigator.share({ title: 'Братва', text: `Заходи на сходку ${st.code}`, url: link }).catch(() => {});
}
function emptySeatSheet() {
  const m = modal(`<div class="play-sheet">
    <div class="ps-title">Свободное место</div>
    <button class="mode-card friends" id="esInvite"><span class="mc-ic">${ic('share')}</span><span class="mc-txt"><b>Позвать друга</b><small>Ссылка, QR или прямо в Telegram</small></span><span class="mc-go">${ic('back')}</span></button>
    <button class="mode-card bots" id="bot"><span class="mc-ic">${ic('dice')}</span><span class="mc-txt"><b>Посадить бота</b><small>Займёт место, пока братва в пути</small></span><span class="mc-go">${ic('back')}</span></button>
  </div>`);
  $('#esInvite', m).onclick = () => { m.closeModal(); setTimeout(inviteSheet, 260); };
  $('#bot', m).onclick = () => { socket.emit('addBot'); SFX.play('click'); m.closeModal(); };
}
function tableSheet() {
  const m = modal('<div id="tsbox"></div>');
  const draw = () => {
    const set = st.settings;
    $('#tsbox', m).innerHTML = `<div class="ps-title">Правила стола</div>
      <div class="prof-lbl">Длина партии</div>
      <div class="seg">${[10, 20, 30, 0].map((n) => `<button data-rounds="${n}" class="${set.rounds === n ? 'on' : ''}">${n ? n + ' кругов' : 'до конца'}</button>`).join('')}</div>
      <div class="hint">${set.rounds ? 'Когда круги закончатся, победит самый богатый (деньги + точки).' : 'Играем, пока не останется один. С 25-го круга беспредел — рента растёт.'}</div>
      <button class="glok-toggle ${set.glok ? 'on' : ''}" id="glokT"><span class="gt-av">${pic('glok')}</span><span><b>Смотрящий Дима Глок</b><small>${set.glok ? 'Придёт в любой момент и всё испортит' : 'Выключен. Скучно будет'}</small></span><i></i></button>
      <button class="glok-toggle ${set.boosts ? 'on' : ''}" id="boostsT"><span class="gt-av gt-em">${ic('briefcase')}</span><span><b>Донат-бусты</b><small>${set.boosts ? 'Можно брать подъёмные' : 'Все стартуют на равных'}</small></span><i></i></button>`;
    $$('[data-rounds]', m).forEach((b) => b.onclick = () => socket.emit('settings', { rounds: Number(b.dataset.rounds) }));
    $('#glokT', m).onclick = () => socket.emit('settings', { glok: !st.settings.glok });
    $('#boostsT', m).onclick = () => socket.emit('settings', { boosts: !st.settings.boosts });
  };
  draw();
  m.redraw = draw;
  tableSheet.open = m;
}

// ---------- Игра ----------
const sideOf = (x, y) => (y === 0 ? 'top' : x === 5 ? 'right' : y === 5 ? 'bottom' : 'left');
function cellHTML(c) {
  const { x, y } = cellXY(c.id);
  const corner = c.id % 5 === 0;
  const img = assetFor('cell-' + c.slug);
  return `<div class="cell ${corner ? 'corner' : 'side-' + sideOf(x, y)} t-${c.type}" id="cell${c.id}" data-cell="${c.id}"
    style="grid-column:${x + 1};grid-row:${y + 1};${c.group ? `--g:${GROUPS[c.group]}` : ''}">
    ${c.group ? '<i class="stripe"></i>' : ''}
    ${img ? `<img class="cimg" src="${img}" alt="">` : `<span class="em">${cellIc(c)}</span>`}
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
      <div class="tb-left"><img class="brand" src="logo-mark.svg" alt="Братва"><span class="pill" id="round"></span><span class="pill hot" id="infl" hidden></span></div>
      <div class="tb-right">
        <span class="conn" id="conn" title="Связь с сервером"></span>
        <button class="icon-btn" id="giftB" aria-label="Подарок">${ic('gift')}</button>
        <button class="icon-btn" id="trade" aria-label="Сделка">${ic('deal')}</button>
        <button class="icon-btn" id="snd" aria-label="Звук"></button>
        <button class="icon-btn" id="menu" aria-label="Меню">${ic('menu')}</button>
      </div>
    </header>
    <div class="layout">
      <div class="board-wrap"><div class="board" id="board">
        ${BOARD.map(cellHTML).join('')}
        <div class="center">
          ${assetFor('center') ? `<img class="center-art" src="${assetFor('center')}" alt="">` : ''}
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
            <form id="chatf" autocomplete="off"><button type="button" class="btn small gift-in" id="giftC" aria-label="Подарок">${ic('gift')}</button><input id="chatin" maxlength="80" placeholder="Написать братве…" enterkeyhint="send"><button class="btn small" aria-label="Отправить">${ic('send')}</button></form>
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
  $('#giftB').onclick = () => showGifts();
  $$('[data-q]').forEach((b) => b.onclick = () => socket.emit('chat', { text: b.dataset.q }));
  $('#giftC').onclick = () => showGifts();
  $('#chatf').onsubmit = (e) => { e.preventDefault(); const i = $('#chatin'); if (i.value.trim()) socket.emit('chat', { text: i.value }); i.value = ''; i.blur(); };
  $$('.cell').forEach((c) => c.onclick = () => showCellInfo(Number(c.dataset.cell)));
  $('#log').innerHTML = '';
  st.logs.forEach((l) => appendLog(l, false));
  sheetKey = '';
  updSound();
  setConn(socket.connected);
}

function updSound() { const b = $('#snd'); if (b) b.innerHTML = ic(SFX.on ? 'sound' : 'mute'); }
function setConn(ok) { const c = $('#conn'); if (c) c.classList.toggle('bad', !ok); if (!ok && st) toast('Связь потеряна, переподключаюсь…'); }

function updateGame() {
  const mine = curP() && curP().id === myId, cp = curP();
  $('#round').textContent = `Круг ${st.round}${st.settings.rounds ? ' / ' + st.settings.rounds : ''}`;
  const infl = $('#infl');
  infl.hidden = !(st.inflation > 1);
  infl.innerHTML = `${ic('flame')}рента ×${st.inflation}`;

  BOARD.forEach((c) => {
    const el = $('#cell' + c.id), pr = st.props[c.id];
    const owner = pr && byId(pr.owner);
    el.classList.toggle('owned', !!owner);
    el.classList.toggle('omon-here', st.omon === c.id);
    el.classList.toggle('sealed', !!(st.sealed && st.sealed.cell === c.id && st.round <= st.sealed.until));
    if (owner) el.style.setProperty('--o', owner.color); else el.style.removeProperty('--o');
    if (c.type === 'prop') {
      $('.pr', el).textContent = owner ? `$${rentOf(st.props, c.id) * (st.inflation || 1)}` : `$${c.price}`;
      $('.lvl', el).innerHTML = pr && pr.level ? stars(pr.level) : '';
    }
  });
  const pc = $('#potcell'); if (pc) pc.textContent = st.pot ? `$${st.pot}` : '';

  $('#heat').innerHTML = `<span class="lbl">розыск</span>` + Array.from({ length: C.MAX_HEAT }, (_, i) => `<span class="fl ${i < st.heat ? 'on' : ''}">${ic('flame')}</span>`).join('');
  $('#pot').innerHTML = st.pot ? `джекпот Общака <b>$${st.pot}</b>` : '';
  $('#board').classList.toggle('raid', st.omon !== null);

  const dz = $('#dice');
  dz.className = 'dice' + (st.dice && st.dice.skin ? ' ' + st.dice.skin : '');
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
  const n = st.players.length;
  $('#players').style.setProperty('--n', n <= 4 ? n : 3);
  $('#players').innerHTML = st.players.map((p, i) => {
    const delta = prevMoney[p.id] != null ? p.money - prevMoney[p.id] : 0;
    return `<div class="pc ${i === st.turn ? 'turn' : ''} ${p.bankrupt ? 'dead' : ''} ${p.id === myId ? 'me' : ''}" style="--c:${p.color}" data-pid="${p.id}">
      <div class="pc-head"><span class="pc-pic${fr(p)}">${avatar(p)}</span>
        <div class="pc-top"><span class="nm">${esc(p.name)}</span>${p.jail ? `<span class="pc-flag" title="В тюрьме">${ic('lock')}</span>` : ''}${!p.connected ? `<span class="pc-flag off" title="Нет связи">${ic('offline')}</span>` : ''}</div></div>
      <div class="pc-body">${ttl(p.title)}
        <div class="money">${p.bankrupt ? 'РАЗОРЁН' : '$' + p.money}${delta ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>` : ''}</div>
        <div class="stats"><span title="Авторитет">${ic('crown')}${p.auth}</span><span title="Братки">${ic('fist')}${p.goons}</span><span title="Точки">${ic('house')}${counts[p.id] || 0}</span></div>
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
  else if (st.phase === 'GLOK') status = '<b>Дима Глок</b> решает вопросики…';
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
  return { BUY: `думает купить ${c}`, UPGRADE: `прокачивает ${c}?`, GYM: 'выбирает братка', CASINO: 'у рулетки…', STRELKA: `на чужой точке ${c}`, JAIL: 'сидит в тюрьме', OCHKO: `играет в очко: ${q.sum || ''}` }[q.type] || 'думает';
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
    <button class="btn ${isRace ? 'gold' : 'red'} big glok-btn" ${dead ? 'disabled' : ''}>${isRace ? 'Я ЗДЕСЬ!' : 'ЗАБРАТЬ $200'}</button>
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
      <span class="of-em">${cellIc(c)}</span><div class="of-text">${text}<div class="of-price">за <b>$${o.price}</b> <small>(цена банка $${c.price})</small></div></div>
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
      <div class="sh-head"><span class="sh-em">${ic('deal')}</span><div><div class="sh-title">Сделка</div><div class="sh-sub">Точки можно продавать и покупать друг у друга</div></div></div>
      <div class="muted up">С кем</div>
      <div class="tr-people">${others.map((p) => `<button class="tr-p ${p.id === to ? 'on' : ''}" data-to="${p.id}" style="--c:${p.color}"><span class="pl-pic">${avatar(p)}</span>${esc(p.name)}</button>`).join('')}</div>
      <div class="seg two"><button data-mode="sell" class="${mode === 'sell' ? 'on' : ''}">Продать свою</button><button data-mode="buy" class="${mode === 'buy' ? 'on' : ''}">Купить у ${esc(toP.name)}</button></div>
      <div class="muted up">Точка</div>
      <div class="tr-cells">${cells.length ? cells.map((k) => { const b = BOARD[k], pr = st.props[k]; return `<button class="tr-c ${k === cell ? 'on' : ''}" data-cell="${k}" style="--g:${GROUPS[b.group]}">${b.name}${stars(pr.level)}</button>`; }).join('') : `<div class="hint">${mode === 'sell' ? 'У тебя пока нет точек' : 'У него нет точек'}</div>`}</div>
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


// ---------- Казино ----------
const RED_N = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const SUIT = { s: 'M12 3c3 4 7 6.5 7 10a3.5 3.5 0 0 1-6 2.4l1 4.6h-4l1-4.6A3.5 3.5 0 0 1 5 13c0-3.5 4-6 7-10z', c: 'M12 3.5a3.5 3.5 0 0 1 3.2 4.9A3.5 3.5 0 1 1 13 14.5l1 5.5h-4l1-5.5a3.5 3.5 0 1 1-2.2-6.1A3.5 3.5 0 0 1 12 3.5z', h: 'M12 20.5C6 16 3.5 12.5 3.5 9.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8.5 2.2c0 3.3-2.5 6.8-8.5 11.3z', d: 'M12 3l6.5 9-6.5 9-6.5-9z' };
const suitSvg = (su) => `<svg viewBox="0 0 24 24" class="suit"><path d="${SUIT[su]}" fill="currentColor"/></svg>`;
const cardHTML = (c) => `<div class="pcard ${c.s === 'h' || c.s === 'd' ? 'red' : ''}"><b>${c.r}</b>${suitSvg(c.s)}<b class="pc-bot">${c.r}</b></div>`;
const casinoUI = { game: 'slots', bet: null, pick: 'red' };
const GAMES = {
  slots: { t: 'Автомат', i: 'slots', d: 'Три одинаковых: вишни ×3, лимоны ×4, колокола ×6, бриллианты ×10, семёрки ×25. Пара — ставка назад и +20%.' },
  roulette: { t: 'Рулетка', i: 'roulette', d: 'Красное или чёрное — ×2. Зеро — ×36.' },
  ochko: { t: 'Очко', i: 'cards', d: 'Против крупье до 21. Выигрыш ×2, очко с раздачи и два туза ×2.5.' },
};
function openCasino(q) {
  const mp = meP();
  if (!q.bets.includes(casinoUI.bet)) casinoUI.bet = q.bets[0];
  const shuler = mp.char === 'shuler';
  $('#sheet').innerHTML = `
    <div class="casino-sheet">
      <div class="cs-head"><div class="cs-title">КАЗИНО</div><div class="cs-sub">«Три топора» · у тебя $${mp.money}${shuler ? ' · <b>Шулер: выигрыш +50%</b>' : ''}</div></div>
      <div class="cs-games">${Object.entries(GAMES).map(([k, g]) => `<button data-game="${k}" class="${k === casinoUI.game ? 'on' : ''}">${ic(g.i)}${g.t}</button>`).join('')}</div>
      <div class="cs-desc">${GAMES[casinoUI.game].d}</div>
      ${casinoUI.game === 'roulette' ? `<div class="cs-picks">
        <button data-pick="red" class="rp red ${casinoUI.pick === 'red' ? 'on' : ''}">Красное ×2</button>
        <button data-pick="black" class="rp black ${casinoUI.pick === 'black' ? 'on' : ''}">Чёрное ×2</button>
        <button data-pick="zero" class="rp zero ${casinoUI.pick === 'zero' ? 'on' : ''}">Зеро ×36</button></div>` : ''}
      <div class="cs-chips">${q.bets.map((b) => `<button data-bet="${b}" class="chip c${b} ${b === casinoUI.bet ? 'on' : ''}"><span>$${b}</span></button>`).join('')}</div>
      <div class="sh-btns"><button class="btn gold big" id="csgo">Играть на $${casinoUI.bet}</button><button class="btn" id="csno">Не играю</button></div>
      <div class="sh-timer"><i id="shbar"></i></div>
    </div>`;
  $$('[data-game]').forEach((b) => b.onclick = () => { casinoUI.game = b.dataset.game; SFX.play('click'); openCasino(q); });
  $$('[data-pick]').forEach((b) => b.onclick = () => { casinoUI.pick = b.dataset.pick; SFX.play('click'); openCasino(q); });
  $$('[data-bet]').forEach((b) => b.onclick = () => { casinoUI.bet = Number(b.dataset.bet); SFX.play('tick'); openCasino(q); });
  const send = (choice) => { socket.emit('decide', { choice }); SFX.play('click'); $$('#sheet button').forEach((x) => { x.disabled = true; }); };
  $('#csgo').onclick = () => send(casinoUI.game === 'roulette' ? `roulette:${casinoUI.bet}:${casinoUI.pick}` : `${casinoUI.game}:${casinoUI.bet}`);
  $('#csno').onclick = () => send('skip');
  $('#sheetback').classList.add('show');
}

function wheelSVG() {
  const a = 360 / 37, R = 100, r2 = 64;
  const pt = (ang, rad) => { const t = (ang - 90) * Math.PI / 180; return `${(110 + rad * Math.cos(t)).toFixed(2)},${(110 + rad * Math.sin(t)).toFixed(2)}`; };
  let s = '';
  WHEEL.forEach((n, i) => {
    const a0 = i * a - a / 2, a1 = i * a + a / 2;
    const col = n === 0 ? '#1a9b4a' : RED_N.has(n) ? '#c0182c' : '#16121a';
    s += `<path d="M${pt(a0, R)} A${R},${R} 0 0 1 ${pt(a1, R)} L${pt(a1, r2)} A${r2},${r2} 0 0 0 ${pt(a0, r2)} Z" fill="${col}" stroke="#c9962e" stroke-width=".6"/>`;
    s += `<text x="110" y="${110 - 86}" transform="rotate(${i * a} 110 110)" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" font-family="Manrope,sans-serif">${n}</text>`;
  });
  return `<svg viewBox="0 0 220 220" class="wheel-svg"><circle cx="110" cy="110" r="108" fill="#5a3712" stroke="#c9962e" stroke-width="3"/>${s}
    <circle cx="110" cy="110" r="62" fill="url(#wg)"/><defs><radialGradient id="wg"><stop offset="0" stop-color="#7a5320"/><stop offset="1" stop-color="#2e1d0a"/></radialGradient></defs>
    ${[0, 45, 90, 135].map((d) => `<rect x="107" y="62" width="6" height="96" rx="3" fill="#d9b25a" transform="rotate(${d} 110 110)"/>`).join('')}<circle cx="110" cy="110" r="10" fill="#f5d27a"/></svg>`;
}

function casinoFx(fx) {
  const p = byId(fx.pid), who = p ? esc(p.name) : '';
  const res = (won, lost, extra) => `<div class="fx-res ${won ? 'good' : 'badr'}">${won ? `+$${won}` : lost}${extra || ''}</div>`;
  if (fx.type === 'slots') {
    const reel = ['cherry', 'lemon', 'bell', 'diamond', 'seven'];
    const sym = (n) => ic('sl-' + n, 'sym sym-' + n);
    const ov = overlay(`<div class="fx casino slot-fx"><div class="fx-title">АВТОМАТ</div><div class="fx-sub">${who} · ставка $${fx.bet}</div>
      <div class="slot-machine"><div class="reels"><span>${sym('cherry')}</span><span>${sym('lemon')}</span><span>${sym('diamond')}</span></div><i class="slot-line"></i></div>
      ${res(fx.won, `−$${fx.bet}`, fx.reels.every((x) => x === 'seven') ? '<div class="jack">ДЖЕКПОТ</div>' : '')}</div>`, 2200);
    const spans = $$('.reels span', ov);
    let n = 0;
    const iv = setInterval(() => {
      spans.forEach((s, i) => { if (n <= 6 + i * 4) { s.innerHTML = sym(reel[Math.floor(Math.random() * reel.length)]); s.classList.add('spin'); } else { s.innerHTML = sym(fx.reels[i]); s.classList.remove('spin'); } });
      if (n === 7 || n === 11 || n === 15) SFX.play('tick');
      if (++n > 15) { clearInterval(iv); ov.classList.add('done'); SFX.play(fx.won ? 'casino-win' : 'lose'); }
    }, 70);
  } else if (fx.type === 'roulette') {
    const name = { red: 'красное', black: 'чёрное', zero: 'зеро' };
    const ov = overlay(`<div class="fx casino roul-fx"><div class="fx-title">РУЛЕТКА</div><div class="fx-sub">${who} ставит $${fx.bet} на ${name[fx.color]}</div>
      <div class="wheel"><div class="wheel-rot">${wheelSVG()}</div><i class="wheel-ptr"></i></div>
      <div class="roul-n ${fx.res}">${fx.n}</div>${res(fx.won, `−$${fx.bet}`)}</div>`, 4100);
    const rot = $('.wheel-rot', ov), idx = WHEEL.indexOf(fx.n);
    SFX.play('dice', 0.5);
    requestAnimationFrame(() => requestAnimationFrame(() => { rot.style.transform = `rotate(${-(360 * 5 + idx * (360 / 37))}deg)`; }));
    let t = 0; const tk = setInterval(() => { SFX.play('tick', 0.35); if (++t > 14) clearInterval(tk); }, 120 + t * 10);
    setTimeout(() => { ov.classList.add('done'); SFX.play(fx.won ? 'casino-win' : 'lose'); }, 3000);
  } else if (fx.type === 'ochko') {
    const txt = { golden: 'ЗОЛОТОЕ ОЧКО!', natural: 'ОЧКО С РАЗДАЧИ!', win: 'ВЫИГРАЛ', bust: 'ПЕРЕБОР', lose: 'КРУПЬЕ ВЗЯЛ', push: 'НИЧЬЯ' }[fx.result];
    const ov = overlay(`<div class="fx casino ochko-fx"><div class="fx-title">ОЧКО</div><div class="fx-sub">${who} · ставка $${fx.bet}</div>
      <div class="ochko"><div class="oc-row"><span class="oc-lbl">Крупье · <b>${fx.d}</b></span><div class="cards">${fx.dealer.map(cardHTML).join('')}</div></div>
      <div class="oc-row"><span class="oc-lbl">${who} · <b>${fx.me}</b></span><div class="cards">${fx.hand.map(cardHTML).join('')}</div></div></div>
      <div class="fx-res ${fx.won ? 'good' : fx.result === 'push' ? '' : 'badr'}">${txt}${fx.won ? ` +$${fx.won}` : fx.result === 'push' ? '' : ` −$${fx.bet}`}</div></div>`, 2900);
    SFX.play('card');
    setTimeout(() => { ov.classList.add('done'); SFX.play(fx.won ? 'casino-win' : fx.result === 'push' ? 'click' : 'lose'); }, 700);
  }
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

// Фишки стоят на внутренней кромке клетки — не закрывают название
function tokenSpot(pos) {
  const { x, y } = cellXY(pos);
  const dx = x === 0 ? 1 : x === 5 ? -1 : 0, dy = y === 0 ? 1 : y === 5 ? -1 : 0;
  const k = dx && dy ? 0.36 : 0.44;
  return [((x + 0.5 + dx * k) / 6) * 100, ((y + 0.5 + dy * k) / 6) * 100, dy ? 'x' : 'y'];
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
    const [lx, ly, ax] = tokenSpot(pos);
    const spread = n > 1 ? Math.min(4, 11 / (n - 1)) : 0, off = (k - (n - 1) / 2) * spread;
    el.style.left = `${lx}%`;
    el.style.top = `${ly}%`;
    el.style.setProperty('--dx', `${ax === 'x' ? off : 0}cqw`);
    el.style.setProperty('--dy', `${ax === 'y' ? off : 0}cqw`);
    el.classList.toggle('turn', st.players[st.turn] && st.players[st.turn].id === p.id);
    el.classList.toggle('me', p.id === myId);
    if (hopPid === p.id) { el.classList.remove('hopping'); void el.offsetWidth; el.classList.add('hopping'); }
  });
  $$('.tok[data-pid]', layer).forEach((el) => { if (!alive.has(el.dataset.pid)) el.remove(); });
  let om = $('.tok.omon', layer);
  if (st.omon !== null) {
    if (!om) { om = document.createElement('div'); om.className = 'tok omon'; om.innerHTML = ic('siren'); layer.appendChild(om); }
    const [lx, ly] = tokenSpot(st.omon);
    om.style.left = `${lx}%`;
    om.style.top = `${ly}%`;
  } else if (om) om.remove();
}

// ---------- Лента ----------
const SOUND_BY_KIND = { buy: 'buy', rent: 'cash', salary: 'cash', loss: 'bad', sell: 'bad', jail: 'jail', police: 'jail', bankrupt: 'bankrupt', goon: 'click', chat: 'chat', join: 'turn', 'trade-ok': 'buy' };
const LOG_IC = { dice: 'dice', buy: 'house', rent: 'coin', salary: 'coin', loss: 'coin', sell: 'coin', win: 'trophy', strelka: 'sword', omon: 'siren', police: 'siren', jail: 'lock', bankrupt: 'skull', card: 'c-zvonok', glok: 'bolt', trade: 'deal', 'trade-ok': 'deal', gift: 'gift', goon: 'fist', start: 'flag', join: 'plus' };
function appendLog(l, live) {
  const box = $('#log');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'e k-' + l.kind;
  if (l.kind === 'chat') {
    const p = byId(l.pid);
    div.innerHTML = `<b style="color:${p ? p.color : '#fff'}">${esc(l.name || '?')}:</b> ${esc(l.text)}`;
    if (live) bubble(l.pid, l.text);
  } else {
    const k = LOG_IC[l.kind];
    div.innerHTML = (k ? ic(k, 'log-ic') : '') + esc(l.text);
  }
  box.appendChild(div);
  while (box.children.length > 60) box.firstChild.remove();
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (nearBottom || !live) box.scrollTop = box.scrollHeight;
  if (!live) return;
  if (l.kind === 'omon' && /выехал/.test(l.text)) { SFX.play('omon'); flash('ОМОН ВЫЕХАЛ', 'omon'); }
  else if (l.kind === 'omon' && /БЕСПРЕДЕЛ/.test(l.text)) { SFX.play('omon'); flash('БЕСПРЕДЕЛ', 'omon'); }
  else if (l.kind === 'omon') SFX.play('jail');
  else if (SOUND_BY_KIND[l.kind]) SFX.play(SOUND_BY_KIND[l.kind]);
  if (l.kind === 'bankrupt') flash(l.text, 'dead');
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
          <div style="--c:${a.color}"><div class="fx-av">${avatar(a)}</div><div class="fx-nm">${esc(a.name)}</div><div class="fx-pw" data-final="${fx.aP}">?</div><div class="fx-roll">кубик ${fx.aRoll} + сила ${fx.aP - fx.aRoll}</div></div>
          <div class="vs-x">VS</div>
          <div style="--c:${o.color}"><div class="fx-av">${avatar(o)}</div><div class="fx-nm">${esc(o.name)}</div><div class="fx-pw" data-final="${fx.oP}">?</div><div class="fx-roll">кубик ${fx.oRoll} + сила ${fx.oP - fx.oRoll}</div></div>
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
    overlay(`<div class="fx card-fx"><div class="cf-inner"><div class="cf-top">${ic('c-zvonok')}Звонок с зоны</div><div class="cf-who">${p ? esc(p.name) : ''}</div><div class="cf-text">${esc(fx.text)}</div></div></div>`, 1700);
  } else if (fx.type === 'slots' || fx.type === 'roulette' || fx.type === 'ochko') {
    casinoFx(fx);
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
    flash(`Сделка: ${c.name} за $${fx.price}`, 'deal');
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
  return `<div class="rents">${[0, 1, 2, 3].map((l) => `<div><span>${l ? stars(l) : 'база'}</span><b>$${c.rent * Math.pow(2, l) * k}</b></div>`).join('')}</div>`;
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
      html = head(cellIc(c), c.name, 'Ничья точка. Берём под крышу?', GROUPS[c.group]) +
        `<div class="sh-info"><div>Цена <b class="neg">$${q.price}</b>${q.price < c.price ? '<small class="perk">скидка Барыги</small>' : ''}</div><div>У тебя <b>$${mp.money}</b></div></div>` + rentRows(c.id) +
        `<div class="hint">Обе точки одного цвета — рента ×2. Покупка поднимает розыск.</div>` +
        btns([['yes', `Крышевать за $${q.price}`, 'gold'], ['no', 'Пас']]);
      break;
    case 'UPGRADE':
      html = head(cellIc(c), `Прокачка «${c.name}»`, `Звёзд сейчас: ${q.level}, станет: ${q.level + 1}`, GROUPS[c.group]) +
        `<div class="sh-info"><div>Рента сейчас <b>$${rentOf(st.props, c.id) * (st.inflation || 1)}</b></div><div>Станет <b class="pos">$${c.rent * Math.pow(2, q.level + 1) * (st.inflation || 1)}</b></div></div>` +
        btns([['yes', `Прокачать за $${q.price}`, 'gold'], ['no', 'Не сейчас']]);
      break;
    case 'GYM':
      html = head(ic('fist'), 'Качалка', 'Нанять братка?') +
        `<div class="sh-info"><div>Братков <b>${mp.goons}/${q.max}</b></div><div>Цена <b class="neg">$${q.price}</b></div></div>` +
        `<div class="hint">Браток садится вместо тебя (менты, ОМОН) и добавляет +1 к силе на стрелке.</div>` +
        btns([['yes', `Нанять за $${q.price}`, 'gold'], ['no', 'Уйти']]);
      break;
    case 'CASINO':
      return openCasino(q);
    case 'OCHKO':
      html = head('🃏', 'Очко', `Ставка $${q.bet} · ${q.peek ? 'Шулер видит карту крупье' : 'крупье добирает до 17'}`, '#c0283a') +
        `<div class="ochko">
          <div class="oc-row"><span class="oc-lbl">Крупье</span><div class="cards">${q.dealer.map(cardHTML).join('')}${q.peek ? '' : '<div class="pcard back"></div>'}</div></div>
          <div class="oc-row"><span class="oc-lbl">Ты · <b>${q.sum}</b></span><div class="cards">${q.hand.map(cardHTML).join('')}</div></div>
        </div><div class="hint">Валет 2, дама 3, король 4, туз 11. Больше 21 — перебор. Два туза — золотое очко.</div>` +
        btns([['hit', 'Ещё карту', 'gold'], ['stand', 'Хватит']]);
      break;
    case 'STRELKA':
      html = head(ic('sword'), 'Чужая территория', `«${c.name}» держит ${esc(q.ownerName)}`, byId(q.owner) && byId(q.owner).color) +
        `<div class="sh-info"><div>Доля хозяину <b class="neg">$${q.rent}</b></div><div>Штраф за слив <b class="neg">$${q.rent * 2}</b></div></div>` +
        `<div class="power"><div><span>Ты</span><b>кубик + ${q.my}</b></div><div class="vs-x">VS</div><div><span>${esc(q.ownerName)}</span><b>кубик + ${q.his}</b></div></div>` +
        `<div class="hint">Сила = авторитет + братки (+2 у Бойца). Победа — точка твоя (−1 звезда), +1 авторитет. Ничья за хозяином.</div>` +
        btns([['pay', `Заплатить $${q.rent}`], ['fight', 'Забить стрелку', 'red']]);
      break;
    case 'JAIL':
      html = head(ic('lock'), 'Ты в тюрьме', 'Сидишь один ход') +
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
  modal(`<div class="sh-head" style="--g:${c.group ? GROUPS[c.group] : 'var(--gold)'}"><span class="sh-em">${cellIc(c)}</span><div><div class="sh-title">${c.name}</div>
    <div class="sh-sub">${c.type === 'prop' ? (o ? `Крыша: <b style="color:${o.color}">${esc(o.name)}</b>${stars(pr.level)}` : `Свободна · $${c.price}`) : ''}</div></div></div>
    ${c.type === 'prop' ? rentRows(id) + `<div class="hint">Прокачка: $${c.up} за звезду. Полный район — рента ×2 на базе.${o ? ` Сейчас рента: <b>$${rentOf(st.props, id) * (st.inflation || 1)}</b>` : ''}</div>` : `<p class="desc">${desc}</p>`}`);
}

function showMenu() {
  const m = modal(`<div class="menu">
    <button class="btn" data-a="shop">${ic('cart')}Магазин</button>
    <button class="btn" data-a="trade">${ic('deal')}Предложить сделку</button>
    <button class="btn" data-a="chars">${ic('masks')}Кто есть кто</button>
    <button class="btn" data-a="rules">${ic('book')}Как играть</button>
    <button class="btn" data-a="sound">${SFX.on ? ic('mute') + 'Выключить звук' : ic('sound') + 'Включить звук'}</button>
    <button class="btn" data-a="link">${ic('link')}Ссылка на игру</button>
    <button class="btn red" data-a="quit">${ic('flag')}Сдаться и выйти</button>
  </div>`);
  $$('[data-a]', m).forEach((b) => b.onclick = () => {
    const a = b.dataset.a;
    m.closeModal();
    if (a === 'trade') showTrade();
    if (a === 'shop') renderShop('coins');
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
    <p><b>Ход.</b> Бросаешь две кости и идёшь по кругу. Прошёл Общак — получи $${C.SALARY}. Встал на него ровно — забираешь джекпот: туда падает половина всех налогов и штрафов. Дубль — ходишь ещё раз, три дубля подряд — к ментам.</p>
    <p><b>Свободная точка</b> — можно взять под крышу. Своя — прокачать до трёх звёзд, каждая звезда удваивает ренту. Оба цвета района у тебя — рента ×2.</p>
    <p><b>Чужая точка</b> — плати долю или забивай стрелку: кубик + авторитет + братки против хозяина. Выиграл — точка твоя. Слил — штраф ×2 и минус браток.</p>
    <p><b>Сделки</b> — в любой момент можно продать свою точку или выкупить чужую, кнопка сделки вверху экрана.</p>
    <p><b>Персонажи.</b> Спортик сильнее на стрелках, Барыга покупает дешевле, Адвокат не сидит, Шулер везуч в казино, Блатной неприкасаем для Глока, Бухгалтер получает больше с Общака, Громила нанимает братков за полцены.</p>
    <p><b>Розыск</b> растёт от покупок, прокачек, стрелок и казино. На пятом огоньке выезжает ОМОН. Кого накроет — штраф или минус браток.</p>
    <p><b>Дима Глок</b> — смотрящий за районом. Приходит когда захочет: шмонает богатых, путает бабки, гоняет всех назад, закрывает точки, обносит джекпот и даёт задания. Иногда кнопку надо жать быстрее всех, а иногда это подстава.</p>
    <p><b>Победа</b> — последний оставшийся или самый богатый, когда кончатся круги. Результаты идут в топ братвы.</p>
  </div>`);
}

function modal(html) {
  const back = document.createElement('div');
  back.className = 'sheet-back show modal';
  back.innerHTML = `<div class="sheet"><button class="close" aria-label="Закрыть">${ic('close')}</button>${html}</div>`;
  document.body.appendChild(back);
  back.closeModal = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 250); };
  back.onclick = (e) => { if (e.target === back || e.target.classList.contains('close')) back.closeModal(); };
  return back;
}

// ---------- Финал ----------
function renderOver() {
  const w = byId(st.winner);
  const host = st.hostId === myId;
  app.innerHTML = `
  <section class="screen over">
    <div class="confetti">${Array.from({ length: 36 }, (_, i) => `<i style="left:${Math.random() * 100}%;animation-delay:${Math.random() * 2}s;background:${['#ffcc33', '#ff4757', '#3d8bff', '#2ed573', '#b56bff'][i % 5]}"></i>`).join('')}</div>
    <div class="win-pic${fr(w)}" style="--c:${w ? w.color : '#fff'}">${w ? avatar(w) : ''}<span class="crown">${assetFor('crown') ? `<img src="${assetFor('crown')}" alt="">` : ic('crown')}</span></div>
    <h1 class="win-name" style="color:${w ? w.color : '#fff'}">${w ? esc(w.name) : 'Никто'}</h1>
    <div class="win-sub">${w && w.id === myId ? 'Город твой. Уважение.' : 'забрал весь город'}</div>
    <div class="standings">
      ${(st.standings || []).map((s, i) => { const p = byId(s.id); if (!p) return ''; return `
        <div class="st-row ${p.id === myId ? 'me' : ''}" style="--c:${p.color}">
          <span class="pl-place">${placeBadge(i)}</span><span class="pl-pic${fr(p)}">${avatar(p)}</span><span class="nm">${esc(p.name)}${ttl(p.title)}</span>
          <span class="worth">${s.bankrupt ? 'разорён' : '$' + s.worth}</span>
        </div>`; }).join('')}
    </div>
    ${(st.titles || []).length ? `<div class="list-title">Титулы партии</div><div class="titles">${st.titles.map((t) => { const p = byId(t.pid); return p ? `<div class="title-card" style="--c:${p.color}"><span class="tc-em">${ic(t.emoji)}</span><b>${t.title}</b><span>${esc(p.name)}</span><small>${t.desc}</small></div>` : ''; }).join('')}</div>` : ''}
    <div class="row">
      ${host ? '<button class="btn gold grow" id="again">Ещё партию</button>' : '<div class="wait">Босс может начать новую партию</div>'}
      <button class="btn" id="top" aria-label="Топ">${ic('trophy')}</button><button class="btn" data-shop="gifts" aria-label="Магазин">${ic('cart')}</button>
      <button class="btn" id="out">Выйти</button>
    </div>
  </section>`;
  if ($('#again')) $('#again').onclick = () => socket.emit('rematch');
  bindShopButtons(app);
  $('#out').onclick = () => socket.emit('leave');
  $('#top').onclick = () => { renderTop().then(() => { const b = $('#back'); if (b) b.onclick = () => { screen = 'over'; renderOver(); }; }); };
}


// ---------- Магазин ----------
const SHOP_TABS = [['coins', 'Монеты', 'coin'], ['chars', 'Персонажи', 'masks'], ['frame', 'Рамки', 'frame'], ['dice', 'Кубики', 'dice'], ['title', 'Титулы', 'tag'], ['gifts', 'Подарки', 'gift']];
let shopTab = 'coins', shopFocus = null;
const myFace = () => (me && me.photo ? `<img src="${esc(me.photo)}" alt="" referrerpolicy="no-referrer">` : pic(profile.char));
function renderShop(tab, focus) {
  if (tab === 'frames') tab = 'frame';
  shopTab = tab || shopTab; shopFocus = focus || null;
  screen = 'shop';
  closeSheet(); closeGlokTask();
  $$('.modal').forEach((m) => m.remove());
  const eq = (wallet && wallet.equip) || {};
  const item = (id, it, preview, label) => {
    const has = owns(id), on = eq[it.kind] === id;
    return `<div class="shop-item ${on ? 'on' : ''} ${shopFocus === id || (it.char && shopFocus === it.char) ? 'focus' : ''}">
      <div class="si-prev">${preview}</div><div class="si-name">${label}</div>
      ${has ? (it.kind === 'char' ? `<span class="si-own">${ic('check')}Твой</span>`
        : `<button class="btn small ${on ? '' : 'gold'}" data-equip="${id}" data-slot="${it.kind}">${on ? 'Снять' : 'Надеть'}</button>`)
        : `<button class="btn small gold" data-buy="${id}">${it.price}${COIN}</button>`}
    </div>`;
  };
  const list = (kind) => Object.entries(SHOP).filter(([, v]) => v.kind === kind);
  let body = '';
  if (shopTab === 'coins') {
    body = `<div class="packs">${PACKS.map((p, i) => `
      <button class="pack" data-pack="${p.id}">
        ${p.tag ? `<span class="pack-tag">${p.tag}</span>` : ''}
        <span class="pack-pile">${COIN.repeat(i + 1)}</span>
        <b>${p.coins}</b><small>${p.label}</small>
        <span class="pack-price">${ic('tgstar')}${p.stars}</span>
      </button>`).join('')}</div>
      <div class="hint center-t">${starsOk ? 'Оплата через Telegram Stars — прямо в Telegram, без карт.' : config.tg ? 'Чтобы купить монеты, войди через Telegram на главном экране или открой игру в боте.' : 'Покупка монет заработает, когда подключат бота (см. README).'}</div>
      <div class="free-coins">
        <b>Монеты бесплатно</b>
        <div>${ic('calendar')}Бонус дня: +${EARN.daily} (серия до 7 дней — до +${EARN.daily + 30})</div>
        <div>${ic('dice')}Каждая партия: +${EARN.game}, победа: +${EARN.win} (до ${EARN.dayCap} в день)</div>
        <button class="btn small gold" id="daily2" ${!wallet || wallet.daily_on === todayStr() ? 'disabled' : ''}>${!wallet || wallet.daily_on === todayStr() ? 'Бонус уже забран — приходи завтра' : 'Забрать бонус дня'}</button>
      </div>`;
  } else if (shopTab === 'chars') {
    body = `<div class="shop-grid chars-grid">${list('char').map(([id, v]) => item(id, v, medal(v.char), `<b>${CHARS[v.char].name}</b><small>${CHARS[v.char].perk}</small>`)).join('')}</div>
      <div class="hint center-t">Спортик, Барыга, Бухгалтер и Громила — бесплатно для всех.</div>`;
  } else if (shopTab === 'frame') {
    body = `<div class="shop-grid">${list('frame').map(([id, v]) => item(id, v, `<span class="pl-pic big ${id}">${myFace()}</span>`, `<b>${v.name}</b>`)).join('')}</div>
      <div class="hint center-t">Рамку видят все: в лобби, в игре, на финале и в топе.</div>`;
  } else if (shopTab === 'dice') {
    body = `<div class="shop-grid">${list('dice').map(([id, v]) => item(id, v, `<div class="dice mini-dice ${id}"><div class="die">${PIPS[5].map((n) => `<i style="grid-area:${Math.ceil(n / 3)}/${((n - 1) % 3) + 1}"></i>`).join('')}</div><div class="die">${PIPS[6].map((n) => `<i style="grid-area:${Math.ceil(n / 3)}/${((n - 1) % 3) + 1}"></i>`).join('')}</div></div>`, `<b>${v.name}</b>`)).join('')}</div>
      <div class="hint center-t">Твои кубики видят все, когда бросаешь ты.</div>`;
  } else if (shopTab === 'title') {
    body = `<div class="shop-grid">${list('title').map(([id, v]) => item(id, v, `<span class="title-prev">${esc(profile.name || (me && me.name) || 'Ты')}${ttl(id)}</span>`, `<b>${v.name}</b>`)).join('')}</div>
      <div class="hint center-t">Титул висит под именем в лобби, в игре и в топе.</div>`;
  } else {
    body = `<div class="shop-grid">${GIFTS.map((g) => `<div class="shop-item"><div class="si-prev gift-em">${giftIc(g, 'gift-big')}</div><div class="si-name"><b>${g.name}</b></div><span class="si-own price">${g.price}${COIN}</span></div>`).join('')}</div>
      <div class="hint center-t">Дари прямо в игре: кнопка подарка рядом с чатом. Подарок летит через весь стол, а получателю — уважуха в топ.</div>`;
  }
  app.innerHTML = `
  <section class="screen shop">
    <div class="top-head"><button class="icon-btn" id="back" aria-label="Назад">${ic('back')}</button><h2>Магазин</h2>${coinChip().replace(' data-shop', '')}</div>
    <div class="shop-tabs">${SHOP_TABS.map(([k, l, i]) => `<button data-tab="${k}" class="${k === shopTab ? 'on' : ''}">${ic(i)}${l}</button>`).join('')}</div>
    ${body}
    <div class="row centered"><a class="link" href="/api/terms" target="_blank" rel="noopener">Условия покупок</a></div>
  </section>`;
  const fo = $('.shop-item.focus'); if (fo) fo.scrollIntoView({ block: 'center' });
  $('.shop-tabs .on').scrollIntoView({ inline: 'center', block: 'nearest' });
  $('#back').onclick = () => { screen = null; if (st && myId) socket.emit('cos'); render(); };
  $$('[data-tab]').forEach((b) => b.onclick = () => { SFX.play('click'); renderShop(b.dataset.tab); });
  $$('[data-buy]').forEach((b) => b.onclick = () => buyItem(b.dataset.buy, b));
  $$('[data-equip]').forEach((b) => b.onclick = () => equipItem(b.dataset.slot, ((wallet.equip || {})[b.dataset.slot] === b.dataset.equip) ? null : b.dataset.equip));
  $$('[data-pack]').forEach((b) => b.onclick = () => buyPack(b.dataset.pack, b));
  if ($('#daily2')) $('#daily2').onclick = claimDaily;
}
async function buyItem(id, btn) {
  const it = SHOP[id];
  if (!wallet || wallet.coins < it.price) { toast(`Не хватает ${it.price - (wallet ? wallet.coins : 0)} монет`); SFX.play('bad'); return renderShop('coins'); }
  btn.disabled = true;
  try {
    wallet = (await api('/api/buy', { item: id })).wallet;
    SFX.play('buy'); SFX.vibe([30, 30, 60]);
    toast(it.kind === 'char' ? `${CHARS[it.char].name} теперь твой!` : `Куплено: ${it.name}`);
    if (it.kind === 'char') { profile.char = it.char; LS.set('bratva_profile', profile); if (st && st.status === 'LOBBY') socket.emit('setChar', { char: it.char }); }
  } catch (e) { toast(e.message); SFX.play('bad'); }
  renderShop(shopTab);
}
async function equipItem(slot, item) {
  try { wallet = (await api('/api/equip', { slot, item })).wallet; SFX.play('click'); } catch (e) { toast(e.message); }
  renderShop(shopTab);
}
async function claimDaily() {
  try {
    const d = await api('/api/daily', {});
    wallet = d.wallet;
    if (d.ok) { SFX.play('casino-win'); toast(`+${d.amount} монет · серия ${d.streak} ${d.streak > 1 ? 'дня' : 'день'}`); flash(`+${d.amount} монет`, 'deal'); }
    else toast('Бонус уже забран — приходи завтра');
  } catch (e) { toast(e.message); }
  refreshCoins();
  if (screen === 'shop') renderShop(shopTab);
}
async function buyPack(id, btn) {
  if (!starsOk) return toast(config.tg ? 'Сначала войди через Telegram' : 'Оплата пока не подключена');
  btn.disabled = true;
  try {
    const { link } = await api('/api/stars/invoice', { pack: id });
    const before = wallet ? wallet.coins : 0;
    const W = window.Telegram && window.Telegram.WebApp;
    const poll = (n = 20) => setTimeout(async () => {
      await loadWallet();
      if (wallet && wallet.coins > before) { SFX.play('casino-win'); flash(`+${wallet.coins - before} монет`, 'deal'); if (screen === 'shop') renderShop(shopTab); }
      else if (n > 0) poll(n - 1);
    }, 1500);
    if (W && W.openInvoice) {
      W.openInvoice(link, (status) => {
        if (status === 'paid') { toast('Оплачено! Монеты уже летят'); poll(); }
        else if (status === 'failed') toast('Оплата не прошла');
        btn.disabled = false;
      });
    } else { window.open(link, '_blank'); toast('Оплати в Telegram и вернись — монеты придут сами'); poll(40); btn.disabled = false; }
  } catch (e) { toast(e.message); btn.disabled = false; }
}

// ---------- Подарки ----------
function showGifts(toId) {
  if (!st) return;
  const others = st.players.filter((p) => p.id !== myId);
  if (!others.length) return toast('Некому дарить');
  let to = toId || (curP() && curP().id !== myId ? curP().id : others[0].id), gift = GIFTS[2].id;
  const m = modal('<div id="giftbox"></div>');
  const draw = () => {
    const g = GIFTS.find((x) => x.id === gift), bal = wallet ? wallet.coins : 0;
    $('#giftbox', m).innerHTML = `
      <div class="sh-head"><span class="sh-em">${ic('gift')}</span><div><div class="sh-title">Подарок братве</div><div class="sh-sub">У тебя ${bal} монет · получатель получит уважуху в топ</div></div></div>
      <div class="muted up">Кому</div>
      <div class="tr-people">${others.map((p) => `<button class="tr-p ${p.id === to ? 'on' : ''}" data-to="${p.id}" style="--c:${p.color}"><span class="pl-pic${fr(p)}">${avatar(p)}</span>${esc(p.name)}</button>`).join('')}</div>
      <div class="muted up">Что</div>
      <div class="gift-grid">${GIFTS.map((x) => `<button class="gift-opt ${x.id === gift ? 'on' : ''}" data-gift="${x.id}">${giftIc(x)}<b>${x.name}</b><small>${x.price}${COIN}</small></button>`).join('')}</div>
      ${bal >= g.price ? `<button class="btn gold big" id="giftgo">Подарить за ${g.price}${COIN}</button>` : `<button class="btn gold big" id="giftbuy">Не хватает ${g.price - bal}${COIN} — пополнить</button>`}`;
    $$('[data-to]', m).forEach((b) => b.onclick = () => { to = b.dataset.to; draw(); });
    $$('[data-gift]', m).forEach((b) => b.onclick = () => { gift = b.dataset.gift; SFX.play('tick'); draw(); });
    if ($('#giftgo', m)) $('#giftgo', m).onclick = () => { socket.emit('gift', { to, gift }); m.closeModal(); };
    if ($('#giftbuy', m)) $('#giftbuy', m).onclick = () => { m.closeModal(); renderShop('coins'); };
  };
  draw();
}
function giftFx({ from, to, gift }) {
  const g = GIFTS.find((x) => x.id === gift), a = byId(from), b = byId(to);
  if (!g || !a || !b) return;
  SFX.play('buy');
  const el = (pid) => $(`.tok[data-pid="${pid}"]`) || $(`.pc[data-pid="${pid}"] .pc-pic`) || $(`.pl[data-pid="${pid}"] .pl-pic`);
  const ea = el(from), eb = el(to);
  const fly = document.createElement('div');
  fly.className = 'gift-fly'; fly.innerHTML = giftIc(g, 'gift-fly-ic');
  document.body.appendChild(fly);
  const ra = ea ? ea.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight, width: 0, height: 0 };
  const rb = eb ? eb.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const x0 = ra.left + ra.width / 2, y0 = ra.top + ra.height / 2, x1 = rb.left + rb.width / 2, y1 = rb.top + rb.height / 2;
  const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 120;
  fly.animate([
    { transform: `translate(${x0}px,${y0}px) translate(-50%,-50%) scale(.6) rotate(-20deg)` },
    { transform: `translate(${mx}px,${my}px) translate(-50%,-50%) scale(2.4) rotate(10deg)`, offset: 0.5 },
    { transform: `translate(${x1}px,${y1}px) translate(-50%,-50%) scale(1) rotate(0deg)` },
  ], { duration: 1100, easing: 'cubic-bezier(.3,.7,.4,1)' }).onfinish = () => {
    fly.classList.add('pop');
    setTimeout(() => fly.remove(), 500);
    if (eb) bubble(to, `${g.name} от ${a.name}`);
    SFX.play('cash');
  };
  if (to === myId) flash(`${a.name} дарит тебе: ${g.name}`, 'deal');
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

Promise.race([assetsReady, new Promise((r) => setTimeout(r, 1200))]).then(() => {
  if (!token) render();
  else setTimeout(() => { if (!screen) render(); }, 800);
});
})();
