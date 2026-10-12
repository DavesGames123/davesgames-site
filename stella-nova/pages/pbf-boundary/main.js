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
//  Explanation (explain.js): the info band (title, lead, preset buttons
//  with captions, "How it works"), the legend and the TeX sheet. A preset
//  (scene.PRESETS) loads a fixed state and seed and rebuilds; the first
//  visit starts on the first preset. The canvas labels and the boundary
//  dots are look keys (labels, showB), off in the saver.
//
//  grep -n targets
//    schema, guard ........ scene.js "export function makeSchema"
//    scene build .......... "function rebuild"
//    look ................. "function look"
//    clear view rect ...... "function viewRect"
//    legend items ......... "function legendItems"
//    presets .............. "function applyPreset"
//    pointer .............. "function bindPointer"
//    frame loop ........... "function frame"
//    saver hooks .......... "window.__pbf"
// ============================================================================
import * as SV from './solver.js';
import { draw, fitView, waterById, SCALAR_RANGE, BOUNDARY_COLOR } from './render.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { installSaver } from './saver.js';
import * as SC from './scene.js';
import { pickDpr, CAP as CAPS } from './budget.js';
import { mountExplain } from './explain.js';

TMP.page({ n: null, title: 'PBF Boundaries', file: 'contribs/PBFBoundary.html', video: null, year: 2021, licence: 'MIT', by: 'Sergii Biloshytskyi', from: 'Ukraine', holder: 'Matthias Müller' });

const PHONE = isPhone();
const CAP = PHONE ? CAPS.phone : CAPS.desktop;
const SCHEMA = SC.makeSchema(PHONE);

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const R = {};             // render cache
let S = SV.createSim({ cap: CAP });
let kit, ex = null, cmMod = null, lut = null, lutId = null, veil = 0, saverView = null;

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
    showB: st.showB && !kit.saver, labels: st.labels && !kit.saver, bparts: st.bparts,
    labelBg: t.dark ? 'rgba(6,10,18,0.78)' : 'rgba(255,255,255,0.86)', labelInk: t.dark ? '#eef3fa' : '#151b24', dpr,
  };
}

// ---- view ----------------------------------------------------------------------
let dpr = 1, cw = 1, ch = 1;
function resize() {
  dpr = pickDpr(devicePixelRatio || 1, PHONE, innerWidth, innerHeight);
  cw = Math.max(1, Math.round(innerWidth * dpr)); ch = Math.max(1, Math.round(innerHeight * dpr));
  canvas.width = cw; canvas.height = ch;
}
// The clear rect (device px): under the info band, beside the panel and
// the "How it works" drawer, above the legend, the dock and the credit.
const rectOf = el => (el && !el.hidden && el.getBoundingClientRect ? el.getBoundingClientRect() : null);
function viewRect() {
  if (saverView) return { x: saverView.x * dpr, y: saverView.y * dpr, w: saverView.w * dpr, h: saverView.h * dpr };
  const panel = document.getElementById('sk-panel'), tr = document.querySelector('.sk-transport');
  let x0 = 12, x1 = innerWidth, y1 = innerHeight, y0 = 56;
  if (kit && kit.panelOpen && panel && !PHONE) x1 = Math.max(innerWidth * 0.45, panel.getBoundingClientRect().left);
  if (tr) y1 = Math.min(y1, tr.getBoundingClientRect().top - 6);
  if (kit && kit.panelOpen && PHONE && panel) y1 = Math.min(y1, panel.getBoundingClientRect().top);
  if (ex) {
    const b = rectOf(ex.band), lg = rectOf(ex.legend), hw = ex.howOpen ? rectOf(ex.sheet) : null;
    if (b && b.height) y0 = Math.max(y0, b.bottom + 8);
    if (lg && lg.height) y1 = Math.min(y1, lg.top - 4);
    if (hw && hw.width) { if (PHONE) y1 = Math.min(y1, hw.top); else x0 = Math.min(innerWidth * 0.5, hw.right + 12); }
  }
  return { x: x0 * dpr, y: y0 * dpr, w: Math.max(80, x1 - x0 - 12) * dpr, h: Math.max(80, y1 - y0 - 6) * dpr };
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
  if (ex && ts - legendT > 250) { legendT = ts; ex.paintLegend(legendItems()); }
  view = fitView(S, viewRect(), saverView && saverView.cam);
  draw(ctx, S, view, look(), R, makeCanvas, cw, ch);
}

