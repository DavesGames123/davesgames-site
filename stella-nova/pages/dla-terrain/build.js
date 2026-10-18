// ============================================================================
//  DLA TERRAIN  ·  build.js — "Watch it build": the timeline (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  The generator (lib/dla-terrain.js) sends progress snapshots stage by
//  stage. In the normal mode the page shows each one as it comes (fast). In
//  "Watch it build" the page records them (createRecorder) and plays them
//  back slowly, one stage at a time (build-player.js). This file decides
//  WHAT is on screen at a playback time t, so node tests can check it.
//
//  SEGMENTS  the 8 stages in order, each with a duration at 1x (s), a short
//    label for the stage bar, a name, a caption (what the stage does and
//    why) and the sub-phases:
//      dla      the DLA tree grows on flat ground, level by level, with the
//               walkers that stick to it (top-down camera)
//      upscale  each level is blurred and sharpened: the ridges rise out of
//               the tree, which fades
//      shape    warp, noise and the land masks reshape the relief; sea level
//      flow     the branched-flow rays fan out, then the channel density
//               shows and cuts the valleys
//      rivers   the flow accumulation lights up (trunks first), then the
//               rivers are picked (camera low)
//      erosion  the valleys deepen (blue) and the sediment fans form (sand)
//      climate  temperature, then moisture, as a tinted overlay
//      biomes   the colour fades in, then the water, then the vegetation
//  TOTAL_S  the sum of the durations (1x).
//
//  createRecorder({ maxN }) -> rec   rec.add(progress) keeps each snapshot
//    (fields over maxN are resampled down, nearest); rec.finish(terrain);
//    rec.frames(stage) -> [frame]; rec.complete(stage); rec.dlaLevels();
//    rec.levelReady(k); rec.reset(). A frame = { stage, label, frac,
//    stageFrac, snap }.
//  segStart(i), locate(t) -> { i, u, t0, seg }: the segment at time t, u
//    0..1 inside it; timeOfSeg(i, u).
//  ready(rec, t) -> true when the data for time t has arrived (else the
//    player holds the clock: the generator is still on that stage).
//  stateAt(rec, t) -> the plan of the moment: { i, u, seg, phase, ground:
//    { key, kind 'flat'|'frame'|'snapFinal'|'final', frame, blend },
//    overlay: { key, kind 'tree'|'rays'|'flow'|'erosion'|'climate'|null,
//    reveal, amount, amount2, frame, base }, veil, veg, rivers }.
//    blend is the share of the segment over which the ground blends.
//  camFor(i, u, opts) -> { yaw, pitch, distK, low, distMax? }: the camera
//    of the moment (distMax m caps distK x world size near the end, so the
//    plants are in view) (top-down for DLA, a slow oblique orbit as the relief rises,
//    low over the rivers).
//  walkers(tree, reveal, n, time, ws) -> Float32Array (x, z, light, r) x n:
//    the DLA walkers that are about to stick (each one lands on the
//    particle that the reveal shows next).
//  treeField, raysField, flowField, erosionField, climateField -> { n,
//    data: Float32Array n*n*4 }: the overlay textures (r reveal key, g and
//    b values; see render/build.js).
//
//  grep -n targets: "export const SEGMENTS", "export function createRecorder",
//  "export function locate", "export function ready", "export function stateAt",
//  "export function camFor", "export function walkers", "export function treeField"
// ============================================================================

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const SEGMENTS = Object.freeze([
  { id: 'dla', label: 'DLA', name: 'DLA growth', dur: 14, phases: [['tree', 0]],
    caption: 'Random walkers wander in and stick where they touch the tree. Branches grow toward the walkers, so the tree forks the way ridges and drainage divides do.' },
  { id: 'upscale', label: 'Upscale', name: 'Upscale', dur: 8, phases: [['rise', 0]],
    caption: 'Each level of the tree is blurred and the next, finer tree goes on top. A trunk stands high and a tip low, so broad mountains rise with sharp ridges.' },
  { id: 'shape', label: 'Shape', name: 'Shape', dur: 7, phases: [['warp', 0]],
    caption: 'A domain warp bends the ridges, noise adds texture, and the land masks set the coast. The sea level is put where the sea takes its share.' },
  { id: 'flow', label: 'Flow', name: 'Branched flow', dur: 10, phases: [['rays', 0], ['channels', 0.55]],
    caption: 'Rays go through a smooth random field. Weak lensing bunches them into branches, and their density marks the channels that cut the valleys.' },
  { id: 'rivers', label: 'Rivers', name: 'Rivers', dur: 9, phases: [['accumulate', 0], ['beds', 0.6]],
    caption: 'Rain flows downhill cell to cell and adds up. The big trunks light first, then the tributaries, and the largest flows become rivers.' },
  { id: 'erosion', label: 'Erosion', name: 'Erosion', dur: 10, phases: [['incise', 0], ['carve', 0.85]],
    caption: 'Stream power cuts the beds down (blue) and the sediment settles where the slope eases (sand): valleys deepen and fans spread at the mouths.' },
  { id: 'climate', label: 'Climate', name: 'Climate', dur: 7, phases: [['temperature', 0], ['moisture', 0.5]],
    caption: 'Temperature falls with height and latitude (blue cold, red warm). Wind carries moisture inland and drops it on the windward side (teal wet).' },
  { id: 'biomes', label: 'Biomes', name: 'Biomes', dur: 10, phases: [['colour', 0], ['water', 0.4], ['vegetation', 0.7]],
    caption: 'Temperature, moisture, slope and water pick one of 16 biomes. The colour comes in, then the rivers and lakes, then the forests and grass.' },
]);
export const TOTAL_S = SEGMENTS.reduce((a, s) => a + s.dur, 0);
export const SPEEDS = [0.5, 1, 2, 4];

