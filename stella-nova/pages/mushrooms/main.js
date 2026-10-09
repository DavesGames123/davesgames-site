// ============================================================================
//  MUSHROOM DRAW  ·  main.js — the page: controls, history, view and boot
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). The engine (engine.js) runs on this
//  thread: one specimen takes about 50-150 ms, so a slider drag waits for
//  a short pause, and a plate grid builds one cell per frame.
//
//  STATE (S). form, seed and params are the specimen on show; base is
//  formParams(form, seed), so the edits are diffParams(params, base).
//  hist holds { form, seed, params } entries; hi is the place in it.
//  Each mode has its own plate settings (S.plates.single, S.plates.grid).
//
//  VIEW. The plate is in mm (plate.js). fitView() finds the device px per
//  mm that fits the plate in the clear part of the desk; the user zoom
//  (z) and pan (px, py) go on top. draw() strokes every line as vectors
//  through that transform, so a zoom stays sharp.
//
//  GREP MAP
//    grep -n 'function layout'      the canvas size and the clear area
//    grep -n 'function plateNow'    the layout of the plate on screen
//    grep -n 'function fitView'     plate mm to device px
//    grep -n 'function draw'        one frame
//    grep -n 'function frame'       the loop: pen draw-on, grid fill, redraw
//    grep -n 'function getSpec'     the specimen cache
//    grep -n 'function showSpec'    build a specimen, then show it
//    grep -n 'function buildGrid'   the cell specs and the progressive fill
//    grep -n 'function buildParams' the parameter panel
//    grep -n 'function syncUI'      the controls from the state
//    grep -n 'function toggleColour' the colour on/off pill and dock button
//    grep -n 'function writeHash'   the share link
//    grep -n 'function readHash'    the boot state from the link
//    grep -n 'function bindView'    pan, zoom and pinch
//    grep -n 'function bindExport'  the export buttons (export.js)
//    grep -n 'function setOpen'     the panel, the phone sheet, the dock
//    grep -n 'function followCamera' the tree camera (follow, then overview)
//    grep -n 'function drawMinimap'  the tree minimap
//    grep -n 'BOOT'                 the boot order
//  TREE. The tree of life mode is in treemode.js (TM). main.js gives it the
//  plate, the view and the taps; TM draws the tree in the plate content.
//  The screensaver hook (window.snSaver) is in saver.js, loaded by a dynamic
//  import at boot; it sets S.saver,
//  and frame() then leaves the canvas to it.
// ============================================================================
import { buildSpecimen, formParams, randomParams, FORMS, FORM_KEYS, PARAMS, GROUPS, PARAM_BY_KEY, sanitize, mutate,
  takeGroup, applyLocks, diffParams, encodeShare, decodeShare, roundTo, randomName } from './engine.js';
import { mulberry } from './geom.js';
import { THEMES, THEME_KEYS, STYLES, STYLE_KEYS, PAGES, MM_PER_PX, GRID_PRESETS, pageSize, layoutPlate, cellAt, pngSize } from './plate.js';
import { drawPlate, makeGrain } from './render.js';
import { exportSVG, exportPNG, exportJSON, copyLink, slug, download } from './export.js';
import { createTreeMode } from './treemode.js';
import { typesetAll } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const HIST_MAX = 200;
const rand32 = () => ((Math.random() * 4294967295) >>> 0) || 1;
const formLabel = f => (FORMS[f] ? FORMS[f].label : 'Random species');

const canvas = $('view'), ctx = canvas.getContext('2d'), panel = $('panel');

const S = {
  mode: 'single', form: 'fly', seed: 1, params: null, base: null, spec: null,
  locks: new Set(), hist: [], hi: -1, mutAmt: 0.15,
  style: 'wash', theme: 'cream', ink: null, pen: 0.3, jitter: 0, grain: true, title: '',
  plates: {
    single: { page: 'screen', orient: 'landscape', border: false, title: false, labels: true, scale: true },
    grid: { page: 'screen', orient: 'landscape', border: true, title: true, labels: true, scale: false },
    tree: { page: 'screen', orient: 'landscape', border: false, title: true, labels: false, scale: false },
  },
  anim: { auto: !REDUCED, tip: true, speed: 0.5, p: null, last: 0 },
  view: { z: 1, px: 0, py: 0 },
  grid: { rows: 3, cols: 3, seed: 1, src: 'random', spread: 0.3, preset: '3x3', no: 1 },
  gspec: [], gfish: [], gprog: [], gqueue: [], hiCell: -1,
  dpr: 1, clear: { x: 0, y: 0, w: 1, h: 1 }, dirty: true, saver: null,
};
let grain = null;
let lastPlate = null;
let TM = null;           // the tree mode (treemode.js)

// ── getSpec ─────────────────────────────────────────────────────────────────
// A small cache of built specimens, keyed by the full params and seed.
const cache = new Map();
function getSpec(params, seed) {
  const key = seed + '|' + PARAMS.map(d => roundTo(params[d.key], 0.0001)).join(',');
  let f = cache.get(key);
  if (f) { cache.delete(key); cache.set(key, f); return f; }
  f = buildSpecimen(params, seed);
  cache.set(key, f);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return f;
}

