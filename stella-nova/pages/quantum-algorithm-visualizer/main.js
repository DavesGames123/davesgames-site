// ============================================================================
//  QAVE · QUANTUM ALGORITHM VISUALIZER  ·  density matrix ρ(t) in 3D
// ----------------------------------------------------------------------------
//  Simulates a quantum circuit on the CPU (a faithful port of the Python
//  statevector engine), forms the density matrix ρ = |ψ⟩⟨ψ| after every gate,
//  and renders each ρ as a DIM×DIM grid of colored cells. The grids stack one
//  per gate into a tower (layer-stack view) or morph on a floor (floor-field
//  view). A musical-score canvas shows the circuit; a transport scrubs time; a
//  Gaussian-paced sampler draws measurement shots as a growing bar chart.
//
//  DATA PIPELINE
//  -------------
//      circuit {numQubits, gates} ─▶ buildTrace()      statevector sim + phases
//                                        │  per gate: applyUnitary, fractional U^τ
//                                        ▼
//      layerStates[L] (one |ψ⟩ per step) ─▶ densityToCell()  ρ = |ψ⟩⟨ψ|
//                                        ▼
//      layerCell[L] = Float32[DIM*DIM*3] (mag, re, im per cell)
//                                        │  cellColor() = colormap · tone curve
//                                        ▼
//      InstancedMesh cubes  ─▶ RenderPass ─▶ UnrealBloom ─▶ OutputPass ─▶ <canvas>
//
//  LAYER-STACK LAYOUT  (one slab per computation step)
//  ---------------------------------------------------
//      +Y (or +X)     each slab is a DIM×DIM grid of ρ cells
//        ▲            row r = ⟨r| , col c = |c⟩  →  cell = ρ_rc
//        │  ┌───────┐   the main diagonal (r==c) holds the populations |ρ_ii|
//   L2   │  │▦▦ ▦▦▦│   off-diagonal cells are coherences
//   L1   │  │▦ ▦▦ ▦│   built once per layer and cached (builtStage/layerEndArr)
//   L0   │  │▦     ▦│   L0 = initial state, then one layer per gate upward
//        └──┴───────┘
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      gate matrices ........ "Base single-qubit"   I2/X/Y/Z/H/S/T, CX/CZ/SWAP…
//      matrix for a gate .... "matrixForGate"       validate + pick the unitary
//      apply a unitary ...... "applyUnitary"        gather/scatter over base idx
//      state hashing ........ "canonicalizeGlobalPhase"  numpy-faithful hash
//      fractional gate ...... "fractionalGateMatrix"  in-gate U^τ for animation
//      trace builder ........ "buildTrace"          per-step states + phases
//      color maps ........... "color maps"          CMAPS + heatColor
//      tone curve ........... "buildCurve"          monotone-cubic |ρ| shaping
//      circuit model ........ "circuit model"       VS state, presetGates
//      density cell ......... "densityToCell"       ρ = |ψ⟩⟨ψ| to cell buffer
//      rebuild .............. "function rebuild"    trace ▶ meshes ▶ camera
//      three.js scene ....... "three.js scene"      renderer, bloom, group
//      build meshes ......... "rebuildMeshes"       instanced cells, edges, bars
//      stack view ........... "STACK view"          buildStackUpTo (append-once)
//      floor view ........... "FLOOR view"          updateFloor
//      circuit lens ......... "drawLens"            the score canvas
//      RZ angle editor ...... "RZ angle editor"     retune a gate's phase
//      HUD .................. "function updateHud"  step inspector + 2D grid
//      Qiskit ............... "parseQiskit"         parse / codegen / highlight
//      sampling ............. "runSampling"         shot histogram animation
//      main loop ............ "function loop"       per-frame update
//      UI wiring ............ "UI wiring"           panel controls
//      init picker .......... "init-state picker"   click layer 0 to set |b⟩
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
function buildTrace(circuit, { substeps = 24, seed = 42 } = {}) {
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

/* ════════ color maps ════════ */
// Clamp to [0,1].
function clamp01(x){return x<0?0:x>1?1:x;}
// Linear interpolate between two RGB triples.
function lerp3(a,b,t){return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
// Selectable density colormaps (0–255). Low end is never flat black.
const CMAPS={
  inferno:[[26,12,54],[58,18,99],[101,26,123],[151,41,107],[201,62,74],[233,109,38],[248,168,40],[251,221,96],[255,250,214]],
  viridis:[[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]],
  turbo:[[48,18,59],[62,84,205],[40,160,232],[42,215,167],[120,245,80],[211,228,46],[252,160,46],[227,79,17],[122,4,3]],
  ice:[[6,11,32],[10,32,74],[16,62,124],[26,104,176],[42,152,212],[96,198,236],[166,228,246],[232,249,255]],
  plasma:[[24,12,110],[84,2,163],[139,10,165],[185,50,137],[219,92,104],[244,136,73],[254,188,43],[240,249,33]],
  mono:[[24,26,34],[62,67,80],[110,117,134],[158,166,186],[206,214,232],[245,249,255]]
};
// The colormap the |ρ| mode currently uses; swapped by the colormap swatches.
let ACTIVE_HEAT=CMAPS.inferno;
// Map v in [0,1] onto the active colormap with linear interpolation.
function heatColor(v){v=clamp01(v);const H=ACTIVE_HEAT,s=v*(H.length-1),i=Math.min(Math.floor(s),H.length-2),t=s-i;return lerp3(H[i],H[i+1],t);}
// ── tone curve: input |ρ| → colormap position, shaped by draggable keys (Photoshop-style) ──
// The tone curve: three control points (ends pinned, middle draggable) plus a
// 256-entry lookup table sampled from them.
const CURVE={pts:[{x:0,y:0},{x:0.5,y:Math.pow(0.5,0.2)},{x:1,y:1}],lut:new Float32Array(256)};
// Rebuild the LUT with a monotone cubic (Fritsch-Carlson) interpolation of the
// control points, so the curve never overshoots or inverts between keys.
function buildCurve(){
  const P=CURVE.pts;P.sort((a,b)=>a.x-b.x);const n=P.length;
  const xs=P.map(p=>p.x),ys=P.map(p=>p.y),dx=[],m=[];
  for(let i=0;i<n-1;i++){dx[i]=Math.max(1e-6,xs[i+1]-xs[i]);m[i]=(ys[i+1]-ys[i])/dx[i];}
  const t=new Array(n);t[0]=m[0];t[n-1]=m[n-2];
  for(let i=1;i<n-1;i++)t[i]=(m[i-1]*m[i]<=0)?0:(m[i-1]+m[i])/2;
  for(let i=0;i<n-1;i++){if(m[i]===0){t[i]=0;t[i+1]=0;}else{const a=t[i]/m[i],b=t[i+1]/m[i],s=a*a+b*b;if(s>9){const k=3/Math.sqrt(s);t[i]=k*a*m[i];t[i+1]=k*b*m[i];}}}
  for(let k=0;k<256;k++){const x=k/255;let i=0;while(i<n-2&&x>xs[i+1])i++;
    const h=dx[i],s=(x-xs[i])/h,h00=(1+2*s)*(1-s)*(1-s),h10=s*(1-s)*(1-s),h01=s*s*(3-2*s),h11=s*s*(s-1);
    CURVE.lut[k]=Math.min(1,Math.max(0,h00*ys[i]+h10*h*t[i]+h01*ys[i+1]+h11*h*t[i+1]));}
}
// Read the tone curve at v via the LUT.
function curveEval(v){v=clamp01(v);return CURVE.lut[Math.min(255,(v*255)|0)];}
buildCurve();
// CSS gradient string for a colormap, used for the legend swatch.
function cmapCss(name){const H=CMAPS[name];return 'linear-gradient(90deg,'+H.map((c,i)=>'rgb('+c[0]+','+c[1]+','+c[2]+') '+Math.round(i/(H.length-1)*100)+'%').join(',')+')';}
function currentCmap(){for(const k in CMAPS)if(CMAPS[k]===ACTIVE_HEAT)return k;return 'inferno';}
// Accent colors reused across the 3D scene and 2D overlays.
const C_CYAN=[69,211,255],C_AMBER=[255,185,72],C_NAVY=[36,52,78];
// Re(ρ) coloring: amber for negative, navy at zero, cyan for positive.
function densityColorReal(re){const t=(Math.max(-1,Math.min(1,re))+1)*0.5;return t<0.5?lerp3(C_AMBER,C_NAVY,t*2):lerp3(C_NAVY,C_CYAN,(t-0.5)*2);}
// Phase(ρ) coloring: map the angle onto a cyan→violet→amber ramp.
function amplitudeColorArr(ph){let n=(ph+Math.PI)/(2*Math.PI);n=clamp01(n);const c0=[75,215,255],c1=[130,115,255],c2=[255,177,92];return n<0.5?lerp3(c0,c1,n*2):lerp3(c1,c2,(n-0.5)*2);}
// Color for the animation phase (pre-gate, apply, settle), used on the score.
function phaseColorArr(p){return p==='pre_gate'?[105,168,255]:p==='apply_gate'?[72,224,252]:p==='settle'?[255,194,94]:[182,196,216];}
// Final color for one ρ cell. The tone curve weights every mode; magnitude also
// picks a position on the heat ramp for |ρ| mode.
function cellColor(mag,re,im){
  const w=curveEval(clamp01(mag));                       // tone-curve (gamma) weight — now applied in EVERY color mode
  if(VS.colorMode==='real'){const c=densityColorReal(re);return [c[0]*w,c[1]*w,c[2]*w];}
  if(VS.colorMode==='phase'){const c=amplitudeColorArr(Math.atan2(im,re));return [c[0]*w,c[1]*w,c[2]*w];}
  return heatColor(0.01+0.99*w);                         // magnitude → heat ramp position, shaped by the curve
}
// Glow scales smoothly with magnitude (LINEAR multiplier — applied after the sRGB→linear color conversion,
// so it never runs through the sRGB transfer and blows up). Every lit cell glows a little; pure cells most.
function glowGain(mag){const v=clamp01(mag);return 1+1.9*v;}   // linear ramp: v=0→1.0, 0.25→1.48, 0.5→1.95, 1→2.9
function smooth(t){t=clamp01(t);return t*t*(3-2*t);}

/* ════════ circuit model ════════ */
// VS is the single view/state object: the circuit (numQubits, gates), the current
// build selection, playback state, and every rendering/scene preference. UI writes
// into VS; rebuild(), the loop, and the draw functions read from it.
const VS={numQubits:4,gates:[],target:0,control:1,angle:Math.PI/2,seed:24,substeps:24,
  playing:true,speed:2,frameIndex:0,stageTime:0,holdTime:0.7,threshold:0,threshDirty:false,preset:'qft',colorMode:'mag',viewMode:'stack',
  autoRotate:true,floorGrid:false,network:true,labels:true,shape:'round',showFull:false,bg:'black',gamma:0.2,stackAxis:'vertical',autoOrient:true,stepInspect:true,grid2d:true};
// Derived render state. trace: the built simulation. layerStates/layerCell: one
// entry per layer (state and its ρ cells). builtStage/layerEndArr/edgeEndArr:
// the append-once cache of which cell/edge instances each layer occupies.
// initBasis: the chosen start basis state |b⟩ (0 = |0…0⟩).
let trace=null,layerStates=[],layerCell=[],totalLayers=1,builtStage=-1,layerEndArr=[],edgeEndArr=[],initBasis=0;
const PRESET_N={bell:2,grover:3,dj:3,bv:4,toffoli:3,kick:2,teleport:3}; // fixed-size presets; others scale with the qubit count
// Build the gate list for a named algorithm at n qubits. The local helpers (H, X,
// CX, CP controlled-phase, CCZ, QFT, and so on) are small circuit-writing shorthands.
function presetGates(name,n){const g=[];
  const H=q=>g.push({name:'h',kind:'unitary',targets:[q],controls:[]});
  const X=q=>g.push({name:'x',kind:'unitary',targets:[q],controls:[]});
  const CX=(c,t)=>g.push({name:'cx',kind:'unitary',targets:[t],controls:[c]});
  const CZ=(c,t)=>g.push({name:'cz',kind:'unitary',targets:[t],controls:[c]});
  const CCX=(a,b,t)=>g.push({name:'ccx',kind:'unitary',targets:[t],controls:[a,b]});
  const RZ=(a,q)=>g.push({name:'rz',kind:'unitary',targets:[q],controls:[],params:[a]});
  const RY=(a,q)=>g.push({name:'ry',kind:'unitary',targets:[q],controls:[],params:[a]});
  const SWAP=(a,b)=>g.push({name:'swap',kind:'unitary',targets:[a,b],controls:[]});
  const CP=(c,t,l)=>{RZ(l/2,c);CX(c,t);RZ(-l/2,t);CX(c,t);RZ(l/2,t);};      // controlled phase λ
  const CCZ=(a,b,t)=>{H(t);CCX(a,b,t);H(t);};                                // controlled-controlled-Z
  const MEAS=()=>g.push({name:'measure',kind:'measurement',targets:Array.from({length:n},(_,i)=>i)});
  const qftOn=(qs,inv)=>{const s=inv?-1:1,m=qs.length;
    for(let to=0;to<m;to++){const tg=qs[m-1-to];H(tg);for(let co=to+1;co<m;co++)CP(qs[m-1-co],tg,s*Math.PI/Math.pow(2,co-to));}
    for(let i=0;i<(m>>1);i++)SWAP(qs[i],qs[m-1-i]);};
  const all=Array.from({length:n},(_,i)=>i);
  // One branch per algorithm: emit its gate sequence into g. Entangling and
  // interference families (Bell, GHZ, QFT, Grover, Deutsch-Jozsa, and so on).
  if(name==='bell'){H(0);CX(0,1);MEAS();}
  else if(name==='ghz'){H(0);for(let q=1;q<n;q++)CX(0,q);MEAS();}
  else if(name==='plus'){for(const q of all)H(q);}                            // uniform superposition: every ρ cell equal
  else if(name==='qft'){const prep=[0.17,-0.33,0.71,0.42,-0.6,0.95,-0.21,1.3];for(const q of all)H(q);all.forEach(q=>RZ(prep[q%prep.length],q));qftOn(all,false);}
  else if(name==='iqft'){for(const q of all)H(q);qftOn(all,true);}
  else if(name==='grover'){for(let q=0;q<3;q++)H(q);CCZ(0,1,2);              // oracle marks |111⟩
    for(let q=0;q<3;q++)H(q);for(let q=0;q<3;q++)X(q);CCZ(0,1,2);for(let q=0;q<3;q++)X(q);for(let q=0;q<3;q++)H(q);MEAS();} // diffusion
  else if(name==='dj'){X(2);for(let q=0;q<3;q++)H(q);CX(0,2);CX(1,2);H(0);H(1);MEAS();} // balanced oracle f=x0⊕x1
  else if(name==='bv'){X(3);for(let q=0;q<4;q++)H(q);CX(0,3);CX(2,3);H(0);H(1);H(2);MEAS();} // hidden string s=101
  else if(name==='toffoli'){H(0);H(1);CCX(0,1,2);MEAS();}
  else if(name==='kick'){X(1);H(0);CZ(0,1);H(0);MEAS();}                      // phase kickback onto the control
  else if(name==='teleport'){RY(0.9,0);H(1);CX(1,2);CX(0,1);H(0);MEAS();}     // teleportation through Bell-basis measurement
  else if(name==='scramble'){const ph=[0.4,1.1,-0.7,0.9,1.7,-1.3,0.55,2.0];for(const q of all)H(q);all.forEach(q=>RZ(ph[q%ph.length],q));
    for(let i=0;i<n-1;i++)CX(i,i+1);if(n>1)CX(n-1,0);for(const q of all)H(q);for(let i=0;i<n-1;i++)CZ(i,i+1);}
  return g;}

// Form the density matrix ρ = |ψ⟩⟨ψ| and pack each entry as (magnitude, re, im).
// ρ_rc = amp_r · conj(amp_c); this is what every cell in the 3D grid displays.
function densityToCell(state){ // returns Float32Array[DIM*DIM*3] = mag,re,im
  const re=state.re,im=state.im,out=new Float32Array(DIM*DIM*3);
  for(let r=0;r<DIM;r++){const cr=re[r],ci=im[r];for(let c=0;c<DIM;c++){
    const dr=re[c],di=im[c];const rRe=cr*dr+ci*di,rIm=ci*dr-cr*di;const k=(r*DIM+c)*3;
    out[k]=Math.hypot(rRe,rIm);out[k+1]=rRe;out[k+2]=rIm;}}
  return out;}

// Rebuild everything after any circuit change: run buildTrace, derive one ρ cell
// buffer per layer, reset the instance cache, rebuild meshes, and refresh the HUD.
// keepPos restores the current playhead position so edits do not jump the view.
function rebuild(keepPos){
  if(typeof stopSampling==='function')stopSampling();const hp=document.getElementById('hist-panel');if(hp)hp.classList.remove('show');
  if(VS.gates.length===0){trace=null;VS.frameIndex=0;renderList();return;}
  const prevStage=(keepPos&&trace)?currentStageFor(VS.stageTime):0;
  const prevFrac=(keepPos&&trace&&trace.frames.length>1)?VS.frameIndex/(trace.frames.length-1):0;
  trace=buildTrace({numQubits:VS.numQubits,gates:VS.gates},{substeps:VS.substeps,seed:VS.seed});
  builtStage=-1;layerEndArr=[];edgeEndArr=[];document.getElementById('sl-scrub').max=100;
  DIM=1<<VS.numQubits;
  layerStates=[trace.frames[0].state].concat(trace.steps.map(s=>s.endState));
  totalLayers=layerStates.length;
  layerCell=layerStates.map(densityToCell);
  if(keepPos){const s=Math.max(0,Math.min(totalLayers-1,prevStage));
    VS.stageTime=s*stageDuration()+1e-3;
    VS.frameIndex=Math.max(0,Math.min(trace.frames.length-1,prevFrac*(trace.frames.length-1)));
    revealMode();
  }else{VS.frameIndex=0;VS.stageTime=0;}
  rebuildMeshes();if(!keepPos)frameCamera();renderList();updateHudStatic();
  document.getElementById('st-dim').textContent=DIM+'×'+DIM+' cells';
  document.getElementById('st-layers').textContent=totalLayers+' layer'+(totalLayers>1?'s':'');
}
// Load a named algorithm: set its qubit count if fixed, generate its gates,
// highlight its button, rebuild, and mirror the code into the Qiskit editor.
function loadPreset(name){VS.preset=name;initBasis=0;if(PRESET_N[name]){VS.numQubits=PRESET_N[name];clampQ();}VS.gates=presetGates(name,VS.numQubits);
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.toggle('active',b.dataset.preset===name));rebuild();setQiskitFromState();}

/* ════════ three.js scene ════════ */
// Renderer with exact color (no tone mapping); OutputPass later does linear→sRGB.
const canvas=document.getElementById('gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.setClearColor(0x0a0d14,1);                  // dark navy-black, matches #canvas-wrap
renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace; // exact colors, no highlight roll-off
const scene=new THREE.Scene(); // no fog: full grid stays visible at any size
// Build a vertical gradient texture for the gradient backgrounds.
function bgGrad(c0,c1,c2){const cv=document.createElement('canvas');cv.width=4;cv.height=512;const g=cv.getContext('2d');
  const grd=g.createLinearGradient(0,0,0,512);grd.addColorStop(0,c0);grd.addColorStop(0.5,c1);grd.addColorStop(1,c2);
  g.fillStyle=grd;g.fillRect(0,0,4,512);const tx=new THREE.CanvasTexture(cv);tx.colorSpace=THREE.SRGBColorSpace;return tx;}
// Background presets: each returns a fresh color or gradient texture.
const BGS={navy:()=>bgGrad('#16294d','#0d1830','#05070f'),black:()=>new THREE.Color(0x000000),slate:()=>new THREE.Color(0x12161e),
  steel:()=>new THREE.Color(0x2a3340),dusk:()=>bgGrad('#2a1a3e','#1a1530','#0a0812'),paper:()=>new THREE.Color(0xe8ecf2)};
// Apply a background: set the scene texture, match the renderer clear color, and
// mark the active swatch.
function setBg(name){if(!BGS[name])return;VS.bg=name;scene.background=BGS[name]();
  const solid={black:0x000000,slate:0x12161e,steel:0x2a3340,paper:0xe8ecf2,navy:0x0a0d14,dusk:0x0a0812};renderer.setClearColor(solid[name]??0x0a0d14,1);
  document.querySelectorAll('.bg-sw').forEach(b=>b.classList.toggle('active',b.dataset.bg===name));}
setBg('black');
// Camera and orbit controls. Auto-orbit pauses on user drag and resumes after 3.5 s.
const camera=new THREE.PerspectiveCamera(46,1,0.1,6000);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=0.08;controls.minDistance=4;controls.maxDistance=2000;
controls.autoRotate=true;controls.autoRotateSpeed=0.55;
controls.addEventListener('start',()=>{controls.autoRotate=false;clearTimeout(window._arT);});
controls.addEventListener('end',()=>{if(VS.autoRotate)window._arT=setTimeout(()=>controls.autoRotate=true,3500);});
// Soft fill plus two directional lights; cells use MeshBasicMaterial so lighting
// mostly shapes the edges and any lit non-basic geometry.
scene.add(new THREE.AmbientLight(0x556682,1.1));
const dir=new THREE.DirectionalLight(0xcfe6ff,0.8);dir.position.set(10,26,14);scene.add(dir);
const dir2=new THREE.DirectionalLight(0x4878b0,0.4);dir2.position.set(-12,10,-8);scene.add(dir2);
// ── bloom: high-probability cells blow past the threshold and glow red-hot ──
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),0.4,0.5,0.15); // strength halved (0.8→0.4): softer overall glow, still scales down the range
composer.addPass(bloom);
composer.addPass(new OutputPass());   // REQUIRED in r152+: applies tonemap + linear→sRGB; without it bg & heatmap colors render wrong

