// ============================================================================
//  PASCALINE & CURTA  ·  mech.js — digit wheels and carries of two calculators
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. A job (an addition
//  or a multiplication) becomes a plan: a list of timed events. at(plan, t)
//  gives the state at time t, in beats, so the 3D scene, the plot and the
//  tests read one source. Digit arrays are low digit first.
//
//  PASCALINE (Blaise Pascal, 1642). N decimal wheels. The user dials each
//  digit with a stylus: one dial step turns a wheel one tenth of a turn and
//  takes one beat. A pin on wheel j lifts the sautoir (a weighted lever
//  that pivots on the axle of wheel j + 1) while wheel j turns from LIFT0 to
//  9 (in this model the last three tenths). When wheel j goes from 9 to 0, the sautoir is free and falls; its pawl
//  pushes wheel j + 1 one tenth (one carry, CARRY_DUR beats). That step can
//  take wheel j + 1 from 9 to 0, so the carries ripple, one weight at a time.
//  The weight stores the energy of the carry, so a ripple through all wheels
//  needs no more force at the stylus than one carry. A carry out of the top
//  wheel is lost (overflow). Multiplication is repeated addition: for each
//  digit b_k of b, dial a, moved k places left, b_k times.
//
//  CURTA (Curt Herzstark, 1948, Type I). NS setting sliders, NR result
//  wheels and NC turn-counter wheels on a carriage. One crank turn turns the
//  stepped (Leibniz) drum once. Its nine teeth have lengths 1 .. 9; slider g
//  moves the gear on setting shaft g to the level where s_g teeth meet it,
//  so the shaft turns s_g tenths. Shaft g drives result wheel g + c (c is
//  the carriage shift). One turn has two phases:
//    add    f in [0, ADD_END]: every result wheel j advances s_(j - c)
//    carry  f in [CARRY0, CARRY0 + NR * CARRY_STEP]: the carry teeth sit on
//           a helix, so wheel j gets its carry at f_j = CARRY0 + j CARRY_STEP,
//           after wheel j - 1. A carry that takes wheel j from 9 to 0 sets
//           the flag that wheel j + 1 reads later in the same turn.
//  The turn counter adds 1 at wheel c in each turn (TICK_F), with its own
//  ripple. Multiplication a × b: set a, then for each digit b_k shift to k
//  and turn b_k times. Addition: set a, turn once, set b, turn once.
//
//  GREP MAP
//    export const UNITS ............ the two machines and their sizes
//    export function pascalJob ..... a + b or a × b as a list of dials
//    export function pascalPlan .... dials -> timed dial steps and carries
//    export function pascalAt ...... wheel positions, sautoir lifts at t
//    export function curtaJob ...... a + b or a × b as set/shift/turn segments
//    export function curtaPlan ..... segments -> timed sets, shifts and turns
//    export function curtaAt ....... wheels, sliders, drum, carriage at t
//    export function schoolCarries . carries of a + b by hand (the tests)
// ============================================================================

export const TAU = Math.PI * 2;
export const UNITS = [
  { id: 'pascaline', name: 'Pascaline', kind: 'Pascal 1642 · falling-weight carry', N: 6 },
  { id: 'curta', name: 'Curta', kind: 'Herzstark 1948 · stepped drum', NS: 8, NR: 11, NC: 6 },
];
export const unit = id => UNITS.find(u => u.id === id);

export const LIFT0 = 7;            // pascaline: the lift pin raises the sautoir from digit 7
export const CARRY_DUR = 0.6;      // pascaline: beats for one sautoir fall
export const MOVE_DUR = 0.6;       // pascaline: beats to move the stylus to the next wheel
export const ADD_END = 0.42, CARRY0 = 0.5, CARRY_STEP = 0.04, TICK_F = 0.2, TICK_W = 0.1;
export const SET_DUR = 0.8, SHIFT_DUR = 0.7, TURN_GAP = 0.15;

export const digitsOf = (v, n) => { const d = []; for (let i = 0; i < n; i++) { d.push(v % 10); v = Math.floor(v / 10); } return d; };
export const valueOf = d => d.reduce((s, x, i) => s + x * 10 ** i, 0);
const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = x => Math.max(0, Math.min(1, x));

// the carries of a + b written by hand, b < 10^n (for the tests)
export function schoolCarries(a, b, n) {
  const A = digitsOf(a, n), Bd = digitsOf(b, n);
  let c = 0, k = 0;
  for (let i = 0; i < n; i++) { const s = A[i] + Bd[i] + c; c = s >= 10 ? 1 : 0; k += c; }
  return k;
}

// ── PASCALINE ───────────────────────────────────────────────────────────────
// a job is a list of dials { wheel, d } (d in 1..9)
export function pascalJob(op, a, b, N = 6) {
  const out = [], dialNum = (v, shift) => digitsOf(v, N).forEach((d, i) => { if (d && i + shift < N) out.push({ wheel: i + shift, d }); });
  if (op === '+') { dialNum(a, 0); dialNum(b, 0); }
  else digitsOf(b, N).forEach((bk, k) => { for (let r = 0; r < bk; r++) dialNum(a, k); });
  return out;
}

// events: { kind: 'dial' | 'carry' | 'move', wheel, from, t0, dur, src, op }
// before: the digits before each event (a copy)
export function pascalPlan(dials, N = 6, start = null) {
  const D = start ? start.slice() : new Array(N).fill(0), ev = [];
  let t = 0, carries = 0, overflow = 0;
  const push = e => { e.before = D.slice(); e.t0 = t; ev.push(e); t += e.dur; };
  const carryFrom = (j, op) => {
    // the sautoir of wheel j falls and pushes wheel j + 1 one tenth
    carries++;
    if (j + 1 >= N) { overflow++; push({ kind: 'carry', wheel: N, from: 0, dur: CARRY_DUR, src: j, op }); return; }
    const from = D[j + 1];
    push({ kind: 'carry', wheel: j + 1, from, dur: CARRY_DUR, src: j, op });
    D[j + 1] = (from + 1) % 10;
    if (from === 9) carryFrom(j + 1, op);
  };
  dials.forEach(({ wheel, d }, op) => {
    if (op) push({ kind: 'move', wheel, from: D[wheel], dur: MOVE_DUR, op });
    for (let s = 0; s < d; s++) {
      const from = D[wheel];
      push({ kind: 'dial', wheel, from, dur: 1, op });
      D[wheel] = (from + 1) % 10;
      if (from === 9) carryFrom(wheel, op);
    }
  });
  return { kind: 'pascaline', N, events: ev, digits: D.slice(), carries, overflow, T: t, dials };
}

function findEvent(ev, t) {
  let lo = 0, hi = ev.length - 1;
  if (!ev.length || t < ev[0].t0) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ev[m].t0 <= t) lo = m; else hi = m - 1; }
  return lo;
}
// the sautoir of a wheel at position p (tenths, 0 <= p < 10): 0 rest, 1 top
export const sautoirLift = p => (p >= LIFT0 ? clamp01((p - LIFT0) / (10 - LIFT0)) : 0);

