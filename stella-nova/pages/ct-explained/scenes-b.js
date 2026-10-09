// ============================================================================
//  CT EXPLAINED  ·  scenes, part B  (ES module)
// ----------------------------------------------------------------------------
//  The figures of sections 6 to 10. Same interface as scenes-a.js:
//  height(w), step(dt), render(g, w, h), optional pointer(e) and set(k, v).
//
//  GREP MAP
//    grep -n 'class FilterScene'    ramp filter and its five windows
//    grep -n 'class FBPScene'       plain vs filtered, views added
//    grep -n 'class GantryScene'    3D gantry: parallel, fan, cone
//    grep -n 'class IterScene'      ART toy + four solvers race
//    grep -n 'class ArtefactScene'  seven artefacts, one control each
//    grep -n 'class HUScene'        Hounsfield units and windows
// ============================================================================
import * as M from './model.js';
import { PAL, Raster, plot, label, glow, panel, layout, clamp, minmax, rrect, MONO, SERIF } from './draw.js';

const TAU = Math.PI * 2;
const FILTER_NAMES = { 'ram-lak': 'Ram-Lak', 'shepp-logan': 'Shepp-Logan', cosine: 'Cosine', hamming: 'Hamming', hann: 'Hann' };
const FILTER_COLORS = { 'ram-lak': PAL.ray, 'shepp-logan': PAL.green, cosine: PAL.yellow, hamming: PAL.pink, hann: PAL.violet };
export { FILTER_NAMES };

function inset(r, p = 10) { return { x: r.x + p, y: r.y + p, w: r.w - 2 * p, h: r.h - 2 * p }; }
function axes(g, r, o = {}) {
  g.strokeStyle = PAL.line; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const y = r.y + (k / 4) * r.h;
    g.beginPath(); g.moveTo(r.x, y); g.lineTo(r.x + r.w, y); g.stroke();
  }
  g.strokeStyle = PAL.line2;
  g.beginPath(); g.moveTo(r.x, r.y); g.lineTo(r.x, r.y + r.h); g.lineTo(r.x + r.w, r.y + r.h); g.stroke();
  if (o.x0 != null) label(g, o.x0, r.x, r.y + r.h + 15, { size: 11, color: PAL.dim, font: MONO });
  if (o.x1 != null) label(g, o.x1, r.x + r.w, r.y + r.h + 15, { size: 11, color: PAL.dim, font: MONO, align: 'right' });
  if (o.title) label(g, o.title, r.x, r.y - 9, { size: 12, color: o.tc || PAL.ink2 });
}

// ---------------------------------------------------------------------------
// 6 · THE RAMP FILTER: |k| times a window. Top: the five responses with the
// cutoff. Bottom: one projection before and after the filter.
// ---------------------------------------------------------------------------
export class FilterScene {
  constructor(o = {}) {
    this.filter = o.filter || 'ram-lak'; this.cutoff = o.cutoff ?? 1;
    this.img = M.phantom('shepp-logan-modified', 128).image;
    this.recalc();
  }
  set(k, v) { if (k === 'filter') this.filter = v; if (k === 'cutoff') this.cutoff = +v; this.recalc(); }
  recalc() {
    this.C = M.filterCurves(this.cutoff);
    this.R = M.filteredRow(this.img, 0.35, this.filter, this.cutoff);
  }
  height(w) { return w > 700 ? Math.round(w * 0.42) : Math.round(w * 1.2); }
  step() {}
  render(g, w, h) {
    const wide = w / h > 1.5;
    const pad = 44;
    let A, B;
    if (wide) {
      const cw = (w - 3 * pad) / 2;
      A = { x: pad, y: 34, w: cw, h: h - 70 };
      B = { x: 2 * pad + cw, y: 34, w: cw, h: h - 70 };
    } else {
      const ch = (h - 4 * 34) / 2;
      A = { x: pad, y: 34, w: w - pad - 16, h: ch };
      B = { x: pad, y: 34 + ch + 64, w: w - pad - 16, h: ch };
    }
    axes(g, A, { x0: '0', x1: 'Nyquist', title: 'filter gain against frequency' });
    for (const f of M.E.FILTERS) {
      const on = f === this.filter;
      plot(g, A, this.C.curves[f], { lo: 0, hi: 1.05, color: on ? FILTER_COLORS[f] : 'rgba(255,255,255,0.16)', lw: on ? 2.5 : 1.2, xs: this.C.nu });
    }
    // ideal ramp |k|
    plot(g, A, this.C.nu, { lo: 0, hi: 1.05, color: PAL.dim, dash: [3, 5], lw: 1, xs: this.C.nu });
    const xc = A.x + this.cutoff * A.w;
    g.strokeStyle = PAL.amber; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(xc, A.y); g.lineTo(xc, A.y + A.h); g.stroke(); g.setLineDash([]);
    label(g, `cutoff ${this.cutoff.toFixed(2)}`, Math.min(xc - 6, A.x + A.w - 6), A.y + 14, { size: 11, color: PAL.amber, align: 'right', font: MONO });
    label(g, `${FILTER_NAMES[this.filter]} window`, A.x + 8, A.y + 16, { size: 13, color: FILTER_COLORS[this.filter] });
    label(g, '|k|', A.x + A.w * 0.86, A.y + A.h * 0.12, { size: 14, color: PAL.dim, font: SERIF });
    // one projection, raw and filtered
    const raw = this.R.raw, fil = this.R.filtered;
    const [, rh] = minmax(raw), [flo, fhi] = minmax(fil);
    const sc = Math.max(Math.abs(flo), Math.abs(fhi)) || 1;
    axes(g, B, { title: 'one projection, before (amber) and after (blue)' });
    const mid = B.y + B.h * 0.55;
    g.strokeStyle = PAL.line2; g.beginPath(); g.moveTo(B.x, mid); g.lineTo(B.x + B.w, mid); g.stroke();
    const rawN = Float32Array.from(raw, (v) => v / (rh || 1));
    plot(g, { x: B.x, y: B.y, w: B.w, h: B.h * 0.55 }, rawN, { lo: 0, hi: 1.05, color: PAL.amber, fill: PAL.amberA + '0.12)' });
    const filN = Float32Array.from(fil, (v) => v / sc);
    plot(g, { x: B.x, y: mid - B.h * 0.45, w: B.w, h: B.h * 0.9 }, filN, { lo: -1, hi: 1, color: PAL.ray, lw: 1.6 });
    label(g, 'negative lobes cancel the blur', B.x + B.w - 6, B.y + B.h - 8, { size: 11, color: PAL.dim, align: 'right' });
  }
}