// grp holds every ρ mesh so orientation (vertical vs horizontal stack) is one
// group rotation. All the meshes below are (re)created by rebuildMeshes().
const grp=new THREE.Group();scene.add(grp);
let cellMesh=null,edgeLines=null,edgeBuf=null,floorMesh=null,floorGrid=null,netLines=null,labelGroup=null,sampleMesh=null;
let histGroup=null,histBars=null,histMarks=null;
let inspMesh=null,lastInspStep=-99;
let last2dLayer=-99,grid2dDirty=true;
// Layout constants: cell PITCH, cube size, max floor-field height, gap between layers.
const PITCH=1.0,CUBE=0.82,MAXH=4.4,LAYER_GAP=1.15;       // NO instance cap — render everything the circuit produces
const BARMAX=4.6;                                         // tallest sampling-histogram bar (world units)
const dummy=new THREE.Object3D(),_col=new THREE.Color();
let DIM=8;
// _EI lists the 8 cube corners paired into the 12 edges (24 vertex references),
// used to draw zero-probability cells as clean wireframes with no face diagonals.
const _EH=CUBE/2,_EI=[0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]; // 12 cube edges = 24 verts (no face diagonals)
function writeBoxEdges(buf,voff,cx,cy,cz,h){              // write one cube's 12 edges as line-segment verts
  const x0=cx-_EH,x1=cx+_EH,z0=cz-_EH,z1=cz+_EH,y0=cy,y1=cy+h;
  const C=[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
  let p=voff*3;for(let i=0;i<24;i++){const v=C[_EI[i]];buf[p++]=v[0];buf[p++]=v[1];buf[p++]=v[2];}
  return voff+24;
}

// Free the GPU resources of a group before discarding it, to avoid leaks on rebuild.
function disposeGroup(g){if(!g)return;g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});}
function edgeColor3(){const c=heatColor(0.01);return new THREE.Color().setRGB(c[0]/255,c[1]/255,c[2]/255,THREE.SRGBColorSpace);} // 1% floor color for zero-cell ghosts

// Recreate every mesh for the current DIM and shape: the instanced ρ cells, the
// wireframe ghosts, the sampling glow/bars/marks, the step-inspector highlight,
// the floor and grid, the network lines, the basis labels, and the init picker.
function rebuildMeshes(){
  while(grp.children.length){const c=grp.children.pop();disposeGroup(c);}
  histGroup=null;histBars=null;histMarks=null;
  inspMesh=null;lastInspStep=-99;last2dLayer=-99;grid2dDirty=true;
  const need=Math.max(DIM*DIM,totalLayers*DIM*DIM);          // everything: every cell of every layer
  let geo;
  if(VS.shape==='box')geo=new THREE.BoxGeometry(CUBE,CUBE,CUBE);
  else if(VS.shape==='sphere')geo=new THREE.SphereGeometry(CUBE*0.6,12,9);
  else if(VS.shape==='octa')geo=new THREE.OctahedronGeometry(CUBE*0.72,0);
  else geo=new RoundedBoxGeometry(CUBE,CUBE,CUBE,1,CUBE*0.14);
  geo.translate(0,CUBE/2,0);
  const mat=new THREE.MeshBasicMaterial({toneMapped:false});
  cellMesh=new THREE.InstancedMesh(geo,mat,need);cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cellMesh.setColorAt(0,_col.setRGB(0.1,0.05,0.2,THREE.SRGBColorSpace));cellMesh.count=0;cellMesh.frustumCulled=false;grp.add(cellMesh);
  // zero-probability ghosts: clean cube EDGES only (no face diagonals), transparent, at the 1% floor color
  const eneed=ghostsEnabled()?need:1;edgeBuf=new Float32Array(eneed*72);   // 24 verts * 3 floats per cell
  const eg=new THREE.BufferGeometry();eg.setAttribute('position',new THREE.BufferAttribute(edgeBuf,3).setUsage(THREE.DynamicDrawUsage));eg.setDrawRange(0,0);
  const emat=new THREE.LineBasicMaterial({color:edgeColor3(),transparent:true,opacity:0.24,depthWrite:false,toneMapped:false});
  edgeLines=new THREE.LineSegments(eg,emat);edgeLines.frustumCulled=false;grp.add(edgeLines);
  // sampling glow: additive boxes over the diagonal (population) cells, lit one sample at a time
  const sgeo=new THREE.BoxGeometry(CUBE*1.14,CUBE*1.14,CUBE*1.14);
  const smat=new THREE.MeshBasicMaterial({transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  sampleMesh=new THREE.InstancedMesh(sgeo,smat,DIM);sampleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sampleMesh.setColorAt(0,_col.setRGB(0,0,0,THREE.SRGBColorSpace));sampleMesh.count=0;sampleMesh.frustumCulled=false;grp.add(sampleMesh);
  // sampling RESULTS as 3D bars rising from the DIAGONAL cells (the populations |ρ_ii|) of the sampling layer
  histGroup=new THREE.Group();histGroup.visible=false;
  const barW=PITCH*0.6,barD=PITCH*0.6;
  const bgeo=new THREE.BoxGeometry(barW,1,barD);bgeo.translate(0,0.5,0);   // grows up from its base
  histBars=new THREE.InstancedMesh(bgeo,new THREE.MeshBasicMaterial({toneMapped:false}),DIM);
  histBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);histBars.setColorAt(0,_col.setRGB(0.1,0.05,0.2,THREE.SRGBColorSpace));histBars.count=0;histBars.frustumCulled=false;histGroup.add(histBars);
  const mgeo=new THREE.BoxGeometry(barW*1.25,0.05,barD*1.25);              // amber crossbar = true |ψ|² target
  histMarks=new THREE.InstancedMesh(mgeo,new THREE.MeshBasicMaterial({toneMapped:false}),DIM);
  histMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);histMarks.setColorAt(0,_col.setRGB(1,0.72,0.28,THREE.SRGBColorSpace));histMarks.count=0;histMarks.frustumCulled=false;histGroup.add(histMarks);
  grp.add(histGroup);   // child of grp → diagonal placement follows the stack orientation automatically
  // step-inspector highlight: tints the cells the active gate's operator couples (its support on the array)
  const icap=Math.min(DIM*DIM,DIM*4+8);
  const igeo=new THREE.BoxGeometry(CUBE*1.08,CUBE*1.08,CUBE*1.08);
  const imat=new THREE.MeshBasicMaterial({transparent:true,opacity:0.5,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  inspMesh=new THREE.InstancedMesh(igeo,imat,icap);inspMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inspMesh.setColorAt(0,_col.setRGB(0,0,0,THREE.SRGBColorSpace));inspMesh.count=0;inspMesh.frustumCulled=false;grp.add(inspMesh);
  // floor + grid (for floor-field view)
  const span=DIM*PITCH;
  floorMesh=new THREE.Mesh(new THREE.PlaneGeometry(span+PITCH,span+PITCH),new THREE.MeshBasicMaterial({color:0x05080f,transparent:true,opacity:0.7}));
  floorMesh.rotation.x=-Math.PI/2;floorMesh.position.y=-0.02;grp.add(floorMesh);
  const pts=[],half=span/2;
  for(let r=0;r<=DIM;r++){const z=(r-DIM/2)*PITCH;pts.push(-half,0,z,half,0,z);}
  for(let c=0;c<=DIM;c++){const x=(c-DIM/2)*PITCH;pts.push(x,0,-half,x,0,half);}
  const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  floorGrid=new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.08}));floorGrid.frustumCulled=false;floorMesh.frustumCulled=false;grp.add(floorGrid);
  // network lines
  const ng=new THREE.BufferGeometry();ng.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(DIM*6*2),3));
  netLines=new THREE.LineSegments(ng,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.6,blending:THREE.AdditiveBlending,depthWrite:false}));
  netLines.frustumCulled=false;grp.add(netLines);
  buildLabels();
  ensureInitPicker();
}
// Build the basis-state labels (binary kets) along two edges of the grid, drawn as
// canvas-texture sprites. Skipped when DIM exceeds 16 (too many to read).
function buildLabels(){
  if(labelGroup){disposeGroup(labelGroup);}
  labelGroup=new THREE.Group();grp.add(labelGroup);
  if(DIM>16)return;
  const span=DIM*PITCH,half=span/2,n=VS.numQubits;
  const tex=t=>{const c=document.createElement('canvas');c.width=64;c.height=32;const x=c.getContext('2d');
    x.clearRect(0,0,64,32);x.fillStyle='#7a8aa6';x.font='600 16px JetBrains Mono,monospace';x.textAlign='center';x.textBaseline='middle';x.fillText(t,32,16);
    const tx=new THREE.CanvasTexture(c);tx.minFilter=THREE.LinearFilter;return tx;};
  for(let i=0;i<DIM;i++){const lbl=i.toString(2).padStart(n,'0');
    const a=new THREE.Sprite(new THREE.SpriteMaterial({map:tex(lbl),transparent:true,depthWrite:false}));
    a.position.set(-half-0.7,0.05,(i-(DIM-1)/2)*PITCH);a.scale.set(1.1,0.55,1);labelGroup.add(a);
    const b=new THREE.Sprite(new THREE.SpriteMaterial({map:tex(lbl),transparent:true,depthWrite:false}));
    b.position.set((i-(DIM-1)/2)*PITCH,0.05,-half-0.7);b.scale.set(1.1,0.55,1);labelGroup.add(b);}
  labelGroup.visible=VS.labels;
}
// Position the camera to frame the whole structure for the active view and
// orientation, leaving room above the tower for the sampling bar chart.
function frameCamera(){
  const span=DIM*PITCH;
  if(VS.viewMode==='stack'){
    const builtLayers=Math.min(totalLayers,(typeof maxBuildableStage==='function'?maxBuildableStage():totalLayers-1)+1);
    const sampling=!!sampleAnim;
    const towerH=builtLayers*LAYER_GAP+(sampling?BARMAX+LAYER_GAP*1.4:0);   // leave room for the results bar chart
    if(VS.stackAxis==='horizontal'){            // layers run along world +X (0..towerH); grids stand upright in Y/Z
      const d=Math.max(span,towerH)*1.05+span*0.6+5;
      camera.position.set(towerH*0.5-span*0.15,span*0.72+4,d);
      controls.target.set(towerH*0.5,0,0);
    } else {                                    // tower grows up world +Y
      const d=Math.max(span,towerH)*1.15+span*0.5+5;
      camera.position.set(span*0.85+4,towerH*0.62+span*0.35,d);
      controls.target.set(0,towerH*0.45,0);
    }
  } else {
    camera.position.set(span*0.7,span*0.98,span*1.08);
    controls.target.set(0,0.3,0);
  }
  controls.update();
}

