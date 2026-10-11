// ============================================================================
//  ROCHE LIMIT  ·  initial.js — the start state of a random run (no DOM)
// ----------------------------------------------------------------------------
//  app/runs.js builds the start of a run here; worker.js uses clumpMask;
//  tests.mjs checks every layout. The GPU kernels (shaders/sim.wgsl) do not
//  change: a binary, a train or two moons are only a start state of one
//  SimGPU. Self-gravity, contacts and the tide act on all grains as before.
//
//  ONE SETTLED PILE. The page settles one pile of N grains (physics.js
//  makeCloud, then the settle on the GPU). A layout cuts that pile into
//  PARTS: part k takes the n_k grains nearest the centre (pickInner), so
//  each part is a settled, round pile. The part sizes add up to N.
//
//  LAYOUTS (spec.layout.type)
//    single   one pile (as the first scenarios)
//    core     one pile; the inner share `frac` of the grains has `factor`
//             times the mass (coreMasses, before the settle)
//    contact  two lobes that touch at one point, rotating as one body
//    binary   two piles on a circular mutual orbit of separation `sep`
//             (centre to centre, in units of R_1 + R_2), each spinning in
//             step with it. The separation is capped at 0.6 of the Hill
//             radius at the start, so the pair is bound when it starts.
//    train    k piles on the same orbit, shifted in time (shiftAlongOrbit):
//             the train of Shoemaker-Levy 9
//    two      two piles on circular orbits of radius d and d * `ratio`, a
//             phase `phi` apart (two moons at once)
//  The frame point (the reference orbit) carries part 0. The tide is exact
//  for any offset from it (physics.js tideAccel), so a part far from the
//  frame point feels the right force.
//
//  SPIN (spinVector). sync: the orbital rate about the orbit normal (as
//  physics.js placeOnOrbit). prograde: k times it. retrograde: -k times
//  it. tumbling: k times it about a random axis. none: no spin. The rate
//  is capped at 0.7 of the breakup rate of a sphere, sqrt(4 pi G rho / 3).
//
//  ORBITS (orbitStart3). physics.js orbitStart, then: an ellipse starts at
//  most at 0.97 of its apocentre; the orbit plane tilts by `inc` about the
//  x axis (the line of nodes; inc > 90 deg is retrograde).
//
//  UNITS. Sim units (physics.js): G = 1, grain radius 1. X, V: the frame
//  point and its velocity. All returned positions and velocities are
//  relative to the frame point, as SimGPU wants them.
//
//  grep -n targets
//    part sizes ........... "export function partSizes"
//    inner subset ......... "export function pickInner"
//    rotations ............ "export function randomRotation"
//    core masses .......... "export function coreMasses"
//    spin ................. "export function spinVector"
//    orbit start .......... "export function orbitStart3"
//    time shift ........... "export function shiftAlongOrbit"
//    build ................ "export function buildStart"
//    clumps ............... "export function clumpMask"
// ============================================================================
import { G, R_MAX, RefOrbit, orbitStart, pileStats } from './physics.js';

export const MIN_PART = 256;     // the fewest grains in one part

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
// rotate v about the unit axis n by angle a (Rodrigues)
export function rotAbout(v, n, a) {
  const c = Math.cos(a), s = Math.sin(a), k = dot(n, v) * (1 - c), x = cross(n, v);
  return [v[0] * c + x[0] * s + n[0] * k, v[1] * c + x[1] * s + n[1] * k, v[2] * c + x[2] * s + n[2] * k];
}
// a unit vector normal to n
function perp(n) { const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; return unit(cross(n, a)); }
function randUnit(rnd) { const z = 2 * rnd() - 1, p = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z); return [s * Math.cos(p), s * Math.sin(p), z]; }

