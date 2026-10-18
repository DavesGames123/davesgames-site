// ============================================================================
//  GRAVITY LAB  ·  director.js — where the camera looks (no DOM)
// ----------------------------------------------------------------------------
//  The page camera (app/camera.js) and the saver (app/saver.js) both aim
//  with this file. All points are in frame coordinates (frame.js).
//
//  THE CALM VIEW. When no pair is in a close pass, the camera frames the
//  action: the shared action camera (lib/action-camera.js) on a weighted
//  sample of the bodies and the particles (focus.js frameAction; an
//  experiment's focus hook sets the weights). Two other cases:
//    view.center = i     with no focus hook: the spec's own view, body i
//                        (the frame origin) and the view extent (a ring
//                        patch, a moon system)
//    pending             the first particle sample of a run is not back
//                        yet: calmView, the centre of mass of the bound
//                        bodies and a radius that holds them all
//                        (CALM_MIN..CALM_MAX of the view extent; more with
//                        particles)
//  A body that has left the system (gone: ejected, or unbound, outbound
//  and outside the view extent) is not in the fit and is never a target.
//
//  INTEREST. Each pair of live bodies (one with mass) has a slow average
//  of its separation (TAU s). The score of the pair is how much closer it
//  is now than on average: dBar / d - 1 - APPROACH_0, if d is under half
//  the calm radius. A sim event of the pair (noteEvent: periapsis,
//  capture, release, hit, merge) adds a boost that fades over BOOST_S s.
//  A pair that keeps its distance (a binary, a moon) scores 0.
//
//  THE FOCUS. Over ON the best pair takes the camera; it keeps it at
//  least HOLD s and at most FOCUS_MAX s, and a better pair (2x the score)
//  can take over after HOLD s. Under OFF the camera goes back to the calm
//  view for at least CALM_HOLD s. A merge leaves the survivor in focus,
//  except in an experiment with a focus hook (focus.js): its calm view
//  frames the debris.
//  The pair framing: the target is the midpoint of the two bodies (never
//  empty space: it is on the segment between them), and the radius holds
//  both bodies and their last TRAIL_K trail points, at least PAIR_MIN of
//  the view extent or 10 drawn radii. A pair framing larger than the calm
//  view gives the calm view.
//
//  STEPCAM (the page and the saver). The goal's own motion is carried at
//  once; the rest of the aim eases at most AIM_MAX camera distances per
//  second, and slowly under AIM_DEAD of the radius (no shake). The zoom
//  eases out fast and in slowly, under ZOOM_OUT and ZOOM_IN (log distance
//  per second), so the camera never lunges.
//
//  FITTING. fitView(radius, W, H, band) gives the distance at which a
//  sphere of that radius about the target fits the narrow side of the
//  screen or of the clear band (lib/saver-clear.js plateBand: { t, b }),
//  and the lens shift that puts the target at the band centre. It uses
//  the real aspect W / H (16:9, the 9:16 saver column, a phone).
//  project(cam, p, W, H) is the renderer's projection (render.js persp
//  and lookAt), for the tests.
//
//  grep -n targets: "export const DIR", "export function makeDirector",
//  "export function noteEvent", "export function direct",
//  "export function goneMask", "export function calmView",
//  "export function frameSet", "export function fitView",
//  "export function project", "export function ringTail",
//  "export function easeTarget", "export function stepCam"
// ============================================================================
import { toFrame } from './frame.js';
import { makeFramer, frameAction, leavingMask, keepBound, FOCUS } from './focus.js';

export const DIR = {
  TAU: 4, APPROACH_0: 0.25, ON: 0.45, OFF: 0.15, HOLD: 3, FOCUS_MAX: 12, CALM_HOLD: 1.5,
  BOOST_S: 4, TRAIL_K: 60, PAIR_MIN: 0.1, CALM_MIN: 0.35, CALM_PART: 0.8, CALM_MAX: 2.5,
  FOV: 40 * Math.PI / 180, MARGIN: 1.06,
  // stepCam: the most change of log(distance) per second, out and in; the
  // aim error (share of the framing radius) under which the aim eases slowly
  // AIM_MAX: the most eased aim change per second, in camera distances
  ZOOM_OUT: 1.4, ZOOM_IN: 0.45, AIM_DEAD: 0.06, AIM_MAX: 0.8,
};
const BOOST = { merge: 2, hit: 1.5, breakup: 1.5, capture: 1.2, release: 1, periapsis: 1 };