/* ════════ shared helpers ════════ */
// The measured basis-state index for this circuit, or -1 if no measurement fired.
function selectedOutcomeIndex(){if(!trace)return -1;const ms=trace.steps.find(s=>s.selectedOutcome!=null);return ms?(parseInt(ms.selectedOutcome,2)||0):-1;}

/* ════════ STACK view ════════
   Fixed true cubes. Each computation stage drops in its WHOLE layer at once, at its
   final settled color. Color never morphs. Instances for a layer are written ONCE,
   when that layer first appears — so holding/orbiting costs ~nothing even at 8 qubits. */
function stageDuration(){return Math.max(0.06,VS.holdTime);}          // dwell per stage (seconds)
function totalStackTime(){return (totalLayers+1)*stageDuration();}     // +1 = final hold before loop
function currentStageFor(t){return Math.max(0,Math.min(totalLayers-1,Math.floor(t/stageDuration())));}
// Synthesize a settled frame object for a whole stack stage (used to drive the
// HUD and score without a per-substep frame).
function stageFrame(stage){const si=stage-1,st=trace.steps[si];
  return {stepIndex:si,gateName:si<0?'init':(st?st.name:'?'),phase:'settle',measurement:!!(st&&st.kind==='measurement'),t:1,state:layerStates[stage]};}
function maxBuildableStage(){return builtStage<0?totalLayers-1:builtStage;}
function ghostsEnabled(){return VS.numQubits<=4;}          // 5+ qubits: render NOTHING for zero-probability cells (too dense otherwise)
function heatCut(){return Math.max(1e-4,VS.threshold);}   // |ρ| below this renders as a transparent ghost (edges only); Heat slider raises it
// Cumulative instance counts: how many solid cells / ghost edges exist through
// layer L. These make revealing a layer a matter of setting count and drawRange.
function layerEnd(L){return L<0?0:(layerEndArr[L]||0);}
function edgeEnd(L){return L<0?0:(edgeEndArr[L]||0);}
// Ensure every layer up to `stage` has its instances written, appending only the
// newly revealed layers (append-once). Each cell above the heat cutoff becomes a
// colored cube; zeros become wireframe ghosts (dropped past 4 qubits). The final
// lines just set count/drawRange so only the shown layers render.
function buildStackUpTo(stage){
  stage=Math.min(stage,totalLayers-1);
  const CUT=heatCut(),ghosts=ghostsEnabled();
  if(stage>builtStage){                                   // append newly-revealed layers once; render EVERY cell
    let si=layerEnd(builtStage),ei=edgeEnd(builtStage);
    for(let L=builtStage+1;L<=stage;L++){
      const meas=(L>=1&&trace.steps[L-1]&&trace.steps[L-1].kind==='measurement');
      const sel=meas?selectedOutcomeIndex():-1;
      const cells=layerCell[L],baseY=L*LAYER_GAP;
      for(let r=0;r<DIM;r++)for(let c=0;c<DIM;c++){
        const k=(r*DIM+c)*3;const mag=cells[k];const isSel=(meas&&sel>=0&&r===sel&&c===sel);
        if(mag>=CUT||isSel){                               // solid colored box
          dummy.position.set((c-(DIM-1)/2)*PITCH,baseY,(r-(DIM-1)/2)*PITCH);dummy.scale.set(1,1,1);dummy.updateMatrix();
          let col=cellColor(mag,cells[k+1],cells[k+2]),gv=mag;if(isSel){col=[255,250,235];gv=1;}
          cellMesh.setMatrixAt(si,dummy.matrix);
          _col.setRGB(col[0]/255,col[1]/255,col[2]/255,THREE.SRGBColorSpace).multiplyScalar(glowGain(gv));cellMesh.setColorAt(si,_col);si++;
        }else if(ghosts){                                  // zero probability → clean cube edges (no diagonals); dropped at 7+ qubits
          ei=writeBoxEdges(edgeBuf,ei,(c-(DIM-1)/2)*PITCH,baseY,(r-(DIM-1)/2)*PITCH,CUBE);
        }
      }
      layerEndArr[L]=si;edgeEndArr[L]=ei;
    }
    builtStage=stage;
    cellMesh.instanceMatrix.needsUpdate=true;if(cellMesh.instanceColor)cellMesh.instanceColor.needsUpdate=true;
    edgeLines.geometry.attributes.position.needsUpdate=true;
  }
  const shown=Math.min(stage,builtStage);
  cellMesh.count=shown<0?0:layerEnd(shown);edgeLines.geometry.setDrawRange(0,shown<0?0:edgeEnd(shown));
  return shown;
}
// Draw the "shot-stack network": lines from the source population cells in the
// layer below a measurement up to the single collapsed outcome cell above it.
function drawStackNetwork(stage){
  let measLayer=-1;
  for(let L=1;L<=stage;L++){if(trace.steps[L-1]&&trace.steps[L-1].kind==='measurement'){measLayer=L;break;}}
  if(!VS.network||measLayer<1){netLines.visible=false;return;}
  netLines.visible=true;const pos=netLines.geometry.attributes.position.array,cap=(pos.length/6)|0;let v=0;
  const sel=selectedOutcomeIndex(),src=layerCell[measLayer-1];
  const selX=(sel-(DIM-1)/2)*PITCH,selZ=(sel-(DIM-1)/2)*PITCH,selY=measLayer*LAYER_GAP+CUBE*0.5;
  for(let kk=0;kk<DIM&&v/6<cap;kk++){const p=src[(kk*DIM+kk)*3];if(p<0.06||kk===sel)continue;
    const x=(kk-(DIM-1)/2)*PITCH,z=(kk-(DIM-1)/2)*PITCH,y=(measLayer-1)*LAYER_GAP+CUBE*0.5;
    pos[v++]=x;pos[v++]=y;pos[v++]=z;pos[v++]=selX;pos[v++]=selY;pos[v++]=selZ;}
  for(let i=v;i<pos.length;i++)pos[i]=0;
  netLines.geometry.setDrawRange(0,v/3);netLines.geometry.attributes.position.needsUpdate=true;
}
function applyThreshold(){ // rewrite matrices of already-built cells to honor brightness threshold
  if(!cellMesh||builtStage<0)return;let inst=0;
  for(let L=0;L<=builtStage;L++){const cells=layerCell[L],baseY=L*LAYER_GAP;
    for(let r=0;r<DIM;r++)for(let c=0;c<DIM;c++){
      const vis=cells[(r*DIM+c)*3]>=VS.threshold;
      dummy.position.set((c-(DIM-1)/2)*PITCH,baseY,(r-(DIM-1)/2)*PITCH);
      dummy.scale.set(vis?1:0,vis?1:0,vis?1:0);dummy.updateMatrix();
      cellMesh.setMatrixAt(inst++,dummy.matrix);}}
  cellMesh.instanceMatrix.needsUpdate=true;
}
// Per-frame stack update: lay the group on its side for horizontal orientation,
// build instances up to the current stage (or all layers when showFull), reveal
// only the stage the playhead has reached, and refresh the network lines.
function updateStack(dt){
  floorMesh.visible=VS.floorGrid;floorGrid.visible=VS.floorGrid;
  if(VS.floorGrid&&floorGrid.material){floorPulse+=dt*0.6;floorGrid.material.opacity=0.06+0.05*(0.5+0.5*Math.sin(floorPulse));}
  grp.scale.setScalar(1);                                   // tower stays put: no shape/size animation
  grp.rotation.set(0,0,VS.stackAxis==='horizontal'?-Math.PI/2:0); // lay the stack on its side for horizontal
  const cs=currentStageFor(VS.stageTime);
  buildStackUpTo(VS.showFull?totalLayers-1:cs);             // BUILD instances (showFull → all are ready instantly)
  const showStage=Math.min(cs,builtStage);                  // shown layers ALWAYS follow the scrub/playhead → reveal one at a time
  cellMesh.count=showStage<0?0:layerEnd(showStage);
  edgeLines.geometry.setDrawRange(0,showStage<0?0:edgeEnd(showStage));
  drawStackNetwork(cs);
}

/* ════════ FLOOR view (tucked-away morphing grid) ════════ */
// Phase accumulator for the animated floor grid opacity.
let floorPulse=0;
// Floor-field view: a single ρ grid laid flat, cell height proportional to |ρ|,
// rebuilt every frame from the current animation frame's state. Draws the same
// measurement network lines as the stack when a collapse is in view.
function updateFloor(frame,dt){
  grp.scale.setScalar(1);grp.rotation.set(0,0,0);          // floor field is always flat
  floorMesh.visible=true;floorGrid.visible=true;
  floorPulse+=dt*0.6;
  if(floorGrid.material){floorGrid.material.opacity=0.06+0.05*(0.5+0.5*Math.sin(floorPulse));} // animated floor grid
  const cells=frame?densityToCell(frame.state):layerCell[0];
  const sel=selectedOutcomeIndex();const meas=frame&&frame.measurement;const CUT=heatCut(),ghosts=ghostsEnabled();
  let si=0,ei=0;
  for(let r=0;r<DIM;r++)for(let c=0;c<DIM;c++){
    const k=(r*DIM+c)*3;const mag=cells[k],re=cells[k+1],im=cells[k+2];const isSel=(meas&&sel>=0&&r===sel&&c===sel);
    if(mag>=CUT||isSel){
      let col=cellColor(mag,re,im),gv=mag;if(isSel){col=[255,250,235];gv=1;}
      const h=Math.max(0.012,mag*MAXH);
      dummy.position.set((c-(DIM-1)/2)*PITCH,0,(r-(DIM-1)/2)*PITCH);dummy.scale.set(1,h/CUBE,1);dummy.updateMatrix();
      cellMesh.setMatrixAt(si,dummy.matrix);_col.setRGB(col[0]/255,col[1]/255,col[2]/255,THREE.SRGBColorSpace).multiplyScalar(glowGain(gv));cellMesh.setColorAt(si,_col);si++;
    }else if(ghosts){                                       // zero → flat clean edges; dropped at 7+ qubits
      ei=writeBoxEdges(edgeBuf,ei,(c-(DIM-1)/2)*PITCH,0,(r-(DIM-1)/2)*PITCH,0.06);
    }
  }
  cellMesh.count=si;cellMesh.instanceMatrix.needsUpdate=true;if(cellMesh.instanceColor)cellMesh.instanceColor.needsUpdate=true;
  edgeLines.geometry.setDrawRange(0,ei);edgeLines.geometry.attributes.position.needsUpdate=true;
  if(VS.network&&meas&&sel>=0){
    netLines.visible=true;const pos=netLines.geometry.attributes.position.array;let v=0;
    const selX=(sel-(DIM-1)/2)*PITCH,selZ=(sel-(DIM-1)/2)*PITCH,selY=Math.max(0.05,cells[(sel*DIM+sel)*3]*MAXH);
    const pre=layerCell[Math.max(0,totalLayers-2)];
    for(let kk=0;kk<DIM;kk++){const p=pre[(kk*DIM+kk)*3];if(p<0.06||kk===sel)continue;
      const x=(kk-(DIM-1)/2)*PITCH,z=(kk-(DIM-1)/2)*PITCH,y=Math.max(0.05,p*MAXH);
      pos[v++]=x;pos[v++]=y;pos[v++]=z;pos[v++]=selX;pos[v++]=selY+0.3;pos[v++]=selZ;}
    for(let i=v;i<pos.length;i++)pos[i]=0;
    netLines.geometry.setDrawRange(0,v/3);netLines.geometry.attributes.position.needsUpdate=true;
  } else netLines.visible=false;
}

/* ════════ circuit lens ════════ */
// The circuit "score": a 2D canvas drawing qubit wires as staff lines and gates as
// notes, with a playhead, bar lines every 4 columns, and a pinned qubit-label gutter.
const circ=document.getElementById('circuit-canvas'),cctx=circ.getContext('2d');
const cgut=document.getElementById('cgutter'),gctx=cgut.getContext('2d');
const cscroll=document.getElementById('circuit-scroll');
const COLW=46,GUT=30,PADR=20;                              // fixed column pitch → no squeeze; long circuits scroll like a score
let circLayout={colW:COLW,x0:GUT+6,steps:0};
// Vertical center of qubit q's staff line.
function laneY(q,padT,laneH){return padT+laneH*(q+0.5);}
// Rounded-rectangle path helper for the gate note boxes.
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
// Redraw the whole score for the given frame: size the canvas (growing to scroll
// for long circuits), draw bar lines, the playhead, the wires, each gate note,
// the layer numbers, and the sticky gutter labels.
function drawLens(frame){
  const dpr=Math.min(devicePixelRatio||1,2);
  const N=VS.numQubits,steps=VS.gates.length;
  const Hcss=circ.clientHeight||128,viewW=cscroll.clientWidth||700;
  const x0=GUT+8;
  const Wcss=Math.max(viewW,x0+steps*COLW+PADR);           // fill the view, or grow & scroll
  if(circ.style.width!==Wcss+'px')circ.style.width=Wcss+'px';
  if(circ.width!==Math.round(Wcss*dpr)||circ.height!==Math.round(Hcss*dpr)){circ.width=Math.round(Wcss*dpr);circ.height=Math.round(Hcss*dpr);}
  cctx.setTransform(dpr,0,0,dpr,0,0);cctx.clearRect(0,0,Wcss,Hcss);
  const padT=15,padB=Hcss-18,laneH=(padB-padT)/Math.max(1,N);
  circLayout={colW:COLW,x0,steps,padT,laneH,bw:Math.min(28,COLW*0.62),bh:Math.min(19,laneH*0.8)};
  const cur=frame?frame.stepIndex:-1,colX=s=>x0+COLW*(s+0.5),endX=x0+COLW*steps;
  // measure/bar lines every 4 columns (score "bars" — help read large circuits)
  cctx.strokeStyle='rgba(70,95,135,0.16)';cctx.lineWidth=1;
  for(let s=0;s<=steps;s+=4){const bx=x0+COLW*s;cctx.beginPath();cctx.moveTo(bx,padT-7);cctx.lineTo(bx,padB+7);cctx.stroke();}
  // playhead cursor (current layer)
  if(cur>=0){const px=x0+COLW*cur;cctx.fillStyle='rgba(255,200,80,0.11)';cctx.fillRect(px,padT-8,COLW,padB-padT+16);
    cctx.strokeStyle='rgba(255,200,80,0.85)';cctx.lineWidth=1.5;const mx=px+COLW/2;cctx.beginPath();cctx.moveTo(mx,padT-9);cctx.lineTo(mx,padB+9);cctx.stroke();
    cctx.fillStyle='rgba(255,200,80,0.95)';cctx.beginPath();cctx.moveTo(mx-4,padT-9);cctx.lineTo(mx+4,padT-9);cctx.lineTo(mx,padT-4);cctx.fill();}
  // staff lines (qubit wires)
  for(let q=0;q<N;q++){const y=laneY(q,padT,laneH);cctx.strokeStyle='rgba(70,95,135,0.55)';cctx.lineWidth=1;cctx.beginPath();cctx.moveTo(x0-8,y);cctx.lineTo(endX+10,y);cctx.stroke();}
  // gates as score notes
  cctx.textBaseline='middle';
  for(let s=0;s<steps;s++){const g=VS.gates[s],x=colX(s),active=s===cur;
    const col=active&&frame?phaseColorArr(frame.phase):(g.kind==='measurement'?[182,196,216]:(g.controls&&g.controls.length?C_AMBER:C_CYAN));
    const cs='rgb('+(col[0]|0)+','+(col[1]|0)+','+(col[2]|0)+')';
    if(g.controls&&g.controls.length){const ys=g.controls.concat(g.targets).map(q=>laneY(q,padT,laneH));const y0=Math.min(...ys),y1=Math.max(...ys);
      cctx.strokeStyle=cs;cctx.lineWidth=active?2:1.4;cctx.beginPath();cctx.moveTo(x,y0);cctx.lineTo(x,y1);cctx.stroke();
      for(const cq of g.controls){const cy=laneY(cq,padT,laneH);cctx.fillStyle=cs;cctx.beginPath();cctx.arc(x,cy,3.4,0,7);cctx.fill();}}
    const bw=Math.min(28,COLW*0.62),bh=Math.min(19,laneH*0.8);
    for(const q of g.targets){const gy=laneY(q,padT,laneH);
      cctx.fillStyle='rgba(8,12,20,0.96)';roundRect(cctx,x-bw/2,gy-bh/2,bw,bh,4);cctx.fill();
      cctx.strokeStyle=cs;cctx.lineWidth=active?2:1.3;roundRect(cctx,x-bw/2,gy-bh/2,bw,bh,4);cctx.stroke();
      cctx.fillStyle=active?cs:'#cdd6e6';cctx.font='700 10px JetBrains Mono,monospace';cctx.textAlign='center';
      cctx.fillText(g.kind==='measurement'?'M':(g.name==='swap'?'×':g.name.toUpperCase()).slice(0,3),x,gy+0.5);
      if(g.name==='rz'&&g.params){cctx.font='600 7px JetBrains Mono,monospace';cctx.fillStyle=(s===editSel)?'#ffb948':'rgba(150,200,255,0.62)';cctx.fillText(fmtPi(g.params[0]),x,gy-bh/2-6);}
    }}
  // layer numbers (beats) under each column
  cctx.textAlign='center';cctx.textBaseline='top';cctx.font='500 8px JetBrains Mono,monospace';
  cctx.fillStyle=(cur<0)?'rgba(255,200,80,0.95)':'rgba(110,125,150,0.65)';cctx.fillText('L0',x0-4,padB+5);
  for(let s=0;s<steps;s++){cctx.fillStyle=(s===cur)?'rgba(255,200,80,0.95)':'rgba(110,125,150,0.65)';cctx.fillText('L'+(s+1),colX(s),padB+5);}
  // sticky qubit-label gutter (stays pinned while the score scrolls)
  if(cgut.width!==Math.round(GUT*dpr)||cgut.height!==Math.round(Hcss*dpr)){cgut.width=Math.round(GUT*dpr);cgut.height=Math.round(Hcss*dpr);}
  gctx.setTransform(dpr,0,0,dpr,0,0);gctx.clearRect(0,0,GUT,Hcss);
  const grd=gctx.createLinearGradient(0,0,GUT,0);grd.addColorStop(0,'rgba(11,16,28,0.98)');grd.addColorStop(0.65,'rgba(11,16,28,0.95)');grd.addColorStop(1,'rgba(11,16,28,0)');
  gctx.fillStyle=grd;gctx.fillRect(0,0,GUT,Hcss);gctx.textAlign='left';gctx.textBaseline='middle';gctx.font='600 10px JetBrains Mono,monospace';gctx.fillStyle='#8fa0bd';
  for(let q=0;q<N;q++)gctx.fillText('q'+q,5,laneY(q,padT,laneH));
}
/* ── scrub by dragging on the score (== moving the Scrub slider) ── */
function revealMode(){VS.showFull=false;const t=document.getElementById('tog-full');if(t)t.classList.remove('on');} // scrub/play/step drop "show all" so layers reveal one at a time
// Map a pointer x on the score to a layer and move the playhead there, pausing play.
function circuitScrubTo(clientX){if(!trace)return;const rect=circ.getBoundingClientRect();const x=clientX-rect.left;
  const {colW,x0,steps}=circLayout;if(steps<1)return;let s=Math.floor((x-x0)/colW);s=Math.max(0,Math.min(steps-1,s));
  if(VS.viewMode==='stack')VS.stageTime=(s+1)*stageDuration()+1e-3;else VS.frameIndex=((s+0.5)/steps)*(trace.frames.length-1);
  revealMode();VS.playing=false;const pb=document.getElementById('btn-play');if(pb){pb.textContent='▶ Play';pb.classList.remove('active');}}
