// ============================================================================
//  GRAVITY PLAYGROUND  ·  action framing  (classic script, also run by Node)
// ----------------------------------------------------------------------------
//  The page camera follows the action with lib/action-camera.js. This file
//  gives that camera its input and turns its goal into the 2D view of
//  main.js. It has no DOM and no camera state; framing-test.mjs runs it.
//
//  THE COMPLAINT (2026-10-17). The user: "colliding galaxies and other
//  gravity simulations need to do better about focusing the camera
//  appropriately to get good action but not visually overwhelm things".
//  Before, the view was fixed at the preset load: an escaper left the
//  frame and a tight pair stayed a dot. Now the view follows the action.
//
//  THE WEIGHT OF A BODY (function weights). One body is one unit, not its
//  mass, so a fixed star does not pull the frame onto itself. A body that
//  feels a strong pull (a close pass, a tight pair) gets up to 1 + ACC_K *
//  ACC_CAP. An ESCAPER gets a weight that falls to zero: its energy about
//  the centre of mass of the other bodies is positive, it moves away from
//  them, and it is past ESC_R0 times the median distance of the bodies
//  (zero at ESC_R1 times). So the camera lets it go and does not chase it.
//
//  THE SAMPLE (function buildSample). Each body gives its position now and
//  HIST points of its trail over the last window (one orbit, 2 to 20 sim
//  s). The trail points make the frame cover the orbit, not the point on
//  it, so the centre does not swing as the bodies go round. The saver
//  gives the same kind of sample from its look-ahead run (function
//  windowSample): the points from t - back to t + ahead.
//
//  THE VIEW (function toView). The goal centre goes to the centre of the
//  clear band. The zoom puts the goal radius at `fill` of the half size of
//  the band in its tight direction, clamped to [zMin, zMax] (zMax is the
//  calm minimum radius: no push-in past it).
//
//  NOT TOO MUCH (function crowdGain). The glows of the bodies, as a share
//  of the view area, and the count of trails set a gain for the glow and
//  the trail alpha: 1 when sparse, down to 0.4 when crowded.
//
//  grep -n targets
//    shared settings .... "var CAM ="
//    weights ............ "function weights"
//    sample ............. "function buildSample"
//    saver sample ....... "function windowSample"
//    view ............... "function toView"
//    weight in view ..... "function weightInView"
//    crowding ........... "function crowdGain"
//    saver look, view ... "function saverLook", "function saverView"
//    user override ...... "function followBlend"
// ============================================================================
(function (root) {
'use strict';

var ACC_K = 0.6, ACC_CAP = 3, ESC_R0 = 1.6, ESC_R1 = 2.6, HIST = 12;
// The settings that main.js and framing-test.mjs share: the options of
// createActionCamera for the page view (CAM) and the saver (SAVER_CAM),
// the fill and the zoom clamp of the page view, the idle time before the
// view eases back after a user move, and the time of that ease (s).
var CAM = { halfLife: 1.2, maxZoomRate: 0.3, deadZone: 0.22, percentile: 0.9, minRadius: 50 };
var SAVER_CAM = { halfLife: 1.6, maxZoomRate: 0.2, deadZone: 0.2, percentile: 0.88, minRadius: 40 };
var FILL = 0.62, Z_MIN = 0.05, Z_MAX = 1.6, IDLE = 5, EASE = 2;

function median(a) { var c = a.slice().sort(function (x, y) { return x - y; }); return c.length ? c[c.length >> 1] : 0; }

// The action weight of each body (see the header). B: bodies with x, y,
// vx, vy, ax, ay, mass; noframe bodies get 0. out: an array to fill.
function weights(B, G, out) {
  var n = B.length, i, j, b;
  out = out || new Array(n);
  var M = 0, cx = 0, cy = 0, cvx = 0, cvy = 0;
  for (i = 0; i < n; i++) { b = B[i]; M += b.mass; cx += b.mass * b.x; cy += b.mass * b.y; cvx += b.mass * b.vx; cvy += b.mass * b.vy; }
  var mx = M > 0 ? cx / M : 0, my = M > 0 ? cy / M : 0;
  var rs = [], as = [];
  for (i = 0; i < n; i++) { b = B[i]; if (b.noframe) continue; rs.push(Math.hypot(b.x - mx, b.y - my)); as.push(Math.hypot(b.ax || 0, b.ay || 0)); }
  var rMed = Math.max(1, median(rs)), aMed = median(as) || 1;
  for (i = 0; i < n; i++) {
    b = B[i];
    if (b.noframe) { out[i] = 0; continue; }
    var w = 1 + ACC_K * Math.min(ACC_CAP, Math.hypot(b.ax || 0, b.ay || 0) / aMed);
    // the rest: mass, centre and velocity without body i
    var Mo = M - b.mass;
    if (Mo > 0 && n > 1) {
      var ox = (cx - b.mass * b.x) / Mo, oy = (cy - b.mass * b.y) / Mo, ovx = (cvx - b.mass * b.vx) / Mo, ovy = (cvy - b.mass * b.vy) / Mo;
      var dx = b.x - ox, dy = b.y - oy, dvx = b.vx - ovx, dvy = b.vy - ovy, r = Math.hypot(dx, dy);
      var E = 0.5 * (dvx * dvx + dvy * dvy) - G * (M) / Math.max(1, r);
      var out1 = dx * dvx + dy * dvy > 0, rr = Math.hypot(b.x - mx, b.y - my) / rMed;
      if (E > 0 && out1 && rr > ESC_R0) w *= Math.max(0, 1 - (rr - ESC_R0) / (ESC_R1 - ESC_R0));
    }
    out[i] = w;
  }
  for (j = 0; j < n; j++) if (!(out[j] >= 0)) out[j] = 0;
  return out;
}

// A sample for createActionCamera: { pos, mass, count, stride: 3 }. Each
// body gives its position and HIST trail points over win(b) sim s before
// now; each point carries w / (HIST + 1). The trail is the ring of
// trails.js (buf: x, y, t). s: a sample object to reuse, or null.
function buildSample(B, G, now, win, s) {
  var n = B.length, w = weights(B, G), cap = n * (HIST + 1), i, k;
  if (!s || s.cap < cap) s = { pos: new Float64Array(cap * 3), mass: new Float64Array(cap), cap: cap, count: 0, stride: 3, w: w };
  s.w = w;
  var c = 0;
  for (i = 0; i < n; i++) {
    var b = B[i];
    if (!(w[i] > 0)) continue;
    var wi = w[i] / (HIST + 1), base = c;
    s.pos[3 * c] = b.x; s.pos[3 * c + 1] = b.y; s.pos[3 * c + 2] = 0; s.mass[c] = wi; c++;
    var tr = b.trail, W = Math.max(2, Math.min(20, win ? win(b) : 6));
    if (tr && tr.n) {
      var idx = (tr.head - 1 + tr.cap) % tr.cap, left = tr.n, next = now - W / HIST;
      for (k = 0; k < HIST && left > 0;) {
        var t = tr.buf[3 * idx + 2];
        if (t < now - W - 1e-9) break;
        if (t <= next) { s.pos[3 * c] = tr.buf[3 * idx]; s.pos[3 * c + 1] = tr.buf[3 * idx + 1]; s.pos[3 * c + 2] = 0; s.mass[c] = wi; c++; k++; next -= W / HIST; }
        idx = idx ? idx - 1 : tr.cap - 1; left--;
      }
    }
    // a short trail: its points carry the weight of the missing ones
    var got = c - base;
    if (got < HIST + 1) for (k = base; k < c; k++) s.mass[k] = w[i] / got;
  }
  s.count = c;
  return s;
}

// The saver's look-ahead run: frames { t, pts: [x, y, w, ...] } in the
// drawn frame. The sample: every frame with t in [now - back, now + ahead].
function windowSample(frames, now, back, ahead, s) {
  var lo = 0, hi = frames.length, i, k, c = 0, cap = 0;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (frames[mid].t < now - back) lo = mid + 1; else hi = mid; }
  for (i = lo; i < frames.length && frames[i].t <= now + ahead; i++) cap += frames[i].pts.length / 3;
  if (!s || s.cap < cap) s = { pos: new Float64Array(Math.max(1, cap) * 3), mass: new Float64Array(Math.max(1, cap)), cap: Math.max(1, cap), count: 0, stride: 3 };
  for (i = lo; i < frames.length && frames[i].t <= now + ahead; i++) {
    var p = frames[i].pts;
    for (k = 0; k + 2 < p.length; k += 3) { s.pos[3 * c] = p[k]; s.pos[3 * c + 1] = p[k + 1]; s.pos[3 * c + 2] = 0; s.mass[c] = p[k + 2]; c++; }
  }
  s.count = c;
  return s;
}

// The 2D view of a goal { center, radius }: view = { cx, cy (the band
// centre, canvas px), hw, hh (the half size that the subject may use),
// W, H }. Returns { x: camX, y: camY, z: camZoom } for main.js
// (screen = W/2 + camX + world * camZoom).
function toView(g, view, fill, zMin, zMax) {
  var z = fill * Math.min(view.hw, view.hh) / Math.max(1e-6, g.radius);
  z = Math.max(zMin, Math.min(zMax, z));
  return { x: view.cx - view.W / 2 - g.center[0] * z, y: view.cy - view.H / 2 - g.center[1] * z, z: z };
}

// The share of the weight of bodies B (weights w) on screen in the rect
// [x0, x1] x [y0, y1] (canvas px) for the view cam. pos(b) gives the drawn
// position (default b.x, b.y).
function weightInView(B, w, cam, W, H, rect, pos) {
  var tot = 0, inn = 0;
  for (var i = 0; i < B.length; i++) {
    if (!(w[i] > 0)) continue;
    var p = pos ? pos(B[i]) : [B[i].x, B[i].y];
    var sx = W / 2 + cam.x + p[0] * cam.z, sy = H / 2 + cam.y + p[1] * cam.z;
    tot += w[i];
    if (sx >= rect.x0 && sx <= rect.x1 && sy >= rect.y0 && sy <= rect.y1) inn += w[i];
  }
  return tot > 0 ? inn / tot : 1;
}

// The gain of the glows and trails: the glow discs (3 r) of the bodies in
// view as a share of the view area (1 under 25%), times sqrt(12 / n) for
// n moving bodies over 12 (each one draws a trail: the 56 disk stars of
// the tidal scene). Never under 0.4.
function crowdGain(B, z, W, H) {
  var a = 0, n = 0;
  for (var i = 0; i < B.length; i++) { var r = Math.min(0.06 * Math.min(W, H), 3 * B[i].radius * z); a += Math.PI * r * r; if (!B[i].fixed) n++; }
  var share = a / Math.max(1, W * H);
  return Math.max(0.4, Math.min(1, 0.25 / Math.max(1e-6, share)) * Math.min(1, Math.sqrt(12 / Math.max(1, n))));
}

// The saver's seeded look for one scene (rnd: the scene rng): the fill
// of the band, a slow dolly (the fill changes by this share over the
// hold), and the look-back and look-ahead of the sample, in holds.
function saverLook(rnd) {
  return { fill: 0.56 + 0.12 * rnd(), dolly: (rnd() - 0.5) * 0.12, back: 0.3 + 0.15 * rnd(), ahead: 0.15 + 0.2 * rnd() };
}
// The saver view: the clear band of the plate (lib/saver-clear.js
// plateBand: t and b in px from the top and the base, or null) in a W x
// H canvas. The subject may use 92% of the width and the band plus half
// of each plate block in height (in a 16:9 window the band alone is
// about a quarter of the height, and a fit to it made every system tiny).
function saverView(W, H, band) {
  var t = band ? band.t : 0, b = band ? band.b : 0, bh = Math.max(40, H - t - b);
  return { W: W, H: H, cx: W / 2, cy: t + bh / 2, hw: 0.46 * W, hh: (bh + 0.5 * (H - bh)) / 2,
    rect: { x0: 0, x1: W, y0: Math.max(0, t / 2), y1: H - b / 2 } };
}

// The share of the action camera in the view, after a user move: 0 while
// the user moved in the last idle s, then a smooth rise to 1 over ease s.
function followBlend(sinceUser, idle, ease) {
  if (sinceUser < idle) return 0;
  var u = Math.min(1, (sinceUser - idle) / ease);
  return u * u * (3 - 2 * u);
}

var API = { weights: weights, buildSample: buildSample, windowSample: windowSample, toView: toView, weightInView: weightInView, crowdGain: crowdGain, followBlend: followBlend, saverLook: saverLook, saverView: saverView,
  HIST: HIST, ESC_R0: ESC_R0, ESC_R1: ESC_R1, CAM: CAM, SAVER_CAM: SAVER_CAM, FILL: FILL, Z_MIN: Z_MIN, Z_MAX: Z_MAX, IDLE: IDLE, EASE: EASE };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.GravityFraming = API;
})(typeof window !== 'undefined' ? window : globalThis);