export function makeDirector() {
  return { t: 0, ema: new Map(), boost: new Map(), focus: null, calmAt: -Infinity, last: null, fr: makeFramer() };
}
const key = (i, j) => i < j ? i * 4096 + j : j * 4096 + i;

// A sim event (nbody.js System events). ext: the view extent.
export function noteEvent(dir, e, ext) {
  let w = BOOST[e.type]; if (!w || e.i === undefined || e.j === undefined) return;
  if (e.type === 'periapsis' && !(e.d < 0.12 * ext)) return;
  // the survivor: the larger body of a merge (i), the body that was hit
  // (j), the parent of a breakup (j); its debris flies about it
  const surv = e.type === 'merge' ? e.i : e.type === 'hit' || e.type === 'breakup' ? e.j : -1;
  dir.boost.set(key(e.i, e.j), { w, until: dir.t + DIR.BOOST_S, merge: surv });
}

// The bodies that have left the system: 1 in the mask.
// THE SYSTEM is the heaviest group of bodies that hold each other (two
// bodies with a negative two-body energy are in one group; a tie in mass
// goes to the group with more bodies). A body outside it has left when it
// is unbound and outbound against the group's centre of mass, and past
// the view extent or flagged as ejected by the System. A body that is
// bound to a body that stays, stays (keepBound). So a binary that recoils
// from an escaper stays, and a black hole that has passed through a
// triple star leaves (the triple has more bodies). anchor: the spec's
// view centre body (an integer view.center): its group is the system, so
// a heavy intruder that crosses a ring patch leaves and the patch stays.
export function goneMask(sys, ext, anchor = -1) {
  const n = sys.n, X = sys.x, V = sys.v, out = new Uint8Array(n);
  const par = Array.from({ length: n }, (_, i) => i), root = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  for (let i = 0; i < n; i++) if (sys.alive[i]) for (let j = i + 1; j < n; j++) if (sys.alive[j]) {
    const dx = X[3 * i] - X[3 * j], dy = X[3 * i + 1] - X[3 * j + 1], dz = X[3 * i + 2] - X[3 * j + 2];
    const vx = V[3 * i] - V[3 * j], vy = V[3 * i + 1] - V[3 * j + 1], vz = V[3 * i + 2] - V[3 * j + 2];
    if (0.5 * (vx * vx + vy * vy + vz * vz) < (sys.m[i] + sys.m[j]) / Math.max(Math.hypot(dx, dy, dz), 1e-300)) par[root(i)] = root(j);
  }
  const gm = new Map();
  for (let i = 0; i < n; i++) if (sys.alive[i]) { const r = root(i), g = gm.get(r) || { m: 0, k: 0 }; g.m += sys.m[i]; g.k++; gm.set(r, g); }
  let best = -1, bg = null;
  for (const [r, g] of gm) if (!bg || g.m > bg.m * (1 + 1e-9) || (Math.abs(g.m - bg.m) <= 1e-9 * bg.m && g.k > bg.k)) { best = r; bg = g; }
  if (anchor >= 0 && anchor < n && sys.alive[anchor]) best = root(anchor);
  let M = 0; const c = [0, 0, 0], u = [0, 0, 0];
  for (let i = 0; i < n; i++) if (sys.alive[i] && root(i) === best && sys.m[i] > 0) { M += sys.m[i]; for (let k = 0; k < 3; k++) { c[k] += sys.m[i] * X[3 * i + k]; u[k] += sys.m[i] * V[3 * i + k]; } }
  if (M > 0) for (let k = 0; k < 3; k++) { c[k] /= M; u[k] /= M; }
  for (let i = 0; i < n; i++) {
    if (!sys.alive[i]) { out[i] = 1; continue; }
    if (root(i) === best || !(M > 0)) continue;
    const dx = X[3 * i] - c[0], dy = X[3 * i + 1] - c[1], dz = X[3 * i + 2] - c[2];
    const vx = V[3 * i] - u[0], vy = V[3 * i + 1] - u[1], vz = V[3 * i + 2] - u[2];
    const r = Math.hypot(dx, dy, dz), E = 0.5 * (vx * vx + vy * vy + vz * vz) - (M + sys.m[i]) / Math.max(r, 1e-300);
    if (E > 0 && dx * vx + dy * vy + dz * vz > 0 && (r > ext || (sys.ejected && sys.ejected[i]))) out[i] = 1;
  }
  const kb = keepBound(sys, out);
  for (let i = 0; i < n; i++) if (!sys.alive[i]) kb[i] = 1;
  return kb;
}

