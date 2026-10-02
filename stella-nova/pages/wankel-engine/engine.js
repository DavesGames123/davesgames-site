// ============================================================================
//  WANKEL ENGINE  ·  engine.js — the geometry, the kinematics and the cycle
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm,
//  radians and bar. The shaft axis is z. The housing is drawn in the xy
//  plane with its major axis on x. The spark plugs sit at the top waist
//  (+y) and the two ports at the bottom waist (-y). The rotor turns
//  counter-clockwise when seen from +z (from the front).
//
//  THE CURVES
//    Housing (epitrochoid), for the rotor angle a:
//      x = e cos 3a + R cos a,   y = e sin 3a + R sin a
//    Rotor centre  c = e (cos t, sin t), t the shaft angle, t = 3a.
//    Apex k of the rotor sits at  c + R (cos(a + 2πk/3), sin(a + 2πk/3)),
//    which is the housing point for the rotor angle a + 2πk/3. So the three
//    apexes always touch the housing.
//    Rotor flank: the inner envelope of the housing seen from the rotor
//    (function envelope). The rotor is the largest shape that turns in the
//    housing on that path.
//
//  THE GEARS
//    The internal ring gear (rotor) has 30 teeth, the stationary gear 20,
//    module 3: pitch radii 45 and 30 mm, centre distance 45 - 30 = e. The
//    ring rolls round the fixed gear, so the rotor turns t (1 - 20/30) =
//    t/3. That is the 3:2 phasing that holds the rotor on its path.
//
//  THE CYCLE
//    Chamber k lies between apex k and apex k+1. Its phase w runs from 0 at
//    the bottom waist: intake (0..π/2), compression, power, exhaust. The
//    pressure is the ideal air-standard Otto cycle on the true volume.
//
//  GREP MAP
//    export const GEO ............ the engine numbers
//    export function housingPt ... the epitrochoid
//    function envelope ........... the rotor flank (polar table)
//    export function rotorOutline  the rotor outline, with or without pockets
//    export function gearOutline . tooth outlines (external and internal)
//    export function kin ......... the pose of one rotor at shaft angle t
//    function buildVolumeTable ... chamber volume against rotor angle
//    export function chambers .... volume, phase, stroke, pressure of each
//    export function torque ...... gas torque on the shaft
//    export function cycleLoop ... the P-V loop and the work of one cycle
// ============================================================================
export const TAU = Math.PI * 2, D = Math.PI / 180;

export const GEO = {
  R: 105, e: 15, W: 80,               // generating radius, eccentricity, rotor width
  clr: 0.9,                           // flank clearance to the housing
  pocket: { depth: 10.5, half: 34 * D, w: 0.6 },   // combustion pocket: depth, half span, part of the width
  gear: { m: 3, ring: 30, fixed: 20 },
  bore: 40, lobe: 37, journal: 21,    // rotor bearing bore, eccentric lobe, main journal radii
  housingOff: 30,                     // housing wall: offset of the outer edge from the trochoid
  gamma: 1.35, pIn: 0.95, pEx: 1.08, pAtm: 1.0, burn: 3.1,   // the air-standard cycle
  spark: 12 * D,                      // ignition, rotor degrees before the top waist
};
export const K = GEO.R / GEO.e;
export const SWEPT = 3 * Math.sqrt(3) * GEO.e * GEO.R * GEO.W;   // mm³, per chamber

export function housingPt(a, R = GEO.R, e = GEO.e) {
  return [e * Math.cos(3 * a) + R * Math.cos(a), e * Math.sin(3 * a) + R * Math.sin(a)];
}
// the outward unit normal of the housing at a
export function housingNormal(a) {
  const { R, e } = GEO;
  const dx = -3 * e * Math.sin(3 * a) - R * Math.sin(a), dy = 3 * e * Math.cos(3 * a) + R * Math.cos(a);
  const l = Math.hypot(dx, dy);
  return [dy / l, -dx / l];
}
export function housingPoly(n = 720, off = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, p = housingPt(a);
    if (off) { const q = housingNormal(a); p[0] += q[0] * off; p[1] += q[1] * off; }
    out.push(p);
  }
  return out;
}

