// ============================================================================
//  CT LAB SAVER  ·  shots.js — the shot kinds (no DOM; canvases are injected)
// ----------------------------------------------------------------------------
//  makeShot(spec, env) -> shot. spec comes from plan.js (kind, dur, seed).
//  env = { phone, makeCanvas(w, h), lab, make3D, now() }:
//    makeCanvas  makes an offscreen 2D canvas (raster layers)
//    lab         window.__ctlab (LAB-API.md), or null
//    make3D      async (opts) -> { view, release() } for view3d, or null
//
//  A shot has:
//    init()            async, builds the data (engine work, lab preset, 3D)
//    step(dt)          advances time and work (per frame, small budgets)
//    draw(g, stage)    draws in stage CSS px (stage = the plate clear band)
//    cam               a 2D spring camera (plan.js cam2d), null for 3D shots
//    focus(stage)      the rect the camera aims at now, and its zoom
//    subject           the last drawn subject rect (the plate anchor)
//    plate()           { title, sub, tex, rules, params, lines } (TeX, no code)
//    dispose()         drops buffers, stops the lab, releases the 3D device
//
//  2D kinds compute with the engine: sine, smear, fourier, iterate, sparse,
//  dose. Lab kinds drive the lab page through window.__ctlab and draw its
//  panel canvases: gantry, artefacts, reveal. 3D kinds drive view3d:
//  cone-scan, cone-volume.
//
//  GREP MAP
//    grep -n 'function shot[A-Z]'     one factory per kind
//    grep -n 'const TEX'               the equations on the plate
//    grep -n 'class Layer'             raster layer: colour map -> canvas
//    grep -n 'function frameBox'       panel frame and caption
//    grep -n 'MAIN'                    the shot colour map, its cross-fade, the plate name
//
//  COLOUR  plan.js gives spec.cmap (and spec.cmap2, spec.fadeAt for a cross-
//  fade, spec.dmap for an error panel). A layer painted with MAIN uses the
//  shot map. During a cross-fade, base.tick() repaints those layers with
//  CM.blend(cmap, cmap2, k), and 3D shots send the blended LUT to view3d.
//  makeShot() adds the map name to every plate.
// ============================================================================
import {
  phantom2D, PHANTOMS_2D, fitGeometry, sparseAngles, forwardProject, backProject, fbpBackProject,
  filterSinogram, angleWeights, createSolver, transmit, poissonNoise, toLineIntegral, fft,
  filterResponse, muAt, psnr, mulberry32,
} from '../engine/index.js';
import * as CM from '../colormaps/maps.js';
import { rng, pick, cam2d, aimCam, fitPanels, smooth, clamp } from './plan.js';

const TAU = Math.PI * 2;
const MU_W = muAt('water', 70);
const hu = (L, W) => [MU_W * (1 + (L - W / 2) / 1000), MU_W * (1 + (L + W / 2) / 1000)];
const INK = ['#62c4ff', '#ff9a62', '#86dc7c', '#e889dc', '#ffd666', '#a8a4ff'];
const CREDIT = 'Our own code, after the ASTRA Toolbox (van Aarle et al. 2015, 2016)';

export const TEX = {
  radon: 'p(\\theta,s)=\\int\\!\\!\\int \\mu(x,y)\\,\\delta(x\\cos\\theta+y\\sin\\theta-s)\\,dx\\,dy',
  sine: 's(\\theta)=x_0\\cos\\theta+y_0\\sin\\theta',
  slice: '\\hat p_\\theta(\\omega)=\\hat\\mu(\\omega\\cos\\theta,\\,\\omega\\sin\\theta)',
  fbp: '\\mu(x,y)=\\int_0^{\\pi}(p_\\theta * h)(x\\cos\\theta+y\\sin\\theta)\\,d\\theta,\\quad \\hat h(\\omega)=|\\omega|',
  sirt: 'x^{k+1}=x^k+\\lambda\\,C A^{\\mathsf T} R\\,(b-Ax^k)',
  cgls: '\\min_{x}\\;\\lVert Ax-b\\rVert_2^2 \\;\\Rightarrow\\; A^{\\mathsf T}\\!A\\,x=A^{\\mathsf T} b',
  beer: 'I=I_0\\,e^{-\\int_L \\mu\\,dl}',
  sampling: 'N_\\theta \\ge \\tfrac{\\pi}{2}\\,N_{\\mathrm{det}}',
  fdk: 'w(u,v)=\\frac{D}{\\sqrt{D^2+u^2+v^2}}',
  hu: '\\mathrm{HU}=1000\\,\\frac{\\mu-\\mu_{\\mathrm{water}}}{\\mu_{\\mathrm{water}}}',
};
const RULES = [['\\mu', 'm2'], ['p', 'm1'], ['\\theta', 'm5'], ['h', 'm3'], ['I_0', 'm5'], ['x^k', 'm1'], ['w', 'm3']];

// Display windows (lo, hi in phantom units) per 2D phantom.
const WIN = {
  'shepp-logan-modified': [0.08, 0.5],
  head: hu(70, 260), chest: hu(-250, 1500), walnut: [0, 0.62], suitcase: [0, 0.9],
  'contrast-detail': hu(40, 160), bars: hu(250, 1400), 'metal-implant': hu(150, 1400),
};
const label2D = (key) => (PHANTOMS_2D.find((p) => p.key === key) || { label: key }).label;

// spin-up: speed rises linearly over the first part a, then holds; p(1) = 1.
export function spin(u, a = 0.3) {
  const x = clamp(u, 0, 1);
  return (x < a ? (x * x) / (2 * a) : a / 2 + (x - a)) / (1 - a / 2);
}

// ---------- raster layer ----------
// paint(..., MAIN) uses the shot map (resolve() -> [id, opts]) and keeps a copy of the
// data, so a cross-fade can repaint the layer.
const MAIN = '@main';
const FADE_T = 1.6;   // seconds of a cross-fade
class Layer {
  constructor(mk, nx, ny, resolve) {
    this.nx = nx; this.ny = ny; this.resolve = resolve; this.main = null;
    this.cv = mk(nx, ny); this.g = this.cv.getContext('2d');
    this.id = this.g.createImageData(nx, ny);
  }
  paint(data, lo, hi, cmap, opts) {
    if (cmap === MAIN) {
      this.main = { data: this.main && this.main.data.length === data.length ? (this.main.data.set(data), this.main.data) : Float32Array.from(data), lo, hi };
      [cmap, opts] = this.resolve();
    }
    CM.apply(cmap, data, lo, hi, this.id.data, opts); this.g.putImageData(this.id, 0, 0); return this;
  }
  repaint() { const m = this.main; if (m && this.id) { const [c, o] = this.resolve(); CM.apply(c, m.data, m.lo, m.hi, this.id.data, o); this.g.putImageData(this.id, 0, 0); } }
  draw(g, r, alpha = 1) {
    if (alpha <= 0) return;
    g.save(); g.globalAlpha *= alpha;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(this.cv, r.x, r.y, r.w, r.h);
    g.restore();
  }
  drop() { this.cv.width = this.cv.height = 1; this.id = null; }
}

