// ============================================================================
//  PHOTON CAUSTICS 2D  ·  main.js — layout, controls, the loop, the saver hook
// ----------------------------------------------------------------------------
//  One WebGL2 canvas (#gl) shows the 2D photon tracer. optics2d.js traces
//  photons on the CPU each frame; render2d.js adds their paths into a
//  light image. The photon count adapts to keep the trace near TRACE_MS.
//  A still scene converges (running mean); a moving one (waves, marbles,
//  a drag, the saver) keeps a short memory (A_LIVE in render2d.js).
//  The 3D pool is a separate page: ../photon-caustics-3d/.
//
//  POOL BOTTOM. The first scene looks straight down at the pool floor.
//  It is not traced here: frameTop() gives topdown.js waves and sun to
//  topview.js, which draws the caustic net by the mesh-area method, and
//  flyTop moves photons that fall to the floor at c, then c/n.
//
//  SLOWED LIGHT. On top of the light image, flight.js moves pulses of
//  photons at a slowed speed of light S.c (m/s, the "Speed of light"
//  slider), and at S.c / n in glass or water. The light image under them
//  still adds whole paths, as if light were instant.
//
//  FRAMING. clearRect() gives the part of the canvas that no panel, dock
//  or saver plate covers. The view fits the scene there.
//
//  SAVER. window.snSaver plays shots: the scenes with slow push-ins and
//  light turns, shuffled by the seed. A shot holds 7 to 10 s (calm 0 to
//  1) and cuts through black.
//
//  GREP MAP
//     grep -n 'function clearRect'   the part of the canvas that shows
//     grep -n 'function frame2d'     trace, accumulate, fly, draw the view
//     grep -n 'function frameTop'    the pool bottom from above
//     grep -n 'function setC'        the slowed speed of light
//     grep -n 'function setScene'    load a scene and its defaults
//     grep -n 'function renderMath'  the equations for the current scene
//     grep -n 'function bindPointer' drag, zoom, tap
//     grep -n 'function setOpen'     the panel, the phone sheet, the dock
//     grep -n 'const SHOTS'          the saver shots
//     grep -n 'window.snSaver'       the screensaver hook
// ============================================================================
import { SCENES, makeScene, trace, outline, mulberry, refract as refract2d, advance, waterHeight } from './optics2d.js';
import { createRender2D } from './render2d.js';
import { createFlight } from './flight.js';
import { topWaves, sunDir, shift0, topEmit, topAdvance } from './topdown.js';
import { createTopView, TOP_SRC } from './topview.js';
import { floatCaps } from './gl.js';
import { typeset } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const RULES = [['n', 'm1'], ['\\lambda', 'm2'], ['\\Delta n', 'm2'], ['J', 'm3'], ['E', 'm4'], ['d', 'm5'], ['h', 'm5'], ['\\theta', 'm6']];
const DEG = Math.PI / 180;
const TRACE_MS = PHONE_Q.matches ? 4 : 7;
const BINS = 96, BINS_PLOT = 200;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = u => u * u * (3 - 2 * u);
// The speed slider u in 0..1 gives c = C_MAX u^2 (m/s): fine steps near 0.
const C_MAX = 3, C0 = 0.5, C_REAL = 299792458;

const canvas = $('gl'), panel = $('panel');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });

const S = {
  playing: true, scene: 'bottom',
  P: { ...SCENES[0].defaults, t: 0, mono: 0 },
  geom: true, curve: true, zoom: 1, pan: [0, 0], N: 4000, liveUntil: 0, viewKey: '',
  flight: false, c: C0,   // off at first: the pool bottom opens clean; the dock button turns it on
  saver: null, last: 0,
};
const segs = new Float32Array(7 * 24000 * 9);
const binBuf = new Float32Array(BINS_PLOT), avgBuf = new Float32Array(BINS_PLOT);
let bins = binBuf.subarray(0, BINS), curveAvg = avgBuf.subarray(0, BINS);
let curveFrames = 0, outlineCache = null, outlineKey = '';
let r2d = null, fly = null, tv = null, flyTop = null;
// the pool bottom shows a square of TOP_M metres in the clear part
const TOP_M = 4.2, TOPV = { cx: 0, cy: 0, w: TOP_M, h: TOP_M };
const FLOORS = [[0.56, 0.80, 0.90], [0.86, 0.90, 0.91], [0.84, 0.74, 0.55]];
const isTop = id => !!(SCENES.find(s => s.id === id) || {}).top;

// ── framing ─────────────────────────────────────────────────────────────────
// The clear part of the canvas, as insets in CSS px from each edge.
function clearRect() {
  const cr = canvas.getBoundingClientRect(), W = cr.width, H = cr.height;
  let l = 0, t = 0, r = 0, b = 0;
  if (S.saver) {
    const band = S.saver.band;
    if (band) { t = band.t; b = band.b; }
  } else {
    if (panel.classList.contains('open')) {
      const pr = panel.getBoundingClientRect();
      if (LAND_Q.matches) r = Math.max(0, cr.right - pr.left);
      else if (PHONE_Q.matches) b = Math.max(0, cr.bottom - pr.top);
      else l = Math.max(0, pr.right - cr.left);
    }
    const dock = $('dock');
    // the dock is position: fixed, so offsetParent is null: test the box
    if (dock.getClientRects().length) { const dr = dock.getBoundingClientRect(); if (dr.top < cr.bottom - 1) b = Math.max(b, cr.bottom - dr.top); }
  }
  // a panel never leaves less than a third of the canvas (the saver
  // plate band can be smaller: about 240 px of 800)
  if (!S.saver && W - l - r < W / 3) { l = 0; r = 0; }
  if (!S.saver && H - t - b < H / 3) { t = 0; b = 0; }
  return { l, t, r, b, W, H };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    r2d.resize(w, h); tv.resize(w, h);
  }
}

