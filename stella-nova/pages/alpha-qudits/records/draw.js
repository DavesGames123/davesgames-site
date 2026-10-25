// ============================================================================
//  ALPHA QUDITS  ·  records/draw.js  ·  2D canvas helpers for RECORDS
// ----------------------------------------------------------------------------
//  The colour tokens, text, easing, our letter glyph and our record glyph.
//  All sizes are CSS px; the caller scales the context by devicePixelRatio.
//
//  THE LETTER GLYPH (our own drawing, not the paper's Fig. 2)
//    An end is a small ring of its basis directions: three dots on a
//    triangle at a qutrit, two dots side by side at a qubit. A letter is
//    drawn on that ring: a symmetric off-diagonal letter is a straight
//    chord between its two directions, an antisymmetric one a bowed chord
//    with a small arrow head (its sign depends on the order), and a diagonal
//    letter fills the dots, bright for a positive entry, a ring for a
//    negative one, faint for zero; the dot size follows the entry size.
//
//  THE RECORD GLYPH
//    A mini square with the four slots at its corners (Q1, Q2 above; q1, q2
//    below), as on the square figure. The first term is drawn in full, the
//    mirror image term faint, a + or − badge in the centre says which
//    combination it is, and a commutator record has an arc under the qubits.
//    The cell is tinted by its sector (weight).
//
//  GREP MAP   (grep -n "<anchor>" draw.js)
//    export const C .............. colour tokens (lib/sci.css m1 to m6)
//    export const SECTOR_COLOR ... one colour per sector, brighter = heavier
//    export function font / label / ease / smooth / clamp / lerp / rrect
//    export function ringPoints .. the dots of an end
//    export function drawLetter .. one letter on its ring
//    export function slotOffsets . the four slot corners of a mini square
//    export function drawGlyph ... one record glyph
//    export function badge ....... the + / − combination badge
// ============================================================================
import { SLOT, letterOf } from './data.js';

export const C = {
  bg: '#070b0e', panel: 'rgba(255,255,255,0.035)', line: 'rgba(200,220,230,0.16)',
  text: '#e8eef0', dim: '#93a2a8', faint: '#5d6b70',
  qubit: '#62c4ff', qutrit: '#ff9a62', rec: '#86dc7c', charge: '#e889dc', alpha: '#ffd666', N: '#a8a4ff',
  x: '#ff9a62', y: '#62c4ff', glass: '#bfe6ff', sand: '#f2e3c4',
};
// Sectors (X, Y): weight 1, √2, √3, √6. A sequential ramp: brighter and
// warmer is heavier.
export const SECTOR_COLOR = { '++': '#4fa39a', '+-': '#86dc7c', '-+': '#d4e86a', '--': '#ffd666' };
export const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const SERIF = "'STIX Two Text', 'Times New Roman', Georgia, serif";

export const font = (px, w = 500, serif = false) => `${w} ${Math.max(11, px)}px ${serif ? SERIF : SANS}`;
export const fontRaw = (px, w = 500, serif = false) => `${w} ${px}px ${serif ? SERIF : SANS}`;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = u => { u = clamp(u); return u * u * (3 - 2 * u); };
export const ease = (t, a, b) => smooth((t - a) / (b - a));
export const slotColor = id => SLOT[id].role === 'center' ? C.qutrit : C.qubit;

export function label(g, txt, x, y, o = {}) {
  g.save();
  g.font = o.font || font(13);
  g.textAlign = o.align || 'center';
  g.textBaseline = o.base || 'middle';
  g.globalAlpha *= o.alpha == null ? 1 : o.alpha;
  if (o.halo) { g.lineWidth = 4; g.strokeStyle = o.halo; g.lineJoin = 'round'; g.strokeText(txt, x, y); }
  g.fillStyle = o.color || C.text;
  g.fillText(txt, x, y);
  g.restore();
}

export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// The dots of an end of dimension d around (x, y), ring radius rr.
export function ringPoints(d, x, y, rr) {
  if (d === 2) return [[x - rr * 0.85, y], [x + rr * 0.85, y]];
  const out = [];
  for (let k = 0; k < d; k++) {
    const a = -Math.PI / 2 + 2 * Math.PI * k / d;
    out.push([x + rr * Math.cos(a), y + rr * Math.sin(a)]);
  }
  return out;
}