// ---------------------------------------------------------------------------
// 7 · FBP: the same views, back-projected plain and filtered.
// ---------------------------------------------------------------------------
export class FBPScene {
  constructor(o = {}) {
    this.n = 128; this.views = 180; this.dur = 10; this.hold = 3;
    this.filter = o.filter || 'ram-lak'; this.cutoff = o.cutoff ?? 1;
    this.name = o.phantom || 'shepp-logan-modified';
    this.build();
  }
  set(k, v) {
    if (k === 'filter') this.filter = v;
    if (k === 'cutoff') this.cutoff = +v;
    if (k === 'phantom') this.name = v;
    this.build();
  }
  build() {
    const ph = M.phantom(this.name, this.n);
    this.img = ph.image;
    this.S = M.scanSet(this.img, { nAngles: this.views, filter: this.filter, cutoff: this.cutoff, key: 'fbp-' + this.name });
    const [, hi] = minmax(this.img.data);
    this.hi = this.name.startsWith('shepp') ? 1 : Math.min(hi, M.MU_WATER * 2);
    this.order = M.viewOrder(this.views);
    this.reset();
  }
  reset() {
    const n = this.n, d = () => ({ nx: n, ny: n, width: this.img.width, data: new Float32Array(n * n) });
    this.plain = d(); this.fil = d(); this.done = 0; this.t = 0;
    this.rasP = new Raster(n, n); this.rasF = new Raster(n, n); this.score = null;
  }
  height(w) { return w > 700 ? Math.round(w * 0.42) : Math.round(w * 1.6); }
  target() { const k = clamp(this.t / this.dur, 0, 1); return Math.max(1, Math.round(this.views * k * k)); }
  step(dt) {
    this.t += dt;
    if (this.t > this.dur + this.hold) this.reset();
    const want = this.target();
    if (want > this.done) {
      M.bpAccum(this.S.sino, this.S.geom, this.plain, this.order, this.done, want);
      M.bpAccum(this.S.q, this.S.geom, this.fil, this.order, this.done, want);
      this.done = want;
      this.score = null;
    }
  }
  render(g, w, h) {
    const R = layout(w, h, 2, { top: 26 });
    const sc = this.views / this.done;
    const [, ph] = minmax(this.plain.data);
    this.rasP.set(this.plain.data, 0, ph || 1, '@image');
    const show = this.fil.data.map((v) => v * sc);
    this.rasF.set(show, 0, this.hi, '@image');
    this.rasP.draw(g, R[0].x, R[0].y, R[0].w, R[0].h);
    panel(g, R[0], `plain back-projection, ${this.done} views`);
    this.rasF.draw(g, R[1].x, R[1].y, R[1].w, R[1].h);
    panel(g, R[1], `filtered (${FILTER_NAMES[this.filter]}), ${this.done} views`);
    if (this.score == null) this.score = M.E.psnr(this.img, { ...this.fil, data: show });
    label(g, `PSNR ${this.score.toFixed(1)} dB`, R[1].x + R[1].w - 8, R[1].y + R[1].h - 10, { size: 12, color: PAL.ink2, align: 'right', font: MONO, shadow: true });
  }
}

