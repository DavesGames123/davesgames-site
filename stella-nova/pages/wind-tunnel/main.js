// ============================================================================
//  WIND TUNNEL  ·  main script  (ES module, WebGPU)
// ----------------------------------------------------------------------------
//  This script owns the GPU device, one engine at a time (engine2d.js or
//  engine3d.js), the controls, the gestures and the readouts. The engines
//  hold no DOM. shapes.js is the object catalog.
//
//  UNITS. The solver runs at a fixed lattice speed U_LAT (cells per step).
//  The speed slider and the fluid set the real Reynolds number
//      Re = V * L / nu        (L from shapes.js, nu from FLUIDS)
//  and the solver gets the viscosity that gives that Re on the grid:
//      nu_lat = U_LAT * L_cells / Re,   tau = 0.5 + 3 nu_lat  (>= TAU_MIN)
//  At TAU_MIN the grid holds no more; the Smagorinsky model in the solver
//  takes the rest. "Re (grid)" in the readout is U_LAT L_cells / nu_lat.
//
//  STREAKS. A streak is K trail points TRAIL_SPACING cells apart (engines),
//  so its length does not depend on the step rate: 64 x 3 = 192 cells in
//  2D, 48 x 2 = 96 cells in 3D.
//
//  STEPS. Each frame runs `steps` lattice steps. A governor moves `steps`
//  so that the GPU time of the whole frame stays near BUDGET_MS. It acts on
//  the total time, not on a time per step: the render passes cost a fixed
//  2 to 4 ms, and a per-step figure that included them stopped the 3D
//  tunnel at 4 to 5 steps of a possible 10 or more. The rate slider scales
//  it down. Particles move the distance the fluid moves in those
//  steps, so the streaks keep pace with the flow at any rate.
//
//  FRAMING. The panel, the dock, the card and the bars cover parts of the
//  canvas. occlusion() measures them each frame. The 2D view fits the grid
//  into the clear part. The 3D camera shifts its projection center to the
//  middle of the clear part and moves back when the clear part is narrow.
//
//  GREP MAP
//    grep -n 'function boot'          device, limits, tiers, canvas
//    grep -n 'function makeEngine'    engine build for the mode and the tier
//    grep -n 'function applyShape'    packShape -> engine.setShape
//    grep -n 'function applyFlow'     speed, fluid, Re -> tau
//    grep -n 'function frame'         render loop and step governor
//    grep -n 'function view2d'        2D fit, pan and zoom
//    grep -n 'function camera3d'      3D orbit camera and rake
//    grep -n 'function occlusion'     overlay margins
//    grep -n 'function readForces'    Cd, Cl, real force, trace
//    grep -n 'function drawLegend'    colorbar per field
//    grep -n 'function buildUI'       panel, dock, sheet
//    grep -n 'function bindGestures'  drag, pinch, wheel, double tap
//    grep -n 'window.snSaver'         screensaver hook and autopilot
//    grep -n 'function saverPlate'    screensaver label plate
// ============================================================================

import { SHAPES, COMMON, FLUIDS, defaults, commonDefaults, packShape } from './shapes.js';
import { createEngine2D } from './engine2d.js';
import { createEngine3D } from './engine3d.js';

const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = window.matchMedia('(pointer:coarse)').matches;
const U_LAT = 0.08;
const TAU_MIN = 0.505;
const BUDGET_MS = COARSE ? 11 : 13;
// Step cap per mode. A 2D step costs about 0.05 ms at the default grid, a
// 3D step about 0.7 ms (Apple M4 Pro), so the 2D cap is much higher.
const MAX_STEPS = { '2d': 240, '3d': 64 };
const RHO = { air: 1.2, water: 1000, oil: 910, honey: 1420 };
const FIELDS = ['Speed', 'Vorticity', 'Pressure', 'Smoke', 'Plain'];
// Grid tiers. 2D: columns (rows follow the canvas aspect). 3D: nx, ny, nz.
const TIERS = {
  '2d': [512, 768, 1024],
  '3d': [[128, 48, 64], [160, 64, 80], [208, 80, 104]],
};

// Object icons for the panel grid, 30 x 20 outlines.
const ICONS = {
  cow: 'M5 8h15q4 0 5 3l2 1-1 2-3-1v5M20 13v5M9 13v5M6 13v5M5 8q-2 0-2 3 1 2 2 2M9 13h11',
  car: 'M2 15v-3q1-2 5-2l4-4h8l5 4q4 0 4 3v2zM7 15a2 2 0 1 0 0.1 0M22 15a2 2 0 1 0 0.1 0',
  truck: 'M2 16V5h6v11zM10 16V3h18v13zM5 18a1.5 1.5 0 1 0 0.1 0M24 18a1.5 1.5 0 1 0 0.1 0',
  airfoil: 'M2 10q4-5 12-4 10 1 14 4-10 2-16 2-8 0-10-2z',
  cylinder: 'M15 3a7 7 0 1 0 0.1 0',
  sphere: 'M15 3a7 7 0 1 0 0.1 0M9 8q3-3 6-2',
  box: 'M8 4h14v12H8z',
  plate: 'M4 14L26 6',
};

