// ============================================================================
//  PERIODIC TABLE  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page chrome (body.saver), keeps canvas#table full window and plays
//  a seeded plan from saver-plan.js: 6 to 12 s shots, never the same kind
//  twice in a row, a new order on each run (flight, walk, atom, melt,
//  timeline, tower, heat, scatter, orbit; see the saver-plan.js header).
//
//  Layers, all in canvas#table, so the canvas that the shell records holds
//  every part:
//    sky      saver-fx.js drawSky and a soft light under the subject. The
//             saver wraps the Table instance method drawBg (render.js is
//             not changed): the original background, then the sky, then
//             the tiles over them.
//    table    main.js frame() draws the page Table as usual. This module
//             only moves its state: views, temperature, years, the 3D
//             turn, S.match (the dim spotlight) and T.user (the camera).
//    light    after the table: halos, trails, bursts, scan lines, the
//             atom close-up and its panels. step() runs after frame() in
//             the same animation frame, because main.js registered its
//             loop first.
//
//  Camera. A critically damped spring (saver-plan.js spring) moves a world
//  point and a zoom; aimUser turns them into T.user, and Table.fitCamera
//  smooths again. The subject sits in the clear band of the label plate
//  (lib/saver-clear.js plateBand): S.frame is that band.
//
//  Plate: plateFor(shot, k) in saver-plan.js. A new title fades to a new
//  plate, the same title swaps the values in place (a walk, a timeline).
//  One TeX line, no code.
//
//  grep -n targets
//    "function startShot"   one shot: view, settings, plate
//    "const SHOTS"          the per-frame motion and light of each shot
//    "function step"        the frame: camera, plate, light layer
//    "function aim"         the camera spring -> T.user
// ============================================================================
import { planShots, plateFor, FAMILY, spring, aimUser, ieSteps, isoBars, known, frameOf, atomLayout } from './saver-plan.js';
import { ELEMENTS, CAT, phaseAt } from './chem.js';
import { VIEW } from './layouts.js';
import { drawAtom } from './atom.js';
import { colorOf } from './render.js';
import * as FX from './saver-fx.js';
import { plateBand } from '../../lib/saver-clear.js';

const N = ELEMENTS.length;
const ease = u => u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const now = () => performance.now() / 1000;
const TRAIL = 5;   // frames of tile history for the light trails
let run = null;

