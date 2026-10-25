// ============================================================================
//  STEREOGRAM MAKER  ·  main.js — the stage, the controls and the dialogs
// ----------------------------------------------------------------------------
//  One state object (state.js) describes the stereogram. Each control
//  changes the state and calls render(). render() sends the state to the
//  stage worker (worker.js) and draws the reply: the stereogram on #out
//  and the relief of the depth map on #rev (the Reveal view).
//
//  WORKERS. stageW does the stage: render, the drag preview and the
//  turntable. thumbW does the thumbnails: the examples, the object library
//  and the pattern tiles. A lane keeps one job of a kind in flight and
//  keeps only the newest waiting job, so a fast slider never builds a
//  queue (function lane).
//
//  SIZES. 'Fit the screen' renders at the size of the print on screen in
//  device px, and the DPI is the screen density (depthkit.screenDpi), so
//  the repeat on screen is near half the eye separation. A file size
//  (SIZES) renders at its own px and DPI and shows scaled to fit.
//
//  DRAG. A drag on the print turns a model (yaw from x, pitch from y).
//  While the pointer moves, a small depth relief shows on #rev (lane
//  'preview'); at pointerup the stereogram renders again.
//
//  TURNTABLE. The worker streams the frames of a full turn (engine
//  animate: one tile and one seed for every frame, so the wall stays
//  still). Each frame becomes an ImageBitmap; a timer plays them at the
//  Speed setting. A change of state makes the frames again.
//
//  grep -n targets
//    worker client ......... "function client", "function lane"
//    state to controls ..... "function syncControls"
//    stage layout .......... "function layout"
//    render ................ "function render"
//    drag to turn .......... "function bindDrag"
//    object library ........ "function buildModels"
//    pattern gallery ....... "function buildPatterns"
//    examples .............. "function buildExamples"
//    uploads ............... "function readImageFile"
//    turntable ............. "function startTurntable"
//    PNG ................... "function downloadPNG"
//    link .................. "function shareLink"
//    help dialog ........... "function openHelp"
//    phone sheet ........... "function bindSheet"
// ============================================================================
import { MODELS, KINDS, TILES, SDF_SHAPES, farSeparation, modelMeta, tileMeta } from './engine-api.js';
import { DEFAULT_STATE, DOT_PALETTE_IDS, cloneState, encodeState, decodeState } from './state.js';
import { SIZES, sizeById, fitBox, screenDpi, turntableSize } from './depthkit.js';
import { EXAMPLES, SHAPE_NAMES } from './examples.js';
import { PALETTES } from '../pattern-designer/palettes.js';
import { FAMILIES } from '../pattern-designer/patterns/index.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const phone = () => PHONE_Q.matches;
const DPR = () => Math.min(3, window.devicePixelRatio || 1);
const MAX_PX = () => phone() ? 2.2e6 : 3.6e6;           // render cap for 'fit'
const TURN_BUDGET = () => phone() ? 7e6 : 14e6;        // all turntable frames
const DOT_PALETTES = DOT_PALETTE_IDS.map(id => PALETTES.find(p => p.id === id)).filter(Boolean);
const FAMILY_NAME = Object.fromEntries(FAMILIES.map(f => [f.id, f.name]).concat([['dots', 'Dots and noise']]));

// ── worker client ──────────────────────────────────────────────────────────
function client() {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let seq = 0;
  const pend = new Map();
  w.onmessage = e => {
    const m = e.data, p = pend.get(m.id);
    if (!p) return;
    if (m.progress) { if (p.onProgress) p.onProgress(m.progress); return; }
    pend.delete(m.id);
    if (m.ok) p.res(m.result); else p.rej(new Error(m.error));
  };
  w.onerror = e => { for (const p of pend.values()) p.rej(new Error('worker: ' + (e.message || 'failed'))); pend.clear(); };
  return {
    call(op, args, transfer = [], onProgress = null) {
      const id = ++seq;
      return new Promise((res, rej) => { pend.set(id, { res, rej, onProgress }); w.postMessage({ id, op, args }, transfer); });
    },
  };
}
// One job of op in flight, and only the newest waiting job. A superseded
// job resolves to null.
function lane(cli, op) {
  let busy = false, next = null;
  const pump = async () => {
    if (busy || !next) return;
    const job = next; next = null; busy = true;
    try { const r = await cli.call(op, job.args); job.res(next ? null : r); }
    catch (e) { job.rej(e); }
    finally { busy = false; pump(); }
  };
  return args => new Promise((res, rej) => { if (next) next.res(null); next = { args, res, rej }; pump(); });
}
const stageW = client(), thumbW = client();
const renderLane = lane(stageW, 'render'), previewLane = lane(stageW, 'preview');

// ── state ──────────────────────────────────────────────────────────────────
const KNOWN = {
  models: new Set(MODELS.map(m => m.id)), tiles: new Set(TILES.map(t => t.id)),
  shapes: new Set(SDF_SHAPES), sizes: new Set(SIZES.map(s => s.id)),
};
let S = cloneState(DEFAULT_STATE);
let exampleOn = -1;                      // the example card that matches S
const uploads = { depth: null, photo: null, image: null };   // { ref, name }

function stateFromExample(ex) {
  const s = cloneState(DEFAULT_STATE);
  Object.assign(s.src, ex.src); Object.assign(s.pat, ex.pat); Object.assign(s.view, ex.view || {});
  if (s.src.kind === 'model' && (ex.src.yaw == null || ex.src.pitch == null)) {
    const v = (modelMeta(s.src.id) || {}).view || {};
    if (ex.src.yaw == null) s.src.yaw = v.yaw || 0;
    if (ex.src.pitch == null) s.src.pitch = v.pitch || 0;
  }
  return s;
}
const paletteColors = () => { const p = DOT_PALETTES[S.pat.palette] || DOT_PALETTES[0]; return p ? [p.bg, ...p.ink] : null; };
const sourceReady = () => (S.src.kind !== 'depth' && S.src.kind !== 'photo') || !!uploads[S.src.kind];
const patternReady = () => S.pat.kind !== 'image' || !!uploads.image;