// ---------------------------------------------------------------------------
// 8 · GEOMETRY: a 3D gantry. Parallel (first scanners: one pencil beam that
// steps across, then turns), fan (one row of detectors, one turn) and cone
// (a flat panel, a whole volume per turn). The inset shows the detector.
// ---------------------------------------------------------------------------
export class GantryScene {
  constructor(o = {}) {
    this.mode = o.mode || 'fan'; this.t = 0; this.yaw = -0.65; this.pitch = 0.32; this.drag = null; this.idle = 9;
    this.b = 0; this.slice = M.phantom('shepp-logan-modified', 128).image;
    this.cone = new Map(); this.rasC = null; this.prof = null;
  }
  set(k, v) { if (k === 'mode') { this.mode = v; this.t = 0; } }
  height(w) { return w > 700 ? Math.round(w * 0.5) : Math.round(w * 1.15); }
  step(dt) {
    this.t += dt; this.idle += dt;
    if (this.idle > 3) this.yaw += dt * 0.12;
    if (this.mode === 'parallel') {
      // translate in 1.2 s, then turn 12 degrees
      const k = this.t / 1.2;
      this.b = Math.floor(k) * (Math.PI / 15);
      this.tr = (k % 1) * 2 - 1;
    } else this.b = (this.t * 0.7) % TAU;
    const key = Math.round(((this.b % TAU) / TAU) * 60) % 60;
    if (this.mode === 'cone') {
      if (!this.cone.has(key)) this.cone.set(key, M.coneView((key / 60) * TAU, 40));
      this.cv = this.cone.get(key);
    } else {
      this.prof = M.oneView(this.slice, this.b).data;
    }
  }
  pointer(e) {
    if (e.type === 'down') { this.drag = { x: e.x, y: e.y, yaw: this.yaw, pitch: this.pitch }; return true; }
    if (e.type === 'move' && this.drag && e.buttons) {
      this.yaw = this.drag.yaw + (e.x - this.drag.x) * 0.01;
      this.pitch = clamp(this.drag.pitch + (e.y - this.drag.y) * 0.006, -0.2, 1.1);
      this.idle = 0; return true;
    }
    if (e.type === 'up') this.drag = null;
    return false;
  }
  proj(w, h) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const f = Math.min(w, h) * 1.25, D = 6.5, ox = w * 0.5, oy = h * 0.52;
    return (x, y, z) => {
      // yaw about the vertical axis (y), then pitch about x
      const X = cy * x + sy * z, Z0 = -sy * x + cy * z;
      const Y = cp * y - sp * Z0, Z = sp * y + cp * Z0;
      const s = f / (D - Z);
      return [ox + X * s, oy - Y * s, Z];
    };
  }
  render(g, w, h) {
    const P = this.proj(w, h);
    const b = this.b, dX = -Math.sin(b), dY = Math.cos(b), nX = Math.cos(b), nY = Math.sin(b);
    const sod = 1.15, R0 = 1.38, R1 = 1.78, Z = 0.32;
    // ring as quads, back to front by depth
    const quads = [];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
      const pts = (r, z) => [P(r * Math.cos(a0), r * Math.sin(a0), z), P(r * Math.cos(a1), r * Math.sin(a1), z)];
      const [f0, f1] = pts(R1, Z), [b0, b1] = pts(R1, -Z), [i0, i1] = pts(R0, Z), [j0, j1] = pts(R0, -Z);
      quads.push({ d: (f0[2] + b1[2]) / 2, q: [f0, f1, b1, b0], c: 0.10 + 0.08 * Math.cos(a0 - 1) });   // outer shell
      quads.push({ d: (i0[2] + j1[2]) / 2, q: [i0, i1, j1, j0], c: 0.05 });                              // bore
      quads.push({ d: (f0[2] + i1[2]) / 2 + 0.01, q: [f0, f1, i1, i0], c: 0.16 });                      // front face
      quads.push({ d: (b0[2] + j1[2]) / 2, q: [b0, b1, j1, j0], c: 0.12 });                             // back face
    }
    quads.sort((a, b2) => a.d - b2.d);
    const drawQuads = (pred) => {
      for (const Q of quads) {
        if (!pred(Q.d)) continue;
        g.fillStyle = `rgba(150,170,210,${Q.c})`;
        g.beginPath(); g.moveTo(Q.q[0][0], Q.q[0][1]); for (let k = 1; k < 4; k++) g.lineTo(Q.q[k][0], Q.q[k][1]); g.closePath(); g.fill();
      }
    };
    drawQuads((d) => d < -0.2);
    // table
    const tb = [[-0.42, -0.62, -3.2], [0.42, -0.62, -3.2], [0.42, -0.62, 2.4], [-0.42, -0.62, 2.4]].map((p) => P(...p));
    g.fillStyle = 'rgba(120,130,150,0.18)'; g.beginPath(); tb.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
    g.strokeStyle = PAL.line2; g.stroke();
    // object: an ellipsoid head as a wire
    g.strokeStyle = 'rgba(232,234,240,0.35)'; g.lineWidth = 1;
    const ell = (fn) => { g.beginPath(); for (let k = 0; k <= 48; k++) { const p = P(...fn((k / 48) * TAU)); k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.stroke(); };
    for (const zz of [-0.5, -0.25, 0, 0.25, 0.5]) { const s = Math.sqrt(1 - (zz / 0.62) ** 2); ell((a) => [0.5 * s * Math.cos(a), 0.62 * s * Math.sin(a) - 0.05, zz]); }
    for (const a2 of [0, Math.PI / 3, (2 * Math.PI) / 3]) ell((a) => [0.5 * Math.cos(a) * Math.cos(a2), 0.62 * Math.cos(a) * Math.sin(a2) - 0.05, 0.62 * Math.sin(a)]);
    // source, rays, detector
    const S = [sod * Math.sin(b), -sod * Math.cos(b), 0];
    const C = [S[0] + 2 * sod * dX, S[1] + 2 * sod * dY, 0];
    g.save(); g.globalCompositeOperation = 'lighter';
    const ray = (A, B2, a) => { const p = P(...A), q = P(...B2); g.strokeStyle = PAL.rayA + a + ')'; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); };
    let src = S;
    if (this.mode === 'parallel') {
      const u = this.tr * 0.85;
      src = [S[0] + u * nX, S[1] + u * nY, 0];
      const det = [C[0] + u * nX, C[1] + u * nY, 0];
      g.lineWidth = 2.5; ray(src, det, 0.9); g.lineWidth = 1;
      for (let k = -8; k <= 8; k++) { const v = (k / 8) * 0.85; if (v > u) break; ray([S[0] + v * nX, S[1] + v * nY, 0], [C[0] + v * nX, C[1] + v * nY, 0], 0.12); }
    } else if (this.mode === 'fan') {
      for (let k = -16; k <= 16; k++) { const v = (k / 16) * 0.95; ray(S, [C[0] + v * nX, C[1] + v * nY, 0], 0.22); }
    } else {
      for (let k = -5; k <= 5; k++) for (let m = -4; m <= 4; m++) { const v = (k / 5) * 0.95, zz = (m / 4) * 0.7; ray(S, [C[0] + v * nX, C[1] + v * nY, zz], 0.13); }
    }
    g.restore();
    // detector
    const quad = (pts, fill, stroke) => { const q = pts.map((p) => P(...p)); g.fillStyle = fill; g.beginPath(); q.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); if (stroke) { g.strokeStyle = stroke; g.stroke(); } };
    if (this.mode === 'parallel') {
      const u = this.tr * 0.85, c = [C[0] + u * nX, C[1] + u * nY];
      quad([[c[0] - 0.06 * nX, c[1] - 0.06 * nY, -0.06], [c[0] + 0.06 * nX, c[1] + 0.06 * nY, -0.06], [c[0] + 0.06 * nX, c[1] + 0.06 * nY, 0.06], [c[0] - 0.06 * nX, c[1] - 0.06 * nY, 0.06]], 'rgba(255,179,92,0.9)');
    } else {
      const hz = this.mode === 'cone' ? 0.72 : 0.05;
      quad([[C[0] - nX, C[1] - nY, -hz], [C[0] + nX, C[1] + nY, -hz], [C[0] + nX, C[1] + nY, hz], [C[0] - nX, C[1] - nY, hz]], 'rgba(255,179,92,0.22)', 'rgba(255,179,92,0.9)');
    }
    const sp = P(...src);
    glow(g, sp[0], sp[1], 14, '120,200,255', 1);
    drawQuads((d) => d >= -0.2);
    // inset: what the detector reads now
    const iw = Math.min(170, w * 0.36), ih = this.mode === 'cone' ? iw : iw * 0.5;
    const I = { x: w - iw - 14, y: h - ih - 16, w: iw, h: ih };
    g.fillStyle = 'rgba(8,10,16,0.85)'; rrect(g, I.x - 6, I.y - 22, I.w + 12, I.h + 28, 8); g.fill();
    label(g, this.mode === 'cone' ? 'flat panel reads a 2D image' : 'detector row reads a profile', I.x, I.y - 8, { size: 11, color: PAL.dim });
    if (this.mode === 'cone' && this.cv) {
      if (!this.rasC || this.rasC.w !== this.cv.nu || this.rasC.h !== this.cv.nv) this.rasC = new Raster(this.cv.nu, this.cv.nv);
      // detector row 0 is the lowest z: flip so up is up
      const { nu, nv, data } = this.cv, flip = new Float32Array(nu * nv);
      for (let v = 0; v < nv; v++) flip.set(data.subarray(v * nu, (v + 1) * nu), (nv - 1 - v) * nu);
      this.rasC.set(flip, 0, minmax(data)[1] || 1, '@data');
      this.rasC.draw(g, I.x, I.y, I.w, I.h);
    } else if (this.prof) {
      if (this.mode === 'parallel') {
        const n = this.prof.length, upto = Math.round(((this.tr + 1) / 2) * n);
        const part = Float32Array.from(this.prof, (v, i) => (i <= upto ? v : NaN));
        plot(g, I, part, { lo: 0, hi: 3.2, color: PAL.amber, lw: 1.6, n: Math.max(2, upto) , xs: Float32Array.from({ length: n }, (_, i) => i / (n - 1)) });
      } else plot(g, I, this.prof, { lo: 0, hi: 3.2, color: PAL.amber, lw: 1.6, fill: PAL.amberA + '0.15)' });
    }
    const names = { parallel: 'parallel beam: step across, then turn', fan: 'fan beam: one turn, one slice', cone: 'cone beam: one turn, a whole volume' };
    label(g, names[this.mode], 16, 22, { size: 13, color: PAL.ink2 });
    label(g, 'drag to look around', 16, h - 14, { size: 11, color: PAL.dim });
  }
}

