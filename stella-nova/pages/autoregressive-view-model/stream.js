// ============================================================================
//  AUTOREGRESSIVE VIEW MODEL  ·  stream.js — the toy view stream
// ----------------------------------------------------------------------------
//  Pure module (no DOM). A toy of the sampling loop of AVM (paper sec. 4 and
//  app. E). It keeps the paper's bookkeeping and replaces the network with
//  a lookup:
//    pool      prefill views (input images) + history views (generated)
//    context   sink (first L_sin prefill views) + retrieved (policy, from the
//              pool minus sink and motion) + motion (last L_mot history views)
//    chunk     L_tgt target views made together, then appended to history
//  Toy "model": a target column whose surface bin is shown by an active
//  context view copies that colour (reconstruct). Otherwise it imagines a
//  plausible colour (priorColor) that is new each time (extrapolate). Within
//  one chunk the target views agree. Geometry is given, not generated:
//  that is a simplification; the real model generates pixels only.
//
//  Retrieval policies (app. E):
//    off      L_rtr = 0
//    greedy   per target, the s nearest views by pose distance d(q, r)
//    spatial  greedy set cover of anchors along target rays, candidates
//             within a radius set by the k-th nearest view
//    angular  spatial + up to four views that fill the target-relative
//             headings parallel, opposite, left, right; then pose NMS
//
//  grep -n: "export function createStream"  "export function poseDist"
//           "function retrieve"  "function generateChunk"  "export const POLICIES"
// ============================================================================
import { observe, truthColor, priorColor, inView, FOV } from './world.js';

export const POLICIES = {
  off: 'No retrieval (L_rtr = 0)',
  greedy: 'Greedy nearest',
  spatial: 'Spatial',
  angular: 'Spatial + angular',
};

export const REVISIT_GAP = 4;
const sameCol = (a, b) => a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
// Stand-in for ||P_q^-1 (P_r - P_q)||_F: scaled translation and the chord
// of the relative rotation.
export function poseDist(q, r) {
  const dx = r.x - q.x, dy = r.y - q.y, c = 2 * Math.sin(Math.abs(wrap(r.yaw - q.yaw)) / 2);
  return Math.sqrt((dx * dx + dy * dy) / 4 + 2 * c * c);
}

// Anchors along target rays at fixed multiples of the median distance from
// the target to the pool views (the paper samples a g x g image grid).
function anchors(q, dmed) {
  const out = [];
  for (let g = 0; g < 6; g++) {
    const a = q.yaw + FOV * (0.5 - (g + 0.5) / 6);
    for (const m of [0.5, 1, 1.5]) out.push([q.x + Math.cos(a) * dmed * m, q.y + Math.sin(a) * dmed * m]);
  }
  return out;
}
const camDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function retrieve(policy, R, targets, s) {
  if (policy === 'off' || !R.length) return [];
  const budget = Math.min(s * targets.length, R.length);
  if (policy === 'greedy') {
    const pick = new Set();
    for (const q of targets) R.slice().sort((a, b) => poseDist(q, a.pose) - poseDist(q, b.pose)).slice(0, s).forEach(v => pick.add(v));
    return [...pick].slice(0, budget);
  }
  // spatial pass
  const A = [];
  const cand = new Set();
  for (const q of targets) {
    const ds = R.map(v => camDist(q, v.pose)).sort((a, b) => a - b);
    const dmed = Math.max(1, ds[Math.floor(ds.length / 2)]);
    const rad = 1.5 * Math.max(1, ds[Math.min(2, ds.length - 1)]);
    anchors(q, Math.min(dmed, 5)).forEach(p => A.push(p));
    R.forEach(v => { if (camDist(q, v.pose) <= rad) cand.add(v); });
  }
  const covered = new Uint8Array(A.length), chosen = [];
  const covers = v => A.map(([x, y]) => inView(v.pose, x, y));
  const cov = new Map([...cand].map(v => [v, covers(v)]));
  while (chosen.length < budget) {
    let best = null, bn = 0;
    for (const [v, c] of cov) {
      if (chosen.includes(v)) continue;
      let n = 0; for (let i = 0; i < A.length; i++) if (c[i] && !covered[i]) n++;
      if (n > bn) { bn = n; best = v; }
    }
    if (!best) break;
    chosen.push(best); cov.get(best).forEach((c, i) => { if (c) covered[i] = 1; });
  }
  if (policy === 'angular') {
    // fill missing target-relative headings, beyond the spatial radius
    const q = targets[Math.floor(targets.length / 2)];
    let extra = 0;
    for (const h of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      if (extra >= 4) break;
      const has = chosen.some(v => Math.abs(wrap(v.pose.yaw - q.yaw - h)) < Math.PI / 4);
      if (has) continue;
      let best = null, bs = -Infinity;
      for (const v of R) {
        if (chosen.includes(v) || Math.abs(wrap(v.pose.yaw - q.yaw - h)) >= Math.PI / 4) continue;
        const ov = covers(v).filter(Boolean).length, sc = ov - 0.15 * camDist(q, v.pose);
        if (sc > bs) { bs = sc; best = v; }
      }
      if (best) { chosen.push(best); extra++; }
    }
  }
  // pose non-maximum suppression, no refill
  const keep = [];
  for (const v of chosen) if (!keep.some(k => poseDist(k.pose, v.pose) < 0.12)) keep.push(v);
  return keep;
}