// ---------- drawing helpers ----------
export function frameBox(g, r, caption, o = {}) {
  const c = o.color || 'rgba(170,196,232,0.42)', k = Math.min(16, r.w * 0.08);
  g.save();
  g.strokeStyle = c; g.lineWidth = 1.2; g.beginPath();
  for (const [x, y, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
    g.moveTo(x + sx * k, y); g.lineTo(x, y); g.lineTo(x, y + sy * k);
  }
  g.stroke();
  if (caption) {
    g.font = '600 10px Inter, system-ui, sans-serif';
    if ('letterSpacing' in g) g.letterSpacing = '2.4px';
    g.fillStyle = 'rgba(200,214,236,0.62)'; g.textBaseline = 'bottom'; g.textAlign = 'left';
    g.fillText(caption.toUpperCase(), r.x, r.y - 6);
    if (o.right) { g.textAlign = 'right'; g.fillStyle = o.rightColor || 'rgba(255,214,102,0.85)'; g.fillText(o.right, r.x + r.w, r.y - 6); }
  }
  g.restore();
}
function glowLine(g, pts, color, w = 2) {
  if (pts.length < 2) return;
  g.save(); g.strokeStyle = color; g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [lw, a] of [[w * 4, 0.12], [w * 2, 0.25], [w, 1]]) {
    g.globalAlpha = a; g.lineWidth = lw; g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }
  g.restore();
}
function dot(g, x, y, r, color) {
  g.save(); g.fillStyle = color; g.globalAlpha = 0.22; g.beginPath(); g.arc(x, y, r * 3, 0, TAU); g.fill();
  g.globalAlpha = 1; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.restore();
}
function maxOf(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// A generator runner: runs `gen` for up to `ms` per call. Returns true when done.
function runFor(job, ms, now) {
  if (!job || job.done) return true;
  const gen = job.gen || job, t0 = now();
  do {
    const r = gen.next();
    if (r.done) { job.done = true; return true; }
  } while (now() - t0 < ms);
  return false;
}
// Forward projection in slices of views.
function* fwdJob(image, geom, out, chunk = 8) {
  for (let a = 0; a < geom.nAngles; a += chunk) { forwardProject(image, geom, { out, a0: a, a1: Math.min(geom.nAngles, a + chunk) }); yield a; }
}

// ---------- base ----------
function base(spec, env, kind) {
  const R = rng(spec.seed);
  return {
    kind, spec, env, R, dur: spec.dur, t: 0, ready: false, cam: cam2d(0, 0), subject: null,
    prep: null,                      // a generator of setup work, run in slices before the shot starts
    layers: [], fadeQ: -1, onMap: null,
    async init() { this.ready = true; },
    step(dt) { this.t += dt; },
    // tick(dt) -> false while the setup work still runs (the saver keeps the frame dark)
    tick(dt) {
      if (this.prep) { if (!runFor(this.prep, env.phone ? 7 : 10, env.now)) return false; this.prep = null; }
      this.step(dt);
      const q = this.fadeK();
      if (q !== this.fadeQ) {            // cross-fade: repaint the MAIN layers at 32 steps
        const first = this.fadeQ < 0; this.fadeQ = q;
        if (!first || q > 0) { for (const L of this.layers) L.repaint(); if (this.onMap) this.onMap(); }
      }
      return true;
    },
    // MAIN map: [id, opts]. Before the fade: cmap. During: a blended LUT. After: cmap2.
    fadeK() {
      if (!spec.cmap2) return 0;
      const k = smooth((this.t - (spec.fadeAt ?? 0.5) * this.dur) / FADE_T);
      return Math.round(k * 32) / 32;
    },
    mainMap() {
      const a = spec.cmap || 'bone', b = spec.cmap2, k = this.fadeK();
      if (!b || k <= 0) return [a, {}];
      if (k >= 1) return [b, {}];
      return [a, { lut: CM.blend(a, b, k) }];
    },
    mapName() {
      const a = CM.get(spec.cmap || 'bone').name;
      if (!spec.cmap2) return a;
      const k = this.fadeK(), b = CM.get(spec.cmap2).name;
      return k <= 0 ? a : k >= 1 ? b : `${a} → ${b}`;
    },
    layer(nx, ny) { const L = new Layer(env.makeCanvas, nx, ny, () => this.mainMap()); this.layers.push(L); return L; },
    focus(stage) { return { r: stage, z: 1 }; },
    dispose() {},
  };
}

// ============================================================================
//  sine: the sine trace of single bright points
// ============================================================================
function shotSine(spec, env) {
  const s = base(spec, env, 'sine');
  const R = s.R, np = env.phone ? 2 : pick(R, [2, 3, 3]);
  const pts = [];
  for (let i = 0; i < np; i++) {
    const a = R() * TAU, r = 0.25 + 0.55 * Math.sqrt(R());
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), c: INK[(i + Math.floor(R() * 6)) % 6] });
  }
  s.theta = 0;
  const scanEnd = s.dur * 0.82;
  s.step = function (dt) { this.t += dt; this.theta = TAU * spin(this.t / scanEnd, 0.28); };
  s.layout = (stage) => fitPanels(stage, [1, 1.7], 26);
  s.focus = function (stage) {
    const [ob, sg] = this.layout(stage), u = this.t / this.dur;
    if (u < 0.3) return { r: ob, z: 1.08 };
    if (u < 0.78) { const hx = sg.x + (this.theta / TAU) * sg.w; return { r: { x: hx - sg.h * 0.45, y: sg.y, w: sg.h * 0.9, h: sg.h }, z: 1.18 }; }
    return { r: { x: ob.x, y: ob.y, w: sg.x + sg.w - ob.x, h: ob.h }, z: 1 };
  };
  s.draw = function (g, stage) {
    const [ob, sg] = this.layout(stage), th = this.theta;
    const c = center(ob), rr = ob.w * 0.36;
    frameBox(g, ob, 'Object');
    frameBox(g, sg, 'Sinogram', { right: `θ ${Math.round((th * 180) / Math.PI)}°` });
    // field disc
    g.save();
    const gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, rr * 1.05);
    gr.addColorStop(0, 'rgba(60,90,130,0.20)'); gr.addColorStop(1, 'rgba(20,30,50,0.05)');
    g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, rr, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(150,180,220,0.25)'; g.lineWidth = 1; g.stroke();
    // rays: direction d = (-sin, cos) in world (y up) -> screen (-sin, -cos); detector axis n = (cos, -sin)
    const dx = -Math.sin(th), dy = -Math.cos(th), nx = Math.cos(th), ny = -Math.sin(th), L = rr * 1.18;
    g.strokeStyle = 'rgba(140,190,255,0.10)'; g.lineWidth = 1;
    for (let k = -12; k <= 12; k++) {
      const u = (k / 12) * rr, ox = c.x + nx * u, oy = c.y + ny * u;
      g.beginPath(); g.moveTo(ox - dx * L, oy - dy * L); g.lineTo(ox + dx * L, oy + dy * L); g.stroke();
    }
    // source bar and detector bar
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,240,200,0.55)';
    g.beginPath(); g.moveTo(c.x - dx * L - nx * rr, c.y - dy * L - ny * rr); g.lineTo(c.x - dx * L + nx * rr, c.y - dy * L + ny * rr); g.stroke();
    g.strokeStyle = 'rgba(150,200,255,0.75)';
    g.beginPath(); g.moveTo(c.x + dx * L - nx * rr, c.y + dy * L - ny * rr); g.lineTo(c.x + dx * L + nx * rr, c.y + dy * L + ny * rr); g.stroke();
    g.restore();
    // sinogram axes
    g.save();
    g.strokeStyle = 'rgba(150,180,220,0.13)'; g.lineWidth = 1;
    for (let q = 0; q <= 4; q++) { const x = sg.x + (q / 4) * sg.w; g.beginPath(); g.moveTo(x, sg.y); g.lineTo(x, sg.y + sg.h); g.stroke(); }
    g.beginPath(); g.moveTo(sg.x, sg.y + sg.h / 2); g.lineTo(sg.x + sg.w, sg.y + sg.h / 2); g.stroke();
    const hx = sg.x + (th / TAU) * sg.w;
    g.strokeStyle = 'rgba(255,240,200,0.35)'; g.beginPath(); g.moveTo(hx, sg.y); g.lineTo(hx, sg.y + sg.h); g.stroke();
    g.restore();
    const sy = (v) => sg.y + sg.h / 2 - v * sg.h * 0.46;
    for (const p of pts) {
      // the point, its ray and its blip on the detector
      const px = c.x + p.x * rr, py = c.y - p.y * rr, sv = p.x * Math.cos(th) + p.y * Math.sin(th);
      g.save(); g.strokeStyle = p.c; g.globalAlpha = 0.7; g.lineWidth = 1.4;
      const bx = c.x + nx * sv * rr, by = c.y + ny * sv * rr;
      g.beginPath(); g.moveTo(bx - dx * L, by - dy * L); g.lineTo(bx + dx * L, by + dy * L); g.stroke(); g.restore();
      dot(g, px, py, 3.2, p.c);
      dot(g, bx + dx * L, by + dy * L, 2.6, p.c);
      // the trace
      const trace = [], n = Math.max(2, Math.ceil((th / TAU) * 240));
      for (let i = 0; i <= n; i++) { const a = (i / n) * th; trace.push([sg.x + (a / TAU) * sg.w, sy(p.x * Math.cos(a) + p.y * Math.sin(a))]); }
      glowLine(g, trace, p.c, 2);
      dot(g, hx, sy(sv), 3, p.c);
    }
    this.subject = { x: ob.x, y: ob.y, w: sg.x + sg.w - ob.x, h: ob.h };
  };
  s.plate = function () {
    return {
      title: np === 1 ? 'One point, one sine' : `${np} points, ${np} sines`,
      sub: 'each point of the object traces one sine wave through the sinogram',
      tex: [TEX.sine], rules: [['\\theta', 'm5'], ['s', 'm1'], ['x_0', 'm2'], ['y_0', 'm2']],
      params: [{ sym: '\\theta', name: 'gantry angle', value: `${Math.round((this.theta * 180) / Math.PI)}°`, cls: 'm5' }],
      lines: ['Parallel beam; one bright point per colour', CREDIT],
    };
  };
  return s;
}

