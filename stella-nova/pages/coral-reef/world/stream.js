// ============================================================================
//  CORAL REEF  ·  world/stream.js  ·  the chunk streamer (DOM-free)
// ----------------------------------------------------------------------------
//  The world (world/field.js) has no end, so the page keeps only the chunks
//  near the eye. Each frame update(eye) decides which chunk must be there
//  at which LOD, sends the jobs to the pool (world/pool.js) and gives the
//  finished results to a view (the page: scene.js; the tests: a counter).
//  The streamer holds no three.js object.
//
//  LIFECYCLE (CONTRACT-V4.md)
//    rock ... d (eye to the chunk square, xz) < ring[L] -> LOD L wanted.
//             A finer LOD is asked for at once; a coarser one only when d
//             passes ring[L] + HYST. The old mesh stays until the new one
//             is there (view.addRock replaces it in one call). Unload when
//             d > last ring + UNLOAD.
//    coral .. d < coralR -> a coral job. Its result shows only when the
//             chunk has rock, in ONE view.addCoral call (all the colonies
//             of the chunk at once, already grown). It takes a slab of the
//             particle data texture (slab i: slots i x slab .. ). Unload
//             when d > coralR + CORAL_HYST.
//    fine ... the focus colonies (reef.js holdFocus over the colonies of
//             the shown coral chunks, the view points of the cameras) get
//             a fine job; view.addFine shows the fine mesh and hides the
//             coarse part of that colony in the same frame. A colony that
//             leaves the focus: view.removeFine.
//  A result for a chunk that is gone, or for an old request, is dropped.
//
//  BYTES. view.addRock / addCoral / addFine return the bytes they hold
//  (GPU geometry and kept arrays); the streamer adds its own arrays (the
//  particles, the colony lists, the coral hash). stats.bytes is the sum,
//  per part; an unload takes its bytes off. tests/stream.test.mjs flies
//  2 km and back and checks the sum.
//
//    const st = createStreamer({ seed, budget, pool, view, now });
//    st.update(eye, views)   eye [x, y, z]; views: [[x, y, z], ...] for the focus
//    st.colonies()           shown colonies, world frame: { key, chunk, k, id,
//                            base, size, count, center, radius, top, ext }
//    st.coralDist(x, y, z)   metres to the nearest shown coral particle (max REACH)
//    st.chunk(key), st.chunks (Map), st.stats, st.dispose()
//    st.ready(eye)           true when the chunk under the eye has rock
//    st.on(event, fn)        'rock' (key, i, j, lod), 'unload' (key, i, j),
//                            'coral' (key, colonies), 'uncoral' (key)
//
//    worldEstimate(budget) the GPU bytes of the world at most (budget.js tests)
//
//  grep -n targets: "export function createStreamer", "function wantLod", "export function worldEstimate",
//  "function onRock", "function onCoral", "function updateFocus",
//  "function coralDist", "export const WORLD_BUDGET"
// ============================================================================
import { CH } from './mesh.js';
import { holdFocus, SPECIES, PARTICLE_FLOATS } from '../reef.js';
import { CORAL_BUDGET } from './corals.js';

export const HYST = 16, UNLOAD = 32, CORAL_HYST = 24, REACH = 2.5;

// The world budget of each device profile (CONTRACT-V4.md table).
export const WORLD_BUDGET = {
  desktop: { c0: 0.25, rings: [36, 80, 150], coralR: 44, fineTris: 1200000, maxCoral: 16, maxFine: 8, workers: 4, coral: CORAL_BUDGET.desktop },
  'laptop-low': { c0: 0.32, rings: [30, 66, 120], coralR: 36, fineTris: 600000, maxCoral: 12, maxFine: 5, workers: 3, coral: CORAL_BUDGET['laptop-low'] },
  phone: { c0: 0.4, rings: [24, 56], coralR: 28, fineTris: 250000, maxCoral: 8, maxFine: 3, workers: 2, coral: CORAL_BUDGET.phone },
  'phone-min': { c0: 0.5, rings: [16, 44], coralR: 20, fineTris: 120000, maxCoral: 5, maxFine: 2, workers: 1, coral: CORAL_BUDGET['phone-min'] },
};
// The fine field (crag octaves) of a rock LOD cell: 1 at 0.25 m.
export const fineFor = cell => Math.max(0.3, Math.min(1, 0.25 / cell * 1.0));