// ── stage layout ───────────────────────────────────────────────────────────
const stage = $('stage'), print = $('print'), out = $('out'), rev = $('rev');
let box = { x: 0, y: 0, w: 10, h: 10 };          // the print in stage CSS px
let renderDims = null;                           // { w, h, dpi, scale }

// The part of the stage the print may use, in stage CSS px. On a phone the
// open sheet covers the lower part of the stage, so the print sits above it.
function clearArea(withSheet) {
  const r = stage.getBoundingClientRect();
  const inFrame = document.documentElement.classList.contains('in-frame');
  let top, bottom, side;
  if (phone()) {
    const land = innerHeight <= 500;
    top = land ? 12 : inFrame ? 52 : document.querySelector('.topbar').getBoundingClientRect().bottom + 4;
    bottom = land ? 12 : 50; side = 12;
    if (land && withSheet && $('panel').classList.contains('open')) {
      return { x: side, y: top, w: Math.max(80, r.width - $('panel').getBoundingClientRect().width - 2 * side), h: Math.max(80, r.height - top - bottom) };
    }
    if (!land && withSheet && $('panel').classList.contains('open')) {
      const ph = $('panel').getBoundingClientRect().height;
      bottom = Math.max(bottom, ph + 10);
    }
  } else { top = inFrame ? 60 : 64; bottom = 48; side = 28; }
  return { x: side, y: top, w: Math.max(80, r.width - 2 * side), h: Math.max(80, r.height - top - bottom) };
}
// The aspect of the output: the area aspect for 'fit', else the file aspect.
function outAspect() {
  const sz = sizeById(S.view.size);
  if (sz.w) return sz.w / sz.h;
  const a = clearArea(false);
  return a.w / a.h;
}
function layout() {
  const a = clearArea(true), asp = renderDims ? renderDims.w / renderDims.h : outAspect();
  const f = fitBox(a.w, a.h, asp);
  box = { x: a.x + (a.w - f.w) / 2, y: a.y + (a.h - f.h) / 2, w: f.w, h: f.h };
  Object.assign(print.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
}
// The render size and DPI of the current state.
function targetDims() {
  const sz = sizeById(S.view.size);
  if (sz.w) return { w: sz.w, h: sz.h, dpi: sz.dpi, scale: 1, file: true };
  const a = clearArea(false), f = fitBox(a.w, a.h, a.w / a.h);
  let scale = DPR();
  const px = f.w * f.h * scale * scale;
  if (px > MAX_PX()) scale *= Math.sqrt(MAX_PX() / px);
  const w = Math.round(f.w * scale), h = Math.round(f.h * scale);
  return { w, h, dpi: screenDpi(scale, phone()), scale, file: false };
}

// ── render ─────────────────────────────────────────────────────────────────
let busyT = 0, stillImage = null, renderGen = 0, lastSep = 0;
function busy(on) {
  clearTimeout(busyT);
  if (on) busyT = setTimeout(() => $('busy').classList.add('on'), 140);
  else $('busy').classList.remove('on');
}
let renderT = 0;
function render(delay = 0) {
  clearTimeout(renderT);
  renderT = setTimeout(doRender, delay);
}
async function doRender() {
  if (!sourceReady() || !patternReady()) { caption(); return; }
  if (S.src.kind === 'model' && !S.src.id) return;
  const d = targetDims(), gen = ++renderGen;
  const job = { state: cloneState(S), w: d.w, h: d.h, dpi: d.dpi, colors: paletteColors() };
  if (!d.file) job.state.view.dot = Math.max(1, S.view.dot * Math.round(d.scale));
  busy(true);
  let r;
  try { r = await renderLane(job); }
  catch (e) { busy(false); toast('The stereogram failed: ' + e.message); return; }
  if (!r || gen !== renderGen) return;
  busy(false);
  renderDims = d;
  stillImage = new ImageData(r.stereo.data, r.stereo.w, r.stereo.h);
  out.width = r.stereo.w; out.height = r.stereo.h;
  out.getContext('2d').putImageData(stillImage, 0, 0);
  out.style.imageRendering = job.state.view.dot > 1 ? 'pixelated' : '';
  if (r.relief) { rev.width = r.relief.w; rev.height = r.relief.h; rev.getContext('2d').putImageData(new ImageData(r.relief.data, r.relief.w, r.relief.h), 0, 0); }
  lastSep = r.stereo.sepFar;
  print.classList.remove('empty');
  layout(); caption();
  if (turn.on) startTurntable();
}

// The caption under the print: the object and the pattern, then the way to
// look and the repeat.
function sourceName() {
  const s = S.src;
  if (s.kind === 'model') { const m = modelMeta(s.id); return m ? m.name : 'An object'; }
  if (s.kind === 'text') return '“' + (s.text || '') + '”';
  if (s.kind === 'shape') return SHAPE_NAMES[s.shape] || s.shape;
  if (s.kind === 'depth') return uploads.depth ? uploads.depth.name : 'Choose a depth map';
  return uploads.photo ? uploads.photo.name : 'Choose a photo';
}
function patternName() {
  const p = S.pat;
  if (p.kind === 'tile') { const t = tileMeta(p.id); return t ? t.name : 'a pattern'; }
  if (p.kind === 'dots') return 'random dots';
  if (p.kind === 'colour') { const pl = DOT_PALETTES[p.palette]; return 'coloured dots' + (pl ? ', ' + pl.name.toLowerCase() : ''); }
  return uploads.image ? uploads.image.name : 'your image';
}
function caption(extra) {
  $('capMain').textContent = sourceName();
  const d = renderDims, cm = d && lastSep ? lastSep / d.dpi * 2.54 : 0;
  const bits = ['on ' + patternName(), S.view.mode === 'cross' ? 'cross-eyed' : 'wall-eyed'];
  if (d && d.file) bits.push(d.w + ' × ' + d.h + ' px');
  else if (cm) bits.push('repeat ' + cm.toFixed(1) + ' cm');
  $('capSub').textContent = extra || bits.join(' · ');
}

// ── controls ───────────────────────────────────────────────────────────────
const FMT = {
  yaw: v => Math.round(v) + '°', pitch: v => Math.round(v) + '°', fit: v => Math.round(v * 100) + '%',
  relief: v => Math.round(v * 100) + '%', lift: v => Math.round(v * 100) + '%', photoSoft: v => v + ' px',
  dotDensity: v => Math.round(v * 100) + '%', eyeSep: v => (+v).toFixed(2) + ' cm', mu: v => (+v).toFixed(2),
  turnFrames: v => v, turnSpeed: v => v + ' fps', dotSize: v => v + ' px',
};
// Each slider: [element id, state path, live preview of a pose].
const SLIDERS = [
  ['yaw', 'src.yaw', true], ['pitch', 'src.pitch', true], ['fit', 'src.fit', true],
  ['relief', 'src.relief', false], ['lift', 'src.lift', false], ['photoSoft', 'src.soft', false],
  ['dotDensity', 'pat.density', false], ['eyeSep', 'view.eyeSep', false], ['mu', 'view.mu', false],
  ['turnFrames', 'view.frames', false], ['turnSpeed', 'view.speed', false], ['dotSize', 'view.dot', false],
];
const getP = path => { const [a, b] = path.split('.'); return S[a][b]; };
const setP = (path, v) => { const [a, b] = path.split('.'); S[a][b] = v; };
function showVal(id) { const el = $(id + 'V'); if (el) el.textContent = FMT[id]($(id).value); }

function bindSliders() {
  for (const [id, path, pose] of SLIDERS) {
    const el = $(id);
    el.addEventListener('input', () => {
      setP(path, +el.value); showVal(id); exampleOff();
      if (id === 'turnSpeed') return;                       // the timer reads it
      if (pose && S.src.kind === 'model') { posePreview(); return; }
      if (id === 'turnFrames') { if (turn.on) startTurntable(300); return; }
      render(140);
    });
    if (pose) el.addEventListener('change', () => { endPreview(); render(); });
  }
}
function syncControls() {
  for (const [id, path] of SLIDERS) { $(id).value = getP(path); showVal(id); }
  segOn('srcKind', 'k', S.src.kind); segOn('patKind', 'k', S.pat.kind); segOn('eyeMode', 'm', S.view.mode);
  segOn('textFace', 'f', S.src.face);
  document.querySelectorAll('.srcbox').forEach(b => b.hidden = b.dataset.src !== S.src.kind);
  document.querySelectorAll('.patbox').forEach(b => b.hidden = b.dataset.pat !== S.pat.kind);
  $('dotSizeRow').hidden = !(S.pat.kind === 'dots' || S.pat.kind === 'colour');
  $('textIn').value = S.src.text;
  press($('guideBtn'), S.view.guides); press($('smoothBtn'), S.view.smooth);
  press($('depthInvert'), S.src.kind === 'depth' && S.src.invert); press($('photoInvert'), S.src.kind === 'photo' && S.src.invert);
  document.querySelectorAll('#shapeGrid button').forEach(b => b.classList.toggle('on', b.dataset.s === S.src.shape));
  document.querySelectorAll('#sizes button').forEach(b => b.classList.toggle('on', b.dataset.z === S.view.size));
  document.querySelectorAll('#dotPals .pal').forEach((b, i) => b.classList.toggle('on', i === S.pat.palette));
  document.querySelectorAll('#exGrid .excard').forEach((b, i) => b.classList.toggle('on', i === exampleOn));
  markModel(); markTile(); eyeHint(); sizeInfo(); modelCredit(); tileNote();
  const canTurn = S.src.kind === 'model';
  $('turnBtn').disabled = !canTurn; $('dockTurn').disabled = !canTurn;
  $('turnBtn').title = canTurn ? 'An animated stereogram of the object as it turns' : 'The turntable needs an object';
}
function segOn(id, key, val) { document.querySelectorAll('#' + id + ' button').forEach(b => b.classList.toggle('on', b.dataset[key] === val)); }
function press(btn, on) { btn.classList.toggle('on', !!on); btn.setAttribute('aria-pressed', String(!!on)); }
function exampleOff() { if (exampleOn >= 0) { exampleOn = -1; document.querySelectorAll('#exGrid .excard').forEach(b => b.classList.remove('on')); } }

function eyeHint() {
  $('eyeHint').textContent = S.view.mode === 'cross'
    ? 'Cross your eyes so that they meet in front of the screen. Near parts come forward only in this mode.'
    : 'Look through the screen, as if at a far wall. Most printed stereograms use this method.';
}
function sizeInfo() {
  const sz = sizeById(S.view.size), d = targetDims();
  const rep = farSeparation({ eyeSep: S.view.eyeSep / 2.54, dpi: d.dpi, mu: S.view.mu });
  $('sizeInfo').textContent = sz.w
    ? `${sz.w} × ${sz.h} px at ${sz.dpi} DPI. The pattern repeats every ${(rep / sz.dpi * 2.54).toFixed(1)} cm on the file at that DPI.`
    : `The size of the picture on this screen, ${d.w} × ${d.h} px. The pattern repeats every ${rep} px.`;
}
function modelCredit() {
  const m = modelMeta(S.src.id), el = $('modelCredit');
  el.textContent = '';
  if (!m) return;
  const b = document.createElement('b'); b.textContent = m.name;
  el.append(b, document.createTextNode(' · ' + m.credit + ' · '));
  const a = document.createElement('a'); a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m.licence;
  el.append(a);
}
function tileNote() {
  const t = tileMeta(S.pat.id), el = $('tileNote');
  if (!t) { el.textContent = ''; return; }
  const fam = FAMILY_NAME[t.family] || t.family;
  el.innerHTML = '';
  const b = document.createElement('b'); b.textContent = t.name;
  el.append(b, document.createTextNode(' · ' + fam + (t.wrap === 'mirror' ? ' · mirrored, so the tile wraps' : '') + ' · seed ' + S.pat.seed));
}

function bindControls() {
  // Tabs.
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  // Source kind.
  document.querySelectorAll('#srcKind button').forEach(b => b.addEventListener('click', () => {
    S.src.kind = b.dataset.k; exampleOff();
    if (S.src.kind === 'depth' || S.src.kind === 'photo') S.src.ref = uploads[S.src.kind] ? uploads[S.src.kind].ref : '';
    if (S.src.kind === 'model' && !S.src.id) pickModel(MODELS[0] && MODELS[0].id, false);
    syncControls(); stopTurntable(); render();
  }));
  $('textIn').addEventListener('input', () => { S.src.text = $('textIn').value; exampleOff(); render(260); });
  document.querySelectorAll('#textFace button').forEach(b => b.addEventListener('click', () => { S.src.face = b.dataset.f; exampleOff(); syncControls(); render(); }));
  $('poseReset').addEventListener('click', () => {
    const v = (modelMeta(S.src.id) || {}).view || {};
    S.src.yaw = v.yaw || 0; S.src.pitch = v.pitch || 0; S.src.fit = DEFAULT_STATE.src.fit; syncControls(); render();
  });
  $('depthInvert').addEventListener('click', () => { S.src.invert = !S.src.invert; syncControls(); render(); });
  $('photoInvert').addEventListener('click', () => { S.src.invert = !S.src.invert; syncControls(); render(); });
  // Pattern kind.
  document.querySelectorAll('#patKind button').forEach(b => b.addEventListener('click', () => {
    S.pat.kind = b.dataset.k; exampleOff(); syncControls(); render();
    if (S.pat.kind === 'tile') queueTileThumbs();
  }));
  $('tileSeed').addEventListener('click', () => { S.pat.seed = 1 + Math.floor(Math.random() * 9999); exampleOff(); tileNote(); refreshTileThumb(S.pat.id); render(); });
  $('tileRandom').addEventListener('click', () => {
    const pool = TILES.filter(t => t.family !== 'dots');
    const t = pool[Math.floor(Math.random() * pool.length)];
    if (!t) return;
    S.pat.id = t.id; S.pat.seed = 1 + Math.floor(Math.random() * 9999); exampleOff();
    tileFam = 'all'; buildTileFams(); syncControls(); refreshTileThumb(t.id); scrollToOn('#tileGrid'); render();
  });
  // View.
  document.querySelectorAll('#eyeMode button').forEach(b => b.addEventListener('click', () => { S.view.mode = b.dataset.m; syncControls(); render(); }));
  $('guideBtn').addEventListener('click', () => { S.view.guides = !S.view.guides; syncControls(); render(); });
  $('smoothBtn').addEventListener('click', () => { S.view.smooth = !S.view.smooth; syncControls(); render(); });
  // Tools.
  $('seeBtn').addEventListener('click', openHelp); $('helpBtn').addEventListener('click', openHelp);
  $('revealBtn').addEventListener('click', () => setReveal(!revealOn));
  document.querySelectorAll('#dockView button').forEach(b => b.addEventListener('click', () => setReveal(b.dataset.v === 'depth')));
  $('turnBtn').addEventListener('click', () => turn.on ? stopTurntable() : startTurntable());
  $('dockTurn').addEventListener('click', () => turn.on ? stopTurntable() : startTurntable());
  $('pngBtn').addEventListener('click', downloadPNG); $('dockPng').addEventListener('click', downloadPNG);
  $('linkBtn').addEventListener('click', shareLink); $('tbLink').addEventListener('click', shareLink);
  // Uploads.
  $('depthFile').addEventListener('change', e => takeUpload(e.target, 'depth'));
  $('photoFile').addEventListener('change', e => takeUpload(e.target, 'photo'));
  $('tileFile').addEventListener('change', e => takeUpload(e.target, 'image'));
  document.querySelectorAll('.drop').forEach(d => {
    d.addEventListener('dragenter', () => d.classList.add('over'));
    d.addEventListener('dragleave', () => d.classList.remove('over'));
    d.addEventListener('drop', () => d.classList.remove('over'));
  });
  // Keys: R held shows the depth, T plays the turntable, arrows turn a model.
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select, dialog')) return;
    if (e.key === 'r' && !e.repeat) setReveal(true, true);
    else if (e.key === 't') turn.on ? stopTurntable() : startTurntable();
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && S.src.kind === 'model') {
      S.src.yaw = wrapYaw(S.src.yaw + (e.key === 'ArrowLeft' ? -15 : 15)); exampleOff(); syncControls(); render(80);
    }
  });
  addEventListener('keyup', e => { if (e.key === 'r' && revealHeld) setReveal(false); });
}
const wrapYaw = y => ((y + 180) % 360 + 360) % 360 - 180;

