// ============================================================================
//  CONTEXT FREE  ·  main.js — the page: gallery, editor, controls, view
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING). The pictures come from the
//  Context Free engine (cf.wasm) in workers; this file only asks for
//  renders and shows the pixels.
//
//  LANES (client.js): main (the view), thumbs (the gallery), svg (export).
//  A new render of the view cancels the one that runs (the worker is
//  terminated and a new one starts from the compiled module).
//
//  VIEW. The art is a raster of the engine. In "Fit the view" mode the
//  raster is the size of the clear area in device px, times the zoom: a
//  zoom renders again at the new size, so the art never shows upscaled
//  pixels once the render is in. Zoom stops where that size would pass
//  4096 px. A fixed size (600 .. 4096) is shown at no more than one
//  raster px per device px at zoom 1.
//
//  GREP MAP
//    grep -n 'function layout'       the canvas size and the clear area
//    grep -n 'function artBox'       where the art goes in the clear area
//    grep -n 'function draw'         one frame of the view
//    grep -n 'function render'       a render of the current source
//    grep -n 'function openDesign'   load a gallery design
//    grep -n 'function buildGallery' the thumbnails
//    grep -n 'function setTab'       the panel tabs
//    grep -n 'function bindView'     pan, zoom, pinch
//    grep -n 'function exportPNG'    PNG, SVG, .cfdg and the link
//    grep -n 'BOOT'                  the boot order
// ============================================================================
import { DESIGNS, SRC_LABEL, byId, loadSource } from './designs.js';
import { createLane, compiledModule } from './client.js';
import { createEditor } from './highlight.js';
import { varToString, varFromString, randomVariation, VAR_MAX3 } from './variation.js';
import { THEMES, themeOf, plan, defsFor, toMask, compose, loadLook, saveLook } from './look.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const MAX_SIDE = 4096;

const canvas = $('view'), ctx = canvas.getContext('2d'), panel = $('panel');

const S = {
  design: null, src: '', orig: '', edited: false, variation: 1,
  opts: { size: 'fit', max: 500000, minSize: 0.3, border: 2, aa: true, tile: 3, frames: 48, fps: 15, animate: true,
    grow: true, growMode: 'depth', growSecs: 10, drift: false },
  look: loadLook(),       // theme, bgStyle, bg, ink, colourBg (look.js)
  grow: null,             // the growth replay: { tok, w, h, t, playing, reqAt, inflight, doneAt }
  artCanvas: null,        // the composed picture (look.js compose)
  info: null, defsIgnored: false,
  art: null,              // { img, w, h, final }
  result: null,           // the last finished render: { image (ImageData), shapes, ms, w, h }
  frames: [], anim: false, playing: true, fi: 0, frameAt: 0, framesDone: false,
  view: { z: 1, px: 0, py: 0 },
  renderedZ: 1, renderedFor: '',
  busy: false, progress: null,
  dpr: 1, clear: { x: 0, y: 0, w: 1, h: 1 }, dirty: true,
  tab: 'Gallery', live: true,
  saver: null,
};

const lanes = { main: createLane('main'), thumbs: createLane('thumbs'), svg: createLane('svg') };
let editor = null;
let renderTok = 0, liveTimer = 0, zoomTimer = 0, artSeq = 0;

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
    else if (PHONE_Q.matches) { const top = panel.getBoundingClientRect().top; if (top - T > 140) B = Math.min(B, top); }
    else L = Math.max(L, panel.getBoundingClientRect().right);
  }
  S.clear = { x: L - desk.left, y: T - desk.top, w: Math.max(40, R - L), h: Math.max(40, B - T) };
  S.dirty = true;
}

// The art box in desk css px: the clear area less a margin and a caption
// line below.
function artBox() {
  const c = S.clear, m = Math.max(10, Math.min(c.w, c.h) * 0.035), cap = 30;
  return { x: c.x + m, y: c.y + m + 4, w: Math.max(20, c.w - 2 * m), h: Math.max(20, c.h - 2 * m - cap - 4) };
}

// The render size in px for the current view.
function targetSize(z = S.view.z) {
  const o = S.opts;
  if (S.anim || (S.info && (S.info.usesTime || S.info.usesFrameTime) && o.animate)) {
    const b = artBox(), k = Math.min(1, 720 / (Math.max(b.w, b.h) * S.dpr));
    return { w: Math.max(64, Math.round(b.w * S.dpr * k)), h: Math.max(64, Math.round(b.h * S.dpr * k)) };
  }
  if (o.size !== 'fit') { const n = +o.size; return { w: n, h: n }; }
  const b = artBox();
  let w = Math.round(b.w * S.dpr * z), h = Math.round(b.h * S.dpr * z);
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.max(32, Math.round(w * k)), h: Math.max(32, Math.round(h * k)) };
}
function maxZoom() {
  if (S.opts.size !== 'fit') return 8;
  const b = artBox();
  return Math.max(1, MAX_SIDE / (Math.max(b.w, b.h) * S.dpr));
}

