// ============================================================================
//  SSTV  ·  screensaver shot plan  (ES module, pure)
// ----------------------------------------------------------------------------
//  planShots(seed, n) gives n shots. Each shot is one of KINDS, 6 to 12 s
//  long, with a mode, a picture and a phosphor. Rules (tests.mjs checks
//  them): no kind twice in a row, no picture twice in a row, no phosphor
//  twice in a row, and every kind in each run of KINDS.length shots
//  (a shuffled bag, refilled so the last kind of one bag does not start
//  the next). Different seeds give different orders.
//
//  grep -n targets
//    "export const KINDS"      shot kinds and their length range
//    "export function planShots"
// ============================================================================

export const KINDS = {
  receive: { min: 9, max: 12, modes: ['r36', 'm2', 's2', 'pd90', 'r72', 'm1', 's1', 'sc2180'] },
  closeup: { min: 8, max: 11, modes: ['m1', 's1', 'r72', 'pd90'] },
  vis: { min: 7, max: 7.5, modes: ['m1', 's1', 'r36', 'pd120', 'pd90', 'r72'] },
  slant: { min: 10, max: 12, modes: ['r36', 'm2', 's2'] },
  iss: { min: 10, max: 12, modes: ['pd120', 'pd90', 'pd180'] },
};
export const CARDS_SAVER = ['planet', 'sunset', 'card', 'bars', 'zone'];
export const PHOSPHOR_LIST = ['colour', 'p7', 'p31', 'amber', 'p4', 'colour'];

export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function shuffle(a, R) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pick = (a, R, not) => { const b = a.filter(x => x !== not); return b[Math.floor(R() * b.length)]; };

export function planShots(seed, n = 20) {
  const R = rng(seed ^ 0x5bd1e995), out = [];
  let bag = [], prev = null, prevCard = null, prevPh = null;
  while (out.length < n) {
    if (!bag.length) { bag = shuffle(Object.keys(KINDS), R); if (bag[0] === prev) bag.push(bag.shift()); }
    const kind = bag.shift(), K = KINDS[kind];
    const card = kind === 'iss' ? 'event' : pick(CARDS_SAVER, R, prevCard);
    const phosphor = kind === 'iss' ? (prevPh === 'colour' ? 'p4' : 'colour') : pick(PHOSPHOR_LIST, R, prevPh);
    out.push({ kind, dur: K.min + (K.max - K.min) * R(), mode: pick(K.modes, R, null), card, phosphor, seed: (R() * 1e9) | 0 });
    prev = kind; prevCard = card; prevPh = phosphor;
  }
  return out;
}
