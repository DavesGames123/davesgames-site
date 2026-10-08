// ============================================================================
//  LINE ART  ·  main.js — controls, camera, gallery, export, saver hook
// ----------------------------------------------------------------------------
//  The engine (Rust port of ln, crate/) runs in worker.js. This script asks
//  it for renders and gives the paths to the plotter view (plotter.js).
//
//  RENDER KINDS (function render)
//    plot     a new example, a replay: the render fills a hidden sheet;
//             when it is done, the pen draws the paths in depth order,
//             near paths first (plotter.js finish, geom.js orderPaths).
//    saver    the same hidden render; the saver then fits and plots it.
//    preview  while the camera or a slider moves: a coarse chop step, and
//             the shown lines change only when the preview is done (swap).
//             When a preview ends and the input moved again, the next one
//             starts at once, so a drag gives a stream of frames.
//    full     after the input stops (250 ms): the full step, also a swap.
//  A new request replaces the old one in the worker (it stops between two
//  slices), so the page never waits for a stale render.
//
//  CAMERA. Each example has its ln camera (worker camera_for). The page
//  adds an orbit { az, el }: drag to turn, or the slow orbit. Zoom and pan
//  are 2D on the vectors (plotter.js), they do not render again.
//
//  FRAMING. The engine image is the whole window, so lines go to the
//  window edges (under the panel, the HUD and the saver plate). The clear
//  area (S.frame) only aims the camera: the worker fits the example view
//  into it with a wider fovy and a lens shift (geom.js viewFit).
//
//  GREP MAP
//    grep -n 'function layout'         the clear area, the image size
//    grep -n 'function render('        ask the worker for paths
//    grep -n 'function onWorker'       chunks, done, svg, errors
//    grep -n 'function cameraFor'      orbit state -> worker message
//    grep -n 'function buildParams'    the sliders of one example
//    grep -n 'function selectExample'  load one example
//    grep -n 'function bindView'       orbit, pan, zoom, pinch, wheel
//    grep -n 'function thumbs'         the gallery renders (second worker)
//    grep -n 'function exportSVG'      the engine SVG (Paths to_svg)
//    grep -n 'function highlight'      the Rust code view
//    grep -n 'window.snSaver'          the screensaver hook
// ============================================================================
import { Plotter, drawThumb } from './plotter.js';
import { THEMES, themeByKey } from './themes.js';
import { viewDpr, glowMs } from './geom.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
// A touch screen gets the phone profile of geom.js: viewDpr and glowMs.
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : Math.round(n).toLocaleString('en-US');
const store = { get(k, d) { try { const v = localStorage.getItem('line-art:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('line-art:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };

const view = $('view'), panel = $('panel');
const plot = new Plotter(view);
plot.glowMs = glowMs(COARSE);

const S = {
  cat: [], byKey: new Map(), key: null, params: {}, orbit: { az: 0, el: 0 },
  spin: false, spinSpeed: 10, theme: themeByKey(store.get('theme', 'cream')),
  W: 800, H: 600, frame: { x: 0, y: 0, w: 800, h: 600 },
  id: 0, live: null, wantPreview: false, fullTimer: 0, lastFullMs: 0,
  stats: null, saver: null, ready: false, svgWait: new Map(),
};

// ── worker ─────────────────────────────────────────────────────────────────
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = e => onWorker(e.data);
worker.onerror = e => showMsg('The engine did not load: ' + (e.message || 'worker error'));

function onWorker(m) {
  if (m.type === 'ready') {
    S.cat = m.catalog; for (const e of S.cat) S.byKey.set(e.key, e);
    $('engineVersion').textContent = m.version;
    S.ready = true;
    boot();
    return;
  }
  if (m.type === 'fail') { showMsg('The WebAssembly engine did not start: ' + m.message); return; }
  if (m.type === 'svg') { const r = S.svgWait.get(m.id); if (r) { S.svgWait.delete(m.id); r.resolve(m.text); } return; }
  if (m.type === 'error') {
    const r = S.svgWait.get(m.id); if (r) { S.svgWait.delete(m.id); r.reject(new Error(m.message)); return; }
    if (S.live && m.id === S.live.id) { S.live = null; showMsg(m.message); }
    return;
  }
  const L = S.live;
  if (!L || m.id !== L.id) return;
  if (m.type === 'chunk') {
    plot.add(m.buf, m.depth);
    L.stats = m;
    setProgress(m.progress);
    if (L.kind === 'plot') updateHud(m, false);
  } else if (m.type === 'done') {
    plot.finish();
    S.live = null;
    setProgress(-1);
    L.stats = m;
    if (L.kind === 'saver' && S.saver) { plot.fitContent(0.9, 4); plot.alpha = 1; plot.replay(S.saver.plotTime); S.saver.t = 0; S.saver.plotting = true; }
    if (L.kind !== 'preview') { S.lastFullMs = m.ms; S.stats = m; S.camera = m.camera; updateHud(m, true); }
    else updateHud(m, false, true);
    if (L.kind === 'preview' && S.wantPreview) { S.wantPreview = false; render('preview'); }
    else if (S.spin && !S.saver) render(spinKind());
  }
}

// ── layout ─────────────────────────────────────────────────────────────────
// The clear part of the window: the panel covers the left (desktop), the
// base (phone portrait) or the right (phone landscape) while it is open;
// the gallery strip and the dock cover the base. The camera aims the
// example view there; the image itself is the whole window. In the saver
// the clear part is the full width and the band between the plate lines.
function layout() {
  const w = innerWidth, h = innerHeight, bar = document.querySelector('.topbar');
  const top = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().bottom : 0;
  let L = 0, R = w, T = top, B = h;
  const phone = PHONE_Q.matches;
  if (S.saver) {
    const band = S.saver.band;
    T = band ? band.t : 0; B = band ? h - band.b : h;
  } else if (phone) {
    const dock = $('dock').offsetHeight || 0;
    B = h - dock;
    if (panel.classList.contains('open')) {
      if (LAND_Q.matches) R = Math.min(R, w - panel.offsetWidth);
      else { const pt = B - panel.offsetHeight; if (pt - T > 150) B = pt; }
    }
  } else {
    if (panel.classList.contains('open')) L = panel.offsetWidth;
    const g = $('gallery');
    if (g.parentElement === document.body && !g.hidden) B = h - g.offsetHeight - 12;
    T = top + 36;  // the HUD line
  }
  document.documentElement.style.setProperty('--gal-h', (!phone && !S.saver ? $('gallery').offsetHeight + 12 : 0) + 'px');
  const m = phone ? 10 : 22, mx = S.saver ? 0 : m, my = S.saver ? 10 : m;
  const fr = { x: L + mx, y: T + my, w: Math.max(80, R - L - 2 * mx), h: Math.max(80, B - T - 2 * my) };
  const dpr = viewDpr(w, h, window.devicePixelRatio, COARSE);
  plot.resize(w, h, dpr);
  plot.setFrame(fr);
  const o = S.frame, moved = (a, b) => Math.abs(a - b) > 2;
  const changed = moved(fr.x, o.x) || moved(fr.y, o.y) || moved(fr.w, o.w) || moved(fr.h, o.h) || moved(w, S.W) || moved(h, S.H);
  S.frame = fr; S.W = w; S.H = h;
  return changed;
}
function placeGallery() {
  const g = $('gallery');
  if (PHONE_Q.matches) { if (g.parentElement !== $('gallerySlot')) $('gallerySlot').append(g); }
  else if (g.parentElement !== document.body) document.body.insertBefore(g, panel);
}
let resizeTimer = 0;
// Fit the image again; when the clear area changed shape, render again for
// the new aspect (a plot in progress starts again, a finished sheet swaps).
function relayout() {
  if (layout() && S.key && !S.saver) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(plot.plotting ? 'plot' : 'full'), 300);
  }
}
function onResize() { placeGallery(); relayout(); }

// ── renders ────────────────────────────────────────────────────────────────
function paramsOf(key) {
  const e = S.byKey.get(key);
  if (!S.params[key]) S.params[key] = e.params.map(p => p.value);
  return S.params[key];
}
function cameraFor() { return { az: S.orbit.az, el: S.orbit.el }; }
function spinKind() { return S.lastFullMs < 140 ? 'full' : 'preview'; }

function render(kind) {
  if (!S.ready || !S.key) return;
  if (kind === 'preview' && S.live && S.live.kind === 'preview') { S.wantPreview = true; return; }
  const e = S.byKey.get(S.key);
  const W = Math.round(S.W), H = Math.round(S.H);
  const id = ++S.id;
  // A coarse chop for previews: fewer rays, the same lines.
  const stepScale = kind === 'preview' ? (e.cost >= 3 ? 6 : 4) : 1;
  S.live = { id, kind, key: S.key };
  // 'plot' renders hidden, then the pen draws the sheet in depth order.
  // 'saver' renders hidden, then plots the whole sheet framed to the band.
  plot.begin(W, H, kind === 'plot' ? 'plot' : 'swap');
  if (kind === 'plot') plot.setStyle({ plotTime: S.saver ? S.saver.plotTime : plotTimeNow() });
  worker.postMessage({ type: 'render', id, key: S.key, params: paramsOf(S.key), orbit: cameraFor(), width: W, height: H, frame: { ...S.frame }, stepScale });
}
function plotTimeNow() { return REDUCED ? 0.01 : Math.max(0.01, +$('plotTime').value); }
function scheduleFull(delay = 260) {
  clearTimeout(S.fullTimer);
  S.fullTimer = setTimeout(() => { S.wantPreview = false; render('full'); }, delay);
}

function setProgress(p) {
  const el = $('progress');
  if (p < 0) { el.classList.remove('on'); return; }
  el.classList.add('on'); el.firstElementChild.style.width = (p * 100).toFixed(1) + '%';
}
function updateHud(m, final, preview) {
  const e = S.byKey.get(S.key);
  $('hudTitle').textContent = e ? e.title : '';
  const parts = [`${fmt(m.paths)} paths`, `${fmt(m.segments)} segments`, `${fmt(m.rays)} rays`, `${Math.round(m.ms)} ms`];
  $('hudStats').textContent = parts.join(' · ') + (preview ? ' · preview' : final ? '' : ' …');
  const c = S.camera;
  if (c && final) $('camLine').textContent = `eye (${c.slice(0, 3).map(v => v.toFixed(2)).join(', ')}) · fovy ${c[9].toFixed(1)}° · orbit ${(S.orbit.az * 180 / Math.PI).toFixed(0)}°, ${(S.orbit.el * 180 / Math.PI).toFixed(0)}°`;
}
function showMsg(t) { const el = $('msg'); el.textContent = t; el.hidden = !t; }

// ── examples ───────────────────────────────────────────────────────────────
function selectExample(key, opts = {}) {
  const e = S.byKey.get(key); if (!e) return;
  S.key = key;
  if (!opts.keepOrbit) S.orbit = { az: 0, el: 0 };
  plot.resetView();
  $('exTitle').textContent = e.title;
  $('exSource').textContent = e.source ? 'ln ' + e.source : 'original scene: crate/src/originals';
  $('exBlurb').textContent = e.blurb;
  $('dockName').textContent = e.title;
  $('codeName').textContent = `crate/src/examples/${e.key}.rs`;
  $('code').innerHTML = highlight(e.code);
  for (const c of document.querySelectorAll('.card')) c.classList.toggle('on', c.dataset.key === key);
  const card = document.querySelector(`.card[data-key="${key}"]`);
  if (card && !S.saver) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
  buildParams(e);
  store.set('example', key);
  render(opts.kind || 'plot');
}
function stepExample(d) {
  const i = S.cat.findIndex(e => e.key === S.key);
  selectExample(S.cat[(i + d + S.cat.length) % S.cat.length].key);
}

function buildParams(e) {
  const box = $('params'); box.textContent = '';
  const vals = paramsOf(e.key);
  e.params.forEach((p, i) => {
    if (p.options.length) {
      const seg = document.createElement('div'); seg.className = 'seg';
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = p.label; seg.append(nm);
      p.options.forEach((o, k) => {
        const b = document.createElement('button'); b.textContent = o; b.className = vals[i] === k ? 'on' : '';
        b.onclick = () => { vals[i] = k; for (const x of seg.querySelectorAll('button')) x.classList.toggle('on', x === b); render('full'); };
        seg.append(b);
      });
      box.append(seg);
      return;
    }
    const row = document.createElement('div'); row.className = 'prm';
    const dec = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : p.step >= 0.01 ? 2 : 3;
    row.innerHTML = `<div class="nm"></div><span class="val"></span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${vals[i]}">`;
    row.querySelector('.nm').textContent = p.label;
    const val = row.querySelector('.val'), inp = row.querySelector('input');
    inp.setAttribute('aria-label', p.label);
    val.textContent = (+vals[i]).toFixed(dec);
    inp.oninput = () => { vals[i] = +inp.value; val.textContent = (+inp.value).toFixed(dec); render('preview'); scheduleFull(e.cost >= 3 ? 450 : 260); };
    box.append(row);
  });
}

// ── gallery ────────────────────────────────────────────────────────────────
const thumbBufs = new Map();
function buildGallery() {
  const box = $('cards'); box.textContent = '';
  const dpr = Math.min(2, devicePixelRatio || 1);
  for (const e of S.cat) {
    const b = document.createElement('button'); b.className = 'card wait'; b.dataset.key = e.key;
    b.setAttribute('aria-label', e.title);
    const c = document.createElement('canvas'); c.width = Math.round(110 * dpr); c.height = Math.round(72 * dpr);
    const s = document.createElement('span'); s.textContent = e.title;
    b.append(c, s);
    b.onclick = () => { if (e.key !== S.key) selectExample(e.key); else replay(); if (PHONE_Q.matches) setOpen(false); };
    box.append(b);
  }
}
function drawThumbs() {
  for (const c of document.querySelectorAll('.card')) {
    const t = thumbBufs.get(c.dataset.key); if (!t || !t.done) continue;
    drawThumb(c.querySelector('canvas'), t.bufs, t.W, t.H, S.theme);
  }
}
// The thumbnails are real renders, one after another, in a second worker
// so they never delay the main render.
function thumbs() {
  const tw = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const queue = S.cat.map(e => e.key);
  // the light examples first
  queue.sort((a, b) => S.byKey.get(a).cost - S.byKey.get(b).cost);
  let cur = null, id = 0;
  const next = () => {
    if (!queue.length) { tw.terminate(); return; }
    const key = queue.shift(), e = S.byKey.get(key);
    cur = { key, id: ++id, bufs: [], W: 330, H: 216, done: false };
    thumbBufs.set(key, cur);
    tw.postMessage({ type: 'render', id: cur.id, key, params: e.params.map(p => p.value), orbit: { az: 0, el: 0 }, width: cur.W, height: cur.H, stepScale: e.cost >= 3 ? 3 : 2 });
  };
  tw.onmessage = ev => {
    const m = ev.data;
    if (m.type === 'ready') { next(); return; }
    if (!cur || m.id !== cur.id) return;
    if (m.type === 'chunk') cur.bufs.push(m.buf);
    else if (m.type === 'done' || m.type === 'error') {
      cur.done = true;
      const card = document.querySelector(`.card[data-key="${cur.key}"]`);
      if (card) { card.classList.remove('wait'); drawThumb(card.querySelector('canvas'), cur.bufs, cur.W, cur.H, S.theme); }
      setTimeout(next, 30);
    }
  };
}

// ── themes ─────────────────────────────────────────────────────────────────
function buildThemes() {
  const box = $('themes'); box.textContent = '';
  for (const t of THEMES) {
    const b = document.createElement('button'); b.dataset.key = t.key;
    b.innerHTML = `<i style="--p:${t.paper};--k:${t.ink};--g:${t.glow || 'transparent'}"></i><span></span>`;
    b.querySelector('span').textContent = t.name;
    b.onclick = () => setTheme(t.key);
    box.append(b);
  }
}
function setTheme(key) {
  S.theme = themeByKey(key);
  document.documentElement.dataset.ui = S.theme.dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--paper', S.theme.paper);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', S.theme.paper);
  for (const b of $('themes').children) b.classList.toggle('on', b.dataset.key === key);
  plot.setTheme(S.theme);
  drawThumbs();
  if (!S.saver) store.set('theme', key);
}

