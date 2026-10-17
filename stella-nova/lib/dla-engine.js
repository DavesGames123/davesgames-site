// ============================================================================
//  DLA ENGINE  ·  diffusion-limited aggregation, 2D or 3D, after fogleman/dlaf
// ----------------------------------------------------------------------------
//  A JavaScript port of the Model class of dlaf by Michael Fogleman
//  (https://github.com/fogleman/dlaf, MIT, notice below). The walk, the
//  join test, the push-back and the five parameters are the same as in
//  dlaf.cpp. Two parts are different:
//    - The spatial index is a sparse uniform grid, not a boost R-tree.
//      nearest() searches the cells next to the walker, then a pyramid of
//      coarse grids. When no particle is near, it gives a lower bound of
//      the distance, and the walker jumps by that bound. A jump that is too short is safe: the
//      walk only takes more steps.
//    - The hooks of dlaf (RandomStartingPosition, ShouldReset, ShouldJoin,
//      PlaceParticle, MotionVector) are functions in an options object,
//      so a page can change them without a subclass. A hook gets the
//      model as its first argument.
//
//  DOM-free ES module. It runs in a page, in a worker (lib/dla-worker.js)
//  and in node tests.
//
//  USE
//    const m = createModel({ dim: 2, seed: 7, params: { stickiness: 0.6 } });
//    m.add([0, 0, 0]);                 // a seed particle (parent -1)
//    m.grow(1000);                     // add 1000 particles
//    m.growFor(8);                     // add particles for about 8 ms
//    m.count, m.pos (Float64Array xyz), m.parent (Int32Array),
//    m.depth (Int32Array, hops to a seed), m.boundingRadius
//
//  grep -n targets
//    licence ............... "Copyright (C) 2019 Michael Fogleman"
//    parameters ............ "const DEFAULTS"
//    random numbers ........ "function rng"
//    grid index ............ "function nearest"
//    the walk .............. "function addParticle"
//    default hooks ......... "const BASE_HOOKS"
//    derived fields ........ "function subtreeSizes"
//    CSV like dlaf ......... "function toCSV"
//
//  ---------------------------------------------------------------------------
//  dlaf: Copyright (C) 2019 Michael Fogleman
//
//  Permission is hereby granted, free of charge, to any person obtaining a
//  copy of this software and associated documentation files (the
//  "Software"), to deal in the Software without restriction, including
//  without limitation the rights to use, copy, modify, merge, publish,
//  distribute, sublicense, and/or sell copies of the Software, and to permit
//  persons to whom the Software is furnished to do so, subject to the
//  following conditions:
//
//  The above copyright notice and this permission notice shall be included
//  in all copies or substantial portions of the Software.
//
//  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
//  OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
//  NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//  DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
//  USE OR OTHER DEALINGS IN THE SOFTWARE.
// ============================================================================

// The defaults of dlaf.cpp. Names are camelCase forms of the dlaf names.
export const DEFAULTS = Object.freeze({
  particleSpacing: 1,      // distance between a joined particle and its parent
  attractionDistance: 3,   // a walker nearer than this to a particle can join
  minMoveDistance: 1,      // the shortest step of the walk
  stubbornness: 0,         // join attempts on a particle before it accepts one
  stickiness: 1,           // probability that a join attempt succeeds
});

export const PARAM_INFO = Object.freeze([
  { key: 'particleSpacing', dlaf: 'ParticleSpacing', min: 0.2, max: 3, step: 0.05,
    text: 'The distance between a particle and the parent it joins.' },
  { key: 'attractionDistance', dlaf: 'AttractionDistance', min: 0.5, max: 12, step: 0.1,
    text: 'How near a walker must come to a particle before it can join.' },
  { key: 'minMoveDistance', dlaf: 'MinMoveDistance', min: 0.1, max: 4, step: 0.05,
    text: 'The shortest step of the random walk.' },
  { key: 'stubbornness', dlaf: 'Stubbornness', min: 0, max: 40, step: 1,
    text: 'How many join attempts a particle refuses before it accepts one.' },
  { key: 'stickiness', dlaf: 'Stickiness', min: 0.01, max: 1, step: 0.01,
    text: 'The probability that a join attempt succeeds.' },
]);

// mulberry32: a small seeded generator, so a seed gives the same structure.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RandomInUnitSphere of dlaf: a uniform point inside the unit ball (disc in 2D).
export function randomInUnitSphere(rand, dim, out = [0, 0, 0]) {
  for (;;) {
    const x = rand() * 2 - 1, y = rand() * 2 - 1, z = dim === 2 ? 0 : rand() * 2 - 1;
    if (x * x + y * y + z * z < 1) { out[0] = x; out[1] = y; out[2] = z; return out; }
  }
}

