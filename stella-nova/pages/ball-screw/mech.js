// ============================================================================
//  BALL SCREW & LEAD SCREW  ·  mech.js — thread forms, motion and efficiency
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm, N
//  and rad. A screw frame has its axis on local y. An angle phi turns from
//  local +x toward local -z (kit.js: the right-hand sense about +y), so a
//  point is (r cos phi, y, -r sin phi).
//
//  THREAD SURFACES (right hand, n starts, pitch p, lead L = n p)
//    A surface of the screw or the nut is r(y, phi) = f(s), with
//      s = frac((y - L phi / 2 pi) / p)
//    and f the axial profile over one pitch. One turn of phi moves s by
//    n whole pitches, so the surface closes on itself.
//    ACME (29 degrees, alpha = 14.5): depth h = p/2, crest and root flats
//    0.3707 p, flanks 0.1293 p wide. The nut profile is the screw tooth
//    grown by c = 0.3 mm in r and in y (a square Minkowski sum), so the
//    two surfaces never touch: the flank gap is c (cos a + sin a).
//    Ball: a circular groove of radius rg = 0.53 Db about the ball circle
//    radius Rbc = d/2. The screw land is at Rbc - 0.15 Db, the nut land at
//    Rbc + 0.15 Db, and the nut groove mirrors the screw groove.
//
//  MOTION
//    Screw angle theta (about +y). With the nut held, a point of the nut
//    thread stays on the screw thread when the nut is at y = -L theta / 2pi.
//    travel = lead x turns. stroke() runs the screw back and forth, so the
//    nut covers STROKE mm and turns round at each end.
//
//  EFFICIENCY (lead angle lambda: tan lambda = L / (pi dm))
//    The normal thread angle: tan an = tan alpha cos lambda.
//    Drive (torque in, thrust out) and back-drive (thrust in, torque out):
//      eta  = tan l (cos an - mu tan l) / (cos an tan l + mu)
//      eta' = (cos an tan l - mu) / (tan l (cos an + mu tan l))
//    A ball screw uses the same relations with an = 0 and the rolling
//    coefficient MU_ROLL. eta' <= 0 is self-locking: a thrust cannot turn
//    the screw. Torques: T = F L / (2 pi eta) to drive, F L eta' / 2 pi
//    on the screw when the load drives it (negative: you must turn it).
//
//  BALL CIRCUIT (ball nut frame)
//    Each start has one circuit: Nt turns of the nut groove from phi = 40
//    to 40 + 360 Nt degrees (which is -40 mod 360), then a return tube that
//    climbs out of the nut, crosses the top and drops back in. The balls
//    are spaced evenly on the loop. The ball centre turns at
//      k / 2 times the screw speed, k = 1 - Db cos(contact) / dm
//    (pure rolling between the turning screw and the still nut).
//
//  GREP MAP
//    export const UNITS ......... the three units and their numbers
//    export function screw ...... thread numbers for one unit and lead
//    export function screwR ..... screw surface radius at (y, phi)
//    export function nutR ....... nut surface radius at (y, phi)
//    export function effLead .... eta and eta' with sliding friction
//    export function effBall .... eta and eta' with rolling friction
//    export function lockAngle .. the lead angle where eta' = 0
//    export function torques .... drive and back-drive torques
//    export function stroke ..... theta and nut travel from the drive phase
//    export function circuit .... the ball loop of one start
//    export function ballAt ..... a ball centre on the loop
// ============================================================================

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const ALPHA = 14.5 * DEG;          // ACME flank half angle
export const MU_SLIDE = 0.12;             // steel on bronze, greased
export const MU_ROLL = 0.003;             // ball screw, rolling (catalogue value)
export const CONTACT = 45 * DEG;          // ball contact angle
export const STROKE = 150;                // nut travel, mm
export const CLR = 0.3;                   // screw-to-nut clearance, mm

export const UNITS = [
  { id: 'acme', name: 'ACME lead screw', kind: 'Sliding · bronze nut · self-locking', type: 'lead', d: 20, L: 4, leads: [2, 3, 4, 8, 12, 16, 20] },
  { id: 'acme4', name: 'Four-start lead screw', kind: 'Sliding · steep lead · back-drives', type: 'lead', d: 20, L: 16, leads: [2, 3, 4, 8, 12, 16, 20] },
  { id: 'ball', name: 'Ball screw', kind: 'Rolling · return tube', type: 'ball', d: 20, L: 5, leads: [4, 5, 10, 16, 20] },
];
export const unit = id => UNITS.find(u => u.id === id);
const frac = x => x - Math.floor(x);

