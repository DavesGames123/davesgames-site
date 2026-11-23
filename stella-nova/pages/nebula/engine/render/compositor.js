// compositor.js: the runtime compositor of the star map in WebGL2: the oblique march (spec 3.1,
// 3.4, 4, 6.5, 7.4). Row A9. Revision 3.
//
// Exports (grep -n "^export"):
//   createCompositor(ctx, layers, catalogue, { defines, labOff, starPass }) -> {
//     draw(scrollX, viewW, timeSec, opts)        to the canvas; sRGB-encoded output
//     drawTo(fbo, w, h, scrollX, viewW, timeSec, opts)  the same chain into an RGBA8 framebuffer that is
//                                                not the canvas (the frame-time sweep of main.js)
//     drawLinear(target, scrollX, viewW, debug)  to a registry RGBA16F 2D target; stretch off, linear (2.12
//                                                trim). debug = { view, z } reads a debug view, for
//                                                example the foreground optical depth (view 2, z [0, 520]).
//     setFog(circles, loss), setDebug(view, zWindow), dispose(),
//     setExposure(trimEv, offsetEv), setCatalogue(catalogue), setLayers(layers), uniformVec4Use, program,
//     converging(), historyFrames(), fadeState(), resetHistory() }   the at-rest accumulation (starPass only)
//   packData(catalogue, fog) -> Float32Array(256 * 4 * 4)   the _Data texture rows (3.4.1)
//   sortByDepth(catalogue) -> catalogue copy with stars and objects nearest first (3.4.1)
//   depthOrder(arr, n, w) -> [packed index per draw slot], the permutation of sortByDepth
//   DEBUG_VIEWS                                  name -> _DebugView value (3.4.3)
//   compositorProgramName(defines, labOff, spec) the program cache name of one compositor variant
//
// opts of draw = { gas, stars, objects, gray, embedded, catalogue, deep, animScale, dither, deepGlow, starAnim }.
// starPass (render scale < 1 without the stretch): opts.marchScale is the march size per output px. Each draw
// marches into 3 RGBA16F targets (gas, tau knots), then the finish pass adds the stars of StarPass at the
// output size and applies SmDisplay. opts.accumulate (the canvas draws of main.js): at rest the march grid moves
// by a Halton (2, 3) offset each frame and RESOLVE_FS keeps a running mean at the output size; the finish
// reads it. Motion frames and one-off draws use UpscaleGas (compositor.glsl.js). grep -n: "ACC =", "function run".
// starAnim (revision 4, 11.3): true runs the star light curves (row 2 of _Data, from lightcurve.js, per
// frame) and the cell flares (_StarAnim). false or missing: every star is quiescent and row 2 is constant.
// layers (7.4.4) = { vol, skinD, skinA, strandSeg, strandBin, volMeta, look, strandFamily, strandAbsorb,
//   dustBand, exposure, exposureTrimEv }. The textures are registry names, registry entries or
//   WebGLTexture objects. volMeta = { dims, volScale, sigScale, skinLo, skinHi }.
//   look = the uniforms of lookOf (prelight.js): palette, mask and skin weights.
// circles of setFog = [{ x, y, r }] or [[x, y, r]] in content px; at most 16 are used. null = fog off.
//
// Sweep 5 query knobs (perf/sweep5; a missing knob keeps the value of ACC and the shader text unchanged):
//   ?accsigma=<px>   ACC.sigma, the Gaussian of RESOLVE_FS     ?accframes=<n>  ACC.frames, the rest frames to draw
//   ?capanim=<w>     ACC.capAnim (weight cap, animation on)    ?capstatic=<w>  ACC.capStatic
//   ?msharp=<k>      ACC.sharp, the motion cross sharpen       ?rsharp=<k>     ACC.restSharp, a sharpen of the mean
//   ?sharpk=cas      the adaptive sharpen (_Sh.y = 1)          ?halton=<n>     a Halton cycle of n offsets (0 = none)
//   ?upk=cr|mn|bl    the UpscaleGas kernel (upscaleKernel)      ?psf=<px>       PSF_SIGMA of the star pass (finish only)
// grep -n: "function knobs".

