// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  saver.js — window.snSaver for the shell screensaver
// ----------------------------------------------------------------------------
//  enter(opts) hides the page (html.saving), frees the page's WebGL
//  contexts and plays a seeded shuffle of shots on #saverCv, a 2D canvas
//  in the document. WebGL shots draw on one offscreen WebGL 2 canvas and
//  are copied to #saverCv each frame; the E(R) shot draws straight on it.
//
//  SHOTS   (each 5-12 s, order reshuffled on every pass)
//    accrete .. the hero binary, the dwarf grows toward the trigger mass
//    flash .... carbon ignites, Type Ia flash and ejecta
//    collapse . electron capture: neutron star, or neutron star then hole
//    hole ..... ray-traced Schwarzschild hole, slow orbit and push-in
//    nebula ... fly-through of the procedural planetary nebula
//    er ....... E(R) as the mass passes M_Ch: the minimum disappears
//    dwarf .... cutaway beside the Earth while the mass rises
//  Hero shots set H.side > 0: the camera sits on the far side of the dwarf
//  from the donor, so the donor never fills the frame in front of it.
//  Framing: plateBand() (lib/saver-clear.js) gives the clear band between
//  the plate's top and bottom text; every subject is centred and sized in
//  it (uOff and the zoom for WebGL shots, the plot box for E(R)).
//  The plate: title, numbers of the shot and a real code extract.
//
//  grep -n targets: "const SHOTS", "function frameBand", "function plate",
//  "enter(opts)", "function codeOf"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { heroScene, holeScene, nebulaScene, dwarfScene, MCH, M_IGNITE, M_CAPTURE, radiusOf } from './renders.js';
import { makeGL, releaseAll } from './glkit.js';
import { drawER, fmtE } from './figures.js';
import { HOLE, HERO, NEBULA } from './glsl.js';
import * as P from './physics.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t * t * (3 - 2 * t);

