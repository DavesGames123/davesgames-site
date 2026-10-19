// ============================================================================
//  POOL PHYSICS  ·  core/physics.js — balls on cloth, in 3D spin
// ----------------------------------------------------------------------------
//  Each ball has a position (x, y) on the cloth, a velocity (vx, vy) and an
//  angular velocity (wx, wy, wz). The contact point with the cloth moves at
//      u = v + w x (-R z)  =  (vx - R wy, vy + R wx)
//  SLIDING (u != 0): the cloth friction  F = -mu_s m g u^  acts at the
//      contact point. u keeps its direction and shrinks at 7/2 mu_s g, so
//      a ball struck at the centre rolls after t = 2 v0 / (7 mu_s g).
//  ROLLING (u = 0): v = R (w x z), and the rolling resistance takes
//      mu_r g off the speed each second.
//  SPIN (wz): the cloth takes 5 mu_sp g / (2R) off it each second.
//  BALL-BALL: an impulse along the line of centres with restitution e_b,
//      and a Coulomb friction impulse (mu_b) on the slip at the contact
//      point. The friction gives "throw" (the object ball leaves a few
//      degrees off the line of centres) and swaps a little spin.
//  CUSHION: the nose touches the ball above its equator (63.5 % of the ball
//      height), so the contact normal points down into the ball. The
//      impulse has a restitution e_c on the normal speed and a friction
//      mu_c on the slip at that raised contact point. The table takes the
//      vertical part. Side spin and top spin thus change the rebound.
//  POCKETS: a ball falls when its centre is over the hole.
//
//  The integrator is a fixed tick h (2 ms). In a tick: half the friction,
//  then a time-of-impact loop (straight lines, each collision at its exact
//  time), then the other half of the friction (Strang splitting). The
//  slide-to-roll change happens at its exact time inside a tick. Same
//  input, same output: no clock, no random numbers in here.
//
//  References: W. Leckie and M. Greenspan, "An event-based pool physics
//  simulator" (2005); D. Alciatore, technical proofs TP A.4, A.14 (throw),
//  B.1 (rolling and sliding); R. Mathavan et al. (2010) for the cushion.
//
//  grep -n targets: "export const PHYS", "export function createState",
//  "export function strike", "export function tick", "function frictionBall",
//  "function ballBall", "function cushion", "export function simulate",
//  "export function ballState"
// ============================================================================

export const PHYS = {
  g: 9.81,
  muS: 0.2,     // sliding friction ball-cloth
  muR: 0.01,    // rolling resistance
  muSp: 0.044,  // spinning friction (z spin)
  eB: 0.95,     // ball-ball restitution
  muB: 0.06,    // ball-ball friction (throw)
  eC: 0.8,      // cushion restitution
  muC: 0.14,    // cushion friction
  h: 0.002,     // tick, s
};

const N = 16;
const EPS = 1e-7;

// T: the table (core/table.js buildTable). One slot per ball number 0-15.
export function createState(T, P = PHYS) {
  const S = {
    T, P, R: T.R, n: N, t: 0,
    x: new Float64Array(N), y: new Float64Array(N),
    vx: new Float64Array(N), vy: new Float64Array(N),
    wx: new Float64Array(N), wy: new Float64Array(N), wz: new Float64Array(N),
    on: new Uint8Array(N),            // 1 on the table
    pot: new Int8Array(N).fill(-1),   // pocket id when potted (-2 off the table)
    q: null,                          // orientations [w,x,y,z] per ball (display)
    // rule facts of the current shot
    first: -1, firstT: -1, railAfter: false, cueRails: 0, railMask: 0, onMask0: 0, potted: [], hits: 0,
    // logs (only when S.log is true)
    log: false, events: [], paths: null, pathDt: 0.01, _pathT: null,
    stopAtFirst: false, stopped: false,
  };
  return S;
}

export function enableOrientation(S) {
  S.q = new Float64Array(4 * N);
  for (let i = 0; i < N; i++) S.q[4 * i] = 1;
  return S;
}

