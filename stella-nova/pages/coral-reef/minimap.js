// ============================================================================
//  CORAL REEF  ·  minimap.js  ·  the map of the ground that the squad explored
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "a minimap on the bottom left of what they've
//  explored so far". A top-down map, north (-z) up, of the 12 m cells that
//  the squad has seen (rov/squad.js S.visited, keys 'i,j' of 12 m cells):
//  an explored cell shows the seafloor (depth colour, hill shade, depth
//  contours, a light tint of its region); a cell not explored is dark (fog
//  of war). On it: each ROV as an arrow in its colour with its heading and
//  a short trail, the selected ROV larger with a ring, the view cone of the
//  main camera, a scale bar, the region and depth of the selected ROV and
//  a depth legend.
//
//  COST. The fog layer (createFogMap) is a world-anchored pixel buffer,
//  3 m a pixel, 640 x 640 px (1.92 km). A new cell is painted ONCE (6 x 6
//  ground samples, about 0.3 ms) from a queue with a time budget per tick.
//  The page draws the map 4 times a second (drawMinimap): one drawImage of
//  the fog and a few paths. When the view leaves the buffer, the buffer
//  moves to the view and paints its known cells again from the queue.
//
//  PURE PARTS (the node tests): cellOf, worldToMap, mapToWorld, headingVec,
//  depthColour, contourLevel, niceScale, coneOf, and the fog buffer (it
//  keeps its own RGBA array; a canvas is optional).
//
//  grep -n targets
//    "export const MAP_CELL"          the cell size (rov/squad.js CELL)
//    "export function worldToMap"     world (x, z) -> map px; "mapToWorld"
//    "export function depthColour"    the depth colour scale and legend stops
//    "export function contourLevel"   the contour index of a depth
//    "export function niceScale"      the scale bar length
//    "export function coneOf"         the camera view cone on the map
//    "export function createFogMap"   the explored-cell buffer
//    "export function drawMinimap"    one draw; returns the arrows drawn
// ============================================================================

export const MAP_CELL = 12;          // m: rov/squad.js CELL (the visited cells)
export const FOG_RES = 3;            // m per pixel of the fog buffer
export const FOG_SIZE = 640;         // px of the fog buffer (1.92 km)
export const SPANS = [120, 240, 480, 960];   // m across the map (zoom levels)
const SUB = MAP_CELL / FOG_RES;      // px per cell (4)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const cellOf = (x, z) => [Math.floor(x / MAP_CELL), Math.floor(z / MAP_CELL)];
export const cellKey = (i, j) => `${i},${j}`;
export const parseCell = (k) => { const c = k.indexOf(','); return [+k.slice(0, c), +k.slice(c + 1)]; };

// view: { cx, cz (world centre, m), k (px per m), w, h (px) }. North up:
// +x right, +z down (the HUD compass: north is -z, east is +x).
export function worldToMap(x, z, v) { return [(x - v.cx) * v.k + v.w / 2, (z - v.cz) * v.k + v.h / 2]; }
export function mapToWorld(px, py, v) { return [v.cx + (px - v.w / 2) / v.k, v.cz + (py - v.h / 2) / v.k]; }
// The map direction of a yaw (rov/pilot.js: forward = [cos yaw, sin yaw] in x, z).
export function headingVec(yaw) { return [Math.cos(yaw), Math.sin(yaw)]; }

// The depth colour (sRGB bytes): turquoise shallows, reef teal, twilight
// blue, abyss indigo, trench near black. Stops in m of depth.
export const DEPTH_STOPS = [
  [0, [143, 243, 224]], [10, [79, 214, 200]], [30, [42, 166, 168]], [45, [33, 127, 153]],
  [200, [29, 90, 138]], [1000, [27, 55, 104]], [3000, [26, 32, 80]], [6000, [18, 15, 48]],
];
export const LEGEND_STOPS = [0, 40, 200, 1000, 6000];
const dl = (d) => Math.log10(1 + Math.max(0, d));
export function depthColour(d) {
  const S = DEPTH_STOPS;
  if (d <= S[0][0]) return S[0][1].slice();
  for (let i = 1; i < S.length; i++) {
    if (d <= S[i][0]) {
      const u = (dl(d) - dl(S[i - 1][0])) / (dl(S[i][0]) - dl(S[i - 1][0]));
      return [0, 1, 2].map(c => Math.round(S[i - 1][1][c] + (S[i][1][c] - S[i - 1][1][c]) * u));
    }
  }
  return S[S.length - 1][1].slice();
}
// A continuous, rising level: one contour every 5 m to 60 m deep, every
// 25 m to 400 m, every 100 m to 2000 m, then every 250 m.
export function contourLevel(d) {
  d = Math.max(0, d);
  if (d < 60) return d / 5;
  if (d < 400) return 12 + (d - 60) / 25;
  if (d < 2000) return 25.6 + (d - 400) / 100;
  return 41.6 + (d - 2000) / 250;
}
export const REGION_TINT = { shallows: [127, 224, 207], reef: [255, 179, 138], twilight: [74, 123, 208], abyss: [58, 47, 122], trench: [26, 15, 42] };

