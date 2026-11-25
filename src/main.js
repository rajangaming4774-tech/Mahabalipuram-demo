import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import * as TEX from './textures.js';
import * as TEX2 from './textures2.js';
import { buildRoad, buildRathas, buildShore, buildHeadland } from './areas.js';
import { makePanels } from './kit.js';
import { createWarrior } from './character.js';
import { createEnemies } from './combat.js';
import { createAudio } from './audio.js';
import { setWorld, groundHeight, resolve, walkable, cameraBlocked, ceilingAt } from './world.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const tick = () => new Promise((r) => setTimeout(r, 30));
// Capture the mouse for looking around; some embedded browsers refuse, which is fine (drag still works).
function lockPointer() {
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* not available here */ }
}

const CHAPTERS = [
  { id: 'road', title: 'The Temple Road', sub: 'Golden hour on the road into Mamallapuram.', build: buildRoad, sea: 0.0 },
  { id: 'rathas', title: 'The Five Rathas', sub: 'Shrines cut whole from a single ridge of rock.', build: buildRathas, sea: 0.12 },
  { id: 'shore', title: 'The Shore Temple', sub: 'Twelve centuries of salt and wind.', build: buildShore, sea: 1.0 },
  { id: 'headland', title: 'The Headland', sub: 'The last light over the sea.', build: buildHeadland, sea: 0.8 },
];

// ---- renderer ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1600);
camera.rotation.order = 'YXZ';
const emptyScene = new THREE.Scene();

