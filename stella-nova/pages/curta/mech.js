// ============================================================================
//  CURTA  ·  mech.js — the kinematic model of the Curta Type I and Type II
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Every moving part
//  of scene.js takes its pose from at(plan, t), and the tests check the same
//  plan, so the parts that turn on the screen are the parts that the tests
//  check. Digit arrays are low digit first.
//
//  THE MACHINE (one central stepped drum, after Curt Herzstark)
//    Station p (p = 0 .. NR-1) is a fixed place round the drum, at the world
//    azimuth a_p = A0 - p * pitch (azimuth: x = r sin a, z = r cos a). For
//    p < NS it holds a setting shaft: a square shaft with a 10-tooth setting
//    gear that the slider p moves to level s (0 .. 9). For p >= NS the shaft
//    has its gear fixed at level 0 (a "nines" station).
//    The drum turns once per crank turn, clockwise from above: a drum
//    feature at drum angle A0 + alpha is at world azimuth A0 + alpha - theta.
//    So station p meets that feature at the crank angle theta = alpha + p
//    pitch. Higher stations meet each feature later in the turn.
//  STEPPED TEETH
//    Nine tooth rows at alpha_k = TOOTH0 + (k - 1) TOOTH_P (k = 1 .. 9).
//    Add segment of row k: on the levels 10 - k .. 9, so a gear at level s
//    meets s rows. Complement segment of row k: on the half levels below the
//    levels 0 .. k - 1, so a gear at level s meets 9 - s rows. The stepped
//    sleeve that carries the teeth lifts half a level (Lp / 2) when the crank
//    is pulled up: the gears then meet the complement segments.
//  CARRY (tens carry)
//    Each station shaft has a carry gear on a carry slide. When the result
//    wheel w passes 9 -> 0, its carry tooth trips the carry lever of wheel
//    w + 1 in the carriage. That lever pushes down the slide of the station
//    under wheel w + 1, and the carry gear goes down into the plane of the
//    drum's carry tooth (alpha = RES_CARRY). The tooth meets station p at
//    RES_CARRY + p pitch, after the add phase of stations p and p - 1, and
//    after the carry of station p - 1. So a carry can ripple through a run of
//    nines inside one turn. A carry out of the top wheel is lost.
//  SUBTRACTION (crank up)
//    The gears meet 9 - s teeth, the nines stations meet 9, and the crank
//    lift also pushes down the carry slide of station 0, so wheel c gets the
//    extra 1. That is the tens complement, R + 10^NR - S 10^c, so the result
//    wheels show R - S 10^c modulo 10^NR.
//  COUNTER (turn counter)
//    One drive tooth (alpha = CNT_DRIVE) meets only the counter station 0,
//    under counter wheel c: one tenth per turn, direction dir. dir is -1 when
//    exactly one of these is true: the crank is up, the reversing lever is
//    on. Counter carries come from a second carry tooth (CNT_CARRY) in the
//    same way, in the direction dir; a borrow is 0 -> 9 going down.
//  CARRIAGE
//    Result wheel w sits over station w - c (c = carriage shift). To shift,
//    the carriage lifts off the dog couplings, turns c pitches and drops.
//    The clearing lever sweeps 360 degrees round the lifted carriage and
//    turns each wheel forward to 0 as it passes.
//
//  TIMELINE. A job is a list of actions (set, lift, turn, shift, clear, rev).
//  plan(U, actions) gives timed events in seconds at 1x (an action may
//  carry dur, and each event keeps ai, its index in actions); at(plan, t) gives
//  the pose of every part at time t. Planners for the operations
//  (add, sub, mul, div, sqrt) write the action lists.
//
//  GREP MAP
//    export const UNITS ............ Type I and Type II
//    export function geo ........... sizes and places shared by scene + tests
//    export function teethMet ...... the rows a gear at level s meets
//    export function turnPlan ...... one crank turn: tooth and carry windows
//    export function wheelAt ....... a wheel value at a crank angle
//    export function plan .......... actions -> timed events
//    export function at ............ the pose of every part at time t
//    export function jobAdd/Sub/Mul/Div/Sqrt   the operation planners
//    export function parseJob ...... "4711*23", "1000/7", "sqrt 2" -> a job
// ============================================================================

export const UNITS = [
  { id: 'I', name: 'Curta Type I', kind: 'from 1948 · 8 sliders · 11-digit result · 6-digit counter', NS: 8, NR: 11, NC: 6, dia: 53, height: 85, mass: 230 },
  { id: 'II', name: 'Curta Type II', kind: 'from 1954 · 11 sliders · 15-digit result · 8-digit counter', NS: 11, NR: 15, NC: 8, dia: 65, height: 90, mass: 360 },
];
export const unit = id => UNITS.find(u => u.id === id) || UNITS[0];

