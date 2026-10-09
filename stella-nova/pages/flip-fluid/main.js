/*
Copyright 2022 Matthias Müller - Ten Minute Physics,
www.youtube.com/c/TenMinutePhysics
www.matthiasMueller.info/tenMinutePhysics

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// ============================================================================
//  FLIP WATER  ·  main.js  —  page controller
// ----------------------------------------------------------------------------
//  The FLIP solver (flip.js) is a port of Ten Minute Physics #18 by
//  Matthias Müller (18-flip.html, MIT; notice above). The upstream page
//  code (WebGL draw, mouse obstacle, start button) is replaced. This file
//  and the other modules are our additions (davesgames.io): the scene
//  starts on load and keeps running, the seeded randomizer, the UI and the
//  pointer tools.
//
//  Frame: requestAnimationFrame -> sim.step() (unless paused) -> draw.
//  State: scenes.js state { seed, sub, locks, colours, over }; every change
//  writes the URL hash (history.replaceState), and a typed hash loads.
//
//  Performance: the particle budget comes from the device (phones are
//  lighter). If the mean step time stays above 22 ms, the page rebuilds
//  the same scene with 0.7 x the budget (at most twice per scene).
//
//  grep -n targets
//    function deviceBudget     particle budget per device
//    function loadState        build + create the sim
//    function resize           canvas size x devicePixelRatio, tank fit
//    function toSim            pointer -> sim coordinates
//    function onDown / onMove / onUp   stir tool (tools.js goes first:
//                              grab, drop, erase)
//    function buildCats        category rows (dice + lock)
//    function buildSliders     overrides
//    function frame            the loop
//    window.ffApp              the app object (saver, debugging)
//  Other modules: tools.js (objects palette, grab, drop, erase),
//  lookui.js (colours and views; state.colours)
// ============================================================================
import { build, createSim, CATS, CAT_NAMES, encodeHash, decodeHash, rollAll, rollCat, newSeed, OVERRIDES } from './scenes.js';
import { createRenderer, fitView } from './render.js';
import { Solid } from './flip.js';
import { disc } from './shapes.js';
import { makeBodies, KINDS } from './bodies.js';
import { installTools } from './tools.js';
import { installLook } from './lookui.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d', { alpha: false });
const renderer = createRenderer(ctx);

if (window.TMP) TMP.page({ n: '18', title: 'FLIP Water', file: '18-flip.html', video: 'XmzBREkK8kY', year: 2022, licence: 'MIT' });

const app = {
  state: null, spec: null, sim: null, view: null, dpr: 1, portrait: false,
  paused: false, budgetScale: 1, slowRebuilds: 0, stepMs: 0, frames: 0,
  stir: null, pointer: null, saver: false,
};
window.ffApp = app;

function deviceBudget() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  const cores = navigator.hardwareConcurrency || 4;
  const b = coarse && small ? 6500 : coarse ? 10000 : cores >= 8 ? 20000 : 13000;
  return Math.round(b * app.budgetScale);
}

function loadState(state, keepBudget) {
  app.state = state;
  if (!keepBudget) { app.budgetScale = Math.min(app.budgetScale, 1); app.slowRebuilds = 0; }
  app.spec = build(state, { portrait: app.portrait, budget: deviceBudget() });
  app.sim = createSim(app.spec, makeBodies);
  app.stir = null;
  app.frames = 0; app.stepMs = 0;
  fitTank();
  writeHash();
  refreshUI();
  if (app.syncLook) app.syncLook();
}

function writeHash() {
  const h = encodeHash(app.state);
  if (location.hash !== h) { try { history.replaceState(null, '', h); } catch (e) { /* file:// */ } }
  app.lastHash = h;
}

// ---- size -------------------------------------------------------------------
function measureBars() {
  const cb = document.getElementById('tmp-credit');
  document.documentElement.style.setProperty('--credit-h', (cb ? cb.offsetHeight : 0) + 'px');
  document.documentElement.style.setProperty('--dock-h', $('dock').offsetHeight + 'px');
}

function fitTank() {
  if (!app.sim) return;
  const d = app.dpr, cw = canvas.width, ch = canvas.height;
  const dock = app.saver ? 0 : $('dock').offsetHeight + 14;
  const top = app.saver ? 0 : 40;
  app.view = fitView(app.spec.W, app.spec.H, cw, ch, { l: 10 * d, r: 10 * d, t: top * d, b: dock * d });
}

