// ============================================================================
//  AUTOREGRESSIVE VIEW MODEL  ·  world.js — the toy world of the lab
// ----------------------------------------------------------------------------
//  Pure module (no DOM). A 2D floor plan (metres) seen from above. A camera
//  is a pose { x, y, yaw } with a field of view FOV. A view is COLS ray-cast
//  columns: each column hits a wall segment, and the hit point falls in a
//  surface bin (segment id, BIN metres along it). The bin is the unit of
//  "what the view shows". truthColor(key) is the real colour of a bin.
//  This stands in for the 3D scene of the paper; it is not the paper's model.
//
//  grep -n: "export const SEGS"  "export function raycast"  "export function observe"
//           "export function truthColor"  "export const PATHS"  "export function inView"
// ============================================================================

export const FOV = 70 * Math.PI / 180, COLS = 48, BIN = 0.4;
export const WORLD = { w: 20, h: 12 };

// Walls and furniture as segments: [x0, y0, x1, y1, hue].
const RAW = [
  // outer walls
  [0, 0, 20, 0, 28], [20, 0, 20, 12, 200], [20, 12, 0, 12, 40], [0, 12, 0, 0, 215],
  // inner walls with doorways
  [8, 0, 8, 4.5, 140], [8, 6.5, 8, 12, 140], [8, 7.5, 13, 7.5, 330], [15, 7.5, 20, 7.5, 330],
  // kitchen island
  [2.5, 3, 5, 3, 12], [5, 3, 5, 4.2, 12], [5, 4.2, 2.5, 4.2, 12], [2.5, 4.2, 2.5, 3, 12],
  // sofa and table
  [11, 2.5, 15.5, 2.5, 265], [15.5, 2.5, 15.5, 3.4, 265], [15.5, 3.4, 11, 3.4, 265], [11, 3.4, 11, 2.5, 265],
  [16.5, 9.5, 18, 9.5, 95], [18, 9.5, 18, 10.6, 95], [18, 10.6, 16.5, 10.6, 95], [16.5, 10.6, 16.5, 9.5, 95],
  // shelf and pillar
  [2, 9, 5.5, 9, 55], [10.5, 10, 11.3, 10, 175], [11.3, 10, 11.3, 10.8, 175], [11.3, 10.8, 10.5, 10.8, 175], [10.5, 10.8, 10.5, 10, 175],
];
export const SEGS = RAW.map(([x0, y0, x1, y1, hue], id) => ({ id, x0, y0, x1, y1, hue, len: Math.hypot(x1 - x0, y1 - y0) }));

// Nearest hit of the ray from (x, y) at angle a.
export function raycast(x, y, a) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = null, bd = Infinity;
  for (const s of SEGS) {
    const ex = s.x1 - s.x0, ey = s.y1 - s.y0;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const qx = s.x0 - x, qy = s.y0 - y;
    const t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < bd) { bd = t; best = { seg: s, u, dist: t, hx: x + dx * t, hy: y + dy * t }; }
  }
  return best;
}
export const binKey = (seg, u) => seg.id * 1000 + Math.min(Math.floor(u * seg.len / BIN), 999);

// The columns of a view: the bin key, distance and hit point of each ray.
export function observe(pose) {
  const cols = [];
  for (let c = 0; c < COLS; c++) {
    const a = pose.yaw + FOV * (0.5 - (c + 0.5) / COLS);
    const h = raycast(pose.x, pose.y, a);
    cols.push(h ? { key: binKey(h.seg, h.u), dist: h.dist, hx: h.hx, hy: h.hy } : { key: -1, dist: 30, hx: pose.x, hy: pose.y });
  }
  return cols;
}

// Is the point (px, py) inside the view of pose, at positive depth?
export function inView(pose, px, py) {
  const a = Math.atan2(py - pose.y, px - pose.x);
  let d = a - pose.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) <= FOV / 2;
}

