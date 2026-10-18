// ============================================================================
//  TENSOR CALCULUS  ·  viz/fit.js  ·  frame the subject, pick by a tap  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free. The scene cameras of registry.js were set for one wide view.
//  In a tall or a small pane the subject came out small, with a lot of
//  empty space round it. fitCamera() keeps the view direction of the scene
//  camera and moves the target and the distance so the subject fills the
//  view at its real aspect.
//
//    dlPoints(dl, max)        sample points of one frame: triangle corners,
//                             line ends and world labels (a stride keeps
//                             at most max points per buffer)
//    trimBox(points, q)       the box from the q and 1 - q quantiles on
//                             each axis, so a far grid line or one long
//                             arrow does not set the frame
//    fitCamera(cam, points, aspect, opts)
//                             { pos, target, fov }: target = the trimmed
//                             box centre; the distance is the smallest that
//                             puts the (1 - q) quantile of the points inside
//                             FILL of the view on both axes, clamped to
//                             [minK, maxK] x the scene camera distance
//    sceneFit(id, state, opts) samples frameScene at a few times (and
//                             t = 0, 0.5, 1 for a step), then fitCamera
//    projectPicks(picks, project) and nearestPick(list, x, y, r)
//                             a tap picks the index of the nearest glyph
//                             with a sym (dl.picks) within r CSS px
//
//  The vertical field of view is fitFov(cam.fov, aspect), the same value
//  that index.js gives the camera.
//
//  EXPORTS   (grep -n "export" fit.js)
//      FIT, dlPoints, trimBox, fitCamera, sceneFit, projectPicks, nearestPick
// ============================================================================
import { DL } from './dl.js';
import { SCENES, frameScene } from './registry.js';
import { fitFov } from './shots.js';

export const FIT = Object.freeze({ fill: 0.86, q: 0.02, minK: 0.4, maxK: 2.4, minDist: 1.3, maxPts: 2500 });

export function dlPoints(dl, max = FIT.maxPts) {
  const out = [];
  const take = (B, stride, offs) => {
    if (!B || !B.n) return;
    const step = Math.max(1, Math.ceil(B.n / max));
    for (let i = 0; i < B.n; i += step) for (const o of offs) {
      const k = i * stride + o;
      const p = [B.a[k], B.a[k + 1], B.a[k + 2]];
      if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])) out.push(p);
    }
  };
  take(dl.solid, 10, [0]);
  take(dl.glass, 10, [0]);
  take(dl.lines, 11, [0, 3]);
  for (const L of dl.labels || []) if (L.p && !L.screen) out.push(L.p);
  return out;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[k];
}

export function trimBox(points, q = FIT.q) {
  if (!points.length) return null;
  const lo = [], hi = [];
  for (let a = 0; a < 3; a++) {
    const v = points.map(p => p[a]).sort((x, y) => x - y);
    lo.push(quantile(v, q)); hi.push(quantile(v, 1 - q));
  }
  return { lo, hi, center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The camera frame that three.js uses for a camera with up = +y.
export function cameraFrame(pos, target) {
  const f = unit(sub(target, pos));
  let r = cross(f, [0, 1, 0]);
  if (len(r) < 1e-6) r = [1, 0, 0];
  r = unit(r);
  return { f, r, u: cross(r, f) };
}

export function fitCamera(cam, points, aspect, opts = {}) {
  const fill = opts.fill ?? FIT.fill, q = opts.q ?? FIT.q;
  const minK = opts.minK ?? FIT.minK, maxK = opts.maxK ?? FIT.maxK;
  const fov = cam.fov ?? 42;
  const out = { pos: cam.pos.slice(), target: cam.target.slice(), fov };
  const box = trimBox(points || [], q);
  if (!box) return out;
  const d0 = len(sub(cam.pos, cam.target)) || 5;
  const back = unit(sub(cam.pos, cam.target));       // from the target to the eye
  const { r, u } = cameraFrame(cam.pos, cam.target);
  const c = box.center;
  const ty = Math.tan((fitFov(fov, aspect) * Math.PI) / 360) * fill;
  const tx = ty * Math.max(0.05, aspect);
  const need = [];
  for (const p of points) {
    if (p[0] < box.lo[0] || p[0] > box.hi[0] || p[1] < box.lo[1] || p[1] > box.hi[1] || p[2] < box.lo[2] || p[2] > box.hi[2]) continue;
    const v = sub(p, c);
    const z = dot(v, back);                            // toward the eye
    need.push(Math.max(Math.abs(dot(v, r)) / tx, Math.abs(dot(v, u)) / ty) + z);
  }
  if (!need.length) return out;
  need.sort((a, b) => a - b);
  let d = quantile(need, 1 - q / 4);   // stricter than the box: the 2 % out can sit on one side
  d = Math.max(FIT.minDist, Math.min(d0 * maxK, Math.max(d0 * minK, d)));
  out.target = c.slice();
  out.pos = [c[0] + back[0] * d, c[1] + back[1] * d, c[2] + back[2] * d];
  return out;
}

// state: { params, step, aspect, time }. A scene that throws while it
// samples keeps its own camera.
export function sceneFit(id, state = {}, opts = {}) {
  const S = SCENES[id];
  if (!S) return null;
  const aspect = state.aspect || 1.6;
  const dl = opts.dl || new DL();
  const t0 = state.time || 0;
  const samples = state.step ? [[t0, 0], [t0 + 1.5, 0.5], [t0 + 3, 1]] : [[t0, null], [t0 + 2, null], [t0 + 5, null]];
  const pts = [];
  try {
    for (const [time, t] of samples) {
      dl.reset(null, time);
      frameScene(id, dl, { params: state.params || {}, time, t, step: state.step || null, aspect });
      for (const p of dlPoints(dl, Math.ceil(FIT.maxPts / samples.length))) pts.push(p);
    }
  } catch (e) { return { ...S.camera, pos: S.camera.pos.slice(), target: S.camera.target.slice() }; }
  return fitCamera(S.camera, pts, aspect, opts);
}

// picks: [{ p: [x, y, z], sym }]. project(p) -> [x, y, visible] in CSS px.
export function projectPicks(picks, project) {
  const out = [];
  for (const k of picks || []) {
    const s = project(k.p);
    if (s && s[2] !== false && Number.isFinite(s[0]) && Number.isFinite(s[1])) out.push({ x: s[0], y: s[1], sym: k.sym });
  }
  return out;
}

export function nearestPick(list, x, y, r = 24) {
  let best = null, bd = r * r;
  for (const k of list || []) {
    const d = (k.x - x) * (k.x - x) + (k.y - y) * (k.y - y);
    if (d <= bd) { bd = d; best = k.sym; }
  }
  return best;
}
