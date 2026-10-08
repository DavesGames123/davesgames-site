// ============================================================================
//  VIRUS ATLAS  ·  reps.js — the views of one part and their cross-fades
// ----------------------------------------------------------------------------
//  addReps(THREE, part, ctx) gives a part (view.js makePart) its other
//  views. Each mesh is made the first time its weight is above zero and
//  uses the same textures and the same unit motion (glsl.js unitMove) as
//  the beads, so the build, explode, peel, slice and breathing work in
//  every view.
//    glow   the bead quads again, as soft additive points (GLOW_FS)
//    tube   a Catmull-Rom tube through the beads of each run (TUBE_VS):
//           one instance per segment, rings x sides from budget.tubeMesh
//    blob   ray-cast ellipsoids from blobs.js (BLOB_VS / BLOB_FS)
//    cage   glowing nodes and edges from cage.js (NODE_VS, EDGE_VS)
//  Beads, space and toon are one mesh: the bead quads with a radius
//  factor, a baked burial shade and toon bands (uRadMul, uAO, uToon).
//
//  part.setRepWeights(W)  W = { beads, space, toon, glow, tube, blob,
//      cage }, weights that sum to 1. main.js eases them from one view
//      to the next. No view swaps at once:
//        beads -> blob  beads swell and pull in to their unit while the
//                       ellipsoids grow (a drawing change, not biology)
//        -> tube        the tube grows from the N end of each chain
//        -> cage        beads fall in to their unit centre, then the
//                       edges grow out from their middles
//        -> glow        the spheres shrink as the points brighten
//  part.needBurial()  computes trace.js burial (cached on the data) and
//      uploads it into the aux texture.
//  part.setExplodeAxes(order)  0: the stored 5-fold directions; 5, 3
//      or 2: the nearest axis of that order; -1: radial.
//
//  grep -n targets: "export function addReps", "function makeTube",
//    "function makeBlob", "function makeCage", "function makeGlow",
//    "setRepWeights"
// ============================================================================
import { TUBE_VS, TUBE_FS, BLOB_VS, BLOB_FS, NODE_VS, EDGE_VS, CAGE_FS, BEAD_VS, GLOW_FS } from './glsl.js';
import { burial, setBurial, opsKey } from './trace.js';
import { chainBlobs } from './blobs.js';
import { icosaCage, unitNet } from './cage.js';
import { tubeMesh, strideFor, blobCap, cageCap } from './budget.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function addReps(THREE, part, ctx) {
  const R = {};   // made meshes: glow, tube, blob, cage
  const { scene, coarse } = ctx;
  const own = extra => ({ ...part.base, ...extra });

  part.needBurial = () => {
    const d = part.d, key = opsKey(part.ops);
    if (part.burialDone) return;
    if (!d._bur || d._bur.key !== key) d._bur = { key, v: burial(d, part.ops) };
    setBurial(part.auxData, d._bur.v);
    part.aux.needsUpdate = true;
    part.burialDone = true;
  };

  function makeGlow() {
    const u = own({ uRadMul: { value: 1 }, uRepScale: { value: 1 }, uSprite: { value: coarse ? 2.0 : 2.6 }, uGather: { value: 0 }, uGlow: { value: 0 } });
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BEAD_VS, fragmentShader: GLOW_FS, uniforms: u,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(part.mesh.geometry, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    scene.add(mesh);
    part.extra.push(() => { scene.remove(mesh); mat.dispose(); });
    return { mesh, u };
  }

  function makeTube() {
    const { rings, sides } = tubeMesh(coarse);
    const s = part.tubeStride, nSeg = Math.ceil(part.d.n / s);
    const pos = [], idx = [];
    for (let r = 0; r < rings; r++) for (let a = 0; a < sides; a++) pos.push(r / (rings - 1), a / sides * Math.PI * 2, 0);
    for (let r = 0; r < rings - 1; r++) for (let a = 0; a < sides; a++) {
      const i0 = r * sides + a, i1 = r * sides + (a + 1) % sides, j0 = i0 + sides, j1 = i1 + sides;
      idx.push(i0, j0, i1, i1, j0, j1);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    geo.instanceCount = nSeg * part.m;
    const u = own({ uNSeg: { value: nSeg }, uTS: { value: s }, uTubeR: { value: 0.1 * (1 + 0.35 * (s - 1)) }, uGrow: { value: 1 }, uRepScale: { value: 1 } });
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TUBE_VS, fragmentShader: TUBE_FS, uniforms: u, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    part.extra.push(() => { scene.remove(mesh); geo.dispose(); mat.dispose(); });
    return { mesh, u, segs: nSeg * part.m };
  }

  function makeBlob() {
    const d = part.d;
    if (!d._blobs) d._blobs = chainBlobs(d);
    const B = d._blobs;
    const rows = Math.max(1, Math.ceil(4 * B.n / 2048)), data = new Float32Array(2048 * rows * 4);
    data.set(B.data);
    const tex = new THREE.DataTexture(data, 2048, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const geo = new THREE.InstancedBufferGeometry();
    const P = [];
    for (let i = 0; i < 8; i++) P.push(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.setIndex([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]);
    // a phone keeps whole copies under the cap: later copies are left out
    // only if the blob count is over it (never on the entries of this page)
    const cap = blobCap(coarse);
    geo.instanceCount = Math.min(B.n * part.m, Math.floor(cap / B.n) * B.n || B.n);
    const u = own({ uBlobs: { value: tex }, uNBl: { value: B.n }, uBlobScale: { value: 1 } });
    // back faces: the ray hit still draws when the camera is inside a box
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BLOB_VS, fragmentShader: BLOB_FS, uniforms: u, side: THREE.BackSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    part.extra.push(() => { scene.remove(mesh); geo.dispose(); mat.dispose(); tex.dispose(); });
    return { mesh, u, n: geo.instanceCount };
  }

  function makeCage() {
    const d = part.d, nc = part.nc, R0 = part.radius;
    const keep = d.info.chains.map(c => { const e = d.info.entities[c[2]]; return e.role === 'main' || e.role === 'nucleic'; });
    const perCopy = part.kind === 'none' && part.m > 1;   // virion spikes: one node per spike
    let net = unitNet(part.cent, nc, keep, { perCopy, k: perCopy ? 5 : 4 });
    const cap = cageCap(coarse);
    if (net.nodes.length > cap) net = { nodes: net.nodes.slice(0, cap), edges: net.edges.filter(e => e[0] < cap && e[1] < cap) };
    const nodes = net.nodes.slice(), edges = net.edges.map(e => [e[0], e[1], 0]);
    if (part.kind === 'icosa' && part.axes.length) {
      // the icosahedron, just outside the mean radius of the unit nodes
      let rr = 0; for (const q of net.nodes) rr += Math.hypot(...q.p); rr = rr / Math.max(1, net.nodes.length) * 1.06;
      const ico = icosaCage(part.axes, rr || R0), o = nodes.length;
      ico.nodes.forEach(q => nodes.push(q));
      ico.edges.forEach(e => edges.push([e[0] + o, e[1] + o, 1]));
    }
    const ns = Math.max(0.12, R0 * (coarse ? 0.016 : 0.012)), es = Math.max(0.05, R0 * 0.0035);
    // nodes
    const ng = new THREE.InstancedBufferGeometry();
    // its own quad: disposing a geometry frees its buffers, so no sharing
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    ng.setIndex([0, 1, 2, 0, 2, 3]);
    const aP = new Float32Array(4 * nodes.length), aK = new Float32Array(2 * nodes.length);
    nodes.forEach((q, i) => { aP.set([q.p[0], q.p[1], q.p[2], q.unit], 4 * i); aK.set([q.kind ? ns * (q.kind === 5 ? 2.2 : 1.5) : ns, q.kind], 2 * i); });
    ng.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
    ng.setAttribute('aK', new THREE.InstancedBufferAttribute(aK, 2));
    ng.instanceCount = nodes.length;
    // edges: a quad from end a (x = 0) to end b (x = 1)
    const eg = new THREE.InstancedBufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    eg.setIndex([0, 1, 2, 0, 2, 3]);
    const aA = new Float32Array(4 * edges.length), aB = new Float32Array(4 * edges.length), eK = new Float32Array(2 * edges.length);
    edges.forEach(([i, j, kind], n) => {
      const a = nodes[i], b = nodes[j];
      aA.set([a.p[0], a.p[1], a.p[2], a.unit], 4 * n); aB.set([b.p[0], b.p[1], b.p[2], b.unit], 4 * n); eK.set([kind ? es * 1.6 : es, kind], 2 * n);
    });
    eg.setAttribute('aA', new THREE.InstancedBufferAttribute(aA, 4));
    eg.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
    eg.setAttribute('aK', new THREE.InstancedBufferAttribute(eK, 2));
    eg.instanceCount = edges.length;
    const shared = { uCage: { value: 0 }, uCageGlow: { value: 1 } };
    const mk = (geo, vs, isEdge) => {
      const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: CAGE_FS, uniforms: own({ ...shared, uIsEdge: { value: isEdge ? 1 : 0 } }),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 4;
      scene.add(mesh);
      part.extra.push(() => { scene.remove(mesh); geo.dispose(); mat.dispose(); });
      return mesh;
    };
    const edgeMesh = mk(eg, EDGE_VS, true), nodeMesh = mk(ng, NODE_VS, false);
    return { meshes: [edgeMesh, nodeMesh], u: shared, nodes: nodes.length, edges: edges.length };
  }

  part.setExplodeAxes = order => {
    const u = part.base;
    if (order === -1) { u.uExMode.value = 2; return; }
    const list = order > 0 ? part.axes.filter(a => a.order === order) : [];
    if (!list.length) { u.uExMode.value = order > 0 && part.kind !== 'icosa' ? 2 : 0; return; }
    list.slice(0, 15).forEach((a, i) => u.uAx.value[i].set(a.dir[0], a.dir[1], a.dir[2]));
    u.uNAx.value = Math.min(15, list.length);
    u.uExMode.value = 1;
  };

  part.reps = R;
  part.setRepWeights = W => {
    const w = k => W[k] || 0;
    const bf = w('beads') + w('space') + w('toon');
    const U = part.uniforms;
    if (w('space') + w('toon') > 0 || part.scheme === 'burial') part.needBurial();
    if (bf > 1e-3) {
      U.uRadMul.value = (w('beads') * 1 + w('space') * 2.05 + w('toon') * 1.9) / bf * (1 + 1.1 * w('blob'));
      U.uAO.value = (w('space') + 0.6 * w('toon')) / bf;
      U.uToon.value = w('toon') / bf;
    }
    U.uRepScale.value = bf;
    part.base.uGather.value = Math.min(0.92, 0.9 * w('cage') + 0.45 * w('blob'));
    part.mesh.visible = bf > 2e-3;
    // glow: its own weight, plus a faint ghost under the cage
    const g = w('glow') + 0.22 * w('cage');
    if (g > 2e-3 && !R.glow) R.glow = makeGlow();
    if (R.glow) { R.glow.mesh.visible = g > 2e-3; R.glow.u.uGlow.value = g * (coarse ? 0.8 : 1); R.glow.u.uRepScale.value = 1; R.glow.u.uGather.value = 0.3 * w('blob'); R.glow.u.uRadMul.value = 1; }
    if (w('tube') > 2e-3 && !R.tube) R.tube = makeTube();
    if (R.tube) { R.tube.mesh.visible = w('tube') > 2e-3; R.tube.u.uGrow.value = smooth(0, 0.92, w('tube')); R.tube.u.uRepScale.value = w('tube'); }
    if (w('blob') > 2e-3 && !R.blob) R.blob = makeBlob();
    if (R.blob) { R.blob.mesh.visible = w('blob') > 2e-3; R.blob.u.uBlobScale.value = smooth(0.08, 1, w('blob')); }
    if (w('cage') > 2e-3 && !R.cage) R.cage = makeCage();
    if (R.cage) { const on = w('cage') > 2e-3; R.cage.meshes.forEach(m => { m.visible = on; }); R.cage.u.uCage.value = smooth(0.25, 1, w('cage')); }
  };
  part.counts = () => ({ beads: part.instances, tube: R.tube ? R.tube.segs : 0, blob: R.blob ? R.blob.n : 0, nodes: R.cage ? R.cage.nodes : 0, edges: R.cage ? R.cage.edges : 0 });
  part.strideFor = strideFor;
}
