// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/raster2d.js — a canvas 2D subset in JS
// ----------------------------------------------------------------------------
//  Raster2D draws the calls that pattern-designer/export.js drawItems
//  makes (paths of lines, Bezier curves and arcs; fill with the nonzero
//  or even-odd rule; stroke with round joins and caps; fillRect; save,
//  restore, setTransform, scale; globalAlpha; '#rrggbb' colours). It
//  needs no DOM, so the pattern tiles draw the same in node, in a worker
//  and on a page, and the tests can check them.
//
//  FILL. Each pixel row has 4 sub-rows. On a sub-row the pass finds the
//  edge crossings, keeps the spans that the rule marks as inside, and
//  adds the span length in each pixel to a coverage buffer. The colour
//  goes on with alpha = coverage * globalAlpha.
//
//  STROKE. Each segment becomes a quad of the line width, and each point
//  a disc (round joins and caps). Each part is convex, so it has one span
//  per sub-row. The stroke coverage is the largest part coverage at each
//  pixel (the union), and the colour goes on once.
//
//  Not drawn: clip (clip() is a no-op), gradients, dashes, text, images.
//
//  grep -n targets: "export class Raster2D", "_fillPolys", "_strokePolys",
//                   "function flattenBezier"
// ============================================================================
const SUB = 4;

function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0];
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(Number); return [p[0] | 0, p[1] | 0, p[2] | 0]; }
  return [0, 0, 0];
}

