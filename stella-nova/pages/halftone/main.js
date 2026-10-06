// ============================================================================
//  HALFTONE  ·  main.js — state, inputs, controls, framing, frame loop
// ----------------------------------------------------------------------------
//  The entry module. It starts the GPU (gpu.js), loads the first source,
//  binds the controls of index.html and draws the view each frame that
//  something changed (each frame for a live source: a scene or the camera).
//
//  MODES. "upstream" draws glsl-halftone as it is (halftone.wgsl).
//  "extended" draws halftone_ext (extended.wgsl), this page's own
//  extensions: screen angles, rotation, dot shape, inks and paper, mono,
//  misregistration, dot gain and paper grain. S.ext holds them; EXT_DEFAULT
//  and the "process" palette give the upstream look.
//
//  MODULE MAP
//    halftone-ref.js .. the CPU twin of the port (tests only)
//    gpu.js ........... device, source texture, pipelines, readback
//    shaders/ ......... halftone.wgsl (the port), extended.wgsl (the
//                       extensions), present.wgsl (the view), scene.wgsl
//                       (the procedural scenes)
//
//  SOURCES. SOURCES lists the built-in inputs: two procedural scenes drawn
//  on the GPU (live) and four NASA photos (public domain, img/). The user's
//  own image comes from the file picker, a drop or a paste. The camera
//  starts only on a click of Camera, and stops when another source is
//  chosen or the page hides.
//
//  VIEW. The image fits the clear area (no panel, dock or sheet over it),
//  times S.zoom, around the image point S.cx, S.cy. The halftone is computed
//  in image space for each screen pixel, so a zoom or the loupe makes new
//  dots at that scale; nothing is a scaled copy of a raster.
//
//  EXPORT. PNG: renderExact() draws the current source at its own size off
//  screen (view = the whole image, mip level 0), then a 2D canvas encodes
//  it. WGSL: buildWGSL() writes the port (and extended.wgsl in Extended
//  mode), the settings as constants and a fragment entry point.
//
//  TEST HOOK. window.__ht = { ready, failed, S, gpu, errors, setSource,
//  exact, setMode, setExt, buildWGSL, pngSize }. tests.mjs drives it over
//  CDP.
//
//  grep -n: "const SOURCES"  "const PALETTES"  "const S ="  "async function setSource"
//           "function clearArea"  "function viewRect"  "function writeUniforms"
//           "function frame"  "function bindUI"  "function bindExt"  "function bindPointer"
//           "function bindDrop"  "async function renderExact"  "async function exportPng"
//           "export function buildWGSL"  "window.__ht"
// ============================================================================
import { createGPU, UNI_FLOATS, SCENE_SIZE } from './gpu.js';

const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const TOUCH = matchMedia('(hover:none)').matches;
const $ = id => document.getElementById(id);
const canvas = $('gl');
const BUDGET = 4.5e6;   // backing pixels of the canvas
const BG = [0.055, 0.067, 0.094];

/** Built-in inputs. poi: image points (uv, top left 0,0) for the screensaver push-ins. */
export const SOURCES = [
  { key: 'orbs', name: 'Orbs', tag: 'live scene', kind: 'scene', id: 0,
    credit: 'Orbs: a procedural scene of this page, drawn on the GPU each frame.', poi: [[0.5, 0.5], [0.36, 0.52], [0.64, 0.45]] },
  { key: 'spectrum', name: 'Spectrum', tag: 'live scene', kind: 'scene', id: 1,
    credit: 'Spectrum: a procedural test chart of this page (hue wheel, grey and colour ramps).', poi: [[0.31, 0.5], [0.7, 0.3], [0.7, 0.86]] },
  { key: 'earthrise', name: 'Earthrise', tag: 'Apollo 8', kind: 'photo', file: 'img/earthrise.jpg',
    credit: 'Earthrise, Apollo 8, 24 Dec 1968. NASA photo AS08-14-2383 (cropped). Public domain.', poi: [[0.57, 0.35], [0.4, 0.88]] },
  { key: 'aldrin', name: 'Aldrin', tag: 'Apollo 11', kind: 'photo', file: 'img/aldrin.jpg',
    credit: 'Buzz Aldrin on the Moon, Apollo 11, 20 Jul 1969. NASA photo AS11-40-5903. Public domain.', poi: [[0.51, 0.09], [0.55, 0.25], [0.3, 0.8]] },
  { key: 'blue-marble', name: 'Blue Marble', tag: 'Apollo 17', kind: 'photo', file: 'img/blue-marble.jpg',
    credit: 'The Blue Marble, Apollo 17, 7 Dec 1972. NASA photo AS17-148-22727. Public domain.', poi: [[0.5, 0.38], [0.6, 0.6], [0.35, 0.78]] },
  { key: 'mccandless', name: 'McCandless', tag: 'STS-41B', kind: 'photo', file: 'img/mccandless.jpg',
    credit: 'Bruce McCandless II on the first untethered EVA, STS-41B, 7 Feb 1984. NASA photo S84-27017. Public domain.', poi: [[0.67, 0.21], [0.47, 0.32], [0.3, 0.85]] },
];
const SRC = Object.fromEntries(SOURCES.map(s => [s.key, s]));