// Score pointer wiring: clicking an RZ note opens its angle editor; otherwise a
// press-drag scrubs the playhead. Move sets the cursor and drives scrubbing.
let scrubbing=false;
circ.addEventListener('pointerdown',e=>{
  const rs=rzGateAt(e.clientX,e.clientY);
  if(rs>=0){openAngleEditor(rs,e.clientX,e.clientY);e.preventDefault();return;}
  closeAngleEditor();
  scrubbing=true;try{circ.setPointerCapture(e.pointerId);}catch(_){}circuitScrubTo(e.clientX);e.preventDefault();});
circ.addEventListener('pointermove',e=>{
  if(scrubbing){circuitScrubTo(e.clientX);e.preventDefault();return;}
  circ.style.cursor=rzGateAt(e.clientX,e.clientY)>=0?'pointer':'ew-resize';});

/* ════════ RZ angle editor — click an RZ note on the score to retune its phase ════════ */
// editSel: index of the RZ gate being edited; rzEd: the lazily-built popup element.
let editSel=-1, rzEd=null;
// Format an angle as a fraction of π when it is close to a common value, else radians.
function fmtPi(v){
  const r=v/Math.PI, near=(a,b)=>Math.abs(a-b)<0.012, sgn=r<0?'−':'';
  const fr=[[0,'0'],[1/16,'π/16'],[1/8,'π/8'],[1/6,'π/6'],[1/4,'π/4'],[1/3,'π/3'],[1/2,'π/2'],[3/4,'3π/4'],[1,'π'],[3/2,'3π/2'],[2,'2π']];
  for(const [k,s] of fr){if(near(Math.abs(r),k))return k===0?'0':sgn+s;}
  return v.toFixed(3);
}
// Hit-test the score: return the index of an RZ gate note under the pointer, or -1.
function rzGateAt(clientX,clientY){
  if(!VS.gates.length||!circLayout||circLayout.padT==null)return -1;
  const rect=circ.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
  const {x0,colW,padT,laneH,bw,bh}=circLayout;
  for(let s=0;s<VS.gates.length;s++){const g=VS.gates[s];
    if(g.name!=='rz'||!g.params)continue;
    const gx=x0+colW*(s+0.5),gy=laneY(g.targets[0],padT,laneH);
    if(Math.abs(x-gx)<=bw/2+3&&Math.abs(y-gy)<=bh/2+3)return s;}
  return -1;
}
// Build the RZ editor popup once (slider, +/- steps, number field) and wire each
// control to setAngle so retuning is live.
function buildRzEditor(){
  rzEd=document.createElement('div');rzEd.id='rz-editor';
  rzEd.style.cssText='position:fixed;z-index:500;display:none;width:218px;background:rgba(9,12,20,0.98);'
    +'border:1px solid var(--border-b);border-radius:9px;padding:11px 12px 12px;backdrop-filter:blur(9px);'
    +"box-shadow:0 8px 30px rgba(0,0,0,0.6);font-family:'JetBrains Mono',monospace;user-select:none";
  rzEd.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">'
      +'<span id="rz-title" style="font-size:0.64rem;letter-spacing:0.12em;color:#ffb948;font-weight:600"></span>'
      +'<span id="rz-x" style="cursor:pointer;color:#7d8aa0;font-size:0.7rem;padding:0 2px">✕</span></div>'
    +'<div style="font-size:0.7rem;color:#cdd6e6;margin-bottom:8px"><span id="rz-rad"></span> rad <span style="color:#5a8cc0">·</span> <span id="rz-frac" style="color:#96c8ff"></span></div>'
    +'<input type="range" id="rz-slider" min="-6.2832" max="6.2832" step="0.01" style="width:100%;accent-color:#ffb948;margin-bottom:9px">'
    +'<div style="display:flex;gap:4px;align-items:center">'
      +'<button class="rz-step" data-d="-0.7853981">−π/4</button>'
      +'<button class="rz-step" data-d="-0.0314159">−</button>'
      +'<input type="number" id="rz-num" step="0.01" style="flex:1;min-width:0;background:rgba(20,28,42,0.9);border:1px solid var(--border-b);color:#cdd6e6;font-family:inherit;font-size:0.66rem;padding:4px 5px;border-radius:4px;text-align:center">'
      +'<button class="rz-step" data-d="0.0314159">+</button>'
      +'<button class="rz-step" data-d="0.7853981">+π/4</button></div>'
    +'<div style="font-size:0.55rem;color:#5a8cc0;margin-top:8px;line-height:1.4">live · retunes the encoded phase and recomputes the state</div>';
  document.body.appendChild(rzEd);
  rzEd.querySelectorAll('.rz-step').forEach(b=>{
    b.style.cssText='background:transparent;border:1px solid var(--border-b);color:#96c8ff;font-family:inherit;'
      +'font-size:0.6rem;padding:5px 4px;border-radius:4px;cursor:pointer;white-space:nowrap';
    b.addEventListener('click',()=>{if(editSel<0)return;setAngle(VS.gates[editSel].params[0]+parseFloat(b.dataset.d));});});
  rzEd.querySelector('#rz-slider').addEventListener('input',e=>setAngle(parseFloat(e.target.value)));
  rzEd.querySelector('#rz-num').addEventListener('input',e=>{const v=parseFloat(e.target.value);if(!isNaN(v))setAngle(v);});
  rzEd.querySelector('#rz-x').addEventListener('click',closeAngleEditor);
  return rzEd;
}
// Reflect the edited gate's current angle into the popup's widgets.
function syncRzEditor(){
  if(editSel<0||!rzEd)return;const v=VS.gates[editSel].params[0];
  rzEd.querySelector('#rz-rad').textContent=v.toFixed(3);
  rzEd.querySelector('#rz-frac').textContent=fmtPi(v);
  const sl=rzEd.querySelector('#rz-slider');if(document.activeElement!==sl)sl.value=v;
  const nm=rzEd.querySelector('#rz-num');if(document.activeElement!==nm)nm.value=v.toFixed(3);
}
// Apply a new angle to the edited gate: mark the circuit custom, pause, and
// rebuild the trace (keeping the playhead) so the change shows immediately.
function setAngle(v){
  if(editSel<0)return;
  VS.gates[editSel].params[0]=v;
  VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));
  VS.playing=false;const pb=document.getElementById('btn-play');if(pb){pb.textContent='▶ Play';pb.classList.remove('active');}
  rebuild(true);syncRzEditor();
}
// Open the editor for gate s near the pointer, clamped to stay on screen.
function openAngleEditor(s,clientX,clientY){
  editSel=s;const g=VS.gates[s];if(!rzEd)buildRzEditor();
  rzEd.querySelector('#rz-title').textContent='RZ · q'+g.targets[0]+' · L'+(s+1);
  rzEd.style.display='block';syncRzEditor();
  const w=rzEd.offsetWidth,h=rzEd.offsetHeight,pad=14;
  let x=clientX+pad,y=clientY-h-pad;
  if(x+w>innerWidth-8)x=clientX-pad-w;if(x<8)x=8;
  if(y<8)y=clientY+pad;if(y+h>innerHeight-8)y=innerHeight-8-h;
  rzEd.style.left=x+'px';rzEd.style.top=y+'px';
}
// Close the RZ editor.
function closeAngleEditor(){editSel=-1;if(rzEd)rzEd.style.display='none';}
// Close it on any outside press (capture phase so it beats other handlers).
document.addEventListener('pointerdown',e=>{
  if(editSel<0)return;
  if(rzEd&&rzEd.contains(e.target))return;
  if(e.target===circ)return;
  closeAngleEditor();},true);
// Advance or rewind by one layer (stack) or one gate's worth of frames (floor).
function stepLayer(dir){
  if(!trace)return;revealMode();VS.playing=false;
  const pb=document.getElementById('btn-play');if(pb){pb.textContent='▶ Play';pb.classList.remove('active');}
  if(VS.viewMode==='stack'){
    let s=Math.max(0,Math.min(totalLayers-1,currentStageFor(VS.stageTime)+dir));
    VS.stageTime=s*stageDuration()+1e-3;return;}
  const fi=Math.floor(VS.frameIndex),cur=trace.frames[Math.min(fi,trace.frames.length-1)].stepIndex;
  if(dir>0){let j=fi+1;while(j<trace.frames.length&&trace.frames[j].stepIndex===cur)j++;VS.frameIndex=Math.min(j,trace.frames.length-1);}
  else{let j=fi;while(j>0&&trace.frames[j].stepIndex===cur)j--;const pst=trace.frames[j].stepIndex;while(j>0&&trace.frames[j-1].stepIndex===pst)j--;VS.frameIndex=Math.max(0,j);}
}
// Keyboard transport: arrows step, Escape closes the editor; ignored in inputs.
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeAngleEditor();return;}
  const t=e.target,tn=t&&t.tagName;
  if(tn==='INPUT'||tn==='TEXTAREA'||tn==='SELECT'||(t&&t.isContentEditable))return;
  if(e.key==='ArrowRight'){stepLayer(1);e.preventDefault();}
  else if(e.key==='ArrowLeft'){stepLayer(-1);e.preventDefault();}
});
circ.addEventListener('pointerup',()=>{scrubbing=false;});
circ.addEventListener('pointercancel',()=>{scrubbing=false;});
// Keep the playhead in view: nudge the score's horizontal scroll to track it,
// snapping while scrubbing and easing while playing.
function followPlayhead(){if(!trace)return;const {colW,x0,steps}=circLayout;if(steps<1)return;
  let s=VS.viewMode==='stack'?Math.max(0,currentStageFor(VS.stageTime)-1):Math.floor((VS.frameIndex/Math.max(1,trace.frames.length-1))*steps);
  const cx=x0+colW*(s+0.5),vw=cscroll.clientWidth,left=cscroll.scrollLeft;
  if(scrubbing){if(cx<left+colW*1.2)cscroll.scrollLeft=Math.max(0,cx-colW*1.8);else if(cx>left+vw-colW*1.2)cscroll.scrollLeft=cx-vw+colW*1.8;}
  else if(VS.playing){cscroll.scrollLeft+=((cx-vw/2)-left)*0.12;}}

/* ════════ HUD ════════ */
// Canvas contexts for the two overlay panels: the step inspector and the 2D grid.
const inspCv=document.getElementById('insp-cv'),ictx=inspCv.getContext('2d');
const g2dCv=document.getElementById('grid2d-cv'),g2ctx=g2dCv.getContext('2d');
function draw2DGrid(si){                                     // flat crossword-style heatmap of the current layer's ρ, updates as it builds
  const panel=document.getElementById('grid2d-panel');
  if(!VS.grid2d||!trace){panel.classList.remove('show');return;}
  panel.classList.add('show');
  const L=Math.max(0,Math.min(totalLayers-1,si+1));
  if(L===last2dLayer&&!grid2dDirty)return;                   // redraw only when the layer (or coloring) changes
  last2dLayer=L;grid2dDirty=false;
  const cells=layerCell[L];if(!cells)return;
  const dpr=Math.min(devicePixelRatio||1,2),SZ=186;
  if(g2dCv.width!==(SZ*dpr|0)){g2dCv.width=SZ*dpr|0;g2dCv.height=SZ*dpr|0;g2dCv.style.width=SZ+'px';g2dCv.style.height=SZ+'px';}
  g2ctx.setTransform(dpr,0,0,dpr,0,0);
  g2ctx.fillStyle='#060910';g2ctx.fillRect(0,0,SZ,SZ);       // backdrop shows between cells → crossword gridlines
  const cell=SZ/DIM,gap=cell>5?1:(cell>2.4?0.5:0);
  for(let r=0;r<DIM;r++)for(let c=0;c<DIM;c++){const k=(r*DIM+c)*3,col=cellColor(cells[k],cells[k+1],cells[k+2]);
    g2ctx.fillStyle='rgb('+(col[0]|0)+','+(col[1]|0)+','+(col[2]|0)+')';
    g2ctx.fillRect(c*cell+gap*0.5,r*cell+gap*0.5,cell-gap,cell-gap);}
  g2ctx.strokeStyle='rgba(255,200,80,0.22)';g2ctx.lineWidth=1;g2ctx.beginPath();g2ctx.moveTo(0,0);g2ctx.lineTo(SZ,SZ);g2ctx.stroke(); // diagonal = populations
  document.getElementById('grid2d-title').innerHTML='ρ · 2D · layer <b>'+L+'</b> · '+DIM+'×'+DIM;
  if(gridHover)renderGridOverlay();
}
/* hover the 2D grid → show how the active layer's gate operates (operator support + cell readout) */
// Overlay canvas + floating tooltip for hovering the 2D grid.
const g2ov=document.getElementById('grid2d-ov'),g2octx=g2ov.getContext('2d');
const gridTip=document.createElement('div');gridTip.id='grid-tip';document.body.appendChild(gridTip);
let gridHover=null;const G2SZ=186;
// Binary ket string for a basis index at the current qubit count.
function bitstr(v){return v.toString(2).padStart(VS.numQubits,'0');}
// All subsets of a bit mask (used to enumerate the cells a gate couples).
function gateSubmasks(mask){const s=[];let x=mask;for(;;x=(x-1)&mask){s.push(x);if(x===0)break;}return s;}
// Draw the hover overlay: shade the cells the active gate touches and outline the
// hovered cell.
function renderGridOverlay(){
  const dpr=Math.min(devicePixelRatio||1,2);
  if(g2ov.width!==(G2SZ*dpr|0)){g2ov.width=G2SZ*dpr|0;g2ov.height=G2SZ*dpr|0;g2ov.style.width=G2SZ+'px';g2ov.style.height=G2SZ+'px';}
  g2octx.setTransform(dpr,0,0,dpr,0,0);g2octx.clearRect(0,0,G2SZ,G2SZ);
  if(gridHover&&(gridHover.r>=DIM||gridHover.c>=DIM))gridHover=null;
  if(!gridHover||!trace)return;
  const L=last2dLayer,g=(L>=1&&trace.steps[L-1])?trace.steps[L-1]:null,cell=G2SZ/DIM;
  if(g&&g.kind!=='measurement'){const Q=(g.targets||[]).concat(g.controls||[]);
    if(Q.length<=2){let mask=0;for(const q of Q)mask|=(1<<q);
      const col=(g.controls&&g.controls.length)?C_AMBER:C_CYAN;g2octx.fillStyle='rgba('+col[0]+','+col[1]+','+col[2]+',0.30)';
      const subs=gateSubmasks(mask);for(let i=0;i<DIM;i++)for(const s of subs){const j=i^s;g2octx.fillRect(j*cell,i*cell,Math.max(1,cell),Math.max(1,cell));}}}
  g2octx.strokeStyle='#fff';g2octx.lineWidth=1.5;g2octx.strokeRect(gridHover.c*cell,gridHover.r*cell,Math.max(2,cell),Math.max(2,cell));
}
// Map a mouse event over the 2D grid to a (row, col) cell, or null if outside.
function gridCellFromEvent(e){const r=g2dCv.getBoundingClientRect(),cell=G2SZ/DIM;
  const c=Math.floor((e.clientX-r.left)/cell),rr=Math.floor((e.clientY-r.top)/cell);
  if(c<0||rr<0||c>=DIM||rr>=DIM)return null;return {r:rr,c};}
