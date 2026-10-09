// ============================================================================
//  REACTIONS  ·  treefit.js — fit names, stills and equation chips in the tree
// ----------------------------------------------------------------------------
//  Pure functions (no DOM, no THREE). treeview.js, rxview.js and main.js
//  use them in the page. tests.mjs uses the same functions, so the node
//  checks measure what the page draws.
//
//  NAMES   textWidth(s, fs) is a width model of STIX Two Text (the card
//          font): its advance widths plus 3 %. fitLabel(name, w, h)
//          picks the font size and the line breaks (two lines at most)
//          so that each line fits the card.
//  CARDS   cardGeom(box, name) gives the label fit and the art rectangle
//          of one card (the 2D drawing or the 3D still fills the art).
//  3D      principal3(xyz) turns a molecule so its longest axis is x and
//          its flattest axis faces the camera. frameBox(...) gives the
//          orthographic frame that fills the art rectangle (FILL of the
//          longer side).
//  2D      fitArt2D(rec, w, h) draws the skeletal formula for a w x h art
//          box: turned so its long axis runs across when that makes it
//          larger, with strokes at least 1.25 px wide on the card.
//  CHIPS   chipBox(viewBox) gives the pixel size of a typeset equation
//          chip. placeChips(lay, steps, sizes) puts each chip on a branch
//          into its product, or next to the product card, with no overlap
//          of a card or another chip. When no place is free, it spreads
//          the layout (positions, not card sizes) and tries again.
//
//  GREP MAP
//    grep -n 'export function fitLabel'   grep -n 'export function cardGeom'
//    grep -n 'export function frameBox'   grep -n 'export function placeChips'
// ============================================================================

import { decode } from '../molecules/chem.js';
import { render2D, BL } from '../molecules/draw2d.js';

// ── names ───────────────────────────────────────────────────────────────────
// Advance widths (1/1000 em) of STIX Two Text Regular, read from the
// vendored woff2 (vendor/fonts, Latin subset, OFL font). Other
// characters count as 0.62 em. WIDTH_K adds 3 % for rounding and kerning.
const W = {};
const STIX = { 187: "'", 225: ' ', 242: ',.:', 272: 'j', 273: 'l', 279: 'i', 291: 'f', 298: 't', 315: '-', 339: ')', 340: '([]', 343: 'I',
  367: 's', 383: 'r', 386: '/', 398: 'J', 408: 'c', 412: 'e', 425: 'z', 429: 'v', 446: 'y', 451: 'g', 453: 'x', 485: 'o', 495: 'b0123456789',
  499: 'k', 518: 'q', 521: 'p', 534: 'aS', 541: 'd', 549: 'h', 557: 'u', 564: 'n', 569: 'LP', 583: 'F', 593: 'B', 606: 'Z', 607: 'Y',
  610: 'T', 614: 'E', 620: 'R', 637: 'X', 640: 'V', 655: 'K', 656: 'C', 681: 'A', 694: 'w', 697: 'G', 702: 'D', 707: 'OQ', 714: 'N',
  720: '+\u00d7', 731: 'U', 757: 'H', 825: 'm', 869: 'M', 913: 'W', 500: '\u2013', 330: '\u2019\u2032' };
