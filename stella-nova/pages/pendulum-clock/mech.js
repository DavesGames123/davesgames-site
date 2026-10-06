// ============================================================================
//  PENDULUM CLOCK  ·  mech.js — pendulum, escapement and going train (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Geometry is in mm
//  and rad in the plane of the escapement (X right, Y up, the escape wheel
//  centre at the origin). Dynamics is in SI units.
//
//  THE CLOCK
//    A seconds pendulum (L = 994 mm, T0 = 2 s) on the pallet arbor, a 30
//    tooth escape wheel (one turn a minute, it carries the seconds hand),
//    and a going train to a weight on a barrel cord:
//      escape pinion 8 <- third wheel 60, third pinion 8 <- centre wheel 64,
//      centre pinion 8 <- great wheel 96 on the barrel arbor.
//    The centre arbor turns once an hour and the barrel once in 12 hours.
//
//  THE ESCAPEMENTS (one wheel angle law per pallet)
//    The wheel angle phi counts the advance (clockwise from the front) and
//    theta is the pallet (and pendulum) angle, counter-clockwise positive.
//    A pallet face is a line, an arc about the pallet arbor, or a nib point
//    in the pallet frame. With a tooth on a face, phi is a function of
//    theta: the tooth tip (radius Rw) lies on the face. The wheel torque T
//    then gives the pallet the torque T dphi/dtheta (virtual work), less
//    sliding friction (mu along the face).
//      anchor ...... two inclined faces. dphi/dtheta = +-G on the faces, so
//                    the wheel turns back (recoils) through the whole
//                    supplementary arc. A tooth drops off each pallet tip.
//      deadbeat .... Graham: an impulse face and a locking face, an arc
//                    about the pallet arbor. On the arc dphi/dtheta = 0:
//                    the wheel stands dead still. No recoil.
//      grasshopper . Harrison: two nibs on pivoted arms. One nib is always
//                    on a tooth. The next nib takes its tooth and pushes
//                    the wheel back a little, and that frees the other nib:
//                    no drop and no sliding, but it recoils. A nib inside
//                    the Thales circle of the two arbors gives the wheel a
//                    forward push, a nib outside it a backward push.
//    Each face law is fixed so the contact points at theta = 0 sit a whole
//    number of teeth and a half apart: one tooth per pendulum period.
//
//  THE SIMULATION  (simulate / step)
//    Pendulum: (I + J g^2) theta'' = -m g L sin theta - c theta' + tau,
//    with g = dphi/dtheta and tau from the contact force (friction too).
//    The term J g g' theta'^2 is left out: it is near 1e-7 of the gravity
//    torque.
//    Drop: the wheel turns free, J phi'' = T, until a tooth meets the next
//    face; the landing is a plastic impact that keeps the generalised
//    momentum I w + J g phi'. Grasshopper changeover is the same impact.
//    The step is RK4 at dt = 0.2 ms with the events checked each step.
//
//  PERIOD
//    T0 = 2 pi sqrt(L / g). The exact period at amplitude a is
//    T0 / AGM(1, cos(a/2)); the series is T0 (1 + a^2/16 + 11 a^4/3072).
//
//  GREP MAP
//    export const CLOCK ........ the clock numbers (pendulum, train, weight)
//    export const UNITS ........ the three escapements and their numbers
//    export function design .... the faces of one escapement
//    export function contact ... tooth on face: phi, contact point, normal
//    export function torque .... pallet torque and contact force from T
//    export const gOf .......... dphi/dtheta at a contact (virtual work)
//    export function makeSim ... a running clock: step(dt), run(s), state
//    export function settle .... the steady swing for a weight (fixed point)
//    export function periodExact / periodSeries / periodSmall
//    export function trace ..... a settled run: theta(t), phi(t), recoil
// ============================================================================

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const GRAV = 9.80665;

