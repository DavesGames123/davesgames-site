// ============================================================================
//  PARTICLE COLLIDER  ·  particles.js — the particle table
// ----------------------------------------------------------------------------
//  No DOM. Masses (MeV), charges (e) and mean lives (ns) are PDG 2024
//  values. cls is the display class: the event display, the 2D views and
//  the legend colour a track by cls, not by species.
//
//  PART[name] = { name, pdg, m, q, tau (ns, 0 = stable), cls, label }
//    cls: 'mu' 'e' 'gamma' 'had' (charged hadron) 'neu' (neutral hadron)
//         'nu' (invisible) 'res' (a resonance: never tracked)
//  CLASS_COLOR  the legend colours, shared by every view (grep CLASS_COLOR)
//  C_MM_NS      speed of light, mm/ns
// ============================================================================
export const C_MM_NS = 299.792458;

const P = (name, pdg, m, q, tau, cls, label) => ({ name, pdg, m, q, tau, cls, label });
export const PART = {
  gamma: P('gamma', 22, 0, 0, 0, 'gamma', 'γ'),
  'e-': P('e-', 11, 0.51099895, -1, 0, 'e', 'e⁻'),
  'e+': P('e+', -11, 0.51099895, 1, 0, 'e', 'e⁺'),
  'mu-': P('mu-', 13, 105.6583755, -1, 2196.9811, 'mu', 'μ⁻'),
  'mu+': P('mu+', -13, 105.6583755, 1, 2196.9811, 'mu', 'μ⁺'),
  'pi+': P('pi+', 211, 139.57039, 1, 26.033, 'had', 'π⁺'),
  'pi-': P('pi-', -211, 139.57039, -1, 26.033, 'had', 'π⁻'),
  pi0: P('pi0', 111, 134.9768, 0, 8.43e-8, 'gamma', 'π⁰'),
  'K+': P('K+', 321, 493.677, 1, 12.380, 'had', 'K⁺'),
  'K-': P('K-', -321, 493.677, -1, 12.380, 'had', 'K⁻'),
  K0S: P('K0S', 310, 497.611, 0, 0.08954, 'neu', 'K⁰_S'),
  K0L: P('K0L', 130, 497.611, 0, 51.16, 'neu', 'K⁰_L'),
  p: P('p', 2212, 938.27208816, 1, 0, 'had', 'p'),
  n: P('n', 2112, 939.56542052, 0, 0, 'neu', 'n'),
  // a generic B hadron: mass and mean life of the B0 (c tau = 0.455 mm)
  B: P('B', 511, 5279.66, 0, 1.519e-3, 'neu', 'B'),
  nu: P('nu', 12, 0, 0, 0, 'nu', 'ν'),
  // resonances, for the generators only
  Z: P('Z', 23, 91187.6, 0, 0, 'res', 'Z'),
  W: P('W', 24, 80377, 1, 0, 'res', 'W'),
  H: P('H', 25, 125250, 0, 0, 'res', 'H'),
  t: P('t', 6, 172500, 0, 0, 'res', 't'),
};
export const WIDTH = { Z: 2495.2, W: 2085, H: 3.2, t: 1420 };   // MeV

// Display classes: name, colour, and the legend line. 'shower' is not a
// species: the display uses it for e and gamma tracks born in a calorimeter.
export const CLASS_COLOR = {
  mu: '#ff4f7b', e: '#45f0b5', gamma: '#ffd45c', had: '#71b9ff', neu: '#b58cff', nu: '#f2a5ff', shower: '#ffa040',
};
export const CLASS_LABEL = {
  mu: 'muon', e: 'electron', gamma: 'photon', had: 'charged hadron', neu: 'neutral hadron', nu: 'missing E_T', shower: 'shower e±, γ',
};