for (const [w, cs] of Object.entries(STIX)) for (const c of cs) W[c] = +w;
export const WIDTH_K = 1.03;
export function textWidth(s, fs) {
  let u = 0;
  for (const c of String(s)) u += W[c] ?? 620;
  return u / 1000 * fs * WIDTH_K;
}
// Break a name into lines no wider than tw: at spaces, and after a hyphen
// or a comma. A part that is still too wide is cut into pieces.
export function wrap(name, tw, fs) {
  // parts: [text, space follows]
  const parts = [...String(name).matchAll(/([^\s,-]+[,-]?|[,-])(\s*)/g)].map(m => [m[1], !!m[2]]);
  if (!parts.length) return [''];
  const lines = [];
  let cur = '', sp = false;
  for (let [p, after] of parts) {
    const t = cur === '' ? p : cur + (sp ? ' ' : '') + p;
    if (textWidth(t, fs) <= tw) { cur = t; sp = after; continue; }
    if (cur) lines.push(cur);
    cur = '';
    while (textWidth(p, fs) > tw && p.length > 1) {
      let k = p.length - 1;
      while (k > 1 && textWidth(p.slice(0, k) + '-', fs) > tw) k--;
      lines.push(p.slice(0, k) + '-'); p = p.slice(k);
    }
    cur = p; sp = after;
  }
  if (cur) lines.push(cur);
  return lines;
}
// The font size and lines of a card name. w, h: the card box. The label
// may use at most `share` of the card height.
export const LINE = 1.12;
export function fitLabel(name, w, h, { maxFs = Math.max(10, Math.min(15, w * 0.1)), minFs = 7, share = 0.42, pad = 10 } = {}) {
  const tw = w - pad;
  for (let fs = maxFs; fs >= minFs - 1e-9; fs -= 0.5) {
    const lines = wrap(name, tw, fs);
    if (lines.length <= 2 && lines.length * fs * LINE <= share * h) return { fs, lines, h: lines.length * fs * LINE, tw };
  }
  const fs = minFs, lines = wrap(name, tw, fs);
  return { fs, lines, h: lines.length * fs * LINE, tw };
}
// One card: the label and the art rectangle (card coordinates).
export function cardGeom(box, name) {
  const lab = fitLabel(name, box.w, box.h);
  const labH = Math.ceil(lab.h) + 4;
  return { lab, labH, art: { x: 3, y: 3, w: box.w - 6, h: Math.max(10, box.h - labH - 5) } };
}

// ── 3D stills ───────────────────────────────────────────────────────────────
// Eigenvectors of a symmetric 3x3 matrix (Jacobi), columns sorted by
// eigenvalue, largest first.
function eig3(A) {
  const a = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return order.map(i => [V[0][i], V[1][i], V[2][i]]);
}
// xyz (flat, 3 per atom) -> a new Float32Array: centred, turned so x is
// the longest axis, y the next, z (toward the camera) the flattest.
export function principal3(xyz, n = xyz.length / 3) {
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) c[d] += xyz[3 * i + d] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) C[r][s] += (xyz[3 * i + r] - c[r]) * (xyz[3 * i + s] - c[s]);
  let [e1, e2] = eig3(C);
  // a right-handed frame (no mirror image)
  const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const v = [xyz[3 * i] - c[0], xyz[3 * i + 1] - c[1], xyz[3 * i + 2] - c[2]];
    out[3 * i] = v[0] * e1[0] + v[1] * e1[1] + v[2] * e1[2];
    out[3 * i + 1] = v[0] * e2[0] + v[1] * e2[1] + v[2] * e2[2];
    out[3 * i + 2] = v[0] * e3[0] + v[1] * e3[1] + v[2] * e3[2];
  }
  return out;
}
// The orthographic frame (centre, half width, half height) that shows the
// atoms (x, y and radius) in a w:h rectangle. The longer side of the
// molecule fills FILL of the frame. The frame is at least MIN_HALF
// angstrom high (half height), so that a small molecule (NaOH, H2O)
// does not swell to the size of a large one; atMin marks that case.
export const FILL = 0.9, MIN_HALF = 1.9;
export function frameBox(pos, rad, aspect, fill = FILL, minHalf = MIN_HALF) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < rad.length; i++) {
    const r = rad[i];
    x0 = Math.min(x0, pos[3 * i] - r); x1 = Math.max(x1, pos[3 * i] + r);
    y0 = Math.min(y0, pos[3 * i + 1] - r); y1 = Math.max(y1, pos[3 * i + 1] + r);
  }
  if (!isFinite(x0)) { x0 = y0 = -1; x1 = y1 = 1; }
  const fit = Math.max((x1 - x0) / 2, (y1 - y0) / 2 * aspect, 0.2) / fill, hw = Math.max(fit, minHalf * aspect);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw, hh: hw / aspect, fillX: (x1 - x0) / (2 * hw), fillY: (y1 - y0) / (2 * hw / aspect), atMin: hw > fit };
}

// ── 2D drawings ─────────────────────────────────────────────────────────────
// The angle (radians) of the long axis of n 2D points.
export function principal2(xy, n = xy.length / 2) {
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += xy[2 * i] / n; cy += xy[2 * i + 1] / n; }
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const x = xy[2 * i] - cx, y = xy[2 * i + 1] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}
// The scale of a view box shown with object-fit: contain in a w x h box,
// and the share of the box that the drawing fills on its longer side.
export function containFit(vb, w, h) {
  const s = Math.min(w / vb.w, h / vb.h);
  return { s, fill: Math.max(vb.w * s / w, vb.h * s / h) };
}

