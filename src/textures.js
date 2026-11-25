// Every texture in the game is painted here at load time on <canvas> —
// there are no image files. Swap these for photo-scanned textures later
// if you want to push the realism further.
import * as THREE from 'three';
import { fbm, fbmTile, hash2, mulberry32, clamp01 } from './noise.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c, { srgb = false, repeat = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// Height field (Float32Array, row 0 = canvas top) -> tangent-space normal map.
export function normalCanvas(H, w, h, strength, wrap = true) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = x < 0 ? 0 : x >= w ? w - 1 : x;
      y = y < 0 ? 0 : y >= h ? h - 1 : y;
    }
    return H[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * w + x) * 4;
      d[i] = (nx * il * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * il * 0.5 + 0.5) * 255;
      d[i + 2] = (il * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function paint(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x, y, out);
      const i = (y * w + x) * 4;
      d[i] = out[0] < 0 ? 0 : out[0] > 255 ? 255 : out[0];
      d[i + 1] = out[1] < 0 ? 0 : out[1] > 255 ? 255 : out[1];
      d[i + 2] = out[2] < 0 ? 0 : out[2] > 255 ? 255 : out[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---- sand -------------------------------------------------------------------
export function sandTextures(rgb = [214, 183, 134]) {
  const N = 512;
  const H = new Float32Array(N * N);
  const rng = mulberry32(11);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const n1 = fbmTile(u * 6, v * 6, 6, 4);
      const n2 = fbmTile(u * 48, v * 48, 48, 2);
      const rip = Math.sin((u * 22 + n1 * 2.5) * Math.PI * 2) * 0.5 + 0.5;
      H[y * N + x] = n1 * 0.55 + n2 * 0.18 + rip * 0.06;
    }
  }
  // scuffs and footprint-like pits
  for (let k = 0; k < 170; k++) {
    const px = rng() * N, py = rng() * N;
    const rx = 5 + rng() * 9, ry = rx * (0.6 + rng() * 0.6), dep = 0.05 + rng() * 0.09;
    const R = Math.ceil(Math.max(rx, ry));
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const q = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
        if (q >= 1) continue;
        const xx = (((px + dx) | 0) + N) % N, yy = (((py + dy) | 0) + N) % N;
        const f = 1 - q;
        H[yy * N + xx] -= dep * f * f * (1.2 - 0.6 * f);
      }
    }
  }
  const map = paint(N, N, (x, y, o) => {
    const u = x / N, v = y / N;
    const n1 = fbmTile(u * 6, v * 6, 6, 4);
    const n2 = fbmTile(u * 48, v * 48, 48, 2);
    const hh = H[y * N + x];
    let k = 0.78 + 0.3 * n1 + (n2 - 0.5) * 0.22 + (hh - 0.4) * 0.35;
    if (hash2(x * 3 + 1, y * 7 + 5) > 0.988) k *= 0.72;
    o[0] = rgb[0] * k;
    o[1] = rgb[1] * k;
    o[2] = rgb[2] * k;
  });
  return {
    map: toTexture(map, { srgb: true, aniso: 8 }),
    normalMap: toTexture(normalCanvas(H, N, N, 16), { aniso: 8 }),
  };
}

// ---- stone ------------------------------------------------------------------
function rockFields(N) {
  const H = new Float32Array(N * N);
  const C = new Float32Array(N * N * 3);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const n1 = fbmTile(u * 5, v * 5, 5, 5);
      const n2 = fbmTile(u * 26, v * 26, 26, 3);
      const li = fbmTile(u * 9 + 3, v * 9 + 1, 9, 3);
      const i = y * N + x;
      H[i] = n1 * 0.65 + n2 * 0.35 - (n2 < 0.3 ? (0.3 - n2) * 0.8 : 0);
      let k = 0.66 + 0.5 * n1 + (n2 - 0.5) * 0.3;
      let r = 150 * k + (n2 - 0.5) * 22, g = 133 * k, b = 112 * k;
      if (li > 0.66) {
        const t = clamp01((li - 0.66) * 4);
        r = r + (178 - r) * t * 0.6;
        g = g + (170 - g) * t * 0.6;
        b = b + (146 - b) * t * 0.6;
      }
      if (n2 < 0.27) {
        r *= 0.72;
        g *= 0.72;
        b *= 0.72;
      }
      C[i * 3] = r;
      C[i * 3 + 1] = g;
      C[i * 3 + 2] = b;
    }
  }
  return { H, C };
}