// ── layout ──────────────────────────────────────────────────────────────────
function layout() {
  const desk = $('desk').getBoundingClientRect();
  S.dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(desk.width * S.dpr)), h = Math.max(1, Math.round(desk.height * S.dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  let L = desk.left, R = desk.right, T = desk.top, B = desk.bottom;
  if (panel.classList.contains('open') && !S.saver) {
    if (LAND_Q.matches) R = Math.min(R, innerWidth - panel.offsetWidth);
    else if (PHONE_Q.matches) { const top = desk.bottom - panel.offsetHeight; if (top - T > 150) B = top; }
    else L = Math.max(L, panel.offsetWidth);
  }
  if (LAND_Q.matches && !S.saver) { const d = $('dock').getBoundingClientRect(); if (d.height) B = Math.min(B, d.top); }
  const cap = S.saver ? 0 : 30;
  S.clear = { x: L - desk.left, y: T - desk.top, w: Math.max(40, R - L), h: Math.max(40, B - T - cap) };
  S.dirty = true;
  if (S.params && !S.saver) syncExport();
}

// ── plateNow ────────────────────────────────────────────────────────────────
function plateCfg() { return S.plates[S.mode]; }
function plateNow() {
  const cfg = plateCfg(), grid = S.mode === 'grid', G = S.grid;
  const vw = { w: S.clear.w * MM_PER_PX, h: S.clear.h * MM_PER_PX };
  const size = pageSize(cfg.page, cfg.orient, vw);
  if (S.mode === 'tree') {
    const pt = TM.plateText();
    const mk = (w, h) => layoutPlate({ w, h, rows: 1, cols: 1, screen: cfg.page === 'screen', border: cfg.border, title: cfg.title, labels: false,
      titleText: S.title || pt.title, subText: pt.sub, footRight: 'davesgames.io', names: [], plateNo: 1 });
    if (!natural()) return mk(size.w, size.h);
    // The 'screen' page grows to the natural size of the tree and to the
    // aspect of the view, so the mushrooms keep their size and the view pans.
    const nat = TM.natSize(), asp = vw.w / vw.h;
    let W = nat.w * 1.08, H = nat.h * 1.08, L = null;
    for (let i = 0; i < 4; i++) {
      if (W / H < asp) W = H * asp; else H = W / asp;
      L = mk(W, H);
      if (L.content.w >= nat.w - 1e-6 && L.content.h >= nat.h - 1e-6) break;
      W += Math.max(0, nat.w - L.content.w) + 1; H += Math.max(0, nat.h - L.content.h) + 1;
    }
    return L;
  }
  const names = grid ? S.gspec.map(c => c.name) : [S.spec ? S.spec.name : ''];
  const srcText = { random: 'random species', form: 'the ' + formLabel(S.form).toLowerCase() + ' form', family: 'the family of ' + (S.spec ? S.spec.name.split(' ')[0] : '') };
  const sub = grid ? `${G.rows * G.cols} specimens of ${srcText[G.src]}, plate seed ${G.seed}` : `${formLabel(S.form)} form, seed ${S.seed}`;
  return layoutPlate({
    w: size.w, h: size.h, rows: grid ? G.rows : 1, cols: grid ? G.cols : 1, screen: cfg.page === 'screen',
    border: cfg.border, title: cfg.title, labels: cfg.labels,
    titleText: S.title || (grid ? 'Fungi fictae' : names[0]) || 'Fungi fictae', subText: sub,
    footRight: 'davesgames.io', names, plateNo: grid ? G.no : 1, fig: !grid,
  });
}

// ── fitView ─────────────────────────────────────────────────────────────────
function fitView(L) {
  const c = S.clear, screen = plateCfg().page === 'screen';
  const fit = Math.min(c.w / L.w, c.h / L.h) * (screen ? 1 : 0.92);
  const s = fit * S.view.z * S.dpr;
  return { s, ox: (c.x + c.w / 2 + S.view.px) * S.dpr - L.w * s / 2, oy: (c.y + c.h / 2 + S.view.py) * S.dpr - L.h * s / 2, fit };
}

// ── draw ────────────────────────────────────────────────────────────────────
function draw() {
  const L = plateNow(), view = fitView(L), cfg = plateCfg(), grid = S.mode === 'grid';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (S.mode === 'tree') {
    drawPlate(ctx, { L: Object.assign({}, L, { cells: [] }), theme: THEMES[S.theme], ink: S.ink, style: S.style, pen: S.pen, jitter: S.jitter, view,
      specs: [], progress: [], grain: S.grain ? grain : null, marker: false, hiCell: -1, paperOut: cfg.page !== 'screen', dpr: S.dpr });
    TM.draw(ctx, L, view);
    lastPlate = { L, view };
    placeCaption(L, view);
    drawMinimap(L, view);
    return;
  }
  $('minimap').classList.remove('on');
  drawPlate(ctx, {
    L, theme: THEMES[S.theme], ink: S.ink, style: S.style, pen: S.pen, jitter: S.jitter, view,
    specs: grid ? S.gfish : [S.spec], progress: grid ? S.gprog : [S.anim.p], grain: S.grain ? grain : null,
    marker: S.anim.tip, hiCell: grid ? S.hiCell : -1, paperOut: cfg.page !== 'screen', dpr: S.dpr, scale: cfg.scale,
  });
  lastPlate = { L, view };
  placeCaption(L, view);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function placeCaption(L, view) {
  const cap = $('caption'), f = S.spec;
  if (S.mode === 'tree') {
    const t = S.tr.tree;
    cap.innerHTML = t ? `Tree of <i>${esc(t.nodes[0].name)}</i> · <span class="n">${S.tr.specs.size}/${t.nodes.length}</span> drawn · tap a mushroom or a branch` : '';
  } else if (S.mode === 'grid') {
    const n = S.gspec.length, done = S.gfish.filter(Boolean).length, hi = S.hiCell >= 0 && S.gspec[S.hiCell];
    cap.innerHTML = hi ? `${S.hiCell + 1}. <i>${esc(hi.name)}</i> · ${esc(formLabel(hi.form))} · click to open`
      : `Plate of ${n} · <span class="n">${done}/${n}</span> drawn`;
  } else if (!f) { cap.textContent = ''; return; }
  else {
    const ed = Object.keys(diffParams(S.params, S.base)).length;
    cap.innerHTML = `<i>${esc(f.name)}</i> · ${esc(formLabel(S.form))} · seed <span class="n">${S.seed}</span> · <span class="n">${f.offs.length - 1}</span> lines` + (ed ? ` · ${ed} edited` : '');
  }
  const bottom = Math.min((view.oy + L.h * view.s) / S.dpr, S.clear.y + S.clear.h) + 8;
  cap.style.left = (S.clear.x + S.clear.w / 2) + 'px';
  cap.style.top = bottom + 'px';
}

// ── tree sizing and camera ──────────────────────────────────────────────────
// The least on-screen width of a tip mushroom in the tree mode, CSS px.
const minPx = () => (PHONE_Q.matches ? 120 : 180);
// A tip box in mm on the 'screen' page: 1.3 x the least width at zoom 1.
const tipMM = () => minPx() * 1.3 * MM_PER_PX;
const natural = () => S.mode === 'tree' && plateCfg().page === 'screen';
// The view moves toward TM.cameraTarget on a critically damped spring, so
// a jump of the target (a new node) starts smooth. True when it moved.
const cam = { vx: 0, vy: 0, vz: 0 };
function followCamera(dt, L) {
  const fit = fitView(L).fit, c = TM.cameraTarget(L, fit);
  if (!c) { cam.vx = cam.vy = cam.vz = 0; return false; }
  const v = S.view, w = 2.4, n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  const before = v.px + v.py + v.z;
  for (let i = 0; i < n; i++) {
    const tx = -(c.x - L.w / 2) * fit * v.z, ty = -(c.y - L.h / 2) * fit * v.z;
    cam.vx += (w * w * (tx - v.px) - 2 * w * cam.vx) * h; cam.vy += (w * w * (ty - v.py) - 2 * w * cam.vy) * h; cam.vz += (w * w * (c.z - v.z) - 2 * w * cam.vz) * h;
    v.px += cam.vx * h; v.py += cam.vy * h; v.z = Math.max(0.5, v.z + cam.vz * h);
  }
  return Math.abs(v.px + v.py + v.z - before) > 0.01;
}
// The minimap: in the tree mode when the plate is larger than the clear
// area at the current zoom. A tap or a drag on it moves the view.
function drawMinimap(L, view) {
  const mm = $('minimap');
  const big = S.mode === 'tree' && !S.saver && S.tr.tree && (L.w * view.s / S.dpr > S.clear.w * 1.02 || L.h * view.s / S.dpr > S.clear.h * 1.02);
  mm.classList.toggle('on', !!big);
  if (!big) return;
  const maxW = PHONE_Q.matches ? 120 : 180, maxH = PHONE_Q.matches ? 90 : 130;
  const k = Math.min(maxW / L.w, maxH / L.h), W = Math.round(L.w * k), H = Math.round(L.h * k);
  mm.style.width = W + 'px'; mm.style.height = H + 'px';
  mm.width = W * S.dpr; mm.height = H * S.dpr;
  const x = mm.getContext('2d'), th = THEMES[S.theme], q = k * S.dpr;
  x.fillStyle = th.paper; x.fillRect(0, 0, mm.width, mm.height);
  const lay = TM.layoutFor(L), tree = S.tr.tree;
  x.strokeStyle = S.ink || th.ink; x.globalAlpha = 0.6; x.lineWidth = 1;
  x.beginPath();
  for (const n of tree.nodes) {
    const b = lay.branch[n.id]; if (!b) continue;
    x.moveTo(b.elbow[0][0] * q, b.elbow[0][1] * q);
    for (const p of b.elbow) x.lineTo(p[0] * q, p[1] * q);
    x.moveTo(b.run[0][0] * q, b.run[0][1] * q); x.lineTo(b.run[1][0] * q, b.run[1][1] * q);
  }
  x.stroke();
  x.globalAlpha = 0.8; x.fillStyle = S.ink || th.ink;
  for (const id of tree.tips) { const b = lay.box[id]; if (b) x.fillRect(b.x * q, b.y * q, Math.max(2, b.w * q), Math.max(1.5, b.h * q)); }
  const v0x = (S.clear.x * S.dpr - view.ox) / view.s, v0y = (S.clear.y * S.dpr - view.oy) / view.s;
  x.globalAlpha = 1; x.strokeStyle = '#e3c48a'; x.lineWidth = 2 * S.dpr;
  x.strokeRect(v0x * q, v0y * q, S.clear.w * S.dpr / view.s * q, S.clear.h * S.dpr / view.s * q);
  mm.dataset.k = k;
}
function bindMinimap() {
  const mm = $('minimap');
  let down = false;
  const go = e => {
    if (!lastPlate) return;
    const r = mm.getBoundingClientRect(), k = +mm.dataset.k || 1;
    const mx = (e.clientX - r.left) / k, my = (e.clientY - r.top) / k, L = lastPlate.L, fit = fitView(L).fit;
    S.tr.follow = false;
    S.view.px = -(mx - L.w / 2) * fit * S.view.z; S.view.py = -(my - L.h / 2) * fit * S.view.z;
    S.dirty = true;
  };
  mm.addEventListener('pointerdown', e => { down = true; try { mm.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ } go(e); });
  mm.addEventListener('pointermove', e => { if (down) go(e); });
  mm.addEventListener('pointerup', () => { down = false; });
  mm.addEventListener('pointercancel', () => { down = false; });
}

// ── frame ───────────────────────────────────────────────────────────────────
// The pen speed slider sets the time of one draw-on: 14 s at 0, 1.1 s at 1.
function drawTime() { return 14 * Math.pow(0.08, S.anim.speed); }
function frame(now) {
  requestAnimationFrame(frame);
  if (S.saver) return;
  const a = S.anim, dt = Math.min(0.1, (now - (a.last || now)) / 1000);
  a.last = now;
  if (S.mode === 'tree') {
    if (TM.pump(14)) S.dirty = true;
    if (TM.tick(dt)) S.dirty = true;
    if (lastPlate && followCamera(dt, lastPlate.L)) S.dirty = true;
    busy();
  }
  if (a.p != null && S.spec && S.mode !== 'tree') {
    a.p += S.spec.total / drawTime() * dt;
    if (a.p >= S.spec.total) { a.p = null; syncPlay(); }
    S.dirty = true;
  }
  if (S.mode === 'grid') {
    for (let i = 0; i < S.gprog.length; i++) {
      const g = S.gfish[i];
      if (S.gprog[i] == null || !g) continue;
      S.gprog[i] += g.total / drawTime() * 1.6 * dt;
      if (S.gprog[i] >= g.total) { S.gprog[i] = null; if (!drawing()) syncPlay(); }
      S.dirty = true;
    }
    // One cell per frame, so the page stays live while a plate fills.
    const t0 = performance.now();
    while (S.gqueue.length && performance.now() - t0 < 24) {
      const i = S.gqueue.shift(), c = S.gspec[i];
      if (!c) continue;
      S.gfish[i] = getSpec(c.params, c.seed);
      S.gprog[i] = S.anim.auto ? 0 : null;
      S.dirty = true;
    }
    busy();
  }
  if (S.dirty) { S.dirty = false; draw(); }
}
function startDrawOn() {
  if (S.mode === 'tree') { TM.togglePlay(); return; }
  if (S.mode === 'grid') { S.gprog = S.gfish.map(f => (f ? 0 : null)); S.dirty = true; syncPlay(); return; }
  if (!S.spec) return;
  S.anim.p = 0; S.dirty = true; syncPlay();
}
function drawing() { return S.mode === 'tree' ? S.tr.playing : S.mode === 'grid' ? S.gprog.some(p => p != null) : S.anim.p != null; }
function stopDrawOn() { if (S.mode === 'tree') { if (S.tr.playing) TM.togglePlay(); return; } S.anim.p = null; S.gprog = S.gprog.map(() => null); S.dirty = true; syncPlay(); }
function syncPlay() {
  $('playBtn').textContent = drawing() ? 'Finish' : 'Draw on';
  $('dockDraw').classList.toggle('on', drawing());
}
function busy() { $('busy').hidden = !((S.mode === 'grid' && S.gqueue.length) || (S.mode === 'tree' && TM && TM.busy())); }

// ── showSpec ────────────────────────────────────────────────────────────────
// params null: the form params of (form, seed).
function showSpec(form, seed, params, { push = true, animate = S.anim.auto } = {}) {
  S.form = FORMS[form] ? form : 'random';
  S.seed = (seed >>> 0) || 1;
  S.base = formParams(S.form, S.seed);
  S.params = sanitize(Object.assign({}, S.base, params || {}));
  if (push) pushHist();
  try { S.spec = getSpec(S.params, S.seed); } catch (err) { console.error(err); note('This specimen broke the engine: ' + err.message); }
  if (animate && S.mode === 'single') startDrawOn(); else if (S.mode !== 'tree') { S.anim.p = null; syncPlay(); }
  if (S.mode === 'grid' && S.grid.src !== 'random') buildGrid();
  if (S.mode === 'tree') TM.onSpecimen();
  syncUI();
  writeHash();
}
function note(t) { $('seedLine').textContent = t; }
function pushHist() {
  S.hist = S.hist.slice(0, S.hi + 1);
  S.hist.push({ form: S.form, seed: S.seed, params: Object.assign({}, S.params) });
  if (S.hist.length > HIST_MAX) S.hist.shift();
  S.hi = S.hist.length - 1;
}
function goHist(d) {
  const i = S.hi + d;
  if (i < 0 || i >= S.hist.length) return;
  S.hi = i;
  const e = S.hist[i];
  showSpec(e.form, e.seed, e.params, { push: false });
}
function newSeed() {
  if (S.mode === 'tree') { TM.newTree(); return; }
  if (S.mode === 'grid' && S.grid.src !== 'family') { newPlate(); return; }
  const seed = rand32();
  const keep = diffParams(S.params, S.base);
  // A new seed keeps the edits of the form (and the locks).
  const base = formParams(S.form, seed);
  showSpec(S.form, seed, applyLocks(S.form === 'random' ? base : Object.assign({}, base, keep), S.params, S.locks));
}
function randomise() {
  const seed = rand32();
  showSpec('random', seed, applyLocks(randomParams(seed), S.params, S.locks));
}
function mutateSpec() {
  showSpec(S.form, S.seed, mutate(S.params, S.mutAmt, Math.random, S.locks));
}
function rollGroup(group) {
  showSpec(S.form, S.seed, takeGroup(S.params, randomParams(rand32()), group, S.locks));
}

// ── buildGrid ───────────────────────────────────────────────────────────────
function gridSpecs() {
  const G = S.grid, n = G.rows * G.cols, rnd = mulberry(G.seed ^ 0x51ED), out = [];
  const edits = diffParams(S.params, S.base);
  for (let i = 0; i < n; i++) {
    const u = (rnd() * 4294967295) >>> 0 || 1;
    let form = 'random', params;
    if (G.src === 'family') {
      form = S.form;
      params = i === 0 ? Object.assign({}, S.params) : mutate(S.params, G.spread, rnd, S.locks);
    } else if (G.src === 'form') {
      form = S.form;
      params = applyLocks(sanitize(Object.assign({}, formParams(S.form, u), S.form === 'random' ? {} : edits)), S.params, S.locks);
    } else params = applyLocks(randomParams(u), S.params, S.locks);
    const seed = G.src === 'family' && i === 0 ? S.seed : u;
    out.push({ form, seed, params, name: randomName(seed) });
  }
  return out;
}
function buildGrid() {
  if (!S.params) return;
  S.gspec = gridSpecs();
  S.gfish = S.gspec.map(() => null);
  S.gprog = S.gspec.map(() => null);
  S.gqueue = S.gspec.map((_, i) => i);
  S.dirty = true; syncPlay(); busy(); writeHash();
}
function newPlate() { S.grid.seed = rand32(); S.grid.no++; buildGrid(); syncUI(); }
let gridTimer = 0;
function gridSoon() { clearTimeout(gridTimer); gridTimer = setTimeout(buildGrid, 160); }
function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; S.hiCell = -1;
  resetView();
  S.anim.p = null;
  if (m === 'grid') buildGrid();
  else if (m === 'tree') { S.tr.follow = true; TM.onSpecimen(); }
  $('treeCard').hidden = m !== 'tree' || S.tr.sel < 0;
  syncUI(); layout(); writeHash();
}
const MODES = ['single', 'grid', 'tree'];
const MODE_ICON = { single: '◧', grid: '▦', tree: '⟟' }, MODE_NAME = { single: 'Single specimen', grid: 'Plate grid', tree: 'Tree of life' };
// The tree card: open a node as the specimen, or grow a new tree from it.
function openSpecimen(form, seed, params) { S.mode = 'single'; resetView(); $('treeCard').hidden = true; showSpec(form, seed, params); syncUI(); layout(); }
function setSpecimen(form, seed, params) { showSpec(form, seed, params, { animate: false }); }
function openCell(i) {
  const c = S.gspec[i];
  if (!c) return;
  S.mode = 'single'; S.hiCell = -1; resetView();
  showSpec(c.form, c.seed, c.params);
  syncUI(); layout();
}
function plateAt(x, y) {
  if (!lastPlate) return [-1, -1];
  const v = lastPlate.view;
  return [(x * S.dpr - v.ox) / v.s, (y * S.dpr - v.oy) / v.s];
}

// ── buildParams ─────────────────────────────────────────────────────────────
const LOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const rows = {};
let editTimer = 0;
function buildParams() {
  const host = $('params');
  host.innerHTML = '';
  for (const g of GROUPS) {
    const det = document.createElement('details');
    det.dataset.group = g.id;
    if (g.id === 'cap' || g.id === 'view') det.open = true;
    const sum = document.createElement('summary');
    sum.innerHTML = `<span>${g.label}</span><span class="ed"></span><button class="roll" title="Roll the unlocked fields of this group">Roll</button>`;
    sum.querySelector('.roll').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); rollGroup(g.id); });
    det.append(sum);
    const body = document.createElement('div'); body.className = 'body';
    for (const d of PARAMS.filter(x => x.group === g.id)) body.append(paramRow(d));
    det.append(body);
    host.append(det);
  }
}
function paramRow(d) {
  const row = document.createElement('div');
  row.className = 'pr';
  const lock = document.createElement('button');
  lock.className = 'lock'; lock.innerHTML = LOCK_SVG; lock.title = 'Lock ' + d.label;
  lock.setAttribute('aria-label', 'Lock ' + d.label);
  lock.addEventListener('click', () => { S.locks.has(d.key) ? S.locks.delete(d.key) : S.locks.add(d.key); syncUI(); });
  const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = d.label; nm.title = d.key;
  const val = document.createElement('span'); val.className = 'val';
  row.append(lock, nm, val);
  let ctl;
  if (d.kind === 'enum' || d.kind === 'bool') {
    ctl = document.createElement('div'); ctl.className = 'opts';
    (d.kind === 'bool' ? ['Off', 'On'] : d.opts).forEach((o, i) => {
      const b = document.createElement('button'); b.textContent = o; b.dataset.v = i;
      b.addEventListener('click', () => setParam(d.key, i, true));
      ctl.append(b);
    });
  } else {
    ctl = document.createElement('input'); ctl.type = 'range';
    ctl.min = d.min; ctl.max = d.max; ctl.step = d.step;
    ctl.setAttribute('aria-label', d.label);
    ctl.addEventListener('input', () => setParam(d.key, +ctl.value, false));
    ctl.addEventListener('change', () => setParam(d.key, +ctl.value, true));
  }
  row.append(ctl);
  rows[d.key] = { row, lock, val, ctl, d };
  return row;
}
function setParam(key, v, commit) {
  const d = PARAM_BY_KEY[key];
  S.params = sanitize(Object.assign({}, S.params, { [key]: roundTo(v, d.step) }));
  syncParamRows();
  clearTimeout(editTimer);
  editTimer = setTimeout(() => showSpec(S.form, S.seed, S.params, { push: commit, animate: false }), commit ? 0 : 70);
}
function fmt(d, v) {
  if (d.kind === 'int') return String(Math.round(v));
  if (d.kind === 'float') return (+v).toFixed(d.step >= 1 ? 0 : 2);
  return '';
}
function syncParamRows() {
  if (!S.params) return;
  const diff = diffParams(S.params, S.base || S.params), perGroup = {};
  for (const k in rows) {
    const { row, lock, val, ctl, d } = rows[k], v = S.params[k];
    row.classList.toggle('edited', k in diff);
    if (k in diff) perGroup[d.group] = (perGroup[d.group] || 0) + 1;
    lock.classList.toggle('on', S.locks.has(k));
    val.textContent = fmt(d, v);
    if (ctl.tagName === 'INPUT') { if (document.activeElement !== ctl) ctl.value = v; }
    else for (const b of ctl.children) b.classList.toggle('on', +b.dataset.v === +v);
  }
  for (const det of $('params').children) {
    const n = perGroup[det.dataset.group] || 0;
    det.querySelector('.ed').textContent = n ? n + ' edited' : '';
  }
}

