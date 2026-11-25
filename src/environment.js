// Sky, sun, terrain, ocean and sea spray.
import * as THREE from 'three';
import { fbm, smoothstep, clamp01, mulberry32 } from './noise.js';
import {
  SUN_DIR, getWorld, terrainHeight, landDist, flatness, cliffFaceX, cliffHeightAt, CLIFF, shoreX,
} from './world.js';

// The "look" of an area: sun, sky, fog, light and grade. Every area makes its own.
export function makeEnv(o = {}) {
  const C = (v, d) => new THREE.Color(v || d);
  return {
    sunDir: new THREE.Vector3(...(o.sunDir || SUN_DIR)).normalize(),
    sun: C(o.sun, '#ffd7a0'),
    horizon: C(o.horizon, '#ecd3a6'),
    zenith: C(o.zenith, '#7c9cbf'),
    fog: C(o.fog, '#dcc6a0'),
    fogDensity: o.fogDensity ?? 0.0052,
    glow: C(o.glow, '#ffb266'),
    cloudCover: o.cloudCover ?? 0.46,
    cloudLit: C(o.cloudLit, '#fff0d8').multiplyScalar(o.cloudLitBoost ?? 1.4),
    cloudBase: C(o.cloudBase, '#a8a6ad'),
    cloudDark: C(o.cloudDark, '#80808f'),
    light: C(o.light, '#ffd09a'),
    lightIntensity: o.lightIntensity ?? 3.4,
    hemiSky: C(o.hemiSky, '#b8cfe8'),
    hemiGround: C(o.hemiGround, '#8a6a48'),
    hemiIntensity: o.hemiIntensity ?? 0.35,
    envIntensity: o.envIntensity ?? 0.9,
    exposure: o.exposure ?? 0.92,
    bloom: o.bloom ?? 0.42,
    bloomThreshold: o.bloomThreshold ?? 1.25,
    sunDisk: o.sunDisk ?? 22,
    rays: o.rays ?? 0.5,
    grade: o.grade || [1.05, 1.0, 0.93],
    saturation: o.saturation ?? 1.1,
    waterDeep: C(o.waterDeep, '#1a4850'),
    waterShallow: C(o.waterShallow, '#5a8a80'),
    shadowRange: o.shadowRange ?? 46,
  };
}

