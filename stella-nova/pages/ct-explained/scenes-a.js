// ============================================================================
//  CT EXPLAINED  ·  scenes, part A  (ES module)
// ----------------------------------------------------------------------------
//  The hero scan and the figures of sections 1 to 5. Each scene is a class
//  with the same small interface, which main.js and saver.js drive:
//
//    new Scene(opts)           build data (engine calls go through model.js)
//    scene.height(w)           CSS height for a CSS width
//    scene.step(dt)            advance the animation by dt seconds
//    scene.render(g, w, h)     draw into a 2D context in CSS pixels
//    scene.pointer(e)          optional: { type, x, y } in CSS pixels
//    scene.set(key, value)     optional: a control changed
//
//  A scene never touches the DOM. It draws only into the context it gets.
//
//  GREP MAP
//    grep -n 'class HeroScene'     gantry + sinogram + recon (also the saver)
//    grep -n 'class BeerScene'     photons through one row of a head
//    grep -n 'class ProjScene'     one parallel projection, a line integral
//    grep -n 'class SinoScene'     the sinogram builds, a point traces a sine
//    grep -n 'class BPScene'       plain back-projection and the 1/r blur
//    grep -n 'class FourierScene'  each view fills one line of k-space
// ============================================================================
import * as M from './model.js';
import { PAL, CM, Raster, plot, label, glow, panel, layout, worldMap, clamp, minmax, MONO, SERIF } from './draw.js';

const TAU = Math.PI * 2;
const deg = (r) => Math.round((r * 180) / Math.PI);

// ---------------------------------------------------------------------------
// HERO: a fan-beam gantry turns once around a phantom. The sinogram fills
// column by column and the filtered back-projection builds view by view.
// The scan cycles through phantoms. saver.js draws the same scene.
// ---------------------------------------------------------------------------
export const HERO_LIST = ['head', 'chest', 'shepp-logan-modified', 'walnut', 'suitcase', 'metal-implant'];
export const HERO_TEXT = {
  head: 'A head: skull, ventricles and a small bleed',
  chest: 'A chest: lungs, heart, spine and ribs',
  'shepp-logan-modified': 'The Shepp-Logan phantom (1974)',
  walnut: 'A walnut, 5 cm across',
  suitcase: 'A suitcase: a bottle, a laptop, keys and coins',
  'metal-implant': 'A hip with a metal implant',
};