// The skeletal formula for a w x h box (CSS px). Returns { svg, s (px per
// drawing unit), fill, strokePx, turned }.
const LW0 = 0.055 * BL;            // draw2d.js line width at lw = 1
export function fitArt2D(rec, w, h, { lw = 1.7, minPx = 1.25, maxLw = 12 } = {}) {
  let M = decode(rec);
  const o = { lw, pad: 0.45, minW: 4.6, minH: 2.8 };
  let r = render2D(M, o), fit = containFit(r.box, w, h), turned = false;
  const th = principal2(M.xy, M.n);
  if (Math.abs(Math.sin(th)) > 0.26) {
    const c = Math.cos(-th), sn = Math.sin(-th), xy = new Float32Array(M.xy.length);
    for (let i = 0; i < xy.length; i += 2) { xy[i] = M.xy[i] * c - M.xy[i + 1] * sn; xy[i + 1] = M.xy[i] * sn + M.xy[i + 1] * c; }
    const M2 = Object.assign({}, M, { xy }), r2 = render2D(M2, o), f2 = containFit(r2.box, w, h);
    if (f2.s > fit.s * 1.15) { M = M2; r = r2; fit = f2; turned = true; }
  }
  let px = LW0 * lw * fit.s;
  if (px < minPx) {
    const lw2 = Math.min(maxLw, minPx / (LW0 * fit.s));
    r = render2D(M, Object.assign({}, o, { lw: lw2 })); px = LW0 * lw2 * fit.s;
  }
  return { svg: r.svg, box: r.box, s: fit.s, fill: fit.fill, strokePx: px, turned };
}

// ── equation chips ─────────────────────────────────────────────────────────
// A MathJax SVG viewBox is in 1/1000 em. The chip shows it at fs px and at
// most maxH px high, with 7 px x 3 px padding and a 1 px border.
export const CHIP = { fs: 12, maxH: 22, padX: 7, padY: 3, border: 1 };
export function chipBox(vbW, vbH, o = CHIP) {
  let w = vbW / 1000 * o.fs, h = vbH / 1000 * o.fs;
  if (h > o.maxH) { w *= o.maxH / h; h = o.maxH; }
  return { svgW: w, svgH: h, w: w + 2 * (o.padX + o.border), h: h + 2 * (o.padY + o.border) };
}
// A rough chip size from the TeX text, for the first placement before
// MathJax has typeset the chip.
export function chipGuess(tex) {
  const body = String(tex).replace(/^\\ce\{|\}$/g, '');
  const m = /->|<=>/.exec(body);
  const sides = m ? body.slice(0, m.index) + body.slice(body.indexOf(' ', m.index)) : body;
  const above = /->\[([^\]]*)\]/.exec(body), below = /->\[[^\]]*\]\[([^\]]*)\]/.exec(body);
  const arrow = Math.max(2.2, 0.5 * Math.max((above ? above[1] : '').length, (below ? below[1] : '').length) * 0.75);
  const em = sides.replace(/\s+/g, '').length * 0.58 + (sides.match(/\+/g) || []).length * 0.6 + arrow;
  return chipBox(em * 1000, (below ? 2.6 : above ? 2.0 : 1.3) * 1000);
}

const inter = (a, b, m = 0) => {
  const x = Math.min(a.x + a.w + m, b.x + b.w) - Math.max(a.x - m, b.x);
  const y = Math.min(a.y + a.h + m, b.y + b.h) - Math.max(a.y - m, b.y);
  return x > 0 && y > 0 ? x * y : 0;
};
export const overlapArea = inter;

