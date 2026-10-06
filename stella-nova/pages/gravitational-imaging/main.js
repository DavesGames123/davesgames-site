// ============================================================================
//  GRAVITATIONAL IMAGING  ·  page logic (ES module)
// ----------------------------------------------------------------------------
//  Binds the figures of index.html to the lens engine (lens.js) and the
//  default model (model.js). Each section starts when it first scrolls into
//  view. All lens work runs on the CPU in this thread; the heavy parts
//  (sections 3 and 4) are debounced and run after the input stops.
//
//  Shared state ST holds the lens, the source lobes and the perturbers.
//  Moving V or changing its mass bumps ST.rev; a section redraws when its
//  copy of rev is old.
//
//  GREP MAP
//    grep -n 'function fitCanvas'   canvas sizing at devicePixelRatio
//    grep -n 'function drawField'   n x n field to a canvas, cover crop
//    grep -n 'function dragOn'      handle drag + tap, keeps page scroll
//    grep -n 'function initSky'     section 1 sky and source plane
//    grep -n 'function initGap'     section 2 gap, residual, caustic kink
//    grep -n 'function initRes'     section 3 beam size and floor chart
//    grep -n 'function initGI'      section 4 gravitational imaging
//    grep -n 'function initPivot'   section 5 M(<r) and Table 1
//    grep -n 'function initDM'      section 6 subhalo counts
//    grep -n 'function initChips'   sticky section bar
// ============================================================================
import * as E from './lens.js';
import { LENS, LOBES, V0, A0, INSTRUMENTS, DETECTIONS, TABLE1 } from './model.js';
import { NOISE, FLOOR } from './floor.js';
import { typesetAll } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const M80_PAPER = 1.13e6;
const fmtM = m => { const e = Math.floor(Math.log10(m)); return `${(m / 10 ** e).toFixed(2)} × 10${sup(e)}`; };
const sup = e => String(e).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] || (c === '-' ? '⁻' : c)).join('');
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------------------------------------------------------------- state
const ST = {
  lens: { ...LENS },
  lobes: LOBES.map(o => ({ ...o })),
  V: { ...V0 },
  A: { ...A0 },
  m80: M80_PAPER,
  subsOn: true,
  vOn: true,
  rev: 0,          // lens or V changed
  srev: 0,         // source changed
};
const setM80 = m80 => { ST.m80 = m80; ST.V.m = E.pjTotalFor(m80, ST.V.rt); ST.rev++; };
setM80(M80_PAPER);
// The lens with A and (when on) V.
const lensWith = (vOn = ST.vOn) => ({ ...ST.lens, subs: ST.subsOn ? [ST.A, { ...ST.V, on: vOn }] : [] });
const lensOthers = () => ({ ...ST.lens, subs: ST.subsOn ? [ST.A] : [] });
const listeners = [];
const changed = () => { for (const f of listeners) f(); };

// ---------------------------------------------------------------- shared helpers
// Size a 2D canvas to its CSS box at devicePixelRatio (capped at 2).
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

// Colour maps. hot: radio surface brightness, 0..1. div: -1..1, blue to
// black to red.
function hot(v) {
  v = clamp(v, 0, 1);
  return [255 * clamp(v * 1.6, 0, 1), 255 * clamp(v * 1.6 - 0.45, 0, 1) * 0.92, 255 * clamp(v * 2.2 - 1.2, 0, 1)];
}
function div(v) {
  v = clamp(v, -1, 1);
  const a = Math.abs(v) ** 0.8;
  return v >= 0 ? [255 * a, 90 * a * a, 70 * a * a] : [70 * a * a, 140 * a, 255 * a];
}

// World (mas) to canvas px for a square window drawn with a cover crop.
function view(win, w, h) {
  const s = Math.max(w, h) / win.size;
  return {
    s,
    x: x => w / 2 + (x - win.x0) * s,
    y: y => h / 2 - (y - win.y0) * s,
    wx: px => win.x0 + (px - w / 2) / s,
    wy: py => win.y0 - (py - h / 2) / s,
  };
}

// Draw an n x n field to a canvas through a colour map, cover-cropped.
const scratch = document.createElement('canvas');
function drawField(cv, arr, n, map, smooth = true) {
  const { g, w, h } = fitCanvas(cv);
  if (scratch.width !== n) { scratch.width = n; scratch.height = n; }
  const sg = scratch.getContext('2d'), im = sg.createImageData(n, n), d = im.data;
  for (let p = 0; p < n * n; p++) { const c = map(arr[p]); d[4 * p] = c[0]; d[4 * p + 1] = c[1]; d[4 * p + 2] = c[2]; d[4 * p + 3] = 255; }
  sg.putImageData(im, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = smooth;
  const s = Math.max(w, h);
  g.drawImage(scratch, (w - s) / 2, (h - s) / 2, s, s);
  return { g, w, h };
}

function segs(g, V, arr, color, width = 1, dash = null) {
  g.save(); g.strokeStyle = color; g.lineWidth = width; if (dash) g.setLineDash(dash);
  g.beginPath();
  for (let k = 0; k < arr.length; k += 4) { g.moveTo(V.x(arr[k]), V.y(arr[k + 1])); g.lineTo(V.x(arr[k + 2]), V.y(arr[k + 3])); }
  g.stroke(); g.restore();
}
function cross(g, x, y, r, color, label) {
  g.save(); g.strokeStyle = '#000'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
  g.strokeStyle = color; g.lineWidth = 2; g.stroke();
  if (label) { g.font = 'italic 600 14px "STIX Two Text", Georgia, serif'; g.fillStyle = color; g.fillText(label, x + r + 3, y - r); }
  g.restore();
}
function scaleBar(g, V, mas, h, label) {
  const L = mas * V.s;
  g.save(); g.strokeStyle = '#fff'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(10, h - 26); g.lineTo(10 + L, h - 26); g.stroke(); g.restore();
  return label;
}
// Marching squares on an n x n field: segments where f = level, in pixel
// units of the field (0..n-1).
function contour(f, n, level) {
  const out = [];
  const L = (a, b, i0, j0, i1, j1) => { const t = (level - a) / (b - a); return [i0 + (i1 - i0) * t, j0 + (j1 - j0) * t]; };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = f[j * n + i], b = f[j * n + i + 1], c = f[(j + 1) * n + i + 1], d = f[(j + 1) * n + i];
    const p = [];
    if ((a > level) !== (b > level)) p.push(L(a, b, i, j, i + 1, j));
    if ((b > level) !== (c > level)) p.push(L(b, c, i + 1, j, i + 1, j + 1));
    if ((c > level) !== (d > level)) p.push(L(c, d, i + 1, j + 1, i, j + 1));
    if ((d > level) !== (a > level)) p.push(L(d, a, i, j + 1, i, j));
    if (p.length >= 2) out.push(p[0][0], p[0][1], p[1][0], p[1][1]);
    if (p.length === 4) out.push(p[2][0], p[2][1], p[3][0], p[3][1]);
  }
  return out;
}

