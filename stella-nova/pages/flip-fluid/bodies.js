// ============================================================================
//  FLIP WATER  ·  bodies.js  —  rigid bodies two-way coupled to the FLIP water
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  COUPLING METHOD (weak two-way coupling, one pass per substep)
//  1. Fluid <- body. Each body is a moving solid of the FlipSim: its grid
//     cells get s = 0 and its faces get the body's rigid velocity
//     v + w x r before the pressure solve (moving-solid boundary
//     condition: R. Bridson, Fluid Simulation for Computer Graphics, 2nd
//     ed., 2015, ch. 5; the obstacle of Ten Minute Physics #18 is the
//     same idea). Particles that enter the body are pushed out along the
//     body's SDF normal and lose their inward relative normal velocity.
//     This displaces the water (the level rises) and throws splashes.
//  2. Body <- fluid. Interior area samples (pitch about one cell) carry
//     the forces. A sample is wet by the fill fraction of the water
//     beside the body at the sample's height: the solver marches across
//     gravity to the first cell clear of all bodies on each side and
//     reads the particle density there. Each wet sample gets buoyancy
//     -rho_w g dA (Archimedes, summed over the samples, as in the
//     buoyancy controllers of game physics engines: E. Catto, Box2D
//     buoyancy, 2007) and linear drag rho_w k dA (u_fluid - v_point).
//     The forces act at the samples, so a body gets torque and rights
//     itself. Added mass 0.5 rho_w A_wet keeps light bodies stable.
//     Particle impacts faster than 0.8 m/s add their momentum to the
//     body (a dam wave pushes a boat).
//  Ballast (boat, buoy, duck): gravity acts at a point below the
//  centroid, so the righting moment brings the keel down.
//  3. Body <-> body, walls and obstacles. Each body has a cluster of
//     circles inside its shape. Contacts get sequential impulses with
//     restitution and Coulomb friction, then a position correction.
//
//  The drag reaction does not go back to the particles directly; the
//  face boundary condition of step 1 carries the body's motion into the
//  water. Momentum is therefore not exactly conserved (weak coupling).
//
//  grep -n targets
//    export const KINDS     object catalogue: shape, density, colours
//    class Body             mass, inertia, samples, circles
//    function couple        forces, impacts, contacts, integration
//    function wetFraction   the side march
//    function contacts      walls, statics, kinematic solids, bodies
//    export function makeBodies   scene spec -> bodies in the sim
//    export function spawn        one body of a kind
//    GEN.objects            the randomizer category (patched into scenes.js)
// ============================================================================
import { Solid, mulberry } from './flip.js';
import { box, disc, capsule, poly, sdfLocal, sdfWorld, normalWorld, centred } from './shapes.js';
import { GEN, PRESETS, CATS, hashStr } from './scenes.js';

const RHO_W = 1000;
const N2 = new Float64Array(2), V2 = new Float64Array(2);

// Object catalogue. Sizes are in units of S (scene scale, metres), the
// density is relative to water (1 = neutral).
export const KINDS = {
  duck:    { name: 'Rubber duck', density: 0.3,  ballast: 0.4, shape: (S) => poly([[-0.095, 0.045], [-0.075, -0.025], [0.045, -0.035], [0.08, -0.005], [0.06, 0.022], [0.042, 0.03], [0.062, 0.05], [0.058, 0.078], [0.035, 0.093], [0.012, 0.085], [0.006, 0.058], [0.012, 0.033], [-0.045, 0.028]].map(([x, y]) => [x * S, y * S]), 0.008 * S) },
  boat:    { name: 'Boat',        density: 0.35, ballast: 1.6, shape: (S) => poly([[-0.24 * S, 0.05 * S], [0.24 * S, 0.05 * S], [0.17 * S, -0.06 * S], [-0.17 * S, -0.06 * S]], 0.006 * S) },
  box:     { name: 'Crate',       density: 0.6,  shape: (S) => box(0.17 * S, 0.17 * S, 0.008 * S) },
  ball:    { name: 'Beach ball',  density: 0.12, shape: (S) => disc(0.085 * S) },
  log:     { name: 'Log',         density: 0.65, shape: (S) => capsule(0.38 * S, 0.055 * S) },
  plank:   { name: 'Plank',       density: 0.55, shape: (S) => box(0.46 * S, 0.045 * S, 0.006 * S) },
  buoy:    { name: 'Buoy',        density: 0.25, ballast: 0.6, shape: (S) => disc(0.06 * S) },
  ice:     { name: 'Ice cube',    density: 0.92, shape: (S) => box(0.12 * S, 0.12 * S, 0.014 * S) },
  bottle:  { name: 'Bottle',      density: 1.0,  shape: (S) => capsule(0.16 * S, 0.035 * S) },
  rock:    { name: 'Rock',        density: 2.6,  shape: (S, r) => rockShape(S, r) },
};
export const KIND_IDS = Object.keys(KINDS);

