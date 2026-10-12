// ============================================================================
//  GRAVITY LAB  ·  saver-plan.js — the screensaver's reel and shots (no DOM)
// ----------------------------------------------------------------------------
//  app/saver.js plays it; tests.mjs checks it.
//
//  THE REEL (makeReel) is a seeded shuffle bag: every library variant once
//  (experiments/index.js bag) with random rolls between them (roll.js
//  reel), so two sessions start differently and nothing repeats until the
//  bag is empty. A run lasts RUN_SHOTS shots, then fades to the next.
//
//  SHOTS. A shot is a camera goal that changes over the shot:
//    establish  the whole scene, a slow turn
//    push       a push-in on the subject (0.9 -> 0.3 of the framing)
//    follow     close on the subject, the target moves with it
//    close      an event close-up (merge, breakup, hit, capture,
//               ejection, a close periapsis) in slow motion
//    top        from above (best for disks and rotating frames)
//    low        grazing the orbit plane
//  Each shot lasts a seeded time in [min, max] inside [CUT_MIN, CUT_MAX].
//  An event worth a cut (eventWorth) cuts to a close shot (eventWait): a
//  merge or a breakup once the shot has run EVENT_MIN s, any other event
//  at CUT_MIN s. An event older than EVENT_STALE s is dropped, and the same
//  event of the same pair (eventKey) cuts once in EVENT_REPEAT s, so a
//  pair that flips between bound and free does not fill the reel. Data-driven subjects: pickSubject scores the bodies by
//  their acceleration (where gravity is doing the most work right now).
//
//  grep -n targets: "export const SHOTS", "export function makeReel",
//  "export function shotPlan", "export function shotDone",
//  "export function eventWorth", "export function pickSubject",
//  "export function shotGoal", "export function lawFor",
//  "export function eventWait", "export function eventKey"
// ============================================================================
import { reel } from './roll.js';

