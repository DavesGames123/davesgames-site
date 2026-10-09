// ============================================================================
//  EXOTIC ATOMS  ·  scene.js — one frame: cloud, field, overlays (no DOM)
// ----------------------------------------------------------------------------
//  makeScene(mk) -> { draw(g, S) }. mk(w, h) returns a canvas (the page
//  passes document.createElement, node passes @napi-rs/canvas). The page,
//  the saver and the thumbnail script draw through this one function, so
//  what node renders is what the page shows.
//
//  S (all lengths in the scaled unit a of the species, screen in CSS px):
//    x, y, w, h       the pane on g (CSS px); dpr: device px per CSS px
//    cloud            { pts, dens } from states.js; weights (optional)
//    yaw, pitch, scale, cx, cy (relative to the pane), pose { tilt, prec }
//    colour 'density' | 'phase', cycles, phase, lut (768 B), exposure
//    floor (0..1 of the peak density), cut { mode 0|1|2, axis, pos, ext }
//    budget           cloud pixels (device px) before upscaling
//    field            bfield.solveAxisym result, or null
//    lines            field lines (fieldLines or trace3D), flut, planes,
//                     showLines, showMag, showArrows, reveal
//    mix              { pts2, k }: morph toward pts2 (cloud.js), uncut only
//    ring             Bohr radius or 0; nucleus; axes [{ dir, len, col, label }]
//    bg               [r, g, b]
//
//  GREP MAP
//    export function makeScene
//    export function filterCloud   pose, density floor and cut
// ============================================================================
import { createCloud } from '../circular-rydberg/cloud.js';
import { posePts, drawFieldLines, drawFieldSlice, drawRing, drawNucleus, drawAxis } from './draw.js';

// apply the pose, then keep points above the floor and inside the cut.
// Returns { pts, weights } (new arrays only when something is cut).
export function filterCloud(c, S, scratch = {}) {
  let pts = posePts(c.pts, S.pose, scratch.rot);
  if (pts !== c.pts) scratch.rot = pts;
  const cut = S.cut || { mode: 0 }, floor = S.floor || 0, w0 = c.weights || null;
  if (!cut.mode && !floor) return { pts, weights: w0 };
  const n = pts.length / 4, out = scratch.out && scratch.out.length >= pts.length ? scratch.out : (scratch.out = new Float32Array(pts.length));
  const wo = w0 ? (scratch.w && scratch.w.length >= n ? scratch.w : (scratch.w = new Float32Array(n))) : null;
  const ax = cut.axis == null ? 1 : cut.axis, at = (cut.pos || 0) * (cut.ext || 1), slab = 0.1 * (cut.ext || 1);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (floor && c.dens[i] < floor) continue;
    const v = pts[i * 4 + ax];
    if (cut.mode === 1 && v > at) continue;
    if (cut.mode === 2 && Math.abs(v - at) > slab) continue;
    out[k * 4] = pts[i * 4]; out[k * 4 + 1] = pts[i * 4 + 1]; out[k * 4 + 2] = pts[i * 4 + 2]; out[k * 4 + 3] = pts[i * 4 + 3];
    if (wo) wo[k] = w0[i];
    k++;
  }
  return { pts: out.subarray(0, k * 4), weights: wo ? wo.subarray(0, k) : null };
}

export function makeScene(mk) {
  const cloud = createCloud(1, 1);
  let off = null, scratch = {};
  function draw(g, S) {
    const dpr = S.dpr || 1, pw = S.w, ph = S.h;
    const Wd = Math.max(1, Math.round(pw * dpr)), Hd = Math.max(1, Math.round(ph * dpr));
    const k = Math.min(1, Math.sqrt((S.budget || 9e5) / (Wd * Hd)));
    const W = Math.max(1, Math.round(Wd * k)), H = Math.max(1, Math.round(Hd * k));
    if (!off || off.width !== W || off.height !== H) off = mk(W, H);
    cloud.resize(W, H);
    const view = { yaw: S.yaw, pitch: S.pitch, scale: S.scale, cx: S.cx, cy: S.cy };
    const og = off.getContext('2d');
    const f = S.cloud ? filterCloud(S.cloud, S, scratch) : { pts: new Float32Array(0), weights: null };
    const s = dpr * k;
    cloud.render(og, f.pts, { yaw: S.yaw, pitch: S.pitch, scale: S.scale * s, cx: S.cx * s, cy: S.cy * s, m: S.m || 0, cycles: S.cycles, phase: S.phase || 0,
      colour: S.colour || 'density', lut: S.colour === 'phase' ? null : S.lut, weights: f.weights, exposure: S.exposure || 1, bg: S.bg || [5, 5, 9], packet: S.packet || null,
      // a morph needs the same point order: only when nothing was cut
      mix: S.mix && f.pts.length === S.cloud.pts.length && !S.pose ? S.mix : null });
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, 0, 0, W, H, Math.round(S.x * dpr), Math.round(S.y * dpr), Wd, Hd);
    // overlays in CSS px, clipped to the pane
    g.setTransform(dpr, 0, 0, dpr, S.x * dpr, S.y * dpr);
    g.beginPath(); g.rect(0, 0, pw, ph); g.clip();
    if (S.field && S.showMag) drawFieldSlice(g, S.field, view, { lut: S.flut, pose: S.pose, mag: true, arrows: false, mk, alpha: S.magAlpha || 0.5 });
    if (S.ring) drawRing(g, view, S.pose, S.ring);
    if (S.lines && S.showLines) drawFieldLines(g, S.lines, view, { lut: S.flut, pose: S.pose, planes: S.planes || 6, reveal: S.reveal == null ? 1 : S.reveal, phase0: S.linePhase || 0, lw: S.lineWidth || 1.3 });
    if (S.field && S.showArrows) drawFieldSlice(g, S.field, view, { lut: S.flut, pose: S.pose, mag: false, arrows: true, every: S.arrowEvery || 3 });
    for (const a of S.axes || []) drawAxis(g, view, a.pose === undefined ? S.pose : a.pose, a.dir, a.len, a);
    if (S.nucleus) drawNucleus(g, view);
    g.restore();
    return view;
  }
  return { draw };
}
