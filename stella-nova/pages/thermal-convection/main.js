// ============================================================================
//  THERMAL CONVECTION  ·  main.js — app object, boot, frame loop (package UI)
// ----------------------------------------------------------------------------
//  Owns `app` (also window.TC). CONTRACT.md "UI" is the spec.
//
//  BOOT ORDER
//    1. app, the panel (ui.js) and the explainer (explainer.js). These
//       work without WebGPU.
//    2. adapter, device, canvas context.
//    3. sim/gpu.js createSim, then render/views.js createViews (import()).
//       A failure shows #nogpu and keeps the explainer.
//    4. saver.js (package SAVER) by import(), in try/catch:
//       installSaver({ app, canvas, layout: layoutRects, fitBlock, resize })
//       -> saver. It sets window.snSaver and binds #saverBtn and the S key
//       itself. main.js binds #dockSaver to saver.toggle() and shows both
//       buttons only when the saver loaded.
//
//  FRAME ORDER: saver.tick(dt) (true while the saver runs: then the
//  director has written app.rects, the slice and the block camera, and
//  main.js skips its own layout and camera), else the clear area of the
//  overlays and layoutRects and the block camera; views.set when the
//  display state changed; sim.step (when playing); views.render; submit;
//  the readouts (4 Hz).
//
//  app.prewarm(tff) runs the field for tff free-fall times at once (the
//  director asks for it before a shot that needs a developed flow).
//
//  DEVICE LOSS: a lost device (reason other than 'destroyed', which is
//  lib/gpu-guard.js release) drops sim and views and boots again with the
//  same params, up to 3 times.
//
//  URL: ?q=0|1|2 quality, ?preset=<id>, ?seed=<int>, ?view=<id>.
//
//  grep -n targets: "── APP", "── METHODS", "── SIZE", "── INPUT",
//    "── LOOP", "── BOOT", "── LOSS", "── SAVER"
// ============================================================================
import { DEFAULTS, PRESETS, clampParams, GRIDS } from './sim/params.js';
import { PALETTES, ramp } from './render/palettes.js';
import { layoutRects, sliceSegment, wrapOffset } from './render/layout.js';
import { orbitCam, fitBlock, refitCam } from './render/orbit.js';
import {
  createUI, pickQuality, parseQuery, backingSize, presetParts, presetIds, occlusionOf, sliceThrough, VIEWS,
} from './ui.js';
import { renderExplainer } from './explainer.js';
import { typeset, typesetAll } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const query = parseQuery(location.search);
const clone = o => JSON.parse(JSON.stringify(o));

// ── APP ─────────────────────────────────────────────────────────────────
const app = {
  sim: null, views: null, device: null, dims: null,
  params: clampParams(clone(DEFAULTS)),
  preset: null, view: query.view || 'split', palette: 'solar', gain: 1, bias: 0.5,
  slice: { angle: 0, offset: 0 }, surfaceZ: 0.94, zScale: 1.5,
  toggles: { tracers: true, isotherms: true, arrows: false, relief: true },
  playing: true, quality: 2, seed: query.seed ?? 1, rects: {}, clear: { t: 0, b: 0, l: 0, r: 0 },
  cam: null, stats: null, ok: false, failed: null, saver: false, saverObj: null,
};
window.TC = app;

const ui = createUI(app, document);
app.ui = ui;
let viewsDirty = true;

// ── METHODS (the saver director calls these too) ─────────────────────────
app.set = function set(partial) {
  const p = { ...app.params, ...partial };
  if (partial.burner) p.burner = { ...app.params.burner, ...partial.burner };
  app.params = clampParams(p);
  if (!('preset' in (partial || {}))) app.preset = matchPreset();
  if (app.sim) app.sim.set(app.params);
  ui.sync();
};

