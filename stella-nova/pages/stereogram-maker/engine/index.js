// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/index.js — the public API (no DOM)
// ----------------------------------------------------------------------------
//  The stereogram-maker page and the stereogram-history page use this
//  file. Every function here runs in a module worker and in node. No
//  function reads the DOM. A function that can use a browser feature
//  (OffscreenCanvas, WebGL2) has a pure JS path that gives the same
//  result shape.
//
//  DATA SHAPES (all structured-clone safe; send .data.buffer as a transfer)
//    DepthMap = { w, h, data: Float32Array(w*h), mask: Uint8Array(w*h) }
//      (not a bare Float32Array: the size travels with the data)
//      data is 0 at the far plane (the background) and 1 at the nearest
//      point. mask is 1 where an object covers the pixel, else 0.
//      Row-major, row 0 at the top.
//    Image = { w, h, data: Uint8ClampedArray(w*h*4) }
//      RGBA, alpha 255. Same fields as ImageData under other names:
//      new ImageData(img.data, img.w, img.h) shows it on a canvas.
//    Mesh = { positions: Float32Array (xyz), indices: Uint32Array }
//      Any units. depthFromMesh fits the bounding sphere to the frame.
//
//  DEPTH SOURCES
//    depthFromMesh(mesh, { w, h, yaw, pitch, roll, fov, near, far, fit,
//                          norm, gl }) -> DepthMap
//      CPU z-buffer rasteriser. yaw, pitch, roll and fov are in degrees.
//      yaw turns about the vertical axis, pitch about the horizontal
//      axis, roll about the view axis. fov 0 is an orthographic view;
//      fov > 0 is a perspective view (default 22).
//      match { mu, relief, lift } (with no fov): the perspective that
//      the fused stereogram implies (matchedFov). The default 22 degrees
//      is about four times too strong for a slab of mu 1/3, so the fused
//      object then bends. The DepthMap gets fov, the angle used.
//    matchedFov(match, near, far, lo, span) -> degrees (see depth.js).
//      near (default 1) and far (default 0.2): the depth values of the
//      nearest and the farthest visible object point. The background is 0.
//      fit (default 0.9): the part of min(w, h) that the bounding sphere
//      fills. norm 'view' (default) maps the visible depth span of this
//      view to [far, near]. norm 'sphere' maps the bounding sphere, so
//      the depth scale does not change when the mesh turns (use it for
//      animation). gl true tries depthFromMeshGL first, then falls back.
//    depthFromMeshGL(mesh, opts) -> DepthMap | null
//      The WebGL2 fast path (OffscreenCanvas). null when no WebGL2.
//    depthFromText(text, { w, h, size, weight, font, bevel, level })
//      -> DepthMap. Text in the centre. size: the cap height as a part of h
//      (default 0.5). bevel: the slope width in px (default 4). level:
//      the depth of the letter face (default 1). With OffscreenCanvas it
//      draws the font; without it, it uses a built-in 5x7 block font.
//    depthFromImage(img, { w, h, invert, blur, gamma, mode }) -> DepthMap
//      img is an Image. mode 'depth' (default) reads a grey depth map
//      (white is near). mode 'photo' is the luminance-to-depth for a
//      photo: blur (default 3 px) and gamma (default 1.4) soften it.
//    depthFromSDF(shape, { w, h, ...shape params }) -> DepthMap
//      Analytic shapes in closed form: SDF_SHAPES lists the ids
//      ('sphere', 'torus', 'steps', 'cone', 'ripple', 'pyramid').
//    turntable(mesh, n, opts) -> DepthMap[]
//      n views at yaw = opts.yaw + 360 k / n, norm 'sphere'.
//
//  STEREOGRAMS  (Thimbleby, Inglis and Witten 1994; our own code)
//    sirds(depth, opts) -> StereoImage
//    autostereogram(depth, tile, opts) -> StereoImage
//      autostereogram is sirds with source 'tile' and opts.tile = tile.
//    StereoImage = Image + { sepFar, sepNear } (px, at the output size)
//    opts (all optional):
//      eyeSep     eye separation in inches (default 2.5)
//      dpi        output pixels per inch (default 72)
//      mu         depth of field, a part of the viewing distance
//                 (default 1/3; 0.1 .. 0.5 is useful)
//      mode       'wall' (wall-eyed, default) or 'cross' (cross-eyed)
//      oversample 1..4 (default 1): the constraints run on a row that is
//                 n times wider, then the row is box-filtered down
//      guides     true (default) draws two guide dots at the top
//      hsr        hidden-surface removal (default true; off for 'cross')
//      source     'dots' (black and white, default), 'color' (coloured
//                 dots), or 'tile' (a pattern Image, opts.tile)
//      density    the part of dots that are ink (default 0.5)
//      palette    ['#rrggbb', ...] for 'color' (default: 5 bright inks)
//      tile       an Image. It is scaled so its width is sepFar.
//      seed       an integer for the random dots (default 1)
//    farSeparation(opts) -> px: the repeat width of the background. Make
//      a tile this wide (tilesFromPatterns size) for a sharp result.
//
//  PATTERN TILES  (from pages/pattern-designer, read-only import)
//    TILES = [{ id, name, family, pattern, palette, wrap }]
//      The curated set (40+). id is 'pd-<pattern id>'. wrap 'native' means
//      that the square pattern board repeats with no seam. wrap 'mirror'
//      means that the tile is a 2x2 mirror of the board, so it wraps.
//      Also 'dots-bw', 'dots-color' and 'noise-*' tiles with family 'dots'.
//    tilesFromPatterns(ids, size, seed) -> [Image + { id, name, family,
//      wrap }]. size: the tile side in px (a number) or { w, h }.
//    seamError(img) -> number: the seam test that the tests use.
//
//  HISTORY FORMS
//    wheatstonePair(depth, texture, opts) -> { left: Image, right: Image }
//      Two views for a stereoscope. texture: an Image (repeated) or null
//      for random dots. opts.disparity: the largest shift in px (default
//      w / 40). opts.mode 'wall' or 'cross' sets which view is which.
//    randomDotStereogram(depth, opts) -> { left, right }
//      The two-image form of Julesz (1960): the same random dots, with
//      the object region shifted in the right image and new dots in the
//      gap. opts: { disparity, density, seed, levels }.
//    anaglyph(left, right, { mode }) -> Image
//      mode 'red-cyan' (default, colour) or 'gray' (grey red-cyan).
//
//  ANIMATION
//    animate(frames, opts) -> { frames: StereoImage[] }
//      frames: DepthMap[] (for example from turntable). All frames use
//      the same tile and the same dot seed, so the background stays
//      still and the eye holds the fusion while the object turns.
//
//  MODELS (../models/index.js, not this file)
//    MODELS = [{ id, name, kind, file, credit, licence, url, view }]
//    loadModel(id) -> Promise<Mesh + { id, record, triangleCount }>
//
//  WORKER (engine/worker.js, a module worker; engine/worker-core.js)
//    in  { id, op, args: [...] }  out { id, ok: true, result } | { id,
//    ok: false, error }. ops: the names of the functions above, plus
//    'loadModel' ([id]), 'modelDepth' ([{ model, ...depth opts }]) and
//    'modelTurntable' ([{ model, ...depth opts }, n]).
//    createEngineClient(worker) -> { call(op, ...args) -> Promise, close() }
//    (engine/client.js).
//
//  grep -n targets (file: name)
//    depth.js ........ "export function depthFromMesh", "function raster"
//    depth-gl.js ..... "export function depthFromMeshGL"
//    text.js ......... "export function depthFromText", "FONT5x7"
//    sirds.js ........ "export function sirds", "function constrainRow"
//    tiles.js ........ "export const TILES", "export function tilesFromPatterns"
//    raster2d.js ..... "export class Raster2D" (canvas 2D subset)
//    pairs.js ........ "export function wheatstonePair", "export function anaglyph"
//    animate.js ...... "export function animate"
//    png.js .......... "export function encodePNG" (node tests, downloads)
//    worker-core.js .. "export async function handle", "const OPS"
//    client.js ....... "export function createEngineClient"
//    tests.mjs ....... node engine/tests.mjs
// ============================================================================
import { depthFromMesh as cpuDepth } from './depth.js';
import { depthFromMeshGL } from './depth-gl.js';

// depthFromMesh with the optional WebGL2 path (opts.gl true).
export function depthFromMesh(mesh, opts = {}) {
  if (opts.gl) { const d = depthFromMeshGL(mesh, opts); if (d) return d; }
  return cpuDepth(mesh, opts);
}
export { depthFromMeshGL };
export { matchedFov, depthFromImage, depthFromSDF, SDF_SHAPES, turntable, boxBlur, meshBounds, turnMatrix, emptyDepth } from './depth.js';
export { depthFromText, FONT5x7 } from './text.js';
export { sirds, autostereogram, farSeparation, nearSeparation, separation, rowLinks, hash3, DEFAULTS, DOT_PALETTE } from './sirds.js';
export { TILES, DOT_TILES, tilesFromPatterns, seamError } from './tiles.js';
export { wheatstonePair, randomDotStereogram, anaglyph } from './pairs.js';
export { animate } from './animate.js';
export { encodePNG, depthToImage } from './png.js';
export { Raster2D } from './raster2d.js';
export { createEngineClient } from './client.js';
