// ============================================================================
//  ANTENNA FIELDS  ·  main.js — state, the bar, the drawer, the frame loop
// ----------------------------------------------------------------------------
//  ES module. em.js gives the currents and the numbers, field-gl.js the GPU
//  field, overlay.js the 2D layer, plots.js the one pattern cut in the
//  drawer, saver.js the screensaver hook.
//
//  The page is the field. One bar holds the antenna, one slider, the field
//  (E, B, power flow), speed, play and the Details button. The drawer holds
//  the numbers in plain words, the cut, the options and the equations.
//
//  UNITS. Physics runs in wavelengths. The view and the drawer show metres.
//  The half-wave dipole and the Yagi-Uda are built for 300 MHz (lambda0 =
//  1 m); their slider is the frequency, so the metal keeps its size and the
//  electrical length changes. The other antennas run at 300 MHz and their
//  slider is a length in wavelengths, or the steering angle.
//
//  PIPELINE.
//    rebuild()  state -> em.buildAntenna -> GPU elements; the numbers later
//    frame()    phase, framing (clearRect), the phasor pass when the view or
//               the antenna changed (low resolution while the user drags),
//               the probe grid, the overlay, the display pass
//
//  grep -n: "const TYPES"  "function rebuild"  "function frame"
//           "function clearRect"  "function details"  "function pointer"
// ============================================================================
import * as em from './em.js';
import { createField } from './field-gl.js';
import { mapper, inPlane, traceLines, drawOverlay } from './overlay.js';
import { drawPolar } from './plots.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const F0 = 300, TAU = 2 * Math.PI;
const phoneMQ = window.matchMedia('(max-width:760px)');

// ── the five antennas and their one slider ──────────────────────────────────
// p: the state key, min, max, step, label, fmt. zoom: default half height of
// the view in metres. view: the plane the page shows at first.
const TYPES = {
  dipole:   { name: 'Dipole', view: 'side', zoom: 1.5, p: { k: 'L', min: 0.1, max: 2, step: 0.01, lab: 'Length', fmt: v => v.toFixed(2) + ' λ' } },
  halfwave: { name: 'Half-wave dipole', view: 'side', zoom: 1.3, p: { k: 'f', min: 150, max: 600, step: 1, lab: 'Frequency', fmt: v => v.toFixed(0) + ' MHz' } },
  loop:     { name: 'Loop', view: 'side', zoom: 1.2, p: { k: 'C', min: 0.05, max: 1.6, step: 0.01, lab: 'Circumference', fmt: v => v.toFixed(2) + ' λ' } },
  array:    { name: 'Phased array', view: 'top', zoom: 2.6, p: { k: 'steer', min: -60, max: 60, step: 1, lab: 'Steering', fmt: v => v.toFixed(0) + '°' } },
  yagi:     { name: 'Yagi-Uda', view: 'top', zoom: 2.4, p: { k: 'f', min: 240, max: 360, step: 1, lab: 'Frequency', fmt: v => v.toFixed(0) + ' MHz' } },
};

const S = {
  type: 'halfwave',
  dipole: { L: 1.25, model: 'sin' },
  halfwave: { f: 300, model: 'sin' },
  loop: { C: 0.15 },
  array: { steer: 25, N: 8, d: 0.5 },
  yagi: { f: 300, nd: 4 },
  hertz: { dl: 0.05 },          // the screensaver only
  view: 'side', field: 'E',
  tog: { lines: true, zones: false, log: false },
  speed: 0.4, speedK: 1, playing: true, phase: 0,
  cam: { zoom: 1, panX: 0, panY: 0 },
  saver: false, band: null, fade: 1, saverTick: null,
};

let A = null, stats = null, field = null;
let dirtyAntenna = true, statsTimer = 0, lastInteract = -1e9, refineDue = false, lastStatsAt = -1e9;
let probe = null, norm = { gain: 1, psiScale: 1 }, lastKey = '', lineBuf = null, lineRef = null;
const fieldCanvas = $('field'), overlay = $('overlay'), octx = overlay.getContext('2d');

