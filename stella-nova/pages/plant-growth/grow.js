// ============================================================================
//  PLANT GROWTH  ·  space colonisation model (DOM-free)
// ----------------------------------------------------------------------------
//  Our own code after the idea of Runions, Lane and Prusinkiewicz, "Modeling
//  Trees with a Space Colonization Algorithm", Eurographics Workshop on
//  Natural Phenomena 2007. Attractor points fill a crown envelope. In each
//  step, each live attractor pulls the nearest node that is in the
//  influence radius di. Each pulled node adds a child at distance D, in the
//  mean direction to its attractors plus the tropism terms. An attractor
//  dies when a node comes nearer than the kill distance dk. Branch radii
//  come from the pipe model: r_parent^p = sum of r_child^p.
//
//  The module has no DOM and no THREE. main.js, render.js, saver.js,
//  diagram.js and tests.mjs import it. A flat plant (opts.flat) keeps z = 0
//  for the 2D diagram of the explainer.
//
//  USE
//    const p = createPlant({ species: 'oak', seed: 7 });
//    while (!p.done) p.step();          // one step = one ring of new nodes
//    p.count, p.pos, p.parent, p.radius, p.born, p.order, p.tips, p.light
//    p.leafCount, p.leaves (LEAF_STRIDE floats per leaf)
//    plantSegments(p, 'height')         // segments for a render with no GPU
//    growFull('conifer', { seed: 3 })   // a finished plant
//
//  grep -n targets
//    species presets ....... "export const SPECIES"
//    crown envelopes ....... "export function insideEnvelope"
//    the model ............. "export function createPlant"
//    colonisation step ..... "function step()"
//    tropism terms ......... "function tropism"
//    pipe model ............ "function pipe()"
//    light estimate ........ "function lightPass"
//    flowers ............... "function bloom"
//    segments for a thumb .. "export function plantSegments"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';

// Floats per leaf in plant.leaves: node, born, angle, size, tilt, kind
// (0 leaf, 1 flower), rnd, droop.
export const LEAF_STRIDE = 8;

