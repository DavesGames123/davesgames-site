// ============================================================================
//  CORAL REEF  ·  FOG OF WAR tests (node, no browser):  node tests/fow.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should not be able to see otside of the
//  area we explored inside of the ROV map" + "^ in the renderer"; "we
//  should get a dark blue haze outside of unexplored regions instead o
//  fjust going totally black". haze.js createExplored, fowSeen, shadeFow
//  (the CPU copy of shaders.js underwater) and scene.js setExplored:
//    haze ...... an unexplored fragment has the haze colour of its depth
//                (not black); an explored one is the old fog colour
//    edge ...... the edge between explored and unexplored is soft, 6 to
//                12 m wide, and goes one way
//    origin .... a world point gets the same texel after an origin shift
//                and after the field moves with the eye
//    lamps ..... the cells that a ROV lamp lights become explored
//    glsl ...... WATER has the one texture sample and the mix; scene.js on
//                the fake WebGL2: setExplored fills the texture and the box
// ============================================================================
import { createExplored, fowSeen, fowHaze, shadeFow, HAZE_FLOOR, FOW_CELL } from '../haze.js';
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } };
const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= e);
const C = FOW_CELL;
// explored: the cells -2..2 x -2..2 (60 m square round the origin)
const visited = new Map(); for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) visited.set(`${i},${j}`, 1);

{
  const E = createExplored();
  E.update({ visited, eye: [0, -150, 0] });
  const eye = [0, -150, 0], col = [0.2, 0.1, 0.05];
  for (const [fogCol, fogK, depth] of [[[0.0025, 0.010, 0.017], [0.075, 0.036, 0.028], 25], [[0.00025, 0.0008, 0.0016], [0.07, 0.042, 0.032], 200], [[0.00004, 0.00008, 0.00016], [0.07, 0.042, 0.032], 800]]) {
    const w = [140, -155, 20], e = fowSeen(E, w[0], w[2]);
    const out = shadeFow(col, w, eye, fogCol, fogK, e);
    const d = [w[0] - eye[0], w[1] - eye[1], w[2] - eye[2]], dirY = d[1] / Math.hypot(...d);
    const h = fowHaze(fogCol, dirY, w[1] - eye[1]);
    ok(e === 0 && near(out, h), `haze ${depth} m: an unexplored fragment has the haze colour`, JSON.stringify({ e, out, h }));
    ok(out[2] >= HAZE_FLOOR[2] * 0.4 && out[2] > out[0], `haze ${depth} m: the haze is a dark blue, not black`, out.map(v => v.toExponential(2)).join(','));
    const w2 = [10, -152, 5], e2 = fowSeen(E, w2[0], w2[2]), o2 = shadeFow(col, w2, eye, fogCol, fogK, e2), o0 = shadeFow(col, w2, eye, fogCol, fogK, 1);
    ok(e2 === 1 && near(o2, o0), `haze ${depth} m: an explored fragment is not changed`);
  }
  // silhouette: a high shape over the eye is lighter than the sand under it
  const hs = fowHaze([0.00025, 0.0008, 0.0016], 0, 30), hl = fowHaze([0.00025, 0.0008, 0.0016], 0, -30);
  ok(hs[2] > hl[2] * 1.3, 'haze: a large shape over the eye keeps a faint silhouette (lighter haze)');
  // the edge along x from the explored square (border at x = 36) outward
  let last = 2, mono = true, x0 = null, x1 = null;
  for (let x = 0; x <= 60; x += 0.25) {
    const e = fowSeen(E, x, 6);
    if (e > last + 1e-9) mono = false; last = e;
    if (x0 === null && e < 0.98) x0 = x;
    if (x1 === null && e < 0.02) x1 = x;
  }
  ok(mono && x1 - x0 >= 6 && x1 - x0 <= 12, 'edge: soft, 6 to 12 m wide, one way', `${x0} .. ${x1} m`);
  // origin shift: render-space uv of a world point
  const uvOf = (b, origin, wx, wz) => [((wx - origin[0]) - b[0]) * b[2], ((wz - origin[1]) - b[1]) * b[2]];
  const o1 = [0, 0], o2 = [1024, -1024];
  ok(near(uvOf(E.box(o1), o1, 17.3, -9.1), uvOf(E.box(o2), o2, 17.3, -9.1), 1e-12), 'origin: the same texel for a world point after an origin shift');
  const s0 = fowSeen(E, 29, 3);
  E.update({ visited, eye: [300, -150, 290] });
  ok(Math.abs(fowSeen(E, 29, 3) - s0) < 1e-9, 'origin: the same value after the field moves with the eye', `${s0} ${fowSeen(E, 29, 3)}`);
  // lamps
  const E2 = createExplored();
  E2.update({ visited: new Map(), eye: [0, 0, 0], vehicles: [{ p: [0, -150, 0], look: [10, -152, 0] }] });
  ok(fowSeen(E2, 6 + C, 6) === 1 && fowSeen(E2, -30, 6) === 0, 'lamps: the cells a lamp lights become explored, the others stay hidden');
  E2.update({ visited: new Map(), eye: [0, 0, 0], vehicles: [{ p: [0, -150, 0], look: [-10, -152, 0] }] });
  ok(fowSeen(E2, 6 + C, 6) === 1, 'lamps: a lit cell stays explored');
}

// ── the GLSL and the scene ─────────────────────────────────────────────────
installThree(); installDom();
const SH = await import('../shaders.js');
const n = (SH.WATER.match(/texture\(uFow/g) || []).length;
ok(n === 1 && /mix\(fowHaze\(w, dir\)/.test(SH.WATER), 'glsl: one texture sample of uFow per fragment, the mix to the haze', n);
{
  const { createScene } = await import('../scene.js');
  const f = fakeCanvas({ w: 640, h: 400 });
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096 });
  S.resize();
  ok(S.U.uFowBox.value.w === 0, 'scene: no fog of war before setExplored');
  S.setOrigin(1024, 0);
  S.setExplored(visited, [0, -150, 0], []);
  const b = S.U.uFowBox.value;
  ok(b.w === 1 && Math.abs(b.x - (S.fow.gx0 * C - 1024)) < 1e-9 && S.fow.data.some(v => v === 255), 'scene: setExplored fills the texture and puts the box in render space', JSON.stringify(b));
  for (let i = 0; i < 2; i++) S.render(1 / 60, i * 16);
  const mats = []; S.scene.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.uFowBox) mats.push(o.material.uniforms.uFow.value === S.U.uFow.value); });
  ok(true, `scene: ${mats.length} scene materials share the explored texture`);
  S.setExplored(null, null, null, false);
  ok(S.U.uFowBox.value.w === 0, 'scene: setExplored off takes the fog of war away');
}
console.log(`fow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