// ── the rotor flank: inner envelope of the housing in the rotor frame ──────
// For each rotor angle a, the housing seen from the rotor centre (turned by
// -a) is a convex curve round the centre. The rotor is the intersection of
// all of them: at each polar angle psi, the least radius.
const NB = 2880;
let ENV = null;
function envelope() {
  if (ENV) return ENV;
  const { R, e } = GEO, env = new Float64Array(NB).fill(1e9);
  const NA = 300, NH = 900;
  const xs = new Float64Array(NH + 1), ys = new Float64Array(NH + 1);
  for (let ia = 0; ia < NA; ia++) {
    const a = ia / NA * TAU / 3, cx = e * Math.cos(3 * a), cy = e * Math.sin(3 * a), ca = Math.cos(-a), sa = Math.sin(-a);
    for (let ih = 0; ih <= NH; ih++) {
      const b = ih / NH * TAU, hx = e * Math.cos(3 * b) + R * Math.cos(b) - cx, hy = e * Math.sin(3 * b) + R * Math.sin(b) - cy;
      xs[ih] = hx * ca - hy * sa; ys[ih] = hx * sa + hy * ca;
    }
    for (let ih = 0; ih < NH; ih++) {
      let p0 = Math.atan2(ys[ih], xs[ih]), p1 = Math.atan2(ys[ih + 1], xs[ih + 1]);
      if (p1 < p0 - Math.PI) p1 += TAU; else if (p1 > p0 + Math.PI) p1 -= TAU;
      const r0 = Math.hypot(xs[ih], ys[ih]), r1 = Math.hypot(xs[ih + 1], ys[ih + 1]);
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      for (let b = Math.ceil(lo / TAU * NB); b <= Math.floor(hi / TAU * NB); b++) {
        const psi = b / NB * TAU, f = hi > lo ? (psi - p0) / (p1 - p0) : 0;
        // the radius along the chord, in polar form (exact for a straight chord)
        const x = xs[ih] + (xs[ih + 1] - xs[ih]) * f, y = ys[ih] + (ys[ih + 1] - ys[ih]) * f;
        const r = Math.hypot(x, y) || Math.min(r0, r1);
        const k = ((b % NB) + NB) % NB;
        if (r < env[k]) env[k] = r;
      }
    }
  }
  // three-fold symmetry: keep the least of the three copies
  for (let k = 0; k < NB / 3; k++) {
    const m = Math.min(env[k], env[k + NB / 3], env[k + 2 * NB / 3]);
    env[k] = env[k + NB / 3] = env[k + 2 * NB / 3] = m;
  }
  ENV = env;
  return env;
}
export function flankR(psi) {
  const env = envelope(), u = ((psi / TAU * NB) % NB + NB) % NB, i = Math.floor(u), f = u - i;
  return env[i] * (1 - f) + env[(i + 1) % NB] * f;
}
// the pocket depth at rotor-frame angle psi (0 outside the pockets)
export function pocketDepth(psi) {
  const { depth, half } = GEO.pocket;
  let d = ((psi - Math.PI / 3) % (TAU / 3) + TAU / 3) % (TAU / 3);   // 0 at a flank middle, wrapped
  if (d > TAU / 6) d -= TAU / 3;
  const x = Math.abs(d) / half;
  return x >= 1 ? 0 : depth * Math.pow(Math.cos(x * Math.PI / 2), 2);
}
// rotor outline in its own frame: n points, counter-clockwise from apex 0
// (psi = 0). o: { pocket: true cuts the pockets, clr: flank clearance }
export function rotorOutline(n = 720, o = {}) {
  const clr = o.clr ?? GEO.clr, out = [];
  for (let i = 0; i < n; i++) {
    const psi = i / n * TAU;
    const r = flankR(psi) - clr - (o.pocket ? pocketDepth(psi) : 0) - (o.inset || 0);
    out.push([r * Math.cos(psi), r * Math.sin(psi)]);
  }
  return out;
}

