// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. The fire solver is Matthias Müller's Ten Minute Physics #21
//  (21-fire.html, MIT; the notice is kept at the top of solver.js). The
//  credit bar (widgets/ten-minute-physics/kit.js) names him on the page and
//  on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): the GPU solver (gpu.js:
//  WebGPU, else WebGL2, else the CPU model in solver.js), the frame
//  governor (governor.js), burner kinds and motions, wind, flame palettes
//  (palette.js, blackbody by default) and colour maps, glow, this
//  controller, the sim kit GUI (widgets/sim-kit) and the screensaver.
//
//  Canvases: #view holds the GPU field; #overlay (2D, no pointer events)
//  holds the frame, burners, swirls and the veil. With no GPU, #view is a
//  2D canvas and draw() paints all of it there. ?gpu=webgl2 or ?gpu=cpu
//  picks a path by hand.
//
//  Every upstream control lives on in the kit panel: Floor and Ring are the
//  Fire choice and the Floor burns toggle, Swirls is "Show swirls",
//  Probability is "Swirl probability", and P / M are Space and ".".
//  A tap in open air moves the first burner there, as the upstream drag did.
//
//  grep -n targets: "function rebuild", "function applyLevel", "function look",
//  "function resize", "function bindPointer", "function frame", "window.__fire"
// ============================================================================
import * as SV from './solver.js';
import { draw, drawOverlay, fitView, pickBurner } from './render.js';
import { paletteLut } from './palette.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { installSaver } from './saver.js';
import * as SC from './scene.js';
import { createEngine } from './gpu.js';
import { createGovernor } from './governor.js';

TMP.page({ n: '21', title: 'Fire Simulation', file: '21-fire.html', video: 'RsgmS3ZxDtc', year: 2022, licence: 'MIT' });

const PHONE = isPhone();
const SCHEMA = SC.makeSchema(PHONE);
const DPR_CAP = 1.5, MAX_PX = PHONE ? 1.6e6 : 2.6e6;
const canvas = document.getElementById('view');
const over = document.createElement('canvas');
over.id = 'overlay'; over.setAttribute('aria-hidden', 'true');
document.body.appendChild(over);
let prefer = 'auto';
try { prefer = new URLSearchParams(location.search || '').get('gpu') || 'auto'; } catch (e) { /* keep auto */ }
let ENG = null;
try { ENG = await createEngine(canvas, { prefer }); } catch (e) { ENG = null; }
let fieldCtx = ENG ? null : canvas.getContext('2d');
let octx = over.getContext('2d');
// no GPU and no 2D on #view (its context type is taken): paint on the overlay
function cpuOnOverlay() { fieldCtx = octx; canvas.style.display = 'none'; over.style.pointerEvents = 'auto'; }
if (!ENG && !fieldCtx) cpuOnOverlay();
const R = {};
const S = SV.createSim();
const gov = createGovernor();
let kit, cmMod = null, veil = 0, saverView = null;
const RAMPS = new Map();
const ramp = id => { if (!RAMPS.has(id)) RAMPS.set(id, paletteLut(id)); return RAMPS.get(id); };

function rebuild() {
  const st = kit.state, r = SC.sceneRng(kit.seed);
  applyParams();
  const cfg = SC.sceneConfig(st, r);
  cfg.cells = Math.round(cfg.cells * gov.scale());
  SV.buildScene(S, cfg, SC.sceneRng(kit.seed + 1), { gpu: !!ENG });
  S.gpu = ENG;
  if (ENG) ENG.setGrid(S.f);
  veil = 1;
}
function applyParams() { SC.applyParams(S, kit.state); }
// The governor changed level: resample the sim to the new cell count.
function applyLevel() {
  const cells = Math.round(kit.state.cells * gov.scale());
  SV.resample(S, cells, kit.state.aspect, { gpu: !!ENG });
  if (ENG) ENG.setGrid(S.f, { resample: true });
  resize();
}
if (ENG) ENG.onLost = () => {
  // device or context lost: go on with the CPU solver on the overlay
  ENG = null; S.gpu = null; cpuOnOverlay(); rebuild();
};
const LOOK = {};
function look() {
  const st = kit.state, t = K.themeById(st.theme), L = LOOK;
  let lut = ramp(st.fire);
  if (st.colorBy !== 'flame' && cmMod) { try { lut = cmMod.variant(st.cmap); } catch (e) { /* keep the ramp */ } }
  L.bg = t.bg; L.bg2 = t.bg2; L.ink = t.ink; L.wall = t.wall; L.accent = t.accent; L.burner = t.dark ? '#3c4250' : '#4a4f5a'; L.log = '#5b3a24';
  L.lut = lut; L.colorBy = st.colorBy; L.glow = st.glow; L.showBurners = st.showBurners; L.showSwirls = st.showSwirls; L.veil = veil;
  return L;
}