// Drag a handle on a canvas. hit(x, y) says if a press is on the handle.
// A press on the handle blocks page scroll (touchstart preventDefault); a
// press elsewhere leaves the swipe to the page. A tap off the handle moves
// the handle there. move(x, y, phase) with phase 'move' or 'end'.
function dragOn(el, hit, move) {
  let id = null, start = null, moved = false, onHandle = false;
  const pos = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  el.addEventListener('touchstart', e => {
    const t = e.touches[0], r = el.getBoundingClientRect();
    if (e.touches.length === 1 && hit(t.clientX - r.left, t.clientY - r.top)) e.preventDefault();
  }, { passive: false });
  el.addEventListener('pointerdown', e => {
    const [x, y] = pos(e);
    id = e.pointerId; start = [x, y]; moved = false; onHandle = hit(x, y);
    if (onHandle) { el.setPointerCapture(id); el.style.cursor = 'grabbing'; }
  });
  el.addEventListener('pointermove', e => {
    const [x, y] = pos(e);
    if (id === e.pointerId && onHandle) {
      if (Math.hypot(x - start[0], y - start[1]) > 2) moved = true;
      move(x, y, 'move');
    } else if (e.pointerType === 'mouse' && id === null) el.style.cursor = hit(x, y) ? 'grab' : 'crosshair';
  });
  const up = e => {
    if (id !== e.pointerId) return;
    const [x, y] = pos(e);
    if (e.type === 'pointerup' && (onHandle ? moved : Math.hypot(x - start[0], y - start[1]) < 6)) move(x, y, 'end');
    else if (onHandle) move(x, y, 'end');
    id = null; onHandle = false; el.style.cursor = '';
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function toggle(id, init, fn) {
  const b = $(id); let on = init;
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  b.addEventListener('click', () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); fn(on); });
  return { set(v) { on = v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } };
}
function seg(id, fn) {
  const el = $(id);
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    fn(b.dataset.v);
  });
}
function debounce(fn, ms) { let t = 0; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
function onVisible(el, fn) {
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px' });
  io.observe(el);
}
// Redraw on size change of an element, coalesced to one frame.
function watchSize(el, fn) {
  let pend = false;
  new ResizeObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; fn(); }); }).observe(el);
}

// Seeded random numbers (mulberry32) and Gaussian noise.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Chart frame: log or linear axes, returns mappers and draws the box.
function chart(cv, o) {
  const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  const pad = { l: 54, r: 12, t: 12, b: 36 };
  const X0 = pad.l, X1 = w - pad.r, Y0 = h - pad.b, Y1 = pad.t;
  const tx = o.xlog ? v => Math.log10(v) : v => v, ty = o.ylog ? v => Math.log10(v) : v => v;
  const [xa, xb] = o.x.map(tx), [ya, yb] = o.y.map(ty);
  const X = v => X0 + (tx(v) - xa) / (xb - xa) * (X1 - X0);
  const Y = v => Y0 - (ty(v) - ya) / (yb - ya) * (Y0 - Y1);
  g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = '#8a91a5'; g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (const v of o.xt) { const x = X(v); g.beginPath(); g.moveTo(x, Y1); g.lineTo(x, Y0); g.stroke(); g.textAlign = 'center'; g.fillText(o.xf(v), x, Y0 + 15); }
  for (const v of o.yt) { const y = Y(v); g.beginPath(); g.moveTo(X0, y); g.lineTo(X1, y); g.stroke(); g.textAlign = 'right'; g.fillText(o.yf(v), X0 - 6, y + 4); }
  g.textAlign = 'center'; g.fillStyle = '#c2c7d4'; g.fillText(o.xl, (X0 + X1) / 2, h - 6);
  g.save(); g.translate(13, (Y0 + Y1) / 2); g.rotate(-Math.PI / 2); g.fillText(o.yl, 0, 0); g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.strokeRect(X0, Y1, X1 - X0, Y0 - Y1);
  return { g, w, h, X, Y, X0, X1, Y0, Y1 };
}
const powLab = v => `10${sup(Math.round(Math.log10(v)))}`;

