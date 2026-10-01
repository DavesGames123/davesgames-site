// ============================================================================
//  WATCH MOVEMENT  ·  movement.js — the calibre: layout, profiles, kinematics
// ────────────────────────────────────────────────────────────────────────────
//  An original 18,000 vph pocket-watch calibre in millimetres. The tooth
//  counts and modules follow the Unitas / ETA 6497 class: a 36.6 mm plate,
//  barrel module 0.19, centre wheel 1 turn per hour, small seconds at 6.
//  This module has no DOM and no THREE, so tests.mjs runs it in Node.
//
//  FRAME
//    x right, y to 12 o'clock (the crown), z out of the caseback. The dial
//    faces -z. The plate top is z = 0. A positive angle turns
//    counterclockwise as seen from the caseback, which is clockwise on the
//    dial, so the hands read the right way.
//
//  POWER PATH  (driver wheel / driven pinion, module)
//    barrel 80 / centre pinion 10 (0.19)    barrel 1 turn in 8 h
//    centre 80 / third pinion 10   (0.125)  centre 1 turn in 1 h
//    third  75 / fourth pinion 10  (0.12)   third  1 turn in 7.5 min
//    fourth 80 / escape pinion 8   (0.10)   fourth 1 turn in 1 min
//    escape wheel 15 teeth, Swiss lever, balance at 2.5 Hz = 18,000 vph
//    motion works: cannon pinion 12 / minute wheel 36, pinion 10 / hour 40
//    keyless works: crown wheel 24 / ratchet 50 on the barrel arbor,
//    winding pinion 16 on the stem
//
//  MESH PHASE
//    Each gear has tooth k at angle th + k * TAU / N. For driver A and
//    driven B on the line of centres at angle f, a tooth of A at f must face
//    a gap of B at f + PI. drive() returns that angle of B. The test file
//    sweeps every mesh and checks that no tooth outline enters another.
//
//  ESCAPEMENT
//    The fork angle follows the impulse jewel of the balance and stops on
//    the banking at +-FORK_BANK. The escape wheel turns as far as the
//    pallet stones allow. solveEscapement() finds that limit by collision
//    of the real outlines, once, over one beat each way, and stores tables.
//    pose() then reads the tables, so any time rate gives the same answer.
//
//  GREP MAP
//    export const CAL ............. tooth counts, modules, z planes
//    export const LAYOUT .......... arbor positions (solved, not typed)
//    function gearProfile ......... wheel teeth and pinion leaves
//    function escapeProfile ....... Swiss club teeth
//    function stonePolys .......... the pallet stones at a fork angle
//    function solveEscapement ..... beat tables by outline collision
//    function drive / function chain  mesh phase and the whole train
//    function createState / step / pose  the running watch
// ============================================================================

export const TAU = Math.PI * 2;
const D = Math.PI / 180;
export const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = a => Math.hypot(a[0], a[1]);
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const rot = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ── the calibre ─────────────────────────────────────────────────────────────
export const CAL = {
  plateR: 18.3, plateT: 1.6,
  bph: 18000, fBal: 2.5,
  barrel: { N: 80, m: 0.19 },
  center: { N: 80, m: 0.125, p: 10, pm: 0.19 },
  third: { N: 75, m: 0.12, p: 10, pm: 0.125 },
  fourth: { N: 80, m: 0.10, p: 10, pm: 0.12 },
  escape: { N: 15, Ra: 2.3, Rf: 1.72, p: 8, pm: 0.10 },
  cannon: { N: 12, m: 0.15 },
  minute: { N: 36, m: 0.15, p: 10, pm: 0.144 },
  hour: { N: 40, m: 0.144 },
  ratchet: { N: 50, m: 0.16 },
  crown: { N: 24, m: 0.16 },
  winding: { N: 16, m: 0.16 },
  balR: 5.0, jewelR: 1.2, forkLen: 3.4, forkBank: 12 * D, palletSpan: 30 * D,
  // z planes: the mid height of each toothed part
  z: {
    center: 0.45, fourth: 0.45, third: 1.15, escape: 1.15, fork: 1.15, barrelTeeth: 1.0,
    barrelLo: 0.85, barrelHi: 2.45, bridgeLo: 2.6, bridgeHi: 3.8, palletCockHi: 3.25,
    balance: 4.05, hairspring: 4.7, cockLo: 5.05, cockHi: 6.0, ratchet: 4.0,
    cannon: -1.85, minute: -1.85, hour: -2.25, dialLo: -3.0, dialHi: -2.7,
  },
  reserveTurns: 5.8,          // a full wind: 5.8 barrel turns = 46 h
};

