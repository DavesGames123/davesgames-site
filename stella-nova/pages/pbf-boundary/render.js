// ============================================================================
//  PBF BOUNDARIES RENDER  ·  pages/pbf-boundary/render.js
// ----------------------------------------------------------------------------
//  Draws a solver state (solver.js) on a 2D canvas context. No DOM: the
//  caller passes makeCanvas(w, h) for the offscreen field image, so node
//  tests draw the same frames into the raster mock (widgets/sim-kit/test).
//
//  Layers, back to front:
//    background   theme gradient and a faint grid
//    fluid        "smooth": a splatted field at D / 2.5 per cell, cut at an
//                 iso level, coloured by the water scheme (deep inside, a
//                 lighter rim at the surface) or by a colour map of speed,
//                 density, pressure or vorticity; drawn scaled with
//                 smoothing. "particles": one disc per particle, coloured
//                 the same way (32 colour bins, one path per bin).
//    foam         white dots on fast, lonely particles
//    walls        container, solids, obstacles (theme wall colour)
//    bodies       filled shapes in the object palette, with marks
//                 (duck eye and beak, boat cabin, log rings, a red index
//                 dot so a spin reads)
//    pointer      a ring at the stir point
//
//  grep -n targets
//    view fit ............. "export function fitView"
//    water schemes ........ "export const WATER"
//    field splat .......... "function splat"
//    particle discs ....... "function drawParticles"
//    walls ................ "function drawWalls"
//    bodies ............... "function drawBody"
//    entry ................ "export function draw"
// ============================================================================
import { D, RHO0, DEN0 } from './solver.js';

// Water schemes: deep, mid and surface colours, foam colour.
export const WATER = [
  { id: 'ocean', label: 'Ocean', colors: ['#06306b', '#1569b8', '#7fd3ff'], foam: '#eaf8ff' },
  { id: 'lagoon', label: 'Lagoon', colors: ['#00525a', '#00a6a6', '#9ff5e6'], foam: '#f0fffb' },
  { id: 'glacier', label: 'Glacier', colors: ['#2a5d8a', '#7cb6de', '#e6f6ff'], foam: '#ffffff' },
  { id: 'ink', label: 'Ink', colors: ['#120c2e', '#3b2a8a', '#9b8cff'], foam: '#e8e2ff' },
  { id: 'lava', label: 'Lava', colors: ['#5a0a00', '#d43d00', '#ffc04a'], foam: '#fff1c2' },
  { id: 'slime', label: 'Slime', colors: ['#1b4a00', '#4fb000', '#d4ff6a'], foam: '#f6ffd8' },
  { id: 'milk', label: 'Milk', colors: ['#b9b2a6', '#e8e2d6', '#ffffff'], foam: '#ffffff' },
  { id: 'wine', label: 'Wine', colors: ['#2e0010', '#7a0b2c', '#d64870'], foam: '#ffd6e2' },
  { id: 'mercury', label: 'Mercury', colors: ['#3a3f46', '#9aa3ad', '#f2f5f8'], foam: '#ffffff' },
  { id: 'honey', label: 'Honey', colors: ['#5c2c00', '#c97a00', '#ffd36b'], foam: '#fff4cf' },
];
export const waterById = id => WATER.find(w => w.id === id) || WATER[0];

const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = c => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';

// World to canvas: the domain fills the target rect (device px), centred.
// cam = { zoom, cx, cy } (world centre) for saver close-ups.
export function fitView(S, rect, cam) {
  const pad = 0.02;
  const s0 = Math.min(rect.w / (S.Wd + 2 * pad), rect.h / (S.Hd + 2 * pad));
  const z = cam && cam.zoom ? cam.zoom : 1;
  const s = s0 * z;
  const cx = cam && cam.cx != null ? cam.cx : S.Wd / 2, cy = cam && cam.cy != null ? cam.cy : S.Hd / 2;
  return { s, ox: rect.x + rect.w / 2 - cx * s, oy: rect.y + rect.h / 2 + cy * s, rect };
}
const X = (v, x) => v.ox + x * v.s;
const Y = (v, y) => v.oy - y * v.s;

