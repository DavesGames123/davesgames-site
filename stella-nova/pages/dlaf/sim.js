// ============================================================================
//  DLAF PAGE  ·  sim.js — presets, hooks, colour values, CSV and replay
// ----------------------------------------------------------------------------
//  DOM-free. main.js, the saver and tests.mjs import it. The growth itself is
//  lib/dla-engine.js (a port of fogleman/dlaf, MIT). This file only sets up
//  models: the seeds and the hook functions of each preset, the value that
//  each "Colour by" mode gives a particle, the prefix maxima that let the
//  replay colour a partial cluster, and the CSV text of the dlaf output.
//
//  A preset is { id, name, hook, dim, params, note, seeds(m), hooks, frame(m),
//  code }. seeds(m) adds the seed particles. hooks replace the dlaf hooks.
//  frame(m) gives the world box that the view fits. code is a short extract
//  of the hook source (Function.prototype.toString of the real hook, or the
//  dlaf.cpp lines that the preset copies).
//
//  grep -n targets
//    presets ............... "export const PRESETS"
//    model setup ........... "export function createSim"
//    colour values ......... "export function valueOf"
//    colour mapping ........ "export function colourT"
//    replay ................ "export function replayRange"
//    prefix subtree ........ "export function subtreePrefix"
//    CSV lines ............. "export function csvTail"
//    engine extract ........ "export function engineExtract"
// ============================================================================
import { createModel, rng, randomInUnitSphere, DEFAULTS, PARAM_INFO } from '../../lib/dla-engine.js';

export { DEFAULTS, PARAM_INFO, rng };

// The colour-by modes. gamma > 1 keeps most of an age-coloured cluster
// cool, so only the growth front is at the hot end. floor lifts t above the
// black end of inferno and magma, so old branches stay visible on the dark
// background.
export const COLOUR_MODES = Object.freeze([
  { id: 'age', label: 'Age', short: 'Age', lo: 'old', hi: 'new', gamma: 1.8, floor: 0.12,
    text: 'Order of joining. The newest particles are hot, so the growth front glows.' },
  { id: 'depth', label: 'Depth', short: 'Depth', lo: 'seed', hi: 'tip', gamma: 1, floor: 0.1,
    text: 'Hops along the parent links back to a seed.' },
  { id: 'distance', label: 'Distance', short: 'Dist', lo: 'near', hi: 'far', gamma: 1, floor: 0.1,
    text: 'Straight distance from the seed (or from the frame centre).' },
  { id: 'flow', label: 'Flow', short: 'Flow', lo: 'twig', hi: 'trunk', gamma: 1, floor: 0.08,
    text: 'Subtree size on a log scale. Trunks carry many particles, so they glow.' },
]);
export const MODE_IDS = COLOUR_MODES.map(c => c.id);
export function modeInfo(id) { return COLOUR_MODES.find(c => c.id === id) || COLOUR_MODES[0]; }

// Unit vector helper for the hooks.
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }

// ------------------------------------------------------------------ hooks
// The hooks are named functions, so their source is the code extract that the
// page and the saver show.

// The ring preset: walkers start inside the ring and start again when they
// leave it, so the growth goes inward from the seeds.
function ringStart(m, out) {
  const r = m.user.ringR * 0.97 * Math.sqrt(m.random()), a = m.random() * 2 * Math.PI;
  out[0] = Math.cos(a) * r; out[1] = Math.sin(a) * r; out[2] = 0;
  return out;
}
function ringReset(m, p) {
  return Math.hypot(p[0], p[1]) > m.user.ringR * 1.02;
}

// The line preset: walkers start above the highest particle, and start
// again when they go too high, too far to the side or below the line.
function lineStart(m, out) {
  const L = m.user.halfLen, top = m.user.ext[3];
  out[0] = (m.random() * 2 - 1) * L; out[1] = top + m.params.attractionDistance + 4; out[2] = 0;
  return out;
}
function lineReset(m, p) {
  const L = m.user.halfLen, top = m.user.ext[3];
  return p[1] > top * 1.5 + 30 || Math.abs(p[0]) > L * 1.1 || p[1] < -m.params.attractionDistance;
}

// The wind preset: a random direction plus a steady drift to +x.
function windMotion(m, p, out) {
  randomInUnitSphere(m.random, m.dim, out);
  norm(out);
  out[0] += m.user.wind;
  return out;
}

