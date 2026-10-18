// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/solver.js — the fire model
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). This file is the CPU reference of the model.
//  The GPU engine (gpu.js, shaders in wgsl.js and glsl.js) runs the same
//  passes in the same order, with the same rules for each texel. The page
//  runs this file only when it has no GPU (and the node tests run it).
//
//  The ideas come from Matthias Müller's Ten Minute Physics #21 (MIT, the
//  original port is in upstream.js): a staggered grid, the buoyant lift
//  "v += (lift T - v) a dt", the fire / smoke cooling break at T = 0.3,
//  the burning ring and floor, and swirls. The solver below is new.
//
//  GRID. NX x NY cells of size h, cell (i, j) at k = j NX + i, row 0 at the
//  bottom. Each cell holds u (its left face), v (its bottom face) and T (its
//  centre), as a GPU texel holds them. The outer ring of cells is the
//  boundary: the bottom row is a wall, the sides and the top are open air
//  (pressure 0), so smoke leaves the box and fresh air comes in.
//
//  ONE STEP (dt = 1/60 s), each pass reads the output of the last one:
//    sources  (CPU) burner and floor masks -> src (T source, torch jet,
//             drag stir); swirls move and age; only a moved burner redraws
//    curl     w = dv/dx - du/dy at the cell centres
//    force    viscosity that grows with T (a hot core is laminar), the
//             upstream buoyant lift and gravity, vorticity confinement
//             weighted to the cooler plume (eps from "Turbulence"), the
//             swirls, the torch jet, the stir, a weak slow wobble at the
//             fuel, the side wind and the burning floor
//    project  divergence, then red-black SOR on p (warm start: p from the
//             last step), then u -= dp/dx, v -= dp/dy on the faces
//    advect   semi-Lagrangian velocity; T forward (MacCormack step 1)
//    maccormack  T back-and-forth correction with a min/max limiter,
//             then cooling, then T = max(T, source)
//
//  grep -n targets: "export function defaultCfg", "export function makeGrid",
//  "export function buildSources", "function passCurl", "function passForce",
//  "function passProject", "function passAdvect", "function passMac",
//  "export function step", "export function resample", "export function divergence"
// ============================================================================

export const BURNERS = ['ring', 'disc', 'log', 'torch'];
export const MAX_SWIRLS = 32;
export const H_REF = 0.004;         // v1 default cell (100k cells): sets burner line widths
export const FLOOR_H = 0.016;       // burning floor band (v1: 4 cells of H_REF)
export const FLAME_T = 0.3;         // cooling break (upstream)
export const SOR = 1.7;             // red-black overrelaxation
export const SPIN = 3.0;            // swirl spin-up rate, 1/s
export const VISC = 0.22;           // hot-core viscosity blend per step (max, at T >= 0.9)
export const EPS_MAX = 60.0;        // confinement eps at Turbulence 1 (eps = EPS_MAX tb^2)
export const WOBBLE = 0.036;        // fuel wobble, m/s per step at Turbulence 1
export const DRAG = 3.0;            // sideways drag of cold air, 1/s
export const PATH_N = 4;            // source samples along the step path
export const KAPPA = 0.1;           // edge mixing of T per step

// Defaults. The v1 (upstream) values are kept for lift, cooling, accel and
// torch. Swirls are fewer, slower and higher (v1: probability 50, 20 rad/s).
export function defaultCfg() {
  return { lift: 3.0, fireCooling: 1.8, smokeCooling: 0.3, accel: 6.0, torch: 2.5, wind: 0, gravity: 0, iters: 2, dt: 1 / 60,
    turbulence: 0.25, swirlProbability: 4, swirlMaxRadius: 0.05, swirlOmega: 6, swirlLife: 1.5, floor: false, burners: [] };
}
export function createSim() {
  return { f: null, cfg: defaultCfg(), W: 1.6, H: 1, frame: 0, t: 0, rand: Math.random, swirls: [], gpu: null, srcSig: '', srcBoxes: [] };
}

