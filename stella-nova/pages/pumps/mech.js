// ============================================================================
//  PUMPS  ·  mech.js — three rotary positive-displacement pumps (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm, rad
//  and mm^3, in the plane of the pump (X right, Y up, the shaft on Z). Every
//  pump turns its drive shaft by th (rad, counter-clockwise). The inlet is
//  at the bottom (Y < 0) and the outlet at the top (Y > 0). q is the flow
//  per rad of shaft turn (mm^3/rad): multiply by omega for mm^3/s.
//
//  ENERGY RULE (gear pump and Roots blower)
//    The tips seal on the casing at radius Ra. The outlet pressure pushes
//    on each rotor from its tip seal to the contact point, at the distance
//    rho from the rotor centre. So the torque is dp b (Ra^2 - rho^2) / 2,
//    and with q dp = sum of torque times speed:
//      q = (b / 2) [(Ra^2 - rho1^2) + (Ra^2 - rho2^2)]
//    The two centres are 2r apart with the pitch point P between them, so
//    rho1^2 + rho2^2 = 2 r^2 + 2 |PC|^2 for the contact point C, and
//      q = b (Ra^2 - r^2 - |PC|^2)
//
//  EXTERNAL GEAR PUMP (two equal involute spur gears)
//    Z teeth, module m, pressure angle alpha, face width b, backlash j.
//    r = Z m / 2, rb = r cos alpha, Ra = r + m, base pitch pb = pi m cos a.
//    The driver A is at (+r, 0) and turns +th, the idler B at (-r, 0)
//    turns -th. The contact runs along the line of action, |PC| = u with
//    u = rb (th - th0) wrapped into [-pb/2, pb/2]: relief grooves vent the
//    trapped volume, so the contact nearest P seals. Then
//      V = 2 pi b (Ra^2 - r^2 - pb^2 / 12)
//      ripple (q_max - q_min) / q_mean = (pb^2 / 4) / (Ra^2 - r^2 - pb^2/12)
//
//  SLIDING-VANE PUMP (offset rotor, radial vanes)
//    Rotor radius r at the origin, cam ring radius R with its centre at
//    (e, 0). A vane at angle phi reaches the ring at
//      rho(phi) = e cos phi + sqrt(R^2 - e^2 sin^2 phi)
//    n vanes of thickness t, pitch beta = 2 pi / n. The fluid area of the
//    chamber behind the vane at phi is
//      A(phi) = int_phi^(phi+beta) (rho^2 - r^2) / 2 - t/2 (rho(phi) - r)
//               - t/2 (rho(phi + beta) - r)
//    The outlet kidney spans p0 .. pi - p0, the inlet pi + p0 .. 2 pi - p0;
//    each land is wider than beta, so no chamber opens to both. The
//    chambers open to the outlet run from vane T (in p0 - beta .. p0) to
//    vane F (in pi - p0 .. pi - p0 + beta), and
//      q / b = (rho_T^2 - rho_F^2) / 2 + t (rho'_T / 2 + rho'_F / 2
//              + sum of rho' of the vanes between them)
//    The mean gives V = n b (A(p0 - beta) - A(pi - p0)).
//
//  ROOTS BLOWER (two lobes, cycloidal)
//    Pitch radius r, rolling circle a = r / 4: each lobe is an epicycloid
//    arch (tip Ra = r + 2a) and each waist a hypocycloid arch (r - 2a).
//    Both arches of a mating pair come from one rolling circle, so they
//    are conjugate. Rotor A at (+r, 0) turns +th, rotor B at (-r, 0) turns
//    -th (timing gears, not shown, keep them in step). The contact runs on
//    the rolling circles through P: |PC| = 2a |sin 2 psi|, psi = th + pi/4.
//      V = 2 pi b (Ra^2 - r^2 - 2 a^2) = 2 b (pi Ra^2 - rotor area)
//      ripple = 4 a^2 / (Ra^2 - r^2 - 2 a^2)
//
//  GREP MAP
//    export const UNITS ......... the three pumps and their numbers
//    export function gearDims ... r, rb, Ra, rf, pb, s, the phases
//    export function toothHalf .. involute tooth half angle at radius rho
//    export function gearOutline  the gear outline (gear frame)
//    export function gearDepth .. how far a point is inside a gear
//    export function rho / drho . the vane reach and its slope
//    export function chamberArea  the fluid area of one vane chamber
//    export function vanePose ... vanes, chambers and their port states
//    export function rootsOutline the cycloidal rotor (rotor frame)
//    export function rootsRadius  the rotor radius at a polar angle
//    export function flow ....... q(th) for any pump
//    export function displacement V per turn, closed form
//    export function rippleOf ... the closed-form ripple
//    export function pumpPose ... rotor angles, contact, flow, pockets
//    export function flowCurve .. q over one turn
// ============================================================================

