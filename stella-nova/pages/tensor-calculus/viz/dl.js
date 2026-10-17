// ============================================================================
//  TENSOR CALCULUS  ·  viz/dl.js  ·  the display list of one frame  (VIZ)
// ----------------------------------------------------------------------------
//  A scene does not touch three.js. Each frame it writes its picture into a
//  DL (display list) with the calls below, in world units (y up). The DL
//  turns each glyph into triangles and line segments in typed arrays that
//  it keeps from frame to frame:
//      solid   lit opaque triangles      pos 3, normal 3, colour 4
//      glass   lit see-through triangles pos 3, normal 3, colour 4
//      lines   screen-space thick lines  a 3, b 3, colour 4, width px 1
//      labels  [{ p, html, c, size, key, anchor, cls }]   HTML text
//      reads   { key: value } numbers that the page can show
//  viz/index.js copies the arrays into three.js buffers. A small software
//  rasteriser (scratchpad tool, not shipped) draws the same arrays to PNG,
//  so the scene geometry is checked without a browser.
//
//  COLOUR. A colour is '#rrggbb' (sRGB, as in palette.js) or [r, g, b] in
//  sRGB 0..1. The DL turns it to linear light for the GPU.
//
//  PICK. dl.pick is the index sym that the Indices lens highlights. Each
//  call can take a sym. A glyph with sym === pick gets brighter and pulses;
//  a glyph with another sym fades to 25%; a glyph with no sym fades to 55%.
//
//  GLYPHS   (grep -n "^  <name>(" dl.js)
//      seg(a, b, c, o)          one line segment. o: { w, a, sym }
//      poly(pts, c, o)          a polyline. o.closed joins the ends
//      dashed(a, b, c, o)       a dashed segment. o.dash, o.gap (world)
//      arrow(p, v, c, o)        a vector glyph: shaft and cone, lit.
//                               o: { r, head, a, sym, glass }
//      ball(p, r, c, o)         a sphere
//      tri(p0, p1, p2, c, o)    one flat triangle
//      quad(p, u, v, c, o)      the parallelogram p +- u +- v. o.edge draws
//                               the outline; o.glass (default true)
//      box(p, h, c, o)          a box with half sizes h = [x, y, z], or axes
//                               o.axes = [u, v, w] (half edges)
//      surface(fn, nu, nv, c, o) a grid surface fn(u, v) -> [x, y, z] for
//                               u, v in 0..1; c may be fn(u, v) -> colour
//      ellipse(p, a1, a2, c, o) an ellipse in the plane of a1, a2 (semi axes)
//      ellipsoid(p, axes, c, o) axes = 3 semi-axis vectors
//      label(p, html, o)        HTML text at a world point, or at o.screen =
//                               [x, y] in 0..1 of the view (p = null)
//      read(key, value)         a readout number
// ============================================================================

const SIDES = 14;

