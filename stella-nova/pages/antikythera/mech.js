// ============================================================================
//  ANTIKYTHERA MECHANISM  ·  mech.js — the gear train, its layout and pose
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm, rad
//  and days. The plane of the gears is X right, Y up; h is the depth, +h
//  toward the front dial.
//
//  TOOTH COUNTS. The counts are the published ones (Freeth et al., Nature
//  2006; Sci. Rep. 2021). The layout, the modules and the tooth shape are
//  this page's own. One turn of b1 is one year of 365.25 days.
//    sidereal Moon .. b2/c1 · c2/d1 · d2/e2 = 64/38 · 48/24 · 127/32 = 254/19
//    Metonic ........ b2/l1 · l2/m1 · m2/n1 = 64/38 · 53/96 · 15/53 = 5/19
//    turntable e3 ... (b2/l1 · l2/m1) · m3/e3 = 0.9298 · 27/223 = 477/4237
//    Saros .......... e3 · e4/f1 · f2/g1 = 940/4237 (4 turns in 223 months)
//    Exeligmos ...... Saros · g2/h1 · h2/i1 = Saros / 12 (1 turn in 3 Saros)
//    Games .......... Metonic · n3/o1 = 5/19 · 57/60 = 1/4 (one Olympiad)
//
//  PIN AND SLOT. e5 drives k1 and k2 drives e6, all 50 teeth, on the
//  turntable e3. k2 turns on an axis 1.1 mm from the k1 axis. A pin on k1
//  at radius 10 mm runs in a radial slot of k2, so k2 runs fast when the pin
//  is near the k2 axis and slow when it is far. Seen from the turntable, k1
//  turns once per anomalistic month: e5 turns at the sidereal rate, e3 at
//  the slow turn of the lunar apsides. The Moon pointer gets
//      lambda = mean + delta(M),  delta(M) = atan2(sin M, cos M - e) - M
//  with e = 1.1/10 and M the angle of the pin from the offset (0 = fastest).
//
//  TOOTH PHASE. Each meshing gear takes its angle from its driver, so that
//  a tooth of one always sits in a gap of the other:
//      theta2 = phi + pi - pi/N2 - (N1/N2) (theta1 - phi)
//  with phi the direction from the driver centre to the driven centre.
//
//  GREP MAP
//    export const TEETH ......... every wheel, by its published name
//    export const PAIRS ......... the meshes, modules and layers
//    function layout ............ arbor positions from the meshes
//    export const RATE .......... turns per year of each arbor (signed)
//    export const PERIOD ........ the month and cycle lengths in days
//    export function slot ....... delta(M) of the pin and slot
//    export function pose ....... every angle at a day
// ============================================================================

export const TAU = Math.PI * 2;
export const YEAR = 365.25;

export const TEETH = {
  a1: 48, b1: 224, b2: 64, b3: 32, c1: 38, c2: 48, d1: 24, d2: 127,
  e1: 32, e2: 32, e3: 223, e4: 188, e5: 50, e6: 50, k1: 50, k2: 50,
  l1: 38, l2: 53, m1: 96, m2: 15, m3: 27, n1: 53, n3: 57, o1: 60,
  f1: 53, f2: 30, g1: 54, g2: 20, h1: 60, h2: 15, i1: 60,
};
// the wheel -> arbor map (the e axis has three: two pipes and the turntable)
export const ARBOR = {
  a1: 'a', b1: 'b', b2: 'b', b3: 'b3', c1: 'c', c2: 'c', d1: 'd', d2: 'd',
  e2: 'e25', e5: 'e25', e6: 'e61', e1: 'e61', e3: 'e34', e4: 'e34', k1: 'k1', k2: 'k2',
  l1: 'l', l2: 'l', m1: 'm', m2: 'm', m3: 'm', n1: 'n', n3: 'n', o1: 'o',
  f1: 'f', f2: 'f', g1: 'g', g2: 'g', h1: 'h', h2: 'h', i1: 'i',
};
// where each arbor turns: its own centre, or the e axis, or b
export const AXIS = { b3: 'b', e25: 'e', e61: 'e', e34: 'e' };