export const CLOCK = {
  N: 30, Rw: 40,                       // escape wheel teeth, tip radius mm
  L: 0.994, m: 1.2, Q: 1500,           // pendulum length m, bob kg, quality
  J: 1.5e-5,                            // wheel and train inertia at the escape arbor, kg m^2
  train: [[8, 60], [8, 64], [8, 96]],   // [pinion, wheel] from the escape arbor down
  rb: 0.02, eta: 0.6,                   // barrel radius m, train efficiency
};
export const P_TOOTH = TAU / CLOCK.N;
// escape arbor turns for one barrel turn: 60/8 * 64/8 * 96/8 = 720
export const RATIO = CLOCK.train.reduce((k, [p, w]) => k * w / p, 1);

export const UNITS = [
  { id: 'anchor', name: 'Anchor', kind: 'Recoil · Clement, c. 1670', a: 40 * Math.SQRT2, span: 7, thr: 2.2 * DEG, drop: 1.2 * DEG, mu: 0.15, M: 4 },
  { id: 'deadbeat', name: 'Deadbeat', kind: 'No recoil · Graham, 1715', a: 40 * Math.SQRT2, span: 7, thr: 1.2 * DEG, thl: 0.6 * DEG, drop: 1.2 * DEG, mu: 0.15, M: 4 },
  { id: 'grasshopper', name: 'Grasshopper', kind: 'Recoil, no sliding · Harrison', a: 80, span: 8, be: 105 * DEG, rn: 38, mu: 0, M: 4 },
];
export const unit = id => UNITS.find(u => u.id === id);

// ── small 2D helpers ─────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = a => Math.hypot(a[0], a[1]);
const unitv = a => mul(a, 1 / len(a));
const rot = (a, t) => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)];
const polar = (r, t) => [r * Math.cos(t), r * Math.sin(t)];
// the direction a point of the wheel moves when the wheel advances (clockwise)
export const adv = P => unitv([P[1], -P[0]]);
const wrapPi = a => a - TAU * Math.round(a / TAU);

// u where |p + u d - c| = R (both roots, or null)
function lineCircle(p, d, c, R) {
  const f = sub(p, c), A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - R * R, disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}
// wheel centre seen from the pallet frame (pallet arbor at the origin)
const wheelLocal = (A, th) => rot(sub([0, 0], A), -th);

// ── design: the faces of one escapement ─────────────────────────────────────
// A face is { type: 'line', p0 (tip), p1 } | { type: 'arc', r, a0, a1 } |
// { type: 'nib', q }, in the pallet frame. A pallet is { faces: [..] }:
// the deadbeat pallet has an arc then a line. sgn is +1 for the entry
// pallet (phi rises with theta) and -1 for the exit pallet.
export function design(u) {
  const { Rw } = CLOCK, p = P_TOOTH, A = [0, u.a];
  const half = (u.span + 0.5) * p / 2;   // contact points sit +-half from the top
  const out = { id: u.id, A, Rw, p, pallets: [] };
  if (u.id === 'grasshopper') {
    const bx = u.be - (u.span + 0.5) * p;
    for (const [sgn, b] of [[1, u.be], [-1, bx]]) out.pallets.push({ sgn, faces: [{ type: 'nib', q: sub(polar(u.rn, b), A) }] });
    return out;
  }
  const G = u.id === 'anchor' ? (p - 2 * u.drop) / (4 * u.thr) : (p / 2 - u.drop) / (u.thr + u.thl);
  out.G = G;
  for (const sgn of [1, -1]) {
    const Q = polar(Rw, Math.PI / 2 + sgn * half), q = sub(Q, A);
    // the face turns with the pallet at v = z x (Q - A); its meeting point
    // with the tip circle must move along the wheel by G Rw per radian
    const v = [-q[1], q[0]], t = adv(Q), d = unitv(sub(v, mul(t, sgn * G * Rw)));
    const at = th => { const r = lineCircle(q, d, wheelLocal(A, th), Rw); if (!r) return null; const k = Math.abs(r[0]) < Math.abs(r[1]) ? r[0] : r[1]; return add(q, mul(d, k)); };
    const tip = at(sgn * u.thr);
    // the far end: as far round as the face still meets the tip circle (9 deg at most)
    let lim = 9 * DEG; while (lim > 3 * DEG && !at(-sgn * lim)) lim -= 0.1 * DEG;
    const far = at(-sgn * lim);
    if (u.id === 'anchor') { out.pallets.push({ sgn, faces: [{ type: 'line', p0: tip, p1: far }] }); continue; }
    // deadbeat: the impulse face ends at the corner K (theta = -sgn thl);
    // past it the tooth rests on an arc about the pallet arbor
    const K = at(-sgn * u.thl), aK = Math.atan2(K[1], K[0]), r = len(K), sweep = 22 * DEG;
    out.pallets.push({ sgn, K, faces: [{ type: 'line', p0: tip, p1: K }, { type: 'arc', r, a0: sgn > 0 ? aK : aK - sweep, a1: sgn > 0 ? aK + sweep : aK }] });
  }
  return out;
}

