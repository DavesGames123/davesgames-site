// ============================================================================
//  THREAD ART  ·  main.js — state, sources, the step pump, drawing, controls
// ----------------------------------------------------------------------------
//  The entry module. It loads the source image, builds a run (engine.js
//  createRun), and pumps the greedy step: on the GPU (gpu.js +
//  thread.wgsl) when WebGPU is there, else on the CPU (engine.js stepRun).
//  The step runs ahead of the display; the display lays the lines at the
//  chosen speed, and the newest line travels from peg to peg.
//
//  DRAWING. #view is a 2D canvas. The lines go into a cache canvas with
//  the model's composite: "multiply" on a white board and "screen" on a
//  black board, at globalAlpha = thread opacity. That is the same
//  arithmetic as the model (engine.js), so the picture shows what the step
//  scored. A change of view (resize, zoom, pan, width) draws all lines
//  again as vectors; a cached raster is never scaled up. The error image
//  (engine.js residualRGBA) is a res x res canvas drawn beside the piece.
//
//  MODULE MAP
//    engine.js ... the CPU model, the step, the exports (no DOM)
//    gpu.js ...... the WebGPU runner of thread.wgsl (no DOM)
//    saver.js .... window.snSaver: the screensaver shot director
//
//  TEST HOOK. window.__ta = { ready, S, run, engine, restart, finish }.
//
//  grep -n: "export const SOURCES"  "export const S ="  "async function sourceRGBA"
//           "export async function restart"  "function pump"  "function speedLps"
//           "function clearArea"  "function layout"  "function drawAll"
//           "function present"  "function frame"  "function hud"  "function bindUI"
//           "function bindPointer"  "function bindDrop"  "async function snapshot"
//           "async function exportPng"  "function exportText"  "const ready"
// ============================================================================
import {
  createRun, stepRun, targetFrom, frameMask, imagePalette, shapeImage, PALETTES, hex,
  toJSON, toText, toSVG, residualRGBA, sumSq, MAX_RES,
} from './engine.js';
import { createThreadGPU } from './gpu.js';
import { installSaver } from './saver.js';

const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const TOUCH = matchMedia('(hover:none)').matches;
const $ = id => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');

/** Built-in images. poi: points of interest (0..1 of the square crop) for close-ups. */
export const SOURCES = [
  { key: 'mona-lisa', name: 'Mona Lisa', tag: 'Leonardo', kind: 'photo', file: 'img/mona-lisa.jpg', portrait: true,
    credit: 'Mona Lisa, Leonardo da Vinci, c. 1503-1506, Louvre (C2RMF retouched scan, cropped). Public domain.', poi: [[0.5, 0.33], [0.48, 0.5], [0.3, 0.7]] },
  { key: 'pearl', name: 'Pearl Earring', tag: 'Vermeer', kind: 'photo', file: 'img/pearl.jpg', portrait: true,
    credit: 'Girl with a Pearl Earring, Johannes Vermeer, c. 1665, Mauritshuis (cropped). Public domain.', poi: [[0.32, 0.45], [0.48, 0.75], [0.35, 0.2]] },
  { key: 'van-gogh', name: 'Van Gogh', tag: 'self-portrait', kind: 'photo', file: 'img/van-gogh.jpg', portrait: true, colour: true,
    credit: 'Self-Portrait, Vincent van Gogh, 1887, Art Institute of Chicago (Google Art Project scan, cropped). Public domain.', poi: [[0.62, 0.42], [0.55, 0.62], [0.7, 0.25]] },
  { key: 'aldrin', name: 'Aldrin', tag: 'Apollo 11', kind: 'photo', file: '../halftone/img/aldrin.jpg', portrait: true,
    credit: 'Buzz Aldrin on the Moon, Apollo 11, 20 Jul 1969. NASA photo AS11-40-5903. Public domain.', poi: [[0.52, 0.12], [0.55, 0.3], [0.4, 0.75]] },
  { key: 'eye', name: 'Eye', tag: 'shape', kind: 'shape', credit: 'Eye: a test shape of this page.', poi: [[0.5, 0.5], [0.3, 0.5]] },
  { key: 'star', name: 'Star', tag: 'shape', kind: 'shape', colour: true, credit: 'Star: a test shape of this page.', poi: [[0.5, 0.15], [0.5, 0.5]] },
  { key: 'moon', name: 'Moon', tag: 'shape', kind: 'shape', credit: 'Moon: a test shape of this page.', poi: [[0.3, 0.5], [0.45, 0.3]] },
  { key: 'rings', name: 'Rings', tag: 'shape', kind: 'shape', colour: true, credit: 'Rings: a test shape of this page.', poi: [[0.5, 0.5], [0.2, 0.5]] },
];
const SRC = Object.fromEntries(SOURCES.map(s => [s.key, s]));

