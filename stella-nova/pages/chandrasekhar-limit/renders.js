// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  renders.js — the four WebGL scenes
// ----------------------------------------------------------------------------
//  A scene is plain state plus step(dt) and uniforms(w, h). mountScene()
//  puts a scene on a page canvas. saver.js puts the same scenes on its own
//  canvas, so the page and the saver show one model.
//
//  SCENES   (jump with grep -n "<anchor>" renders.js)
//    hero .......... "export function heroScene"    accretion to the limit,
//                                                   then Type Ia, or collapse
//    black hole .... "export function holeScene"    geodesic ray tracer
//    nebula ........ "export function nebulaScene"  our planetary nebula
//    cutaway ....... "export function dwarfScene"   solved density profile
//    mount ......... "export function mountScene"   canvas + loop + drag
//
//  Real numbers: the hero's dwarf radius comes from the exact M-R curve
//  (physics.js); its trigger masses are where the cold mu_e = 2 model
//  reaches rho_c = 2e9 g/cm^3 (carbon ignites) or 1e10 g/cm^3 (electron
//  capture on Ne and Mg). Sizes in the hero are not to scale: the dwarf
//  radius is log-scaled so that it shows at all.
// ============================================================================
import { HERO, HOLE, NEBULA, DWARF } from './glsl.js';
import { makeGL, runLoop, dragOrbit } from './glkit.js';
import * as P from './physics.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const orbitPos = (tgt, d, yaw, pitch) => [tgt[0] + d * Math.cos(pitch) * Math.sin(yaw), tgt[1] + d * Math.sin(pitch), tgt[2] + d * Math.cos(pitch) * Math.cos(yaw)];

// M -> R table from the exact curve (mu_e = 2), for interpolation.
let MR = null;
export function mrTable() {
  if (!MR) MR = P.massRadiusCurve(2, { n: 90, x0: 0.05, x1: 400 });
  return MR;
}
export function radiusOf(M) {
  const T = mrTable();
  if (M <= T[0].M) return { R: T[0].R * (T[0].M / M) ** (1 / 3), rhoc: T[0].rhoc };
  for (let i = 1; i < T.length; i++) if (T[i].M >= M) {
    const a = T[i - 1], b = T[i], f = (M - a.M) / (b.M - a.M);
    return { R: a.R + f * (b.R - a.R), rhoc: Math.exp(Math.log(a.rhoc) + f * Math.log(b.rhoc / a.rhoc)) };
  }
  return { R: T[T.length - 1].R, rhoc: T[T.length - 1].rhoc };
}
const rr = radiusOf;
export const MCH = P.massChandra(2).Msun;
export const M_IGNITE = P.whiteDwarf(P.eos(2).xOf(2e12)).M;     // rho_c = 2e9 g/cm^3
export const M_CAPTURE = P.whiteDwarf(P.eos(2).xOf(1e13)).M;    // rho_c = 1e10 g/cm^3