export const CUT_MIN = 5, CUT_MAX = 12, EVENT_MIN = 3, EVENT_STALE = 6, EVENT_REPEAT = 45;
export const RUN_SHOTS = [4, 6];
export const SHOTS = {
  establish: { min: 6, max: 9, el: [0.35, 0.7], zoom: [1.0, 1.15], push: 0.08, turn: 0.035 },
  push:      { min: 5, max: 8, el: [0.15, 0.6], zoom: [0.85, 0.95], push: 0.62, turn: 0.02, subject: true },
  follow:    { min: 6, max: 10, el: [0.1, 0.5], zoom: [0.22, 0.4], push: 0.15, turn: 0.05, subject: true, track: true },
  close:     { min: 5, max: 7, el: [0.1, 0.45], zoom: [0.1, 0.22], push: 0.25, turn: 0.04, slow: 0.3, event: true },
  top:       { min: 6, max: 9, el: [1.2, 1.38], zoom: [1.0, 1.15], push: 0.12, turn: 0.03 },
  low:       { min: 5, max: 8, el: [0.04, 0.12], zoom: [0.6, 0.85], push: 0.1, turn: 0.045, subject: true },
};
const BODY_SHOTS = ['push', 'follow', 'low', 'top', 'push', 'follow'];
const SELF_SHOTS = ['push', 'top', 'low', 'push'];

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// The reel of a session: entries { type: 'roll', seed } or { type:
// 'library', key, variant }. last: the key of the run before (never first).
export function makeReel(seed, last = null) {
  const a = reel(seed >>> 0, 40);
  if (last && a.length > 1 && (a[0].key || 'roll' + a[0].seed) === last) a.push(a.shift());
  return a;
}
// The shots of one run: establish first, then seeded kinds with no kind
// twice in a row. self: a run without bodies (the self-gravity disk).
export function shotPlan(rnd, self = false) {
  const n = RUN_SHOTS[0] + Math.floor(rnd() * (RUN_SHOTS[1] - RUN_SHOTS[0] + 1));
  const pool = self ? SELF_SHOTS : BODY_SHOTS, out = [mk('establish', rnd)];
  while (out.length < n) {
    let k = pool[Math.floor(rnd() * pool.length)];
    if (k === out[out.length - 1].kind) k = pool[(pool.indexOf(k) + 1) % pool.length];
    out.push(mk(k, rnd));
  }
  return out;
}
export function mk(kind, rnd) {
  const S = SHOTS[kind];
  return { kind, len: S.min + (S.max - S.min) * rnd(), el: S.el[0] + (S.el[1] - S.el[0]) * rnd(), zoom: S.zoom[0] + (S.zoom[1] - S.zoom[0]) * rnd(),
    side: rnd() < 0.5 ? -1 : 1, az: 2 * Math.PI * rnd(), push: S.push, turn: S.turn, slow: S.slow || 1, subject: !!S.subject, track: !!S.track, event: !!S.event };
}
// Is the shot over? el: seconds in the shot.
export function shotDone(sh, el) {
  if (el >= CUT_MAX) return true;
  if (el < CUT_MIN) return false;
  return el >= sh.len;
}
// How much an event is worth a cut (0: none). ext: the view extent.
export function eventWorth(e, ext) {
  switch (e.type) {
    case 'breakup': return 5;
    case 'merge': return 4;
    case 'ejection': return 3;
    case 'capture': return 3;
    case 'hit': return 2;
    case 'release': return 2;
    case 'periapsis': return e.d < 0.12 * ext ? 2 : 0;
    default: return 0;
  }
}
// The seconds a shot must run before an event of this worth cuts it: a
// merge or a breakup (worth 4 or more) at EVENT_MIN, the rest at CUT_MIN.
export function eventWait(worth) { return worth >= 4 ? EVENT_MIN : CUT_MIN; }
// The same event of the same pair has the same key.
export function eventKey(e) { return e.type + ':' + (e.i ?? '') + ':' + (e.j ?? ''); }
// The subject: bodies [{ i, a (|acceleration|), m, dom (bool), alive }];
// the largest acceleration, not the dominant body; the runner-up one time
// in three. Returns a body index or -1.
export function pickSubject(bodies, rnd) {
  const c = bodies.filter(b => b.alive && !b.dom && isFinite(b.a)).sort((p, q) => q.a - p.a);
  if (!c.length) { const d = bodies.find(b => b.alive); return d ? d.i : -1; }
  if (c.length > 1 && rnd() < 0.33) return c[1].i;
  return c[0].i;
}
// The camera goal of a shot at progress u (0..1): { az, el, distK } where
// distK scales the framing distance of the subject. Each shot has its own
// seeded azimuth (a cut is a new angle) and turns slowly over the shot.
export function shotGoal(sh, u) {
  const ease = u * u * (3 - 2 * u);
  return { az: sh.az + sh.side * sh.turn * u * sh.len, el: sh.el, distK: sh.zoom * (1 - sh.push * ease) };
}
// The law on the plate: Newton for most runs, vis-viva for orbits, the
// Jacobi integral in a rotating frame.
export function lawFor(spec) {
  if (spec.view && spec.view.rotating) return { name: 'Jacobi integral', tex: 'C_J = 2\\Omega(x, y, z) - v^2,\\quad \\Omega = \\tfrac{1}{2}(x^2 + y^2) + \\frac{1-\\mu}{r_1} + \\frac{\\mu}{r_2}' };
  const orbit = ['kepler', 'transfers', 'slingshot', 'solar', 'blackhole', 'resonance', 'triton', 'kozai', 'sl9', 'tde'];
  if (orbit.includes(spec.key) || (spec.rollInfo && /cometStorm|probes|bhSwarm/.test(spec.rollInfo.base || ''))) return { name: 'vis-viva', tex: 'v^2 = G M\\left(\\frac{2}{r} - \\frac{1}{a}\\right)' };
  return { name: 'Newton', tex: '\\vec F = -\\frac{G\\,m_1 m_2}{r^2}\\,\\hat r' };
}
