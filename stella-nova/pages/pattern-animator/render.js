// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  render.js — draw one frame on a 2D context
// ----------------------------------------------------------------------------
//  drawFrame(g, layers, R) draws the frame buffers of motion.js frame() on
//  any CanvasRenderingContext2D (the board, the export canvas, the saver).
//  layers: [{ G, F }] in paint order (a morph has two). R: { W, H (view
//  board, design units), base: [k, ox, oy] (px per unit and the board
//  origin in canvas px), lut (colour positions -> CSS colours), paper, lw,
//  lwScale, clip (view rings or null), frame (draw the clip line) }.
//
//  BATCHES. A run of elements of one style is one canvas path and one fill
//  or stroke call (the rule of pattern-designer export.js: a line or an
//  outline, or a solid with no stroke that is not even-odd). The elements
//  go in the order of motion.js drawOrder (G.order, groups G.gs): by
//  level, then by style, so the runs are long and no two elements that
//  may overlap change places unless they have the same style. A solid
//  with an outline also runs: all fills, then all outlines.
//  When a colour cycle has a wave across (F.cvar), a group draws one run
//  per colour in it.
//
//  STILL FRAMES. When the points do not move (motion.js C.still: only
//  board channels, a global colour cycle or dashes), the batches are
//  Path2D objects that stay on the geometry (G._still). A frame then sets
//  one transform and calls fill or stroke once per batch. No point is
//  read again.
//
//  The function makes no array per element and no string per element.
//
//  grep -n targets: "export function drawFrame", "function drawLive",
//                   "function run", "function buildStill", "function trace",
//                   "export const cls"
// ============================================================================
export const MERGE_MAX = 4000;

const colour = (R, pos) => pos === -2 ? R.paper : R.lut[pos] || R.paper;

export function drawFrame(g, layers, R) {
  const [k, ox, oy] = R.base;
  g.save();
  g.setTransform(k, 0, 0, k, ox, oy);
  g.beginPath();
  if (R.clip && R.clip.length) { for (const r of R.clip) ring(g, r); g.clip('evenodd'); }
  else { g.rect(0, 0, R.W, R.H); g.clip(); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  let pts = 0, calls = 0;
  for (const { G, F } of layers) {
    const M = F.M;
    g.setTransform(k * M[0], k * M[1], k * M[2], k * M[3], k * M[4] + ox, k * M[5] + oy);
    if (F.dash) { g.setLineDash([F.dash[0], F.dash[1]]); g.lineDashOffset = F.dash[2]; }
    else if (g.setLineDash) g.setLineDash([]);
    const st = F.still && typeof Path2D !== 'undefined' ? drawStill(g, G, F, R) : drawLive(g, G, F, R);
    pts += st.pts; calls += st.calls;
  }
  g.restore();
  if (R.frame && R.clip && R.clip.length) {
    g.save(); g.setTransform(k, 0, 0, k, ox, oy); g.beginPath();
    for (const r of R.clip) ring(g, r);
    g.lineWidth = (R.lw || 2) * 1.5; g.strokeStyle = R.lut[0] || '#000'; g.stroke(); g.restore();
  }
  return { pts, calls };
}
function ring(g, r) { g.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]); g.closePath(); }

// Trace element i of G from the point list P (and circles from cx, cy, cr).
function trace(g, G, i, P, cx, cy, cr) {
  if (G.t[i] === 1) { const x = cx[i], y = cy[i], r = cr[i]; if (r > 0) { g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.283185307179586); } return; }
  const fl = G.fl[i], closed = fl & 1, smooth = fl & 2;
  for (let ri = G.r0[i]; ri < G.r1[i]; ri++) {
    const s = G.rs[ri], m = G.rn[ri];
    if (m < 2) continue;
    if (smooth && m >= 3) { curve(g, P, s, m, closed); if (closed) g.closePath(); continue; }
    let j = 2 * s;
    g.moveTo(P[j], P[j + 1]);
    for (let q = 1; q < m; q++) { j += 2; g.lineTo(P[j], P[j + 1]); }
    if (closed) g.closePath();
  }
}
// Catmull-Rom spans as cubic Beziers (the same curve as export.js).
function curve(g, P, s, m, closed) {
  const at = i => 2 * (s + (closed ? (i + m) % m : Math.max(0, Math.min(m - 1, i))));
  g.moveTo(P[2 * s], P[2 * s + 1]);
  const last = closed ? m : m - 1;
  for (let i = 0; i < last; i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    g.bezierCurveTo(P[b] + (P[c] - P[a]) / 6, P[b + 1] + (P[c + 1] - P[a + 1]) / 6,
      P[c] - (P[d] - P[b]) / 6, P[c + 1] - (P[d + 1] - P[b + 1]) / 6, P[c], P[c + 1]);
  }
}

// The class of an element: 1 a line or outline, 2 a solid with no stroke,
// 3 a solid with an outline (an ink, or the paper in Cut-out), 0 any other
// (an even-odd shape, drawn alone). A run of class 3 fills all its shapes
// and then strokes all the outlines, so the outline of two shapes of one
// style that touch is whole (drawn alone, the second fill covers half).
export const cls = (f, s, t) => f === -1 ? (s === -1 ? 0 : 1) : t === 2 ? 0 : s === -1 ? 2 : 3;