// ── part sizes ────────────────────────────────────────────────────────────
// Sizes of the parts, adding up to N, each at least MIN_PART. ly: the
// layout. contact, binary, two: two parts, the mass ratio ly.ratio
// (small / large, 0..1). train: ly.k parts with weights ly.w (the first is
// the largest).
export function partSizes(ly, N) {
  const t = ly.type;
  if (t === 'contact' || t === 'binary' || t === 'two') {
    const r = Math.max(0.05, Math.min(1, ly.ratio ?? 0.6));
    let n1 = Math.round(N / (1 + r));
    n1 = Math.max(MIN_PART, Math.min(N - MIN_PART, n1));
    return [n1, N - n1];
  }
  if (t === 'train') {
    const k = Math.max(2, Math.min(ly.k || 5, Math.floor(N / MIN_PART)));
    const w = (ly.w && ly.w.length >= k ? ly.w.slice(0, k) : Array.from({ length: k }, (_, i) => 1 / (1 + 0.25 * i)));
    const sw = w.reduce((a, b) => a + b, 0);
    const n = w.map(x => Math.max(MIN_PART, Math.floor(N * x / sw)));
    // fix the sum on the largest part
    let s = n.reduce((a, b) => a + b, 0);
    n[0] += N - s;
    if (n[0] < MIN_PART) throw new Error('partSizes: N too small for the train');
    return n;
  }
  return [N];
}

// ── inner subset ──────────────────────────────────────────────────────────
// The n grains of a settled pile (pos about its centre) nearest the
// centre, re-centred on their own centre of mass and turned by the 3x3
// rotation rot (row-major). Returns { pos, rad, mass, st }.
export function pickInner(pile, n, rot = null) {
  const N = pile.mass.length, idx = new Int32Array(N), r2 = new Float64Array(N);
  for (let i = 0; i < N; i++) { idx[i] = i; r2[i] = pile.pos[3 * i] ** 2 + pile.pos[3 * i + 1] ** 2 + pile.pos[3 * i + 2] ** 2; }
  const order = Array.from(idx).sort((a, b) => r2[a] - r2[b]).slice(0, n);
  const pos = new Float64Array(n * 3), rad = new Float64Array(n), mass = new Float64Array(n);
  order.forEach((j, k) => { for (let c = 0; c < 3; c++) pos[3 * k + c] = pile.pos[3 * j + c]; rad[k] = pile.rad[j]; mass[k] = pile.mass[j]; });
  const st0 = pileStats(pos, mass);
  for (let k = 0; k < n; k++) {
    let x = pos[3 * k] - st0.com[0], y = pos[3 * k + 1] - st0.com[1], z = pos[3 * k + 2] - st0.com[2];
    if (rot) { const a = rot[0] * x + rot[1] * y + rot[2] * z, b = rot[3] * x + rot[4] * y + rot[5] * z, c = rot[6] * x + rot[7] * y + rot[8] * z; x = a; y = b; z = c; }
    pos[3 * k] = x; pos[3 * k + 1] = y; pos[3 * k + 2] = z;
  }
  return { pos, rad, mass, st: pileStats(pos, mass) };
}
// A uniform random rotation (a random unit quaternion), row-major 3x3.
export function randomRotation(rnd) {
  const u1 = rnd(), u2 = rnd(), u3 = rnd();
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  const w = a * Math.sin(2 * Math.PI * u2), x = a * Math.cos(2 * Math.PI * u2), y = b * Math.sin(2 * Math.PI * u3), z = b * Math.cos(2 * Math.PI * u3);
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

// ── core ──────────────────────────────────────────────────────────────────
// A dense core: the share frac of the grains nearest the centre of the
// cloud get factor times the mass (the same radius, so a denser grain).
// Changes mass in place, before the settle. Returns the core mass share.
export function coreMasses(pos, mass, frac, factor) {
  const N = mass.length, st = pileStats(pos, mass), r2 = new Float64Array(N);
  for (let i = 0; i < N; i++) r2[i] = (pos[3 * i] - st.com[0]) ** 2 + (pos[3 * i + 1] - st.com[1]) ** 2 + (pos[3 * i + 2] - st.com[2]) ** 2;
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => r2[a] - r2[b]);
  const nc = Math.round(frac * N);
  let Mc = 0, Mt = 0;
  for (let k = 0; k < N; k++) { const i = order[k]; if (k < nc) { mass[i] *= factor; Mc += mass[i]; } Mt += mass[i]; }
  return Mc / Mt;
}

