/*
Copyright 2022 Matthias Müller - Ten Minute Physics, 
www.youtube.com/c/TenMinutePhysics
www.matthiasMueller.info/tenMinutePhysics

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Euler Fluid · upstream script 1, verbatim from Ten Minute Physics
// 17-fluidSim.html by Matthias Müller. MIT License (notice kept above).
// Source: https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/17-fluidSim.html
// ============================================================================
//  EULER FLUID  ·  pages/euler-fluid/solver.js — the grid fluid and scenes
// ----------------------------------------------------------------------------
//  UPSTREAM (MIT, notice above): class Fluid is Matthias Müller's Ten Minute
//  Physics #17 (17-fluidSim.html) in module form. Changes to it: the over-
//  relaxation factor is an argument of solveIncompressibility and simulate
//  (it was the global scene.overRelaxation), and the debug counter is gone.
//  The numerics are the same: staggered MAC grid, Gauss-Seidel pressure
//  projection, semi-Lagrangian advection of velocity and smoke.
//
//  OUR ADDITIONS (davesgames.io, not upstream), below "site layer":
//  scenes (tunnel, hires tunnel, tank, paint, lid-driven cavity, jets),
//  several obstacles of four shapes (circle, square, ellipse foil, plate)
//  with motions (static, orbit, bob, spin), inlet smoke streaks, the
//  moving lid, jets with dye, an optional viscosity (diffuse), and a
//  health check for the tests.
//
//  grep -n targets: "export class Fluid", "export function createSim",
//  "export function buildScene", "function stampObstacles",
//  "export function step", "export function addObstacle"
// ============================================================================

export const U_FIELD = 0, V_FIELD = 1, S_FIELD = 2;

export class Fluid {
  constructor(density, numX, numY, h) {
    this.density = density;
    this.numX = numX + 2;
    this.numY = numY + 2;
    this.numCells = this.numX * this.numY;
    this.h = h;
    this.u = new Float32Array(this.numCells);
    this.v = new Float32Array(this.numCells);
    this.newU = new Float32Array(this.numCells);
    this.newV = new Float32Array(this.numCells);
    this.p = new Float32Array(this.numCells);
    this.s = new Float32Array(this.numCells);
    this.m = new Float32Array(this.numCells);
    this.newM = new Float32Array(this.numCells);
    this.m.fill(1.0);
  }
  integrate(dt, gravity) {
    const n = this.numY;
    for (let i = 1; i < this.numX; i++)
      for (let j = 1; j < this.numY - 1; j++)
        if (this.s[i * n + j] != 0.0 && this.s[i * n + j - 1] != 0.0) this.v[i * n + j] += gravity * dt;
  }
  solveIncompressibility(numIters, dt, overRelaxation) {
    const n = this.numY, cp = this.density * this.h / dt;
    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 1; i < this.numX - 1; i++) {
        for (let j = 1; j < this.numY - 1; j++) {
          if (this.s[i * n + j] == 0.0) continue;
          const sx0 = this.s[(i - 1) * n + j], sx1 = this.s[(i + 1) * n + j];
          const sy0 = this.s[i * n + j - 1], sy1 = this.s[i * n + j + 1];
          const s = sx0 + sx1 + sy0 + sy1;
          if (s == 0.0) continue;
          const div = this.u[(i + 1) * n + j] - this.u[i * n + j] + this.v[i * n + j + 1] - this.v[i * n + j];
          let p = -div / s;
          p *= overRelaxation;
          this.p[i * n + j] += cp * p;
          this.u[i * n + j] -= sx0 * p;
          this.u[(i + 1) * n + j] += sx1 * p;
          this.v[i * n + j] -= sy0 * p;
          this.v[i * n + j + 1] += sy1 * p;
        }
      }
    }
  }
  extrapolate() {
    const n = this.numY;
    for (let i = 0; i < this.numX; i++) {
      this.u[i * n + 0] = this.u[i * n + 1];
      this.u[i * n + this.numY - 1] = this.u[i * n + this.numY - 2];
    }
    for (let j = 0; j < this.numY; j++) {
      this.v[0 * n + j] = this.v[1 * n + j];
      this.v[(this.numX - 1) * n + j] = this.v[(this.numX - 2) * n + j];
    }
  }
  sampleField(x, y, field) {
    const n = this.numY, h = this.h, h1 = 1.0 / h, h2 = 0.5 * h;
    x = Math.max(Math.min(x, this.numX * h), h);
    y = Math.max(Math.min(y, this.numY * h), h);
    let dx = 0.0, dy = 0.0, f;
    switch (field) {
      case U_FIELD: f = this.u; dy = h2; break;
      case V_FIELD: f = this.v; dx = h2; break;
      case S_FIELD: f = this.m; dx = h2; dy = h2; break;
    }
    const x0 = Math.min(Math.floor((x - dx) * h1), this.numX - 1);
    const tx = ((x - dx) - x0 * h) * h1;
    const x1 = Math.min(x0 + 1, this.numX - 1);
    const y0 = Math.min(Math.floor((y - dy) * h1), this.numY - 1);
    const ty = ((y - dy) - y0 * h) * h1;
    const y1 = Math.min(y0 + 1, this.numY - 1);
    const sx = 1.0 - tx, sy = 1.0 - ty;
    return sx * sy * f[x0 * n + y0] + tx * sy * f[x1 * n + y0] + tx * ty * f[x1 * n + y1] + sx * ty * f[x0 * n + y1];
  }
  avgU(i, j) {
    const n = this.numY;
    return (this.u[i * n + j - 1] + this.u[i * n + j] + this.u[(i + 1) * n + j - 1] + this.u[(i + 1) * n + j]) * 0.25;
  }
  avgV(i, j) {
    const n = this.numY;
    return (this.v[(i - 1) * n + j] + this.v[i * n + j] + this.v[(i - 1) * n + j + 1] + this.v[i * n + j + 1]) * 0.25;
  }
  advectVel(dt) {
    this.newU.set(this.u); this.newV.set(this.v);
    const n = this.numY, h = this.h, h2 = 0.5 * h;
    for (let i = 1; i < this.numX; i++) {
      for (let j = 1; j < this.numY; j++) {
        if (this.s[i * n + j] != 0.0 && this.s[(i - 1) * n + j] != 0.0 && j < this.numY - 1) {
          let x = i * h, y = j * h + h2;
          const u = this.u[i * n + j], v = this.avgV(i, j);
          x = x - dt * u; y = y - dt * v;
          this.newU[i * n + j] = this.sampleField(x, y, U_FIELD);
        }
        if (this.s[i * n + j] != 0.0 && this.s[i * n + j - 1] != 0.0 && i < this.numX - 1) {
          let x = i * h + h2, y = j * h;
          const u = this.avgU(i, j), v = this.v[i * n + j];
          x = x - dt * u; y = y - dt * v;
          this.newV[i * n + j] = this.sampleField(x, y, V_FIELD);
        }
      }
    }
    this.u.set(this.newU); this.v.set(this.newV);
  }
  advectSmoke(dt) {
    this.newM.set(this.m);
    const n = this.numY, h = this.h, h2 = 0.5 * h;
    for (let i = 1; i < this.numX - 1; i++) {
      for (let j = 1; j < this.numY - 1; j++) {
        if (this.s[i * n + j] != 0.0) {
          const u = (this.u[i * n + j] + this.u[(i + 1) * n + j]) * 0.5;
          const v = (this.v[i * n + j] + this.v[i * n + j + 1]) * 0.5;
          this.newM[i * n + j] = this.sampleField(i * h + h2 - dt * u, j * h + h2 - dt * v, S_FIELD);
        }
      }
    }
    this.m.set(this.newM);
  }
  simulate(dt, gravity, numIters, overRelaxation = 1.9) {
    this.integrate(dt, gravity);
    this.p.fill(0.0);
    this.solveIncompressibility(numIters, dt, overRelaxation);
    this.extrapolate();
    this.advectVel(dt);
    this.advectSmoke(dt);
  }
}

// ============================================================================
//  site layer (davesgames.io): scenes, obstacles, forcing
// ============================================================================
export const SCENES = ['tunnel', 'hires', 'tank', 'paint', 'cavity', 'jets'];
export const SHAPES = ['circle', 'square', 'ellipse', 'plate'];

// A scene: { kind, f (Fluid), W (domain width, height 1), wall (1 = fixed
// solid cell), obstacles, P (live parameters), frame, t }.
export function createSim() {
  return { kind: 'tunnel', f: null, W: 1.8, wall: null, obstacles: [], P: { g: 0, iters: 40, over: 1.9, dt: 1 / 60, inVel: 2, lid: 1.5, jet: 3, visc: 0 }, frame: 0, t: 0, jets: [], finger: null };
}

// cfg = { kind, res, aspect, streaks, streakW, obstacles: [obstacle cfg] }
export function buildScene(S, cfg, r) {
  const kind = cfg.kind === 'hires' ? 'tunnel' : cfg.kind;
  const res = Math.max(20, Math.round(cfg.res));
  const W = Math.max(1, cfg.aspect || 1.8), h = 1.0 / res;
  const numX = Math.floor(W / h), numY = res;
  const f = new Fluid(1000.0, numX, numY, h), n = f.numY;
  const wall = new Uint8Array(f.numCells);
  S.kind = kind; S.label = cfg.kind; S.f = f; S.W = (numX + 2) * h; S.H = (numY + 2) * h; S.wall = wall; S.frame = 0; S.t = 0;
  for (let i = 0; i < f.numX; i++) for (let j = 0; j < f.numY; j++) {
    let solid = false;
    if (kind === 'tunnel') solid = i === 0 || j === 0 || j === f.numY - 1;
    else if (kind === 'tank') solid = i === 0 || i === f.numX - 1 || j === 0;
    else solid = i === 0 || i === f.numX - 1 || j === 0 || j === f.numY - 1;
    wall[i * n + j] = solid ? 1 : 0;
    f.s[i * n + j] = solid ? 0 : 1;
  }
  if (kind === 'tunnel') {
    // inlet smoke streaks: m = 0 in bands of the inlet column (upstream: one
    // band 0.1 of the height at the middle)
    const k = Math.max(1, cfg.streaks | 0), bw = Math.max(1, Math.round((cfg.streakW || 0.1) * f.numY / Math.max(1, k * 0.6)));
    for (let s = 0; s < k; s++) {
      const c = Math.round(f.numY * (s + 0.5) / k);
      for (let j = Math.max(1, c - (bw >> 1)); j < Math.min(f.numY - 1, c + (bw + 1 >> 1)); j++) f.m[j] = 0.0;
    }
  }
  if (kind === 'paint' || kind === 'jets') f.m.fill(0);
  S.obstacles = (cfg.obstacles || []).map(o => makeObstacle(o));
  S.jets = [];
  if (kind === 'jets') {
    const nj = 2 + ((r ? r() : 0.5) * 3 | 0);
    for (let k = 0; k < nj; k++) {
      const left = k % 2 === 0, y = 0.15 + 0.7 * (r ? r() : 0.5);
      S.jets.push({ left, y, w: 0.05 + 0.04 * (r ? r() : 0.5), hue: (k + 0.5) / nj, ang: ((r ? r() : 0.5) - 0.5) * 0.6 });
    }
  }
  S.finger = null;
  stampObstacles(S, 0);
  return S;
}

export function makeObstacle(o) {
  return { shape: o.shape || 'circle', x: o.x, y: o.y, r: o.r || 0.1, a: o.a || 0, motion: o.motion || 'static', amp: o.amp ?? 0.15, freq: o.freq ?? 0.25, ph: o.ph || 0,
    x0: o.x, y0: o.y, a0: o.a || 0, vx: 0, vy: 0, w: 0, hue: o.hue ?? 0.5, held: false };
}
export function addObstacle(S, o) { const ob = makeObstacle(o); S.obstacles.push(ob); return ob; }
export function removeObstacle(S, ob) { S.obstacles = S.obstacles.filter(x => x !== ob); }

// Signed distance of a point to an obstacle (negative inside).
export function obstacleSDF(o, x, y) {
  const c = Math.cos(-o.a), s = Math.sin(-o.a), dx = x - o.x, dy = y - o.y;
  const px = c * dx - s * dy, py = s * dx + c * dy;
  switch (o.shape) {
    case 'square': { const qx = Math.abs(px) - o.r * 0.85, qy = Math.abs(py) - o.r * 0.85; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0); }
    case 'ellipse': { const ax = o.r * 1.4, ay = o.r * 0.42; const k = Math.hypot(px / ax, py / ay); return (k - 1) * Math.min(ax, ay); }
    case 'plate': { const qx = Math.abs(px) - o.r * 1.2, qy = Math.abs(py) - Math.max(0.012, o.r * 0.12); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0); }
    default: return Math.hypot(dx, dy) - o.r;
  }
}

// Move the obstacles along their paths (unless held by the pointer).
function moveObstacles(S, dt) {
  const t = S.t;
  for (const o of S.obstacles) {
    const px = o.x, py = o.y, pa = o.a;
    if (!o.held) {
      const w = 2 * Math.PI * o.freq;
      if (o.motion === 'orbit') { o.x = o.x0 + o.amp * Math.cos(w * t + o.ph); o.y = o.y0 + o.amp * 0.8 * Math.sin(w * t + o.ph); }
      else if (o.motion === 'bob') { o.y = o.y0 + o.amp * Math.sin(w * t + o.ph); }
      else if (o.motion === 'sweep') { o.x = o.x0 + o.amp * Math.sin(w * t + o.ph); }
      else if (o.motion === 'spin') { o.a = o.a0 + w * t * 1.5; }
      const m = 0.02 + o.r;
      o.x = Math.min(S.W - m, Math.max(m, o.x)); o.y = Math.min(S.H - m, Math.max(m, o.y));
    }
    o.vx = dt > 0 ? (o.x - px) / dt : 0; o.vy = dt > 0 ? (o.y - py) / dt : 0; o.w = dt > 0 ? (o.a - pa) / dt : 0;
    if (!Number.isFinite(o.vx + o.vy + o.w)) { o.vx = o.vy = o.w = 0; }
    // clamp so a thrown obstacle cannot break the CFL limit
    const vmax = 0.9 * S.f.h / Math.max(1e-4, S.P.dt) * 3;
    const sp = Math.hypot(o.vx, o.vy); if (sp > vmax) { o.vx *= vmax / sp; o.vy *= vmax / sp; }
  }
}

// Mark obstacle cells solid and give them the obstacle velocity (upstream
// setObstacle, for several shapes). Smoke inside: clear (1) in the tunnel,
// a cycling dye in paint (upstream: 0.5 + 0.5 sin(0.1 frame)).
function stampObstacles(S) {
  const f = S.f, n = f.numY, h = f.h, wall = S.wall;
  for (let i = 1; i < f.numX - 1; i++) for (let j = 1; j < f.numY - 1; j++) if (!wall[i * n + j]) f.s[i * n + j] = 1.0;
  const list = S.finger ? S.obstacles.concat([S.finger]) : S.obstacles;
  for (const o of list) {
    const R = o.r * 1.5 + 2 * h;
    const i0 = Math.max(1, Math.floor((o.x - R) / h)), i1 = Math.min(f.numX - 2, Math.ceil((o.x + R) / h));
    const j0 = Math.max(1, Math.floor((o.y - R) / h)), j1 = Math.min(f.numY - 2, Math.ceil((o.y + R) / h));
    const dye = S.kind === 'paint' ? 0.5 + 0.5 * Math.sin(0.1 * S.frame + o.hue * 6.283) : 1.0;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i * n + j; if (wall[k]) continue;
      const x = (i + 0.5) * h, y = (j + 0.5) * h;
      if (obstacleSDF(o, x, y) < 0) {
        f.s[k] = 0.0;
        if (S.kind !== 'tank') f.m[k] = dye;
        const ux = o.vx - o.w * (y - o.y), vy = o.vy + o.w * (x - o.x);
        f.u[k] = ux; f.u[k + n] = ux; f.v[k] = vy; f.v[k + 1] = vy;
      }
    }
  }
}

// One frame: obstacles, forcing, the upstream solver step.
export function step(S, dt = S.P.dt) {
  const f = S.f, n = f.numY, P = S.P;
  S.t += dt;
  moveObstacles(S, dt);
  stampObstacles(S);
  if (S.kind === 'tunnel') for (let j = 1; j < f.numY - 1; j++) f.u[1 * n + j] = P.inVel;
  if (S.kind === 'cavity') for (let i = 1; i < f.numX; i++) f.u[i * n + f.numY - 2] = P.lid;
  if (S.kind === 'jets') {
    for (const J of S.jets) {
      const i = J.left ? 1 : f.numX - 2, j0 = Math.max(1, Math.floor((J.y - J.w / 2) / f.h)), j1 = Math.min(f.numY - 2, Math.ceil((J.y + J.w / 2) / f.h));
      const pulse = 0.75 + 0.25 * Math.sin(S.t * 1.3 + J.hue * 9);
      for (let j = j0; j <= j1; j++) {
        const k = i * n + j;
        f.u[k + (J.left ? n : 0)] = (J.left ? 1 : -1) * P.jet * pulse * Math.cos(J.ang);
        f.v[k] = P.jet * pulse * Math.sin(J.ang);
        f.m[k] = J.hue;
      }
    }
  }
  const g = S.kind === 'tank' ? -P.g : 0;
  if (P.visc > 0) diffuse(S, P.visc, dt);
  f.simulate(dt, g, P.iters, P.over);
  // the lid: the projection takes the forced row back, so the top row is
  // set again after the step and drags the fluid under it by advection
  if (S.kind === 'cavity') for (let i = 1; i < f.numX; i++) { f.u[i * n + f.numY - 2] = P.lid; f.u[i * n + f.numY - 1] = P.lid; }
  S.frame++;
}

// Viscosity (our addition; upstream is inviscid): one explicit diffusion
// step of u and v over open faces, nu clamped to the stable limit
// nu dt / h^2 <= 0.2. A wall face keeps its value, so the moving lid row
// drags the fluid under it (the lid-driven cavity needs this).
function diffuse(S, nu, dt) {
  const f = S.f, n = f.numY, h = f.h, k = Math.min(nu * dt / (h * h), 0.2);
  if (!(k > 0)) return;
  for (const [a, tmp, isU] of [[f.u, f.newU, true], [f.v, f.newV, false]]) {
    tmp.set(a);
    for (let i = 1; i < f.numX - 1; i++) for (let j = 1; j < f.numY - 1; j++) {
      const c = i * n + j;
      if (f.s[c] === 0 || (isU ? f.s[c - n] === 0 : f.s[c - 1] === 0)) continue;
      tmp[c] = a[c] + k * (a[c - n] + a[c + n] + a[c - 1] + a[c + 1] - 4 * a[c]);
    }
    a.set(tmp);
  }
}

// Finite fields? (tests)
export function health(S) {
  const f = S.f; let bad = 0, vmax = 0;
  for (let k = 0; k < f.numCells; k++) {
    const u = f.u[k], v = f.v[k], m = f.m[k], p = f.p[k];
    if (!Number.isFinite(u + v + m + p)) bad++; else vmax = Math.max(vmax, Math.abs(u), Math.abs(v));
  }
  return { bad, vmax };
}