import { program } from '../gl/context.js';
import comp from '../data/composition.js';
import { compositorSource, specOn, RESOLVE_FS, upscaleKernel } from './shaders/compositor.glsl.js';
import { labConsts } from './lab-consts.js';
import { labNoiseTexture } from './lab-noise.js';
import { labZones } from './lab-zones.js';
import { prepareLightCurves, starVarRow } from './lightcurve.js';
import { fadeWeight, fadeDone } from './fade-in.js';

// The program name of one compositor: the lever defines, the lab effects that are off, and '.generic'
// when ?spec=0. main.js and boot-compile.js use it for the early compile, so program() adopts that compile.
export function compositorProgramName(defines, labOff, spec) {
  let n = (defines && defines.length) ? 'compositor.' + defines.join('.') : 'compositor';
  if (labOff && labOff.length) n += '.off-' + labOff.slice().sort().join('-');
  return spec ? n : n + '.generic';
}

export const DEBUG_VIEWS = { composite: 0, depth: 1, tau: 2, noStars: 3, gasOnly: 3, starsOnly: 4, skins: 5, volume: 6 };

const ROW = 256 * 4;   // floats per row of _Data
const LOOK_KEYS = ['_PalHe', '_PalH', '_PalFront', '_PalPAH', '_PalH2', '_PalShock', '_PalEjecta',
  '_MaskA', '_MaskB', '_WSkinA', '_WSkinB'];

// Stars (2 texels) and objects (4 texels) sorted by depth, nearest first (p from high to low), stable.
export function depthOrder(arr, n, w) {
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => (arr[w * b + 2] - arr[w * a + 2]) || (a - b));
  return idx;
}
export function sortByDepth(cat) {
  if (!cat) return cat;
  const sortRows = (arr, n, w) => {
    const idx = depthOrder(arr, n, w);
    const out = new Float32Array(arr.length);
    out.set(arr);
    idx.forEach((src, dst) => out.set(arr.subarray(w * src, w * src + w), w * dst));
    return out;
  };
  return { ...cat, stars: sortRows(cat.stars, cat.starCount, 8), objects: sortRows(cat.objects, cat.objectCount, 16) };
}

export function packData(catalogue, fog) {
  const d = new Float32Array(ROW * 4);
  if (catalogue) {
    const c = sortByDepth(catalogue);
    d.set(c.stars.subarray(0, Math.min(c.stars.length, ROW)), 0);
    d.set(c.objects.subarray(0, Math.min(c.objects.length, ROW)), ROW);
  }
  if (fog) d.set(fog, 3 * ROW);
  return d;
}

function fogRow(circles) {
  const row = new Float32Array(ROW);
  const n = circles ? Math.min(16, circles.length) : 0;
  for (let i = 0; i < n; i++) {
    const c = circles[i];
    const x = Array.isArray(c) ? c[0] : c.x, y = Array.isArray(c) ? c[1] : c.y, r = Array.isArray(c) ? c[2] : c.r;
    row.set([x, y, r, 0], 4 * i);
  }
  return { row, n };
}

// vec4 slots that the active non-sampler uniforms of a program take (each scalar or vector takes one slot).
function vec4Use(gl, prog) {
  let n = 0;
  const samplers = new Set([gl.SAMPLER_2D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_3D, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D]);
  for (const u of prog.uniforms.values()) {
    if (samplers.has(u.type)) continue;
    const mat = { [gl.FLOAT_MAT2]: 2, [gl.FLOAT_MAT3]: 3, [gl.FLOAT_MAT4]: 4 }[u.type] || 1;
    n += mat * u.size;
  }
  return n;
}

// Sweep 5 defaults (perf/sweep5/REPORT.md): sigma 0.47 -> 0.20 output px (the rest mean keeps the detail of the
// march offsets: SSIM against Ultra 0.9968 -> 0.9979 at 1440p, no extra GPU time), capAnim 4 -> 8 (the rest
// stability with animation on: luma delta 0.11 -> 0.08 x255).
function knobs(search) {
  const q = new URLSearchParams(search || '');
  const num = (k, d) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  return { sigma: num('accsigma', 0.20), frames: num('accframes', 16), capAnim: num('capanim', 8), capStatic: num('capstatic', 1e4),
    sharp: num('msharp', 0.35), restSharp: num('rsharp', 0), sharpKind: q.get('sharpk') === 'cas' ? 1 : 0,
    halton: Math.max(0, Math.round(num('halton', 0))), upk: q.get('upk') || '', psf: q.has('psf') ? num('psf', 0.7) : null };
}

