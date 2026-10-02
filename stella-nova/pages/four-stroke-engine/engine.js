// ============================================================================
//  FOUR-STROKE ENGINE  ·  engine.js — the kinematics and the gas, no DOM
// ────────────────────────────────────────────────────────────────────────────
//  The mechanism as numbers. No THREE and no DOM, so tests.mjs runs it in
//  Node. Units: mm, degrees for the API, bar for pressure, cc for volume.
//
//  FRAME
//    x is the crank axis (cylinder 1 at +x, the timing chain at the front),
//    y points up the bores, z points across the engine (intake at +z).
//    An angle about x counts from +y toward +z, the way the crank turns.
//
//  CYCLE
//    θ is the crank angle, 0..720 for one full cycle. Each cylinder has a
//    cycle angle ψ = θ − φ_k (mod 720), with ψ = 0 at its firing TDC.
//    φ = 0, 180, 360, 540 for cylinders 1, 3, 4, 2: the firing order 1-3-4-2.
//    ψ 0..180 power, 180..360 exhaust, 360..540 intake, 540..720 compression.
//
//  VALVES
//    A cam lobe is a base circle plus a cosine bump. A flat follower (the
//    bucket, or a rocker pad) sits on the support function of the lobe, so
//    the lift comes from the true lobe shape and the follower never cuts
//    into it. The cam turns at θ/2.
//
//  GREP MAP
//    export const GEO ........... bore, stroke, rod, deck, compression ratio
//    export function pistonX .... x(θ) = r cos θ + √(l² − r² sin² θ)
//    function supportTable ...... the lobe lift seen by a flat follower
//    export const TRAINS ........ DOHC 16-valve and SOHC 8-valve geometry
//    export function valveLift .. lift of one valve at a crank angle
//    export function gasState ... V, p and burn fraction for one cylinder
//    export function cycleStats . work, IMEP, torque curve (precomputed)
// ============================================================================
export const D = Math.PI / 180, TAU = Math.PI * 2;
export const mod = (a, m) => ((a % m) + m) % m;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export const GEO = {
  bore: 86, stroke: 86, r: 43, l: 145,
  compH: 28.5,          // piston pin to crown
  skirt: 24,            // piston pin to skirt base
  pitch: 96,            // cylinder spacing along x
  deck: 219,            // block deck height above the crank axis
  seatY: 228,           // valve seat centres
  seatZ: 18,
  incline: 19.2,        // valve angle from the bore axis, degrees
  cr: 10.5, n: 1.32,    // compression ratio, polytropic exponent
  pIn: 0.95, pEx: 1.08, // intake and exhaust pressure, bar
  burnRise: 3.6,        // pressure ratio of a complete burn at constant volume
};
GEO.area = Math.PI / 4 * GEO.bore * GEO.bore;                 // mm²
GEO.Vs = GEO.area * GEO.stroke / 1000;                        // cc per cylinder
GEO.Vc = GEO.Vs / (GEO.cr - 1);
GEO.displacement = GEO.Vs * 4;

export const CYLS = [1, 2, 3, 4];
export const FIRING = [1, 3, 4, 2];
export const FIRE_AT = { 1: 0, 3: 180, 4: 360, 2: 540 };
export const CYL_X = { 1: 144, 2: 48, 3: -48, 4: -144 };
export const STROKES = ['Power', 'Exhaust', 'Intake', 'Compression'];
// target valve events in cycle angle ψ (0 = firing TDC); the lobes are tuned to them
export const TIMING = { ivo: 350, ivc: 580, evo: 140, evc: 370, spark: 705, burn: 55 };
export const LOBE_CENTRE = { in: (TIMING.ivo + TIMING.ivc) / 2, ex: (TIMING.evo + TIMING.evc) / 2 };

// ── slider-crank ────────────────────────────────────────────────────────────
// θ in degrees from TDC. x is the piston pin height above the crank axis.
export function pistonX(th) {
  const { r, l } = GEO, s = Math.sin(th * D);
  return r * Math.cos(th * D) + Math.sqrt(l * l - r * r * s * s);
}
// dx/dθ in mm per radian
export function pistonDx(th) {
  const { r, l } = GEO, s = Math.sin(th * D), c = Math.cos(th * D);
  return -r * s - r * r * s * c / Math.sqrt(l * l - r * r * s * s);
}
// the rod's lean from the bore axis, radians (positive leans the big end to +z)
export const rodLean = th => Math.asin(GEO.r * Math.sin(th * D) / GEO.l);
export const psiOf = (k, th) => mod(th - FIRE_AT[k], 720);
export const strokeOf = psi => STROKES[Math.floor(mod(psi, 720) / 180)];
export const crankOf = (k, th) => mod(th - FIRE_AT[k], 360);   // crank-pin angle of cylinder k