export const S = {
  source: 'mona-lisa', shape: 'circle', P: 240, maxLines: 4000, res: 384,
  mode: 'mono', pal: 'cmyk', dark: false, alpha: 0.1, width: 1, contrast: 1, seed: 1,
  speed: 0.62, playing: true, finishing: false, showErr: false, showPegNums: false,
  zoom: 1, cx: 0.5, cy: 0.5,
  saver: false, band: null, saverTick: null, fade: 1, lpsOverride: 0,
  userName: '',
};

let run = null, colors = [], colHex = [], mask = null;
let device = null, gpuR = null, engine = 'cpu', engineNote = '';
let shown = 0, drawn = 0, pending = false, gpuChunk = 16, rTok = 0;
let errFrac = 1, errAt = 0, errBusy = false, errDirty = true;
const artC = document.createElement('canvas'), artG = artC.getContext('2d');
const errC = document.createElement('canvas'), errG = errC.getContext('2d');
let cacheKey = '', dpr = 1;
const bitmaps = {};
let userBmp = null;

// ── sources ────────────────────────────────────────────────────────────────
async function loadBitmap(key) {
  if (key === 'user') return userBmp;
  if (bitmaps[key]) return bitmaps[key];
  const r = await fetch(new URL(SRC[key].file, import.meta.url));
  if (!r.ok) throw new Error(SRC[key].file + ': HTTP ' + r.status);
  return (bitmaps[key] = await createImageBitmap(await r.blob()));
}

/** The source as res x res RGBA: the centred square crop. */
async function sourceRGBA(key, res) {
  if (SRC[key] && SRC[key].kind === 'shape') return shapeImage(key, res);
  const bmp = await loadBitmap(key);
  if (!bmp) return shapeImage('eye', res);
  const c = document.createElement('canvas'); c.width = c.height = res;
  const g = c.getContext('2d', { willReadFrequently: true });
  const w = bmp.width, h = bmp.height, s = Math.min(w, h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (w - s) / 2, (h - s) / 2, s, s, 0, 0, res, res);
  return g.getImageData(0, 0, res, res).data;
}

export async function setSource(key, { keep = false } = {}) {
  S.source = key;
  if (!keep && SRC[key]) S.mode = SRC[key].colour ? 'colour' : 'mono';
  if (!keep && SRC[key] && SRC[key].colour && S.pal === 'cmyk' && SRC[key].kind === 'photo') S.pal = 'image';
  syncUI();
  await restart();
}

async function useFile(blob, name) {
  if (!blob || !/^image\//.test(blob.type || 'image/')) return;
  try {
    const bmp = await createImageBitmap(blob);
    if (userBmp) userBmp.close();
    userBmp = bmp; S.userName = name || 'pasted image';
    await setSource('user', { keep: true });
    $('srcNote').textContent = `${S.userName}: ${bmp.width} × ${bmp.height}, the centre square is used. It stays in your browser.`;
  } catch (e) { $('srcNote').textContent = 'That file is not an image this browser can decode.'; }
}

async function snapshot() {
  const note = $('srcNote');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { note.textContent = 'This browser has no camera API.'; return; }
  let st = null;
  try {
    note.textContent = 'Camera on: hold still…';
    st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.srcObject = st;
    await v.play();
    for (let i = 0; i < 50 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 40));
    await new Promise(r => setTimeout(r, 700));
    const bmp = await createImageBitmap(v);
    st.getTracks().forEach(t => t.stop()); st = null;
    if (userBmp) userBmp.close();
    userBmp = bmp; S.userName = 'camera snapshot';
    await setSource('user', { keep: true });
    note.textContent = 'Camera snapshot: one frame, the camera is off again. It stays in your browser.';
  } catch (e) {
    note.textContent = 'No camera snapshot: ' + (e && e.message || e);
  } finally { if (st) st.getTracks().forEach(t => t.stop()); }
}

// ── the run ────────────────────────────────────────────────────────────────
function threadColors(rgba) {
  const side = S.dark ? 'dark' : 'light';
  if (S.mode !== 'colour') return PALETTES.mono[side];
  if (S.pal === 'image') return imagePalette(rgba, S.res, 4, { dark: S.dark, mask, seed: S.seed });
  return PALETTES[S.pal][side];
}