// The needle preset: the new particle continues the direction of its
// parent branch, half way between that direction and the walker.
function needlePlace(m, p, parent, out) {
  const P = m.pos, g = m.parent[parent], s = m.params.particleSpacing;
  const ax = P[parent * 3], ay = P[parent * 3 + 1], az = P[parent * 3 + 2];
  const w = norm([p[0] - ax, p[1] - ay, p[2] - az]);
  if (g >= 0) {
    const b = norm([ax - P[g * 3], ay - P[g * 3 + 1], az - P[g * 3 + 2]]);
    const k = m.user.straight;
    w[0] = w[0] * (1 - k) + b[0] * k; w[1] = w[1] * (1 - k) + b[1] * k; w[2] = w[2] * (1 - k) + b[2] * k;
    norm(w);
  }
  out[0] = ax + w[0] * s; out[1] = ay + w[1] * s; out[2] = az + w[2] * s;
  return out;
}

// dlaf.cpp lines that the presets copy (MIT, Copyright (C) 2019 Michael Fogleman).
export const DLAF_MAIN = `// add seed point(s)
model.Add(Vector());`;
export const DLAF_RING = `// {
//     const int n = 3600;
//     const double r = 1000;
//     for (int i = 0; i < n; i++) {
//         const double t = (double)i / n;
//         const double a = t * 2 * M_PI;
//         const double x = std::cos(a) * r;
//         const double y = std::sin(a) * r;
//         model.Add(Vector(x, y, 0));
//     }
// }`;
export const DLAF_SHOULDJOIN = `bool ShouldJoin(const Vector &p, const int parent) {
    m_JoinAttempts[parent]++;
    if (m_JoinAttempts[parent] < m_Stubbornness) {
        return false;
    }
    return Random() <= m_Stickiness;
}`;
export const DLAF_ADDPARTICLE = `// do the random walk
while (true) {
    // get distance to nearest other particle
    const int parent = Nearest(p);
    const double d = p.Distance(m_Points[parent]);

    // check if close enough to join
    if (d < m_AttractionDistance) {
        if (!ShouldJoin(p, parent)) {
            // push particle away a bit
            p = Lerp(m_Points[parent], p,
                m_AttractionDistance + m_MinMoveDistance);
            continue;
        }
        // adjust particle position in relation to its parent
        p = PlaceParticle(p, parent);
        // add the point
        Add(p, parent);
        return;
    }

    // move randomly
    const double m = std::max(
        m_MinMoveDistance, d - m_AttractionDistance);
    p += MotionVector(p).Normalized() * m;

    // check if particle is too far away, reset if so
    if (ShouldReset(p)) {
        p = RandomStartingPosition();
    }
}`;

const src = f => String(f).replace(/^ {0,2}/gm, '');

// A box around the origin that holds the cluster.
function roundFrame(m) {
  const r = Math.max(14, m.user.maxDist + m.params.attractionDistance);
  return { x0: -r, x1: r, y0: -r, y1: r, z0: -r, z1: r };
}