function rockShape(S, rng) {
  const n = 7, pts = [];
  const ph = rng() * 6.28;
  for (let k = 0; k < n; k++) {
    const a = ph + (k / n) * 2 * Math.PI + (rng() - 0.5) * 0.4;
    const rr = (0.055 + 0.03 * rng()) * S;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.8]);
  }
  // Keep it convex: the hull of the points in angle order is convex enough
  // for the SDF (it works for any simple polygon).
  return poly(pts, 0.008 * S);
}

export class Body extends Solid {
  constructor(kind, shape0, x, y, a, density, h) {
    let pitch = Math.max(h * 0.9, shape0.bound / 7);
    const { shape } = centred(shape0, pitch);
    super(shape, x, y, a);
    this.kinematic = false; this.kind = kind; this.density = density;
    this.samples = null;
    this.grab = null; this.J = new Float64Array(3); this.wet = 0; this.colour = 0; this.look = 0;
    // Area samples (local), mass, inertia. A thin shape (a plank) can fall
    // between the sample rows: halve the pitch until it has 8 samples, so
    // the buoyancy has a lever arm and the inertia is not zero.
    const B = shape.bound;
    let pts = [];
    for (let tries = 0; tries < 4; tries++) {
      pts = [];
      for (let yy = -B + pitch / 2; yy < B; yy += pitch)
        for (let xx = -B + pitch / 2; xx < B; xx += pitch)
          if (sdfLocal(shape, xx, yy) < 0) pts.push(xx, yy);
      if (pts.length >= 16) break;
      pitch *= 0.5;
    }
    if (!pts.length) pts.push(0, 0);
    this.dA = pitch * pitch;
    this.samples = Float64Array.from(pts);
    this.area = (pts.length / 2) * this.dA;
    this.mass = density * RHO_W * this.area;
    let I = 0;
    for (let i = 0; i < pts.length; i += 2) I += pts[i] * pts[i] + pts[i + 1] * pts[i + 1];
    // each sample is a square cell: its own moment adds pitch^2 / 6; the
    // floor keeps a tiny body from spinning without limit
    this.r2 = Math.max(I / (pts.length / 2) + pitch * pitch / 6, 0.02 * B * B);
    this.inertia = this.mass * this.r2;
    this.circles = clusterOf(shape);
    this.cgy = 0;   // centre of gravity below the centroid (ballast), local y
    this.wetSamples = new Float32Array(pts.length / 2);
  }
}