// ── colour toggle ─────────────────────────────────────────────────────────────
// The desk pill (#colorTog) and the dock button (#dockColor) switch colour
// on and off. On is the colour wash style; off is the last black-and-white
// style used (pen or ink brush, pen at first).
let monoStyle = 'pen';
function colourOn() { return S.style === 'wash'; }
function toggleColour() {
  if (colourOn()) S.style = monoStyle;
  else { monoStyle = S.style; S.style = 'wash'; }
  syncUI(); writeHash();
}

// ── syncUI ──────────────────────────────────────────────────────────────────
function syncUI() {
  const cfg = plateCfg(), G = S.grid, grid = S.mode === 'grid';
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === S.mode);
  $('gridSec').hidden = !grid;
  $('treeSec').hidden = S.mode !== 'tree';
  // The dock button shows the next mode of the cycle.
  const nm = MODES[(MODES.indexOf(S.mode) + 1) % MODES.length];
  $('dockMode').textContent = MODE_ICON[nm];
  $('dockMode').setAttribute('aria-label', MODE_NAME[nm]);
  $('dockMode').classList.toggle('on', S.mode !== 'single');
  for (const b of $('forms').children) b.classList.toggle('on', b.dataset.f === S.form);
  for (const b of $('styleSeg').children) b.classList.toggle('on', b.dataset.s === S.style);
  for (const id of ['colorTog', 'dockColor']) $(id).setAttribute('aria-pressed', String(colourOn()));
  $('rows').value = G.rows; $('cols').value = G.cols; $('rowsV').textContent = G.rows; $('colsV').textContent = G.cols;
  for (const b of $('presets').children) b.classList.toggle('on', b.dataset.id === G.preset);
  for (const b of $('srcSeg').children) b.classList.toggle('on', b.dataset.f === G.src);
  $('spreadRow').style.display = G.src === 'family' ? '' : 'none';
  $('spread').value = G.spread; $('spreadV').textContent = Math.round(G.spread * 100) + '%';
  $('newBtn').textContent = S.mode === 'tree' ? 'New tree' : grid && G.src !== 'family' ? 'New plate' : 'New seed';
  if (document.activeElement !== $('seedInp')) $('seedInp').value = String(S.seed);
  $('dockName').textContent = S.spec ? S.spec.name : '…';
  $('seedLine').innerHTML = S.spec ? `<i>${esc(S.spec.name)}</i>, ${esc(formLabel(S.form).toLowerCase())} form. The name comes from the seed.` : '';
  $('backBtn').disabled = $('dockBack').disabled = S.hi <= 0;
  $('fwdBtn').disabled = $('dockFwd').disabled = S.hi >= S.hist.length - 1;
  $('resetBtn').disabled = !S.params || !Object.keys(diffParams(S.params, S.base || S.params)).length;
  $('mutAmtV').textContent = Math.round(S.mutAmt * 100) + '%';
  $('autoBtn').classList.toggle('on', S.anim.auto);
  $('tipBtn').classList.toggle('on', S.anim.tip);
  $('speedV').textContent = drawTime().toFixed(1) + ' s';
  $('penV').textContent = S.pen.toFixed(2) + ' mm';
  $('jitterV').textContent = S.jitter ? Math.round(S.jitter * 100) + '%' : 'off';
  for (const b of $('themes').children) b.classList.toggle('on', b.dataset.t === S.theme);
  $('inkInp').value = S.ink || THEMES[S.theme].ink;
  $('inkReset').disabled = !S.ink;
  $('pageSel').value = cfg.page;
  for (const b of $('orientSeg').children) { b.classList.toggle('on', b.dataset.o === cfg.orient); b.disabled = cfg.page === 'screen' || cfg.page === 'square'; }
  $('borderBtn').classList.toggle('on', cfg.border);
  $('titleBtn').classList.toggle('on', cfg.title);
  $('labelsBtn').classList.toggle('on', cfg.labels);
  $('scaleBtn').classList.toggle('on', cfg.scale);
  $('grainBtn').classList.toggle('on', S.grain);
  if (document.activeElement !== $('titleInp')) $('titleInp').value = S.title;
  syncParamRows();
  if (TM) TM.syncUI();
  syncPlay();
  syncExport();
  S.dirty = true;
}