const G = {
  mode: '3d',
  shape: 'cow',
  params: {},
  common: {},
  fluid: 'air',
  speedT: 0.0,
  turb: 0.5,
  ground: 'fixed',
  field: 0,
  view2d: 'side',
  slice: 3,
  slicePos: 0.5,
  surface: 0,
  streaks: 'rake',
  density: 0.25,  // streaks are long (STREAKS above), so fewer of them
  contrast: 1,
  tier: COARSE ? 0 : 1,
  rate: 1,
  paused: false,
};
for (const k of Object.keys(SHAPES)) { G.params[k] = defaults(k); G.common[k] = commonDefaults(k); }
// The page opens on the spherical cow. The Holstein preset gives the
// plain cow back.
Object.assign(G.params.cow, SHAPES.cow.presets['Spherical cow']);

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
let device = null, ctx = null, format = 'bgra8unorm', code = null, limits = null;
let engine = null, building = 0, pk = null, flowInfo = null;
let steps = 6, gpuMs = 0, gpuPending = false, lastT = 0, fps = 60;
let shapeDirty = false, flowDirty = false;
const view = { zoom: 1, pan: [0, 0] };
// A tall screen looks more head-on, so the wake runs into the depth.
const tall = () => canvas.clientHeight > canvas.clientWidth * 1.2;
const orbit = { yaw: -0.69, pitch: 0.3, dist: 1, panY: 0 };
function orbitHome() { orbit.yaw = tall() ? -1.1 : -0.69; orbit.pitch = tall() ? 0.34 : 0.3; orbit.dist = 1; orbit.panY = 0; }
let dpr = 1, W = 1, H = 1;

// ------------------------------------------------------------- formatting
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sci(x) {
  if (!isFinite(x)) return '—';
  if (x < 1000) return x.toFixed(x < 10 ? 1 : 0);
  const e = Math.floor(Math.log10(x));
  return (x / 10 ** e).toFixed(1) + '×10' + String(e).split('').map((c) => SUP[c]).join('');
}
function newtons(f, per) {
  const a = Math.abs(f);
  const s = a >= 1e6 ? (f / 1e6).toFixed(2) + ' MN' : a >= 1e3 ? (f / 1e3).toFixed(2) + ' kN' : a >= 1 ? f.toFixed(1) + ' N' : (f * 1e3).toFixed(1) + ' mN';
  return per ? s + '/m' : s;
}
function speedKmh() { return 10 ** (-2 + G.speedT * (Math.log10(300) + 2)); }
function speedT(kmh) { return (Math.log10(kmh) + 2) / (Math.log10(300) + 2); }
function fmtKmh(v) { return v >= 10 ? v.toFixed(0) + ' km/h' : v >= 1 ? v.toFixed(1) + ' km/h' : v.toFixed(v >= 0.1 ? 2 : 3) + ' km/h'; }

function showMsg(html, reload) {
  const m = $('msg');
  m.innerHTML = html + (reload ? '<br><button id="reloadBtn">Reload</button>' : '');
  m.hidden = false;
  if (reload) $('reloadBtn').addEventListener('click', () => location.reload());
}

// ------------------------------------------------------------- boot
async function boot() {
  buildUI();
  bindGestures();
  orbitHome();
  if (!navigator.gpu) {
    showMsg('This page needs WebGPU.<br>Use Safari 26 or later, Chrome or Edge 113 or later, or Firefox 141 or later.');
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no adapter');
    const want = Math.min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize);
    device = await adapter.requestDevice({
      requiredLimits: { maxStorageBufferBindingSize: want, maxBufferSize: adapter.limits.maxBufferSize },
    });
    limits = device.limits;
    device.lost.then((info) => {
      if (info.reason !== 'destroyed') showMsg('The GPU device was lost (' + (info.message || info.reason) + ').', true);
    });
    device.addEventListener('uncapturederror', (e) => console.error('[wind-tunnel] GPU error:', e.error.message));
    format = navigator.gpu.getPreferredCanvasFormat();
    ctx = canvas.getContext('webgpu');
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const names = ['sdf', 'lbm2d', 'view2d', 'lbm3d', 'view3d'];
    const src = await Promise.all(names.map(async (n) => {
      const r = await fetch(new URL(`shaders/${n}.wgsl`, import.meta.url));
      if (!r.ok) throw new Error(`shader fetch failed (${r.status}): ${n}.wgsl`);
      return r.text();
    }));
    code = Object.fromEntries(names.map((n, i) => [n, src[i]]));
  } catch (err) {
    showMsg('WebGPU did not start: ' + err.message);
    return;
  }
  // Drop the tiers that the device cannot hold.
  const maxB = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  [...$('tierSeg').children].forEach((b, i) => {
    const [nx, ny, nz] = TIERS['3d'][i];
    const fits = 19 * nx * ny * nz * 4 <= maxB;
    if (!fits) b.disabled = true;
    if (!fits && G.tier >= i) G.tier = Math.max(0, i - 1);
  });
  syncUI();
  await makeEngine();
  addEventListener('pagehide', () => { try { engine && engine.destroy(); device && device.destroy(); } catch (e) {} });
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------- engines
function resize() {
  const cap = G.mode === '2d' ? 2 : (COARSE ? 1.25 : 1.5);
  dpr = Math.min(window.devicePixelRatio || 1, cap);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
  W = w; H = h;
}

function dims2d() {
  const nx = TIERS['2d'][G.tier];
  const a = canvas.clientHeight / Math.max(1, canvas.clientWidth);
  const ny = Math.round(nx * Math.min(1.0, Math.max(0.34, a * 0.8)) / 8) * 8;
  return [nx, ny];
}

async function makeEngine() {
  const token = ++building;
  if (engine) { engine.destroy(); engine = null; }
  $('stMain').textContent = 'building the grid…';
  resize();
  const phone = COARSE;
  let e;
  try {
    if (G.mode === '2d') {
      const [nx, ny] = dims2d();
      e = await createEngine2D(device, code, { format, nx, ny, maxParticles: phone ? 8000 : 16000, K: 64 });
    } else {
      const [nx, ny, nz] = TIERS['3d'][G.tier];
      e = await createEngine3D(device, code, { format, nx, ny, nz, maxParticles: phone ? 6000 : 12000, K: 48 });
    }
  } catch (err) {
    showMsg('The solver did not build: ' + err.message);
    return;
  }
  if (token !== building) { e.destroy(); return; }
  engine = e;
  steps = G.mode === '2d' ? 10 : 4;
  applyShape();
  applyFlow();
  engine.reset();
  resetTrace();
  building = 0;
  drawLegend();
}