// Units are metres. env: the crown envelope. D: segment length. di:
// influence radius. dk: kill distance. n: attractor count. trop: up
// (phototropism), apical (extra up on the main axis), flat (lateral
// branches spread level), droop (gravity on lateral branches). bases:
// stems that start at the root node. leaf: atlas cell, size, leaves per
// node, chance, lowest leafy height, the radius where leaves fall.
// flower: atlas cell, chance per tip, size, when they open (progress).
// hang: pendulous shoots (willow) that start from lateral nodes in the
// outer part of the crown and grow down with no attractor.
export const SPECIES = {
  oak: {
    label: 'Broad oak', kind: 'Quercus-like broadleaf',
    env: { type: 'ellipsoid', cy: 6.2, rx: 4.8, ry: 3.5, ymin: 2.6 },
    n: 3200, D: 0.32, di: 2.4, dk: 0.62, pipe: 2.5, r0: 0.028,
    trop: { up: 0.06, apical: 0, flat: 0.1, droop: 0.02 },
    bases: [[0, 1, 0]],
    leaf: { cell: 0, size: 0.36, per: 2, chance: 0.85, minY: 2.4, shedR: 0.1 },
    flower: null,
    col: { bark: '#55412f', twig: '#7d6a48', leaf: '#4a7a2a', young: '#b5cf62', flower: '#ffffff' },
  },
  conifer: {
    label: 'Conifer', kind: 'spruce-like cone, strong apical dominance',
    env: { type: 'cone', y0: 1.4, y1: 11.5, r0: 3.1 },
    n: 2600, D: 0.3, di: 1.7, dk: 0.46, pipe: 2.5, r0: 0.02,
    trop: { up: 0.08, apical: 0.9, flat: 0.75, droop: 0.06 },
    bases: [[0, 1, 0]],
    leaf: { cell: 1, size: 0.3, per: 2, chance: 0.95, minY: 1.0, shedR: 0.075 },
    flower: null,
    col: { bark: '#4a3326', twig: '#6a5038', leaf: '#2e5a3c', young: '#86b870', flower: '#ffffff' },
  },
  willow: {
    label: 'Weeping willow', kind: 'drooping shoots in a hollow dome',
    env: { type: 'shell', cy: 5.4, rx: 5.4, ry: 4.4, inner: 0.55, ymin: 0.9 },
    n: 3000, D: 0.3, di: 2.2, dk: 0.55, pipe: 2.4, r0: 0.018,
    trop: { up: 0.03, apical: 0.3, flat: 0, droop: 0.3 },
    hang: { chance: 0.07, len: 13, outer: 0.5 },
    bases: [[0, 1, 0]],
    leaf: { cell: 2, size: 0.32, per: 2, chance: 0.9, minY: 1.0, shedR: 0.085, droop: 0.85 },
    flower: null,
    col: { bark: '#5b4b38', twig: '#9a8a4a', leaf: '#7a9c3c', young: '#c8dc72', flower: '#ffffff' },
  },
  sapling: {
    label: 'Cherry sapling', kind: 'young tree with spring blossom',
    env: { type: 'ellipsoid', cy: 2.7, rx: 1.6, ry: 1.25, ymin: 1.5 },
    n: 900, D: 0.17, di: 1.1, dk: 0.3, pipe: 2.5, r0: 0.012,
    trop: { up: 0.12, apical: 0.2, flat: 0, droop: 0 },
    bases: [[0, 1, 0]],
    leaf: { cell: 3, size: 0.2, per: 2, chance: 0.8, minY: 1.2, shedR: 0.05 },
    flower: { cell: 6, chance: 0.45, size: 0.16, at: 0.75 },
    col: { bark: '#6b3d36', twig: '#8a5a48', leaf: '#4f8a34', young: '#c0d870', flower: '#ffdbe6' },
  },
  fern: {
    label: 'Fern tuft', kind: 'arching fronds from one crown',
    env: { type: 'vase', y0: 0.12, y1: 1.7, rb: 0.25, rt: 1.9, inner: 0.45 },
    n: 1300, D: 0.11, di: 0.55, dk: 0.15, pipe: 2.2, r0: 0.007,
    trop: { up: 0.03, apical: 0, flat: 0, droop: 0.3 },
    bases: 'ring9',
    leaf: { cell: 4, size: 0.15, per: 2, chance: 1, minY: 0.06, shedR: 0.04, droop: 0.2 },
    flower: null,
    col: { bark: '#55642a', twig: '#6f8a35', leaf: '#3c7832', young: '#a8d05a', flower: '#ffffff' },
  },
  bush: {
    label: 'Flowering bush', kind: 'azalea-like shrub, late bloom',
    env: { type: 'ellipsoid', cy: 1.25, rx: 1.95, ry: 1.15, ymin: 0.35 },
    n: 1600, D: 0.14, di: 0.8, dk: 0.2, pipe: 2.4, r0: 0.01,
    trop: { up: 0.05, apical: 0, flat: 0, droop: 0.02 },
    bases: 'ring4',
    leaf: { cell: 5, size: 0.15, per: 2, chance: 0.8, minY: 0.2, shedR: 0.045 },
    flower: { cell: 7, chance: 0.6, size: 0.2, at: 0.8 },
    col: { bark: '#5a4636', twig: '#6e5a40', leaf: '#3e6e2e', young: '#9cc45a', flower: '#ff6fa0' },
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);

// The envelope of a species at crown scale s (1 is the preset size).
export function scaleEnvelope(env, s = 1) {
  const e = Object.assign({}, env);
  for (const k of ['cy', 'rx', 'ry', 'ymin', 'y0', 'y1', 'r0', 'rb', 'rt']) if (e[k] !== undefined) e[k] *= s;
  return e;
}

// Is (x, y, z) in the envelope?
export function insideEnvelope(e, x, y, z) {
  const rh = Math.hypot(x, z);
  switch (e.type) {
    case 'ellipsoid': {
      if (e.ymin !== undefined && y < e.ymin) return false;
      const u = rh / e.rx, v = (y - e.cy) / e.ry;
      return u * u + v * v <= 1;
    }
    case 'shell': {
      if (y < e.ymin) return false;
      const u = rh / e.rx, v = (y - e.cy) / e.ry, q = u * u + v * v;
      return q <= 1 && q >= e.inner * e.inner;
    }
    case 'cone': {
      if (y < e.y0 || y > e.y1) return false;
      return rh <= e.r0 * (1 - (y - e.y0) / (e.y1 - e.y0));
    }
    case 'vase': {
      if (y < e.y0 || y > e.y1) return false;
      const f = (y - e.y0) / (e.y1 - e.y0), R = e.rb + (e.rt - e.rb) * Math.sqrt(f);
      return rh <= R && rh >= R * e.inner;
    }
  }
  return false;
}

// Axis-aligned bounds of an envelope: [x0, y0, z0, x1, y1, z1].
export function envelopeBounds(e) {
  switch (e.type) {
    case 'ellipsoid': case 'shell':
      return [-e.rx, Math.max(e.ymin ?? -Infinity, e.cy - e.ry), -e.rx, e.rx, e.cy + e.ry, e.rx];
    case 'cone': return [-e.r0, e.y0, -e.r0, e.r0, e.y1, e.r0];
    case 'vase': return [-e.rt, e.y0, -e.rt, e.rt, e.y1, e.rt];
  }
  return [-1, 0, -1, 1, 1, 1];
}

// The sphere that holds the envelope and the stem: { c: [x, y, z], r }.
export function envelopeSphere(e) {
  const b = envelopeBounds(e), top = b[4];
  const c = [0, top / 2, 0];
  const r = Math.hypot(Math.max(b[3], -b[0]), top / 2);
  return { c, r };
}

function baseDirs(bases, rand) {
  if (Array.isArray(bases)) return bases;
  const n = bases === 'ring9' ? 9 : 4, out = [];
  const lift = bases === 'ring9' ? 0.8 : 1.6;
  const a0 = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + i / n * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const l = Math.hypot(1, lift);
    out.push([Math.cos(a) / l, lift / l, Math.sin(a) / l]);
  }
  return out;
}