// ---------------------------------------------------------------- 01 sky
function initSky() {
  const sky = $('skyCv'), src = $('srcCv');
  const SKY = { x0: 0, y0: 10, size: 1300 };
  let opt = { crit: true, marks: true, stretch: false };
  let rays = null, img = null, cc = null, raysRev = -1, imgRev = '', peak = 1, coarse = false;
  const SRCW = () => ({ x0: -9, y0: 22, size: 110 });

  const shootSky = () => {
    const n = coarse ? 128 : (innerWidth < 600 ? 200 : 256);
    rays = E.shoot(lensWith(), { ...SKY, n }, 2);
    raysRev = ST.rev + (coarse ? 0.5 : 0);
    cc = E.critical(lensWith(), { ...SKY, n: coarse ? 90 : 170 });
  };
  const draw = () => {
    const want = ST.rev + (coarse ? 0.5 : 0);
    if (!rays || raysRev !== want) shootSky();
    const key = raysRev + ':' + ST.srev;
    if (imgRev !== key) {
      img = E.render(rays, ST.lobes);
      if (peak === 1) peak = img.reduce((a, b) => Math.max(a, b), 0) * 0.85 || 1;
      imgRev = key;
    }
    const st = opt.stretch, map = st ? v => hot(Math.asinh(v / peak * 25) / Math.asinh(25)) : v => hot(v / peak);
    const { g, w, h } = drawField(sky, img, rays.n, map);
    const V = view(SKY, w, h);
    if (opt.crit) segs(g, V, cc.crit, 'rgba(111,183,255,0.75)', 1);
    if (opt.marks) {
      // 60 mas box around V (Fig. 1 zoom).
      const b = 30 * V.s;
      g.save(); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
      g.strokeRect(V.x(ST.V.x) - b, V.y(ST.V.y) - b, 2 * b, 2 * b); g.restore();
      if (ST.subsOn) cross(g, V.x(ST.A.x), V.y(ST.A.y), 6, css('--ay'), 'A');
      cross(g, V.x(ST.V.x), V.y(ST.V.y), 7, css('--vee'), 'V');
      // lens centre
      g.save(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(V.x(0), V.y(0), 2.5, 0, 7); g.fill(); g.restore();
    }
    scaleBar(g, V, 200, h);
    drawSrc();
  };
  const drawSrc = () => {
    const W = SRCW(), n = 150, px = W.size / n, f = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f[j * n + i] = E.srcEval(ST.lobes, W.x0 - W.size / 2 + (i + 0.5) * px, W.y0 + W.size / 2 - (j + 0.5) * px);
    const { g, w, h } = drawField(src, f, n, v => hot(Math.sqrt(v)));
    const V = view(W, w, h);
    segs(g, V, cc.caus, 'rgba(111,183,255,0.9)', 1.2);
    const o = ST.lobes[0];
    g.save(); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(V.x(o.x), V.y(o.y), 14, 0, 7); g.stroke(); g.restore();
    scaleBar(g, V, 20, h);
    // Image count by ray parity against the caustic.
    let k = 0; const c = cc.caus;
    for (let s = 0; s < c.length; s += 4) {
      const [ax, ay, bx, by] = [c[s], c[s + 1], c[s + 2], c[s + 3]];
      if ((ay > o.y) !== (by > o.y)) { const x = ax + (o.y - ay) / (by - ay) * (bx - ax); if (x > o.x) k++; }
    }
    // Distance to the caustic. On the fold the parity test is ambiguous:
    // that is where two images merge into the arc.
    let dmin = Infinity;
    for (let s = 0; s < c.length; s += 4) {
      const ex = c[s + 2] - c[s], ey = c[s + 3] - c[s + 1], l2 = ex * ex + ey * ey || 1e-12;
      const t = clamp(((o.x - c[s]) * ex + (o.y - c[s + 1]) * ey) / l2, 0, 1);
      dmin = Math.min(dmin, Math.hypot(o.x - c[s] - t * ex, o.y - c[s + 1] - t * ey));
    }
    const nImg = dmin < 1.5 ? 'on the fold: two of them merge into the arc' : (k % 2 ? '4' : '2');
    $('srcRead').innerHTML = `<span>bright lobe β<b>(${o.x.toFixed(1)}, ${o.y.toFixed(1)}) mas</b></span><span>images<b>${nImg}</b></span>`;
  };
  let pend = false;
  const req = () => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; draw(); }); };
  listeners.push(req);

  // Drag V on the sky.
  dragOn(sky, (x, y) => {
    const r = sky.getBoundingClientRect(), V = view(SKY, r.width, r.height);
    return Math.hypot(x - V.x(ST.V.x), y - V.y(ST.V.y)) < 22;
  }, (x, y, phase) => {
    const r = sky.getBoundingClientRect(), V = view(SKY, r.width, r.height);
    ST.V.x = V.wx(x); ST.V.y = V.wy(y); coarse = phase === 'move'; ST.rev++; changed();
  });
  // Drag the bright lobe (and its jet).
  dragOn(src, (x, y) => {
    const r = src.getBoundingClientRect(), V = view(SRCW(), r.width, r.height), o = ST.lobes[0];
    return Math.hypot(x - V.x(o.x), y - V.y(o.y)) < 26;
  }, (x, y) => {
    const r = src.getBoundingClientRect(), V = view(SRCW(), r.width, r.height);
    const nx = V.wx(x), ny = V.wy(y), dx = nx - ST.lobes[0].x, dy = ny - ST.lobes[0].y;
    ST.lobes[0].x += dx; ST.lobes[0].y += dy; ST.lobes[1].x += dx; ST.lobes[1].y += dy;
    ST.srev++; changed();
  });
  toggle('tCrit', true, v => { opt.crit = v; req(); });
  toggle('tMarks', true, v => { opt.marks = v; req(); });
  toggle('tStretch', false, v => { opt.stretch = v; req(); });
  toggle('tSubs', true, v => { ST.subsOn = v; ST.rev++; changed(); });
  $('skyReset').addEventListener('click', () => {
    ST.lobes = LOBES.map(o => ({ ...o })); ST.V.x = V0.x; ST.V.y = V0.y; coarse = false;
    ST.rev++; ST.srev++; changed();
  });
  watchSize(sky, req); watchSize(src, req);
  req();
}

