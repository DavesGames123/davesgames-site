// ============================================================================
//  NEBULA  ·  main.js — boot, render loop and the small control set
// ----------------------------------------------------------------------------
//  The renderer and the bake are the star map nebula engine (engine/, byte
//  copies of the star map artifact v26 modules; see engine/README.md). This
//  file replaces the artifact main.js. It keeps the boot order, the render
//  loop and the look pipeline, and drops the route map, the minimap, the
//  tunnels, the debug views and the look-dev panels.
//
//  BOOT
//    1. createGL on canvas#gl (engine/boot-compile.js started the compositor
//       compile already). No WebGL2 or a missing cap: #msg says what is missing.
//    2. Load the shipped Preview volume (data/volume-w.smv, about 10 MB gzip)
//       and draw it with no bake. Any failure (fetch, stale guard) runs the
//       live bake instead.
//    3. The render loop draws only when something changed, while the star
//       light curves animate, or while the at-rest mean converges.
//
//  LOOKS (look.js)
//    New nebula = a full shuffle (stage A: a live bake, a few seconds).
//    A palette  = stage P (the pre-light rerun) on a live bake. On the
//                 shipped volume the first palette change bakes live once,
//                 because the shipped set has no retain set.
//    applyLook runs one look at a time; requests between are dropped.
//
//  FRAMES IN FLIGHT
//    At most MAX_IN_FLIGHT canvas draws wait on the GPU (fenceSync). A slow
//    GPU then skips loop turns instead of piling up a queue that can stall
//    the desktop (site rule after dla-terrain, 2026-10-17).
//
//  window.__nebula: ready, look(), applyLook(kind), metrics, report (tests and the saver)
//
//  grep -n targets: "function boot", "function bake", "function tryPrebaked",
//    "function present", "function applyLookNow", "function loop", "function resize",
//    "function measureFrames", "function buildTray", "function setQuality",
//    "MAX_IN_FLIGHT", "function snapshot"
// ============================================================================
import comp from './engine/data/composition.js';
import { CONTENT_W, clampView } from './engine/params.js';
import { createGL, checkCaps, rendererInfo, gpuTimer, onContextLost, onContextRestored, programStart } from './engine/gl/context.js';
import { createRegistry } from './engine/gl/registry.js';
import { runBake, rerun, currentSession, disposeBake } from './engine/bake/pipeline.js';
import { createCompositor, compositorProgramName } from './engine/render/compositor.js';
import { compositorSource, specOn } from './engine/render/shaders/compositor.glsl.js';
import { labConsts } from './engine/render/lab-consts.js';
import { loadPrebaked, bakePrograms, SMV_URL } from './engine/bake/prebaked.js';
import { lookOf } from './engine/bake/prelight.js';
import { buildCatalogue } from './engine/render/catalogue.js';
import { stageOf } from './engine/look/shuffle.js';
import { createScroller } from './scroll.js';
import { createLook, PALETTE_INFO, PALETTE_ORDER, swatch } from './look.js';
import { installSaver } from './saver.js';

const $ = (id) => document.getElementById(id);
const viewer = $('viewer'), glCanvas = $('gl');
const busyEl = $('busy'), busyText = $('busyText'), busyBar = $('busyBar'), msgEl = $('msg');
const query = new URLSearchParams(location.search);
const STAGE_ORDER = ['hydroA', 'snap', 'hydroB', 'strands', 'strandBins', 'starRaysFull', 'ambient', 'jfa', 'preview',
  'exposureE0', 'prelight.strands', 'prelight', 'exposureTrim'];
// Render scale presets of the artifact dock (quality-per-ms search, star-map/perf/presets.json).
export const PRESETS = [['fast', 'Fast', 0.35], ['balanced', 'Balanced', 0.45], ['high', 'High', 0.625], ['ultra', 'Ultra', 1]];
const MAX_IN_FLIGHT = 2;

let reduceMotion = false;
try { reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduceMotion = false; }
const automated = !!navigator.webdriver;

function isPhone() {
  const dm = navigator.deviceMemory;
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch (e) { coarse = false; }
  return dm !== undefined ? dm <= 4 : coarse;
}