/** Build a new run from the settings and start laying it. */
export async function restart() {
  const tok = ++rTok;
  let rgba;
  try { rgba = await sourceRGBA(S.source, S.res); } catch (e) { $('srcNote').textContent = 'The image did not load: ' + e.message; return; }
  if (tok !== rTok) return;

  mask = frameMask(S.shape, S.res);
  colors = threadColors(rgba);
  colHex = colors.map(hex);
  const T = targetFrom(rgba, S.res, { color: S.mode === 'colour', dark: S.dark, contrast: S.contrast, mask });
  run = createRun({ res: S.res, shape: S.shape, P: S.P, colors, alpha: S.alpha, color: S.mode === 'colour', dark: S.dark,
    seed: S.seed >>> 0, maxLines: S.maxLines }, T);
  if (gpuR) { try { gpuR.load(run); } catch (e) { toCPU(e); } }
  shown = 0; drawn = 0; cacheKey = ''; S.finishing = false;
  errFrac = 1; errDirty = true; errAt = 0;
  errC.width = errC.height = S.res;
  syncSwatches();
}

function toCPU(e) {
  console.warn('thread-art: GPU step failed, CPU from now on:', e);
  engine = 'cpu'; engineNote = 'GPU failed: CPU'; gpuR = null; pending = false;
  restart();
}

/** Lines per second of the display (Infinity: as fast as the step goes). */
function speedLps() {
  if (S.lpsOverride) return S.lpsOverride;
  if (S.finishing || S.speed >= 0.999) return Infinity;
  return 2 * Math.pow(10, S.speed * 3.5);
}

function pump() {
  if (!run || run.done) return;
  const lps = speedLps();
  const want = lps === Infinity ? 1e9 : Math.max(48, lps * 1.2);
  if (run.lines.length - shown >= want) return;
  if (engine === 'gpu') {
    if (pending) return;
    const myRun = run, t0 = performance.now();
    const n = gpuR.steps(Math.max(1, Math.min(gpuChunk, Math.ceil(want))));
    if (!n) return;
    pending = true;
    gpuR.sync().then(r => {
      pending = false;
      if (run !== myRun || r.stale) return;
      const dt = performance.now() - t0;
      if (dt < 12 && r.lines.length === n) gpuChunk = Math.min(1024, Math.ceil(gpuChunk * 1.5));
      else if (dt > 34) gpuChunk = Math.max(4, Math.floor(gpuChunk * 0.6));
    }).catch(e => { pending = false; if (run === myRun) toCPU(e); });
  } else {
    const t0 = performance.now(), budget = S.saver ? 7 : 10;
    while (performance.now() - t0 < budget && run.lines.length - shown < want) if (!stepRun(run)) break;
  }
}

async function refreshError(now) {
  if (!run || errBusy) return;
  const period = S.showErr ? (engine === 'gpu' ? 400 : 300) : 1500;
  if (!errDirty && now - errAt < period) return;
  if (!S.showErr && !errDirty && run.done && now - errAt < 5000) return;
  errAt = now; errDirty = false;
  const myRun = run;
  let resid = run.residual;
  if (engine === 'gpu') {
    errBusy = true;
    try { resid = await gpuR.readResidual(); } catch (e) { resid = null; }
    errBusy = false;
    if (run !== myRun || !resid) return;
  }
  errFrac = run.E0 > 0 ? sumSq(resid) / run.E0 : 0;
  if (S.showErr) errG.putImageData(new ImageData(residualRGBA(resid, run.res, run.C, run.cfg.dark, mask), run.res, run.res), 0, 0);
}

export function finish() { S.finishing = true; S.playing = true; syncUI(); }

// ── framing ────────────────────────────────────────────────────────────────
function clearArea() {
  const W = innerWidth, H = innerHeight;
  if (S.saver) {
    const b = S.band;
    if (!b) return { x: 0, y: 0, w: W, h: H };
    const w = Math.min(W, b.w || W), x = (W - w) / 2;
    return { x, y: b.t, w, h: Math.max(80, H - b.t - b.b) };
  }
  let l = 0, t = 0, r = W, bot = H;
  const top = document.querySelector('.topbar');
  if (top && getComputedStyle(top).display !== 'none') t = top.getBoundingClientRect().bottom;
  for (const el of [$('panel'), $('dock')]) {
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(W, q.right), y0 = Math.max(0, q.top), y1 = Math.min(H, q.bottom);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    if ((x1 - x0) > W * 0.5) { if (y0 > H * 0.25) bot = Math.min(bot, y0); else t = Math.max(t, y1); }
    else if ((y1 - y0) > H * 0.5) { if (x0 < 2) l = Math.max(l, x1); else r = Math.min(r, x0); }
  }
  t += 26;   // the HUD line
  return { x: l, y: t, w: Math.max(40, r - l), h: Math.max(40, bot - t - 6) };
}