// { pos: N floats in [0, 10), lift: N in [0, 1], ev, i, digits, carriesDone }
export function pascalAt(P, t) {
  const N = P.N, ev = P.events;
  const i = findEvent(ev, t);
  let D, e = null, f = 0;
  if (i < 0) D = ev.length ? ev[0].before.slice() : P.digits.slice();
  else if (t >= P.T) { D = P.digits.slice(); }
  else { e = ev[i]; D = e.before.slice(); f = clamp01((t - e.t0) / e.dur); }
  const pos = D.map(x => x), lift = new Array(N).fill(0);
  if (e && e.kind === 'dial') pos[e.wheel] = e.from + f;
  if (e && e.kind === 'carry' && e.wheel < N) pos[e.wheel] = e.from + ease(f);
  for (let j = 0; j < N; j++) { pos[j] %= 10; lift[j] = sautoirLift(pos[j]); }
  // a falling sautoir: it was at the top when wheel src reached 0
  if (e && e.kind === 'carry') lift[e.src] = 1 - ease(f);
  let carriesDone = 0;
  const last = i < 0 ? -1 : t >= P.T ? ev.length - 1 : i - 1;
  for (let k = 0; k <= last; k++) if (ev[k].kind === 'carry') carriesDone++;
  if (e && e.kind === 'carry' && f >= 1) carriesDone++;
  return { pos, lift, ev: e, i, f, digits: D, carriesDone, value: valueOf(D) };
}

