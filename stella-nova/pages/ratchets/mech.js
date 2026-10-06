// ============================================================================
//  RATCHETS & FREEWHEELS  ·  mech.js — one-way clutch model and outlines
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. Outlines are 2D in the plane of rotation (X, Y), angles CCW. All
//  three units drive the output CCW (+) and slip when the input turns back.
//
//  ONE-WAY CLUTCH (makeClutch)
//    State: input angle, output angle and g, the gap: how far the input
//    must turn forward before the clutch takes load. A load holds the
//    output when the clutch does not drive it.
//      forward d > 0 ... d <= g: g -= d (lost motion, output still)
//                        d > g : output += d - g, g = 0 (driving)
//      back    d < 0 ... toothed: g += |d|; each time g reaches p + c
//                        the tip drops over a crest: g = max(0, g - p).
//                        p = 2 pi / N; c is the small extra turn the tip
//                        needs to clear the crest (see pawlGeo)
//                        sprag: g = min(e, g + |d|), e the elastic take-up
//    So after a back stroke B the lost motion is about B mod p for a
//    ratchet or a freehub (at most p + c, near 360 / N degrees) and
//    min(B, e) for a sprag.
//
//  TOOTH PROFILE (toothR)
//    Tooth faces are radial lines at the angles k p + eps (eps = FACE_GAP
//    of arc at the root, so the pawl tip never sits in the face plane).
//    Between faces the radius changes linearly with angle: the back slope.
//      external wheel (ratchet): r falls from rTip at the face to rRoot
//      internal ring (freehub): r rises from rTip to rRoot (the pocket)
//
//  PAWL (pawlPose)
//    A hooked pawl turns on a pivot in the input frame. A spring turns its
//    tip into the teeth. pawlPose finds the pawl angle where the tip just
//    touches the profile (a scan, then bisection). At engagement the tip
//    sits at the root, FACE_GAP behind the face. The tip moves on a circle
//    about the pivot, so it also moves a little along the teeth as it
//    lifts: at the crest it is shift ahead, and it drops over the crest
//    only when the input has gone back p + c, c = shift - eps.
//    Self-engagement: the face pushes the tip back along the tangent. That
//    force, plus friction mu along the face against it, must turn the
//    pawl into the teeth (pawlMoment > 0), or the pawl jumps out.
//
//  SPRAG (spragGeo)
//    Each sprag has two contact arcs: radius rhoI about C_i, tangent to the
//    inner race, and radius rhoO about C_o, tangent to the outer race.
//    |C_i - C_o| = d is fixed, so the angle gamma between the two contact
//    points follows from the cosine rule:
//      cos gamma = (a^2 + b^2 - d^2) / (2 a b),  a = ri + rhoI, b = ro - rhoO
//    The strut (contact to contact) leans eps from the race normal. A
//    sprag wedges and does not slip while tan eps < mu at both contacts.
//    Elastic take-up at torque T (Palmgren, steel line contact):
//      Q = T / (Z ri tan eps)  normal load on one sprag
//      delta = 3.84e-5 Q^0.9 / L^0.8  mm, at each of two contacts
//      e = 2 delta / (tan eps ri)  rad of lost motion
//
//  INPUT PROGRAM (inputAt)
//    Six strokes per cycle, each 1/6 of the cycle with a smoothstep ease:
//    +100, -40, +100, -25, +100, -52 degrees (net +183 per cycle).
//
//  GREP MAP
//    export const UNITS ......... the three units and their numbers
//    export function toothR ..... the profile radius at a wheel angle
//    export function wheelOutline the tooth outline (external or internal)
//    export function pawlGeo .... pivot, length, rest angle of a pawl
//    export function pawlPose ... the pawl angle for a wheel offset
//    export function pawlOutline  the pawl outline in its own frame
//    export function pawlMoment . the self-engagement moment
//    export function spragGeo ... gamma, eps, outline, take-up e
//    export function makeClutch . the one-way state machine
//    export function inputAt .... the input program
//    export function cycleCurve . output vs input over one cycle
// ============================================================================

export const TAU = Math.PI * 2;
const D = Math.PI / 180;
export const FACE_GAP = 0.35;   // mm of clearance between the pawl tip and the face