// Tooltip for a hovered ρ cell: name the gate and cell ⟨r|ρ|c⟩, show |ρ| and its
// phase, and say whether the active gate couples this cell.
function showGridTip(e){const hc=gridCellFromEvent(e);if(!hc||!trace){hideGridTip();return;}
  gridHover=hc;renderGridOverlay();
  const L=last2dLayer,g=(L>=1&&trace.steps[L-1])?trace.steps[L-1]:null,cells=layerCell[L];
  const k=(hc.r*DIM+hc.c)*3,mag=cells?cells[k]:0,re=cells?cells[k+1]:0,im=cells?cells[k+2]:0,ph=Math.round(Math.atan2(im,re)*180/Math.PI);
  let gate,note,two=false;
  if(!g){gate='initial state';note='no gate at layer 0 — pure |0…0⟩';}
  else{two=!!(g.controls&&g.controls.length);let q;
    if(g.kind==='measurement')q='all';else if(two)q='ctrl q'+g.controls.join(',')+' → q'+g.targets[0];else if(g.name==='swap')q='q'+g.targets[0]+' ↔ q'+g.targets[1];else q='q'+g.targets[0];
    gate=(g.kind==='measurement'?'MEASURE':g.name.toUpperCase())+' · '+q;
    const Q=(g.targets||[]).concat(g.controls||[]);let mask=0;for(const x of Q)mask|=(1<<x);
    const inSup=g.kind!=='measurement'&&Q.length<=2&&(((hc.r^hc.c)&~mask)===0);
    note=g.kind==='measurement'?'measurement keeps only the diagonal':(inSup?'★ this cell is coupled by the gate':'untouched by this gate (spectator qubits differ)');}
  gridTip.className=two?'two':'';
  gridTip.innerHTML='<div class="gt-gate">'+gate+'</div><div class="gt-cell">⟨'+bitstr(hc.r)+'|ρ|'+bitstr(hc.c)+'⟩</div>'+
    '<div class="gt-val">|ρ| = '+mag.toFixed(3)+(mag>0.004?'  ∠ '+ph+'°':'')+'</div><div class="gt-note">'+note+'</div>';
  gridTip.style.display='block';
  const pad=15,w=gridTip.offsetWidth,h=gridTip.offsetHeight;let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth-6)x=e.clientX-pad-w;if(y+h>innerHeight-6)y=e.clientY-pad-h;gridTip.style.left=x+'px';gridTip.style.top=y+'px';
}
function hideGridTip(){gridHover=null;gridTip.style.display='none';renderGridOverlay();}
g2dCv.addEventListener('mousemove',showGridTip);
g2dCv.addEventListener('mouseleave',hideGridTip);
// Draw the step inspector panel and, in stack view, highlight the coupled cells.
function drawStepInspector(si){                              // mini score-column of the active step: gate glyph + highlighted qubits
  const panel=document.getElementById('step-inspector');
  if(!VS.stepInspect||!trace){panel.classList.remove('show');if(inspMesh)inspMesh.count=0;lastInspStep=-99;return;}
  panel.classList.add('show');
  const N=VS.numQubits,g=(si>=0&&si<VS.gates.length)?VS.gates[si]:null;
  const dpr=Math.min(devicePixelRatio||1,2),LW=24,GW=60,laneH=17,padT=9,Wc=LW+GW,Hc=padT*2+Math.max(1,N)*laneH;
  if(inspCv.width!==(Wc*dpr|0)||inspCv.height!==(Hc*dpr|0)){inspCv.width=Wc*dpr|0;inspCv.height=Hc*dpr|0;inspCv.style.width=Wc+'px';inspCv.style.height=Hc+'px';}
  ictx.setTransform(dpr,0,0,dpr,0,0);ictx.clearRect(0,0,Wc,Hc);
  const lY=q=>padT+(N-1-q)*laneH+laneH/2,gx=LW+GW/2;        // q0 at the bottom
  const acted=g?new Set((g.targets||[]).concat(g.controls||[])):new Set();
  ictx.textBaseline='middle';ictx.font='600 9px JetBrains Mono,monospace';
  for(let q=0;q<N;q++){const y=lY(q),hot=acted.has(q);
    ictx.strokeStyle=hot?'rgba(255,200,80,0.55)':'rgba(70,95,135,0.5)';ictx.lineWidth=1;ictx.beginPath();ictx.moveTo(LW,y);ictx.lineTo(Wc-4,y);ictx.stroke();
    ictx.fillStyle=hot?'#ffc850':'#7f90ad';ictx.textAlign='left';ictx.fillText('q'+q,3,y);}
  if(g){const col=(g.kind==='measurement')?[182,196,216]:((g.controls&&g.controls.length)?C_AMBER:C_CYAN),cs='rgb('+col[0]+','+col[1]+','+col[2]+')';
    if(g.controls&&g.controls.length){const ys=g.controls.concat(g.targets).map(lY),y0=Math.min(...ys),y1=Math.max(...ys);
      ictx.strokeStyle=cs;ictx.lineWidth=2;ictx.beginPath();ictx.moveTo(gx,y0);ictx.lineTo(gx,y1);ictx.stroke();
      for(const cq of g.controls){ictx.fillStyle=cs;ictx.beginPath();ictx.arc(gx,lY(cq),3.6,0,7);ictx.fill();}}
    const bw=27,bh=14;
    for(const q of g.targets){const y=lY(q);
      ictx.fillStyle='rgba(8,12,20,0.96)';roundRect(ictx,gx-bw/2,y-bh/2,bw,bh,4);ictx.fill();
      ictx.strokeStyle=cs;ictx.lineWidth=2;roundRect(ictx,gx-bw/2,y-bh/2,bw,bh,4);ictx.stroke();
      ictx.fillStyle=cs;ictx.font='700 10px JetBrains Mono,monospace';ictx.textAlign='center';
      ictx.fillText(g.kind==='measurement'?'M':(g.name==='swap'?'×':g.name.toUpperCase().slice(0,3)),gx,y+0.5);}}
  let lbl,note='';
  if(!g){lbl='<b>initial</b> state |0…0⟩';note='no gate applied yet';}
  else{let q;if(g.kind==='measurement')q='all qubits';else if(g.controls&&g.controls.length)q='ctrl q'+g.controls.join(',')+' → q'+g.targets[0];
    else if(g.name==='swap')q='q'+g.targets[0]+' ↔ q'+g.targets[1];else q='q'+g.targets[0]+(g.params&&g.params.length?' · θ='+g.params[0].toFixed(2):'');
    lbl='step <b>'+(si+1)+'</b>/'+VS.gates.length+' · '+(g.kind==='measurement'?'MEASURE':g.name.toUpperCase())+' · '+q;
    if(g.kind==='measurement')note='collapses all qubits onto a basis state';
    else if(g.name==='swap')note='exchanges q'+g.targets[0]+' ↔ q'+g.targets[1]+' — lit cells are coupled';
    else if(g.controls&&g.controls.length)note='acts on q'+g.targets[0]+' only where q'+g.controls.join(',')+'=1 — lit block is its reach';
    else note='mixes states differing in q'+g.targets[0]+' — diagonal + cross-stripes lit';}
  document.getElementById('insp-title').innerHTML=lbl+'<span class="note">'+note+'</span>';
  highlightStepCells(si,g);
}
// Place additive highlight cubes on exactly the cells (i,j) the active gate can
// couple: those agreeing on every spectator qubit, i.e. (i^j) has no bits outside
// the gate's qubit mask. Diagonals glow brighter than off-diagonals.
function highlightStepCells(si,g){                          // tint the array cells this gate's operator couples (diagonal + cross-correlation off-diagonals)
  if(!inspMesh)return;
  const Q=g?(g.targets||[]).concat(g.controls||[]):[],k=Q.length;
  if(!g||g.kind==='measurement'||k>2||VS.viewMode!=='stack'){inspMesh.count=0;lastInspStep=-99;return;}
  if(si===lastInspStep)return;                              // already placed for this step
  lastInspStep=si;
  let mask=0;for(const q of Q)mask|=(1<<q);
  const L=Math.min(totalLayers-1,si+1),baseY=L*LAYER_GAP+CUBE/2,off=(DIM-1)/2;
  const col=(g.controls&&g.controls.length)?C_AMBER:C_CYAN,cap=inspMesh.instanceMatrix.count;
  let n=0;
  for(let i=0;i<DIM&&n<cap;i++)for(let j=0;j<DIM&&n<cap;j++){
    if(((i^j)&~mask)===0){                                  // i and j agree on every spectator qubit → operator can touch (i,j)
      dummy.position.set((j-off)*PITCH,baseY,(i-off)*PITCH);dummy.scale.set(1,1,1);dummy.updateMatrix();inspMesh.setMatrixAt(n,dummy.matrix);
      const b=(i===j)?1.05:0.62;_col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b,THREE.SRGBColorSpace);inspMesh.setColorAt(n,_col);n++;}
  }
  inspMesh.count=n;inspMesh.instanceMatrix.needsUpdate=true;if(inspMesh.instanceColor)inspMesh.instanceColor.needsUpdate=true;
}
// Update the parts of the HUD that change only on a rebuild: qubit count and the
// color legend for the active coloring mode.
function updateHudStatic(){document.getElementById('st-qubits').textContent=VS.numQubits+' qubits';
  const lg=document.getElementById('legend');
  if(VS.colorMode==='mag')lg.innerHTML='<span><i style="background:'+cmapCss(currentCmap())+'"></i>|ρ| low→high</span>';
  else if(VS.colorMode==='real')lg.innerHTML='<span><i style="background:linear-gradient(90deg,#ffb948,#24344e,#45d3ff)"></i>Re(ρ) −→+</span>';
  else lg.innerHTML='<span><i style="background:linear-gradient(90deg,#4bd7ff,#8273ff,#ffb15c)"></i>∠ρ phase</span>';}
// Per-frame HUD: refresh the inspector and 2D grid, then rewrite the step/phase,
// outcome, and telemetry readouts for the current frame.
function updateHud(frame){const steps=VS.gates.length,si=frame?frame.stepIndex:0;
  drawStepInspector(si);draw2DGrid(si);
  const ph=frame?frame.phase:'—';const c=phaseColorArr(ph);
  document.getElementById('hud-step').innerHTML='step '+(si<0?0:si+1)+'/'+steps+' · phase <b style="color:rgb('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+')">'+ph+'</b>'+(VS.viewMode==='stack'?' · layer '+(Math.max(0,si+1))+'/'+(totalLayers-1):'');
  document.getElementById('st-step').innerHTML='step <b>'+(si<0?0:si+1)+'</b>/'+steps;
  let outcome='—';if(trace){const ms=trace.steps.find(s=>s.selectedOutcome!=null);if(ms)outcome=ms.selectedOutcome;}
  document.getElementById('st-outcome').innerHTML='outcome <b>'+(outcome==='—'?'—':'|'+outcome+'⟩')+'</b>';
  const gname=frame&&frame.gateName!=='init'?frame.gateName.toUpperCase():'—';
  document.getElementById('hud-tr').innerHTML='STATE: <b>op_'+(si<0?0:si)+'_'+gname.toLowerCase()+'</b><br>BLOCK: <b>['+Array.from({length:VS.numQubits},(_,i)=>i).join(',')+']</b><br>MODE: <b>'+(VS.viewMode==='stack'?'layer stack · full history':'floor field')+'</b><br>LAYERS: <b>'+(Math.max(0,si+1)+1)+'/'+totalLayers+'</b><br>GATE: <span class="hi">'+gname+'</span><br>OUTCOME: <span class="hi">'+(outcome==='—'?'pending':'|'+outcome+'⟩')+'</span>';
  const b=document.getElementById('hud-bottom');
  if(frame&&frame.measurement)b.innerHTML='<span class="tag">shot_stack:</span> collapsed outcome |'+(outcome==='—'?'?':outcome)+'⟩ is the bright cube; lines trace from the responsible diagonal source cells in the layer below.';
  else if(VS.viewMode==='stack')b.innerHTML='<span class="tag">layer stack:</span> each slab is ρ = |ψ⟩⟨ψ| after one computation step; the circuit builds upward, one layer per gate. color = |ρ<sub>ij</sub>| heatmap.';
  else b.innerHTML='<span class="tag">floor field:</span> single ρ(t) grid morphing on the animated floor. height ∝ |ρ<sub>ij</sub>|.';}

