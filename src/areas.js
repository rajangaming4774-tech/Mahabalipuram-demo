// The four playable areas, each built to match one of the reference clips:
//   road      - the temple road at golden hour (gateways, market, great temple)
//   rathas    - the Pancha Rathas, monolithic shrines on wet sand, a carved hall to walk through
//   shore     - the flagstone walk to the Shore Temple, surf on the right
//   headland  - the grassy cliff at sunset, the temple below on its rock in the sea
import * as THREE from 'three';
import { makeEnv, createSky, createSun, createTerrain, createOcean, createSpray, sprayEmitters } from './environment.js';
import { createTemple, createCliff, DOOR, StoneBuilder, vimana, dome } from './temple.js';
import { createPath, createWalls, createRocks, createVegetation, createLamps } from './props.js';
import * as K from './kit.js';
import { setWorld, shoreDef, newColliders, addBox, addCircle } from './world.js';
import { fbm, smoothstep, clamp01, lerp, mulberry32 } from './noise.js';

const PI = Math.PI;

// Everything an area needs every frame, gathered into one tick().
function finish(A) {
  const env = A.env;
  A.uTime = A.uTime || { value: 0 };
  A.tick = (dt, t, player, camPos) => {
    A.sky.uniforms.uTime.value = t;
    A.sky.dome.position.copy(camPos);
    A.uTime.value = t;
    if (A.ocean) A.ocean.uniforms.uTime.value = t;
    if (A.spray) A.spray.update(dt);
    if (A.fires) A.fires.update(t, player);
    if (A.dust) A.dust.update(dt, t, player);
    if (A.birds) A.birds.update(t);
    A.lampSys.update(t, player);
    A.beacon.update(dt, t);
    A.sunRig.follow(player);
  };
  A.env = env;
  return A;
}

function begin(ctx, def, env) {
  setWorld(def);
  const scene = new THREE.Scene();
  const sky = createSky(ctx.renderer, scene, env);
  const sunRig = createSun(scene, env);
  return { scene, def, env, sky, sunRig, uTime: { value: 0 } };
}

// A tower with an entrance hall on its +Z side. Returns the z of the doorstep.
function greatTemple(b, x, z, y0, S, wallH, tiers, niches) {
  vimana(b, x, z, y0, S, wallH, tiers, niches);
  const hb = S / 2 + 0.8;
  addBox(x - hb, x + hb, z - hb, z + hb);
  const mw = S * 0.74, mh = wallH + 0.2, md = S * 0.7;
  const mz = z + S / 2 + md / 2;
  b.box(mw + 1.0, 0.5, md + 0.6, x, y0, mz, 0.86);
  b.box(mw, mh, md, x, y0 + 0.5, mz, 0.97);
  b.box(mw + 1.1, 0.32, md + 1.1, x, y0 + 0.5 + mh, mz, 0.86, 0.6);
  b.box(mw + 0.5, 0.3, md + 0.5, x, y0 + 0.82 + mh, mz, 0.92);
  const fz = mz + md / 2;
  for (const px of [-0.44, -0.2, 0.2, 0.44]) b.box(0.44, mh, 0.32, x + px * mw, y0 + 0.5, fz + 0.1, 1.05, 0.8);
  b.box(2.2, mh * 0.78, 0.16, x, y0 + 0.5, fz + 0.02, 0.06, 1); // dark doorway
  b.box(2.8, 0.32, 0.32, x, y0 + 0.5 + mh * 0.8, fz + 0.12, 1.0);
  for (let i = 0; i < 3; i++) b.box(3.6 - i * 0.3, 0.17, 0.5, x, y0 + i * 0.17, fz + 1.3 - i * 0.45, 0.92, 0.9);
  for (const sx of [-1, 1]) {
    niches.push({ x: x + sx * mw * 0.32, y: y0 + 1.0, z: fz + 0.012, ry: 0, w: 1.0, h: mh * 0.62 });
    for (const dz of [-0.25, 0.25]) niches.push({ x: x + sx * (mw / 2 + 0.012), y: y0 + 1.0, z: mz + dz * md, ry: (sx * PI) / 2, w: 1.0, h: mh * 0.62 });
  }
  addBox(x - mw / 2 - 0.4, x + mw / 2 + 0.4, mz - md / 2, fz + 0.2);
  return fz;
}

