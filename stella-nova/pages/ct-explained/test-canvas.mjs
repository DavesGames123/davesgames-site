// ============================================================================
//  CT EXPLAINED  ·  software canvas for Node tests
// ----------------------------------------------------------------------------
//  A small CPU version of the Canvas 2D API, enough for the scenes of this
//  page: transforms, paths (lines, arcs, rects), fill and stroke, linear and
//  radial gradients, ImageData, drawImage, rect clips, additive blending.
//  Text is drawn as grey blocks, so a PNG shows where a label sits but not
//  its glyphs. It also counts NaN coordinates, which a test fails on.
//
//  tests.mjs installs a stub `document` that makes these canvases, renders
//  every scene and, with --png DIR, writes PNG files to look at.
//
//  GREP MAP
//    grep -n 'class Ctx'          the 2D context
//    grep -n 'function parseColor' CSS colour strings
//    grep -n 'export function writePNG' RGBA -> PNG file
// ============================================================================
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

export function parseColor(s) {
  if (typeof s !== 'string') return [0, 0, 0, 1];
  s = s.trim();
  if (s[0] === '#') {
    if (s.length === 4) return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16), 1];
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  return [128, 128, 128, 1];
}

class Grad {
  constructor(kind, a) { this.kind = kind; this.a = a; this.stops = []; }
  addColorStop(t, c) { this.stops.push([t, parseColor(c)]); this.stops.sort((x, y) => x[0] - y[0]); }
  at(x, y) {
    let t;
    if (this.kind === 'l') {
      const [x0, y0, x1, y1] = this.a, dx = x1 - x0, dy = y1 - y0;
      t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1);
    } else {
      const [x0, y0, r0, , , r1] = this.a;
      t = (Math.hypot(x - x0, y - y0) - r0) / (r1 - r0 || 1);
    }
    const S = this.stops;
    if (!S.length) return [0, 0, 0, 0];
    if (t <= S[0][0]) return S[0][1];
    for (let i = 1; i < S.length; i++) if (t <= S[i][0]) {
      const [ta, ca] = S[i - 1], [tb, cb] = S[i], k = (t - ta) / (tb - ta || 1);
      return ca.map((v, j) => v + (cb[j] - v) * k);
    }
    return S[S.length - 1][1];
  }
}

export class Canvas {
  constructor(w = 300, h = 150) { this._w = w; this._h = h; this.px = new Float32Array(w * h * 4); this.ctx = null; }
  get width() { return this._w; }
  set width(v) { this._w = v | 0; this.px = new Float32Array(this._w * this._h * 4); }
  get height() { return this._h; }
  set height(v) { this._h = v | 0; this.px = new Float32Array(this._w * this._h * 4); }
  getContext() { return this.ctx || (this.ctx = new Ctx(this)); }
}