// A field image cache per state object.
function fieldBuf(R, gw, gh, makeCanvas) {
  if (!R.cv || R.gw !== gw || R.gh !== gh) {
    R.gw = gw; R.gh = gh;
    R.cv = makeCanvas(gw, gh); R.cx2 = R.cv.getContext('2d');
    R.img = R.cx2.createImageData(gw, gh);
    R.f = new Float32Array(gw * gh); R.s = new Float32Array(gw * gh);
  }
  return R;
}

// A colour map starts at LIFT, not at 0: the near-black low end of most
// maps made still water vanish on the dark themes.
const LIFT = 0.16;

// Scalar per particle for the colour-by modes, mapped to 0..1.
function scalar(S, i, by) {
  switch (by) {
    case 'speed': return Math.min(1, Math.hypot(S.vx[i], S.vy[i]) / 2.5);
    case 'density': return Math.max(0, Math.min(1, (S.rho[i] / RHO0 - 0.85) / 0.3));
    case 'pressure': return Math.max(0, Math.min(1, -S.lam[i] * DEN0 / 0.08));
    case 'vorticity': return Math.max(0, Math.min(1, 0.5 + S.om[i] / 60));
    case 'depth': return Math.max(0, Math.min(1, S.y[i] / S.Hd));
  }
  return 0;
}

// Splat every particle into the field grid: f = kernel sum, s = weighted
// scalar sum. Cell = D / 2.5 world units.
function splat(S, R, by, x0, y0, cell) {
  const gw = R.gw, gh = R.gh, f = R.f, sc = R.s;
  f.fill(0); sc.fill(0);
  const rad = 1.7 * D, rc = Math.ceil(rad / cell), r2 = rad * rad, ic = 1 / cell;
  for (let i = 0; i < S.n; i++) {
    const px = (S.x[i] - x0) * ic, py = (S.y[i] - y0) * ic;
    const ci = Math.floor(px), cj = Math.floor(py);
    const v = by === 'water' ? 0 : scalar(S, i, by);
    for (let j = cj - rc; j <= cj + rc; j++) {
      if (j < 0 || j >= gh) continue;
      const dy = (j + 0.5 - py) * cell, dy2 = dy * dy;
      for (let k = ci - rc; k <= ci + rc; k++) {
        if (k < 0 || k >= gw) continue;
        const dx = (k + 0.5 - px) * cell, d2 = dx * dx + dy2;
        if (d2 >= r2) continue;
        const q = 1 - d2 / r2, w = q * q * q;
        const o = (gh - 1 - j) * gw + k;
        f[o] += w; sc[o] += w * v;
      }
    }
  }
}

