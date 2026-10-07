// ============================================================================
//  CONTEXT FREE  ·  engine.js — the JavaScript API of cf.wasm (no DOM)
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING). cf.js and cf.wasm are the
//  Context Free engine of Mark Lentczner and John Horigan, built by
//  engine/build.sh from the upstream source and our patches.
//
//  The worker (worker.js) and the node tests (tests.mjs) use this module.
//  The page itself talks to the worker only (client.js).
//
//  API
//    const E = await loadEngine({ wasmBinary? })
//    E.parse(source, variation, files?, defs?) -> { ok, diags, messages, info }
//        defs: the -D text of the CLI, for example 'CF::Background = [b -1]'
//        files: { 'name.cfdg': text } for import lines; the upstream
//        examples (i_pix.cfdg, i_curves.cfdg ...) are in the binary.
//    E.render(opts, hooks?)               -> { ok, stopped, width, height,
//        pixels (Uint8ClampedArray RGBA, not premultiplied), shapes, ... }
//        opts: width, height, maxShapes, minSize, border, tile (repeats
//              of a tiled design; width x height is the whole output), frames, frame (with frames: that frame
//              only, and its pixels in the result), antialias, partial,
//              zoom, wide (16 bit when the design asks), tickMs (progress
//              tick; 0 = none)
//        hooks: onProgress(p) -> 0 | 'finish' | 'stop'
//               onFrame(pixels, w, h, index)   partial or animation frame
//        grow: true keeps the renderer for E.growFrame (res.grow,
//        res.measured shapes, res.minDepth, res.maxDepth)
//    E.growFrame(mode, at) -> pixels of the replay at 0..1; mode is
//        'build', 'depth' or 'radial'; at >= 1 is the final render
//    E.growEnd()                          frees the kept renderer
//    E.svg(opts)                          -> SVG text
//    E.varToString(n), E.varFromString(s), E.varMax(letters)
//
//  GREP MAP
//    grep -n 'export async function loadEngine'
//    grep -n 'function parse'
//    grep -n 'function render'
// ============================================================================
import createContextFree from './cf.js';

export const FLAG = { PARTIAL: 1, NO_AA: 2, ZOOM: 4, WIDE: 8, GROW: 16 };
export const GROW_MODES = { build: 2, depth: 3, radial: 4 };

export { randomVariation, varToString, varFromString } from './variation.js';

export async function loadEngine(init = {}) {
  let hooks = null, diags = [], messages = [];
  const M = await createContextFree(Object.assign({
    print: () => {}, printErr: () => {},
  }, init));
  M.cfHooks = {
    progress: (shapes, todo, inOutput, done, count) => {
      const p = { shapes, todo, inOutput: !!inOutput, done, count };
      lastProgress = p;
      if (!hooks || !hooks.onProgress) return 0;
      const r = hooks.onProgress(p);
      return r === 'stop' || r === 2 ? 2 : r === 'finish' || r === 1 ? 1 : 0;
    },
    frame: (ptr, w, h, index) => {
      if (!hooks || !hooks.onFrame) return;
      const px = new Uint8ClampedArray(M.HEAPU8.buffer, ptr, w * h * 4).slice();
      hooks.onFrame(px, w, h, index);
    },
    message: text => {
      // ParseFile tries the version 2 grammar first; its diagnostics are
      // not real when it restarts as version 3.
      if (/^Restarting as a version 3 design/.test(text)) diags = [];
      messages.push(text);
    },
    diag: (line, col, eline, ecol, isError, file, text) => {
      diags.push({ line, col, endLine: eline, endCol: ecol, error: !!isError, file, text });
    },
  };
  let lastProgress = null;
  try { M.FS.mkdir('/work'); } catch (e) { /* exists */ }

  const cstr = s => {
    const n = M.lengthBytesUTF8(s) + 1, p = M._malloc(n);
    M.stringToUTF8(s, p, n);
    return p;
  };

  function parse(source, variation = 1, files = {}, defs = '') {
    diags = []; messages = [];
    for (const name of M.FS.readdir('/work')) if (name !== '.' && name !== '..') M.FS.unlink('/work/' + name);
    for (const [name, text] of Object.entries(files)) {
      if (/^[\w .-]+$/.test(name) && name !== 'main.cfdg') M.FS.writeFile('/work/' + name, text);
    }
    M.FS.writeFile('/work/main.cfdg', source);
    const dp = cstr(defs || '');
    let ok;
    try { ok = M._cf_parse(variation | 0, dp) === 1; } finally { M._free(dp); }
    const info = ok ? JSON.parse(M.UTF8ToString(M._cf_info())) : null;
    return { ok, diags: diags.slice(), messages: messages.slice(), info };
  }

  function render(o = {}, h = null) {
    hooks = h; lastProgress = null; diags = []; growSize = null;
    const flags = (o.partial ? FLAG.PARTIAL : 0) | (o.antialias === false ? FLAG.NO_AA : 0) |
      (o.zoom ? FLAG.ZOOM : 0) | (o.wide ? FLAG.WIDE : 0) | (o.grow && !(o.frames > 0) ? FLAG.GROW : 0);
    let res;
    try {
      res = JSON.parse(M.UTF8ToString(M._cf_render(o.width | 0 || 500, o.height | 0 || 500,
        o.maxShapes | 0, o.minSize ?? 0.3, o.border ?? 2, o.tile | 0 || 1,
        o.frames | 0, o.frame | 0, flags, o.tickMs ?? 120)));
    } finally { hooks = null; }
    res.shapes = lastProgress ? lastProgress.shapes : 0;
    try { res.info = JSON.parse(M.UTF8ToString(M._cf_info())); } catch (e) { res.info = null; }
    res.diags = diags.slice();
    if (!(o.frames > 0) || o.frame > 0) {
      const ptr = M._cf_pixels();
      res.pixels = ptr ? new Uint8ClampedArray(M.HEAPU8.buffer, ptr, res.width * res.height * 4).slice() : null;
    }
    // With grow, the renderer and canvas stay for growFrame().
    if (res.grow) growSize = { w: res.width, h: res.height }; else M._cf_release();
    return res;
  }

  function svg(o = {}) {
    const p = M._cf_render_svg(o.width | 0 || 500, o.height | 0 || 500, o.maxShapes | 0, o.minSize ?? 0.3, o.border ?? 2);
    return M.UTF8ToString(p);
  }

  function varToString(n) { return M.UTF8ToString(M._cf_variation_to_string(n | 0)); }
  function varFromString(s) { const p = cstr(String(s)); try { return M._cf_variation_from_string(p); } finally { M._free(p); } }
  function varMax(letters = 3) { return M._cf_variation_max(letters | 0); }

  // One frame of the growth replay of the last render({ grow: true }).
  // mode: 'build' | 'depth' | 'radial'; at: 0..1 (1 = the final render).
  let growSize = null;
  function growFrame(mode, at) {
    if (!growSize) return null;
    const ptr = M._cf_grow_frame(GROW_MODES[mode] || 2, +at);
    if (!ptr) return null;
    return new Uint8ClampedArray(M.HEAPU8.buffer, ptr, growSize.w * growSize.h * 4).slice();
  }
  function growEnd() { growSize = null; M._cf_release(); }

  return { parse, render, svg, growFrame, growEnd, varToString, varFromString, varMax, module: M };
}
