// ============================================================================
//  FLIP WATER  ·  render.js  —  Canvas 2D renderer
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code; the
//  upstream demo drew with WebGL points).
//
//  The renderer works on any 2D context, so node tests can draw PNGs with
//  @napi-rs/canvas. It draws in device pixels: the caller sizes the canvas
//  to CSS size x devicePixelRatio and passes that size.
//
//  view = { x, y, s }: screen x = view.x + sim x * view.s, screen y =
//  view.y + (H - sim y) * view.s (device pixels).
//
//  draw(sim, view, opt): opt.colours is state.colours (looks.js
//  resolveLook gives the defaults). The views:
//    surface    a smooth water body. Particles splat into a texel grid
//               (2 x 2 texels per cell, bilinear), two [1 2 1] blur
//               passes smooth it, and a texel is water above half the
//               rest fill. The colour runs from the scheme's shallow to
//               its deep colour by the depth below the column's surface;
//               a light line marks the surface. The texel image goes to
//               a small canvas and is drawn up to the tank with
//               smoothing. Foam: fast texels mix toward the foam colour;
//               spray: particles in thin texels are drawn as dots.
//    particles  each particle as a square, shallow to light by speed.
//    speed, vorticity, pressure, density
//               the surface mask coloured with a colour map
//               (../ct-lab/colormaps/maps.js) by that field.
//
//  grep -n targets
//    export function fitView     tank -> device-pixel transform
//    export function createRenderer
//    function splat              particles -> texel field (+ velocity)
//    function drawSurface        the water image (surface + fields)
//    function drawParticles      speed buckets, one fillStyle per bucket
//    function drawTank           background, tank, walls
//    bodies ................ art.js drawBody (each kind has its own look)
// ============================================================================
import { drawBody } from './art.js';
import { SCHEMES, BACKGROUNDS, VIEWS, OBJECT_TINTS, resolveLook, CM } from './looks.js';

export function fitView(W, H, cw, ch, pad) {
  const p = Object.assign({ l: 8, r: 8, t: 8, b: 8 }, pad || {});
  const s = Math.min((cw - p.l - p.r) / W, (ch - p.t - p.b) / H);
  return { s, x: p.l + (cw - p.l - p.r - W * s) / 2, y: p.t + (ch - p.t - p.b - H * s) / 2, W, H };
}

