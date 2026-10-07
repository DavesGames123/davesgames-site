// ============================================================================
//  GRAVITY PLAYGROUND  ·  orbital trails  (classic script, also run by Node)
// ----------------------------------------------------------------------------
//  A trail is a ring buffer of world points (x, y, sim time t) in one
//  Float32Array. step() in main.js calls sample() after each integrator
//  step. sample() keeps a point when the body moved DS world units from the
//  last kept point, or when DTMAX sim seconds went by. The points are in
//  world units, so a pan or a zoom changes only the transform at draw time.
//
//  DRAW PIPELINE   draw(ctx, tr, hx, hy, now, win, ox, oy, z, style, color, wmax)
//  ---------------------------------------------------------------------------
//      gather()   ring ▶ screen px. Points older than now − win drop out. The
//                 tail end is interpolated at t = now − win, so the tail
//                 moves smoothly. Points closer than 0.75 px merge. The
//                 body position (hx, hy) is the head point.
//      spline()   centripetal Catmull-Rom, 1 to 12 sub-points per segment
//                 (about one per 4 px). Centripetal: no loops, no overshoot.
//      style      age u = 1 − (now − t) / win, 1 at the head, 0 at the tail
//        line     constant 1.3 px band, alpha u^1.2
//        ribbon   width tapers from wmax to 0.3 px, alpha u^1.6
//        dots     one dot per D sim s (D a power of 2 near win / 40), fixed
//                 to multiples of D so the dots stay on the path; dense
//                 dots mean a slow body. A faint line runs under them.
//      The bands are filled polygons in 32 age chunks with the 'lighter'
//      blend. Adjacent chunks share an edge, and with additive blend the
//      edge coverage adds to one, so the joins do not show.
//
//  ALLOCATION   The scratch arrays are module globals. They grow (doubling)
//  only when a trail is longer than all trails before it. A frame in the
//  steady state makes no new objects. tests.mjs checks this.
//
//  SECTION MAP   (jump with grep -n "<anchor>" trails.js)
//      ring buffer ...... "function make"     make, reset, push, sample
//      period ........... "function oscPeriod" Kepler period for "orbits"
//      gather ........... "function gather"   ring to screen, cut, merge
//      spline ........... "function spline"   centripetal Catmull-Rom
//      bands ............ "function bands"    line and ribbon fill
//      dots ............. "function dots"     time dots
//      entry ............ "function draw"     one trail, one style
// ============================================================================
(function (root) {
'use strict';

// CAP points per trail (48 KB). DS world units or DTMAX sim s between points.
var CAP = 4096, DS = 3, DTMAX = 0.05, K = 32;

/* ring buffer */
function make(cap) {
  cap = cap || CAP;
  return { buf: new Float32Array(cap * 3), cap: cap, head: 0, n: 0, lx: 0, ly: 0, lt: -1e300 };
}
function reset(tr) { tr.head = 0; tr.n = 0; tr.lt = -1e300; }
function push(tr, x, y, t) {
  var k = tr.head * 3, b = tr.buf;
  b[k] = x; b[k + 1] = y; b[k + 2] = t;
  tr.head = tr.head + 1 === tr.cap ? 0 : tr.head + 1;
  if (tr.n < tr.cap) tr.n++;
  tr.lx = x; tr.ly = y; tr.lt = t;
}
// Keep (x, y) at sim time t if the body moved DS or DTMAX went by. A time
// before the last point (a reset of simTime) clears the trail. Returns true
// when it kept the point.
function sample(tr, x, y, t) {
  if (t < tr.lt) reset(tr);
  if (tr.n) {
    var dx = x - tr.lx, dy = y - tr.ly;
    if (dx * dx + dy * dy < DS * DS && t - tr.lt < DTMAX * 0.999) return false;
  }
  push(tr, x, y, t);
  return true;
}

/* period */
// The osculating Kepler period of body i about the centre of mass of all
// the other bodies: mu = G (m_i + M_rest), eps = v²/2 − mu/r, a = −mu/(2 eps),
// T = 2π sqrt(a³/mu). It is exact for two bodies and near exact for a
// planet about a dominant star. It is constant on a Kepler ellipse, so an
// "orbits" trail does not change length along the orbit. Returns 0 when
// the body is not bound (or is alone).
function oscPeriod(B, i, G) {
  var M = 0, mx = 0, my = 0, mvx = 0, mvy = 0, j, b;
  for (j = 0; j < B.length; j++) {
    if (j === i) continue;
    b = B[j];
    var vx = b.fixed ? 0 : b.vx, vy = b.fixed ? 0 : b.vy;
    M += b.mass; mx += b.mass * b.x; my += b.mass * b.y; mvx += b.mass * vx; mvy += b.mass * vy;
  }
  if (M <= 0) return 0;
  b = B[i];
  var rx = b.x - mx / M, ry = b.y - my / M, ux = b.vx - mvx / M, uy = b.vy - mvy / M;
  var mu = G * (M + b.mass), r = Math.sqrt(rx * rx + ry * ry) + 1e-9;
  var eps = 0.5 * (ux * ux + uy * uy) - mu / r;
  if (eps >= 0) return 0;
  var a = -mu / (2 * eps);
  return 2 * Math.PI * Math.sqrt(a * a * a / mu);
}

/* scratch */
// G*: gathered screen points. S*: spline points, with NX/NY (unit normal),
// SU (age 0..1) and SW (half width). DX/DY/DU: dots.
var GX, GY, GT, SX, SY, ST, SU, SW, NX, NY, DX, DY, DU, gCap = 0, sCap = 0, dCap = 0, grows = 0;
function ensureG(n) {
  if (n <= gCap) return;
  gCap = Math.max(n, gCap * 2, 512); grows++;
  GX = new Float32Array(gCap); GY = new Float32Array(gCap); GT = new Float64Array(gCap);
}
function ensureS(n) {
  if (n <= sCap) return;
  sCap = Math.max(n, sCap * 2, 2048); grows++;
  SX = new Float32Array(sCap); SY = new Float32Array(sCap); ST = new Float64Array(sCap);
  SU = new Float32Array(sCap); SW = new Float32Array(sCap); NX = new Float32Array(sCap); NY = new Float32Array(sCap);
}
function ensureD(n) {
  if (n <= dCap) return;
  dCap = Math.max(n, dCap * 2, 256); grows++;
  DX = new Float32Array(dCap); DY = new Float32Array(dCap); DU = new Float32Array(dCap);
}

/* gather */
var gm = 0;   // the count of gathered points
// Add one screen point. A point inside 0.75 px of the last one replaces it
// when force is set (the head), else it merges into the last one.
function put(x, y, t, force) {
  if (gm > 0) {
    var dx = x - GX[gm - 1], dy = y - GY[gm - 1];
    if (dx * dx + dy * dy < 0.5625) {
      if (force && gm > 1) { GX[gm - 1] = x; GY[gm - 1] = y; GT[gm - 1] = t; }
      else if (force) { GX[gm] = x; GY[gm] = y; GT[gm] = t; gm++; }
      return;
    }
  }
  GX[gm] = x; GY[gm] = y; GT[gm] = t; gm++;
}
// The ring points inside the window, oldest first, then the head, as screen
// px (screen = o + world · z). Returns the count.
function gather(tr, hx, hy, now, win, ox, oy, z) {
  var t0 = now - win, b = tr.buf, n = tr.n, cap = tr.cap;
  var start = tr.head - n; if (start < 0) start += cap;
  var px = 0, py = 0, pt = 0, have = false, i, k, x, y, t;
  ensureG(n + 3);
  gm = 0;
  for (i = 0; i <= n; i++) {
    if (i < n) { k = start + i; if (k >= cap) k -= cap; k *= 3; x = ox + b[k] * z; y = oy + b[k + 1] * z; t = b[k + 2]; }
    else { x = ox + hx * z; y = oy + hy * z; t = now; }
    if (t < t0) { px = x; py = y; pt = t; have = true; continue; }
    if (gm === 0 && have && t > pt) {
      var f = (t0 - pt) / (t - pt);
      GX[0] = px + (x - px) * f; GY[0] = py + (y - py) * f; GT[0] = t0; gm = 1;
    }
    put(x, y, t, i === n);
  }
  return gm;
}

/* spline */
// Centripetal Catmull-Rom (Barry-Goldman pyramid) through the gathered
// points. The end segments use a mirrored ghost point. Returns the count.
function spline(m) {
  ensureS(m * 12 + 2);
  var s = 0;
  if (m < 2) { if (m === 1) { SX[0] = GX[0]; SY[0] = GY[0]; ST[0] = GT[0]; s = 1; } return s; }
  SX[0] = GX[0]; SY[0] = GY[0]; ST[0] = GT[0]; s = 1;
  for (var i = 0; i < m - 1; i++) {
    var x1 = GX[i], y1 = GY[i], x2 = GX[i + 1], y2 = GY[i + 1];
    var x0 = i > 0 ? GX[i - 1] : 2 * x1 - x2, y0 = i > 0 ? GY[i - 1] : 2 * y1 - y2;
    var x3 = i + 2 < m ? GX[i + 2] : 2 * x2 - x1, y3 = i + 2 < m ? GY[i + 2] : 2 * y2 - y1;
    var d01 = Math.pow((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0), 0.25) + 1e-4;
    var d12 = Math.pow((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1), 0.25) + 1e-4;
    var d23 = Math.pow((x3 - x2) * (x3 - x2) + (y3 - y2) * (y3 - y2), 0.25) + 1e-4;
    var t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
    var len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), sub = Math.max(1, Math.min(12, Math.ceil(len / 4)));
    var ta = GT[i], tb = GT[i + 1];
    for (var j = 1; j <= sub; j++) {
      var f = j / sub, u = t1 + f * d12;
      if (j === sub) { SX[s] = x2; SY[s] = y2; ST[s] = tb; s++; break; }
      var a1x = ((t1 - u) * x0 + u * x1) / t1, a1y = ((t1 - u) * y0 + u * y1) / t1;
      var a2x = ((t2 - u) * x1 + (u - t1) * x2) / d12, a2y = ((t2 - u) * y1 + (u - t1) * y2) / d12;
      var a3x = ((t3 - u) * x2 + (u - t2) * x3) / d23, a3y = ((t3 - u) * y2 + (u - t2) * y3) / d23;
      var b1x = ((t2 - u) * a1x + u * a2x) / t2, b1y = ((t2 - u) * a1y + u * a2y) / t2;
      var b2x = ((t3 - u) * a2x + (u - t1) * a3x) / (t3 - t1), b2y = ((t3 - u) * a2y + (u - t1) * a3y) / (t3 - t1);
      SX[s] = ((t2 - u) * b1x + (u - t1) * b2x) / d12;
      SY[s] = ((t2 - u) * b1y + (u - t1) * b2y) / d12;
      ST[s] = ta + (tb - ta) * f; s++;
    }
  }
  return s;
}

/* bands */
// Fill the spline as a band: half width SW[i] each side of the normal, in
// K age chunks. alpha(u) = amax · u^gamma, set through globalAlpha.
function bands(ctx, s, amax, gamma) {
  var i, i0 = 0, bin0, bin;
  bin0 = Math.min(K - 1, Math.floor(SU[0] * K));
  for (i = 1; i < s; i++) {
    bin = Math.min(K - 1, Math.floor(SU[i] * K));
    if (bin !== bin0 || i === s - 1) {
      var ua = 0.5 * (SU[i0] + SU[i]);
      var a = amax * Math.pow(ua, gamma);
      if (a > 0.004) {
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(SX[i0] + NX[i0] * SW[i0], SY[i0] + NY[i0] * SW[i0]);
        for (var j = i0 + 1; j <= i; j++) ctx.lineTo(SX[j] + NX[j] * SW[j], SY[j] + NY[j] * SW[j]);
        for (j = i; j >= i0; j--) ctx.lineTo(SX[j] - NX[j] * SW[j], SY[j] - NY[j] * SW[j]);
        ctx.closePath();
        ctx.fill();
      }
      i0 = i; bin0 = bin;
    }
  }
}
// Normals of the spline, from the central difference of the neighbours.
function normals(s) {
  var lx = 0, ly = 1;
  for (var i = 0; i < s; i++) {
    var a = i > 0 ? i - 1 : 0, b = i < s - 1 ? i + 1 : s - 1;
    var tx = SX[b] - SX[a], ty = SY[b] - SY[a], l = Math.sqrt(tx * tx + ty * ty);
    if (l > 1e-6) { lx = -ty / l; ly = tx / l; }
    NX[i] = lx; NY[i] = ly;
  }
}

/* dots */
// One dot per D sim s along the spline, at the multiples of D. Six alpha
// steps, one path each. Returns the dot count.
function dots(ctx, s, now, win, rmax) {
  var D = Math.pow(2, Math.round(Math.log(win / 40) / Math.LN2));
  var n = Math.floor((ST[s - 1] - ST[0]) / D) + 2, c = 0, j = 0;
  ensureD(n);
  for (var k = Math.ceil(ST[0] / D); k * D <= ST[s - 1]; k++) {
    var tk = k * D;
    while (j < s - 2 && ST[j + 1] < tk) j++;
    var dt = ST[j + 1] - ST[j], f = dt > 0 ? (tk - ST[j]) / dt : 0;
    if (f < 0) f = 0; else if (f > 1) f = 1;
    DX[c] = SX[j] + (SX[j + 1] - SX[j]) * f; DY[c] = SY[j] + (SY[j + 1] - SY[j]) * f;
    DU[c] = 1 - (now - tk) / win; c++;
  }
  for (var q = 0; q < 6; q++) {
    var lo = q / 6, hi = (q + 1) / 6, any = false;
    ctx.globalAlpha = 0.25 + 0.7 * (q + 0.5) / 6;
    ctx.beginPath();
    for (var i = 0; i < c; i++) {
      var u = DU[i];
      if (u < lo || u >= hi && q < 5) continue;
      var r = rmax * (0.45 + 0.55 * u);
      ctx.moveTo(DX[i] + r, DY[i]); ctx.arc(DX[i], DY[i], r, 0, 6.283185307179586); any = true;
    }
    if (any) ctx.fill();
  }
  return c;
}

/* entry */
// Draw one trail. (hx, hy) is the body now (world), now is the sim time,
// win the trail length in sim s, (ox, oy, z) the world-to-screen map,
// style 'line', 'ribbon' or 'dots', color a CSS color, wmax the ribbon
// width at the head (CSS px). Returns the spline point count.
function draw(ctx, tr, hx, hy, now, win, ox, oy, z, style, color, wmax) {
  if (!(win > 0)) return 0;
  var m = gather(tr, hx, hy, now, win, ox, oy, z);
  if (m < 2) return 0;
  var s = spline(m), i, u;
  normals(s);
  var w0, w1, amax, gamma;
  if (style === 'ribbon') { w0 = 0.15; w1 = 0.5 * wmax; amax = 0.9; gamma = 1.6; }
  else if (style === 'dots') { w0 = w1 = 0.45; amax = 0.28; gamma = 1; }
  else { w0 = w1 = 0.65; amax = 0.9; gamma = 1.2; }
  for (i = 0; i < s; i++) {
    u = 1 - (now - ST[i]) / win; u = u < 0 ? 0 : u > 1 ? 1 : u;
    SU[i] = u; SW[i] = w0 + (w1 - w0) * Math.pow(u, 0.8);
  }
  var op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = color;
  bands(ctx, s, amax, gamma);
  if (style === 'dots') dots(ctx, s, now, win, Math.max(1.3, Math.min(2.6, 0.3 * wmax + 0.8)));
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = op;
  return s;
}

var API = { CAP: CAP, DS: DS, DTMAX: DTMAX, make: make, reset: reset, sample: sample, oscPeriod: oscPeriod, draw: draw,
  stats: function () { return { grows: grows, gCap: gCap, sCap: sCap, dCap: dCap }; } };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.GravityTrails = API;
})(typeof window !== 'undefined' ? window : globalThis);