// ---- Page state ----
const ui = {
  tier: 'W', phone: isPhone(), busy: true, palette: 'nircam',
  strandS: comp.strands.S !== false, strandF: comp.strands.F !== false, seats: false,
  reduce: reduceMotion || automated, source: 'live',
  renderScale: 0.45, motionPreview: true, fine: true, labOff: ['knots'], preset: 'balanced',
};
{
  let pq = query.get('quality');
  if (!pq) { try { pq = localStorage.getItem('nebula.quality'); } catch (e) { pq = null; } }
  if (!pq) pq = ui.phone ? 'fast' : 'balanced';
  const p = PRESETS.find((r) => r[0] === pq);
  if (p) { ui.preset = p[0]; ui.renderScale = p[2]; }
}
const sites = [];   // the star map route nodes; this page has no map
const look = createLook(comp);
look.fromQuery(query);

let gl = null, caps = null, ctx = null, compositor = null, layers = null, timer = null;
let viewW = 1920, dirty = true, frozenTime = 12, animStart = 0;
let fullW = 0, fullH = 0, motionScale = 0.25, motionUntil = 0, onScreen = true, lastS = null, lastVW = null;
const MOTION_MS = 150, MOTION_MAX_SCALE = 0.6, SLOW_FRAME_MS = 100;
let motionTargetMs = 18;
let lastAnimDraw = 0, mode = 'none', frameInfo = null, renderer = null;
let liveComp = look.comp(), bakedComp = null;
const fences = [];

// ---- Input ----
const scroller = createScroller(viewer, {
  contentW: CONTENT_W,
  getViewW: () => clampView(viewW),
  onScroll: () => { dirty = true; },
  onInput: () => { hideHint(); },
});
scroller.attachTrack($('track'));
let hintTimer = setTimeout(hideHint, 9000);
function hideHint() { const h = $('hint'); if (h && !h.classList.contains('gone')) { h.classList.add('gone'); clearTimeout(hintTimer); } }

// ---- Layout ----
function resize() {
  const rect = viewer.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  viewW = 1080 * rect.width / rect.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // The canvas height is capped at 1440 device px (the artifact rule): it limits the GPU cost of a frame.
  const h = Math.max(270, Math.min(1440, Math.round(rect.height * dpr)));
  const w = Math.round(h * rect.width / rect.height);
  fullW = w; fullH = h;
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
  dirty = true;
}
new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; if (onScreen) dirty = true; }).observe(viewer);
new ResizeObserver(resize).observe(viewer);
addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (!document.hidden) dirty = true; });

function updateTrack() {
  const vw = clampView(viewW), s = scroller.get(), win = $('trackWin');
  win.style.left = (100 * s / CONTENT_W) + '%';
  win.style.width = (100 * Math.min(vw, viewW) / CONTENT_W) + '%';
  $('track').setAttribute('aria-valuenow', String(Math.round(100 * scroller.getT())));
}

// ---- Busy line ----
let busyWord = 'Loading the nebula', busyT0 = 0;
function setBusy(b, word) {
  ui.busy = b;
  if (word) busyWord = word;
  if (b) { busyT0 = performance.now(); busyText.textContent = busyWord; busyBar.style.width = '0'; }
  busyEl.hidden = !b;
  document.documentElement.classList.toggle('baking', b);
  window.__nebula.ready = !b && mode === 'gl';
}
function progress(p) {
  const i = STAGE_ORDER.indexOf(p.stage);
  busyText.textContent = `${busyWord} · ${(p.elapsedMs / 1000).toFixed(1)} s`;
  if (i >= 0) busyBar.style.width = (100 * (i + 1) / STAGE_ORDER.length) + '%';
}
function fail(text) {
  mode = 'none';
  msgEl.querySelector('p').textContent = text;
  msgEl.hidden = false;
  setBusy(false);
}

// ---- GL ----
const compositorOpts = () => ({ defines: [], labOff: ui.labOff, starPass: true });
const compositorName = () => compositorProgramName([], ui.labOff, specOn(location.search));
const compositorText = () => compositorSource([], specOn(location.search) ? labConsts(comp, location.search, ui.labOff) : null);

function initGL() {
  const r = createGL(glCanvas);
  gl = r.gl; caps = r.caps;
  if (!gl) return ['WebGL2'];
  renderer = rendererInfo(gl).renderer;
  timer = gpuTimer(gl, caps);
  return checkCaps(caps, ui.tier);
}

let bakeStarted = false;
function precompileBake() {
  if (bakeStarted || !gl || gl.isContextLost()) return;
  bakeStarted = true;
  for (const [name, fs] of bakePrograms()) programStart(gl, name, null, fs);
}