// =============================================================================
// 1. THE TEMPLE ROAD
// =============================================================================
export function buildRoad(ctx) {
  const { T } = ctx;
  const paved = (x, z) =>
    (Math.abs(x) < 4.7 && z > -40 && z < 72) || (Math.abs(x) < 20.4 && z <= -40 && z > -91.5) || (Math.abs(x) < 7 && z > -18 && z < 16);
  const def = {
    name: 'road', colliders: newColliders(), terrain: { size: 320, cx: 0, cz: -10, seg: 128 },
    terrainHeight: (x, z) => {
      const w = z < -37 ? 24 : 9.5;
      return (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 1.8 * smoothstep(w, w + 14, Math.abs(x));
    },
    landDist: () => 60,
    flatness: (x) => 1 - smoothstep(6, 12, Math.abs(x)),
    walkable: (x, z) => Math.abs(x) < 46 && z < 74 && z > -95,
  };
  def.groundHeight = (x, z) => def.terrainHeight(x, z) + (paved(x, z) ? 0.08 : 0);

  const env = makeEnv({
    sunDir: [0.56, 0.3, -0.74], sun: '#ffd9a6', light: '#ffc98a', lightIntensity: 3.7,
    horizon: '#f0dcb4', zenith: '#5f8fc9', fog: '#e6d6b6', fogDensity: 0.0042, glow: '#ffb060',
    cloudCover: 0.57, cloudLit: '#fff0d6', cloudBase: '#b9b3b0', cloudDark: '#8a8490',
    hemiSky: '#bcd0e6', hemiGround: '#9a7850', hemiIntensity: 0.5, exposure: 0.95, bloom: 0.3, rays: 0.75,
    grade: [1.07, 1.0, 0.9], saturation: 1.12, shadowRange: 50,
  });
  const A = begin(ctx, def, env);
  const { scene } = A;
  const rng = mulberry32(101);

  // ground: dusty earth along the road, turf further out
  const earth = new THREE.Color('#cdbb9a'), turf = new THREE.Color('#6f7f42');
  createTerrain(scene, T.sand, (x, z, h, c) => {
    const g = smoothstep(0.42, 0.62, fbm(x * 0.07 + 3, z * 0.07, 3)) * smoothstep(5.5, 9, Math.abs(x) - (z < -38 ? 16 : 0));
    c.copy(earth).lerp(turf, g * 0.85).multiplyScalar(0.84 + fbm(x * 0.09, z * 0.09, 3) * 0.3);
    return 0;
  }, 4);
  K.createPaving(scene, T.sandstone, [
    { x0: -4.7, x1: 4.7, z0: -40, z1: 72, ragged: 0.3 },
    { x0: -7, x1: -4.7, z0: -18, z1: 16, ragged: 0.4 },
    { x0: 4.7, x1: 7, z0: -18, z1: 16, ragged: 0.4 },
    { x0: -20.4, x1: 20.4, z0: -91.5, z1: -40, ragged: 0.1 },
  ], { seed: 4, color: '#d8d2c8', bright: 1.0 });

  const b = new StoneBuilder(11), bs = new StoneBuilder(12), niches = [];
  const batch = new K.Batch();
  // wayside benches: one by the road near the start, one in the temple court
  const benches = [{ x: 5.5, z: 58, yaw: PI / 2 }, { x: 12, z: -41.05, yaw: 0 }];
  const offBench = (x, z) => benches.every((s) => Math.hypot(x - s.x, z - s.z) > 1.5);
  A.seats = K.createSeats(scene, T.ashlar, '#e6dccb', benches);

  // -- the approach: low plinth walls, roadside shrines, stone elephants
  for (const sx of [-1, 1]) {
    K.wallRun(b, sx * 6.3, 68, sx * 6.3, 51, 0, 1.1, 0.8);
    K.wallRun(b, sx * 6.3, 41, sx * 6.3, 26, 0, 1.1, 0.8);
    K.wallRun(b, sx * 6.3, -21, sx * 6.3, -35, 0, 1.2, 0.8);
    for (const ez of [31, -29.5]) {
      b.box(2.4, 0.8, 3.8, sx * 8.6, 0, ez, 0.9);
      b.box(2.8, 0.2, 4.2, sx * 8.6, 0, ez, 0.84);
      K.elephant(bs, sx * 8.6, 0.8, ez, PI, 1.0);
    }
  }
  K.shrine(b, -12.6, 54, 0, 4.2, 1, niches);
  K.shrine(b, 12.8, 45, 0, 5.0, 2, niches, 2.8);

  // -- first gateway and its walls
  K.gateway(b, 0, 20, 0, { open: 4.6, pier: 3.6, depth: 3.2, h: 5.4, niches });
  for (const sx of [-1, 1]) K.wallRun(b, sx * 6.4, 20, sx * 36, 20, 0, 3.0, 0.9);

  // -- the market
  K.stall(batch, -8.6, 8, PI / 2, 'clothA', 1);
  K.stall(batch, -8.6, -5, PI / 2, 'clothB', 2);
  K.stall(batch, 8.6, 2.5, -PI / 2, 'clothB', 3);
  K.stall(batch, 8.6, -10.5, -PI / 2, 'clothA', 4);
  K.pots(batch, [[5.9, 14.2, 1.25], [6.6, 13.3, 0.9], [5.2, 13.2, 0.7], [-6.0, 14.6, 1.1], [-6.4, -15.4, 1.2], [-5.6, -16.2, 0.8], [6.2, -17, 1.0]]);
  const fireSpots = [K.brazier(batch, 3.7, 16.4), K.brazier(batch, -3.7, 16.4), K.brazier(batch, 4.3, -36.4), K.brazier(batch, -4.3, -36.4)];

  // -- second gateway, the temple court and the great temple
  K.gateway(b, 0, -40, 0, { open: 5.2, pier: 4.2, depth: 3.6, h: 6.6, niches });
  for (const sx of [-1, 1]) {
    K.wallRun(b, sx * 7.4, -40, sx * 36, -40, 0, 3.6, 0.9);
    K.wallRun(b, sx * 21, -41, sx * 21, -92, 0, 3.0, 0.9);
    K.shrine(b, sx * 14.5, -66, 0, 5.0, 2, niches, 2.8);
  }
  K.wallRun(b, -21, -92, 21, -92, 0, 3.0, 0.9);
  const doorZ = greatTemple(b, 0, -76, 0, 10, 4.6, 5, niches);
  b.box(2.6, 0.7, 3.6, 0, 0, -50, 0.9);
  K.bull(bs, 0, 0.7, -50, 0, 1.15);
  // towers on the skyline beyond the walls
  for (const [x, z, S, wh, tiers] of [[-38, -62, 7.5, 4, 4], [37, -86, 8.5, 4.4, 4], [-31, 4, 6, 3.4, 3], [31, 36, 5.5, 3.2, 3]]) {
    vimana(b, x, z, 0, S, wh, tiers, null);
    addBox(x - S / 2 - 0.8, x + S / 2 + 0.8, z - S / 2 - 0.8, z + S / 2 + 0.8);
  }

  K.stoneMesh(scene, b, T.ashlar, '#e6dccb', 1.3);
  K.stoneMesh(scene, bs, T.sandstone, '#e6dccb', 1.1);
  ctx.panels('#dccbb0')(scene, niches);
  batch.build(scene, K.marketMaterials(T));
  A.fires = K.createFires(scene, T.sprite, T.flame, fireSpots);

  // -- planting
  K.createTrees(scene, T, [
    { x: -14.5, z: 38, k: 1.55 }, { x: 14, z: 62, k: 1.3 }, { x: -16, z: -1, k: 1.45 }, { x: 16, z: -25, k: 1.35 },
    { x: -18, z: 68, k: 1.15 }, { x: 25, z: 9, k: 1.5 }, { x: -27, z: -30, k: 1.4 }, { x: 29, z: -52, k: 1.35 }, { x: -30, z: 30, k: 1.5 },
  ], A.uTime);
  const palms = [];
  for (const [x, z, h] of [[-9.6, 59, 9], [9.2, 53, 10.5], [-10.4, 24.5, 11], [10.8, 26, 9.5], [-12.5, -19, 10], [11.4, -23, 11.5], [-19, 46, 12],
    [19.5, 38, 10], [-24, -12, 11], [22.5, -33, 12], [-27, -66, 13], [27.5, -72, 12], [-23, 12, 10], [20, 58, 11], [-33, -44, 12], [33, -20, 11], [-25, -88, 12], [26, -96, 13]]) palms.push({ x, z, h });
  K.createPalms(scene, T, palms, A.uTime, 'coconut', 83);
  const bushes = [], plants = [], grass = [];
  for (let i = 0; i < 70; i++) {
    const z = 70 - rng() * 108, sx = rng() < 0.5 ? -1 : 1;
    if (Math.abs(z - 20) < 3) continue;
    bushes.push({ x: sx * (7.4 + rng() * 5), z, k: 0.6 + rng() * 0.8 });
  }
  for (let i = 0; i < 40; i++) {
    const z = 70 - rng() * 106, sx = rng() < 0.5 ? -1 : 1;
    if (z < 17 && z > -19) continue;
    plants.push({ x: sx * (7.2 + rng() * 2.2), z, k: 2.4 + rng() * 2.2, tall: 1.5 });
  }
  for (let i = 0; i < 60; i++) {
    const pl = { x: (rng() < 0.5 ? -1 : 1) * (5.2 + rng() * 0.8), z: 70 - rng() * 108, k: 0.8 + rng() };
    if (offBench(pl.x, pl.z)) plants.push(pl);
  }
  for (let i = 0; i < 9000 && grass.length < 2600; i++) {
    const x = (rng() - 0.5) * 70, z = 72 - rng() * 112;
    if (Math.abs(x) < 5.4 || (z < 16 && z > -18 && Math.abs(x) < 11)) continue;
    if (rng() > 0.25 + smoothstep(0.4, 0.6, fbm(x * 0.07 + 3, z * 0.07, 3))) continue;
    grass.push({ x, z, k: 0.7 + rng() * 0.9, dry: rng() });
  }
  K.createBushes(scene, T, bushes, A.uTime);
  K.scatterPlants(scene, A.uTime, plants);
  K.scatterGrass(scene, A.uTime, grass);
  const rocks = [];
  for (let i = 0; i < 70; i++) {
    const rk = { x: (rng() < 0.5 ? -1 : 1) * (5.1 + rng() * 3), z: 70 - rng() * 108, k: 0.12 + rng() * 0.3 };
    if (offBench(rk.x, rk.z)) rocks.push(rk);
  }
  K.scatterRocks(scene, T.rock, rocks, '#c2b8a8', 23);
  K.createPuddles(scene, [[1.6, 50, 0.9], [-2.2, 33, 1.1], [2.4, -24, 0.8]], 0.086);

  A.lampSys = createLamps(scene, T.rock, T.sprite, T.flame, [[4.05, 46], [-4.05, 25.5], [4.05, -14.5], [-4.05, -31]]);
  A.beacon = K.createBeacon(scene, T.beam, T.sprite, 0, doorZ + 3.2);
  A.dust = K.createDust(scene, T.sprite, '#ffdca0');
  A.birds = K.createBirds(scene, 0, -20, 32);
  A.start = { x: 0.3, z: 65, yaw: 0 };
  A.enemies = []; // peaceful: no raiders
  A.goalText = 'Enter the great temple';
  return finish(A);
}

// =============================================================================
// 2. THE PANCHA RATHAS
// =============================================================================
export function buildRathas(ctx) {
  const { T } = ctx;
  // the carved hall you walk through: a plinth with steps at both ends
  const PY = 0.9, HH = 3.7, CX0 = 1.4, CX1 = 4.6;
  const hallHeight = (x, z) => {
    if (x > CX0 - 0.12 && x < CX1 + 0.12) {
      const az = Math.abs(z);
      if (az <= 6) return PY;
      if (az < 8.2) return PY * (1 - (az - 6) / 2.2);
    }
    return 0;
  };
  const puddles = [[-2.5, 31, 1.5], [6.5, 24, 1.2], [-3.2, 17, 1.0], [9, 9.5, 1.3], [-4.5, 5.5, 0.9], [0.4, 12.6, 1.1], [8.6, -11, 1.2], [-1.5, -19, 1.0], [12, -30, 1.3], [3.2, 34, 0.8]];
  const def = {
    name: 'rathas', colliders: newColliders(), terrain: { size: 300, cx: 0, cz: 0, seg: 128 },
    terrainHeight: (x, z) => {
      const out = smoothstep(24, 44, Math.max(Math.abs(x), Math.abs(z) - 22));
      return (fbm(x * 0.07, z * 0.07, 3) - 0.5) * (0.14 + out * 2.2);
    },
    landDist: () => 60,
    flatness: (x, z) => 1 - smoothstep(18, 26, Math.max(Math.abs(x), Math.abs(z) - 20)),
    walkable: (x, z) => Math.abs(x) < 40 && z < 52 && z > -50,
    ceilingAt: (x, z) => (x > CX0 - 0.3 && x < CX1 + 0.3 && Math.abs(z) < 6.5 ? PY + HH - 0.2 : Infinity),
  };
  def.groundHeight = (x, z) => Math.max(def.terrainHeight(x, z), hallHeight(x, z));

  const env = makeEnv({
    sunDir: [-0.5, 0.74, 0.34], sun: '#fff3dc', light: '#fff0d8', lightIntensity: 3.5,
    horizon: '#e6e6e0', zenith: '#5c92cf', fog: '#e2e0d6', fogDensity: 0.0044, glow: '#fff0d0',
    cloudCover: 0.56, cloudLit: '#ffffff', cloudLitBoost: 1.25, cloudBase: '#d9d9dc', cloudDark: '#9a9ea8',
    hemiSky: '#c6d9ee', hemiGround: '#a88c68', hemiIntensity: 0.55, exposure: 0.9, bloom: 0.36, rays: 0.3,
    grade: [1.04, 1.0, 0.94], saturation: 1.08, shadowRange: 44,
  });
  const A = begin(ctx, def, env);
  const { scene } = A;
  const rng = mulberry32(202);

  // ground: pale sand, darker and glossy where rain has pooled
  const sand = new THREE.Color('#ead9bc'), damp = new THREE.Color('#9a8263'), turf = new THREE.Color('#77834a');
  createTerrain(scene, T.sand, (x, z, h, c) => {
    let w = 0;
    for (const [px, pz, r] of puddles) w = Math.max(w, 1 - smoothstep(r * 1.1, r * 2.6, Math.hypot(x - px, z - pz)));
    const g = smoothstep(0.5, 0.64, fbm(x * 0.06 + 9, z * 0.06, 3)) * smoothstep(17, 24, Math.max(Math.abs(x), Math.abs(z) - 22));
    c.copy(sand).lerp(turf, g * 0.8).lerp(damp, w * 0.8).multiplyScalar(0.86 + fbm(x * 0.08, z * 0.08, 3) * 0.28);
    return w * 0.75;
  }, 4);
  K.createPuddles(scene, puddles, 0.035, 9);

  // every shrine here is cut from the living rock: plain stone, no masonry joints
  const bm = new StoneBuilder(21), niches = [];
  const Y0 = -0.12;

  // Draupadi: a small hut with a sweeping thatch-like roof
  bm.box(4.6, 0.5, 4.6, -9.5, Y0, 27, 0.86);
  bm.box(3.6, 2.6, 3.6, -9.5, Y0 + 0.5, 27, 0.98);
  bm.box(1.1, 1.9, 0.14, -9.5 + 1.82, Y0 + 0.5, 27, 0.08, 1);
  const hut = [];
  for (let i = 0; i <= 8; i++) hut.push(new THREE.Vector2(2.75 * Math.pow(1 - i / 8, 1.5) + 0.14, 2.3 * (i / 8)));
  bm.solid(new THREE.LatheGeometry(hut, 4), -9.5, Y0 + 3.1, 27, 0.92, PI / 4);
  bm.solid(new THREE.ConeGeometry(0.2, 0.5, 6), -9.5, Y0 + 5.6, 27, 0.85);
  addBox(-11.9, -7.1, 24.6, 29.4);
  for (const [dx, dz, ry] of [[0, 1.815, 0], [0, -1.815, PI], [-1.815, 0, -PI / 2]]) niches.push({ x: -9.5 + dx, y: Y0 + 0.75, z: 27 + dz, ry, w: 1.2, h: 2.1 });

  K.shrine(bm, -9.5, 15, Y0, 4.6, 2, niches, 2.6); // Arjuna
  K.shrine(bm, -11, -3, Y0, 4.2, 2, niches, 2.5); // Nakula-Sahadeva
  K.shrine(bm, 3.5, -27, Y0, 7.6, 3, niches, 3.4); // Dharmaraja, the tallest

  // Bhima: the long hall, open at both ends, carved inside and out
  bm.box(9.6, 0.4, 13.0, 3, Y0, 0, 0.84);
  bm.box(8.6, PY - Y0, 12, 3, Y0, 0, 0.92, 0.85);
  for (const [cxw, inner, sgn] of [[0.05, CX0, 1], [5.95, CX1, -1]]) {
    bm.box(2.7, HH, 12, cxw, PY, 0, 0.98);
    for (const pz of [-5.75, -2.9, 0, 2.9, 5.75]) {
      bm.box(0.2, HH, 0.36, inner + sgn * 0.08, PY, pz, 1.06, 0.8);
      bm.box(0.2, HH, 0.36, cxw - sgn * 1.4, PY, pz, 1.06, 0.8);
    }
    bm.box(0.22, 0.3, 12, inner + sgn * 0.09, PY, 0, 0.9);
    for (const pz of [-4.3, -1.45, 1.45, 4.3]) {
      niches.push({ x: inner + sgn * 0.016, y: PY + 0.4, z: pz, ry: (sgn * PI) / 2, w: 1.75, h: 2.95 });
      niches.push({ x: cxw - sgn * 1.366, y: PY + 0.5, z: pz, ry: (-sgn * PI) / 2, w: 1.4, h: 2.6 });
    }
    addBox(cxw - 1.35, cxw + 1.35, -6, 6);
  }
  bm.box(9.5, 0.5, 13.0, 3, PY + HH, 0, 0.86, 0.6);
  bm.box(8.9, 0.3, 12.4, 3, PY + HH + 0.5, 0, 0.94);
  const barrel = new THREE.CylinderGeometry(3.7, 3.7, 11.4, 16, 1, false, 0, PI);
  barrel.rotateZ(PI / 2);
  barrel.rotateY(PI / 2);
  barrel.scale(1, 0.62, 1);
  bm.solid(barrel, 3, PY + HH + 0.8, 0, 0.92);
  for (const sg of [1, -1]) {
    const cap = new THREE.CircleGeometry(3.7, 16, 0, PI);
    cap.scale(1, 0.62, 1);
    if (sg < 0) cap.rotateY(PI);
    bm.solid(cap, 3, PY + HH + 0.8, sg * 5.7, 0.86);
    niches.push({ x: 3, y: PY + HH + 0.95, z: sg * 5.72, ry: sg > 0 ? 0 : PI, w: 1.1, h: 1.6 });
    // steps with sloping side blocks
    for (let k = 0; k < 4; k++) bm.box(3.2, PY - (k + 1) * 0.18 - Y0, 0.46, 3, Y0, sg * (6.23 + k * 0.44), 0.94, 0.9);
    for (const bx of [1.1, 4.9]) {
      bm.box(0.42, 1.3 - Y0, 1.1, bx, Y0, sg * 6.55, 0.97);
      bm.box(0.42, 0.75 - Y0, 1.2, bx, Y0, sg * 7.7, 0.95);
      addBox(bx - 0.22, bx + 0.22, sg > 0 ? 6 : -8.3, sg > 0 ? 8.3 : -6, 1.6);
    }
    for (const px of [1.78, 4.22]) {
      K.pillar(bm, px, PY, sg * 5.35, HH - 0.34, 0.46);
      addCircle(px, sg * 5.35, 0.3);
    }
  }
  for (let i = 0; i < 7; i++) { // little shrines along the eaves
    for (const ex of [-1.55, 7.55]) {
      const pz = -5.4 + i * 1.8;
      bm.box(0.7, 0.45, 0.9, ex, PY + HH + 0.5, pz, 0.95);
      bm.solid(dome(0.42), ex, PY + HH + 0.95, pz, 0.9, PI / 8);
    }
  }

  // the free-standing animals
  bm.box(3.0, 0.5, 4.6, -5.5, Y0, -15, 0.88);
  K.elephant(bm, -5.5, Y0 + 0.5, -15, PI, 1.3);
  bm.box(2.4, 0.4, 3.2, 11.5, Y0, 14, 0.88);
  K.bull(bm, 11.5, Y0 + 0.4, 14, PI / 2, 1.25);
  // a low wall around the compound, open to the south
  K.wallRun(bm, -23, 44, -23, -43, Y0, 1.3, 0.8);
  K.wallRun(bm, 23, 44, 23, -43, Y0, 1.3, 0.8);
  K.wallRun(bm, -23, -43, 23, -43, Y0, 1.3, 0.8);

  K.stoneMesh(scene, bm, T.sandstone, '#ece2d0', 1.15);
  ctx.panels('#e2d2ba')(scene, niches);
  // benches: one looking down the compound from near the start, one facing the long hall
  A.seats = K.createSeats(scene, T.sandstone, '#ece2d0', [{ x: 7.5, z: 37.5, yaw: 0 }, { x: 10.6, z: 2, yaw: PI / 2 }], 1.15);

  // worn slabs and cobbles lying in the sand
  const clear = (x, z) => !(x > -2.2 && x < 8.2 && Math.abs(z) < 9) && def.colliders.boxes.every((bx) => x < bx.minX - 0.6 || x > bx.maxX + 0.6 || z < bx.minZ - 0.6 || z > bx.maxZ + 0.6);
  K.createPaving(scene, T.sandstone, [{ x0: -6, x1: 15, z0: -40, z1: 42, ragged: 0.5, keep: (x, z) => fbm(x * 0.13, z * 0.13, 2) > 0.54 && clear(x, z) }], { seed: 14, color: '#ddd6ca', bright: 1.0 });
  const cobbles = [];
  for (let i = 0; i < 5000 && cobbles.length < 900; i++) {
    const x = -16 + rng() * 34, z = -40 + rng() * 84;
    if (fbm(x * 0.16 + 4, z * 0.16, 2) < 0.52 || !clear(x, z)) continue;
    cobbles.push({ x, z, k: 0.03 + rng() * 0.07, sink: 0.25 });
  }
  K.scatterRocks(scene, T.rock, cobbles, '#cfc6b8', 24, 1);
  const stones = [];
  for (let i = 0; i < 14; i++) {
    const x = -20 + rng() * 40, z = -40 + rng() * 84;
    if (clear(x, z)) stones.push({ x, z, k: 0.2 + rng() * 0.35 });
  }
  K.scatterRocks(scene, T.rock, stones, '#d6ccbc', 25);

  // palmyra palms and shade trees beyond the wall
  const palms = [], trees = [], bushes = [], grass = [];
  for (let i = 0; i < 46; i++) {
    const a = rng() * 6.28, r = 27 + rng() * 26;
    palms.push({ x: Math.cos(a) * r * 0.95, z: Math.sin(a) * r * 1.35, h: 8 + rng() * 6 });
  }
  for (const [x, z, h] of [[-18, 34, 10], [17, 30, 9], [-19, -8, 11], [18.5, -4, 9.5], [16, -36, 10.5], [-17, -34, 9]]) palms.push({ x, z, h });
  for (let i = 0; i < 12; i++) {
    const a = rng() * 6.28, r = 30 + rng() * 22;
    trees.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 1.3, k: 1.1 + rng() * 0.5 });
  }
  for (let i = 0; i < 60; i++) {
    const a = rng() * 6.28, r = 25 + rng() * 22;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r * 1.3;
    if (Math.max(Math.abs(bx), Math.abs(bz) - 22) > 25) bushes.push({ x: bx, z: bz, k: 0.7 + rng() * 0.9 });
  }
  for (let i = 0; i < 9000 && grass.length < 2400; i++) {
    const x = (rng() - 0.5) * 84, z = (rng() - 0.5) * 110;
    const edge = Math.max(Math.abs(x), Math.abs(z) - 22);
    if (edge < 16.5 || rng() > smoothstep(16, 24, edge) * 0.9) continue;
    grass.push({ x, z, k: 0.7 + rng() * 0.9, dry: rng() });
  }
  K.createPalms(scene, T, palms, A.uTime, 'palmyra', 85);
  K.createTrees(scene, T, trees, A.uTime, 63);
  K.createBushes(scene, T, bushes, A.uTime, 73);
  K.scatterGrass(scene, A.uTime, grass, 57);

  A.lampSys = createLamps(scene, T.rock, T.sprite, T.flame, [[-6.3, 25.4], [-6.1, 12.4], [8.7, 8.8], [-2.4, -13.2], [9.9, -21.6]]);
  A.beacon = K.createBeacon(scene, T.beam, T.sprite, 3.5, -19.6);
  A.dust = K.createDust(scene, T.sprite, '#fff0d0', 180);
  A.birds = K.createBirds(scene, 0, 0, 30, 12, 15);
  A.start = { x: 3, z: 41, yaw: 0 };
  A.enemies = []; // peaceful: no raiders
  A.goalText = 'Stand before the tallest ratha';
  return finish(A);
}