// ── 2D ──────────────────────────────────────────────────────────────────────
function view2d(scene, c) {
  const v = scene.view, cw = Math.max(40, c.W - c.l - c.r), ch = Math.max(40, c.H - c.t - c.b);
  const dpr = canvas.width / Math.max(1, c.W);
  return { cx: v.cx + S.pan[0], cy: v.cy + S.pan[1], s: Math.min(cw / v.w, ch / v.h) * S.zoom * dpr,
    px: (c.l + cw / 2) * dpr, py: (c.t + ch / 2) * dpr, dpr };
}

function frame2d(now, dt, fade) {
  const P = S.P;
  const def = SCENES.find(s => s.id === S.scene);
  if (S.playing) { P.t += dt; P.sx = (P.sx || 0) + (P.wspd || 0) * dt; }
  if (def.top) return frameTop(now, dt, fade);
  const c = clearRect();
  // the pool slice is as wide as the clear part allows (narrow on a phone)
  if (S.scene === 'section') P.halfW = clamp(0.5 * (c.W - c.l - c.r) / Math.max(1, c.H - c.t - c.b) * (1.73 + P.depth) - 0.1, 1.1, 2.4);
  const scene = makeScene(S.scene, P), view = view2d(scene, c);
  const key = [canvas.width, canvas.height, view.cx.toFixed(4), view.cy.toFixed(4), view.s.toFixed(3), view.px | 0, view.py | 0].join();
  const moving = key !== S.viewKey;
  if (moving && !S.saver && now > S.liveUntil) r2d.reset();
  // in the saver the plate band can change the scale at a cut: a jump in
  // scale clears the old image (a slow push-in does not)
  if (S.saver && Math.abs(view.s / (S.lastS || view.s) - 1) > 0.1) r2d.reset();
  S.lastS = view.s;
  if (moving) { S.viewKey = key; S.liveUntil = Math.max(S.liveUntil, now + 300); curveFrames = 0; }
  const live = scene.animated && S.playing || now < S.liveUntil || !!S.saver;
  // a still scene that has converged needs no more photons; with photons
  // in flight it shows the same light image again under them
  const hold = !live && r2d.frames > 900;
  if (hold && !S.flight) return;
  let flight = null;
  if (S.flight) {
    if (S.playing) fly.step(scene, S.c * dt, P);
    flight = fly.build(view.dpr / view.s);
  }
  let ns = 0;
  if (!hold) {
    if (scene.detector) { bins.fill(0); scene.detector.bins = bins; }
    const t0 = performance.now();
    ns = trace(scene, S.N, Math.random, segs, P);
    if (scene.lamp) ns += traceLamp(scene, ns, P);
    const ms = performance.now() - t0;
    S.N = Math.round(clamp(S.N * clamp(Math.sqrt(TRACE_MS / Math.max(0.2, ms)), 0.8, 1.25), 800, 24000));
  }
  const L = scene.light, width = L.type === 'beam' ? L.width : (L.a1 - L.a0) * 0.5;
  const oKey = scene.animated ? '' : S.scene + P.ang + P.n;
  if (scene.animated || oKey !== outlineKey) { outlineCache = outline(scene); outlineKey = oKey; }
  let curve = null, curves = null;
  if (scene.plot) { if (S.curve) curves = hold ? S.lastCurve : (S.lastCurve = sectionPlot(scene, live)); }
  else if (S.curve && !S.saver && scene.detector) curve = hold ? S.lastCurve : (S.lastCurve = detectorCurve(scene, live));
  const lamp = scene.lamp ? [scene.lamp.x, scene.lamp.y] : null;
  r2d.draw({ segs, ns, view, gain: width * view.s / S.N, exposure: P.exp, live, outline: outlineCache, geom: S.geom,
    curve, curves, fade, marker: L.type === 'point' ? [L.x, L.y] : lamp, flight, hold });
  placeLabels(scene, view);
  if (!S.saver && now - (S.capAt || 0) > 400) {
    S.capAt = now;
    const cs = S.flight ? ` · <i>c</i> = <span class="n">${S.c.toFixed(2)}</span> m/s` : '';
    $('caption').innerHTML = `<i>${def.name}</i> · <span class="n">${S.N.toLocaleString('en-US')}</span> photons a frame${cs}`;
  }
}

