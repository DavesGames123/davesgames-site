// ============================================================================
//  CORAL REEF  ·  tests/feedfauna.test.mjs  ·  the creatures in a far ROV feed
//    node tests/feedfauna.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "ROV cameras are culled much too
//  aggresssively, theres a ton of black in their images". A ROV 165 m from
//  the main eye, its camera looking away from the eye, a school 3 to 6 m in
//  front of its lens. scene.js on the fake WebGL2 (tests/fake-gl.mjs),
//  fauna/hook.js mountFauna, one live frame of rov/feed.js:
//    spawn ..... the fauna chunk under the ROV gets animals (rovRing)
//    feed ...... the feed render draws the school at the near LOD (lod 0)
//                for the feed camera; without F.prepare the feed shows the
//                list of the main camera (no school: 165 m > draw)
//    main ...... the main render after the feed has the same list as the
//                main fill before it, and no school
//    budgets ... the feed list and the main list keep the profile budgets
// ============================================================================
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
const THREE = await import('three');
const { createScene } = await import('../scene.js');
const { createFeed } = await import('../rov/feed.js');
const { mountFauna } = await import('../fauna/hook.js');
const { createWorld } = await import('../world/field.js');
const { WORLD_BUDGET, rovRing } = await import('../world/stream.js');
const { FAUNA_BUDGET } = await import('../fauna/budget.js');
const { FAUNA_CH } = await import('../fauna/spawn.js');
const { SPECIES } = await import('../fauna/species.js');

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } };

const W = createWorld({ seed: 1 }), B = FAUNA_BUDGET.desktop;
const gy = (x, z) => W.ground(x, z);
const EYE = [0, gy(0, 0) + 14, 0], ROV = [165, gy(165, 0) + 12, 0];
const f = fakeCanvas({ w: 640, h: 400 });
const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096 });
S.resize(); S.setWorldMode(true);
S.camera.position.set(...EYE); S.camera.lookAt(EYE[0] - 30, EYE[1] - 5, 0); S.camera.updateMatrixWorld(true);
const cam = new THREE.PerspectiveCamera(55, 1.25, 0.12, 60);
cam.position.set(...ROV); cam.lookAt(ROV[0] + 30, ROV[1] - 3, ROV[2]); cam.updateMatrixWorld(true);
const look = [ROV[0] + 30, ROV[1] - 3, ROV[2]];
const squad = { vehicles: [{ id: 1, camera: cam, state: { p: ROV, look } }] };
const fauna = mountFauna({ S, profile: 'desktop' });
fauna.start({ W, streamer: { budget: WORLD_BUDGET.desktop }, seed: 1, profile: 'desktop', squad: () => squad, origin: () => [0, 0] });
const F = fauna.F;
ok(!!F, 'mount: createFauna');

// ── a school in front of the ROV lens ───────────────────────────────────────
const dR = 55 - ROV[1];                          // fauna/index.js SURF
const sp = SPECIES.find(s => s.habit === 'school' && s.src !== 'scan' && s.depth[0] <= dR && dR <= s.depth[1]);
const members = Array.from({ length: 12 }, (_, k) => ({ x: ROV[0] + 3 + (k % 4), y: ROV[1] - 0.3 + 0.2 * (k % 3), z: ROV[2] - 0.8 + 0.4 * Math.floor(k / 4), yaw: Math.PI / 2, size: 0.25 }));
ok(F.sim.addGroup({ sp, feature: null, centre: [ROV[0] + 4.5, ROV[1], ROV[2]], members }, 'test', null) === 12, 'school: 12 animals in front of the lens');
// ── spawn round the ROV ─────────────────────────────────────────────────────
// the spawns resolve in microtasks: one turn of the event loop a frame
for (let k = 0; k < 120; k++) { fauna.frame(1 / 30, S.camera, EYE); await new Promise(r => setImmediate(r)); }
const rk = `${Math.floor(ROV[0] / FAUNA_CH)},${Math.floor(ROV[2] / FAUNA_CH)}`, rc = F.chunks.get(rk);
ok(rovRing(WORLD_BUDGET.desktop) === 72 && !!rc && rc.state === 'live' && rc.count > 0, 'spawn: the fauna chunk under the ROV (165 m from the eye) is live', rc ? rc.state + ', ' + (rc.count || 0) + ' animals' : 'none');

