// The Shore Temple compound and the carved cliff across the inlet.
// Everything is assembled from simple solids and merged into a few meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, mulberry32, smoothstep } from './noise.js';
import { COURT, FLAT_Y, CLIFF, cliffFaceX, cliffHeightAt, addBox } from './world.js';

const UV_SCALE = 1 / 4; // masonry texture repeats every 4 m

export class StoneBuilder {
  constructor(seed = 7) {
    this.parts = [];
    this.rng = mulberry32(seed);
  }
  // Adds a geometry already placed in world space: bakes tint, fake AO and box-projected UVs.
  add(geo, tint = 1, aoBottom = 0.74) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const n = pos.count;
    const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const jit = tint * (0.9 + this.rng() * 0.2);
    const hgt = Math.max(bb.max.y - bb.min.y, 1e-3);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
      const c = jit * (aoBottom + (1 - aoBottom) * ((y - bb.min.y) / hgt));
      col[i * 3] = c;
      col[i * 3 + 1] = c * 0.98;
      col[i * 3 + 2] = c * 0.95;
      let u, v;
      if (ax >= ay && ax >= az) { u = z; v = y; }
      else if (az >= ay) { u = x; v = y; }
      else { u = x; v = z; }
      uv[i * 2] = u * UV_SCALE;
      uv[i * 2 + 1] = v * UV_SCALE;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', pos);
    out.setAttribute('normal', nor);
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(out);
  }
  // Box whose bottom-centre is at (x, y, z).
  box(w, h, d, x, y, z, tint = 1, ao = 0.74) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    this.add(g, tint, ao);
  }
  solid(geo, x, y, z, tint = 1, ry = 0) {
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    this.add(geo, tint, 0.8);
  }
  build() {
    return mergeGeometries(this.parts, false);
  }
}

export function dome(r, squash = 0.8) {
  const g = new THREE.SphereGeometry(r, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, squash, 1);
  return g;
}

// Row of miniature shrines (kutas at the corners, barrel-roofed salas between).
export function parapet(b, cx, cz, y, s, f) {
  const e = s / 2 - 0.32 * f;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    b.box(0.62 * f, 0.5 * f, 0.62 * f, cx + sx * e, y, cz + sz * e, 0.95);
    b.solid(dome(0.4 * f), cx + sx * e, y + 0.5 * f, cz + sz * e, 0.9, Math.PI / 8);
    b.box(0.1 * f, 0.22 * f, 0.1 * f, cx + sx * e, y + 0.78 * f, cz + sz * e, 0.8);
  }
  const m = Math.max(1, Math.floor((s - 1.6 * f) / (1.5 * f)));
  for (let i = 0; i < m; i++) {
    const t = ((i + 0.5) / m - 0.5) * (s - 1.5 * f);
    for (const side of [0, 1, 2, 3]) {
      const along = side < 2;
      const sg = side % 2 ? -1 : 1;
      const px = along ? cx + t : cx + sg * e;
      const pz = along ? cz + sg * e : cz + t;
      b.box(along ? 0.9 * f : 0.5 * f, 0.42 * f, along ? 0.5 * f : 0.9 * f, px, y, pz, 0.93);
      const roof = new THREE.CylinderGeometry(0.27 * f, 0.27 * f, 0.9 * f, 8, 1, false, 0, Math.PI);
      roof.rotateZ(Math.PI / 2); // lie on its side along X, curved face up
      if (!along) roof.rotateY(Math.PI / 2);
      b.solid(roof, px, y + 0.42 * f, pz, 0.88);
    }
  }
}

export function pilasters(b, cx, cz, y, S, h, niches) {
  const np = Math.max(3, Math.round(S / 1.5));
  const step = S / np;
  for (let i = 0; i <= np; i++) {
    const t = -S / 2 + i * step;
    b.box(0.3, h, 0.2, cx + t, y, cz + S / 2 + 0.06, 1.05, 0.8);
    b.box(0.3, h, 0.2, cx + t, y, cz - S / 2 - 0.06, 1.05, 0.8);
    b.box(0.2, h, 0.3, cx + S / 2 + 0.06, y, cz + t, 1.05, 0.8);
    b.box(0.2, h, 0.3, cx - S / 2 - 0.06, y, cz + t, 1.05, 0.8);
    if (i < np && niches) {
      const m = t + step / 2, w = step * 0.52, nh = h * 0.62, ny = y + h * 0.16;
      niches.push({ x: cx + m, y: ny, z: cz + S / 2 + 0.012, ry: 0, w, h: nh });
      niches.push({ x: cx + m, y: ny, z: cz - S / 2 - 0.012, ry: Math.PI, w, h: nh });
      niches.push({ x: cx + S / 2 + 0.012, y: ny, z: cz + m, ry: Math.PI / 2, w, h: nh });
      niches.push({ x: cx - S / 2 - 0.012, y: ny, z: cz + m, ry: -Math.PI / 2, w, h: nh });
    }
  }
  b.box(S + 0.5, 0.22, S + 0.5, cx, y + h - 0.22, cz, 0.92); // capital band
}

