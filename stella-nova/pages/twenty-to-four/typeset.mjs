// ============================================================================
//  TWENTY TO FOUR  ·  typeset.mjs — TeX to glyph data  (Node, run by hand)
// ----------------------------------------------------------------------------
//  Typesets every entry of tex.js with MathJax 3 (SVG output) and flattens
//  each result into glyph data: one shared table of glyph outlines, and per
//  formula a list of (glyph, affine matrix, colour) and of rules (fraction
//  bars). It writes glyphs.js. The page then needs no math library:
//    math.js eqSVG(key)       inline SVG for the story column (<use> of
//                             one shared <defs>; colours by .m1 to .m6)
//    math.js drawEq(ctx, ..)  the same outlines with Path2D, for the stage
//                             sprites and so for the saver recording
//  KaTeX HTML broke in Safari (hydrogen-table); glyph paths do not.
//
//  RUN (MathJax is not a dependency of the site):
//      cd "$(mktemp -d)" && npm i mathjax-full@3 && \
//        NODE_PATH="$PWD/node_modules" node \
//        <repo>/stella-nova/pages/twenty-to-four/typeset.mjs
//
//  UNITS. MathJax works in 1/1000 em. A formula entry holds its viewBox
//  [x, y, w, h] in those units, y down (MathJax puts scale(1,-1) on the
//  root group; the flattened matrices include it). The baseline is y = 0,
//  so the depth below the baseline is y + h.
//
//  GREP MAP
//      grep -n "function parseTransform"   translate / scale / matrix
//      grep -n "function flatten"          the tree walk
//      grep -n "const COLORS"              class mN -> colour index
// ============================================================================
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEX } from './tex.js';
const require = createRequire((process.env.NODE_PATH || process.cwd() + '/node_modules') + '/');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
require('mathjax-full/js/input/tex/AllPackages.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'boldsymbol'] }), OutputJax: new SVG({ fontCache: 'local' }) });

// Affine matrices as [a, b, c, d, e, f] (SVG order).
const I = [1, 0, 0, 1, 0, 0];
const mm = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function parseTransform(s) {
  let m = I;
  if (!s) return m;
  const re = /(translate|scale|matrix)\(([^)]*)\)/g;
  let x;
  while ((x = re.exec(s))) {
    const v = x[2].trim().split(/[\s,]+/).map(Number);
    let n;
    if (x[1] === 'translate') n = [1, 0, 0, 1, v[0], v[1] || 0];
    else if (x[1] === 'scale') n = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0];
    else n = v;
    m = mm(m, n);
  }
  if (s.replace(re, '').trim()) throw new Error('unknown transform: ' + s);
  return m;
}

// The bounding box [x0, y0, x1, y1] of a glyph path (absolute M L H V Q T
// C Z commands, as MathJax writes them).
function pathBox(d) {
  const tok = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  let cmd = '', x = 0, y = 0, i = 0;
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (px, py) => { b[0] = Math.min(b[0], px); b[1] = Math.min(b[1], py); b[2] = Math.max(b[2], px); b[3] = Math.max(b[3], py); };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) { cmd = tok[i++]; if (cmd === 'Z' || cmd === 'z') continue; }
    if (cmd !== cmd.toUpperCase()) throw new Error('relative path command ' + cmd);
    if (cmd === 'H') { x = +tok[i++]; add(x, y); }
    else if (cmd === 'V') { y = +tok[i++]; add(x, y); }
    else { const n = { M: 2, L: 2, T: 2, Q: 4, S: 4, C: 6 }[cmd]; if (!n) throw new Error('path command ' + cmd);
      for (let j = 0; j < n; j += 2) { x = +tok[i + j]; y = +tok[i + j + 1]; add(x, y); } i += n; }
  }
  return b;
}

const COLORS = { m1: 1, m2: 2, m3: 3, m4: 4, m5: 5, m6: 6 };
const glyphIndex = new Map(), GLYPHS = [];
const r2 = v => Math.round(v * 100) / 100;