// Collision circles inside the shape: [x, y, r, ...] local.
function clusterOf(s) {
  if (s.n === 1) return Float64Array.of(s.v[0], s.v[1], s.r);
  if (s.n === 2) {
    const L = Math.hypot(s.v[2] - s.v[0], s.v[3] - s.v[1]), k = Math.max(1, Math.ceil(L / (0.8 * s.r)));
    const out = [];
    for (let i = 0; i <= k; i++) { const t = i / k; out.push(s.v[0] + (s.v[2] - s.v[0]) * t, s.v[1] + (s.v[3] - s.v[1]) * t, s.r); }
    return Float64Array.from(out);
  }
  let ir = 0;
  const B = s.bound, st = B / 24;
  for (let y = -B; y <= B; y += st) for (let x = -B; x <= B; x += st) ir = Math.max(ir, -sdfLocal(s, x, y));
  const rc = Math.max(ir * 0.55, s.r), pitch = rc * 0.85, out = [];
  for (let y = -B; y <= B; y += pitch * 0.5)
    for (let x = -B; x <= B; x += pitch * 0.5)
      if (sdfLocal(s, x, y) <= -rc + 1e-6) {
        let near = false;
        for (let k = 0; k < out.length; k += 3) if ((out[k] - x) ** 2 + (out[k + 1] - y) ** 2 < pitch * pitch) { near = true; break; }
        if (!near) out.push(x, y, rc);
      }
  if (!out.length) out.push(0, 0, Math.max(ir, 1e-3));
  return Float64Array.from(out);
}

// ---- forces from the water ----------------------------------------------------------
function densityAt(sim, x, y) {
  const h = sim.h, n = sim.fNumY, D = sim.particleDensity;
  const fx = Math.min(Math.max(x / h - 0.5, 0), sim.fNumX - 1.001), fy = Math.min(Math.max(y / h - 0.5, 0), sim.fNumY - 1.001);
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, c = i * n + j;
  return (1 - tx) * ((1 - ty) * D[c] + ty * D[c + 1]) + tx * ((1 - ty) * D[c + n] + ty * D[c + n + 1]);
}
function gridVel(sim, x, y, out) {
  const h = sim.h, n = sim.fNumY;
  const i = Math.min(Math.max(Math.floor(x / h), 1), sim.fNumX - 2), j = Math.min(Math.max(Math.floor(y / h), 1), sim.fNumY - 2), c = i * n + j;
  out[0] = 0.5 * (sim.u[c] + sim.u[c + n]); out[1] = 0.5 * (sim.v[c] + sim.v[c + 1]);
  return out;
}

// Fill fraction (0..1) of the water beside the body at (x, y). tx, ty is the
// unit direction across gravity. Returns -1 when both sides are blocked.
function wetFraction(sim, b, x, y, tx, ty, out) {
  const h = sim.h, n = sim.fNumY, step = 0.5 * h;
  // Volume fraction: particles per cell x the area of one particle in the
  // hexagonal packing (2 sqrt3 r^2) / cell area.
  const vf = 2 * Math.sqrt(3) * sim.particleRadius * sim.particleRadius / (h * h);
  const maxSteps = Math.ceil(2 * b.shape.bound / step) + 6;
  let sum = 0, cnt = 0;
  out[0] = 0; out[1] = 0;
  for (let side = -1; side <= 1; side += 2) {
    let qx = x, qy = y, ok = false;
    for (let k = 0; k < maxSteps; k++) {
      qx += side * tx * step; qy += side * ty * step;
      const i = Math.floor(qx / h), j = Math.floor(qy / h);
      if (i < 1 || i > sim.fNumX - 2 || j < 1 || j > sim.fNumY - 2) break;
      const c = i * n + j;
      if (sim.sStatic[c] === 0) break;                 // wall or obstacle: no water this side
      if (sim.solidId[c] >= 0) continue;               // still inside some body
      if (sdfWorld(b, qx, qy) < 1.5 * h) continue;     // bilinear reads must not touch the body
      ok = true; break;
    }
    if (!ok) continue;
    const f = Math.min(1, densityAt(sim, qx, qy) * vf);
    sum += f; cnt++;
    gridVel(sim, qx, qy, V2); out[0] += V2[0] * f; out[1] += V2[1] * f;
  }
  if (!cnt) return -1;
  if (sum > 0) { out[0] /= sum; out[1] /= sum; }
  return sum / cnt;
}