export class HeroScene {
  constructor(o = {}) {
    this.list = o.list || HERO_LIST;
    this.n = o.n || 128;
    this.turn = o.turn || 9;     // seconds per rotation
    this.hold = o.hold || 3;
    this.idx = (o.start || 0) % this.list.length;
    this.cmap = o.cmap || 'bone';
    this.sinoMap = o.sinoMap || 'magma';
    this.load(this.idx);
  }
  load(i) {
    this.idx = i % this.list.length;
    this.name = this.list[this.idx];
    const ph = M.phantom(this.name, this.n);
    this.ph = ph;
    this.S = M.scanSet(ph.image, { kind: 'fan', nAngles: 360, key: 'hero-' + this.name, sodFactor: 0.56, radius: ph.image.width * 0.5 });
    this.rec = { nx: this.n, ny: this.n, width: ph.image.width, data: new Float32Array(this.n * this.n) };
    this.done = 0; this.t = 0;
    this.order = Array.from({ length: 360 }, (_, k) => k);
    const [, hi] = minmax(ph.image.data);
    this.hi = this.name.startsWith('shepp') ? 1 : Math.min(hi, M.MU_WATER * 2.2);
    if (this.name === 'metal-implant' || this.name === 'suitcase') this.hi = M.MU_WATER * 2.2;
    const [, shi] = minmax(this.S.sino.data);
    this.shi = shi;
    // pixels outside the scanned circle stay empty (transparent)
    const n = this.n, c = (n - 1) / 2;
    this.show = new Float32Array(n * n);
    this.outside = [];
    for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) if (Math.hypot(ix - c, iy - c) > n / 2) this.outside.push(iy * n + ix);
    this.show.set(ph.image.data);
    for (const i of this.outside) this.show[i] = NaN;
    this.rasP = new Raster(n, n).set(this.show, 0, this.hi, this.cmap);
    this.rasS = new Raster(360, this.S.geom.nDet);
    this.rasR = new Raster(n, n);
    this.tbuf = null;
  }
  get progress() { return clamp(this.t / this.turn, 0, 1); }
  height(w) { return w > 760 ? Math.round((w - 64) / 3.1 + 70) : Math.round(w * 1.25); }
  step(dt) {
    this.t += dt;
    if (this.t > this.turn + this.hold) { this.load(this.idx + 1); return; }
    const want = Math.floor(this.progress * 360);
    if (want > this.done) {
      M.bpAccum(this.S.q, this.S.geom, this.rec, this.order, this.done, want);
      this.done = want;
    }
  }
  frames(w, h) {
    if (w / h > 1.6) {
      const pad = 16, top = 26, s = Math.min(h - pad - top, (w - 4 * pad) / 3.1);
      const big = s;
      const x0 = (w - (big + 2 * s + 2 * pad)) / 2;
      return { gantry: { x: x0, y: top, w: big, h: big }, sino: { x: x0 + big + pad, y: top, w: s, h: s }, rec: { x: x0 + big + 2 * pad + s, y: top, w: s, h: s } };
    }
    const pad = 14, top = 24;
    const gs = Math.min(w - 2 * pad, h * 0.56);
    const s = Math.min((w - 3 * pad) / 2, h - gs - 2 * top - pad);
    return {
      gantry: { x: (w - gs) / 2, y: top - 6, w: gs, h: gs },
      sino: { x: (w - 2 * s - pad) / 2, y: gs + top + 16, w: s, h: s },
      rec: { x: (w + pad) / 2, y: gs + top + 16, w: s, h: s },
    };
  }
  render(g, w, h, o = {}) {
    const F = o.frames || this.frames(w, h);
    this.drawGantry(g, F.gantry, o);
    this.drawSino(g, F.sino, o);
    this.drawRecon(g, F.rec, o);
    return F;
  }
  drawGantry(g, r, o = {}) {
    const geom = this.S.geom, W = this.ph.image.width;
    const span = 2 * geom.sod * 1.08;
    const k = r.w / span, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const X = (x) => cx + x * k, Y = (y) => cy - y * k;
    const a = Math.min(359, this.done), b = geom.angles[a] + (this.done < 360 ? ((this.progress * 360) % 1) * (TAU / 360) : 0);
    // housing ring
    const R1 = geom.sod * 1.04 * k, R0 = geom.sod * 0.9 * k;
    const ring = g.createRadialGradient(cx, cy, R0, cx, cy, R1);
    ring.addColorStop(0, 'rgba(98,196,255,0.02)'); ring.addColorStop(0.5, 'rgba(160,180,220,0.08)'); ring.addColorStop(1, 'rgba(98,196,255,0.02)');
    g.fillStyle = ring; g.beginPath(); g.arc(cx, cy, R1, 0, TAU); g.arc(cx, cy, R0, 0, TAU, true); g.fill();
    g.strokeStyle = PAL.line2; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R1, 0, TAU); g.stroke();
    g.beginPath(); g.arc(cx, cy, R0, 0, TAU); g.stroke();
    // angle ticks
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let t = 0; t < 72; t++) {
      const q = (t / 72) * TAU, L = t % 6 ? 4 : 9;
      g.beginPath(); g.moveTo(cx + Math.cos(q) * R1, cy - Math.sin(q) * R1); g.lineTo(cx + Math.cos(q) * (R1 + L), cy - Math.sin(q) * (R1 + L)); g.stroke();
    }
    // the object
    const half = (W / 2) * k;
    this.rasP.draw(g, cx - half, cy - half, 2 * half, 2 * half);
    // swept arc
    if (this.done > 0 && this.done < 360) {
      g.strokeStyle = PAL.rayA + '0.55)'; g.lineWidth = 2;
      const s0 = geom.angles[0];
      g.beginPath(); g.arc(cx, cy, R1 + 12, -(s0 - Math.PI / 2), -(b - Math.PI / 2), true); g.stroke();
    }
    // source and detector positions (world): d = (-sin b, cos b), n = (cos b, sin b)
    const dX = -Math.sin(b), dY = Math.cos(b), nX = Math.cos(b), nY = Math.sin(b);
    const Sx = -geom.sod * dX, Sy = -geom.sod * dY;
    const nd = geom.nDet, row = Math.min(359, this.done) * nd;
    const sino = this.S.sino.data;
    // Rays end where they meet the detector ring (radius Rd, far side).
    // The engine's detector is flat and wider; the lines are the same rays.
    const Rd = geom.sod * 0.9;
    const hit = (u) => {
      let ex = geom.sdd * dX + u * nX, ey = geom.sdd * dY + u * nY;
      const l = Math.hypot(ex, ey); ex /= l; ey /= l;
      const bq = Sx * ex + Sy * ey, cq = Sx * Sx + Sy * Sy - Rd * Rd;
      const t = -bq + Math.sqrt(Math.max(0, bq * bq - cq));
      return [Sx + t * ex, Sy + t * ey];
    };
    const uOf = (i) => (i - (nd - 1) / 2) * geom.du;
    // fan rays: additive glow, brightness from transmission
    g.save(); g.globalCompositeOperation = 'lighter';
    const rays = o.rays || 48;
    for (let j = 0; j <= rays; j++) {
      const i = Math.round((j / rays) * (nd - 1));
      const [Dx, Dy] = hit(uOf(i));
      const p = sino[row + i] || 0;
      const T = Math.exp(-p * (this.name.startsWith('shepp') ? 1.2 : 0.9));
      g.strokeStyle = PAL.rayA + (0.05 + 0.35 * T).toFixed(3) + ')';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(Sx), Y(Sy)); g.lineTo(X(Dx), Y(Dy)); g.stroke();
    }
    g.restore();
    // detector cells on the ring, coloured by the measured value
    const cells = Math.min(nd, 72);
    for (let j = 0; j < cells; j++) {
      const i0 = Math.floor((j / cells) * nd), i1 = Math.floor(((j + 1) / cells) * nd);
      let p = 0; for (let i = i0; i < i1; i++) p += sino[row + i]; p /= Math.max(1, i1 - i0);
      const [cr, cg, cb] = sampleMap(this.sinoMap, p / (this.shi || 1));
      const [ax, ay] = hit(uOf(i0)), [bx, by] = hit(uOf(Math.min(nd - 1, i1)));
      const fa = 1.07, fb = 1.07;
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.beginPath();
      g.moveTo(X(ax), Y(ay)); g.lineTo(X(bx), Y(by)); g.lineTo(X(bx * fb), Y(by * fb)); g.lineTo(X(ax * fa), Y(ay * fa));
      g.closePath(); g.fill();
    }
    glow(g, X(Sx), Y(Sy), 16, '120,200,255', 1);
    if (!o.bare) {
      label(g, 'X-ray source', X(Sx) + (Sx > 0 ? -10 : 10), Y(Sy) + (Sy > 0 ? -14 : 22), { size: 11, color: PAL.ray, align: Sx > 0 ? 'right' : 'left', shadow: true });
      panel(g, r, null, { stroke: 'rgba(0,0,0,0)' });
      label(g, `gantry ${deg(b) % 360}°`, r.x + 4, r.y + 2, { size: 12, color: PAL.dim, base: 'top', font: MONO });
    }
  }
  drawSino(g, r, o = {}) {
    if (!this.tbuf) this.tbuf = new Float32Array(360 * this.S.geom.nDet);
    this.rasS.set(this.S.sino.data, 0, this.shi, this.sinoMap, { transpose: true, rows: this.done, tbuf: this.tbuf });
    g.fillStyle = '#080a10'; g.fillRect(r.x, r.y, r.w, r.h);
    this.rasS.draw(g, r.x, r.y, r.w, r.h);
    const cx = r.x + (this.done / 360) * r.w;
    if (this.done < 360) {
      g.strokeStyle = PAL.ray; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx, r.y); g.lineTo(cx, r.y + r.h); g.stroke();
    }
    if (!o.bare) {
      panel(g, r, r.w < 240 ? 'sinogram' : 'sinogram: one column per view');
      label(g, '0°', r.x, r.y + r.h + 14, { size: 11, color: PAL.dim, font: MONO });
      label(g, '360°', r.x + r.w, r.y + r.h + 14, { size: 11, color: PAL.dim, font: MONO, align: 'right' });
    }
  }
  drawRecon(g, r, o = {}) {
    this.show.set(this.rec.data);
    for (const i of this.outside) this.show[i] = NaN;
    this.rasR.set(this.show, 0, this.hi, this.cmap);
    g.fillStyle = '#080a10'; g.fillRect(r.x, r.y, r.w, r.h);
    this.rasR.draw(g, r.x, r.y, r.w, r.h);
    if (!o.bare) {
      panel(g, r, r.w < 240 ? `image · ${this.done}/360` : `filtered back-projection: ${this.done} of 360 views`);
      if (this.done >= 360) label(g, HERO_TEXT[this.name] || '', r.x + r.w / 2, r.y + r.h + 16, { size: 12, color: PAL.ink2, align: 'center' });
    }
  }
}