// cpu = false: only the source mask (the GPU holds the fields).
export function makeGrid(NX, NY, h, cpu = true) {
  const N = NX * NY, F = () => new Float32Array(cpu ? N : 0);
  return { NX, NY, h, numCells: N, numX: NX, numY: NY, cpu,
    u: F(), v: F(), t: F(), p: F(), w: F(), div: F(), u2: F(), v2: F(), t2: F(),
    src: new Float32Array(N * 4) };
}
// Interior sizes are multiples of MG_STEP so every multigrid level halves
// exactly; H = 1 m, W = NX h (close to the aspect).
export const MG_STEP = 16;
export function gridFor(cells, aspect) {
  const a = Math.max(0.5, aspect || 1.6), c = Math.max(1500, cells || 48000);
  const ny = Math.max(2, Math.round(Math.sqrt(c / a) / MG_STEP)) * MG_STEP, nx = Math.max(2, Math.round(ny * a / MG_STEP)) * MG_STEP;
  const NY = ny + 2, NX = nx + 2;
  return { NX, NY, h: 1 / NY };
}
// cfg = { cells, aspect, burners: [{ kind, x, y, r, motion, amp, freq, ph }] }
// (positions as fractions of the domain); rand: a seeded stream.
export function buildScene(S, sc, rand, opt = {}) {
  const g = gridFor(sc.cells, sc.aspect);
  S.rand = rand || Math.random;
  S.f = makeGrid(g.NX, g.NY, g.h, !opt.gpu);
  S.W = g.NX * g.h; S.H = g.NY * g.h; S.frame = 0; S.t = 0; S.swirls = []; S.srcSig = ''; S.srcBoxes = [];
  S.wob = [S.rand() * 6.283, S.rand() * 6.283];
  S.cfg.burners = (sc.burners || []).map(b => makeBurner(S, b));
  return S;
}
export function makeBurner(S, b) {
  const x = b.fx != null ? b.fx * S.W : b.x, y = b.fy != null ? b.fy * S.H : b.y;
  return { kind: b.kind || 'ring', x, y, x0: x, y0: y, r: b.r || 0.13, motion: b.motion || 'static', amp: b.amp ?? 0.2, freq: b.freq ?? 0.12, ph: b.ph || 0, on: b.on !== false, held: false, vx: 0, vy: 0 };
}
export function addBurner(S, b) { const o = makeBurner(S, b); S.cfg.burners.push(o); return o; }

// ---- shared small maths (the shaders copy these lines) ---------------------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// Confinement weight: none in the hot core (it is laminar), none in clean
// air, full in the cooling plume and the smoke.
export const confWeight = T => smooth(0.02, 0.1, T) * (1 - smooth(0.5, 0.85, T));
export const viscWeight = T => smooth(0.35, 0.9, T);

// Signed distance from (x, y) to the burner flame shape, metres (< 0 inside).
export function burnerSdf(b, x, y, h) {
  if (b.kind === 'ring') {
    const cy = b.y + 3 * H_REF, rm = (1.85 * b.r + H_REF) / 2, hw = Math.max((0.15 * b.r + H_REF) / 2, 0.6 * h);
    return Math.abs(Math.hypot(x - b.x, y - cy) - rm) - hw;
  }
  if (b.kind === 'disc') return Math.hypot(x - b.x, y - b.y) - b.r * Math.SQRT1_2;
  if (b.kind === 'log') {
    const qx = Math.abs(x - b.x) - 1.3 * b.r, qy = Math.abs(y - b.y) - Math.max(2.5 * H_REF, 0.12 * b.r, 0.8 * h);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  }
  return Math.hypot(x - b.x, y - b.y) - Math.max(2.2 * H_REF, 0.35 * b.r, 0.8 * h);   // torch
}
const edgeOf = h => Math.max(0.8 * h, 0.004);
export function burnerReach(b) { return (b.kind === 'log' ? 1.35 : 1.05) * b.r + 3 * H_REF + 0.02; }
// The source value of burner b at a point: 1 inside, a smooth falloff
// over one edge width outside.
export const burnerSource = (b, x, y, h) => { const e = edgeOf(h), d = burnerSdf(b, x, y, h); return smooth(e, -e, d); };
// Does burner b light cell (i, j)? (tests, the old renderer API)
export function burnCell(f, b, i, j) { return burnerSource(b, (i + 0.5) * f.h, (j + 0.5) * f.h, f.h) > 0.5; }