function showTab(t) {
  document.querySelectorAll('#tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
  document.querySelectorAll('.tabpane').forEach(p => p.hidden = p.dataset.pane !== t);
  if (t === 'pattern') queueTileThumbs();
  if (t === 'view') sizeInfo();
}

// ── reveal ─────────────────────────────────────────────────────────────────
let revealOn = false, revealHeld = false;
function setReveal(on, held = false) {
  revealOn = on; revealHeld = on && held;
  print.classList.toggle('reveal', on);
  press($('revealBtn'), on);
  document.querySelectorAll('#dockView button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'depth') === on));
}

// ── drag to turn ───────────────────────────────────────────────────────────
let dragging = false;
function bindDrag() {
  let p0 = null, yaw0 = 0, pitch0 = 0, moved = false;
  print.addEventListener('pointerdown', e => {
    if (S.src.kind !== 'model' || e.button > 0) return;
    p0 = { x: e.clientX, y: e.clientY, id: e.pointerId }; yaw0 = S.src.yaw; pitch0 = S.src.pitch; moved = false;
    try { print.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
  });
  print.addEventListener('pointermove', e => {
    if (!p0 || e.pointerId !== p0.id) return;
    const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) { moved = true; dragging = true; print.classList.add('dragging'); exampleOff(); if (turn.on) pauseTurntable(); }
    S.src.yaw = wrapYaw(yaw0 + dx * 0.45);
    S.src.pitch = Math.max(-80, Math.min(80, pitch0 + dy * 0.35));
    $('yaw').value = S.src.yaw; $('pitch').value = S.src.pitch; showVal('yaw'); showVal('pitch');
    posePreview();
  });
  const end = e => {
    if (!p0 || (e && e.pointerId !== p0.id)) return;
    p0 = null;
    if (!moved) return;
    dragging = false; print.classList.remove('dragging');
    endPreview(); render();
  };
  print.addEventListener('pointerup', end);
  print.addEventListener('pointercancel', end);
}
// While a pose changes, #rev shows a small relief of the new pose.
let previewing = false;
async function posePreview() {
  if (!previewing) { previewing = true; print.classList.add('reveal'); }
  const d = renderDims || targetDims(), k = Math.min(1, 380 / Math.max(d.w, d.h));
  const r = await previewLane({ src: cloneState(S).src, w: Math.round(d.w * k), h: Math.round(d.h * k) }).catch(() => null);
  if (!r || !previewing) return;
  rev.width = r.relief.w; rev.height = r.relief.h;
  rev.getContext('2d').putImageData(new ImageData(r.relief.data, r.relief.w, r.relief.h), 0, 0);
}
function endPreview() {
  previewing = false;
  print.classList.toggle('reveal', revealOn);
}

// ── object library ─────────────────────────────────────────────────────────
let modelKind = 'all', modelQuery = '';
const thumbQueue = [], thumbDone = new Set();
let thumbBusy = false;
function buildModels() {
  const kinds = KINDS.map(k => k.id).filter(k => MODELS.some(m => m.kind === k));
  for (const m of MODELS) if (!kinds.includes(m.kind)) kinds.push(m.kind);
  const host = $('modelKinds');
  host.innerHTML = '';
  const chip = (id, name, n) => {
    const b = document.createElement('button');
    b.dataset.k = id; b.classList.toggle('on', id === modelKind);
    b.append(name); const s = document.createElement('span'); s.className = 'n'; s.textContent = n; b.append(s);
    b.addEventListener('click', () => { modelKind = id; buildModels(); });
    host.append(b);
  };
  chip('all', 'All', MODELS.length);
  for (const k of kinds) chip(k, (KINDS.find(x => x.id === k) || { name: k }).name, MODELS.filter(m => m.kind === k).length);
  const grid = $('modelGrid');
  grid.innerHTML = '';
  const q = modelQuery.trim().toLowerCase();
  const list = MODELS.filter(m => (modelKind === 'all' || m.kind === modelKind) && (!q || (m.name + ' ' + m.kind).toLowerCase().includes(q)));
  $('modelCount').textContent = list.length + ' of ' + MODELS.length;
  for (const m of list) {
    const b = document.createElement('button');
    b.className = 'mcard'; b.dataset.id = m.id; b.title = m.name;
    const c = document.createElement('canvas'); c.width = c.height = 4; c.className = 'wait';
    const s = document.createElement('span'); s.textContent = m.name;
    b.append(c, s);
    b.addEventListener('click', () => { pickModel(m.id, true); });
    grid.append(b);
    if (thumbCache.has(m.id)) paintThumb(c, thumbCache.get(m.id)); else thumbObserver.observe(b);
  }
  markModel();
}
const thumbCache = new Map();
const thumbObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { thumbObserver.unobserve(e.target); queueThumb(e.target.dataset.id); } }, { root: $('panel'), rootMargin: '200px' })
  : { observe: el => queueThumb(el.dataset.id), unobserve() {} };