// pitch radius and centre distance of a mesh
export const pitchR = (m, N) => m * N / 2;
export const centreDist = (m, N1, N2) => m * (N1 + N2) / 2;

// intersection of two circles, the one on the side of sgn
function circleX(c0, r0, c1, r1, sgn) {
  const d = len(sub(c1, c0));
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const u = [(c1[0] - c0[0]) / d, (c1[1] - c0[1]) / d];
  const m = add(c0, [u[0] * a, u[1] * a]);
  return [m[0] - sgn * u[1] * h, m[1] + sgn * u[0] * h];
}

// ── layout: every arbor position follows from the centre distances ─────────
function buildLayout() {
  const c = CAL;
  const C = [0, 0];
  const B = pol(centreDist(c.barrel.m, c.barrel.N, c.center.p), 120 * D);
  const F = [0, -10.25];
  const T = circleX(C, centreDist(c.center.m, c.center.N, c.third.p), F, centreDist(c.third.m, c.third.N, c.fourth.p), 1);
  const E = add(F, pol(centreDist(c.fourth.m, c.fourth.N, c.escape.p), -30 * D));
  const psi = 40 * D;                                   // escape to pallet arbor
  const P = add(E, pol(c.escape.Ra / Math.cos(c.palletSpan), psi));
  const Bal = add(P, pol(c.forkLen + c.jewelR, psi));
  const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
  const cdRC = centreDist(c.ratchet.m, c.ratchet.N, c.crown.N);
  const CW = [0, B[1] + Math.sqrt(cdRC * cdRC - B[0] * B[0])];
  const cockFoot = add(Bal, pol(7.6, 60 * D));
  const palletFoot = add(P, pol(1.9, psi - 90 * D));
  const click = add(B, pol(5.35, 222 * D));
  return { C, B, T, F, E, P, Bal, M, CW, psi, cockFoot, palletFoot, click };
}
export const LAYOUT = buildLayout();

// ── profiles (closed polygons, CCW, local frame, tooth 0 on +x) ─────────────
// Wheel teeth: radial flanks under the pitch circle and a half-ellipse
// addendum, the classic horological ogive. Pinion leaves are thinner and
// lower. o.t is the tooth share of the pitch at the pitch circle.
export function gearProfile(N, m, o = {}) {
  const R = m * N / 2, ha = (o.ha ?? 1.25) * m, hf = (o.hf ?? 1.6) * m, t = o.t ?? 0.46, S = o.seg ?? 5;
  const Rf = R - hf, pitch = TAU / N, half = t * Math.PI / N, out = [];
  for (let k = 0; k < N; k++) {
    const c = k * pitch;
    out.push(pol(Rf, c - half), pol(R, c - half));
    for (let i = 1; i < S; i++) { const f = i / S * Math.PI / 2, r = R + ha * Math.sin(f); out.push(pol(r, c - half * R * Math.cos(f) / r)); }
    out.push(pol(R + ha, c));
    for (let i = S - 1; i >= 1; i--) { const f = i / S * Math.PI / 2, r = R + ha * Math.sin(f); out.push(pol(r, c + half * R * Math.cos(f) / r)); }
    out.push(pol(R, c + half), pol(Rf, c + half));
    const gap = pitch - 2 * half;
    for (let j = 1; j <= 2; j++) out.push(pol(Rf, c + half + gap * j / 3));
  }
  return out;
}
export const wheelProfile = (N, m) => gearProfile(N, m, { t: 0.46, ha: 1.25, hf: 1.6 });
export const pinionProfile = (N, m) => gearProfile(N, m, { t: 0.36, ha: 0.7, hf: 1.6, seg: 4 });