export const PRESETS = Object.freeze([
  { id: 'classic', name: 'Classic seed', hook: 'main(): one seed', dim: 2, params: {},
    note: 'The default model of dlaf: one seed at the origin and the five default parameters.',
    seeds(m) { m.add([0, 0, 0]); },
    frame: roundFrame, code: { lang: 'cpp', name: 'dlaf.cpp', text: DLAF_MAIN } },
  { id: 'ring', name: 'Ring of seeds', hook: 'main(): circle of seeds', dim: 2, params: {},
    note: 'The commented block in main() of dlaf.cpp: seeds on a ring (3600 at r = 1000 there, the same spacing here). Our RandomStartingPosition and ShouldReset keep the walkers inside the ring, so the growth goes inward.',
    seeds(m) {
      const r = m.user.ringR, n = Math.round(3.6 * r);
      for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; m.add([Math.cos(a) * r, Math.sin(a) * r, 0]); }
    },
    user: { ringR: 150 },
    hooks: { randomStartingPosition: ringStart, shouldReset: ringReset },
    frame(m) { const r = m.user.ringR + 6; return { x0: -r, x1: r, y0: -r, y1: r, z0: -r, z1: r }; },
    code: { lang: 'cpp', name: 'dlaf.cpp main()', text: DLAF_RING + '\n\n// our hooks\n' + src(ringStart) + '\n' + src(ringReset) } },
  { id: 'line', name: 'Line seed', hook: 'RandomStartingPosition, ShouldReset', dim: 2, params: {},
    note: 'A row of seeds on y = 0. Walkers start above the highest particle, so a forest grows up from the line.',
    seeds(m) { const L = m.user.halfLen; for (let x = -L; x <= L; x += 1) m.add([x, 0, 0]); },
    user: { halfLen: 160 },
    hooks: { randomStartingPosition: lineStart, shouldReset: lineReset },
    frame(m) { const L = m.user.halfLen + 4, top = Math.max(30, m.user.ext[3] + 8); return { x0: -L, x1: L, y0: -4, y1: top, z0: -1, z1: 1 }; },
    code: { lang: 'js', name: 'sim.js', text: src(lineStart) + '\n' + src(lineReset) } },
  { id: 'wind', name: 'Wind drift', hook: 'MotionVector', dim: 2, params: {},
    note: 'MotionVector adds a steady drift to +x. Walkers hit the upwind side first, so the cluster grows into the wind.',
    seeds(m) { m.add([0, 0, 0]); }, user: { wind: 0.55 },
    hooks: { motionVector: windMotion },
    frame: roundFrame, code: { lang: 'js', name: 'sim.js', text: src(windMotion) } },
  { id: 'sticky', name: 'Low stickiness', hook: 'ShouldJoin (Stickiness)', dim: 2, params: { stickiness: 0.06 },
    note: 'Stickiness 0.06: most join attempts fail and the walker is pushed back. It goes deeper before it joins, so the branches are thick and dense.',
    seeds(m) { m.add([0, 0, 0]); },
    frame: roundFrame, code: { lang: 'cpp', name: 'dlaf.cpp', text: DLAF_SHOULDJOIN } },
  { id: 'stubborn', name: 'High stubbornness', hook: 'ShouldJoin (Stubbornness)', dim: 2, params: { stubbornness: 14 },
    note: 'Stubbornness 14: a particle refuses the first 13 join attempts on it. A new tip cannot grow at once, so the cluster fills in.',
    seeds(m) { m.add([0, 0, 0]); },
    frame: roundFrame, code: { lang: 'cpp', name: 'dlaf.cpp', text: DLAF_SHOULDJOIN } },
  { id: 'needle', name: 'Straight branches', hook: 'PlaceParticle', dim: 2, params: { attractionDistance: 4 },
    note: 'PlaceParticle continues the direction of the parent branch, half way between that direction and the walker. The branches become long needles.',
    seeds(m) { m.add([0, 0, 0]); }, user: { straight: 0.6 },
    hooks: { placeParticle: needlePlace },
    frame: roundFrame, code: { lang: 'js', name: 'sim.js', text: src(needlePlace) } },
  { id: 'three', name: '3D cluster', hook: 'dim 3', dim: 3, params: {},
    note: 'The same walk in three dimensions. dlaf makes 3D with no other change: RandomInUnitSphere gives a point in the ball.',
    seeds(m) { m.add([0, 0, 0]); },
    frame: roundFrame, code: { lang: 'cpp', name: 'dlaf.cpp', text: `Vector RandomStartingPosition() const {
    const double d = m_BoundingRadius;
    return RandomInUnitSphere().Normalized() * d;
}` } },
]);
export const PRESET_IDS = PRESETS.map(p => p.id);
export function presetById(id) { return PRESETS.find(p => p.id === id) || PRESETS[0]; }

// createSim({ preset, seed, params, dim, onAdd }) -> model. The model gets
// m.user.ext (x0, x1, y0, y1 of the particles), m.user.maxDist, and the
// prefix maxima m.user.maxDepthAt / maxDistAt (Float32Array, index = id) for
// the replay. dim overrides the preset (3D of any 2D preset).
export function createSim(opts = {}) {
  const pr = typeof opts.preset === 'object' ? opts.preset : presetById(opts.preset);
  const user = Object.assign({ ext: [0, 0, 0, 0], maxDist: 0, maxDepth: 0, maxDepthAt: new Float32Array(1024), maxDistAt: new Float32Array(1024) }, pr.user || {});
  const dim = opts.dim || pr.dim;
  const m = createModel({
    dim, seed: opts.seed ?? 1, params: Object.assign({}, pr.params, opts.params || {}), hooks: pr.hooks, user,
    onAdd(i, par, mm) {
      const P = mm.pos, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], u = mm.user, e = u.ext;
      if (i === 0) { e[0] = e[1] = x; e[2] = e[3] = y; }
      if (x < e[0]) e[0] = x; if (x > e[1]) e[1] = x; if (y < e[2]) e[2] = y; if (y > e[3]) e[3] = y;
      const d = Math.hypot(x, y, z);
      if (d > u.maxDist) u.maxDist = d;
      if (mm.depth[i] > u.maxDepth) u.maxDepth = mm.depth[i];
      if (i >= u.maxDepthAt.length) {
        const a = new Float32Array(u.maxDepthAt.length * 2); a.set(u.maxDepthAt); u.maxDepthAt = a;
        const b = new Float32Array(u.maxDistAt.length * 2); b.set(u.maxDistAt); u.maxDistAt = b;
      }
      u.maxDepthAt[i] = u.maxDepth; u.maxDistAt[i] = u.maxDist;
      if (opts.onAdd) opts.onAdd(i, par, mm);
    },
  });
  m.preset = pr;
  pr.seeds(m);
  m.seedCount = m.count;
  return m;
}