// Walk the MathJax tree. Returns { g: [...], r: [...] }.
function flatten(svgNode) {
  const defs = new Map();
  const g = [], r = [];
  const kids = n => (n.children || []);
  const attr = (n, a) => (n.attributes ? n.attributes[a] : undefined);
  for (const d of kids(svgNode)) if (d.kind === 'defs') for (const p of kids(d)) defs.set(attr(p, 'id'), attr(p, 'd'));
  const walk = (n, m, col) => {
    if (!n.kind || n.kind === '#text' || n.kind === '#comment') return;
    if (n.kind === 'defs' || n.kind === 'title') return;
    if (n.kind === 'svg' && n !== svgNode) { clipped(n, m, col); return; }
    const cl = (attr(n, 'class') || '').trim().split(/\s+/).find(c => COLORS[c]);
    const c = cl ? COLORS[cl] : col;
    const M = mm(m, parseTransform(attr(n, 'transform')));
    if (n.kind === 'use') {
      const id = (attr(n, 'xlink:href') || attr(n, 'href') || '').slice(1), d = defs.get(id);
      // Invisible operators (function application, times, separator) have
      // no outline: skip them. Any other missing glyph is an error.
      if (!d && /^(2061|2062|2063|200B)$/.test(attr(n, 'data-c') || '')) return;
      if (!d) throw new Error('missing glyph ' + id);
      if (!glyphIndex.has(d)) { glyphIndex.set(d, GLYPHS.length); GLYPHS.push(d); }
      g.push(glyphIndex.get(d), ...M.map(r2), c);
      return;
    }
    if (n.kind === 'rect') {
      const v = ['x', 'y', 'width', 'height'].map(a => +(attr(n, a) || 0));
      r.push(...v.map(r2), ...M.map(r2), c);
      return;
    }
    if (n.kind === 'path') throw new Error('inline path is not supported');
    for (const k of kids(n)) walk(k, M, c);
  };
  // A nested svg is a clip window round a scaled extender glyph (the long
  // middle of a tall bracket). Extenders are straight strokes, so the
  // glyph's box clipped to the window is the visible shape: emit it as a
  // rule. Anything else inside a nested svg is an error.
  const clipped = (n, m, col) => {
    const [vx, vy, vw, vh] = attr(n, 'viewBox').split(/\s+/).map(Number);
    const x = +(attr(n, 'x') || 0), y = +(attr(n, 'y') || 0);
    if (Math.abs(+attr(n, 'width') - vw) > 1e-6 || Math.abs(+attr(n, 'height') - vh) > 1e-6) throw new Error('scaled nested svg');
    const M = mm(m, [1, 0, 0, 1, x - vx, y - vy]);
    for (const u of kids(n)) {
      if (u.kind !== 'use') throw new Error('nested svg holds ' + u.kind);
      const d = defs.get((attr(u, 'xlink:href') || '').slice(1));
      const T = parseTransform(attr(u, 'transform'));
      if (T[1] || T[2]) throw new Error('rotated extender');
      const b = pathBox(d);
      const x0 = Math.max(vx, T[0] * b[0] + T[4]), x1 = Math.min(vx + vw, T[0] * b[2] + T[4]);
      const ya = T[3] * b[1] + T[5], yb = T[3] * b[3] + T[5];
      const y0 = Math.max(vy, Math.min(ya, yb)), y1 = Math.min(vy + vh, Math.max(ya, yb));
      if (x1 > x0 && y1 > y0) r.push(...[x0, y0, x1 - x0, y1 - y0].map(r2), ...M.map(r2), col);
    }
  };
  for (const k of kids(svgNode)) walk(k, I, 0);
  return { g, r };
}

const EQ = {};
let n = 0;
for (const [key, [tex, mode]] of Object.entries(TEX)) {
  const node = doc.convert(tex, { display: mode === 'd' });
  const svg = adaptor.firstChild(node);
  if (adaptor.innerHTML(node).includes('merror') || adaptor.innerHTML(node).includes('data-mjx-error')) throw new Error('TeX error in ' + key + ': ' + tex);
  const vb = adaptor.getAttribute(svg, 'viewBox').split(/\s+/).map(Number).map(r2);
  let g, r;
  try { ({ g, r } = flatten(svg)); } catch (e) { throw new Error(key + ': ' + e.message + '\n' + adaptor.innerHTML(node).replace(/ d="[^"]*"/g, '').slice(0, 1500)); }
  const label = tex.replace(/\\class\{m\d\}/g, '').replace(/\s+/g, ' ');
  EQ[key] = [vb, mode, g, r, label];
  n++;
}

const js = `// ============================================================================
//  TWENTY TO FOUR  ·  glyphs.js  (GENERATED by typeset.mjs — do not edit)
// ----------------------------------------------------------------------------
//  Change the TeX in tex.js and run typeset.mjs again (see its header).
//  GLYPHS   glyph outlines (SVG path data, 1/1000 em, y down after the
//           matrix), shared by all formulas
//  EQ[key]  [viewBox, mode, glyphs, rules, label]
//           glyphs: runs of 8 numbers: glyph index, a b c d e f, colour
//           rules:  runs of 11 numbers: x y w h, a b c d e f, colour
//           colour 0 is ink, 1 to 6 the lib/sci.css classes m1 to m6
//  math.js reads it.
// ============================================================================
export const GLYPHS = ${JSON.stringify(GLYPHS)};
export const EQ = ${JSON.stringify(EQ)};
`;
const dest = fileURLToPath(new URL('./glyphs.js', import.meta.url));
writeFileSync(dest, js);
console.log('wrote', dest, js.length, 'bytes,', n, 'formulas,', GLYPHS.length, 'glyphs');
