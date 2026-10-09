// ============================================================================
//  NEURON LAB ENGINE  ·  shots.js  ·  screensaver shot bags and plates
// ----------------------------------------------------------------------------
//  Pure data and one planner, shared by the two pages and tests.mjs.
//  A plan is a seeded shuffle of a bag of shots. Each pass of the bag is a
//  new shuffle, and a pass never starts with the shot that ended the last
//  one, so no shot plays twice in a row. Each shot lasts 6 to 12 s.
//  The plates hold TeX and plain lines only, no code.
//
//  grep -n targets
//    "export const LAB_SHOTS"   Neuron Lab shots and plates
//    "export const NET_SHOTS"   Neural Network shots and plates
//    "export function shotPlan" the planner
// ============================================================================
import { rng } from './rng.js';

const CABLE = 'c_m \\frac{\\partial V}{\\partial t} = \\frac{d}{4 R_a} \\frac{\\partial^2 V}{\\partial x^2} - i_{ion}';
const HHI = 'i_{ion} = \\bar g_{Na} m^3 h (V - E_{Na}) + \\bar g_K n^4 (V - E_K) + g_L (V - E_L)';
const GATE = '\\frac{dn}{dt} = \\alpha_n(V)(1 - n) - \\beta_n(V)\\, n';
const RULES = [['V', 'm1'], ['m', 'm2'], ['h', 'm3'], ['n', 'm4'], ['R_a', 'm5']];

export const LAB_SHOTS = [
  { id: 'bap', title: 'A spike runs back into the dendrites', sub: 'back-propagation from the soma, fading with distance', tex: [CABLE], rules: RULES },
  { id: 'orbit', title: 'One cell, many compartments', sub: 'the Hines method solves the whole tree each step', tex: ['\\left(\\frac{C}{\\Delta t} + G\\right) \\Delta V = I'], rules: RULES },
  { id: 'synapse', title: 'Synaptic input far out on a branch', sub: 'an Exp2Syn conductance, filtered by the cable on its way in', tex: ['g(t) = \\bar g\\,\\left(e^{-t/\\tau_2} - e^{-t/\\tau_1}\\right)'], rules: [['\\tau_1', 'm2'], ['\\tau_2', 'm3']] },
  { id: 'phase', title: 'The Hodgkin-Huxley limit cycle', sub: 'membrane voltage against potassium activation n', tex: [GATE], rules: RULES },
  { id: 'gates', title: 'Three gates, one spike', sub: 'sodium opens fast (m), closes slowly (h); potassium follows (n)', tex: [HHI], rules: RULES },
  { id: 'axon', title: 'Down the axon', sub: 'conduction speed grows as the square root of diameter', tex: ['\\theta \\propto \\sqrt{d}'], rules: [['d', 'm5']] },
];

export const NET_SHOTS = [
  { id: 'avalanche', title: 'An avalanche through the column', sub: 'a burst at one point spreads along NetCons with axonal delay', tex: ['t_{arrive} = t_{spike} + \\delta_{syn} + \\frac{\\ell}{\\theta}'], rules: [['\\ell', 'm2'], ['\\theta', 'm1']] },
  { id: 'score', title: 'The raster as a score', sub: 'one row per cell, one mark per spike', tex: ['r(t) = \\frac{1}{N \\Delta t} \\sum_i \\sum_k \\mathbf{1}[t \\le t_i^k < t + \\Delta t]'], rules: [['r', 'm1']] },
  { id: 'orbit', title: 'Gamma from pyramids and interneurons', sub: 'PING: E drives I, I silences E, the cycle repeats', tex: ['T_{\\gamma} \\approx \\delta_{EI} + \\delta_{IE} + \\tau_{GABA} \\ln\\frac{g_I}{g_\\theta}'], rules: [['\\tau_{GABA}', 'm3']] },
  { id: 'close', title: 'Inside the column', sub: 'each flash is one spike, each streak one NetCon event in flight', tex: ['\\frac{dg}{dt} = -\\frac{g}{\\tau}, \\quad g \\leftarrow g + w'], rules: [['w', 'm2'], ['\\tau', 'm3']] },
  { id: 'ring', title: 'A wave that runs round a ring', sub: 'local excitation forward, inhibition behind', tex: ['v_{wave} \\approx \\frac{\\sigma}{\\delta + t_{rise}}'], rules: [['\\sigma', 'm2']] },
];

export function shotPlan(bag, seed, n = 40, calm = 0.7, lo = 6, hi = 12) {
  const R = rng((seed >>> 0) + 4099), out = [];
  while (out.length < n) {
    const pass = bag.map(s => s.id);
    for (let k = pass.length - 1; k > 0; k--) { const m = Math.floor(R() * (k + 1)); [pass[k], pass[m]] = [pass[m], pass[k]]; }
    if (out.length && pass.length > 1 && pass[0] === out[out.length - 1].id) [pass[0], pass[1]] = [pass[1], pass[0]];
    for (const id of pass) out.push({ id, sec: lo + (hi - lo) * Math.min(1, 0.3 * calm + 0.7 * R()), seed: Math.floor(R() * 1e9) });
  }
  return out.slice(0, n);
}
