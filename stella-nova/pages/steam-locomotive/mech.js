// ============================================================================
//  STEAM LOCOMOTIVE  ·  mech.js — Walschaerts valve gear, valve events and
//  the indicator diagram (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. The plane is the right side of the engine: X forward (toward the
//  cylinder), Y up, the main (driven) axle at the origin.
//
//  WHEEL ANGLE AND CRANK
//    phi is the wheel angle. Forward running turns the right-side wheels
//    clockwise, so the crank angle is theta = -phi. phi = 0 is front dead
//    centre (crank pin on +X, piston at the front of its stroke).
//      C = r (cos theta, sin theta)                    crank pin
//      H = (C.x + sqrt(L^2 - C.y^2), 0)                crosshead pin
//    The coupling rods join pins at the same crank angle on all three
//    coupled axles, so each rod moves without a turn.
//
//  WALSCHAERTS GEAR (inside admission piston valve)
//    Return crank pin E at radius e and crank angle theta + DELTA. The
//    eccentric rod (Le) drives the foot F of the expansion link, a distance
//    a below the trunnion K. The link turns by psi about K. DELTA is not
//    90 deg: the rod slopes up to F0 = K - (0, a), so E is set at right
//    angles to the line O-F0 (102.7 deg). Then the link is at mid swing at
//    both dead centres, and Le = |F0 - E|.
//    The die block D sits in the curved slot at arc length s from K. The
//    slot radius is the radius rod length Rr, so with the link at mid
//    swing a change of s does not move the far end of the radius rod.
//    That gives the gear its near-constant lead.
//    The reverser sets s = c * S_MAX, c in [-1, 1]: +1 full forward (die
//    below the trunnion), 0 mid gear, -1 full reverse.
//    The radius rod (Rr) joins D to the top T of the combination lever.
//    The valve spindle pin V is cv below T and runs on the line y = YV.
//    The bottom U is cu below V. The union link (Lu) joins U to the
//    crosshead drop arm, hd below H. solveLever() finds T and V with
//    three Newton equations:
//      |T - D| = Rr,   |V - T| = cv,   |U - A| = Lu,  U = T + (V-T)(cv+cu)/cv
//
//  VALVE EVENTS (inside admission)
//    v = valve offset from its centred place (set from mid gear, as a
//    fitter sets the valves). Steam lap LAP, exhaust lap EXL, port PORT.
//      front port to steam   v - LAP > 0        rear to steam  -v - LAP > 0
//      front port to exhaust -v - EXL > 0       rear to exhaust v - EXL > 0
//    Openings clip at PORT. Cut-off = piston travel (share of stroke)
//    from the dead centre when the port closes to steam.
//
//  INDICATOR DIAGRAM (one end, Rankine ideal)
//    Volume v = CLEAR + travel / stroke from that end. Port open to steam: p = 1 (boiler).
//    Open to exhaust: p = PEX. Both closed: p v = constant (hyperbolic
//    expansion and compression). Work = loop integral of p dv; mean
//    effective pressure MEP = work / 1 (one stroke volume).
//    Steam per stroke = (p v) at cut-off - (p v) just before admission.
//
//  GREP MAP
//    export const G ............. the numbers of the engine
//    function crank ............. crank pin, crosshead, return crank
//    function linkPose .......... expansion link angle from the eccentric rod
//    function solveLever ........ combination lever (Newton, 3 x 3)
//    export function makeGear ... pose(phi, c) -> every joint and the valve
//    export function events ..... lead, cut-off, release, compression
//    export function indicator .. p-v loop of one end, MEP, steam use
//    export function circle2 .... both intersections of two circles
// ============================================================================

export const TAU = Math.PI * 2;
export const G = {
  // wheels, crank and rods (a 6 ft 2 in, 26 in stroke express engine)
  WHEEL_R: 940, PITCH: 2150, r: 330, L: 3700, ROD_PISTON: 1250,
  BORE: 470,
  // return crank and eccentric rod
  e: 160,
  // expansion link: trunnion K, foot a below it, slot half length
  K: [1300, 686], a: 400, S_MAX: 200, SLOT: 235,
  // radius rod, combination lever, union link, drop arm, valve line
  Rr: 2900, cv: 133, cu: 867, Lu: 520, hd: 307, YV: 560,
  // valve: steam lap, exhaust lap, port width, valve spindle to valve centre
  LAP: 38, EXL: 0, PORT: 50, SPINDLE: 700,
  // indicator: clearance volume (share of stroke), exhaust pressure (share of boiler)
  CLEAR: 0.08, PEX: 0.07,
  // weigh shaft (reverser): shaft W, lifting arm, lifting link, reach-rod arm
  W: [800, 1443], LA: 500, LL: 750, LR: 380,
};
G.STROKE = 2 * G.r;
// Set the return crank so that the link is at mid swing at both dead
// centres: the return crank pin then lies at right angles to the line from
// the axle to the link foot F0, and the eccentric rod is |F0 - E|.
{
  const F0 = [G.K[0], G.K[1] - G.a];
  G.DELTA = Math.atan2(F0[1], F0[0]) + Math.PI / 2;
  G.Le = Math.hypot(Math.hypot(...F0), G.e);
}