// ── pen controls ───────────────────────────────────────────────────────────
function bindPen() {
  const lw = $('lineW'), jt = $('jitter'), pt = $('plotTime');
  const upd = () => {
    $('lineWV').textContent = (+lw.value).toFixed(1) + ' px';
    $('jitterV').textContent = (+jt.value).toFixed(1);
    $('plotTimeV').textContent = +pt.value === 0 ? 'instant' : (+pt.value).toFixed(1) + ' s';
    plot.setStyle({ width: +lw.value, jitter: +jt.value });
  };
  lw.value = store.get('lineW', 1.2); jt.value = store.get('jitter', 0); pt.value = store.get('plotTime', 6);
  lw.oninput = () => { upd(); store.set('lineW', +lw.value); };
  jt.oninput = () => { upd(); store.set('jitter', +jt.value); };
  pt.oninput = () => { upd(); store.set('plotTime', +pt.value); };
  upd();
  const ph = $('penHeadBtn');
  ph.onclick = () => { const on = !ph.classList.contains('on'); ph.classList.toggle('on', on); ph.setAttribute('aria-pressed', on); ph.textContent = on ? 'Pen head shown' : 'Pen head hidden'; plot.setStyle({ penHead: on }); };
  const os = $('orbitSpeed');
  os.oninput = () => { S.spinSpeed = +os.value; $('orbitSpeedV').textContent = os.value + '°/s'; };
  os.oninput();
}

