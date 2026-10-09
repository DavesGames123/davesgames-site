// ============================================================================
//  CIRCULAR RYDBERG  ·  data.js — facts, sources, timeline, saver plan
// ----------------------------------------------------------------------------
//  Every number of the page comes from here, and each names its source id.
//  The paper (Pultinevicius et al., Nat. Commun. 17, 9834, 2026) and its
//  dataset on Zenodo are both CC BY 4.0. The page tells the results in its
//  own words and redraws every figure from the stated numbers and from the
//  physics in physics.js; no figure image is copied.
//  DOIs were checked once on 2026-10-09 (Crossref, DataCite for Zenodo).
//
//  GREP MAP
//    export const PAPER ...... the paper's numbers
//    export const MEASURED ... lifetimes per n from the published dataset
//    export const SOURCES .... references with DOIs
//    export const TIMELINE ... the history of circular states
//    export function shotPlan  seeded saver order
// ============================================================================

export const PAPER = {
  src: 'pult26',
  species: '88Sr',
  nStart: 79, nMax: 103,             // coherent ladder |79C> -> |103C>
  ladderStep: 2,                      // two-photon Landau-Zener steps, n -> n+2
  pulses: 12,                         // up to 12 microwave pulses
  ladderTimeUs: 400,                  // coherent transfer up to n = 101
  stepFidelity: 0.94,                 // mean per Landau-Zener step
  plateGapMm: 10.5, plateGapErrMm: 0.2,
  reflectivity: 0.96,                 // ITO, microwave
  ringRadiusMm: 12,                   // inner radius of the ring electrodes
  holdFieldVcm: 5.9, magneticG: 1.5,
  tau101Ms: 11.5, tau101ErrMs: 0.8,   // |101C>, room temperature
  tauFree101Us: 545,                  // calculated, free space, 300 K
  enhancement: 21,                    // tau101 / tauFree101
  equivalentK: 14,                    // free space would need a 14 K environment
  trapMs: 133, trapErrMs: 6,          // 1/e tweezer trap lifetime from |97C>
  untrappedMs: 1,                     // tweezer off: signal gone within ~1 ms
  diameterUm: 1.1,                    // orbit diameter at n = 103
  lowLLifetimeUs: 100,                // S and D Rydberg levels, order of magnitude
  t2Us: 100,                          // current coherence limit (technical)
  realizations: 4000,                 // shots per hold time in the lifetime data
  blockadeGain: 1000, exchangeGain: 10, // vs circular atoms at n ~ 50
};

// Fitted lifetimes (ms, 1 sigma) per n, read from the dataset
// (qutip_fit_lifetimes_standard of each run in RIDs_fit of
// figures/plot_lifetimes.py). The paper quotes 11.5(8) ms for n = 101;
// this fit file gives 11.7(8) ms.
export const MEASURED = [
  [81, 3.83, 0.33], [83, 4.59, 0.50], [85, 5.73, 0.59], [87, 5.82, 0.51],
  [89, 2.59, 0.28], [91, 3.18, 0.25], [93, 3.86, 0.28], [95, 9.77, 1.18],
  [97, 11.25, 1.12], [99, 11.35, 1.42], [101, 11.67, 0.79],
];

export const SOURCES = {
  pult26: { cite: 'Pultinevicius, Götzelmann, Thielemann, Hölzl & Meinert, “Long-lived giant circular Rydberg atoms at room temperature”, Nature Communications 17, 9834 (2026). CC BY 4.0.', doi: '10.1038/s41467-026-77764-x' },
  zen26: { cite: 'Pultinevicius et al., data and scripts for the paper above, Zenodo (2026). CC BY 4.0.', doi: '10.5281/zenodo.20842521' },
  phys26: { cite: 'J. Witte (University of Stuttgart), “Circular Rydberg atoms set three records, staying stable for 11 milliseconds”, Phys.org, 16 September 2026.', url: 'https://phys.org/news/2026-09-circular-rydberg-atoms-staying-stable.html' },
  bohr13: { cite: 'N. Bohr, “On the constitution of atoms and molecules”, Philosophical Magazine 26, 1 (1913).', doi: '10.1080/14786441308634955' },
  klep81: { cite: 'D. Kleppner, “Inhibited spontaneous emission”, Physical Review Letters 47, 233 (1981).', doi: '10.1103/physrevlett.47.233' },
  vaid81: { cite: 'A. G. Vaidyanathan, W. P. Spencer & D. Kleppner, “Inhibited absorption of blackbody radiation”, Physical Review Letters 47, 1592 (1981).', doi: '10.1103/PhysRevLett.47.1592' },
  hk83: { cite: 'R. G. Hulet & D. Kleppner, “Rydberg atoms in “circular” states”, Physical Review Letters 51, 1430 (1983).', doi: '10.1103/PhysRevLett.51.1430' },
  gall94: { cite: 'T. F. Gallagher, Rydberg Atoms (Cambridge University Press, 1994).', doi: '10.1017/CBO9780511524530' },
  saff10: { cite: 'M. Saffman, T. G. Walker & K. Mølmer, “Quantum information with Rydberg atoms”, Reviews of Modern Physics 82, 2313 (2010).', doi: '10.1103/RevModPhys.82.2313' },
  har13: { cite: 'S. Haroche, “Nobel lecture: Controlling photons in a box and exploring the quantum to classical boundary”, Reviews of Modern Physics 85, 1083 (2013).', doi: '10.1103/RevModPhys.85.1083' },
  ngu18: { cite: 'T. L. Nguyen et al., “Towards quantum simulation with circular Rydberg atoms”, Physical Review X 8, 011032 (2018).', doi: '10.1103/PhysRevX.8.011032' },
  can20: { cite: 'T. Cantat-Moltrecht et al., “Long-lived circular Rydberg states of laser-cooled rubidium atoms in a cryostat”, Physical Review Research 2, 022032 (2020).', doi: '10.1103/physrevresearch.2.022032' },
  mei20: { cite: 'F. Meinert et al., “Indium tin oxide films meet circular Rydberg atoms: prospects for novel quantum simulation schemes”, Physical Review Research 2, 023192 (2020).', doi: '10.1103/physrevresearch.2.023192' },
  coh21: { cite: 'S. R. Cohen & J. D. Thompson, “Quantum computing with circular Rydberg atoms”, PRX Quantum 2, 030322 (2021).', doi: '10.1103/PRXQuantum.2.030322' },
  muni22: { cite: 'A. Muni et al., “Optical coherent manipulation of alkaline-earth circular Rydberg states”, Nature Physics 18, 502 (2022).', doi: '10.1038/s41567-022-01519-w' },
  wu23: { cite: 'H. Wu, R. Richaud, J.-M. Raimond, M. Brune & S. Gleyzes, “Millisecond-lived circular Rydberg atoms in a room-temperature experiment”, Physical Review Letters 130, 023202 (2023).', doi: '10.1103/physrevlett.130.023202' },
  rav23: { cite: 'B. Ravon et al., “Array of individual circular Rydberg atoms trapped in optical tweezers”, Physical Review Letters 131, 093401 (2023).', doi: '10.1103/PhysRevLett.131.093401' },
  hol24: { cite: 'C. Hölzl, A. Götzelmann, E. Pultinevicius, M. Wirth & F. Meinert, “Long-lived circular Rydberg qubits of alkaline-earth atoms in optical tweezers”, Physical Review X 14, 021024 (2024).', doi: '10.1103/physrevx.14.021024' },
  meh25: { cite: 'P. Méhaignerie et al., “Interacting circular Rydberg atoms trapped in optical tweezers”, PRX Quantum 6, 010353 (2025).', doi: '10.1103/PRXQuantum.6.010353' },
};