// ── spin ──────────────────────────────────────────────────────────────────
// The spin vector of a part. sp: { mode, k, axis? }; Omega: the orbital
// rate; n: the orbit normal; rho: bulk density (sim units); rnd for the
// tumbling axis. Capped at 0.7 of the breakup rate.
export function spinVector(sp, Omega, n, rho, rnd) {
  const mode = sp && sp.mode || 'sync', k = sp && sp.k !== undefined ? sp.k : 1;
  let w;
  if (mode === 'none') return [0, 0, 0];
  if (mode === 'tumbling') w = scale(sp.axis ? unit(sp.axis) : randUnit(rnd), k * Omega);
  else if (mode === 'retrograde') w = scale(n, -k * Omega);
  else if (mode === 'prograde') w = scale(n, k * Omega);
  else w = scale(n, Omega);
  const wb = Math.sqrt(4 * Math.PI / 3 * G * rho), m = Math.hypot(...w);
  return m > 0.7 * wb ? scale(w, 0.7 * wb / m) : w;
}

// ── orbit start ───────────────────────────────────────────────────────────
// P: { GM, Rp, J2 } with Rp the length unit of the spec (world unit in
// sim units). o: { kind: 'circular' | 'flyby', d, peri, e, r0, inc }.
// Returns { X, V, Omega, n }: Omega = |X x V| / |X|^2, n the orbit normal.
export function orbitStart3(P, o) {
  let st;
  if (o.kind === 'flyby') {
    let r0 = o.r0;
    if (o.e < 1) r0 = Math.min(r0, 0.97 * o.peri * (1 + o.e) / (1 - o.e));
    r0 = Math.max(r0, o.peri * 1.0001);
    st = orbitStart(P, { kind: 'flyby', peri: o.peri, e: o.e, r0 });
  } else st = orbitStart(P, { kind: 'circular', d: o.d });
  let X = st.X, V = st.V;
  if (o.inc) { const n = [1, 0, 0]; X = rotAbout(X, n, o.inc); V = rotAbout(V, n, o.inc); }
  const h = cross(X, V), r2 = dot(X, X);
  return { X, V, Omega: Math.hypot(...h) / r2, n: unit(h) };
}

// ── time shift along an orbit ─────────────────────────────────────────────
// The state a time tau later (or earlier, tau < 0) on the orbit of (X, V)
// about P (no drag): RK4 in steps of at most |dt|.
export function shiftAlongOrbit(P, X, V, tau, dt) {
  const ref = new RefOrbit(Object.assign({}, P, { drag: 0 }), X, V);
  const n = Math.max(1, Math.ceil(Math.abs(tau) / dt)), h = tau / n;
  for (let i = 0; i < n; i++) ref.step(h);
  return { X: ref.X.slice(), V: ref.V.slice() };
}

