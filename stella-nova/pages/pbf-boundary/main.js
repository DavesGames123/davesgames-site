// ============================================================================
//  PBF BOUNDARIES  ·  pages/pbf-boundary/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. The upstream demo is the Ten Minute Physics contribution
//  contribs/PBFBoundary.html by Sergii Biloshytskyi (Ukraine), copyright
//  2021 Matthias Müller - Ten Minute Physics, MIT License. Its particle
//  model (round container, turning disks, static and kinetic friction,
//  restitution through a velocity pass) lives on in solver.js, which keeps
//  the MIT notice. The credit bar (widgets/ten-minute-physics/kit.js) names
//  both authors on the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): the density-constrained
//  water mode, the containers, obstacles, emitters, paddle, floating and
//  sinking bodies, the renderer (render.js), this controller, the sim kit
//  GUI (widgets/sim-kit) and the screensaver (saver.js).
//
//  Flow: the sim kit (ui.mount) owns the GUI state. The schema and the
//  scene rules are in scene.js (no DOM, so tests.mjs uses the same code).
//  A change to a key in scene.REBUILD builds a new scene
//  (solver.buildScene); every other key is a live set (scene.applyParams).
//  The loop steps the solver at 60 Hz in real time (kit.speed scales it)
//  and draws with render.draw.
//
//  grep -n targets
//    schema, guard ........ scene.js "export function makeSchema"
//    scene build .......... "function rebuild"
//    look ................. "function look"
//    clear view rect ...... "function viewRect"
//    pointer .............. "function bindPointer"
//    frame loop ........... "function frame"
//    saver hooks .......... "window.__pbf"
// ============================================================================
import * as SV from './solver.js';
import { draw, fitView } from './render.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { installSaver } from './saver.js';
import * as SC from './scene.js';

TMP.page({ n: null, title: 'PBF Boundaries', file: 'contribs/PBFBoundary.html', video: null, year: 2021, licence: 'MIT', by: 'Sergii Biloshytskyi', from: 'Ukraine', holder: 'Matthias Müller' });

const PHONE = isPhone();
const CAP = PHONE ? 1600 : 3200;
const SCHEMA = SC.makeSchema(PHONE);

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const R = {};             // render cache
let S = SV.createSim({ cap: CAP });
let kit, cmMod = null, lut = null, lutId = null, veil = 0, saverView = null;

function rebuild() {
  const st = kit.state, r = SC.sceneRng(kit.seed);
  applyParams();
  SV.buildScene(S, SC.sceneConfig(st, r), r);
  veil = 1;
}
function applyParams() { SC.applyParams(S, kit.state); }
function look() {
  const st = kit.state, t = K.themeById(st.theme);
  if (st.colorBy !== 'water' && cmMod && lutId !== st.cmap) { lut = cmMod.variant(st.cmap); lutId = st.cmap; }
  return {
    bg: t.bg, bg2: t.bg2, grid: st.grid ? t.grid : null, wall: t.wall, wallFill: t.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    obstacle: t.wall, outline: t.dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)', mark: t.accent, cabin: t.dark ? '#f2f4f7' : '#ffffff',
    water: st.water, colorBy: st.colorBy, lut: st.colorBy === 'water' ? null : lut, render: st.render, foam: st.foam, size: 1,
    palette: K.paletteColors(st.palette), veil, alpha: 0.94,
  };
}