function domain() {
  const e = engine;
  return {
    nx: e.nx, ny: e.ny, nz: e.nz || 1, mode: G.mode,
    view: G.view2d,
    ground: G.mode === '2d' && G.view2d === 'top' ? 'none' : G.ground,
  };
}

function applyShape() {
  if (!engine) return;
  pk = packShape(G.shape, G.params[G.shape], G.common[G.shape], domain());
  engine.setShape(pk.buf);
  flowDirty = true;
}

function applyFlow() {
  if (!engine || !pk) return;
  const s = SHAPES[G.shape];
  const V = speedKmh() / 3.6;
  const nu = FLUIDS[G.fluid].nu;
  const Re = V * pk.realLen / nu;
  const nuLat = U_LAT * pk.refCells / Re;
  const tau = Math.max(0.5 + 3 * nuLat, TAU_MIN);
  const ReGrid = U_LAT * pk.refCells / ((tau - 0.5) / 3);
  const d = domain();
  engine.setFlow({
    U: U_LAT, tau, noise: G.turb / 100,
    ground: { none: 0, fixed: 1, belt: 2 }[d.ground], beltU: U_LAT,
  });
  flowInfo = { Re, ReGrid, V, clamped: tau <= TAU_MIN + 1e-9, s };
  $('reHint').textContent = flowInfo.clamped
    ? `Re ${sci(Re)}. The grid resolves about Re ${sci(ReGrid)}; the eddy model stands in for the smaller eddies.`
    : `Re ${sci(Re)}, fully on the grid. Expect laminar flow and regular shedding.`;
}

// ------------------------------------------------------------- framing
const OVERLAYS = ['panel', 'dock', 'status', 'card'].map((id) => $(id)).concat([document.querySelector('.topbar')]);
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const el of OVERLAYS) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right);
    const y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.5) continue;
      if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
    } else {
      if (fh < 0.5) continue;
      if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
    }
  }
  return o;
}
const occ = { l: 0, r: 0, t: 0, b: 0 };

// 2D: cells to device pixels, origin at the lower left of the grid.
function view2d() {
  const o = occlusion(canvas.clientWidth, canvas.clientHeight);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.25;
  const cw = Math.max(40, canvas.clientWidth - occ.l - occ.r) * dpr;
  const ch = Math.max(40, canvas.clientHeight - occ.t - occ.b) * dpr;
  const fit = Math.min(cw / engine.nx, ch / engine.ny) * 0.98;
  const cellPx = fit * view.zoom;
  const ox = occ.l * dpr + (cw - engine.nx * cellPx) / 2 + view.pan[0] * dpr;
  const oy = occ.b * dpr + (ch - engine.ny * cellPx) / 2 + view.pan[1] * dpr;
  return { cellPx, offset: [ox, oy] };
}

function objectBox() {
  const s = SHAPES[G.shape];
  const c = G.common[G.shape];
  const sc = pk.scale;
  const cx = pk.origin[0] + s.center[0] * sc + (pk.copies - 1) * pk.spacing * 0.5;
  const top = G.mode === '2d' && G.view2d === 'top';
  const cy = top ? engine.ny * 0.5 : pk.origin[1] + (s.grounded && domain().ground !== 'none' ? s.fit[1] * 0.5 : s.center[1]) * sc;
  const h = (top ? 2 * s.halfZ : s.fit[1]) * sc * (1 + Math.abs(Math.sin(c.pitch * Math.PI / 180)));
  const w = Math.max(s.halfZ * sc, 3) * (1 + Math.abs(Math.sin(c.yaw * Math.PI / 180)) * s.fit[0] / Math.max(s.halfZ, 0.05) * 0.5);
  return { cx, cy, h, w, len: s.fit[0] * sc };
}

// 3D: orbit camera around the object, shifted into the clear part.
function camera3d() {
  const o = occlusion(canvas.clientWidth, canvas.clientHeight);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.25;
  const cwCss = canvas.clientWidth, chCss = canvas.clientHeight;
  const clearW = Math.max(40, cwCss - occ.l - occ.r), clearH = Math.max(40, chCss - occ.t - occ.b);
  const sx = ((occ.l + clearW / 2) - cwCss / 2) / (cwCss / 2);
  const sy = -((occ.t + clearH / 2) - chCss / 2) / (chCss / 2);
  const b = objectBox();
  const target = [b.cx + b.len * 0.35, Math.max(b.cy, 4) + orbit.panY, engine.nz / 2];
  // Fit the footprint of the object into the clear part. Seen from the
  // camera, the horizontal half-extent at distance d is d tan(fov/2) W/H of
  // the canvas, and the clear part is a fraction of it. yaw 0 looks from the
  // side (+z), so the length shows as cos(yaw).
  const tanV = Math.tan(0.75 / 2);
  const foot = Math.abs(Math.cos(orbit.yaw)) * b.len * 1.5 + Math.abs(Math.sin(orbit.yaw)) * b.w * 3.2;
  const footH = b.h * 1.3 + Math.abs(Math.sin(orbit.pitch)) * b.w * 2;
  const needW = foot / (2 * tanV * clearW / chCss) * 1.6;
  const needH = footH / (2 * tanV * clearH / chCss) * 1.6;
  const base = Math.max(needW, needH, b.len * 1.2);
  const dist = base * orbit.dist;
  const cp = Math.cos(orbit.pitch);
  const eye = [target[0] + dist * Math.sin(orbit.yaw) * cp, target[1] + dist * Math.sin(orbit.pitch), target[2] + dist * Math.cos(orbit.yaw) * cp];
  return { eye, target, fovY: 0.75, shift: [sx, sy] };
}