// ── contact: a tooth tip on one pallet ──────────────────────────────────────
// Returns { raw, P, n, t, u } or null: raw is the wheel angle mod one tooth
// (any raw + k p is the same pose with another tooth), P the contact point
// (world, mm), n the face normal into the pallet, t the face tangent, u the
// place on the face (0 at the tip).
export function contact(D, j, th) {
  const pal = D.pallets[j], A = D.A, Wl = wheelLocal(A, th);
  for (const f of pal.faces) {
    let Pl = null, n = null, t = null, uu = 0;
    if (f.type === 'nib') {
      Pl = f.q;
    } else if (f.type === 'line') {
      const d = sub(f.p1, f.p0), r = lineCircle(f.p0, d, Wl, D.Rw);
      if (!r) continue;
      const k = [r[0], r[1]].find(x => x >= -1e-12 && x <= 1 + 1e-12);
      if (k === undefined) continue;
      Pl = add(f.p0, mul(d, k)); t = unitv(d); uu = k;
    } else {
      // circle about the arbor (origin) meets the tip circle
      const dd = len(Wl), a = (f.r * f.r - D.Rw * D.Rw + dd * dd) / (2 * dd), h2 = f.r * f.r - a * a;
      if (h2 < 0) continue;
      const h = Math.sqrt(h2), m = mul(Wl, a / dd), e = [-Wl[1] / dd, Wl[0] / dd];
      for (const c of [add(m, mul(e, h)), sub(m, mul(e, h))]) {
        const ang = Math.atan2(c[1], c[0]), mid = (f.a0 + f.a1) / 2;
        if (Math.abs(wrapPi(ang - mid)) <= (f.a1 - f.a0) / 2 + 1e-12) { Pl = c; uu = 1 + Math.abs(wrapPi(ang - (pal.sgn > 0 ? f.a0 : f.a1))); t = [-c[1] / f.r, c[0] / f.r]; break; }
      }
      if (!Pl) continue;
    }
    const P = add(A, rot(Pl, th));
    if (f.type === 'nib') { t = unitv(P); n = adv(P); } else { t = rot(t, th); n = [-t[1], t[0]]; if (dot(n, adv(P)) < 0) n = mul(n, -1); }
    const raw = Math.PI / 2 - Math.atan2(P[1], P[0]);
    return { raw, P, n, t, u: uu, face: f.type };
  }
  return null;
}
// the representative of raw + k p nearest ref, or (ahead) the first >= ref
export function pickTooth(raw, ref, p, ahead) {
  const k = ahead ? Math.ceil((ref - raw) / p - 1e-9) : Math.round((ref - raw) / p);
  return raw + k * p;
}

// pallet torque tau (N m, counter-clockwise) and contact force N (newtons)
// for wheel torque T (N m) at a
// contact c, with friction mu against the sliding of the tooth on the face.
// phiDot and w are the wheel and pallet speeds (rad/s).
export function torque(D, c, T, mu = 0, phiDot = 0, w = 0) {
  const r = c.P, q = sub(c.P, D.A);
  let f = c.n;
  if (mu && c.face !== 'nib') {
    const vt = mul([r[1], -r[0]], phiDot), vp = mul([-q[1], q[0]], w), vr = sub(vt, vp), s = Math.sign(dot(vr, c.t));
    f = add(c.n, mul(c.t, mu * s));
  }
  // lever arms are in mm: N comes out in newtons
  const N = T / (cross(r, mul(f, -1)) / 1000);
  return { tau: N * cross(q, f) / 1000, N };
}

