// ============================================================================
//  TENSOR CALCULUS  ·  palette.js  ·  the one index colour language  (CORE)
// ----------------------------------------------------------------------------
//  Each index letter gets one colour in every view: the TeX (\class{iN}{..}),
//  the diagram legs, and the 3D axes and glyphs. All packages read the
//  colour from this module. Do not keep a private colour table.
//
//  The eight colours come from the Okabe-Ito set, made lighter for a dark
//  background. tests/core.test.mjs makes sure that each colour has a
//  contrast of 4.5 or more on BG, and that two colours stay apart under
//  normal sight, deuteranopia, protanopia and tritanopia.
//
//  SLOTS. A letter has a home slot (HOME). For example, mu is slot 0 and nu
//  is slot 1. When an expression has two letters with the same home slot,
//  CORE calls setActive(syms). The letters then get free slots in order of
//  appearance, and indexColor() gives the same result in every view until
//  the next setActive(). A letter with no home slot gets a hash slot.
//
//  NAMES. A sym is a TeX name or a letter: 'mu', '\\mu', 'i', "a'" are all
//  legal. norm() removes the backslash, the braces and the primes, so
//  '\\mu' and 'mu' are the same index.
//
//  EXPORTS   (grep -n "export" palette.js)
//      BG ............... the page background, for contrast checks
//      INDEX_COLORS ..... 8 hex colours, slot 0 to 7
//      INDEX_NAMES ...... a plain name for each slot (for aria labels)
//      norm(sym) ........ the canonical name of an index
//      homeSlot(sym) .... the fixed slot of a letter (no active set)
//      setActive(syms) .. resolve slot collisions for one expression;
//                         returns Map(sym -> slot); fires 'tensor:palette'
//      activeSyms() ..... the syms of the last setActive, in order
//      indexSlot(sym) ... the slot now in use for sym (0..7)
//      indexColor(sym) .. '#rrggbb' for sym
//      indexClass(sym) .. 'i0'..'i7', the CSS class (style.css .i0-.i7)
//      indexRGB(sym) .... [r, g, b] in 0..1, for three.js colours
//      colorRules(syms) . [[sym, 'iN']] pairs for lib/sci-math.js colorize
// ============================================================================

export const BG = '#0b0d13';

export const INDEX_COLORS = Object.freeze([
  '#56b4e9', // 0 sky blue
  '#e69f00', // 1 orange
  '#5fe0b0', // 2 bluish green
  '#f0e442', // 3 yellow
  '#d97bb8', // 4 reddish purple
  '#ff6f4a', // 5 vermilion
  '#b083ff', // 6 violet
  '#eceef2', // 7 near white
]);

export const INDEX_NAMES = Object.freeze(['sky blue', 'orange', 'green', 'yellow', 'pink', 'vermilion', 'violet', 'white']);

// Home slots. Letters that often appear together get different slots:
// R^rho_{sigma mu nu} with Gamma^lambda is 2 3 0 1 4. Latin a and i share a
// slot because one formula seldom uses both alphabets for indices.
const HOME = {
  mu: 0, nu: 1, rho: 2, sigma: 3, lambda: 4, kappa: 5, alpha: 6, beta: 7,
  gamma: 5, delta: 7, tau: 6, eta: 3, xi: 2, zeta: 4, epsilon: 5, omega: 6, phi: 2, psi: 3, chi: 4,
  i: 0, j: 1, k: 2, l: 3, m: 4, n: 5, p: 6, q: 7, r: 2, s: 3, t: 4,
  a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7,
};

export function norm(sym) {
  return String(sym == null ? '' : sym).replace(/[{}\s]/g, '').replace(/^\\+/, '').replace(/['′]+$/, '');
}

function hashSlot(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 8;
}

export function homeSlot(sym) {
  const s = norm(sym);
  return s in HOME ? HOME[s] : hashSlot(s);
}

let active = new Map();
let activeOrder = [];

export function setActive(syms) {
  const order = [];
  for (const raw of syms || []) { const s = norm(raw); if (s && !order.includes(s)) order.push(s); }
  const used = new Set(), out = new Map();
  // First pass: home slots that are free. Second pass: the next free slot.
  const later = [];
  for (const s of order) {
    const h = homeSlot(s);
    if (!used.has(h)) { used.add(h); out.set(s, h); } else later.push(s);
  }
  for (const s of later) {
    let k = homeSlot(s);
    for (let n = 0; n < 8 && used.has(k); n++) k = (k + 1) % 8;
    used.add(k); out.set(s, k);  // more than 8 letters: colours repeat
  }
  active = out; activeOrder = order;
  if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('tensor:palette', { detail: { slots: Object.fromEntries(out) } }));
  }
  return new Map(out);
}

export function activeSyms() { return activeOrder.slice(); }

export function indexSlot(sym) {
  const s = norm(sym);
  return active.has(s) ? active.get(s) : homeSlot(s);
}

export function indexColor(sym) { return INDEX_COLORS[indexSlot(sym)]; }
export function indexClass(sym) { return 'i' + indexSlot(sym); }

export function indexRGB(sym) {
  const h = indexColor(sym);
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}

// Rules for colorize(): each sym as a TeX control word when it is Greek.
export function colorRules(syms) {
  const rules = [];
  for (const raw of syms || []) {
    const s = norm(raw);
    if (!s) continue;
    rules.push([s.length > 1 ? '\\' + s : s, indexClass(s)]);
  }
  return rules;
}
