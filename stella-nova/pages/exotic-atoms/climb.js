// ============================================================================
//  EXOTIC ATOMS  ·  climb.js — up the energy ladder one photon at a time
// ----------------------------------------------------------------------------
//  A climb is a list of single-photon absorptions from the ground state
//  (or the crystal ground state, for the exciton) up to a top n, and then
//  one photon past the ionization limit. Each step obeys the electric
//  dipole rules |dl| = 1, dm in {-1, 0, +1}, and its photon energy is the
//  difference of the two level energies of physics.js energyEV.
//
//  Variants (CLIMBS):
//    circ    hydrogen, the yrast ladder 1s -> 2p -> 3d -> 4f ...: every
//            step is n -> n+1, l -> l+1, m -> m+1 (sigma+). Each state on
//            it is circular. The photons go UV (121.6 nm), visible
//            (656 nm, H-alpha), infrared, terahertz, microwave, radio.
//    lowl    hydrogen, s and p only: 1s -> 2p -> 3s -> 4p ... (pi, dm = 0)
//    rb      rubidium: 5S -> 5P (780 nm) -> one blue photon to 20S,
//            then microwaves nS -> nP -> (n+1)S ... (quantum defects)
//    ps      positronium, the yrast ladder: every photon half the energy
//    muh     muonic hydrogen, the yrast ladder: 1s -> 2p is an X-ray
//    exc     Cu2O exciton: one yellow photon makes 2P from the crystal,
//            then terahertz steps P -> D -> F ... up to n = 30
//    bfield  the hydrogen yrast ladder with the orbital field drawn
//  The ladder of the circular-Rydberg experiment (pages/circular-rydberg)
//  climbs |nC> -> |n+2 C> by two-photon microwave steps; here every step
//  is one photon.
//
//  LIMITS (limitsAt): what stops a climb at each scale
//    blackbody   photons per mode at the next step, nbar(f, 300 K), and
//                the Cooke-Gallagher rate 4 alpha^3 kT / (3 n^2)
//    stray field the Inglis-Teller n for a stray field (default 10 mV/cm)
//    crowding    the atom against the mean spacing of a cold gas
//                (1e11 cm^-3) and of room air (2.5e19 cm^-3)
//    lifetime    the lifetime at 300 K against the climb time, with an
//                assumed 1 us per microwave pi pulse
//    ionization  the binding energy and the field that ionizes the atom
//
//  GREP MAP
//    export const CLIMBS ...... variants
//    export function climbSteps  the ladder of a variant up to nTop
//    export function limitsAt .. what limits the atom at n
//    export const SCALES ...... real-world sizes for the plate and ruler
//    export function scaleLabel  "about the size of ..."
//    export function fmtLen / fmtHz / fmtTime / fmtEV  readout text
// ============================================================================
import { SPECIES, C, units, energyEV, bindingEV, transition, sizeM, inglisTeller, inglisTellerN, ionField, bbrRate, lifetime, nStar } from './physics.js';
import { lifetime as circLifetime } from '../circular-rydberg/physics.js';

export const CLIMBS = {
  circ: { id: 'circ', sp: 'H', rule: 'yrast', title: 'Hydrogen, circular ladder', tops: [50, 100, 200, 300] },
  lowl: { id: 'lowl', sp: 'H', rule: 'sp', title: 'Hydrogen, s and p ladder', tops: [50, 100, 200] },
  rb: { id: 'rb', sp: 'Rb', rule: 'alkali', title: 'Rubidium, quantum-defect ladder', tops: [60, 100, 160] },
  ps: { id: 'ps', sp: 'Ps', rule: 'yrast', title: 'Positronium, circular ladder', tops: [50, 100, 200] },
  muh: { id: 'muh', sp: 'muH', rule: 'yrast', title: 'Muonic hydrogen, circular ladder', tops: [40, 100] },
  exc: { id: 'exc', sp: 'X', rule: 'exciton', title: 'Cu₂O exciton, terahertz ladder', tops: [25, 30] },
  bfield: { id: 'bfield', sp: 'H', rule: 'yrast', field: true, title: 'Circular ladder with its magnetic field', tops: [40, 80, 150] },
};

const step = (sp, a, b, kind) => {
  const t = transition(sp, a[0], a[1], b[0], b[1]);
  return { from: a, to: b, dl: b[1] - a[1], dm: b[2] - a[2], kind, ...t, sizeM: b[0] ? sizeM(sp, b[0], b[1]) : 0 };
};
const kindOf = lam => lam < 1e-6 ? 'laser' : lam < 1e-3 ? 'terahertz' : 'microwave';