// Frequency of the current antenna, MHz, and its wavelength in metres.
function freq() { return S.type === 'halfwave' || S.type === 'yagi' ? S[S.type].f : F0; }
function scale() { return freq() / F0; }
function lambdaM() { return 300 / freq(); }
function electrical() {
  const s = scale(), t = S.type, P = S[t];
  if (t === 'dipole') return { type: 'dipole', L: P.L, a: 0.001, model: P.model, budget: 300 };
  if (t === 'halfwave') return { type: 'dipole', L: 0.5 * s, a: 0.001 * s, model: P.model, budget: 300 };
  if (t === 'loop') return { type: 'loop', C: P.C, a: 0.001, modes: 40, budget: 300 };
  if (t === 'hertz') return { type: 'hertz', dl: P.dl };
  if (t === 'array') return { type: 'array', N: P.N, d: P.d, beta: -TAU * P.d * Math.sin(P.steer * Math.PI / 180), Le: 0.5, a: 0.001, budget: 300 };
  return { type: 'yagi', nd: P.nd, Lr: 0.495 * s, Ld: 0.47 * s, Lz: 0.44 * s, sr: 0.2 * s, sd: 0.25 * s, a: 0.001 * s, budget: 300 };
}
// Centre and size of the metal, in metres.
function centreM() { return S.type === 'yagi' ? (S.yagi.nd * 0.25 - 0.2) / 2 : 0; }
function extentM() {
  const t = S.type, P = S[t];
  if (t === 'dipole') return P.L;
  if (t === 'halfwave') return 0.5;
  if (t === 'loop') return P.C / Math.PI;
  if (t === 'array') return (P.N - 1) * P.d + 0.5;
  if (t === 'yagi') return 0.2 + P.nd * 0.25 + 0.5;
  return 0.3;
}

// ── rebuild ──────────────────────────────────────────────────────────────────
function rebuild() {
  dirtyAntenna = false;
  A = em.buildAntenna(electrical());
  if (field) {
    let soft = 0.004;
    if (A.elems.n > 1) { const D = A.elems.d; soft = Math.max(0.003, Math.min(0.02, 0.6 * Math.hypot(D[8] - D[0], D[9] - D[1], D[10] - D[2]))); }
    field.setElems(A.elems, soft);
  }
  lastKey = '';
  scheduleStats();
  caption();
}
// The pattern integral costs 5 to 40 ms: it waits for a pause in a drag,
// and in the screensaver it runs at most every 600 ms.
function scheduleStats() {
  const now = performance.now();
  if (S.saver) {
    if (!statsTimer) statsTimer = setTimeout(() => { statsTimer = 0; computeStats(); }, Math.max(0, 600 - (now - lastStatsAt)));
    return;
  }
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => { statsTimer = 0; computeStats(); }, now - lastInteract < 300 ? 160 : 0);
}
function computeStats() {
  if (!A) return;
  lastStatsAt = performance.now();
  stats = em.patternStats(A.elems, { nt: 64, np: 128 });
  if (!S.saver && $('details').classList.contains('open')) details();
}

