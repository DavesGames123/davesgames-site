// ============================================================================
//  SOFT BODY SKINNING  ·  pages/soft-body-skinning/sim.js — the site layer
//  (ES module)
// ----------------------------------------------------------------------------
//  main.js is the upstream demo, unchanged (Ten Minute Physics #12 by
//  Matthias Müller, MIT; the notice is at its top and in style.css). It
//  runs first as a classic script and leaves its globals. This module:
//    - names the credit (TMP.page, widgets/ten-minute-physics/kit.js)
//    - mounts the sim kit GUI over it (../soft-bodies/page3d.js)
//    - builds scenes with scene.js (dragons, start, compliances, gravity,
//      obstacles, the tet cage on or off)
//    - defines the screensaver shots (shots.js, kit director)
//  The upstream buttons and slider stay in a hidden block (#tmp-ui).
//
//  grep -n targets: "function look", "boot({"
// ============================================================================
import { boot } from '../soft-bodies/page3d.js';
import * as S3 from '../soft-bodies/stage3d.js';
import * as SC from './scene.js';
import { makeShots } from './shots.js';
import { core as K } from '../../widgets/sim-kit/ui.js';

TMP.page({ n: '12', title: 'Soft Body Skinning', file: '12-softBodySkinning.html', video: 'Noo5sfGGWe0', year: 2022, licence: 'MIT' });

/* global THREE, gThreeScene, gRenderer, gCamera, gCameraControl, gGrabber, gPhysicsScene, SoftBody, dragonTetMesh, dragonVisMesh, simulate */
const G = {
  get THREE() { return THREE; }, get gThreeScene() { return gThreeScene; }, get gRenderer() { return gRenderer; },
  get gCamera() { return gCamera; }, get gCameraControl() { return gCameraControl; }, get gGrabber() { return gGrabber; },
  get gPhysicsScene() { return gPhysicsScene; },
};
const U = { THREE, scene: gThreeScene, P: gPhysicsScene, SoftBody, tetMesh: dragonTetMesh, visMesh: dragonVisMesh };
SC.install(U);
const squashAll = () => { for (const b of gPhysicsScene.objects) b.squash(); };
const SHOTS = makeShots({ squash: squashAll, later: (sec, f) => setTimeout(f, sec * 1000) });

function look(st) {
  const cols = K.paletteColors(st.palette);
  gPhysicsScene.objects.forEach((b, i) => { S3.setMaterial(THREE, b.visMesh, st.mat, cols[i % cols.length]); b.visMesh.castShadow = st.shadows !== false; b.tetMesh.material.color.set(cols[(i + 2) % cols.length]); });
  SC.W.meshes.forEach((m, i) => { S3.setMaterial(THREE, m, st.mat === 'jelly' ? 'satin' : st.mat, cols[(i + 3) % cols.length]); m.castShadow = st.shadows !== false; });
}

let kickT = 0, kickN = 0;
boot({
  id: 'skinning', G, title: 'Soft Body Skinning', sub: 'A detailed surface on a coarse XPBD cage', panelTitle: 'Scene',
  footer: 'Simulation: Matthias Müller, Ten Minute Physics #12 (MIT). Scenes, obstacles, look and GUI: davesgames.io.',
  schema: SC.makeSchema, guard: SC.guard, fov: 55,
  build(st, r) {
    SC.build(U, st, r);
    SC.W.meshes = S3.obstacleMeshes(G, SC.W.obs, K.paletteColors(st.palette), st.mat);
    kickT = 0;
  },
  live(st) { SC.live(U, st); },
  look,
  simulate: () => simulate(),
  focus: () => { const c = S3.centroid(gPhysicsScene.objects); return [c[0], Math.max(0.4, Math.min(c[1], 1.2)), c[2]]; },
  size: () => 1 + 0.4 * SC.W.spread,
  home(P) { const d = 3.4 + 1.1 * SC.W.spread; gCamera.position.set(0.3 * d, 0.5 * d, d); },
  actions: {
    act(id, kit) {
      if (id === 'squash') squashAll();
      else if (id === 'kick') { const r = K.rng(K.newSeed()); for (let i = 0; i < gPhysicsScene.objects.length; i++) SC.kick(U, i, r); }
      else if (id === 'lift') { for (const b of gPhysicsScene.objects) S3.placeBody(b, { at: S3.centroid([b]).map((v, k) => k === 1 ? 1.2 : v) }); }
      if (!kit.playing) kit.setPlaying(true);
    },
  },
  shots: SHOTS,
  params: st => [
    { sym: 'N', name: 'dragons', value: String(gPhysicsScene.objects.length) },
    { sym: '\\alpha', name: 'edge compliance', value: String(st.edgeC) },
    { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
  ],
  tick(dt, ctx) {
    const shot = SHOTS.find(s => s.key === ctx.shot);
    if (!shot || !shot.kicks) return;
    kickT += dt;
    if (kickT > 3 + 1.5 * ctx.r()) { kickT = 0; SC.kick(U, kickN++, ctx.r); }
  },
});