// Apply a named preset: its params (from DEFAULTS), palette and view.
// opts.reset restarts the field (the onset preset always does).
app.applyPreset = function applyPreset(id, opts = {}) {
  const pp = presetParts(PRESETS, DEFAULTS, id);
  if (!pp) return false;
  app.params = clampParams(clone(pp.params));
  app.preset = id;
  if (pp.palette && paletteIds().includes(pp.palette)) app.palette = pp.palette;
  if (pp.view && !opts.keepView) app.view = pp.view;
  if (app.sim) {
    app.sim.set(app.params);
    if (opts.reset || pp.fromRest) app.sim.reset(opts.seed ?? app.seed);
  }
  viewsDirty = true;
  ui.sync();
  return true;
};

app.setView = function setView(v) {
  if (!VIEWS.some(x => x.id === v)) return;
  app.view = v; viewsDirty = true; ui.sync();
};

// s: { angle?, offset? }. angle in radians about z, offset in box units.
app.setSlice = function setSlice(s) {
  const a = Number.isFinite(s.angle) ? s.angle : app.slice.angle;
  const o = Number.isFinite(s.offset) ? s.offset : app.slice.offset;
  const d = boxDims();
  app.slice = { angle: a, offset: wrapOffset(a, o, d.Lx, d.Ly) }; viewsDirty = true; ui.syncSlice();
};

app.setPalette = function setPalette(id) {
  if (!paletteIds().includes(id)) return;
  app.palette = id; viewsDirty = true; drawLegend(); ui.sync();
};

// d: { gain?, bias?, zScale?, surfaceZ? }
app.setDisplay = function setDisplay(d) {
  for (const k of ['gain', 'bias', 'zScale', 'surfaceZ']) if (Number.isFinite(d[k])) app[k] = d[k];
  app.zScale = Math.min(2.5, Math.max(1, app.zScale));
  app.surfaceZ = Math.min(1, Math.max(0.5, app.surfaceZ));
  viewsDirty = true; ui.sync();
};

app.setToggle = function setToggle(k, on) {
  if (!(k in app.toggles)) return;
  app.toggles[k] = !!on;
  if (k === 'tracers' && app.sim) app.sim.setTracers(on ? tracerCount() : 0);
  viewsDirty = true; ui.sync();
};

app.setPlaying = function setPlaying(on) { app.playing = !!on; ui.sync(); };

// Restart from the conduction profile. No seed: the next seed, so a reset
// gives a new pattern.
app.reset = function reset(seed) {
  app.seed = Number.isFinite(seed) ? seed : (app.seed + 1) >>> 0;
  if (app.sim) app.sim.reset(app.seed);
  app.stats = null; ui.setStats(null);
};

app.setCam = function setCam(c) { app.cam = { ...(app.cam || {}), ...c }; };

// Run the field for tff free-fall times now (saver warm starts). Uses
// sim.prewarm when SIM has it; else encodes steps of 1/20 s until sim.time
// has moved tff, at most 240 steps.
app.prewarm = function prewarm(tff) {
  const sim = app.sim, dev = app.device;
  if (!sim || !dev || !(tff > 0)) return;
  if (typeof sim.prewarm === 'function') { sim.prewarm(tff); return; }
  const t0 = Number.isFinite(sim.time) ? sim.time : 0;
  for (let n = 0; n < 240; n++) {
    if (Number.isFinite(sim.time) && sim.time - t0 >= tff) break;
    const enc = dev.createCommandEncoder();
    sim.step(enc, 1 / 20);
    dev.queue.submit([enc.finish()]);
  }
};

function boxDims() { return app.dims || { Lx: app.params.Lx || 4, Ly: app.params.Ly || 4 }; }
function paletteIds() { return paletteList().map(p => p.id); }
function paletteList() {
  const src = Array.isArray(PALETTES) ? PALETTES : Object.values(PALETTES || {});
  return src.filter(p => p && p.id);
}
// The sim's own default tracer count (sim.tracerCount at boot), else the
// contract default: 6000 on a phone, 20000 elsewhere.
let defaultTracers = 0;
function tracerCount() { return defaultTracers || (app.quality === 0 ? 6000 : 20000); }