function flattenBezier(out, x0, y0, x1, y1, x2, y2, x3, y3, tol) {
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
  const n = Math.max(2, Math.min(64, Math.ceil(len / tol)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
             u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
}

export class Raster2D {
  constructor(w, h) {
    this.width = w; this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
    this.cov = new Float32Array(w);
    this._st = [];
    this.m = [1, 0, 0, 1, 0, 0];
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.globalAlpha = 1;
    this.lineCap = 'round'; this.lineJoin = 'round';
    this.beginPath();
  }
  // ── state ──
  save() { this._st.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha }); }
  restore() { const s = this._st.pop(); if (s) Object.assign(this, s); }
  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
  resetTransform() { this.m = [1, 0, 0, 1, 0, 0]; }
  scale(x, y) { const m = this.m; this.m = [m[0] * x, m[1] * x, m[2] * y, m[3] * y, m[4], m[5]]; }
  translate(x, y) { const m = this.m; this.m = [m[0], m[1], m[2], m[3], m[4] + m[0] * x + m[2] * y, m[5] + m[1] * x + m[3] * y]; }
  clip() {}
  // ── path (points are stored in device space) ──
  _tx(x, y) { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  _scale() { const m = this.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }
  beginPath() { this.subs = []; this.cur = null; }
  moveTo(x, y) { const p = this._tx(x, y); this.cur = { p: [p[0], p[1]], c: false }; this.subs.push(this.cur); }
  lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); const p = this._tx(x, y); this.cur.p.push(p[0], p[1]); }
  closePath() { if (this.cur) { this.cur.c = true; const p = this.cur.p; this.cur = { p: [p[0], p[1]], c: false }; this.subs.push(this.cur); } }
  bezierCurveTo(x1, y1, x2, y2, x, y) {
    if (!this.cur) this.moveTo(x1, y1);
    const p = this.cur.p, a = this._tx(x1, y1), b = this._tx(x2, y2), c = this._tx(x, y);
    flattenBezier(p, p[p.length - 2], p[p.length - 1], a[0], a[1], b[0], b[1], c[0], c[1], 1.5);
  }
  quadraticCurveTo(x1, y1, x, y) {
    if (!this.cur) this.moveTo(x1, y1);
    const p = this.cur.p, x0 = p[p.length - 2], y0 = p[p.length - 1], a = this._tx(x1, y1), c = this._tx(x, y);
    flattenBezier(p, x0, y0, x0 + 2 / 3 * (a[0] - x0), y0 + 2 / 3 * (a[1] - y0), c[0] + 2 / 3 * (a[0] - c[0]), c[1] + 2 / 3 * (a[1] - c[1]), c[0], c[1], 1.5);
  }
  arc(cx, cy, r, a0, a1, ccw = false) {
    let span = a1 - a0;
    if (!ccw && span < 0) span = span % (2 * Math.PI) + 2 * Math.PI;
    if (ccw && span > 0) span = span % (2 * Math.PI) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) span = ccw ? -2 * Math.PI : 2 * Math.PI;
    const rr = r * this._scale(), n = Math.max(8, Math.min(256, Math.ceil(Math.abs(span) * Math.sqrt(Math.max(rr, 0.5)) * 1.6)));
    for (let i = 0; i <= n; i++) {
      const a = a0 + span * i / n, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0 && !this.cur) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  // ── paint ──
  fillRect(x, y, w, h) { const saved = this.subs; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.subs = saved; }
  clearRect(x, y, w, h) { const f = this.fillStyle, a = this.globalAlpha; this.fillStyle = '#ffffff'; this.globalAlpha = 1; this.fillRect(x, y, w, h); this.fillStyle = f; this.globalAlpha = a; }
  fill(rule = 'nonzero') {
    const polys = this.subs.filter(s => s.p.length >= 6).map(s => s.p);
    this._fillPolys(polys, rule === 'evenodd', parseColor(this.fillStyle));
  }
  stroke() {
    const lw = Math.max(0.35, this.lineWidth * this._scale());
    this._strokePolys(this.subs, lw, parseColor(this.strokeStyle));
  }
  _strokePolys(subs, lw, rgb) {
    const r = lw / 2, polys = [];
    const disc = (x, y) => {
      const n = Math.max(6, Math.min(32, Math.ceil(r * 2.5))), p = [];
      for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; p.push(x + r * Math.cos(a), y + r * Math.sin(a)); }
      polys.push(p);
    };
    for (const s of subs) {
      const p = s.p.slice();
      if (s.c && p.length >= 4) p.push(p[0], p[1]);
      const m = p.length / 2;
      if (m === 1) { disc(p[0], p[1]); continue; }
      for (let i = 0; i < m - 1; i++) {
        const x0 = p[2 * i], y0 = p[2 * i + 1], x1 = p[2 * i + 2], y1 = p[2 * i + 3];
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        const nx = -dy / L * r, ny = dx / L * r;
        polys.push([x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny, x0 + nx, y0 + ny]);
      }
      if (lw > 1.2) for (let i = 0; i < m; i++) disc(p[2 * i], p[2 * i + 1]);
    }
    this._unionConvex(polys, rgb);
  }
  // Each part is convex: one span per sub-row. The coverage of the union
  // is the largest coverage of any part at the pixel (exact inside, a
  // close value on the edges), then the colour goes on once.
  _unionConvex(polys, rgb) {
    const W = this.width, H = this.height;
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
    for (const p of polys) for (let i = 0; i < p.length; i += 2) {
      if (p[i] < X0) X0 = p[i]; if (p[i] > X1) X1 = p[i]; if (p[i + 1] < Y0) Y0 = p[i + 1]; if (p[i + 1] > Y1) Y1 = p[i + 1];
    }
    const xs = Math.max(0, Math.floor(X0)), xe = Math.min(W - 1, Math.ceil(X1)), ys = Math.max(0, Math.floor(Y0)), ye = Math.min(H - 1, Math.ceil(Y1));
    if (xs > xe || ys > ye) return;
    const bw = xe - xs + 1, mask = new Float32Array(bw * (ye - ys + 1)), row = new Float32Array(bw);
    for (const p of polys) {
      const m = p.length / 2;
      let py0 = Infinity, py1 = -Infinity, px0 = Infinity, px1 = -Infinity;
      for (let i = 0; i < m; i++) { const y = p[2 * i + 1], x = p[2 * i]; if (y < py0) py0 = y; if (y > py1) py1 = y; if (x < px0) px0 = x; if (x > px1) px1 = x; }
      const ry0 = Math.max(ys, Math.floor(py0)), ry1 = Math.min(ye, Math.ceil(py1));
      const cx0 = Math.max(xs, Math.floor(px0)) - xs, cx1 = Math.min(xe, Math.ceil(px1)) - xs;
      for (let y = ry0; y <= ry1; y++) {
        row.fill(0, cx0, cx1 + 1);
        let any = false;
        for (let k = 0; k < SUB; k++) {
          const sy = y + (k + 0.5) / SUB;
          let lo = Infinity, hi = -Infinity;
          for (let i = 0; i < m; i++) {
            const j = (i + 1) % m, ay = p[2 * i + 1], by = p[2 * j + 1];
            if ((sy < ay) === (sy < by)) continue;
            const x = p[2 * i] + (sy - ay) * (p[2 * j] - p[2 * i]) / (by - ay);
            if (x < lo) lo = x; if (x > hi) hi = x;
          }
          if (!(hi > lo)) continue;
          const a = Math.max(xs, lo) - xs, b = Math.min(xe + 1, hi) - xs;
          if (b <= a) continue;
          any = true;
          const ia = Math.floor(a), ib = Math.floor(b);
          if (ia === ib) { row[ia] += (b - a) / SUB; continue; }
          row[ia] += (ia + 1 - a) / SUB;
          for (let x = ia + 1; x < ib; x++) row[x] += 1 / SUB;
          if (ib < bw) row[ib] += (b - ib) / SUB;
        }
        if (!any) continue;
        const o = (y - ys) * bw;
        for (let x = cx0; x <= cx1; x++) if (row[x] > mask[o + x]) mask[o + x] = row[x];
      }
    }
    const ga = this.globalAlpha, d = this.data;
    for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
      let a = mask[(y - ys) * bw + x - xs]; if (a <= 0) continue;
      a = Math.min(1, a) * ga;
      const i = 4 * (y * W + x);
      d[i] += (rgb[0] - d[i]) * a; d[i + 1] += (rgb[1] - d[i + 1]) * a; d[i + 2] += (rgb[2] - d[i + 2]) * a;
    }
  }
  _fillPolys(polys, evenodd, rgb) {
    if (!polys.length) return;
    const W = this.width, H = this.height;
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    const edges = [];
    for (const p of polys) {
      const m = p.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m, ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
        if (ay === by) continue;
        const up = ay < by;
        edges.push(up ? ay : by, up ? by : ay, up ? ax : bx, (bx - ax) / (by - ay), up ? 1 : -1);
        if (ay < y0) y0 = ay; if (ay > y1) y1 = ay; if (ax < x0) x0 = ax; if (ax > x1) x1 = ax;
      }
    }
    const ys = Math.max(0, Math.floor(y0)), ye = Math.min(H - 1, Math.ceil(y1));
    const xs = Math.max(0, Math.floor(x0)), xe = Math.min(W - 1, Math.ceil(x1));
    if (ys > ye || xs > xe) return;
    const nE = edges.length / 5, cov = this.cov, xsArr = [], ga = this.globalAlpha, d = this.data;
    // Bucket the edges by their first pixel row; keep an active list.
    const buckets = new Map();
    for (let e = 0; e < nE; e++) {
      const r = Math.max(ys, Math.floor(edges[5 * e]));
      if (r > ye) continue;
      let b = buckets.get(r); if (!b) buckets.set(r, b = []); b.push(e);
    }
    let active = [];
    for (let y = ys; y <= ye; y++) {
      const add = buckets.get(y); if (add) active = active.concat(add);
      if (active.length) active = active.filter(e => edges[5 * e + 1] > y);
      if (!active.length) continue;
      cov.fill(0, xs, xe + 1);
      let any = false;
      for (let k = 0; k < SUB; k++) {
        const sy = y + (k + 0.5) / SUB;
        xsArr.length = 0;
        for (let q = 0; q < active.length; q++) {
          const b = 5 * active[q];
          if (sy < edges[b] || sy >= edges[b + 1]) continue;
          xsArr.push(edges[b + 2] + (sy - edges[b]) * edges[b + 3], edges[b + 4]);
        }
        if (xsArr.length < 4) continue;
        const idx = []; for (let i = 0; i < xsArr.length; i += 2) idx.push(i);
        idx.sort((a, b) => xsArr[a] - xsArr[b]);
        let wind = 0;
        for (let q = 0; q < idx.length - 1; q++) {
          wind += evenodd ? 1 : xsArr[idx[q] + 1];
          const inside = evenodd ? (wind & 1) === 1 : wind !== 0;
          if (!inside) continue;
          let a = Math.max(xs, xsArr[idx[q]]), b = Math.min(xe + 1, xsArr[idx[q + 1]]);
          if (b <= a) continue;
          any = true;
          const ia = Math.floor(a), ib = Math.floor(b);
          if (ia === ib) { cov[ia] += (b - a) / SUB; continue; }
          cov[ia] += (ia + 1 - a) / SUB;
          for (let x = ia + 1; x < ib; x++) cov[x] += 1 / SUB;
          if (ib <= xe) cov[ib] += (b - ib) / SUB;
        }
      }
      if (!any) continue;
      for (let x = xs; x <= xe; x++) {
        let a = cov[x]; if (a <= 0) continue;
        a = Math.min(1, a) * ga;
        const i = 4 * (y * W + x);
        d[i] += (rgb[0] - d[i]) * a; d[i + 1] += (rgb[1] - d[i + 1]) * a; d[i + 2] += (rgb[2] - d[i + 2]) * a;
      }
    }
  }
  getImageData(x = 0, y = 0, w = this.width, h = this.height) {
    if (x === 0 && y === 0 && w === this.width && h === this.height) return { width: w, height: h, data: this.data };
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) out.set(this.data.subarray(4 * ((y + r) * this.width + x), 4 * ((y + r) * this.width + x + w)), 4 * r * w);
    return { width: w, height: h, data: out };
  }
}
