// ============================================================================
//  PLANETARY GEARBOX  ·  gears.js — tooth profiles, Willis kinematics, phases
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE: tests.mjs runs this file in node.
//
//  ANGLES. Each gear turns about z. A tooth (or, for a ring, a tooth space)
//  of a gear at angle 0 points along +x. Angles grow counter-clockwise, as
//  seen from +z.
//
//  ONE SET. A sun (Zs), N planets (Zp) on a carrier, and a ring with
//  Zr = Zs + 2 Zp teeth. The Willis equation ties the three speeds:
//      (ωs − ωc) / (ωr − ωc) = −Zr / Zs
//  Equal planet spacing needs (Zs + Zr) / N to be a whole number.
//
//  PHASE. planetAngle() gives the spin of planet i that keeps its teeth in
//  the sun's spaces. The ring is then turned by a fixed offset r0, so the
//  planets also sit in the ring's spaces. meshError() measures both meshes.
//
//  GREP MAP
//    export function toothOutline ... involute outline of an external gear
//    export function planetChoices .. the planet counts that fit and assemble
//    export function makeSet ........ one set: counts, radii, spacing, offset
//    export function planetAngle .... spin of planet i from sun and carrier
//    export function meshError ...... how far each mesh is from a true mesh
//    export const MODELS ............ simple set and Simpson compound
//    export const MODES ............. what is held, driven and taken off
//    export function solveSpeeds .... linear solve of the Willis equations
//    export function poseAngles ..... member angles from the two free angles
// ============================================================================
export const TAU = Math.PI * 2, D = Math.PI / 180;
export const PA = 20 * D;                       // pressure angle
const inv = a => Math.tan(a) - a;               // involute function

// ── tooth outline ────────────────────────────────────────────────────────────
// Outline of an external gear: Z teeth of module m, a tooth centred on +x.
// o.add / o.ded: addendum and dedendum (default m and 1.25 m). o.back: the
// tooth is this much thinner at the pitch circle (a negative value makes it
// thicker, for the cutter of a ring). Returns [[x, y], ...] counter-clockwise.
export function toothOutline(Z, m, o = {}) {
  const add = o.add ?? m, ded = o.ded ?? 1.25 * m, back = o.back ?? 0.05 * m;
  const steps = o.steps ?? 8, rootSteps = o.rootSteps ?? 3, tipSteps = o.tipSteps ?? 2;
  const r = m * Z / 2, rb = r * Math.cos(PA), ra = r + add, rf = Math.max(r - ded, 0.3 * r);
  const s = Math.PI * m / 2 - back;
  const b0 = s / (2 * r) + inv(PA);
  const half = Math.PI / Z;
  const psi = rho => Math.max(0.004, Math.min(half * 0.98, rho <= rb ? b0 : b0 - inv(Math.acos(rb / rho))));
  // flank radii: a radial run below the base circle, then the involute
  const rs = [];
  const r0 = Math.max(rf, rb);
  if (rf < rb) rs.push(rf);
  for (let i = 0; i <= steps; i++) {
    // even steps in roll angle make the involute look smooth near the base
    const t0 = Math.sqrt(Math.max(0, (r0 / rb) ** 2 - 1)), t1 = Math.sqrt((ra / rb) ** 2 - 1);
    const t = t0 + (t1 - t0) * i / steps;
    rs.push(rb * Math.sqrt(1 + t * t));
  }
  const pts = [];
  const P = (rho, a) => pts.push([rho * Math.cos(a), rho * Math.sin(a)]);
  for (let k = 0; k < Z; k++) {
    const g = k * TAU / Z;
    for (const rho of rs) P(rho, g - psi(rho));                 // right flank, up
    const pa = psi(ra);
    for (let j = 1; j < tipSteps; j++) P(ra, g - pa + 2 * pa * j / tipSteps);
    for (let i = rs.length - 1; i >= 0; i--) P(rs[i], g + psi(rs[i]));   // left flank, down
    const a0 = g + psi(rf), a1 = g + TAU / Z - psi(rf);
    for (let j = 1; j < rootSteps; j++) P(rf, a0 + (a1 - a0) * j / rootSteps);
  }
  return pts;
}