// ── framing ─────────────────────────────────────────────────────────────────
// The part of the window that the bar and the drawer do not cover (CSS px).
function clearRect() {
  const W = innerWidth, H = innerHeight;
  if (S.saver) {
    const b = S.band, wc = b && b.w ? b.w : W;
    return { x: (W - wc) / 2, y: b ? b.t : 0, w: wc, h: H - (b ? b.t + b.b : 0) };
  }
  let r = W, btm = H, t = 0;
  const bar = $('bar').getBoundingClientRect();
  btm = Math.min(btm, bar.top - 6);
  const det = $('details');
  if (det.classList.contains('open')) {
    const d = det.getBoundingClientRect();
    if (phoneMQ.matches) btm = Math.min(btm, d.top); else r = Math.min(r, d.left);
  }
  const cap = $('caption').getBoundingClientRect();
  if (cap.height) t = cap.bottom + 4;
  return { x: 0, y: t, w: Math.max(40, r), h: Math.max(40, btm - t) };
}
const view = { u0: -2, v0: -1, u1: 2, v1: 1 };
function updateView(cr) {
  const W = fieldCanvas.clientWidth || innerWidth, H = fieldCanvas.clientHeight || innerHeight;
  const half = Math.max(TYPES[S.type] ? TYPES[S.type].zoom : 1.2, extentM() * 0.75) * S.cam.zoom;
  const s = scale(), ppx = 2 * half * s / Math.min(cr.w, cr.h * 1.25);
  const uc = (centreM() + S.cam.panX) * s, vc = S.cam.panY * s;
  const ccx = cr.x + cr.w / 2, ccy = cr.y + cr.h / 2;
  view.u0 = uc - ccx * ppx; view.u1 = view.u0 + W * ppx;
  view.v1 = vc + ccy * ppx; view.v0 = view.v1 - H * ppx;
  if (field) {
    const fv = field.view;
    Object.assign(fv, { u0: view.u0, u1: view.u1, v0: view.v0, v1: view.v1 });
    fv.axU = [1, 0, 0]; fv.axV = S.view === 'side' ? [0, 0, 1] : [0, 1, 0];
    fv.centre = [centreM() * s, 0, 0];
    fv.psi = psiMode();
  }
  return [view.u0, view.v0, view.u1, view.v1].map(v => v.toFixed(5)).join(',') + '|' + S.view + '|' + fieldCanvas.width + 'x' + fieldCanvas.height + '|' + S.tog.lines;
}
function psiMode() {
  if (!A || !S.tog.lines) return 0;
  const k = S.view === 'side' ? A.psi.side : A.psi.top;
  return k === 'E' ? 1 : k === 'Bloop' ? 2 : k === 'B' ? 3 : 0;
}
function traceField() {
  if (!A || !S.tog.lines || psiMode()) return null;
  if (A.wires.length === 1 && S.type === 'loop') return S.view === 'side' ? 'H' : 'E';
  return S.view === 'side' ? 'E' : 'H';
}
// What the colour shows: a signed axis [x, y, z, 0] or the in-plane size [.., 1].
function compSpec() {
  const loop = S.type === 'loop', side = S.view === 'side', E = S.field === 'E';
  if (!loop) return side ? (E ? [0, 0, 1, 0] : [0, 1, 0, 0]) : (E ? [0, 0, 1, 0] : [0, 0, 0, 1]);
  return side ? (E ? [0, 1, 0, 0] : [0, 0, 1, 0]) : (E ? [0, 0, 0, 1] : [0, 0, 1, 0]);
}

// ── normalisation from the probe grid ────────────────────────────────────────
function percentile(arr, q) {
  const a = arr.filter(v => isFinite(v) && v > 0).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 1;
}
function rRef() { return 0.25 * (view.v1 - view.v0); }
function normalise() {
  if (!probe) return;
  const { w, h, T } = probe, c = compSpec(), rref = rRef(), cen = centreM() * scale();
  const vals = [], svals = [], pvals = [];
  const isH = S.field === 'H', axV = S.view === 'side' ? 2 : 1;
  for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2) {
    const q = (j * w + i) * 4;
    const u = view.u0 + (i + 0.5) / w * (view.u1 - view.u0), v = view.v0 + (j + 0.5) / h * (view.v1 - view.v0);
    const wr = Math.max(Math.hypot(u - cen, v), 0.12) / rref;
    const E = [[T[0][q], T[0][q + 1]], [T[0][q + 2], T[0][q + 3]], [T[1][q], T[1][q + 1]]];
    const Hh = [[T[1][q + 2], T[1][q + 3]], [T[2][q], T[2][q + 1]], [T[2][q + 2], T[2][q + 3]]];
    const F = isH ? Hh : E;
    const m = c[3] ? Math.hypot(F[0][0], F[0][1], F[axV][0], F[axV][1]) : Math.hypot(...F[c[0] ? 0 : c[1] ? 1 : 2]);
    vals.push(m * wr);
    const cr = (X, Y) => [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    const a1 = cr(E.map(z => z[0]), Hh.map(z => z[0])), a2 = cr(E.map(z => z[1]), Hh.map(z => z[1]));
    svals.push(0.5 * Math.hypot(a1[0] + a2[0], a1[1] + a2[1], a1[2] + a2[2]) * wr * wr);
    pvals.push(Math.hypot(T[3][q], T[3][q + 1]));
  }
  // Power flow is shown on a log scale; E and B on a soft linear scale.
  norm.gain = S.field === 'S' ? 0.3 / percentile(svals, 0.88) : (S.tog.log ? 0.45 : 0.85) / percentile(vals, 0.9);
  const pm = psiMode();
  norm.psiScale = pm === 3 ? 1 / (percentile(pvals, 0.5) * 0.6) : (pm === 2 ? 3.5 : 4) / percentile(pvals, 0.88);
  lineRef = null;
}

