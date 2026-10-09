// ============================================================================
//  PERIODIC TABLE  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page chrome (body.saver), keeps canvas#table full window and plays
//  a seeded plan from saver-plan.js: 6 to 12 s shots, never the same kind
//  twice in a row (morph, melt, timeline, tower, heat, atom, scatter,
//  spiral). The page's own Table and state draw every frame; this module
//  only moves them: views, temperature, years, the 3D turn, push-ins and
//  the atom close-up. The subject is framed in the clear band of the
//  label plate (lib/saver-clear.js plateBand). The plate names the shot,
//  the element or property, and one equation in TeX. No code.
//
//  grep -n targets
//    "function startShot"   one shot: view, settings, plate
//    "function step"        the per-frame motion of a shot
//    "function pushTo"      a push-in on one element
// ============================================================================
import { planShots } from './saver-plan.js';
import { ELEMENTS, PROP, CAT, cfgUnicode, valence, zeff, expand, fmt, L_LETTER } from './chem.js';
import { VIEW } from './layouts.js';
import { plateBand } from '../../lib/saver-clear.js';

const ease = u => u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
const CREDIT = 'Data: komed3/periodic-table (MIT), PubChem (public domain)';
let run = null;

function frameFor(P) {
  const W = P.canvas.clientWidth || innerWidth, H = P.canvas.clientHeight || innerHeight;
  const b = plateBand(H);
  const t = b ? b.t : Math.round(H * 0.16), bot = b ? b.b : Math.round(H * 0.2);
  return { x: Math.round(W * 0.04), y: t, w: Math.round(W * 0.92), h: Math.max(120, H - t - bot) };
}

// A push-in on element i: zoom toward its place in the target layout.
function pushTo(P, i, zoom, r) {
  const T = P.T, B = T.B, it = B.items[i], b = B.bounds;
  const base = T.cam.k / Math.max(1e-6, T.user.zoom);
  const k = base * zoom;
  const want = { zoom, px: -(it.x - (b.x0 + b.x1) / 2) * k, py: -(it.y - (b.y0 + b.y1) / 2) * k };
  for (const key of ['zoom', 'px', 'py']) T.user[key] += (want[key] - T.user[key]) * r;
}
function release(P, r) { for (const [key, v] of [['zoom', 1], ['px', 0], ['py', 0]]) P.T.user[key] += (v - P.T.user[key]) * r; }

function startShot(sh) {
  const P = run.P, S = P.S;
  run.sh = sh; run.t0 = performance.now() / 1000; run.k = 0;
  S.closeup = null; S.phaseOn = false; S.match = null; S.hover = -1; S.pin = -1;
  P.T.user.zoom = 1; P.T.user.px = 0; P.T.user.py = 0;
  S.frame = frameFor(P);
  let plate;
  const tex = {
    aufbau: '\\text{fill order: } n + \\ell \\uparrow,\\ \\text{then } n \\uparrow',
    gibbs: '\\Delta G = \\Delta H - T\\,\\Delta S',
    rydberg: '\\frac{1}{\\lambda} = R_\\infty Z^2\\!\\left(\\frac{1}{n_1^2} - \\frac{1}{n_2^2}\\right)',
    zeff: 'Z_{\\mathrm{eff}} = Z - S',
    ie: 'E_n \\approx -13.6\\,\\mathrm{eV}\\,\\frac{Z_{\\mathrm{eff}}^2}{n^2}',
  };
  if (sh.kind === 'morph') {
    S.color = VIEW[sh.views[0]].color; P.setView(sh.views[0]);
    plate = { title: 'One table, many shapes', sub: sh.views.map(v => VIEW[v].name).join(' → '), tex: [tex.aufbau], params: [{ name: 'views', value: sh.views.map(v => VIEW[v].name).join(', ') }] };
  } else if (sh.kind === 'melt') {
    P.setView(sh.view); P.setTemp(sh.from);
    plate = { title: 'Melting the table', sub: `${sh.from} K to ${sh.to.toLocaleString('en-US')} K at 1 atm: solid, liquid, gas`, tex: [tex.gibbs], params: [{ name: 'view', value: VIEW[sh.view].name }] };
  } else if (sh.kind === 'timeline') {
    S.year = sh.from; P.setView('timeline');
    plate = { title: 'The discovery of the elements', sub: `from ${sh.from} to today, decade by decade`, tex: [tex.rydberg], params: [{ name: 'view', value: 'Discovery timeline' }] };
  } else if (sh.kind === 'tower') {
    S.prop = sh.prop; S.cmap = sh.cmap; P.setView('tower');
    P.T.rot.yaw = -0.9 + 0.6 * ((sh.seed % 100) / 100); P.T.rot.pitch = 0.85 + 0.25 * ((sh.seed % 37) / 37);
    plate = { title: PROP[sh.prop].name, sub: 'a property as height, across the table', tex: [sh.prop === 'ie1' ? tex.ie : tex.zeff], params: [{ name: 'colour map', value: sh.cmap }] };
  } else if (sh.kind === 'heat') {
    S.prop = sh.props[0]; S.cmap = sh.cmaps[0]; P.setView(sh.view); S.color = 'prop';
    plate = { title: 'Heat maps', sub: `${PROP[sh.props[0]].name}, then ${PROP[sh.props[1]].name}`, tex: [tex.zeff], params: [{ name: 'colour maps', value: sh.cmaps.join(' → ') }] };
  } else if (sh.kind === 'atom') {
    const e = ELEMENTS[sh.z - 1], v = valence(e);
    P.setView(sh.view);
    run.i = sh.z - 1;
    plate = { title: `${e.name} · ${e.sym}`, sub: `${CAT[e.cat].name}: ${cfgUnicode(e)}`,
      tex: [tex.zeff], params: [{ name: 'Z', value: String(e.z) }, { name: 'shells', value: e.shells.join(' · ') }, { name: 'valence Z_eff', value: `${fmt(zeff(e.z, expand(e.cfg), v[0], v[1]), 2)} (${v[0]}${L_LETTER[v[1]]})` }],
      lines: ['Bohr shells, then orbital clouds; sizes for legibility, not to scale', CREDIT] };
  } else if (sh.kind === 'scatter') {
    S.x = sh.x; S.y = sh.y; S.cmap = sh.cmap; S.prop = sh.y; P.setView('scatter'); S.color = 'prop';
    plate = { title: `${PROP[sh.y].name} against ${PROP[sh.x].name}`, sub: 'every element as a point', tex: [sh.y === 'ie1' ? tex.ie : tex.zeff], params: [] };
  } else if (sh.kind === 'spiral') {
    P.setView(sh.view);
    plate = { title: VIEW[sh.view].name, sub: VIEW[sh.view].hint, tex: [tex.aufbau], params: [{ name: 'focus', value: sh.focus.map(z => ELEMENTS[z - 1].sym).join(' · ') }] };
  }
  plate.lines = plate.lines || [CREDIT];
  try { if (typeof run.o.label === 'function') run.o.label(plate); } catch (e) { /* the plate is optional */ }
}

