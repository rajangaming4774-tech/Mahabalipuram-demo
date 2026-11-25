// Everything scattered on the ground: flagstone path, puddles, dry-stone walls,
// shoreline rocks, pebbles, grass, creepers and the stone lamps.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, mulberry32, smoothstep } from './noise.js';
import {
  PATH, COURT, FLAT_Y, pathX, terrainHeight, groundHeight, landDist, flatness, shoreX, addCircle, addSegment,
} from './world.js';
import { grassMask } from './environment.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const col = new THREE.Color();

export function place(mesh, i, x, y, z, rx, ry, rz, sx, sy, sz) {
  e.set(rx, ry, rz);
  q.setFromEuler(e);
  m4.compose(p.set(x, y, z), q, s.set(sx, sy, sz));
  mesh.setMatrixAt(i, m4);
}

export function stoneMaterial(rock, color = '#ffffff') {
  return new THREE.MeshStandardMaterial({
    map: rock.map, normalMap: rock.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.93, metalness: 0, color,
  });
}

// ---- flagstone path ----------------------------------------------------------
export function createPath(scene, rock) {
  const rng = mulberry32(3);
  const slabs = [];
  let z = PATH.zStart;
  while (z > PATH.zEnd) {
    const depth = 1.0 + rng() * 0.7;
    const zc = z - depth / 2;
    const cx = pathX(zc);
    const ang = Math.atan2(pathX(zc - 1) - pathX(zc + 1), 2) * -1;
    const fade = smoothstep(PATH.zStart, PATH.zStart - 14, zc); // path breaks up at the far end
    let x = -PATH.halfWidth - rng() * 0.3;
    while (x < PATH.halfWidth) {
      const w = 0.85 + rng() * 0.95;
      const edge = x < -PATH.halfWidth + 0.5 || x + w > PATH.halfWidth - 0.3;
      const skip = rng() < (edge ? 0.3 : 0.05) + (1 - fade) * 0.6;
      if (!skip) slabs.push({ x: cx + x + w / 2, z: zc + (rng() - 0.5) * 0.08, w: w - 0.07, d: depth - 0.07, ang: ang + (rng() - 0.5) * 0.07, t: rng() });
      x += w;
    }
    z -= depth;
  }
  const mesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.06), stoneMaterial(rock, '#b9b2a6'), slabs.length);
  slabs.forEach((sl, i) => {
    const y = terrainHeight(sl.x, sl.z) + 0.01 + (sl.t - 0.5) * 0.025;
    place(mesh, i, sl.x, y, sl.z, (sl.t - 0.5) * 0.02, sl.ang, (sl.t * 7 % 1 - 0.5) * 0.02, sl.w, 0.14, sl.d);
    const k = 0.72 + sl.t * 0.4;
    mesh.setColorAt(i, col.setRGB(k, k * 0.98, k * 0.95));
  });
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);

  // standing water in the worn places
  const pm = new THREE.MeshStandardMaterial({
    color: '#2a2118', roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.78, envMapIntensity: 2.2,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
  });
  const puddles = [];
  for (let i = 0; i < 16; i++) {
    const pz = PATH.zStart - 8 - rng() * (PATH.zStart - PATH.zEnd - 12);
    const px = pathX(pz) + (rng() - 0.5) * 5.5;
    const r = 0.6 + rng() * 1.3;
    const g = new THREE.CircleGeometry(1, 20);
    const gp = g.attributes.position;
    for (let k = 1; k < gp.count; k++) {
      const a = Math.atan2(gp.getY(k), gp.getX(k));
      const rr = 0.6 + fbm(Math.cos(a) * 1.5 + i * 3.1, Math.sin(a) * 1.5 + i, 3) * 0.8;
      gp.setXY(k, Math.cos(a) * rr * r * (1.3 + rng() * 0.2), Math.sin(a) * rr * r * 0.75);
    }
    g.rotateX(-Math.PI / 2);
    g.rotateY(rng() * Math.PI);
    g.translate(px, terrainHeight(px, pz) + 0.086, pz);
    puddles.push(g);
  }
  const pud = new THREE.Mesh(mergeGeometries(puddles, false), pm);
  pud.renderOrder = 1;
  pud.userData.noAO = true;
  scene.add(pud);
  return mesh;
}