function freshRegistry() {
  if (compositor) { try { compositor.dispose(); } catch (e) { console.error(e); } compositor = null; }
  if (currentSession()) disposeBake();
  const reg = ctx && ctx.registry && ctx.gl === gl ? ctx.registry : createRegistry(gl, caps);
  return reg;
}

async function bake() {
  if (!gl) return;
  setBusy(true);
  const reg = freshRegistry();
  ctx = { gl, caps, registry: reg, tier: ui.tier, timer: null };
  for (const n of ['Vol', 'SkinD', 'SkinA', 'StrandSeg', 'StrandBin', 'Fine']) if (ctx.registry.get(n)) ctx.registry.release(n);
  try {
    bakedComp = liveComp;
    layers = await runBake(ctx, liveComp, sites, {
      tier: ui.tier, palette: ui.palette, channelMask: 'all',
      strands: { S: ui.strandS, F: ui.strandF }, seats: false,
    }, progress);
  } catch (e) {
    console.warn('[nebula] bake failed:', e);
    fail('The bake stopped (' + (e && e.message ? e.message : e) + '). Reload the page to try again.');
    return;
  }
  ui.source = 'live';
  present();
  setBusy(false);
}

function present() {
  compositor = createCompositor(ctx, layers, layers.catalogue, compositorOpts());
  compositor.setExposure(layers.exposureTrimEv, offsetEv());
  compositor.setDebug('composite', [480, 560]);
  window.__nebula.report = layers.report;
  mode = 'gl';
  glCanvas.hidden = false;
  dirty = true;
  draw();
}

async function tryPrebaked() {
  setBusy(true, 'Loading the nebula');
  const reg = freshRegistry();
  reg.releaseAll();
  ctx = { gl, caps, registry: reg, tier: 'W', timer: null };
  let r;
  try {
    r = await loadPrebaked(ctx, comp, sites, { url: SMV_URL, palette: 'nircam', lookOf, buildCatalogue });
  } catch (e) { r = { fail: 'loader error (' + (e && e.message ? e.message : e) + ')' }; }
  if (!r || r.fail) {
    window.__nebula.prebakedFail = r ? r.fail : 'no result';
    precompileBake();
    busyWord = 'Growing the nebula';
    return bake();
  }
  layers = r.layers;
  ui.source = 'prebaked';
  bakedComp = comp;
  try { present(); } catch (e) {
    console.warn('[nebula] compositor on the shipped volume failed:', e);
    window.__nebula.prebakedFail = 'compositor';
    precompileBake();
    return bake();
  }
  setBusy(false);
  measureFrames().then(precompileBake, precompileBake);
}

async function lookRerun(stage, opts) {
  if (!compositor) return;
  if (ui.source === 'prebaked') { await bake(); return; }
  setBusy(true);
  try { compositor.dispose(); } catch (e) { console.error(e); }
  compositor = null;
  try {
    bakedComp = liveComp;
    layers = await rerun(stage, opts, liveComp);
  } catch (e) {
    console.warn('[nebula] rerun failed:', e);
  }
  try {
    compositor = createCompositor(ctx, layers, layers.catalogue, compositorOpts());
    compositor.setExposure(layers.exposureTrimEv, offsetEv());
    compositor.setDebug('composite', [480, 560]);
    window.__nebula.report = layers.report;
  } catch (e) {
    console.warn('[nebula] compositor failed:', e);
    fail('The renderer stopped (' + (e && e.message ? e.message : e) + '). Reload the page to try again.');
    return;
  }
  dirty = true;
  setBusy(false);
}

function offsetEv() { const d = liveComp.display; return (d && d.exposureOffsetEv) || 0; }

