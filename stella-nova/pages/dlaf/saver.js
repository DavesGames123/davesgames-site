// ============================================================================
//  DLAF PAGE  ·  saver.js — the screensaver shots, DOM-free
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls window.snSaver.enter in
//  main.js. This module holds the parts that need no DOM, so tests.mjs can
//  check them: the shot list, the seeded shuffle and timing, the growth pace
//  of a shot, the framing of a shot in the clear band of the label plate,
//  and the label info.
//
//  A shot is one fresh growth from a seed: a preset, a colour mode, a
//  gradient, 2D or 3D, a particle target, or the walker close-up. A shot
//  with surface: true shows the smooth SDF surface in its material; its
//  target is low, so the mesher keeps up in the 5 to 12 s of the shot.
//
//  grep -n targets
//    shot list ............. "export const SHOTS"
//    shuffle and timing .... "export function planShots"
//    growth pace ........... "export function paceTarget"
//    framing ............... "export function frameShot"
//    label ................. "export function shotLabel"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';
import { presetById, modeInfo } from './sim.js';
import { bandRect, fit2D, fit3D } from './camera.js';
import { GRADIENTS } from '../../lib/growth-gradients.js';

export const SHOTS = Object.freeze([
  { id: 'classic', name: 'One seed, the growth front glows', preset: 'classic', mode: 'age', grad: 'inferno', target: 14000 },
  { id: 'ring', name: 'A ring of seeds grows inward', preset: 'ring', mode: 'age', grad: 'magma', target: 13000 },
  { id: 'wind', name: 'Wind drift: the cluster grows upwind', preset: 'wind', mode: 'depth', grad: 'plasma', target: 9000 },
  { id: 'orbit', name: 'Three dimensions, in orbit', preset: 'three', mode: 'distance', grad: 'viridis', target: 7000, dim: 3 },
  { id: 'walker', name: 'One walker, in slow motion', preset: 'classic', mode: 'age', grad: 'inferno', target: 260, walker: true },
  { id: 'trunk', name: 'Flow: trunks carry the most particles', preset: 'classic', mode: 'flow', grad: 'ember', target: 14000 },
  { id: 'forest', name: 'A line of seeds grows a forest', preset: 'line', mode: 'depth', grad: 'aurora', target: 9000 },
  { id: 'sticky', name: 'Low stickiness: dense branches', preset: 'sticky', mode: 'age', grad: 'ice', target: 7000 },
  { id: 'needle', name: 'PlaceParticle: straight needles', preset: 'needle', mode: 'flow', grad: 'turbo', target: 10000 },
  { id: 'sdf-orbit', name: 'One smooth surface: the 3D cluster as a signed distance field', preset: 'three', mode: 'age', grad: 'magma', target: 3600, dim: 3, surface: true, material: 'porcelain' },
  { id: 'copper-relief', name: 'A copper relief of a 2D cluster', preset: 'classic', mode: 'flow', grad: 'ember', target: 5000, surface: true, material: 'copper' },
]);

// A seeded shuffle of the shots, n long, with no shot twice in a row, each
// with a duration of 5 to 12 s (calm 1 gives the longer shots) and a model
// seed. Returns [{ shot, dur, seed }].
export function planShots(seed, calm = 0.5, n = 24) {
  const r = rng((seed >>> 0) || 1);
  const out = [];
  let bag = [];
  for (let i = 0; i < n; i++) {
    if (!bag.length) {
      bag = SHOTS.slice();
      for (let j = bag.length - 1; j > 0; j--) { const k = Math.floor(r() * (j + 1)); [bag[j], bag[k]] = [bag[k], bag[j]]; }
      if (out.length && bag[0].id === out[out.length - 1].shot.id) bag.push(bag.shift());
    }
    const shot = bag.shift();
    const c = Math.min(1, Math.max(0, +calm || 0));
    let dur = 5 + 7 * (0.35 + 0.4 * c + 0.25 * r());
    if (shot.walker) dur = Math.max(dur, 11);
    out.push({ shot, dur: Math.min(12, Math.max(5, dur)), seed: 1 + Math.floor(r() * 1e9) });
  }
  return out;
}

// How many particles the shot should have at time t of dur: an ease-in, so
// the first seconds show the seed and the first branches, and the target is
// reached at 90% of the shot.
export function paceTarget(target, t, dur) {
  const x = Math.min(1, Math.max(0, t / (dur * 0.9)));
  return Math.max(1, Math.round(target * Math.pow(x, 1.6)));
}

// The view of a shot: the world box of the preset fitted into the clear
// band of the plate. 2D gives { kind: '2d', view }, 3D gives { kind: '3d',
// dist, ox, oy }. A box smaller than minR keeps minR, so the first seconds
// are not a huge zoom on one dot.
export function frameShot(box, w, h, band, dim = 2, minR = 18) {
  const rect = bandRect(w, h, band);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const hw = Math.max(minR, (box.x1 - box.x0) / 2), hh = Math.max(minR, (box.y1 - box.y0) / 2);
  if (dim === 3) {
    const r = Math.max(minR, hw, hh);
    return { kind: '3d', rect, dist: fit3D(r, rect, w, h), ox: rect.x + rect.w / 2 - w / 2, oy: rect.y + rect.h / 2 - h / 2 };
  }
  return { kind: '2d', rect, view: fit2D({ x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh }, rect, w, h, 0.92) };
}

// The label info for the shell plate. m is the model on screen, code a short
// extract of the engine (sim.js engineExtract).
export function shotLabel(shot, m, code) {
  const pr = presetById(shot.preset), p = m.params, mode = modeInfo(shot.mode);
  const params = [
    { sym: 'N', name: 'particles', value: String(m.count), cls: 'm1' },
    { sym: 'd_a', name: 'AttractionDistance', value: String(+p.attractionDistance.toFixed(2)), cls: 'm2' },
    { sym: 'd_p', name: 'ParticleSpacing', value: String(+p.particleSpacing.toFixed(2)), cls: 'm3' },
    { sym: 'd_m', name: 'MinMoveDistance', value: String(+p.minMoveDistance.toFixed(2)), cls: 'm4' },
    { sym: 's', name: 'Stickiness', value: String(+p.stickiness.toFixed(2)), cls: 'm5' },
  ];
  if (p.stubbornness > 0) params.push({ sym: 'k', name: 'Stubbornness', value: String(p.stubbornness), cls: 'm6' });
  return {
    title: 'Diffusion-limited aggregation',
    sub: `${shot.name} · after fogleman/dlaf`,
    params,
    lines: [
      shot.walker ? 'Jump d − AttractionDistance, push back, join at ParticleSpacing' : `Hook: ${pr.hook} · colour by ${mode.label.toLowerCase()} · ${(GRADIENTS[shot.grad] || GRADIENTS.inferno).label}`,
      ...(shot.surface ? ['Surface: round cones joined by a smooth minimum, meshed by surface nets'] : []),
      'dlaf by Michael Fogleman, MIT',
    ],
    eq: ['step = max(MinMoveDistance, d − AttractionDistance)'],
    tex: [String.raw`\Delta = \max\big(d_m,\; d - d_a\big)`],
    rules: [['d_m', 'm4'], ['d_a', 'm2']],
    code: { lang: 'js', name: 'lib/dla-engine.js', text: code },
  };
}