// ============================================================================
//  smear: plain back-projection builds a blurred star, the ramp filter snaps it sharp
// ============================================================================
function shotSmear(spec, env) {
  const s = base(spec, env, 'smear');
  const R = s.R, name = pick(R, ['shepp-logan-modified', 'head', 'chest', 'walnut']);
  const n = env.phone ? 128 : 192, V = env.phone ? 120 : 180, cmap = MAIN;
  const filt = pick(R, ['ram-lak', 'shepp-logan', 'hamming']);
  const scanEnd = s.dur * 0.52, snapT = 1.1;
  s.init = async function () {
    const ph = phantom2D(name, n, { supersample: env.phone ? 1 : 2 });
    this.img = ph.image; this.geom = fitGeometry('parallel', ph.image, { nAngles: V });
    this.sino = { nAngles: V, nDet: this.geom.nDet, data: new Float32Array(V * this.geom.nDet) };
    this.fbp = { ...ph.image, data: new Float32Array(n * n) };
    this.acc = { ...ph.image, data: new Float32Array(n * n) };
    this.done = 0;
    this.bpL = s.layer(n, n); this.fbL = s.layer(n, n);
    this.resp = filterResponse(filt, 256, 1, 1, 'ramp');
    const self = this, [lo, hi] = WIN[name] || [0, 1];
    this.prep = (function* () {
      yield* fwdJob(self.img, self.geom, self.sino);
      yield* fbpJob(self.sino, self.geom, self.img, self.fbp, filt);
      self.fbL.paint(self.fbp.data, lo, hi, cmap);
    })();
    this.ready = true;
  };
  s.step = function (dt) {
    this.t += dt;
    const want = Math.min(V, Math.round(V * spin(this.t / scanEnd, 0.25)));
    if (want > this.done) {
      backProject(this.sino, this.geom, this.img, { out: this.acc, a0: this.done, a1: want });
      this.done = want;
      { const m = maxOf(this.acc.data); this.bpL.paint(this.acc.data, m * 0.3, m, cmap); }
    }
  };
  s.layout = (stage) => fitPanels(stage, [0.8, 1, 0.8], 24);
  s.snap = function () { return smooth((this.t - scanEnd) / snapT); };
  s.focus = function (stage) {
    const [, im] = this.layout(stage), u = this.t / this.dur;
    if (u < 0.15) return { r: im, z: 1.0 };
    if (this.t < scanEnd + snapT) return { r: im, z: 1.12 };
    return { r: { x: im.x + im.w * 0.18, y: im.y + im.h * 0.2, w: im.w * 0.64, h: im.h * 0.6 }, z: 1.3 };
  };
  s.draw = function (g, stage) {
    const [st, im, fl] = this.layout(stage), a = this.snap(), V1 = Math.max(1, this.done);
    frameBox(g, st, 'One point', { right: `${this.done} views` });
    frameBox(g, im, a < 0.5 ? 'Plain back-projection' : 'Filtered back-projection');
    frameBox(g, fl, 'Ramp filter', { right: a > 0 ? filt : '' });
    // star of one point: a line per view, then the filter leaves a dot
    const c = center(st), L = st.w * 0.48;
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = '#8ec5ff';
    g.globalAlpha = Math.min(0.5, 2.4 / Math.sqrt(V1)) * (1 - a); g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k < this.done; k++) {
      const b = this.geom.angles[k], dx = -Math.sin(b), dy = -Math.cos(b);
      g.moveTo(c.x - dx * L, c.y - dy * L); g.lineTo(c.x + dx * L, c.y + dy * L);
    }
    g.stroke(); g.restore();
    if (a > 0) dot(g, c.x, c.y, 1.5 + 2.5 * a, '#ffd666');
    // the image: blurred until the snap, then a wipe to the filtered image
    this.bpL.draw(g, im);
    if (a > 0) {
      const wx = im.x + im.w * a;
      g.save(); g.beginPath(); g.rect(im.x, im.y, wx - im.x, im.h); g.clip(); this.fbL.draw(g, im); g.restore();
      if (a < 1) {
        g.save(); g.fillStyle = '#ffd666'; g.globalAlpha = 0.9 * Math.sin(Math.PI * a);
        g.fillRect(wx - 1.2, im.y, 2.4, im.h); g.globalAlpha *= 0.25; g.fillRect(wx - 7, im.y, 14, im.h); g.restore();
      }
    }
    // current view direction across the image
    if (this.done < V) {
      const b = this.geom.angles[Math.max(0, this.done - 1)], dx = -Math.sin(b), dy = -Math.cos(b), ci = center(im);
      g.save(); g.beginPath(); g.rect(im.x, im.y, im.w, im.h); g.clip(); g.strokeStyle = 'rgba(255,240,200,0.5)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(ci.x - dx * im.w * 0.7, ci.y - dy * im.w * 0.7); g.lineTo(ci.x + dx * im.w * 0.7, ci.y + dy * im.w * 0.7); g.stroke(); g.restore();
    }
    // filter plot: |w| and the windowed filter, drawn in as it snaps
    const base = fl.y + fl.h * 0.82, top = fl.y + fl.h * 0.14, P = this.resp.length;
    g.save(); g.strokeStyle = 'rgba(150,180,220,0.3)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(fl.x, base); g.lineTo(fl.x + fl.w, base); g.moveTo(fl.x + fl.w / 2, top); g.lineTo(fl.x + fl.w / 2, base); g.stroke(); g.restore();
    const ramp = [], win = [], m = maxOf(this.resp) || 1, reveal = Math.max(0.12, a);
    for (let i = 0; i <= 120; i++) {
      const f = i / 120 * 2 - 1, x = fl.x + fl.w * (0.5 + 0.5 * f * reveal);
      ramp.push([x, base - Math.abs(f * reveal) * (base - top)]);
      const j = Math.min(P / 2, Math.round(Math.abs(f * reveal) * (P / 2)));
      win.push([x, base - (this.resp[j] / m) * (base - top)]);
    }
    glowLine(g, ramp, 'rgba(160,190,230,0.55)', 1.2);
    if (a > 0) glowLine(g, win, '#ffd666', 2);
    this.subject = im;
  };
  s.plate = function () {
    return {
      title: this.snap() > 0.5 ? 'The ramp filter snaps it sharp' : 'Back-projection smears every view',
      sub: 'plain back-projection gives a 1/r blur; filtering each view first cancels it',
      tex: [TEX.fbp], rules: RULES,
      params: [{ sym: 'N_\\theta', name: 'views', value: `${this.done} / ${V}`, cls: 'm5' }, { sym: 'h', name: 'filter', value: filt, cls: 'm3' }],
      lines: [`${label2D(name)} · parallel beam · ${n}×${n}`, CREDIT],
    };
  };
  s.dispose = function () { this.bpL?.drop(); this.fbL?.drop(); this.sino = this.acc = this.fbp = this.img = null; };
  return s;
}

