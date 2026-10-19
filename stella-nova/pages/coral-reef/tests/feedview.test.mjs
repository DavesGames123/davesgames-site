// ============================================================================
//  CORAL REEF  ·  tests/feedview.test.mjs  ·  what a far ROV feed sees (node)
//    node tests/feedview.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "ROV cameras are culled much too
//  aggresssively, theres a ton of black in their images". A ROV 165 m
//  from the main eye, its camera looking away from the eye:
//    stream ..... world/stream.js update(eye, views, rovs): every chunk in
//                 the feed frustum within its far plane has rock. Without
//                 the rovs list some have none (the test sees the bug).
//    render ..... scene.js on the fake WebGL2 (tests/fake-gl.mjs), one live
//                 frame of rov/feed.js: the feed target is cleared to the
//                 haze colour (not black), the dome is on the feed camera
//                 inside its far plane, a mesh out of the main frustum is
//                 drawn for the feed camera (three culls by the camera it
//                 renders), and the fog of war is off in the feed render
//                 and on again in the main render.
// ============================================================================
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
const THREE = await import('three');
const { createStreamer, WORLD_BUDGET, chunkDist, chunkKey } = await import('../world/stream.js');
const { CH } = await import('../world/mesh.js');
const { createScene } = await import('../scene.js');
const { createFeed } = await import('../rov/feed.js');
const { domeHit, DOME_R, HAZE_FLOOR } = await import('../haze.js');

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } };

// the ROV camera of rov/build.js: fov 55, near 0.12, far 60
const ROV = [165, -40, 0];
function rovCam() {
  const c = new THREE.PerspectiveCamera(55, 1.25, 0.12, 60);
  c.position.set(...ROV); c.lookAt(ROV[0] + 30, ROV[1] - 6, ROV[2] + 8); c.updateMatrixWorld(true);
  return c;
}

// ── stream ──────────────────────────────────────────────────────────────────
// a pool stand-in: each rock job is done at once (no mesh), corals none
function stubPool() {
  return { submit(job) { return { promise: Promise.resolve(job.type === 'rock' ? { lod: job.lod, bytes: 1 } : null), cancel() {} }; } };
}
async function settle(st, rovs) {
  for (let k = 0; k < 4; k++) { st.update([0, -40, 0], [[0, -40, 0]], rovs); await new Promise(r => setImmediate(r)); }
}
// the chunks in the feed frustum (xz) within its far plane
function frustumChunks(cam) {
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const keys = new Set(), p = new THREE.Vector3();
  for (let x = ROV[0] - 64; x <= ROV[0] + 64; x += 2) for (let z = ROV[2] - 64; z <= ROV[2] + 64; z += 2) for (let y = ROV[1] - 40; y <= ROV[1] + 10; y += 5) {
    p.set(x, y, z);
    if (p.distanceTo(cam.position) < cam.far && fr.containsPoint(p)) keys.add(chunkKey(Math.floor(x / CH), Math.floor(z / CH)));
  }
  return [...keys];
}
for (const prof of ['desktop', 'phone']) {
  const cam = rovCam(); cam.far = prof === 'desktop' ? 60 : 30; cam.updateProjectionMatrix();
  const want = frustumChunks(cam);
  const B = WORLD_BUDGET[prof];
  const old = createStreamer({ seed: 1, budget: B, pool: stubPool() });
  await settle(old, null);
  const missOld = want.filter(k => !(old.chunk(k) && old.chunk(k).lod >= 0)).length;
  const st = createStreamer({ seed: 1, budget: B, pool: stubPool() });
  await settle(st, [ROV]);
  const miss = want.filter(k => !(st.chunk(k) && st.chunk(k).lod >= 0));
  const lods = want.map(k => st.chunk(k) ? st.chunk(k).lod : -1);
  console.log(`stream ${prof}: ${want.length} chunks in the feed view, ${missOld} with no rock round the eye only, ${miss.length} with the ROV rings; LODs ${[...new Set(lods)].join(',')}; ${st.stats.chunks} chunks (eye only ${old.stats.chunks})`);
  ok(missOld > 0, `stream ${prof}: round the eye only, the feed sees unloaded chunks (the test sees the bug)`, missOld);
  ok(miss.length === 0, `stream ${prof}: every chunk in the ROV feed view has rock`, miss.join(' '));
  // the ROV chunks unload when the ROV goes away
  st.update([0, -40, 0], [[0, -40, 0]], [[0, -40, 0]]); await new Promise(r => setImmediate(r));
  const keep = B.rings[B.rings.length - 1] + 32, far = [...st.chunks.values()].filter(c => chunkDist(c.i, c.j, 0, 0) > keep).length;
  ok(far === 0, `stream ${prof}: the ROV chunks past the eye rings unload when the ROV comes back to the eye`, far);
  // the ROV near the eye: its view stays loaded too
  ok(st.chunk(chunkKey(0, 0)) && st.chunk(chunkKey(0, 0)).lod === 0, `stream ${prof}: the chunk under the eye keeps LOD 0`);
}