// ---- sources (CPU, both engines) -------------------------------------------
// src per cell: [T source, torch jet v, stir du, stir dv]. Redraws only when
// a burner, the floor or the torch value changed; returns the dirty rect
// { i0, j0, i1, j1 } (inclusive) or null.
export function buildSources(S) {
  const f = S.f, C = S.cfg, NX = f.NX, NY = f.NY, h = f.h, src = f.src;
  let sig = (C.floor ? 'F' : 'f') + C.torch;
  for (const b of C.burners) sig += `|${b.kind}${b.on ? 1 : 0},${b.x.toFixed(5)},${b.y.toFixed(5)},${b.r},${b.vx.toFixed(3)},${b.vy.toFixed(3)}`;
  if (sig === S.srcSig) return null;
  S.srcSig = sig;
  const boxes = [];
  for (const b of C.burners) {
    const R = burnerReach(b) + edgeOf(h);
    boxes.push({ i0: clamp(Math.floor((b.x - R) / h), 0, NX - 1), i1: clamp(Math.ceil((b.x + R) / h), 0, NX - 1),
      j0: clamp(Math.floor((b.y - R) / h), 0, NY - 1), j1: clamp(Math.ceil((b.y + R + 3 * H_REF) / h), 0, NY - 1), b });
  }
  const floorRows = Math.min(NY - 1, Math.ceil((FLOOR_H + edgeOf(h)) / h) + 1);
  boxes.push({ i0: 0, i1: NX - 1, j0: 0, j1: floorRows, b: null });   // the floor band (on or off)
  const dirty = boxes.concat(S.srcBoxes);
  for (const q of S.srcBoxes) for (let j = q.j0; j <= q.j1; j++) src.fill(0, (j * NX + q.i0) * 4, (j * NX + q.i1 + 1) * 4);
  for (const q of boxes) for (let j = q.j0; j <= q.j1; j++) src.fill(0, (j * NX + q.i0) * 4, (j * NX + q.i1 + 1) * 4);
  for (const q of boxes) {
    const b = q.b;
    for (let j = q.j0; j <= q.j1; j++) for (let i = q.i0; i <= q.i1; i++) {
      const x = (i + 0.5) * h, y = (j + 0.5) * h, o = (j * NX + i) * 4;
      if (!b) { if (C.floor) src[o] = Math.max(src[o], smooth(FLOOR_H + edgeOf(h), FLOOR_H - edgeOf(h), y)); continue; }
      const s = b.on ? burnerSource(b, x, y, h) : 0;
      if (s > src[o]) src[o] = s;
      if (b.kind === 'torch' && b.on) src[o + 1] = Math.max(src[o + 1], C.torch * s);
      // the upstream drag stir: 0.2 of the burner velocity in its disc
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 1e-6 && sp < 40) {
        const m = smooth(b.r + edgeOf(h), b.r - edgeOf(h), Math.hypot(x - b.x, y - b.y));
        src[o + 2] += 0.2 * b.vx * m; src[o + 3] += 0.2 * b.vy * m;
      }
    }
  }
  S.srcBoxes = boxes.filter(q => q.b);
  let i0 = NX, j0 = NY, i1 = -1, j1 = -1;
  for (const q of dirty) { i0 = Math.min(i0, q.i0); j0 = Math.min(j0, q.j0); i1 = Math.max(i1, q.i1); j1 = Math.max(j1, q.j1); }
  return i1 < 0 ? null : { i0, j0, i1, j1 };
}

function moveBurners(S, dt) {
  const t = S.t;
  for (const b of S.cfg.burners) {
    const px = b.x, py = b.y;
    if (!b.held) {
      const w = 2 * Math.PI * b.freq;
      if (b.motion === 'orbit') { b.x = b.x0 + b.amp * Math.sin(w * t + b.ph); b.y = b.y0 + b.amp * 0.4 * Math.sin(2 * w * t + b.ph); }
      else if (b.motion === 'sweep') b.x = b.x0 + b.amp * Math.sin(w * t + b.ph);
      else if (b.motion === 'bob') b.y = b.y0 + b.amp * 0.5 * Math.sin(w * t + b.ph);
      b.x = clamp(b.x, 0.02, S.W - 0.02); b.y = clamp(b.y, 0.02, S.H - 0.02);
    }
    b.vx = dt > 0 ? (b.x - px) / dt : 0; b.vy = dt > 0 ? (b.y - py) / dt : 0;
  }
}