// ── build ─────────────────────────────────────────────────────────────────
// pile: the settled pile { pos (about its centre), rad, mass, st }.
// spec: the run spec (layout, spin). orb: { X, V, Omega, n, P } where P is
// the planet in sim units with Rp the world unit { GM, Rp, J2 }. rnd: a
// seeded random function. Returns { pos, vel, spin, rad, mass, parts }
// with N rows; parts[k] = { n, M, R, c, u, w } (centre and velocity
// relative to the frame point, spin).
export function buildStart(pile, spec, orb, rnd) {
  const ly = spec.layout || { type: 'single' }, N = pile.mass.length;
  const sizes = partSizes(ly, N);
  const rots = sizes.map((_, k) => k === 0 && (ly.type === 'single' || ly.type === 'core') ? null : randomRotation(rnd));
  const sub = sizes.map((n, k) => n === N && !rots[k] ? { pos: Float64Array.from(pile.pos), rad: Float64Array.from(pile.rad), mass: Float64Array.from(pile.mass), st: pileStats(pile.pos, pile.mass) } : pickInner(pile, n, rots[k]));
  const rho = pile.st ? pile.st.rho : sub[0].st.rho;
  const parts = sub.map(p => ({ n: p.mass.length, M: p.st.M, R: p.st.R, c: [0, 0, 0], u: [0, 0, 0], w: [0, 0, 0] }));
  const n = orb.n, Om = orb.Omega;
  const t = ly.type;
  if (t === 'single' || t === 'core') {
    parts[0].w = spinVector(spec.spin, Om, n, rho, rnd);
  } else if (t === 'contact') {
    // the long axis normal to the spin axis; extents along it, so that the
    // lobes touch with a gap of 0.02 grain radii
    const w = spinVector(spec.spin, Om, n, rho, rnd), wa = Math.hypot(...w) > 0 ? unit(w) : n;
    const a = rotAbout(perp(wa), wa, 2 * Math.PI * rnd());
    let e1 = 0, e2 = 0;
    for (let i = 0; i < parts[0].n; i++) e1 = Math.max(e1, sub[0].pos[3 * i] * a[0] + sub[0].pos[3 * i + 1] * a[1] + sub[0].pos[3 * i + 2] * a[2] + sub[0].rad[i]);
    for (let i = 0; i < parts[1].n; i++) e2 = Math.max(e2, -(sub[1].pos[3 * i] * a[0] + sub[1].pos[3 * i + 1] * a[1] + sub[1].pos[3 * i + 2] * a[2]) + sub[1].rad[i]);
    // the extents touch on the axis line only; close the true gap: the
    // closest pair of facing grains, moved together along the axis
    let D = e1 + e2 + 0.02;
    const face = (q, sg, e) => { const out = []; for (let i = 0; i < q.mass.length; i++) { const x = [q.pos[3 * i], q.pos[3 * i + 1], q.pos[3 * i + 2]]; if (sg * dot(x, a) + q.rad[i] > e - 3 * R_MAX) out.push([x, q.rad[i]]); } return out; };
    const f1 = face(sub[0], 1, e1), f2 = face(sub[1], -1, e2);
    for (let it = 0; it < 8; it++) {
      let gap = Infinity;
      for (const [x1, r1] of f1) for (const [x2, r2] of f2) {
        const g = Math.hypot(x2[0] + D * a[0] - x1[0], x2[1] + D * a[1] - x1[1], x2[2] + D * a[2] - x1[2]) - r1 - r2;
        if (g < gap) gap = g;
      }
      if (gap < 0.05) break;
      D -= 0.8 * (gap - 0.02);
    }
    const M = parts[0].M + parts[1].M;
    parts[0].c = scale(a, -D * parts[1].M / M); parts[1].c = scale(a, D * parts[0].M / M);
    for (const p of parts) { p.w = w; p.u = cross(w, p.c); }
  } else if (t === 'binary') {
    const M = parts[0].M + parts[1].M, Rsum = parts[0].R + parts[1].R;
    // the Hill radius of the pair at the start
    const rH = Math.hypot(...orb.X) * Math.cbrt(G * M / (3 * orb.P.GM));
    let D = (ly.sep || 3) * Rsum;
    D = Math.max(1.15 * Rsum + 2 * R_MAX, Math.min(D, 0.6 * rH));
    // the plane of the mutual orbit: tilted from the orbit plane by ly.tilt
    const tilt = ly.tilt ?? 0.3, a0 = perp(n), nb = unit(rotAbout(n, a0, tilt));
    const a = rotAbout(perp(nb), nb, 2 * Math.PI * rnd()), tv = unit(cross(nb, a));
    const v = Math.sqrt(G * M / D) * (ly.retro ? -1 : 1);
    parts[0].c = scale(a, -D * parts[1].M / M); parts[1].c = scale(a, D * parts[0].M / M);
    parts[0].u = scale(tv, -v * parts[1].M / M); parts[1].u = scale(tv, v * parts[0].M / M);
    const wsync = scale(nb, v / D);
    for (const p of parts) p.w = spec.spin && spec.spin.mode === 'tumbling' ? spinVector(spec.spin, Om, n, rho, rnd) : wsync;
    parts.D = D; parts.rH = rH;
  } else if (t === 'train') {
    // part 0 (the largest) at the frame point; the others ahead and behind
    // along the orbit, spaced by ly.gap (in units of the two radii) at the
    // start speed
    const vs = Math.hypot(...orb.V), dt = 2 * Math.PI / Math.max(Om, 1e-9) / 4000;
    let ahead = 0, behind = 0;
    for (let k = 1; k < parts.length; k++) {
      const fwd = k % 2 === 1, prev = fwd ? ahead : behind;
      const gap = (ly.gap || 2.6) * (parts[k].R + (k <= 2 ? parts[0].R : parts[k - 2].R));
      const s = prev + gap;
      if (fwd) ahead = s; else behind = s;
      const st = shiftAlongOrbit(orb.P, orb.X, orb.V, (fwd ? 1 : -1) * s / vs, dt);
      parts[k].c = add(st.X, scale(orb.X, -1)); parts[k].u = add(st.V, scale(orb.V, -1));
    }
    for (const p of parts) p.w = spinVector(spec.spin, Om, n, rho, rnd);
  } else if (t === 'two') {
    // moon 2 on a circular orbit of radius d * ratio2, phase phi from moon 1
    const r1 = Math.hypot(...orb.X), r2 = r1 * (ly.d2 || 1.12), phi = ly.phi ?? -0.5;
    const X2 = scale(rotAbout(unit(orb.X), n, phi), r2);
    const P = orb.P, vc = Math.sqrt(P.GM / r2 * (1 + 1.5 * (P.J2 || 0) * (P.Rp / r2) ** 2));
    const V2 = scale(unit(cross(n, X2)), vc * Math.sign(dot(cross(orb.X, orb.V), n) || 1));
    parts[1].c = add(X2, scale(orb.X, -1)); parts[1].u = add(V2, scale(orb.V, -1));
    parts[0].w = spinVector(spec.spin, Om, n, rho, rnd);
    parts[1].w = spinVector(spec.spin, vc / r2, n, rho, rnd);
  }
  // write the grains
  const pos = new Float64Array(N * 3), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3), rad = new Float64Array(N), mass = new Float64Array(N);
  let o = 0;
  sub.forEach((p, k) => {
    const P = parts[k];
    for (let i = 0; i < P.n; i++, o++) {
      const x = [p.pos[3 * i], p.pos[3 * i + 1], p.pos[3 * i + 2]], wx = cross(P.w, x);
      for (let c = 0; c < 3; c++) { pos[3 * o + c] = P.c[c] + x[c]; vel[3 * o + c] = P.u[c] + wx[c]; spin[3 * o + c] = P.w[c]; }
      rad[o] = p.rad[i]; mass[o] = p.mass[i];
    }
  });
  return { pos, vel, spin, rad, mass, parts };
}