// A stepped pyramidal tower (vimana) with an octagonal crown.
export function vimana(b, cx, cz, y0, S, wallH, tiers, niches) {
  b.box(S + 1.6, 0.36, S + 1.6, cx, y0, cz, 0.82);
  b.box(S + 1.0, 0.34, S + 1.0, cx, y0 + 0.36, cz, 0.94);
  b.box(S + 0.5, 0.3, S + 0.5, cx, y0 + 0.7, cz, 0.86);
  let y = y0 + 1.0;
  b.box(S, wallH, S, cx, y, cz, 0.98);
  pilasters(b, cx, cz, y, S, wallH, niches);
  y += wallH;
  let s = S;
  for (let k = 0; k < tiers; k++) {
    const f = Math.pow(0.86, k);
    b.box(s + 1.0, 0.3, s + 1.0, cx, y, cz, 0.86, 0.6); // deep overhanging cornice
    y += 0.3;
    b.box(s + 0.55, 0.16, s + 0.55, cx, y, cz, 0.78);
    y += 0.16;
    parapet(b, cx, cz, y, s + 0.3, f);
    const ns = s * 0.78;
    const th = 0.65 + wallH * 0.48 * f;
    b.box(ns, th, ns, cx, y, cz, 0.96);
    pilasters(b, cx, cz, y, ns, th, null);
    y += th;
    s = ns;
  }
  b.box(s + 0.7, 0.26, s + 0.7, cx, y, cz, 0.86, 0.6);
  y += 0.26;
  const R = s * 0.42;
  b.solid(new THREE.CylinderGeometry(R * 0.86, R * 0.92, 0.7, 8), cx, y + 0.35, cz, 0.9, Math.PI / 8);
  y += 0.7;
  // octagonal shikhara
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(R * 1.18 * Math.pow(Math.cos(t * Math.PI * 0.5), 0.55) * (1 + 0.1 * Math.sin(t * Math.PI)) + 0.02, R * 1.5 * t));
  }
  b.solid(new THREE.LatheGeometry(pts, 8), cx, y, cz, 0.94, Math.PI / 8);
  b.box(R * 2.5, 0.14, R * 2.5, cx, y - 0.02, cz, 0.84);
  y += R * 1.5;
  // finial
  b.solid(new THREE.CylinderGeometry(R * 0.16, R * 0.3, R * 0.3, 8), cx, y + R * 0.15, cz, 0.85);
  b.solid(new THREE.SphereGeometry(R * 0.3, 8, 6), cx, y + R * 0.52, cz, 0.9);
  b.solid(new THREE.ConeGeometry(R * 0.14, R * 0.55, 8), cx, y + R * 1.02, cz, 0.85);
  return y + R * 1.3;
}

export function nandi(b, x, y, z, ry) {
  // a seated bull, facing outward
  const body = new THREE.BoxGeometry(0.5, 0.42, 0.95);
  body.translate(0, 0.21, 0);
  const hump = new THREE.BoxGeometry(0.34, 0.2, 0.32);
  hump.translate(0, 0.5, -0.12);
  const head = new THREE.BoxGeometry(0.3, 0.34, 0.34);
  head.translate(0, 0.42, -0.6);
  for (const g of [body, hump, head]) b.solid(g, x, y, z, 0.9, ry);
}

export const MAIN = { x: -3, z: -52, size: 8.6 };
export const SMALL = { x: 10.5, z: -43, size: 5.2 };
// Where the player has to stand to finish: in front of the mandapa door.
export const DOOR = { x: MAIN.x, z: MAIN.z + MAIN.size / 2 + 6.2 + 1.6 };

