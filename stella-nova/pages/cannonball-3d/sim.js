/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// ============================================================================
//  CANNONBALL 3D  ·  pages/cannonball-3d/sim.js — the ball physics (no DOM)
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #02, 02-cannonball3d.html by Matthias
//  Müller (MIT, notice above): a ball under gravity, integrated with
//      v <- v + g dt,   x <- x + v dt,
//  that reflects its velocity at the walls of a box (worldSize x = 1.5,
//  z = 2.5) and at the floor. stepBall() keeps that step and that wall
//  rule; the 'upstream' start is the upstream scene (one ball of radius
//  0.2 at (0.2, 0.2, 0.2) with v = (2, 5, 3), restitution 1).
//
//  OUR ADDITIONS (davesgames.io, not upstream): many balls of any size and
//  density, ball-ball impulses with restitution, floor friction and air
//  drag, a tilted gravity and wind, static bumpers and crates, a cannon
//  that fires on a timer, substeps, a speed limit, a grab-and-throw
//  pointer, and the seeded scene builder. Both cannonball-3d and
//  cannonball-vr use this file.
//
//  createSim() -> S; buildScene(S, cfg, rng); S.step(dt); pick(S, o, d);
//  grab(S, i, p) / hold(S, p, v) / release(S, v); fire(S, rng).
//
//  grep -n targets: "export function stepBall", "function collideBalls",
//  "function collideObstacles", "export function buildScene",
//  "export function fire", "export function pick"
// ============================================================================

export const START = ['upstream', 'drop', 'fountain', 'cannon', 'burst', 'billiard', 'rain'];

export function createSim() {
  const S = {
    P: {
      g: 10, tiltX: 0, tiltZ: 0, windX: 0, windZ: 0, e: 0.85, eWall: 0.9, friction: 0.12, drag: 0.02,
      collide: true, substeps: 4, vmax: 30, hx: 1.5, hz: 2.5, cannon: false, cannonRate: 1.5, cannonSpeed: 7, cap: 160,
    },
    balls: [], obstacles: [], t: 0, frame: 0, fireT: 0, held: -1, heldP: null, heldV: null, rngFire: null,
    hits: 0,
  };
  S.step = dt => step(S, dt);
  return S;
}

// A ball: position, velocity, radius, mass (density x volume), colour index.
export function makeBall(x, y, z, vx, vy, vz, r, density = 1, ci = 0) {
  return { x, y, z, vx, vy, vz, r, m: density * r * r * r, ci, bounce: 0 };
}

// The upstream Ball.simulate step with restitution e on walls and floor
// (e = 1 is the upstream reflection), floor friction on the tangential
// velocity at contact, and the gravity vector gx, gy, gz.
export function stepBall(b, P, gx, gy, gz, dt) {
  b.vx += gx * dt; b.vy += gy * dt; b.vz += gz * dt;
  if (P.drag > 0) { const k = Math.max(0, 1 - P.drag * dt); b.vx = (b.vx - P.windX) * k + P.windX; b.vy *= k; b.vz = (b.vz - P.windZ) * k + P.windZ; }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  const hx = P.hx - b.r, hz = P.hz - b.r;
  let hit = 0;
  if (b.x < -hx) { b.x = -hx; b.vx = -b.vx * P.eWall; hit = 1; }
  if (b.x > hx) { b.x = hx; b.vx = -b.vx * P.eWall; hit = 1; }
  if (b.z < -hz) { b.z = -hz; b.vz = -b.vz * P.eWall; hit = 1; }
  if (b.z > hz) { b.z = hz; b.vz = -b.vz * P.eWall; hit = 1; }
  if (b.y < b.r) {
    b.y = b.r; b.vy = -b.vy * P.e; hit = 1;
    // rolling friction: the floor slows the sliding part
    const k = Math.max(0, 1 - P.friction * 10 * dt);
    b.vx *= k; b.vz *= k;
    if (Math.abs(b.vy) < 0.05) b.vy = 0;
  }
  if (hit) b.bounce = 1;
  return hit;
}