export function segStart(i) {
  let t = 0;
  for (let k = 0; k < i && k < SEGMENTS.length; k++) t += SEGMENTS[k].dur;
  return t;
}
export function locate(t) {
  const tt = clamp(t, 0, TOTAL_S);
  let t0 = 0;
  for (let i = 0; i < SEGMENTS.length; i++) {
    const d = SEGMENTS[i].dur;
    if (tt < t0 + d || i === SEGMENTS.length - 1) return { i, u: clamp((tt - t0) / d, 0, 1), t0, seg: SEGMENTS[i] };
    t0 += d;
  }
  return null;
}
export function timeOfSeg(i, u = 0) { return segStart(i) + clamp(u, 0, 1) * SEGMENTS[clamp(i, 0, SEGMENTS.length - 1)].dur; }
export function phaseOf(seg, u) {
  let p = seg.phases[0][0];
  for (const [id, at] of seg.phases) if (u >= at) p = id;
  return p;
}

// ── RECORDER ────────────────────────────────────────────────────────────
// nearest resample of an n x n field to m x m (any typed array)
export function shrink(a, n, m) {
  if (!a || n <= m) return a;
  const out = new a.constructor(m * m);
  for (let j = 0; j < m; j++) {
    const sj = Math.min(n - 1, Math.floor((j + 0.5) * n / m)) * n;
    for (let i = 0; i < m; i++) out[j * m + i] = a[sj + Math.min(n - 1, Math.floor((i + 0.5) * n / m))];
  }
  return out;
}
const FIELDS = ['height', 'flow', 'river', 'water', 'moisture', 'temperature', 'channel', 'biome', 'sediment'];

