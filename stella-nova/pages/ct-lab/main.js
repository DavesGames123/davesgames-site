// ============================================================================
//  CT LAB  ·  main.js — the page: presets, scan animation, panels, controls
// ----------------------------------------------------------------------------
//  The lab scans a 2D object and shows four panels: the object with the
//  turning gantry, the sinogram as it fills view by view, the reconstruction
//  as it grows, and the error (reconstruction minus object).
//
//  DATA PATH
//    params (lab/presets.js) -> buildPhantom, buildGeometry, simulate
//    (lab/scanner.js; GPU forward projection when WebGPU is present) ->
//    Session.advance(k) per frame (FBP as views arrive) -> at the end of the
//    scan: MAR (optional), then the iterative solver in lab/worker.js, then
//    the compare strip. A change of the filter or the algorithm reuses the
//    stored sinogram; a change of the window or colour map only redraws.
//
//  PAGE API  window.__ctlab, see LAB-API.md. This file does not write
//  window.snSaver; saver.js (the saver agent) adds that hook on top of the API.
//
//  GREP MAP
//    grep -n 'API'          window.__ctlab
//    grep -n 'function startScan\|function finishScan\|function reconstruct'
//    grep -n 'function frame'      the animation loop
//    grep -n 'function draw'       panel drawing (drawPhantom, drawSino, ...)
//    grep -n 'CONTROLS'            the control table and its binding
//    grep -n 'function layout'     panel grid sizing
//    grep -n 'DRAW'                draw-your-own and the picture upload
//    grep -n 'EXPORT'              PNG export
// ============================================================================

import { DEFAULTS, PRESETS, GROUPS, WINDOWS, presetById, paramsFor, workFor } from './lab/presets.js';
import { buildPhantom, buildGeometry, simulate, cpuForward, metalReduce, pasteMetal, Session, imageRange } from './lab/scanner.js';
import { runJob, compareTasks } from './lab/jobs.js';
import { windowRange, formatValue, paintImage, paintSigned, drawGantry, drawResidual, drawSheet, huOf } from './lab/view.js';
import { initGpu, gpuReady, gpuForward, gpuFBP, releaseGpu } from './lab/gpu-lab.js';
import { MATERIAL_CHOICES, DRAW_WIDTH, starterShapes, shapeFromDrag, hitShape, imageToPhantom } from './lab/draw.js';
import { FILTERS, rasterize2D, phantom2D, psnr, ssim } from './engine/index.js';
import * as CM from './colormaps/maps.js';
import { createPicker } from './colormaps/picker.js';

const $ = (id) => document.getElementById(id);
const DPR = () => Math.min(window.devicePixelRatio || 1, 2.5);
const phoneish = () => matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 520px)').matches;
const ALGO_NAMES = { fbp: 'FBP', art: 'ART', sart: 'SART', sirt: 'SIRT', cgls: 'CGLS' };
const FILTER_NAMES = { 'ram-lak': 'Ram-Lak', 'shepp-logan': 'Shepp-Logan', cosine: 'Cosine', hamming: 'Hamming', hann: 'Hann' };

// ---------- state ----------
const S = {
  params: { ...DEFAULTS },
  preset: 'shepp-logan',
  phantom: null, hu: false, truthRange: { lo: 0, hi: 1 },
  geom: null, scan: null, session: null, sinoMax: 1,
  phase: 'idle', playing: true, stopped: false,
  speed: 1, vps: 90, acc: 0,
  iter: 0, iters: 0, residuals: [], psnr: NaN, ssim: NaN,
  display: null,              // the image the recon panel shows (Image2D)
  previewRange: null,         // auto window of the plain back-projection preview
  gen: 0,                     // bumps on every rescan; stale async work checks it
  dirty: { phantom: true, sino: true, recon: true },
  cursor: null,               // { u, v } in 0..1 image coords, or null
  focus: null,
  custom: { shapes: starterShapes(), width: DRAW_WIDTH, upload: null },
  drawTool: 'disc', drawMat: 'bone', drag: null,
  phantomScale: 0.6,
  compare: { tiles: [], mode: '' },
};

// ---------- events ----------
const listeners = new Map();
function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}
function emit(name, detail) {
  for (const fn of listeners.get(name) ?? []) { try { fn(detail); } catch (e) { console.error(e); } }
}
function setPhase(p) {
  if (S.phase === p) return;
  S.phase = p;
  emit('phase', { phase: p });
  updateBar();
}

// ---------- worker jobs ----------
let iterWorker = null, cmpWorker = null;
const localTokens = new Set();   // jobs that run on the main thread
const localControl = { allowance: Infinity };   // iteration allowance when jobs run on the main thread
// Tell the iterative job to run freely, hold, or run k more iterations.
function iterControl(m) {
  if (iterWorker) { iterWorker.postMessage(m); return; }
  if (m.type === 'play') localControl.allowance = Infinity;
  else if (m.type === 'pause') localControl.allowance = 0;
  else if (m.type === 'allow') localControl.allowance = Math.max(0, localControl.allowance) + m.k;
}
function stopJobs() {
  if (iterWorker) { iterWorker.terminate(); iterWorker = null; }
  if (cmpWorker) { cmpWorker.terminate(); cmpWorker = null; }
  for (const t of localTokens) t.cancelled = true;
  localTokens.clear();
}
function startJob(msg, onMsg, slot) {
  let w = null;
  try { w = new Worker(new URL('./lab/worker.js', import.meta.url), { type: 'module' }); } catch (e) { w = null; }
  if (w) {
    w.onmessage = (e) => onMsg(e.data);
    w.onerror = () => {         // module workers can fail to start: run on the main thread
      w.terminate();
      if (slot === 'iter' && iterWorker === w) iterWorker = null;
      if (slot === 'cmp' && cmpWorker === w) cmpWorker = null;
      runLocal(msg, onMsg);
    };
    w.postMessage(msg);
    if (slot === 'iter') iterWorker = w; else cmpWorker = w;
    return;
  }
  runLocal(msg, onMsg);
}
function runLocal(msg, onMsg) {
  const tok = { cancelled: false };
  localTokens.add(tok);
  if (msg.type === 'iter') localControl.allowance = msg.paused ? 0 : Infinity;
  runJob(msg, onMsg, () => tok.cancelled, msg.type === 'iter' ? localControl : { allowance: Infinity });
}

// ---------- scan pipeline ----------
function lightN(n) { return phoneish() ? Math.min(n, 192) : n; }

function phantomKey(p) { return `${p.phantom}|${p.n}|${p.phantom === 'custom' ? S.custom.version || 0 : ''}`; }
let phantomCache = { key: '', ph: null };

function getPhantom(p) {
  const key = phantomKey(p);
  if (phantomCache.key === key) return phantomCache.ph;
  let ph;
  if (p.phantom === 'custom' && S.custom.upload) {
    const up = imageToPhantom(rasterUpload(S.custom.upload, p.n), p.n, DRAW_WIDTH);
    ph = buildPhantom(p, up);
  } else ph = buildPhantom(p, S.custom);
  phantomCache = { key, ph };
  return ph;
}