// ============================================================================
//  fourier: each projection fills one spoke of k-space
// ============================================================================
function shotFourier(spec, env) {
  const s = base(spec, env, 'fourier');
  const R = s.R, name = pick(R, ['shepp-logan-modified', 'head', 'suitcase', 'walnut']);
  const n = env.phone ? 96 : 128, V = env.phone ? 120 : 180, K = env.phone ? 300 : 440;
  const cmap = spec.cmap || pick(R, ['magma', 'inferno', 'nebula', 'aurora', 'synthwave']);
  const fillEnd = s.dur * 0.72;
  s.init = async function () {
    const ph = phantom2D(name, n, { supersample: env.phone ? 1 : 2 });
    this.geom = fitGeometry('parallel', ph.image, { nAngles: V });
    this.sino = { nAngles: V, nDet: this.geom.nDet, data: new Float32Array(V * this.geom.nDet) };
    const self = this;
    this.prep = (function* () { yield* fwdJob(ph.image, self.geom, self.sino); self.spectra(ph); })();
    this.ready = true;
  };
  s.spectra = function (ph) {
    const nd = this.geom.nDet; let P = 1; while (P < 2 * nd) P <<= 1;
    this.P = P; this.spec = new Float32Array(V * P);
    const re = new Float64Array(P), im = new Float64Array(P);
    let mx = 0;
    for (let a = 0; a < V; a++) {
      re.fill(0); im.fill(0);
      const o = (P - nd) >> 1;
      for (let i = 0; i < nd; i++) re[o + i] = this.sino.data[a * nd + i] * ((o + i) & 1 ? -1 : 1);   // (-1)^i centres the spectrum
      fft(re, im);
      for (let j = 0; j < P; j++) { const v = Math.log1p(Math.hypot(re[j], im[j])); this.spec[a * P + j] = v; if (v > mx) mx = v; }
    }
    this.mx = mx;
    const [lo, hi] = WIN[name] || [0, 1];
    this.obL = s.layer(n, n).paint(ph.image.data, lo, hi, 'grey');
    this.kL = s.layer(K, K);
    this.kd = this.kL.id.data; this.kd.fill(0);
    this.lut = CM.rgba(cmap);
    this.done = 0;
  };
  s.paintSpoke = function (a) {
    const b = this.geom.angles[a], cx = Math.cos(b), cy = -Math.sin(b), P = this.P, Kh = K / 2, d = this.kd;
    for (let j = 0; j < P; j++) {
      const f = (j - P / 2) / (P / 2), v = this.spec[a * P + j] / this.mx;
      const li = Math.round(Math.pow(clamp(v, 0, 1), 0.65) * 255) * 4;
      for (const off of [-0.5, 0, 0.5]) {
        const x = Math.round(Kh + f * Kh * cx - off * cy), y = Math.round(Kh + f * Kh * cy + off * cx);
        if (x < 0 || y < 0 || x >= K || y >= K) continue;
        const p = (y * K + x) * 4;
        if (!d[p + 3] || this.lut[li] + this.lut[li + 1] + this.lut[li + 2] > d[p] + d[p + 1] + d[p + 2]) { d[p] = this.lut[li]; d[p + 1] = this.lut[li + 1]; d[p + 2] = this.lut[li + 2]; d[p + 3] = 255; }
      }
    }
  };
  s.step = function (dt) {
    this.t += dt;
    const want = Math.min(V, Math.round(V * spin(this.t / fillEnd, 0.25)));
    if (want > this.done) { for (let a = this.done; a < want; a++) this.paintSpoke(a); this.done = want; this.kL.g.putImageData(this.kL.id, 0, 0); }
  };
  s.layout = (stage) => fitPanels(stage, [1, 1.15, 1], 24);
  s.focus = function (stage) {
    const [, , kp] = this.layout(stage);
    if (this.t < fillEnd * 0.5) return { r: { x: stage.x, y: stage.y, w: stage.w, h: stage.h }, z: 1 };
    if (this.t < fillEnd) return { r: kp, z: 1.12 };
    return { r: { x: kp.x + kp.w * 0.25, y: kp.y + kp.h * 0.25, w: kp.w * 0.5, h: kp.h * 0.5 }, z: 1.32 };
  };
  s.draw = function (g, stage) {
    const [ob, pr, kp] = this.layout(stage), a = Math.max(0, this.done - 1), b = this.geom.angles[a];
    frameBox(g, ob, 'Object'); frameBox(g, pr, 'Projection'); frameBox(g, kp, 'k-space', { right: `${this.done} spokes` });
    this.obL.draw(g, ob);
    const c = center(ob), dx = -Math.sin(b), dy = -Math.cos(b), nx = Math.cos(b), ny = -Math.sin(b);
    g.save(); g.beginPath(); g.rect(ob.x, ob.y, ob.w, ob.h); g.clip(); g.strokeStyle = 'rgba(255,214,102,0.22)'; g.lineWidth = 1;
    for (let k = -6; k <= 6; k++) { const u = (k / 6) * ob.w * 0.45; g.beginPath(); g.moveTo(c.x + nx * u - dx * ob.w * 0.5, c.y + ny * u - dy * ob.w * 0.5); g.lineTo(c.x + nx * u + dx * ob.w * 0.5, c.y + ny * u + dy * ob.w * 0.5); g.stroke(); }
    g.restore();
    // projection profile and its spectrum
    const nd = this.geom.nDet, row = this.sino.data.subarray(a * nd, a * nd + nd), m = maxOf(row) || 1;
    const prof = [], sp = [], P = this.P;
    for (let i = 0; i < nd; i++) prof.push([pr.x + (i / (nd - 1)) * pr.w, pr.y + pr.h * 0.48 - (row[i] / m) * pr.h * 0.36]);
    for (let j = 0; j < P; j++) sp.push([pr.x + (j / (P - 1)) * pr.w, pr.y + pr.h * 0.96 - (this.spec[a * P + j] / this.mx) * pr.h * 0.36]);
    glowLine(g, prof, '#ffd666', 1.6); glowLine(g, sp, INK[0], 1.4);
    // k-space disc
    this.kL.draw(g, kp);
    const kc = center(kp), kr = kp.w / 2;
    g.save(); g.strokeStyle = 'rgba(255,240,200,0.6)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(kc.x - nx * kr, kc.y - ny * kr); g.lineTo(kc.x + nx * kr, kc.y + ny * kr); g.stroke(); g.restore();
    this.subject = kp;
  };
  s.plate = function () {
    return {
      title: 'Fourier slice: k-space, one spoke per view',
      sub: 'the 1D spectrum of each projection is one line through the 2D spectrum of the object',
      tex: [TEX.slice], rules: RULES,
      params: [{ sym: '\\theta', name: 'spokes', value: `${this.done} / ${V}`, cls: 'm5' }],
      lines: [`${label2D(name)} · parallel beam · log magnitude`, CREDIT],
    };
  };
  s.dispose = function () { this.obL?.drop(); this.kL?.drop(); this.sino = this.spec = null; };
  return s;
}

