// ============================================================================
//  ANTENNA FIELDS  ·  main.js — state, controls, framing and the frame loop
// ----------------------------------------------------------------------------
//  ES module. em.js gives the currents and the pattern, field-gl.js the GPU
//  field, overlay.js the 2D layer, plots.js the cuts and the sweep, lobe.js
//  (loaded later) the 3D pattern, saver.js the screensaver hook.
//
//  UNITS. Each antenna is designed in metres for f0 = 300 MHz (lambda0 = 1 m).
//  The frequency slider keeps the metal and changes lambda, so the electrical
//  lengths scale by f/f0. Physics runs in wavelengths; the view and the
//  readouts show metres and wavelengths. Fields are for a 1 A feed current.
//
//  PIPELINE.
//    rebuild()      the state -> em.buildAntenna -> GPU elements; the
//                   pattern statistics, cuts and lobe a little later (debounce)
//    frame()        the phase, the framing (clearRect), the phasor pass when
//                   the view or the antenna changed (low resolution while the
//                   user drags, full resolution 180 ms after), the probe grid,
//                   the overlay and the display pass
//
//  grep -n: "const DEF"  "function rebuild"  "function frame"  "function clearRect"
//           "function buildUI"  "function normalise"  "function readouts"
//           "function sweepStep"  "function pointer"  "window.__af"
// ============================================================================
import * as em from './em.js';
import { createField } from './field-gl.js';
import { mapper, inPlane, traceLines, drawOverlay } from './overlay.js';
import { drawPolar, drawSweep } from './plots.js';
import { typesetAll } from '../../lib/sci-math.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const F0 = 300;                      // design frequency, MHz (lambda0 = 1 m)
const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
const phoneMQ = window.matchMedia(PHONE_Q);
const TAU = 2 * Math.PI;

// ── antenna definitions ─────────────────────────────────────────────────────
// params: k, tex, word, min, max, step, fmt; log: the slider holds log10(v).
const lam = v => v.toFixed(2) + ' λ₀';
const DEF = {
  hertz: {
    name: 'Hertzian dipole', view: 'side', zoom: 1.0,
    hint: 'An ideal short current element. The field shape does not depend on its length; only the strength does.',
    params: [{ k: 'dl', tex: '\\Delta l', word: 'element length', min: 0.01, max: 0.1, step: 0.005, fmt: lam }],
    presets: [],
  },
  dipole: {
    name: 'Centre-fed dipole', view: 'side', zoom: 1.5,
    hint: 'A straight wire fed at its centre. At L = λ/2 it is resonant near 73 Ω.',
    params: [
      { k: 'L', tex: 'L', word: 'length', min: 0.05, max: 2.0, step: 0.01, fmt: lam },
      { k: 'a', tex: 'a', word: 'wire radius', min: -4, max: -2, step: 0.05, log: true, fmt: v => (v * 1000).toFixed(v < 0.001 ? 2 : 1) + ' mm' },
    ],
    models: true,
    presets: [['Short', { L: 0.1 }], ['λ/2', { L: 0.5 }], ['λ', { L: 1.0 }], ['5λ/4', { L: 1.25 }], ['3λ/2', { L: 1.5 }], ['2λ', { L: 2.0 }]],
  },
  loop: {
    name: 'Circular loop', view: 'side', zoom: 1.3,
    hint: 'A small loop is a magnetic dipole. At one wavelength around, the current is no longer uniform and the beam turns to the axis.',
    params: [{ k: 'C', tex: 'C', word: 'circumference', min: 0.05, max: 1.6, step: 0.01, fmt: lam }],
    presets: [['Small', { C: 0.15 }], ['C = λ/2', { C: 0.5 }], ['C = λ', { C: 1.0 }]],
  },
  array: {
    name: 'Phased array', view: 'top', zoom: 2.6,
    hint: 'Half-wave dipoles along x, equal currents with a progressive phase β. The beam turns to where the waves arrive in step.',
    params: [
      { k: 'N', tex: 'N', word: 'elements', min: 2, max: 16, step: 1, fmt: v => String(v) },
      { k: 'd', tex: 'd', word: 'spacing', min: 0.1, max: 1.0, step: 0.01, fmt: lam },
      { k: 'steer', tex: '\\theta_s', word: 'steering', min: -80, max: 80, step: 1, fmt: v => v.toFixed(0) + '°' },
      { k: 'beta', tex: '\\beta', word: 'phase step', min: -180, max: 180, step: 1, fmt: v => v.toFixed(0) + '°' },
    ],
    presets: [['Broadside', { beta: 0, steer: 0, d: 0.5 }], ['Steer 35°', { steer: 35, d: 0.5 }], ['End-fire', { d: 0.25, beta: -90 }], ['Grating', { d: 0.95, steer: 20 }]],
  },
  yagi: {
    name: 'Yagi-Uda', view: 'top', zoom: 2.4,
    hint: 'One driven element. The reflector and the directors have no feed: the moment method finds the currents that the near field induces in them.',
    params: [
      { k: 'nd', tex: 'n_d', word: 'directors', min: 0, max: 10, step: 1, fmt: v => String(v) },
      { k: 'Lr', tex: 'L_r', word: 'reflector', min: 0.4, max: 0.6, step: 0.005, fmt: lam },
      { k: 'Ld', tex: 'L_0', word: 'driven', min: 0.4, max: 0.6, step: 0.005, fmt: lam },
      { k: 'Lz', tex: 'L_d', word: 'director', min: 0.35, max: 0.5, step: 0.005, fmt: lam },
      { k: 'sr', tex: 's_r', word: 'reflector gap', min: 0.1, max: 0.35, step: 0.005, fmt: lam },
      { k: 'sd', tex: 's_d', word: 'director gap', min: 0.1, max: 0.4, step: 0.005, fmt: lam },
    ],
    presets: [['3 elements', { nd: 1, sd: 0.2, Lz: 0.44 }], ['6 elements', { nd: 4, sd: 0.25, Lz: 0.44 }], ['10 elements', { nd: 8, sd: 0.3, Lz: 0.43 }]],
  },
};