async function forwardFn(img, geom) {
  if (gpuReady()) { const r = await gpuForward(img, geom); if (r) return r; }
  return cpuForward(img, geom);
}

async function startScan(o = {}) {
  const gen = ++S.gen;
  stopJobs();
  const p = S.params;
  const ph = getPhantom(p);
  S.phantom = ph;
  S.hu = !String(ph.meta.units).startsWith('arb');
  S.truthRange = imageRange(ph.image);
  const geom = buildGeometry(p, ph.image);
  const scan = await simulate(ph, geom, p, forwardFn);
  if (gen !== S.gen) return;
  S.geom = geom; S.scan = scan;
  S.session = new Session({ phantom: ph, geom, scan, params: p });
  S.sinoMax = Math.max(1e-6, imageRange(scan.sino).hi);
  S.iter = 0; S.iters = p.algo === 'fbp' ? 0 : p.iters; S.residuals = []; S.psnr = NaN; S.ssim = NaN;
  S.display = S.session.recon; S.previewRange = null;
  S.vps = Math.max(6, geom.nAngles / 4);
  S.acc = 0;
  clearCompare();
  paintSinoBuffer();
  captions();
  markDirty();
  setPhase('scan');
  if (o.autoplay === false) S.playing = false;
  syncControls();
  if (o.instant) { S.session.advance(geom.nAngles); await finishScan(); }
  updateButtons();
}

// After the last view: MAR, then the iterative solver or the final FBP, then compare.
async function finishScan() {
  const gen = S.gen, ses = S.session, p = S.params;
  if (!ses) return;
  if (p.mar && p.algo === 'fbp') {
    setPhase('mar');
    await reconstruct(gen);
    if (gen !== S.gen) return;
  }
  if (p.algo !== 'fbp') { startIterative(); return; }
  finalMetrics();
  setPhase('done');
  emit('done', { psnr: S.psnr, ssim: S.ssim });
  startCompare();
}

// Full reconstruction from the stored sinogram (filter change, MAR). FBP only.
async function reconstruct(gen = S.gen) {
  const ses = S.session, p = S.params;
  ses.params = p;
  ses.sino = ses.raw;
  ses.prepare();
  await fullFBP(ses);
  if (p.mar) {
    const first = { ...ses.recon, data: Float32Array.from(ses.recon.data) };
    const m = metalReduce(ses.raw, ses.geom, first);
    if (m.metal) {
      ses.sino = m.sino; ses.prepare();
      await fullFBP(ses);
      pasteMetal(ses.recon, first, m.mask);
      S.marTrace = m.trace;
      paintSinoBuffer(ses.sino);
      toast(`MAR: ${m.metal} metal pixels, trace filled in every view`);
    } else toast('MAR: no metal above the threshold');
  }
  if (gen !== S.gen) return;
  S.display = ses.recon;
  markDirty();
}

async function fullFBP(ses) {
  if (gpuReady()) {
    const img = await gpuFBP(ses.q, ses.geom, ses.dims, ses.weights);
    if (img) { ses.recon.data.set(img.data); ses.view = ses.geom.nAngles; return; }
  }
  ses.fullFBP();
}

function startIterative() {
  const ses = S.session, p = S.params, gen = S.gen;
  setPhase('iterate');
  S.iter = 0; S.iters = p.iters; S.residuals = [];
  const img = { ...ses.dims, data: new Float32Array(ses.dims.nx * ses.dims.ny) };
  S.display = img; S.previewRange = null;
  markDirty();
  startJob({ type: 'iter', id: gen, method: p.algo, sino: ses.sino, geom: ses.geom, dims: ses.dims,
    truth: ses.truth, iterations: p.iters, relax: p.relax, tv: p.tv, paused: !S.playing }, (m) => {
    if (gen !== S.gen) return;
    if (m.type === 'iter') {
      img.data.set(m.image); S.iter = m.iter; S.residuals.push(m.residual); S.psnr = m.psnr;
      markDirty(); emit('iter', { iter: m.iter, iters: m.iters, residual: m.residual });
    } else if (m.type === 'done') {
      S.psnr = m.psnr; S.ssim = m.ssim;
      setPhase('done'); emit('done', { psnr: S.psnr, ssim: S.ssim });
      updateBar(); startCompare();
    } else if (m.type === 'error') toast('Solver error: ' + m.message);
  }, 'iter');
}

function finalMetrics() {
  const ses = S.session;
  S.psnr = psnr(ses.truth, S.display);
  S.ssim = ssim(ses.truth, S.display);
  updateBar();
}

// Recon parameters changed: keep the sinogram, rebuild the reconstruction.
async function rerecon() {
  const ses = S.session;
  if (!ses) return;
  stopJobs();
  const gen = ++S.gen;      // stale iterative messages stop here
  ses.params = S.params;
  S.iters = S.params.algo === 'fbp' ? 0 : S.params.iters;
  clearCompare();
  if (S.phase === 'scan') {
    const v = ses.view;
    ses.sino = ses.raw; ses.prepare(); ses.reset(); ses.advance(v);
    S.display = ses.recon; markDirty();
    return;
  }
  if (S.params.algo === 'fbp') {
    await reconstruct(gen);
    if (gen !== S.gen) return;
    finalMetrics(); setPhase('done'); emit('done', { psnr: S.psnr, ssim: S.ssim }); startCompare();
  } else {
    ses.sino = ses.raw; ses.prepare();
    startIterative();
  }
}

// ---------- compare strip ----------
function clearCompare() {
  S.compare = { tiles: [], mode: '' };
  $('compare').hidden = true;
  $('compareTiles').textContent = '';
}

