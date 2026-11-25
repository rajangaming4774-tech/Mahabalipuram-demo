// More textures: carvings cut from the reference footage, foliage cards,
// town materials and the warrior's gear.
import { makeCanvas, toTexture, normalCanvas, paint } from './textures.js';
import { fbm, fbmTile, hash2, mulberry32 } from './noise.js';

// ---- photo carvings ----------------------------------------------------------
// Six carved panels cut from the reference footage (assets/tex/panels.jpg, one row).
// The bump map is derived from the light and shade in the photo itself.
export const PANEL_CELLS = 6;
export const PANEL_GOOD = 5; // the last cell is weak, keep it off the walls
export async function panelAtlas() {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('missing assets/tex/panels.jpg'));
    i.src = './assets/tex/panels.jpg';
  });
  const W = img.width, Hh = img.height;
  const c = makeCanvas(W, Hh);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  // even out each panel toward a common stone tone so they sit together on one wall
  const id = g.getImageData(0, 0, W, Hh);
  const d = id.data;
  const cw = W / PANEL_CELLS;
  for (let k = 0; k < PANEL_CELLS; k++) {
    let sum = 0, n = 0;
    for (let y = 0; y < Hh; y += 4) for (let x = k * cw; x < (k + 1) * cw; x += 4) {
      const i = (y * W + (x | 0)) * 4;
      sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      n++;
    }
    const gain = 138 / (sum / n);
    for (let y = 0; y < Hh; y++) for (let x = k * cw; x < (k + 1) * cw; x++) {
      const i = (y * W + (x | 0)) * 4;
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * gain;
      // keep the shading of the photo, pull the hue toward neutral warm stone
      d[i] = l * 1.08 * 0.7 + d[i] * gain * 0.3;
      d[i + 1] = l * 0.98 * 0.7 + d[i + 1] * gain * 0.3;
      d[i + 2] = l * 0.84 * 0.7 + d[i + 2] * gain * 0.3;
    }
  }
  g.putImageData(id, 0, 0);
  const soft = makeCanvas(W, Hh);
  const g2 = soft.getContext('2d', { willReadFrequently: true });
  g2.filter = 'blur(1.2px)';
  g2.drawImage(c, 0, 0);
  const px = g2.getImageData(0, 0, W, Hh).data;
  const H = new Float32Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) H[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
  return {
    map: toTexture(c, { srgb: true, repeat: false, aniso: 8 }),
    normalMap: toTexture(normalCanvas(H, W, Hh, 3.2, false), { repeat: false, aniso: 8 }),
  };
}

// ---- sandstone ----------------------------------------------------------------
// Pale, even-grained stone for shrines cut from the living rock: soft mottling,
// faint bedding lines, a scatter of small pits. No masonry joints.
export function sandstoneTextures() {
  const N = 512;
  const H = new Float32Array(N * N);
  const map = paint(N, N, (x, y, o) => {
    const u = x / N, v = y / N;
    const n1 = fbmTile(u * 4, v * 4, 4, 4);
    const n2 = fbmTile(u * 30, v * 30, 30, 2);
    const bed = fbmTile(u * 2 + 7, v * 26, 26, 2);
    const pit = n2 < 0.24 ? (0.24 - n2) * 2.2 : 0;
    H[y * N + x] = n1 * 0.5 + n2 * 0.3 + bed * 0.12 - pit;
    const k = 0.84 + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.12 + (bed - 0.5) * 0.12 - pit * 0.5;
    const warm = (fbmTile(u * 3 + 2, v * 3 + 5, 3, 3) - 0.5) * 22;
    o[0] = (204 + warm) * k;
    o[1] = 188 * k;
    o[2] = (164 - warm * 0.6) * k;
  });
  return { map: toTexture(map, { srgb: true, aniso: 8 }), normalMap: toTexture(normalCanvas(H, N, N, 7), { aniso: 8 }) };
}

// The same pale stone laid as coursed ashlar blocks, for built walls and gateways.
export function ashlarTextures() {
  const N = 512, COURSE = 64, BLOCK = 128;
  const H = new Float32Array(N * N);
  const map = paint(N, N, (x, y, o) => {
    const u = x / N, v = y / N;
    const n1 = fbmTile(u * 4, v * 4, 4, 4);
    const n2 = fbmTile(u * 30, v * 30, 30, 2);
    const row = Math.floor(y / COURSE);
    const off = Math.floor(hash2(row, 91) * BLOCK);
    const xx = (x + off) % N;
    const ci = Math.floor(xx / BLOCK);
    const jx = Math.min(xx % BLOCK, BLOCK - (xx % BLOCK));
    const jy = Math.min(y % COURSE, COURSE - (y % COURSE));
    const j = Math.min(jx, jy);
    const pit = n2 < 0.24 ? (0.24 - n2) * 2.2 : 0;
    H[y * N + x] = n1 * 0.5 + n2 * 0.3 - pit - (j < 3.2 ? 0.55 * (1 - j / 3.2) : 0);
    const tint = 0.88 + hash2(row * 13 + 3, ci * 7 + 1) * 0.22;
    const joint = j < 2.2 ? 0.55 : j < 4.5 ? 0.85 : 1;
    const k = (0.84 + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.12 - pit * 0.5) * tint * joint;
    const warm = (hash2(row * 5 + 1, ci * 3 + 2) - 0.5) * 22;
    o[0] = (204 + warm) * k;
    o[1] = 188 * k;
    o[2] = (164 - warm * 0.6) * k;
  });
  return { map: toTexture(map, { srgb: true, aniso: 8 }), normalMap: toTexture(normalCanvas(H, N, N, 8), { aniso: 8 }) };
}