// The preset whose params equal the current ones, else null ("Custom").
function matchPreset() {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const id of presetIds(PRESETS)) {
    const pp = presetParts(PRESETS, DEFAULTS, id);
    if (pp && same(clampParams(clone(pp.params)), app.params)) return id;
  }
  return null;
}

function viewState() {
  return {
    palette: app.palette, gain: app.gain, bias: app.bias, slice: { ...app.slice },
    surfaceZ: app.surfaceZ, zScale: app.zScale, tracers: app.toggles.tracers,
    arrows: !!app.toggles.arrows, isotherms: !!app.toggles.isotherms,
    relief: typeof app.toggles.relief === 'number' ? app.toggles.relief : (app.toggles.relief ? 0.7 : 0),
  };
}

// ── SIZE ────────────────────────────────────────────────────────────────
let cssW = 1, cssH = 1, dprUsed = 1;
function resize() {
  cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
  cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
  const b = backingSize(cssW, cssH, window.devicePixelRatio || 1);
  if (canvas.width !== b.pw || canvas.height !== b.ph) { canvas.width = b.pw; canvas.height = b.ph; }
  dprUsed = b.pw / cssW;
}
window.addEventListener('resize', resize);
resize();

function drawLegend() {
  const c = $('lgBar'), g = c.getContext && c.getContext('2d');
  if (!g) return;
  const n = c.width;
  for (let i = 0; i < n; i++) {
    let rgb = [i / n, i / n, i / n];
    try { rgb = ramp(app.palette, i / (n - 1)); } catch { /* palette missing */ }
    g.fillStyle = `rgb(${rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;
    g.fillRect(i, 0, 1, c.height);
  }
}

function layoutOpts() {
  const d = boxDims();
  return { side: false, Lx: d.Lx, Ly: d.Ly, cutLen: sliceSegment(app.slice, d.Lx, d.Ly).len, zScale: app.zScale };
}

// The clear area of the overlays (panel, physics, dock, status, topbar),
// then the rects (layoutRects pads 12 px inside it).
function computeRects() {
  app.clear = occlusionOf(ui.overlayBoxes(), cssW, cssH);
  app.rects = layoutRects(cssW, cssH, app.view, app.clear, layoutOpts()) || {};
}

function labelText() {
  const z = app.zScale > 1.001 ? ` <span class="d">· height ×${app.zScale.toFixed(2)}</span>` : '';
  return {
    surface: `Surface <span class="d">· z = ${app.surfaceZ.toFixed(2)}</span>`,
    slice: `Cross-section under the cut${z}`,
    block: 'Cutaway block',
  };
}

// ── INPUT ───────────────────────────────────────────────────────────────
// Drag on the surface draws a new cut (a tap moves the cut through the
// point). Drag on the block turns it; a wheel or a pinch zooms it.
const inRect = (r, x, y) => r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
const ptrs = new Map();
let drag = null;
function local(e) { const q = canvas.getBoundingClientRect(); return { x: e.clientX - q.left, y: e.clientY - q.top }; }

canvas.addEventListener('pointerdown', e => {
  if (!app.views) return;
  const p = local(e);
  ptrs.set(e.pointerId, p);
  try { canvas.setPointerCapture(e.pointerId); } catch { /* old browser */ }
  $('hint').classList.add('gone');
  if (ptrs.size === 2 && drag && drag.kind === 'orbit') {
    const [a, b] = [...ptrs.values()];
    drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, dist0: (app.cam && app.cam.dist) || 3 };
    return;
  }
  if (inRect(app.rects.surface, p.x, p.y)) {
    drag = { kind: 'cut', p0: app.views.pickSurface(p.x, p.y, app.rects), s0: { x: p.x, y: p.y }, moved: false };
  } else if (inRect(app.rects.block, p.x, p.y)) {
    drag = { kind: 'orbit', x: p.x, y: p.y };
  } else drag = null;
});
canvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !drag) return;
  const p = local(e);
  ptrs.set(e.pointerId, p);
  if (drag.kind === 'cut' && drag.p0) {
    if (Math.hypot(p.x - drag.s0.x, p.y - drag.s0.y) < 6) return;
    const p1 = app.views.pickSurface(p.x, p.y, app.rects);
    if (!p1) return;
    drag.moved = true;
    const s = app.views.sliceFromDrag(drag.p0, p1);
    if (s) app.setSlice(s);
  } else if (drag.kind === 'orbit' && app.cam) {
    const dx = p.x - drag.x, dy = p.y - drag.y; drag.x = p.x; drag.y = p.y;
    app.cam.yaw = (app.cam.yaw || 0) - dx * 0.008;
    app.cam.pitch = Math.min(1.45, Math.max(0.05, (app.cam.pitch || 0.5) + dy * 0.006));
  } else if (drag.kind === 'pinch' && app.cam && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    app.cam.dist = Math.min(drag.dist0 * 3, Math.max(drag.dist0 / 3, drag.dist0 * drag.d0 / d));
  }
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (drag && drag.kind === 'cut' && !drag.moved && drag.p0 && e.type === 'pointerup') {
    const d = boxDims();
    app.setSlice(sliceThrough(drag.p0, app.slice.angle, d.Lx, d.Ly));
  }
  if (!ptrs.size) drag = null;
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => {
  if (!app.cam || !inRect(app.rects.block, ...Object.values(local(e)))) return;
  e.preventDefault();
  app.cam.dist = Math.min(20, Math.max(0.5, (app.cam.dist || 3) * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
  if (app.saver || document.documentElement.classList.contains('sn-saver')) return;
  if (e.key === ' ') { e.preventDefault(); app.setPlaying(!app.playing); }
  else if (e.key === 'r' || e.key === 'R') app.reset();
  else if (e.key === 'v' || e.key === 'V') { const ids = VIEWS.map(v => v.id); app.setView(ids[(ids.indexOf(app.view) + 1) % ids.length]); }
});

// ── LOOP ────────────────────────────────────────────────────────────────
let ctx = null, format = null, raf = 0, last = 0, statsAt = 0, frameErrors = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 1 / 60;
  last = now;
  if (!app.sim || !app.views || !ctx) return;
  try {
    const saving = !!(app.saverObj && app.saverObj.tick(dt));
    if (!saving) {
      computeRects();
      ui.placeLabels(app.rects, labelText());
    }
    if (viewsDirty) { app.views.set(viewState()); viewsDirty = false; }
    if (!saving && app.rects.block) {
      const r = app.rects.block, aspect = r.w / Math.max(1, r.h);
      // fit again when the vertical scale or the rect aspect changes (a phone
      // turned, the slider moved); refitCam keeps the user's zoom
      app.cam = refitCam(app.cam, { ...boxDims(), Lz: app.zScale }, aspect);
      app.cam.aspect = aspect;
      app.views.set({ cam: orbitCam(app.cam) });
    }
    const enc = app.device.createCommandEncoder();
    if (app.playing) app.sim.step(enc, dt);
    app.views.render(enc, ctx.getCurrentTexture().createView(), { w: cssW, h: cssH, dpr: dprUsed, pw: canvas.width, ph: canvas.height }, app.rects);
    app.device.queue.submit([enc.finish()]);
    if (now - statsAt > 250) {
      statsAt = now;
      const s = app.sim.stats();
      if (s) { app.stats = s; ui.setStats(s); }
    }
    frameErrors = 0;
  } catch (err) {
    if (++frameErrors === 1) console.error('thermal-convection: frame failed', err);
    if (frameErrors === 30) { ui.toast('The simulation stopped with an error. Reload the page to try again.', 8000); cancelAnimationFrame(raf); }
  }
}

// ── BOOT ────────────────────────────────────────────────────────────────
function setupStatic() {
  const pals = paletteList().map(p => ({ id: p.id, name: p.name || p.id, css: gradientCSS(p) }));
  ui.setPalettes(pals);
  ui.setPresets(presetIds(PRESETS).map(id => presetParts(PRESETS, DEFAULTS, id)).filter(Boolean));
  const start = query.preset && presetParts(PRESETS, DEFAULTS, query.preset) ? query.preset
    : presetParts(PRESETS, DEFAULTS, 'granulation') ? 'granulation' : null;
  // The start look is the granulation preset, but in the split view: the
  // surface and the section under the cut together (CONTRACT.md "UI").
  // A ?preset= link gets the view of that preset, unless ?view= is set.
  if (start) app.applyPreset(start, { keepView: !query.preset || !!query.view });
  if (query.view) app.view = query.view;
  ui.sync();
  drawLegend();
  renderExplainer({ eqRoot: $('eqList'), keyRoot: $('eqKey'), exRoot: $('explainer'), typeset });
  typesetAll(document.querySelector('#panel'));
}

function gradientCSS(p) {
  const stops = (p.stops || []).map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`);
  return stops.length > 1 ? `linear-gradient(90deg, ${stops.join(', ')})` : '#888';
}