// Ball-ball contacts: separate along the normal by inverse mass, then an
// impulse with restitution e on the approach speed.
function collideBalls(S) {
  const B = S.balls, n = B.length, e = S.P.e;
  for (let i = 0; i < n; i++) {
    const a = B[i];
    for (let j = i + 1; j < n; j++) {
      const b = B[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, rr = a.r + b.r;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
      const wa = i === S.held ? 0 : 1 / a.m, wb = j === S.held ? 0 : 1 / b.m, w = wa + wb;
      if (w === 0) continue;
      const corr = (rr - d) / w;
      a.x -= nx * corr * wa; a.y -= ny * corr * wa; a.z -= nz * corr * wa;
      b.x += nx * corr * wb; b.y += ny * corr * wb; b.z += nz * corr * wb;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
      if (vn >= 0) continue;
      const J = -(1 + e) * vn / w;
      a.vx -= J * wa * nx; a.vy -= J * wa * ny; a.vz -= J * wa * nz;
      b.vx += J * wb * nx; b.vy += J * wb * ny; b.vz += J * wb * nz;
      a.bounce = b.bounce = 1; S.hits++;
    }
  }
}

// Static obstacles: bumper spheres { kind: 'sphere', x, y, z, r } and
// crates { kind: 'box', x, z, hx, hy, hz } (sitting on the floor).
function collideObstacles(S, b) {
  for (const o of S.obstacles) {
    let nx, ny, nz, d;
    if (o.kind === 'sphere') {
      nx = b.x - o.x; ny = b.y - o.y; nz = b.z - o.z; d = Math.hypot(nx, ny, nz);
      const rr = b.r + o.r; if (d >= rr || d === 0) continue;
      nx /= d; ny /= d; nz /= d;
      b.x = o.x + nx * rr; b.y = o.y + ny * rr; b.z = o.z + nz * rr;
    } else {
      const cx = Math.max(o.x - o.hx, Math.min(b.x, o.x + o.hx)), cy = Math.max(0, Math.min(b.y, 2 * o.hy)), cz = Math.max(o.z - o.hz, Math.min(b.z, o.z + o.hz));
      nx = b.x - cx; ny = b.y - cy; nz = b.z - cz; d = Math.hypot(nx, ny, nz);
      if (d >= b.r) continue;
      if (d < 1e-9) { // centre inside: push out along the shallowest face
        const px = o.hx - Math.abs(b.x - o.x), pz = o.hz - Math.abs(b.z - o.z), py = 2 * o.hy - b.y;
        if (py <= px && py <= pz) { nx = 0; ny = 1; nz = 0; b.y = 2 * o.hy + b.r; }
        else if (px <= pz) { nx = Math.sign(b.x - o.x) || 1; ny = 0; nz = 0; b.x = o.x + nx * (o.hx + b.r); }
        else { nx = 0; ny = 0; nz = Math.sign(b.z - o.z) || 1; b.z = o.z + nz * (o.hz + b.r); }
      } else {
        nx /= d; ny /= d; nz /= d;
        b.x = cx + nx * b.r; b.y = cy + ny * b.r; b.z = cz + nz * b.r;
      }
    }
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn < 0) { const k = (1 + S.P.e) * vn; b.vx -= k * nx; b.vy -= k * ny; b.vz -= k * nz; b.bounce = 1; S.hits++; }
  }
}

export function gravity(P) {
  const ax = P.tiltX * Math.PI / 180, az = P.tiltZ * Math.PI / 180;
  // the gravity vector turned by the two tilt angles
  const gx = P.g * Math.sin(az), gz = -P.g * Math.sin(ax), gy = -P.g * Math.cos(az) * Math.cos(ax);
  return [gx, gy, gz];
}

