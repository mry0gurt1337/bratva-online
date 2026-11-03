// «Дурак» — клиент. Использует помощники основной игры через window.BR.
window.DurakUI = (() => {
  let B = null, st = null, me = null, lobby = null, bank = null, tier = 'dvor', sel = null, open = false, seenLog = 0, chatSeen = 0, timerRaf = 0;
  const SUIT = { s: 'ss', h: 'sh', d: 'sd', c: 'sc' }, RED = { h: 1, d: 1 };
  const RN = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
  const SYMS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <symbol id="sh" viewBox="0 0 24 24"><path fill="currentColor" d="M12 21.5S3 15.6 3 9.6A4.8 4.8 0 0 1 12 6.8a4.8 4.8 0 0 1 9 2.8c0 6-9 11.9-9 11.9z"/></symbol>
    <symbol id="sd" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.5 20.5 12 12 22.5 3.5 12z"/></symbol>
    <symbol id="ss" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.5S3 8 3 13.2a4.3 4.3 0 0 0 7.6 2.8L9.4 21h5.2l-1.2-5A4.3 4.3 0 0 0 21 13.2C21 8 12 1.5 12 1.5z"/></symbol>
    <symbol id="sc" viewBox="0 0 24 24"><g fill="currentColor"><circle cx="12" cy="6.6" r="4.4"/><circle cx="6.4" cy="13.4" r="4.4"/><circle cx="17.6" cy="13.4" r="4.4"/><path d="M10.8 12h2.4l1.4 9.5H9.4z"/></g></symbol></defs></svg>`;
  const su = (s) => `<svg class="su"><use href="#${SUIT[s]}"/></svg>`;
  const parse = (id) => { const m = /^(\d{1,2})([shdc])$/.exec(id); return { r: +m[1], s: m[2] }; };
  function card(id, cls = '') {
    const c = parse(id), face = c.r >= 11, lab = RN[c.r] || c.r;
    return `<div class="dc ${RED[c.s] ? 'r' : ''} ${face ? 'face' : ''} ${cls}" data-card="${id}"><span class="ix">${lab}${su(c.s)}</span><span class="pip">${face ? lab : su(c.s)}</span><span class="ix b">${lab}${su(c.s)}</span></div>`;
  }
  const back = (k, cls = '') => `<i class="dback ${k ? k.replace('back-', 'b-') : 'b-classic'} ${cls}"></i>`;
  const beats = (a, d, tr) => (d.s === a.s && d.r > a.r) || (d.s === tr && a.s !== tr);
  const T = () => window.G.DURAK;
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));
  const bucksIc = '<i class="bucks"></i>';

  // ---------- вход ----------
  function show() {
    B = window.BR; open = true;
    B.setScreen('durak');
    if (!B.socket.dkBound) bindSocket();
    const tok = B.LS.get('bratva_dk_token', null);
    if (tok && !me) B.socket.emit('dk:resume', { token: tok });
    B.socket.emit('dk:lobby', B.ident());
    render();
  }
  function bindSocket() {
    const s = B.socket; s.dkBound = true;
    s.on('dk:lobby', (d) => { lobby = d.tables; if (d.bank != null) bank = d.bank; if (open && !st) render(); });
    s.on('dk:refill', (d) => { bank = d.bank; B.toast(`Подъёмные: на столе снова ${fmt(d.bank)} бабок`); });
    s.on('dk:you', (y) => { me = y; if (y && y.token) B.LS.set('bratva_dk_token', y.token); if (!y) { B.LS.set('bratva_dk_token', null); st = null; if (open) { B.socket.emit('dk:lobby', B.ident()); render(); } } });
    s.on('dk:state', (d) => {
      const fresh = !st || st.code !== d.code;
      st = d;
      if (!open) return;
      const mp = mine(); if (mp && mp.bank != null) bank = mp.bank;
      if (fresh) seenLog = d.logs.length ? d.logs[d.logs.length - 1].id - 1 : 0;
      sounds();
      render();
    });
    s.on('dk:err', (m) => B.toast(m));
    s.on('dk:tip', (d) => { B.toast(`Чаевые дилеру: +${fmt(d.amount)} бабок`); B.SFX.play('cash'); });
    s.on('connect', () => { const tok = B.LS.get('bratva_dk_token', null); if (tok && open) s.emit('dk:resume', { token: tok }); });
  }
  const mine = () => st && me && me.id && st.players.find((p) => p.id === me.id);
  function sounds() {
    for (const l of st.logs) {
      if (l.id <= seenLog) continue; seenLog = l.id;
      const k = l.kind;
      if (k === 'throw' || k === 'transfer') B.SFX.play('card');
      else if (k === 'take') B.SFX.play('bad');
      else if (k === 'bito') B.SFX.play('tick');
      else if (k === 'cheat') { B.SFX.play('siren'); B.flash(l.text.split(' — ')[0], 'dead'); }
      else if (k === 'durak') { B.SFX.play(st.results && st.results.find((x) => x.id === (me && me.id) && x.durak) ? 'lose' : 'victory'); }
      else if (k === 'out') B.SFX.play('cash');
    }
    for (const c of st.chat) if (c.at > chatSeen) { chatSeen = c.at; bubble(c.id, c.text); }
  }
  function bubble(id, text) {
    setTimeout(() => {
      const el = document.querySelector(`.dk-opp[data-id="${id}"], .dk-me[data-id="${id}"]`);
      if (!el) return;
      const b = document.createElement('div'); b.className = 'dk-bub'; b.textContent = text; el.appendChild(b);
      setTimeout(() => b.remove(), 3500);
    }, 50);
  }
  function leave() { B.socket.emit('dk:leave'); st = null; me = null; B.LS.set('bratva_dk_token', null); B.socket.emit('dk:lobby', B.ident()); render(); }
  function exit() { if (st && me && st.status === 'PLAYING' && !confirm('Уйти посреди партии? Ставка сгорит, за тебя доиграет бот.')) return; if (st) B.socket.emit('dk:leave'); st = null; me = null; open = false; B.LS.set('bratva_dk_token', null); B.home(); }

  function render() {
    if (!open) return;
    const app = document.getElementById('app');
    if (!st) return lobbyView(app);
    tableView(app);
  }

  // ---------- лобби ----------
  function lobbyView(app) {
    const tiers = T().tiers;
    const list = (lobby || []).filter((t) => t.tier === tier);
    app.innerHTML = `${SYMS}<section class="screen dk-lobby">
      <div class="top-head"><button class="icon-btn" id="dkBack" aria-label="Назад">${B.ic('back')}</button><h2>Дурак</h2><span class="dk-bank">${bucksIc}${fmt(bank)}</span></div>
      <div class="dk-tiers">${Object.entries(tiers).map(([k, v]) => `<button class="dk-tier felt-${v.felt} ${k === tier ? 'on' : ''}" data-tier="${k}"><i></i><b>${v.name}</b><small>${bucksIc}${v.stakes.map(fmt).join(' / ')}</small></button>`).join('')}</div>
      <div class="dk-list">${list.length ? list.map((t) => `<div class="dk-tbl">
          <div class="dk-stake s-${t.tier}">${t.stake >= 1000 ? t.stake / 1000 + 'K' : t.stake}</div>
          <div class="dk-ti"><b>${t.mode === 'per' ? 'Переводной' : 'Подкидной'} · ${t.deckN}${t.cheat ? ' · шулерство' : ''}</b><small>${t.players.length} из ${t.max}${t.dealer ? ' · дилер ' + B.esc(t.dealer) : ''}</small>
            <div class="dk-seats">${t.players.map((p) => `<i>${B.avatar(p)}</i>`).join('')}${'<i></i>'.repeat(Math.max(0, t.max - t.players.length))}</div></div>
          <div class="dk-tb-btns"><button class="btn small gold" data-join="${t.code}">Сесть</button>${t.dealer ? '' : `<button class="btn small" data-deal="${t.code}" data-stake="${t.stake}">Дилер</button>`}</div></div>`).join('')
        : `<div class="dk-empty">${B.ic('cards')}<b>Свободных столов нет</b><small>Накрой свой — боты сядут, если друзей нет.</small></div>`}</div>
      <div class="dk-note">Ставки — в зелёных «бабках». Их нельзя купить: выигрываешь у людей за столом. Проигрался — раз в день подъёмные до ${fmt(T().refillTo)}. Монеты за места платит игра.</div>
      <div class="dk-cta"><button class="btn" id="dkCode">${B.ic('link')}По коду</button><button class="btn-play small-play" id="dkNew"><span>Накрыть стол</span><i class="shine"></i></button></div>
    </section>`;
    $('#dkBack').onclick = exit;
    $$('[data-tier]').forEach((b) => b.onclick = () => { tier = b.dataset.tier; B.SFX.play('click'); render(); });
    $$('[data-join]').forEach((b) => b.onclick = () => B.socket.emit('dk:join', { ...B.ident(), code: b.dataset.join, name: B.myName(), char: B.profile().char }));
    $$('[data-deal]').forEach((b) => b.onclick = () => {
      const fee = +b.dataset.stake * T().dealerFee;
      if (confirm(`Сесть дилером за ${fmt(fee)} бабок? Ты держишь стол, а за каждую партию игра платит тебе ${Math.round(T().tiers[tier].tip * 100)}% ставки чаевыми.`)) B.socket.emit('dk:dealer', { ...B.ident(), code: b.dataset.deal, name: B.myName(), char: B.profile().char });
    });
    $('#dkNew').onclick = createSheet;
    $('#dkCode').onclick = () => { const c = prompt('Код стола (4 цифры)'); if (c) B.socket.emit('dk:join', { ...B.ident(), code: c, name: B.myName(), char: B.profile().char }); };
  }
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];

  function createSheet() {
    const t = T().tiers[tier];
    const o = { stake: t.stakes[0], mode: 'pod', deck: 36, max: 4, cheat: false, priv: false };
    const m = B.modal(`<div class="dk-create"><h2>Новый стол</h2><p class="hint">${t.name}${t.minBank ? ` · вход от ${fmt(t.minBank)} бабок` : ''}</p><div id="dkOpts"></div>
      <button class="btn gold big" id="dkGo">Накрыть</button></div>`);
    const seg = (key, vals, lab) => `<div class="dk-opt"><span>${lab}</span><div class="seg">${vals.map(([v, l]) => `<button data-k="${key}" data-v="${v}" class="${String(o[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    const draw = () => {
      $('#dkOpts', m).innerHTML = seg('stake', t.stakes.map((x) => [x, fmt(x)]), 'Ставка') + seg('mode', [['pod', 'Подкидной'], ['per', 'Переводной']], 'Игра')
        + seg('deck', [[36, '36 карт'], [24, '24 карты']], 'Колода') + seg('max', [[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], 'Игроков')
        + seg('cheat', [[false, 'Честно'], [true, 'С шулерством']], 'Правила') + seg('priv', [[false, 'Открытый'], [true, 'Только по коду']], 'Стол');
      $$('[data-k]', m).forEach((b) => b.onclick = () => { const v = b.dataset.v; o[b.dataset.k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; draw(); });
    };
    draw();
    $('#dkGo', m).onclick = () => { m.closeModal(); B.socket.emit('dk:create', { ...B.ident(), ...o, tier, name: B.myName(), char: B.profile().char }); };
  }

  // ---------- стол ----------
  function feltOf() {
    if (st.dealer && st.dealer.felt) return st.dealer.felt.replace('felt-', '');
    const w = B.wallet(); const f = w && w.equip && w.equip.felt;
    return f ? f.replace('felt-', '') : T().tiers[st.tier].felt;
  }
  function tableView(app) {
    const mp = mine(), trump = st.trump ? parse(st.trump).s : null;
    const myIdx = st.players.findIndex((p) => mp && p.id === mp.id);
    const others = myIdx >= 0 ? [...st.players.slice(myIdx + 1), ...st.players.slice(0, myIdx)] : st.players;
    const playing = st.status === 'PLAYING';
    const isDef = mp && st.defender === mp.id, isAtt = mp && st.attacker === mp.id;
    const hand = st.hand || [];
    // что можно сыграть
    const ranks = new Set(st.table.flatMap((t) => (t.d ? [parse(t.a).r, parse(t.d).r] : [parse(t.a).r])));
    const unb = st.table.filter((t) => !t.d).length;
    const defP = st.players.find((p) => p.id === st.defender);
    const canThrow = (id) => playing && mp && !mp.out && !isDef && st.table.length < st.limit && (st.phase === 'take' || unb + 1 <= (defP ? defP.n : 0))
      && (st.table.length ? ranks.has(parse(id).r) : isAtt);
    const firstUnb = st.table.findIndex((t) => !t.d);
    const canBeat = (id) => playing && isDef && st.phase !== 'take' && firstUnb >= 0 && (st.cheat || st.table.some((t) => !t.d && beats(parse(t.a), parse(id), trump)));
    const canTransfer = (id) => playing && isDef && st.mode === 'per' && st.phase !== 'take' && st.table.length && !st.table.some((t) => t.d) && st.table.every((t) => parse(t.a).r === parse(id).r);
    const playable = (id) => canThrow(id) || canBeat(id) || canTransfer(id);
    if (sel && !hand.includes(sel)) sel = null;
    const N = others.length;
    const pos = (i) => { // соперники дугой сверху
      const a = N === 1 ? 0 : -60 + (120 * i) / (N - 1);
      const x = 50 + Math.sin((a * Math.PI) / 180) * 40, y = 4 + (1 - Math.cos((a * Math.PI) / 180)) * 70;
      return `left:${x}%;top:${y}px`;
    };
    const status = !playing ? (st.status === 'OVER' ? 'Партия окончена' : 'Ждём игроков') : isDef ? (st.phase === 'take' ? 'Ты берёшь — сейчас подкинут' : unb ? 'Отбивайся или бери' : 'Отбился — ждём') : isAtt && !st.table.length ? 'Твой ход — ходи любой картой' : mp && !mp.out && st.table.length ? (st.phase === 'take' ? 'Защитник берёт — подкидывай' : 'Можно подкинуть') : `Ходит ${B.esc((st.players.find((p) => p.id === st.attacker) || {}).name || '')}`;
    app.innerHTML = `${SYMS}<section class="screen dk-game felt-${feltOf()}">
      <header class="dk-hdr"><button class="icon-btn" id="dkOut" aria-label="Выйти">${B.ic('back')}</button>
        <span class="pill">${st.mode === 'per' ? 'Переводной' : 'Подкидной'} · ${st.deckN}${trump ? ` · козырь ${su(trump)}` : ''}${st.cheat ? ' · шулерство' : ''}</span>
        <span class="pill dk-pill-b">${bucksIc}${fmt(st.stake)}</span></header>
      <div class="dk-arena">
        <div class="dk-felt"><i class="dk-wm">${B.esc(T().tiers[st.tier].name)}</i></div>
        ${st.dealer ? `<div class="dk-dealer"><span class="dk-av" style="--c:#f5c542">${B.avatar(st.dealer)}</span><em>ДИЛЕР</em><b>${B.esc(st.dealer.name)}</b></div>` : ''}
        ${others.map((p, i) => `<div class="dk-opp ${p.id === st.attacker && playing ? 'att' : ''} ${p.id === st.defender && playing ? 'def' : ''} ${p.out ? 'out' : ''}" data-id="${p.id}" style="${pos(i)};--c:${p.color}">
          <span class="dk-av${p.frame ? ' ' + p.frame : ''}">${B.avatar(p)}${p.id === (st.defender) && playing ? `<i class="dk-ring" id="dkRing"></i>` : ''}</span>
          <b>${B.esc(p.name)}</b>
          <div class="dk-fan">${Array.from({ length: Math.min(p.n, 8) }, () => back(p.back)).join('')}</div>
          <small>${p.out ? (p.place ? p.place + ' место' : 'вышел') : p.id === st.defender && playing ? 'отбивается' : p.id === st.attacker && playing ? 'ходит' : p.n + ' карт'}${st.passed.includes(p.id) ? ' · бито' : ''}</small></div>`).join('')}
        <div class="dk-deck">${st.deck ? `${st.trump ? card(st.trump, 'trump') : ''}${back(null, 'top')}<span>колода · ${st.deck}</span>` : st.trump ? `<span class="dk-trump-only">козырь ${su(trump)}</span>` : ''}</div>
        <div class="dk-bito">${st.discard ? `${back(null)}${back(null, 'b2')}<span>бито · ${st.discard}</span>` : ''}</div>
        <div class="dk-battle n${st.table.length}">${st.table.map((t, k) => `<div class="dk-pair ${!t.d && isDef && sel && canBeat(sel) ? 'tgt' : ''}" data-slot="${k}">${card(t.a)}${t.d ? card(t.d, 'cov') : ''}</div>`).join('')}</div>
        <div class="dk-status">${status}</div>
        ${playing ? `<div class="dk-timer"><i id="dkBar"></i></div>` : ''}
      </div>
      ${playing ? '' : lobbyPanel()}
      <div class="dk-me" data-id="${mp ? mp.id : ''}">
        ${mp ? `<span class="dk-av${mp.frame ? ' ' + mp.frame : ''}" style="--c:${mp.color}">${B.avatar(mp)}</span><span class="dk-me-t"><b>${B.esc(mp.name)}</b><small>${bucksIc}${fmt(bank)}</small></span>` : `<span class="dk-me-t"><b>Ты дилер</b><small>${bucksIc}${fmt(st.dealer && st.dealer.bank)}</small></span>`}
        <div class="dk-quick">${['Ну ты жук', 'Бито', 'Беру', 'Шулер!'].map((q) => `<button data-q="${q}">${q}</button>`).join('')}</div>
      </div>
      <div class="dk-hand n${hand.length}">${hand.map((id, i) => {
        const n = hand.length, mid = (n - 1) / 2, span = Math.min(640, innerWidth) - 96, rot = (i - mid) * Math.min(6, 40 / n), x = (i - mid) * Math.min(46, span / Math.max(1, n - 1));
        return `<div class="dk-hc ${sel === id ? 'sel' : ''} ${playing && !playable(id) ? 'dim' : ''}" data-id="${id}" style="--x:${x}px;--r:${rot}deg;z-index:${i + 1}">${card(id)}</div>`;
      }).join('')}</div>
      <div class="dk-acts">${actions(mp, isDef, unb)}</div>
    </section>`;
    $('#dkOut').onclick = () => (st.status === 'PLAYING' ? exit() : leave());
    $$('.dk-hc').forEach((el) => el.onclick = () => tapCard(el.dataset.id, { canThrow, canBeat, canTransfer, firstUnb, trump }));
    $$('.dk-pair').forEach((el) => el.onclick = () => { if (sel && isDef && canBeat(sel)) { const k = +el.dataset.slot; if (!st.table[k].d) beat(k, sel, trump); } });
    $$('[data-act]').forEach((b) => b.onclick = () => { const a = b.dataset.act; if (a === 'transfer') send({ type: 'transfer', card: sel }); else send({ type: a }); });
    $$('[data-q]').forEach((b) => b.onclick = () => { B.socket.emit('dk:chat', { text: b.dataset.q }); B.SFX.play('chat'); });
    bindLobbyPanel();
    tick();
  }
  function tapCard(id, h) {
    if (h.canThrow(id)) { sel = null; return send({ type: 'throw', card: id }); }
    if (h.canBeat(id) && !h.canTransfer(id)) {
      const unbeaten = st.table.map((t, k) => (!t.d ? k : -1)).filter((k) => k >= 0);
      const legal = unbeaten.filter((k) => beats(parse(st.table[k].a), parse(id), h.trump));
      if (unbeaten.length === 1) return beat(unbeaten[0], id, h.trump);
      if (legal.length === 1) return beat(legal[0], id, h.trump);
    }
    // иначе выбираем карту: дальше тап по нужной карте на столе (или «Перевести»)
    sel = sel === id ? null : id; B.SFX.play('tick'); render();
    if (sel && h.canBeat(sel)) B.toast(h.canTransfer(sel) ? 'Тапни карту на столе, чтобы отбить, или «Перевести»' : 'Тапни карту на столе, которую бьёшь');
  }
  function beat(k, id, trump) {
    const legal = beats(parse(st.table[k].a), parse(id), trump);
    if (!legal && !st.cheat) return B.toast('Этой картой не побить');
    sel = null; send({ type: 'beat', slot: k, card: id });
    if (!legal) B.toast('Шулеришь… главное, чтобы не поймали');
  }
  function send(a) { B.socket.emit('dk:act', a); B.SFX.play('click'); }
  function actions(mp, isDef, unb) {
    if (!mp || st.status !== 'PLAYING' || mp.out) return '';
    const b = [];
    if (isDef && st.phase !== 'take' && unb) b.push(`<button class="btn" data-act="take">Беру</button>`);
    if (isDef && sel && st.mode === 'per' && st.table.length && !st.table.some((t) => t.d) && st.table.every((t) => parse(t.a).r === parse(sel).r)) b.push(`<button class="btn gold" data-act="transfer">Перевести</button>`);
    if (!isDef && st.table.length && !st.passed.includes(mp.id)) b.push(`<button class="btn gold" data-act="pass">${st.phase === 'take' ? 'Хватит' : 'Бито'}</button>`);
    if (!isDef && st.cheat && st.table.some((t) => t.d) && !(st.falseCatch || []).includes(mp.id)) b.push(`<button class="btn red" data-act="catch">Поймал!</button>`);
    return b.join('');
  }
  function lobbyPanel() {
    const host = me && st.hostId === me.id;
    const res = st.results ? `<div class="dk-res">${st.results.map((r) => `<div class="${r.durak ? 'durak' : ''}"><b>${r.durak ? 'ДУРАК' : r.place ? r.place + ' место' : ''}</b><span>${B.esc(r.name)}</span><em class="${r.delta >= 0 ? 'pos' : 'neg'}">${r.delta >= 0 ? '+' : '−'}${fmt(Math.abs(r.delta))}</em></div>`).join('')}</div>` : '';
    return `<div class="dk-panel">${res}
      <div class="dk-code">Стол <b>${st.code}</b> · ${st.players.length} из ${st.max}${st.priv ? ' · по коду' : ''}</div>
      <div class="dk-pbtns">${host && st.players.length < st.max ? `<button class="btn" id="dkBot">${B.ic('plus')}Бот</button>` : ''}<button class="btn" id="dkInv">${B.ic('telegram')}Позвать</button>
        ${host ? `<button class="btn gold" id="dkStart" ${st.players.length < 2 ? 'disabled' : ''}>${st.status === 'OVER' ? 'Ещё раз' : 'Раздать'} · ${bucksIc}${fmt(st.stake)}</button>` : '<span class="hint">Ждём, когда хозяин стола раздаст</span>'}</div></div>`;
  }
  function bindLobbyPanel() {
    if ($('#dkBot')) $('#dkBot').onclick = () => B.socket.emit('dk:bot');
    if ($('#dkStart')) $('#dkStart').onclick = () => B.socket.emit('dk:start');
    if ($('#dkInv')) $('#dkInv').onclick = () => {
      const url = `${location.origin}/?durak=${st.code}`;
      const text = `Садись за стол в «Дурака» в Братве — код ${st.code}`;
      if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openTelegramLink) Telegram.WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
      else if (navigator.share) navigator.share({ title: 'Дурак', text, url }).catch(() => {});
      else B.copyText(url);
    };
  }
  function tick() {
    cancelAnimationFrame(timerRaf);
    if (!st || st.status !== 'PLAYING' || st.remaining == null) return;
    const total = st.phase === 'take' ? 7000 : 25000, end = Date.now() + st.remaining;
    const step = () => {
      const left = Math.max(0, end - Date.now()), k = Math.min(1, left / total);
      const bar = document.getElementById('dkBar'); if (bar) bar.style.width = (k * 100) + '%';
      const ring = document.getElementById('dkRing'); if (ring) ring.style.setProperty('--k', k);
      if (left > 0 && open && st) timerRaf = requestAnimationFrame(step);
    };
    step();
  }
  return { show, card, back, parse, get open() { return open; }, close() { open = false; } };
})();