app.quality = pickQuality({
  w: screen.width || window.innerWidth, h: screen.height || window.innerHeight,
  coarse: !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches),
  cores: navigator.hardwareConcurrency || 4, q: query.q,
});

let bootTries = 0;
async function boot() {
  app.ok = false;
  if (!navigator.gpu) throw new Error('navigator.gpu is missing');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  app.device = device;
  device.lost.then(info => onLost(device, info));
  ctx = ctx || canvas.getContext('webgpu');
  if (!ctx) throw new Error('no webgpu canvas context');
  format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });

  const { createSim } = await import('./sim/gpu.js');
  const grid = GRIDS && GRIDS[app.quality];
  const sim = await createSim(device, { quality: app.quality, seed: app.seed });
  if (app.device !== device) { sim.destroy && sim.destroy(); return; }
  sim.set(app.params);
  if (!defaultTracers && Number.isFinite(sim.tracerCount) && sim.tracerCount > 0) defaultTracers = sim.tracerCount;
  sim.setTracers(app.toggles.tracers ? tracerCount() : 0);
  app.sim = sim;
  app.dims = sim.dims || (grid && { nx: grid[0], ny: grid[1], nz: grid[2], Lx: app.params.Lx, Ly: app.params.Ly });

  const { createViews } = await import('./render/views.js');
  const views = await createViews(device, format, sim, {});
  if (app.device !== device) { views.destroy && views.destroy(); return; }
  app.views = views;
  viewsDirty = true;
  app.ok = true; app.failed = null;
  ui.sync();
  if (!raf) raf = requestAnimationFrame(frame);
}

