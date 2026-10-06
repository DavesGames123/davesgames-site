// ============================================================================
//  ENIGMA ROTORS  ·  mech.js — the Enigma I cipher machine model (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Letters are the
//  numbers 0..25 (A = 0). Rotor order is left, middle, right, as the
//  operator sees the machine. The current comes in at the right (the entry
//  wheel), goes right to left through the three rotors, turns back in the
//  reflector, and goes left to right to the lamp.
//
//  WIRING (public historical facts)
//    Rotors I..V of the Enigma I and reflector B ("UKW-B"). The notch
//    letter is the window letter at which a rotor lets its left neighbour
//    step: I Q, II E, III V, IV J, V Z.
//
//  CONTACTS. "Absolute" contact a is the contact at place a of the fixed
//  frame (the entry wheel order, A at place 0). A rotor at window position
//  p with ring setting r turns its core by s = p - r places, so the current
//  at absolute contact a enters core contact a + s and leaves at absolute
//  contact W[a + s] - s. scene.js draws the path with these absolute
//  contacts, so the 3D wires are the ones the tests check.
//
//  STEPPING (before the current flows, on each key press)
//    pawl 1 always pushes the right rotor's ratchet.
//    pawl 2 rides on the right rotor's notch ring. At the notch it drops
//           and pushes the middle rotor.
//    pawl 3 rides on the middle rotor's notch ring. At the notch it drops
//           and pushes the left rotor's ratchet AND the middle rotor's
//           notch: the middle rotor steps a second time on two presses in a
//           row. That is the double step.
//
//  GREP MAP
//    export const ROTORS / REFLECTORS ... the wirings and notches
//    export const UNITS ................. the page presets (rotor order,
//                                         rings, start, plugs, tape)
//    export function stepPos ............ one key press of the stepping gear
//    export function makeEnigma ......... a machine: press(), encode()
//    export function pressSeries ........ n presses: positions and paths
// ============================================================================

export const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const N = 26;
const md = x => ((x % N) + N) % N;
export const L2N = ch => ALPHA.indexOf(String(ch).toUpperCase());
export const N2L = n => ALPHA[md(n)];