// The pool bottom from above. view2d with the TOPV square gives the scale;
// the world rect of the whole canvas goes to topview.js. Photons in flight
// land in the clear part.
function frameTop(now, dt, fade) {
  // the floor is full-bleed: in the saver it takes the whole frame, not
  // only the band between the plate texts
  const P = S.P, c0 = clearRect(), c = S.saver ? { ...c0, t: 0, b: 0 } : c0, v = view2d({ view: TOPV }, c);
  const W = canvas.width, H = canvas.height;
  const view = { x0: v.cx - v.px / v.s, y0: v.cy - (H - v.py) / v.s, w: W / v.s, h: H / v.s };
  const waves = topWaves(P), L = sunDir(P), d = P.depth;
  let flight = null;
  if (S.flight) {
    const cw = (c.W - c.l - c.r) * v.dpr / v.s, ch = (c.H - c.t - c.b) * v.dpr / v.s;
    const scene = { waves, L, n: P.n, d, rect: { x0: v.cx - cw / 2, y0: v.cy - ch / 2, w: cw, h: ch } };
    if (S.playing) flyTop.step(scene, S.c * dt, P);
    flight = flyTop.build(v.dpr / v.s);
  }
  tv.draw({ waves, L, n: P.n, dn: P.dn, d, view, shift0: shift0(L, P.n, d), exposure: P.exp, tiles: !!P.tiles,
    floor: FLOORS[P.floor | 0], fade, flight,
    fview: { sx: 2 * v.s / W, sy: 2 * v.s / H, ox: 2 * v.px / W - 1, oy: 1 - 2 * v.py / H, cx: v.cx, cy: v.cy } });
  $('labels').hidden = true;
  if (!S.saver && now - (S.capAt || 0) > 400) {
    S.capAt = now;
    const cs = S.flight ? ` · <i>c</i> = <span class="n">${S.c.toFixed(2)}</span> m/s` : '';
    $('caption').innerHTML = `<i>Pool bottom</i> · sun <span class="n">${P.ang.toFixed(0)}°</span> · depth <span class="n">${d.toFixed(2)}</span> m${cs}`;
  }
}

// The lamp on the pool floor (TIR): a part of the photons from the lamp,
// after the sun photons in segs. They do not count on the floor plot, and
// they get a green tint so that they read apart from the sunlight.
function traceLamp(scene, ns0, P) {
  const n = Math.round(S.N * 0.3), sub = segs.subarray(ns0 * 7);
  const ls = { ...scene, light: scene.lamp, detector: null };
  const k = 1.0 * S.N / n, m = trace(ls, n, Math.random, sub, P), tint = [0.55, 1.0, 0.82];
  for (let i = 0; i < m; i++) for (let c = 0; c < 3; c++) sub[i * 7 + 4 + c] *= k * tint[c];
  return m;
}

// The plot of the pool cross-section: the light on the floor E(x), a
// running mean of the bins, in the band under the floor (scene.plot).
// The band height is 4 times the mean light; a grey line marks the mean.
function sectionPlot(scene, live) {
  curveFrames++;
  const a = live ? 0.2 : Math.max(0.02, 1 / curveFrames);
  let mean = 0;
  for (let i = 0; i < BINS_PLOT; i++) { curveAvg[i] += (bins[i] - curveAvg[i]) * a; mean += curveAvg[i] / BINS_PLOT; }
  const p = scene.plot, H = p.y1 - p.y0, pts = [], tris = [];
  const y = v => p.y0 + H * Math.min(1, mean > 0 ? v / mean / 4 : 0);
  for (let i = 0; i < BINS_PLOT; i++) pts.push(p.x0 + (p.x1 - p.x0) * (i + 0.5) / BINS_PLOT, y(curveAvg[i]));
  for (let i = 0; i + 1 < BINS_PLOT; i++) {
    const xa = pts[2 * i], ya = pts[2 * i + 1], xb = pts[2 * i + 2], yb = pts[2 * i + 3];
    tris.push(xa, p.y0, xb, p.y0, xa, ya, xb, p.y0, xb, yb, xa, ya);
  }
  return [
    { tris, color: [1.0, 0.8, 0.5, 0.16] },
    { pts: [p.x0, p.y0, p.x1, p.y0], color: [0.55, 0.58, 0.64, 0.7, 1.2] },
    { pts: [p.x0, p.y0 + H / 4, p.x1, p.y0 + H / 4], color: [0.55, 0.58, 0.64, 0.35, 1] },
    { pts, color: [1.0, 0.86, 0.6, 0.9, 1.6] },
  ];
}

// The labels of the pool cross-section (#labels): air, water, floor and
// the plot, placed from world points.
function placeLabels(scene, view) {
  const box = $('labels'), on = !!scene.plot && !S.saver && S.geom;
  box.hidden = !on; if (!on) return;
  const P = S.P, d = P.depth, x0 = scene.plot.x0 + 0.08;
  const at = (k, x, y, text) => {
    const el = box.querySelector(`[data-k="${k}"]`);
    el.style.transform = `translate(${((view.px + (x - view.cx) * view.s) / view.dpr).toFixed(1)}px, ${((view.py - (y - view.cy) * view.s) / view.dpr).toFixed(1)}px)`;
    if (el.textContent !== text) el.textContent = text;
  };
  at('air', x0, 0.42, 'air · n = 1');
  at('water', x0, -0.22, `water · n = ${P.n.toFixed(3)}`);
  at('floor', x0, -d + 0.2, `floor · depth ${d.toFixed(2)} m`);
  at('plot', x0, scene.plot.y1 + 0.02, 'light on the floor, E(x)');
}

