// ============================================================================
//  POOL PHYSICS  ·  core/table.js — the 9 ft table, its pockets and racks
// ----------------------------------------------------------------------------
//  The sizes come from the WPA equipment specifications for a 9 ft table:
//    playing surface ...... 100 x 50 in (between the cushion noses)
//    ball ................. 2.25 in diameter, 5.5 to 6 oz
//    corner pocket mouth .. 4.5 to 4.625 in, jaw angle 142 deg
//    side pocket mouth .... 5 to 5.125 in, jaw angle 104 deg
//    cushion nose height .. 63.5 % of the ball diameter
//    diamonds ............. 12.5 in apart, 3 11/16 in behind the nose
//    head string .......... through the second diamonds from the head rail
//  Units are metres. The origin is the table centre, x runs along the
//  length (the foot rail is at +x) and y runs across. No DOM.
//
//  The cushion is a list of segments (the nose lines and the jaws), each
//  with a normal that points into the playing area, and a list of points
//  (the jaw tips). A ball falls when its centre goes over a pocket hole.
//
//  grep -n targets: "export const SPEC", "export function buildTable",
//  "export function rack8", "export function rack9", "export function
//  diamonds", "export function legalCuePlace"
// ============================================================================

const IN = 0.0254;
const D2R = Math.PI / 180;

export const SPEC = {
  L: 100 * IN,               // playing length (nose to nose)
  W: 50 * IN,                // playing width
  R: 1.125 * IN,             // ball radius
  m: 0.17,                   // ball mass (6 oz)
  cornerMouth: 4.6 * IN,
  sideMouth: 5.0625 * IN,
  cornerJaw: 142,            // degrees between the nose line and the jaw face
  sideJaw: 104,
  noseH: 0.635 * 2.25 * IN,  // cushion nose height over the cloth
  cushionW: 2 * IN,          // nose to the wood
  railW: 4.5 * IN,           // wood top of the rail
  diamondBack: (3 + 11 / 16) * IN,
  cornerShelf: 1.4 * IN,     // mouth line to the hole edge
  sideShelf: 0.25 * IN,
  cornerHole: 2.3 * IN,      // hole radius
  sideHole: 2.4 * IN,
  bedH: 30 * IN,             // cloth height over the floor (3D only)
};

// One table. Every array is plain data, so a clone is cheap to share.
export function buildTable(spec = SPEC) {
  const { L, W } = spec, hx = L / 2, hy = W / 2;
  const a = spec.cornerMouth / Math.SQRT2;   // the nose ends this far from the corner
  const b = spec.sideMouth / 2;
  const segs = [], pts = [], pockets = [];
  const seg = (ax, ay, bx, by, nx, ny, kind) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    segs.push({ ax, ay, bx, by, nx, ny, tx: dx / len, ty: dy / len, len, kind });
  };
  // nose lines: long rails (split at the side pockets) and short rails
  for (const sy of [1, -1]) {
    seg(-hx + a, sy * hy, -b, sy * hy, 0, -sy, 'rail');
    seg(b, sy * hy, hx - a, sy * hy, 0, -sy, 'rail');
  }
  for (const sx of [1, -1]) seg(sx * hx, -hy + a, sx * hx, hy - a, -sx, 0, 'rail');

  // corner pockets: jaws from both nose ends, turned (180 - jaw) deg out of
  // the nose line toward the pocket
  const cj = (180 - spec.cornerJaw) * D2R, jl = 0.07;
  const sj = (180 - spec.sideJaw) * D2R, sl = 0.055;
  let id = 0;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    // template for the (+,+) corner, then mirrored
    const p1 = [hx - a, hy], d1 = [Math.cos(cj), Math.sin(cj)], n1 = [Math.sin(cj), -Math.cos(cj)];
    const p2 = [hx, hy - a], d2 = [Math.sin(cj), Math.cos(cj)], n2 = [-Math.cos(cj), Math.sin(cj)];
    for (const [p, d, n] of [[p1, d1, n1], [p2, d2, n2]]) {
      const ax = sx * p[0], ay = sy * p[1], bx = ax + sx * d[0] * jl, by = ay + sy * d[1] * jl;
      seg(ax, ay, bx, by, sx * n[0], sy * n[1], 'jaw');
      pts.push({ x: ax, y: ay, kind: 'tip' }, { x: bx, y: by, kind: 'back' });
    }
    const mx = sx * (hx - a / 2), my = sy * (hy - a / 2), k = (spec.cornerShelf + spec.cornerHole) / Math.SQRT2;
    // aim: the point on the mouth line a ball aims at; hole: the drop circle
    pockets.push({ id: id++, kind: 'corner', sx, sy, mx, my, ax: mx, ay: my, hx: mx + sx * k, hy: my + sy * k, r: spec.cornerHole,
      // the mouth direction (out of the table) for the approach test
      ox: sx / Math.SQRT2, oy: sy / Math.SQRT2, mouth: spec.cornerMouth });
  }
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      // tip at (sx b, sy hy); the jaw turns (180 - jaw) deg from the nose
      // line toward the pocket and out of the table; the normal faces the
      // pocket corridor (toward x = 0) and the table
      const ax = sx * b, ay = sy * hy;
      const dx = -sx * Math.cos(sj), dy = sy * Math.sin(sj);
      seg(ax, ay, ax + dx * sl, ay + dy * sl, -sx * Math.sin(sj), -sy * Math.cos(sj), 'jaw');
      pts.push({ x: ax, y: ay, kind: 'tip' }, { x: ax + dx * sl, y: ay + dy * sl, kind: 'back' });
    }
    pockets.push({ id: id++, kind: 'side', sx: 0, sy, mx: 0, my: sy * hy, ax: 0, ay: sy * (hy + 0.004), hx: 0, hy: sy * (hy + spec.sideShelf + spec.sideHole), r: spec.sideHole,
      ox: 0, oy: sy, mouth: spec.sideMouth });
  }
  return { spec, L, W, hx, hy, R: spec.R, segs, pts, pockets, headX: -L / 4, footX: L / 4,
    // the box inside which no cushion check is needed
    inner: { x: hx - spec.R, y: hy - spec.R } };
}