// Meshes, driver first. m is the module (mm): centre distance m (N1+N2)/2.
// L is the layer (0 = just behind the front plate).
export const PAIRS = [
  { a: 'b2', b: 'c1', m: 0.5, L: 1 },
  { a: 'b2', b: 'l1', m: 0.5, L: 1 },
  { a: 'c2', b: 'd1', m: 0.5, L: 2 },
  { a: 'l2', b: 'm1', m: 0.5, L: 2 },
  { a: 'e1', b: 'b3', m: 0.6, L: 3 },
  { a: 'd2', b: 'e2', m: 0.5, L: 4 },
  { a: 'e5', b: 'k1', m: 0.5, L: 5, turn: true },
  { a: 'k2', b: 'e6', m: 0.5, L: 6, turn: true },
  { a: 'm3', b: 'e3', m: 0.45, L: 7 },
  { a: 'e4', b: 'f1', m: 0.5, L: 8 },
  { a: 'm2', b: 'n1', m: 0.9, L: 8 },
  { a: 'f2', b: 'g1', m: 0.6, L: 9 },
  { a: 'n3', b: 'o1', m: 0.5, L: 9 },
  { a: 'g2', b: 'h1', m: 0.5, L: 10 },
  { a: 'h2', b: 'i1', m: 0.5, L: 11 },
];
export const B1_MODULE = 0.55;            // b1 and the contrate a1
export const LAYER = { b1: 0 };
for (const p of PAIRS) { LAYER[p.a] = p.L; LAYER[p.b] = p.L; }
export const MODULE = { b1: B1_MODULE, a1: B1_MODULE };
for (const p of PAIRS) { MODULE[p.a] ??= p.m; MODULE[p.b] ??= p.m; }
// the pitch radius of each wheel in its own mesh (b2 meshes twice at 0.5)
export const pitchR = (w, m = MODULE[w]) => TEETH[w] * m / 2;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
export const cd = p => p.m * (TEETH[p.a] + TEETH[p.b]) / 2;

// pin and slot: the two k axes on the turntable, 1.1 mm apart
export const SLOT = { d: 1.1, r: 10 };
export const ECC = SLOT.d / SLOT.r;

// dial sizes (mm): spiral inner and outer radius, turns, cells
export const DIALS = {
  front: { rIn: 46, rOut: 74 },
  metonic: { rIn: 40, rOut: 63, turns: 5, cells: 235 },
  saros: { rIn: 40, rOut: 63, turns: 4, cells: 223 },
  games: { r: 8.5, sectors: 4 },
  exeligmos: { r: 8.5, sectors: 3 },
};

export function circle2(p1, r1, p2, r2, pick = 0) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.hypot(dx, dy);
  if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) throw new Error('no circle intersection');
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = p1[0] + a * dx / d, my = p1[1] + a * dy / d;
  return pick ? [mx - h * dy / d, my + h * dx / d] : [mx + h * dy / d, my - h * dx / d];
}
const polar = (p, r, deg) => [p[0] + r * Math.cos(deg * Math.PI / 180), p[1] + r * Math.sin(deg * Math.PI / 180)];
const pair = (a, b) => PAIRS.find(p => p.a === a && p.b === b);

