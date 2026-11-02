// Общие данные для сервера и клиента: поле, константы, формулы ренты.
(function (root) {
  const BOARD = [
    { id: 0,  name: 'Общак',     type: 'start',  emoji: '💰' },
    { id: 1,  name: 'Ларёк',     type: 'prop', price: 60,  rent: 12,  up: 40,  group: 'brown',  emoji: '🏪' },
    { id: 2,  name: 'Шаурма',    type: 'prop', price: 70,  rent: 14, up: 40,  group: 'brown',  emoji: '🌯' },
    { id: 3,  name: 'Качалка',   type: 'gym',    emoji: '🏋️' },
    { id: 4,  name: 'Автомойка', type: 'prop', price: 100, rent: 20, up: 60,  group: 'blue',   emoji: '🚿' },
    { id: 5,  name: 'Тюрьма',    type: 'jail',   emoji: '🔒' },
    { id: 6,  name: 'СТО',       type: 'prop', price: 120, rent: 26, up: 60,  group: 'blue',   emoji: '🔧' },
    { id: 7,  name: 'Звонок',    type: 'card',   emoji: '📞' },
    { id: 8,  name: 'Рынок',     type: 'prop', price: 150, rent: 32, up: 80,  group: 'pink',   emoji: '🍉' },
    { id: 9,  name: 'Сауна',     type: 'prop', price: 170, rent: 36, up: 80,  group: 'pink',   emoji: '🧖' },
    { id: 10, name: 'Казино',    type: 'casino', emoji: '🎰' },
    { id: 11, name: 'Ломбард',   type: 'prop', price: 200, rent: 42, up: 100, group: 'orange', emoji: '💍' },
    { id: 12, name: 'Качалка',   type: 'gym',    emoji: '🏋️' },
    { id: 13, name: 'Клуб',      type: 'prop', price: 220, rent: 48, up: 100, group: 'orange', emoji: '🪩' },
    { id: 14, name: 'Налоговая', type: 'tax',    emoji: '🧾' },
    { id: 15, name: 'Менты',     type: 'police', emoji: '🚔' },
    { id: 16, name: 'Ресторан',  type: 'prop', price: 260, rent: 56, up: 130, group: 'green',  emoji: '🍷' },
    { id: 17, name: 'Банк',      type: 'prop', price: 280, rent: 62, up: 130, group: 'green',  emoji: '🏦' },
    { id: 18, name: 'Порт',      type: 'prop', price: 320, rent: 70, up: 160, group: 'purple', emoji: '⚓' },
    { id: 19, name: 'Рублёвка',  type: 'prop', price: 400, rent: 90, up: 200, group: 'purple', emoji: '🏰' },
  ];

  const GROUPS = {
    brown: '#c07a45', blue: '#3aa7ff', pink: '#ff5fa2',
    orange: '#ff8a2a', green: '#2fd27a', purple: '#a66bff',
  };

  const C = {
    N: 20, START_MONEY: 1000, SALARY: 120, GOON_PRICE: 60, MAX_GOONS: 3,
    MAX_LEVEL: 3, MAX_HEAT: 5, OMON_FINE: 150, BAIL: 60, POLICE: 15, JAIL: 5,
    HOP_MS: 170, MAX_PLAYERS: 6,
  };

  const ICONS = ['🚗', '💼', '💀', '🎯', '🐺', '🎩', '🃏', '💎'];
  const COLORS = ['#ffcc33', '#ff4757', '#3d8bff', '#2ed573', '#b56bff', '#ff8c42'];

  // 6x6 кольцо: 0 — левый верхний угол, дальше по часовой
  function cellXY(id) {
    if (id <= 5) return { x: id, y: 0 };
    if (id <= 10) return { x: 5, y: id - 5 };
    if (id <= 15) return { x: 15 - id, y: 5 };
    return { x: 0, y: 20 - id };
  }
  const groupOf = (g) => BOARD.filter((c) => c.group === g).map((c) => c.id);
  const ownsGroup = (props, pid, g) => groupOf(g).every((id) => props[id] && props[id].owner === pid);
  function rentOf(props, id) {
    const c = BOARD[id], pr = props[id];
    if (!pr) return c.rent;
    let r = c.rent * Math.pow(2, pr.level);
    if (pr.level === 0 && ownsGroup(props, pr.owner, c.group)) r *= 2; // монополия на район
    return r;
  }
  const cellValue = (id, level) => BOARD[id].price + BOARD[id].up * level;

  const api = { BOARD, GROUPS, C, ICONS, COLORS, cellXY, groupOf, ownsGroup, rentOf, cellValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.G = api;
})(typeof self !== 'undefined' ? self : this);