// ── render ──────────────────────────────────────────────────────────────────
{
  const f = fakeCanvas({ w: 640, h: 400 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096 });
  S.resize(); S.setWorldMode(true);
  S.U.uFogCol.value.set(0.00025, 0.0008, 0.0016);             // 200 m deep (main.js LOOK)
  S.camera.position.set(0, -40, 0); S.camera.lookAt(-30, -45, 0); S.camera.updateMatrixWorld(true);
  const visited = new Set(['0,0']);
  S.setExplored(visited, [0, -40, 0], []);
  ok(S.U.uFowBox.value.w === 1, 'render: the fog of war is on for the main view');
  // a mesh in front of the ROV, behind the main camera
  const seen = [];
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  m.position.set(ROV[0] + 10, ROV[1] - 2, ROV[2] + 3); m.updateMatrixWorld(true);
  m.onBeforeRender = (r, sc, cam) => seen.push({ cam, fow: S.U.uFowBox.value.w });
  S.scene.add(m);
  const cam = rovCam();
  const V = { id: 1, camera: cam };
  const clears = [];
  const R = S.renderer, clr0 = R.clear.bind(R), tmp = new THREE.Color();
  R.clear = (...a) => { R.getClearColor(tmp); clears.push({ t: R.getRenderTarget(), c: tmp.toArray(), a: R.getClearAlpha() }); return clr0(...a); };
  const feed = createFeed(THREE, { renderer: R, scene: S.scene, mode: 'live', size: { w: 240, h: 192, fps: 30 }, drive: 'external', adapt: false, worker: false, document: null, getVehicle: () => V, clearColour: S.hazeColour });
  ok(feed.liveFrame(1 / 30), 'render: one live feed frame');
  const fc = clears.find(c => c.t && c.t.width === 240 && c.t.height === 192);
  const hz = S.hazeColour().toArray();
  ok(!!fc && fc.c.every((v, i) => Math.abs(v - hz[i]) < 1e-9) && fc.c[2] >= HAZE_FLOOR[2] && fc.c[2] > 0, 'render: the feed target is cleared to the haze colour, not black', fc ? fc.c.map(v => v.toExponential(2)).join(',') : 'no clear');
  ok(!!fc && fc.a === 1, 'render: the feed clear is opaque');
  const [cr, cg, cb] = R.getClearColor(tmp).toArray();
  ok(cr === 0 && cg === 0 && cb === 0, 'render: the main clear colour comes back after the feed', [cr, cg, cb].join(','));
  const dome = S.scene.getObjectByName('water-dome');
  const c = dome.position.toArray(), e = cam.position.toArray(), r = DOME_R * dome.scale.x;
  ok(Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]) < 1e-6 && r < cam.far, 'render: the dome is on the feed camera, inside its far plane', `r ${r} far ${cam.far}`);
  let miss = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j <= 12; j++) { const th = i / 24 * 2 * Math.PI, ph = j / 12 * Math.PI; const t = domeHit(e, c, r, [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]); if (!(t > 0 && t < cam.far)) miss++; }
  ok(miss === 0, 'render: every feed ray hits the dome before the feed far plane', miss);
  const fs = seen.filter(s => s.cam === cam);
  ok(fs.length === 1, 'render: the mesh out of the main frustum is drawn for the feed camera (culled by the feed camera)', fs.length);
  ok(fs.length && fs[0].fow === 0, 'render: no fog of war in the feed render', fs.length ? fs[0].fow : '-');
  seen.length = 0;
  S.render(1 / 60, 16);
  ok(!seen.some(s => s.cam === S.camera), 'render: the main camera culls the mesh behind it');
  ok(S.U.uFowBox.value.w === 1, 'render: the fog of war is on again after the main render');
  S.setExplored(null, null, null, false); R.render(S.scene, cam);
  ok(S.U.uFowBox.value.w === 0, 'render: the fog of war off stays off');
  feed.dispose();
}
console.log(`feedview: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
