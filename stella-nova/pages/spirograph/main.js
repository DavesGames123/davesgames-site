// ============================================================================
//  SPIROGRAPH  ·  main.js — the sheet, the ink, the controls, the loop
// ----------------------------------------------------------------------------
//  One square sheet of paper. A trace is one run of the pen with one set of
//  gears and one pen: { R, r, out, d, hole, rot, pen, w, t0, t1 }. The page
//  keeps every finished trace, so it can draw the ink again at any size
//  (resize, undo, paper change, export).
//
//  INK LAYERS. #wet holds the trace that draws now, in opaque strokes, so
//  the joints between frames do not show. When the trace ends, #wet goes
//  into #dry with multiply (cream paper) or screen (night paper), at the ink
//  alpha. Both canvases blend into #paper with the same CSS blend mode. A
//  trace that crosses another trace makes a darker line, as ink does.
//
//  SCALE. units is the half width of the sheet in gear units (spiro.js).
//  An empty sheet fits the rig. A rig that does not fit makes the sheet
//  larger, and the ink is drawn again at the new scale.
//
//  STATE OF THE PEN. There is always an active trace (the gears on the
//  sheet). A change of gears or pen hole lifts the pen: the active ink
//  becomes a finished trace and a new trace starts at t = 0. A change of
//  ink or width starts a new trace at the same t, as a change of pen does.
//  When a trace closes, the page stops until the next change, or Play.
//
//  SAVER INK. In the screensaver the paper is always night paper, and the
//  ink is light: the hue runs along the curve, one full turn of the color
//  circle in each lap of the wheel, from the hue of the pen. The strokes
//  are opaque and wider, and a soft copy of the ink (#glow, blurred,
//  screen) lies under the sharp lines. The gears show at 55%. The normal
//  page keeps its paper and pen colors.
//
//  GREP MAP
//     grep -n 'function layout'       fit the sheet in the clear area
//     grep -n 'function drawPaper'    paper color, grain, fibers, vignette
//     grep -n 'function startTrace'   lift the pen and start a new trace
//     grep -n 'function advance'      move t and lay ink
//     grep -n 'function finishTrace'  move #wet into #dry, next in queue
//     grep -n 'function drawRig'      the gears and the pen each frame
//     grep -n 'function redrawInk'    draw every trace again (resize, undo)
//     grep -n 'function loadPreset'   clear and queue the traces of a preset
//     grep -n 'function renderMath'   the MathJax equations and live numbers
//     grep -n 'function exportPNG'    the raster file (2048 px)
//     grep -n 'function exportSVG'    the vector file
//     grep -n 'function bindDrag'     turn the wheel by hand
//     grep -n 'function setOpen'      the panel, the phone sheet, the dock
//     grep -n 'function saverHue'     the hue of the saver ink at t
//     grep -n 'function drawGlow'     the soft copy of the ink (saver)
//     grep -n 'window.snSaver'        the screensaver hook
// ============================================================================
import { TAU, closure, wheelAngle, wheelCenter, penAt, holes, extent, samplePath } from './spiro.js';
import { fixedSprite, wheelSprite } from './rig.js';
import { INKS, WIDTHS, PRESETS } from './presets.js';
import { typeset } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const INK_A = 0.9;
const SAVER_RIG_A = 0.55;                // the gears step back in the saver
const PAPER = { cream: '#f3eee2', night: '#12151b' };
const RULES = [['R', 'm1'], ['r', 'm2'], ['d', 'm3'], ['L', 'm4'], ['g', 'm5'], ['n', 'm6']];
const MAX_EXT = 190;                     // the largest rig, in units

const sheet = $('sheet'), paperC = $('paper'), dryC = $('dry'), wetC = $('wet'), rigC = $('rig');
const dry = dryC.getContext('2d'), wet = wetC.getContext('2d'), rigX = rigC.getContext('2d');

const S = {
  R: 144, r: 60, out: false, hole: 99, loops: 0, pen: 0, w: 0, rot: 0,
  paper: 'cream', units: 170, P: 0, dpr: 1, k: 1,
  playing: true, held: false, gears: true, speed: 0.5,
  traces: [], active: null, queue: [], preset: -1, presetRate: 0,
  rigDirty: true, drag: null, saver: null,
};