const I = () => [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

class Ctx {
  constructor(c) {
    this.canvas = c; this.st = []; this.m = I(); this.path = []; this.cur = null; this.nan = 0;
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over'; this.font = '10px sans-serif'; this.textAlign = 'left'; this.textBaseline = 'alphabetic';
    this.clipR = null; this.imageSmoothingEnabled = true; this.lineJoin = 'miter'; this.lineCap = 'butt';
    this.shadowBlur = 0; this.shadowColor = 'transparent';
  }
  save() { this.st.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, gco: this.globalCompositeOperation, clipR: this.clipR, font: this.font }); }
  restore() { const s = this.st.pop(); if (!s) return; Object.assign(this, { m: s.m, fillStyle: s.fillStyle, strokeStyle: s.strokeStyle, lineWidth: s.lineWidth, globalAlpha: s.globalAlpha, globalCompositeOperation: s.gco, clipR: s.clipR, font: s.font }); }
  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
  resetTransform() { this.m = I(); }
  translate(x, y) { this.m = mul(this.m, [1, 0, 0, 1, x, y]); }
  scale(x, y) { this.m = mul(this.m, [x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [c, s, -s, c, 0, 0]); }
  setLineDash() {} getLineDash() { return []; }
  measureText(s) { return { width: String(s).length * this.fs() * 0.55 }; }
  fs() { const m = /(\d+(?:\.\d+)?)px/.exec(this.font); return m ? +m[1] : 10; }
  T(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) this.nan++;
    const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  beginPath() { this.path = []; this.cur = null; }
  moveTo(x, y) { this.cur = [this.T(x, y)]; this.path.push(this.cur); }
  lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); this.cur.push(this.T(x, y)); }
  closePath() { if (this.cur && this.cur.length) { this.cur.closed = true; const p = this.cur[0]; this.cur = [p]; this.path.push(this.cur); } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(x, y, r, a0, a1, ccw = false) {
    let d = a1 - a0;
    if (!ccw && d < 0) d = (d % (2 * Math.PI)) + 2 * Math.PI;
    if (ccw && d > 0) d = (d % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) d = ccw ? -2 * Math.PI : 2 * Math.PI;
    const n = Math.max(8, Math.ceil(Math.abs(d) * Math.max(4, r) / 3));
    for (let i = 0; i <= n; i++) { const a = a0 + (d * i) / n; this.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
  }
  arcTo(x1, y1, x2, y2) { this.lineTo(x1, y1); this.lineTo(x2, y2); }
  ellipse(x, y, rx, ry, rot, a0, a1) { const n = 48; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; const c = Math.cos(rot), s = Math.sin(rot); const ex = rx * Math.cos(a), ey = ry * Math.sin(a); this.lineTo(x + ex * c - ey * s, y + ex * s + ey * c); } }
  clip() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sp of this.path) for (const [x, y] of sp) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const r = [x0, y0, x1, y1];
    this.clipR = this.clipR ? [Math.max(r[0], this.clipR[0]), Math.max(r[1], this.clipR[1]), Math.min(r[2], this.clipR[2]), Math.min(r[3], this.clipR[3])] : r;
  }
  createLinearGradient(...a) { return new Grad('l', a); }
  createRadialGradient(...a) { return new Grad('r', a); }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) {
    const C = this.canvas, out = this.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let k = 0; k < 4; k++) out.data[(j * w + i) * 4 + k] = C.px[((y + j) * C.width + x + i) * 4 + k] * (k === 3 ? 255 : 1);
    return out;
  }
  putImageData(id, x, y) {
    const C = this.canvas;
    for (let j = 0; j < id.height; j++) for (let i = 0; i < id.width; i++) {
      const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= C.width || Y >= C.height) continue;
      const o = (Y * C.width + X) * 4, s = (j * id.width + i) * 4;
      C.px[o] = id.data[s]; C.px[o + 1] = id.data[s + 1]; C.px[o + 2] = id.data[s + 2]; C.px[o + 3] = id.data[s + 3] / 255;
    }
  }
  blend(X, Y, r, g, b, a) {
    const C = this.canvas;
    if (X < 0 || Y < 0 || X >= C.width || Y >= C.height) return;
    if (this.clipR && (X < this.clipR[0] - 0.5 || X > this.clipR[2] + 0.5 || Y < this.clipR[1] - 0.5 || Y > this.clipR[3] + 0.5)) return;
    a *= this.globalAlpha;
    if (!(a > 0)) return;
    const o = (Y * C.width + X) * 4, P = C.px;
    if (this.globalCompositeOperation === 'lighter') { P[o] = Math.min(255, P[o] + r * a); P[o + 1] = Math.min(255, P[o + 1] + g * a); P[o + 2] = Math.min(255, P[o + 2] + b * a); P[o + 3] = Math.min(1, P[o + 3] + a); return; }
    P[o] = P[o] * (1 - a) + r * a; P[o + 1] = P[o + 1] * (1 - a) + g * a; P[o + 2] = P[o + 2] * (1 - a) + b * a; P[o + 3] = a + P[o + 3] * (1 - a);
  }
  paint(style, X, Y) { return style instanceof Grad ? style.at(...this.inv(X + 0.5, Y + 0.5)) : (this._pc && this._pc[0] === style ? this._pc[1] : (this._pc = [style, parseColor(style)])[1]); }
  inv(x, y) {
    const [a, b, c, d, e, f] = this.m, det = a * d - b * c || 1;
    return [(d * (x - e) - c * (y - f)) / det, (-b * (x - e) + a * (y - f)) / det];
  }
  fill() {
    const edges = [];
    let y0 = Infinity, y1 = -Infinity;
    for (const sp of this.path) {
      if (sp.length < 2) continue;
      for (let i = 0; i < sp.length; i++) {
        const p = sp[i], q = sp[(i + 1) % sp.length];
        if (p[1] === q[1]) continue;
        edges.push([p[0], p[1], q[0], q[1]]);
        y0 = Math.min(y0, p[1], q[1]); y1 = Math.max(y1, p[1], q[1]);
      }
    }
    const C = this.canvas;
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(C.height - 1, Math.ceil(y1));
    for (let Y = y0; Y <= y1; Y++) {
      const yc = Y + 0.5, xs = [];
      for (const [ax, ay, bx, by] of edges) {
        if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) xs.push([ax + ((yc - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
      }
      xs.sort((p, q) => p[0] - q[0]);
      let wnd = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wnd += xs[k][1];
        if (wnd === 0) continue;
        const xa = Math.max(0, Math.round(xs[k][0])), xb = Math.min(C.width - 1, Math.round(xs[k + 1][0]) - 1);
        for (let X = xa; X <= xb; X++) { const c = this.paint(this.fillStyle, X, Y); this.blend(X, Y, c[0], c[1], c[2], c[3]); }
      }
    }
  }
  stroke() {
    const lw = Math.max(1, this.lineWidth * Math.hypot(this.m[0], this.m[1])), r = lw / 2;
    for (const sp of this.path) for (let i = 0; i + 1 < sp.length; i++) this.seg(sp[i], sp[i + 1], r);
  }
  seg([ax, ay], [bx, by], r) {
    const C = this.canvas, x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), x1 = Math.min(C.width - 1, Math.ceil(Math.max(ax, bx) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1)), y1 = Math.min(C.height - 1, Math.ceil(Math.max(ay, by) + r + 1));
    if ((x1 - x0) * (y1 - y0) > 4e6) return;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
      const px = X + 0.5, py = Y + 0.5, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy), cov = Math.max(0, Math.min(1, r + 0.5 - d));
      if (cov > 0) { const c = this.paint(this.strokeStyle, X, Y); this.blend(X, Y, c[0], c[1], c[2], c[3] * cov); }
    }
  }
  fillRect(x, y, w, h) { const b = this.path; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.path = b; }
  strokeRect(x, y, w, h) { const b = this.path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.path = b; }
  clearRect(x, y, w, h) { const C = this.canvas; const [X0, Y0] = this.T(x, y), [X1, Y1] = this.T(x + w, y + h); for (let Y = Math.max(0, Math.floor(Y0)); Y < Math.min(C.height, Y1); Y++) for (let X = Math.max(0, Math.floor(X0)); X < Math.min(C.width, X1); X++) C.px.fill(0, (Y * C.width + X) * 4, (Y * C.width + X) * 4 + 4); }
  fillText(s, x, y) {
    const n = String(s).length, fs = this.fs(), w = n * fs * 0.55;
    let x0 = this.textAlign === 'center' ? x - w / 2 : this.textAlign === 'right' || this.textAlign === 'end' ? x - w : x;
    const yt = this.textBaseline === 'top' ? y : this.textBaseline === 'middle' ? y - fs / 2 : y - fs * 0.75;
    const b = this.path, st = this.fillStyle;
    const c = st instanceof Grad ? [200, 200, 200, 1] : parseColor(st);
    this.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.55 * c[3]})`;
    for (let i = 0; i < n; i++) if (String(s)[i] !== ' ') { this.beginPath(); this.rect(x0 + i * fs * 0.55 + 0.5, yt + fs * 0.15, fs * 0.45, fs * 0.6); this.fill(); }
    this.fillStyle = st; this.path = b;
  }
  strokeText() {}
  drawImage(src, ...a) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw, dh;
    if (a.length === 2) [dx, dy] = a, dw = sw, dh = sh;
    else if (a.length === 4) [dx, dy, dw, dh] = a;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    const S = src.px; if (!S) return;
    const p = [this.T(dx, dy), this.T(dx + dw, dy), this.T(dx, dy + dh), this.T(dx + dw, dy + dh)];
    const C = this.canvas;
    const X0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[0])))), X1 = Math.min(C.width - 1, Math.ceil(Math.max(...p.map((q) => q[0]))));
    const Y0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[1])))), Y1 = Math.min(C.height - 1, Math.ceil(Math.max(...p.map((q) => q[1]))));
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
      const [ux, uy] = this.inv(X + 0.5, Y + 0.5);
      const fx = sx + ((ux - dx) / dw) * sw, fy = sy + ((uy - dy) / dh) * sh;
      if (fx < sx || fy < sy || fx >= sx + sw || fy >= sy + sh) continue;
      const o = ((fy | 0) * src.width + (fx | 0)) * 4;
      this.blend(X, Y, S[o], S[o + 1], S[o + 2], S[o + 3]);
    }
  }
}

export function stubDocument() {
  return { createElement: (t) => (t === 'canvas' ? new Canvas() : {}) };
}

export function writePNG(path, canvas, bg = [5, 7, 12]) {
  const w = canvas.width, h = canvas.height, P = canvas.px;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, a = P[o + 3];
      for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.max(0, Math.min(255, Math.round(P[o + k] * (a > 0 ? 1 : 0) + bg[k] * (1 - Math.min(1, a)))));
    }
  }
  const T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