// The irradiance along the detector (floor or screen): a running mean of
// the bins, drawn as a curve that rises from the detector into the scene.
function detectorCurve(scene, live) {
  curveFrames++;
  const a = live ? 0.15 : Math.max(0.02, 1 / curveFrames);
  let mean = 0;
  const NB = bins.length;
  for (let i = 0; i < NB; i++) { curveAvg[i] += (bins[i] - curveAvg[i]) * a; mean += curveAvg[i] / NB; }
  if (mean <= 0) return null;
  const d = scene.detector, v = scene.view;
  let nx = -(d.y1 - d.y0), ny = d.x1 - d.x0; const l = Math.hypot(nx, ny); nx /= l; ny /= l;
  const mx = (d.x0 + d.x1) / 2, my = (d.y0 + d.y1) / 2;
  if (nx * (v.cx - mx) + ny * (v.cy - my) < 0) { nx = -nx; ny = -ny; }
  const unit = 0.035 * v.h, top = 0.3 * v.h, pts = [];
  for (let i = 0; i < NB; i++) {
    const u = (i + 0.5) / NB, hgt = Math.min(top, curveAvg[i] / mean * unit);
    pts.push(d.x0 + (d.x1 - d.x0) * u + nx * hgt, d.y0 + (d.y1 - d.y0) * u + ny * hgt);
  }
  return pts;
}

// ── loop ────────────────────────────────────────────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (S.last || now)) / 1000); S.last = now;
  resize();
  let fade = 1;
  if (S.saver) fade = saverTick(now);
  frame2d(now, dt, fade);
}

// ── controls ────────────────────────────────────────────────────────────────
const SLIDERS2D = [['dir', v => v.toFixed(0) + '°'], ['az', v => v.toFixed(0) + '°'], ['ang', v => v.toFixed(1) + '°'], ['n', v => v.toFixed(3)], ['dn', v => v.toFixed(3)], ['wave', v => v.toFixed(2)], ['exp', v => v.toFixed(2)],
  ['amp', v => (v * 100).toFixed(1) + ' cm'], ['lam', v => v.toFixed(2) + ' m'], ['wspd', v => v.toFixed(2) + ' m/s'], ['depth', v => v.toFixed(2) + ' m']];

function syncSliders() {
  const def = SCENES.find(s => s.id === S.scene), am = def.angMax || 40;
  $('ang').min = -am; $('ang').max = am;
  for (const [id, f] of SLIDERS2D) if (S.P[id] !== undefined) { $(id).value = S.P[id]; $(id + 'V').textContent = f(S.P[id]); }
  $('waveRow').hidden = S.scene !== 'pool';
  $('secCtl').hidden = S.scene !== 'section' && S.scene !== 'bottom';
  $('topRows').hidden = S.scene !== 'bottom'; $('tirBtn').hidden = S.scene !== 'section';
  $('trace2d').hidden = S.scene === 'bottom';
  document.querySelectorAll('#floorSeg button').forEach(b => b.classList.toggle('on', +b.dataset.floor === (S.P.floor | 0)));
  $('tilesBtn').classList.toggle('on', !!S.P.tiles);
  document.querySelectorAll('#mixSeg button').forEach(b => b.classList.toggle('on', +b.dataset.mix === (S.P.mix ?? 1)));
  $('tirBtn').classList.toggle('on', !!S.P.tir);
}

function setScene(id, keepParams) {
  const def = SCENES.find(s => s.id === id) || SCENES[0];
  S.scene = def.id;
  if (!keepParams) S.P = { ...def.defaults, t: S.P.t, mono: S.P.mono };
  const nb = def.id === 'section' ? BINS_PLOT : BINS;
  bins = binBuf.subarray(0, nb); curveAvg = avgBuf.subarray(0, nb);
  S.zoom = 1; S.pan = [0, 0]; curveFrames = 0; curveAvg.fill(0); outlineKey = '';
  r2d.reset(); fly.clear(); flyTop.clear();
  document.querySelectorAll('#scenes .card').forEach(b => b.classList.toggle('on', b.dataset.id === def.id));
  $('sceneSub').textContent = def.sub;
  syncSliders(); renderMath(); dockText(); setC(S.c);
}

function dockText() {
  $('dockName').textContent = SCENES.find(s => s.id === S.scene).name;
  $('dockGeom').classList.toggle('on', S.geom); $('dockGeom').setAttribute('aria-pressed', String(S.geom));
  $('dockPlay').textContent = S.playing ? '❚❚' : '▶';
  $('playBtn').textContent = S.playing ? 'Pause' : 'Play';
}

function setPlaying(p) { S.playing = p; dockText(); }

