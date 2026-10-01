// ============================================================================
//  MATERIAL STUDIO  ·  viewport/state.js — constants, context bindings, R
// ────────────────────────────────────────────────────────────────────────────
//  The leaf of the viewport tree. It holds the public view constants, the
//  texture formats and uniform sizes, the context bindings that init() sets
//  (store, state, gpu, device, canvas, camera and so on), the runtime object
//  R and the small math helpers. Other viewport files read the `let`
//  bindings live and change them only through bind(). This file imports no
//  viewport file, so it is ready before any file in the import cycle runs.
//
//  GREP TARGETS
//      VIEWPORT_DEBUG_VIEWS .. debug view list; the index is the shader id
//      DEBUG_LABELS / TONEMAP_LABELS  HUD labels
//      VIEW_DEFAULTS ......... view keys that init() adds to state.view
//      HDR / DEPTH ........... texture formats
//      FRAME_FLOATS / MAT_FLOATS  uniform sizes (struct Frame, struct Material)
//      export let store ...... context bindings; bind() is the only writer
//      export const R ........ runtime GPU objects and caches
//      clamp / warnOnce / hexToLinear / norm3 / idOf
// ============================================================================
import * as C from '../contract.js';

/** Contract DEBUG_VIEWS plus 'ndotl'. The index is the shader debug id. */
export const VIEWPORT_DEBUG_VIEWS = Object.freeze([...C.DEBUG_VIEWS, 'ndotl']);
export const DEBUG_LABELS = Object.freeze({
  lit: 'Lit', albedo: 'Base Color', opacity: 'Opacity', normal: 'Normal (map)', worldNormal: 'Normal (world)',
  ao: 'AO', roughness: 'Roughness', metallic: 'Metallic', height: 'Height', emissive: 'Emissive',
  clearcoat: 'Clearcoat', sheen: 'Sheen', anisotropy: 'Anisotropy', uv: 'UV Checker',
  diffuseOnly: 'Diffuse Only', specularOnly: 'Specular Only', ndotl: 'N dot L',
});
export const TONEMAP_LABELS = Object.freeze({
  aces: 'ACES', agx: 'AgX', khronosNeutral: 'Khronos Neutral', reinhard: 'Reinhard', filmic: 'Filmic', linear: 'None (clamp)',
});
/** View keys that the viewport adds to state.view when they are missing. */
export const VIEW_DEFAULTS = Object.freeze({
  fov: 35, ground: true, grid: false, shadows: true, shadowStrength: 0.85,
  aa: 'msaa',             // 'msaa' | 'fxaa' | 'both' | 'off'
  compare: 'off',         // 'off' | 'prev' (A = previous bake) | 'pinned' (A = pinned snapshot)
  compareSplit: 0.5,
  uvOffset: [0, 0], parallaxScale: 1, pomSteps: 32,
  normalStrength: 1, flipGreen: false, anisoRotation: 0, sheenRoughness: 0.5, specOcclusion: 1,
});
export const HDR = 'rgba16float';
export const DEPTH = 'depth24plus';
export const FRAME_FLOATS = 144;     // 576 bytes, see struct Frame
export const MAT_FLOATS = 20;        // 80 bytes, see struct Material

// ------------------------------------------------------------ context bindings
export let store = null, state = null, gpu = null, device = null, envMod = null;
export let canvas = null, wrap = null, hud = null, gctx = null, cam = null;
/** Set the context bindings named in `o`. A key with the value undefined is ignored. */
export function bind(o) {
  ({ store = store, state = state, gpu = gpu, device = device, envMod = envMod,
    canvas = canvas, wrap = wrap, hud = hud, gctx = gctx, cam = cam } = o);
}

/** Runtime GPU objects and caches. */
export const R = {
  SH: null, samp: {}, layout: {}, pipes: new Map(), modules: new Map(),
  lut: null, shadow: null, dummy2d: null, dummyCube: null,
  frameBuf: null, frameData: new Float32Array(FRAME_FLOATS), postBuf: null,
  frameBG: null, frameBGKey: '', shadowFrameBG: null, env: null,
  mesh: null, meshKey: '', custom: null, edgesFor: null,
  cur: null, def: null, test: null, A: null, lastCopy: null, matVersion: 0,
  targets: null, shadowSig: '', key: null,
  raf: 0, needs: false, last: 0, frameMs: 0, fps: 0, fpsT: 0, fpsN: 0,
  baking: false, envPoll: 0, warned: new Set(), disposed: false,
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const warnOnce = (k, msg) => { if (!R.warned.has(k)) { R.warned.add(k); console.warn('[viewport]', msg); } };

export function hexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
}
export const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** A small stable id per object (texture, mesh data) for cache keys. */
const idMap = new WeakMap(); let idNext = 1;
export function idOf(o) { if (!o) return 0; if (!idMap.has(o)) idMap.set(o, idNext++); return idMap.get(o); }
