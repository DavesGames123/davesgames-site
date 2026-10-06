// ============================================================================
//  PATTERN DESIGNER  ·  engine.js — the pattern core (no DOM)
// ----------------------------------------------------------------------------
//  Every pattern is a pure function gen(P, ctx). P holds the slider values.
//  ctx holds the artboard size, a seeded random source, a seeded noise and
//  an output list (Out). The same id, params, seed and size always give the
//  same list. The page, the worker, the tests and the saver call run().
//
//  DESIGN SPACE. The short side of the artboard is always UNIT (1000)
//  units. A 4:5 board is 1000 x 1250, an A4 portrait board 1000 x 1414.21.
//  The SVG export maps this space to real units (mm for A sizes) with the
//  viewBox, so a pattern is the same at every print size.
//
//  ELEMENTS. Out holds plain objects (structured-clone safe):
//    { t:'poly',   p:[x0,y0,x1,y1,..], c:0|1, f, s, w, sm }
//    { t:'multi',  rr:[[..],[..]], f, s, w, sm }   closed rings, even-odd
//    { t:'circle', x, y, r, f, s, w }
//  f and s are palette slots (0..4) or -1 for none. The page maps slot k
//  to ink k mod (number of inks), so the palette can change with no new
//  run. w multiplies the line weight. c: the ring is closed. sm: draw the
//  points as a Catmull-Rom curve, not as straight segments.
//
//  CAPS. Out stops at CAP.nodes elements and CAP.points points, and sets
//  capped. Heavy patterns run in worker.js.
//
//  grep -n targets
//    random source ........ "function makeRng"
//    noise ................ "function makeNoise"
//    output list .......... "class Out"
//    run one pattern ...... "export function run"
//    contours ............. "export function contours"
//    poisson disc ......... "export function poisson"
//    geometry helpers ..... "GEOMETRY"
// ============================================================================
export const UNIT = 1000;
export const CAP = { nodes: 24000, points: 600000 };
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ── random ─────────────────────────────────────────────────────────────────
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// One random source. next() is in [0, 1).
export function makeRng(seed, salt = '') {
  const next = mulberry32((hashStr(String(salt)) ^ Math.imul((seed >>> 0) + 0x9E3779B9, 0x85EBCA6B)) >>> 0);
  const r = {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),     // a..b inclusive
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    sign: () => next() < 0.5 ? -1 : 1,
    gauss: () => { let u = 0, v = 0; while (u === 0) u = next(); v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); },
    // A weighted pick: w is a list of weights.
    weighted: w => { let s = 0; for (const x of w) s += x; let q = next() * s; for (let i = 0; i < w.length; i++) { q -= w[i]; if (q < 0) return i; } return w.length - 1; },
    shuffle: arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
  };
  return r;
}

// ── noise ──────────────────────────────────────────────────────────────────
// 2D simplex noise with a seeded permutation. n2 is in about [-1, 1].
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function makeNoise(rnd) {
  const perm = new Uint8Array(512), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1), Gk = (3 - Math.sqrt(3)) / 6;
  function n2(x, y) {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * Gk;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + Gk, y1 = y0 - j1 + Gk, x2 = x0 - 1 + 2 * Gk, y2 = y0 - 1 + 2 * Gk;
    const ii = i & 255, jj = j & 255;
    let n = 0, q;
    q = 0.5 - x0 * x0 - y0 * y0; if (q > 0) { const g = G2[perm[ii + perm[jj]] & 7]; q *= q; n += q * q * (g[0] * x0 + g[1] * y0); }
    q = 0.5 - x1 * x1 - y1 * y1; if (q > 0) { const g = G2[perm[ii + i1 + perm[jj + j1]] & 7]; q *= q; n += q * q * (g[0] * x1 + g[1] * y1); }
    q = 0.5 - x2 * x2 - y2 * y2; if (q > 0) { const g = G2[perm[ii + 1 + perm[jj + 1]] & 7]; q *= q; n += q * q * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  }
  function fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, m = 0;
    for (let o = 0; o < oct; o++) { s += a * n2(x * f + o * 17.3, y * f - o * 9.1); m += a; a *= gain; f *= lac; }
    return s / m;
  }
  // The curl of the fbm field: a flow with no sources and no sinks.
  function curl(x, y, oct = 2, e = 0.01) {
    const dx = (fbm(x + e, y, oct) - fbm(x - e, y, oct)) / (2 * e);
    const dy = (fbm(x, y + e, oct) - fbm(x, y - e, oct)) / (2 * e);
    return [dy, -dx];
  }
  return { n2, fbm, curl };
}