// The calm view: { target, radius } in frame coordinates.
// rNow: drawn radii by body (or null); parts: the run has particles.
export function calmView(sys, frame, view, gone, rNow, parts) {
  const ext = view.extent;
  if (Number.isInteger(view.center) && sys.alive[view.center] && !gone[view.center]) return { target: [0, 0, 0], radius: ext };
  let M = 0, nb = 0; const c = [0, 0, 0], mean = [0, 0, 0];
  const P = [];
  for (let i = 0; i < sys.n; i++) {
    if (gone[i]) continue;
    const p = toFrame(frame, sys.pos(i)); P.push([i, p]); nb++;
    for (let k = 0; k < 3; k++) { mean[k] += p[k]; c[k] += sys.m[i] * p[k]; }
    M += sys.m[i];
  }
  if (!nb) return { target: [0, 0, 0], radius: ext };
  const t = M > 0 ? c.map(x => x / M) : mean.map(x => x / nb);
  let R = 0;
  for (const [i, p] of P) R = Math.max(R, Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]) + (rNow ? rNow[i] || 0 : 0));
  const lo = (parts ? DIR.CALM_PART : DIR.CALM_MIN) * ext;
  return { target: t, radius: Math.min(DIR.CALM_MAX * ext, Math.max(lo, R * 1.05)) };
}

// The last k points of a trail ring { pts, n, head } (app/run.js).
export function ringTail(T, k) {
  if (!T || !T.n) return [];
  const cap = T.pts.length / 3, m = Math.min(k, T.n), out = [];
  for (let q = 0; q < m; q++) { const a = (T.head - 1 - q + cap) % cap; out.push([T.pts[3 * a], T.pts[3 * a + 1], T.pts[3 * a + 2]]); }
  return out;
}

// The framing of bodies ids (one or two): { target, radius }.
// trail(i) -> recent points (frame); rNow: drawn radii.
export function frameSet(sys, frame, ids, ext, rNow, trail) {
  const P = ids.map(i => toFrame(frame, sys.pos(i)));
  const t = P.length > 1 ? [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2, (P[0][2] + P[1][2]) / 2] : P[0].slice();
  const d = P.length > 1 ? Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1], P[0][2] - P[1][2]) : 0;
  let rmax = 0; for (const i of ids) rmax = Math.max(rmax, rNow ? rNow[i] || 0 : 0);
  let R = 0;
  for (const p of P) R = Math.max(R, Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]));
  // the recent trail, but not a long arc far from the pair
  const reach = Math.max(3 * d, 0.25 * ext);
  if (trail) for (const i of ids) for (const p of trail(i)) {
    const r = Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
    if (r < reach) R = Math.max(R, r);
  }
  return { target: t, radius: Math.max(R + rmax, DIR.PAIR_MIN * ext, FOCUS.MIN_BODY * rmax) };
}

// The calm framing of this frame: the action camera (focus.js) on the
// weighted sample, or the spec's own view (an integer view.center and no
// focus hook), or the fit of calmView while the first particle sample of
// a run is on its way (o.pending).
function calmOf(dir, sys, frame, dt, o, gone) {
  const view = o.view, own = Number.isInteger(view.center) && sys.alive[view.center] && !gone[view.center];
  if ((own && !o.focus) || o.pending) return calmView(sys, frame, view, gone, o.rNow, o.parts);
  const st = { spec: o.spec || null, sys, frame, gone, leaving: leavingMask(sys, gone), parts: o.sample || null, ext: o.ext, rNow: o.rNow, t: o.t ?? sys.t };
  const fa = frameAction(dir.fr, st, dt, o.focus || null);
  if (!fa) return calmView(sys, frame, view, gone, o.rNow, o.parts);
  return { target: fa.target, radius: fa.radius, sample: fa.sample, fa };
}