// A copy with the same object shape (one hidden class keeps the hot loops fast).
export function clone(S) {
  const C = createState(S.T, S.P);
  for (const k of ['x', 'y', 'vx', 'vy', 'wx', 'wy', 'wz', 'on', 'pot']) C[k].set(S[k]);
  C.t = S.t; C.first = S.first; C.firstT = S.firstT; C.railAfter = S.railAfter; C.cueRails = S.cueRails; C.railMask = S.railMask; C.onMask0 = S.onMask0;
  C.potted = S.potted.slice(); C.hits = S.hits;
  return C;
}

// Start a shot: clear the rule facts and the logs.
export function beginShot(S, { log = false } = {}) {
  S.first = -1; S.firstT = -1; S.railAfter = false; S.cueRails = 0; S.railMask = 0; S.potted = []; S.hits = 0; S.t = 0; S.stopped = false;
  S.onMask0 = 0; for (let i = 0; i < N; i++) if (S.on[i]) S.onMask0 |= 1 << i;
  S.log = log; S.events = [];
  if (log) {
    S.paths = [];
    S._pathT = new Float64Array(N).fill(-1);
    for (let i = 0; i < N; i++) S.paths.push(S.on[i] ? [S.x[i], S.y[i], 0] : []);
  } else S.paths = null;
}

// The cue: aim angle phi, cue ball speed v (m/s), tip offset a (right +)
// and b (top +) as fractions of R. A level cue. The impulse through the
// point (a, b) gives  w = 5 v / (2 R) * (-b dy, b dx, a).
export const MAX_TIP = 0.5;
export function strike(S, i, { phi, v, a = 0, b = 0 }) {
  const r = Math.hypot(a, b);
  if (r > MAX_TIP) { a *= MAX_TIP / r; b *= MAX_TIP / r; }
  const dx = Math.cos(phi), dy = Math.sin(phi), k = 5 * v / (2 * S.R);
  S.vx[i] = v * dx; S.vy[i] = v * dy;
  S.wx[i] = -k * b * dy; S.wy[i] = k * b * dx; S.wz[i] = k * a;
  if (S.log) S.events.push({ type: 'strike', t: S.t, i, x: S.x[i], y: S.y[i], vx: S.vx[i], vy: S.vy[i], wx: S.wx[i], wy: S.wy[i], wz: S.wz[i], a, b, v, phi });
}

// The motion state of a ball: 'rest', 'slide', 'roll' or 'spin' (z spin only).
export function ballState(S, i) {
  if (!S.on[i]) return 'off';
  const R = S.R, ux = S.vx[i] - R * S.wy[i], uy = S.vy[i] + R * S.wx[i];
  const v = Math.hypot(S.vx[i], S.vy[i]);
  if (Math.hypot(ux, uy) > 1e-5) return 'slide';
  if (v > 1e-6) return 'roll';
  return Math.abs(S.wz[i]) > 0.05 ? 'spin' : 'rest';
}

// The acceleration of a ball now (m/s^2), from the cloth.
export function accel(S, i) {
  const st = ballState(S, i), g = S.P.g;
  if (st === 'slide') {
    const R = S.R, ux = S.vx[i] - R * S.wy[i], uy = S.vy[i] + R * S.wx[i], u = Math.hypot(ux, uy);
    return { ax: -S.P.muS * g * ux / u, ay: -S.P.muS * g * uy / u, st };
  }
  if (st === 'roll') {
    const v = Math.hypot(S.vx[i], S.vy[i]);
    return { ax: -S.P.muR * g * S.vx[i] / v, ay: -S.P.muR * g * S.vy[i] / v, st };
  }
  return { ax: 0, ay: 0, st };
}

const moving = (S, i) => {
  if (!S.on[i]) return false;
  if (S.vx[i] !== 0 || S.vy[i] !== 0) return true;
  return Math.abs(S.wx[i]) > EPS || Math.abs(S.wy[i]) > EPS;
};
export function anyMoving(S) {
  for (let i = 0; i < N; i++) if (moving(S, i)) return true;
  return false;
}

