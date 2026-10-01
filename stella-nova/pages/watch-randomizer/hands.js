// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  hands.js — hand styles, widths and materials
// ────────────────────────────────────────────────────────────────────────────
//  handStyle(name) returns what the kit's B.hand takes: a style name it
//  knows (KIT_STYLES), or a function (len, w) -> [[outline, holes], ...]
//  for a style defined here (EXTRA). A hand points to 12 (+y) from its
//  arbor at the origin; len is the length to the tip, w the shaft width.
//  Each outline is a simple polygon; parts of one hand may overlap (they
//  are separate slabs), holes sit inside their outline. HAND_W gives each
//  style's width as a share of its length; forClock swaps styles whose
//  details have a fixed size; minuteFor pairs a minute hand with an hour
//  style (a beetle with a poker, a spade with a whip).
//
//  GREP MAP
//    const EXTRA ............. the styles drawn here, one function each
//    const HAND_W ............ width as a share of length
//    function minuteFor ...... the minute hand of a pair
// ============================================================================
import * as G from '../watch-movement/geom.js';
const { TAU } = G;

// styles the kit's B.hand draws itself
export const KIT_STYLES = ['breguet', 'dauphine', 'leaf', 'sword', 'spade', 'cathedral', 'baton', 'beetle', 'poker', 'needle'];

const ring = (r, n, c) => G.circlePoly(r, n, c);
const hole = (r, n, c) => G.circlePoly(r, n, c).reverse();
// a symmetric outline from its right half, listed from the tail to the tip
const mirror = right => {
  const tip = right[right.length - 1], body = right.slice(0, -1);
  return body.concat([tip], body.slice().reverse().map(([x, y]) => [-x, y]));
};
// the right half of a profile w(t), t in [0, 1] along y0..y1, closed by a point
const profile = (y0, y1, wf, n = 24) => {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push([Math.max(1e-4, wf(t)), y0 + (y1 - y0) * t]); }
  return out;
};
// a filled heart-ish lobe pair (Louis XV head), pointing to +y, centre c, size s
function louisHead(c, s) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const t = i / 64 * TAU, x = 16 * Math.pow(Math.sin(t), 3), y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([c[0] + x * s / 17, c[1] - y * s / 17]);           // flipped: the point of the heart is up
  }
  return out;
}