// dphi/dtheta at a contact: the frictionless pallet torque for T = 1
export const gOf = (D, c) => torque(D, c, 1).tau;

// ── pendulum period ─────────────────────────────────────────────────────────
export const periodSmall = (L = CLOCK.L) => TAU * Math.sqrt(L / GRAV);
export function periodExact(a, L = CLOCK.L) {
  let x = 1, y = Math.cos(a / 2);
  for (let i = 0; i < 30 && Math.abs(x - y) > 1e-15; i++) [x, y] = [(x + y) / 2, Math.sqrt(x * y)];
  return periodSmall(L) / x;
}
export const periodSeries = (a, L = CLOCK.L) => periodSmall(L) * (1 + a * a / 16 + 11 * a ** 4 / 3072);

// escape wheel torque (N m) from the drive weight M (kg)
export const wheelTorque = M => M * GRAV * CLOCK.rb * CLOCK.eta / RATIO;

// ── the running clock ───────────────────────────────────────────────────────
// o: { M (kg), L (m), Q, free (no escapement), th0, w0 | amp (a start at
// the bottom with the speed of a swing of amplitude amp) }
export function makeSim(u, o = {}) {
  const D = design(u), C = CLOCK, p = P_TOOTH;
  const S = {
    u, D, L: o.L ?? C.L, M: o.M ?? u.M, free: !!o.free,
    t: 0, th: o.th0 ?? 0, w: o.w0 ?? (o.amp ?? 3 * DEG) * Math.sqrt(GRAV / (o.L ?? C.L)), phi: 0, phiDot: 0,
    mode: 'on', j: 0, target: null, beats: 0, drops: 0, swaps: 0, lost: 0, banked: false, last: null, tau: 0, N: 0, Nmin: Infinity,
    wEsc: 0, wDamp: 0,  // work done on the pendulum by the escapement and by the air (J)
  };
  const I = () => C.m * S.L * S.L, Qf = o.Q ?? C.Q, cDamp = () => (Qf === Infinity ? 0 : I() * Math.sqrt(GRAV / S.L) / Qf), T = () => wheelTorque(S.M);
  // the wheel angle on pallet j at theta, near ref (or the first ahead)
  const law = (j, th, ref, ahead) => { const c = contact(D, j, th); return c ? { c, phi: pickTooth(c.raw, ref, p, ahead) } : null; };
  // dphi/dtheta on pallet j: by virtual work it is the frictionless pallet
  // torque per unit wheel torque
  const slope = (j, th, ref) => { const L2 = law(j, th, ref); return { g: L2 ? gOf(D, L2.c) : 0 }; };
  // start with the entry pallet on a tooth
  const c0 = contact(D, 0, S.th); S.phi = c0 ? c0.raw : 0;
  const other = () => 1 - S.j;
  // the next tooth for pallet k: one tooth on from the tooth it let go
  // (a grasshopper nib lets go of a tooth that is still just ahead of it),
  // or at the start the first tooth ahead of the wheel
  const held = [null, null];
  const aim = k => { const L2 = held[k] === null ? law(k, S.th, S.phi + 1e-9, true) : law(k, S.th, held[k] + p); return L2 ? L2.phi : null; };
  const setTarget = () => { S.target = aim(other()); };
  setTarget();

  function accel(th, w, phiRef, phiDot) {
    const grav = -C.m * GRAV * S.L * Math.sin(th) - cDamp() * w;
    if (S.free) return { a: grav / I(), tau: 0, g: 0 };
    if (S.mode === 'drop') return { a: grav / I(), tau: 0, g: 0 };
    const Lw = law(S.j, th, phiRef);
    if (!Lw) return { a: grav / I(), tau: 0, g: 0, gone: true };
    const g = gOf(D, Lw.c);
    const tq = torque(D, Lw.c, T(), u.mu, phiDot ?? g * w, w);
    return { a: (grav + tq.tau) / (I() + C.J * g * g), tau: tq.tau, N: tq.N, g, phi: Lw.phi };
  }

  S.step = (dt = 2e-4) => {
    const prevTh = S.th;
    if (S.free) {
      const f = (th, w) => [w, accel(th, w).a];
      rk4(f, dt);
      S.t += dt; return S;
    }
    if (S.mode === 'drop') {
      // pendulum free, wheel free under T
      const f = (th, w) => [w, accel(th, w).a];
      rk4(f, dt);
      S.phiDot += T() / C.J * dt; S.phi += S.phiDot * dt;
      S.t += dt; S.wDamp += cDamp() * S.w * S.w * dt; S.tau = 0;
      const Lt = law(S.j, S.th, S.target);
      if (Lt) S.target = Lt.phi;
      if (Lt && S.phi >= S.target) {
        // plastic landing: keep I w + J g phi'
        const { g } = slope(S.j, S.th, S.target);
        const wNew = (I() * S.w + C.J * g * S.phiDot) / (I() + C.J * g * g);
        S.lost += 0.5 * I() * S.w * S.w + 0.5 * C.J * S.phiDot ** 2 - 0.5 * (I() + C.J * g * g) * wNew * wNew;
        S.wEsc += 0.5 * I() * (wNew * wNew - S.w * S.w);
        S.w = wNew; S.phi = S.target; S.phiDot = g * wNew; S.mode = 'on'; S.beats++;
        setTarget();
      }
      return S;
    }
    // engaged
    const ref = S.phi;
    const f = (th, w) => [w, accel(th, w, ref).a];
    rk4(f, dt);
    S.t += dt;
    const Lw = law(S.j, S.th, ref);
    if (!Lw) {
      // the tooth left the face: past the tip it drops; past the far end the
      // pendulum banked (swung too far for the pallets)
      if (S.last && S.last.u < 0.5) {
        held[S.j] = S.phi; S.mode = 'drop'; S.drops++; S.j = other();
        S.target = aim(S.j) ?? S.phi + p / 2;
      } else { S.banked = true; S.th = prevTh; S.w = 0; }
      return S;
    }
    const { g } = slope(S.j, S.th, Lw.phi);
    S.phi = Lw.phi; S.phiDot = g * S.w; S.last = Lw.c;
    const tq = torque(D, Lw.c, T(), u.mu, S.phiDot, S.w); S.tau = tq.tau; S.N = tq.N; S.Nmin = Math.min(S.Nmin, tq.N);
    S.wEsc += tq.tau * S.w * dt; S.wDamp += cDamp() * S.w * S.w * dt;
    // the other pallet: the wheel may not pass it. Grasshopper: when it
    // reaches the wheel it takes over (with a plastic impact).
    if (S.target !== null) {
      const Lo = law(other(), S.th, S.target);
      if (Lo) {
        S.target = Lo.phi;
        if (S.target <= S.phi) {
          const go = slope(other(), S.th, S.target).g;
          const wNew = (I() * S.w + C.J * go * S.phiDot) / (I() + C.J * go * go);
          S.lost += 0.5 * (I() + C.J * g * g) * S.w * S.w - 0.5 * (I() + C.J * go * go) * wNew * wNew;
          held[S.j] = S.phi; S.wEsc += 0.5 * I() * (wNew * wNew - S.w * S.w);
          S.w = wNew; S.phi = S.target; S.phiDot = go * wNew; S.j = other(); S.beats++; S.swaps++;
          setTarget();
        }
      }
    }
    return S;
  };
  function rk4(f, dt) {
    const th = S.th, w = S.w;
    const k1 = f(th, w), k2 = f(th + k1[0] * dt / 2, w + k1[1] * dt / 2), k3 = f(th + k2[0] * dt / 2, w + k2[1] * dt / 2), k4 = f(th + k3[0] * dt, w + k3[1] * dt);
    S.th = th + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    S.w = w + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  }
  // run for s seconds of clock time
  S.run = (s, dt = 2e-4) => { const n = Math.round(s / dt); for (let i = 0; i < n; i++) S.step(dt); return S; };
  return S;
}