// ── state ─────────────────────────────────────────────────────────────────────
const S = {
  type: 'dipole', f: F0,
  hertz: { dl: 0.05 },
  dipole: { L: 0.5, a: 0.001, model: 'sin' },
  loop: { C: 1.0, a: 0.001 },
  array: { N: 8, d: 0.5, steer: 25, beta: 0, Le: 0.5, a: 0.001 },
  yagi: { nd: 4, Lr: 0.495, Ld: 0.47, Lz: 0.44, sr: 0.2, sd: 0.25, a: 0.001 },
  view: 'side', field: 'E',
  tog: { lines: true, arrows: false, zones: true, log: false, rcomp: true, grid: true },
  exposure: 0, speed: 0.4, slow: false, playing: true, phase: 0,
  cam: { zoom: 1, panX: 0, panY: 0 },     // zoom multiplies the default half height; pan in metres
  saver: false, band: null, saverRect: null, fade: 1, lobeShot: null, saverTick: null,
};
S.array.beta = -360 * S.array.d * Math.sin(S.array.steer * Math.PI / 180);

let A = null, stats = null, field = null, lobe = null, lobeShared = null;
let dirtyAntenna = true, statsTimer = 0, lastInteract = -1e9, refineDue = false;
let probe = null, norm = { gain: 1, psiScale: 1, lineRef: 1, sRef: 1 }, viewKey = '', lastKey = '';
const fieldCanvas = $('field'), overlay = $('overlay'), octx = overlay.getContext('2d');
let lineBuf = null, linesCache = null;
const timing = { phasorMs: 0, res: '' };

function scale() { return S.f / F0; }
function lambdaM() { return 300 / S.f; }
function electrical() {
  const s = scale(), t = S.type, P = S[t];
  const e = { type: t, budget: 300 };
  if (t === 'hertz') e.dl = P.dl * s;
  if (t === 'dipole') Object.assign(e, { L: P.L * s, a: P.a * s, model: P.model });
  if (t === 'loop') Object.assign(e, { C: P.C * s, a: P.a * s, modes: 40 });
  if (t === 'array') Object.assign(e, { N: P.N, d: P.d * s, beta: P.beta * Math.PI / 180, Le: P.Le * s, a: P.a * s });
  if (t === 'yagi') Object.assign(e, { nd: P.nd, Lr: P.Lr * s, Ld: P.Ld * s, Lz: P.Lz * s, sr: P.sr * s, sd: P.sd * s, a: P.a * s });
  return e;
}
// The centre of the metal, in metres along x.
function centreM() {
  if (S.type === 'yagi') { const P = S.yagi; return (P.nd * P.sd - P.sr) / 2; }
  return 0;
}
function extentM() {
  const t = S.type, P = S[t];
  if (t === 'hertz') return 0.3;
  if (t === 'dipole') return P.L;
  if (t === 'loop') return P.C / Math.PI;
  if (t === 'array') return (P.N - 1) * P.d + 0.5;
  return P.sr + P.nd * P.sd + 0.5;
}

// ── rebuild: currents, GPU elements, pattern ─────────────────────────────────
function rebuild() {
  dirtyAntenna = false;
  A = em.buildAntenna(electrical());
  if (field) {
    // softening: about one element spacing, so the field near the wire is smooth
    let soft = 0.004;
    if (A.elems.n > 1) { const D = A.elems.d; soft = Math.max(0.003, Math.min(0.02, 0.6 * Math.hypot(D[8] - D[0], D[9] - D[1], D[10] - D[2]))); }
    field.setElems(A.elems, soft);
  }
  lastKey = '';
  scheduleStats();
  readoutsQuick();
  viewHint();
}
// The pattern integral costs 5 to 40 ms. While a slider moves it waits for a
// pause; in the screensaver (geometry changes each frame) it runs at most
// every 600 ms.
let lastStatsAt = -1e9;
function scheduleStats() {
  const now = performance.now();
  if (S.saver) {
    if (!statsTimer) statsTimer = setTimeout(() => { statsTimer = 0; computeStats(); }, Math.max(0, 600 - (now - lastStatsAt)));
    return;
  }
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => { statsTimer = 0; computeStats(); }, now - lastInteract < 300 ? 140 : 0);
}

function computeStats() {
  if (!A) return;
  const t0 = performance.now();
  lastStatsAt = t0;
  stats = em.patternStats(A.elems, { nt: 64, np: 128 });
  const n = 360;
  const cutSide = em.patternCut(A.elems, [1, 0, 0], [0, 0, 1], n), cutTop = em.patternCut(A.elems, [1, 0, 0], [0, 1, 0], n);
  const sideHas = Math.abs(stats.dir[1]) < 0.05, topHas = Math.abs(stats.dir[2]) < 0.05;
  const sideKind = sideHas ? (Math.abs(stats.pol[1]) < 0.3 ? 'E-plane' : 'H-plane') : 'cut';
  const topKind = topHas ? (Math.abs(stats.pol[2]) < 0.3 ? 'E-plane' : 'H-plane') : 'cut';
  $('legSide').textContent = 'xz plane' + (sideHas ? ' · ' + sideKind : '');
  $('legTop').textContent = 'xy plane' + (topHas ? ' · ' + topKind : '');
  const beam = S.view === 'top' ? Math.atan2(stats.dir[1], stats.dir[0]) : Math.atan2(stats.dir[2], stats.dir[0]);
  lastCuts = { side: cutSide, top: cutTop, beam: (S.view === 'top' ? topHas : sideHas) ? beam : null, upLabel: 'z  ·  y' };
  if (!S.saver || S.lobeShot) {
    lastGrid = { U: em.patternGrid(A.elems, 44, 88), nt: 44, np: 88 };
    if (lobe && !S.saver) lobe.update(lastGrid.U, 44, 88, A.wires, A.extent);
    if (lobeShared && S.saver) lobeShared.update(lastGrid.U, 44, 88, A.wires, A.extent);
  }
  timing.statsMs = performance.now() - t0;
  if (S.saver) return;
  drawPolar($('polar'), lastCuts);
  readouts();
  sweepReset();
}
let lastCuts = null, lastGrid = null;

// ── framing ─────────────────────────────────────────────────────────────────
// The part of the window that no panel covers, in CSS px.
function clearRect() {
  const W = innerWidth, H = innerHeight;
  if (S.saver) {
    const b = S.band, wcol = b && b.w ? b.w : W;
    const l = (W - wcol) / 2;
    return { x: l, y: b ? b.t : 0, w: wcol, h: H - (b ? b.t + b.b : 0) };
  }
  let l = 0, r = W, t = 0, btm = H;
  const vis = el => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return null; return el.getBoundingClientRect(); };
  const phone = phoneMQ.matches;
  const bar = vis(document.querySelector('.topbar'));
  if (bar && !document.documentElement.classList.contains('in-frame')) t = Math.max(t, bar.bottom);
  if (!phone) {
    const p = vis($('panel')); if (p && p.right > 0) l = Math.max(l, p.right);
    const sd = vis($('side')); if (sd && sd.left < W) r = Math.min(r, sd.left);
    const st = vis($('status')); if (st) btm = Math.min(btm, st.top);
  } else {
    const lg = vis($('legend')); if (lg) t = Math.max(t, lg.bottom);
    const eq = vis($('eqPanel')); if (eq && eq.width < W * 0.6) t = Math.max(t, eq.bottom);
    const p = vis($('panel'));
    const land = window.matchMedia('(max-height:500px) and (orientation:landscape)').matches;
    if (p && $('panel').classList.contains('open')) { if (land) r = Math.min(r, p.left); else btm = Math.min(btm, p.top); }
    const dk = vis($('dock')); if (dk) { if (land) btm = Math.min(btm, dk.top); else btm = Math.min(btm, dk.top); }
    const st = vis($('status')); if (st && !land) btm = Math.min(btm, st.top);
  }
  return { x: l, y: t, w: Math.max(40, r - l), h: Math.max(40, btm - t) };
}