// A scale bar near target px: { m, px } with m in 1, 2, 5 x 10^n.
export function niceScale(k, target = 50) {
  const raw = target / k, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = [1, 2, 5, 10].map(f => f * p).reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
  return { m, px: m * k };
}
// The view cone of the camera: [apex, left, right] in world (x, z).
export function coneOf(eye, look, fovH, len) {
  const dx = look[0] - eye[0], dz = look[2] - eye[2], a = Math.atan2(dz, dx), h = fovH / 2;
  if (!Number.isFinite(a) || (dx === 0 && dz === 0)) return null;
  return [[eye[0], eye[2]], [eye[0] + Math.cos(a - h) * len, eye[2] + Math.sin(a - h) * len], [eye[0] + Math.cos(a + h) * len, eye[2] + Math.sin(a + h) * len]];
}

// ── the fog buffer ──────────────────────────────────────────────────────────
// o: { ground(x, z) -> y, region?(x, z) -> { id }, surfaceY, size, res, doc }
export function createFogMap(o) {
  const size = o.size || FOG_SIZE, res = o.res || FOG_RES, sub = MAP_CELL / res, surf = o.surfaceY ?? 55;
  const px = new Uint8ClampedArray(size * size * 4);
  const doc = o.doc || null;
  let cv = null, cx2 = null, img = null;
  if (doc && doc.createElement) {
    try { cv = doc.createElement('canvas'); cv.width = size; cv.height = size; cx2 = cv.getContext('2d'); img = cx2 && cx2.createImageData ? cx2.createImageData(size, size) : null; } catch { cv = null; }
    if (!cx2 || !img) { cv = null; cx2 = null; img = null; }
  }
  // the anchor: the world point (m) of pixel (0, 0); cell aligned
  let ax = 0, az = 0;
  const painted = new Set(), queued = new Set(), queue = [];
  let dirty = null;                   // [x0, y0, x1, y1] px to put
  const F = {
    size, res, painted, get anchor() { return [ax, az]; }, get pending() { return queue.length; }, canvas: cv,
    // is the cell (i, j) inside the buffer
    inside(i, j) { const x = i * MAP_CELL - ax, z = j * MAP_CELL - az; return x >= 0 && z >= 0 && x + MAP_CELL <= size * res && z + MAP_CELL <= size * res; },
    add(key) {
      if (painted.has(key) || queued.has(key)) return false;
      const [i, j] = parseCell(key);
      if (!F.inside(i, j)) return false;
      queued.add(key); queue.push(key); return true;
    },
    // centre the buffer on (x, z) when the box [x +- r, z +- r] leaves it
    // (with a 10 % margin); known: the visited keys to paint again
    follow(x, z, r, known) {
      const W = size * res, m = W * 0.1;
      if (x - r >= ax + m && x + r <= ax + W - m && z - r >= az + m && z + r <= az + W - m) return false;
      ax = Math.floor((x - W / 2) / MAP_CELL) * MAP_CELL; az = Math.floor((z - W / 2) / MAP_CELL) * MAP_CELL;
      px.fill(0); painted.clear(); queued.clear(); queue.length = 0; dirty = [0, 0, size, size];
      if (known) for (const k of known) F.add(k);
      return true;
    },
    // paint queued cells for at most ms (or n cells when no clock)
    work(ms = 2, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
      const t0 = now();
      let n = 0;
      while (queue.length && (n === 0 || now() - t0 < ms)) { const k = queue.shift(); queued.delete(k); paint(k); n++; }
      return n;
    },
    // the RGBA of the pixel over world (x, z), or null outside
    pixelAt(x, z) {
      const u = Math.floor((x - ax) / res), v = Math.floor((z - az) / res);
      if (u < 0 || v < 0 || u >= size || v >= size) return null;
      const i = (v * size + u) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    },
    // copy the painted pixels to the canvas (once per draw)
    flush() {
      if (!dirty || !cx2) { dirty = null; return; }
      const [x0, y0, x1, y1] = dirty;
      img.data.set(px);
      cx2.putImageData(img, 0, 0, x0, y0, x1 - x0, y1 - y0);
      dirty = null;
    },
    reset() { px.fill(0); painted.clear(); queued.clear(); queue.length = 0; dirty = [0, 0, size, size]; },
    pixels: px,
  };
  function paint(key) {
    const [i, j] = parseCell(key);
    if (!F.inside(i, j)) return;
    const x0 = i * MAP_CELL, z0 = j * MAP_CELL, n = sub + 2;
    // (sub + 2)^2 depths: the cell pixels and a one-pixel ring (contours, shade)
    const D = new Float64Array(n * n);
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) D[b * n + a] = surf - o.ground(x0 + (a - 0.5) * res, z0 + (b - 0.5) * res);
    const rg = o.region ? o.region(x0 + MAP_CELL / 2, z0 + MAP_CELL / 2) : null, tint = rg && REGION_TINT[rg.id];
    const u0 = Math.round((x0 - ax) / res), v0 = Math.round((z0 - az) / res);
    for (let b = 1; b <= sub; b++) for (let a = 1; a <= sub; a++) {
      const d = D[b * n + a], c = depthColour(d);
      // hill shade: light from the north west (-x, -z), on the depth slope
      const gx = (D[b * n + a + 1] - D[b * n + a - 1]) / (2 * res), gz = (D[(b + 1) * n + a] - D[(b - 1) * n + a]) / (2 * res);
      const shade = clamp(1 + 0.9 * (gx + gz) / Math.sqrt(2), 0.55, 1.35);
      const L = contourLevel(d), on = [D[b * n + a + 1], D[(b + 1) * n + a]].some(e => Math.floor(contourLevel(e)) !== Math.floor(L));
      const k = (on ? 0.62 : 1) * shade;
      const q = ((v0 + b - 1) * size + (u0 + a - 1)) * 4;
      for (let ch = 0; ch < 3; ch++) px[q + ch] = clamp((tint ? c[ch] * 0.82 + tint[ch] * 0.18 : c[ch]) * k, 0, 255);
      px[q + 3] = 255;
    }
    painted.add(key);
    if (cx2) {
      const r = [u0, v0, u0 + sub, v0 + sub];
      dirty = dirty ? [Math.min(dirty[0], r[0]), Math.min(dirty[1], r[1]), Math.max(dirty[2], r[2]), Math.max(dirty[3], r[3])] : r;
    }
  }
  return F;
}