function startCompare() {
  const mode = S.params.compare;
  if (!mode || !S.session) return;
  const ses = S.session, gen = S.gen, tasks = compareTasks(mode, S.params);
  S.compare = { tiles: [], mode };
  $('compare').hidden = false;
  $('compareTitle').textContent = mode === 'filters' ? 'The same data through five filters' : 'Four algorithms on the same few views';
  const host = $('compareTiles');
  host.textContent = '';
  const cells = tasks.map((t) => {
    const f = document.createElement('figure');
    const c = document.createElement('canvas');
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<b>${t.label}</b> <span>working…</span>`;
    f.append(c, cap); host.append(f);
    return { f, c, cap };
  });
  startJob({ type: 'compare', id: gen, tasks, sino: ses.raw, geom: ses.geom, dims: ses.dims, truth: ses.truth }, (m) => {
    if (gen !== S.gen) return;
    if (m.type === 'tile') {
      const cell = cells[m.index];
      S.compare.tiles[m.index] = { label: m.label, image: { ...ses.dims, data: m.image }, psnr: m.psnr, ssim: m.ssim };
      cell.cap.innerHTML = `<b>${m.label}</b> <span>PSNR ${m.psnr.toFixed(1)} dB · SSIM ${m.ssim.toFixed(2)}</span>`;
      drawTile(cell.c, S.compare.tiles[m.index].image);
    }
  }, 'cmp');
}

function drawTile(c, img) {
  const n = img.nx, size = Math.round(Math.min(220, c.clientWidth || 160) * DPR());
  c.width = size; c.height = size;
  const off = imgCanvas(n, n), w = curWindow();
  const id = off.ctx.createImageData(n, n);
  paintImage(img.data, w.lo, w.hi, id.data, S.params.cmap, cmapOpts());
  off.ctx.putImageData(id, 0, 0);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(off.c, 0, 0, size, size);
}

// ---------- display helpers ----------
function cmapOpts() { return { reverse: S.params.cmapReverse, gamma: S.params.cmapGamma }; }
function curWindow() { return windowRange(S.params.window, S.hu, S.truthRange); }

const offs = {};
function imgCanvas(w, h, key) {
  if (key && offs[key] && offs[key].c.width === w && offs[key].c.height === h) return offs[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const o = { c, ctx: c.getContext('2d'), id: null };
  if (key) offs[key] = o;
  return o;
}

function markDirty() { S.dirty.phantom = S.dirty.sino = S.dirty.recon = true; }

const panels = {
  phantom: $('cvPhantom'), sinogram: $('cvSino'), recon: $('cvRecon'), diff: $('cvDiff'),
};

function sizeCanvas(c) {
  const r = c.getBoundingClientRect(), d = DPR();
  const w = Math.max(16, Math.round(r.width * d)), h = Math.max(16, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w, h, d };
}

function paintSinoBuffer(sino = S.scan && S.scan.sino) {
  if (!sino) return;
  const o = imgCanvas(sino.nDet, sino.nAngles, 'sino');
  const id = o.ctx.createImageData(sino.nDet, sino.nAngles);
  paintImage(sino.data, 0, S.sinoMax, id.data, 'grey', { gamma: 0.85 });
  o.ctx.putImageData(id, 0, 0);
  S.dirty.sino = true;
}

// Image square inside a panel. s: fraction of the panel.
function imageBox(W, H, s) {
  const side = Math.min(W, H) * s;
  return { x: (W - side) / 2, y: (H - side) / 2, side };
}

function drawPhantom() {
  const c = panels.phantom, { w: W, h: H, d } = sizeCanvas(c), g = c.getContext('2d');
  const ph = S.phantom; if (!ph) return;
  g.fillStyle = '#04070b'; g.fillRect(0, 0, W, H);
  const n = ph.image.nx, o = imgCanvas(n, n, 'ph'), win = curWindow();
  if (S.dirty.phantomPaint !== false) {
    const id = o.ctx.createImageData(n, n);
    paintImage(ph.image.data, win.lo, win.hi, id.data, S.params.cmap, cmapOpts());
    o.ctx.putImageData(id, 0, 0);
  }
  const box = imageBox(W, H, S.phantomScale);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(o.c, box.x, box.y, box.side, box.side);
  const ses = S.session;
  const gantryAlpha = Math.max(0, Math.min(1, (1 - S.phantomScale) / 0.4));
  if (ses && gantryAlpha > 0.02) {
    const R = Math.min(W, H) * 0.485;
    const scale = box.side / ph.image.width;
    drawGantry(g, { cx: W / 2, cy: H / 2, R }, scale, ses.geom, Math.max(0, ses.view - 1), S.scan.sino, S.sinoMax, { alpha: gantryAlpha });
  }
  if (S.drag && S.drag.preview) drawShapeOutline(g, box, S.drag.preview);
  drawCursor(g, box, d);
}

function drawShapeOutline(g, box, s) {
  const k = box.side / S.custom.width;
  g.save();
  g.strokeStyle = '#ffd666'; g.setLineDash([6, 4]); g.lineWidth = 1.5 * DPR();
  g.beginPath();
  g.ellipse(box.x + box.side / 2 + s.x * k, box.y + box.side / 2 - s.y * k, s.a * k, s.b * k, -(s.phi || 0) * Math.PI / 180, 0, Math.PI * 2);
  g.stroke(); g.restore();
}

function drawCursor(g, box, d) {
  if (!S.cursor) return;
  const x = box.x + S.cursor.u * box.side, y = box.y + S.cursor.v * box.side;
  g.save();
  g.strokeStyle = 'rgba(255,214,102,0.85)'; g.lineWidth = 1 * d;
  const r = 7 * d;
  g.beginPath(); g.moveTo(x - 2.4 * r, y); g.lineTo(x - r, y); g.moveTo(x + r, y); g.lineTo(x + 2.4 * r, y);
  g.moveTo(x, y - 2.4 * r); g.lineTo(x, y - r); g.moveTo(x, y + r); g.lineTo(x, y + 2.4 * r); g.stroke();
  g.restore();
}

function drawSino() {
  const c = panels.sinogram, { w: W, h: H, d } = sizeCanvas(c), g = c.getContext('2d');
  g.fillStyle = '#04070b'; g.fillRect(0, 0, W, H);
  const ses = S.session; if (!ses || !offs.sino) return;
  const nA = ses.geom.nAngles, nD = ses.geom.nDet;
  const m = 26 * d, x0 = m, y0 = 8 * d, w = W - m - 8 * d, h = H - y0 - m;
  const shown = S.phase === 'scan' ? ses.view : nA;
  g.imageSmoothingEnabled = nA > h / 2; g.imageSmoothingQuality = 'high';
  if (shown > 0) g.drawImage(offs.sino.c, 0, 0, nD, shown, x0, y0, w, (h * shown) / nA);
  g.strokeStyle = 'rgba(150,180,210,0.25)'; g.lineWidth = d;
  g.strokeRect(x0 - 0.5, y0 - 0.5, w + 1, h + 1);
  if (S.phase === 'scan' && shown < nA) {
    const y = y0 + (h * shown) / nA;
    const gr = g.createLinearGradient(0, y - 18 * d, 0, y);
    gr.addColorStop(0, 'rgba(255,196,120,0)'); gr.addColorStop(1, 'rgba(255,196,120,0.35)');
    g.fillStyle = gr; g.fillRect(x0, y - 18 * d, w, 18 * d);
    g.fillStyle = 'rgba(255,214,150,0.95)'; g.fillRect(x0, y - d, w, 1.5 * d);
  }
  // axes
  g.fillStyle = '#7f8c99'; g.font = `${10.5 * d}px Inter, system-ui, sans-serif`;
  g.textBaseline = 'top'; g.textAlign = 'center';
  g.fillText('detector position →', x0 + w / 2, y0 + h + 7 * d);
  g.save(); g.translate(x0 - 16 * d, y0 + h / 2); g.rotate(-Math.PI / 2);
  const arc = Math.round(S.params.arc);
  g.fillText(`view angle 0° → ${arc}° ↓`, 0, 0); g.restore();
}

function reconPixels() {
  const img = S.display; if (!img) return null;
  return img;
}

function reconWindow() {
  if (S.session && S.session.preview && S.phase === 'scan') {
    const r = imageRange(S.display);
    return { lo: r.lo, hi: r.hi > r.lo ? r.hi : r.lo + 1 };
  }
  return curWindow();
}

function drawRecon() {
  const c = panels.recon, { w: W, h: H, d } = sizeCanvas(c), g = c.getContext('2d');
  g.fillStyle = '#04070b'; g.fillRect(0, 0, W, H);
  const img = reconPixels(); if (!img) return;
  const n = img.nx, o = imgCanvas(n, n, 'rc'), win = reconWindow();
  const id = o.id && o.id.width === n ? o.id : (o.id = o.ctx.createImageData(n, n));
  paintImage(img.data, win.lo, win.hi, id.data, S.params.cmap, cmapOpts());
  o.ctx.putImageData(id, 0, 0);
  const box = imageBox(W, H, 1);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(o.c, box.x, box.y, box.side, box.side);
  // label
  let label = '';
  if (S.phase === 'scan') label = S.session && S.session.preview ? 'plain back-projection (no filter) while views arrive' : `FBP, ${S.session ? S.session.view : 0} views so far`;
  else if (S.phase === 'iterate') label = `${ALGO_NAMES[S.params.algo]} iteration ${S.iter} of ${S.iters}`;
  if (label) {
    g.font = `${11 * d}px Inter, system-ui, sans-serif`; g.textBaseline = 'top'; g.textAlign = 'left';
    const tw = g.measureText(label).width;
    g.fillStyle = 'rgba(4,7,11,0.7)'; g.fillRect(8 * d, 8 * d, tw + 12 * d, 20 * d);
    g.fillStyle = '#cfe6ff'; g.fillText(label, 14 * d, 12 * d);
  }
  drawCursor(g, box, d);
}

let diffTmp = null;
function drawDiff() {
  const c = panels.diff, { w: W, h: H, d } = sizeCanvas(c), g = c.getContext('2d');
  g.fillStyle = '#04070b'; g.fillRect(0, 0, W, H);
  const img = reconPixels(), ph = S.phantom; if (!img || !ph || img.nx !== ph.image.nx) return;
  const n = img.nx, o = imgCanvas(n, n, 'df'), win = curWindow();
  const id = o.id && o.id.width === n ? o.id : (o.id = o.ctx.createImageData(n, n));
  const span = 0.25 * (win.hi - win.lo);
  diffTmp = paintSigned(img.data, ph.image.data, span, id.data, S.params.diffMap, diffTmp);
  o.ctx.putImageData(id, 0, 0);
  const box = imageBox(W, H, 1);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(o.c, box.x, box.y, box.side, box.side);
  // legend
  const lw = Math.min(140 * d, W * 0.4), lh = 6 * d, lx = W - lw - 10 * d, ly = H - 22 * d;
  g.fillStyle = CM.toCanvasGradient(g, S.params.diffMap, lx, 0, lx + lw, 0);
  g.fillRect(lx, ly, lw, lh);
  g.fillStyle = '#9aa7b4'; g.font = `${10 * d}px Inter, system-ui, sans-serif`; g.textBaseline = 'top';
  const lab = S.hu ? `±${Math.round(span / (huOf(1) - huOf(0)))} HU` : `±${span.toPrecision(2)}`;
  g.textAlign = 'right'; g.fillText(lab, lx + lw, ly + lh + 2 * d);
  drawCursor(g, box, d);
}

function drawAll() {
  if (S.dirty.phantom) drawPhantom();
  if (S.dirty.sino) drawSino();
  if (S.dirty.recon) { drawRecon(); drawDiff(); }
  S.dirty.phantom = S.dirty.sino = S.dirty.recon = false;
}

// ---------- status bar ----------
const PHASE_TEXT = { idle: 'Ready', scan: 'Scanning', mar: 'Metal artefact reduction', iterate: 'Iterating', done: 'Done' };
function updateBar() {
  const ses = S.session;
  let t = PHASE_TEXT[S.phase] ?? S.phase;
  let frac = 0;
  if (ses) {
    if (S.phase === 'scan') { t += ` · view ${ses.view} of ${ses.views}`; frac = ses.view / ses.views; }
    else if (S.phase === 'iterate') { frac = S.iters ? S.iter / S.iters : 0; }
    else frac = 1;
  }
  if (!S.playing && S.phase !== 'done') t += ' (paused)';
  $('phase').textContent = t;
  $('prog').firstElementChild.style.width = `${(100 * frac).toFixed(1)}%`;
  $('mPsnr').textContent = Number.isFinite(S.psnr) ? `${S.psnr.toFixed(1)} dB` : '-';
  $('mSsim').textContent = Number.isFinite(S.ssim) ? S.ssim.toFixed(3) : '-';
  const rc = $('resid');
  const iterTxt = $('iterTxt');
  if (S.iters) {
    rc.hidden = false;
    const d = DPR(), cw = Math.round(rc.clientWidth * d) || 160, ch = Math.round(rc.clientHeight * d) || 40;
    if (rc.width !== cw || rc.height !== ch) { rc.width = cw; rc.height = ch; }
    const g = rc.getContext('2d');
    g.clearRect(0, 0, cw, ch);
    drawResidual(g, 0, 0, cw, ch, S.residuals, S.iters, { lineWidth: 1.5 * d });
    const r = S.residuals[S.residuals.length - 1];
    iterTxt.textContent = `${ALGO_NAMES[S.params.algo]} ${S.iter}/${S.iters}` + (r !== undefined ? ` · ‖b−Ax‖ ${r.toPrecision(3)}` : '');
  } else { rc.hidden = true; iterTxt.textContent = `FBP · ${FILTER_NAMES[S.params.filter]} filter`; }
}

function captions() {
  const p = S.params, ph = S.phantom, g = S.geom;
  if (!ph || !g) return;
  const beam = { parallel: 'parallel beam', 'fan-flat': 'fan beam, flat detector', 'fan-arc': 'fan beam, curved detector' }[p.beam];
  $('capPhantom').textContent = `${ph.meta.label} · ${ph.meta.width} ${ph.meta.units === 'arbitrary' ? 'units' : 'cm'} · ${p.n}²`;
  const phys = [];
  if (p.dose > 0) phys.push(`I₀ ${fmtDose(p.dose)}`);
  if (p.poly) phys.push(`${p.kVp} kVp`);
  if (p.motion > 0) phys.push('motion');
  if (p.deadPixels) phys.push(`${p.deadPixels} dead`);
  $('capSino').textContent = `${g.nAngles} views × ${g.nDet} · ${beam}${phys.length ? ' · ' + phys.join(', ') : ''}`;
  $('capRecon').textContent = p.algo === 'fbp' ? `FBP, ${FILTER_NAMES[p.filter]}${p.cutoff < 1 ? ` ${p.cutoff.toFixed(2)}` : ''}${p.mar ? ' + MAR' : ''}` : `${ALGO_NAMES[p.algo]}${p.tv > 0 ? ' + TV' : ''}`;
}

function fmtDose(v) {
  if (!v) return 'off';
  const e = Math.floor(Math.log10(v)), m = v / 10 ** e;
  return `${m >= 9.95 ? 10 : Math.round(m * 10) / 10}×10^${e}`.replace('1×10^', '10^').replace(/\^(\d+)/, (_, x) => x.split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join(''));
}

// ---------- the frame loop ----------
let last = 0, rafId = 0;
function frame(t) {
  rafId = requestAnimationFrame(frame);
  if (S.stopped) return;
  const dt = Math.min(0.1, last ? (t - last) / 1000 : 0.016);
  last = t;
  const ses = S.session;
  // the gantry fades out and the object grows when the scan ends
  const target = S.phase === 'scan' && !S.drawMode ? 0.6 : 1;
  if (Math.abs(S.phantomScale - target) > 0.002) { S.phantomScale += (target - S.phantomScale) * Math.min(1, dt * 5); S.dirty.phantom = true; }
  if (ses && S.phase === 'scan' && S.playing) {
    S.acc += dt * S.vps * S.speed;
    const k = Math.floor(S.acc);
    if (k > 0) { S.acc -= k; advanceViews(k); }
  }
  drawAll();
}

function advanceViews(k) {
  const ses = S.session;
  if (!ses || S.phase !== 'scan') return;
  ses.advance(k);
  if (!ses.preview) S.psnr = psnr(ses.truth, ses.recon);
  markDirty();
  emit('view', { view: ses.view, views: ses.views, angle: ses.angle() });
  updateBar();
  if (ses.done) finishScan();
}

// ---------- parameters ----------
async function setParams(partial, o = {}) {
  const prev = S.params;
  const next = { ...prev, ...partial };
  if (partial.n !== undefined) next.n = Math.max(64, Math.min(512, partial.n | 0));
  S.params = next;
  const work = o.force ?? workFor(prev, next);
  syncControls();
  if (work === 'scan') await startScan({ autoplay: o.run !== false && S.playing !== false ? undefined : false });
  else if (work === 'recon') { captions(); await rerecon(); }
  else { paintSinoBuffer(S.session && S.session.sino); markDirty(); drawCompareTiles(); }
  captions(); updateBar();
}

function drawCompareTiles() {
  const cells = $('compareTiles').querySelectorAll('canvas');
  S.compare.tiles.forEach((t, i) => { if (t && cells[i]) drawTile(cells[i], t.image); });
}

async function loadPreset(id, o = {}) {
  const pr = presetById(id);
  S.preset = pr.id;
  const p = paramsFor(pr.id);
  p.n = lightN(p.n);
  S.params = p;
  S.playing = o.autoplay !== false;
  S.stopped = false;
  $('presetTitle').textContent = pr.label;
  $('blurb').textContent = pr.blurb;
  document.querySelectorAll('#presetList button').forEach((b) => b.classList.toggle('on', b.dataset.id === pr.id));
  setDrawMode(p.phantom === 'custom');
  syncControls();
  if (cmapPicker) cmapPicker.set({ id: p.cmap, reverse: p.cmapReverse, gamma: p.cmapGamma }, { silent: true });
  await startScan({ autoplay: o.autoplay });
  emit('preset', { id: pr.id });
}

// ---------- CONTROLS ----------
const DOSE_STEPS = [0, 1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7];
const CONTROLS = [
  { title: 'Scan', items: [
    { key: 'phantom', label: 'Object', type: 'select', options: () => [...PHANTOM_OPTIONS] },
    { key: 'beam', label: 'Beam', type: 'select', options: [['parallel', 'Parallel'], ['fan-flat', 'Fan, flat detector'], ['fan-arc', 'Fan, curved detector']] },
    { key: 'views', label: 'Views', type: 'range', min: 4, max: 720, step: 1, fmt: (v) => `${v}` },
    { key: 'arc', label: 'Arc', type: 'range', min: 30, max: 360, step: 5, fmt: (v) => `${v}°` },
    { key: 'detectors', label: 'Detectors', type: 'select', options: [[0, 'Fit'], [64, '64'], [128, '128'], [192, '192'], [256, '256'], [384, '384'], [512, '512']], num: true },
    { key: 'n', label: 'Image size', type: 'select', options: [[96, '96²'], [128, '128²'], [192, '192²'], [256, '256²'], [384, '384²'], [512, '512²']], num: true },
  ] },
  { title: 'Physics', items: [
    { key: 'dose', label: 'Photons per ray', type: 'steps', steps: DOSE_STEPS, fmt: (v) => (v ? fmtDose(v) : 'no noise') },
    { key: 'poly', label: 'Real tube spectrum', type: 'check', hint: 'beam hardening' },
    { key: 'kVp', label: 'Tube voltage', type: 'range', min: 60, max: 150, step: 10, fmt: (v) => `${v} kVp` },
    { key: 'motion', label: 'Motion', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => (v ? `${(v * 10).toFixed(1)} mm` : 'still') },
    { key: 'deadPixels', label: 'Dead pixels', type: 'range', min: 0, max: 8, step: 1, fmt: (v) => `${v}` },
    { key: 'gain', label: 'Gain spread', type: 'range', min: 0, max: 0.02, step: 0.001, fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { key: 'mar', label: 'Metal artefact reduction', type: 'check', hint: 'sinogram inpainting' },
  ] },
  { title: 'Reconstruction', items: [
    { key: 'algo', label: 'Algorithm', type: 'select', options: [['fbp', 'FBP (filtered back-projection)'], ['art', 'ART (Kaczmarz)'], ['sart', 'SART'], ['sirt', 'SIRT'], ['cgls', 'CGLS']] },
    { key: 'filter', label: 'Filter', type: 'select', options: FILTERS.map((f) => [f, FILTER_NAMES[f]]), show: (p) => p.algo === 'fbp' },
    { key: 'cutoff', label: 'Cutoff', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}% Nyquist`, show: (p) => p.algo === 'fbp' },
    { key: 'iters', label: 'Iterations', type: 'range', min: 1, max: 300, step: 1, fmt: (v) => `${v}`, show: (p) => p.algo !== 'fbp' },
    { key: 'relax', label: 'Relaxation', type: 'range', min: 0, max: 1.9, step: 0.05, fmt: (v) => (v ? v.toFixed(2) : 'default'), show: (p) => p.algo !== 'fbp' && p.algo !== 'cgls' },
    { key: 'tv', label: 'Total variation', type: 'range', min: 0, max: 0.08, step: 0.005, fmt: (v) => (v ? v.toFixed(3) : 'off'), show: (p) => p.algo !== 'fbp' && p.algo !== 'cgls' },
    { key: 'compare', label: 'Compare strip', type: 'select', options: [['', 'Off'], ['filters', 'Five filters'], ['algorithms', 'Four algorithms']] },
  ] },
  { title: 'Display', items: [
    { key: 'window', label: 'Window', type: 'select', options: () => WINDOWS.filter((w) => w.auto || w.hu === S.hu).map((w) => [w.id, w.auto ? w.label : `${w.label} (${w.level}/${w.width})`]).concat(typeof S.params.window === 'object' ? [['custom', 'Custom']] : []) },
    { key: 'wl', label: 'Level', type: 'wl', which: 'level' },
    { key: 'ww', label: 'Width', type: 'wl', which: 'width' },
    { key: 'diffMap', label: 'Error map', type: 'select', options: () => CM.list('diverging').map((m) => [m.id, m.name]) },
    { key: 'speed', label: 'Scan speed', type: 'speed' },
  ] },
];
const PHANTOM_OPTIONS = [
  ['shepp-logan-modified', 'Shepp-Logan'], ['shepp-logan', 'Shepp-Logan (low contrast)'], ['head', 'Head'], ['chest', 'Chest'],
  ['suitcase', 'Suitcase'], ['bars', 'Resolution bars'], ['contrast-detail', 'Contrast-detail'], ['walnut', 'Walnut'],
  ['metal-implant', 'Hip implant'], ['custom', 'Your own'],
];