const view = { u0: -2, v0: -1, u1: 2, v1: 1 };
function updateView(cr) {
  const W = fieldCanvas.clientWidth || innerWidth, H = fieldCanvas.clientHeight || innerHeight;
  // half height of the view in metres
  const half = Math.max(DEF[S.type].zoom, extentM() * 0.75) * S.cam.zoom;
  const s = scale();
  // lambda per CSS px: the half height of the view fills half the clear rect's smaller side
  const ppx = 2 * half * s / Math.min(cr.w, cr.h * 1.25);
  const uc = (centreM() + S.cam.panX) * s, vc = S.cam.panY * s;
  const ccx = cr.x + cr.w / 2, ccy = cr.y + cr.h / 2;
  view.u0 = uc - ccx * ppx; view.u1 = view.u0 + W * ppx;
  view.v1 = vc + ccy * ppx; view.v0 = view.v1 - H * ppx;
  if (field) {
    const fv = field.view;
    fv.u0 = view.u0; fv.u1 = view.u1; fv.v0 = view.v0; fv.v1 = view.v1;
    fv.axU = [1, 0, 0]; fv.axV = S.view === 'side' ? [0, 0, 1] : [0, 1, 0];
    fv.centre = [centreM() * s, 0, 0];
    fv.psi = psiMode();
  }
  return [view.u0, view.v0, view.u1, view.v1].map(v => v.toFixed(5)).join(',') + '|' + S.view + '|' + fieldCanvas.width + 'x' + fieldCanvas.height;
}
function psiMode() {
  if (!A || !S.tog.lines) return 0;
  const k = S.view === 'side' ? A.psi.side : A.psi.top;
  return k === 'E' ? 1 : k === 'Bloop' ? 2 : k === 'B' ? 3 : 0;
}
// The in-plane field the CPU tracer follows when psi has no flux function.
function traceField() {
  if (!A || !S.tog.lines || psiMode()) return null;
  if (S.type === 'loop') return S.view === 'side' ? 'H' : 'E';
  return S.view === 'side' ? 'E' : 'H';
}
// What the colour map shows: [x, y, z] signed axis, or w = 1 for in-plane magnitude.
function compSpec() {
  const loop = S.type === 'loop', side = S.view === 'side', E = S.field === 'E';
  if (!loop) {
    if (side) return E ? [0, 0, 1, 0] : [0, 1, 0, 0];
    return E ? [0, 0, 1, 0] : [0, 0, 0, 1];
  }
  if (side) return E ? [0, 1, 0, 0] : [0, 0, 1, 0];
  return E ? [0, 0, 0, 1] : [0, 0, 1, 0];
}
function fieldLabel() {
  const c = compSpec(), F = S.field === 'E' ? 'E' : 'B';
  if (S.field === 'S') return '|S(t)|, instantaneous power flow';
  if (S.field === 'Savg') return '|⟨S⟩|, time-average power flow';
  if (c[3]) return '|' + F + '| in the plane, at time t';
  return F + (c[0] ? 'x' : c[1] ? 'y' : 'z') + '(t), signed';
}

// ── normalisation from the probe grid ────────────────────────────────────────
function percentile(arr, q) {
  const a = arr.filter(v => isFinite(v) && v > 0).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 1;
}
function normalise() {
  if (!probe) return;
  const { w, h, T } = probe, s = scale(), c = compSpec();
  const rref = rRef();
  const cen = centreM() * s;
  const vals = [], svals = [], pvals = [];
  const isH = S.field === 'H';
  for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2) {
    const q = (j * w + i) * 4;
    const u = view.u0 + (i + 0.5) / w * (view.u1 - view.u0), v = view.v0 + (j + 0.5) / h * (view.v1 - view.v0);
    const r = Math.hypot(u - cen, v);
    const wr = S.tog.rcomp ? Math.max(r, 0.12) / rref : 1;
    const F = isH ? [[T[1][q + 2], T[1][q + 3]], [T[2][q], T[2][q + 1]], [T[2][q + 2], T[2][q + 3]]] : [[T[0][q], T[0][q + 1]], [T[0][q + 2], T[0][q + 3]], [T[1][q], T[1][q + 1]]];
    let m;
    const axV = S.view === 'side' ? 2 : 1;
    if (c[3]) m = Math.hypot(F[0][0], F[0][1], F[axV][0], F[axV][1]);
    else { const k = c[0] ? 0 : c[1] ? 1 : 2; m = Math.hypot(F[k][0], F[k][1]); }
    vals.push(m * wr);
    // <S>
    const E = [[T[0][q], T[0][q + 1]], [T[0][q + 2], T[0][q + 3]], [T[1][q], T[1][q + 1]]], Hh = [[T[1][q + 2], T[1][q + 3]], [T[2][q], T[2][q + 1]], [T[2][q + 2], T[2][q + 3]]];
    const cr = (X, Y) => [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    const a1 = cr(E.map(z => z[0]), Hh.map(z => z[0])), a2 = cr(E.map(z => z[1]), Hh.map(z => z[1]));
    svals.push(0.5 * Math.hypot(a1[0] + a2[0], a1[1] + a2[1], a1[2] + a2[2]) * wr * wr);
    pvals.push(Math.hypot(T[3][q], T[3][q + 1]));
  }
  const ex = Math.pow(2, S.exposure);
  if (S.field === 'S' || S.field === 'Savg') norm.gain = (S.tog.log ? 0.5 : 1.1) / percentile(svals, 0.88) * ex * (S.field === 'S' ? 0.55 : 1);
  else norm.gain = (S.tog.log ? 0.45 : 0.95) / percentile(vals, 0.9) * ex;
  norm.sRef = percentile(svals, 0.9);
  const pm = psiMode();
  if (pm === 3) norm.psiScale = 1 / (percentile(pvals, 0.5) * 0.6);
  else norm.psiScale = (pm === 2 ? 5 : 6) / percentile(pvals, 0.88);
  linesCache = null;
}
function rRef() { return 0.25 * (view.v1 - view.v0); }

