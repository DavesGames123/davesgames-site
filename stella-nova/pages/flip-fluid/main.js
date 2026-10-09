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
// ============================================================================
//  FLIP WATER  ·  main.js  —  page controller on the sim kit
// ----------------------------------------------------------------------------
//  The FLIP solver (flip.js) is a port of Ten Minute Physics #18 by
//  Matthias Müller (18-flip.html, MIT; notice above). The upstream page
//  code (WebGL draw, mouse obstacle, start button) is replaced. This file
//  and the other modules are our additions (davesgames.io).
//
//  GUI: the sim kit (widgets/sim-kit) owns the panel, the transport, the
//  seed, the share link and the screensaver director. scene.js turns the
//  kit state into the scenes.js state { seed, sub, locks, colours, over },
//  so the randomizer, presets and objects of scenes.js stay as they were:
//    - each scenes.js category is a kit group with a "Variant" control;
//      the group dice draws a new variant (scenes.js sub seed), the group
//      lock keeps it, "New scene" draws them all;
//    - the old Adjust sliders are kit controls with an "auto" end;
//    - the Look keys (view, water, map, reverse, background, tint, foam)
//      are kit controls; the background also sets the panel theme;
//    - the objects palette (tools.js) is the Objects group: arm a kind,
//      drop 3, eraser, clear.
//
//  Frame: requestAnimationFrame -> sim.step() (while kit.playing) -> draw.
//  Performance: the particle budget comes from the device. If the mean
//  step time stays above 22 ms, the page rebuilds the same scene with
//  0.7 x the budget (at most twice per scene).
//
//  grep -n targets
//    function deviceBudget     particle budget per device
//    function loadState        build + create the sim from a scenes state
//    function fromKit          kit state -> scenes state
//    function resize / fitTank canvas size and tank fit beside the panel
//    function onDown / onMove / onUp   pointer: tools.js first, else stir
//    function frame            the loop
//    window.ffApp              the app object (saver, debugging)
// ============================================================================
import { build, createSim } from './scenes.js';
import { createRenderer, fitView } from './render.js';
import { Solid } from './flip.js';
import { disc } from './shapes.js';
import { makeBodies, KINDS } from './bodies.js';
import { installTools } from './tools.js';
import { randomLook } from './looks.js';
import { installSaver } from './saver.js';
import { mount, isPhone } from '../../widgets/sim-kit/ui.js';
import * as SC from './scene.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d', { alpha: false });
const renderer = createRenderer(ctx);
const PHONE = isPhone();

if (window.TMP) TMP.page({ n: '18', title: 'FLIP Water', file: '18-flip.html', video: 'XmzBREkK8kY', year: 2022, licence: 'MIT' });

const app = {
  state: null, spec: null, sim: null, view: null, dpr: 1, portrait: false,
  budgetScale: 1, slowRebuilds: 0, stepMs: 0, frames: 0,
  stir: null, pointer: null, saver: false, kit: null,
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
  syncLook();
}
function fromKit() { return SC.toScenesState(app.kit.state, app.kit.seed); }
function syncLook() {
  app.drawOpts = Object.assign(app.drawOpts || {}, { colours: app.state.colours });
  document.documentElement.style.setProperty('--page-bg', SC.pageBg(app.state.colours));
}

