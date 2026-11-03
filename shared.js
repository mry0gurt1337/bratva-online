// Общие данные для сервера и клиента: поле, константы, формулы ренты.
(function (root) {
  const BOARD = [
    { id: 0,  slug: 'obshak', name: 'Общак',     type: 'start' },
    { id: 1,  slug: 'larek', name: 'Ларёк',     type: 'prop', price: 60,  rent: 12,  up: 40,  group: 'brown' },
    { id: 2,  slug: 'shaurma', name: 'Шаверма',    type: 'prop', price: 70,  rent: 14, up: 40,  group: 'brown' },
    { id: 3,  slug: 'kachalka', name: 'Качалка',   type: 'gym' },
    { id: 4,  slug: 'avtomoyka', name: 'Автомойка', type: 'prop', price: 100, rent: 20, up: 60,  group: 'blue' },
    { id: 5,  slug: 'tyurma', name: 'Тюрьма',    type: 'jail' },
    { id: 6,  slug: 'sto', name: 'СТО',       type: 'prop', price: 120, rent: 26, up: 60,  group: 'blue' },
    { id: 7,  slug: 'zvonok', name: 'Звонок',    type: 'card' },
    { id: 8,  slug: 'rynok', name: 'Рынок',     type: 'prop', price: 150, rent: 32, up: 80,  group: 'pink' },
    { id: 9,  slug: 'sauna', name: 'Сауна',     type: 'prop', price: 170, rent: 36, up: 80,  group: 'pink' },
    { id: 10, slug: 'kazino', name: 'Казино',    type: 'casino' },
    { id: 11, slug: 'lombard', name: 'Ломбард',   type: 'prop', price: 200, rent: 42, up: 100, group: 'orange' },
    { id: 12, slug: 'kachalka', name: 'Качалка',   type: 'gym' },
    { id: 13, slug: 'klub', name: 'Клуб',      type: 'prop', price: 220, rent: 48, up: 100, group: 'orange' },
    { id: 14, slug: 'nalogovaya', name: 'Налоговая', type: 'tax' },
    { id: 15, slug: 'menty', name: 'Менты',     type: 'police' },
    { id: 16, slug: 'restoran', name: 'Ресторан',  type: 'prop', price: 260, rent: 56, up: 130, group: 'green' },
    { id: 17, slug: 'bank', name: 'Банк',      type: 'prop', price: 280, rent: 62, up: 130, group: 'green' },
    { id: 18, slug: 'port', name: 'Порт',      type: 'prop', price: 320, rent: 70, up: 160, group: 'purple' },
    { id: 19, slug: 'rublevka', name: 'Рублёвка',  type: 'prop', price: 400, rent: 90, up: 200, group: 'purple' },
  ];

  const GROUPS = {
    brown: '#c07a45', blue: '#3aa7ff', pink: '#ff5fa2',
    orange: '#ff8a2a', green: '#2fd27a', purple: '#a66bff',
  };

  const C = {
    N: 20, START_MONEY: 1000, SALARY: 120, GOON_PRICE: 60, MAX_GOONS: 3,
    MAX_LEVEL: 3, MAX_HEAT: 5, OMON_FINE: 150, BAIL: 60, POLICE: 15, JAIL: 5,
    HOP_MS: 240, MAX_PLAYERS: 6,
  };

  const COLORS = ['#ffcc33', '#ff4757', '#3d8bff', '#2ed573', '#b56bff', '#ff8c42'];


  // ---------- Магазин ----------
  // Монеты — внутриигровая валюта. Покупаются за Telegram Stars или зарабатываются в игре.
  // В казино монеты не ставятся: там только игровые $ внутри партии.
  const PACKS = [
    { id: 'p100', coins: 100, stars: 50, label: 'Пачка' },
    { id: 'p330', coins: 330, stars: 150, label: 'Котлета', tag: '+10%' },
    { id: 'p1200', coins: 1200, stars: 500, label: 'Чемодан', tag: '+20%' },
  ];
  const SHOP = {
    // премиум-персонажи (остальные бесплатные)
    'char-advokat': { kind: 'char', char: 'advokat', price: 300 },
    'char-reshala': { kind: 'char', char: 'reshala', price: 400 },
    'char-shuler': { kind: 'char', char: 'shuler', price: 300 },
    // рамки аватарки — видны в лобби, в игре и в топе
    'frame-gold': { kind: 'frame', name: 'Золотая', price: 150 },
    'frame-neon': { kind: 'frame', name: 'Неон', price: 200 },
    'frame-wire': { kind: 'frame', name: 'Колючка', price: 200 },
    'frame-fire': { kind: 'frame', name: 'Пламя', price: 350 },
    // скины кубиков — видят все, когда бросаешь ты
    'dice-blood': { kind: 'dice', name: 'Кровавые', price: 120 },
    'dice-neon': { kind: 'dice', name: 'Неоновые', price: 150 },
    'dice-gold': { kind: 'dice', name: 'Золотые', price: 250 },
    'dice-bone': { kind: 'dice', name: 'Костяные', price: 180 },
    // титулы под именем — в лобби, в игре и в топе
    'title-vor': { kind: 'title', name: 'Вор в законе', price: 400 },
    'title-rublevka': { kind: 'title', name: 'Король Рублёвки', price: 300 },
    'title-otmoroz': { kind: 'title', name: 'Отморозок', price: 150 },
    'title-glok': { kind: 'title', name: 'Кент Глока', price: 200 },
    'title-legend': { kind: 'title', name: 'Легенда района', price: 600 },
  };
  // подарки — тратятся при отправке
  const GIFTS = [
    { id: 'tapok', name: 'Тапок', price: 5 },
    { id: 'pager', name: 'Пейджер', price: 10 },
    { id: 'konyak', name: 'Коньяк', price: 20 },
    { id: 'pidjak', name: 'Малиновый пиджак', price: 40 },
    { id: 'chain', name: 'Золотая цепь', price: 60 },
    { id: 'merin', name: 'Мерин', price: 150 },
  ];
  const BOOST = { price: 40, pct: 20 };   // «Подъёмные»: +20% к стартовым деньгам на одну партию
  const EARN = { daily: 25, game: 5, win: 20, dayCap: 120 };

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

  const api = { BOARD, GROUPS, C, COLORS, PACKS, SHOP, GIFTS, BOOST, EARN, cellXY, groupOf, ownsGroup, rentOf, cellValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.G = api;
})(typeof self !== 'undefined' ? self : this);