export function createRecorder(opts = {}) {
  const maxN = opts.maxN || 512;
  const rec = { byStage: new Map(), done: new Set(), order: [], terrain: null, maxN, count: 0 };
  rec.reset = () => { rec.byStage = new Map(); rec.done = new Set(); rec.order = []; rec.terrain = null; rec.count = 0; };
  rec.add = p => {
    if (!p || !p.stage) return null;
    const id = p.stage;
    // a later stage completes the ones before it
    const k = SEGMENTS.findIndex(s => s.id === id);
    for (let j = 0; j < k; j++) rec.done.add(SEGMENTS[j].id);
    if (!p.snapshot || !p.snapshot.height) return null;
    const s = p.snapshot, n = s.n || Math.round(Math.sqrt(s.height.length)), m = Math.min(n, maxN);
    const snap = { n: m, worldSize: s.worldSize, seaLevel: s.seaLevel, heightScale: s.heightScale };
    for (const f of FIELDS) if (s[f] && s[f].length === n * n) snap[f] = shrink(s[f], n, m);
    if (s.dla) snap.dla = s.dla;
    if (s.rays) snap.rays = s.rays;
    const fr = { stage: id, label: p.label, frac: p.frac, stageFrac: p.stageFrac ?? 1, snap, at: rec.count++ };
    if (!rec.byStage.has(id)) rec.byStage.set(id, []);
    rec.byStage.get(id).push(fr);
    rec.order.push(fr);
    if (id === 'biomes' && s.biome) rec.done.add('biomes');
    return fr;
  };
  rec.finish = t => { rec.terrain = t || null; for (const s of SEGMENTS) rec.done.add(s.id); };
  rec.frames = id => rec.byStage.get(id) || [];
  rec.complete = id => rec.done.has(id);
  rec.dlaLevels = () => {
    const f = rec.frames('dla');
    for (const x of f) if (x.snap.dla && x.snap.dla.levels) return x.snap.dla.levels;
    return 1;
  };
  // the last snapshot of DLA level k, once that level is grown
  rec.levelFrame = k => {
    const f = rec.frames('dla');
    let last = null;
    for (const x of f) {
      const lv = x.snap.dla && Number.isFinite(x.snap.dla.level) ? x.snap.dla.level : Math.min(rec.dlaLevels() - 1, Math.floor((x.stageFrac - 1e-6) * rec.dlaLevels()));
      if (lv === k) last = x;
      else if (lv > k && last) return last;
    }
    // the last chunk of a level ends at stageFrac (k + 1) / levels
    if (last && last.stageFrac >= (k + 1) / rec.dlaLevels() - 1e-6) return last;
    return rec.complete('dla') ? last : null;
  };
  rec.levelReady = k => !!rec.levelFrame(k);
  return rec;
}

// ── PLAYBACK ────────────────────────────────────────────────────────────
export function ready(rec, t) {
  const L = locate(t);
  if (!L) return false;
  const id = L.seg.id;
  if (id === 'dla') {
    const lv = rec.dlaLevels(), k = Math.min(lv - 1, Math.floor(L.u * lv));
    return rec.levelReady(k);
  }
  if (id === 'biomes') return rec.complete('biomes') && rec.frames('biomes').length > 0 && !!rec.terrain;
  return rec.complete(id);
}
const lastOf = a => (a.length ? a[a.length - 1] : null);
// the newest frame of the stages before segment i (what the ground shows
// when segment i has not yet changed it)
function before(rec, i) {
  for (let k = i - 1; k >= 1; k--) { const f = lastOf(rec.frames(SEGMENTS[k].id)); if (f) return f; }
  return null;
}

