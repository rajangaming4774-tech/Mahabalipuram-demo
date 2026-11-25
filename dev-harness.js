// Temporary measuring harness for the movement work (not loaded by the game).
export async function install(chapter = 0) {
  const G = window.__game;
  await G.go(chapter);
  G.setQuality(0);
  G.game.mode = 'paused';
  for (const k in G.keys) G.keys[k] = false;
  const V3 = G.camera.position.constructor;
  const T = {
    ph: [new V3(), new V3()], pb: [new V3(), new V3()], was: [false, false],
    run(seconds, opts = {}) {
      const dt = opts.dt || 1 / 60, n = Math.round(seconds / dt);
      const w = G.warrior, st = w.state;
      const out = { maxSlide: 0, slideSum: 0, maxStretch: 0, pyMin: 9, pyMax: 0, steps: 0, states: {}, maxFloat: 0, maxSink: 0, speed: 0, dist: 0, maxTurn: 0, camJump: 0 };
      const x0 = G.P.pos.x, z0 = G.P.pos.z;
      let lastSwing = [w.feet[0].swing, w.feet[1].swing];
      let lastH = G.P.heading;
      const lastCam = G.camera.position.clone();
      for (let i = 0; i < n; i++) {
        if (opts.each) opts.each(i * dt, i);
        G.sim(1, dt);
        w.root.updateMatrixWorld(true);
        out.states[G.P.state] = (out.states[G.P.state] || 0) + 1;
        for (let k = 0; k < 2; k++) {
          const f = w.feet[k];
          const h = f.L.ankle.localToWorld(new V3(0, -0.075, 0.065)), b = f.L.ankle.localToWorld(new V3(0, -0.075, -0.115));
          const planted = !f.swing && st.free < 0.01;
          if (planted && this.was[k]) {
            const s = Math.min(Math.hypot(h.x - this.ph[k].x, h.z - this.ph[k].z), Math.hypot(b.x - this.pb[k].x, b.z - this.pb[k].z));
            out.maxSlide = Math.max(out.maxSlide, s);
            out.slideSum += s;
            const gh = G.area.def.groundHeight(h.x, h.z), gb = G.area.def.groundHeight(b.x, b.z);
            const low = Math.min(h.y - gh, b.y - gb);
            out.maxFloat = Math.max(out.maxFloat, low);
            out.maxSink = Math.max(out.maxSink, -low);
          }
          this.was[k] = planted;
          this.ph[k].copy(h);
          this.pb[k].copy(b);
          if (lastSwing[k] && !f.swing) out.steps++;
          lastSwing[k] = f.swing;
        }
        out.maxStretch = Math.max(out.maxStretch, st.stretch);
        out.pyMin = Math.min(out.pyMin, st.py);
        out.pyMax = Math.max(out.pyMax, st.py);
        const dh = Math.abs(Math.atan2(Math.sin(G.P.heading - lastH), Math.cos(G.P.heading - lastH))) / dt;
        out.maxTurn = Math.max(out.maxTurn, dh);
        lastH = G.P.heading;
        out.camJump = Math.max(out.camJump, G.camera.position.distanceTo(lastCam));
        lastCam.copy(G.camera.position);
      }
      out.speed = +G.P.speed.toFixed(2);
      out.dist = +Math.hypot(G.P.pos.x - x0, G.P.pos.z - z0).toFixed(2);
      for (const k of ['maxSlide', 'slideSum', 'maxStretch', 'pyMin', 'pyMax', 'maxFloat', 'maxSink', 'maxTurn', 'camJump']) out[k] = +out[k].toFixed(4);
      return out;
    },
    trace(n, every = 3) {
      const w = G.warrior, st = w.state, rows = [];
      for (let i = 0; i < n; i++) {
        G.sim(1, 1 / 60);
        if (i % every === 0) {
          rows.push([i, G.P.state, 'v' + G.P.speed.toFixed(2), 'h' + G.P.heading.toFixed(2), 'ph' + st.phase.toFixed(2), 'py' + st.py.toFixed(3), 'st' + st.stretch.toFixed(2),
            ...w.feet.map((f) => (f.swing ? 'S' + f.u.toFixed(2) : 'P') + ' x' + f.lx.toFixed(2) + ' z' + f.lz.toFixed(2) + ' ay' + f.ay.toFixed(2) + ' p' + f.apitch.toFixed(2))].join(' | '));
        }
      }
      return rows.join('\n');
    },
    keys(...on) {
      for (const k in G.keys) G.keys[k] = false;
      for (const k of on) G.keys[k] = true;
    },
    // draw one frame from a chosen side and return it as a small JPEG data URL
    shot(yawOff = Math.PI / 2, pitch = 0.08) {
      G.view(G.P.heading + yawOff, pitch);
      G.step(1, 0);
      return G.renderer.domElement.toDataURL('image/jpeg', 0.8);
    },
  };
  window.__T = T;
  return T;
}
