// ============================================================================
//  DIFFUSION-LIMITED AGGREGATION  ·  main.js — UI, frame loop, saver hook
// ----------------------------------------------------------------------------
//  A credit and showcase page for fogleman/dlaf (Michael Fogleman, MIT). The
//  model is lib/dla-engine.js through sim.js. Each frame grows the model in a
//  time budget (m.growFor), uploads the new particles (render.js sync) and
//  draws them. The view fits the cluster into the clear part of the canvas
//  (the part that the panel, the dock and the bars do not cover).
//
//  Modes
//    grow   the live growth, 2D or 3D, with the replay scrubber
//    walk   one walker in slow motion on a small 2D cluster (walk.js)
//  Colour: a "Colour by" mode (sim.js COLOUR_MODES) and a gradient from
//  lib/growth-gradients.js. A gradient change uploads the LUT, a mode change
//  uploads the values. Neither one regrows.
//
//  grep -n targets
//    state ................. "const S ="
//    a new model ........... "function regrow"
//    colour ................ "function applyColour"
//    margins ............... "function occlusion"
//    view .................. "function viewMatrix"
//    walker demo ........... "function walkStep"
//    frame loop ............ "function frame"
//    pointer input ......... "function bindPointer"
//    panel controls ........ "function buildUI"
//    CSV ................... "function updateCSV"
//    surface view .......... "function surfaceStep"
//    dock .................. "function buildDock"
//    screensaver ........... "window.snSaver"
//
//  Phone (layout.js): PHONE_Q is layout.js PHONE_QUERY. The dock has the
//  menu, the preset, the Lines or Surface switch, regrow and pause. The
//  framing margins come from occlusionOf (each overlay cuts its cheapest
//  edge). Two fingers pinch and pan the 2D view at the midpoint (pinch2D);
//  in 3D one finger orbits and two fingers zoom. The drawing buffer uses
//  dprCap (a phone draws the surface at 1.5 at most).
//
//  Surface view (Surface: Smooth): the cluster as a smooth SDF mesh.
//  surface.js runs surface-core.js (lib/dla-sdf.js) in a module worker;
//  the brick records go to surface-render.js. The growth waits for the
//  mesher (at most LEAD particles ahead), so the surface grows live.
// ============================================================================
import { lut, cssGradient, mountGradientPicker, GRADIENTS } from '../../lib/growth-gradients.js';
import {
  PRESETS, presetById, createSim, COLOUR_MODES, modeInfo, valueOf, maxOf, fillValues,
  subtreePrefix, replayRange, csvTail, CSV_HEAD, engineExtract, DLAF_ADDPARTICLE, PARAM_INFO, DEFAULTS, rng,
} from './sim.js';
import { recordWalk, timeline, frameAt, overlay, CAPTIONS } from './walk.js';
import { clearRect, fit2D, ortho2D, fit3D, orbitMatrix, ease } from './camera.js';
import { planShots, paceTarget, frameShot, shotLabel } from './saver.js';
import { createRenderer } from './render.js';
import { createSurface } from './surface.js';
import { createSurfaceRenderer } from './surface-render.js';
import { surfaceFrame } from './surface-frame.js';
import { surfaceOptions, surfaceCap, RESOLUTIONS, SURFACE_DEFAULTS, PHONE_RES_CAP, RES_IDS } from './surface-core.js';
import { MATERIALS, materialById } from './surface-shaders.js';
import { relief2D } from './camera.js';
import { PHONE_QUERY, occlusionOf, dprCap, pinch2D, zoomAt, sheetSnap } from './layout.js';

export { S };

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia(PHONE_QUERY);
const FOV = 0.8;

const S = {
  mode: 'grow', dim: 2, preset: 'classic', params: Object.assign({}, DEFAULTS),
  colour: 'age', grad: 'inferno', rev: false,
  target: 25000, speed: 5, paused: false, seed: 1,
  m: null, sub: null, subAt: 0, vals: null,
  replay: null,                 // null = live; { k, playing }
  view: { cx: 0, cy: 0, scale: 1, ox: 0, oy: 0 }, viewInit: false,
  user: { zoom: 1, panX: 0, panY: 0 },
  cam: { yaw: 0.6, pitch: 0.35, dist: 120, ox: 0, oy: 0, fov: FOV, spin: 0.12, idleAt: 0 },
  walk: null, saver: null, saverOn: false,
  surf: { on: false, res: PHONE_Q.matches ? 'low' : SURFACE_DEFAULTS.res, blend: SURFACE_DEFAULTS.blend, flow: SURFACE_DEFAULTS.flow,
    material: SURFACE_DEFAULTS.material, sf: null, SR: null, err: null, minUp: 0, scanned: 0, finished: false, pending: [], key: '' },
};
if (/[?&]debug\b/.test(location.search)) window.dlaf = S;

const canvas = $('gl');
const R = createRenderer(canvas);
if (!R) $('nogl').hidden = false;

// ------------------------------------------------------------------ helpers
function setText(el, s) { if (typeof el === 'string') el = $(el); if (el && el.textContent !== s) el.textContent = s; }
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const mat = new Float32Array(16);