/** The piece rect and (when Error is on) the error rect, in CSS px. */
function layout() {
  const a = clearArea(), m = S.saver ? 1 : 0.96;
  let A = a, B = null;
  if (S.showErr && !S.saver) {
    if (a.w >= a.h) { A = { ...a, w: a.w / 2 }; B = { ...a, x: a.x + a.w / 2, w: a.w / 2 }; }
    else { A = { ...a, h: a.h / 2 }; B = { ...a, y: a.y + a.h / 2, h: a.h / 2 }; }
  }
  const fit = r => {
    const s = Math.min(r.w, r.h) * m * S.zoom;
    return { x: r.x + r.w / 2 - S.cx * s, y: r.y + r.h / 2 - S.cy * s, s, clip: r };
  };
  return { area: a, art: fit(A), err: B ? fit(B) : null };
}

function clampView() {
  S.zoom = Math.max(1, Math.min(40, S.zoom));
  const lim = c => Math.max(0.5 / S.zoom, Math.min(1 - 0.5 / S.zoom, c));
  S.cx = lim(S.cx); S.cy = lim(S.cy);
}
export function resetView() { S.zoom = 1; S.cx = 0.5; S.cy = 0.5; }
function zoomAt(k, px, py) {
  const L = layout(), v = L.art;
  const u = (px - v.x) / v.s, w = (py - v.y) / v.s;
  S.zoom = Math.max(1, Math.min(40, S.zoom * k));
  const n = layout().art, r = n.clip;
  S.cx = u - (px - r.x - r.w / 2) / n.s;
  S.cy = w - (py - r.y - r.h / 2) / n.s;
  clampView();
}

// ── drawing ────────────────────────────────────────────────────────────────
function framePath(g, x, y, s) {
  const res = run.res, k = s / res, c = (res - 1) / 2;
  const X = v => x + (v + 0.5) * k;
  g.beginPath();
  if (run.cfg.shape === 'circle') g.arc(X(c), X(c) - x + y, (c + 0.5) * k, 0, Math.PI * 2);
  else if (run.cfg.shape === 'square') g.rect(x, y, s, s);
  else {
    for (let i = 0; i < 6; i++) { const t = -Math.PI / 2 + (i * Math.PI) / 3; g[i ? 'lineTo' : 'moveTo'](X(c + c * Math.cos(t)), y + (c + c * Math.sin(t) + 0.5) * k); }
    g.closePath();
  }
}

/** Stroke lines [from, to) into g; the piece square is at (x, y) with side s (device px). */
function strokeLines(g, x, y, s, from, to) {
  const k = s / run.res, px = run.pegs.x, py = run.pegs.y;
  g.save();
  g.globalCompositeOperation = run.cfg.dark ? 'screen' : 'multiply';
  g.globalAlpha = run.cfg.alpha;
  g.lineWidth = Math.max(0.25, S.width * k);
  g.lineCap = 'round';
  for (let i = from; i < to; i++) {
    const l = run.lines[i];
    g.strokeStyle = colHex[l.k];
    g.beginPath();
    g.moveTo(x + (px[l.a] + 0.5) * k, y + (py[l.a] + 0.5) * k);
    g.lineTo(x + (px[l.b] + 0.5) * k, y + (py[l.b] + 0.5) * k);
    g.stroke();
  }
  g.restore();
}

function paintBoard(g, x, y, s) {
  g.save();
  framePath(g, x, y, s);
  g.fillStyle = run.cfg.dark ? '#000000' : '#ffffff';
  g.fill();
  g.restore();
}

