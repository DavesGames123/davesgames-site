// ============================================================================
//  FISHDRAW  ·  svg.js — a plate as SVG text and as plate polylines (no DOM)
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  plateSVG() writes the same layout that render.js draws: paper, blueprint
//  grid, border rules, type, and each fish as one <path>. The file is in
//  millimetres (width="210mm", viewBox in mm), so a pen plotter or a print
//  gets the true size. Points are moved into plate mm here, not with a
//  transform attribute, so the pen width is plain mm too. The paper grain
//  and the vignette are raster effects and stay out of the SVG.
//
//  platePolylines() gives every fish line in plate mm, for the JSON and CSV
//  files of a grid (the upstream formats, one list for the whole plate).
//
//  GREP MAP
//    grep -n 'export function plateSVG'        the SVG text
//    grep -n 'export function platePolylines'  the lines in plate mm
//    grep -n 'export function xmlEscape'       text and attribute escape
// ============================================================================
import { fishPoints, SERIF } from './render.js';

export function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
const n3 = v => (Math.round(v * 1000) / 1000).toString();

// Each polyline of fish f in cell c as [[x, y], ..] in plate mm.
export function cellLines(f, c, jitter) {
  const xy = fishPoints(f, jitter).xy, out = [];
  for (let i = 0; i + 1 < f.offs.length; i++) {
    const pl = [];
    for (let k = f.offs[i]; k < f.offs[i + 1]; k++) pl.push([c.fx + xy[k * 2] * c.k, c.fy + xy[k * 2 + 1] * c.k]);
    if (pl.length > 1) out.push(pl);
  }
  return out;
}
export function platePolylines(L, fishes, jitter = 0) {
  const out = [];
  for (const c of L.cells) if (fishes[c.i]) out.push(...cellLines(fishes[c.i], c, jitter).map(pl => pl.map(([x, y]) => [+n3(x), +n3(y)])));
  return out;
}

// o: { theme, ink, pen (mm), jitter, title (document title) }
export function plateSVG(L, fishes, o) {
  const t = o.theme, ink = o.ink || t.ink;
  const W = n3(L.w), H = n3(L.h);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`);
  out.push(`<title>${xmlEscape(o.title || 'fishdraw plate')}</title>`);
  out.push('<desc>Drawn with fishdraw by Lingdong Huang (MIT), https://github.com/LingDong-/fishdraw. Plate layout from davesgames.io.</desc>');
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${t.paper}"/>`);
  if (t.grid) {
    const d = [];
    for (let x = 0; x <= L.w; x += 5) d.push(`M${n3(x)} 0V${H}`);
    for (let y = 0; y <= L.h; y += 5) d.push(`M0 ${n3(y)}H${W}`);
    out.push(`<path d="${d.join('')}" stroke="${t.grid}" stroke-width="0.08" fill="none"/>`);
  }
  for (const r of L.rules) out.push(`<rect x="${n3(r.x)}" y="${n3(r.y)}" width="${n3(r.w)}" height="${n3(r.h)}" fill="none" stroke="${t.rule}" stroke-width="${n3(r.lw)}"/>`);
  const font = xmlEscape(SERIF.replace(/"/g, "'"));
  for (const x of L.texts) {
    if (x.role === 'num') {
      out.push(`<text x="${n3(x.x)}" y="${n3(x.y)}" font-family="${font}" font-size="${n3(x.size)}" fill="${t.text}" text-anchor="middle">${xmlEscape(x.text)} <tspan font-style="italic">${xmlEscape(x.name)}</tspan></text>`);
      continue;
    }
    const anchor = x.align === 'left' ? 'start' : x.align === 'right' ? 'end' : 'middle';
    out.push(`<text x="${n3(x.x)}" y="${n3(x.y)}" font-family="${font}" font-size="${n3(x.size)}" fill="${t.text}" text-anchor="${anchor}"${x.style === 'italic' ? ' font-style="italic"' : ''}>${xmlEscape(x.text)}</text>`);
  }
  out.push(`<g fill="none" stroke="${ink}" stroke-width="${n3(o.pen)}" stroke-linecap="round" stroke-linejoin="round">`);
  for (const c of L.cells) {
    const f = fishes[c.i];
    if (!f) continue;
    const d = cellLines(f, c, o.jitter || 0).map(pl => 'M' + pl.map(([x, y]) => n3(x) + ' ' + n3(y)).join('L')).join('');
    out.push(`<path data-cell="${c.i + 1}" data-name="${xmlEscape(f.name)}" d="${d}"/>`);
  }
  out.push('</g>');
  out.push('</svg>');
  return out.join('\n') + '\n';
}
