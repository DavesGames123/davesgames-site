// ============================================================================
//  GRAVITY LAB  ·  items.js — the tray: bodies and swarms to throw in
// ----------------------------------------------------------------------------
//  No DOM and no GPU (tests.mjs runs it in node).
//
//  ITEMS. Eight things to throw into any running experiment that has
//  bodies: planet, moon, star, black hole, asteroid swarm, comet, rubble
//  pile, dust cloud. Experiments use their own units (AU, the Earth-Moon
//  distance, 10 kpc), so an item takes its mass from the heaviest body in
//  the scene (mRel x M_dom: a planet is 1/1000 of it, like Jupiter and the
//  Sun) and its drawn size from the view (rRel x the view extent). Its
//  collision radius is its drawn radius, so it hits where it looks to hit.
//  The page says so (NOTES).
//
//  THROWING. throwVelocity(): a tap gives the velocity of a circular orbit
//  (relative to the heaviest body, with G (M + m)) (prograde about +z); a drag adds a velocity
//  along the drag, scaled so that a drag of 0.3 view extents is one local
//  circular speed. In a rotating view the drag is relative to the
//  turning frame (frame.js toWorldVel adds omega x r).
//
//  ADDING A BODY. extendSystem(sys, [bodies], watch) builds a new nbody.js
//  System with the old bodies (their current state, dead ones kept dead,
//  so every index stays) and the new ones at the end, and carries the
//  clock, the energy books, the watch list and the burns. The particle
//  backend does not change: it reads the bodies from the trajectory rows,
//  by index.
//
//  PREDICTION. predictPath(sys, body, T, n) runs a copy of the system with
//  the new body for T and returns n + 1 points of its path (world), and
//  the time it merged or broke up, if it did.
//
//  grep -n targets: "export const ITEMS", "export function dominant",
//  "export function makeItem", "export function throwVelocity",
//  "export function extendSystem", "export function predictPath",
//  "export function swarm"
// ============================================================================
import { System, v3, rng, gauss } from './nbody.js';
import { COLORS } from './experiments/common.js';

// mRel: mass over the heaviest body; rRel: drawn radius over the view
// extent; parts: particles (swarm, dust) instead of a body.
export const ITEMS = [
  { key: 'planet', name: 'Planet', kind: 'jupiter', mRel: 1e-3, rRel: 0.024, color: COLORS.jupiter,
    desc: 'A giant planet: 1/1000 of the heaviest body, as Jupiter is to the Sun.' },
  { key: 'moon', name: 'Moon', kind: 'moon', mRel: 1.2e-5, rRel: 0.012, color: COLORS.moon,
    desc: 'A moon: 1/80 000 of the heaviest body. It barely pulls on anything.' },
  { key: 'star', name: 'Star', kind: 'star', mRel: 0.5, rRel: 0.05, color: COLORS.redDwarf,
    desc: 'A second star of half the mass of the heaviest body.' },
  { key: 'blackhole', name: 'Black hole', kind: 'bh', mRel: 3, rRel: 0.02, color: [0.02, 0.02, 0.02],
    desc: 'A black hole of three times the heaviest mass. What touches it is gone.' },
  { key: 'swarm', name: 'Asteroid swarm', parts: { n: 1500, spread: 0.035, vSpread: 0.04, size: 0.004 }, color: [0.78, 0.68, 0.56],
    desc: '1500 massless rocks in a tight clump: watch the tide string them out.' },
  { key: 'comet', name: 'Comet', kind: 'comet', mRel: 1e-11, rRel: 0.008, color: COLORS.comet, sheds: true,
    desc: 'A comet nucleus. It sheds dust that follows its orbit, a meteor stream.' },
  { key: 'rubble', name: 'Rubble pile', kind: 'rock', mRel: 2e-6, rRel: 0.013, color: [0.72, 0.6, 0.5], rubble: true,
    desc: 'A loose pile of rock. Inside the Roche limit of a heavy body it comes apart.' },
  { key: 'dust', name: 'Dust cloud', parts: { n: 4000, spread: 0.11, vSpread: 0.12, size: 0.003 }, color: [0.85, 0.78, 0.95],
    desc: '4000 grains of dust in a loose cloud.' },
];
export const ITEM = Object.fromEntries(ITEMS.map(x => [x.key, x]));
export const NOTES = [
  'Thrown items take their mass from the heaviest body in the scene and their size from the view; they collide where they are drawn.',
  'Bodies merge on contact (mass, momentum and volume add); the heat of the impact leaves the books as E_loss.',
];