// thread numbers for unit u at lead L
export function screw(u, L = u.L) {
  const g = { type: u.type, d: u.d, L };
  if (u.type === 'lead') {
    g.p = L <= 4 ? L : 4;
    g.n = Math.round(L / g.p);
    g.h = g.p / 2;
    g.rMaj = u.d / 2;
    g.rMin = g.rMaj - g.h;
    g.dm = u.d - g.p / 2;
    const w = g.h * Math.tan(ALPHA) / g.p, c = (1 - 2 * w) / 2;   // flank and flat widths (in pitches)
    const r0 = c / 2;
    // screw: root half, flank up, crest, flank down, root half
    g.knots = [[0, g.rMin], [r0, g.rMin], [r0 + w, g.rMaj], [r0 + w + c, g.rMaj], [r0 + 2 * w + c, g.rMin], [1, g.rMin]];
    // nut: the tooth grown by CLR in y and r
    const e = CLR / g.p;
    g.nutKnots = [[0, g.rMin + CLR], [r0 - e, g.rMin + CLR], [r0 + w - e, g.rMaj + CLR], [r0 + w + c + e, g.rMaj + CLR], [r0 + 2 * w + c + e, g.rMin + CLR], [1, g.rMin + CLR]];
    g.rOut = g.rMaj;
    g.rBore = g.rMin + CLR;
  } else {
    g.n = L <= 10 ? 1 : 2;
    g.p = L / g.n;
    g.Db = Math.min(3.175, 0.62 * g.p);
    g.Rbc = u.d / 2;
    g.rg = 0.53 * g.Db;
    g.off = 0.15 * g.Db;
    g.hw = Math.sqrt(g.rg * g.rg - g.off * g.off);    // groove half width at the land
    g.dm = 2 * g.Rbc;
    g.rOut = g.Rbc - g.off;                           // screw land
    g.rBore = g.Rbc + g.off;                          // nut land
    g.rMin = g.Rbc - g.rg;                            // groove bottom
    g.rMaj = g.rOut;
    g.Nt = L <= 5 ? 2 + 280 / 360 : L <= 10 ? 1 + 280 / 360 : 280 / 360;
    g.k = 1 - g.Db * Math.cos(CONTACT) / g.dm;
  }
  g.lam = Math.atan(L / (Math.PI * g.dm));
  return g;
}

const interp = (K, s) => { for (let i = 1; i < K.length; i++) if (s <= K[i][0]) { const [s0, r0] = K[i - 1], [s1, r1] = K[i]; return s1 > s0 ? r0 + (r1 - r0) * (s - s0) / (s1 - s0) : r1; } return K[K.length - 1][1]; };
// the axial profile: s in [0, 1) over one pitch
export function screwProfile(g, s) {
  if (g.type === 'lead') return interp(g.knots, s);
  const dx = Math.abs(s - 0.5) * g.p;
  return dx < g.hw ? g.Rbc - Math.sqrt(g.rg * g.rg - dx * dx) : g.rOut;
}
export function nutProfile(g, s) {
  if (g.type === 'lead') return interp(g.nutKnots, s);
  const dx = Math.abs(s - 0.5) * g.p;
  return dx < g.hw ? g.Rbc + Math.sqrt(g.rg * g.rg - dx * dx) : g.rBore;
}
export const sOf = (g, y, phi) => frac((y - g.L * phi / TAU) / g.p);
export const screwR = (g, y, phi) => screwProfile(g, sOf(g, y, phi));
export const nutR = (g, y, phi) => nutProfile(g, sOf(g, y, phi));

// ── efficiency ──────────────────────────────────────────────────────────────
export function effLead(lam, mu = MU_SLIDE, alpha = ALPHA) {
  const t = Math.tan(lam), c = Math.cos(Math.atan(Math.tan(alpha) * Math.cos(lam)));
  return { fwd: t * (c - mu * t) / (c * t + mu), back: (c * t - mu) / (t * (c + mu * t)) };
}
export const effBall = (lam, mu = MU_ROLL) => effLead(lam, mu, 0);
export const eff = (g, mu = MU_SLIDE) => g.type === 'lead' ? effLead(g.lam, mu) : effBall(g.lam);
// the lead angle below which eta' <= 0 (bisection on cos an tan l = mu)
export function lockAngle(mu = MU_SLIDE, alpha = ALPHA) {
  let a = 0, b = Math.PI / 4;
  for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (effLead(m, mu, alpha).back > 0) b = m; else a = m; }
  return (a + b) / 2;
}
// F in N, L in mm: torques in N m
export function torques(g, F, mu = MU_SLIDE) {
  const E = eff(g, mu);
  return { drive: F * g.L / (TAU * E.fwd) / 1000, back: F * g.L * E.back / TAU / 1000, E, locks: E.back <= 0 };
}