export const UNITS = [
  { id: 'ratchet', name: 'Ratchet & pawl', kind: '12 teeth · spring-loaded pawl', type: 'tooth', ext: true,
    N: 12, rTip: 62, rRoot: 50, pivot: [58, -40], pawlHole: 4.3, boss: 7.5, pinR: 4, mu: 0.15,
    // the hooked pawl at engagement: [angle deg, r mm] from the tip, round
    // the front and the top to the boss, then from the boss along the
    // bottom (the tooth side) back to the tip
    hook: { top: [[0, 50], [0, 67], [-4, 71.5], [-14, 76]], bottom: [[-24, 64.5], [-14, 63.6], [-5, 55.4]] } },
  { id: 'sprag', name: 'Sprag clutch', kind: '14 sprags between two races', type: 'sprag',
    Z: 14, ri: 45, ro: 60, rhoI: 9, rhoO: 10.5, d: 4.59, w: 8, L: 20, mu: 0.1, T: 100e3 },
  { id: 'freehub', name: 'Bicycle freehub', kind: '24-tooth ring · 3 pawls', type: 'tooth', ext: false,
    N: 24, rTip: 47.5, rRoot: 50, pivot: [37, -19], pawls: 3, pawlHole: 2.8, boss: 4, pinR: 2.5, mu: 0.15,
    hook: { top: [[0, 50], [0, 44.6], [-5, 42.4], [-14, 40.4]], bottom: [[-24, 45.4], [-12, 45.6], [-4, 46.9]] } },
];
export const unit = id => UNITS.find(u => u.id === id);
export const pitch = u => (u.type === 'tooth' ? TAU / u.N : 0);
const mod = (x, m) => ((x % m) + m) % m;