// ── draw ────────────────────────────────────────────────────────────────────
function draw() {
  const W = canvas.width, H = canvas.height, d = S.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const b = artBox();
  let img = S.art && S.art.img, iw = S.art && S.art.w, ih = S.art && S.art.h;
  if (S.anim && S.frames.length) {
    const f = S.frames[S.fi % S.frames.length] || S.frames.find(Boolean);
    if (f) { img = f; iw = f.width; ih = f.height; }
  }
  const capEl = $('caption');
  if (!img) { capEl.style.display = 'none'; return; }
  // Contain in the box; fixed sizes stop at one raster px per device px.
  let k = Math.min(b.w / iw, b.h / ih);
  if (S.opts.size !== 'fit' && !S.anim) k = Math.min(k, 1 / d);
  // k fits any raster to the box (zoom 1), so a render made for zoom z
  // shows at one raster px per device px once the view is at zoom z.
  const z = S.view.z;
  const dw = iw * k * z, dh = ih * k * z;
  const cx = b.x + b.w / 2 + S.view.px, cy = b.y + b.h / 2 + S.view.py;
  const x0 = cx - dw / 2, y0 = cy - dh / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (S.info && S.info.usesAlpha) drawChecks(x0 * d, y0 * d, dw * d, dh * d);
  ctx.save();
  ctx.beginPath(); ctx.rect(S.clear.x * d, S.clear.y * d, S.clear.w * d, S.clear.h * d); ctx.clip();
  ctx.drawImage(img, x0 * d, y0 * d, dw * d, dh * d);
  ctx.restore();
  // The caption sits under the art, or at the base of the clear area.
  const capY = Math.min(y0 + dh + 8, S.clear.y + S.clear.h - 26);
  capEl.style.display = '';
  capEl.style.left = (b.x + b.w / 2) + 'px';
  capEl.style.top = Math.max(S.clear.y + 4, capY) + 'px';
}

// A dark checkerboard under a design with alpha.
function drawChecks(x, y, w, h) {
  const s = 10 * S.dpr;
  ctx.save();
  ctx.beginPath(); ctx.rect(Math.max(x, S.clear.x * S.dpr), Math.max(y, S.clear.y * S.dpr),
    Math.min(w, S.clear.w * S.dpr), Math.min(h, S.clear.h * S.dpr)); ctx.clip();
  ctx.fillStyle = '#1b1e24'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#24282f';
  for (let yy = 0; yy < h; yy += s) for (let xx = ((yy / s) & 1) * s; xx < w; xx += 2 * s) ctx.fillRect(x + xx, y + yy, s, s);
  ctx.restore();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (S.saver) return;
  pumpGrow(now);
  if (S.anim && S.playing && S.frames.length > 1) {
    const step = 1000 / S.opts.fps;
    if (now - S.frameAt >= step) {
      S.frameAt = now;
      const n = S.framesDone ? S.frames.length : S.frames.filter(Boolean).length;
      S.fi = (S.fi + 1) % Math.max(1, n);
      S.dirty = true;
    }
  }
  if (S.dirty) { S.dirty = false; draw(); }
}