// ── share link ──────────────────────────────────────────────────────────────
let hashTimer = 0;
function shareState() {
  const cfg = plateCfg();
  return {
    m: S.mode, f: S.form, s: S.seed, p: diffParams(S.params || {}, S.base || {}),
    st: S.style, t: S.theme, ink: S.ink ? S.ink.slice(1) : '', pen: S.pen, wob: S.jitter || '',
    pg: cfg.page, or: cfg.orient === 'portrait' ? 'p' : 'l',
    fl: [cfg.border ? 'b' : '', cfg.title ? 't' : '', cfg.labels ? 'l' : '', cfg.scale ? 's' : '', S.grain ? 'g' : ''].join('') || '-',
    ti: S.title,
    ...(S.mode === 'tree' ? TM.shareState() : {}),
    ...(S.mode === 'grid' ? { gs: S.grid.seed, r: S.grid.rows, c: S.grid.cols, src: S.grid.src, sp: S.grid.src === 'family' ? S.grid.spread : '', no: S.grid.no } : {}),
  };
}
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (S.saver) return;
    try { history.replaceState(null, '', '#' + encodeShare(shareState())); } catch (e) { /* sandboxed frame */ }
  }, 250);
}
function readHash() {
  const q = decodeShare(location.hash);
  if (MODES.includes(q.m)) S.mode = q.m;
  TM.readShare(q);
  if (q.st && STYLES[q.st]) S.style = q.st;
  if (q.t && THEMES[q.t]) S.theme = q.t;
  if (q.ink && /^[0-9a-f]{6}$/i.test(q.ink)) S.ink = '#' + q.ink;
  if (q.pen && Number.isFinite(+q.pen)) S.pen = clamp(+q.pen, 0.05, 1.2);
  if (q.wob && Number.isFinite(+q.wob)) S.jitter = clamp(+q.wob, 0, 1);
  const cfg = S.plates[S.mode];
  if (q.pg && PAGES[q.pg]) cfg.page = q.pg;
  if (q.or) cfg.orient = q.or === 'p' ? 'portrait' : 'landscape';
  if (q.fl) { cfg.border = q.fl.includes('b'); cfg.title = q.fl.includes('t'); cfg.labels = q.fl.includes('l'); cfg.scale = q.fl.includes('s'); S.grain = q.fl.includes('g'); }
  if (q.ti) S.title = q.ti.slice(0, 80);
  const G = S.grid, int = (v, a, b, d) => (v !== undefined && Number.isFinite(+v) ? clamp(Math.round(+v), a, b) : d);
  G.seed = int(q.gs, 1, 4294967295, G.seed); G.rows = int(q.r, 1, 6, G.rows); G.cols = int(q.c, 1, 8, G.cols); G.no = int(q.no, 1, 3999, G.no);
  if (q.src === 'random' || q.src === 'form' || q.src === 'family') G.src = q.src;
  if (q.sp && Number.isFinite(+q.sp)) G.spread = clamp(+q.sp, 0.02, 1);
  if (q.r || q.c) G.preset = (GRID_PRESETS.find(p => !p.page && p.rows === G.rows && p.cols === G.cols) || {}).id || '';
  const form = q.f && (FORMS[q.f] || q.f === 'random') ? q.f : null;
  const seed = q.s !== undefined && Number.isFinite(+q.s) ? (+q.s >>> 0) : null;
  return { form, seed, params: q.p || null, q };
}

