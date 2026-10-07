// ============================================================================
//  FISHDRAW  ·  main.js — the page: controls, history, view and boot
// ----------------------------------------------------------------------------
//  Our own UI around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  The engine runs in workers (pool.js). This thread keeps one engine of its
//  own for names and generated params only (binomen, generate_params are
//  fast); it never calls fish() in the normal path.
//
//  STATE (S). name and params are the fish on show; base is the
//  generate_params() of the name, so the edits are diffParams(params, base).
//  hist holds { name, params } entries; hi is the place in it. Each mode
//  has its own plate settings (S.plates.single, S.plates.grid).
//
//  VIEW. The plate is in mm (plate.js). fitView() finds the CSS px per mm
//  that fits the plate in the clear part of the desk. The user zoom (z) and
//  pan (px, py) go on top. draw() strokes every fish as vectors through
//  that transform, so a zoom stays sharp.
//
//  SHARE LINK. The hash holds the fish name, the edited fields and the plate
//  settings (engine.js encodeShare). writeHash() runs after each change,
//  with history.replaceState, so the back button of the browser is not
//  filled with fish.
//
//  GRID. buildGrid() makes the spec { name, params } of each cell from the
//  grid seed: random names, or relatives of the specimen (same genus,
//  mutate() with the family spread). The pool draws the cells in order
//  (prio = cell index), so the plate fills cell by cell. A new grid cancels
//  the queued jobs of the old one (pool tag). A tap on a cell opens that
//  fish in single mode.
//
//  GREP MAP
//    grep -n 'function layout'      the canvas size and the clear area
//    grep -n 'function buildGrid'   the cell specs and the progressive fill
//    grep -n 'function setMode'     single, grid or tree
//  TREE. The tree of life mode is in treemode.js (TM). main.js gives it the
//  plate, the view and the taps; TM draws the tree in the plate content.
//    grep -n 'function plateNow'    the layout of the plate on screen
//    grep -n 'function fitView'     plate mm to device px
//    grep -n 'function draw'        one frame
//    grep -n 'function frame'       the loop: pen draw-on, redraw on demand
//    grep -n 'function showFish'    ask the pool for a fish, then show it
//    grep -n 'function newFish'     a random name, locked fields kept
//    grep -n 'function mutateFish'  small changes, locked fields kept
//    grep -n 'function buildParams' the parameter panel
//    grep -n 'function syncUI'      the controls from the state
//    grep -n 'function writeHash'   the share link
//    grep -n 'function readHash'    the boot state from the link
//    grep -n 'function bindView'    pan, zoom and pinch
//    grep -n 'function bindExport'  the export buttons (export.js)
//    grep -n 'function setOpen'     the panel, the phone sheet, the dock
//    grep -n 'BOOT'                 the boot order
//  The screensaver hook (window.snSaver) is in saver.js; it sets S.saver,
//  and frame() then leaves the canvas to it.
// ============================================================================
import { makeEngine, PARAMS, GROUPS, PARAM_BY_KEY, sanitize, mutate, takeGroup, applyLocks, diffParams,
  encodeShare, decodeShare, randomName, relativeName, mulberry, roundTo } from './engine.js';
import { createPool } from './pool.js';
import { THEMES, THEME_KEYS, PAGES, MM_PER_PX, GRID_PRESETS, pageSize, layoutPlate, cellAt } from './plate.js';
import { drawPlate, makeGrain } from './render.js';
import { installSaver } from './saver.js';
import { createTreeMode } from './treemode.js';
import { exportPlateSVG, exportPNG, exportUpstream, copyLink, pngSize, slug, download } from './export.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const HIST_MAX = 200;

const canvas = $('view'), ctx = canvas.getContext('2d'), panel = $('panel');

const S = {
  mode: 'single',
  name: '', params: null, base: null, fish: null, pending: 0,
  locks: new Set(),
  hist: [], hi: -1,
  mutAmt: 0.12,
  theme: 'cream', ink: null, pen: 0.3, jitter: 0, grain: true, title: '',
  plates: {
    single: { page: 'screen', orient: 'landscape', border: false, title: false, labels: false, hershey: true },
    grid: { page: 'screen', orient: 'landscape', border: true, title: true, labels: true, hershey: false },
    tree: { page: 'screen', orient: 'landscape', border: false, title: true, labels: false, hershey: false },
  },
  anim: { auto: !REDUCED, tip: true, speed: 0.5, p: null, last: 0 },
  view: { z: 1, px: 0, py: 0 },
  grid: { rows: 3, cols: 3, seed: 1, family: false, spread: 0.3, preset: '3x3', no: 1 },
  gspec: [], gfish: [], gprog: [], gtag: '', hiCell: -1,
  dpr: 1, clear: { x: 0, y: 0, w: 1, h: 1 }, dirty: true,
  saver: null,
};

let E = null;            // the main-thread engine (names and params only)
let pool = null;
let grain = null;
let token = 0;           // the latest showFish request
let gridSeq = 0;         // the latest grid (pool cancel tag)
let TM = null;           // the tree mode (treemode.js)