// One step of the director (dt: real seconds). Returns
// { mode: 'calm' | 'pair' | 'one', i, j, score, target, radius, calm, gone }.
// calm.sample is the weighted sample of the action camera (focus.js), when
// it framed the calm view.
// o: { view, ext, rNow, trail, parts (the run has particles), spec, focus
//      (the experiment's hook), sample (focus.js partsInFrame), pending,
//      t (the sim time of the run; default sys.t) }
export function direct(dir, sys, frame, dt, o) {
  dir.t += dt;
  const ext = o.ext;
  if (!sys || !sys.n) {
    // no bodies (the self-gravity disk): the action camera on the
    // particles, else the spec's view
    let r = { mode: 'calm', i: -1, j: -1, score: 0, target: [0, 0, 0], radius: ext };
    if (sys && o.sample && o.sample.n) {
      const fa = frameAction(dir.fr, { spec: o.spec || null, sys, frame, gone: new Uint8Array(0), leaving: new Uint8Array(0), parts: o.sample, ext, rNow: null, t: o.t ?? sys.t }, dt, o.focus || null);
      if (fa) r = { mode: 'calm', i: -1, j: -1, score: 0, target: fa.target, radius: fa.radius, sample: fa.sample, fa };
    }
    r.calm = r; r.gone = new Uint8Array(0); return (dir.last = r);
  }
  const gone = goneMask(sys, ext, Number.isInteger(o.view.center) ? o.view.center : -1), calm = calmOf(dir, sys, frame, dt, o, gone);
  const a = 1 - Math.exp(-dt / DIR.TAU);
  let best = null;
  const scoreOf = (i, j) => {
    const k = key(i, j);
    const d = Math.hypot(sys.x[3 * i] - sys.x[3 * j], sys.x[3 * i + 1] - sys.x[3 * j + 1], sys.x[3 * i + 2] - sys.x[3 * j + 2]);
    let dBar = dir.ema.get(k);
    if (dBar === undefined) dBar = d;
    dBar += (d - dBar) * a; dir.ema.set(k, dBar);
    let s = d < 0.5 * calm.radius ? Math.max(0, dBar / Math.max(d, 1e-300) - 1 - DIR.APPROACH_0) : 0;
    const b = dir.boost.get(k);
    if (b && dir.t <= b.until) s += b.w * (b.until - dir.t) / DIR.BOOST_S;
    return s;
  };
  const live = i => sys.alive[i] && !gone[i];
  const scores = new Map();
  for (let i = 0; i < sys.n; i++) {
    if (!live(i)) continue;
    for (let j = i + 1; j < sys.n; j++) {
      if (!live(j) || !(sys.m[i] > 0 || sys.m[j] > 0)) continue;
      const s = scoreOf(i, j); scores.set(key(i, j), s);
      if (!best || s > best.s) best = { k: key(i, j), i, j, one: -1, s };
    }
  }
  // a merge or a hit: the survivor alone, while the boost lasts
  const boostOf = b => b.w * (b.until - dir.t) / DIR.BOOST_S;
  for (const [k, b] of dir.boost) {
    if (dir.t > b.until) { dir.boost.delete(k); continue; }
    if (b.merge >= 0 && live(b.merge) && !scores.has(k) && (!best || boostOf(b) > best.s)) best = { k, i: b.merge, j: -1, one: b.merge, s: boostOf(b) };
  }
  let f = dir.focus;
  if (f) {
    const b = dir.boost.get(f.k);
    if (f.one < 0 && live(f.i) && live(f.j)) f.s = scores.get(f.k) ?? 0;
    else if (b && b.merge >= 0 && live(b.merge)) { f.one = b.merge; f.s = boostOf(b); }
    else f = null;
    if (f) {
      const age = dir.t - f.at;
      if (age > DIR.FOCUS_MAX || (age > DIR.HOLD && f.s < DIR.OFF)) f = null;
      else if (age > DIR.HOLD && best && best.k !== f.k && best.s > 2 * f.s + 0.2) f = Object.assign({}, best, { at: dir.t });
    }
    if (!f) dir.calmAt = dir.t;
  } else if (best && best.s > DIR.ON && dir.t - dir.calmAt > DIR.CALM_HOLD) f = Object.assign({}, best, { at: dir.t });
  dir.focus = f;
  let out;
  // an experiment with a focus hook knows its action after a merge or a
  // breakup (the debris stream of a torn star): no survivor close-up
  if (f && f.one >= 0 && o.focus) { f = null; dir.focus = null; dir.calmAt = dir.t; }
  if (f) {
    const ids = f.one >= 0 ? [f.one] : [f.i, f.j];
    const fr = frameSet(sys, frame, ids, ext, o.rNow, o.trail);
    if (fr.radius < calm.radius) out = { mode: ids.length > 1 ? 'pair' : 'one', i: ids[0], j: ids.length > 1 ? ids[1] : -1, score: f.s, target: fr.target, radius: fr.radius };
  }
  if (!out) out = { mode: 'calm', i: -1, j: -1, score: best ? best.s : 0, target: calm.target, radius: calm.radius };
  out.calm = calm; out.gone = gone;
  return (dir.last = out);
}