export const TAU = Math.PI * 2;
export const D = Math.PI / 180;

export const UNITS = [
  { id: 'gear', name: 'External gear', kind: 'Two spur gears · 12 teeth', Z: 12, m: 4, alpha: 25 * D, b: 24, j: 0.2, port: 12 },
  { id: 'vane', name: 'Sliding vane', kind: 'Offset rotor · 9 vanes', n: 9, r: 37.6, R: 44, e: 6, t: 3, b: 20, p0: 22 * D, vaneL: 24 },
  { id: 'roots', name: 'Roots blower', kind: 'Two lobes · cycloidal', r: 28, a: 7, b: 40, port: 20 },
];
export const unit = id => UNITS.find(u => u.id === id);
export const wrap = x => { x %= TAU; return x < 0 ? x + TAU : x; };
const wrapPi = x => wrap(x + Math.PI) - Math.PI;
const inv = x => Math.tan(x) - x;

// ── gear pump ───────────────────────────────────────────────────────────────
export function gearDims(u) {
  const r = u.Z * u.m / 2, rb = r * Math.cos(u.alpha), Ra = r + u.m, rf = r - 1.25 * u.m;
  const pb = Math.PI * u.m * Math.cos(u.alpha), s = Math.PI * u.m / 2 - u.j / 2;
  // tooth 0 of A points at P at th = 0; B is a space at P, turned j/(2r)
  // so that the drive flanks touch and the backlash is on the coast side
  const phA = Math.PI, phB = Math.PI / u.Z + u.j / (2 * r);
  // the leading flank of A crosses P at th0
  const th0 = -s / (2 * r);
  return { r, rb, Ra, rf, pb, s, phA, phB, th0, C: 2 * r, Rc: Ra + 0.3 };
}
// half angle of the tooth at radius rho (radial flank below rb)
export function toothHalf(u, rho, G = gearDims(u)) {
  const rr = Math.max(G.rb, rho);
  return G.s / (2 * G.r) + inv(u.alpha) - inv(Math.acos(G.rb / rr));
}
// the outline of one gear, counter-clockwise, in the gear frame
export function gearOutline(u, nInv = 14, nArc = 4) {
  const G = gearDims(u), pts = [], Z = u.Z, half = Math.PI / Z;
  const pol = (rr, a) => pts.push([rr * Math.cos(a), rr * Math.sin(a)]);
  for (let k = 0; k < Z; k++) {
    const c = TAU * k / Z, h0 = toothHalf(u, G.rb, G), ha = toothHalf(u, G.Ra, G);
    // root arc from the space centre to the right flank foot
    for (let i = 0; i < nArc; i++) pol(G.rf, c - half + (half - h0) * i / nArc);
    pol(G.rf, c - h0);
    // involute up the right (clockwise) flank
    for (let i = 0; i <= nInv; i++) { const rr = G.rb + (G.Ra - G.rb) * i / nInv; pol(rr, c - toothHalf(u, rr, G)); }
    for (let i = 1; i < nArc; i++) pol(G.Ra, c - ha + 2 * ha * i / nArc);
    for (let i = nInv; i >= 0; i--) { const rr = G.rb + (G.Ra - G.rb) * i / nInv; pol(rr, c + toothHalf(u, rr, G)); }
    pol(G.rf, c + h0);
    for (let i = 1; i < nArc; i++) pol(G.rf, c + h0 + (half - h0) * i / nArc);
  }
  return pts;
}
// depth (mm, > 0 inside) of the point (x, y) in a gear frame, along the
// pitch circle direction: (half angle - angle off the tooth centre) * rho
export function gearDepth(u, x, y, G = gearDims(u)) {
  const rho = Math.hypot(x, y);
  if (rho < G.rf) return G.rf - rho;
  const p = TAU / u.Z, a = Math.atan2(y, x), d = Math.abs(a - Math.round(a / p) * p);
  // above the tip circle: outside by the radial or the angular margin
  if (rho > G.Ra) return Math.min(G.Ra - rho, (toothHalf(u, G.Ra, G) - d) * rho);
  return (toothHalf(u, rho, G) - d) * rho;
}
// world <-> gear frames: A at (+r, 0) turned th + phA, B at (-r, 0) turned
// -th + phB
export function gearFrames(u, th, G = gearDims(u)) {
  return { A: { cx: G.r, cy: 0, ang: th + G.phA }, B: { cx: -G.r, cy: 0, ang: -th + G.phB } };
}
export const toFrame = (F, x, y) => { const dx = x - F.cx, dy = y - F.cy, c = Math.cos(-F.ang), s = Math.sin(-F.ang); return [dx * c - dy * s, dx * s + dy * c]; };
export const fromFrame = (F, x, y) => { const c = Math.cos(F.ang), s = Math.sin(F.ang); return [F.cx + x * c - y * s, F.cy + x * s + y * c]; };
// the signed contact distance u from P along the line of action
export function gearU(u, th, G = gearDims(u)) {
  const p = TAU / u.Z, x = th - G.th0;
  return (x - Math.round(x / p) * p) * G.rb;
}