// ── controls ────────────────────────────────────────────────────────────────
function bindUI() {
  for (const f of [...FORM_KEYS, 'random']) {
    const b = document.createElement('button');
    b.dataset.f = f; b.textContent = formLabel(f).replace(' species', '');
    b.title = f === 'random' ? 'A random species from this seed' : FORMS[f].label + ' (' + FORMS[f].latin + ')';
    b.addEventListener('click', () => {
      // A second click on the form on show draws a new seed of it.
      const seed = f === S.form ? rand32() : S.seed;
      showSpec(f, seed, applyLocks(formParams(f, seed), S.params, S.locks));
    });
    $('forms').append(b);
  }
  for (const k of STYLE_KEYS) {
    const b = document.createElement('button');
    b.dataset.s = k; b.textContent = STYLES[k].label;
    b.addEventListener('click', () => { S.style = k; if (k !== 'wash') monoStyle = k; syncUI(); writeHash(); });
    $('styleSeg').append(b);
  }
  $('colorTog').addEventListener('click', toggleColour);
  $('dockColor').addEventListener('click', toggleColour);
  const goSeed = () => { const v = parseInt($('seedInp').value, 10); if (Number.isFinite(v)) showSpec(S.form, v >>> 0, null); $('seedInp').blur(); };
  $('seedGo').addEventListener('click', goSeed);
  $('seedInp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goSeed(); } });
  $('newBtn').addEventListener('click', newSeed);
  $('randBtn').addEventListener('click', randomise);
  $('mutBtn').addEventListener('click', mutateSpec);
  $('mutAmt').addEventListener('input', e => { S.mutAmt = +e.target.value; syncUI(); });
  $('backBtn').addEventListener('click', () => goHist(-1));
  $('fwdBtn').addEventListener('click', () => goHist(1));
  $('resetBtn').addEventListener('click', () => showSpec(S.form, S.seed, null, { animate: false }));
  $('playBtn').addEventListener('click', () => { if (drawing()) stopDrawOn(); else startDrawOn(); });
  $('autoBtn').addEventListener('click', () => { S.anim.auto = !S.anim.auto; syncUI(); });
  $('tipBtn').addEventListener('click', () => { S.anim.tip = !S.anim.tip; syncUI(); });
  $('speed').addEventListener('input', e => { S.anim.speed = +e.target.value; syncUI(); });
  for (const k of THEME_KEYS) {
    const t = THEMES[k], b = document.createElement('button');
    b.dataset.t = k; b.style.setProperty('--p', t.paper); b.style.setProperty('--k', t.ink);
    b.innerHTML = `<i></i><span>${t.label}</span>`;
    b.addEventListener('click', () => { S.theme = k; S.ink = null; syncUI(); writeHash(); });
    $('themes').append(b);
  }
  $('inkInp').addEventListener('input', e => { S.ink = e.target.value; syncUI(); writeHash(); });
  $('inkReset').addEventListener('click', () => { S.ink = null; syncUI(); writeHash(); });
  $('pen').addEventListener('input', e => { S.pen = +e.target.value; syncUI(); writeHash(); });
  $('jitter').addEventListener('input', e => { S.jitter = +e.target.value; syncUI(); writeHash(); });
  const sel = $('pageSel');
  for (const [k, p] of Object.entries(PAGES)) { const o = document.createElement('option'); o.value = k; o.textContent = p.label; sel.append(o); }
  sel.addEventListener('change', () => {
    const cfg = plateCfg(); cfg.page = sel.value;
    if (cfg.page === 'phone') cfg.orient = 'portrait';
    resetView(); syncUI(); writeHash();
  });
  for (const b of $('orientSeg').children) b.addEventListener('click', () => { plateCfg().orient = b.dataset.o; resetView(); syncUI(); writeHash(); });
  const flag = (id, key) => $(id).addEventListener('click', () => { const cfg = plateCfg(); cfg[key] = !cfg[key]; syncUI(); writeHash(); });
  flag('borderBtn', 'border'); flag('titleBtn', 'title'); flag('labelsBtn', 'labels'); flag('scaleBtn', 'scale');
  $('grainBtn').addEventListener('click', () => { S.grain = !S.grain; syncUI(); writeHash(); });
  $('titleInp').addEventListener('input', e => { S.title = e.target.value.slice(0, 80); S.dirty = true; writeHash(); });
  $('unlockBtn').addEventListener('click', () => { S.locks.clear(); syncUI(); });
  $('openAllBtn').addEventListener('click', () => {
    const all = [...$('params').children], open = !all.every(d => d.open);
    all.forEach(d => { d.open = open; });
    $('openAllBtn').textContent = open ? 'Close all' : 'Open all';
  });
  for (const b of $('modeSeg').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('dockMode').addEventListener('click', () => setMode(MODES[(MODES.indexOf(S.mode) + 1) % MODES.length]));
  for (const p of GRID_PRESETS) {
    const b = document.createElement('button');
    b.dataset.id = p.id; b.textContent = p.label || p.rows + ' × ' + p.cols;
    b.addEventListener('click', () => {
      const G = S.grid, cfg = S.plates.grid;
      G.rows = p.rows; G.cols = p.cols; G.preset = p.id;
      if (p.page) { cfg.page = p.page; cfg.orient = p.orient; cfg.border = cfg.title = p.plate; cfg.labels = true; }
      else if (cfg.page === 'phone') cfg.page = 'screen';
      resetView(); buildGrid(); syncUI();
    });
    $('presets').append(b);
  }
  $('rows').addEventListener('input', e => { S.grid.rows = +e.target.value; S.grid.preset = ''; syncUI(); gridSoon(); });
  $('cols').addEventListener('input', e => { S.grid.cols = +e.target.value; S.grid.preset = ''; syncUI(); gridSoon(); });
  for (const b of $('srcSeg').children) b.addEventListener('click', () => { S.grid.src = b.dataset.f; buildGrid(); syncUI(); });
  $('spread').addEventListener('input', e => { S.grid.spread = +e.target.value; syncUI(); gridSoon(); });
  $('gridNew').addEventListener('click', newPlate);
  $('dockBack').addEventListener('click', () => goHist(-1));
  $('dockFwd').addEventListener('click', () => goHist(1));
  $('dockNew').addEventListener('click', newSeed);
  $('dockDraw').addEventListener('click', () => $('playBtn').click());
}
function bindKeys() {
  addEventListener('keydown', e => {
    if (S.saver || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (S.mode === 'tree' && k === ' ') { e.preventDefault(); TM.togglePlay(); }
    else if (k === 'n' || k === ' ') { e.preventDefault(); newSeed(); }
    else if (k === 't') setMode(S.mode === 'tree' ? 'single' : 'tree');
    else if (k === 'r') randomise();
    else if (k === 'm') mutateSpec();
    else if (k === 'd') $('playBtn').click();
    else if (k === '[') goHist(-1);
    else if (k === ']') goHist(1);
    else if (k === '0') resetView();
    else if (k === 'g') setMode(S.mode === 'grid' ? 'single' : 'grid');
    else if (k === 'c') toggleColour();
  });
}

// ── bindView ────────────────────────────────────────────────────────────────
let onTap = null, onHover = null;
function resetView() { S.view.z = 1; S.view.px = 0; S.view.py = 0; S.dirty = true; }
function zoomAt(f, cx, cy) {
  S.tr.follow = false;
  const v = S.view, z = clamp(v.z * f, 0.5, 40), k = z / v.z;
  const ox = S.clear.x + S.clear.w / 2, oy = S.clear.y + S.clear.h / 2;
  v.px = (cx - ox) - (cx - ox - v.px) * k;
  v.py = (cy - oy) - (cy - oy - v.py) * k;
  v.z = z; S.dirty = true;
}
function bindView() {
  const pts = new Map();
  let moved = 0, pinch = null;
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => {
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ }
    pts.set(e.pointerId, local(e)); moved = 0;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: S.view.z }; }
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) { if (onHover) onHover(...local(e)); return; }
    const p = local(e), q = pts.get(e.pointerId);
    if (pts.size === 1) {
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0) S.tr.follow = false;
      S.view.px += p[0] - q[0]; S.view.py += p[1] - q[1];
      moved += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
      S.dirty = true;
    } else if (pts.size === 2 && pinch) {
      pts.set(e.pointerId, p);
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(pinch.z * d / Math.max(1, pinch.d) / S.view.z, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      moved += 10;
      return;
    }
    pts.set(e.pointerId, p);
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) canvas.classList.remove('drag');
    if (e.type === 'pointerup' && moved < 6 && !pts.size && onTap) onTap(p[0], p[1]);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), x, y); }, { passive: false });
  canvas.addEventListener('dblclick', resetView);
  onTap = (x, y) => {
    if (S.mode === 'tree' && lastPlate) { const [mx, my] = plateAt(x, y); TM.tap(mx, my, lastPlate.L, lastPlate.view); return; }
    if (S.mode !== 'grid' || !lastPlate) return;
    const [mx, my] = plateAt(x, y), i = cellAt(lastPlate.L, mx, my);
    if (i >= 0) openCell(i);
  };
  onHover = (x, y) => {
    if (S.mode === 'tree' && lastPlate) { const [mx, my] = plateAt(x, y); TM.hover(mx, my, lastPlate.L); return; }
    if (S.mode !== 'grid' || !lastPlate) return;
    const [mx, my] = plateAt(x, y), i = cellAt(lastPlate.L, mx, my);
    if (i !== S.hiCell) { S.hiCell = i; canvas.classList.toggle('cell', i >= 0); S.dirty = true; }
  };
  canvas.addEventListener('pointerleave', () => { if (S.hiCell >= 0) { S.hiCell = -1; canvas.classList.remove('cell'); S.dirty = true; } });
}