const UF = new Float64Array(2);
export function couple(sim, dt) {
  const bodies = sim.solids;
  const gx = sim.gx, gy = sim.gy, g = Math.hypot(gx, gy) || 1;
  const tx = -gy / g, ty = gx / g;                    // across gravity
  const kDrag = sim.bodyDrag ?? 5;
  const vmax = sim.cfl * sim.h / dt;
  for (let k = 0; k < bodies.length; k++) {
    const b = bodies[k];
    if (b.kinematic || !b.active) continue;
    const c = Math.cos(b.a), s = Math.sin(b.a), S = b.samples, m = S.length / 2;
    let Fx = b.mass * gx, Fy = b.mass * gy, T = 0, wetA = 0, wetI = 0;
    if (b.cgy) {
      // gravity acts at the ballast point (0, cgy) in local coordinates
      const gxr = -s * b.cgy, gyr = c * b.cgy;
      T += gxr * b.mass * gy - gyr * b.mass * gx;
    }
    for (let i = 0; i < m; i++) {
      const lx = S[2 * i], ly = S[2 * i + 1];
      const rx = c * lx - s * ly, ry = s * lx + c * ly;
      const px = b.x + rx, py = b.y + ry;
      let f = wetFraction(sim, b, px, py, tx, ty, UF);
      if (f < 0) {
        // Boxed in on both sides (between walls): use the cell above.
        f = Math.min(1, densityAt(sim, px, py + b.shape.bound) * 2 * Math.sqrt(3) * sim.particleRadius * sim.particleRadius / (sim.h * sim.h));
        UF[0] = 0; UF[1] = 0;
      }
      b.wetSamples[i] = f;
      if (f <= 0) continue;
      const dA = b.dA * f;
      // buoyancy
      const bx = -RHO_W * gx * dA, by = -RHO_W * gy * dA;
      // drag against the water velocity at the point
      const vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx;
      const dx = RHO_W * kDrag * dA * (UF[0] - vpx), dy = RHO_W * kDrag * dA * (UF[1] - vpy);
      Fx += bx + dx; Fy += by + dy;
      T += rx * (by + dy) - ry * (bx + dx);
      wetA += dA; wetI += dA * (rx * rx + ry * ry);
    }
    b.wet = wetA / (b.area || 1);
    // grab spring (pointer)
    if (b.grab) {
      const gr = b.grab, ax = b.x + c * gr.lx - s * gr.ly, ay = b.y + s * gr.lx + c * gr.ly;
      const kk = 120 * b.mass, dd = 18 * b.mass;
      const vpx = b.vx - b.w * (ay - b.y), vpy = b.vy + b.w * (ax - b.x);
      const fx = kk * (gr.x - ax) - dd * vpx, fy = kk * (gr.y - ay) - dd * vpy;
      Fx += fx - b.mass * gx * 0.98; Fy += fy - b.mass * gy * 0.98;   // carry its weight
      T += (ax - b.x) * fy - (ay - b.y) * fx;
      b.w *= 0.9;
    }
    const mEff = b.mass + 0.5 * RHO_W * wetA, iEff = b.inertia + 0.5 * RHO_W * wetI;
    b.vx += (Fx * dt + b.J[0]) / mEff; b.vy += (Fy * dt + b.J[1]) / mEff;
    b.w += (T * dt + b.J[2]) / iEff;
    b.J[0] = 0; b.J[1] = 0; b.J[2] = 0;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > vmax) { b.vx *= vmax / sp; b.vy *= vmax / sp; }
    if (Math.abs(b.w) > 40) b.w = 40 * Math.sign(b.w);
    b.mEff = mEff; b.iEff = iEff;
  }
  contacts(sim, dt);
  for (let k = 0; k < bodies.length; k++) {
    const b = bodies[k];
    if (b.kinematic || !b.active) continue;
    b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.w * dt;
  }
  contacts(sim, dt, true);
}

// Particle impacts (FlipSim.onSolidHit): impulse on the body, only for
// fast hits (resting water already counts through buoyancy).
export function hit(b, px, py, jx, jy, speed) {
  if (speed < 0.8) return;
  b.J[0] += jx; b.J[1] += jy; b.J[2] += (px - b.x) * jy - (py - b.y) * jx;
}