// crank angles (degrees in one turn)
export const TOOTH0 = 10, TOOTH_P = 9, WIN = 6;
export const CNT_DRIVE = 20, CNT_CARRY = 75, RES_CARRY = 92;
export const SUB_REARM = 340;      // the subtraction carry slide goes down again
export const RESET_LAG = 3, RESET_W = 10, ARM_W = 5;
// durations at 1x (s)
export const DUR = { set: 0.9, lift: 0.45, turn: 1.6, rev: 0.45, shiftLift: 0.3, shiftStep: 0.28, clearLift: 0.3, clearSweep: 1.8, note: 0 };

const sm = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = x => Math.max(0, Math.min(1, x));
export const digitsOf = (v, n) => { const d = []; for (let i = 0; i < n; i++) { d.push(v % 10); v = Math.floor(v / 10); } return d; };
export const valueOf = d => d.reduce((s, x, i) => s + x * 10 ** i, 0);
export const fmt = v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// ── geometry (mm; y up; azimuth a: x = r sin a, z = r cos a) ───────────────
// Type I is about 53 mm across; Type II about 65 mm. The radial sizes scale
// with the diameter; the heights scale with the published height.
export function geo(U) {
  const k = U.dia / 53, kv = U.height / 85, y = v => v * kv;
  const pitch = 360 / (U.NR + U.NC - 1);
  const Rb = U.dia / 2;
  const RS = 17 * k;                              // station shafts
  const gear = { root: 1.6, tip: 2.7, w: 1.4, n: 10, hub: 1.25, sq: 0.62 };
  const drumR = RS - gear.tip - 0.25, toothR = RS - gear.root - 0.15;
  const Lp = 3.6 * kv, y0 = y(12);                 // setting levels
  const levelY = s => y0 + s * Lp;
  const TW = 1.4;                                  // tooth segment height
  // result wheels and the counter wheels in the carriage
  const sh = Math.sin(pitch / 2 * Math.PI / 180);
  const RW = 20.3 * k, hlw = 1.6, rw = Math.min(3, (RW - hlw) * sh - 0.6);
  const hlc = 1.5, rc = 1.8, RCw = hlc + 2.1 / sh;
  const RQ = RCw - hlc - 1.4;                      // counter stations
  const cpin = { root: 1.3, tip: 1.9, w: 1.0 };
  const hubR = RQ - cpin.tip - 0.25, hubTooth = RQ - cpin.root - 0.15;
  const A0 = (U.NS - 1) * pitch / 2;               // the sliders centre on the front (a = 0)
  return {
    k, kv, pitch, Rb, Rc: Rb - 1.8, RS, gear, drumR, toothR, Lp, y0, levelY, TW, A0,
    shell: { y0: y(4), y1: y(56), t: 1.6 * k, slotY0: y(9.4), slotY1: y(47.2), slotW: 1.7 },
    base: { y0: 0, y1: y(4) },
    sleeve: { y0: y(8.4), y1: y(46.6), lift: Lp / 2 },
    // carry tooth plane and the carry gear positions (fixed drum core)
    carry: { t0: y(49.6), t1: y(51.0), eng: y(49.6), idle: y(51.6), slideR: RS + 3.1 },
    core: { r: 5 * k, y0: y(5), disc0: y(48.8), disc1: y(51.0) },
    hub: { r: hubR, tooth: hubTooth, y0: y(51.0), y1: y(55.9), drive: [y(51.6), y(52.6)], ccarry: [y(53.4), y(54.4)], cidle: y(54.95), detent: [y(55.0), y(55.8)] },
    deck: { y0: y(56), y1: y(58), dog: y(58) },
    car: { y0: y(59.2), plate1: y(60.2), wheelY: y(66.6), cwheelY: y(66.8), top0: y(70.6), top1: y(71.6), lift: 2.6 },
    RW, rw, hlw, RCw, rc, hlc, RQ, cpin,
    crank: { y0: y(72), boss1: y(76), arm1: y(79), r: 21 * k, knob1: y(92), lift: Lp / 2, shaftR: 2.1 },
    stationAz: p => A0 - p * pitch,
  };
}