// ---- legend and presets -------------------------------------------------------------
let legendT = -1e9;
function lutGradient(L) {
  const stops = [];
  for (let s = 0; s <= 8; s++) { const k = ((0.16 + 0.84 * s / 8) * 255) | 0; stops.push(`rgb(${L[3 * k]},${L[3 * k + 1]},${L[3 * k + 2]}) ${(s * 12.5).toFixed(1)}%`); }
  return 'linear-gradient(90deg,' + stops.join(',') + ')';
}
const fmtEnd = (v, unit) => (Math.abs(v) >= 10 || v === 0 ? String(v) : v.toFixed(2).replace(/0$/, '')) + (unit ? ' ' + unit : '');
// The colour key of the current look (explain.js paints it).
function legendItems() {
  const st = kit.state, t = K.themeById(st.theme), grains = st.material === 'granular', items = [];
  const rg = SCALAR_RANGE[st.colorBy];
  if (st.colorBy !== 'water' && lut && rg) items.push({ shape: 'bar', swatch: lutGradient(lut), lo: fmtEnd(rg.lo, rg.unit), hi: fmtEnd(rg.hi, rg.unit), text: (grains ? 'Grains: ' : 'Fluid: ') + rg.label.toLowerCase() });
  else { const w = waterById(st.water).colors; items.push({ shape: 'box', swatch: `linear-gradient(90deg,${w[0]},${w[1]},${w[2]})`, text: grains ? 'Grains' : 'Fluid (light rim: free surface)' }); }
  if (st.showB) items.push({ shape: 'dot', swatch: BOUNDARY_COLOR, text: st.bparts ? 'Boundary particles' : 'Boundary particles (not in the density)' });
  items.push({ shape: 'line', swatch: t.wall, text: 'Solid wall' });
  if (S.bodies.length) items.push({ shape: 'box', swatch: K.paletteColors(st.palette)[0], text: 'Bodies' });
  return items;
}
function applyPreset(id) {
  const p = SC.presetById(id); if (!p) return;
  kit.seed = p.seed;
  kit.load(SC.presetState(SCHEMA, kit.state, p), 'preset');
  kit.refresh();
  rebuild();
  ex.setPreset(id);
  legendT = -1e9;
}

// ---- boot -------------------------------------------------------------------------
kit = mount({
  schema: SCHEMA, panelTitle: 'Scene',
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
  legendT = -1e9;
  if (why === 'scene' || why === 'group' || why === 'saver' || why === 'preset') return;
  if (Object.keys(out).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams();
});
kit.on('scene', (seed, st, out, group) => {
  if (!kit.saver && ex) ex.setPreset(null, kit.seed);
  if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams();
});
kit.on('reset', rebuild);
import('../ct-lab/colormaps/maps.js').then(m => { cmMod = m; }).catch(() => {});
ex = mountExplain({ kit, presets: SC.PRESETS, phone: PHONE, onPreset: applyPreset });
addEventListener('resize', resize); resize();
// First visit: the first preset (a dam break against a particle wall);
// a shared link: its scene.
if (!kit.fromHash) applyPreset(SC.PRESETS[0].id); else { rebuild(); ex.setPreset(null, kit.seed); }
bindPointer();
requestAnimationFrame(frame);
addEventListener('pagehide', () => { kit.playing = false; });

window.__pbf = {
  get S() { return S; }, get kit() { return kit; }, get ex() { return ex; }, canvas, rebuild, applyParams, applyPreset, viewRect, legendItems,
  setView(v) { saverView = v; if (v) this.viewBand = { x: v.x, y: v.y, w: v.w, h: v.h }; },
};
installSaver(window.__pbf);