// ── CURTA ───────────────────────────────────────────────────────────────────
// segments: { set, shift, n } — set the sliders, move the carriage, turn n
export function curtaJob(op, a, b, U = UNITS[1]) {
  if (op === '+') return [{ set: a, shift: 0, n: 1 }, { set: b, shift: 0, n: 1 }];
  return digitsOf(b, U.NC).map((bk, k) => ({ set: a, shift: k, n: bk })).filter(s => s.n > 0);
}

// one turn of the crank on result R (digits) with setting S, shift c:
// { after, flags, carries: [{ j, f, wrap }] }
export function curtaTurn(R, S, c) {
  const NR = R.length, mid = R.slice(), flag = new Array(NR + 1).fill(false), add = new Array(NR).fill(0);
  for (let j = 0; j < NR; j++) {
    const g = j - c, s = g >= 0 && g < S.length ? S[g] : 0;
    add[j] = s;
    const v = R[j] + s; mid[j] = v % 10; if (v >= 10) flag[j + 1] = true;
  }
  const out = mid.slice(), carries = [];
  for (let j = 0; j < NR; j++) {
    if (!flag[j]) continue;
    const from = out[j];
    out[j] = (from + 1) % 10;
    carries.push({ j, f: CARRY0 + j * CARRY_STEP, from });
    if (from === 9) flag[j + 1] = true;
  }
  return { add, mid, after: out, carries, overflow: flag[NR] };
}
function counterTick(C, c) {
  const out = C.slice(); let j = c, n = 0;
  while (j < out.length) { const from = out[j]; out[j] = (from + 1) % 10; if (from !== 9) break; j++; n++; }
  return out;
}

// events: { kind: 'set' | 'shift' | 'turn', t0, dur, ... } in order
export function curtaPlan(segs, U = UNITS[1]) {
  let R = new Array(U.NR).fill(0), C = new Array(U.NC).fill(0), S = new Array(U.NS).fill(0), c = 0, t = 0;
  const ev = [], turns = [];
  let carries = 0, overflow = 0;
  for (const sg of segs) {
    const want = digitsOf(sg.set, U.NS);
    if (want.some((d, i) => d !== S[i])) { ev.push({ kind: 'set', t0: t, dur: SET_DUR, from: S.slice(), to: want, R: R.slice(), C: C.slice(), shift: c }); t += SET_DUR; S = want; }
    if (sg.shift !== c) { ev.push({ kind: 'shift', t0: t, dur: SHIFT_DUR, from: c, to: sg.shift, R: R.slice(), C: C.slice(), S: S.slice() }); t += SHIFT_DUR; c = sg.shift; }
    for (let k = 0; k < sg.n; k++) {
      const T = curtaTurn(R, S, c), C2 = counterTick(C, c);
      const e = { kind: 'turn', t0: t, dur: 1, turn: turns.length, S: S.slice(), shift: c, R: R.slice(), C: C.slice(), ...T, Cafter: C2 };
      ev.push(e); turns.push(e);
      carries += T.carries.length; if (T.overflow) overflow++;
      R = T.after; C = C2; t += 1 + TURN_GAP;
    }
  }
  // shaft turns before each turn, in tenths (for the 3D gears)
  const tenth = new Array(U.NS).fill(0);
  for (const e of ev) { e.tenth = tenth.slice(); if (e.kind === 'turn') e.S.forEach((s, g) => { tenth[g] += s; }); }
  return { kind: 'curta', U, events: ev, turns, res: R, cnt: C, set: S, shift: c, carries, overflow, T: t, tenthEnd: tenth };
}