const NB = 12;
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// opts.makeCanvas(w, h): a canvas for the texel image (node passes one).
export function createRenderer(ctx, opts = {}) {
  let order = new Int32Array(0);
  const counts = new Int32Array(NB + 1);
  const makeCanvas = opts.makeCanvas || ((w, h) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  });
  // texel buffers (reused while the grid size stays)
  let TX = 0, TY = 0, F = null, F2 = null, VX = null, VY = null, img = null, imgCanvas = null, imgCtx = null, surf = null, surfS = null;

  const tx = (view, x) => view.x + x * view.s;
  const ty = (view, y) => view.y + (view.H - y) * view.s;

  function ensure(sim) {
    const nx = 2 * sim.fNumX, ny = 2 * sim.fNumY;
    if (nx === TX && ny === TY) return;
    TX = nx; TY = ny;
    F = new Float32Array(nx * ny); F2 = new Float32Array(nx * ny);
    VX = new Float32Array(nx * ny); VY = new Float32Array(nx * ny);
    surf = new Int32Array(nx); surfS = new Float32Array(nx);
    imgCanvas = makeCanvas(nx, ny); imgCtx = imgCanvas.getContext('2d');
    img = imgCtx.createImageData(nx, ny);
  }

  // Particles -> F (count per texel) and VX, VY (velocity sums), bilinear.
  function splat(sim) {
    F.fill(0); VX.fill(0); VY.fill(0);
    const P = sim.particlePos, V = sim.particleVel, inv = 2 / sim.h, nx = TX, ny = TY;
    for (let i = 0; i < sim.numParticles; i++) {
      const fx = P[2 * i] * inv - 0.5, fy = P[2 * i + 1] * inv - 0.5;
      let x0 = Math.floor(fx), y0 = Math.floor(fy);
      const ax = fx - x0, ay = fy - y0;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x0 > nx - 2) x0 = nx - 2; if (y0 > ny - 2) y0 = ny - 2;
      const vx = V[2 * i], vy = V[2 * i + 1], c = y0 * nx + x0;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      F[c] += w00; F[c + 1] += w10; F[c + nx] += w01; F[c + nx + 1] += w11;
      VX[c] += w00 * vx; VX[c + 1] += w10 * vx; VX[c + nx] += w01 * vx; VX[c + nx + 1] += w11 * vx;
      VY[c] += w00 * vy; VY[c + 1] += w10 * vy; VY[c + nx] += w01 * vy; VY[c + nx + 1] += w11 * vy;
    }
    // two separable [1 2 1]/4 passes on F (the velocity stays local)
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < ny; y++) {
        const r = y * nx;
        for (let x = 0; x < nx; x++) F2[r + x] = 0.25 * (F[r + Math.max(0, x - 1)] + 2 * F[r + x] + F[r + Math.min(nx - 1, x + 1)]);
      }
      for (let y = 0; y < ny; y++) {
        const r = y * nx, rd = Math.max(0, y - 1) * nx, ru = Math.min(ny - 1, y + 1) * nx;
        for (let x = 0; x < nx; x++) F[r + x] = 0.25 * (F2[rd + x] + 2 * F2[r + x] + F2[ru + x]);
      }
    }
  }

  function drawSurface(sim, view, L, opt) {
    ensure(sim);
    splat(sim);
    const nx = TX, ny = TY, D = img.data, S = SCHEMES[L.water];
    // rest fill per texel: a full cell holds particleRestDensity
    // particles (about 2 x 2 at the upstream spacing), so a texel 1/4
    const rest = Math.max(0.2, (sim.particleRestDensity || 3.4) / 4), thr = 0.5 * rest;
    // the surface row of each column: the highest water texel
    for (let x = 0; x < nx; x++) {
      let top = -1;
      for (let y = ny - 1; y >= 0; y--) if (F[y * nx + x] > thr) { top = y; break; }
      surf[x] = top;
    }
    // Smooth the surface line across 9 columns (a column with a spray
    // texel above it would give a vertical stripe in the depth shade).
    for (let x = 0; x < nx; x++) {
      let s = 0, n = 0;
      for (let k = -4; k <= 4; k++) { const q = x + k; if (q >= 0 && q < nx && surf[q] >= 0) { s += surf[q]; n++; } }
      surfS[x] = n ? s / n : -1;
    }
    const sh = hex(S.shallow), dp = hex(S.deep), ln = hex(S.line), fm = hex(S.foam);
    const depthScale = 1 / Math.max(6, 0.55 * ny);
    const field = VIEWS[L.view].field ? L.view : null;
    let lut = null, lo = 0, hi = 1;
    if (field) {
      lut = CM.variant(L.map, { reverse: L.rev });
      if (field === 'speed') { lo = 0; hi = 4; }
      else if (field === 'vorticity') { lo = -12; hi = 12; }   // 1/s
      else if (field === 'density') { lo = 0.3 * rest; hi = 1.6 * rest; }
    }
    // pressure range from the cells (robust: 95th percentile of |p|)
    if (field === 'pressure') {
      let m = 0, n = 0; const p = sim.p;
      for (let i = 0; i < p.length; i += 3) { const a = Math.abs(p[i]); if (a > 0) { m += a; n++; } }
      hi = n ? 2.5 * m / n : 1; lo = 0;
    }
    const foamOn = L.foam, h = sim.h, fNY = sim.fNumY;
    for (let y = 0; y < ny; y++) {
      const row = (ny - 1 - y) * nx;   // image rows go down
      for (let x = 0; x < nx; x++) {
        const c = y * nx + x, f = F[c], o = (row + x) * 4;
        if (f <= 0.35 * thr) { D[o + 3] = 0; continue; }
        // soft edge from 0.35 thr to thr
        const a = f >= thr ? 1 : (f - 0.35 * thr) / (0.65 * thr);
        let r, g, b;
        if (!field) {
          const depth = surfS[x] >= 0 ? (surfS[x] - y) * depthScale : 1;
          const t = depth < 0 ? 0 : depth > 1 ? 1 : Math.sqrt(depth);
          r = sh[0] + (dp[0] - sh[0]) * t; g = sh[1] + (dp[1] - sh[1]) * t; b = sh[2] + (dp[2] - sh[2]) * t;
          // surface line: the top 1.5 texels of the column
          const e = surf[x] - y;
          if (e >= 0 && e < 1.5) { const k = 0.65 * (1 - e / 1.5); r += (ln[0] - r) * k; g += (ln[1] - g) * k; b += (ln[2] - b) * k; }
          if (foamOn && f > 0.05) {
            const v = Math.hypot(VX[c], VY[c]) / f;
            const k = v > 2.4 ? Math.min(0.85, (v - 2.4) * 0.35) : 0;
            if (k > 0) { r += (fm[0] - r) * k; g += (fm[1] - g) * k; b += (fm[2] - b) * k; }
          }
        } else {
          let val;
          if (field === 'speed') val = f > 0.05 ? Math.hypot(VX[c], VY[c]) / f : 0;
          else if (field === 'density') val = f;
          else {
            const i = Math.min(sim.fNumX - 2, Math.max(1, x >> 1)), j = Math.min(fNY - 2, Math.max(1, y >> 1)), k = i * fNY + j;
            if (field === 'pressure') val = Math.abs(sim.p[k]);
            else {
              // curl of the grid velocity, per second
              val = ((sim.v[k + fNY] - sim.v[k]) - (sim.u[k + 1] - sim.u[k])) / h;
            }
          }
          let t = (val - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t;
          const q = Math.round(t * 255) * 3;
          r = lut[q]; g = lut[q + 1]; b = lut[q + 2];
        }
        D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = 255 * a;
      }
    }
    imgCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    // the texel grid starts at x = 0 (cell 0 is the wall)
    ctx.drawImage(imgCanvas, tx(view, 0), ty(view, sim.fNumY * sim.h), nx * view.s * h / 2, ny * view.s * h / 2);
    ctx.restore();
    // spray: particles in thin texels, as small dots
    if (foamOn && !field) {
      const P = sim.particlePos, V = sim.particleVel, inv = 2 / h, d = Math.max(1.2, 1.6 * sim.particleRadius * view.s);
      ctx.fillStyle = `rgba(${fm[0]},${fm[1]},${fm[2]},0.85)`;
      for (let i = 0; i < sim.numParticles; i++) {
        // only flying drops: outside the soft edge and moving
        const xi = Math.min(nx - 1, Math.max(0, (P[2 * i] * inv) | 0)), yi = Math.min(ny - 1, Math.max(0, (P[2 * i + 1] * inv) | 0));
        if (F[yi * nx + xi] < 0.35 * thr && V[2 * i] * V[2 * i] + V[2 * i + 1] * V[2 * i + 1] > 1) ctx.fillRect(tx(view, P[2 * i]) - d / 2, ty(view, P[2 * i + 1]) - d / 2, d, d);
      }
    }
  }

  function drawParticles(sim, view, L) {
    const n = sim.numParticles, P = sim.particlePos, V = sim.particleVel, S = SCHEMES[L.water];
    if (order.length < n) order = new Int32Array(Math.max(n, sim.maxParticles));
    counts.fill(0);
    const vref = 4;
    const bucket = (i) => Math.min(NB - 1, Math.floor(Math.hypot(V[2 * i], V[2 * i + 1]) / vref * NB));
    for (let i = 0; i < n; i++) counts[bucket(i) + 1]++;
    for (let k = 1; k <= NB; k++) counts[k] += counts[k - 1];
    const start = counts.slice(0, NB);
    for (let i = 0; i < n; i++) order[start[bucket(i)]++] = i;
    const d = Math.max(1, 2 * sim.particleRadius * view.s), hd = d / 2;
    const dp = hex(S.deep), sh = hex(S.shallow), fm = hex(S.foam);
    for (let k = 0; k < NB; k++) {
      const t = k / (NB - 1);
      const a = t < 0.5 ? dp : sh, b = t < 0.5 ? sh : fm, u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      ctx.fillStyle = `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
      for (let q = counts[k]; q < counts[k + 1]; q++) {
        const i = order[q];
        ctx.fillRect(tx(view, P[2 * i]) - hd, ty(view, P[2 * i + 1]) - hd, d, d);
      }
    }
  }

  function pathShape(view, pl) {
    const sh = pl.shape, c = Math.cos(pl.a), s = Math.sin(pl.a);
    const X = (lx, ly) => tx(view, pl.x + c * lx - s * ly), Y = (lx, ly) => ty(view, pl.y + s * lx + c * ly);
    ctx.beginPath();
    if (sh.n === 1) { ctx.arc(X(sh.v[0], sh.v[1]), Y(sh.v[0], sh.v[1]), sh.r * view.s, 0, 2 * Math.PI); return; }
    if (sh.n === 2) {
      const ax = sh.v[0], ay = sh.v[1], bx = sh.v[2], by = sh.v[3];
      const ang = Math.atan2(by - ay, bx - ax) + pl.a;
      const R = sh.r * view.s;
      ctx.arc(X(bx, by), Y(bx, by), R, -ang - Math.PI / 2, -ang + Math.PI / 2);
      ctx.arc(X(ax, ay), Y(ax, ay), R, -ang + Math.PI / 2, -ang + 1.5 * Math.PI);
      ctx.closePath();
      return;
    }
    for (let i = 0; i < sh.n; i++) { const x = X(sh.v[2 * i], sh.v[2 * i + 1]), y = Y(sh.v[2 * i], sh.v[2 * i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.closePath();
  }

  function drawPlaced(view, pl, fill, stroke) {
    pathShape(view, pl);
    ctx.fillStyle = fill; ctx.fill();
    if (pl.shape.r > 0 && pl.shape.n > 2) { ctx.lineJoin = 'round'; ctx.lineWidth = 2 * pl.shape.r * view.s; ctx.strokeStyle = fill; ctx.stroke(); }
    if (stroke) { ctx.lineWidth = Math.max(1, view.s * 0.008); ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawTank(view, BG) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.fillStyle = BG.page; ctx.fillRect(0, 0, cw, ch);
    const g = ctx.createLinearGradient(0, view.y, 0, view.y + view.H * view.s);
    g.addColorStop(0, BG.top); g.addColorStop(1, BG.bottom);
    ctx.fillStyle = g; ctx.fillRect(view.x, view.y, view.W * view.s, view.H * view.s);
    if (BG.grid) {
      ctx.strokeStyle = BG.grid; ctx.lineWidth = 1;
      const step = 0.25 * view.s;
      ctx.beginPath();
      for (let x = view.x; x <= view.x + view.W * view.s + 0.5; x += step) { ctx.moveTo(x, view.y); ctx.lineTo(x, view.y + view.H * view.s); }
      for (let y = view.y + view.H * view.s; y >= view.y - 0.5; y -= step) { ctx.moveTo(view.x, y); ctx.lineTo(view.x + view.W * view.s, y); }
      ctx.stroke();
    }
  }

  function draw(sim, view, opt = {}) {
    const L = resolveLook(opt.colours || {}), BG = BACKGROUNDS[L.bg];
    drawTank(view, BG);
    if (L.view === 'particles') drawParticles(sim, view, L);
    else drawSurface(sim, view, L, opt);
    const solidFill = L.bg === 'paper' || L.bg === 'dawn' ? '#7d7466' : '#5b6478';
    for (const st of sim.statics) drawPlaced(view, st, solidFill, BG.wall);
    for (const so of sim.solids) if (so.active && so.kinematic && so.kind !== 'stir') drawPlaced(view, so, so.kind === 'gate' ? '#9a7b4f' : '#6f7d96', '#c9d2e3');
    const tint = OBJECT_TINTS[L.obj].tint;
    for (const so of sim.solids) if (so.active && !so.kinematic) drawBody(ctx, so, view, Object.assign({ tint }, opt.body || {}));
    for (const so of sim.solids) if (so.active && so.kind === 'stir') drawPlaced(view, so, 'rgba(255,90,80,0.85)', '#fff');
    // tank walls
    ctx.strokeStyle = BG.wall; ctx.lineWidth = Math.max(1, view.s * 0.012);
    ctx.beginPath();
    ctx.moveTo(view.x, view.y); ctx.lineTo(view.x, view.y + view.H * view.s); ctx.lineTo(view.x + view.W * view.s, view.y + view.H * view.s); ctx.lineTo(view.x + view.W * view.s, view.y);
    ctx.stroke();
    if (opt.after) opt.after(ctx, view);
  }

  return { draw, pathShape, drawPlaced };
}
