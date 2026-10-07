// ============================================================================
//  DICE LAB  ·  facetex.js — the face atlas of each die (2D canvas)
// ----------------------------------------------------------------------------
//  One atlas per (die type, material, style). The atlas is a square grid of
//  CELL px cells. Cell i holds face i of buildDie(type).faces, drawn in the
//  face's own (right, up) basis with the same scale as the mesh UVs, so the
//  numbers sit in the face and never on a second surface: there is no decal
//  and so no z-fighting. The last cell is blank base (the bevels map there).
//
//  Two canvases per atlas:
//    color   the base pattern (resin, marble, wood, bone, metal, glass tint)
//            and the ink
//    height  white base, black ink, blurred 1.5 px. scene.js uses it as the
//            bump map, so the ink reads as engraved, and on glass as the
//            transmission map, so the ink is opaque.
//  recog.js samples the color canvas for its templates.
//
//  6 and 9 (and 66, 99 never occur) get a bar under the number, so the
//  reader can tell them apart, as on real dice.
//
//  GREP MAP
//    export const MATERIALS ..... the six finishes and their ink rules
//    export function inkFor ..... ink colour for a die type and finish
//    function pattern ........... the base pattern of one finish
//    function drawFace .......... one face: clip, base, ink
//    export function makeAtlas .. the two canvases
// ============================================================================
import { DIE_TYPES } from './dice.js';

export const CELL = 256;
export const MATERIALS = {
  resin:  { name: 'Resin' },
  marble: { name: 'Marbled' },
  metal:  { name: 'Metal' },
  glass:  { name: 'Glass' },
  wood:   { name: 'Wood' },
  bone:   { name: 'Bone' },
};
export const MATERIAL_ORDER = ['resin', 'marble', 'metal', 'glass', 'wood', 'bone'];
const FONT = "600 100px 'STIX Two Text', 'Times New Roman', Georgia, serif";

const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const css = c => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// base and ink per finish. Colour per die type stays in each finish:
// resin and glass take the type colour, marble swirls it with white,
// metal tints steel with it, wood keeps the grain and inks with it, bone
// is ivory with type-colour ink.
export function finish(type, mat) {
  const T = DIE_TYPES[type], c = hex(T.colour), ink = hex(T.ink);
  switch (mat) {
    case 'marble': return { base: c, base2: mix(c, [245, 242, 235], 0.75), ink };
    case 'metal': { const steel = type === 'coin' ? c : mix([214, 214, 220], c, 0.3); return { base: steel, ink: [24, 22, 26] }; }
    case 'glass': return { base: lum(c) < 60 ? [150, 150, 158] : mix(c, [255, 255, 255], 0.45), ink: [250, 246, 236] };
    case 'wood': { const light = ['d4', 'd8', 'd12', 'dF'].includes(type); return { base: light ? [214, 172, 118] : [128, 82, 48], base2: light ? [176, 128, 78] : [86, 52, 28], ink: light ? mix(c, [20, 14, 10], 0.35) : [244, 226, 190] }; }
    case 'bone': return { base: [232, 222, 198], base2: [206, 192, 160], ink: lum(c) > 150 ? [36, 30, 26] : mix(c, [10, 10, 10], 0.35) };
    default: return { base: c, ink };
  }
}
export const inkFor = (type, mat) => finish(type, mat).ink;

// value noise (seeded by a fixed hash), for the patterns
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const s = t => t * t * (3 - 2 * t), u = s(fx), v = s(fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; } return s; };

