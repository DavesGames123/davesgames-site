// app/layout.js -- the pane layout, the pane regions, and the CSS to physical pixel map.
//
// The panes sit side by side when the stage is wider than tall, and stack when
// it is taller (app.rs layout), unless S.layoutMode forces one. measure reads
// the DOM once per frame into geom2d and geom3d: the scissor rect of each pane
// and the fit region inside its label and bar. The draw, hover and pointer
// code read these regions. dpr is the device pixel ratio that resize sets.
//
// grep map:
//   stage / canvas / pane2dEl / pane3dEl -- the DOM nodes
//   let dpr / resize   -- the pixel ratio and the canvas size
//   applyLayout        -- side by side or stacked
//   paneGeom / measure -- the pane rects and fit regions (geom2d, geom3d)
//   view2d / region3d  -- the diagram view and the fold region, with pan
//   phys / paneAt      -- CSS px to physical px, and the pane under a point
//   snapPx             -- the snap radius in physical px

import { View2D } from '../view.js';
import { COARSE, $, S, gpu } from './state.js';

export const stage = $('stage');
export const canvas = $('gl');
export const pane2dEl = $('pane2d'), pane3dEl = $('pane3d');

// The device pixel ratio, capped. resize sets it.
export let dpr = 1;

// The layout by aspect ratio (app.rs layout), or the forced mode.
export function applyLayout() {
  const r = stage.getBoundingClientRect();
  const horiz = S.layoutMode === 'h' || (S.layoutMode === 'auto' && r.width >= r.height);
  stage.classList.toggle('horiz', horiz);
  stage.classList.toggle('vert', !horiz);
}

// Pane geometry in physical pixels: the scissor rect, and the fit region that
// leaves room for the label at the top and the bar at the base.
function paneGeom(el, labelEl, barEl) {
  const c = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const rect = [(r.left - c.left) * dpr, (r.top - c.top) * dpr, (r.right - c.left) * dpr, (r.bottom - c.top) * dpr];
  let top = r.top, bottom = r.bottom;
  const lb = labelEl.getBoundingClientRect();
  if (lb.height) top = Math.max(top, lb.bottom);
  if (barEl) {
    const bb = barEl.getBoundingClientRect();
    if (bb.height && getComputedStyle(barEl).display !== 'none') bottom = Math.min(bottom, bb.top);
  }
  if (bottom - top < 60) { top = r.top; bottom = r.bottom; }
  const fit = [(r.left - c.left) * dpr, (top - c.top) * dpr, (r.right - c.left) * dpr, (bottom - c.top) * dpr];
  return { rect, fit };
}

export let geom2d = null, geom3d = null;
export function measure() {
  geom2d = paneGeom(pane2dEl, $('label2d'), $('editBar'));
  geom3d = paneGeom(pane3dEl, $('label3d'), $('foldBar'));
}

export function view2d() {
  return View2D.fit(geom2d.fit, 14 * dpr, S.zoom2d, [S.pan2d[0] * dpr, S.pan2d[1] * dpr]);
}
export function region3d() {
  const f = geom3d.fit;
  return [f[0] + S.pan3d[0] * dpr, f[1] + S.pan3d[1] * dpr, f[2] + S.pan3d[0] * dpr, f[3] + S.pan3d[1] * dpr];
}
const inRect = (r, p) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
export const phys = (p) => [p[0] * dpr, p[1] * dpr];
export function paneAt(cssP) {
  if (!geom2d) return null;
  const p = phys(cssP);
  if (inRect(geom2d.rect, p)) return '2d';
  if (inRect(geom3d.rect, p)) return '3d';
  return null;
}
export const snapPx = () => (COARSE ? 16 : 8) * dpr;

// Size the canvas to the stage, in physical pixels.
export function resize() {
  const r = stage.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, COARSE ? 2 : 3);
  if (gpu) gpu.resize(r.width * dpr, r.height * dpr);
}