// the tooth rows a gear at level s meets: add (crank down) or complement (up)
export function teethMet(s, up) {
  const out = [];
  for (let k = 1; k <= 9; k++) if (up ? k >= s + 1 : k >= 10 - s) out.push(k);
  return out;
}
// tooth segments of the sleeve, in the sleeve frame: { k, alpha, y0, y1, comp }
export function toothSegments(G) {
  const segs = [];
  for (let k = 1; k <= 9; k++) {
    const alpha = TOOTH0 + (k - 1) * TOOTH_P;
    for (let l = 10 - k; l <= 9; l++) { const c = G.levelY(l); segs.push({ k, alpha, y0: c - G.TW / 2, y1: c + G.TW / 2, comp: false }); }
    for (let l = 0; l <= k - 1; l++) { const c = G.levelY(l) - G.Lp / 2; segs.push({ k, alpha, y0: c - G.TW / 2, y1: c + G.TW / 2, comp: true }); }
  }
  return segs;
}

// ── one crank turn ──────────────────────────────────────────────────────────
// s: { S, R, C, c, up, rev, st, cq }. Windows: { reg 'R'|'C', w (wheel or
// -1), p (station), t0, t1 (crank deg), d (+1|-1), kind 'add'|'carry'|'drive',
// from (wheel digit before) }.
export function turnPlan(s, U) {
  const G = geo(U), pitch = G.pitch, c = s.c, NR = U.NR, NC = U.NC;
  const pend = [];
  for (let p = 0; p < NR; p++) {
    const sp = p < U.NS ? s.S[p] : 0, w = p + c < NR ? p + c : -1;
    for (const k of teethMet(sp, s.up)) {
      const m = TOOTH0 + (k - 1) * TOOTH_P + pitch * p;
      pend.push({ reg: 'R', w, p, t0: m - WIN / 2, t1: m + WIN / 2, d: 1, kind: 'add', k });
    }
  }
  const dir = s.up !== s.rev ? -1 : 1;
  if (c < NC) pend.push({ reg: 'C', w: c, p: 0, t0: CNT_DRIVE - WIN / 2, t1: CNT_DRIVE + WIN / 2, d: dir, kind: 'drive' });
  const armR = [], armC = [];
  const R = s.R.slice(), C = s.C.slice(), st = s.st.slice(), cq = s.cq.slice();
  let overflowR = 0, overflowC = 0;
  const carryR = (p, from) => {
    const m = RES_CARRY + pitch * p, win = { reg: 'R', w: p + c, p, t0: m - WIN / 2, t1: m + WIN / 2, d: 1, kind: 'carry' };
    if (win.t0 <= from) throw new Error(`carry into station ${p} at ${win.t0} is not after its arm at ${from}`);
    armR.push({ p, a: from, r: win.t1 + RESET_LAG });
    pend.push(win);
  };
  const carryC = (q, from) => {
    const m = CNT_CARRY + pitch * q, win = { reg: 'C', w: q + c, p: q, t0: m - WIN / 2, t1: m + WIN / 2, d: dir, kind: 'carry' };
    if (win.t0 <= from) throw new Error(`counter carry into ${q} at ${win.t0} is not after its arm at ${from}`);
    armC.push({ p: q, a: from, r: win.t1 + RESET_LAG });
    pend.push(win);
  };
  // the subtraction carry: slide 0 is down from the lift
  if (s.up && c < NR) carryR(0, -1e9);
  const done = [];
  while (pend.length) {
    let bi = 0;
    for (let i = 1; i < pend.length; i++) if (pend[i].t1 < pend[bi].t1) bi = i;
    const e = pend.splice(bi, 1)[0];
    if (e.reg === 'R') {
      st[e.p] += e.d;
      if (e.w >= 0) {
        e.from = R[e.w]; R[e.w] = (R[e.w] + 1) % 10;
        if (e.from === 9) { if (e.w + 1 < NR) carryR(e.w + 1 - c, e.t1); else overflowR++; }
      }
    } else {
      cq[e.p] += e.d;
      e.from = C[e.w]; C[e.w] = (C[e.w] + e.d + 10) % 10;
      if ((e.d > 0 && e.from === 9) || (e.d < 0 && e.from === 0)) { if (e.w + 1 < NC) carryC(e.w + 1 - c, e.t1); else overflowC++; }
    }
    done.push(e);
  }
  done.sort((a, b) => a.t0 - b.t0);
  // per-wheel lists for fast lookup
  const byR = Array.from({ length: NR }, () => []), byC = Array.from({ length: NC }, () => []), byS = Array.from({ length: NR }, () => []), byQ = Array.from({ length: NC }, () => []);
  for (const e of done) {
    if (e.reg === 'R') { byS[e.p].push(e); if (e.w >= 0) byR[e.w].push(e); }
    else { byQ[e.p].push(e); byC[e.w].push(e); }
  }
  return { wins: done, byR, byC, byS, byQ, armR, armC, dir, R1: R, C1: C, st1: st, cq1: cq, overflowR, overflowC, carries: done.filter(e => e.kind === 'carry' && e.reg === 'R').length, ccarries: done.filter(e => e.kind === 'carry' && e.reg === 'C').length };
}
// progress of a window at crank angle th (deg)
const prog = (e, th) => sm((th - e.t0) / (e.t1 - e.t0));
// a value (wheel digit or station tenths) at th: base + sum of window moves
export function wheelAt(base, list, th) { let v = base; for (const e of list) { if (th <= e.t0) break; v += e.d * prog(e, th); } return v; }
// the slide of a station: 0 up, 1 down (arms: { p, a, r })
function slideAt(arms, p, th, up, sub0) {
  let v = 0;
  for (const A of arms) if (A.p === p) v = Math.max(v, Math.min(sm((th - A.a) / ARM_W), 1 - sm((th - A.r) / RESET_W)));
  if (sub0 && up) v = Math.max(v, sm((th - SUB_REARM) / RESET_W));
  return v;
}