// Arbor centres. b is the front dial centre, n the Metonic dial centre, g
// the Saros dial centre. The other arbors follow from their meshes.
export const LP = { c: -170, d: 0, m: 91, l: 0, n: 88, o: 78, g: [-1, -95], f: 1, h: 135, i: -142 };
export function layout(q = LP) {
  const P = {};
  P.b = [0, 0];
  P.e = polar(P.b, cd(pair('e1', 'b3')), -90);
  P.c = polar(P.b, cd(pair('b2', 'c1')), q.c);
  P.d = circle2(P.c, cd(pair('c2', 'd1')), P.e, cd(pair('d2', 'e2')), q.d);
  P.m = polar(P.e, cd(pair('m3', 'e3')), q.m);
  P.l = circle2(P.b, cd(pair('b2', 'l1')), P.m, cd(pair('l2', 'm1')), q.l);
  P.n = polar(P.m, cd(pair('m2', 'n1')), q.n);
  P.o = polar(P.n, cd(pair('n3', 'o1')), q.o);
  P.g = q.g.slice();
  P.f = circle2(P.e, cd(pair('e4', 'f1')), P.g, cd(pair('f2', 'g1')), q.f);
  P.h = polar(P.g, cd(pair('g2', 'h1')), q.h);
  P.i = polar(P.h, cd(pair('h2', 'i1')), q.i);
  return P;
}
export let AT = layout();
// k axes in the turntable frame (about e, angle 0 = turntable +X)
const kR = cd(pair('e5', 'k1')), kHalf = Math.asin(SLOT.d / 2 / kR);
export const K_AT = { k1: polar([0, 0], kR, 40 - kHalf * 180 / Math.PI), k2: polar([0, 0], kR, 40 + kHalf * 180 / Math.PI) };
// the contrate a1: its axle along +X at the b1 rim, its centre below b1
export const CRANK = { x: pitchR('b1') + 0.75, r: pitchR('a1') };
export const centreOf = arbor => AT[AXIS[arbor] || arbor] || AT[arbor];

// ── rates (turns per year of b1), signed: +1 = counterclockwise from the front
function rates() {
  const R = { b: 1, a: -TEETH.b1 / TEETH.a1 };
  const arbRate = w => R[ARBOR[w]];
  const order = PAIRS.filter(p => !p.turn);
  // pin and slot: on average k2 = k1, so e6 follows e5
  let left = order.slice(), guard = 0;
  while (left.length && guard++ < 50) {
    left = left.filter(p => {
      const ra = arbRate(p.a);
      if (ra === undefined) return true;
      R[ARBOR[p.b]] = -ra * TEETH[p.a] / TEETH[p.b];
      if (p.a === 'd2') R.e61 = R.e25;              // through the pin and slot
      return false;
    });
  }
  return R;
}
export const RATE = rates();

// ── periods in days ─────────────────────────────────────────────────────────
const yr = r => YEAR / Math.abs(r);
export const PERIOD = {
  year: YEAR,
  sidereal: yr(RATE.b3),
  synodic: yr(RATE.b3 - RATE.b),
  anomalistic: yr(RATE.e25 - RATE.e34),
  apsides: yr(RATE.e34),
  metonic: yr(RATE.n) * DIALS.metonic.turns,
  saros: yr(RATE.g) * DIALS.saros.turns,
  exeligmos: yr(RATE.i),
  games: yr(RATE.o),
  crank: yr(RATE.a),
};

// delta(M): the pin and slot output minus the input, for pin angle M
export const slot = (M, e = ECC) => {
  let x = Math.atan2(Math.sin(M), Math.cos(M) - e) - M;
  while (x > Math.PI) x -= TAU; while (x < -Math.PI) x += TAU;
  return x;
};
const meshAng = (th1, N1, N2, phi) => phi + Math.PI - Math.PI / N2 - (N1 / N2) * (th1 - phi);
const dirOf = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
const wrap = x => ((x % TAU) + TAU) % TAU;
const wrapPi = x => wrap(x + Math.PI) - Math.PI;