// Swiss club teeth. The wheel turns clockwise (seen from the caseback), so
// each tooth leans toward -angle: the locking corner leads, the club face
// slopes back down to the trailing root.
export function escapeProfile(N = CAL.escape.N, Ra = CAL.escape.Ra, Rf = CAL.escape.Rf) {
  const p = TAU / N, out = [];
  for (let k = 0; k < N; k++) {
    const c = k * p;
    for (let j = 0; j <= 3; j++) out.push(pol(Rf, c - 0.72 * p + 0.57 * p * j / 3));
    out.push(pol(Ra, c - 0.30 * p));           // locking corner
    out.push(pol(Ra - 0.02, c - 0.22 * p));
    out.push(pol(Ra - 0.13, c - 0.10 * p));    // end of the club face
    out.push(pol(Rf + 0.28, c + 0.05 * p));
    out.push(pol(Rf + 0.06, c + 0.22 * p));
  }
  return out;
}

export function circlePoly(r, n = 48, c = [0, 0]) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(add(c, pol(r, i / n * TAU)));
  return out;
}

// convex hull (monotone chain) of sampled circles, CCW
export function hullOfCircles(circles, n = 40) {
  const pts = [];
  for (const [c, r] of circles) for (let i = 0; i < n; i++) pts.push(add(c, pol(r, i / n * TAU)));
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

// windows between the spokes of a wheel (holes for the THREE shape)
export function spokeWindows(rIn, rOut, spokes, spokeW, n = 14) {
  const out = [];
  for (let s = 0; s < spokes; s++) {
    const a0 = s * TAU / spokes, a1 = a0 + TAU / spokes;
    const wi = spokeW / 2 / rIn, wo = spokeW / 2 / rOut, w = [];
    for (let i = 0; i <= n; i++) w.push(pol(rOut, a0 + wo + (a1 - a0 - 2 * wo) * i / n));
    for (let i = n; i >= 0; i--) w.push(pol(rIn, a0 + wi + (a1 - a0 - 2 * wi) * i / n));
    out.push(w);
  }
  return out;
}

// ── polygon tests (also used by tests.mjs) ─────────────────────────────────
export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segX(a, b, c, d) {
  const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}
export function polysOverlap(A, Bp) {
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    for (let j = 0; j < Bp.length; j++) if (segX(a, b, Bp[j], Bp[(j + 1) % Bp.length])) return true;
  }
  return inPoly(A[0], Bp) || inPoly(Bp[0], A);
}
export const place = (poly, c, a) => poly.map(p => add(c, rot(p, a)));

// ── mesh phase ──────────────────────────────────────────────────────────────
// driver A at angle thA with NA teeth, driven B with NB, line of centres at f
export const drive = (thA, NA, NB, f) => f + Math.PI - Math.PI / NB + (f - thA) * NA / NB;
// the inverse: the driver angle that puts the driven gear at thB
export const driveInv = (thB, NA, NB, f) => f - (thB - f - Math.PI + Math.PI / NB) * NB / NA;

// the whole going train and the motion works from the escape wheel angle.
// ESC_PINION_PHASE is the free angle between the escape wheel teeth and
// its pinion leaves on the same arbor.
const ESC_PINION_PHASE = 0.0;
export function chain(thE) {
  const L = LAYOUT, c = CAL;
  const escPinion = thE + ESC_PINION_PHASE;
  const fourth = driveInv(escPinion, c.fourth.N, c.escape.p, ang(L.F, L.E));
  const third = driveInv(fourth, c.third.N, c.fourth.p, ang(L.T, L.F));
  const center = driveInv(third, c.center.N, c.third.p, ang(L.C, L.T));
  const barrel = driveInv(center, c.barrel.N, c.center.p, ang(L.B, L.C));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(L.C, L.M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(L.M, L.C));
  return { escape: thE, escPinion, fourth, third, center, barrel, minute, hour, cannon: center };
}
// keyless works from the ratchet (barrel arbor) angle
export function keyless(thR) {
  const L = LAYOUT, c = CAL;
  const crown = driveInv(thR, c.crown.N, c.ratchet.N, ang(L.CW, L.B));
  return { ratchet: thR, crown, stem: -crown * c.crown.N / c.winding.N };
}