function queueThumb(id) { if (!thumbDone.has(id) && !thumbQueue.includes(id)) { thumbQueue.push(id); pumpThumbs(); } }
async function pumpThumbs() {
  if (thumbBusy) return;
  const id = thumbQueue.shift();
  if (!id) return;
  thumbBusy = true;
  try {
    const r = await thumbW.call('modelThumb', { id, size: phone() ? 160 : 200 });
    const img = new ImageData(r.relief.data, r.relief.w, r.relief.h);
    thumbCache.set(id, img); thumbDone.add(id);
    document.querySelectorAll(`.mcard[data-id="${CSS.escape(id)}"] canvas`).forEach(c => paintThumb(c, img));
  } catch (e) { thumbDone.add(id); }
  thumbBusy = false;
  pumpThumbs();
}
function paintThumb(c, img) { c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); c.classList.remove('wait'); }
function markModel() { document.querySelectorAll('.mcard').forEach(b => b.classList.toggle('on', S.src.kind === 'model' && b.dataset.id === S.src.id)); }
function pickModel(id, go) {
  const m = modelMeta(id);
  if (!m) return;
  S.src.kind = 'model'; S.src.id = id;
  S.src.yaw = (m.view && m.view.yaw) || 0; S.src.pitch = (m.view && m.view.pitch) || 0;
  exampleOff();
  if (go) { syncControls(); render(); }
}