// The heaviest live body: { i, m, r, x, v } or null.
export function dominant(sys) {
  let best = -1;
  for (let i = 0; i < sys.n; i++) if (sys.alive[i] && (best < 0 || sys.m[i] > sys.m[best])) best = i;
  if (best < 0 || !(sys.m[best] > 0)) return null;
  return { i: best, m: sys.m[best], r: sys.R[best], rho: sys.rho[best], x: sys.pos(best), v: sys.vel(best) };
}
let serial = 0;
// A body for an item at world position x with velocity v. ext: the view
// extent. Returns a System body with the renderer's fields.
// The mass an item would have in this system.
export function itemMass(key, sys) { const it = ITEM[key], dom = dominant(sys); return it && !it.parts ? it.mRel * (dom ? dom.m : 1) : 0; }
export function makeItem(key, sys, x, v, ext, n = 0) {
  const it = ITEM[key], dom = dominant(sys);
  if (!it || it.parts) return null;
  const M = dom ? dom.m : 1;
  const rDraw = it.rRel * ext;
  const b = { name: it.name + (n > 1 ? ' ' + n : ''), kind: it.kind, m: it.mRel * M, r: rDraw, rDraw, x: x.slice(), v: v.slice(), color: it.color.slice(), item: key, id: 'item' + (++serial) };
  if (key === 'blackhole') { b.r = 0.6 * rDraw; b.absorb = 1; }
  if (it.rubble) {
    // half the density of the heaviest body: its fluid Roche limit is
    // 2.44 (2)^(1/3) = 3.1 of that body's radii
    const rho = dom && dom.rho > 0 ? 0.5 * dom.rho : b.m / (4 / 3 * Math.PI * b.r ** 3);
    b.fragile = { rho, n: 900 };
  }
  return b;
}
// The velocity of a thrown item. p: world point, drag: world vector (the
// drag in the orbit plane), dom: dominant(sys), ext: view extent, m: the
// item's mass (the relative orbit of a tap is a circle for any m).
export function throwVelocity(p, drag, dom, ext, m = 0) {
  if (!dom) return v3.mul(drag, 1 / (0.3 * ext));
  const rel = v3.sub(p, dom.x), r = Math.max(v3.len(rel), 1e-9);
  const vc = Math.sqrt((dom.m + m) / r);
  const L = v3.len(drag);
  // a tap: a circular orbit (prograde about +z; a point on the axis gets +x)
  let t = v3.cross([0, 0, 1], rel);
  if (v3.len(t) < 1e-12 * r) t = [1, 0, 0];
  t = v3.norm(t);
  if (L < 0.02 * ext) return v3.add(dom.v, v3.mul(t, vc));
  return v3.add(dom.v, v3.mul(drag, vc / (0.3 * ext)));
}
// Particles of a swarm or a dust cloud about p with velocity v: the clump
// spreads with spread x ext in place and vSpread x |v - v_dom| in speed.
export function swarm(key, p, v, ext, vdom, seed = 1, nMax = Infinity) {
  const it = ITEM[key]; if (!it || !it.parts) return null;
  const P = it.parts, n = Math.max(1, Math.min(P.n, nMax)), r = rng(seed);
  const vs = P.vSpread * Math.max(v3.len(v3.sub(v, vdom || [0, 0, 0])), 1e-12);
  const pos = new Float64Array(3 * n), vel = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < 3; c++) {
      pos[3 * k + c] = p[c] + P.spread * ext * gauss(r) * (c === 2 ? 0.3 : 1);
      vel[3 * k + c] = v[c] + vs * gauss(r) * (c === 2 ? 0.3 : 1);
    }
  }
  return { n, pos, vel, size: P.size * ext };
}

// A new System with the bodies of sys (current state) and add appended.
// watch: [[i, j]] pairs to add to the watch list (indices in the new list).
export function extendSystem(sys, add, watch = []) {
  const bodies = [];
  for (let i = 0; i < sys.n; i++) {
    const s = sys.spec[i];
    bodies.push(Object.assign({}, s, {
      m: sys.m[i], r: sys.R[i], x: sys.pos(i), v: sys.vel(i), eps: sys.eps[i], epsP: sys.epsP[i],
      absorb: sys.absorb[i], merge: sys.mergeOK[i], rho: sys.rho[i] || undefined, track: sys.track[i], fragile: sys.fragile[i],
    }));
  }
  for (const b of add) bodies.push(b);
  const ns = new System(bodies, { eta: sys.eta, maxSub: sys.maxSub, burns: sys.burns, escapeR: sys.escapeR, debrisN: sys.debrisN, ejecta: sys.ejectaN, rand: sys.rand });
  for (let i = 0; i < sys.n; i++) { ns.alive[i] = sys.alive[i]; ns.ejected[i] = sys.ejected[i]; }
  ns.t = sys.t; ns.Eloss = sys.Eloss; ns.strained = sys.strained; ns.subTotal = sys.subTotal;
  ns._acc();
  ns.watch = sys.watch.map(w => ({ i: w.i, j: w.j, d: w.d.slice(), bound: w.bound }));
  for (const [i, j] of watch) {
    if (i === j || !(i < ns.n && j < ns.n)) continue;
    const d = v3.len(v3.sub(ns.pos(j), ns.pos(i)));
    ns.watch.push({ i, j, d: [d, d], bound: ns._pairE(i, j) < 0 });
  }
  return ns;
}
// The copy of a System (for a prediction): same bodies, same state.
export function cloneSystem(sys) {
  const ns = extendSystem(sys, []);
  ns.burns = sys.burns.slice(); ns.watch = []; ns.escapeR = Infinity;
  ns.rand = rng(7);
  return ns;
}
// The path of a new body b over T in n steps: { pts, end: the sim time it
// merged or broke up, or null }. map(ns, x) turns each world point into
// the point to keep (frame.js toFrame of that moment, for a rotating
// view); default: the world point. maxSub caps the work of each step.
export function predictPath(sys, b, T, n = 120, maxSub = 400, map = null) {
  const ns = extendSystem(sys, [b]);
  ns.burns = sys.burns.slice(); ns.watch = []; ns.escapeR = Infinity; ns.maxSub = maxSub; ns.rand = rng(7);
  const k = ns.n - 1, f = map || ((s, x) => x), pts = [f(ns, ns.pos(k))];
  let end = null;
  for (let s = 0; s < n; s++) {
    ns.advance(T / n, 1);
    ns.events.length = 0;
    if (!ns.alive[k]) { end = ns.t; break; }
    pts.push(f(ns, ns.pos(k)));
  }
  return { pts, end };
}