const ctlEls = new Map();
function buildControls() {
  const host = $('controls');
  for (const sec of CONTROLS) {
    const s = document.createElement('section'); s.className = 'ctl';
    const h = document.createElement('h3'); h.textContent = sec.title; s.append(h);
    for (const it of sec.items) {
      const row = document.createElement('label'); row.className = 'row';
      const name = document.createElement('span'); name.textContent = it.label;
      row.append(name);
      let input, out = null;
      if (it.type === 'select') {
        input = document.createElement('select');
        input.addEventListener('change', () => {
          let v = it.num ? +input.value : input.value;
          if (it.key === 'window') { setParams({ window: v }); return; }
          if (it.key === 'phantom') setDrawMode(v === 'custom');
          // a fan beam needs a full turn for direct FBP; parallel needs half a turn
          if (it.key === 'beam') { setParams({ beam: v, arc: v === 'parallel' ? 180 : 360 }); return; }
          setParams({ [it.key]: v });
        });
      } else if (it.type === 'check') {
        input = document.createElement('input'); input.type = 'checkbox';
        if (it.hint) { const hn = document.createElement('em'); hn.textContent = it.hint; name.append(hn); }
        input.addEventListener('change', () => setParams({ [it.key]: input.checked }));
        row.classList.add('check');
      } else {
        input = document.createElement('input'); input.type = 'range';
        out = document.createElement('output');
        if (it.type === 'range') { input.min = it.min; input.max = it.max; input.step = it.step; }
        if (it.type === 'steps') { input.min = 0; input.max = it.steps.length - 1; input.step = 1; }
        if (it.type === 'speed') { input.min = -2; input.max = 2; input.step = 0.25; }
        if (it.type === 'wl') { input.min = 0; input.max = 1000; input.step = 1; }
        const commit = () => {
          const v = readRange(it, input);
          if (it.type === 'speed') { S.speed = v; syncControls(); return; }
          if (it.type === 'wl') {
            const w = curWindow();
            const lw = { level: w.level, width: w.width }; lw[it.which] = v;
            setParams({ window: lw }); return;
          }
          setParams({ [it.key]: v });
        };
        input.addEventListener('input', () => {
          if (out) out.textContent = fmtRange(it, readRange(it, input));
          if (it.type === 'wl' || it.type === 'speed') commit();
        });
        if (it.type !== 'wl' && it.type !== 'speed') input.addEventListener('change', commit);
        row.append(out);
      }
      row.append(input);
      s.append(row);
      ctlEls.set(it.key, { it, input, out, row });
    }
    host.append(s);
  }
}

