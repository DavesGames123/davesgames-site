// ============================================================================
//  CNN EXPLAINER  ·  colour.js  values -> pixels for the feature maps
// ----------------------------------------------------------------------------
//  DOM-free. A feature map is drawn through a gradient of
//  lib/growth-gradients.js ("choose a gradient"). The value range of the
//  gradient comes from one of three scales, as in the original tool:
//    map      the min and max of this one map (each map uses the whole ramp)
//    layer    the min and max of all maps of the layer
//    network  the min and max of all hidden layers (so layers compare)
//  The input channels are tinted red, green and blue, and the input picture
//  is drawn as it is.
//
//  grep -n 'export function statsOf'     the min and max of each map and layer
//  grep -n 'export function rangeOf'     [lo, hi] for a map and a scale
//  grep -n 'export function paintMap'    one map -> RGBA bytes through a LUT
//  grep -n 'export function paintInput'  an input channel (tint) or the picture
//  grep -n 'export const TINT'           the input channel tints
// ============================================================================

export const SCALES = [
  { id: 'map', label: 'Map' },
  { id: 'layer', label: 'Layer' },
  { id: 'network', label: 'Network' },
];

export const TINT = [[255, 92, 92], [96, 220, 120], [96, 150, 255]];

// stats[li] = { lo, hi, ch: [{ lo, hi }] }, net = { lo, hi } over the hidden
// layers (1 .. 10). Cached on the result object.
export function statsOf(result) {
  if (result._stats) return result._stats;
  const layers = result.layers.map(L => {
    const ch = [];
    for (let c = 0; c < L.C; c++) ch.push({ lo: Infinity, hi: -Infinity });
    const n = L.H * L.W;
    for (let i = 0; i < n; i++) for (let c = 0; c < L.C; c++) {
      const v = L.data[i * L.C + c], s = ch[c];
      if (v < s.lo) s.lo = v; if (v > s.hi) s.hi = v;
    }
    return { lo: Math.min(...ch.map(s => s.lo)), hi: Math.max(...ch.map(s => s.hi)), ch };
  });
  let lo = Infinity, hi = -Infinity;
  for (let li = 1; li < layers.length - 1; li++) { lo = Math.min(lo, layers[li].lo); hi = Math.max(hi, layers[li].hi); }
  result._stats = { layers, net: { lo, hi } };
  return result._stats;
}

export function rangeOf(result, li, c, scale = 'layer') {
  const S = statsOf(result);
  const r = li === 0 ? { lo: 0, hi: 1 } : scale === 'map' ? S.layers[li].ch[c] : scale === 'network' && li < result.layers.length - 1 ? S.net : S.layers[li];
  let lo = r.lo, hi = r.hi;
  if (!(hi > lo)) hi = lo + 1;
  return [lo, hi];
}

// One channel of a layer -> RGBA bytes (out has H * W * 4), through a LUT of
// 256 RGBA entries (growth-gradients lut()).
export function paintMap(L, c, lo, hi, lutBytes, out = new Uint8ClampedArray(L.H * L.W * 4)) {
  const n = L.H * L.W, k = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    let t = Math.round((L.data[i * L.C + c] - lo) * k);
    t = t < 0 ? 0 : t > 255 ? 255 : t;
    const j = i * 4, q = t * 4;
    out[j] = lutBytes[q]; out[j + 1] = lutBytes[q + 1]; out[j + 2] = lutBytes[q + 2]; out[j + 3] = 255;
  }
  return out;
}

// c = -1: the input picture itself. c = 0, 1, 2: that channel, tinted.
export function paintInput(L, c, out = new Uint8ClampedArray(L.H * L.W * 4)) {
  const n = L.H * L.W;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (c < 0) {
      out[j] = Math.round(L.data[i * 3] * 255); out[j + 1] = Math.round(L.data[i * 3 + 1] * 255); out[j + 2] = Math.round(L.data[i * 3 + 2] * 255);
    } else {
      const v = L.data[i * 3 + c], t = TINT[c];
      out[j] = 12 + v * (t[0] - 12); out[j + 1] = 13 + v * (t[1] - 13); out[j + 2] = 19 + v * (t[2] - 19);
    }
    out[j + 3] = 255;
  }
  return out;
}

// A signed value -> a CSS colour for the number grids: blue for positive,
// orange for negative, alpha by size (m is the largest size in view).
export function signedFill(v, m, a = 0.55) {
  const k = Math.min(1, Math.abs(v) / (m || 1)) * a;
  return v >= 0 ? `rgba(98,196,255,${k.toFixed(3)})` : `rgba(255,154,98,${k.toFixed(3)})`;
}