// ── canvases and the frame loop ─────────────────────────────────────────────
function resize() {
  const d = Math.min(window.devicePixelRatio || 1, phoneMQ.matches ? 2 : 1.5);
  const W = Math.max(2, Math.round(innerWidth * d)), H = Math.max(2, Math.round(innerHeight * d));
  if (fieldCanvas.width !== W || fieldCanvas.height !== H) { fieldCanvas.width = W; fieldCanvas.height = H; }
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
}
function zoneRadii(D) {
  // reactive near field inside max(lambda/2pi, 0.62 sqrt(D^3/lambda));
  // far field beyond max(2D^2/lambda, 2D, lambda). In wavelengths.
  return { rNear: Math.max(1 / TAU, 0.62 * Math.sqrt(D * D * D)), rFar: Math.max(2 * D * D, 2 * D, 1) };
}
let last = performance.now(), computeFailed = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.saverTick) S.saverTick(dt);
  if (S.playing) S.phase = (S.phase + TAU * S.speed * S.speedK * dt) % (TAU * 1000);
  if (dirtyAntenna) rebuild();
  // gpu-guard loses every context when the shell releases the page; a lost
  // context reports FRAMEBUFFER_UNSUPPORTED, so stop drawing here.
  if (!field || field.gl.isContextLost()) return;
  resize();
  const cr = clearRect(), key = updateView(cr);
  const interacting = now - lastInteract < 180;
  if (key !== lastKey) { computePhasors(interacting ? 0.5 : 1); lastKey = key; refineDue = interacting; }
  else if (refineDue && !interacting) { computePhasors(1); refineDue = false; }
  const W = fieldCanvas.width, H = fieldCanvas.height, dpr = W / Math.max(1, fieldCanvas.clientWidth || innerWidth);
  const tf = traceField();
  let lines = null;
  if (tf && probe) {
    lineBuf = inPlane(probe, tf, S.phase, [1, 0, 0], S.view === 'side' ? [0, 0, 1] : [0, 1, 0], lineBuf);
    if (lineRef == null) { const m = []; for (let i = 0; i < lineBuf.length; i += 14) m.push(Math.hypot(lineBuf[i], lineBuf[i + 1])); lineRef = percentile(m, 0.75) * 1.4; }
    lines = { list: traceLines(lineBuf, probe.w, probe.h, { seedStep: phoneMQ.matches ? 7 : 6.5, steps: 44, ds: 0.5 }), gw: probe.w, gh: probe.h, ref: lineRef,
      color: tf === 'E' ? 'rgba(225,245,255,A)' : 'rgba(225,215,255,A)' };
  }
  drawOverlay(octx, {
    W, H, dpr, view, map: mapper(view, W, H), wires: A ? A.wires : [], plane: S.view, phase: S.phase,
    centre: [centreM() * scale(), 0],
    zones: Object.assign({ on: S.tog.zones, lambdaM: lambdaM() }, zoneRadii(A ? A.extent : 0)),
    lines, feed: S.type === 'loop' ? [S.loop.C / TAU, 0, 0] : [0, 0, 0],
    scaleBox: S.saver ? null : { x: 16 * dpr, y: (cr.y + cr.h - 10) * dpr, lambdaM: lambdaM() },
  });
  if (S.saver) field.uploadOverlay(overlay);
  field.draw({
    phase: S.phase, mode: { E: 0, H: 1, S: 2 }[S.field], comp: compSpec(), gain: norm.gain, log: S.field === 'S' || S.tog.log, rcomp: true,
    rref: rRef(), psiOn: psiMode() > 0, psiScale: norm.psiScale, psiLog: psiMode() === 3, lineAlpha: 0.75,
    grid: 0, overlay: S.saver, fade: S.fade,
  });
}
function computePhasors(q) {
  const n = A ? A.elems.n : 1, px = fieldCanvas.width * fieldCanvas.height;
  const sc = Math.min(1, Math.max(0.22, Math.sqrt(2.4e8 / (n * px)))) * q;
  try { field.compute(sc); }
  catch (e) { if (!computeFailed) console.error('[antenna-fields] phasor pass', e); computeFailed = true; return; }
  const pw = phoneMQ.matches ? 120 : 176, ph = Math.max(24, Math.round(pw * fieldCanvas.height / fieldCanvas.width));
  probe = field.readProbe(pw, ph);
  normalise();
}