// ── cloth friction over dt, exact for constant forces ──────────────────────
function frictionBall(S, i, dt) {
  const P = S.P, R = S.R, g = P.g;
  if (S.wz[i] !== 0) {
    const dz = 2.5 * P.muSp * g / R * dt;
    S.wz[i] = Math.abs(S.wz[i]) <= dz ? 0 : S.wz[i] - Math.sign(S.wz[i]) * dz;
  }
  if (!moving(S, i)) return;
  let vx = S.vx[i], vy = S.vy[i], wx = S.wx[i], wy = S.wy[i];
  const ux = vx - R * wy, uy = vy + R * wx, us = Math.hypot(ux, uy);
  let rem = dt;
  if (us > 1e-9) {
    const k = 3.5 * P.muS * g, ts = Math.min(dt, us / k), hx = ux / us, hy = uy / us;
    vx -= P.muS * g * hx * ts; vy -= P.muS * g * hy * ts;
    const c = 2.5 * P.muS * g / R * ts;
    wx -= c * hy; wy += c * hx;
    rem = dt - ts;
    if (us / k <= dt) {
      // now rolling: set the spin exactly
      wy = vx / R; wx = -vy / R;
      if (S.log) S.events.push({ type: 'roll', t: S.t + ts, i, x: S.x[i], y: S.y[i], vx, vy });
    }
  }
  if (rem > 0) {
    const s = Math.hypot(vx, vy);
    if (s > 0) {
      const ns = s - P.muR * g * rem;
      if (ns <= 1e-4) { vx = 0; vy = 0; if (S.log) S.events.push({ type: 'stop', t: S.t, i, x: S.x[i], y: S.y[i] }); }
      else { vx *= ns / s; vy *= ns / s; }
    }
    wy = vx / R; wx = -vy / R;
  }
  S.vx[i] = vx; S.vy[i] = vy; S.wx[i] = wx; S.wy[i] = wy;
}

// ── collisions ──────────────────────────────────────────────────────────────
function ballBall(S, i, j) {
  const R = S.R, P = S.P;
  let nx = S.x[j] - S.x[i], ny = S.y[j] - S.y[i];
  const d = Math.hypot(nx, ny); nx /= d; ny /= d;
  const vn = (S.vx[i] - S.vx[j]) * nx + (S.vy[i] - S.vy[j]) * ny;
  if (vn <= 0) return false;
  // contact point velocities (3D): w x (R n) for i, w x (-R n) for j
  const rx = (S.vx[i] - R * S.wz[i] * ny) - (S.vx[j] + R * S.wz[j] * ny);
  const ry = (S.vy[i] + R * S.wz[i] * nx) - (S.vy[j] - R * S.wz[j] * nx);
  const rz = R * (S.wx[i] * ny - S.wy[i] * nx) + R * (S.wx[j] * ny - S.wy[j] * nx);
  const jn = (1 + P.eB) * vn / 2;
  const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz, s = Math.hypot(tx, ty, tz);
  let jt = 0, ux = 0, uy = 0, uz = 0;
  if (s > 1e-9) { jt = Math.min(P.muB * jn, s / 7); ux = tx / s; uy = ty / s; uz = tz / s; }
  const before = S.log ? [S.vx[i], S.vy[i], S.vx[j], S.vy[j]] : null;
  // impulse per unit mass on i: -jn n - jt u ; on j the opposite
  const px = -jn * nx - jt * ux, py = -jn * ny - jt * uy;
  S.vx[i] += px; S.vy[i] += py; S.vx[j] -= px; S.vy[j] -= py;
  // both balls: dw = -2.5 jt (n x u) / R
  const cx = ny * uz, cy = -nx * uz, cz = nx * uy - ny * ux, k = -2.5 * jt / R;
  S.wx[i] += k * cx; S.wy[i] += k * cy; S.wz[i] += k * cz;
  S.wx[j] += k * cx; S.wy[j] += k * cy; S.wz[j] += k * cz;
  S.hits++;
  if (i === 0 || j === 0) { if (S.first < 0) { S.first = i === 0 ? j : i; S.firstT = S.t; } }
  if (S.log) S.events.push({ type: 'ball', t: S.t, i, j, xi: S.x[i], yi: S.y[i], xj: S.x[j], yj: S.y[j], nx, ny, vn, jn, jt,
    before, after: [S.vx[i], S.vy[i], S.vx[j], S.vy[j]] });
  return true;
}