// ── sliding-vane pump ───────────────────────────────────────────────────────
export const rho = (u, f) => u.e * Math.cos(f) + Math.sqrt(u.R * u.R - u.e * u.e * Math.sin(f) ** 2);
export const drho = (u, f) => { const s = Math.sin(f), c = Math.cos(f); return -u.e * s - u.e * u.e * s * c / Math.sqrt(u.R * u.R - u.e * u.e * s * s); };
export const vanePorts = u => ({ out: [u.p0, Math.PI - u.p0], in: [Math.PI + u.p0, TAU - u.p0], beta: TAU / u.n });
// Simpson on (rho^2 - r^2) / 2 from a to a + beta, less the vane halves
export function chamberArea(u, a, N = 120) {
  const be = TAU / u.n, h = be / N, g = f => (rho(u, f) ** 2 - u.r * u.r) / 2;
  let s = g(a) + g(a + be);
  for (let i = 1; i < N; i++) s += (i % 2 ? 4 : 2) * g(a + i * h);
  return s * h / 3 - u.t / 2 * (rho(u, a) - u.r) - u.t / 2 * (rho(u, a + be) - u.r);
}
// does the arc [a, a + w] (wrapped) overlap [lo, hi] (0 <= lo < hi < 2pi)?
const overlap = (a, w, lo, hi) => { a = wrap(a); return (a < hi && a + w > lo) || (a + w > TAU + lo); };
export function vanePose(u, th) {
  const P = vanePorts(u), be = P.beta, vanes = [], chambers = [];
  for (let i = 0; i < u.n; i++) { const f = th + i * be; vanes.push({ i, f, rho: rho(u, f), d: drho(u, f) }); }
  for (let i = 0; i < u.n; i++) {
    const f = vanes[i].f, o = overlap(f, be, ...P.out), n = overlap(f, be, ...P.in);
    chambers.push({ i, f, state: o && n ? 'both' : o ? 'outlet' : n ? 'inlet' : 'sealed' });
  }
  return { vanes, chambers };
}

