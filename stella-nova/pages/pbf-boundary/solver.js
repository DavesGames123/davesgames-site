/*
Copyright 2021 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// ============================================================================
//  PBF BOUNDARIES SOLVER  ·  pages/pbf-boundary/solver.js
// ----------------------------------------------------------------------------
//  A 2D position based fluid (Macklin and Müller 2013) with boundary
//  particles (Akinci et al. 2012), two-way coupled rigid bodies, and the
//  granular contact model of the upstream page. The upstream page is the
//  Ten Minute Physics contribution PBFBoundary.html by Sergii Biloshytskyi
//  (MIT, notice above): position based particles in a round container with
//  turning disks, static and kinetic friction (Unified Particle Physics
//  6.1), and restitution through a velocity pass (Detailed Rigid Body
//  Simulation with Extended PBD, Eq. 30 and 34). The "granular" material
//  and the "mixer" container keep that model and that scene.
//
//  No DOM. main.js draws (render.js) and wires the GUI; tests.mjs runs it.
//
//  UNITS. Lengths in m, time in s. Particle spacing d (0.02 m), kernel
//  radius h = 2.4 d. Every fluid particle has mass 1; rest density rho0 is
//  the kernel sum on the square lattice of spacing d, so a lattice block is
//  at rest at t = 0. A body of relative density s and area A has mass
//  s A / d^2 (the water it displaces weighs A / d^2).
//
//  STEP (one substep, run S times a frame):
//    walls     move the kinematic walls (shake, mixer disks, paddle)
//    bodies    integrate bodies (gravity, pointer spring)
//    predict   v += g h, x* = x + v h
//    grid      counting sort into cells of size h; neighbour lists of
//              fluid particles and of boundary particles (walls, bodies)
//    iterate   K times: density + lambda (or granular contacts), position
//              deltas with s_corr, apply; body reactions; SDF clamps
//    velocity  v = (x* - x) / h; velocity pass (granular), XSPH,
//              vorticity confinement, clamp
//    bodies    v, omega from the body position change; body-wall and
//              body-body contacts
//
//  grep -n targets
//    kernels .............. "function W("
//    container sdf ........ "function wallSDF"
//    boundary sampling .... "function sampleBoundary"
//    body shapes .......... "export function makeBody"
//    body sdf ............. "function bodySDF"
//    neighbours ........... "function buildGrid"
//    density solve ........ "function solveDensity"
//    granular solve ....... "function solveGranular"
//    collisions ........... "function collide"
//    viscosity, vorticity . "function xsphVorticity"
//    one substep .......... "function substep"
//    frame ................ "step(dt)"
//    scene build .......... "export function buildScene"
// ============================================================================

export const D = 0.02;              // particle spacing (m)
export const H = 2.4 * D;           // kernel radius
const H2 = H * H;
const POLY6 = 4 / (Math.PI * Math.pow(H, 8));
const SPIKY = -30 / (Math.PI * Math.pow(H, 5));
const MAXNB = 40, MAXNBB = 40;
export const MAXP = 6000;

function W(r2) { if (r2 >= H2) return 0; const q = H2 - r2; return POLY6 * q * q * q; }

// Rest density: kernel sum on the square lattice of spacing D.
export const RHO0 = (() => { let s = 0; for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) s += W((i * i + j * j) * D * D); return s; })();
// Lambda denominator of a full lattice particle: sets the relaxation scale.
export const DEN0 = (() => {
  let gx = 0, gy = 0, s = 0;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const x = i * D, y = j * D, r = Math.hypot(x, y); if (r === 0 || r >= H) continue;
    const g = SPIKY * (H - r) * (H - r) / r / RHO0; gx += g * x; gy += g * y; s += g * g * r * r;
  }
  return s + gx * gx + gy * gy;
})();

// ---- shapes: signed distance in a local frame -------------------------------
// prim = { t: 'c', x, y, r } circle · { t: 'b', x, y, hw, hh, a, r } box
// (rotated by a, rounded by r) · { t: 's', x0, y0, x1, y1, r } capsule ·
// { t: 'p', v: [x0, y0, x1, y1, ...] } convex polygon (CCW).
function primSDF(p, x, y) {
  switch (p.t) {
    case 'c': return Math.hypot(x - p.x, y - p.y) - p.r;
    case 'b': {
      let dx = x - p.x, dy = y - p.y;
      if (p.a) { const c = Math.cos(p.a), s = Math.sin(p.a); const u = c * dx + s * dy, v = -s * dx + c * dy; dx = u; dy = v; }
      const r = p.r || 0, qx = Math.abs(dx) - p.hw + r, qy = Math.abs(dy) - p.hh + r;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    }
    case 's': {
      const ax = x - p.x0, ay = y - p.y0, bx = p.x1 - p.x0, by = p.y1 - p.y0;
      const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by)));
      return Math.hypot(ax - bx * t, ay - by * t) - p.r;
    }
    case 'p': {
      // Exact inside; outside it is the max edge distance (a lower bound,
      // fine for contacts within a particle radius).
      const v = p.v, n = v.length / 2; let m = -Infinity;
      for (let i = 0; i < n; i++) {
        const x0 = v[2 * i], y0 = v[2 * i + 1], x1 = v[(2 * i + 2) % v.length], y1 = v[(2 * i + 3) % v.length];
        const ex = x1 - x0, ey = y1 - y0, L = Math.hypot(ex, ey) || 1;
        const d = ((x - x0) * ey - (y - y0) * ex) / L;   // > 0 outside for CCW
        if (d > m) m = d;
      }
      return m;
    }
  }
  return 1;
}
function shapeSDF(prims, x, y) { let m = Infinity; for (let i = 0; i < prims.length; i++) { const d = primSDF(prims[i], x, y); if (d < m) m = d; } return m; }

// ---- containers ---------------------------------------------------------------
// The fluid region of a container. wallSDF > 0 in the free region, < 0 in
// the walls; magnitude is the distance (exact for the simple shapes).
export const CONTAINERS = ['tank', 'drum', 'bowl', 'beach', 'twin', 'funnel', 'mixer', 'steps'];
function boxIn(x, y, x0, y0, x1, y1) { return Math.min(x - x0, x1 - x, y - y0, y1 - y); }

function makeContainer(kind, Wd, Hd, rnd) {
  const cx = Wd / 2, cy = Hd / 2, m = 0.04;
  const c = { kind, solids: [], free: null, inner: { x0: m, y0: m, x1: Wd - m, y1: Hd - m } };
  // free(x, y): distance into the free region of the outer shape (> 0 inside)
  switch (kind) {
    case 'drum': case 'mixer': {
      const R = Math.min(Wd, Hd) * 0.46;
      c.free = (x, y) => R - Math.hypot(x - cx, y - cy);
      c.inner = { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R };
      c.R = R; c.cx = cx; c.cy = cy;
      break;
    }
    case 'bowl': {
      // the round floor must stay inside the domain: yc - R >= m
      const R = Math.min(Wd * 0.46, (Hd - 2 * m) / 2.15), yc = Hd - m - R * 0.15 - R;
      const x0 = cx - R, x1 = cx + R;
      c.free = (x, y) => (y > yc ? boxIn(x, y, x0, -1e3, x1, Hd - m) : R - Math.hypot(x - cx, y - yc));
      c.inner = { x0, y0: yc - R, x1, y1: Hd - m };
      break;
    }
    case 'funnel': {
      // A box with a V floor that ends in a slot over a basin.
      const yb = Hd * (0.4 + 0.1 * rnd()), gap = 0.05 + 0.04 * rnd(), rise = 0.22 + 0.12 * rnd();
      c.free = (x, y) => boxIn(x, y, m, m, Wd - m, Hd - m);
      c.solids.push({ t: 's', x0: m - 0.06, y0: yb + rise, x1: cx - gap - 0.02, y1: yb, r: 0.02 });
      c.solids.push({ t: 's', x0: Wd - m + 0.06, y0: yb + rise, x1: cx + gap + 0.02, y1: yb, r: 0.02 });
      break;
    }
    default: {
      c.free = (x, y) => boxIn(x, y, m, m, Wd - m, Hd - m);
      if (kind === 'beach') {
        const s = 0.25 + 0.25 * rnd();
        c.solids.push({ t: 'p', v: [Wd * 0.45, m - 0.1, Wd + 0.2, m - 0.1, Wd + 0.2, m + (Wd * 0.55 + 0.2) * s] });
      } else if (kind === 'twin') {
        const hh = Hd * (0.32 + 0.22 * rnd());
        c.solids.push({ t: 'b', x: cx, y: m + hh / 2 - 0.05, hw: 0.025, hh: hh / 2 + 0.05, a: 0, r: 0.01 });
        c.gate = { x: cx, y: m + hh };
      } else if (kind === 'steps') {
        const n = 3 + Math.floor(rnd() * 2), sw = Wd * 0.5 / n, sh = Hd * 0.09;
        for (let i = 0; i < n; i++) c.solids.push({ t: 'b', x: m + sw * (i + 0.5), y: m + sh * (n - i) / 2 - 0.02, hw: sw / 2 + 0.002, hh: sh * (n - i) / 2 + 0.02, a: 0, r: 0 });
      }
    }
  }
  return c;
}

// ---- bodies -----------------------------------------------------------------
export const BODY_KINDS = ['box', 'disc', 'boat', 'duck', 'log', 'rock', 'ball', 'plank'];
// Default relative density (water = 1) per kind.
export const BODY_DENSITY = { box: 0.45, disc: 0.6, boat: 0.3, duck: 0.35, log: 0.65, rock: 2.6, ball: 1.8, plank: 0.55 };

// makeBody(kind, x, y, size, rnd) -> body. size scales the default extent.
export function makeBody(kind, x, y, size = 1, rnd = Math.random, density) {
  const s = size;
  let prims;
  switch (kind) {
    case 'disc': prims = [{ t: 'c', x: 0, y: 0, r: 0.07 * s }]; break;
    case 'ball': prims = [{ t: 'c', x: 0, y: 0, r: 0.05 * s }]; break;
    case 'log': prims = [{ t: 's', x0: -0.14 * s, y0: 0, x1: 0.14 * s, y1: 0, r: 0.04 * s }]; break;
    case 'plank': prims = [{ t: 'b', x: 0, y: 0, hw: 0.17 * s, hh: 0.022 * s, a: 0, r: 0.006 * s }]; break;
    case 'boat': prims = [{ t: 'p', v: [-0.17 * s, 0.035 * s, -0.1 * s, -0.045 * s, 0.1 * s, -0.045 * s, 0.17 * s, 0.035 * s] }, { t: 'b', x: -0.02 * s, y: 0.055 * s, hw: 0.045 * s, hh: 0.025 * s, a: 0, r: 0.006 * s }]; break;
    case 'duck': prims = [{ t: 'b', x: 0, y: 0, hw: 0.085 * s, hh: 0.045 * s, a: 0, r: 0.04 * s }, { t: 'c', x: 0.055 * s, y: 0.065 * s, r: 0.035 * s }, { t: 'b', x: 0.1 * s, y: 0.06 * s, hw: 0.022 * s, hh: 0.009 * s, a: -0.1, r: 0.006 * s }]; break;
    case 'rock': {
      const n = 7, v = [], R = 0.065 * s;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd() * 0.5; const r = R * (0.75 + 0.35 * rnd()); v.push(r * Math.cos(a), r * Math.sin(a)); }
      prims = [{ t: 'p', v: convexHull(v) }];
      break;
    }
    default: prims = [{ t: 'b', x: 0, y: 0, hw: 0.075 * s, hh: 0.075 * s, a: 0, r: 0.008 * s }];
  }
  const b = { kind, prims, x, y, a: 0, vx: 0, vy: 0, w: 0, px: x, py: y, pa: 0, s: density != null ? density : BODY_DENSITY[kind] || 0.5, hue: rnd(), grab: null, id: 0 };
  // Interior lattice: area, centroid, inertia, boundary samples.
  let R = 0; for (const p of prims) R = Math.max(R, primReach(p));
  const step = D * 0.5; let A = 0, mx = 0, my = 0;
  const pts = [];
  for (let yy = -R; yy <= R; yy += step) for (let xx = -R; xx <= R; xx += step) {
    const d = shapeSDF(prims, xx, yy);
    if (d < 0) { A += step * step; mx += xx * step * step; my += yy * step * step; pts.push(xx, yy, d); }
  }
  mx /= A; my /= A;
  // Re-centre the shape on its centroid.
  for (const p of prims) shiftPrim(p, -mx, -my);
  let I = 0; for (let i = 0; i < pts.length; i += 3) { const dx = pts[i] - mx, dy = pts[i + 1] - my; I += (dx * dx + dy * dy) * step * step; }
  b.area = A; b.m = b.s * A / (D * D); b.I = b.s * I / (D * D); b.R = R + Math.hypot(mx, my);
  b.invM = 1 / b.m; b.invI = 1 / b.I;
  // Boundary particles: a lattice of spacing 0.8 D in the band -1.2 D < sdf < 0.
  const bp = [];
  const bs = D * 0.8;
  for (let yy = -b.R; yy <= b.R; yy += bs) for (let xx = -b.R; xx <= b.R; xx += bs) { const d = shapeSDF(prims, xx, yy); if (d < 0 && d > -1.2 * D) bp.push(xx, yy); }
  b.bl = new Float64Array(bp);
  // Rim samples for body-wall and body-body contacts (on the surface).
  const rim = [];
  for (let k = 0; k < bp.length; k += 2) { const d = shapeSDF(prims, bp[k], bp[k + 1]); if (d > -0.45 * bs) rim.push(bp[k], bp[k + 1]); }
  b.rim = new Float64Array(rim);
  b.bpsi = null; // set by the sim (needs the lattice kernel sum)
  return b;
}
function primReach(p) {
  switch (p.t) {
    case 'c': return Math.hypot(p.x, p.y) + p.r;
    case 'b': return Math.hypot(p.x, p.y) + Math.hypot(p.hw, p.hh);
    case 's': return Math.max(Math.hypot(p.x0, p.y0), Math.hypot(p.x1, p.y1)) + p.r;
    case 'p': { let m = 0; for (let i = 0; i < p.v.length; i += 2) m = Math.max(m, Math.hypot(p.v[i], p.v[i + 1])); return m; }
  }
  return 0.1;
}
function shiftPrim(p, dx, dy) {
  if (p.t === 'c' || p.t === 'b') { p.x += dx; p.y += dy; }
  else if (p.t === 's') { p.x0 += dx; p.y0 += dy; p.x1 += dx; p.y1 += dy; }
  else if (p.t === 'p') for (let i = 0; i < p.v.length; i += 2) { p.v[i] += dx; p.v[i + 1] += dy; }
}
function convexHull(v) {
  const P = []; for (let i = 0; i < v.length; i += 2) P.push([v[i], v[i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const out = lo.slice(0, -1).concat(hi.slice(0, -1));
  return out.flat();
}
// Body SDF at a world point.
function bodySDF(b, x, y) {
  const c = Math.cos(b.a), s = Math.sin(b.a), dx = x - b.x, dy = y - b.y;
  return shapeSDF(b.prims, c * dx + s * dy, -s * dx + c * dy);
}
export { bodySDF, shapeSDF };

// ---- the simulation ---------------------------------------------------------
export function createSim(o = {}) {
  const Wd = o.width || 2.0, Hd = o.height || 1.25;
  const cap = Math.min(MAXP, o.cap || MAXP);
  const S = {
    Wd, Hd, n: 0, cap, t: 0, frame: 0,
    x: new Float64Array(cap), y: new Float64Array(cap), px: new Float64Array(cap), py: new Float64Array(cap),
    vx: new Float64Array(cap), vy: new Float64Array(cap), rho: new Float64Array(cap), lam: new Float64Array(cap),
    dx: new Float64Array(cap), dy: new Float64Array(cap), ax: new Float64Array(cap), ay: new Float64Array(cap), om: new Float64Array(cap),
    foam: new Float32Array(cap),
    // parameters (main.js sets them from the panel)
    P: {
      gx: 0, gy: -9.81, substeps: 3, iters: 3, material: 'water', visc: 0.08, vort: 0.4, tension: 0.12, relax: 0.05,
      mu_s: 0.2, mu_k: 0.2, e: 0.2, velPass: true, wallMu: 0.05, bspace: 0.8, shakeA: 0, shakeF: 1.2, spin: 0, mixer: 120,
      coupling: 1, maxV: 6,
    },
    container: null, bodies: [], emitters: [], obstacles: [],
    nb: new Int32Array(cap * MAXNB), nbc: new Int32Array(cap), nbb: new Int32Array(cap * MAXNBB), nbbc: new Int32Array(cap),
    // boundary particles: base (local) position, world position, psi, owner
    // owner -1 static wall, -2 - k kinematic obstacle k, k >= 0 body k
    bn: 0, blx: null, bly: null, bx: null, by: null, bpsi: null, bown: null,
    pointer: { on: false, x: 0, y: 0, vx: 0, vy: 0, body: -1, ox: 0, oy: 0, r: 0.12 },
    shake: 0, angle: 0, stats: { maxRho: 0, avgRho: 0, nb: 0 },
  };
  // Grid over the domain with a margin.
  const GM = 0.3;
  S.gx0 = -GM; S.gy0 = -GM; S.gw = Math.ceil((Wd + 2 * GM) / H); S.gh = Math.ceil((Hd + 2 * GM) / H);
  const NC = S.gw * S.gh;
  S.cellStart = new Int32Array(NC + 1); S.cellIdx = new Int32Array(cap); S.pcell = new Int32Array(cap);
  S.bcellStart = new Int32Array(NC + 1); S.bcellIdx = new Int32Array(1); S.bpcell = new Int32Array(1);
  S.occ = new Float32Array(NC);
  S.step = dt => step(S, dt);
  return S;
}

function cellOf(S, x, y) {
  let i = Math.floor((x - S.gx0) / H), j = Math.floor((y - S.gy0) / H);
  if (i < 0) i = 0; else if (i >= S.gw) i = S.gw - 1;
  if (j < 0) j = 0; else if (j >= S.gh) j = S.gh - 1;
  return j * S.gw + i;
}

// World SDF of everything solid that particles meet: container, static
// solids, kinematic obstacles. > 0 in the free region.
function wallSDF(S, x, y) {
  const c = S.container; const sx = x - S.shake;
  let d = c.free(sx, y);
  for (let i = 0; i < c.solids.length; i++) { const s = primSDF(c.solids[i], sx, y); if (s < d) d = s; }
  for (let k = 0; k < S.obstacles.length; k++) { const ob = S.obstacles[k]; const s = primSDF(ob.p, sx, y); if (s < d) d = s; }
  return d;
}
export { wallSDF };
function wallGrad(S, x, y, out) {
  const e = 1e-4;
  const gx = wallSDF(S, x + e, y) - wallSDF(S, x - e, y), gy = wallSDF(S, x, y + e) - wallSDF(S, x, y - e);
  const L = Math.hypot(gx, gy) || 1; out[0] = gx / L; out[1] = gy / L;
}
function bodyGrad(b, x, y, out) {
  const e = 1e-4;
  const gx = bodySDF(b, x + e, y) - bodySDF(b, x - e, y), gy = bodySDF(b, x, y + e) - bodySDF(b, x, y - e);
  const L = Math.hypot(gx, gy) || 1; out[0] = gx / L; out[1] = gy / L;
}

// Boundary particles of the walls: a lattice of spacing bspace * D in the
// band -1.2 D < sdf < 0. psi_b = rho0 / sum_k W(b, k) over the same set
// (Akinci 2012): a fluid particle at a flat wall then sees rest density.
function sampleBoundary(S) {
  const sp = Math.max(0.5, Math.min(1.2, S.P.bspace)) * D;
  const L = [];
  const own = [];
  const c = S.container, saveShake = S.shake; S.shake = 0;
  const x0 = -0.25, y0 = -0.25, x1 = S.Wd + 0.25, y1 = S.Hd + 0.25;
  // static walls: the container and its solids (no obstacles)
  const stat = (x, y) => { let d = c.free(x, y); for (const s of c.solids) d = Math.min(d, primSDF(s, x, y)); return d; };
  for (let y = y0; y <= y1; y += sp) for (let x = x0; x <= x1; x += sp) { const d = stat(x, y); if (d < 0 && d > -1.25 * D) { L.push(x, y); own.push(-1); } }
  S.obstacles.forEach((ob, k) => {
    const R = ob.R;
    for (let y = -R; y <= R; y += sp) for (let x = -R; x <= R; x += sp) { const d = primSDF(ob.local, x, y); if (d < 0 && d > -1.25 * D) { L.push(x, y); own.push(-2 - k); } }
  });
  S.shake = saveShake;
  S.nStatic = own.length;
  let n = own.length;
  for (let k = 0; k < S.bodies.length; k++) n += S.bodies[k].bl.length / 2;
  S.bn = n;
  S.blx = new Float64Array(n); S.bly = new Float64Array(n); S.bx = new Float64Array(n); S.by = new Float64Array(n);
  S.bpsi = new Float64Array(n); S.bown = new Int32Array(n);
  for (let i = 0; i < own.length; i++) { S.blx[i] = L[2 * i]; S.bly[i] = L[2 * i + 1]; S.bown[i] = own[i]; }
  let m = own.length;
  for (let k = 0; k < S.bodies.length; k++) { const b = S.bodies[k]; for (let i = 0; i < b.bl.length; i += 2) { S.blx[m] = b.bl[i]; S.bly[m] = b.bl[i + 1]; S.bown[m] = k; m++; } }
  S.bcellIdx = new Int32Array(n); S.bpcell = new Int32Array(n);
  placeBoundary(S);
  buildBoundaryGrid(S);
  // psi from the neighbours in the same set (owner group)
  for (let i = 0; i < n; i++) {
    let s = 0; const xi = S.bx[i], yi = S.by[i], oi = S.bown[i];
    const c0 = cellOf(S, xi, yi), ci = c0 % S.gw, cj = (c0 / S.gw) | 0;
    for (let jj = cj - 1; jj <= cj + 1; jj++) for (let ii = ci - 1; ii <= ci + 1; ii++) {
      if (ii < 0 || jj < 0 || ii >= S.gw || jj >= S.gh) continue;
      const cc = jj * S.gw + ii;
      for (let q = S.bcellStart[cc]; q < S.bcellStart[cc + 1]; q++) { const k = S.bcellIdx[q]; if (S.bown[k] !== oi) continue; const dx = S.bx[k] - xi, dy = S.by[k] - yi; s += W(dx * dx + dy * dy); }
    }
    S.bpsi[i] = s > 0 ? RHO0 / s : 0;
  }
}

// World positions of the boundary particles.
function placeBoundary(S) {
  const n = S.bn, sh = S.shake;
  for (let i = 0; i < n; i++) {
    const o = S.bown[i];
    if (o === -1) { S.bx[i] = S.blx[i] + sh; S.by[i] = S.bly[i]; }
    else if (o <= -2) { const ob = S.obstacles[-2 - o]; const c = Math.cos(ob.a), s = Math.sin(ob.a); S.bx[i] = ob.x + c * S.blx[i] - s * S.bly[i] + sh; S.by[i] = ob.y + s * S.blx[i] + c * S.bly[i]; }
    else { const b = S.bodies[o]; const c = Math.cos(b.a), s = Math.sin(b.a); S.bx[i] = b.x + c * S.blx[i] - s * S.bly[i]; S.by[i] = b.y + s * S.blx[i] + c * S.bly[i]; }
  }
}
function buildBoundaryGrid(S) {
  const NC = S.gw * S.gh, cs = S.bcellStart; cs.fill(0);
  for (let i = 0; i < S.bn; i++) { const c = cellOf(S, S.bx[i], S.by[i]); S.bpcell[i] = c; cs[c + 1]++; }
  for (let c = 0; c < NC; c++) cs[c + 1] += cs[c];
  const fillp = S._bfill && S._bfill.length >= NC ? S._bfill : (S._bfill = new Int32Array(NC));
  for (let c = 0; c < NC; c++) fillp[c] = cs[c];
  for (let i = 0; i < S.bn; i++) S.bcellIdx[fillp[S.bpcell[i]]++] = i;
}

function buildGrid(S) {
  const n = S.n, NC = S.gw * S.gh, cs = S.cellStart; cs.fill(0);
  for (let i = 0; i < n; i++) { const c = cellOf(S, S.x[i], S.y[i]); S.pcell[i] = c; cs[c + 1]++; }
  for (let c = 0; c < NC; c++) { S.occ[c] = cs[c + 1] * (D * D) / (H * H); cs[c + 1] += cs[c]; }
  const fillp = S._fill && S._fill.length >= NC ? S._fill : (S._fill = new Int32Array(NC));
  for (let c = 0; c < NC; c++) fillp[c] = cs[c];
  for (let i = 0; i < n; i++) S.cellIdx[fillp[S.pcell[i]]++] = i;
  // neighbour lists
  const gw = S.gw, gh = S.gh;
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const xi = S.x[i], yi = S.y[i], c0 = S.pcell[i], ci = c0 % gw, cj = (c0 / gw) | 0;
    let m = 0, mb = 0; const base = i * MAXNB, bb = i * MAXNBB;
    for (let jj = cj - 1; jj <= cj + 1; jj++) {
      if (jj < 0 || jj >= gh) continue;
      for (let ii = ci - 1; ii <= ci + 1; ii++) {
        if (ii < 0 || ii >= gw) continue;
        const cc = jj * gw + ii;
        for (let q = cs[cc], qe = cs[cc + 1]; q < qe && m < MAXNB; q++) {
          const k = S.cellIdx[q]; if (k === i) continue;
          const dx = S.x[k] - xi, dy = S.y[k] - yi;
          if (dx * dx + dy * dy < H2) S.nb[base + m++] = k;
        }
        for (let q = S.bcellStart[cc], qe = S.bcellStart[cc + 1]; q < qe && mb < MAXNBB; q++) {
          const k = S.bcellIdx[q];
          const dx = S.bx[k] - xi, dy = S.by[k] - yi;
          if (dx * dx + dy * dy < H2) S.nbb[bb + mb++] = k;
        }
      }
    }
    S.nbc[i] = m; S.nbbc[i] = mb; tot += m;
  }
  S.stats.nb = n ? tot / n : 0;
}

// ---- PBF density constraint -------------------------------------------------
const DQ = 0.2 * H, WDQ = W(DQ * DQ);
function solveDensity(S) {
  const n = S.n, P = S.P, inv = 1 / RHO0, eps = P.relax * DEN0, k = P.tension * 0.1 / DEN0;
  let mx = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const xi = S.x[i], yi = S.y[i];
    let rho = W(0), gx = 0, gy = 0, s2 = 0;
    const base = i * MAXNB;
    for (let q = 0, m = S.nbc[i]; q < m; q++) {
      const j = S.nb[base + q]; const dx = xi - S.x[j], dy = yi - S.y[j]; const r2 = dx * dx + dy * dy;
      rho += W(r2);
      const r = Math.sqrt(r2); if (r < 1e-9) continue;
      const g = SPIKY * (H - r) * (H - r) / r * inv;
      gx += g * dx; gy += g * dy; s2 += g * g * r2;
    }
    const bb = i * MAXNBB;
    for (let q = 0, m = S.nbbc[i]; q < m; q++) {
      const j = S.nbb[bb + q]; const dx = xi - S.bx[j], dy = yi - S.by[j]; const r2 = dx * dx + dy * dy; const psi = S.bpsi[j];
      rho += psi * W(r2);
      const r = Math.sqrt(r2); if (r < 1e-9) continue;
      const g = psi * SPIKY * (H - r) * (H - r) / r * inv;
      gx += g * dx; gy += g * dy;
    }
    S.rho[i] = rho; sum += rho; if (rho > mx) mx = rho;
    const C = rho * inv - 1;
    S.lam[i] = C > 0 ? -C / (s2 + gx * gx + gy * gy + eps) : 0;
  }
  S.stats.maxRho = n ? mx / RHO0 : 0; S.stats.avgRho = n ? sum / n / RHO0 : 0;
  // position deltas
  for (let i = 0; i < n; i++) {
    const xi = S.x[i], yi = S.y[i], li = S.lam[i];
    let ddx = 0, ddy = 0; const base = i * MAXNB;
    for (let q = 0, m = S.nbc[i]; q < m; q++) {
      const j = S.nb[base + q]; const dx = xi - S.x[j], dy = yi - S.y[j]; const r2 = dx * dx + dy * dy;
      const r = Math.sqrt(r2); if (r < 1e-9) continue;
      let sc = 0; if (k > 0) { const w = W(r2) / WDQ; sc = -k * w * w * w * w; }
      const g = SPIKY * (H - r) * (H - r) / r * (li + S.lam[j] + sc) * inv;
      ddx += g * dx; ddy += g * dy;
    }
    const bb = i * MAXNBB;
    for (let q = 0, m = S.nbbc[i]; q < m; q++) {
      const j = S.nbb[bb + q]; const dx = xi - S.bx[j], dy = yi - S.by[j]; const r2 = dx * dx + dy * dy;
      const r = Math.sqrt(r2); if (r < 1e-9) continue;
      const g = S.bpsi[j] * SPIKY * (H - r) * (H - r) / r * li * inv;
      const ex = g * dx, ey = g * dy;
      ddx += ex; ddy += ey;
      // reaction on a body (two-way coupling): equal and opposite momentum
      const o = S.bown[j];
      if (o >= 0 && P.coupling > 0) { const b = S.bodies[o]; b.fx -= ex * P.coupling; b.fy -= ey * P.coupling; b.ft -= ((S.bx[j] - b.x) * ey - (S.by[j] - b.y) * ex) * P.coupling; }
    }
    S.dx[i] = ddx; S.dy[i] = ddy;
  }
  const lim = 0.5 * D;
  for (let i = 0; i < n; i++) {
    let ddx = S.dx[i], ddy = S.dy[i]; const L = Math.hypot(ddx, ddy);
    if (L > lim) { ddx *= lim / L; ddy *= lim / L; }
    S.x[i] += ddx; S.y[i] += ddy;
  }
}

// ---- granular contacts (upstream model) --------------------------------------
// Pairs closer than D push apart half each. Friction from the relative
// path since the substep start: static when |dp_t| < mu_s d, else kinetic
// scaled by min(mu_k d / |dp_t|, 1). With the velocity pass, the contact
// is stored and restitution is applied to velocities after the solve.
function solveGranular(S, record) {
  const n = S.n, P = S.P, d0 = D;
  for (let i = 0; i < n; i++) {
    const base = i * MAXNB;
    for (let q = 0, m = S.nbc[i]; q < m; q++) {
      const j = S.nb[base + q]; if (j < i) continue;
      let nx = S.x[i] - S.x[j], ny = S.y[i] - S.y[j]; const r = Math.hypot(nx, ny);
      if (r >= d0 || r < 1e-9) continue;
      nx /= r; ny /= r;
      const C = d0 - r, hx = 0.5 * C * nx, hy = 0.5 * C * ny;
      S.x[i] += hx; S.y[i] += hy; S.x[j] -= hx; S.y[j] -= hy;
      const tx = (S.x[i] - S.px[i]) - (S.x[j] - S.px[j]), ty = (S.y[i] - S.py[i]) - (S.y[j] - S.py[j]);
      const pn = tx * nx + ty * ny, ttx = tx - pn * nx, tty = ty - pn * ny, tl = Math.hypot(ttx, tty);
      let fx = 0, fy = 0;
      if (tl < P.mu_s * C) { fx = ttx; fy = tty; }
      else if (!P.velPass && P.mu_k > 0) { const kk = Math.min(P.mu_k * C / tl, 1); fx = kk * ttx; fy = kk * tty; }
      S.x[i] -= 0.5 * fx; S.y[i] -= 0.5 * fy; S.x[j] += 0.5 * fx; S.y[j] += 0.5 * fy;
      if (record && S.cn < S.cmax) { const c = S.cn++; S.ci[2 * c] = i; S.ci[2 * c + 1] = j; S.cf[4 * c] = nx; S.cf[4 * c + 1] = ny; S.cf[4 * c + 2] = (S.vx[i] - S.vx[j]) * nx + (S.vy[i] - S.vy[j]) * ny; S.cf[4 * c + 3] = C; }
    }
  }
}

// ---- collisions: walls, obstacles, bodies (SDF clamps) -----------------------
const G2 = [0, 0];
function collide(S, record) {
  const n = S.n, P = S.P, r0 = 0.5 * D;
  for (let i = 0; i < n; i++) {
    let x = S.x[i], y = S.y[i];
    const d = wallSDF(S, x, y);
    if (d < r0) {
      wallGrad(S, x, y, G2); const nx = G2[0], ny = G2[1], C = r0 - d;
      x += nx * C; y += ny * C;
      // wall friction on the path since the substep start (wall moves with shake)
      const mu = P.material === 'granular' ? P.mu_s : P.wallMu;
      const tx = x - S.px[i] - S.wallVx * S.hs, ty = y - S.py[i];
      const pn = tx * nx + ty * ny, ttx = tx - pn * nx, tty = ty - pn * ny, tl = Math.hypot(ttx, tty);
      if (tl < mu * C) { x -= ttx; y -= tty; }
      else if (tl > 1e-12) { const mk = P.material === 'granular' ? (P.velPass ? 0 : P.mu_k) : P.wallMu; const kk = Math.min(mk * C / tl, 1); x -= kk * ttx; y -= kk * tty; }
      if (record && S.cn < S.cmax) { const c = S.cn++; S.ci[2 * c] = i; S.ci[2 * c + 1] = -1; S.cf[4 * c] = nx; S.cf[4 * c + 1] = ny; S.cf[4 * c + 2] = S.vx[i] * nx + S.vy[i] * ny; S.cf[4 * c + 3] = C; }
      S.x[i] = x; S.y[i] = y;
    }
  }
  // fluid vs bodies: push out, mass weighted with the body (generalised
  // inverse mass), reaction to the body.
  for (let k = 0; k < S.bodies.length; k++) {
    const b = S.bodies[k];
    const R = b.R + r0;
    const c0 = cellOf(S, b.x - R, b.y - R), c1 = cellOf(S, b.x + R, b.y + R);
    const i0 = c0 % S.gw, j0 = (c0 / S.gw) | 0, i1 = c1 % S.gw, j1 = (c1 / S.gw) | 0;
    for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
      const cc = jj * S.gw + ii;
      for (let q = S.cellStart[cc], qe = S.cellStart[cc + 1]; q < qe; q++) {
        const i = S.cellIdx[q];
        const x = S.x[i], y = S.y[i];
        const ddx = x - b.x, ddy = y - b.y; if (ddx * ddx + ddy * ddy > R * R) continue;
        const d = bodySDF(b, x, y);
        if (d >= r0) continue;
        bodyGrad(b, x, y, G2); const nx = G2[0], ny = G2[1];
        const C = r0 - d;
        const rx = x - b.x, ry = y - b.y, rn = rx * ny - ry * nx;
        const wb = (b.invM + rn * rn * b.invI) * P.coupling, wp = 1;
        const l = C / (wp + wb);
        S.x[i] += nx * l * wp; S.y[i] += ny * l * wp;
        b.cx -= nx * l * b.invM * P.coupling; b.cy -= ny * l * b.invM * P.coupling; b.ca -= rn * l * b.invI * P.coupling;
      }
    }
    // the summed push of many particles is clamped like the pressure
    // reactions (applyBodyReactions) and moves the body as a split impulse
    if (!b.grab) {
      let dx = b.cx, dy = b.cy, da = b.ca;
      const lim = 0.5 * D, dl = Math.hypot(dx, dy), al = lim / Math.max(b.R, D);
      if (dl > lim) { dx *= lim / dl; dy *= lim / dl; }
      if (da > al) da = al; else if (da < -al) da = -al;
      shiftBody(S, b, dx, dy, da);
    }
    b.cx = 0; b.cy = 0; b.ca = 0;
  }
}

// Apply the accumulated boundary-particle reactions to the bodies.
function applyBodyReactions(S) {
  for (const b of S.bodies) {
    if (b.grab) { b.fx = b.fy = b.ft = 0; continue; }
    // One solver pass moves a body by at most half a particle spacing (and
    // turns its rim by as much): a crowd of deep corrections from fast
    // water must not throw or spin it in one substep.
    let dx = b.fx * b.invM, dy = b.fy * b.invM, da = b.ft * b.invI;
    const lim = 0.5 * D, dl = Math.hypot(dx, dy), al = lim / Math.max(b.R, D);
    if (dl > lim) { dx *= lim / dl; dy *= lim / dl; }
    if (da > al) da = al; else if (da < -al) da = -al;
    shiftBody(S, b, dx, dy, da);
    b.fx = 0; b.fy = 0; b.ft = 0;
  }
}

// Move a body by a solver correction (fluid pressure, particle push, wall
// or body contact). In one substep all corrections together may add at
// most CONTACT_V of speed (the budget b.kick, reset in substep()); the
// rest also moves the start-of-substep pose, so it separates without a
// kick (a split impulse). Without it a boat squeezed between a wave, a
// wall and another boat left the tank at the speed cap.
const CONTACT_V = 1.0;
function shiftBody(S, b, dx, dy, da) {
  b.x += dx; b.y += dy; b.a += da;
  const hs = S.hs || 1 / 180, room = Math.max(0, CONTACT_V * hs - (b.kick || 0));
  const L = Math.hypot(dx, dy), use = Math.min(L, room);
  b.kick = (b.kick || 0) + use;
  if (L > use) { const k = 1 - use / L; b.px += dx * k; b.py += dy * k; }
  const al = CONTACT_V * hs / Math.max(b.R, D) - (b.kickA || 0), ua = Math.min(Math.abs(da), Math.max(0, al));
  b.kickA = (b.kickA || 0) + ua;
  if (Math.abs(da) > ua) b.pa += da - Math.sign(da) * ua;
}

// Bodies against the walls and each other, on their rim samples. Each pass
// resolves only the deepest contact of a body (or a body pair): applying
// every penetrating sample in turn over-corrects a body that a moving wall
// (the paddle) pushes, which then flies out and throws the water. Three
// passes settle a resting contact.
function bodyContacts(S) {
  const bs = S.bodies, m = bs.length;
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < m; k++) {
      const b = bs[k]; if (b.grab) continue;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      let dmin = 0, qx = 0, qy = 0;
      for (let q = 0; q < b.rim.length; q += 2) {
        const wx = b.x + c * b.rim[q] - s * b.rim[q + 1], wy = b.y + s * b.rim[q] + c * b.rim[q + 1];
        const d = wallSDF(S, wx, wy);
        if (d < dmin) { dmin = d; qx = wx; qy = wy; }
      }
      if (dmin >= 0) continue;
      wallGrad(S, qx, qy, G2); const nx = G2[0], ny = G2[1];
      const rx = qx - b.x, ry = qy - b.y, rn = rx * ny - ry * nx;
      const wsum = b.invM + rn * rn * b.invI, l = -dmin / wsum;
      shiftBody(S, b, nx * l * b.invM, ny * l * b.invM, rn * l * b.invI);
      // friction: cancel part of the slip of the contact point (Coulomb, mu 0.6)
      const vx = (b.x - b.px) - (b.a - b.pa) * ry, vy = (b.y - b.py) + (b.a - b.pa) * rx;
      const tx = -ny, ty = nx, vt = vx * tx + vy * ty, f = Math.sign(vt) * Math.min(Math.abs(vt), 0.6 * l * wsum);
      const rt = rx * ty - ry * tx, wt = b.invM + rt * rt * b.invI, lt = f / wt;
      b.x -= tx * lt * b.invM; b.y -= ty * lt * b.invM; b.a -= rt * lt * b.invI;
    }
    for (let k = 0; k < m; k++) for (let l2 = k + 1; l2 < m; l2++) {
      const A = bs[k], B = bs[l2];
      if (Math.hypot(A.x - B.x, A.y - B.y) > A.R + B.R) continue;
      pairContact(S, A, B);
    }
  }
}
// One contact pass of a body pair. Every rim sample of A inside B (and of
// B inside A) gives a push along the normal of the body it entered; the
// pushes are averaged over the samples. The deepest sample alone gave a
// push that could slide two thin hulls further into each other, and they
// then fought every pass. Averaged, the normals of a deep overlap point
// apart.
const PC = { ax: 0, ay: 0, aa: 0, bx: 0, by: 0, ba: 0, n: 0 };
function pairSamples(A, B, sign) {
  const c = Math.cos(A.a), s = Math.sin(A.a);
  for (let q = 0; q < A.rim.length; q += 2) {
    const wx = A.x + c * A.rim[q] - s * A.rim[q + 1], wy = A.y + s * A.rim[q] + c * A.rim[q + 1];
    const d = bodySDF(B, wx, wy);
    if (d >= 0) continue;
    bodyGrad(B, wx, wy, G2); const nx = G2[0], ny = G2[1];
    const ax = wx - A.x, ay = wy - A.y, an = ax * ny - ay * nx, bx = wx - B.x, by = wy - B.y, bn = bx * ny - by * nx;
    const wa = A.grab ? 0 : A.invM + an * an * A.invI, wb = B.grab ? 0 : B.invM + bn * bn * B.invI;
    if (wa + wb <= 0) continue;
    const l = -d / (wa + wb);
    // A moves out of B along +n; B moves along -n. sign swaps the roles
    // back to the (first, second) bodies of the pair.
    const fa = [l * nx * A.invM, l * ny * A.invM, an * l * A.invI], fb = [-l * nx * B.invM, -l * ny * B.invM, -bn * l * B.invI];
    const [f1, f2] = sign > 0 ? [fa, fb] : [fb, fa];
    PC.ax += f1[0]; PC.ay += f1[1]; PC.aa += f1[2]; PC.bx += f2[0]; PC.by += f2[1]; PC.ba += f2[2]; PC.n++;
  }
}
function pairContact(S, A, B) {
  PC.ax = PC.ay = PC.aa = PC.bx = PC.by = PC.ba = 0; PC.n = 0;
  pairSamples(A, B, 1); pairSamples(B, A, -1);
  if (!PC.n) return;
  const k = 1 / PC.n;
  if (!A.grab) shiftBody(S, A, PC.ax * k, PC.ay * k, PC.aa * k);
  if (!B.grab) shiftBody(S, B, PC.bx * k, PC.by * k, PC.ba * k);
}

// ---- velocity passes -----------------------------------------------------------
function velocityPass(S, hs) {
  const P = S.P;
  for (let c = 0; c < S.cn; c++) {
    const i = S.ci[2 * c], j = S.ci[2 * c + 1];
    const nx = S.cf[4 * c], ny = S.cf[4 * c + 1], vpn = S.cf[4 * c + 2], dl = S.cf[4 * c + 3];
    let vx = S.vx[i], vy = S.vy[i]; if (j >= 0) { vx -= S.vx[j]; vy -= S.vy[j]; }
    const vn = vx * nx + vy * ny, tx = vx - vn * nx, ty = vy - vn * ny, tl = Math.hypot(tx, ty);
    const fn = Math.abs(dl / (hs * hs));
    let dvx = 0, dvy = 0;
    if (tl > 1e-6) { const k = Math.min(hs * P.mu_k * fn, tl) / tl; dvx = -tx * k; dvy = -ty * k; }
    const rr = -vn + Math.max(-P.e * vpn, 0);
    const w = j >= 0 ? 0.5 : 1;
    S.vx[i] += (dvx + nx * rr) * w; S.vy[i] += (dvy + ny * rr) * w;
    if (j >= 0) { S.vx[j] -= (dvx + nx * rr) * w; S.vy[j] -= (dvy + ny * rr) * w; }
  }
}

function xsphVorticity(S, hs) {
  const n = S.n, P = S.P, inv = 1 / RHO0;
  const c = P.visc, eps = P.vort;
  if (c <= 0 && eps <= 0) return;
  // vorticity (scalar, z) and the XSPH average in ax, ay
  for (let i = 0; i < n; i++) {
    const xi = S.x[i], yi = S.y[i], vxi = S.vx[i], vyi = S.vy[i];
    let sx = 0, sy = 0, om = 0; const base = i * MAXNB;
    for (let q = 0, m = S.nbc[i]; q < m; q++) {
      const j = S.nb[base + q]; const dx = xi - S.x[j], dy = yi - S.y[j]; const r2 = dx * dx + dy * dy;
      const w = W(r2) * inv, ux = S.vx[j] - vxi, uy = S.vy[j] - vyi;
      sx += ux * w; sy += uy * w;
      const r = Math.sqrt(r2); if (r < 1e-9) continue;
      const g = -SPIKY * (H - r) * (H - r) / r;   // grad_j W = -grad_i W
      om += ux * (g * dy) - uy * (g * dx);
    }
    S.ax[i] = sx; S.ay[i] = sy; S.om[i] = om * inv;
  }
  for (let i = 0; i < n; i++) {
    let fx = 0, fy = 0;
    if (eps > 0) {
      const xi = S.x[i], yi = S.y[i]; let ex = 0, ey = 0; const base = i * MAXNB;
      for (let q = 0, m = S.nbc[i]; q < m; q++) {
        const j = S.nb[base + q]; const dx = xi - S.x[j], dy = yi - S.y[j]; const r = Math.hypot(dx, dy); if (r < 1e-9) continue;
        const g = SPIKY * (H - r) * (H - r) / r * Math.abs(S.om[j]);
        ex += g * dx; ey += g * dy;
      }
      const L = Math.hypot(ex, ey);
      if (L > 1e-9) { const Nx = ex / L, Ny = ey / L, w = S.om[i]; fx = eps * (Ny * w) * 0.02; fy = eps * (-Nx * w) * 0.02; }
    }
    S.vx[i] += c * S.ax[i] + fx * hs; S.vy[i] += c * S.ay[i] + fy * hs;
  }
}

// ---- one substep ---------------------------------------------------------------
function substep(S, hs) {
  const P = S.P, n = S.n;
  S.t += hs;
  // kinematic walls
  const prevShake = S.shake;
  S.shake = P.shakeA * Math.sin(2 * Math.PI * P.shakeF * S.t);
  S.wallVx = (S.shake - prevShake) / hs; S.hs = hs;
  for (const ob of S.obstacles) {
    if (ob.spin) { ob.a += ob.spin * hs; }
    if (ob.orbit) { ob.th += ob.orbit * hs; ob.x = ob.ox + ob.or * Math.cos(ob.th); ob.y = ob.oy + ob.or * Math.sin(ob.th); }
    if (ob.swing) { ob.x = ob.ox + ob.swing * Math.sin(2 * Math.PI * ob.sf * S.t); }
    updateObstacle(ob);
  }
  // gravity direction (tilt and spin)
  if (P.spin) S.angle += P.spin * hs;
  const g = Math.hypot(P.gx, P.gy), ga = Math.atan2(P.gy, P.gx) + S.angle;
  const gx = g * Math.cos(ga), gy = g * Math.sin(ga);
  S.gNow = [gx, gy];
  // bodies: predict
  for (const b of S.bodies) {
    b.px = b.x; b.py = b.y; b.pa = b.a;
    if (b.grab) {
      const p = S.pointer, c = Math.cos(b.a), s = Math.sin(b.a);
      const ax = b.x + c * p.ox - s * p.oy, ay = b.y + s * p.ox + c * p.oy;
      b.vx = (p.x - ax) / Math.max(hs * 6, 1e-3); b.vy = (p.y - ay) / Math.max(hs * 6, 1e-3); b.w *= 0.9;
    } else { b.vx += gx * hs; b.vy += gy * hs; }
    b.x += b.vx * hs; b.y += b.vy * hs; b.a += b.w * hs;
    b.fx = b.fy = b.ft = 0; b.cx = b.cy = b.ca = 0; b.kick = 0; b.kickA = 0;
  }
  placeBoundary(S); buildBoundaryGrid(S);
  // fluid: predict
  const vmax = P.maxV;
  for (let i = 0; i < n; i++) {
    let vx = S.vx[i] + gx * hs, vy = S.vy[i] + gy * hs;
    const v = Math.hypot(vx, vy); if (v > vmax) { vx *= vmax / v; vy *= vmax / v; }
    S.vx[i] = vx; S.vy[i] = vy;
    S.px[i] = S.x[i]; S.py[i] = S.y[i];
    S.x[i] += vx * hs; S.y[i] += vy * hs;
  }
  // pointer stir (no body grabbed)
  const p = S.pointer;
  if (p.on && p.body < 0 && (p.vx || p.vy)) {
    const r2 = p.r * p.r;
    for (let i = 0; i < n; i++) { const dx = S.x[i] - p.x, dy = S.y[i] - p.y, d2 = dx * dx + dy * dy; if (d2 < r2) { const w = (1 - d2 / r2) * 0.5; S.x[i] += (p.vx * hs) * w; S.y[i] += (p.vy * hs) * w; } }
  }
  buildGrid(S);
  const gran = P.material === 'granular';
  S.cn = 0;
  for (let it = 0; it < P.iters; it++) {
    const last = it === P.iters - 1;
    if (gran) solveGranular(S, last && P.velPass);
    else solveDensity(S);
    applyBodyReactions(S);
    collide(S, gran && last && P.velPass);
  }
  if (gran && !P.iters) collide(S, false);
  bodyContacts(S);
  // velocities
  const ih = 1 / hs;
  for (let i = 0; i < n; i++) {
    let vx = (S.x[i] - S.px[i]) * ih, vy = (S.y[i] - S.py[i]) * ih;
    if (!(vx === vx) || !(vy === vy)) { vx = 0; vy = 0; S.x[i] = S.px[i]; S.y[i] = S.py[i]; }
    // a large position correction must not become a launch speed
    const sp = Math.hypot(vx, vy); if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
    S.vx[i] = vx; S.vy[i] = vy;
  }
  if (gran) { if (P.velPass) velocityPass(S, hs); }
  else xsphVorticity(S, hs);
  for (const b of S.bodies) {
    if (b.grab) { b.vx = (b.x - b.px) * ih; b.vy = (b.y - b.py) * ih; b.w = (b.a - b.pa) * ih; continue; }
    b.vx = (b.x - b.px) * ih; b.vy = (b.y - b.py) * ih; b.w = (b.a - b.pa) * ih;
    // water drag on the wet part: damps bobbing and spin
    const wet = bodyWet(S, b);
    const k = Math.min(1, (1.2 + 3 * wet) * wet * hs);
    b.vx *= 1 - k * 0.6; b.vy *= 1 - k; b.w *= 1 - Math.min(1, 4 * wet * hs);
    const v = Math.hypot(b.vx, b.vy); if (v > vmax) { b.vx *= vmax / v; b.vy *= vmax / v; }
    const wmax = 0.5 * vmax / Math.max(b.R, D); if (b.w > wmax) b.w = wmax; else if (b.w < -wmax) b.w = -wmax;
    if (!(b.x === b.x)) { b.x = S.Wd / 2; b.y = S.Hd * 0.8; b.vx = b.vy = b.w = 0; b.a = 0; }
    b.wet = wet;
  }
}

// The wet fraction of a body: how many of its boundary particles have a
// fluid neighbour cell with occupancy. Cheap, used for drag only.
function bodyWet(S, b) {
  const c = Math.cos(b.a), s = Math.sin(b.a); let wet = 0, tot = 0;
  for (let q = 0; q < b.rim.length; q += 4) {
    const wx = b.x + c * b.rim[q] - s * b.rim[q + 1], wy = b.y + s * b.rim[q] + c * b.rim[q + 1];
    const cc = cellOf(S, wx, wy); tot++; if (S.occ[cc] > 0.15) wet++;
  }
  return tot ? wet / tot : 0;
}

function updateObstacle(ob) {
  const p = ob.p, l = ob.local, c = Math.cos(ob.a), s = Math.sin(ob.a);
  if (l.t === 'c') { p.x = ob.x + c * l.x - s * l.y; p.y = ob.y + s * l.x + c * l.y; }
  else if (l.t === 'b') { p.x = ob.x + c * l.x - s * l.y; p.y = ob.y + s * l.x + c * l.y; p.a = (l.a || 0) + ob.a; }
}

// Emitters: rows of particles across the nozzle, one row per D of travel.
function emit(S, dt) {
  for (const e of S.emitters) {
    if (!e.on) continue;
    e.acc += e.speed * dt;
    const nx = Math.cos(e.dir), ny = Math.sin(e.dir), tx = -ny, ty = nx;
    const k = Math.max(1, Math.round(e.width / D));
    while (e.acc >= D) {
      e.acc -= D;
      for (let q = 0; q < k && S.n < S.cap && S.n < S.limit; q++) {
        const o = (q - (k - 1) / 2) * D, i = S.n++;
        S.x[i] = e.x + tx * o + nx * e.acc; S.y[i] = e.y + ty * o + ny * e.acc;
        S.vx[i] = nx * e.speed; S.vy[i] = ny * e.speed; S.px[i] = S.x[i]; S.py[i] = S.y[i];
      }
      if (S.n >= S.limit) { e.left = 0; }
    }
  }
}

// One frame of dt seconds.
function step(S, dt) {
  const P = S.P, ns = Math.max(1, P.substeps | 0), hs = dt / ns;
  emit(S, dt);
  if (P.material === 'granular' && !S.ci) { S.cmax = S.cap * 8; S.ci = new Int32Array(2 * S.cmax); S.cf = new Float64Array(4 * S.cmax); }
  for (let k = 0; k < ns; k++) substep(S, hs);
  // foam: fast particles with few neighbours (spray), decays
  for (let i = 0; i < S.n; i++) {
    const v2 = S.vx[i] * S.vx[i] + S.vy[i] * S.vy[i];
    const lone = S.nbc[i] < 8 ? 1 : 0;
    const f = Math.min(1, (v2 - 1.2) * 0.4) * (0.4 + 0.6 * lone);
    S.foam[i] = Math.max(S.foam[i] * 0.94, f > 0 ? f : 0);
  }
  S.frame++;
}

// ---- scene build ---------------------------------------------------------------
// cfg (all optional; main.js passes the panel state):
//   container, count, fill ('pool' | 'dam' | 'drop' | 'twin' | 'rain' |
//   'empty'), obstacles (0..6), emitters (0..3), bodies [{ kind, size,
//   density }], seed
export function buildScene(S, cfg, rnd) {
  const Wd = S.Wd, Hd = S.Hd;
  S.container = makeContainer(cfg.container || 'tank', Wd, Hd, rnd);
  S.n = 0; S.t = 0; S.frame = 0; S.shake = 0; S.angle = 0; S.bodies = []; S.obstacles = []; S.emitters = [];
  S.foam.fill(0);
  const C = S.container, inn = C.inner;
  // obstacles
  if (cfg.container === 'mixer') {
    // The upstream scene: five disks on the rim of a round container, turning at 120 deg/s.
    const R = C.R, nD = 5, r = 0.25 * R;
    for (let i = 0; i < nD; i++) {
      const th = (i / nD) * Math.PI * 2;
      const p = { t: 'c', x: 0, y: 0, r };
      S.obstacles.push({ kind: 'disk', p: Object.assign({}, p), local: p, x: C.cx + R * Math.cos(th), y: C.cy + R * Math.sin(th), a: 0, ox: C.cx, oy: C.cy, or: R, th, orbit: (S.P.mixer || 120) * Math.PI / 180, R: r + 0.01 });
    }
  }
  const nObs = cfg.obstacles | 0;
  for (let k = 0; k < nObs; k++) {
    const kind = rnd() < 0.45 ? 'post' : rnd() < 0.5 ? 'plate' : 'spinner';
    let x = inn.x0 + (inn.x1 - inn.x0) * (0.2 + 0.6 * rnd()), y = inn.y0 + (inn.y1 - inn.y0) * (0.15 + 0.4 * rnd());
    let ob;
    if (kind === 'post') { const r = 0.04 + 0.05 * rnd(); const p = { t: 'c', x: 0, y: 0, r }; ob = { kind, p: Object.assign({}, p), local: p, x, y, a: 0, R: r + 0.01 }; }
    else if (kind === 'plate') { const hw = 0.08 + 0.1 * rnd(), p = { t: 'b', x: 0, y: 0, hw, hh: 0.015, a: 0, r: 0.008 }; ob = { kind, p: Object.assign({}, p), local: p, x, y, a: (rnd() - 0.5) * 1.6, R: hw + 0.03 }; }
    else { const hw = 0.09 + 0.06 * rnd(), p = { t: 'b', x: 0, y: 0, hw, hh: 0.014, a: 0, r: 0.008 }; ob = { kind, p: Object.assign({}, p), local: p, x, y, a: rnd() * 3, spin: (rnd() < 0.5 ? -1 : 1) * (1 + 2 * rnd()), R: hw + 0.03 }; }
    if (wallSDFStatic(S, x, y) < ob.R + 0.05) continue;
    updateObstacle(ob); S.obstacles.push(ob);
  }
  if (cfg.paddle) {
    const hh = Hd * 0.35, p = { t: 'b', x: 0, y: 0, hw: 0.02, hh, a: 0, r: 0.01 };
    const ob = { kind: 'paddle', p: Object.assign({}, p), local: p, x: inn.x0 + 0.08, y: inn.y0 + hh * 0.9, a: 0, ox: inn.x0 + 0.12, swing: 0.07, sf: 0.6 + 0.4 * rnd(), R: hh + 0.03 };
    updateObstacle(ob); S.obstacles.push(ob);
  }
  // bodies
  (cfg.bodies || []).forEach((bd, k) => {
    const b = makeBody(bd.kind, 0, 0, bd.size || 1, rnd, bd.density);
    let x = 0, y = 0, ok = false;
    for (let t = 0; t < 30 && !ok; t++) {
      x = inn.x0 + b.R + (inn.x1 - inn.x0 - 2 * b.R) * rnd();
      y = inn.y0 + (inn.y1 - inn.y0) * (0.55 + 0.4 * rnd());
      ok = wallSDF(S, x, y) > b.R + 0.01 && S.bodies.every(o => Math.hypot(o.x - x, o.y - y) > o.R + b.R + 0.01);
    }
    if (!ok) return;
    b.x = b.px = x; b.y = b.py = y; b.a = b.pa = bd.angle != null ? bd.angle : (rnd() - 0.5) * 0.6; b.id = k; b.color = bd.color;
    S.bodies.push(b);
  });
  // particles
  const want = Math.min(S.cap, Math.max(0, cfg.count | 0));
  S.limit = want;
  const fill = cfg.fill || 'pool';
  const blocked = (x, y) => wallSDF(S, x, y) < 0.6 * D || S.bodies.some(b => bodySDF(b, x, y) < 0.6 * D);
  const put = (x, y) => { if (S.n >= want || blocked(x, y)) return; const i = S.n++; S.x[i] = S.px[i] = x; S.y[i] = S.py[i] = y; S.vx[i] = S.vy[i] = 0; };
  const block = (x0, x1, y0, n) => { for (let y = y0; S.n < n && y < Hd; y += D) for (let x = x0; x <= x1 && S.n < n; x += D) put(x, y); };
  const x0 = inn.x0 + D, x1 = inn.x1 - D, y0 = inn.y0 + D;
  if (fill === 'dam') block(x0, x0 + (x1 - x0) * (0.3 + 0.15 * rnd()), y0, want);
  else if (fill === 'drop') { block(x0, x1, y0, Math.floor(want * 0.45)); const w = (x1 - x0) * 0.3, c = (x0 + x1) / 2; block(c - w / 2, c + w / 2, y0 + (inn.y1 - inn.y0) * 0.5, want); }
  else if (fill === 'twin') { block(x0, x0 + (x1 - x0) * 0.25, y0, Math.floor(want / 2)); block(x1 - (x1 - x0) * 0.25, x1, y0, want); }
  else if (fill === 'rain') { for (let t = 0; t < want * 3 && S.n < want; t++) put(x0 + (x1 - x0) * rnd(), y0 + (inn.y1 - y0) * (0.3 + 0.65 * rnd())); }
  else if (fill === 'empty') { /* emitters fill it */ }
  else block(x0, x1, y0, want);
  if (fill === 'twin' && C.gate) { /* both sides of the dam */ }
  // emitters
  const nE = cfg.emitters | 0;
  for (let k = 0; k < nE; k++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const x = (inn.x0 + inn.x1) / 2 + side * (inn.x1 - inn.x0) * (0.15 + 0.3 * rnd()), y = inn.y1 - 0.08 - 0.1 * rnd();
    if (wallSDF(S, x, y) < 0.05) continue;
    S.emitters.push({ x, y, dir: -Math.PI / 2 - side * (0.3 + 0.6 * rnd()), speed: 1.2 + 1.3 * rnd(), width: D * (2 + Math.floor(rnd() * 3)), acc: 0, on: true });
  }
  if (fill === 'empty' && !S.emitters.length) S.emitters.push({ x: (inn.x0 + inn.x1) / 2, y: inn.y1 - 0.1, dir: -Math.PI / 2, speed: 1.6, width: 4 * D, acc: 0, on: true });
  if (S.emitters.length) S.limit = Math.min(S.cap, Math.max(want, cfg.emitCount || want + 600));
  sampleBoundary(S);
  return S;
}
function wallSDFStatic(S, x, y) { const c = S.container; let d = c.free(x, y); for (const s of c.solids) d = Math.min(d, primSDF(s, x, y)); for (const ob of S.obstacles) d = Math.min(d, primSDF(ob.p, x, y)); return d; }

