// Shared building kit used by every area: carved panels, paving, trees and palms,
// statues, gateways, walls, market stalls, fires, dust, birds and the goal beacon.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dome, vimana, StoneBuilder } from './temple.js';
import { place, stoneMaterial, boulderGeometry, tuftGeometry, rosetteGeometry, swaying } from './props.js';
import { terrainHeight, groundHeight, addBox, addCircle } from './world.js';
import { fbm, mulberry32 } from './noise.js';
import { PANEL_CELLS, PANEL_GOOD } from './textures2.js';

const col = new THREE.Color();

// ---- batching ----------------------------------------------------------------
// Collects many small parts and merges them into one mesh per material.
export class Batch {
  constructor() { this.parts = {}; }
  add(key, geo) {
    (this.parts[key] ||= []).push(geo.index ? geo.toNonIndexed() : geo);
    return this;
  }
  build(scene, mats, { cast = true, receive = true } = {}) {
    const out = {};
    for (const key in this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(this.parts[key], false), mats[key]);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      scene.add(mesh);
      out[key] = mesh;
    }
    return out;
  }
}

// Move a part from its local place on an object to the world: local offset, scale, turn, position.
export function xform(geo, lx, ly, lz, X, Y, Z, ry = 0, s = 1) {
  geo.translate(lx, ly, lz);
  if (s !== 1) geo.scale(s, s, s);
  if (ry) geo.rotateY(ry);
  geo.translate(X, Y, Z);
  return geo;
}