// ── timeline ────────────────────────────────────────────────────────────────
export function initState(U) {
  return { S: new Array(U.NS).fill(0), R: new Array(U.NR).fill(0), C: new Array(U.NC).fill(0), c: 0, up: false, rev: false, st: new Array(U.NR).fill(0), cq: new Array(U.NC).fill(0), turns: 0 };
}
const copyState = s => ({ S: s.S.slice(), R: s.R.slice(), C: s.C.slice(), c: s.c, up: s.up, rev: s.rev, st: s.st.slice(), cq: s.cq.slice(), turns: s.turns });

// actions: { a: 'set', v } | { a: 'lift', up } | { a: 'turn' } | { a: 'shift', to }
//          | { a: 'clear' } | { a: 'rev', on }; any action may carry step: i
export function plan(U, actions, start = null, steps = []) {
  let s = start ? copyState(start) : initState(U), t = 0, step = 0;
  const ev = [];
  let carries = 0, turns = 0, overR = 0;
  actions.forEach((A, ai) => {
    if (A.step != null) step = A.step;
    const e = { a: A.a, t0: t, s: copyState(s), step, A, ai };
    if (A.a === 'set') {
      const to = typeof A.v === 'number' ? digitsOf(A.v, U.NS) : A.v.slice();
      if (to.every((d, i) => d === s.S[i])) return;
      e.to = to; e.dur = A.dur || DUR.set; s.S = to;
    } else if (A.a === 'lift') {
      if (A.up === s.up) return;
      e.dur = DUR.lift; e.up = A.up; s.up = A.up;
    } else if (A.a === 'rev') {
      if (A.on === s.rev) return;
      e.dur = DUR.rev; e.on = A.on; s.rev = A.on;
    } else if (A.a === 'turn') {
      const T = turnPlan(s, U);
      e.T = T; e.dur = A.dur || DUR.turn; e.turn = turns++;
      carries += T.carries; overR += T.overflowR;
      s.R = T.R1; s.C = T.C1; s.st = T.st1; s.cq = T.cq1; s.turns++;
    } else if (A.a === 'shift') {
      const to = Math.max(0, Math.min(U.NC - 1, A.to));
      if (to === s.c) return;
      e.from = s.c; e.to = to; e.dur = 2 * DUR.shiftLift + DUR.shiftStep * (Math.abs(to - s.c) + 0.5); s.c = to;
    } else if (A.a === 'clear') {
      e.dur = 2 * DUR.clearLift + DUR.clearSweep;
      s.R = s.R.map(() => 0); s.C = s.C.map(() => 0);
    } else return;
    ev.push(e); t += e.dur;
  });
  return { U, G: geo(U), events: ev, T: t, end: copyState(s), steps, carries, turns, overflow: overR };
}
function findEvent(ev, t) {
  if (!ev.length || t < ev[0].t0) return -1;
  let lo = 0, hi = ev.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ev[m].t0 <= t) lo = m; else hi = m - 1; }
  return lo;
}