// ── Roots blower ────────────────────────────────────────────────────────────
// the outline, counter-clockwise from the tip at angle 0; nA points a
// quarter turn (one arch)
export function rootsOutline(u, nA = 64) {
  const r = u.r, a = u.a, pts = [];
  const epi = t => [(r + a) * Math.cos(t) - a * Math.cos((r + a) / a * t), (r + a) * Math.sin(t) - a * Math.sin((r + a) / a * t)];
  const hyp = t => [(r - a) * Math.cos(t) + a * Math.cos((r - a) / a * t), (r - a) * Math.sin(t) - a * Math.sin((r - a) / a * t)];
  const rot = (p, g) => [p[0] * Math.cos(g) - p[1] * Math.sin(g), p[0] * Math.sin(g) + p[1] * Math.cos(g)];
  const q = Math.PI / 2;
  for (let k = 0; k < 4; k++) {
    // arch k spans the polar angles (k - 1/2) q .. (k + 1/2) q
    const lobe = k % 2 === 0, g = (k - 0.5) * q;
    for (let i = 0; i < nA; i++) {
      const t = q * i / nA;
      pts.push(rot(lobe ? epi(t) : hyp(t), g));
    }
  }
  // start at the tip (angle 0): the first arch begins at -q/2
  return pts.slice(nA / 2).concat(pts.slice(0, nA / 2));
}
// the rotor radius at polar angle f (rotor frame), from a dense outline
let RR = null;
export function rootsRadius(u, f) {
  if (!RR || RR.u !== u) {
    const pts = rootsOutline(u, 1024).map(p => [wrap(Math.atan2(p[1], p[0])), Math.hypot(p[0], p[1])]).sort((x, y) => x[0] - y[0]);
    RR = { u, pts };
  }
  const P = RR.pts, a = wrap(f);
  let lo = 0, hi = P.length - 1;
  if (a <= P[0][0] || a >= P[hi][0]) {
    const p0 = P[hi], p1 = P[0], s = (wrap(a - p0[0])) / (wrap(p1[0] - p0[0]) || 1);
    return p0[1] + (p1[1] - p0[1]) * s;
  }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P[mid][0] <= a) lo = mid; else hi = mid; }
  const s = (a - P[lo][0]) / (P[hi][0] - P[lo][0] || 1);
  return P[lo][1] + (P[hi][1] - P[lo][1]) * s;
}
export const rootsFrames = (u, th) => ({ A: { cx: u.r, cy: 0, ang: Math.PI + th }, B: { cx: -u.r, cy: 0, ang: -Math.PI / 2 - th } });
export const rootsPC = (u, th) => 2 * u.a * Math.abs(Math.sin(2 * (th + Math.PI / 4)));

