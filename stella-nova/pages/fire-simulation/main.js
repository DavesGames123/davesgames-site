// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. The fire solver is Matthias Müller's Ten Minute Physics #21
//  (21-fire.html, MIT; the notice is kept at the top of solver.js). The
//  credit bar (widgets/ten-minute-physics/kit.js) names him on the page and
//  on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): burner kinds and motions,
//  wind, flame colour ramps and colour maps, glow, this controller, the sim
//  kit GUI (widgets/sim-kit), the renderer and the screensaver.
//
//  Every upstream control lives on in the kit panel: Floor and Ring are the
//  Fire choice and the Floor burns toggle, Swirls is "Show swirls",
//  Probability is "Swirl probability", and P / M are Space and ".".
//  A tap in open air moves the first burner there, as the upstream drag did.
//
//  grep -n targets: "function rebuild", "function look", "function bindPointer",
//  "function frame", "window.__fire"
// ============================================================================
import * as SV from './solver.js';
import { draw, fitView, pickBurner, rampLut } from './render.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { installSaver } from './saver.js';
import * as SC from './scene.js';

TMP.page({ n: '21', title: 'Fire Simulation', file: '21-fire.html', video: 'RsgmS3ZxDtc', year: 2022, licence: 'MIT' });

const PHONE = isPhone();
const SCHEMA = SC.makeSchema(PHONE);
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const R = {};
const S = SV.createSim();
let kit, cmMod = null, veil = 0, saverView = null;
const RAMPS = new Map();
const ramp = id => { if (!RAMPS.has(id)) { const f = SC.FIRE.find(x => x.id === id) || SC.FIRE[0]; RAMPS.set(id, rampLut(f.colors, SC.FIRE_STOPS)); } return RAMPS.get(id); };

function rebuild() {
  const st = kit.state, r = SC.sceneRng(kit.seed);
  applyParams();
  SV.buildScene(S, SC.sceneConfig(st, r), SC.sceneRng(kit.seed + 1));
  veil = 1;
}
function applyParams() { SC.applyParams(S, kit.state); }
function look() {
  const st = kit.state, t = K.themeById(st.theme);
  let lut = ramp(st.fire);
  if (st.colorBy !== 'flame' && cmMod) { try { lut = cmMod.variant(st.cmap); } catch (e) { /* keep the ramp */ } }
  return { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, burner: t.dark ? '#3c4250' : '#4a4f5a', log: '#5b3a24',
    lut, colorBy: st.colorBy, glow: st.glow, showBurners: st.showBurners, showSwirls: st.showSwirls, veil };
}

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

function bindPointer() {
  const toWorld = e => { const r = canvas.getBoundingClientRect(); const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr; return [(px - view.ox) / view.s, (view.oy - py) / view.s]; };
  let held = null;
  const place = (b, x, y) => { b.x = Math.min(S.W - 0.02, Math.max(0.02, x)); b.y = Math.min(S.H - 0.02, Math.max(0.02, y)); };
  canvas.addEventListener('pointerdown', e => {
    if (!view || kit.saver || !S.f) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toWorld(e);
    held = pickBurner(S, x, y) || S.cfg.burners[0] || SV.addBurner(S, { kind: 'ring', x, y, r: kit.state.size });
    held.held = true; place(held, x, y);
  });
  canvas.addEventListener('pointermove', e => { if (!held) return; const [x, y] = toWorld(e); place(held, x, y); });
  const up = () => { if (!held) return; held.held = false; held.x0 = held.x; held.y0 = held.y; held = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
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
  } else if (kit.takeStep()) SV.step(S, H);
  veil = Math.max(0, veil - dt / 0.45);
  view = fitView(S, viewRect(), saverView && saverView.cam);
  draw(ctx, S, view, look(), R, makeCanvas, cw, ch);
}

kit = mount({
  schema: SCHEMA, title: 'Fire Simulation', sub: 'Buoyant flame, smoke and swirls on a grid', panelTitle: 'Fire',
  guard: SC.guard, randomStart: false, themeKey: 'theme',
  footer: 'Solver by Matthias Müller (Ten Minute Physics 21, MIT). Burners, wind, colours and GUI: davesgames.io.',
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
bindPointer();
requestAnimationFrame(frame);
addEventListener('pagehide', () => { kit.playing = false; });

window.__fire = {
  S, get kit() { return kit; }, canvas, rebuild, applyParams,
  setView(v) { saverView = v; },
};
installSaver(window.__fire);