// ---- size -------------------------------------------------------------------
function fitTank() {
  if (!app.sim) return;
  const d = app.dpr, cw = canvas.width, ch = canvas.height;
  let pad;
  if (app.saver && app.band) pad = { l: app.band.x * d, r: cw - (app.band.x + app.band.w) * d, t: app.band.y * d, b: ch - (app.band.y + app.band.h) * d };
  else if (app.saver) pad = { l: 0, r: 0, t: 0, b: 0 };
  else {
    const panel = document.getElementById('sk-panel'), tr = document.querySelector('.sk-transport');
    let x1 = innerWidth, y1 = innerHeight;
    if (app.kit && app.kit.panelOpen && panel && !PHONE) x1 = Math.max(innerWidth * 0.45, panel.getBoundingClientRect().left);
    if (tr) y1 = Math.min(y1, tr.getBoundingClientRect().top - 6);
    if (app.kit && app.kit.panelOpen && PHONE && panel) y1 = Math.min(y1, panel.getBoundingClientRect().top);
    pad = { l: 10 * d, r: (innerWidth - x1 + 10) * d, t: 56 * d, b: (innerHeight - y1 + 6) * d };
  }
  app.view = fitView(app.spec.W, app.spec.H, cw, ch, pad);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  app.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(w * app.dpr));
  canvas.height = Math.max(1, Math.round(h * app.dpr));
  const portrait = h > w * 1.05;
  if (app.state && portrait !== app.portrait) { app.portrait = portrait; loadState(app.state, true); }
  app.portrait = portrait;
  fitTank();
}

// ---- pointer: tools first, else stir ---------------------------------------------
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
  e.preventDefault && e.preventDefault();
}
function onMove(e) {
  if (!app.pointer || e.pointerId !== app.pointer.id) return;
  app.pointer.p = clampIn(toSim(e));
  if (app.tools && app.tools.move) app.tools.move(app.pointer.p, e);
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
// The stir disc moves toward the pointer in one frame, at most 0.3 m.
function aimStir() {
  const s = app.stir;
  if (!s || !app.pointer) return;
  s.from = { x: s.x, y: s.y };
  let dx = app.pointer.p.x - s.x, dy = app.pointer.p.y - s.y;
  const L = Math.hypot(dx, dy), M = 0.3;
  if (L > M) { dx *= M / L; dy *= M / L; }
  s.to = { x: s.x + dx, y: s.y + dy }; s.t0 = app.sim.time;
}

// ---- loop ----------------------------------------------------------------------------
function stepOnce() {
  aimStir();
  if (app.beforeStep) app.beforeStep();
  const t0 = performance.now();
  app.sim.step();
  const ms = performance.now() - t0;
  app.stepMs = app.frames ? app.stepMs * 0.95 + ms * 0.05 : ms;
  app.frames++;
}
let lastT = 0, acc = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (app.pendingRebuild) { app.pendingRebuild = false; loadState(fromKit()); }
  const sim = app.sim;
  if (!sim) return;
  const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
  if (app.kit.playing) {
    // kit.speed: slow motion runs fewer steps per second (one step a frame at 1x)
    acc += app.kit.speed; let n = 0;
    while (acc >= 1 && n < 2) { stepOnce(); acc -= 1; n++; }
    if (app.frames === 150 && app.stepMs > 22 && app.slowRebuilds < 2 && !app.saver) {
      app.slowRebuilds++; app.budgetScale *= 0.7; loadState(app.state, true); return;
    }
  } else if (app.kit.takeStep()) stepOnce();
  if (app.saverTick) app.saverTick(dt);
  fitTank();
  let view = app.view;
  if (app.zoom && app.zoom.k > 1.001) {
    // saver close-ups: scale about the tank centre, then centre the target
    const z = app.zoom, v = app.view, s = v.s * z.k;
    const cx = v.x + v.W * v.s / 2, cy = v.y + v.H * v.s / 2;
    view = { s, W: v.W, H: v.H, x: cx - z.x * s, y: cy - (v.H - z.y) * s };
  }
  renderer.draw(app.sim, view, app.drawOpts || {});
}