function toLin(x) { return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
const linCache = new Map();
export function rgbOf(c) {
  if (Array.isArray(c)) return c;
  if (typeof c === 'number') return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  const s = String(c || '#ffffff');
  const h = s.length === 4 ? '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s;
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
export function linOf(c) {
  if (typeof c === 'string' && linCache.has(c)) return linCache.get(c);
  const r = rgbOf(c).map(toLin);
  if (typeof c === 'string') linCache.set(c, r);
  return r;
}
// Mix two sRGB colours (both '#rrggbb' or arrays), result in sRGB 0..1.
export function mixRGB(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

class Buf {
  constructor(stride, cap = 4096) { this.stride = stride; this.a = new Float32Array(stride * cap); this.n = 0; }
  need(k) {
    if ((this.n + k) * this.stride <= this.a.length) return;
    let cap = this.a.length * 2;
    while ((this.n + k) * this.stride > cap) cap *= 2;
    const b = new Float32Array(cap); b.set(this.a.subarray(0, this.n * this.stride)); this.a = b;
  }
}

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scl: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
};
const unit = a => { const l = V.len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function frame(d) {
  const a = Math.abs(d[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(V.cross(d, a)), w = V.cross(d, u);
  return [u, w];
}

export class DL {
  constructor() {
    this.solid = new Buf(10, 8192);
    this.glass = new Buf(10, 8192);
    this.lines = new Buf(11, 4096);
    this.labels = [];
    this.reads = {};
    this.pick = null;
    this.time = 0;
    this.fog = 0.035;          // scene fog density (world units)
    this.bg = null;             // optional [top, bottom] background colours
    this.lineScale = 1;         // phone screens draw a little thicker
  }
  reset(pick = null, time = 0) {
    this.solid.n = 0; this.glass.n = 0; this.lines.n = 0;
    this.labels = []; this.reads = {}; this.pick = pick; this.time = time;
  }
  // linear rgba for a colour, with the pick lens
  col(c, sym, a = 1) {
    let r = linOf(c);
    if (this.pick) {
      if (sym && symEq(sym, this.pick)) {
        const k = 0.25 + 0.15 * Math.sin(this.time * 5);
        r = [r[0] + (1 - r[0]) * k, r[1] + (1 - r[1]) * k, r[2] + (1 - r[2]) * k];
      } else a *= sym ? 0.22 : 0.5;
    }
    return [r[0], r[1], r[2], a];
  }
  picked(sym) { return !!(this.pick && sym && symEq(sym, this.pick)); }

  // ---- lines
  seg(a, b, c, o = {}) {
    const C = this.col(c, o.sym, o.a ?? 1);
    if (C[3] < 0.004) return;
    const L = this.lines; L.need(1);
    const w = (o.w ?? 1.6) * this.lineScale * (this.picked(o.sym) ? 1.6 : 1);
    const k = L.n * 11, A = L.a;
    A[k] = a[0]; A[k + 1] = a[1]; A[k + 2] = a[2]; A[k + 3] = b[0]; A[k + 4] = b[1]; A[k + 5] = b[2];
    A[k + 6] = C[0]; A[k + 7] = C[1]; A[k + 8] = C[2]; A[k + 9] = C[3]; A[k + 10] = w;
    L.n++;
  }
  poly(pts, c, o = {}) {
    for (let i = 1; i < pts.length; i++) this.seg(pts[i - 1], pts[i], c, o);
    if (o.closed && pts.length > 2) this.seg(pts[pts.length - 1], pts[0], c, o);
  }
  dashed(a, b, c, o = {}) {
    const d = V.sub(b, a), L = V.len(d), dash = o.dash ?? 0.08, gap = o.gap ?? 0.06;
    if (L < 1e-9) return;
    for (let s = 0; s < L; s += dash + gap) {
      const e = Math.min(L, s + dash);
      this.seg(V.add(a, V.scl(d, s / L)), V.add(a, V.scl(d, e / L)), c, o);
    }
  }

  // ---- triangles
  _vert(B, p, n, C) {
    const k = B.n * 10, A = B.a;
    A[k] = p[0]; A[k + 1] = p[1]; A[k + 2] = p[2]; A[k + 3] = n[0]; A[k + 4] = n[1]; A[k + 5] = n[2];
    A[k + 6] = C[0]; A[k + 7] = C[1]; A[k + 8] = C[2]; A[k + 9] = C[3];
    B.n++;
  }
  _tri(B, p0, p1, p2, n0, n1, n2, C) {
    B.need(3);
    this._vert(B, p0, n0, C); this._vert(B, p1, n1, C); this._vert(B, p2, n2, C);
  }
  tri(p0, p1, p2, c, o = {}) {
    const C = this.col(c, o.sym, o.a ?? 1);
    const n = unit(V.cross(V.sub(p1, p0), V.sub(p2, p0)));
    this._tri(o.glass || C[3] < 0.999 ? this.glass : this.solid, p0, p1, p2, n, n, n, C);
  }
  arrow(p, v, c, o = {}) {
    const L = V.len(v);
    const C = this.col(c, o.sym, o.a ?? 1);
    if (C[3] < 0.004) return;
    const B = o.glass || C[3] < 0.999 ? this.glass : this.solid;
    let r = (o.r ?? 0.035) * (this.picked(o.sym) ? 1.35 : 1);
    if (L < 1e-6) { this.ball(p, r * 1.4, c, o); return; }
    const d = V.scl(v, 1 / L);
    let hl = Math.min(o.head ?? r * 5.5, L * 0.45);
    const hr = Math.max(r * 2.5, hl * 0.42);
    if (L < hl * 1.1) r *= L / (hl * 1.1);
    const [u, w] = frame(d);
    const e = V.add(p, V.scl(d, L - hl)), tip = V.add(p, v);
    for (let i = 0; i < SIDES; i++) {
      const a0 = (2 * Math.PI * i) / SIDES, a1 = (2 * Math.PI * (i + 1)) / SIDES;
      const n0 = V.add(V.scl(u, Math.cos(a0)), V.scl(w, Math.sin(a0)));
      const n1 = V.add(V.scl(u, Math.cos(a1)), V.scl(w, Math.sin(a1)));
      // shaft
      const s0 = V.add(p, V.scl(n0, r)), s1 = V.add(p, V.scl(n1, r));
      const t0 = V.add(e, V.scl(n0, r)), t1 = V.add(e, V.scl(n1, r));
      this._tri(B, s0, t0, t1, n0, n0, n1, C); this._tri(B, s0, t1, s1, n0, n1, n1, C);
      // cone, normals tilted toward the tip
      const k = hr / hl;
      const m0 = unit(V.add(n0, V.scl(d, k))), m1 = unit(V.add(n1, V.scl(d, k)));
      const c0 = V.add(e, V.scl(n0, hr)), c1 = V.add(e, V.scl(n1, hr));
      this._tri(B, c0, tip, c1, m0, unit(V.add(m0, m1)), m1, C);
      // cone base
      const nb = V.scl(d, -1);
      this._tri(B, e, c1, c0, nb, nb, nb, C);
    }
  }
  ball(p, r, c, o = {}) {
    const C = this.col(c, o.sym, o.a ?? 1);
    if (C[3] < 0.004) return;
    const B = o.glass || C[3] < 0.999 ? this.glass : this.solid;
    const nu = o.nu ?? 12, nv = o.nv ?? 8;
    const P = (i, j) => {
      const th = (Math.PI * j) / nv, ph = (2 * Math.PI * i) / nu;
      return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
      const pa = V.add(p, V.scl(a, r)), pb = V.add(p, V.scl(b, r)), pc = V.add(p, V.scl(cc, r)), pd = V.add(p, V.scl(d, r));
      if (j > 0) this._tri(B, pa, pb, pc, a, b, cc, C);
      if (j < nv - 1) this._tri(B, pa, pc, pd, a, cc, d, C);
    }
  }
  quad(p, u, v, c, o = {}) {
    const C = this.col(c, o.sym, o.a ?? 0.25);
    const B = o.glass === false && C[3] >= 0.999 ? this.solid : this.glass;
    const n = unit(V.cross(u, v));
    const a = V.sub(V.sub(p, u), v), b = V.sub(V.add(p, u), v), cc = V.add(V.add(p, u), v), d = V.add(V.sub(p, u), v);
    if (C[3] >= 0.004) { this._tri(B, a, b, cc, n, n, n, C); this._tri(B, a, cc, d, n, n, n, C); }
    if (o.edge) this.poly([a, b, cc, d], o.edgeC ?? c, { w: o.edgeW ?? 1.4, a: o.edgeA ?? 0.9, sym: o.sym, closed: true });
  }
  box(p, h, c, o = {}) {
    const ax = o.axes || [[h[0], 0, 0], [0, h[1], 0], [0, 0, h[2]]];
    const C = this.col(c, o.sym, o.a ?? 1);
    if (C[3] < 0.004) return;
    const B = o.glass || C[3] < 0.999 ? this.glass : this.solid;
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
      const n = V.scl(ax[k], s), u = ax[(k + 1) % 3], v = ax[(k + 2) % 3];
      const cc = V.add(p, n), nn = unit(n);
      const q = [V.sub(V.sub(cc, u), v), V.sub(V.add(cc, u), v), V.add(V.add(cc, u), v), V.add(V.sub(cc, u), v)];
      if (s > 0) { this._tri(B, q[0], q[1], q[2], nn, nn, nn, C); this._tri(B, q[0], q[2], q[3], nn, nn, nn, C); }
      else { this._tri(B, q[0], q[2], q[1], nn, nn, nn, C); this._tri(B, q[0], q[3], q[2], nn, nn, nn, C); }
    }
    if (o.edge) {
      const E = o.edgeC ?? c, eo = { w: o.edgeW ?? 1.2, a: o.edgeA ?? 0.8, sym: o.sym };
      for (let k = 0; k < 3; k++) {
        const u = ax[(k + 1) % 3], v = ax[(k + 2) % 3];
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const q = V.add(V.add(p, V.scl(u, su)), V.scl(v, sv));
          this.seg(V.sub(q, ax[k]), V.add(q, ax[k]), E, eo);
        }
      }
    }
  }
  // fn(u, v) -> [x, y, z]; c a colour or fn(u, v) -> colour (sRGB);
  // o: { a, sym, glass, closeU, wire: { nu, nv, c, w, a } }
  surface(fn, nu, nv, c, o = {}) {
    const P = new Array((nu + 1) * (nv + 1));
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P[j * (nu + 1) + i] = fn(i / nu, j / nv);
    const N = new Array(P.length);
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(nu, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nv, j + 1);
      let du = V.sub(P[j * (nu + 1) + i1], P[j * (nu + 1) + i0]);
      if (o.closeU && (i === 0 || i === nu)) du = V.sub(P[j * (nu + 1) + 1], P[j * (nu + 1) + nu - 1]);
      const dv = V.sub(P[j1 * (nu + 1) + i], P[j0 * (nu + 1) + i]);
      let n = V.cross(dv, du);
      if (V.len(n) < 1e-12) n = o.flipN ? [0, -1, 0] : [0, 1, 0];
      N[j * (nu + 1) + i] = o.flipN ? V.scl(unit(n), -1) : unit(n);
    }
    const fixed = typeof c !== 'function' ? this.col(c, o.sym, o.a ?? 1) : null;
    const glass = o.glass || (fixed ? fixed[3] < 0.999 : (o.a ?? 1) < 0.999);
    const B = glass ? this.glass : this.solid;
    const CC = new Array(P.length);
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) CC[j * (nu + 1) + i] = fixed || this.col(c(i / nu, j / nv), o.sym, o.a ?? 1);
    if (!(fixed && fixed[3] < 0.004)) {
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + 1, cc = a + nu + 2, d = a + nu + 1;
        B.need(6);
        this._vert(B, P[a], N[a], CC[a]); this._vert(B, P[b], N[b], CC[b]); this._vert(B, P[cc], N[cc], CC[cc]);
        this._vert(B, P[a], N[a], CC[a]); this._vert(B, P[cc], N[cc], CC[cc]); this._vert(B, P[d], N[d], CC[d]);
      }
    }
    if (o.wire) {
      const W = o.wire, wc = W.c ?? '#ffffff', wo = { w: W.w ?? 1, a: W.a ?? 0.25, sym: o.sym };
      const su = Math.max(1, Math.round(nu / (W.nu ?? 12))), sv = Math.max(1, Math.round(nv / (W.nv ?? 12)));
      const lift = W.lift ?? 0;
      const LP = k => lift ? V.add(P[k], V.scl(N[k], lift)) : P[k];
      for (let j = 0; j <= nv; j += sv) for (let i = 0; i < nu; i++) this.seg(LP(j * (nu + 1) + i), LP(j * (nu + 1) + i + 1), wc, wo);
      for (let i = 0; i <= nu; i += su) for (let j = 0; j < nv; j++) this.seg(LP(j * (nu + 1) + i), LP((j + 1) * (nu + 1) + i), wc, wo);
    }
    return { P, N };
  }
  ellipse(p, a1, a2, c, o = {}) {
    const n = o.seg ?? 48, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (2 * Math.PI * i) / n;
      pts.push(V.add(p, V.add(V.scl(a1, Math.cos(t)), V.scl(a2, Math.sin(t)))));
    }
    if (o.fill !== false) {
      const C = this.col(c, o.sym, o.fa ?? 0.22);
      const nn = unit(V.cross(a1, a2));
      if (C[3] >= 0.004) for (let i = 0; i < n; i++) this._tri(this.glass, p, pts[i], pts[i + 1], nn, nn, nn, C);
    }
    if (o.edge !== false) this.poly(pts, o.edgeC ?? c, { w: o.w ?? 1.5, a: o.a ?? 0.95, sym: o.sym });
    return pts;
  }
  ellipsoid(p, axes, c, o = {}) {
    const [A, B, C] = axes;
    return this.surface((u, v) => {
      const th = Math.PI * v, ph = 2 * Math.PI * u;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      return [p[0] + A[0] * x + B[0] * y + C[0] * z, p[1] + A[1] * x + B[1] * y + C[1] * z, p[2] + A[2] * x + B[2] * y + C[2] * z];
    }, o.nu ?? 40, o.nv ?? 24, c, { ...o, closeU: true, flipN: mixedSign(A, B, C) });
  }
  label(p, html, o = {}) {
    let a = 1;
    if (this.pick) a = o.sym && symEq(o.sym, this.pick) ? 1 : o.sym ? 0.3 : 0.6;
    this.labels.push({ p, html, c: o.c ?? null, size: o.size ?? 15, key: o.key ?? html, anchor: o.anchor ?? 'c', a: a * (o.a ?? 1), cls: o.cls ?? '', hi: this.picked(o.sym), screen: o.screen ?? null });
  }
  read(key, value) { this.reads[key] = value; }
}

function mixedSign(A, B, C) {
  // the surface normal points out when (A, B, C) has the orientation
  // that the parametrisation assumes; a left-handed frame flips it
  const d = A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0]);
  return d > 0;
}
// '\\mu', 'mu' and "mu'" name the same index
export function symEq(a, b) {
  const n = s => String(s).replace(/^\\+/, '').replace(/[{}\s]/g, '').replace(/['′]+$/, '');
  return n(a) === n(b);
}