// Level and width sliders span a range that suits the phantom units.
function wlRange(which) {
  if (S.hu) return which === 'level' ? [-1000, 3000] : [1, 4000];
  const r = S.truthRange, span = r.hi - Math.min(0, r.lo);
  return which === 'level' ? [Math.min(0, r.lo), r.hi] : [span / 500, span * 1.5];
}
function readRange(it, input) {
  const v = +input.value;
  if (it.type === 'steps') return it.steps[v];
  if (it.type === 'speed') return 2 ** v;
  if (it.type === 'wl') { const [a, b] = wlRange(it.which); return a + ((b - a) * v) / 1000; }
  return v;
}
function fmtRange(it, v) {
  if (it.type === 'speed') return `${v.toFixed(2).replace(/\.?0+$/, '')}×`;
  if (it.type === 'wl') return S.hu ? `${Math.round(v)} HU` : v.toPrecision(3);
  return it.fmt ? it.fmt(v) : String(v);
}

function syncControls() {
  const p = S.params;
  for (const [key, { it, input, out, row }] of ctlEls) {
    if (it.show) row.hidden = !it.show(p);
    if (it.type === 'select') {
      const opts = typeof it.options === 'function' ? it.options() : it.options;
      const sig = opts.map((o) => o[0]).join('|');
      if (input.dataset.sig !== sig) {
        input.textContent = '';
        for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; input.append(o); }
        input.dataset.sig = sig;
      }
      let v = p[key];
      if (key === 'window') v = typeof v === 'object' ? 'custom' : v;
      input.value = String(v);
    } else if (it.type === 'check') input.checked = !!p[key];
    else {
      let v, pos;
      if (it.type === 'steps') { v = p[key]; pos = Math.max(0, it.steps.findIndex((s) => s >= v)); if (v > it.steps[it.steps.length - 1]) pos = it.steps.length - 1; }
      else if (it.type === 'speed') { v = S.speed; pos = Math.log2(v); }
      else if (it.type === 'wl') {
        const w = curWindow(); v = w[it.which];
        const [a, b] = wlRange(it.which); pos = Math.round(((v - a) / (b - a)) * 1000);
      } else { v = p[key]; pos = v; }
      if (document.activeElement !== input) input.value = String(pos);
      if (out) out.textContent = fmtRange(it, v);
    }
  }
  $('backend').textContent = gpuReady() ? 'WebGPU' : 'CPU';
  $('backend').classList.toggle('gpu', gpuReady());
}