// ------------------------------------------------------------------ model
// A new model for the current preset, parameters, dim and a new seed.
function regrow(seed) {
  S.seed = seed ?? (1 + Math.floor(Math.random() * 1e9));
  const pr = presetById(S.preset);
  S.m = createSim({ preset: pr, seed: S.seed, params: S.params, dim: S.dim });
  S.sub = null; S.subAt = 0; S.replay = null;
  S.vals = new Float32Array(1024);
  if (R && S.mode === 'grow') R.setModel(S.m);
  surfaceReset();
  S.viewInit = false; S.user.zoom = 1; S.user.panX = 0; S.user.panY = 0;
  csvLast = -1;
  syncReplayUI();
}

// The colour value of a new particle, for render.js sync.
const valFn = i => valueOf(S.colour, R.model, i, S.sub);

// Recompute every value of the model on screen (a mode change, or the flow
// sizes) and upload them. k limits the flow sizes to the replay prefix.
function applyColour(k) {
  const m = R && R.model; if (!m) return;
  if (S.colour === 'flow') {
    S.sub = k != null && k < m.count ? subtreePrefix(m.parent, k, S.sub) : m.subtreeSizes(S.sub);
    S.subAt = performance.now();
  }
  if (!S.vals || S.vals.length < m.count) S.vals = new Float32Array(Math.max(1024, m.count * 2));
  fillValues(S.colour, m, S.vals, 0, m.count, S.sub);
  R.setValues(S.vals, m.count);
}

function applyGradient() {
  if (R) R.setLUT(lut(S.grad, 256, S.rev));
  $('lgBar').style.background = cssGradient(S.grad, S.rev);
  const c = modeInfo(S.colour);
  setText('lgTitle', 'Colour by ' + c.label.toLowerCase());
  setText('lgLo', c.lo); setText('lgHi', c.hi);
}

// ------------------------------------------------------------------ framing
// Overlay margins in CSS px (layout.js occlusionOf): each overlay cuts the
// edge strip that costs the least area. A closed sheet is off screen and
// cuts nothing. On a phone the legend strip under the topbar counts too.
const OVERLAYS = ['panel', 'dock', 'status', 'walkCap'].map(id => $(id)).concat([document.querySelector('.topbar')]).filter(Boolean);
function occlusion(w, h) {
  if (S.saverOn) return { l: 0, r: 0, t: 0, b: 0 };
  const rects = OVERLAYS.filter(el => !el.hidden).map(el => el.getBoundingClientRect());
  const o = occlusionOf(rects, w, h);
  const lg = $('legend').getBoundingClientRect();
  if (PHONE_Q.matches && lg.width > w * 0.5 && lg.bottom < h / 2) o.t = Math.max(o.t, lg.bottom + 6);
  return o;
}

// Set mat for model m: fit its frame box into rect, ease the view, then
// apply the user pan and zoom. Returns the CSS px per world unit at the
// cluster (for dot sizes).
function viewMatrix(m, rect, w, h, dt, boxOverride) {
  const box = boxOverride || m.preset.frame(m);
  if (m.dim === 3) {
    const r = Math.max(14, box.x1);
    const want = fit3D(r, rect, w, h, FOV) / S.user.zoom;
    const c = S.cam;
    c.dist = S.viewInit ? ease(c.dist, want, dt, 0.6) : want;
    c.ox = ease(c.ox, rect.x + rect.w / 2 - w / 2, dt, 0.3); c.oy = ease(c.oy, rect.y + rect.h / 2 - h / 2, dt, 0.3);
    if (!S.viewInit) { c.ox = rect.x + rect.w / 2 - w / 2; c.oy = rect.y + rect.h / 2 - h / 2; }
    S.viewInit = true;
    orbitMatrix(c, w, h, mat);
    return h / 2 / Math.tan(FOV / 2) / c.dist;
  }
  const f = fit2D(box, rect, w, h, 0.92), v = S.view;
  if (!S.viewInit) Object.assign(v, f);
  else { v.cx = ease(v.cx, f.cx, dt, 0.5); v.cy = ease(v.cy, f.cy, dt, 0.5); v.scale = ease(v.scale, f.scale, dt, 0.5); v.ox = ease(v.ox, f.ox, dt, 0.3); v.oy = ease(v.oy, f.oy, dt, 0.3); }
  S.viewInit = true;
  const u = S.user;
  ortho2D({ cx: v.cx + u.panX, cy: v.cy + u.panY, scale: v.scale * u.zoom, ox: v.ox, oy: v.oy }, w, h, mat);
  return v.scale * u.zoom;
}

// ------------------------------------------------------------------ walker demo
const WCOL = { walker: [1, 1, 1], ring: [0.4, 0.9, 1], jump: [0.55, 1, 0.5], push: [1, 0.35, 0.35], join: [1, 0.85, 0.3], trail: [0.9, 0.88, 1], bound: [0.6, 0.55, 0.7] };
const KIND_TITLE = { start: 'Start', jump: 'Jump', step: 'Step', push: 'Push-back', reset: 'Reset', join: 'Join' };