// ── layout ──────────────────────────────────────────────────────────────────
// The canvas covers the desk at device px. The clear area is the part of
// the desk that the panel, the phone sheet and the dock do not cover.
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
  if (LAND_Q.matches && !S.saver) {
    const d = $('dock').getBoundingClientRect();
    if (d.height) B = Math.min(B, d.top);
  }
  // Room for the caption line under the plate.
  const cap = S.saver ? 0 : 30;
  S.clear = { x: L - desk.left, y: T - desk.top, w: Math.max(40, R - L), h: Math.max(40, B - T - cap) };
  S.dirty = true;
  if (E && !S.saver) syncExport();
}

// ── plateNow ────────────────────────────────────────────────────────────────
// The plate layout of the active mode, sized for the clear area.
function plateCfg() { return S.plates[S.mode]; }
function plateNow() {
  const cfg = plateCfg();
  const view = { w: S.clear.w * MM_PER_PX, h: S.clear.h * MM_PER_PX };
  const size = pageSize(cfg.page, cfg.orient, view);
  const grid = S.mode === 'grid', G = S.grid;
  if (S.mode === 'tree') {
    const pt = TM.plateText();
    const mk = (w, h) => layoutPlate({ w, h, rows: 1, cols: 1, screen: cfg.page === 'screen', border: cfg.border, title: cfg.title, labels: false,
      titleText: S.title || pt.title, subText: pt.sub, footRight: 'davesgames.io', names: [], plateNo: 1 });
    if (!natural()) return mk(size.w, size.h);
    // The 'screen' page grows to the natural size of the tree, and to the
    // aspect of the view, so the fish keep their size and the view pans.
    const nat = TM.natSize(), asp = view.w / view.h;
    let W = nat.w * 1.08, H = nat.h * 1.08, L = null;
    for (let i = 0; i < 4; i++) {
      if (W / H < asp) W = H * asp; else H = W / asp;
      L = mk(W, H);
      const C = L.content;
      if (C.w >= nat.w - 1e-6 && C.h >= nat.h - 1e-6) break;
      W += Math.max(0, nat.w - C.w) + 1; H += Math.max(0, nat.h - C.h) + 1;
    }
    return L;
  }
  const names = grid ? S.gspec.map(c => c.name) : [S.name];
  const sub = grid
    ? (G.family ? 'The family of ' + (S.name.split(' ')[0] || 'Pisces') + ', ' + (G.rows * G.cols) + ' specimens' : (G.rows * G.cols) + ' specimens, plate seed ' + G.seed)
    : 'Seed ' + (E ? E.str_to_seed(S.name) : '');
  return layoutPlate({
    w: size.w, h: size.h, rows: grid ? G.rows : 1, cols: grid ? G.cols : 1, screen: cfg.page === 'screen',
    border: cfg.border, title: cfg.title, labels: cfg.labels,
    titleText: S.title || (grid ? 'Pisces fictae' : S.name) || 'Pisces fictae', subText: sub,
    footRight: 'davesgames.io', names, plateNo: grid ? G.no : 1, fig: !grid,
  });
}

// ── fitView ─────────────────────────────────────────────────────────────────
// { s, ox, oy }: device px per mm, and the device px of the plate origin.
function fitView(L) {
  const c = S.clear, screen = plateCfg().page === 'screen';
  const fit = Math.min(c.w / L.w, c.h / L.h) * (screen ? 1 : 0.92);
  const s = fit * S.view.z * S.dpr;
  const ox = (c.x + c.w / 2 + S.view.px) * S.dpr - L.w * s / 2;
  const oy = (c.y + c.h / 2 + S.view.py) * S.dpr - L.h * s / 2;
  return { s, ox, oy, fit };
}