// ---------- gallery ----------
function buildGallery() {
  const host = $('presetList');
  for (const [gid, gname] of GROUPS) {
    const items = PRESETS.filter((p) => p.group === gid);
    if (!items.length) continue;
    const h = document.createElement('h3'); h.textContent = gname; host.append(h);
    const ul = document.createElement('div'); ul.className = 'plist';
    for (const pr of items) {
      const b = document.createElement('button');
      b.dataset.id = pr.id; b.title = pr.blurb;
      const th = document.createElement('canvas'); th.width = 56; th.height = 56; th.className = 'thumb';
      const sp = document.createElement('span'); sp.textContent = pr.label;
      b.append(th, sp);
      b.addEventListener('click', () => {
        history.replaceState(null, '', `#preset=${pr.id}`);
        loadPreset(pr.id);
        if (phoneish()) closeSheets();
      });
      ul.append(b);
    }
    host.append(ul);
  }
  thumbQueue();
}

// Thumbnails: each preset's object, drawn small, one per idle slot.
function thumbQueue() {
  const btns = [...document.querySelectorAll('#presetList button')];
  const cache = new Map();
  let k = 0;
  const next = () => {
    if (k >= btns.length) return;
    const b = btns[k++], pr = presetById(b.dataset.id), p = paramsFor(pr.id);
    try {
      const key = p.phantom;
      let img = cache.get(key);
      if (!img) {
        img = key === 'custom' ? rasterize2D(starterShapes(), 56, DRAW_WIDTH, { supersample: 2 }).image : phantom2D(key, 56, { supersample: 2 }).image;
        cache.set(key, img);
      }
      const hu = key !== 'custom' && !key.startsWith('shepp') ? true : key === 'custom';
      const w = windowRange(p.window, hu, imageRange(img));
      const c = b.querySelector('canvas'), g = c.getContext('2d'), id = g.createImageData(56, 56);
      paintImage(img.data, w.lo, w.hi, id.data, p.cmap);
      g.putImageData(id, 0, 0);
    } catch (e) { /* a thumbnail is optional */ }
    (window.requestIdleCallback || ((f) => setTimeout(f, 30)))(next);
  };
  next();
}