// ============================================================================
//  iterate: an iterative solver converges from noise; the residual falls
// ============================================================================
function shotIterate(spec, env) {
  const s = base(spec, env, 'iterate');
  const R = s.R, name = pick(R, ['shepp-logan-modified', 'chest', 'head', 'walnut']);
  const algo = pick(R, ['sirt', 'cgls', 'sirt']), n = env.phone ? 96 : 128, V = pick(R, [45, 60, 90]);
  const IT = { sirt: 160, cgls: 36, sart: 24 }[algo], cmap = MAIN, dmap = spec.dmap || 'berlin';
  const runEnd = s.dur * 0.8;
  s.init = async function () {
    const ph = phantom2D(name, n, { supersample: env.phone ? 1 : 2 });
    this.truth = ph.image; this.geom = fitGeometry('parallel', ph.image, { nAngles: V });
    this.sino = { nAngles: V, nDet: this.geom.nDet, data: new Float32Array(V * this.geom.nDet) };
    const self = this;
    this.prep = (function* () { yield* fwdJob(ph.image, self.geom, self.sino); self.setup(ph, n); })();
    this.ready = true;
  };
  s.setup = function (ph, n) {
    const nr = mulberry32(spec.seed), sm = maxOf(this.sino.data);
    for (let i = 0; i < this.sino.data.length; i++) this.sino.data[i] += 0.004 * sm * (nr() + nr() + nr() - 1.5);
    const tm = maxOf(ph.image.data), x0 = { ...ph.image, data: new Float32Array(n * n) };
    const G = 7, grid = Array.from({ length: (G + 1) * (G + 1) }, () => nr());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const gx = (x / n) * G, gy = (y / n) * G, ix = Math.floor(gx), iy = Math.floor(gy), fx = smooth(gx - ix), fy = smooth(gy - iy);
      const v = (grid[iy * (G + 1) + ix] * (1 - fx) + grid[iy * (G + 1) + ix + 1] * fx) * (1 - fy) + (grid[(iy + 1) * (G + 1) + ix] * (1 - fx) + grid[(iy + 1) * (G + 1) + ix + 1] * fx) * fy;
      x0.data[y * n + x] = tm * (0.8 * v + 0.03 * nr());
    }
    this.solver = createSolver(algo, this.sino, this.geom, ph.image, { x0, relax: algo === 'sart' ? 0.6 : undefined, seed: spec.seed });
    this.res = []; this.iter = 0;
    [this.lo, this.hi] = WIN[name] || [0, tm];
    this.rL = s.layer(n, n).paint(x0.data, this.lo, this.hi, cmap);
    this.eL = s.layer(n, n); this.err = new Float32Array(n * n); this.paintErr(x0.data);
    this.psnr = psnr(this.truth, x0);
  };
  s.paintErr = function (d) {
    const t = this.truth.data, sp = (this.hi - this.lo) * 0.5;
    for (let i = 0; i < d.length; i++) this.err[i] = d[i] - t[i];
    this.eL.paint(this.err, -sp, sp, dmap);
  };
  s.step = function (dt) {
    this.t += dt;
    const want = Math.min(IT, Math.ceil(IT * spin(this.t / runEnd, 0.2))), t0 = env.now();
    let moved = false;
    while (this.iter < want && env.now() - t0 < 8) {
      const r = this.solver.step(); this.iter++; this.res.push(r.residual); moved = true;
    }
    if (moved) {
      const im = this.solver.image;
      this.rL.paint(im.data, this.lo, this.hi, cmap); this.paintErr(im.data); this.psnr = psnr(this.truth, im);
    }
  };
  s.layout = (stage) => fitPanels(stage, [1, 1.3, 1], 24);
  s.focus = function (stage) {
    const [rp] = this.layout(stage), u = this.t / this.dur;
    if (u < 0.55) return { r: { x: stage.x, y: stage.y, w: stage.w, h: stage.h }, z: 1 };
    return { r: rp, z: 1.18 };
  };
  s.draw = function (g, stage) {
    const [rp, pl, ep] = this.layout(stage);
    frameBox(g, rp, `${algo.toUpperCase()} estimate`, { right: `k = ${this.iter}` });
    frameBox(g, pl, 'Residual ‖b − Ax‖', { right: Number.isFinite(this.psnr) ? `${this.psnr.toFixed(1)} dB` : '' });
    frameBox(g, ep, 'Error');
    this.rL.draw(g, rp); this.eL.draw(g, ep);
    // log residual against iteration
    const r = this.res;
    if (r.length) {
      const r0 = Math.log(r[0] || 1e-9), rmin = Math.log(Math.max(1e-12, Math.min(...r))) - 0.2, span = Math.max(1e-6, r0 - rmin);
      const pts = r.map((v, i) => [pl.x + (IT > 1 ? i / (IT - 1) : 0) * pl.w, pl.y + pl.h * 0.1 + ((r0 - Math.log(Math.max(v, 1e-12))) / span) * pl.h * 0.8]);
      g.save(); g.strokeStyle = 'rgba(150,180,220,0.18)'; g.lineWidth = 1;
      for (let q = 1; q < 4; q++) { const y = pl.y + (q / 4) * pl.h; g.beginPath(); g.moveTo(pl.x, y); g.lineTo(pl.x + pl.w, y); g.stroke(); }
      g.restore();
      glowLine(g, pts, '#ff9a62', 2);
      const lp = pts[pts.length - 1]; dot(g, lp[0], lp[1], 3, '#ffd666');
    }
    this.subject = rp;
  };
  s.plate = function () {
    const r = this.res[this.res.length - 1];
    return {
      title: `${algo.toUpperCase()} converges from noise`,
      sub: 'each iteration projects the estimate, compares with the data and back-projects the difference',
      tex: [algo === 'cgls' ? TEX.cgls : TEX.sirt], rules: RULES,
      params: [{ sym: 'k', name: 'iteration', value: `${this.iter}`, cls: 'm1' }, { sym: 'r', name: 'residual', value: r ? r.toPrecision(3) : '-', cls: 'm2' }, { sym: 'N_\\theta', name: 'views', value: `${V}`, cls: 'm5' }],
      lines: [`${label2D(name)} · ${V} views, light noise · start from random noise`, CREDIT],
    };
  };
  s.dispose = function () { this.rL?.drop(); this.eL?.drop(); this.solver = this.sino = this.truth = this.err = null; };
  return s;
}

// ---------- FBP in chunks (sparse, dose) ----------
function* fbpJob(sino, geom, dims, out, filter = 'ram-lak', chunk = 6, rows = 40) {
  const nd = geom.nDet, q = { nAngles: sino.nAngles, nDet: nd, data: new Float32Array(sino.data.length) };
  for (let a = 0; a < geom.nAngles; a += rows) {
    const a1 = Math.min(geom.nAngles, a + rows);
    const f = filterSinogram({ nAngles: a1 - a, nDet: nd, data: sino.data.subarray(a * nd, a1 * nd) }, { ...geom, nAngles: a1 - a }, { filter });
    q.data.set(f.data, a * nd);
    yield a;
  }
  const w = angleWeights(geom);
  out.data.fill(0);
  yield 0;
  for (let a = 0; a < geom.nAngles; a += chunk) { fbpBackProject(q, geom, dims, { out, a0: a, a1: Math.min(geom.nAngles, a + chunk), weights: w }); yield a; }
}

// ============================================================================
//  sparse: a sweep from 18 views to 720 views
// ============================================================================
function shotSparse(spec, env) {
  const s = base(spec, env, 'sparse');
  const R = s.R, name = pick(R, ['chest', 'head', 'shepp-logan-modified', 'walnut', 'bars']);
  const n = env.phone ? 128 : 160, FULL = 720, COUNTS = [18, 30, 45, 90, 180, 360, 720];
  const cmap = MAIN;
  s.init = async function () {
    const ph = phantom2D(name, n, { supersample: env.phone ? 1 : 2 });
    this.truth = ph.image; this.geom = fitGeometry('parallel', ph.image, { nAngles: FULL });
    this.sino = { nAngles: FULL, nDet: this.geom.nDet, data: new Float32Array(FULL * this.geom.nDet) };
    this.fwd = 0; this.stage = 0; this.shown = -1; this.prev = -1; this.fadeT = 0;
    [this.lo, this.hi] = WIN[name] || [0, 1];
    this.L = COUNTS.map(() => s.layer(n, n)); this.ps = COUNTS.map(() => NaN);
    this.out = { ...ph.image, data: new Float32Array(n * n) };
    this.prep = fwdJob(ph.image, this.geom, this.sino, 24);
    this.fwd = FULL;
    this.ready = true;
  };
  s.startStage = function (k) {
    const keep = FULL / COUNTS[k], g = sparseAngles(this.geom, keep), nd = this.geom.nDet;
    const sub = { nAngles: g.nAngles, nDet: nd, data: new Float32Array(g.nAngles * nd) };
    for (let a = 0; a < g.nAngles; a++) sub.data.set(this.sino.data.subarray(a * keep * nd, a * keep * nd + nd), a * nd);
    this.job = { gen: fbpJob(sub, g, this.truth, this.out), done: false, k };
  };
  s.step = function (dt) {
    this.t += dt;
    const budget = env.phone ? 6 : 9;
    if (!this.job && this.stage < COUNTS.length) this.startStage(this.stage);
    if (this.job && runFor(this.job, budget, env.now)) {
      const k = this.job.k; this.L[k].paint(this.out.data, this.lo, this.hi, cmap); this.ps[k] = psnr(this.truth, this.out);
      this.job = null; this.stage++;
    }
    // show stage k when it is ready and its time slot has come
    const slot = (this.dur * 0.86) / COUNTS.length, want = Math.min(COUNTS.length - 1, Math.floor(this.t / slot));
    if (want > this.shown && want < this.stage) { this.prev = this.shown; this.shown = want; this.fadeT = 0; }
    this.fadeT += dt;
  };
  s.layout = (stage) => fitPanels(stage, [1, 0.62], 28);
  s.focus = function (stage) {
    const [im] = this.layout(stage);
    return this.t > this.dur * 0.6 ? { r: { x: im.x + im.w * 0.15, y: im.y + im.h * 0.15, w: im.w * 0.7, h: im.h * 0.7 }, z: 1.2 } : { r: { x: stage.x, y: stage.y, w: stage.w, h: stage.h }, z: 1 };
  };
  s.draw = function (g, stage) {
    const [im, dl] = this.layout(stage), k = this.shown, N = k >= 0 ? COUNTS[k] : 0;
    frameBox(g, im, 'Filtered back-projection', { right: k >= 0 && Number.isFinite(this.ps[k]) ? `${this.ps[k].toFixed(1)} dB` : '' });
    frameBox(g, dl, 'Views', { right: `${N}` });
    if (this.prev >= 0) this.L[this.prev].draw(g, im);
    if (k >= 0) this.L[k].draw(g, im, smooth(this.fadeT / 0.45));
    // the dial: one spoke per view angle
    const c = center(dl), r = Math.min(dl.w, dl.h) * 0.44;
    g.save(); g.strokeStyle = 'rgba(150,180,220,0.25)'; g.lineWidth = 1; g.beginPath(); g.arc(c.x, c.y, r, 0, TAU); g.stroke();
    g.globalCompositeOperation = 'lighter'; g.strokeStyle = '#8ec5ff'; g.globalAlpha = clamp(3 / Math.sqrt(Math.max(1, N)), 0.12, 0.9); g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < N; i++) { const b = (i / N) * Math.PI; g.moveTo(c.x - Math.cos(b) * r, c.y + Math.sin(b) * r); g.lineTo(c.x + Math.cos(b) * r, c.y - Math.sin(b) * r); }
    g.stroke(); g.restore();
    if (k < 0) { g.save(); g.fillStyle = 'rgba(200,214,236,0.5)'; g.font = '500 12px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('projecting 720 views', c.x, c.y + r + 22); g.restore(); }
    this.subject = im;
  };
  s.plate = function () {
    const k = this.shown, N = k >= 0 ? COUNTS[k] : 18;
    return {
      title: 'From 18 views to 720',
      sub: 'too few views leave streaks that the other views cannot cancel',
      tex: [TEX.sampling], rules: [['N_\\theta', 'm5'], ['N_{\\mathrm{det}}', 'm1']],
      params: [{ sym: 'N_\\theta', name: 'views', value: `${N}`, cls: 'm5' }, { sym: '\\mathrm{PSNR}', name: 'dB', value: k >= 0 && Number.isFinite(this.ps[k]) ? this.ps[k].toFixed(1) : '-', cls: 'm2' }],
      lines: [`${label2D(name)} · parallel beam · FBP, Ram-Lak`, CREDIT],
    };
  };
  s.dispose = function () { this.L?.forEach((l) => l.drop()); this.sino = this.truth = this.out = this.job = null; };
  return s;
}