/**
 * Ink sets for Extended mode. Each ink is [r, g, b, strength]; it multiplies
 * the paper where its dot is. "process" is upstream: 1 - 0.9 per channel
 * for C, M, Y, and black 0.1 at strength 0.85.
 */
export const PALETTES = {
  process:   { name: 'Process', c: [0.1, 1, 1, 1], m: [1, 0.1, 1, 1], y: [1, 1, 0.1, 1], k: [0.1, 0.1, 0.1, 0.85], paper: [1, 1, 1] },
  newsprint: { name: 'Newsprint', c: [0.12, 0.66, 0.88, 1], m: [0.9, 0.2, 0.52, 1], y: [1, 0.9, 0.18, 1], k: [0.14, 0.13, 0.13, 0.92], paper: [0.92, 0.9, 0.83] },
  riso:      { name: 'Riso', c: [0.0, 0.47, 0.75, 1], m: [1, 0.28, 0.62, 1], y: [1, 0.91, 0.0, 1], k: [0.12, 0.25, 0.3, 0.9], paper: [0.98, 0.96, 0.92] },
  pop:       { name: 'Pop art', c: [0.1, 0.5, 0.92, 1], m: [0.95, 0.12, 0.16, 1], y: [1, 0.86, 0.05, 1], k: [0.05, 0.05, 0.08, 1], paper: [0.99, 0.96, 0.88] },
  duotone:   { name: 'Duotone', c: [1, 1, 1, 0], m: [1, 0.45, 0.25, 1], y: [1, 1, 1, 0], k: [0.07, 0.12, 0.32, 0.95], paper: [0.97, 0.95, 0.9] },
  blueprint: { name: 'Blueprint', c: [1, 1, 1, 0], m: [1, 1, 1, 0], y: [1, 1, 1, 0], k: [0.94, 0.96, 1.0, 1], paper: [0.1, 0.27, 0.55] },
};
export const EXT_DEFAULT = { angles: [15, 75, 0, 45], rot: 0, shape: 0, gain: 0, grain: 1, grainScale: 1, mono: false, misreg: 0, palette: 'process' };
export const SHAPES = ['round', 'ellipse', 'line', 'square'];
const copyInks = p => ({ c: p.c.slice(), m: p.m.slice(), y: p.y.slice(), k: p.k.slice(), paper: p.paper.slice() });
function freshExt() { return { ...EXT_DEFAULT, angles: EXT_DEFAULT.angles.slice(), inks: copyInks(PALETTES.process) }; }

export const S = {
  source: 'orbs', srcW: SCENE_SIZE[0], srcH: SCENE_SIZE[1],
  freq: 30, mode: 'upstream', ext: freshExt(),
  split: { on: false, f: 0.5 },
  loupe: { on: false, x: -1, y: -1, mag: 4 },
  zoom: 1, cx: 0.5, cy: 0.5,
  playing: true, time: 0, fade: 1,
  userName: '', loading: false,
  saver: false, band: null, saverTick: null,
};

let gpu = null;
const uni = new Float32Array(UNI_FLOATS);
const last = new Float32Array(UNI_FLOATS);
const area = { x: 0, y: 0, w: 1, h: 1, ok: false };
const bitmaps = {};          // decoded photos by key (level 0)
let userBmp = null;
let video = null, stream = null;
let srcToken = 0;