// ── caption and the drawer ───────────────────────────────────────────────────
const FIELD_WORDS = { E: 'Electric field', H: 'Magnetic field', S: 'Power flow' };
function caption() {
  if (S.saver) return;
  $('caption').innerHTML = `<b>${TYPES[S.type] ? TYPES[S.type].name : ''}</b> · ${FIELD_WORDS[S.field]} · seen from ${S.view === 'side' ? 'the side' : 'above'}`;
}
const fz = Z => !Z || !isFinite(Z[0]) ? 'very large' : Z[0].toFixed(1) + (isFinite(Z[1]) ? (Z[1] < 0 ? ' − j' : ' + j') + Math.abs(Z[1]).toFixed(1) : '') + ' Ω';
function details() {
  if (!A) return;
  const t = S.type, pm = psiMode(), tf = traceField();
  const lineWord = pm === 1 ? 'The white lines are electric field lines. They are exact here, and you can see closed loops break away from the wire.'
    : pm === 2 ? 'The white lines are magnetic field lines of the loop\'s uniform current (the other current modes add ' + (A.nonUniform * 100).toFixed(0) + ' %).'
    : pm === 3 ? 'The white lines are magnetic field lines in this plane. They are exact.'
    : tf ? 'The faint lines follow the ' + (tf === 'E' ? 'electric' : 'magnetic') + ' field direction, traced again each frame.' : '';
  const colour = S.field === 'S' ? 'Brightness shows how much power flows through each point, on a log scale.'
    : 'Orange and cyan are opposite directions of the ' + (S.field === 'E' ? 'electric' : 'magnetic') + ' field. The bands move outward at the speed of light.';
  $('what').textContent = colour + ' ' + lineWord + ' Brightness grows with distance to cancel the 1/r fall-off, so the far wavefronts stay visible.';
  const rows = [['Frequency', freq().toFixed(0) + ' MHz (wavelength ' + lambdaM().toFixed(2) + ' m)']];
  if (t === 'dipole') rows.push(['Length', S.dipole.L.toFixed(2) + ' wavelengths']);
  if (t === 'halfwave') rows.push(['Length', (0.5 * scale()).toFixed(3) + ' wavelengths (0.50 m)']);
  if (t === 'loop') rows.push(['Circumference', S.loop.C.toFixed(2) + ' wavelengths']);
  if (t === 'array') rows.push(['Elements', S.array.N + ', half a wavelength apart']);
  if (t === 'yagi') rows.push(['Elements', (S.yagi.nd + 2) + ': reflector, driven, ' + S.yagi.nd + ' directors']);
  rows.push([t === 'array' ? 'Impedance of the centre element' : 'Input impedance', fz(A.Zin)]);
  if (stats) {
    rows.push(['Gain', stats.Ddb.toFixed(1) + ' dBi (' + stats.D.toFixed(2) + ' × an isotropic source)']);
    const bw = [stats.hpbwE, stats.hpbwH].filter(isFinite);
    rows.push(['Beam width (half power)', bw.length ? bw.map(v => v.toFixed(0) + '°').join(' and ') : 'all round']);
    if (t === 'yagi') rows.push(['Front to back', stats.fb.toFixed(1) + ' dB']);
    if (t === 'array') rows.push(['Beam direction', (Math.atan2(stats.dir[0], Math.abs(stats.dir[1])) * 180 / Math.PI).toFixed(0) + '° from broadside']);
    rows.push(['Radiated power at 1 A', stats.P.toFixed(stats.P < 1 ? 3 : 1) + ' W']);
  }
  rows.push(['How the currents are found', A.note ? (t === 'yagi' ? 'moment method, ' : t === 'loop' ? 'Fourier modes, ' : t === 'array' ? '' : 'moment method, ') + A.note : (t === 'array' ? 'equal currents, progressive phase' : 'sinusoidal current (textbook)')]);
  $('nums').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  // one cut: the plane on screen
  const side = S.view === 'side', n = 360;
  const cut = em.patternCut(A.elems, [1, 0, 0], side ? [0, 0, 1] : [0, 1, 0], n);
  drawPolar($('polar'), side ? { side: cut, sideX: 'x', upLabel: 'z' } : { top: cut, sideX: 'x', upLabel: 'y' });
  $('polarNote').textContent = 'Gain around the antenna in the plane on screen, 0 to −30 dB. The shape is the same at every distance in the far field.';
  options();
}
function options() {
  const o = $('opts');
  const items = [
    ['View from the side', () => S.view === 'side', () => { S.view = 'side'; }],
    ['View from above', () => S.view === 'top', () => { S.view = 'top'; }],
    ['Field lines', () => S.tog.lines, () => { S.tog.lines = !S.tog.lines; }],
    ['Near and far zones', () => S.tog.zones, () => { S.tog.zones = !S.tog.zones; }],
    ['Log brightness', () => S.tog.log, () => { S.tog.log = !S.tog.log; }],
  ];
  if (S.type === 'dipole' || S.type === 'halfwave') items.push(['Moment method current', () => S[S.type].model === 'mom', () => { const P = S[S.type]; P.model = P.model === 'mom' ? 'sin' : 'mom'; dirtyAntenna = true; }]);
  if (S.type === 'array') items.push(['16 elements', () => S.array.N === 16, () => { S.array.N = S.array.N === 16 ? 8 : 16; dirtyAntenna = true; }]);
  if (S.type === 'yagi') items.push(['8 directors', () => S.yagi.nd === 8, () => { S.yagi.nd = S.yagi.nd === 8 ? 4 : 8; dirtyAntenna = true; }]);
  o.innerHTML = '';
  for (const [label, on, act] of items) {
    const b = document.createElement('button');
    b.textContent = label; b.classList.toggle('on', on());
    b.onclick = () => { act(); lastKey = ''; caption(); touch(); if (!dirtyAntenna) details(); else setTimeout(details, 50); };
    o.appendChild(b);
  }
}