// The steady amplitude for drive M: the swing after one period, started
// at the bottom moving up with amplitude a, is a map a -> F(a). Its fixed
// point (secant search) is the swing the clock settles to. The pendulum
// alone would take 2Q/w0, about 16 minutes, to get there.
const swingSpeed = (a, L) => 2 * Math.sqrt(GRAV / L) * Math.sin(a / 2);
const swingAmp = (w, L) => 2 * Math.asin(Math.min(1, Math.abs(w) / (2 * Math.sqrt(GRAV / L))));
export function oneSwing(u, a, o = {}) {
  const L = o.L ?? CLOCK.L, S = makeSim(u, { ...o, th0: 0, w0: swingSpeed(a, L) }), dt = o.dt ?? 2e-4;
  let prev = 0, ups = 0;
  for (let i = 0; i < 4 / dt * Math.sqrt(L); i++) {
    S.step(dt);
    if (S.banked) return { a: NaN, S };
    if (prev < 0 && S.th >= 0) { ups++; break; }
    prev = S.th;
  }
  // energy at the crossing: back to the amplitude of a free swing
  return { a: ups ? swingAmp(S.w, L) : NaN, S };
}
export function settle(u, o = {}) {
  // a swing too small to free a tooth only rocks on one pallet and dies
  // away: start the bracket at the first swing that escapes and gains
  const F = a => { const r = oneSwing(u, a, o); return r.S.beats > 0 && isFinite(r.a) ? r.a - a : NaN; };
  let lo = 1 * DEG, flo = F(lo);
  while (!(flo > 0) && lo < 10 * DEG) { lo += 0.25 * DEG; flo = F(lo); }
  let hi = 12 * DEG, fhi = F(hi);
  while (!(fhi < 0) && hi > lo + 0.25 * DEG) { hi -= 0.5 * DEG; fhi = F(hi); }
  if (!(flo > 0) || !(fhi < 0)) return NaN;
  // Illinois false position
  let side = 0;
  for (let i = 0; i < 40 && hi - lo > 1e-7; i++) {
    const a = (lo * fhi - hi * flo) / (fhi - flo), fa = F(a);
    if (!isFinite(fa)) { lo = a; break; }
    if (fa > 0) { lo = a; flo = fa; if (side === 1) fhi /= 2; side = 1; } else { hi = a; fhi = fa; if (side === -1) flo /= 2; side = -1; }
  }
  return (lo + hi) / 2;
}