// ---- foliage (alpha-tested cards) -------------------------------------------
function leafShape(g, x, y, len, wid, ang, color) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(wid, -len * 0.45, 0, -len);
  g.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
  g.fill();
  g.restore();
}

export function leafTexture() {
  const N = 256;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const rng = mulberry32(77);
  for (let i = 0; i < 230; i++) {
    const a = rng() * Math.PI * 2, r = Math.pow(rng(), 0.6) * N * 0.44;
    const depth = i / 230; // later leaves sit on top and catch more light
    const l = 13 + depth * 26 + rng() * 9;
    leafShape(g, N / 2 + Math.cos(a) * r, N / 2 + Math.sin(a) * r, 20 + rng() * 14, 7 + rng() * 4, rng() * 6.28,
      `hsl(${82 + rng() * 28}, ${34 + rng() * 18}%, ${l}%)`);
  }
  return toTexture(c, { srgb: true, repeat: false });
}

// A feather palm frond: rib along the canvas height (base at the bottom).
export function frondTexture() {
  const W = 128, Hh = 512;
  const c = makeCanvas(W, Hh);
  const g = c.getContext('2d');
  const rng = mulberry32(31);
  g.lineCap = 'round';
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    const y = Hh - 14 - t * (Hh - 30);
    const len = (0.25 + 0.75 * Math.sin(Math.min(1, t * 1.25 + 0.1) * Math.PI * 0.86)) * W * 0.48;
    for (const sx of [-1, 1]) {
      g.strokeStyle = `hsl(${76 + rng() * 22}, ${40 + rng() * 15}%, ${24 + rng() * 22}%)`;
      g.lineWidth = 4.2 + rng() * 1.6;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + sx * len * 0.55, y - 4, W / 2 + sx * len, y + 12 + rng() * 10);
      g.stroke();
    }
  }
  g.strokeStyle = '#6b6a36';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W / 2, Hh);
  g.lineTo(W / 2, 8);
  g.stroke();
  return toTexture(c, { srgb: true, repeat: false });
}

// A palmyra fan leaf: stiff blades radiating from the bottom centre.
export function fanTexture() {
  const N = 256;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const rng = mulberry32(19);
  for (let i = 0; i < 34; i++) {
    const a = ((i / 33) - 0.5) * Math.PI * 1.25;
    const len = N * (0.72 + rng() * 0.2) * (1 - Math.abs(i / 33 - 0.5) * 0.35);
    g.save();
    g.translate(N / 2, N - 6);
    g.rotate(a);
    g.fillStyle = `hsl(${72 + rng() * 22}, ${36 + rng() * 14}%, ${25 + rng() * 20}%)`;
    g.beginPath();
    g.moveTo(-7, 0);
    g.lineTo(0, -len);
    g.lineTo(7, 0);
    g.fill();
    g.restore();
  }
  g.strokeStyle = '#5d5a30';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(N / 2, N);
  g.lineTo(N / 2, N - 40);
  g.stroke();
  return toTexture(c, { srgb: true, repeat: false });
}

// ---- town materials ---------------------------------------------------------
export function tileTextures() {
  const N = 256;
  const H = new Float32Array(N * N);
  const map = paint(N, N, (x, y, o) => {
    const row = Math.floor(y / 32);
    const xx = (x + (row % 2) * 16) % 32;
    const curve = Math.sin((xx / 32) * Math.PI);
    const lip = (y % 32) / 32;
    H[y * N + x] = curve * 0.8 + lip * 0.5;
    const n = fbm(x * 0.05, y * 0.05, 3);
    const k = 0.55 + curve * 0.35 + lip * 0.18 + (n - 0.5) * 0.5 + (hash2(row, Math.floor((x + (row % 2) * 16) / 32)) - 0.5) * 0.25;
    o[0] = 176 * k;
    o[1] = 92 * k;
    o[2] = 58 * k;
  });
  return { map: toTexture(map, { srgb: true }), normalMap: toTexture(normalCanvas(H, N, N, 5)) };
}

export function woodTextures() {
  const N = 256;
  const H = new Float32Array(N * N);
  const map = paint(N, N, (x, y, o) => {
    const gr = fbmTile((x / N) * 3, (y / N) * 40, 40, 3);
    const s = fbmTile((x / N) * 6 + 3, (y / N) * 6, 6, 3);
    H[y * N + x] = gr;
    const k = 0.5 + gr * 0.55 + (s - 0.5) * 0.3;
    o[0] = 122 * k;
    o[1] = 84 * k;
    o[2] = 52 * k;
  });
  return { map: toTexture(map, { srgb: true }), normalMap: toTexture(normalCanvas(H, N, N, 4)) };
}