// Spread a layout of synth.js: every position moves away from the centre
// by f; each card moves with its position (its size stays); the branch
// points scale. Returns a new layout object.
export function spread(lay, f) {
  const cx = lay.w / 2, cy = lay.h / 2, sc = ([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f];
  const pos = [], fish = [], branch = [];
  for (const id of lay.ids) {
    const p = lay.pos[id], b = lay.fish[id];
    const [nx, ny] = sc([p.x, p.y]);
    pos[id] = Object.assign({}, p, { x: nx, y: ny });
    if (b) fish[id] = Object.assign({}, b, { x: b.x + nx - p.x, y: b.y + ny - p.y });
    const br = lay.branch[id];
    if (br) branch[id] = { elbow: br.elbow.map(sc), run: br.run.map(sc) };
  }
  return Object.assign({}, lay, { pos, fish, branch, w: lay.w * f, h: lay.h * f, cx: cx * f, cy: cy * f, spread: (lay.spread || 1) * f });
}
// Points along a polyline, at fractions of its length.
function along(pts, ts) {
  const seg = []; let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  return ts.map(t => {
    let s = t * L;
    for (let i = 0; i < seg.length; i++) { if (s <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, s / seg[i]) : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; } s -= seg[i]; }
    return pts[0];
  });
}
// Place one chip per step. steps: [{ out, ins }]; size(k) -> { w, h } of
// the chip of step k. Returns { lay, at: [{ x, y, w, h }] (top left, in
// layout px), clash (overlaps left) }. GAP: the space kept round cards.
export const GAP = 4;
export function placeChips(lay0, steps, size, { tries = 14, grow = 1.14 } = {}) {
  let lay = lay0, best = null;
  for (let k = 0; k <= tries; k++) {
    const r = placeOnce(lay, steps, size);
    if (!best || r.clash < best.clash) best = r;
    if (!r.clash) break;
    lay = spread(lay, grow);
  }
  // the layout box grows to hold every chip; shift so nothing is negative
  const L = best.lay;
  let x0 = 0, y0 = 0, x1 = L.w, y1 = L.h;
  for (const a of best.at) if (a) { x0 = Math.min(x0, a.x - 8); y0 = Math.min(y0, a.y - 8); x1 = Math.max(x1, a.x + a.w + 8); y1 = Math.max(y1, a.y + a.h + 8); }
  if (x0 < 0 || y0 < 0 || x1 > L.w || y1 > L.h) {
    const dx = -x0, dy = -y0, sh = ([x, y]) => [x + dx, y + dy];
    const pos = [], fish = [], branch = [];
    for (const id of L.ids) {
      pos[id] = Object.assign({}, L.pos[id], { x: L.pos[id].x + dx, y: L.pos[id].y + dy });
      if (L.fish[id]) fish[id] = Object.assign({}, L.fish[id], { x: L.fish[id].x + dx, y: L.fish[id].y + dy });
      if (L.branch[id]) branch[id] = { elbow: L.branch[id].elbow.map(sh), run: L.branch[id].run.map(sh) };
    }
    best.lay = Object.assign({}, L, { pos, fish, branch, w: x1 - x0, h: y1 - y0, cx: (L.cx ?? L.w / 2) + dx, cy: (L.cy ?? L.h / 2) + dy });
    best.at = best.at.map(a => a && Object.assign({}, a, { x: a.x + dx, y: a.y + dy }));
  }
  return best;
}
function placeOnce(lay, steps, size) {
  const cards = lay.ids.map(id => lay.fish[id]).filter(Boolean);
  const placed = [], at = [];
  let clash = 0;
  const order = steps.map((s, k) => k).filter(k => lay.fish[steps[k].out]).sort((a, b) => size(b).w - size(a).w);
  for (const k of order) {
    const s = steps[k], P = lay.fish[s.out], { w, h } = size(k);
    const cands = [];
    const pc = [P.x + P.w / 2, P.y + P.h / 2];
    // on each branch into the product
    for (const c of s.ins) {
      const br = lay.branch[c]; if (!br) continue;
      const pts = [...br.run.slice().reverse(), ...br.elbow.slice().reverse()];
      for (const [x, y] of along(pts, [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9])) cands.push([x - w / 2, y - h / 2, 0]);
    }
    // round the product card
    cands.push([pc[0] - w / 2, P.y + P.h + GAP + 2, 1], [pc[0] - w / 2, P.y - h - GAP - 2, 1],
      [P.x + P.w + GAP + 2, pc[1] - h / 2, 1], [P.x - w - GAP - 2, pc[1] - h / 2, 1]);
    let pick = null, ps = Infinity;
    for (const [x, y, tier] of cands) {
      const r = { x, y, w, h };
      let bad = 0;
      for (const c of cards) bad += inter(r, c, GAP);
      for (const q of placed) bad += inter(r, q, GAP);
      const sc = bad * 1000 + Math.hypot(x + w / 2 - pc[0], y + h / 2 - pc[1]) * 0.01 + tier * 0.5;
      if (sc < ps) { ps = sc; pick = r; }
    }
    if (!pick) continue;
    if (ps >= 1000) clash++;
    placed.push(pick); at[k] = pick;
  }
  return { lay, at, clash };
}