// ---------------------------------------------------------------------------
// 9 · ITERATIVE: a toy of ART on two equations, then four solvers race on
// a sparse, noisy scan. The plot shows the error against the true image.
// ---------------------------------------------------------------------------
export const METHODS = [
  { id: 'art', label: 'ART', color: PAL.amber },
  { id: 'sart', label: 'SART', color: PAL.green },
  { id: 'sirt', label: 'SIRT', color: PAL.ray },
  { id: 'cgls', label: 'CGLS', color: PAL.pink },
];
export class IterScene {
  constructor(o = {}) {
    this.sel = o.method || 'sirt'; this.maxIt = 50; this.t = 0;
    this.lines = [{ a: [0.9, 0.44], b: 1.34 }, { a: [0.6, 0.8], b: 1.4 }];
    this.setup();
  }
  set(k, v) { if (k === 'method') this.sel = v; if (k === 'reset') this.setup(); }
  setup() {
    this.D = M.iterSetup('shepp-logan-modified', { n: 96, nAngles: 30, dose: 1e5 });
    this.solvers = METHODS.map((m) => ({ ...m, s: M.E.createSolver(m.id, this.D.sino, this.D.geom, this.D.dims, {}), err: [], it: 0 }));
    this.fbpErr = M.E.rmse(this.D.ph.image, this.D.fbpImg);
    this.ras = new Raster(96, 96); this.rasF = new Raster(96, 96).set(this.D.fbpImg.data, 0, 1, '@image');
    this.turn = 0; this.acc = 0;
    this.x0 = [-0.6, 2.4]; this.path = M.kaczmarz(this.lines, this.x0, 12); this.tk = 0;
  }
  height(w) { return w > 760 ? Math.round(w * 0.36) : Math.round(w * 2.6); }
  step(dt) {
    this.t += dt; this.acc += dt; this.tk += dt;
    if (this.tk > 0.55 * (this.path.length + 3)) {
      this.tk = 0;
      const a = (this.t * 2.3) % TAU;
      this.x0 = [1 + 1.5 * Math.cos(a), 1 + 1.5 * Math.sin(a)];
      this.path = M.kaczmarz(this.lines, this.x0, 12);
    }
    // one solver iteration per frame, in turn
    if (this.acc > 0.05) {
      this.acc = 0;
      const S = this.solvers[this.turn++ % 4];
      if (S.it < this.maxIt) {
        const r = S.s.step(); S.it = r.iter;
        S.err.push(M.E.rmse(this.D.ph.image, r.image));
      }
    }
  }
  render(g, w, h) {
    const R = layout(w, h, 3, { top: 26, row: w > 760 });
    // toy
    const T = R[0];
    panel(g, T, 'ART on two rays, two pixels');
    const lo = -0.9, hi = 2.9, X = (x) => T.x + ((x - lo) / (hi - lo)) * T.w, Y = (y) => T.y + T.h - ((y - lo) / (hi - lo)) * T.h;
    g.save(); g.beginPath(); g.rect(T.x, T.y, T.w, T.h); g.clip();
    g.strokeStyle = PAL.line; for (let k = -1; k <= 3; k++) { g.beginPath(); g.moveTo(X(k), T.y); g.lineTo(X(k), T.y + T.h); g.stroke(); g.beginPath(); g.moveTo(T.x, Y(k)); g.lineTo(T.x + T.w, Y(k)); g.stroke(); }
    const cols = [PAL.ray, PAL.green];
    this.lines.forEach((L, i) => {
      const [a, b] = L.a, p0 = [lo, (L.b - a * lo) / b], p1 = [hi, (L.b - a * hi) / b];
      g.strokeStyle = cols[i]; g.lineWidth = 2; g.beginPath(); g.moveTo(X(p0[0]), Y(p0[1])); g.lineTo(X(p1[0]), Y(p1[1])); g.stroke();
    });
    const k = Math.min(this.path.length - 1, Math.floor(this.tk / 0.55));
    g.strokeStyle = PAL.amber; g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i <= k; i++) { const p = this.path[i]; i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); }
    g.stroke();
    for (let i = 0; i <= k; i++) { const p = this.path[i]; g.fillStyle = i === k ? PAL.yellow : PAL.amber; g.beginPath(); g.arc(X(p[0]), Y(p[1]), i === k ? 5 : 2.5, 0, TAU); g.fill(); }
    g.restore();
    label(g, 'x₁', T.x + T.w - 8, T.y + T.h - 8, { size: 13, color: PAL.dim, font: SERIF, align: 'right' });
    label(g, 'x₂', T.x + 8, T.y + 18, { size: 13, color: PAL.dim, font: SERIF });
    // selected solver image
    const S = this.solvers.find((s) => s.id === this.sel);
    this.ras.set(S.s.image.data, 0, 1, '@image');
    this.ras.draw(g, R[1].x, R[1].y, R[1].w, R[1].h);
    panel(g, R[1], `${S.label}, iteration ${S.it}`);
    const fs = R[1].w * 0.3;
    this.rasF.draw(g, R[1].x + R[1].w - fs - 6, R[1].y + 6, fs, fs);
    g.strokeStyle = PAL.line2; g.strokeRect(R[1].x + R[1].w - fs - 6, R[1].y + 6, fs, fs);
    label(g, 'FBP', R[1].x + R[1].w - 10, R[1].y + fs + 20, { size: 11, color: PAL.dim, align: 'right', shadow: true });
    // error curves
    const C = inset(R[2], 12);
    panel(g, R[2], 'error against the true image');
    let eHi = this.fbpErr * 1.6;
    for (const s of this.solvers) for (const e of s.err) eHi = Math.max(eHi, e);
    eHi = Math.min(eHi, 0.6);
    const xsFor = (n) => Float32Array.from({ length: n }, (_, i) => (i + 1) / this.maxIt);
    plot(g, C, [this.fbpErr, this.fbpErr], { lo: 0, hi: eHi, color: PAL.dim, dash: [4, 4], lw: 1, xs: [0, 1] });
    label(g, 'FBP', C.x + C.w - 4, C.y + C.h - (this.fbpErr / eHi) * C.h - 5, { size: 11, color: PAL.dim, align: 'right' });
    for (const s of this.solvers) if (s.err.length > 1) plot(g, C, s.err, { lo: 0, hi: eHi, color: s.color, lw: s.id === this.sel ? 2.6 : 1.3, xs: xsFor(s.err.length) });
    let ly = C.y + 14;
    for (const s of this.solvers) { label(g, `${s.label} ${s.err.length ? s.err[s.err.length - 1].toFixed(3) : ''}`, C.x + C.w - 4, ly, { size: 11, color: s.color, align: 'right', font: MONO }); ly += 15; }
    label(g, `iterations 1 to ${this.maxIt}`, C.x, R[2].y + R[2].h + 16, { size: 11, color: PAL.dim });
  }
}