// N: the inward normal (horizontal). The nose touches above the equator.
function cushion(S, i, nx, ny, what) {
  const R = S.R, P = S.P, T = S.T;
  const vN = S.vx[i] * nx + S.vy[i] * ny;
  if (vN >= 0) return false;
  const sa = Math.max(0, Math.min(0.9, (T.spec.noseH - R) / R)), ca = Math.sqrt(1 - sa * sa);
  // contact point c (from the centre) and the normal k into the ball
  const cx = -R * ca * nx, cy = -R * ca * ny, cz = R * sa;
  const kx = ca * nx, ky = ca * ny, kz = -sa;
  const wx = S.wx[i], wy = S.wy[i], wz = S.wz[i];
  const vcx = S.vx[i] + (wy * cz - wz * cy), vcy = S.vy[i] + (wz * cx - wx * cz), vcz = (wx * cy - wy * cx);
  const pk = -(1 + P.eC) * vN / ca;
  const vck = vcx * kx + vcy * ky + vcz * kz;
  const tx = vcx - vck * kx, ty = vcy - vck * ky, tz = vcz - vck * kz, s = Math.hypot(tx, ty, tz);
  let jt = 0, ux = 0, uy = 0, uz = 0;
  if (s > 1e-9) { jt = Math.min(P.muC * pk, s / 3.5); ux = tx / s; uy = ty / s; uz = tz / s; }
  const vin = S.log ? [S.vx[i], S.vy[i]] : null;
  S.vx[i] += pk * kx - jt * ux; S.vy[i] += pk * ky - jt * uy;
  // torque of the friction: c x (-jt u) / (0.4 R^2)
  const f = -jt / (0.4 * R * R);
  S.wx[i] += f * (cy * uz - cz * uy); S.wy[i] += f * (cz * ux - cx * uz); S.wz[i] += f * (cx * uy - cy * ux);
  // never leave toward the cushion (a corner hit at a grazing angle)
  const out = S.vx[i] * nx + S.vy[i] * ny;
  if (out < 0) { S.vx[i] -= out * nx; S.vy[i] -= out * ny; }
  if (i === 0) S.cueRails++;
  S.railMask |= 1 << i;
  if (S.first >= 0) S.railAfter = true;
  if (S.log) S.events.push({ type: 'cushion', t: S.t, i, x: S.x[i], y: S.y[i], nx, ny, what, vin, vout: [S.vx[i], S.vy[i]] });
  return true;
}