// Swirls: a few soft vortices born above each lit burner (where the flame
// tip is), not in the core. They rise with the plume, drift with the wind,
// and their spin fades in and out over their life. Kinematic on the CPU (no
// GPU readback); both engines get the same list.
function updateSwirls(S, dt) {
  const C = S.cfg, rand = S.rand, out = [];
  for (const s of S.swirls) {
    s.age += dt;
    s.y += dt * 0.45 * C.lift; s.x += dt * 0.5 * C.wind;
    if (s.age < s.life && s.y < S.H && s.x > 0 && s.x < S.W) out.push(s);
  }
  const rate = C.swirlProbability / 10;   // swirls per second per burner
  for (const b of C.burners) {
    if (!b.on || out.length >= MAX_SWIRLS) continue;
    if (rand() < rate * dt) out.push({ x: b.x + (rand() - 0.5) * 1.2 * b.r, y: b.y + b.r * (1.2 + 1.5 * rand()), om: (2 * rand() - 1) * C.swirlOmega, R: C.swirlMaxRadius, age: 0, life: C.swirlLife });
  }
  S.swirls = out;
  for (const s of out) s.w = s.om * Math.sin(Math.PI * clamp(s.age / s.life, 0, 1));
}

// Per-step uniforms shared by both engines.
export function stepUniforms(S, dt) {
  const C = S.cfg, tb = Math.max(0, C.turbulence);
  const a = 2 * Math.PI * 0.6 * S.t + S.wob[0], b = 2 * Math.PI * 1.7 * S.t + S.wob[1];
  return { dt, h: S.f.h, NX: S.f.NX, NY: S.f.NY, lift: C.lift, accel: Math.min(1, C.accel * dt), gravity: C.gravity,
    eps: (C.epsMax ?? EPS_MAX) * tb * tb, visc: VISC, drag: Math.min(1, (C.drag ?? DRAG) * dt), wind: C.wind, floorH: C.floor ? FLOOR_H : -1,
    pertX: (C.wobble ?? WOBBLE) * tb * (Math.sin(a) + 0.5 * Math.sin(b)), pertY: 0.4 * (C.wobble ?? WOBBLE) * tb * Math.sin(1.3 * a),
    kappa: C.kappa ?? KAPPA, fireCool: C.fireCooling * dt, smokeCool: C.smokeCooling * dt, iters: Math.max(1, C.iters | 0), sor: SOR };
}

// ---- the CPU passes --------------------------------------------------------
// Border rules (input field of the pass): u is 0 on the bottom row, copies
// the row below on the top row and the cell to the right on the left
// column; v is 0 on rows 0 and 1, copies the next column in on the sides;
// T is 0 on the border.
const uAct = (i, j, NX, NY) => i >= 1 && j >= 1 && j <= NY - 2;
const vAct = (i, j, NX, NY) => i >= 1 && i <= NX - 2 && j >= 2;
function borderU(U, i, j, NX, NY) { if (j === 0) return 0; if (j === NY - 1) return U[(NY - 2) * NX + i]; return U[j * NX + 1]; }
function borderV(V, i, j, NX) { if (j <= 1) return 0; return V[j * NX + (i === 0 ? 1 : NX - 2)]; }

function sample(F, NX, NY, h, x, y, ox, oy) {
  const gx = clamp(x / h - ox, 0, NX - 1.001), gy = clamp(y / h - oy, 0, NY - 1.001);
  const i0 = Math.floor(gx), j0 = Math.floor(gy), tx = gx - i0, ty = gy - j0, k = j0 * NX + i0;
  return (1 - tx) * (1 - ty) * F[k] + tx * (1 - ty) * F[k + 1] + (1 - tx) * ty * F[k + NX] + tx * ty * F[k + NX + 1];
}

// bilinear T source (src channel 0) at a point
function sampleSrc(src, NX, NY, h, x, y) {
  const gx = clamp(x / h - 0.5, 0, NX - 1.001), gy = clamp(y / h - 0.5, 0, NY - 1.001);
  const i0 = Math.floor(gx), j0 = Math.floor(gy), tx = gx - i0, ty = gy - j0, k = (j0 * NX + i0) * 4, r = NX * 4;
  return (1 - tx) * (1 - ty) * src[k] + tx * (1 - ty) * src[k + 4] + (1 - tx) * ty * src[k + r] + tx * ty * src[k + r + 4];
}