// ---------- DRAW ----------
function setDrawMode(on) {
  S.drawMode = on;
  $('drawBox').hidden = !on;
  document.body.classList.toggle('drawing', on);
}

function buildDraw() {
  const sel = $('drawMat');
  for (const [v, l] of MATERIAL_CHOICES) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); }
  sel.value = S.drawMat;
  sel.addEventListener('change', () => { S.drawMat = sel.value; });
  $('drawTool').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.drawTool = b.dataset.tool;
    $('drawTool').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  const changed = () => { S.custom.version = (S.custom.version || 0) + 1; setParams({ phantom: 'custom' }, { force: 'scan' }); };
  $('drawUndo').addEventListener('click', () => { if (S.custom.upload) S.custom.upload = null; else S.custom.shapes.pop(); changed(); });
  $('drawClear').addEventListener('click', () => { S.custom.upload = null; S.custom.shapes = [{ t: 'e', x: 0, y: 0, a: 8.6, b: 7.2, phi: 0, mat: 'water' }]; changed(); });
  $('drawStarter').addEventListener('click', () => { S.custom.upload = null; S.custom.shapes = starterShapes(); changed(); });
  $('upload').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      S.custom.upload = bmp; changed();
      toast('Picture loaded: brightness becomes attenuation, white = bone');
    } catch (err) { toast('Could not read that picture'); }
    e.target.value = '';
  });
  const cv = panels.phantom;
  const world = (e) => {
    const r = cv.getBoundingClientRect(), box = imageBox(r.width, r.height, S.phantomScale);
    const u = (e.clientX - r.left - box.x) / box.side, v = (e.clientY - r.top - box.y) / box.side;
    return { u, v, x: (u - 0.5) * S.custom.width, y: (0.5 - v) * S.custom.width };
  };
  cv.addEventListener('pointerdown', (e) => {
    if (!S.drawMode || S.custom.upload) return;
    const w = world(e);
    if (S.drawTool === 'erase') {
      const k = hitShape(S.custom.shapes, w.x, w.y);
      if (k > 0) { S.custom.shapes.splice(k, 1); changed(); }
      return;
    }
    cv.setPointerCapture(e.pointerId);
    S.drag = { x0: w.x, y0: w.y, preview: null };
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    const w = world(e);
    S.drag.preview = shapeFromDrag(S.drawTool, S.drag.x0, S.drag.y0, w.x, w.y, S.drawMat);
    S.dirty.phantom = true;
  });
  const end = (e) => {
    if (!S.drag) return;
    const w = world(e);
    const s = shapeFromDrag(S.drawTool, S.drag.x0, S.drag.y0, w.x, w.y, S.drawMat);
    S.drag = null; S.dirty.phantom = true;
    S.custom.shapes.push(s); changed();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', () => { S.drag = null; S.dirty.phantom = true; });
}

// Fit a picture into an n x n square (cover), centred, and read its pixels.
function rasterUpload(bmp, n) {
  const c = document.createElement('canvas'); c.width = n; c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
  const s = Math.max(n / bmp.width, n / bmp.height);
  g.drawImage(bmp, (n - bmp.width * s) / 2, (n - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  return g.getImageData(0, 0, n, n).data;
}

// ---------- cursor readout ----------
function bindReadout() {
  const sources = [['phantom', () => S.phantomScale], ['recon', () => 1], ['diff', () => 1]];
  for (const [name, sc] of sources) {
    const cv = panels[name];
    cv.addEventListener('pointermove', (e) => {
      if (S.drag) return;
      const r = cv.getBoundingClientRect(), box = imageBox(r.width, r.height, sc());
      const u = (e.clientX - r.left - box.x) / box.side, v = (e.clientY - r.top - box.y) / box.side;
      S.cursor = u >= 0 && u < 1 && v >= 0 && v < 1 ? { u, v } : null;
      readout(); markDirty();
    });
    cv.addEventListener('pointerleave', () => { S.cursor = null; readout(); markDirty(); });
  }
}
function readout() {
  const el = $('hu');
  if (!S.cursor || !S.phantom || !S.display) { el.textContent = 'Point at an image to read values'; return; }
  const n = S.phantom.image.nx, ix = Math.min(n - 1, Math.floor(S.cursor.u * n)), iy = Math.min(n - 1, Math.floor(S.cursor.v * n));
  const k = iy * n + ix, a = S.phantom.image.data[k], b = S.display.data[k];
  const px = S.phantom.image.width / n;
  const x = (ix + 0.5) * px - n * px / 2, y = n * px / 2 - (iy + 0.5) * px;
  const unit = S.hu ? 'cm' : '';
  el.innerHTML = `<span>(${x.toFixed(1)}, ${y.toFixed(1)}) ${unit}</span> <span>object <b>${formatValue(a, S.hu)}</b></span> <span>image <b>${formatValue(b, S.hu)}</b></span>` +
    `<span>error <b>${S.hu ? Math.round(huOf(b) - huOf(a)) + ' HU' : (b - a).toFixed(3)}</b></span>`;
}

// ---------- EXPORT ----------
function download(canvas, name) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}
function snapshot() {
  drawAll();
  const pr = presetById(S.preset);
  return drawSheet(document, [
    { canvas: panels.phantom, label: 'Object' }, { canvas: panels.sinogram, label: 'Sinogram' },
    { canvas: panels.recon, label: 'Reconstruction' }, { canvas: panels.diff, label: 'Error' },
  ], `CT lab: ${pr.label}`, `${$('capSino').textContent} · ${$('capRecon').textContent} · PSNR ${$('mPsnr').textContent}, SSIM ${$('mSsim').textContent}`);
}
function bindExport() {
  document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.export;
    if (k === 'sheet') download(snapshot(), `ct-lab-${S.preset}.png`);
    else { drawAll(); download(panels[k], `ct-lab-${S.preset}-${k}.png`); }
  }));
}

// ---------- layout ----------
// Pick 4, 2 or 1 columns to make the panels as large as the stage allows.
function layout() {
  const st = $('stage'), grid = $('panels');
  const r = st.getBoundingClientRect();
  const bare = document.documentElement.classList.contains('ct-bare') || document.documentElement.classList.contains('sn-saver');
  const W = r.width - 2 * 12, barH = bare ? 24 : 150;
  const H = Math.max(240, window.innerHeight - r.top - barH);
  let best = { cols: 2, cell: 0 };
  for (const cols of S.focus ? [1] : [4, 2, 1]) {
    const rows = 4 / cols;
    const cell = Math.min((W - (cols - 1) * 10) / cols, phoneish() ? 1e9 : (H - (rows - 1) * 10) / rows);
    if (cell > best.cell + 1 || (phoneish() && cols === 2)) best = { cols, cell };
    if (phoneish() && cols === 2) break;
  }
  if (S.focus) best = { cols: 1, cell: Math.min(W, H) };
  grid.style.setProperty('--cols', best.cols);
  grid.style.setProperty('--cell', `${Math.max(120, Math.floor(best.cell))}px`);
  markDirty();
}

