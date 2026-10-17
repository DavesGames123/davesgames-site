// ============================================================================
//  DLAF PAGE  ·  walk.js — record one walker, and play it in slow motion
// ----------------------------------------------------------------------------
//  DOM-free. recordWalk() runs one m.addParticle() of lib/dla-engine.js with
//  a trace and with wrappers on two hooks, and keeps each event of the walk:
//    start   RandomStartingPosition gave the walker a point
//    jump    a step longer than MinMoveDistance: no particle is near, so
//            the walker jumps d - AttractionDistance (the dlaf trick)
//    step    a step of MinMoveDistance near the cluster
//    push    ShouldJoin said no: the walker is pushed back to
//            AttractionDistance + MinMoveDistance from the particle
//    reset   ShouldReset said yes: the walker starts again
//    join    ShouldJoin said yes: PlaceParticle puts the new particle
//            ParticleSpacing from its parent
//  Each event keeps the exact nearest particle (a scan of all particles; the
//  demo cluster is small) so the view can draw the distance d.
//
//  timeline() gives each event a duration. frameAt() gives the event and
//  its progress at a time. overlay() builds the line and point vertices
//  (x, y, z, r, g, b, a, size) that render.js draws over the cluster.
//
//  grep -n targets
//    captions .............. "export const CAPTIONS"
//    record ................ "export function recordWalk"
//    timing ................ "export function timeline"
//    play head ............. "export function frameAt"
//    overlay vertices ...... "export function overlay"
// ============================================================================

export const CAPTIONS = Object.freeze({
  start: 'RandomStartingPosition: the walker starts on the bounding circle, AttractionDistance outside the farthest particle.',
  jump: 'No particle is near. The walker jumps d − AttractionDistance in a random direction. The jump circle holds no particle, so the jump cannot pass one. This is why dlaf is fast.',
  step: 'Near the cluster the jump is short, so the walker takes steps of MinMoveDistance.',
  push: 'ShouldJoin said no (Stickiness or Stubbornness). The walker is pushed back to AttractionDistance + MinMoveDistance from the particle and walks on.',
  reset: 'ShouldReset: the walker is more than twice the bounding radius away, so it starts again.',
  join: 'ShouldJoin said yes. PlaceParticle puts the new particle ParticleSpacing from its parent, on the line to the walker.',
});

function nearestExact(m, x, y, z) {
  const P = m.pos; let best = -1, bd = Infinity;
  for (let i = 0; i < m.count; i++) {
    const d = Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y, P[i * 3 + 2] - z);
    if (d < bd) { bd = d; best = i; }
  }
  return { id: best, d: bd };
}

// Run one walk on m. Returns { events, id, parent, steps, cut }. A walk with
// more than maxEvents events keeps the first and the last part (cut tells how
// many were left out), so a very long walk still plays in a short time.
export function recordWalk(m, maxEvents = 220) {
  const ev = [], H = m.hooks, A = m.params.attractionDistance, mm = m.params.minMoveDistance;
  const rs = H.randomStartingPosition, sj = H.shouldJoin;
  let cur = null, lastJoin = null;
  const near = (x, y, z) => nearestExact(m, x, y, z);
  H.randomStartingPosition = (mod, out) => {
    rs(mod, out);
    const n = near(out[0], out[1], out[2]);
    if (cur) ev.push({ kind: 'reset', from: cur.slice(), to: [out[0], out[1], out[2]], near: n.id, d: n.d });
    else ev.push({ kind: 'start', to: [out[0], out[1], out[2]], near: n.id, d: n.d });
    cur = [out[0], out[1], out[2]];
    return out;
  };
  H.shouldJoin = (mod, p, parent) => { const ok = sj(mod, p, parent); lastJoin = { ok, parent, at: [p[0], p[1], p[2]] }; return ok; };
  let id = -1;
  try {
    id = m.addParticle((p, kind) => {
      if (kind === 2) return;                       // the start hook already logged the reset
      const to = [p[0], p[1], p[2]], n = near(to[0], to[1], to[2]);
      if (kind === 1) {
        ev.push({ kind: 'push', from: lastJoin ? lastJoin.at : cur.slice(), to, parent: lastJoin ? lastJoin.parent : n.id, near: n.id, d: n.d });
      } else {
        const r = Math.hypot(to[0] - cur[0], to[1] - cur[1], to[2] - cur[2]);
        ev.push({ kind: r > mm * 1.001 ? 'jump' : 'step', from: cur.slice(), to, r, near: n.id, d: n.d });
      }
      cur = to;
    });
  } finally { H.randomStartingPosition = rs; H.shouldJoin = sj; }
  if (id >= 0) {
    const P = m.pos, par = m.parent[id];
    ev.push({ kind: 'join', from: lastJoin ? lastJoin.at : cur.slice(), to: [P[id * 3], P[id * 3 + 1], P[id * 3 + 2]], parent: par, near: par, d: lastJoin ? Math.hypot(lastJoin.at[0] - P[par * 3], lastJoin.at[1] - P[par * 3 + 1], lastJoin.at[2] - P[par * 3 + 2]) : A });
  }
  let cut = 0, events = ev;
  if (ev.length > maxEvents) {
    const head = Math.floor(maxEvents * 0.35);
    cut = ev.length - maxEvents;
    events = ev.slice(0, head).concat(ev.slice(ev.length - (maxEvents - head)));
    events[head] = Object.assign({}, events[head], { cutBefore: cut });
  }
  return { events, id, parent: id >= 0 ? m.parent[id] : -1, steps: ev.length, cut };
}