// ── bindExport ──────────────────────────────────────────────────────────────
function exportOpts() {
  return { theme: THEMES[S.theme], ink: S.ink, style: S.style, pen: S.pen, jitter: S.jitter, grain: S.grain ? grain : null,
    scale: plateCfg().scale, title: S.mode === 'grid' ? (S.title || 'Fungi fictae') : S.mode === 'tree' ? TM.plateText().title : (S.spec ? S.spec.name : 'Mushroom') };
}
function exportName() { return S.mode === 'tree' ? 'mushrooms-tree-' + slug(S.spec ? S.spec.name : 'tree') + '-' + S.tr.seed : S.mode === 'grid' ? 'mushrooms-plate-' + S.grid.seed : 'mushroom-' + slug(S.spec ? S.spec.name : 'specimen') + '-' + S.seed; }
function exportSpecs() { return S.mode === 'tree' ? [] : S.mode === 'grid' ? S.gfish : [S.spec]; }
// A tree plate: the plate frame with no cells, then the tree on top.
function exportPlate() { const L = plateNow(); return S.mode === 'tree' ? Object.assign({}, L, { cells: [] }) : L; }
function treeExtra(o) {
  if (S.mode !== 'tree' || !S.tr.tree) return null;
  const L = plateNow();
  return { svg: TM.svgOf(L, o), draw: (x, view) => TM.draw(x, L, view, { tau: null, sel: S.tr.sel, dpr: view.s / (96 / 25.4) }) };
}
function syncExport() {
  const L = plateNow(), z = pngSize(L, +$('dpiSel').value);
  $('pngHint').textContent = `PNG ${z.w} × ${z.h} px` + (z.clamped ? `, lowered to ${z.dpi} dpi (the browser canvas limit)` : '') + `. Plate ${L.w.toFixed(0)} × ${L.h.toFixed(0)} mm.`;
}
function bindExport() {
  $('xSvg').addEventListener('click', () => { const o = exportOpts(); exportSVG(exportPlate(), exportSpecs(), o, exportName(), treeExtra(o)); });
  $('xPng').addEventListener('click', async () => {
    $('xPng').disabled = true;
    try { const o = exportOpts(); await exportPNG(exportPlate(), exportSpecs(), o, +$('dpiSel').value, exportName(), treeExtra(o)); } finally { $('xPng').disabled = false; }
  });
  $('xJson').addEventListener('click', () => (S.mode === 'tree' && S.tr.tree ? download(new Blob([TM.json()], { type: 'application/json' }), exportName() + '.json')
    : exportJSON(plateNow(), exportSpecs(), exportOpts(), exportName())));
  $('dpiSel').addEventListener('change', syncExport);
  $('xLink').addEventListener('click', async () => {
    const url = location.href.split('#')[0] + '#' + encodeShare(shareState());
    const ok = await copyLink(url);
    $('xLink').textContent = ok ? 'Copied' : 'Copy below';
    $('linkRow').hidden = ok; $('linkInp').value = url;
    if (!ok) $('linkInp').select();
    setTimeout(() => { $('xLink').textContent = 'Copy link'; }, 1600);
  });
}