// ── camera and view input ─────────────────────────────────────────────────
function setSpin(on) {
  S.spin = on;
  for (const id of ['orbitBtn', 'dockOrbit', 'orbitBtn2']) { const b = $(id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  $('orbitBtn2').textContent = on ? 'Stop orbit' : 'Slow orbit';
  if (on) { plot.finishPlot(); if (!S.live) render(spinKind()); }
  else scheduleFull(60);
}
function replay() {
  if (S.live && S.live.kind !== 'plot') { render('plot'); return; }
  if (plot.sheet.done && plot.sheet.paths.length) plot.replay(plotTimeNow()); else render('plot');
}
function bindView() {
  const pts = new Map();
  let drag = null, lastTap = 0;
  view.addEventListener('pointerdown', ev => {
    if (S.saver) return;
    view.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 1) {
      const now = performance.now();
      if (ev.pointerType === 'touch' && now - lastTap < 300) { plot.resetView(); lastTap = 0; return; }
      lastTap = now;
      drag = { x: ev.clientX, y: ev.clientY, pan: ev.shiftKey || ev.button === 1 || ev.button === 2, moved: false };
      view.classList.add('drag');
    } else drag = null;
  });
  view.addEventListener('pointermove', ev => {
    if (!pts.has(ev.pointerId)) return;
    const prev = pts.get(ev.pointerId), cur = { x: ev.clientX, y: ev.clientY };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const other = a === prev ? b : a;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      const mx = (cur.x + other.x) / 2, my = (cur.y + other.y) / 2;
      if (d0 > 0) plot.zoomAt(mx, my, d1 / d0);
      plot.panBy((cur.x - prev.x) / 2, (cur.y - prev.y) / 2);
    } else if (drag) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (Math.abs(cur.x - drag.x) + Math.abs(cur.y - drag.y) > 3) drag.moved = true;
      if (drag.pan) plot.panBy(dx, dy);
      else {
        S.orbit.az -= dx * 0.008;
        S.orbit.el = clamp(S.orbit.el + dy * 0.006, -1.4, 1.4);
        plot.finishPlot();
        render('preview');
        scheduleFull();
      }
    }
    pts.set(ev.pointerId, cur);
  });
  const up = ev => { pts.delete(ev.pointerId); if (!pts.size) { drag = null; view.classList.remove('drag'); } };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  view.addEventListener('contextmenu', ev => ev.preventDefault());
  view.addEventListener('dblclick', () => plot.resetView());
  view.addEventListener('wheel', ev => {
    if (S.saver) return;
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
    plot.zoomAt(ev.clientX, ev.clientY, k);
  }, { passive: false });
}