function newWalkCluster(seed) {
  const params = Object.assign({}, S.params, { stickiness: Math.min(0.4, S.params.stickiness) });
  const m = createSim({ preset: 'classic', seed: seed ?? (1 + Math.floor(Math.random() * 1e9)), params, dim: 2 });
  m.grow(259);
  return m;
}
function startWalk(newCluster, seed) {
  const w = S.walk || (S.walk = { m: null, rec: null, times: null, t: 0, hold: 0, slow: 1, n: 0 });
  if (newCluster || !w.m || w.m.count > 900) { w.m = newWalkCluster(seed); w.n = 0; }
  if (R) R.setModel(w.m);
  nextWalker();
}
function nextWalker() {
  const w = S.walk;
  w.rec = recordWalk(w.m); w.times = timeline(w.rec); w.t = 0; w.hold = 0; w.n++;
  if (R) R.sync(valFn);
  applyColour();
}
// One frame of the walker demo. Returns { k, overlay } for the draw.
function walkStep(dt, px) {
  const w = S.walk, rec = w.rec;
  w.t += dt * (S.saverOn ? 1.6 : w.slow);
  const fr = frameAt(w.times, w.t);
  if (fr.done) { w.hold += dt; if (w.hold > 1.4) nextWalker(); }
  const ev = rec.events[fr.i] || rec.events[0];
  const joined = ev && ev.kind === 'join' && (fr.f > 0.6 || fr.done);
  const k = joined ? w.m.count : w.m.count - 1;
  if (!S.saverOn) {
    setText('wcKind', KIND_TITLE[ev.kind] || '');
    const extra = ev.kind === 'jump' || ev.kind === 'step' ? ` · jump ${ev.r.toFixed(2)}` : '';
    setText('wcNum', `walker ${w.n} · event ${fr.i + 1} of ${rec.events.length}${rec.cut ? ` (${rec.cut} cut)` : ''} · d ${ev.d.toFixed(2)}${extra}`);
    setText('wcText', CAPTIONS[ev.kind] || '');
  }
  return { k, overlay: overlay(w.m, rec, fr, WCOL, { px, walkerPx: 9 }), kind: ev.kind };
}