function step(S, dt) {
  const P = S.P, n = Math.max(1, Math.min(12, P.substeps | 0)), h = dt / n;
  const [gx, gy, gz] = gravity(P);
  if (P.cannon && S.rngFire) {
    S.fireT += dt;
    const every = 1 / Math.max(0.1, P.cannonRate);
    while (S.fireT >= every) { S.fireT -= every; fire(S, S.rngFire); }
  }
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < S.balls.length; i++) {
      const b = S.balls[i];
      if (i === S.held) { b.vx = S.heldV[0]; b.vy = S.heldV[1]; b.vz = S.heldV[2]; b.x += (S.heldP[0] - b.x) * 0.5; b.y += (S.heldP[1] - b.y) * 0.5; b.z += (S.heldP[2] - b.z) * 0.5; continue; }
      stepBall(b, P, gx, gy, gz, h);
      if (S.obstacles.length) collideObstacles(S, b);
    }
    if (P.collide) collideBalls(S);
    // limits: a speed cap, and the box (a contact push can cross a wall)
    for (const b of S.balls) {
      const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
      if (v2 > P.vmax * P.vmax) { const k = P.vmax / Math.sqrt(v2); b.vx *= k; b.vy *= k; b.vz *= k; }
      b.x = Math.max(-P.hx + b.r, Math.min(P.hx - b.r, b.x));
      b.z = Math.max(-P.hz + b.r, Math.min(P.hz - b.r, b.z));
      if (b.y < b.r) b.y = b.r;
    }
  }
  for (const b of S.balls) b.bounce *= 0.9;
  S.t += dt; S.frame++;
}

// ---- the cannon ----------------------------------------------------------------
// The cannon sits at one end of the box and fires along +z with a spread.
export function cannonPose(S) { return { x: 0, y: 0.35, z: -S.P.hz + 0.35, pitch: 0.75 }; }
export function fire(S, r) {
  const P = S.P, c = cannonPose(S);
  const sp = P.cannonSpeed * (0.85 + 0.3 * r()), yaw = (r() - 0.5) * 0.5, pitch = c.pitch + (r() - 0.5) * 0.3;
  const rad = 0.08 + 0.1 * r();
  const b = makeBall(c.x, c.y + 0.1, c.z + 0.2, sp * Math.cos(pitch) * Math.sin(yaw), sp * Math.sin(pitch), sp * Math.cos(pitch) * Math.cos(yaw), rad, 1, (S.balls.length) % 6);
  S.balls.push(b);
  if (S.balls.length > P.cap) { S.balls.shift(); if (S.held >= 0) S.held--; }
  return b;
}

// ---- pointer --------------------------------------------------------------------
// The nearest ball hit by the ray o + t d (unit d), or -1.
export function pick(S, o, d) {
  let best = -1, bt = Infinity;
  S.balls.forEach((b, i) => {
    const ox = o[0] - b.x, oy = o[1] - b.y, oz = o[2] - b.z;
    const bq = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - b.r * b.r * 1.3;
    const disc = bq * bq - c; if (disc < 0) return;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < bt) { bt = t; best = i; }
  });
  return { i: best, t: bt };
}
export function grab(S, i, p) { S.held = i; S.heldP = p.slice(); S.heldV = [0, 0, 0]; }
export function hold(S, p, v) { if (S.held < 0) return; S.heldP = p.slice(); S.heldV = v.slice(); }
export function release(S, v) {
  if (S.held < 0) return;
  const b = S.balls[S.held]; if (b) { b.vx = v[0]; b.vy = v[1]; b.vz = v[2]; }
  S.held = -1;
}

