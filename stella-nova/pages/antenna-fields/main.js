// ============================================================================
//  ANTENNA FIELDS  ·  main.js — state, framing, the frame loop and input
// ----------------------------------------------------------------------------
//  ES module. em.js gives the currents and the numbers, geom.js the flux,
//  phase and phasor geometry, field-gl.js the GPU field, overlay.js and
//  flow.js the 2D layer, scene3d.js the 3D view, ui.js the panel and the
//  dock, saver.js the screensaver hook.
//
//  UNITS. Physics runs in wavelengths. The view and the panel show metres.
//  The half-wave dipole and the Yagi-Uda are built for 300 MHz (lambda0 =
//  1 m); their slider is the frequency, so the metal keeps its size and the
//  electrical length changes. The other antennas run at 300 MHz.
//
//  PIPELINE (one frame)
//    rebuild()      state -> em.buildAntenna -> GPU elements and wire nodes
//    frame3d()      the 3D view, when it is on (then the frame ends)
//    updateView()   framing in clearRect(); the phasor pass when the view or
//                   the antenna changed; the probe grid and normalise()
//    updateGeo()    the observer: E, H, the sphere flux, the phasor sum
//    drawOverlay()  field lines, flow, flux arrows, wires, observer, phasors
//    field.draw()   the display pass
//
//  grep -n: "const TYPES"  "function rebuild"  "function frame("  "function frame3d"
//           "function clearRect"  "function updateGeo"  "function pointer"
//           "function setType"
// ============================================================================
import * as em from './em.js';
import { createField } from './field-gl.js';
import { mapper, inPlane, traceLines, drawOverlay, RGB } from './overlay.js';
import * as geom from './geom.js';
import { createFlow } from './flow.js';
import { createScene } from './scene3d.js';
import { initUI, PHONE_Q } from './ui.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const F0 = 300, TAU = 2 * Math.PI;
const phoneMQ = window.matchMedia(PHONE_Q);
let ui = null;

// ── the five antennas: the view at first and the default half height of the
// view in metres. Their sliders are in ui.js PARAMS.
const TYPES = {
  dipole: { view: 'side', zoom: 1.5 },
  halfwave: { view: 'side', zoom: 1.3 },
  loop: { view: 'side', zoom: 1.2 },
  array: { view: 'top', zoom: 2.6 },
  yagi: { view: 'top', zoom: 2.4 },
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
  tog: { lines: true, zones: false, log: false, flow: false, sphere: true, phasors: true },
  // The observer: a point in the view plane, rM metres from the antenna
  // centre at the angle ang (radians, from +x toward the vertical axis).
  obs: { rM: 0.8, ang: 0 },
  // The 3D view: orbit angles (rad), morph 0 = flux sphere, 1 = pattern.
  v3: { on: false, yaw: -1.05, pitch: 0.38, zoom: 1, morph: 1, morphTo: 1, db: false, auto: true },
  speed: 0.4, speedK: 1, playing: true, phase: 0,
  cam: { zoom: 1, panX: 0, panY: 0 },
  saver: false, band: null, fade: 1, saverTick: null,
};

let A = null, stats = null, field = null;
let dirtyAntenna = true, statsTimer = 0, lastInteract = -1e9, refineDue = false, lastStatsAt = -1e9;
let probe = null, norm = { gain: 1, psiScale: 1 }, lastKey = '', lineBuf = null, lineRef = null;
let geo = null, geoKey = '', probeR = null, geoChanged = false, lastNumbers = 0;
const flow = createFlow(phoneMQ.matches ? 700 : 1300, 11);
let scene = null, sceneFailed = false, patKey = '', patGrid = null;
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
    // Nodes give the closed-form wire field; a small soft radius only stops
    // the 1/rho peak on the wire. Elements need about their own spacing.
    let soft = A.nodes ? 0.006 : 0.004;
    if (!A.nodes && A.elems.n > 1) { const D = A.elems.d; soft = Math.max(0.003, Math.min(0.02, 0.6 * Math.hypot(D[8] - D[0], D[9] - D[1], D[10] - D[2]))); }
    field.setElems(A.elems, soft);
    field.setNodes(A.nodes);
  }
  lastKey = '';
  geoKey = '';
  patKey = '';
  scheduleStats();
  if (ui) ui.caption();
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
  if (!S.saver && ui) ui.numbers();
}