// One letter (index i at an end of dimension d) on its ring.
export function drawLetter(g, d, i, x, y, rr, color, o = {}) {
  const info = letterOf(d === 3 ? 'Q1' : 'q1', i);
  const P = ringPoints(d, x, y, rr);
  const lw = o.lw || Math.max(1, rr * 0.32);
  const dotR = o.dot || Math.max(0.9, rr * 0.22);
  g.save();
  g.globalAlpha *= o.alpha == null ? 1 : o.alpha;
  // the ring of directions, faint
  g.fillStyle = color; g.strokeStyle = color;
  if (info.kind !== 'diag') {
    g.globalAlpha *= 0.55;
    for (const p of P) { g.beginPath(); g.arc(p[0], p[1], dotR * 0.8, 0, 7); g.fill(); }
    g.globalAlpha /= 0.55;
    const [a, b] = info.at, A = P[a], B = P[b];
    g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath();
    if (info.kind === 'sym') { g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); }
    else {
      // bow away from the ring centre
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      let nx = mx - x, ny = my - y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if (d === 2) { nx = 0; ny = -1; }
      const bow = rr * 0.75, cx = mx + nx * bow, cy = my + ny * bow;
      g.moveTo(A[0], A[1]); g.quadraticCurveTo(cx, cy, B[0], B[1]); g.stroke();
      // arrow head at B along the curve tangent
      const tx = B[0] - cx, ty = B[1] - cy, tl = Math.hypot(tx, ty) || 1;
      const ux = tx / tl, uy = ty / tl, h = Math.max(2, rr * 0.55);
      g.beginPath();
      g.moveTo(B[0], B[1]);
      g.lineTo(B[0] - ux * h - uy * h * 0.6, B[1] - uy * h + ux * h * 0.6);
      g.lineTo(B[0] - ux * h + uy * h * 0.6, B[1] - uy * h - ux * h * 0.6);
      g.closePath(); g.fill();
    }
  } else {
    const m = Math.max(...info.diag.map(Math.abs));
    info.diag.forEach((v, k) => {
      const p = P[k], r = dotR * (0.8 + 0.9 * Math.abs(v) / m);
      g.beginPath(); g.arc(p[0], p[1], v === 0 ? dotR * 0.7 : r, 0, 7);
      if (v > 0) g.fill();
      else if (v < 0) { g.lineWidth = Math.max(1, lw * 0.8); g.stroke(); }
      else { g.globalAlpha *= 0.35; g.fill(); g.globalAlpha /= 0.35; }
    });
  }
  g.restore();
}

// The four slot corners of a mini square of size s around (cx, cy).
export function slotOffsets(s) {
  return { Q1: [-0.25 * s, -0.2 * s], Q2: [0.25 * s, -0.2 * s], q1: [-0.25 * s, 0.24 * s], q2: [0.25 * s, 0.24 * s] };
}

export function badge(g, sign, x, y, r, color) {
  g.save();
  g.fillStyle = 'rgba(7,11,14,0.85)'; g.strokeStyle = color; g.lineWidth = 1;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
  g.strokeStyle = color; g.lineWidth = Math.max(1.2, r * 0.28); g.lineCap = 'round';
  g.beginPath(); g.moveTo(x - r * 0.5, y); g.lineTo(x + r * 0.5, y);
  if (sign > 0) { g.moveTo(x, y - r * 0.5); g.lineTo(x, y + r * 0.5); }
  g.stroke();
  g.restore();
}

// One record glyph in a cell of size s centred at (cx, cy).
// o: { alpha, hi (0..1 highlight), tint (bool), flip (-1..1 x scale) }
export function drawGlyph(g, rec, cx, cy, s, o = {}) {
  const off = slotOffsets(s), rr = s * 0.12;
  const col = SECTOR_COLOR[rec.sector];
  g.save();
  g.globalAlpha *= o.alpha == null ? 1 : o.alpha;
  if (o.tint !== false) {
    rrect(g, cx - s / 2, cy - s / 2, s, s, s * 0.16);
    g.fillStyle = col; g.globalAlpha *= 0.13 + 0.25 * (o.hi || 0); g.fill();
    g.globalAlpha /= 0.13 + 0.25 * (o.hi || 0);
    g.strokeStyle = col; g.lineWidth = o.hi ? 1.5 : 0.8; g.globalAlpha *= 0.45 + 0.55 * (o.hi || 0); g.stroke();
    g.globalAlpha /= 0.45 + 0.55 * (o.hi || 0);
  }
  const fx = o.flip == null ? 1 : o.flip;
  const at = id => [cx + off[id][0] * fx, cy + off[id][1]];
  // empty slots, faint
  for (const id of ['Q1', 'Q2', 'q1', 'q2']) {
    const [x, y] = at(id), d = SLOT[id].d;
    g.fillStyle = slotColor(id); g.globalAlpha *= 0.18;
    for (const p of ringPoints(d, x, y, rr)) { g.beginPath(); g.arc(p[0], p[1], Math.max(0.7, rr * 0.18), 0, 7); g.fill(); }
    g.globalAlpha /= 0.18;
  }
  if (rec.kind === 'commutator') {
    const A = at(rec.slots[0]), B = at(rec.slots[1]);
    g.strokeStyle = SECTOR_COLOR['--']; g.lineWidth = Math.max(1, s * 0.04);
    g.beginPath(); g.moveTo(A[0], A[1] + rr * 1.2); g.quadraticCurveTo((A[0] + B[0]) / 2, A[1] + s * 0.36, B[0], B[1] + rr * 1.2); g.stroke();
    for (const t of rec.terms) {
      const [x, y] = at(t.slots[0]);
      drawLetter(g, SLOT[t.slots[0]].d, t.letters[0], x, y, rr, slotColor(t.slots[0]));
    }
    badge(g, -1, cx, cy + s * 0.02, Math.max(3.5, s * 0.1), col);
  } else {
    rec.terms.forEach((t, n) => {
      t.slots.forEach((id, m) => {
        const [x, y] = at(id);
        drawLetter(g, SLOT[id].d, t.letters[m], x, y, rr, slotColor(id), { alpha: n === 0 ? 1 : 0.42 });
      });
    });
    if (rec.combo === 'even' || rec.combo === 'odd') badge(g, rec.combo === 'even' ? 1 : -1, cx, cy + s * 0.02, Math.max(3.5, s * 0.1), col);
  }
  g.restore();
}
