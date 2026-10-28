// ============================================================================
//  VIEW  ·  WebGL2 tiled slice viewer for the EM explorer (public API)
// ----------------------------------------------------------------------------
//  createViewer(canvas, { source, onState, overlay = true, minimap = true,
//                         insets, background, lodBias }) -> viewer
//    setVolume(vol)              a DATA Volume (or view/stub.js); fits the view
//    setPlane('xy'|'xz'|'yz')    the main plane
//    setLayout('single'|'three') one plane, or the main plane and two small
//    setSlice(nm)                the main plane slice, nm on its normal axis
//    goTo({ x, y, z, zoom, plane, units: 'vx'|'nm', animate })
//                                x y z voxels of scale 0 (default); zoom is
//                                CSS px per scale-0 voxel (1 = one to one)
//    setContrast(lo, hi, gamma)  window lo..hi in 0..1 (or 0..255), gamma
//    setInvert(b)
//    autoContrast() -> { lo, hi }  window from the 0.5 and 99.5 percentiles of
//                                the base tiles. It runs once by itself per
//                                setVolume (opts.autoContrast !== false) when
//                                the base level lands; setContrast stops it.
//    setInsets({ top, right, bottom, left })  CSS px kept clear of chrome
//    state() -> { plane, layout, x, y, z, zoom, nm, nmPerPx, scaleIndex,
//                 scaleKey, slice: { axis, index, count }, contrast, invert,
//                 cursor, scaleBar, loading, errors, ready }
//    resize()  dispose()
//    saverShots = { flyTo(target, { ms }) -> Promise, prefetch(target),
//                   setBand({ t, b } | null), isReady(target) -> 0..1 }
//
//  How it works. The camera is one 3D centre (nm) and nmPerPx. Each view
//  draws one plane through the centre. The zoom picks the target scale, so
//  one device px shows about one voxel (camera.js chooseScale). A frame
//  asks the tile store for the levels of view/plan.js wantLevels (base, a
//  cheap first level, tgt+2, tgt+1, tgt), nearest the focus first, and on
//  the first frame of a volume calls vol.prefetchIndexes. It draws
//  every loaded level from coarse to fine, so a coarse tile shows under a
//  fine tile that is not there yet. A slice step shows the nearest loaded
//  slice of the same place until the new tile lands. New tiles fade in.
//
//  Input. Drag pans with a fling. Wheel and pinch zoom about the pointer.
//  Shift+wheel, the slice rail, two-finger vertical drag, PageUp/PageDown,
//  ',' '.' '[' ']' step the slice. Double tap zooms in (shift: out), a
//  two-finger tap zooms out. Arrows pan, + and - zoom, Home fits.
//
//  GREP MAP
//    grep -n 'function computeWants'   what to load, in which order
//    grep -n 'function drawView'       coarse-under-fine draw of one view
//    grep -n 'function drawMinimap'    minimap and its frame
//    grep -n 'function stepAnims'      zoom ease, fling, tween, flight
//    grep -n 'function onPointer'      pointer gestures
//    grep -n 'function onWheel'        wheel zoom and slice
//    grep -n 'function onKey'          keyboard
//    grep -n 'saverShots'              saver helpers
// ============================================================================
import {
  PLANES, AXIS, extentNm, inPlaneRes, zoomToNmPerPx, nmPerPxToZoom, chooseScale, baseScale,
  visibleTiles, sliceIndex, scaleBar, fine0For, zoomLimits, fitNmPerPx, clampCamera, snapSlice,
  layoutViews, viewAt, screenToWorld, viewRectNm, zoomPath, easeInOut,
} from './camera.js';
import { TileStore, tileKey, posKey } from './tiles.js';
import { computeWants as planWants, chunkGroups, LOOKAHEAD } from './plan.js';
import { fetchSlice } from './slice.js';
import { createRenderer } from './gl.js';
import { wheelPixels, wheelZoomFactor, classifyTwo, Fling, TapCounter } from './input.js';
import { createOverlay } from './overlay.js';

export { stubVolume } from './stub.js';
export * as camera from './camera.js';

const PLANE_RGB = { xy: [0.384, 0.769, 1.0], xz: [1.0, 0.604, 0.384], yz: [0.525, 0.863, 0.486] };
const FADE_MS = 200;

