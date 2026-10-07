// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  saver.js — window.snSaver for the shell screensaver
// ----------------------------------------------------------------------------
//  enter(opts) hides the page (html.saving), frees the page's WebGL
//  context and plays slow, quiet shots on #saverCv, a 2D canvas in the
//  document. The black hole draws on one offscreen WebGL 2 canvas and is
//  copied to #saverCv each frame; the other shots draw straight on it.
//
//  SHOTS   (8-12 s each; each pass is a seeded shuffle with three images)
//    curve .... the exact mass-radius curve traced from low mass to M_Ch,
//               with the dwarf to scale beside the Earth's outline
//    image .... one real image (Webb, Hubble, ESO, Chandra) in a slow
//               push-in; the credit line is on the plate
//    hole ..... the ray-traced black hole in a slow orbit
//    er ....... E(R) as the mass passes M_Ch: the minimum disappears
//  Framing: plateBand() (lib/saver-clear.js) gives the clear band between
//  the plate's top and bottom text; every subject is centred and sized in
//  it. During a plate swap plateBand() is null, so the last band stays.
//
//  grep -n targets: "const SHOTS", "function frameBand", "enter(opts)",
//  "function codeOf", "const IMAGES"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { holeScene } from './renders.js';
import { makeGL, releaseAll } from './glkit.js';
import { drawER, drawHero, fmtE, COL } from './figures.js';
import { HOLE } from './glsl.js';
import * as P from './physics.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t * t * (3 - 2 * t);

