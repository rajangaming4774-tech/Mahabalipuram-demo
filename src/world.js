// World layout. The top half dispatches to whichever area is active; the rest is
// the layout of the Shore Temple area (land, sea, path, temple and cliff).
// Units are metres. The player starts at +Z and walks toward -Z (the temple).
import { fbm, smoothstep, clamp01, lerp } from './noise.js';

// ---- the active world --------------------------------------------------------
// Every area (chapter) supplies its own definition; the rest of the game only
// ever talks to these dispatchers, so the same builders work in every area.
let W = null;
export function setWorld(def) { W = def; }
export function getWorld() { return W; }
export const terrainHeight = (x, z) => W.terrainHeight(x, z);
export const groundHeight = (x, z) => W.groundHeight(x, z);
export const landDist = (x, z) => W.landDist(x, z);
export const flatness = (x, z) => W.flatness(x, z);
export const walkable = (x, z) => W.walkable(x, z);
export const ceilingAt = (x, z) => (W.ceilingAt ? W.ceilingAt(x, z) : Infinity);

export const FLAT_Y = 1.55; // height of the path / temple court
export const COURT = { minX: -19, maxX: 19, minZ: -74, maxZ: -27 };
export const START = { x: 0.4, z: 24 };
export const PATH = { zStart: 66, zEnd: -27, halfWidth: 2.4 };
export const TERRAIN = { size: 400, cx: 0, cz: -10, seg: 256 };
export const CLIFF = { zMin: -88, zMax: 58, height: 17 };

// Sun sits low, front-left of the walk toward the temple (golden hour).
export const SUN_DIR = (() => {
  const v = [-0.8, 0.24, -0.5];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();

export function pathX(z) {
  return 1.6 * Math.sin(z * 0.045) * clamp01((z + 27) / 20);
}

export function shoreX(z) {
  return 24 + 5 * Math.sin(z * 0.035 + 1) + 2.5 * Math.sin(z * 0.11);
}

export function cliffFaceX(z) {
  return 62 + 3 * Math.sin(z * 0.04 + 2) + 1.5 * Math.sin(z * 0.13);
}

// Height profile of the cliff along its length (0 at both ends).
export function cliffHeightAt(z) {
  const ends = smoothstep(CLIFF.zMin, CLIFF.zMin + 22, z) * (1 - smoothstep(CLIFF.zMax - 22, CLIFF.zMax, z));
  return CLIFF.height * ends * (0.82 + 0.3 * fbm(z * 0.03, 4.2, 3));
}

function smin(a, b, k) {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

// Signed distance to the coastline: positive on land, negative in the sea.
function shoreLandDist(x, z) {
  const dE = shoreX(z) - x;
  const coastZ = -80 + Math.max(0, -x - 30) * 0.55;
  const dN = z - coastZ;
  const wobble = (fbm(x * 0.06, z * 0.06, 3) - 0.5) * 5;
  return smin(dE, dN, 10) + wobble;
}

// How flat the ground is forced to be (path + temple court).
function shoreFlatness(x, z) {
  let p = 0;
  if (z < PATH.zStart + 8 && z > PATH.zEnd - 2) {
    p = 1 - smoothstep(2.8, 7, Math.abs(x - pathX(z)));
    p *= 1 - smoothstep(PATH.zStart, PATH.zStart + 8, z);
  }
  const dx = Math.max(COURT.minX - x, 0, x - COURT.maxX);
  const dz = Math.max(COURT.minZ - z, 0, z - COURT.maxZ);
  const c = 1 - smoothstep(1, 6, Math.hypot(dx, dz));
  return Math.max(p, c);
}

function shoreTerrainHeight(x, z) {
  const d = shoreLandDist(x, z);
  let h;
  if (d > 0) {
    const inland = clamp01(d / 14);
    const dunes = (fbm(x * 0.035, z * 0.035, 4) - 0.5) * 2.4 + (fbm(x * 0.16, z * 0.16, 2) - 0.5) * 0.3;
    const hills = fbm(x * 0.012 + 7, z * 0.012, 3) * 4 * clamp01((-x - 45) / 50);
    h = 1.55 * (1 - Math.exp(-d / 5)) + (dunes + hills) * inland;
    h = lerp(h, FLAT_Y, shoreFlatness(x, z));
  } else {
    h = Math.max(-9, d * 0.2);
  }
  return h;
}

// Ground the player stands on (flagstones and court paving sit a little proud).
function shoreGroundHeight(x, z) {
  const h = shoreTerrainHeight(x, z);
  const onPath = z < PATH.zStart && z > PATH.zEnd && Math.abs(x - pathX(z)) < PATH.halfWidth;
  const inCourt = x > COURT.minX && x < COURT.maxX && z > COURT.minZ && z < COURT.maxZ;
  return h + (onPath || inCourt ? 0.08 : 0);
}

// ---- collision -------------------------------------------------------------
export const newColliders = () => ({ boxes: [], circles: [], segments: [] });

// `top` is how high the box blocks the camera (walls and buildings are tall, low things are not).
export function addBox(minX, maxX, minZ, maxZ, top = 99) {
  W.colliders.boxes.push({ minX, maxX, minZ, maxZ, top });
}
export function addCircle(x, z, r) {
  W.colliders.circles.push({ x, z, r });
}
export function addSegment(x1, z1, x2, z2, r) {
  W.colliders.segments.push({ x1, z1, x2, z2, r });
}

// Is this point inside something tall enough to hide the camera?
export function cameraBlocked(x, y, z) {
  for (const b of W.colliders.boxes) {
    if (y < b.top && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  return false;
}

// Push a circle (the player) out of every solid thing. Returns [x, z].
export function resolve(x, z, r) {
  const colliders = W.colliders;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of colliders.boxes) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      let dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // centre is inside the box: leave through the nearest face
        const l = x - b.minX, rr = b.maxX - x, t = z - b.minZ, bb = b.maxZ - z;
        const m = Math.min(l, rr, t, bb);
        if (m === l) x = b.minX - r;
        else if (m === rr) x = b.maxX + r;
        else if (m === t) z = b.minZ - r;
        else z = b.maxZ + r;
      }
    }
    for (const c of colliders.circles) {
      const dx = x - c.x, dz = z - c.z;
      const rr = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = c.x + (dx / d) * rr;
        z = c.z + (dz / d) * rr;
      }
    }
    for (const s of colliders.segments) {
      const ex = s.x2 - s.x1, ez = s.z2 - s.z1;
      const t = clamp01(((x - s.x1) * ex + (z - s.z1) * ez) / (ex * ex + ez * ez));
      const px = s.x1 + ex * t, pz = s.z1 + ez * t;
      const dx = x - px, dz = z - pz;
      const rr = r + s.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = px + (dx / d) * rr;
        z = pz + (dz / d) * rr;
      }
    }
  }
  return [x, z];
}

// Can the player stand here? (Not in deep water, not off the map.)
function shoreWalkable(x, z) {
  if (Math.abs(x - TERRAIN.cx) > 150 || Math.abs(z - TERRAIN.cz) > 150) return false;
  return shoreTerrainHeight(x, z) > -0.45;
}

// The original level: the flagstone walk to the Shore Temple.
export const shoreDef = {
  name: 'shore',
  colliders: newColliders(),
  terrain: TERRAIN,
  terrainHeight: shoreTerrainHeight,
  groundHeight: shoreGroundHeight,
  landDist: shoreLandDist,
  flatness: shoreFlatness,
  walkable: shoreWalkable,
};