// ------------------------------------------------------------- frame
function frame(t) {
  requestAnimationFrame(frame);
  if (!engine || building) return;
  const dt = lastT ? t - lastT : 16.7;
  lastT = t;
  fps += (1000 / Math.max(dt, 1) - fps) * 0.05;
  if (SAVER) SAVER.tick(Math.min(dt, 50) / 1000);
  resize();
  if (shapeDirty) { shapeDirty = false; applyShape(); }
  if (flowDirty) { flowDirty = false; applyFlow(); }

  const n = G.paused ? 0 : Math.max(1, Math.round(steps * G.rate));
  const b = objectBox();
  const life = G.streaks === 'rake' ? (G.mode === '2d' ? 700 : 700) : (G.mode === '2d' ? 140 : 160);
  const mode = G.streaks === 'rake' ? 1 : 0;
  // Smoke is its own tracer, so the streaks stand down in that field.
  const smoke = G.mode === '2d' && G.field === 3;
  const count = G.streaks === 'off' || smoke ? 0 : Math.round(engine.maxParticles * G.density);
  const target = ctx.getCurrentTexture().createView();
  const t0 = performance.now();

  if (G.mode === '2d') {
    const v = view2d();
    const y0 = Math.max(1.5, b.cy - b.h * 0.9), y1 = Math.min(engine.ny - 1.5, b.cy + b.h * 0.9);
    engine.frame(target, {
      steps: n, canvas: [W, H], offset: v.offset, cellPx: v.cellPx, field: G.field,
      refL: pk.refCells, vortScale: 0.08 * G.contrast, presScale: 0.6 * G.contrast,
      lineW: Math.max(1.2, 1.1 * dpr), lineAlpha: G.field === 4 ? 0.9 : 0.45,
      particles: count, mode, life, rake: [2, Math.max(6, engine.nx * 0.1), y0, y1],
    });
  } else {
    const cam = camera3d();
    const nz = engine.nz;
    const y0 = 1.5, y1 = Math.min(engine.ny - 2, b.cy + b.h * 0.9);
    // A band around the centre plane: streaks pass over and beside the
    // object, and the near side stays in view.
    const zw = Math.min(nz / 2 - 2, b.w * 0.9 + 1.5);
    const sl = slicePosCells();
    engine.frame(target, {
      steps: n, canvas: [W, H], camera: cam,
      slice: [G.slice, sl, G.field === 3 ? 0 : G.field, G.field === 4 ? 0 : 0.82],
      surface: G.surface, refL: pk.refCells, ground: { none: 0, fixed: 1, belt: 2 }[G.ground],
      vortScale: 0.1 * G.contrast, presScale: 0.6 * G.contrast,
      lineW: Math.max(1.3, 1.2 * dpr), lineAlpha: G.slice < 3 && G.field !== 4 ? 0.4 : 0.62, whiteStreaks: G.slice < 3 && G.field !== 4,
      particles: count, mode, life,
      rakeA: [2, 8, Math.max(y0, b.cy - b.h * 0.9), y1], rakeB: [nz / 2 - zw, nz / 2 + zw],
      time: t / 1000, dim: SAVER ? 1 - SAVER.k : 0,
    });
  }

  // GPU time of this frame, for the governor. One probe at a time.
  if (!gpuPending && n > 0) {
    gpuPending = true;
    device.queue.onSubmittedWorkDone().then(() => {
      const ms = performance.now() - t0;
      gpuMs += (ms - gpuMs) * 0.2;
      gpuPending = false;
      const cap = MAX_STEPS[G.mode];
      if (gpuMs < BUDGET_MS * 0.85) steps = Math.min(cap, steps + Math.max(1, Math.round(steps * 0.1)));
      else if (gpuMs > BUDGET_MS * 1.3) steps = Math.max(1, Math.floor(steps * 0.85));
      else if (gpuMs > BUDGET_MS * 1.05) steps = Math.max(1, steps - 1);
    });
  }
  readForces();
}

// ------------------------------------------------------------- readouts
let lastStamp = -1, cdS = NaN, clS = NaN, readTick = 0, dragN = NaN;
const trace = [];
function resetTrace() { trace.length = 0; cdS = NaN; clS = NaN; dragN = NaN; lastStamp = -1; }

