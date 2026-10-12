// ============================================================================
//  GRAVITY LAB  ·  experiments/common.js — builders shared by the experiments
// ----------------------------------------------------------------------------
//  THE SPEC. Every experiment's build(seed, o) returns one spec object:
//    key, title, variant, seed, blurb (one line), story (lines)
//    scale      data.js unitsOf: real metres, kilograms, seconds per unit
//    bodies     nbody.js System bodies, plus for the renderer: kind
//               (star, rock, gas, ice, moon, comet, probe, core, bh),
//               color [r, g, b] 0..1, rDraw (drawn radius, sim units; may
//               be larger than r: see notes)
//    opts       System options (eta, watch, burns, escapeR, ejecta, ...)
//    particles  { n, pos, vel, size, group (Uint8Array), groups:
//               [{ name, color }] } (restricted mode)  — or —
//    self       { n, pos, vel, mass, eps, size, group, groups }
//    pool       rows kept free for debris and ejecta
//    dt         the particle step (sim time); rate: sim time per second
//               of real time at Normal speed; duration: the sim time of
//               the story (the saver may cut sooner)
//    view       { center: 'com' | body index, extent (half width, sim
//               units), tilt (deg above the orbit plane), rotating:
//               [i, j] (film in the frame that turns with the pair) }
//    cues       event types worth a cut (the saver and the story camera)
//    tex        TeX lines for the plate; facts: [[label, value]] with
//               real numbers; notes: the simplifications, in plain words;
//               sources: data.js SOURCES keys
//
//  o: { n: the particle budget (desktop 16384, phone 4096), variant }
//
//  grep -n targets: "export class Parts", "export function disk",
//  "export function body", "export function runCpu", "export const fmt"
// ============================================================================
import { rng, gauss, v3, rotate, elementsToState, toCOM, period } from '../nbody.js';
import { Lab, CpuRestricted, CpuSelf, MAX_S } from '../lab.js';

export const DEG = Math.PI / 180;
export const COLORS = {
  sun: [1.0, 0.86, 0.62], star: [1.0, 0.92, 0.8], redDwarf: [1.0, 0.55, 0.35], blue: [0.7, 0.8, 1.0],
  earth: [0.35, 0.55, 0.95], moon: [0.7, 0.7, 0.68], mars: [0.85, 0.45, 0.28], jupiter: [0.86, 0.72, 0.55],
  saturn: [0.92, 0.82, 0.6], ice: [0.75, 0.88, 1.0], neptune: [0.35, 0.5, 0.95], rock: [0.62, 0.55, 0.5],
  probe: [0.95, 0.95, 0.95], comet: [0.8, 0.9, 1.0], core: [1.0, 0.9, 0.75], bh: [0.02, 0.02, 0.02],
  dust: [0.85, 0.78, 0.66], hot: [1.0, 0.55, 0.25], cyan: [0.45, 0.9, 1.0], violet: [0.75, 0.6, 1.0],
  green: [0.55, 0.95, 0.6], amber: [1.0, 0.75, 0.3], rose: [1.0, 0.5, 0.6],
};

// A body for the System, with the renderer's fields.
export function body(name, kind, m, r, x, v, extra = {}) {
  return Object.assign({ name, kind, m, r, x: x.slice(), v: v.slice(), color: COLORS[kind] || COLORS.rock, rDraw: r }, extra);
}
// The body on an orbit about a parent body (or a point { m, x, v }).
export function orbiting(parent, name, kind, m, r, el, extra = {}) {
  const s = elementsToState(parent.m + m, el);
  return body(name, kind, m, r, v3.add(parent.x, s.r), v3.add(parent.v, s.v), extra);
}

export class Parts {
  constructor() { this.pos = []; this.vel = []; this.group = []; this.groups = []; }
  g(name, color) { this.groups.push({ name, color: color || COLORS.dust }); return this.groups.length - 1; }
  add(p, v, g) { this.pos.push(p[0], p[1], p[2]); this.vel.push(v[0], v[1], v[2]); this.group.push(g); }
  get n() { return this.group.length; }
  done(size) {
    return { n: this.n, pos: Float64Array.from(this.pos), vel: Float64Array.from(this.vel), group: Uint8Array.from(this.group), groups: this.groups, size };
  }
}