// The slowed speed of light: the slider, its value and the hint that
// gives the real c and c/n in the medium of the scene.
function setC(c) {
  S.c = clamp(c, 0, C_MAX);
  $('c').value = Math.sqrt(S.c / C_MAX);
  $('cV').textContent = S.c < 0.005 ? 'stopped' : S.c.toFixed(2) + ' m/s';
  const n = S.P.n, slow = S.c > 0.005 ? `Real light goes ${(C_REAL / 1e8).toFixed(2)} × 10⁸ m/s, ${fmtE(C_REAL / S.c)} times faster. ` : 'The photons stand still. ';
  $('cHint').textContent = `A slowed picture of light. ${slow}In glass or water a photon goes at c/n: ${(S.c / n).toFixed(2)} m/s at n = ${n.toFixed(3)}.`;
}
const fmtE = v => { const e = Math.floor(Math.log10(v)); return `${(v / 10 ** e).toFixed(1)} × 10${String(e).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('')}`; };
function setFlight(on) {
  S.flight = on; if (!on) { fly.clear(); flyTop.clear(); }
  $('flightBtn').classList.toggle('on', on); $('dockFly').classList.toggle('on', on); $('dockFly').setAttribute('aria-pressed', String(on));
}
function setGeom(on) { S.geom = on; $('geomBtn').classList.toggle('on', on); dockText(); }
function clearAll() { r2d.reset(); fly.clear(); flyTop.clear(); curveFrames = 0; curveAvg.fill(0); }

function bindUI() {
  const box = $('scenes');
  for (const s of SCENES) {
    const b = document.createElement('button'); b.className = s.id === 'section' || s.id === 'bottom' ? 'card wide' : 'card'; b.dataset.id = s.id; b.textContent = s.name;
    b.addEventListener('click', () => setScene(s.id)); box.append(b);
  }
  for (const [id, f] of SLIDERS2D) $(id).addEventListener('input', () => {
    S.P[id] = +$(id).value; $(id + 'V').textContent = f(S.P[id]); S.liveUntil = performance.now() + 300; outlineKey = '';
    if (id === 'n' || id === 'dn') { renderMath(); setC(S.c); }
  });
  document.querySelectorAll('#specSeg button').forEach(b => b.addEventListener('click', () => {
    S.P.mono = +b.dataset.mono; document.querySelectorAll('#specSeg button').forEach(x => x.classList.toggle('on', x === b)); r2d.reset();
  }));
  $('geomBtn').addEventListener('click', () => setGeom(!S.geom));
  $('c').addEventListener('input', () => setC(C_MAX * (+$('c').value) ** 2));
  document.querySelectorAll('#mixSeg button').forEach(b => b.addEventListener('click', () => { S.P.mix = +b.dataset.mix; syncSliders(); renderMath(); }));
  document.querySelectorAll('#floorSeg button').forEach(b => b.addEventListener('click', () => { S.P.floor = +b.dataset.floor; syncSliders(); }));
  $('tilesBtn').addEventListener('click', () => { S.P.tiles = S.P.tiles ? 0 : 1; syncSliders(); });
  $('tirBtn').addEventListener('click', () => { S.P.tir = S.P.tir ? 0 : 1; syncSliders(); fly.clear(); r2d.reset(); });
  $('flightBtn').addEventListener('click', () => setFlight(!S.flight));
  $('dockFly').addEventListener('click', () => setFlight(!S.flight));
  $('curveBtn').addEventListener('click', () => { S.curve = !S.curve; $('curveBtn').classList.toggle('on', S.curve); });
  $('playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!S.playing));
  $('clearBtn').addEventListener('click', clearAll);
  $('dockScene').addEventListener('click', () => { const i = SCENES.findIndex(s => s.id === S.scene); setScene(SCENES[(i + 1) % SCENES.length].id); });
  $('dockGeom').addEventListener('click', () => setGeom(!S.geom));
  for (const el of document.querySelectorAll('.sci-sym[data-tex]')) {
    const tex = el.dataset.tex, cls = RULES.find(q => q[0] === tex);
    typeset(el, tex, { display: false, rules: cls ? [cls] : null });
  }
}

function bindKeys() {
  addEventListener('keydown', e => {
    if (S.saver || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,select,textarea') && e.key !== ' ') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); setPlaying(!S.playing); }
    else if (k === 'c') clearAll();
    else if (k === 'f') setFlight(!S.flight);
    else if (/^[1-9]$/.test(k) && SCENES[+k - 1]) setScene(SCENES[+k - 1].id);
  });
}

// ── pointer ─────────────────────────────────────────────────────────────────
// A drag turns the light, wheel or pinch zooms about the pointer, a
// double-click resets.
function bindPointer() {
  const pts = new Map();
  let start = null, pinch0 = null;
  const world = (x, y) => {
    const cr = canvas.getBoundingClientRect(), scene = isTop(S.scene) ? { view: TOPV } : makeScene(S.scene, S.P), v = view2d(scene, clearRect());
    const dpr = v.dpr, px = (x - cr.left) * dpr, py = (y - cr.top) * dpr;
    return [v.cx + (px - v.px) / v.s, v.cy - (py - v.py) / v.s, v];
  };
  const zoomAt = (x, y, f) => {
    const [wx, wy] = world(x, y);
    S.zoom = clamp(S.zoom * f, 0.5, 12);
    const [wx2, wy2] = world(x, y);
    S.pan[0] += wx - wx2; S.pan[1] += wy - wy2;
  };
  canvas.addEventListener('pointerdown', e => {
    if (S.saver) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, ang: S.P.ang, az: S.P.az, moved: false, t: performance.now() };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); start = null; }
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch0); pinch0 = d; S.liveUntil = performance.now() + 300;
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) start.moved = true;
    if (!start.moved) return;
    const w = canvas.clientWidth;
    const am = SCENES.find(s => s.id === S.scene).angMax || 40;
    if (isTop(S.scene)) {
      // from above: a drag across turns the sun round (azimuth)
      S.P.az = ((start.az + dx / w * 360) % 360 + 540) % 360 - 180;
      $('az').value = S.P.az; $('azV').textContent = S.P.az.toFixed(0) + '°';
    } else {
      S.P.ang = clamp(start.ang + dx / w * 80, -am, am);
      $('ang').value = S.P.ang; $('angV').textContent = S.P.ang.toFixed(1) + '°';
    }
    S.liveUntil = performance.now() + 300;
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (!pts.size) { start = null; canvas.classList.remove('drag'); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    if (S.saver) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); S.liveUntil = performance.now() + 300;
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { S.zoom = 1; S.pan = [0, 0]; });
}