export function stoneMesh(scene, builder, tex, tint, normal = 1.3, bright = 1) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(normal, normal),
    roughness: 0.96, metalness: 0, vertexColors: true, color: tint,
  });
  mat.color.multiplyScalar(bright); // the stone textures are dark; sunlit sandstone wants lifting
  const mesh = new THREE.Mesh(builder.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// ---- carved panels from the footage ------------------------------------------
// Returns addPanels(scene, niches); each niche is { x, y, z, ry, w, h, cell? } with y at its foot.
export function makePanels(atlas, tint = '#d2c3ac') {
  const mat = new THREE.MeshStandardMaterial({
    map: atlas.map, normalMap: atlas.normalMap, normalScale: new THREE.Vector2(1.7, 1.7), roughness: 0.94, color: tint,
  });
  let n = 0;
  return function addPanels(scene, niches) {
    if (!niches.length) return null;
    const pos = [], nor = [], uv = [], idx = [];
    for (const nc of niches) {
      const cell = nc.cell ?? (n++ * 3) % PANEL_GOOD;
      const u0 = cell / PANEL_CELLS + 0.004, u1 = (cell + 1) / PANEL_CELLS - 0.004;
      const c = Math.cos(nc.ry), s = Math.sin(nc.ry), hw = nc.w / 2;
      const base = pos.length / 3;
      for (const [lx, ly, u, v] of [[-hw, 0, u0, 0.02], [hw, 0, u1, 0.02], [hw, nc.h, u1, 0.98], [-hw, nc.h, u0, 0.98]]) {
        pos.push(nc.x + lx * c, nc.y + ly, nc.z - lx * s);
        nor.push(s, 0, c);
        uv.push(u, v);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
}

// ---- paving ------------------------------------------------------------------
// areas: [{ x0, x1, z0, z1, y?, ragged?, keep?(x, z) }] laid in rows of worn flagstones.
export function createPaving(scene, rock, areas, { seed = 3, color = '#b9b2a6', bright = 1 } = {}) {
  const rng = mulberry32(seed);
  const slabs = [];
  for (const A of areas) {
    let z = A.z1;
    while (z > A.z0) {
      const depth = Math.min(1.0 + rng() * 0.7, z - A.z0 + 0.3);
      const zc = z - depth / 2;
      let x = A.x0 - rng() * 0.3;
      while (x < A.x1) {
        const w = 0.85 + rng() * 0.95;
        const cx = x + w / 2;
        const edge = cx < A.x0 + 0.7 || cx > A.x1 - 0.7;
        const skip = rng() < (edge ? A.ragged ?? 0.22 : 0.025);
        if (!skip && (!A.keep || A.keep(cx, zc))) {
          slabs.push({ x: cx, z: zc + (rng() - 0.5) * 0.06, w: w - 0.06, d: depth - 0.06, ang: (rng() - 0.5) * 0.05, t: rng(), y: A.y });
        }
        x += w;
      }
      z -= depth;
    }
  }
  const mesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.06), stoneMaterial(rock, color), slabs.length);
  slabs.forEach((sl, i) => {
    const y = (sl.y ?? terrainHeight(sl.x, sl.z)) + 0.01 + (sl.t - 0.5) * 0.02;
    place(mesh, i, sl.x, y, sl.z, (sl.t - 0.5) * 0.016, sl.ang, ((sl.t * 7) % 1 - 0.5) * 0.016, sl.w, 0.14, sl.d);
    const k = (0.74 + sl.t * 0.36) * bright;
    mesh.setColorAt(i, col.setRGB(k, k * 0.98, k * 0.95));
  });
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Shallow rain puddles lying on paving or sand. spots: [x, z, radius]
export function createPuddles(scene, spots, lift = 0.09, seed = 5) {
  const rng = mulberry32(seed);
  const mat = new THREE.MeshStandardMaterial({
    color: '#2a2118', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 2.4,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
  });
  const parts = spots.map(([px, pz, r], i) => {
    const g = new THREE.CircleGeometry(1, 20);
    const gp = g.attributes.position;
    for (let k = 1; k < gp.count; k++) {
      const a = Math.atan2(gp.getY(k), gp.getX(k));
      const rr = 0.6 + fbm(Math.cos(a) * 1.5 + i * 3.1, Math.sin(a) * 1.5 + i, 3) * 0.8;
      gp.setXY(k, Math.cos(a) * rr * r * 1.35, Math.sin(a) * rr * r * 0.8);
    }
    g.rotateX(-Math.PI / 2);
    g.rotateY(rng() * Math.PI);
    g.translate(px, terrainHeight(px, pz) + lift, pz);
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
  mesh.renderOrder = 1;
  mesh.userData.noAO = true;
  scene.add(mesh);
  return mesh;
}

// ---- rocks, grass, plants ----------------------------------------------------
// list: [{ x, z, k, sink?, solid? }]
export function scatterRocks(scene, rock, list, color = '#8e7e6c', seed = 21, detail = 2) {
  const rng = mulberry32(seed);
  const mesh = new THREE.InstancedMesh(boulderGeometry(detail, seed), stoneMaterial(rock, color), list.length);
  list.forEach((r, i) => {
    const y = (r.y ?? terrainHeight(r.x, r.z)) + r.k * (0.5 - (r.sink ?? 0.3));
    place(mesh, i, r.x, y, r.z, rng() * 6.28, rng() * 6.28, rng() * 6.28, r.k * (0.9 + rng() * 0.6), r.k * (0.55 + rng() * 0.3), r.k * (0.9 + rng() * 0.5));
    const k = 0.75 + rng() * 0.3;
    mesh.setColorAt(i, col.setRGB(k, k * 0.96, k * 0.92));
    if (r.solid) addCircle(r.x, r.z, r.k * 0.8);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// pts: [{ x, z, k, dry }]
export function scatterGrass(scene, uTime, pts, seed = 55, green = 0, light = 0.4) {
  const rng = mulberry32(seed);
  const gm = swaying(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), uTime, 0.28);
  const grass = new THREE.InstancedMesh(tuftGeometry(), gm, pts.length);
  pts.forEach((t, i) => {
    place(grass, i, t.x, terrainHeight(t.x, t.z) - 0.02, t.z, 0, rng() * 6.28, 0, t.k, t.k * (0.8 + rng() * 0.5), t.k);
    col.setHSL(0.17 + green + (1 - t.dry) * 0.09, 0.45, light + t.dry * 0.1);
    grass.setColorAt(i, col);
  });
  grass.receiveShadow = true;
  grass.userData.noAO = true;
  scene.add(grass);
  return grass;
}

// Broad-leaved ground plants; with a large k they read as banana or taro clumps.
export function scatterPlants(scene, uTime, pts, seed = 56) {
  const rng = mulberry32(seed);
  const rm = swaying(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), uTime, 0.4);
  const plants = new THREE.InstancedMesh(rosetteGeometry(), rm, pts.length);
  pts.forEach((t, i) => {
    place(plants, i, t.x, terrainHeight(t.x, t.z), t.z, 0, rng() * 6.28, 0, t.k, t.k * (t.tall ?? 1), t.k);
    col.setHSL(0.25 + rng() * 0.05, 0.34, 0.26 + rng() * 0.1);
    plants.setColorAt(i, col);
  });
  plants.receiveShadow = true;
  plants.castShadow = true;
  plants.userData.noAO = true;
  scene.add(plants);
  return plants;
}

// ---- trees -------------------------------------------------------------------
// A leaf card drawn with both windings and one shared normal, so it is lit the same from either side.
function card(o, c, a, b, n, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const P = [
    [c[0] - a[0] - b[0], c[1] - a[1] - b[1], c[2] - a[2] - b[2], u0, v0],
    [c[0] + a[0] - b[0], c[1] + a[1] - b[1], c[2] + a[2] - b[2], u1, v0],
    [c[0] + a[0] + b[0], c[1] + a[1] + b[1], c[2] + a[2] + b[2], u1, v1],
    [c[0] - a[0] + b[0], c[1] - a[1] + b[1], c[2] - a[2] + b[2], u0, v1],
  ];
  for (const i of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) {
    o.pos.push(P[i][0], P[i][1], P[i][2]);
    o.uv.push(P[i][3], P[i][4]);
    o.nor.push(n[0], n[1], n[2]);
  }
}
function cardGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
  return g;
}
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function canopyGeometry(seed, cards, R, cy, squash = 0.72) {
  const rng = mulberry32(seed);
  const o = { pos: [], nor: [], uv: [] };
  for (let i = 0; i < cards; i++) {
    const th = rng() * Math.PI * 2, ph = Math.acos(1 - rng() * 1.55);
    const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    const r = R * (0.4 + rng() * 0.6);
    const c = [d[0] * r, cy + d[1] * r * squash, d[2] * r];
    const size = R * (0.34 + rng() * 0.2);
    const rnd = norm3([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
    const a = norm3(cross3(d, rnd));
    const b = norm3(cross3(a, [d[0] * 0.5 + rnd[0], d[1] * 0.5 + rnd[1], d[2] * 0.5 + rnd[2]]));
    const n = norm3([d[0], d[1] + 0.45, d[2]]);
    card(o, c, a.map((v) => v * size), b.map((v) => v * size), n);
  }
  return cardGeometry(o);
}

function treeTrunkGeometry(seed) {
  const rng = mulberry32(seed);
  const parts = [];
  const limb = (r0, r1, len, x, y, z, tiltZ, ry) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1);
    g.translate(0, len / 2, 0);
    g.rotateZ(tiltZ);
    g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g.toNonIndexed());
  };
  limb(0.34, 0.2, 2.6, 0, 0, 0, 0.06, 0);
  for (let i = 0; i < 5; i++) limb(0.17, 0.07, 2.4 + rng(), 0, 2.1 + rng() * 0.5, 0, 0.55 + rng() * 0.5, (i / 5) * 6.28 + rng());
  for (let i = 0; i < 4; i++) limb(0.09, 0.05, 0.9, Math.cos(i * 1.6) * 0.3, 0, Math.sin(i * 1.6) * 0.3, 0.9, i * 1.6 + 1.57); // root flares
  for (let i = 0; i < 6; i++) { // hanging aerial roots
    const a = rng() * 6.28, r = 1.0 + rng() * 1.4;
    limb(0.022, 0.016, 1.6 + rng() * 1.2, Math.cos(a) * r, 1.9 + rng() * 0.5, Math.sin(a) * r, 0, 0);
  }
  return mergeGeometries(parts, false);
}

function leafMaterial(map, uTime, sway, color = '#ffffff') {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.42, roughness: 0.78, metalness: 0, color });
  return swaying(m, uTime, sway);
}

// Spreading broad-leaved trees (banyan / neem). list: [{ x, z, k }]
export function createTrees(scene, T, list, uTime, seed = 61) {
  if (!list.length) return;
  const rng = mulberry32(seed);
  const bark = new THREE.MeshStandardMaterial({ map: T.rock.map, normalMap: T.rock.normalMap, roughness: 0.95, color: '#6b5440' });
  const trunks = new THREE.InstancedMesh(treeTrunkGeometry(seed), bark, list.length);
  const leaves = new THREE.InstancedMesh(canopyGeometry(seed + 1, 54, 2.9, 4.6), leafMaterial(T.leaf, uTime, 0.0035), list.length);
  list.forEach((t, i) => {
    const y = terrainHeight(t.x, t.z) - 0.05, ry = rng() * 6.28;
    place(trunks, i, t.x, y, t.z, 0, ry, 0, t.k, t.k, t.k);
    place(leaves, i, t.x, y, t.z, 0, ry, 0, t.k * (0.95 + rng() * 0.25), t.k, t.k * (0.95 + rng() * 0.25));
    col.setHSL(0.2 + rng() * 0.07, 0.16 + rng() * 0.16, 0.5 + rng() * 0.18);
    leaves.setColorAt(i, col);
    addCircle(t.x, t.z, 0.36 * t.k);
  });
  trunks.castShadow = leaves.castShadow = true;
  trunks.receiveShadow = true;
  leaves.userData.noAO = true;
  scene.add(trunks, leaves);
}

// Low shrubs: just a small canopy sitting on the ground. list: [{ x, z, k }]
export function createBushes(scene, T, list, uTime, seed = 71) {
  if (!list.length) return;
  const rng = mulberry32(seed);
  const leaves = new THREE.InstancedMesh(canopyGeometry(seed, 16, 1.0, 0.55, 0.6), leafMaterial(T.leaf, uTime, 0.02), list.length);
  list.forEach((t, i) => {
    place(leaves, i, t.x, terrainHeight(t.x, t.z), t.z, 0, rng() * 6.28, 0, t.k * (1 + rng() * 0.3), t.k, t.k * (1 + rng() * 0.3));
    col.setHSL(0.19 + rng() * 0.08, 0.16 + rng() * 0.16, 0.42 + rng() * 0.18);
    leaves.setColorAt(i, col);
  });
  leaves.castShadow = true;
  leaves.userData.noAO = true;
  scene.add(leaves);
}

const TRUNK_BEND = 0.13;
function palmTrunkGeometry() {
  const g = new THREE.CylinderGeometry(0.02, 0.034, 1, 8, 10);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const ring = 1 + 0.07 * Math.sin(y * 150); // leaf-scar rings
    p.setXYZ(i, p.getX(i) * ring + TRUNK_BEND * y * y, y, p.getZ(i) * ring);
  }
  g.computeVertexNormals();
  return g;
}
function featherCrownGeometry(seed) {
  const rng = mulberry32(seed);
  const o = { pos: [], nor: [], uv: [] };
  const N = 17, SEG = 5;
  for (let f = 0; f < N; f++) {
    const a = (f / N) * Math.PI * 2 + rng() * 0.3;
    const rise = -0.25 + rng() * 1.35, L = 2.7 + rng() * 0.9, droop = 1.3 + rng() * 1.2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pt = (t) => [dx * L * t, rise * L * 0.42 * t - droop * t * t, dz * L * t];
    for (let k = 0; k < SEG; k++) {
      const t0 = k / SEG, t1 = (k + 1) / SEG;
      const p0 = pt(t0), p1 = pt(t1);
      const c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
      const b = [(p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2, (p1[2] - p0[2]) / 2];
      const wv = [-dz * 0.48, -0.1, dx * 0.48];
      card(o, c, wv, b, norm3([dx * 0.25, 1, dz * 0.25]), 0, t0, 1, t1);
    }
  }
  return cardGeometry(o);
}
function fanCrownGeometry(seed) {
  const rng = mulberry32(seed);
  const o = { pos: [], nor: [], uv: [] };
  for (let f = 0; f < 26; f++) {
    const th = rng() * Math.PI * 2, ph = Math.acos(1 - rng() * 1.5);
    const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    const side = norm3(cross3(d, [0.3, 1, 0.2]));
    const s = 0.78 + rng() * 0.3;
    const c = [d[0] * (0.3 + s), d[1] * (0.3 + s), d[2] * (0.3 + s)];
    const n = norm3([d[0] * 0.5, d[1] * 0.5 + 0.7, d[2] * 0.5]);
    card(o, c, side.map((v) => v * s), d.map((v) => v * s), n);
  }
  return cardGeometry(o);
}

// Palms. list: [{ x, z, h, ry? }]; kind 'coconut' (feather fronds) or 'palmyra' (fan leaves).
export function createPalms(scene, T, list, uTime, kind = 'coconut', seed = 81) {
  if (!list.length) return;
  const rng = mulberry32(seed);
  const bark = new THREE.MeshStandardMaterial({ map: T.rock.map, normalMap: T.rock.normalMap, roughness: 0.95, color: kind === 'coconut' ? '#8b7a66' : '#5f5348' });
  const trunks = new THREE.InstancedMesh(palmTrunkGeometry(), bark, list.length);
  const crownGeo = kind === 'coconut' ? featherCrownGeometry(seed) : fanCrownGeometry(seed);
  const crowns = new THREE.InstancedMesh(crownGeo, leafMaterial(kind === 'coconut' ? T.frond : T.fan, uTime, 0.03), list.length);
  list.forEach((t, i) => {
    const y = terrainHeight(t.x, t.z) - 0.1, ry = t.ry ?? rng() * 6.28, h = t.h;
    const bend = kind === 'coconut' ? 1 : 0.25;
    place(trunks, i, t.x, y, t.z, 0, ry, 0, h * bend, h, h * (kind === 'coconut' ? 1 : 1.5));
    const off = TRUNK_BEND * h * bend;
    const s = kind === 'coconut' ? 0.75 + h / 22 : 1.25 + h / 18;
    place(crowns, i, t.x + Math.cos(ry) * off, y + h, t.z - Math.sin(ry) * off, 0, rng() * 6.28, 0, s, s, s);
    col.setHSL(0.19 + rng() * 0.06, 0.2 + rng() * 0.2, 0.46 + rng() * 0.16);
    crowns.setColorAt(i, col);
    addCircle(t.x, t.z, 0.3);
  });
  trunks.castShadow = crowns.castShadow = true;
  crowns.userData.noAO = true;
  scene.add(trunks, crowns);
}

// ---- statues -----------------------------------------------------------------
// A standing stone elephant, head toward local -Z. Add to a StoneBuilder that uses plain rock.
export function elephant(b, X, Y, Z, ry = 0, s = 1, tint = 1) {
  const A = (g, lx, ly, lz) => b.add(xform(g.index ? g.toNonIndexed() : g, lx, ly, lz, X, Y, Z, ry, s), tint, 0.8);
  const sph = (r, sx, sy, sz) => {
    const g = new THREE.SphereGeometry(r, 14, 10);
    g.scale(sx, sy, sz);
    return g;
  };
  A(sph(1, 0.74, 0.7, 1.12), 0, 1.52, 0.12);
  for (const [lx, lz] of [[-0.42, -0.5], [0.42, -0.5], [-0.42, 0.78], [0.42, 0.78]]) A(new THREE.CylinderGeometry(0.25, 0.28, 1.15, 10), lx, 0.57, lz);
  A(sph(0.56, 0.92, 1.0, 0.95), 0, 1.78, -1.12);
  for (const sx of [-1, 1]) {
    A(sph(0.27, 1, 1, 1), sx * 0.2, 2.16, -1.12);
    A(sph(0.46, 0.16, 1.0, 0.82), sx * 0.58, 1.76, -0.9);
    const tusk = new THREE.ConeGeometry(0.06, 0.5, 8);
    tusk.rotateX(-1.9);
    A(tusk, sx * 0.24, 1.36, -1.62);
  }
  // trunk: a chain of tapering segments that hangs and curls forward
  let ty = 1.6, tz = -1.56, ang = 0.25;
  for (let i = 0; i < 6; i++) {
    const r = 0.21 - i * 0.022;
    const g = new THREE.CylinderGeometry(r - 0.02, r, 0.3, 8);
    g.rotateX(ang);
    A(g, 0, ty, tz);
    ty -= Math.cos(ang) * 0.26;
    tz -= Math.sin(ang) * 0.26 * (i < 3 ? 1 : -1.2);
    ang += i < 3 ? -0.1 : -0.35;
  }
  A(new THREE.CylinderGeometry(0.03, 0.045, 0.9, 6), 0, 1.3, 1.22);
  addCircle(X, Z, 1.15 * s);
}

// A reclining bull (Nandi), head toward local -Z.
export function bull(b, X, Y, Z, ry = 0, s = 1, tint = 1) {
  const A = (g, lx, ly, lz) => b.add(xform(g.index ? g.toNonIndexed() : g, lx, ly, lz, X, Y, Z, ry, s), tint, 0.8);
  const sph = (r, sx, sy, sz) => {
    const g = new THREE.SphereGeometry(r, 12, 9);
    g.scale(sx, sy, sz);
    return g;
  };
  A(sph(1, 0.55, 0.5, 1.0), 0, 0.5, 0.1);
  A(sph(0.34, 1, 1, 1), 0, 0.98, -0.42); // hump
  A(sph(0.36, 0.85, 1, 1.2), 0, 0.82, -1.05);
  A(sph(0.2, 0.9, 0.8, 1.2), 0, 0.66, -1.38);
  for (const sx of [-1, 1]) {
    A(new THREE.ConeGeometry(0.06, 0.26, 6), sx * 0.2, 1.2, -1.0);
    A(sph(0.18, 1, 0.6, 2.0), sx * 0.42, 0.16, -0.75); // folded forelegs
  }
  addCircle(X, Z, 0.95 * s);
}

// ---- architecture ------------------------------------------------------------
// A monumental gate: two carved piers, lintel, cornice and a crown of little shrines.
// The passage runs along Z; the gate is centred on (cx, cz).
export function gateway(b, cx, cz, y0, o = {}) {
  const { open = 4, pier = 3.4, depth = 3, h = 5.2, niches = null, crown = true } = o;
  for (const sx of [-1, 1]) {
    const px = cx + sx * (open / 2 + pier / 2);
    b.box(pier + 0.6, 0.4, depth + 0.6, px, y0, cz, 0.84);
    b.box(pier + 0.3, 0.3, depth + 0.3, px, y0 + 0.4, cz, 0.92);
    b.box(pier, h, depth, px, y0 + 0.7, cz, 0.98);
    for (const ex of [-1, 1]) for (const ez of [-1, 1]) {
      b.box(0.36, h, 0.36, px + ex * (pier / 2 - 0.1), y0 + 0.7, cz + ez * (depth / 2 - 0.06), 1.06, 0.8);
    }
    b.box(pier + 0.24, 0.2, depth + 0.24, px, y0 + 0.7 + h * 0.2, cz, 0.9, 0.7);
    if (niches) {
      for (const ez of [-1, 1]) {
        niches.push({ x: px, y: y0 + 0.9 + h * 0.2, z: cz + ez * (depth / 2 + 0.015), ry: ez > 0 ? 0 : Math.PI, w: pier * 0.46, h: h * 0.62 });
      }
    }
    addBox(px - pier / 2 - 0.3, px + pier / 2 + 0.3, cz - depth / 2 - 0.3, cz + depth / 2 + 0.3);
  }
  const W = open + pier * 2;
  let y = y0 + 0.7 + h;
  b.box(W + 0.9, 0.36, depth + 0.9, cx, y, cz, 0.86, 0.6);
  y += 0.36;
  b.box(W + 0.3, 1.0, depth + 0.2, cx, y, cz, 0.96);
  y += 1.0;
  b.box(W + 1.1, 0.3, depth + 1.0, cx, y, cz, 0.84, 0.6);
  y += 0.3;
  if (crown) {
    const n = Math.max(3, Math.round(W / 1.7));
    for (let i = 0; i < n; i++) {
      const x = cx + ((i + 0.5) / n - 0.5) * W;
      if (Math.abs(x - cx) < open * 0.45) continue;
      b.box(0.9, 0.7, 0.9, x, y, cz, 0.95);
      b.solid(dome(0.56), x, y + 0.7, cz, 0.9, Math.PI / 8);
      b.box(0.12, 0.3, 0.12, x, y + 1.12, cz, 0.8);
    }
    // central barrel-roofed sala over the passage
    b.box(open + 0.8, 1.1, depth * 0.72, cx, y, cz, 0.97);
    b.box(open + 1.3, 0.2, depth * 0.72 + 0.5, cx, y + 1.1, cz, 0.86, 0.6);
    const roof = new THREE.CylinderGeometry(depth * 0.36, depth * 0.36, open + 1.0, 12, 1, false, 0, Math.PI);
    roof.rotateZ(Math.PI / 2);
    b.solid(roof, cx, y + 1.3, cz, 0.9);
    for (let i = 0; i < 5; i++) b.box(0.14, 0.34, 0.14, cx + (i - 2) * (open / 5), y + 1.3 + depth * 0.36, cz, 0.8);
    y += 1.3 + depth * 0.36;
  }
  return y;
}

// An axis-aligned wall with base course and coping. Blocks the player; camera sees over it.
export function wallRun(b, x1, z1, x2, z2, y0, h = 2.2, th = 0.7, tint = 0.94) {
  const w = Math.abs(x2 - x1) + th, d = Math.abs(z2 - z1) + th;
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  b.box(w + 0.2, 0.3, d + 0.2, cx, y0, cz, tint * 0.9);
  b.box(w, h, d, cx, y0, cz, tint);
  b.box(w + 0.26, 0.2, d + 0.26, cx, y0 + h, cz, tint * 0.9, 0.6);
  addBox(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, y0 + h + 0.8);
}

// A small roadside shrine: a one- or two-tier tower with carved niches.
export function shrine(b, x, z, y0, S, tiers, niches, wallH = 2.4) {
  const top = vimana(b, x, z, y0, S, wallH, tiers, niches);
  const hb = S / 2 + 0.8;
  addBox(x - hb, x + hb, z - hb, z + hb);
  return top;
}

// A square pillar with base, cushion capital and bracket, standing on (x, y, z).
export function pillar(b, x, y, z, h, w = 0.55, tint = 1.02) {
  b.box(w + 0.3, 0.3, w + 0.3, x, y, z, tint * 0.9);
  b.box(w, h * 0.3, w, x, y + 0.3, z, tint);
  b.solid(new THREE.CylinderGeometry(w * 0.5, w * 0.5, h * 0.34, 8), x, y + 0.3 + h * 0.47, z, tint, Math.PI / 8);
  b.box(w, h * 0.16, w, x, y + 0.3 + h * 0.64, z, tint);
  b.solid(new THREE.CylinderGeometry(w * 0.72, w * 0.48, h * 0.1, 10), x, y + 0.3 + h * 0.85, z, tint * 0.95);
  b.box(w + 0.5, h * 0.1 - 0.02, w + 0.5, x, y + 0.3 + h * 0.9, z, tint * 0.9, 0.6);
}

// ---- the market --------------------------------------------------------------
function potGeometry(s = 1) {
  const pts = [[0.001, 0], [0.16, 0], [0.26, 0.14], [0.3, 0.32], [0.24, 0.5], [0.13, 0.58], [0.12, 0.64], [0.17, 0.68]]
    .map(([x, y]) => new THREE.Vector2(x * s, y * s));
  return new THREE.LatheGeometry(pts, 12);
}

// Clay pots standing on the ground. spots: [x, z, scale]
export function pots(batch, spots, solid = true) {
  for (const [x, z, s] of spots) {
    const g = potGeometry(s);
    g.translate(x, groundHeight(x, z), z);
    batch.add('clay', g);
    if (solid) addCircle(x, z, 0.24 * s);
  }
}

// A market stall: timber frame, tiled lean-to roof, cloth awning, a table of pots and fruit.
// Faces local +Z; ry must be a multiple of 90 degrees (its collider is axis-aligned).
export function stall(batch, x, z, ry, cloth = 'clothA', seed = 1) {
  const rng = mulberry32(seed * 97 + 5);
  const y = groundHeight(x, z);
  const put = (key, g, lx, ly, lz, rx = 0, rz = 0) => {
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    batch.add(key, xform(g, lx, ly, lz, x, y, z, ry));
  };
  for (const [px, pz, ph] of [[-2.1, -1.2, 3.0], [2.1, -1.2, 3.0], [-2.1, 1.2, 2.35], [2.1, 1.2, 2.35]]) {
    put('wood', new THREE.CylinderGeometry(0.07, 0.085, ph, 7), px, ph / 2, pz);
  }
  put('tile', new THREE.BoxGeometry(5.0, 0.1, 3.3), 0, 2.74, 0, 0.27);
  put('wood', new THREE.BoxGeometry(4.6, 0.09, 0.09), 0, 3.02, -1.2);
  put('wood', new THREE.BoxGeometry(4.6, 0.09, 0.09), 0, 2.36, 1.2);
  // awning sagging out over the front
  const aw = new THREE.PlaneGeometry(4.3, 1.7, 8, 4);
  const ap = aw.attributes.position;
  for (let i = 0; i < ap.count; i++) ap.setZ(i, -0.12 * Math.sin((ap.getX(i) / 4.3 + 0.5) * Math.PI) - 0.05 * Math.sin(ap.getX(i) * 4));
  aw.computeVertexNormals();
  put(cloth, aw, 0, 2.08, 2.0, -1.2);
  for (const px of [-2.1, 2.1]) put('wood', new THREE.CylinderGeometry(0.035, 0.04, 2.0, 6), px, 1.0, 2.75);
  // table
  put('wood', new THREE.BoxGeometry(3.7, 0.09, 1.25), 0, 0.86, 0.75);
  for (const [px, pz] of [[-1.7, 0.25], [1.7, 0.25], [-1.7, 1.25], [1.7, 1.25]]) put('wood', new THREE.BoxGeometry(0.1, 0.84, 0.1), px, 0.42, pz);
  // wares
  let tx = -1.5;
  while (tx < 1.5) {
    const kind = rng();
    if (kind < 0.4) {
      put('clay', potGeometry(0.5 + rng() * 0.25), tx, 0.9, 0.55 + rng() * 0.4);
    } else {
      put('basket', new THREE.CylinderGeometry(0.27, 0.2, 0.2, 10), tx, 1.0, 0.75);
      const fruit = rng() < 0.5 ? 'fruitA' : 'fruitB';
      for (let k = 0; k < 9; k++) {
        const a = rng() * 6.28, r = rng() * 0.17;
        put(fruit, new THREE.SphereGeometry(0.075, 7, 5), tx + Math.cos(a) * r, 1.12 + rng() * 0.07 + (0.17 - r) * 0.5, 0.75 + Math.sin(a) * r);
      }
    }
    tx += 0.62;
  }
  for (let k = 0; k < 4; k++) { // gourds and bundles hanging from the front beam
    put(k % 2 ? 'fruitB' : 'clay', new THREE.SphereGeometry(0.11, 8, 6), -1.5 + k * 1.0, 2.05, 1.22);
    put('wood', new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), -1.5 + k * 1.0, 2.25, 1.22);
  }
  // sacks and big jars on the ground beside the stall
  for (const [px, pz, s] of [[-2.7, 0.9, 1.25], [2.75, 0.5, 1.05], [2.6, 1.35, 0.8]]) put('clay', potGeometry(s), px, 0, pz);
  const c = Math.round(Math.cos(ry)), s = Math.round(Math.sin(ry));
  const hw = Math.abs(c) ? 2.0 : 0.75, hd = Math.abs(c) ? 0.75 : 2.0;
  addBox(x + s * 0.75 - hw, x + s * 0.75 + hw, z + c * 0.75 - hd, z + c * 0.75 + hd, y + 1.3);
  for (const [px, pz] of [[-2.1, -1.2], [2.1, -1.2]]) addCircle(x + px * c + pz * s, z - px * s + pz * c, 0.12);
}

export function marketMaterials(T) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  T.tile.map.repeat.set(5, 3);
  T.tile.normalMap.repeat.set(5, 3);
  return {
    wood: std({ map: T.wood.map, normalMap: T.wood.normalMap, roughness: 0.85, color: '#9a8468' }),
    tile: std({ map: T.tile.map, normalMap: T.tile.normalMap, roughness: 0.8, color: '#d9b8a0' }),
    clothA: std({ map: T.clothA, roughness: 0.92, side: THREE.DoubleSide }),
    clothB: std({ map: T.clothB, roughness: 0.92, side: THREE.DoubleSide }),
    clay: std({ color: '#a8603c', roughness: 0.82 }),
    basket: std({ map: T.wood.map, color: '#c7a56a', roughness: 0.95 }),
    fruitA: std({ color: '#d98a1c', roughness: 0.55 }),
    fruitB: std({ color: '#7a9a2c', roughness: 0.6 }),
    iron: std({ color: '#2b2622', roughness: 0.6, metalness: 0.7 }),
  };
}