// ── hero ───────────────────────────────────────────────────────────────────
export function heroScene() {
  const S = {
    frag: HERO, name: 'hero',
    M: 1.0, rate: 0.012, mode: 0, flash: -1, coll: -1, phase: 0, t: 0,
    yaw: 0.6, pitch: 0.34, dist: 7.4, zoom: 1.75, held: false, spin: 0.05, off: [0, 0], aim: 0, side: null,
    auto: true, hold: 0, events: [],
    trigger() { return this.mode === 0 ? M_IGNITE : M_CAPTURE; },
    reset(M = 1.0) { this.M = M; this.flash = -1; this.coll = -1; this.hold = 0; },
    step(dt) {
      this.t += dt; this.phase += dt * 0.16;
      if (!this.held) this.yaw += dt * this.spin;
      if (this.flash < 0 && this.coll < 0) {
        this.M = Math.min(this.trigger(), this.M + this.rate * dt);
        if (this.M >= this.trigger() - 1e-9) {
          this.hold += dt;
          if (this.hold > 1.2) { if (this.mode === 0) this.flash = 0; else this.coll = 0; this.events.push(this.mode === 0 ? 'flash' : 'collapse'); }
        }
      } else if (this.flash >= 0) { this.flash += dt; if (this.auto && this.flash > 11) this.reset(); }
      else { this.coll += dt; if (this.auto && this.coll > 12) this.reset(); }
    },
    numbers() {
      const { R, rhoc } = rr(Math.min(this.M, MCH * 0.999));
      return { M: this.M, ratio: this.M / MCH, R, rhoc, gone: this.flash >= 0.05, coll: this.coll >= 0 };
    },
    uniforms() {
      const { R } = rr(Math.min(this.M, MCH * 0.999));
      const wdr = clamp(0.034 * Math.pow(R / 5.6e6, 0.55), 0.012, 0.06);
      // aim 0: look between the stars; aim 1: look at the dwarf.
      const k = 0.33 * (1 - this.aim);
      const c = [-3 * Math.cos(this.phase) * k, 0, -3 * Math.sin(this.phase) * k];
      // side: a yaw offset from the line of the stars (the saver keeps the
      // donor beside the dwarf, not in front of it).
      if (this.side != null) this.yaw = Math.atan2(-Math.cos(this.phase), -Math.sin(this.phase)) + Math.PI / 2 + this.side;
      return {
        uTime: this.t, uOff: this.off,
        uCamPos: orbitPos(c, this.dist, this.yaw, this.pitch), uCamTgt: c, uZoom: this.zoom,
        uPhase: this.phase, uWDr: wdr, uMass: this.M / MCH, uFlash: this.flash, uColl: this.coll,
        uMode: { i: this.mode }, uFlow: this.flash >= 0 ? 0 : 0.6 + 0.4 * clamp(this.rate / 0.02, 0, 1),
      };
    },
  };
  return S;
}

// ── black hole ─────────────────────────────────────────────────────────────
export function holeScene() {
  return {
    frag: HOLE, name: 'hole',
    t: 0, yaw: 0.3, pitch: 0.16, dist: 38, zoom: 1.3, held: false, spin: 0.03, off: [0, 0],
    disk: 1, shift: 1, lens: 1, rin: 6, rout: 15,
    step(dt) { this.t += dt; if (!this.held) this.yaw += dt * this.spin; },
    uniforms() {
      return {
        uTime: this.t, uOff: this.off, uCamPos: orbitPos([0, 0, 0], this.dist, this.yaw, this.pitch), uCamTgt: [0, 0, 0], uZoom: this.zoom,
        uDiskOn: this.disk, uShiftOn: this.shift, uLensOn: this.lens, uRin: this.rin, uRout: this.rout,
      };
    },
  };
}

// ── planetary nebula ───────────────────────────────────────────────────────
export function nebulaScene() {
  return {
    frag: NEBULA, name: 'nebula',
    t: 0, yaw: 0.4, pitch: 0.35, dist: 4.0, zoom: 1.5, held: false, spin: 0.04, off: [0, 0],
    age: 0.45, pinch: 0.55, fly: 0,
    step(dt) { this.t += dt; if (!this.held) this.yaw += dt * this.spin; },
    uniforms() {
      // fly > 0: the camera moves in through the shell along a slow curve.
      let pos, tgt = [0, 0, 0];
      if (this.fly > 0) {
        const s = this.fly, d = 3.8 - 2.3 * (0.5 - 0.5 * Math.cos(Math.min(1, s) * Math.PI));
        pos = orbitPos([0, 0, 0], d, this.yaw, this.pitch * (1 - 0.5 * s));
        tgt = [0.25 * Math.sin(this.t * 0.2), 0.1, 0.25 * Math.cos(this.t * 0.17)];
      } else pos = orbitPos(tgt, this.dist, this.yaw, this.pitch);
      return { uTime: this.t, uOff: this.off, uCamPos: pos, uCamTgt: tgt, uZoom: this.zoom, uAge: this.age, uPinch: this.pinch };
    },
  };
}

