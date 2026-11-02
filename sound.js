// Звуки синтезируются на лету (WebAudio) — никаких файлов, работает офлайн.
window.SFX = (() => {
  let ctx = null;
  let on = true;
  try { on = localStorage.getItem('bratva_sound') !== '0'; } catch {}

  function unlock() {
    if (!ctx) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (A) ctx = new A();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  ['pointerdown', 'touchend', 'keydown'].forEach((e) => addEventListener(e, unlock, { passive: true }));

  function tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slideTo) {
    if (!ctx || !on) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol = 0.2, when = 0, freq = 1000) {
    if (!ctx || !on) return;
    const t = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.value = vol;
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(t);
  }

  const fx = {
    dice() { for (let i = 0; i < 8; i++) noise(0.045, 0.35, i * 0.075, 1800 + Math.random() * 2500); },
    hop() { tone(560 + Math.random() * 60, 0.06, 'triangle', 0.07); },
    cash() { tone(1046, 0.08, 'square', 0.05); tone(1568, 0.2, 'square', 0.05, 0.08); },
    lose() { tone(320, 0.3, 'sawtooth', 0.06, 0, 140); },
    buy() { [660, 880, 1320].forEach((f, i) => tone(f, 0.14, 'triangle', 0.12, i * 0.09)); },
    siren() { for (let i = 0; i < 3; i++) { tone(700, 0.33, 'sawtooth', 0.05, i * 0.66, 1150); tone(1150, 0.33, 'sawtooth', 0.05, i * 0.66 + 0.33, 700); } },
    fight() { noise(0.18, 0.6, 0, 180); tone(95, 0.3, 'sine', 0.45, 0, 40); noise(0.14, 0.5, 0.28, 260); tone(75, 0.35, 'sine', 0.45, 0.28, 35); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.14, i * 0.12)); tone(1318, 0.7, 'triangle', 0.12, 0.5); },
    card() { noise(0.09, 0.2, 0, 3500); tone(880, 0.12, 'sine', 0.08, 0.06); tone(1320, 0.12, 'sine', 0.06, 0.14); },
    turn() { tone(880, 0.12, 'sine', 0.13); tone(1175, 0.22, 'sine', 0.13, 0.12); },
    chat() { tone(1500, 0.05, 'sine', 0.06); tone(1900, 0.06, 'sine', 0.05, 0.05); },
    bad() { tone(220, 0.35, 'square', 0.05, 0, 110); },
    click() { tone(1200, 0.025, 'square', 0.03); },
    glok() {
      for (let i = 0; i < 6; i++) tone(i % 2 ? 2400 : 2900, 0.07, 'square', 0.05, i * 0.07); // свисток
      tone(110, 0.5, 'sawtooth', 0.12, 0.45, 55); tone(82, 0.6, 'sine', 0.3, 0.45, 41); // «бум»
    },
    tick() { tone(1700, 0.03, 'square', 0.03); },
  };

  return {
    play(name) { try { fx[name] && fx[name](); } catch {} },
    vibe(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} },
    get on() { return on; },
    set on(v) { on = !!v; try { localStorage.setItem('bratva_sound', on ? '1' : '0'); } catch {} },
  };
})();