// ---- contacts ---------------------------------------------------------------------------
const CP = new Float64Array(2);
function worldCircle(b, k, out) {
  const C = b.circles, c = Math.cos(b.a), s = Math.sin(b.a);
  out[0] = b.x + c * C[k] - s * C[k + 1]; out[1] = b.y + s * C[k] + c * C[k + 1];
  return out;
}

function invM(b) { return b.kinematic ? 0 : 1 / (b.mEff || b.mass); }
function invI(b) { return b.kinematic ? 0 : 1 / Math.max(b.iEff || b.inertia, 1e-9); }

// One contact: point (px, py) on the surface, normal n from B to A, depth.
function resolve(A, B, px, py, nx, ny, depth, posPass) {
  const ima = invM(A), imb = B ? invM(B) : 0, iia = invI(A), iib = B ? invI(B) : 0;
  const sum = ima + imb;
  if (sum <= 0) return;
  if (posPass) {
    // capped, so a deep overlap (a body spawned in a wall) is pushed out
    // over several frames, not thrown across the tank in one
    const corr = Math.min(Math.max(0, depth - 0.002), 0.02) * 0.6 / sum;
    if (!A.kinematic) { A.x += nx * corr * ima; A.y += ny * corr * ima; }
    if (B && !B.kinematic) { B.x -= nx * corr * imb; B.y -= ny * corr * imb; }
    return;
  }
  const rax = px - A.x, ray = py - A.y;
  let vax = A.vx - A.w * ray, vay = A.vy + A.w * rax;
  let vbx = 0, vby = 0, rbx = 0, rby = 0;
  if (B) { rbx = px - B.x; rby = py - B.y; vbx = B.vx - B.w * rby; vby = B.vy + B.w * rbx; }
  const rvx = vax - vbx, rvy = vay - vby, vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;
  const ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx;
  const e = -vn > 1 ? 0.2 : 0;
  const jn = -(1 + e) * vn / (sum + ran * ran * iia + rbn * rbn * iib);
  // friction
  let tvx = rvx - vn * nx, tvy = rvy - vn * ny;
  const tl = Math.hypot(tvx, tvy);
  let jt = 0;
  if (tl > 1e-6) {
    tvx /= tl; tvy /= tl;
    const rat = rax * tvy - ray * tvx, rbt = rbx * tvy - rby * tvx;
    jt = Math.min(0.5 * jn, tl / (sum + rat * rat * iia + rbt * rbt * iib));
  }
  const jx = jn * nx - jt * tvx, jy = jn * ny - jt * tvy;
  if (!A.kinematic) { A.vx += jx * ima; A.vy += jy * ima; A.w += (rax * jy - ray * jx) * iia; }
  if (B && !B.kinematic) { B.vx -= jx * imb; B.vy -= jy * imb; B.w -= (rbx * jy - rby * jx) * iib; }
}

