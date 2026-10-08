// ============================================================================
//  ROCHE LIMIT  ·  app/draw.js — the frame for the renderer
// ----------------------------------------------------------------------------
//  drawFrame() builds the frame uniforms and the per-moon values, the
//  track and the lines, then renders and places the labels.
//
//  grep -n targets
//    sun direction .... "const SUN", "function backlitSun"
//    one frame ........ "function drawFrame"
// ============================================================================
import { norm, sub } from '../render.js';
import { saverFade } from './saver.js';
import { cameraFrame } from './camera.js';
import { UI, Q } from './env.js';
import { orbitsPerMin } from './loop.js';
import { smoothField, fieldParams } from './field.js';
import { placeLabels } from './labels.js';
import { buildSegments, segs, segN } from './lines.js';
import { satCentre } from './sat.js';
import { S } from './state.js';

// The sun behind the planet as seen from the eye, and below the ring
// plane while the eye is above it: the ring is seen in transmitted,
// forward-scattered light, and the atmosphere rim glows.
function backlitSun(cf) { const d = norm(sub([0, 0, 0], cf.eye)); return norm([d[0] + 0.14, d[1] - 0.06, -Math.abs(d[2]) - 0.10]); }
// the sun: about 40 degrees from the default view and 34 degrees above the
// orbit plane, so a moon beyond 1.8 R_p is never in the planet's shadow
const SUN = norm([-0.024, 0.825, 0.565]);
export function drawFrame(now, cssW, cssH, steps) {
  const dtReal = Math.min(0.1, (now - (S.run.lastDraw || now)) / 1000); S.run.lastDraw = now;
  const cf = cameraFrame(dtReal || 0.016, cssW, cssH);
  const dpr = S.ren.W / cssW;
  const spec = S.run.spec;
  const fp = S.run.phase === 'orbit' ? smoothField(fieldParams(), dtReal) : null;
  const s0 = S.run.sats[0];
  const style = spec.style === 5 && !S.ren.planetTexW ? 1 : (spec.style ?? 0);
  const frameT = steps > 0 ? steps * s0.C.dt : 0;
  const frame = {
    eye: cf.eye, target: cf.target, fov: cf.fov, near: cf.near, time: now / 1000,
    sun: S.saverOn && S.saver && S.saver.backlit ? backlitSun(cf) : SUN, sunI: 1.45,
    atm: spec.style === 3 ? 0.035 : 0.05, spin: now / 1000 * 0.02, style, shine: 0.25,
    flattening: spec.flattening || 0, realRings: UI.real && spec.rings ? 1 : 0,
    sat: fp ? fp.c : satCentre(s0), satR: fp ? fp.satR : (s0.C.Rs * s0.k),
    GMs: fp ? fp.GMs : 0, GMp: fp ? fp.GMp : 0, omega: fp ? fp.omega : 0, phiL1: fp ? fp.phiL1 : 0,
    fieldMode: fp ? UI.field : 0, fieldExt: fp ? fp.ext : 4, fieldScale: fp ? fp.scale : 1, fieldAlpha: 0.62,
    ringExt: 3.6, ringGain: UI.ringOn ? UI.ringGain : 0, ringBlend: steps > 0 ? (UI.calm ? 0.94 : Math.min(0.92, 0.6 + 0.08 * steps / 32)) : 0.97, ringOn: UI.ringOn || frameRealRings(spec),
    exposure: 0.88 * (S.saverOn ? saverFade(dtReal) : 1), bloom: Q.bloom ? 0.08 : 0, bloomThreshold: 1.0, vignette: 0.32,
    grainR: s0.k,   // the mean grain radius (1) in world units
  };
  // the past track of the bound centre: one point per 0.01 R_p of travel
  if (S.run.phase === 'orbit' && s0.an && s0.an.live) {
    const c = satCentre(s0), tr = S.run.track, l = tr[tr.length - 1];
    if (!l || Math.hypot(c[0] - l[0], c[1] - l[1], c[2] - l[2]) > 0.01) { tr.push(c); if (tr.length > 600) tr.shift(); }
  }
  buildSegments(dpr);
  S.ren.setSegments(segs, segN);
  // the grains' screen motion (streaks if on, and the dimming of grains
  // that jump more than a few px), and the decay of the collision heat
  // (time constant 1/20 orbit; frozen while paused)
  const decay = frameT > 0 ? Math.exp(-frameT / (S.run.T0 / 20)) : 1;
  const motion = [UI.blur && !UI.calm ? 1 : 0, UI.calm ? 3 : 6, UI.calm ? 0.04 : 0.08, decay];
  // an impact flash lasts 0.02 orbit of sim time, or 0.35 s on screen at
  // the current speed if that is longer (at fast forward 0.02 orbit is
  // one or two frames)
  const flashT = Math.max(0.02 * S.run.T0, 0.35 * orbitsPerMin() / 60 * S.run.T0);
  const sims = S.run.sats.map(s => ({
    e: s.e, ring: S.run.phase === 'orbit',
    frame: [s.ref.X[0] * s.k, s.ref.X[1] * s.k, s.ref.X[2] * s.k, s.k],
    refV: [s.ref.V[0] * s.k, s.ref.V[1] * s.k, s.ref.V[2] * s.k, frameT], motion,
    opts: [UI.color, UI.color === 2 ? 1 : 0, 1.0, s.C.vesc],
    tint: s.matName === 'rigid' ? [1.0, 0.82, 0.62, 1] : s.matName === 'cohesive' ? [0.75, 1.0, 0.72, 1] : [0.78, 0.9, 1.0, 1],
    heatInv: 1 / (S.run.heatRef || 0.006 * s.C.vesc * s.C.vesc),
    simT: s.gpu.t, flashT: S.run.phase === 'orbit' ? flashT : 0, strain: 1,
  }));
  S.run.lastFrame = { frame, sims };
  S.ren.render(frame, sims);
  placeLabels(cssW, cssH, fp);
}
// The real-ring picture is drawn by the ring pass, so that pass runs when
// it is on even if the debris glow is off.
function frameRealRings(spec) { return UI.real && !!spec.rings; }