export function createTemple(scene, masonry, addPanels, tint = '#c9b9a2') {
  const b = new StoneBuilder(7);
  const niches = [];
  const y0 = FLAT_Y;

  // paved court
  const cw = COURT.maxX - COURT.minX, cd = COURT.maxZ - COURT.minZ;
  const ccx = (COURT.minX + COURT.maxX) / 2, ccz = (COURT.minZ + COURT.maxZ) / 2;
  b.box(cw + 1.4, 0.5, cd + 1.4, ccx, y0 - 0.42, ccz, 0.88, 0.9);

  // towers
  const topY = vimana(b, MAIN.x, MAIN.z, y0, MAIN.size, 3.9, 4, niches);
  vimana(b, SMALL.x, SMALL.z, y0, SMALL.size, 3.0, 2, niches);
  const hb = MAIN.size / 2 + 0.8, hs = SMALL.size / 2 + 0.8;
  addBox(MAIN.x - hb, MAIN.x + hb, MAIN.z - hb, MAIN.z + hb);
  addBox(SMALL.x - hs, SMALL.x + hs, SMALL.z - hs, SMALL.z + hs);

  // mandapa (entrance hall) in front of the main tower
  const mw = 6.6, mh = 4.0, md = 6.2;
  const mz = MAIN.z + MAIN.size / 2 + md / 2;
  b.box(mw + 1.0, 0.5, md + 0.6, MAIN.x, y0, mz, 0.86);
  b.box(mw, mh, md, MAIN.x, y0 + 0.5, mz, 0.97);
  b.box(mw + 1.1, 0.32, md + 1.1, MAIN.x, y0 + 0.5 + mh, mz, 0.86, 0.6);
  b.box(mw + 0.5, 0.3, md + 0.5, MAIN.x, y0 + 0.82 + mh, mz, 0.92);
  parapet(b, MAIN.x, mz, y0 + 1.12 + mh, mw, 0.8);
  const fz = mz + md / 2;
  for (const px of [-2.9, -1.35, 1.35, 2.9]) b.box(0.42, mh, 0.3, MAIN.x + px, y0 + 0.5, fz + 0.1, 1.05, 0.8);
  b.box(2.0, 3.0, 0.16, MAIN.x, y0 + 0.5, fz + 0.02, 0.07, 1); // dark doorway
  b.box(2.5, 0.3, 0.3, MAIN.x, y0 + 3.5, fz + 0.12, 1.0); // lintel
  for (let i = 0; i < 3; i++) b.box(3.2 - i * 0.3, 0.17, 0.5, MAIN.x, y0 + i * 0.17, fz + 1.3 - i * 0.45, 0.92, 0.9);
  for (const sx of [-1, 1]) {
    niches.push({ x: MAIN.x + sx * 2.1, y: y0 + 1.1, z: fz + 0.012, ry: 0, w: 0.95, h: 2.3 });
    niches.push({ x: MAIN.x + sx * (mw / 2 + 0.012), y: y0 + 1.1, z: mz - 1.3, ry: (sx * Math.PI) / 2, w: 0.95, h: 2.3 });
    niches.push({ x: MAIN.x + sx * (mw / 2 + 0.012), y: y0 + 1.1, z: mz + 1.3, ry: (sx * Math.PI) / 2, w: 0.95, h: 2.3 });
  }
  addBox(MAIN.x - mw / 2 - 0.4, MAIN.x + mw / 2 + 0.4, mz - md / 2, fz + 0.2);

  // a small flat-roofed shrine between the towers
  b.box(3.4, 2.6, 3.4, 4.2, y0, -55.5, 0.95);
  b.box(4.0, 0.3, 4.0, 4.2, y0 + 2.6, -55.5, 0.86, 0.6);
  parapet(b, 4.2, -55.5, y0 + 2.9, 3.6, 0.7);
  addBox(2.3, 6.1, -57.4, -53.6);

  // enclosure wall with a gate facing the path, bulls seated along the top
  const wallH = 1.5, th = 0.7, gate = 2.6;
  const wall = (x1, z1, x2, z2) => {
    const w = Math.abs(x2 - x1) + th, d = Math.abs(z2 - z1) + th;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    b.box(w, wallH, d, cx, y0, cz, 0.94);
    b.box(w + 0.22, 0.18, d + 0.22, cx, y0 + wallH, cz, 0.84, 0.6);
    addBox(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, y0 + wallH + 0.9);
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    const count = Math.floor(len / 2.3);
    const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
      let ry;
      if (alongX) ry = pz > ccz ? Math.PI : 0;
      else ry = px > ccx ? -Math.PI / 2 : Math.PI / 2;
      nandi(b, px, y0 + wallH + 0.18, pz, ry);
    }
  };
  wall(COURT.minX, COURT.maxZ, -gate, COURT.maxZ);
  wall(gate, COURT.maxZ, COURT.maxX, COURT.maxZ);
  wall(COURT.minX, COURT.minZ, COURT.maxX, COURT.minZ);
  wall(COURT.minX, COURT.minZ, COURT.minX, COURT.maxZ);
  wall(COURT.maxX, COURT.minZ, COURT.maxX, COURT.maxZ);
  for (const sx of [-1, 1]) {
    b.box(1.0, 2.5, 1.0, sx * (gate + 0.2), y0, COURT.maxZ, 1.0);
    b.box(1.3, 0.25, 1.3, sx * (gate + 0.2), y0 + 2.5, COURT.maxZ, 0.86, 0.6);
    b.solid(dome(0.5), sx * (gate + 0.2), y0 + 2.75, COURT.maxZ, 0.9, Math.PI / 8);
  }

  const mat = new THREE.MeshStandardMaterial({
    map: masonry.map, normalMap: masonry.normalMap, normalScale: new THREE.Vector2(1.3, 1.3),
    roughness: 0.96, metalness: 0, vertexColors: true, color: tint,
  });
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  // carved figures in the wall niches
  addPanels(scene, niches);

  // the glow that wakes in the doorway once every lamp is lit
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3.2, 1.9, 0.7), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.9), glowMat);
  glow.position.set(MAIN.x, y0 + 0.5 + 1.45, fz + 0.12);
  glow.userData.noAO = true;
  scene.add(glow);
  const doorLight = new THREE.PointLight('#ffb35a', 0, 16, 1.6);
  doorLight.position.set(MAIN.x, y0 + 2, fz + 1.2);
  scene.add(doorLight);

  return { mesh, glow, doorLight, topY };
}

