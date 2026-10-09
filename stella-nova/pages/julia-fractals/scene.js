// ============================================================================
//  JULIA FRACTALS  ·  pages/julia-fractals/scene.js — schema and view rules
// ----------------------------------------------------------------------------
//  No DOM, so main.js and tests.mjs use the same rules:
//    makeSchema(phone), guard(next, prev, rng), viewOf(st, t, W, H),
//    paintOf(st, lut), INSIDE
//  Our code (davesgames.io); the upstream credit is in fractal.js.
//  grep -n targets: "export function makeSchema", "export function guard",
//  "export function viewOf", "export function paintOf"
// ============================================================================
import * as K from '../../widgets/sim-kit/core.js';
import { PATHS, SPOTS, cAt } from './fractal.js';

export const INSIDE = { black: [0, 0, 0], white: [245, 245, 245], deep: [8, 10, 24], map: null };

export function makeSchema(PHONE) {
  return { groups: [
    { id: 'fractal', label: 'Fractal', controls: [
      { key: 'mode', type: 'choice', label: 'Set', value: 'julia', options: [{ id: 'julia', label: 'Julia' }, { id: 'mandel', label: 'Mandelbrot' }], random: { weights: { julia: 4, mandel: 1 } } },
      { key: 'path', type: 'choice', label: 'Path of c', value: 'cardioid', seg: false, options: PATHS.map(id => ({ id, label: { still: 'Still', circle: 'Circle', cardioid: 'Main cardioid', bulb: 'Period-2 bulb', lissajous: 'Lissajous', wander: 'Wander' }[id] })),
        random: { weights: { still: 1, circle: 2, cardioid: 3, bulb: 2, lissajous: 1, wander: 3 } } },
      { key: 'pathK', type: 'range', label: 'Path scale', min: 0.8, max: 1.15, step: 0.005, value: 0.99, random: { min: 0.94, max: 1.04 } },
      { key: 'pathSpeed', type: 'range', label: 'Path speed', min: 0.1, max: 6, step: 0.1, value: 1.2, unit: 'turns/min', random: { min: 0.4, max: 2.5 } },
      { key: 'cRe', type: 'range', label: 'c (real)', min: -2, max: 1, step: 0.0001, value: -0.6258, digits: 4, random: { min: -1.3, max: 0.4 } },
      { key: 'cIm', type: 'range', label: 'c (imaginary)', min: -1.2, max: 1.2, step: 0.0001, value: 0.4025, digits: 4, random: { min: -0.8, max: 0.8 } },
      { key: 'iters', type: 'range', label: 'Iterations', min: 10, max: 1000, step: 1, value: 200, random: { min: 80, max: 400 } },
      { key: 'power', type: 'range', label: 'Power d (z^d + c)', min: 2, max: 6, step: 0.05, value: 2, random: { min: 2, max: 5 } },
    ] },
    { id: 'view', label: 'View', random: false, hint: 'Drag to pan, wheel or pinch to zoom. Shift-drag, or "Drag moves c", changes c (upstream).', controls: [
      { key: 'zoom', type: 'range', label: 'Zoom (log10 of the view height)', min: -6, max: 0.7, step: 0.01, value: 0.48, digits: 2 },
      { key: 'cx', type: 'range', label: 'Centre (real)', min: -2.5, max: 1.5, step: 1e-12, value: 0, digits: 9 },
      { key: 'cy', type: 'range', label: 'Centre (imaginary)', min: -1.5, max: 1.5, step: 1e-12, value: 0, digits: 9 },
      { key: 'dive', type: 'toggle', label: 'Dive (zoom in and out)', value: false },
      { key: 'spot', type: 'choice', label: 'Dive to', value: 'seahorse', seg: false, options: SPOTS.map(s => ({ id: s.id, label: s.name })) },
      { key: 'dragC', type: 'toggle', label: 'Drag moves c', value: false },
      { type: 'button', key: 'home', label: 'Reset the view', action: 'home' },
    ] },
    { id: 'look', label: 'Look', controls: [
      { key: 'color', type: 'choice', label: 'Colouring', value: 'smooth', seg: false, options: [{ id: 'smooth', label: 'Smooth map' }, { id: 'bands', label: 'Bands' }, { id: 'gradient', label: 'Gradient (upstream)' }, { id: 'mono', label: 'Mono (upstream)' }],
        random: { weights: { smooth: 6, bands: 2, gradient: 1, mono: 1 } } },
      { key: 'cmap', type: 'cmap', label: 'Colour map', value: 'twilight', random: { pick: K.CMAP_DRAW.concat(['phase-wheel', 'twilight-shifted']) } },
      { key: 'density', type: 'range', label: 'Colour density', min: 1, max: 48, step: 0.5, value: 16, random: { dist: 'log', min: 5, max: 40 } },
      { key: 'offset', type: 'range', label: 'Colour offset', min: 0, max: 1, step: 0.01, value: 0 },
      { key: 'cycle', type: 'range', label: 'Colour cycling', min: 0, max: 0.6, step: 0.01, value: 0.05, unit: 'turns/s', random: { min: 0, max: 0.2 } },
      { key: 'mirror', type: 'toggle', label: 'Mirror the map', value: true, random: { p: 0.7 } },
      { key: 'inside', type: 'choice', label: 'Inside', value: 'black', options: [{ id: 'black', label: 'Black' }, { id: 'deep', label: 'Deep' }, { id: 'white', label: 'White' }, { id: 'map', label: 'Map end' }], random: { weights: { black: 4, deep: 3, white: 1, map: 1 } } },
      { key: 'inset', type: 'toggle', label: 'Show c on the Mandelbrot map', value: true, random: { p: 0.6 } },
      { key: 'res', type: 'range', label: 'Render scale', min: 0.35, max: 1, step: 0.05, value: PHONE ? 0.6 : 1, phone: 0.6, random: false },
      K.themeControl('night'),
    ] },
  ] };
}

