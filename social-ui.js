// «Кореша» — соцслой: глобальный чат, друзья с онлайн-статусом и приглашениями, клан с общаком, долг, колесо района.
// Использует помощники основной игры через window.BR. Все деньги считает сервер (события soc:*).
window.Social = (() => {
  let B = null, open = false, tab = 'chat', hello = null, chat = [], chatOnline = 0, friends = null, here = null, clan = null, search = null, searchQ = '';
  let muteUntil = 0, wheelQueue = null, bound = false;
  const G = () => window.G;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
  const bucks = (n) => `<span class="so-bucks"><i class="bucks"></i>${fmt(n)}</span>`;
  const call = (ev, d = {}) => new Promise((res) => {
    const t = setTimeout(() => res({ error: 'Нет связи с сервером' }), 8000);
    B.socket.emit(ev, { ...B.ident(), name: B.myName(), char: B.profile().char, ...d }, (r) => { clearTimeout(t); res(r || {}); });
  });
  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!iso || isNaN(m)) return 'не в сети';
    if (m < 2) return 'был только что';
    if (m < 60) return `был ${m} мин назад`;
    if (m < 1440) return `был ${Math.round(m / 60)} ч назад`;
    return `был ${Math.round(m / 1440)} дн назад`;
  };
  const time = (iso) => { const d = new Date(iso); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  const ava = (u) => `<span class="so-av">${B.avatar({ photo: u.photo, char: u.char || 'boec' })}</span>`;

  // Герб клана: своя графика — медальон в цвете клана с иконкой
  function crest(id, size = '') {
    const c = G().CLANS[id];
    return `<span class="so-crest ${size}" style="--cc:${c.color}"><svg viewBox="0 0 64 64" class="so-crest-bg" aria-hidden="true">
      <path d="M32 3 56 12v20c0 15-10.5 25-24 29C18.5 57 8 47 8 32V12z" fill="url(#socg)" stroke="${c.color}" stroke-width="2.4"/>
      <path d="M32 9 51 16v16c0 12-8.4 20-19 23.4C21.4 52 13 44 13 32V16z" fill="none" stroke="rgba(255,231,168,.35)" stroke-width="1"/></svg>
      <span class="so-crest-ic">${B.ic(c.icon)}</span></span>`;
  }
  const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="socg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2433"/><stop offset="1" stop-color="#121018"/></linearGradient></defs></svg>`;

  // ---------- связь ----------
  function bind() {
    if (bound) return; bound = true;
    const s = B.socket;
    s.on('connect', () => sayHello());
    s.on('soc:chat', (m) => {
      chat.push(m); if (chat.length > 120) chat.shift();
      if (open && tab === 'chat') appendMsg(m, true);
    });
    s.on('soc:muted', ({ seconds }) => { muteUntil = Date.now() + seconds * 1000; });
    s.on('soc:presence', ({ key, online }) => {
      if (friends) { const f = friends.find((x) => x.key === key); if (f) { f.online = online; if (!online) f.seen = new Date().toISOString(); } }
      if (hello) hello.onlineFriends = Math.max(0, (hello.onlineFriends || 0) + (online ? 1 : -1));
      if (open && tab === 'friends') drawFriends();
    });
    s.on('soc:request', (u) => {
      if (hello) hello.requests = (hello.requests || 0) + 1;
      B.toast(`${u.name} хочет в кореша`); B.SFX.play('chat');
      badge(); if (open) { loadFriends(); drawTabs(); }
    });
    s.on('soc:friend', (u) => { B.toast(`${u.name} теперь твой кореш`); if (open) loadFriends(); });
    s.on('soc:invite', (inv) => inviteCard(inv));
    s.on('soc:treasury', (t) => {
      if (!clan || !clan.clans[t.clan]) return;
      Object.assign(clan.clans[t.clan], { treasury: t.treasury, members: t.members, boosts: t.boosts, minPct: t.minPct });
      if (open && tab === 'clan') { const el = $('#soTreasury'); if (el) { el.innerHTML = bucks(t.treasury); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } }
    });
    s.on('soc:cut', ({ cut, repaid }) => B.toast(repaid ? `В общак ${fmt(cut)} бабок, из них ${fmt(repaid)} — в счёт долга` : `В общак ушло ${fmt(cut)} бабок`));
    s.on('soc:wager', (w) => {
      if (clan && clan.loan) { clan.loan.current = w.current; if (w.done || w.burned) clan.loan = null; clan.bonus = w.bonus; clan.bank = w.bank; }
      if (w.done) { B.toast(`Отыгрыш выполнен: ${fmt(w.moved)} бабок теперь твои`); B.SFX.play('victory'); }
      else if (w.burned) B.toast('Бонусные бабки кончились. Долг общаку остался');
      if (open && tab === 'clan') drawClan();
    });
    s.on('soc:boost', (b) => { B.toast(`${b.by} включил буст «${b.name}» на сутки`); if (open && tab === 'clan') loadClan(); });
    s.on('soc:wheel', (w) => { remember(w.day); spinWheel(w); });
    s.on('soc:paid', ({ amount }) => setTimeout(() => B.toast(`Колесо района: +${fmt(amount)} бабок`), 4200));
  }
  async function sayHello() {
    if (!B.myName()) return null;
    const r = await call('soc:hello');
    if (r.error) return null;
    hello = r;
    badge();
    // если колесо крутилось, пока игрок не заходил — покажем результат один раз
    if (r.last && r.last.day !== B.LS.get('bratva_wheel_seen', null) && !open) { remember(r.last.day); wheelQueue = r.last; setTimeout(() => { if (wheelQueue) { spinWheel(wheelQueue, true); wheelQueue = null; } }, 1500); }
    return r;
  }
  const remember = (day) => B.LS.set('bratva_wheel_seen', day);
  function init() { B = window.BR; bind(); if (B.socket.connected) sayHello(); }
  // точка на кнопке в меню: заявки в кореша
  function badge() {
    const el = document.getElementById('socB');
    if (!el) return;
    const n = hello ? hello.requests || 0 : 0;
    el.classList.toggle('hot', n > 0);
    let d = el.querySelector('.dot');
    if (n > 0 && !d) { d = document.createElement('i'); d.className = 'dot'; el.appendChild(d); }
    if (!n && d) d.remove();
  }
  const dockInfo = () => (hello && hello.onlineFriends ? `${hello.onlineFriends}` : '');

  // ---------- экран ----------
  async function show(which) {
    B = window.BR;
    if (!B.myName()) return B.needName(() => show(which));
    if (!hello) await sayHello();
    open = true; if (which) tab = which;
    B.setScreen('social');
    const app = document.getElementById('app');
    app.innerHTML = `<section class="screen so">${DEFS}
      <div class="top-head"><button class="icon-btn" id="soBack" aria-label="Назад">${B.ic('back')}</button><h2>Кореша</h2><span></span></div>
      <div class="seg so-tabs" id="soTabs"></div>
      <div class="so-body" id="soBody"></div>
    </section>`;
    $('#soBack').onclick = close;
    drawTabs();
    go(tab);
  }
  function close() {
    open = false;
    B.socket.emit('soc:chat:close', {}, () => {});
    B.home();
  }
  function drawTabs() {
    const t = $('#soTabs'); if (!t) return;
    const req = hello && hello.requests ? `<i class="so-n">${hello.requests}</i>` : '';
    t.innerHTML = [['chat', 'Чат'], ['friends', 'Кореша' + req], ['clan', 'Клан']].map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
    $$('[data-t]', t).forEach((b) => b.onclick = () => { B.SFX.play('click'); go(b.dataset.t); });
  }
  function go(t) {
    tab = t; drawTabs();
    const body = $('#soBody'); if (!body) return;
    body.className = 'so-body so-' + t;
    if (t !== 'chat') B.socket.emit('soc:chat:close', {}, () => {});
    if (t === 'chat') openChat();
    if (t === 'friends') { body.innerHTML = '<div class="wait pulse">Загружаю…</div>'; loadFriends(); }
    if (t === 'clan') { body.innerHTML = '<div class="wait pulse">Загружаю…</div>'; loadClan(); }
  }

  // ---------- чат ----------
  async function openChat() {
    const body = $('#soBody');
    body.innerHTML = `<div class="so-chat-head"><span class="so-live"><i></i>Общий чат</span><small id="soOnl"></small></div>
      <div class="so-msgs" id="soMsgs"><div class="wait pulse">Загружаю…</div></div>
      <form class="so-send" id="soSend" autocomplete="off">
        <input id="soText" maxlength="300" placeholder="Напиши братве…" enterkeyhint="send">
        <button class="btn gold so-go" aria-label="Отправить">${B.ic('send')}</button>
      </form>`;
    const r = await call('soc:chat:open');
    if (!open || tab !== 'chat') return;
    chat = r.history || [];
    chatOnline = r.online || 0;
    $('#soOnl').textContent = chatOnline ? `в сети: ${chatOnline}` : '';
    const box = $('#soMsgs'); box.innerHTML = chat.length ? '' : '<div class="so-empty">Тут пока тихо. Напиши первым.</div>';
    chat.forEach((m) => appendMsg(m, false));
    box.scrollTop = box.scrollHeight;
    $('#soSend').onsubmit = async (e) => {
      e.preventDefault();
      const inp = $('#soText'), text = inp.value.trim();
      if (!text) return;
      if (muteUntil > Date.now()) return B.toast(`Мут: ещё ${Math.ceil((muteUntil - Date.now()) / 1000)} с`);
      inp.value = '';
      const res = await call('soc:chat', { text });
      if (res.error) { B.toast(res.error); if (!res.mute) inp.value = text; return; }
      if (res.filtered) B.toast('Мат заменили звёздочками');
      B.SFX.play('chat');
    };
  }
  function msgHTML(m) {
    const mine = hello && m.key === hello.key;
    return `<div class="so-msg ${mine ? 'me' : ''}" data-key="${B.esc(m.key)}">
      ${mine ? '' : `<button class="so-who" data-key="${B.esc(m.key)}" data-name="${B.esc(m.name)}">${ava(m)}</button>`}
      <div class="so-bub"><div class="so-meta">${mine ? '' : `<b>${B.esc(m.name)}</b>`}<small>${time(m.at)}</small></div><div class="so-txt">${B.esc(m.text)}</div></div>
    </div>`;
  }
  function appendMsg(m, live) {
    const box = $('#soMsgs'); if (!box) return;
    const empty = box.querySelector('.so-empty'); if (empty) empty.remove();
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.insertAdjacentHTML('beforeend', msgHTML(m));
    const el = box.lastElementChild;
    if (live) el.classList.add('in');
    const who = el.querySelector('.so-who'); if (who) who.onclick = () => personSheet({ key: m.key, name: m.name, char: m.char, photo: m.photo });
    while (box.children.length > 120) box.firstElementChild.remove();
    if (!live || nearBottom || (hello && m.key === hello.key)) box.scrollTop = box.scrollHeight;
  }
  function personSheet(u) {
    const f = friends && friends.find((x) => x.key === u.key);
    const m = B.modal(`<div class="so-person">${ava(u)}<div class="ps-title">${B.esc(u.name)}</div>
      ${f && f.rel === 'friend' ? '<div class="hint">Уже твой кореш</div>' : `<button class="btn gold big" id="soAdd">${B.ic('plus')}В кореша</button>`}</div>`);
    const b = m.querySelector('#soAdd');
    if (b) b.onclick = async () => { b.disabled = true; const r = await call('soc:friend:add', { key: u.key }); B.toast(r.error || (r.status === 'accepted' || r.status === 'friends' ? 'Теперь вы кореша' : 'Заявка отправлена')); m.closeModal(); };
  }

  // ---------- кореша ----------
  async function loadFriends() {
    const r = await call('soc:friends');
    if (r.error) { if (open && tab === 'friends') $('#soBody').innerHTML = `<div class="wait">${B.esc(r.error)}</div>`; return; }
    friends = r.list; here = r.here;
    if (hello) { hello.requests = friends.filter((f) => f.rel === 'in').length; hello.onlineFriends = friends.filter((f) => f.rel === 'friend' && f.online).length; badge(); drawTabs(); }
    if (open && tab === 'friends') drawFriends();
  }
  function friendRow(f, kind) {
    const status = f.online ? '<span class="so-on">в сети</span>' : `<span class="so-off">${ago(f.seen)}</span>`;
    let btns = '';
    if (kind === 'in') btns = `<button class="btn small gold" data-acc="${B.esc(f.key)}">Принять</button><button class="icon-btn" data-dec="${B.esc(f.key)}" aria-label="Отклонить">${B.ic('close')}</button>`;
    else if (kind === 'out') btns = '<span class="so-tag">ждём ответ</span>';
    else if (kind === 'friend') btns = `${here && f.online ? `<button class="btn small gold" data-inv="${B.esc(f.key)}">Позвать</button>` : ''}<button class="icon-btn" data-del="${B.esc(f.key)}" aria-label="Убрать">${B.ic('close')}</button>`;
    else btns = f.rel === 'friend' ? '<span class="so-tag">кореш</span>' : f.rel === 'out' ? '<span class="so-tag">заявка ушла</span>' : `<button class="btn small gold" data-add="${B.esc(f.key)}">${f.rel === 'in' ? 'Принять' : 'Добавить'}</button>`;
    return `<div class="so-row ${f.online ? 'online' : ''}">
      <span class="so-av-wrap">${ava(f)}<i class="so-dot"></i></span>
      <span class="so-name"><b>${B.esc(f.name)}</b><small>${status}${f.char && window.ART.CHARS[f.char] ? ' · ' + window.ART.CHARS[f.char].name : ''}</small></span>
      <span class="so-btns">${btns}</span></div>`;
  }
  function drawFriends() {
    const body = $('#soBody'); if (!body || !friends) return;
    const by = (rel) => friends.filter((f) => f.rel === rel);
    const fr = by('friend').sort((a, b) => b.online - a.online || a.name.localeCompare(b.name, 'ru'));
    const focus = document.activeElement && document.activeElement.id === 'soQ';
    body.innerHTML = `
      <div class="so-search"><span class="so-s-ic">${B.ic('search')}</span><input id="soQ" placeholder="Найти по погонялу" maxlength="12" value="${B.esc(searchQ)}" enterkeyhint="search"></div>
      ${search ? `<div class="so-sec"><div class="so-h">Нашлось</div>${search.length ? search.map((u) => friendRow(u, 'search')).join('') : '<div class="so-empty">Никого с таким погонялом</div>'}</div>` : ''}
      ${by('in').length ? `<div class="so-sec"><div class="so-h">Зовут в кореша</div>${by('in').map((f) => friendRow(f, 'in')).join('')}</div>` : ''}
      ${here ? `<div class="so-here">${B.ic(here.kind === 'durak' ? 'cards' : 'house')}<span>Ты ${here.kind === 'durak' ? 'за столом «Дурака»' : 'в лобби сходки'} <b>${B.esc(here.code)}</b> — зови корешей в сети</span></div>` : ''}
      <div class="so-sec"><div class="so-h">Кореша <small>${fr.filter((f) => f.online).length} в сети из ${fr.length}</small></div>
        ${fr.length ? fr.map((f) => friendRow(f, 'friend')).join('') : '<div class="so-empty">Пока никого. Найди братву по погонялу или добавь из чата: нажми на аватарку.</div>'}</div>
      ${by('out').length ? `<div class="so-sec"><div class="so-h">Твои заявки</div>${by('out').map((f) => friendRow(f, 'out')).join('')}</div>` : ''}`;
    const q = $('#soQ', body);
    if (focus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    let t; q.oninput = () => { clearTimeout(t); searchQ = q.value; t = setTimeout(doSearch, 300); };
    $$('[data-add]', body).forEach((b) => b.onclick = async () => { b.disabled = true; const r = await call('soc:friend:add', { key: b.dataset.add }); B.toast(r.error || (r.status === 'sent' ? 'Заявка отправлена' : 'Теперь вы кореша')); if (search) { const u = search.find((x) => x.key === b.dataset.add); if (u && !r.error) u.rel = r.status === 'sent' ? 'out' : 'friend'; } loadFriends(); });
    $$('[data-acc]', body).forEach((b) => b.onclick = async () => { b.disabled = true; await call('soc:friend:answer', { key: b.dataset.acc, accept: true }); B.SFX.play('cash'); loadFriends(); });
    $$('[data-dec]', body).forEach((b) => b.onclick = async () => { await call('soc:friend:answer', { key: b.dataset.dec, accept: false }); loadFriends(); });
    $$('[data-del]', body).forEach((b) => b.onclick = () => {
      const f = friends.find((x) => x.key === b.dataset.del);
      const m = B.modal(`<div class="so-confirm"><div class="ps-title">Убрать ${B.esc(f.name)}?</div><div class="hint">Из корешей уберём у обоих. Позвать снова можно в любой момент.</div><div class="inv-btns"><button class="btn" id="soNo">Оставить</button><button class="btn red" id="soYes">Убрать</button></div></div>`);
      m.querySelector('#soNo').onclick = () => m.closeModal();
      m.querySelector('#soYes').onclick = async () => { m.closeModal(); await call('soc:friend:remove', { key: f.key }); loadFriends(); };
    });
    $$('[data-inv]', body).forEach((b) => b.onclick = async () => { b.disabled = true; const r = await call('soc:invite', { key: b.dataset.inv }); B.toast(r.error || 'Позвал'); setTimeout(() => { b.disabled = false; }, 3000); });
  }
  async function doSearch() {
    const q = searchQ.trim();
    if (q.length < 2) { search = null; return drawFriends(); }
    const r = await call('soc:search', { q });
    if (q !== searchQ.trim()) return;
    search = r.list || [];
    if (open && tab === 'friends') drawFriends();
  }
  // Окно «Позвать корешей» — из лобби «Монополии» и со стола «Дурака». other — запасной способ (ссылка)
  async function invitePicker(other) {
    B = window.BR;
    const m = B.modal(`<div class="so-inv"><div class="ps-title">Позвать корешей</div><div class="so-inv-list"><div class="wait pulse">Загружаю…</div></div>
      ${other ? `<button class="btn big" id="soOther">${B.ic('share')}Позвать ссылкой</button>` : ''}</div>`);
    if (other) m.querySelector('#soOther').onclick = () => { m.closeModal(); other(); };
    if (!hello) await sayHello();
    const r = await call('soc:friends');
    const list = (r.list || []).filter((f) => f.rel === 'friend').sort((a, b) => b.online - a.online);
    const box = m.querySelector('.so-inv-list');
    box.innerHTML = list.length ? list.map((f) => `<div class="so-row ${f.online ? 'online' : ''}"><span class="so-av-wrap">${ava(f)}<i class="so-dot"></i></span>
      <span class="so-name"><b>${B.esc(f.name)}</b><small>${f.online ? '<span class="so-on">в сети</span>' : `<span class="so-off">${ago(f.seen)}</span>`}</small></span>
      <span class="so-btns">${f.online ? `<button class="btn small gold" data-inv="${B.esc(f.key)}">Позвать</button>` : ''}</span></div>`).join('')
      : '<div class="so-empty">Корешей пока нет. Добавь их в разделе «Кореша».</div>';
    $$('[data-inv]', box).forEach((b) => b.onclick = async () => { b.disabled = true; const x = await call('soc:invite', { key: b.dataset.inv }); B.toast(x.error || 'Позвал'); b.textContent = x.error ? 'Позвать' : 'Позвал'; });
  }
  function inviteCard(inv) {
    const where = inv.kind === 'durak' ? 'за стол «Дурака»' : 'на сходку';
    B.SFX.play('chat');
    const m = B.modal(`<div class="so-invite">${ava(inv.from)}<div class="ps-title">${B.esc(inv.from.name)} зовёт ${where}</div>
      <div class="hint">Код ${B.esc(inv.code)}</div><div class="inv-btns"><button class="btn" id="soLater">Потом</button><button class="btn gold" id="soGo">Зайти</button></div></div>`);
    m.querySelector('#soLater').onclick = () => m.closeModal();
    m.querySelector('#soGo').onclick = () => { location.href = `/?${inv.kind === 'durak' ? 'durak' : 'room'}=${encodeURIComponent(inv.code)}`; };
  }

  // ---------- клан ----------
  async function loadClan() {
    const r = await call('soc:clan');
    if (r.error) { if (open && tab === 'clan') $('#soBody').innerHTML = `<div class="wait">${B.esc(r.error)}</div>`; return; }
    clan = r;
    if (open && tab === 'clan') drawClan();
  }
  async function act(ev, d, okMsg) {
    const r = await call(ev, d);
    if (r.error) { B.toast(r.error); B.SFX.play('bad'); return null; }
    clan = r;
    if (okMsg) B.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    if (open && tab === 'clan') drawClan();
    return r;
  }
  const charsRow = (id) => `<span class="so-chars">${G().CLANS[id].chars.map((k) => `<span class="so-ch" title="${window.ART.CHARS[k].name}">${B.avatar({ char: k })}</span>`).join('')}</span>`;
  function drawClan() {
    const body = $('#soBody'); if (!body || !clan) return;
    const { CLANS, CLAN } = G();
    const my = clan.me && clan.me.clan;
    const last = clan.last ? `<div class="so-last">${B.ic('roulette')}<span>Колесо района ${clan.last.day.split('-').reverse().slice(0, 2).join('.')}: <b style="color:${CLANS[clan.last.clan].color}">${CLANS[clan.last.clan].name}</b>${clan.last.members ? `, ${clan.last.members} чел. по ${fmt(clan.last.each)}` : ''}</span></div>` : '';
    if (!my) {
      const wait = clan.canSwitchAt > Date.now() ? `<div class="hint center-t">Вступить снова можно ${new Date(clan.canSwitchAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>` : '';
      body.innerHTML = `<div class="so-pick-t">Выбери клан</div><div class="hint center-t">Общак, бусты на всех и ночное колесо района. Клан можно менять раз в ${CLAN.switchDays} дня.</div>${wait}
        <div class="so-clans">${Object.entries(CLANS).map(([id, c]) => { const i = clan.clans[id]; return `
          <div class="so-clan-card" style="--cc:${c.color}">
            <div class="so-cc-top">${crest(id)}<span class="so-cc-name"><b>${c.name}</b><small>${c.motto}</small></span>${charsRow(id)}</div>
            <div class="so-perk">${B.ic('star')}<span>${c.perk}</span></div>
            <div class="so-cc-stats"><span><small>Общак</small>${bucks(i.treasury)}</span><span><small>В клане</small><b>${fmt(i.members)}</b></span><span><small>Старший</small><b>${i.head ? B.esc(i.head.name) : '—'}</b></span></div>
            <button class="btn gold" data-join="${id}">Вступить</button>
          </div>`; }).join('')}</div>${last}`;
      $$('[data-join]', body).forEach((b) => b.onclick = async () => { b.disabled = true; const r = await act('soc:clan:join', { clan: b.dataset.join }, `Ты в клане «${CLANS[b.dataset.join].name}»`); if (r) B.SFX.play('victory'); else b.disabled = false; });
      return;
    }
    const c = CLANS[my], info = clan.clans[my], me = clan.me, loan = clan.loan;
    const eff = Math.max(me.pct, info.minPct);
    const boosts = Object.entries(CLAN.boosts).map(([id, b]) => {
      const until = info.boosts[id];
      const left = until ? Math.max(0, Math.round((Date.parse(until) - Date.now()) / 3600000)) : 0;
      return `<div class="so-boost ${until ? 'on' : ''}"><span class="so-b-ic">${B.ic(id === 'podogrev' ? 'flame' : id === 'bezkomissii' ? 'shield' : 'roulette')}</span>
        <span class="so-b-t"><b>${b.name}</b><small>${b.text}</small>${until ? `<i class="so-b-on">работает ещё ${left || '<1'} ч</i>` : ''}</span>
        ${clan.head ? `<button class="btn small ${until ? '' : 'gold'}" data-boost="${id}" ${info.treasury < b.price ? 'disabled' : ''}>${until ? 'Продлить' : ''} ${bucks(b.price)}</button>` : `<span class="so-b-p">${bucks(b.price)}</span>`}</div>`;
    }).join('');
    let loanBox;
    const mult = clan.loanMult;
    if (loan) {
      const p = Math.min(100, Math.round((loan.current / loan.target) * 100));
      loanBox = `<div class="so-loan-act">
        <div class="so-kv"><span>Бонусные</span>${bucks(clan.bonus)}</div><div class="so-kv"><span>Долг общаку</span>${bucks(me.debt)}</div>
        <div class="so-prog"><i style="width:${p}%"></i></div>
        <div class="so-prog-t"><span>Отыгрыш ×${Math.round(loan.target / loan.amount)}</span><b>${fmt(loan.current)} / ${fmt(loan.target)}</b></div>
        <div class="hint">Бонусными играешь в Olympus. Оборот считается полностью в играх против системы (слот, «Дурак» только с ботами); с живыми людьми — 10%. Набрал оборот — бонусные становятся обычными бабками.</div>
        <button class="btn" id="soRepay">Вернуть долг</button></div>`;
    } else if (me.debt > 0) {
      loanBox = `<div class="so-kv"><span>Долг общаку</span>${bucks(me.debt)}</div><div class="hint">С каждого выигрыша не меньше ${CLAN.loan.autoRepayPct}% идёт в счёт долга. Можно вернуть сразу.</div><button class="btn gold" id="soRepay">Вернуть долг</button>`;
    } else {
      const ready = clan.loanReadyAt <= Date.now(), games = clan.games >= CLAN.loan.minGames;
      const amounts = [500, 1000, 2500, 5000, 10000, 15000].filter((x) => x <= clan.loanMax);
      const why = !ready ? `Долг дают через ${CLAN.loan.minHours} ч после вступления` : !games ? `Сначала сыграй ${CLAN.loan.minGames} партии в «Монополию» (сыграно ${clan.games})` : !amounts.length ? `В общаке мало: долг даётся от ${fmt(CLAN.loan.min)}, можно до 10% общака` : '';
      loanBox = `<div class="hint">Возьми бабки из общака. Они «бонусные»: станут твоими, когда наберёшь оборот <b>×${mult}</b> в играх против системы. Долг вернёшь общаку.</div>
        ${why ? `<div class="so-why">${why}</div>` : `<div class="so-chips" id="soLoanAmt">${amounts.map((x, i) => `<button class="${i === 0 ? 'on' : ''}" data-v="${x}">${fmt(x)}</button>`).join('')}</div><button class="btn gold big" id="soTake">Взять в долг</button>`}`;
    }
    body.innerHTML = `
      <div class="so-hero" style="--cc:${c.color}">${crest(my, 'big')}
        <div class="so-hero-t"><b>${c.name}</b><small>${c.motto} · ${fmt(info.members)} в клане</small></div>
        <div class="so-tre"><small>Общак</small><span id="soTreasury">${bucks(info.treasury)}</span></div>
        <div class="so-head-row"><span>Старший: <b>${info.head ? B.esc(info.head.name) : '—'}</b>${clan.head ? ' <i class="so-tag gold">это ты</i>' : ''}</span><span class="so-perk-s">${B.ic('star')}${c.perk}</span></div>
      </div>
      ${last}
      <div class="so-card"><div class="so-h">Твой вклад <small>всего ${fmt(me.contributed)}</small></div>
        <div class="so-pct"><span>С выигрышей в общак</span><b id="soPctV">${eff}%</b></div>
        <input type="range" min="0" max="${CLAN.maxPct}" step="1" value="${me.pct}" id="soPct" class="so-range" style="--p:${(me.pct / CLAN.maxPct) * 100}%">
        ${info.minPct ? `<div class="hint">Старший поставил минимум ${info.minPct}% — меньше не отчисляется.</div>` : ''}
        <div class="so-give"><div class="so-chips" id="soGiveAmt">${[100, 500, 1000, 5000].map((x, i) => `<button class="${i === 1 ? 'on' : ''}" data-v="${x}">${fmt(x)}</button>`).join('')}</div>
        <button class="btn gold" id="soGive">Внести</button></div>
        <div class="hint">На руках: ${bucks(clan.bank)}${c === CLANS.delovye ? ' · игра докидывает +10% к взносу' : ''}</div>
      </div>
      <div class="so-card"><div class="so-h">Долг из общака</div>${loanBox}</div>
      <div class="so-card"><div class="so-h">Бусты на всех <small>${clan.head ? 'покупаешь из общака' : 'покупает старший'}</small></div>${boosts}</div>
      ${clan.head ? `<div class="so-card"><div class="so-h">Минимум отчислений <small>для всех в клане</small></div>
        <div class="so-pct"><span>Не меньше</span><b id="soMinV">${info.minPct}%</b></div>
        <input type="range" min="0" max="${CLAN.maxPct}" step="1" value="${info.minPct}" id="soMin" class="so-range" style="--p:${(info.minPct / CLAN.maxPct) * 100}%"></div>` : ''}
      <div class="so-card"><div class="so-h">Главные вкладчики</div>${info.top.length ? info.top.map((t, i) => `<div class="so-top ${t.key === me.key ? 'me' : ''}"><span class="so-place">${i + 1}</span>${ava(t)}<b>${B.esc(t.name)}</b>${bucks(t.contributed)}</div>`).join('') : '<div class="so-empty">Пока никто не вносил</div>'}</div>
      <button class="link so-leave" id="soLeave">Выйти из клана</button>`;
    const chips = (id) => { const box = $(id, body); if (!box) return () => 0; $$('button', box).forEach((b) => b.onclick = () => { $$('button', box).forEach((x) => x.classList.toggle('on', x === b)); B.SFX.play('click'); }); return () => +($('.on', box) || {}).dataset.v; };
    const giveV = chips('#soGiveAmt'), loanV = chips('#soLoanAmt');
    const rng = (el, lab, ev, key) => {
      if (!el) return;
      el.oninput = () => { el.style.setProperty('--p', (el.value / CLAN.maxPct) * 100 + '%'); $(lab, body).textContent = (key === 'pct' ? Math.max(+el.value, info.minPct) : el.value) + '%'; };
      el.onchange = () => act(ev, { pct: +el.value }, key === 'pct' ? `Отчисления: ${Math.max(+el.value, info.minPct)}%` : `Минимум для клана: ${el.value}%`);
    };
    rng($('#soPct', body), '#soPctV', 'soc:clan:pct', 'pct');
    rng($('#soMin', body), '#soMinV', 'soc:clan:min', 'min');
    $('#soGive', body).onclick = async (e) => { e.target.disabled = true; const r = await act('soc:clan:give', { amount: giveV() }, (x) => `Внёс ${fmt(giveV())}. В общаке ${fmt(x.clans[my].treasury)}`); if (r) B.SFX.play('cash'); };
    if ($('#soTake', body)) $('#soTake', body).onclick = (e) => {
      const amt = loanV();
      const m = B.modal(`<div class="so-confirm"><div class="ps-title">Взять ${fmt(amt)}?</div>
        <div class="hint">Получишь ${fmt(amt)} бонусных бабок. Чтобы они стали твоими, набери оборот ${fmt(amt * mult)} в Olympus или в «Дураке» с ботами. Долг ${fmt(amt)} общаку вернёшь сам или с выигрышей (не меньше ${CLAN.loan.autoRepayPct}%). Пока есть долг, из клана не выйти.</div>
        <div class="inv-btns"><button class="btn" id="soNo">Не надо</button><button class="btn gold" id="soYes">Беру</button></div></div>`);
      m.querySelector('#soNo').onclick = () => m.closeModal();
      m.querySelector('#soYes').onclick = async () => { m.closeModal(); const r = await act('soc:loan:take', { amount: amt }, `Бонусные ${fmt(amt)} на счету. Отыграй ×${mult}`); if (r) B.SFX.play('cash'); };
    };
    if ($('#soRepay', body)) $('#soRepay', body).onclick = () => act('soc:loan:repay', { amount: me.debt }, (r) => (r.me.debt ? `Вернул часть. Осталось ${fmt(r.me.debt)}` : 'Долг закрыт. Уважение'));
    $$('[data-boost]', body).forEach((b) => b.onclick = async () => { b.disabled = true; const r = await act('soc:clan:boost', { id: b.dataset.boost }, `Буст «${CLAN.boosts[b.dataset.boost].name}» включён на сутки`); if (r) B.SFX.play('victory'); });
    $('#soLeave', body).onclick = () => {
      const m = B.modal(`<div class="so-confirm"><div class="ps-title">Выйти из «${c.name}»?</div><div class="hint">Твой вклад останется в общаке. Вступить в клан снова можно через ${CLAN.switchDays} дня.</div>
        <div class="inv-btns"><button class="btn" id="soNo">Остаться</button><button class="btn red" id="soYes">Выйти</button></div></div>`);
      m.querySelector('#soNo').onclick = () => m.closeModal();
      m.querySelector('#soYes').onclick = () => { m.closeModal(); act('soc:clan:leave', {}, 'Ты вышел из клана'); };
    };
  }

  // ---------- колесо района ----------
  function wheelSVG() {
    const ids = Object.keys(G().CLANS), n = ids.length, R = 100;
    const P = (a, r) => `${(110 + r * Math.sin(a)).toFixed(2)},${(110 - r * Math.cos(a)).toFixed(2)}`;
    let segs = '', labs = '';
    for (let k = 0; k < n * 2; k++) { // каждый клан дважды — колесо из 6 секторов
      const id = ids[k % n], c = G().CLANS[id], a0 = (k / (n * 2)) * Math.PI * 2, a1 = ((k + 1) / (n * 2)) * Math.PI * 2, am = (a0 + a1) / 2;
      segs += `<path d="M110,110 L${P(a0, R)} A${R},${R} 0 0 1 ${P(a1, R)} Z" fill="${c.color}" opacity="${k % 2 ? .78 : .95}" stroke="#120f18" stroke-width="2"/>`;
      labs += `<g transform="rotate(${(am * 180) / Math.PI} 110 110)"><text x="110" y="${110 - R * 0.62}" text-anchor="middle" class="so-w-lab">${c.name.toUpperCase()}</text></g>`;
    }
    return `<svg viewBox="0 0 220 220" class="so-w-svg"><circle cx="110" cy="110" r="107" fill="#120f18" stroke="#f5c542" stroke-width="3"/>${segs}${labs}
      ${Array.from({ length: 24 }, (_, i) => `<circle cx="${P((i / 24) * Math.PI * 2, 104).split(',')[0]}" cy="${P((i / 24) * Math.PI * 2, 104).split(',')[1]}" r="2" fill="#ffe7a8"/>`).join('')}
      <circle cx="110" cy="110" r="22" fill="#1a1622" stroke="#f5c542" stroke-width="3"/><circle cx="110" cy="110" r="8" fill="#f5c542"/></svg>`;
  }
  function spinWheel(w, replay) {
    B = window.BR;
    const ids = Object.keys(G().CLANS), n = ids.length, c = G().CLANS[w.clan];
    if (!c) return;
    const mine = clan && clan.me && clan.me.clan === w.clan || (hello && hello.clan === w.clan);
    const m = B.modal(`<div class="so-wheel"><div class="up muted">${replay ? 'Пока тебя не было' : 'Полночь'}</div><div class="ps-title">Колесо района</div>
      <div class="so-w-wrap"><i class="so-w-ptr"></i><div class="so-w-rot" id="soWRot">${wheelSVG()}</div></div>
      <div class="so-w-res" id="soWRes"><div class="so-w-clan" style="color:${c.color}">${crest(w.clan)}<b>${c.name}</b></div>
      <div class="hint center-t">${w.members ? `${fmt(w.members)} активных получили по ${bucks(w.each)}${w.double ? ' — с бустом «Ставка на район» вдвое' : ''}` : 'В клане никто не заходил на неделе — выплаты нет'}</div>
      ${mine && w.members ? '<div class="so-w-mine">Твой клан. Бабки уже на счету</div>' : ''}</div></div>`);
    const rot = m.querySelector('#soWRot'), res = m.querySelector('#soWRes');
    // сектор k клана: k = idx и idx + n; целимся в середину случайного из двух
    const k = ids.indexOf(w.clan) + n * Math.floor(Math.random() * 2);
    const seg = 360 / (n * 2), target = 360 * 6 - (k * seg + seg / 2) + (Math.random() - 0.5) * seg * 0.6;
    B.SFX.play('dice');
    requestAnimationFrame(() => { rot.style.transform = `rotate(${target}deg)`; });
    let ticks = 0; const tk = setInterval(() => { if (++ticks > 14) return clearInterval(tk); B.SFX.play('tick'); }, 230);
    setTimeout(() => { res.classList.add('show'); B.SFX.play(mine ? 'victory' : 'cash'); if (mine && B.coinBurst) B.coinBurst(res, 30); }, 3900);
  }

  return { init, show, invitePicker, spinWheel, badge, dockInfo, isOpen: () => open, _state: () => ({ hello, clan, friends }) };
})();