// ---------------------------------------------------------------- 02 gap
function initGap() {
  let ex = null, seen = '', beam = true;
  const out = $('vMassOut'), sl = $('vMass');
  const run = () => {
    const key = ST.rev + ':' + ST.srev;
    if (key !== seen) {
      seen = key;
      if (ST.vOn) ex = E.experiment({ lens: lensOthers(), lobes: ST.lobes, sub: ST.V, fwhm: 5, noise: NOISE, n: 128 });
      else {
        // No V: data and model are the same smooth lens.
        const win = { x0: ST.V.x, y0: ST.V.y, size: 60, n: 128 }, px = 60 / 128;
        const I = E.render(E.shoot(lensOthers(), win, 2), ST.lobes), B = E.blur(I, 128, 5 / 2.355 / px);
        ex = { win, data: B, model: B, I1: I, I0: I, res: new Float32Array(128 * 128), max: 0 };
      }
    }
    draw();
  };
  const draw = () => {
    if (!ex) return;
    const n = ex.win.n, pk = (beam ? ex.model : ex.I0).reduce((a, b) => Math.max(a, b), 0) || 1;
    drawField($('gapData'), beam ? ex.data : ex.I1, n, v => hot(v / pk));
    drawField($('gapModel'), beam ? ex.model : ex.I0, n, v => hot(v / pk));
    const sc = Math.max(5, ex.max);
    const r = drawField($('gapRes'), ex.res, n, v => div(v / sc));
    const V = view(ex.win, r.w, r.h);
    cross(r.g, V.x(ST.V.x), V.y(ST.V.y), 5, css('--vee'));
    const tE = E.thetaE(ST.V.m), a80 = E.pjMass(E.R80, ST.V.m, ST.V.rt) / (Math.PI * E.SIGMA_CR * E.R80);
    const mg = E.magnification(lensOthers(), ST.V.x, ST.V.y);
    const mt = Math.abs(1 / mg.lt), mtS = mt > 999 ? '> 1000' : mt.toFixed(0);
    $('gapRead').innerHTML =
      `<span>m<sub>tot</sub><b>${fmtM(ST.V.m)} M☉</b></span>` +
      `<span>θ<sub>E</sub>(m<sub>tot</sub>)<b>${tE.toFixed(2)} mas</b></span>` +
      `<span>pull at 80 pc<b>${a80 < 0.1 ? (a80 * 1000).toFixed(0) + ' μas' : a80.toFixed(2) + ' mas'}</b></span>` +
      `<span>tangential magnification at V<b>${mtS}</b></span>` +
      `<span>peak residual<b>${ex.max.toFixed(1)}σ</b></span>` +
      `<span>colour range<b>±${sc.toFixed(0)}σ</b></span>`;
    drawCaus();
  };
  const drawCaus = () => {
    const o = ST.lobes[0], W = { x0: o.x, y0: o.y, size: 12 }, n = 140, px = W.size / n, f = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f[j * n + i] = E.srcEval(ST.lobes, W.x0 - 6 + (i + 0.5) * px, W.y0 + 6 - (j + 0.5) * px);
    const { g, w, h } = drawField($('causCv'), f, n, v => hot(v * 0.9));
    const V = view(W, w, h), zw = { x0: ST.V.x, y0: ST.V.y, size: 70, n: 160 };
    const c0 = E.critical(lensOthers(), zw).caus;
    segs(g, V, c0, 'rgba(111,183,255,0.9)', 1.4, [5, 4]);
    if (ST.vOn) segs(g, V, E.critical(lensWith(true), zw).caus, css('--vee'), 1.8);
    g.save(); g.fillStyle = '#ddd'; g.font = '11px Inter, sans-serif'; g.fillText('2 mas', 10, h - 32); g.restore();
    scaleBar(g, V, 2, h);
  };
  const go = debounce(run, 60);
  const setOut = () => { out.textContent = `${fmtM(ST.m80)} M☉`; };
  sl.addEventListener('input', () => { setM80(10 ** +sl.value); setOut(); changed(); });
  $('vPaper').addEventListener('click', () => { sl.value = Math.log10(M80_PAPER); setM80(M80_PAPER); setOut(); changed(); });
  toggle('tVon', true, v => { ST.vOn = v; ST.rev++; changed(); });
  toggle('tBeam', true, v => { beam = v; draw(); });
  listeners.push(go);
  ['gapData', 'gapModel', 'gapRes', 'causCv'].forEach(id => watchSize($(id), draw));
  setOut(); run();
}

// ---------------------------------------------------------------- 03 resolution
function initRes() {
  const sl = $('fwhm'), out = $('fwhmOut'), segEl = $('inst');
  for (const it of INSTRUMENTS) {
    const b = document.createElement('button'); b.textContent = it.label; b.dataset.v = it.fwhm;
    if (it.id === 'vlbi') b.classList.add('on');
    segEl.appendChild(b);
  }
  let ex = null, seen = '';
  const fw = () => 10 ** +sl.value;
  const syncSeg = () => segEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.v - fw()) / fw() < 0.02));
  const run = () => {
    const key = ST.rev + ':' + ST.srev + ':' + sl.value;
    if (key === seen) return; seen = key;
    if (!ST.vOn) { ex = null; drawAll(); return; }
    $('resData').parentElement.parentElement.classList.add('busy');
    setTimeout(() => {
      ex = E.experiment({ lens: lensOthers(), lobes: ST.lobes, sub: ST.V, fwhm: fw(), noise: NOISE, n: 96 });
      $('resData').parentElement.parentElement.classList.remove('busy');
      drawAll();
    }, 10);
  };
  const drawAll = () => {
    out.textContent = `${fw() < 10 ? fw().toFixed(1) : fw().toFixed(0)} mas`;
    if (ex) {
      const n = ex.win.n, pk = ex.model.reduce((a, b) => Math.max(a, b), 0) || 1;
      drawField($('resData'), ex.data, n, v => hot(v / pk));
      const sc = Math.max(5, ex.max);
      const r = drawField($('resRes'), ex.res, n, v => div(v / sc));
      const V = view(ex.win, r.w, r.h);
      cross(r.g, V.x(ST.V.x), V.y(ST.V.y), 5, css('--vee'));
      // Beam circle on the data panel.
      const d = fitCanvas($('resData'));
      d.g.save(); d.g.strokeStyle = 'rgba(255,255,255,0.8)'; d.g.setLineDash([3, 3]);
      d.g.beginPath(); d.g.arc(d.w - 12 - fw() / 2 * V.s, d.h - 12 - fw() / 2 * V.s, Math.max(2, fw() / 2 * V.s), 0, 7); d.g.stroke(); d.g.restore();
      $('resScale').textContent = `window ${ex.win.size.toFixed(0)} mas`;
      const yes = ex.max >= 5;
      $('resVerdict').innerHTML = `<span class="verdict ${yes ? 'yes' : 'no'}">${yes ? 'Detected' : 'Not detected'}: peak residual ${ex.max.toFixed(1)}σ ${yes ? '≥' : '<'} 5σ</span>`;
      $('resRead').innerHTML = `<span>beam / θ<sub>E</sub>(m<sub>tot</sub>)<b>${(fw() / E.thetaE(ST.V.m)).toFixed(1)}</b></span><span>m<sub>80</sub><b>${fmtM(ST.m80)} M☉</b></span><span>colour range<b>±${sc.toFixed(0)}σ</b></span>`;
    } else {
      $('resVerdict').innerHTML = '<span class="verdict no">V is off in section 2</span>';
    }
    drawFloor();
  };
  const drawFloor = () => {
    const c = chart($('floorCv'), {
      x: [2, 160], y: [1e4, 3e9], xlog: true, ylog: true,
      xt: [2, 5, 10, 20, 50, 100], yt: [1e4, 1e5, 1e6, 1e7, 1e8, 1e9],
      xf: v => String(v), yf: powLab, xl: 'beam FWHM (mas)', yl: 'mass (M☉)',
    });
    const { g, X, Y } = c;
    // detectable region
    g.save(); g.fillStyle = 'rgba(94,224,138,0.07)'; g.beginPath();
    FLOOR.forEach((p, i) => i ? g.lineTo(X(p.fwhm), Y(p.m80)) : g.moveTo(X(p.fwhm), Y(p.m80)));
    g.lineTo(X(FLOOR[FLOOR.length - 1].fwhm), Y(3e9)); g.lineTo(X(FLOOR[0].fwhm), Y(3e9)); g.closePath(); g.fill();
    g.strokeStyle = css('--vee'); g.lineWidth = 2; g.beginPath();
    FLOOR.forEach((p, i) => i ? g.lineTo(X(p.fwhm), Y(p.m80)) : g.moveTo(X(p.fwhm), Y(p.m80))); g.stroke();
    g.fillStyle = 'rgba(94,224,138,0.8)'; g.font = '11px Inter, sans-serif'; g.textAlign = 'left';
    g.fillText('toy 5σ floor', X(FLOOR[2].fwhm) + 4, Y(FLOOR[2].m80) - 8);
    // past detections
    for (const d of DETECTIONS) {
      const x = X(d.fwhm), y = Y(d.m), isV = d.label.endsWith(' V');
      g.fillStyle = isV ? css('--vee') : css('--arc');
      g.beginPath(); g.arc(x, y, isV ? 5.5 : 4.5, 0, 7); g.fill();
      g.fillStyle = '#e8eaf0'; g.textAlign = d.fwhm > 60 ? 'right' : 'left';
      g.fillText(`${d.label} (${d.inst})`, x + (d.fwhm > 60 ? -8 : 8), y + (d.dy ?? (isV ? 14 : -7)));
    }
    // current setting
    const yes = ex && ex.max >= 5;
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(fw()), c.Y1); g.lineTo(X(fw()), c.Y0); g.stroke(); g.setLineDash([]);
    g.strokeStyle = yes ? css('--vee') : css('--pos'); g.lineWidth = 2;
    g.beginPath(); g.arc(X(fw()), Y(ST.m80), 7, 0, 7); g.stroke();
    g.restore();
  };
  const go = debounce(run, 140);
  sl.addEventListener('input', () => { syncSeg(); out.textContent = `${fw() < 10 ? fw().toFixed(1) : fw().toFixed(0)} mas`; drawFloor(); go(); });
  seg('inst', v => { sl.value = Math.log10(+v); go(); });
  sl.value = Math.log10(5);
  listeners.push(go);
  watchSize($('floorCv'), drawFloor);
  ['resData', 'resRes'].forEach(id => watchSize($(id), drawAll));
  // Baseline calculator.
  const bk = $('baseKm'), bo = $('baseOut');
  const lam = 299792458 / 1.7e9;
  const base = () => {
    const km = 10 ** +bk.value, th = lam / (km * 1000) * 206264806.2;
    bo.textContent = `${km < 1000 ? km.toFixed(0) : (km / 1000).toFixed(km < 10000 ? 2 : 1) + ' thousand'} km`;
    $('baseRead').innerHTML = `At 1.7 GHz the wavelength is ${(lam * 100).toFixed(1)} cm. A baseline of ${Math.round(km).toLocaleString()} km resolves about λ/B = <b>${th < 10 ? th.toFixed(1) : th.toFixed(0)} mas</b>. ` +
      `The Earth is 12,742 km across, so the best a ground array can do at this frequency is near 3 mas. The real array, with its uneven spread of baselines, gave a 7.4 × 4.7 mas restoring beam. A single 2.4 m mirror at the same wavelength would see only ${(lam / 2.4 * 180 / Math.PI).toFixed(1)}°.`;
  };
  bk.addEventListener('input', base); base();
  run(); drawAll();
}