// ── output list ────────────────────────────────────────────────────────────
// opts: { f, s, w, sm } (fill slot, stroke slot, weight, smooth).
export class Out {
  constructor(cap = CAP) { this.items = []; this.points = 0; this.capped = false; this.cap = cap; }
  full() { return this.capped; }
  _add(el, n) {
    if (this.items.length >= this.cap.nodes || this.points + n > this.cap.points) { this.capped = true; return false; }
    for (const k in el) if (typeof el[k] === 'number' && !Number.isFinite(el[k])) return false;
    this.items.push(el); this.points += n; return true;
  }
  // pts: a flat list. closed: the last point joins the first.
  poly(pts, closed = false, o = {}) {
    if (!pts || pts.length < 4) return false;
    for (let i = 0; i < pts.length; i++) if (!Number.isFinite(pts[i])) return false;
    const el = { t: 'poly', p: pts.map(rd), c: closed ? 1 : 0, f: o.f ?? (closed ? 0 : -1), s: o.s ?? (closed ? -1 : 0), w: o.w ?? 1 };
    if (o.sm) el.sm = 1;
    return this._add(el, pts.length / 2);
  }
  line(x1, y1, x2, y2, o = {}) { return this.poly([x1, y1, x2, y2], false, o); }
  rect(x, y, w, h, o = {}) { return this.poly([x, y, x + w, y, x + w, y + h, x, y + h], true, o); }
  circle(x, y, r, o = {}) {
    if (!(r > 0.05)) return false;
    return this._add({ t: 'circle', x: rd(x), y: rd(y), r: rd(r), f: o.f ?? 0, s: o.s ?? -1, w: o.w ?? 1 }, 1);
  }
  // rings: a list of flat closed rings, filled with the even-odd rule.
  multi(rings, o = {}) {
    const rr = rings.filter(r => r.length >= 6 && r.every(Number.isFinite)).map(r => r.map(rd));
    if (!rr.length) return false;
    const el = { t: 'multi', rr, f: o.f ?? 0, s: o.s ?? -1, w: o.w ?? 1 };
    if (o.sm) el.sm = 1;
    return this._add(el, rr.reduce((a, r) => a + r.length / 2, 0));
  }
  // A regular polygon or star: n corners, rot in radians, inner radius ratio k.
  ngon(x, y, r, n, rot = 0, o = {}, k = 1) {
    const pts = [], m = k === 1 ? n : 2 * n;
    for (let i = 0; i < m; i++) { const a = rot + TAU * i / m, q = (k !== 1 && i % 2) ? r * k : r; pts.push(x + q * Math.cos(a), y + q * Math.sin(a)); }
    return this.poly(pts, true, o);
  }
}
// Two decimals is 0.01 unit: 0.002 mm on an A4 sheet.
function rd(v) { return Math.round(v * 100) / 100; }

// ── params ─────────────────────────────────────────────────────────────────
// A pattern lists params as { key: [min, max, step, default, label] }.
export function defaults(pat) {
  const P = {};
  for (const k in pat.params) P[k] = pat.params[k][3];
  return P;
}
export function clampParams(pat, P) {
  const Q = {};
  for (const k in pat.params) {
    const [a, b, st, d] = pat.params[k];
    let v = P && P[k] != null && Number.isFinite(+P[k]) ? +P[k] : d;
    v = clamp(v, a, b); if (st >= 1) v = Math.round(v);
    Q[k] = v;
  }
  return Q;
}
// The board size in design units for an aspect ratio w / h.
export function boardSize(aspect) {
  return aspect >= 1 ? { W: rd(UNIT * aspect), H: UNIT } : { W: UNIT, H: rd(UNIT / aspect) };
}

// Run one pattern. Returns { items, capped, points, ms }.
export function run(pat, P, seed, W, H, cap = CAP) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const rng = makeRng(seed, pat.id), out = new Out(cap);
  const ctx = { W, H, S: Math.min(W, H), cx: W / 2, cy: H / 2, rng, rnd: rng.next, noise: makeNoise(makeRng(seed, pat.id + '/noise').next), out };
  pat.gen(clampParams(pat, P), ctx);
  return { items: out.items, capped: out.capped, points: out.points, ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0 };
}