/* ════════ Qiskit programming (hidden dock panel) ════════ */
// Parse a small Qiskit-like source into {n, gates}: read QuantumCircuit(n), then
// one gate per method call. Angles allow pi and arithmetic; unknown ops throw.
function parseQiskit(src){
  const num=tok=>{const e=tok.trim().replace(/pi/gi,'Math.PI');if(!/^[-+0-9.\s*/()MathPI]*$/.test(e)||e==='')throw 'bad angle: '+tok;return Function('return ('+e+')')();};
  const qi=a=>{const v=parseInt(a,10);if(!Number.isInteger(v))throw 'bad qubit: '+a;return v;};
  let n=null;const gates=[];
  for(const raw of src.split('\n')){const line=raw.split('#')[0].trim();if(!line)continue;
    let m=line.match(/QuantumCircuit\s*\(\s*(\d+)/);if(m){n=parseInt(m[1]);continue;}
    m=line.match(/\.(\w+)\s*\(([^)]*)\)/);if(!m)continue;
    const fn=m[1].toLowerCase(),A=m[2].trim()===''?[]:m[2].split(',');
    if(['h','x','y','z','s','t'].includes(fn))gates.push({name:fn,kind:'unitary',targets:[qi(A[0])],controls:[]});
    else if(['rx','ry','rz'].includes(fn))gates.push({name:fn,kind:'unitary',targets:[qi(A[1])],controls:[],params:[num(A[0])]});
    else if(fn==='cx'||fn==='cnot')gates.push({name:'cx',kind:'unitary',targets:[qi(A[1])],controls:[qi(A[0])]});
    else if(fn==='cz')gates.push({name:'cz',kind:'unitary',targets:[qi(A[1])],controls:[qi(A[0])]});
    else if(fn==='swap')gates.push({name:'swap',kind:'unitary',targets:[qi(A[0]),qi(A[1])],controls:[]});
    else if(fn==='ccx'||fn==='toffoli')gates.push({name:'ccx',kind:'unitary',targets:[qi(A[2])],controls:[qi(A[0]),qi(A[1])]});
    else if(fn==='cswap'||fn==='fredkin')gates.push({name:'cswap',kind:'unitary',targets:[qi(A[1]),qi(A[2])],controls:[qi(A[0])]});
    else if(fn==='measure'||fn==='measure_all')gates.push({name:'measure',kind:'measurement',targets:null});
    else if(fn==='barrier'){}                                  // ignored
    else throw 'unsupported op: .'+fn+'()';}
  if(!n)throw 'no QuantumCircuit(n) line found';
  if(n<1||n>8)throw 'qubits must be 1–8 (got '+n+')';
  for(const g of gates){if(g.kind==='measurement'){g.targets=Array.from({length:n},(_,i)=>i);}
    else for(const q of g.targets.concat(g.controls||[]))if(!(q>=0&&q<n))throw 'qubit '+q+' out of range for n='+n;}
  return {n,gates};
}
// Toggle the Qiskit panel open/closed and refresh highlighting when shown.
document.getElementById('cd-qiskit-btn').onclick=function(){const p=document.getElementById('qiskit-panel');p.hidden=!p.hidden;this.classList.toggle('on',!p.hidden);if(!p.hidden)syncQiskitHL();resize();};

/* ---- Qiskit: codegen for the active algorithm + live syntax highlighting ---- */
// Emit Qiskit source for the current gate list (the inverse of parseQiskit).
function gatesToQiskit(gates,n){
  const fmt=x=>String(+(+x).toFixed(6));
  const out=['qc = QuantumCircuit('+n+')'];
  for(const g of gates){const nm=g.name,T=g.targets||[],C=g.controls||[];
    if(['h','x','y','z','s','t'].includes(nm))out.push('qc.'+nm+'('+T[0]+')');
    else if(['rx','ry','rz'].includes(nm))out.push('qc.'+nm+'('+fmt((g.params||[0])[0])+', '+T[0]+')');
    else if(nm==='cx')out.push('qc.cx('+C[0]+', '+T[0]+')');
    else if(nm==='cz')out.push('qc.cz('+C[0]+', '+T[0]+')');
    else if(nm==='swap')out.push('qc.swap('+T[0]+', '+T[1]+')');
    else if(nm==='ccx')out.push('qc.ccx('+C[0]+', '+C[1]+', '+T[0]+')');
    else if(nm==='cswap')out.push('qc.cswap('+C[0]+', '+T[0]+', '+T[1]+')');
    else if(g.kind==='measurement')out.push('qc.measure_all()');}
  return out.join('\n');
}
// Turn source into highlighted HTML by tokenizing and wrapping keywords, gate
// names, numbers, pi, and comments in colored spans. Drawn under the textarea.
function highlightQiskit(src){
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const single=/^(h|x|y|z|s|t|rx|ry|rz)$/,multi=/^(cx|cnot|cz|swap|ccx|toffoli|cswap|fredkin|measure|measure_all|barrier)$/;
  return src.split('\n').map(line=>{
    const h=line.indexOf('#');let code=line,cmt='';if(h>=0){code=line.slice(0,h);cmt=line.slice(h);}
    let out='',m;const re=/([A-Za-z_]\w*|\d+\.\d+|\.\d+|\d+|\s+|[(),.])/g;
    while((m=re.exec(code))){const t=m[0],e=esc(t);
      if(/^\s+$/.test(t)||/^[(),.]$/.test(t))out+=e;
      else if(t==='QuantumCircuit')out+='<span class="qk-kw">'+e+'</span>';
      else if(t==='qc')out+='<span class="qk-id">'+e+'</span>';
      else if(t==='pi')out+='<span class="qk-pi">'+e+'</span>';
      else if(single.test(t))out+='<span class="qk-gate">'+e+'</span>';
      else if(multi.test(t))out+='<span class="qk-cgate">'+e+'</span>';
      else if(/^(\d+\.\d+|\.\d+|\d+)$/.test(t))out+='<span class="qk-num">'+e+'</span>';
      else out+=e;}
    if(cmt)out+='<span class="qk-cmt">'+esc(cmt)+'</span>';
    return out||' ';
  }).join('\n');
}
// Repaint the highlight layer from the textarea and keep the two scroll-aligned.
function syncQiskitHL(){const ta=document.getElementById('qiskit-src'),hl=document.getElementById('qiskit-hl');hl.innerHTML=highlightQiskit(ta.value);hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;}
function setQiskitFromState(){                              // mirror the active algorithm into the editor (read-only display)
  const ta=document.getElementById('qiskit-src');ta.value=gatesToQiskit(VS.gates,VS.numQubits);ta.readOnly=true;
  document.getElementById('qiskit-custom').hidden=false;document.getElementById('qiskit-run').hidden=true;
  const msg=document.getElementById('qiskit-msg');msg.textContent='live code for the active algorithm';msg.className='';
  syncQiskitHL();
}
// Switch the editor from read-only mirror to an editable custom circuit.
document.getElementById('qiskit-custom').onclick=function(){
  const ta=document.getElementById('qiskit-src');ta.readOnly=false;ta.focus();
  this.hidden=true;document.getElementById('qiskit-run').hidden=false;
  const msg=document.getElementById('qiskit-msg');msg.textContent='editing — write your circuit, then Run';msg.className='';};
(function(){const ta=document.getElementById('qiskit-src');
  ta.addEventListener('input',syncQiskitHL);
  ta.addEventListener('scroll',()=>{const hl=document.getElementById('qiskit-hl');hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;});})();
// Run the custom circuit: parse it, load it as the active circuit, and report ok
// or the parse error inline.
document.getElementById('qiskit-run').onclick=()=>{const msg=document.getElementById('qiskit-msg');try{
  const {n,gates}=parseQiskit(document.getElementById('qiskit-src').value);
  VS.numQubits=n;VS.preset='custom';VS.gates=gates;initBasis=0;clampQ();
  document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));
  rebuild();syncQiskitHL();msg.textContent='✓ '+gates.length+' ops on '+n+' qubits';msg.className='ok';
}catch(e){msg.textContent='✕ '+e;msg.className='err';}};

/* ════════ measurement sampling — lit one shot at a time, Gaussian-paced ════════ */
// 2D histogram canvas and the current sampling animation state (null when idle).
const histCv=document.getElementById('hist-canvas'),hctx=histCv.getContext('2d');
let sampleAnim=null;
// Abramowitz-Stegun approximation of the error function, for the pacing curve.
function erf(x){const s=x<0?-1:1;x=Math.abs(x);const t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return s*y;}
const _S0=0.5*(1+erf((0-0.5)/(0.19*Math.SQRT2))),_S1=0.5*(1+erf((1-0.5)/(0.19*Math.SQRT2)));
function sCurve(p){const s=0.5*(1+erf((p-0.5)/(0.19*Math.SQRT2)));return Math.min(1,Math.max(0,(s-_S0)/(_S1-_S0)));} // integral of a Gaussian rate: slow→fast→slow
// Position the additive glow cubes over the diagonal (population) cells of the
// sampling layer, ready to be lit as shots arrive.
function placeSampleGlow(L){                                 // diagonal (population) cells of the sampling layer
  for(let i=0;i<DIM;i++){const x=(i-(DIM-1)/2)*PITCH,z=(i-(DIM-1)/2)*PITCH;
    const y=(VS.viewMode==='floor')?CUBE*0.5:L*LAYER_GAP+CUBE*0.5;
    dummy.position.set(x,y,z);dummy.scale.set(1,1,1);dummy.updateMatrix();sampleMesh.setMatrixAt(i,dummy.matrix);}
  sampleMesh.instanceMatrix.needsUpdate=true;sampleMesh.count=DIM;
}
// Size the 3D result bars from the empirical counts and place the amber crossbar
// at each state's true probability, so the bars visibly converge to the marks.
function updateHistBars(A){
  if(!histBars||histBars.count!==A.D)return;
  const baseY=(VS.viewMode==='floor')?CUBE:A.layer*LAYER_GAP+CUBE;     // top of the sampling layer's cells
  let scale=1e-4;for(let i=0;i<A.D;i++)scale=Math.max(scale,A.counts[i]/Math.max(1,A.drawn),A.probs[i]);
  const breathe=0.82+0.18*Math.sin(A.gp);
  for(let i=0;i<A.D;i++){const dx=(i-(A.D-1)/2)*PITCH;                 // diagonal cell (i,i): x = z
    const emp=A.counts[i]/Math.max(1,A.drawn),h=Math.max(1e-4,(emp/scale)*BARMAX);
    dummy.position.set(dx,baseY,dx);dummy.scale.set(1,h,1);dummy.updateMatrix();histBars.setMatrixAt(i,dummy.matrix);
    const col=heatColor(0.04+0.96*(emp/scale)),b=breathe*(1+A.pulses[i]*1.4);
    _col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b,THREE.SRGBColorSpace);histBars.setColorAt(i,_col);
    const th=baseY+Math.max(1e-4,(A.probs[i]/scale)*BARMAX);          // amber target at the true probability
    dummy.position.set(dx,th,dx);dummy.scale.set(1,1,1);dummy.updateMatrix();histMarks.setMatrixAt(i,dummy.matrix);}
  histBars.instanceMatrix.needsUpdate=true;if(histBars.instanceColor)histBars.instanceColor.needsUpdate=true;
  histMarks.instanceMatrix.needsUpdate=true;
}
// Start the measurement sampler: force the stack view fully revealed, pick the
// layer just before collapse, compute its true |ψ|² distribution, and set up the
// animation state (counts, pulses, seeded RNG) plus the on-screen bars.
function runSampling(){
  if(!trace)return;
  if(VS.viewMode!=='stack'){VS.viewMode='stack';document.querySelectorAll('.dock-view').forEach(b=>b.classList.toggle('active',b.dataset.view==='stack'));}
  VS.showFull=true;const tf=document.getElementById('tog-full');if(tf)tf.classList.add('on');
  VS.stageTime=totalStackTime();VS.playing=false;$('btn-play')&&($('btn-play').textContent='▶ Play',$('btn-play').classList.remove('active')); // reveal whole tower so the sampled layer is in view
  let sampleLayer=totalLayers-1;const mi=trace.steps.findIndex(s=>s.kind==='measurement');
  if(mi>=0)sampleLayer=mi;                                   // the superposition right before measurement collapses it
  const st=layerStates[sampleLayer],D=1<<VS.numQubits;
  const probs=new Array(D);let sm=0;for(let i=0;i<D;i++){const p=st.re[i]*st.re[i]+st.im[i]*st.im[i];probs[i]=p;sm+=p;}
  if(sm>0)for(let i=0;i<D;i++)probs[i]/=sm;
  const shots=Math.max(0,Math.round(+document.getElementById('sl-shots').value));
  const gap=Math.max(0,+document.getElementById('sl-gap').value);
  sampleAnim={probs,D,layer:sampleLayer,counts:new Array(D).fill(0),pulses:new Float32Array(D),maxc:1,
    drawn:0,shots,gap,acc:gap,gp:0,done:false,rng:makeRng((((VS.seed+1)*2654435761)>>>0)||1)};
  placeSampleGlow(sampleLayer);
  histBars.count=D;histMarks.count=D;
  for(let i=0;i<D;i++)histMarks.setColorAt(i,_col.setRGB(1,0.72,0.28,THREE.SRGBColorSpace));
  if(histMarks.instanceColor)histMarks.instanceColor.needsUpdate=true;
  histGroup.visible=true;
  document.getElementById('hist-panel').classList.add('show');frameCamera();
}
// Advance sampling each frame: emit shots at a Gaussian-shaped rate (slow at the
// ends, fast in the middle), decay the per-cell pulses, and repaint bars/glow.
function updateSampling(dt){
  const A=sampleAnim;if(!A)return;A.gp+=dt*5;
  if(!A.done){
    if(A.gap<=0.001){while(A.drawn<A.shots)oneShot(A);}     // gap≈0 → emit all at once
    else{
      A.acc+=dt;
      while(A.drawn<A.shots){                                // Gaussian-shaped rate: ~0.7s gaps at the ends, fast through the middle
        const e=Math.min(A.drawn,A.shots-1-A.drawn),r=e/4,ramp=Math.exp(-0.5*r*r);
        const g=0.006+(A.gap-0.006)*ramp;                     // start/end ≈ slider gap (slow); centre ≈ 6ms (fast)
        if(A.acc<g)break;A.acc-=g;oneShot(A);
      }
    }
    if(A.drawn>=A.shots)A.done=true;
  }
  const decay=Math.exp(-dt*4);for(let i=0;i<A.D;i++)A.pulses[i]*=decay;
  paintSampleGlow(A);updateHistBars(A);drawHistogram(A);
}
// Draw one measurement shot: sample an outcome, bump its count, flash its pulse.
function oneShot(A){const idx=sampleOutcome(A.rng,A.probs);A.counts[idx]++;A.pulses[idx]=1;A.drawn++;if(A.counts[idx]>A.maxc)A.maxc=A.counts[idx];}
// Light the diagonal glow cubes: steady brightness by count, spike on a fresh hit.
function paintSampleGlow(A){
  if(!sampleMesh||sampleMesh.count!==A.D)return;
  const breathe=0.75+0.25*Math.sin(A.gp);
  for(let i=0;i<A.D;i++){const norm=A.counts[i]/A.maxc;
    const b=norm*breathe*1.25 + A.pulses[i]*2.2;            // steady glow ∝ count, plus a spike each time it's hit
    if(b<=0.001){_col.setRGB(0,0,0,THREE.SRGBColorSpace);}
    else{const col=heatColor(0.01+0.99*curveEval(norm));_col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b,THREE.SRGBColorSpace);}
    sampleMesh.setColorAt(i,_col);}
  if(sampleMesh.instanceColor)sampleMesh.instanceColor.needsUpdate=true;
}
// Draw the 2D histogram panel: empirical bars per basis state with an amber line
// at the true probability, plus the shots-drawn readout.
function drawHistogram(A){
  const dpr=Math.min(devicePixelRatio||1,2),W=histCv.clientWidth||600,H=histCv.clientHeight||96;
  if(histCv.width!==Math.round(W*dpr)||histCv.height!==Math.round(H*dpr)){histCv.width=Math.round(W*dpr);histCv.height=Math.round(H*dpr);}
  hctx.setTransform(dpr,0,0,dpr,0,0);hctx.clearRect(0,0,W,H);
  const D=A.D,padL=8,padR=W-8,padB=H-4,padT=4,bw=(padR-padL)/D;
  let maxP=1e-4;for(let i=0;i<D;i++){maxP=Math.max(maxP,A.probs[i],A.counts[i]/Math.max(1,A.drawn));}
  for(let i=0;i<D;i++){const x=padL+i*bw,emp=A.counts[i]/Math.max(1,A.drawn);
    const eh=(emp/maxP)*(padB-padT),col=heatColor(A.probs[i]/maxP),fl=A.pulses?A.pulses[i]:0;
    const br=1+fl*1.6;hctx.fillStyle='rgba('+Math.min(255,col[0]*br|0)+','+Math.min(255,col[1]*br|0)+','+Math.min(255,col[2]*br|0)+','+(0.9+0.1*fl)+')';
    hctx.fillRect(x+bw*0.12,padB-eh,Math.max(1,bw*0.76),eh);
    const th=(A.probs[i]/maxP)*(padB-padT);hctx.strokeStyle='rgba(255,200,80,0.85)';hctx.lineWidth=1;hctx.beginPath();hctx.moveTo(x+bw*0.05,padB-th);hctx.lineTo(x+bw*0.95,padB-th);hctx.stroke();}
  hctx.strokeStyle='rgba(70,95,135,0.5)';hctx.lineWidth=1;hctx.beginPath();hctx.moveTo(padL,padB+0.5);hctx.lineTo(padR,padB+0.5);hctx.stroke();
  document.getElementById('hist-info').innerHTML='<b>'+A.drawn+'</b> / '+A.shots+' shots · '+D+' basis states · amber line = true |ψ|²';
}
// Stop and clear the sampler and hide its 3D bars.
function stopSampling(){sampleAnim=null;if(sampleMesh)sampleMesh.count=0;if(histGroup)histGroup.visible=false;if(histBars)histBars.count=0;if(histMarks)histMarks.count=0;}
document.getElementById('btn-sample').onclick=runSampling;
document.getElementById('hist-close').onclick=()=>{document.getElementById('hist-panel').classList.remove('show');stopSampling();};