// ── canvases ─────────────────────────────────────────────────────────────────
function dprCap() { return Math.min(window.devicePixelRatio || 1, phoneMQ.matches ? 2 : 1.5); }
function resize() {
  const d = dprCap(), W = Math.max(2, Math.round(innerWidth * d)), H = Math.max(2, Math.round(innerHeight * d));
  if (fieldCanvas.width !== W || fieldCanvas.height !== H) { fieldCanvas.width = W; fieldCanvas.height = H; }
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
}

// ── the frame loop ──────────────────────────────────────────────────────────
let last = performance.now(), fps = 60, statusAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (S.saverTick) S.saverTick(dt);
  if (S.playing) S.phase = (S.phase + TAU * S.speed * (S.slow ? 0.2 : 1) * dt) % (TAU * 1000);
  if (dirtyAntenna) rebuild();
  // The shell's gpu-guard loses every context when it releases the page. A
  // lost context reports FRAMEBUFFER_UNSUPPORTED, so stop drawing here.
  if (!field || field.gl.isContextLost()) return;
  resize();
  const cr = clearRect();
  viewKey = updateView(cr);
  const interacting = now - lastInteract < 180;
  if (viewKey !== lastKey) {
    computePhasors(interacting ? 0.5 : 1);
    lastKey = viewKey;
    refineDue = interacting;
  } else if (refineDue && !interacting) { computePhasors(1); refineDue = false; }
  // overlay
  const W = fieldCanvas.width, H = fieldCanvas.height, dpr = W / Math.max(1, fieldCanvas.clientWidth || innerWidth);
  const map = mapper(view, W, H);
  const tf = traceField();
  let lines = null;
  if (tf && probe) {
    lineBuf = inPlane(probe, tf, S.phase, [1, 0, 0], S.view === 'side' ? [0, 0, 1] : [0, 1, 0], lineBuf);
    if (!linesCache || linesCache.ref == null) {
      let mags = [];
      for (let i = 0; i < lineBuf.length; i += 14) mags.push(Math.hypot(lineBuf[i], lineBuf[i + 1]));
      linesCache = { ref: percentile(mags, 0.75) * 1.4 };
    }
    lines = { list: traceLines(lineBuf, probe.w, probe.h, { seedStep: phoneMQ.matches ? 7 : 6.5, steps: 44, ds: 0.5 }), gw: probe.w, gh: probe.h, ref: linesCache.ref,
      color: tf === 'E' ? 'rgba(225,245,255,A)' : 'rgba(225,215,255,A)' };
  }
  const s = scale(), Dl = A ? A.extent : 0;
  const ov = {
    W, H, dpr, view, map, wires: A ? A.wires : [], plane: S.view, phase: S.phase,
    centre: [centreM() * s, 0],
    zones: Object.assign({ on: S.tog.zones, lambdaM: lambdaM() }, zoneRadii(Dl)),
    lines,
    arrows: { on: S.tog.arrows && !!probe, probe, ref: norm.sRef || 1, axU: [1, 0, 0], axV: S.view === 'side' ? [0, 0, 1] : [0, 1, 0], w2: S.tog.rcomp, rref: rRef() },
    feed: feedPoint(),
    scaleBox: S.saver ? null : { x: (cr.x + 18) * dpr, y: (cr.y + cr.h - 16) * dpr, lambdaM: lambdaM() },
  };
  if (S.saver && S.lobeShot) { ov.lines = null; ov.arrows.on = false; ov.zones.on = false; }
  drawOverlay(octx, ov);
  if (S.saver) field.uploadOverlay(overlay);
  const mode = { E: 0, H: 1, S: 2, Savg: 3 }[S.field];
  field.draw({
    phase: S.phase, mode, comp: compSpec(), gain: norm.gain, log: S.tog.log, rcomp: S.tog.rcomp && mode < 2 || (S.tog.rcomp && mode >= 2),
    rref: rRef(), psiOn: psiMode() > 0, psiScale: norm.psiScale, psiLog: psiMode() === 3, lineAlpha: 0.8,
    grid: S.tog.grid && !S.saver ? 0.5 : 0, overlay: S.saver, fade: S.fade * (S.lobeShot ? 0.32 : 1),
  });
  if (S.saver && S.lobeShot && lobeShared) {
    const d = dpr, L = S.lobeShot;
    lobeShared.setOrbit(L.az, L.el, L.dist);
    const side = Math.min(cr.w, cr.h) * 0.98 * d;
    lobeShared.render({ x: Math.round((cr.x + cr.w / 2) * d - side / 2), y: Math.round((cr.y + cr.h / 2) * d - side / 2), w: Math.round(side), h: Math.round(side) });
  }
  if (lobe && !S.saver && lobeVisible) lobe.render();
  if (sweepJob && !S.saver) sweepStep(now);
  if (now - statusAt > 250) { statusAt = now; status(); }
}

let computeFailed = false;
function computePhasors(q) {
  const n = A ? A.elems.n : 1;
  const px = fieldCanvas.width * fieldCanvas.height;
  // element-pixel budget: about 2.4e8 per pass on a laptop GPU
  let sc = Math.min(1, Math.max(0.22, Math.sqrt(2.4e8 / (n * px))));
  sc *= q;
  const t0 = performance.now();
  try { field.compute(sc); }
  catch (e) { if (!computeFailed) console.error('[antenna-fields] phasor pass', e); computeFailed = true; return; }
  const pw = phoneMQ.matches ? 120 : 176, ph = Math.max(24, Math.round(pw * fieldCanvas.height / fieldCanvas.width));
  probe = field.readProbe(pw, ph);
  timing.phasorMs = performance.now() - t0;
  const sz = field.size;
  timing.res = sz[0] + '×' + sz[1];
  normalise();
}

// Field regions (in wavelengths) for an antenna of largest size D:
// reactive near field inside max(lambda/2pi, 0.62 sqrt(D^3/lambda)); far field
// (Fraunhofer) beyond max(2D^2/lambda, 2D, lambda).
function zoneRadii(D) {
  return { rNear: Math.max(1 / TAU, 0.62 * Math.sqrt(D * D * D)), rFar: Math.max(2 * D * D, 2 * D, 1) };
}
function feedPoint() {
  if (!A) return null;
  if (S.type === 'loop') return [S.loop.C * scale() / TAU, 0, 0];
  return [0, 0, 0];
}