// ============================================================================
//  dose: grainy to clean as the photon count rises
// ============================================================================
function shotDose(spec, env) {
  const s = base(spec, env, 'dose');
  const R = s.R, name = pick(R, ['chest', 'head', 'contrast-detail']);
  const n = env.phone ? 128 : 192, V = env.phone ? 240 : 360, DOSES = [3e2, 1e3, 3e3, 1e4, 3e4, 1e5, 1e6];
  const cmap = MAIN;
  const win = name === 'head' ? hu(40, 200) : name === 'chest' ? hu(40, 500) : hu(40, 160);
  s.init = async function () {
    const ph = phantom2D(name, n, { supersample: env.phone ? 1 : 2 });
    this.truth = ph.image; this.geom = fitGeometry('parallel', ph.image, { nAngles: V });
    this.clean = { nAngles: V, nDet: this.geom.nDet, data: new Float32Array(V * this.geom.nDet) };
    this.ref = { ...ph.image, data: new Float32Array(n * n) };
    const self = this;
    this.prep = (function* () { yield* fwdJob(ph.image, self.geom, self.clean); yield* fbpJob(self.clean, self.geom, ph.image, self.ref); })();
    this.L = DOSES.map(() => s.layer(n, n)); this.sig = DOSES.map(() => NaN);
    this.out = { ...ph.image, data: new Float32Array(n * n) };
    this.stage = 0; this.shown = -1; this.prev = -1; this.fadeT = 0; this.ready = true;
  };
  s.startStage = function (k) {
    const I0 = DOSES[k], c = transmit(this.clean, { I0 });
    poissonNoise(c, { seed: (spec.seed + k * 977) >>> 0 });
    this.job = { gen: fbpJob(toLineIntegral(c, { I0 }), this.geom, this.truth, this.out), done: false, k };
  };
  s.sigma = function () {
    const n2 = this.truth.nx, o = this.out.data, r = this.ref.data; let sum = 0, cnt = 0;
    for (let y = Math.floor(n2 * 0.35); y < n2 * 0.65; y++) for (let x = Math.floor(n2 * 0.35); x < n2 * 0.65; x++) { const d = o[y * n2 + x] - r[y * n2 + x]; sum += d * d; cnt++; }
    return (1000 * Math.sqrt(sum / Math.max(1, cnt))) / MU_W;
  };
  s.step = function (dt) {
    this.t += dt;
    if (!this.job && this.stage < DOSES.length) this.startStage(this.stage);
    if (this.job && runFor(this.job, env.phone ? 6 : 9, env.now)) {
      const k = this.job.k; this.L[k].paint(this.out.data, win[0], win[1], cmap); this.sig[k] = this.sigma();
      this.job = null; this.stage++;
    }
    const slot = (this.dur * 0.86) / DOSES.length, want = Math.min(DOSES.length - 1, Math.floor(this.t / slot));
    if (want > this.shown && want < this.stage) { this.prev = this.shown; this.shown = want; this.fadeT = 0; }
    this.fadeT += dt;
  };
  s.layout = (stage) => fitPanels(stage, [1, 1.1], 28);
  s.focus = function (stage) {
    const [im] = this.layout(stage);
    return this.t < this.dur * 0.45 ? { r: { x: im.x + im.w * 0.2, y: im.y + im.h * 0.2, w: im.w * 0.6, h: im.h * 0.6 }, z: 1.28 } : { r: { x: stage.x, y: stage.y, w: stage.w, h: stage.h }, z: 1 };
  };
  s.draw = function (g, stage) {
    const [im, pl] = this.layout(stage), k = this.shown;
    frameBox(g, im, 'Reconstruction', { right: k >= 0 ? `I₀ = ${fmtDose(DOSES[k])}` : '' });
    frameBox(g, pl, 'Noise against dose', { right: k >= 0 && Number.isFinite(this.sig[k]) ? `σ ${this.sig[k].toFixed(0)} HU` : '' });
    if (this.prev >= 0) this.L[this.prev].draw(g, im);
    if (k >= 0) this.L[k].draw(g, im, smooth(this.fadeT / 0.45));
    // log-log plot of sigma against I0, with the 1/sqrt(I0) line
    const x = (d) => pl.x + pl.w * (0.06 + 0.88 * (Math.log10(d) - 2) / 4.5);
    const valid = this.sig.filter(Number.isFinite), smax = Math.max(1, ...valid) * 1.4, smin = smax / 100;
    const y = (v) => pl.y + pl.h * 0.08 + pl.h * 0.84 * (Math.log10(smax) - Math.log10(clamp(v, smin, smax))) / (Math.log10(smax) - Math.log10(smin));
    g.save(); g.strokeStyle = 'rgba(150,180,220,0.18)'; g.lineWidth = 1;
    for (let d = 2; d <= 6; d++) { const xx = x(10 ** d); g.beginPath(); g.moveTo(xx, pl.y); g.lineTo(xx, pl.y + pl.h); g.stroke(); }
    g.restore();
    if (Number.isFinite(this.sig[0])) {
      const line = []; for (let q = 0; q <= 40; q++) { const d = 10 ** (2.3 + (q / 40) * 4); line.push([x(d), y(this.sig[0] * Math.sqrt(DOSES[0] / d))]); }
      glowLine(g, line, 'rgba(160,190,230,0.5)', 1);
    }
    for (let i = 0; i <= k; i++) if (Number.isFinite(this.sig[i])) dot(g, x(DOSES[i]), y(this.sig[i]), i === k ? 4 : 2.6, i === k ? '#ffd666' : '#ff9a62');
    this.subject = im;
  };
  s.plate = function () {
    const k = this.shown;
    return {
      title: 'Dose: from grain to a clean image',
      sub: 'photon noise falls as one over the square root of the dose',
      tex: [TEX.beer], rules: RULES,
      params: [{ sym: 'I_0', name: 'photons per ray', value: k >= 0 ? fmtDose(DOSES[k]) : '-', cls: 'm5' }, { sym: '\\sigma', name: 'noise', value: k >= 0 && Number.isFinite(this.sig[k]) ? `${this.sig[k].toFixed(0)} HU` : '-', cls: 'm2' }],
      lines: [`${label2D(name)} · ${V} views · FBP, Ram-Lak`, CREDIT],
    };
  };
  s.dispose = function () { this.L?.forEach((l) => l.drop()); this.clean = this.ref = this.truth = this.out = this.job = null; };
  return s;
}
function fmtDose(d) { const e = Math.floor(Math.log10(d)), m = d / 10 ** e; return `${m === 1 ? '' : m.toFixed(0) + '×'}10^${e}`.replace('^2', '²').replace('^3', '³').replace('^4', '⁴').replace('^5', '⁵').replace('^6', '⁶').replace('^7', '⁷'); }

