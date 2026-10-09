// ============================================================================
//  NEURON LAB ENGINE  ·  random.js  ·  seeded randomisation by category
// ----------------------------------------------------------------------------
//  Four categories, each with its own seed, so that a lock on one category
//  keeps its values while the others change, and a URL hash with the four
//  seeds (and any changed ranges) gives the same lab on every machine:
//    morph  cell type mix and the shape factors of morph.js
//    bio    channel densities, Ra, cm, temperature, leak reversal, Ih
//    stim   random IClamps, synapses with NetStim trains, Poisson inputs
//    wire   cell count, placement, wiring preset, p, weights, velocity
//  Each numeric key is uniform in [lo, hi] (int keys round). Choice keys
//  pick one of their choices. A key that is off keeps its default.
//  The default ranges stay in physiological bounds; tests.mjs checks that
//  every sample is in range, that a seed repeats, and that every random
//  cell fires under stdStimulus.
//
//  grep -n targets
//    "export const CATS"          category ids and labels
//    "export const RANGES"        every key: label, lo, hi, unit, default
//    "export function sample"     (cat, seed, ranges) -> values
//    "export function catSeed"    master seed -> the seed of one category
//    "export function densFrom"   bio values -> the dens(sec) of cell.js
//    "export function cellOpts"   bio values -> Cell options
//    "export function stdStimulus" the soma pulse that must fire any cell
// ============================================================================
import { rng } from './rng.js';
import { HH, NRN } from './hh.js';

export const CATS = [
  { id: 'morph', label: 'Shape', note: 'cell types and how the branches grow' },
  { id: 'bio', label: 'Biophysics', note: 'channels, cable, temperature' },
  { id: 'stim', label: 'Stimulation', note: 'clamps, synapse trains, Poisson input' },
  { id: 'wire', label: 'Network', note: 'cell count, placement, wiring' },
];
export const TYPES = ['pyramidal', 'purkinje', 'motor', 'granule'];
export const LAYOUTS = ['line', 'ring', 'layer', 'cluster'];
export const PRESETS = ['chain', 'ring', 'all', 'ff', 'random', 'ei', 'loop'];

// d: the value when the key is off (the page default)
export const RANGES = {
  morph: {
    types: { label: 'Cell types', choices: TYPES, d: 'pyramidal', multi: true },
    soma: { label: 'Soma size', lo: 0.75, hi: 1.35, d: 1, unit: '×' },
    branches: { label: 'Branch count', lo: 0.6, hi: 1.6, d: 1, unit: '×' },
    depth: { label: 'Branch levels', lo: -1, hi: 1, d: 0, int: true, unit: '+' },
    angle: { label: 'Branch angle', lo: 0.5, hi: 1.6, d: 1, unit: '×' },
    taper: { label: 'Taper', lo: 0.88, hi: 1.12, d: 1, unit: '×' },
    length: { label: 'Dendrite length', lo: 0.6, hi: 1.5, d: 1, unit: '×' },
    tortuosity: { label: 'Tortuosity', lo: 0.3, hi: 3, d: 1, unit: '×' },
    spines: { label: 'Spines', lo: 0, hi: 2, d: 0, unit: '/µm' },
    axon: { label: 'Axon length', lo: 0.5, hi: 2, d: 1, unit: '×' },
    collaterals: { label: 'Collaterals', lo: 0, hi: 4, d: 2, int: true, unit: '' },
  },
  bio: {
    gna: { label: 'ḡNa soma, axon', lo: 0.1, hi: 0.2, d: 0.12, unit: 'S/cm²' },
    gk: { label: 'ḡK soma, axon', lo: 0.025, hi: 0.05, d: 0.036, unit: 'S/cm²' },
    dfrac: { label: 'Dendrite channels', lo: 0, hi: 0.6, d: 0.3, unit: '×' },
    gl: { label: 'g leak', lo: 0.0001, hi: 0.0005, d: 0.0003, unit: 'S/cm²' },
    el: { label: 'E leak', lo: -62, hi: -50, d: HH.el, unit: 'mV' },
    Ra: { label: 'Ra', lo: 50, hi: 200, d: NRN.Ra, unit: 'Ω cm' },
    cm: { label: 'cm', lo: 0.75, hi: 1.25, d: 1, unit: 'µF/cm²' },
    celsius: { label: 'Temperature', lo: 6.3, hi: 18, d: 6.3, unit: '°C' },
    gih: { label: 'Ih (HCN)', lo: 0, hi: 0.0003, d: 0, unit: 'S/cm²' },
  },
  stim: {
    nclamp: { label: 'IClamps', lo: 0, hi: 3, d: 1, int: true, unit: '' },
    amp: { label: 'Clamp amplitude', lo: 0.6, hi: 2, d: 1, unit: '× rheobase' },
    nsyn: { label: 'Synapses', lo: 0, hi: 6, d: 0, int: true, unit: '' },
    wsyn: { label: 'Synapse weight', lo: 0.005, hi: 0.05, d: 0.02, unit: 'µS' },
    rate: { label: 'Train rate', lo: 10, hi: 80, d: 40, unit: 'Hz' },
    number: { label: 'Spikes per train', lo: 2, hi: 10, d: 3, int: true, unit: '' },
    noise: { label: 'Poisson share', lo: 0, hi: 1, d: 0, unit: '' },
  },
  wire: {
    count: { label: 'Cells', lo: 3, hi: 8, d: 6, int: true, unit: '' },
    layout: { label: 'Placement', choices: LAYOUTS, d: 'ring' },
    preset: { label: 'Wiring', choices: PRESETS, d: 'chain' },
    p: { label: 'p (random)', lo: 0.15, hi: 0.5, d: 0.3, unit: '' },
    wE: { label: 'E weight', lo: 0.6, hi: 2, d: 1.2, unit: '× threshold' },
    wI: { label: 'I weight', lo: 0.6, hi: 3, d: 1.5, unit: '× threshold' },
    fracE: { label: 'E share', lo: 0.6, hi: 0.9, d: 0.8, unit: '' },
    velocity: { label: 'Conduction', lo: 0.2, hi: 1, d: 0.3, unit: 'm/s' },
  },
};