/* ════════ loop ════════ */
// FPS bookkeeping; TL_FPS is the nominal frame rate the floor timeline steps at.
let last=0,fc=0,ft=0;const TL_FPS=26;
// Main render loop: advance the playhead (stack stage or floor frame index),
// update the active view, redraw the score and HUD, sync the scrub slider, run
// the sampler, then render through the bloom composer.
function loop(t){requestAnimationFrame(loop);const dt=Math.min((t-last)/1000,0.05);last=t;
  fc++;ft+=dt;if(ft>=0.5){document.getElementById('st-fps').textContent=Math.round(fc/ft)+' fps';fc=0;ft=0;}
  if(trace){
    if(VS.threshDirty){builtStage=-1;layerEndArr=[];edgeEndArr=[];VS.threshDirty=false;}  // re-pack with the new heat cutoff
    const sc=document.getElementById('sl-scrub');
    if(VS.viewMode==='stack'){
      if(VS.playing){VS.stageTime+=dt*VS.speed;if(VS.stageTime>=totalStackTime())VS.stageTime=0;}
      updateStack(dt);
      const stage=currentStageFor(VS.stageTime),sf=stageFrame(stage);
      drawLens(sf);updateHud(sf);
      if(document.activeElement!==sc){const f=VS.stageTime/Math.max(1e-6,totalStackTime());sc.value=Math.round(f*100);sc.style.setProperty('--pct',(f*100)+'%');document.getElementById('vl-scrub').textContent=Math.round(f*100)+'%';}
    } else {
      if(VS.playing){VS.frameIndex+=VS.speed*TL_FPS*dt;if(VS.frameIndex>=trace.frames.length)VS.frameIndex=0;}
      const fi=Math.max(0,Math.min(trace.frames.length-1,Math.floor(VS.frameIndex))),frame=trace.frames[fi];
      updateFloor(frame,dt);drawLens(frame);updateHud(frame);
      if(document.activeElement!==sc){const f=fi/Math.max(1,trace.frames.length-1);sc.value=Math.round(f*100);sc.style.setProperty('--pct',(f*100)+'%');document.getElementById('vl-scrub').textContent=Math.round(f*100)+'%';}
    }
    followPlayhead();
    if(sampleAnim)updateSampling(dt);
  }
  controls.update();composer.render();}
function applyAutoOrient(W,H){                              // wide window → horizontal stack, tall → vertical
  if(!VS.autoOrient)return;const want=(W/H>=1.2)?'horizontal':'vertical';
  if(want!==VS.stackAxis){VS.stackAxis=want;const b=document.getElementById('orient-btn');
    if(b)b.textContent=want==='horizontal'?'⬌ Horizontal (auto)':'⬍ Vertical (auto)';
    if(typeof frameCamera==='function')frameCamera();}
}
// Tracks the last mobile/desktop decision so the layout only switches on change.
let wasMobile=null;
function applyMobileLayout(W){                              // narrow viewport: kill the overlay panels (they cover the 3D view)
  const mob=W<760;if(mob===wasMobile)return;wasMobile=mob;
  if(mob){VS.stepInspect=false;VS.grid2d=false;
    document.getElementById('step-inspector').classList.remove('show');document.getElementById('grid2d-panel').classList.remove('show');
    const a=document.getElementById('tog-inspect'),b=document.getElementById('tog-grid2d');if(a)a.classList.remove('on');if(b)b.classList.remove('on');}
  else{VS.stepInspect=true;VS.grid2d=true;grid2dDirty=true;last2dLayer=-99;
    const a=document.getElementById('tog-inspect'),b=document.getElementById('tog-grid2d');if(a)a.classList.add('on');if(b)b.classList.add('on');}
}
// Match renderer, composer, and camera to the GL host size, then re-apply the
// auto orientation and mobile layout. Driven by a ResizeObserver on the host.
function resize(){const w=document.getElementById('gl-host');const W=w.clientWidth||600,H=w.clientHeight||400;renderer.setSize(W,H,false);composer.setSize(W,H);camera.aspect=W/H;camera.updateProjectionMatrix();applyAutoOrient(W,H);applyMobileLayout(window.innerWidth||W);}
if(window.ResizeObserver)new ResizeObserver(resize).observe(document.getElementById('gl-host'));else window.addEventListener('resize',resize);

/* ════════ UI wiring ════════ */
// Short id lookup used throughout the wiring below.
const $=id=>document.getElementById(id);
// Paint a slider's filled portion via the --pct custom property the CSS reads.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}
// Keep target/control qubit selections within the current qubit count and update
// their readouts.
function clampQ(){VS.target=Math.max(0,Math.min(VS.numQubits-1,VS.target));VS.control=Math.max(0,Math.min(VS.numQubits-1,VS.control));$('t-val').textContent=VS.target;$('c-val').textContent=VS.control;$('q-count').textContent=VS.numQubits;}
// Rebuild the sequence list from VS.gates, one row per gate with a delete button.
function renderList(){const list=$('gate-list');list.innerHTML='';if(VS.gates.length===0){list.innerHTML='<div class="gate-empty">pick a preset or build</div>';return;}
  VS.gates.forEach((g,i)=>{const d=document.createElement('div');d.className='gate-item';let q;
    if(g.kind==='measurement')q='all';else if(g.controls&&g.controls.length)q='c'+g.controls[0]+'→t'+g.targets[0];else if(g.name==='swap')q=g.targets[0]+'↔'+g.targets[1];else q='q'+g.targets[0]+(g.params&&g.params.length?' ('+g.params[0].toFixed(2)+')':'');
    d.innerHTML=`<span class="gi-idx">${i}</span><span class="gi-name">${g.kind==='measurement'?'MEAS':g.name.toUpperCase()}</span><span class="gi-q">${q}</span><button class="gi-del" data-i="${i}">✕</button>`;list.appendChild(d);});
  list.querySelectorAll('.gi-del').forEach(b=>b.addEventListener('click',()=>{VS.gates.splice(+b.dataset.i,1);VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));rebuild();}));}
// Append a gate from the palette using the current target/control/angle. Two-qubit
// gates need distinct qubits; a measurement is always removed first so it stays last.
function addGate(name){const two=['cx','cz','swap'].includes(name),rot=['rx','ry','rz'].includes(name);let g;
  if(name==='swap')g={name,kind:'unitary',targets:[VS.target,VS.control],controls:[]};
  else if(two)g={name,kind:'unitary',targets:[VS.target],controls:[VS.control]};
  else if(rot)g={name,kind:'unitary',targets:[VS.target],controls:[],params:[VS.angle]};
  else g={name,kind:'unitary',targets:[VS.target],controls:[]};
  if(two&&VS.target===VS.control){const e=$('c-val');e.style.color='var(--red)';setTimeout(()=>e.style.color='',300);return;}
  VS.gates=VS.gates.filter(x=>x.kind!=='measurement');VS.gates.push(g);VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));rebuild();}
// Qubit-count and target/control steppers; changing the count reloads a preset or
// rebuilds a custom circuit at the new size.
$('q-minus').onclick=()=>{VS.numQubits=Math.max(1,VS.numQubits-1);initBasis=0;clampQ();if(VS.preset!=='custom')loadPreset(VS.preset);else rebuild();};
$('q-plus').onclick=()=>{VS.numQubits=Math.min(8,VS.numQubits+1);initBasis=0;clampQ();if(VS.preset!=='custom')loadPreset(VS.preset);else rebuild();};
$('t-minus').onclick=()=>{VS.target--;clampQ();};$('t-plus').onclick=()=>{VS.target++;clampQ();};
$('c-minus').onclick=()=>{VS.control--;clampQ();};$('c-plus').onclick=()=>{VS.control++;clampQ();};
$('sl-angle').addEventListener('input',function(){VS.angle=+this.value;sg(this);const f=this.value/Math.PI;$('vl-angle').textContent=Math.abs(f-0.5)<0.02?'π/2':Math.abs(f-1)<0.02?'π':f.toFixed(2)+'π';});sg($('sl-angle'));
document.querySelectorAll('.gate-btn').forEach(b=>b.addEventListener('click',()=>addGate(b.dataset.g)));
/* ── hover a gate → show its unitary (operator) matrix at the cursor ── */
// Floating tooltip that shows a gate's operator matrix while hovering its button.
const gateTip=document.createElement('div');gateTip.id='gate-tip';document.body.appendChild(gateTip);
// The display matrix (and label/prefactor) for each palette gate.
function gateMatrix(g){switch(g){
  case 'h':return{n:'Hadamard',f:'1/√2',m:[['1','1'],['1','−1']]};
  case 'x':return{n:'Pauli-X (NOT)',m:[['0','1'],['1','0']]};
  case 'y':return{n:'Pauli-Y',m:[['0','−i'],['i','0']]};
  case 'z':return{n:'Pauli-Z',m:[['1','0'],['0','−1']]};
  case 's':return{n:'Phase (S)',m:[['1','0'],['0','i']]};
  case 't':return{n:'T (π/8)',m:[['1','0'],['0','e<sup>iπ/4</sup>']]};
  case 'rx':return{n:'Rx(θ)',p:1,m:[['cos θ⁄2','−i sin θ⁄2'],['−i sin θ⁄2','cos θ⁄2']]};
  case 'ry':return{n:'Ry(θ)',p:1,m:[['cos θ⁄2','−sin θ⁄2'],['sin θ⁄2','cos θ⁄2']]};
  case 'rz':return{n:'Rz(θ)',p:1,m:[['e<sup>−iθ⁄2</sup>','0'],['0','e<sup>iθ⁄2</sup>']]};
  case 'cx':return{n:'CNOT (CX)',two:1,m:[['1','0','0','0'],['0','1','0','0'],['0','0','0','1'],['0','0','1','0']]};
  case 'cz':return{n:'Controlled-Z',two:1,m:[['1','0','0','0'],['0','1','0','0'],['0','0','1','0'],['0','0','0','−1']]};
  case 'swap':return{n:'SWAP',two:1,m:[['1','0','0','0'],['0','0','1','0'],['0','1','0','0'],['0','0','0','1']]};
}return null;}
function showGateTip(g){const d=gateMatrix(g);if(!d){gateTip.style.display='none';return;}
  const cols=d.m[0].length,cells=d.m.flat().map(v=>'<span'+(v==='0'?' class="z"':'')+'>'+v+'</span>').join('');
  let theta='';if(d.p){const r=VS.angle/Math.PI;theta='<div class="tip-theta">θ = '+VS.angle.toFixed(3)+' rad = '+r.toFixed(3)+'π</div>';}
  gateTip.className=d.two?'two':'';
  gateTip.innerHTML='<div class="tip-name">'+d.n+'</div><div class="tip-mtx">'+(d.f?'<span class="tip-fac">'+d.f+'</span>':'')+
    '<div class="brk l"></div><div class="cells" style="grid-template-columns:repeat('+cols+',auto)">'+cells+'</div><div class="brk r"></div></div>'+theta;
  gateTip.style.display='block';}
function moveGateTip(e){const pad=16,w=gateTip.offsetWidth,h=gateTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;if(x+w>innerWidth-6)x=e.clientX-pad-w;if(y+h>innerHeight-6)y=e.clientY-pad-h;
  gateTip.style.left=x+'px';gateTip.style.top=y+'px';}
document.querySelectorAll('.gate-btn').forEach(b=>{
  b.addEventListener('mouseenter',()=>showGateTip(b.dataset.g));
  b.addEventListener('mousemove',moveGateTip);
  b.addEventListener('mouseleave',()=>{gateTip.style.display='none';});});
// Append a measurement over all qubits (only one, always last), or clear the circuit.
$('btn-measure').onclick=()=>{VS.gates=VS.gates.filter(x=>x.kind!=='measurement');VS.gates.push({name:'measure',kind:'measurement',targets:Array.from({length:VS.numQubits},(_,i)=>i)});rebuild();};
$('btn-clear').onclick=()=>{VS.gates=[];VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));rebuild();};
// Preset buttons load an algorithm.
document.querySelectorAll('.preset-btn').forEach(b=>b.addEventListener('click',()=>loadPreset(b.dataset.preset)));
// View switch (layer stack vs floor field): reset the instance cache and reframe.
document.querySelectorAll('.dock-view').forEach(b=>b.addEventListener('click',()=>{VS.viewMode=b.dataset.view;stopSampling();document.getElementById('hist-panel').classList.remove('show');builtStage=-1;layerEndArr=[];edgeEndArr=[];document.querySelectorAll('.dock-view').forEach(x=>x.classList.toggle('active',x===b));frameCamera();updateHudStatic();if(typeof updateDiagGuide==='function')updateDiagGuide();hideInitHover();}));
// Coloring mode (|ρ| / Re / phase): reset the cache so cells recolor.
document.querySelectorAll('.mode-grid .mode-btn').forEach(b=>b.addEventListener('click',()=>{VS.colorMode=b.dataset.cm;document.querySelectorAll('.mode-grid .mode-btn').forEach(x=>x.classList.toggle('active',x===b));builtStage=-1;layerEndArr=[];edgeEndArr=[];grid2dDirty=true;updateHudStatic();}));
// colormap grid (fluidlab-style swatches)
// Paint each colormap swatch by sampling its ramp across the preview canvas.
function renderCmapPreviews(){document.querySelectorAll('.cmap-btn').forEach(btn=>{const cv=btn.querySelector('canvas');cv.width=120;cv.height=24;const x=cv.getContext('2d');const H=CMAPS[btn.dataset.cmap];for(let px=0;px<120;px++){const t=px/119,s=t*(H.length-1),i=Math.min(Math.floor(s),H.length-2),f=s-i;x.fillStyle='rgb('+((H[i][0]+(H[i+1][0]-H[i][0])*f)|0)+','+((H[i][1]+(H[i+1][1]-H[i][1])*f)|0)+','+((H[i][2]+(H[i+1][2]-H[i][2])*f)|0)+')';x.fillRect(px,0,1,24);}});}
document.querySelectorAll('.cmap-btn').forEach(b=>b.addEventListener('click',()=>{ACTIVE_HEAT=CMAPS[b.dataset.cmap];document.querySelectorAll('.cmap-btn').forEach(x=>x.classList.toggle('active',x===b));if(edgeLines)edgeLines.material.color.copy(edgeColor3());builtStage=-1;layerEndArr=[];edgeEndArr=[];if(typeof drawCurveEditor==='function')drawCurveEditor();grid2dDirty=true;updateHudStatic();}));
renderCmapPreviews();
// shape grid: the cell primitive (rounded cube, box, sphere, octahedron) needs a
// mesh rebuild because the geometry changes.
document.querySelectorAll('.shape-grid .mode-btn').forEach(b=>b.addEventListener('click',()=>{VS.shape=b.dataset.shape;document.querySelectorAll('.shape-grid .mode-btn').forEach(x=>x.classList.toggle('active',x===b));builtStage=-1;layerEndArr=[];edgeEndArr=[];rebuildMeshes();}));
// background swatches
document.querySelectorAll('.bg-sw').forEach(b=>b.addEventListener('click',()=>setBg(b.dataset.bg)));
// Transport buttons: play/pause, single step, restart.
$('btn-play').onclick=function(){VS.playing=!VS.playing;if(VS.playing)revealMode();this.textContent=VS.playing?'▐▐ Pause':'▶ Play';this.classList.toggle('active',VS.playing);};
$('btn-step').onclick=()=>{if(!trace)return;revealMode();VS.playing=false;$('btn-play').textContent='▶ Play';$('btn-play').classList.remove('active');
  if(VS.viewMode==='stack'){const ns=currentStageFor(VS.stageTime)+1;VS.stageTime=(ns>=totalLayers?0:ns)*stageDuration();return;}
  const fi=Math.floor(VS.frameIndex),cur=trace.frames[Math.min(fi,trace.frames.length-1)].stepIndex;let j=fi+1;while(j<trace.frames.length&&trace.frames[j].stepIndex===cur)j++;VS.frameIndex=j<trace.frames.length?j:0;};
