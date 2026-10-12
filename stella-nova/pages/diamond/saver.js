// ============================================================================
//  DIAMOND LAB  ·  saver.js — the screensaver director (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm 0..1, seconds, caption, seed, label }. enter() hides the GUI and
//  plays a seeded run of shots, one every 6 to 12 s (calm 1 is slowest):
//
//    turntable   three-quarter view, slow turn, studio light
//    crown       face up: the crown as a kaleidoscope, a light sweeps over
//    profile     low side view: pavilion, girdle and the light that leaks
//    macro       a slow push in on the crown facets
//    fire        dark rig with hard spots: dispersion flashes (fire)
//    rise        the camera rises from below the girdle to above the table
//    morph       no cut: the same stone changes material in place
//    daylight    a bright sky and a sun
//
//  Each shot except morph takes the next cut and the next stone from two
//  seeded bags, behind a short fade through black. A morph keeps the cut
//  and eases the optics (index, Abbe number, absorption) to a new stone
//  half way through the shot. The camera eases from the shot's start
//  (pitch, zoom) to its end; the yaw turns and the light rig drifts.
//
//  The stone is framed in the clear band of the label plate (plateBand,
//  through app.band()). The plate names cut and stone, the optics numbers
//  and the equations of the effect the shot shows. No code on the plate.
//
//  This module does not touch the DOM: main.js passes the app object
//  (state, setCut, setMaterial, onTick, band, anchor, hideUI). tests.mjs
//  runs the director with a stub app.
//
//  GREP MAP
//    const SHOTS ......... the shot table
//    function makeRng .... the seeded generator (mulberry32)
//    function plateFor ... the plate payload
//    function makeSaver .. { enter, exit }
// ============================================================================
import { MATERIALS, materialStats } from './optics.js';
import { CUTS } from './cuts.js';

// pitch and zoom: [start, end] over the hold. yaw: turn rate (rad/s).
// sweep: speed of the light sweep (0: no sweep). rig: drift of the rig.
export const SHOTS = {
  turntable: { env: 0, pitch: [0.52, 0.42], zoom: [1.0, 1.12], yaw: 0.22, sweep: 0, rig: 0.05, exposure: 1.0, fire: 1, sub: 'Total internal reflection returns the light through the crown', tex: 'tir' },
  crown:     { env: 0, pitch: [1.36, 1.42], zoom: [1.0, 1.22], yaw: 0.08, sweep: 0.35, rig: 0.02, exposure: 1.0, fire: 1, sub: 'Face up: each crown facet shows a mirror of the pavilion', tex: 'tir' },
  profile:   { env: 3, pitch: [0.04, 0.16], zoom: [1.05, 1.12], yaw: 0.16, sweep: 0, rig: 0.04, exposure: 1.1, fire: 1, sub: 'From the side: light past the critical angle cannot leave the pavilion', tex: 'crit' },
  macro:     { env: 0, pitch: [0.78, 0.7], zoom: [1.6, 2.4], yaw: 0.05, sweep: 0.22, rig: 0.03, exposure: 1.0, fire: 1.2, sub: 'Close in: Fresnel reflection on the facets, refraction under them', tex: 'fresnel' },
  fire:      { env: 1, pitch: [0.62, 0.5], zoom: [1.1, 1.3], yaw: 0.12, sweep: 0, rig: 0.06, exposure: 1.35, fire: 1.5, sub: 'Fire: blue bends more than red, so a white spark leaves as a spectrum', tex: 'disp', fiery: true },
  rise:      { env: 0, pitch: [-0.3, 1.05], zoom: [1.0, 1.15], yaw: 0.1, sweep: 0, rig: 0.03, exposure: 1.0, fire: 1, sub: 'From below the girdle to above the table', tex: 'crit' },
  morph:     { env: 0, pitch: [0.48, 0.6], zoom: [1.05, 1.15], yaw: 0.18, sweep: 0.25, rig: 0.04, exposure: 1.0, fire: 1, sub: 'Same cut, new stone: index, dispersion and colour change in place', tex: 'beer', morph: true },
  daylight:  { env: 2, pitch: [0.45, 0.55], zoom: [1.0, 1.1], yaw: 0.15, sweep: 0, rig: 0.04, exposure: 0.72, fire: 1, sub: 'Daylight: a bright sky and one sun', tex: 'beer' },
};
export const SHOT_KEYS = Object.keys(SHOTS);
const FIERY = ['diamond', 'moissanite', 'cz', 'yellow'];