// =============================================================================
// 3. THE SHORE TEMPLE
// =============================================================================
export function buildShore(ctx) {
  const { T } = ctx;
  const env = makeEnv({
    sunDir: [0.62, 0.52, -0.42], sun: '#fff2dc', light: '#fff0da', lightIntensity: 3.3,
    horizon: '#dfe4e2', zenith: '#5f8cc4', fog: '#d3dad8', fogDensity: 0.0044, glow: '#fff0d8',
    cloudCover: 0.45, cloudLit: '#ffffff', cloudLitBoost: 1.3, cloudBase: '#d2d3d8', cloudDark: '#868b98',
    hemiSky: '#c2d4ea', hemiGround: '#8f7a5e', hemiIntensity: 0.5, exposure: 0.9, bloom: 0.36, rays: 0.3,
    grade: [1.03, 1.0, 0.96], saturation: 1.06, waterDeep: '#1b4a55', waterShallow: '#638f88',
  });
  const A = begin(ctx, shoreDef, env);
  const { scene } = A;
  createTerrain(scene, T.sand);
  A.ocean = createOcean(scene, T.waterN, env);
  A.spray = createSpray(scene, T.sprite, sprayEmitters());
  A.spray.points.userData.noAO = true;
  const temple = createTemple(scene, T.masonry, ctx.panels('#bfb3a2'), '#b3a797');
  createCliff(scene, T.relief, T.rock);
  createPath(scene, T.rock);
  createWalls(scene, T.rock);
  createRocks(scene, T.rock);
  createVegetation(scene, A.uTime);
  A.lampSys = createLamps(scene, T.rock, T.sprite, T.flame, [[3.5, 22], [-39.5, 21], [22, 3], [-12.5, -33], [13, -63]]);
  // a bench beside the flagstone walk, facing the sea
  A.seats = K.createSeats(scene, T.rock, '#b9ad9c', [{ x: -1.7, z: 50, yaw: -PI / 2 }], 1.2);
  A.beacon = K.createBeacon(scene, T.beam, T.sprite, DOOR.x, DOOR.z);
  A.birds = K.createBirds(scene, 10, -30, 30, 10, 17);
  A.start = { x: 0.4, z: 56, yaw: 0 };
  A.enemies = []; // peaceful: no raiders
  A.goalText = 'Go to the temple door';
  // the doorway itself glows once the beacon is called
  const show = A.beacon.show;
  A.beacon.show = () => {
    show();
    temple.glow.material.opacity = 0.85;
    temple.doorLight.intensity = 30;
  };
  return finish(A);
}