function passCurl(f) {
  const { NX, NY, h, u: U, v: V, w: W } = f, s = 0.25 / h;
  W.fill(0);
  for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
    const k = j * NX + i;
    // centre velocities of the 4 neighbours: vc = (v_k + v_k+NX) / 2, uc = (u_k + u_k+1) / 2
    const vr = V[k + 1] + V[k + 1 + NX], vl = V[k - 1] + V[k - 1 + NX];
    const ut = U[k + NX] + U[k + NX + 1], ub = U[k - NX] + U[k - NX + 1];
    W[k] = ((vr - vl) - (ut - ub)) * s;
  }
}
function confAt(f, ci, cj, eps) {
  const { NX, NY, h, w: W, t: T } = f;
  if (ci < 1 || cj < 1 || ci > NX - 2 || cj > NY - 2) return null;
  const k = cj * NX + ci, wc = W[k], wt = confWeight(T[k]);
  if (!(wt > 0) || wc === 0) return null;
  const gx = (Math.abs(W[k + 1]) - Math.abs(W[k - 1])) * 0.5 / h, gy = (Math.abs(W[k + NX]) - Math.abs(W[k - NX])) * 0.5 / h;
  const len = Math.hypot(gx, gy) + 1e-5, s = eps * h * wt * wc;
  return [s * gy / len, -s * gx / len];
}
function passForce(S, P) {
  const f = S.f, { NX, NY, h, u: U, v: V, t: T, src, u2: U2, v2: V2, t2: T2 } = f, dt = P.dt;
  const SW = S.swirls;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = i * h, y = j * h, xc = x + 0.5 * h, yc = y + 0.5 * h;
    T2[k] = T[k];
    // u at the left face (x, yc)
    if (uAct(i, j, NX, NY)) {
      let u = U[k];
      const Tu = 0.5 * (T[k - 1] + T[k]), a = P.visc * viscWeight(Tu);
      if (a > 0) { const ur = U[j * NX + Math.min(i + 1, NX - 1)]; u += a * (0.25 * (U[k - 1] + ur + U[k - NX] + U[k + NX]) - u); }
      const c0 = confAt(f, i - 1, j, P.eps), c1 = confAt(f, i, j, P.eps);
      u += dt * 0.5 * ((c0 ? c0[0] : 0) + (c1 ? c1[0] : 0));
      const sr = 0.5 * (src[(k - 1) * 4] + src[k * 4]);
      u += 0.5 * (src[(k - 1) * 4 + 2] + src[k * 4 + 2]) + P.pertX * sr;
      for (let q = 0; q < SW.length; q++) { const s = SW[q], rx = x - s.x, ry = yc - s.y, r2 = rx * rx + ry * ry, R2 = s.R * s.R; if (r2 < R2) { const m = 1 - r2 / R2; u += dt * SPIN * m * m * ry * s.w; } }
      // still room air: cold air sheds sideways motion at the drag rate,
      // so the box has no mean cross flow (the plume does not lean)
      u -= u * P.drag * (1 - smooth(0.0, 0.1, Tu));
      if (yc < P.floorH) u = 0;
      // the side wind comes in on the upwind wall (upstream: the left wall)
      if ((i === 1 && P.wind > 0) || (i === NX - 1 && P.wind < 0)) u += (P.wind - u) * 0.2;
      U2[k] = u;
    } else U2[k] = borderU(U, i, j, NX, NY);
    // v at the bottom face (xc, y)
    if (vAct(i, j, NX, NY)) {
      let v = V[k];
      const Tv = 0.5 * (T[k - NX] + T[k]), a = P.visc * viscWeight(Tv);
      if (a > 0) { const vt = V[Math.min(j + 1, NY - 1) * NX + i]; v += a * (0.25 * (V[k - 1] + V[k + 1] + V[k - NX] + vt) - v); }
      v += (P.lift * Tv - v) * P.accel + P.gravity * dt;
      const c0 = confAt(f, i, j - 1, P.eps), c1 = confAt(f, i, j, P.eps);
      v += dt * 0.5 * ((c0 ? c0[1] : 0) + (c1 ? c1[1] : 0));
      const sr = 0.5 * (src[(k - NX) * 4] + src[k * 4]);
      v += 0.5 * (src[(k - NX) * 4 + 3] + src[k * 4 + 3]) + P.pertY * sr;
      const jet = Math.max(src[(k - NX) * 4 + 1], src[k * 4 + 1]);
      if (jet > 0) v = Math.max(v, jet);
      for (let q = 0; q < SW.length; q++) { const s = SW[q], rx = xc - s.x, ry = y - s.y, r2 = rx * rx + ry * ry, R2 = s.R * s.R; if (r2 < R2) { const m = 1 - r2 / R2; v -= dt * SPIN * m * m * rx * s.w; } }
      if (y < P.floorH) v = 0;
      V2[k] = v;
    } else V2[k] = borderV(V, i, j, NX);
  }
  swap(f, 'u', 'u2'); swap(f, 'v', 'v2'); swap(f, 't', 't2');
}
function swap(f, a, b) { const x = f[a]; f[a] = f[b]; f[b] = x; }