export function stateAt(rec, t) {
  const L = locate(t);
  const { i, u, seg } = L;
  const st = {
    i, u, seg, phase: phaseOf(seg, u), t,
    ground: { key: 'flat', kind: 'flat', frame: null, blend: 0.12 },
    overlay: { key: 'none', kind: null, reveal: 1, amount: 0, amount2: 0, frame: null, base: null },
    veil: 0, veg: false, rivers: false,
  };
  const frameGround = (f, blend) => (f ? { key: 'f' + f.at, kind: 'frame', frame: f, blend } : st.ground);
  const F = rec.frames(seg.id);
  switch (seg.id) {
    case 'dla': {
      const lv = rec.dlaLevels(), k = Math.min(lv - 1, Math.floor(u * lv)), lu = u * lv - k;
      const f = rec.levelFrame(k);
      st.level = k; st.levels = lv;
      if (f) st.overlay = { key: 'tree' + f.at, kind: 'tree', reveal: clamp(lu * 1.12, 0, 1), amount: 1, amount2: 0, frame: f, base: null };
      break;
    }
    case 'upscale': {
      const tree = rec.levelFrame(rec.dlaLevels() - 1);
      if (F.length) {
        const k = Math.min(F.length - 1, Math.floor(u * F.length));
        st.ground = frameGround(F[k], 0.85 / F.length);
      }
      if (tree) st.overlay = { key: 'tree' + tree.at, kind: 'tree', reveal: 1, amount: 1 - sstep(0.05, 0.6, u), amount2: 0, frame: tree, base: null };
      break;
    }
    case 'shape':
      st.ground = frameGround(lastOf(F) || before(rec, i), 0.8);
      break;
    case 'flow': {
      const f = lastOf(F);
      const rays = f && f.snap.rays && f.snap.rays.off && f.snap.rays.off.length > 1;
      if (u < 0.55) st.ground = frameGround(lastOf(rec.frames('shape')) || before(rec, i), 0.2);
      else st.ground = frameGround(f, 0.4);
      if (f && (rays || f.snap.channel)) {
        st.overlay = { key: 'rays' + f.at, kind: 'rays', reveal: rays ? clamp(u / 0.5, 0, 1) : 1, amount: rays ? 1 - 0.55 * sstep(0.55, 0.8, u) : 0, amount2: sstep(0.5, 0.75, u) * (1 - 0.6 * sstep(0.85, 1, u)), frame: f, base: null };
      }
      break;
    }
    case 'rivers': {
      const f = lastOf(F);
      st.ground = u < 0.6 ? frameGround(lastOf(rec.frames('flow')) || before(rec, i), 0.2) : frameGround(f, 0.3);
      if (f && f.snap.flow) st.overlay = { key: 'flow' + f.at, kind: 'flow', reveal: clamp(u / 0.55, 0, 1), amount: 1 - 0.5 * sstep(0.6, 0.9, u), amount2: sstep(0.6, 0.8, u), frame: f, base: null };
      break;
    }
    case 'erosion': {
      if (F.length) {
        const k = Math.min(F.length - 1, Math.floor(clamp(u / 0.85, 0, 1) * (F.length - 1) + 1e-9));
        const kk = u >= 0.85 ? F.length - 1 : k;
        st.ground = frameGround(F[kk], 0.85 / F.length);
        const base = lastOf(rec.frames('rivers')) || lastOf(rec.frames('flow'));
        if (base) st.overlay = { key: 'ero' + F[kk].at, kind: 'erosion', reveal: 1, amount: sstep(0, 0.12, u) * (1 - 0.7 * sstep(0.88, 1, u)), amount2: 0, frame: F[kk], base };
      }
      break;
    }
    case 'climate': {
      const f = lastOf(F);
      st.ground = frameGround(f || before(rec, i), 0.3);
      if (f && (f.snap.temperature || f.snap.moisture)) st.overlay = { key: 'clim' + f.at, kind: 'climate', reveal: 1, amount: sstep(0, 0.1, u) * (1 - sstep(0.45, 0.6, u)), amount2: sstep(0.45, 0.6, u) * (1 - 0.5 * sstep(0.9, 1, u)), frame: f, base: null };
      break;
    }
    case 'biomes': {
      const f = lastOf(F);
      if (u < 0.4 || !rec.terrain) st.ground = f ? { key: 'b' + f.at, kind: 'snapFinal', frame: f, blend: 0.05 } : frameGround(before(rec, i), 0.1);
      else st.ground = { key: 'final', kind: 'final', frame: null, blend: 0.08 };
      st.veil = 1 - sstep(0, 0.35, u);
      st.rivers = u >= 0.4;
      st.veg = u >= 0.7;
      break;
    }
  }
  return st;
}

