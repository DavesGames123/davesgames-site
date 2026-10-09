// ============================================================================
//  SOFT BODIES  ·  pages/soft-bodies/sim.js — the site layer (ES module)
// ----------------------------------------------------------------------------
//  main.js is the upstream demo, unchanged (Ten Minute Physics #10 by
//  Matthias Müller, MIT; the notice is at its top and in style.css). It
//  runs first as a classic script and leaves its globals. This module:
//    - names the credit (TMP.page, widgets/ten-minute-physics/kit.js)
//    - mounts the sim kit GUI over it (page3d.boot): controls, seeded
//      randomizer with locks, share link, transport, themes
//    - builds scenes with scene.js (bunnies, layouts, obstacles)
//    - defines the screensaver shots (kit director)
//  The upstream buttons and slider stay in a hidden block (#tmp-ui) so the
//  upstream script still finds its elements.
//
//  grep -n targets: "const SHOTS", "function look", "boot({"
// ============================================================================
import { boot } from './page3d.js';
import * as S3 from './stage3d.js';
import * as SC from './scene.js';
import { makeShots } from './shots.js';
import { core as K } from '../../widgets/sim-kit/ui.js';

TMP.page({ n: '10', title: 'Soft Bodies', file: '10-softBodies.html', video: 'uCaHXkS2cUg', year: 2021, licence: 'MIT' });

/* global THREE, gThreeScene, gRenderer, gCamera, gCameraControl, gGrabber, gPhysicsScene, SoftBody, bunnyMesh, simulate */
const G = {
  get THREE() { return THREE; }, get gThreeScene() { return gThreeScene; }, get gRenderer() { return gRenderer; },
  get gCamera() { return gCamera; }, get gCameraControl() { return gCameraControl; }, get gGrabber() { return gGrabber; },
  get gPhysicsScene() { return gPhysicsScene; },
};
const U = { THREE, scene: gThreeScene, P: gPhysicsScene, SoftBody, bunnyMesh };
SC.install(U);

const SHOTS = makeShots({ squash: () => squashAll(), later: (sec, f) => setTimeout(f, sec * 1000) });

function squashAll() { for (const b of gPhysicsScene.objects) b.squash(); }

function look(st) {
  const cols = K.paletteColors(st.palette);
  gPhysicsScene.objects.forEach((b, i) => { S3.setMaterial(THREE, b.surfaceMesh, st.mat, cols[i % cols.length]); b.surfaceMesh.castShadow = st.shadows !== false; });
  SC.W.meshes.forEach((m, i) => { S3.setMaterial(THREE, m, st.mat === 'jelly' ? 'satin' : st.mat, cols[(i + 3) % cols.length]); m.castShadow = st.shadows !== false; });
}

let kickT = 0, kickN = 0, kr = null;
boot({
  id: 'softBodies', G, title: 'Soft Bodies', sub: 'XPBD tetrahedral bunnies', panelTitle: 'Scene',
  footer: 'Simulation: Matthias Müller, Ten Minute Physics #10 (MIT). Scenes, obstacles, look and GUI: davesgames.io.',
  schema: SC.makeSchema, guard: SC.guard, fov: 55,
  build(st, r) {
    SC.build(U, st, r);
    SC.W.meshes = S3.obstacleMeshes(G, SC.W.obs, K.paletteColors(st.palette), st.mat);
    kr = r; kickT = 0;
  },
  live(st) { SC.live(U, st); },
  look,
  simulate: () => simulate(),
  focus: () => { const c = S3.centroid(gPhysicsScene.objects); return [c[0], Math.max(0.35, Math.min(c[1], 1.1)), c[2]]; },
  size: () => 1 + 0.55 * SC.W.spread,
  home(P) { const d = 2.4 + 1.1 * SC.W.spread; gCamera.position.set(0.35 * d, 0.55 * d, d); },
  actions: {
    act(id, kit) {
      if (id === 'squash') squashAll();
      else if (id === 'add') {
        const st = kit.state, r = K.rng(K.newSeed());
        const b = new SoftBody(bunnyMesh, gThreeScene, st.edgeC, st.volC);
        S3.placeBody(b, { at: [(r() - 0.5) * 2, 1 + r(), (r() - 0.5) * 2], yaw: r() * 6.283, w: 0 });
        b.updateMeshes(); gPhysicsScene.objects.push(b); look(st);
        if (!kit.playing) kit.setPlaying(true);
      } else if (id === 'kick') { const r = K.rng(K.newSeed()); for (let i = 0; i < gPhysicsScene.objects.length; i++) SC.kick(U, i, r); if (!kit.playing) kit.setPlaying(true); }
      else if (id === 'lift') { for (const b of gPhysicsScene.objects) S3.placeBody(b, { at: S3.centroid([b]).map((v, k) => k === 1 ? 1.4 : v) }); }
    },
  },
  shots: SHOTS,
  params: st => [
    { sym: 'N', name: 'bunnies', value: String(gPhysicsScene.objects.length) },
    { sym: '\\alpha', name: 'edge compliance', value: String(st.edgeC) },
    { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
  ],
  tick(dt, ctx) {
    const shot = SHOTS.find(s => s.key === ctx.shot);
    if (!shot || !shot.kicks) return;
    kickT += dt;
    if (kickT > 2.6 + (ctx.r() * 1.5)) { kickT = 0; SC.kick(U, kickN++, ctx.r); }
  },
});