// ---------------------------------------------------------------- 04 GI
function initGI() {
  const P = { reg: 'mass', G: 33, lam: 5, vIn: true, truth: true, seed: 1 };
  const runs = [];
  let last = null, seen = '';
  const COLORS = ['#ff9a62', '#62c4ff', '#86dc7c', '#e889dc', '#ffd666', '#a8a4ff'];
  const solve = () => {
    const key = [ST.rev, ST.srev, P.reg, P.G, P.lam, P.vIn, P.seed].join(':');
    if (key === seen) { draw(); return; }
    seen = key;
    $('giKap').parentElement.parentElement.classList.add('busy');
    setTimeout(() => {
      const t0 = performance.now();
      const n = 112, win = { x0: ST.V.x + 3, y0: ST.V.y - 2, size: 80, n }, px = win.size / n, psf = 5 / 2.355 / px;
      const truthLens = lensWith(P.vIn && ST.vOn);
      const data = E.blur(E.render(E.shoot(truthLens, win, 2), ST.lobes), n, psf);
      // Noise with the beam's correlation, r.m.s. NOISE per pixel.
      const R = rng(P.seed * 7919 + 13), w = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) w[i] = Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
      const wb = E.blur(w, n, psf); let rr = 0; for (const v of wb) rr += v * v; rr = Math.sqrt(rr / (n * n));
      for (let i = 0; i < n * n; i++) data[i] += wb[i] / rr * NOISE;
      const L0 = lensOthers();
      const model0 = E.blur(E.render(E.shoot(L0, win, 2), ST.lobes), n, psf);
      const res0 = new Float32Array(n * n); let rmax = 0;
      for (let i = 0; i < n * n; i++) { res0[i] = (data[i] - model0[i]) / NOISE; rmax = Math.max(rmax, Math.abs(res0[i])); }
      const out = E.giSolve({ L0, lobes: ST.lobes, win, data, sigma: NOISE, psf, G: P.G, lam: 10 ** P.lam, reg: P.reg, newton: 4, cg: 150 });
      const G = out.G, K = out.kappa, h = out.h;
      const nodeX = k => win.x0 - win.size / 2 + (k % G) * h, nodeY = k => win.y0 + win.size / 2 - Math.floor(k / G) * h;
      // sigma_GI: r.m.s. of kappa on nodes where the data are bright.
      let s = 0, c = 0, pk = 0;
      for (let k = 0; k < K.length; k++) {
        const i = clamp(Math.round((nodeX(k) - (win.x0 - win.size / 2)) / px), 0, n - 1), j = clamp(Math.round(((win.y0 + win.size / 2) - nodeY(k)) / px), 0, n - 1);
        if (data[j * n + i] > 5 * NOISE) { s += K[k] * K[k]; c++; }
        if (K[k] > K[pk]) pk = k;
      }
      const sGI = Math.sqrt(s / Math.max(1, c)) || 1e-9;
      const px0 = nodeX(pk), py0 = nodeY(pk);
      const prof = [];
      for (let rp = 0; rp <= 100; rp += 2) {
        const rm = rp / E.PC_PER_MAS; let m = 0;
        for (let k = 0; k < K.length; k++) if (Math.hypot(nodeX(k) - px0, nodeY(k) - py0) <= rm) m += K[k] * out.cellMass;
        prof.push([rp, m]);
      }
      const m80 = prof.find(p => p[0] === 80)[1];
      last = { win, data, res0, rmax, out, sGI, px0, py0, m80, ms: performance.now() - t0, peak: K[pk] };
      runs.push({ label: `${P.reg}, ${(h).toFixed(1)} mas${P.vIn && ST.vOn ? '' : ', no V'}`, prof, color: COLORS[runs.length % COLORS.length] });
      if (runs.length > 6) runs.shift();
      $('giKap').parentElement.parentElement.classList.remove('busy');
      draw();
    }, 20);
  };
  const draw = () => {
    if (!last) return;
    const { win, out, sGI } = last, G = out.G, K = out.kappa;
    let km = 0; for (const v of K) km = Math.max(km, Math.abs(v));
    const r = drawField($('giKap'), K, G, v => div(v / (km || 1)), true);
    const V = view(win, r.w, r.h), g = r.g;
    // Node grid to canvas: nodes span the window edge to edge.
    const s = Math.max(r.w, r.h), off = [(r.w - s) / 2, (r.h - s) / 2], nx = i => off[0] + i / (G - 1) * s, ny = j => off[1] + j / (G - 1) * s;
    // drawField spans pixel edges, nodes are at centres of G cells; redraw
    // so that node k sits at its world position.
    g.fillStyle = '#000'; g.fillRect(0, 0, r.w, r.h);
    g.imageSmoothingEnabled = true; g.drawImage(scratch, off[0] - s / (G - 1) / 2, off[1] - s / (G - 1) / 2, s + s / (G - 1), s + s / (G - 1));
    // arc contour (10% of peak) from the data
    const dn = win.n, dpk = last.data.reduce((a, b) => Math.max(a, b), 0);
    const cs = contour(last.data, dn, 0.1 * dpk);
    g.save(); g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1; g.beginPath();
    const ps = s / dn;
    for (let k = 0; k < cs.length; k += 4) { g.moveTo(off[0] + (cs[k] + 0.5) * ps, off[1] + (cs[k + 1] + 0.5) * ps); g.lineTo(off[0] + (cs[k + 2] + 0.5) * ps, off[1] + (cs[k + 3] + 0.5) * ps); }
    g.stroke();
    // 3 sigma_GI contour
    const kc = contour(K, G, 3 * sGI);
    g.strokeStyle = '#ffd666'; g.lineWidth = 1.6; g.beginPath();
    for (let k = 0; k < kc.length; k += 4) { g.moveTo(nx(kc[k]), ny(kc[k + 1])); g.lineTo(nx(kc[k + 2]), ny(kc[k + 3])); }
    g.stroke();
    // 80 pc circle round the peak
    g.setLineDash([4, 4]); g.strokeStyle = '#fff'; g.beginPath(); g.arc(V.x(last.px0), V.y(last.py0), E.R80 * V.s, 0, 7); g.stroke(); g.restore();
    if (P.truth && ST.vOn) cross(g, V.x(ST.V.x), V.y(ST.V.y), 5, css('--vee'));
    // residual before GI
    const rs = Math.max(5, last.rmax);
    drawField($('giData'), last.res0, win.n, v => div(v / rs));
    const off2 = Math.hypot(last.px0 - ST.V.x, last.py0 - ST.V.y);
    $('giRead').innerHTML =
      `<span>peak κ / σ<sub>GI</sub><b>${(last.peak / sGI).toFixed(1)}</b></span>` +
      `<span>m<sub>80</sub> round the peak<b>${last.m80 > 0 ? fmtM(last.m80) : last.m80.toExponential(1)} M☉</b></span>` +
      (ST.vOn && P.vIn ? `<span>true m<sub>80</sub><b>${fmtM(ST.m80)} M☉</b></span><span>peak offset from V<b>${off2.toFixed(1)} mas (${(off2 * E.PC_PER_MAS).toFixed(0)} pc)</b></span>` : '') +
      `<span>yellow line<b>3σ<sub>GI</sub></b></span><span>residual range<b>±${rs.toFixed(0)}σ</b></span><span>solve<b>${last.ms.toFixed(0)} ms</b></span>`;
    drawProf();
  };
  const drawProf = () => {
    let ymax = 2e6;
    for (const r of runs) for (const p of r.prof) ymax = Math.max(ymax, p[1] * 1.08);
    const tr = []; for (let rp = 0; rp <= 100; rp += 1) tr.push([rp, E.pjMass(rp / E.PC_PER_MAS, ST.V.m, ST.V.rt)]);
    ymax = Math.max(ymax, tr[tr.length - 1][1] * 1.1);
    const step = ymax > 4e6 ? 1e6 : 5e5, yt = []; for (let v = 0; v <= ymax; v += step) yt.push(v);
    const c = chart($('giProf'), { x: [0, 100], y: [Math.min(0, ...runs.flatMap(r => r.prof.map(p => p[1]))), ymax], xt: [0, 20, 40, 60, 80, 100], yt,
      xf: v => String(v), yf: v => (v / 1e6).toFixed(1), xl: 'r (pc)', yl: 'M(<r)  (10⁶ M☉)' });
    const { g, X, Y } = c;
    g.save(); g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(X(80), c.Y1); g.lineTo(X(80), c.Y0); g.stroke(); g.setLineDash([]);
    if (ST.vOn) { g.strokeStyle = 'rgba(200,200,210,0.85)'; g.lineWidth = 2.5; g.beginPath(); tr.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); }
    runs.forEach((r, k) => {
      g.strokeStyle = r.color; g.lineWidth = 1.6; g.beginPath();
      r.prof.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
      g.fillStyle = r.color; g.font = '11px Inter, sans-serif'; g.textAlign = 'left'; g.fillText(r.label, c.X0 + 8, c.Y1 + 14 + k * 14);
    });
    g.restore();
  };
  const go = debounce(solve, 220);
  seg('giReg', v => { P.reg = v; go(); });
  seg('giGrid', v => { P.G = +v; go(); });
  const ls = $('giLam'), lo = $('giLamOut');
  const lamOut = () => { lo.textContent = `10${sup(Math.round(+ls.value * 10) / 10 === Math.round(+ls.value) ? Math.round(+ls.value) : (+ls.value).toFixed(1))}`; };
  ls.addEventListener('input', () => { P.lam = +ls.value; lamOut(); go(); });
  lamOut();
  toggle('giV', true, v => { P.vIn = v; go(); });
  toggle('giTruth', true, v => { P.truth = v; draw(); });
  $('giNoise').addEventListener('click', () => { P.seed++; go(); });
  $('giClear').addEventListener('click', () => { runs.length = 0; drawProf(); });
  listeners.push(go);
  ['giKap', 'giData'].forEach(id => watchSize($(id), draw));
  watchSize($('giProf'), drawProf);
  solve();
}