// 64-step colour lookup for the detector cells.
const mapCache = new Map();
function sampleMap(id, t) {
  let lut = mapCache.get(id);
  if (!lut) { lut = []; for (let i = 0; i < 64; i++) lut.push(CM.sample(id, i / 63)); mapCache.set(id, lut); }
  return lut[Math.max(0, Math.min(63, Math.round((Number.isFinite(t) ? t : 0) * 63)))];
}

// ---------------------------------------------------------------------------
// 1 · BEER-LAMBERT: photons cross one row of the head. Each pixel removes
// photons with probability 1 - exp(-mu dx). The plots show mu along the
// row and the surviving fraction I/I0 = exp(-integral mu dx).
// ---------------------------------------------------------------------------
export class BeerScene {
  constructor(o = {}) {
    this.n = 128;
    this.ph = M.phantom(o.phantom || 'head', this.n);
    this.ras = new Raster(this.n, this.n).set(this.ph.image.data, 0, M.MU_WATER * 2, 'bone');
    this.row = 0.42; this.auto = true; this.idle = 0; this.t = 0;
    this.parts = []; this.sent = 0; this.got = 0; this.rng = 1;
    this.setRow(this.row);
  }
  height(w) { return w > 700 ? Math.round(w * 0.46) : Math.round(w * 1.3); }
  setRow(f) {
    this.row = clamp(f, 0.02, 0.98);
    this.iy = Math.round(this.row * (this.n - 1));
    this.B = M.beamRow(this.ph.image, this.iy);
    this.sent = 0; this.got = 0;
  }
  rand() { this.rng = (this.rng * 1664525 + 1013904223) >>> 0; return this.rng / 4294967296; }
  step(dt) {
    this.t += dt; this.idle += dt;
    if (this.auto && this.idle > 4) {
      const f = 0.5 + 0.36 * Math.sin(this.t * 0.18);
      if (Math.abs(f - this.row) > 0.01) this.setRow(f);
    }
    const n = this.n, px = this.ph.image.width / n;
    for (let s = 0; s < 6; s++) { this.parts.push({ x: -2 - this.rand() * 3, j: (this.rand() - 0.5) * 1.6 }); this.sent++; }
    const v = 60 * dt;   // pixels per frame step
    for (const p of this.parts) {
      if (p.dead) continue;
      const x0 = p.x, x1 = p.x + v;
      for (let ix = Math.max(0, Math.ceil(x0)); ix < Math.min(n, x1); ix++) {
        const mu = this.B.mu[ix];
        if (this.rand() < 1 - Math.exp(-mu * px)) { p.dead = true; p.dx = ix; p.age = 0; break; }
      }
      if (!p.dead) { p.x = x1; if (p.x >= n && !p.counted) { p.counted = true; this.got++; } }
    }
    for (const p of this.parts) if (p.dead) p.age = (p.age || 0) + dt;
    this.parts = this.parts.filter((p) => (p.dead ? p.age < 0.35 : p.x < n + 30));
    if (this.sent > 4000) { this.sent = Math.round(this.sent / 2); this.got = Math.round(this.got / 2); }
  }
  frames(w, h) {
    if (w / h > 1.4) {
      const top = 26, s = h - top - 14;
      return { img: { x: 18, y: top, w: s, h: s }, mu: { x: s + 60, y: top, w: w - s - 80, h: s * 0.42 }, I: { x: s + 60, y: top + s * 0.58, w: w - s - 80, h: s * 0.42 } };
    }
    const s = Math.min(w - 36, h * 0.55), top = 24;
    const ph = (h - s - top - 3 * 30) / 2;
    return { img: { x: (w - s) / 2, y: top, w: s, h: s }, mu: { x: 40, y: s + top + 36, w: w - 58, h: ph }, I: { x: 40, y: s + top + 36 + ph + 34, w: w - 58, h: ph } };
  }
  pointer(e) {
    const r = this.F && this.F.img;
    if (!r) return;
    if (e.type === 'down' || (e.type === 'move' && e.buttons)) {
      if (e.x >= r.x - 20 && e.x <= r.x + r.w + 20 && e.y >= r.y && e.y <= r.y + r.h) {
        this.setRow((e.y - r.y) / r.h); this.idle = 0; return true;
      }
    }
    return false;
  }
  render(g, w, h) {
    const F = this.F = this.frames(w, h), r = F.img, n = this.n;
    this.ras.draw(g, r.x, r.y, r.w, r.h);
    panel(g, r, 'drag up or down to move the beam');
    const y = r.y + (this.iy + 0.5) * (r.h / n);
    // beam band
    g.fillStyle = PAL.rayA + '0.10)'; g.fillRect(r.x - 14, y - 4, r.w + 28, 8);
    // photons
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      const px = r.x + (p.x / n) * r.w, py = y + p.j * 2;
      if (p.dead) {
        const a = 1 - p.age / 0.35;
        g.fillStyle = PAL.amberA + (0.8 * a).toFixed(3) + ')';
        g.beginPath(); g.arc(r.x + (p.dx / n) * r.w, py, 1.5 + 3 * (1 - a), 0, TAU); g.fill();
      } else {
        g.fillStyle = 'rgba(160,220,255,0.9)';
        g.fillRect(px - 1.5, py - 1, 3, 2);
      }
    }
    g.restore();
    glow(g, r.x - 14, y, 9, '120,200,255', 0.9);
    g.fillStyle = '#1b2233'; g.fillRect(r.x + r.w + 8, y - 9, 6, 18);
    // plots
    const B = this.B;
    const [, muMax] = minmax(B.mu);
    const muTop = Math.max(0.5, muMax * 1.1);
    panel(g, F.mu, null);
    plot(g, F.mu, B.mu, { lo: 0, hi: muTop, color: PAL.amber, fill: PAL.amberA + '0.18)' });
    label(g, 'μ(x), attenuation along the beam (1/cm)', F.mu.x, F.mu.y - 8, { size: 12, color: PAL.amber });
    label(g, muTop.toFixed(2), F.mu.x - 6, F.mu.y + 10, { size: 10, color: PAL.dim, align: 'right', font: MONO });
    label(g, '0', F.mu.x - 6, F.mu.y + F.mu.h, { size: 10, color: PAL.dim, align: 'right', font: MONO });
    panel(g, F.I, null);
    plot(g, F.I, B.I, { lo: 0, hi: 1, color: PAL.ray, lw: 2 });
    label(g, 'I(x) / I₀, photons still in the beam', F.I.x, F.I.y - 8, { size: 12, color: PAL.ray });
    label(g, '1', F.I.x - 6, F.I.y + 10, { size: 10, color: PAL.dim, align: 'right', font: MONO });
    label(g, '0', F.I.x - 6, F.I.y + F.I.h, { size: 10, color: PAL.dim, align: 'right', font: MONO });
    const pEnd = B.p[n], IEnd = B.I[n];
    const meas = this.sent > 50 ? this.got / this.sent : NaN;
    label(g, `∫μ dx = ${pEnd.toFixed(2)}    e^(−∫μ dx) = ${IEnd < 0.01 ? IEnd.toExponential(1) : IEnd.toFixed(3)}`, F.I.x + F.I.w, F.I.y + F.I.h + 18, { size: 12, color: PAL.ink2, align: 'right', font: MONO });
    if (Number.isFinite(meas)) label(g, `counted: ${this.got} of ${this.sent} = ${meas.toFixed(3)}`, F.I.x, F.I.y + F.I.h + 18, { size: 12, color: PAL.dim, font: MONO });
  }
}