// ============================================================================
//  lab shots: drive window.__ctlab, draw its panel canvases
// ============================================================================
const LAB_SHOTS = {
  gantry: {
    presets: ['shepp-logan', 'chest-lung', 'head-brain', 'fan-arc', 'bars', 'contrast-detail'],
    scanEnd: 0.72, panels: ['phantom', 'sinogram', 'recon'],
    title: 'The gantry turns, the sinogram paints itself', sub: 'one view per angle; the image grows as each view is back-projected', tex: 'radon',
  },
  artefacts: {
    presets: ['metal-streaks', 'rings', 'beam-hardening', 'motion', 'low-dose', 'sparse-18', 'limited-90'],
    scanEnd: 0.36, panels: ['sinogram', 'recon'], sweep: true,
    title: 'Artefacts', sub: '', tex: 'hu',
  },
  reveal: {
    presets: ['walnut', 'suitcase'],
    scanEnd: 0.55, panels: ['phantom', 'recon'], cmaps: ['gold-leaf', 'hot-iron', 'bone', 'xray-blue', 'ember', 'copper'],
    title: '', sub: 'scanned, then reconstructed slice', tex: 'fbp',
  },
};
const ART_TITLES = {
  'metal-streaks': 'Metal streaks bloom', rings: 'Rings from one dead pixel', 'beam-hardening': 'Beam hardening cups the image',
  motion: 'Motion doubles the edges', 'low-dose': 'Low dose: photon grain', 'sparse-18': 'Eighteen views: a star of streaks', 'limited-90': 'A missing wedge of angles',
};
function shotLab(spec, env, kind) {
  const s = base(spec, env, kind), D = LAB_SHOTS[kind], lab = env.lab, R = s.R;
  const preset = pick(R, D.presets), cmap = spec.cmap || (D.cmaps ? pick(R, D.cmaps) : null);
  s.init = async function () {
    await lab.ready;
    lab.setChrome(false); lab.focusPanel(null);
    await lab.load(preset, { autoplay: false });
    if (cmap) await lab.setColormap(cmap);
    const st = lab.state(); this.V = st.views || 1; this.view = st.view || 0;
    this.info = lab.presets().find((p) => p.id === preset) || { label: preset, blurb: '' };
    const p = lab.params();
    const w = typeof p.window === 'string' ? lab.windows().find((x) => x.id === p.window) : p.window;
    this.win = w && Number.isFinite(w.level) ? { level: w.level, width: w.width } : null;
    this.params = p; this.ready = true;
  };
  s.step = function (dt) {
    this.t += dt;
    const want = Math.min(this.V, Math.round(this.V * spin(this.t / (this.dur * D.scanEnd), kind === 'gantry' ? 0.35 : 0.15)));
    const st = lab.state();
    if (st.phase === 'scan' && want > st.view) lab.step(want - st.view);
    this.state = lab.state();
    if (D.sweep && this.win && this.t > this.dur * (D.scanEnd + 0.04)) {
      // window sweep: wide -> preset window -> narrow -> preset window
      const u = clamp((this.t - this.dur * (D.scanEnd + 0.04)) / (this.dur * (0.92 - D.scanEnd)), 0, 1);
      const f = u < 0.45 ? 6 - 5 * smooth(u / 0.45) : u < 0.75 ? 1 - 0.55 * smooth((u - 0.45) / 0.3) : 0.45 + 0.55 * smooth((u - 0.75) / 0.25);
      this.wnow = { level: this.win.level, width: this.win.width * f };
      if (!this.wAt || this.t - this.wAt > 0.05) { this.wAt = this.t; lab.setWindow(this.wnow); }
    }
  };
  s.rects = function (stage) {
    const P = lab.panels(), list = D.panels.map((k) => P[k]).filter(Boolean);
    const asp = list.map((c) => (c.width > 0 && c.height > 0 ? c.width / c.height : 1));
    return { list, rects: fitPanels(stage, asp, 24) };
  };
  s.focus = function (stage) {
    const { rects } = this.rects(stage), u = this.t / this.dur, last = rects[rects.length - 1];
    if (!last) return { r: stage, z: 1 };
    if (kind === 'gantry') return u < 0.3 ? { r: rects[0], z: 1.1 } : u < 0.7 ? { r: rects[1] || last, z: 1.05 } : { r: last, z: 1.18 };
    if (kind === 'artefacts') return u < D.scanEnd ? { r: { x: stage.x, y: stage.y, w: stage.w, h: stage.h }, z: 1 } : { r: last, z: 1.25 };
    return u < D.scanEnd ? { r: rects[0], z: 1.08 } : { r: { x: last.x + last.w * 0.2, y: last.y + last.h * 0.2, w: last.w * 0.6, h: last.h * 0.6 }, z: 1.4 };
  };
  s.draw = function (g, stage) {
    const { list, rects } = this.rects(stage), names = { phantom: 'Object', sinogram: 'Sinogram', recon: 'Reconstruction' };
    list.forEach((cv, i) => {
      const r = rects[i];
      try { g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(cv, r.x, r.y, r.w, r.h); g.restore(); } catch (e) { /* a zero-size canvas */ }
      const key = D.panels.filter((k) => lab.panels()[k])[i];
      const right = key === 'sinogram' && this.state ? `${this.state.view} / ${this.state.views}` : key === 'recon' && this.wnow ? `W ${Math.round(this.wnow.width)}` : '';
      frameBox(g, r, names[key] || key, { right });
    });
    this.subject = rects[rects.length - 1] || null;
  };
  s.plate = function () {
    const st = this.state || {}, p = this.params || {};
    const title = kind === 'artefacts' ? ART_TITLES[preset] || this.info.label : kind === 'reveal' ? (preset === 'walnut' ? 'A walnut, inside out' : 'A suitcase at the airport') : D.title;
    const params = [{ sym: 'N_\\theta', name: 'views', value: `${st.view ?? 0} / ${st.views ?? 0}`, cls: 'm5' }];
    if (this.wnow) params.push({ sym: 'W', name: 'window width', value: `${Math.round(this.wnow.width)}`, cls: 'm1' });
    if (Number.isFinite(st.psnr)) params.push({ sym: '\\mathrm{PSNR}', name: 'dB', value: st.psnr.toFixed(1), cls: 'm2' });
    return {
      title, sub: kind === 'gantry' ? D.sub : this.info.blurb || D.sub,
      tex: [TEX[D.tex]], rules: RULES, params,
      lines: [`${this.info.label} · ${(p.beam || 'parallel').replace('-', ' ')} · ${(p.algo || 'fbp').toUpperCase()}${p.filter ? ', ' + p.filter : ''}`, CREDIT],
    };
  };
  s.dispose = function () { try { lab.stop(); } catch (e) { /* the lab is gone */ } };
  return s;
}

