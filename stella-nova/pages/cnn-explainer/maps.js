// ============================================================================
//  CNN EXPLAINER  ·  maps.js  one small canvas per feature map
// ----------------------------------------------------------------------------
//  createMaps(doc) keeps a canvas of H x W px for each map of the current
//  result (about 100 canvases). The overview, the detail view and the
//  screensaver draw them scaled up with image smoothing off, so each value
//  is one crisp square. set(result, gradient, reversed, scale) paints them
//  again; a draw call never paints.
//
//  grep -n 'export function createMaps'   the cache
//  grep -n 'function img'                  (li, c) -> canvas
// ============================================================================
import { lut } from '../../lib/growth-gradients.js';
import { rangeOf, paintMap, paintInput } from './colour.js';

export function createMaps(doc = document) {
  const cache = new Map();
  const st = { result: null, grad: 'magma', rev: false, scale: 'layer', lut: lut('magma', 256, false), version: 0 };
  function canvasFor(key, w, h) {
    let cv = cache.get(key);
    if (!cv) { cv = doc.createElement('canvas'); cache.set(key, cv); }
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    return cv;
  }
  function paint(li, c) {
    const L = st.result.layers[li];
    const cv = canvasFor(li + ':' + c, L.W, L.H), g = cv.getContext('2d');
    if (!g) return cv;
    const id = g.createImageData(L.W, L.H);
    if (li === 0) paintInput(L, c, id.data);
    else { const [lo, hi] = rangeOf(st.result, li, c, st.scale); paintMap(L, c, lo, hi, st.lut, id.data); }
    g.putImageData(id, 0, 0);
    return cv;
  }
  function set(result, { grad = st.grad, rev = st.rev, scale = st.scale } = {}) {
    if (result) st.result = result;
    st.grad = grad; st.rev = rev; st.scale = scale; st.lut = lut(grad, 256, rev);
    if (!st.result) return;
    paint(0, -1); for (let c = 0; c < 3; c++) paint(0, c);
    for (let li = 1; li < st.result.layers.length - 1; li++) for (let c = 0; c < st.result.layers[li].C; c++) paint(li, c);
    st.version++;
  }
  function img(li, c) { return cache.get(li + ':' + c) || null; }
  // a colour of the current gradient, for keys and legends
  function rgb(t) {
    const q = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
    return `rgb(${st.lut[q]},${st.lut[q + 1]},${st.lut[q + 2]})`;
  }
  return { set, img, rgb, st, get result() { return st.result; } };
}