// ── one set ──────────────────────────────────────────────────────────────────
// Planet counts N that (1) assemble with equal spacing and (2) leave room
// between neighbouring planet tips (half a module at least).
export function planetChoices(Zs, Zp) {
  const Zr = Zs + 2 * Zp, out = [];
  for (let N = 2; N <= 6; N++) {
    if ((Zs + Zr) % N) continue;
    if ((Zs + Zp) * Math.sin(Math.PI / N) <= Zp + 2 + 0.5) continue;
    out.push(N);
  }
  return out;
}
export function bestPlanets(Zs, Zp) {
  const c = planetChoices(Zs, Zp);
  for (const n of [3, 4, 5, 6, 2]) if (c.includes(n)) return n;
  return 0;
}

// set = { Zs, Zp, Zr, N, m, k = Zr/Zs, psi[i] planet places, r0 ring offset,
//         rs rp rr a: pitch radii and the centre distance }
export function makeSet(Zs, Zp, N, m = 1, psi0 = 0) {
  const Zr = Zs + 2 * Zp;
  const S = { Zs, Zp, Zr, N, m, k: Zr / Zs, psi: [], r0: 0 };
  for (let i = 0; i < N; i++) S.psi.push(psi0 + i * TAU / N);
  S.rs = m * Zs / 2; S.rp = m * Zp / 2; S.rr = m * Zr / 2; S.a = S.rs + S.rp;
  // ring offset: planet 0 at zero angles must sit in a ring tooth space
  const phi = S.psi[0], tp = planetAngle(S, 0, 0, 0);
  const fp = (phi - tp) * Zp / TAU;              // planet tooth phase toward the ring
  S.r0 = phi - TAU / Zr * fp;
  return S;
}

// spin angle of planet i, for sun angle thS and carrier angle thC
export function planetAngle(S, i, thS, thC) {
  const phi = thC + S.psi[i];
  return phi + Math.PI - Math.PI / S.Zp + (phi - thS) * S.Zs / S.Zp;
}
const frac = x => { const f = x - Math.floor(x); return Math.min(f, 1 - f); };   // distance to a whole number

// Mesh errors in fractions of a tooth pitch, worst planet. thR is the
// kinematic ring angle; the drawn ring is at thR + S.r0.
export function meshError(S, thS, thC, thR) {
  let sun = 0, ring = 0;
  for (let i = 0; i < S.N; i++) {
    const phi = thC + S.psi[i], tp = planetAngle(S, i, thS, thC);
    const fs = (phi - thS) * S.Zs / TAU;                 // sun tooth phase toward planet
    const fpIn = (phi + Math.PI - tp) * S.Zp / TAU;     // planet tooth phase toward sun
    sun = Math.max(sun, frac(fs + fpIn - 0.5));
    const fpOut = (phi - tp) * S.Zp / TAU;              // planet tooth phase toward ring
    const fr = (phi - (thR + S.r0)) * S.Zr / TAU;       // ring space phase at phi
    ring = Math.max(ring, frac(fr - fpOut));
  }
  return { sun, ring };
}

// ── models and modes ─────────────────────────────────────────────────────────
// sets: which member is the sun, carrier and ring of each set. In the Simpson
// set the rear ring is fixed to the front carrier (both are 'C1').
export const MODELS = {
  simple: { members: ['S', 'C', 'R'], sets: [{ s: 'S', c: 'C', r: 'R' }], free: ['S', 'C'] },
  simpson: { members: ['S', 'R1', 'C1', 'C2'], sets: [{ s: 'S', c: 'C1', r: 'R1' }, { s: 'S', c: 'C2', r: 'C1' }], free: ['S', 'C1'] },
};
export const NAMES = { S: 'Sun', C: 'Carrier', R: 'Ring', R1: 'Front ring', C1: 'Output (front carrier + rear ring)', C2: 'Rear carrier' };