// ── gears ──────────────────────────────────────────────────────────────────
// A tooth outline in polar form. u = cos(N(φ - ph)) is +1 at a tooth
// middle; sat() turns it into flat tops, flat roots and straight flanks.
// Internal teeth point inward. b thins each tooth (backlash).
const sat = x => Math.max(-1.25, Math.min(1, x));
export function gearR(phi, N, m, internal, ph = 0, b = 0.16, k = 2.0) {
  const rp = m * N / 2, u = Math.cos(N * (phi - ph));
  return internal ? rp - m * sat((u - b) * k) : rp + m * sat((u - b) * k);
}
export function gearOutline(N, m, internal, ph = 0, perTooth = 24) {
  const n = N * perTooth, out = [];
  for (let i = 0; i < n; i++) { const phi = i / n * TAU, r = gearR(phi, N, m, internal, ph); out.push([r * Math.cos(phi), r * Math.sin(phi)]); }
  return out;
}
// Tooth phases, as derived in the header: fixed-gear teeth at 2πj/20, ring
// teeth at π/30 + 2πk/30 in the rotor frame. Tested for clearance in tests.mjs.
export const FIXED_PH = 0, RING_PH = Math.PI / 30;

// ── kinematics ─────────────────────────────────────────────────────────────
// One rotor at shaft angle t. off: the eccentric of this rotor (0, or π
// for the second rotor of a twin).
export function kin(t, off = 0) {
  const { R, e } = GEO, th = t + off, a = th / 3;
  const c = [e * Math.cos(th), e * Math.sin(th)];
  const apex = [], lean = [];
  for (let k = 0; k < 3; k++) {
    const ak = a + k * TAU / 3;
    apex.push(housingPt(ak));
    // the apex seal stands on the rotor radius; the housing normal leans
    const n = housingNormal(ak), ang = Math.atan2(n[1], n[0]) - ak;
    lean.push(Math.atan2(Math.sin(ang), Math.cos(ang)));
  }
  return { t, th, a, c, apex, lean };
}
export const LEAN_MAX = Math.asin(3 / K);   // largest lean of an apex seal

// ── chamber volume ─────────────────────────────────────────────────────────
// Area between the housing arc from apex 0 to apex 1 and the rotor flank,
// with the rotor angle a. The pockets add their area over half the width.
function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }
export function chamberPoly(a, n = 96, o = {}) {
  const { e } = GEO, c = [e * Math.cos(3 * a), e * Math.sin(3 * a)], ca = Math.cos(a), sa = Math.sin(a);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(housingPt(a + i / n * TAU / 3));
  for (let i = n; i >= 0; i--) {
    const psi = i / n * TAU / 3, r = flankR(psi) - (o.clr ?? GEO.clr) - (o.pocket ? pocketDepth(psi) : 0);
    const x = r * Math.cos(psi), y = r * Math.sin(psi);
    pts.push([c[0] + x * ca - y * sa, c[1] + x * sa + y * ca]);
  }
  return pts;
}
const NV = 1440;
let VT = null;
function buildVolumeTable() {
  if (VT) return VT;
  const { W, pocket } = GEO;
  // pocket area per flank (same for every pose)
  let pa = 0; const n = 600;
  for (let i = 0; i < n; i++) {
    const psi = (i + 0.5) / n * TAU / 3, r0 = flankR(psi) - GEO.clr, r1 = r0 - pocketDepth(psi);
    pa += (r0 * r0 - r1 * r1) / 2 * (TAU / 3 / n);
  }
  const v = new Float64Array(NV + 1);
  for (let i = 0; i <= NV; i++) v[i] = polyArea(chamberPoly(i / NV * TAU, 120)) * W + pa * W * pocket.w;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < NV; i++) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); }
  VT = { v, Vmin: lo, Vmax: hi, pocketVol: pa * W * pocket.w, CR: hi / lo };
  return VT;
}
export function volumeAt(a) {
  const T = buildVolumeTable(), u = ((a / TAU * NV) % NV + NV) % NV, i = Math.floor(u), f = u - i;
  return T.v[i] * (1 - f) + T.v[i + 1] * f;
}
export function volumes() { return buildVolumeTable(); }