// the raw train at day t: arbor angles (rad) with tooth phase
function train(t, ecc) {
  const A = {}, th = TAU * t / YEAR;
  A.b = th;
  A.a = -th * TEETH.b1 / TEETH.a1;
  const go = (a, b) => { A[ARBOR[b]] = meshAng(A[ARBOR[a]], TEETH[a], TEETH[b], dirOf(centreOf(ARBOR[a]), centreOf(ARBOR[b]))); };
  go('b2', 'c1'); go('b2', 'l1'); go('c2', 'd1'); go('l2', 'm1');
  go('d2', 'e2'); go('m3', 'e3'); go('m2', 'n1'); go('n3', 'o1');
  go('e4', 'f1'); go('f2', 'g1'); go('g2', 'h1'); go('h2', 'i1');
  // the turntable frame: e5 drives k1, the pin drives k2, k2 drives e6
  const t3 = A.e34, A1 = K_AT.k1, B2 = K_AT.k2, O = [0, 0];
  const e5r = A.e25 - t3;
  const k1r = meshAng(e5r, TEETH.e5, TEETH.k1, dirOf(O, A1));
  // the pin sits at k1 local angle 0; the slot is k2 local angle 0
  const u = dirOf(A1, B2), M = k1r - u;
  const Bk = ecc === 0 ? A1 : B2;
  const pin = [A1[0] + SLOT.r * Math.cos(k1r), A1[1] + SLOT.r * Math.sin(k1r)];
  const k2r = ecc === 0 ? k1r : k1r + wrapPi(Math.atan2(pin[1] - Bk[1], pin[0] - Bk[0]) - k1r);
  const e6r = meshAng(k2r, TEETH.k2, TEETH.e6, dirOf(B2, O));
  A.k1 = k1r + t3; A.k2 = k2r + t3; A.e61 = e6r + t3;
  A.b3 = meshAng(A.e61, TEETH.e1, TEETH.b3, dirOf(AT.e, AT.b));
  A.M = M; A.pin = pin;
  return A;
}
const T0 = train(0, ECC), T0m = train(0, 0);
// the Moon pointer sits on b3 so that the mean Moon is 0 at day 0
const MOON0 = T0m.b3;

// pose(t): every angle at day t (days from the setting at 0)
export function pose(t) {
  const A = train(t, ECC), Am = train(t, 0);
  const sun = A.b, moon = A.b3 - MOON0, mean = Am.b3 - MOON0;
  // the back pointers turn clockwise seen from the front: count them as
  // seen from the back, where they run forward
  const met = (A.n - T0.n) * Math.sign(RATE.n), sar = (A.g - T0.g) * Math.sign(RATE.g);
  const mt = ((met / TAU) % 5 + 5) % 5, st = ((sar / TAU) % 4 + 4) % 4;
  // M from perigee (0 = the pin nearest the k2 axis)
  const M = wrap(A.M);
  // the turntable centre-frame k axes in the plane
  const c = Math.cos(A.e34), s = Math.sin(A.e34), rot = p => [AT.e[0] + c * p[0] - s * p[1], AT.e[1] + s * p[0] + c * p[1]];
  return {
    t, A, M,
    sun, moon, mean, anomaly: moon - mean,
    phase: wrap(moon - sun),
    k1At: rot(K_AT.k1), k2At: rot(K_AT.k2), pinAt: rot(A.pin),
    metonic: { angle: met, turn: mt, month: Math.floor(mt * DIALS.metonic.cells / 5) + 1 },
    saros: { angle: sar, turn: st, month: Math.floor(st * DIALS.saros.cells / 4) + 1 },
    games: { angle: (A.o - T0.o) * Math.sign(RATE.o), year: Math.floor(wrap((A.o - T0.o) * Math.sign(RATE.o)) / TAU * 4) + 1 },
    exeligmos: { angle: (A.i - T0.i) * Math.sign(RATE.i), sector: Math.floor(wrap((A.i - T0.i) * Math.sign(RATE.i)) / TAU * 3) },
  };
}