// ---- Looks ----
let lookChain = Promise.resolve(), lookTicket = 0;
function applyLook(next, word) {
  const ticket = ++lookTicket;
  const run = lookChain.then(async () => {
    if (ticket !== lookTicket) return { dropped: true };
    return applyLookNow(next, word);
  });
  lookChain = run.catch(() => null);
  return run;
}
async function applyLookNow(next, word) {
  if (!gl || mode === 'none' && !compositor) return { failed: true };
  const t0 = performance.now();
  let stage = stageOf(bakedComp, next);
  liveComp = next;
  ui.palette = next.paletteName || 'nircam';
  ui.strandS = next.strands.S !== false; ui.strandF = next.strands.F !== false;
  const strands = { S: ui.strandS, F: ui.strandF };
  const needsBake = stage === 'A' || stage === 'B' || stage === 'P';
  if (needsBake && ui.source === 'prebaked') stage = 'A';
  busyWord = word || (stage === 'P' ? 'Relighting in ' + palName(ui.palette) : 'Growing a new nebula');
  syncUi();
  if (stage === 'A') await bake();
  else if (stage === 'B') await lookRerun('fromSnap', { seats: false, palette: ui.palette, strands });
  else if (stage === 'P') await lookRerun('prelight', { palette: ui.palette, strands });
  else if (stage === 'C' && compositor && layers) {
    bakedComp = { ...bakedComp, stars: liveComp.stars };
    layers.catalogue = buildCatalogue(bakedComp, sites, layers, { fluxScale: layers.exposure, seats: [], palette: ui.palette, cepheids: false });
    compositor.setCatalogue(layers.catalogue);
  }
  if (compositor && layers) compositor.setExposure(layers.exposureTrimEv, offsetEv());
  dirty = true;
  syncUi();
  writeUrl();
  return { stage: stage || 'none', ms: performance.now() - t0, failed: mode !== 'gl' };
}
const palName = (n) => (PALETTE_INFO[n] ? PALETTE_INFO[n].name : n);

function writeUrl() {
  try {
    const c = look.code(), q = new URLSearchParams(location.search);
    if (c.look) q.set('look', c.look); else q.delete('look');
    if (c.pal && c.pal !== 'nircam') q.set('pal', c.pal); else q.delete('pal');
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  } catch (e) { /* sandboxed frame */ }
}

// ---- Draw ----
function animTime() { return ui.reduce ? frozenTime : performance.now() / 1000 - animStart; }
function drawOpts() { return { gas: true, stars: true, objects: true, gray: false, fine: ui.fine, starAnim: !ui.reduce, marchScale: ui.renderScale * curMarch }; }
let curMarch = 1;

// The GPU queue: true when fewer than MAX_IN_FLIGHT canvas draws are still on the GPU.
function gpuFree() {
  while (fences.length) {
    const st = gl.getSyncParameter(fences[0], gl.SYNC_STATUS);
    if (st !== gl.SIGNALED) break;
    gl.deleteSync(fences.shift());
  }
  return fences.length < MAX_IN_FLIGHT;
}

// The saver reads the last frame from here (a 2D copy made in the same task as the GL draw).
const snap = document.createElement('canvas');
let snapOn = false, snapCtx = null;
function snapshot() {
  if (!snapOn) return;
  if (snap.width !== glCanvas.width || snap.height !== glCanvas.height) { snap.width = glCanvas.width; snap.height = glCanvas.height; snapCtx = null; }
  snapCtx = snapCtx || snap.getContext('2d', { alpha: false });
  snapCtx.drawImage(glCanvas, 0, 0);
}

function draw() {
  if (mode !== 'gl' || !compositor) return;
  compositor.draw(scroller.get(), viewW, animTime(), { ...drawOpts(), accumulate: true });
  const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (f) fences.push(f);
  snapshot();
}

function loop() {
  const now = performance.now(), s = scroller.get();
  updateTrack();
  if (mode === 'gl' && lastS !== null && (s !== lastS || viewW !== lastVW)) motionUntil = now + MOTION_MS;
  else if (now < motionUntil && scroller.settled() && viewW === lastVW) motionUntil = now;
  curMarch = mode === 'gl' && ui.motionPreview && now < motionUntil ? motionScale : 1;
  const fullMs = frameInfo ? frameInfo.frameMsMedian : 0;
  const animDue = !ui.reduce && mode === 'gl' && (now < motionUntil || fullMs <= SLOW_FRAME_MS || now - lastAnimDraw >= 1.5 * fullMs);
  const conv = mode === 'gl' && compositor && compositor.converging && compositor.converging();
  if (onScreen && !document.hidden && (dirty || animDue || conv) && mode === 'gl' && compositor && gpuFree()) {
    dirty = false; draw(); lastS = s; lastVW = viewW; lastAnimDraw = now;
  }
  requestAnimationFrame(loop);
}