// ── framing ─────────────────────────────────────────────────────────────────
// The part of the window that the panel, the dock, the caption and the
// status line leave clear (CSS px). The subject is centred in it.
function clearRect() {
  const W = innerWidth, H = innerHeight;
  if (S.saver) {
    const b = S.band, wc = b && b.w ? b.w : W;
    return { x: (W - wc) / 2, y: b ? b.t : 0, w: wc, h: H - (b ? b.t + b.b : 0) };
  }
  let l = 0, r = W, btm = H, t = 0;
  const P = $('panel'), open = P.classList.contains('open'), pr = P.getBoundingClientRect();
  if (phoneMQ.matches) {
    const dock = $('dock').getBoundingClientRect();
    if (dock.height) btm = Math.min(btm, dock.top);
    if (open && pr.height) { if (pr.left > W * 0.3) r = Math.min(r, pr.left); else btm = Math.min(btm, pr.top); }
  } else {
    if (open && pr.width) l = Math.max(l, pr.right);
    const st = $('status').getBoundingClientRect();
    if (st.height) btm = Math.min(btm, st.top + 4);
  }
  const cap = $('caption').getBoundingClientRect();
  if (cap.height) t = cap.bottom + 4;
  return { x: l, y: t, w: Math.max(40, r - l), h: Math.max(40, btm - t) };
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
  // r^2 weights per probe cell for the flow particles (u ~ 1/r^2 far out)
  const n2 = w * h;
  if (!probeR || probeR.length !== n2) probeR = new Float32Array(n2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = view.u0 + (i + 0.5) / w * (view.u1 - view.u0), v = view.v0 + (j + 0.5) / h * (view.v1 - view.v0);
    const rr = Math.max(Math.hypot(u - cen, v), 0.12) / rref;
    probeR[j * w + i] = rr * rr;
  }
  norm.gain = S.field === 'S' ? 0.3 / percentile(svals, 0.88) : (S.tog.log ? 0.45 : 0.85) / percentile(vals, 0.9);
  const pm = psiMode();
  norm.psiScale = pm === 3 ? 1 / (percentile(pvals, 0.5) * 0.6) : (pm === 2 ? 3.5 : 4) / percentile(pvals, 0.88);
  lineRef = null;
}

// ── canvases and the frame loop ─────────────────────────────────────────────
function resize() {
  const d = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(2, Math.round(innerWidth * d)), H = Math.max(2, Math.round(innerHeight * d));
  if (fieldCanvas.width !== W || fieldCanvas.height !== H) { fieldCanvas.width = W; fieldCanvas.height = H; }
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
}
const zoneRadii = geom.zoneRadii;
// ── the observer and the geometry it drives ───────────────────────────────────
// The antenna centre and the view axes in 3D (wavelengths).
function axes() { return { u: [1, 0, 0], v: S.view === 'side' ? [0, 0, 1] : [0, 1, 0] }; }
function centre3() { return [centreM() * scale(), 0, 0]; }
// The smallest sphere radius (metres) that holds all the metal, plus a margin:
// the divergence theorem needs every source inside the sphere.
function enclosingM() {
  if (!A) return 0.1;
  const c = centre3();
  let r = 0;
  for (const w of A.wires) for (const p of w.pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
  return r / scale() * 1.08 + 0.02;
}
function defaultObs() {
  const t = S.type;
  const ang = t === 'array' ? Math.PI / 2 - S.array.steer * Math.PI / 180 : 0;
  const rM = t === 'yagi' ? 1.6 : t === 'array' ? 2.6 : t === 'loop' ? 0.45 : t === 'dipole' ? Math.max(0.6, S.dipole.L * 0.8) : 0.7;
  S.obs = { rM, ang };
}
function obsPlane() {
  const s = scale(), rM = Math.max(S.obs.rM, enclosingM());
  return [(centreM() + rM * Math.cos(S.obs.ang)) * s, rM * Math.sin(S.obs.ang) * s, rM * s];
}
// E, H, the sphere flux and the phasor sum for the observer. Runs when the
// antenna, the view or the observer changes.
function updateGeo() {
  if (!A) return;
  const [u, v, r] = obsPlane(), ax = axes(), c = centre3();
  const key = [u, v, S.view, S.type, A.elems.n, A.Zin && A.Zin[0]].join('|');
  if (key === geoKey && geo) return;
  geoKey = key;
  geoChanged = true;
  const p = [0, 1, 2].map(k => u * ax.u[k] + v * ax.v[k]);
  const dir = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], dl = Math.hypot(...dir) || 1;
  const zr = zoneRadii(A.extent), rl = dl;
  geo = {
    u, v, r,
    ob: geom.observer(A, c, p),
    sf: S.tog.sphere ? geom.sphereFlux(A, c, r, 20, 40) : null,
    circle: S.tog.sphere ? geom.circleFlux(A, c, r, ax.u, ax.v, 60) : null,
    pt: S.tog.phasors ? geom.phasorTerms(A, dir.map(q => q / dl), 12) : null,
    zone: rl < zr.rNear ? 'reactive near field' : rl < zr.rFar ? 'between near and far' : 'radiating far field',
  };
}
// The phasor inset: the lower right of the clear area (device px).
function phasorRect(cr, dpr) {
  const sz = Math.max(150, Math.min(230, 0.32 * Math.min(cr.w, cr.h * 1.3)));
  const h = sz + 44;
  return { x: (cr.x + cr.w - sz - 14) * dpr, y: (cr.y + cr.h - h - 12) * dpr, w: sz * dpr, h: h * dpr };
}

