// ============================================================================
//  STEREOGRAM HISTORY  ·  shots.js — screensaver plan and framing (no DOM)
// ----------------------------------------------------------------------------
//  saver.js draws; this module decides what and where, so node tests can
//  check it at 16:9 and at 9:16.
//
//  SHOTS
//    turn    a single-image stereogram of a real object that turns
//    reveal  a stereogram of a real object; a slow wipe shows its depth map
//    rds     the two-image random-dot form of Julesz, of a real object
//    eyes    the top view of chapter 01, the second point drifting
//    scope   Wheatstone's mirror stereoscope from above
//    row     one row of the look-back rule, built from the left
//    wall    Brewster's wallpaper with one strip out of line
//
//  The plan: runs of a seeded shuffle of SHOT_IDS (turn twice per run, as
//  it is the main subject), no id twice across a seam, lengths 5 to 12 s
//  (calm makes them longer). Each object shot names an object index; the
//  saver maps it onto the list of models.
//
//  grep -n targets: "export const SHOTS", "export function shotPlan",
//    "export function shotRect", "export function fitRect"
// ============================================================================
import { rng } from './geometry.js';

export const SHOT_IDS = Object.freeze(['turn', 'reveal', 'rds', 'eyes', 'scope', 'row', 'wall', 'turn']);

export const SHOTS = Object.freeze({
  turn: { title: 'One image, two views', sub: 'a single-image random-dot stereogram of a turning object', eq: ['s(z) = (1 − μz) E / (2 − μz)'], lines: ['Tyler and Clarke 1979; symmetric algorithm of Thimbleby, Inglis and Witten 1994'] },
  reveal: { title: 'The hidden depth map', sub: 'a stereogram, and the depth that it holds', eq: ['s(z) = (1 − μz) E / (2 − μz)'], lines: ['near is light, far is dark'] },
  rds: { title: 'Depth with nothing to see', sub: 'the two-image random-dot stereogram of Julesz (1960)', eq: [], lines: ['each image alone is noise; together they hold a shape'] },
  eyes: { title: 'Two eyes, two views', sub: 'binocular disparity: the difference of the angles at the eyes', eq: ['η = γ_P − γ_F ≈ I Δd / d²'], lines: ['the dashed circle has zero disparity (Vieth-Müller circle)'] },
  scope: { title: 'Wheatstone\'s mirror stereoscope', sub: 'two mirrors with their backs at 90°, one picture for each eye (1838)', eq: [], lines: ['schematic after the 1838 text'] },
  row: { title: 'The look-back rule', sub: 'each dot copies the dot one repeat to its left', eq: [], lines: ['the repeat is short where the object is near'] },
  wall: { title: 'Brewster\'s wallpaper', sub: 'one strip hung out of line leaves the plane (1844)', eq: [], lines: ['fuse two neighbouring flowers'] },
});

// A plan of n shots (see header).
export function shotPlan(seed, n = 48, calm = 0.7) {
  const r = rng((seed >>> 0) || 1), out = [];
  let prev = null, obj = Math.floor(r() * 1000);
  while (out.length < n) {
    let ids;
    for (let tries = 0; tries < 50; tries++) {
      ids = [...SHOT_IDS];
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      if (ids[0] !== prev && ids.every((v, i) => i === 0 || v !== ids[i - 1])) break;
    }
    for (const id of ids) {
      if (out.length >= n) break;
      const sec = Math.round((5 + 7 * Math.min(1, Math.max(0, 0.35 * calm + 0.65 * r()))) * 10) / 10;
      out.push({ id, sec, obj: obj++, tile: Math.floor(r() * 1000) });
      prev = id;
    }
  }
  return out;
}

// The clear rectangle for a subject: inside the plate band (t from the
// top, b from the bottom) and the visible column (width cw, centred).
export function shotRect(W, H, band) {
  const t = band ? band.t : 0, b = band ? band.b : 0, cw = band && band.w ? Math.min(W, band.w) : W;
  const pad = Math.max(10, Math.round(Math.min(cw, H) * 0.04));
  const x = Math.round((W - cw) / 2) + pad, y = t + pad;
  return { x, y, w: Math.max(40, cw - 2 * pad), h: Math.max(40, H - t - b - 2 * pad) };
}

// The largest rectangle of aspect a (w / h) centred in r.
export function fitRect(r, a) {
  let w = r.w, h = w / a;
  if (h > r.h) { h = r.h; w = h * a; }
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}