// The ladder of a variant up to nTop: [{ from: [n,l,m], to: [n,l,m], dl, dm,
// eV, lam, hz, band, kind, sizeM }]. Each step absorbs one photon.
export function climbSteps(id, nTop) {
  const v = CLIMBS[id], sp = SPECIES[v.sp], out = [];
  if (v.rule === 'yrast') {
    for (let n = 1; n < nTop; n++) out.push(step(sp, [n, n - 1, n - 1], [n + 1, n, n], n < 3 ? 'laser' : null));
  } else if (v.rule === 'sp') {
    let a = [1, 0, 0];
    for (let n = 2; n <= nTop; n++) { const b = [n, a[1] ? 0 : 1, 0]; out.push(step(sp, a, b, null)); a = b; }
  } else if (v.rule === 'alkali') {
    const n0 = sp.nMin, nR = 20;
    out.push(step(sp, [n0, 0, 0], [n0, 1, 0], 'laser'));
    out.push(step(sp, [n0, 1, 0], [nR, 0, 0], 'laser'));
    for (let n = nR; n < nTop; n++) { out.push(step(sp, [n, 0, 0], [n, 1, 0], null)); out.push(step(sp, [n, 1, 0], [n + 1, 0, 0], null)); }
  } else if (v.rule === 'exciton') {
    out.push(step(sp, [0, 0, 0], [2, 1, 1], 'laser'));
    for (let n = 2; n < nTop; n++) out.push(step(sp, [n, n - 1, n - 1], [n + 1, n, n], null));
  }
  for (const s of out) if (!s.kind) s.kind = kindOf(s.lam);
  return out;
}
// the last photon of a climb: from the top state into the continuum, with
// a kinetic energy of a quarter of the binding (any amount works)
export function ionizeStep(id, top) {
  const sp = SPECIES[CLIMBS[id].sp], b = bindingEV(sp, top[0], top[1]), eV = b * 1.25, lam = C.hc_eVm / eV;
  return { from: top, to: null, eV, lam, hz: eV / C.hartreeEV * C.hartreeHz, band: lamBand(lam), kind: kindOf(lam), binding: b };
}
const lamBand = lam => lam < 1e-8 ? 'X-ray' : lam < 3.8e-7 ? 'UV' : lam < 7.8e-7 ? 'visible' : lam < 3e-5 ? 'infrared' : lam < 1e-3 ? 'terahertz' : lam < 1 ? 'microwave' : 'radio';

// ---------------------------------------------------------------- limits
const nbar = (hz, T) => { const x = 6.62607015e-34 * hz / (1.380649e-23 * T); return x > 700 ? 0 : 1 / Math.expm1(x); };
export const GAS = { cold: 1e11, air: 2.5e19 };      // cm^-3
export const spacingM = dens => Math.pow(dens * 1e6, -1 / 3);
// assumed time per absorption: a pulsed laser step 10 ns, a terahertz
// step 100 ns, a microwave pi pulse 1 us (typical, not from one paper)
export const STEP_S = { laser: 1e-8, terahertz: 1e-7, microwave: 1e-6 };
export const climbTime = steps => steps.reduce((s, x) => s + (STEP_S[x.kind] || 1e-6), 0);
// What limits the atom at n (state n, l). opts: T (K), stray (V/cm),
// climbS (time spent climbing so far; default: the hydrogen yrast ladder).
export function limitsAt(spId, n, l, { T = 300, stray = 0.01, climbS = null } = {}) {
  const sp = SPECIES[spId], u = units(sp), ns = nStar(sp, n, l);
  const next = sp.kind === 'qd' ? transition(sp, n, l, n + (l ? 1 : 0), l ? 0 : 1) : transition(sp, n, l, n + 1, Math.min(l + 1, n));
  const size = 2 * sizeM(sp, n, l);                    // diameter
  let tau;
  if (sp.id === 'H' || sp.id === 'antiH') tau = l === n - 1 && n > 1 && n <= 400 ? circLifetime(n, { T, up: 2 }) : lifetime(sp, n, l, T).s;
  else tau = lifetime(sp, n, l, T).s;
  return {
    n, l, size,
    binding: bindingEV(sp, n, l),
    nextHz: next.hz, nbar: nbar(next.hz, T),
    bbr: bbrRate(sp, n, l, T),
    fIT: inglisTeller(sp, ns), nIT: inglisTellerN(sp, stray), stray,
    fIon: ionField(sp, n, l),
    cold: size / spacingM(GAS.cold), air: size / spacingM(GAS.air),
    tau, climb: climbS == null ? (climbS = yrastTime(spId, n)) : climbS, tauVsClimb: tau / climbS,
  };
}
function yrastTime(spId, n) {
  let t = 0;
  for (let k = 1; k < n; k++) { const tr = transition(spId, k, k - 1, k + 1, k); t += STEP_S[kindOf(tr.lam)] || 1e-6; }
  return t;
}
// which limit bites first at n (for the plate): returns a short phrase
export function worstLimit(L) {
  if (L.n > L.nIT) return `levels merge: n > ${Math.round(L.nIT)} at ${L.stray * 1000} mV/cm (Inglis–Teller)`;
  if (L.cold > 1) return 'the atom is wider than the gap between atoms of a cold gas';
  if (L.tauVsClimb < 3) return 'it decays about as fast as it climbs';
  if (L.nbar > 1) return `blackbody photons: ${L.nbar.toFixed(0)} per mode at the next step`;
  return 'nothing yet: the next photon still wins';
}