// Striped, block-printed awning cloth.
export function clothTexture(base = [150, 52, 40], stripe = [214, 178, 96]) {
  const N = 128;
  const map = paint(N, N, (x, y, o) => {
    const band = (y % 32) < 6 || ((y % 32) > 14 && (y % 32) < 17);
    const dot = ((x % 16) - 8) ** 2 + ((y % 32) - 24) ** 2 < 9;
    const weave = 0.86 + ((x + y) % 2) * 0.06 + (fbm(x * 0.06, y * 0.06, 3) - 0.5) * 0.3;
    const cc = band || dot ? stripe : base;
    o[0] = cc[0] * weave;
    o[1] = cc[1] * weave;
    o[2] = cc[2] * weave;
  });
  return toTexture(map, { srgb: true });
}

// ---- the warrior's gear -------------------------------------------------------
// Embossed bronze: scrollwork height field -> colour + normal map.
export function armorTextures() {
  const N = 256;
  const raw = makeCanvas(N, N);
  const g = raw.getContext('2d');
  g.fillStyle = '#3a3a3a';
  g.fillRect(0, 0, N, N);
  g.strokeStyle = '#d8d8d8';
  g.lineCap = 'round';
  const scroll = (cx, cy, r, dir) => {
    g.beginPath();
    for (let t = 0; t < 5.2; t += 0.15) {
      const rr = r * (1 - t / 6.5);
      const px = cx + Math.cos(t * dir) * rr, py = cy + Math.sin(t * dir) * rr;
      if (t === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  };
  g.lineWidth = 7;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) scroll(32 + i * 64, 32 + j * 64, 26, (i + j) % 2 ? 1 : -1);
  g.lineWidth = 4;
  for (let j = 0; j <= 4; j++) {
    g.beginPath();
    g.moveTo(0, j * 64);
    g.lineTo(N, j * 64);
    g.stroke();
  }
  g.fillStyle = '#f0f0f0';
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(i * 64, j * 64, 6, 0, 7);
    g.fill();
  }
  const soft = makeCanvas(N, N);
  const g2 = soft.getContext('2d');
  g2.filter = 'blur(1.6px)';
  g2.drawImage(raw, 0, 0);
  const px = g2.getImageData(0, 0, N, N).data;
  const H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H[i] = px[i * 4] / 255;
  const map = paint(N, N, (x, y, o) => {
    const f = H[y * N + x];
    const k = 0.5 + f * 0.6 + (fbm(x * 0.09, y * 0.09, 3) - 0.5) * 0.25;
    o[0] = 205 * k;
    o[1] = 150 * k;
    o[2] = 84 * k;
  });
  return { map: toTexture(map, { srgb: true }), normalMap: toTexture(normalCanvas(H, N, N, 6)) };
}

// The round shield carried on the back: dark blued steel, bronze rim, boss and studs.
export function shieldTexture() {
  const N = 256;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const m = N / 2;
  g.fillStyle = '#10151f';
  g.fillRect(0, 0, N, N);
  const rg = g.createRadialGradient(m, m, 10, m, m, m);
  rg.addColorStop(0, '#3b4a66');
  rg.addColorStop(0.75, '#1d2638');
  rg.addColorStop(1, '#10151f');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(m, m, m - 2, 0, 7);
  g.fill();
  const ring = (r, w, col) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.arc(m, m, r, 0, 7);
    g.stroke();
  };
  ring(m - 9, 14, '#b08a48');
  ring(m - 18, 2, '#5d4520');
  ring(m * 0.62, 5, '#a8823f');
  ring(m * 0.3, 7, '#c29a52');
  g.fillStyle = '#c9a25a';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.beginPath();
    g.arc(m + Math.cos(a) * m * 0.62, m + Math.sin(a) * m * 0.62, 15, 0, 7);
    g.fill();
  }
  g.strokeStyle = '#8f6f37';
  g.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * m * 0.34, m + Math.sin(a) * m * 0.34);
    g.quadraticCurveTo(m + Math.cos(a + 0.2) * m * 0.48, m + Math.sin(a + 0.2) * m * 0.48, m + Math.cos(a) * m * 0.58, m + Math.sin(a) * m * 0.58);
    g.stroke();
  }
  return toTexture(c, { srgb: true, repeat: false });
}

// Beacon sprite: a soft vertical beam that fades out toward the top.
export function beamSprite() {
  const c = makeCanvas(64, 256);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const gv = g.createLinearGradient(0, 0, 0, 256);
  gv.addColorStop(0, 'rgba(0,0,0,0)');
  gv.addColorStop(0.6, 'rgba(0,0,0,0.7)');
  gv.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gv;
  g.fillRect(0, 0, 64, 256);
  return toTexture(c, { srgb: true, repeat: false });
}