export function computeDiv(f, out = f.div) {
  const { NX, NY, u: U, v: V } = f;
  out.fill(0);
  for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) { const k = j * NX + i; out[k] = U[k + 1] - U[k] + V[k + NX] - V[k]; }
  return out;
}
// ---- pressure: a geometric multigrid V-cycle -------------------------------
// Each level is a (W x H) grid with a border ring like the fine grid: p and
// f (right side) per cell. The operator is A p = sum(p_nb) - n p = f, with
// p = 0 on the side and top border (open air) and no bottom neighbour on
// row 1 (the wall, n = 3). Level 0 is the fine grid (f = divergence).
//   smooth    red-black Gauss-Seidel, one colour per pass
//   restrict  coarse f = sum of the 4 child residuals (x 4 / count at an
//             odd edge), coarse p = 0
//   prolong   bilinear (9/16, 3/16, 3/16, 1/16) correction to the fine p
// One V-cycle: 1 sweep down, MG_COARSE sweeps on the coarsest level, 1
// sweep up. "Pressure cycles" sets the number of V-cycles per step; p is
// warm-started from the last step.
export const MG_LEVELS = 5, MG_COARSE = 4, MG_OMEGA = 1.0, MG_OMEGA_COARSE = 1.6;
export function mgSizes(NX, NY) {
  const L = [{ W: NX, H: NY }];
  while (L.length < MG_LEVELS) {
    const q = L[L.length - 1], nx = (q.W - 1) >> 1, ny = (q.H - 1) >> 1;   // ceil((W - 2) / 2)
    if (Math.min(nx, ny) < 4) break;
    L.push({ W: nx + 2, H: ny + 2 });
  }
  return L;
}
// gc: ghost coefficient on the open sides and top (ghost = gc * p)
function mgSmooth(Pp, F, W, H, c, w, gc = 0) {
  for (let j = 1; j < H - 1; j++) for (let i = 1 + ((j + c + 1) & 1); i < W - 1; i += 2) {
    const k = j * W + i, m = (i === 1) + (i === W - 2) + (j === H - 2), n = (j === 1 ? 3 : 4) - gc * m;
    const sum = Pp[k - 1] + Pp[k + 1] + Pp[k + W] + (j > 1 ? Pp[k - W] : 0);
    Pp[k] = (1 - w) * Pp[k] + w * (sum - F[k]) / n;
  }
}
function mgResidual(Pp, F, W, H, i, j, gc = 0) {
  const k = j * W + i, m = (i === 1) + (i === W - 2) + (j === H - 2), n = (j === 1 ? 3 : 4) - gc * m;
  return F[k] - (Pp[k - 1] + Pp[k + 1] + Pp[k + W] + (j > 1 ? Pp[k - W] : 0) - n * Pp[k]);
}
function mgRestrict(a, b) {
  b.p.fill(0); b.f.fill(0);
  for (let J = 1; J < b.H - 1; J++) for (let I = 1; I < b.W - 1; I++) {
    let s = 0, c = 0;
    for (let y = 2 * J - 1; y <= 2 * J; y++) for (let x = 2 * I - 1; x <= 2 * I; x++) if (x <= a.W - 2 && y <= a.H - 2) { s += mgResidual(a.p, a.f, a.W, a.H, x, y, a.gc); c++; }
    b.f[J * b.W + I] = c ? s * 4 / c : 0;
  }
}
function mgProlong(b, a) {
  // ghost values: 0 on the open sides and top, the row above on the wall
  const e = b.p;
  for (let y = 1; y < a.H - 1; y++) for (let x = 1; x < a.W - 1; x++) {
    const I = (x + 1) >> 1, J = (y + 1) >> 1;
    const I2 = x & 1 ? I - 1 : I + 1, J2r = y & 1 ? J - 1 : J + 1, J2 = J2r === 0 ? 1 : J2r;
    a.p[y * a.W + x] += 0.5625 * e[J * b.W + I] + 0.1875 * (e[J * b.W + I2] + e[J2 * b.W + I]) + 0.0625 * e[J2 * b.W + I2];
  }
}
function mgCycle(L) {
  const n = L.length;
  for (let l = 0; l < n - 1; l++) { mgSmooth(L[l].p, L[l].f, L[l].W, L[l].H, 0, MG_OMEGA, L[l].gc); mgSmooth(L[l].p, L[l].f, L[l].W, L[l].H, 1, MG_OMEGA, L[l].gc); mgRestrict(L[l], L[l + 1]); }
  const c = L[n - 1];
  for (let k = 0; k < MG_COARSE; k++) { mgSmooth(c.p, c.f, c.W, c.H, 0, MG_OMEGA_COARSE, c.gc); mgSmooth(c.p, c.f, c.W, c.H, 1, MG_OMEGA_COARSE, c.gc); }
  for (let l = n - 2; l >= 0; l--) { mgProlong(L[l + 1], L[l]); mgSmooth(L[l].p, L[l].f, L[l].W, L[l].H, 0, MG_OMEGA, L[l].gc); mgSmooth(L[l].p, L[l].f, L[l].W, L[l].H, 1, MG_OMEGA, L[l].gc); }
}
// Ghost coefficient of level l on the open sides and top: the zero of p
// sits 0.5 + 2^-(l+1) cells out (level 0: on the border cell centre).
export const mgGhost = l => 1 - 1 / (0.5 + Math.pow(2, -(l + 1)));
function mgFor(f) {
  if (!f.mg) f.mg = mgSizes(f.NX, f.NY).map((q, l) => (l ? { W: q.W, H: q.H, gc: mgGhost(l), p: new Float32Array(q.W * q.H), f: new Float32Array(q.W * q.H) } : null));
  f.mg[0] = { W: f.NX, H: f.NY, gc: 0, p: f.p, f: f.div };
  return f.mg;
}
function passProject(f, P) {
  const { NX, NY, u: U, v: V, p } = f;
  computeDiv(f);
  const L = mgFor(f);
  for (let it = 0; it < P.iters; it++) mgCycle(L);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    if (uAct(i, j, NX, NY)) U[k] -= (i <= NX - 2 ? p[k] : 0) - (i >= 2 ? p[k - 1] : 0);
    if (vAct(i, j, NX, NY)) V[k] -= (j <= NY - 2 ? p[k] : 0) - p[k - NX];
  }
}
function passAdvect(f, P) {
  const { NX, NY, h, u: U, v: V, t: T, u2: U2, v2: V2, t2: T2 } = f, dt = P.dt;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    if (uAct(i, j, NX, NY)) {
      const vb = 0.25 * (V[k - 1] + V[k] + V[k - 1 + NX] + V[k + NX]);
      U2[k] = sample(U, NX, NY, h, i * h - dt * U[k], (j + 0.5) * h - dt * vb, 0, 0.5);
    } else U2[k] = borderU(U, i, j, NX, NY);
    if (vAct(i, j, NX, NY)) {
      const ub = 0.25 * (U[k - NX] + U[k] + U[k - NX + 1] + U[k + 1]);
      V2[k] = sample(V, NX, NY, h, (i + 0.5) * h - dt * ub, j * h - dt * V[k], 0.5, 0);
    } else V2[k] = borderV(V, i, j, NX);
    if (i >= 1 && j >= 1 && i <= NX - 2 && j <= NY - 2) {
      const uc = 0.5 * (U[k] + U[k + 1]), vc = 0.5 * (V[k] + V[k + NX]);
      T2[k] = sample(T, NX, NY, h, (i + 0.5) * h - dt * uc, (j + 0.5) * h - dt * vc, 0.5, 0.5);
    } else T2[k] = 0;
  }
  // keep A (U, V, T) for the MacCormack pass: the new velocity goes to u/v
  // after it; T2 holds T_hat.
}
function passMac(f, P) {
  const { NX, NY, h, u: U, v: V, t: T, t2: TH, src } = f, dt = P.dt;
  const out = f.w;   // curl is free now: use it as the T output
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    if (!(i >= 1 && j >= 1 && i <= NX - 2 && j <= NY - 2)) { out[k] = 0; continue; }
    const uc = 0.5 * (U[k] + U[k + 1]), vc = 0.5 * (V[k] + V[k + NX]);
    const xc = (i + 0.5) * h, yc = (j + 0.5) * h;
    const back = sample(TH, NX, NY, h, xc + dt * uc, yc + dt * vc, 0.5, 0.5);
    let tn = TH[k] + 0.5 * (T[k] - back);
    // limiter: the 4 source cells of the backtrace
    const gx = clamp((xc - dt * uc) / h - 0.5, 0, NX - 1.001), gy = clamp((yc - dt * vc) / h - 0.5, 0, NY - 1.001);
    const q = Math.floor(gy) * NX + Math.floor(gx);
    const lo = Math.min(T[q], T[q + 1], T[q + NX], T[q + NX + 1]), hi = Math.max(T[q], T[q + 1], T[q + NX], T[q + NX + 1]);
    tn = clamp(tn, lo, hi);
    // mixing at the flame edge: a little heat spreads to the neighbours, so
    // the flame thins to a tip as it rises
    if (P.kappa > 0) tn += P.kappa * (0.25 * (T[k - 1] + T[k + 1] + T[k - NX] + T[k + NX]) - T[k]);
    tn = Math.max(0, tn - (tn < FLAME_T ? P.smokeCool : P.fireCool));
    // the source along the path of this step: the gas moves up to 8 cells
    // per step, so a thin burner stamped once per step leaves stripes
    let sp = src[k * 4];
    for (let a = 1; a <= PATH_N; a++) { const s = a / PATH_N; sp = Math.max(sp, sampleSrc(src, NX, NY, h, xc - s * dt * uc, yc - s * dt * vc)); }
    out[k] = Math.max(tn, sp);
  }
  f.w = f.t; f.t = out;
}