// ── sources ────────────────────────────────────────────────────────────────
async function loadPhoto(key) {
  if (bitmaps[key]) return bitmaps[key];
  const r = await fetch(new URL(SRC[key].file, import.meta.url));
  if (!r.ok) throw new Error(SRC[key].file + ': HTTP ' + r.status);
  return (bitmaps[key] = await createImageBitmap(await r.blob()));
}

function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (video) { video.srcObject = null; }
  $('cam').setAttribute('aria-pressed', 'false');
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera API in this browser');
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  if (!video) { video = document.createElement('video'); video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); }
  video.srcObject = stream;
  await video.play();
  for (let i = 0; i < 50 && !video.videoWidth; i++) await new Promise(r => setTimeout(r, 40));
}

/** Show a source: a SOURCES key, 'user' or 'camera'. Resolves when the texture holds it. */
export async function setSource(key, { keepView = false } = {}) {
  const tok = ++srcToken;
  S.loading = true;
  try {
    if (key !== 'camera') stopCamera();
    if (key === 'camera') {
      if (!stream) await startCamera();
      if (tok !== srcToken) return;
      gpu.setVideo(video);
      S.srcW = video.videoWidth; S.srcH = video.videoHeight;
      $('cam').setAttribute('aria-pressed', 'true');
    } else if (key === 'user') {
      if (!userBmp) return;
      await gpu.setBitmap(userBmp, 'user');
      S.srcW = userBmp.width; S.srcH = userBmp.height;
    } else {
      const s = SRC[key];
      if (s.kind === 'scene') {
        gpu.drawScene(s.id, S.time);
        [S.srcW, S.srcH] = SCENE_SIZE;
      } else {
        const bmp = await loadPhoto(key);
        if (tok !== srcToken) return;
        await gpu.setBitmap(bmp, key);
        S.srcW = bmp.width; S.srcH = bmp.height;
      }
    }
    if (tok !== srcToken) return;
    S.source = key;
    if (!keepView) resetView();
    syncUI();
  } catch (e) {
    console.warn('halftone: source', key, e);
    $('srcNote').textContent = (key === 'camera' ? 'The camera did not start: ' : 'The image did not load: ') + (e && e.message || e);
    if (key === 'camera') stopCamera();
  } finally { if (tok === srcToken) S.loading = false; }
}