// ---------------------------------------------------------------------------
// 2 · ONE PROJECTION: parallel rays at angle b. The detector reads one line
// integral per ray, so the profile is p(b, s). One ray is picked out.
// ---------------------------------------------------------------------------
export class ProjScene {
  constructor(o = {}) {
    this.n = 128;
    this.set('phantom', o.phantom || 'shepp-logan-modified');
    this.b = 0.5; this.spin = 0.22; this.idle = 9; this.s0 = 0.28;
  }
  set(k, v) {
    if (k === 'phantom') {
      this.name = v;
      this.ph = M.phantom(v, this.n);
      const [, hi] = minmax(this.ph.image.data);
      this.hi = v.startsWith('shepp') ? 1 : Math.min(hi, M.MU_WATER * 2);
      this.ras = new Raster(this.n, this.n).set(this.ph.image.data, 0, this.hi, 'bone');
      const v0 = M.oneView(this.ph.image, 0.0), v1 = M.oneView(this.ph.image, Math.PI / 2);
      this.pmax = Math.max(...v0.data, ...v1.data) * 1.08;
    }
  }
  height(w) { return w > 700 ? Math.round(w * 0.5) : Math.round(w * 1.05); }
  step(dt) {
    this.idle += dt;
    if (this.idle > 3) this.b = (this.b + dt * this.spin) % TAU;
    this.V = M.oneView(this.ph.image, this.b);
  }
  pointer(e) {
    if (!this.map || !(e.type === 'down' || (e.type === 'move' && e.buttons))) return false;
    const { X, Y, k } = this.map;
    const wx = (e.x - X(0)) / k, wy = (Y(0) - e.y) / k;
    if (Math.hypot(wx, wy) > this.W * 0.95) return false;
    this.b = Math.atan2(wy, wx) + Math.PI / 2;
    this.idle = 0;
    return true;
  }
  render(g, w, h) {
    if (!this.V) this.step(0);
    const W = this.W = this.ph.image.width, b = this.b;
    const span = W * 2.15, s = Math.min(w - 24, h - 24);
    const r = { x: (w - s) / 2, y: (h - s) / 2, w: s, h: s };
    const map = this.map = worldMap(r, span);
    const { X, Y, k } = map;
    const half = (W / 2) * k;
    this.ras.draw(g, X(0) - half, Y(0) - half, 2 * half, 2 * half);
    const dX = -Math.sin(b), dY = Math.cos(b), nX = Math.cos(b), nY = Math.sin(b);
    const R0 = W * 0.62, L = W * 0.72;
    // rays
    g.save(); g.globalCompositeOperation = 'lighter';
    const geom = this.V.geom, nd = geom.nDet;
    for (let j = 0; j <= 28; j++) {
      const u = -L + (2 * L * j) / 28;
      g.strokeStyle = PAL.rayA + '0.12)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(u * nX - R0 * dX), Y(u * nY - R0 * dY)); g.lineTo(X(u * nX + R0 * dX), Y(u * nY + R0 * dY)); g.stroke();
    }
    // picked ray
    const u0 = this.s0 * W / 2;
    g.strokeStyle = PAL.yellow; g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(u0 * nX - R0 * dX), Y(u0 * nY - R0 * dY)); g.lineTo(X(u0 * nX + R0 * dX), Y(u0 * nY + R0 * dY)); g.stroke();
    g.restore();
    // source bar
    g.strokeStyle = PAL.ray; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X(-L * nX - R0 * dX), Y(-L * nY - R0 * dY)); g.lineTo(X(L * nX - R0 * dX), Y(L * nY - R0 * dY)); g.stroke();
    // detector bar
    g.strokeStyle = '#cfd6e6'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X(-L * nX + R0 * dX), Y(-L * nY + R0 * dY)); g.lineTo(X(L * nX + R0 * dX), Y(L * nY + R0 * dY)); g.stroke();
    // profile, drawn outward from the detector
    const H = W * 0.36;
    g.beginPath();
    let first = true;
    for (let i = 0; i < nd; i++) {
      const u = (i - (nd - 1) / 2) * geom.du;
      if (Math.abs(u) > L) continue;
      const v = (this.V.data[i] / this.pmax) * H;
      const x = u * nX + (R0 + 0.03 * W + v) * dX, y = u * nY + (R0 + 0.03 * W + v) * dY;
      if (first) { g.moveTo(X(x), Y(y)); first = false; } else g.lineTo(X(x), Y(y));
    }
    g.strokeStyle = PAL.amber; g.lineWidth = 2; g.stroke();
    // value of the picked ray
    const fi = u0 / geom.du + (nd - 1) / 2, i0 = Math.floor(fi), t = fi - i0;
    const pv = (1 - t) * this.V.data[i0] + t * this.V.data[i0 + 1];
    const vx = u0 * nX + (R0 + 0.03 * W + (pv / this.pmax) * H) * dX, vy = u0 * nY + (R0 + 0.03 * W + (pv / this.pmax) * H) * dY;
    g.fillStyle = PAL.yellow; g.beginPath(); g.arc(X(vx), Y(vy), 4, 0, TAU); g.fill();
    label(g, `p(θ, s) = ${pv.toFixed(2)}`, X(vx) + 8, Y(vy) - 8, { size: 13, color: PAL.yellow, font: MONO, shadow: true });
    label(g, `θ = ${deg(((b % TAU) + TAU) % TAU)}°`, r.x + 6, r.y + 16, { size: 12, color: PAL.dim, font: MONO });
    label(g, 'drag around the object to turn the beam', r.x + r.w - 6, r.y + r.h - 6, { size: 11, color: PAL.dim, align: 'right' });
  }
}