// the pose of every part at time t (s at 1x)
export function at(P, t) {
  const U = P.U, G = P.G, ev = P.events;
  const i = findEvent(ev, t);
  const s = i < 0 ? (ev.length ? ev[0].s : P.end) : t >= ev[i].t0 + ev[i].dur ? (i + 1 < ev.length ? ev[i + 1].s : P.end) : ev[i].s;
  const e = i >= 0 && t < ev[i].t0 + ev[i].dur ? ev[i] : null;
  const f = e ? clamp01((t - e.t0) / e.dur) : 0;
  const Q = {
    set: s.S.slice(), R: s.R.slice(), C: s.C.slice(), st: s.st.slice(), cq: s.cq.slice(),
    lift: s.up ? 1 : 0, rev: s.rev ? 1 : 0, car: s.c, carLift: 0, clear: 0, drum: s.turns * 360, th: 0,
    slide: new Array(U.NR).fill(0), cslide: new Array(U.NC).fill(0), ev: e, f, phase: 'idle', step: e ? e.step : (i >= 0 ? ev[Math.min(i, ev.length - 1)].step : 0),
    active: null, state: s, turnsDone: s.turns, up: s.up, rev2: s.rev, c: s.c,
  };
  if (s.up && s.c < U.NR) Q.slide[0] = 1;
  if (!e) { Q.phase = 'idle'; finish(Q); return Q; }
  if (e.a === 'set') {
    Q.phase = 'set';
    // the sliders move from the units up, each a little after the last
    for (let g = 0; g < U.NS; g++) { const k = sm((f - g * 0.03) / (1 - 0.03 * (U.NS - 1))); Q.set[g] = s.S[g] + (e.to[g] - s.S[g]) * k; }
    let best = -1, bd = 0; for (let g = 0; g < U.NS; g++) { const d = Math.abs(e.to[g] - s.S[g]); if (d > bd) { bd = d; best = g; } }
    Q.active = { kind: 'slider', p: best };
  } else if (e.a === 'lift') {
    Q.phase = 'lift';
    const k = sm(f); Q.lift = e.up ? k : 1 - k; Q.slide[0] = Q.lift;
    Q.active = { kind: 'crank' };
  } else if (e.a === 'rev') {
    Q.phase = 'rev'; const k = sm(f); Q.rev = e.on ? k : 1 - k; Q.active = { kind: 'rev' };
  } else if (e.a === 'turn') {
    const T = e.T, th = f * 360;
    Q.phase = 'turn'; Q.th = th; Q.drum = s.turns * 360 + th;
    for (let w = 0; w < U.NR; w++) Q.R[w] = wheelAt(s.R[w], T.byR[w], th);
    for (let w = 0; w < U.NC; w++) Q.C[w] = wheelAt(s.C[w], T.byC[w], th);
    for (let p = 0; p < U.NR; p++) Q.st[p] = wheelAt(s.st[p], T.byS[p], th);
    for (let q = 0; q < U.NC; q++) Q.cq[q] = wheelAt(s.cq[q], T.byQ[q], th);
    for (let p = 0; p < U.NR; p++) Q.slide[p] = slideAt(T.armR, p, th, s.up, p === 0);
    for (let q = 0; q < U.NC; q++) Q.cslide[q] = slideAt(T.armC, q, th, false, false);
    // the station the drum works on now: the last window that started
    let cur = null; for (const w of T.wins) if (w.t0 <= th) cur = w; else break;
    Q.win = cur && th < cur.t1 + 4 ? cur : null;
    Q.turnPhase = th < TOOTH0 - WIN ? 'start' : th < RES_CARRY - WIN ? 'add' : 'carry';
    Q.active = { kind: 'turn', th, p: cur ? cur.p : 0, reg: cur ? cur.reg : 'R', wk: cur ? cur.kind : 'add' };
    Q.carriesDone = T.wins.filter(w => w.kind === 'carry' && w.reg === 'R' && w.t1 <= th).length;
    Q.T = T;
  } else if (e.a === 'shift') {
    Q.phase = 'shift';
    const L = DUR.shiftLift / e.dur;
    Q.carLift = f < L ? sm(f / L) : f > 1 - L ? sm((1 - f) / L) : 1;
    Q.car = e.from + (e.to - e.from) * sm((f - L) / (1 - 2 * L));
    Q.slide.fill(0); if (s.up) Q.slide[0] = 1;
    Q.active = { kind: 'carriage' };
  } else if (e.a === 'clear') {
    Q.phase = 'clear';
    const L = DUR.clearLift / e.dur, u = clamp01((f - L) / (1 - 2 * L));
    Q.carLift = f < L ? sm(f / L) : f > 1 - L ? sm((1 - f) / L) : 1;
    Q.clear = 360 * sm(u);
    // the lever finger passes wheel j at u_j and turns it forward to 0
    const L0 = clearRest(G, U), uOf = j => (L0 - (G.A0 - j * G.pitch)) / 360;
    const U2 = sm(u);
    for (let j = 0; j < U.NR; j++) { const v = s.R[j]; if (v) Q.R[j] = v + (10 - v) * sm((U2 - uOf(j) + 0.02) / 0.1); }
    for (let j = 0; j < U.NC; j++) { const v = s.C[j]; if (v) Q.C[j] = v + (10 - v) * sm((U2 - uOf(j) + 0.02) / 0.1); }
    Q.active = { kind: 'clear', a: L0 - Q.clear };
  }
  finish(Q);
  return Q;
}
// the clearing lever rest azimuth in the carriage frame: in the gap past wheel 0
export const clearRest = (G, U) => G.A0 + 2.5 * G.pitch;
function finish(Q) {
  Q.R = Q.R.map(v => ((v % 10) + 10) % 10);
  Q.C = Q.C.map(v => ((v % 10) + 10) % 10);
  Q.value = valueOf(Q.R.map(v => Math.floor(v + 1e-6) % 10));
  Q.count = valueOf(Q.C.map(v => Math.floor(v + 1e-6) % 10));
  Q.setting = valueOf(Q.set.map(v => Math.round(v)));
}

