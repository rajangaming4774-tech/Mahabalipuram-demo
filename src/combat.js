// Raiders: simple melee enemies. They stand watch, give chase, wind up (a clear tell),
// strike, and can be staggered and cut down.
import { createWarrior } from './character.js';
import { groundHeight, resolve, walkable } from './world.js';

const faceTo = (dx, dz) => Math.atan2(-dx, -dz);
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export function createEnemies(T) {
  const pool = [];
  let active = [];
  let scene = null;

  function take(style) {
    let e = pool.find((p) => !p.used && p.style === style);
    if (!e) {
      e = { style, w: createWarrior(T, style) };
      pool.push(e);
    }
    e.used = true;
    return e;
  }

  function reset(e, s) {
    e.spec = s;
    e.x = s.x;
    e.z = s.z;
    e.y = groundHeight(s.x, s.z);
    e.maxHp = e.hp = s.captain ? 210 : 100;
    e.damage = s.captain ? 22 : 13;
    e.pace = s.captain ? 2.7 : 3.0;
    e.state = 'idle';
    e.t = 0;
    e.heading = Math.PI; // facing +Z, the way the player comes from
    e.speed = 0;
    e.dead = 0;
    e.flash = 0;
    e.kx = e.kz = 0;
    e.attackP = -1;
    e.w.root.visible = true;
    e.w.root.position.set(e.x, e.y, e.z);
    e.w.root.rotation.y = e.heading;
    e.w.reset();
  }

  // Put this area's raiders into its scene. `state` remembers who has already fallen.
  function spawn(sc, list, fallen = []) {
    for (const p of pool) {
      p.used = false;
      p.w.root.removeFromParent();
    }
    scene = sc;
    active = list.map((s, i) => {
      const e = take(s.captain ? 'captain' : 'raider');
      reset(e, s);
      e.index = i;
      if (fallen[i]) {
        e.state = 'dead';
        e.hp = 0;
        e.dead = 1;
      }
      scene.add(e.w.root);
      e.w.root.position.set(e.x, e.y, e.z);
      return e;
    });
  }

  // Bring the survivors back to their posts (after the player falls).
  function regroup() {
    for (const e of active) if (e.state !== 'dead') reset(e, e.spec);
  }

  function update(dt, time, player, onStrike) {
    for (const e of active) {
      const dx = player.x - e.x, dz = player.z - e.z;
      const dist = Math.hypot(dx, dz);
      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 4);
        e.w.flash(e.flash);
      }
      let want = 0;
      if (e.state === 'dead') {
        e.dead = Math.min(1, e.dead + dt * 1.5);
        e.attackP = -1;
      } else if (e.state === 'idle') {
        e.heading = lerpAngle(e.heading, Math.PI + Math.sin(time * 0.4 + e.index * 2) * 0.5, dt * 1.5);
        if (dist < 17 && !player.dead) e.state = 'chase';
      } else if (e.state === 'chase') {
        e.heading = lerpAngle(e.heading, faceTo(dx, dz), 1 - Math.exp(-dt * 7));
        want = dist > 1.6 ? e.pace : 0;
        if (player.dead || dist > 40) e.state = 'idle';
        else if (dist < 1.85) {
          e.state = 'windup';
          e.t = 0;
        }
      } else if (e.state === 'windup') {
        e.t += dt;
        e.heading = lerpAngle(e.heading, faceTo(dx, dz), 1 - Math.exp(-dt * 5));
        e.attackP = 0.32 * Math.min(1, e.t / 0.55);
        if (e.t >= 0.55) {
          e.state = 'strike';
          e.t = 0;
        }
      } else if (e.state === 'strike') {
        e.t += dt;
        e.attackP = 0.32 + 0.23 * Math.min(1, e.t / 0.14);
        if (e.t >= 0.14) {
          const fx = -Math.sin(e.heading), fz = -Math.cos(e.heading);
          if (dist < 2.35 && (dx * fx + dz * fz) / (dist || 1) > 0.35) onStrike(e);
          e.state = 'recover';
          e.t = 0;
        }
      } else if (e.state === 'recover') {
        e.t += dt;
        e.attackP = 0.55 + 0.45 * Math.min(1, e.t / 0.7);
        if (e.t >= 0.7) {
          e.state = 'chase';
          e.attackP = -1;
        }
      } else if (e.state === 'stagger') {
        e.t += dt;
        e.attackP = -1;
        if (e.t >= 0.38) e.state = 'chase';
      }

      e.speed += (want - e.speed) * Math.min(1, dt * 6);
      let nx = e.x + e.kx * dt, nz = e.z + e.kz * dt;
      e.kx *= Math.exp(-dt * 7);
      e.kz *= Math.exp(-dt * 7);
      if (e.speed > 0.01 && e.state !== 'dead') {
        nx -= Math.sin(e.heading) * e.speed * dt;
        nz -= Math.cos(e.heading) * e.speed * dt;
      }
      if (e.state !== 'dead') {
        // keep the pack from standing inside one another
        for (const o of active) {
          if (o === e || o.state === 'dead') continue;
          const ox = nx - o.x, oz = nz - o.z, od = Math.hypot(ox, oz);
          if (od < 0.95 && od > 1e-4) {
            nx += (ox / od) * (0.95 - od) * 0.5;
            nz += (oz / od) * (0.95 - od) * 0.5;
          }
        }
        [nx, nz] = resolve(nx, nz, 0.36);
        if (walkable(nx, nz) && Math.abs(groundHeight(nx, nz) - e.y) < 1.2) {
          e.x = nx;
          e.z = nz;
        }
      }
      e.y += (groundHeight(e.x, e.z) - e.y) * Math.min(1, dt * 12);
      e.w.root.position.set(e.x, e.y, e.z);
      e.w.root.rotation.y = e.heading;
      e.w.update(dt, e.state === 'dead' ? 0 : e.speed, time + e.index, { attack: e.attackP, dead: e.dead });
    }
  }

  // The player's cut: everything alive inside the arc takes the blow. Returns how many were hit.
  function strike(px, pz, heading, range, damage) {
    const fx = -Math.sin(heading), fz = -Math.cos(heading);
    let n = 0;
    for (const e of active) {
      if (e.state === 'dead') continue;
      const dx = e.x - px, dz = e.z - pz, d = Math.hypot(dx, dz);
      if (d > range || (dx * fx + dz * fz) / (d || 1) < 0.3) continue;
      n++;
      e.hp -= damage;
      e.flash = 1;
      e.kx = (dx / (d || 1)) * 5;
      e.kz = (dz / (d || 1)) * 5;
      e.attackP = -1;
      if (e.hp <= 0) {
        e.state = 'dead';
        e.hp = 0;
      } else {
        e.state = 'stagger';
        e.t = 0;
      }
    }
    return n;
  }

  const alive = () => active.filter((e) => e.state !== 'dead').length;
  const fallen = () => active.map((e) => e.state === 'dead');
  // nearest living raider (for the health bar and for aiming a blow)
  function nearest(px, pz, maxDist) {
    let best = null, bd = maxDist;
    for (const e of active) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - px, e.z - pz);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  const engaged = () => active.some((e) => e.state !== 'dead' && e.state !== 'idle');

  return { spawn, regroup, update, strike, alive, fallen, nearest, engaged, get list() { return active; } };
}