// A different stream per category from one master seed.
const CAT_SALT = { morph: 0x9e3779b1, bio: 0x85ebca77, stim: 0xc2b2ae3d, wire: 0x27d4eb2f };
export function catSeed(master, cat) { return ((Math.imul((master >>> 0) || 1, 2654435761) ^ CAT_SALT[cat]) >>> 0) % 999983 + 1; }

export function defaults(cat) { const o = {}; for (const [k, r] of Object.entries(RANGES[cat])) o[k] = r.multi ? [r.d] : r.d; return o; }

// ranges: { key: { lo, hi, on, choices } } overrides of RANGES[cat]. Returns values.
export function sample(cat, seed, ranges = {}) {
  const R = rng(seed * 2246822519 + 7), out = {};
  for (const [k, r0] of Object.entries(RANGES[cat])) {
    const r = { ...r0, ...(ranges[k] || {}) };
    const u = R(); // one draw per key, used or not, so a toggle does not shift the other keys
    if (r.on === false) { out[k] = r0.multi ? [r0.d] : r0.d; continue; }
    if (r.choices) {
      const ch = r.choices.length ? r.choices : r0.choices;
      out[k] = r.multi ? ch.slice() : ch[Math.min(ch.length - 1, Math.floor(u * ch.length))];
    } else {
      let v = r.lo + (r.hi - r.lo) * u;
      if (r.int) v = Math.round(v);
      out[k] = v;
    }
  }
  return out;
}

// Pick a cell type from a morph sample for cell number i (a mix when several are on).
export function typeFor(morph, i, seed = 1) {
  const T = morph.types && morph.types.length ? morph.types : ['pyramidal'];
  if (T.length === 1) return T[0];
  const R = rng(seed * 31 + i * 977 + 3); R();
  return T[Math.floor(R() * T.length)];
}
// The morph.js factors from a morph sample. Each cell i of a network gets a
// small extra jitter so that no two cells are copies.
export function morphFactors(morph, i = 0, seed = 1) {
  const f = { soma: morph.soma, branches: morph.branches, depth: morph.depth, angle: morph.angle, taper: morph.taper, length: morph.length, tortuosity: morph.tortuosity, spines: morph.spines, axon: morph.axon, collaterals: morph.collaterals };
  if (i > 0) { const R = rng(seed * 17 + i * 7907); for (const k of ['soma', 'branches', 'angle', 'length']) f[k] *= 0.92 + 0.16 * R(); }
  return f;
}

// dens(sec) for cell.js: soma and axon full, AIS twice, dendrites dfrac.
export function densFrom(b, o = {}) {
  return s => {
    const k = s.kind, f = k === 'soma' || k === 'axon' ? 1 : k === 'ais' ? 2 : b.dfrac;
    const dend = k === 'dend' || k === 'apical' || k === 'tuft';
    return { gnabar: o.ttx ? 0 : b.gna * f, gkbar: o.tea ? 0 : b.gk * Math.min(1, f), gl: b.gl, el: b.el, gih: (b.gih || 0) * (dend ? 1.5 : k === 'soma' ? 1 : 0) };
  };
}
export function cellOpts(b, extra = {}) { return { Ra: b.Ra, cm: b.cm, celsius: b.celsius, dens: densFrom(b, extra), ...extra }; }

// The soma pulse used by the tests and the network "kick": scaled by the
// soma area of the type and the soma factor, so every random cell fires.
export const BASE_AMP = { pyramidal: 1.5, purkinje: 2.5, motor: 6, granule: 0.15 };
export function stdStimulus(type, morph = {}) { const s = morph.soma ?? 1; return { amp: 3.5 * BASE_AMP[type] * Math.max(1, s * s), dur: 3 }; }

// Random stimulation for one cell: [{ kind: 'iclamp' | 'syn', node, ... }]
// with nodes picked from the cell. type sets the clamp scale.
export function stimPlan(st, cell, type, seed = 1) {
  const R = rng(seed * 131 + 11), out = [], n = cell.n;
  const dend = []; for (let i = 0; i < n; i++) { const k = cell.sections[cell.sec[i]].kind; if (k === 'dend' || k === 'apical' || k === 'tuft') dend.push(i); }
  for (let c = 0; c < st.nclamp; c++) {
    const node = c === 0 || !dend.length ? 0 : dend[Math.floor(R() * dend.length)];
    out.push({ kind: 'iclamp', node, amp: BASE_AMP[type] * st.amp * (node ? 1.5 : 1), del: 2 + R() * 30, dur: 1 + R() * 4 });
  }
  for (let s = 0; s < st.nsyn && dend.length; s++) {
    out.push({ kind: 'syn', node: dend[Math.floor(R() * dend.length)], weight: st.wsyn, interval: 1000 / st.rate, number: st.number, noise: st.noise, start: 2 + R() * 30 });
  }
  return out;
}
