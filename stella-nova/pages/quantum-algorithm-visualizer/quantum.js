// ============================================================================
//  QAVE quantum core  (extracted from main.js, behavior-preserving)
// ----------------------------------------------------------------------------
//  Statevector engine: base gate matrices, applyUnitary (gather/scatter),
//  phase-canonical hashing, fractional gate U^tau, and the trace builder.
//  Pure numerics over arrays and gate params; no THREE, no DOM, no VS.
//
//  exports (grep -n): buildTrace, makeRng, sampleOutcome
// ============================================================================
/* engine */
// Port of qave_backend/simulator/gates.py
// Complex matrices represented as 2D arrays of [re, im] pairs.
// Faithful to the Python definitions: same matrices, same qubit-order conventions.

const SQRT1_2 = Math.SQRT1_2; // 1/sqrt(2)
// Thrown for any gate the statevector backend does not implement.
class UnsupportedGateError extends Error {}

// Complex number as a [real, imag] pair; every matrix entry is one of these.
const c = (re, im = 0) => [re, im];

// Base single-qubit gates (identical to gates.py)
const I2 = [[c(1), c(0)], [c(0), c(1)]];
const X  = [[c(0), c(1)], [c(1), c(0)]];
const Y  = [[c(0), c(0, -1)], [c(0, 1), c(0)]];
const Z  = [[c(1), c(0)], [c(0), c(-1)]];
const H  = [[c(SQRT1_2), c(SQRT1_2)], [c(SQRT1_2), c(-SQRT1_2)]];
const S  = [[c(1), c(0)], [c(0), c(0, 1)]];
const T  = [[c(1), c(0)], [c(0), c(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4))]];
const CX = [
  [c(1), c(0), c(0), c(0)],
  [c(0), c(1), c(0), c(0)],
  [c(0), c(0), c(0), c(1)],
  [c(0), c(0), c(1), c(0)],
];
const CZ = [
  [c(1), c(0), c(0), c(0)],
  [c(0), c(1), c(0), c(0)],
  [c(0), c(0), c(1), c(0)],
  [c(0), c(0), c(0), c(-1)],
];
const SWAP = [
  [c(1), c(0), c(0), c(0)],
  [c(0), c(0), c(1), c(0)],
  [c(0), c(1), c(0), c(0)],
  [c(0), c(0), c(0), c(1)],
];

// Build a permutation matrix from a row→column map, for the 3-qubit gates below.
function permMatrix(perm) {
  const n = perm.length;
  const M = Array.from({ length: n }, () => Array.from({ length: n }, () => c(0)));
  for (let row = 0; row < n; row++) M[row][perm[row]] = c(1);
  return M;
}
// CCX: identity on 0..5, swap 6<->7 (rows). Matches CCX in gates.py.
const CCX = permMatrix([0, 1, 2, 3, 4, 5, 7, 6]);
// CSWAP: identity except swap basis 5<->6. Matches CSWAP in gates.py.
const CSWAP = permMatrix([0, 1, 2, 3, 4, 6, 5, 7]);
// Parametric rotation gates. Each is a function of the angle θ.
function rx(theta) {
  const cc = Math.cos(theta / 2);
  const ss = Math.sin(theta / 2); // matrix entries are -i*sin
  return [[c(cc), c(0, -ss)], [c(0, -ss), c(cc)]];
}
function ry(theta) {
  const cc = Math.cos(theta / 2);
  const ss = Math.sin(theta / 2);
  return [[c(cc), c(-ss)], [c(ss), c(cc)]];
}
function rz(theta) {
  return [
    [c(Math.cos(-theta / 2), Math.sin(-theta / 2)), c(0)],
    [c(0), c(Math.cos(theta / 2), Math.sin(theta / 2))],
  ];
}