export function circle2(p1, r1, p2, r2) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.hypot(dx, dy);
  if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9 || d === 0) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = p1[0] + a * dx / d, my = p1[1] + a * dy / d;
  return [[mx + h * dy / d, my - h * dx / d], [mx - h * dy / d, my + h * dx / d]];
}

// crank pin, crosshead pin and return crank pin at wheel angle phi
function crank(phi) {
  const th = -phi, C = [G.r * Math.cos(th), G.r * Math.sin(th)];
  const H = [C[0] + Math.sqrt(G.L * G.L - C[1] * C[1]), 0];
  const E = [G.e * Math.cos(th + G.DELTA), G.e * Math.sin(th + G.DELTA)];
  return { th, C, H, E };
}
export const crossheadX = phi => crank(phi).H[0];
// piston travel from front dead centre, 0 .. STROKE
export const travel = phi => G.L + G.r - crossheadX(phi);

// the link foot F below K on its circle, |F - E| = Le; psi turns CCW
function linkPose(E) {
  const s = circle2(G.K, G.a, E, G.Le);
  const F = s[0][1] < s[1][1] ? s[0] : s[1];
  return { F, psi: Math.atan2(F[0] - G.K[0], G.K[1] - F[1]) };
}
// the point at arc length s along the slot (s > 0 below K), link at psi
export function slotPoint(s, psi) {
  const b = s / G.Rr, x = G.Rr * (1 - Math.cos(b)), y = -G.Rr * Math.sin(b);
  return [G.K[0] + x * Math.cos(psi) - y * Math.sin(psi), G.K[1] + x * Math.sin(psi) + y * Math.cos(psi)];
}

// combination lever: unknowns T (x, y) and the valve pin x. A = drop arm pin.
function leverRes(q, Dp, A) {
  const T = [q[0], q[1]], V = [q[2], G.YV], k = (G.cv + G.cu) / G.cv;
  const U = [T[0] + (V[0] - T[0]) * k, T[1] + (V[1] - T[1]) * k];
  return [Math.hypot(T[0] - Dp[0], T[1] - Dp[1]) - G.Rr, Math.hypot(V[0] - T[0], V[1] - T[1]) - G.cv, Math.hypot(U[0] - A[0], U[1] - A[1]) - G.Lu];
}
function solve3(J, f) {
  const [a, b, c] = J, det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const col = (i, m) => m.map((r, k) => r.map((v, j) => (j === i ? f[k] : v)));
  const d3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return [d3(col(0, J)) / det, d3(col(1, J)) / det, d3(col(2, J)) / det];
}
export function solveLever(Dp, A, q0) {
  let q = q0 ? q0.slice() : [Dp[0] + G.Rr, G.YV + G.cv, Dp[0] + G.Rr];
  for (let it = 0; it < 30; it++) {
    const f = leverRes(q, Dp, A);
    if (Math.max(...f.map(Math.abs)) < 1e-10) break;
    const J = [[], [], []], h = 1e-6;
    for (let j = 0; j < 3; j++) {
      const qp = q.slice(); qp[j] += h;
      const fp = leverRes(qp, Dp, A);
      for (let i = 0; i < 3; i++) J[i][j] = (fp[i] - f[i]) / h;
    }
    const dq = solve3(J, f);
    q = q.map((v, i) => v - dq[i]);
  }
  return q;
}

// the full gear at wheel angle phi and reverser c. Each gear keeps the
// last lever answer as the Newton start, so it follows one branch.
export function makeGear() {
  let last = null;
  const g = {
    V0: 0,
    pose(phi, c) {
      const { th, C, H, E } = crank(phi), { F, psi } = linkPose(E);
      const s = c * G.S_MAX, Dp = slotPoint(s, psi), A = [H[0], -G.hd];
      const q = solveLever(Dp, A, last);
      last = q;
      const T = [q[0], q[1]], V = [q[2], G.YV], k = (G.cv + G.cu) / G.cv;
      const U = [T[0] + (V[0] - T[0]) * k, T[1] + (V[1] - T[1]) * k];
      // weigh shaft: the lifting arm end Q, LA from W and LL from the die
      const qs = circle2(G.W, G.LA, Dp, G.LL), Q = qs ? (qs[0][0] > qs[1][0] ? qs[0] : qs[1]) : [G.W[0] + G.LA, G.W[1]];
      const arm = Math.atan2(Q[1] - G.W[1], Q[0] - G.W[0]);
      const R = [G.W[0] + G.LR * Math.cos(arm + Math.PI / 2), G.W[1] + G.LR * Math.sin(arm + Math.PI / 2)];
      const v = V[0] - g.V0;
      return { phi, th, c, s, psi, arm, J: { O: [0, 0], C, H, E, F, K: G.K, D: Dp, T, V, U, A, W: G.W, Q, R }, v, x: G.L + G.r - H[0], open: ports(v) };
    },
    reset() { last = null; },
  };
  // set the valves: centre the mid gear travel
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 720; i++) { const x = g.pose(TAU * i / 720, 0).J.V[0]; lo = Math.min(lo, x); hi = Math.max(hi, x); }
  g.V0 = (lo + hi) / 2;
  g.reset();
  return g;
}