// ── teeth ──────────────────────────────────────────────────────────────────
// radius of the tooth profile at wheel angle t (wheel frame)
export function toothR(u, t) {
  const p = TAU / u.N, eps = FACE_GAP / u.rRoot, s = mod(t - eps, p) / p;   // 0 at a face, 1 at the next
  return u.ext ? u.rTip - (u.rTip - u.rRoot) * s : u.rTip + (u.rRoot - u.rTip) * s;
}
// the outline as [x, y] points, CCW; seg points on each back slope
export function wheelOutline(u, seg = 10) {
  const p = TAU / u.N, eps = FACE_GAP / u.rRoot, pts = [];
  const r0 = u.ext ? u.rTip : u.rTip, r1 = u.rRoot;
  for (let k = 0; k < u.N; k++) {
    const a0 = k * p + eps;
    // the face: from the root of the last tooth to this tooth's start
    pts.push([r1 * Math.cos(a0), r1 * Math.sin(a0)]);
    for (let i = 0; i < seg; i++) {
      const s = i / seg, a = a0 + s * p, r = r0 + (r1 - r0) * s;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return pts;
}

// ── pawl ───────────────────────────────────────────────────────────────────
// Pivot P (input frame), tip T0 = (rRoot, 0) at the root, FACE_GAP behind
// the face at angle eps. alpha0: the direction P -> T0. sIn: the turn
// sense that moves the tip into the teeth (in for a wheel, out for a ring).
// shift: how far forward (rad) the tip is when it reaches the tooth crest
// radius rTip. The tip passes the crest of the tooth behind it, and drops,
// when the input has gone back by p + c, c = shift - eps.
export function pawlGeo(u) {
  const T0 = [u.rRoot, 0], P = u.pivot.slice();
  const v = [T0[0] - P[0], T0[1] - P[1]], l = Math.hypot(v[0], v[1]), alpha0 = Math.atan2(v[1], v[0]);
  // turning +alpha moves the tip along the left normal (-v1, v0) / l: its
  // radial part at T0 is -v1 / l
  const sIn = (u.ext ? -v[1] < 0 : -v[1] > 0) ? 1 : -1;
  // the tip at radius rTip on its circle, near T0 (bisection on the turn)
  let lo = 0, hi = -sIn * 0.6;
  const rAt = da => Math.hypot(P[0] + l * Math.cos(alpha0 + da), P[1] + l * Math.sin(alpha0 + da));
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if ((rAt(m) - u.rTip) * (u.rRoot - u.rTip) > 0) lo = m; else hi = m; }
  const tc = [P[0] + l * Math.cos(alpha0 + lo), P[1] + l * Math.sin(alpha0 + lo)];
  const shift = Math.atan2(tc[1], tc[0]), eps = FACE_GAP / u.rRoot;
  return { P, T0, l, alpha0, sIn, shift, c: shift - eps, lift: Math.abs(lo) };
}
// is a point free of the tooth material? rot: the wheel turn in the pawl
// frame. With q (the gap state), the teeth behind the crest the tip has
// not yet passed are solid up to the crest (the tip has not dropped).
export function free(u, q, rot, blockBehind = false) {
  const r = Math.hypot(q[0], q[1]), t = Math.atan2(q[1], q[0]) - rot, p = TAU / u.N, eps = FACE_GAP / u.rRoot;
  let R = toothR(u, t);
  if (blockBehind && t < -p + eps && t > -2 * p) R = u.rTip;
  return u.ext ? r >= R : r <= R;
}
// The pawl angle (input frame) at gap q: the input has turned back by q
// from engagement, so the wheel is turned by +q in the pawl frame. The
// spring holds the tip on the profile: a scan from deep in the teeth
// outward, then bisection.
export function pawlPose(u, q, G = pawlGeo(u)) {
  const tip = al => [G.P[0] + G.l * Math.cos(al), G.P[1] + G.l * Math.sin(al)];
  const step = 0.25 * D;
  let inA = G.alpha0 + G.sIn * 2 * D, a = inA;
  for (let k = 0; k < 400; k++) {
    a = G.alpha0 + G.sIn * (2 * D - k * step);
    if (free(u, tip(a), q, true)) break;
    inA = a;
  }
  let lo = inA, hi = a;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (free(u, tip(m), q, true)) hi = m; else lo = m; }
  return hi;
}
// the tip point at a pawl angle
export const pawlTip = (G, a) => [G.P[0] + G.l * Math.cos(a), G.P[1] + G.l * Math.sin(a)];
// The pawl outline in its own frame: origin at the pivot, x toward the
// tip at engagement. From u.hook (engaged, polar) and a boss round the
// pivot on the side away from the tip.
export function pawlOutline(u, G = pawlGeo(u), seg = 16) {
  const pol = ([a, r]) => [r * Math.cos(a * D), r * Math.sin(a * D)];
  const top = u.hook.top.map(pol), bot = u.hook.bottom.map(pol), P = G.P, R = u.boss;
  const ang = q => Math.atan2(q[1] - P[1], q[0] - P[0]);
  const a0 = ang(top[top.length - 1]), a1 = ang(bot[0]), away = Math.atan2(P[1] - G.T0[1], P[0] - G.T0[0]);
  // sweep from a0 to a1 through the side away from the tip
  const sw = s => ((s * (a1 - a0)) % TAU + TAU) % TAU;
  const through = s => { const k = ((s * (away - a0)) % TAU + TAU) % TAU; return k < sw(s); };
  const s = through(1) ? 1 : -1, span = sw(s);
  const boss = [];
  for (let i = 0; i <= seg; i++) { const t = a0 + s * span * i / seg; boss.push([P[0] + R * Math.cos(t), P[1] + R * Math.sin(t)]); }
  const world = [...top, ...boss, ...bot];
  // to the pawl frame: translate by -P, turn by -alpha0
  const c = Math.cos(-G.alpha0), sn = Math.sin(-G.alpha0);
  return world.map(([x, y]) => { const dx = x - P[0], dy = y - P[1]; return [dx * c - dy * sn, dx * sn + dy * c]; });
}
// moment of the tooth force about the pivot, sign + when it turns the tip
// into the teeth. The face pushes back along -tangent at the tip; friction
// mu acts along the face (radial) in the sense that pulls the tip out.
export function pawlMoment(u, mu = u.mu, G = pawlGeo(u)) {
  const T = G.T0, out = u.ext ? 1 : -1;
  const F = [mu * out, -1];
  const v = [T[0] - G.P[0], T[1] - G.P[1]];
  return (v[0] * F[1] - v[1] * F[0]) * G.sIn;
}