// The hooks of dlaf.cpp, as written there. A page replaces any of them.
export const BASE_HOOKS = Object.freeze({
  // A point on the bounding sphere.
  randomStartingPosition(m, out) {
    randomInUnitSphere(m.random, m.dim, out);
    const l = Math.hypot(out[0], out[1], out[2]) || 1, d = m.boundingRadius / l;
    out[0] *= d; out[1] *= d; out[2] *= d;
    return out;
  },
  // Too far from the cluster: start again.
  shouldReset(m, p) {
    return Math.hypot(p[0], p[1], p[2]) > m.boundingRadius * 2;
  },
  // Stubbornness first, then stickiness.
  shouldJoin(m, p, parent) {
    m.joinAttempts[parent]++;
    if (m.joinAttempts[parent] < m.params.stubbornness) return false;
    return m.random() <= m.params.stickiness;
  },
  // particleSpacing away from the parent, on the line to the walker.
  placeParticle(m, p, parent, out) {
    return m.lerpFrom(parent, p, m.params.particleSpacing, out);
  },
  // A random direction. The engine normalises it and sets the length.
  motionVector(m, p, out) {
    return randomInUnitSphere(m.random, m.dim, out);
  },
});

const OFF = 1 << 15; // grid coordinates are offset so that keys stay positive