// ── the 3D view ─────────────────────────────────────────────────────────────
// Half size of the field slice (wavelengths); the pattern fits inside it.
function sliceHalf() { return Math.max(1.4, (A ? A.extent : 0.5) * 0.75 + 1.1); }
const farUnit = () => { const L = A.elems; return (x, y, z) => em.farIntensity(L, x, y, z); };
// The pattern mesh and the far-field triads, when the antenna changes.
function updatePattern(Hs) {
  const key = A.elems.n + '|' + (A.Zin ? A.Zin.join() : '') + '|' + S.type + '|' + Hs.toFixed(3);
  if (key === patKey) return;
  patKey = key;
  const fu = farUnit();
  patGrid = geom.patternGrid(fu, S.saver ? 36 : 48, S.saver ? 72 : 96);
  const c = centre3(), lobeR = 0.55 * Hs;
  scene.setPattern(patGrid, c, lobeR);
  scene.setWires(A.wires);
  const um = Math.max(patGrid.Umax, 1e-30), tri = [];
  for (const th of [35, 62, 90, 118, 145]) for (let ph = 0; ph < 360; ph += 30) {
    const t = th * Math.PI / 180, p = (ph + (th === 90 ? 15 : 0)) * Math.PI / 180;
    const n = [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
    const q = geom.phasorTerms(A, n, 1), sq = Math.sqrt(um);
    tri.push({ n, pol: q.pol, amp: [q.sum[0] / sq, q.sum[1] / sq], g: q.U / um });
  }
  scene.setTriads(tri);
}
// One frame of the 3D view. Returns false if the view cannot run (the field
// view then draws instead).
function frame3d(dt) {
  if (sceneFailed) { S.v3.on = false; if (ui) ui.sync(); return false; }
  if (!scene) {
    try { scene = createScene(field.gl); }
    catch (e) { console.error('[antenna-fields] 3D view', e); sceneFailed = true; return false; }
  }
  if (!A) return true;
  const W = fieldCanvas.width, H = fieldCanvas.height, dpr = W / Math.max(1, fieldCanvas.clientWidth || innerWidth);
  const cr = clearRect(), Hs = sliceHalf(), c = centre3(), ax = axes();
  updatePattern(Hs);
  // ease the morph, turn slowly when idle
  const v3 = S.v3;
  v3.morph += (v3.morphTo - v3.morph) * (1 - Math.exp(-dt * 2.6));
  if (Math.abs(v3.morphTo - v3.morph) < 1e-3) v3.morph = v3.morphTo;
  if (v3.auto && !drag3d) v3.yaw += dt * 0.12 * (S.saver ? 0.8 : 1);
  // the slice: the field view's plane, a square of half Hs around the antenna
  view.u0 = c[0] - Hs; view.u1 = c[0] + Hs; view.v0 = -Hs; view.v1 = Hs;
  Object.assign(field.view, { u0: view.u0, u1: view.u1, v0: view.v0, v1: view.v1, axU: ax.u, axV: ax.v, centre: c, psi: psiMode() });
  const size = phoneMQ.matches ? 512 : 768;
  const skey = [S.view, Hs, A.elems.n, A.Zin && A.Zin.join(), field.view.psi].join('|');
  if (skey !== lastKey) {
    lastKey = skey;
    try { probe = field.readProbe(phoneMQ.matches ? 96 : 128, phoneMQ.matches ? 96 : 128); normalise(); } catch (e) { /* the next frame tries again */ }
  }
  field.slice(size, field.view, skey);
  const tex = field.drawSlice({
    phase: S.phase, mode: { E: 0, H: 1, S: 2 }[S.field], comp: compSpec(), gain: norm.gain, log: S.field === 'S' || S.tog.log, rcomp: true,
    rref: rRef(), psiOn: psiMode() > 0, psiScale: norm.psiScale, psiLog: psiMode() === 3, lineAlpha: 0.6, grid: 0, overlay: false, fade: 1,
  }, field.view);
  // the observer direction
  updateGeo();
  let dir = null;
  if (geo && geo.ob) dir = geo.ob.rhat;
  const vp = { x: Math.round(cr.x * dpr), y: Math.round(cr.y * dpr), w: Math.max(2, Math.round(cr.w * dpr)), h: Math.max(2, Math.round(cr.h * dpr)) };
  const fu = farUnit(), um = Math.max(patGrid.Umax, 1e-30);
  scene.draw({
    W, H, vp, dpr, yaw: v3.yaw, pitch: v3.pitch, dist: 3.4 * Hs / v3.zoom, morph: v3.morph, db: v3.db, phase: S.phase, fade: S.fade, bands: 1,
    slice: { tex, half: Hs, plane: S.view, alpha: 0.85 }, cut: S.view, dir, farU: (x, y, z) => fu(x, y, z) / um,
  });
  draw3dLabels(dpr, Hs, fu, um);
  if (S.saver) { field.uploadOverlay(overlay); field.compositeOverlay(S.fade); }
  return true;
}
let drag3d = false;
// Axis letters and the gain at the main lobe, on the 2D overlay.
function draw3dLabels(dpr, Hs, fu, um) {
  const W = overlay.width, H = overlay.height;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, W, H);
  const c = centre3(), L = 0.55 * Hs * 0.42;
  octx.font = `italic ${14 * dpr}px "STIX Two Text", serif`;
  octx.fillStyle = 'rgba(200,210,222,0.75)';
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  for (const [p, t] of [[[c[0] + L * 1.15, c[1], c[2]], 'x'], [[c[0], c[1] + L * 1.15, c[2]], 'y'], [[c[0], c[1], c[2] + L * 1.75], 'z']]) {
    const q = scene.project(p, 1);
    if (q) octx.fillText(t, q[0], q[1]);
  }
  if (stats && S.v3.morph > 0.6) {
    const d = stats.dir, R = 0.55 * Hs * (S.v3.db ? 1 : 1) * 1.08;
    const q = scene.project([c[0] + d[0] * R, c[1] + d[1] * R, c[2] + d[2] * R], 1);
    if (q) {
      octx.font = `${12.5 * dpr}px Inter, system-ui, sans-serif`;
      octx.fillStyle = 'rgba(232,236,242,0.9)'; octx.textAlign = 'left';
      octx.fillText('D = ' + stats.Ddb.toFixed(2) + ' dBi', q[0] + 10 * dpr, q[1]);
    }
  }
  octx.textAlign = 'left'; octx.textBaseline = 'alphabetic';
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
  if (S.v3.on && frame3d(dt)) return;
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
  const ax = axes(), showGeo = !S.saver;
  if (showGeo) updateGeo();
  if (geoChanged && ui && !S.saver && now - lastNumbers > 300) { geoChanged = false; lastNumbers = now; ui.numbers(); }
  const flowOn = S.tog.flow && probe && !S.saver;
  if (flowOn) {
    flow.field(probe, S.phase, ax.u, ax.v, probeR);
    if (S.playing) flow.step(dt, S.speed * S.speedK, (view.u1 - view.u0) / probe.w, (view.v1 - view.v0) / probe.h);
  }
  drawOverlay(octx, {
    W, H, dpr, view, map: mapper(view, W, H), wires: A ? A.wires : [], plane: S.view, axU: ax.u, axV: ax.v, phase: S.phase,
    centre: [centreM() * scale(), 0],
    zones: Object.assign({ on: S.tog.zones, lambdaM: lambdaM() }, zoneRadii(A ? A.extent : 0)),
    lines, feed: S.type === 'loop' ? [S.loop.C / TAU, 0, 0] : [0, 0, 0],
    flow: flowOn ? c2 => flow.draw(c2, W, H, RGB.S, dpr, 1) : null,
    obs: showGeo && geo ? { u: geo.u, v: geo.v, ob: geo.ob, sf: geo.sf, circle: geo.circle, sphere: S.tog.sphere, zone: geo.zone, lambdaM: lambdaM(),
      clip: { x: cr.x * dpr, y: cr.y * dpr, w: cr.w * dpr, h: cr.h * dpr } } : null,
    phasors: showGeo && geo && geo.pt ? { pt: geo.pt, rect: phasorRect(cr, dpr) } : null,
    scaleBox: S.saver ? null : { x: (cr.x + 16) * dpr, y: (cr.y + cr.h - 10) * dpr, lambdaM: lambdaM() },
  });
  if (S.saver) field.uploadOverlay(overlay);
  field.draw({
    phase: S.phase, mode: { E: 0, H: 1, S: 2 }[S.field], comp: compSpec(), gain: norm.gain, log: S.field === 'S' || S.tog.log, rcomp: true,
    rref: rRef(), psiOn: psiMode() > 0, psiScale: norm.psiScale, psiLog: psiMode() === 3, lineAlpha: 0.75,
    grid: 0, overlay: S.saver, fade: S.fade,
  });
}
function computePhasors(q) {
  // Full size while the cost (node or element terms x pixels) stays under
  // the budget; a dipole or an array has 3 to 50 nodes, so it always does.
  const n = Math.max(1, field.cost()), px = fieldCanvas.width * fieldCanvas.height;
  const sc = Math.min(1, Math.max(0.3, Math.sqrt(6e8 / (n * px)))) * q;
  try { field.compute(sc); }
  catch (e) { if (!computeFailed) console.error('[antenna-fields] phasor pass', e); computeFailed = true; return; }
  const pw = phoneMQ.matches ? 150 : 210, ph = Math.max(24, Math.round(pw * fieldCanvas.height / fieldCanvas.width));
  probe = field.readProbe(pw, ph);
  normalise();
}