export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(a, rnd) { const o = a.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }
// A bag: draws every item once in a seeded order, then reshuffles; never
// the same item twice in a row.
export function bag(items, rnd) {
  let q = [], last = null;
  return () => {
    if (!q.length) { q = shuffle(items, rnd); if (q.length > 1 && q[0] === last) q.push(q.shift()); }
    last = q.shift(); return last;
  };
}

const TEX = {
  snell: String.raw`n_1\sin\theta_1 = n_2\sin\theta_2`,
  crit: String.raw`\theta_c = \arcsin\frac{1}{n}`,
  tir: String.raw`\theta > \theta_c \;\Rightarrow\; R = 1`,
  fresnel: String.raw`R_0 = \Bigl(\frac{n-1}{n+1}\Bigr)^{2}`,
  disp: String.raw`n(\lambda) = A + \frac{B}{\lambda^{2}},\quad \nu_d = \frac{n_d-1}{n_F-n_C}`,
  beer: String.raw`I = I_0\,e^{-\sigma L}`,
};
const EQ = {
  snell: 'n₁ sin θ₁ = n₂ sin θ₂', crit: 'θc = arcsin(1/n)', tir: 'θ > θc ⇒ R = 1',
  fresnel: 'R₀ = ((n − 1)/(n + 1))²', disp: 'n(λ) = A + B/λ²,  ν = (n_d − 1)/(n_F − n_C)', beer: 'I = I₀ e^(−σL)',
};
export const RULES = [['n', 'm1'], ['n_1', 'm1'], ['n_2', 'm1'], ['n_d', 'm1'], ['\\theta_c', 'm2'], ['\\theta', 'm2'], ['\\lambda', 'm3'], ['\\nu_d', 'm3'], ['R_0', 'm4'], ['R', 'm4'], ['\\sigma', 'm5'], ['L', 'm5']];

// The plate payload for the stone on screen.
export function plateFor(app, shot) {
  const S = app.S, m = MATERIALS[S.mat], ms = materialStats(m), C = CUTS[S.cut], g = app.geom();
  const sh = SHOTS[shot] || SHOTS.turntable;
  const tinted = m.absorb.some(v => v > 0.3);
  const keys = ['snell', sh.tex === 'tir' || sh.tex === 'crit' ? sh.tex : 'crit'];
  if (sh.tex === 'disp' || sh.tex === 'fresnel') keys.push(sh.tex);
  else if (sh.tex === 'tir') keys.push('crit');
  if (tinted || sh.tex === 'beer') keys.push('beer');
  const uniq = [...new Set(keys)];
  const dot = C.note.indexOf('. ');
  const lines = [dot > 0 ? C.note.slice(0, dot + 1) : C.note];
  if (g) lines.push(`${g.stats.facets} facets · ${g.stats.planes} planes traced · ${S.bounces} bounces`);
  return {
    title: C.name + ' · ' + m.name,
    sub: sh.morph ? sh.sub : (sh.sub + (shot === 'fire' && S.fire > 1.01 ? ' (fire shown ×' + S.fire.toFixed(1) + ')' : '')),
    params: [
      { sym: 'n_d', name: 'refractive index', value: ms.nd.toFixed(3), cls: 'm1' },
      { sym: '\\theta_c', name: 'critical angle', value: ms.critDeg.toFixed(1) + '°', cls: 'm2' },
      { sym: '\\nu_d', name: 'Abbe number', value: String(ms.abbe), cls: 'm3' },
      { sym: '\\Delta n_{BG}', name: 'dispersion, B to G line', value: ms.bg.toFixed(3), cls: 'm3' },
      { sym: 'R_0', name: 'reflectance, straight on', value: (100 * ms.r0).toFixed(1) + '%', cls: 'm4' },
    ],
    tex: uniq.map(k => TEX[k]), eq: uniq.map(k => EQ[k]), rules: RULES, lines,
    anchor: () => app.anchor(),
  };
}