// the base pattern into an ImageData-sized buffer (the whole atlas)
function pattern(ctx, size, mat, F, seed) {
  const img = ctx.createImageData(size, size), d = img.data;
  const sc = 6 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let c = F.base;
    const X = x * sc + seed * 7.1, Y = y * sc;
    if (mat === 'marble') {
      const w = fbm(X * 0.8, Y * 0.8, 5), v = Math.sin((X + Y) * 1.6 + w * 9);
      c = mix(F.base, F.base2, Math.pow(Math.abs(v), 0.35));
    } else if (mat === 'wood') {
      const w = fbm(X * 0.5, Y * 3, 4), r = Math.sin((Y * 5 + w * 6)) * 0.5 + 0.5, fine = vnoise(X * 40, Y * 3) * 0.25;
      c = mix(F.base, F.base2, Math.min(1, r * 0.8 + fine));
    } else if (mat === 'bone') {
      const n = fbm(X * 2, Y * 2, 4), sp = hash(x, y) > 0.995 ? 0.6 : 0;
      c = mix(F.base, F.base2, n * 0.6 + sp);
    } else if (mat === 'metal') {
      const n = vnoise(X * 60, Y * 2) * 0.12 - 0.06;
      c = F.base.map(v => v * (1 + n));
    } else if (mat === 'resin') {
      const n = fbm(X * 3, Y * 3, 3) * 0.06 - 0.03;
      c = F.base.map(v => v * (1 + n));
    }
    const i = (y * size + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// one face: polygon in cell px, then the ink
function drawFace(g, die, f, ox, oy, style, inkCss, isHeight) {
  const P = f.poly.map(p => f.to2(p)).map(([x, y]) => [ox + (0.5 + x) * CELL, oy + (0.5 - y) * CELL]);
  // in-radius of the face (cell px): the nearest edge from the centre
  const cx = ox + CELL / 2, cy = oy + CELL / 2;
  let rin = 1e9;
  P.forEach((a, k) => { const b = P[(k + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey); rin = Math.min(rin, Math.abs((cx - a[0]) * ey - (cy - a[1]) * ex) / l); });
  g.save();
  g.beginPath(); P.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.clip();
  g.fillStyle = inkCss; g.strokeStyle = inkCss;
  const T = die.type;
  const text = (s, x, y, size, rot = 0, bar = false) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.font = FONT.replace('100px', `${size}px`);
    const w = g.measureText(s).width, maxW = size * (s.length > 1 ? 1.05 : 0.9);
    const k = w > maxW ? maxW / w : 1;
    g.scale(k, 1);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const asc = size * 0.68;                         // cap height of the face
    g.fillText(s, 0, asc / 2);
    if (bar) g.fillRect(-w * 0.42, asc / 2 + size * 0.1, w * 0.84, Math.max(3, size * 0.07));
    g.restore();
  };
  if (T === 'd4') {
    // three corner numbers, each upright toward its own corner
    f.corners.forEach(c => {
      const [x, y] = f.to2(c.p), px = ox + (0.5 + x) * CELL, py = oy + (0.5 - y) * CELL;
      const dx = px - cx, dy = py - cy, rot = Math.atan2(dx, -dy);
      text(c.label, cx + dx * 0.56, cy + dy * 0.56, rin * 0.78, rot);
    });
  } else if (T === 'd6' && style === 'pips') {
    const v = f.value, r = rin * 0.16, s = rin * 0.52;
    const at = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[v];
    for (const [a, b] of at) { g.beginPath(); g.arc(cx + a * s, cy + b * s, v === 1 ? r * 1.5 : r, 0, Math.PI * 2); g.fill(); }
  } else if (T === 'dF') {
    const L = rin * 0.95, W = rin * 0.22;
    if (f.value !== 0) g.fillRect(cx - L / 2, cy - W / 2, L, W);
    if (f.value > 0) g.fillRect(cx - W / 2, cy - L / 2, W, L);
  } else if (T === 'coin') {
    if (f.valued) {
      g.lineWidth = rin * 0.05;
      g.beginPath(); g.arc(cx, cy, rin * 0.86, 0, Math.PI * 2); g.stroke();
      g.lineWidth = rin * 0.02;
      g.beginPath(); g.arc(cx, cy, rin * 0.78, 0, Math.PI * 2); g.stroke();
      text(f.label, cx, cy, rin * 1.05);
    }
  } else if (f.label) {
    const size = { d6: 1.25, d8: 1.15, d10: 1.0, d100: 0.85, d12: 1.0, d20: 1.12 }[T] * rin;
    // d10 kites: the number sits a little toward the wide end
    let y = cy;
    if (T === 'd10' || T === 'd100') y = cy + rin * 0.12;
    text(f.label, cx, y, size, 0, (f.label === '6' || f.label === '9') && T !== 'd6');
  }
  g.restore();
  return { P, rin };
}

const atlasCache = new Map();
export function makeAtlas(die, mat = 'resin', style = 'numbers') {
  const key = `${die.type}|${mat}|${style}`;
  if (atlasCache.has(key)) return atlasCache.get(key);
  const size = die.cols * CELL, F = finish(die.type, mat);
  const color = document.createElement('canvas'); color.width = color.height = size;
  const height = document.createElement('canvas'); height.width = height.height = size;
  const g = color.getContext('2d'), h = height.getContext('2d');
  pattern(g, size, mat, F, die.type.length);
  h.fillStyle = '#fff'; h.fillRect(0, 0, size, size);
  const ink = css(F.ink);
  // a soft blur on the height map rounds the engraving walls
  h.filter = 'blur(1.5px)';
  const geo = [];
  die.faces.forEach((f, i) => {
    const ox = (i % die.cols) * CELL, oy = Math.floor(i / die.cols) * CELL;
    geo.push(drawFace(g, die, f, ox, oy, style, ink, false));
    drawFace(h, die, f, ox, oy, style, '#000', true);
  });
  h.filter = 'none';
  const A = { key, color, height, size, finish: F, geo };
  atlasCache.set(key, A);
  return A;
}