// Seconds per event. slow scales the whole walk. The first few events of a
// kind are slow (DUR), the rest are fast (FAST), so the slow part is the
// explanation and a long walk still ends in about half a minute.
export const DUR = Object.freeze({ start: 1.8, jump: 0.8, step: 0.16, push: 1.6, reset: 1.6, join: 2.8 });
export const FAST = Object.freeze({ start: 1.8, jump: 0.12, step: 0.05, push: 0.5, reset: 0.8, join: 2.8 });
export const SLOW_N = Object.freeze({ start: 9, jump: 5, step: 6, push: 2, reset: 1, join: 9 });
export function timeline(rec, slow = 1) {
  const t = new Float64Array(rec.events.length + 1), seen = {};
  rec.events.forEach((e, i) => {
    const n = seen[e.kind] = (seen[e.kind] || 0) + 1;
    const d = (n <= (SLOW_N[e.kind] ?? 1) ? DUR[e.kind] : FAST[e.kind]) || 0.2;
    t[i + 1] = t[i] + d * slow;
  });
  return t;
}

// The event at time s: { i, f } with f in 0..1 the progress through it.
// Past the end it gives the last event with f = 1.
export function frameAt(times, s) {
  const n = times.length - 1;
  if (n <= 0) return { i: -1, f: 1 };
  if (s >= times[n]) return { i: n - 1, f: 1, done: true };
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid] <= s) lo = mid; else hi = mid - 1; }
  const d = times[lo + 1] - times[lo];
  return { i: lo, f: d > 0 ? Math.min(1, Math.max(0, (s - times[lo]) / d)) : 1 };
}

// The caption key of the event on screen. A jump short enough to look like a
// step still reads as a jump.
export function captionOf(rec, fr) { const e = rec.events[fr.i]; return e ? e.kind : 'start'; }

const smooth = f => f * f * (3 - 2 * f);

// Vertices for the overlay: lines (pairs) and points, each vertex
// [x, y, z, r, g, b, a, size]. col = { walker, ring, jump, push, join, trail,
// bound } as [r, g, b] in 0..1.
export function overlay(m, rec, fr, col, opts = {}) {
  const L = [], Pt = [], A = m.params.attractionDistance;
  const seg = (a, b, c, al) => { L.push(a[0], a[1], a[2] || 0, c[0], c[1], c[2], al, 1, b[0], b[1], b[2] || 0, c[0], c[1], c[2], al, 1); };
  const circle = (o, r, c, al, n = 72) => {
    if (!(r > 0)) return;
    for (let k = 0; k < n; k++) {
      const a0 = k / n * 2 * Math.PI, a1 = (k + 1) / n * 2 * Math.PI;
      seg([o[0] + Math.cos(a0) * r, o[1] + Math.sin(a0) * r, 0], [o[0] + Math.cos(a1) * r, o[1] + Math.sin(a1) * r, 0], c, al);
    }
  };
  const dot = (p, c, al, s) => Pt.push(p[0], p[1], p[2] || 0, c[0], c[1], c[2], al, s);
  const px = opts.px || 1;      // CSS px per world unit: sizes of dots
  if (fr.i < 0) return { lines: new Float32Array(L), points: new Float32Array(Pt) };
  const e = rec.events[fr.i], f = smooth(fr.f);
  // the walker now
  const from = e.from || e.to, to = e.to;
  const w = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, 0];
  // bounding circle: where walkers start, and twice it where they reset
  circle([0, 0], m.boundingRadius, col.bound, 0.35, 120);
  circle([0, 0], m.boundingRadius * 2, col.bound, 0.16, 160);
  // the trail of the last positions
  const trail = opts.trail || 60;
  let prev = null;
  for (let k = Math.max(0, fr.i - trail); k <= fr.i; k++) {
    const q = k === fr.i ? w : rec.events[k].to;
    if (prev && rec.events[k].kind !== 'reset' && rec.events[k].kind !== 'start') {
      seg(prev, q, col.trail, 0.15 + 0.6 * (1 - (fr.i - k) / trail));
    }
    prev = q;
  }
  if (e.kind === 'jump' || e.kind === 'step') {
    // the jump circle: radius d - AttractionDistance around the start of the jump
    circle(from, e.r, col.jump, 0.85);
    seg(from, to, col.jump, 0.5);
  }
  // the attraction ring around the walker, and the line to the nearest particle
  circle(w, A, col.ring, 0.75, 48);
  if (e.near >= 0 && e.kind !== 'join') {
    const P = m.pos, n = [P[e.near * 3], P[e.near * 3 + 1], 0];
    seg(w, n, col.ring, 0.45);
    dot(n, col.ring, 1, Math.max(6, A * 0.6 * px));
  }
  if (e.kind === 'push') {
    const P = m.pos, par = [P[e.parent * 3], P[e.parent * 3 + 1], 0];
    circle(par, A + m.params.minMoveDistance, col.push, 0.8, 48);
    seg(par, w, col.push, 0.9);
    dot(par, col.push, 1, Math.max(8, A * 0.8 * px));
  }
  if (e.kind === 'join') {
    const P = m.pos, par = [P[e.parent * 3], P[e.parent * 3 + 1], 0];
    circle(par, m.params.particleSpacing, col.join, 0.9, 40);
    seg(par, to, col.join, 1);
    dot(to, col.join, 1, Math.max(9, m.params.particleSpacing * 1.4 * px));
  }
  dot(w, col.walker, 1, opts.walkerPx || 9);
  return { lines: new Float32Array(L), points: new Float32Array(Pt) };
}
