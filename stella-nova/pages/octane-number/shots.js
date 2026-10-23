// ============================================================================
//  OCTANE NUMBER  ·  shots.js — screensaver logic (no DOM)
// ----------------------------------------------------------------------------
//  saver.js draws; this module decides what and where, so node tests can
//  check it at 16:9 and at 9:16.
//
//  SHOTS
//    knock    the cylinder and its pressure trace for one cycle. Each shot
//             takes one of the KNOCK_CASES; half knock, half burn clean.
//    pair     n-heptane (0) and iso-octane (100) in 3D: the skeletal
//             formula draws, then lifts (the Molecule Explorer intro).
//    ladder   the octane ladder fills in from the lowest number up.
//    chain    the low-temperature chain, five steps, on both molecules.
//
//  grep -n targets
//    shot ids, plates ...... "export const SHOTS"
//    knock settings ........ "export const KNOCK_CASES"
//    seeded plan ........... "export function shotPlan"
//    framing ............... "export function shotLayout"
// ============================================================================
import { rng } from './draw.js';

export const SHOT_IDS = Object.freeze(['knock', 'pair', 'ladder', 'chain']);
export const SHOTS = Object.freeze({
  knock: { title: 'Knock', sub: 'the end gas ignites before the flame reaches it',
    tex: ['\\int \\frac{dt}{\\tau(p, T_u)} = 1'], rules: [['T_u', 'm2']],
    lines: ['Ignition delay: Douaud and Eyzat 1978', 'One-zone engine model, illustrative'] },
  pair: { title: 'The two ends of the scale', sub: 'n-heptane is 0, iso-octane is 100',
    tex: ['\\mathrm{ON} = \\%\\ \\text{iso-octane in heptane}'], rules: [],
    lines: ['3D structures: PubChem', 'Views from the Molecule Explorer'] },
  ladder: { title: 'The octane ladder', sub: 'research octane numbers of 18 fuel molecules',
    tex: [], rules: [],
    lines: ['Four isomers of C8H18 span -20 to 106', 'Values: API Research Project 45, via Wikipedia'] },
  chain: { title: 'Why branches resist knock', sub: 'the low-temperature chain needs a weak C-H in reach',
    tex: ['\\mathrm{RO_2} \\rightarrow \\mathrm{QOOH}'], rules: [],
    lines: ['Secondary C-H 412 kJ/mol, primary 423 kJ/mol', 'Steps illustrative'] },
});

// Settings for the knock shot; the page controls use the same keys.
export const KNOCK_CASES = Object.freeze([
  { on: 95, cr: 10.5, spark: 22, boost: 1.0, rpm: 2000, knock: false },
  { on: 78, cr: 10.5, spark: 26, boost: 1.0, rpm: 2000, knock: true },
  { on: 91, cr: 9.5, spark: 20, boost: 1.6, rpm: 2500, knock: true },
  { on: 100, cr: 9.5, spark: 16, boost: 1.6, rpm: 2500, knock: false },
]);

// A plan of n shots: each run of four is a seeded shuffle of all ids, and
// no id repeats across a seam. Lengths 7 to 12 s; calm makes them longer.
export function shotPlan(seed, n = 64, calm = 0.7) {
  const r = rng((seed >>> 0) || 1), out = [];
  let prev = null, kc = Math.floor(r() * KNOCK_CASES.length);
  while (out.length < n) {
    const ids = [...SHOT_IDS];
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    if (ids[0] === prev) [ids[0], ids[1]] = [ids[1], ids[0]];
    for (const id of ids) {
      const sec = id === 'knock' ? 11 + 2 * calm : id === 'chain' ? 10 + 2 * calm : 7 + 3 * calm + r() * 2;
      out.push({ id, sec, kcase: id === 'knock' ? (kc++ % KNOCK_CASES.length) : null });
      if (out.length >= n) break;
    }
    prev = out[out.length - 1].id;
  }
  return out;
}

// Panels inside the clear band (t, b: the plate text heights). Two
// panels side by side when the band is wide, stacked when it is tall.
export function shotLayout(id, w, h, band = { t: 0, b: 0 }) {
  const m = Math.max(12, Math.min(w, h) * 0.04);
  const top = band.t + m, bot = h - band.b - m, H = Math.max(40, bot - top);
  const W = Math.min(w - 2 * m, H * 2.4), x = (w - W) / 2;
  const box = { x, y: top, w: W, h: H };
  let panels;
  if (id === 'knock' || id === 'pair') {
    const tall = h > w;
    if (tall) { const ph = (H - m) / 2, pw = Math.min(W, ph * (id === 'pair' ? 1.2 : 1.6)); panels = [0, 1].map(k => ({ x: (w - pw) / 2, y: top + k * (ph + m), w: pw, h: ph })); }
    else {
      const f = id === 'knock' ? 0.36 : 0.5, pw0 = (W - m) * f, pw1 = W - m - pw0;
      panels = [{ x, y: top, w: pw0, h: H }, { x: x + pw0 + m, y: top, w: pw1, h: H }];
    }
  } else panels = [box];
  return { panels, subject: { x: box.x + box.w / 2, y: box.y + box.h / 2, r: Math.min(box.w, box.h) / 2 } };
}