export function makeSaver(app) {
  let off = null, timer = null;
  return {
    enter(opts = {}) {
      const S = app.S;
      const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7));
      const rnd = makeRng(opts.seed);
      const label = typeof opts.label === 'function' ? opts.label : null;
      app.hideUI();
      Object.assign(S, { saver: true, spin: false, mode: 0, bounces: Math.max(S.bounces, 8), fade: 1, sweep: false });
      const nextShot = bag(SHOT_KEYS, rnd), nextCut = bag(app.cuts, rnd), nextMat = bag(app.materials, rnd);
      const fieryBag = bag(FIERY, rnd);
      let shot = null, sh = null, phase = 'in', t = 0, hold = 8, morphAt = Infinity, rig0 = rnd() * 6.283, queued = null;
      let p0 = 0, p1 = 0, z0 = 1, z1 = 1;
      const plate = () => { if (label && shot) label(plateFor(app, shot)); };
      const start = (key) => {
        shot = key; sh = SHOTS[key]; t = 0;
        hold = 6 + 4.5 * calm + rnd() * 1.5;
        if (!sh.morph) {
          app.setCut(nextCut());
          app.setMaterial(sh.fiery ? fieryBag() : nextMat(), 0.01);
        }
        morphAt = sh.morph ? hold * (0.3 + 0.2 * rnd()) : Infinity;
        // a morph keeps the light of the last shot too
        if (!sh.morph) { S.env = sh.env; S.exposure = sh.exposure; S.fire = sh.fire; S.sweep = sh.sweep > 0; S.sweepAz = rnd() * 6.283; }
        // a morph goes on from the camera of the last shot; other shots cut
        if (sh.morph) { p0 = S.cam.pitch; z0 = S.cam.zoom; }
        else { p0 = sh.pitch[0]; z0 = sh.zoom[0]; S.cam.yaw = rnd() * 6.283; S.rig = rig0 + rnd() * 2; S.spark = 0.9 + 0.3 * rnd(); }
        p1 = sh.pitch[1]; z1 = sh.zoom[1];
        S.cam.pitch = p0; S.cam.zoom = z0;
        plate();
      };
      const pick = () => { let k = nextShot(); if (k === 'morph' && !shot) k = nextShot(); return k; };
      start(pick());
      S.band = app.band();
      timer = setInterval(() => { S.band = app.band(); plate(); }, 1000);
      const FADE_OUT = 0.6, FADE_IN = 0.9;
      off = app.onTick(dt => {
        t += dt;
        const e = Math.min(1, t / hold), s = e * e * (3 - 2 * e);
        S.cam.pitch = p0 + (p1 - p0) * s;
        S.cam.zoom = z0 + (z1 - z0) * s;
        S.cam.yaw += dt * sh.yaw * (1.15 - 0.45 * calm);
        S.rig += dt * sh.rig;
        if (S.sweep) S.sweepAz += dt * Math.max(sh.sweep, 0.2) * (1.1 - 0.4 * calm);
        if (t >= morphAt) {
          morphAt = Infinity;
          let k = nextMat(); if (k === S.mat) k = nextMat();
          app.setMaterial(k, 1.4); plate();
        }
        if (phase === 'in') { S.fade = Math.max(0, S.fade - dt / FADE_IN); if (S.fade <= 0) phase = 'show'; }
        else if (phase === 'show' && t >= hold) {
          const k = pick();
          if (k === 'morph') { start(k); }        // a morph keeps the stone on screen: no fade
          else { phase = 'out'; queued = k; }
        } else if (phase === 'out') {
          S.fade = Math.min(1, S.fade + dt / FADE_OUT);
          if (S.fade >= 1) { start(queued); phase = 'in'; }
        }
      });
      return { canvas: app.canvas, warmupMs: 1500 };
    },
    exit() { if (off) off(); off = null; clearInterval(timer); app.S.saver = false; app.S.fade = 0; },
  };
}