// ── status ──────────────────────────────────────────────────────────────────
function setBusy(on) {
  S.busy = on;
  $('bar').hidden = !on;
  $('stopBtn').hidden = !on;
}
function setStatus(text, err = false) {
  const el = $('status');
  el.textContent = text || '';
  el.classList.toggle('err', !!err);
}
function setCaption(extra) {
  const d = S.design, v = varToString(S.variation);
  const t = (d ? d.title : 'Your design') + (S.edited ? ' (edited)' : '');
  $('caption').innerHTML = `<i>${esc(t)}</i> · <span class="v">${v}</span>` + (extra ? ` · <span class="n">${extra}</span>` : '');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showDiags(list, okText) {
  const ul = $('diags');
  ul.innerHTML = '';
  const shown = (list || []).filter(d => d.text);
  for (const d of shown.slice(0, 8)) {
    const li = document.createElement('li');
    if (!d.error) li.className = 'warn';
    li.innerHTML = (d.line > 0 ? `<b>line ${d.line}</b>` : '<b>engine</b>') + esc(d.text);
    if (d.line > 0) li.addEventListener('click', () => editor.goto(d.line));
    ul.append(li);
  }
  if (!shown.length && okText) { const li = document.createElement('li'); li.className = 'ok'; li.textContent = okText; ul.append(li); }
  editor.setDiags(shown.filter(d => !d.file || d.file === 'main.cfdg' || d.file === 'input'));
}

// ── render ──────────────────────────────────────────────────────────────────
// Ask the main lane for a render of S.src. A time design renders all its
// frames (Animate on); others render once with partial frames.
function render({ keepT = false } = {}) {
  clearTimeout(liveTimer);
  lanes.main.cancel();
  const tok = ++renderTok;
  const wantAnim = S.opts.animate && !!(S.info && (S.info.usesTime || S.info.usesFrameTime)) && S.infoFor === S.src;
  const growOn = S.opts.grow && !wantAnim;
  const prevT = keepT && S.grow ? S.grow.t : 0;
  if (!keepT) S.grow = null;
  const size = targetSize();
  const zAt = S.view.z;
  S.lastDefs = defsFor(S.look);
  const job = {
    src: S.src, variation: S.variation, defs: S.lastDefs,
    opts: {
      width: size.w, height: size.h, maxShapes: S.opts.max, minSize: S.opts.minSize, border: S.opts.border,
      antialias: S.opts.aa, tile: S.opts.tile, wide: true, partial: !wantAnim && !growOn, tickMs: 160,
      frames: wantAnim ? S.opts.frames : 0, grow: growOn,
    },
  };
  const t0 = performance.now();
  setBusy(true);
  $('bar').classList.remove('det');
  setStatus('Parsing…');
  if (wantAnim) { S.frames = []; S.framesDone = false; S.fi = 0; S.anim = true; }
  const mine = () => tok === renderTok;
  lanes.main.run(job, {
    onParsed(p) {
      if (!mine()) return;
      const was = S.info;
      S.info = p.info; S.infoFor = S.src; S.defsIgnored = !!p.defsIgnored;
      showDiags(p.diags, p.ok ? 'No errors.' : '');
      if (!p.ok) {
        const e = p.diags.find(x => x.error) || p.diags[0];
        setStatus(e ? (e.line > 0 ? `Line ${e.line}: ` : '') + e.text : 'The design did not parse.', true);
        return;
      }
      updateSections();
      // The first parse of a time design: start again as an animation.
      const timeNow = p.info.usesTime || p.info.usesFrameTime;
      if (S.opts.animate && timeNow && !wantAnim) { queueMicrotask(render); return; }
      if (!timeNow && S.anim) { S.anim = false; S.frames = []; }
      if (!was) layout();
      setStatus(wantAnim ? `Rendering ${S.opts.frames} frames…` : growOn ? 'Building…' : 'Rendering…');
    },
    onProgress(p) {
      if (!mine()) return;
      S.progress = p;
      if (wantAnim) return;
      const pct = p.inOutput && p.count ? ` · drawing ${Math.round(100 * p.done / p.count)}%` : (p.todo ? ` · ${fmt(p.todo)} to expand` : '');
      setStatus((growOn ? 'Building · ' : '') + `${fmt(p.shapes)} shapes${pct}`);
    },
    onFrame(img, index) {
      if (!mine()) return;
      const seq = ++artSeq;
      const p = curPlan();
      if (p.kind === 'mask') toMask(img.data, S.info);
      createImageBitmap(img).then(bmp => {
        if (!mine()) { bmp.close && bmp.close(); return; }
        if (wantAnim) {
          // Each animation frame gets its own composed canvas.
          S.frames[index] = compose(bmp, img.width, img.height, S.look, p, S.dpr);
          if (bmp.close) bmp.close();
          if (!S.playing) S.fi = index;
          setStatus(`Frame ${index + 1} of ${S.opts.frames}`);
          const bar = $('bar'); bar.classList.add('det'); bar.firstChild.style.width = (100 * (index + 1) / S.opts.frames) + '%';
        } else if (seq === artSeq && !(S.art && S.art.final && S.art.tok === tok)) {
          showBitmap(bmp, img.width, img.height, false, tok);
          S.renderedZ = zAt;
        } else if (bmp.close) bmp.close();
        S.dirty = true;
      });
    },
  }).then(res => {
    if (!mine()) return;
    setBusy(false);
    if (!res.ok) {
      if (!res.diags || !res.diags.length) setStatus(res.error || 'The render failed.', true);
      else { showDiags(res.diags); const e = res.diags.find(x => x.error) || res.diags[0]; setStatus((e.line > 0 ? `Line ${e.line}: ` : '') + e.text, true); }
      return;
    }
    if (res.diags && res.diags.length) showDiags(res.diags);
    const ms = performance.now() - t0;
    S.lastDone = `${S.design ? S.design.id : 'custom'}:${S.variation}`;
    S.result = { image: res.image || null, shapes: res.shapes, ms, w: res.width, h: res.height, info: res.info };
    if (res.info) S.info = res.info;
    updateSections();
    S.defsIgnored = !!res.defsIgnored;
    $('bgHint').hidden = !(S.lastDefs && res.defsIgnored && S.info && S.info.usesColor);
    const extra = `${fmt(res.shapes)} shapes · ${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s` + (res.stopped ? ' · stopped' : '');
    setCaption(extra);
    setStatus(res.stopped ? 'Stopped.' : '');
    if (wantAnim) { S.framesDone = true; S.dirty = true; return; }
    if (growOn && res.grow) {
      // The growth replay: frames come from pumpGrow(), drawn by the engine.
      S.grow = { tok, w: res.width, h: res.height, t: prevT, playing: prevT < 1, reqAt: -1, inflight: false, doneAt: 0, last: 0 };
      S.renderedZ = zAt;
      syncGrowUI();
      return;
    }
    if (res.image) showFinal(tok, zAt);
  }).catch(err => {
    if (err && err.cancelled) return;
    if (!mine()) return;
    setBusy(false);
    setStatus('Engine error: ' + (err && err.message || err), true);
  });
}

// ── look and growth ─────────────────────────────────────────────────────────
const curPlan = () => plan(S.look, S.info, S.defsIgnored);

// Show an engine bitmap (masked already when the plan is 'mask') through
// the look: one composed canvas, reused.
function showBitmap(bmp, w, h, final, tok) {
  S.artCanvas = compose(bmp, w, h, S.look, curPlan(), S.dpr, S.artCanvas);
  if (bmp.close) bmp.close();
  S.art = { img: S.artCanvas, w, h, final, tok };
  S.dirty = true;
}

// The final image of a normal render (S.result.image keeps the engine
// pixels; a mask is made from a copy).
function showFinal(tok, zAt = S.renderedZ) {
  const im = S.result && S.result.image;
  if (!im) return;
  const p = curPlan();
  const src = p.kind === 'mask' ? new ImageData(toMask(new Uint8ClampedArray(im.data), S.info), im.width, im.height) : im;
  createImageBitmap(src).then(bmp => {
    if (tok !== renderTok) { bmp.close && bmp.close(); return; }
    showBitmap(bmp, im.width, im.height, true, tok);
    S.renderedZ = zAt;
  });
}

// The look changed: draw again from what is there, or render again when
// the define (clear background) changes.
function applyLook() {
  saveLook(S.look);
  markThemes();
  if (defsFor(S.look) !== (S.lastDefs || '') || S.anim) { render({ keepT: true }); return; }
  if (S.grow) { S.grow.reqAt = -1; return; }
  showFinal(renderTok);
}

// One step of the growth replay, from the frame loop. The worker draws a
// frame with the engine (patch 0004) at the full render size; one frame is
// asked for at a time.
function pumpGrow(now) {
  const g = S.grow;
  if (!g) return;
  const dt = g.last ? Math.min(100, now - g.last) : 0;
  g.last = now;
  if (g.playing) {
    g.t = Math.min(1, g.t + dt / (S.opts.growSecs * 1000));
    if (g.t >= 1) { g.playing = false; g.doneAt = now; }
    syncGrowUI();
  } else if (S.opts.drift && g.t >= 1 && g.doneAt && now - g.doneAt > 2500 && !S.busy) {
    g.doneAt = 0;
    drift();
    return;
  }
  if (g.inflight || g.reqAt === g.t) return;
  g.inflight = true;
  const at = g.t, mask = curPlan().kind === 'mask';
  // Build order finishes the largest shapes first, so most of the picture
  // is there early: an ease (t squared) spreads it over the time.
  const key = S.opts.growMode === 'build' && at < 1 ? at * at : at;
  lanes.main.growFrame(S.opts.growMode, key, mask).then(f => {
    g.inflight = false;
    if (S.grow !== g || !f) { if (f && f.bitmap.close) f.bitmap.close(); if (!f && S.grow === g) S.grow = null; return; }
    g.reqAt = at;
    showBitmap(f.bitmap, f.w, f.h, at >= 1, g.tok);
  }, () => { g.inflight = false; });
}

// Variation drift: the next code, grown again.
function drift() {
  S.variation = (S.variation % VAR_MAX3) + 1;
  if (S.design) S.design._var = S.variation;
  updateDesignRow();
  writeHash();
  render();
}

function replayGrow() {
  if (!S.grow) { render(); return; }
  S.grow.t = 0; S.grow.playing = true; S.grow.reqAt = -1;
  syncGrowUI();
}
function toggleGrowPlay() {
  const g = S.grow; if (!g) return;
  if (g.t >= 1) { replayGrow(); return; }
  g.playing = !g.playing;
  syncGrowUI();
}
function syncGrowUI() {
  const g = S.grow;
  $('growbar').hidden = !g || !!S.saver;
  if (!g) return;
  const v = String(Math.round(g.t * 1000));
  for (const id of ['scrub', 'scrubP']) if ($(id).value !== v) $(id).value = v;
  const lab = g.playing ? '❚❚' : '▶';
  $('gPlay').textContent = lab;
  $('growPlayP').textContent = g.playing ? 'Pause' : g.t >= 1 ? 'Play again' : 'Play';
  $('growPct').textContent = Math.round(g.t * 100) + '%';
}

function buildThemes() {
  const host = $('themes');
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.dataset.id = t.id;
    const paper = t.paper || '#ffffff', ink = t.ink || '#000000';
    b.innerHTML = t.id === 'design' ? `<i class="rainbow"></i>${esc(t.name)}` : `<i style="--p:${paper};--k:${ink}${t.ink2 ? ';--k2:' + t.ink2 : ''}"></i>${esc(t.name)}`;
    b.addEventListener('click', () => { S.look.theme = t.id; applyLook(); });
    host.append(b);
  }
  markThemes();
}
function markThemes() {
  document.querySelectorAll('#themes button').forEach(b => b.classList.toggle('on', b.dataset.id === S.look.theme));
  document.querySelectorAll('#bgStyleSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === S.look.bgStyle));
  const t = themeOf(S.look.theme);
  $('bgPick').value = S.look.bg || t.paper || '#ffffff';
  $('inkPick').value = S.look.ink || t.ink || '#000000';
  $('bgClear').classList.toggle('on', !S.look.bg);
  $('inkClear').classList.toggle('on', !S.look.ink);
  $('colourBgBtn').classList.toggle('on', !!S.look.colourBg);
}

// Stop: keep what is on screen.
function stopRender() {
  if (!S.busy) return;
  renderTok++;
  lanes.main.cancel();
  setBusy(false);
  setStatus('Stopped.');
  if (S.anim) S.framesDone = true;
}

function scheduleLive() {
  clearTimeout(liveTimer);
  if (S.live) liveTimer = setTimeout(render, 650);
}

// The Tiles and Animation sections follow the parsed design.
function updateSections() {
  const i = S.info || {};
  const tiled = !!(i.tiled || i.frieze);
  $('tileSec').hidden = !tiled;
  const timed = !!(i.usesTime || i.usesFrameTime);
  $('animSec').hidden = !timed;
  $('growSec').classList.toggle('dim', timed && S.opts.animate);
  $('xSvg').disabled = S.anim;
  $('xHint').textContent = S.anim ? 'PNG saves the frame on screen. The engine writes SVG for still images only.'
    : tiled ? 'PNG has the tiles. SVG has one tile, as the command line writes it.' : '';
  $('fitBtn').hidden = S.view.z === 1 && !S.view.px && !S.view.py;
}

// ── designs ─────────────────────────────────────────────────────────────────
async function openDesign(d, variation = null, { keepView = false } = {}) {
  S.design = d;
  S.variation = variation || d._var || (d.var ? varFromString(d.var) : randomVariation());
  S.anim = false; S.frames = []; S.info = null; S.infoFor = ''; S.grow = null; syncGrowUI();
  if (!keepView) resetView();
  updateDesignRow();
  markThumb();
  writeHash();
  let src;
  try { src = await loadSource(d); } catch (e) { setStatus('Could not load ' + d.file + ': ' + e.message, true); return; }
  if (S.design !== d) return;
  S.src = S.orig = src; S.edited = false;
  editor.value = src;
  showDiags([]);
  setCaption('');
  render();
}

function updateDesignRow() {
  const d = S.design, v = varToString(S.variation);
  $('dTitle').textContent = d ? d.title : 'Your design';
  $('dSrc').textContent = S.edited ? 'edited' : d ? SRC_LABEL[d.src] : '';
  $('varInp').value = v;
  $('dockName').innerHTML = `${esc(d ? d.title : 'Your design')}<b>${v}</b>`;
}

function newVariation() {
  S.variation = randomVariation();
  if (S.design) S.design._var = S.variation;
  updateDesignRow();
  writeHash();
  render();
}

function stepDesign(k) {
  const i = DESIGNS.indexOf(S.design);
  openDesign(DESIGNS[(i + k + DESIGNS.length) % DESIGNS.length]);
}

function resetView() { S.view = { z: 1, px: 0, py: 0 }; S.renderedZ = 1; S.dirty = true; $('fitBtn').hidden = true; }

// ── hash ────────────────────────────────────────────────────────────────────
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  return { d: byId(q.get('d') || ''), v: varFromString(q.get('v') || '') };
}
function writeHash() {
  if (!S.design) return;
  const h = `#d=${S.design.id}&v=${varToString(S.variation)}`;
  try { history.replaceState(null, '', h); } catch (e) { /* sandboxed */ }
}

