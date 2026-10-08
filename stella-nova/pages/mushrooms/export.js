// ============================================================================
//  MUSHROOM DRAW  ·  export.js — files and the clipboard
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). main.js calls these with the plate on show:
//    exportSVG    the plate as SVG in mm (svg.js plateSVG)
//    exportPNG    the plate at a DPI, drawn by render.js; plate.js pngSize
//                 lowers the DPI until Safari accepts the canvas
//    exportJSON   the visible polylines in plate mm, one list per cell
//    copyLink     the page URL with the share hash, to the clipboard
//
//  GREP MAP
//    grep -n 'export function exportPNG'   the raster file
//    grep -n 'export function exportJSON'  the plotter lines
//    grep -n 'export async function copyLink' the clipboard, with a fallback
// ============================================================================
import { plateSVG } from './svg.js';
import { drawPlate, specPoints } from './render.js';
import { withCredit, pngSize, fitSpec } from './plate.js';

export function download(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
export function slug(s) {
  return String(s || 'mushroom').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mushroom';
}
export function exportSVG(L, specs, o, name) {
  download(new Blob([plateSVG(L, specs, o)], { type: 'image/svg+xml' }), name + '.svg');
}
export function exportPNG(L0, specs, o, dpi, name) {
  const L = withCredit(L0), z = pngSize(L, dpi);
  const c = document.createElement('canvas'); c.width = z.w; c.height = z.h;
  drawPlate(c.getContext('2d'), { L, theme: o.theme, ink: o.ink, style: o.style, pen: o.pen, jitter: o.jitter, view: { s: z.w / L.w, ox: 0, oy: 0 },
    specs, progress: null, grain: o.grain, marker: false, hiCell: -1, paperOut: false, dpr: z.dpi / 96, scale: o.scale });
  return new Promise(res => c.toBlob(b => { if (b) download(b, `${name}-${z.dpi}dpi.png`); res(z); }, 'image/png'));
}
export function exportJSON(L, specs, o, name) {
  const r3 = v => Math.round(v * 1000) / 1000;
  const cells = [];
  for (const c of L.cells) {
    const f = specs[c.i];
    if (!f) continue;
    const fit = fitSpec(f, c), xy = specPoints(f, o.jitter || 0).xy, lines = [];
    for (let i = 0; i + 1 < f.offs.length; i++) {
      const pl = [];
      for (let k = f.offs[i]; k < f.offs[i + 1]; k++) pl.push([r3(fit.ox + xy[k * 2] * fit.k), r3(fit.oy + xy[k * 2 + 1] * fit.k)]);
      lines.push(pl);
    }
    cells.push({ cell: c.i + 1, name: f.name, seed: f.seed, params: f.params, kinds: Array.from(f.kinds), polylines: lines });
  }
  const doc = { units: 'mm', width: r3(L.w), height: r3(L.h), credit: 'Mushroom Draw, davesgames.io (after fishdraw and shan-shui-inf by Lingdong Huang)', cells };
  download(new Blob([JSON.stringify(doc)], { type: 'application/json' }), name + '.json');
}
export async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); return true; } catch (e) { /* no permission in a frame */ }
  try {
    const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select();
    const ok = document.execCommand('copy'); t.remove();
    return ok;
  } catch (e) { return false; }
}