function drawAll(L) {
  const W = canvas.width, H = canvas.height;
  if (artC.width !== W || artC.height !== H) { artC.width = W; artC.height = H; }
  artG.clearRect(0, 0, W, H);
  const a = L.art;
  artG.save();
  artG.beginPath(); artG.rect(a.clip.x * dpr, a.clip.y * dpr, a.clip.w * dpr, a.clip.h * dpr); artG.clip();
  paintBoard(artG, a.x * dpr, a.y * dpr, a.s * dpr);
  strokeLines(artG, a.x * dpr, a.y * dpr, a.s * dpr, 0, Math.floor(shown));
  artG.restore();
  drawn = Math.floor(shown);
}

function present(L, now) {
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(artC, 0, 0);
  const a = L.art, d = dpr;
  const k = (a.s * d) / run.res, ox = a.x * d, oy = a.y * d;
  ctx.save();
  ctx.beginPath(); ctx.rect(a.clip.x * d, a.clip.y * d, a.clip.w * d, a.clip.h * d); ctx.clip();
  // the line on its way: from the last peg toward the next one
  const i = Math.floor(shown), f = shown - i;
  if (i < run.lines.length && f > 0 && speedLps() < 400) {
    const l = run.lines[i], x0 = ox + (run.pegs.x[l.a] + 0.5) * k, y0 = oy + (run.pegs.y[l.a] + 0.5) * k;
    const x1 = ox + (run.pegs.x[l.b] + 0.5) * k, y1 = oy + (run.pegs.y[l.b] + 0.5) * k;
    const hx = x0 + (x1 - x0) * f, hy = y0 + (y1 - y0) * f;
    ctx.globalAlpha = Math.min(1, 0.35 + run.cfg.alpha * 2);
    ctx.strokeStyle = colHex[l.k] === '#000000' ? '#ffb020' : colHex[l.k] === '#ffffff' ? '#ffd860' : colHex[l.k];
    ctx.lineWidth = Math.max(1, S.width * k * 1.4);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffc832';
    ctx.beginPath(); ctx.arc(hx, hy, Math.max(2.5 * d, k * 1.2), 0, Math.PI * 2); ctx.fill();
  }
  // pegs
  const pr = Math.max(0.8 * d, Math.min(2.4 * d, k * 0.9));
  ctx.fillStyle = run.cfg.dark ? 'rgba(200,190,170,0.85)' : 'rgba(90,80,70,0.9)';
  for (let p = 0; p < run.P; p++) { ctx.beginPath(); ctx.arc(ox + (run.pegs.x[p] + 0.5) * k, oy + (run.pegs.y[p] + 0.5) * k, pr, 0, Math.PI * 2); ctx.fill(); }
  if (S.showPegNums && !S.saver) {
    const gapPx = (Math.PI * a.s * d) / run.P, every = gapPx > 26 * d ? 1 : gapPx > 13 * d ? 2 : gapPx > 5 * d ? 5 : 10;
    ctx.font = `${Math.round(10 * d)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#ffc832'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const c = (run.res - 1) / 2;
    for (let p = 0; p < run.P; p += every) {
      const x = run.pegs.x[p] - c, y = run.pegs.y[p] - c, r = Math.hypot(x, y) || 1;
      const off = 10 * d / k;
      ctx.fillText(String(p), ox + (run.pegs.x[p] + 0.5 + (x / r) * off) * k, oy + (run.pegs.y[p] + 0.5 + (y / r) * off) * k);
    }
  }
  ctx.restore();
  if (L.err) {
    const e = L.err;
    ctx.save();
    ctx.beginPath(); ctx.rect(e.clip.x * d, e.clip.y * d, e.clip.w * d, e.clip.h * d); ctx.clip();
    framePath(ctx, e.x * d, e.y * d, e.s * d); ctx.clip();
    ctx.imageSmoothingEnabled = e.s * d / run.res < 3;
    ctx.drawImage(errC, e.x * d, e.y * d, e.s * d, e.s * d);
    ctx.restore();
    ctx.save();
    ctx.font = `${Math.round(11 * d)}px Inter, system-ui, sans-serif`; ctx.fillStyle = '#8090b0'; ctx.textAlign = 'center';
    ctx.fillText(`error image · E = ${(errFrac * 100).toFixed(1)}% of the start`, (e.clip.x + e.clip.w / 2) * d, (e.clip.y + e.clip.h - 4) * d);
    ctx.restore();
  }
  if (S.fade < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - S.fade})`; ctx.fillRect(0, 0, W, H); }
  void now;
}