$('btn-restart').onclick=()=>{VS.frameIndex=0;VS.stageTime=0;builtStage=-1;layerEndArr=[];edgeEndArr=[];};
// Playback and sampling sliders: each stores its value into VS and updates its readout.
$('sl-speed').addEventListener('input',function(){VS.speed=+this.value;$('vl-speed').textContent=(+this.value).toFixed(1);sg(this);});sg($('sl-speed'));
$('sl-hold').addEventListener('input',function(){VS.holdTime=+this.value;$('vl-hold').textContent=(+this.value).toFixed(1)+'s';sg(this);});sg($('sl-hold'));
$('sl-thresh').addEventListener('input',function(){VS.threshold=+this.value;$('vl-thresh').textContent=(+this.value).toFixed(2);VS.threshDirty=true;sg(this);});sg($('sl-thresh'));
/* ---- tone curve editor (Photoshop-style draggable keys) ---- */
// The small canvas that draws the tone curve and lets the middle key be dragged.
// CVP is the inner padding; cvGX/cvGY map curve coords to canvas pixels.
const curveCv=$('curve-cv'),cux=curveCv.getContext('2d');let curveDrag=-1;const CVP=9;
const cvGX=(x,W)=>CVP+x*(W-2*CVP),cvGY=(y,H)=>H-CVP-y*(H-2*CVP);
// Redraw the curve editor: grid, identity diagonal, the current curve, and keys.
function drawCurveEditor(){
  const dpr=Math.min(devicePixelRatio||1,2),W=curveCv.clientWidth||230,H=curveCv.clientHeight||128;
  if(curveCv.width!==(W*dpr|0)||curveCv.height!==(H*dpr|0)){curveCv.width=W*dpr|0;curveCv.height=H*dpr|0;}
  cux.setTransform(dpr,0,0,dpr,0,0);cux.clearRect(0,0,W,H);
  cux.strokeStyle='rgba(150,200,255,0.07)';cux.lineWidth=1;
  for(let i=0;i<=4;i++){const t=i/4;cux.beginPath();cux.moveTo(cvGX(t,W),cvGY(0,H));cux.lineTo(cvGX(t,W),cvGY(1,H));cux.moveTo(cvGX(0,W),cvGY(t,H));cux.lineTo(cvGX(1,W),cvGY(t,H));cux.stroke();}
  cux.strokeStyle='rgba(150,200,255,0.13)';cux.setLineDash([3,3]);cux.beginPath();cux.moveTo(cvGX(0,W),cvGY(0,H));cux.lineTo(cvGX(1,W),cvGY(1,H));cux.stroke();cux.setLineDash([]);
  const hc=heatColor(0.85),cs='rgb('+(hc[0]|0)+','+(hc[1]|0)+','+(hc[2]|0)+')';
  cux.strokeStyle=cs;cux.lineWidth=2;cux.beginPath();
  for(let i=0;i<=80;i++){const x=i/80,y=curveEval(x);if(i===0)cux.moveTo(cvGX(x,W),cvGY(y,H));else cux.lineTo(cvGX(x,W),cvGY(y,H));}cux.stroke();
  for(let i=0;i<CURVE.pts.length;i++){const a=CURVE.pts[i],X=cvGX(a.x,W),Y=cvGY(a.y,H),mid=(i===1);
    cux.beginPath();cux.arc(X,Y,mid?(curveDrag===1?6:5):3,0,7);cux.fillStyle=mid?'#0a0e16':cs;cux.fill();
    if(mid){cux.lineWidth=2;cux.strokeStyle=curveDrag===1?'#fff':cs;cux.stroke();}}
}
// Convert a pointer event to normalized curve coordinates in [0,1].
function curvePt(e){const r=curveCv.getBoundingClientRect(),W=r.width,H=r.height;
  return {x:Math.min(1,Math.max(0,((e.clientX-r.left)-CVP)/(W-2*CVP))),y:Math.min(1,Math.max(0,1-((e.clientY-r.top)-CVP)/(H-2*CVP)))};}
// Which control point (if any) is near the pointer.
function curveHit(pt){const r=curveCv.getBoundingClientRect(),W=r.width,H=r.height;
  for(let i=0;i<CURVE.pts.length;i++){const dx=(CURVE.pts[i].x-pt.x)*(W-2*CVP),dy=(CURVE.pts[i].y-pt.y)*(H-2*CVP);if(dx*dx+dy*dy<110)return i;}return -1;}
// Rebuild the LUT and invalidate the cell cache so the new curve takes effect.
function curveChanged(){buildCurve();builtStage=-1;layerEndArr=[];edgeEndArr=[];grid2dDirty=true;drawCurveEditor();}
// Move the middle key to the pointer (clamped) and apply the change.
function curveSet(e){const pt=curvePt(e);CURVE.pts[1].x=Math.min(0.98,Math.max(0.02,pt.x));CURVE.pts[1].y=Math.min(1,Math.max(0,pt.y));curveChanged();}
curveCv.addEventListener('pointerdown',e=>{e.preventDefault();curveDrag=1;curveCv.setPointerCapture(e.pointerId);curveSet(e);});
curveCv.addEventListener('pointermove',e=>{if(curveDrag!==1)return;curveSet(e);});
curveCv.addEventListener('pointerup',e=>{curveDrag=-1;try{curveCv.releasePointerCapture(e.pointerId);}catch(_){}drawCurveEditor();});
$('curve-reset').onclick=()=>{CURVE.pts=[{x:0,y:0},{x:0.5,y:Math.pow(0.5,0.2)},{x:1,y:1}];curveDrag=-1;curveChanged();};
drawCurveEditor();
// Scrub slider: map 0..100 to the playhead for the active view, pausing play.
$('sl-scrub').addEventListener('input',function(){if(trace){const f=+this.value/100;if(VS.viewMode==='stack')VS.stageTime=f*totalStackTime();else VS.frameIndex=f*(trace.frames.length-1);revealMode();VS.playing=false;$('btn-play').textContent='▶ Play';$('btn-play').classList.remove('active');}sg(this);});
$('sl-seed').addEventListener('input',function(){VS.seed=+this.value;$('vl-seed').textContent=this.value;sg(this);rebuild();});sg($('sl-seed'));
$('sl-shots').addEventListener('input',function(){$('vl-shots').textContent=this.value;sg(this);});sg($('sl-shots'));
$('sl-gap').addEventListener('input',function(){$('vl-gap').textContent=(+this.value).toFixed(2)+'s';sg(this);if(sampleAnim)sampleAnim.gap=+this.value;});sg($('sl-gap'));
// Scene toggle buttons: each flips one VS flag and syncs its button state.
$('tog-full').onclick=function(){VS.showFull=!VS.showFull;this.classList.toggle('on',VS.showFull);
  if(VS.showFull){VS.stageTime=totalStackTime();VS.playing=false;$('btn-play').textContent='▶ Play';$('btn-play').classList.remove('active');}};
$('tog-rotate').onclick=function(){VS.autoRotate=!VS.autoRotate;controls.autoRotate=VS.autoRotate;this.classList.toggle('on',VS.autoRotate);};
$('tog-floor').onclick=function(){VS.floorGrid=!VS.floorGrid;this.classList.toggle('on',VS.floorGrid);};
$('tog-net').onclick=function(){VS.network=!VS.network;this.classList.toggle('on',VS.network);};
$('tog-labels').onclick=function(){VS.labels=!VS.labels;if(labelGroup)labelGroup.visible=VS.labels;this.classList.toggle('on',VS.labels);};
$('tog-inspect').onclick=function(){VS.stepInspect=!VS.stepInspect;this.classList.toggle('on',VS.stepInspect);if(!VS.stepInspect)document.getElementById('step-inspector').classList.remove('show');};
$('tog-grid2d').onclick=function(){VS.grid2d=!VS.grid2d;this.classList.toggle('on',VS.grid2d);grid2dDirty=true;last2dLayer=-99;if(!VS.grid2d)document.getElementById('grid2d-panel').classList.remove('show');};
$('adv-toggle').onclick=function(){const open=document.getElementById('adv-rows').classList.toggle('open');this.classList.toggle('open',open);};
// Orientation button cycles auto ▶ manual vertical ▶ manual horizontal ▶ auto.
$('orient-btn').onclick=function(){
  if(VS.autoOrient){VS.autoOrient=false;VS.stackAxis='vertical';}        // auto → manual vertical
  else if(VS.stackAxis==='vertical'){VS.stackAxis='horizontal';}         // vertical → horizontal
  else{VS.autoOrient=true;}                                              // horizontal → back to auto
  if(VS.autoOrient){const g=document.getElementById('gl-host');applyAutoOrient(g.clientWidth||600,g.clientHeight||400);
    this.textContent=VS.stackAxis==='horizontal'?'⬌ Horizontal (auto)':'⬍ Vertical (auto)';}
  else this.textContent=VS.stackAxis==='horizontal'?'⬌ Horizontal stack':'⬍ Vertical stack';
  if(VS.viewMode!=='stack'){VS.viewMode='stack';document.querySelectorAll('.dock-view').forEach(b=>b.classList.toggle('active',b.dataset.view==='stack'));}
  frameCamera();};

/* ════════ init-state picker — hover bottom grid (layer 0) for |b⟩, click to set the start state ════════ */
// Raycaster and scratch NDC vector for picking cells under the pointer.
const _ray=new THREE.Raycaster(),_ndc=new THREE.Vector2();
// pickPlane: invisible ground for the raycast; pickHi: hover highlight; diagGuide:
// the instanced markers on the diagonal (start-state candidates).
let pickPlane=null,pickHi=null,diagGuide=null,_downXY=null;
const DIAG_CAP=300;
const initTip=document.createElement('div');initTip.id='init-tip';
initTip.style.cssText='position:fixed;z-index:600;pointer-events:none;display:none;background:rgba(9,12,20,0.97);border:1px solid rgba(150,200,255,0.35);border-radius:7px;padding:7px 10px;font-family:JetBrains Mono,monospace;font-size:0.68rem;color:#cdd6e6;box-shadow:0 6px 22px rgba(0,0,0,0.55);max-width:230px;line-height:1.4';
document.body.appendChild(initTip);
// Lazily create the picker helpers (plane, highlight, diagonal guides) under grp.
function ensureInitPicker(){
  if(!grp)return;
  if(!pickPlane||pickPlane.parent!==grp){const pg=new THREE.PlaneGeometry(600,600);pickPlane=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({visible:false}));pickPlane.rotation.x=-Math.PI/2;pickPlane.frustumCulled=false;grp.add(pickPlane);}
  if(!pickHi||pickHi.parent!==grp){const hg=new THREE.BoxGeometry(PITCH*0.98,CUBE*1.14,PITCH*0.98);hg.translate(0,CUBE*0.5,0);
    pickHi=new THREE.Mesh(hg,new THREE.MeshBasicMaterial({color:0x9cc8ff,transparent:true,opacity:0.30,depthWrite:false,toneMapped:false}));pickHi.visible=false;pickHi.frustumCulled=false;grp.add(pickHi);}
  if(!diagGuide||diagGuide.parent!==grp){const dg=new THREE.BoxGeometry(PITCH*0.9,0.05,PITCH*0.9);dg.translate(0,0.02,0);
    diagGuide=new THREE.InstancedMesh(dg,new THREE.MeshBasicMaterial({transparent:true,opacity:0.4,depthWrite:false,toneMapped:false}),DIAG_CAP);
    diagGuide.setColorAt(0,_col.setRGB(0.27,0.78,0.95,THREE.SRGBColorSpace));diagGuide.count=0;diagGuide.frustumCulled=false;grp.add(diagGuide);}
  updateDiagGuide();
}
// Refresh the diagonal guide markers, raising and recoloring the current |b⟩.
function updateDiagGuide(){
  if(!diagGuide)return;const off=(DIM-1)/2,n=Math.min(DIM,DIAG_CAP);
  for(let i=0;i<n;i++){const sel=(i===initBasis);dummy.position.set((i-off)*PITCH,0,(i-off)*PITCH);dummy.scale.set(1,sel?3.2:1,1);dummy.updateMatrix();diagGuide.setMatrixAt(i,dummy.matrix);
    if(sel)_col.setRGB(1,0.72,0.28,THREE.SRGBColorSpace).multiplyScalar(1.5);else _col.setRGB(0.27,0.78,0.95,THREE.SRGBColorSpace);diagGuide.setColorAt(i,_col);}
  diagGuide.count=n;diagGuide.instanceMatrix.needsUpdate=true;if(diagGuide.instanceColor)diagGuide.instanceColor.needsUpdate=true;
  diagGuide.visible=(VS.viewMode==='stack');
}
// Binary ket string for a basis index.
function ketStr(idx){return idx.toString(2).padStart(Math.max(1,VS.numQubits),'0');}
// Raycast the pointer onto layer 0 and return the (row, col) cell it hits, or null.
function pickRC(e){
  if(VS.viewMode!=='stack'||!grp){return null;}ensureInitPicker();
  const rect=canvas.getBoundingClientRect();
  _ndc.x=((e.clientX-rect.left)/rect.width)*2-1;_ndc.y=-((e.clientY-rect.top)/rect.height)*2+1;
  _ray.setFromCamera(_ndc,camera);const hit=_ray.intersectObject(pickPlane,false)[0];if(!hit)return null;
  const lp=grp.worldToLocal(hit.point.clone()),off=(DIM-1)/2;
  const c=Math.round(lp.x/PITCH+off),r=Math.round(lp.z/PITCH+off);
  if(r<0||c<0||r>=DIM||c>=DIM)return null;return {r,c,off};
}
// Hide the init hover highlight and tooltip.
function hideInitHover(){if(pickHi)pickHi.visible=false;initTip.style.display='none';}
// On hover, highlight the cell and show a tooltip; only diagonal cells are pickable
// start states, off-diagonal cells just read out as coherences.
function onInitMove(e){
  const rc=pickRC(e);if(!rc){hideInitHover();return;}
  const {r,c,off}=rc,diag=(r===c);
  pickHi.position.set((c-off)*PITCH,0,(r-off)*PITCH);pickHi.material.color.setHex(diag?0x9cc8ff:0x5a7090);pickHi.material.opacity=diag?0.34:0.16;pickHi.visible=true;
  initTip.innerHTML = diag
    ? 'start state &nbsp;<b style="color:#9cc8ff">|'+ketStr(r)+'⟩</b>'+(r===initBasis?' <span style="color:#64c864">(current)</span>':'')+'<div style="color:#7a8aa6;font-size:0.58rem;margin-top:3px">click to begin the circuit here</div>'
    : '⟨'+ketStr(r)+'|ρ₀|'+ketStr(c)+'⟩ coherence<div style="color:#7a8aa6;font-size:0.58rem;margin-top:3px">pick a diagonal cell to set the start state</div>';
  initTip.style.display='block';const pad=15,w=initTip.offsetWidth,h=initTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;if(x+w>innerWidth-6)x=e.clientX-pad-w;if(y+h>innerHeight-6)y=e.clientY-pad-h;
  initTip.style.left=x+'px';initTip.style.top=y+'px';
}
// Picker pointer wiring: hover previews a start state; a click (not a drag) on a
// diagonal cell sets |b⟩ and rebuilds from there. The press/release distance test
// separates a pick from an orbit drag.
canvas.addEventListener('pointermove',onInitMove);
canvas.addEventListener('pointerleave',hideInitHover);
canvas.addEventListener('pointerdown',e=>{_downXY=[e.clientX,e.clientY];});
canvas.addEventListener('pointerup',e=>{if(!_downXY)return;const dx=e.clientX-_downXY[0],dy=e.clientY-_downXY[1];_downXY=null;
  if(dx*dx+dy*dy>25)return;                       // drag = orbit, not a pick
  const rc=pickRC(e);if(rc&&rc.r===rc.c){initBasis=rc.r;rebuild(true);VS.stageTime=0;VS.frameIndex=0;onInitMove(e);}
});

// Boot: size to the host, clamp selections, load the default algorithm, start the loop.
resize();clampQ();loadPreset('qft');requestAnimationFrame(loop);