// ── readouts ────────────────────────────────────────────────────────────────
const fz = Z => !Z ? '—' : !isFinite(Z[0]) ? '∞' : Z[0].toFixed(Math.abs(Z[0]) < 1 ? 3 : 1) + (isFinite(Z[1]) ? (Z[1] < 0 ? ' − j' : ' + j') + Math.abs(Z[1]).toFixed(1) : '') + ' Ω';
function vswr(Z, Z0 = 50) {
  if (!Z || !isFinite(Z[0]) || !isFinite(Z[1])) return '—';
  const nr = Z[0] - Z0, ni = Z[1], dr = Z[0] + Z0, di = Z[1];
  const g = Math.hypot(nr, ni) / Math.hypot(dr, di);
  return g >= 0.999 ? '> 100' : ((1 + g) / (1 - g)).toFixed(2);
}
function elecSize() {
  const s = scale(), t = S.type, P = S[t];
  if (t === 'hertz') return ['Δl / λ', (P.dl * s).toFixed(3)];
  if (t === 'dipole') return ['L / λ', (P.L * s).toFixed(3)];
  if (t === 'loop') return ['C / λ', (P.C * s).toFixed(3)];
  if (t === 'array') return ['d / λ', (P.d * s).toFixed(3)];
  return ['boom / λ', ((P.sr + P.nd * P.sd) * s).toFixed(3)];
}
function readoutsQuick() {
  const q = $('quick');
  const zs = S.type === 'hertz' ? (A ? A.Zin[0].toFixed(3) + ' Ω' : '—') : fz(A && A.Zin);
  q.innerHTML = `<div><span>${S.type === 'hertz' ? 'R<sub>rad</sub>' : 'Z<sub>in</sub>'}</span><b>${zs}</b></div>` +
    `<div><span>Gain</span><b>${stats ? stats.Ddb.toFixed(2) + ' dBi' : '…'}</b></div>`;
}
function readouts() {
  readoutsQuick();
  const s = scale(), [szl, szv] = elecSize();
  const rows = [
    ['Frequency', S.f.toFixed(0) + ' MHz'],
    ['Wavelength λ', lambdaM().toFixed(3) + ' m'],
    [szl, szv],
  ];
  if (S.type === 'hertz') rows.push(['R<sub>rad</sub>', A.Zin[0].toFixed(4) + ' Ω', 'big'], ['X', 'not defined (ideal element)']);
  else rows.push([S.type === 'array' ? 'Z<sub>active</sub> (centre)' : 'Z<sub>in</sub>', fz(A.Zin), 'big'], ['VSWR, 50 Ω', vswr(A.Zin)]);
  if (stats) {
    rows.push(['P<sub>rad</sub> at 1 A', fmtW(stats.P)]);
    rows.push(['Directivity', stats.D.toFixed(2) + ' = ' + stats.Ddb.toFixed(2) + ' dBi', 'big']);
    rows.push(['Gain, no loss', stats.Ddb.toFixed(2) + ' dBi']);
    rows.push(['HPBW E / H', fmtDeg(stats.hpbwE) + ' / ' + fmtDeg(stats.hpbwH)]);
    if (S.type === 'yagi' || S.type === 'array') rows.push(['Front / back', stats.fb > 60 ? '> 60 dB' : stats.fb.toFixed(1) + ' dB']);
    if (S.type === 'array') {
      const az = Math.atan2(stats.dir[0], Math.abs(stats.dir[1])) * 180 / Math.PI;
      rows.push(['Beam from broadside', az.toFixed(1) + '°']);
      const dE = S.array.d * s, st = Math.abs(Math.sin(S.array.steer * Math.PI / 180));
      if (dE > 1 / (1 + st)) rows.push(['Grating lobe', 'yes: d > λ/(1 + |sin θs|)']);
    }
  }
  rows.push(['Fields', 'exact, ' + A.elems.n + ' elements']);
  if (A.note) rows.push(['Currents', A.note]);
  if (S.type === 'dipole') rows.push(['Model', S.dipole.model === 'mom' ? 'moment method (Galerkin)' : 'sinusoidal, induced EMF']);
  $('readout').innerHTML = rows.map(r => `<tr${r[2] ? ' class="big"' : ''}><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
}
const fmtDeg = v => isFinite(v) ? v.toFixed(1) + '°' : 'omni';
const fmtW = p => p >= 1 ? p.toFixed(2) + ' W' : p >= 1e-3 ? (p * 1000).toFixed(2) + ' mW' : (p * 1e6).toFixed(2) + ' µW';

function status() {
  const deg = ((S.phase % TAU) / TAU * 360).toFixed(0);
  $('stMain').textContent = DEF[S.type].name + ' · ' + fieldLabel() + ' · ωt = ' + deg + '°' + (S.playing ? '' : ' (paused)');
  $('stRight').textContent = (A ? A.elems.n : 0) + ' elements · phasor ' + timing.res + ' ' + timing.phasorMs.toFixed(0) + ' ms · ' + fps.toFixed(0) + ' fps';
  legend();
}
let legendKey = '';
function legend() {
  const key = S.field + compSpec().join('') + S.tog.log;
  if (key === legendKey) return;
  legendKey = key;
  $('lgTitle').textContent = fieldLabel().replace(', signed', '').replace(', at time t', '');
  const c = $('lgBar'), g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, c.width, 0);
  const signed = S.field === 'E' || S.field === 'H' ? !compSpec()[3] : false;
  if (S.field === 'S' || S.field === 'Savg') ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'].forEach((col, i, a) => grad.addColorStop(i / (a.length - 1), col));
  else if (signed) {
    const neg = S.field === 'E' ? '#38c7ed' : '#736bff', pos = S.field === 'E' ? '#ff9e52' : '#ff5ca8';
    grad.addColorStop(0, '#f6f0e6'); grad.addColorStop(0.12, neg); grad.addColorStop(0.5, '#04050a'); grad.addColorStop(0.88, pos); grad.addColorStop(1, '#f6f0e6');
  } else { const pos = S.field === 'E' ? '#ff9e52' : '#ff5ca8'; grad.addColorStop(0, '#04050a'); grad.addColorStop(0.85, pos); grad.addColorStop(1, '#f6f0e6'); }
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  $('lgLo').textContent = signed ? '−' : '0'; $('lgMid').textContent = signed ? '0' : ''; $('lgHi').textContent = signed ? '+' : 'max';
}

// ── impedance sweep (runs a few points per frame) ──────────────────────────────
let sweepJob = null, sweepKey = '';
function sweepReset() {
  const t = S.type, P = S[t];
  const key = t + JSON.stringify(P) + (t === 'array' ? S.f : '');
  const card = $('cardSweep');
  if (key === sweepKey && sweepJob) { sweepJob.mark = markX(); return; }
  if (key === sweepKey && lastSweep) { lastSweep.mark = markX(); drawSweep($('sweep'), lastSweep); return; }
  sweepKey = key;
  card.style.display = '';
  const xs = [];
  if (t === 'array') for (let a = -80; a <= 80; a += 4) xs.push(a);
  else if (t === 'yagi') for (let f = 240; f <= 360; f += 4) xs.push(f);
  else for (let f = 150; f <= 600; f += 10) xs.push(f);
  $('sweepTitle').textContent = t === 'array' ? 'Active impedance vs steering' : t === 'hertz' ? 'Radiation resistance vs frequency' : 'Input impedance vs frequency';
  sweepJob = { t, xs, R: new Array(xs.length).fill(NaN), X: new Array(xs.length).fill(NaN), i: 0, mark: markX(), xLabel: t === 'array' ? 'steering angle (°)' : 'f (MHz)' };
  lastSweep = null;
}
let lastSweep = null;
function markX() { return S.type === 'array' ? S.array.steer : S.f; }
function sweepPoint(J, i) {
  const x = J.xs[i], t = J.t, P = S[t];
  if (t === 'array') {
    const s = scale(), d = P.d * s, beta = -TAU * d * Math.sin(x * Math.PI / 180);
    const c = Math.floor((P.N - 1) / 2);
    const Z = em.dipoleZsin(P.Le * s, P.a * s).Zin.slice();
    for (let n = 0; n < P.N; n++) { if (n === c) continue; const Zm = em.mutualZsin(P.Le * s, P.Le * s, Math.abs(n - c) * d), r = [Math.cos((n - c) * beta), Math.sin((n - c) * beta)]; Z[0] += Zm[0] * r[0] - Zm[1] * r[1]; Z[1] += Zm[0] * r[1] + Zm[1] * r[0]; }
    return Z;
  }
  const s = x / F0;
  if (t === 'hertz') return [2 * Math.PI / 3 * em.ETA * (P.dl * s) ** 2, NaN];
  if (t === 'dipole') {
    if (P.model === 'mom') { const L = P.L * s; return em.solveWires([{ x: 0, y: 0, zc: 0, h: L / 2, a: P.a * s, n: Math.max(16, 2 * Math.round(L * 20)), V: 1 }]).Zin; }
    return em.dipoleZsin(P.L * s, P.a * s).Zin;
  }
  if (t === 'loop') return em.solveLoop(P.C * s / TAU, P.a * s, 30).Zin;
  const W = [{ x: -P.sr * s, y: 0, zc: 0, h: P.Lr * s / 2, a: P.a * s, n: 10, V: 0 }, { x: 0, y: 0, zc: 0, h: P.Ld * s / 2, a: P.a * s, n: 10, V: 1 }];
  for (let i2 = 0; i2 < P.nd; i2++) W.push({ x: (i2 + 1) * P.sd * s, y: 0, zc: 0, h: P.Lz * s / 2, a: P.a * s, n: 10, V: 0 });
  return em.solveWires(W).Zin;
}
function sweepStep(now) {
  const J = sweepJob, t0 = performance.now();
  while (J.i < J.xs.length && performance.now() - t0 < 6) { const Z = sweepPoint(J, J.i); J.R[J.i] = Z[0]; J.X[J.i] = Z[1]; J.i++; }
  if (J.i >= J.xs.length) { sweepJob = null; lastSweep = { xs: J.xs, R: J.R, X: J.X, xLabel: J.xLabel, mark: markX() }; drawSweep($('sweep'), lastSweep); }
  else if (now - (J.drawn || 0) > 200) { J.drawn = now; drawSweep($('sweep'), { xs: J.xs.slice(0, Math.max(2, J.i)), R: J.R.slice(0, Math.max(2, J.i)), X: J.X.slice(0, Math.max(2, J.i)), xLabel: J.xLabel, mark: J.mark }); }
}

// ── UI ──────────────────────────────────────────────────────────────────────
function touch() { lastInteract = performance.now(); }
function setType(t, fromSaver) {
  S.type = t;
  S.view = DEF[t].view;
  S.cam = { zoom: 1, panX: 0, panY: 0 };
  buildUI();
  dirtyAntenna = true; stats = null;
  if (!fromSaver) syncButtons();
}
function syncButtons() {
  document.querySelectorAll('#types button, #dockTypes button').forEach(b => b.classList.toggle('on', b.dataset.type === S.type));
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  document.querySelectorAll('#fields button').forEach(b => b.classList.toggle('on', b.dataset.field === S.field));
  document.querySelectorAll('#toggles button').forEach(b => b.classList.toggle('on', !!S.tog[b.dataset.tog]));
  $('pauseBtn').textContent = S.playing ? 'Pause' : 'Play';
  $('dockPlay').textContent = S.playing ? '❚❚' : '▶';
  $('slowBtn').classList.toggle('on', S.slow);
  $('typeHint').textContent = DEF[S.type].hint;
  viewHint();
}
function viewHint() {
  const pm = psiMode(), tf = traceField();
  let h = '';
  if (pm === 1) h = 'Field lines: exact E lines, the contours of ρH_φ. Watch closed loops break away near r ≈ λ/4.';
  else if (pm === 2) h = 'Field lines: B lines of the uniform current mode, the contours of ρA_φ. The other modes add ' + (A.nonUniform * 100).toFixed(0) + ' % to the current.';
  else if (pm === 3) h = 'Field lines: exact B lines in this plane, the contours of A_z.';
  else if (tf) h = 'Field lines: traced along the in-plane ' + (tf === 'E' ? 'E' : 'B') + ' field each frame (no flux function exists here).';
  $('viewHint').textContent = h;
}

function buildUI() {
  const D = DEF[S.type], P = S[S.type];
  const box = $('params');
  box.innerHTML = '';
  if (D.models) {
    const r = document.createElement('div');
    r.className = 'row seg-row';
    r.innerHTML = '<label>Current model</label><div class="modes"><button data-m="sin">Sinusoidal</button><button data-m="mom">Moment method</button></div>';
    r._sync = () => r.querySelectorAll('button').forEach(b => b.classList.toggle('on', P.model === b.dataset.m));
    r.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', P.model === b.dataset.m);
      b.onclick = () => { P.model = b.dataset.m; r.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); dirtyAntenna = true; touch(); };
    });
    box.appendChild(r);
  }
  for (const p of D.params) {
    const r = document.createElement('div');
    r.className = 'row';
    const v = P[p.k];
    r.innerHTML = `<label><span class="sci-sym" data-tex="${p.tex}" data-inline></span> <span class="w">${p.word}</span></label><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.log ? Math.log10(v) : v}"><span class="val"></span>`;
    const inp = r.querySelector('input'), val = r.querySelector('.val');
    const show = () => { val.textContent = p.fmt(P[p.k]) + (p.fmt === lam ? '  ' + (P[p.k] * 100).toFixed(0) + ' cm' : ''); };
    show();
    inp.oninput = () => {
      const x = +inp.value;
      P[p.k] = p.log ? Math.pow(10, x) : x;
      if (S.type === 'array') arrayLink(p.k);
      show(); dirtyAntenna = true; touch();
    };
    r._sync = () => { inp.value = p.log ? Math.log10(P[p.k]) : P[p.k]; show(); };
    box.appendChild(r);
  }
  const pr = $('presets');
  pr.innerHTML = '';
  for (const [name, patch] of D.presets) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { applyPatch(patch); touch(); };
    pr.appendChild(b);
  }
  typesetAll(box, window.AF_RULES || null).catch(() => {});
  syncButtons();
}
function applyPatch(patch) {
  const P = S[S.type];
  Object.assign(P, patch);
  if (S.type === 'array') { if ('steer' in patch && !('beta' in patch)) arrayLink('steer'); else if ('beta' in patch) arrayLink('beta'); }
  $('params').querySelectorAll('.row').forEach(r => r._sync && r._sync());
  dirtyAntenna = true;
}
// Steering angle and phase step are two views of one number.
function arrayLink(k) {
  const P = S.array;
  if (k === 'steer' || k === 'd') P.beta = Math.max(-180, Math.min(180, -360 * P.d * Math.sin(P.steer * Math.PI / 180)));
  else if (k === 'beta') { const sn = -P.beta / (360 * P.d); if (Math.abs(sn) <= 1) P.steer = Math.asin(sn) * 180 / Math.PI; }
  $('params').querySelectorAll('.row').forEach(r => r._sync && r._sync());
}