export function rockTextures() {
  const N = 512;
  const { H, C } = rockFields(N);
  const map = paint(N, N, (x, y, o) => {
    const i = (y * N + x) * 3;
    o[0] = C[i];
    o[1] = C[i + 1];
    o[2] = C[i + 2];
  });
  return {
    map: toTexture(map, { srgb: true }),
    normalMap: toTexture(normalCanvas(H, N, N, 9)),
  };
}

// Coursed ashlar for the temple: rock + mortar-less joints.
export function masonryTextures() {
  const N = 512, COURSE = 64, BLOCK = 128;
  const { H, C } = rockFields(N);
  const map = paint(N, N, (x, y, o) => {
    const row = Math.floor(y / COURSE);
    const off = Math.floor(hash2(row, 91) * BLOCK);
    const xx = (x + off) % N;
    const col = Math.floor(xx / BLOCK);
    const jx = Math.min(xx % BLOCK, BLOCK - (xx % BLOCK));
    const jy = Math.min(y % COURSE, COURSE - (y % COURSE));
    const j = Math.min(jx, jy);
    const tint = 0.86 + hash2(row * 13 + 3, col * 7 + 1) * 0.26;
    const joint = j < 2.2 ? 0.5 : j < 4.5 ? 0.82 : 1;
    const i = y * N + x;
    if (j < 3.2) H[i] -= 0.5 * (1 - j / 3.2);
    const k = tint * joint;
    o[0] = C[i * 3] * k;
    o[1] = C[i * 3 + 1] * k;
    o[2] = C[i * 3 + 2] * k;
  });
  return {
    map: toTexture(map, { srgb: true, aniso: 8 }),
    normalMap: toTexture(normalCanvas(H, N, N, 9), { aniso: 8 }),
  };
}