// ---- dry-stone walls ---------------------------------------------------------
const WALLS = [
  { pts: [[-4.4, 60], [-4.9, 44], [-5.3, 27]], courses: 5 },
  { pts: [[13.5, 56], [9, 44], [5.2, 34], [4.7, 27]], courses: 4 },
  { pts: [[4.2, 17], [4.3, 7]], courses: 4 },
  { pts: [[-4.6, 12], [-4.3, -2]], courses: 3 },
  { pts: [[4.6, -9], [4.9, -22]], courses: 4 },
  { pts: [[-4.4, -13], [-9.5, -17], [-16, -18]], courses: 3 },
];

export function createWalls(scene, rock) {
  const rng = mulberry32(8);
  const blocks = [];
  for (const wall of WALLS) {
    for (let k = 0; k < wall.pts.length - 1; k++) {
      const [x1, z1] = wall.pts[k], [x2, z2] = wall.pts[k + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
      const ang = Math.atan2(-dz, dx);
      addSegment(x1, z1, x2, z2, 0.5);
      for (let c = 0; c < wall.courses; c++) {
        for (const side of [-0.24, 0.24]) {
          let t = -rng() * 0.4;
          while (t < len) {
            const bl = 0.5 + rng() * 0.5, bh = 0.36 + rng() * 0.07;
            const tc = t + bl / 2;
            // top course is broken and uneven
            if (c === wall.courses - 1 && rng() < 0.22) { t += bl; continue; }
            const x = x1 + dx * tc - dz * side + (rng() - 0.5) * 0.04;
            const z = z1 + dz * tc + dx * side + (rng() - 0.5) * 0.04;
            const gy = terrainHeight(x, z);
            blocks.push({ x, y: gy + 0.16 + c * 0.38 + (rng() - 0.5) * 0.03, z, ang: ang + (rng() - 0.5) * 0.1, bl: bl - 0.03, bh, bd: 0.47 + rng() * 0.06, t: rng() });
            t += bl;
          }
        }
      }
    }
  }
  const mesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.12), stoneMaterial(rock, '#a89b8a'), blocks.length);
  blocks.forEach((b, i) => {
    place(mesh, i, b.x, b.y, b.z, (b.t - 0.5) * 0.06, b.ang, (b.t * 5 % 1 - 0.5) * 0.06, b.bl, b.bh, b.bd);
    const k = 0.7 + b.t * 0.42;
    mesh.setColorAt(i, col.setRGB(k, k * 0.97, k * 0.93));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// ---- rocks -------------------------------------------------------------------
export function boulderGeometry(detail, seed, rough = 0.45) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 - rough * 0.5 + fbm(x * 1.3 + seed, y * 1.3 + z * 1.7 - seed, 3) * rough;
    pos.setXYZ(i, x * k, y * k, z * k);
    uv[i * 2] = Math.atan2(z, x) / 3.1416;
    uv[i * 2 + 1] = y * 0.5 + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function createRocks(scene, rock) {
  const rng = mulberry32(21);
  const list = [];
  // boulders tumbled along the eastern shore, where the surf breaks
  for (let z = 72; z > -78; z -= 0.75 + rng() * 0.9) {
    const x = shoreX(z) + (rng() - 0.5) * 7 - 0.5;
    const d = landDist(x, z);
    if (d > 3.5 || d < -4.5) continue;
    const k = 0.35 + Math.pow(rng(), 2.2) * 2.1;
    list.push({ x, z, k, sink: 0.25 });
  }
  // a few strays on the sand
  for (let i = 0; i < 60; i++) {
    const x = -30 + rng() * 52, z = -24 + rng() * 92;
    if (landDist(x, z) < 2 || flatness(x, z) > 0.4) continue;
    list.push({ x, z, k: 0.18 + rng() * 0.5, sink: 0.35 });
  }
  const mat = stoneMaterial(rock, '#8e7e6c');
  const mesh = new THREE.InstancedMesh(boulderGeometry(2, 4), mat, list.length);
  list.forEach((r, i) => {
    const y = terrainHeight(r.x, r.z) + r.k * (0.5 - r.sink);
    place(mesh, i, r.x, y, r.z, rng() * 6.28, rng() * 6.28, rng() * 6.28, r.k * (0.9 + rng() * 0.6), r.k * (0.55 + rng() * 0.3), r.k * (0.9 + rng() * 0.5));
    const wetK = landDist(r.x, r.z) < 0.5 ? 0.6 : 0.85;
    const k = wetK * (0.8 + rng() * 0.3);
    mesh.setColorAt(i, col.setRGB(k, k * 0.96, k * 0.92));
    if (r.k > 1.0 && landDist(r.x, r.z) > -0.5) addCircle(r.x, r.z, r.k * 0.8);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  // pebbles
  const pebbles = [];
  for (let i = 0; i < 520; i++) {
    const nearPath = rng() < 0.6;
    const z = PATH.zEnd + rng() * (PATH.zStart - PATH.zEnd);
    const x = nearPath ? pathX(z) + (rng() - 0.5) * 16 : -30 + rng() * 55;
    if (landDist(x, z) < 1) continue;
    pebbles.push({ x, z, k: 0.04 + rng() * 0.1 });
  }
  const pm = new THREE.InstancedMesh(boulderGeometry(1, 9, 0.3), stoneMaterial(rock, '#7d7265'), pebbles.length);
  pebbles.forEach((r, i) => {
    place(pm, i, r.x, terrainHeight(r.x, r.z) + r.k * 0.2, r.z, rng() * 6, rng() * 6, 0, r.k * 1.3, r.k * 0.7, r.k);
    const k = 0.6 + rng() * 0.5;
    pm.setColorAt(i, col.setRGB(k, k, k * 0.96));
  });
  pm.receiveShadow = true;
  scene.add(pm);

  // the great balanced boulder, a landmark off to the west
  const BALL = { x: -44, z: 16 };
  const by = terrainHeight(BALL.x, BALL.z);
  const slab = new THREE.Mesh(boulderGeometry(3, 12, 0.25), stoneMaterial(rock, '#a39582'));
  slab.scale.set(13, 1.7, 10);
  slab.position.set(BALL.x, by + 0.1, BALL.z);
  slab.castShadow = slab.receiveShadow = true;
  const ball = new THREE.Mesh(boulderGeometry(3, 17, 0.22), stoneMaterial(rock, '#b09f8a'));
  ball.scale.set(3.3, 3.0, 3.1);
  ball.position.set(BALL.x + 0.8, by + 4.1, BALL.z);
  ball.rotation.set(0.2, 0.7, 0.1);
  ball.castShadow = ball.receiveShadow = true;
  scene.add(slab, ball);
  addCircle(BALL.x + 0.8, BALL.z, 2.6);
  return { mesh, BALL };
}

// ---- vegetation --------------------------------------------------------------
export function tuftGeometry() {
  const rng = mulberry32(13);
  const pos = [], colr = [], nor = [];
  const base = new THREE.Color('#3f4f22'), tip = new THREE.Color('#a9b060');
  const c = new THREE.Color();
  const BLADES = 9;
  for (let b = 0; b < BLADES; b++) {
    const a = rng() * Math.PI * 2, lean = 0.15 + rng() * 0.5, h = 0.32 + rng() * 0.42, w = 0.022 + rng() * 0.014;
    const ox = Math.cos(a) * rng() * 0.09, oz = Math.sin(a) * rng() * 0.09;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx; // blade width direction
    const pt = (t, side) => {
      const out = lean * t * t * h;
      const ww = w * (1 - t) * side;
      return [ox + dx * out + px * ww, h * t, oz + dz * out + pz * ww];
    };
    const quads = [[0, 0.5], [0.5, 1]];
    for (const [t0, t1] of quads) {
      const A = pt(t0, -1), B = pt(t0, 1), C = pt(t1, 1), D = pt(t1, -1);
      for (const [v, t] of [[A, t0], [B, t0], [C, t1], [A, t0], [C, t1], [D, t1]]) {
        pos.push(...v);
        c.copy(base).lerp(tip, t);
        colr.push(c.r, c.g, c.b);
        nor.push(dx * 0.25, 1, dz * 0.25); // soft, mostly-up normals read as lit grass
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function rosetteGeometry() {
  const rng = mulberry32(17);
  const pos = [], colr = [], nor = [];
  const dark = new THREE.Color('#2f5a1f'), light = new THREE.Color('#79b04a');
  const c = new THREE.Color();
  const LEAVES = 8;
  for (let l = 0; l < LEAVES; l++) {
    const a = (l / LEAVES) * Math.PI * 2 + rng() * 0.5, len = 0.2 + rng() * 0.14, w = 0.05 + rng() * 0.025, rise = 0.25 + rng() * 0.5;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const pt = (t, side) => {
      const ww = w * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)) * side;
      const y = 0.03 + rise * len * Math.sin(t * Math.PI * 0.7);
      return [dx * len * t + px * ww, y, dz * len * t + pz * ww];
    };
    const T = [0, 0.35, 0.7, 1];
    for (let k = 0; k < 3; k++) {
      const t0 = T[k], t1 = T[k + 1];
      const A = pt(t0, -1), B = pt(t0, 1), C = pt(t1, 1), D = pt(t1, -1);
      for (const [v, t] of [[A, t0], [B, t0], [C, t1], [A, t0], [C, t1], [D, t1]]) {
        pos.push(...v);
        c.copy(dark).lerp(light, t * 0.8 + rng() * 0.2);
        colr.push(c.r, c.g, c.b);
        nor.push(dx * 0.3, 1, dz * 0.3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function swaying(mat, uTime, amount) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 ip = instanceMatrix[3].xyz;
         #else
           vec3 ip = vec3(0.0);
         #endif
         float sw = sin(uTime * 1.7 + ip.x * 0.33 + ip.z * 0.27) + 0.45 * sin(uTime * 3.3 + ip.x * 1.1 - ip.z * 0.8);
         float hf = position.y * position.y * ${amount.toFixed(2)};
         transformed.x += sw * hf;
         transformed.z += sw * hf * 0.6;`
      );
  };
  return mat;
}

export function createVegetation(scene, uTime = { value: 0 }) {
  const rng = mulberry32(55);

  // grass: in the turf patches, and tufts hugging the foot of every wall
  const tufts = [];
  for (let i = 0; i < 26000 && tufts.length < 3400; i++) {
    const x = -75 + rng() * 105, z = -24 + rng() * 104;
    const g = grassMask(x, z);
    if (rng() > g * 0.95 + 0.012) continue;
    if (landDist(x, z) < 3 || flatness(x, z) > 0.55) continue;
    tufts.push({ x, z, k: 0.7 + rng() * 0.9, dry: rng() });
  }
  for (const wall of WALLS) {
    for (let k = 0; k < wall.pts.length - 1; k++) {
      const [x1, z1] = wall.pts[k], [x2, z2] = wall.pts[k + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      for (let t = 0; t < len; t += 0.28) {
        if (rng() < 0.45) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const off = 0.55 + rng() * 0.5;
        tufts.push({
          x: x1 + ((x2 - x1) * t) / len - ((z2 - z1) / len) * side * off,
          z: z1 + ((z2 - z1) * t) / len + ((x2 - x1) / len) * side * off,
          k: 0.8 + rng() * 0.9, dry: rng() * 0.7,
        });
      }
    }
  }
  const gm = swaying(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), uTime, 0.28);
  const grass = new THREE.InstancedMesh(tuftGeometry(), gm, tufts.length);
  tufts.forEach((t, i) => {
    place(grass, i, t.x, terrainHeight(t.x, t.z) - 0.02, t.z, 0, rng() * 6.28, 0, t.k, t.k * (0.8 + rng() * 0.5), t.k);
    col.setHSL(0.17 + (1 - t.dry) * 0.09, 0.45, 0.42 + t.dry * 0.12);
    grass.setColorAt(i, col);
  });
  grass.receiveShadow = true;
  grass.userData.noAO = true;
  scene.add(grass);

  // broad-leaved creepers near the path edges and walls
  const ros = [];
  for (let i = 0; i < 9000 && ros.length < 520; i++) {
    const z = PATH.zEnd + rng() * (PATH.zStart - PATH.zEnd + 4);
    const x = pathX(z) + (rng() < 0.5 ? -1 : 1) * (2.9 + Math.pow(rng(), 1.6) * 9);
    if (landDist(x, z) < 4) continue;
    const clump = fbm(x * 0.35 + 9, z * 0.35, 2);
    if (clump < 0.56) continue;
    ros.push({ x, z, k: 0.8 + rng() * 1.1 });
  }
  const rm = swaying(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), uTime, 0.5);
  const plants = new THREE.InstancedMesh(rosetteGeometry(), rm, ros.length);
  ros.forEach((t, i) => {
    place(plants, i, t.x, terrainHeight(t.x, t.z), t.z, 0, rng() * 6.28, 0, t.k, t.k, t.k);
    col.setHSL(0.25 + rng() * 0.05, 0.34, 0.27 + rng() * 0.1);
    plants.setColorAt(i, col);
  });
  plants.receiveShadow = true;
  plants.userData.noAO = true;
  scene.add(plants);
  return { uTime };
}

// ---- stone lamps (the objective) ---------------------------------------------
export function createLamps(scene, rock, sprite, flameTex, positions) {
  const stone = stoneMaterial(rock, '#9d9082');
  const parts = [];
  const add = (g, y) => { g.translate(0, y, 0); parts.push(g.index ? g.toNonIndexed() : g); };
  add(new THREE.BoxGeometry(0.62, 0.22, 0.62), 0.11);
  add(new THREE.BoxGeometry(0.46, 0.14, 0.46), 0.29);
  add(new THREE.CylinderGeometry(0.11, 0.15, 0.82, 8), 0.77);
  add(new THREE.BoxGeometry(0.36, 0.1, 0.36), 1.23);
  add(new THREE.CylinderGeometry(0.24, 0.12, 0.14, 10), 1.35);
  const geo = mergeGeometries(parts, false);

  const lamps = positions.map(([x, z]) => {
    const y = groundHeight(x, z);
    const mesh = new THREE.Mesh(geo, stone);
    mesh.position.set(x, y - 0.03, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    addCircle(x, z, 0.3);

    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(2.6, 1.9, 1.1), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    flame.scale.set(0.3, 0.46, 1);
    flame.position.set(x, y + 1.6, z);
    flame.visible = false;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: new THREE.Color(1.4, 0.8, 0.3), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.55 }));
    halo.scale.set(2.2, 2.2, 1);
    halo.position.copy(flame.position);
    halo.visible = false;
    // a faint mote hangs over an unlit lamp so it can be found from far away
    const mote = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: new THREE.Color(1.6, 1.25, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, sizeAttenuation: false, opacity: 0.8 }));
    mote.scale.set(0.022, 0.022, 1);
    mote.position.set(x, y + 2.3, z);
    scene.add(flame, halo, mote);
    return { x, y, z, lit: false, flame, halo, mote };
  });

  const light = new THREE.PointLight('#ffa64d', 0, 9, 1.8);
  scene.add(light);

  function update(time, player) {
    let best = null, bestD = 1e9;
    for (const l of lamps) {
      if (l.lit) {
        const f = 1 + Math.sin(time * 11 + l.x) * 0.07 + Math.sin(time * 23 + l.z) * 0.05;
        l.flame.scale.set(0.3 * f, 0.46 * (2 - f), 1);
        const d = Math.hypot(l.x - player.x, l.z - player.z);
        if (d < bestD) { bestD = d; best = l; }
      } else {
        const pulse = 0.55 + 0.45 * Math.sin(time * 2.2 + l.x);
        l.mote.material.opacity = 0.35 + 0.5 * pulse;
        l.mote.position.y = l.y + 2.3 + Math.sin(time * 1.3 + l.z) * 0.12;
      }
    }
    if (best && bestD < 30) {
      light.position.set(best.x, best.y + 1.7, best.z);
      light.intensity = 7 * (1 + Math.sin(time * 13) * 0.08);
    } else light.intensity = 0;
  }
  function ignite(l) {
    l.lit = true;
    l.flame.visible = l.halo.visible = true;
    l.mote.visible = false;
  }
  return { lamps, update, ignite };
}
