// ============================================================================
//  CT LAB SAVER  ·  plan.js — the shot bag, springs and panel layout (no DOM)
// ----------------------------------------------------------------------------
//  The saver plays a seeded sequence of shots. makePlan(seed, caps) gives a
//  bag of shot kinds in a seeded shuffle. next() never gives the kind of the
//  last shot again, and it avoids the family of the last shot when the bag
//  allows it. Each shot gets a length of 6 to 12 s and its own seed.
//
//  A spring is critically damped: it reaches its target with a continuous
//  velocity and no overshoot. The saver cameras use springs, not snaps.
//
//  GREP MAP
//    grep -n 'export const KINDS'     shot kinds, families, lengths, needs
//    grep -n 'export function makePlan'
//    grep -n 'export function spring'  stepSpring, cam2d, stepCam
//    grep -n 'export function fitPanels' panel rectangles in the clear band
// ============================================================================

// needs: 'lab' = window.__ctlab, 'gpu' = WebGPU for view3d.
export const KINDS = [
  { kind: 'gantry', fam: 'lab', dur: [8, 12], needs: 'lab' },
  { kind: 'artefacts', fam: 'lab', dur: [9, 12], needs: 'lab' },
  { kind: 'reveal', fam: 'lab', dur: [8, 12], needs: 'lab' },
  { kind: 'sine', fam: 'radon', dur: [7, 11] },
  { kind: 'smear', fam: 'bp', dur: [9, 12] },
  { kind: 'fourier', fam: 'fourier', dur: [8, 12] },
  { kind: 'iterate', fam: 'iter', dur: [8, 12] },
  { kind: 'sparse', fam: 'sweep', dur: [8, 12] },
  { kind: 'dose', fam: 'sweep', dur: [7, 11] },
  { kind: 'cone-scan', fam: '3d', dur: [10, 12], needs: 'gpu' },
  { kind: 'cone-volume', fam: '3d', dur: [7, 11], needs: 'gpu' },
];
export const MIN_SHOT = 6, MAX_SHOT = 12;

// A small seeded generator (mulberry32). Returns numbers in [0, 1).
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (R, list) => list[Math.floor(R() * list.length) % list.length];
export function shuffle(R, list) {
  const a = list.slice();
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(R() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
}

// caps: { lab, gpu, calm, only } -> { next(force), drop(fam), kinds }. only: a kind list for tests.
export function makePlan(seed, caps = {}) {
  const R = rng(seed);
  const calm = Math.max(0, Math.min(1, caps.calm ?? 0.6));
  let kinds = KINDS.filter((k) => (!k.needs || caps[k.needs]) && (!caps.only || caps.only.includes(k.kind)));
  let bag = [], last = null, index = 0;
  function next(force) {
    let spec = force ? kinds.find((k) => k.kind === force) || KINDS.find((k) => k.kind === force) : null;
    if (!spec) {
      if (!bag.length) bag = shuffle(R, kinds);
      let i = bag.findIndex((k) => !last || (k.kind !== last.kind && k.fam !== last.fam));
      if (i < 0) i = bag.findIndex((k) => !last || k.kind !== last.kind);
      if (i < 0) { bag = shuffle(R, kinds); i = bag.findIndex((k) => !last || k.kind !== last.kind); }
      if (i < 0) i = 0;                  // a bag of one kind only
      spec = bag.splice(i, 1)[0];
    }
    const [lo, hi] = spec.dur;
    const dur = Math.max(MIN_SHOT, Math.min(MAX_SHOT, lo + (hi - lo) * (0.45 * R() + 0.55 * calm)));
    last = spec;
    return { kind: spec.kind, fam: spec.fam, dur, seed: (R() * 4294967296) >>> 0, index: index++ };
  }
  // drop(fam): remove a family (for example '3d' when WebGPU fails at run time)
  function drop(fam) { kinds = kinds.filter((k) => k.fam !== fam); bag = bag.filter((k) => k.fam !== fam); }
  return { next, drop, get kinds() { return kinds.map((k) => k.kind); } };
}

// ---------- springs ----------
// Critically damped spring: x(t) = t + (d + (v + w d) t) e^(-w t), d = x - target.
export function spring(x, w = 4) { return { x, v: 0, t: x, w }; }
export function stepSpring(s, dt) {
  const w = s.w, d = s.x - s.t, e = Math.exp(-w * dt), c = s.v + w * d;
  s.x = s.t + (d + c * dt) * e;
  s.v = (s.v - c * w * dt) * e;
  return s.x;
}
// 2D camera: the focus point (fx, fy) in stage CSS px goes to the stage centre, zoom z.
export function cam2d(cx, cy, w = 1.6) { return { fx: spring(cx, w), fy: spring(cy, w), z: spring(1, w) }; }
export function aimCam(c, fx, fy, z) { c.fx.t = fx; c.fy.t = fy; c.z.t = z; }
export function stepCam(c, dt) { stepSpring(c.fx, dt); stepSpring(c.fy, dt); stepSpring(c.z, dt); }
export function camOK(c) { return [c.fx.x, c.fy.x, c.z.x, c.fx.v, c.fy.v, c.z.v].every(Number.isFinite) && c.z.x > 0; }

// ---------- layout ----------
// Fit k panels (aspect = w/h each) in the stage, as a row or as a column,
// whichever gives the larger panels. Returns [{ x, y, w, h }].
export function fitPanels(stage, aspects, gap = 18, pad = 0.04) {
  const W = stage.w * (1 - 2 * pad), H = stage.h * (1 - 2 * pad);
  const sum = aspects.reduce((s, a) => s + a, 0), inv = aspects.reduce((s, a) => s + 1 / a, 0), k = aspects.length;
  const rowH = Math.min(H, (W - gap * (k - 1)) / sum);
  const colW = Math.min(W, (H - gap * (k - 1)) / inv);
  const out = [];
  if (rowH * rowH * sum >= colW * colW * inv || k === 1) {
    const tw = rowH * sum + gap * (k - 1);
    let x = stage.x + (stage.w - tw) / 2;
    for (const a of aspects) { out.push({ x, y: stage.y + (stage.h - rowH) / 2, w: rowH * a, h: rowH }); x += rowH * a + gap; }
  } else {
    const th = colW * inv + gap * (k - 1);
    let y = stage.y + (stage.h - th) / 2;
    for (const a of aspects) { const h = colW / a; out.push({ x: stage.x + (stage.w - colW) / 2, y, w: colW, h }); y += h + gap; }
  }
  return out;
}
export const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