// ── frozen clusters (the rack): a short contact simulation ─────────────────
// When a struck ball touches other balls (gaps under CLUSTER_GAP), binary
// impulses one after the other act like a Newton's cradle: the energy goes
// to two or three balls and the rest of the rack stays. Real balls press
// together at the same time. So the cluster runs a Hertz contact model
// (F = K d^1.5, Hunt-Crossley damping for e_b) in 1 us steps until no two
// balls overlap. The others wait; the clock moves on by the contact time.
const CLUSTER_GAP = 0.001;
const HERTZ_K = 2.78e9;   // per unit mass: (4/3) E* sqrt(R*) / m, phenolic resin, E = 5.4 GPa
function clusterOf(S, i, j) {
  const D = 2 * S.R + CLUSTER_GAP, out = [i, j], seen = new Uint8Array(N);
  seen[i] = seen[j] = 1;
  for (let k = 0; k < out.length; k++) {
    const a = out[k];
    for (let b = 0; b < N; b++) {
      if (seen[b] || !S.on[b]) continue;
      const dx = S.x[b] - S.x[a], dy = S.y[b] - S.y[a];
      if (dx * dx + dy * dy < D * D) { seen[b] = 1; out.push(b); }
    }
  }
  return out;
}
function solveCluster(S, C, vref) {
  const dt = 1e-6, D = 2 * S.R, n = C.length, lam = 1.5 * (1 - S.P.eB) / Math.max(0.05, vref);
  const fx = new Float64Array(n), fy = new Float64Array(n);
  let t = 0, quiet = 0;
  const force = () => {
    fx.fill(0); fy.fill(0);
    let any = false;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const i = C[a], j = C[b], dx = S.x[j] - S.x[i], dy = S.y[j] - S.y[i], d2 = dx * dx + dy * dy;
      if (d2 >= D * D) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, del = D - d;
      const dd = (S.vx[i] - S.vx[j]) * nx + (S.vy[i] - S.vy[j]) * ny;   // closing speed
      const F = Math.max(0, HERTZ_K * del * Math.sqrt(del) * (1 + lam * dd));
      fx[a] -= F * nx; fy[a] -= F * ny; fx[b] += F * nx; fy[b] += F * ny;
      any = true;
    }
    return any;
  };
  force();
  while (t < 0.01) {
    for (let a = 0; a < n; a++) { const i = C[a]; S.vx[i] += 0.5 * dt * fx[a]; S.vy[i] += 0.5 * dt * fy[a]; S.x[i] += dt * S.vx[i]; S.y[i] += dt * S.vy[i]; }
    const any = force();
    for (let a = 0; a < n; a++) { const i = C[a]; S.vx[i] += 0.5 * dt * fx[a]; S.vy[i] += 0.5 * dt * fy[a]; }
    t += dt;
    quiet = any ? 0 : quiet + 1;
    if (quiet > 30) break;
  }
  return t;
}

// ── time of impact (straight lines inside a tick) ──────────────────────────
function toiBalls(S, i, j, tmax) {
  const px = S.x[j] - S.x[i], py = S.y[j] - S.y[i];
  const vx = S.vx[j] - S.vx[i], vy = S.vy[j] - S.vy[i];
  const b = px * vx + py * vy;
  if (b >= 0) return Infinity;
  const D = 2 * S.R, c = px * px + py * py - D * D;
  const a = vx * vx + vy * vy;
  if (c <= 0) return 0;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t < 0 ? 0 : t;
}

function toiSeg(S, i, s, tmax) {
  const R = S.R, vn = S.vx[i] * s.nx + S.vy[i] * s.ny;
  if (vn >= 0) return Infinity;
  const d0 = (S.x[i] - s.ax) * s.nx + (S.y[i] - s.ay) * s.ny;
  if (d0 < 0) return Infinity;
  let t = (d0 - R) / -vn;
  if (t > tmax) return Infinity;
  if (t < 0) t = 0;
  const q = (S.x[i] + S.vx[i] * t - s.ax) * s.tx + (S.y[i] + S.vy[i] * t - s.ay) * s.ty;
  return q >= 0 && q <= s.len ? t : Infinity;
}

function toiPoint(S, i, p, tmax) {
  const px = p.x - S.x[i], py = p.y - S.y[i];
  const vx = -S.vx[i], vy = -S.vy[i];
  const b = px * vx + py * vy;
  if (b >= 0) return Infinity;
  const c = px * px + py * py - S.R * S.R, a = vx * vx + vy * vy;
  if (c > 0 && Math.sqrt(c + S.R * S.R) - S.R > Math.sqrt(a) * tmax + 1e-9) return Infinity;
  if (c <= 0) return 0;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t < 0 ? 0 : t;
}

function advance(S, dt) {
  if (dt <= 0) return;
  for (let i = 0; i < N; i++) {
    if (!S.on[i] || (S.vx[i] === 0 && S.vy[i] === 0)) { if (S.q && S.on[i] && S.wz[i]) rotate(S, i, dt); continue; }
    S.x[i] += S.vx[i] * dt; S.y[i] += S.vy[i] * dt;
    if (S.q) rotate(S, i, dt);
  }
}