function readForces() {
  const st = engine.stats;
  if (st.stamp === lastStamp) return;
  lastStamp = st.stamp;
  const s = SHAPES[G.shape];
  const dimF = G.mode === '2d' ? 2 : 3;
  const q = 0.5 * U_LAT * U_LAT;
  let fx = 0, fy = 0, aSum = 0;
  const per = [];
  for (let k = 0; k < pk.copies; k++) {
    const A = s.ref === 'plan' ? pk.planCells : st.area[k];
    const ax = st.forces[k * dimF], ay = st.forces[k * dimF + 1];
    fx += ax; fy += ay; aSum += A;
    per.push(A > 0 ? ax / (q * A) : NaN);
  }
  if (!(aSum > 0)) return;
  const cd = fx / (q * aSum), cl = fy / (q * aSum);
  // Skip the start-up transient: one flow-through of the object length.
  if (engine.steps < pk.refCells / U_LAT * 0.6) return;
  cdS = isNaN(cdS) ? cd : cdS + (cd - cdS) * 0.04;
  clS = isNaN(clS) ? cl : clS + (cl - clS) * 0.04;
  trace.push(trace.length ? trace[trace.length - 1] + (cd - trace[trace.length - 1]) * 0.3 : cd);
  if (trace.length > 240) trace.shift();
  if (++readTick % 4) return;

  const lenScale = pk.realLen / pk.refCells;        // metres per cell
  const V = flowInfo.V, rho = RHO[G.fluid];
  const area2 = G.mode === '2d' ? aSum * lenScale : aSum * lenScale * lenScale;
  const F = cdS * 0.5 * rho * V * V * area2;
  dragN = F;
  $('cdV').textContent = cdS.toFixed(2);
  $('clV').textContent = clS.toFixed(2);
  $('reV').textContent = sci(flowInfo.Re);
  $('forceK').textContent = `Drag · real ${s.label.toLowerCase()} · ${fmtKmh(speedKmh())}`;
  $('forceV').textContent = newtons(F, G.mode === '2d');
  $('rdCd').textContent = cdS.toFixed(3);
  $('rdCl').textContent = clS.toFixed(3);
  $('rdCopies').textContent = pk.copies > 1 ? per.map((c) => c.toFixed(2)).join(' · ') : '—';
  $('rdRe').textContent = sci(flowInfo.Re);
  $('rdReG').textContent = sci(flowInfo.ReGrid);
  $('rdArea').textContent = G.mode === '2d' ? `${(aSum * lenScale).toFixed(2)} m (per m span)` : `${area2.toFixed(2)} m²`;
  $('rdLen').textContent = `${pk.realLen.toFixed(2)} m = ${pk.refCells.toFixed(0)} cells`;
  $('rdGrid').textContent = G.mode === '2d' ? `${engine.nx} × ${engine.ny}` : `${engine.nx} × ${engine.ny} × ${engine.nz}`;
  $('rdSteps').textContent = String(Math.round(steps * G.rate));
  $('rdT').textContent = engine.steps.toLocaleString();
  const mlups = engine.n * Math.round(steps * G.rate) * fps / 1e6;
  $('stMain').textContent = `${G.mode.toUpperCase()} · ${$('rdGrid').textContent} · ${G.paused ? 'paused' : Math.round(steps * G.rate) + ' steps/frame'}`;
  $('stRight').textContent = G.paused ? '' : `${mlups.toFixed(0)} M cell updates/s`;
  drawTrace();
}

function drawTrace() {
  const c = $('trace');
  const r = c.getBoundingClientRect();
  const d = Math.min(window.devicePixelRatio || 1, 2);
  if (c.width !== Math.round(r.width * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (trace.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const v of trace) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = Math.max((hi - lo) * 0.15, 0.05);
  lo -= pad; hi += pad;
  const X = (i) => i / (trace.length - 1) * c.width;
  const Y = (v) => c.height - (v - lo) / (hi - lo) * c.height;
  g.strokeStyle = 'rgba(138,155,176,0.35)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, Y(cdS)); g.lineTo(c.width, Y(cdS)); g.stroke();
  g.strokeStyle = '#5fd4e8';
  g.lineWidth = 1.4 * d;
  g.beginPath();
  trace.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
  g.stroke();
}

// Ramps, the same stops as view2d.wgsl / view3d.wgsl.
function ramp(stops, t) {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
  return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
}
const SPEED = [[0.02, 0.03, 0.08], [0.04, 0.22, 0.38], [0.10, 0.58, 0.66], [0.80, 0.90, 0.88], [1.0, 0.66, 0.24]];
const DIV = [[0.55, 0.80, 1.0], [0.12, 0.36, 0.78], [0.035, 0.04, 0.07], [0.82, 0.30, 0.14], [1.0, 0.86, 0.55]];
const VMAG = [[0.02, 0.03, 0.07], [0.20, 0.10, 0.45], [0.75, 0.22, 0.42], [1.0, 0.62, 0.30], [1.0, 0.95, 0.75]];
const STREAK = [[0.16, 0.30, 0.85], [0.20, 0.62, 0.95], [0.55, 0.92, 0.95], [0.98, 0.97, 0.90], [1.0, 0.62, 0.22]];

function drawLegend() {
  const lg = $('legend');
  const f = G.field;
  let stops = SPEED, lo = '0', mid = '0.75', hi = '1.5', title = 'speed / U';
  if (f === 1 && G.mode === '2d') { stops = DIV; const r = 1 / (0.08 * G.contrast); lo = (-r).toFixed(0); mid = '0'; hi = '+' + r.toFixed(0); title = 'vorticity ω L / U'; }
  if (f === 1 && G.mode === '3d') { stops = VMAG; const r = 1 / (0.1 * G.contrast); lo = '0'; mid = (r / 2).toFixed(0); hi = r.toFixed(0); title = '|vorticity| L / U'; }
  if (f === 2) { stops = DIV; const r = 1 / (0.6 * G.contrast); lo = (-r).toFixed(1); mid = '0'; hi = '+' + r.toFixed(1); title = 'pressure coefficient Cp'; }
  if (f === 3) { lg.classList.add('off'); return; }
  if (f === 4) { stops = STREAK; lo = '0'; mid = '0.95'; hi = '1.9'; title = 'streak speed / U'; if (G.streaks === 'off') { lg.classList.add('off'); return; } }
  lg.classList.remove('off');
  $('lgTitle').textContent = title;
  $('lgLo').textContent = lo; $('lgMid').textContent = mid; $('lgHi').textContent = hi;
  const c = $('lgBar'), g = c.getContext('2d');
  for (let x = 0; x < c.width; x++) {
    const [r, gg, b] = ramp(stops, x / (c.width - 1));
    g.fillStyle = `rgb(${r * 255 | 0},${gg * 255 | 0},${b * 255 | 0})`;
    g.fillRect(x, 0, 1, c.height);
  }
}

function slicePosCells() {
  const e = engine;
  if (G.slice === 2) return 1 + G.slicePos * (e.nz - 2);
  if (G.slice === 1) return 1 + G.slicePos * (e.ny - 2);
  return 1 + G.slicePos * (e.nx - 2);
}

// ------------------------------------------------------------- UI
function fmtVal(p, v) {
  const d = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : p.step >= 0.01 ? 2 : 3;
  return v.toFixed(d) + (p.unit || '');
}

function sliderRow(p, value, onInput, prefix) {
  const row = document.createElement('div');
  row.className = 'row';
  const id = prefix + p.k;
  row.innerHTML = `<label for="${id}">${p.label}</label><input type="range" id="${id}" min="${p.min}" max="${p.max}" step="${p.step}"><span class="val"></span>`;
  const inp = row.querySelector('input'), out = row.querySelector('.val');
  inp.value = value;
  out.textContent = fmtVal(p, +inp.value);
  inp.addEventListener('input', () => { out.textContent = fmtVal(p, +inp.value); onInput(+inp.value); });
  return row;
}

function buildShapeControls() {
  const s = SHAPES[G.shape];
  const box = $('shapeParams');
  box.innerHTML = '';
  for (const p of s.params) {
    box.appendChild(sliderRow(p, G.params[G.shape][p.k], (v) => { G.params[G.shape][p.k] = v; markPreset(); shapeDirty = true; }, 'p_'));
  }
  const pl = $('placeParams');
  pl.innerHTML = '';
  for (const p of COMMON) {
    pl.appendChild(sliderRow(p, G.common[G.shape][p.k], (v) => {
      G.common[G.shape][p.k] = v;
      shapeDirty = true;
    }, 'c_'));
  }
  const pr = $('presetRow');
  pr.innerHTML = '';
  for (const name of Object.keys(s.presets)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => {
      G.params[G.shape] = Object.assign(defaults(G.shape), s.presets[name]);
      buildShapeControls();
      shapeDirty = true;
    });
    pr.appendChild(b);
  }
  markPreset();
}

function markPreset() {
  const s = SHAPES[G.shape];
  const cur = G.params[G.shape];
  [...$('presetRow').children].forEach((b) => {
    const want = Object.assign(defaults(G.shape), s.presets[b.textContent]);
    b.classList.toggle('on', Object.keys(want).every((k) => Math.abs(want[k] - cur[k]) < 1e-6));
  });
}

function setShape(key) {
  G.shape = key;
  G.ground = SHAPES[key].ground;
  buildShapeControls();
  syncUI();
  if (engine) { applyShape(); applyFlow(); engine.reset(); resetTrace(); }
}

function segBind(id, get, set) {
  const seg = $(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.dataset.v === undefined) return;
    set(b.dataset.v);
    syncUI();
  });
  return () => [...seg.children].forEach((b) => b.classList.toggle('on', b.dataset.v === String(get())));
}