// ---- Frame time: GPU timer, else a 1 px read. Sets the motion march scale. ----
async function measureFrames(n = 4) {
  if (!compositor) return;
  const ms = [], px = new Uint8Array(4), useTimer = timer && timer.enabled;
  const W = glCanvas.width, H = glCanvas.height;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  try {
    for (let i = 0; i < n + 10 && ms.length < n; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (mode !== 'gl' || !compositor) break;
      const S = CONTENT_W - clampView(viewW), s = Math.min(S, 0.25 * S + 32 * i);
      if (useTimer) {
        for (let k = 0; k < 120 && timer.inFlight() >= 2; k++) {
          await new Promise((r) => requestAnimationFrame(r));
          for (const d of timer.poll()) ms.push(d.ms);
        }
        if (mode !== 'gl' || !compositor || ms.length >= n) break;
        timer.begin('frame'); compositor.drawTo(fbo, W, H, s, viewW, animTime(), drawOpts()); timer.end();
        for (const d of timer.poll()) ms.push(d.ms);
      } else {
        const t0 = performance.now();
        compositor.drawTo(fbo, W, H, s, viewW, animTime(), drawOpts());
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        ms.push(performance.now() - t0);
      }
    }
    for (let k = 0; useTimer && k < 20 && ms.length < n; k++) {
      await new Promise((r) => requestAnimationFrame(r));
      for (const d of timer.poll()) ms.push(d.ms);
    }
  } finally { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); }
  if (!ms.length) return;
  ms.sort((a, b) => a - b);
  frameInfo = { frameMsMedian: ms[Math.floor(0.5 * (ms.length - 1))], frames: ms.length, source: useTimer ? 'GPU timer' : 'draw + 1 px read', viewport: [W, H] };
  retuneMotion();
  window.__nebula.metrics = frameInfo;
  dirty = true;
}
function retuneMotion() {
  if (!frameInfo) return;
  const msPerPx = frameInfo.frameMsMedian / Math.max(1, glCanvas.width * glCanvas.height);
  const maxK = Math.max(1, MOTION_MAX_SCALE / Math.max(0.1, ui.renderScale));
  motionScale = Math.min(maxK, Math.max(0.1, Math.sqrt(motionTargetMs / Math.max(1e-9, msPerPx * fullW * fullH))));
  frameInfo.motionScale = motionScale;
}

// ---- Context loss ----
onContextLost(() => {
  compositor = null; layers = null; fences.length = 0;
  fail('The GPU context was lost. Reload the page to start it again.');
});
onContextRestored(() => { if (ctx) ctx.registry = createRegistry(gl, caps); });

// ---- Controls ----
function syncUi() {
  const p = ui.palette;
  $('hudLine').textContent = `${palName(p)} palette` + (look.code().look ? ` · nebula ${look.code().look}` : ' · the original nebula');
  for (const b of document.querySelectorAll('#tray .sw')) b.setAttribute('aria-pressed', String(b.dataset.pal === p));
  for (const b of document.querySelectorAll('[data-q]')) b.setAttribute('aria-pressed', String(b.dataset.q === ui.preset));
  $('btnBack').disabled = !look.canBack();
  $('optTwinkle').checked = !ui.reduce;
}

function buildTray() {
  const tray = $('swatches');
  tray.textContent = '';
  for (const kind of ['real', 'fantasy']) {
    const head = document.createElement('div');
    head.className = 'tray-h';
    head.textContent = kind === 'real' ? 'Telescope' : 'Fantasy';
    tray.append(head);
    for (const n of PALETTE_ORDER.filter((x) => PALETTE_INFO[x].kind === kind)) {
      const cols = swatch(comp, n), info = PALETTE_INFO[n];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.dataset.pal = n;
      b.title = `${info.name}: ${info.note}`;
      b.setAttribute('aria-label', `${info.name} palette, ${info.note}`);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = `radial-gradient(circle at 30% 30%, ${cols[2]} 0 18%, transparent 46%), conic-gradient(from 200deg, ${cols.join(', ')}, ${cols[0]})`;
      const name = document.createElement('span');
      name.className = 'nm'; name.textContent = info.name;
      b.append(chip, name);
      b.addEventListener('click', () => { const c = look.setPalette(n); if (c) applyLook(c); });
      tray.append(b);
    }
  }
}

function toggle(id, open) {
  const el = $(id), btn = $(id === 'tray' ? 'btnColours' : 'btnMore');
  const on = open != null ? open : el.hidden;
  for (const o of ['tray', 'sheet']) if (o !== id) { $(o).hidden = true; $(o === 'tray' ? 'btnColours' : 'btnMore').setAttribute('aria-expanded', 'false'); }
  el.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
}