/** A user file or blob: decode, cut to the GPU size limit, show. */
async function useFile(blob, name) {
  if (!blob || !/^image\//.test(blob.type || 'image/')) return;
  try {
    let bmp = await createImageBitmap(blob);
    const max = gpu ? gpu.maxSize : 4096, big = Math.max(bmp.width, bmp.height);
    if (big > max) {
      const k = max / big;
      const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
      bmp.close(); bmp = small;
    }
    if (userBmp) userBmp.close();
    userBmp = bmp; S.userName = name || 'pasted image';
    await setSource('user');
    $('srcNote').textContent = `${S.userName}: ${bmp.width} × ${bmp.height}${big > max ? ' (cut to ' + max + ' px)' : ''}. It stays in your browser.`;
  } catch (e) { $('srcNote').textContent = 'That file is not an image this browser can decode.'; }
}

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

/** The image rectangle in CSS px. */
function viewRect() {
  const a = area, m = S.saver ? 1 : 0.96;
  const fit = Math.min(a.w * m / S.srcW, a.h * m / S.srcH);
  const w = S.srcW * fit * S.zoom, h = S.srcH * fit * S.zoom;
  return { x: a.x + a.w / 2 - S.cx * w, y: a.y + a.h / 2 - S.cy * h, w, h };
}

// Keep the image over the area: at zoom 1 it is centred; zoomed in, no
// empty band opens at an edge.
function clampView() {
  S.zoom = Math.max(1, Math.min(400, S.zoom));
  const v = viewRect();
  const lim = (c, size, span) => size <= span ? 0.5 : Math.max(span / 2 / size, Math.min(1 - span / 2 / size, c));
  S.cx = lim(S.cx, v.w, area.w); S.cy = lim(S.cy, v.h, area.h);
}
export function resetView() { S.zoom = 1; S.cx = 0.5; S.cy = 0.5; syncZoom(); }

/** Zoom by k about the CSS point (px, py): the image point under it stays put. */
export function zoomAt(k, px, py) {
  const v = viewRect();
  const u = (px - v.x) / v.w, w = (py - v.y) / v.h;
  S.zoom = Math.max(1, Math.min(400, S.zoom * k));
  const n = viewRect();
  S.cx = u - (px - area.x - area.w / 2) / n.w;
  S.cy = w - (py - area.y - area.h / 2) / n.h;
  clampView(); syncZoom();
}

// ── uniforms ───────────────────────────────────────────────────────────────
function loupeRadius() { return TOUCH ? 78 : 96; }

function writeUniforms(u, sc, W, H) {
  const v = viewRect();
  u.set([W, H, S.time, S.fade], 0);
  u.set([v.x * sc, v.y * sc, v.w * sc, v.h * sc], 4);
  u.set([S.srcW, S.srcH, S.srcW / S.srcH, 0], 8);
  const sx = S.split.on ? (area.x + S.split.f * area.w) * sc : -1;
  u.set([S.freq, S.mode === 'extended' ? 1 : 0, sx, 0], 12);
  const L = S.loupe, lon = L.on && L.x >= 0;
  u.set([L.x * sc, L.y * sc, lon ? loupeRadius() * sc : 0, L.mag], 16);
  u.set([...(S.saver ? [0, 0, 0] : BG), 0], 20);
  const E = S.ext, I = E.inks, rad = d => (d + E.rot) * Math.PI / 180;
  u.set([S.freq, E.shape, E.gain, E.mono ? 1 : 0], 24);
  u.set(E.angles.map(rad), 28);
  u.set([E.grain, E.grainScale, E.misreg, 0], 32);
  u.set(I.c, 36); u.set(I.m, 40); u.set(I.y, 44); u.set(I.k, 48); u.set([...I.paper, 0], 52);
}

// ── frame loop ─────────────────────────────────────────────────────────────
let lastT = performance.now(), fpsN = 0, fpsT = 0, fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  fpsN++; fpsT += dt; if (fpsT > 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  if (S.saverTick) S.saverTick(dt, now);
  else if (S.playing) S.time += dt;
  const cw = innerWidth, ch = innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sc = Math.min(dpr, Math.sqrt(BUDGET / (cw * ch)));
  const W = Math.max(1, Math.round(cw * sc)), H = Math.max(1, Math.round(ch * sc));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const goal = clearArea();
  const e = area.ok ? 0.25 : 1;
  for (const k of ['x', 'y', 'w', 'h']) area[k] += (goal[k] - area[k]) * (Math.abs(goal[k] - area[k]) < 0.5 ? 1 : e);
  area.ok = true;
  if (!gpu || S.loading) return;
  const s = SRC[S.source];
  let live = false;
  if (s && s.kind === 'scene' && (S.playing || S.saver)) { gpu.drawScene(s.id, S.time); live = true; }
  if (S.source === 'camera' && video && video.readyState >= 2) {
    if (gpu.setVideo(video)) { S.srcW = video.videoWidth; S.srcH = video.videoHeight; live = true; }
  }
  writeUniforms(uni, W / cw, W, H);
  let same = !live;
  if (same) for (let i = 0; i < UNI_FLOATS; i++) if (i !== 2 && uni[i] !== last[i]) { same = false; break; }
  if (!same) { gpu.render(uni); last.set(uni); }
  if (!S.saver) hud();
  placeGrip();
}

function hud() {
  const h = $('hud');
  h.style.left = area.x + 'px'; h.style.top = (area.y - 26) + 'px'; h.style.width = area.w + 'px';
  const name = S.source === 'user' ? S.userName : S.source === 'camera' ? 'camera' : SRC[S.source].name;
  $('hudL').textContent = `${modeLabel()} · frequency ${S.freq} · ${name} ${S.srcW} × ${S.srcH}`;
  $('hudR').textContent = `zoom ${S.zoom < 10 ? S.zoom.toFixed(1) : S.zoom.toFixed(0)}× · ${fps.toFixed(0)} fps`;
}
function modeLabel() {
  if (S.mode === 'upstream') return 'upstream';
  const E = S.ext;
  return `extended · ${E.mono ? 'mono' : PALETTES[E.palette] ? PALETTES[E.palette].name.toLowerCase() : 'custom inks'} · ${SHAPES[E.shape]}`;
}

function placeGrip() {
  const g = $('splitGrip');
  const show = S.split.on && !S.saver;
  if (g.hidden === show) g.hidden = !show;
  if (show) { g.style.left = (area.x + S.split.f * area.w) + 'px'; g.style.top = (area.y + area.h * 0.5) + 'px'; }
}

// ── controls ───────────────────────────────────────────────────────────────
function zoomToSlider(z) { return Math.log2(z); }
function syncZoom() { const el = $('zoom'); if (el) { el.value = zoomToSlider(S.zoom); $('zoomv').textContent = S.zoom.toFixed(S.zoom < 10 ? 1 : 0) + '×'; } }

export function syncUI() {
  $('freq').value = S.freq; $('freqv').textContent = S.freq;
  $('mag').value = S.loupe.mag; $('magv').textContent = S.loupe.mag + '×';
  syncZoom();
  document.querySelectorAll('#sources button').forEach(b => b.classList.toggle('on', b.dataset.src === S.source));
  $('split').setAttribute('aria-pressed', String(S.split.on));
  $('loupe').setAttribute('aria-pressed', String(S.loupe.on));
  document.querySelectorAll('#dockTools button').forEach(b => b.classList.toggle('on', b.dataset.tool === 'split' ? S.split.on : b.dataset.tool === 'loupe' ? S.loupe.on : false));
  $('modeNow').textContent = S.mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  $('modeNote').textContent = S.mode === 'upstream'
    ? 'glsl-halftone as it is: CMYK screens at 15, 75, 0 and 45 degrees, round dots, its noise and its inks.'
    : 'This page\'s extensions (below) on top of the port. Default values give the upstream look.';
  $('extSec').classList.toggle('dim', S.mode !== 'extended');
  syncExt();
  $('expPng').textContent = `PNG · ${S.srcW} × ${S.srcH}`;
  $('play').setAttribute('aria-pressed', String(!S.playing));
  const s = SRC[S.source];
  $('credit').textContent = s ? s.credit : S.source === 'camera' ? 'Camera: the frames stay in your browser.' : S.userName;
  canvas.classList.toggle('loupe', S.loupe.on);
}

function setSplit(on) { S.split.on = on; syncUI(); }
function setLoupe(on) {
  S.loupe.on = on;
  if (on && S.loupe.x < 0) { S.loupe.x = area.x + area.w * 0.62; S.loupe.y = area.y + area.h * 0.45; }
  syncUI();
}

function bindUI() {
  const grid = $('sources');
  for (const s of SOURCES) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.src = s.key; b.title = s.credit;
    b.innerHTML = `${s.name}<small>${s.tag}</small>`;
    b.addEventListener('click', () => setSource(s.key));
    grid.appendChild(b);
  }
  $('file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) useFile(f, f.name); e.target.value = ''; });
  $('cam').addEventListener('click', () => { if (S.source === 'camera') setSource('orbs'); else setSource('camera'); });
  $('freq').addEventListener('input', e => { S.freq = +e.target.value; $('freqv').textContent = S.freq; });
  $('freqReset').addEventListener('click', () => { S.freq = 30; syncUI(); });
  $('mag').addEventListener('input', e => { S.loupe.mag = +e.target.value; $('magv').textContent = S.loupe.mag + '×'; });
  $('zoom').addEventListener('input', e => {
    const k = 2 ** +e.target.value / S.zoom;
    zoomAt(k, area.x + area.w / 2, area.y + area.h / 2);
  });
  $('split').addEventListener('click', () => setSplit(!S.split.on));
  $('loupe').addEventListener('click', () => setLoupe(!S.loupe.on));
  $('fit').addEventListener('click', resetView);
  document.querySelectorAll('#dockTools button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'split') setSplit(!S.split.on); else if (t === 'loupe') setLoupe(!S.loupe.on); else resetView();
  }));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('play').addEventListener('click', () => { S.playing = !S.playing; syncUI(); });
  $('expPng').addEventListener('click', exportPng);
  $('expWgsl').addEventListener('click', exportWgsl);
  bindExt();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { S.playing = !S.playing; syncUI(); e.preventDefault(); }
    else if (e.key === 's') setSplit(!S.split.on);
    else if (e.key === 'l') setLoupe(!S.loupe.on);
    else if (e.key === 'f' || e.key === '0') resetView();
    else if (e.key === 'u') setMode('upstream');
    else if (e.key === 'e') setMode('extended');
    else if (e.key === '+' || e.key === '=') zoomAt(1.25, area.x + area.w / 2, area.y + area.h / 2);
    else if (e.key === '-') zoomAt(0.8, area.x + area.w / 2, area.y + area.h / 2);
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

