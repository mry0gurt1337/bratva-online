// Звуки — настоящие записи из паков Kenney (CC0, public domain): кости по дереву,
// монеты, удары, двери, шаги, страницы, саксофон. Без синтезатора.
window.SFX = (() => {
  const NAMES = ['dice', 'hop1', 'hop2', 'hop3', 'cash', 'buy', 'card', 'turn', 'chat', 'click', 'tick', 'bad', 'jail',
    'omon', 'glok', 'fight', 'strelka-win', 'strelka-lose', 'casino-win', 'lose', 'victory', 'trade', 'bankrupt', 'boom', 'shots', 'siren', 'snitch'];
  // разные «вариации», чтобы повторяющиеся звуки не надоедали
  const VARY = { dice: 0.06, hop1: 0.1, hop2: 0.1, hop3: 0.1, cash: 0.05, click: 0.04, tick: 0.08, fight: 0.04 };
  let ctx = null, master = null, on = true;
  const buffers = {};
  try { on = localStorage.getItem('bratva_sound') !== '0'; } catch {}

  function init() {
    if (ctx) return;
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    ctx = new A();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    NAMES.forEach(load);
  }
  async function load(n) {
    try {
      const res = await fetch(`sfx-${n}.mp3`);
      const arr = await res.arrayBuffer();
      buffers[n] = await new Promise((ok, bad) => ctx.decodeAudioData(arr, ok, bad)); // старый Safari — только колбэки
    } catch {}
  }
  function unlock() {
    init();
    if (ctx && ctx.state !== 'running') ctx.resume();
  }
  ['pointerdown', 'touchend', 'keydown'].forEach((e) => addEventListener(e, unlock, { passive: true }));

  function play(name, vol = 1) {
    if (!on || !ctx) return;
    if (name === 'hop') name = 'hop' + (1 + Math.floor(Math.random() * 3));
    const b = buffers[name];
    if (!b) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b;
    const v = VARY[name] || 0;
    if (v) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * v;
    g.gain.value = vol;
    src.connect(g).connect(master);
    src.start();
  }

  return {
    play(name, vol) { try { play(name, vol); } catch {} },
    vibe(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} },
    get on() { return on; },
    set on(v) { on = !!v; try { localStorage.setItem('bratva_sound', on ? '1' : '0'); } catch {} },
  };
})();