const QA = new Float64Array(2), QB = new Float64Array(2);
function contacts(sim, dt, posPass) {
  const h = sim.h, x0 = h, x1 = (sim.fNumX - 1) * h, y0 = h, y1 = (sim.fNumY - 1) * h;
  const list = sim.solids;
  const iters = posPass ? 2 : 4;
  for (let it = 0; it < iters; it++) {
    for (let a = 0; a < list.length; a++) {
      const A = list[a];
      if (A.kinematic || !A.active) continue;
      const C = A.circles;
      for (let k = 0; k < C.length; k += 3) {
        worldCircle(A, k, QA);
        const cx = QA[0], cy = QA[1], rc = C[k + 2];
        // tank walls and floor; a lid at the top
        if (cx - rc < x0) resolve(A, null, cx - rc, cy, 1, 0, x0 - (cx - rc), posPass);
        if (cx + rc > x1) resolve(A, null, cx + rc, cy, -1, 0, cx + rc - x1, posPass);
        if (cy - rc < y0) resolve(A, null, cx, cy - rc, 0, 1, y0 - (cy - rc), posPass);
        if (cy + rc > y1) resolve(A, null, cx, cy + rc, 0, -1, cy + rc - y1, posPass);
        // static obstacles
        if (sim.statics.length && sim.sdfGrid(cx, cy) < rc + 2 * h) {
          for (const st of sim.statics) {
            const d = sdfWorld(st, cx, cy);
            if (d < rc) { normalWorld(st, cx, cy, N2); resolve(A, null, cx - N2[0] * rc, cy - N2[1] * rc, N2[0], N2[1], rc - d, posPass); }
          }
        }
      }
      // other solids
      for (let b = 0; b < list.length; b++) {
        if (b === a) continue;
        const B = list[b];
        if (!B.active) continue;
        if (!B.kinematic && b < a) continue;        // each dynamic pair once
        const R = A.shape.bound + B.shape.bound;
        if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > R * R) continue;
        if (B.kinematic) {
          for (let k = 0; k < C.length; k += 3) {
            worldCircle(A, k, QA);
            const rc = C[k + 2], d = sdfWorld(B, QA[0], QA[1]);
            if (d < rc) { normalWorld(B, QA[0], QA[1], N2); resolve(A, B, QA[0] - N2[0] * rc, QA[1] - N2[1] * rc, N2[0], N2[1], rc - d, posPass); }
          }
          continue;
        }
        const D = B.circles;
        for (let k = 0; k < C.length; k += 3) {
          worldCircle(A, k, QA);
          for (let q = 0; q < D.length; q += 3) {
            worldCircle(B, q, QB);
            const dx = QA[0] - QB[0], dy = QA[1] - QB[1], rr = C[k + 2] + D[q + 2], d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 === 0) continue;
            const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
            resolve(A, B, QB[0] + nx * D[q + 2], QB[1] + ny * D[q + 2], nx, ny, rr - d, posPass);
          }
        }
      }
    }
  }
}

// ---- creation --------------------------------------------------------------------------------
// Objects are sized to be seen: a crate is about a tenth of the short side.
export function sceneScale(spec) { return Math.min(spec.W, spec.H) / 1.7; }

export function spawn(sim, spec, o) {
  const K = KINDS[o.kind] || KINDS.box;
  const S = sceneScale(spec) * (o.size || 1);
  const rng = mulberry(o.look || 1);
  const shape = K.shape(S, rng);
  const b = new Body(o.kind, shape, o.x, o.y, o.a || 0, o.density ?? K.density, sim.h);
  b.colour = o.colour || 0; b.look = o.look || 1;
  // Ballast: a keel weight puts the centre of gravity below the centroid,
  // so a boat or a buoy rights itself (KINDS[kind].ballast: fraction of
  // the distance from the centroid to the lowest sample; above 1 the
  // weight hangs below the hull, as a keel bulb does).
  if (K.ballast) { let lo = 0; for (let i = 1; i < b.samples.length; i += 2) lo = Math.min(lo, b.samples[i]); b.cgy = K.ballast * lo; }
  b.vx = o.vx || 0; b.vy = o.vy || 0; b.w = o.w || 0;
  return sim.addSolid(b);
}

// True when the body's collision circles overlap a wall, an obstacle or
// another solid.
function blocked(sim, b) {
  const h = sim.h, x0 = h, x1 = (sim.fNumX - 1) * h, y0 = h, y1 = (sim.fNumY - 1) * h, C = b.circles;
  for (let k = 0; k < C.length; k += 3) {
    worldCircle(b, k, QA);
    const x = QA[0], y = QA[1], r = C[k + 2];
    if (x - r < x0 || x + r > x1 || y - r < y0 || y + r > y1) return true;
    for (const st of sim.statics) if (sdfWorld(st, x, y) < r) return true;
    for (const s of sim.solids) if (s !== b && s.active && sdfWorld(s, x, y) < r) return true;
  }
  return false;
}

export function makeBodies(sim, spec) {
  sim.onCoupling = couple;
  sim.onSolidHit = hit;
  for (const o of spec.objects || []) {
    const b = spawn(sim, spec, o);
    // A scene object must not start inside a wall, an obstacle, the gate
    // or another body: search nearby places, else leave it out.
    const R = b.shape.bound, sx = b.x, sy = b.y;
    let ok = !blocked(sim, b);
    for (let k = 1; !ok && k <= 24; k++) {
      const ang = k * 2.39996, d = 0.25 * R * Math.sqrt(k);
      b.x = sx + d * Math.cos(ang); b.y = sy + Math.abs(d * Math.sin(ang));
      ok = !blocked(sim, b);
    }
    if (!ok) sim.removeSolid(b);
  }
}