// ── the cycle on each chamber ──────────────────────────────────────────────
export const STROKES = [
  { id: 'intake', name: 'Intake', col: '#6aa8ff' },
  { id: 'compression', name: 'Compression', col: '#7fdcb8' },
  { id: 'power', name: 'Power', col: '#ff8a4a' },
  { id: 'exhaust', name: 'Exhaust', col: '#a89c8c' },
];
// phase w of chamber k at rotor angle a: 0 when its flank middle is at the
// bottom waist (-y), π at the top waist (the plugs)
export function phaseOf(a, k) { return (((a + Math.PI / 3 + k * TAU / 3 + Math.PI / 2) % TAU) + TAU) % TAU; }
export function pressure(w, V) {
  const { gamma, pIn, pEx, burn } = GEO, T = buildVolumeTable();
  if (w < Math.PI / 2) return pIn;
  if (w < Math.PI) return pIn * Math.pow(T.Vmax / V, gamma);
  if (w < 1.5 * Math.PI) return pIn * Math.pow(T.Vmax / T.Vmin, gamma) * burn * Math.pow(T.Vmin / V, gamma);
  return pEx;
}
// every chamber of one rotor at shaft angle t (with the rotor's eccentric off)
export function chambers(t, off = 0) {
  const a = (t + off) / 3, out = [];
  for (let k = 0; k < 3; k++) {
    const ak = a + k * TAU / 3, V = volumeAt(ak), w = phaseOf(a, k), s = Math.min(3, Math.floor(w / (Math.PI / 2)));
    out.push({ k, V, w, stroke: s, p: pressure(w, V) });
  }
  return out;
}
// gas torque on the shaft (N·m): Σ (p - p_atm) dV/dt over the chambers
export function torque(t, offs = [0]) {
  const h = 1e-3;
  let T = 0;
  for (const off of offs) {
    const a = (t + off) / 3;
    for (let k = 0; k < 3; k++) {
      const ak = a + k * TAU / 3, dV = (volumeAt(ak + h / 3) - volumeAt(ak - h / 3)) / (2 * h);
      const w = phaseOf(a, k), p = pressure(w, volumeAt(ak));
      T += (p - GEO.pAtm) * 1e5 * dV * 1e-9;
    }
  }
  return T;
}
// one full cycle of chamber 0: [{ V (cc), p (bar), w }], the work (J) and
// the mean torque per rotor (N·m): one cycle per rotor per shaft turn
export function cycleLoop(n = 720) {
  const pts = [];
  let Wk = 0, prev = null;
  // w from 0 to 2π: a from (w - π/2 - π/3)
  for (let i = 0; i <= n; i++) {
    const w = i / n * TAU, a = w - Math.PI / 2 - Math.PI / 3, V = volumeAt(a), p = pressure(Math.min(w, TAU - 1e-9), V);
    const q = { V: V / 1000, p, w };
    if (prev) Wk += (q.p + prev.p) / 2 * 1e5 * (q.V - prev.V) * 1e-6;
    pts.push(q); prev = q;
  }
  return { pts, work: Wk, meanTorque: Wk / TAU };
}

// the layouts: one rotor, or two with eccentrics 180 degrees apart
export const VARIANTS = [
  { id: 'single', name: 'Single rotor', kind: '1 × 655 cm³ · bench engine', rotors: [{ zc: 0, s: 1, off: 0 }] },
  { id: 'twin', name: 'Twin rotor', kind: '2 × 655 cm³ · car engine', rotors: [{ zc: 60, s: 1, off: 0 }, { zc: -60, s: -1, off: Math.PI }] },
];