// ---- carved relief ----------------------------------------------------------
function person(g, x, y, s, lean, pose, sx = 1) {
  g.save();
  g.translate(x, y);
  g.scale(sx, 1);
  g.rotate(lean);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // legs
  g.lineWidth = s * 0.1;
  g.beginPath();
  g.moveTo(-s * 0.05, -s * 0.38);
  g.lineTo(-s * 0.12, -s * 0.18);
  g.lineTo(-s * 0.08, 0);
  g.moveTo(s * 0.05, -s * 0.38);
  g.lineTo(s * (0.1 + pose * 0.12), -s * 0.2);
  g.lineTo(s * (0.06 + pose * 0.2), -s * 0.02);
  g.stroke();
  // hips + torso
  g.beginPath();
  g.ellipse(0, -s * 0.4, s * 0.12, s * 0.09, 0, 0, Math.PI * 2);
  g.ellipse(0, -s * 0.58, s * 0.13, s * 0.17, 0, 0, Math.PI * 2);
  g.fill();
  // arms
  g.lineWidth = s * 0.065;
  g.beginPath();
  g.moveTo(-s * 0.12, -s * 0.68);
  g.lineTo(-s * 0.24, -s * (0.55 + pose * 0.25));
  g.lineTo(-s * 0.2, -s * (0.42 + pose * 0.5));
  g.moveTo(s * 0.12, -s * 0.68);
  g.lineTo(s * 0.25, -s * (0.6 - pose * 0.1));
  g.lineTo(s * 0.3, -s * (0.78 - pose * 0.3));
  g.stroke();
  // head + crown
  g.beginPath();
  g.arc(0, -s * 0.85, s * 0.1, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(-s * 0.08, -s * 0.92);
  g.lineTo(0, -s * 1.1);
  g.lineTo(s * 0.08, -s * 0.92);
  g.fill();
  g.restore();
}

function elephant(g, x, y, s, dir, sx = 1) {
  g.save();
  g.translate(x, y);
  g.scale(sx * dir, 1);
  g.lineCap = 'round';
  // legs
  for (const lx of [-0.42, -0.2, 0.18, 0.4]) g.fillRect(s * (lx - 0.08), -s * 0.45, s * 0.16, s * 0.45);
  // body
  g.beginPath();
  g.ellipse(0, -s * 0.62, s * 0.58, s * 0.34, 0, 0, Math.PI * 2);
  g.fill();
  // head + ear
  g.beginPath();
  g.arc(s * 0.6, -s * 0.72, s * 0.27, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(s * 0.42, -s * 0.7, s * 0.16, s * 0.24, 0.2, 0, Math.PI * 2);
  g.fill();
  // trunk
  g.lineWidth = s * 0.14;
  g.beginPath();
  g.moveTo(s * 0.78, -s * 0.68);
  g.quadraticCurveTo(s * 0.98, -s * 0.4, s * 0.86, -s * 0.08);
  g.stroke();
  // tail
  g.lineWidth = s * 0.04;
  g.beginPath();
  g.moveTo(-s * 0.56, -s * 0.7);
  g.lineTo(-s * 0.66, -s * 0.3);
  g.stroke();
  g.restore();
}

// The great open-air relief on the cliff (in the spirit of "Descent of the Ganges").
export function reliefTextures() {
  const W = 2048, Hh = 512;
  const SX = 0.6; // horizontal squash: texture is stretched over a long cliff
  const raw = makeCanvas(W, Hh);
  const g = raw.getContext('2d');
  g.fillStyle = '#5a5a5a';
  g.fillRect(0, 0, W, Hh);
  const rng = mulberry32(42);
  const cx = W * 0.5;
  const fig = '#c8c8c8';
  g.fillStyle = fig;
  g.strokeStyle = fig;

  // rows of figures, all leaning toward the central cleft
  const rows = [0.36, 0.5, 0.64, 0.78];
  rows.forEach((ry, ri) => {
    for (let x = W * 0.1; x < W * 0.9; x += 34 + rng() * 22) {
      const dxc = x - cx;
      if (Math.abs(dxc) < 34) continue;
      if (ri >= 2 && dxc > 40 && dxc < 380) continue; // elephants live here
      const s = 46 + rng() * 14;
      const flying = ri < 2;
      const lean = (flying ? 0.55 + rng() * 0.3 : rng() * 0.15) * (dxc > 0 ? -1 : 1);
      const shade = 170 + Math.floor(rng() * 60);
      g.fillStyle = g.strokeStyle = `rgb(${shade},${shade},${shade})`;
      person(g, x, Hh * ry + (rng() - 0.5) * 14, s, lean, rng(), SX * (dxc > 0 ? -1 : 1));
    }
  });
  // elephants
  g.fillStyle = g.strokeStyle = '#d6d6d6';
  elephant(g, cx + 250, Hh * 0.9, 150, -1, SX);
  g.fillStyle = g.strokeStyle = '#bdbdbd';
  elephant(g, cx + 110, Hh * 0.9, 80, -1, SX);
  // small animals along the base, left side
  g.fillStyle = g.strokeStyle = '#b4b4b4';
  for (let i = 0; i < 6; i++) elephant(g, cx - 120 - i * 95 - rng() * 30, Hh * 0.9, 30 + rng() * 14, 1, SX);
  // the cleft
  g.strokeStyle = '#161616';
  g.lineWidth = 16;
  g.beginPath();
  g.moveTo(cx, Hh * 0.08);
  for (let y = 0.08; y <= 1.0; y += 0.06) g.lineTo(cx + Math.sin(y * 21) * 7, Hh * y);
  g.stroke();
  // ledges between registers
  g.strokeStyle = '#444';
  g.lineWidth = 3;
  for (const ry of [0.42, 0.56, 0.7]) {
    g.beginPath();
    g.moveTo(W * 0.08, Hh * ry);
    for (let x = W * 0.08; x <= W * 0.92; x += 40) g.lineTo(x, Hh * ry + Math.sin(x * 0.03) * 3);
    g.stroke();
  }

  const soft = makeCanvas(W, Hh);
  const g2 = soft.getContext('2d');
  g2.filter = 'blur(1.6px)';
  g2.drawImage(raw, 0, 0);
  const px = g2.getImageData(0, 0, W, Hh).data;

  const H = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const f = px[(y * W + x) * 4] / 255;
      H[y * W + x] = f + fbm(x * 0.012, y * 0.02, 4) * 0.5 + fbm(x * 0.09, y * 0.09, 2) * 0.1;
    }
  }
  const map = paint(W, Hh, (x, y, o) => {
    const i = y * W + x;
    const f = px[i * 4] / 255;
    const gx = H[i] - H[i - 1 < 0 ? i : i - 1];
    const gy = H[i] - H[i - W < 0 ? i : i - W];
    const edge = clamp01(Math.hypot(gx, gy) * 5);
    const streak = fbm(x * 0.06, y * 0.004, 3);
    const mott = fbm(x * 0.015, y * 0.03, 4);
    let k = 0.58 + f * 0.5 + (mott - 0.5) * 0.4 - edge * 0.3 - clamp01(streak - 0.55) * 0.9;
    k = Math.max(0.25, k);
    o[0] = 196 * k;
    o[1] = 168 * k;
    o[2] = 130 * k;
  });
  return {
    map: toTexture(map, { srgb: true, repeat: false, aniso: 8 }),
    normalMap: toTexture(normalCanvas(H, W, Hh, 5, false), { repeat: false, aniso: 8 }),
  };
}