// ── state changes the panel calls ──────────────────────────────────────────────
function touch() { lastInteract = performance.now(); }
function setType(t) {
  S.type = t;
  if (TYPES[t]) S.view = TYPES[t].view;
  S.cam = { zoom: 1, panX: 0, panY: 0 };
  defaultObs();
  stats = null;
  dirtyAntenna = true;
  if (ui) ui.sync();
}
function setView3d(on) {
  S.v3.on = !!on && !sceneFailed;
  lastKey = ''; patKey = '';
  if (!S.v3.on) octx.clearRect(0, 0, overlay.width, overlay.height);
  if (ui) ui.sync();
}
window.addEventListener('resize', () => { lastKey = ''; });

// ── pointer: pan, zoom, probe ────────────────────────────────────────────────
function pointer() {
  const ptrs = new Map();
  let pinch0 = null, moved = false, dragObs = false;
  const toPlane = (x, y) => [view.u0 + x / fieldCanvas.clientWidth * (view.u1 - view.u0), view.v1 - y / fieldCanvas.clientHeight * (view.v1 - view.v0)];
  const toScreen = (u, v) => [(u - view.u0) / (view.u1 - view.u0) * fieldCanvas.clientWidth, (view.v1 - v) / (view.v1 - view.v0) * fieldCanvas.clientHeight];
  // Move the observer to a screen point (CSS px).
  const moveObs = (x, y) => {
    const [u, v] = toPlane(x, y), s = scale(), cu = centreM() * s;
    S.obs.rM = Math.max(enclosingM(), Math.hypot(u - cu, v) / s);
    S.obs.ang = Math.atan2(v, u - cu);
  };
  fieldCanvas.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    fieldCanvas.setPointerCapture(e.pointerId);
    fieldCanvas.classList.add('drag'); moved = false;
    // A press on the observer marker moves the marker, not the view.
    dragObs = false;
    if (ptrs.size === 1 && geo) {
      const [mx, my] = toScreen(geo.u, geo.v);
      if (Math.hypot(e.clientX - mx, e.clientY - my) < (e.pointerType === 'mouse' ? 16 : 28)) dragObs = true;
    }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: S.cam.zoom, z3: S.v3.zoom }; }
  });
  fieldCanvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse' && !S.v3.on) showProbe(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
    if (S.v3.on) {
      if (ptrs.size === 1) { S.v3.yaw -= dx * 0.008; S.v3.pitch = Math.max(-1.35, Math.min(1.35, S.v3.pitch + dy * 0.008)); drag3d = true; }
      else if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; S.v3.zoom = Math.max(0.5, Math.min(3, pinch0.z3 * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(10, pinch0.d))); }
      touch(); return;
    }
    if (dragObs && ptrs.size === 1) { moveObs(e.clientX, e.clientY); $('probe').hidden = true; return; }
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()];
      S.cam.zoom = Math.max(0.15, Math.min(6, pinch0.zoom * pinch0.d / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))));
    } else if (ptrs.size === 1) {
      const mPerPx = (view.u1 - view.u0) / fieldCanvas.clientWidth / scale();
      S.cam.panX -= dx * mPerPx; S.cam.panY += dy * mPerPx;
    }
    touch();
    $('probe').hidden = true;
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    dragObs = false;
    if (!ptrs.size) drag3d = false;
    if (ptrs.size < 2) pinch0 = null;
    if (!ptrs.size) fieldCanvas.classList.remove('drag');
    if (!moved && e.pointerType !== 'mouse' && !S.v3.on) showProbe(e.clientX, e.clientY);
  };
  fieldCanvas.addEventListener('pointerup', up);
  fieldCanvas.addEventListener('pointercancel', up);
  fieldCanvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') $('probe').hidden = true; });
  fieldCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (S.v3.on) { S.v3.zoom = Math.max(0.5, Math.min(3, S.v3.zoom * Math.exp(-e.deltaY * 0.0015))); touch(); return; }
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
    el.hidden = false;
    el.style.left = Math.min(innerWidth - el.offsetWidth - 8, x + 14) + 'px';
    el.style.top = Math.max(8, y - el.offsetHeight - 10) + 'px';
  }
}

