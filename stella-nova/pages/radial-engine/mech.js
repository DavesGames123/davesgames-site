// ============================================================================
//  RADIAL ENGINE  ·  mech.js — master-and-link-rod kinematics (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. The engine plane is (X right, Y up), seen from the front (the
//  propeller side). The crank axis points at the viewer.
//
//  CYLINDERS
//    n cylinders (n odd) at phi_i = i * 2 pi / n, counter-clockwise from
//    the top seen from the front, so clockwise seen from the cockpit.
//    Cylinder 1 (i = 0) is at the top. Its axis is u_i = R(phi_i) (0, 1).
//    The crank pin is C = R(theta) (0, r): theta = 0 puts it on cylinder 1.
//
//  MASTER ROD
//    Cylinder 1 has the master rod, length L, from C to its wrist pin. It
//    is a plain slider-crank: s_0 = C.u_0 + sqrt(L^2 - (C x u_0)^2). The
//    master rod turns by delta from the cylinder 1 axis.
//
//  LINK RODS
//    The big end of the master rod carries n - 1 knuckle pins at radius
//    rho, at the cylinder angles in the master rod frame:
//      K_i = C + rho R(delta + phi_i) (0, 1)
//    A link rod of length l joins K_i to the wrist pin of cylinder i. As the
//    master rod rocks (delta != 0), each knuckle pin leaves the circle that
//    a true crank pin would follow. So a link piston has its own stroke,
//    its own top dead centre angle and its own compression ratio.
//
//  FIRING ORDER (four-stroke, n odd)
//    One cylinder fires every 4 pi / n of crank: 1, 3, 5, ... n, 2, 4, ...
//    Cylinder i fires at fire_i = phi_i (i even) or phi_i + 2 pi (i odd).
//
//  CAM RING
//    One ring with an inlet track and an exhaust track, N = (n - 1) / 2
//    lobes each, turns at omega = -1 / (2 N) of crank speed (against the
//    crank). Each lobe serves one cylinder, and then the next lobe meets
//    the next cylinder in the firing order. Lift is a cos^2 bump.
//
//  GREP MAP
//    export const UNITS ......... the two engines and their numbers
//    export function makeEngine . (unit) -> { pose(theta), phi, fire, ... }
//      pose ..................... C, P0, delta, K[], P[], s[], lift[], cam
//    export function survey ..... strokes, TDC angles, compression ratios
//    export function sliderCrank  s(theta) of a plain crank and rod
//    export const flangeR / CW_GAP  scene sizes the clearance tests use
// ============================================================================

export const TAU = Math.PI * 2;
const D = Math.PI / 180;

// r crank radius, L master rod, rho knuckle radius, l link rod (L - rho),
// bore, CR the compression ratio of cylinder 1, crown pin-to-crown height.
// Inlet and exhaust: lobe centre (crank deg after firing TDC) and duration.
export const UNITS = [
  { id: 'r9', name: 'Nine cylinders', kind: 'Single row · 4 lobes at −1/8', n: 9, r: 66, L: 250, rho: 70, l: 180, bore: 132, CR: 6.5, crown: 45,
    inlet: { at: 460, dur: 250 }, exhaust: { at: 255, dur: 250 }, lift: 8 },
  { id: 'r7', name: 'Seven cylinders', kind: 'Single row · 3 lobes at −1/6', n: 7, r: 60, L: 230, rho: 64, l: 166, bore: 124, CR: 6.5, crown: 42,
    inlet: { at: 460, dur: 250 }, exhaust: { at: 255, dur: 250 }, lift: 8 },
];
export const unit = id => UNITS.find(u => u.id === id);
// scene sizes that the clearance tests check: the master rod flange radius
// and the gap from the lowest piston skirt to the crank counterweight
export const flangeR = u => u.rho + 20;
export const CW_GAP = 10;

