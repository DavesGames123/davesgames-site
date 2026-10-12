// ============================================================================
//  TWENTY TO FOUR  ·  math.js — draw the glyph data of glyphs.js
// ----------------------------------------------------------------------------
//  Two outputs from one source (typeset.mjs flattened MathJax SVG):
//    eqSVG(key)              inline SVG markup. Each glyph is a <use> of one
//                            shared <defs> (installDefs puts it in the body
//                            once). Colours come from lib/sci.css .m1 to .m6.
//    drawEq(ctx, key, x, y, px, opts)
//                            the same outlines on a 2D canvas with Path2D,
//                            baseline at y, px = font size in canvas px.
//                            The stage turns these canvases into textures.
//    eqBox(key, px)          { w, h, asc, desc } in px for that font size
//  Sizes: 1 em = 1000 units of the viewBox; the formula keeps its TeX size.
//
//  GREP MAP
//      grep -n "export const INK"       canvas colours of ink and m1..m6
//      grep -n "export function installDefs"
//      grep -n "export function eqSVG"
//      grep -n "export function drawEq"
// ============================================================================
import { GLYPHS, EQ } from './glyphs.js';

export { EQ };
// The canvas colours: ink, then m1..m6 (lib/sci.css --m1..--m6).
export const INK = ['#eef2f4', '#62c4ff', '#ff9a62', '#86dc7c', '#e889dc', '#ffd666', '#a8a4ff'];
const r2 = v => Math.round(v * 100) / 100;

export function has(key) { return Object.prototype.hasOwnProperty.call(EQ, key); }

// One hidden <svg><defs> with every glyph, id t24g<i>.
export function installDefs(doc = document) {
  if (doc.getElementById('t24-glyphs')) return;
  const box = doc.createElement('div');
  box.innerHTML = `<svg id="t24-glyphs" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${GLYPHS.map((d, i) => `<path id="t24g${i}" d="${d}"/>`).join('')}</defs></svg>`;
  doc.body.appendChild(box.firstChild);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Inline SVG for one formula. The size follows the font size of its box.
export function eqSVG(key, extraClass = '') {
  const q = EQ[key];
  if (!q) return `<span class="raw">${esc(key)}</span>`;
  const [[x, y, w, h], , g, r, label] = q;
  let s = `<svg class="mj${extraClass ? ' ' + extraClass : ''}" viewBox="${x} ${y} ${w} ${h}" style="width:${r2(w / 1000)}em;height:${r2(h / 1000)}em;vertical-align:${r2(-(y + h) / 1000)}em" role="img" aria-label="${esc(label)}" fill="currentColor">`;
  for (let i = 0; i < g.length; i += 8) {
    const c = g[i + 7];
    s += `<use xlink:href="#t24g${g[i]}" href="#t24g${g[i]}" transform="matrix(${g.slice(i + 1, i + 7).join(' ')})"${c ? ` class="m${c}"` : ''}/>`;
  }
  for (let i = 0; i < r.length; i += 11) {
    const c = r[i + 10];
    s += `<rect x="${r[i]}" y="${r[i + 1]}" width="${r[i + 2]}" height="${r[i + 3]}" transform="matrix(${r.slice(i + 4, i + 10).join(' ')})"${c ? ` class="m${c}"` : ''}/>`;
  }
  return s + '</svg>';
}

// The box of a formula at font size px: width, height, ascent above the
// baseline, descent below it.
export function eqBox(key, px) {
  const [[, y, w, h]] = EQ[key];
  const k = px / 1000;
  return { w: w * k, h: h * k, asc: -y * k, desc: (y + h) * k };
}

let paths = null;
function path(i) {
  if (!paths) paths = new Array(GLYPHS.length);
  return paths[i] || (paths[i] = new Path2D(GLYPHS[i]));
}

// Draw a formula with its left edge at x and baseline at y, font size px.
// opts: { colors (array of 7), alpha, mono (one colour for all) }
export function drawEq(ctx, key, x, y, px, opts = {}) {
  const q = EQ[key];
  if (!q) return;
  const [[vx], , g, r] = q;
  const k = px / 1000, cols = opts.colors || INK;
  ctx.save();
  ctx.translate(x - vx * k, y);
  ctx.scale(k, k);
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  const base = ctx.getTransform();
  for (let i = 0; i < g.length; i += 8) {
    ctx.setTransform(base);
    ctx.transform(g[i + 1], g[i + 2], g[i + 3], g[i + 4], g[i + 5], g[i + 6]);
    ctx.fillStyle = opts.mono || cols[g[i + 7]];
    ctx.fill(path(g[i]));
  }
  for (let i = 0; i < r.length; i += 11) {
    ctx.setTransform(base);
    ctx.transform(r[i + 4], r[i + 5], r[i + 6], r[i + 7], r[i + 8], r[i + 9]);
    ctx.fillStyle = opts.mono || cols[r[i + 10]];
    ctx.fillRect(r[i], r[i + 1], r[i + 2], r[i + 3]);
  }
  ctx.restore();
}