// The GPU bytes of the world for a budget, at most (the memory model of
// budget.js estimate for the plot does not cover the world). Measured
// (node, 2026-10-18, tests/world.test.mjs and tests/stream.test.mjs):
// a LOD 0 rock chunk at 0.25 m has 55 k to 156 k triangles (mean about
// 80 k), 28 bytes per triangle with its sand; a cell twice as big has a
// quarter of the triangles. A desktop coral chunk has up to 150 k coarse
// triangles, 26 bytes each; a fine colony 60 k to 200 k triangles and up
// to 145 k polyps (32 bytes each). The data textures: 3 RGBA32F texels
// (48 bytes) per slot.
export const BYTES = { rockTri: 28, rockTrisL0At025: 80000, coralTri: 26, polyp: 32, slot: 48, coarseTrisPerParticle: 12.5, polypsPerFineTri: 0.4 };
export function worldEstimate(B) {
  const area = r => Math.PI * (r + 16) * (r + 16) / 1024;          // chunks with a corner within r
  const rings = B.rings, out = { rock: 0, coral: 0, fine: 0, data: 0, chunks: 0 };
  let prev = 0;
  rings.forEach((r, k) => {
    const n = area(r + HYST) - prev, cell = B.c0 * (1 << k);
    out.rock += n * BYTES.rockTrisL0At025 * (0.25 / cell) * (0.25 / cell) * BYTES.rockTri;
    out.chunks += n; prev = area(r + HYST);
  });
  const nc = Math.min(B.maxCoral, area(B.coralR + CORAL_HYST));
  out.coral = nc * B.coral.particles * BYTES.coarseTrisPerParticle * BYTES.coralTri;
  out.fine = B.fineTris * (BYTES.coralTri + BYTES.polypsPerFineTri * BYTES.polyp);
  out.data = B.maxCoral * B.coral.particles * BYTES.slot;
  out.total = out.rock + out.coral + out.fine + out.data;
  return out;
}

export const chunkKey = (i, j) => `${i},${j}`;
export function chunkDist(i, j, x, z) {
  const dx = Math.max(i * CH - x, 0, x - (i + 1) * CH), dz = Math.max(j * CH - z, 0, z - (j + 1) * CH);
  return Math.hypot(dx, dz);
}