// ------------------------------------------------------------------ CSV
let csvLast = -1, csvAt = 0;
function updateCSV(force) {
  const m = S.m; if (!m) return;
  const k = S.replay ? S.replay.k : m.count;
  const now = performance.now();
  if (!force && (k === csvLast || now - csvAt < 100)) return;
  csvAt = now;
  const fresh = Math.max(0, k - Math.max(0, csvLast));
  csvLast = k;
  const lines = csvTail(m, 11, k).trimEnd().split('\n');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  $('csv').innerHTML = `<span class="cmt">${esc(CSV_HEAD)}\n$ tail -f output.csv</span>\n` +
    lines.map((l, i) => i >= lines.length - Math.min(fresh, 4) ? `<span class="new">${esc(l)}</span>` : esc(l)).join('\n');
}
function downloadCSV() {
  const m = S.m; if (!m) return;
  const k = S.replay ? S.replay.k : m.count;
  const blob = new Blob([m.toCSV(0, k)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `dlaf-${S.preset}-${S.dim}d-${k}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------------ replay
function syncReplayUI() {
  const m = S.m, n = m ? m.count : 0, k = S.replay ? Math.floor(S.replay.k) : n;
  const sl = $('replay');
  sl.value = String(Math.round((n ? k / n : 1) * 1000));
  setText('replayV', `${fmt(k)} / ${fmt(n)}`);
  $('replayLive').classList.toggle('on', !S.replay);
  $('replayPlay').classList.toggle('on', !!(S.replay && S.replay.playing));
}

// ------------------------------------------------------------------ surface
// The surface view is live in grow mode only (the walker demo stays lines).
const surfActive = () => S.surf.on && S.mode === 'grow' && !S.surf.err && !!R;

// Make the worker client and the GL side on first use. A shader or
// context failure turns the surface off and says why.
function surfaceInit() {
  const u = S.surf;
  if (u.SR || u.err || !R) return !!u.SR;
  try {
    u.SR = createSurfaceRenderer(R, { phone: PHONE_Q.matches });
    u.sf = createSurface();
  } catch (e) {
    u.err = String(e && e.message || e).slice(0, 160); u.on = false;
    setText('surfHint', 'The surface view did not start: ' + u.err);
    syncSurfaceUI();
  }
  return !!u.SR;
}

function surfOpts() {
  const m = S.m, u = S.surf;
  return surfaceOptions({ res: u.res, blend: u.blend, flow: u.flow, spacing: m ? m.params.particleSpacing : 1, phone: PHONE_Q.matches });
}

// A new surface for the model on screen: a regrow, or a new blend, flow
// strength or resolution. The particles go to the mesher again from id 0.
function surfaceReset() {
  const u = S.surf;
  if (!u.on || !surfaceInit()) return;
  u.sf.reset(surfOpts());
  u.pending = []; u.scanned = 0; u.minUp = 0; u.finished = false;
  u.SR.clear();
}

// One frame of the surface: send new particles, run the inline core if
// there is no worker, upload the records that arrived (at most about
// 160k vertices a frame, so a full rebuild does not stall one frame).
function surfaceStep() {
  const u = S.surf, m = S.m;
  u.sf.push(m);
  u.sf.tick(PHONE_Q.matches ? 5 : 7);
  const t = u.sf.take();
  if (t.cleared) { u.SR.clear(); u.pending = []; }
  for (const r of t.list) u.pending.push(r);
  let budget = 160000, n = 0;
  while (n < u.pending.length && budget > 0) { budget -= u.pending[n].positions.length / 3 + 2000; n++; }
  if (n) { u.SR.upload(u.pending.slice(0, n)); u.pending = u.pending.slice(n); }
  // the lowest particle along up (3D floor height)
  for (let i = u.scanned; i < m.count; i++) { const y = m.pos[i * 3 + 1]; if (i === 0 || y < u.minUp) u.minUp = y; }
  u.scanned = m.count;
}

// How far the growth may run ahead of the mesher, and where it stops.
const LEAD = () => (S.dim === 3 ? 220 : 380) * (PHONE_Q.matches ? 0.6 : 1);
function surfaceLimit(m) {
  const u = S.surf;
  return Math.min(surfaceCap(m.dim, PHONE_Q.matches), Math.max(m.count, u.sf.applied + LEAD()));
}

function drawSurface(m, k, dt, growing) {
  const u = S.surf, c = modeInfo(S.colour), w = canvas.width, h = canvas.height;
  const opts = u.sf.opts || surfOpts();
  let center, radius;
  if (m.dim === 3) { center = [0, 0, 0]; radius = Math.max(4, m.boundingRadius); }
  else {
    const e = m.user.ext;                          // x0, x1, y0, y1 of the particles
    center = [(e[0] + e[1]) / 2, (e[2] + e[3]) / 2, 0];
    radius = Math.max(4, Math.hypot(e[1] - e[0], e[3] - e[2]) / 2);
  }
  let M = mat;
  if (m.dim === 2) {
    const v = S.view, us = S.user;
    M = relief2D({ cx: v.cx + us.panX, cy: v.cy + us.panY, scale: v.scale * us.zoom, ox: v.ox, oy: v.oy }, canvas.clientWidth, canvas.clientHeight, Math.max(16, opts.rMax * 8));
  }
  const f = surfaceFrame({
    dim: m.dim, mat: M, cam: S.cam, center, radius, minUp: u.minUp, opts, material: u.material, w, h,
    max: maxOf(S.colour, m, k), floor: c.floor, gamma: c.gamma, count: k,
    k: S.replay ? k : 1e9,
    glowN: Math.max(24, Math.min(420, k * 0.02)), glowStr: growing ? (S.colour === 'age' ? 1.1 : 0.45) : 0.12,
  });
  u.SR.draw(f);
}

// ------------------------------------------------------------------ frame
let lastT = 0, statusAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
  if (!R) return;
  if (S.saverOn && S.saver) S.saver.tick(dt, now);
  const dpr = R.resize(dprCap({ dpr: window.devicePixelRatio || 1, phone: PHONE_Q.matches, surface: surfActive() }));
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const rect = S.saverOn && S.saver ? S.saver.rect(w, h) : clearRect(w, h, occlusion(w, h));
  S.rect = rect;
  let k, ov = null, m;

  if (S.mode === 'walk' && S.walk) {
    m = S.walk.m;
    const r = m.boundingRadius * 1.08;
    const px = viewMatrix(m, rect, w, h, dt, { x0: -r, x1: r, y0: -r, y1: r });
    const st = walkStep(dt, px);
    k = st.k; ov = st.overlay;
  } else {
    m = S.m;
    const surf = surfActive() && surfaceInit();
    const stop = surf ? Math.min(S.target, surfaceCap(m.dim, PHONE_Q.matches)) : S.target;
    const growing = !S.paused && !S.replay && m.count < stop;
    if (growing && !S.saverOn) {
      let limit = Math.ceil(S.speed / 5 * (3 + m.count / 150) * (m.dim === 3 ? 0.5 : 1));
      if (surf) limit = Math.min(limit, surfaceLimit(m) - m.count);
      if (limit > 0) m.growFor(Math.min(12, 2 + S.speed * 1.2), limit);
    }
    R.sync(valFn);
    if (surf) {
      surfaceStep();
      if (!growing && !S.surf.finished && !S.saverOn) { S.surf.sf.finish(); S.surf.finished = true; }
      if (growing) S.surf.finished = false;
    }
    S.surfGrowing = growing;
    if (S.replay && S.replay.playing) {
      S.replay.k = Math.min(m.count, S.replay.k + Math.max(1, m.count * dt / 8));
      if (S.replay.k >= m.count) S.replay = null;
      syncReplayUI();
    }
    k = S.replay ? Math.floor(S.replay.k) : m.count;
    if (S.colour === 'flow' && now - S.subAt > (S.replay ? 120 : 300)) applyColour(S.replay ? k : null);
    if (m.dim === 3 && now - S.cam.idleAt > 2500) S.cam.yaw += dt * S.cam.spin * (S.saverOn ? 0.8 : 1);
    viewMatrix(m, rect, w, h, dt);
  }
  const c = modeInfo(S.colour);
  const pxu = m.dim === 3 ? null : (S.view.scale * S.user.zoom);
  const sp = m.params.particleSpacing;
  const dotPx = m.dim === 3 ? sp * 0.9 * (canvas.height / 2) / Math.tan(FOV / 2) : sp * 0.95 * pxu * dpr;
  if (S.mode === 'grow' && surfActive() && S.surf.SR) drawSurface(m, k, dt, S.surfGrowing);
  else R.draw({
    mat, k, max: maxOf(S.colour, m, k), floor: c.floor, gamma: c.gamma,
    dotPx: m.dim === 3 ? dotPx : (dotPx >= 1.5 ? Math.min(14 * dpr, dotPx) : 0), persp: m.dim === 3 ? 1 : 0,
    glowN: S.mode === 'walk' ? 6 : Math.max(24, Math.min(420, k * 0.02)),
    glowAlpha: S.colour === 'age' ? 0.55 : 0.32,
    lineAlpha: m.dim === 3 ? 0.55 : 0.9, dotAlpha: m.dim === 3 ? 0.7 : 0.95,
    overlay: ov, dpr,
  });

  if (!S.saverOn && now - statusAt > 200) {
    statusAt = now;
    const pr = presetById(S.preset);
    setText('stMain', S.mode === 'walk' ? 'How the walk works' : `${pr.name} · ${S.dim}D · ${fmt(k)} particles`);
    const sfx = surfActive() && S.surf.sf ? ` · mesh ${fmt(S.surf.sf.verts)} verts${S.surf.sf.busy ? ' · meshing' : ''}` : '';
    setText('stRight', `walks ${fmt(m.walks)} · resets ${fmt(m.resets)} · R ${m.boundingRadius.toFixed(1)}${sfx}`);
    if (surfActive()) {
      const cap = surfaceCap(m.dim, PHONE_Q.matches);
      setText('surfStat', S.target > cap ? `The surface growth stops at ${fmt(cap)} particles on this device.` : '');
    }
    if (!S.replay) syncReplayUI();
    $('dockPlay').textContent = S.paused ? '▶' : '❚❚';
    setText('pauseBtn', S.paused ? 'Resume' : 'Pause');
  }
  if (!S.saverOn && S.mode === 'grow' && $('csvBox').open !== false) updateCSV();
}

// ------------------------------------------------------------------ pointer
// One finger pans (2D) or orbits (3D). Two fingers pinch and pan the 2D
// view at their midpoint (layout.js pinch2D) and zoom the 3D view. The
// wheel zooms the 2D view at the cursor. A double tap fits the view again.
const is3D = () => { const m = S.mode === 'walk' && S.walk ? S.walk.m : S.m; return !!(m && m.dim === 3); };
function bindPointer() {
  const pts = new Map();
  let lastTap = 0;
  const local = e => { const q = canvas.getBoundingClientRect(); return [e.clientX - (q.left || 0), e.clientY - (q.top || 0)]; };
  canvas.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
    S.cam.idleAt = performance.now();
    $('hint').classList.add('gone');
    const t = performance.now();
    if (t - lastTap < 300 && pts.size === 1) { S.user.zoom = 1; S.user.panX = 0; S.user.panY = 0; }
    lastTap = t;
  });
  canvas.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    S.cam.idleAt = performance.now();
    if (pts.size >= 2) {
      const [a, b] = [...pts.entries()].slice(0, 2).map(([, q]) => q);
      const a0 = [a.x, a.y], b0 = [b.x, b.y];
      p.x = e.clientX; p.y = e.clientY;
      const a1 = [a.x, a.y], b1 = [b.x, b.y];
      if (is3D()) {
        const d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]), d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
        if (d0 > 1) S.user.zoom = Math.min(30, Math.max(0.3, S.user.zoom * d1 / d0));
      } else {
        const q = canvas.getBoundingClientRect(), ox = q.left || 0, oy = q.top || 0;
        const sh = v => [v[0] - ox, v[1] - oy];
        Object.assign(S.user, pinch2D(S.view, S.user, sh(a0), sh(b0), sh(a1), sh(b1), canvas.clientWidth, canvas.clientHeight));
      }
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (is3D()) {
      S.cam.yaw += dx * 0.006;
      S.cam.pitch = Math.max(-1.45, Math.min(1.45, S.cam.pitch + dy * 0.006));
    } else {
      const s = S.view.scale * S.user.zoom;
      S.user.panX -= dx / s; S.user.panY += dy / s;
    }
  });
  const up = e => { pts.delete(e.pointerId); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const ratio = Math.exp(-e.deltaY * 0.0015);
    if (is3D()) S.user.zoom = Math.min(30, Math.max(0.3, S.user.zoom * ratio));
    else { const c = local(e); Object.assign(S.user, zoomAt(S.view, S.user, c, c, ratio, canvas.clientWidth, canvas.clientHeight)); }
    S.cam.idleAt = performance.now();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { S.user.zoom = 1; S.user.panX = 0; S.user.panY = 0; });
}

// ------------------------------------------------------------------ UI
function setMode(mode) {
  S.mode = mode;
  $('modeGrow').classList.toggle('on', mode === 'grow');
  $('modeWalk').classList.toggle('on', mode === 'walk');
  $('walkCap').hidden = mode !== 'walk';
  $('walkBox').hidden = mode !== 'walk';
  S.viewInit = false; S.user.zoom = 1; S.user.panX = 0; S.user.panY = 0;
  if (mode === 'walk') { startWalk(false); if (PHONE_Q.matches && S.setOpen) S.setOpen(false); }
  else if (R) { R.setModel(S.m); R.sync(valFn); applyColour(); }
  syncDim();
}
function syncDim() {
  const pr = presetById(S.preset), flat = pr.id === 'ring' || pr.id === 'line';
  $('dim2').classList.toggle('on', S.dim === 2); $('dim3').classList.toggle('on', S.dim === 3);
  $('dim3').disabled = flat || S.mode === 'walk';
  $('dim2').disabled = pr.id === 'three' || S.mode === 'walk';
  setText('dimHint', S.mode === 'walk' ? 'The walker demo is 2D.' : flat ? 'This preset is 2D: its hooks start the walkers on a plane.' : pr.id === 'three' ? 'This preset is 3D.' : '');
  setText('hint', S.dim === 3 && S.mode === 'grow' ? 'drag to orbit · pinch or scroll to zoom · double-tap to fit' : 'drag to pan · pinch or scroll to zoom · double-tap to fit');
  const t = $('target');
  t.max = S.dim === 3 ? '30000' : '60000';
}
function setDim(d) {
  if (S.dim === d) return;
  S.dim = d;
  S.target = d === 3 ? Math.min(S.target, 12000) : Math.max(S.target, 25000);
  $('target').value = String(S.target); setText('targetV', fmt(S.target));
  syncDim(); regrow();
}

function selectPreset(id) {
  const pr = presetById(id);
  S.preset = pr.id;
  S.params = Object.assign({}, DEFAULTS, pr.params);
  S.dim = pr.dim;             // a preset starts in its own dim; the 3D button then applies
  if (pr.id === 'three') S.target = 12000;
  else if (S.dim === 2) S.target = Math.max(S.target, 20000);
  $('target').value = String(S.target); setText('targetV', fmt(S.target));
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.id === pr.id));
  if ($('dockPreset').value !== pr.id) $('dockPreset').value = pr.id;
  setText('hookName', 'Hook: ' + pr.hook);
  setText('presetNote', pr.note);
  setText('presetCode', pr.code.text);
  syncSliders(); syncDim();
  if (S.mode === 'walk') setMode('grow');
  regrow();
}

const sliders = {};
function syncSliders() {
  for (const p of PARAM_INFO) {
    const s = sliders[p.key]; if (!s) continue;
    s.inp.value = String(S.params[p.key]); s.out.textContent = fmtParam(p, S.params[p.key]);
  }
}
function fmtParam(p, v) { return p.step >= 1 ? String(Math.round(v)) : (+v).toFixed(2); }

function setColour(id) {
  S.colour = modeInfo(id).id;
  document.querySelectorAll('#colourModes button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.colour));
  setText('colourHint', modeInfo(S.colour).text);
  applyColour(S.replay ? Math.floor(S.replay.k) : null);
  applyGradient();
}

function syncSurfaceUI() {
  const u = S.surf;
  $('surfOff').classList.toggle('on', !u.on); $('surfOn').classList.toggle('on', u.on);
  const ds = $('dockSurf');
  ds.classList.toggle('on', u.on); setText(ds, u.on ? 'Surface' : 'Lines'); ds.setAttribute('aria-pressed', String(u.on));
  $('surfBox').hidden = !u.on;
  document.querySelectorAll('#materials button').forEach(b => b.classList.toggle('on', b.dataset.id === u.material));
  const cap = PHONE_Q.matches ? RES_IDS.indexOf(PHONE_RES_CAP) : RES_IDS.length - 1;
  document.querySelectorAll('#surfRes button').forEach(b => { b.classList.toggle('on', b.dataset.id === u.res); b.disabled = RES_IDS.indexOf(b.dataset.id) > cap; });
  setText('surfBlendV', (+u.blend).toFixed(2)); setText('surfFlowV', (+u.flow).toFixed(2));
}
function setSurface(on) {
  const u = S.surf;
  u.on = !!on && !u.err;
  if (u.on) { if (S.mode === 'walk') setMode('grow'); surfaceReset(); }
  syncSurfaceUI();
}

function buildUI() {
  // presets
  const pb = $('presets');
  for (const pr of PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = pr.id; b.textContent = pr.name; b.title = 'Hook: ' + pr.hook;
    b.addEventListener('click', () => selectPreset(pr.id));
    pb.appendChild(b);
  }
  // the five dlaf parameters
  const box = $('params');
  for (const p of PARAM_INFO) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label>${p.dlaf}</label><input type="range" min="${p.min}" max="${p.max}" step="${p.step}"><span class="val"></span><span class="tip">${p.text}</span>`;
    const inp = row.querySelector('input'), out = row.querySelector('.val');
    inp.setAttribute('aria-label', p.dlaf);
    inp.addEventListener('input', () => { S.params[p.key] = +inp.value; out.textContent = fmtParam(p, +inp.value); });
    inp.addEventListener('change', () => { if (S.mode === 'walk') startWalk(true); else regrow(); });
    sliders[p.key] = { inp, out };
    box.appendChild(row);
  }
  const tg = $('target'), sp = $('speed');
  tg.addEventListener('input', () => { S.target = +tg.value; setText('targetV', fmt(S.target)); });
  sp.addEventListener('input', () => { S.speed = +sp.value; setText('speedV', String(S.speed)); });
  setText('targetV', fmt(S.target)); setText('speedV', String(S.speed));
  $('regrowBtn').addEventListener('click', () => { if (S.mode === 'walk') startWalk(true); else regrow(); });
  $('dockRegrow').addEventListener('click', () => { if (S.mode === 'walk') startWalk(true); else regrow(); });
  const togglePause = () => { S.paused = !S.paused; };
  $('pauseBtn').addEventListener('click', togglePause);
  $('dockPlay').addEventListener('click', togglePause);
  $('modeGrow').addEventListener('click', () => setMode('grow'));
  $('modeWalk').addEventListener('click', () => setMode('walk'));
  $('dim2').addEventListener('click', () => setDim(2));
  $('dim3').addEventListener('click', () => setDim(3));

  // colour by (the sheet)
  for (const c of COLOUR_MODES) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = c.id;
    b.textContent = c.label; b.title = c.text;
    b.addEventListener('click', () => setColour(c.id));
    $('colourModes').appendChild(b);
  }
  buildDock();
  mountGradientPicker($('gradPick'), {
    value: S.grad, reversed: S.rev, label: 'Choose a gradient',
    onChange(id, rev) { S.grad = id; S.rev = rev; applyGradient(); },
  });

  // replay
  const rs = $('replay');
  rs.addEventListener('input', () => {
    if (S.mode !== 'grow') return;
    const r = replayRange(+rs.value / 1000, S.m.count);
    S.replay = { k: r.k, playing: false };
    setText('replayV', `${fmt(r.k)} / ${fmt(S.m.count)}`);
    $('replayLive').classList.remove('on');
    if (S.colour === 'flow') applyColour(r.k);
    updateCSV(true);
  });
  $('replayPlay').addEventListener('click', () => { if (S.mode === 'walk') setMode('grow'); S.replay = { k: 0, playing: true }; syncReplayUI(); });
  $('replayLive').addEventListener('click', () => { S.replay = null; if (S.colour === 'flow') applyColour(); syncReplayUI(); updateCSV(true); });

  // walker
  const ws = $('walkSpeed');
  ws.addEventListener('input', () => { if (S.walk) S.walk.slow = +ws.value; setText('walkSpeedV', '×' + ws.value); });
  setText('walkSpeedV', '×1');
  $('walkNext').addEventListener('click', () => { if (S.walk) nextWalker(); });
  $('walkNew').addEventListener('click', () => startWalk(true));

  // surface view
  $('surfOff').addEventListener('click', () => setSurface(false));
  $('surfOn').addEventListener('click', () => setSurface(true));
  $('dockSurf').addEventListener('click', () => setSurface(!S.surf.on));
  for (const mt of MATERIALS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = mt.id; b.textContent = mt.label;
    b.addEventListener('click', () => { S.surf.material = mt.id; syncSurfaceUI(); });
    $('materials').appendChild(b);
  }
  for (const r of RESOLUTIONS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = r.id; b.textContent = r.label;
    b.addEventListener('click', () => { S.surf.res = r.id; syncSurfaceUI(); surfaceReset(); });
    $('surfRes').appendChild(b);
  }
  for (const [id, key] of [['surfBlend', 'blend'], ['surfFlow', 'flow']]) {
    const inp = $(id);
    inp.value = String(S.surf[key]);
    inp.addEventListener('input', () => { S.surf[key] = +inp.value; syncSurfaceUI(); });
    inp.addEventListener('change', () => surfaceReset());
  }
  syncSurfaceUI();

  $('csvBtn').addEventListener('click', downloadCSV);
  // the CSV stream and the source extracts fold away on a phone
  const folds = [$('csvBox'), $('codeBox')];
  const setFolds = phone => folds.forEach(d => { d.open = !phone; });
  setFolds(PHONE_Q.matches);
  $('csvBox').addEventListener('toggle', () => { if ($('csvBox').open) updateCSV(true); });
  $('cppCode').textContent = DLAF_ADDPARTICLE;

  // panel, sheet and dock (the pattern of pages/wave-membrane)
  const panel = $('panel'), dockPanel = $('dockPanel');
  function setOpen(open) {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
  }
  S.setOpen = setOpen;
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); setFolds(e.matches); });
  const grip = $('sheetGrip');
  let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    const next = sheetSnap(panel.classList.contains('full') ? 'full' : 'half', dy);
    if (next === 'closed') setOpen(false);
    else panel.classList.toggle('full', next === 'full');
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });
  setTimeout(() => $('hint').classList.add('gone'), 6000);
}