// Upstream is z^2: most random scenes keep d = 2; a Mandelbrot scene gets a
// view that frames it; a still c lands near the boundary of M (interesting).
export function guard(next, prev, rng) {
  const s = Object.assign({}, next), r = rng || Math.random;
  if (r() < 0.65) s.power = 2; else s.power = Math.round(s.power * 20) / 20;
  if (s.path === 'still') { const [x, y] = cAt('wander', r(), { k: 0.98 + 0.04 * r() }); s.cRe = Math.round(x * 1e4) / 1e4; s.cIm = Math.round(y * 1e4) / 1e4; }
  if (s.mode === 'mandel') { s.inset = false; if (s.power === 2) { s.cx = -0.6; s.cy = 0; s.zoom = 0.4; } else { s.cx = 0; s.cy = 0; s.zoom = 0.45; } }
  else { s.cx = 0; s.cy = 0; s.zoom = s.power > 2 ? 0.45 : 0.48; }
  if (s.color === 'mono' || s.color === 'gradient') s.inset = s.inset && s.mode === 'julia';
  return s;
}

// The view at time t (s): centre, scale (units per pixel at H rows), c.
export function viewOf(st, t, W, H) {
  const spot = SPOTS.find(s => s.id === st.spot) || SPOTS[0];
  let cx = st.cx, cy = st.cy, span = Math.pow(10, st.zoom);
  if (st.dive && st.mode === 'mandel') {
    // a slow dive into the spot and back: log height eases between 3 and depth
    const u = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / 60), a = Math.log(3), b = Math.log(spot.depth);
    span = Math.exp(a + (b - a) * u); cx = spot.x; cy = spot.y;
  }
  const u = t * st.pathSpeed / 60;
  const c = st.path === 'still' ? [st.cRe, st.cIm] : cAt(st.path, u, { k: st.pathK });
  // the depth sets the iterations: deeper views need more
  const iters = Math.max(st.iters, Math.round(st.iters * (1 + 0.35 * Math.max(0, -Math.log10(span)))));
  return { cx, cy, scale: span / H, mandel: st.mode === 'mandel', c, iters: Math.min(iters, 4000), power: st.power, span };
}
export function paintOf(st, lut, t) {
  const inside = st.inside === 'map' ? [lut[765], lut[766], lut[767]] : INSIDE[st.inside] || INSIDE.black;
  return { color: st.color, lut, density: st.density, offset: (st.offset + t * st.cycle) % 1, mirror: st.mirror, inside };
}
export { SPOTS };
