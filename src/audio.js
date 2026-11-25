// All sound is synthesised with WebAudio: surf, wind, a low drone, footsteps,
// sword work and chimes.
export function createAudio() {
  let ctx = null, master = null, noiseBuf = null, surf = null, droneGain = null;

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    return src;
  }

  function start() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 2.5);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    surf = ctx.createGain();
    surf.gain.value = 1;
    surf.connect(master);
    // surf: low rumble that swells, plus a hiss of foam; wind goes straight to master
    const swell = (freq, type, q, gainBase, gainDepth, rate, out) => {
      const src = noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gainBase;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = gainDepth;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(out);
      src.start();
      lfo.start();
    };
    swell(420, 'lowpass', 0.6, 0.34, 0.2, 0.11, surf);
    swell(2400, 'bandpass', 0.5, 0.05, 0.04, 0.17, surf);
    swell(260, 'bandpass', 1.2, 0.07, 0.05, 0.07, master); // wind

    // a quiet drone, like a tanpura heard from far off
    droneGain = ctx.createGain();
    droneGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    droneGain.connect(lp).connect(master);
    for (const [f, v] of [[73.42, 0.5], [110.0, 0.32], [146.83, 0.3], [147.6, 0.2], [220.4, 0.1]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = v * 0.16;
      o.connect(g).connect(droneGain);
      o.start();
    }
    droneGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 6);
  }

  // how loud the sea is in this area (0 inland, 1 on the shore)
  function setSea(level) {
    if (surf) surf.gain.linearRampToValueAtTime(level, ctx.currentTime + 1.5);
  }
  function duck(on) {
    if (master) master.gain.linearRampToValueAtTime(on ? 0.0 : 0.8, ctx.currentTime + 0.6);
  }

  function burst(freq, q, vol, dur, type = 'bandpass', sweepTo = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  function tone(freq, when, dur, vol, type = 'sine') {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(master);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  const step = (run = 0, loud = 1) => burst(500 + Math.random() * 500, 0.9, (0.16 + run * 0.1) * loud, 0.16);
  const swing = () => burst(500, 1.4, 0.2, 0.26, 'bandpass', 2600);
  function clang() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [1870, 2790, 4120]) tone(f * (0.97 + Math.random() * 0.06), t, 0.35, 0.05, 'triangle');
    burst(3200, 0.8, 0.22, 0.09);
    burst(180, 0.8, 0.3, 0.14, 'lowpass');
  }
  const hurt = () => {
    burst(240, 0.9, 0.45, 0.2, 'lowpass');
    burst(900, 1.2, 0.12, 0.12);
  };
  const dash = () => burst(900, 0.7, 0.12, 0.3, 'bandpass', 300);

  function chime(index = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const scale = [293.66, 329.63, 392.0, 440.0, 493.88, 587.33];
    const base = scale[index % scale.length];
    tone(base, t, 2.2, 0.16);
    tone(base * 2, t + 0.05, 1.6, 0.07);
    tone(base * 1.5, t + 0.18, 2.0, 0.08);
  }

  function finale() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [146.83, 220, 293.66, 369.99, 440].forEach((f, i) => tone(f, t + i * 0.22, 6, 0.1));
  }

  return { start, setSea, duck, step, swing, clang, hurt, dash, chime, finale };
}