// ── draw ────────────────────────────────────────────────────────────────────
function draw() {
  const L = plateNow(), view = fitView(L), cfg = plateCfg();
  const theme = THEMES[S.theme];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const grid = S.mode === 'grid';
  if (S.mode === 'tree') {
    drawPlate(ctx, { L: Object.assign({}, L, { cells: [] }), theme, ink: S.ink, pen: S.pen, jitter: S.jitter, view, fishes: [], progress: [],
      grain: S.grain ? grain : null, marker: false, hiCell: -1, paperOut: cfg.page !== 'screen', dpr: S.dpr });
    TM.draw(ctx, L, view);
    lastPlate = { L, view };
    placeCaption(L, view);
    drawMinimap(L, view);
    return;
  }
  $('minimap').classList.remove('on');
  drawPlate(ctx, {
    L, theme, ink: S.ink, pen: S.pen, jitter: S.jitter, view,
    fishes: grid ? S.gfish : [S.fish], progress: grid ? S.gprog : [S.anim.p], grain: S.grain ? grain : null,
    marker: S.anim.tip, hiCell: grid ? S.hiCell : -1, paperOut: cfg.page !== 'screen', dpr: S.dpr,
  });
  lastPlate = { L, view };
  placeCaption(L, view);
}
let lastPlate = null;
// The caption line under the plate: name, seed, lines (single), or the
// count of drawn cells (grid).
function placeCaption(L, view) {
  const cap = $('caption');
  const f = S.fish;
  if (S.mode === 'tree') {
    const t = S.tr.tree;
    cap.innerHTML = t ? `Tree of <i>${esc(t.nodes[0].name)}</i> · <span class="n">${S.tr.fish.size}/${t.nodes.length}</span> fish drawn · click a fish or branch` : '';
  } else if (S.mode === 'grid') {
    const n = S.gspec.length, done = S.gfish.filter(Boolean).length;
    const hi = S.hiCell >= 0 && S.gspec[S.hiCell];
    cap.innerHTML = hi ? `${S.hiCell + 1}. <i>${esc(hi.name)}</i> · click to open`
      : `${S.grid.family ? 'Family of <i>' + esc(S.name) + '</i>' : 'Random plate'} · <span class="n">${done}/${n}</span> drawn`;
  } else if (!f) { cap.textContent = ''; return; }
  else {
    const ed = Object.keys(diffParams(S.params, S.base)).length;
    cap.innerHTML = `<i>${esc(S.name)}</i> · seed <span class="n">${f.seed}</span> · <span class="n">${f.offs.length - 1}</span> lines` +
      (ed ? ` · ${ed} edited` : '');
  }
  const bottom = Math.min((view.oy + L.h * view.s) / S.dpr, S.clear.y + S.clear.h) + 8;
  cap.style.left = (S.clear.x + S.clear.w / 2) + 'px';
  cap.style.top = bottom + 'px';
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── tree sizing and camera ──────────────────────────────────────────────────
// The smallest on-screen length of a tip fish in the tree mode, CSS px.
const minPx = () => (PHONE_Q.matches ? 90 : 120);
// A tip fish in mm on the 'screen' page: 1.3 x the minimum at zoom 1.
const tipMM = () => minPx() * 1.3 * MM_PER_PX;
const natural = () => S.mode === 'tree' && plateCfg().page === 'screen';
// Eases the view toward TM.cameraTarget (follow while the tree grows, then
// an overview). Returns true when the view moved.
function followCamera(dt, L) {
  const fit = fitView(L).fit, c = TM.cameraTarget(L, fit);
  if (!c) return false;
  const v = S.view, e = 1 - Math.exp(-dt * 2.4);
  const tx = -(c.x - L.w / 2) * fit * c.z, ty = -(c.y - L.h / 2) * fit * c.z;
  const before = v.px + v.py + v.z;
  v.z += (c.z - v.z) * e; v.px += (tx * v.z / c.z - v.px) * e; v.py += (ty * v.z / c.z - v.py) * e;
  return Math.abs(v.px + v.py + v.z - before) > 0.01;
}
// The minimap: shown in the tree mode when the plate is larger than the
// clear area at the current zoom. A tap or a drag on it moves the view.
function drawMinimap(L, view) {
  const mm = $('minimap');
  const big = S.mode === 'tree' && !S.saver && (L.w * view.s / S.dpr > S.clear.w * 1.02 || L.h * view.s / S.dpr > S.clear.h * 1.02);
  mm.classList.toggle('on', big);
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
  for (const id of tree.tips) { const b = lay.fish[id]; if (b) x.fillRect(b.x * q, b.y * q, Math.max(2, b.w * q), Math.max(1.5, b.h * q)); }
  // The part of the plate on screen.
  const v0x = (S.clear.x * S.dpr - view.ox) / view.s, v0y = (S.clear.y * S.dpr - view.oy) / view.s;
  const vw = S.clear.w * S.dpr / view.s, vh = S.clear.h * S.dpr / view.s;
  x.globalAlpha = 1; x.strokeStyle = '#e3c48a'; x.lineWidth = 2 * S.dpr;
  x.strokeRect(v0x * q, v0y * q, vw * q, vh * q);
  mm.dataset.k = k;
}
function bindMinimap() {
  const mm = $('minimap');
  let down = false;
  const go = e => {
    if (!lastPlate) return;
    const r = mm.getBoundingClientRect(), k = +mm.dataset.k || 1;
    const mx = (e.clientX - r.left) / k, my = (e.clientY - r.top) / k;
    const L = lastPlate.L, fit = fitView(L).fit;
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
// Pen speed: the slider 0..1 maps to 400..40000 fish units per second.
function penRate() { return 400 * Math.pow(100, S.anim.speed); }
function frame(now) {
  requestAnimationFrame(frame);
  if (S.saver) return;
  const a = S.anim, f = S.fish;
  if (a.p != null && f) {
    const dt = Math.min(0.1, (now - (a.last || now)) / 1000);
    a.p += penRate() * dt;
    if (a.p >= f.total) { a.p = null; syncPlay(); }
    S.dirty = true;
  }
  if (S.mode === 'tree' && TM.tick(Math.min(0.1, (now - (a.last || now)) / 1000))) S.dirty = true;
  if (S.mode === 'tree' && lastPlate && followCamera(Math.min(0.1, (now - (a.last || now)) / 1000), lastPlate.L)) S.dirty = true;
  if (S.mode === 'grid') {
    const dt = Math.min(0.1, (now - (a.last || now)) / 1000);
    for (let i = 0; i < S.gprog.length; i++) {
      const g = S.gfish[i];
      if (S.gprog[i] == null || !g) continue;
      S.gprog[i] += penRate() * dt;
      if (S.gprog[i] >= g.total) { S.gprog[i] = null; if (!drawing()) syncPlay(); }
      S.dirty = true;
    }
  }
  a.last = now;
  if (S.dirty) { S.dirty = false; draw(); }
}
function startDrawOn() {
  if (S.mode === 'tree') { TM.togglePlay(); return; }
  if (S.mode === 'grid') { S.gprog = S.gfish.map(f => (f ? 0 : null)); S.dirty = true; syncPlay(); return; }
  if (!S.fish) return;
  S.anim.p = 0; S.anim.last = 0; S.dirty = true; syncPlay();
}
function drawing() { return S.mode === 'tree' ? S.tr.playing : S.mode === 'grid' ? S.gprog.some(p => p != null) : S.anim.p != null; }
function stopDrawOn() { if (S.mode === 'tree') { TM.togglePlay(); return; } S.anim.p = null; S.gprog = S.gprog.map(() => null); S.dirty = true; syncPlay(); }
function syncPlay() {
  $('playBtn').textContent = drawing() ? 'Finish' : 'Draw on';
  $('dockDraw').classList.toggle('on', drawing());
}

// ── showFish ────────────────────────────────────────────────────────────────
// Ask the pool for a fish and show it when it comes. push adds a history
// entry. params null means the generated params of the name.
function showFish(name, params, { push = true, animate = S.anim.auto } = {}) {
  name = String(name || '').trim() || randomName(E, (Math.random() * 4294967295) >>> 0);
  const my = ++token;
  S.name = name;
  S.base = baseOf(name);
  S.params = sanitize(Object.assign({}, S.base, params || {}));
  if (push) pushHist();
  syncUI();
  const label = plateCfg().hershey;
  const p = Object.keys(diffParams(S.params, S.base)).length ? S.params : null;
  S.pending++; busy();
  if (S.mode === 'tree') TM.onSpecimen();
  pool.draw(name, p, label, 0).then(f => {
    if (my !== token) return;
    S.fish = f;
    if (animate && S.mode !== 'tree') startDrawOn(); else { S.anim.p = null; syncPlay(); }
    S.dirty = true; syncCaptionOnly();
    if (S.mode === 'grid' && S.grid.family) buildGrid();
  }).catch(err => {
    if (my === token && !err.cancelled) note('This fish broke the engine: ' + err.message);
  }).finally(() => { S.pending--; busy(); });
  writeHash();
}
function baseOf(name) {
  const keep = E.getJsr();
  E.setJsr(E.str_to_seed(name)); E.resetNoise();
  const b = E.generate_params();
  E.setJsr(keep);
  return b;
}
function busy() { $('busy').hidden = S.pending <= 0; }
function note(t) { $('seedLine').textContent = t; }
function syncCaptionOnly() { S.dirty = true; }

function pushHist() {
  const e = { name: S.name, params: Object.assign({}, S.params) };
  S.hist = S.hist.slice(0, S.hi + 1);
  S.hist.push(e);
  if (S.hist.length > HIST_MAX) S.hist.shift();
  S.hi = S.hist.length - 1;
}
function goHist(d) {
  const i = S.hi + d;
  if (i < 0 || i >= S.hist.length) return;
  S.hi = i;
  const e = S.hist[i];
  showFish(e.name, e.params, { push: false });
}

// ── newFish / mutateFish ────────────────────────────────────────────────────
function newFish() {
  if (S.mode === 'grid' && !S.grid.family) { newPlate(); return; }
  const name = randomName(E, (Math.random() * 4294967295) >>> 0);
  const p = applyLocks(baseOf(name), S.params || {}, S.locks);
  showFish(name, p);
}
function mutateFish() {
  const rnd = Math.random;
  showFish(S.name, mutate(S.params, S.mutAmt, rnd, S.locks));
}
function rollGroup(group) {
  const fresh = baseOf(randomName(E, (Math.random() * 4294967295) >>> 0));
  showFish(S.name, takeGroup(S.params, fresh, group, S.locks));
}

// ── buildGrid ───────────────────────────────────────────────────────────────
// The cell specs come from the grid seed, so a seed and the settings give
// the same plate. A random cell keeps the locked fields of the specimen.
function gridSpecs() {
  const G = S.grid, n = G.rows * G.cols, rnd = mulberry(G.seed ^ 0x51ED);
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = (rnd() * 4294967295) >>> 0;
    if (G.family) {
      if (i === 0) { out.push({ name: S.name, params: Object.assign({}, S.params) }); continue; }
      out.push({ name: relativeName(E, S.name, u), params: mutate(S.params, G.spread, rnd, S.locks) });
    } else {
      const name = randomName(E, u);
      out.push({ name, params: S.locks.size ? applyLocks(baseOf(name), S.params, S.locks) : null });
    }
  }
  return out;
}
function buildGrid() {
  if (!E || !S.params) return;
  if (S.gtag) pool.cancel(S.gtag);
  const tag = S.gtag = 'grid' + (++gridSeq);
  S.gspec = gridSpecs();
  const label = S.plates.grid.hershey;
  S.gfish = S.gspec.map(c => pool.cached(c.name, c.params, label));
  S.gprog = S.gfish.map(() => null);
  S.dirty = true; syncPlay();
  S.gspec.forEach((c, i) => {
    if (S.gfish[i]) return;
    S.pending++; busy();
    pool.draw(c.name, c.params, label, 10 + i, tag).then(f => {
      if (S.gtag !== tag) return;
      S.gfish[i] = f;
      S.gprog[i] = S.anim.auto && S.mode === 'grid' ? 0 : null;
      S.dirty = true; syncPlay();
    }).catch(() => { /* cancelled or broken: the cell stays empty */ }).finally(() => { S.pending--; busy(); });
  });
  writeHash();
}
function newPlate() { S.grid.seed = (Math.random() * 4294967295) >>> 0 || 1; S.grid.no++; buildGrid(); syncUI(); }
let gridTimer = 0;
function gridSoon() { clearTimeout(gridTimer); gridTimer = setTimeout(buildGrid, 140); }
function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; S.hiCell = -1;
  resetView();
  if (m === 'grid') buildGrid();
  else if (m === 'tree') { S.anim.p = null; S.tr.follow = true; TM.onSpecimen(); }
  else { stopDrawOn(); refetch(); }
  $('treeCard').hidden = m !== 'tree' || S.tr.sel < 0;
  syncUI(); layout(); writeHash();
}
const MODES = ['single', 'grid', 'tree'];
const nextMode = () => MODES[(MODES.indexOf(S.mode) + 1) % MODES.length];
function openCell(i) {
  const c = S.gspec[i]; if (!c) return;
  S.mode = 'single'; S.hiCell = -1; resetView();
  showFish(c.name, c.params);
  syncUI(); layout();
}
// Plate mm of a desk point (CSS px), with the last drawn view.
function plateAt(x, y) {
  if (!lastPlate) return [-1, -1];
  const v = lastPlate.view;
  return [(x * S.dpr - v.ox) / v.s, (y * S.dpr - v.oy) / v.s];
}

// ── buildParams ─────────────────────────────────────────────────────────────
// One <details> per group, one row per field: lock, name, value, control.
const LOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const rows = {};
let editTimer = 0;
function buildParams() {
  const host = $('params');
  host.innerHTML = '';
  for (const g of GROUPS) {
    const det = document.createElement('details');
    det.dataset.group = g.id;
    if (g.id === 'body' || g.id === 'skin') det.open = true;
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
    const opts = d.kind === 'bool' ? ['Off', 'On'] : d.opts;
    opts.forEach((o, i) => {
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
// A field edit. commit true (a click or a slider release) adds a history
// entry; a slider drag redraws after a short pause.
function setParam(key, v, commit) {
  const d = PARAM_BY_KEY[key];
  S.params = sanitize(Object.assign({}, S.params, { [key]: roundTo(v, d.step) }));
  syncParamRows();
  clearTimeout(editTimer);
  editTimer = setTimeout(() => showFish(S.name, S.params, { push: commit, animate: false }), commit ? 0 : 90);
}
function fmt(d, v) {
  if (d.kind === 'int') return String(Math.round(v));
  if (d.kind === 'float') return (+v).toFixed(d.step >= 1 ? 0 : d.step >= 0.1 ? 1 : 2);
  return '';
}
function syncParamRows() {
  if (!S.params) return;
  const diff = diffParams(S.params, S.base || S.params);
  const perGroup = {};
  for (const k in rows) {
    const { row, lock, val, ctl, d } = rows[k];
    const v = S.params[k];
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

// ── syncUI ──────────────────────────────────────────────────────────────────
function syncUI() {
  const cfg = plateCfg(), G = S.grid, grid = S.mode === 'grid';
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === S.mode);
  $('gridSec').hidden = !grid;
  $('treeSec').hidden = S.mode !== 'tree';
  const nm = nextMode();
  $('dockMode').textContent = { single: '◧', grid: '▦', tree: '⟟' }[nm];
  $('dockMode').setAttribute('aria-label', { single: 'Single fish', grid: 'Grid', tree: 'Tree of life' }[nm]);
  $('dockMode').classList.toggle('on', S.mode !== 'single');
  if (TM) TM.syncUI();
  $('rows').value = G.rows; $('cols').value = G.cols; $('rowsV').textContent = G.rows; $('colsV').textContent = G.cols;
  for (const b of $('presets').children) b.classList.toggle('on', b.dataset.id === G.preset);
  for (const b of $('srcSeg').children) b.classList.toggle('on', +b.dataset.f === (G.family ? 1 : 0));
  $('spreadRow').style.display = G.family ? '' : 'none';
  $('spread').value = G.spread; $('spreadV').textContent = Math.round(G.spread * 100) + '%';
  $('newBtn').textContent = grid && !G.family ? 'New plate' : 'New fish';
  if (document.activeElement !== $('nameInp')) $('nameInp').value = S.name;
  $('dockName').textContent = S.name || '…';
  $('seedLine').innerHTML = S.name ? `Seed <code>${E.str_to_seed(S.name)}</code>, from <code>str_to_seed()</code> of the name.` : '';
  $('backBtn').disabled = $('dockBack').disabled = S.hi <= 0;
  $('fwdBtn').disabled = $('dockFwd').disabled = S.hi >= S.hist.length - 1;
  $('resetBtn').disabled = !S.params || !Object.keys(diffParams(S.params, S.base || S.params)).length;
  $('mutAmtV').textContent = Math.round(S.mutAmt * 100) + '%';
  $('autoBtn').classList.toggle('on', S.anim.auto);
  $('tipBtn').classList.toggle('on', S.anim.tip);
  $('speedV').textContent = Math.round(penRate()).toLocaleString('en-US') + ' u/s';
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
  $('hersheyBtn').classList.toggle('on', cfg.hershey);
  $('grainBtn').classList.toggle('on', S.grain);
  if (document.activeElement !== $('titleInp')) $('titleInp').value = S.title;
  syncParamRows();
  syncPlay();
  syncExport();
  S.dirty = true;
}

// ── share link ──────────────────────────────────────────────────────────────
let hashTimer = 0;
function shareState() {
  const cfg = plateCfg();
  return {
    m: S.mode, f: S.name, p: diffParams(S.params || {}, S.base || {}),
    t: S.theme, ink: S.ink ? S.ink.slice(1) : '', pen: S.pen, wob: S.jitter || '',
    pg: cfg.page, or: cfg.orient === 'portrait' ? 'p' : 'l',
    fl: [cfg.border ? 'b' : '', cfg.title ? 't' : '', cfg.labels ? 'l' : '', cfg.hershey ? 'h' : '', S.grain ? 'g' : ''].join('') || '-',
    ti: S.title,
    ...(S.mode === 'tree' ? TM.shareState() : {}),
    ...(S.mode === 'grid' ? { gs: S.grid.seed, r: S.grid.rows, c: S.grid.cols, fam: S.grid.family ? 1 : '', sp: S.grid.family ? S.grid.spread : '', no: S.grid.no } : {}),
  };
}
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (S.saver) return;
    try { history.replaceState(null, '', '#' + encodeShare(shareState())); } catch (e) { /* sandboxed frame */ }
  }, 250);
}
// Applies a decoded hash to S. Returns { name, params } of the fish.
function readHash() {
  const q = decodeShare(location.hash);
  if (q.m === 'single' || q.m === 'grid' || q.m === 'tree') S.mode = q.m;
  TM.readShare(q);
  if (q.t && THEMES[q.t]) S.theme = q.t;
  if (q.ink && /^[0-9a-f]{6}$/i.test(q.ink)) S.ink = '#' + q.ink;
  if (q.pen && Number.isFinite(+q.pen)) S.pen = clamp(+q.pen, 0.05, 1.2);
  if (q.wob && Number.isFinite(+q.wob)) S.jitter = clamp(+q.wob, 0, 1);
  const cfg = S.plates[S.mode];
  if (q.pg && PAGES[q.pg]) cfg.page = q.pg;
  if (q.or) cfg.orient = q.or === 'p' ? 'portrait' : 'landscape';
  if (q.fl) { cfg.border = q.fl.includes('b'); cfg.title = q.fl.includes('t'); cfg.labels = q.fl.includes('l'); cfg.hershey = q.fl.includes('h'); S.grain = q.fl.includes('g'); }
  if (q.ti) S.title = q.ti.slice(0, 80);
  const G = S.grid, int = (v, a, b, d) => (Number.isFinite(+v) && v !== undefined ? clamp(Math.round(+v), a, b) : d);
  G.seed = int(q.gs, 1, 4294967295, G.seed); G.rows = int(q.r, 1, 10, G.rows); G.cols = int(q.c, 1, 12, G.cols);
  G.no = int(q.no, 1, 3999, G.no);
  if (q.fam) G.family = q.fam === '1';
  if (q.sp && Number.isFinite(+q.sp)) G.spread = clamp(+q.sp, 0.02, 1);
  if (q.r || q.c) G.preset = (GRID_PRESETS.find(p => !p.page && p.rows === G.rows && p.cols === G.cols) || {}).id || '';
  return { name: q.f || '', params: q.p || null, q };
}

// ── controls ────────────────────────────────────────────────────────────────
function bindUI() {
  const goName = () => showFish($('nameInp').value.replace(/\s+/g, ' ').trim().slice(0, 60), null);
  $('nameGo').addEventListener('click', goName);
  $('nameInp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goName(); $('nameInp').blur(); } });
  $('newBtn').addEventListener('click', newFish);
  $('mutBtn').addEventListener('click', mutateFish);
  $('mutAmt').addEventListener('input', e => { S.mutAmt = +e.target.value; syncUI(); });
  $('backBtn').addEventListener('click', () => goHist(-1));
  $('fwdBtn').addEventListener('click', () => goHist(1));
  $('resetBtn').addEventListener('click', () => showFish(S.name, null, { animate: false }));
  $('playBtn').addEventListener('click', () => { if (drawing()) stopDrawOn(); else startDrawOn(); });
  $('autoBtn').addEventListener('click', () => { S.anim.auto = !S.anim.auto; syncUI(); });
  $('tipBtn').addEventListener('click', () => { S.anim.tip = !S.anim.tip; syncUI(); });
  $('speed').addEventListener('input', e => { S.anim.speed = +e.target.value; syncUI(); });

  const th = $('themes');
  for (const k of THEME_KEYS) {
    const t = THEMES[k], b = document.createElement('button');
    b.dataset.t = k; b.style.setProperty('--p', t.paper); b.style.setProperty('--k', t.ink);
    b.innerHTML = `<i></i><span>${t.label}</span>`;
    b.addEventListener('click', () => { S.theme = k; S.ink = null; syncUI(); writeHash(); });
    th.append(b);
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
  const flag = (id, key) => $(id).addEventListener('click', () => {
    const cfg = plateCfg(); cfg[key] = !cfg[key];
    if (key === 'hershey') refetch();
    syncUI(); writeHash();
  });
  flag('borderBtn', 'border'); flag('titleBtn', 'title'); flag('labelsBtn', 'labels'); flag('hersheyBtn', 'hershey');
  $('grainBtn').addEventListener('click', () => { S.grain = !S.grain; syncUI(); writeHash(); });
  $('titleInp').addEventListener('input', e => { S.title = e.target.value.slice(0, 80); S.dirty = true; writeHash(); });
  $('unlockBtn').addEventListener('click', () => { S.locks.clear(); syncUI(); });
  $('openAllBtn').addEventListener('click', () => {
    const all = [...$('params').children], open = !all.every(d => d.open);
    all.forEach(d => { d.open = open; });
    $('openAllBtn').textContent = open ? 'Close all' : 'Open all';
  });

  for (const b of $('modeSeg').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('dockMode').addEventListener('click', () => setMode(nextMode()));
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
  for (const b of $('srcSeg').children) b.addEventListener('click', () => { S.grid.family = b.dataset.f === '1'; buildGrid(); syncUI(); });
  $('spread').addEventListener('input', e => { S.grid.spread = +e.target.value; syncUI(); gridSoon(); });
  $('gridNew').addEventListener('click', newPlate);

  $('dockBack').addEventListener('click', () => goHist(-1));
  $('dockFwd').addEventListener('click', () => goHist(1));
  $('dockNew').addEventListener('click', () => (S.mode === 'tree' ? $('treeNew').click() : newFish()));
  $('dockDraw').addEventListener('click', () => $('playBtn').click());
}
// The pen name is part of the drawing (reframe), so a change draws again.
function refetch() {
  if (S.mode === 'grid') buildGrid();
  else if (S.name) showFish(S.name, S.params, { push: false, animate: false });
}

function bindKeys() {
  addEventListener('keydown', e => {
    if (S.saver || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (S.mode === 'tree' && k === ' ') { e.preventDefault(); TM.togglePlay(); }
    else if (S.mode === 'tree' && k === 'n') $('treeNew').click();
    else if (k === 't') setMode(S.mode === 'tree' ? 'single' : 'tree');
    else if (k === 'n' || k === ' ') { e.preventDefault(); newFish(); }
    else if (k === 'm') mutateFish();
    else if (k === 'd') $('playBtn').click();
    else if (k === '[') goHist(-1);
    else if (k === ']') goHist(1);
    else if (k === '0') resetView();
    else if (k === 'g') setMode(S.mode === 'grid' ? 'single' : 'grid');
    else return;
  });
}

// ── bindView ────────────────────────────────────────────────────────────────
// One pointer drags, two pinch, the wheel zooms about the cursor, a double
// click resets. onTap(x, y) gets a tap that did not move (CSS px in desk).
let onTap = null;
function resetView() { S.view.z = 1; S.view.px = 0; S.view.py = 0; S.dirty = true; }
function zoomAt(f, cx, cy) {
  if (S.tr) S.tr.follow = false;
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
      S.view.px += p[0] - q[0]; S.view.py += p[1] - q[1];
      moved += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
      if (moved > 6 && S.tr) S.tr.follow = false;
      S.dirty = true;
    } else if (pts.size === 2 && pinch) {
      pts.set(e.pointerId, p);
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
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
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = local(e);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), x, y);
  }, { passive: false });
  canvas.addEventListener('dblclick', resetView);
}
let onHover = null;
function bindCells() {
  onTap = (x, y) => {
    if (S.mode === 'tree' && lastPlate) { const [mx, my] = plateAt(x, y); TM.tap(mx, my, lastPlate.L, lastPlate.view); return; }
    if (S.mode !== 'grid' || !lastPlate) return;
    const [mx, my] = plateAt(x, y), i = cellAt(lastPlate.L, mx, my);
    if (i >= 0) openCell(i);
  };
  onHover = (x, y) => {
    if (S.mode === 'tree' && lastPlate) { const [mx, my] = plateAt(x, y); TM.hover(mx, my, lastPlate.L, lastPlate.view); return; }
    if (S.mode !== 'grid' || !lastPlate) return;
    const [mx, my] = plateAt(x, y), i = cellAt(lastPlate.L, mx, my);
    if (i !== S.hiCell) { S.hiCell = i; canvas.classList.toggle('cell', i >= 0); S.dirty = true; }
  };
  canvas.addEventListener('pointerleave', () => { if (S.hiCell >= 0) { S.hiCell = -1; canvas.classList.remove('cell'); S.dirty = true; } });
}

// ── bindExport ──────────────────────────────────────────────────────────────
// The files use the plate on show (lastPlate) at its own size in mm.
function exportOpts() { return { theme: THEMES[S.theme], ink: S.ink, pen: S.pen, jitter: S.jitter, grain: S.grain ? grain : null, title: S.mode === 'grid' ? (S.title || 'Pisces fictae') : S.mode === 'tree' ? TM.plateText().title : S.name }; }
function exportName() { return S.mode === 'grid' ? 'fishdraw-plate-' + S.grid.seed : S.mode === 'tree' ? 'fishdraw-tree-' + slug(S.name) + '-' + S.tr.seed : 'fishdraw-' + slug(S.name); }
function exportFishes() { return S.mode === 'grid' ? S.gfish : S.mode === 'tree' ? [] : [S.fish]; }
function syncExport() {
  const L = plateNow(), z = pngSize(L, +$('dpiSel').value);
  $('pngHint').textContent = `PNG ${z.w} × ${z.h} px` + (z.clamped ? `, lowered to ${z.dpi} dpi (the browser canvas limit)` : '') +
    `. Plate ${L.w.toFixed(0)} × ${L.h.toFixed(0)} mm.`;
  const grid = S.mode !== 'single';
  $('xUpSvg').disabled = $('xSmil').disabled = grid;
  $('xCsv').disabled = S.mode === 'tree';
}
function bindExport() {
  // A tree plate: the plate frame with no cells, then the tree on top.
  const treeExtra = (L, o) => (S.mode === 'tree' ? {
    svg: TM.svgOf(L, o),
    draw: (x, view) => TM.draw(x, L, view, { tau: null, sel: S.tr.sel, dpr: view.s / (96 / 25.4) }),
  } : null);
  $('xSvg').addEventListener('click', () => {
    const L = plateNow(), o = exportOpts();
    exportPlateSVG(S.mode === 'tree' ? Object.assign({}, L, { cells: [] }) : L, exportFishes(), o, exportName(), treeExtra(L, o));
  });
  $('xPng').addEventListener('click', async () => {
    $('xPng').disabled = true;
    const L = plateNow(), o = exportOpts();
    try { await exportPNG(S.mode === 'tree' ? Object.assign({}, L, { cells: [] }) : L, exportFishes(), o, +$('dpiSel').value, exportName(), treeExtra(L, o)); } finally { $('xPng').disabled = false; }
  });
  $('dpiSel').addEventListener('change', syncExport);
  const up = fmt => () => (S.mode === 'tree' && fmt === 'json' ? download(new Blob([TM.json()], { type: 'application/json' }), exportName() + '.json') : exportUpstream(fmt, E, S.mode === 'grid'
    ? { fish: null, L: plateNow(), fishes: S.gfish, jitter: S.jitter, name: exportName() }
    : { fish: S.fish, speed: 1 / penRate(), name: exportName() }));
  $('xUpSvg').addEventListener('click', up('svg'));
  $('xSmil').addEventListener('click', up('smil'));
  $('xJson').addEventListener('click', up('json'));
  $('xCsv').addEventListener('click', up('csv'));
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
  // The grip of the phone sheet: a tap switches half and full height, a
  // drag up gives full height, a drag down gives half height, then closes.
  const grip = $('sheetGrip'); let gy = null;
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
  const src = await (await fetch(new URL('./fishdraw.js', import.meta.url))).text();
  E = makeEngine(src);
  pool = createPool(4);
  TM = createTreeMode({ S, $, E: () => E, pool: () => pool, dirty: () => { S.dirty = true; }, busy: () => { S.dirty = true; },
    writeHash, resetView, syncPlay, minPx, tipMM, natural, clearW: () => S.clear.w, edited: () => Object.keys(diffParams(S.params, S.base)).length > 0,
    openFish: (name, params) => { setMode('single'); showFish(name, params); },
    setSpecimen: (name, params) => showFish(name, params) });
  grain = makeGrain(11);
  buildParams(); bindUI(); bindKeys(); bindView(); bindPanel(); bindCells(); bindExport(); TM.bind(); bindMinimap();
  if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
  addEventListener('resize', layout);
  layout();
  const h = readHash();
  if (!h.q.gs) S.grid.seed = (Math.random() * 4294967295) >>> 0 || 1;
  showFish(h.name || randomName(E, (Math.random() * 4294967295) >>> 0), h.params, { animate: S.mode === 'single' && S.anim.auto });
  if (S.mode === 'grid') buildGrid();
  if (document.fonts) document.fonts.ready.then(() => { S.dirty = true; });
  requestAnimationFrame(frame);
  installSaver({ S, pool, E, src, getGrain: () => grain,
    onEnter: () => { S.saver = true; panel.classList.remove('open'); },
    onExit: () => { S.saver = null; setOpen(!PHONE_Q.matches); S.dirty = true; } });
  window.__fish = { S, pool, E, showFish, newFish, mutateFish, draw, plateNow, layout, setMode, buildGrid, openCell, TM, ready: true,
    // Plate mm to client px (for tests that click a fish).
    // On-screen CSS px of the tip and ancestor fish of the tree, and the zoom.
    treeSizes: () => { if (!lastPlate || !S.tr.lay) return null; const k = lastPlate.view.s / S.dpr, l = S.tr.lay; return { tip: +(l.tip.w * k).toFixed(1), anc: l.anc ? +(l.anc.w * k).toFixed(1) : null, z: +S.view.z.toFixed(2), follow: S.tr.follow, natural: !!l.natural }; },
    toClient: (x, y) => { if (!lastPlate) return null; const r = canvas.getBoundingClientRect(), v = lastPlate.view; return [r.left + (v.ox + x * v.s) / S.dpr, r.top + (v.oy + y * v.s) / S.dpr]; } };
}
boot().catch(err => { $('caption').textContent = 'Fishdraw failed to start: ' + err.message; console.error(err); });