// The 18 diamonds on the rail tops: { x, y } at the diamond, side 'long' or 'short'.
export function diamonds(T) {
  const out = [], d = T.spec.diamondBack, step = T.L / 8;
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    const x = -T.hx + k * step;
    out.push({ x, y: T.hy + d, side: 'long' }, { x, y: -T.hy - d, side: 'long' });
  }
  for (let k = 1; k < 4; k++) {
    const y = -T.hy + k * T.W / 4;
    out.push({ x: T.hx + d, y, side: 'short' }, { x: -T.hx - d, y, side: 'short' });
  }
  return out;
}

// Ball look: number 0 is the cue ball, 1-7 solids, 8 the black, 9-15 stripes.
export const BALL_COLORS = ['#f4f1e8', '#f3c11b', '#1d4fbf', '#d3302a', '#4e2a8a', '#f0731f', '#137a3d', '#7b1f26', '#121212'];
export const ballColor = n => BALL_COLORS[n === 0 ? 0 : ((n - 1) % 8) + 1];
export const isStripe = n => n >= 9;

// Seeded random numbers (mulberry32). Same seed, same racks and noise.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.gauss = () => { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return r;
}

// Rack positions: rows from the foot spot toward the foot rail. Balls touch
// with a gap of `gap` metres plus a small seeded jitter, so each seed breaks
// in its own way.
function rackSpots(T, rows, r, gap) {
  const R = T.R, dx = (2 * R + gap) * Math.sqrt(3) / 2, out = [];
  rows.forEach((n, i) => {
    for (let j = 0; j < n; j++) {
      const y = (j - (n - 1) / 2) * (2 * R + gap);
      out.push({ row: i, col: j, n, x: T.footX + i * dx + (r() - 0.5) * gap * 0.6, y: y + (r() - 0.5) * gap * 0.6 });
    }
  });
  return out;
}

// A legal 8-ball rack: a triangle with the apex on the foot spot, the 8 in
// the middle of the third row, a solid and a stripe in the two back corners.
// Returns [{ n, x, y }] for the 15 object balls.
export function rack8(T, r, gap = 0.0001) {
  const spots = rackSpots(T, [1, 2, 3, 4, 5], r, gap);
  const mid = spots.findIndex(s => s.row === 2 && s.col === 1);
  const backL = spots.findIndex(s => s.row === 4 && s.col === 0), backR = spots.findIndex(s => s.row === 4 && s.col === 4);
  const solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(solids); shuffle(stripes);
  const out = new Array(15);
  out[mid] = 8;
  const solidLeft = r() < 0.5;
  out[backL] = solidLeft ? solids.pop() : stripes.pop();
  out[backR] = solidLeft ? stripes.pop() : solids.pop();
  const rest = shuffle(solids.concat(stripes));
  for (let i = 0; i < 15; i++) if (out[i] === undefined) out[i] = rest.pop();
  return spots.map((s, i) => ({ n: out[i], x: s.x, y: s.y, row: s.row, col: s.col }));
}

// A 9-ball rack: a diamond, the 1 on the foot spot, the 9 in the middle.
export function rack9(T, r, gap = 0.0001) {
  const spots = rackSpots(T, [1, 2, 3, 2, 1], r, gap);
  const others = [2, 3, 4, 5, 6, 7, 8];
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  return spots.map((s, i) => {
    const n = i === 0 ? 1 : (s.row === 2 && s.col === 1) ? 9 : others.pop();
    return { n, x: s.x, y: s.y, row: s.row, col: s.col };
  });
}

// Is the rack legal for 8-ball? Used by the tests and by the page guard.
export function isLegalRack8(T, balls) {
  if (balls.length !== 15 || new Set(balls.map(b => b.n)).size !== 15) return false;
  const apex = balls.find(b => b.row === 0);
  if (!apex || Math.abs(apex.x - T.footX) > 0.002 || Math.abs(apex.y) > 0.002) return false;
  const eight = balls.find(b => b.n === 8);
  if (!(eight.row === 2 && eight.col === 1)) return false;
  const back = balls.filter(b => b.row === 4 && (b.col === 0 || b.col === 4)).map(b => b.n >= 9);
  if (back.length !== 2 || back[0] === back[1]) return false;
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++)
    if (Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y) < 2 * T.R - 1e-9) return false;
  return true;
}

// Cue ball placement: in the kitchen (behind the head string) or anywhere,
// clear of the other balls and of the cushions.
export function legalCuePlace(T, x, y, others, kitchen) {
  const R = T.R;
  if (Math.abs(y) > T.hy - R || Math.abs(x) > T.hx - R) return false;
  if (kitchen && x > T.headX) return false;
  for (const o of others) if (Math.hypot(o.x - x, o.y - y) < 2 * R + 1e-4) return false;
  return true;
}