// ── depth: layers, arbor spans, and a clash check ─────────────────────────────
// Layer L has its face at hOf(L); a driver wheel is 2 mm thick below it, the
// driven wheel of the pair 1.2 mm thick and 0.4 mm lower each side, so no two
// meshing faces share a plane. The front plate is h 0..2.5, the back plate
// lies behind layer 11.
export const PLATE = { front: [0, 2.5], back: [-47.5, -45] };
export const hOf = L => -4 - 3.4 * L;
export const tipR = w => pitchR(w) + MODULE[w];
// arbor spans in layers, with the dial arbors run out to a plate (-1 front,
// 12 back) and the radius of the rod or pipe
export const SPAN = {
  b: [-1, 1, 1.6], b3: [-1, 3, 2.6], a: null, c: [1, 2, 1.2], l: [1, 2, 1.2], d: [2, 4, 1.2],
  m: [2, 8, 1.2], n: [8, 12, 1.4], o: [9, 12, 1.2], f: [8, 9, 1.2], g: [9, 12, 1.4], h: [10, 11, 1.2], i: [11, 12, 1.2],
  e: [3, 8, 1.4],
};
// every wheel that would block an arbor: [wheel, centre, tip radius, layer]
function wheelsAt() {
  const out = [];
  for (const w in TEETH) {
    if (w === 'a1' || w === 'k1' || w === 'k2') continue;
    out.push([w, centreOf(ARBOR[w]), tipR(w), LAYER[w]]);
  }
  return out;
}
// clashes(): a list of text lines, empty when the layout is clean
export function clashes(gap = 0.5, at = AT) {
  const AT0 = AT; AT = at;
  try { return clashList(gap); } finally { AT = AT0; }
}
function clashList(gap) {
  const out = [], W = wheelsAt(), meshes = new Set(PAIRS.map(p => p.a + '/' + p.b));
  const same = (w1, w2) => (AXIS[ARBOR[w1]] || ARBOR[w1]) === (AXIS[ARBOR[w2]] || ARBOR[w2]);
  // 1. wheels of one layer that do not mesh
  for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
    const [a, pa, ra, La] = W[i], [b, pb, rb, Lb] = W[j];
    if (La !== Lb || same(a, b) || meshes.has(a + '/' + b) || meshes.has(b + '/' + a)) continue;
    const d = dist(pa, pb);
    if (d < ra + rb + gap) out.push(`${a} and ${b} overlap in layer ${La} (${d.toFixed(1)} < ${(ra + rb + gap).toFixed(1)})`);
  }
  // 2. an arbor through a wheel that is not its own
  for (const ar in SPAN) {
    const sp = SPAN[ar]; if (!sp) continue;
    const p = centreOf(ar);
    for (const [w, pw, rw, Lw] of W) {
      if (Lw < sp[0] || Lw > sp[1] || (AXIS[ARBOR[w]] || ARBOR[w]) === (AXIS[ar] || ar)) continue;
      const d = dist(p, pw);
      if (d < rw + sp[2] + gap) out.push(`arbor ${ar} runs through ${w} in layer ${Lw} (${d.toFixed(1)} < ${(rw + sp[2] + gap).toFixed(1)})`);
    }
  }
  // 3. the k wheels sweep a ring round e in layers 5 and 6
  const kR = dist([0, 0], K_AT.k1), kr = tipR('k1') + SLOT.d;
  for (const ar in SPAN) {
    const sp = SPAN[ar]; if (!sp || ar === 'e' || sp[0] > 6 || sp[1] < 5) continue;
    const d = dist(centreOf(ar), AT.e);
    if (d > kR - kr - sp[2] - gap && d < kR + kr + sp[2] + gap) out.push(`arbor ${ar} is in the path of the k wheels (${d.toFixed(1)} from e)`);
  }
  // 4. the contrate a1: a disc in the y-h plane at x = CRANK.x, below b1
  const cy = 0, cr = CRANK.r + B1_MODULE + gap;
  for (const [w, pw, rw, Lw] of W) {
    if (w === 'b1') continue;
    const h = hOf(Lw) - 1, hc = hOf(0) - 1 - CRANK.r;
    if (Math.abs(pw[0] - CRANK.x) < rw + 2 && Math.hypot(pw[1] - cy, h - hc) < cr + rw) out.push(`${w} hits the contrate a1`);
  }
  return out;
}

// the spiral radius at a pointer turn count x (0..turns)
export const spiralR = (D, x) => D.rIn + (D.rOut - D.rIn) * x / D.turns;
export const DEG = 180 / Math.PI;
