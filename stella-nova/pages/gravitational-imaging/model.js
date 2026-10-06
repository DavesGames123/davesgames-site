// ============================================================================
//  MODEL  ·  the default lens, source and perturbers (ES module, data only)
// ----------------------------------------------------------------------------
//  The paper does not publish its macromodel parameters, so this lens is
//  made to look like Fig. 1 of Powell et al. (2025): an Einstein radius of
//  about 0.47 arcsec, a long thin arc to the north-east, and two images of a
//  fainter lobe. The perturber masses, truncation radii and the peak
//  signal-to-noise ratio come from the paper. All angles are in mas.
//
//  grep -n targets
//    lens ............. "export const LENS"
//    source ........... "export const LOBES"
//    perturbers ....... "export const V0"
//    instruments ...... "export const INSTRUMENTS"
//    past detections .. "export const DETECTIONS"
//    Table 1 .......... "export const TABLE1"
// ============================================================================
import { PC_PER_MAS, pjMass } from './lens.js';

export const LENS = { b: 470, q: 0.85, phi: 1.74, gamma: 2, shear: 0.03, shearPhi: 2.04, x0: 0, y0: 0 };

// Bright lobe (quadruply imaged, it makes the arc), a weak jet next to it,
// and the fainter, doubly imaged lobe about 50 mas to the north.
export const LOBES = [
  { x: -10.3, y: 12.3, sx: 2.6, sy: 1.0, ang: 3.84, amp: 1 },
  { x: -7, y: 9, sx: 5, sy: 1.5, ang: 3.84, amp: 0.12 },
  { x: -14, y: 60, sx: 3, sy: 2.5, ang: 0.3, amp: 0.22 },
];

// V: PJ_free best fit, m_tot 2.82e6, rt 149 pc, m80 1.13e6 (Table 1).
// It sits where the arc crosses the critical curve.
export const V0 = { name: 'V', x: 384.8, y: 320.7, m: 2.82e6, rt: 149 / PC_PER_MAS, on: true };
// A: PJ_tidal, rt 243 pc, m400 = 5.0e7 (the VLBI fit in the paper). The
// total mass follows from m400 and rt. About 50 mas outside the radio arc.
const RT_A = 243 / PC_PER_MAS;
export const A0 = { name: 'A', x: -60, y: 585, m: 5.0e7 / pjMass(400 / PC_PER_MAS, 1, RT_A), rt: RT_A, on: true };

// Peak signal-to-noise of the arc in the VLBI image: about 12 mJy per beam
// peak over 34 uJy per beam r.m.s. (Fig. 1).
export const SNR = 350;

// Angular resolution (FWHM, mas) quoted in the paper.
export const INSTRUMENTS = [
  { id: 'hst', label: 'HST', fwhm: 120 },
  { id: 'keck', label: 'Keck AO', fwhm: 70 },
  { id: 'alma', label: 'ALMA', fwhm: 23 },
  { id: 'vlbi', label: 'Global VLBI', fwhm: 5 },
];

// Low-mass perturbers found in galaxy-scale lenses with resolved arcs, as
// the paper lists them. Masses are order-of-magnitude labels from the text.
export const DETECTIONS = [
  { label: 'SDSS J0946+1006', inst: 'HST', fwhm: 120, m: 1e9, dy: 16 },
  { label: 'JVAS B1938+666 A', inst: 'Keck AO', fwhm: 70, m: 1e8 },
  { label: 'SDP.81', inst: 'ALMA', fwhm: 23, m: 1e9, dy: -8 },
  { label: 'JVAS B1938+666 V', inst: 'Global VLBI', fwhm: 5, m: 1.13e6 },
];

// Table 1 of the paper. dlogE is relative to the smooth macromodel.
export const TABLE1 = [
  { a: 'PJ_tidal', v: 'PJ_free', dlogE: 364, m80: [1.13, 0.04], mtot: [2.82, 0.26], rt: [149, 18] },
  { a: 'PJ_free', v: 'PJ_free', dlogE: 364, m80: [1.14, 0.03], mtot: [2.78, 0.23], rt: [145, 17] },
  { a: 'NFW_sub', v: 'PJ_free', dlogE: 362, m80: [1.13, 0.03], mtot: [2.81, 0.25], rt: [150, 18] },
  { a: 'PJ_tidal', v: 'PJ_tidal', dlogE: 348, m80: [1.07, 0.04], mtot: [1.54, 0.07], rt: [53, 1] },
  { a: 'None', v: 'PJ_free', dlogE: 343, m80: [1.10, 0.04], mtot: [2.41, 0.23], rt: [123, 18] },
  { a: 'PJ_tidal', v: 'None', dlogE: 16 },
  { a: 'PJ_free', v: 'None', dlogE: 16 },
  { a: 'NFW_sub', v: 'None', dlogE: 13 },
  { a: 'None', v: 'None', dlogE: 0 },
];