// ── cam lobe and its flat-follower lift ─────────────────────────────────────
export const LOBE = { Rb: 17, L: 8.4, w: 0 };   // w (half width, cam degrees) is solved below
const lobeR = (a, w) => { a = Math.abs(a); return LOBE.Rb + (a < w ? LOBE.L * (0.5 + 0.5 * Math.cos(Math.PI * a / w)) : 0); };
// lift for a follower whose face normal is at β (degrees) from the nose
function supportTable(w, step = 0.5) {
  const n = Math.round(360 / step), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = i * step;
    let h = LOBE.Rb;
    for (let a = -w; a <= w; a += 0.25) h = Math.max(h, lobeR(a, w) * Math.cos((a - b) * D));
    out[i] = h - LOBE.Rb;
  }
  return { step, n, t: out };
}
const liftAt = (T, b) => {
  const f = mod(b, 360) / T.step, i = Math.floor(f), k = f - i;
  return T.t[i % T.n] * (1 - k) + T.t[(i + 1) % T.n] * k;
};
// the polar outline of the lobe for the mesh, angle from the nose
export const lobeOutline = (n = 180) => Array.from({ length: n }, (_, i) => { const a = -180 + 360 * i / n; return [a, lobeR(a, LOBE.w)]; });
export const CHECK_LIFT = 0.15;   // mm: lift taken as "open" for the timing
// solve w so that the crank duration at the check lift is 230°
(function solve() {
  let lo = 30, hi = 90;
  for (let it = 0; it < 22; it++) {
    const w = (lo + hi) / 2, T = supportTable(w, 1);
    let open = 0; for (let i = 0; i < T.n; i++) if (T.t[i] > CHECK_LIFT) open++;
    if (open * 2 > TIMING.ivc - TIMING.ivo) hi = w; else lo = w;
  }
  LOBE.w = (lo + hi) / 2;
})();
export const LIFT = supportTable(LOBE.w);
export const camLift = beta => liftAt(LIFT, beta);   // cam lift at the follower, mm

// ── valve trains ────────────────────────────────────────────────────────────
// Each valve: cylinder k, kind 'in'|'ex', x position, side (+1 intake, −1
// exhaust), head radius, and the lobe phase n0 (degrees) that peaks it at
// the right ψ. dir is the follower direction about x (degrees from +y).
const INC = GEO.incline;
function valves(perSide, xOff, rIn, rEx, dirFor) {
  const out = [];
  for (const k of CYLS) for (const kind of ['in', 'ex']) {
    const side = kind === 'in' ? 1 : -1, dir = dirFor(side);
    const xs = perSide === 2 ? [-xOff, xOff] : [kind === 'in' ? -xOff : xOff];
    for (const dx of xs) {
      // peak when ψ = centre, i.e. θ = centre + φ_k, cam angle θ/2: nose on dir
      const n0 = dir - (LOBE_CENTRE[kind] + FIRE_AT[k]) / 2;
      out.push({ k, kind, side, x: CYL_X[k] + dx, rHead: kind === 'in' ? rIn : rEx, dir, n0, id: `${kind}${k}${xs.length > 1 ? (dx < 0 ? 'a' : 'b') : ''}` });
    }
  }
  return out;
}
const u = { z: Math.sin(INC * D), y: Math.cos(INC * D) };
export const TRAINS = {
  dohc: {
    id: 'dohc', name: 'DOHC 16-valve', short: 'DOHC 16v',
    blurb: 'Two overhead camshafts, four valves per cylinder. Each lobe presses a bucket tappet straight down the valve stem.',
    camS: 115,                                   // cam centre along the valve axis from the seat
    cams: [{ side: 1 }, { side: -1 }],
    valves: valves(2, 17, 16, 14, side => side > 0 ? -(180 - INC) : 180 - INC),
    sprocketT: 36, crankT: 18,
  },
  sohc: {
    id: 'sohc', name: 'SOHC 8-valve', short: 'SOHC 8v',
    blurb: 'One overhead camshaft, two valves per cylinder. The lobes push rocker arms up; each rocker tips over its shaft and pushes its valve down.',
    tipS: 100,                                   // valve stem tip along the axis
    rocker: { pivotZ: 27, padZ: 4, rise: 9.6 },  // pivot above the arm line
    cams: [{ side: 0 }],
    valves: valves(1, 14, 18, 15, () => 0),
    sprocketT: 36, crankT: 18,
  },
};
// derived positions (z, y) in the y-z plane
for (const T of Object.values(TRAINS)) {
  if (T.id === 'dohc') {
    T.camPos = side => [side * (GEO.seatZ + T.camS * u.z), GEO.seatY + T.camS * u.y];
  } else {
    const tipY = GEO.seatY + T.tipS * u.y, tipZ = GEO.seatZ + T.tipS * u.z;
    T.tip = { z: tipZ, y: tipY };
    T.camPos = () => [0, tipY - LOBE.Rb];
    T.rocker.pivotY = tipY + T.rocker.rise;
    T.rocker.aIn = T.rocker.pivotZ - T.rocker.padZ;
    T.rocker.aOut = tipZ - T.rocker.pivotZ;
  }
}
export const AXIS = u;