// =============================================================================
// 4. THE HEADLAND AT SUNSET
// =============================================================================
export function buildHeadland(ctx) {
  const { T } = ctx;
  const TP = { x: 62, z: -72, hw: 15, hd: 17, y: 2.7 }; // the temple platform on its rock
  const edgeZ = (x) => 5 + 7 * Math.sin(x * 0.045 + 0.5) + (fbm(x * 0.08, 3.3, 3) - 0.5) * 8;
  const smax = (a, b2, k) => {
    const h = clamp01(0.5 + (0.5 * (a - b2)) / k);
    return lerp(b2, a, h) + k * h * (1 - h);
  };
  const land = (x, z) => {
    const d1 = z - edgeZ(x) + 13 + 5 * Math.sin(x * 0.07);
    const d2 = (1 - Math.hypot((x - 60) / 27, (z + 54) / 44)) * 27;
    return smax(d1, d2, 8) + (fbm(x * 0.06, z * 0.06, 3) - 0.5) * 6;
  };
  const flat = (x, z) => 1 - smoothstep(0, 5, Math.hypot(Math.max(Math.abs(x - TP.x) - TP.hw, 0), Math.max(Math.abs(z - TP.z) - TP.hd, 0)));
  const cliffK = (x, z) => smoothstep(-7.5, 1.5, z - edgeZ(x));
  const height = (x, z) => {
    const d = land(x, z);
    if (d <= 0) return Math.max(-9, d * 0.24);
    let low = 1.15 * (1 - Math.exp(-d / 4)) + (fbm(x * 0.1 + 5, z * 0.1, 3) - 0.5) * 0.9 * clamp01(d / 6);
    low = lerp(low, TP.y, flat(x, z));
    const east = smoothstep(16, 58, x);
    const top = lerp(15, 1.6, east) + (fbm(x * 0.03, z * 0.03, 4) - 0.5) * 3 * (1 - east * 0.8) + smoothstep(24, 100, z) * 3.5;
    return lerp(low, Math.max(top, low), cliffK(x, z));
  };
  const def = {
    name: 'headland', colliders: newColliders(), terrain: { size: 440, cx: 10, cz: -10, seg: 256 },
    terrainHeight: height,
    landDist: (x, z) => land(x, z),
    flatness: flat,
    walkable: (x, z) => Math.abs(x - 10) < 150 && z < 118 && z > -150 && height(x, z) > -0.45,
  };
  const pavedT = (x, z) => Math.abs(x - TP.x) < TP.hw && Math.abs(z - TP.z) < TP.hd;
  def.groundHeight = (x, z) => height(x, z) + (pavedT(x, z) ? 0.08 : 0);

  const env = makeEnv({
    sunDir: [-0.24, 0.085, -1], sun: '#ffb070', light: '#ffab72', lightIntensity: 3.0, sunDisk: 9, bloomThreshold: 2.0,
    horizon: '#f5a566', zenith: '#4d5384', fog: '#c8917a', fogDensity: 0.0038, glow: '#c9602c',
    cloudCover: 0.4, cloudLit: '#ffb27c', cloudLitBoost: 1.55, cloudBase: '#b77a8c', cloudDark: '#6f5f88',
    hemiSky: '#a9a6da', hemiGround: '#70583c', hemiIntensity: 0.85, envIntensity: 1.0, exposure: 1.0, bloom: 0.34, rays: 0.5,
    grade: [1.08, 0.98, 0.92], saturation: 1.14, waterDeep: '#232d48', waterShallow: '#62687a', shadowRange: 52,
  });
  const A = begin(ctx, def, env);
  const { scene } = A;
  const rng = mulberry32(303);

  // ground: turf on top, bare rock on the cliff, sand at its foot, dark where the sea reaches
  const turf = new THREE.Color('#5d7c36'), rockC = new THREE.Color('#9a8672'), sandC = new THREE.Color('#d9c4a2'), wetC = new THREE.Color('#7a6650');
  const turfMask = (x, z) => {
    const k = cliffK(x, z);
    return smoothstep(0.86, 1, k) * smoothstep(0.3, 0.5, fbm(x * 0.05 + 2, z * 0.05, 3) + 0.25) * (1 - smoothstep(30, 52, x));
  };
  createTerrain(scene, T.sand, (x, z, h, c) => {
    const k = cliffK(x, z), d = land(x, z);
    const face = smoothstep(0.03, 0.3, k) * (1 - smoothstep(0.8, 0.98, k)) * (1 - smoothstep(30, 55, x));
    const w = d < 0 ? 1 : smoothstep(3.5, 0.3, d);
    c.copy(sandC).lerp(rockC, Math.max(face, smoothstep(0.3, 0.9, k) * 0.6)).lerp(turf, turfMask(x, z) * 0.9).lerp(wetC, w * 0.9);
    c.multiplyScalar(0.82 + fbm(x * 0.06, z * 0.06, 3) * 0.34);
    return w * 0.85;
  }, 5);
  A.ocean = createOcean(scene, T.waterN, env, height);
  const emit = [];
  for (let x = -70; x < 96; x += 15) {
    for (let z = 20; z > -130; z -= 1.5) {
      if (land(x, z) < 0) { emit.push({ x: x + rng() * 3, z: z - 1.5, power: 1.1 + rng() * 0.5 }); break; }
    }
  }
  A.spray = createSpray(scene, T.sprite, emit);
  A.spray.points.userData.noAO = true;

  // -- the temple complex below, on its platform above the surf
  const b = new StoneBuilder(31), niches = [];
  const y0 = TP.y;
  b.box(TP.hw * 2 + 1.6, 3.4, TP.hd * 2 + 1.6, TP.x, y0 - 3.3, TP.z, 0.82, 0.8);
  const doorZ = greatTemple(b, TP.x + 3, TP.z - 4, y0, 8.6, 3.9, 4, niches);
  K.shrine(b, TP.x - 7.5, TP.z + 3, y0, 5.0, 2, niches, 2.9);
  K.shrine(b, TP.x + 10.5, TP.z + 10, y0, 3.2, 1, niches, 2.2);
  for (const [px, pz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { // open pavilion
    K.pillar(b, TP.x - 9 + px, y0, TP.z + 12 + pz, 2.6, 0.4);
    addCircle(TP.x - 9 + px, TP.z + 12 + pz, 0.3);
  }
  b.box(4.6, 0.3, 4.6, TP.x - 9, y0 + 2.9, TP.z + 12, 0.88, 0.6);
  b.solid(dome(2.0, 0.7), TP.x - 9, y0 + 3.2, TP.z + 12, 0.92, PI / 8);
  const gate = 2.4;
  K.wallRun(b, TP.x - TP.hw, TP.z + TP.hd, TP.x - gate, TP.z + TP.hd, y0, 1.4, 0.7);
  K.wallRun(b, TP.x + gate, TP.z + TP.hd, TP.x + TP.hw, TP.z + TP.hd, y0, 1.4, 0.7);
  K.wallRun(b, TP.x - TP.hw, TP.z - TP.hd, TP.x + TP.hw, TP.z - TP.hd, y0, 1.4, 0.7);
  K.wallRun(b, TP.x - TP.hw, TP.z - TP.hd, TP.x - TP.hw, TP.z + TP.hd, y0, 1.4, 0.7);
  K.wallRun(b, TP.x + TP.hw, TP.z - TP.hd, TP.x + TP.hw, TP.z + TP.hd, y0, 1.4, 0.7);
  // a lone sea shrine on the rocks to the west
  const sx0 = 22, sz0 = -64, sy0 = Math.max(0.6, height(sx0, sz0));
  b.box(3.4, 1.2, 3.4, sx0, sy0 - 0.9, sz0, 0.85);
  b.box(2.4, 2.4, 2.4, sx0, sy0 + 0.3, sz0, 0.96);
  b.solid(dome(1.7, 1.5), sx0, sy0 + 2.7, sz0, 0.92, PI / 8);
  K.stoneMesh(scene, b, T.masonry, '#b79a7e');
  ctx.panels('#c4a88c')(scene, niches);
  K.createPaving(scene, T.rock, [{ x0: TP.x - TP.hw + 0.5, x1: TP.x + TP.hw - 0.5, z0: TP.z - TP.hd + 0.5, z1: TP.z + TP.hd - 0.5, y: y0, ragged: 0.06 }], { seed: 34, color: '#c9b49a', bright: 1.3 });

  // -- rock: crags along the cliff, boulders at its foot, stacks in the sea
  const crags = [];
  for (let x = -110; x < 60; x += 1.1 + rng() * 1.6) {
    const ez = edgeZ(x);
    const fade = 1 - smoothstep(28, 54, x);
    if (rng() > fade) continue;
    const dz = -8 + rng() * 9.5;
    crags.push({ x, z: ez + dz, k: (0.6 + Math.pow(rng(), 1.8) * 2.6) * (0.5 + fade * 0.5), sink: 0.35, solid: false });
  }
  for (let i = 0; i < 140; i++) {
    const x = -100 + rng() * 200, z = edgeZ(x) - 6 - rng() * 22;
    const d = land(x, z);
    if (d > -3 && d < 9 && !pavedT(x, z)) crags.push({ x, z, k: 0.4 + Math.pow(rng(), 2) * 2.2, sink: 0.3 });
  }
  for (let i = 0; i < 60; i++) { // around the temple rock
    const a = rng() * 6.28;
    const x = TP.x + Math.cos(a) * (TP.hw + 2 + rng() * 9), z = TP.z + Math.sin(a) * (TP.hd + 2 + rng() * 9);
    if (land(x, z) > -5) crags.push({ x, z, k: 0.8 + rng() * 2.2, sink: 0.3 });
  }
  K.scatterRocks(scene, T.rock, crags, '#7d6450', 41, 2);
  const stacks = [[-34, -38, 5], [-22, -46, 3.2], [-44, -30, 2.6], [8, -52, 3.6], [-58, -52, 4.4], [30, -96, 3]];
  K.scatterRocks(scene, T.rock, stacks.map(([x, z, k]) => ({ x, z, k, y: -0.5, sink: 0.1 })), '#6f5846', 43, 3);
  const top = [];
  for (let i = 0; i < 220; i++) {
    const x = -70 + rng() * 120, z = edgeZ(x) + 2 + rng() * 90;
    top.push({ x, z, k: 0.12 + Math.pow(rng(), 2.5) * 1.1, sink: 0.35, solid: false });
  }
  K.scatterRocks(scene, T.rock, top, '#8a7460', 45, 2);

  // -- deep grass and scrub on the headland
  const grass = [], plants = [], bushes = [];
  for (let i = 0; i < 60000 && grass.length < 4600; i++) {
    const x = -46 + rng() * 96, z = edgeZ(x) + rng() * 84;
    if (rng() > turfMask(x, z) * 1.1) continue;
    grass.push({ x, z, k: 0.9 + rng() * 1.3, dry: rng() * 0.8 });
  }
  for (let i = 0; i < 5000 && plants.length < 420; i++) {
    const x = -44 + rng() * 90, z = edgeZ(x) + 2 + rng() * 80;
    if (fbm(x * 0.2 + 9, z * 0.2, 2) < 0.58 || turfMask(x, z) < 0.4) continue;
    plants.push({ x, z, k: 1.2 + rng() * 1.8 });
  }
  for (let i = 0; i < 90; i++) {
    const x = -50 + rng() * 96, z = edgeZ(x) + 4 + rng() * 86;
    if (turfMask(x, z) > 0.3 && Math.abs(x) > 3.5) bushes.push({ x, z, k: 0.8 + rng() * 1.3 });
  }
  K.scatterGrass(scene, A.uTime, grass, 58, 0.05, 0.34);
  K.scatterPlants(scene, A.uTime, plants, 59);
  K.createBushes(scene, T, bushes, A.uTime, 75);
  K.createTrees(scene, T, [{ x: -24, z: 66, k: 1.2 }, { x: 22, z: 74, k: 1.3 }, { x: -36, z: 40, k: 1.0 }, { x: 34, z: 92, k: 1.4 }, { x: -12, z: 96, k: 1.3 }], A.uTime, 65);
  K.createPalms(scene, T, [{ x: 78, z: -40, h: 11 }, { x: 84, z: -52, h: 12 }, { x: 81, z: -30, h: 10 }, { x: 90, z: -66, h: 11 }, { x: 74, z: -22, h: 12 }, { x: 66, z: -16, h: 10 }], A.uTime, 'coconut', 87);

  // -- the look-out point: where the cliff juts furthest toward the sun
  const gx = -3, gz = edgeZ(gx) + 3.4;
  A.lampSys = createLamps(scene, T.rock, T.sprite, T.flame, [[4.5, 44], [gx + 3.2, gz + 1.5]]);
  A.beacon = K.createBeacon(scene, T.beam, T.sprite, gx, gz);
  A.fires = K.createFires(scene, T.sprite, T.flame, [[3.4, height(3.4, 68.6) + 0.25, 68.6, 1.1]]);
  // a stone seat by the fire
  A.seats = K.createSeats(scene, T.rock, '#9a8672', [{ x: 5.6, z: 68.3, yaw: PI / 2 }], 1.2);
  A.birds = K.createBirds(scene, 20, -50, 26, 12, 19);
  A.dust = K.createDust(scene, T.sprite, '#ffb880', 160);
  A.start = { x: 0, z: 66, yaw: 0 };
  A.enemies = []; // peaceful: no raiders
  A.goalText = 'Walk out to the edge of the cliff';
  A.templeDoor = { x: TP.x + 3, z: doorZ };
  return finish(A);
}
