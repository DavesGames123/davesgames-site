// ============================================================================
//  CORAL REEF  ·  gpu-safe.js  ·  the checks of the main view path (DOM-free)
// ----------------------------------------------------------------------------
//  scene.js draws the main view in three passes (scene -> volume ->
//  composite). This file holds the parts of that path that node can test:
//
//  fullTri(THREE)      the full-frame triangle of the volume and composite
//                      passes. It has only the attribute aPos, so it MUST
//                      have a finite draw range: three r160 returns from
//                      renderBufferDirect when the geometry has no index
//                      and no 'position' attribute (drawCount is Infinity).
//                      Before 2026-10-17 the passes had no draw range, so
//                      they drew nothing and the main view was black while
//                      the ROV feed (a PlaneGeometry) showed the reef.
//  drawCountR160(geo)  the draw count rule of three r160 (the tests use it)
//  targetPlan(info)    the render target formats for the device:
//                      { post, type: 'half' | 'byte', lumType: 'byte' }.
//                      info = { webgl2, colorBufferFloat, colorBufferHalf }.
//                      A float colour target needs EXT_color_buffer_float
//                      (or _half_float) in WebGL2; with neither, no post
//                      chain: the scene goes straight to the canvas.
//  SENTINEL, isSentinel(px)
//                      the first-frame check: scene.js clears the canvas to
//                      SENTINEL, runs the composite, reads the centre
//                      pixel. If the pixel is still SENTINEL, the composite
//                      did not draw, and the page falls back to the direct
//                      path (the scene to the canvas, three fog).
//  exposureFrom(bytes, prev, o) -> exposure
//                      auto exposure from the luminance target (LUM_FS in
//                      shaders.js: r = (log2 L + 16) / 20, 0..255). The
//                      95th percentile goes to o.key (0.25 before ACES).
//                      Eased, clamped to o.min .. o.max.
//
//  grep -n targets: "export function fullTri", "export function targetPlan",
//  "export function exposureFrom", "export const SENTINEL"
// ============================================================================

export function fullTri(THREE) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('aPos', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
  g.setDrawRange(0, 3);
  return g;
}

// three r160 WebGLRenderer.renderBufferDirect: the vertex count it draws
// (no groups). Infinity or < 0: three returns and draws nothing.
export function drawCountR160(geo) {
  const dr = geo.drawRange, index = geo.index, pos = geo.attributes.position;
  let s = dr.start, e = dr.start + dr.count;
  if (index) { s = Math.max(s, 0); e = Math.min(e, index.count); }
  else if (pos) { s = Math.max(s, 0); e = Math.min(e, pos.count); }
  const n = e - s;
  return n < 0 || n === Infinity ? 0 : n;
}

export function targetPlan(info = {}) {
  const float = !!(info.webgl2 && (info.colorBufferFloat || info.colorBufferHalf));
  return { post: float, type: float ? 'half' : 'byte', lumType: 'byte' };
}
// the plan for a three renderer
export function planFor(renderer) {
  const e = renderer.extensions;
  return targetPlan({ webgl2: !!renderer.capabilities.isWebGL2, colorBufferFloat: e.has('EXT_color_buffer_float'), colorBufferHalf: e.has('EXT_color_buffer_half_float') });
}

// The first-frame sentinel colour (0..1 and 0..255). The composite never
// gives it: its output has grain and a blue fog.
export const SENTINEL = [1, 0, 1];
export function isSentinel(px) {
  return px[0] >= 250 && px[1] <= 5 && px[2] >= 250;
}

// The luminance target bytes (RGBA8, r = (log2 L + 16) / 20 x 255) to an
// exposure. prev: the last exposure. o: { key, min, max, k (ease 0..1) }.
export function exposureFrom(bytes, prev = 1.25, o = {}) {
  const key = o.key ?? 0.25, min = o.min ?? 1, max = o.max ?? 24, k = o.k ?? 0.25;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < bytes.length; i += 4) { hist[bytes[i]]++; n++; }
  if (!n) return prev;
  let acc = 0, b = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.95) { b = i; break; } }
  const L = Math.pow(2, (b / 255) * 20 - 16);
  const want = Math.max(min, Math.min(max, key / Math.max(L, 1e-6)));
  // ease in log space, so a step up and a step down take the same time
  return Math.exp(Math.log(prev) + (Math.log(want) - Math.log(prev)) * k);
}