export function step(S, dt = S.cfg.dt) {
  S.t += dt;
  moveBurners(S, dt);
  updateSwirls(S, dt);
  const dirty = buildSources(S);
  const P = stepUniforms(S, dt);
  if (S.gpu) S.gpu.step(S, P, dirty);
  else {
    const f = S.f;
    passCurl(f);
    passForce(S, P);
    passProject(f, P);
    passAdvect(f, P);                          // u2, v2 = new velocity, t2 = T_hat
    passMac(f, P);                             // reads u, v, t (A) and t2; t = new T
    swap(f, 'u', 'u2'); swap(f, 'v', 'v2');
  }
  S.frame++;
}

// Divergence of the current field, per interior cell (after a step it is
// the residual of the pressure solve plus what advection added).
export function divergence(S) { const f = S.f; return computeDiv(f, new Float32Array(f.numCells)); }
// Residual of the projection alone: force pass, project, then the divergence.
export function projectionResidual(S) {
  const P = stepUniforms(S, S.cfg.dt), f = S.f;
  passCurl(f); passForce(S, P);
  const before = computeDiv(f, new Float32Array(f.numCells));
  passProject(f, P);
  const after = computeDiv(f, new Float32Array(f.numCells));
  const rms = a => { let s = 0, n = 0; for (let j = 1; j < f.NY - 1; j++) for (let i = 1; i < f.NX - 1; i++) { s += a[j * f.NX + i] ** 2; n++; } return Math.sqrt(s / n); };
  let mx = 0; for (const x of after) mx = Math.max(mx, Math.abs(x));
  return { before: rms(before), after: rms(after), max: mx };
}