// ── the bar ───────────────────────────────────────────────────────────────────
function touch() { lastInteract = performance.now(); }
function setType(t) {
  S.type = t;
  if (TYPES[t]) S.view = TYPES[t].view;
  S.cam = { zoom: 1, panX: 0, panY: 0 };
  stats = null;
  dirtyAntenna = true;
  syncBar();
}
function syncBar() {
  document.querySelectorAll('#types button').forEach(b => b.classList.toggle('on', b.dataset.type === S.type));
  document.querySelectorAll('#fields button').forEach(b => b.classList.toggle('on', b.dataset.field === S.field));
  $('play').textContent = S.playing ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  $('speed').textContent = S.speedK === 1 ? '1×' : S.speedK === 0.5 ? '½×' : '¼×';
  const T = TYPES[S.type];
  if (T) {
    const p = T.p, inp = $('paramIn');
    inp.min = p.min; inp.max = p.max; inp.step = p.step; inp.value = S[S.type][p.k];
    $('paramLab').textContent = p.lab;
    $('paramVal').textContent = p.fmt(S[S.type][p.k]);
  }
  caption();
  if ($('details').classList.contains('open')) details();
}
function wireBar() {
  document.querySelectorAll('#types button').forEach(b => b.onclick = () => { setType(b.dataset.type); touch(); });
  document.querySelectorAll('#fields button').forEach(b => b.onclick = () => { S.field = b.dataset.field; syncBar(); normalise(); });
  $('paramIn').oninput = () => {
    const p = TYPES[S.type].p;
    S[S.type][p.k] = +$('paramIn').value;
    $('paramVal').textContent = p.fmt(S[S.type][p.k]);
    dirtyAntenna = true; touch();
  };
  const play = () => { S.playing = !S.playing; syncBar(); };
  $('play').onclick = play;
  $('speed').onclick = () => { S.speedK = S.speedK === 1 ? 0.5 : S.speedK === 0.5 ? 0.25 : 1; syncBar(); };
  const det = $('details');
  const setDet = open => { det.classList.toggle('open', open); $('detBtn').classList.toggle('on', open); $('detBtn').setAttribute('aria-expanded', String(open)); if (open) details(); lastKey = ''; touch(); };
  $('detBtn').onclick = () => setDet(!det.classList.contains('open'));
  $('detClose').onclick = () => setDet(false);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); play(); }
    if (e.key === 'Escape') setDet(false);
  });
  window.addEventListener('resize', () => { lastKey = ''; });
}

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
    const z = Math.max(0.15, Math.min(6, S.cam.zoom * Math.exp(e.deltaY * 0.0015))), kk = z / S.cam.zoom;
    // keep the point under the cursor in place: C' = P + (C - P) k
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
    const [u, v] = toPlane(x, y), p = S.view === 'side' ? [u, 0, v] : [u, v, 0];
    em.fieldAt(A.elems, p[0], p[1], p[2], out);
    const lm = lambdaM(), r = Math.hypot(p[0] - centreM() * scale(), p[1], p[2]), zr = zoneRadii(A.extent);
    const zone = r < zr.rNear ? 'near field' : r < zr.rFar ? 'between near and far' : 'far field';
    const el = $('probe');
    el.textContent = `${(r * lm).toFixed(2)} m from the antenna · ${zone} · |E| ${(Math.hypot(...out.slice(0, 6)) / lm).toFixed(1)} V/m`;
    el.classList.remove('off');
    el.style.left = Math.min(innerWidth - el.offsetWidth - 8, x + 14) + 'px';
    el.style.top = Math.max(8, y - el.offsetHeight - 10) + 'px';
  }
}