// ---------------------------------------------------------------- scales
export const SCALES = [
  { id: 'proton', name: 'a proton', m: 1.68e-15 },
  { id: 'muh', name: 'muonic hydrogen', m: 5.7e-13 },
  { id: 'h1s', name: 'a hydrogen atom', m: 1.06e-10 },
  { id: 'dna', name: 'a DNA helix (width)', m: 2e-9 },
  { id: 'ribosome', name: 'a ribosome', m: 2.5e-8 },
  { id: 'virus', name: 'a flu virus', m: 1e-7 },
  { id: 'light', name: 'a wavelength of green light', m: 5.3e-7 },
  { id: 'bacterium', name: 'an E. coli bacterium', m: 2e-6 },
  { id: 'rbc', name: 'a red blood cell', m: 7.5e-6 },
  { id: 'hair', name: 'the width of a hair', m: 7e-5 },
];
export function scaleLabel(m) {
  let best = SCALES[0];
  for (const s of SCALES) if (Math.abs(Math.log(m / s.m)) < Math.abs(Math.log(m / best.m))) best = s;
  const r = m / best.m;
  if (r > 0.75 && r < 1.35) return `about the size of ${best.name}`;
  return r > 1 ? `${r.toFixed(r < 10 ? 1 : 0)}× ${best.name}` : `${(1 / r).toFixed(1 / r < 10 ? 1 : 0)}× smaller than ${best.name}`;
}

// ---------------------------------------------------------------- text
export function fmtLen(m) {
  if (m >= 1e-3) return `${(m * 1e3).toPrecision(3)} mm`;
  if (m >= 1e-6) return `${(m * 1e6).toPrecision(3)} µm`;
  if (m >= 1e-9) return `${(m * 1e9).toPrecision(3)} nm`;
  if (m >= 1e-12) return `${(m * 1e12).toPrecision(3)} pm`;
  return `${(m * 1e15).toPrecision(3)} fm`;
}
export function fmtHz(hz) {
  if (hz >= 1e15) return `${(hz / 1e15).toPrecision(3)} PHz`;
  if (hz >= 1e12) return `${(hz / 1e12).toPrecision(3)} THz`;
  if (hz >= 1e9) return `${(hz / 1e9).toPrecision(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toPrecision(3)} MHz`;
  return `${(hz / 1e3).toPrecision(3)} kHz`;
}
export function fmtTime(s) {
  if (!Number.isFinite(s)) return s === Infinity ? 'stable' : '—';
  if (s >= 1) return `${s.toPrecision(3)} s`;
  if (s >= 1e-3) return `${(s * 1e3).toPrecision(3)} ms`;
  if (s >= 1e-6) return `${(s * 1e6).toPrecision(3)} µs`;
  if (s >= 1e-9) return `${(s * 1e9).toPrecision(3)} ns`;
  return `${(s * 1e12).toPrecision(3)} ps`;
}
export function fmtEV(e) {
  const a = Math.abs(e);
  if (a >= 1e3) return `${(e / 1e3).toPrecision(4)} keV`;
  if (a >= 1) return `${e.toPrecision(4)} eV`;
  if (a >= 1e-3) return `${(e * 1e3).toPrecision(3)} meV`;
  return `${(e * 1e6).toPrecision(3)} µeV`;
}
// a wavelength as text, with the band
export function fmtLam(lam) { return fmtLen(lam).replace(' fm', ' fm'); }
export const fmtVcm = f => f >= 1e3 ? `${(f / 1e3).toPrecision(3)} kV/cm` : f >= 1 ? `${f.toPrecision(3)} V/cm` : `${(f * 1e3).toPrecision(3)} mV/cm`;