function resize() {
  measureBars();
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  app.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(w * app.dpr));
  canvas.height = Math.max(1, Math.round(h * app.dpr));
  const portrait = h > w * 1.05;
  if (app.state && portrait !== app.portrait) { app.portrait = portrait; loadState(app.state, true); }
  app.portrait = portrait;
  fitTank();
}

// ---- pointer: stir ---------------------------------------------------------------
function toSim(e) {
  const r = canvas.getBoundingClientRect(), v = app.view;
  const px = (e.clientX - r.left) * app.dpr, py = (e.clientY - r.top) * app.dpr;
  return { x: (px - v.x) / v.s, y: v.H - (py - v.y) / v.s };
}
function clampIn(p) {
  const s = app.sim, m = 2 * s.h;
  p.x = Math.min(app.spec.W - m, Math.max(m, p.x)); p.y = Math.min(app.spec.H - m, Math.max(m, p.y));
  return p;
}
function makeStir(p) {
  const sim = app.sim, R = 0.06 * Math.min(app.spec.W, app.spec.H);
  const s = new Solid(disc(R), p.x, p.y);
  s.kind = 'stir'; s.from = { x: p.x, y: p.y }; s.to = { x: p.x, y: p.y }; s.t0 = sim.time;
  s.motion = (t, so) => {
    const u = Math.min(1, Math.max(0, (t - so.t0) / sim.dt));
    so.x = so.from.x + (so.to.x - so.from.x) * u; so.y = so.from.y + (so.to.y - so.from.y) * u;
  };
  return sim.addSolid(s);
}
function onDown(e) {
  if (!app.sim || app.saver) return;
  canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  const p = clampIn(toSim(e));
  app.pointer = { id: e.pointerId, p };
  if (app.tools && app.tools.down && app.tools.down(p, e)) return;
  app.stir = makeStir(p);
  e.preventDefault();
}
function onMove(e) {
  if (!app.pointer || e.pointerId !== app.pointer.id) return;
  app.pointer.p = clampIn(toSim(e));
  if (app.tools && app.tools.move && app.tools.move(app.pointer.p, e)) return;
}
function onUp(e) {
  if (!app.pointer || e.pointerId !== app.pointer.id) return;
  if (app.tools && app.tools.up) app.tools.up(app.pointer.p, e);
  if (app.stir) { app.sim.removeSolid(app.stir); app.stir = null; }
  app.pointer = null;
}
canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);

// Before each frame: the stir disc moves toward the pointer in one frame,
// at most 0.3 m per frame (a fast flick must not inject huge velocities).
function aimStir() {
  const s = app.stir;
  if (!s || !app.pointer) return;
  s.from = { x: s.x, y: s.y };
  let dx = app.pointer.p.x - s.x, dy = app.pointer.p.y - s.y;
  const L = Math.hypot(dx, dy), M = 0.3;
  if (L > M) { dx *= M / L; dy *= M / L; }
  s.to = { x: s.x + dx, y: s.y + dy }; s.t0 = app.sim.time;
}

// ---- UI ----------------------------------------------------------------------------
function fmt(x, d = 2) { return (+x).toFixed(d); }
function summary(cat) {
  const s = app.spec, sim = app.sim;
  switch (cat) {
    case 'tank': return `${fmt(s.W, 1)} × ${fmt(s.H, 1)} m · ${sim.fNumX} × ${sim.fNumY} cells`;
    case 'water': return s.waterKind + (s.gate ? ' · sluice gate' : '');
    case 'obstacles': return s.statics.length ? [...new Set(s.statics.map(x => x.kind))].join(', ') : 'none';
    case 'gravity': return `${fmt(s.g)} m/s² · tilt ${fmt(s.tilt * 180 / Math.PI, 0)}°`;
    case 'particles': return `${sim.initialParticles} particles · r = ${fmt(s.r / s.h)} h`;
    case 'solver': return `FLIP ${fmt(s.flip)} · ${s.pressureIters} it · ω ${fmt(s.overRelax)} · drift ${s.compensate ? fmt(s.stiffness) : 'off'}`;
    case 'damping': return `damping ${fmt(s.damping)} /s · viscosity ${fmt(s.viscosity)}`;
    case 'flow': return `${s.emitters.length} emitter · ${s.drains.length} drain${s.paddle ? ' · paddle' : ''}${s.wind ? ' · wind ' + fmt(s.wind, 1) : ''}`;
    case 'time': return `dt 1/${Math.round(1 / s.dt)} · ${s.substeps} substep · CFL ${fmt(s.cfl, 1)}`;
    case 'objects': return app.objectSummary ? app.objectSummary() : '';
  }
  return '';
}