let dpr = 1, cw = 1, ch = 1, view = null;
function resize() {
  dpr = Math.min(DPR_CAP * gov.dpr(), devicePixelRatio || 1);
  const px = innerWidth * innerHeight * dpr * dpr;
  if (px > MAX_PX) dpr *= Math.sqrt(MAX_PX / px);
  cw = Math.max(1, Math.round(innerWidth * dpr)); ch = Math.max(1, Math.round(innerHeight * dpr));
  canvas.width = cw; canvas.height = ch; over.width = cw; over.height = ch;
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

function bindPointer(el) {
  const toWorld = e => { const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr; return [(px - view.ox) / view.s, (view.oy - py) / view.s]; };
  let held = null;
  const place = (b, x, y) => { b.x = Math.min(S.W - 0.02, Math.max(0.02, x)); b.y = Math.min(S.H - 0.02, Math.max(0.02, y)); };
  el.addEventListener('pointerdown', e => {
    if (!view || kit.saver || !S.f) return;
    el.setPointerCapture(e.pointerId);
    const [x, y] = toWorld(e);
    held = pickBurner(S, x, y) || S.cfg.burners[0] || SV.addBurner(S, { kind: 'ring', x, y, r: kit.state.size });
    held.held = true; place(held, x, y);
  });
  el.addEventListener('pointermove', e => { if (!held) return; const [x, y] = toWorld(e); place(held, x, y); });
  const up = () => { if (!held) return; held.held = false; held.x0 = held.x; held.y0 = held.y; held = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

let lastT = 0, acc = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
  const H = S.cfg.dt;
  if (kit.playing) {
    acc += dt * kit.speed;
    let n = 0; while (acc >= H && n < 2) { SV.step(S, H); acc -= H; n++; }
    if (n === 2) acc = 0;
    if (gov.tick(ts) != null) applyLevel();
  } else { gov.reset(); if (kit.takeStep()) SV.step(S, H); }
  veil = Math.max(0, veil - dt / 0.45);
  view = fitView(S, viewRect(), saverView && saverView.cam);
  const L = look();
  if (ENG) {
    L.veil = 0; ENG.render(S, L, view, cw, ch); L.veil = veil;
    drawOverlay(octx, S, view, L, cw, ch, true);
  } else draw(fieldCtx, S, view, L, R, makeCanvas, cw, ch);
}

kit = mount({
  schema: SCHEMA, title: 'Fire Simulation', sub: 'Buoyant flame, smoke and swirls on a grid', panelTitle: 'Fire',
  guard: SC.guard, randomStart: false, themeKey: 'theme',
  footer: 'Fire model after Matthias Müller (Ten Minute Physics 21, MIT). GPU solver, burners, wind, colours and GUI: davesgames.io.',
  actions: {
    add(kind) { const r = K.rng(K.newSeed()); SV.addBurner(S, { kind, x: S.W * (0.15 + 0.7 * r()), y: S.H * (0.12 + 0.3 * r()), r: kit.state.size }); },
    clear() { S.cfg.burners = []; S.cfg.floor = false; kit.set('floor', false); },
  },
});
kit.on('change', (out, st, why) => {
  if (why === 'scene' || why === 'group' || why === 'saver') return;
  if ('preset' in out && why === 'input') kit.set('floor', st.preset === 'floor' || st.preset === 'both');
  if (Object.keys(out).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams();
});
kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SC.REBUILD.has(k))) rebuild(); else applyParams(); });
kit.on('reset', rebuild);
import('../ct-lab/colormaps/maps.js').then(m => { cmMod = m; }).catch(() => {});
addEventListener('resize', resize); resize();
if (!kit.fromHash) kit.newScene(); else rebuild();
bindPointer(canvas); bindPointer(over);
requestAnimationFrame(frame);
addEventListener('pagehide', () => { kit.playing = false; });

window.__fire = {
  S, get kit() { return kit; }, canvas, overlay: over, rebuild, applyParams, gov, applyLevel,
  get engine() { return ENG ? ENG.kind : 'cpu'; },
  setView(v) { saverView = v; },
};
installSaver(window.__fire);
