// ============================================================================
//  CORAL REEF  ·  fauna/index.js  ·  the creatures on the page (three.js)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "let's get a vast assortment of creatures
//  from real biological archives", and later "let's make sure that we have
//  creature features as well as we go deeper into the depths, and have
//  generative species". This module puts the animals of fauna/species.js
//  into the world chunks round the eye, moves them (fauna/sim.js) and draws
//  them with one instanced mesh per species and LOD (fauna/glsl.js).
//
//  API
//    const F = createFauna({ THREE, root, U, world, physics, profile, seed,
//                            base, makeWorker, rovs, onError })
//      root ...... a three Group in the scene (render space: identity)
//      U ......... scene.js shared uniforms (the lamps, the fog, the time)
//      world ..... world/field.js W; physics: world/physics.js P (the solid
//                  with the coral) or null
//      profile ... budget.js profile id; base: the URL of assets/fauna/
//      makeWorker  () => Worker of fauna/worker.js, or null (main thread)
//      rovs ...... () => [{ p: [x, y, z], look: [dx, dy, dz] }] (world m)
//    F.update(dt, camera, eye, origin)   eye: world m; origin: [Ox, Oz]
//    F.addColonies(chunkKey, colonies) / F.removeColonies(chunkKey)
//    F.lookAt(p, dir, maxDist) -> { name, sci, src, family, dist } | null
//    F.setEnabled(on), F.enabled
//    F.setEscort(fn | null)  fn() -> [x, y, z]: bring up to three swimming
//                            groups near that point (the saver shots)
//    F.stats() -> { chunks, pending, agents, drawn, halos, species, tris,
//                   bytes, scans, regions, capacity }
//    F.dispose()
//
//  FRAME. sim.step, then each live animal goes to the bucket of its species:
//  near (< budget.lod0) the full model, far (< lod1) the low model, past
//  that only the glow halo of a glowing animal, past `draw` nothing; a
//  frustum test drops the rest. Buckets grow in powers of 2.
//
//  MEMORY. A chunk that leaves the ring frees its agents; a species bucket
//  with no animal for 20 s frees its geometry, its material and its texture
//  (scans: budget.scanSlots loaded at most). stats().bytes counts the GPU
//  arrays and textures (tests/fauna.test.mjs checks the release).
//
//  grep -n targets: "export function createFauna", "function wantChunks",
//  "function bucketFor", "function loadScan", "function fill", "function lookAt"
// ============================================================================
import { FAUNA_CH, spawnChunk, spawnColony, gridFrom } from './spawn.js';
import { createSim } from './sim.js';
import { genModel, scanAnim } from './models.js';
import { faunaBudget } from './budget.js';
import { ANIM, SPECIES_BY_ID, regionOfDepth } from './species.js';
import { FAUNA_VS, FAUNA_FS, GEL_FS, HALO_VS, HALO_FS } from './glsl.js';
import { hex } from './gen/mesh.js';
import { parseGLB } from '../../../lib/glb-lite.js';

const WATER_KEYS = ['uTime', 'uCaust', 'uR', 'uDown', 'uFogK', 'uFogCol', 'uSunXZ', 'uCaustBox', 'uCaustTex', 'uCaustScale', 'uCur', 'uSpotN', 'uSpotP', 'uSpotD', 'uSpotC', 'uShadow0', 'uShadow1', 'uShadow2', 'uShadow3', 'uShadowM', 'uShadowOn', 'uShadowBias', 'uShadowTexel'];
const SURF = 55;
// tail-beat or pulse rate (cycles/s) and amplitude of each motion kind
const RATE = { 0: [0.25, 1], 1: [1.6, 1], 2: [0.8, 1], 3: [0.45, 1], 4: [0.55, 1], 5: [0.5, 1], 6: [1.2, 1], 7: [0.12, 1], 8: [0.2, 1], 9: [0.3, 1] };