// ── one draw ────────────────────────────────────────────────────────────────
// s: { w, h, view, fog, rovs: [{ id, p: [x, y, z], yaw, colour, trail: [[x, z]...], sel }],
//      cone: [[x, z] x 3] | null, target: [x, z] | null, title, sub, dpr }
// Returns the arrows it drew: [{ id, x, y, ang, sel }] (map px), for tests.
export function drawMinimap(ctx, s) {
  const { w, h, view: v } = s, out = [];
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#02070c'; ctx.fillRect(0, 0, w, h);
  // a faint 100 m grid in the fog
  ctx.strokeStyle = 'rgba(120,210,220,0.07)'; ctx.lineWidth = 1;
  const g = 100, gx0 = Math.ceil((v.cx - v.w / 2 / v.k) / g) * g, gz0 = Math.ceil((v.cz - v.h / 2 / v.k) / g) * g;
  ctx.beginPath();
  for (let x = gx0; x < v.cx + v.w / 2 / v.k; x += g) { const p = worldToMap(x, 0, v)[0]; ctx.moveTo(Math.round(p) + 0.5, 0); ctx.lineTo(Math.round(p) + 0.5, h); }
  for (let z = gz0; z < v.cz + v.h / 2 / v.k; z += g) { const p = worldToMap(0, z, v)[1]; ctx.moveTo(0, Math.round(p) + 0.5); ctx.lineTo(w, Math.round(p) + 0.5); }
  ctx.stroke();
  // the explored ground
  const F = s.fog;
  if (F && F.canvas) {
    F.flush();
    const [ax, az] = F.anchor, sx = (v.cx - v.w / 2 / v.k - ax) / F.res, sz = (v.cz - v.h / 2 / v.k - az) / F.res, sw = v.w / v.k / F.res, sh = v.h / v.k / F.res;
    ctx.imageSmoothingEnabled = v.k * F.res < 2;
    ctx.drawImage(F.canvas, sx, sz, sw, sh, 0, 0, w, h);
  }
  // the camera view cone
  if (s.cone) {
    const P = s.cone.map(q => worldToMap(q[0], q[1], v));
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.lineTo(P[2][0], P[2][1]); ctx.closePath();
    ctx.fillStyle = 'rgba(212,236,239,0.10)'; ctx.fill();
    ctx.strokeStyle = 'rgba(212,236,239,0.35)'; ctx.stroke();
  }
  // a sent target
  if (s.target) {
    const [tx, ty] = worldToMap(s.target[0], s.target[1], v);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.moveTo(tx - 8, ty); ctx.lineTo(tx + 8, ty); ctx.moveTo(tx, ty - 8); ctx.lineTo(tx, ty + 8); ctx.stroke();
  }
  // trails, then the arrows (the selected one last, on top)
  const R = (s.rovs || []).slice().sort((a, b) => (a.sel ? 1 : 0) - (b.sel ? 1 : 0));
  for (const r of R) {
    if (!r.trail || r.trail.length < 2) continue;
    ctx.strokeStyle = r.colour; ctx.globalAlpha = r.sel ? 0.75 : 0.45; ctx.lineWidth = r.sel ? 2 : 1.4;
    ctx.beginPath();
    r.trail.forEach((q, i) => { const m = worldToMap(q[0], q[1], v); if (i) ctx.lineTo(m[0], m[1]); else ctx.moveTo(m[0], m[1]); });
    const m = worldToMap(r.p[0], r.p[2], v); ctx.lineTo(m[0], m[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const r of R) {
    const [x, y] = worldToMap(r.p[0], r.p[2], v), [fx, fz] = headingVec(r.yaw), ang = Math.atan2(fz, fx);
    const L = r.sel ? 9 : 6.5;
    const xs = clamp(x, 4, w - 4), ys = clamp(y, 4, h - 4);
    ctx.save(); ctx.translate(xs, ys); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(-L * 0.7, L * 0.62); ctx.lineTo(-L * 0.35, 0); ctx.lineTo(-L * 0.7, -L * 0.62); ctx.closePath();
    ctx.fillStyle = r.colour; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(2,7,12,0.9)'; ctx.stroke();
    ctx.restore();
    if (r.sel) { ctx.strokeStyle = r.colour; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(xs, ys, 13, 0, Math.PI * 2); ctx.stroke(); }
    out.push({ id: r.id, x: xs, y: ys, ang, sel: !!r.sel });
  }
  // the scale bar (lower left) and the north mark
  const sc = niceScale(v.k, Math.min(60, w * 0.3));
  ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace'; ctx.textBaseline = 'bottom';
  ctx.strokeStyle = 'rgba(212,236,239,0.9)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(8, h - 8); ctx.lineTo(8 + sc.px, h - 8); ctx.moveTo(8, h - 11); ctx.lineTo(8, h - 5); ctx.moveTo(8 + sc.px, h - 11); ctx.lineTo(8 + sc.px, h - 5); ctx.stroke();
  ctx.fillStyle = 'rgba(212,236,239,0.9)'; ctx.textAlign = 'left';
  ctx.fillText(sc.m >= 1000 ? `${sc.m / 1000} km` : `${sc.m} m`, 8, h - 12);
  ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('N ↑', w - 6, 6);
  // the region and the depth of the selected ROV (upper left)
  if (s.title) { ctx.textAlign = 'left'; ctx.fillStyle = s.titleColour || 'rgba(212,236,239,0.95)'; ctx.fillText(s.title, 7, 6); }
  if (s.sub) { ctx.fillStyle = 'rgba(127,161,168,0.95)'; ctx.fillText(s.sub, 7, 19); }
  ctx.restore();
  return { arrows: out, scale: sc };
}
