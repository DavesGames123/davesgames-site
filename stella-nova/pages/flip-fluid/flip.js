/*
Copyright 2022 Matthias Müller - Ten Minute Physics,
www.youtube.com/c/TenMinutePhysics
www.matthiasMueller.info/tenMinutePhysics

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// ============================================================================
//  FLIP WATER  ·  flip.js  —  the FLIP solver, as an ES module
// ----------------------------------------------------------------------------
//  The core is the FlipFluid class of Ten Minute Physics #18 by Matthias
//  Müller (18-flip.html, MIT, notice above): particle integration, push
//  apart, particle-to-grid and grid-to-particle transfer with the PIC/FLIP
//  blend, the drift-compensated Gauss-Seidel pressure solve. The method
//  names and the loops follow upstream.
//
//  Our additions (davesgames.io, not upstream): a gravity vector (tilted
//  tanks), static obstacles as a signed-distance grid, moving solids with
//  velocity boundary conditions on their grid faces, emitters, drains,
//  wind on the surface cells, damping, a viscosity smoothing pass, a CFL
//  speed clamp with adaptive substeps, a seeded RNG, and hooks for the
//  rigid-body coupling (bodies.js). The upstream colour code is gone: the
//  renderer colours the water.
//
//  Coordinates: metres, origin at the tank's bottom-left corner, y up.
//  Grid cell (i, j) has index i * fNumY + j. Face u[i,j] is on the left
//  edge of cell (i, j), face v[i,j] on its bottom edge (upstream layout).
//
//  grep -n targets
//    class FlipSim          constructor(spec): grid, particles, statics
//    step(                  one frame: adaptive substeps
//    substep(               the upstream order of operations
//    integrateParticles     gravity, wind, damping, CFL clamp
//    pushParticlesApart     upstream
//    handleParticleCollisions  walls, static SDF, solids
//    rasterSolids           moving solids -> s = 0 and solidId
//    transferVelocities     upstream P2G / G2P
//    solidFaces             face velocities of solids (boundary condition)
//    solveIncompressibility upstream + stiffness k
//    emit / drain           sources and sinks
//    stats()                counts for tests and the HUD
// ============================================================================
import { sdfWorld, normalWorld } from './shapes.js';

export const FLUID_CELL = 0, AIR_CELL = 1, SOLID_CELL = 2;

export function mulberry(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const N2 = new Float64Array(2), V2 = new Float64Array(2);

// A moving solid: a placed shape with a rigid velocity. Kinematic solids
// (paddles, the gate, the stir disc) follow motion(t); dynamic bodies
// (bodies.js) are moved by the body solver.
export class Solid {
  constructor(shape, x, y, a = 0) {
    this.shape = shape; this.x = x; this.y = y; this.a = a;
    this.vx = 0; this.vy = 0; this.w = 0;
    this.kinematic = true; this.motion = null; this.active = true; this.kind = 'solid';
  }
  velAt(px, py, out) { out[0] = this.vx - this.w * (py - this.y); out[1] = this.vy + this.w * (px - this.x); return out; }
}

export class FlipSim {
  // spec: see scenes.js build(). Required: W, H, h, r, gx, gy, water[].
  constructor(spec) {
    this.spec = spec;
    this.rng = mulberry(spec.simSeed || 1);
    this.density = 1000;
    this.fNumX = Math.floor(spec.W / spec.h) + 1;
    this.fNumY = Math.floor(spec.H / spec.h) + 1;
    this.h = Math.max(spec.W / this.fNumX, spec.H / this.fNumY);
    this.fInvSpacing = 1 / this.h;
    this.fNumCells = this.fNumX * this.fNumY;
    const C = this.fNumCells;
    this.u = new Float32Array(C); this.v = new Float32Array(C);
    this.du = new Float32Array(C); this.dv = new Float32Array(C);
    this.prevU = new Float32Array(C); this.prevV = new Float32Array(C);
    this.p = new Float32Array(C); this.s = new Float32Array(C);
    this.sStatic = new Float32Array(C);
    this.sdf = new Float32Array(C);          // static signed distance at cell centres
    this.solidId = new Int16Array(C).fill(-1);
    this.cellType = new Int32Array(C);
    this.particleDensity = new Float32Array(C);
    this.particleRestDensity = 0;

    // Settings (the scene may change them while it runs).
    this.gx = spec.gx; this.gy = spec.gy;
    this.flipRatio = spec.flip ?? 0.9;
    this.numPressureIters = spec.pressureIters ?? 50;
    this.numParticleIters = spec.particleIters ?? 2;
    this.overRelaxation = spec.overRelax ?? 1.9;
    this.compensateDrift = spec.compensate ?? true;
    this.stiffness = spec.stiffness ?? 1;
    this.separateParticles = spec.separate ?? true;
    this.damping = spec.damping ?? 0;
    this.viscosity = spec.viscosity ?? 0;
    this.wind = spec.wind ?? 0;
    this.dt = spec.dt ?? 1 / 60;
    this.baseSubsteps = spec.substeps ?? 1;
    this.cfl = spec.cfl ?? 1.5;
    this.time = 0; this.frame = 0; this.lastSubsteps = this.baseSubsteps;

    this.statics = spec.statics || [];
    this.solids = [];
    this.emitters = (spec.emitters || []).map(e => Object.assign({ acc: 0 }, e));
    this.drains = spec.drains || [];
    this.emitted = 0; this.drained = 0;
    this.onCoupling = null;   // bodies.js hook: (sim, sdt) after G2P
    this.onSolidHit = null;   // bodies.js hook: (solid, px, py, jx, jy)

    this.particleRadius = spec.r;
    this.pInvSpacing = 1 / (2.2 * spec.r);
    this.pNumX = Math.floor(spec.W * this.pInvSpacing) + 1;
    this.pNumY = Math.floor(spec.H * this.pInvSpacing) + 1;
    this.pNumCells = this.pNumX * this.pNumY;
    this.numCellParticles = new Int32Array(this.pNumCells);
    this.firstCellParticle = new Int32Array(this.pNumCells + 1);

    this.buildStatics();
    const cap = this.countFill();
    this.maxParticles = Math.max(cap, spec.maxParticles || 0, 16);
    const M = this.maxParticles;
    this.particlePos = new Float32Array(2 * M);
    this.particleVel = new Float32Array(2 * M);
    this.cellParticleIds = new Int32Array(M);
    this.numParticles = 0;
    this.fill();
    this.initialParticles = this.numParticles;
    this.maxSpeed = 0;
  }

  // ---- statics --------------------------------------------------------------
  buildStatics() {
    const n = this.fNumY, h = this.h;
    for (let i = 0; i < this.fNumX; i++) {
      for (let j = 0; j < this.fNumY; j++) {
        const x = (i + 0.5) * h, y = (j + 0.5) * h;
        let d = 1e9;
        for (const st of this.statics) d = Math.min(d, sdfWorld(st, x, y));
        this.sdf[i * n + j] = d;
        const wall = i === 0 || i === this.fNumX - 1 || j === 0;
        this.sStatic[i * n + j] = wall || d < 0 ? 0 : 1;
      }
    }
    this.s.set(this.sStatic);
  }

  staticDist(x, y) {
    let d = 1e9;
    for (let k = 0; k < this.statics.length; k++) { const e = sdfWorld(this.statics[k], x, y); if (e < d) d = e; }
    return d;
  }

  // Bilinear static SDF from the grid: a cheap test before the exact one.
  sdfGrid(x, y) {
    const h = this.h, n = this.fNumY;
    const fx = clamp(x / h - 0.5, 0, this.fNumX - 1.001), fy = clamp(y / h - 0.5, 0, this.fNumY - 1.001);
    const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, c = i * n + j;
    return (1 - tx) * ((1 - ty) * this.sdf[c] + ty * this.sdf[c + 1]) + tx * ((1 - ty) * this.sdf[c + n] + ty * this.sdf[c + n + 1]);
  }

  // ---- initial water --------------------------------------------------------
  inWater(x, y) {
    for (const w of this.spec.water) {
      if (w.kind === 'rect' && x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1) return w;
      if (w.kind === 'disc' && (x - w.cx) ** 2 + (y - w.cy) ** 2 <= w.r * w.r) return w;
    }
    return null;
  }
  freeAt(x, y, r) {
    if (this.statics.length && this.staticDist(x, y) < r) return false;
    for (const s of this.solids) if (sdfWorld(s, x, y) < r) return false;
    return true;
  }
  lattice(cb) {
    const r = this.particleRadius, h = this.h, dx = 2 * r, dy = Math.sqrt(3) * r;
    const x1 = (this.fNumX - 1) * h - r, y1 = (this.fNumY - 1) * h - r;
    for (let j = 0; ; j++) {
      const y = h + r + dy * j; if (y > y1) break;
      for (let i = 0; ; i++) {
        const x = h + r + dx * i + (j % 2 ? r : 0); if (x > x1) break;
        const w = this.inWater(x, y);
        if (w && this.freeAt(x, y, r)) cb(x, y, w);
      }
    }
  }
  countFill() { let c = 0; this.lattice(() => c++); return c; }
  fill() {
    const P = this.particlePos, V = this.particleVel, M = this.maxParticles;
    let k = 0;
    this.lattice((x, y, w) => { if (k >= M) return; P[2 * k] = x; P[2 * k + 1] = y; V[2 * k] = w.vx || 0; V[2 * k + 1] = w.vy || 0; k++; });
    this.numParticles = k;
  }
  // Fill again after solids were added (the water must not start inside them).
  refill() { this.fill(); this.initialParticles = this.numParticles; this.emitted = 0; this.drained = 0; this.particleRestDensity = 0; }

  addSolid(s) { this.solids.push(s); return s; }
  removeSolid(s) { const i = this.solids.indexOf(s); if (i >= 0) this.solids.splice(i, 1); }

  // ---- one frame -------------------------------------------------------------
  step() {
    const h = this.h;
    // Substeps: enough that the fastest particle moves at most cfl cells.
    let n = Math.ceil(this.maxSpeed * this.dt / (this.cfl * h));
    n = clamp(n, this.baseSubsteps, this.baseSubsteps + 3);
    this.lastSubsteps = n;
    const sdt = this.dt / n;
    for (let k = 0; k < n; k++) this.substep(sdt);
    this.frame++;
  }

  substep(sdt) {
    this.moveKinematic(sdt);
    this.integrateParticles(sdt);
    if (this.emitters.length) this.emit(sdt);
    if (this.drains.length) this.drain();
    if (this.separateParticles) this.pushParticlesApart(this.numParticleIters);
    this.handleParticleCollisions();
    this.rasterSolids();
    this.transferVelocities(true);
    this.solidFaces();
    this.updateParticleDensity();
    if (this.viscosity > 0) this.smoothVelocities();
    this.solveIncompressibility(this.numPressureIters, sdt, this.overRelaxation, this.compensateDrift);
    this.transferVelocities(false, this.flipRatio);
    if (this.onCoupling) this.onCoupling(this, sdt);
    this.time += sdt;
  }

  moveKinematic(sdt) {
    const t1 = this.time + sdt;
    for (const s of this.solids) {
      if (!s.kinematic || !s.motion) continue;
      const x0 = s.x, y0 = s.y, a0 = s.a;
      s.motion(t1, s);
      s.vx = (s.x - x0) / sdt; s.vy = (s.y - y0) / sdt; s.w = (s.a - a0) / sdt;
    }
  }

  integrateParticles(dt) {
    const P = this.particlePos, V = this.particleVel, n = this.fNumY, h1 = this.fInvSpacing;
    const gx = this.gx, gy = this.gy;
    const damp = Math.max(0, 1 - this.damping * dt);
    const vmax = this.cfl * this.h / dt, vmax2 = vmax * vmax;
    const wind = this.wind * dt, windOn = this.wind !== 0 && this.frame > 0;
    // "Up" is against gravity, rounded to a grid axis: the surface test.
    const ax = Math.abs(gx) > Math.abs(gy);
    const up = ax ? (gx > 0 ? -n : n) : (gy > 0 ? -1 : 1);
    let ms = 0;
    for (let i = 0; i < this.numParticles; i++) {
      let vx = (V[2 * i] + dt * gx) * damp, vy = (V[2 * i + 1] + dt * gy) * damp;
      if (windOn) {
        const xi = clamp(Math.floor(P[2 * i] * h1), 1, this.fNumX - 2), yi = clamp(Math.floor(P[2 * i + 1] * h1), 1, this.fNumY - 2);
        const c = xi * n + yi;
        if (this.cellType[c + up] === AIR_CELL) vx += wind;
      }
      const s2 = vx * vx + vy * vy;
      if (s2 > vmax2) { const f = vmax / Math.sqrt(s2); vx *= f; vy *= f; }
      if (s2 > ms) ms = s2;
      V[2 * i] = vx; V[2 * i + 1] = vy;
      P[2 * i] += vx * dt; P[2 * i + 1] += vy * dt;
    }
    this.maxSpeed = Math.min(Math.sqrt(ms), vmax);
  }

  emit(dt) {
    const P = this.particlePos, V = this.particleVel, r = this.particleRadius;
    for (const e of this.emitters) {
      e.acc += e.rate * dt;
      const px = -e.dy, py = e.dx;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (this.numParticles >= this.maxParticles) { e.acc = 0; break; }
        const o = (this.rng() - 0.5) * e.width, f = this.rng() * e.speed * dt;
        const x = e.x + px * o + e.dx * f, y = e.y + py * o + e.dy * f;
        if (this.statics.length && this.sdfGrid(x, y) < r) continue;
        const k = this.numParticles++;
        P[2 * k] = x; P[2 * k + 1] = y; V[2 * k] = e.dx * e.speed; V[2 * k + 1] = e.dy * e.speed;
        this.emitted++;
      }
    }
  }

  drain() {
    const P = this.particlePos, V = this.particleVel;
    for (const d of this.drains) {
      for (let i = 0; i < this.numParticles; i++) {
        const x = P[2 * i], y = P[2 * i + 1];
        if (x < d.x0 || x > d.x1 || y < d.y0 || y > d.y1) continue;
        const l = --this.numParticles;
        P[2 * i] = P[2 * l]; P[2 * i + 1] = P[2 * l + 1]; V[2 * i] = V[2 * l]; V[2 * i + 1] = V[2 * l + 1];
        this.drained++; i--;
      }
    }
  }

  // Upstream, without the colour diffusion.
  pushParticlesApart(numIters) {
    const P = this.particlePos, pis = this.pInvSpacing, pnx = this.pNumX, pny = this.pNumY;
    this.numCellParticles.fill(0);
    for (let i = 0; i < this.numParticles; i++) {
      const xi = clamp(Math.floor(P[2 * i] * pis), 0, pnx - 1), yi = clamp(Math.floor(P[2 * i + 1] * pis), 0, pny - 1);
      this.numCellParticles[xi * pny + yi]++;
    }
    let first = 0;
    for (let i = 0; i < this.pNumCells; i++) { first += this.numCellParticles[i]; this.firstCellParticle[i] = first; }
    this.firstCellParticle[this.pNumCells] = first;
    for (let i = 0; i < this.numParticles; i++) {
      const xi = clamp(Math.floor(P[2 * i] * pis), 0, pnx - 1), yi = clamp(Math.floor(P[2 * i + 1] * pis), 0, pny - 1);
      const c = xi * pny + yi;
      this.firstCellParticle[c]--;
      this.cellParticleIds[this.firstCellParticle[c]] = i;
    }
    const minDist = 2 * this.particleRadius, minDist2 = minDist * minDist;
    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 0; i < this.numParticles; i++) {
        const px = P[2 * i], py = P[2 * i + 1];
        const pxi = Math.floor(px * pis), pyi = Math.floor(py * pis);
        const x0 = Math.max(pxi - 1, 0), y0 = Math.max(pyi - 1, 0);
        const x1 = Math.min(pxi + 1, pnx - 1), y1 = Math.min(pyi + 1, pny - 1);
        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const c = xi * pny + yi, last = this.firstCellParticle[c + 1];
            for (let j = this.firstCellParticle[c]; j < last; j++) {
              const id = this.cellParticleIds[j];
              if (id === i) continue;
              let dx = P[2 * id] - P[2 * i], dy = P[2 * id + 1] - P[2 * i + 1];
              const d2 = dx * dx + dy * dy;
              if (d2 > minDist2 || d2 === 0) continue;
              const d = Math.sqrt(d2), s = 0.5 * (minDist - d) / d;
              dx *= s; dy *= s;
              P[2 * i] -= dx; P[2 * i + 1] -= dy;
              P[2 * id] += dx; P[2 * id + 1] += dy;
            }
          }
        }
      }
    }
  }

  handleParticleCollisions() {
    const P = this.particlePos, V = this.particleVel, h = this.h, r = this.particleRadius;
    const minX = h + r, maxX = (this.fNumX - 1) * h - r, minY = h + r, maxY = (this.fNumY - 1) * h - r;
    const hasStatic = this.statics.length > 0, sol = this.solids, ns = sol.length;
    const mp = this.density * 2 * Math.sqrt(3) * r * r;   // mass of one particle (per metre depth)
    for (let i = 0; i < this.numParticles; i++) {
      let x = P[2 * i], y = P[2 * i + 1], vx = V[2 * i], vy = V[2 * i + 1];
      if (x !== x || y !== y) { x = minX; y = minY; vx = 0; vy = 0; }
      // static obstacles: grid test, then the exact distance
      if (hasStatic && this.sdfGrid(x, y) < r + h) {
        let best = 1e9, bk = -1;
        for (let k = 0; k < this.statics.length; k++) { const d = sdfWorld(this.statics[k], x, y); if (d < best) { best = d; bk = k; } }
        if (best < r) {
          normalWorld(this.statics[bk], x, y, N2);
          x += (r - best) * N2[0]; y += (r - best) * N2[1];
          const vn = vx * N2[0] + vy * N2[1];
          if (vn < 0) { vx -= vn * N2[0]; vy -= vn * N2[1]; }
        }
      }
      // moving solids
      for (let k = 0; k < ns; k++) {
        const s = sol[k];
        if (!s.active) continue;
        const ex = x - s.x, ey = y - s.y, B = s.shape.bound + r;
        if (ex * ex + ey * ey > B * B) continue;
        const d = sdfWorld(s, x, y);
        if (d >= r) continue;
        normalWorld(s, x, y, N2);
        x += (r - d) * N2[0]; y += (r - d) * N2[1];
        s.velAt(x, y, V2);
        const rvx = vx - V2[0], rvy = vy - V2[1], vn = rvx * N2[0] + rvy * N2[1];
        if (vn < 0) {
          vx -= vn * N2[0]; vy -= vn * N2[1];
          if (!s.kinematic && this.onSolidHit) this.onSolidHit(s, x, y, vn * mp * N2[0], vn * mp * N2[1], -vn);
        }
      }
      if (x < minX) { x = minX; vx = 0; }
      if (x > maxX) { x = maxX; vx = 0; }
      if (y < minY) { y = minY; vy = 0; }
      if (y > maxY) { y = maxY; vy = 0; }
      P[2 * i] = x; P[2 * i + 1] = y; V[2 * i] = vx; V[2 * i + 1] = vy;
    }
  }

  rasterSolids() {
    this.s.set(this.sStatic);
    this.solidId.fill(-1);
    const n = this.fNumY, h = this.h;
    for (let k = 0; k < this.solids.length; k++) {
      const s = this.solids[k];
      if (!s.active) continue;
      const B = s.shape.bound;
      const i0 = clamp(Math.floor((s.x - B) / h), 1, this.fNumX - 2), i1 = clamp(Math.ceil((s.x + B) / h), 1, this.fNumX - 2);
      const j0 = clamp(Math.floor((s.y - B) / h), 1, this.fNumY - 2), j1 = clamp(Math.ceil((s.y + B) / h), 1, this.fNumY - 2);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++)
          if (sdfWorld(s, (i + 0.5) * h, (j + 0.5) * h) < 0) { this.s[i * n + j] = 0; this.solidId[i * n + j] = k; }
    }
  }

  updateParticleDensity() {
    const n = this.fNumY, h = this.h, h1 = this.fInvSpacing, h2 = 0.5 * h;
    const d = this.particleDensity, P = this.particlePos;
    d.fill(0);
    for (let i = 0; i < this.numParticles; i++) {
      const x = clamp(P[2 * i], h, (this.fNumX - 1) * h), y = clamp(P[2 * i + 1], h, (this.fNumY - 1) * h);
      const x0 = Math.floor((x - h2) * h1), tx = ((x - h2) - x0 * h) * h1, x1 = Math.min(x0 + 1, this.fNumX - 2);
      const y0 = Math.floor((y - h2) * h1), ty = ((y - h2) - y0 * h) * h1, y1 = Math.min(y0 + 1, this.fNumY - 2);
      const sx = 1 - tx, sy = 1 - ty;
      d[x0 * n + y0] += sx * sy; d[x1 * n + y0] += tx * sy;
      d[x1 * n + y1] += tx * ty; d[x0 * n + y1] += sx * ty;
    }
    if (this.particleRestDensity === 0) {
      let sum = 0, c = 0;
      for (let i = 0; i < this.fNumCells; i++) if (this.cellType[i] === FLUID_CELL) { sum += d[i]; c++; }
      if (c > 0) this.particleRestDensity = sum / c;
    }
  }

  transferVelocities(toGrid, flipRatio) {
    const n = this.fNumY, h = this.h, h1 = this.fInvSpacing, h2 = 0.5 * h;
    const P = this.particlePos, V = this.particleVel, CT = this.cellType;
    if (toGrid) {
      this.prevU.set(this.u); this.prevV.set(this.v);
      this.du.fill(0); this.dv.fill(0); this.u.fill(0); this.v.fill(0);
      for (let i = 0; i < this.fNumCells; i++) CT[i] = this.s[i] === 0 ? SOLID_CELL : AIR_CELL;
      for (let i = 0; i < this.numParticles; i++) {
        const xi = clamp(Math.floor(P[2 * i] * h1), 0, this.fNumX - 1), yi = clamp(Math.floor(P[2 * i + 1] * h1), 0, this.fNumY - 1);
        const c = xi * n + yi;
        if (CT[c] === AIR_CELL) CT[c] = FLUID_CELL;
      }
    }
    for (let component = 0; component < 2; component++) {
      const dx = component === 0 ? 0 : h2, dy = component === 0 ? h2 : 0;
      const f = component === 0 ? this.u : this.v;
      const prevF = component === 0 ? this.prevU : this.prevV;
      const d = component === 0 ? this.du : this.dv;
      const offset = component === 0 ? n : 1;
      for (let i = 0; i < this.numParticles; i++) {
        const x = clamp(P[2 * i], h, (this.fNumX - 1) * h), y = clamp(P[2 * i + 1], h, (this.fNumY - 1) * h);
        const x0 = Math.min(Math.floor((x - dx) * h1), this.fNumX - 2), tx = ((x - dx) - x0 * h) * h1, x1 = Math.min(x0 + 1, this.fNumX - 2);
        const y0 = Math.min(Math.floor((y - dy) * h1), this.fNumY - 2), ty = ((y - dy) - y0 * h) * h1, y1 = Math.min(y0 + 1, this.fNumY - 2);
        const sx = 1 - tx, sy = 1 - ty;
        const d0 = sx * sy, d1 = tx * sy, d2 = tx * ty, d3 = sx * ty;
        const nr0 = x0 * n + y0, nr1 = x1 * n + y0, nr2 = x1 * n + y1, nr3 = x0 * n + y1;
        if (toGrid) {
          const pv = V[2 * i + component];
          f[nr0] += pv * d0; d[nr0] += d0;
          f[nr1] += pv * d1; d[nr1] += d1;
          f[nr2] += pv * d2; d[nr2] += d2;
          f[nr3] += pv * d3; d[nr3] += d3;
        } else {
          const valid0 = CT[nr0] !== AIR_CELL || CT[nr0 - offset] !== AIR_CELL ? 1 : 0;
          const valid1 = CT[nr1] !== AIR_CELL || CT[nr1 - offset] !== AIR_CELL ? 1 : 0;
          const valid2 = CT[nr2] !== AIR_CELL || CT[nr2 - offset] !== AIR_CELL ? 1 : 0;
          const valid3 = CT[nr3] !== AIR_CELL || CT[nr3 - offset] !== AIR_CELL ? 1 : 0;
          const v = V[2 * i + component];
          const w = valid0 * d0 + valid1 * d1 + valid2 * d2 + valid3 * d3;
          if (w > 0) {
            const picV = (valid0 * d0 * f[nr0] + valid1 * d1 * f[nr1] + valid2 * d2 * f[nr2] + valid3 * d3 * f[nr3]) / w;
            const corr = (valid0 * d0 * (f[nr0] - prevF[nr0]) + valid1 * d1 * (f[nr1] - prevF[nr1])
              + valid2 * d2 * (f[nr2] - prevF[nr2]) + valid3 * d3 * (f[nr3] - prevF[nr3])) / w;
            const flipV = v + corr;
            V[2 * i + component] = (1 - flipRatio) * picV + flipRatio * flipV;
          }
        }
      }
      if (toGrid) {
        for (let i = 0; i < f.length; i++) if (d[i] > 0) f[i] /= d[i];
      }
    }
  }

  // Boundary condition on the faces of solid cells: a static solid face has
  // zero velocity; a face of a moving solid has the solid's rigid velocity
  // at the face centre (free-slip moving wall, Bridson 2015, ch. 5).
  solidFaces() {
    const n = this.fNumY, h = this.h, S = this.s, ID = this.solidId, sol = this.solids;
    for (let i = 1; i < this.fNumX; i++) {
      for (let j = 1; j < this.fNumY; j++) {
        const c = i * n + j;
        if (S[c] === 0 || S[c - n] === 0) {
          const id = ID[c] >= 0 ? ID[c] : ID[c - n];
          this.u[c] = id >= 0 ? sol[id].velAt(i * h, (j + 0.5) * h, V2)[0] : 0;
        }
        if (S[c] === 0 || S[c - 1] === 0) {
          const id = ID[c] >= 0 ? ID[c] : ID[c - 1];
          this.v[c] = id >= 0 ? sol[id].velAt((i + 0.5) * h, j * h, V2)[1] : 0;
        }
      }
    }
  }

  // Our viscosity: blend each fluid face toward the mean of its four
  // neighbours (one explicit diffusion pass, weight nu in 0..0.3).
  smoothVelocities() {
    const n = this.fNumY, CT = this.cellType, nu = this.viscosity;
    for (let comp = 0; comp < 2; comp++) {
      const f = comp === 0 ? this.u : this.v, t = comp === 0 ? this.du : this.dv;
      const off = comp === 0 ? n : 1;
      t.set(f);
      for (let i = 2; i < this.fNumX - 2; i++) {
        for (let j = 2; j < this.fNumY - 2; j++) {
          const c = i * n + j;
          if (CT[c] !== FLUID_CELL || CT[c - off] !== FLUID_CELL) continue;
          f[c] = (1 - nu) * t[c] + nu * 0.25 * (t[c - n] + t[c + n] + t[c - 1] + t[c + 1]);
        }
      }
    }
  }

  solveIncompressibility(numIters, dt, overRelaxation, compensateDrift = true) {
    this.p.fill(0);
    this.prevU.set(this.u); this.prevV.set(this.v);
    const n = this.fNumY, cp = this.density * this.h / dt, k = this.stiffness;
    const U = this.u, Vv = this.v, S = this.s, CT = this.cellType, D = this.particleDensity, rest = this.particleRestDensity;
    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 1; i < this.fNumX - 1; i++) {
        for (let j = 1; j < this.fNumY - 1; j++) {
          const center = i * n + j;
          if (CT[center] !== FLUID_CELL) continue;
          const left = center - n, right = center + n, bottom = center - 1, top = center + 1;
          const sx0 = S[left], sx1 = S[right], sy0 = S[bottom], sy1 = S[top];
          const s = sx0 + sx1 + sy0 + sy1;
          if (s === 0) continue;
          let div = U[right] - U[center] + Vv[top] - Vv[center];
          if (rest > 0 && compensateDrift) {
            const compression = D[center] - rest;
            if (compression > 0) div -= k * compression;
          }
          let p = -div / s;
          p *= overRelaxation;
          this.p[center] += cp * p;
          U[center] -= sx0 * p; U[right] += sx1 * p;
          Vv[center] -= sy0 * p; Vv[top] += sy1 * p;
        }
      }
    }
  }

  // ---- queries -----------------------------------------------------------------
  stats() {
    const P = this.particlePos, h = this.h, r = this.particleRadius;
    let nan = 0, out = 0;
    const x0 = h - 1e-4, x1 = (this.fNumX - 1) * h + 1e-4, y1 = (this.fNumY - 1) * h + 1e-4;
    for (let i = 0; i < this.numParticles; i++) {
      const x = P[2 * i], y = P[2 * i + 1];
      if (!(x === x && y === y && Number.isFinite(this.particleVel[2 * i]) && Number.isFinite(this.particleVel[2 * i + 1]))) nan++;
      else if (x < x0 || x > x1 || y < x0 || y > y1) out++;
    }
    let fluid = 0, filled = 0;
    const rest = this.particleRestDensity || 1;
    for (let c = 0; c < this.fNumCells; c++) if (this.cellType[c] === FLUID_CELL) { fluid++; filled += Math.min(1, this.particleDensity[c] / rest); }
    return {
      n: this.numParticles, initial: this.initialParticles, emitted: this.emitted, drained: this.drained,
      nan, out, fluidCells: fluid, area: filled * h * h, particleArea: this.numParticles * 2 * Math.sqrt(3) * r * r,
      maxSpeed: this.maxSpeed, substeps: this.lastSubsteps,
    };
  }
}