let lastT = performance.now(), hudAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (S.saverTick) S.saverTick(dt);
  // canvas size
  const cap = TOUCH ? 2 : 2.5;
  dpr = Math.min(cap, devicePixelRatio || 1);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; cacheKey = ''; }
  if (!run) return;
  pump();
  // reveal
  if (S.playing) {
    const lps = speedLps();
    shown = lps === Infinity ? run.lines.length : Math.min(run.lines.length, shown + lps * dt);
    if (S.finishing && run.done && shown >= run.lines.length) S.finishing = false;
  }
  const L = layout();
  const key = [W, H, L.art.x, L.art.y, L.art.s, L.art.clip.w, L.art.clip.h, S.width, S.dark].map(v => typeof v === 'number' ? v.toFixed(2) : v).join('|');
  if (key !== cacheKey || Math.floor(shown) < drawn) { cacheKey = key; drawAll(L); }
  else if (Math.floor(shown) > drawn) {
    const a = L.art;
    artG.save();
    artG.beginPath(); artG.rect(a.clip.x * dpr, a.clip.y * dpr, a.clip.w * dpr, a.clip.h * dpr); artG.clip();
    strokeLines(artG, a.x * dpr, a.y * dpr, a.s * dpr, drawn, Math.floor(shown));
    artG.restore();
    drawn = Math.floor(shown);
    errDirty = errDirty || S.showErr;
  }
  present(L, now);
  refreshError(now);
  if (now - hudAt > 150) { hudAt = now; hud(); }
}

function hud() {
  if (!run) return;
  const n = Math.floor(shown), lps = speedLps();
  $('hudL').textContent = `${n.toLocaleString()} / ${run.cfg.maxLines.toLocaleString()} lines · ${run.P} pegs · E ${(errFrac * 100).toFixed(1)}%`;
  let st;
  if (run.done && n >= run.lines.length) st = run.lines.length >= run.cfg.maxLines ? 'done: the line limit' : 'done: no line lowers the error';
  else st = `${engine === 'gpu' ? 'GPU' : 'CPU'} · ${lps === Infinity ? 'full speed' : Math.round(lps) + ' lines/s'}${S.playing ? '' : ' · paused'}`;
  $('hudR').textContent = engineNote ? `${st} · ${engineNote}` : st;
  $('engineNow').textContent = engine === 'gpu' ? 'WebGPU compute' : 'CPU';
}

// ── controls ───────────────────────────────────────────────────────────────
const fmt = {
  pegs: v => String(v), maxLines: v => (+v).toLocaleString(), alpha: v => (+v).toFixed(2), width: v => (+v).toFixed(1),
  contrast: v => (+v).toFixed(2),
  speed: () => { const l = speedLps(); return l === Infinity ? 'max' : Math.round(l) + '/s'; },
};
const KEYS = { pegs: 'P', maxLines: 'maxLines', alpha: 'alpha', width: 'width', contrast: 'contrast', speed: 'speed' };

export function syncUI() {
  for (const [id, k] of Object.entries(KEYS)) { const el = $(id); if (el) { el.value = S[k]; $(id + 'v').textContent = fmt[id](S[k]); } }
  $('seed').value = S.seed;
  document.querySelectorAll('#shapes button').forEach(b => b.classList.toggle('on', b.dataset.shape === S.shape));
  document.querySelectorAll('#resSeg button').forEach(b => b.classList.toggle('on', +b.dataset.res === S.res));
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('#palettes button').forEach(b => b.classList.toggle('on', b.dataset.pal === S.pal));
  document.querySelectorAll('#pages button').forEach(b => b.classList.toggle('on', (b.dataset.page === 'dark') === S.dark));
  document.querySelectorAll('#sources button').forEach(b => b.classList.toggle('on', b.dataset.src === S.source));
  $('palRow').hidden = S.mode !== 'colour';
  $('frameNow').textContent = `${S.shape} · ${S.P}`;
  $('modeNow').textContent = S.mode === 'colour' ? 'colour' : 'mono';
  $('play').textContent = S.playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(!S.playing));
  $('errBtn').setAttribute('aria-pressed', String(S.showErr));
  $('pegBtn').setAttribute('aria-pressed', String(S.showPegNums));
  const dt = document.querySelectorAll('#dockTools button');
  dt.forEach(b => {
    if (b.dataset.tool === 'play') b.textContent = S.playing ? 'Pause' : 'Play';
    if (b.dataset.tool === 'err') b.classList.toggle('on', S.showErr);
  });
  const s = SRC[S.source];
  $('credit').textContent = s ? s.credit : (S.userName ? 'Your image: ' + S.userName + '.' : '');
}

