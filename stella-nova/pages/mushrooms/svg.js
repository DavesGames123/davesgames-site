// ============================================================================
//  MUSHROOM DRAW  ·  svg.js — a plate as SVG text in millimetres (no DOM)
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). plateSVG() writes the layout that
//  render.js draws: paper, grid, rules, type, washes, then the lines. The
//  file is in mm (width="210mm", viewBox in mm), so a pen plotter or a
//  print gets the true size. The lines are already hidden-line clean, so
//  the pen style is plotter-ready: one <path> per line kind. The brush
//  style writes filled stroke outlines; the grain is raster and stays out.
//
//  GREP MAP
//    grep -n 'export function plateSVG'   the SVG text
//    grep -n 'export function xmlEscape'  text and attribute escape
// ============================================================================
import { specPoints, brushPolys, washFill, PEN_K, SERIF } from './render.js';
import { withCredit, fitSpec, scaleBar, specExtras } from './plate.js';

export function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
const n3 = v => (Math.round(v * 1000) / 1000).toString();

// o: { theme, ink, style, pen (mm), jitter, title, scale, credit }
export function plateSVG(L0, specs, o) {
  const L = o.credit === false ? L0 : withCredit(L0);
  const t = o.theme, ink = o.ink || t.ink, style = o.style || 'pen';
  const W = n3(L.w), H = n3(L.h), out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`);
  out.push(`<title>${xmlEscape(o.title || 'Mushroom Draw plate')}</title>`);
  out.push('<desc>Procedural mushrooms by Mushroom Draw (davesgames.io), original code in the spirit of fishdraw and shan-shui-inf by Lingdong Huang (https://github.com/LingDong-). Hidden lines are removed, so each path is a visible pen stroke.</desc>');
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${t.paper}"/>`);
  if (t.grid) {
    const d = [];
    for (let x = 0; x <= L.w; x += 5) d.push(`M${n3(x)} 0V${H}`);
    for (let y = 0; y <= L.h; y += 5) d.push(`M0 ${n3(y)}H${W}`);
    out.push(`<path d="${d.join('')}" stroke="${t.grid}" stroke-width="0.08" fill="none"/>`);
  }
  for (const r of L.rules) out.push(`<rect x="${n3(r.x)}" y="${n3(r.y)}" width="${n3(r.w)}" height="${n3(r.h)}" fill="none" stroke="${t.rule}" stroke-width="${n3(r.lw)}"/>`);
  const font = xmlEscape(SERIF.replace(/"/g, "'"));
  const one = L.cells.length === 1 && specs[0] ? specExtras(specs[0], L.cells[0], fitSpec(specs[0], L.cells[0])) : null;
  for (const x0 of L.texts) {
    const x = one && x0.role === 'num' ? Object.assign({}, x0, { y: one.labelY }) : x0;
    if (x.role === 'num') {
      out.push(`<text x="${n3(x.x)}" y="${n3(x.y)}" font-family="${font}" font-size="${n3(x.size)}" fill="${t.text}" text-anchor="middle">${xmlEscape(x.text)} <tspan font-style="italic">${xmlEscape(x.name)}</tspan></text>`);
      continue;
    }
    const anchor = x.align === 'left' ? 'start' : x.align === 'right' ? 'end' : 'middle';
    out.push(`<text x="${n3(x.x)}" y="${n3(x.y)}" font-family="${font}" font-size="${n3(x.size)}" fill="${t.text}" text-anchor="${anchor}"${x.style === 'italic' ? ' font-style="italic"' : ''}>${xmlEscape(x.text)}</text>`);
  }
  for (const c of L.cells) {
    const f = specs[c.i];
    if (!f) continue;
    const fit = fitSpec(f, c), k = fit.k;
    const X = v => n3(fit.ox + v * k), Y = v => n3(fit.oy + v * k);
    out.push(`<g data-cell="${c.i + 1}" data-name="${xmlEscape(f.name)}">`);
    for (const w of f.washes) {
      const fill = washFill(t, ink, style, w.color);
      if (!fill) continue;
      let d = 'M';
      for (let i = 0; i < w.xy.length; i += 2) d += (i ? 'L' : '') + X(w.xy[i]) + ' ' + Y(w.xy[i + 1]);
      out.push(`<path d="${d}Z" fill="${fill}"/>`);
    }
    const xy = specPoints(f, o.jitter || 0).xy;
    if (style === 'brush') {
      const polys = brushPolys(f, o.jitter || 0, o.pen / k);
      let d = '';
      for (const q of polys) {
        if (!q) continue;
        d += 'M' + X(q[0]) + ' ' + Y(q[1]);
        for (let i = 2; i < q.length; i += 2) d += 'L' + X(q[i]) + ' ' + Y(q[i + 1]);
        d += 'Z';
      }
      out.push(`<path d="${d}" fill="${ink}" fill-rule="nonzero"/>`);
    } else {
      for (let kind = 0; kind < 4; kind++) {
        let d = '';
        for (let i = 0; i + 1 < f.offs.length; i++) {
          if (f.kinds[i] !== kind) continue;
          const a = f.offs[i], b = f.offs[i + 1];
          if (b - a < 2) continue;
          d += 'M' + X(xy[a * 2]) + ' ' + Y(xy[a * 2 + 1]);
          for (let j = a + 1; j < b; j++) d += 'L' + X(xy[j * 2]) + ' ' + Y(xy[j * 2 + 1]);
        }
        if (d) out.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${n3(o.pen * PEN_K[kind])}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
    }
    out.push('</g>');
    if (o.scale) {
      const ex = specExtras(f, c, fit), sb = scaleBar(k, Math.min(c.aw * 0.14, f.bbox.w * k * 0.3)), bx = ex.barX, by = ex.barY, tick = ex.fs * 0.45;
      const th = Math.max(0.15, Math.min(c.aw, c.ah) * 0.002) * 2;
      out.push(`<path d="M${n3(bx)} ${n3(by)}H${n3(bx + sb.len)}M${n3(bx)} ${n3(by)}V${n3(by - tick)}M${n3(bx + sb.len / 2)} ${n3(by)}V${n3(by - tick * 0.6)}M${n3(bx + sb.len)} ${n3(by)}V${n3(by - tick)}" stroke="${t.text}" stroke-width="${n3(th)}" fill="none"/>`);
      out.push(`<text x="${n3(bx + sb.len + c.aw * 0.012)}" y="${n3(by)}" font-family="${font}" font-size="${n3(ex.fs)}" fill="${t.text}">${xmlEscape(sb.text)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}