// ── motion ──────────────────────────────────────────────────────────────────
// psi: the drive phase (rad, it only grows). theta runs from -pi Ns to
// +pi Ns and back (Ns = STROKE / L turns); dir = dtheta/dpsi.
export function stroke(g, psi) {
  const half = TAU * STROKE / g.L, P = 2 * half;
  const q = ((psi % P) + P) % P;
  const up = q < half, theta = up ? -half / 2 + q : half / 2 - (q - half);
  return { theta, dir: up ? 1 : -1, x: -g.L * theta / TAU, turns: theta / TAU };
}
// the drive phase at which the nut is in the middle, moving -y
export const psiMid = g => TAU * STROKE / g.L / 2;

// ── ball circuit ────────────────────────────────────────────────────────────
// a uniform Catmull-Rom spline through pts, sampled m times per span
function catmull(pts, m) {
  const out = [], P = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}
const cyl = (r, phi, y) => [r * Math.cos(phi), y, -r * Math.sin(phi)];
// rBody: nut body radius; yMid: where the circuit centres in the nut
export function circuit(g, rBody, yMid = 0) {
  const phS = 40 * DEG, phE = phS + TAU * g.Nt;
  // ball centres sit on the groove centre line: s = 0.5
  const yOn = phi => g.L * phi / TAU + g.p / 2;
  const mid = (yOn(phS) + yOn(phE)) / 2;
  const yOff = Math.round((yMid - mid) / g.p) * g.p;
  const ys = yOn(phS) + yOff, ye = yOn(phE) + yOff, dY = ye - ys;
  const ell = Math.hypot(g.Rbc, g.L / TAU);                 // helix length per radian
  const Lg = ell * (phE - phS);
  const rt = g.Db / 2 + 0.9, Rt = rBody + rt + 0.4;          // tube radius and its crest radius
  const a = phE;
  const ctrl = [
    cyl(g.Rbc, a, ye),
    cyl(g.Rbc + 0.7 * g.Db, a + 10 * DEG, ye + g.L * 10 / 360),
    cyl(Rt - 1.2, a + 25 * DEG, ye - 0.2 * dY),
    cyl(Rt, a + 40 * DEG, (ys + ye) / 2),
    cyl(Rt - 1.2, a + 55 * DEG, ys + 0.2 * dY),
    cyl(g.Rbc + 0.7 * g.Db, a + 70 * DEG, ys - g.L * 10 / 360),
    cyl(g.Rbc, a + 80 * DEG, ys),
  ];
  const tube = catmull(ctrl, 40), acc = [0];
  for (let i = 1; i < tube.length; i++) acc.push(acc[i - 1] + Math.hypot(tube[i][0] - tube[i - 1][0], tube[i][1] - tube[i - 1][1], tube[i][2] - tube[i - 1][2]));
  const Lt = acc[acc.length - 1], total = Lg + Lt;
  const nb = Math.floor(total / (1.07 * g.Db));
  return { phS, phE, ys, ye, yOff, ell, Lg, Lt, total, tube, acc, rt, Rt, nb, sp: total / nb };
}
// a ball centre at arc length u on the loop (nut frame, start 0)
export function ballAt(g, C, u) {
  u = ((u % C.total) + C.total) % C.total;
  if (u < C.Lg) { const phi = C.phS + u / C.ell; return cyl(g.Rbc, phi, g.L * phi / TAU + g.p / 2 + C.yOff); }
  const v = u - C.Lg, A = C.acc;
  let lo = 0, hi = A.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] <= v) lo = m; else hi = m; }
  const t = (v - A[lo]) / Math.max(1e-12, A[hi] - A[lo]), p = C.tube[lo], q = C.tube[hi];
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
}
// the arc length the balls have moved along the loop at screw angle theta
export const ballShift = (g, C, theta) => theta * g.k / 2 * C.ell;