// ── panel (desktop column, phone sheet, landscape drawer) ──────────────────
function setOpen(open) {
  panel.classList.toggle('open', open);
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').setAttribute('aria-expanded', open);
  $('dockPanel').classList.toggle('on', open);
  if (!open) panel.classList.remove('full');
  relayout();
  setTimeout(onResize, 320);
}
function bindPanel() {
  $('gear').onclick = () => setOpen(true);
  $('panelClose').onclick = () => setOpen(false);
  $('dockPanel').onclick = () => setOpen(!panel.classList.contains('open'));
  // The grip: drag up for a full sheet, down to close.
  const grip = $('sheetGrip');
  let y0 = null;
  grip.addEventListener('pointerdown', ev => { y0 = ev.clientY; grip.setPointerCapture(ev.pointerId); });
  grip.addEventListener('pointerup', ev => {
    if (y0 === null) return;
    const dy = ev.clientY - y0; y0 = null;
    if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
    else panel.classList.toggle('full');
    setTimeout(onResize, 320);
  });
}
function bindButtons() {
  for (const id of ['replayBtn', 'replayBtn2', 'dockReplay']) $(id).onclick = replay;
  for (const id of ['orbitBtn', 'orbitBtn2', 'dockOrbit']) $(id).onclick = () => setSpin(!S.spin);
  $('fitBtn').onclick = () => plot.resetView();
  $('dockPrev').onclick = () => stepExample(-1);
  $('dockNext').onclick = () => stepExample(1);
  $('resetParams').onclick = () => { const e = S.byKey.get(S.key); S.params[S.key] = e.params.map(p => p.value); buildParams(e); render('full'); };
  $('resetCam').onclick = () => { S.orbit = { az: 0, el: 0 }; plot.resetView(); render('full'); };
  $('svgBtn').onclick = exportSVG;
  $('pngBtn').onclick = exportPNG;
}
function bindKeys() {
  addEventListener('keydown', ev => {
    if (S.saver || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    if (ev.key === 'ArrowRight') stepExample(1);
    else if (ev.key === 'ArrowLeft') stepExample(-1);
    else if (ev.key === 'r' || ev.key === 'R') replay();
    else if (ev.key === 'o' || ev.key === 'O') setSpin(!S.spin);
    else if (ev.key === '0' || ev.key === 'f') plot.resetView();
    else return;
    ev.preventDefault();
  });
}

// ── export ─────────────────────────────────────────────────────────────────
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// The SVG comes from the engine: the same render, written by Paths to_svg
// (path.rs to_svg_styled) with the paper and ink of the theme.
function requestSVG() {
  const id = ++S.id + 1e6, W = Math.round(S.W), H = Math.round(S.H);
  return new Promise((resolve, reject) => {
    S.svgWait.set(id, { resolve, reject });
    worker.postMessage({ type: 'svg', id, key: S.key, params: paramsOf(S.key), orbit: cameraFor(), width: W, height: H, frame: { ...S.frame }, stepScale: 1, stroke: S.theme.ink, background: S.theme.paper, lineWidth: +$('lineW').value });
  });
}
function exportSVG() {
  const btn = $('svgBtn'); btn.textContent = 'SVG …';
  requestSVG().then(text => download(new Blob([text], { type: 'image/svg+xml' }), `line-art-${S.key}.svg`))
    .catch(err => showMsg('SVG export failed: ' + err.message))
    .finally(() => { btn.textContent = 'SVG'; });
}
function exportPNG() {
  const c = plot.exportPNG(2);
  c.toBlob(b => b && download(b, `line-art-${S.key}.png`), 'image/png');
}

// ── code view ──────────────────────────────────────────────────────────────
const KW = new Set(['let', 'mut', 'fn', 'for', 'in', 'if', 'else', 'match', 'return', 'use', 'pub', 'const', 'struct', 'impl', 'loop', 'while', 'break', 'continue', 'as', 'move', 'Some', 'None', 'true', 'false', 'Self', 'self']);
const TOKEN = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;
function highlight(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '', m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const [all, cm, st, nu, id] = m;
    if (cm) out += `<span class="cm">${esc(cm)}</span>`;
    else if (st) out += `<span class="st">${esc(st)}</span>`;
    else if (nu) out += `<span class="nu">${nu}</span>`;
    else if (id) {
      const call = src[TOKEN.lastIndex] === '(' || src[TOKEN.lastIndex] === '!';
      out += KW.has(id) ? `<span class="kw">${id}</span>` : /^[A-Z]/.test(id) ? `<span class="ty">${id}</span>` : call ? `<span class="fn">${id}</span>` : id;
    } else out += esc(all);
  }
  return out;
}