// ── all pumps ───────────────────────────────────────────────────────────────
export function dims(u) {
  if (u.id === 'gear') { const G = gearDims(u); return { r: G.r, Ra: G.Ra, Rc: G.Rc, C: G.C }; }
  if (u.id === 'roots') return { r: u.r, Ra: u.r + 2 * u.a, Rc: u.r + 2 * u.a + 0.3, C: 2 * u.r };
  return { r: u.r, Ra: u.R + u.e, Rc: u.R, C: 0 };
}
export function flow(u, th) {
  if (u.id === 'gear') { const G = gearDims(u), uu = gearU(u, th, G); return u.b * (G.Ra ** 2 - G.r ** 2 - uu * uu); }
  if (u.id === 'roots') { const Ra = u.r + 2 * u.a, pc = rootsPC(u, th); return u.b * (Ra * Ra - u.r * u.r - pc * pc); }
  const P = vanePorts(u), be = P.beta, [p0, p1] = P.out;
  // each window is one vane pitch long, so exactly one vane is in it
  let T = 0, F = 0, inner = 0;
  for (let i = 0; i < u.n; i++) {
    // eps: a vane on a window edge counts in the window it enters
    const f = th + i * be, eps = 1e-9, dT = wrap(f - (p0 - be) + eps), dF = wrap(f - p1 + eps);
    if (dT < be) T = p0 - be + dT - eps;
    else if (dF < be) F = p1 + dF - eps;
    else if (wrap(f - p0 + eps) < p1 - p0) inner += drho(u, f);
  }
  return u.b * ((rho(u, T) ** 2 - rho(u, F) ** 2) / 2 + u.t * (drho(u, T) / 2 + drho(u, F) / 2 + inner));
}
export function displacement(u) {
  if (u.id === 'gear') { const G = gearDims(u); return TAU * u.b * (G.Ra ** 2 - G.r ** 2 - G.pb ** 2 / 12); }
  if (u.id === 'roots') { const Ra = u.r + 2 * u.a; return TAU * u.b * (Ra * Ra - u.r * u.r - 2 * u.a * u.a); }
  const P = vanePorts(u);
  return u.n * u.b * (chamberArea(u, P.out[0] - P.beta) - chamberArea(u, P.out[1]));
}
export function rippleOf(u) {
  if (u.id === 'gear') { const G = gearDims(u), k = G.Ra ** 2 - G.r ** 2 - G.pb ** 2 / 12; return { theory: G.pb ** 2 / 4 / k, pulses: u.Z }; }
  if (u.id === 'roots') { const Ra = u.r + 2 * u.a, k = Ra * Ra - u.r * u.r - 2 * u.a * u.a; return { theory: 4 * u.a * u.a / k, pulses: 4 }; }
  const q = flowCurve(u, 3600), m = displacement(u) / TAU;
  // no closed form: measured on 3600 steps; the flow steps 2n times a turn
  return { theory: (Math.max(...q) - Math.min(...q)) / m, pulses: 2 * u.n };
}
export function flowCurve(u, n = 720) {
  const out = [];
  for (let j = 0; j <= n; j++) out.push(flow(u, TAU * j / n));
  return out;
}

// pockets: a sealed pocket lies between two tips that are both on the
// casing arc. arc: the half angle of the casing arc about the outer side.
export function casingArc(u) {
  const d = dims(u), w = u.port;
  return Math.acos((w - d.C / 2) / d.Rc);
}
export function pumpPose(u, th) {
  const q = flow(u, th), out = { th, q, qMean: displacement(u) / TAU };
  if (u.id === 'vane') return Object.assign(out, vanePose(u, th));
  const arc = casingArc(u), pockets = [];
  // tip angles in world terms, seen from each rotor centre: A on the
  // right (its outer side at angle 0), B on the left (at pi)
  const tips = u.id === 'gear' ? u.Z : 2, F = u.id === 'gear' ? gearFrames(u, th) : rootsFrames(u, th);
  for (const [side, Fr, outward] of [['A', F.A, 0], ['B', F.B, Math.PI]]) {
    for (let k = 0; k < tips; k++) {
      const t0 = Fr.ang + TAU * k / tips, t1 = t0 + TAU / tips;
      const a0 = wrapPi(t0 - outward), a1 = wrapPi(t1 - outward), mid = wrapPi(t0 + Math.PI / tips);
      const sealed = Math.abs(a0) <= arc && Math.abs(a1) <= arc && Math.abs(wrapPi((t0 + t1) / 2 - outward)) < arc;
      pockets.push({ side, k, state: sealed ? 'sealed' : Math.sin(mid) < 0 ? 'inlet' : 'outlet' });
    }
  }
  out.pockets = pockets;
  out.pc = u.id === 'gear' ? Math.abs(gearU(u, th)) : rootsPC(u, th);
  return out;
}
