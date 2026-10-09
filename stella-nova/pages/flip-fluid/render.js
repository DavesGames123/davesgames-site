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
//  grep -n targets
//    export function fitView     tank -> device-pixel transform
//    export function createRenderer
//    function drawParticles      speed buckets, one fillStyle per bucket
//    function drawStatics / drawSolids
//    bodies ................ art.js drawBody (each kind has its own look)
// ============================================================================
import { drawBody } from './art.js';

export function fitView(W, H, cw, ch, pad) {
  const p = Object.assign({ l: 8, r: 8, t: 8, b: 8 }, pad || {});
  const s = Math.min((cw - p.l - p.r) / W, (ch - p.t - p.b) / H);
  return { s, x: p.l + (cw - p.l - p.r - W * s) / 2, y: p.t + (ch - p.t - p.b - H * s) / 2, W, H };
}

const NB = 12;

export function createRenderer(ctx) {
  let order = new Int32Array(0), counts = new Int32Array(NB + 1);
  const shades = [];
  for (let k = 0; k < NB; k++) {
    const t = k / (NB - 1);
    shades.push(`rgb(${Math.round(30 + 200 * t * t)},${Math.round(110 + 130 * t)},${Math.round(220 + 35 * t)})`);
  }

  function tx(view, x) { return view.x + x * view.s; }
  function ty(view, y) { return view.y + (view.H - y) * view.s; }

  function drawParticles(sim, view) {
    const n = sim.numParticles, P = sim.particlePos, V = sim.particleVel;
    if (order.length < n) order = new Int32Array(Math.max(n, sim.maxParticles));
    counts.fill(0);
    const vref = 4;
    const bucket = (i) => Math.min(NB - 1, Math.floor(Math.hypot(V[2 * i], V[2 * i + 1]) / vref * NB));
    for (let i = 0; i < n; i++) counts[bucket(i) + 1]++;
    for (let k = 1; k <= NB; k++) counts[k] += counts[k - 1];
    const start = counts.slice(0, NB);
    for (let i = 0; i < n; i++) order[start[bucket(i)]++] = i;
    const d = Math.max(1, 2 * sim.particleRadius * view.s), hd = d / 2;
    for (let k = 0; k < NB; k++) {
      ctx.fillStyle = shades[k];
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

  function draw(sim, view, opt = {}) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, cw, ch);
    // tank
    ctx.fillStyle = '#111b2e';
    ctx.fillRect(view.x, view.y, view.W * view.s, view.H * view.s);
    drawParticles(sim, view);
    for (const st of sim.statics) drawPlaced(view, st, '#5b6478', '#8a93a8');
    for (const so of sim.solids) if (so.active && so.kinematic && so.kind !== 'stir') drawPlaced(view, so, so.kind === 'gate' ? '#9a7b4f' : '#6f7d96', '#c9d2e3');
    for (const so of sim.solids) if (so.active && !so.kinematic) drawBody(ctx, so, view, opt.body || {});
    for (const so of sim.solids) if (so.active && so.kind === 'stir') drawPlaced(view, so, 'rgba(255,90,80,0.85)', '#fff');
    // tank walls
    ctx.strokeStyle = '#8a93a8'; ctx.lineWidth = Math.max(1, view.s * 0.012);
    ctx.beginPath();
    ctx.moveTo(view.x, view.y); ctx.lineTo(view.x, view.y + view.H * view.s); ctx.lineTo(view.x + view.W * view.s, view.y + view.H * view.s); ctx.lineTo(view.x + view.W * view.s, view.y);
    ctx.stroke();
    if (opt.after) opt.after(ctx, view);
  }

  return { draw, pathShape, drawPlaced };
}