// ---------------------------------------------------------------- 05 pivot
function initPivot() {
  const rs = $('rtSl'), ms = $('mtSl');
  let lock = true;
  const rtPc = () => 10 ** +rs.value;
  const sync = () => { if (lock) ms.value = Math.log10(E.pjTotalFor(M80_PAPER, rtPc() / E.PC_PER_MAS)); };
  const draw = () => {
    const rt = rtPc() / E.PC_PER_MAS, mt = 10 ** +ms.value;
    $('rtOut').textContent = `${rtPc().toFixed(0)} pc`; $('mtOut').textContent = `${fmtM(mt)} M☉`;
    const c = chart($('pivotCv'), { x: [0, 200], y: [0, 3.2e6], xt: [0, 40, 80, 120, 160, 200], yt: [0, 1e6, 2e6, 3e6],
      xf: v => String(v), yf: v => (v / 1e6).toFixed(0), xl: 'projected radius r (pc)', yl: 'M(<r)  (10⁶ M☉)' });
    const { g, X, Y } = c;
    const curve = (m, r, col, wd) => { g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); for (let p = 0; p <= 200; p += 2) { const v = E.pjMass(p / E.PC_PER_MAS, m, r); p ? g.lineTo(X(p), Y(v)) : g.moveTo(X(p), Y(v)); } g.stroke(); };
    g.save();
    for (const rp of [131, 140, 149, 158, 167, 53]) { const r = rp / E.PC_PER_MAS; curve(E.pjTotalFor(M80_PAPER, r), r, rp === 53 ? 'rgba(232,137,220,0.55)' : 'rgba(200,200,210,0.28)', 1.2); }
    g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.moveTo(X(80), c.Y1); g.lineTo(X(80), c.Y0); g.stroke(); g.setLineDash([]);
    // m80 with its 1 sigma error
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(80), Y(1.09e6)); g.lineTo(X(80), Y(1.17e6)); g.stroke();
    curve(mt, rt, css('--arc'), 2.6);
    g.fillStyle = 'rgba(232,137,220,0.9)'; g.font = '11px Inter, sans-serif'; g.textAlign = 'left';
    g.fillText('PJ_tidal, rt 53 pc', X(150), Y(E.pjMass(150 / E.PC_PER_MAS, 1.54e6, 53 / E.PC_PER_MAS)) + 14);
    g.fillStyle = '#fff'; g.fillText('80 pc', X(80) + 5, c.Y0 - 6);
    g.restore();
    const m80 = E.pjMass(E.R80, mt, rt);
    $('pivotRead').innerHTML = `<span>m<sub>80</sub><b>${fmtM(m80)} M☉</b></span><span>M(&lt;40 pc)<b>${fmtM(E.pjMass(40 / E.PC_PER_MAS, mt, rt))}</b></span><span>M(&lt;160 pc)<b>${fmtM(E.pjMass(160 / E.PC_PER_MAS, mt, rt))}</b></span>`;
  };
  rs.addEventListener('input', () => { sync(); draw(); });
  ms.addEventListener('input', () => { if (lock) { lockT.set(false); lock = false; } draw(); });
  const lockT = toggle('lockM80', true, v => { lock = v; sync(); draw(); });
  // Table 1.
  const t = $('t1'), base = { PJ_tidal: 16, PJ_free: 16, NFW_sub: 13, None: 0 };
  const pm = (a, d = 2) => a ? `${a[0].toFixed(d)} ± ${a[1].toFixed(d)}` : '–';
  t.innerHTML = '<thead><tr><th>Profile A</th><th>Profile V</th><th>Δlog ℰ</th><th></th><th>σ</th><th>m<sub>80</sub> (10⁶ M☉)</th><th>m<sub>tot</sub> (10⁶ M☉)</th><th>r<sub>t</sub> (pc)</th></tr></thead><tbody>' +
    TABLE1.map((r, i) => {
      const sig = r.v === 'None' ? Math.sqrt(2 * r.dlogE) : Math.sqrt(2 * (r.dlogE - base[r.a]));
      return `<tr class="${r.m80 ? 'pick' : ''}${i === 0 ? ' on' : ''}" data-i="${i}"><td>${r.a}</td><td>${r.v}</td><td class="n">${r.dlogE}</td>` +
        `<td><div class="bar"><i style="width:${(r.dlogE / 364 * 100).toFixed(1)}%"></i></div></td>` +
        `<td class="n">${r.dlogE ? sig.toFixed(1) : '–'}</td><td class="n">${pm(r.m80)}</td><td class="n">${pm(r.mtot)}</td><td class="n">${r.rt ? `${r.rt[0]} ± ${r.rt[1]}` : '–'}</td></tr>`;
    }).join('') + '</tbody>';
  t.addEventListener('click', e => {
    const tr = e.target.closest('tr.pick'); if (!tr) return;
    const r = TABLE1[+tr.dataset.i];
    t.querySelectorAll('tr').forEach(x => x.classList.toggle('on', x === tr));
    lock = false; lockT.set(false);
    rs.value = Math.log10(r.rt[0]); ms.value = Math.log10(r.mtot[0] * 1e6); draw();
  });
  watchSize($('pivotCv'), draw);
  sync(); draw();
}