// ── CAMERA ──────────────────────────────────────────────────────────────
// opts = { yaw0 (the start yaw), t (s, playback), portrait }
export function camFor(i, u, opts = {}) {
  const yaw0 = opts.yaw0 || 0, t = opts.t || 0, pk = opts.portrait ? 1.25 : 1;
  const spin = yaw0 + t * 0.018;
  const id = SEGMENTS[clamp(i, 0, SEGMENTS.length - 1)].id;
  let c;
  switch (id) {
    case 'dla': c = { yaw: yaw0, pitch: -1.5, distK: 1.05, low: false }; break;
    case 'upscale': c = { yaw: spin, pitch: -1.5 + 0.9 * sstep(0, 1, u), distK: 1.05 - 0.3 * sstep(0, 1, u), low: false }; break;
    case 'shape': c = { yaw: spin, pitch: -0.6 + 0.08 * u, distK: 0.75, low: false }; break;
    case 'flow': c = { yaw: spin, pitch: -0.62 - 0.25 * sstep(0, 0.5, u) + 0.25 * sstep(0.55, 1, u), distK: 0.8, low: false }; break;
    case 'rivers': c = { yaw: spin, pitch: -0.55 + 0.33 * sstep(0, 0.7, u), distK: 0.7 - 0.38 * sstep(0, 0.7, u), low: true, distMax: 14000 - 8000 * sstep(0, 0.7, u) }; break;
    case 'erosion': c = { yaw: spin, pitch: -0.3 - 0.1 * u, distK: 0.36 + 0.1 * u, low: true }; break;
    case 'climate': c = { yaw: spin, pitch: -0.8, distK: 0.85, low: false }; break;
    default: c = { yaw: spin, pitch: -0.42 + 0.2 * sstep(0, 1, u), distK: 0.62 - 0.3 * sstep(0, 0.9, u), low: u > 0.3, distMax: 9000 - 6500 * sstep(0.55, 0.95, u) }; break;
  }
  c.distK *= pk;
  if (c.distMax) c.distMax *= pk;
  return c;
}