// q <- exp(dt w / 2) q: the exact turn by |w| dt about w (display only:
// the 3D balls and the 2D decals of view/diagram.js read it)
function rotate(S, i, dt) {
  const q = S.q, o = 4 * i, wx = S.wx[i], wy = S.wy[i], wz = S.wz[i];
  const wl = Math.hypot(wx, wy, wz);
  if (wl < 1e-12) return;
  const half = wl * dt / 2, c = Math.cos(half), k = Math.sin(half) / wl;
  const ax = wx * k, ay = wy * k, az = wz * k;
  const w = q[o], x = q[o + 1], y = q[o + 2], z = q[o + 3];
  const nw = c * w - ax * x - ay * y - az * z;
  const nx = c * x + ax * w + ay * z - az * y;
  const ny = c * y + ay * w + az * x - ax * z;
  const nz = c * z + az * w + ax * y - ay * x;
  const l = Math.hypot(nw, nx, ny, nz) || 1;
  q[o] = nw / l; q[o + 1] = nx / l; q[o + 2] = ny / l; q[o + 3] = nz / l;
}

function nearRail(S, i, reach) {
  const T = S.T;
  return Math.abs(S.x[i]) + reach > T.inner.x - 1e-6 || Math.abs(S.y[i]) + reach > T.inner.y - 1e-6;
}

const SP = new Float64Array(N);
function moveAll(S, h) {
  const T = S.T, D = 2 * S.R, segs = T.segs, pts = T.pts;
  let rem = h, guard = 0;
  while (rem > 0) {
    let te = rem, kind = 0, a = -1, b = -1, obj = null;
    for (let i = 0; i < N; i++) SP[i] = S.on[i] ? Math.abs(S.vx[i]) + Math.abs(S.vy[i]) : 0;
    for (let i = 0; i < N; i++) {
      if (SP[i] === 0) continue;
      const xi = S.x[i], yi = S.y[i];
      for (let j = 0; j < N; j++) {
        if (j === i || !S.on[j] || (j < i && SP[j] !== 0)) continue; // a moving pair is seen once
        const dx = S.x[j] - xi, dy = S.y[j] - yi, lim = D + (SP[i] + SP[j]) * te;
        if (dx * dx + dy * dy > lim * lim) continue;
        const t = toiBalls(S, i, j, te);
        if (t < te) { te = t; kind = 1; a = i; b = j; }
      }
      if (nearRail(S, i, SP[i] * te + 0.002)) {
        for (let k = 0; k < segs.length; k++) { const t = toiSeg(S, i, segs[k], te); if (t < te) { te = t; kind = 2; a = i; obj = segs[k]; } }
        for (let k = 0; k < pts.length; k++) { const t = toiPoint(S, i, pts[k], te); if (t < te) { te = t; kind = 3; a = i; obj = pts[k]; } }
      }
    }
    advance(S, te);
    S.t += te;
    rem -= te;
    if (kind === 1) {
      const C = clusterOf(S, a, b);
      if (C.length > 2) {
        const vref = (S.vx[a] - S.vx[b]) * (S.x[b] - S.x[a]) / (2 * S.R) + (S.vy[a] - S.vy[b]) * (S.y[b] - S.y[a]) / (2 * S.R);
        const before = S.log ? [S.vx[a], S.vy[a], S.vx[b], S.vy[b]] : null;
        const xi = S.x[a], yi = S.y[a], xj = S.x[b], yj = S.y[b];
        if (a === 0 || b === 0) { if (S.first < 0) { S.first = a === 0 ? b : a; S.firstT = S.t; } }
        const dtc = solveCluster(S, C, vref);
        // the balls outside the cluster move on by the contact time
        const keep = new Uint8Array(N); for (const k of C) keep[k] = 1;
        for (let k = 0; k < N; k++) if (S.on[k] && !keep[k]) { S.x[k] += S.vx[k] * dtc; S.y[k] += S.vy[k] * dtc; }
        S.t += dtc; rem -= dtc; S.hits += C.length - 1;
        if (S.log) { const d = Math.hypot(xj - xi, yj - yi); S.events.push({ type: 'ball', t: S.t, i: a, j: b, xi, yi, xj, yj, nx: (xj - xi) / d, ny: (yj - yi) / d, vn: vref, jn: 0, jt: 0, cluster: C.length, before, after: [S.vx[a], S.vy[a], S.vx[b], S.vy[b]] }); }
      } else ballBall(S, a, b);
    }
    else if (kind === 2) cushion(S, a, obj.nx, obj.ny, obj.kind);
    else if (kind === 3) { const nx = S.x[a] - obj.x, ny = S.y[a] - obj.y, d = Math.hypot(nx, ny); cushion(S, a, nx / d, ny / d, 'tip'); }
    if (kind && S.stopAtFirst && S.first >= 0) { S.stopped = true; return; }
    if (++guard > 500) { advance(S, rem); S.t += rem; break; }
  }
}