export function createFauna(o) {
  const { THREE, root, U } = o;
  const B = faunaBudget(o.profile);
  const W = o.world, P = o.physics || null, seed = o.seed || 1;
  const base = o.base || new URL('../assets/fauna/', import.meta.url).href;
  const sim = createSim({ sdf: P ? P.sdf : W.sdfAll, sdfScale: (P || W).sdfScale || 0.4, maxAgents: B.maxAgents, simEvery: B.simEvery, seed });
  const chunks = new Map();          // key -> { state: 'pending' | 'live', i, j, depth, region, token }
  const colonyChunks = new Map();    // key -> sim chunk key of its dwellers
  const buckets = new Map();         // species id -> bucket
  const genSpecies = new Map();      // generated species id -> object (one per id)
  let enabled = true, disposed = false, token = 0, escort = null, escortT = 0;
  let manifest = null, manifestP = null;
  const statsN = { drawn: 0, halos: 0, built: 0, freed: 0, scanFails: 0 };

  // ── the spawn worker ──────────────────────────────────────────────────────
  let worker = null, nextId = 1;
  const waiting = new Map();
  if (o.makeWorker) {
    try {
      worker = o.makeWorker();
      worker.onmessage = e => { const m = e.data; const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id); if (m.type === 'spawn') w.ok(m.r); else w.no(new Error(m.message)); };
      worker.onerror = e => { if (o.onError) o.onError('fauna worker: ' + (e.message || e)); worker = null; for (const w of waiting.values()) w.no(new Error('worker failed')); waiting.clear(); };
      worker.postMessage({ type: 'init', seed, fine: W.fine ?? 1 });
    } catch (e) { worker = null; }
  }
  const localQueue = [];
  function requestSpawn(i, j) {
    if (worker) return new Promise((ok, no) => { const id = nextId++; waiting.set(id, { ok, no }); worker.postMessage({ type: 'spawn', id, i, j, budget: B }); });
    return new Promise(ok => localQueue.push({ i, j, ok }));
  }
  function runLocal(msBudget) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    while (localQueue.length) {
      const q = localQueue.shift();
      q.ok(spawnChunk({ W, seed, i: q.i, j: q.j, budget: B }));
      if ((typeof performance !== 'undefined' ? performance : Date).now() - t0 > msBudget) break;
    }
  }

  // ── chunks round the eye ────────────────────────────────────────────────
  function wantChunks(eye) {
    const r = B.ring, i0 = Math.floor((eye[0] - r) / FAUNA_CH), i1 = Math.floor((eye[0] + r) / FAUNA_CH), j0 = Math.floor((eye[2] - r) / FAUNA_CH), j1 = Math.floor((eye[2] + r) / FAUNA_CH);
    const want = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot((i + 0.5) * FAUNA_CH - eye[0], (j + 0.5) * FAUNA_CH - eye[2]);
      if (d < r) want.push([d, i, j]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of want) {
      const key = `${i},${j}`;
      if (chunks.has(key)) continue;
      const c = { state: 'pending', i, j, token: ++token };
      chunks.set(key, c);
      requestSpawn(i, j).then(r => onSpawn(key, c.token, r), err => { chunks.delete(key); if (o.onError) o.onError(String(err)); });
    }
    // unload
    for (const [key, c] of chunks) {
      const d = Math.hypot((c.i + 0.5) * FAUNA_CH - eye[0], (c.j + 0.5) * FAUNA_CH - eye[2]);
      if (d > B.unload) { sim.removeChunk(key); chunks.delete(key); }
    }
  }
  function canonical(sp) {
    if (SPECIES_BY_ID.has(sp.id)) return SPECIES_BY_ID.get(sp.id);
    let s = genSpecies.get(sp.id);
    if (!s) { s = sp; genSpecies.set(sp.id, s); }
    return s;
  }
  function onSpawn(key, tok, r) {
    const c = chunks.get(key);
    if (disposed || !c || c.token !== tok) return;
    c.state = 'live'; c.depth = r.depth; c.region = r.region; c.count = 0;
    const grid = gridFrom(r.grid);
    for (const g of r.groups) { g.sp = canonical(g.sp); c.count += sim.addGroup(g, key, grid); }
  }
  function addColonies(key, colonies) {
    if (!colonies || !colonies.length) return;
    const ck = 'col:' + key;
    sim.removeChunk(ck);
    let n = 0;
    for (const colony of colonies.slice(0, 12)) for (const g of spawnColony({ W, seed, colony, budget: B })) { g.sp = canonical(g.sp); n += sim.addGroup(g, ck, null); }
    colonyChunks.set(key, ck);
    return n;
  }
  function removeColonies(key) { const ck = colonyChunks.get(key); if (ck) { sim.removeChunk(ck); colonyChunks.delete(key); } }

  // ── the species buckets (meshes) ─────────────────────────────────────────
  function sharedUniforms() { const u = {}; for (const k of WATER_KEYS) if (U && U[k]) u[k] = U[k]; if (!u.uTime) u.uTime = { value: 0 }; if (!u.uFogK) u.uFogK = { value: new THREE.Vector3(0.05, 0.03, 0.02) }; return u; }
  function makeMaterial(sp, tex) {
    const gel = !!sp.gel;
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: FAUNA_VS, fragmentShader: gel ? GEL_FS : FAUNA_FS, side: THREE.DoubleSide,
      uniforms: Object.assign(sharedUniforms(), { uMap: { value: tex || null }, uUseMap: { value: tex ? 1 : 0 }, uGlowK: { value: 1 } }),
      transparent: gel, depthWrite: !gel,
    });
    if (gel) m.blending = THREE.NormalBlending;
    return m;
  }
  function geometryFrom(mesh, sp, anim) {
    const g = new THREE.BufferGeometry();
    const n = mesh.vertexCount;
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals || new Float32Array(n * 3), 3));
    if (mesh.uvs) g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
    g.setAttribute('aCol', new THREE.BufferAttribute(mesh.colors && mesh.colors.length === n * 3 ? mesh.colors : new Float32Array(n * 3).fill(1), 3));
    g.setAttribute('aAnim', new THREE.BufferAttribute(anim || mesh.anim, 4));
    g.setAttribute('aGlow', new THREE.BufferAttribute(mesh.glow || new Float32Array(n * 3), 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingSphere();
    return g;
  }
  const geoBytes = g => { let b = 0; for (const k in g.attributes) b += g.attributes[k].array.byteLength; if (g.index) b += g.index.array.byteLength; return b; };
  function makeInstanced(geo, mat, cap, sp) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    m.count = 0; m.frustumCulled = false; m.name = 'fauna:' + sp.id;
    m.castShadow = !!B.shadows && !sp.gel; m.receiveShadow = false;
    return m;
  }
  function bucketFor(sp) {
    let b = buckets.get(sp.id);
    if (b) return b;
    b = { sp, state: 'new', meshes: [null, null], cap: 0, used: 0, idle: 0, bytes: 0, tris: [0, 0], tex: null };
    buckets.set(sp.id, b);
    return b;
  }
  let buildsThisFrame = 0;
  function build(b) {
    if (b.state !== 'new') return;
    const sp = b.sp;
    if (sp.src === 'scan') { b.state = 'loading'; loadScan(b); return; }
    if (buildsThisFrame >= 3) return;
    buildsThisFrame++;
    const M = genModel(sp);
    b.geos = [geometryFrom(M.lod0, sp), geometryFrom(M.lod1, sp)];
    b.tris = [M.tris0, M.tris1];
    finishBucket(b, null);
  }
  function finishBucket(b, tex) {
    b.mat = makeMaterial(b.sp, tex);
    b.tex = tex;
    b.cap = 16;
    b.meshes = b.geos.map(g => makeInstanced(g, b.mat, b.cap, b.sp));
    for (const m of b.meshes) root.add(m);
    b.bytes = geoBytes(b.geos[0]) + geoBytes(b.geos[1]) + (tex && tex.image ? tex.image.width * tex.image.height * 4 * 1.33 : 0);
    b.state = 'ready'; statsN.built++;
  }
  function grow(b, need) {
    if (need <= b.cap) return;
    let cap = b.cap; while (cap < need) cap *= 2;
    for (let l = 0; l < 2; l++) {
      const old = b.meshes[l];
      root.remove(old);
      old.dispose();
      b.geos[l].deleteAttribute('iAnim'); b.geos[l].deleteAttribute('iTint');
      b.meshes[l] = makeInstanced(b.geos[l], b.mat, cap, b.sp);
      root.add(b.meshes[l]);
    }
    b.cap = cap;
  }
  function freeBucket(b) {
    for (const m of b.meshes) if (m) { root.remove(m); m.dispose(); }
    if (b.geos) for (const g of b.geos) g.dispose();
    if (b.mat) b.mat.dispose();
    if (b.tex) b.tex.dispose();
    buckets.delete(b.sp.id); statsN.freed++;
  }

  // ── scans: GLB + JPG from assets/fauna ───────────────────────────────────
  function getManifest() {
    if (!manifestP) manifestP = fetch(base + 'manifest.json').then(r => r.json()).then(m => (manifest = m));
    return manifestP;
  }
  async function loadScan(b) {
    const id = b.sp.model.asset;
    try {
      const mf = await getManifest();
      const rec = mf.models.find(m => m.id === id);
      if (!rec) throw new Error('no manifest entry ' + id);
      const file = l => (l === 0 && B.scanLod === 0 ? `${id}.glb` : `${id}-lod1.glb`);
      const [g0, g1] = await Promise.all([0, 1].map(l => fetch(base + file(l)).then(r => { if (!r.ok) throw new Error(r.status + ' ' + file(l)); return r.arrayBuffer(); })));
      const texFile = rec.files.find(f => f.texture && f.path.endsWith(`-${B.tex}.jpg`));
      let tex = null;
      if (texFile && typeof createImageBitmap === 'function') {
        const blob = await fetch(base + texFile.path).then(r => r.blob());
        const bmp = await createImageBitmap(blob);
        tex = new THREE.Texture(bmp);
        tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
      }
      if (disposed || buckets.get(b.sp.id) !== b) { if (tex) tex.dispose(); return; }
      const meshes = [g0, g1].map(buf => parseGLB(buf).meshes[0]);
      b.geos = meshes.map(m => geometryFrom(m, b.sp, scanAnim(m.positions, b.sp)));
      b.tris = meshes.map(m => m.triangleCount);
      finishBucket(b, tex);
    } catch (e) {
      statsN.scanFails++;
      b.state = 'failed';
      if (o.onError) o.onError('fauna scan ' + id + ': ' + e.message);
    }
  }

  // ── the per-frame fill ────────────────────────────────────────────────────
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
  const lodOf = new Int8Array(sim.capacity);          // per animal: -1 hidden, 0, 1, 2 (halo only)
  let halo = null;
  function makeHalo() {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const n = Math.max(1, B.halos);
    geo.setAttribute('iHalo', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iHaloC', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HALO_VS, fragmentShader: HALO_FS, uniforms: { uTime: (U && U.uTime) || { value: 0 }, uFogK: (U && U.uFogK) || { value: new THREE.Vector3(0.05, 0.03, 0.02) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.name = 'fauna:halos'; mesh.renderOrder = 5;
    root.add(mesh);
    return { geo, mat, mesh, n };
  }
  const glowCol = new Map();
  function glowRGB(sp) { let c = glowCol.get(sp.id); if (!c) { c = hex(sp.glow.colour); glowCol.set(sp.id, c); } return c; }

  function fill(camera, eye, origin, t) {
    statsN.drawn = 0; statsN.halos = 0;
    if (camera) { pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv); }
    const ox = origin ? origin[0] : 0, oz = origin ? origin[1] : 0;
    // pass 1: count per bucket and lod
    const N = sim.capacity, list = sim.species, slotB = new Array(list.length).fill(null);
    for (const b of buckets.values()) { b.n0 = 0; b.n1 = 0; }
    for (let i = 0; i < N; i++) {
      lodOf[i] = -1;
      if (!sim.alive[i]) continue;
      const sl = sim.spec[i];
      // a bucket only for the species with a live animal (no churn for old slots)
      const b = slotB[sl] || (slotB[sl] = bucketFor(list[sl]));
      const dx = sim.px[i] - eye[0], dy = sim.py[i] - eye[1], dz = sim.pz[i] - eye[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > B.draw) continue;
      const r = sim.size[i];
      // the near animals are always drawn: the ROV feed cameras look at them too
      if (camera && d > 12) { sph.center.set(sim.px[i] - ox, sim.py[i], sim.pz[i] - oz); sph.radius = r * 0.8 + 0.2; if (!frustum.intersectsSphere(sph)) continue; }
      b.used = t;
      const lod = d < B.lod0 ? 0 : d < B.lod1 && d < r * 260 ? 1 : 2;
      lodOf[i] = lod;
      if (lod === 0) b.n0++; else if (lod === 1) b.n1++;
    }
    // build the buckets in need, grow them
    buildsThisFrame = 0;
    for (const b of slotB) if (b && (b.n0 || b.n1)) { build(b); if (b.state === 'ready') grow(b, Math.max(b.n0, b.n1)); }
    // a new bucket counts as used now (the idle clock starts at its creation)
    for (const b of slotB) if (b && b.used === undefined) b.used = t;
    for (const b of buckets.values()) { b.k0 = 0; b.k1 = 0; }
    if (!halo && B.halos > 0) halo = makeHalo();
    const HA = halo ? halo.geo.attributes.iHalo.array : null, HC = halo ? halo.geo.attributes.iHaloC.array : null;
    let nh = 0;
    // pass 2: write the instances
    for (let i = 0; i < N; i++) {
      const lod = lodOf[i];
      if (lod < 0) continue;
      const b = slotB[sim.spec[i]], sp = b.sp;
      const x = sim.px[i] - ox, y = sim.py[i], z = sim.pz[i] - oz, s = sim.size[i];
      if (sp.glow && halo && nh < halo.n) {
        const c = glowRGB(sp), k = sp.glow.k * (0.65 + 0.35 * Math.sin(t * (1.3 + sim.phase[i]) + sim.phase[i] * 40)) * (1 + sim.glow[i] * 2.5);
        HA[nh * 4] = x; HA[nh * 4 + 1] = y + s * 0.1; HA[nh * 4 + 2] = z; HA[nh * 4 + 3] = s * (sp.glow.halo || 0.5) * 1.6 + 0.06;
        HC[nh * 4] = c[0]; HC[nh * 4 + 1] = c[1]; HC[nh * 4 + 2] = c[2]; HC[nh * 4 + 3] = k * 0.5;
        nh++;
      }
      if (lod === 2 || b.state !== 'ready') continue;
      const mesh = b.meshes[lod], k = lod === 0 ? b.k0++ : b.k1++;
      const M = mesh.instanceMatrix.array, o16 = k * 16;
      const cy = Math.cos(sim.yaw[i]), sy = Math.sin(sim.yaw[i]), cp = Math.cos(sim.pitch[i]), spch = Math.sin(sim.pitch[i]);
      // R = Ry(yaw) * Rx(pitch), then the scale s, then the translation
      M[o16] = cy * s; M[o16 + 1] = 0; M[o16 + 2] = -sy * s; M[o16 + 3] = 0;
      M[o16 + 4] = sy * spch * s; M[o16 + 5] = cp * s; M[o16 + 6] = cy * spch * s; M[o16 + 7] = 0;
      M[o16 + 8] = sy * cp * s; M[o16 + 9] = -spch * s; M[o16 + 10] = cy * cp * s; M[o16 + 11] = 0;
      M[o16 + 12] = x; M[o16 + 13] = y; M[o16 + 14] = z; M[o16 + 15] = 1;
      const IA = mesh.geometry.attributes.iAnim.array, IT = mesh.geometry.attributes.iTint.array, q = k * 4;
      const [rate, amp] = RATE[sp.anim] || RATE[0];
      const v = Math.hypot(sim.vx[i], sim.vy[i], sim.vz[i]);
      const moving = sp.anim === ANIM.FISH || sp.anim === ANIM.EEL ? Math.min(2.5, 0.6 + v / Math.max(0.05, s) * 0.5) : 1;
      IA[q] = sim.phase[i] * 7.0; IA[q + 1] = rate * moving * (0.9 + 0.2 * sim.phase[i]); IA[q + 2] = amp; IA[q + 3] = sp.anim;
      const tint = 0.92 + 0.16 * sim.phase[i];
      IT[q] = tint; IT[q + 1] = tint; IT[q + 2] = tint; IT[q + 3] = 1 + sim.glow[i] * 3;
      statsN.drawn++;
    }
    for (const b of buckets.values()) {
      if (b.state !== 'ready') continue;
      for (let l = 0; l < 2; l++) {
        const m = b.meshes[l], n = l ? b.k1 : b.k0;
        m.count = n;
        if (n) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.iAnim.needsUpdate = true; m.geometry.attributes.iTint.needsUpdate = true; }
      }
    }
    if (halo) { halo.geo.instanceCount = nh; halo.geo.attributes.iHalo.needsUpdate = true; halo.geo.attributes.iHaloC.needsUpdate = true; statsN.halos = nh; }
    // free idle buckets (20 s) and keep the scan slots
    let scans = 0;
    for (const b of buckets.values()) if (b.sp.src === 'scan' && b.state === 'ready') scans++;
    for (const b of [...buckets.values()]) {
      const idle = t - (b.used || 0);
      if (b.state === 'ready' && (idle > 20 || (b.sp.src === 'scan' && scans > B.scanSlots && idle > 2))) { if (b.sp.src === 'scan') scans--; freeBucket(b); }
      else if ((b.state === 'failed' || b.state === 'new') && idle > 60) buckets.delete(b.sp.id);
    }
  }

  // ── the saver escort: a few animals near a point ──────────────────────────
  // Every 30 s, up to three swimming groups within 45 m of the point take a
  // new home near it (the depth range of each species still holds: the
  // group goal keeps inside it). No spawn, so no hitch on the main thread.
  function tickEscort(dt) {
    if (!escort) return;
    escortT -= dt;
    if (escortT > 0) return;
    escortT = 30;
    const p = escort(); if (!p) return;
    const near = [];
    for (const G of sim.groups.values()) {
      if (G.benthic || G.onCoral || G.habit === 'still') continue;
      const d = Math.hypot(G.centre[0] - p[0], G.centre[2] - p[2]);
      if (d < 45) near.push([d, G]);
    }
    near.sort((x, y) => x[0] - y[0]);
    let k = 0;
    for (const [, G] of near.slice(0, 3)) {
      const a = k++ * 2.1 + clock * 0.1, r = 3 + k * 1.5;
      G.home = [p[0] + Math.cos(a) * r, Math.min(G.home[1], p[1] + 2), p[2] + Math.sin(a) * r];
      G.retarget = 0;
    }
  }

  // ── public ────────────────────────────────────────────────────────────────
  let clock = 0;
  function update(dt, camera, eye, origin) {
    if (disposed || !enabled) return;
    clock += dt;
    wantChunks(eye);
    if (!worker && localQueue.length) runLocal(6);
    const rovs = o.rovs ? o.rovs() : null;
    const cur = U && U.uCur ? [U.uCur.value.x, U.uCur.value.y] : [0, 0];
    sim.step(dt, { t: clock, rovs, current: cur });
    tickEscort(dt);
    fill(camera, eye, origin, clock);
  }

  // the animal on a view ray (the ROV HUD): the nearest within a 9 degree cone
  function lookAt(p, dir, maxDist = 14) {
    let best = null, bd = Infinity;
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1, ux = dir[0] / dl, uy = dir[1] / dl, uz = dir[2] / dl;
    for (let i = 0; i < sim.capacity; i++) {
      if (!sim.alive[i]) continue;
      const dx = sim.px[i] - p[0], dy = sim.py[i] - p[1], dz = sim.pz[i] - p[2], d = Math.hypot(dx, dy, dz);
      if (d > maxDist || d < 0.2) continue;
      const c = (dx * ux + dy * uy + dz * uz) / d, half = Math.atan2(sim.size[i] * 0.6, d);
      if (Math.acos(Math.min(1, c)) > 0.16 + half) continue;
      if (d < bd) { bd = d; best = i; }
    }
    if (best == null) return null;
    const sp = sim.species[sim.spec[best]];
    return { name: sp.name, sci: sp.sci || null, src: sp.src, family: sp.family || null, dist: bd, region: regionOfDepth(SURF - sim.py[best]) };
  }

  function stats() {
    let tris = 0, bytes = 0, ready = 0, scans = 0;
    for (const b of buckets.values()) {
      if (b.state !== 'ready') continue;
      ready++; if (b.sp.src === 'scan') scans++;
      bytes += b.bytes + b.cap * 2 * (64 + 32);
      tris += b.meshes[0].count * b.tris[0] + b.meshes[1].count * b.tris[1];
    }
    if (halo) bytes += halo.n * 32;
    const regions = {};
    for (const c of chunks.values()) if (c.state === 'live') regions[c.region] = (regions[c.region] || 0) + (c.count || 0);
    let pending = 0; for (const c of chunks.values()) if (c.state === 'pending') pending++;
    return { chunks: chunks.size, pending, agents: sim.count, capacity: sim.capacity, drawn: statsN.drawn, halos: statsN.halos, species: ready, scans, tris, bytes, built: statsN.built, freed: statsN.freed, scanFails: statsN.scanFails, regions, sim: Object.assign({}, sim.stats) };
  }

  function setEnabled(on) {
    enabled = !!on; root.visible = enabled;
    if (!enabled) { for (const key of [...chunks.keys()]) sim.removeChunk(key); chunks.clear(); for (const k of [...colonyChunks.keys()]) removeColonies(k); for (const b of [...buckets.values()]) if (b.state === 'ready') freeBucket(b); sim.removeChunk('escort'); }
  }
  function dispose() {
    disposed = true;
    for (const b of [...buckets.values()]) if (b.state === 'ready') freeBucket(b);
    buckets.clear();
    if (halo) { root.remove(halo.mesh); halo.geo.dispose(); halo.mat.dispose(); halo = null; }
    if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } worker = null; }
    waiting.clear(); localQueue.length = 0;
    for (const key of [...chunks.keys()]) sim.removeChunk(key);
    chunks.clear();
  }

  return {
    update, lookAt, stats, setEnabled, dispose, addColonies, removeColonies,
    setEscort(fn) { escort = fn; escortT = 0; if (!fn) sim.removeChunk('escort'); },
    get enabled() { return enabled; }, sim, budget: B, buckets,
  };
}