// ── frame and camera ──────────────────────────────────────────────────────
function bandOf(P) {
  const W = P.canvas.clientWidth || innerWidth, H = P.canvas.clientHeight || innerHeight;
  const b = plateBand(H);
  const t = b ? b.t : Math.round(H * 0.16), bot = b ? b.b : Math.round(H * 0.2);
  return { x: Math.round(W * 0.04), y: t, w: Math.round(W * 0.92), h: Math.max(120, H - t - bot) };
}
const itemOf = (P, i) => P.T.B.items[i];
const centreOf = P => { const b = P.T.B.bounds; return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
// The zoom at which tile i is `frac` of the frame height.
function zoomFor(P, i, frac) {
  const it = itemOf(P, i), k = aimUser(P.T, P.S, it.x, it.y, 1).k1;
  return clamp(frac * P.S.frame.h / Math.max(1e-6, it.s * k), 1, 9);
}
// Spring the camera toward (x, y, zoom) and set T.user.
function aim(x, y, z, dt, w = 3) {
  const c = run.cam, ww = w * run.slow;
  [c.x, c.vx] = spring(c.x, c.vx, x, ww, dt);
  [c.y, c.vy] = spring(c.y, c.vy, y, ww, dt);
  [c.z, c.vz] = spring(c.z, c.vz, z, ww, dt);
  const P = run.P;
  if (VIEW[P.T.B.id] && VIEW[P.T.B.id].three) { P.T.user.zoom = c.z; P.T.user.px = 0; P.T.user.py = 0; return; }
  const a = aimUser(P.T, P.S, c.x, c.y, c.z);
  P.T.user.zoom = a.zoom; P.T.user.px = a.px; P.T.user.py = a.py;
}
// After a view change: the camera starts on the new layout centre.
function camReset(z = 1) { const [x, y] = centreOf(run.P); Object.assign(run.cam, { x, y, z, vx: 0, vy: 0, vz: 0 }); }
function view(id, color) {
  const P = run.P;
  P.setView(id);
  if (color) P.S.color = color;
  camReset(run.cam.z || 1);
}
const scr = i => run.P.T.pos[i];   // screen place of tile i at the last draw

// ── shots ─────────────────────────────────────────────────────────────────
// start(sh): set the table up. tick(sh, tau, u, dt): move it and return
// the plate sub-state k. light(g, sh, tau, u): the light layer.
const SHOTS = {
  flight: {
    start(sh) { run.seg = -1; run.cam.z = 0.9; },
    tick(sh, tau, u, dt) {
      const P = run.P, n = sh.views.length, segDur = sh.dur / n;
      const seg = Math.min(n - 1, Math.floor(tau / segDur));
      if (seg !== run.seg) { run.seg = seg; run.segT = tau; view(sh.views[seg], VIEW[sh.views[seg]].color); run.cam.z = 0.9; }
      const s = tau - run.segT, m = P.T.dur, b = P.T.B.bounds, [cx, cy] = centreOf(P);
      if (s < m) {
        // ride the wave: it sweeps left to right across the new layout
        const q = ease(s / m);
        aim(lerp(b.x0 + (b.x1 - b.x0) * 0.32, cx, q), cy, lerp(0.9, 1, q), dt, 4);
        P.S.hover = -1;
      } else {
        const v = ease((s - m) / Math.max(0.5, segDur - m)), i = sh.focus[seg] - 1, it = itemOf(P, i);
        aim(lerp(cx, it.x, 0.6 * v), lerp(cy, it.y, 0.6 * v), 1 + 0.45 * v, dt, 2.2);
        P.S.hover = v > 0.3 ? i : -1;
      }
      run.light = P.S.hover >= 0 ? { i: P.S.hover, a: 0.5 } : null;
      return seg;
    },
    light(g, sh) {
      const T = run.P.T;
      FX.drawStreaks(g, run.hist, TRAIL, run.head, N, run.cols, run.sides, T.moving ? 1 : 0);
      if (run.P.S.hover >= 0) { const p = scr(run.P.S.hover); FX.drawHalo(g, p.sx, p.sy, p.ss, run.cols[run.P.S.hover], 0.8); }
    },
  },
  walk: {
    start(sh) {
      const P = run.P, f = FAMILY[sh.family];
      view(sh.view);
      P.S.match = new Set(f.z.map(z => z - 1));
      run.walk = f.z.map(z => z - 1);
    },
    tick(sh, tau, u, dt) {
      const P = run.P, n = run.walk.length, per = (sh.dur - 0.5) / n;
      const m = Math.min(n - 1, Math.floor(tau / per)), i = run.walk[m], it = itemOf(P, i);
      aim(it.x, it.y, zoomFor(P, i, 0.3), dt, 6);
      P.S.hover = i;
      run.light = { i, a: 0.6 };
      return m;
    },
    light(g, sh, tau) {
      // a faint line through the family, the visited part brighter
      const P = run.P, n = run.walk.length, per = (sh.dur - 0.5) / n, m = Math.min(n - 1, Math.floor(tau / per));
      const col = CAT[ELEMENTS[run.walk[0]].cat].color;
      g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      for (let k = 1; k < n; k++) {
        const a = scr(run.walk[k - 1]), b = scr(run.walk[k]);
        g.strokeStyle = k <= m ? 'rgba(255,240,210,0.45)' : 'rgba(160,190,255,0.16)';
        g.lineWidth = k <= m ? 2 : 1;
        g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke();
      }
      g.restore();
      const p = scr(run.walk[m]);
      FX.drawHalo(g, p.sx, p.sy, p.ss, col, 0.9);
    },
  },
  atom: {
    start(sh) { view(sh.view); run.i = sh.z - 1; run.steps = ieSteps(ELEMENTS[run.i]); run.isos = isoBars(ELEMENTS[run.i]); },
    tick(sh, tau, u, dt) {
      const P = run.P, i = run.i, it = itemOf(P, i);
      const push = ease(u / 0.26);
      aim(it.x, it.y, lerp(1, zoomFor(P, i, 0.5), push), dt, 4.5);
      P.S.hover = i;
      run.open = ease((u - 0.22) / 0.16);
      run.mix = ease((u - 0.6) / 0.14);
      run.panels = ease((u - 0.42) / 0.12);
      run.light = run.open < 0.5 ? { i, a: 0.6 } : null;
      return run.mix > 0.5 ? 1 : 0;
    },
    light(g, sh, tau, u, t, W, H) {
      const e = ELEMENTS[run.i], col = CAT[e.cat].color, f = run.P.S.frame, a = run.open;
      if (a < 0.002) return;
      const p = scr(run.i), L = atomLayout(f);
      const s0 = Math.max(4, p.ss);
      const r = { x: lerp(p.sx - s0 / 2, L.atom.x, a), y: lerp(p.sy - s0 / 2, L.atom.y, a), w: lerp(s0, L.atom.w, a), h: lerp(s0, L.atom.h, a) };
      FX.drawVeil(g, W, H, a);
      FX.drawLight(g, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.75, col, 0.35 * a);
      drawAtom(g, e, r, t, run.mix, { alpha: a, scale: Math.max(1, r.w / 300), budget: 5000, labels: a > 0.9 });
      FX.drawIEPanel(g, L.ie, run.steps, col, run.panels);
      FX.drawIsoPanel(g, L.iso, run.isos, col, run.panels);
    },
  },
  melt: {
    start(sh) { view(sh.view); run.P.setTemp(sh.from); },
    tick(sh, tau, u, dt) {
      const P = run.P, [cx, cy] = centreOf(P), b = P.T.B.bounds;
      P.setTemp(sh.from * Math.pow(sh.to / sh.from, ease((u - 0.06) / 0.86)));
      aim(lerp(cx, b.x0 + (b.x1 - b.x0) * 0.62, ease(u)), cy, 1 + 0.12 * ease(u), dt, 1.6);
      return 0;
    },
    light(g) {
      const S = run.P.S;
      for (let i = 0; i < N; i++) {
        const ph = phaseAt(ELEMENTS[i], S.temp), p = scr(i);
        if (ph === 'liquid') FX.drawHalo(g, p.sx, p.sy, p.ss, '#36d6ff', 0.32);
        else if (ph === 'gas') FX.drawLight(g, p.sx, p.sy, p.ss * 0.9, '#ff9a6b', 0.22);
      }
    },
  },
  timeline: {
    start(sh) { run.P.S.year = sh.from; view('timeline'); run.bursts = []; run.newest = known(sh.from); },
    tick(sh, tau, u, dt) {
      const P = run.P, S = P.S;
      const y = Math.round(sh.from + (2030 - sh.from) * ease((u - 0.04) / 0.86));
      if (y !== S.year) {
        for (const e of ELEMENTS) if (e.disc.year != null && e.disc.year > S.year && e.disc.year <= y) run.bursts.push({ i: e.z - 1, t0: tau });
        S.year = y; P.refreshView();
        const k = known(y);
        if (k.year !== run.newest.year && tau - (run.plateT || 0) > 0.45) { run.newest = k; run.plateT = tau; }
      }
      const [cx, cy] = centreOf(P);
      aim(cx, cy, 1, dt, 2.5);
      run.bursts = run.bursts.filter(b => tau - b.t0 < 1.6);
      return { year: run.newest.year > -Infinity ? run.newest.year : sh.from, newest: run.newest.newest };
    },
    light(g, sh, tau) {
      for (const b of run.bursts) { const p = scr(b.i); FX.drawBurst(g, p.sx, p.sy, p.ss, run.cols[b.i], (tau - b.t0) / 1.6); }
      const f = run.P.S.frame;
      if (f.strip) FX.drawCounter(g, f.strip, String(run.P.S.year), `${known(run.P.S.year).count} of 118 known`, ease(tau / 0.8));
    },
  },
  tower: {
    start(sh) {
      const P = run.P;
      P.S.prop = sh.prop; P.S.cmap = sh.cmap; view('tower', 'prop');
      const hs = P.T.B.items.map(it => it.h);
      run.top = hs.indexOf(Math.max(...hs));
      run.cam.z = 0.92;
    },
    tick(sh, tau, u, dt) {
      const T = run.P.T;
      T.rot.yaw = sh.yaw0 + sh.turn * tau * run.slow;
      T.rot.pitch = lerp(0.62, 1.02, ease(u));
      aim(0, 0, lerp(0.95, 1.1, ease(u)), dt, 2);
      return 0;
    },
    light(g) {
      const p = scr(run.top);
      FX.drawLight(g, p.sx, p.sy, p.ss * 2.2, '#fff1c8', 0.45 * run.P.T.a3);
      FX.drawHalo(g, p.sx, p.sy, p.ss, '#ffe2a0', 0.7 * run.P.T.a3);
    },
  },
  heat: {
    start(sh) {
      const P = run.P;
      P.S.prop = sh.props[0]; P.S.cmap = sh.cmaps[0];
      view(sh.view, 'prop');
      run.switched = false; run.scanT = sh.dur * 0.46;
      run.poi = (sh.seed % 1000) / 1000;
    },
    tick(sh, tau, u, dt) {
      const P = run.P, S = P.S, f = S.frame, b = P.T.B.bounds, [cx, cy] = centreOf(P);
      const sx = f.x + f.w * (tau - run.scanT) / 1.5;
      if (!run.switched && sx > f.x + f.w / 2) {
        run.switched = true; S.prop = sh.props[1]; S.cmap = sh.cmaps[1];
        if (sh.view === 'heat') P.refreshView();
      }
      run.scanX = sx;
      aim(lerp(cx, b.x0 + (b.x1 - b.x0) * (0.25 + 0.5 * run.poi), 0.35 * ease(u)), cy, 1 + 0.1 * ease(u), dt, 1.4);
      return run.switched ? 1 : 0;
    },
    light(g) {
      const f = run.P.S.frame, a = run.scanX > f.x - 40 && run.scanX < f.x + f.w + 40 ? 1 : 0;
      FX.drawScan(g, f, run.scanX, '#cfe0ff', a);
    },
  },
  scatter: {
    start(sh) {
      const P = run.P, S = P.S;
      S.x = sh.x; S.y = sh.y; S.cmap = sh.cmap; S.prop = sh.y;
      view('scatter', 'prop');
      run.walk = FAMILY[sh.family].z.map(z => z - 1); run.lit = null;
    },
    tick(sh, tau, u, dt) {
      const P = run.P, [cx, cy] = centreOf(P), on = u > 0.45;
      P.S.match = on ? (run.lit || (run.lit = new Set(run.walk))) : null;
      let mx = 0, my = 0;
      for (const i of run.walk) { mx += itemOf(P, i).x; my += itemOf(P, i).y; }
      mx /= run.walk.length; my /= run.walk.length;
      const v = ease((u - 0.45) / 0.4);
      aim(lerp(cx, mx, 0.3 * v), lerp(cy, my, 0.3 * v), 1 + 0.18 * v, dt, 1.8);
      return on ? 1 : 0;
    },
    light(g, sh, tau, u) {
      if (u < 0.45) return;
      const a = ease((u - 0.45) / 0.15);
      for (const i of run.walk) { const p = scr(i); FX.drawHalo(g, p.sx, p.sy, p.ss * 1.4, CAT[ELEMENTS[i].cat].color, 0.8 * a); }
    },
  },
  orbit: {
    start(sh) { view(sh.view, 'cat'); },
    tick(sh, tau, u, dt) {
      const P = run.P, n = sh.focus.length, seg = Math.min(n - 1, Math.floor(u * n)), su = u * n - seg;
      const i = sh.focus[seg] - 1, it = itemOf(P, i), [cx, cy] = centreOf(P);
      const inn = su < 0.72 ? ease(su / 0.4) : 1 - ease((su - 0.72) / 0.28);
      aim(lerp(cx, it.x, inn), lerp(cy, it.y, inn), lerp(1, zoomFor(P, i, 0.26), inn), dt, 3);
      P.S.hover = inn > 0.4 ? i : -1;
      run.light = { i, a: 0.5 * inn };
      return seg;
    },
    light(g) { const i = run.P.S.hover; if (i >= 0) { const p = scr(i); FX.drawHalo(g, p.sx, p.sy, p.ss, run.cols[i], 0.85); } },
  },
};

function startShot(sh) {
  const P = run.P, S = P.S;
  run.sh = sh; run.t0 = now(); run.k = 0; run.plateKey = ''; run.light = null;
  S.closeup = null; S.phaseOn = false; S.match = null; S.hover = -1; S.pin = -1;
  S.frame = frameOf(run.band, sh.kind);
  run.cam.z = 1;
  SHOTS[sh.kind].start(sh);
}

function setPlate(info) {
  const key = JSON.stringify(info);
  if (key === run.plateKey) return;
  run.plateKey = key;
  try { if (typeof run.o.label === 'function') run.o.label(info); } catch (e) { /* the plate is optional */ }
}

// The sky layer: Table.drawBg, then the stars and the light under the
// subject. Bound to the Table instance while the saver runs.
function skyBg(...args) {
  const T = this, [g, W, H, , t] = args;
  Object.getPrototypeOf(T).drawBg.apply(T, args);
  if (!run) return;
  const c = T.cam, b = T.B && T.B.bounds;
  const pan = b ? [((c.cx || 0) - (b.x0 + b.x1) / 2) * c.k, ((c.cy || 0) - (b.y0 + b.y1) / 2) * c.k] : [0, 0];
  FX.drawSky(g, W, H, { x: pan[0], y: pan[1], z: T.user.zoom || 1 }, t * run.slow);
  const L = run.light;
  if (L && L.i >= 0) { const p = T.pos[L.i]; if (p && p.ss) FX.drawLight(g, p.sx, p.sy, p.ss * 2.4, run.cols[L.i] || '#8fb6ff', L.a); }
}

function step() {
  if (!run) return;
  run.raf = requestAnimationFrame(step);
  const P = run.P, S = P.S, sh = run.sh, T = P.T;
  const t = now(), tau = t - run.t0, u = tau / sh.dur;
  const dt = clamp(t - (run.last || t), 0, 0.1); run.last = t;
  if (run.k++ % 30 === 0) { run.band = bandOf(P); const f = frameOf(run.band, sh.kind); if (JSON.stringify(f) !== JSON.stringify(S.frame)) S.frame = f; }
  const k = SHOTS[sh.kind].tick(sh, tau, u, dt);
  setPlate(plateFor(sh, k));
  // tile colours and the trail history from the frame main.js just drew
  // colours only when the colour mode changes: a Z_eff colour map costs ~2 ms
  const ck = S.color + S.prop + S.cmap + (S.color === 'phase' ? Math.round(S.temp) : '');
  if (ck !== run.colKey) { run.colKey = ck; for (let i = 0; i < N; i++) run.cols[i] = colorOf(ELEMENTS[i], S) || '#8fb6ff'; }
  for (let i = 0; i < N; i++) run.sides[i] = T.pos[i].ss || 0;
  run.head = (run.head + 1) % TRAIL;
  const o = run.head * N * 2;
  for (let i = 0; i < N; i++) { run.hist[o + i * 2] = T.pos[i].sx; run.hist[o + i * 2 + 1] = T.pos[i].sy; }
  // the light layer, over the table in the same canvas
  const cv = P.canvas, W = cv.clientWidth || 1, H = cv.clientHeight || 1, dpr = cv.width / W;
  const g = cv.getContext('2d');
  g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  try { SHOTS[sh.kind].light(g, sh, tau, u, t, W, H); } catch (e) { if (!run.warned) { run.warned = true; console.warn('saver light', e); } }
  g.restore();
  if (tau >= sh.dur) {
    run.i0 = (run.i0 + 1) % run.plan.length;
    startShot(run.plan[run.i0]);
  }
}

window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const P = window.__pt;
    if (!P) return null;
    P.saver = true;
    const calm = clamp(+o.calm || 0, 0, 1);
    run = { o, P, plan: planShots((o.seed >>> 0) || ((Math.random() * 1e9) >>> 0), 64, { calm }), i0: 0,
      slow: 1 - 0.35 * calm, cam: { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0 },
      cols: new Array(N).fill('#8fb6ff'), sides: new Float32Array(N), hist: new Float32Array(TRAIL * N * 2), head: 0,
      keep: { view: P.S.view, color: P.S.color, prop: P.S.prop, cmap: P.S.cmap, temp: P.S.temp, phaseOn: P.S.phaseOn, year: P.S.year, x: P.S.x, y: P.S.y, match: P.S.match, rot: { ...P.T.rot } } };
    document.body.classList.add('saver');
    P.resize();
    if (typeof P.T.drawBg === 'function') P.T.drawBg = skyBg;
    run.band = bandOf(P);
    startShot(run.plan[0]);
    run.raf = requestAnimationFrame(step);
    return { canvas: P.canvas, warmupMs: 900 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    const P = run.P, k = run.keep;
    if (typeof run.o.label === 'function') { try { run.o.label(null); } catch (e) { /* ok */ } }
    if (Object.prototype.hasOwnProperty.call(P.T, 'drawBg')) delete P.T.drawBg;
    document.body.classList.remove('saver');
    P.saver = false;
    Object.assign(P.S, { color: k.color, prop: k.prop, cmap: k.cmap, phaseOn: k.phaseOn, year: k.year, x: k.x, y: k.y, match: k.match, closeup: null, hover: -1, frame: null });
    P.setTemp(k.temp, { phase: k.phaseOn });
    Object.assign(P.T.rot, k.rot);
    P.resize();
    P.setView(k.view, { keepColor: true });
    run = null;
  },
};
window.snSaver.debug = () => (run ? { kind: run.sh.kind, i: run.i0, t: now() - run.t0, dur: run.sh.dur, cam: { ...run.cam } } : null);
window.snSaver.cut = kind => { if (!run) return; const j = run.plan.findIndex((p, i) => i > run.i0 && p.kind === kind); if (j >= 0) { run.i0 = j; startShot(run.plan[j]); } };