function syncSwatches() {
  const el = $('swatches');
  el.innerHTML = '';
  for (const c of colHex) { const i = document.createElement('i'); i.style.background = c; i.title = c; el.appendChild(i); }
}

let restartT = 0;
function restartSoon(ms = 120) { clearTimeout(restartT); restartT = setTimeout(restart, ms); }

function bindUI() {
  const grid = $('sources');
  for (const s of SOURCES) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.src = s.key; b.title = s.credit;
    b.innerHTML = `${s.name}<small>${s.tag}</small>`;
    b.addEventListener('click', () => setSource(s.key));
    grid.appendChild(b);
  }
  $('file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) useFile(f, f.name); e.target.value = ''; });
  $('cam').addEventListener('click', snapshot);
  // sliders: the value shows on input, the run restarts on change
  for (const [id, k] of Object.entries(KEYS)) {
    const el = $(id);
    el.addEventListener('input', () => {
      S[k] = +el.value; $(id + 'v').textContent = fmt[id](S[k]);
      if (k === 'width') cacheKey = '';
    });
    el.addEventListener('change', () => { if (k !== 'width' && k !== 'speed') restartSoon(); });
  }
  $('seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('seed').value || 0)); restartSoon(); });
  $('reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 1e6); syncUI(); restartSoon(0); });
  document.querySelectorAll('#shapes button').forEach(b => b.addEventListener('click', () => { S.shape = b.dataset.shape; syncUI(); restartSoon(0); }));
  document.querySelectorAll('#resSeg button').forEach(b => b.addEventListener('click', () => { S.res = Math.min(MAX_RES, +b.dataset.res); syncUI(); restartSoon(0); }));
  document.querySelectorAll('#modes button').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    if (S.mode === 'colour' && S.alpha < 0.12) S.alpha = 0.12;
    syncUI(); restartSoon(0);
  }));
  document.querySelectorAll('#palettes button').forEach(b => b.addEventListener('click', () => { S.pal = b.dataset.pal; syncUI(); restartSoon(0); }));
  document.querySelectorAll('#pages button').forEach(b => b.addEventListener('click', () => { S.dark = b.dataset.page === 'dark'; syncUI(); restartSoon(0); }));
  const togglePlay = () => { S.playing = !S.playing; syncUI(); };
  const toggleErr = () => { S.showErr = !S.showErr; errDirty = true; cacheKey = ''; syncUI(); };
  $('play').addEventListener('click', togglePlay);
  $('restart').addEventListener('click', () => restart());
  $('finish').addEventListener('click', finish);
  $('errBtn').addEventListener('click', toggleErr);
  $('pegBtn').addEventListener('click', () => { S.showPegNums = !S.showPegNums; syncUI(); });
  $('fit').addEventListener('click', resetView);
  document.querySelectorAll('#dockTools button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'play') togglePlay(); else if (t === 'restart') restart(); else if (t === 'finish') finish(); else toggleErr();
  }));
  $('expPng').addEventListener('click', exportPng);
  $('expSvg').addEventListener('click', () => exportText('svg'));
  $('expJson').addEventListener('click', () => exportText('json'));
  $('expTxt').addEventListener('click', () => exportText('txt'));
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    else if (e.key === 'r') restart();
    else if (e.key === 'e') toggleErr();
    else if (e.key === 'f') finish();
    else if (e.key === '0') resetView();
    else if (e.key === 'n') { S.showPegNums = !S.showPegNums; syncUI(); }
  });

  // Panel, phone sheet and dock (the wave-membrane pattern).
  const panel = $('panel'), dockPanel = $('dockPanel');
  const setOpen = open => {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
  };
  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const d = e.clientY - gy; gy = null;
    if (Math.abs(d) < 8) panel.classList.toggle('full');
    else if (d < 0) panel.classList.add('full');
    else if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false);
  });
  syncUI();
}

function bindPointer() {
  const pts = new Map(); let pinch0 = 0;
  canvas.addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture(e.pointerId); canvas.classList.add('drag'); });
  const end = e => { pts.delete(e.pointerId); pinch0 = 0; if (!pts.size) canvas.classList.remove('drag'); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0) zoomAt(d / pinch0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch0 = d; return;
    }
    if (S.zoom <= 1) return;
    const v = layout().art;
    S.cx -= dx / v.s; S.cy -= dy / v.s; clampView();
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('dblclick', resetView);
}