// ── sprag ──────────────────────────────────────────────────────────────────
export function spragGeo(u, shrink = 0.3) {
  const a = u.ri + u.rhoI, b = u.ro - u.rhoO;
  const gamma = Math.acos((a * a + b * b - u.d * u.d) / (2 * a * b));
  const Pi = [u.ri, 0], Po = [u.ro * Math.cos(gamma), u.ro * Math.sin(gamma)];
  const c = [Po[0] - Pi[0], Po[1] - Pi[1]], cl = Math.hypot(c[0], c[1]);
  const epsI = Math.acos(c[0] / cl);                                         // from the inner normal (+x)
  const epsO = Math.acos((c[0] * Math.cos(gamma) + c[1] * Math.sin(gamma)) / cl);
  const Ci = [a, 0], Co = [b * Math.cos(gamma), b * Math.sin(gamma)];
  const M = [(Pi[0] + Po[0]) / 2, (Pi[1] + Po[1]) / 2];
  // the outline: inside both arcs (each shrunk) and a slab of width w
  // across the strut. A ray from M meets the nearest of the three bounds.
  const ax = [c[0] / cl, c[1] / cl], nx = [-ax[1], ax[0]];
  const ray = (C, R, dx, dy) => { const ox = M[0] - C[0], oy = M[1] - C[1], B = ox * dx + oy * dy, Cc = ox * ox + oy * oy - R * R; return -B + Math.sqrt(B * B - Cc); };
  const outline = [];
  for (let i = 0; i < 96; i++) {
    const t = TAU * i / 96, dx = Math.cos(t), dy = Math.sin(t);
    const sn = Math.abs(dx * nx[0] + dy * nx[1]);
    const s = Math.min(ray(Ci, u.rhoI - shrink, dx, dy), ray(Co, u.rhoO - shrink, dx, dy), sn > 1e-9 ? u.w / 2 / sn : 1e9);
    outline.push([M[0] + s * dx, M[1] + s * dy]);
  }
  const tanE = Math.tan(Math.max(epsI, epsO));
  const Q = u.T / (u.Z * u.ri * tanE);
  const delta = 3.84e-5 * Math.pow(Q, 0.9) / Math.pow(u.L, 0.8);
  const e = 2 * delta / tanE / u.ri;
  return { gamma, epsI, epsO, Pi, Po, Ci, Co, M, outline, Q, delta, e, tanE };
}

// ── the one-way clutch ─────────────────────────────────────────────────────
export function lostMax(u) { return u.type === 'tooth' ? TAU / u.N + Math.max(0, pawlGeo(u).c) : spragGeo(u).e; }
export function makeClutch(u, inp = 0, out = 0) {
  const p = pitch(u), e = u.type === 'sprag' ? spragGeo(u).e : 0, c = p ? pawlGeo(u).c : 0;
  const S = { in: inp, out, g: 0, driving: true, taken: 0, clicks: 0 };
  // taken: the lost motion of the current forward stroke so far
  S.step = x => {
    const d = x - S.in;
    S.in = x;
    if (d > 0) {
      if (d <= S.g) { S.g -= d; S.taken += d; S.driving = false; }
      else { S.out += d - S.g; S.taken += S.g; S.g = 0; S.driving = true; }
    } else if (d < 0) {
      if (p) {
        // the tip drops over a crest each time the gap passes p + c
        S.g -= d;
        while (S.g >= p + c) { S.g = Math.max(0, S.g - p); S.clicks++; }
      } else S.g = Math.min(e, S.g - d);
      S.taken = 0; S.driving = false;
    }
    return S;
  };
  return S;
}

// ── input program ──────────────────────────────────────────────────────────
export const STROKES = [100, -40, 100, -25, 100, -52].map(v => v * D);
export const NET = STROKES.reduce((a, b) => a + b, 0);
const smooth = t => t * t * (3 - 2 * t);
// input angle at program time tau (rad; one cycle per 2 pi)
export function inputAt(tau) {
  const c = Math.floor(tau / TAU), f = (tau - c * TAU) / TAU * STROKES.length, k = Math.min(STROKES.length - 1, Math.floor(f));
  let a = c * NET;
  for (let i = 0; i < k; i++) a += STROKES[i];
  return a + STROKES[k] * smooth(f - k);
}
// stroke index (0..5) and its sense at tau
export function strokeAt(tau) { const k = Math.floor(mod(tau, TAU) / TAU * STROKES.length) % STROKES.length; return { k, fwd: STROKES[k] > 0 }; }

// Output against input over one cycle, after one cycle of warm-up (the
// clutch state is then periodic). Returns n + 1 samples { tau, in, out,
// g, driving } with in and out measured from the cycle start, and the lost
// motion of each forward stroke.
export function cycleCurve(u, n = 600) {
  n = Math.round(n / STROKES.length) * STROKES.length;
  const C = makeClutch(u, inputAt(0), 0);
  for (let i = 1; i <= n; i++) C.step(inputAt(TAU * i / n));
  const in0 = C.in, out0 = C.out, pts = [], lost = [], per = n / STROKES.length;
  for (let i = 0; i <= n; i++) {
    const tau = TAU * (1 + i / n);
    if (i) C.step(inputAt(tau));
    // the end of a forward stroke: its lost motion is what it took up
    if (i && i % per === 0 && STROKES[i / per - 1] > 0) lost.push(C.taken);
    pts.push({ tau, in: C.in - in0, out: C.out - out0, g: C.g, driving: C.driving });
  }
  return { pts, lost };
}
