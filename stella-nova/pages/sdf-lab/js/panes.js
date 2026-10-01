// ============================================================================
//  SDF FORGE  ·  panes.js — the viewport layout
// ----------------------------------------------------------------------------
//  PURE. Which panes show, where each sits, and what each draws with.
//
//  EVERY SLOT KEEPS ITS OWN CAMERA, and the camera outlives the layout. A
//  layout is a choice of slots, so going Single to Quad and back returns the
//  perspective pane to the frame it left (Forge viewport/mod.rs).
//
//  A SLOT OWNS its view name, its camera, its ortho flag, its shading mode
//  and its construction plane (Forge decision 15). Axis views open in CLAY:
//  there is no wireframe of a distance field, and clay is the cheap mode,
//  which matters when four panes march at once.
//
//  paneAt USES HALF-OPEN RECTANGLES: x <= px < x + w. A pointer in the
//  GUTTER between panes addresses nothing.
//
//  GREP MAP
//    SLOT_VIEWS / MODES / newPanes ..... the default four slots
//    visibleSlots / rects / paneAt ..... the layout
//    setView / planeOf / gates ......... view presets, construction planes,
//                                        the per-pane grid gate (decision 17)
// ============================================================================
import { makeCam, VIEWS, basis } from './camera.js';

export const GUTTER = 3;
// The SLICE plane: normal, and the in-plane axes that point right and up.
export const SLICE_AX = {
  xy: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], label: 'XY' },
  xz: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], label: 'XZ' },
  yz: { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], label: 'YZ' },
};
export const MODES = ['clay', 'lit', 'normals', 'steps', 'bands', 'slice'];
export const MODE_LABEL = { clay: 'CLAY', lit: 'LIT', normals: 'NORMALS', steps: 'STEPS', bands: 'BANDS', slice: 'SLICE' };
export const VIEW_LABEL = { top: 'TOP', front: 'FRONT', left: 'LEFT', right: 'RIGHT', back: 'BACK', bottom: 'BOTTOM', persp: 'PERSPECTIVE', iso: 'ISO', user: 'ORBIT' };
const AXIS = { top: 0, bottom: 0, front: 1, back: 1, left: 2, right: 2 };

export function newPanes() {
  const slot = (view, mode, ortho) => ({ view, mode, ortho, cam: makeCam(view) });
  return {
    layout: 'single', prev: 'quad', active: 3,
    slots: [slot('top', 'clay', true), slot('front', 'clay', true), slot('left', 'clay', true), slot('persp', 'lit', false)],
  };
}
export function visibleSlots(S, phone = false) {
  if (phone || S.layout === 'single') return [S.active];
  if (S.layout === 'split') return [3, 1].includes(S.active) ? [3, 1] : [S.active, 3];
  return [0, 1, 2, 3];
}
// Pane rectangles in CSS px inside a W x H area.
export function rects(S, W, H, phone = false) {
  const vis = visibleSlots(S, phone), g = GUTTER, out = [];
  if (vis.length === 1) out.push({ slot: vis[0], x: 0, y: 0, w: W, h: H });
  else if (vis.length === 2) {
    const w0 = Math.floor((W - g) / 2);
    out.push({ slot: vis[0], x: 0, y: 0, w: w0, h: H }, { slot: vis[1], x: w0 + g, y: 0, w: W - w0 - g, h: H });
  } else {
    const w0 = Math.floor((W - g) / 2), h0 = Math.floor((H - g) / 2);
    out.push({ slot: 0, x: 0, y: 0, w: w0, h: h0 }, { slot: 1, x: w0 + g, y: 0, w: W - w0 - g, h: h0 },
      { slot: 2, x: 0, y: h0 + g, w: w0, h: H - h0 - g }, { slot: 3, x: w0 + g, y: h0 + g, w: W - w0 - g, h: H - h0 - g });
  }
  return out;
}
export function paneAt(R, x, y) {
  for (const r of R) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  return null;
}
export function setView(slot, view) {
  const v = VIEWS[view];
  if (!v) return;
  slot.view = view;
  slot.cam.yaw = v.yaw; slot.cam.pitch = v.pitch;
  slot.ortho = view in AXIS;
}
// The construction plane of a slot: 0 ground XZ, 1 front XY, 2 side YZ.
// An orbited pane keeps the plane its view had; perspective uses the ground.
export function planeOf(slot) { return slot.ortho && slot.view in AXIS ? AXIS[slot.view] : 0; }
export const PLANE_NORMAL = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
export const PLANE_U = [[1, 0, 0], [1, 0, 0], [0, 0, 1]];
export const PLANE_V = [[0, 0, 1], [0, 1, 0], [0, 1, 0]];
// The grid gate of each plane: the pane's own plane is never gated; another
// plane opens when the view direction is within about 20 degrees of its
// normal and is full by about 6 degrees (Forge decision 17).
export function gates(slot) {
  const own = planeOf(slot), f = basis(slot.cam).fwd;
  return [0, 1, 2].map(k => {
    if (k === own) return 1;
    if (slot.ortho) return 0;
    const c = Math.abs(f[0] * PLANE_NORMAL[k][0] + f[1] * PLANE_NORMAL[k][1] + f[2] * PLANE_NORMAL[k][2]);
    const lo = Math.cos(20 * Math.PI / 180), hi = Math.cos(6 * Math.PI / 180);
    const x = Math.min(1, Math.max(0, (c - lo) / (hi - lo)));
    return x * x * (3 - 2 * x);
  });
}