// ── white-dwarf cutaway ────────────────────────────────────────────────────
export function dwarfScene() {
  const S = {
    frag: DWARF, name: 'dwarf',
    t: 0, yaw: 0.0, pitch: 0.38, held: false, spin: 0, off: [0, 0], zoom: 1.7,
    M: 1.018, model: null, rho: new Float32Array(48), vf: new Float32Array(48), rel: 0,
    setMass(M) {
      const m = P.dwarfOfMass(M, 2, { keep: 400 });
      if (!m) return null;
      this.M = M; this.model = m;
      const pr = m.prof;
      for (let i = 0; i < 48; i++) {
        const s = i / 47; let j = 1;
        while (j < pr.length - 1 && pr[j].s < s) j++;
        const a = pr[j - 1], b = pr[j], f = clamp((s - a.s) / Math.max(1e-9, b.s - a.s), 0, 1);
        const x = a.x + f * (b.x - a.x);
        this.rho[i] = Math.max(1e-7, (x / m.xc) ** 3);
        this.vf[i] = x / Math.sqrt(1 + x * x);
      }
      this.rel = 0;
      if (m.xc > 1) for (let j = 1; j < pr.length; j++) if (pr[j].x < 1) { const a = pr[j - 1], b = pr[j]; this.rel = a.s + (a.x - 1) / (a.x - b.x) * (b.s - a.s); break; }
      // Mass share inside x = 1: integrate rho s^2 ds.
      let tot = 0, inn = 0;
      for (let j = 1; j < pr.length; j++) {
        const ds = pr[j].s - pr[j - 1].s, w = 0.5 * (pr[j].rho * pr[j].s ** 2 + pr[j - 1].rho * pr[j - 1].s ** 2) * ds;
        tot += w; if (pr[j].s <= this.rel) inn += w;
      }
      this.relShare = this.rel > 0 ? inn / tot : 0;
      return m;
    },
    step(dt) { this.t += dt; if (!this.held) this.yaw += dt * this.spin; },
    uniforms(w = 16, h = 9) {
      const Re = P.K.Rearth, uR = this.model.R / Re, gap = 0.35;
      // The two bodies lie along the axis across the view (lat).
      const view = Math.PI / 4 + this.yaw;
      const lat = [Math.cos(view), 0, -Math.sin(view)];
      const xw = -uR - gap / 2 + (uR - 1) / 2, xe = 1 + gap / 2 + (uR - 1) / 2;
      const W = 2 * uR + 2 + gap, Hh = Math.max(uR, 1);
      // screenUV divides by min(w/1.6, h/0.82): the half-spans on screen.
      const s = Math.min(w / 1.6, h / 0.82), hx = (w / 2) / s, hy = (h / 2) / s;
      const dist = Math.max(3.2, (W / 2) / (hx / this.zoom) * 1.15, Hh / (hy / this.zoom) * 1.25);
      return {
        uTime: this.t, uOff: this.off, uZoom: this.zoom,
        uCamPos: orbitPos([0, 0, 0], dist, view, this.pitch), uCamTgt: [0, 0, 0],
        uR, uWD: lat.map(v => v * xw), uEarth: lat.map(v => v * xe), uRel: this.rel, uRho: this.rho, uVf: this.vf,
      };
    },
  };
  S.setMass(S.M);
  return S;
}

// ── mount ──────────────────────────────────────────────────────────────────
// Put a scene on a canvas. Returns null with no WebGL 2 (the caller shows
// the fallback). onFrame(scene) runs after each draw (readouts).
export function mountScene(canvas, scene, { drag = true, maxDpr = 1.5, budgetMs = 22, onFrame, pitch = [-0.2, 1.2] } = {}) {
  let G;
  try { G = makeGL(canvas); } catch (e) { G = null; }
  if (!G) return null;
  let prog;
  try { prog = G.program(scene.name, scene.frag); }
  catch (e) { console.error(e); return null; }
  if (drag) dragOrbit(canvas, scene, { pitchMin: pitch[0], pitchMax: pitch[1] });
  const loop = runLoop(canvas, (dt, t, w, h) => {
    if (G.lost()) return;
    scene.step(dt);
    G.draw(prog, scene.uniforms(w, h), w, h);
    onFrame && onFrame(scene);
  }, { maxDpr, budgetMs });
  return { G, loop, scene };
}