// ── panel ───────────────────────────────────────────────────────────────────
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
}
function bindPanel() {
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  // The grip of the phone sheet: a tap switches half and full height, a
  // drag up gives full height, a drag down gives half height, then closes.
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

// ── equations ───────────────────────────────────────────────────────────────
const TEX = {
  fly: String.raw`v=\frac{c}{n},\qquad \Delta s=\frac{c\,\Delta t}{n}`,
  ray: String.raw`\mathbf{x}(\xi,s)=\mathbf{x}_0(\xi)+s\,\hat{\mathbf{d}}(\xi),\qquad J=\det\frac{\partial\mathbf{x}}{\partial(\xi,s)}=0`,
  snell: String.raw`n_1\sin\theta_1=n_2\sin\theta_2,\qquad E\propto\frac{1}{|J|}`,
  cup: String.raw`x=\tfrac{a}{4}\left(3\cos t-\cos 3t\right),\quad y=\tfrac{a}{4}\left(3\sin t-\sin 3t\right)`,
  cardioid: String.raw`r=\tfrac{2a}{3}\left(1+\cos\phi\right)\quad\text{(from the source)}`,
  drop: String.raw`D(\theta)=\pi+2\theta-4\arcsin\frac{\sin\theta}{n},\qquad \frac{dD}{d\theta}=0\;\Rightarrow\;D\approx 138^\circ`,
  lens: String.raw`f_0=\frac{a}{n-1},\qquad f(y)<f_0\ \text{for rays at height } y`,
  bottom: String.raw`\mathbf{T}=\eta\,\mathbf{L}+\left(\eta\cos\theta_i-\cos\theta_t\right)\mathbf{N},\quad \eta=\frac{1}{n},\quad \mathbf{N}\propto(-\nabla h,\,1)`,
  top: String.raw`\mathbf{Q}=\mathbf{p}+\mathbf{T}_{xy}\,\frac{d+h}{-T_z},\qquad E=\frac{|dA_0|}{|dA|}`,
  section: String.raw`h=\sum_i A_i\sin k_i\left(x-v_i t\right),\qquad X\approx x+\left(1-\frac{1}{n}\right)d\,h'(x)`,
  pool: String.raw`E=\frac{E_0}{\left|1+\left(1-\frac{1}{n}\right)d\,h''(x)\right|}`,
  prism: String.raw`\delta=\theta_1+\theta_4-\alpha,\qquad n(\lambda)\approx A+\frac{B}{\lambda^2}`,
  marbles: String.raw`f=\frac{n\,a}{2(n-1)}\quad\text{(from the centre of a ball)}`,
};
const EQ_TEXT = {
  fly: 'v = c/n,  Δs = c Δt / n',
  ray: 'x(ξ, s) = x₀(ξ) + s d(ξ),  J = det ∂x/∂(ξ, s) = 0', snell: 'n₁ sin θ₁ = n₂ sin θ₂,  E ∝ 1/|J|',
  cup: 'x = a/4 (3 cos t − cos 3t),  y = a/4 (3 sin t − sin 3t)', cardioid: 'r = 2a/3 (1 + cos φ)',
  drop: 'D(θ) = π + 2θ − 4 arcsin(sin θ / n),  D ≈ 138°', lens: 'f₀ = a / (n − 1),  f(y) < f₀',
  bottom: 'T = η L + (η cos θi − cos θt) N,  η = 1/n,  N ∝ (−∇h, 1)', top: 'Q = p + T_xy (d + h) / (−T_z),  E = |dA₀| / |dA|',
  section: 'h = Σ Aᵢ sin kᵢ(x − vᵢ t),  X ≈ x + (1 − 1/n) d h′(x)',
  pool: 'E = E₀ / |1 + (1 − 1/n) d h″(x)|', prism: 'δ = θ₁ + θ₄ − α,  n(λ) ≈ A + B/λ²', marbles: 'f = n a / (2(n − 1))',
};
function mathKeys() { return S.scene === 'section' ? ['snell', 'section', 'pool'] : S.scene === 'bottom' ? ['snell', 'bottom', 'top'] : ['ray', 'snell', S.scene]; }
function renderMath() {
  const k = mathKeys();
  ['eqA', 'eqB', 'eqC'].forEach((id, i) => typeset($(id), TEX[k[i]], { rules: RULES }));
  typeset($('eqFly'), TEX.fly, { rules: RULES });
}

// ── screensaver ─────────────────────────────────────────────────────────────
// A shot: scene, zoom from-to (toward the scene focus), light angle
// from-to, and parameter overrides. fly: the slowed speed of light in m/s
// for a shot with photons in flight (no fly: the light image only).
const SHOTS = [
  { scene: 'bottom', zoom: [1, 1.12], ang: [16, 20], az: [20, 45], sub: 'Sunlight through moving water: the bright net on the pool floor' },
  { scene: 'bottom', zoom: [1.7, 2.3], ang: [18, 18], az: [30, 38], sub: 'Close in: each line is a fold of the light, each knot a cusp' },
  { scene: 'bottom', zoom: [1, 1.08], ang: [22, 26], az: [-60, -40], P: { floor: 1, dn: 0.05 }, sub: 'White tiles: each colour bends its own way at the lines' },
  { scene: 'bottom', zoom: [1.2, 1.3], ang: [12, 14], az: [0, 15], fly: 0.6, sub: 'Photons fall at a slowed c, then c / n in the water, onto the net' },
  { scene: 'section', zoom: [1, 1.08], ang: [8, 16], fly: 0.5, P: { tight: 1, depth: 1.1 }, sub: 'Side view: sunlight at c / n in the water, then a focus' },
  { scene: 'section', zoom: [1, 1.08], ang: [-12, -6], fly: 0.4, P: { tir: 1, tight: 1, depth: 1.1 }, sub: 'A lamp below: past 48.6° the surface is a mirror' },
  { scene: 'cup', zoom: [1, 1.15], ang: [-8, 8], fly: 0.6, sub: 'Pulses of light at a slowed c fold onto the nephroid' },
  { scene: 'cup', zoom: [1.5, 2.6], ang: [0, 0], sub: 'Close on the cusp: the paraxial rays meet at a / 2' },
  { scene: 'cardioid', zoom: [1, 1.2], ang: [-15, 15] },
  { scene: 'drop', zoom: [1, 1.2], ang: [-5, 5], P: { dn: 0.08 } },
  { scene: 'drop', zoom: [1, 1.15], ang: [-3, 3], fly: 0.4, sub: 'In water the photons go at c / n: the front bends' },
  { scene: 'lens', zoom: [1.4, 2.5], ang: [0, 0], sub: 'The cusp of the lens caustic: edge rays cross the axis first' },
  { scene: 'lens', zoom: [1, 1.2], ang: [0, 0], fly: 0.35, sub: 'A flat front goes into glass at c / n, comes out curved' },
  { scene: 'pool', zoom: [1, 1.35], ang: [-6, 6] },
  { scene: 'prism', zoom: [1, 1.5], ang: [-3, 3] },
  { scene: 'prism', zoom: [1, 1.3], ang: [-2, 2], fly: 0.4, P: { dn: 0.16 }, sub: 'Blue is slower in glass than red: the colours part' },
  { scene: 'marbles', zoom: [1, 1.2], ang: [-6, 6] },
];
const FLY_CODE = (() => { const t = advance.toString(); return t.slice(t.indexOf('  for (let k')).trim(); })();
function saverPlate() {
  const sv = S.saver; if (!sv || !sv.label || !sv.shot) return;
  const sh = sv.shot, f = (v, d = 3) => Number(v).toFixed(d);
  const def = SCENES.find(s => s.id === sh.scene), P = S.P;
  const params = [{ sym: 'n', name: 'index at 589 nm', value: f(P.n) }];
  // few values, so they keep to one row on the plate
  if (sh.scene === 'bottom') {
    params.push({ sym: 'd', name: 'depth', value: f(P.depth, 2) + ' m' }, { sym: '\\theta', name: 'sun from the zenith', value: f(P.ang, 0) + '°' });
    params.push(sh.fly ? { sym: 'c', name: 'slowed c', value: f(S.c, 2) + ' m/s' } : { sym: 'A', name: 'wave height', value: f(P.amp * 100, 1) + ' cm' });
  } else if (sh.fly) {
    params.push(sh.scene === 'section' ? { sym: 'd', name: 'depth', value: f(P.depth, 2) + ' m' } : { sym: '\\theta', name: 'light angle', value: f(P.ang, 1) + '°' },
      { sym: 'c', name: 'slowed c', value: f(S.c, 2) + ' m/s' }, { sym: 'c/n', name: 'in the medium', value: f(S.c / P.n, 2) + ' m/s' });
  } else {
    if (sh.scene === 'section') params.push({ sym: 'A', name: 'wave height', value: f(P.amp * 100, 1) + ' cm' }, { sym: '\\lambda', name: 'wavelength', value: f(P.lam, 2) + ' m' }, { sym: 'd', name: 'depth', value: f(P.depth, 2) + ' m' });
    else if (P.dn > 0) params.push({ sym: '\\Delta n', name: 'index split, 400 to 700 nm', value: f(P.dn) });
    if (sh.scene !== 'section') params.push({ sym: '\\theta', name: 'light angle', value: f(P.ang, 1) + '°' }, { sym: 'N', name: 'photons a frame', value: S.N.toLocaleString('en-US') });
  }
  const first = sh.scene === 'bottom' ? 'bottom' : sh.fly ? 'fly' : sh.scene === 'section' ? 'snell' : 'ray';
  const second = sh.scene === 'bottom' ? (sh.fly ? 'fly' : 'top') : sh.scene;
  sv.label({ title: 'Photon Caustics 2D · ' + (def.short || def.name), sub: sh.sub || def.sub, tex: [TEX[first], TEX[second]], rules: RULES,
    eq: [EQ_TEXT[first], EQ_TEXT[second]], params,
    code: sh.scene === 'bottom' ? { lang: 'glsl', name: 'topview.js · refract each ray to the floor', text: TOP_SRC }
      : sh.fly ? { lang: 'js', name: 'optics2d.js · advance, a photon in flight', text: FLY_CODE }
      : sh.scene === 'section' ? { lang: 'js', name: 'optics2d.js · waterHeight, a sum of travelling waves', text: waterHeight.toString() }
      : { lang: 'js', name: 'optics2d.js · refract', text: refract2d.toString() } });
}

function nextShot(now) {
  const sv = S.saver;
  sv.i++;
  const sh = { ...sv.list[sv.i % sv.list.length] };
  sv.shot = sh; sv.t0 = now;
  setScene(sh.scene);
  Object.assign(S.P, sh.P || {});
  setFlight(!!sh.fly); if (sh.fly) setC(sh.fly);
  if (sh.az) { sh.az0 = sh.az[0] + (sv.rnd() - 0.5) * 40; sh.az1 = sh.az0 + sh.az[1] - sh.az[0]; }
  sh.ang0 = sh.ang[0] + (sv.rnd() - 0.5) * 6; sh.ang1 = sh.ang[1] + (sv.rnd() - 0.5) * 6;
  saverPlate();
}

function saverTick(now) {
  const sv = S.saver;
  if (sv.bandFn && now - sv.bandAt > 500) { sv.bandAt = now; try { sv.band = sv.bandFn(canvas.clientHeight); } catch (e) { sv.band = null; } }
  if (!sv.shot || now - sv.t0 >= sv.hold) nextShot(now);
  const sh = sv.shot, el = now - sv.t0, u = ease(clamp(el / sv.hold, 0, 1));
  const scene = isTop(sh.scene) ? { view: TOPV, focus: { x: 0, y: 0 } } : makeScene(sh.scene, S.P), fz = scene.focus, v = scene.view;
  S.zoom = lerp(sh.zoom[0], sh.zoom[1], u);
  // pan toward the focus as the zoom grows past 1
  const k = clamp((S.zoom - 1) / 1.5, 0, 1);
  S.pan = [(fz.x - v.cx) * k, (fz.y - v.cy) * k];
  S.P.ang = lerp(sh.ang0, sh.ang1, u);
  if (sh.az) S.P.az = lerp(sh.az0, sh.az1, u);
  if (now - sv.plateAt > 1000) { sv.plateAt = now; saverPlate(); }
  return clamp(Math.min(el / 600, (sv.hold - el) / 450), 0, 1);
}

window.snSaver = {
  enter(o = {}) {
    const calm = clamp(o.calm ?? 0.7, 0, 1), rnd = mulberry((o.seed >>> 0) || 1);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // the tour opens on the pool bottom
    const list = shuffle(SHOTS), b = list.findIndex(x => x.scene === 'bottom');
    list.unshift(...list.splice(b, 1));
    S.saver = { label: typeof o.label === 'function' ? o.label : null, rnd, list,
      i: -1, shot: null, t0: 0, hold: (7 + 3 * calm) * 1000, plateAt: 0, bandFn: null, band: null, bandAt: 0,
      prev: { scene: S.scene, P: { ...S.P }, zoom: S.zoom, pan: S.pan.slice(), playing: S.playing, flight: S.flight, c: S.c, open: panel.classList.contains('open') } };
    document.documentElement.classList.add('saver');
    S.playing = true;
    import('../../lib/saver-clear.js').then(m => { if (S.saver) S.saver.bandFn = m.plateBand; }).catch(() => { /* no band: centre */ });
    return { canvas, warmupMs: 1500 };
  },
  exit() {
    const sv = S.saver; if (!sv) return;
    if (sv.label) sv.label(null);
    S.saver = null;
    document.documentElement.classList.remove('saver');
    const p = sv.prev;
    S.playing = p.playing;
    setScene(p.scene); S.P = p.P; S.zoom = p.zoom; S.pan = p.pan; syncSliders(); dockText();
    setFlight(p.flight); setC(p.c);
    setOpen(p.open);
  },
};

// ── boot ────────────────────────────────────────────────────────────────────
if (!gl) {
  $('nogl').hidden = false;
} else {
  const caps = floatCaps(gl);
  r2d = createRender2D(gl, caps);
  fly = createFlight({ phone: PHONE_Q.matches });
  tv = createTopView(gl, caps, { phone: PHONE_Q.matches });
  flyTop = createFlight({ phone: PHONE_Q.matches, per: PHONE_Q.matches ? 110 : 180, emit: topEmit, advance: topAdvance });
  bindUI(); bindKeys(); bindPointer(); bindPanel();
  if (PHONE_Q.matches) setOpen(false);
  resize();
  setScene('bottom'); setFlight(S.flight); setC(S.c);
  requestAnimationFrame(frame);
  window.__caustics = { S, setScene, setC, setFlight, fly, SCENES, booted: true, float: caps.float };
}