export function createModel(opts = {}) {
  const dim = opts.dim === 3 ? 3 : 2;
  const params = Object.assign({}, DEFAULTS, opts.params || {});
  const hooks = Object.assign({}, BASE_HOOKS, opts.hooks || {});
  const random = opts.random || rng(opts.seed ?? 1);
  const maxSteps = opts.maxSteps ?? 200000;   // a walk this long starts again

  let cap = 1024, count = 0;
  let pos = new Float64Array(cap * 3);
  let parent = new Int32Array(cap);
  let depth = new Int32Array(cap);
  let joinAttempts = new Int32Array(cap);
  let cell = 0;                    // grid cell size, set in setParams()
  let grid = new Map();            // cell key -> array of particle ids
  const LEVELS = 12;               // coarse grids, cell * 2^1 .. 2^12
  let levels = [];                 // per level: Set of occupied cell keys

  const m = {
    dim, params, hooks, random,
    get count() { return count; },
    get pos() { return pos; },
    get parent() { return parent; },
    get depth() { return depth; },
    get joinAttempts() { return joinAttempts; },
    boundingRadius: 0,
    walks: 0,          // walk steps since the model was made
    resets: 0,         // walks that started again
    user: opts.user || {},   // free space for hooks (a page keeps state here)
    add, grow, growFor, addParticle, nearest, setParams, lerpFrom, point,
    subtreeSizes, toCSV, reset,
  };

  function key(ix, iy, iz) { return ((ix + OFF) * 65536 + (iy + OFF)) * 65536 + (iz + OFF); }

  function rebuildGrid() {
    grid = new Map(); levels = Array.from({ length: LEVELS }, () => new Set());
    for (let i = 0; i < count; i++) insert(i);
  }

  function insert(i) {
    const k = key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), dim === 3 ? Math.floor(pos[i * 3 + 2] / cell) : 0);
    const a = grid.get(k);
    if (a) a.push(i); else grid.set(k, [i]);
    for (let l = 0, c = cell * 2; l < LEVELS; l++, c *= 2) {
      levels[l].add(key(Math.floor(pos[i * 3] / c), Math.floor(pos[i * 3 + 1] / c), dim === 3 ? Math.floor(pos[i * 3 + 2] / c) : 0));
    }
  }

  function setParams(p) {
    Object.assign(params, p);
    const c = 2 * Math.max(params.attractionDistance, params.particleSpacing, 0.25);
    if (c !== cell) { cell = c; rebuildGrid(); }
  }

  function grow1() {
    cap *= 2;
    const np = new Float64Array(cap * 3); np.set(pos); pos = np;
    const pa = new Int32Array(cap); pa.set(parent); parent = pa;
    const de = new Int32Array(cap); de.set(depth); depth = de;
    const ja = new Int32Array(cap); ja.set(joinAttempts); joinAttempts = ja;
  }

  // Add of dlaf: a particle at p, joined to parent (-1 for a seed).
  function add(p, par = -1) {
    if (count === cap) grow1();
    const i = count++;
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = dim === 3 ? (p[2] || 0) : 0;
    parent[i] = par;
    depth[i] = par < 0 ? 0 : depth[par] + 1;
    joinAttempts[i] = 0;
    insert(i);
    m.boundingRadius = Math.max(m.boundingRadius, Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) + params.attractionDistance);
    if (opts.onAdd) opts.onAdd(i, par, m);
    return i;
  }

  function point(i, out = [0, 0, 0]) { out[0] = pos[i * 3]; out[1] = pos[i * 3 + 1]; out[2] = pos[i * 3 + 2]; return out; }

  // Lerp of dlaf: from particle a toward point b, at distance d.
  function lerpFrom(a, b, d, out = [0, 0, 0]) {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    let dx = b[0] - ax, dy = b[1] - ay, dz = b[2] - az;
    const l = Math.hypot(dx, dy, dz) || 1;
    out[0] = ax + dx / l * d; out[1] = ay + dy / l * d; out[2] = az + dz / l * d;
    return out;
  }

  // nearest(p) -> { id, d }. The cell is 2 x attractionDistance or more, so a
  // particle that can join is in the 3^D block of cells around p. In the
  // block, d is exact up to one cell. Past it, d is a lower bound from the
  // first empty block of the coarse levels (cell * 2^k), or from the
  // bounding sphere. id is -1 when the block is empty.
  const near = { id: -1, d: 0 };
  function nearest(p) {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = dim === 3 ? Math.floor(p[2] / cell) : 0;
    const zr = dim === 3 ? 1 : 0;
    let best = -1, bd2 = Infinity;
    for (let dz = -zr; dz <= zr; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!a) continue;
      for (let j = 0; j < a.length; j++) {
        const i = a[j], ex = pos[i * 3] - p[0], ey = pos[i * 3 + 1] - p[1], ez = pos[i * 3 + 2] - p[2];
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < bd2) { bd2 = d2; best = i; }
      }
    }
    if (best >= 0) { near.id = best; near.d = Math.min(Math.sqrt(bd2), cell); return near; }
    let lb = cell;
    for (let k = 0; k < LEVELS; k++) {
      const c = cell * Math.pow(2, k + 1), lv = levels[k];
      const qx = Math.floor(p[0] / c), qy = Math.floor(p[1] / c), qz = dim === 3 ? Math.floor(p[2] / c) : 0;
      let hit = false;
      for (let dz = -zr; dz <= zr && !hit; dz++) for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (lv.has(key(qx + dx, qy + dy, qz + dz))) { hit = true; break; }
      }
      if (hit) break;
      lb = c;
    }
    const outer = Math.hypot(p[0], p[1], p[2]) - (m.boundingRadius - params.attractionDistance);
    near.id = -1; near.d = Math.max(lb, outer);
    return near;
  }

  const P = [0, 0, 0], V = [0, 0, 0], Q = [0, 0, 0];

  // AddParticle of dlaf: one walker from start to join. Returns the new id,
  // or -1 when the model has no particles. opts.trace(p) sees each step.
  function addParticle(trace) {
    if (count === 0) return -1;
    hooks.randomStartingPosition(m, P);
    let steps = 0;
    for (;;) {
      const n = nearest(P);
      const par = n.id, d = n.d;
      if (par >= 0 && d < params.attractionDistance) {
        if (!hooks.shouldJoin(m, P, par)) {
          // push the walker away a bit
          lerpFrom(par, P, params.attractionDistance + params.minMoveDistance, P);
          if (trace) trace(P, 1);
          continue;
        }
        hooks.placeParticle(m, P, par, Q);
        return add(Q, par);
      }
      const step = Math.max(params.minMoveDistance, d - params.attractionDistance);
      hooks.motionVector(m, P, V);
      const l = Math.hypot(V[0], V[1], V[2]) || 1;
      P[0] += V[0] / l * step; P[1] += V[1] / l * step; if (dim === 3) P[2] += V[2] / l * step;
      m.walks++;
      if (trace) trace(P, 0);
      if (hooks.shouldReset(m, P) || ++steps > maxSteps) {
        m.resets++; steps = 0;
        hooks.randomStartingPosition(m, P);
        if (trace) trace(P, 2);
      }
    }
  }

  function grow(n) { let last = -1; for (let i = 0; i < n; i++) last = addParticle(); return last; }

  // Add particles for about ms milliseconds (at least one). Returns how many.
  function growFor(ms, limit = Infinity) {
    const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    const t0 = now(); let k = 0;
    do { if (addParticle() < 0) break; k++; } while (k < limit && now() - t0 < ms);
    return k;
  }

  // Number of particles in the subtree of each particle (itself included).
  // Pages use it for branch thickness and the "flow" colour.
  function subtreeSizes(out) {
    const s = out && out.length >= count ? out : new Int32Array(count);
    s.fill(1, 0, count);
    for (let i = count - 1; i >= 0; i--) if (parent[i] >= 0) s[parent[i]] += s[i];
    return s;
  }

  // The output format of dlaf: id, parent_id, x, y, z per line.
  function toCSV(from = 0, to = count) {
    const r = (v) => +v.toFixed(6);
    let s = '';
    for (let i = from; i < Math.min(to, count); i++) s += `${i},${parent[i]},${r(pos[i * 3])},${r(pos[i * 3 + 1])},${r(pos[i * 3 + 2])}\n`;
    return s;
  }

  function reset() {
    count = 0; rebuildGrid(); m.boundingRadius = 0; m.walks = 0; m.resets = 0;
  }

  setParams({});
  return m;
}