// Returns { matrix, qubits } for a supported gate, faithful to matrix_for_gate().
// Validates the control/target/param arity per gate name, then returns the
// matrix plus the qubit list in gate-basis order (controls before targets).
function matrixForGate(gate) {
  const name = gate.name.toLowerCase();
  if (gate.kind !== "unitary") {
    throw new UnsupportedGateError(`Gate kind ${gate.kind} is non-unitary in Backend A`);
  }
  const single = { x: X, y: Y, z: Z, h: H, s: S, t: T };
  const controls = gate.controls || [];
  const targets = gate.targets || [];
  const params = gate.params || [];

  if (name in single) {
    if (controls.length) throw new UnsupportedGateError(`Controlled variant for ${gate.name} unsupported`);
    if (targets.length !== 1) throw new UnsupportedGateError(`Single-qubit gate ${gate.name} requires one target`);
    return { matrix: single[name], qubits: [targets[0]] };
  }
  if (name === "rx" || name === "ry" || name === "rz") {
    if (controls.length) throw new UnsupportedGateError(`Controlled rotation ${gate.name} unsupported`);
    if (targets.length !== 1 || params.length !== 1) throw new UnsupportedGateError(`${gate.name} requires one target and one param`);
    const m = { rx, ry, rz }[name](params[0]);
    return { matrix: m, qubits: [targets[0]] };
  }
  if (name === "cx" || name === "cz") {
    if (controls.length !== 1 || targets.length !== 1) throw new UnsupportedGateError(`${gate.name} requires one control and one target`);
    return { matrix: name === "cx" ? CX : CZ, qubits: [controls[0], targets[0]] };
  }
  if (name === "ccx" || name === "toffoli") {
    if (controls.length !== 2 || targets.length !== 1) throw new UnsupportedGateError(`${gate.name} requires two controls and one target`);
    return { matrix: CCX, qubits: [controls[0], controls[1], targets[0]] };
  }
  if (name === "cswap") {
    if (controls.length !== 1 || targets.length !== 2) throw new UnsupportedGateError(`cswap requires one control and two targets`);
    return { matrix: CSWAP, qubits: [controls[0], targets[0], targets[1]] };
  }
  if (name === "swap") {
    if (controls.length) throw new UnsupportedGateError(`SWAP with controls unsupported`);
    if (targets.length !== 2) throw new UnsupportedGateError(`SWAP requires two targets`);
    return { matrix: SWAP, qubits: [targets[0], targets[1]] };
  }
  throw new UnsupportedGateError(`Unsupported gate ${gate.name}`);
}

// Port of qave_backend/simulator/statevector_engine.py (core paths)
// State = { re: Float64Array, im: Float64Array }, little-endian qubit indexing.
// Fresh |0…0⟩ state: a 2^n complex vector with amplitude 1 at index 0.
function initializeState(numQubits) {
  const dim = 1 << numQubits;
  const re = new Float64Array(dim);
  const im = new Float64Array(dim);
  re[0] = 1.0;
  return { re, im };
}
// Deep copy of a state vector.
function cloneState(s) {
  return { re: Float64Array.from(s.re), im: Float64Array.from(s.im) };
}

// Apply a k-qubit unitary. qubits[0] is the most-significant index of the gate
// matrix basis, matching Python's axes = [num_qubits-1-q for q in qubits] convention.
// Apply a k-qubit unitary to the full 2^n state. For every "base" flat index
// (the acted qubits all zero), gather the 2^k amplitudes that differ only in the
// acted bits, multiply by the gate matrix, and scatter the result back. This
// touches each amplitude once, so cost is O(2^n · 2^k) rather than O(2^2n).
function applyUnitary(state, matrix, qubits, numQubits) {
  if (!qubits.length) return cloneState(state);
  const k = qubits.length;
  const sub = 1 << k;

  // unique check
  if (new Set(qubits).size !== qubits.length) {
    throw new Error("Gate qubits must be unique");
  }

  const dim = 1 << numQubits;
  const inRe = state.re, inIm = state.im;
  const outRe = Float64Array.from(inRe);
  const outIm = Float64Array.from(inIm);

  // bit position in flat index for each sub-index bit b (b=0 is MSB of sub-index)
  const shiftFor = new Array(k);
  for (let b = 0; b < k; b++) shiftFor[b] = qubits[b];

  const targetMask = qubits.reduce((m, q) => m | (1 << q), 0);

  // For each flat index that is the "base" (target bits = 0), process the block.
  for (let base = 0; base < dim; base++) {
    if ((base & targetMask) !== 0) continue; // only base configurations
    // gather
    const gr = new Float64Array(sub);
    const gi = new Float64Array(sub);
    const idxOf = new Int32Array(sub);
    for (let s = 0; s < sub; s++) {
      let flat = base;
      for (let b = 0; b < k; b++) {
        const bit = (s >> (k - 1 - b)) & 1;
        flat |= bit << shiftFor[b];
      }
      idxOf[s] = flat;
      gr[s] = inRe[flat];
      gi[s] = inIm[flat];
    }
    // matrix-vector: out[r] = sum_tcol M[r][tcol] * g[tcol]
    for (let r = 0; r < sub; r++) {
      let accRe = 0.0, accIm = 0.0;
      const row = matrix[r];
      for (let tcol = 0; tcol < sub; tcol++) {
        const mre = row[tcol][0], mim = row[tcol][1];
        const vre = gr[tcol], vim = gi[tcol];
        accRe += mre * vre - mim * vim;
        accIm += mre * vim + mim * vre;
      }
      outRe[idxOf[r]] = accRe;
      outIm[idxOf[r]] = accIm;
    }
  }
  return { re: outRe, im: outIm };
}