function buildCats() {
  const host = $('cats');
  host.textContent = '';
  for (const cat of app.cats || CATS) {
    const row = document.createElement('div');
    row.className = 'catrow';
    row.innerHTML = `<b></b><button class="dice" title="Roll this category">⚄</button><button class="lock" title="Lock this category">Lock</button><span class="sum"></span>`;
    row.querySelector('b').textContent = CAT_NAMES[cat] || cat;
    row.querySelector('.dice').onclick = () => loadState(rollCat(app.state, cat));
    row.querySelector('.lock').onclick = () => {
      const L = new Set(app.state.locks);
      if (L.has(cat)) L.delete(cat); else L.add(cat);
      app.state.locks = [...L]; writeHash(); refreshUI();
    };
    row.dataset.cat = cat;
    host.appendChild(row);
  }
}

const SPEC_KEY = { flip: 'flip', g: 'g', tilt: 'tilt', damping: 'damping', viscosity: 'viscosity', wind: 'wind', stiffness: 'stiffness', pressureIters: 'pressureIters' };
function applyOver(k, v) {
  const sim = app.sim;
  if (k === 'flip') sim.flipRatio = v;
  else if (k === 'damping') sim.damping = v;
  else if (k === 'viscosity') sim.viscosity = v;
  else if (k === 'wind') sim.wind = v;
  else if (k === 'stiffness') sim.stiffness = v;
  else if (k === 'pressureIters') sim.numPressureIters = Math.round(v);
  if (k === 'g' || k === 'tilt') {
    app.spec[k] = v;
    sim.gx = app.spec.g * Math.sin(app.spec.tilt); sim.gy = -app.spec.g * Math.cos(app.spec.tilt);
  } else app.spec[SPEC_KEY[k]] = v;
}
function buildSliders() {
  const host = $('sliders');
  host.textContent = '';
  for (const [k, [lo, hi, st, label]] of Object.entries(OVERRIDES)) {
    const d = document.createElement('div');
    d.className = 'slider'; d.dataset.k = k;
    d.innerHTML = `<label></label><output></output><input type="range">`;
    d.querySelector('label').textContent = label;
    const inp = d.querySelector('input');
    inp.min = lo; inp.max = hi; inp.step = st;
    inp.setAttribute('aria-label', label);
    inp.oninput = () => {
      const v = +inp.value;
      app.state.over[k] = v; applyOver(k, v);
      d.querySelector('output').textContent = fmt(v, st < 0.1 ? 2 : st < 1 ? 1 : 0);
      d.classList.add('set'); scheduleHash(); refreshSums();
    };
    host.appendChild(d);
  }
}
let hashTimer = 0;
function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(writeHash, 250); }