// A mode: input member, held members, locked pairs, output member.
export const SIMPSON_GEARS = {
  1: { name: '1st', input: 'R1', hold: ['C2'], lock: [], out: 'C1', apply: ['Forward clutch', 'Low/reverse band'] },
  2: { name: '2nd', input: 'R1', hold: ['S'], lock: [], out: 'C1', apply: ['Forward clutch', 'Intermediate band'] },
  3: { name: '3rd', input: 'R1', hold: [], lock: [['S', 'R1']], out: 'C1', apply: ['Forward clutch', 'Direct clutch'] },
  R: { name: 'Reverse', input: 'S', hold: ['C2'], lock: [], out: 'C1', apply: ['Direct clutch', 'Low/reverse band'] },
  N: { name: 'Neutral', input: 'R1', hold: [], lock: [], out: 'C1', apply: ['Forward clutch only'], neutral: true },
};
// A simple-set mode from what is held and what is driven. hold null: two
// members locked together (direct drive).
export function simpleMode(hold, input) {
  if (!hold) return { input, hold: [], lock: [['S', 'C']], out: input === 'C' ? 'R' : 'C', direct: true };
  const out = ['S', 'C', 'R'].find(x => x !== hold && x !== input);
  return { input, hold: [hold], lock: [], out };
}

// Solve the member speeds for input speed w (rad/s). Rows: one Willis
// equation per set, each hold, each lock, the input. If that leaves a free
// motion (neutral), the output is held by its load (ω = 0).
export function solveSpeeds(model, ks, mode, w = 1) {
  const M = model.members, n = M.length, ix = Object.fromEntries(M.map((x, i) => [x, i]));
  const rows = [];
  const row = (pairs, rhs) => { const r = new Array(n + 1).fill(0); for (const [x, c] of pairs) r[ix[x]] += c; r[n] = rhs; rows.push(r); };
  model.sets.forEach((s, j) => row([[s.s, 1], [s.c, -1 - ks[j]], [s.r, ks[j]]], 0));   // ωs − ωc + k(ωr − ωc) = 0
  for (const h of mode.hold) row([[h, 1]], 0);
  for (const [a, b] of mode.lock) row([[a, 1], [b, -1]], 0);
  row([[mode.input, 1]], w);
  let sol = gauss(rows, n);
  if (!sol) { row([[mode.out, 1]], 0); sol = gauss(rows, n); }
  const out = {};
  M.forEach((x, i) => { out[x] = sol ? sol[i] : 0; });
  return out;
}
// least-squares free Gaussian elimination: null when the rows leave a free motion
function gauss(rows0, n) {
  const A = rows0.map(r => r.slice());
  const piv = [];
  let r = 0;
  for (let c = 0; c < n && r < A.length; c++) {
    let best = r;
    for (let i = r + 1; i < A.length; i++) if (Math.abs(A[i][c]) > Math.abs(A[best][c])) best = i;
    if (Math.abs(A[best][c]) < 1e-12) continue;
    [A[r], A[best]] = [A[best], A[r]];
    for (let i = 0; i < A.length; i++) {
      if (i === r) continue;
      const f = A[i][c] / A[r][c];
      if (f) for (let j = c; j <= n; j++) A[i][j] -= f * A[r][j];
    }
    piv.push(c); r++;
  }
  if (piv.length < n) return null;
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) x[piv[i]] = A[i][n] / A[i][piv[i]];
  return x;
}

// Member angles from the two free angles, so the Willis relations hold
// exactly at every frame (no drift between members).
//   simple:  θr = θc − (θs − θc)/k
//   Simpson: θR1 = θC1 − (θS − θC1)/k1,  θC2 = (θS + k2 θC1)/(1 + k2)
export function poseAngles(modelId, ks, f) {
  if (modelId === 'simple') return { S: f.S, C: f.C, R: f.C - (f.S - f.C) / ks[0] };
  return { S: f.S, C1: f.C1, R1: f.C1 - (f.S - f.C1) / ks[0], C2: (f.S + ks[1] * f.C1) / (1 + ks[1]) };
}

// ratio input/output (Infinity when the output stands still)
export function ratioOf(sp, mode) {
  const o = sp[mode.out], i = sp[mode.input];
  return Math.abs(o) < 1e-12 ? Infinity : i / o;
}