// ---- deterministic state hashing (matches StatevectorEngine.state_hash) ----
// Remove the arbitrary global phase: divide the whole vector by the phase of its
// first non-negligible amplitude, so states equal up to phase hash identically.
function canonicalizeGlobalPhase(state) {
  const re = Float64Array.from(state.re);
  const im = Float64Array.from(state.im);
  const dim = re.length;
  for (let i = 0; i < dim; i++) {
    const mag = Math.hypot(re[i], im[i]);
    if (mag > 1e-15) {
      // divide whole vector by w = amplitude/mag  (|w| = 1)
      const wr = re[i] / mag, wi = im[i] / mag;
      const denom = wr * wr + wi * wi; // ~1
      for (let j = 0; j < dim; j++) {
        const ar = re[j], ai = im[j];
        // (ar+ai i) / (wr+wi i) = (ar+ai i)(wr-wi i)/denom
        re[j] = (ar * wr + ai * wi) / denom;
        im[j] = (ai * wr - ar * wi) / denom;
      }
      break;
    }
  }
  return { re, im };
}

// numpy np.round semantics: rint(x*1e12)/1e12 with round-half-to-even.
// Round-half-to-even matches numpy so the JS hash equals the Python one bit for bit.
function rintHalfEven(y) {
  const fl = Math.floor(y);
  const diff = y - fl;
  if (diff < 0.5) return fl;
  if (diff > 0.5) return fl + 1;
  // exactly .5 -> round to even
  return (fl % 2 === 0) ? fl : fl + 1;
}
function round12(x) {
  if (!isFinite(x)) return x;
  const scaled = x * 1e12;
  const r = rintHalfEven(scaled);
  return r / 1e12;
}

// Build the exact byte buffer numpy hashes: column_stack((re,im)) rounded to 12,
// signed-zero normalized, C-order float64 little-endian -> interleaved [re0,im0,...].
// Produce the exact byte buffer numpy would hash: phase-canonical amplitudes,
// rounded to 12 decimals, with negative zero normalized to zero.
function canonicalBuffer(state) {
  const canon = canonicalizeGlobalPhase(state);
  const dim = canon.re.length;
  const out = new Float64Array(dim * 2);
  for (let i = 0; i < dim; i++) {
    let r = round12(canon.re[i]);
    let m = round12(canon.im[i]);
    if (r === 0) r = 0;   // normalize -0 -> 0
    if (m === 0) m = 0;
    out[2 * i] = r;
    out[2 * i + 1] = m;
  }
  return out.buffer;
}

// ---- measurement (exact, deterministic given outcome index) ----
// Marginal outcome distribution over the measured qubits: sum |amp|² into the
// bin named by those qubits' bits, then normalize.
function measurementProbabilities(state, qubits) {
  const dim = state.re.length;
  if (!qubits.length) return Float64Array.from([1.0]);
  const probs = new Float64Array(1 << qubits.length);
  for (let i = 0; i < dim; i++) {
    let outcome = 0;
    for (let b = 0; b < qubits.length; b++) outcome |= (((i >> qubits[b]) & 1) << b);
    probs[outcome] += state.re[i] * state.re[i] + state.im[i] * state.im[i];
  }
  let total = 0;
  for (let p of probs) total += p;
  if (total <= 1e-15) { probs.fill(0); probs[0] = 1; return probs; }
  for (let i = 0; i < probs.length; i++) probs[i] /= total;
  return probs;
}
// Project the state onto one measured outcome and renormalize (the collapse).
function collapseState(state, qubits, outcomeIndex) {
  if (!qubits.length) return cloneState(state);
  const dim = state.re.length;
  const re = new Float64Array(dim);
  const im = new Float64Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    let outcome = 0;
    for (let b = 0; b < qubits.length; b++) outcome |= (((i >> qubits[b]) & 1) << b);
    if (outcome === outcomeIndex) {
      re[i] = state.re[i]; im[i] = state.im[i];
      norm += re[i] * re[i] + im[i] * im[i];
    }
  }
  norm = Math.sqrt(norm);
  if (norm <= 1e-15) return cloneState(state);
  for (let i = 0; i < dim; i++) { re[i] /= norm; im[i] /= norm; }
  return { re, im };
}