// ============================================================================
//  3D: cone-beam scan and FDK (view3d), or a volume tour
// ============================================================================
function shot3D(spec, env, kind) {
  const s = base(spec, env, kind), R = s.R;
  s.cam = null;
  const name = pick(R, ['head', 'chest', 'shepp-logan']), n = env.phone ? 64 : 96, nA = env.phone ? 90 : 144;
  const look = kind === 'cone-scan' ? pick(R, ['mip', 'dvr', 'iso']) : pick(R, ['slices', 'iso', 'dvr']);
  const cmap = spec.cmap || pick(R, ['bone', 'xray-blue', 'magma', 'ice', 'gold-leaf']);
  const scanEnd = 0.36, reconEnd = 0.62;
  s.cam3 = { yaw: 0.6 + R() * 1.2, pitch: 0.28, dist: 10.5, yawV: (R() < 0.5 ? -1 : 1) * 0.22 };
  s.springs = null;
  s.init = async function () {
    const h3 = await env.make3D({ phantom: name, n, nAngles: nA, mode: kind === 'cone-scan' ? 'dvr' : look, steps: env.phone ? 128 : 256 });
    // a cut can end this shot while make3D waits for the adapter: release the late device at once
    if (this.gone) { h3.release(); return; }
    this.h3 = h3;
    const v = this.h3.view;
    v.setColormap(cmap, { tf: true });
    this.onMap = () => { const [id, o] = this.mainMap(); this.h3?.view?.setColormap(id, { ...o, tf: true }); };
    if (kind === 'cone-volume') v.setShow({ gantry: false, rays: false, table: false, detector: false, volume: 'phantom' });
    else v.setShow({ gantry: true, rays: true, table: true, detector: true, volume: 'phantom' });
    this.phase = kind === 'cone-scan' ? 'scan' : 'look'; this.lookT = 0;
    this.pending = false; this.ready = true;
    const D0 = kind === 'cone-scan' ? 9.5 : 2.7;
    this.springs = { yaw: { x: this.cam3.yaw, v: 0, t: this.cam3.yaw, w: 1.4 }, pitch: { x: 0.3, v: 0, t: 0.3, w: 1.4 }, dist: { x: D0, v: 0, t: D0, w: 2.2 } };
  };
  s.step = function (dt) {
    this.t += dt;
    const v = this.h3 && this.h3.view; if (!v) return;
    const u = this.t / this.dur, st = v.state;
    if (this.phase === 'scan') {
      const want = Math.min(st.total, Math.ceil(st.total * spin(u / scanEnd, 0.3)));
      if (want > st.scanned) v.scanStep({ views: 1, budgetMs: env.phone ? 6 : 9 });
      if (v.state.scanned >= st.total) { this.phase = 'recon'; v.setShow({ volume: 'auto', rays: false }); }
    }
    // FDK runs in chunks until every view is in; the look starts when it ends or when time is up
    if (this.phase !== 'scan' && kind === 'cone-scan' && st.reconstructed < st.total && !this.pending) {
      this.pending = true;
      Promise.resolve(v.reconstructStep({ views: env.phone ? 6 : 10 })).then((r) => {
        this.pending = false;
        if (r && r.done >= r.total && this.phase === 'recon') this.goLook();
      }, () => { this.pending = false; this.goLook(); });
    }
    if (this.phase === 'recon' && u > reconEnd + 0.12) this.goLook();
    // camera: the yaw target moves on, so the spring follows with a smooth speed
    const S = this.springs;
    S.yaw.t += this.cam3.yawV * dt * (this.phase === 'look' ? 1.6 : 1);
    S.pitch.t = this.phase === 'look' ? 0.32 + 0.12 * Math.sin(this.t * 0.4) : 0.22;
    S.dist.t = this.phase === 'look' ? 2.75 - 0.3 * smooth((this.t - (this.lookT || 0)) / (this.dur * 0.4)) : 9.5;
    for (const k of ['yaw', 'pitch', 'dist']) stepSpringObj(S[k], dt);
    if (this.phase === 'look') {
      if (look === 'slices') { const p = this.t * 0.5; v.setSlices({ x: 0.5 + 0.35 * Math.sin(p), y: 0.5 + 0.35 * Math.sin(p * 0.8 + 2), z: 0.5 + 0.3 * Math.sin(p * 1.3 + 4) }); }
      if (look === 'iso') { const m = smooth((this.t - (this.lookT || 0)) / (this.dur * 0.55)); v.setIso(0.14 + 0.38 * m, 0.55 + 0.15 * m); }
    }
  };
  // band: { t, b } in CSS px; w, h the frame size
  s.goLook = function () {
    const v = this.h3 && this.h3.view; if (!v || this.phase === 'look') return;
    this.phase = 'look'; this.lookT = this.t;
    v.setMode(look); v.setShow({ gantry: false, detector: false, table: false, rays: false, volume: 'auto' });
  };
  s.render = function (dt, band, w, h) {
    const v = this.h3 && this.h3.view; if (!v || !this.springs) return;
    const bh = Math.max(1, h - band.t - band.b), yc = band.t + bh / 2, S = this.springs;
    v.setCamera({ yaw: S.yaw.x, pitch: S.pitch.x, dist: S.dist.x * Math.min(2.6, h / bh), offset: [0, ((h / 2 - yc) * 2) / h] });
    v.render({ dt });
    const side = Math.min(bh, w) * 0.8;
    this.subject = { x: w / 2 - side / 2, y: yc - side / 2, w: side, h: side };
  };
  s.draw = function () {};
  s.plate = function () {
    const st = this.h3 && this.h3.view ? this.h3.view.state : { scanned: 0, reconstructed: 0, total: nA };
    const P = { head: 'Head', chest: 'Chest', 'shepp-logan': 'Shepp-Logan 3D' }[name];
    if (kind === 'cone-volume') {
      return {
        title: look === 'slices' ? 'Three planes through the volume' : look === 'iso' ? 'From skin to bone' : 'Volume rendering',
        sub: look === 'slices' ? 'axial, coronal and sagittal slices sweep through the voxels' : look === 'iso' ? 'the transfer function moves from soft tissue to bone' : 'soft tissue translucent, bone bright',
        tex: [TEX.hu], rules: RULES, params: [{ sym: 'n^3', name: 'voxels', value: `${n}³`, cls: 'm1' }],
        lines: [`${P} phantom · ${look}`, CREDIT],
      };
    }
    return {
      title: 'Cone beam: a whole volume in one turn',
      sub: 'every view is a 2D projection on a flat panel; FDK filters and back-projects them in 3D',
      tex: [TEX.fdk], rules: [['D', 'm5'], ['u', 'm1'], ['v', 'm1'], ['w', 'm3']],
      params: [{ sym: 'N_\\theta', name: 'views', value: `${st.scanned} / ${st.total}`, cls: 'm5' }, { sym: '\\mathrm{FDK}', name: 'back-projected', value: `${st.reconstructed}`, cls: 'm2' }],
      lines: [`${P} phantom · ${n}³ voxels · Feldkamp, Davis and Kress`, CREDIT],
    };
  };
  s.dispose = function () { this.gone = true; try { this.h3 && this.h3.release(); } catch (e) { /* gone */ } this.h3 = null; };
  return s;
}
function stepSpringObj(sp, dt) {
  const w = sp.w, d = sp.x - sp.t, e = Math.exp(-w * dt), c = sp.v + w * d;
  sp.x = sp.t + (d + c * dt) * e; sp.v = (sp.v - c * w * dt) * e;
}

// ---------- factory ----------
export function makeShot(spec, env) {
  const shot = makeShotRaw(spec, env);
  const plate0 = shot.plate;
  if (spec.cmap && plate0) {
    // the plate names the colour map (and the error map of a diff shot)
    shot.plate = function () {
      const p = plate0.call(this);
      const extra = [{ name: 'colour map', value: this.mapName() }];
      if (spec.dmap) extra.push({ name: 'error map', value: CM.get(spec.dmap).name });
      return { ...p, params: [...(p.params || []), ...extra] };
    };
  }
  return shot;
}
function makeShotRaw(spec, env) {
  switch (spec.kind) {
    case 'sine': return shotSine(spec, env);
    case 'smear': return shotSmear(spec, env);
    case 'fourier': return shotFourier(spec, env);
    case 'iterate': return shotIterate(spec, env);
    case 'sparse': return shotSparse(spec, env);
    case 'dose': return shotDose(spec, env);
    case 'gantry': case 'artefacts': case 'reveal': return shotLab(spec, env, spec.kind);
    case 'cone-scan': case 'cone-volume': return shot3D(spec, env, spec.kind);
    default: throw new Error('unknown shot ' + spec.kind);
  }
}
export { aimCam };