// ── escapement ──────────────────────────────────────────────────────────────
// The two pallet stones as polygons in the world frame at fork angle g.
// Each stone is a bar along the radius of the escape wheel at angle
// psi +- palletSpan. Its inner end slopes (the impulse face): the upstream
// corner sits higher than the downstream corner. Upstream is +angle, since
// the wheel turns toward -angle.
const STONE_W = 0.30, STONE_L = 1.05, DEPTH_UP = -0.12, DEPTH_DOWN = 0.18;
export function stonePolys(g) {
  const L = LAYOUT, Ra = CAL.escape.Ra, out = [];
  for (const sgn of [1, -1]) {
    const a = L.psi + sgn * CAL.palletSpan;
    const r = [Math.cos(a), Math.sin(a)], t = [-r[1], r[0]];
    const P0 = (dep, side) => add(L.E, [r[0] * (Ra - dep) + t[0] * side, r[1] * (Ra - dep) + t[1] * side]);
    const poly = [
      P0(DEPTH_DOWN, -STONE_W / 2), P0(-STONE_L, -STONE_W / 2),
      P0(-STONE_L, STONE_W / 2), P0(DEPTH_UP, STONE_W / 2),
    ];
    out.push(poly.map(p => add(L.P, rot(sub(p, L.P), g))));
  }
  return out;
}

// the fork angle that the impulse jewel sets at balance angle b
export const forkAngle = b => clamp(-b * CAL.jewelR / CAL.forkLen, -CAL.forkBank, CAL.forkBank);
export const liftAngle = () => CAL.forkBank * CAL.forkLen / CAL.jewelR;

// largest clockwise turn from th0 that stays clear of the stones
const ESC = escapeProfile();
function escapeHits(th, stones) {
  const poly = place(ESC, LAYOUT.E, th);
  return stones.some(s => polysOverlap(s, poly));
}
function advance(th0, stones, maxTurn) {
  const step = 0.0015;
  let th = th0;
  if (escapeHits(th, stones)) {
    // a stone moved into a tooth: the tooth gives way (recoil or push on)
    let found = null;
    for (let k = 1; k * step < maxTurn / 2 && found === null; k++) {
      if (!escapeHits(th0 + k * step, stones)) found = th0 + k * step;
      else if (!escapeHits(th0 - k * step, stones)) found = th0 - k * step;
    }
    if (found === null) return { th, jammed: true };
    th0 = th = found;
  }
  for (let k = 0; ; k++) {
    if (th0 - th > maxTurn) return { th, runaway: true };
    if (escapeHits(th - step, stones)) {
      let lo = th, hi = th - step;                     // lo clear, hi hits
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (escapeHits(mid, stones)) hi = mid; else lo = mid; }
      return { th: lo };
    }
    th -= step;
  }
}

// One beat each way, sampled over the fork angle. Table A: fork from +bank
// to -bank (balance swings toward +). Table B: back again. Each table holds
// the escape angle relative to the lock at the start of the beat.
export function solveEscapement(n = 160) {
  const bank = CAL.forkBank, pitch = TAU / CAL.escape.N;
  let th = advance(0, stonePolys(bank), 2 * pitch).th;   // first lock
  th = advance(th, stonePolys(bank), 2 * pitch).th;
  const start = th, A = [], Bt = [];
  let bad = 0; const log = [];
  const run = (g0, g1, tab) => {
    const base = th;
    for (let i = 0; i <= n; i++) {
      const g = g0 + (g1 - g0) * i / n;
      const r = advance(th, stonePolys(g), pitch);
      if (r.runaway || r.jammed) { bad++; log.push([tab === A ? 'A' : 'B', i, r.runaway ? 'run' : 'jam']); }
      th = r.th; tab.push(th - base);
    }
  };
  run(bank, -bank, A);
  const mid = th;
  run(-bank, bank, Bt);
  return { start, A, B: Bt, n, a: mid - start, b: th - mid, cycle: th - start, bad, log };
}
export const ESCAPEMENT = solveEscapement();

// table lookup: progress u in [0,1] across one beat
function look(tab, u) {
  const x = clamp(u, 0, 1) * (tab.length - 1), i = Math.min(tab.length - 2, Math.floor(x)), f = x - i;
  return tab[i] + (tab[i + 1] - tab[i]) * f;
}

