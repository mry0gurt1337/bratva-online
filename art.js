// Портреты персонажей — векторная графика, рисуется кодом (без картинок-файлов).
(function (root) {
  const CHARS = {
    boec:      { name: 'Спортик',      perk: '+1 к защите своих точек на стрелке', bg: ['#3a6df0', '#14204a'], skin: '#e8b48f', hair: 'shaved', outfit: 'track', color: '#1d3fae', extra: ['scar', 'nose'], brow: 'angry', mouth: 'flat' },
    baryga:    { name: 'Барыга',    perk: 'Точки и прокачка на 20% дешевле', bg: ['#e0a32a', '#4a2c08'], skin: '#d9a07a', hair: 'short', hat: 'flatcap', hatColor: '#4b4038', outfit: 'leather', color: '#2b2522', extra: ['mustache', 'goldtooth'], brow: 'up', mouth: 'grin' },
    advokat:   { name: 'Адвокат',   perk: 'Не сидит, налог и штраф на стрелке −50%', bg: ['#7d8aa3', '#1d2333'], skin: '#efc6a4', hair: 'slick', hairColor: '#2a211c', outfit: 'suit', color: '#2a3550', tie: '#9b1c2e', glasses: 'thin', brow: 'flat', mouth: 'smirk' },
    shuler:    { name: 'Шулер',     perk: 'Казино: выигрыш +50%, видит карту крупье', bg: ['#a33bd8', '#2a0b3e'], skin: '#e3ae88', hair: 'short', hairColor: '#111', hat: 'fedora', hatColor: '#1d1a20', outfit: 'vest', color: '#5a1730', extra: ['thinmustache'], brow: 'up', mouth: 'smirk' },
    reshala:   { name: 'Блатной',    perk: 'Глок не трогает, ОМОН −50%', bg: ['#e2394f', '#3e0a14'], skin: '#e6b391', hair: 'short', hairColor: '#3a2a20', outfit: 'blazer', color: '#b0123a', extra: ['chain'], brow: 'flat', mouth: 'smirk' },
    buhgalter: { name: 'Бухгалтер', perk: '+$40 с каждого Общака', bg: ['#2fb37a', '#0b2e20'], skin: '#f0caa8', hair: 'combover', hairColor: '#6b5a4c', outfit: 'sweater', color: '#5b6e4a', glasses: 'round', brow: 'worry', mouth: 'flat' },
    gromila:   { name: 'Громила',   perk: 'Братки по $30, до 4 штук', bg: ['#606a74', '#15181c'], skin: '#d29b76', hair: 'none', hat: 'beanie', hatColor: '#24272b', outfit: 'bomber', color: '#1e2a22', extra: ['beard'], brow: 'angry', mouth: 'flat', wide: true },
    shchipach: { name: 'Щипач',     perk: 'Проезжая мимо фишки соперника, тащит у него $15', bg: ['#2fa7a0', '#0b2a28'], skin: '#e4b08c', hair: 'short', hairColor: '#2b2420', hat: 'flatcap', hatColor: '#2c3a38', outfit: 'leather', color: '#22302e', extra: ['thinmustache'], brow: 'up', mouth: 'smirk' },
    sidelets:  { name: 'Сиделец',   perk: 'Отсидел ход — вышел с +$60 и +1 авторитета', bg: ['#8a8f99', '#1c1f24'], skin: '#d8a483', hair: 'shaved', outfit: 'track', color: '#2c2f36', extra: ['scar', 'stubble'], brow: 'flat', mouth: 'flat' },
    kommers:   { name: 'Коммерсант', perk: 'Доля со своих точек +15%', bg: ['#c0306a', '#3a0b20'], skin: '#efc3a0', hair: 'slick', hairColor: '#1d1712', outfit: 'blazer', color: '#a0124a', extra: ['chain', 'goldtooth'], brow: 'up', mouth: 'grin' },
    ekstrasens:{ name: 'Экстрасенс', perk: 'Звонки: плюсы ×1.5, минусы вдвое меньше', bg: ['#5b6cf0', '#151a4a'], skin: '#f0cbab', hair: 'combover', hairColor: '#8a7a6a', outfit: 'suit', color: '#1b1b2a', tie: '#5b6cf0', glasses: 'round', brow: 'up', mouth: 'smirk' },
    oboroten:  { name: 'Оборотень', perk: 'Менты и ОМОН не трогают, половина штрафов ОМОНа — ему', bg: ['#3b6fb0', '#0d1f36'], skin: '#e0a986', hair: 'short', hairColor: '#2a2a2a', outfit: 'tech', color: '#253a5a', glasses: 'sun', extra: ['stubble'], brow: 'angry', mouth: 'smirk' },
    budka:     { name: 'Будка',     perk: 'Тайный. Заговорщик: на него действует только Глок', bg: ['#d6b25e', '#2a1d06'], skin: '#d29b76', hair: 'none', hat: 'beanie', hatColor: '#0f0f12', outfit: 'bomber', color: '#111114', extra: ['beard', 'chain'], brow: 'angry', mouth: 'smirk', wide: true, secret: true },
  };
  const GLOK = { name: 'Глок', bg: ['#4f6b45', '#0f160d'], skin: '#e2ad88', hair: 'none', hat: 'beanie', hatColor: '#1b1d22', hatBand: '#d8c27a', outfit: 'tech', color: '#39462f', glasses: 'sun', extra: ['stubble', 'chain', 'toothpick'], brow: 'angry', mouth: 'smirk' };

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
  }

  function portrait(c, uid) {
    const id = 'p' + (uid || Math.random().toString(36).slice(2, 8));
    const s = c.skin, sd = shade(s, 0.82), sl = shade(s, 1.08);
    const hc = c.hairColor || '#2b201a';
    const out = [];
    out.push(`<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="portrait">`);
    out.push(`<defs><radialGradient id="${id}b" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${c.bg[0]}"/><stop offset="1" stop-color="${c.bg[1]}"/></radialGradient>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sl}"/><stop offset="1" stop-color="${s}"/></linearGradient>
      <linearGradient id="${id}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c.color, 1.25)}"/><stop offset="1" stop-color="${shade(c.color, 0.7)}"/></linearGradient></defs>`);
    out.push(`<rect width="120" height="120" fill="url(#${id}b)"/>`);
    out.push(`<circle cx="60" cy="40" r="46" fill="#fff" opacity=".06"/>`);
    // тело
    const w = c.wide ? 6 : 0;
    out.push(`<path d="M${4 - w} 122 C${6 - w} 101 ${26 - w} 91 60 90 C${94 + w} 91 ${114 + w} 101 ${116 + w} 122 Z" fill="url(#${id}o)"/>`);
    // шея
    out.push(`<path d="M49 74 L49 92 Q60 98 71 92 L71 74 Z" fill="${sd}"/>`);
    out.push(outfit(c, id));
    // уши, голова
    out.push(`<ellipse cx="37.5" cy="61" rx="4.5" ry="7" fill="${sd}"/><ellipse cx="82.5" cy="61" rx="4.5" ry="7" fill="${sd}"/>`);
    out.push(`<path d="M38 56 C38 36 48 31 60 31 C72 31 82 36 82 56 C82 74 73 86 60 86 C47 86 38 74 38 56 Z" fill="url(#${id}f)"/>`);
    out.push(`<path d="M41 68 C44 80 52 86 60 86 C68 86 76 80 79 68 C74 77 67 80 60 80 C53 80 46 77 41 68 Z" fill="${sd}" opacity=".5"/>`);
    if ((c.extra || []).includes('stubble')) out.push(`<path d="M41 64 C43 80 52 86 60 86 C68 86 77 80 79 64 C76 74 70 78 60 78 C50 78 44 74 41 64 Z" fill="#3b2c22" opacity=".28"/>`);
    if ((c.extra || []).includes('beard')) out.push(`<path d="M39 60 C39 80 49 92 60 92 C71 92 81 80 81 60 C78 70 72 75 66 74 Q60 72 54 74 C48 75 42 70 39 60 Z" fill="#3a2a1e"/>`);
    out.push(hair(c, hc));
    out.push(face(c));
    out.push(hat(c));
    out.push(glasses(c));
    out.push(extras(c));
    out.push(`</svg>`);
    return out.join('');
  }

  function outfit(c, id) {
    const o = c.color, d = shade(o, 0.6), l = shade(o, 1.35);
    switch (c.outfit) {
      case 'suit': return `<path d="M44 92 L60 120 L76 92 L70 90 L60 104 L50 90 Z" fill="#f3f0ea"/><path d="M57 96 L60 93 L63 96 L61.5 120 L58.5 120 Z" fill="${c.tie}"/><path d="M44 92 L54 120 L38 120 L30 98 Z M76 92 L66 120 L82 120 L90 98 Z" fill="${d}" opacity=".7"/>`;
      case 'blazer': return `<path d="M46 91 L60 112 L74 91 L69 90 L60 100 L51 90 Z" fill="#141014"/><path d="M46 91 L56 120 L40 120 L32 98 Z M74 91 L64 120 L80 120 L88 98 Z" fill="${d}" opacity=".55"/><path d="M48 93 Q60 104 72 93" stroke="#f5c542" stroke-width="2.2" fill="none"/><path d="M50 95 Q60 108 70 95" stroke="#e0a82a" stroke-width="1.6" fill="none" stroke-dasharray="2 1.5"/>`;
      case 'leather': return `<path d="M47 90 L60 104 L73 90" fill="#e6e1d8"/><path d="M47 90 L38 106 L52 120 L60 104 Z M73 90 L82 106 L68 120 L60 104 Z" fill="${l}" opacity=".35"/><path d="M60 104 L60 122" stroke="${d}" stroke-width="1.5"/>`;
      case 'track': return `<path d="M50 90 L60 98 L70 90 L70 86 L50 86 Z" fill="${l}"/><path d="M60 98 L60 122" stroke="#d8dde8" stroke-width="1.6"/><path d="M60 98 L60 122" stroke="#9aa3b5" stroke-width=".6" stroke-dasharray="1.2 1.2"/>`;
      case 'vest': return `<path d="M47 91 L60 120 L73 91 Z" fill="#efe9de"/><path d="M47 91 L56 120 L42 120 L36 100 Z M73 91 L64 120 L78 120 L84 100 Z" fill="${o}"/><path d="M55 93 L60 96 L65 93 L65 99 L60 96 L55 99 Z" fill="#141014"/><circle cx="60" cy="106" r="1.2" fill="#c9a43a"/><circle cx="60" cy="113" r="1.2" fill="#c9a43a"/>`;
      case 'sweater': return `<path d="M49 89 Q60 99 71 89 L71 93 Q60 104 49 93 Z" fill="#f2efe8"/><path d="M46 92 L60 116 L74 92" stroke="${d}" stroke-width="3" fill="none"/><path d="M44 104 L76 104 M42 112 L78 112" stroke="${l}" stroke-width="1.4" opacity=".5"/>`;
      case 'bomber': return `<path d="M44 88 Q60 96 76 88 L78 94 Q60 103 42 94 Z" fill="${shade(o, 0.45)}"/><path d="M60 98 L60 122" stroke="#8a9a8c" stroke-width="1.2"/><rect x="66" y="104" width="10" height="3" rx="1" fill="#c86a2a" opacity=".9"/>`;
      case 'tech': // техно-куртка: высокий воротник, кнопки, накладные карманы — без логотипов
        return `<path d="M42 84 Q60 94 78 84 L80 96 Q60 106 40 96 Z" fill="${shade(o, 0.8)}"/><path d="M42 84 L40 96 L46 98 L48 86 Z M78 84 L80 96 L74 98 L72 86 Z" fill="${shade(o, 0.65)}"/>
          <path d="M60 100 L60 122" stroke="${d}" stroke-width="2"/><circle cx="60" cy="106" r="1.4" fill="#2a2a2a"/><circle cx="60" cy="114" r="1.4" fill="#2a2a2a"/>
          <rect x="34" y="104" width="16" height="12" rx="2" fill="${shade(o, 0.85)}" stroke="${d}" stroke-width=".8"/><rect x="70" y="104" width="16" height="12" rx="2" fill="${shade(o, 0.85)}" stroke="${d}" stroke-width=".8"/>
          <path d="M34 107 L50 107 M70 107 L86 107" stroke="${d}" stroke-width=".8"/>`;
      default: return '';
    }
  }

  function hair(c, hc) {
    switch (c.hair) {
      case 'shaved': return `<path d="M39 52 C39 36 48 31 60 31 C72 31 81 36 81 52 C78 42 70 38 60 38 C50 38 42 42 39 52 Z" fill="${hc}" opacity=".35"/>`;
      case 'short': return `<path d="M38 55 C36 36 47 28 60 28 C74 28 84 36 82 55 C80 46 77 41 73 40 C66 43 54 43 47 40 C43 42 40 47 38 55 Z" fill="${hc}"/>`;
      case 'slick': return `<path d="M38 56 C35 35 47 27 61 27 C75 27 85 35 82 54 C80 44 76 39 70 37 C60 36 50 38 44 42 C41 45 39 50 38 56 Z" fill="${hc}"/><path d="M48 32 C58 29 70 30 78 37" stroke="#fff" stroke-width="1.2" opacity=".25" fill="none"/>`;
      case 'combover': return `<path d="M38 56 C37 44 40 38 44 36 C50 33 70 31 80 40 C82 46 82 50 82 56 C80 48 76 42 70 41 C60 39 48 41 38 56 Z" fill="${hc}"/><path d="M40 52 C38 46 39 40 42 38" stroke="${hc}" stroke-width="3" fill="none"/>`;
      default: return '';
    }
  }

  function face(c) {
    const e = (c.extra || []);
    const brows = {
      angry: '<path d="M44 49 L56 52.5" /><path d="M76 49 L64 52.5" />',
      up: '<path d="M44 49 Q50 45 56 48.5" /><path d="M64 48.5 Q70 45 76 49" />',
      flat: '<path d="M44 49.5 L56 49.5" /><path d="M64 49.5 L76 49.5" />',
      worry: '<path d="M44 50 L56 47.5" /><path d="M76 50 L64 47.5" />',
    }[c.brow || 'flat'];
    const mouth = {
      smirk: '<path d="M52 73 Q60 76 69 71" stroke="#5a2a22" stroke-width="2" fill="none" stroke-linecap="round"/>',
      grin: '<path d="M51 71 Q60 80 69 71 Q60 75 51 71 Z" fill="#5a2a22"/><path d="M53 72 Q60 75 67 72 L66 73.5 Q60 76 54 73.5 Z" fill="#fff"/>',
      flat: '<path d="M53 73.5 L67 73.5" stroke="#5a2a22" stroke-width="2" stroke-linecap="round"/>',
    }[c.mouth || 'flat'];
    let s = `<g stroke="#2a1d16" stroke-width="2.6" stroke-linecap="round" fill="none">${brows}</g>`;
    if (!c.glasses || c.glasses !== 'sun') s += `<ellipse cx="50.5" cy="57" rx="2.8" ry="2.5" fill="#1e1612"/><ellipse cx="69.5" cy="57" rx="2.8" ry="2.5" fill="#1e1612"/><circle cx="51.4" cy="56.2" r=".8" fill="#fff"/><circle cx="70.4" cy="56.2" r=".8" fill="#fff"/>`;
    s += e.includes('nose') ? `<path d="M60 58 L57 66 L61 67 L63 64" stroke="${shade(c.skin, 0.68)}" stroke-width="1.8" fill="none" stroke-linejoin="round"/>` : `<path d="M60 58 Q57 65 59 67 Q61 68 63 66" stroke="${shade(c.skin, 0.7)}" stroke-width="1.6" fill="none"/>`;
    s += mouth;
    if (e.includes('goldtooth')) s += `<rect x="62" y="72" width="2.6" height="2.6" fill="#f5c542"/>`;
    if (e.includes('mustache')) s += `<path d="M50 70 Q55 66 60 69 Q65 66 70 70 Q66 72 60 70.5 Q54 72 50 70 Z" fill="#3a2a1e"/>`;
    if (e.includes('thinmustache')) s += `<path d="M52 69.5 Q56 68 60 69.3 Q64 68 68 69.5" stroke="#1a1410" stroke-width="1.6" fill="none"/>`;
    if (e.includes('scar')) s += `<path d="M71 47 L76 58" stroke="#b5624f" stroke-width="1.6"/><path d="M71.5 50 L74 49 M73 53 L75.5 52 M74.3 56 L76.6 55" stroke="#b5624f" stroke-width="1"/>`;
    return s;
  }

  function hat(c) {
    const h = c.hatColor || '#222', d = shade(h, 0.7), l = shade(h, 1.5);
    switch (c.hat) {
      case 'flatcap': return `<path d="M36 50 C36 34 48 27 62 28 C76 29 84 36 84 46 L86 49 C70 44 54 44 36 50 Z" fill="${h}"/><path d="M36 50 C50 43 70 42 88 50 C80 53 52 53 36 50 Z" fill="${d}"/><path d="M44 36 C54 31 68 31 78 37" stroke="${l}" stroke-width="1" fill="none" opacity=".5"/>`;
      case 'fedora': return `<ellipse cx="60" cy="44" rx="34" ry="7" fill="${d}"/><path d="M40 44 C40 28 48 20 60 20 C72 20 80 28 80 44 Z" fill="${h}"/><path d="M41 38 L79 38 L80 44 L40 44 Z" fill="#8a1c2a"/><path d="M52 22 Q60 28 68 22" stroke="${d}" stroke-width="2" fill="none"/>`;
      case 'beanie': {
        const band = c.hatBand ? `<path d="M37 44 Q60 38 83 44" stroke="${c.hatBand}" stroke-width="1.4" fill="none" opacity=".8"/>` : '';
        return `<path d="M36 50 C34 30 46 20 60 20 C74 20 86 30 84 50 Z" fill="${h}"/><path d="M35 50 C35 44 36 42 37 41 Q60 36 83 41 C84 42 85 44 85 50 Q60 46 35 50 Z" fill="${d}"/>
          <path d="M42 42 L42 49 M48 40.5 L48 48 M54 39.6 L54 47 M60 39.3 L60 47 M66 39.6 L66 47 M72 40.5 L72 48 M78 42 L78 49" stroke="${l}" stroke-width=".9" opacity=".35"/>${band}`;
      }
      default: return '';
    }
  }

  function glasses(c) {
    if (c.glasses === 'sun') return `<path d="M41 52 L79 52 L78 54 Q77 64 69 64 Q62 64 61 56 L59 56 Q58 64 51 64 Q43 64 42 54 Z" fill="#0d0f14"/><path d="M45 54 Q50 53 55 55" stroke="#6a8cff" stroke-width="1.2" opacity=".55" fill="none"/><path d="M64 54 Q69 53 74 55" stroke="#6a8cff" stroke-width="1.2" opacity=".55" fill="none"/><path d="M41 52 L37 54 M79 52 L83 54" stroke="#0d0f14" stroke-width="2"/>`;
    if (c.glasses === 'round') return `<g fill="#fff" fill-opacity=".12" stroke="#3a2a1e" stroke-width="1.8"><circle cx="50.5" cy="57" r="6.5"/><circle cx="69.5" cy="57" r="6.5"/></g><path d="M57 56.5 Q60 55 63 56.5" stroke="#3a2a1e" stroke-width="1.6" fill="none"/>`;
    if (c.glasses === 'thin') return `<g fill="#fff" fill-opacity=".1" stroke="#c9a43a" stroke-width="1.3"><rect x="43" y="53" width="14" height="8.5" rx="2.5"/><rect x="63" y="53" width="14" height="8.5" rx="2.5"/></g><path d="M57 56 L63 56" stroke="#c9a43a" stroke-width="1.3"/>`;
    return '';
  }

  function extras(c) {
    const e = c.extra || [];
    let s = '';
    if (e.includes('chain')) s += `<path d="M47 90 Q60 104 73 90" stroke="#f5c542" stroke-width="2.6" fill="none"/><path d="M47 90 Q60 104 73 90" stroke="#a87a12" stroke-width="2.6" fill="none" stroke-dasharray="1.6 2.4"/>`;
    if (e.includes('toothpick')) s += `<path d="M66 72.5 L79 76" stroke="#d9c08a" stroke-width="1.6" stroke-linecap="round"/>`;
    return s;
  }

  const api = { CHARS, GLOK, portrait: (key, uid) => portrait(key === 'glok' ? GLOK : CHARS[key] || CHARS.boec, uid) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ART = api;
})(typeof self !== 'undefined' ? self : this);