// ---- view ----------------------------------------------------------------------
let dpr = 1, cw = 1, ch = 1;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  cw = Math.max(1, Math.round(innerWidth * dpr)); ch = Math.max(1, Math.round(innerHeight * dpr));
  canvas.width = cw; canvas.height = ch;
}
// The clear rect (device px): beside the panel, above the dock and credit.
function viewRect() {
  if (saverView) return { x: saverView.x * dpr, y: saverView.y * dpr, w: saverView.w * dpr, h: saverView.h * dpr };
  const panel = document.getElementById('sk-panel'), tr = document.querySelector('.sk-transport');
  let x1 = innerWidth, y1 = innerHeight;
  if (kit && kit.panelOpen && panel && !PHONE) x1 = Math.max(innerWidth * 0.45, panel.getBoundingClientRect().left);
  if (tr) y1 = Math.min(y1, tr.getBoundingClientRect().top - 6);
  if (kit && kit.panelOpen && PHONE && panel) y1 = Math.min(y1, panel.getBoundingClientRect().top);
  const y0 = 56;
  return { x: 12 * dpr, y: y0 * dpr, w: Math.max(80, x1 - 24) * dpr, h: Math.max(80, y1 - y0 - 6) * dpr };
}
let view = null;
const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---- pointer ----------------------------------------------------------------------
function bindPointer() {
  const toWorld = e => { const r = canvas.getBoundingClientRect(); const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr; return [(px - view.ox) / view.s, (view.oy - py) / view.s]; };
  let last = null;
  canvas.addEventListener('pointerdown', e => {
    if (!view || kit.saver) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toWorld(e), p = S.pointer;
    p.on = true; p.x = x; p.y = y; p.vx = p.vy = 0; last = [x, y, performance.now()];
    const k = SV.pickBody(S, x, y, 0.03);
    if (k >= 0) SV.grab(S, k, x, y); else p.body = -1;
  });
  canvas.addEventListener('pointermove', e => {
    const p = S.pointer; if (!p.on) return;
    const [x, y] = toWorld(e), now = performance.now();
    const dt = Math.max(0.008, (now - last[2]) / 1000);
    p.vx = (x - last[0]) / dt; p.vy = (y - last[1]) / dt; p.x = x; p.y = y; last = [x, y, now];
  });
  const up = () => { const p = S.pointer; p.on = false; p.vx = p.vy = 0; SV.release(S); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

// ---- loop -------------------------------------------------------------------------
let lastT = 0, acc = 0;
const H = 1 / 60;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
  if (kit.playing) {
    acc += dt * kit.speed;
    let n = 0; while (acc >= H && n < 3) { S.step(H); acc -= H; n++; }
    if (n === 3) acc = 0;
  } else if (kit.takeStep()) S.step(H);
  veil = Math.max(0, veil - dt / 0.45);
  view = fitView(S, viewRect(), saverView && saverView.cam);
  draw(ctx, S, view, look(), R, makeCanvas, cw, ch);
}

// ---- boot -------------------------------------------------------------------------
kit = mount({
  schema: SCHEMA, title: 'PBF Boundaries', sub: 'Position based particles with moving boundaries', panelTitle: 'Scene',
  guard: SC.guard, randomStart: false, themeKey: 'theme',
  footer: 'Upstream demo by Sergii Biloshytskyi (Ten Minute Physics contribution, MIT). Water mode, bodies, look and GUI: davesgames.io.',
  actions: {
    drop(kind) {
      const r = K.rng(K.newSeed()), C = S.container.inner;
      const x = C.x0 + (C.x1 - C.x0) * (0.2 + 0.6 * r()), y = C.y1 - 0.12;
      if (!SV.addBody(S, kind, x, y, r, kit.state.bodySize)) kit.say('No room to drop a ' + kind);
    },
    clear() { while (S.bodies.length) SV.removeBody(S, S.bodies[S.bodies.length - 1]); },
  },
});
// A new scene (dice, seed) always rebuilds, because the seed places the
// bodies and obstacles; the saver rebuilds in its apply().
kit.on('change', (out, st, why) => {
  if (why === 'scene' || why === 'group' || why === 'saver') return;
  if (Object.keys(out).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams();
});
kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams(); });
kit.on('reset', rebuild);
import('../ct-lab/colormaps/maps.js').then(m => { cmMod = m; }).catch(() => {});
addEventListener('resize', resize); resize();
// First visit: a fresh random scene; a shared link: its scene.
if (!kit.fromHash) kit.newScene(); else rebuild();
bindPointer();
requestAnimationFrame(frame);
addEventListener('pagehide', () => { kit.playing = false; });

window.__pbf = {
  get S() { return S; }, get kit() { return kit; }, canvas, rebuild, applyParams,
  setView(v) { saverView = v; if (v) this.viewBand = { x: v.x, y: v.y, w: v.w, h: v.h }; },
};
installSaver(window.__pbf);