// port openings (mm) for a valve offset v
export function ports(v) {
  const cl = x => Math.max(0, Math.min(G.PORT, x));
  return { fs: cl(v - G.LAP), rs: cl(-v - G.LAP), fx: cl(-v - G.EXL), rx: cl(v - G.EXL) };
}

// sample one turn: dir +1 forward running, -1 backward. Returns arrays by
// step i = 0..N-1 at phi = dir * TAU * i / N.
export function sample(c, dir = 1, N = 1440) {
  const g = makeGear(), out = [];
  for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) { const P = g.pose(dir * TAU * i / N, c); if (k) out.push(P); }
  return out;
}

// valve events, both ends. Shares of stroke for cut-off, release and
// compression, measured from the dead centre where that stroke starts.
// P: a sample(c, dir, N) to share between events() and indicator()
export function events(c, dir = 1, N = 1440, P = sample(c, dir, N)) {
  const n = P.length, S = G.STROKE;
  const at = i => P[(i + n) % n];
  // front dead centre is i = 0; rear dead centre at the largest travel
  let iR = 0; for (let i = 0; i < n; i++) if (P[i].x > P[iR].x) iR = i;
  const travelVal = Math.max(...P.map(p => p.v)) - Math.min(...P.map(p => p.v));
  // first i after i0 (going on) where test is false after being true
  const firstOff = (i0, key) => { for (let j = 0; j < n; j++) { const a = at(i0 + j), b = at(i0 + j + 1); if (a.open[key] > 0 && b.open[key] === 0) return (i0 + j + 1) % n; } return -1; };
  const firstOn = (i0, key) => { for (let j = 0; j < n; j++) { const a = at(i0 + j), b = at(i0 + j + 1); if (a.open[key] === 0 && b.open[key] > 0) return (i0 + j + 1) % n; } return -1; };
  const share = (i, fromFront) => { if (i < 0) return NaN; const x = P[i].x / S; return fromFront ? x : 1 - x; };
  const deg = i => (i < 0 ? NaN : ((i / n) * 360));
  const front = { lead: P[0].open.fs, cutoff: share(firstOff(0, 'fs'), true), release: share(firstOn(0, 'fx'), true), compression: share(firstOff(iR, 'fx'), false), admitDeg: deg(firstOn(iR, 'fs')) };
  const rear = { lead: P[iR].open.rs, cutoff: share(firstOff(iR, 'rs'), false), release: share(firstOn(iR, 'rx'), false), compression: share(firstOff(0, 'rx'), true), admitDeg: deg(firstOn(0, 'rs')) };
  return { front, rear, travel: travelVal, maxOpen: Math.max(...P.map(p => Math.max(p.open.fs, p.open.rs))), iR, n };
}

// the ideal indicator loop of one end ('front' or 'rear'). Returns
// { pv: [[v, p]] by sample step, mep, steam, eff } with eff = mep / steam
// (work per unit of steam).
export function indicator(c, dir = 1, N = 1440, end = 'front', P = sample(c, dir, N)) {
  const S = G.STROKE, rear = end === 'rear';
  const vol = p => G.CLEAR + (rear ? S - p.x : p.x) / S;
  const ks = rear ? 'rs' : 'fs', kx = rear ? 'rx' : 'fx';
  let p = 1, vPrev = vol(P[0]), steamIn = 0, before = null;
  const pv = [];
  let W = 0;
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < P.length; i++) {
      const Q = P[i], v = vol(Q);
      let pn;
      if (Q.open[ks] > 0) { if (before === null) before = p * vPrev; pn = 1; }
      else {
        if (before !== null) { if (k) steamIn += 1 * vPrev - before; before = null; }
        pn = Q.open[kx] > 0 ? G.PEX : p * vPrev / v;
      }
      if (k) { W += 0.5 * (p + pn) * (v - vPrev); pv.push([v, pn]); }
      p = pn; vPrev = v;
    }
  }
  if (before !== null) steamIn += 1 * vPrev - before;
  // forward work is positive when the gear drives the way the wheel turns
  return { pv, mep: W, steam: steamIn, eff: steamIn > 0 ? W / steamIn : 0 };
}
