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
    MAX_LEVEL: 3, MAX_HEAT: 5, CATCHUP: 80, OMON_FINE: 150, BAIL: 60, POLICE: 15, JAIL: 5,
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
    'char-oboroten': { kind: 'char', char: 'oboroten', price: 350 },
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
    // «Дурак»: рубашки карт (видят все) и сукно стола (видишь ты)
    'back-gold': { kind: 'back', name: 'Золото', price: 250 },
    'back-neon': { kind: 'back', name: 'Неон', price: 200 },
    'back-camo': { kind: 'back', name: 'Камуфляж', price: 150 },
    'back-zek': { kind: 'back', name: 'Зона', price: 180 },
    'felt-red': { kind: 'felt', name: 'Казино', price: 150 },
    'felt-blue': { kind: 'felt', name: 'Питер', price: 150 },
    'felt-leather': { kind: 'felt', name: 'Подпольный клуб', price: 300 },
    // темы оформления — видит только владелец
    'theme-piter': { kind: 'theme', name: 'Бандитский Петербург', price: 100 },
    'theme-zona': { kind: 'theme', name: 'Зона', price: 150 },
    'theme-casino': { kind: 'theme', name: 'Казино Рояль', price: 250 },
    'theme-neon': { kind: 'theme', name: 'Неон', price: 300 },
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
  // Козыри — активные приёмы против соперников. Играются в свой ход до броска.
  const ACTIONS = {
    boom:  { name: 'Подрыв', cost: 120, target: 'cell', text: 'Взорвать чужую точку: минус звезда, а без звёзд — точка уходит банку. Розыск +2.' },
    shoot: { name: 'Перестрелка', cost: 0, target: 'player', text: 'Кубик + сила против соперника. Проигравший отдаёт $120 и братка.' },
    snitch:{ name: 'Стук', cost: 80, target: 'player', text: 'Стукануть ментам — соперник едет в тюрьму (если не прикроет браток).' },
    roof:  { name: 'Крыша', cost: 0, target: null, text: 'Прикрывает от следующего козыря против тебя.' },
  };
  const MAX_HAND = 3;
  // «Дурак»: столы-ступени. Ставки — в «бабках» (не покупаются).
  const DURAK = {
    tiers: {
      dvor:   { name: 'Двор', stakes: [50, 100, 250], felt: 'green', tip: 0.4 },
      kazino: { name: 'Казино «Три топора»', stakes: [500, 1000, 2500], felt: 'red', tip: 0.4 },
      piter:  { name: 'Питер, набережная', stakes: [1000, 2500, 5000], felt: 'blue', tip: 0.4 },
      club:   { name: 'Подпольный клуб', stakes: [5000, 10000, 25000], felt: 'leather', tip: 0.4, minBank: 50000 },
    },
    start: 5000, refillBelow: 500, refillTo: 1500, fee: 0.05, dealerFee: 4, coins: { first: 10, rest: 4 },
  };
  const BOOST = { price: 40, pct: 20 };   // «Подъёмные»: +20% к стартовым деньгам на одну партию
  // Призы за катку: платит игра (не другие игроки). Партия только с ботами — половина. Лимит в день.
  const EARN = { daily: 25, ladder: [25, 30, 40, 50, 60, 80, 150], game: 5, place: [40, 20, 10], chase: 8, dayCap: 200 };
  // Колесо фортуны: 1 бесплатный прокрут в день (+1 за 7-й день серии). Шансы открыты игроку.
  // Персонаж, рамка и т.п. — случайный из ещё не купленных; если всё уже есть — монеты.
  const WHEEL = [
    { id: 'c30', kind: 'coins', amount: 30, w: 30, label: '30 монет' },
    { id: 'c60', kind: 'coins', amount: 60, w: 22, label: '60 монет' },
    { id: 'c150', kind: 'coins', amount: 150, w: 8, label: '150 монет' },
    { id: 'char', kind: 'char', w: 6, label: 'Персонаж' },
    { id: 'frame', kind: 'frame', w: 9, label: 'Рамка' },
    { id: 'dice', kind: 'dice', w: 10, label: 'Кубики' },
    { id: 'title', kind: 'title', w: 9, label: 'Титул' },
    { id: 'theme', kind: 'theme', w: 6, label: 'Тема' },
  ];

  // ---------- Кланы и общак ----------
  // Всё в «бабках» (бесплатная валюта). Монеты, купленные за Stars, в общак не идут, в долг не даются и не выводятся.
  const CLANS = {
    boytsy:   { name: 'Бойцы',    chars: ['boec', 'gromila', 'sidelets'],     icon: 'fist',      color: '#ff5c6c', motto: 'Сила и живучесть',  perk: 'Подъёмные до 2 000 бабок вместо 1 500' },
    delovye:  { name: 'Деловые',  chars: ['baryga', 'kommers', 'buhgalter'],  icon: 'briefcase', color: '#f5c542', motto: 'Деньги к деньгам',  perk: 'К каждому взносу в общак игра докидывает +10%' },
    fartovye: { name: 'Фартовые', chars: ['shchipach', 'ekstrasens'],         icon: 'dice',      color: '#5b8cff', motto: 'Фарт и ловкость',   perk: 'Долг отыгрывается ×8 вместо ×10, лимит долга 15 000' },
  };
  const CLAN = {
    maxPct: 20, defPct: 5, minGive: 100, switchDays: 3,
    refill: { boytsy: 2000, boost: 3000 },
    delovyeBonus: 0.1,
    // Долг из общака: сумма «бонусная», пока не наберёшь оборот ×10 в играх против системы
    loan: { mult: 10, multFartovye: 8, share: 0.1, cap: 10000, capFartovye: 15000, min: 500, minGames: 3, minHours: 24, pvp: 0.1, autoRepayPct: 25 },
    boosts: {
      podogrev:    { name: 'Подогрев',        price: 15000, text: 'Подъёмные для всех своих — до 3 000 бабок' },
      bezkomissii: { name: 'Без комиссии',    price: 25000, text: 'В «Дураке» с выигрыша не сгорают 5%' },
      stavka:      { name: 'Ставка на район', price: 40000, text: 'Если ночное колесо выберет клан — выплата вдвое' },
    },
    boostHours: 24,
    // Колесо района в 00:00 по Москве: один клан, выплата активным (заходили за 7 дней)
    wheel: { bonus: 300, share: 0.1, perCap: 5000, activeDays: 7 },
  };

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

  const api = { BOARD, GROUPS, C, COLORS, PACKS, SHOP, GIFTS, BOOST, EARN, WHEEL, ACTIONS, MAX_HAND, DURAK, CLANS, CLAN, cellXY, groupOf, ownsGroup, rentOf, cellValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.G = api;
})(typeof self !== 'undefined' ? self : this);