function wireUI() {
  document.querySelectorAll('#types button, #dockTypes button').forEach(b => b.onclick = () => { setType(b.dataset.type); touch(); });
  document.querySelectorAll('#views button').forEach(b => b.onclick = () => { S.view = b.dataset.view; S.cam.panY = 0; syncButtons(); lastKey = ''; touch(); computeStats(); });
  document.querySelectorAll('#fields button').forEach(b => b.onclick = () => { S.field = b.dataset.field; syncButtons(); normalise(); });
  document.querySelectorAll('#toggles button').forEach(b => b.onclick = () => { S.tog[b.dataset.tog] = !S.tog[b.dataset.tog]; syncButtons(); lastKey = ''; });
  const freq = $('freq'), fv = () => { $('freqV').textContent = S.f.toFixed(0) + ' MHz · λ = ' + lambdaM().toFixed(2) + ' m'; };
  freq.oninput = () => { S.f = +freq.value; fv(); dirtyAntenna = true; touch(); };
  fv();
  const gain = $('gain'), gv = () => { $('gainV').textContent = (S.exposure >= 0 ? '+' : '') + S.exposure.toFixed(1) + ' EV'; };
  gain.oninput = () => { S.exposure = +gain.value; gv(); normalise(); };
  gv();
  const sp = $('speed'), sv = () => { $('speedV').textContent = S.speed.toFixed(2); };
  sp.oninput = () => { S.speed = +sp.value; sv(); };
  sv();
  const play = () => { S.playing = !S.playing; syncButtons(); };
  $('pauseBtn').onclick = play; $('dockPlay').onclick = play;
  $('slowBtn').onclick = () => { S.slow = !S.slow; syncButtons(); };
  $('stepBtn').onclick = () => { S.playing = false; S.phase += TAU / 16; syncButtons(); };
  // phone sheet
  const panel = $('panel');
  $('dockPanel').onclick = () => { panel.classList.toggle('open'); sheetSync(); };
  let gy = null;
  const grip = $('sheetGrip');
  grip.addEventListener('pointerdown', e => { gy = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (gy == null) return;
    const d = e.clientY - gy; gy = null;
    if (Math.abs(d) < 8) panel.classList.toggle('full');
    else if (d > 60) { if (panel.classList.contains('full')) panel.classList.remove('full'); else panel.classList.remove('open'); }
    else if (d < -60) panel.classList.add('full');
    sheetSync();
  });
  window.addEventListener('af-layout', () => { lastKey = ''; });
  phoneMQ.addEventListener('change', placeCards);
  window.addEventListener('resize', () => { lastKey = ''; placeCards(); });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); play(); }
  });
}
function sheetSync() {
  const open = $('panel').classList.contains('open');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  touch();
  if (open) setTimeout(() => { lobe && lobe.resize(); lastSweep && drawSweep($('sweep'), lastSweep); lastCuts && drawPolar($('polar'), lastCuts); }, 320);
}
// On a phone the result cards live in the sheet; on a desktop in #side.
function placeCards() {
  const target = phoneMQ.matches ? $('sheetResults') : $('side');
  for (const id of ['cardRead', 'cardPolar', 'cardLobe', 'cardSweep']) { const c = $(id); if (c.parentElement !== target) target.appendChild(c); }
  setTimeout(() => { lobe && lobe.resize(); lastCuts && drawPolar($('polar'), lastCuts); lastSweep && drawSweep($('sweep'), lastSweep); }, 50);
}
let lobeVisible = true;

