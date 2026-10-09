// ============================================================================
//  CLOTH SELF COLLISION  ·  pages/cloth-self-collision/sim.js — the site
//  layer (ES module)
// ----------------------------------------------------------------------------
//  main.js is the upstream demo, unchanged (Ten Minute Physics #15 by
//  Matthias Müller, MIT; the notice is at its top and in style.css). It
//  runs first as a classic script and leaves its globals. This module:
//    - names the credit (TMP.page, widgets/ten-minute-physics/kit.js)
//    - mounts the sim kit GUI over it (../soft-bodies/page3d.js)
//    - builds scenes with scene.js (grid size, start, pins, wind,
//      obstacles, self collision on or off)
//    - defines the screensaver shots (shots.js, kit director)
//  The upstream buttons and inputs stay in a hidden block (#tmp-ui).
//
//  grep -n targets: "function look", "boot({"
// ============================================================================
import { boot } from '../soft-bodies/page3d.js';
import * as S3 from '../soft-bodies/stage3d.js';
import * as SC from './scene.js';
import { makeShots } from './shots.js';
import { core as K, isPhone } from '../../widgets/sim-kit/ui.js';

TMP.page({ n: '15', title: 'Cloth Self-Collision', file: '15-selfCollision.html', video: 'XY3dLpgOk4Q', year: 2022, licence: 'MIT' });

/* global THREE, gThreeScene, gRenderer, gCamera, gCameraControl, gGrabber, gPhysicsScene, Cloth, simulate */
const G = {
  get THREE() { return THREE; }, get gThreeScene() { return gThreeScene; }, get gRenderer() { return gRenderer; },
  get gCamera() { return gCamera; }, get gCameraControl() { return gCameraControl; }, get gGrabber() { return gGrabber; },
  get gPhysicsScene() { return gPhysicsScene; },
};
const U = { THREE, scene: gThreeScene, P: gPhysicsScene, Cloth };
SC.install(U);
const CAP = isPhone() ? 2500 : 6000;
const SHOTS = makeShots({ lift: () => SC.lift(U), later: (sec, f) => setTimeout(f, sec * 1000) });

function look(st) {
  const cols = K.paletteColors(st.palette), c = gPhysicsScene.cloth;
  if (c) {
    if (!c.triMesh.geometry.attributes.uv) S3.planarUV(THREE, c.triMesh.geometry, c.restPos, 6);
    S3.setMaterial(THREE, c.triMesh, st.mat, cols[0], { side: THREE.FrontSide, map: S3.clothTexture(THREE, st.pattern, cols) });
    // the back side: the same pattern in the palette turned by two colours
    const back = cols.slice(2).concat(cols.slice(0, 2));
    S3.setMaterial(THREE, c.backMesh, st.mat === 'jelly' ? 'satin' : st.mat, back[0], { side: THREE.BackSide, map: S3.clothTexture(THREE, st.pattern, back) });
    c.triMesh.castShadow = st.shadows !== false;
    c.edgeMesh.material.color.set(cols[1 % cols.length]);
  }
  SC.W.meshes.forEach((m, i) => { S3.setMaterial(THREE, m, st.mat === 'jelly' ? 'satin' : st.mat, cols[(i + 3) % cols.length]); m.castShadow = st.shadows !== false; });
}

boot({
  id: 'clothSelf', G, title: 'Cloth Self Collision', sub: 'A spatial hash keeps the layers apart', panelTitle: 'Scene',
  footer: 'Simulation: Matthias Müller, Ten Minute Physics #15 (MIT). Starts, pins, wind, obstacles, fabrics and GUI: davesgames.io.',
  schema: SC.makeSchema, guard: (next, prev, r) => SC.guard(next, prev, r, CAP), fov: 50,
  build(st, r) {
    SC.build(U, st, r);
    SC.W.meshes = S3.obstacleMeshes(G, SC.W.obs, K.paletteColors(st.palette), st.mat);
  },
  live(st) { SC.live(U, st); },
  look,
  before(dt) { SC.W.t += dt; SC.gravity(U); },
  simulate: () => simulate(),
  focus: P => { const c = gPhysicsScene.cloth ? S3.centroid([gPhysicsScene.cloth]) : [0, 0.2, 0]; return [c[0], Math.max(0.12, Math.min(c[1], 0.9)), c[2]]; },
  size: () => Math.max(0.6, SC.W.size * 1.1),
  home(P) { const f = this.focus(P), s = Math.max(0.5, SC.W.size); gCamera.position.set(f[0] + 0.5 * s, f[1] + 0.45 * s, f[2] + 1.1 * s); },
  actions: {
    act(id, kit) {
      if (id === 'lift') SC.lift(U); else if (id === 'release') SC.release(U); else if (id === 'shake') SC.shake(U, K.rng(K.newSeed()));
      if (!kit.playing) kit.setPlaying(true);
    },
  },
  shots: SHOTS,
  params: st => [
    { sym: 'n', name: 'particles', value: String(st.nx * st.ny) },
    { sym: 'h', name: 'thickness', value: (st.spacing * 1000).toFixed(0) + ' mm' },
    { sym: '', name: 'self collision', value: st.selfColl ? 'on' : 'off' },
  ],
});