// ── gallery ─────────────────────────────────────────────────────────────────
function buildGallery() {
  const host = $('gallery');
  const px = Math.round(120 * Math.min(2, S.dpr));
  for (const d of DESIGNS) {
    d._var = d._var || (d.var ? varFromString(d.var) : randomVariation());
    const b = document.createElement('button');
    b.className = 'thumb wait';
    b.dataset.id = d.id;
    b.title = `${d.title}: ${d.note}`;
    b.innerHTML = `<canvas width="${px}" height="${px}"></canvas><span>${esc(d.title)}</span>` +
      (d.anim ? '<em>time</em>' : d.tiled ? '<em class="t">tile</em>' : '');
    b.addEventListener('click', () => {
      openDesign(d, d._var);
      if (PHONE_Q.matches && !LAND_Q.matches) panel.classList.remove('full');
    });
    host.append(b);
  }
}
function markThumb() {
  document.querySelectorAll('.thumb').forEach(t => t.classList.toggle('on', S.design && t.dataset.id === S.design.id));
}
// The thumbnails render one by one in their own lane.
async function fillGallery() {
  const px = Math.round(120 * Math.min(2, S.dpr));
  for (const d of DESIGNS) {
    const el = document.querySelector(`.thumb[data-id="${d.id}"]`);
    let src;
    try { src = await loadSource(d); } catch (e) { continue; }
    const job = { src, variation: d._var, opts: { width: px, height: px, maxShapes: d.max || 60000, tile: d.tiled ? 3 : 0,
      frames: d.anim ? 12 : 0, frame: d.anim ? 7 : 0, budgetMs: 2500, tickMs: 200, border: 1, wide: true } };
    try {
      const r = await lanes.thumbs.run(job);
      if (r.ok && r.image) paintThumb(el.querySelector('canvas'), r.image);
    } catch (e) { if (e && e.cancelled) return; }
    el.classList.remove('wait');
  }
}
function paintThumb(cv, img) {
  const c = cv.getContext('2d');
  c.fillStyle = '#15171c'; c.fillRect(0, 0, cv.width, cv.height);
  const k = Math.min(cv.width / img.width, cv.height / img.height);
  const w = img.width * k, h = img.height * k;
  createImageBitmap(img).then(bmp => { c.drawImage(bmp, (cv.width - w) / 2, (cv.height - h) / 2, w, h); bmp.close && bmp.close(); });
}