// ── pointer: pan, zoom, probe ────────────────────────────────────────────────
function pointer() {
  const ptrs = new Map();
  let pinch0 = null, moved = false;
  const toPlane = (x, y) => [view.u0 + x / fieldCanvas.clientWidth * (view.u1 - view.u0), view.v1 - y / fieldCanvas.clientHeight * (view.v1 - view.v0)];
  fieldCanvas.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    fieldCanvas.setPointerCapture(e.pointerId);
    fieldCanvas.classList.add('drag'); moved = false;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: S.cam.zoom }; }
    $('hint').classList.add('gone');
  });
  fieldCanvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse') showProbe(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()];
      S.cam.zoom = Math.max(0.15, Math.min(6, pinch0.zoom * pinch0.d / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))));
    } else if (ptrs.size === 1) {
      const mPerPx = (view.u1 - view.u0) / fieldCanvas.clientWidth / scale();
      S.cam.panX -= dx * mPerPx; S.cam.panY += dy * mPerPx;
    }
    touch();
    $('probe').classList.add('off');
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = null;
    if (!ptrs.size) fieldCanvas.classList.remove('drag');
    if (!moved && e.pointerType !== 'mouse') showProbe(e.clientX, e.clientY);
  };
  fieldCanvas.addEventListener('pointerup', up);
  fieldCanvas.addEventListener('pointercancel', up);
  fieldCanvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') $('probe').classList.add('off'); });
  fieldCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const k = Math.exp(e.deltaY * 0.0015), z = Math.max(0.15, Math.min(6, S.cam.zoom * k)), kk = z / S.cam.zoom;
    // Keep the point under the cursor in place: C' = P + (C - P) k.
    const P = toPlane(e.clientX, e.clientY), s = scale();
    const uc = (centreM() + S.cam.panX) * s, vc = S.cam.panY * s;
    S.cam.panX += (P[0] - uc) * (1 - kk) / s;
    S.cam.panY += (P[1] - vc) * (1 - kk) / s;
    S.cam.zoom = z;
    touch();
  }, { passive: false });
  fieldCanvas.addEventListener('dblclick', () => { S.cam = { zoom: 1, panX: 0, panY: 0 }; touch(); });
  const out = new Float64Array(18);
  function showProbe(x, y) {
    if (!A) return;
    const [u, v] = toPlane(x, y);
    const p = S.view === 'side' ? [u, 0, v] : [u, v, 0];
    em.fieldAt(A.elems, p[0], p[1], p[2], out);
    const lm = lambdaM();
    const Em = Math.hypot(...out.slice(0, 6)) / lm, Hm = Math.hypot(...out.slice(6, 12)) / lm;
    const E = [[out[0], out[1]], [out[2], out[3]], [out[4], out[5]]], H = [[out[6], out[7]], [out[8], out[9]], [out[10], out[11]]];
    const cr = (X, Y) => [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    const a1 = cr(E.map(z => z[0]), H.map(z => z[0])), a2 = cr(E.map(z => z[1]), H.map(z => z[1]));
    const Sm = 0.5 * Math.hypot(a1[0] + a2[0], a1[1] + a2[1], a1[2] + a2[2]) / (lm * lm);
    const r = Math.hypot(p[0] - centreM() * scale(), p[1], p[2]), kr = TAU * r;
    const zr = zoneRadii(A.extent), zone = r < zr.rNear ? 'reactive near field' : r < zr.rFar ? 'radiating near field' : 'far field';
    const el = $('probe');
    el.innerHTML = `<b>r</b> ${(r * lm).toFixed(3)} m = ${r.toFixed(3)} λ · kr ${kr.toFixed(2)}<br><b>|E|</b> ${fmtSI(Em, 'V/m')}  <b>|H|</b> ${fmtSI(Hm, 'A/m')}<br><b>⟨S⟩</b> ${fmtSI(Sm, 'W/m²')} · ${zone}`;
    el.classList.remove('off');
    const bw = el.offsetWidth, bh = el.offsetHeight;
    el.style.left = Math.min(innerWidth - bw - 8, x + 14) + 'px';
    el.style.top = Math.max(8, Math.min(innerHeight - bh - 8, y - bh - 10)) + 'px';
  }
}
function fmtSI(v, u) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e3) return (v / 1e3).toFixed(2) + ' k' + u;
  if (a >= 1) return v.toFixed(2) + ' ' + u;
  if (a >= 1e-3) return (v * 1e3).toFixed(2) + ' m' + u;
  return (v * 1e6).toFixed(2) + ' µ' + u;
}