// ── helpers ────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const userRate = () => 0.08 * Math.pow(60, S.speed) * TAU;         // rad of t per s
const inkOf = pen => INKS[pen][S.paper];
const inkA = () => S.saver ? 1 : INK_A;
// The hue of a hex color, in degrees.
function hexHue(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return 0;
  const h = mx === r ? (g - b) / d % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
// The saver ink at t: the hue starts at the pen hue and turns once in each
// lap of the wheel (t = 2 pi). A trace has a whole number of laps, so the
// color is continuous where the curve closes.
function saverHue(tr, t) { return hexHue(INKS[tr.pen].night) + 360 * t / TAU; }
const saverInk = (tr, t) => `hsl(${saverHue(tr, t).toFixed(1)},100%,66%)`;
const blend = () => S.paper === 'night' ? 'screen' : 'multiply';
const widthPx = w => WIDTHS[w].px * S.dpr * clamp(S.P / 800, 0.7, 1.25);
function mulberry(seed) {
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function holeIndex(r, h) { return clamp(Math.round(h), 0, holes(r).length - 1); }
function specNow() {
  const hi = holeIndex(S.r, S.hole);
  return { R: S.R, r: S.r, out: S.out, hole: hi, d: holes(S.r)[hi].d, rot: S.rot, pen: S.pen, w: S.w, loops: S.loops };
}
function lapsOf(sp) { return sp.loops || closure(sp.R, sp.r).laps; }

// ── layout ─────────────────────────────────────────────────────────────────
// The clear part of #desk: the panel covers the left (desktop), the base
// (phone portrait) or the right (phone landscape) while it is open. The
// values come from the layout boxes, not the transformed rects, so a panel
// in transition gives its end state.
function layout() {
  const desk = $('desk').getBoundingClientRect(), panel = $('panel');
  let L = desk.left, Rr = desk.right, T = desk.top, B = desk.bottom;
  if (panel.classList.contains('open') && !S.saver) {
    if (LAND_Q.matches) Rr = Math.min(Rr, innerWidth - panel.offsetWidth);
    else if (PHONE_Q.matches) { const top = desk.bottom - panel.offsetHeight; if (top - T > 170) B = top; }
    else L = Math.max(L, panel.offsetWidth);
  }
  const phone = PHONE_Q.matches, cap = S.saver ? 0 : (phone ? 26 : 34), m = S.saver ? 24 : (phone ? 12 : 30);
  const P = Math.max(120, Math.floor(Math.min(Rr - L - 2 * m, B - T - 2 * m - cap)));
  const x = Math.round((L + Rr) / 2 - P / 2 - desk.left), y = Math.round((T + B - cap) / 2 - P / 2 - desk.top);
  sheet.style.left = x + 'px'; sheet.style.top = y + 'px';
  sheet.style.width = P + 'px'; sheet.style.height = P + 'px';
  const capEl = $('caption');
  capEl.style.left = (x + P / 2) + 'px'; capEl.style.top = (y + P + (phone ? 6 : 10)) + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (P !== S.P || dpr !== S.dpr) { S.P = P; S.dpr = dpr; resizeCanvases(); }
}
function resizeCanvases() {
  const n = Math.round(S.P * S.dpr);
  for (const c of [paperC, dryC, wetC, rigC]) { c.width = n; c.height = n; }
  setScale();
  drawPaper(paperC.getContext('2d'), n, S.paper);
  redrawInk();
}
function setScale() {
  S.k = S.P * S.dpr / 2 / S.units;
  S.sprites = null; S.rigDirty = true;
}

// ── paper ──────────────────────────────────────────────────────────────────
const tiles = {};
function paperTile(kind) {
  if (tiles[kind]) return tiles[kind];
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d'), img = x.createImageData(n, n), rnd = mulberry(kind === 'night' ? 7 : 3);
  const night = kind === 'night';
  for (let i = 0; i < n * n; i++) {
    const v = rnd(), o = i * 4;
    if (v < 0.5) { img.data[o] = night ? 0 : 92; img.data[o + 1] = night ? 0 : 74; img.data[o + 2] = night ? 0 : 44; img.data[o + 3] = (0.5 - v) * (night ? 70 : 46); }
    else { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = night ? 255 : 248; img.data[o + 3] = (v - 0.5) * (night ? 16 : 60); }
  }
  x.putImageData(img, 0, 0);
  return (tiles[kind] = c);
}
// Paper color, fine grain, soft clouds, a few fibers, and a light vignette.
// The seed is fixed, so the same sheet comes back after a resize.
function drawPaper(ctx, n, kind) {
  const night = kind === 'night', rnd = mulberry(11);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER[kind]; ctx.fillRect(0, 0, n, n);
  for (let i = 0; i < 16; i++) {
    const cx = rnd() * n, cy = rnd() * n, rr = (0.15 + rnd() * 0.35) * n;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr), dark = rnd() < 0.5;
    const col = night ? (dark ? '0,0,0' : '120,140,180') : (dark ? '150,120,70' : '255,255,250');
    g.addColorStop(0, `rgba(${col},${night ? 0.05 : 0.06})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
  }
  const s = n / 900;
  ctx.save();
  ctx.scale(Math.max(1, s), Math.max(1, s));
  ctx.fillStyle = ctx.createPattern(paperTile(kind), 'repeat');
  ctx.fillRect(0, 0, n, n);
  ctx.restore();
  ctx.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const x0 = rnd() * n, y0 = rnd() * n, a = rnd() * TAU, len = (8 + rnd() * 26) * s, bend = (rnd() - 0.5) * 10 * s;
    ctx.strokeStyle = night ? `rgba(160,180,220,${0.03 + rnd() * 0.03})` : `rgba(120,96,60,${0.04 + rnd() * 0.05})`;
    ctx.lineWidth = (0.5 + rnd() * 0.6) * s;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + Math.cos(a) * len / 2 - Math.sin(a) * bend, y0 + Math.sin(a) * len / 2 + Math.cos(a) * bend, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
    ctx.stroke();
  }
  const v = ctx.createRadialGradient(n / 2, n / 2, n * 0.35, n / 2, n / 2, n * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, night ? 'rgba(0,0,0,0.35)' : 'rgba(110,86,50,0.13)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, n, n);
}

// ── ink ────────────────────────────────────────────────────────────────────
function strokeTrace(ctx, tr, t0, t1, k, c, wScale) {
  if (t1 <= t0) return;
  const pts = samplePath(tr.R, tr.r, tr.out, tr.d, tr.rot, t0, t1, 1.4 / k);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (S.saver) {
    // Short opaque runs, each in the hue of its middle t. The runs share
    // their end points, so the line has no gaps and no dark joints.
    const m = pts.length / 2 - 1, step = 6;
    ctx.lineWidth = WIDTHS[tr.w].px * wScale * 1.5;
    for (let i = 0; i < m; i += step) {
      const j = Math.min(m, i + step);
      ctx.strokeStyle = saverInk(tr, t0 + (t1 - t0) * (i + j) / 2 / m);
      ctx.beginPath(); ctx.moveTo(c + pts[2 * i] * k, c + pts[2 * i + 1] * k);
      for (let q = i + 1; q <= j; q++) ctx.lineTo(c + pts[2 * q] * k, c + pts[2 * q + 1] * k);
      ctx.stroke();
    }
    return;
  }
  ctx.strokeStyle = INKS[tr.pen][S.paper];
  ctx.lineWidth = WIDTHS[tr.w].px * wScale;
  ctx.beginPath(); ctx.moveTo(c + pts[0] * k, c + pts[1] * k);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(c + pts[i] * k, c + pts[i + 1] * k);
  ctx.stroke();
}
function bake() {
  dry.save(); dry.globalCompositeOperation = blend(); dry.globalAlpha = inkA();
  dry.drawImage(wetC, 0, 0); dry.restore();
  wet.clearRect(0, 0, wetC.width, wetC.height);
}
function wScale() { return S.dpr * clamp(S.P / 800, 0.7, 1.25); }
function redrawInk() {
  const n = dryC.width, c = n / 2;
  dry.clearRect(0, 0, n, n); wet.clearRect(0, 0, n, n);
  for (const tr of S.traces) { strokeTrace(wet, tr, tr.t0, tr.t1, S.k, c, wScale()); bake(); }
  const a = S.active;
  if (a) strokeTrace(wet, a, a.t0, a.tMax, S.k, c, wScale());
  S.rigDirty = true;
}

// ── traces ─────────────────────────────────────────────────────────────────
function inkLaid() { return S.traces.length > 0 || (S.active && S.active.tMax > S.active.t0); }
// Keep the ink of the active trace as a finished trace.
function liftPen() {
  const a = S.active;
  if (a && a.tMax > a.t0 + 1e-6) { bake(); S.traces.push({ ...a, t1: a.tMax }); }
  else wet.clearRect(0, 0, wetC.width, wetC.height);
  S.active = null;
}
// Start a new trace from spec at t = tStart. Fit or grow the sheet first.
function startTrace(sp, tStart = 0, tEnd = null, rate = 0) {
  const need = extent(sp.R, sp.r, sp.out) * 1.03;
  if (!inkLaid() && Math.abs(need - S.units) > 0.5) { S.units = need; setScale(); redrawInk(); }
  else if (need > S.units) { S.units = need; setScale(); redrawInk(); }
  S.active = { ...sp, t0: tStart, t: tStart, tMax: tStart, tEnd: tEnd ?? tStart + TAU * lapsOf(sp), rate, wait: 0 };
  S.closed = false; S.rigDirty = true;
  updateCaption(); updatePlay();
}
// The gears, the hole or the mode changed: lift the pen, start at t = 0.
function regear() {
  liftPen(); S.queue = []; S.preset = -1; markPreset();
  startTrace(specNow());
  S.active.wait = 0.35;            // the pen goes down when the slider rests
  if (!S.held) S.playing = true;
  updatePlay();
}
// The ink or the width changed: a new pen at the same place.
function repen() {
  const a = S.active;
  if (a && a.t > a.t0 && a.t < a.tEnd) {
    const t = a.t, tEnd = a.tEnd, rate = a.rate;
    liftPen(); startTrace({ ...a, pen: S.pen, w: S.w }, t, tEnd, rate);
  } else { liftPen(); startTrace(specNow()); }
  if (!S.held) S.playing = true;
  updatePlay();
}
function advance(dt) {
  const a = S.active;
  if (!a || !S.playing || S.held || S.drag) return;
  if (a.wait > 0) { a.wait -= dt; return; }
  const rate = a.rate || userRate();
  moveTo(Math.min(a.tEnd, a.t + rate * dt));
}
// Move the pen to t. Ink goes down only on the part of the curve that has
// no ink yet, so a turn back by hand draws nothing.
function moveTo(t) {
  const a = S.active;
  t = clamp(t, a.t0, a.tEnd);
  if (t > a.tMax) { strokeTrace(wet, a, Math.max(a.t0, a.tMax - 1e-4), t, S.k, wetC.width / 2, wScale()); a.tMax = t; }
  a.t = t; S.rigDirty = true;
  if (t >= a.tEnd - 1e-9) finishTrace();
}
function finishTrace() {
  liftPen();
  if (S.queue.length) { const q = S.queue.shift(); syncUI(q); startTrace(q, 0, null, S.presetRate); return; }
  // Closed: wait with the gears at the start, ready to draw again.
  S.playing = false;
  startTrace(specNow());
  S.closed = true; updatePlay();
}
function clearSheet() {
  S.traces = []; S.queue = []; S.active = null; S.rot = 0;
  wet.clearRect(0, 0, wetC.width, wetC.height); dry.clearRect(0, 0, dryC.width, dryC.height);
  startTrace(specNow());
  if (!S.held) S.playing = true;
  updatePlay();
}
function undo() {
  const a = S.active;
  if (a && a.tMax > a.t0) { wet.clearRect(0, 0, wetC.width, wetC.height); a.tMax = a.t = a.t0; }
  else if (S.traces.length) { S.traces.pop(); redrawInk(); }
  S.queue = []; S.playing = false; S.rigDirty = true; updatePlay(); updateCaption();
}
function finishNow() {
  const a = S.active; if (!a) return;
  if (a.tMax >= a.tEnd) { S.playing = true; S.held = false; updatePlay(); return; }
  // Each finished trace starts the next one in the queue. After the last
  // trace, finishTrace sets S.closed.
  for (let i = 0; i < 64 && S.active && !S.closed; i++) moveTo(S.active.tEnd);
}

// ── rig ────────────────────────────────────────────────────────────────────
function sprites(a) {
  const key = `${a.R}|${a.r}|${a.out}|${a.hole}|${S.k}|${S.paper}`;
  if (!S.sprites || S.sprites.key !== key) {
    const night = S.paper === 'night';
    S.sprites = { key, fixed: fixedSprite(a.R, a.out, S.k, night, S.dpr), wheel: wheelSprite(a.r, S.k, night, S.dpr, a.hole) };
  }
  return S.sprites;
}
function drawRig() {
  const n = rigC.width, c = n / 2, a = S.active;
  rigX.clearRect(0, 0, n, n);
  if (!a) return;
  const k = S.k, sp = sprites(a), th = holes(a.r)[a.hole].a;
  const [wx, wy] = wheelCenter(a.R, a.r, a.out, a.t), phi = wheelAngle(a.R, a.r, a.out, a.t);
  rigX.save();
  rigX.translate(c, c); rigX.rotate(a.rot);
  if (S.gears) {
    rigX.drawImage(sp.fixed, -sp.fixed.width / 2, -sp.fixed.height / 2);
    rigX.save();
    rigX.translate(wx * k, wy * k); rigX.rotate(phi - th);
    rigX.drawImage(sp.wheel, -sp.wheel.width / 2, -sp.wheel.height / 2);
    rigX.restore();
  }
  // the pen: a dot of its ink in a thin ring
  const [px, py] = penAt(a.R, a.r, a.out, a.d, a.t);
  const pr = Math.max(2.4 * S.dpr, 0.75 * k);
  rigX.beginPath(); rigX.arc(px * k, py * k, pr, 0, TAU);
  rigX.fillStyle = S.saver ? saverInk(a, a.t) : inkOf(a.pen); rigX.fill();
  rigX.lineWidth = 1.2 * S.dpr; rigX.strokeStyle = S.paper === 'night' ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,24,0.8)';
  rigX.stroke();
  rigX.restore();
}

// ── presets ────────────────────────────────────────────────────────────────
function presetSpec(tr) {
  const hs = holes(tr.r), hi = clamp(Math.round(tr.hole * (hs.length - 1)), 0, hs.length - 1);
  return { R: tr.R, r: tr.r, out: tr.out, hole: hi, d: hs[hi].d, rot: tr.rot, pen: tr.pen, w: tr.w, loops: tr.loops };
}
// Clear the sheet, set the paper and the scale, and queue the traces. The
// preset draws in about drawSec seconds, or slower when the user speed is
// slower than that.
function loadPreset(i, drawSec = 9) {
  const p = PRESETS[i];
  S.preset = i; markPreset();
  S.traces = []; S.active = null; S.rot = 0;
  wet.clearRect(0, 0, wetC.width, wetC.height); dry.clearRect(0, 0, dryC.width, dryC.height);
  const specs = p.traces.map(presetSpec);
  S.units = p.units || Math.max(...specs.map(s => extent(s.R, s.r, s.out))) * 1.03;
  const paper = S.saver ? 'night' : p.paper;
  if (S.paper !== paper) setPaper(paper);
  setScale();
  const total = specs.reduce((s, sp) => s + TAU * lapsOf(sp), 0);
  S.presetRate = S.saver ? total / drawSec : Math.max(userRate(), total / drawSec);
  S.queue = specs.slice(1);
  syncUI(specs[0]);
  startTrace(specs[0], 0, null, S.presetRate);
  S.held = false; S.playing = true; updatePlay();
  setText('dockName', p.name);
}
function markPreset() {
  document.querySelectorAll('#presets .card').forEach((b, i) => b.classList.toggle('on', i === S.preset));
  if (S.preset < 0) setText('dockName', 'Your own');
}
function thumb(p, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), specs = p.traces.map(presetSpec);
  drawPaper(x, size, p.paper);
  const units = p.units || Math.max(...specs.map(s => extent(s.R, s.r, s.out))) * 1.03, k = size / 2 / units;
  const saved = S.paper; S.paper = p.paper;
  x.globalCompositeOperation = p.paper === 'night' ? 'screen' : 'multiply';
  for (const sp of specs) strokeTrace(x, sp, 0, TAU * lapsOf(sp), k, size / 2, size / 260);
  S.paper = saved;
  return c;
}

// ── math ───────────────────────────────────────────────────────────────────
const TEX_IN = String.raw`\begin{aligned} x &= (R - r)\cos t + d\cos\!\Big(\frac{R - r}{r}\,t\Big)\\[2pt] y &= (R - r)\sin t - d\sin\!\Big(\frac{R - r}{r}\,t\Big)\end{aligned}`;
const TEX_OUT = String.raw`\begin{aligned} x &= (R + r)\cos t - d\cos\!\Big(\frac{R + r}{r}\,t\Big)\\[2pt] y &= (R + r)\sin t - d\sin\!\Big(\frac{R + r}{r}\,t\Big)\end{aligned}`;
const TEX_CLOSE = String.raw`g = \gcd(R, r),\quad n = \frac{R}{g},\quad L = \frac{r}{g}`;
const SLIP_IN = String.raw`R\,t = r\,(t - \varphi)\quad\Rightarrow\quad \varphi = -\frac{R - r}{r}\,t`;
const SLIP_OUT = String.raw`R\,t = r\,(\varphi - t)\quad\Rightarrow\quad \varphi = \frac{R + r}{r}\,t`;
let mathKey = '', mathTimer = 0;
function renderMath() {
  const a = specNow();
  const key = `${a.R}|${a.r}|${a.out}|${a.hole}`;
  if (key === mathKey) return;
  mathKey = key;
  clearTimeout(mathTimer);
  mathTimer = setTimeout(() => {
    const { g, petals, laps } = closure(a.R, a.r);
    const R = `\\class{m1}{${a.R}}`, r = `\\class{m2}{${a.r}}`, G = `\\class{m5}{${g}}`;
    const live = String.raw`\begin{aligned} g &= \gcd(${R}, ${r}) = ${G}\\ n &= ${R}/${G} = \class{m6}{${petals}}\ \text{petals}\\ L &= ${r}/${G} = \class{m4}{${laps}}\ \text{laps}\end{aligned}`;
    typeset($('eqCurve'), a.out ? TEX_OUT : TEX_IN, { rules: RULES });
    typeset($('eqClose'), TEX_CLOSE, { rules: RULES });
    typeset($('eqLive'), live, { rules: RULES });
    typeset($('eqSlip'), a.out ? SLIP_OUT : SLIP_IN, { rules: RULES });
  }, mathKey ? 60 : 0);
  for (const el of [$('eqCurve'), $('eqClose'), $('eqLive'), $('eqSlip')]) el.classList.add('sci-eq');
}

// ── UI ─────────────────────────────────────────────────────────────────────
function setText(id, s) { const el = $(id); if (el && el.textContent !== s) el.textContent = s; }
function updatePlay() {
  const label = S.held ? 'Play' : (S.playing ? 'Pause' : (S.closed ? 'Draw again' : 'Play'));
  setText('playBtn', label);
  const dp = $('dockPlay'), on = S.playing && !S.held;
  dp.textContent = on ? '❚❚' : '▶'; dp.setAttribute('aria-label', label);
}
function togglePlay() {
  if (S.held) { S.held = false; S.playing = true; }
  else if (S.playing) { S.held = true; }
  else S.playing = true;          // draw again
  updatePlay();
}
// Put the controls on a trace spec (a preset trace or an undo).
function syncUI(sp) {
  S.R = sp.R; S.r = sp.r; S.out = sp.out; S.hole = sp.hole; S.pen = sp.pen; S.w = sp.w; S.loops = sp.loops || 0; S.rot = sp.rot;
  refreshControls();
}
function rMax() { return S.out ? Math.floor((MAX_EXT - 2 - S.R) / 2) : S.R - 8; }
function refreshControls() {
  const Ri = $('R'), ri = $('r'), hi = $('hole'), li = $('loops');
  Ri.max = S.out ? 120 : 160; Ri.min = S.out ? 24 : 40;
  S.R = clamp(S.R, +Ri.min, +Ri.max); Ri.value = S.R; setText('RV', String(S.R));
  ri.max = Math.max(12, rMax()); S.r = clamp(S.r, 12, +ri.max); ri.value = S.r; setText('rV', String(S.r));
  const hs = holes(S.r);
  hi.max = hs.length - 1; S.hole = clamp(Math.round(S.hole), 0, hs.length - 1); hi.value = S.hole;
  setText('holeV', `${(hs[S.hole].d / S.r).toFixed(2)} r`);
  const L = closure(S.R, S.r).laps;
  li.max = L; li.disabled = L < 2;
  const lv = S.loops ? Math.min(S.loops, L) : L; li.value = lv;
  setText('loopsV', lv === L ? `${L} (closes)` : `${lv} of ${L}`);
  setText('lblR', S.out ? 'Fixed wheel teeth' : 'Ring teeth');
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', (b.dataset.out === '1') === S.out));
  document.querySelectorAll('#inks button').forEach((b, i) => b.classList.toggle('on', i === S.pen));
  document.querySelectorAll('#widths button').forEach((b, i) => b.classList.toggle('on', i === S.w));
  renderMath();
}
function setPaper(kind, quiet) {
  S.paper = kind;
  sheet.classList.toggle('night', kind === 'night');
  document.querySelectorAll('#paperSeg button').forEach(b => b.classList.toggle('on', b.dataset.paper === kind));
  document.querySelectorAll('#inks button').forEach((b, i) => b.style.setProperty('--c', INKS[i][kind]));
  if (quiet) return;
  drawPaper(paperC.getContext('2d'), paperC.width, kind);
  S.sprites = null; redrawInk();
}
function setGears(on) {
  S.gears = on;
  $('gearsBtn').classList.toggle('on', on); setText('gearsBtn', on ? 'Gears shown' : 'Gears hidden');
  $('dockGears').classList.toggle('on', on); $('dockGears').setAttribute('aria-pressed', String(on));
  S.rigDirty = true;
}
let capKey = '';
function updateCaption() {
  const a = S.closed && S.traces.length ? S.traces[S.traces.length - 1] : S.active; if (!a) return;
  const { petals, laps } = closure(a.R, a.r), L = lapsOf(a);
  const lap = Math.min(L, Math.floor((a.tMax - a.t0) / TAU + 1e-6));
  const key = `${a.R}|${a.r}|${a.out}|${a.d}|${lap}|${L}|${S.closed}`;
  if (key === capKey) return;
  capKey = key;
  const done = S.closed || a.tMax >= a.tEnd - 1e-9;
  $('caption').innerHTML = `<i>${a.out ? 'Epitrochoid' : 'Hypotrochoid'}</i>, ${petals} petals, ` +
    (done ? (L === laps ? `closed after ${laps} laps` : `${L} of ${laps} laps`) : `lap ${Math.min(L, lap + 1)} of ${L}`);
}

function bindUI() {
  const box = $('presets');
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button'); b.className = 'card'; b.title = p.name;
    b.append(thumb(p, 132)); const s = document.createElement('span'); s.textContent = p.name; b.append(s);
    b.addEventListener('click', () => loadPreset(i));
    box.append(b);
  });
  const inks = $('inks');
  INKS.forEach((ink, i) => {
    const b = document.createElement('button'); b.title = ink.name; b.setAttribute('aria-label', ink.name + ' ink');
    b.style.setProperty('--c', ink[S.paper]);
    b.addEventListener('click', () => { S.pen = i; refreshControls(); repen(); });
    inks.append(b);
  });
  const ws = $('widths');
  WIDTHS.forEach((w, i) => {
    const b = document.createElement('button'); b.textContent = w.name;
    b.addEventListener('click', () => { S.w = i; refreshControls(); repen(); });
    ws.append(b);
  });
  document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => {
    const out = b.dataset.out === '1'; if (out === S.out) return;
    S.out = out;
    if (out) { S.R = Math.min(S.R, 96); S.r = Math.min(S.r, Math.floor((MAX_EXT - 2 - S.R) / 2)); }
    refreshControls(); regear();
  }));
  $('R').addEventListener('input', e => { S.R = +e.target.value; refreshControls(); regear(); });
  $('r').addEventListener('input', e => { S.r = +e.target.value; refreshControls(); regear(); });
  $('hole').addEventListener('input', e => { S.hole = +e.target.value; refreshControls(); regear(); });
  $('loops').addEventListener('input', e => {
    const L = closure(S.R, S.r).laps, v = +e.target.value;
    S.loops = v >= L ? 0 : v; refreshControls();
    const a = S.active;
    if (a) {
      const end = a.t0 + TAU * (S.loops || L);
      if (end > a.tMax) { a.tEnd = end; if (!S.held) S.playing = true; } else { a.tEnd = Math.max(a.tMax, end); finishTrace(); }
      updatePlay(); capKey = ''; updateCaption();
    }
  });
  const sp = $('speed');
  const showSpeed = () => { S.speed = +sp.value; setText('speedV', `${(userRate() / TAU).toFixed(2)} laps/s`); };
  sp.addEventListener('input', () => { showSpeed(); if (S.active) S.active.rate = 0; S.presetRate = 0; });
  showSpeed();
  $('playBtn').addEventListener('click', togglePlay);
  $('dockPlay').addEventListener('click', togglePlay);
  $('finishBtn').addEventListener('click', finishNow);
  $('undoBtn').addEventListener('click', undo);
  $('clearBtn').addEventListener('click', clearSheet);
  $('dockClear').addEventListener('click', clearSheet);
  $('dockPreset').addEventListener('click', () => loadPreset((S.preset + 1) % PRESETS.length));
  $('gearsBtn').addEventListener('click', () => setGears(!S.gears));
  $('dockGears').addEventListener('click', () => setGears(!S.gears));
  document.querySelectorAll('#paperSeg button').forEach(b => b.addEventListener('click', () => setPaper(b.dataset.paper)));
  $('pngBtn').addEventListener('click', exportPNG);
  $('svgBtn').addEventListener('click', exportSVG);
  for (const el of document.querySelectorAll('.sci-sym[data-tex]')) {
    const tex = el.dataset.tex, cls = RULES.find(q => q[0] === tex);
    typeset(el, tex, { display: false, rules: cls ? [cls] : null });
  }
}
function bindKeys() {
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,select,textarea') && e.key !== ' ') return;
    if (e.metaKey || e.ctrlKey || e.altKey) { if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); } return; }
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'f') finishNow();
    else if (k === 'z') undo();
    else if (k === 'c') clearSheet();
    else if (k === 'g') setGears(!S.gears);
    else if (e.key === 'ArrowRight') loadPreset((S.preset + 1) % PRESETS.length);
    else if (e.key === 'ArrowLeft') loadPreset((S.preset + PRESETS.length - 1 + (S.preset < 0 ? 1 : 0)) % PRESETS.length);
  });
}
// Turn the wheel by hand: the wheel center follows the angle of the pointer
// about the sheet center.
function bindDrag() {
  const ang = e => { const q = sheet.getBoundingClientRect(); return Math.atan2(e.clientY - q.top - q.height / 2, e.clientX - q.left - q.width / 2); };
  sheet.addEventListener('pointerdown', e => {
    if (!S.active) return;
    if (S.active.tMax >= S.active.tEnd - 1e-9) { liftPen(); startTrace(specNow()); }
    S.drag = { a: ang(e) }; sheet.classList.add('drag');
    try { sheet.setPointerCapture(e.pointerId); } catch (x) {}
  });
  sheet.addEventListener('pointermove', e => {
    if (!S.drag || !S.active) return;
    const a = ang(e); let da = a - S.drag.a;
    if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
    S.drag.a = a;
    moveTo(S.active.t + da);
  });
  const end = () => { if (!S.drag) return; S.drag = null; sheet.classList.remove('drag'); S.held = true; S.playing = true; updatePlay(); };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

// ── panel ──────────────────────────────────────────────────────────────────
const panel = $('panel');
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
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

// ── export ─────────────────────────────────────────────────────────────────
function allTraces() {
  const a = S.active, list = S.traces.slice();
  if (a && a.tMax > a.t0) list.push({ ...a, t1: a.tMax });
  return list;
}
function download(blob, name) {
  const u = URL.createObjectURL(blob), l = document.createElement('a');
  l.href = u; l.download = name; document.body.append(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
function exportPNG() {
  const n = 2048, c = n / 2, k = n / 2 / S.units, ws = n / 800;
  const out = document.createElement('canvas'); out.width = out.height = n;
  const x = out.getContext('2d'); drawPaper(x, n, S.paper);
  const layer = document.createElement('canvas'); layer.width = layer.height = n;
  const lx = layer.getContext('2d');
  for (const tr of allTraces()) {
    lx.clearRect(0, 0, n, n); strokeTrace(lx, tr, tr.t0, tr.t1, k, c, ws);
    x.save(); x.globalCompositeOperation = blend(); x.globalAlpha = INK_A; x.drawImage(layer, 0, 0); x.restore();
  }
  out.toBlob(b => b && download(b, 'spirograph.png'), 'image/png');
}
function exportSVG() {
  const n = 1000, c = n / 2, k = n / 2 / S.units, ws = n / 800;
  const paths = allTraces().map(tr => {
    const pts = samplePath(tr.R, tr.r, tr.out, tr.d, tr.rot, tr.t0, tr.t1, 0.9 / k);
    let d = `M${(c + pts[0] * k).toFixed(1)} ${(c + pts[1] * k).toFixed(1)}`;
    for (let i = 2; i < pts.length; i += 2) d += `L${(c + pts[i] * k).toFixed(1)} ${(c + pts[i + 1] * k).toFixed(1)}`;
    return `  <path d="${d}" stroke="${INKS[tr.pen][S.paper]}" stroke-width="${(WIDTHS[tr.w].px * ws).toFixed(2)}"/>`;
  });
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n}" height="${n}">
  <rect width="${n}" height="${n}" fill="${PAPER[S.paper]}"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${INK_A}" style="mix-blend-mode:${blend()}">
${paths.join('\n')}
  </g>
</svg>
`;
  download(new Blob([svg], { type: 'image/svg+xml' }), 'spirograph.svg');
}

// ── loop ───────────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  advance(dt);
  if (S.saver) saverStep(now);
  if (S.rigDirty) { drawRig(); S.rigDirty = false; updateCaption(); }
  if (S.saver) drawGlow(now);
  if (S.saver && S.saver.comp) composite(S.saver.comp);
  requestAnimationFrame(frame);
}
function composite(cv) {
  const n = paperC.width;
  if (cv.width !== n) { cv.width = cv.height = n; }
  const x = cv.getContext('2d');
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.drawImage(paperC, 0, 0);
  const g = S.saver && S.saver.glow;
  if (g) { x.globalCompositeOperation = 'screen'; x.filter = 'blur(6px)'; x.drawImage(g, 0, 0, n, n); x.filter = 'none'; }
  x.globalCompositeOperation = blend(); x.drawImage(dryC, 0, 0); x.globalAlpha = inkA(); x.drawImage(wetC, 0, 0);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = S.saver ? SAVER_RIG_A : 1; x.drawImage(rigC, 0, 0);
}
// The soft copy of the ink: #dry and #wet at a quarter of the size. CSS
// blurs the #glow canvas and screens it under the sharp lines. It is drawn
// again when the ink changes (a new tMax, a new trace, a new size), at most
// 20 times in a second.
function drawGlow(now) {
  const s = S.saver, g = s.glow; if (!g) return;
  const n = Math.max(1, Math.round(dryC.width / 4)), a = S.active;
  const key = `${dryC.width}|${S.traces.length}|${S.preset}|${a ? a.tMax : 0}`;
  if (key === s.glowKey || (now - s.glowAt < 50 && g.width === n)) return;
  s.glowKey = key; s.glowAt = now;
  if (g.width !== n) { g.width = g.height = n; }
  const x = g.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';   // a box filter, so thin lines do not break
  x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, n, n);
  x.globalCompositeOperation = 'lighter';
  x.drawImage(dryC, 0, 0, n, n); x.drawImage(wetC, 0, 0, n, n);
}

// ── screensaver ────────────────────────────────────────────────────────────
// lib/screensaver.js has the protocol. The tour draws one preset after
// another. Each preset draws in about 70% of its dwell, rests, and fades.
// The plate names the preset, gives the tooth counts as parameters, and the
// panel's own TeX (TEX_IN or TEX_OUT, TEX_CLOSE, SLIP_*) with RULES. The
// plain eq list stays as the fallback. The anchor is penAnchor().
function saverLabel() {
  const s = S.saver, a = S.active; if (!s || !a) return;
  const { g, petals, laps } = closure(a.R, a.r), q = (a.d / a.r).toFixed(2);
  const eq = a.out
    ? ['x = (R + r) cos t − d cos((R + r)t / r)', 'y = (R + r) sin t − d sin((R + r)t / r)']
    : ['x = (R − r) cos t + d cos((R − r)t / r)', 'y = (R − r) sin t − d sin((R − r)t / r)'];
  eq.push(`g = gcd(${a.R}, ${a.r}) = ${g}`, `n = R/g = ${petals},  L = r/g = ${laps}`);
  s.label({
    title: PRESETS[S.preset] ? PRESETS[S.preset].name : 'Spirograph',
    sub: a.out ? 'Epitrochoid: the wheel rolls outside the ring' : 'Hypotrochoid: the wheel rolls inside the ring',
    params: [
      { sym: 'R', name: 'ring teeth', value: String(a.R), cls: 'm1' },
      { sym: 'r', name: 'wheel teeth', value: String(a.r), cls: 'm2' },
      { sym: 'd', name: 'pen hole offset', value: `${q} r`, cls: 'm3' },
      { sym: 'n', name: `petals, closes in ${laps} laps`, value: String(petals), cls: 'm6' },
    ],
    lines: ['The wheel rolls without slip, so the pen closes the curve after L laps.'],
    tex: [a.out ? TEX_OUT : TEX_IN, TEX_CLOSE, a.out ? SLIP_OUT : SLIP_IN],
    rules: RULES,
    eq,
    anchor: penAnchor,
  });
}
// The rig on screen, for the shell's label plate, in page CSS px. The rig
// canvas maps one unit to S.k device px about the sheet centre, turned by
// a.rot (see drawRig). x, y: the ring centre. r: the reach of the rig,
// extent(R, r, out). pts: the pen hole (penAt), so the leader points at it.
function penAnchor() {
  const a = S.active; if (!a || !S.k) return null;
  const q = sheet.getBoundingClientRect(); if (!q.width) return null;
  const u = S.k / S.dpr, cx = q.left + q.width / 2, cy = q.top + q.height / 2;
  const [px, py] = penAt(a.R, a.r, a.out, a.d, a.t), c = Math.cos(a.rot), s = Math.sin(a.rot);
  return { x: cx, y: cy, r: extent(a.R, a.r, a.out) * u, pts: [{ x: cx + (px * c - py * s) * u, y: cy + (px * s + py * c) * u }] };
}
function saverStep(now) {
  const s = S.saver;
  if (s.key !== `${S.preset}|${S.active && S.active.R}|${S.active && S.active.r}|${S.active && S.active.d}`) {
    s.key = `${S.preset}|${S.active && S.active.R}|${S.active && S.active.r}|${S.active && S.active.d}`;
    saverLabel();
  }
  if (now < s.until) return;
  if (s.phase === 'draw') { s.phase = 'fade'; sheet.style.opacity = '0'; s.until = now + 1100; }
  else if (s.phase === 'fade') {
    s.i = (s.i + 1) % s.order.length;
    loadPreset(s.order[s.i], s.drawSec);
    sheet.style.opacity = '1'; s.phase = 'draw'; s.until = now + s.hold;
  }
}
window.snSaver = {
  enter(o = {}) {
    const calm = clamp(o.calm ?? 0.7, 0, 1);
    const rnd = mulberry((o.seed >>> 0) || 1);
    const order = PRESETS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const hold = Math.max(14, (o.seconds || 60) / 2) * 1000 * (0.85 + 0.3 * calm);
    const st = document.createElement('style');
    st.id = 'saverStyle';
    st.textContent = '.topbar,#panel,#dock,#gear,#caption{display:none!important}#desk{top:0!important;bottom:0!important}#sheet{cursor:none;transition:opacity 1s ease}' +
      `#glow{mix-blend-mode:screen;filter:blur(5px);opacity:0.9}#sheet #rig{opacity:${SAVER_RIG_A}}`;
    document.head.append(st);
    const glow = document.createElement('canvas'); glow.id = 'glow';
    dryC.before(glow);
    S.saver = { label: typeof o.label === 'function' ? o.label : () => {}, order, i: 0, hold, drawSec: hold / 1000 * 0.7, phase: 'draw', until: performance.now() + hold, key: '', comp: document.createElement('canvas'), glow, glowKey: '', glowAt: 0, paper: S.paper };
    S.held = false; setGears(true);
    panel.classList.remove('open'); layout();
    loadPreset(order[0], S.saver.drawSec);
    return { canvas: S.saver.comp, warmupMs: 600 };
  },
  exit() {
    const st = $('saverStyle'); if (st) st.remove();
    const paper = S.saver ? S.saver.paper : S.paper;
    if (S.saver) { S.saver.label(null); S.saver.glow.remove(); }
    S.saver = null; sheet.style.opacity = '';
    setPaper(paper);              // draws the ink again in the pen colors
    setOpen(!PHONE_Q.matches);
  },
};

// ── boot ───────────────────────────────────────────────────────────────────
bindUI(); bindKeys(); bindDrag(); bindPanel();
setPaper('cream', true);
if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
layout();
addEventListener('resize', layout);
loadPreset(0);
if (document.fonts) document.fonts.ready.then(() => { S.sprites = null; S.rigDirty = true; });
requestAnimationFrame(frame);
window.__spiro = { S, loadPreset, finishNow, layout, thumb, PRESETS };