// A settled run: settle s0 seconds, then record s1 seconds every dtS.
// Returns { t, th, phi, amp, period, recoil, rate } with recoil the largest
// backward turn of the wheel (rad) and rate the seconds a day gained
// against T0 = 2 pi sqrt(L/g) of the same pendulum (- = loses).
export function trace(u, o = {}) {
  const S = makeSim(u, { ...o, amp: o.amp ?? settle(u, o) }), dt = o.dt ?? 2e-4, s0 = o.settle ?? 4, s1 = o.record ?? 8, every = Math.max(1, Math.round((o.dtS ?? 0.01) / dt));
  S.run(s0, dt);
  const out = { t: [], th: [], phi: [], mode: [] }, cross = [];
  let prev = S.th, hi = 0, recoil = 0, peak = S.phi, n = Math.round(s1 / dt);
  const phi0 = S.phi, t0 = S.t;
  for (let i = 0; i < n; i++) {
    S.step(dt);
    if (prev < 0 && S.th >= 0) cross.push(S.t - dt * S.th / (S.th - prev));
    prev = S.th; hi = Math.max(hi, Math.abs(S.th));
    peak = Math.max(peak, S.phi); recoil = Math.max(recoil, peak - S.phi);
    if (i % every === 0) { out.t.push(S.t - t0); out.th.push(S.th); out.phi.push(S.phi - phi0); out.mode.push(S.mode); }
  }
  const period = cross.length > 1 ? (cross[cross.length - 1] - cross[0]) / (cross.length - 1) : NaN;
  const T0 = periodSmall(S.L);
  return { ...out, amp: hi, period, recoil, rate: (T0 / period - 1) * 86400, banked: S.banked, sim: S };
}
