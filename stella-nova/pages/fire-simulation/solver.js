/*
Copyright 2022 Matthias Müller - Ten Minute Physics, 
www.youtube.com/c/TenMinutePhysics
www.matthiasMueller.info/tenMinutePhysics

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Fire Simulation · upstream script 1, verbatim from Ten Minute Physics
// 21-fire.html by Matthias Müller. MIT License (notice kept above).
// Source: https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/21-fire.html
// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/solver.js — fire on a grid
// ----------------------------------------------------------------------------
//  UPSTREAM (MIT, notice above): class Fluid is Matthias Müller's Ten Minute
//  Physics #21 (21-fire.html) in module form: staggered grid, Gauss-Seidel
//  projection (overrelaxation 1.9), semi-Lagrangian advection of velocity
//  and temperature, buoyant lift, fire and smoke cooling, random swirls.
//  Changes to it:
//    - updateFire reads its settings from this.cfg (lift, cooling rates,
//      acceleration, swirl rate, size, strength and life) instead of the
//      global scene and its fixed constants; the upstream values are the
//      defaults (createSim);
//    - the burners are a list (this.cfg.burners) of four kinds; the
//      upstream burning ring is kind 'ring' with the same cell rule;
//    - random numbers come from a seeded stream (this.rand) so a scene
//      repeats; upstream used Math.random;
//    - maxSwirls is set (upstream read an unset this.maxSwirls);
//    - the debug counter is gone.
//
//  OUR ADDITIONS (davesgames.io, not upstream), below "site layer": burner
//  kinds (disc, log, torch), burner motions, wind, the stir of a dragged
//  burner for every kind, scenes and a health check.
//
//  grep -n targets: "export class Fluid", "updateFire(", "function burnCell",
//  "export function createSim", "export function buildScene", "export function step"
// ============================================================================

export const U_FIELD = 0, V_FIELD = 1, T_FIELD = 2;

function kernel(r, rmax, leftBorder, rightBorder) {
  if (r >= rmax || r <= 0.0) return 0.0;
  else if (r < leftBorder) return r / leftBorder;
  else if (r <= rmax - rightBorder) return 1.0;
  else return (rmax - r) / rightBorder;
}
export { kernel };

export class Fluid {
  constructor(numX, numY, h, cfg, rand) {
    this.numX = numX + 2;
    this.numY = numY + 2;
    this.numCells = this.numX * this.numY;
    this.h = h;
    this.u = new Float32Array(this.numCells);
    this.v = new Float32Array(this.numCells);
    this.newU = new Float32Array(this.numCells);
    this.newV = new Float32Array(this.numCells);
    this.s = new Float32Array(this.numCells);
    this.t = new Float32Array(this.numCells);
    this.newT = new Float32Array(this.numCells);
    this.t.fill(0.0);
    this.s.fill(1.0);
    this.cfg = cfg; this.rand = rand || Math.random;
    this.numSwirls = 0;
    this.maxSwirls = 100;
    this.swirlGlobalTime = 0.0;
    this.swirlX = new Float32Array(this.maxSwirls);
    this.swirlY = new Float32Array(this.maxSwirls);
    this.swirlOmega = new Float32Array(this.maxSwirls);
    this.swirlRadius = new Float32Array(this.maxSwirls);
    this.swirlTime = new Float32Array(this.maxSwirls);
    this.swirlTime.fill(0.0);
  }
  integrate(dt, gravity) {
    const n = this.numY;
    for (let i = 1; i < this.numX; i++)
      for (let j = 1; j < this.numY - 1; j++)
        if (this.s[i * n + j] != 0.0 && this.s[i * n + j - 1] != 0.0) this.v[i * n + j] += gravity * dt;
  }
  solveIncompressibility(numIters, dt) {
    const n = this.numY, overRelaxation = 1.9;
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
    for (let i = 0; i < this.numX; i++) { this.u[i * n + 0] = this.u[i * n + 1]; this.u[i * n + this.numY - 1] = this.u[i * n + this.numY - 2]; }
    for (let j = 0; j < this.numY; j++) { this.v[0 * n + j] = this.v[1 * n + j]; this.v[(this.numX - 1) * n + j] = this.v[(this.numX - 2) * n + j]; }
  }
  sampleField(x, y, field) {
    const n = this.numY, h = this.h, h1 = 1.0 / h, h2 = 0.5 * h;
    x = Math.max(Math.min(x, this.numX * h), h);
    y = Math.max(Math.min(y, this.numY * h), h);
    let dx = 0.0, dy = 0.0, f;
    switch (field) {
      case U_FIELD: f = this.u; dy = h2; break;
      case V_FIELD: f = this.v; dx = h2; break;
      case T_FIELD: f = this.t; dx = h2; dy = h2; break;
    }
    const x0 = Math.min(Math.floor((x - dx) * h1), this.numX - 1), tx = ((x - dx) - x0 * h) * h1, x1 = Math.min(x0 + 1, this.numX - 1);
    const y0 = Math.min(Math.floor((y - dy) * h1), this.numY - 1), ty = ((y - dy) - y0 * h) * h1, y1 = Math.min(y0 + 1, this.numY - 1);
    const sx = 1.0 - tx, sy = 1.0 - ty;
    return sx * sy * f[x0 * n + y0] + tx * sy * f[x1 * n + y0] + tx * ty * f[x1 * n + y1] + sx * ty * f[x0 * n + y1];
  }
  avgU(i, j) { const n = this.numY; return (this.u[i * n + j - 1] + this.u[i * n + j] + this.u[(i + 1) * n + j - 1] + this.u[(i + 1) * n + j]) * 0.25; }
  avgV(i, j) { const n = this.numY; return (this.v[(i - 1) * n + j] + this.v[i * n + j] + this.v[(i - 1) * n + j + 1] + this.v[i * n + j + 1]) * 0.25; }
  advectVel(dt) {
    this.newU.set(this.u); this.newV.set(this.v);
    const n = this.numY, h = this.h, h2 = 0.5 * h;
    for (let i = 1; i < this.numX; i++) {
      for (let j = 1; j < this.numY; j++) {
        if (this.s[i * n + j] != 0.0 && this.s[(i - 1) * n + j] != 0.0 && j < this.numY - 1) {
          const u = this.u[i * n + j], v = this.avgV(i, j);
          this.newU[i * n + j] = this.sampleField(i * h - dt * u, j * h + h2 - dt * v, U_FIELD);
        }
        if (this.s[i * n + j] != 0.0 && this.s[i * n + j - 1] != 0.0 && i < this.numX - 1) {
          const u = this.avgU(i, j), v = this.v[i * n + j];
          this.newV[i * n + j] = this.sampleField(i * h + h2 - dt * u, j * h - dt * v, V_FIELD);
        }
      }
    }
    this.u.set(this.newU); this.v.set(this.newV);
  }
  advectTemperature(dt) {
    this.newT.set(this.t);
    const n = this.numY, h = this.h, h2 = 0.5 * h;
    for (let i = 1; i < this.numX - 1; i++) {
      for (let j = 1; j < this.numY - 1; j++) {
        if (this.s[i * n + j] != 0.0) {
          const u = (this.u[i * n + j] + this.u[(i + 1) * n + j]) * 0.5, v = (this.v[i * n + j] + this.v[i * n + j + 1]) * 0.5;
          this.newT[i * n + j] = this.sampleField(i * h + h2 - dt * u, j * h + h2 - dt * v, T_FIELD);
        }
      }
    }
    this.t.set(this.newT);
  }
  updateFire(dt) {
    const C = this.cfg, h = this.h, rand = this.rand;
    const swirlTimeSpan = C.swirlLife, swirlOmega = C.swirlOmega, swirlDamping = 10.0 * dt;
    const swirlProbability = C.swirlProbability * h * h;
    const fireCooling = C.fireCooling * dt, smokeCooling = C.smokeCooling * dt;
    const lift = C.lift, acceleration = C.accel * dt, kernelRadius = C.swirlMaxRadius;
    const n = this.numY, maxX = (this.numX - 1) * this.h, maxY = (this.numY - 1) * this.h;
    // kill swirls
    let num = 0;
    for (let nr = 0; nr < this.numSwirls; nr++) {
      this.swirlTime[nr] -= dt;
      if (this.swirlTime[nr] > 0.0) {
        this.swirlTime[num] = this.swirlTime[nr]; this.swirlX[num] = this.swirlX[nr];
        this.swirlY[num] = this.swirlY[nr]; this.swirlOmega[num] = this.swirlOmega[nr]; num++;
      }
    }
    this.numSwirls = num;
    // advect and modify velocity field
    for (let nr = 0; nr < this.numSwirls; nr++) {
      let x = this.swirlX[nr], y = this.swirlY[nr];
      const swirlU = (1.0 - swirlDamping) * this.sampleField(x, y, U_FIELD);
      const swirlV = (1.0 - swirlDamping) * this.sampleField(x, y, V_FIELD);
      x += swirlU * dt; y += swirlV * dt;
      x = Math.min(Math.max(x, h), maxX); y = Math.min(Math.max(y, h), maxY);
      this.swirlX[nr] = x; this.swirlY[nr] = y;
      const omega = this.swirlOmega[nr];
      const x0 = Math.max(Math.floor((x - kernelRadius) / h), 0), y0 = Math.max(Math.floor((y - kernelRadius) / h), 0);
      const x1 = Math.min(Math.floor((x + kernelRadius) / h) + 1, this.numX - 1), y1 = Math.min(Math.floor((y + kernelRadius) / h) + 1, this.numY - 1);
      for (let i = x0; i <= x1; i++) {
        for (let j = y0; j <= y1; j++) {
          for (let dim = 0; dim < 2; dim++) {
            const vx = dim == 0 ? i * h : (i + 0.5) * h, vy = dim == 0 ? (j + 0.5) * h : j * h;
            const rx = vx - x, ry = vy - y, r = Math.sqrt(rx * rx + ry * ry);
            if (r < kernelRadius) {
              let s = 1.0;
              if (r > 0.8 * kernelRadius) s = 5.0 - 5.0 / kernelRadius * r;
              if (dim == 0) { const target = ry * omega + swirlU, u = this.u[n * i + j]; this.u[n * i + j] = (target - u) * s; }
              else { const target = -rx * omega + swirlV, v = this.v[n * i + j]; this.v[n * i + j] += (target - v) * s; }
            }
          }
        }
      }
    }
    // update temperatures
    for (let i = 0; i < this.numX; i++) {
      for (let j = 0; j < this.numY; j++) {
        const t = this.t[i * n + j];
        const cooling = t < 0.3 ? smokeCooling : fireCooling;
        this.t[i * n + j] = Math.max(t - cooling, 0.0);
        const v = this.v[i * n + j];
        const targetV = t * lift;
        this.v[i * n + j] += (targetV - v) * acceleration;
        let numNewSwirls = 0;
        // burners (upstream: one burning ring)
        for (const b of C.burners) if (b.on && burnCell(this, b, i, j)) { this.t[i * n + j] = 1.0; if (b.kind === 'torch') this.v[i * n + j] = Math.max(this.v[i * n + j], C.torch); if (rand() < 0.5 * swirlProbability) numNewSwirls++; }
        // floor burning
        if (j < 4 && C.floor) {
          this.t[i * n + j] = 1.0; this.u[i * n + j] = 0.0; this.v[i * n + j] = 0.0;
          if (rand() < swirlProbability) numNewSwirls++;
        }
        for (let k = 0; k < numNewSwirls; k++) {
          if (this.numSwirls >= this.maxSwirls) break;
          const nr = this.numSwirls;
          this.swirlX[nr] = i * h; this.swirlY[nr] = j * h;
          this.swirlOmega[nr] = (-1.0 + 2.0 * rand()) * swirlOmega;
          this.swirlTime[nr] = swirlTimeSpan;
          this.numSwirls++;
        }
      }
    }
    // smooth temperatures
    for (let i = 1; i < this.numX - 1; i++) {
      for (let j = 1; j < this.numY - 1; j++) {
        const t = this.t[i * n + j];
        if (t == 1.0) this.t[i * n + j] = (this.t[(i - 1) * n + (j - 1)] + this.t[(i + 1) * n + (j - 1)] + this.t[(i + 1) * n + (j + 1)] + this.t[(i - 1) * n + (j + 1)]) * 0.25;
      }
    }
  }
  simulate(dt, gravity, numIters) {
    this.integrate(dt, gravity);
    this.solveIncompressibility(numIters, dt);
    this.extrapolate();
    this.advectVel(dt);
    this.advectTemperature(dt);
    this.updateFire(dt);
  }
}

// Does burner b light cell (i, j)? Upstream ring: a ring of cells from
// 0.85 r to r + h around the centre, 3 cells up.
export function burnCell(f, b, i, j) {
  const h = f.h, x = (i + 0.5) * h, y = (j + 0.5) * h;
  if (b.kind === 'ring') {
    const dx = x - b.x, dy = y - b.y - 3.0 * h, d = dx * dx + dy * dy, minR = 0.85 * b.r, maxR = b.r + h;
    return minR * minR <= d && d < maxR * maxR;
  }
  if (b.kind === 'disc') { const dx = x - b.x, dy = y - b.y; return dx * dx + dy * dy < b.r * b.r * 0.5; }
  if (b.kind === 'log') { return Math.abs(x - b.x) < b.r * 1.3 && Math.abs(y - b.y) < Math.max(2.5 * h, b.r * 0.12); }
  const dx = x - b.x, dy = y - b.y; return dx * dx + dy * dy < Math.max(2.2 * h, b.r * 0.35) ** 2;   // torch
}

// ============================================================================
//  site layer (davesgames.io): scenes, burner motion, wind
// ============================================================================
export const BURNERS = ['ring', 'disc', 'log', 'torch'];

// Upstream values are the defaults.
export function defaultCfg() {
  return { lift: 3.0, fireCooling: 1.2, smokeCooling: 0.3, accel: 6.0, swirlProbability: 50.0, swirlMaxRadius: 0.05, swirlOmega: 20.0, swirlLife: 1.0,
    floor: false, burners: [], torch: 2.5, wind: 0, gravity: 0, iters: 10, dt: 1 / 60 };
}
export function createSim() { return { f: null, cfg: defaultCfg(), W: 1.6, H: 1, frame: 0, t: 0, rand: Math.random }; }

// cfg = { cells, aspect, burners: [{ kind, x, y, r, motion, amp, freq, ph }] }
// (positions as fractions of the domain); rand: a seeded stream.
export function buildScene(S, sc, rand) {
  const aspect = Math.max(0.5, sc.aspect || 1.6), cells = Math.max(4000, sc.cells || 100000);
  const simWidth = aspect, simHeight = 1.0;
  const h = Math.sqrt(simWidth * simHeight / cells);
  const numX = Math.floor(simWidth / h), numY = Math.floor(simHeight / h);
  S.rand = rand || Math.random;
  S.f = new Fluid(numX, numY, h, S.cfg, S.rand);
  S.W = (S.f.numX - 1) * h; S.H = (S.f.numY - 1) * h; S.frame = 0; S.t = 0;
  S.cfg.burners = (sc.burners || []).map(b => makeBurner(S, b));
  return S;
}
export function makeBurner(S, b) {
  const x = b.fx != null ? b.fx * S.W : b.x, y = b.fy != null ? b.fy * S.H : b.y;
  return { kind: b.kind || 'ring', x, y, x0: x, y0: y, r: b.r || 0.13, motion: b.motion || 'static', amp: b.amp ?? 0.2, freq: b.freq ?? 0.12, ph: b.ph || 0, on: b.on !== false, held: false, vx: 0, vy: 0 };
}
export function addBurner(S, b) { const o = makeBurner(S, b); S.cfg.burners.push(o); return o; }

function moveBurners(S, dt) {
  const t = S.t, f = S.f, n = f.numY;
  for (const b of S.cfg.burners) {
    const px = b.x, py = b.y;
    if (!b.held) {
      const w = 2 * Math.PI * b.freq;
      if (b.motion === 'orbit') { b.x = b.x0 + b.amp * Math.sin(w * t + b.ph); b.y = b.y0 + b.amp * 0.4 * Math.sin(2 * w * t + b.ph); }
      else if (b.motion === 'sweep') b.x = b.x0 + b.amp * Math.sin(w * t + b.ph);
      else if (b.motion === 'bob') b.y = b.y0 + b.amp * 0.5 * Math.sin(w * t + b.ph);
      b.x = Math.min(S.W - 0.02, Math.max(0.02, b.x)); b.y = Math.min(S.H - 0.02, Math.max(0.02, b.y));
    }
    b.vx = dt > 0 ? (b.x - px) / dt : 0; b.vy = dt > 0 ? (b.y - py) / dt : 0;
    // the upstream drag stir: 0.2 of the burner velocity into the cells it covers
    const sp = Math.hypot(b.vx, b.vy); if (!(sp > 1e-6) || sp > 40) continue;
    const r = b.r, i0 = Math.max(1, Math.floor((b.x - r) / f.h)), i1 = Math.min(f.numX - 3, Math.ceil((b.x + r) / f.h));
    const j0 = Math.max(1, Math.floor((b.y - r) / f.h)), j1 = Math.min(f.numY - 3, Math.ceil((b.y + r) / f.h));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const dx = (i + 0.5) * f.h - b.x, dy = (j + 0.5) * f.h - b.y;
      if (dx * dx + dy * dy < r * r) { f.u[i * n + j] += 0.2 * b.vx; f.u[(i + 1) * n + j] += 0.2 * b.vx; f.v[i * n + j] += 0.2 * b.vy; f.v[i * n + j + 1] += 0.2 * b.vy; }
    }
  }
}

export function step(S, dt = S.cfg.dt) {
  const f = S.f, n = f.numY, C = S.cfg;
  S.t += dt;
  moveBurners(S, dt);
  // wind: a gentle side draft that blows from the left wall
  if (C.wind) for (let j = 1; j < f.numY - 1; j++) { f.u[1 * n + j] += (C.wind - f.u[1 * n + j]) * 0.2; }
  f.simulate(dt, C.gravity, C.iters);
  S.frame++;
}
export function health(S) {
  const f = S.f; let bad = 0, vmax = 0, tsum = 0;
  for (let k = 0; k < f.numCells; k++) { const a = f.u[k] + f.v[k] + f.t[k]; if (!Number.isFinite(a)) bad++; else { vmax = Math.max(vmax, Math.abs(f.u[k]), Math.abs(f.v[k])); tsum += f.t[k]; } }
  return { bad, vmax, heat: tsum / f.numCells };
}