function pockets(S) {
  const T = S.T;
  for (let i = 0; i < N; i++) {
    if (!S.on[i]) continue;
    const x = S.x[i], y = S.y[i];
    if (Math.abs(x) < T.hx - 0.12 && Math.abs(y) < T.hy - 0.08) continue;
    for (const p of T.pockets) {
      if ((x - p.hx) ** 2 + (y - p.hy) ** 2 < p.r * p.r) { potBall(S, i, p.id); break; }
    }
    if (S.on[i] && (Math.abs(x) > T.hx + 0.25 || Math.abs(y) > T.hy + 0.25)) potBall(S, i, -2);
  }
}

function potBall(S, i, id) {
  S.on[i] = 0; S.pot[i] = id;
  S.potted.push({ i, pocket: id, t: S.t });
  if (S.paths) S.paths[i].push(S.x[i], S.y[i], S.t);
  if (S.log) S.events.push({ type: 'pot', t: S.t, i, pocket: id, x: S.x[i], y: S.y[i], vx: S.vx[i], vy: S.vy[i] });
  S.vx[i] = S.vy[i] = S.wx[i] = S.wy[i] = S.wz[i] = 0;
}

// One tick of P.h seconds.
export function tick(S) {
  const h = S.P.h, t0 = S.t;
  for (let i = 0; i < N; i++) if (S.on[i]) frictionBall(S, i, h / 2);
  moveAll(S, h);
  if (S.stopped) return;
  const t1 = Math.max(S.t, t0 + h);   // a cluster contact can run past the tick
  S.t = t1 - h / 2;   // the second half of the friction covers [t1 - h/2, t1]
  for (let i = 0; i < N; i++) if (S.on[i]) frictionBall(S, i, h / 2);
  S.t = t1;
  pockets(S);
  if (S.paths) {
    for (let i = 0; i < N; i++) {
      if (!S.on[i] || (S.vx[i] === 0 && S.vy[i] === 0)) continue;
      if (S.t - S._pathT[i] >= S.pathDt - 1e-9) { S.paths[i].push(S.x[i], S.y[i], S.t); S._pathT[i] = S.t; }
    }
  }
}

// Run until every ball rests (or maxT). opts.stopAtFirst: stop at the first
// collision of the cue ball (the AI aim refinement).
export function simulate(S, { maxT = 40, stopAtFirst = false } = {}) {
  S.stopAtFirst = stopAtFirst;
  let n = 0;
  const maxN = Math.ceil(maxT / S.P.h);
  while (n++ < maxN) {
    tick(S);
    if (S.stopped) break;
    if (!anyMoving(S)) break;
  }
  if (!S.stopped) settle(S);
  S.stopAtFirst = false;
  return S;
}

// Zero the left-over spin of resting balls (the end of a shot).
export function settle(S) {
  for (let i = 0; i < N; i++) if (S.on[i] && !moving(S, i)) { S.vx[i] = S.vy[i] = S.wx[i] = S.wy[i] = 0; S.wz[i] = 0; }
}

export function kinetic(S) {
  const R = S.R, I = 0.4 * R * R;
  let E = 0;
  for (let i = 0; i < N; i++) if (S.on[i]) E += 0.5 * (S.vx[i] ** 2 + S.vy[i] ** 2) + 0.5 * I * (S.wx[i] ** 2 + S.wy[i] ** 2 + S.wz[i] ** 2);
  return E; // per unit mass
}