// Engine extensions for the QAVE web viewer.
// Adds: faithful in-gate fractional evolution U^tau, observable extraction,
// deterministic measurement sampling, and a full trace builder.


// ---- fractional gate U^tau (no eigensolver; principal-branch faithful) ----

// Gates that are their own inverse (U² = I); their fractional power has a closed form.
const INVOLUTIONS = new Set(["x", "y", "z", "h", "cx", "cz", "swap", "ccx", "toffoli", "cswap"]);

// Identity matrix of size d as [re,im] pairs.
function eye(d) {
  const M = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => [i === j ? 1 : 0, 0]));
  return M;
}

// U^tau for an involution (U^2 = I): (I+U)/2 + e^{i pi tau}(I-U)/2
function involutionPow(U, tau) {
  const d = U.length;
  const ang = Math.PI * tau;
  const er = Math.cos(ang), ei = Math.sin(ang);
  const out = eye(d);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      const id = i === j ? 1 : 0;
      const uRe = U[i][j][0], uIm = U[i][j][1];
      const plusRe = 0.5 * (id + uRe), plusIm = 0.5 * uIm;     // (I+U)/2
      const minusRe = 0.5 * (id - uRe), minusIm = -0.5 * uIm;  // (I-U)/2
      // plus + e^{i pi tau} * minus
      out[i][j][0] = plusRe + (er * minusRe - ei * minusIm);
      out[i][j][1] = plusIm + (er * minusIm + ei * minusRe);
    }
  }
  return out;
}

// Returns { matrix: U^tau, qubits } faithful to gate semantics.
// The in-gate animation needs a partial application U^τ, 0≤τ≤1. Rotations scale
// their angle, S/T scale their phase, involutions use the closed form above; the
// endpoints short-circuit to identity (τ=0) and the full gate (τ=1).
function fractionalGateMatrix(gate, tau) {
  const name = gate.name.toLowerCase();
  const { matrix: U, qubits } = matrixForGate(gate);
  const t = Math.max(0, Math.min(1, tau));

  if (t === 0) return { matrix: eye(U.length), qubits };
  if (t === 1) return { matrix: U, qubits };

  if (name === "rx") return { matrix: rx(gate.params[0] * t), qubits };
  if (name === "ry") return { matrix: ry(gate.params[0] * t), qubits };
  if (name === "rz") return { matrix: rz(gate.params[0] * t), qubits };
  if (name === "s") return { matrix: [[[1, 0], [0, 0]], [[0, 0], [Math.cos(Math.PI * t / 2), Math.sin(Math.PI * t / 2)]]], qubits };
  if (name === "t") return { matrix: [[[1, 0], [0, 0]], [[0, 0], [Math.cos(Math.PI * t / 4), Math.sin(Math.PI * t / 4)]]], qubits };
  if (INVOLUTIONS.has(name)) return { matrix: involutionPow(U, t), qubits };

  // Fallback: linear hold (shouldn't hit for supported set)
  return { matrix: U, qubits };
}

// ---- observables ----
// Per-basis-state probabilities |amp|² over the whole vector.
function probabilities(state) {
  const dim = state.re.length;
  const p = new Float64Array(dim);
  for (let i = 0; i < dim; i++) p[i] = state.re[i] * state.re[i] + state.im[i] * state.im[i];
  return p;
}

// Single-qubit Bloch vector via partial trace (matches extractor.py conventions).
function blochVector(state, qubit) {
  const dim = state.re.length;
  let rho00 = 0, rho11 = 0, r01re = 0, r01im = 0;
  for (let i = 0; i < dim; i++) {
    if ((i >> qubit) & 1) continue; // bit==0 rows
    const j = i | (1 << qubit);     // matching bit==1
    rho00 += state.re[i] * state.re[i] + state.im[i] * state.im[i];
    rho11 += state.re[j] * state.re[j] + state.im[j] * state.im[j];
    // rho01 = amp_i * conj(amp_j)
    r01re += state.re[i] * state.re[j] + state.im[i] * state.im[j];
    r01im += state.im[i] * state.re[j] - state.re[i] * state.im[j];
  }
  return { x: 2 * r01re, y: -2 * r01im, z: rho00 - rho11, purity_z: rho00 - rho11 };
}