const syncers = [];
function syncUI() {
  document.body.classList.toggle('mode-2d', G.mode === '2d');
  document.body.classList.toggle('mode-3d', G.mode === '3d');
  syncers.forEach((f) => f());
  [...$('shapeGrid').children].forEach((b) => b.classList.toggle('on', b.dataset.v === G.shape));
  $('dockShape').textContent = SHAPES[G.shape].label;
  $('dockField').textContent = FIELDS[G.field];
  $('dockPlay').textContent = G.paused ? '▶' : '❚❚';
  $('dockPlay').setAttribute('aria-label', G.paused ? 'Play' : 'Pause');
  $('pauseBtn').textContent = G.paused ? 'Play' : 'Pause';
  $('pauseBtn').classList.toggle('on', G.paused);
  $('hint').textContent = G.mode === '2d'
    ? 'drag to pan · pinch or scroll to zoom · double-tap to reset'
    : 'drag to orbit · pinch or scroll to zoom · double-tap to reset';
  $('speed').value = G.speedT;
  $('speedV').textContent = fmtKmh(speedKmh());
  drawLegend();
}

function setMode(m) {
  if (m === G.mode) return;
  G.mode = m;
  if (G.field === 3 && m === '3d') G.field = 0;
  G.streaks = m === '2d' ? 'field' : 'rake';
  view.zoom = 1; view.pan = [0, 0];
  syncUI();
  if (device && code) makeEngine();
}