export const ROTORS = {
  I: { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notch: 'Q' },
  II: { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notch: 'E' },
  III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notch: 'V' },
  IV: { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', notch: 'J' },
  V: { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', notch: 'Z' },
};
export const REFLECTORS = { B: 'YRUHQSLDPXNGOKMIEBFZCWVJAT' };

// The three page presets. tape is what the operator types.
export const UNITS = [
  { id: 'test', name: 'I · II · III', kind: 'Rings AAA · start AAA', rotors: ['I', 'II', 'III'], reflector: 'B', rings: 'AAA', start: 'AAA', plugs: '',
    tape: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  { id: 'double', name: 'Double step', kind: 'Start ADS · middle at its notch', rotors: ['I', 'II', 'III'], reflector: 'B', rings: 'AAA', start: 'ADS', plugs: '',
    tape: 'WETTERVORHERSAGEBISKAYAXDOPPELSCHRITTXDERMITTLERENWALZEXENIGMA' },
  { id: 'barbarossa', name: 'Barbarossa 1941', kind: 'II IV V · rings BUL · ten plugs', rotors: ['II', 'IV', 'V'], reflector: 'B', rings: 'BUL', start: 'BLA', plugs: 'AV BS CG DL FU HZ IN KM OW RX',
    tape: 'EDPUDNRGYSZRCXNUYTPOMRMBOFKTBZREZKMLXLVEFGUEYSIOZVEQMIKUBPMMYLKLTTDEISMDICAGYKUACTCDOMOHWXMUUIAUBSTSLRNBZSZWNRFXWFYSSXJZVIJHIDISHPRKLKAYUPADTXQSPINQMATLPIFSVKDASCTACDPBOPVHJK' },
];
export const unit = id => UNITS.find(u => u.id === id);

const perm = s => [...s].map(L2N);
const inverse = p => { const q = new Array(N); p.forEach((v, i) => { q[v] = i; }); return q; };
const toNums = x => (Array.isArray(x) ? x.slice() : [...String(x)].map(L2N));

// a plugboard map from 'AV BS ...'
export function plugMap(plugs = '') {
  const m = ALPHA.split('').map((_, i) => i);
  for (const pr of String(plugs).trim().split(/\s+/).filter(Boolean)) {
    const a = L2N(pr[0]), b = L2N(pr[1]);
    if (a < 0 || b < 0 || a === b || m[a] !== a || m[b] !== b) throw new Error('bad plug pair ' + pr);
    m[a] = b; m[b] = a;
  }
  return m;
}

// One key press of the stepping gear. pos and notch are [L, M, R] numbers.
// Returns { pos, why }: why lists the pawls that pushed ('R', 'M', 'L')
// and dbl is true when the middle rotor stepped on its own notch.
export function stepPos(pos, notch) {
  const [l, m, r] = pos, mAt = m === notch[1], rAt = r === notch[2];
  const out = [l, m, md(r + 1)], why = ['R'];
  if (mAt) { out[0] = md(l + 1); out[1] = md(m + 1); why.push('M', 'L'); }
  else if (rAt) { out[1] = md(m + 1); why.push('M'); }
  return { pos: out, why, dbl: mAt };
}

// cfg: { rotors: ['I','II','III'], reflector: 'B', rings: 'AAA' | [0,0,0],
//        start: 'AAA' | [..], plugs: 'AB CD' }
export function makeEnigma(cfg) {
  const W = cfg.rotors.map(n => perm(ROTORS[n].wiring)), Wi = W.map(inverse);
  const notch = cfg.rotors.map(n => L2N(ROTORS[n].notch));
  const U = perm(REFLECTORS[cfg.reflector || 'B']), ring = toNums(cfg.rings || 'AAA'), P = plugMap(cfg.plugs);
  const start = toNums(cfg.start || 'AAA');
  let pos = start.slice();
  // the current for one letter at the present positions, no stepping
  // a: absolute contacts [in, after R, after M, after L, after UKW, after
  // L, after M, after R]; out: the lamp letter
  const trace = c => {
    const a = [P[c]];
    let x = a[0];
    for (const k of [2, 1, 0]) { const s = pos[k] - ring[k]; x = md(W[k][md(x + s)] - s); a.push(x); }
    x = U[x]; a.push(x);
    for (const k of [0, 1, 2]) { const s = pos[k] - ring[k]; x = md(Wi[k][md(x + s)] - s); a.push(x); }
    return { a, out: P[x] };
  };
  const M = {
    notch, ring, plugs: P, W, U,
    get pos() { return pos.slice(); },
    set pos(p) { pos = toNums(p); },
    window: () => pos.map(N2L).join(''),
    reset() { pos = start.slice(); },
    trace,
    // a key press: step, then the current flows
    press(ch) {
      const c = typeof ch === 'number' ? ch : L2N(ch), before = pos.slice();
      const st = stepPos(pos, notch); pos = st.pos;
      const t = trace(c);
      return { key: c, before, pos: pos.slice(), why: st.why, dbl: st.dbl, a: t.a, out: t.out };
    },
    encode(text) { let s = ''; for (const ch of String(text).toUpperCase()) if (L2N(ch) >= 0) s += N2L(M.press(ch).out); return s; },
  };
  return M;
}

// n presses of the tape (it repeats when short): one record per press, as
// press() returns it, plus i (the press number from 0).
export function pressSeries(cfg, tape, n) {
  const E = makeEnigma(cfg), t = [...String(tape).toUpperCase()].filter(ch => L2N(ch) >= 0), out = [];
  for (let i = 0; i < n; i++) out.push({ i, ...E.press(t.length ? t[i % t.length] : 'A') });
  return out;
}
