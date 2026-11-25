// Warriors: built from simple solids and animated procedurally (no model files).
// Local space: feet at the origin, facing -Z, +X is the character's right.
//   style 'hero'    - embossed bronze cuirass, black dhoti trimmed with gold, top-knot,
//                     round shield on the back, curved sword in the right hand
//   style 'raider'  - dark iron, crimson cloth, helmet, tattered cape, straight sword
//   style 'captain' - a raider with a crested helmet and bronze trim
//
// Movement is not a looping clip. Each foot is planted at a point in the WORLD and stays
// there until its next step, the legs are solved with two-bone inverse kinematics, and the
// pelvis rides on whatever the legs can reach. The stride clock advances with the distance
// actually travelled, so the feet cannot slide, on the flat or on slopes and steps.
import * as THREE from 'three';
import { getWorld } from './world.js';

const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => ease(clamp((x - a) / (b - a), 0, 1));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ground = (x, z) => {
  const W = getWorld();
  return W ? W.groundHeight(x, z) : 0;
};

// skeleton measurements (metres)
const L1 = 0.45, L2 = 0.4; // thigh, shin
const REACH = (L1 + L2) * 0.992;
const HIPW = 0.1; // hip joint to the centre line
const ANKLE = 0.075, HEEL = 0.065, BALL = 0.115; // ankle height; heel behind and ball ahead of the ankle
const PELVIS_Y = 0.92; // hip height when standing easy
const TAU = Math.PI * 2;
const X_AXIS = new THREE.Vector3(1, 0, 0);

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _v = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qf = new THREE.Quaternion();
const _e = new THREE.Euler();