// ── the running watch ──────────────────────────────────────────────────────
// phi is the balance phase: b = A sin(phi). Beat k is the zero crossing at
// phi = k PI. Even k swings toward +b (table A), odd k back (table B).
export function createState(clockSeconds = 0, reserveFrac = 0.85) {
  const beats = 2 * Math.round(clockSeconds / 0.4);   // even: a whole cycle
  const s = { phi: beats * Math.PI - Math.PI / 2 + 1e-3, windR: 0, reserve0: 0, amp: 0, stopped: false };
  // reserve0 so that the reserve reads reserveFrac of a full wind right now
  const ch = chain(escapeAngle(s.phi, liftAngle() * 2));
  s.reserve0 = CAL.reserveTurns * reserveFrac - (ch.barrel - chain(ESCAPEMENT.start).barrel) / TAU;
  s.amp = amplitudeFor(CAL.reserveTurns * reserveFrac);
  return s;
}

export function amplitudeFor(reserve) {
  if (reserve <= 0) return 0;
  return (300 * Math.min(1, 0.62 + 0.38 * reserve / 2)) * D;
}

// escape angle at balance phase phi (for any beat index)
export function escapeAngle(phi, amp) {
  const E = ESCAPEMENT;
  const k = Math.round(phi / Math.PI);
  const d = phi - k * Math.PI;                       // -PI/2 .. PI/2
  const b = amp * Math.sin(d);                       // balance angle in the local swing direction
  const g = forkAngle(b);                            // +bank before, -bank after
  const u = (CAL.forkBank - g) / (2 * CAL.forkBank);
  const cyc = Math.floor(k / 2), odd = k - 2 * cyc;
  return E.start + cyc * E.cycle + (odd ? E.a + look(E.B, u) : look(E.A, u));
}

// train time in seconds since 12:00 at an escape angle (whole beats: 0.2 s)
export const escapeToSeconds = thE => (thE - ESCAPEMENT.start) / ESCAPEMENT.cycle * 0.4;

const C0 = chain(ESCAPEMENT.start);
// reserve in barrel turns: winding (ratchet turns clockwise, -angle) adds,
// the barrel drum running down (also -angle) subtracts
export function reserveOf(s, ch) { return s.reserve0 + ((ch.barrel - C0.barrel) - (s.windR)) / TAU; }

// advance the state by dt seconds of watch time; wind = ratchet turn (rad, <= 0)
export function step(s, dt, wind = 0) {
  if (wind) {
    s.windR += wind;
    const ch = chain(escapeAngle(s.phi, s.amp));
    const r = reserveOf(s, ch);
    if (r > CAL.reserveTurns) s.windR += (r - CAL.reserveTurns) * TAU;   // the bridle slips
  }
  const ch = chain(escapeAngle(s.phi, s.amp));
  const r = reserveOf(s, ch);
  const target = amplitudeFor(r);
  s.amp += (target - s.amp) * Math.min(1, dt * 1.5);
  s.stopped = r <= 0 || s.amp < liftAngle() * 1.05;
  if (!s.stopped) s.phi += TAU * CAL.fBal * dt;
  else {
    // at rest the balance settles to the middle of its swing
    const k = Math.round(s.phi / Math.PI), d = s.phi - k * Math.PI;
    if (Math.abs(d) > 1e-4) s.phi = k * Math.PI + d * Math.max(0, 1 - dt * 3);
    if (r > 0.02) s.amp = Math.max(s.amp, liftAngle() * 1.2), s.stopped = false;
  }
}

// every angle the scene needs
export function pose(s) {
  const thE = escapeAngle(s.phi, s.amp);
  const ch = chain(thE);
  const k = Math.round(s.phi / Math.PI), d = s.phi - k * Math.PI;
  const bal = s.amp * Math.sin(d) * (k % 2 === 0 ? 1 : -1);
  const kl = keyless(s.windR);
  const reserve = reserveOf(s, ch);
  const secs = escapeToSeconds(thE);
  return {
    ...ch, balance: bal, fork: forkAngle(bal), ratchet: kl.ratchet, crown: kl.crown, stem: kl.stem,
    reserve, seconds: secs, beats: k,
    hands: { hour: ch.hour - C0.hour, minute: ch.center - C0.center, second: ch.fourth - C0.fourth },
  };
}

// rotation periods in seconds (for the train table)
export function periods() {
  const c = CAL, esc = c.escape.N * 2 / (c.bph / 3600);
  const fourth = esc * c.fourth.N / c.escape.p, third = fourth * c.third.N / c.fourth.p;
  const center = third * c.center.N / c.third.p, barrel = center * c.barrel.N / c.center.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape: esc, fourth, third, center, barrel, minute, hour, balance: 1 / c.fBal };
}