// The distance and lens shift that fit a sphere of this radius about the
// target in the screen W x H, or in the clear band { t, b } of it.
export function fitView(radius, W, H, band = null, fov = DIR.FOV) {
  const t = Math.tan(fov / 2);
  let fr = 1, shiftY = 0;
  if (band) {
    fr = Math.max(0.3, (H - band.t - band.b) / H);
    const yc = (band.t + (H - band.b)) / 2;
    shiftY = -(yc - H / 2) / (H / 2);
  }
  const tE = Math.min(t * fr, t * W / Math.max(1, H));
  return { dist: DIR.MARGIN * radius * Math.sqrt(1 + tE * tE) / tE, shiftY };
}

// The renderer's projection: cam { eye, target, up, fovy, shiftY } ->
// { x, y } in px from the top left, or null behind the eye.
export function project(cam, p, W, H) {
  const f = nrm(sub(cam.target, cam.eye)), r = nrm(cross(f, cam.up || [0, 0, 1])), u = cross(r, f);
  const q = sub(p, cam.eye), z = dot(q, f);
  if (z <= 0) return null;
  const t = Math.tan(cam.fovy / 2);
  const nx = dot(q, r) / (z * t * W / H), ny = dot(q, u) / (z * t) + (cam.shiftY || 0);
  return { x: (nx * 0.5 + 0.5) * W, y: (0.5 - ny * 0.5) * H };
}

// Ease a camera target to a goal that moves: the goal's own motion is
// carried at once (prev: the goal of the frame before, same focus), the
// rest eases at rate k (1/s).
export function easeTarget(cur, goal, prev, dt, k) {
  const e = 1 - Math.exp(-dt * k);
  for (let c = 0; c < 3; c++) { if (prev) cur[c] += goal[c] - prev[c]; cur[c] += (goal[c] - cur[c]) * e; }
  return cur;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// One frame of the camera framing (the page and the saver). c: { target,
// dist, shiftY, cut, prev, fk }; d: a direct() result; zoomK scales the
// radius (a saver shot). A focus change eases; a cut jumps. The camera
// zooms out fast (a pair that flies apart stays in frame) and in slowly.
export function stepCam(c, d, W, H, band, dt, zoomK = 1) {
  const fit = fitView(d.radius * zoomK, W, H, band);
  const fk = d.mode + ':' + d.i + ':' + d.j;
  if (c.cut || !c.target || !(c.dist > 0)) { c.target = d.target.slice(); c.dist = fit.dist; c.shiftY = fit.shiftY; c.cut = false; c.easeStep = 0; }
  else {
    // a small aim error eases slowly (no shake from a goal that jitters),
    // a large one at the full rate
    // the goal's own motion is carried at once (the same focus); the rest
    // eases, under AIM_MAX distances per second
    const carry = c.fk === fk && c.prev;
    if (carry) for (let q = 0; q < 3; q++) c.target[q] += d.target[q] - c.prev[q];
    const ex = d.target[0] - c.target[0], ey = d.target[1] - c.target[1], ez = d.target[2] - c.target[2], err = Math.hypot(ex, ey, ez);
    const kAim = 3 * Math.min(1, err / Math.max(1e-300, DIR.AIM_DEAD * d.radius * zoomK));
    const mv = Math.min(err * (1 - Math.exp(-dt * kAim)), DIR.AIM_MAX * c.dist * dt), f = err > 0 ? mv / err : 0;
    c.target[0] += ex * f; c.target[1] += ey * f; c.target[2] += ez * f;
    c.easeStep = mv;
    // zoom out fast (a pair that flies apart stays in frame), in slowly;
    // both under a rate cap, so the camera never lunges
    const out = fit.dist > c.dist, k = out ? 5 : 1.6, l = Math.log(c.dist);
    const step = (Math.log(fit.dist) - l) * (1 - Math.exp(-dt * k)), cap = (out ? DIR.ZOOM_OUT : DIR.ZOOM_IN) * dt;
    c.dist = Math.exp(l + Math.max(-cap, Math.min(cap, step)));
    c.shiftY += (fit.shiftY - c.shiftY) * Math.min(1, dt * 3);
  }
  c.prev = d.target.slice(); c.fk = fk;
  return c;
}