// ── extensions ─────────────────────────────────────────────────────────────
export function setMode(m) { if (m === 'upstream' || m === 'extended') { S.mode = m; syncUI(); } }

const hex = c => '#' + c.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const EXT_SLIDERS = [
  ['angC', E => E.angles[0], (E, v) => { E.angles[0] = v; }, v => v.toFixed(1) + '°'],
  ['angM', E => E.angles[1], (E, v) => { E.angles[1] = v; }, v => v.toFixed(1) + '°'],
  ['angY', E => E.angles[2], (E, v) => { E.angles[2] = v; }, v => v.toFixed(1) + '°'],
  ['angK', E => E.angles[3], (E, v) => { E.angles[3] = v; }, v => v.toFixed(1) + '°'],
  ['rot', E => E.rot, (E, v) => { E.rot = v; }, v => (v > 0 ? '+' : '') + v.toFixed(1) + '°'],
  ['misreg', E => E.misreg, (E, v) => { E.misreg = v; }, v => v.toFixed(2)],
  ['gain', E => E.gain, (E, v) => { E.gain = v; }, v => v.toFixed(2)],
  ['grain', E => E.grain, (E, v) => { E.grain = v; }, v => v.toFixed(2)],
  ['grainScale', E => E.grainScale, (E, v) => { E.grainScale = v; }, v => v.toFixed(2) + '×'],
];
const INK_INPUTS = [['inkC', 'c'], ['inkM', 'm'], ['inkY', 'y'], ['inkK', 'k'], ['paper', 'paper']];