// ── pattern gallery ────────────────────────────────────────────────────────
let tileFam = 'all';
const tileThumbs = new Map();       // id -> ImageData
let tileQueued = false;
function buildTileFams() {
  const fams = [...new Set(TILES.map(t => t.family))];
  const host = $('tileFams');
  host.innerHTML = '';
  const chip = (id, name, n) => {
    const b = document.createElement('button'); b.classList.toggle('on', id === tileFam);
    b.append(name); const s = document.createElement('span'); s.className = 'n'; s.textContent = n; b.append(s);
    b.addEventListener('click', () => { tileFam = id; buildTileFams(); buildPatterns(); });
    host.append(b);
  };
  chip('all', 'All', TILES.length);
  for (const f of fams) chip(f, FAMILY_NAME[f] || f, TILES.filter(t => t.family === f).length);
}
function buildPatterns() {
  const grid = $('tileGrid');
  grid.innerHTML = '';
  for (const t of TILES.filter(t => tileFam === 'all' || t.family === tileFam)) {
    const b = document.createElement('button');
    b.className = 'tcard'; b.dataset.id = t.id; b.title = t.name + ' · ' + (FAMILY_NAME[t.family] || t.family);
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const n = document.createElement('b'); n.textContent = t.name;
    b.append(c, n);
    b.addEventListener('click', () => { S.pat.kind = 'tile'; S.pat.id = t.id; exampleOff(); syncControls(); render(); });
    grid.append(b);
    if (tileThumbs.has(t.id)) paintTile(c, tileThumbs.get(t.id));
  }
  markTile();
  if (!$('tileGrid').closest('.tabpane').hidden) queueTileThumbs();
}
function paintTile(c, img) {
  // Two by two repeats show that the tile wraps.
  c.width = img.width * 2; c.height = img.height * 2;
  const g = c.getContext('2d');
  for (let k = 0; k < 4; k++) g.putImageData(img, (k % 2) * img.width, (k >> 1) * img.height);
}
function markTile() { document.querySelectorAll('.tcard').forEach(b => b.classList.toggle('on', S.pat.kind === 'tile' && b.dataset.id === S.pat.id)); }
async function queueTileThumbs() {
  if (tileQueued) return;
  tileQueued = true;
  const ids = TILES.map(t => t.id).filter(id => !tileThumbs.has(id));
  for (let i = 0; i < ids.length; i += 6) {
    const batch = ids.slice(i, i + 6);
    try {
      const imgs = await thumbW.call('tiles', { ids: batch, size: 64, seed: 1 });
      imgs.forEach((im, k) => {
        const id = im.id || batch[k], data = new ImageData(im.data, im.w, im.h);
        tileThumbs.set(id, data);
        document.querySelectorAll(`.tcard[data-id="${CSS.escape(id)}"] canvas`).forEach(c => paintTile(c, data));
      });
    } catch (e) { /* the card stays blank */ }
  }
}
async function refreshTileThumb(id) {
  try {
    const [im] = await thumbW.call('tiles', { ids: [id], size: 64, seed: S.pat.seed });
    const data = new ImageData(im.data, im.w, im.h);
    tileThumbs.set(id, data);
    document.querySelectorAll(`.tcard[data-id="${CSS.escape(id)}"] canvas`).forEach(c => paintTile(c, data));
  } catch (e) { /* keep the old thumb */ }
}
function scrollToOn(sel) { const on = document.querySelector(sel + ' .on'); if (on) on.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

function buildDotPalettes() {
  const host = $('dotPals');
  host.innerHTML = '';
  DOT_PALETTES.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'pal'; b.title = p.name; b.setAttribute('aria-label', p.name);
    for (const c of [p.bg, ...p.ink]) { const s = document.createElement('i'); s.style.background = c; b.append(s); }
    b.addEventListener('click', () => { S.pat.kind = 'colour'; S.pat.palette = i; exampleOff(); syncControls(); render(); });
    host.append(b);
  });
}
function buildShapes() {
  const host = $('shapeGrid');
  for (const s of SDF_SHAPES) {
    const b = document.createElement('button');
    b.dataset.s = s; b.textContent = SHAPE_NAMES[s] || s;
    b.addEventListener('click', () => { S.src.kind = 'shape'; S.src.shape = s; exampleOff(); syncControls(); render(); });
    host.append(b);
  }
}
function buildSizes() {
  const host = $('sizes');
  for (const s of SIZES) {
    const b = document.createElement('button');
    b.dataset.z = s.id; b.textContent = s.name;
    b.addEventListener('click', () => { S.view.size = s.id; renderDims = null; syncControls(); layout(); render(); });
    host.append(b);
  }
}