// ---- post-processing: ambient occlusion, bloom, sun shafts and a cinematic grade --
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uRays: { value: 0 },
    uTint: { value: new THREE.Vector3(1.05, 1.0, 0.93) }, uSat: { value: 1.1 }, uHurt: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uRays, uSat, uHurt; uniform vec3 uTint;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (uRays > 0.001) {
        // shafts of light streaming from the sun, blocked by whatever stands in front of it
        vec2 d = (uSun - vUv) / 14.0 * 0.92;
        vec2 p = vUv;
        float w = 1.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 14; i++) {
          p += d;
          vec3 s = texture2D(tDiffuse, p).rgb;
          acc += min(s, vec3(5.0)) * smoothstep(1.7, 4.5, max(max(s.r, s.g), s.b)) * w;
          w *= 0.92;
        }
        c.rgb += acc / 14.0 * uRays * 0.34;
      }
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - dot(q, q) * (0.85 + uHurt * 1.6);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat) * uTint;
      c.rgb = mix(c.rgb, vec3(l * 1.3, l * 0.2, l * 0.15), uHurt * dot(q, q) * 2.2);
      gl_FragColor = c;
    }`,
};
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 2 }));
const renderPass = new RenderPass(emptyScene, camera);
composer.addPass(renderPass);
const gtao = new GTAOPass(emptyScene, camera, 4, 4);
gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 2, rings: 2, samples: 12 });
gtao.blendIntensity = 0.95;
// sprites, water, sky and leaf cards must not write into the occlusion buffers
const hideForAO = gtao.overrideVisibility.bind(gtao);
gtao.overrideVisibility = function () {
  hideForAO();
  this.scene.traverse((o) => {
    if (o.isSprite || o.userData.noAO) o.visible = false;
  });
};
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.75, 1.0);
composer.addPass(bloom);
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
composer.addPass(new OutputPass());

const QUALITY = [
  { name: 'Low', scale: 0.66, post: false, ao: false, shadow: 1024 },
  { name: 'Medium', scale: 0.75, post: true, ao: false, shadow: 2048 },
  { name: 'High', scale: 1.0, post: true, ao: false, shadow: 2048 },
  { name: 'Ultra (heavy)', scale: 1.0, post: true, ao: true, shadow: 4096 },
];
let quality = 1;
let area = null; // the area being played
function applyQuality(i) {
  quality = i;
  const Q = QUALITY[i];
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, 1.5) * Q.scale;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  gtao.enabled = Q.ao;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (area) setShadowSize(area, Q.shadow);
  $('quality').textContent = `Graphics: ${Q.name}  ·  G to change`;
}
function setShadowSize(a, size) {
  const sh = a.sunRig.sun.shadow;
  if (sh.mapSize.x === size) return;
  sh.mapSize.set(size, size);
  if (sh.map) {
    sh.map.dispose();
    sh.map = null;
  }
}
applyQuality(quality);
window.addEventListener('resize', () => applyQuality(quality));

// ---- game state ----------------------------------------------------------------
// mode: 'boot' | 'title' | 'loading' | 'cine' | 'play' | 'paused' | 'won' | 'end'
const game = { mode: 'boot', time: 0, chapter: 0, camYaw: 0, camPitch: 0.06, camPos: new THREE.Vector3(), shake: 0, freeCam: false };
const WALK = 1.6, RUN = 4.8; // metres a second; the stride in character.js is matched to these
// What the warrior is doing. He is in exactly one of these at any moment (see FLOW below).
const ST = {
  IDLE: 'IDLE', WALK: 'WALK', RUN: 'RUN', TURN: 'TURN', STOP: 'STOP', SIT_DOWN: 'SIT_DOWN', SITTING: 'SITTING', STAND_UP: 'STAND_UP',
  JUMP: 'JUMP', LAND: 'LAND', COMBAT: 'COMBAT', DODGE: 'DODGE', DEAD: 'DEAD',
};
const P = {
  pos: new THREE.Vector3(), heading: 0, speed: 0, dir: new THREE.Vector2(0, -1),
  hp: 100, attack: -1, struck: false, dodge: -1, dodgeDir: new THREE.Vector2(), dead: 0, hurt: 0, calm: 0,
  state: ST.IDLE, stateT: 0, turnVel: 0, vy: 0, air: false, jumpT: -1, landT: 0, landHit: 0, crouch: 0,
  sit: 0, seat: null, sitStep: '', sitT: 0, sitFast: false, guard: 0, look: 0,
};
const keys = Object.create(null);
const audio = createAudio();
const areas = new Array(CHAPTERS.length).fill(null);
let T = null, warrior = null, enemies = null, corpse = null;
let nearLamp = null, nearSeat = null, promptLabel = '', toastTimer = 0;

async function boot() {
  const status = async (t) => { $('status').textContent = t; await tick(); };
  await status('Grinding pigments…');
  T = {
    sand: TEX.sandTextures([208, 195, 174]), rock: TEX.rockTextures(), masonry: TEX.masonryTextures(),
    waterN: TEX.waterNormal(), sprite: TEX.softSprite(), flame: TEX.flameSprite(),
    capeA: TEX.capeAlpha(), capeC: TEX.capeColor(),
  };
  await status('Cutting the great relief…');
  T.relief = TEX.reliefTextures();
  await status('Lifting carvings from the footage…');
  T.panels = await TEX2.panelAtlas();
  Object.assign(T, {
    leaf: TEX2.leafTexture(), frond: TEX2.frondTexture(), fan: TEX2.fanTexture(), tile: TEX2.tileTextures(), wood: TEX2.woodTextures(),
    clothA: TEX2.clothTexture(), clothB: TEX2.clothTexture([38, 96, 104], [222, 196, 130]),
    sandstone: TEX2.sandstoneTextures(), ashlar: TEX2.ashlarTextures(), armor: TEX2.armorTextures(), shield: TEX2.shieldTexture(), beam: TEX2.beamSprite(),
  });
  await status('Waking the warrior…');
  warrior = createWarrior(T, 'hero');
  warrior.state.onStep = (run, loud) => audio.step(run, loud);
  enemies = createEnemies(T);
  corpse = createWarrior(T, 'raider');
  corpse.update(0.016, 0, 0, { dead: 1 });

  await buildArea(0, status);
  enterArea(0);
  game.mode = 'title';
  $('status').style.display = 'none';
  $('begin').style.display = 'inline-block';
  $('chapters').classList.add('on');
  $('start').classList.remove('loading');
}

const ctx = { renderer, get T() { return T; }, panels: (tint) => makePanels(T.panels, tint) };

async function buildArea(i, status) {
  if (areas[i]) return areas[i];
  await status(`Raising ${CHAPTERS[i].title}…`);
  const a = CHAPTERS[i].build(ctx);
  a.state = { lit: 0, fallen: [], goal: false, done: false };
  areas[i] = a;
  await tick();
  setShadowSize(a, QUALITY[quality].shadow);
  renderer.compile(a.scene, camera);
  await tick();
  return a;
}

// Make an already-built area the live one and put the warrior at its start.
function enterArea(i) {
  const a = areas[i];
  area = a;
  game.chapter = i;
  setWorld(a.def);
  renderPass.scene = a.scene;
  gtao.scene = a.scene;
  const e = a.env;
  renderer.toneMappingExposure = e.exposure;
  bloom.strength = e.bloom;
  bloom.threshold = e.bloomThreshold;
  grade.uniforms.uTint.value.set(...e.grade);
  grade.uniforms.uSat.value = e.saturation;
  a.scene.add(warrior.root);
  enemies.spawn(a.scene, a.enemies, a.state.fallen);
  if (a.corpse) {
    a.scene.add(corpse.root);
    corpse.root.position.set(a.corpse.x, groundHeight(a.corpse.x, a.corpse.z), a.corpse.z);
    corpse.root.rotation.y = a.corpse.ry;
  } else corpse.root.removeFromParent();
  respawn();
  audio.setSea(CHAPTERS[i].sea);
  $('chapLabel').textContent = `Chapter ${['I', 'II', 'III', 'IV'][i]}  ·  ${CHAPTERS[i].title}`;
  const pips = $('pips');
  pips.innerHTML = '';
  for (let k = 0; k < a.lampSys.lamps.length; k++) pips.appendChild(document.createElement('i'));
  refreshObjective();
  document.querySelectorAll('.card').forEach((c, k) => c.classList.toggle('sel', k === i));
}

function respawn() {
  const s = area.start;
  P.pos.set(s.x, groundHeight(s.x, s.z), s.z);
  P.heading = game.camYaw = s.yaw;
  game.camPitch = 0.06;
  P.speed = P.turnVel = P.vy = 0;
  P.hp = 100;
  P.attack = P.dodge = P.jumpT = -1;
  P.dead = 0;
  P.hurt = 0;
  P.air = false;
  P.landT = P.crouch = P.sit = P.guard = P.look = 0;
  P.seat = null;
  P.state = ST.IDLE;
  warrior.root.position.copy(P.pos);
  warrior.root.rotation.y = P.heading;
  warrior.reset();
  placeCamera(0, true);
}

function refreshObjective() {
  const a = area, s = a.state;
  const total = a.lampSys.lamps.length, foes = enemies.alive();
  document.querySelectorAll('#pips i').forEach((el, i) => el.classList.toggle('lit', i < s.lit));
  $('foes').textContent = foes > 0 ? `Raiders  ${foes}` : a.enemies.length ? 'Raiders routed' : '';
  let text;
  if (s.done) text = 'The way is open';
  else if (s.lit < total) text = `Light the ancient lamps  ·  ${total - s.lit} remain${total - s.lit === 1 ? 's' : ''}`;
  else if (foes > 0) text = `Drive off the raiders  ·  ${foes} remain${foes === 1 ? 's' : ''}`;
  else text = a.goalText;
  $('objText').textContent = text;
  if (!s.goal && s.lit >= total && foes === 0) {
    s.goal = true;
    a.beacon.show();
    toast('A light rises where the old stones wait…', 5);
    audio.chime(4);
  }
}

// ---- cinematics and chapter flow -------------------------------------------------
const video = $('cineVideo');
let cineDone = null;
function playCinematic(i) {
  return new Promise((res) => {
    game.mode = 'cine';
    document.exitPointerLock?.();
    $('cineTitle').textContent = CHAPTERS[i].title;
    $('cineNum').textContent = `Chapter ${['I', 'II', 'III', 'IV'][i]}`;
    $('cine').classList.add('on');
    audio.duck(true);
    let finished = false;
    cineDone = () => {
      if (finished) return;
      finished = true;
      cineDone = null;
      video.pause();
      $('cine').classList.remove('on');
      audio.duck(false);
      res();
    };
    video.onended = cineDone;
    video.onerror = cineDone;
    video.src = `./assets/video/${CHAPTERS[i].id}.mp4`;
    video.currentTime = 0;
    const pr = video.play();
    if (pr && pr.catch) pr.catch(() => { video.muted = true; video.play().catch(cineDone); });
  });
}
$('cine').addEventListener('click', () => cineDone && cineDone());

async function startChapter(i, withCine = false) { // opening videos switched off
  game.mode = 'loading';
  $('start').classList.add('hidden');
  $('end').classList.add('hidden');
  $('won').classList.remove('on');
  $('hud').classList.remove('on');
  const fade = $('fade');
  $('fadeNum').textContent = `Chapter ${['I', 'II', 'III', 'IV'][i]}`;
  $('fadeTitle').textContent = CHAPTERS[i].title;
  $('fadeSub').textContent = CHAPTERS[i].sub;
  fade.classList.add('on');
  audio.start();
  await new Promise((r) => setTimeout(r, 700));
  await buildArea(i, async (t) => { $('fadeStatus').textContent = t; await tick(); });
  $('fadeStatus').textContent = '';
  enterArea(i);
  if (withCine) await playCinematic(i);
  fade.classList.remove('on');
  $('hud').classList.add('on');
  game.mode = 'play';
  clock.getDelta();
  toast(CHAPTERS[i].sub, 5);
  lockPointer();
}

function completeChapter() {
  const s = area.state;
  if (s.done) return;
  s.done = true;
  audio.finale();
  refreshObjective();
  document.exitPointerLock?.();
  const last = game.chapter === CHAPTERS.length - 1;
  game.mode = 'won';
  setTimeout(() => {
    if (last) {
      game.mode = 'end';
      $('hud').classList.remove('on');
      $('end').classList.remove('hidden');
    } else {
      $('wonTitle').textContent = `${CHAPTERS[game.chapter].title} — complete`;
      $('wonNext').textContent = `Continue to ${CHAPTERS[game.chapter + 1].title}`;
      $('won').classList.add('on');
    }
  }, last ? 2600 : 1400);
}

// ---- input ---------------------------------------------------------------------
function begin() {
  if (game.mode !== 'title') return;
  startChapter(game.chapter);
}
$('begin').addEventListener('click', begin);
document.querySelectorAll('.card').forEach((c, i) => c.addEventListener('click', () => {
  if (game.mode !== 'title') return;
  game.chapter = i;
  document.querySelectorAll('.card').forEach((el, k) => el.classList.toggle('sel', k === i));
}));
$('wonNext').addEventListener('click', () => startChapter(game.chapter + 1));
$('wonStay').addEventListener('click', () => {
  $('won').classList.remove('on');
  game.mode = 'play';
  lockPointer();
});
$('endStay').addEventListener('click', () => {
  $('end').classList.add('hidden');
  $('hud').classList.add('on');
  game.mode = 'play';
  lockPointer();
});
$('endAgain').addEventListener('click', () => location.reload());
$('pause').addEventListener('click', () => {
  $('pause').classList.remove('on');
  game.mode = 'play';
  clock.getDelta();
  lockPointer();
});

let hadLock = false, dragging = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) hadLock = true;
  else if (hadLock && game.mode === 'play') {
    game.mode = 'paused';
    $('pause').classList.add('on');
  }
});
canvas.addEventListener('mousedown', (ev) => {
  if (game.mode !== 'play') return;
  if (document.pointerLockElement !== canvas) {
    dragging = true;
    lockPointer();
    return;
  }
});
window.addEventListener('mouseup', () => (dragging = false));
window.addEventListener('mousemove', (ev) => {
  if (game.mode !== 'play') return;
  if (document.pointerLockElement === canvas || dragging) {
    game.camYaw -= ev.movementX * 0.0026;
    game.camPitch = THREE.MathUtils.clamp(game.camPitch + ev.movementY * 0.002, -0.32, 0.95);
    cam.idle = 0;
  }
});
window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  keys[ev.code] = true;
  if (game.mode === 'cine' && (ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'Escape')) cineDone && cineDone();
  else if (game.mode === 'title' && ev.code === 'Enter') begin();
  else if (game.mode === 'play') {
    if (ev.code === 'KeyE') interact();
    if (ev.code === 'KeyQ') jump();
    if (P.state === ST.SITTING && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(ev.code)) standUp(false);
  }
  if (ev.code === 'KeyG') { autoTune.locked = true; applyQuality((quality + 1) % QUALITY.length); }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
});
window.addEventListener('keyup', (ev) => (keys[ev.code] = false));
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---- actions -------------------------------------------------------------------
function toast(text, seconds = 4) {
  $('toast').textContent = text;
  $('toast').classList.add('on');
  toastTimer = seconds;
}

// The warrior is always in exactly one state, and FLOW lists where each may lead. Every action
// asks setState() first, so two animations can never fight over the body: no sitting in mid-leap,
// no sword cut from a bench, no leap out of a dodge.
const MOVING = [ST.IDLE, ST.WALK, ST.RUN, ST.TURN, ST.STOP];
const FROM_MOVING = [...MOVING, ST.JUMP, ST.COMBAT, ST.DODGE, ST.SIT_DOWN];
const FLOW = {
  IDLE: FROM_MOVING, WALK: FROM_MOVING, RUN: FROM_MOVING, TURN: FROM_MOVING, STOP: FROM_MOVING,
  JUMP: [ST.LAND],
  LAND: MOVING,
  COMBAT: [...MOVING, ST.DODGE],
  DODGE: MOVING,
  SIT_DOWN: [ST.SITTING, ST.STAND_UP],
  SITTING: [ST.STAND_UP],
  STAND_UP: [ST.IDLE],
  DEAD: [ST.IDLE],
};
function setState(next) {
  if (next === P.state) return true;
  if (next !== ST.DEAD && !FLOW[P.state].includes(next)) return false;
  P.state = next;
  P.stateT = 0;
  return true;
}
const isSeated = () => P.state === ST.SIT_DOWN || P.state === ST.SITTING || P.state === ST.STAND_UP;

function interact() {
  if (P.dead) return;
  if (P.state === ST.SITTING) return standUp(false);
  if (isSeated()) return;
  if (nearLamp) {
    area.lampSys.ignite(nearLamp);
    audio.chime(area.state.lit);
    area.state.lit++;
    P.hp = Math.min(100, P.hp + 25); // the old flames mend the one who wakes them
    nearLamp = null;
    refreshObjective();
  } else if (nearSeat && P.jumpT < 0) startSit(nearSeat);
}
function startSit(seat) {
  if (!setState(ST.SIT_DOWN)) return;
  P.seat = seat;
  P.sitStep = 'approach';
  P.sitT = 0;
  P.sitFast = false;
}
function standUp(fast) {
  if (setState(ST.STAND_UP)) P.sitFast = fast;
}
function attack() {
  if (P.dead) return;
  if (isSeated()) return standUp(true);
  if (P.attack >= 0 || P.jumpT >= 0 || !setState(ST.COMBAT)) return;
  P.attack = 0;
  P.struck = false;
  // turn toward the nearest raider in reach, otherwise cut where the camera looks
  const e = enemies.nearest(P.pos.x, P.pos.z, 4.2);
  P.aim = e ? Math.atan2(-(e.x - P.pos.x), -(e.z - P.pos.z)) : game.camYaw;
  audio.swing();
}
function dodge() {
  if (P.dead) return;
  if (isSeated()) return standUp(true);
  if (P.dodge >= 0 || P.jumpT >= 0 || !setState(ST.DODGE)) return;
  P.dodge = 0;
  P.attack = -1;
  let ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  if (!ix && !iz) iz = -1; // no direction held: spring back
  const l = Math.hypot(ix, iz), sy = Math.sin(game.camYaw), cy = Math.cos(game.camYaw);
  P.dodgeDir.set((-sy * iz + cy * ix) / l, (-cy * iz - sy * ix) / l);
  audio.dash();
}
function jump() {
  if (P.dead || P.jumpT >= 0 || !MOVING.includes(P.state)) return;
  P.jumpT = 0; // a short crouch first, then the leap
}
function hurtPlayer(e) {
  if (P.dead || (P.dodge >= 0.05 && P.dodge < 0.8)) return; // slipped the blow
  if (isSeated()) standUp(true);
  P.hp -= e.damage;
  P.hurt = 1;
  game.shake = 0.35;
  audio.hurt();
  if (P.hp <= 0) {
    P.hp = 0;
    P.dead = 0.001;
    P.attack = P.dodge = P.jumpT = -1;
    P.air = false;
    setState(ST.DEAD);
    toast('You fall… the stones will remember you.', 4);
  }
}

// ---- update --------------------------------------------------------------------
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, smoothstep = THREE.MathUtils.smoothstep;
const ease = (t) => t * t * (3 - 2 * t);
const approach = (cur, target, step) => (cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step));

function tryMove(nx, nz, step) {
  [nx, nz] = resolve(nx, nz, 0.36);
  if (!walkable(nx, nz)) {
    // slide along the shoreline instead of stopping dead
    if (walkable(nx, P.pos.z)) nz = P.pos.z;
    else if (walkable(P.pos.x, nz)) nx = P.pos.x;
    else return false;
  }
  // too steep to climb (cliffs, plinths): only gentle rises and stairs are walkable
  const moved = Math.hypot(nx - P.pos.x, nz - P.pos.z);
  if (groundHeight(nx, nz) - groundHeight(P.pos.x, P.pos.z) > moved * 1.5 + 0.13) return false;
  if (moved < step * 0.35) P.speed *= 0.8; // pushing against something
  P.pos.x = nx;
  P.pos.z = nz;
  return true;
}

// Swing the body toward a heading at a limited, eased rate. Returns the angle still to go.
function turnToward(yaw, maxRate, dt, active = true) {
  const diff = active ? wrapAngle(yaw - P.heading) : 0;
  const want = clamp(diff * 9, -maxRate, maxRate);
  P.turnVel += (want - P.turnVel) * (1 - Math.exp(-dt * 16));
  let dh = P.turnVel * dt;
  if (active && Math.abs(dh) > Math.abs(diff)) dh = diff; // never swing past the mark
  P.heading += dh;
  return Math.abs(diff - dh);
}
// Walk the root straight toward a point. Returns the distance still to go.
function stepToward(tx, tz, speed, dt, solid) {
  const dx = tx - P.pos.x, dz = tz - P.pos.z, d = Math.hypot(dx, dz);
  if (d < 1e-4) return 0;
  const k = Math.min(d, speed * dt) / d;
  let nx = P.pos.x + dx * k, nz = P.pos.z + dz * k;
  if (solid) [nx, nz] = resolve(nx, nz, 0.36);
  P.pos.x = nx;
  P.pos.z = nz;
  return Math.hypot(tx - nx, tz - nz);
}

// Walking, running, turning, stopping, leaping, fighting.
function updateMove(dt) {
  let ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const len = Math.hypot(ix, iz), has = len > 0;
  let wantYaw = P.heading, target = 0;
  if (has) {
    ix /= len;
    iz /= len;
    const sy = Math.sin(game.camYaw), cy = Math.cos(game.camYaw);
    P.dir.set(-sy * iz + cy * ix, -cy * iz - sy * ix);
    wantYaw = Math.atan2(-P.dir.x, -P.dir.y);
    target = keys.ShiftLeft || keys.ShiftRight ? RUN : WALK;
  }
  if (P.attack >= 0) {
    // committed to the cut: plant the feet, turn into it
    wantYaw = P.aim;
    target = Math.min(target, 0.9);
    P.attack += dt / 0.56;
    if (!P.struck && P.attack >= 0.42) {
      P.struck = true;
      const n = enemies.strike(P.pos.x, P.pos.z, P.heading, 2.45, 30 + Math.random() * 12);
      if (n) {
        audio.clang();
        game.shake = 0.18;
        refreshObjective();
        area.state.fallen = enemies.fallen();
      }
    }
    if (P.attack >= 1) P.attack = -1;
  }

  // -- turning: the body comes round at a human rate, quicker on the spot than at a run.
  //    It always travels the way it faces, so it can never slide sideways.
  const steering = has || P.attack >= 0;
  const ad = steering ? Math.abs(wrapAngle(wantYaw - P.heading)) : 0;
  const maxTurn = (P.attack >= 0 ? 9 : lerp(5.6, 3.3, clamp(P.speed / RUN, 0, 1))) * (P.air ? 0.35 : 1);
  turnToward(wantYaw, maxTurn, dt, steering);

  // -- speed: a sharp change of direction slows him; from a standstill he turns before he sets off
  if (has && P.attack < 0) target *= 1 - smoothstep(ad, 0.6, 1.6);
  if (P.landT > 0) target *= 0.45; // heavy on his feet for a moment after a leap
  if (!P.air) P.speed = approach(P.speed, target, (target > P.speed ? (target > WALK + 0.1 ? 6.5 : 5) : 8.5) * dt);

  if (P.dodge >= 0) {
    P.dodge += dt / 0.42;
    const v = 8.2 * (1 - P.dodge * 0.7);
    tryMove(P.pos.x + P.dodgeDir.x * v * dt, P.pos.z + P.dodgeDir.y * v * dt, v * dt);
    if (P.dodge >= 1) P.dodge = -1;
  } else if (P.speed > 0.01) {
    const step = P.speed * dt;
    tryMove(P.pos.x - Math.sin(P.heading) * step, P.pos.z - Math.cos(P.heading) * step, step);
  }

  // -- the leap: crouch, spring, and (below, in updatePlayer) come down
  if (P.jumpT >= 0) {
    P.jumpT += dt;
    if (P.jumpT >= 0.1) {
      P.jumpT = -1;
      if (MOVING.includes(P.state)) {
        P.air = true;
        P.vy = 4.0;
      }
    }
  }
  if (P.landT > 0) P.landT = Math.max(0, P.landT - dt);

  // wounds close slowly once the fighting is done
  P.calm = enemies.engaged() ? 0 : P.calm + dt;
  if (P.calm > 4 && P.hp < 100) P.hp = Math.min(100, P.hp + dt * 5);
  // the head turns first toward where he means to go
  P.look += ((has ? clamp(wrapAngle(wantYaw - P.heading), -0.75, 0.75) : 0) - P.look) * Math.min(1, dt * 8);

  let next;
  if (P.air) next = ST.JUMP;
  else if (P.landT > 0) next = ST.LAND;
  else if (P.dodge >= 0) next = ST.DODGE;
  else if (P.attack >= 0) next = ST.COMBAT;
  else if (has && P.speed < 0.35 && ad > 0.5) next = ST.TURN;
  else if (has) next = P.speed > 3 ? ST.RUN : ST.WALK;
  else if (P.speed > 0.03) next = ST.STOP;
  else next = Math.abs(P.turnVel) > 0.4 ? ST.TURN : ST.IDLE;
  if (!setState(next)) console.warn('blocked state change', P.state, '->', next);
}

// Going to a seat, lowering onto it, resting, and getting up again.
function updateSit(dt) {
  const seat = P.seat, fx = -Math.sin(seat.yaw), fz = -Math.cos(seat.yaw);
  P.sitT += dt;
  P.speed = 0;
  P.look *= Math.exp(-dt * 6);
  if (P.state === ST.SIT_DOWN) {
    if (P.sitStep === 'approach') {
      // walk to a spot just in front of the seat
      const ax = seat.x + fx * 0.62, az = seat.z + fz * 0.62;
      const dx = ax - P.pos.x, dz = az - P.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.4) turnToward(Math.atan2(-dx, -dz), 5, dt);
      else turnToward(seat.yaw, 4, dt);
      if (stepToward(ax, az, clamp(d * 2.6, 0.4, 1.35), dt, true) < 0.012 || P.sitT > 6) P.sitStep = 'turn';
    } else if (P.sitStep === 'turn') {
      // turn his back to it
      if (turnToward(seat.yaw, 3.8, dt) < 0.02) {
        P.heading = seat.yaw;
        P.turnVel = 0;
        P.sitStep = 'back';
      }
    } else if (P.sitStep === 'back') {
      // two short steps backward until the seat is behind the knees
      if (stepToward(seat.x + fx * 0.12, seat.z + fz * 0.12, 0.55, dt, false) < 0.004) {
        P.sitStep = 'settle';
        P.sitT = 0;
      }
    } else if (P.sitStep === 'settle') {
      if ((warrior.state.settled && P.sitT > 0.15) || P.sitT > 0.9) P.sitStep = 'lower';
    } else {
      P.sit = Math.min(1, P.sit + dt / 1.3);
      if (P.sit >= 1) setState(ST.SITTING);
    }
  } else if (P.state === ST.STAND_UP) {
    turnToward(P.heading, 4, dt, false);
    if (P.sit > 0) P.sit = Math.max(0, P.sit - dt / (P.sitFast ? 0.5 : 1.1));
    else if (stepToward(seat.x + fx * 0.44, seat.z + fz * 0.44, 0.8, dt, false) < 0.01) {
      P.seat = null;
      setState(ST.IDLE);
    }
  }
}

function updatePlayer(dt) {
  if (keys.ArrowLeft) { game.camYaw += dt * 1.9; cam.idle = 0; }
  if (keys.ArrowRight) { game.camYaw -= dt * 1.9; cam.idle = 0; }
  P.stateT += dt;
  if (P.dead > 0) {
    P.dead = Math.min(1.6, P.dead + dt * 0.9);
    P.speed = 0;
    if (P.dead >= 1.6) {
      enemies.regroup();
      respawn();
      toast('The sea gives you back.', 3);
    }
  } else if (isSeated()) updateSit(dt);
  else updateMove(dt);

  // the ground underfoot, and the arc of a leap
  const gy = groundHeight(P.pos.x, P.pos.z);
  if (P.air) {
    P.vy -= 14 * dt;
    P.pos.y += P.vy * dt;
    if (P.pos.y <= gy && P.vy < 0) {
      P.pos.y = gy;
      P.air = false;
      P.landT = 0.34;
      P.landHit = clamp(-P.vy / 4.5, 0.4, 1);
      P.vy = 0;
      P.speed *= 0.6;
    }
  } else P.pos.y += (gy - P.pos.y) * Math.min(1, dt * (gy < P.pos.y - 0.6 ? 6 : 14));

  // knees give before a leap and soak up the landing
  let crouchTo = 0;
  if (P.jumpT >= 0) crouchTo = 1;
  else if (P.landT > 0) {
    const t = 1 - P.landT / 0.34;
    crouchTo = P.landHit * (t < 0.25 ? ease(t / 0.25) : 1 - ease((t - 0.25) / 0.75));
  }
  P.crouch += (crouchTo - P.crouch) * Math.min(1, dt * 22);
  // blade up when raiders are close
  P.guard = !P.dead && !isSeated() && enemies.engaged() && enemies.nearest(P.pos.x, P.pos.z, 9) ? 1 : 0;

  warrior.root.position.copy(P.pos);
  warrior.root.rotation.y = P.heading;
  warrior.update(dt, P.speed, game.time, {
    attack: P.attack, dodge: P.dodge >= 0 ? Math.min(1, P.dodge) : -1, dead: P.dead,
    air: P.air, vy: P.vy, crouch: P.crouch, sit: P.sit, seatY: P.seat ? P.seat.top - P.pos.y : 0.46,
    guard: P.guard, look: P.look,
  });
}

// ---- camera ----------------------------------------------------------------------
// A close third-person camera over the right shoulder. The point it orbits follows the warrior on
// a spring (so it lags a little and never jolts), the view angles ease after the mouse, it drifts
// round behind him when left alone, and it draws in smoothly rather than pass through a wall.
const cam = { yaw: 0, pitch: 0.06, pivot: new THREE.Vector3(), vel: new THREE.Vector3(), dist: 3.3, side: 0.52, lift: 0, idle: 9 };
function spring(axis, target, om, dt) {
  const v = (cam.vel[axis] + dt * om * om * (target - cam.pivot[axis])) / (1 + 2 * dt * om + dt * dt * om * om);
  cam.vel[axis] = v;
  cam.pivot[axis] += v * dt;
}
function placeCamera(dt, snap = false) {
  if (!snap && game.mode === 'play' && !game.freeCam) {
    cam.idle += dt;
    if (P.speed > 0.4 && P.attack < 0 && P.dodge < 0) {
      const d = wrapAngle(P.heading - game.camYaw);
      // not when he walks toward the camera: swinging round then would be dizzying
      const k = smoothstep(cam.idle, 0.7, 2.2) * (1 - smoothstep(Math.abs(d), 2.0, 2.9)) * Math.min(1, P.speed / WALK);
      game.camYaw += d * Math.min(1, dt * 1.15 * k);
      game.camPitch += (0.1 - game.camPitch) * Math.min(1, dt * 0.3 * k);
    }
  }
  const ka = snap ? 1 : 1 - Math.exp(-dt * 20);
  cam.yaw += wrapAngle(game.camYaw - cam.yaw) * ka;
  cam.pitch += (game.camPitch - cam.pitch) * ka;

  const sitK = ease(P.sit);
  const ty = P.pos.y + lerp(1.52, 1.14, sitK);
  if (snap) {
    cam.pivot.set(P.pos.x, ty, P.pos.z);
    cam.vel.set(0, 0, 0);
  } else {
    spring('x', P.pos.x, 10.5, dt);
    spring('z', P.pos.z, 10.5, dt);
    spring('y', ty, 6.5, dt); // softer, so steps and stairs do not shake the view
  }
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  // over the right shoulder, unless a wall is hard against that side
  let sideTo = 0.52;
  if (cameraBlocked(cam.pivot.x + cy * 0.62, cam.pivot.y, cam.pivot.z - sy * 0.62)) {
    sideTo = cameraBlocked(cam.pivot.x - cy * 0.62, cam.pivot.y, cam.pivot.z + sy * 0.62) ? 0 : -0.45;
  }
  cam.side += (sideTo - cam.side) * (snap ? 1 : Math.min(1, dt * 5));
  const hx = cam.pivot.x + cy * cam.side, hy = cam.pivot.y, hz = cam.pivot.z - sy * cam.side;
  const bx = sy * cp, by = sp, bz = cy * cp;
  // how far back it may sit before something solid comes between it and the warrior
  const full = 3.25 + 0.55 * clamp((P.speed - WALK) / (RUN - WALK), 0, 1) - 0.35 * sitK;
  let hit = full + 0.5;
  for (let s = 0.3; s <= full + 0.5; s += 0.14) {
    const px = hx + bx * s, py = hy + by * s, pz = hz + bz * s;
    if (cameraBlocked(px, py, pz) || cameraBlocked(px + cy * 0.22, py, pz - sy * 0.22) || cameraBlocked(px - cy * 0.22, py, pz + sy * 0.22)) {
      hit = s;
      break;
    }
  }
  const want = clamp(hit - 0.42, 0.7, full);
  if (snap) cam.dist = want;
  else cam.dist += (want - cam.dist) * (1 - Math.exp(-dt * (want < cam.dist ? 22 : 2.4)));
  cam.dist = Math.min(cam.dist, Math.max(0.5, hit - 0.12)); // never inside the wall itself
  let x = hx + bx * cam.dist, y = hy + by * cam.dist, z = hz + bz * cam.dist;
  // keep above the ground and below a ceiling, easing rather than snapping
  const need = Math.max(0, groundHeight(x, z) + 0.35 - y);
  cam.lift += (need - cam.lift) * (snap ? 1 : Math.min(1, dt * 10));
  y += cam.lift;
  const ceil = Math.min(ceilingAt(x, z), ceilingAt(P.pos.x, P.pos.z)) - 0.25;
  if (y > ceil) y = ceil;
  game.camPos.set(x, y, z);
  camera.position.copy(game.camPos);
  if (game.shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * game.shake * 0.25;
    camera.position.y += (Math.random() - 0.5) * game.shake * 0.25;
  }
  camera.rotation.set(-cam.pitch + 0.1, cam.yaw, 0);
}

function update(dt) {
  game.time += dt;
  updatePlayer(dt);
  enemies.update(dt, game.time, { x: P.pos.x, z: P.pos.z, dead: P.dead > 0 }, hurtPlayer);
  game.shake *= Math.exp(-dt * 9);
  P.hurt = Math.max(0, P.hurt - dt * 1.6);
  placeCamera(dt);

  // lamps
  nearLamp = null;
  for (const l of area.lampSys.lamps) {
    if (!l.lit && Math.hypot(l.x - P.pos.x, l.z - P.pos.z) < 2.3) nearLamp = l;
  }
  // somewhere to sit: only from in front of the seat, and never with raiders about
  nearSeat = null;
  if (!nearLamp && area.seats && MOVING.includes(P.state) && !enemies.engaged()) {
    for (const st of area.seats) {
      const dx = P.pos.x - st.x, dz = P.pos.z - st.z;
      if (dx * -Math.sin(st.yaw) + dz * -Math.cos(st.yaw) > 0.4 && Math.hypot(dx, dz) < 2.3) nearSeat = st;
    }
  }
  const label = P.dead ? '' : P.state === ST.SITTING ? 'Stand up' : isSeated() ? '' : nearLamp ? 'Light the lamp' : nearSeat ? 'Sit and rest' : '';
  if (label && label !== promptLabel) $('promptText').textContent = promptLabel = label;
  $('prompt').classList.toggle('on', !!label);

  // the goal
  const s = area.state;
  if (s.goal && !s.done && Math.hypot(area.beacon.x - P.pos.x, area.beacon.z - P.pos.z) < 2.4) completeChapter();

  // HUD
  $('hpFill').style.transform = `scaleX(${P.hp / 100})`;
  const foe = enemies.nearest(P.pos.x, P.pos.z, 11);
  const show = foe && foe.state !== 'idle';
  $('foeBar').classList.toggle('on', !!show);
  if (show) {
    $('foeFill').style.transform = `scaleX(${foe.hp / foe.maxHp})`;
    $('foeName').textContent = foe.style === 'captain' ? 'Raider captain' : 'Raider';
  }
}

// Drop quality automatically if the machine is struggling (and raise it if it is cruising).
const autoTune = { frames: 0, acc: 0, locked: false, dropped: false };
function tuneQuality(rawDt) {
  if (autoTune.locked || game.mode !== 'play' || game.time < 3) return;
  autoTune.frames++;
  autoTune.acc += rawDt;
  if (autoTune.frames < 90) return;
  const avg = autoTune.acc / autoTune.frames;
  autoTune.frames = 0;
  autoTune.acc = 0;
  if (avg > 0.037 && quality > 0) {
    autoTune.dropped = true;
    applyQuality(quality - 1);
  } else if (avg < 0.019 && quality < 2 && !autoTune.dropped) {
    applyQuality(quality + 1);
  }
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  if (!area || game.mode === 'cine' || game.mode === 'loading' || game.mode === 'paused') return;
  advance(Math.min(raw, 0.05));
  tuneQuality(raw);
}

const sunV = new THREE.Vector3(), fwd = new THREE.Vector3();
let frameNo = 0;
function advance(dt) {
  if (game.mode === 'play' || game.mode === 'won') update(dt);
  else {
    // title and end screens: the scene idles behind the card, the camera drifting
    game.time += dt;
    if (game.mode === 'title') game.camYaw = area.start.yaw + Math.sin(game.time * 0.12) * 0.25;
    warrior.root.position.copy(P.pos);
    warrior.update(dt, 0, game.time);
    placeCamera(dt, true);
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('on');
  }
  area.tick(dt, game.time, P.pos, camera.position);
  // on the lighter settings the sun's shadow map is redrawn every other frame (it is the costliest pass)
  const sh = area.sunRig.sun.shadow;
  sh.autoUpdate = quality >= 2;
  if (!sh.autoUpdate && (frameNo++ & 1) === 0) sh.needsUpdate = true;

  // where the sun sits on screen, for the light shafts
  camera.updateMatrixWorld();
  camera.getWorldDirection(fwd);
  const facing = fwd.dot(area.env.sunDir);
  sunV.copy(area.env.sunDir).multiplyScalar(900).add(camera.position).project(camera);
  grade.uniforms.uSun.value.set(sunV.x * 0.5 + 0.5, sunV.y * 0.5 + 0.5);
  grade.uniforms.uRays.value = area.env.rays * THREE.MathUtils.smoothstep(facing, 0.15, 0.7);
  grade.uniforms.uHurt.value = Math.max(P.hurt, P.dead > 0 ? 1 : (1 - P.hp / 100) * 0.35);

  if (QUALITY[quality].post) composer.render(dt);
  else renderer.render(area.scene, camera);
}

// Small hooks used for testing from the console.
window.__game = {
  game, P, renderer, camera, CHAPTERS,
  get area() { return area; },
  get enemies() { return enemies; },
  teleport(x, z, yaw = game.camYaw, pitch = game.camPitch) {
    P.pos.set(x, groundHeight(x, z), z);
    game.camYaw = yaw;
    game.camPitch = pitch;
    P.heading = yaw;
    P.speed = P.turnVel = 0;
    warrior.root.position.copy(P.pos);
    warrior.root.rotation.y = yaw;
    warrior.reset();
    placeCamera(0, true);
  },
  // look at the warrior from any side without the camera drifting back behind him
  view(yaw, pitch = 0.1) {
    game.freeCam = true;
    game.camYaw = yaw;
    game.camPitch = pitch;
    placeCamera(0, true);
  },
  get warrior() { return warrior; },
  cam, ST, jump, interact,
  async go(i) {
    await buildArea(i, async () => {});
    enterArea(i);
    game.mode = 'play';
    $('start').classList.add('hidden');
    $('hud').classList.add('on');
  },
  lightAll() {
    for (const l of area.lampSys.lamps) if (!l.lit) { nearLamp = l; interact(); }
  },
  routAll() {
    for (const e of enemies.list) { e.state = 'dead'; e.hp = 0; }
    area.state.fallen = enemies.fallen();
    refreshObjective();
  },
  attack, dodge, begin, keys, startChapter,
  setQuality(i) { autoTune.locked = true; applyQuality(i); },
  // advance the simulation by hand (useful when the tab is in the background)
  step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) advance(dt); },
  // advance the game logic only, without drawing (fast, for measuring movement)
  sim(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) update(dt); },
  capture(q = 0.86) { advance(1 / 60); return canvas.toDataURL('image/jpeg', q); },
};

boot()
  .then(() => frame())
  .catch((err) => {
    console.error(err);
    $('status').textContent = 'Could not start: ' + err.message;
  });
