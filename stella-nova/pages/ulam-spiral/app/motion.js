// ============================================================================
//  ULAM SPIRAL  ·  app/motion.js — the morph, the walk and camera flights
// ----------------------------------------------------------------------------
//  Each motion is a start function that writes S.morph, S.walk or S.fly
//  and a step function that the frame loop (main.js) calls with dt.
//  saver.js starts them through app.startMorph, app.startWalk, app.flyTo.
//
//  GREP MAP
//    grep -n 'export function startMorph'  the shape-to-shape flight
//    grep -n 'export function stepMorph'   one frame of it; the end swaps S.shape
//    grep -n 'export function startWalk'   count the spiral out from its start
//    grep -n 'export function stepWalk'    and follow it with the camera
//    grep -n 'export function flyTo'       zoom out, pan, zoom in
// ============================================================================
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { $, PHONE_Q } from './dom.js';
import { clamp, lerp, easeIO, is3D, FOV } from './camera.js';
import { view } from './view.js';
import { startOf, bboxOf, fitCam, home3, n3Count, nSpan } from './framing.js';
import { frameState } from './frame.js';
import { shapeChanged } from './controls.js';

// --- morph -------------------------------------------------------------------------------
// The numbers fly from their place in shape a to their place in shape b.
// Each n starts a little later than the one before (stagger), so the
// centre moves first. The camera eases from the view of a to a view of
// the same numbers in b.
export function startMorph(b, dur = 2.8, opts = {}) {
  const a = S.shape, v = rt.VW || view();
  if (a === b) return;
  const stA = L.startOf(a, S.P), stB = L.startOf(b, S.P), st = Math.max(stA, stB);
  let count;
  if (is3D(a)) count = n3Count(a, S.cam3 || home3(a));
  else { const sp = L.isLattice(a) ? nSpan(a, v) : null; count = sp && sp.hi > 0 ? sp.hi - st + 1 : Math.max(2000, frameState(v).points ? frameState(v).points.count : 40000); }
  count = clamp(count || 40000, 400, opts.count || (PHONE_Q.matches ? 300000 : 800000));
  if (S.bits) count = Math.min(count, Math.max(400, S.limit - st));
  const camA = { ...S.cam };
  const camB = is3D(b) ? null : fitCam(bboxOf(b, st, st + count), 0.9, v);
  const c3 = is3D(a) || is3D(b);
  const flat = c => ({ yaw: -Math.PI / 2, pitch: 1.5697, dist: v.ch / (2 * c.z * Math.tan(FOV / 2)), tx: c.x, ty: c.y, tz: 0 });
  const c3A = is3D(a) ? { ...(S.cam3 || home3(a)) } : c3 ? flat(camA) : null;
  const c3B = is3D(b) ? home3(b) : c3 ? flat(camB) : null;
  S.walk = null;
  S.morph = { a, b, t: 0, dur, e: 0, n0: st, count, camA, camB, c3A, c3B, c3: c3A ? { ...c3A } : null, onDone: opts.onDone };
}
export function stepMorph(dt) {
  const mo = S.morph;
  mo.t += dt; const u = clamp(mo.t / mo.dur, 0, 1);
  mo.e = u;
  const ce = easeIO(u);
  if (mo.c3) {
    for (const k of ['yaw', 'pitch', 'tx', 'ty', 'tz']) mo.c3[k] = lerp(mo.c3A[k], mo.c3B[k], ce);
    mo.c3.dist = Math.exp(lerp(Math.log(mo.c3A.dist), Math.log(mo.c3B.dist), ce));
  } else {
    S.cam.x = lerp(mo.camA.x, mo.camB.x, ce); S.cam.y = lerp(mo.camA.y, mo.camB.y, ce);
    S.cam.z = Math.exp(lerp(Math.log(mo.camA.z), Math.log(mo.camB.z), ce));
  }
  if (u >= 1) {
    S.morph = null;
    S.shape = mo.b;
    if (is3D(mo.b)) S.cam3 = { ...mo.c3B }; else { S.cam = { ...mo.camB }; S.cam3 = null; }
    shapeChanged();
    if (mo.onDone) mo.onDone();
  }
}

// --- walk --------------------------------------------------------------------------------
// The spiral counts out from its start. Speed grows with k, so the first
// cells come one by one and the millionth in a few seconds.
const walkOn = on => { $('walkBtn').classList.toggle('on', on); $('dockWalk').classList.toggle('on', on); };
export function startWalk(opts = {}) {
  S.walk = { k: opts.k0 || 0, max: opts.max || (is3D(S.shape) ? n3Count(S.shape, S.cam3 || home3(S.shape)) : 400000), follow: opts.follow !== false, rate: opts.rate || S.walkRate, onDone: opts.onDone };
  S.morph = null;
  walkOn(true);
}
export function stopWalk() { S.walk = null; walkOn(false); S.dirty = true; }
export function stepWalk(dt, v) {
  const w = S.walk;
  w.k += dt * w.rate * Math.max(2.2, 3 * Math.sqrt(w.k) + 0.28 * w.k);
  if (w.follow && !is3D(S.shape)) {
    const st = startOf(), b = bboxOf(S.shape, st, st + Math.max(9, Math.ceil(w.k * 1.15)), 120);
    const c = fitCam(b, 0.78, v);
    c.z = Math.min(c.z, 70);
    const a = 1 - Math.exp(-dt * 2.4);
    S.cam.x = lerp(S.cam.x, c.x, a); S.cam.y = lerp(S.cam.y, c.y, a);
    S.cam.z = Math.exp(lerp(Math.log(S.cam.z), Math.log(c.z), a));
  }
  if (w.k > w.max) { const done = w.onDone; stopWalk(); if (done) done(); }
}

// --- camera flights ------------------------------------------------------------------------
// A flight zooms out on the way and in again (the further the jump, the
// further out), so a far target never streaks past.
export function flyTo(to, dur = 1.6) {
  const from = { ...S.cam }, v = rt.VW || view();
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const zmin = Math.min(from.z, to.z, Math.max(1e-4, 0.6 * Math.min(v.cw, v.ch) / Math.max(1, dist)));
  S.fly = { from, to, t: 0, dur, dip: Math.max(0, Math.log(Math.min(from.z, to.z) / zmin)) };
}
export function stepFly(dt) {
  const f = S.fly; f.t += dt;
  const u = clamp(f.t / f.dur, 0, 1), e = easeIO(u);
  S.cam.x = lerp(f.from.x, f.to.x, e); S.cam.y = lerp(f.from.y, f.to.y, e);
  S.cam.z = Math.exp(lerp(Math.log(f.from.z), Math.log(f.to.z), e) - f.dip * Math.sin(Math.PI * e));
  if (u >= 1) S.fly = null;
}