export function createWarrior(T, style = 'hero') {
  const hero = style === 'hero';
  const captain = style === 'captain';
  const M = hero
    ? {
        skin: std('#8a5536', 0.58, 0),
        plate: std('#c9b08a', 0.46, 0.8, { map: T.armor.map, normalMap: T.armor.normalMap, normalScale: new THREE.Vector2(1.4, 1.4) }),
        metal: std('#8f6d3c', 0.45, 0.85, { side: THREE.DoubleSide }),
        trim: std('#a8864a', 0.42, 0.9),
        cloth: std('#17130f', 0.9, 0),
        leather: std('#3b281b', 0.8, 0.05),
        hair: std('#0f0b08', 0.5, 0.05),
        blade: std('#d0d4d8', 0.2, 1),
      }
    : {
        skin: std('#6b4632', 0.62, 0),
        plate: std('#3a3d42', 0.45, 0.85),
        metal: std(captain ? '#8d6a34' : '#4b4e54', 0.42, 0.88, { side: THREE.DoubleSide }),
        trim: std(captain ? '#c79a48' : '#77777a', 0.4, 0.9),
        cloth: std('#571613', 0.9, 0),
        leather: std('#241811', 0.85, 0),
        hair: std('#0f0b08', 0.55, 0.05),
        blade: std('#b9bec4', 0.25, 1),
      };
  const mats = Object.values(M);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const pivot = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  // ---- pelvis (its origin is at hip-joint height): broad belt, hanging waist cloths
  const pelvis = pivot(body, 0, PELVIS_Y, 0);
  pelvis.rotation.order = 'YXZ';
  add(pelvis, new THREE.CylinderGeometry(0.2, 0.19, 0.2, 14), M.cloth, 0, 0.03, 0).scale.z = 0.8;
  add(pelvis, new THREE.CylinderGeometry(0.218, 0.218, 0.1, 18), M.plate, 0, 0.12, 0).scale.z = 0.82;
  add(pelvis, new THREE.CylinderGeometry(0.224, 0.224, 0.02, 18), M.trim, 0, 0.175, 0).scale.z = 0.82;
  add(pelvis, new THREE.CylinderGeometry(0.224, 0.224, 0.02, 18), M.trim, 0, 0.065, 0).scale.z = 0.82;
  add(pelvis, new THREE.BoxGeometry(0.11, 0.11, 0.03), M.trim, 0, 0.12, -0.18);
  const flapF = pivot(pelvis, 0, 0.05, -0.165), flapB = pivot(pelvis, 0, 0.05, 0.165);
  for (const [fl, w, len] of [[flapF, 0.19, 0.46], [flapB, 0.26, 0.4]]) {
    add(fl, new THREE.BoxGeometry(w, len, 0.018), M.cloth, 0, -len / 2, 0);
    add(fl, new THREE.BoxGeometry(w + 0.004, 0.035, 0.022), M.trim, 0, -len + 0.02, 0);
    add(fl, new THREE.BoxGeometry(0.03, len, 0.022), M.trim, 0, -len / 2, 0);
  }

  // ---- legs: hip, knee, ankle and toe joints. Loose cloth to the calf, then greaves.
  // The hips hang from `body` (not the pelvis) because they are placed by the leg solver.
  const leg = (sx) => {
    const hip = pivot(body, sx * HIPW, PELVIS_Y, 0);
    add(hip, new THREE.CapsuleGeometry(0.1, 0.26, 4, 10), M.cloth, 0, -0.22, 0);
    add(hip, new THREE.BoxGeometry(0.014, 0.42, 0.04), M.trim, sx * 0.1, -0.22, 0);
    const knee = pivot(hip, 0, -L1, 0);
    add(knee, new THREE.CylinderGeometry(0.098, 0.082, 0.2, 12), M.cloth, 0, -0.08, 0);
    add(knee, new THREE.CylinderGeometry(0.086, 0.086, 0.025, 12), M.trim, 0, -0.18, 0);
    add(knee, new THREE.CylinderGeometry(0.074, 0.06, 0.22, 12), hero ? M.metal : M.plate, 0, -0.285, 0);
    add(knee, new THREE.SphereGeometry(0.07, 10, 8), hero ? M.metal : M.plate, 0, -0.02, -0.03);
    const ankle = pivot(knee, 0, -L2, 0);
    add(ankle, new THREE.SphereGeometry(0.056, 10, 8), M.leather, 0, -0.012, 0.012);
    add(ankle, new THREE.BoxGeometry(0.1, 0.06, HEEL + BALL), M.leather, 0, -ANKLE + 0.03, (HEEL - BALL) / 2);
    const toe = pivot(ankle, 0, -ANKLE + 0.016, -BALL);
    add(toe, new THREE.BoxGeometry(0.098, 0.042, 0.095), M.leather, 0, 0.005, -0.044);
    return { hip, knee, ankle, toe };
  };
  const legL = leg(-1), legR = leg(1);

  // ---- torso: cuirass, collar, neck
  const torso = pivot(pelvis, 0, 0.07, 0);
  const chest = add(torso, new THREE.CapsuleGeometry(0.2, 0.26, 6, 16), M.plate, 0, 0.3, 0);
  chest.scale.set(1.32, 1, 0.84);
  if (hero) {
    add(torso, new THREE.TorusGeometry(0.11, 0.013, 6, 22), M.trim, 0, 0.4, -0.166);
    add(torso, new THREE.SphereGeometry(0.035, 10, 8), M.trim, 0, 0.4, -0.172);
    const strap = add(torso, new THREE.BoxGeometry(0.05, 0.62, 0.016), M.leather, 0, 0.32, -0.172);
    strap.rotation.z = 0.7;
  }
  const collar = add(torso, new THREE.TorusGeometry(0.1, 0.03, 8, 18), M.trim, 0, 0.62, 0);
  collar.rotation.x = Math.PI / 2;
  add(torso, new THREE.CylinderGeometry(0.058, 0.064, 0.12, 10), M.skin, 0, 0.67, 0);

  // ---- head
  const head = pivot(torso, 0, 0.76, 0);
  head.rotation.order = 'YXZ';
  add(head, new THREE.SphereGeometry(0.11, 14, 12), M.skin).scale.set(0.92, 1.08, 1);
  add(head, new THREE.SphereGeometry(0.082, 10, 8), M.hair, 0, -0.07, -0.055).scale.set(0.95, 0.85, 0.7); // beard
  add(head, new THREE.BoxGeometry(0.03, 0.045, 0.03), M.skin, 0, 0.0, -0.108);
  if (hero) {
    add(head, new THREE.SphereGeometry(0.118, 14, 12), M.hair, 0, 0.022, 0.022).scale.set(0.98, 1.04, 1.04);
    add(head, new THREE.SphereGeometry(0.042, 10, 8), M.hair, 0, 0.14, 0.035); // top-knot
    add(head, new THREE.TorusGeometry(0.026, 0.008, 6, 12), M.trim, 0, 0.112, 0.035).rotation.x = Math.PI / 2;
    add(head, new THREE.CapsuleGeometry(0.085, 0.24, 4, 10), M.hair, 0, -0.17, 0.095).scale.set(1.3, 1, 0.6);
    const band = add(head, new THREE.TorusGeometry(0.115, 0.011, 6, 22), M.trim, 0, 0.04, 0.008);
    band.rotation.x = Math.PI / 2;
  } else {
    const helm = add(head, new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), M.metal, 0, 0.02, 0.01);
    helm.scale.set(1, 1.12, 1.05);
    add(head, new THREE.ConeGeometry(0.03, 0.12, 8), M.trim, 0, 0.2, 0.01);
    add(head, new THREE.BoxGeometry(0.022, 0.1, 0.02), M.metal, 0, 0.0, -0.125); // nose guard
    add(head, new THREE.CylinderGeometry(0.135, 0.15, 0.1, 14, 1, true, Math.PI * 0.5, Math.PI), M.metal, 0, -0.05, 0.02); // neck guard
    if (captain) {
      const crest = add(head, new THREE.BoxGeometry(0.02, 0.1, 0.22), std('#8a1a14', 0.9, 0), 0, 0.2, 0.02);
      crest.castShadow = false;
    }
  }

  // ---- arms with layered pauldrons and bracers
  const arm = (sx) => {
    const shoulder = pivot(torso, sx * 0.29, 0.5, 0);
    shoulder.rotation.z = sx * 0.13;
    add(shoulder, new THREE.SphereGeometry(0.082, 10, 8), M.skin);
    add(shoulder, new THREE.CapsuleGeometry(0.068, 0.2, 4, 10), M.skin, 0, -0.16, 0);
    const ring = add(shoulder, new THREE.TorusGeometry(0.07, 0.012, 6, 16), M.trim, 0, -0.14, 0);
    ring.rotation.x = Math.PI / 2;
    const elbow = pivot(shoulder, 0, -0.31, 0);
    add(elbow, new THREE.CapsuleGeometry(0.054, 0.2, 4, 10), M.skin, 0, -0.14, 0);
    add(elbow, new THREE.CylinderGeometry(0.068, 0.058, 0.2, 12), hero ? M.plate : M.leather, 0, -0.15, 0);
    for (const ry of [-0.06, -0.24]) add(elbow, new THREE.CylinderGeometry(0.071, 0.068, 0.025, 12), M.trim, 0, ry, 0);
    add(elbow, new THREE.SphereGeometry(0.05, 8, 8), M.skin, 0, -0.31, 0).scale.set(0.8, 1.1, 1);
    // pauldron plates ride on the torso so they do not swing wildly with the arm
    for (let i = 0; i < 3; i++) {
      const plate = add(torso, new THREE.SphereGeometry(0.155, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.metal, sx * (0.26 + i * 0.05), 0.56 - i * 0.055, 0);
      plate.scale.set(1.0, 0.55, 1.18);
      plate.rotation.z = -sx * (0.2 + i * 0.32);
    }
    return { shoulder, elbow, baseZ: sx * 0.13 };
  };
  const armL = arm(-1), armR = arm(1);

  // ---- on the back: the hero's shield, or the raider's tattered cape
  let capeGeo = null, cp = null, capeBase = null;
  if (hero) {
    const shield = pivot(torso, 0, 0.33, 0.215);
    const sideM = M.trim, faceM = std('#ffffff', 0.35, 0.75, { map: T.shield });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.03, 30), [sideM, faceM, M.leather]);
    disc.rotation.x = Math.PI / 2;
    disc.castShadow = true;
    shield.add(disc);
    const boss = add(shield, new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.trim, 0, 0, 0.012);
    boss.rotation.x = Math.PI / 2;
    shield.rotation.x = -0.06;
    mats.push(faceM);
  } else {
    capeGeo = new THREE.PlaneGeometry(0.66, 1.22, 6, 12);
    cp = capeGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const t = 0.5 - cp.getY(i) / 1.22; // 0 at the shoulders, 1 at the hem
      cp.setXYZ(i, cp.getX(i) * (0.82 + 0.3 * t), 0.53 - t * 1.22, 0.165 + t * 0.03);
    }
    capeBase = Float32Array.from(cp.array);
    const capeMat = new THREE.MeshStandardMaterial({ map: T.capeC, alphaMap: T.capeA, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.castShadow = true;
    cape.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: T.capeA, alphaTest: 0.5 });
    torso.add(cape);
  }

  // ---- sword in the right hand (local +Y runs from the grip to the tip)
  const sword = pivot(armR.elbow, 0, -0.34, 0);
  sword.rotation.x = -2.03;
  const LEN = hero ? 0.92 : 0.84;
  const bladeGeo = new THREE.BoxGeometry(0.012, LEN, hero ? 0.052 : 0.046, 1, 12, 1);
  bladeGeo.translate(0, LEN / 2 + 0.06, 0);
  const bp = bladeGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const t = (bp.getY(i) - 0.06) / LEN;
    const taper = t > 0.8 ? 1 - (t - 0.8) * 4.2 : 1;
    bp.setZ(i, bp.getZ(i) * Math.max(0.12, taper) + (hero ? 0.2 * t * t : 0)); // the hero's blade curves back
  }
  bladeGeo.computeVertexNormals();
  add(sword, bladeGeo, M.blade);
  add(sword, new THREE.BoxGeometry(0.035, 0.035, 0.18), M.trim, 0, 0.05, 0);
  add(sword, new THREE.CylinderGeometry(0.018, 0.02, 0.17, 8), M.leather, 0, -0.04, 0);
  add(sword, new THREE.SphereGeometry(0.03, 10, 8), M.trim, 0, -0.13, 0);

  if (captain) root.scale.setScalar(1.12);

  // ===========================================================================
  // animation
  // ===========================================================================
  const seed = Math.random() * 20;
  const st = {
    onStep: null,
    init: false, px: 0, pz: 0, ph: 0, vx: 0, vz: 0, speed: 0, turn: 0, accel: 0,
    phase: 0, gait: false, m: 0, r: 0, fwd: 1, rest: 1,
    py: PELVIS_Y, pvy: 0, free: 0, wasFree: false, guard: 0, airK: 0,
    breath: seed, exert: 0, look: 0, lookTo: 0, lookT: 2 + Math.random() * 3, nod: 0, nodTo: 0,
    settled: true, slide: 0, stretch: 0,
  };
  const mkFoot = (L, s) => ({
    L, s, x: 0, z: 0, gy: 0, yaw: 0, slope: 0, pitch: 0, strike: 0, since: 1,
    swing: false, timed: false, u: 0, loc0: 0, cycle: -99, sx: 0, sz: 0, sgy: 0, syaw: 0, p0: 0,
    tx: 0, tz: 0, tgy: 0, tyaw: 0, lift: 0,
    lx: 0, lz: 0, lyaw: 0, // where the foot is in the character's own space (flat ankle position)
    ax: 0, ay: 0, az: 0, ayaw: 0, apitch: 0, thigh: 0, b: 0, bt: 0, far: 0,
  });
  const feet = [mkFoot(legL, -1), mkFoot(legR, 1)];

  // per-frame root transform (set at the top of update)
  let rx = 0, ry = 0, rz = 0, hd = 0, ch = 1, sh = 0, S = 1;
  const toWx = (lx, lz) => rx + (lx * ch + lz * sh) * S;
  const toWz = (lx, lz) => rz + (-lx * sh + lz * ch) * S;
  const toLx = (wx, wz) => ((wx - rx) * ch - (wz - rz) * sh) / S;
  const toLz = (wx, wz) => ((wx - rx) * sh + (wz - rz) * ch) / S;

  // Where each foot rests when standing: a little apart, toes turned out, one foot slightly ahead.
  const homeX = (f) => f.s * (0.125 + 0.035 * st.guard);
  const homeZ = (f) => (f.s < 0 ? -0.035 - 0.17 * st.guard : 0.04 + 0.13 * st.guard);
  const homeYaw = (f) => -f.s * (0.16 + 0.12 * st.guard) + 0.22 * st.guard;

  function readRoot() {
    S = root.scale.x;
    rx = root.position.x;
    ry = root.position.y;
    rz = root.position.z;
    hd = root.rotation.y;
    ch = Math.cos(hd);
    sh = Math.sin(hd);
  }

  // How steeply the ground tilts under a foot, as a foot pitch. Step edges are not slopes.
  function slopeAt(x, z, yaw) {
    const d = 0.11 * S, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const dg = (ground(x + fx * d, z + fz * d) - ground(x - fx * d, z - fz * d)) / S;
    return Math.abs(dg) > 0.11 ? 0 : clamp(Math.atan2(dg, 0.22), -0.4, 0.4);
  }

  function plantAt(f, x, z, yaw) {
    f.swing = false;
    f.x = x;
    f.z = z;
    f.yaw = yaw;
    f.gy = ground(x, z);
    f.slope = slopeAt(x, z, yaw);
    f.since = 0;
    f.lift = 0;
  }

  // Stand both feet under the hips (after a teleport, a respawn, or at creation).
  function reset() {
    readRoot();
    for (const f of feet) {
      plantAt(f, toWx(homeX(f), homeZ(f)), toWz(homeX(f), homeZ(f)), hd + homeYaw(f));
      f.strike = 0;
      f.since = 1;
      f.pitch = 0;
      f.cycle = -99;
    }
    st.init = true;
    st.px = rx;
    st.pz = rz;
    st.ph = hd;
    st.vx = st.vz = st.speed = st.turn = st.accel = 0;
    st.gait = false;
    st.phase = 0;
    st.py = PELVIS_Y;
    st.pvy = 0;
    st.free = 0;
    st.wasFree = false;
    st.settled = true;
  }

  function liftFoot(f) {
    f.swing = true;
    f.u = 0;
    f.sx = f.x;
    f.sz = f.z;
    f.sgy = f.gy;
    f.syaw = f.yaw;
    f.p0 = f.pitch;
    f.tx = f.x;
    f.tz = f.z;
    f.tgy = f.gy;
    f.tyaw = f.yaw;
  }

  function landFoot(f, strike, loud) {
    plantAt(f, f.tx, f.tz, f.tyaw);
    f.strike = strike;
    st.rest = 0;
    if (st.onStep) st.onStep(st.r, loud);
  }

  // Two-bone leg: put the ankle at (ax, ay, az) with the foot turned and pitched as asked.
  // Everything here is in the character's own space. Returns how far short the leg fell.
  function solveLeg(L, hx, hy, hz, ax, ay, az, yaw, pitch) {
    const dx = ax - hx, dy = ay - hy, dz = az - hz;
    const D = Math.hypot(dx, dy, dz) || 1e-4;
    const Dc = clamp(D, 0.3, REACH);
    L.hip.position.set(hx, hy, hz);
    _y.set(-dx / D, -dy / D, -dz / D); // up the leg, ankle to hip
    const ky = yaw * 0.7; // the knee tracks over the toes
    _z.set(Math.sin(ky), 0, Math.cos(ky)); // behind the knee
    _x.crossVectors(_y, _z).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    _q1.setFromRotationMatrix(_m);
    const a1 = Math.acos(clamp((L1 * L1 + Dc * Dc - L2 * L2) / (2 * L1 * Dc), -1, 1));
    const kn = Math.acos(clamp((L1 * L1 + L2 * L2 - Dc * Dc) / (2 * L1 * L2), -1, 1));
    _q2.setFromAxisAngle(X_AXIS, a1);
    L.hip.quaternion.copy(_q1).multiply(_q2);
    L.knee.rotation.x = -(Math.PI - kn);
    // the foot keeps its own orientation whatever the leg above it is doing
    _qf.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    _q2.setFromAxisAngle(X_AXIS, L.knee.rotation.x);
    _q1.copy(L.hip.quaternion).multiply(_q2).invert();
    L.ankle.quaternion.copy(_q1).multiply(_qf);
    _v.set(0, -1, 0).applyQuaternion(L.hip.quaternion);
    return { thigh: Math.atan2(-_v.z, -_v.y), miss: Math.max(0, D - REACH) };
  }

  // The ankle sits above the heel or the ball of the foot depending on how the foot is pitched:
  // toes-up rocks on the heel (heel strike), toes-down rocks on the ball (push-off).
  function ankleFrom(f, lx, lz, ly, yawL, pitch, lift) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    let dy, fw;
    if (pitch >= 0) {
      dy = ANKLE * c + HEEL * s;
      fw = -(HEEL * (1 - c) + ANKLE * s);
    } else {
      dy = ANKLE * c - BALL * s;
      fw = BALL * (1 - c) - ANKLE * s;
    }
    f.ax = lx - Math.sin(yawL) * fw;
    f.az = lz - Math.cos(yawL) * fw;
    f.ay = ly + dy + lift;
    f.ayaw = yawL;
    f.apitch = pitch;
  }

  // pose: { attack, dodge: 0..1 (or -1), dead: 0..1, air: bool, vy, crouch: 0..1,
  //         sit: 0..1, seatY: seat height above the feet, guard: 0..1, look: head yaw }
  function update(dt, speedHint, time, pose = {}) {
    dt = Math.max(dt, 1e-4);
    readRoot();
    if (!st.init || Math.hypot(rx - st.px, rz - st.pz) > 1.6 * S) reset();

    // -- how the body is really moving, measured from the root, so the feet cannot disagree with it
    const kv = Math.min(1, dt * 20);
    st.vx += ((rx - st.px) / dt / S - st.vx) * kv;
    st.vz += ((rz - st.pz) / dt / S - st.vz) * kv;
    st.turn += (wrap(hd - st.ph) / dt - st.turn) * Math.min(1, dt * 12);
    const v = Math.hypot(st.vx, st.vz);
    st.accel += ((v - st.speed) / dt - st.accel) * Math.min(1, dt * 8);
    st.speed = v;
    st.px = rx;
    st.pz = rz;
    st.ph = hd;
    const ux = v > 0.02 ? st.vx / v : -sh, uz = v > 0.02 ? st.vz / v : -ch; // unit direction of travel
    if (v > 0.2) st.fwd += (ux * -sh + uz * -ch - st.fwd) * Math.min(1, dt * 8);

    const dead = pose.dead ?? 0, deadK = dead > 0 ? ease(Math.min(1, dead)) : 0;
    const dodge = pose.dodge ?? -1, dodgeK = dodge >= 0 ? Math.sin(Math.min(1, dodge) * Math.PI) : 0;
    const air = !!pose.air, vy = pose.vy ?? 0;
    const crouch = pose.crouch ?? 0;
    const sit = clamp(pose.sit ?? 0, 0, 1), seatY = pose.seatY ?? 0.46;
    const sitA = ease(clamp(sit / 0.8, 0, 1)), sitB = ease(clamp((sit - 0.12) / 0.88, 0, 1));
    st.guard += ((pose.guard ?? 0) - st.guard) * Math.min(1, dt * 5);
    const guard = st.guard;
    const freeTo = dead > 0 || dodge >= 0 || air ? 1 : 0;
    st.free += (freeTo - st.free) * Math.min(1, dt * (freeTo ? 18 : 14));
    st.airK += ((air ? 1 : 0) - st.airK) * Math.min(1, dt * 12);
    if (st.free < 0.002) st.free = 0;

    // -- gait weights and stride geometry for this speed
    st.m += (sstep(0.15, 0.9, v) * (1 - freeTo) - st.m) * Math.min(1, dt * 7);
    st.r += (sstep(2.6, 4.0, v) - st.r) * Math.min(1, dt * 6);
    const m = st.m, r = st.r, fwd = st.fwd;
    const stepLen = (v <= 2 ? 0.37 + 0.235 * v : 0.84 + (v - 2) * 0.27) * (0.72 + 0.28 * Math.max(0, fwd));
    const cycle = 2 * stepLen; // ground covered by one full stride (left step + right step)
    const sw = lerp(0.4, 0.68, r); // fraction of the stride each foot spends in the air
    const landAhead = (1 - sw) * cycle * lerp(0.44, 0.37, r);
    const halfW = lerp(0.085, 0.05, r);
    const strikeP = ((0.34 * (1 - r) + 0.1 * r) * Math.max(0, fwd) - 0.22 * Math.max(0, -fwd)) * sstep(0.2, 1, v);

    // coming back down to earth: plant the feet where they are now
    if (st.wasFree && !freeTo) {
      for (const f of feet) {
        plantAt(f, toWx(f.lx, f.lz), toWz(f.lx, f.lz), hd + f.lyaw);
        f.strike = 0;
        f.cycle = -99;
      }
      st.gait = false;
      st.rest = 0;
      if (st.onStep && dead <= 0) st.onStep(1, 1);
    }
    st.wasFree = !!freeTo;

    // -- stepping ---------------------------------------------------------------
    st.rest += dt;
    if (!freeTo) {
      if (!st.gait && v > 0.32) {
        // start walking with whichever foot is further behind (or the one already in the air)
        let first = feet[0].swing ? 0 : feet[1].swing ? 1 : -1;
        if (first < 0) {
          const pL = (feet[0].x - rx) * ux + (feet[0].z - rz) * uz, pR = (feet[1].x - rx) * ux + (feet[1].z - rz) * uz;
          first = pL <= pR ? 0 : 1;
        }
        // the first step is a short one (the stride clock starts part-way through that foot's swing),
        // so the standing foot is not left far behind before its own turn comes
        st.phase = (first ? 0.5 : 0) + (feet[first].swing ? 0 : sw * 0.45);
        st.gait = true;
        for (const f of feet) {
          f.cycle = -99;
          if (f.swing) {
            f.timed = false;
            f.loc0 = -f.u * sw / Math.max(1e-3, 1 - f.u); // carry its progress into the stride clock
            f.cycle = 0;
          }
        }
      } else if (st.gait && v < 0.18) {
        st.gait = false;
        for (const f of feet) f.timed = true;
      }

      if (st.gait) {
        // The stride clock runs on distance covered. When the body speeds up under a planted foot
        // (breaking into a run), the clock hurries so that foot lifts before the leg is over-stretched.
        const liftMax = (1 - sw) * cycle - landAhead + 0.05;
        let hurry = 1;
        for (let i = 0; i < 2; i++) {
          const f = feet[i];
          if (f.swing) continue;
          const ph = st.phase - (i ? 0.5 : 0), loc = ph - Math.floor(ph);
          if (loc < sw) continue;
          hurry = Math.max(hurry, ((1 - loc) * cycle) / Math.max(0.04, liftMax - f.bt));
        }
        st.phase += (v / cycle) * Math.min(hurry, 4) * dt;
        for (let i = 0; i < 2; i++) {
          const f = feet[i];
          const ph = st.phase - (i ? 0.5 : 0), c = Math.floor(ph), loc = ph - c;
          if (!f.swing && f.cycle !== c && loc < Math.min(sw, 0.25)) {
            f.cycle = c;
            f.loc0 = loc;
            f.timed = false;
            liftFoot(f);
          }
          if (!f.swing) {
            // through a turn the planted foot swivels on its ball instead of twisting the knee
            const ey = wrap(f.yaw - hd);
            if (Math.abs(ey) > 0.7) f.yaw = hd + Math.sign(ey) * 0.7;
            // left hopelessly behind (a sudden lurch): pick it up now rather than drag it
            if (f.far > 0.64) {
              f.cycle = loc >= sw ? c + 1 : c;
              f.timed = true;
              liftFoot(f);
            } else continue;
          }
          const quick = 0.2;
          if (f.timed) f.u = Math.min(1, f.u + dt / quick);
          else f.u = f.cycle !== c ? 1 : Math.max(f.u, clamp((loc - f.loc0) / Math.max(0.05, sw - f.loc0), 0, 1));
          // aim for where the body will be when this foot comes down
          const tR = f.timed ? (1 - f.u) * quick : ((1 - f.u) * sw * cycle) / Math.max(v, 0.3);
          const hF = hd + clamp(st.turn * tR, -0.5, 0.5);
          f.tx = rx + (st.vx * tR + ux * landAhead + Math.cos(hF) * f.s * halfW) * S;
          f.tz = rz + (st.vz * tR + uz * landAhead - Math.sin(hF) * f.s * halfW) * S;
          f.tyaw = hF - f.s * 0.07;
          f.tgy = ground(f.tx, f.tz);
          f.lift = (0.05 + 0.035 * m + 0.2 * r + Math.max(0, (f.tgy - f.sgy) / S) * 0.55) * Math.sin(Math.PI * Math.pow(f.u, 0.72));
          f.pitch = f.p0 * (1 - f.u) * (1 - f.u) + strikeP * f.u * f.u;
          if (f.u >= 1) landFoot(f, strikeP, 1);
        }
        st.settled = false;
      } else {
        // standing: finish any step in the air, then bring stray feet home one at a time
        const dur = lerp(0.3, 0.2, clamp(Math.abs(st.turn) / 3, 0, 1));
        let busy = false;
        for (const f of feet) {
          if (!f.swing) continue;
          busy = true;
          f.u = Math.min(1, f.u + dt / dur);
          const hF = hd + clamp(st.turn * (1 - f.u) * dur, -0.5, 0.5);
          const c2 = Math.cos(hF), s2 = Math.sin(hF), hx = homeX(f), hz = homeZ(f);
          f.tx = rx + (hx * c2 + hz * s2) * S;
          f.tz = rz + (-hx * s2 + hz * c2) * S;
          f.tyaw = hF + homeYaw(f);
          f.tgy = ground(f.tx, f.tz);
          f.lift = (0.045 + Math.min(0.03, Math.abs(st.turn) * 0.008) + Math.max(0, (f.tgy - f.sgy) / S) * 0.55) * Math.sin(Math.PI * f.u);
          f.pitch = f.p0 * (1 - f.u) * (1 - f.u) - 0.14 * Math.sin(Math.PI * f.u);
          if (f.u >= 1) landFoot(f, 0, 0.35);
        }
        let worst = null, ws = 1;
        for (const f of feet) {
          if (f.swing) continue;
          const ex = toLx(f.x, f.z) - homeX(f), ez = toLz(f.x, f.z) - homeZ(f);
          let ey = wrap(f.yaw - hd - homeYaw(f));
          if (Math.abs(ey) > 0.8) {
            // a hard turn: the planted foot swivels on its ball rather than twisting the knee
            f.yaw = hd + homeYaw(f) + Math.sign(ey) * 0.8;
            ey = Math.sign(ey) * 0.8;
          }
          const score = Math.max(Math.abs(ex) / 0.1, Math.abs(ez) / 0.18, Math.abs(ey) / 0.45);
          if (score > ws) {
            ws = score;
            worst = f;
          }
        }
        if (worst && sit < 0.02 && (!busy || ws > 3.4) && (st.rest > 0.1 || ws > 1.7)) {
          worst.timed = true;
          liftFoot(worst);
        }
        st.settled = !busy && !worst;
      }
    }

    // -- where each foot is, in the character's own space --------------------------
    const pzPrev = pelvis.position.z, pxPrev = pelvis.position.x;
    let slide = 0;
    for (const f of feet) {
      let wx = f.x, wz = f.z, gy = f.gy, yw = f.yaw, pitch;
      if (f.swing) {
        const e = ease(f.u);
        wx = lerp(f.sx, f.tx, e);
        wz = lerp(f.sz, f.tz, e);
        gy = lerp(f.sgy, f.tgy, e);
        yw = f.syaw + wrap(f.tyaw - f.syaw) * e;
        pitch = f.pitch;
      } else {
        f.since += dt;
        // the heel lifts as the hip passes over and beyond the foot, rolling the weight onto the toes
        const yl = wrap(f.yaw - hd);
        const lx0 = toLx(f.x, f.z), lz0 = toLz(f.x, f.z);
        const ox = pxPrev + f.s * HIPW - lx0, oz = pzPrev - lz0; // from the foot to its hip
        f.b = ox * -Math.sin(yl) + oz * -Math.cos(yl); // how far the hip has passed the foot, along the foot
        f.bt = ox * (ux * ch - uz * sh) + oz * (ux * sh + uz * ch); // ...and along the line of travel
        f.far = Math.hypot(ox, oz);
        const heel = -sstep(0.17, 0.5, Math.min(f.b, f.bt)) * (0.95 + 0.2 * r) * m * Math.max(0, fwd);
        const land = f.strike * Math.max(0, 1 - f.since / lerp(0.12, 0.06, r));
        pitch = land + heel + f.slope * (1 - sit);
        f.pitch = pitch;
      }
      if (!freeTo) {
        const nlx = toLx(wx, wz), nlz = toLz(wx, wz);
        f.lx = nlx;
        f.lz = nlz;
        f.lyaw = wrap(yw - hd);
      }
      ankleFrom(f, toLx(wx, wz), toLz(wx, wz), (gy - ry) / S, wrap(yw - hd), pitch, f.swing ? f.lift : 0);
      if (!f.swing) slide = Math.max(slide, Math.hypot(wx - (f.wx0 ?? wx), wz - (f.wz0 ?? wz)));
      f.wx0 = f.swing ? undefined : wx;
      f.wz0 = f.swing ? undefined : wz;
    }
    st.slide = slide; // metres a planted foot moved over the ground this frame (should be 0)

    // -- feet that have left the ground (leaping, dashing, falling): posed against the body instead
    if (st.free > 0) {
      const w = st.free;
      const lvx = st.vx * ch - st.vz * sh, lvz = st.vx * sh + st.vz * ch; // travel in the character's own space
      const lv = Math.hypot(lvx, lvz) || 1;
      for (const f of feet) {
        let fx = f.s * 0.11, fy = 0, fz = 0, fp = 0;
        const fyaw = -f.s * 0.1;
        if (air || st.airK > 0.01) {
          const rise = clamp(vy / 3.5, -1, 1), apex = 1 - Math.abs(rise), split = clamp(v / 3, 0, 1);
          fy += (0.05 + 0.2 * apex + 0.05 * Math.max(0, rise)) * st.airK;
          fz += (f.s < 0 ? -0.05 - 0.2 * split : 0.08 + 0.24 * split * (rise > 0 ? 1 : 0.5)) * st.airK;
          fp += (-0.4 - 0.3 * rise) * st.airK;
        }
        if (dodgeK > 0) {
          const lead = f.s < 0 ? 0.22 : -0.28;
          fx += (lvx / lv) * lead * dodgeK;
          fz += (lvz / lv) * lead * dodgeK;
          fy += 0.05 * dodgeK;
          fp -= 0.35 * dodgeK;
        }
        if (deadK > 0) {
          fx = f.s * 0.13;
          if (f.s > 0) {
            fz -= 0.2 * deadK;
            fy += 0.1 * deadK;
          }
        }
        const yl = f.ayaw, cA = f.ax, cY = f.ay, cZ = f.az, cP = f.apitch;
        ankleFrom(f, fx, fz, fy, fyaw, fp, 0);
        f.lx = lerp(f.lx, fx, w);
        f.lz = lerp(f.lz, fz, w);
        f.lyaw = lerp(f.lyaw, fyaw, w);
        f.ax = lerp(cA, f.ax, w);
        f.ay = lerp(cY, f.ay, w);
        f.az = lerp(cZ, f.az, w);
        f.ayaw = lerp(yl, f.ayaw, w);
        f.apitch = lerp(cP, f.apitch, w);
      }
    }

    // -- rhythm of the stride, shared by hips, spine and arms ------------------------
    const cph = st.phase * TAU;
    const sway = Math.cos(cph - Math.PI * sw); // +1 at the middle of the right foot's stance
    const hipLead = Math.cos(cph - TAU * sw); // +1 as the left foot strikes
    const fw01 = Math.max(0, fwd);

    // breathing: slow at rest, deep and quick after a run
    st.exert += ((r > 0.5 ? 1 : 0) - st.exert) * Math.min(1, dt * (r > 0.5 ? 0.22 : 0.11));
    st.breath += dt * (1.6 + 2.4 * st.exert);
    const bth = Math.sin(st.breath) * (1 + 1.7 * st.exert);

    // idle: weight drifting from one leg to the other, an occasional look around
    const idle = (1 - m) * (1 - st.free);
    const shift = (Math.sin(time * 0.31 + seed) * 0.62 + Math.sin(time * 0.73 + seed * 2.3) * 0.38) * idle * (1 - sitB * 0.7);
    st.lookT -= dt;
    if (st.lookT <= 0) {
      if (Math.abs(st.lookTo) > 0.05) {
        st.lookTo = 0;
        st.nodTo = 0;
        st.lookT = 3 + Math.random() * 5;
      } else {
        st.lookTo = (Math.random() - 0.5) * 1.3;
        st.nodTo = (Math.random() - 0.5) * 0.22;
        st.lookT = 1.5 + Math.random() * 2;
      }
    }
    const lookBusy = m > 0.2 || (pose.attack ?? -1) >= 0 || st.free > 0.1 || guard > 0.3;
    st.look += ((lookBusy ? 0 : st.lookTo) - st.look) * Math.min(1, dt * (lookBusy ? 5 : 2.2));
    st.nod += ((lookBusy ? 0 : st.nodTo) - st.nod) * Math.min(1, dt * 2.2);
    const look = st.look + clamp(pose.look ?? 0, -0.75, 0.75) * 0.65;

    // -- arms: each swings against the leg on its own side ---------------------------
    const aW = (0.36 * (1 - r) + 0.62 * r) * m * (0.35 + 0.65 * fw01);
    const swL = -hipLead, swR = hipLead;
    let shL = aW * swL * (swL > 0 ? 0.85 : 1.05) + 0.03 + bth * 0.01;
    let shLz = armL.baseZ - 0.03 * idle;
    let elL = 0.2 + 0.1 * m + 1.2 * r + Math.max(0, swL) * (0.3 * m - 0.1 * r);
    // the sword arm swings less: it carries the blade low and ready
    let shR = aW * swR * 0.55 + 0.07 + bth * 0.01;
    let shRz = armR.baseZ + 0.06;
    let elR = 0.28 + 0.12 * m + 0.75 * r + Math.max(0, swR) * 0.15 * m;
    let swordX = -2.03;
    // guard: blade up, shoulder turned to the enemy
    shR += 0.45 * guard;
    elR += 0.7 * guard;
    shL += 0.25 * guard;
    elL += 0.65 * guard;
    // seated: one forearm across the thigh, the sword resting point-down beside the knee
    shL = lerp(shL, 0.52, sitB);
    elL = lerp(elL, 0.8, sitB);
    shLz = lerp(shLz, -0.03, sitB);
    shR = lerp(shR, 0.16, sitB);
    elR = lerp(elR, 0.1, sitB);
    shRz = lerp(shRz, 0.3, sitB);
    swordX = lerp(swordX, -2.32, sitB);
    // in the air and on landing
    shL += 0.55 * st.airK - 0.4 * crouch;
    shR += 0.3 * st.airK - 0.3 * crouch;
    shLz -= 0.4 * st.airK;
    shRz += 0.3 * st.airK;
    elL += 0.4 * st.airK + 0.3 * crouch;
    elR += 0.3 * crouch;

    // -- spine --------------------------------------------------------------------
    const bank = clamp(st.turn * v * 0.014, -0.16, 0.16) * m; // lean into a turn
    const hinge = Math.sin(Math.PI * sit); // folding at the hips on the way down to a seat and up again
    let tx = -(0.02 + 0.04 * m + 0.17 * r) - clamp(st.accel * 0.012, -0.08, 0.1) * m - bth * 0.008;
    tx -= 0.5 * hinge + 0.1 * sitB + 0.38 * crouch + 0.85 * dodgeK;
    let ty = 0.28 * guard + look * 0.2;
    let lunge = 0;

    const p = pose.attack ?? -1;
    if (p >= 0) {
      // wind up over the shoulder, cut down across the body, recover
      if (p < 0.32) {
        const k = ease(p / 0.32);
        shR = lerp(shR, 2.75, k);
        shRz = lerp(shRz, 0.55, k);
        elR = lerp(elR, 0.75, k);
        ty = lerp(ty, -0.6, k);
      } else if (p < 0.55) {
        const k = (p - 0.32) / 0.23;
        shR = lerp(2.75, 0.5, k * k);
        shRz = lerp(0.55, -0.4, k);
        elR = lerp(0.75, 0.1, k);
        ty = lerp(-0.6, 0.65, k);
        tx -= 0.3 * k;
        lunge = k;
      } else {
        const k = ease((p - 0.55) / 0.45);
        shR = lerp(0.5, shR, k);
        shRz = lerp(-0.4, shRz, k);
        elR = lerp(0.1, elR, k);
        ty = lerp(0.65, ty, k);
        tx -= 0.3 * (1 - k);
        lunge = 1 - k;
      }
    }
    let bx = 0;
    if (deadK > 0) {
      bx = deadK * 1.5; // fall onto the back
      shR = lerp(shR, -0.4, deadK);
      shRz = lerp(shRz, 1.2, deadK);
      shLz = lerp(shLz, -1.2, deadK);
      ty *= 1 - deadK;
      tx *= 1 - deadK;
    }

    // -- pelvis: carried by the legs -------------------------------------------------
    const walkW = m * (0.3 + 0.7 * fw01);
    let pX = sway * lerp(0.024, 0.01, r) * walkW + shift * 0.022; // over the standing leg
    let pRoll = sway * lerp(0.05, 0.03, r) * walkW + shift * 0.032 + bank * 0.5; // the free hip drops
    const gaitYaw = -hipLead * lerp(0.085, 0.13, r) * walkW; // the hip follows its leg forward
    const cutYaw = p >= 0 ? ty * 0.3 : 0; // the hips turn into a sword cut
    const pYaw = gaitYaw + cutYaw;
    const pPitch = -(0.03 * m + 0.07 * r) + 0.08 * sitB - 0.12 * crouch;
    let pZ = -0.07 * lunge + 0.33 * sitA;
    // standing still, the hips settle over wherever the feet ended up
    const still = (1 - m) * (1 - st.free) * (1 - sitA);
    pX += clamp((feet[0].lx + feet[1].lx) * 0.5 * 0.55, -0.06, 0.06) * still;
    pZ += clamp((feet[0].lz + feet[1].lz) * 0.5 * 0.55, -0.08, 0.08) * still;
    for (const f of feet) if (f.swing && f.timed) pX -= f.s * 0.028 * Math.sin(Math.PI * f.u) * still; // shift off the stepping foot

    let yNom = PELVIS_Y - 0.012 * m - 0.04 * r - 0.05 * guard - 0.18 * crouch - 0.3 * dodgeK - 0.05 * lunge - Math.abs(shift) * 0.006;
    yNom -= 0.028 * r * Math.cos(2 * (cph - Math.PI * sw)); // a runner sinks at mid-stance and rises into flight
    yNom = lerp(yNom, seatY + 0.1, sitB);
    let yT = yNom, hard = 9, lowest = 0;
    if (!freeTo && st.free < 0.5) {
      const cy = Math.cos(pYaw), sy = Math.sin(pYaw), sr = Math.sin(pRoll);
      for (const f of feet) {
        const hx = pX + f.s * HIPW * cy, hz = pZ - f.s * HIPW * sy;
        const d2 = (f.ax - hx) * (f.ax - hx) + (f.az - hz) * (f.az - hz);
        const reachY = f.ay - (f.swing ? f.lift : 0) + Math.sqrt(Math.max(0.04, REACH * REACH - d2)) - f.s * HIPW * sr;
        // a planted leg holds the hips down to what it can reach; a foot about to land warns them in advance
        const w = f.swing ? sstep(0.5, 1, f.u) : 1 - r * sstep(0.2, 0.45, f.bt);
        yT = Math.min(yT, reachY + (1 - w) * 0.25);
        if (!f.swing && w > 0.95) hard = Math.min(hard, reachY);
        if (!f.swing) lowest = Math.min(lowest, f.ay - ANKLE);
      }
      // the hips never sink more than a hand's breadth to keep a foot down: past that the foot peels off
      const floor = yNom - 0.09 + lowest;
      yT = Math.max(yT, floor);
      hard = Math.max(hard, floor);
    }
    // a critically damped spring gives the hips weight: no pops, no bounce
    const om = lerp(16, 24, r) + 20 * st.free;
    st.pvy = (st.pvy + dt * om * om * (yT - st.py)) / (1 + 2 * dt * om + dt * dt * om * om);
    st.py += st.pvy * dt;
    if (st.py > hard + 0.003) {
      st.py = hard + 0.003;
      st.pvy = Math.min(st.pvy, 0);
    }
    pelvis.position.set(pX, st.py, pZ);
    pelvis.rotation.set(pPitch, pYaw, pRoll);

    // -- legs -----------------------------------------------------------------------
    let stretch = 0, thF = 0, thB = 0;
    for (const f of feet) {
      _v.set(f.s * HIPW, 0, 0).applyEuler(pelvis.rotation).add(pelvis.position);
      const res = solveLeg(f.L, _v.x, _v.y, _v.z, f.ax, f.ay, f.az, f.ayaw, f.apitch);
      f.thigh = res.thigh;
      if (!f.swing) stretch = Math.max(stretch, res.miss);
      thF = Math.max(thF, res.thigh);
      thB = Math.max(thB, -res.thigh);
      // toes stay flat on the ground while the heel peels up
      const toeTo = f.swing ? 0 : clamp(-f.apitch, 0, 1.1);
      f.L.toe.rotation.x += (toeTo - f.L.toe.rotation.x) * Math.min(1, dt * 25);
    }
    st.stretch = stretch; // metres a planted leg fell short of its foot (should be ~0)
    // waist cloths are pushed out by the thighs, and stream back at a run
    flapF.rotation.x = 0.04 + thF * 0.85 - pPitch;
    flapB.rotation.x = -(0.04 + thB * 0.6 + 0.22 * r) * (1 - sitB) - 1.2 * sitB;

    // -- upper body -------------------------------------------------------------------
    const tRoll = -pRoll * 1.5 + bank * 0.6;
    torso.rotation.set(tx - pPitch * 0.6, -gaitYaw * 1.85 + ty - cutYaw, tRoll); // shoulders turn against the hips
    torso.position.y = 0.07 + bth * 0.004;
    chest.scale.set(1.32 * (1 + bth * 0.008), 1 + bth * 0.006, 0.84 * (1 + bth * 0.035));
    armL.shoulder.position.y = armR.shoulder.position.y = 0.5 + bth * 0.006;
    armL.shoulder.rotation.x = shL;
    armL.shoulder.rotation.z = shLz;
    armL.elbow.rotation.x = elL;
    armR.shoulder.rotation.x = shR;
    armR.shoulder.rotation.z = shRz;
    armR.elbow.rotation.x = elR;
    sword.rotation.x = swordX;
    // the head stays level and looks where it means to, whatever the shoulders are doing
    const bodyYaw = pYaw + torso.rotation.y;
    head.rotation.y = look - bodyYaw * 0.85 * (p >= 0 ? 0.55 : 1);
    head.rotation.x = (0.03 + st.nod - (tx + pPitch * 0.4) * 0.6 - 0.1 * sitB) * (1 - deadK);
    head.rotation.z = -(pRoll + tRoll) * 0.75;
    body.rotation.x = bx;
    body.position.y = 0.12 * deadK;

    if (cp) {
      // cape: hangs, sways in the sea wind, streams back when moving
      const pa = cp.array, sn = Math.sin(cph);
      for (let i = 0; i < cp.count; i++) {
        const x0 = capeBase[i * 3], y0 = capeBase[i * 3 + 1], z0 = capeBase[i * 3 + 2];
        const t = (0.53 - y0) / 1.22;
        const wind = Math.sin(time * 2.1 + t * 5 + x0 * 4) * 0.035 + Math.sin(time * 3.7 + t * 9) * 0.012;
        const back = t * t * (0.07 + 0.2 * m + 0.42 * r) * (1 - deadK);
        pa[i * 3] = x0 + Math.sin(time * 1.6 + t * 4) * 0.025 * t + sn * 0.03 * t * m;
        pa[i * 3 + 1] = y0 + t * t * (0.03 * m + 0.22 * r);
        pa[i * 3 + 2] = z0 + back + wind * t * (1 + m) * (1 - deadK);
      }
      cp.needsUpdate = true;
      capeGeo.computeVertexNormals();
    }
  }

  // brief red flash when struck
  function flash(k) {
    for (const m of mats) m.emissive.setRGB(0.7 * k, 0.12 * k, 0.06 * k);
  }

  update(0.016, 0, 0);
  return { root, update, flash, reset, state: st, feet };
}