// A source extract: from the first line that contains `from`, at most n
// lines, with the common indent removed.
function codeOf(src, from, n = 12) {
  const L = src.split('\n'); let i = L.findIndex(l => l.includes(from)); if (i < 0) i = 0;
  const part = L.slice(i, i + n);
  const ind = Math.min(...part.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
  return part.map(l => l.slice(ind)).join('\n');
}
const CODE = {
  rk4: { lang: 'js', name: 'physics.js · rk4Step (Lane-Emden, Chandrasekhar)', text: codeOf(P.rk4Step.toString(), 'function rk4Step') },
  geo: { lang: 'glsl', name: 'glsl.js · HOLE, geodesic step', text: codeOf(HOLE, 'for (int i = 0; i < 260') },
  energy: { lang: 'js', name: 'physics.js · energyModel, E(R)', text: codeOf(P.energyModel.toString(), 'const at = ') },
};

const IMAGES = [
  { file: 'southern-ring.jpg', title: 'The Southern Ring, NGC 3132', sub: 'A shed envelope around a new white dwarf, in mid-infrared light', credit: 'NASA, ESA, CSA, STScI, and the Webb ERO Production Team · CC BY 4.0' },
  { file: 'ring-m57.jpg', title: 'The Ring Nebula, M57', sub: 'Webb near-infrared, 2023; the white dwarf is the faint star in the cavity', credit: 'ESA/Webb, NASA, CSA, M. Barlow, N. Cox, R. Wesson · CC BY 4.0' },
  { file: 'helix.jpg', title: 'The Helix Nebula, NGC 7293', sub: 'The future of the Sun: a white dwarf under the limit, cooling for ever', credit: 'ESO · CC BY 4.0' },
  { file: 'cats-eye.jpg', title: "The Cat's Eye, NGC 6543", sub: 'Nested shells around a dying core', credit: 'ESA, NASA, HEIC and The Hubble Heritage Team (STScI/AURA) · CC BY 4.0' },
  { file: 'crab.jpg', title: 'The Crab Nebula, M1', sub: 'An iron core past its limit: a neutron star and its nebula, from 1054', credit: 'NASA, ESA and Allison Loll/Jeff Hester (Arizona State University). Acknowledgement: Davide De Martin (ESA/Hubble) · CC BY 4.0' },
  { file: 'tycho.jpg', title: "Tycho's supernova, 1572", sub: 'A Type Ia remnant in X-rays: no star is left at the centre', credit: 'X-ray: NASA/CXC/RIKEN & GSFC/T. Sato et al.' },
  { file: 'sn1006.jpg', title: 'SN 1006', sub: 'The brightest supernova in recorded history, a white dwarf that exploded', credit: 'NASA/CXC/Middlebury College/F.Winkler' },
];
const MCH = P.massChandra(2).Msun;
const MCH_TEX = 'M_{\\rm Ch} = \\frac{\\sqrt{3\\pi}}{2}\\,\\omega_3\\left(\\frac{\\hbar c}{G}\\right)^{3/2}\\frac{1}{(\\mu_e m_u)^2}';

window.snSaver = {
  enter(opts = {}) {
    const calm = clamp(opts.calm ?? 0.7, 0, 1), slow = 1 - 0.4 * calm;
    let seed = (opts.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const label = typeof opts.label === 'function' ? opts.label : null;

    document.documentElement.classList.add('saving');
    releaseAll();                                   // the page's own context
    const cv = document.getElementById('saverCv');
    const ctx = cv.getContext('2d');
    const glc = document.createElement('canvas');
    const G = makeGL(glc);
    let holeProg = null;
    const B = holeScene();
    if (G) { try { holeProg = G.program('hole', B.frag); } catch (e) { console.error(e); } }
    const ER = P.energyModel(2, 'profile');
    const curve = P.massRadiusCurve(2, { n: 160, x0: 0.04, x1: 4000 });
    // Images: load all; a shot uses only loaded ones.
    const imgs = IMAGES.map(m => { const im = new Image(); im.src = new URL('img/' + m.file, document.baseURI).href; return { ...m, im }; });
    let imgOrder = [], ii = 0;
    const nextImage = () => {
      if (ii >= imgOrder.length) { imgOrder = imgs.slice(); for (let j = imgOrder.length - 1; j > 0; j--) { const q = Math.floor(rnd() * (j + 1)); [imgOrder[j], imgOrder[q]] = [imgOrder[q], imgOrder[j]]; } ii = 0; }
      for (let k = 0; k < imgOrder.length; k++) { const m = imgOrder[ii++ % imgOrder.length]; if (m.im.complete && m.im.naturalWidth) return m; }
      return null;
    };

    // ── shots ──
    const SHOTS = {
      curve: {
        setup() { this.m = null; },
        draw(p, W, H, fr) {
          const n = Math.max(2, Math.round(ease(clamp(p * 1.15, 0, 1)) * curve.length));
          this.m = curve[n - 1];
          scaled2D(1.35, W, H, fr, (w, h, box) => { ctx.translate(box.x, box.y); drawHero(ctx, box.w, box.h, { curve, model: this.m, trace: n / curve.length }); });
        },
        plate() {
          const m = this.m || curve[0];
          return { title: 'The mass-radius relation of white dwarfs', sub: 'Chandrasekhar\'s equation, solved for 160 central densities',
            params: [{ sym: 'M', name: 'mass', value: m.M.toFixed(3) + ' M☉', cls: 'm2' }, { sym: 'R', name: 'radius', value: Math.round(m.R / 1e3).toLocaleString('en') + ' km', cls: 'm6' }, { sym: '\\rho_c', name: 'central density', value: fmtE(m.rhoc / 1e3) + ' g/cm³', cls: 'm4' }],
            tex: [MCH_TEX], eq: ['M_Ch = (√(3π)/2) ω₃ (ħc/G)^(3/2) / (μₑ m_u)² = 1.456 M☉'], code: CODE.rk4 };
        },
      },
      image: {
        setup() { this.img = nextImage(); this.dx = (rnd() - 0.5) * 0.04; this.dy = (rnd() - 0.5) * 0.04; },
        draw(p, W, H, fr) {
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
          // The first shot can start before any image has loaded: pick again.
          if (!this.img) this.img = nextImage();
          const m = this.img; if (!m) return;
          const dpr = cv.width / W, iw = m.im.naturalWidth, ih = m.im.naturalHeight;
          // Fit inside the clear band, then a slow 6 % push-in with a small drift.
          const s0 = Math.min(fr.w * 0.9 / iw, fr.h * 0.96 / ih), s = s0 * (1 + 0.06 * ease(p));
          const cx = W / 2 + this.dx * W * p, cy = fr.cy + this.dy * fr.h * p;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(m.im, cx - iw * s / 2, cy - ih * s / 2, iw * s, ih * s);
        },
        plate() {
          const m = this.img || IMAGES[0];
          return { title: m.title, sub: m.sub, lines: ['Credit: ' + m.credit] };
        },
      },
      hole: {
        gl: true,
        setup() { B.yaw = rnd() * 6.28; B.pitch = 0.06 + 0.22 * rnd(); B.spin = 0.05 * slow; B.t = 0; },
        draw(p, W, H, fr) {
          B.dist = 42 - 6 * ease(p);
          B.step(this.dt);
          const bw = Math.max(2, Math.round(cv.width * scale)), bh = Math.max(2, Math.round(cv.height * scale));
          B.off = [0, (H / 2 - fr.cy) * bh / H];
          const U = B.uniforms(bw, bh);
          U.uZoom *= clamp(fr.h / H * 1.08, 0.45, 1);
          G.draw(holeProg, U, bw, bh);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(glc, 0, 0, cv.width, cv.height);
        },
        plate() {
          return { title: 'A black hole, ray traced', sub: 'Schwarzschild null geodesics with a thin disk',
            params: [{ sym: 'b', name: 'shadow radius', value: '2.598 rₛ', cls: 'm6' }, { sym: 'r_{\\rm in}', name: 'innermost stable orbit', value: '3 rₛ', cls: 'm6' }, { sym: 'i', name: 'above the disk', value: (B.pitch * 57.3).toFixed(0) + '°', cls: 'm1' }],
            tex: ['\\ddot{\\mathbf x} = -\\tfrac{3}{2}\\,r_s\\,h^2\\,\\frac{\\mathbf x}{r^5}, \\qquad g = \\frac{\\sqrt{1-3M/r}}{1-\\Omega\\lambda}'],
            eq: ['x″ = −(3/2) r_s h² x / r⁵', 'g = √(1 − 3M/r) / (1 − Ωλ)'], code: CODE.geo };
        },
      },
      er: {
        setup() { this.M0 = 1.2 + 0.08 * rnd(); this.M1 = 1.62 + 0.08 * rnd(); this.M = this.M0; },
        draw(p, W, H, fr) {
          this.M = this.M0 + (this.M1 - this.M0) * ease(p);
          scaled2D(1.45, W, H, fr, (w, h, box) => drawER(ctx, w, h, this.M, ER, { box }));
        },
        plate() {
          const mn = ER.minimum(this.M);
          return { title: 'The energy of a white dwarf against its radius', sub: 'Relativistic electrons and gravity both scale as 1/R',
            params: [{ sym: 'M/M_{\\rm Ch}', name: 'mass', value: (this.M / MCH).toFixed(3), cls: 'm2' }, { sym: 'R', name: 'equilibrium', value: mn ? Math.round(mn.R / 1e3) + ' km' : 'none', cls: 'm6' }],
            tex: ['E(R) \\approx \\frac{a\\,\\hbar c\\,N^{4/3} - \\alpha_g G M^2}{R}'], eq: ['E(R) ≈ (a ħc N^(4/3) − α_g G M²) / R'], code: CODE.energy };
        },
      },
    };
    // A 2D figure drawn at k times its normal size, in the clear band.
    function scaled2D(k, W, H, fr, paint) {
      const dpr = cv.width / W;
      // A short band (the shell plate) lowers k, so the figure keeps at
      // least 300 px of height and its axes stay readable.
      k = Math.min(k, Math.max(0.8, fr.h * 0.96 / 300));
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
      const bw = Math.min(fr.w * 0.86, 1240) / k, bh = Math.min(fr.h * 0.96, 640) / k;
      const box = { x: (W / k - bw) / 2 + 40, y: fr.cy / k - bh / 2 + 22, w: bw - 50, h: bh - 70 };
      ctx.save(); paint(W / k, H / k, box); ctx.restore();
    }
    const kinds = ['curve', 'image', 'er', 'image', 'image'].concat(G && holeProg ? ['hole'] : []);
    let order = [], oi = 0;
    const shuffle = () => { order = kinds.slice(); for (let j = order.length - 1; j > 0; j--) { const q = Math.floor(rnd() * (j + 1)); [order[j], order[q]] = [order[q], order[j]]; } oi = 0; };
    shuffle();

    // ── framing ──
    let band = null, bandAt = -1e9;
    function frameBand(Wc, Hc) {
      const now = performance.now();
      if (now - bandAt > 250) { bandAt = now; const nb = plateBand(Hc); if (nb || !label) band = nb; }
      if (!band) return { cy: Hc / 2, h: Hc, w: Wc };
      const h = Math.max(0.28 * Hc, Hc - band.t - band.b);
      return { cy: band.t + h / 2, h, w: Math.min(Wc, band.w || Wc) };
    }

    // ── loop ──
    let shot = null, sk = '', t0 = 0, dur = 10, raf = 0, last = performance.now(), scale = 0.8, slowN = 0, fastN = 0, plateAt = 0, fr = null;
    const next = () => {
      if (oi >= order.length) { const prev = order[order.length - 1]; shuffle(); if (order[0] === prev && order.length > 1) [order[0], order[1]] = [order[1], order[0]]; }
      sk = order[oi++]; shot = SHOTS[sk];
      dur = (8 + 4 * rnd()) * (0.9 + 0.25 * calm);
      t0 = performance.now(); shot.setup(); plateAt = 0;
    };
    const send = () => { if (label) { const info = shot.plate(); info.anchor = fr ? { x: innerWidth / 2, y: fr.cy, r: fr.h * 0.38 } : undefined; label(info); } };
    next();
    const tick = now => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const el = (now - t0) / 1000;
      if (el > dur) { next(); return; }
      const p = clamp(el / dur, 0, 1);
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      const Wc = innerWidth, Hc = innerHeight;
      const cw = Math.round(Wc * dpr), ch = Math.round(Hc * dpr);
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      const f = frameBand(Wc, Hc);
      fr = fr ? { cy: fr.cy + (f.cy - fr.cy) * 0.1, h: fr.h + (f.h - fr.h) * 0.1, w: f.w } : f;
      const t1 = performance.now();
      shot.dt = dt;
      shot.draw(p, Wc, Hc, fr);
      // Slow fades at the cuts.
      const fade = Math.max(clamp(1 - el / 1.0, 0, 1), clamp(1 - (dur - el) / 0.9, 0, 1));
      if (fade > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, cw, ch); }
      if (shot.gl) {
        const ms = performance.now() - t1;
        if (dt > 0.034 || ms > 25) { if (++slowN > 10) { scale = Math.max(0.4, scale * 0.88); slowN = 0; } fastN = 0; }
        else if (dt < 0.019) { if (++fastN > 120) { scale = Math.min(1, scale * 1.08); fastN = 0; } slowN = 0; }
      }
      if (now - plateAt > (sk === 'er' || sk === 'curve' ? 300 : 1000)) { plateAt = now; send(); }
    };
    raf = requestAnimationFrame(tick);
    this._stop = () => cancelAnimationFrame(raf);
    this.debug = () => ({ shot: sk, el: +((performance.now() - t0) / 1000).toFixed(1), dur: +dur.toFixed(1), order, oi, scale: +scale.toFixed(2), band, fr, gl: !!G, image: shot.img ? shot.img.file : null });
    return { canvas: cv, warmupMs: 1000 };
  },
  exit() {
    this._stop && this._stop();
    document.documentElement.classList.remove('saving');
    // The page's WebGL context was released for the saver; reload to get it back.
    location.reload();
  },
};
