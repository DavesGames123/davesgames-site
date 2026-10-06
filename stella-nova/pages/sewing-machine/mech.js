// ============================================================================
//  LOCKSTITCH SEWING MACHINE  ·  mech.js — the stitch cycle model (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. One angle drives everything: th, the main shaft angle. th = 0 puts
//  the needle at the top of its stroke. The handwheel turns the top of the
//  shaft toward the operator.
//
//  WORLD FRAME (scene.js uses the same numbers)
//    x along the arm (the head at -x, the handwheel at +x), y up, z toward
//    the operator. y = 0 is the top of the needle plate. The needle is at
//    x = XN, z = 0. The main shaft lies on x at y = H, z = 0.
//
//  NEEDLE BAR (crank-slider)
//    Crank a, link l, no offset. The clamp of the link on the needle bar is
//    at y = H + a cos th - sqrt(l^2 - a^2 sin^2 th). The needle point is LP
//    below that clamp, so the point is 20 mm above the plate at th = 0 and
//    12 mm below it at th = 180 deg. The eye is EYE above the point.
//
//  TAKE-UP LEVER (four-bar, Singer style)
//    The lever turns on the crank pin A = (a sin th, a cos th) in the head
//    plane (z, y about the shaft). Its tail B is held by a link of length
//    c from the fixed stud C. |A - B| = b. The eye E is fixed on the lever:
//    u along A->B, v across. The eye path is a coupler curve.
//
//  ROTARY HOOK (2:1)
//    The hook turns about x at y = HY, two turns for each shaft turn. Its
//    beak meets the needle at th = thC, when the needle has risen RISE from
//    the bottom. The hook has turned psi = 2 (th - thC) since then. The
//    beak carries the needle-thread loop round the bobbin case and lets it
//    go at psi = CAST. The second pass of the beak comes with the eye above
//    the plate, so there is no loop to catch.
//
//  FEED DOG (four motions)
//    Lift: the tooth tops are at LIFT cos th - DROP above the plate. Push:
//    z = -A sin th with A = L / (2 sin thE), thE = acos(DROP / LIFT). The
//    teeth are above the plate only for |th| < thE, and in that time they
//    move L toward -z (away from the operator). L < 0 is reverse.
//
//  THREAD
//    The needle thread runs from the tension discs T over the take-up eye,
//    the lower guide G1 and the needle bar guide G2 to the eye. upper(th) is
//    that path length. loop(th) is the length of the loop the hook holds:
//    from the eye down to the beak on the near face of the bobbin case,
//    across the beak to the far face, over the hook cup and under the feed
//    dog to the plate hole. The far points open over BLEND of hook turn
//    after the catch, and the loop shrinks into the hole over BLEND after
//    the cast-off, so the drawn path has no jump. lower is the length of
//    the whole path below the eye.
//
//  GREP MAP
//    export const M ............ every number of the machine
//    export function needle .... point, eye and clamp heights
//    export function takeUp .... A, B, E of the take-up four-bar
//    export function hook ...... beak angle and position, loop state
//    export function feed ...... tooth height and push, fabric travel
//    export function threadPath  the needle thread points and lengths
//    export function pose ...... everything at one shaft angle
//    export const PRESETS ...... stitch lengths for the picker
// ============================================================================

export const TAU = Math.PI * 2;
export const DEG = 180 / Math.PI;
const D = Math.PI / 180;

export const M = {
  XN: -100, H: 142,
  a: 16, l: 48, LP: 90, EYE: 2, NEEDLE_LEN: 38,
  // take-up four-bar, in the head plane (z, y) about the shaft centre
  TU: { C: [-1, 23], b: 32, c: 30, u: 36, v: 2.5, x: 10 },
  // rotary hook: axis on x at y = HY, beak radius RH, case radius RB
  HY: -17, RH: 11, RB: 9.5, RISE: 2.4, CAST: 280 * D,
  // hook turn over which the loop opens after the catch and shrinks after
  // the cast-off; the height of the loop strand under the plate (above
  // the hook cup, below the feed dog)
  BLEND: 60 * D, UNDER: -5.3,
  // the case and the beak along x (from XN)
  CASE: [1.2, 9.2], BEAK_X: 0.6,
  // feed dog and fabric
  LIFT: 1.1, DROP: 0.25, FABRIC: 1.0,
  // thread guides (world)
  T: [-70, 157, 40], G1: [-98, 106, 14], G2Z: 5.5, G2UP: 41,
};
M.thE = Math.acos(M.DROP / M.LIFT);

export const PRESETS = [
  { L: 2.5, name: '2.5 mm', kind: 'Normal seam' },
  { L: 1.5, name: '1.5 mm', kind: 'Short, strong stitch' },
  { L: 4, name: '4 mm', kind: 'Long stitch · basting' },
  { L: 0, name: '0 mm', kind: 'Feed off · bar tack' },
  { L: -2.5, name: 'Reverse', kind: 'Back-tack 2.5 mm' },
];

const wrap = t => ((t % TAU) + TAU) % TAU;