function hsl(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
// The true colour of a surface bin: the wall hue with a stripe texture.
export function truthColor(key) {
  const seg = SEGS[Math.floor(key / 1000)], b = key % 1000;
  if (!seg) return [20, 22, 28];
  return hsl(seg.hue, 0.55, 0.42 + 0.14 * Math.sin(b * 1.7) * Math.cos(b * 0.6));
}
// A plausible colour the toy prior imagines for a bin it has no context
// for: same lightness range, any hue. salt makes each imagining new.
export function priorColor(key, salt) {
  let h = (key * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return hsl((h % 360), 0.35 + ((h >>> 9) % 20) / 100, 0.38 + ((h >>> 17) % 18) / 100);
}

// Camera paths: arrays of poses, one per target view.
const lerpPath = (pts, n) => {
  const out = [], segL = [];
  let tot = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segL.push(l); tot += l; }
  for (let k = 0; k < n; k++) {
    let d = tot * k / (n - 1), i = 0;
    while (i < segL.length - 1 && d > segL[i]) { d -= segL[i]; i++; }
    const u = Math.min(1, d / (segL[i] || 1)), a = pts[i], b = pts[i + 1];
    out.push({ x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  return out;
};
const smoothYaw = P => { for (let i = 1; i < P.length - 1; i++) { const a = P[i - 1].yaw, b = P[i + 1].yaw; P[i].yaw = Math.atan2(Math.sin(a) + Math.sin(P[i].yaw) * 2 + Math.sin(b), Math.cos(a) + Math.cos(P[i].yaw) * 2 + Math.cos(b)); } return P; };
export const PATHS = {
  outback: {
    name: 'Out and back', note: 'Walk from the kitchen through the doorway to the far room, then reverse along the same path, the camera facing the same way (the paper calls this a reflection). Every view on the way back was made long ago.',
    poses() { const go = smoothYaw(lerpPath([[3, 6.5], [6.5, 5.5], [9.5, 5.5], [12, 5.5], [14, 9.5], [18.5, 9]], 60)); const back = go.slice().reverse().map(p => ({ ...p })); return go.concat(back); },
  },
  loop: {
    name: 'Loop', note: 'One lap of the flat, then on past the start along the first stretch again. The last chunks look at walls first made in the first chunks.',
    poses() { return smoothYaw(lerpPath([[3, 6.5], [6.5, 5.5], [10, 5.5], [14, 5], [18, 4.5], [18.5, 1.5], [13, 1.2], [9.5, 1.5], [9.5, 5.5], [6.5, 6], [3, 6.5], [3, 8.5], [1.5, 6.5], [3, 5.2], [6.5, 5.5], [9.5, 5.5], [12, 5.5]], 150)); },
  },
  orbit: {
    name: 'Orbit', note: 'Two laps around the sofa, looking in. The second lap is a full revisit of the first.',
    poses() { const out = []; for (let k = 0; k < 120; k++) { const a = 2 * Math.PI * 2 * k / 120; out.push({ x: 13.25 + 3.2 * Math.cos(a), y: 3.6 + 2.3 * Math.sin(a), yaw: a + Math.PI }); } return out; },
  },
  pan: {
    name: 'Look around', note: 'Stand in the middle of the living room and turn twice. Rotation only: the views change fast while the camera stays put.',
    poses() { const out = []; for (let k = 0; k < 96; k++) out.push({ x: 13, y: 5.4, yaw: 2 * Math.PI * 2 * k / 96 }); return out; },
  },
};
// Default prefill: a few posed images near the start of each path.
export function prefillFor(key, n) {
  const P = PATHS[key].poses(), out = [];
  for (let i = 0; i < n; i++) { const p = P[Math.min(P.length - 1, Math.round(i * 3))]; out.push({ x: p.x + 0.3 * Math.cos(i * 2.1), y: p.y + 0.3 * Math.sin(i * 2.1), yaw: p.yaw + (i - (n - 1) / 2) * 0.35 }); }
  return out;
}