// ── panel ───────────────────────────────────────────────────────────────────
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  layout();
}
function bindPanel() {
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  panel.addEventListener('transitionend', e => { if (e.target === panel) layout(); });
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip');
  let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

// ── BOOT ────────────────────────────────────────────────────────────────────
async function boot() {
  grain = makeGrain(11);
  TM = createTreeMode({ S, $, dirty: () => { S.dirty = true; }, writeHash, resetView, syncPlay, minPx, tipMM, natural,
    clearW: () => S.clear.w, openSpecimen, setSpecimen });
  buildParams(); bindUI(); bindKeys(); bindView(); bindPanel(); bindExport(); TM.bind(); bindMinimap();
  if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
  addEventListener('resize', layout);
  layout();
  const h = readHash();
  if (!h.q.gs) S.grid.seed = rand32();
  const form = h.form || 'fly', seed = h.seed || rand32();
  showSpec(form, seed, h.params, { animate: S.mode === 'single' && S.anim.auto });
  if (S.mode === 'grid') buildGrid();
  if (document.fonts) document.fonts.ready.then(() => { S.dirty = true; });
  typesetAll(document.querySelector('.about')).catch(() => { /* the TeX stays as text */ });
  requestAnimationFrame(frame);
  // The saver loads on its own, so a fault there never stops the page.
  import('./saver.js').then(m => m.installSaver({ S, getSpec, getGrain: () => grain,
    onEnter: () => { S.saver = true; panel.classList.remove('open'); },
    onExit: () => { S.saver = null; setOpen(!PHONE_Q.matches); S.dirty = true; } })).catch(err => console.error('saver', err));
  window.__mush = { S, TM, showSpec, newSeed, randomise, mutateSpec, setMode, buildGrid, openCell, draw, plateNow, layout, ready: true,
    toClient: (x, y) => { if (!lastPlate) return null; const r = canvas.getBoundingClientRect(), v = lastPlate.view; return [r.left + (v.ox + x * v.s) / S.dpr, r.top + (v.oy + y * v.s) / S.dpr]; } };
}
boot().catch(err => { $('caption').textContent = 'Mushroom Draw failed to start: ' + err.message; console.error(err); });