function setQuality(name) {
  const p = PRESETS.find((r) => r[0] === name);
  if (!p) return;
  ui.preset = p[0]; ui.renderScale = p[2];
  try { localStorage.setItem('nebula.quality', p[0]); } catch (e) { /* no storage */ }
  retuneMotion();
  if (compositor && compositor.resetHistory) compositor.resetHistory();
  dirty = true; syncUi();
}
function setAnimate(on) {
  if (!on && !ui.reduce) frozenTime = animTime();
  ui.reduce = !on;
  if (on) animStart = performance.now() / 1000 - frozenTime;
  dirty = true; syncUi();
}

function shuffle() { applyLook(look.shuffleAll(), 'Growing a new nebula'); }
function shuffleColours() { applyLook(look.shufflePalette()); }
function goBack() { const c = look.back(); if (c) applyLook(c, 'Going back'); }

$('btnShuffle').addEventListener('click', shuffle);
$('btnBack').addEventListener('click', goBack);
$('btnColours').addEventListener('click', () => toggle('tray'));
$('btnMore').addEventListener('click', () => toggle('sheet'));
$('btnPalDice').addEventListener('click', shuffleColours);
$('btnReset').addEventListener('click', () => { applyLook(look.reset(), 'Back to the original nebula'); toggle('sheet', false); });
$('optTwinkle').addEventListener('change', (e) => setAnimate(e.target.checked));
for (const b of document.querySelectorAll('[data-q]')) b.addEventListener('click', () => setQuality(b.dataset.q));
$('btnLink').addEventListener('click', async () => {
  writeUrl();
  let url = location.href;
  try { if (window.top !== window && window.top.location.href) url = window.top.location.href; } catch (e) { /* cross origin */ }
  try { await navigator.clipboard.writeText(url); $('btnLink').textContent = 'Link copied'; } catch (e) { $('btnLink').textContent = 'Copy failed'; }
  setTimeout(() => { $('btnLink').textContent = 'Copy a link to this nebula'; }, 1800);
});
// Taps on the canvas close an open tray or sheet.
viewer.addEventListener('pointerdown', () => { toggle('tray', false); $('sheet').hidden = true; $('btnMore').setAttribute('aria-expanded', 'false'); });
addEventListener('keydown', (e) => {
  if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's' || k === 'n') { e.preventDefault(); shuffle(); }
  else if (k === 'c') { e.preventDefault(); shuffleColours(); }
  else if (k === 'b' || k === 'backspace') { e.preventDefault(); goBack(); }
  else if (k === 'escape') { toggle('tray', false); $('sheet').hidden = true; }
});

// ---- window.__nebula and the saver ----
window.__nebula = {
  ready: false, metrics: null, report: null, prebakedFail: null,
  look: () => liveComp, ui,
  setScroll(t) { scroller.jump(t); dirty = true; },
};
installSaver({
  look, scroller, glCanvas,
  snap: () => snap,
  setSnap(on) { snapOn = !!on; if (on) dirty = true; },
  comp: () => liveComp,
  palette: () => ui.palette, palName,
  busy: () => ui.busy,
  viewW: () => viewW,
  apply: (c, word) => applyLook(c, word),
  setAnimate(on) { setAnimate(on); },
  animating: () => !ui.reduce,
  setSaverMotion(on) { motionTargetMs = on ? 33 : 18; retuneMotion(); },
  kick() { dirty = true; },
});

// ---- Boot ----
function boot() {
  buildTray();
  resize();
  scroller.jump(0.3);
  syncUi();
  requestAnimationFrame(loop);
  const miss = initGL();
  if (miss.length) {
    fail(miss[0] === 'WebGL2' ? 'This browser gives no WebGL2 context, so the nebula cannot draw here.'
      : 'This GPU lacks ' + miss.join(', ') + ', so the nebula cannot draw here.');
    return;
  }
  programStart(gl, compositorName(), null, compositorText());
  // A look from the link (?look, ?pal) needs a live bake; the shipped volume is the original nebula.
  // The first load is the head of the look queue, so a click during the load waits for it.
  let first;
  if (look.code().look || look.paletteName() !== 'nircam') {
    liveComp = look.comp(); ui.palette = look.paletteName();
    precompileBake(); busyWord = 'Growing the nebula from the link'; first = bake();
  } else first = tryPrebaked();
  lookChain = Promise.resolve(first).catch(() => null);
}

boot();