// The colour value of particle i for a mode, before colourT. flow needs the
// subtree sizes (sub). Seeds of the ring and line presets sit at the frame
// edge, so distance there is from the frame centre, not the origin.
export function valueOf(mode, m, i, sub) {
  switch (mode) {
    case 'depth': return m.depth[i];
    case 'distance': {
      const P = m.pos;
      if (m.preset && m.preset.id === 'ring') return m.user.ringR - Math.hypot(P[i * 3], P[i * 3 + 1]);
      if (m.preset && m.preset.id === 'line') return P[i * 3 + 1];
      return Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    }
    case 'flow': return Math.log(sub ? sub[i] : 1);
    default: return i;
  }
}

// The value at the hot end, for the first k particles.
export function maxOf(mode, m, k = m.count) {
  const i = Math.max(0, k - 1);
  switch (mode) {
    case 'depth': return Math.max(1, m.user.maxDepthAt[i]);
    case 'distance':
      if (m.preset && m.preset.id === 'ring') return Math.max(1, m.user.ringR);
      if (m.preset && m.preset.id === 'line') return Math.max(1, m.user.ext[3]);
      return Math.max(1, m.user.maxDistAt[i]);
    case 'flow': return Math.max(1e-6, Math.log(Math.max(2, k)));
    default: return Math.max(1, k - 1);
  }
}

// t in 0..1 for the gradient: floor + (1 - floor) * (v / max)^gamma. The
// shader in render.js does the same sum ("float colourT").
export function colourT(mode, v, max) {
  const c = modeInfo(mode);
  const x = Math.min(1, Math.max(0, max > 0 ? v / max : 0));
  return c.floor + (1 - c.floor) * Math.pow(x, c.gamma);
}

// Fill out (Float32Array) with valueOf for ids from..to-1.
export function fillValues(mode, m, out, from = 0, to = m.count, sub = null) {
  if (mode === 'flow' && !sub) sub = m.subtreeSizes();
  for (let i = from; i < to; i++) out[i] = valueOf(mode, m, i, sub);
  return out;
}

// Subtree sizes of the first k particles only (the replay of flow). The
// parent of a particle always has a lower id, so one pass back is enough.
export function subtreePrefix(parent, k, out) {
  const s = out && out.length >= k ? out : new Int32Array(Math.max(1, k));
  s.fill(1, 0, k);
  for (let i = k - 1; i >= 0; i--) if (parent[i] >= 0) s[parent[i]] += s[i];
  return s;
}

// The replay shows the first k particles. Particles join in id order and
// each one has its parent link at index 2i, 2i + 1 of the line index
// buffer, so k particles are k points and 2k line indices.
export function replayRange(frac, count) {
  const k = Math.max(0, Math.min(count, Math.round(frac * count)));
  return { k, points: k, lineIndices: 2 * k };
}
export function replayFrac(k, count) { return count > 0 ? Math.min(1, Math.max(0, k / count)) : 1; }

// The line index pairs: (parent, i), and (i, i) for a seed.
export function lineIndex(parent, from, to, out) {
  for (let i = from; i < to; i++) { const p = parent[i]; out[2 * i] = p >= 0 ? p : i; out[2 * i + 1] = i; }
  return out;
}

// The last n CSV lines of the first `to` particles, as m.toCSV gives them.
export function csvTail(m, n = 12, to = m.count) {
  return m.toCSV(Math.max(0, to - n), to);
}
export const CSV_HEAD = '# columns are: id, parent_id, x, y, z';

// A short real extract of the engine walk: the lines of addParticle from the
// nearest() query to the step. The saver poster and the credit show it.
export function engineExtract(m) {
  const s = String(m.addParticle).split('\n');
  const a = s.findIndex(l => l.includes('nearest(P)'));
  const b = s.findIndex(l => l.includes('P[0] += V[0]'));
  if (a < 0 || b < a) return s.slice(0, 16).join('\n');
  const lines = s.slice(a, b + 1);
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return lines.map(l => l.slice(ind)).join('\n');
}

// Mean position of the non-seed particles (tests and the status line).
export function centroid(m, from = m.seedCount || 0) {
  let x = 0, y = 0, z = 0, n = 0; const P = m.pos;
  for (let i = from; i < m.count; i++) { x += P[i * 3]; y += P[i * 3 + 1]; z += P[i * 3 + 2]; n++; }
  return n ? [x / n, y / n, z / n] : [0, 0, 0];
}
