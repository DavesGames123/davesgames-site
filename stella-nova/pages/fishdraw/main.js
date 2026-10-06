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
//  GREP MAP
//    grep -n 'function layout'      the canvas size and the clear area
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
//    grep -n 'function setOpen'     the panel, the phone sheet, the dock
//    grep -n 'BOOT'                 the boot order
// ============================================================================
import { makeEngine, PARAMS, GROUPS, PARAM_BY_KEY, sanitize, mutate, takeGroup, applyLocks, diffParams,
  encodeShare, decodeShare, randomName, roundTo } from './engine.js';
import { createPool } from './pool.js';
import { THEMES, THEME_KEYS, PAGES, MM_PER_PX, pageSize, layoutPlate } from './plate.js';
import { drawPlate, makeGrain } from './render.js';

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
  },
  anim: { auto: !REDUCED, tip: true, speed: 0.5, p: null, last: 0 },
  view: { z: 1, px: 0, py: 0 },
  dpr: 1, clear: { x: 0, y: 0, w: 1, h: 1 }, dirty: true,
  saver: null,
};

let E = null;            // the main-thread engine (names and params only)
let pool = null;
let grain = null;
let token = 0;           // the latest showFish request

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
}

// ── plateNow ────────────────────────────────────────────────────────────────
// The plate layout of the active mode, sized for the clear area.
function plateCfg() { return S.plates[S.mode]; }
function plateNow() {
  const cfg = plateCfg();
  const view = { w: S.clear.w * MM_PER_PX, h: S.clear.h * MM_PER_PX };
  const size = pageSize(cfg.page, cfg.orient, view);
  const names = S.mode === 'single' ? [S.name] : [];
  return layoutPlate({
    w: size.w, h: size.h, rows: 1, cols: 1, screen: cfg.page === 'screen',
    border: cfg.border, title: cfg.title, labels: cfg.labels,
    titleText: S.title || S.name || 'Pisces fictae', subText: S.mode === 'single' ? 'Seed ' + (E ? E.str_to_seed(S.name) : '') : '',
    footRight: 'davesgames.io', names, plateNo: 1, fig: S.mode === 'single',
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
  const prog = S.anim.p;
  drawPlate(ctx, {
    L, theme, ink: S.ink, pen: S.pen, jitter: S.jitter, view,
    fishes: [S.fish], progress: [prog], grain: S.grain ? grain : null,
    marker: S.anim.tip, hiCell: -1, paperOut: cfg.page !== 'screen', dpr: S.dpr,
  });
  placeCaption(L, view);
}
// The caption line under the plate: name, seed, lines.
function placeCaption(L, view) {
  const cap = $('caption');
  const f = S.fish;
  if (!f) { cap.textContent = ''; return; }
  const ed = Object.keys(diffParams(S.params, S.base)).length;
  cap.innerHTML = `<i>${esc(S.name)}</i> · seed <span class="n">${f.seed}</span> · <span class="n">${f.offs.length - 1}</span> lines` +
    (ed ? ` · ${ed} edited` : '');
  const bottom = Math.min((view.oy + L.h * view.s) / S.dpr, S.clear.y + S.clear.h) + 8;
  cap.style.left = (S.clear.x + S.clear.w / 2) + 'px';
  cap.style.top = bottom + 'px';
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  a.last = now;
  if (S.dirty) { S.dirty = false; draw(); }
}
function startDrawOn() {
  if (!S.fish) return;
  S.anim.p = 0; S.anim.last = 0; S.dirty = true; syncPlay();
}
function syncPlay() {
  $('playBtn').textContent = S.anim.p != null ? 'Finish' : 'Draw on';
  $('dockDraw').classList.toggle('on', S.anim.p != null);
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
  pool.draw(name, p, label, 0).then(f => {
    if (my !== token) return;
    S.fish = f;
    if (animate) startDrawOn(); else { S.anim.p = null; syncPlay(); }
    S.dirty = true; syncCaptionOnly();
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
  const cfg = plateCfg();
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
  if (q.m === 'single' || q.m === 'grid') S.mode = q.m;
  if (q.t && THEMES[q.t]) S.theme = q.t;
  if (q.ink && /^[0-9a-f]{6}$/i.test(q.ink)) S.ink = '#' + q.ink;
  if (q.pen && Number.isFinite(+q.pen)) S.pen = clamp(+q.pen, 0.05, 1.2);
  if (q.wob && Number.isFinite(+q.wob)) S.jitter = clamp(+q.wob, 0, 1);
  const cfg = S.plates[S.mode];
  if (q.pg && PAGES[q.pg]) cfg.page = q.pg;
  if (q.or) cfg.orient = q.or === 'p' ? 'portrait' : 'landscape';
  if (q.fl) { cfg.border = q.fl.includes('b'); cfg.title = q.fl.includes('t'); cfg.labels = q.fl.includes('l'); cfg.hershey = q.fl.includes('h'); S.grain = q.fl.includes('g'); }
  if (q.ti) S.title = q.ti.slice(0, 80);
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
  $('playBtn').addEventListener('click', () => { if (S.anim.p != null) { S.anim.p = null; syncPlay(); S.dirty = true; } else startDrawOn(); });
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

  $('dockBack').addEventListener('click', () => goHist(-1));
  $('dockFwd').addEventListener('click', () => goHist(1));
  $('dockNew').addEventListener('click', newFish);
  $('dockDraw').addEventListener('click', () => $('playBtn').click());
}
// The pen name is part of the drawing (reframe), so a change draws again.
function refetch() { if (S.name) showFish(S.name, S.params, { push: false, animate: false }); }

function bindKeys() {
  addEventListener('keydown', e => {
    if (S.saver || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'n' || k === ' ') { e.preventDefault(); newFish(); }
    else if (k === 'm') mutateFish();
    else if (k === 'd') $('playBtn').click();
    else if (k === '[') goHist(-1);
    else if (k === ']') goHist(1);
    else if (k === '0') resetView();
    else return;
  });
}

// ── bindView ────────────────────────────────────────────────────────────────
// One pointer drags, two pinch, the wheel zooms about the cursor, a double
// click resets. onTap(x, y) gets a tap that did not move (CSS px in desk).
let onTap = null;
function resetView() { S.view.z = 1; S.view.px = 0; S.view.py = 0; S.dirty = true; }
function zoomAt(f, cx, cy) {
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
    canvas.setPointerCapture(e.pointerId);
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
  grain = makeGrain(11);
  buildParams(); bindUI(); bindKeys(); bindView(); bindPanel();
  if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
  addEventListener('resize', layout);
  layout();
  const h = readHash();
  showFish(h.name || randomName(E, (Math.random() * 4294967295) >>> 0), h.params);
  if (document.fonts) document.fonts.ready.then(() => { S.dirty = true; });
  requestAnimationFrame(frame);
  window.__fish = { S, pool, E, showFish, newFish, mutateFish, draw, plateNow, layout, ready: true };
}
boot().catch(err => { $('caption').textContent = 'Fishdraw failed to start: ' + err.message; console.error(err); });
