// ============================================================================
//  FISHDRAW  ·  export.js — files and the share link
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  main.js calls these with the plate on show:
//    exportPlateSVG   the plate as SVG in mm (svg.js plateSVG)
//    exportPNG        the plate at a chosen DPI, drawn by render.js
//    exportUpstream   the single fish in the upstream formats: svg (the
//                     upstream draw_svg), smil (draw_svg_anim), json, csv.
//                     For a grid, json and csv hold the plate polylines in mm.
//    copyLink         the page URL with the share hash, to the clipboard
//
//  PNG SIZE. Safari refuses a canvas of more than 16 777 216 px (4096 x
//  4096). pngSize() lowers the DPI until the plate fits, and says so.
//
//  GREP MAP
//    grep -n 'export function pngSize'     the DPI clamp
//    grep -n 'export function exportPNG'   the raster file
//    grep -n 'export function copyLink'    the clipboard, with a fallback
// ============================================================================
import { plateSVG, platePolylines } from './svg.js';
import { drawPlate } from './render.js';
import { unflatten, upstreamJSON, upstreamCSV } from './engine.js';

const MAX_AREA = 16777216, MAX_SIDE = 16384;

export function download(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
export function slug(s) {
  return String(s || 'fish').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fish';
}

export function exportPlateSVG(L, fishes, o, name) {
  download(new Blob([plateSVG(L, fishes, o)], { type: 'image/svg+xml' }), name + '.svg');
}

// { w, h, dpi, clamped } in px for a plate of L.w x L.h mm at dpi.
export function pngSize(L, dpi) {
  let d = dpi;
  const px = v => Math.round(v / 25.4 * d);
  while (d > 24 && (px(L.w) * px(L.h) > MAX_AREA || px(L.w) > MAX_SIDE || px(L.h) > MAX_SIDE)) d = Math.floor(d * 0.9);
  return { w: px(L.w), h: px(L.h), dpi: d, clamped: d !== dpi };
}
export function exportPNG(L, fishes, o, dpi, name) {
  const z = pngSize(L, dpi);
  const c = document.createElement('canvas'); c.width = z.w; c.height = z.h;
  const x = c.getContext('2d');
  drawPlate(x, { L, theme: o.theme, ink: o.ink, pen: o.pen, jitter: o.jitter, view: { s: z.w / L.w, ox: 0, oy: 0 },
    fishes, progress: fishes.map(() => null), grain: o.grain, marker: false, hiCell: -1, paperOut: false, dpr: z.dpi / 96 });
  return new Promise(res => c.toBlob(b => { if (b) download(b, `${name}-${z.dpi}dpi.png`); res(z); }, 'image/png'));
}

// fmt: 'svg' | 'smil' | 'json' | 'csv'. E: an engine (for draw_svg and
// draw_svg_anim). fish: the single fish, or null for a grid (L, fishes).
export function exportUpstream(fmt, E, { fish, L, fishes, jitter, speed, name }) {
  const lines = fish ? unflatten(fish) : platePolylines(L, fishes, jitter);
  if (fmt === 'svg') download(new Blob([E.draw_svg(lines)], { type: 'image/svg+xml' }), name + '-upstream.svg');
  else if (fmt === 'smil') download(new Blob([E.draw_svg_anim(lines, speed)], { type: 'image/svg+xml' }), name + '-animated.svg');
  else if (fmt === 'json') download(new Blob([upstreamJSON(lines)], { type: 'application/json' }), name + '.json');
  else if (fmt === 'csv') download(new Blob([upstreamCSV(lines)], { type: 'text/csv' }), name + '.csv');
}

// Resolves to true when the clipboard took the link. On false the caller
// shows the link in a text field to copy by hand.
export async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); return true; } catch (e) { /* no permission in a frame */ }
  try {
    const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select();
    const ok = document.execCommand('copy'); t.remove();
    return ok;
  } catch (e) { return false; }
}