// ---- randomizer category -------------------------------------------------------------------------
// The water surface height for a fraction x of the tank width (rough: the
// top of the water rects at x, else the bottom).
function surfaceAt(c, x) {
  let y = 0;
  for (const w of c.water) if (w.kind === 'rect' && x >= w.x0 && x <= w.x1) y = Math.max(y, w.y1);
  return y;
}

export function genObjects(r, c) {
  const W = c.W, H = c.H, S = Math.min(W, H) / 1.7, out = [];
  const mix = r.pick(['mixed', 'mixed', 'mixed', 'ducks', 'harbour', 'raft', 'rocks', 'ice', 'none']);
  const pools = {
    mixed: KIND_IDS,
    ducks: ['duck', 'duck', 'duck', 'ball', 'buoy'],
    harbour: ['boat', 'boat', 'buoy', 'log', 'duck'],
    raft: ['plank', 'plank', 'log', 'box'],
    rocks: ['rock', 'rock', 'box', 'duck', 'ice'],
    ice: ['ice', 'ice', 'ice', 'bottle', 'ball'],
  };
  const n = mix === 'none' ? 0 : r.int(3, 9);
  const pool = pools[mix] || KIND_IDS;
  const placed = [];
  for (let k = 0; k < n; k++) {
    const kind = r.pick(pool);
    const size = r.uni(0.8, 1.3);
    const R = 0.26 * S * size;
    let ok = false, x = 0, y = 0;
    for (let t = 0; t < 30 && !ok; t++) {
      x = r.uni(0.08, 0.92) * W;
      const surf = surfaceAt(c, x);
      y = Math.min(0.9 * H, Math.max(surf + R * 0.6 + r.uni(0, 0.25) * H, 0.1 * H));
      ok = placed.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > (p.R + R) ** 2);
    }
    if (!ok) continue;
    placed.push({ x, y, R });
    const K = KINDS[kind];
    out.push({ kind, x, y, a: r.uni(-0.6, 0.6), size, density: +(K.density * r.uni(0.9, 1.1)).toFixed(3), colour: r.int(0, 7), look: r.int(1, 1e6) });
  }
  c.objects = out; c.objectMix = mix;
}

// The harbour preset: a boat, ducks, a log and a buoy on the shallow water,
// in the path of the dam wave.
function harbourObjects(r, c) {
  const W = c.W, H = c.H, y = 0.16 * H;
  c.objects = [
    { kind: 'boat', x: 0.62 * W, y: y + 0.05 * H, a: 0, size: 1.2, density: 0.35, colour: 0, look: 11 },
    { kind: 'duck', x: 0.45 * W, y: y + 0.04 * H, a: 0, size: 1.1, density: 0.3, colour: 0, look: 3 },
    { kind: 'duck', x: 0.84 * W, y: y + 0.18 * H, a: 0.2, size: 1, density: 0.3, colour: 1, look: 4 },
    { kind: 'log', x: 0.53 * W, y: y + 0.25 * H, a: 0.3, size: 1, density: 0.65, colour: 0, look: 5 },
    { kind: 'buoy', x: 0.92 * W, y: y + 0.05 * H, a: 0, size: 1, density: 0.25, colour: 2, look: 6 },
    { kind: 'box', x: 0.16 * W, y: 0.9 * H, a: 0.4, size: 1, density: 0.6, colour: 3, look: 7 },
  ];
  c.objectMix = 'harbour';
}

// Register the category with the randomizer (scenes.js stays free of body code).
if (!GEN.objects) {
  GEN.objects = genObjects;
  PRESETS.harbour.objects = harbourObjects;
  if (!CATS.includes('objects')) CATS.push('objects');
}
export { hashStr };