// ---- cliff -------------------------------------------------------------------
export function createCliff(scene, relief, rock) {
  const SU = 170, SV = 34;
  const geo = new THREE.PlaneGeometry(1, 1, SU, SV);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const FACE = 0.72; // fraction of the profile that is the carved face
  const grass = new THREE.Color('#6f7a45'), stone = new THREE.Color('#ffffff');
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const z = CLIFF.zMin + u * (CLIFF.zMax - CLIFF.zMin);
    const H = cliffHeightAt(z);
    const face = cliffFaceX(z);
    let x, y;
    if (v <= FACE) {
      const t = v / FACE;
      y = -3 + (H + 3) * t;
      x = face + 2.2 * t * t;
      // boulder bulges and vertical crevices in the face
      x -= (fbm(z * 0.07, y * 0.16, 4) - 0.5) * 5.5 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5);
      x += smoothstep(0.62, 0.7, fbm(z * 0.35, 2.1, 2)) * 1.2;
    } else {
      const t = (v - FACE) / (1 - FACE);
      const ang = t * Math.PI * 0.5;
      x = face + 2.2 + Math.sin(ang) * 3 + t * t * 34;
      y = H + (1 - Math.cos(ang)) * 1.6 + fbm(z * 0.05, x * 0.05, 3) * 2.2 * t - t * t * 2;
    }
    pos.setXYZ(i, x, y, z);
    uv.setXY(i, u, Math.min(1, v / FACE));
    const top = smoothstep(FACE + 0.05, FACE + 0.3, v);
    c.copy(stone).lerp(grass, top * 0.85);
    const shade = v <= FACE ? 0.78 + 0.22 * (v / FACE) : 1;
    col[i * 3] = c.r * shade;
    col[i * 3 + 1] = c.g * shade;
    col[i * 3 + 2] = c.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: relief.map, normalMap: relief.normalMap, normalScale: new THREE.Vector2(2.4, 2.4),
    roughness: 0.94, metalness: 0, vertexColors: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  // scrubby trees along the top
  const rng = mulberry32(31);
  const crown = new THREE.IcosahedronGeometry(1, 2);
  const cp = crown.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const k = 0.78 + fbm(cp.getX(i) * 2 + 5, cp.getY(i) * 2 + cp.getZ(i) * 3, 3) * 0.5;
    cp.setXYZ(i, cp.getX(i) * k, cp.getY(i) * k * 0.72, cp.getZ(i) * k);
  }
  crown.computeVertexNormals();
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3f5a2a', roughness: 0.95, flatShading: true });
  const COUNT = 26;
  const trees = new THREE.InstancedMesh(crown, leafMat, COUNT);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const z = CLIFF.zMin + 24 + rng() * (CLIFF.zMax - CLIFF.zMin - 48);
    const k = 2.4 + rng() * 2.6;
    p.set(cliffFaceX(z) + 8 + rng() * 16, cliffHeightAt(z) + 1.2 + k * 0.5, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    s.set(k * (0.9 + rng() * 0.5), k, k * (0.9 + rng() * 0.5));
    m4.compose(p, q, s);
    trees.setMatrixAt(i, m4);
    trees.setColorAt(i, new THREE.Color().setHSL(0.24 + rng() * 0.05, 0.36, 0.2 + rng() * 0.08));
  }
  scene.add(trees);
  return mesh;
}