// ── frame loop ─────────────────────────────────────────────────────────────
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (S.spin && !S.saver) {
    S.orbit.az += S.spinSpeed * Math.PI / 180 * dt;
    if (!S.live) render(spinKind());
  }
  if (S.saver) saverStep(now, dt);
  plot.frame(now);
  requestAnimationFrame(frame);
}

// ── boot ───────────────────────────────────────────────────────────────────
function boot() {
  buildGallery();
  placeGallery();
  layout();
  const want = store.get('example', 'skyscrapers');
  if (!S.saver) selectExample(S.byKey.has(want) ? want : S.cat[0].key);
  thumbs();
}
buildThemes();
setTheme(S.theme.key);
bindPen(); bindView(); bindPanel(); bindButtons(); bindKeys();
if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
placeGallery();
layout();
addEventListener('resize', onResize);
PHONE_Q.addEventListener?.('change', onResize);
requestAnimationFrame(frame);
window.__lineArt = { S, plot, render, selectExample, layout, requestSVG };

// ── screensaver ────────────────────────────────────────────────────────────
// A seeded shuffle of the examples. Each shot: random parameters near the
// defaults, a random orbit, a plot of about half the shot, then a hold and
// a fade. The camera aims at the clear band of the shell plate (full
// width, band height); the lines go on under the plate to the window
// edges. The plate shows the title, the parameters and notes, no code.
function mulberry(seed) {
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Dark papers only: the shell plate is light text on a dark gradient.
const SAVER_THEMES = ['neon', 'blueprint', 'amber', 'chalk', 'violet'];
function saverShot() {
  const sv = S.saver, rnd = sv.rnd;
  if (sv.i >= sv.order.length) { sv.i = 0; }
  const key = sv.order[sv.i++];
  const e = S.byKey.get(key);
  // parameters: a seed is new each shot; numbers move up to a quarter of
  // their range from the default; choices are random.
  S.params[key] = e.params.map(p => {
    if (p.key === 'seed') return Math.floor(rnd() * (p.max + 1));
    if (p.options.length) return Math.floor(rnd() * p.options.length);
    const span = (p.max - p.min) * 0.25;
    let v = clamp(p.value + (rnd() * 2 - 1) * span, p.min, p.max);
    if (e.cost >= 3 && /beads|strings|size|grid/.test(p.key)) v = Math.min(v, p.value);   // keep the heavy ones in time
    return Math.round(v / p.step) * p.step;
  });
  S.orbit = { az: (rnd() * 2 - 1) * 0.9, el: (rnd() * 2 - 1) * 0.25 };
  const calm = sv.calm;
  sv.shot = 5 + calm * 5 + rnd() * 2;           // 5..12 s
  sv.plotTime = sv.shot * 0.55;
  sv.t = 0; sv.key = key; sv.plotting = false; sv.wait = 0;
  sv.theme = SAVER_THEMES[Math.floor(rnd() * SAVER_THEMES.length)];
  setTheme(sv.theme);
  plot.style.penHead = true;
  plot.alpha = 0; plot.dirty = true;   // the old sheet stays hidden until the new plot starts
  selectExample(key, { keepOrbit: true, kind: 'saver' });
  // the plate
  const shown = e.params.filter(p => p.key !== 'seed').slice(0, 4).map(p => {
    const v = S.params[key][e.params.indexOf(p)];
    return { name: p.label, value: p.options.length ? p.options[v] : (+v).toFixed(p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2) };
  });
  sv.label({
    title: 'Line art',
    sub: `${e.title}: ${e.source ? 'ln ' + e.source : 'an original scene'}, in Rust`,
    params: shown,
    lines: ['Hidden lines removed by casting a ray from every point to the eye.', 'The pen draws near lines first.', 'ln by Michael Fogleman (MIT), ported to Rust.'],
  });
}
function saverStep(now, dt) {
  const sv = S.saver;
  if (!sv.started) return;
  // The shot clock runs from the start of the plot. A render that takes
  // more than 8 s is cut.
  if (!sv.plotting) { sv.wait += dt; if (sv.wait > 8) saverShot(); return; }
  sv.t += dt;
  // band of the plate: check now and then (fonts settle late)
  if (sv.bandFn && now - sv.bandAt > 700) {
    sv.bandAt = now;
    const b = sv.bandFn(innerHeight);
    const key = b ? `${b.t | 0},${b.b | 0},${b.w | 0}` : '';
    if (key !== sv.bandKey) {
      sv.bandKey = key; sv.band = b;
      if (layout()) { if (sv.t < sv.plotTime * 0.5) { sv.plotting = false; sv.wait = 0; render('saver'); } else plot.fitContent(0.9, 4); }
    }
  }
  const fade = 0.8;
  if (sv.t > sv.shot - fade) plot.alpha = clamp((sv.shot - sv.t) / fade, 0, 1), plot.dirty = true;
  if (sv.t >= sv.shot) saverShot();
}
window.snSaver = {
  enter(o = {}) {
    const calm = clamp(o.calm ?? 0.7, 0, 1);
    const rnd = mulberry((o.seed >>> 0) || 1);
    const order = S.cat.length ? S.cat.map(e => e.key) : [];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const st = document.createElement('style'); st.id = 'saverStyle';
    st.textContent = '.topbar,#panel,#dock,#gear,#hud,#tools,#gallery,#progress,#msg{display:none!important}#view{cursor:none}';
    document.head.append(st);
    S.saver = { calm, rnd, order, i: 0, t: 0, shot: 8, plotTime: 4, label: typeof o.label === 'function' ? o.label : () => {},
      band: null, bandFn: null, bandAt: 0, bandKey: '', started: false, prevTheme: S.theme.key, prevSpin: S.spin };
    S.spin = false;
    import('../../lib/saver-clear.js').then(m => { if (S.saver) S.saver.bandFn = m.plateBand; }).catch(() => { /* no band: the full window */ });
    panel.classList.remove('open');
    const start = () => {
      if (!S.saver) return;
      if (!S.saver.order.length) S.saver.order = S.cat.map(e => e.key);
      layout(); S.saver.started = true; saverShot();
    };
    if (S.ready) start(); else { const t = setInterval(() => { if (S.ready) { clearInterval(t); start(); } }, 100); }
    return { canvas: view, warmupMs: 900 };
  },
  exit() {
    const st = $('saverStyle'); if (st) st.remove();
    const sv = S.saver; if (!sv) return;
    sv.label(null);
    S.saver = null; plot.alpha = 1; plot.dirty = true;
    setTheme(sv.prevTheme);
    setOpen(!PHONE_Q.matches);
    onResize();
  },
  debug() { const sv = S.saver; return sv ? { key: sv.key, t: +sv.t.toFixed(2), shot: +sv.shot.toFixed(2), plotTime: +sv.plotTime.toFixed(2), band: sv.band, frame: S.frame, paths: plot.sheet.paths.length, pen: plot.pen.i, theme: sv.theme } : null; },
};