// ---------------------------------------------------------------------------
// 3 · THE SINOGRAM: the beam turns from 0 to 180 degrees and each view
// becomes one column. A bright point (tap to move it) traces the sine
// s = x cos b + y sin b, which the overlay draws.
// ---------------------------------------------------------------------------
export class SinoScene {
  constructor(o = {}) {
    this.n = 128; this.views = 180; this.dur = 7; this.hold = 2;
    this.pt = [0.42, 0.3]; this.base = o.phantom || 'shepp-logan-modified'; this.t = 0;
    this.build();
  }
  set(k, v) { if (k === 'phantom') { this.base = v; this.build(); } }
  build() {
    const n = this.n;
    let img;
    if (this.base === 'point') img = M.pointImage(n, [this.pt], { v: 1 });
    else {
      const ph = M.phantom(this.base, n);
      const dot = M.pointImage(n, [this.pt], { v: 1.2 });
      img = { ...ph.image, data: ph.image.data.map((x, i) => x + dot.data[i]) };
    }
    this.img = img;
    this.S = M.scanSet(img, { nAngles: this.views });
    this.shi = minmax(this.S.sino.data)[1];
    this.rasP = new Raster(n, n).set(img.data, 0, this.base === 'point' ? 1 : 1.05, 'bone');
    this.rasS = new Raster(this.views, this.S.geom.nDet);
    this.tbuf = new Float32Array(this.views * this.S.geom.nDet);
  }
  height(w) { return w > 700 ? Math.round(w * 0.44) : Math.round(w * 1.55); }
  get shown() { return Math.min(this.views, Math.floor((this.t / this.dur) * this.views)); }
  step(dt) { this.t += dt; if (this.t > this.dur + this.hold) this.t = 0; }
  pointer(e) {
    if (e.type !== 'down' || !this.F) return false;
    const r = this.F.img;
    if (e.x < r.x || e.x > r.x + r.w || e.y < r.y || e.y > r.y + r.h) return false;
    const W = this.img.width;
    this.pt = [((e.x - r.x) / r.w - 0.5) * W, (0.5 - (e.y - r.y) / r.h) * W];
    this.build(); this.t = 0;
    return true;
  }
  render(g, w, h) {
    const wide = w / h > 1.3;
    const top = 26;
    let F;
    if (wide) {
      const s = h - top - 30;
      F = { img: { x: 16, y: top, w: s, h: s }, sino: { x: s + 46, y: top, w: w - s - 62, h: s } };
    } else {
      const s = Math.min(w - 32, (h - 2 * top - 40) / 2);
      F = { img: { x: (w - s) / 2, y: top, w: s, h: s }, sino: { x: 16, y: top * 2 + s + 6, w: w - 32, h: s } };
    }
    this.F = F;
    const r = F.img, W = this.img.width, k = this.shown;
    const b = this.S.geom.angles[Math.min(this.views - 1, k)] ?? 0;
    this.rasP.draw(g, r.x, r.y, r.w, r.h);
    panel(g, r, this.base === 'point' ? 'a single point' : 'object + one bright point (tap to move it)');
    // beam direction over the object
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, kk = r.w / W;
    const dX = -Math.sin(b), dY = Math.cos(b), nX = Math.cos(b), nY = Math.sin(b);
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    g.globalCompositeOperation = 'lighter';
    for (let j = -10; j <= 10; j++) {
      const u = (j / 10) * W * 0.7;
      g.strokeStyle = PAL.rayA + '0.10)';
      g.beginPath(); g.moveTo(cx + (u * nX - W * dX) * kk, cy - (u * nY - W * dY) * kk); g.lineTo(cx + (u * nX + W * dX) * kk, cy - (u * nY + W * dY) * kk); g.stroke();
    }
    g.restore();
    // the point and its ray
    const [px, py] = this.pt, sPt = px * nX + py * nY;
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    g.strokeStyle = PAL.amber; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx + (sPt * nX - W * dX) * kk, cy - (sPt * nY - W * dY) * kk); g.lineTo(cx + (sPt * nX + W * dX) * kk, cy - (sPt * nY + W * dY) * kk); g.stroke();
    g.beginPath(); g.arc(cx + px * kk, cy - py * kk, 7, 0, TAU); g.stroke();
    g.restore();
    // sinogram
    const S = F.sino;
    g.fillStyle = '#080a10'; g.fillRect(S.x, S.y, S.w, S.h);
    this.rasS.set(this.S.sino.data, 0, this.shi, 'magma', { transpose: true, rows: k, tbuf: this.tbuf });
    this.rasS.draw(g, S.x, S.y, S.w, S.h);
    panel(g, S, 'sinogram p(θ, s): angle θ across, detector position s up');
    // the sine of the point, through the revealed part
    const nd = this.S.geom.nDet, du = this.S.geom.du;
    const sy = (s) => S.y + S.h - ((s / du + (nd - 1) / 2 + 0.5) / nd) * S.h;
    g.strokeStyle = PAL.amberA + '0.9)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
    g.beginPath();
    for (let a = 0; a <= Math.max(1, k); a++) {
      const bb = (a / this.views) * Math.PI, s = px * Math.cos(bb) + py * Math.sin(bb);
      const x = S.x + (a / this.views) * S.w;
      if (a) g.lineTo(x, sy(s)); else g.moveTo(x, sy(s));
    }
    g.stroke(); g.setLineDash([]);
    if (k < this.views) {
      const x = S.x + (k / this.views) * S.w;
      g.strokeStyle = PAL.ray; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, S.y); g.lineTo(x, S.y + S.h); g.stroke();
    }
    label(g, '0°', S.x, S.y + S.h + 15, { size: 11, color: PAL.dim, font: MONO });
    label(g, '90°', S.x + S.w / 2, S.y + S.h + 15, { size: 11, color: PAL.dim, font: MONO, align: 'center' });
    label(g, '180°', S.x + S.w, S.y + S.h + 15, { size: 11, color: PAL.dim, font: MONO, align: 'right' });
    label(g, `s = x cos θ + y sin θ`, S.x + S.w - 8, S.y + 18, { size: 13, color: PAL.amber, font: SERIF, align: 'right', shadow: true });
  }
}