// One carved figure in a niche, used on the temple walls.
export function panelTextures() {
  const W = 128, Hh = 256;
  const raw = makeCanvas(W, Hh);
  const g = raw.getContext('2d');
  g.fillStyle = '#404040';
  g.fillRect(0, 0, W, Hh);
  g.fillStyle = g.strokeStyle = '#8a8a8a';
  g.fillRect(0, 0, W, 14);
  g.fillRect(0, Hh - 16, W, 16);
  g.fillRect(0, 0, 9, Hh);
  g.fillRect(W - 9, 0, 9, Hh);
  g.fillStyle = g.strokeStyle = '#d0d0d0';
  person(g, W * 0.5, Hh - 22, 190, 0, 0.55, 1.05);
  const soft = makeCanvas(W, Hh);
  const g2 = soft.getContext('2d');
  g2.filter = 'blur(1.4px)';
  g2.drawImage(raw, 0, 0);
  const px = g2.getImageData(0, 0, W, Hh).data;
  const H = new Float32Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) H[i] = px[i * 4] / 255 + fbm((i % W) * 0.08, Math.floor(i / W) * 0.08, 3) * 0.25;
  const map = paint(W, Hh, (x, y, o) => {
    const f = px[(y * W + x) * 4] / 255;
    const k = 0.42 + f * 0.62 + (fbm(x * 0.07, y * 0.07, 3) - 0.5) * 0.3;
    o[0] = 150 * k;
    o[1] = 132 * k;
    o[2] = 110 * k;
  });
  return {
    map: toTexture(map, { srgb: true, repeat: false }),
    normalMap: toTexture(normalCanvas(H, W, Hh, 4, false), { repeat: false }),
  };
}

// ---- cloth, water, sprites --------------------------------------------------
export function capeAlpha() {
  const W = 128, Hh = 256;
  const c = makeCanvas(W, Hh);
  const g = c.getContext('2d');
  const rng = mulberry32(5);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(6, 0);
  g.lineTo(W - 6, 0);
  g.lineTo(W - 2, Hh * 0.8);
  // ragged hem
  let x = W - 2;
  while (x > 2) {
    const step = 5 + rng() * 9;
    g.lineTo(x - step * 0.5, Hh * (0.82 + rng() * 0.18));
    x -= step;
    g.lineTo(x, Hh * (0.72 + rng() * 0.12));
  }
  g.lineTo(2, Hh * 0.8);
  g.closePath();
  g.fill();
  // tears and holes
  g.fillStyle = '#000';
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.ellipse(10 + rng() * (W - 20), Hh * (0.4 + rng() * 0.45), 1.5 + rng() * 3, 3 + rng() * 9, rng() * 0.6 - 0.3, 0, Math.PI * 2);
    g.fill();
  }
  const t = toTexture(c, { repeat: false });
  return t;
}

export function capeColor() {
  const W = 128, Hh = 256;
  const map = paint(W, Hh, (x, y, o) => {
    const fold = Math.sin(x * 0.42 + fbm(x * 0.05, y * 0.02, 2) * 5) * 0.5 + 0.5;
    const dirt = fbm(x * 0.05, y * 0.05, 3);
    const hem = clamp01((y / Hh - 0.6) * 2.2);
    const k = 0.62 + fold * 0.3 + (dirt - 0.5) * 0.4 - hem * 0.28;
    o[0] = 128 * k;
    o[1] = 46 * k;
    o[2] = 34 * k;
  });
  return toTexture(map, { srgb: true, repeat: false });
}

export function waterNormal() {
  const N = 256;
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) H[y * N + x] = fbmTile((x / N) * 8, (y / N) * 8, 8, 4);
  return toTexture(normalCanvas(H, N, N, 12));
}

export function softSprite() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c, { srgb: true, repeat: false });
}

export function flameSprite() {
  const c = makeCanvas(64, 96);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 62, 0, 32, 56, 34);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.25, 'rgba(255,200,90,0.95)');
  gr.addColorStop(0.6, 'rgba(255,110,20,0.5)');
  gr.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(32, 2);
  g.bezierCurveTo(52, 40, 58, 62, 32, 94);
  g.bezierCurveTo(6, 62, 12, 40, 32, 2);
  g.fill();
  return toTexture(c, { srgb: true, repeat: false });
}