export function createStreamer({ seed = 1, budget = WORLD_BUDGET.desktop, pool, view = {}, now = () => Date.now() } = {}) {
  const B = budget, rings = B.rings, last = rings.length - 1, outer = rings[last];
  const chunks = new Map();
  const slabSize = B.coral.particles, slabs = new Array(B.maxCoral).fill(null);
  const bytes = { rock: 0, coral: 0, fine: 0, data: 0 };
  const stats = { rockJobs: 0, coralJobs: 0, fineJobs: 0, rockShown: 0, coralShown: 0, fineShown: 0, dropped: 0, unloads: 0, rockMs: [], coralMs: [], bytes };
  let eye = [0, 0, 0], token = 1;
  const held = new Map(), fine = new Map();       // focus: k -> hold; fine: fkey -> rec
  const call = (f, ...a) => (typeof view[f] === 'function' ? view[f](...a) : 0);
  // events for other packages (FAUNA, SNOW): 'rock' (key, i, j, lod),
  // 'unload' (key, i, j), 'coral' (key, colonies in the world frame),
  // 'uncoral' (key). A listener error does not stop the streamer.
  const ears = {};
  function on(ev, fn) { (ears[ev] || (ears[ev] = [])).push(fn); return () => { ears[ev] = ears[ev].filter(f => f !== fn); }; }
  function emit(ev, ...a) { for (const f of ears[ev] || []) { try { f(...a); } catch (e) { stats.listenerErrors = (stats.listenerErrors || 0) + 1; } } }

  function chunkOf(i, j) {
    const key = chunkKey(i, j);
    let c = chunks.get(key);
    if (!c) { c = { key, i, j, d: Infinity, lod: -1, want: -1, rockJob: null, rockBytes: 0, coral: null, coralJob: null, coralWait: null, coralBytes: 0, dataBytes: 0, slab: -1 }; chunks.set(key, c); }
    return c;
  }
  // The LOD that chunk c wants at distance d (-1: none), with hysteresis.
  function wantLod(c, d) {
    let raw = -1;
    for (let k = 0; k <= last; k++) if (d < rings[k]) { raw = k; break; }
    if (c.lod >= 0) {
      if (raw === -1) return d < outer + UNLOAD ? c.lod : -1;
      if (c.lod < raw && d < rings[c.lod] + HYST) return c.lod;     // keep the finer mesh a little longer
    }
    return raw;
  }

  function update(e, views = null) {
    eye = e;
    const x = e[0], z = e[2];
    const R = outer + UNLOAD + CH;
    const i0 = Math.floor((x - R) / CH), i1 = Math.floor((x + R) / CH), j0 = Math.floor((z - R) / CH), j1 = Math.floor((z + R) / CH);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = chunkDist(i, j, x, z);
      if (d > outer && !chunks.has(chunkKey(i, j))) continue;
      const c = chunkOf(i, j);
      c.d = d;
    }
    for (const c of [...chunks.values()]) {
      c.d = chunkDist(c.i, c.j, x, z);
      const w = wantLod(c, c.d);
      if (w < 0) { unload(c); continue; }
      c.want = w;
      if (c.lod !== w && (!c.rockJob || c.rockJob.lod !== w)) requestRock(c, w);
      // corals
      if (c.d < B.coralR && !c.coral && !c.coralJob && !c.coralWait) requestCoral(c);
      else if (c.d > B.coralR + CORAL_HYST && (c.coral || c.coralJob || c.coralWait)) unloadCoral(c);
      if (c.coralWait && c.lod >= 0) onCoral(c, c.coralWait.token, c.coralWait.r);
    }
    if (views) updateFocus(views);
  }

  // ── rock ───────────────────────────────────────────────────────────────────
  function requestRock(c, lod) {
    if (c.rockJob) c.rockJob.h.cancel();
    const t = token++;
    const cell = B.c0 * (1 << lod);
    const job = { type: 'rock', seed, ci: c.i, cj: c.j, lod, c0: B.c0, fine: fineFor(cell) };
    // missing rock first, then by distance
    const h = pool.submit(job, () => c.d + (c.lod >= 0 ? 60 : 0) + lod * 4);
    c.rockJob = { h, lod, token: t, at: now() };
    stats.rockJobs++;
    h.promise.then(r => onRock(c, t, r), err => { if (c.rockJob && c.rockJob.token === t) c.rockJob = null; stats.errors = (stats.errors || 0) + 1; stats.lastError = String(err); });
  }
  function onRock(c, t, r) {
    if (!c.rockJob || c.rockJob.token !== t || chunks.get(c.key) !== c) { stats.dropped++; return; }
    c.rockJob = null;
    if (!r) return;
    const ms = r.ms || 0;                     // the job time in the worker
    bytes.rock -= c.rockBytes;
    c.rockBytes = call('addRock', c.key, [(c.i + 0.5) * CH, (c.j + 0.5) * CH], r, r.lod) || r.bytes || 0;
    bytes.rock += c.rockBytes;
    c.lod = r.lod;
    stats.rockShown++;
    emit('rock', c.key, c.i, c.j, r.lod);
    stats.rockMs.push(ms); if (stats.rockMs.length > 64) stats.rockMs.shift();
    if (c.coralWait) onCoral(c, c.coralWait.token, c.coralWait.r);
  }

  // ── coral ──────────────────────────────────────────────────────────────────
  function requestCoral(c) {
    const t = token++;
    // the corals grow on the field of the LOD 0 rock (the same crag detail)
    const job = { type: 'coral', seed, ci: c.i, cj: c.j, budget: B.coral, fine: fineFor(B.c0) };
    const h = pool.submit(job, () => c.d + 20);
    c.coralJob = { h, token: t, at: now() };
    stats.coralJobs++;
    h.promise.then(r => onCoral(c, t, r), err => { if (c.coralJob && c.coralJob.token === t) c.coralJob = null; stats.errors = (stats.errors || 0) + 1; stats.lastError = String(err); });
  }
  function freeSlab(c) {
    if (c.slab < 0) return;
    // a far coral chunk with a slab gives it up (the nearer chunk wins)
    slabs[c.slab] = null; c.slab = -1;
  }
  function takeSlab(c) {
    let s = slabs.indexOf(null);
    if (s < 0) {
      let far = null;
      for (const o of chunks.values()) if (o.slab >= 0 && o.d > c.d && (!far || o.d > far.d)) far = o;
      if (!far) return -1;
      unloadCoral(far);
      s = slabs.indexOf(null);
    }
    slabs[s] = c.key; c.slab = s;
    return s;
  }
  function onCoral(c, t, r) {
    const jobT = c.coralJob ? c.coralJob.token : c.coralWait ? c.coralWait.token : -1;
    if (jobT !== t || chunks.get(c.key) !== c) { stats.dropped++; return; }
    if (c.coralJob && r && r.stats) { stats.coralMs.push(r.stats.growMs + r.stats.meshMs); if (stats.coralMs.length > 64) stats.coralMs.shift(); }
    c.coralJob = null;
    if (!r) { c.coralWait = null; return; }
    // hold the corals until the chunk has rock: no coral floats in the water
    if (c.lod < 0) { c.coralWait = { token: t, r }; return; }
    c.coralWait = null;
    if (c.d > B.coralR + CORAL_HYST) return;
    const s = takeSlab(c);
    if (s < 0) { stats.dropped++; return; }
    c.coral = Object.assign({ base: s * slabSize, slab: s }, r);
    c.coral.hash = buildHash(c.coral);
    c.dataBytes = r.particles.byteLength + r.bridges.byteLength + c.coral.hash.bytes + r.colonies.length * 200;
    bytes.data += c.dataBytes;
    c.coralBytes = call('addCoral', c.key, c.coral) || 0;
    bytes.coral += c.coralBytes;
    stats.coralShown++;
    emit('coral', c.key, coloniesOf(c));
  }
  function unloadCoral(c) {
    if (c.coralJob) { c.coralJob.h.cancel(); c.coralJob = null; }
    c.coralWait = null;
    for (const [fk, f] of [...fine]) if (f.chunk === c.key) dropFine(fk);
    if (c.coral) { call('removeCoral', c.key); c.coral = null; emit('uncoral', c.key); }
    bytes.coral -= c.coralBytes; bytes.data -= c.dataBytes; c.coralBytes = 0; c.dataBytes = 0;
    freeSlab(c);
  }
  function unload(c) {
    if (c.rockJob) { c.rockJob.h.cancel(); c.rockJob = null; }
    unloadCoral(c);
    if (c.lod >= 0) { call('removeRock', c.key); emit('unload', c.key, c.i, c.j); }
    bytes.rock -= c.rockBytes; c.rockBytes = 0;
    chunks.delete(c.key);
    stats.unloads++;
  }

  // ── coral hash: metres to the nearest particle (the ROV and camera field) ──
  // HC m cells; a numeric key of the low 10 bits of each index (a chunk
  // spans far less than 1024 cells, so two cells of one chunk never share it)
  const HC = 1.25;
  const hkey = (a, b, c) => ((a & 1023) << 20) | ((b & 1023) << 10) | (c & 1023);
  function buildHash(co) {
    const P = co.particles, n = P.length / PARTICLE_FLOATS, map = new Map();
    for (let g = 0; g < n; g++) {
      const o = g * PARTICLE_FLOATS, x = P[o] + co.cx, y = P[o + 1] + co.oy, z = P[o + 2] + co.cz;
      const k = hkey(Math.floor(x / HC), Math.floor(y / HC), Math.floor(z / HC));
      let a = map.get(k); if (!a) { a = []; map.set(k, a); }
      a.push(x, y, z);
    }
    const cells = new Map();
    let b = 0;
    for (const [k, a] of map) { const f = Float32Array.from(a); cells.set(k, f); b += f.byteLength + 64; }
    return { cells, bytes: b };
  }
  function coralDist(x, y, z) {
    let best = REACH;
    const ci = Math.floor(x / CH), cj = Math.floor(z / CH);
    const r = Math.ceil(REACH / HC);
    const hx = Math.floor(x / HC), hy = Math.floor(y / HC), hz = Math.floor(z / HC);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const c = chunks.get(chunkKey(ci + di, cj + dj));
      if (!c || !c.coral) continue;
      if (chunkDist(c.i, c.j, x, z) > REACH + 6) continue;
      const cells = c.coral.hash.cells;
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let q = -r; q <= r; q++) {
        const f = cells.get(hkey(hx + a, hy + b, hz + q)); if (!f) continue;
        for (let p = 0; p < f.length; p += 3) { const d = Math.hypot(f[p] - x, f[p + 1] - y, f[p + 2] - z); if (d < best) best = d; }
      }
    }
    return best;
  }

  // ── focus: the fine colonies ───────────────────────────────────────────────
  function colonies() {
    const out = [];
    for (const c of chunks.values()) if (c.coral) out.push(...coloniesOf(c));
    return out;
  }
  // the colonies of one coral chunk in the world frame
  function coloniesOf(c) {
    const out = [];
    {
      const co = c.coral;
      for (const k of co.colonies) {
        const base = [k.base[0] + co.cx, k.base[1] + co.oy, k.base[2] + co.cz];
        const h = Math.max(0.2, (k.top ?? k.base[1]) - k.base[1]), ext = Math.max(0.3, k.ext ?? k.size * 0.4);
        out.push({ key: `${c.key}#${k.k}`, chunk: c.key, k: k.k, id: k.id, base, size: k.size, count: k.count, cap: k.cap,
          center: [base[0], base[1] + h * 0.5, base[2]], radius: Math.hypot(ext, h * 0.5) + 0.05, top: base[1] + h, ext });
      }
    }
    return out;
  }
  let focusAt = -1e9;
  function updateFocus(views) {
    const t = now();
    if (t - focusAt < 400) return;
    focusAt = t;
    const cols = colonies();
    // holdFocus works on k: give each colony a number of its own
    const byN = new Map();
    const list = cols.map((c, n) => { byN.set(n, c); return { k: n, id: c.id, base: c.base, size: c.size, count: c.count, cap: c.cap }; });
    // held is keyed by colony key: translate to and from the numbers
    const heldN = new Map();
    cols.forEach((c, n) => { const h = held.get(c.key); if (h) heldN.set(n, h); });
    const ks = holdFocus(list, views, B.fineTris, heldN, t).slice(0, B.maxFine);
    held.clear();
    for (const n of ks) { const c = byN.get(n); if (c) held.set(c.key, heldN.get(n) || { at: t, dIn: 0 }); }
    const want = new Set(ks.map(n => byN.get(n).key));
    for (const fk of [...fine.keys()]) if (!want.has(fk)) dropFine(fk);
    for (const n of ks) {
      const c = byN.get(n);
      if (!fine.has(c.key)) requestFine(c);
    }
  }
  function requestFine(col) {
    const ch = chunks.get(col.chunk); if (!ch || !ch.coral) return;
    const co = ch.coral, info = co.colonies.find(q => q.k === col.k);
    const t = token++;
    const job = { type: 'fine', colony: info, particles: co.particles.slice(), bridges: co.bridges.slice(), quality: co.quality || B.coral.quality };
    const dist = () => Math.hypot(col.center[0] - eye[0], col.center[1] - eye[1], col.center[2] - eye[2]);
    const h = pool.submit(job, () => dist() * 0.5 + 10);
    const rec = { key: col.key, chunk: col.chunk, k: col.k, token: t, h, shown: false, bytes: 0, at: now() };
    fine.set(col.key, rec);
    stats.fineJobs++;
    h.promise.then(m => onFine(rec, t, m), () => { if (fine.get(rec.key) === rec) fine.delete(rec.key); });
  }
  function onFine(rec, t, m) {
    if (fine.get(rec.key) !== rec || rec.token !== t) { stats.dropped++; return; }
    const ch = chunks.get(rec.chunk);
    if (!m || !ch || !ch.coral) { fine.delete(rec.key); return; }
    // the fine mesh is in the chunk frame, as the coarse mesh
    const origin = [ch.coral.cx, ch.coral.oy, ch.coral.cz];
    rec.bytes = call('addFine', rec.key, rec.chunk, rec.k, m, origin, ch.coral) || 0;
    bytes.fine += rec.bytes; rec.shown = true;
    stats.fineShown++;
  }
  function dropFine(fk) {
    const rec = fine.get(fk); if (!rec) return;
    if (rec.h) rec.h.cancel();
    if (rec.shown) call('removeFine', fk, rec.chunk, rec.k);
    bytes.fine -= rec.bytes;
    fine.delete(fk);
  }

  function dispose() { for (const c of [...chunks.values()]) unload(c); }
  function ready(e = eye) { const c = chunks.get(chunkKey(Math.floor(e[0] / CH), Math.floor(e[2] / CH))); return !!(c && c.lod >= 0); }

  return {
    update, colonies, coralDist, dispose, ready, chunks, fine, held, slabs, slabSize, on,
    chunk: key => chunks.get(key),
    get stats() {
      let rock = 0, coral = 0, pend = 0;
      for (const c of chunks.values()) { if (c.lod >= 0) rock++; if (c.coral) coral++; if (c.rockJob || c.coralJob) pend++; }
      return Object.assign({}, stats, { chunks: chunks.size, rock, coral, fine: [...fine.values()].filter(f => f.shown).length, pending: pend, total: bytes.rock + bytes.coral + bytes.fine + bytes.data, bytes: Object.assign({}, bytes) });
    },
    budget: B,
  };
}
export { SPECIES };