// ── operation planners ──────────────────────────────────────────────────────
// Each returns { actions, steps: [{ text }], op, a, b, k, expect }.
function builder() {
  const actions = [], steps = [];
  return {
    actions, steps,
    step(text, detail = '') { steps.push({ text, detail }); },
    push(A) { actions.push({ ...A, step: steps.length - 1 }); },
  };
}
const turns = (b, n) => { for (let i = 0; i < n; i++) b.push({ a: 'turn' }); };

export function jobSet(U, a) {
  const b = builder();
  b.step(`Set ${fmt(a)}`, 'Each slider moves its setting gear to the level of its digit.'); b.push({ a: 'set', v: a });
  return { actions: b.actions, steps: b.steps, op: 'set', a, b: 0 };
}
export function jobAdd(U, a, bb) {
  const b = builder();
  b.step('Clear', 'Lift the carriage and swing the clearing lever once round.'); b.push({ a: 'lift', up: false }); b.push({ a: 'rev', on: false }); b.push({ a: 'shift', to: 0 }); b.push({ a: 'clear' });
  b.step(`Set ${fmt(a)}`); b.push({ a: 'set', v: a });
  b.step('Turn once', `The result shows ${fmt(a)}; the counter shows 1.`); b.push({ a: 'turn' });
  b.step(`Set ${fmt(bb)}`); b.push({ a: 'set', v: bb });
  b.step('Turn once', 'Each wheel takes its digit; the carries follow in the same turn.'); b.push({ a: 'turn' });
  return { actions: b.actions, steps: b.steps, op: '+', a, b: bb };
}
export function jobSub(U, a, bb) {
  const b = builder();
  b.step('Clear', 'Lift the carriage and swing the clearing lever once round.'); b.push({ a: 'lift', up: false }); b.push({ a: 'rev', on: false }); b.push({ a: 'shift', to: 0 }); b.push({ a: 'clear' });
  b.step(`Set ${fmt(a)}`); b.push({ a: 'set', v: a });
  b.step('Turn once', `The result shows ${fmt(a)}.`); b.push({ a: 'turn' });
  b.step(`Set ${fmt(bb)}`); b.push({ a: 'set', v: bb });
  b.step('Pull the crank up', 'The stepped sleeve lifts half a level: each gear now meets 9 - s teeth.'); b.push({ a: 'lift', up: true });
  b.step('Turn once', 'Nines\' complement plus one: the result goes down by the setting.'); b.push({ a: 'turn' });
  b.step('Push the crank down'); b.push({ a: 'lift', up: false });
  return { actions: b.actions, steps: b.steps, op: '−', a, b: bb };
}
// the short-cut digits of b: each digit 6..9 becomes d - 10 with 1 carried
export function shortcut(b, n) {
  const out = []; let carry = 0, i = 0;
  while (b > 0 || carry) { let d = b % 10 + carry; b = Math.floor(b / 10); carry = 0; if (d >= 6) { d -= 10; carry = 1; } out.push(d); i++; }
  return out.length > n ? null : out;
}
export function jobMul(U, a, bb, short = false) {
  const b = builder();
  b.step('Clear', 'Lift the carriage and swing the clearing lever once round.'); b.push({ a: 'lift', up: false }); b.push({ a: 'rev', on: false }); b.push({ a: 'shift', to: 0 }); b.push({ a: 'clear' });
  b.step(`Set ${fmt(a)}`); b.push({ a: 'set', v: a });
  let digs = short ? shortcut(bb, U.NC) : null;
  const used = !!digs;
  if (!digs) digs = digitsOf(bb, U.NC);
  let up = false;
  digs.forEach((d, k) => {
    if (!d) return;
    if (k) { b.step(`Shift to ${k + 1}`, `Lift the carriage and turn it one place: each turn now adds ${fmt(10 ** k)} × ${fmt(a)}.`); b.push({ a: 'shift', to: k }); }
    if (d < 0 && !up) { b.step('Pull the crank up', 'The short cut: subtract here, and add one turn at the next place.'); b.push({ a: 'lift', up: true }); up = true; }
    if (d > 0 && up) { b.step('Push the crank down'); b.push({ a: 'lift', up: false }); up = false; }
    b.step(`${d > 0 ? 'Add' : 'Subtract'} ${Math.abs(d)} turn${Math.abs(d) > 1 ? 's' : ''} at place ${k + 1}`, `The counter ${d > 0 ? 'goes up' : 'goes down'} by ${Math.abs(d)} × ${fmt(10 ** k)}.`);
    turns(b, Math.abs(d));
  });
  if (up) { b.step('Push the crank down'); b.push({ a: 'lift', up: false }); }
  return { actions: b.actions, steps: b.steps, op: '×', a, b: bb, short: used, digs };
}
// restoring division: a × 10^k / bb; the counter shows the quotient
export function jobDiv(U, a, bb, k = 0) {
  if (bb < 1) return { err: 'The divisor must be at least 1.' };
  if (k > U.NC - 1) return { err: `At most ${U.NC - 1} decimal places on this type.` };
  const M = a * 10 ** k;
  if (M >= 10 ** U.NR) return { err: 'The dividend does not fit the result register.' };
  const q = Math.floor(M / bb);
  if (q >= 10 ** U.NC) return { err: `The quotient ${fmt(q)} needs more than ${U.NC} counter digits.` };
  const b = builder();
  b.step('Clear', 'Lift the carriage and swing the clearing lever once round.'); b.push({ a: 'lift', up: false }); b.push({ a: 'rev', on: false }); b.push({ a: 'shift', to: 0 }); b.push({ a: 'clear' });
  b.step(`Set the dividend ${fmt(a)}`); b.push({ a: 'set', v: a });
  if (k) { b.step(`Shift to ${k + 1}`, `For ${k} decimal place${k > 1 ? 's' : ''}, the dividend goes in ${k} place${k > 1 ? 's' : ''} up.`); b.push({ a: 'shift', to: k }); }
  b.step('Turn once', 'The dividend is now in the result register.'); b.push({ a: 'turn' });
  b.step('Counter back to 0', 'Set 0, pull the crank up and turn: the result does not change (it gets 10^n, which falls off the top), and the counter goes back by 1.'); b.push({ a: 'set', v: 0 }); b.push({ a: 'lift', up: true }); b.push({ a: 'turn' });
  b.step('Reversing lever on', 'Now each subtraction turn counts up on the counter.'); b.push({ a: 'rev', on: true });
  b.step(`Set the divisor ${fmt(bb)}`); b.push({ a: 'set', v: bb });
  let R = M, c = U.NC - 1, up = true;
  while (c > 0 && (bb * 10 ** c > R || bb * 10 ** c >= 10 ** U.NR)) c--;
  for (; c >= 0; c--) {
    b.step(`Shift to ${c + 1}`); b.push({ a: 'shift', to: c });
    if (!up) { b.push({ a: 'lift', up: true }); up = true; }
    const unit = bb * 10 ** c;
    let d = 0;
    while (R >= unit) { R -= unit; d++; }
    b.step(`Subtract at place ${c + 1}: ${d} turn${d === 1 ? '' : 's'} fit`, `Turn until the result goes below zero (it shows nines at the top).`);
    turns(b, d + 1);
    b.step('One turn too many: add it back', 'Push the crank down and turn once. The counter goes back by one at this place.'); b.push({ a: 'lift', up: false }); up = false; b.push({ a: 'turn' });
  }
  return { actions: b.actions, steps: b.steps, op: '÷', a, b: bb, k, expect: { q, r: R } };
}
// square root by odd numbers (each digit: subtract 1, 3, 5, ... at its place)
export const isqrt = n => { let x = Math.floor(Math.sqrt(n)); while (x * x > n) x--; while ((x + 1) * (x + 1) <= n) x++; return x; };
export function jobSqrt(U, N, k = 0) {
  if (2 * k > U.NC - 1) return { err: `At most ${Math.floor((U.NC - 1) / 2)} decimal places on this type.` };
  const M = N * 10 ** (2 * k);
  if (N >= 10 ** U.NS) return { err: `Set at most ${U.NS} digits.` };
  if (M >= 10 ** U.NR) return { err: 'The number does not fit the result register.' };
  const b = builder();
  b.step('Clear', 'Lift the carriage and swing the clearing lever once round.'); b.push({ a: 'lift', up: false }); b.push({ a: 'rev', on: false }); b.push({ a: 'shift', to: 0 }); b.push({ a: 'clear' });
  b.step(`Set ${fmt(N)}`); b.push({ a: 'set', v: N });
  if (k) { b.step(`Shift to ${2 * k + 1}`, `For ${k} decimal place${k > 1 ? 's' : ''}, the number goes in ${2 * k} places up.`); b.push({ a: 'shift', to: 2 * k }); }
  b.step('Turn once', 'The number is now in the result register.'); b.push({ a: 'turn' });
  b.step('Counter back to 0', 'Set 0, pull the crank up and turn once: only the counter changes.'); b.push({ a: 'set', v: 0 }); b.push({ a: 'lift', up: true }); b.push({ a: 'turn' });
  b.step('Reversing lever on', 'Each subtraction turn now counts up: the counter builds the root.'); b.push({ a: 'rev', on: true });
  let R = M, C = 0, up = true;
  const top = Math.floor((String(M).length - 1) / 2);
  for (let m = top; m >= 0; m--) {
    b.step(`Shift to ${m + 1}`, `Root digit at place ${m + 1}: subtract the odd numbers 1, 3, 5, ... after twice the root so far.`); b.push({ a: 'shift', to: m });
    if (!up) { b.push({ a: 'lift', up: true }); up = true; }
    let i = 0;
    for (;;) {
      const S = 2 * C + 10 ** m;               // 2 x (root so far) + 1 at place m
      b.step(`Set ${fmt(S)} and subtract`, `That is (2 × ${fmt(C / 10 ** m)} + ${2 * i + 1}) × 10^${m}.`); b.push({ a: 'set', v: S });
      b.push({ a: 'turn' });
      if (R - S * 10 ** m < 0) {
        b.step('Too far: add it back', 'Push the crank down and turn once.'); b.push({ a: 'lift', up: false }); up = false; b.push({ a: 'turn' });
        break;
      }
      R -= S * 10 ** m; C += 10 ** m; i++;
    }
  }
  return { actions: b.actions, steps: b.steps, op: '√', a: N, b: 0, k, expect: { root: C, r: R } };
}