// ---------------------------------------------------------------------------
// 4 · PLAIN BACK-PROJECTION: smear each view back along its rays and add.
// A point becomes a star, then a blur that falls off as 1/r.
// ---------------------------------------------------------------------------
export class BPScene {
  constructor(o = {}) {
    this.n = 128; this.views = 180; this.t = 0; this.dur = 9; this.hold = 2.5;
    this.set('object', o.object || 'point');
  }
  set(k, v) {
    if (k !== 'object') return;
    this.obj = v;
    const n = this.n;
    this.img = v === 'point' ? M.pointImage(n, [[0, 0]], { r: 0.03 }) : M.phantom('shepp-logan-modified', n).image;
    this.S = M.scanSet(this.img, { nAngles: this.views, key: 'bp-' + v });
    this.order = M.viewOrder(this.views);
    this.reset();
  }
  reset() {
    const n = this.n;
    this.acc = { nx: n, ny: n, width: this.img.width, data: new Float32Array(n * n) };
    this.one = { nx: n, ny: n, width: this.img.width, data: new Float32Array(n * n) };
    this.done = 0; this.t = 0;
    this.rasA = new Raster(n, n); this.rasO = new Raster(n, n);
  }
  height(w) { return w > 700 ? Math.round(w * 0.4) : Math.round(w * 2.2); }
  target() { const k = clamp(this.t / this.dur, 0, 1); return Math.max(1, Math.round(this.views * k * k)); }
  step(dt) {
    this.t += dt;
    if (this.t > this.dur + this.hold) { this.reset(); }
    const want = this.target();
    if (want > this.done) {
      M.bpAccum(this.S.sino, this.S.geom, this.acc, this.order, this.done, want);
      this.one.data.fill(0);
      M.bpAccum(this.S.sino, this.S.geom, this.one, this.order, want - 1, want);
      this.done = want;
    }
  }
  render(g, w, h) {
    const R = layout(w, h, 3, { top: 24 });
    const n = this.n;
    const [, oh] = minmax(this.one.data), [, ah] = minmax(this.acc.data);
    this.rasO.set(this.one.data, 0, oh || 1, 'bone');
    this.rasA.set(this.acc.data, 0, ah || 1, 'bone', { gamma: this.obj === 'point' ? 0.55 : 1 });
    this.rasO.draw(g, R[0].x, R[0].y, R[0].w, R[0].h);
    panel(g, R[0], 'one view, smeared back');
    this.rasA.draw(g, R[1].x, R[1].y, R[1].w, R[1].h);
    panel(g, R[1], `sum of ${this.done} view${this.done > 1 ? 's' : ''}`);
    // profile through the centre row
    const P = R[2];
    panel(g, P, this.obj === 'point' ? 'profile through the point' : 'profile through the centre');
    const row = this.acc.data.slice((n >> 1) * n, (n >> 1) * n + n);
    const [, rh] = minmax(row);
    if (this.obj === 'point') {
      // 1/r reference, scaled to match at 8 pixels out
      const ref = new Float32Array(n), c = n / 2 - 0.5, at = Math.round(c + 8);
      for (let i = 0; i < n; i++) ref[i] = 1 / Math.max(0.6, Math.abs(i - c));
      const sc = row[at] / ref[at];
      for (let i = 0; i < n; i++) ref[i] *= sc;
      plot(g, inset(P), ref, { lo: 0, hi: rh || 1, color: PAL.dim, dash: [4, 4], lw: 1.2 });
      label(g, '1/r', P.x + P.w * 0.72, P.y + P.h * 0.78, { size: 14, color: PAL.dim, font: SERIF });
    } else {
      const tr = this.img.data.slice((n >> 1) * n, (n >> 1) * n + n);
      plot(g, inset(P), tr, { lo: 0, hi: 1.05, color: PAL.dim, dash: [4, 4], lw: 1.2 });
      const sc = new Float32Array(n), [, th] = minmax(tr);
      for (let i = 0; i < n; i++) sc[i] = (row[i] / (rh || 1)) * th;
      plot(g, inset(P), sc, { lo: 0, hi: 1.05, color: PAL.amber, lw: 2 });
      return;
    }
    plot(g, inset(P), row, { lo: 0, hi: rh || 1, color: PAL.amber, lw: 2 });
  }
}
function inset(r, p = 10) { return { x: r.x + p, y: r.y + p, w: r.w - 2 * p, h: r.h - 2 * p }; }