function drawLive(g, G, F, R) {
  const still = F.still, P = still ? G.pts : F.pts, cx = still ? G.cx : F.cx, cy = still ? G.cy : F.cy, cr = still ? G.cr : F.cr;
  const lw = (R.lw || 2) * (R.lwScale || 1), order = G.order, gs = G.gs, st = { pts: 0, calls: 0 };
  const seen = R._seen || (R._seen = new Uint8Array(4096)), list = R._list || (R._list = new Int32Array(4096));
  for (let gi = 0; gi + 1 < gs.length; gi++) {
    const a = gs[gi], b = gs[gi + 1], i0 = order[a], c = cls(G.f[i0], G.s[i0], G.t[i0]);
    if (c === 0) {
      for (let q = a; q < b; q++) {
        const i = order[q];
        if (!still && F.sc[i] < 0.004) continue;
        const f = G.f[i], s = G.s[i];
        st.pts += G.t[i] === 1 ? 1 : ringPts(G, i);
        g.beginPath(); trace(g, G, i, P, cx, cy, cr);
        if (f !== -1) { g.fillStyle = colour(R, F.fc[i]); g.fill(G.t[i] === 2 ? 'evenodd' : 'nonzero'); st.calls++; }
        if (s !== -1) { g.strokeStyle = colour(R, F.kc[i]); g.lineWidth = lw * G.w[i] * (s === -2 ? 0.8 : 1); g.stroke(); st.calls++; }
      }
      continue;
    }
    if (!F.cvar) { run(g, G, F, R, a, b, c, null, P, cx, cy, cr, lw, st); continue; }
    // Colours that vary per element: one run per colour in the group.
    let m = 0;
    for (let q = a; q < b; q++) {
      const i = order[q];
      if (!still && F.sc[i] < 0.004) continue;
      const col = (c === 1 ? F.kc[i] : F.fc[i]) + 2;
      if (!seen[col]) { seen[col] = 1; list[m++] = col; }
    }
    for (let k = 0; k < m; k++) { run(g, G, F, R, a, b, c, list[k] - 2, P, cx, cy, cr, lw, st); seen[list[k]] = 0; }
  }
  return st;
}
// One run: the elements order[a..b) of class c (and colour col, or all).
function run(g, G, F, R, a, b, c, col, P, cx, cy, cr, lw, st) {
  const order = G.order, still = F.still;
  let n = 0;
  const end = () => {
    if (!n) return;
    if (c === 1) g.stroke(); else g.fill('nonzero');
    st.calls++;
    if (c === 3) { g.stroke(); st.calls++; }
    n = 0;
  };
  for (let q = a; q < b; q++) {
    const i = order[q];
    if (!still && F.sc[i] < 0.004) continue;
    if (col !== null && (c === 1 ? F.kc[i] : F.fc[i]) !== col) continue;
    if (n >= MERGE_MAX) end();
    if (n === 0) {
      g.beginPath();
      const w = lw * G.w[i] * (G.s[i] === -2 ? 0.8 : 1);
      if (c === 1) { g.strokeStyle = colour(R, F.kc[i]); g.lineWidth = w; }
      else { g.fillStyle = colour(R, F.fc[i]); if (c === 3) { g.strokeStyle = colour(R, F.kc[i]); g.lineWidth = w; } }
    }
    trace(g, G, i, P, cx, cy, cr); n++;
    st.pts += G.t[i] === 1 ? 1 : ringPts(G, i);
  }
  end();
}
function ringPts(G, i) { let m = 0; for (let ri = G.r0[i]; ri < G.r1[i]; ri++) m += G.rn[ri]; return m; }

// The Path2D batches of a geometry that does not move: one per group of
// motion.js drawOrder (split at MERGE_MAX), one per element of class 0.
// Each batch keeps the index of its first element: the colour comes from
// the frame (F.fc, F.kc), so a global colour cycle needs no new paths.
function buildStill(G) {
  const out = [], order = G.order, gs = G.gs;
  for (let gi = 0; gi + 1 < gs.length; gi++) {
    const a = gs[gi], b = gs[gi + 1], i0 = order[a], c = cls(G.f[i0], G.s[i0], G.t[i0]);
    let cur = null;
    for (let q = a; q < b; q++) {
      const i = order[q];
      if (c === 0 || !cur || cur.n >= MERGE_MAX) { cur = { path: new Path2D(), first: i, c, n: 0 }; out.push(cur); }
      trace(cur.path, G, i, G.pts, G.cx, G.cy, G.cr); cur.n++;
    }
  }
  return out;
}
function drawStill(g, G, F, R) {
  if (!G._still) G._still = buildStill(G);
  const lw = (R.lw || 2) * (R.lwScale || 1);
  let calls = 0;
  for (const b of G._still) {
    const i = b.first, w = lw * G.w[i] * (G.s[i] === -2 ? 0.8 : 1);
    if (b.c === 1) { g.strokeStyle = colour(R, F.kc[i]); g.lineWidth = w; g.stroke(b.path); calls++; continue; }
    if (b.c === 2 || b.c === 3) {
      g.fillStyle = colour(R, F.fc[i]); g.fill(b.path, 'nonzero'); calls++;
      if (b.c === 3) { g.strokeStyle = colour(R, F.kc[i]); g.lineWidth = w; g.stroke(b.path); calls++; }
      continue;
    }
    if (G.f[i] !== -1) { g.fillStyle = colour(R, F.fc[i]); g.fill(b.path, G.t[i] === 2 ? 'evenodd' : 'nonzero'); calls++; }
    if (G.s[i] !== -1) { g.strokeStyle = colour(R, F.kc[i]); g.lineWidth = w; g.stroke(b.path); calls++; }
  }
  return { pts: G.nP, calls };
}