function syncExt() {
  const E = S.ext;
  for (const [id, get, , f] of EXT_SLIDERS) { $(id).value = get(E); $(id + 'v').textContent = f(get(E)); }
  for (const [id, k] of INK_INPUTS) $(id).value = hex(E.inks[k]);
  document.querySelectorAll('#shapes button').forEach(b => b.classList.toggle('on', +b.dataset.shape === E.shape));
  document.querySelectorAll('#palettes button').forEach(b => b.classList.toggle('on', b.dataset.pal === E.palette));
  $('mono').setAttribute('aria-pressed', String(E.mono));
}

/** Change extension values (a partial S.ext); selects Extended. */
export function setExt(patch) {
  const E = S.ext;
  if (patch.palette && PALETTES[patch.palette]) { E.inks = copyInks(PALETTES[patch.palette]); E.palette = patch.palette; }
  for (const k of ['rot', 'shape', 'gain', 'grain', 'grainScale', 'mono', 'misreg']) if (k in patch) E[k] = patch[k];
  if (patch.angles) E.angles = patch.angles.slice();
  if (patch.inks) { Object.assign(E.inks, patch.inks); E.palette = 'custom'; }
  S.mode = 'extended';
  syncUI();
}

function bindExt() {
  const pg = $('palettes');
  for (const [key, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.pal = key;
    const sw = [p.c, p.m, p.y, p.k].filter(q => q[3] > 0).map(q => `<b style="background:${hex(q)}"></b>`).join('');
    b.innerHTML = `<i style="outline:1px solid ${hex(p.paper)};background:${hex(p.paper)}">${sw}</i>${p.name}`;
    b.addEventListener('click', () => setExt({ palette: key }));
    pg.appendChild(b);
  }
  for (const [id, , set, f] of EXT_SLIDERS) $(id).addEventListener('input', e => { set(S.ext, +e.target.value); $(id + 'v').textContent = f(+e.target.value); if (S.mode !== 'extended') setMode('extended'); else $('modeNow').textContent = S.mode; });
  for (const [id, k] of INK_INPUTS) $(id).addEventListener('input', e => {
    const rgb = unhex(e.target.value);
    setExt({ inks: { [k]: k === 'paper' ? rgb : [...rgb, S.ext.inks[k][3] || 1] } });
  });
  document.querySelectorAll('#shapes button').forEach(b => b.addEventListener('click', () => setExt({ shape: +b.dataset.shape })));
  $('mono').addEventListener('click', () => setExt({ mono: !S.ext.mono }));
  $('extReset').addEventListener('click', () => { S.ext = freshExt(); syncUI(); });
}

// ── pointer: pan, zoom, loupe, split ───────────────────────────────────────
function bindPointer() {
  const pts = new Map(); let pinch0 = 0, mode = '';
  const loupeTo = (x, y, touch) => { S.loupe.x = x; S.loupe.y = touch ? y - loupeRadius() - 24 : y; };
  canvas.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture(e.pointerId);
    mode = S.loupe.on && e.pointerType !== 'mouse' && pts.size === 1 ? 'loupe' : 'pan';
    if (mode === 'loupe') loupeTo(e.clientX, e.clientY, true);
    canvas.classList.add('drag');
  });
  const end = e => { pts.delete(e.pointerId); pinch0 = 0; if (!pts.size) { canvas.classList.remove('drag'); mode = ''; } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) { if (S.loupe.on && e.pointerType === 'mouse') loupeTo(e.clientX, e.clientY, false); return; }
    const p = pts.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0) zoomAt(d / pinch0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch0 = d; return;
    }
    if (mode === 'loupe') { loupeTo(e.clientX, e.clientY, true); return; }
    if (S.loupe.on && e.pointerType === 'mouse') loupeTo(e.clientX, e.clientY, false);
    const v = viewRect();
    S.cx -= dx / v.w; S.cy -= dy / v.h; clampView();
  });
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && S.loupe.on && !pts.size) S.loupe.x = -1; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('dblclick', resetView);

  const g = $('splitGrip');
  g.addEventListener('pointerdown', e => { g.setPointerCapture(e.pointerId); g.dataset.drag = '1'; });
  g.addEventListener('pointermove', e => { if (g.dataset.drag) S.split.f = Math.max(0, Math.min(1, (e.clientX - area.x) / area.w)); });
  const gEnd = () => { delete g.dataset.drag; };
  g.addEventListener('pointerup', gEnd); g.addEventListener('pointercancel', gEnd);
}