export const EXTRA = {
  // a thin shaft, a wide lume barrel, then a needle point
  syringe: (L, w) => [[mirror([[w * 0.35, -L * 0.14], [w * 0.35, L * 0.52], [w * 1.1, L * 0.55], [w * 1.1, L * 0.84], [w * 0.22, L * 0.87], [w * 0.12, L * 0.97], [0, L]]), []]],
  // a straight pencil with a sharpened tip
  pencil: (L, w) => [[mirror([[w * 0.6, -L * 0.15], [w * 0.6, L * 0.86], [0, L]]), []]],
  // alpha: a slim kite, widest a quarter of the way out
  alpha: (L, w) => [[mirror([[w * 0.3, -L * 0.12], [w * 0.9, L * 0.06], [w * 1.25, L * 0.26], [w * 0.5, L * 0.82], [0, L]]), []]],
  // Mercedes: a baton, a ring holding a three-arm star, a short point
  mercedes: (L, w) => {
    const c = [0, L * 0.74], r = Math.max(w * 2.0, L * 0.06), arm = r * 0.15, rr = r * 0.72, holes = [];
    const d = Math.asin(arm / rr), apex = arm * 1.35;
    for (let k = 0; k < 3; k++) {
      const a0 = Math.PI / 2 + k * TAU / 3, a1 = a0 + TAU / 3, am = (a0 + a1) / 2, h = [];
      for (let i = 0; i <= 12; i++) { const a = a0 + d + (a1 - a0 - 2 * d) * i / 12; h.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]); }
      h.push([c[0] + Math.cos(am) * apex, c[1] + Math.sin(am) * apex]);
      holes.push(h.reverse());
    }
    return [[rect(w, -L * 0.14, c[1] - r * 0.6), []], [ring(r, 48, c), holes], [mirror([[w * 0.55, c[1] + r * 0.8], [0, L]]), []]];
  },
  // lance: a slender shaft and a long spear head
  lance: (L, w) => [[mirror([[w * 0.3, -L * 0.14], [w * 0.3, L * 0.62], [w * 0.95, L * 0.76], [0, L]]), []]],
  // feuille: a long leaf, widest past the middle, sharp at both ends
  feuille: (L, w) => {
    const right = profile(-L * 0.08, L, t => w * 1.25 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.85) + w * 0.12 * (1 - t));
    right[right.length - 1] = [0, L];
    return [[mirror(right), []]];
  },
  // pomme: Breguet's open moon near the tip, sized with the hand
  pomme: (L, w) => {
    const r = Math.max(w * 1.9, L * 0.065), c = [0, L * 0.72];
    return [[rect(w * 0.9, -L * 0.16, c[1] - r * 0.8), []], [ring(r, 40, c), [hole(r * 0.62, 40, c)]], [mirror([[w * 0.42, c[1] + r * 0.85], [0, L]]), []]];
  },
  // fleur-de-lis: a shaft and a lily of three petals on a bar
  fleurdelis: (L, w) => {
    const b = L * 0.62, s = Math.max(w * 3.6, L * 0.12);
    const mid = mirror([[s * 0.16, b], [s * 0.3, b + s * 0.35], [s * 0.18, b + s * 0.8], [0, b + s * 1.2]]);
    const petal = sg => {
      const out = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14, a = Math.PI * 0.55 * t; out.push([sg * (s * 0.12 + Math.sin(a) * s * 0.55), b + s * 0.1 + (1 - Math.cos(a)) * s * 0.5 + t * s * 0.2]); }
      for (let i = 14; i >= 0; i--) { const t = i / 14, a = Math.PI * 0.55 * t; out.push([sg * (s * 0.12 + Math.sin(a) * s * 0.36), b + s * 0.12 + (1 - Math.cos(a)) * s * 0.42 + t * s * 0.14]); }
      return sg > 0 ? out : out.reverse();
    };
    return [[rect(w * 0.9, -L * 0.15, b + s * 0.1), []], [mid, []], [petal(1), []], [petal(-1), []], [rect(s * 0.7, b - s * 0.06, b + s * 0.08), []],
      [mirror([[w * 0.3, b + s * 1.1], [0, L]]), []]];
  },
  // spade-and-whip hour: a shaft, a ball, a spade with a point
  spadewhip: (L, w) => {
    const b = L * 0.66, s = Math.max(w * 2.4, L * 0.075), sp = [];
    for (let i = 0; i <= 20; i++) { const a = Math.PI + Math.PI * i / 20; sp.push([Math.cos(a) * s, b + s * 0.9 + Math.sin(a) * s * 0.9]); }
    sp.push([0, b + s * 2.6]);
    return [[rect(w * 0.9, -L * 0.15, b), []], [ring(w * 1.3, 24, [0, b - w * 1.5]), []], [sp, []], [mirror([[w * 0.3, b + s * 2.4], [0, L]]), []]];
  },
  // whip minute: thin, a small swell, then a long fine point
  whip: (L, w) => [[mirror([[w * 0.4, -L * 0.14], [w * 0.35, L * 0.6], [w * 0.75, L * 0.7], [w * 0.25, L * 0.8], [0, L]]), []]],
  // skeleton: an open baton (lume outline) with a short point
  skeleton: (L, w) => {
    const ww = w * 1.2, y0 = L * 0.14, y1 = L * 0.88;
    return [[mirror([[w * 0.45, -L * 0.14], [ww, y0], [ww, y1], [0, L]]), [mirror([[ww * 0.55, y0 + ww * 0.8], [ww * 0.55, y1 - ww * 0.5], [0, y1 + ww * 0.15]]).reverse()]]];
  },
  // arrow: a sports hour hand with a broad arrow head
  arrow: (L, w) => [[mirror([[w * 0.55, -L * 0.14], [w * 0.55, L * 0.66], [w * 1.7, L * 0.64], [0, L]]), []]],
  // plongeur pair: the hour hand is a short broad arrow, the minute a paddle
  plongeur: (L, w) => [[mirror([[w * 0.6, -L * 0.12], [w * 0.6, L * 0.55], [w * 1.8, L * 0.55], [0, L]]), []]],
  paddle: (L, w) => [[mirror([[w * 0.5, -L * 0.15], [w * 0.5, L * 0.08], [w * 1.6, L * 0.14], [w * 1.6, L * 0.88], [0, L]]), []]],
  // Louis XV: a shaft, a pierced heart-shaped head, and a fine point
  louisxv: (L, w) => {
    const s = Math.max(w * 3.2, L * 0.11), c = [0, L * 0.68];
    return [[rect(w * 0.8, -L * 0.15, c[1] - s * 0.6), []], [louisHead(c, s), [hole(s * 0.28, 24, [0, c[1] + s * 0.05])]], [mirror([[w * 0.32, c[1] + s * 0.7], [0, L]]), []]];
  },
  // serpentine: a shaft that waves gently, narrowing to its point
  serpentine: (L, w) => {
    const n = 48, right = [], left = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = -L * 0.12 + t * L * 1.12, x0 = w * 0.9 * Math.sin(t * Math.PI * 3) * Math.min(1, t * 3) * (1 - t * 0.6);
      const half = w * 0.55 * (1 - 0.85 * t) + 1e-4;
      right.push([x0 + half, y]); left.push([x0 - half, y]);
    }
    return [[right.concat([[left[n][0] * 0.5 + right[n][0] * 0.5, L + w * 0.3]], left.reverse()), []]];
  },
};
function rect(w, y0, y1) { return [[-w / 2, y0], [w / 2, y0], [w / 2, y1], [-w / 2, y1]]; }