function step() {
  if (!run) return;
  run.raf = requestAnimationFrame(step);
  const P = run.P, S = P.S, sh = run.sh;
  const t = performance.now() / 1000, tau = t - run.t0, u = tau / sh.dur;
  if (run.k++ % 30 === 0) S.frame = frameFor(P);
  if (sh.kind === 'morph') {
    const idx = Math.min(2, Math.floor(u * 3));
    if (idx !== run.vi) { run.vi = idx; if (idx > 0) { S.color = VIEW[sh.views[idx]].color; P.setView(sh.views[idx]); } }
  } else if (sh.kind === 'melt') {
    const w = ease((u - 0.08) / 0.84);
    P.setTemp(sh.from * Math.pow(sh.to / sh.from, w));
  } else if (sh.kind === 'timeline') {
    const y = Math.round(sh.from + (2030 - sh.from) * ease((u - 0.05) / 0.85));
    if (y !== S.year) { S.year = y; P.refreshView(); }
  } else if (sh.kind === 'tower') {
    P.T.rot.yaw += sh.turn / 60;
  } else if (sh.kind === 'heat') {
    if (u > 0.5 && S.prop !== sh.props[1]) { S.prop = sh.props[1]; S.cmap = sh.cmaps[1]; if (sh.view === 'heat') P.refreshView(); }
  } else if (sh.kind === 'atom') {
    const i = run.i;
    if (u < 0.32) pushTo(P, i, 1 + 2.4 * ease(u / 0.3), 0.08);
    S.hover = i;
    const a = ease((u - 0.24) / 0.14), mix = ease((u - 0.58) / 0.16);
    S.closeup = a > 0.001 ? { i, a, mix } : null;
  } else if (sh.kind === 'spiral') {
    const n = sh.focus.length, seg = Math.min(n - 1, Math.floor(u * n)), su = u * n - seg;
    const i = sh.focus[seg] - 1;
    S.hover = i;
    if (su < 0.7) pushTo(P, i, 1 + 1.6 * ease(su / 0.5), 0.05); else release(P, 0.06);
  } else if (sh.kind === 'scatter') {
    release(P, 0.05);
  }
  if (tau >= sh.dur) {
    run.i0 = (run.i0 + 1) % run.plan.length;
    run.vi = 0;
    startShot(run.plan[run.i0]);
  }
}

window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const P = window.__pt;
    if (!P) return null;
    P.saver = true;
    run = { o, P, plan: planShots((o.seed >>> 0) || ((Math.random() * 1e9) >>> 0), 64), i0: 0, vi: 0,
      keep: { view: P.S.view, color: P.S.color, prop: P.S.prop, cmap: P.S.cmap, temp: P.S.temp, phaseOn: P.S.phaseOn, year: P.S.year, x: P.S.x, y: P.S.y, rot: { ...P.T.rot } } };
    document.body.classList.add('saver');
    P.resize();
    startShot(run.plan[0]);
    run.raf = requestAnimationFrame(step);
    return { canvas: P.canvas, warmupMs: 900 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    const P = run.P, k = run.keep;
    if (typeof run.o.label === 'function') { try { run.o.label(null); } catch (e) { /* ok */ } }
    document.body.classList.remove('saver');
    P.saver = false;
    Object.assign(P.S, { color: k.color, prop: k.prop, cmap: k.cmap, phaseOn: k.phaseOn, year: k.year, x: k.x, y: k.y, closeup: null, hover: -1, frame: null });
    P.setTemp(k.temp, { phase: k.phaseOn });
    Object.assign(P.T.rot, k.rot);
    P.resize();
    P.setView(k.view, { keepColor: true });
    run = null;
  },
};
window.snSaver.debug = () => (run ? { kind: run.sh.kind, i: run.i0, t: performance.now() / 1000 - run.t0, dur: run.sh.dur } : null);
window.snSaver.cut = kind => { if (!run) return; const j = run.plan.findIndex((p, i) => i > run.i0 && p.kind === kind); if (j >= 0) { run.i0 = j; startShot(run.plan[j]); } };