// ---- sky ---------------------------------------------------------------------
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir, uSunColor, uHorizon, uZenith, uGlow, uCloudLit, uCloudBase, uCloudDark;
  uniform float uTime, uDisk, uCover, uDiskPower;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(13.1, 7.7); a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float y = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(y, 0.55));
    float s = max(dot(d, uSunDir), 0.0);
    col += uGlow * 0.55 * pow(s, 5.0);
    col += mix(uGlow, vec3(1.0), 0.45) * 1.5 * pow(s, 36.0);

    vec2 cp = d.xz / (d.y + 0.14) * 1.2 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(cp * 1.05 + fbm(cp * 2.1) * 0.7);
    float cov = smoothstep(uCover, uCover + 0.28, c) * smoothstep(0.0, 0.14, d.y);
    vec3 lit = mix(uCloudBase, uCloudLit, pow(s, 2.0) * 0.85 + 0.15);
    vec3 cloud = mix(lit, lit * uCloudDark, smoothstep(uCover + 0.14, uCover + 0.46, c) * 0.75);
    col = mix(col, cloud, cov * 0.88);

    float disk = smoothstep(0.9990, 0.9997, s);
    col += uSunColor * disk * uDiskPower * uDisk * (1.0 - cov * 0.85);
    col = mix(col, uHorizon * 1.04, smoothstep(0.07, -0.03, d.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSky(renderer, scene, env) {
  const uniforms = {
    uSunDir: { value: env.sunDir },
    uSunColor: { value: env.sun },
    uHorizon: { value: env.horizon },
    uZenith: { value: env.zenith },
    uGlow: { value: env.glow },
    uCloudLit: { value: env.cloudLit },
    uCloudBase: { value: env.cloudBase },
    uCloudDark: { value: env.cloudDark },
    uCover: { value: env.cloudCover },
    uDiskPower: { value: env.sunDisk },
    uTime: { value: 0 },
    uDisk: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.noAO = true;

  // Bake the sky once into an environment map so every stone picks up its light.
  uniforms.uDisk.value = 0;
  const envScene = new THREE.Scene();
  envScene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();
  uniforms.uDisk.value = 1;

  scene.add(dome);
  scene.environment = envMap;
  scene.environmentIntensity = env.envIntensity;
  scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
  return { dome, uniforms };
}

// ---- sun ---------------------------------------------------------------------
export function createSun(scene, env) {
  const R = env.shadowRange;
  const sun = new THREE.DirectionalLight(env.light, env.lightIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -R;
  cam.right = cam.top = R;
  cam.near = 1;
  cam.far = 320;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiIntensity);
  scene.add(fill);

  const texel = (R * 2) / 2048;
  const S = env.sunDir;
  function follow(focus) {
    // snap to shadow texels so shadows do not shimmer as the player walks
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    sun.target.position.set(fx, focus.y, fz);
    sun.position.set(fx + S.x * 150, focus.y + S.y * 150, fz + S.z * 150);
    sun.target.updateMatrixWorld();
  }
  return { sun, follow };
}

// ---- terrain -----------------------------------------------------------------
// Sand colouring of the shore: dry sand, turf patches, damp near the water.
const _dry = new THREE.Color('#d9bf95'), _damp = new THREE.Color('#8f7150'), _turf = new THREE.Color('#8b8a56');
export function shoreGroundColor(x, z, h, c) {
  const d = landDist(x, z);
  const w = d < 0 ? 1 : smoothstep(3.2, 0.2, d);
  c.copy(_dry).lerp(_turf, grassMask(x, z) * 0.7).lerp(_damp, w);
  c.multiplyScalar(0.86 + fbm(x * 0.05, z * 0.05, 3) * 0.28);
  return w * 0.9;
}

// colorFn(x, z, h, color) paints a vertex and returns how wet (glossy) it is.
export function createTerrain(scene, sand, colorFn = shoreGroundColor, uvScale = 5) {
  const T = getWorld().terrain;
  const SEG = T.seg || 256;
  const geo = new THREE.PlaneGeometry(T.size, T.size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  geo.translate(T.cx, 0, T.cz);
  const pos = geo.attributes.position;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const wet = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    wet[i] = colorFn(x, z, h, c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('wet', new THREE.BufferAttribute(wet, 1));
  geo.computeVertexNormals();
  const uv = geo.attributes.uv;
  for (let i = 0; i < n; i++) uv.setXY(i, pos.getX(i) / uvScale, pos.getZ(i) / uvScale);

  const mat = new THREE.MeshStandardMaterial({
    map: sand.map, normalMap: sand.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.95, metalness: 0, vertexColors: true,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float wet;\nvarying float vWet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = wet;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.22, vWet);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Where grass and creepers like to grow (0..1).
export function grassMask(x, z) {
  const d = landDist(x, z);
  if (d < 4) return 0;
  const n = fbm(x * 0.07 + 31, z * 0.07 - 12, 3);
  return smoothstep(0.5, 0.66, n) * (1 - flatness(x, z)) * clamp01((d - 4) / 6);
}

// ---- ocean -------------------------------------------------------------------
// The shore's sea floor: the carved cliff stands in the sea, so surf breaks on it.
export function shoreSeaFloor(x, z) {
  let h = terrainHeight(x, z);
  if (z > CLIFF.zMin && z < CLIFF.zMax && cliffHeightAt(z) > 1.5) {
    const into = x - cliffFaceX(z);
    if (into > -4) h = Math.max(h, Math.min(3, into * 1.6 + 0.5));
  }
  return h;
}

// Terrain heights baked to a texture so the water knows how deep it is.
function depthTexture(floorFn) {
  const N = 256;
  const T = getWorld().terrain;
  const data = new Uint8Array(N * N * 4);
  const min = T.size / -2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = T.cx + min + ((i + 0.5) / N) * T.size;
      const z = T.cz + min + ((j + 0.5) / N) * T.size;
      const v = clamp01((floorFn(x, z) + 9) / 12) * 255;
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = v;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const WAVES = /* glsl */ `
  // k (direction * frequency), amplitude, speed, phase
  #define NW 3
  float waveH(vec2 p, float t) {
    float h = 0.0;
    h += 0.24 * sin(dot(p, vec2(0.085, 0.03)) + t * 0.9);
    h += 0.15 * sin(dot(p, vec2(0.16, -0.07)) + t * 1.3 + 1.7);
    h += 0.07 * sin(dot(p, vec2(0.31, 0.19)) + t * 1.9 + 0.4);
    return h;
  }
`;
const OCEAN_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying float vWave;
  ${WAVES}
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWave = waveH(wp.xz, uTime);
    wp.y += vWave;
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const OCEAN_FRAG = /* glsl */ `
  uniform float uTime, uFogDensity;
  uniform vec3 uSunDir, uSunColor, uHorizon, uZenith, uFogColor, uDeep, uShallow;
  uniform sampler2D uDepth, uNoise;
  uniform vec4 uRect;
  varying vec3 vWorld;
  varying float vWave;

  vec3 sky(vec3 d) {
    vec3 c = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.5));
    float s = max(dot(d, uSunDir), 0.0);
    return c + uSunColor * (0.3 * pow(s, 6.0) + 1.1 * pow(s, 48.0));
  }
  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    vec2 g = vec2(0.0);
    g += vec2(0.085, 0.03) * 0.24 * cos(dot(p, vec2(0.085, 0.03)) + t * 0.9);
    g += vec2(0.16, -0.07) * 0.15 * cos(dot(p, vec2(0.16, -0.07)) + t * 1.3 + 1.7);
    g += vec2(0.31, 0.19) * 0.07 * cos(dot(p, vec2(0.31, 0.19)) + t * 1.9 + 0.4);
    g += vec2(0.7, 0.3) * 0.035 * cos(dot(p, vec2(0.7, 0.3)) + t * 2.6);
    g += vec2(-0.4, 0.95) * 0.025 * cos(dot(p, vec2(-0.4, 0.95)) + t * 3.1 + 2.0);
    vec3 n1 = texture2D(uNoise, p * 0.055 + vec2(t * 0.022, t * 0.011)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNoise, p * 0.17 + vec2(-t * 0.03, t * 0.021)).xyz * 2.0 - 1.0;
    vec3 N = normalize(vec3(-g.x + (n1.x + n2.x) * 0.3, 1.0, -g.y + (n1.y + n2.y) * 0.3));

    vec3 V = normalize(cameraPosition - vWorld);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);

    vec2 uv = (p - uRect.xy) / uRect.zw;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float ground = mix(-9.0, texture2D(uDepth, uv).r * 12.0 - 9.0, inside);
    float depth = max(vWorld.y - ground, 0.0);

    vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.5));
    body *= 0.75 + 0.5 * max(dot(N, uSunDir), 0.0);
    vec3 col = mix(body, sky(R), fres);
    col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 180.0) * 5.0;

    // surf: rolling foam bands where the water runs shallow, whitecaps offshore
    float nz = n1.x * 0.5 + 0.5, nz2 = n2.y * 0.5 + 0.5;
    float shore = smoothstep(3.2, 0.0, depth);
    float band = sin(depth * 2.4 + t * 1.5 + nz * 5.0) * 0.5 + 0.5;
    float foam = shore * (0.42 + 0.7 * band) + (nz2 - 0.5) * 0.55 * shore;
    foam = smoothstep(0.36, 0.72, foam);
    float caps = smoothstep(0.22, 0.4, vWave + (nz - 0.5) * 0.3) * smoothstep(0.55, 0.75, nz2) * 0.7;
    foam = clamp(max(foam, caps), 0.0, 1.0);
    vec3 foamCol = vec3(1.0, 0.96, 0.88) * (0.75 + 0.5 * max(dot(N, uSunDir), 0.0));
    col = mix(col, foamCol, foam);

    float alpha = max(smoothstep(0.0, 0.3, depth), foam * step(0.03, depth));
    float dist = length(cameraPosition - vWorld);
    col = mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * dist * dist));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createOcean(scene, noiseTex, env, floorFn = shoreSeaFloor) {
  const T = getWorld().terrain;
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: env.sunDir },
    uSunColor: { value: env.sun },
    uHorizon: { value: env.horizon },
    uZenith: { value: env.zenith },
    uFogColor: { value: env.fog },
    uFogDensity: { value: env.fogDensity },
    uDeep: { value: env.waterDeep },
    uShallow: { value: env.waterShallow },
    uDepth: { value: depthTexture(floorFn) },
    uNoise: { value: noiseTex },
    uRect: { value: new THREE.Vector4(T.cx - T.size / 2, T.cz - T.size / 2, T.size, T.size) },
  };
  const geo = new THREE.PlaneGeometry(1400, 1400, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(T.cx, 0, T.cz);
  mesh.renderOrder = 2;
  mesh.userData.noAO = true;
  scene.add(mesh);
  return { mesh, uniforms };
}

// ---- sea spray ---------------------------------------------------------------
export function createSpray(scene, sprite, emitters) {
  const N = 320;
  const pos = new Float32Array(N * 3).fill(-999);
  const col = new Float32Array(N * 4);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const span = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const mat = new THREE.PointsMaterial({
    map: sprite, size: 2.6, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true, fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  const rng = mulberry32(99);
  const timers = emitters.map(() => rng() * 4);
  let next = 0;
  function burst(e) {
    const count = 26 + Math.floor(rng() * 16);
    for (let k = 0; k < count; k++) {
      const i = next;
      next = (next + 1) % N;
      const a = rng() * Math.PI * 2, r = rng() * 1.6;
      pos[i * 3] = e.x + Math.cos(a) * r;
      pos[i * 3 + 1] = 0.2 + rng() * 0.6;
      pos[i * 3 + 2] = e.z + Math.sin(a) * r;
      vel[i * 3] = -1.5 - rng() * 2 + Math.cos(a) * 1.2;
      vel[i * 3 + 1] = 4 + rng() * 5 * e.power;
      vel[i * 3 + 2] = Math.sin(a) * 1.6;
      span[i] = life[i] = 1.1 + rng() * 0.9;
    }
  }
  function update(dt) {
    for (let e = 0; e < emitters.length; e++) {
      timers[e] -= dt;
      if (timers[e] <= 0) {
        burst(emitters[e]);
        timers[e] = 3.2 + rng() * 3.5;
      }
    }
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i * 3 + 1] = -999;
        col[i * 4 + 3] = 0;
        continue;
      }
      vel[i * 3 + 1] -= 9.8 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const f = life[i] / span[i];
      col[i * 4] = 1;
      col[i * 4 + 1] = 0.96;
      col[i * 4 + 2] = 0.9;
      col[i * 4 + 3] = Math.sin(Math.min(1, f * 1.4) * Math.PI) * 0.5;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { points, update };
}

// Spots along the eastern shore where waves throw spray.
export function sprayEmitters() {
  const out = [];
  for (const z of [34, 16, 2, -14, -30, -52]) out.push({ x: shoreX(z) + 2.5, z, power: 1 });
  return out;
}