// ---------------------------------------------------------------------------
// 10 · ARTEFACTS: one case at a time: truth, reconstruction and the signed
// error (reconstruction minus truth) on the @signed diverging map.
// ---------------------------------------------------------------------------
export class ArtefactScene {
  constructor(o = {}) { this.id = o.id || 'noise'; this.p = o.p ?? 0.35; this.dirty = 0.01; this.res = null; }
  set(k, v) { if (k === 'case') { this.id = v; this.p = 0.35; } if (k === 'p') this.p = +v; this.dirty = 0.06; }
  height(w) { return w > 700 ? Math.round(w * 0.36) : Math.round(w * 2.5); }
  step(dt) {
    if (this.dirty > 0) { this.dirty -= dt; if (this.dirty <= 0) { this.res = M.artefact(this.id, this.p); this.dirty = 0; } }
  }
  render(g, w, h) {
    if (!this.res) { this.res = M.artefact(this.id, this.p); }
    const r = this.res, hard = this.id === 'hardening';
    const R = layout(w, h, 3, { top: 26 });
    const n = r.recon.nx;
    if (!this.rA || this.rA.w !== n) { this.rA = new Raster(n, n); this.rB = new Raster(n, n); this.rD = new Raster(n, n); }
    let lo = r.lo, hi = r.hi;
    if (this.id === 'rings') { lo = M.MU_WATER * 0.75; hi = M.MU_WATER * 1.25; }
    this.rA.set(r.ref.data, lo, hi, '@image');
    this.rB.set(r.recon.data, lo, hi, '@image');
    // signed error, recon - object, on a diverging map (zero in the middle)
    if (!hard) {
      if (this.errSrc !== r) {
        this.errSrc = r;
        this.err = r.recon.data.map((v, i) => v - r.ref.data[i]);
        this.errSpan = 0.25 * (hi - lo) || 1;
      }
      this.rD.set(this.err, -this.errSpan, this.errSpan, '@signed');
      this.rD.draw(g, R[2].x, R[2].y, R[2].w, R[2].h);
      panel(g, R[2], 'error: image minus object');
      label(g, 'too high', R[2].x + R[2].w - 8, R[2].y + 16, { size: 11, color: PAL.ink2, align: 'right', shadow: true });
      label(g, 'too low', R[2].x + 8, R[2].y + 16, { size: 11, color: PAL.ink2, shadow: true });
    }
    this.rA.draw(g, R[0].x, R[0].y, R[0].w, R[0].h);
    panel(g, R[0], 'the object');
    this.rB.draw(g, R[1].x, R[1].y, R[1].w, R[1].h);
    panel(g, R[1], r.note);
    label(g, `PSNR ${r.psnr.toFixed(1)} dB`, R[1].x + R[1].w - 8, R[1].y + R[1].h - 10, { size: 12, color: PAL.ink2, align: 'right', font: MONO, shadow: true });
    if (hard && r.extra) {
      const C = inset(R[2], 12);
      panel(g, R[2], 'μ across the middle of the head');
      plot(g, C, r.extra.refProfile, { lo: 0, hi: M.MU_WATER * 2.6, color: PAL.dim, dash: [4, 4], lw: 1.2 });
      plot(g, C, r.extra.profile, { lo: 0, hi: M.MU_WATER * 2.6, color: PAL.amber, lw: 2 });
      label(g, 'true (70 keV)', C.x + 4, C.y + C.h - 4, { size: 11, color: PAL.dim });
      label(g, 'measured: the middle sags (cupping)', C.x + 4, C.y + 12, { size: 11, color: PAL.amber });
    }
  }
}