function refreshSums() {
  for (const row of $('cats').children) row.querySelector('.sum').textContent = summary(row.dataset.cat);
}
function refreshUI() {
  if (!app.spec) return;
  $('seedChip').textContent = app.state.seed;
  if (document.activeElement !== $('seedIn')) $('seedIn').value = app.state.seed;
  const L = new Set(app.state.locks);
  for (const row of $('cats').children) {
    const on = L.has(row.dataset.cat), b = row.querySelector('.lock');
    b.classList.toggle('on', on); b.textContent = on ? 'Locked' : 'Lock';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  refreshSums();
  for (const d of $('sliders').children) {
    const k = d.dataset.k, [, , st] = OVERRIDES[k];
    const v = app.state.over[k] != null ? app.state.over[k] : app.spec[SPEC_KEY[k]];
    d.querySelector('input').value = v;
    d.querySelector('output').textContent = fmt(v, st < 0.1 ? 2 : st < 1 ? 1 : 0);
    d.classList.toggle('set', app.state.over[k] != null);
  }
  $('bPlay').textContent = app.paused ? '▶' : '❚❚';
  $('bPlay').setAttribute('aria-label', app.paused ? 'Play' : 'Pause');
  if (app.onRefresh) app.onRefresh();
}

function newScene() { loadState(rollAll(app.state)); }
function togglePlay() { app.paused = !app.paused; refreshUI(); }
function stepOnce() { app.paused = true; aimStir(); app.sim.step(); refreshUI(); }
function reset() { loadState(app.state, true); }

$('bPlay').onclick = togglePlay;
$('bStep').onclick = stepOnce;
$('bReset').onclick = reset;
$('bNew').onclick = newScene;
$('seedChip').onclick = () => openPanel(true);
$('bPanel').onclick = () => openPanel(!$('panel').classList.contains('open'));
$('sheetGrip').onclick = () => $('panel').classList.toggle('full');
$('seedGo').onclick = () => { const v = $('seedIn').value.trim(); if (v) loadState({ seed: v.slice(0, 40), sub: {}, locks: app.state.locks, colours: app.state.colours, over: {} }); };
$('seedIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('seedGo').onclick(); e.stopPropagation(); });
$('seedRoll').onclick = newScene;
$('seedCopy').onclick = () => {
  writeHash();
  const b = $('seedCopy');
  const done = () => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Link'), 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, () => {}); else done();
};
$('clearOver').onclick = () => { app.state.over = {}; loadState(app.state, true); };
function openPanel(on) {
  $('panel').classList.toggle('open', on);
  $('bPanel').classList.toggle('on', on);
  $('bPanel').setAttribute('aria-expanded', on ? 'true' : 'false');
}

addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p' || k === ' ') { togglePlay(); e.preventDefault(); }
  else if (k === 'm') stepOnce();
  else if (k === 'r') reset();
  else if (k === 'n') newScene();
  else if (k === 'escape') openPanel(false);
  else if (app.onKey) app.onKey(k, e);
});
addEventListener('hashchange', () => {
  if (location.hash === app.lastHash) return;
  loadState(decodeHash(location.hash));
});

// ---- loop ----------------------------------------------------------------------------
let lastStats = 0, fps = 0, fpsN = 0, fpsT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const sim = app.sim;
  if (!sim) return;
  if (!app.paused) {
    aimStir();
    if (app.beforeStep) app.beforeStep();
    const t0 = performance.now();
    sim.step();
    const ms = performance.now() - t0;
    app.stepMs = app.frames ? app.stepMs * 0.95 + ms * 0.05 : ms;
    app.frames++;
    if (app.frames === 150 && app.stepMs > 22 && app.slowRebuilds < 2 && !app.saver) {
      app.slowRebuilds++; app.budgetScale *= 0.7; loadState(app.state, true); return;
    }
  }
  renderer.draw(app.sim, app.view, app.drawOpts || {});
  fpsN++;
  if (ts - fpsT > 1000) { fps = fpsN * 1000 / (ts - fpsT); fpsN = 0; fpsT = ts; }
  if (ts - lastStats > 500) {
    lastStats = ts;
    $('stats').textContent = `${sim.numParticles} particles · ${fmt(app.stepMs, 1)} ms · ${Math.round(fps)} fps`;
  }
}

// ---- start ------------------------------------------------------------------------------
app.cats = CATS.slice();
if (!app.cats.includes('objects')) app.cats.push('objects');
app.objectSummary = () => {
  const n = {};
  for (const o of app.spec.objects) n[o.kind] = (n[o.kind] || 0) + 1;
  const parts = Object.entries(n).map(([k, c]) => `${c} ${(KINDS[k] ? KINDS[k].name : k).toLowerCase()}${c > 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : 'none';
};
app.loadState = loadState; app.resize = resize; app.fitTank = fitTank; app.refreshUI = refreshUI;
app.renderer = renderer; app.ctx = ctx; app.canvas = canvas; app.newSeed = newSeed;
buildCats();
buildSliders();
app.openPanel = openPanel;
app.writeHash = writeHash;
installTools(app, $);
installLook(app, $);
resize();
addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
loadState(decodeHash(location.hash));
requestAnimationFrame(frame);