// ── panel and tabs ──────────────────────────────────────────────────────────
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  for (const n of ['Gallery', 'Code', 'Render', 'Look', 'About']) $('tab' + n).hidden = n !== t;
  $('dockCode').classList.toggle('on', t === 'Code' && panel.classList.contains('open'));
}
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open && S.tab !== 'Code');
  $('dockPanel').setAttribute('aria-expanded', String(open));
  $('dockCode').classList.toggle('on', open && S.tab === 'Code');
  layout();
}
function bindPanel() {
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  $('dockPanel').addEventListener('click', () => {
    const open = panel.classList.contains('open');
    if (open && S.tab === 'Code') { setTab('Gallery'); setOpen(true); } else setOpen(!open);
  });
  $('dockCode').addEventListener('click', () => {
    const open = panel.classList.contains('open');
    if (open && S.tab === 'Code') setOpen(false); else { setTab('Code'); setOpen(true); }
  });
  panel.addEventListener('transitionend', e => { if (e.target === panel) { layout(); maybeRefit(); } });
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

// When the clear area changes a lot (panel, rotation), a fit render
// is made again at the new size.
function maybeRefit() {
  if (S.saver || S.opts.size !== 'fit' || !S.src || S.anim) return;
  const t = targetSize();
  if (!S.art) return;
  const r = Math.max(t.w / S.art.w, t.h / S.art.h) / (S.view.z / S.renderedZ);
  const aspect = (t.w / t.h) / (S.art.w / S.art.h);
  if (r > 1.25 || r < 0.6 || aspect > 1.25 || aspect < 0.8) render({ keepT: true });
}

// ── controls ────────────────────────────────────────────────────────────────
function bindUI() {
  $('varNew').addEventListener('click', newVariation);
  $('dockVar').addEventListener('click', newVariation);
  const goVar = () => {
    const v = varFromString($('varInp').value);
    if (v > 0) { S.variation = v; if (S.design) S.design._var = v; updateDesignRow(); writeHash(); render(); }
    else $('varInp').value = varToString(S.variation);
  };
  $('varGo').addEventListener('click', goVar);
  $('varInp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goVar(); } });
  $('dockPrev').addEventListener('click', () => stepDesign(-1));
  $('dockNext').addEventListener('click', () => stepDesign(1));
  $('stopBtn').addEventListener('click', stopRender);
  $('fitBtn').addEventListener('click', () => { resetView(); render(); });

  $('runBtn').addEventListener('click', render);
  $('liveBtn').addEventListener('click', () => { S.live = !S.live; $('liveBtn').classList.toggle('on', S.live); });
  $('revertBtn').addEventListener('click', () => { S.src = S.orig; S.edited = false; editor.value = S.src; updateDesignRow(); render(); });
  $('saveCfdg').addEventListener('click', () => download(new Blob([S.src], { type: 'text/plain' }), `${slug()}.cfdg`));

  const sel = (id, key, num = false) => $(id).addEventListener('change', e => { S.opts[key] = num ? +e.target.value : e.target.value; if (key === 'size') resetView(); render(); });
  sel('sizeSel', 'size'); sel('maxSel', 'max', true); sel('borderSel', 'border', true);
  $('framesSel').addEventListener('change', e => { S.opts.frames = +e.target.value; if (S.anim) render(); });
  const minR = $('minSize');
  const showMin = () => { $('minV').textContent = (+minR.value).toFixed(1) + ' px'; };
  minR.addEventListener('input', showMin);
  minR.addEventListener('change', () => { S.opts.minSize = +minR.value; render(); });
  showMin();
  const fpsR = $('fps');
  const showFps = () => { S.opts.fps = +fpsR.value; $('fpsV').textContent = fpsR.value + ' fps'; };
  fpsR.addEventListener('input', showFps); showFps();
  $('aaBtn').addEventListener('click', () => { S.opts.aa = !S.opts.aa; $('aaBtn').classList.toggle('on', S.opts.aa); render(); });
  $('tileSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.opts.tile = +b.dataset.t;
    $('tileSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
  $('animBtn').addEventListener('click', () => {
    S.opts.animate = !S.opts.animate; $('animBtn').classList.toggle('on', S.opts.animate);
    if (!S.opts.animate) { S.anim = false; S.frames = []; }
    render();
  });
  $('playBtn').addEventListener('click', togglePlay);
  bindGrow(); bindLook();
  bindExport();
}
function bindGrow() {
  const on = () => { $('growBtn').classList.toggle('on', S.opts.grow); $('driftBtn').classList.toggle('on', S.opts.drift); };
  $('growBtn').addEventListener('click', () => { S.opts.grow = !S.opts.grow; on(); savePrefs(); render(); });
  $('driftBtn').addEventListener('click', () => { S.opts.drift = !S.opts.drift; on(); savePrefs(); if (S.opts.drift && S.grow && S.grow.t >= 1) S.grow.doneAt = performance.now(); });
  $('growModeSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.opts.growMode = b.dataset.m; savePrefs();
    $('growModeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    replayGrow();
  });
  $('growModeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.m === S.opts.growMode));
  const sp = $('growSecs');
  const showSp = () => { S.opts.growSecs = +sp.value; $('growSecsV').textContent = sp.value + ' s'; };
  sp.value = S.opts.growSecs; showSp();
  sp.addEventListener('input', showSp); sp.addEventListener('change', savePrefs);
  $('growReplay').addEventListener('click', replayGrow); $('gReplay').addEventListener('click', replayGrow);
  $('growPlayP').addEventListener('click', toggleGrowPlay); $('gPlay').addEventListener('click', toggleGrowPlay);
  for (const id of ['scrub', 'scrubP']) $(id).addEventListener('input', e => {
    const g = S.grow; if (!g) return;
    g.playing = false; g.t = +e.target.value / 1000; syncGrowUI();
  });
  on();
}
function bindLook() {
  buildThemes();
  $('bgStyleSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.look.bgStyle = b.dataset.s; applyLook(); });
  $('bgPick').addEventListener('input', e => { S.look.bg = e.target.value; applyLook(); });
  $('inkPick').addEventListener('input', e => { S.look.ink = e.target.value; applyLook(); });
  $('bgClear').addEventListener('click', () => { S.look.bg = ''; applyLook(); });
  $('inkClear').addEventListener('click', () => { S.look.ink = ''; applyLook(); });
  $('colourBgBtn').addEventListener('click', () => { S.look.colourBg = !S.look.colourBg; applyLook(); });
}

// Growth settings are remembered per viewer, as the look is.
const PREFS = 'cf-grow-v1';
function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
    for (const k of ['grow', 'drift', 'growMode', 'growSecs']) if (k in p) S.opts[k] = p[k]; } catch (e) { /* none */ }
}
function savePrefs() {
  try { localStorage.setItem(PREFS, JSON.stringify({ grow: S.opts.grow, drift: S.opts.drift, growMode: S.opts.growMode, growSecs: S.opts.growSecs })); } catch (e) { /* private mode */ }
}
function togglePlay() {
  S.playing = !S.playing;
  $('playBtn').textContent = S.playing ? 'Pause' : 'Play';
}

// ── export ──────────────────────────────────────────────────────────────────
const slug = () => `${S.design ? S.design.id : 'design'}${S.edited ? '-edited' : ''}-${varToString(S.variation)}`;
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportPNG() {
  let src = null, w = 0, h = 0;
  if (S.anim && S.frames.length) { src = S.frames[S.fi % S.frames.length] || S.frames.find(Boolean); w = src.width; h = src.height; }
  else if (S.art && S.art.img) { src = S.art.img; w = S.art.w; h = S.art.h; }
  if (!src) return;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (src instanceof ImageData) x.putImageData(src, 0, 0); else x.drawImage(src, 0, 0);
  c.toBlob(b => b && download(b, `${slug()}${S.anim ? '-f' + (S.fi + 1) : ''}.png`), 'image/png');
  $('xHint').textContent = `PNG ${w} × ${h} px.`;
}
function exportSVG() {
  const size = targetSize();
  $('xHint').textContent = 'The engine writes the SVG…';
  lanes.svg.cancel();
  lanes.svg.run({ src: S.src, variation: S.variation, svg: true,
    opts: { width: size.w, height: size.h, maxShapes: S.opts.max, minSize: S.opts.minSize, border: S.opts.border } })
    .then(r => {
      if (!r.ok || !r.svg) { $('xHint').textContent = 'The SVG failed.'; return; }
      download(new Blob([r.svg], { type: 'image/svg+xml' }), `${slug()}.svg`);
      $('xHint').textContent = `SVG ${(r.svg.length / 1e6).toFixed(r.svg.length < 1e6 ? 2 : 1)} MB, ${size.w} × ${size.h}.`;
    }).catch(e => { if (!(e && e.cancelled)) $('xHint').textContent = 'The SVG failed: ' + (e.message || e); });
}
function bindExport() {
  $('xPng').addEventListener('click', exportPNG);
  $('xSvg').addEventListener('click', exportSVG);
  $('xLink').addEventListener('click', () => {
    const u = new URL(location.href);
    u.hash = `d=${S.design ? S.design.id : ''}&v=${varToString(S.variation)}`;
    const done = () => { $('xHint').textContent = S.edited ? 'Link copied. It has the design and variation, not your edits: use Save .cfdg for those.' : 'Link copied.'; };
    if (navigator.clipboard) navigator.clipboard.writeText(u.href).then(done, () => { $('xHint').textContent = u.href; });
    else $('xHint').textContent = u.href;
  });
}

// ── view: pan, zoom, pinch ──────────────────────────────────────────────────
function bindView() {
  const pts = new Map();
  let last = null, pinch = null;
  const zoomAt = (f, cx, cy) => {
    const b = artBox(), zmax = maxZoom();
    const z0 = S.view.z, z1 = clamp(z0 * f, 1, zmax);
    if (z1 === z0) return;
    // Keep the point under the cursor still.
    const ox = b.x + b.w / 2 + S.view.px, oy = b.y + b.h / 2 + S.view.py;
    S.view.px += (cx - ox) * (1 - z1 / z0);
    S.view.py += (cy - oy) * (1 - z1 / z0);
    S.view.z = z1;
    if (z1 === 1) { S.view.px = 0; S.view.py = 0; }
    S.dirty = true;
    $('fitBtn').hidden = S.view.z === 1 && !S.view.px && !S.view.py;
    clearTimeout(zoomTimer);
    if (S.opts.size === 'fit' && !S.anim) zoomTimer = setTimeout(() => { if (Math.abs(S.view.z - S.renderedZ) > 0.05) render({ keepT: true }); }, 380);
  };
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e); zoomAt(Math.exp(-e.deltaY * 0.0016), x, y); }, { passive: false });
  canvas.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, local(e)); canvas.setPointerCapture(e.pointerId);
    if (pts.size === 1) { last = local(e); canvas.classList.add('drag'); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(d / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch.d = d; return;
    }
    if (pts.size === 1 && last && S.view.z > 1) {
      const p = local(e);
      S.view.px += p[0] - last[0]; S.view.py += p[1] - last[1]; last = p; S.dirty = true;
      $('fitBtn').hidden = false;
    }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { last = null; canvas.classList.remove('drag'); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', () => { const z = S.view.z; resetView(); if (z !== 1 && S.opts.size === 'fit' && !S.anim) render(); });
}

function bindKeys() {
  addEventListener('keydown', e => {
    if (S.saver) return;
    const t = e.target, typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT');
    if (e.key === 'Escape') { stopRender(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'v' || e.key === 'V') newVariation();
    else if (e.key === 'ArrowRight') stepDesign(1);
    else if (e.key === 'ArrowLeft') stepDesign(-1);
    else if (e.key === ' ' && S.anim) { e.preventDefault(); togglePlay(); }
    else if (e.key === ' ' && S.grow) { e.preventDefault(); toggleGrowPlay(); }
    else if (e.key === 'r' || e.key === 'R') replayGrow();
    else if (e.key === '0') { resetView(); render(); }
  });
}

// ── BOOT ────────────────────────────────────────────────────────────────────
async function boot() {
  compiledModule();
  editor = createEditor($('editor'), {
    onChange(v) { S.src = v; if (!S.edited) { S.edited = true; updateDesignRow(); } scheduleLive(); },
    onRun: render,
  });
  loadPrefs();
  buildGallery(); bindUI(); bindPanel(); bindView(); bindKeys();
  if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
  setTab('Gallery');
  addEventListener('resize', () => { layout(); clearTimeout(S.rz); S.rz = setTimeout(maybeRefit, 450); });
  layout();
  const h = readHash();
  // The page opens on Demo 1 (the user's choice), growing.
  const first = h.d || byId('demo1');
  openDesign(first, h.d && h.v > 0 ? h.v : null);
  requestAnimationFrame(frame);
  setTimeout(fillGallery, 600);
  installSaver({ S, lanes,
    onEnter: () => { S.saver = true; lanes.main.cancel(); lanes.thumbs.cancel(); renderTok++; panel.classList.remove('open'); },
    onExit: () => { S.saver = null; setOpen(!PHONE_Q.matches); S.dirty = true; render(); setTimeout(fillGallery, 400); },
    look: () => S.look });
  window.__cf = { S, render, openDesign, newVariation, layout, lanes, editor, designs: DESIGNS, applyLook, replayGrow, ready: true };
}
boot().catch(err => { setStatus('Context Free failed to start: ' + err.message, true); console.error(err); });