// cam angle (degrees) for a crank angle
export const camAngle = th => th / 2;
// the follower lift of a valve's lobe, mm
export function lobeLiftOf(v, th) { return camLift(v.dir - (v.n0 + camAngle(th))); }
// the rocker angle (radians, the pad end rises) for a pad lift
export const rockerAngle = (T, h) => Math.asin(clamp(h / T.rocker.aIn, -1, 1));
// valve lift along its axis, mm
export function valveLift(T, v, th) {
  const h = lobeLiftOf(v, th);
  if (T.id === 'dohc') return h;
  const a = rockerAngle(T, h);
  return T.rocker.aOut * Math.sin(a) / u.y;
}

// ── the gas in one cylinder ─────────────────────────────────────────────────
// Volume from the piston, then pressure from a simple model: intake at pIn,
// polytropic compression from IVC, a Wiebe burn from the spark, polytropic
// expansion, blowdown after EVO, exhaust at pEx. No gas inertia.
export function volumeAt(th) { return GEO.Vc + GEO.area * (GEO.r + GEO.l - pistonX(th)) / 1000; }
const wiebe = t => t <= 0 ? 0 : 1 - Math.exp(-5 * Math.pow(Math.min(t, 1.6), 3));
function compressed(psi) {
  // ψ continuous from IVC (580) to EVO (140 + 720)
  const Vivc = volumeAt(TIMING.ivc), V = volumeAt(psi);
  const pm = GEO.pIn * Math.pow(Vivc / V, GEO.n);
  const xb = wiebe((psi - TIMING.spark) / TIMING.burn);
  return { p: pm * (1 + GEO.burnRise * xb), xb };
}
export function gasState(psi) {
  psi = mod(psi, 720);
  const V = volumeAt(psi);
  const u2 = psi < 360 ? psi + 720 : psi;          // unwrapped from 360
  const evo = TIMING.evo + 720, blow = 55;
  let p, xb = 0;
  if (u2 >= TIMING.ivc && u2 < evo) ({ p, xb } = compressed(u2));
  else if (u2 >= evo && u2 < evo + blow) {
    const pe = compressed(evo).p; xb = 1;
    p = GEO.pEx + (pe - GEO.pEx) * (1 - smooth((u2 - evo) / blow));
  } else if (u2 >= evo + blow || u2 < TIMING.ivo) { p = GEO.pEx; xb = 1; }
  else {
    // IVO..IVC: from exhaust pressure down to intake pressure
    p = GEO.pEx + (GEO.pIn - GEO.pEx) * smooth((u2 - TIMING.ivo) / 50);
  }
  return { V, p, xb, stroke: strokeOf(psi) };
}
// torque on the crank from one cylinder, N·m (gas only, crankcase at 1 bar)
export function cylTorque(k, th) {
  const psi = psiOf(k, th), { p } = gasState(psi);
  return -(p - 1) * 1e5 * GEO.area * 1e-6 * pistonDx(crankOf(k, th)) * 1e-3;
}
export function torque(th) { let s = 0; for (const k of CYLS) s += cylTorque(k, th); return s; }

// ── cycle numbers, computed once ────────────────────────────────────────────
export const cycleStats = (() => {
  let W = 0, Tsum = 0, Tmax = -1e9, Tmin = 1e9, pMax = 0, pMaxAt = 0;
  const N = 1440, curve = new Float32Array(N), pv = [];
  for (let i = 0; i < N; i++) {
    const psi = i * 720 / N, a = gasState(psi), b = gasState(psi + 720 / N);
    W += (a.p + b.p) / 2 * 1e5 * (b.V - a.V) * 1e-6;     // J
    if (a.p > pMax) { pMax = a.p; pMaxAt = psi; }
    const T = torque(psi); curve[i] = T; Tsum += T; Tmax = Math.max(Tmax, T); Tmin = Math.min(Tmin, T);
    if (i % 4 === 0) pv.push([a.V, a.p]);
  }
  const imep = W / (GEO.Vs * 1e-6) / 1e5;    // bar
  return { W, imep, Tmean: Tsum / N, Tmax, Tmin, curve, pMax, pMaxAt, pv, otto: 1 - Math.pow(GEO.cr, 1 - 1.4) };
})();

// the measured valve events (where the lift passes the check lift), ψ degrees
export function measuredTiming(T) {
  const out = {};
  for (const kind of ['in', 'ex']) {
    const v = T.valves.find(q => q.k === 1 && q.kind === kind);
    let open = null, close = null, prev = valveLift(T, v, -1);
    for (let th = 0; th < 720; th += 0.5) {
      const L = valveLift(T, v, th);
      if (prev <= CHECK_LIFT && L > CHECK_LIFT) open = th;
      if (prev > CHECK_LIFT && L <= CHECK_LIFT) close = th;
      prev = L;
    }
    let max = 0; for (let th = 0; th < 720; th += 1) max = Math.max(max, valveLift(T, v, th));
    out[kind] = { open, close, max };
  }
  return out;
}