// opts: species, seed, crown (scale), D, di, dk, n (attractors), tropism
// (a gain on all tropism terms), maxNodes, flat.
export function createPlant(opts = {}) {
  const spId = SPECIES[opts.species] ? opts.species : 'oak';
  const sp = SPECIES[spId];
  const rand = rng(opts.seed ?? 1);
  const crown = opts.crown ?? 1;
  const env = opts.env || scaleEnvelope(sp.env, crown);
  const D = opts.D ?? sp.D, di = Math.max(opts.di ?? sp.di, D * 1.5), dk = Math.min(opts.dk ?? sp.dk, di * 0.9);
  const flat = !!opts.flat;
  const nA = Math.max(8, Math.round(opts.n ?? sp.n));
  const maxNodes = opts.maxNodes ?? 6000;
  const maxIter = opts.maxIter ?? 600;
  const pw = sp.pipe, r0 = (opts.r0 ?? sp.r0) * Math.sqrt(D / sp.D);
  const leafSpec = sp.leaf, flowerSpec = sp.flower;
  const P = { tropism: opts.tropism ?? 1 };

  // attractors: rejection samples in the envelope bounds
  const A = new Float32Array(nA * 3), alive = new Uint8Array(nA);
  const B = envelopeBounds(env);
  {
    let k = 0, tries = 0;
    while (k < nA && tries < nA * 400) {
      tries++;
      const x = B[0] + (B[3] - B[0]) * rand(), y = B[1] + (B[4] - B[1]) * rand();
      const z = flat ? 0 : B[2] + (B[5] - B[2]) * rand();
      if (!insideEnvelope(env, x, y, z)) continue;
      A[k * 3] = x; A[k * 3 + 1] = y; A[k * 3 + 2] = z; alive[k] = 1; k++;
    }
  }
  let nAlive = 0; for (let i = 0; i < nA; i++) nAlive += alive[i];
  const nStart = nAlive;

  // nodes
  let cap = 256, count = 0;
  let pos = new Float32Array(cap * 3), dir = new Float32Array(cap * 3);
  let parent = new Int32Array(cap), order = new Uint8Array(cap), kids = new Uint8Array(cap);
  let born = new Float32Array(cap), radius = new Float32Array(cap), tips = new Float32Array(cap);
  let light = new Float32Array(cap), acc = new Float32Array(cap * 3), cnt = new Int32Array(cap);
  let pacc = new Float64Array(cap);
  let leafCap = 512, leafCount = 0, leaves = new Float32Array(leafCap * LEAF_STRIDE);

  function growCap() {
    cap *= 2;
    const f3 = a => { const b = new Float32Array(cap * 3); b.set(a); return b; };
    const f1 = (a, T) => { const b = new T(cap); b.set(a); return b; };
    pos = f3(pos); dir = f3(dir); acc = f3(acc);
    parent = f1(parent, Int32Array); order = f1(order, Uint8Array); kids = f1(kids, Uint8Array);
    born = f1(born, Float32Array); radius = f1(radius, Float32Array); tips = f1(tips, Float32Array);
    light = f1(light, Float32Array); cnt = f1(cnt, Int32Array); pacc = f1(pacc, Float64Array);
  }

  // A uniform grid of node ids, cell = di, so a query of the 27 cells
  // around a point finds every node within di.
  const cell = di, grid = new Map();
  const key = (ix, iy, iz) => ((ix + 1024) * 2048 + (iy + 1024)) * 2048 + (iz + 1024);
  const gk = (x, y, z) => key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell));
  function gridAdd(i) {
    const k = gk(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]);
  }
  // attractor grid, the same cell
  const agrid = new Map();
  for (let a = 0; a < nA; a++) if (alive[a]) {
    const k = gk(A[a * 3], A[a * 3 + 1], A[a * 3 + 2]);
    const l = agrid.get(k); if (l) l.push(a); else agrid.set(k, [a]);
  }

  let nearD = 0;
  function nearestNode(x, y, z, rmax) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bd2 = rmax * rmax;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!l) continue;
      for (let j = 0; j < l.length; j++) {
        const i = l[j], ex = pos[i * 3] - x, ey = pos[i * 3 + 1] - y, ez = pos[i * 3 + 2] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < bd2) { bd2 = d2; best = i; }
      }
    }
    nearD = Math.sqrt(bd2);
    return best;
  }

  function addNode(x, y, z, par, dx, dy, dz, iter) {
    if (count === cap) growCap();
    const i = count++;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    dir[i * 3] = dx; dir[i * 3 + 1] = dy; dir[i * 3 + 2] = dz;
    parent[i] = par; kids[i] = 0; born[i] = iter; cnt[i] = 0;
    acc[i * 3] = acc[i * 3 + 1] = acc[i * 3 + 2] = 0;
    order[i] = par < 0 ? 0 : Math.min(250, order[par] + (kids[par] > 0 ? 1 : 0));
    if (par >= 0) kids[par]++;
    radius[i] = r0; tips[i] = 1; light[i] = 1;
    gridAdd(i);
    if (par >= 0 && leafSpec && !flat && y >= leafSpec.minY * crown) {
      for (let k = 0; k < leafSpec.per; k++) {
        if (rand() >= leafSpec.chance) continue;
        addLeaf(i, iter + 0.4 + rand() * 1.6, rand() * Math.PI * 2, leafSpec.size * (0.75 + 0.5 * rand()), 0.45 + 0.45 * rand(), 0, leafSpec.droop || 0);
      }
    }
    return i;
  }

  function addLeaf(node, b, ang, size, tilt, kind, droop) {
    if (leafCount === leafCap) { leafCap *= 2; const n = new Float32Array(leafCap * LEAF_STRIDE); n.set(leaves); leaves = n; }
    const o = leafCount++ * LEAF_STRIDE;
    leaves[o] = node; leaves[o + 1] = b; leaves[o + 2] = ang; leaves[o + 3] = size;
    leaves[o + 4] = tilt; leaves[o + 5] = kind; leaves[o + 6] = rand(); leaves[o + 7] = droop;
  }

  // The root node, and the base stems (a tuft has several).
  const dirs = baseDirs(sp.bases, rand);
  addNode(0, 0, 0, -1, 0, 1, 0, 0);
  const leaders = [];
  if (dirs.length === 1) leaders.push(0);
  else for (const d of dirs) {
    const dz = flat ? 0 : d[2], l = Math.hypot(d[0], d[1], dz);
    leaders.push(addNode(d[0] * D / l, d[1] * D / l, dz * D / l, 0, d[0] / l, d[1] / l, dz / l, 0));
  }

  const st = { iter: 0, done: false, reached: false, stall: 0, bloomed: false, maxOrder: 0, maxY: 0, maxTips: 1, lightAt: -1 };
  const touched = [];
  const T = [0, 0, 0];
  const hangers = [];     // { v: the hanging tip, left: segments to go }
  let hangFlag = new Uint8Array(0);

  // Tropism: the bias added to the mean pull before it is normalised.
  // up pulls toward the light, apical keeps the main axis upright, flat
  // levels lateral branches (conifer whorls), droop bends them down.
  function tropism(v, d) {
    const g = P.tropism, t = sp.trop, lateral = order[v] > 0;
    d[1] += (t.up + (lateral ? 0 : t.apical)) * g;
    if (lateral) {
      d[1] *= 1 - Math.min(0.95, t.flat * g);
      const reach = Math.min(1, Math.hypot(pos[v * 3], pos[v * 3 + 2]) / Math.max(D, 0.25 * (B[3] - B[0])));
      d[1] -= t.droop * g * reach;
    }
    return d;
  }

  // One colonisation step. Returns the number of new nodes.
  function step() {
    if (st.done) return 0;
    const it = st.iter, n0 = count;
    touched.length = 0;
    // 1. each live attractor pulls the nearest node within di
    for (let a = 0; a < nA; a++) {
      if (!alive[a]) continue;
      const x = A[a * 3], y = A[a * 3 + 1], z = A[a * 3 + 2];
      const v = nearestNode(x, y, z, di);
      if (v < 0) continue;
      if (nearD < dk) { alive[a] = 0; nAlive--; continue; }
      if (cnt[v] === 0) touched.push(v);
      cnt[v]++;
      const k = 1 / (nearD || 1);
      acc[v * 3] += (x - pos[v * 3]) * k; acc[v * 3 + 1] += (y - pos[v * 3 + 1]) * k; acc[v * 3 + 2] += (z - pos[v * 3 + 2]) * k;
    }
    // 2. each pulled node grows one segment toward the mean direction
    for (let j = 0; j < touched.length; j++) {
      const v = touched[j];
      let l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]);
      if (l > 1e-4) { T[0] = acc[v * 3] / l; T[1] = acc[v * 3 + 1] / l; T[2] = acc[v * 3 + 2] / l; }
      else { T[0] = dir[v * 3]; T[1] = dir[v * 3 + 1]; T[2] = dir[v * 3 + 2]; }   // pulls cancel: keep the heading
      acc[v * 3] = acc[v * 3 + 1] = acc[v * 3 + 2] = 0; cnt[v] = 0;
      tropism(v, T);
      if (flat) T[2] = 0;
      l = Math.hypot(T[0], T[1], T[2]) || 1;
      const dx = T[0] / l, dy = T[1] / l, dz = T[2] / l;
      const x = pos[v * 3] + D * dx, y = Math.max(0, pos[v * 3 + 1] + D * dy), z = pos[v * 3 + 2] + D * dz;
      if (kids[v] >= 4 || count >= maxNodes) continue;
      if (nearestNode(x, y, z, 0.4 * D) >= 0) continue;          // no node on top of another
      addNode(x, y, z, v, dx, dy, dz, it);
    }
    if (touched.length) st.reached = true;
    if (sp.hang && !flat) hang(n0);
    // 3. before the crown is in reach, the stems grow straight on
    if (!st.reached) {
      for (let j = 0; j < leaders.length; j++) {
        const v = leaders[j];
        T[0] = dir[v * 3]; T[1] = dir[v * 3 + 1] + (sp.trop.up + sp.trop.apical) * P.tropism * 0.5; T[2] = dir[v * 3 + 2];
        const l = Math.hypot(T[0], T[1], T[2]) || 1;
        const dx = T[0] / l, dy = T[1] / l, dz = flat ? 0 : T[2] / l;
        leaders[j] = addNode(pos[v * 3] + D * dx, pos[v * 3 + 1] + D * dy, pos[v * 3 + 2] + D * dz, v, dx, dy, dz, it);
      }
      if (pos[leaders[0] * 3 + 1] > B[4] + di) st.done = true;   // the crown is out of reach
    }
    // 4. new nodes kill the attractors within dk
    for (let i = n0; i < count; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = agrid.get(key(cx + dx, cy + dy, cz + dz)); if (!l) continue;
        for (let q = 0; q < l.length; q++) {
          const a = l[q]; if (!alive[a]) continue;
          const ex = A[a * 3] - x, ey = A[a * 3 + 1] - y, ez = A[a * 3 + 2] - z;
          if (ex * ex + ey * ey + ez * ez < dk * dk) { alive[a] = 0; nAlive--; }
        }
      }
    }
    const added = count - n0;
    st.iter++;
    if (st.reached && added === 0) st.stall++; else st.stall = 0;
    if (((nAlive === 0 || st.stall >= 3) && !hangers.length) || count >= maxNodes || st.iter >= maxIter) st.done = true;
    pipe();
    if (st.done || st.iter - st.lightAt >= 4) lightPass();
    if (flowerSpec && !st.bloomed && (st.done || 1 - nAlive / nStart >= flowerSpec.at)) bloom();
    return added;
  }

  // Pendulous shoots: new lateral nodes in the outer crown can start a
  // shoot that hangs down, one segment per step, for about h.len segments.
  function hang(n0) {
    const h = sp.hang, n1 = count;
    if (hangFlag.length < cap) { const f = new Uint8Array(cap); f.set(hangFlag); hangFlag = f; }
    for (let i = n0; i < n1; i++) {
      if (order[i] < 1 || hangFlag[i]) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const u = Math.hypot(x, z) / env.rx, v = (y - env.cy) / env.ry;
      if (u * u + v * v < h.outer || rand() >= h.chance) continue;
      hangers.push({ v: i, left: Math.round(h.len * (0.5 + 0.7 * rand())) });
    }
    for (let j = hangers.length - 1; j >= 0; j--) {
      const g = hangers[j], v = g.v;
      const ox = pos[v * 3], oz = pos[v * 3 + 2], ol = Math.hypot(ox, oz) || 1;
      T[0] = dir[v * 3] * 0.3 + ox / ol * 0.08; T[1] = -1; T[2] = dir[v * 3 + 2] * 0.3 + oz / ol * 0.08;
      const l = Math.hypot(T[0], T[1], T[2]);
      const dx = T[0] / l, dy = T[1] / l, dz = T[2] / l;
      const x = ox + D * dx, y = pos[v * 3 + 1] + D * dy, z = oz + D * dz;
      if (g.left <= 0 || y < 0.35 || kids[v] >= 4 || count >= maxNodes || nearestNode(x, y, z, 0.4 * D) >= 0) { hangers.splice(j, 1); continue; }
      const w = addNode(x, y, z, v, dx, dy, dz, st.iter);
      if (hangFlag.length < cap) { const f = new Uint8Array(cap); f.set(hangFlag); hangFlag = f; }
      hangFlag[w] = 1; g.v = w; g.left--;
    }
  }

  // Pipe model: tips get r0, and a parent carries the sum of r^p of its
  // children, so the radius never falls toward the root. tips[i] counts
  // the tips that node i supports (the "flow").
  function pipe() {
    const r0p = Math.pow(r0, pw);
    for (let i = 0; i < count; i++) { pacc[i] = 0; tips[i] = 0; }
    let mo = 0, my = 0;
    for (let i = count - 1; i >= 0; i--) {
      if (kids[i] === 0) { pacc[i] = r0p; tips[i] = 1; }
      radius[i] = Math.pow(pacc[i], 1 / pw);
      const p = parent[i];
      if (p >= 0) { pacc[p] += pacc[i]; tips[p] += tips[i]; }
      if (order[i] > mo) mo = order[i];
      if (pos[i * 3 + 1] > my) my = pos[i * 3 + 1];
    }
    st.maxOrder = mo; st.maxY = my; st.maxTips = count ? tips[0] : 1;
  }

  // Light: a cheap shade estimate. Count the nodes in the 3 x 3 columns
  // of grid cells above each node; light = exp(-shade / mean shade).
  function lightPass() {
    st.lightAt = st.iter;
    if (!count) return;
    const c = Math.max(D * 2, di * 0.5);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = 0;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y > y1) y1 = y;
    }
    const nx = Math.max(1, Math.ceil((x1 - x0) / c) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / c) + 1), ny = Math.max(1, Math.ceil(y1 / c) + 1);
    if (nx * ny * nz > 400000) return;
    const G = new Float32Array(nx * ny * nz);
    const ix = i => Math.min(nx - 1, Math.floor((pos[i * 3] - x0) / c));
    const iy = i => Math.min(ny - 1, Math.max(0, Math.floor(pos[i * 3 + 1] / c)));
    const iz = i => Math.min(nz - 1, Math.floor((pos[i * 3 + 2] - z0) / c));
    for (let i = 0; i < count; i++) G[(ix(i) * ny + iy(i)) * nz + iz(i)] += 1;
    // suffix sums down each column: S(x, y, z) = nodes in cells above y
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      let s = 0;
      for (let y = ny - 1; y >= 0; y--) { const k = (a * ny + y) * nz + b, v = G[k]; G[k] = s; s += v; }
    }
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const a = ix(i), y = iy(i), b = iz(i);
      let s = 0;
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) {
        const aa = a + da, bb = b + db;
        if (aa < 0 || bb < 0 || aa >= nx || bb >= nz) continue;
        s += G[(aa * ny + y) * nz + bb] * (da || db ? 0.5 : 1);
      }
      light[i] = s; sum += s;
    }
    const mean = sum / count || 1;
    for (let i = 0; i < count; i++) light[i] = Math.exp(-light[i] / (mean * 1.4));
  }

  // Flowers open late: one pass over the tips when most attractors are gone.
  function bloom() {
    st.bloomed = true;
    const f = flowerSpec;
    for (let i = 1; i < count; i++) {
      if (kids[i] !== 0 || pos[i * 3 + 1] < (leafSpec ? leafSpec.minY * crown : 0)) continue;
      if (rand() >= f.chance) continue;
      addLeaf(i, st.iter + 1 + rand() * 6, rand() * Math.PI * 2, f.size * (0.8 + 0.4 * rand()), 0.2 + 0.3 * rand(), 1, 0);
    }
  }

  const plant = {
    species: spId, spec: sp, env, D, di, dk, r0, flat, nAttractors: nA, maxNodes,
    attractors: A, params: P,
    get count() { return count; }, get pos() { return pos; }, get dir() { return dir; },
    get parent() { return parent; }, get order() { return order; }, get kids() { return kids; },
    get born() { return born; }, get radius() { return radius; }, get tips() { return tips; },
    get light() { return light; }, get leaves() { return leaves; }, get leafCount() { return leafCount; },
    get iter() { return st.iter; }, get done() { return st.done; }, get reached() { return st.reached; },
    get alive() { return alive; }, get aliveCount() { return nAlive; },
    get progress() { return nStart ? 1 - nAlive / nStart : 1; },
    get maxOrder() { return st.maxOrder; }, get maxY() { return st.maxY; }, get maxTips() { return st.maxTips; },
    get tipCount() { let t = 0; for (let i = 0; i < count; i++) if (kids[i] === 0) t++; return t; },
    step, setTropism(g) { P.tropism = g; },
    // The attractors that pull node v now (the explainer diagram uses it).
    pullsOf(v) {
      const out = [];
      for (let a = 0; a < nA; a++) {
        if (!alive[a]) continue;
        const w = nearestNode(A[a * 3], A[a * 3 + 1], A[a * 3 + 2], di);
        if (w === v && nearD >= dk) out.push(a);
      }
      return out;
    },
    estIters() { const b = envelopeBounds(env); return Math.ceil((b[4] + 0.6 * (b[3] - b[0])) / D * 0.9); },
  };
  pipe();
  return plant;
}