function buildUI() {
  G.speedT = speedT(50);

  // Object grid.
  const grid = $('shapeGrid');
  for (const [k, s] of Object.entries(SHAPES)) {
    const b = document.createElement('button');
    b.dataset.v = k;
    b.innerHTML = `<svg viewBox="0 0 30 20" aria-hidden="true"><path d="${ICONS[k]}"/></svg><span>${s.label}</span>`;
    b.addEventListener('click', () => setShape(k));
    grid.appendChild(b);
  }
  buildShapeControls();

  // Fluids.
  const fl = $('fluidSeg');
  for (const [k, f] of Object.entries(FLUIDS)) {
    const b = document.createElement('button');
    b.dataset.v = k;
    b.textContent = f.label;
    fl.appendChild(b);
  }
  syncers.push(segBind('fluidSeg', () => G.fluid, (v) => { G.fluid = v; flowDirty = true; }));
  syncers.push(segBind('modeSeg', () => G.mode, setMode));
  syncers.push(segBind('dockMode', () => G.mode, setMode));
  syncers.push(segBind('groundSeg', () => G.ground, (v) => { G.ground = v; shapeDirty = true; }));
  syncers.push(segBind('fieldSeg', () => G.field, (v) => { G.field = +v; }));
  syncers.push(segBind('viewSeg', () => G.view2d, (v) => {
    if (v === G.view2d) return;
    G.view2d = v;
    if (engine) { applyShape(); applyFlow(); engine.reset(); resetTrace(); }
  }));
  syncers.push(segBind('sliceSeg', () => G.slice, (v) => {
    G.slice = +v;
    if (engine && pk) {
      const b = objectBox();
      if (G.slice === 2) G.slicePos = 0.5;
      if (G.slice === 1) G.slicePos = Math.min(0.95, (b.cy - 1) / (engine.ny - 2));
      if (G.slice === 0) G.slicePos = Math.min(0.95, (b.cx + b.len * 0.8) / engine.nx);
      $('slicePos').value = G.slicePos;
      $('slicePosV').textContent = (G.slicePos * 100).toFixed(0) + '%';
    }
  }));
  syncers.push(segBind('surfSeg', () => G.surface, (v) => { G.surface = +v; }));
  syncers.push(segBind('streakSeg', () => G.streaks, (v) => { G.streaks = v; }));
  syncers.push(segBind('tierSeg', () => G.tier, (v) => {
    if (+v === G.tier) return;
    G.tier = +v;
    if (device && code) makeEngine();
  }));

  const range = (id, get, set, fmt) => {
    const inp = $(id), out = $(id + 'V');
    inp.value = get();
    const show = () => { out.textContent = fmt(+inp.value); };
    inp.addEventListener('input', () => { set(+inp.value); show(); });
    show();
  };
  range('speed', () => G.speedT, (v) => { G.speedT = v; flowDirty = true; }, () => fmtKmh(speedKmh()));
  range('turb', () => G.turb, (v) => { G.turb = v; flowDirty = true; }, (v) => v.toFixed(1) + '%');
  range('slicePos', () => G.slicePos, (v) => { G.slicePos = v; }, (v) => (v * 100).toFixed(0) + '%');
  range('density', () => G.density, (v) => { G.density = v; }, (v) => (v * 100).toFixed(0) + '%');
  range('contrast', () => G.contrast, (v) => { G.contrast = v; drawLegend(); }, (v) => v.toFixed(2) + '×');
  range('rate', () => G.rate, (v) => { G.rate = v; }, (v) => (v * 100).toFixed(0) + '%');

  const togglePause = () => { G.paused = !G.paused; syncUI(); };
  $('pauseBtn').addEventListener('click', togglePause);
  $('dockPlay').addEventListener('click', togglePause);
  $('resetBtn').addEventListener('click', () => { if (engine) { engine.reset(); resetTrace(); } });
  $('dockShape').addEventListener('click', () => {
    const keys = Object.keys(SHAPES);
    setShape(keys[(keys.indexOf(G.shape) + 1) % keys.length]);
  });
  $('dockField').addEventListener('click', () => {
    do { G.field = (G.field + 1) % FIELDS.length; } while (G.field === 3 && G.mode === '3d');
    syncUI();
  });

  // Panel, phone sheet and dock.
  const panel = $('panel'), dockPanel = $('dockPanel');
  function setOpen(open) {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
  }
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', (e) => setOpen(!e.matches));
  const grip = $('sheetGrip');
  let gripY = null;
  grip.addEventListener('pointerdown', (e) => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old Safari */ } });
  grip.addEventListener('pointerup', (e) => {
    if (gripY === null) return;
    const dy = e.clientY - gripY;
    gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // A 2D grid follows the canvas aspect. Rebuild it after a rotation.
  let rot = null;
  addEventListener('resize', () => {
    if (G.mode !== '2d' || !engine) return;
    clearTimeout(rot);
    rot = setTimeout(() => {
      const [nx, ny] = dims2d();
      if (engine && (nx !== engine.nx || Math.abs(ny - engine.ny) > 32)) makeEngine();
    }, 400);
  });
  syncUI();
}

// ------------------------------------------------------------- gestures
function bindGestures() {
  const pts = new Map();
  let pinch0 = null, lastTap = 0, moved = false;
  const hideHint = () => $('hint').classList.add('gone');
  const resetView = () => { view.zoom = 1; view.pan = [0, 0]; orbitHome(); };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: view.zoom, dist: orbit.dist, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pan: [...view.pan] };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      if (G.mode === '2d') { view.pan[0] += dx; view.pan[1] -= dy; }
      else {
        orbit.yaw -= dx * 0.006;
        orbit.pitch = Math.min(1.45, Math.max(-0.1, orbit.pitch + dy * 0.005));
      }
      hideHint();
    } else if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const k = d / Math.max(pinch0.d, 1);
      if (G.mode === '2d') {
        view.zoom = Math.min(12, Math.max(0.5, pinch0.zoom * k));
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        view.pan = [pinch0.pan[0] + mid[0] - pinch0.mid[0], pinch0.pan[1] - (mid[1] - pinch0.mid[1])];
      } else {
        orbit.dist = Math.min(3, Math.max(0.25, pinch0.dist / k));
      }
      hideHint();
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (e.type === 'pointerup' && !moved && pts.size === 0) {
      const now = performance.now();
      if (now - lastTap < 320) { resetView(); lastTap = 0; } else lastTap = now;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    if (G.mode === '2d') {
      // Zoom about the cursor.
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = r.bottom - e.clientY;
      const z0 = view.zoom, z1 = Math.min(12, Math.max(0.5, z0 * k));
      const cw = canvas.clientWidth - occ.l - occ.r, ch = canvas.clientHeight - occ.t - occ.b;
      const cx = occ.l + cw / 2 + view.pan[0], cy = occ.b + ch / 2 + view.pan[1];
      view.pan[0] += (mx - cx) * (1 - z1 / z0);
      view.pan[1] += (my - cy) * (1 - z1 / z0);
      view.zoom = z1;
    } else {
      orbit.dist = Math.min(3, Math.max(0.25, orbit.dist / k));
    }
    hideHint();
  }, { passive: false });
  setTimeout(hideHint, 9000);
}