// ---------------------------------------------------------------- 06 dark matter
function initDM() {
  const sl = $('wdmKev'), out = $('wdmOut');
  let mode = 'cdm';
  // Planck 2015, as in the paper. Half-mode mass of Schneider et al. (2012).
  const H0 = 67.74, Om = 0.3089, Ob = 0.0486, h = H0 / 100, rhom = Om * 2.775e11 * h * h;
  const Mhm = keV => {
    const nu = 1.12, a = 0.049 * keV ** -1.11 * ((Om - Ob) / 0.25) ** 0.11 * (h / 0.7) ** 1.22 / h;
    const lam = 2 * Math.PI * a * (2 ** (nu / 5) - 1) ** (-1 / (2 * nu));
    return 4 * Math.PI / 3 * rhom * (lam / 2) ** 3;
  };
  const AL = -1.9, A2 = 1.1, BE = 1, GA = -0.5;
  const supp = (m, M) => (1 + (A2 * M / m) ** BE) ** GA;
  const MU_CDM = -Math.log(1 - 0.65);
  const ratio = M => { let s = 0, s0 = 0; for (let i = 0; i < 400; i++) { const m = 10 ** (6 + (i + 0.5) / 400); const w = m ** (AL + 2); s += w * supp(m, M); s0 += w; } return s / s0; };
  const keV = () => 10 ** +sl.value;
  const draw = () => {
    const M = mode === 'wdm' ? Mhm(keV()) : 0;
    out.textContent = `${keV().toFixed(1)} keV`;
    sl.disabled = mode !== 'wdm'; sl.parentElement.style.opacity = mode === 'wdm' ? 1 : 0.45;
    const c = chart($('dmCv'), { x: [1e5, 1e10], y: [0, 1.05], xlog: true, xt: [1e5, 1e6, 1e7, 1e8, 1e9, 1e10], yt: [0, 0.25, 0.5, 0.75, 1],
      xf: powLab, yf: v => v.toFixed(2), xl: 'subhalo mass m (M☉)', yl: 'abundance / cold' });
    const { g, X, Y } = c;
    g.save();
    g.fillStyle = 'rgba(255,179,71,0.10)'; g.fillRect(X(1e6), c.Y1, X(1e7) - X(1e6), c.Y0 - c.Y1);
    g.fillStyle = 'rgba(255,179,71,0.8)'; g.font = '11px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('10⁶–10⁷ bin', (X(1e6) + X(1e7)) / 2, c.Y0 - 8);
    // reference curves for the paper's two WDM masses
    for (const k of [9.1, 4.6]) {
      const Mk = Mhm(k);
      g.strokeStyle = 'rgba(200,200,210,0.3)'; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i <= 200; i++) { const m = 10 ** (5 + 5 * i / 200); i ? g.lineTo(X(m), Y(supp(m, Mk))) : g.moveTo(X(m), Y(supp(m, Mk))); }
      g.stroke(); g.fillStyle = 'rgba(200,200,210,0.6)'; g.textAlign = 'left';
      g.fillText(`${k} keV`, X(4e8), Y(supp(4e8, Mk)) + 13);
    }
    g.strokeStyle = mode === 'wdm' ? '#62c4ff' : '#fff'; g.lineWidth = 2.4; g.beginPath();
    for (let i = 0; i <= 200; i++) { const m = 10 ** (5 + 5 * i / 200), v = M ? supp(m, M) : 1; i ? g.lineTo(X(m), Y(v)) : g.moveTo(X(m), Y(v)); }
    g.stroke();
    if (M && M > 1e5 && M < 1e10) { g.setLineDash([3, 3]); g.strokeStyle = '#62c4ff'; g.beginPath(); g.moveTo(X(M), c.Y1); g.lineTo(X(M), c.Y0); g.stroke(); g.setLineDash([]); g.fillStyle = '#62c4ff'; g.textAlign = 'left'; g.fillText('M_hm', X(M) + 4, c.Y0 - 8); }
    // V
    g.fillStyle = css('--vee'); g.beginPath(); g.arc(X(2.82e6), Y(M ? supp(2.82e6, M) : 1), 5, 0, 7); g.fill();
    g.textAlign = 'left'; g.fillText('V (m_tot)', X(2.82e6) + 8, Y(M ? supp(2.82e6, M) : 1) + 18);
    g.restore();
    const mu = MU_CDM * (M ? ratio(M) : 1), P = 1 - Math.exp(-mu);
    $('dmRead').innerHTML = (M ? `<span>M<sub>hm</sub><b>${fmtM(M)} M☉</b></span>` : '') +
      `<span>expected μ<b>${mu.toFixed(2)}</b></span><span>P(n ≥ 1)<b>${P.toFixed(2)}</b></span><span>paper<b>CDM 0.65 · 9.1 keV 0.36 · 4.6 keV 0.14</b></span>`;
  };
  seg('dmMode', v => { mode = v; draw(); });
  sl.addEventListener('input', draw);
  watchSize($('dmCv'), draw);
  draw();
}

