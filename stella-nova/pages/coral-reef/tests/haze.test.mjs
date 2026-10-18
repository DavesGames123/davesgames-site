// ============================================================================
//  CORAL REEF  ·  HAZE tests (node, no browser):  node tests/haze.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "sky rendering lack circle bug" (a black
//  disc in the middle of the view at 119 m). The water dome follows the
//  camera that draws it (scene.js onBeforeRender), on the fake WebGL2 with
//  the real three r160:
//    dome ....... with the camera 900 m from the render origin and 800 m
//                 deep, after a frame the dome is centred on the camera,
//                 inside the far plane, and every view ray hits it
//    floor ...... the dome colour (haze.js domeColour) is not black at
//                 each depth of the main.js LOOK table, also at 800 m
// ============================================================================
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
await import('three');
const { createScene } = await import('../scene.js');
const { domeHit, domeColour, HAZE_FLOOR, DOME_R } = await import('../haze.js');

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } };

{
  const f = fakeCanvas({ w: 1280, h: 800 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096 });
  S.resize();
  const dome = S.scene.getObjectByName('water-dome');
  ok(!!dome, 'the scene has the water dome');
  S.camera.position.set(900, -800, -350); S.camera.lookAt(910, -805, -340); S.camera.updateMatrixWorld(true);
  for (let i = 0; i < 3; i++) S.render(1 / 60, i * 16);
  const c = dome.position.toArray(), e = S.camera.position.toArray(), r = DOME_R * dome.scale.x;
  ok(Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]) < 1e-6, 'the dome is centred on the camera 900 m from the origin', JSON.stringify({ c, e }));
  ok(r < S.camera.far, 'the dome radius is inside the camera far plane', `r ${r} far ${S.camera.far}`);
  let miss = 0, n = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j <= 12; j++) {
    const th = (i / 24) * 2 * Math.PI, ph = (j / 12) * Math.PI;
    const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    const t = domeHit(e, c, r, d); n++;
    if (!(t > 0 && t < S.camera.far)) miss++;
  }
  ok(miss === 0, 'every view ray from the camera hits the dome before the far plane (no clear colour shows)', `${miss} of ${n}`);
  // the old dome: radius 300 at the origin, the same camera
  let old = 0; for (let j = 0; j <= 12; j++) { const d = [Math.sin(j / 12 * Math.PI), Math.cos(j / 12 * Math.PI), 0]; const t = domeHit(e, [0, 0, 0], 300, d); if (!(t > 0 && t < S.camera.far)) old++; }
  ok(old > 0, 'the old dome at the origin misses rays from that camera (the test sees the bug)', `${old}`);
}
{
  const LOOK = [[12, [0.008, 0.032, 0.044]], [60, [0.0008, 0.0030, 0.0060]], [200, [0.00025, 0.0008, 0.0016]], [800, [0.00004, 0.00008, 0.00016]]];
  for (const [d, fc] of LOOK) for (const y of [-1, 0, 1]) {
    const col = domeColour(fc, y);
    ok(col[2] >= HAZE_FLOOR[2] * 0.55 && col[2] > col[0] && Math.max(...col) > 0, `the dome colour at ${d} m, dir y ${y}, is a dark blue, not black`, col.map(v => v.toFixed(5)).join(','));
  }
}
console.log(`haze: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