function bindDrop() {
  const drop = $('drop'); let depth = 0;
  const hasFile = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  addEventListener('dragenter', e => { if (!hasFile(e)) return; e.preventDefault(); depth++; drop.hidden = false; });
  addEventListener('dragleave', e => { if (!hasFile(e)) return; if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  addEventListener('dragover', e => { if (hasFile(e)) e.preventDefault(); });
  addEventListener('drop', e => {
    if (!hasFile(e)) return; e.preventDefault(); depth = 0; drop.hidden = true;
    const f = Array.from(e.dataTransfer.files).find(q => /^image\//.test(q.type));
    if (f) useFile(f, f.name); else $('srcNote').textContent = 'That drop held no image file.';
  });
  addEventListener('paste', e => {
    const it = Array.from((e.clipboardData && e.clipboardData.items) || []).find(q => q.kind === 'file' && /^image\//.test(q.type));
    if (it) { e.preventDefault(); useFile(it.getAsFile(), 'pasted image'); }
  });
}

// ── export ─────────────────────────────────────────────────────────────────
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function baseName() {
  const src = S.source === 'user' ? (S.userName || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase() : S.source;
  return `thread-art-${src}-${run.cfg.shape}-${run.P}p-${Math.floor(shown)}l`;
}
/** The lines shown so far, as a run view for the exports. */
function shownRun() { return { ...run, lines: run.lines.slice(0, Math.floor(shown)) }; }

async function exportPng() {
  if (!run) return;
  const size = 2048, pad = 48, c = document.createElement('canvas');
  c.width = c.height = size + 2 * pad;
  const g = c.getContext('2d');
  g.fillStyle = run.cfg.dark ? '#000000' : '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  strokeLines(g, pad, pad, size, 0, Math.floor(shown));
  const k = size / run.res;
  g.fillStyle = run.cfg.dark ? '#888888' : '#555555';
  for (let p = 0; p < run.P; p++) { g.beginPath(); g.arc(pad + (run.pegs.x[p] + 0.5) * k, pad + (run.pegs.y[p] + 0.5) * k, 3, 0, Math.PI * 2); g.fill(); }
  c.toBlob(b => { if (b) { download(b, baseName() + '.png'); $('expNote').textContent = `Saved ${baseName()}.png (${c.width} px).`; } }, 'image/png');
}

function exportText(kind) {
  if (!run) return;
  const r = shownRun(), src = SRC[S.source];
  const extra = { image: src ? src.name : S.userName || 'your image', credit: src ? src.credit : '', made: 'https://davesgames.io (Stella Nova thread-art page)' };
  let blob, ext;
  if (kind === 'svg') { blob = new Blob([toSVG(r, { size: 1600, width: S.width, title: 'Thread art: ' + extra.image })], { type: 'image/svg+xml' }); ext = 'svg'; }
  else if (kind === 'json') { blob = new Blob([JSON.stringify(toJSON(r, extra), null, 1)], { type: 'application/json' }); ext = 'json'; }
  else { blob = new Blob([toText(r)], { type: 'text/plain' }); ext = 'txt'; }
  download(blob, baseName() + '.' + ext);
  $('expNote').textContent = `Saved ${baseName()}.${ext}: ${r.lines.length} lines.`;
}

// ── boot ───────────────────────────────────────────────────────────────────
window.__ta = { ready: false, S, get run() { return run; }, get engine() { return engine; }, restart, finish };
bindUI();
bindPointer();
bindDrop();
requestAnimationFrame(frame);

export const ready = (async () => {
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        device = await adapter.requestDevice();
        const wgsl = await (await fetch(new URL('thread.wgsl', import.meta.url))).text();
        gpuR = await createThreadGPU(device, wgsl);
        engine = 'gpu';
        device.lost.then(info => { if (engine === 'gpu' && info.reason !== 'destroyed') toCPU(new Error('device lost: ' + info.message)); });
      }
    }
  } catch (e) {
    console.warn('thread-art: no WebGPU step:', e);
    gpuR = null; engine = 'cpu'; engineNote = 'no WebGPU: CPU step';
  }
  if (!navigator.gpu) engineNote = 'no WebGPU: CPU step';
  await restart();
  window.__ta.ready = true;
})();
ready.catch(e => console.error('thread-art:', e));

installSaver({
  S, SOURCES, canvas, ready, restart, setSource, syncUI, clampView, finish,
  get run() { return run; }, get shown() { return shown; }, set shown(v) { shown = v; },
  invalidate: () => { cacheKey = ''; },
});