// ── start ───────────────────────────────────────────────────────────────────
wireBar();
pointer();
syncBar();
try { field = createField(fieldCanvas); }
catch (e) { console.error('[antenna-fields]', e); $('fail').innerHTML = '<b>The field view did not start.</b><br>' + e.message; $('fail').classList.remove('off'); }
requestAnimationFrame(frame);
window.addEventListener('pagehide', () => { try { field && field.destroy(); } catch (e) { /* gone */ } });

// ── context for the saver and for checks ────────────────────────────────────
const ctx = {
  S, get A() { return A; }, get stats() { return stats; }, canvas: fieldCanvas, scale, lambdaM,
  // type, patch of S[type], and view
  set(type, patch, view) { setType(type); if (patch) Object.assign(S[type], patch); if (view) S.view = view; dirtyAntenna = true; },
  patch(p) { Object.assign(S[S.type], p); dirtyAntenna = true; },
  rebuildNow() { rebuild(); computeStats(); },
  invalidate() { lastKey = ''; },
  syncUI() { syncBar(); },
};
installSaver(ctx);
window.__af = {
  ctx,
  debug: () => ({ type: S.type, view: S.view, field: S.field, n: A ? A.elems.n : 0, Z: A ? A.Zin : null, D: stats ? +stats.Ddb.toFixed(3) : null,
    phasor: field && field.size[0] ? field.size.join('×') : '', psi: psiMode(), saver: window.snSaver && window.snSaver.debug ? window.snSaver.debug() : null }),
  set: (t, patch, more) => { ctx.set(t, patch); if (more) Object.assign(S, more); syncBar(); lastKey = ''; },
};