// ------------------------------------------------------------- screensaver
// Shell screensaver hook (lib/screensaver.js). enter() hides every overlay
// with display:none, so occlusion() gives the camera the full canvas, and
// keeps the 3D mode with rake streaks. The autopilot plays a seeded tour of
// SAVER_TOUR, about three objects per dwell. setShape() restarts the flow,
// so each change happens at the bottom of a fade to black (f.dim in the
// engine). The camera orbits slowly and the pitch eases between 0.2 and 0.4.
// G.rate (1 - 0.5 calm) slows the flow. SAVER is null outside the saver.
//
// The label plate (opts.label) names the object and gives the lattice
// equations that lbm3d.wgsl computes: pull streaming with BGK collision,
// the second-order equilibrium, the Smagorinsky relaxation time and the
// momentum-exchange force. The lines give the live Re of applyFlow() and
// the smoothed C_D, C_L and drag of readForces(). tick() calls saverPlate()
// every 1 s; a new object gives a new title, so the plate fades with it.
const SAVER_TOUR = [['cow', 'Spherical cow'], ['car', 'Fastback'], ['airfoil', 'NACA 4412'], ['truck', 'Aero kit'], ['cow', 'Holstein'], ['sphere', 'Ball'], ['car', 'SUV']];
let SAVER = null;
function saverPlate() {
  if (!SAVER || !SAVER.label || !engine || !pk || !flowInfo) return;
  const s = SHAPES[G.shape], fi = flowInfo;
  const ok = !isNaN(cdS);
  const nuLat = U_LAT * pk.refCells / fi.Re, tau = Math.max(0.5 + 3 * nuLat, TAU_MIN);
  const lines = [
    `${FLUIDS[G.fluid].label} at ${fmtKmh(speedKmh())} · L = ${pk.realLen.toFixed(2)} m · ν = ${FLUIDS[G.fluid].nu.toExponential(1)} m²/s`,
    `Re = ${sci(fi.Re)}` + (fi.clamped ? ` · grid Re ${sci(fi.ReGrid)}, eddy model above` : ' · fully on the grid'),
    ok ? `C_D = ${cdS.toFixed(2)} · C_L = ${clS.toFixed(2)} · drag ${newtons(dragN, false)}` : 'C_D, C_L: the flow is still settling',
    `grid ${engine.nx} × ${engine.ny} × ${engine.nz} · τ = ${tau.toFixed(4)} · U = ${U_LAT} · step ${engine.steps.toLocaleString()}`,
  ];
  try {
    SAVER.label({
      title: `${s.label} · ${SAVER.preset}`,
      sub: 'Lattice Boltzmann, D3Q19 BGK + Smagorinsky',
      lines,
      eq: [
        'fᵢ(x + cᵢ, t + 1) = fᵢ − (fᵢ − fᵢᵉᑫ) / τₑ',
        'fᵢᵉᑫ = wᵢρ(1 + 3cᵢ·u + 4.5(cᵢ·u)² − 1.5u²)',
        'τₑ = ½(τ + √(τ² + 0.764 |Πⁿᵉᑫ| / ρ))',
        'τ = ½ + 3ν_lat,  ν_lat = U·L_cells / Re',
        'Re = VL/ν',
        'F = −2Σ(fᵢ − wᵢ)cᵢ,  C_D = F_x / (½ρU²A)',
      ],
    });
  } catch { /* the shell plate is optional */ }
}
window.snSaver = {
  enter(opts) {
    const calm = Math.max(0, Math.min(1, +opts.calm || 0));
    const secs = Math.max(20, +opts.seconds || 60), fade = 2;
    const show = Math.max(6, secs / 3 - 2 * fade);
    let a = (opts.seed >>> 0) || 1;
    const rng = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const st = document.createElement('style');
    st.textContent = 'html.saver #hint,html.saver #gear,html.saver #card,html.saver #legend,html.saver #panel,html.saver #status,html.saver #dock,html.saver .topbar{display:none!important}html.saver #gl{cursor:none}';
    document.head.appendChild(st);
    document.documentElement.classList.add('saver');
    if (G.mode !== '3d') setMode('3d');
    G.streaks = 'rake'; G.field = 0; G.slice = 3; G.paused = false; G.rate = 1 - 0.5 * calm;
    let i = Math.floor(rng() * SAVER_TOUR.length);
    const yaw0 = rng() * 6.283;
    let presetNow = '';
    const next = () => {
      const [key, preset] = SAVER_TOUR[i];
      i = (i + 1) % SAVER_TOUR.length;
      G.params[key] = Object.assign(defaults(key), SHAPES[key].presets[preset]);
      presetNow = preset;
      setShape(key);
    };
    next();
    let ph = 'in', pt = 0, tt = 0;
    let lt = 1;
    SAVER = {
      k: 0,
      get preset() { return presetNow; },
      label: opts.labels === false || typeof opts.label !== 'function' ? null : opts.label,
      tick(dt) {
        pt += dt; tt += dt; lt += dt;
        if (lt >= 1) { lt = 0; saverPlate(); }
        if (ph === 'in') { SAVER.k = Math.min(1, pt / fade); if (SAVER.k >= 1) { ph = 'show'; pt = 0; } }
        else if (ph === 'show') { if (pt >= show) { ph = 'out'; pt = 0; } }
        else { SAVER.k = Math.max(0, 1 - pt / fade); if (SAVER.k <= 0) { next(); ph = 'in'; pt = 0; lt = 1; } }
        orbit.yaw = yaw0 + tt * 0.05 * (1 - 0.6 * calm);
        orbit.pitch = 0.3 - 0.1 * Math.cos(tt * 0.04);
        orbit.dist = 1; orbit.panY = 0;
      },
    };
    return { canvas, warmupMs: 3000 };
  },
};

boot();