// ── drop and paste ─────────────────────────────────────────────────────────
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

// ── exact render (tests; the PNG export uses it too) ───────────────────────
/** Render the current source at its own size, view = the whole image, lod 0. */
export async function renderExact() {
  const u = new Float32Array(UNI_FLOATS);
  const W = S.srcW, H = S.srcH;
  writeUniforms(u, 1, W, H);
  u.set([W, H, S.time, 1], 0);
  u.set([0, 0, W, H], 4);
  u.set([W, H, W / H, 1], 8);
  u[14] = -1;                    // no split
  u.set([0, 0, 0, 1], 16);       // no loupe
  return gpu.renderImage(u, W, H);
}

function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function baseName() {
  const src = S.source === 'user' ? (S.userName || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase() : S.source;
  return `halftone-${src}-${S.mode}-f${S.freq}`;
}

/** The halftone at the full size of the source, as a PNG blob. */
async function pngBlob() {
  const o = await renderExact();
  const cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h;
  const g = cv.getContext('2d');
  g.putImageData(new ImageData(new Uint8ClampedArray(o.data.buffer), o.w, o.h), 0, 0);
  return new Promise(r => cv.toBlob(r, 'image/png'));
}
async function exportPng() {
  $('expNote').textContent = `Rendering ${S.srcW} × ${S.srcH}…`;
  try { const b = await pngBlob(); download(b, baseName() + '.png'); $('expNote').textContent = `Saved ${baseName()}.png: ${S.srcW} × ${S.srcH}, ${(b.size / 1048576).toFixed(1)} MB.`; }
  catch (e) { $('expNote').textContent = 'The PNG export failed: ' + (e && e.message || e); }
}

// A WGSL float literal.
const fl = v => { const t = String(+(+v).toFixed(6)); return /[.e]/.test(t) ? t : t + '.0'; };
const v4 = a => `vec4f(${a.map(fl).join(', ')})`;

/** The WGSL of the current settings: the port, the extensions if on, and an entry point. */
export function buildWGSL() {
  const ext = S.mode === 'extended', E = S.ext, I = E.inks;
  const rad = E.angles.map(d => (d + E.rot) * Math.PI / 180);
  const stamp = new Date().toISOString().slice(0, 10);
  const head = `// ============================================================================
//  halftone.wgsl — exported by the Stella Nova halftone page on ${stamp}
// ----------------------------------------------------------------------------
//  Mode: ${S.mode}. Frequency ${S.freq} (screen cells across the image height).
${ext ? `//  Extensions: inks ${E.palette}, shape ${SHAPES[E.shape]}${E.mono ? ', mono' : ''}, angles C ${E.angles[0]} M ${E.angles[1]} Y ${E.angles[2]} K ${E.angles[3]}
//  degrees, rotation ${E.rot}, misregistration ${E.misreg}, dot gain ${E.gain}, grain ${E.grain} x ${E.grainScale}.
` : ''}//
//  The port of glsl-halftone (glslify/stackgl, MIT), of glsl-noise simplex/2d
//  (Ian McEwan, Ashima Arts, MIT) and of glsl-aastep (stackgl, MIT). The
//  halftone method is Stefan Gustavson's (public domain). Keep these MIT
//  notices with any copy: https://github.com/glslify/glsl-halftone and
//  https://github.com/ashima/webgl-noise.${ext ? `
//  The extensions (struct Ext, halftone_ext) are the Stella Nova page's own.` : ''}
//
//  Bindings: group 0, binding 0 the source texture, binding 1 a filtering
//  sampler. Draw 3 vertices (one full-screen triangle).
// ============================================================================
`;
  const entry = `
// ── the settings and the entry points ───────────────────────────────────────
const FREQUENCY: f32 = ${fl(S.freq)};
${ext ? `
fn ext_params() -> Ext {
  return Ext(FREQUENCY, ${fl(E.shape)}, ${fl(E.gain)}, ${fl(E.mono ? 1 : 0)},
    ${v4(rad)},   // C, M, Y, K angles (radians, rotation included)
    vec2f(${fl(E.grain)}, ${fl(E.grainScale)}), ${fl(E.misreg)}, 0.0,
    ${v4(I.c)}, ${v4(I.m)},
    ${v4(I.y)}, ${v4(I.k)},
    ${v4([...I.paper, 0])});
}
` : ''}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment fn fs_main(v: VOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  let tex = textureSample(src, smp, v.uv).rgb;
  let st = vec2f(v.uv.x * dims.x / dims.y, 1.0 - v.uv.y);   // the upstream README coordinates
${ext ? `  let e = ext_params();
  let a = vec2f(dims.y / dims.x, -1.0);
  let tc = textureSample(src, smp, v.uv + misreg_offset(0u, e) * a).rgb;
  let tm = textureSample(src, smp, v.uv + misreg_offset(1u, e) * a).rgb;
  let ty = textureSample(src, smp, v.uv + misreg_offset(2u, e) * a).rgb;
  return vec4f(halftone_ext(tc, tm, ty, tex, st, e), 1.0);` : `  return vec4f(halftone(tex, st, FREQUENCY), 1.0);`}
}
`;
  return head + gpu.src.halftone + (ext ? '\n' + gpu.src.extended : '') + entry;
}
function exportWgsl() {
  const t = buildWGSL();
  download(new Blob([t], { type: 'text/plain' }), baseName() + '.wgsl');
  $('expNote').textContent = `Saved ${baseName()}.wgsl: ${t.split('\n').length} lines.`;
}

const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
window.__ht = { ready: false, failed: null, S, SOURCES, get gpu() { return gpu; }, get errors() { return gpu ? gpu.errors : []; },
  setSource: async (key, freq) => { S.playing = false; if (freq) S.freq = freq; await setSource(key); syncUI(); return [S.srcW, S.srcH]; },
  exact: async () => { const o = await renderExact(), s = await gpu.readSource(); return { w: o.w, h: o.h, out: b64(o.data), src: b64(s.data) }; },
  setMode: m => { setMode(m); return S.mode; }, setExt: p => { setExt(p); return S.ext; }, resetExt: () => { S.ext = freshExt(); syncUI(); return S.ext; },
  buildWGSL: () => buildWGSL(),
  pngSize: async () => { const b = await pngBlob(); const bmp = await createImageBitmap(b); return { w: bmp.width, h: bmp.height, bytes: b.size, type: b.type }; } };

// ── boot ───────────────────────────────────────────────────────────────────
addEventListener('pagehide', stopCamera);
bindUI();
bindPointer();
bindDrop();
requestAnimationFrame(frame);
export const ready = (async () => {
  try {
    gpu = await createGPU(canvas);
    await setSource(S.source);
    window.__ht.ready = true;
    return gpu;
  } catch (e) {
    window.__ht.failed = String(e && e.message || e);
    console.error('halftone:', e);
    if (String(e.message).includes('no-webgpu')) $('nogpu').hidden = false;
    throw e;
  }
})();
ready.catch(() => {});