// Grow a plant to the end. opts as createPlant.
export function growFull(species, opts = {}) {
  const p = createPlant(Object.assign({ species }, opts));
  let guard = 0;
  while (!p.done && guard++ < 2000) p.step();
  return p;
}

// The segments of a plant, for a render with no GPU (a home thumbnail in
// node). mode is a colour mode of pose.js; t is the value in 0..1 for the
// gradient. Each segment goes from the parent node (a) to the node (b).
// leaves: x, y, z (the node), size, kind (0 leaf, 1 flower), t.
export function plantSegments(p, tOf) {
  const n = p.count, seg = [];
  for (let i = 1; i < n; i++) {
    const q = p.parent[i]; if (q < 0) continue;
    seg.push({
      a: [p.pos[q * 3], p.pos[q * 3 + 1], p.pos[q * 3 + 2]], b: [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]],
      ra: p.radius[q], rb: p.radius[i], order: p.order[i], t: tOf ? tOf(i) : 0,
    });
  }
  const leaves = [];
  for (let k = 0; k < p.leafCount; k++) {
    const o = k * LEAF_STRIDE, i = p.leaves[o];
    leaves.push({ x: p.pos[i * 3], y: p.pos[i * 3 + 1], z: p.pos[i * 3 + 2], size: p.leaves[o + 3], kind: p.leaves[o + 5], t: tOf ? tOf(i) : 0 });
  }
  return { segments: seg, leaves };
}
