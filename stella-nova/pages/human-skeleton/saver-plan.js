// ============================================================================
//  HUMAN SKELETON  ·  saver-plan.js — screensaver motion, no DOM, no THREE
// ────────────────────────────────────────────────────────────────────────────
//  The saver (main.js window.snSaver) moved only its camera: the bones
//  stood still for each shot. These functions give the bones a motion that
//  shows the anatomy. tests.mjs runs them on the shipped manifest.
//
//  BUILD   the skeleton assembles from the sacrum (the root of the parent
//          tree) outward: each bone starts its dissolve-in at a delay set
//          by its depth in the tree, so the spine and pelvis come first and
//          the phalanges and teeth last.
//  LIFT    on a bone push-in the bone slides out of its joint and back:
//          along the line from its joint to its centre, by a share of its
//          length, out in the first half of the shot and home again. A
//          bone that the floor stops under 4 mm gets no lift (main.js).
//  NEIGHBOURS  the bones it articulates with (manifest art) stay solid
//          beside it, so the lift shows what it fits against.
//
//  GREP MAP
//    export function treeDepths .... depth of each bone below the root
//    export function buildDelays ... start time of each bone in a build
//    export function liftDir ....... unit vector joint -> centre, or null
//    export function liftAmount .... the lift distance in m
//    export function liftProfile ... 0 .. 1 .. 0 over the shot
//    export function neighbours .... indices of the bones it articulates with
// ============================================================================

// Depth of every bone below the root (the sacrum), by the parent links.
export function treeDepths(bones, byId) {
  const d = new Int32Array(bones.length).fill(-1);
  const of = b => {
    if (d[b.i] >= 0) return d[b.i];
    let k = 0, q = b;
    // a guard against a cycle: no chain is longer than the bone count
    while (q.parent && k <= bones.length) { q = byId.get(q.parent); if (!q) break; k++; }
    return (d[b.i] = k);
  };
  for (const b of bones) of(b);
  return d;
}

// Seconds after the start of a build shot at which each shown bone starts
// to appear: depth x step, step = span / (max depth + 1). Bones at one
// depth start 0.02 s apart in index order, so a row of ribs or vertebrae
// ripples in, not all in one frame. The ripple stops at 0.9 step, so no
// bone starts before its parent and the last one starts before span.
export function buildDelays(bones, byId, vis, span) {
  const d = treeDepths(bones, byId);
  let max = 1;
  for (const b of bones) if (vis[b.i]) max = Math.max(max, d[b.i]);
  const out = new Float32Array(bones.length), seen = new Map(), step = span / (max + 1);
  for (const b of bones) {
    const k = seen.get(d[b.i]) || 0; seen.set(d[b.i], k + 1);
    out[b.i] = step * d[b.i] + Math.min(0.9 * step, 0.02 * k);
  }
  return out;
}

// The lift line: from the joint to the parent bone towards the bone centre.
// null for a bone with no joint (the sacrum) or a joint at its centre.
export function liftDir(b) {
  if (!b.joint) return null;
  const v = [b.c[0] - b.joint[0], b.c[1] - b.joint[1], b.c[2] - b.joint[2]], l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-4 ? v.map(x => x / l) : null;
}
// The lift distance in m: 30% of the bone length (mm), 8 mm to 90 mm. A
// bone that lifts downward (a foot bone below its joint) stops 2 mm over
// the floor (y 0): its lowest point is qmin[1].
export function liftAmount(b, dir = liftDir(b)) {
  let a = Math.min(0.09, Math.max(0.008, 0.3 * b.len / 1000));
  if (dir && dir[1] < 0 && b.qmin) a = Math.min(a, Math.max(0, (b.qmin[1] - 0.002) / -dir[1]));
  return a;
}

// The lift over a shot, u = 0..1: rest, out (0.22 .. 0.42), held, back
// (0.62 .. 0.82), rest. A smoothstep each way, so it starts and stops at
// zero speed.
export function liftProfile(u) {
  const s = (a, b) => { const t = Math.min(1, Math.max(0, (u - a) / (b - a))); return t * t * (3 - 2 * t); };
  return s(0.22, 0.42) - s(0.62, 0.82);
}

// Indices of the bones that bone b articulates with (manifest art).
export function neighbours(b, byId) {
  return (b.art || []).map(id => byId.get(id)).filter(Boolean).map(q => q.i);
}
