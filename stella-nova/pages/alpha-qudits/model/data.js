// ============================================================================
//  ALPHA QUDITS  ·  model/data.js  ·  measurements, offsets, history (MODEL)
// ----------------------------------------------------------------------------
//  MEASUREMENTS: the four determinations of 1/alpha(0) that the paper's
//  Fig. 3 uses, with their 1-sigma uncertainty and the reference. sigma(x)
//  gives (x - value) / uncertainty for each one, in exact decimal
//  arithmetic when x is a digit string.
//
//  HISTORY: earlier closed forms and the rejoinders. citedByPaper says
//  whether the preprint itself cites the item; the Eddington entries come
//  from the general literature and are not in its reference list.
//
//  grep -n targets:  MEASUREMENTS | export function sigma | HISTORY |
//  wylerInverse | CANDIDATE
// ============================================================================
import { decToScaled } from './exact.js';

export const MEASUREMENTS = [
  { id: 'codata2022', label: 'CODATA 2022', short: '137.035999177(21)', value: '137.035999177', unc: '0.000000021',
    kind: 'adjustment', ref: 4,
    cite: 'P. J. Mohr, D. B. Newell, B. N. Taylor, and E. Tiesinga, Rev. Mod. Phys. 97, 025002 (2025)' },
  { id: 'g2', label: 'Electron g−2 (2023)', short: '137.035999166(15)', value: '137.035999166', unc: '0.000000015',
    kind: 'electron magnetic moment with the Standard Model prediction', ref: 1,
    cite: 'X. Fan, T. G. Myers, B. A. D. Sukra, and G. Gabrielse, Phys. Rev. Lett. 130, 071801 (2023)' },
  { id: 'rb2020', label: 'Rb recoil (2020)', short: '137.035999206(11)', value: '137.035999206', unc: '0.000000011',
    kind: 'atom recoil, rubidium', ref: 2,
    cite: 'L. Morel, Z. Yao, P. Cladé, and S. Guellati-Khélifa, Nature 588, 61 (2020)' },
  { id: 'cs2018', label: 'Cs recoil (2018)', short: '137.035999046(27)', value: '137.035999046', unc: '0.000000027',
    kind: 'atom recoil, caesium', ref: 3,
    cite: 'R. H. Parker, C. Yu, W. Zhong, B. Estey, and H. Müller, Science 360, 191 (2018)' },
];

const DIG = 30;
// x: 1/alpha as a number or a decimal string. Returns [{ id, label, sigma,
// diff (x - value, a float), diffE9 (x - value in units of 1e-9) }].
// sigma(x, id) returns the one number for that measurement.
export function sigma(x, id) {
  const xs = typeof x === 'string' ? x : x.toPrecision(17);
  const X = decToScaled(xs, DIG);
  const rows = MEASUREMENTS.map(m => {
    const d = X - decToScaled(m.value, DIG), u = decToScaled(m.unc, DIG);
    const s = Number((d * 10n ** 6n) / u) / 1e6; // six decimals, exact truncation
    return { id: m.id, label: m.label, sigma: s, diff: Number(d) / 10 ** DIG, diffE9: Number(d / 10n ** BigInt(DIG - 15)) / 1e6 };
  });
  return id ? rows.find(r => r.id === id).sigma : rows;
}

// Wyler (1969): alpha = 9 / (8 pi^4) * (pi^5 / (2^4 5!))^(1/4).
export function wylerInverse() {
  const a = 9 / (8 * Math.PI ** 4) * Math.pow(Math.PI ** 5 / (16 * 120), 0.25);
  return 1 / a;
}

export const HISTORY = [
  { year: 1929, who: 'A. S. Eddington', claim: '1/α = 136, from a counting argument', inverse: 136,
    cite: 'A. S. Eddington, Proc. R. Soc. Lond. A 122, 358 (1929)', citedByPaper: false, check: 'general literature',
    note: 'Measurements of the time already pointed near 137.' },
  { year: 1936, who: 'A. S. Eddington', claim: '1/α = 137, the count raised by one', inverse: 137,
    cite: 'A. S. Eddington, Relativity Theory of Protons and Electrons (Cambridge University Press, 1936)', citedByPaper: false, check: 'general literature',
    note: 'He revised the count after the measurements moved away from 136.' },
  { year: 1969, who: 'A. Wyler', claim: 'α = (9/8π⁴)(π⁵/2⁴·5!)^{1/4}, from volumes of symmetric domains',
    inverse: null, inverseFn: 'wylerInverse', tex: '\\alpha_W = \\frac{9}{8\\pi^4}\\left(\\frac{\\pi^5}{2^4\\,5!}\\right)^{1/4}',
    cite: 'A. Wyler, C. R. Acad. Sci. Paris A 269, 743 (1969)', citedByPaper: true, ref: 5 },
  { year: 1971, who: 'A. Wyler', claim: 'Follow-up to the 1969 note', inverse: null,
    cite: 'A. Wyler, C. R. Acad. Sci. Paris A 272, 186 (1971)', citedByPaper: true, ref: 6 },
  { year: 1971, who: 'B. Robertson', claim: 'Rejoinder on Wyler’s expression', inverse: null,
    cite: 'B. Robertson, Phys. Rev. Lett. 27, 1545 (1971)', citedByPaper: true, ref: 7 },
  { year: 1972, who: 'R. Gilmore', claim: 'Rejoinder on Wyler’s expression', inverse: null,
    cite: 'R. Gilmore, Phys. Rev. Lett. 28, 462 (1972)', citedByPaper: true, ref: 8 },
  { year: 2026, who: 'A. D. Wissner-Gross', claim: 'α as a weighted count over the records of one qutrit-qubit link (Conjecture 1)', inverse: null,
    inverseFn: 'candidate', cite: 'A. D. Wissner-Gross, preprint dated 23 October 2026', citedByPaper: true },
];
// The paper's own summary of why the earlier closed forms failed: what
// fixed their normalization was a choice, since the volume of a symmetric
// domain can be rescaled, and the number with it (paper refs 5-8).
