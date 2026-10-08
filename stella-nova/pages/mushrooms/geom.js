// ============================================================================
//  MUSHROOM DRAW  ·  geom.js — random source, noise, polygons, hidden lines
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. engine.js builds a specimen with
//  these helpers; render.js and svg.js use brushPoly for the ink brush.
//
//  HIDDEN LINES. hideLines() takes polylines and fill polygons that both
//  carry a painter index `ord`. A polyline is hidden where it is inside a
//  fill with a larger ord (a part drawn after it). Each segment is sampled
//  at `step` units, a bbox test comes first, and each cut point is found
//  by bisection, so the output has clean ends at the occluder edge.
//
//  GREP MAP
//    grep -n 'export function mulberry'     seeded PRNG
//    grep -n 'export function makeNoise'    2D value noise
//    grep -n 'export function makePeriodic' a smooth periodic function of an angle
//    grep -n 'export function pointInPoly'  even-odd point test
//    grep -n 'export function hideLines'    the polyline clipper
//    grep -n 'export function rdp'          polyline simplify
//    grep -n 'export function brushPoly'    a tapered ink stroke as a polygon
// ============================================================================

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const TAU = Math.PI * 2;

// mulberry32: a small seeded PRNG, uniform in [0, 1).
export function mulberry(a) {
  a >>>= 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// FNV-1a of a string.
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ── noise ───────────────────────────────────────────────────────────────────
// Value noise on an integer lattice with smooth steps, in [-1, 1].
export function makeNoise(seed) {
  const s = seed >>> 0;
  const h = (i, j) => {
    let x = (Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ s) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 2147483648 - 1;
  };
  return (x, y = 0) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
// A sum of sines with whole-number frequencies k0..k1, so f(0) = f(2 pi).
// The amplitude falls as 1/k; the result is in [-1, 1].
export function makePeriodic(rnd, k0 = 2, k1 = 7) {
  const t = [];
  let sum = 0;
  for (let k = k0; k <= k1; k++) { const a = (0.3 + rnd()) / k; t.push([k, a, rnd() * TAU]); sum += a; }
  return phi => { let v = 0; for (const [k, a, p] of t) v += a * Math.sin(k * phi + p); return v / (sum || 1); };
}
// A table of n samples of a periodic function, read with linear steps.
export function periodicTable(f, n = 256) {
  const tab = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) tab[i] = f(i / n * TAU);
  return phi => {
    let x = phi / TAU;
    x = (x - Math.floor(x)) * n;
    const i = x | 0, t = x - i;
    return tab[i] + (tab[i + 1] - tab[i]) * t;
  };
}

// ── polygons ────────────────────────────────────────────────────────────────
// poly: [[x, y], ...], closed by the last-to-first edge.
export function pointInPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][1], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (poly[j][0] - poly[i][0]) * (y - yi) / (yj - yi) + poly[i][0]) c = !c;
  }
  return c;
}
export function polyBB(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}
export function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// ── hideLines ───────────────────────────────────────────────────────────────
// lines: [{ pts, ord, ... }]; occs: [{ poly, ord }]. Returns the visible
// pieces as copies of the line objects with new pts. A point is hidden when
// it is inside an occluder with ord > line.ord.
export function hideLines(lines, occs, step = 0.6, minLen = 0.35) {
  for (const o of occs) if (!o.bb) o.bb = polyBB(o.poly);
  const out = [];
  for (const L of lines) {
    const pts = L.pts;
    if (pts.length < 2) continue;
    const bb = polyBB(pts);
    const cand = [];
    for (const o of occs) {
      if (o.ord > L.ord && o.bb.x0 <= bb.x1 && o.bb.x1 >= bb.x0 && o.bb.y0 <= bb.y1 && o.bb.y1 >= bb.y0) cand.push(o);
    }
    if (!cand.length) { out.push(L); continue; }
    const hid = (x, y) => {
      for (const o of cand) {
        const b = o.bb;
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && pointInPoly(o.poly, x, y)) return true;
      }
      return false;
    };
    let cur = null;
    const flush = () => {
      if (cur && cur.length > 1 && polyLen(cur) >= minLen) out.push(Object.assign({}, L, { pts: cur }));
      cur = null;
    };
    let px = pts[0][0], py = pts[0][1], ph = hid(px, py);
    if (!ph) cur = [[px, py]];
    for (let i = 1; i < pts.length; i++) {
      const x1 = pts[i][0], y1 = pts[i][1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - px, y1 - py) / step));
      let ax = px, ay = py, ah = ph;
      for (let k = 1; k <= n; k++) {
        const t = k / n, bx = px + (x1 - px) * t, by = py + (y1 - py) * t, bh = hid(bx, by);
        if (bh !== ah) {
          let lo = 0, hi = 1;
          for (let it = 0; it < 8; it++) {
            const m = (lo + hi) / 2;
            if (hid(ax + (bx - ax) * m, ay + (by - ay) * m) === ah) lo = m; else hi = m;
          }
          const m = ah ? hi : lo;
          const cx = ax + (bx - ax) * m, cy = ay + (by - ay) * m;
          if (ah) cur = [[cx, cy]];
          else { cur.push([cx, cy]); flush(); }
        }
        ax = bx; ay = by; ah = bh;
      }
      if (!ah) cur.push([x1, y1]);
      px = x1; py = y1; ph = ah;
    }
    flush();
  }
  return out;
}

// ── rdp ─────────────────────────────────────────────────────────────────────
// Ramer-Douglas-Peucker with an explicit stack.
export function rdp(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

// ── brushPoly ───────────────────────────────────────────────────────────────
// One ink stroke in the manner of a brush: the width swells in the middle
// and tapers at both ends, with a slow noise. xy is a flat array, a..b the
// point range; w the full width; seed varies the swell. Returns a flat
// polygon array (left side forward, right side back), or null.
export function brushPoly(xy, a, b, w, seed) {
  const n = b - a;
  if (n < 2) return null;
  const s = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const i = (a + k) * 2;
    s[k] = s[k - 1] + Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
  }
  const L = s[n - 1];
  if (L <= 0) return null;
  const r = mulberry(seed);
  const p1 = r() * TAU, p2 = r() * TAU, lean = 0.25 + r() * 0.5;
  const out = new Float64Array(n * 4);
  for (let k = 0; k < n; k++) {
    const i = (a + k) * 2;
    const i0 = (a + Math.max(0, k - 1)) * 2, i1 = (a + Math.min(n - 1, k + 1)) * 2;
    let tx = xy[i1] - xy[i0], ty = xy[i1 + 1] - xy[i0 + 1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const u = s[k] / L;
    // A fast press, a long body, a slow lift; the press point moves with lean.
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u < lean ? u / lean * 0.5 : 0.5 + (u - lean) / (1 - lean) * 0.5)), 0.55);
    const wob = 1 + 0.18 * Math.sin(s[k] / 7 + p1) + 0.1 * Math.sin(s[k] / 2.3 + p2);
    const hw = Math.max(w * 0.08, w * 0.5 * env * wob);
    out[k * 2] = xy[i] - ty * hw; out[k * 2 + 1] = xy[i + 1] + tx * hw;
    const j = (2 * n - 1 - k) * 2;
    out[j] = xy[i] + ty * hw; out[j + 1] = xy[i + 1] - tx * hw;
  }
  return out;
}