// ── LOSS ────────────────────────────────────────────────────────────────
function teardown() {
  try { app.views && app.views.destroy && app.views.destroy(); } catch { /* lost */ }
  try { app.sim && app.sim.destroy && app.sim.destroy(); } catch { /* lost */ }
  app.views = null; app.sim = null; app.ok = false;
}
function onLost(device, info) {
  if (app.device !== device) return;
  teardown();
  app.device = null;
  if (info && info.reason === 'destroyed') return;
  if (++bootTries > 3) { ui.toast('The GPU was lost again. Reload the page to restart.', 8000); return; }
  ui.toast('The GPU was reset. Restarting the simulation…');
  setTimeout(() => boot().catch(fail), 600);
}
function fail(err) {
  app.failed = String(err && err.message || err);
  console.warn('thermal-convection: WebGPU boot failed', err);
  teardown();
  ui.showNoGPU();
}

// ── SAVER ───────────────────────────────────────────────────────────────
async function loadSaver() {
  try {
    const m = await import('./saver.js');
    if (!m || typeof m.installSaver !== 'function') return;
    const saver = m.installSaver({ app, canvas, layout: layoutRects, fitBlock, resize });
    app.saverObj = saver;
    app.saverToggle = () => saver.toggle();
    $('saverBtn').hidden = false;
    $('dockSaver').hidden = false;
  } catch (err) { console.warn('thermal-convection: saver.js did not load', err); }
}

setupStatic();
boot().then(() => app.ok && loadSaver(), fail);
