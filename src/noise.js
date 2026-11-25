// Deterministic noise helpers shared by terrain, textures and scatter.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix, iz) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const ux = smooth(x - ix), uz = smooth(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// Tileable variants: (x, z) are in lattice cells and wrap every `period` cells.
function vnoiseTile(x, z, period) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const ux = smooth(x - ix), uz = smooth(z - iz);
  const w = (v) => ((v % period) + period) % period;
  const x0 = w(ix), x1 = w(ix + 1), z0 = w(iz), z1 = w(iz + 1);
  const a = hash2(x0, z0), b = hash2(x1, z0), c = hash2(x0, z1), d = hash2(x1, z1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbmTile(x, z, period, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoiseTile(x * f + i * 5, z * f + i * 11, period * f);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export const lerp = (a, b, t) => a + (b - a) * t;