// ---------------------------------------------------------------------------
// 11 · HOUNSFIELD UNITS: a reconstructed slice in HU through a display
// window. The bar shows where tissues sit on the HU scale.
// ---------------------------------------------------------------------------
export class HUScene {
  constructor(o = {}) {
    this.name = o.phantom || 'chest'; this.L = -600; this.W = 1500; this.hover = null;
    this.ras = new Raster(192, 192);
    this.scale = M.huScale();
  }
  set(k, v) {
    if (k === 'phantom') this.name = v;
    if (k === 'window') { const w = M.WINDOWS.find((x) => x.id === v); if (w) { this.L = w.L; this.W = w.W; } }
    if (k === 'L') this.L = +v;
    if (k === 'W') this.W = +v;
  }
  height(w) { return w > 700 ? Math.round(w * 0.5) : Math.round(w * 1.4); }
  step() { this.S = M.huSlice(this.name, 192); }
  pointer(e) {
    const r = this.F;
    if (!r || e.type === 'up') return false;
    if (e.x >= r.x && e.x < r.x + r.w && e.y >= r.y && e.y < r.y + r.h) {
      const ix = Math.floor(((e.x - r.x) / r.w) * 192), iy = Math.floor(((e.y - r.y) / r.h) * 192);
      this.hover = { x: e.x, y: e.y, hu: this.S.hu[iy * 192 + ix] };
      return e.type === 'down';
    }
    this.hover = null; return false;
  }
  render(g, w, h) {
    if (!this.S) this.step();
    const wide = w / h > 1.5;
    const top = 26;
    let r, B;
    if (wide) {
      const s = h - top - 16;
      r = { x: 16, y: top, w: s, h: s };
      B = { x: s + 70, y: top + 10, w: 34, h: s - 30, vert: true };
    } else {
      const s = Math.min(w - 32, h - 150);
      r = { x: (w - s) / 2, y: top, w: s, h: s };
      B = { x: 24, y: s + top + 56, w: w - 48, h: 26, vert: false };
    }
    this.F = r;
    const lo = this.L - this.W / 2, hi = this.L + this.W / 2;
    this.ras.set(this.S.hu, lo, hi, '@hu');
    this.ras.draw(g, r.x, r.y, r.w, r.h);
    panel(g, r, `window: level ${this.L} HU, width ${this.W} HU`);
    if (this.hover) {
      g.strokeStyle = PAL.yellow; g.lineWidth = 1.5; g.beginPath(); g.arc(this.hover.x, this.hover.y, 6, 0, TAU); g.stroke();
      label(g, `${Math.round(this.hover.hu)} HU`, this.hover.x + 10, this.hover.y - 10, { size: 13, color: PAL.yellow, font: MONO, shadow: true });
    }
    // the HU bar from -1000 to +2000, grey ramp of the current window
    const H0 = -1000, H1 = 2000;
    const pos = (hu) => (B.vert ? B.y + B.h - ((hu - H0) / (H1 - H0)) * B.h : B.x + ((hu - H0) / (H1 - H0)) * B.w);
    const steps = 120;
    for (let k = 0; k < steps; k++) {
      const hu = H0 + ((k + 0.5) / steps) * (H1 - H0);
      const v = Math.round(255 * clamp((hu - lo) / (hi - lo), 0, 1));
      g.fillStyle = `rgb(${v},${v},${v})`;
      if (B.vert) { const y0 = pos(H0 + ((k + 1) / steps) * (H1 - H0)); g.fillRect(B.x, y0, B.w, B.h / steps + 0.6); }
      else { const x0 = pos(H0 + (k / steps) * (H1 - H0)); g.fillRect(x0, B.y, B.w / steps + 0.6, B.h); }
    }
    g.strokeStyle = PAL.amber; g.lineWidth = 2;
    if (B.vert) { g.strokeRect(B.x - 4, pos(Math.min(H1, hi)), B.w + 8, pos(Math.max(H0, lo)) - pos(Math.min(H1, hi))); }
    else { g.strokeRect(pos(Math.max(H0, lo)), B.y - 4, pos(Math.min(H1, hi)) - pos(Math.max(H0, lo)), B.h + 8); }
    // material ticks
    const names = { air: 'air', lung: 'lung', fat: 'fat', water: 'water', blood: 'blood', muscle: 'muscle', spongy: 'spongy bone', bone: 'bone' };
    // group materials whose ticks would collide, one label per group
    const groups = [];
    for (const m of this.scale) {
      const p = pos(m.hu), G = groups[groups.length - 1];
      if (G && Math.abs(p - G.p1) < (B.vert ? 15 : 34)) { G.names.push(names[m.m]); G.p1 = p; G.ps.push(p); }
      else groups.push({ names: [names[m.m]], p0: p, p1: p, ps: [p], hu: m.hu });
    }
    groups.forEach((G, k) => {
      const mid = (G.p0 + G.p1) / 2, txt = G.names.join(' · ');
      g.strokeStyle = PAL.ink2; g.lineWidth = 1;
      for (const p of G.ps) {
        g.beginPath();
        if (B.vert) { g.moveTo(B.x + B.w, p); g.lineTo(B.x + B.w + 6, p); } else { g.moveTo(p, B.y + B.h); g.lineTo(p, B.y + B.h + 5); }
        g.stroke();
      }
      if (B.vert) label(g, G.names.length > 1 ? txt : `${txt} ${G.hu}`, B.x + B.w + 12, mid + 4, { size: 11, color: PAL.ink2 });
      else label(g, txt, clamp(mid, B.x + 20, B.x + B.w - 20), B.y + B.h + 18 + (k % 2) * 14, { size: 10, color: PAL.ink2, align: 'center' });
    });
    if (B.vert) { label(g, '-1000', B.x - 6, B.y + B.h, { size: 10, color: PAL.dim, align: 'right', font: MONO }); label(g, '+2000', B.x - 6, B.y + 8, { size: 10, color: PAL.dim, align: 'right', font: MONO }); }
    else { label(g, '-1000 HU', B.x, B.y - 8, { size: 10, color: PAL.dim, font: MONO }); label(g, '+2000 HU', B.x + B.w, B.y - 8, { size: 10, color: PAL.dim, font: MONO, align: 'right' }); }
  }
}