export function createCompositor(ctx, layers, catalogue, options) {
  const { gl, registry } = ctx;
  const defines = (options && options.defines) || [];
  // options.labOff: the lab effects that are off (LAB_EFFECTS keys of lab-consts.js). Each set of keys
  // is its own program, because the specialized source holds the values.
  const labOff = ((options && options.labOff) || []).slice().sort();
  const search = typeof location !== 'undefined' ? location.search : '';
  const labTable = labConsts(comp, search, labOff);
  const spec = specOn(search) ? labTable : null;
  // Lab stars: options.starPass = the march at opts.marchScale into 3 RGBA16F targets (linear gas, tau knots),
  // then the full-resolution star pass and display chain into the target (SM_STARPASS, starmap-composite.hlsli).
  const starPass = !!(options && options.starPass);
  const pName = compositorProgramName(defines, labOff, !!spec);
  const prog = starPass ? program(gl, pName + '.sp-march', null, compositorSource(defines, spec, 'march'))
    : program(gl, pName, null, compositorSource(defines, spec));
  const K = knobs(search);
  // Sweep 5: the kernel and the PSF knobs change the finish and resolve text, so they get their own program names.
  const kTag = (K.upk ? '.upk-' + K.upk : '') + (K.psf != null ? '.psf-' + K.psf : '');
  let finishText = starPass ? upscaleKernel(compositorSource(defines, spec, 'finish'), K.upk) : null;
  if (finishText && K.psf != null) finishText = finishText.replace(/static const float PSF_SIGMA = [0-9.]+;/, 'static const float PSF_SIGMA = ' + K.psf.toFixed(4) + ';');
  const progFinish = starPass ? program(gl, pName + '.sp-finish' + kTag, null, finishText) : null;
  const progResolve = starPass ? program(gl, 'compositor.sp-resolve' + (K.upk ? '.upk-' + K.upk : ''), null, upscaleKernel(RESOLVE_FS, K.upk)) : null;
  const vao = gl.createVertexArray();
  let curP = prog;
  const U = (name) => { const u = curP.uniforms.get(name); return u ? u.loc : null; };
  gl.getExtension('EXT_color_buffer_float');
  // A set of float render targets: n textures of w x h in one framebuffer (MRT when n > 1).
  function targetSet(w, h, n) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const tex = [];
    for (let k = 0; k < n; k++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0);
      tex.push(t);
    }
    gl.drawBuffers(tex.map((_, k) => gl.COLOR_ATTACHMENT0 + k));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('[compositor] star pass targets incomplete: 0x' + st.toString(16));
    return { w, h, fbo, tex };
  }
  const freeSet = (t) => { if (t) { gl.deleteFramebuffer(t.fbo); t.tex.forEach((x) => gl.deleteTexture(x)); } };
  // March targets [gas, tauA, tauB]: two sizes stay (the render scale and the motion scale), so the motion
  // window does not allocate on each switch. rest: the march of the last reset (no offset); the star pass
  // of each later at-rest frame reads its tau knots, so the star light does not change with the offset.
  let lows = [];
  function lowTargets(w, h) {
    let t = lows.find((x) => x.w === w && x.h === h);
    if (t) { lows = [t, ...lows.filter((x) => x !== t)]; return t; }
    t = targetSet(w, h, 3);
    lows.unshift(t);
    while (lows.length > 2) freeSet(lows.pop());
    return t;
  }
  let rest = null;
  function restTargets(w, h) {
    if (rest && rest.w === w && rest.h === h) return rest;
    freeSet(rest); rest = targetSet(w, h, 3);
    return rest;
  }
  // At-rest accumulation (canvas draws with opts.accumulate). hist.n: frames since the last reset. A reset
  // comes from any change of the key (scroll, view, size, march scale, switches, look, exposure, fog, debug)
  // or a time jump. Frame 0 marches with no offset and seeds the history with UpscaleGas. Frame n >= 1
  // marches with the Halton (2, 3) offset n and adds its samples (RESOLVE_FS).
  // v23: the display weight of the mean comes from fade-in.js (FADE: a hold, then a smoothstep in time and in
  // frames). It replaces the linear ramp of 6 frames, which showed as a pop about 0.1 s after the stop.
  // window.__fadeNow (tools only): a function that returns the fade clock in ms, so a capture can step it.
  const ACC = { sigma: K.sigma, capStatic: K.capStatic, capAnim: K.capAnim, frames: K.frames, sharp: K.sharp, restSharp: K.restSharp };
  const hist = { set: [null, null], seed: null, cur: 0, n: 0, key: '', t: 0, on: false, t0: 0, tA: 0 };
  const fadeNow = () => ((typeof window !== 'undefined' && window.__fadeNow) ? window.__fadeNow() : performance.now());
  const fadeSec = () => Math.max(0, (fadeNow() - hist.t0) / 1000);
  let ver = 0;
  const seen = {};
  const bump = (k, v) => { const j = JSON.stringify(v); if (seen[k] !== j) { seen[k] = j; ver++; } };
  function histTargets(w, h) {
    if (!hist.set[0] || hist.set[0].w !== w || hist.set[0].h !== h) {
      hist.set.forEach(freeSet); freeSet(hist.seed);
      hist.set = [targetSet(w, h, 1), targetSet(w, h, 1)]; hist.seed = targetSet(w, h, 1);
      hist.n = 0; hist.key = '';
    }
    return hist.set;
  }
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

  let fog = fogRow(null);
  let fogLoss = 0.45;
  let debugView = 0, debugZ = [0, 1920];
  let trimEv = layers && layers.exposureTrimEv != null ? layers.exposureTrimEv : 0;
  let offsetEv = 0;
  let cat = catalogue;
  let lay = layers;

  // Star light row (11.3): the light-curve records in draw order; the row is written when it changes.
  let lcList = [], starRow = new Float32Array(ROW), starRowAnim = null;
  function prepareStars() {
    lcList = cat ? prepareLightCurves(cat, depthOrder(cat.stars, cat.starCount, 8)) : [];
    starRowAnim = null;
  }
  prepareStars();

  const dataName = 'data';
  if (registry.get(dataName)) registry.release(dataName);
  const dataEntry = registry.tex2D(dataName, 256, 4, gl.RGBA32F, { filter: 'nearest', data: packData(cat, fog.row) });

  function texOf(t, what) {
    if (!t) throw new Error(`[compositor] layers.${what} is needed`);
    if (typeof t === 'string') { const e = registry.get(t); if (!e) throw new Error(`[compositor] no texture ${t}`); return e.tex; }
    if (t.tex) return t.tex;
    return t;
  }
  function upload() {
    gl.bindTexture(gl.TEXTURE_2D, dataEntry.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 4, gl.RGBA, gl.FLOAT, packData(cat, fog.row));
    gl.bindTexture(gl.TEXTURE_2D, null);
    starRowAnim = null;
  }
  // Row 2 for display time t. Quiescent rows are written once; animated rows once per draw (2 KB).
  function writeStars(t, anim) {
    if (!anim && starRowAnim === false) return;
    starVarRow(lcList, t, anim, starRow);
    gl.bindTexture(gl.TEXTURE_2D, dataEntry.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 2, 256, 1, gl.RGBA, gl.FLOAT, starRow);
    gl.bindTexture(gl.TEXTURE_2D, null);
    starRowAnim = anim;
  }

  const UNITS = [[gl.TEXTURE_3D, 'vol', '_Vol'], [gl.TEXTURE_3D, 'skinD', '_SkinD'], [gl.TEXTURE_3D, 'skinA', '_SkinA'],
    [gl.TEXTURE_2D, 'strandSeg', '_StrandSeg'], [gl.TEXTURE_2D, 'strandBin', '_StrandBin']];

  // Lab round 3: unit 6 holds the fine box atlas, or a 1 x 1 x 1 stand-in when the layers have none.
  let fineDummy = null;
  function fineTex() {
    if (lay.fineAtlas) return texOf(lay.fineAtlas, 'fineAtlas');
    if (!fineDummy) {
      fineDummy = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, fineDummy);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, 1, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array(2));
      gl.bindTexture(gl.TEXTURE_3D, null);
    }
    return fineDummy;
  }

  // Lab part 5: unit 7 holds the surface noise (lab-noise.js), 64^3 RGBA8 = 1 MiB of GPU memory.
  let labNoise = null;
  function labNoiseTex() { if (!labNoise) labNoise = labNoiseTexture(gl); return labNoise; }

  function run(fbo, w, h, scrollX, viewW, timeSec, o, linear, dbg) {
    const on = (v, def) => ((v === undefined ? def : v) ? 1 : 0);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const starAnim = !linear && !!o.starAnim && (o.animScale ?? 1) > 0;
    writeStars((timeSec || 0) * (o.animScale ?? 1), starAnim);
    if (!starPass) { pass(prog, fbo, w, h, scrollX, viewW, timeSec, o, linear, dbg, starAnim, null); return; }
    const ms = Math.min(1, Math.max(0.1, o.marchScale ?? 1));
    const lw = Math.max(16, Math.round(w * ms)), lh = Math.max(9, Math.round(h * ms));
    const out = [w, h];
    if (!o.accumulate || linear || dbg || lw >= w - 1) {
      // A march at the output size (Ultra) has nothing to accumulate: free the history and the rest set.
      if (o.accumulate && lw >= w - 1 && hist.set[0]) { hist.set.forEach(freeSet); hist.set = [null, null]; freeSet(hist.seed); hist.seed = null; freeSet(rest); rest = null; hist.on = false; hist.n = 0; hist.key = ''; }
      // One-off draws (the frame-time sweep, the minimap, linear reads): march, then UpscaleGas in the finish.
      const lo = lowTargets(lw, lh);
      pass(prog, lo.fbo, lw, lh, scrollX, viewW, timeSec, o, linear, dbg, starAnim, { march: [0, 0], out });
      pass(progFinish, fbo, w, h, scrollX, viewW, timeSec, o, linear, dbg, starAnim, { gas: lo.tex[0], tau: lo, up: [0, 0, 0, 0], lo: [lw, lh] });
      return;
    }
    const H = histTargets(w, h);
    const key = [scrollX, viewW, w, h, lw, lh, ver, debugView, on(o.gas, true), on(o.stars, true), on(o.objects, true), on(o.gray, false),
      o.fine === false ? 0 : 1, on(o.embedded, true), on(o.catalogue, true), on(o.deep, true), on(o.dither, true), (o.animScale ?? 1),
      starAnim ? 'anim' : (timeSec || 0)].join('|');
    const accOn = true;
    if (key !== hist.key || !accOn || Math.abs((timeSec || 0) - hist.t) > 0.5) { hist.n = 0; hist.key = key; }
    hist.t = timeSec || 0; hist.on = accOn;
    const n = hist.n;
    if (n === 0) hist.t0 = fadeNow();
    const hn = K.halton > 0 ? ((n - 1) % K.halton) + 1 : n;
    const jit = n === 0 ? [0, 0] : [halton(hn, 2) - 0.5, halton(hn, 3) - 0.5];
    const lo = n === 0 ? restTargets(lw, lh) : lowTargets(lw, lh);
    pass(prog, lo.fbo, lw, lh, scrollX, viewW, timeSec, o, linear, dbg, starAnim, { march: jit, out });
    // Frame 0: the seed (UpscaleGas) and a cleared history. Frame n >= 1: add the offset samples.
    if (n === 0) { gl.bindFramebuffer(gl.FRAMEBUFFER, H[hist.cur].fbo); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); }
    const src = H[hist.cur], dst = n === 0 ? hist.seed : H[1 - hist.cur];
    curP = progResolve;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(progResolve.prog);
    gl.activeTexture(gl.TEXTURE0 + 8); gl.bindTexture(gl.TEXTURE_2D, lo.tex[0]);
    gl.activeTexture(gl.TEXTURE0 + 9); gl.bindTexture(gl.TEXTURE_2D, src.tex[0]);
    gl.uniform1i(U('_GasLo'), 8);
    { const l = U('_Hist'); if (l) gl.uniform1i(l, 9); }
    gl.uniform2f(U('_LoSize'), lw, lh);
    gl.uniform2f(U('_LoJit'), jit[0], jit[1]);
    gl.uniform2f(U('_OutSize'), w, h);
    { const l = U('_Acc'); if (l) gl.uniform4f(l, n === 0 ? 0 : 1, ACC.sigma, 0, starAnim ? ACC.capAnim : ACC.capStatic); }
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0 + 8); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + 9); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    if (n > 0) hist.cur = 1 - hist.cur;
    // The motion frames (always frame 0) get the cross sharpen of the seed. At rest the mean replaces the seed
    // by the fade weight (fade-in.js), and the sharpen fades out with it.
    // hist.tA: the fade clock of this draw. converging() and fadeState() read it with the draw index n.
    hist.tA = fadeSec();
    const alpha = n === 0 ? 0 : fadeWeight(hist.tA, n);
    pass(progFinish, fbo, w, h, scrollX, viewW, timeSec, o, linear, dbg, starAnim,
      { hist: H[hist.cur].tex[0], seed: hist.seed.tex[0], tau: rest, up: [1, ACC.sharp * (1 - alpha), alpha, 0], lo: [lw, lh], restSharp: ACC.restSharp });
    hist.n = n + 1;
  }
  function pass(P, fbo, w, h, scrollX, viewW, timeSec, o, linear, dbg, starAnim, lo) {
    curP = P;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.prog);
    if (lo && lo.march) {
      { const l = U('_MarchJit'); if (l) gl.uniform2f(l, lo.march[0], lo.march[1]); }
      { const l = U('_OutSize'); if (l) gl.uniform2f(l, lo.out[0], lo.out[1]); }
    } else if (lo) {
      // Units 8-11: the march gas, the history, the tau knots (A, B).
      [['_GasLo', lo.gas || lo.tau.tex[0]], ['_GasHist', lo.hist || lo.tau.tex[0]], ['_TauLoA', lo.tau.tex[1]], ['_TauLoB', lo.tau.tex[2]],
        ['_GasSeed', lo.seed || lo.tau.tex[0]]].forEach(([n, t], k) => {
        gl.activeTexture(gl.TEXTURE0 + 8 + k); gl.bindTexture(gl.TEXTURE_2D, t);
        const l = U(n); if (l) gl.uniform1i(l, 8 + k);
      });
      { const l = U('_Up'); if (l) gl.uniform4fv(l, lo.up); }
      { const l = U('_LoSz'); if (l) gl.uniform2fv(l, lo.lo); }
      { const l = U('_Sh'); if (l) gl.uniform4f(l, lo.restSharp || 0, K.sharpKind, 0, 0); }
    }
    UNITS.forEach(([target, key, name], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, texOf(lay[key], key));
      const l = U(name); if (l) gl.uniform1i(l, unit);
    });
    gl.activeTexture(gl.TEXTURE0 + 5); gl.bindTexture(gl.TEXTURE_2D, dataEntry.tex);
    { const l = U('_Data'); if (l) gl.uniform1i(l, 5); }
    gl.activeTexture(gl.TEXTURE0 + 6); gl.bindTexture(gl.TEXTURE_3D, fineTex());
    { const l = U('_FineM'); if (l) gl.uniform1i(l, 6); }
    gl.activeTexture(gl.TEXTURE0 + 7); gl.bindTexture(gl.TEXTURE_3D, labNoiseTex());
    { const l = U('_LabNoise'); if (l) gl.uniform1i(l, 7); }
    const f1 = (n, v) => { const l = U(n); if (l) gl.uniform1f(l, v); };
    const fv = (n, v) => {
      const l = U(n); if (!l) return;
      if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else gl.uniform4fv(l, v);
    };
    const on = (v, def) => ((v === undefined ? def : v) ? 1 : 0);
    const stars = on(o.stars, true);
    const vm = lay.volMeta;
    f1('_ScrollX', scrollX);
    fv('_View', [viewW, 1080, 5760, 0]);
    f1('_DustBand', lay.dustBand ?? 0.6);
    f1('_E0', lay.exposure ?? 1);
    fv('_VolDims', vm.dims);
    fv('_VolDec', [1 / vm.volScale, 1 / vm.sigScale]);
    fv('_SkinLo', vm.skinLo);
    fv('_SkinHi', vm.skinHi);
    fv('_StrandFamily', [0, 0]); // Strand tubes are off: the user rejected them as streaks (2026-11-20).
    f1('_StrandAbsorb', lay.strandAbsorb ?? 0);
    for (const k of LOOK_KEYS) if (lay.look && lay.look[k]) fv(k, lay.look[k]);
    f1('_ExposureOffsetEv', offsetEv);
    f1('_ExposureTrimEv', trimEv);
    f1('_AnimScale', o.animScale ?? 1);
    f1('_TimeY', timeSec || 0);
    f1('_StarAnim', starAnim ? 1 : 0);
    const view = dbg ? dbg.view : (linear ? 0 : debugView);
    f1('_DebugView', view);
    fv('_DebugZ', dbg && dbg.z ? dbg.z : debugZ);
    f1('_FogChromaLoss', linear ? 0 : fogLoss);
    f1('_FogCount', fog.n);
    const dg = o.deepGlow || [0, 0, 0, 0];
    fv('_DeepGlow', [dg[0], dg[1], dg[2], dg[3] || 0]);
    f1('_Dither', linear ? 0 : on(o.dither, true));
    f1('_StretchOff', linear ? 1 : 0);
    f1('_StarCount', cat ? cat.starCount : 0);
    f1('_ObjectCount', cat ? cat.objectCount : 0);
    fv('_Layers', [on(o.gas, true), stars * on(o.embedded, true), stars * on(o.catalogue, true), stars * on(o.deep, true)]);
    fv('_Flags', [on(o.objects, true), linear ? 0 : on(o.gray, false), linear ? 0 : 1, 0]);
    fv('_TargetSize', [w, h]);
    {
      // Lab round 3: up to 3 fine boxes in one atlas. A box face on the world edge has no blend. A face shared
      // by two boxes (L and M at x 1920) blends to the coarse step like any inner face: a hard switch there made
      // vertical stripes at s0, because the oblique march crosses the face once per 20 px step.
      const boxes = lay.fineAtlas && lay.fine ? lay.fine.slice(0, 3) : [];
      const off = (typeof window !== 'undefined' && window.__fineOff) || o.fine === false;
      const offIds = (typeof window !== 'undefined' && (window.__fineOffIds || (/[?&]fineoff=([A-Z,]+)/.exec(location.search) || [])[1])) || '';   // lab: boxes off
      const WORLD = [5760, 1080, 1920];
      const BO = new Float32Array(12), BE = new Float32Array(12), BD = new Float32Array(12), BC = new Float32Array(12);
      const BL = new Float32Array(12), BH = new Float32Array(12);
      boxes.forEach((b, k) => {
        BO.set([...b.origin, offIds.includes(b.id) ? 0 : 1], 4 * k);
        BE.set([...b.ext, 0], 4 * k);
        BD.set([...b.dims, b.atlasX], 4 * k);
        BC.set([b.sigMax, b.lumLog2[0], b.lumLog2[1], 0], 4 * k);
        BL.set([0, 1, 2].map((a) => (b.origin[a] > 0 ? 1 : 0)).concat(0), 4 * k);
        BH.set([0, 1, 2].map((a) => (b.origin[a] + b.ext[a] < WORLD[a] ? 1 : 0)).concat(0), 4 * k);
      });
      const av = (n, v) => { const l = U(n); if (l) gl.uniform4fv(l, v); };
      av('_FineBO', BO); av('_FineBE', BE); av('_FineBD', BD); av('_FineBC', BC); av('_FineBL', BL); av('_FineBH', BH);
      const ad = boxes.length ? boxes[0].atlasDims : [1, 1, 1];
      fv('_FineOn', [boxes.length && !off ? 1 : 0, 120, boxes.length, 0]);   // round 3: 40 -> 120 px (face stripes at s100)
      fv('_FineAtlas', [ad[0], ad[1], ad[2], boxes.length]);
    }
    {
      // Lab parts 3-5 and the cold section: the values of render/lab-consts.js. In the specialized program
      // they are constants, so U(name) is null and these calls do nothing.
      for (const [n, v] of Object.entries(labTable)) { const l = U(n); if (l) gl.uniform4fv(l, v); }
      // The zone colours of the lab look follow the palette (nircam keeps the tuned zones exactly).
      const lz = U('_LabZ'); if (lz) gl.uniform4fv(lz, labZones(lay.look, comp.palette.nircam));
    }
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    UNITS.forEach(([target], unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, null); });
    gl.activeTexture(gl.TEXTURE0 + 5); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + 6); gl.bindTexture(gl.TEXTURE_3D, null);
    gl.activeTexture(gl.TEXTURE0 + 7); gl.bindTexture(gl.TEXTURE_3D, null);
    if (lo && !lo.march) for (let k = 0; k < 5; k++) { gl.activeTexture(gl.TEXTURE0 + 8 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return {
    program: prog,
    uniformVec4Use: vec4Use(gl, prog),
    draw(scrollX, viewW, timeSec, opts) {
      run(null, gl.drawingBufferWidth, gl.drawingBufferHeight, scrollX, viewW, timeSec, opts || {}, false, null);
    },
    drawTo(fbo, w, h, scrollX, viewW, timeSec, opts) {
      run(fbo, w, h, scrollX, viewW, timeSec, opts || {}, false, null);
    },
    drawLinear(target, scrollX, viewW, debug) {
      const e = typeof target === 'string' ? registry.get(target) : target;
      if (!e || !e.fbos || !e.fbos[0]) throw new Error('[compositor] drawLinear needs a renderable registry 2D target');
      run(e.fbos[0], e.w, e.h, scrollX, viewW, 0, { animScale: 0 }, true, debug || null);
    },
    setFog(circles, loss) {
      fog = fogRow(circles); bump('fog', [circles, loss]);
      fog = fogRow(circles);
      if (loss != null) fogLoss = loss;
      gl.bindTexture(gl.TEXTURE_2D, dataEntry.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 3, 256, 1, gl.RGBA, gl.FLOAT, fog.row);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    // view: a DEBUG_VIEWS name or number. zWindow: [z0, z1] px for the depth and tau views.
    setDebug(view, zWindow) {
      debugView = typeof view === 'string' ? (DEBUG_VIEWS[view] ?? 0) : (view | 0); bump('debug', [view, zWindow]);
      if (zWindow) debugZ = [zWindow[0], zWindow[1]];
    },
    setExposure(trim, offset) { if (trim != null) trimEv = trim; if (offset != null) offsetEv = offset; bump('exp', [trimEv, offsetEv]); },
    setCatalogue(c) { cat = c; ver++; prepareStars(); upload(); },
    setLayers(l) { lay = l; ver++; if (l.exposureTrimEv != null) trimEv = l.exposureTrimEv; upload(); },
    // True while the at-rest accumulation has frames to add (main.js keeps the loop drawing).
    // v23: it also stays true until the fade weight is 1 (fadeDone), so the fade has a draw on each frame.
    // The test uses the index of the last draw (hist.n - 1) and its clock (hist.tA), because the draw with
    // index n shows fadeWeight(t, n). Before, the test used hist.n, so the loop stopped one draw early: the last
    // image held fadeWeight(t, 23) = 0.994 of the mean, and a wait for the weight 1 never ended.
    // When it is false, the loop of main.js draws only on a change (or the animation), so the GPU is idle at rest.
    converging() {
      if (!(starPass && hist.on && hist.n > 0)) return false;
      return hist.n < ((typeof window !== "undefined" && window.__accFrames) || ACC.frames) || !fadeDone(hist.tA, hist.n - 1);
    },
    historyFrames() { return hist.n; },
    // The fade state of the last rest draw: frames, seconds since the reset, and the weight (tools only).
    // w: the weight of the mean in the last draw (on screen). t: the fade clock now, in seconds.
    fadeState() { const t = fadeSec(), n = hist.n; return { n, t, w: n > 1 ? fadeWeight(hist.tA, n - 1) : 0 }; },
    resetHistory() { hist.key = ''; },
    dispose() {
      gl.deleteProgram(prog.prog);
      if (progFinish) gl.deleteProgram(progFinish.prog);
      if (progResolve) gl.deleteProgram(progResolve.prog);
      lows.forEach(freeSet); lows = []; freeSet(rest); rest = null; hist.set.forEach(freeSet); hist.set = [null, null]; freeSet(hist.seed); hist.seed = null;
      gl.deleteVertexArray(vao);
      if (registry.get(dataName)) registry.release(dataName);
    },
  };
}
