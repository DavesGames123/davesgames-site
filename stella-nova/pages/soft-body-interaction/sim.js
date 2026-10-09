// ============================================================================
//  GRAB INTERACTION  ·  pages/soft-body-interaction/sim.js — the site layer
//  (ES module)
// ----------------------------------------------------------------------------
//  main.js is the upstream demo, unchanged (Ten Minute Physics #08 by
//  Matthias Müller, MIT; the notice is at its top and in style.css). It
//  runs first as a classic script and leaves its globals. This module:
//    - names the credit (TMP.page, widgets/ten-minute-physics/kit.js)
//    - mounts the sim kit GUI over it (../soft-bodies/page3d.js)
//    - builds scenes with scene.js (balls, sizes, start, restitution,
//      ball-ball contacts, obstacles, the box)
//    - defines the screensaver shots (shots.js, kit director) and the
//      autopilot throws
//  The upstream buttons stay in a hidden block (#tmp-ui).
//
//  grep -n targets: "function look", "boot({"
// ============================================================================
import { boot } from '../soft-bodies/page3d.js';
import * as S3 from '../soft-bodies/stage3d.js';
import * as SC from './scene.js';
import { makeShots } from './shots.js';
import { core as K } from '../../widgets/sim-kit/ui.js';

TMP.page({ n: '08', title: 'Grab Interaction', file: '08-interaction.html', video: 'iH_UgUb-LYM', year: 2021, licence: 'MIT' });

/* global THREE, gThreeScene, gRenderer, gCamera, gCameraControl, gGrabber, gPhysicsScene, Ball */
const G = {
  get THREE() { return THREE; }, get gThreeScene() { return gThreeScene; }, get gRenderer() { return gRenderer; },
  get gCamera() { return gCamera; }, get gCameraControl() { return gCameraControl; }, get gGrabber() { return gGrabber; },
  get gPhysicsScene() { return gPhysicsScene; },
};
const U = { THREE, scene: gThreeScene, P: gPhysicsScene, Ball };
SC.install(U);
const SHOTS = makeShots();

function look(st) {
  const cols = K.paletteColors(st.palette);
  gPhysicsScene.objects.forEach((b, i) => { S3.setMaterial(THREE, b.visMesh, st.mat, cols[i % cols.length]); b.visMesh.castShadow = st.shadows !== false; });
  SC.W.meshes.forEach((m, i) => { S3.setMaterial(THREE, m, st.mat === 'jelly' ? 'satin' : st.mat, cols[(i + 2) % cols.length]); m.castShadow = st.shadows !== false; });
  if (SC.W.arena) { const t = K.themeById(st.theme); SC.W.arena.traverse(o => { if (o.material && o.material.color) o.material.color.set(t.accent); }); }
}

let kickT = 0;
boot({
  id: 'grab', G, title: 'Grab Interaction', sub: 'Pick up and throw: balls with bounce', panelTitle: 'Scene',
  footer: 'Simulation: Matthias Müller, Ten Minute Physics #08 (MIT). Many balls, restitution, contacts, obstacles, look and GUI: davesgames.io.',
  schema: SC.makeSchema, guard: SC.guard, fov: 55,
  build(st, r) {
    SC.build(U, st, r);
    SC.W.meshes = S3.obstacleMeshes(G, SC.W.obs, K.paletteColors(st.palette), st.mat);
  },
  live(st) { SC.live(U, st); },
  look,
  simulate: () => SC.simulate(U, () => gGrabber.increaseTime(gPhysicsScene.dt)),
  focus: P => [0, 0.45, 0],
  size: P => Math.max(0.9, 0.55 * Math.max(P.kit.state.width, P.kit.state.depth)),
  home(P) { const s = Math.max(P.kit.state.width, P.kit.state.depth); gCamera.position.set(0.4 * s, 0.75 * s, 1.15 * s); },
  actions: {
    act(id, kit) {
      const r = K.rng(K.newSeed());
      if (id === 'add') {
        const st = kit.state, rad = Math.max(0.05, st.radius * (0.7 + 0.6 * r()));
        const b = new Ball(new THREE.Vector3((r() - 0.5) * st.width * 0.6, 1.6, (r() - 0.5) * st.depth * 0.6), rad, new THREE.Vector3((r() - 0.5) * 3, 0, (r() - 0.5) * 3));
        b.visMesh.castShadow = true; gPhysicsScene.objects.push(b); look(st);
      } else SC.kick(U, r, id);
      if (!kit.playing) kit.setPlaying(true);
    },
  },
  shots: SHOTS,
  params: st => [
    { sym: 'N', name: 'balls', value: String(gPhysicsScene.objects.length) },
    { sym: 'e', name: 'restitution', value: st.e.toFixed(2) },
    { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
  ],
  tick(dt, ctx) {
    const shot = SHOTS.find(s => s.key === ctx.shot);
    if (!shot || !shot.kick) return;
    kickT += dt;
    if (kickT > 2.8 + 1.5 * ctx.r()) { kickT = 0; SC.kick(U, ctx.r, shot.kick); }
  },
});