// ---------------------------------------------------------------- chips
function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const secs = links.map(a => $(a.dataset.target));
  const io = new IntersectionObserver(() => {
    let best = null;
    for (const s of secs) { const r = s.getBoundingClientRect(); if (r.top < innerHeight * 0.4) best = s; }
    links.forEach(a => {
      const on = best && a.dataset.target === best.id;
      // Scroll only the chip row. scrollIntoView would also scroll the
      // window back to the sticky bar's place at the top of the page.
      if (on && !a.classList.contains('on')) {
        const ol = a.closest('ol'), l = a.offsetLeft - ol.offsetLeft;
        if (l < ol.scrollLeft || l + a.offsetWidth > ol.scrollLeft + ol.clientWidth) ol.scrollTo({ left: l - 12, behavior: 'smooth' });
      }
      a.classList.toggle('on', !!on);
    });
  }, { threshold: [0, 0.25, 0.5, 1] });
  secs.forEach(s => io.observe(s));
}

// ---------------------------------------------------------------- boot
const PAGE = { booted: false, errors: [] };
window.__gi = PAGE;
function safe(name, fn) { try { fn(); } catch (e) { PAGE.errors.push(name + ': ' + e.message); console.error(e); } }
safe('sky', initSky);
onVisible($('s2'), () => safe('gap', initGap));
onVisible($('s3'), () => safe('res', initRes));
onVisible($('s4'), () => safe('gi', initGI));
onVisible($('s5'), () => safe('pivot', initPivot));
onVisible($('s6'), () => safe('dm', initDM));
safe('chips', initChips);
typesetAll(document, [
  ['\\Sigma_{\\rm cr}', 'm5'], ['\\kappa_{\\rm GI}', 'm2'], ['\\kappa', 'm2'], ['\\theta_E', 'm1'],
  ['m_{\\rm tot}', 'm4'], ['r_t', 'm3'], ['\\delta\\psi', 'm6'], ['\\lambda_\\psi', 'm5'], ['M_{\\rm hm}', 'm1'],
]).then(() => { PAGE.math = true; });
PAGE.booted = true;
PAGE.state = ST;
