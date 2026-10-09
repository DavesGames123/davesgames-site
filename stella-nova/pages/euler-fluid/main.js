// ============================================================================
//  EULER FLUID  ·  pages/euler-fluid/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. The fluid solver is Matthias Müller's Ten Minute Physics #17
//  (17-fluidSim.html, MIT; the notice is kept at the top of solver.js). The
//  credit bar (widgets/ten-minute-physics/kit.js) names him on the page and
//  on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): the scenes beyond the four
//  upstream ones, several shaped and moving obstacles, the field views and
//  colour maps, the renderer (render.js), this controller, the sim kit GUI
//  (widgets/sim-kit) and the screensaver (saver.js).
//
//  Every upstream control lives on in the kit panel: the scene buttons
//  (Wind Tunnel, Hires Tunnel, Tank, Paint) are the Scene choice, the
//  Streamlines, Velocities, Pressure, Smoke and Overrelax boxes are Look
//  and Solver controls, and P / M (pause, one step) are the kit transport
//  keys Space and ".".
//
//  grep -n targets
//    schema, guard ........ scene.js "export function makeSchema"
//    scene build .......... "function rebuild"
//    look ................. "function look"
//    pointer .............. "function bindPointer"
//    frame loop ........... "function frame"
//    saver hooks .......... "window.__euler"
// ============================================================================
import * as SV from './solver.js';
import { draw, fitView, pickObstacle } from './render.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { installSaver } from './saver.js';
import * as SC from './scene.js';

TMP.page({ n: '17', title: 'Euler Fluid', file: '17-fluidSim.html', video: 'iKAVRgIrUOU', year: 2022, licence: 'MIT' });

const PHONE = isPhone();
const SCHEMA = SC.makeSchema(PHONE);
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const R = {};
const S = SV.createSim();
let kit, cmMod = null, veil = 0, saverView = null;

function rebuild() {
  const st = kit.state, r = SC.sceneRng(kit.seed);
  applyParams();
  SV.buildScene(S, SC.sceneConfig(st, r), r);
  veil = 1;
}
function applyParams() { SC.applyParams(S, kit.state); }
function look() {
  const st = kit.state, t = K.themeById(st.theme);
  let lut = null;
  if (cmMod) { try { lut = cmMod.variant(st.cmap, { reverse: st.reverse }); } catch (e) { lut = null; } }
  return { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, wallFill: t.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)', outline: t.dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)',
    colorBy: st.colorBy, lut, stream: st.stream, vel: st.vel, smooth: st.smooth, palette: K.paletteColors(st.palette), veil, dpr, legend: !saverView };
}

// ---- view ----------------------------------------------------------------------
let dpr = 1, cw = 1, ch = 1, view = null;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  cw = Math.max(1, Math.round(innerWidth * dpr)); ch = Math.max(1, Math.round(innerHeight * dpr));
  canvas.width = cw; canvas.height = ch;
}
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
const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---- pointer: drag an obstacle, or stir with a finger (upstream drag) -------------
function bindPointer() {
  const toWorld = e => { const r = canvas.getBoundingClientRect(); const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr; return [(px - view.ox) / view.s, (view.oy - py) / view.s]; };
  let held = null;
  canvas.addEventListener('pointerdown', e => {
    if (!view || kit.saver || !S.f) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toWorld(e);
    held = pickObstacle(S, x, y, 0.03);
    if (held) { held.held = true; }
    else { held = SV.makeObstacle({ shape: 'circle', x, y, r: kit.state.finger, hue: Math.random() }); held.held = true; S.finger = held; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!held) return;
    const [x, y] = toWorld(e), m = held.r + 0.02;
    held.x = Math.min(S.W - m, Math.max(m, x)); held.y = Math.min(S.H - m, Math.max(m, y));
  });
  const up = () => { if (!held) return; held.held = false; held.x0 = held.x; held.y0 = held.y; if (held === S.finger) S.finger = null; held = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

// ---- loop -------------------------------------------------------------------------
let lastT = 0, acc = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
  const H = S.P.dt;
  if (kit.playing) {
    acc += dt * kit.speed;
    let n = 0; while (acc >= H && n < 2) { SV.step(S, H); acc -= H; n++; }
    if (n === 2) acc = 0;
  } else if (kit.takeStep()) SV.step(S, H);
  veil = Math.max(0, veil - dt / 0.45);
  view = fitView(S, viewRect(), saverView && saverView.cam);
  draw(ctx, S, view, look(), R, makeCanvas, cw, ch);
}

// ---- boot -------------------------------------------------------------------------
kit = mount({
  schema: SCHEMA, title: 'Euler Fluid', sub: 'A grid fluid: wind tunnels, tanks, jets and paint', panelTitle: 'Scene',
  guard: SC.guard, randomStart: false, themeKey: 'theme',
  footer: 'Solver by Matthias Müller (Ten Minute Physics 17, MIT). Scenes, obstacles, views and GUI: davesgames.io.',
  actions: {
    add(shape) {
      const r = K.rng(K.newSeed());
      SV.addObstacle(S, { shape, x: 0.25 + (S.W - 0.5) * r(), y: 0.25 + 0.5 * r(), r: kit.state.size, a: (r() - 0.5), motion: 'static', hue: r() });
    },
    clear() { S.obstacles = []; },
  },
});
kit.on('change', (out, st, why) => {
  if (why === 'scene' || why === 'group' || why === 'saver') return;
  // upstream: the paint scene turns overrelaxation off
  if ('kind' in out && why === 'input') { if (st.kind === 'paint' && st.over) kit.set('over', false); if (st.kind !== 'paint' && !st.over) kit.set('over', true); }
  if (Object.keys(out).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams();
});
kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams(); });
kit.on('reset', rebuild);
import('../ct-lab/colormaps/maps.js').then(m => { cmMod = m; }).catch(() => {});
addEventListener('resize', resize); resize();
if (!kit.fromHash) kit.newScene(); else rebuild();
bindPointer();
requestAnimationFrame(frame);
addEventListener('pagehide', () => { kit.playing = false; });

window.__euler = {
  S, get kit() { return kit; }, canvas, rebuild, applyParams,
  get view() { return view; },
  setView(v) { saverView = v; if (v) this.viewBand = { x: v.x, y: v.y, w: v.w, h: v.h }; },
};
installSaver(window.__euler);