const nearLens = (M, k) => Math.hypot(M[k * 16 + 12] - ROV[0], M[k * 16 + 13] - ROV[1], M[k * 16 + 14] - ROV[2]) < 9;
const schoolIn = l => { const b = F.buckets.get(sp.id); if (!b || b.state !== 'ready') return 0; const m = b.meshes[l]; let n = 0; for (let k = 0; k < m.count; k++) if (nearLens(m.instanceMatrix.array, k)) n++; return n; };
const snap = () => { const o = []; for (const [id, b] of F.buckets) if (b.state === 'ready' && b.meshes[0].count + b.meshes[1].count) o.push(id + ':' + b.meshes[0].count + '/' + b.meshes[1].count + ':' + Array.from(b.meshes[0].instanceMatrix.array.subarray(0, b.meshes[0].count * 16)).map(v => v.toFixed(3)).join(',')); return o.sort().join('|'); };

const feed = createFeed(THREE, { renderer: S.renderer, scene: S.scene, mode: 'live', size: { w: 240, h: 192, fps: 30 }, drive: 'external', adapt: false, worker: false, document: null, getVehicle: () => squad.vehicles[0], clearColour: S.hazeColour });
// the main.js order each frame: fauna.frame, S.render, then (in the next
// frame) the ROV feed render; a new species mesh is built in a feed fill
// and drawn from the next feed frame
let near = 0, seen = [], main0 = '', mainDrawn = 0, view = null, inMain = 0, frames = 0;
for (let k = 0; k < 12 && !(near && seen.includes(cam)); k++) {
  fauna.frame(1 / 30, S.camera, EYE);
  S.render(1 / 30, 16 * k);
  main0 = snap(); mainDrawn = F.stats().drawn; inMain += schoolIn(0) + schoolIn(1);
  const b = F.buckets.get(sp.id);
  seen = [];
  if (b && b.state === 'ready') b.meshes[0].onBeforeRender = (r, sc, c) => seen.push(c);
  if (feed.liveFrame(1 / 30)) frames++;
  near = schoolIn(0); view = F.stats().view;
  await new Promise(r => setImmediate(r));
}
ok(inMain === 0, 'main: the school is not in the main list (165 m > draw)', inMain);
ok(frames >= 1 && near === 12, 'feed: the feed render draws the school at the near LOD (lod 0)', `${near} of 12 at lod 0; view ${JSON.stringify(view)}`);
ok(seen.includes(cam), 'feed: the lod 0 mesh of the school is drawn for the feed camera', seen.length);
ok(view && view.near >= near && view.renders >= 1, 'feed: stats().view counts the feed list', JSON.stringify(view));

// ── the main view after the feed ────────────────────────────────────────────
S.render(1 / 30, 999);
ok(snap() === main0 && schoolIn(0) + schoolIn(1) === 0, 'main: the main render after the feed has the list of the main fill, with no school', `${mainDrawn} drawn`);
ok(F.stats().drawn === mainDrawn, 'main: the main stats are not changed by the feed fill', F.stats().drawn);

// ── budgets ─────────────────────────────────────────────────────────────────
const st = F.stats();
ok(st.agents <= B.maxAgents && st.view.drawn <= B.maxAgents && st.drawn <= B.maxAgents, 'budgets: agents and both lists within maxAgents', `${st.agents} agents, main ${st.drawn}, feed ${st.view.drawn}, max ${B.maxAgents}`);
ok(st.halos <= B.halos && st.view.halos <= B.halos, 'budgets: the glow sprites within the halo budget per camera', `main ${st.halos}, feed ${st.view.halos}, max ${B.halos}`);
// a second render of the same feed camera in one frame does not fill again
const r0 = F.stats().view.renders;
fauna.frame(1 / 30, S.camera, EYE); F.prepare(cam); F.prepare(cam);
ok(F.stats().view.renders === r0 + 1, 'budgets: one fill per camera per frame', F.stats().view.renders - r0);

feed.dispose(); fauna.dispose();
console.log(`\nfeedfauna: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