// ---- scenes ------------------------------------------------------------------------
// cfg: { start, count, rMin, rMax, density, spread, speed, bumpers, crates }
export function buildScene(S, cfg, r) {
  const P = S.P;
  S.balls = []; S.obstacles = []; S.t = 0; S.frame = 0; S.fireT = 0; S.held = -1; S.hits = 0; S.rngFire = r;
  const n = Math.max(1, cfg.count | 0), rad = () => cfg.rMin + (cfg.rMax - cfg.rMin) * r(), den = () => cfg.density * (0.6 + 0.8 * r());
  const sp = cfg.speed;
  // obstacles first, so balls start outside them
  for (let i = 0; i < (cfg.bumpers | 0); i++) S.obstacles.push({ kind: 'sphere', x: (2 * r() - 1) * (P.hx - 0.5), y: 0.15 + 0.6 * r(), z: (2 * r() - 1) * (P.hz - 0.6), r: 0.18 + 0.22 * r() });
  for (let i = 0; i < (cfg.crates | 0); i++) S.obstacles.push({ kind: 'box', x: (2 * r() - 1) * (P.hx - 0.5), z: (2 * r() - 1) * (P.hz - 0.6), hx: 0.12 + 0.2 * r(), hy: 0.08 + 0.22 * r(), hz: 0.12 + 0.25 * r() });
  const free = (x, y, z, rr) => S.obstacles.every(o => o.kind === 'sphere' ? Math.hypot(x - o.x, y - o.y, z - o.z) > rr + o.r : (Math.abs(x - o.x) > o.hx + rr || Math.abs(z - o.z) > o.hz + rr || y > 2 * o.hy + rr));
  const place = (fx, fy, fz, rr) => { for (let k = 0; k < 20; k++) { const x = fx(), y = fy(), z = fz(); if (free(x, y, z, rr)) return [x, y, z]; } return [fx(), 2.2 + r(), fz()]; };
  const ux = () => (2 * r() - 1) * (P.hx - 0.3), uz = () => (2 * r() - 1) * (P.hz - 0.3);
  switch (cfg.start) {
    case 'upstream': {
      S.balls.push(makeBall(0.2, 0.2, 0.2, 2, 5, 3, 0.2, 1, 0));
      break;
    }
    case 'drop': for (let i = 0; i < n; i++) { const rr = rad(), p = place(ux, () => 1 + 2 * r(), uz, rr); S.balls.push(makeBall(p[0], p[1], p[2], (r() - 0.5) * sp * 0.3, 0, (r() - 0.5) * sp * 0.3, rr, den(), i % 6)); } break;
    case 'fountain': for (let i = 0; i < n; i++) { const rr = rad(), a = r() * 6.283, s = 0.3 * sp * r(); S.balls.push(makeBall(Math.cos(a) * 0.1, rr + 0.05 + 0.4 * i / n, Math.sin(a) * 0.1, Math.cos(a) * s, sp * (0.7 + 0.4 * r()), Math.sin(a) * s, rr, den(), i % 6)); } break;
    case 'burst': { const cy = 1.2; for (let i = 0; i < n; i++) { const rr = rad(), u = 2 * r() - 1, a = r() * 6.283, q = Math.sqrt(1 - u * u), s = sp * (0.5 + 0.5 * r()); S.balls.push(makeBall(q * Math.cos(a) * 0.3, cy + u * 0.3, q * Math.sin(a) * 0.3, q * Math.cos(a) * s, u * s, q * Math.sin(a) * s, rr, den(), i % 6)); } break; }
    case 'billiard': for (let i = 0; i < n; i++) { const rr = Math.min(rad(), 0.14), p = place(ux, () => rr, uz, rr); const a = r() * 6.283, s = sp * r(); S.balls.push(makeBall(p[0], rr, p[2], Math.cos(a) * s, 0, Math.sin(a) * s, rr, den(), i % 6)); } break;
    case 'rain': for (let i = 0; i < n; i++) { const rr = rad() * 0.7, p = place(ux, () => 0.5 + 4 * r(), uz, rr); S.balls.push(makeBall(p[0], p[1], p[2], 0, -sp * 0.2 * r(), 0, rr, den(), i % 6)); } break;
    case 'cannon': default: {
      // a few balls already on the floor; the cannon does the rest
      for (let i = 0; i < Math.min(n, 6); i++) { const rr = rad(), p = place(ux, () => rr, uz, rr); S.balls.push(makeBall(p[0], rr, p[2], 0, 0, 0, rr, den(), i % 6)); }
      break;
    }
  }
  return S;
}

// The summed energy (kinetic + potential) per unit mass scale.
export function energy(S) {
  const [gx, gy, gz] = gravity(S.P);
  let E = 0;
  for (const b of S.balls) E += b.m * (0.5 * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) - (gx * b.x + gy * b.y + gz * b.z));
  return E;
}