// An iron fire bowl on a tripod (add a fire above it with createFires).
export function brazier(batch, x, z) {
  const y = groundHeight(x, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.025, 0.03, 1.25, 5);
    g.rotateZ(0.28);
    g.rotateY(a);
    g.translate(x + Math.cos(a) * 0.17, y + 0.58, z - Math.sin(a) * 0.17);
    batch.add('iron', g);
  }
  const bowl = new THREE.LatheGeometry([[0.001, 0], [0.2, 0.04], [0.34, 0.16], [0.38, 0.26]].map(([a, b2]) => new THREE.Vector2(a, b2)), 12);
  bowl.translate(x, y + 1.08, z);
  batch.add('iron', bowl);
  addCircle(x, z, 0.3);
  return [x, y + 1.42, z, 1.5];
}

// ---- fire, dust, birds, beacon -------------------------------------------------
// Always-burning fires. spots: [x, y, z, scale]
export function createFires(scene, sprite, flameTex, spots) {
  const fires = spots.map(([x, y, z, s]) => {
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(2.8, 1.9, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    flame.position.set(x, y, z);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: new THREE.Color(1.3, 0.7, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5 }));
    halo.position.set(x, y, z);
    halo.scale.set(2.4 * s, 2.4 * s, 1);
    scene.add(flame, halo);
    return { x, y, z, s, flame };
  });
  const light = new THREE.PointLight('#ffa64d', 0, 11, 1.7);
  scene.add(light);
  function update(time, player) {
    let best = null, bestD = 1e9;
    for (const f of fires) {
      const k = 1 + Math.sin(time * 12 + f.x * 3) * 0.1 + Math.sin(time * 23 + f.z) * 0.07;
      f.flame.scale.set(0.36 * f.s * k, 0.62 * f.s * (2 - k), 1);
      f.flame.position.y = f.y + 0.05 * f.s * (2 - k);
      const d = Math.hypot(f.x - player.x, f.z - player.z);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best && bestD < 32) {
      light.position.set(best.x, best.y + 0.3, best.z);
      light.intensity = 9 * best.s * (1 + Math.sin(time * 13) * 0.1);
    } else light.intensity = 0;
  }
  return { update };
}