// ── examples ───────────────────────────────────────────────────────────────
function buildExamples() {
  const grid = $('exGrid');
  grid.innerHTML = '';
  EXAMPLES.forEach((ex, i) => {
    const b = document.createElement('button');
    b.className = 'excard';
    const shot = document.createElement('span'); shot.className = 'shot';
    const c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
    c1.width = c2.width = 4; c1.height = c2.height = 2; c2.className = 'relief';
    c1.style.objectFit = c2.style.objectFit = 'cover';
    shot.append(c1, c2);
    const meta = document.createElement('span'); meta.className = 'meta';
    const t = document.createElement('b'); t.textContent = ex.title;
    const s = document.createElement('small'); s.textContent = ex.note;
    meta.append(t, s);
    b.append(shot, meta);
    b.addEventListener('click', () => loadExample(i));
    grid.append(b);
  });
  renderExampleThumbs();
}
async function renderExampleThumbs() {
  const cards = document.querySelectorAll('#exGrid .excard');
  for (let i = 0; i < EXAMPLES.length; i++) {
    const st = stateFromExample(EXAMPLES[i]);
    const pal = DOT_PALETTES[st.pat.palette];
    try {
      const r = await thumbW.call('render', { state: st, w: 480, h: 240, dpi: 64, colors: pal ? [pal.bg, ...pal.ink] : null });
      const [c1, c2] = cards[i].querySelectorAll('canvas');
      c1.width = r.stereo.w; c1.height = r.stereo.h; c1.getContext('2d').putImageData(new ImageData(r.stereo.data, r.stereo.w, r.stereo.h), 0, 0);
      c2.width = r.relief.w; c2.height = r.relief.h; c2.getContext('2d').putImageData(new ImageData(r.relief.data, r.relief.w, r.relief.h), 0, 0);
    } catch (e) { /* the card stays dark */ }
  }
}
function loadExample(i) {
  const keepView = { mode: S.view.mode, eyeSep: S.view.eyeSep, size: S.view.size };
  S = stateFromExample(EXAMPLES[i]);
  Object.assign(S.view, keepView);
  exampleOn = i;
  syncControls(); stopTurntable(); render();
  if (phone()) setSheet(false);
}