// a job from text or fields
export function makeJob(U, op, a, bb, o = {}) {
  const lim = 10 ** U.NS;
  a = Math.max(0, Math.floor(+a || 0)); bb = Math.max(0, Math.floor(+bb || 0));
  if (op !== 'set' && a >= lim) return { err: `${fmt(a)} has more than ${U.NS} digits: ${U.NS} sliders on this type.` };
  if ((op === '+' || op === '−' || op === '÷') && bb >= lim) return { err: `${fmt(bb)} has more than ${U.NS} digits.` };
  if (op === '×' && bb >= 10 ** U.NC) return { err: `The multiplier can have at most ${U.NC} digits (the counter).` };
  if (op === 'set') return jobSet(U, Math.min(lim - 1, a));
  if (op === '+') return jobAdd(U, a, bb);
  if (op === '−') return jobSub(U, a, bb);
  if (op === '×') return jobMul(U, a, bb, !!o.short);
  if (op === '÷') return jobDiv(U, a, bb, o.k || 0);
  if (op === '√') return jobSqrt(U, a, o.k || 0);
  return { err: 'Unknown operation.' };
}
// "4711 x 23", "1000/7", "sqrt 2", "12-5"
export function parseJob(text) {
  const t = String(text).replace(/\s+/g, '').replace(/,/g, '');
  let m = t.match(/^(?:√|sqrt|root)\(?(\d+)\)?$/i);
  if (m) return { op: '√', a: +m[1], b: 0 };
  m = t.match(/^(\d+)([+\-−*x×/÷:])(\d+)$/i);
  if (!m) return null;
  const op = { '+': '+', '-': '−', '−': '−', '*': '×', x: '×', X: '×', '×': '×', '/': '÷', '÷': '÷', ':': '÷' }[m[2]];
  return { op, a: +m[1], b: +m[3] };
}