// A source extract: the lines from the first line that contains `from`,
// at most n lines, with the common indent removed.
function codeOf(src, from, n = 12) {
  const L = src.split('\n'); let i = L.findIndex(l => l.includes(from)); if (i < 0) i = 0;
  const part = L.slice(i, i + n);
  const ind = Math.min(...part.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
  return part.map(l => l.slice(ind)).join('\n');
}
const CODE = {
  rk4: { lang: 'js', name: 'physics.js · rk4Step (Lane-Emden, Chandrasekhar)', text: codeOf(P.rk4Step.toString(), 'export function rk4Step') },
  geo: { lang: 'glsl', name: 'glsl.js · HOLE, geodesic step', text: codeOf(HOLE, 'for (int i = 0; i < 260') },
  flash: { lang: 'glsl', name: 'glsl.js · HERO, Type Ia ejecta', text: codeOf(HERO, 'float Rs = 0.12') },
  neb: { lang: 'glsl', name: 'glsl.js · NEBULA, shell density', text: codeOf(NEBULA, 'float dens(vec3 p') },
  energy: { lang: 'js', name: 'physics.js · energyModel, E(R)', text: codeOf(P.energyModel.toString(), 'const at = ') },
  wd: { lang: 'js', name: 'physics.js · whiteDwarf', text: codeOf(P.whiteDwarf.toString(), 'const g = p =>') },
};
// rk4Step.toString() starts at "function rk4Step"; codeOf falls back to line 0.

const MCH_TEX = 'M_{\\rm Ch} = \\frac{\\sqrt{3\\pi}}{2}\\,\\omega_3\\left(\\frac{\\hbar c}{G}\\right)^{3/2}\\frac{1}{(\\mu_e m_u)^2}';
const RULES = [['M_{\\rm Ch}', 'm5'], ['\\omega_3', 'm5'], ['M', 'm2'], ['G', 'm2'], ['R', 'm6'], ['r_s', 'm6'], ['\\rho_c', 'm4'], ['x', 'm1'], ['E', 'm3']];

window.snSaver = {
  enter(opts = {}) {
    const calm = clamp(opts.calm ?? 0.7, 0, 1), slow = 1 - 0.45 * calm;
    let seed = (opts.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const label = typeof opts.label === 'function' ? opts.label : null;

    document.documentElement.classList.add('saving');
    releaseAll();                                   // the page's own contexts
    const cv = document.getElementById('saverCv');
    const ctx = cv.getContext('2d');
    const glc = document.createElement('canvas');
    const G = makeGL(glc);
    const prog = {};
    const scenes = { hero: heroScene(), hole: holeScene(), nebula: nebulaScene(), dwarf: dwarfScene() };
    for (const s of Object.values(scenes)) { s.auto = false; s.held = false; }
    if (G) for (const [k, s] of Object.entries(scenes)) { try { prog[k] = G.program(k, s.frag); } catch (e) { console.error(e); } }
    const ER = P.energyModel(2, 'profile');

    // ── shots ──
    const H = scenes.hero, B = scenes.hole, N = scenes.nebula, W = scenes.dwarf;
    const SHOTS = {
      accrete: {
        gl: 'hero', setup(d) { H.mode = 0; H.reset(1.18 + 0.08 * rnd()); H.rate = (M_IGNITE - 0.004 - H.M) / d; H.side = 0.1 + 0.4 * rnd(); H.aim = 0.2; H.pitch = 0.25 + 0.25 * rnd(); H.spin = 0; },
        frame(p) { H.dist = 9.0 - 2.6 * ease(p); H.zoom = 1.75; },
        plate() {
          const r = radiusOf(Math.min(H.M, MCH * 0.999));
          return { title: 'Accretion toward the Chandrasekhar mass', sub: 'A white dwarf strips gas from its companion; more mass makes it smaller',
            params: [{ sym: 'M/M_{\\rm Ch}', name: 'mass', value: (H.M / MCH).toFixed(3), cls: 'm2' }, { sym: 'R', name: 'radius', value: Math.round(r.R / 1e3).toLocaleString('en') + ' km', cls: 'm6' }, { sym: '\\rho_c', name: 'central density', value: fmtE(r.rhoc / 1e3) + ' g/cm³', cls: 'm4' }],
            tex: [MCH_TEX], rules: RULES, eq: ['M_Ch = (√(3π)/2) ω₃ (ħc/G)^(3/2) / (μₑ m_u)² = 1.456 M☉'], code: CODE.rk4,
            lines: ['Radius from the exact cold mass-radius curve (μₑ = 2); sizes not to scale'] };
        },
      },
      flash: {
        gl: 'hero', min: 8, setup() { H.mode = 0; H.reset(M_IGNITE); H.hold = 1.0; H.side = 0.3 + 0.5 * rnd(); H.aim = 0.7; H.pitch = 0.3 + 0.2 * rnd(); H.spin = 0; },
        frame(p) { H.dist = 6.5 + 5.5 * ease(p); H.zoom = 1.75; },
        plate() {
          return { title: 'Type Ia supernova', sub: 'Carbon ignites in degenerate matter, which cannot expand to cool',
            params: [{ sym: 'M', name: 'at ignition (cold model)', value: M_IGNITE.toFixed(3) + ' M☉', cls: 'm2' }, { sym: '\\rho_c', name: 'central density', value: '2 × 10⁹ g/cm³', cls: 'm4' }, { sym: 't', name: 'since ignition', value: Math.max(0, H.flash).toFixed(1) + ' s (slowed)', cls: 'm1' }],
            lines: ['About 0.6 M☉ of nickel-56 powers the light: a standard candle'], code: CODE.flash };
        },
      },
      collapse: {
        gl: 'hero', min: 9, setup() { H.mode = rnd() < 0.5 ? 1 : 2; H.reset(M_CAPTURE); H.hold = 1.0; H.side = 0.4 + 0.5 * rnd(); H.aim = 0.85; H.pitch = 0.35 + 0.2 * rnd(); H.spin = 0; },
        frame(p) { H.dist = 7.0 - 2.4 * ease(p); H.zoom = 1.75; },
        plate() {
          const hole = H.mode === 2 && H.coll > 2.6;
          return { title: hole ? 'Collapse to a black hole' : 'Collapse to a neutron star', sub: hole ? 'Past the Tolman-Oppenheimer-Volkoff limit no pressure holds' : 'Electron capture removes the pressure; neutrons take over',
            params: [{ sym: 'M', name: 'start', value: M_CAPTURE.toFixed(3) + ' M☉', cls: 'm2' }, { sym: '\\rho_c', name: 'capture density', value: '10¹⁰ g/cm³', cls: 'm4' }, hole ? { sym: 'r_s', name: '2GM/c², 2.5 M☉', value: '7.4 km', cls: 'm6' } : { sym: 'R', name: 'neutron star', value: '≈ 12 km', cls: 'm6' }],
            eq: ['p + e⁻ → n + νₑ'], code: CODE.wd };
        },
      },
      hole: {
        gl: 'hole', setup() { B.yaw = rnd() * 6.28; B.pitch = 0.05 + 0.4 * rnd() * rnd(); B.spin = 0.05 * slow; B.lens = 1; B.shift = 1; B.disk = 1; },
        frame(p) { B.dist = 46 - 16 * ease(p); B.zoom = 1.35; },
        plate() {
          return { title: 'Schwarzschild black hole', sub: 'Null geodesics traced per pixel, thin disk with Doppler and gravitational shift',
            params: [{ sym: 'b', name: 'shadow radius', value: '2.598 rₛ', cls: 'm6' }, { sym: 'r_{\\rm in}', name: 'innermost stable orbit', value: '3 rₛ', cls: 'm6' }, { sym: 'D', name: 'camera distance', value: (B.dist / 2).toFixed(1) + ' rₛ', cls: 'm1' }, { sym: 'i', name: 'above the disk', value: (B.pitch * 57.3).toFixed(0) + '°', cls: 'm1' }],
            tex: ['\\ddot{\\mathbf x} = -\\tfrac{3}{2}\\,r_s\\,h^2\\,\\frac{\\mathbf x}{r^5}, \\qquad g = \\frac{\\sqrt{1-3M/r}}{1-\\Omega\\lambda}'], rules: RULES,
            eq: ['x″ = −(3/2) r_s h² x / r⁵', 'g = √(1 − 3M/r) / (1 − Ωλ)'], code: CODE.geo };
        },
      },
      nebula: {
        gl: 'nebula', setup() { N.fly = 0.001; N.yaw = rnd() * 6.28; N.pitch = 0.2 + 0.4 * rnd(); N.age = 0.3 + 0.5 * rnd(); N.pinch = rnd(); N.spin = 0.05 * slow; },
        frame(p) { N.fly = 0.05 + 0.9 * p; N.zoom = 1.4; },
        plate() {
          return { title: 'A planetary nebula, procedural', sub: 'The shed envelope of a Sun-like star around its new white dwarf',
            params: [{ sym: 'a', name: 'age (shell)', value: N.age.toFixed(2), cls: 'm6' }, { sym: 'w', name: 'waist', value: N.pinch.toFixed(2), cls: 'm6' }],
            lines: ['Teal: [O III] near the hot core; red: H-alpha and [N II] outside', '64 ray-march steps per pixel through ridged fbm'], code: CODE.neb };
        },
      },
      er: {
        gl: null, setup() { this.M0 = 1.15 + 0.1 * rnd(); this.M1 = 1.62 + 0.1 * rnd(); },
        frame(p) { this.M = this.M0 + (this.M1 - this.M0) * ease(p); },
        plate() {
          const mn = ER.minimum(this.M);
          return { title: 'E(R) loses its minimum', sub: 'Relativistic electrons and gravity both scale as 1/R',
            params: [{ sym: 'M/M_{\\rm Ch}', name: 'mass', value: (this.M / MCH).toFixed(3), cls: 'm2' }, { sym: 'R', name: 'equilibrium', value: mn ? Math.round(mn.R / 1e3) + ' km' : 'none: collapse', cls: 'm6' }, { sym: 'x', name: 'Fermi momentum / mₑc there', value: mn ? mn.x.toFixed(2) : '→ ∞', cls: 'm1' }],
            tex: ['E(R) \\approx \\frac{a\\,\\hbar c\\,N^{4/3} - \\alpha_g G M^2}{R}'], rules: RULES, eq: ['E(R) ≈ (a ħc N^(4/3) − α_g G M²) / R'], code: CODE.energy };
        },
      },
      dwarf: {
        gl: 'dwarf', setup() { this.M0 = 0.55 + 0.2 * rnd(); this.M1 = 1.38 + 0.05 * rnd(); W.yaw = -0.4 + 0.8 * rnd(); W.pitch = 0.3 + 0.2 * rnd(); W.spin = 0.03 * slow * (rnd() < 0.5 ? -1 : 1); W.setMass(this.M0); this.last = -1; },
        frame(p) { const M = this.M0 + (this.M1 - this.M0) * ease(p); if (Math.abs(M - this.last) > 0.004) { W.setMass(M); this.last = M; } W.zoom = 1.7; },
        plate() {
          const w = W.model;
          return { title: 'Inside a white dwarf, beside the Earth', sub: 'The solved density profile; heavier means smaller',
            params: [{ sym: 'M', name: 'mass', value: W.M.toFixed(3) + ' M☉', cls: 'm2' }, { sym: 'R', name: 'radius', value: Math.round(w.R / 1e3).toLocaleString('en') + ' km', cls: 'm6' }, { sym: '\\rho_c', name: 'central density', value: fmtE(w.rhoc / 1e3) + ' g/cm³', cls: 'm4' }, { sym: 'x_c', name: 'central Fermi momentum / mₑc', value: w.xc.toFixed(2), cls: 'm1' }],
            lines: ['Cyan ring: Fermi momentum = mₑc; inside it the fastest electrons exceed 0.7 c'], code: CODE.rk4 };
        },
      },
    };
    const keys = Object.keys(SHOTS).filter(k => !SHOTS[k].gl || (G && prog[SHOTS[k].gl]));
    let order = [], oi = 0;
    const shuffle = () => { order = keys.slice(); for (let j = order.length - 1; j > 0; j--) { const q = Math.floor(rnd() * (j + 1)); [order[j], order[q]] = [order[q], order[j]]; } oi = 0; };
    shuffle();

    // ── framing ──
    let band = null, bandAt = -1e9;
    function frameBand(Wc, Hc) {
      const now = performance.now();
      // While the shell swaps plates the label is briefly off and
      // plateBand() gives null. Keep the last band then, so the subject
      // does not jump to full frame between two plates.
      if (now - bandAt > 250) { bandAt = now; const nb = plateBand(Hc); if (nb || !label) band = nb; }
      if (!band) return { cy: Hc / 2, h: Hc, w: Wc };
      const h = Math.max(0.28 * Hc, Hc - band.t - band.b);
      return { cy: band.t + h / 2, h, w: Math.min(Wc, band.w || Wc) };
    }

    // ── loop ──
    let shot = null, sk = '', t0 = 0, dur = 8, raf = 0, last = performance.now(), scale = 0.8, slowN = 0, fastN = 0, plateAt = 0, fr = null;
    const next = () => {
      if (oi >= order.length) { const prev = order[order.length - 1]; shuffle(); if (order[0] === prev && order.length > 1) [order[0], order[1]] = [order[1], order[0]]; }
      sk = order[oi++]; shot = SHOTS[sk];
      dur = Math.max(shot.min || 5, (5 + 7 * rnd()) * (0.85 + 0.3 * calm));
      t0 = performance.now(); shot.setup(dur); plateAt = 0;
    };
    const send = () => { if (label) { const info = shot.plate(); info.anchor = fr ? { x: innerWidth / 2, y: fr.cy, r: fr.h * 0.38 } : undefined; label(info); } };
    next();
    const tick = now => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000) * slow; last = now;
      const el = (now - t0) / 1000;
      if (el > dur) { next(); return; }
      const p = clamp(el / dur, 0, 1);
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      const Wc = innerWidth, Hc = innerHeight;
      const cw = Math.round(Wc * dpr), ch = Math.round(Hc * dpr);
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      const f = frameBand(Wc, Hc);
      fr = fr ? { cy: fr.cy + (f.cy - fr.cy) * 0.1, h: fr.h + (f.h - fr.h) * 0.1, w: f.w } : f;
      shot.frame(p);
      const t1 = performance.now();
      if (shot.gl) {
        const S = scenes[shot.gl];
        S.step(dt);
        const bw = Math.max(2, Math.round(cw * scale)), bh = Math.max(2, Math.round(ch * scale));
        const k = bh / Hc;
        S.off = [0, (Hc / 2 - fr.cy) * k];
        // Scale the subject to the clear band after the scene's own fit.
        const U = S.uniforms(bw, bh);
        U.uZoom *= clamp(fr.h / Hc * 1.08, 0.45, 1);
        G.draw(prog[shot.gl], U, bw, bh);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(glc, 0, 0, cw, ch);
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#04060b'; ctx.fillRect(0, 0, cw, ch);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Drawn at 1.5x: the plot's 11-12 px text becomes 17-18 px.
        const k = 1.5;
        ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
        const bw = Math.min(fr.w * 0.86, 1100) / k, bh = Math.min(fr.h * 0.94, 620) / k;
        const box = { x: (Wc / k - bw) / 2 + 30, y: fr.cy / k - bh / 2, w: bw - 30, h: bh - 22 };
        drawER(ctx, Wc / k, Hc / k, shot.M, ER, null, { box, xl: 'R', yl: 'E' });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      // Fade in and out at the cuts.
      const fade = Math.max(clamp(1 - el / 0.6, 0, 1), clamp(1 - (dur - el) / 0.5, 0, 1));
      if (fade > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, cw, ch); }
      // Adaptive buffer scale from the frame interval.
      const ms = performance.now() - t1;
      if (dt / slow > 0.034 || ms > 25) { if (++slowN > 10) { scale = Math.max(0.4, scale * 0.88); slowN = 0; } fastN = 0; }
      else if (dt / slow < 0.019) { if (++fastN > 120) { scale = Math.min(1, scale * 1.08); fastN = 0; } slowN = 0; }
      if (now - plateAt > (sk === 'er' ? 300 : 1000)) { plateAt = now; send(); }
    };
    raf = requestAnimationFrame(tick);
    this._stop = () => cancelAnimationFrame(raf);
    this.debug = () => ({ shot: sk, el: +((performance.now() - t0) / 1000).toFixed(1), dur: +dur.toFixed(1), order, oi, scale: +scale.toFixed(2), band, fr, gl: !!G, mass: H.M, flash: H.flash, coll: H.coll });
    return { canvas: cv, warmupMs: 1200 };
  },
  exit() {
    this._stop && this._stop();
    document.documentElement.classList.remove('saving');
    // The page's WebGL contexts were released for the saver; reload to get them back.
    location.reload();
  },
};