function drawSmooth(ctx, S, v, look, R, makeCanvas) {
  const cell = D / 2.5;
  const x0 = -0.05, y0 = -0.05, gw = Math.ceil((S.Wd + 0.1) / cell), gh = Math.ceil((S.Hd + 0.1) / cell);
  fieldBuf(R, gw, gh, makeCanvas);
  const by = look.colorBy;
  splat(S, R, by, x0, y0, cell);
  const data = R.img.data, f = R.f, sc = R.s;
  const wcol = waterById(look.water).colors.map(hex);
  const lut = look.lut;           // 768-byte LUT or null
  const iso = 0.32, band = 0.22, a0 = look.alpha != null ? look.alpha : 0.94;
  for (let o = 0, n = gw * gh; o < n; o++) {
    const fv = f[o]; const p = o * 4;
    if (fv < iso - 0.08) { data[p + 3] = 0; continue; }
    const a = Math.min(1, (fv - (iso - 0.08)) / 0.16);
    let c;
    if (by === 'water' || !lut) {
      // inside: deep -> mid with the field; rim: the surface colour
      const t = Math.min(1, (fv - iso) / 1.4);
      c = t < 0 ? wcol[2] : t < band ? mix(wcol[2], wcol[1], t / band) : mix(wcol[1], wcol[0], Math.min(1, (t - band) / (1 - band)));
    } else {
      const s = Math.max(0, Math.min(1, sc[o] / fv)), k = ((LIFT + (1 - LIFT) * s) * 255) | 0;
      c = [lut[3 * k], lut[3 * k + 1], lut[3 * k + 2]];
      // keep the surface readable: a light rim
      if (fv < iso + 0.15) c = mix(c, [255, 255, 255], 0.35 * (1 - (fv - iso + 0.08) / 0.23));
    }
    data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = (a * a0 * 255) | 0;
  }
  R.cx2.putImageData(R.img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(R.cv, X(v, x0), Y(v, y0 + gh * cell), gw * cell * v.s, gh * cell * v.s);
}

const BINS = 32;
function drawParticles(ctx, S, v, look, sizeK) {
  const by = look.colorBy, lut = look.lut, wcol = waterById(look.water).colors.map(hex);
  const r = Math.max(0.8, 0.5 * D * v.s * (sizeK || 1));
  if (!drawParticles.bins) { drawParticles.bins = []; for (let b = 0; b < BINS; b++) drawParticles.bins.push([]); }
  const bins = drawParticles.bins; for (const b of bins) b.length = 0;
  for (let i = 0; i < S.n; i++) {
    let s;
    if (by === 'water' || !lut) { const nb = S.nbc[i]; s = 1 - Math.min(1, nb / 18); s = 0.15 + 0.85 * s; }
    else s = scalar(S, i, by);
    bins[Math.min(BINS - 1, (s * BINS) | 0)].push(i);
  }
  for (let b = 0; b < BINS; b++) {
    const L = bins[b]; if (!L.length) continue;
    const t = (b + 0.5) / BINS;
    let c;
    if (by === 'water' || !lut) c = t < 0.5 ? mix(wcol[0], wcol[1], t * 2) : mix(wcol[1], wcol[2], (t - 0.5) * 2);
    else { const k = ((LIFT + (1 - LIFT) * t) * 255) | 0; c = [lut[3 * k], lut[3 * k + 1], lut[3 * k + 2]]; }
    ctx.fillStyle = rgb(c);
    ctx.beginPath();
    for (const i of L) { const x = X(v, S.x[i]), y = Y(v, S.y[i]); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill();
  }
}

function drawFoam(ctx, S, v, look) {
  const fc = waterById(look.water).foam, r = Math.max(0.7, 0.3 * D * v.s);
  ctx.fillStyle = fc;
  for (const lvl of [0.35, 0.7]) {
    ctx.globalAlpha = lvl === 0.35 ? 0.45 : 0.9;
    ctx.beginPath();
    for (let i = 0; i < S.n; i++) { const f = S.foam[i]; if (f < lvl || (lvl === 0.35 && f >= 0.7)) continue; const x = X(v, S.x[i]), y = Y(v, S.y[i]); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Path of one primitive in world coordinates, with an optional frame
// (x, y, a) for bodies and obstacles.
function primPath(ctx, v, p, fx = 0, fy = 0, fa = 0) {
  const c = Math.cos(fa), s = Math.sin(fa);
  const T = (lx, ly) => [X(v, fx + c * lx - s * ly), Y(v, fy + s * lx + c * ly)];
  switch (p.t) {
    case 'c': { const [x, y] = T(p.x, p.y); ctx.moveTo(x + p.r * v.s, y); ctx.arc(x, y, p.r * v.s, 0, 6.2832); break; }
    case 'b': {
      const ca = Math.cos(p.a || 0), sa = Math.sin(p.a || 0), r = p.r || 0, k = 6;
      // rounded box as a polygon (corners in 6 steps)
      const pts = [];
      const cs = [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]];
      for (const [sx, sy, q] of cs) {
        const ccx = sx * (p.hw - r), ccy = sy * (p.hh - r);
        for (let i = 0; i <= k; i++) { const th = (q + i / k) * Math.PI / 2; pts.push([ccx + r * Math.cos(th), ccy + r * Math.sin(th)]); }
      }
      pts.forEach(([lx, ly], i) => { const bx = p.x + ca * lx - sa * ly, by = p.y + sa * lx + ca * ly; const [x, y] = T(bx, by); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      break;
    }
    case 's': {
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L * p.r, ny = dx / L * p.r;
      const a0 = Math.atan2(ny, nx);
      const pts = [];
      for (let i = 0; i <= 8; i++) { const th = a0 - Math.PI * i / 8; pts.push([p.x1 + p.r * Math.cos(th), p.y1 + p.r * Math.sin(th)]); }
      for (let i = 0; i <= 8; i++) { const th = a0 + Math.PI - Math.PI * i / 8; pts.push([p.x0 + p.r * Math.cos(th), p.y0 + p.r * Math.sin(th)]); }
      // the cap at x1 runs +n to -n through +d, the cap at x0 runs -n to +n
      pts.forEach(([lx, ly], i) => { const [x, y] = T(lx, ly); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      break;
    }
    case 'p': {
      for (let i = 0; i < p.v.length; i += 2) { const [x, y] = T(p.v[i], p.v[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath();
      break;
    }
  }
}

function drawWalls(ctx, S, v, look) {
  const C = S.container, sh = S.shake;
  const wall = look.wall, fill = look.wallFill;
  ctx.save();
  // outside of the free region: a frame rectangle with the free shape cut out
  ctx.fillStyle = fill;
  ctx.beginPath();
  const m = 0.04, ex = 0.6;
  ctx.moveTo(X(v, -ex + sh), Y(v, -ex)); ctx.lineTo(X(v, S.Wd + ex + sh), Y(v, -ex)); ctx.lineTo(X(v, S.Wd + ex + sh), Y(v, S.Hd + ex)); ctx.lineTo(X(v, -ex + sh), Y(v, S.Hd + ex)); ctx.closePath();
  freePath(ctx, v, S, C, sh, m);
  ctx.fill('evenodd');
  ctx.strokeStyle = wall; ctx.lineWidth = Math.max(1.5, 0.004 * v.s);
  ctx.beginPath(); freePath(ctx, v, S, C, sh, m); ctx.stroke();
  // solids and obstacles
  ctx.fillStyle = fill;
  ctx.beginPath(); for (const p of C.solids) primPath(ctx, v, p, sh, 0, 0); ctx.fill();
  ctx.beginPath(); for (const p of C.solids) primPath(ctx, v, p, sh, 0, 0); ctx.stroke();
  ctx.fillStyle = look.obstacle;
  ctx.beginPath(); for (const ob of S.obstacles) primPath(ctx, v, ob.p, sh, 0, 0); ctx.fill();
  ctx.beginPath(); for (const ob of S.obstacles) primPath(ctx, v, ob.p, sh, 0, 0); ctx.stroke();
  // a mark on each turning obstacle so the spin reads
  ctx.fillStyle = look.mark;
  ctx.beginPath();
  for (const ob of S.obstacles) if (ob.spin || ob.orbit) { const c = Math.cos(ob.a), s = Math.sin(ob.a), r = ob.kind === 'disk' ? ob.local.r * 0.55 : (ob.local.hw || 0.05) * 0.7; const x = X(v, ob.x + sh + c * r), y = Y(v, ob.y + s * r); ctx.moveTo(x + 0.008 * v.s, y); ctx.arc(x, y, 0.008 * v.s, 0, 6.2832); }
  ctx.fill();
  ctx.restore();
}
function freePath(ctx, v, S, C, sh, m) {
  if (C.kind === 'drum' || C.kind === 'mixer') { const x = X(v, C.cx + sh), y = Y(v, C.cy), r = C.R * v.s; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832, false); return; }
  if (C.kind === 'bowl') {
    const i = C.inner, R = (i.x1 - i.x0) / 2, cx = (i.x0 + i.x1) / 2, yc = i.y0 + R;
    ctx.moveTo(X(v, i.x0 + sh), Y(v, i.y1));
    ctx.lineTo(X(v, i.x0 + sh), Y(v, yc));
    for (let k = 0; k <= 24; k++) { const th = Math.PI + Math.PI * k / 24; ctx.lineTo(X(v, cx + sh + R * Math.cos(th)), Y(v, yc + R * Math.sin(th))); }
    ctx.lineTo(X(v, i.x1 + sh), Y(v, i.y1)); ctx.closePath();
    return;
  }
  ctx.moveTo(X(v, m + sh), Y(v, m)); ctx.lineTo(X(v, S.Wd - m + sh), Y(v, m)); ctx.lineTo(X(v, S.Wd - m + sh), Y(v, S.Hd - m)); ctx.lineTo(X(v, m + sh), Y(v, S.Hd - m)); ctx.closePath();
}

function drawBody(ctx, S, v, b, col, look) {
  ctx.fillStyle = col;
  ctx.beginPath(); for (const p of b.prims) primPath(ctx, v, p, b.x, b.y, b.a); ctx.fill();
  ctx.strokeStyle = look.outline; ctx.lineWidth = Math.max(1, 0.003 * v.s);
  ctx.beginPath(); for (const p of b.prims) primPath(ctx, v, p, b.x, b.y, b.a); ctx.stroke();
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const P = (lx, ly) => [X(v, b.x + c * lx - s * ly), Y(v, b.y + s * lx + c * ly)];
  const dot = (lx, ly, r, f) => { const [x, y] = P(lx, ly); ctx.fillStyle = f; ctx.beginPath(); ctx.moveTo(x + r * v.s, y); ctx.arc(x, y, r * v.s, 0, 6.2832); ctx.fill(); };
  switch (b.kind) {
    case 'duck': { const h = b.prims[1]; dot(h.x + 0.012, h.y + 0.01, 0.0075, '#111'); const bk = b.prims[2]; ctx.fillStyle = '#ff8a00'; ctx.beginPath(); primPath(ctx, v, bk, b.x, b.y, b.a); ctx.fill(); break; }
    case 'boat': { const cab = b.prims[1]; ctx.fillStyle = look.cabin; ctx.beginPath(); primPath(ctx, v, cab, b.x, b.y, b.a); ctx.fill(); dot(cab.x - 0.02, cab.y, 0.007, '#bfe6ff'); dot(cab.x + 0.012, cab.y, 0.007, '#bfe6ff'); break; }
    case 'log': { const p = b.prims[0]; for (const t of [0.25, 0.5, 0.75]) { const lx = p.x0 + (p.x1 - p.x0) * t; const [x0, y0] = P(lx, p.y0 - p.r * 0.8), [x1, y1] = P(lx, p.y0 + p.r * 0.8); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); } break; }
    case 'rock': dot(-0.012, 0.014, 0.012, 'rgba(255,255,255,0.18)'); break;
    case 'ball': dot(-0.015, 0.015, 0.012, 'rgba(255,255,255,0.35)'); break;
  }
  // red index mark: shows the turn of every body
  if (b.kind !== 'duck') { const p = b.prims[0]; const rr = p.t === 'c' ? p.r * 0.6 : p.t === 'b' ? Math.min(p.hw, p.hh) * 0.55 : p.t === 's' ? p.r * 0.5 : 0.02; dot(p.t === 's' ? p.x1 - p.r : rr, 0, 0.009, look.mark); }
}

// Draw one frame. look = { theme, water, colorBy, lut, render, foam,
// palette: [..], size, wall, wallFill, obstacle, outline, mark, cabin,
// grid, bg, bg2, veil, veilColor }. view from fitView. R is a cache object.
export function draw(ctx, S, view, look, R, makeCanvas, cw, ch) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const g = ctx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, look.bg2); g.addColorStop(1, look.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  if (look.grid) {
    ctx.strokeStyle = look.grid; ctx.lineWidth = 1; ctx.beginPath();
    const st = 0.1 * view.s;
    if (st > 6) {
      for (let x = view.ox % st; x < cw; x += st) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, ch); }
      for (let y = view.oy % st; y < ch; y += st) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(cw, Math.round(y) + 0.5); }
    }
    ctx.stroke();
  }
  if (look.render !== 'particles') drawSmooth(ctx, S, view, look, R, makeCanvas);
  if (look.render !== 'smooth') drawParticles(ctx, S, view, look, look.render === 'both' ? 0.55 : look.size);
  if (look.foam) drawFoam(ctx, S, view, look);
  drawWalls(ctx, S, view, look);
  const pal = look.palette;
  for (let k = 0; k < S.bodies.length; k++) { const b = S.bodies[k]; drawBody(ctx, S, view, b, b.color || pal[(b.id + (b.kind === 'rock' ? 3 : 0)) % pal.length], look); }
  // emitters
  ctx.fillStyle = look.wall;
  for (const e of S.emitters) { const x = X(view, e.x), y = Y(view, e.y), r = 0.018 * view.s; ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
  const p = S.pointer;
  if (p.on && p.body < 0) { ctx.strokeStyle = look.mark; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(view, p.x), Y(view, p.y), p.r * view.s, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1; }
  if (look.veil > 0) { ctx.globalAlpha = Math.min(1, look.veil); ctx.fillStyle = look.bg; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; }
}