export const HAND_W = {
  breguet: 0.042, dauphine: 0.06, leaf: 0.045, sword: 0.05, spade: 0.026, cathedral: 0.03, baton: 0.035, beetle: 0.04, poker: 0.022,
  syringe: 0.03, pencil: 0.035, alpha: 0.045, mercedes: 0.035, lance: 0.03, feuille: 0.04, pomme: 0.03, fleurdelis: 0.028,
  spadewhip: 0.028, whip: 0.022, skeleton: 0.04, arrow: 0.035, plongeur: 0.04, paddle: 0.045, louisxv: 0.028, serpentine: 0.03,
};
// the breguet pomme, the beetle and the fleur-de-lis keep a watch-sized
// detail, so a clock takes a spade, a spade, and a spade-and-whip
export const forClock = s => (s === 'breguet' || s === 'beetle' ? 'spade' : s === 'fleurdelis' ? 'spadewhip' : s);
const PAIR = { beetle: 'poker', spadewhip: 'whip', fleurdelis: 'whip', plongeur: 'paddle', mercedes: 'sword', louisxv: 'louisxv' };
export const minuteFor = s => PAIR[s] || s;
export const HAND_MAT = { blued: 'blued', black: 'black', gold: 'gold', steel: 'polished', lume: 'lume' };
export const SEC_MAT = { red: 'paint', gold: 'gold', blue: 'blued' };
export const handStyle = name => EXTRA[name] || name;
// display names for the Spec panel
export const HAND_NAMES = { breguet: 'Breguet', dauphine: 'dauphine', leaf: 'leaf', sword: 'sword', spade: 'spade', cathedral: 'cathedral', baton: 'baton', beetle: 'beetle and poker',
  syringe: 'syringe', pencil: 'pencil', alpha: 'alpha', mercedes: 'Mercedes', lance: 'lance', feuille: 'feuille', pomme: 'pomme', fleurdelis: 'fleur-de-lis',
  spadewhip: 'spade and whip', skeleton: 'skeleton', arrow: 'arrow', plongeur: 'plongeur', louisxv: 'Louis XV', serpentine: 'serpentine' };
