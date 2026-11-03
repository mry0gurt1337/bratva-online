// Иконки игры — один стиль: 24×24, линия 1.8, скругления, цвет берётся из текста (currentColor).
// Никаких эмодзи: всё рисуется векторно и одинаково выглядит на iPhone, Android и ПК.
(function (root) {
  const S = (d, extra = '') => `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
  const F = 'fill="currentColor" stroke="none"';
  const P = {
    // ---- интерфейс ----
    gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8.5V20"/><path d="M12 8.5C10 5 7 4.5 6.5 6.5S9 8.5 12 8.5c3 0 5.5-.5 5.5-2S14 5 12 8.5z"/>',
    deal: '<path d="M2.5 10.5 6 7l4 1.5 2-1.5 3.5 0L21.5 11"/><path d="M6 7l-3.5 7 2 2M21.5 11l-3.5 5.5"/><path d="M8 15.5l2 2M10 13.5l3 3M12.5 12l3 3M14.5 11l2.5 2.5"/><path d="M10 8.5 8.2 11a1.2 1.2 0 0 0 1.9 1.4L12 10l4.5 4.5"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    cart: '<path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H6.4"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    send: '<path d="M4 12 20 4l-4 16-4-7z"/><path d="m12 13 8-9"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/>',
    crown: '<path d="M3.5 8 7 16.5h10L20.5 8l-5 3.5L12 5l-3.5 6.5z"/><path d="M7 19.5h10"/>',
    fist: '<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10M10 9V6.5a1.5 1.5 0 0 1 3 0V10M13 9.5V7a1.5 1.5 0 0 1 3 0v4"/><path d="M16 10a1.5 1.5 0 0 1 3 0v3.5c0 4-2.5 6.5-6.5 6.5H11c-3 0-5-2-5-5v-2.5a1.5 1.5 0 0 1 3 0"/>',
    house: '<path d="M4 11 12 4.5l8 6.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5V14h4v5.5"/>',
    flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3 2-5 3.5-6.5.3 2 1.3 3 2.5 3.5C11 9 12 5.5 15 3c-.5 3 1 5 2.5 7 1 1.3 1.5 3 1.5 4.5 0 3.7-2.8 6.5-7 6.5z"/>',
    trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4"/><path d="M12 13.5V17M8.5 20.5h7M9.5 17h5"/>',
    book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2.5 4 2.5 4h-11"/>',
    masks: '<path d="M3.5 4.5h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M6 8h1M10 8h-1M6.5 11c1 .8 2 .8 3 0"/><path d="M12.5 9.5h8v5a4.5 4.5 0 0 1-8.6 1.8"/><path d="M15 13h1M18.5 13h-1M15.5 17c1-.8 2-.8 3 0"/>',
    frame: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="10.5" r="2.5"/><path d="M7.5 17.5c1-2.3 2.6-3.5 4.5-3.5s3.5 1.2 4.5 3.5"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.2" ' + F + '/><circle cx="15.5" cy="8.5" r="1.2" ' + F + '/><circle cx="12" cy="12" r="1.2" ' + F + '/><circle cx="8.5" cy="15.5" r="1.2" ' + F + '/><circle cx="15.5" cy="15.5" r="1.2" ' + F + '/>',
    tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.5"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5h6v2M3.5 12.5h17M11 12.5v2h2v-2"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="M12 13v4M10 15h4"/>',
    offline: '<path d="M3 3l18 18"/><path d="M5 9.5a11 11 0 0 1 4-2.2M12.5 7a11 11 0 0 1 6.5 2.5M8 13a6.5 6.5 0 0 1 3-1.4M15 12.3a6.5 6.5 0 0 1 1 .7"/><circle cx="12" cy="17.5" r="1" ' + F + '/>',
    chat: '<path d="M4.5 5.5h15v10h-9l-4.5 4v-4h-1.5z"/>',
    users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M15.5 5.3a3.3 3.3 0 0 1 0 6.4M17.5 14.3c2.2.6 3.6 2.4 4 5.2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>',
    share: '<circle cx="6" cy="12" r="2.3"/><circle cx="17.5" cy="6" r="2.3"/><circle cx="17.5" cy="18" r="2.3"/><path d="m8 11 7.5-4M8 13l7.5 4"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-3a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 5.5V14A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    telegram: '<path d="M21 4.5 3 11.5l5.5 2 2 6 3-4 4.5 3.5z"/><path d="m8.5 13.5 8.5-6-6.5 8"/>',
    // ---- игровые ----
    coin: '<circle cx="12" cy="12" r="8.5" fill="url(#gcoin)" stroke="#8a5a08"/><circle cx="12" cy="12" r="5.8" stroke="#8a5a08" stroke-width="1.2" fill="none"/><path d="M12 8.6v6.8M10.2 10.2c0-1 .8-1.4 1.8-1.4s1.8.5 1.8 1.3-.8 1.2-1.8 1.4-1.8.6-1.8 1.4.8 1.4 1.8 1.4 1.8-.4 1.8-1.4" stroke="#6b4206" stroke-width="1.3"/>',
    tgstar: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" fill="url(#gstar)" stroke="#b86a00" stroke-width="1.2"/>',
    siren: '<path d="M7 17v-4.5a5 5 0 0 1 10 0V17"/><path d="M5 17h14v3H5zM12 4V2.5M5.5 6.5 4.5 5.5M18.5 6.5l1-1M3.5 11.5H2M22 11.5h-1.5"/>',
    skull: '<path d="M12 3.5c-4.5 0-7.5 3-7.5 7 0 2.5 1.2 4 2.5 5v3.5h10V15.5c1.3-1 2.5-2.5 2.5-5 0-4-3-7-7.5-7z"/><circle cx="9" cy="11" r="1.6" ' + F + '/><circle cx="15" cy="11" r="1.6" ' + F + '/><path d="M10.5 19v-2M13.5 19v-2"/>',
    cards: '<rect x="3.5" y="6" width="10" height="14" rx="1.5" transform="rotate(-10 8.5 13)"/><rect x="10" y="4.5" width="10" height="14" rx="1.5" transform="rotate(8 15 11.5)"/><path d="m15.2 9.3 1.4 2.3-1.9 1.8-1.4-2.3z" ' + F + '/>',
    roulette: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    slots: '<rect x="3.5" y="5" width="14" height="15" rx="2.5"/><path d="M6 9h9v6H6zM9 9v6M12 9v6"/><path d="M17.5 9h1.5a1 1 0 0 1 1 1v3M20 6.5v2"/><circle cx="20" cy="5.5" r="1.2"/>',
    sword: '<path d="M14.5 4.5H19.5V9.5L10 19l-5-5z"/><path d="m7 16-3 3M5.5 12.5l6 6"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    chain: '<rect x="2.5" y="9" width="8" height="6" rx="3"/><rect x="13.5" y="9" width="8" height="6" rx="3"/><path d="M8.5 12h7"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    // ---- клетки поля (запасные, пока нет картинок) ----
    'c-obshak': '<path d="M8.5 6.5 7 3.5h10l-1.5 3"/><path d="M8.5 6.5h7c3 2.5 5 5.5 5 8.5 0 3.5-3 5.5-8.5 5.5S3.5 18.5 3.5 15c0-3 2-6 5-8.5z"/><path d="M12 10v7M10 11.5c0-1 .9-1.5 2-1.5s2 .6 2 1.4-.9 1.3-2 1.6-2 .7-2 1.5.9 1.5 2 1.5 2-.5 2-1.5"/>',
    'c-avtomoyka': '<path d="M4 15.5 5.5 11h13l1.5 4.5v3H4z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/><path d="M8 4.5c0 1.2-1 1.7-1 2.7a1 1 0 0 0 2 0c0-1-1-1.5-1-2.7zM12 3c0 1.2-1 1.7-1 2.7a1 1 0 0 0 2 0c0-1-1-1.5-1-2.7zM16 4.5c0 1.2-1 1.7-1 2.7a1 1 0 0 0 2 0c0-1-1-1.5-1-2.7z"/>',
    'c-zvonok': '<path d="M6 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5v3c0 1.1-.9 2-2 2A16 16 0 0 1 4 5.5c0-1.1.9-2 2-2z"/>',
    'c-rynok': '<path d="M3.5 9.5 5 4.5h14l1.5 5"/><path d="M3.5 9.5c0 1.4 1.2 2.3 2.7 2.3S9 10.9 9 9.5c0 1.4 1.3 2.3 3 2.3s3-.9 3-2.3c0 1.4 1.3 2.3 2.8 2.3s2.7-.9 2.7-2.3"/><path d="M5 12v8h14v-8M9.5 20v-5h5v5"/>',
    'c-sauna': '<path d="M3.5 20.5h17M5 20.5v-6h14v6M8 14.5v6M16 14.5v6"/><path d="M8.5 11c-1-1.3 1-2.2 0-3.5s1-2.2 0-3.5M12 11c-1-1.3 1-2.2 0-3.5s1-2.2 0-3.5M15.5 11c-1-1.3 1-2.2 0-3.5s1-2.2 0-3.5"/>',
    'c-lombard': '<circle cx="12" cy="15" r="5.5"/><path d="M9.5 9.8 8 6.5l2-3h4l2 3-1.5 3.3"/><path d="M8 6.5h8"/>',
    'c-klub': '<circle cx="12" cy="13" r="6.5"/><path d="M12 3v3.5M5.5 13h13M12 6.5c-2 2-2 11 0 13M12 6.5c2 2 2 11 0 13M7 9.5h10M7 16.5h10"/>',
    'c-nalogovaya': '<path d="M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    'c-menty': '<path d="M3.5 16.5 5 11.5l2.5-3h9l2.5 3 1.5 5v2.5h-17z"/><path d="M5 11.5h14"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/><path d="M10 8.5V6h4v2.5"/>',
    'c-restoran': '<path d="M8 3.5h8l-.5 5a3.5 3.5 0 0 1-7 0z"/><path d="M12 12v8M8.5 20.5h7"/><path d="M8.3 6.5h7.4"/>',
    'c-port': '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 10.5h8"/><path d="M4.5 13.5c0 4 3.4 7 7.5 7s7.5-3 7.5-7"/><path d="m3 15 1.5-1.5L6 15M18 15l1.5-1.5L21 15"/>',
    'c-larek': '<path d="M4 9.5 5.5 4.5h13L20 9.5"/><path d="M5 9.5v10.5h14V9.5M4 9.5h16"/><path d="M8 13h8v4H8z"/>',
    'c-shaurma': '<path d="M8 3.5c2.5 1 3.5 3.5 3.5 6.5v10"/><path d="M6.5 8.5c0 7 1.5 11 5 11s5-4 5-11c-2-1.5-4.5-2-5-1.5C11 6.5 8.5 7 6.5 8.5z"/>',
    'c-kachalka': '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    'c-tyurma': '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M8 4v16M12 4v16M16 4v16"/>',
    'c-sto': '<path d="M14.5 6.5a4 4 0 0 0 4.9 4.9l-9.7 9.7a2 2 0 1 1-2.8-2.8l9.7-9.7a4 4 0 0 0-4.9-4.9l2.8 2.8z"/>',
    'c-kazino': '<rect x="3.5" y="5" width="14" height="15" rx="2.5"/><path d="M6 9h9v6H6zM9 9v6M12 9v6"/><circle cx="20" cy="6" r="1.2"/><path d="M20 7.2V12h-2.5"/>',
    'c-bank': '<path d="M3.5 9 12 4l8.5 5zM4.5 20.5h15M6 9.5v8.5M10 9.5v8.5M14 9.5v8.5M18 9.5v8.5M5 18h14"/>',
    'c-rublevka': '<path d="M3.5 20.5h17M5 20.5V9l3-3 3 3v11.5M11 11h8v9.5"/><path d="M5 6V3.5M8 6V3M11 9V6.5"/><path d="M14 14h2v2h-2zM7 12h2v2H7z"/>',
    // ---- подарки ----
    'g-tapok': '<path d="M7 3.5c3 0 5 2 5 5v8.5c0 2-1.5 3.5-3.5 3.5h-1C5.5 20.5 4 19 4 17V7.5c0-2.5 1.2-4 3-4z"/><path d="M4.5 11c2.5 1.5 5 1.5 7.5 0"/><path d="M8 3.5v7.5"/>',
    'g-pager': '<rect x="3.5" y="6" width="17" height="12" rx="2"/><rect x="6" y="8.5" width="12" height="4" rx=".5"/><path d="M7 15.5h1.5M11 15.5h2M15.5 15.5H17"/><path d="M15 6V4.5h3.5"/>',
    'g-konyak': '<path d="M6.5 6h11l-1 9a4.5 4.5 0 0 1-9 0z"/><path d="M7 11h10" /><path d="M7.4 11.3c.4 3 2.3 4.7 4.6 4.7s4.2-1.7 4.6-4.7" ' + F + ' opacity=".35"/><path d="M12 19.5v1M9 20.5h6"/>',
    'g-pidjak': '<path d="M8.5 3.5 12 7l3.5-3.5 4.5 2 1 15h-5l-.5-6h-.5v6H9v-6h-.5l-.5 6H3l1-15z"/><path d="M8.5 3.5 10 10l2-3 2 3 1.5-6.5"/><circle cx="12" cy="12.5" r=".8" ' + F + '/><circle cx="12" cy="15.5" r=".8" ' + F + '/>',
    'g-chain': '<ellipse cx="6.5" cy="12" rx="3.5" ry="2.5"/><ellipse cx="12" cy="12" rx="3.5" ry="2.5" transform="rotate(90 12 12)"/><ellipse cx="17.5" cy="12" rx="3.5" ry="2.5"/>',
    'g-merin': '<path d="M2.5 15.5v-2.5l3-1 2.5-3.5h7l3.5 3.5 3 1v2.5z"/><path d="M9 8.5 8 12h9.5"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/><circle cx="12" cy="5" r="1.4"/><path d="M12 3.6v2.8M10.6 5h2.8"/>',
    // ---- казино: символы автомата ----
    'sl-cherry': '<circle cx="7.5" cy="16.5" r="3.5" ' + F + ' opacity=".9"/><circle cx="16" cy="17" r="3.5" ' + F + ' opacity=".9"/><path d="M7.5 13c1-4 3.5-7 7-9M16 13.5c-.5-4-1-7-1.5-9.5"/><path d="M14.5 4c1.5-.8 3.5-.5 4.5.5-1.5 1-3.3 1-4.5-.5z" ' + F + '/>',
    'sl-lemon': '<path d="M4.5 12c0-4 3.5-7.5 7.5-7.5s7.5 3.5 7.5 7.5-3.5 7.5-7.5 7.5S4.5 16 4.5 12z" ' + F + ' opacity=".9"/><path d="M3 12h2M19 12h2"/>',
    'sl-bell': '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" ' + F + ' opacity=".9"/><path d="M10 20.5h4M12 3v2"/>',
    'sl-diamond': '<path d="M6.5 4.5h11l3.5 5-9 10-9-10z" ' + F + ' opacity=".9"/><path d="M3 9.5h18M9 4.5l-1.5 5L12 19.5l4.5-10-1.5-5" stroke="#fff" stroke-width="1" opacity=".6"/>',
    'sl-seven': '<path d="M5.5 4.5h13c-3.5 4-6 9-7 15" stroke-width="3.2"/><path d="M8 11.5h7" stroke-width="2"/>',
  };
  const DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'
    + '<radialGradient id="gcoin" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#f5c542"/><stop offset="1" stop-color="#c88a12"/></radialGradient>'
    + '<linearGradient id="gstar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ff9f1a"/></linearGradient>'
    + '</defs></svg>';
  function ic(name, cls) {
    const d = P[name];
    if (!d) return '';
    return S(d).replace('class="ic"', `class="ic ic-${name}${cls ? ' ' + cls : ''}"`);
  }
  const api = { ic, has: (n) => !!P[n], path: (n) => P[n] || '', DEFS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.IC = api;
    const put = () => document.body.insertAdjacentHTML('afterbegin', DEFS);
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
  }
})(typeof self !== 'undefined' ? self : this);