// ---------------------------------------------------------------------------
// 5 · FOURIER SLICE: the 1D Fourier transform of each view is one line of
// the image's 2D Fourier transform, through the centre, at the view angle.
// ---------------------------------------------------------------------------
export class FourierScene {
  constructor() {
    this.n = 128; this.views = 180; this.dur = 9; this.hold = 3; this.t = 0;
    const ph = M.phantom('shepp-logan-modified', this.n);
    this.img = ph.image;
    this.S = M.scanSet(this.img, { nAngles: this.views, key: 'fourier' });
    this.F2 = M.fft2Mag(this.img);
    this.hi = minmax(this.F2.data)[1];
    this.rasI = new Raster(this.n, this.n).set(this.img.data, 0, 1, 'bone');
    this.rasF = new Raster(this.F2.n, this.F2.n).set(this.F2.data, 0, this.hi, 'magma');
    this.rasK = new Raster(this.F2.n, this.F2.n);
    this.order = M.viewOrder(this.views);
    this.reset();
  }
  reset() {
    const m = this.F2.n;
    this.grid = new Float32Array(m * m); this.cnt = new Uint16Array(m * m); this.done = 0; this.t = 0;
    this.show = new Float32Array(m * m);
  }
  height(w) { return w > 700 ? Math.round(w * 0.4) : Math.round(w * 2.2); }
  target() { const k = clamp(this.t / this.dur, 0, 1); return Math.max(1, Math.round(this.views * k * k)); }
  step(dt) {
    this.t += dt;
    if (this.t > this.dur + this.hold) this.reset();
    const want = this.target(), nd = this.S.geom.nDet, px = this.img.width / this.n;
    while (this.done < want) {
      const a = this.order[this.done];
      M.kSlice(this.S.sino.data.subarray(a * nd, (a + 1) * nd), this.S.geom.du, this.S.geom.angles[a], px, this.grid, this.cnt, this.F2.n);
      this.done++;
    }
    this.cur = this.order[Math.max(0, this.done - 1)];
  }
  render(g, w, h) {
    const R = layout(w, h, 3, { top: 24 });
    for (let i = 0; i < this.grid.length; i++) this.show[i] = this.cnt[i] ? this.grid[i] : NaN;
    this.rasK.set(this.show, 0, this.hi, 'magma');
    const b = this.S.geom.angles[this.cur ?? 0];
    // object with the current projection direction
    this.rasI.draw(g, R[0].x, R[0].y, R[0].w, R[0].h);
    panel(g, R[0], 'object and the current view');
    const c0 = { x: R[0].x + R[0].w / 2, y: R[0].y + R[0].h / 2 }, L = R[0].w * 0.48;
    const nX = Math.cos(b), nY = Math.sin(b), dX = -nY, dY = nX;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let j = -6; j <= 6; j++) {
      const u = (j / 6) * L * 0.95;
      g.strokeStyle = PAL.rayA + '0.14)';
      g.beginPath(); g.moveTo(c0.x + u * nX - L * dX, c0.y - (u * nY - L * dY)); g.lineTo(c0.x + u * nX + L * dX, c0.y - (u * nY + L * dY)); g.stroke();
    }
    g.restore();
    g.strokeStyle = PAL.amber; g.lineWidth = 2;
    g.beginPath(); g.moveTo(c0.x - L * nX, c0.y + L * nY); g.lineTo(c0.x + L * nX, c0.y - L * nY); g.stroke();
    // k-space being filled
    g.fillStyle = '#080a10'; g.fillRect(R[1].x, R[1].y, R[1].w, R[1].h);
    this.rasK.draw(g, R[1].x, R[1].y, R[1].w, R[1].h, false);
    panel(g, R[1], `k-space from ${this.done} view${this.done > 1 ? 's' : ''}`);
    const c1 = { x: R[1].x + R[1].w / 2, y: R[1].y + R[1].h / 2 }, L1 = R[1].w * 0.5;
    g.strokeStyle = PAL.amber; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(c1.x - L1 * nX, c1.y + L1 * nY); g.lineTo(c1.x + L1 * nX, c1.y - L1 * nY); g.stroke();
    // reference spectrum
    this.rasF.draw(g, R[2].x, R[2].y, R[2].w, R[2].h, false);
    panel(g, R[2], '2D Fourier transform of the object');
    label(g, 'kₓ', R[2].x + R[2].w - 6, R[2].y + R[2].h / 2 - 6, { size: 13, color: PAL.ink2, font: SERIF, align: 'right' });
    label(g, 'k_y', R[2].x + R[2].w / 2 + 6, R[2].y + 16, { size: 13, color: PAL.ink2, font: SERIF });
  }
}