// ── WALKERS ─────────────────────────────────────────────────────────────
const hash = (x) => { let h = (x | 0) * 0x9E3779B1; h ^= h >>> 15; h = Math.imul(h, 0x85EBCA77); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
// tree = frame.snap.dla; the walkers land on the particles that the reveal
// shows in the next 14 % of the level, each one wanders less as it nears
export function walkers(tree, reveal, n, time, ws) {
  const out = new Float32Array(n * 4);
  if (!tree || !tree.count) return out;
  const start = tree.start || 0, cnt = tree.count, span = Math.max(1, cnt - start);
  const look = 0.14, step = 0.006 * ws;
  for (let j = 0; j < n; j++) {
    const ahead = (j + 0.5) / n * look;
    const key = reveal + ahead;
    if (key > 1.02 || reveal >= 1) { out[j * 4 + 2] = 0; continue; }
    const p = clamp(start + Math.floor(Math.min(1, key) * span), 0, cnt - 1);
    const tx = tree.pos[p * 2], tz = tree.pos[p * 2 + 1];
    const far = ahead / look;                    // 1 = just spawned, 0 = sticks now
    const h1 = hash(p * 7 + 1), h2 = hash(p * 13 + 5);
    const a = h1 * 6.2832 + time * (0.7 + h2) + Math.sin(time * 3.1 + h2 * 9) * 0.8;
    const r = far * far * ws * 0.08 * (0.5 + h2) + far * step * Math.sin(time * 7.3 + h1 * 20);
    out[j * 4] = tx + Math.cos(a) * r;
    out[j * 4 + 1] = tz + Math.sin(a) * r;
    out[j * 4 + 2] = (1 - far) * 0.8 + 0.2;
    out[j * 4 + 3] = 1;
  }
  return out;
}

// ── OVERLAY FIELDS ──────────────────────────────────────────────────────
// the texel of a world point (x, z) on an N grid over [-ws/2, ws/2]
const NEVER = 2;
function blank(N) {
  const d = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) d[i * 4] = NEVER;
  return d;
}
function stamp(d, N, fx, fy, key, val, rad) {
  const r = Math.ceil(rad), x0 = Math.floor(fx), y0 = Math.floor(fy);
  for (let y = y0 - r; y <= y0 + r + 1; y++) {
    if (y < 0 || y >= N) continue;
    for (let x = x0 - r; x <= x0 + r + 1; x++) {
      if (x < 0 || x >= N) continue;
      const dd = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
      if (dd > rad + 0.5) continue;
      const w = val * clamp(1.2 - dd / (rad + 0.5), 0, 1);
      const k = (y * N + x) * 4;
      if (key < d[k]) d[k] = key;
      if (w > d[k + 1]) d[k + 1] = w;
    }
  }
}
function line(d, N, ax, ay, bx, by, k0, k1, val, rad, add) {
  const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / 0.7));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, key = k0 + (k1 - k0) * t;
    if (add) {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi >= 0 && yi >= 0 && xi < N && yi < N) { const k = (yi * N + xi) * 4; if (key < d[k]) d[k] = key; d[k + 1] += val / steps * len; }
    } else stamp(d, N, x, y, key, val, rad);
  }
}
// hops from each particle to its farthest leaf (a trunk is high)
function leafHops(parent, count) {
  const L = new Float32Array(count);
  for (let i = count - 1; i >= 0; i--) { const p = parent[i]; if (p >= 0 && L[i] + 1 > L[p]) L[p] = L[i] + 1; }
  return L;
}
// r = the reveal key of the branch (0 for the particles of the level
// before), g = the light (trunks bright, tips dim)
export function treeField(tree, ws, N) {
  const d = blank(N);
  if (!tree || !tree.count) return { n: N, data: d };
  const { pos, parent, count } = tree, start = tree.start || 0, span = Math.max(1, count - start);
  const L = leafHops(parent, count);
  const k = N / ws, o = ws / 2;
  const rad = clamp(N / 900, 0.6, 1.6);
  for (let i = 0; i < count; i++) {
    const p = parent[i];
    const key = i < start ? 0 : (i - start) / span;
    const val = 0.35 + 0.65 * (1 - 1 / (1 + L[i] / 5));
    const ax = (pos[i * 2] + o) * k, ay = (pos[i * 2 + 1] + o) * k;
    if (p < 0) { stamp(d, N, ax, ay, key, val, rad * 1.5); continue; }
    const kp = p < start ? 0 : (p - start) / span;
    line(d, N, (pos[p * 2] + o) * k, (pos[p * 2 + 1] + o) * k, ax, ay, Math.max(kp, key - 1e-4), key, val, rad * (0.7 + 0.6 * (1 - 1 / (1 + L[i] / 5))), false);
  }
  return { n: N, data: d };
}
// rays: r = the step share where a ray first reaches the texel, g = the
// log ray density (0..1); b = the channel field of the snapshot
export function raysField(snap, ws, N) {
  const d = blank(N);
  const rays = snap && snap.rays;
  if (rays && rays.off && rays.off.length > 1) {
    const k = N / ws, o = ws / 2, steps = Math.max(1, rays.steps || 1);
    for (let r = 0; r + 1 < rays.off.length; r++) {
      const a = rays.off[r], b = rays.off[r + 1];
      for (let p = a + 1; p < b; p++) {
        line(d, N, (rays.pts[(p - 1) * 2] + o) * k, (rays.pts[(p - 1) * 2 + 1] + o) * k, (rays.pts[p * 2] + o) * k, (rays.pts[p * 2 + 1] + o) * k,
          (p - 1 - a) / steps, (p - a) / steps, 1, 0, true);
      }
    }
    let mx = 0;
    for (let i = 0; i < N * N; i++) { const v = Math.log1p(d[i * 4 + 1]); d[i * 4 + 1] = v; if (v > mx) mx = v; }
    if (mx > 0) for (let i = 0; i < N * N; i++) d[i * 4 + 1] /= mx;
  }
  const ch = snap && snap.channel;
  if (ch) {
    const n = snap.n;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = ch[Math.min(n - 1, Math.floor((j + 0.5) * n / N)) * n + Math.min(n - 1, Math.floor((i + 0.5) * n / N))];
      d[(j * N + i) * 4 + 2] = v;
    }
  }
  return { n: N, data: d };
}
// flow accumulation: g = log flow 0..1, r = 1 - g (the trunks first),
// b = the river mask
export function flowField(snap) {
  const n = snap.n, N = n * n, d = new Float32Array(N * 4);
  const f = snap.flow, rv = snap.river;
  let mx = 0;
  const lf = new Float32Array(N);
  for (let i = 0; i < N; i++) { const v = f ? Math.log1p(Math.max(0, f[i]) * 50) : 0; lf[i] = v; if (v > mx) mx = v; }
  // a 3 x 3 max filter, so a one-cell channel still reads from afar
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0, r = 0;
    for (let y = Math.max(0, j - 1); y <= Math.min(n - 1, j + 1); y++) for (let x = Math.max(0, i - 1); x <= Math.min(n - 1, i + 1); x++) {
      const k = y * n + x, w = (x === i && y === j) ? 1 : 0.8;
      if (lf[k] * w > v) v = lf[k] * w;
      if (rv && rv[k] * w > r) r = rv[k] * w;
    }
    v = mx > 0 ? v / mx : 0;
    const k = j * n + i;
    d[k * 4] = v > 0.12 ? 1 - v : NEVER;
    d[k * 4 + 1] = v;
    d[k * 4 + 2] = r;
  }
  return { n, data: d };
}
// erosion: g = the cut (m below the base, 0..1 of 6 % of the relief),
// b = the deposit (sediment, or the rise above the base)
export function erosionField(snap, base) {
  const n = snap.n, N = n * n, d = new Float32Array(N * 4);
  const h = snap.height, bn = base.snap.n, bh = base.snap.height;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i += 7) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  const sc = Math.max(5, (hi - lo) * 0.06), sea = snap.seaLevel ?? 0;
  const sed = snap.sediment;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const b = bh[Math.min(bn - 1, Math.floor((j + 0.5) * bn / n)) * bn + Math.min(bn - 1, Math.floor((i + 0.5) * bn / n))];
    const dh = h[k] - b;
    d[k * 4] = 0;
    d[k * 4 + 1] = clamp(-dh / sc, 0, 1);
    const dep = sed ? sed[k] / (sc * 0.5) : dh / sc;
    d[k * 4 + 2] = h[k] < sea - 1 ? 0 : clamp(dep, 0, 1);
  }
  return { n, data: d };
}
// climate: g = temperature 0..1 (-15 C .. 30 C), b = moisture 0..1
export function climateField(snap) {
  const n = snap.n, N = n * n, d = new Float32Array(N * 4);
  const T = snap.temperature, M = snap.moisture;
  for (let i = 0; i < N; i++) {
    d[i * 4 + 1] = T ? clamp((T[i] + 15) / 45, 0, 1) : 0.5;
    d[i * 4 + 2] = M ? clamp(M[i], 0, 1) : 0;
  }
  return { n, data: d };
}

// the stage name and caption of a state, for the bar and the saver plate
export function captionOf(st) {
  const s = st.seg;
  let name = s.name;
  if (s.id === 'dla' && st.levels > 1) name += ` · level ${st.level + 1} of ${st.levels}`;
  if (s.phases.length > 1) name += ' · ' + st.phase;
  return { name, caption: s.caption, index: st.i, label: s.label };
}