// Resample the CPU fields to a new cell count (the frame governor). The
// pressure starts at 0; burners keep their place in metres.
export function resample(S, cells, aspect, opt = {}) {
  const g = gridFor(cells, aspect || S.W / S.H), o = S.f;
  const n = makeGrid(g.NX, g.NY, g.h, !opt.gpu && o.cpu);
  if (o.cpu && n.cpu) {
    for (let j = 0; j < n.NY; j++) for (let i = 0; i < n.NX; i++) {
      const k = j * n.NX + i, h = n.h;
      n.u[k] = sample(o.u, o.NX, o.NY, o.h, i * h, (j + 0.5) * h, 0, 0.5);
      n.v[k] = sample(o.v, o.NX, o.NY, o.h, (i + 0.5) * h, j * h, 0.5, 0);
      n.t[k] = i && j && i < n.NX - 1 && j < n.NY - 1 ? sample(o.t, o.NX, o.NY, o.h, (i + 0.5) * h, (j + 0.5) * h, 0.5, 0.5) : 0;
    }
  }
  S.f = n; S.W = n.NX * n.h; S.H = n.NY * n.h; S.srcSig = ''; S.srcBoxes = [];
  for (const b of S.cfg.burners) { b.x = clamp(b.x, 0.02, S.W - 0.02); b.y = clamp(b.y, 0.02, S.H - 0.02); }
  return S;
}

export function health(S) {
  const f = S.f; let bad = 0, vmax = 0, tsum = 0;
  if (!f.cpu) return { bad: 0, vmax: 0, heat: 0, gpu: true };
  for (let k = 0; k < f.numCells; k++) { const a = f.u[k] + f.v[k] + f.t[k]; if (!Number.isFinite(a)) bad++; else { vmax = Math.max(vmax, Math.abs(f.u[k]), Math.abs(f.v[k])); tsum += f.t[k]; } }
  return { bad, vmax, heat: tsum / f.numCells };
}