// ── start ───────────────────────────────────────────────────────────────────
function fail(msg) {
  const f = $('fail');
  f.innerHTML = '<b>The field view did not start.</b><br>' + msg + '<br>The currents, the pattern and the readouts still work.';
  f.classList.remove('off');
}
wireUI();
pointer();
buildUI();
placeCards();
sheetSync();
if (phoneMQ.matches) { $('panel').classList.remove('open'); sheetSync(); }
try { field = createField(fieldCanvas); }
catch (e) { console.error('[antenna-fields]', e); fail(e.message); }
if (!field) { rebuild(); computeStats(); }
requestAnimationFrame(frame);
setTimeout(() => $('hint').classList.add('gone'), 6000);

// The 3D card loads three.js after the field is up.
import('./lobe.js').then(m => {
  try {
    lobe = m.createLobe({ canvas: $('lobe') });
    lobe.resize();
    if (lastGrid && A) lobe.update(lastGrid.U, lastGrid.nt, lastGrid.np, A.wires, A.extent);
    new ResizeObserver(() => lobe.resize()).observe($('lobeWrap'));
    const io = new IntersectionObserver(es => { lobeVisible = es[0].isIntersecting; });
    io.observe($('lobeWrap'));
  } catch (e) { console.error('[antenna-fields] lobe', e); }
  window.__afLobeModule = m;
}).catch(e => console.error('[antenna-fields] three.js', e));

window.addEventListener('pagehide', () => { try { field && field.destroy(); lobe && lobe.dispose(); } catch (e) { /* gone */ } });

// ── context for the saver and for checks ────────────────────────────────────
const ctx = {
  S, DEF, em, get A() { return A; }, get stats() { return stats; }, get field() { return field; }, canvas: fieldCanvas,
  setType: t => setType(t, true), applyPatch, syncUI: () => { buildUI(); syncButtons(); }, rebuildNow: () => { rebuild(); computeStats(); },
  invalidate: () => { lastKey = ''; }, scale, lambdaM, extentM, centreM,
  ensureSharedLobe: async () => {
    if (lobeShared || !field) return lobeShared;
    const m = window.__afLobeModule || await import('./lobe.js');
    lobeShared = m.createLobe({ canvas: fieldCanvas, gl: field.gl, orbit: false });
    if (lastGrid && A) lobeShared.update(lastGrid.U, lastGrid.nt, lastGrid.np, A.wires, A.extent);
    return lobeShared;
  },
};
installSaver(ctx);
window.__af = {
  ctx,
  debug: () => ({ type: S.type, view: S.view, field: S.field, n: A ? A.elems.n : 0, Z: A ? A.Zin : null, D: stats ? +stats.Ddb.toFixed(3) : null, fb: stats ? +stats.fb.toFixed(2) : null,
    phasor: timing.res, phasorMs: +timing.phasorMs.toFixed(1), gain: norm.gain, psi: psiMode(), saver: window.snSaver && window.snSaver.debug ? window.snSaver.debug() : null }),
  set: (t, patch, more) => { setType(t); if (patch) applyPatch(patch); if (more) { Object.assign(S, more); syncButtons(); } lastKey = ''; },
};