// ---------- phone sheets ----------
function closeSheets() { $('gallery').classList.remove('open'); $('panel').classList.remove('open'); syncDock(); }
function toggleSheet(id) {
  const el = $(id), open = !el.classList.contains('open');
  closeSheets();
  if (open) el.classList.add('open');
  syncDock();
}
function syncDock() {
  $('dockGallery').classList.toggle('on', $('gallery').classList.contains('open'));
  $('dockPanel').classList.toggle('on', $('panel').classList.contains('open'));
}
function bindSheets() {
  $('dockGallery').addEventListener('click', () => toggleSheet('gallery'));
  $('dockPanel').addEventListener('click', () => toggleSheet('panel'));
  $('dockPlay').addEventListener('click', () => togglePlay());
  $('dockStep').addEventListener('click', () => api.step(S.phase === 'scan' ? Math.max(1, Math.round(S.session.views / 36)) : 1));
  $('dockWin').addEventListener('click', () => {
    const list = WINDOWS.filter((w) => w.auto || w.hu === S.hu);
    const cur = typeof S.params.window === 'string' ? S.params.window : 'custom';
    const i = list.findIndex((w) => w.id === cur);
    const w = list[(i + 1) % list.length];
    setParams({ window: w.id });
    toast(`Window: ${w.label}`);
  });
  for (const id of ['gallery', 'panel']) {
    const el = $(id), grip = el.querySelector('.sheet-grip');
    let y0 = null;
    grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      if (dy > 40) closeSheets(); else if (Math.abs(dy) < 8) el.classList.toggle('full');
      else if (dy < -40) el.classList.add('full');
    });
  }
}

// ---------- play controls ----------
function updateButtons() {
  const t = S.playing && !S.stopped ? 'Pause' : 'Play';
  $('btnPlay').textContent = t;
  $('dockPlay').textContent = S.playing && !S.stopped ? '❚❚' : '▶';
  updateBar();
}
function togglePlay() { if (S.playing && !S.stopped) api.pause(); else api.play(); }

let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- API ----------
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });
const api = {
  version: 1,
  ready,
  get backend() { return gpuReady() ? 'gpu' : 'cpu'; },
  presets: () => PRESETS.map(({ id, label, group, blurb }) => ({ id, label, group, blurb })),
  async load(id, o = {}) { await ready; history.replaceState(null, '', `#preset=${presetById(id).id}`); await loadPreset(id, o); },
  params: () => ({ ...S.params }),
  async set(partial, o = {}) { await ready; await setParams(partial, o); },
  play() {
    S.stopped = false; S.playing = true;
    if (!rafId) rafId = requestAnimationFrame(frame);
    if (S.phase === 'iterate') iterControl({ type: 'play' });
    updateButtons();
  },
  pause() { S.playing = false; if (S.phase === 'iterate') iterControl({ type: 'pause' }); updateButtons(); },
  run() { S.stopped = false; S.playing = true; updateButtons(); return startScan(); },
  step(k = 1) {
    S.playing = false;
    if (S.phase === 'scan') advanceViews(Math.max(1, k | 0));
    else if (S.phase === 'iterate') { iterControl({ type: 'pause' }); iterControl({ type: 'allow', k: Math.max(1, k | 0) }); }
    updateButtons();
    return api.state();
  },
  stop() { S.stopped = true; S.playing = false; stopJobs(); S.gen++; updateButtons(); },
  setSpeed(vps) { if (S.session) S.speed = Math.max(0.05, vps / S.vps); syncControls(); },
  state() {
    const ses = S.session;
    return {
      preset: S.preset, phase: S.phase, view: ses ? ses.view : 0, views: ses ? ses.views : 0,
      angle: ses ? ses.angle() : 0, iter: S.iter, iters: S.iters, residuals: [...S.residuals],
      psnr: S.psnr, ssim: S.ssim, backend: api.backend, n: S.params.n, playing: S.playing && !S.stopped,
    };
  },
  panels: () => ({ ...panels }),
  snapshot,
  windows: () => WINDOWS.map(({ id, label, level, width }) => ({ id, label, level, width })),
  setWindow(w) { return setParams({ window: w }); },
  setColormap(id, o = {}) {
    const p = { cmap: CM.has(id) ? id : 'grey', cmapReverse: !!o.reverse, cmapGamma: o.gamma ?? 1 };
    if (cmapPicker) cmapPicker.set({ id: p.cmap, reverse: p.cmapReverse, gamma: p.cmapGamma }, { silent: true });
    return setParams(p);
  },
  focusPanel(name) {
    S.focus = name && panels[name] ? name : null;
    const grid = $('panels');
    grid.classList.toggle('focus', !!S.focus);
    grid.querySelectorAll('.panel').forEach((f) => f.classList.toggle('focused', f.dataset.panel === S.focus));
    layout();
  },
  setChrome(visible) { document.documentElement.classList.toggle('ct-bare', !visible); requestAnimationFrame(layout); },
  on,
};
window.__ctlab = api;

// ---------- boot ----------
let cmapPicker = null;
async function boot() {
  buildGallery();
  buildControls();
  buildDraw();
  bindReadout();
  bindExport();
  bindSheets();
  try {
    cmapPicker = createPicker($('cmapHost'), { value: S.params.cmap, compact: true });
    cmapPicker.addEventListener('change', (e) => {
      const { id, reverse, gamma } = e.detail;
      setParams({ cmap: id, cmapReverse: reverse, cmapGamma: gamma });
    });
  } catch (e) { console.warn('colour map picker', e); }
  $('btnRun').addEventListener('click', () => api.run());
  $('btnPlay').addEventListener('click', togglePlay);
  $('btnStep').addEventListener('click', () => api.step(S.phase === 'scan' ? Math.max(1, Math.round((S.session ? S.session.views : 36) / 36)) : 1));
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' || e.key === 'R') api.run();
    else if (e.key === '.') $('btnStep').click();
  });
  new ResizeObserver(() => layout()).observe($('stage'));
  window.addEventListener('resize', layout);
  window.addEventListener('hashchange', () => { const id = hashPreset(); if (id && id !== S.preset) loadPreset(id); });
  window.addEventListener('pagehide', () => { stopJobs(); releaseGpu(); cancelAnimationFrame(rafId); rafId = 0; });

  layout();
  rafId = requestAnimationFrame(frame);
  await initGpu();
  syncControls();
  await loadPreset(hashPreset() || 'shepp-logan');
  readyResolve();
}

function hashPreset() {
  const m = /preset=([\w-]+)/.exec(location.hash || '');
  return m && PRESETS.some((p) => p.id === m[1]) ? m[1] : null;
}

boot().catch((e) => { console.error(e); toast('The lab failed to start: ' + e.message); });