// ---- deterministic RNG (mulberry32) ----
// A small seeded PRNG so a given seed always samples the same shot sequence.
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Draw one outcome index from a probability array by inverse-CDF selection.
function sampleOutcome(rng, probs) {
  const u = rng();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (u < acc) return i; }
  return probs.length - 1;
}

// ---- phase schedule (faithful to statevector_engine._phase_schedule) ----
// Each gate animates through three phases, splitting its substeps by these ratios:
// a pre-gate hold, the apply ramp (τ 0→1), and a settle hold at the new state.
const PHASE_RATIOS = { pre_gate: 0.2, apply_gate: 0.55, settle: 0.25 };
// Expand the ratios into a concrete list of [phase, playhead t, τ] substeps.
function phaseSchedule(totalSubsteps) {
  const total = Math.max(6, totalSubsteps);
  const pre = Math.max(1, Math.round(total * PHASE_RATIOS.pre_gate));
  const apply = Math.max(2, Math.round(total * PHASE_RATIOS.apply_gate));
  const settle = Math.max(1, total - pre - apply);
  const sched = [];
  for (let i = 0; i < pre; i++) sched.push(["pre_gate", PHASE_RATIOS.pre_gate * (i / pre), 0]);
  for (let i = 0; i < apply; i++) {
    const frac = i / Math.max(1, apply - 1);
    sched.push(["apply_gate", PHASE_RATIOS.pre_gate + PHASE_RATIOS.apply_gate * frac, frac]);
  }
  for (let i = 1; i <= settle; i++) {
    const frac = i / settle;
    sched.push(["settle", PHASE_RATIOS.pre_gate + PHASE_RATIOS.apply_gate + PHASE_RATIOS.settle * frac, 1]);
  }
  return sched;
}

// ---- trace builder ----
// circuit: { numQubits, gates: [{name, kind, targets, controls?, params?}] }
// returns { numQubits, steps, frames } with frames carrying real in-gate states.
// Simulate the whole circuit and record everything the viewer needs: the resting
// state before each gate, the fractional in-gate frames across the phase schedule,
// and each step's end state. Measurements sample once and hold the collapsed state.
function buildTrace(circuit, { substeps = 24, seed = 42, initBasis = 0 } = {}) {
  const N = circuit.numQubits;
  let state = initializeState(N);
  if(typeof initBasis==='number'&&initBasis>0&&initBasis<state.re.length){state.re[0]=0;state.re[initBasis]=1;}  // custom start state |b⟩
  const sched = phaseSchedule(substeps);
  const rng = makeRng(seed);

  const steps = [];
  const frames = [];
  // initial resting frame
  frames.push({ stepIndex: -1, gateName: "init", phase: "settle", t: 0, state: cloneState(state) });

  circuit.gates.forEach((gate, idx) => {
    const before = cloneState(state);
    let selectedOutcome = null;
    let measuredQubits = null;

    if (gate.kind === "measurement") {
      measuredQubits = gate.targets.slice();
      const probs = measurementProbabilities(state, measuredQubits);
      const oi = sampleOutcome(rng, probs);
      state = collapseState(state, measuredQubits, oi);
      selectedOutcome = oi.toString(2).padStart(Math.max(1, measuredQubits.length), "0");
      // constant samples (collapsed state held across phases)
      for (const [phase, t] of sched) {
        frames.push({ stepIndex: idx, gateName: gate.name, phase, t, state: cloneState(state),
          controls: [], targets: measuredQubits, measurement: true });
      }
    } else {
      const { matrix, qubits } = matrixForGate(gate);
      const after = applyUnitary(state, matrix, qubits, N);
      for (const [phase, t, tau] of sched) {
        let s;
        if (tau === 0) s = cloneState(before);
        else if (tau === 1) s = cloneState(after);
        else {
          const f = fractionalGateMatrix(gate, tau);
          s = applyUnitary(before, f.matrix, f.qubits, N);
        }
        frames.push({ stepIndex: idx, gateName: gate.name, phase, t, state: s,
          controls: gate.controls || [], targets: gate.targets });
      }
      state = after;
    }

    steps.push({
      index: idx, name: gate.name, kind: gate.kind,
      controls: gate.controls || [], targets: gate.targets, params: gate.params || [],
      endState: cloneState(state), selectedOutcome, measuredQubits,
    });
  });

  return { numQubits: N, steps, frames, finalState: state };
}

export { buildTrace, makeRng, sampleOutcome };
