// ============================================================================
//  CLOTH  ·  pages/cloth/sim.js — the site layer (ES module)
// ----------------------------------------------------------------------------
//  main.js is the upstream demo, unchanged (Ten Minute Physics #14 by
//  Matthias Müller, MIT; the notice is at its top and in style.css). It
//  runs first as a classic script and leaves its globals. This module:
//    - names the credit (TMP.page, widgets/ten-minute-physics/kit.js)
//    - mounts the sim kit GUI over it (../soft-bodies/page3d.js): the
//      controls, seeded randomizer with locks, share link, transport,
//      themes, fabric patterns
//    - builds scenes with scene.js (start, pins, wind, obstacles)
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

TMP.page({ n: '14', title: 'Cloth', file: '14-cloth.html', video: 'z5oWopN39OU', year: 2022, licence: 'MIT' });

/* global THREE, gThreeScene, gRenderer, gCamera, gCameraControl, gGrabber, gPhysicsScene, Cloth, meshes, simulate */
const G = {
  get THREE() { return THREE; }, get gThreeScene() { return gThreeScene; }, get gRenderer() { return gRenderer; },
  get gCamera() { return gCamera; }, get gCameraControl() { return gCameraControl; }, get gGrabber() { return gGrabber; },
  get gPhysicsScene() { return gPhysicsScene; },
};
const U = { THREE, scene: gThreeScene, P: gPhysicsScene, Cloth, meshes };
SC.install(U);
const SHOTS = makeShots({ release: () => SC.release(U), later: (sec, f) => setTimeout(f, sec * 1000) });

function look(st) {
  const cols = K.paletteColors(st.palette);
  for (const b of gPhysicsScene.objects) {
    if (!b.triMesh.geometry.attributes.uv) S3.planarUV(THREE, b.triMesh.geometry, b.restPos, 4);
    const map = S3.clothTexture(THREE, st.pattern, cols);
    S3.setMaterial(THREE, b.triMesh, st.mat, cols[0], { side: THREE.DoubleSide, map });
    b.triMesh.castShadow = st.shadows !== false;
    b.edgeMesh.material.color.set(cols[1 % cols.length]);
  }
  SC.W.meshes.forEach((m, i) => { S3.setMaterial(THREE, m, st.mat === 'jelly' ? 'satin' : st.mat, cols[(i + 2) % cols.length]); m.castShadow = st.shadows !== false; });
}

boot({
  id: 'cloth', G, title: 'Cloth', sub: 'XPBD stretching and bending', panelTitle: 'Scene',
  footer: 'Simulation: Matthias Müller, Ten Minute Physics #14 (MIT). Starts, pins, wind, obstacles, fabrics and GUI: davesgames.io.',
  schema: SC.makeSchema, guard: SC.guard, fov: 50,
  build(st, r) {
    SC.build(U, st, r);
    SC.W.meshes = S3.obstacleMeshes(G, SC.W.obs, K.paletteColors(st.palette), st.mat);
  },
  live(st) { SC.live(U, st); },
  look,
  before(dt) { SC.W.t += dt; },
  simulate: () => simulate(),
  // the cloth falls: aim a little below its start so it lands in view
  focus: P => { const c = S3.centroid(gPhysicsScene.objects), st = P.kit.state; const flat = st.start === 'drape' || st.start === 'drop'; return [c[0], flat ? Math.max(0.15, Math.min(c[1], 0.45 + 0.35 * st.size)) : Math.max(0.2, c[1]), c[2]]; },
  size: P => 0.62 * P.kit.state.size,
  home(P) { const s = P.kit.state.size, f = this.focus(P); gCamera.position.set(f[0] + 0.45 * s, f[1] + 0.32 * s, f[2] + 1.2 * s); },
  actions: {
    act(id, kit) {
      if (id === 'release') SC.release(U);
      else if (id === 'gust') { const st = kit.state; kit.set('wind', Math.min(12, Math.max(4, st.wind + 4))); }
      else if (id === 'shake') SC.shake(U, K.rng(K.newSeed()));
      if (!kit.playing) kit.setPlaying(true);
    },
  },
  shots: SHOTS,
  params: st => [
    { sym: 'n', name: 'particles', value: String(gPhysicsScene.objects[0] ? gPhysicsScene.objects[0].numParticles : 0) },
    { sym: '\\alpha_b', name: 'bending compliance', value: st.bendC.toFixed(2) },
    { sym: 'a_w', name: 'wind', value: st.wind.toFixed(1) + ' m/s²' },
  ],
});