export function needle(th) {
  const { a, l, H, LP, EYE } = M, s = Math.sin(th);
  const clamp = H + a * Math.cos(th) - Math.sqrt(l * l - a * a * s * s);
  const point = clamp - LP;
  return { clamp, point, eye: point + EYE, pin: [a * s, a * Math.cos(th)] };
}
// lowest and highest point heights
export const POINT_TDC = needle(0).point, POINT_BDC = needle(Math.PI).point;

// circle-circle intersection, both answers
export function circle2(p1, r1, p2, r2) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.hypot(dx, dy);
  if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9 || d === 0) return null;
  const k = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - k * k));
  const mx = p1[0] + k * dx / d, my = p1[1] + k * dy / d;
  return [[mx + h * dy / d, my - h * dx / d], [mx - h * dy / d, my + h * dx / d]];
}

// The take-up four-bar has two assembly modes. B is the answer on the
// left of C -> A (the mode the numbers were chosen for); it never crosses
// to the other one, since the linkage has no dead point (tests.mjs).
export function takeUp(th) {
  const { a } = M, { C, b, c, u, v } = M.TU;
  const A = [a * Math.sin(th), a * Math.cos(th)];
  const s = circle2(A, b, C, c);
  const cr = p => (A[0] - C[0]) * (p[1] - C[1]) - (A[1] - C[1]) * (p[0] - C[0]);
  const B = cr(s[0]) > 0 ? s[0] : s[1];
  const t = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const E = [A[0] + u * Math.cos(t) - v * Math.sin(t), A[1] + u * Math.sin(t) + v * Math.cos(t)];
  return { A, B, E, t };
}

// the catch angle: the needle has risen RISE from the bottom (th > 180 deg)
export const thC = (() => {
  let lo = Math.PI, hi = 1.6 * Math.PI;
  const f = t => needle(t).point - POINT_BDC - M.RISE;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
})();
export const thCast = thC + M.CAST / 2;

// psi: hook turn since the beak last met the needle at a catch, 0..4 pi.
// The beak sits at angle -psi from the top (it moves toward -z there).
export function hook(th) {
  const psi = 2 * wrap(th - thC);
  const ang = -psi;
  const beak = [M.XN + M.BEAK_X, M.HY + M.RH * Math.cos(ang), M.RH * Math.sin(ang)];
  const caught = psi <= M.CAST;
  return { psi, beak, caught, ang };
}

// fabric travel over all turns of an unwrapped angle th (mm, -z positive
// for L > 0), the dog push and the tooth height
export function feed(th, L) {
  const { LIFT, DROP, thE } = M, A = L / (2 * Math.sin(thE));
  const top = LIFT * Math.cos(th) - DROP, z = -A * Math.sin(th);
  const n = Math.floor((th + thE) / TAU), ph = th + thE - n * TAU;
  const inTurn = ph < 2 * thE ? A * (Math.sin(ph - thE) + Math.sin(thE)) : L;
  return { top, z, A, travel: n * L + inTurn, engaged: top > 0 };
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
// the loop on the hook, after the beak: the beak, the far face of the case,
// over the hook cup, under the plate hole. s = 0 folds the far points onto
// the beak and the plate hole (a loop just caught), s = 1 opens them.
function loopPts(beak, s) {
  const { XN } = M, xf = XN + M.CASE[1] + 0.5, P0 = [XN, 0, 0];
  const far = [xf, beak[1], beak[2]], under = [xf, M.UNDER, 0], hole = [XN + 0.4, M.UNDER, -0.95];
  const mix = (p, q) => p.map((v, i) => v + (q[i] - v) * s);
  return [beak, mix(beak, far), mix(P0, under), mix(P0, hole)];
}
// the needle thread: points from the tension discs to the plate hole
export function threadPath(th) {
  const N = needle(th), T = takeUp(th), K = hook(th), { XN, H } = M;
  const E = [XN + M.TU.x, H + T.E[1], T.E[0]];
  const G2 = [XN, N.point + M.G2UP, M.G2Z], eye = [XN, N.eye, 0], P0 = [XN, 0, 0];
  const up = [M.T, E, M.G1, G2, eye];
  let upper = 0;
  for (let i = 1; i < up.length; i++) upper += dist(up[i - 1], up[i]);
  let below = [eye, P0], loop = 0;
  if (K.caught) {
    below = [eye, ...loopPts(K.beak, smooth(K.psi / M.BLEND)), P0];
    for (let i = 1; i < below.length; i++) loop += dist(below[i - 1], below[i]);
  } else if (K.psi < M.CAST + M.BLEND) {
    // cast off: the loop at the cast-off angle shrinks into the plate hole
    const a = -M.CAST, r = smooth((K.psi - M.CAST) / M.BLEND);
    const pts = loopPts([XN + M.BEAK_X, M.HY + M.RH * Math.cos(a), M.RH * Math.sin(a)], 1);
    below = [eye, ...pts.map(p => p.map((v, i) => v + (P0[i] - v) * r)), P0];
  }
  let lower = 0;
  for (let i = 1; i < below.length; i++) lower += dist(below[i - 1], below[i]);
  return { up, below, upper, loop, lower, E, eye };
}

// everything at one shaft angle; L the stitch length
export function pose(th, L = 2.5) {
  const N = needle(th), T = takeUp(th), K = hook(th), F = feed(th, L), P = threadPath(th);
  return { th, N, T, K, F, P, takeY: M.H + T.E[1] };
}