const rot = (a, x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export const sliderCrank = (r, L, th) => r * Math.cos(th) + Math.sqrt(L * L - (r * Math.sin(th)) ** 2);

export function makeEngine(u) {
  const n = u.n, N = (n - 1) / 2, omega = -1 / (2 * N);
  const phi = Array.from({ length: n }, (_, i) => i * TAU / n);
  const ax = phi.map(p => rot(p, 0, 1));
  const fire = phi.map((p, i) => (i % 2 ? p + TAU : p));
  // head roof: cylinder 1 gets the stated compression ratio
  const H = u.r + u.L + u.crown + 2 * u.r / (u.CR - 1);
  // cam track phase: lobe 0 meets cylinder 1 at fire_0 + at
  const track = t => ({ ...t, alpha: -omega * (fire[0] + t.at * D), w: t.dur * D * Math.abs(omega) });
  const tracks = [track(u.inlet), track(u.exhaust)];
  const camAngle = (k, th) => tracks[k].alpha + omega * th;
  // lift of track k at a follower angle f (engine frame)
  const liftAt = (k, th, f) => {
    const T = tracks[k], psi = camAngle(k, th);
    let best = Infinity;
    for (let j = 0; j < N; j++) best = Math.min(best, Math.abs(wrap(f - psi - j * TAU / N)));
    return best < T.w / 2 ? u.lift * Math.cos(Math.PI * best / T.w) ** 2 : 0;
  };
  // the outline radius of track k at an angle a in the cam frame
  const profile = (k, a) => {
    const T = tracks[k];
    let best = Infinity;
    for (let j = 0; j < N; j++) best = Math.min(best, Math.abs(wrap(a - j * TAU / N)));
    return best < T.w / 2 ? u.lift * Math.cos(Math.PI * best / T.w) ** 2 : 0;
  };

  function pose(th) {
    const C = rot(th, 0, u.r);
    const s0 = C[1] + Math.sqrt(u.L * u.L - C[0] * C[0]);
    const P0 = [0, s0];
    const d = [(P0[0] - C[0]) / u.L, (P0[1] - C[1]) / u.L];
    const delta = Math.atan2(-d[0], d[1]);   // angle from (0, 1) to d, counter-clockwise
    const K = [], P = [], s = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) { K.push(null); P.push(P0); s.push(s0); continue; }
      const k = rot(delta + phi[i], 0, u.rho), Ki = [C[0] + k[0], C[1] + k[1]];
      const ka = Ki[0] * ax[i][0] + Ki[1] * ax[i][1], kk = Ki[0] * Ki[0] + Ki[1] * Ki[1];
      const si = ka + Math.sqrt(u.l * u.l - (kk - ka * ka));
      K.push(Ki); P.push([si * ax[i][0], si * ax[i][1]]); s.push(si);
    }
    const lift = phi.map(f => [liftAt(0, th, f), liftAt(1, th, f)]);
    // four-stroke phase of each cylinder: 0 = firing TDC, 0..4 pi
    const cyc = fire.map(f => ((th - f) % (2 * TAU) + 2 * TAU) % (2 * TAU));
    return { th, C, P0, delta, K, P, s, lift, cyc, cam: [camAngle(0, th), camAngle(1, th)] };
  }

  return { u, n, N, omega, phi, ax, fire, H, tracks, pose, liftAt, profile, camAngle,
    // firing order as cylinder numbers (1-based)
    order: fire.map((f, i) => [f, i + 1]).sort((a, b) => a[0] - b[0]).map(q => q[1]) };
}

// Strokes, TDC angles and compression ratios over one crank turn, from M
// samples refined with a golden search near each extreme.
export function survey(E, M = 3600) {
  const { n, u, H } = E, out = [];
  const sAt = (i, th) => E.pose(th).s[i];
  const refine = (i, th0, sign) => {
    let a = th0 - TAU / M, b = th0 + TAU / M;
    const g = (Math.sqrt(5) - 1) / 2;
    for (let k = 0; k < 80; k++) {
      const c = b - g * (b - a), d = a + g * (b - a);
      if (sign * sAt(i, c) > sign * sAt(i, d)) b = d; else a = c;
    }
    const t = (a + b) / 2;
    return [t, sAt(i, t)];
  };
  const area = Math.PI * u.bore * u.bore / 4;
  for (let i = 0; i < n; i++) {
    let iMax = 0, iMin = 0, vMax = -Infinity, vMin = Infinity;
    for (let k = 0; k < M; k++) { const v = sAt(i, TAU * k / M); if (v > vMax) { vMax = v; iMax = k; } if (v < vMin) { vMin = v; iMin = k; } }
    const [tTop, sTop] = refine(i, TAU * iMax / M, 1), [tBot, sBot] = refine(i, TAU * iMin / M, -1);
    const stroke = sTop - sBot, clear = H - (sTop + u.crown);
    out.push({ i, tdc: tTop, bdc: tBot, sTop, sBot, stroke, clear, CR: (stroke + clear) / clear, swept: area * stroke,
      // TDC angle off the cylinder angle (rad, wrapped)
      shift: wrap(tTop - E.phi[i]) });
  }
  return out;
}