// { res: NR floats, cnt: NC floats, set: NS floats, shift, drum (turns),
//   shaft: NS (tenths), ev, f (phase in the turn), turnsDone, carriesDone }
export function curtaAt(P, t) {
  const U = P.U, ev = P.events;
  const i = findEvent(ev, t);
  const out = { res: null, cnt: null, set: null, shift: 0, drum: 0, shaft: null, ev: null, f: 0, turnsDone: 0, carriesDone: 0, phase: 'idle' };
  if (i < 0 || !ev.length) {
    Object.assign(out, { res: new Array(U.NR).fill(0), cnt: new Array(U.NC).fill(0), set: new Array(U.NS).fill(0), shaft: new Array(U.NS).fill(0) });
    return out;
  }
  const e = ev[i], f = clamp01((t - e.t0) / e.dur), live = t < e.t0 + e.dur;
  // turns finished before this event
  let done = 0, cd = 0;
  for (let k = 0; k < i; k++) if (ev[k].kind === 'turn') { done++; cd += ev[k].carries.length; }
  out.turnsDone = done; out.carriesDone = cd; out.ev = live ? e : null; out.f = f;
  if (e.kind === 'set') {
    out.res = e.R.slice(); out.cnt = e.C.slice(); out.shift = e.shift; out.shaft = e.tenth.slice();
    out.set = e.from.map((d, g) => d + (e.to[g] - d) * ease(f));
    out.phase = live ? 'set' : 'idle';
  } else if (e.kind === 'shift') {
    out.res = e.R.slice(); out.cnt = e.C.slice(); out.set = e.S.slice(); out.shaft = e.tenth.slice();
    out.shift = e.from + (e.to - e.from) * ease(f);
    out.phase = live ? 'shift' : 'idle';
  } else {
    out.set = e.S.slice(); out.shift = e.shift; out.drum = done + f;
    out.shaft = e.tenth.map((v, g) => v + e.S[g] * clamp01(f / ADD_END));
    if (!live) {
      out.res = e.after.slice(); out.cnt = e.Cafter.slice(); out.turnsDone = done + 1; out.carriesDone = cd + e.carries.length; out.drum = done + 1;
    } else {
      const a = clamp01(f / ADD_END);
      out.res = e.R.map((v, j) => v + e.add[j] * a);
      for (const c of e.carries) {
        const k = clamp01((f - c.f) / CARRY_STEP);
        if (k > 0) out.res[c.j] = c.from + ease(k);
        if (k >= 1) out.carriesDone++;
      }
      out.carriesDone += cd;
      // the mid value holds after the add phase until a carry moves a wheel
      if (f >= ADD_END) e.mid.forEach((v, j) => { if (!e.carries.some(c => c.j === j && f > c.f)) out.res[j] = v; });
      const tk = clamp01((f - TICK_F) / TICK_W);
      out.cnt = tk >= 1 ? e.Cafter.slice() : e.C.map((v, j) => (e.Cafter[j] !== v ? v + ease(tk) : v));
      out.phase = f < ADD_END ? 'add' : f < CARRY0 ? 'idle' : 'carry';
    }
  }
  out.res = out.res.map(v => ((v % 10) + 10) % 10);
  out.cnt = out.cnt.map(v => ((v % 10) + 10) % 10);
  out.value = valueOf(out.res.map(Math.round).map(v => v % 10));
  out.count = valueOf(out.cnt.map(Math.round).map(v => v % 10));
  return out;
}