// ── uploads ────────────────────────────────────────────────────────────────
// A file to an Image { w, h, data } no larger than max px on a side.
async function readImageFile(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const d = g.getImageData(0, 0, w, h);
  return { w, h, data: d.data };
}
let uploadSeq = 0;
async function takeUpload(input, kind) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const img = await readImageFile(file, kind === 'image' ? 1024 : 1600);
    const ref = kind + '-' + (++uploadSeq);
    await stageW.call('upload', { ref, img, tile: kind === 'image' }, [img.data.buffer]);
    uploads[kind] = { ref, name: file.name.replace(/\.[a-z0-9]+$/i, '') };
    const drop = input.closest('.drop');
    drop.classList.add('has'); drop.querySelector('b').textContent = file.name;
    if (kind === 'image') { S.pat.kind = 'image'; S.pat.ref = ref; }
    else { S.src.kind = kind; S.src.ref = ref; }
    exampleOff(); syncControls(); stopTurntable(); render();
  } catch (e) { toast('That image could not be read.'); }
  input.value = '';
}

// ── turntable ──────────────────────────────────────────────────────────────
const turn = { on: false, gen: 0, frames: [], k: 0, timer: 0, paused: false };
let turnT = 0;
function startTurntable(delay = 0) {
  clearTimeout(turnT);
  if (delay) { turnT = setTimeout(() => startTurntable(0), delay); return; }
  if (S.src.kind !== 'model' || !renderDims) return;
  stopPlayback();
  turn.on = true; turn.paused = false; press($('turnBtn'), true); press($('dockTurn'), true);
  const gen = ++turn.gen, d = renderDims, n = S.view.frames;
  const f = turntableSize(d.w, d.h, n, TURN_BUDGET()), k = f.w / d.w;
  const st = cloneState(S);
  if (!d.file) st.view.dot = Math.max(1, S.view.dot * Math.round(d.scale * k));
  const frames = new Array(n);
  let made = 0;
  busy(true);
  caption('Making the turntable · 0 of ' + n);
  stageW.call('turntable', { state: st, w: f.w, h: f.h, dpi: d.dpi * k, n, colors: paletteColors() }, [], async p => {
    if (gen !== turn.gen) return;
    const img = new ImageData(p.frame.data, p.frame.w, p.frame.h);
    frames[p.k] = typeof createImageBitmap === 'function' ? await createImageBitmap(img) : img;
    made++;
    if (gen === turn.gen) caption('Making the turntable · ' + made + ' of ' + n);
  }).then(() => {
    if (gen !== turn.gen) return;
    const wait = () => { if (gen !== turn.gen) return; if (made < n) { setTimeout(wait, 30); return; } busy(false); caption(); turn.frames = frames; turn.k = 0; play(gen); };
    wait();
  }).catch(e => { if (gen === turn.gen) { busy(false); toast('The turntable failed: ' + e.message); stopTurntable(); } });
}
function play(gen) {
  const step = () => {
    if (gen !== turn.gen || !turn.on) return;
    if (!turn.paused && turn.frames.length) {
      const fr = turn.frames[turn.k % turn.frames.length];
      const w = fr.width, h = fr.height;
      if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
      const g = out.getContext('2d');
      if (fr instanceof ImageData) g.putImageData(fr, 0, 0); else g.drawImage(fr, 0, 0);
      turn.k++;
    }
    turn.timer = setTimeout(step, 1000 / Math.max(1, S.view.speed));
  };
  step();
}
function pauseTurntable() { turn.paused = true; }
function stopPlayback() {
  clearTimeout(turn.timer); turn.timer = 0;
  for (const f of turn.frames) if (f && f.close) f.close();
  turn.frames = [];
}
function stopTurntable() {
  clearTimeout(turnT);
  if (!turn.on) return;
  turn.on = false; turn.gen++;
  stopPlayback(); busy(false);
  press($('turnBtn'), false); press($('dockTurn'), false);
  if (stillImage) { out.width = stillImage.width; out.height = stillImage.height; out.getContext('2d').putImageData(stillImage, 0, 0); }
  caption();
}