export function createViewer(canvas, opts = {}) {
  const doc = canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const win = (doc && doc.defaultView) || globalThis;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) { const e = new Error('WebGL2 is not available'); e.code = 'no-webgl2'; throw e; }
  const R = createRenderer(gl);
  const mq = q => { try { return !!win.matchMedia && win.matchMedia(q).matches; } catch (e) { return false; } };
  const phone = opts.phone ?? (mq('(pointer:coarse)') || Math.min(win.innerWidth || 1e4, win.innerHeight || 1e4) < 600);
  const lodBias = opts.lodBias ?? (phone ? 1.35 : 1.0);
  const bg = opts.background || [0.027, 0.031, 0.039];
  const ground = [0.075, 0.082, 0.094, 1];
  const now = () => (win.performance ? win.performance.now() : Date.now());

  let vol = null, volKey = '', plane = 'xy', layout = 'single';
  const cam = { center: [0, 0, 0], nmPerPx: 1 };
  let contrast = { lo: 0, hi: 1, gamma: 1 }, invert = false;
  let insets = { top: 0, right: 0, bottom: 0, left: 0, ...(opts.insets || {}) };
  let band = null;
  let cssW = 1, cssH = 1, dpr = 1, views = [];
  let showMinimap = opts.minimap !== false, mmBox = null;
  let disposed = false, raf = 0, lastT = 0;
  let pointer = null;            // last hover point { x, y }
  let extra = [];                // prefetch descriptors (saver)
  let lastStateSig = '', lastFocus = null, warmed = false;
  let flags = { loading: false, ready: false, targetLoaded: 0, targetTotal: 0 };
  // auto window: a histogram of the base tiles; 0 is the fill outside the
  // data, so it does not count
  const hist = new Uint32Array(256);
  let autoPending = opts.autoContrast !== false;
  function addHist(data) { for (let i = 0; i < data.length; i += 3) { const x = data[i]; if (x) hist[x]++; } }
  function autoWindow(apply = true) {
    let n = 0; for (let i = 1; i < 256; i++) n += hist[i];
    if (n < 64) return null;
    const pct = q => { let acc = 0; const lim = q * n; for (let i = 1; i < 256; i++) { acc += hist[i]; if (acc >= lim) return i; } return 255; };
    let lo = pct(0.005), hi = pct(0.995);
    if (hi - lo < 8) { const m = (lo + hi) / 2; lo = Math.max(0, m - 4); hi = Math.min(255, m + 4); }
    const pad = (hi - lo) * 0.04;
    const r = { lo: Math.max(0, lo - pad) / 255, hi: Math.min(255, hi + pad) / 255 };
    if (apply) { contrast = { ...contrast, ...r }; invalidate(); }
    return r;
  }

  const store = new TileStore({
    maxInFlight: phone ? 8 : 12,
    maxTiles: phone ? 360 : 900,
    lookahead: LOOKAHEAD,
    load: (d, signal) => fetchSlice(d.vol, d.scale, d.plane, d.index, d.rect, signal, d.prio),
    upload: (res, d) => {
      if (!res || !res.data) return null;
      const w = res.width, h = res.height;
      let data = res.data;
      if (data.length < w * h) { const p = new Uint8Array(w * h); p.set(data); data = p; }
      if (vol && d.vol === vol && d.scale === baseScale(vol.scales)) addHist(data);
      return R.texture(data, w, h);
    },
    free: t => R.freeTexture(t),
    onLoad: () => invalidate(),
  });

  const ov = opts.overlay === false || !doc ? null : createOverlay(canvas, {
    onSlice(f, phase) {
      if (!vol) return;
      const n = PLANES[plane].n, ext = extentNm(vol)[n];
      stopAnims();
      cam.center[n] = snapSlice(vol, n, f * ext);
      invalidate();
    },
    onSliceStep(dir) { stepSlice(dir); },
  });

  // ---------------------------------------------------------------- layout
  function resize() {
    const wasTiny = cssW <= 2 || cssH <= 2;
    cssW = Math.max(1, canvas.clientWidth || canvas.width || 1);
    cssH = Math.max(1, canvas.clientHeight || canvas.height || 1);
    dpr = Math.min(win.devicePixelRatio || 1, 2);
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    relayout();
    if (vol && wasTiny && cssW > 2 && cssH > 2) fit(false);
    if (ov) ov.place();
    invalidate();
  }
  function effInsets() {
    if (!band) return insets;
    return { ...insets, top: Math.max(insets.top, band.t || 0), bottom: Math.max(insets.bottom, band.b || 0) };
  }
  function relayout() {
    views = layoutViews(cssW, cssH, layout, plane, effInsets());
    const ins = effInsets();
    mmBox = null;
    if (vol && showMinimap) {
      const a = PLANES[plane], ext = extentNm(vol);
      const side = Math.min(phone ? 96 : 150, Math.max(64, Math.min(cssW, cssH) * 0.24));
      const k = side / Math.max(ext[a.u], ext[a.v]);
      const w = Math.max(24, Math.round(ext[a.u] * k)), h = Math.max(24, Math.round(ext[a.v] * k));
      const main = views[0].vp;
      const x = main.x + main.w - Math.min(ins.right, main.w * 0.45) - 14 - w;
      const y = main.y + main.h - Math.min(ins.bottom, main.h * 0.45) - 14 - h;
      mmBox = { x, y, w, h, k, bottomGap: cssH - y };
    }
    if (ov) ov.setInsets(ins);
  }

  // ---------------------------------------------------------------- frame
  function invalidate() { if (!raf && !disposed) raf = (win.requestAnimationFrame || (f => setTimeout(() => f(now()), 16)))(frame); }

  function limits() { const v = views[0].vp; return zoomLimits(vol, plane, v.w, v.h); }

  function targetScale(p) { return chooseScale(vol.scales, p, cam.nmPerPx / dpr, lodBias, fine0For(vol, p)); }

  // view/plan.js: base, a cheap first level, tgt+2, tgt+1, tgt (round 2)
  function computeWants(vw, vi, out) {
    planWants(vw, vi, { vol, cam, dpr, lodBias, volKey, ready: flags.ready }, out);
  }

  function drawView(vw, t) {
    const p = vw.plane, a = PLANES[p], n = a.n, sc = vol.scales, base = baseScale(sc), tgt = targetScale(p);
    R.beginView(vw.vp, vw.fx, vw.fy, [cam.center[a.u], cam.center[a.v]], cam.nmPerPx, dpr, canvas.height, layout === 'three' ? bg : null);
    const ext = extentNm(vol);
    R.drawRect([0, 0, ext[a.u], ext[a.v]], ground);
    let fading = false, tot = 0, got = 0, btot = 0, bgot = 0;
    const lo = Math.max(0, tgt - 1);
    for (let L = base; L >= lo; L--) {
      const idx = sliceIndex(sc[L], p, cam.center[n]);
      const tiles = visibleTiles(vw, cam, sc[L]);
      if (L < tgt && tiles.length > 400) continue;
      for (const tl of tiles) {
        let tile = store.get(tileKey(volKey, L, p, idx, tl.tu, tl.tv)), exact = !!tile;
        if (L === tgt) { tot++; if (exact) got++; }
        if (L === base) { btot++; if (exact) bgot++; }
        if (!tile && L >= tgt) tile = store.nearest(posKey(volKey, L, p, tl.tu, tl.tv), idx, L === tgt ? 6 : 2);
        if (!tile || !tile.tex) continue;
        let alpha = 1;
        if (exact) {
          const age = t - tile.born;
          if (age < FADE_MS) {
            alpha = Math.max(0, age / FADE_MS); fading = true;
            // fade over the old slice of the same place, not over the coarse level
            if (L >= tgt) { const old = store.nearest(posKey(volKey, L, p, tl.tu, tl.tv), idx, L === tgt ? 6 : 2, idx); if (old && old.tex) R.drawTile(old.tex, tl.nm, 1); }
          }
        }
        R.drawTile(tile.tex, tl.nm, alpha);
      }
    }
    if (layout === 'three') {
      // crosshair: the other two planes through the centre, in their colours
      const k = cam.nmPerPx, r = viewRectNm(vw, cam);
      const pu = PLANE_NAMES_BY_N[a.u], pv = PLANE_NAMES_BY_N[a.v];
      R.drawRect([cam.center[a.u] - 0.5 * k, r[1], cam.center[a.u] + 0.5 * k, r[3]], [...PLANE_RGB[pu], 0.55]);
      R.drawRect([r[0], cam.center[a.v] - 0.5 * k, r[2], cam.center[a.v] + 0.5 * k], [...PLANE_RGB[pv], 0.55]);
      R.drawRect([r[0], r[1], r[2], r[1] + 3 * k], [...PLANE_RGB[p], 0.9]);
    }
    return { fading, tot, got, baseDone: btot > 0 && bgot >= btot };
  }

  function drawMinimap(t) {
    if (!mmBox || !views.length) return false;
    const vw = views[0], a = PLANES[vw.plane], ext = extentNm(vol);
    const r = viewRectNm(vw, cam);
    if (r[0] <= 0 && r[1] <= 0 && r[2] >= ext[a.u] && r[3] >= ext[a.v]) { if (ov) ov.setMinimap(null); return false; }
    const k = 1 / mmBox.k;  // nm per CSS px in the minimap
    const vp = { x: mmBox.x, y: mmBox.y, w: mmBox.w, h: mmBox.h };
    R.beginView(vp, vp.w / 2, vp.h / 2, [ext[a.u] / 2, ext[a.v] / 2], k, dpr, canvas.height, bg);
    R.drawRect([0, 0, ext[a.u], ext[a.v]], ground);
    const sc = vol.scales, base = baseScale(sc), idx = sliceIndex(sc[base], vw.plane, cam.center[a.n]);
    const mmView = { plane: vw.plane, vp, fx: vp.w / 2, fy: vp.h / 2 };
    const mmCam = { center: cam.center.slice(), nmPerPx: k };
    mmCam.center[a.u] = ext[a.u] / 2; mmCam.center[a.v] = ext[a.v] / 2;
    for (const tl of visibleTiles(mmView, mmCam, sc[base])) {
      const tile = store.get(tileKey(volKey, base, vw.plane, idx, tl.tu, tl.tv)) || store.nearest(posKey(volKey, base, vw.plane, tl.tu, tl.tv), idx, 8);
      if (tile && tile.tex) R.drawTile(tile.tex, tl.nm, 0.85);
    }
    // the view box, at least 4 px so it stays visible far in
    const cu = (r[0] + r[2]) / 2, cv = (r[1] + r[3]) / 2;
    const hw = Math.max((r[2] - r[0]) / 2, 2 * k), hh = Math.max((r[3] - r[1]) / 2, 2 * k);
    const b = [cu - hw, cv - hh, cu + hw, cv + hh], th = 1.5 * k, col = [0.93, 0.95, 0.96, 1];
    R.drawRect([b[0], b[1], b[2], b[1] + th], col); R.drawRect([b[0], b[3] - th, b[2], b[3]], col);
    R.drawRect([b[0], b[1], b[0] + th, b[3]], col); R.drawRect([b[2] - th, b[1], b[2], b[3]], col);
    // frame of the minimap
    const fr = [0, 0, ext[a.u], ext[a.v]], ft = 1 * k, fc = [1, 1, 1, 0.28];
    R.drawRect([fr[0], fr[1], fr[2], fr[1] + ft], fc); R.drawRect([fr[0], fr[3] - ft, fr[2], fr[3]], fc);
    R.drawRect([fr[0], fr[1], fr[0] + ft, fr[3]], fc); R.drawRect([fr[2] - ft, fr[1], fr[2], fr[3]], fc);
    if (ov) ov.setMinimap(mmBox, `${vw.plane} · ${AXIS[a.n]} ${Math.floor(cam.center[a.n] / vol.scales[0].resolution[a.n]).toLocaleString('en-US')}`);
    return true;
  }

  function frame(t) {
    raf = 0;
    if (disposed) return;
    const dt = lastT ? Math.min(64, t - lastT) : 16; lastT = t;
    if (!vol) { R.begin(canvas.width, canvas.height, bg); return; }
    let anim = stepAnims(t, dt);
    clampCamera(cam, vol, limits());
    const wants = [];
    views.forEach((vw, i) => computeWants(vw, i, wants));
    for (const d of extra) wants.push(d);
    store.want(wants);
    // once per volume: warm the shard indexes of every tile of the first view
    if (!warmed && wants.length && typeof vol.prefetchIndexes === 'function') {
      warmed = true;
      try { Promise.resolve(vol.prefetchIndexes(chunkGroups(vol, wants))).catch(() => {}); } catch (e) {}
    }
    if (vol.setFocus) {
      const c = cam.center, f = lastFocus, tol = 32 * cam.nmPerPx;
      if (!f || Math.abs(c[0] - f[0]) > tol || Math.abs(c[1] - f[1]) > tol || Math.abs(c[2] - f[2]) > tol) {
        lastFocus = c.slice();
        try { vol.setFocus({ x: c[0], y: c[1], z: c[2] }); } catch (e) {}
      }
    }
    R.begin(canvas.width, canvas.height, bg);
    R.setWindow(contrast.lo, contrast.hi, contrast.gamma, invert);
    let fading = false, tot = 0, got = 0;
    let baseDone = false;
    for (const vw of views) { const r = drawView(vw, t); fading = fading || r.fading; if (vw.main) { tot = r.tot; got = r.got; baseDone = r.baseDone; } }
    if (autoPending && baseDone && autoWindow(true)) { autoPending = false; anim = true; }
    lastMMShown = drawMinimap(t);
    flags.targetLoaded = got; flags.targetTotal = tot;
    const st = store.stats();
    flags.ready = tot > 0 && got >= tot;
    flags.loading = st.inFlight > 0;
    if (ov) {
      ov.update(overlayInfo());
      ov.message(st.loaded === 0 && st.errors >= 6 ? 'The data server does not answer. Check the network, then pan or zoom to try again.' : '');
    }
    emitState();
    if (anim || fading || (flags.ready && st.inFlight === 0 && !flags.adjDone)) invalidate();
    flags.adjDone = flags.ready && st.inFlight === 0;
  }

  function overlayInfo() {
    const s = state();
    const sc = vol.scales[s.scaleIndex];
    const r = inPlaneRes(sc, plane);
    return {
      bar: s.scaleBar, axes: AXIS,
      cursor: s.cursor ? [s.cursor.x, s.cursor.y, s.cursor.z] : null,
      res: `${fmtNm(cam.nmPerPx / dpr)}/px · scale ${s.scaleIndex} (${fmtNm(r)})`,
      loading: flags.loading,
      slice: s.slice,
    };
  }

  function emitState() {
    if (!opts.onState) return;
    const s = state();
    const sig = [s.plane, s.layout, s.x.toFixed(2), s.y.toFixed(2), s.z.toFixed(2), s.zoom.toPrecision(6), s.scaleIndex, s.contrast.lo, s.contrast.hi, s.contrast.gamma, s.invert, s.ready, s.loading, s.cursor && [s.cursor.x, s.cursor.y, s.cursor.z].join()].join('|');
    if (sig === lastStateSig) return;
    lastStateSig = sig;
    try { opts.onState(s); } catch (e) { console.error(e); }
  }

  // ---------------------------------------------------------------- anims
  let zoomAnim = null, glide = null, tween = null, fly = null;
  function stopAnims() { zoomAnim = glide = tween = null; if (fly) { const f = fly; fly = null; f.resolve(false); } }

  function placeAnchor(vw, aw, sx, sy) {
    const a = PLANES[vw.plane];
    cam.center[a.u] = aw[a.u] - (sx - vw.vp.x - vw.fx) * cam.nmPerPx;
    cam.center[a.v] = aw[a.v] - (sy - vw.vp.y - vw.fy) * cam.nmPerPx;
  }

  function stepAnims(t, dt) {
    let on = false;
    if (zoomAnim) {
      const l0 = Math.log(cam.nmPerPx), l1 = Math.log(zoomAnim.target);
      const k = 1 - Math.exp(-dt / 75);
      const l = Math.abs(l1 - l0) < 0.002 ? l1 : l0 + (l1 - l0) * k;
      cam.nmPerPx = Math.exp(l);
      placeAnchor(zoomAnim.view, zoomAnim.aw, zoomAnim.sx, zoomAnim.sy);
      if (l === l1) zoomAnim = null; else on = true;
    }
    if (glide) {
      const e = t - glide.t0;
      const dx = Fling.glide(glide.vx, e), dy = Fling.glide(glide.vy, e);
      const a = PLANES[glide.view.plane];
      cam.center[a.u] -= (dx - glide.px) * cam.nmPerPx;
      cam.center[a.v] -= (dy - glide.py) * cam.nmPerPx;
      glide.px = dx; glide.py = dy;
      if (Math.hypot(glide.vx, glide.vy) * Math.exp(-e / 325) < 0.01) glide = null; else on = true;
    }
    if (tween) {
      const f = Math.min(1, (t - tween.t0) / tween.ms), e = 1 - Math.pow(1 - f, 3);
      for (let i = 0; i < 3; i++) cam.center[i] = tween.c0[i] + (tween.c1[i] - tween.c0[i]) * e;
      cam.nmPerPx = Math.exp(tween.l0 + (tween.l1 - tween.l0) * e);
      if (f >= 1) tween = null; else on = true;
    }
    if (fly) {
      const f = Math.min(1, (t - fly.t0) / fly.ms), e = easeInOut(f);
      const [u, v, w] = fly.path.at(e);
      const a = PLANES[plane];
      cam.center[a.u] = u; cam.center[a.v] = v;
      cam.center[a.n] = fly.n0 + (fly.n1 - fly.n0) * e;
      cam.nmPerPx = w / fly.width;
      if (f >= 1) { const r = fly.resolve; fly = null; extra = []; r(true); } else on = true;
    }
    return on;
  }

  // ---------------------------------------------------------------- slice
  function sliceStepNm(p = plane) {
    const n = PLANES[p].n;
    return vol.scales[targetScale(p)].resolution[n] || vol.scales[0].resolution[n];
  }
  function stepSlice(dir, p = plane) {
    if (!vol || !dir) return;
    const n = PLANES[p].n;
    cam.center[n] = snapSlice(vol, n, cam.center[n] + dir * sliceStepNm(p));
    if (ov && p === plane) ov.flashRail();
    invalidate();
  }

  // ---------------------------------------------------------------- input
  const ptrs = new Map();
  let gest = null;     // { kind: 'pan'|'two'|'mm', ... }
  const fling = new Fling(), taps = new TapCounter();
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const inMM = (x, y) => mmBox && lastMMShown && x >= mmBox.x && x < mmBox.x + mmBox.w && y >= mmBox.y && y < mmBox.y + mmBox.h;
  let lastMMShown = true;

  function mmJump(x, y) {
    const a = PLANES[plane], ext = extentNm(vol);
    cam.center[a.u] = (x - mmBox.x) / mmBox.w * ext[a.u];
    cam.center[a.v] = (y - mmBox.y) / mmBox.h * ext[a.v];
    invalidate();
  }

  function startPan(id, x, y, t) {
    const vw = viewAt(views, x, y) || views[0];
    gest = { kind: 'pan', id, view: vw, aw: screenToWorld(vw, cam, x, y), x0: x, y0: y, t0: t, moved: false };
    fling.reset(); fling.add(x, y, t);
  }
  function startTwo() {
    const [p, q] = [...ptrs.values()];
    const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2, d = Math.hypot(p.x - q.x, p.y - q.y);
    const vw = viewAt(views, cx, cy) || views[0];
    gest = { kind: 'two', view: vw, s: { d, cx, cy }, npp0: cam.nmPerPx, aw: screenToWorld(vw, cam, cx, cy), mode: null,
      n0: cam.center[PLANES[vw.plane].n], t0: now(), moved: false };
  }

  function onPointer(e) {
    if (!vol) return;
    const [x, y] = local(e), t = now();
    if (e.type === 'pointerdown') {
      if (e.button > 0 && e.pointerType === 'mouse') return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      stopAnims();
      ptrs.set(e.pointerId, { x, y });
      if (ptrs.size === 1 && inMM(x, y)) { gest = { kind: 'mm', id: e.pointerId }; mmJump(x, y); return; }
      if (ptrs.size === 1) startPan(e.pointerId, x, y, t);
      else if (ptrs.size === 2) startTwo();
      e.preventDefault();
      return;
    }
    if (e.type === 'pointermove') {
      pointer = { x, y };
      if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'mouse') invalidate(); return; }
      ptrs.set(e.pointerId, { x, y });
      if (!gest) return;
      if (gest.kind === 'mm') { mmJump(x, y); return; }
      if (gest.kind === 'pan' && gest.id === e.pointerId) {
        if (Math.hypot(x - gest.x0, y - gest.y0) > 4) gest.moved = true;
        placeAnchor(gest.view, gest.aw, x, y);
        fling.add(x, y, t);
        invalidate();
      } else if (gest.kind === 'two' && ptrs.size >= 2) {
        const [p, q] = [...ptrs.values()];
        const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2, d = Math.hypot(p.x - q.x, p.y - q.y);
        const nw = { d, cx, cy };
        if (!gest.mode) gest.mode = classifyTwo(gest.s, nw);
        if (gest.mode) gest.moved = true;
        if (gest.mode === 'pinch') {
          cam.nmPerPx = gest.npp0 * gest.s.d / Math.max(1, d);
          clampCamera(cam, vol, limits());
          placeAnchor(gest.view, gest.aw, cx, cy);
        } else if (gest.mode === 'slice') {
          const n = PLANES[gest.view.plane].n;
          const perPx = sliceStepNm(gest.view.plane) / 9;
          cam.center[n] = snapSlice(vol, n, gest.n0 - (cy - gest.s.cy) * perPx);
          if (ov) ov.flashRail();
        }
        invalidate();
      }
      return;
    }
    // up or cancel
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!gest) return;
    if (gest.kind === 'mm') { gest = null; return; }
    if (gest.kind === 'pan') {
      if (gest.twoTap && e.type === 'pointerup' && t - gest.twoTap.t0 < 350) {
        zoomAt(gest.twoTap.view, gest.twoTap.s.cx, gest.twoTap.s.cy, 0.5);
      } else if (e.type === 'pointerup' && !gest.moved && t - gest.t0 < 280) {
        if (taps.tap(x, y, t) === 2) zoomAt(gest.view, x, y, e.shiftKey || e.altKey ? 0.5 : 2);
      } else if (e.type === 'pointerup') {
        const v = fling.velocity(t);
        if (Math.hypot(v.vx, v.vy) > 0.12) { glide = { vx: v.vx, vy: v.vy, t0: t, px: 0, py: 0, view: gest.view }; invalidate(); }
      }
      gest = null;
    } else if (gest.kind === 'two') {
      if (ptrs.size === 0) {
        if (!gest.moved && t - gest.t0 < 300) zoomAt(gest.view, gest.s.cx, gest.s.cy, 0.5);
        gest = null;
      } else if (ptrs.size === 1) {
        const [id, p] = [...ptrs.entries()][0];
        const wasMoved = gest.moved, two = gest;
        startPan(id, p.x, p.y, t);
        gest.moved = true;   // no tap from the remaining finger
        if (!wasMoved) gest.twoTap = two;
      }
    }
  }

  function zoomAt(vw, sx, sy, factor) {
    const aw = screenToWorld(vw, cam, sx, sy);
    const lim = limits();
    const base = zoomAnim ? zoomAnim.target : cam.nmPerPx;
    zoomAnim = { target: Math.min(lim.maxNpp, Math.max(lim.minNpp, base / factor)), aw, sx, sy, view: vw };
    invalidate();
  }

  let sliceAcc = 0;
  function onWheel(e) {
    if (!vol) return;
    e.preventDefault();
    const [x, y] = local(e);
    const vw = viewAt(views, x, y) || views[0];
    const d = wheelPixels(e, cssH);
    if (e.shiftKey || e.altKey) {
      const px = Math.abs(d.y) > Math.abs(d.x) ? d.y : d.x;
      sliceAcc += px;
      const stepPx = e.deltaMode === 0 && Math.abs(px) < 40 ? 24 : Math.abs(px) || 1;
      while (Math.abs(sliceAcc) >= stepPx) { const s = Math.sign(sliceAcc); stepSlice(s, vw.plane); sliceAcc -= s * stepPx; }
      return;
    }
    glide = null; tween = null;
    if (fly) stopAnims();
    const f = wheelZoomFactor(d.y, e.ctrlKey);
    if (e.ctrlKey) {
      // trackpad pinch: follow at once
      const aw = screenToWorld(vw, cam, x, y);
      zoomAnim = null;
      cam.nmPerPx /= f;
      clampCamera(cam, vol, limits());
      placeAnchor(vw, aw, x, y);
      invalidate();
    } else zoomAt(vw, x, y, f);
  }

  function onKey(e) {
    if (!vol || e.metaKey || e.ctrlKey) return;
    const tg = e.target, tag = tg && tg.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
    const vw = views[0], k = e.key, big = e.shiftKey ? 10 : 1;
    const cx = vw.vp.x + vw.fx, cy = vw.vp.y + vw.fy;
    const pan = (fx, fy) => {
      stopAnims();
      const a = PLANES[plane], c1 = cam.center.slice();
      c1[a.u] += fx * vw.vp.w * cam.nmPerPx; c1[a.v] += fy * vw.vp.h * cam.nmPerPx;
      tween = { c0: cam.center.slice(), c1, l0: Math.log(cam.nmPerPx), l1: Math.log(cam.nmPerPx), t0: now(), ms: 260 };
      invalidate();
    };
    let used = true;
    if (k === 'ArrowLeft') pan(-0.25, 0);
    else if (k === 'ArrowRight') pan(0.25, 0);
    else if (k === 'ArrowUp') pan(0, -0.25);
    else if (k === 'ArrowDown') pan(0, 0.25);
    else if (k === '+' || k === '=') zoomAt(vw, cx, cy, 2);
    else if (k === '-' || k === '_') zoomAt(vw, cx, cy, 0.5);
    else if (k === 'PageUp' || k === ',' || k === '[' || k === '<' || k === '{') stepSlice(-big);
    else if (k === 'PageDown' || k === '.' || k === ']' || k === '>' || k === '}') stepSlice(big);
    else if (k === 'Home') fit(true);
    else used = false;
    if (used) e.preventDefault();
  }

  const onLeave = () => { pointer = null; invalidate(); };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerup', onPointer);
  canvas.addEventListener('pointercancel', onPointer);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  win.addEventListener && win.addEventListener('keydown', onKey);
  let ro = null;
  if (win.ResizeObserver) { ro = new win.ResizeObserver(() => resize()); ro.observe(canvas); }
  else if (win.addEventListener) win.addEventListener('resize', resize);
  const onCtxLost = e => { e.preventDefault(); if (ov) ov.message('The graphics context was lost. Reload the page.'); };
  canvas.addEventListener('webglcontextlost', onCtxLost);

  // ---------------------------------------------------------------- api
  function fit(animate) {
    if (!vol) return;
    const vw = views[0], ext = extentNm(vol), a = PLANES[plane];
    const ins = effInsets();
    const w = vw.vp.w - Math.min(ins.left, vw.vp.w * 0.45) - Math.min(ins.right, vw.vp.w * 0.45);
    const h = vw.vp.h - Math.min(ins.top, vw.vp.h * 0.45) - Math.min(ins.bottom, vw.vp.h * 0.45);
    const c1 = cam.center.slice(); c1[a.u] = ext[a.u] / 2; c1[a.v] = ext[a.v] / 2;
    const npp = fitNmPerPx(vol, plane, w, h);
    if (animate) { stopAnims(); tween = { c0: cam.center.slice(), c1, l0: Math.log(cam.nmPerPx), l1: Math.log(npp), t0: now(), ms: 450 }; }
    else { cam.center = c1; cam.nmPerPx = npp; }
    invalidate();
  }

  function setVolume(v) {
    stopAnims();
    store.clear();
    extra = [];
    hist.fill(0); autoPending = opts.autoContrast !== false;
    lastFocus = null; warmed = false;
    vol = v; volKey = v ? String(v.id ?? 'vol') + '#' + (++volSerial) : '';
    flags = { loading: false, ready: false, targetLoaded: 0, targetTotal: 0 };
    if (!v) { invalidate(); return; }
    const ext = extentNm(v);
    cam.center = ext.map((e, i) => snapSlice(v, i, e / 2));
    relayout();
    fit(false);
  }
  let volSerial = 0;

  function setPlane(p) {
    if (!PLANES[p] || p === plane) return;
    stopAnims();
    const zoom = vol ? nmPerPxToZoom(vol, plane, cam.nmPerPx) : 1;
    plane = p;
    if (vol) cam.nmPerPx = zoomToNmPerPx(vol, plane, zoom);
    relayout(); invalidate();
  }
  function setLayout(l) { layout = l === 'three' ? 'three' : 'single'; relayout(); invalidate(); }
  function setSlice(nm) { if (!vol) return; const n = PLANES[plane].n; cam.center[n] = snapSlice(vol, n, +nm); invalidate(); }

  function targetCam(tg) {
    const p = tg.plane && PLANES[tg.plane] ? tg.plane : plane;
    const r0 = vol.scales[0].resolution;
    const nm = tg.units === 'nm';
    const c = cam.center.slice();
    ['x', 'y', 'z'].forEach((k, i) => { if (tg[k] != null && isFinite(tg[k])) c[i] = nm ? +tg[k] : (+tg[k] + 0.5) * r0[i]; });
    const npp = tg.zoom > 0 ? zoomToNmPerPx(vol, p, tg.zoom) : cam.nmPerPx;
    return { plane: p, center: c, nmPerPx: npp };
  }

  function goTo(tg = {}) {
    if (!vol) return;
    const tc = targetCam(tg);
    if (tc.plane !== plane) setPlane(tc.plane);
    stopAnims();
    if (tg.animate) { flyTo(tg, { ms: tg.ms }); return; }
    cam.center = tc.center; cam.nmPerPx = tc.nmPerPx;
    clampCamera(cam, vol, limits());
    invalidate();
  }

  function flyTo(tg, o = {}) {
    if (!vol) return Promise.resolve(false);
    const tc = targetCam(tg);
    if (tc.plane !== plane) setPlane(tc.plane);
    stopAnims();
    const a = PLANES[plane], vw = views[0];
    const width = vw.vp.w;
    const path = zoomPath([cam.center[a.u], cam.center[a.v], width * cam.nmPerPx], [tc.center[a.u], tc.center[a.v], width * tc.nmPerPx]);
    const ms = o.ms ?? Math.min(7000, Math.max(1400, path.S * 1100));
    return new Promise(res => {
      fly = { path, width, n0: cam.center[a.n], n1: tc.center[a.n], t0: now(), ms, resolve: res };
      invalidate();
    });
  }

  function prefetch(tg) {
    if (!vol) return;
    const tc = targetCam(tg);
    const save = { center: cam.center.slice(), nmPerPx: cam.nmPerPx };
    cam.center = tc.center; cam.nmPerPx = tc.nmPerPx;
    const vw = { ...layoutViews(cssW, cssH, 'single', tc.plane, effInsets())[0] };
    const list = [];
    computeWants(vw, 0, list);
    cam.center = save.center; cam.nmPerPx = save.nmPerPx;
    // no band: the store never holds a prefetch tile (view/tiles.js "Bands")
    extra = list.filter(d => d.prio < 1000).map(d => ({ ...d, prio: d.prio + 3000, band: undefined }));
    invalidate();
  }

  function isReady(tg) {
    if (!vol) return 0;
    const tc = targetCam(tg);
    const vw = layoutViews(cssW, cssH, 'single', tc.plane, effInsets())[0];
    const c = { center: tc.center, nmPerPx: tc.nmPerPx };
    const L = chooseScale(vol.scales, tc.plane, tc.nmPerPx / dpr, lodBias, fine0For(vol, tc.plane));
    const idx = sliceIndex(vol.scales[L], tc.plane, tc.center[PLANES[tc.plane].n]);
    const tiles = visibleTiles(vw, c, vol.scales[L]);
    if (!tiles.length) return 1;
    let got = 0;
    for (const t of tiles) if (store.has(tileKey(volKey, L, tc.plane, idx, t.tu, t.tv))) got++;
    return got / tiles.length;
  }

  function state() {
    if (!vol) return { plane, layout, x: 0, y: 0, z: 0, zoom: 1, nm: [0, 0, 0], nmPerPx: cam.nmPerPx, scaleIndex: 0, scaleKey: '', slice: null,
      contrast: { ...contrast }, invert, cursor: null, scaleBar: scaleBar(cam.nmPerPx), loading: false, errors: 0, ready: false };
    const r0 = vol.scales[0].resolution, n = PLANES[plane].n;
    const si = targetScale(plane);
    let cursor = null;
    if (pointer) {
      const vw = viewAt(views, pointer.x, pointer.y);
      if (vw) {
        const p = screenToWorld(vw, cam, pointer.x, pointer.y), ext = extentNm(vol);
        if (p.every((q, i) => q >= 0 && q < ext[i])) cursor = { x: Math.floor(p[0] / r0[0]), y: Math.floor(p[1] / r0[1]), z: Math.floor(p[2] / r0[2]), nm: p };
      }
    }
    return {
      plane, layout,
      x: cam.center[0] / r0[0] - 0.5, y: cam.center[1] / r0[1] - 0.5, z: cam.center[2] / r0[2] - 0.5,
      zoom: nmPerPxToZoom(vol, plane, cam.nmPerPx), nm: cam.center.slice(), nmPerPx: cam.nmPerPx,
      scaleIndex: si, scaleKey: vol.scales[si].key,
      slice: { axis: AXIS[n], index: Math.floor(cam.center[n] / r0[n]), count: vol.scales[0].size[n] },
      contrast: { ...contrast }, invert, cursor, scaleBar: scaleBar(cam.nmPerPx, phone ? 96 : 120),
      loading: flags.loading, errors: store.errorCount, ready: flags.ready,
      tiles: { loaded: flags.targetLoaded, total: flags.targetTotal },
    };
  }

  function dispose() {
    disposed = true;
    if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    store.clear();
    R.dispose();
    canvas.removeEventListener('pointerdown', onPointer);
    canvas.removeEventListener('pointermove', onPointer);
    canvas.removeEventListener('pointerup', onPointer);
    canvas.removeEventListener('pointercancel', onPointer);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('webglcontextlost', onCtxLost);
    win.removeEventListener && win.removeEventListener('keydown', onKey);
    if (ro) ro.disconnect(); else win.removeEventListener && win.removeEventListener('resize', resize);
    if (ov) ov.dispose();
  }

  resize();

  return {
    setVolume, setPlane, setLayout, setSlice, goTo,
    setContrast(lo, hi, gamma = contrast.gamma) {
      const sc = (lo > 1.0001 || hi > 1.0001) ? 1 / 255 : 1;
      contrast = { lo: +lo * sc, hi: +hi * sc, gamma: Math.max(0.05, +gamma || 1) };
      autoPending = false;
      invalidate();
    },
    setInvert(b) { invert = !!b; invalidate(); },
    autoContrast: () => autoWindow(true),
    setInsets(i) { insets = { ...insets, ...i }; relayout(); invalidate(); },
    setMinimap(b) { showMinimap = !!b; relayout(); invalidate(); },
    fit: () => fit(true),
    state, resize, dispose, invalidate,
    get volume() { return vol; },
    saverShots: {
      flyTo, prefetch, isReady,
      setBand(b) { band = b ? { t: b.t || 0, b: b.b || 0 } : null; if (!b) extra = []; relayout(); invalidate(); },
    },
    _debug: { store, cam, extra: () => extra, views: () => views, computeWants: () => { const w = []; views.forEach((v, i) => computeWants(v, i, w)); return w; }, frame: t => frame(t ?? now()) },
  };
}

const PLANE_NAMES_BY_N = ['yz', 'xz', 'xy'];   // the plane whose normal is axis i

function fmtNm(nm) {
  if (nm < 1000) return (nm < 10 ? nm.toFixed(1) : Math.round(nm)) + ' nm';
  return (nm / 1000).toFixed(nm < 1e4 ? 2 : 1) + ' µm';
}