export const TIMELINE = [
  { y: 1913, t: 'Bohr’s circular orbits', d: 'Bohr pictures the electron of hydrogen on circular orbits of radius n² a₀. Quantum mechanics later replaces the orbits with clouds, but the state with the largest angular momentum keeps Bohr’s ring shape.', src: 'bohr13' },
  { y: 1981, t: 'Inhibited emission and absorption', d: 'Kleppner shows that a cavity smaller than half a wavelength can switch off the emission of an atom. The same year his group shows that blackbody absorption can be suppressed too.', src: 'klep81' },
  { y: 1983, t: 'The first circular states', d: 'Hulet and Kleppner make circular Rydberg states in the laboratory, with crossed electric and magnetic fields.', src: 'hk83' },
  { y: 2012, t: 'Photons in a box', d: 'Serge Haroche shares the Nobel Prize for counting microwave photons with circular Rydberg atoms flying through a superconducting cavity at a temperature below 1 K.', src: 'har13' },
  { y: 2018, t: 'A plan for quantum simulation', d: 'Nguyen and coworkers propose quantum simulators of long-lived circular atoms, held in place and protected from blackbody light.', src: 'ngu18' },
  { y: 2020, t: 'Cold and long-lived', d: 'Laser-cooled rubidium circular atoms live for milliseconds in a cryostat.', src: 'can20' },
  { y: 2021, t: 'Quantum computing proposal', d: 'Cohen and Thompson propose a quantum computer of circular states of alkaline-earth atoms.', src: 'coh21' },
  { y: 2022, t: 'Alkaline-earth circular states', d: 'Strontium circular states are controlled optically through the second, inner electron.', src: 'muni22' },
  { y: 2023, t: 'Room temperature, tweezers', d: 'Millisecond circular atoms in a room-temperature setup, and the first array of circular atoms held in optical tweezers.', src: 'wu23' },
  { y: 2024, t: 'Circular qubits of strontium', d: 'The Stuttgart group traps strontium circular atoms at n = 79 in standard tweezers and uses them as qubits.', src: 'hol24' },
  { y: 2025, t: 'Interacting circular atoms', d: 'Two trapped circular atoms near n = 50 interact under control.', src: 'meh25' },
  { y: 2026, t: 'Giant, room temperature, 11 ms', d: 'Strontium circular atoms up to n = 103 live for more than 10 ms between two transparent mirrors at room temperature.', src: 'pult26' },
];

// Saver order: a seeded shuffle with no kind twice in a row; each shot
// 6 to 12 s (longer when calm).
export const SHOT_KINDS = ['grow', 'morph', 'packet', 'ladder', 'cascade', 'lifetime', 'compare'];
export function shotPlan(seed = 1, count = 48, calm = 0.6) {
  let s = (seed >>> 0) || 1;
  const R = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [];
  let bag = [];
  while (out.length < count) {
    if (!bag.length) { bag = SHOT_KINDS.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    let k = bag.findIndex(x => !out.length || x !== out[out.length - 1].id);
    if (k < 0) k = 0;
    const id = bag.splice(k, 1)[0];
    out.push({ id, sec: 6 + 6 * Math.min(1, 0.35 * calm + 0.65 * R()), seed: Math.floor(R() * 1e9) });
  }
  return out;
}