// ── PNG and link ───────────────────────────────────────────────────────────
function slug(s) { return String(s).toLowerCase().replace(/[“”"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'stereogram'; }
function downloadPNG() {
  if (!stillImage) return;
  const c = document.createElement('canvas');
  c.width = stillImage.width; c.height = stillImage.height;
  c.getContext('2d').putImageData(stillImage, 0, 0);
  c.toBlob(b => {
    if (!b) { toast('The PNG could not be made.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'stereogram-' + slug(sourceName()) + '-' + slug(patternName()) + '.png';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(turn.on ? 'Saved the still picture as a PNG.' : 'Saved as a PNG.');
  }, 'image/png');
}
async function shareLink() {
  const code = encodeState(S);
  try { location.replace('#' + code); } catch (e) { /* sandboxed */ }
  let url = location.href;
  try {
    const P = window.parent;
    if (P && P !== window && P.snShare && P.location) url = P.snShare.url(P.location.hash);
  } catch (e) { /* another origin */ }
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { ok = false; }
  const lab = $('linkLab');
  lab.textContent = ok ? 'Copied' : 'Link';
  setTimeout(() => { lab.textContent = 'Link'; }, 1600);
  const up = S.src.kind === 'depth' || S.src.kind === 'photo' || S.pat.kind === 'image';
  toast(up ? 'Uploaded images stay on this device, so the link uses an object and a pattern in their place.' : ok ? 'The link is on the clipboard.' : 'The link is in the address bar.');
}

// ── help ───────────────────────────────────────────────────────────────────
let helpMode = 'wall', practiceAnswer = false, practiceImgs = null;
function openHelp() {
  const dlg = $('help');
  if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  helpMode = S.view.mode; practiceAnswer = false;
  syncHelp(); renderPractice();
}
function syncHelp() {
  segOn('helpMode', 'm', helpMode);
  $('stepsWall').hidden = helpMode !== 'wall'; $('stepsCross').hidden = helpMode !== 'cross';
  press($('practiceReveal'), practiceAnswer);
  $('practiceReveal').textContent = practiceAnswer ? 'Show the stereogram' : 'Show the answer';
}
async function renderPractice() {
  const c = $('practice'), r0 = c.getBoundingClientRect();
  const cssW = Math.max(240, r0.width || 480), scale = Math.min(2, DPR());
  const w = Math.round(cssW * scale), h = Math.round(w * 3 / 4);
  try {
    const r = await stageW.call('practice', { w, h, dpi: screenDpi(scale, phone()), mode: helpMode, dot: Math.max(1, Math.round(scale)) });
    practiceImgs = { stereo: new ImageData(r.stereo.data, r.stereo.w, r.stereo.h), relief: new ImageData(r.relief.data, r.relief.w, r.relief.h) };
    drawPractice();
  } catch (e) { /* the canvas stays dark */ }
}
function drawPractice() {
  if (!practiceImgs) return;
  const c = $('practice'), img = practiceAnswer ? practiceImgs.relief : practiceImgs.stereo;
  c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0);
}
function bindHelp() {
  document.querySelectorAll('#helpMode button').forEach(b => b.addEventListener('click', () => { helpMode = b.dataset.m; syncHelp(); renderPractice(); }));
  $('practiceReveal').addEventListener('click', () => { practiceAnswer = !practiceAnswer; syncHelp(); drawPractice(); });
  // A click on the backdrop (outside the dialog box) closes it.
  $('help').addEventListener('click', e => {
    const r = $('help').getBoundingClientRect();
    if (e.target === $('help') && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) $('help').close();
  });
}

// ── toast ──────────────────────────────────────────────────────────────────
let toastT = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800);
}

// ── panel and phone sheet ──────────────────────────────────────────────────
function setSheet(open) {
  const panel = $('panel');
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  press($('dockPanel'), open); $('dockPanel').setAttribute('aria-expanded', String(open));
  setTimeout(onResize, 320);
}
function bindSheet() {
  const panel = $('panel');
  const toggle = () => setSheet(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setSheet(false));
  setSheet(!phone());
  PHONE_Q.addEventListener('change', e => { setSheet(!e.matches); onResize(); });
  // The grip: a tap switches half and full height; a drag up gives full
  // height; a drag down gives half height, then closes.
  const grip = $('sheetGrip');
  let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setSheet(false); }
    setTimeout(layout, 320);
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

// ── resize ─────────────────────────────────────────────────────────────────
let resizeT = 0;
function onResize() {
  layout();
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (S.view.size !== 'fit' || !renderDims) return;
    const d = targetDims();
    if (Math.abs(d.w - renderDims.w) / renderDims.w > 0.08 || Math.abs(d.h - renderDims.h) / renderDims.h > 0.08) { renderDims = null; layout(); render(); }
  }, 260);
}

// ── boot ───────────────────────────────────────────────────────────────────
function boot() {
  const fromHash = decodeState(location.hash, KNOWN);
  if (fromHash) { S = fromHash; if (S.src.kind === 'model' && !S.src.id && MODELS[0]) pickModel(MODELS[0].id, false); }
  else if (EXAMPLES.length) { S = stateFromExample(EXAMPLES[0]); exampleOn = 0; }
  if (!S.pat.id && TILES[0]) S.pat.id = (TILES.find(t => t.family !== 'dots') || TILES[0]).id;
  buildShapes(); buildSizes(); buildDotPalettes(); buildTileFams(); buildPatterns(); buildModels(); buildExamples();
  bindSliders(); bindControls(); bindDrag(); bindHelp(); bindSheet();
  $('modelSearch').addEventListener('input', e => { modelQuery = e.target.value; buildModels(); });
  syncControls();
  print.classList.add('empty');
  layout(); render();
  addEventListener('resize', onResize);
  if (window.visualViewport) visualViewport.addEventListener('resize', onResize);
  // A drag hint shows once, after the first stereogram of an object.
  setTimeout(() => { if (S.src.kind === 'model') { $('dragHint').classList.add('on'); setTimeout(() => $('dragHint').classList.remove('on'), 3200); } }, 1800);
}
boot();
installSaver({ stopTurntable });