// ── GEOMETRY ───────────────────────────────────────────────────────────────
// Iso lines of a scalar grid. field: Float32Array of gw * gh values, row
// major. Returns rings and open lines in grid coordinates (0..gw-1).
// A cell edge is cut where the value crosses level. A field padded with a
// low border gives closed rings only.
export function contours(field, gw, gh, level) {
  const segs = new Map(), key = (x, y) => Math.round(x * 4096) + ',' + Math.round(y * 4096);
  const pts = [];
  const at = (i, j) => field[j * gw + i];
  const cut = (x0, y0, v0, x1, y1, v1) => { const t = (level - v0) / (v1 - v0); return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]; };
  const link = (a, b) => {
    const ka = key(a[0], a[1]), kb = key(b[0], b[1]);
    pts.push([ka, kb, a, b]);
  };
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = () => cut(i, j, a, i + 1, j, b), R = () => cut(i + 1, j, b, i + 1, j + 1, c);
    const B = () => cut(i, j + 1, d, i + 1, j + 1, c), L = () => cut(i, j, a, i, j + 1, d);
    switch (idx) {
      case 1: case 14: link(L(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(T(), R()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), T()); break;
      case 5: { const m = (a + b + c + d) / 4; if (m > level) { link(L(), T()); link(B(), R()); } else { link(L(), B()); link(T(), R()); } break; }
      case 10: { const m = (a + b + c + d) / 4; if (m > level) { link(T(), R()); link(L(), B()); } else { link(L(), T()); link(B(), R()); } break; }
    }
  }
  // Join the segments end to end.
  const adj = new Map();
  pts.forEach((s, n) => { for (const k of [s[0], s[1]]) { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(n); } });
  const used = new Uint8Array(pts.length), rings = [], lines = [];
  for (let n = 0; n < pts.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const chain = [pts[n][2], pts[n][3]];
    let headK = pts[n][0], tailK = pts[n][1];
    const grow = (endK, atEnd) => {
      for (;;) {
        const cand = (adj.get(endK) || []).find(m => !used[m]);
        if (cand == null) return endK;
        used[cand] = 1;
        const s = pts[cand], fwd = s[0] === endK, nk = fwd ? s[1] : s[0], np = fwd ? s[3] : s[2];
        if (atEnd) chain.push(np); else chain.unshift(np);
        endK = nk;
      }
    };
    tailK = grow(tailK, true);
    headK = grow(headK, false);
    const flat = []; for (const q of chain) flat.push(q[0], q[1]);
    if (headK === tailK && chain.length > 3) { flat.length -= 2; rings.push(flat); } else lines.push(flat);
  }
  return { rings, lines };
}
// Bridson poisson disc sampling with a radius field rFn(x, y) (min radius
// rMin sets the grid). Returns a flat list of points.
export function poisson(W, H, rFn, rMin, rnd, max = 20000, tries = 18) {
  const cs = rMin / Math.SQRT2, gw = Math.ceil(W / cs), gh = Math.ceil(H / cs);
  const grid = new Int32Array(gw * gh).fill(-1), P = [], act = [];
  const add = (x, y) => { const i = P.length / 2; P.push(x, y); act.push(i); grid[Math.floor(y / cs) * gw + Math.floor(x / cs)] = i; };
  add(rnd() * W, rnd() * H);
  while (act.length && P.length / 2 < max) {
    const ai = Math.floor(rnd() * act.length), i = act[ai], px = P[2 * i], py = P[2 * i + 1], r = rFn(px, py);
    let ok = false;
    for (let t = 0; t < tries; t++) {
      const a = rnd() * TAU, d = r * (1 + rnd()), x = px + d * Math.cos(a), y = py + d * Math.sin(a);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const rx = Math.max(r, rFn(x, y)), gi = Math.floor(x / cs), gj = Math.floor(y / cs), reach = Math.ceil(rx / cs) + 1;
      let far = true;
      for (let v = Math.max(0, gj - reach); v <= Math.min(gh - 1, gj + reach) && far; v++)
        for (let u = Math.max(0, gi - reach); u <= Math.min(gw - 1, gi + reach); u++) {
          const k = grid[v * gw + u]; if (k < 0) continue;
          const dx = P[2 * k] - x, dy = P[2 * k + 1] - y;
          if (dx * dx + dy * dy < rx * rx) { far = false; break; }
        }
      if (far) { add(x, y); ok = true; break; }
    }
    if (!ok) { act[ai] = act[act.length - 1]; act.pop(); }
  }
  return P;
}
// Chaikin corner cutting, n rounds. closed: the ring wraps.
export function chaikin(p, n = 2, closed = true) {
  let a = p;
  for (let k = 0; k < n; k++) {
    const b = [], m = a.length / 2, last = closed ? m : m - 1;
    if (!closed) b.push(a[0], a[1]);
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % m, x0 = a[2 * i], y0 = a[2 * i + 1], x1 = a[2 * j], y1 = a[2 * j + 1];
      b.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    if (!closed) b.push(a[2 * m - 2], a[2 * m - 1]);
    a = b;
  }
  return a;
}
// Keep the part of a convex or concave ring on the side a*x + b*y <= c.
export function clipHalf(p, a, b, c) {
  const out = [], m = p.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m, x0 = p[2 * i], y0 = p[2 * i + 1], x1 = p[2 * j], y1 = p[2 * j + 1];
    const d0 = a * x0 + b * y0 - c, d1 = a * x1 + b * y1 - c;
    if (d0 <= 0) out.push(x0, y0);
    if ((d0 <= 0) !== (d1 <= 0)) { const t = d0 / (d0 - d1); out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); }
  }
  return out;
}
export function ringArea(p) {
  let s = 0; const m = p.length / 2;
  for (let i = 0; i < m; i++) { const j = (i + 1) % m; s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
  return s / 2;
}
export function centroid(p) {
  let x = 0, y = 0; const m = p.length / 2;
  for (let i = 0; i < m; i++) { x += p[2 * i]; y += p[2 * i + 1]; }
  return [x / m, y / m];
}
// Move each point of a ring toward (or away from) its centroid by d units.
export function inset(p, d) {
  const [cx, cy] = centroid(p), out = [];
  for (let i = 0; i < p.length; i += 2) {
    const dx = p[i] - cx, dy = p[i + 1] - cy, L = Math.hypot(dx, dy) || 1, k = Math.max(0, L - d) / L;
    out.push(cx + dx * k, cy + dy * k);
  }
  return out;
}
// Points every step units along a polyline (the ends kept).
export function resample(p, step, closed = false) {
  const q = closed ? p.concat([p[0], p[1]]) : p, out = [q[0], q[1]];
  for (let i = 2; i < q.length; i += 2) {
    const x0 = q[i - 2], y0 = q[i - 1], x1 = q[i], y1 = q[i + 1], L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n);
  }
  if (closed) out.length -= 2;
  return out;
}
export function polyLength(p, closed = false) {
  let L = 0; const m = p.length / 2;
  for (let i = 1; i < m; i++) L += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
  if (closed && m > 1) L += Math.hypot(p[0] - p[2 * m - 2], p[1] - p[2 * m - 1]);
  return L;
}
// A soft scalar "tone" field in [0, 1] over the board: the shared source
// for halftone and stipple patterns. kind 0 radial glow, 1 linear ramp,
// 2 noise blobs, 3 rings, 4 two soft spheres.
export function toneField(kind, ctx, scale = 1) {
  const { W, H, S, noise } = ctx;
  const r = ctx.rng, ox = r.range(-0.2, 0.2) * W, oy = r.range(-0.2, 0.2) * H, ang = r.range(0, TAU);
  const b1 = [r.range(0.25, 0.75) * W, r.range(0.25, 0.6) * H, r.range(0.22, 0.38) * S];
  const b2 = [r.range(0.25, 0.75) * W, r.range(0.45, 0.8) * H, r.range(0.12, 0.26) * S];
  return (x, y) => {
    switch (kind) {
      case 0: return smooth01(1 - Math.hypot(x - W / 2 - ox, y - H / 2 - oy) / (0.62 * Math.max(W, H)));
      case 1: return smooth01(0.5 + ((x - W / 2) * Math.cos(ang) + (y - H / 2) * Math.sin(ang)) / Math.hypot(W, H));
      case 2: return smooth01(0.5 + 0.9 * noise.fbm(x / (S * 0.45 * scale), y / (S * 0.45 * scale), 3));
      case 3: return 0.5 + 0.5 * Math.cos(Math.hypot(x - W / 2, y - H / 2) / (S * 0.06 * scale));
      default: {
        const s1 = sphere(x, y, b1), s2 = sphere(x, y, b2);
        return Math.max(s1, s2);
      }
    }
  };
}
// A lit sphere: 0 outside, 1 at the highlight.
function sphere(x, y, [cx, cy, R]) {
  const dx = (x - cx) / R, dy = (y - cy) / R, d2 = dx * dx + dy * dy;
  if (d2 > 1) return 0;
  const z = Math.sqrt(1 - d2), l = clamp(-0.45 * dx - 0.55 * dy + 0.7 * z, 0, 1);
  return 0.15 + 0.85 * l;
}