// Add one body at (x, y) after the scene is built (the drop buttons).
export function addBody(S, kind, x, y, rnd, size = 1, density) {
  const b = makeBody(kind, x, y, size, rnd, density);
  b.px = x; b.py = y; b.id = S.bodies.length;
  if (wallSDF(S, x, y) < 0.02) return null;
  S.bodies.push(b);
  // push water out of the way so the drop does not explode
  for (let i = 0; i < S.n; i++) { const d = bodySDF(b, S.x[i], S.y[i]); if (d < 0.5 * D) { const g = [0, 0]; bodyGrad(b, S.x[i], S.y[i], g); S.x[i] += g[0] * (0.5 * D - d); S.y[i] += g[1] * (0.5 * D - d); S.px[i] = S.x[i]; S.py[i] = S.y[i]; } }
  sampleBoundary(S);
  return b;
}
export function removeBody(S, b) {
  const i = S.bodies.indexOf(b); if (i < 0) return;
  S.bodies.splice(i, 1); sampleBoundary(S);
}

// Body under a world point (for the pointer), or -1.
export function pickBody(S, x, y, slack = 0.02) {
  for (let k = S.bodies.length - 1; k >= 0; k--) if (bodySDF(S.bodies[k], x, y) < slack) return k;
  return -1;
}
export function grab(S, k, x, y) {
  const p = S.pointer, b = S.bodies[k];
  const c = Math.cos(b.a), s = Math.sin(b.a), dx = x - b.x, dy = y - b.y;
  p.ox = c * dx + s * dy; p.oy = -s * dx + c * dy; p.body = k; p.x = x; p.y = y; b.grab = true;
}
export function release(S) {
  const p = S.pointer; if (p.body >= 0 && S.bodies[p.body]) S.bodies[p.body].grab = null; p.body = -1;
}

// Rebuild the boundary samples (after bspace or body changes).
export function resample(S) { sampleBoundary(S); }

// Sum of a check over every particle: finite and inside the domain.
export function health(S) {
  let bad = 0, out = 0;
  for (let i = 0; i < S.n; i++) {
    const x = S.x[i], y = S.y[i];
    if (!isFinite(x) || !isFinite(y) || !isFinite(S.vx[i]) || !isFinite(S.vy[i])) bad++;
    else if (x < -0.05 || x > S.Wd + 0.05 || y < -0.05 || y > S.Hd + 0.05) out++;
  }
  return { bad, out };
}