// Sunlit dust and pollen drifting around the player.
export function createDust(scene, sprite, color = '#ffe2b0', count = 260) {
  const R = 13;
  const pos = new Float32Array(count * 3);
  const rng = mulberry32(404);
  for (let i = 0; i < count; i++) pos.set([(rng() - 0.5) * 2 * R, rng() * 6, (rng() - 0.5) * 2 * R], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: sprite, color, size: 0.03, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  function update(dt, time, player) {
    for (let i = 0; i < count; i++) {
      let x = pos[i * 3] + (0.25 + Math.sin(time * 0.6 + i) * 0.2) * dt;
      let y = pos[i * 3 + 1] + Math.sin(time * 0.8 + i * 1.7) * 0.1 * dt;
      let z = pos[i * 3 + 2] + Math.cos(time * 0.5 + i * 0.6) * 0.18 * dt;
      // keep the cloud wrapped around the player
      if (x - player.x > R) x -= 2 * R; else if (x - player.x < -R) x += 2 * R;
      if (z - player.z > R) z -= 2 * R; else if (z - player.z < -R) z += 2 * R;
      if (y - player.y > 6.5) y -= 6; else if (y - player.y < 0.2) y += 6;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { update };
}

// A few birds wheeling high overhead.
export function createBirds(scene, cx, cz, height = 34, count = 9, seed = 12) {
  const rng = mulberry32(seed);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.25, 1, 0.12, 0.1, 0, 0, 0.25, 0, 0, -0.25, 0, 0, 0.25, -1, 0.12, 0.1], 3));
  const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#1c1a1a', side: THREE.DoubleSide }), count);
  mesh.frustumCulled = false;
  mesh.userData.noAO = true;
  const birds = Array.from({ length: count }, () => ({
    r: 18 + rng() * 60, a: rng() * 6.28, w: (0.08 + rng() * 0.08) * (rng() < 0.5 ? -1 : 1), y: height + rng() * 22, ph: rng() * 6, ox: (rng() - 0.5) * 60, oz: (rng() - 0.5) * 60,
  }));
  scene.add(mesh);
  function update(time) {
    birds.forEach((b, i) => {
      const a = b.a + time * b.w;
      const flap = 0.6 + 0.4 * Math.sin(time * 7 + b.ph);
      place(mesh, i, cx + b.ox + Math.cos(a) * b.r, b.y + Math.sin(time * 0.4 + b.ph) * 2, cz + b.oz + Math.sin(a) * b.r, 0, -a + (b.w > 0 ? 0 : Math.PI), 0, 0.9 * flap + 0.3, 1 + (1 - flap) * 3, 0.9);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { update };
}

// The shaft of light that marks where to go once an area's tasks are done.
export function createBeacon(scene, beamTex, sprite, x, z) {
  const y = groundHeight(x, z);
  const group = new THREE.Group();
  const mk = (rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 16), new THREE.MeshBasicMaterial({
      map: beamTex, color: new THREE.Color(2.6, 1.8, 0.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    m.position.y = 8;
    m.rotation.y = rot;
    return m;
  };
  const a = mk(0), b = mk(Math.PI / 2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: new THREE.Color(1.8, 1.1, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
  glow.scale.set(5, 5, 1);
  glow.position.y = 0.8;
  group.add(a, b, glow);
  group.position.set(x, y, z);
  group.visible = false;
  group.traverse((o) => (o.userData.noAO = true));
  const light = new THREE.PointLight('#ffb35a', 0, 18, 1.6);
  light.position.set(x, y + 2, z);
  scene.add(group, light);
  let on = 0;
  return {
    x, z,
    show() { group.visible = true; },
    update(dt, time) {
      if (!group.visible) return;
      on = Math.min(1, on + dt * 0.5);
      const p = 0.85 + 0.15 * Math.sin(time * 3);
      a.material.opacity = b.material.opacity = 0.55 * on * p;
      glow.material.opacity = 0.7 * on * p;
      light.intensity = 30 * on * p;
    },
  };
}

// ---- stone benches to rest on ---------------------------------------------------
// list: [{ x, z, yaw }] - the middle of each bench and the way a sitter faces (quarter turns only,
// so the collision box is exact). Returns [{ x, z, yaw, top }]: the middle of the front edge,
// the facing, and the height of the seat, which is all the game needs to sit the warrior down.
export function createSeats(scene, tex, tint, list, bright = 1) {
  const b = new StoneBuilder(77);
  const W = 1.7, D = 0.52, H = 0.46;
  const seats = list.map((s) => {
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const alongX = Math.abs(fz) > 0.5; // the bench runs along X when the sitter faces down Z
    const w = alongX ? W : D, d = alongX ? D : W;
    const ex = s.x + (fx * D) / 2, ez = s.z + (fz * D) / 2;
    const top = groundHeight(ex + fx * 0.12, ez + fz * 0.12) + H; // measured from where the feet will be
    const base = Math.min(groundHeight(s.x, s.z), top - H) - 0.35;
    for (const side of [-1, 1]) {
      const o = side * (W / 2 - 0.3);
      b.box(alongX ? 0.34 : D - 0.1, top - 0.12 - base, alongX ? D - 0.1 : 0.34, s.x + (alongX ? o : 0), base, s.z + (alongX ? 0 : o), 0.88);
    }
    b.box(w, 0.13, d, s.x, top - 0.13, s.z, 1.0, 0.85);
    addBox(s.x - w / 2, s.x + w / 2, s.z - d / 2, s.z + d / 2, top + 0.2);
    return { x: ex, z: ez, yaw: s.yaw, top };
  });
  stoneMesh(scene, b, tex, tint, 1.2, bright);
  return seats;
}