// ---- start ------------------------------------------------------------------------------
const hold = {};
const stubEl = () => ({ children: [], classList: { toggle() {}, add() {}, remove() {} }, style: {}, dataset: {}, setAttribute() {}, appendChild(c) { this.children.push(c); return c; }, querySelectorAll() { return []; }, set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; }, set onclick(f) { this._f = f; } });
const $ = id => (hold[id] = hold[id] || stubEl());   // tools.js writes its old palette into detached stubs
app.kit = mount({
  schema: SC.makeSchema(PHONE), title: 'FLIP Water', sub: 'Particles carry the water; a grid solves the pressure', panelTitle: 'Scene',
  guard: SC.guard, randomStart: false, themeKey: 'theme',
  footer: 'FLIP solver by Matthias Müller (Ten Minute Physics 18, MIT). Scenes, bodies, looks and GUI: davesgames.io.',
  actions: {
    arm(kind) {
      const T = app.objects.state; T.armed = T.armed === kind ? null : kind; T.erase = false; app.kit.set('erase', false);
      app.kit.say(T.armed ? `Tap the water to drop a ${KINDS[kind].name.toLowerCase()}. Pick it again to stop.` : 'Dropping off.');
      if (T.armed && PHONE) app.kit.setPanel(false);
    },
    objs(id) { if (id === 'drop3') app.objects.dropRandom(3); else if (id === 'clearObj') app.objects.clearObjects(); },
    look() { lookDice(); },
  },
});
app.kit.on('change', (out, st, why) => {
  if (why === 'saver') return;
  if ('bg' in out && why === 'input') app.kit.set('theme', SC.themeForBg(st.bg));
  if ('erase' in out) { const T = app.objects.state; T.erase = !!st.erase; if (T.erase) T.armed = null; }
  const next = fromKit();
  if (why === 'scene' || why === 'group' || why === 'hash' || why === 'load' || Object.keys(out).some(k => SC.REBUILD.has(k))) { loadState(next); return; }
  // live: the look and the adjust controls
  app.state.colours = next.colours; app.state.over = next.over; syncLook();
  for (const k of Object.keys(out)) if (SC.OVER_KEYS.has(k)) applyOver(SC.overKey(k), next.over[SC.overKey(k)]);
});
app.kit.on('scene', () => loadState(fromKit()));
app.kit.on('reset', () => loadState(fromKit(), true));
function lookDice() { const L = randomLook(); for (const [k, v] of Object.entries(SC.lookToKit(L))) app.kit.set(k, v); }
const SPEC_KEY = { flip: 'flip', g: 'g', tilt: 'tilt', damping: 'damping', viscosity: 'viscosity', wind: 'wind', stiffness: 'stiffness', pressureIters: 'pressureIters' };
function applyOver(k, v) {
  const sim = app.sim;
  if (v == null) { loadState(fromKit(), true); return; }   // back to auto: the scene's own value
  if (k === 'flip') sim.flipRatio = v;
  else if (k === 'damping') sim.damping = v;
  else if (k === 'viscosity') sim.viscosity = v;
  else if (k === 'wind') sim.wind = v;
  else if (k === 'stiffness') sim.stiffness = v;
  else if (k === 'pressureIters') sim.numPressureIters = Math.round(v);
  if (k === 'g' || k === 'tilt') { app.spec[k] = v; sim.gx = app.spec.g * Math.sin(app.spec.tilt); sim.gy = -app.spec.g * Math.cos(app.spec.tilt); }
  else app.spec[SPEC_KEY[k]] = v;
}
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = String(e.key || '').toLowerCase();
  // upstream keys P (pause) and M (one step); L random look; the rest in tools.js
  if (k === 'p') app.kit.playing = !app.kit.playing;
  else if (k === 'm') { app.kit.playing = false; stepOnce(); }
  else if (k === 'l') lookDice();
  else if (app.onKey) app.onKey(k, e);
});

app.loadState = loadState; app.resize = resize; app.fitTank = fitTank; app.syncLook = syncLook;
app.renderer = renderer; app.ctx = ctx; app.canvas = canvas;
app.objectSummary = () => {
  const n = {};
  for (const o of app.spec.objects) n[o.kind] = (n[o.kind] || 0) + 1;
  const parts = Object.entries(n).map(([k, c]) => `${c} ${(KINDS[k] ? KINDS[k].name : k).toLowerCase()}${c > 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : 'none';
};
app.openPanel = on => app.kit.setPanel(on);
installTools(app, $);
installSaver(app);
resize();
addEventListener('resize', resize);
loadState(fromKit());
requestAnimationFrame(frame);
addEventListener('pagehide', () => { app.kit.playing = false; });