// ── clumps ────────────────────────────────────────────────────────────────
// Friends-of-friends (link 1.1 (r_i + r_j) + 0.1, as physics.js
// analyzeBound): 1 for every grain in a group of at least minMass, else 0.
// worker.js uses it for runs of more than one body, so every intact piece
// draws as a body and not as debris.
export function clumpMask(pos, mass, rad, stride, minMass, N = mass.length) {
  const link = 2 * R_MAX * 1.1 + 0.1, inv = 1 / link;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const HS = 1 << Math.max(10, Math.ceil(Math.log2(N * 2)));
  const head = new Int32Array(HS).fill(-1), next = new Int32Array(N);
  const cx = new Int32Array(N), cy = new Int32Array(N), cz = new Int32Array(N);
  const hash = (a, b, c) => (((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) & (HS - 1);
  for (let i = 0; i < N; i++) {
    if (!mass[i]) continue;
    const o = i * stride;
    cx[i] = Math.floor(pos[o] * inv); cy[i] = Math.floor(pos[o + 1] * inv); cz[i] = Math.floor(pos[o + 2] * inv);
    const h = hash(cx[i], cy[i], cz[i]); next[i] = head[h]; head[h] = i;
  }
  for (let i = 0; i < N; i++) {
    if (!mass[i]) continue;
    const o = i * stride;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (let j = head[hash(cx[i] + a, cy[i] + b, cz[i] + c)]; j >= 0; j = next[j]) {
        if (j <= i) continue;
        const p = j * stride, dx = pos[o] - pos[p], dy = pos[o + 1] - pos[p + 1], dz = pos[o + 2] - pos[p + 2];
        const L = 1.1 * (rad[i] + rad[j]) + 0.1;
        if (dx * dx + dy * dy + dz * dz < L * L) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
      }
    }
  }
  const gm = new Float64Array(N);
  for (let i = 0; i < N; i++) if (mass[i]) gm[find(i)] += mass[i];
  const out = new Uint8Array(N);
  let groups = 0;
  for (let i = 0; i < N; i++) if (gm[i] >= minMass) groups++;
  for (let i = 0; i < N; i++) if (mass[i] && gm[find(i)] >= minMass) out[i] = 1;
  return { mask: out, clumps: groups };
}