// Unit vector basis for a plane with normal nrm: rotate z to nrm.
export function tiltFn(nrm) {
  const n = v3.norm(nrm), k = v3.cross([0, 0, 1], n), s = v3.len(k);
  if (s < 1e-12) return n[2] > 0 ? (a => a) : (a => [a[0], -a[1], -a[2]]);
  const ax = v3.mul(k, 1 / s), t = Math.atan2(s, n[2]);
  return a => rotate(a, ax, t);
}
export function normalOf(incl, node) { return [Math.sin(incl) * Math.sin(node), -Math.sin(incl) * Math.cos(node), Math.cos(incl)]; }

// A disk of test particles about a centre { m, x, v } (GM = m, or o.GM).
// o: { n, rin, rout, profile ('area' | 'r'), emax, h (thickness / r),
//      normal, retro, g (group), rand }
export function disk(P, c, o) {
  const r = o.rand, GM = o.GM ?? c.m, tilt = tiltFn(o.normal || [0, 0, 1]);
  for (let k = 0; k < o.n; k++) {
    const u = r();
    const a = o.profile === 'r' ? o.rin + (o.rout - o.rin) * u : Math.sqrt(o.rin ** 2 + (o.rout ** 2 - o.rin ** 2) * u);
    const e = (o.emax || 0) * r(), inc = (o.h || 0) * gauss(r);
    const s = elementsToState(GM, { a, e, i: Math.abs(inc), O: 2 * Math.PI * r(), w: 2 * Math.PI * r(), M: 2 * Math.PI * r() });
    let p = s.r, v = s.v;
    if (o.retro) v = v3.mul(v, -1);
    p = tilt(p); v = tilt(v);
    P.add(v3.add(c.x, p), v3.add(c.v, v), o.g);
  }
}
// A round cloud of test particles in circular orbits of random planes
// about a centre: rin..rout. prograde 1 (about +z), -1 (retrograde), 0
// (any plane).
export function halo(P, c, o) {
  const r = o.rand, GM = o.GM ?? c.m;
  for (let k = 0; k < o.n; k++) {
    const a = o.rin + (o.rout - o.rin) * r();
    let inc = o.prograde === 0 ? Math.acos(2 * r() - 1) : (o.spread ?? 0.3) * Math.abs(gauss(r));
    if (o.prograde === -1) inc = Math.PI - inc;
    const s = elementsToState(GM, { a, e: (o.emax || 0) * r(), i: inc, O: 2 * Math.PI * r(), w: 0, M: 2 * Math.PI * r() });
    P.add(v3.add(c.x, s.r), v3.add(c.v, s.v), o.g);
  }
}

// Run a spec on the CPU (the tests). n frames of h; onFrame(lab, rb, k)
// gets the readback each `every` frames. Returns { lab, events }.
export function runCpu(spec, T, frames, onFrame, every = 1) {
  const lab = new Lab(spec, (cap, sp) => sp.self ? new CpuSelf(cap, sp) : new CpuRestricted(cap));
  // no frame may need more than MAX_S particle steps (the Lab would lag)
  const k0 = Math.ceil(T / (spec.dt * (MAX_S - 1)));
  if (k0 > frames) { every *= Math.ceil(k0 / frames); frames = every * Math.ceil(frames); }
  const events = [], h = T / frames;
  for (let k = 0; k < frames; k++) {
    for (const e of lab.frame(h)) events.push(e);
    if (onFrame && (k % every === every - 1 || k === frames - 1)) onFrame(lab, lab.be.readback(), k);
  }
  return { lab, events };
}
// Live particles from a readback: [{ i, x, v }]
export function liveRows(rb, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const o = 12 * i; if (rb.body[o + 7] > 0) out.push({ i, x: [rb.body[o], rb.body[o + 1], rb.body[o + 2]], v: [rb.body[o + 4], rb.body[o + 5], rb.body[o + 6]] }); }
  return out;
}

export const fmt = {
  sig: (x, d = 3) => { if (!isFinite(x)) return String(x); if (x === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(x))); return Math.abs(e) >= 5 ? x.toExponential(d - 1).replace('e+', ' × 10^').replace('e-', ' × 10^-') : x.toPrecision(d).replace(/\.?0+$/, ''); },
  km: m => fmt.sig(m / 1e3) + ' km',
  au: m => fmt.sig(m / 1.495978707e11) + ' AU',
  days: s => fmt.sig(s / 86400) + ' d',
  years: s => fmt.sig(s / 3.15576e7) + ' yr',
  kms: v => fmt.sig(v / 1e3) + ' km/s',
};

export { rng, gauss, v3, rotate, elementsToState, toCOM, period };