// ── start ───────────────────────────────────────────────────────────────────
ui = initUI({
  S, A: () => A, stats: () => stats, geo: () => geo, freq, lambdaM, scale,
  setType, setView3d, dirty: () => { dirtyAntenna = true; }, touch, invalidate: () => { lastKey = ''; },
  geoDirty: () => { geoKey = ''; }, resetFlow: () => flow.reset(), psiMode, traceField, compSpec,
});
pointer();
defaultObs();
ui.sync();
try { field = createField(fieldCanvas); }
catch (e) { console.error('[antenna-fields]', e); $('fail').innerHTML = '<b>The field view did not start.</b><br>' + e.message; $('fail').hidden = false; }
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
  syncUI() { if (ui) ui.sync(); },
};
installSaver(ctx);
window.__af = {
  ctx,
  debug: () => ({ type: S.type, view: S.view, field: S.field, n: A ? A.elems.n : 0, Z: A ? A.Zin : null, D: stats ? +stats.Ddb.toFixed(3) : null,
    phasor: field && field.size[0] ? field.size.join('×') : '', psi: psiMode(), saver: window.snSaver && window.snSaver.debug ? window.snSaver.debug() : null }),
  set: (t, patch, more) => { ctx.set(t, patch); if (more) Object.assign(S, more); ui.sync(); lastKey = ''; },
  view3d: on => setView3d(on),
};