// The phone dock: menu (bound in buildUI), preset, Lines or Surface, regrow,
// pause. The preset is a native <select>, so a phone shows its own picker.
function buildDock() {
  const sel = $('dockPreset');
  for (const pr of PRESETS) {
    const o = document.createElement('option'); o.value = pr.id; o.textContent = pr.name;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => selectPreset(sel.value));
}

// ------------------------------------------------------------------ boot
buildUI();
selectPreset('classic');
setColour('age');
$('jsCode').textContent = engineExtract(S.m);
bindPointer();
requestAnimationFrame(frame);

// ------------------------------------------------------------------ screensaver
// lib/screensaver.js has the protocol. A seeded shuffle of shots (saver.js
// SHOTS) cuts every 5 to 12 s. Each shot is a fresh growth from a seed,
// paced so that the target count arrives near the end of the shot, framed in
// the clear band of the label plate (plateBand, read 4 times a second).
window.snSaver = {
  async enter(opts = {}) {
    let plateBand = null;
    try { plateBand = (await import('../../lib/saver-clear.js')).plateBand; } catch (e) { /* no band: the full frame */ }
    const keep = { grad: S.grad, rev: S.rev, colour: S.colour, surf: S.surf.on, material: S.surf.material };
    S.saverKeep = keep;
    document.documentElement.classList.add('saver');
    if (S.setOpen) S.setOpen(false);
    S.saverOn = true;
    const plan = planShots(opts.seed ?? 1, opts.calm ?? 0.7, 40);
    const code = engineExtract(S.m);
    let i = -1, t = 0, band = null, bandAt = -1e9, labelAt = 0;
    const sv = S.saver = {
      shot: null,
      rect(w, h) {
        const now = performance.now();
        if (plateBand && now - bandAt > 250) { bandAt = now; try { band = plateBand(h); } catch (e) { band = null; } }
        const f = frameShot({ x0: -1, x1: 1, y0: -1, y1: 1 }, w, h, band, 2);
        return f.rect;
      },
      next() {
        i = (i + 1) % plan.length; t = 0;
        const p = plan[i], sh = p.shot;
        sv.shot = p;
        S.grad = sh.grad; S.rev = false; S.colour = sh.mode;
        S.preset = sh.preset; S.params = Object.assign({}, DEFAULTS, presetById(sh.preset).params);
        S.dim = sh.dim || presetById(sh.preset).dim;
        S.cam.yaw = rng(p.seed)() * 6.28; S.cam.pitch = sh.surface ? 0.42 : 0.3; S.cam.idleAt = 0;
        S.surf.on = !!sh.surface && !S.surf.err;
        if (sh.material) S.surf.material = sh.material;
        if (sh.walker) { S.mode = 'walk'; S.walk = null; startWalk(true, p.seed); S.walk.slow = 1; }
        else { S.mode = 'grow'; regrow(p.seed); S.target = sh.target; }
        S.viewInit = false; S.user.zoom = 1; S.user.panX = 0; S.user.panY = 0;
        applyGradient(); applyColour();
        sv.label(true);
      },
      label(force) {
        if (!opts.label) return;
        const m = S.mode === 'walk' && S.walk ? S.walk.m : S.m;
        const now = performance.now();
        if (!force && now - labelAt < 500) return;
        labelAt = now;
        opts.label(shotLabel(sv.shot.shot, m, code));
      },
      tick(dt) {
        t += dt;
        const p = sv.shot;
        if (!p || t > p.dur) { sv.next(); return; }
        if (!p.shot.walker) {
          const m = S.m;
          let want = paceTarget(p.shot.target, t, p.dur);
          if (surfActive() && S.surf.sf) want = Math.min(want, surfaceLimit(m));
          if (m.count < want) m.growFor(11, want - m.count);
        }
        sv.label(false);
      },
    };
    sv.next();
    return { canvas, warmupMs: 600 };
  },
  exit() {
    S.saverOn = false; S.saver = null;
    document.documentElement.classList.remove('saver');
    S.mode = 'grow'; S.target = 25000;
    const keep = S.saverKeep || { grad: 'inferno', rev: false, colour: 'age' };
    S.grad = keep.grad; S.rev = keep.rev;
    S.surf.on = keep.surf && !S.surf.err; S.surf.material = keep.material || S.surf.material;
    selectPreset('classic'); setColour(keep.colour); syncSurfaceUI();
    if (S.setOpen) S.setOpen(!PHONE_Q.matches);
  },
};