// opt: { prefill: [pose], policy, s, Ltgt, Lmot, Lsin, seed }
export function createStream(opt = {}) {
  const st = {
    policy: opt.policy || 'angular', s: opt.s ?? 1, Ltgt: opt.Ltgt ?? 3, Lmot: opt.Lmot ?? 2, Lsin: opt.Lsin ?? 2,
    pool: [], history: [], chunks: [], salt: (opt.seed ?? 1) * 7919,
    lastSeen: new Map(), revisitN: 0, revisitMatch: 0, reconN: 0, colN: 0,
  };
  for (const pose of opt.prefill || []) {
    const cols = observe(pose), obs = new Map();
    for (const c of cols) if (c.key >= 0) obs.set(c.key, truthColor(c.key));
    st.pool.push({ id: st.pool.length, kind: 'prefill', pose, cols, obs, chunk: -1 });
  }
  st.step = targets => generateChunk(st, targets);
  return st;
}

function generateChunk(st, targets) {
  const ci = st.chunks.length;
  const sink = st.pool.filter(v => v.kind === 'prefill').slice(0, st.Lsin);
  const motion = st.history.slice(-st.Lmot);
  const R = st.pool.filter(v => !sink.includes(v) && !motion.includes(v));
  const retrieved = retrieve(st.policy, R, targets, st.s);
  const active = [...motion.slice().reverse(), ...retrieved, ...sink];
  const local = new Map();   // colours agreed inside this chunk
  const seenNow = new Map();
  const views = [];
  let rec = 0, n = 0;
  for (const pose of targets) {
    const cols = observe(pose), obs = new Map(), src = [];
    for (const c of cols) {
      if (c.key < 0) { src.push(0); continue; }
      let col = null, from = 0;
      for (const v of active) { const k = v.obs.get(c.key); if (k) { col = k; from = 1; break; } }
      if (!col) col = local.get(c.key);
      if (!col) { col = priorColor(c.key, st.salt + ci * 131); from = 2; }
      if (from === 1) rec++;
      n++;
      local.set(c.key, col); obs.set(c.key, col); src.push(from === 2 ? 2 : 1);
      // revisit consistency: a bin that left the view for more than
      // REVISIT_GAP chunks and comes back must keep its earlier colour
      const f = st.lastSeen.get(c.key);
      if (f && f.chunk < ci && ci - f.chunk > REVISIT_GAP) { st.revisitN++; if (sameCol(f.col, col)) st.revisitMatch++; }
      seenNow.set(c.key, col);
    }
    const v = { id: st.pool.length, kind: 'history', pose, cols, obs, src, chunk: ci };
    views.push(v);
  }
  for (const v of views) { st.pool.push(v); st.history.push(v); }
  for (const [k, col] of seenNow) st.lastSeen.set(k, { chunk: ci, col });
  st.reconN += rec; st.colN += n;
  const ch = { index: ci, targets: views, sink, retrieved, motion, recon: n ? rec / n : 0, L: sink.length + retrieved.length + motion.length + targets.length };
  st.chunks.push(ch);
  return ch;
}
