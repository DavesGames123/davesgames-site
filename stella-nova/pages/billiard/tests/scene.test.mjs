// ============================================================================
//  POOL PHYSICS  ·  tests/scene.test.mjs — the 3D table (jsdom, fake WebGL2)
// ----------------------------------------------------------------------------
//  The page boots in jsdom (tests/harness.mjs); three r160 builds the real
//  scene on a recording WebGL2. Geometry checks, no pixels:
//    pockets ........ "the pockets are not well carved out and the cylinder
//                     covers the side pocket": rays straight down into each
//                     hole meet nothing above the bed; rays at ball-centre
//                     height from the mouth to the hole meet nothing before
//                     the hole centre; no leg or apron stands under a hole
//    shadows ........ "the 3d version's shadows ... don't draw accurately
//                     directly underneath the ball": the contact shadow of
//                     each ball sits at its contact point; the shadow
//                     cameras cover the cloth; the shadow map texel and the
//                     bias offset at the bed are about 1 mm; the contact
//                     disc is wider than the gap that the bias leaves
//    vectors ........ "make sure the 3d vectors are centered within the
//                     ball": every arrow starts at its ball centre and draws
//                     over the ball (no depth test)
//    cue ............ the 3D cue follows core/cue.js: clear of the balls and
//                     the rail in the page's own shots
//    look ........... the felt and smudge scans load (artwork/), the lamp
//                     is dimmer than before (spot intensity, exposure)
// ============================================================================
import { ok, done } from './util.mjs';
import { bootPage, loadJsdom } from './harness.mjs';
import { cueClearance } from '../core/cue.js';

if (!loadJsdom()) { ok(false, 'jsdom: not found (set JSDOM_DIR or NODE_PATH)'); done(); process.exit(1); }
const THREE = await import('three');

const P = await bootPage({ w: 1280, h: 800 });
const { pool } = P, A = pool.APP, V = pool.V, T = pool.T, R = T.R;
ok(!!V && P.errors.length === 0, 'boot: the 3D scene builds on the fake WebGL2 with no errors', P.errors.slice(0, 2).join(' | '));

// ── pockets ──────────────────────────────────────────────────────────────────
{
  V.table.updateMatrixWorld(true);
  const meshes = []; V.table.traverse(o => { if (o.isMesh) meshes.push(o); });
  const ray = new THREE.Raycaster(), bad = [], hitNames = new Set();
  let down = 0, across = 0;
  for (const p of T.pockets) {
    // straight down at 0.8 of the hole radius, 24 points round the centre and the centre
    const pts = [[0.0013, 0.0007]]; for (let k = 0; k < 24; k++) { const a = (k + 0.37) / 24 * 2 * Math.PI; pts.push([Math.cos(a) * 0.8 * p.r, Math.sin(a) * 0.8 * p.r]); }   // off the mesh edges
    for (const [dx, dy] of pts) {
      ray.set(new THREE.Vector3(p.hx + dx, 0.6, -(p.hy + dy)), new THREE.Vector3(0, -1, 0));
      const h = ray.intersectObjects(meshes, false)[0];
      down++;
      if (!h || h.point.y > -0.02) bad.push(`pocket ${p.id} down at (${dx.toFixed(3)}, ${dy.toFixed(3)}): ${h ? h.object.name + ' at y ' + h.point.y.toFixed(3) : 'nothing'}`);
      else hitNames.add(h.object.name);
    }
    // from the mouth to the hole centre at ball-centre height, and 0.6 R to each side
    const mx = p.mx - p.ox * 0.05, my = p.my - p.oy * 0.05;
    for (const off of [-0.6 * R, 0, 0.6 * R]) {
      const ox = mx - p.oy * off, oy = my + p.ox * off;
      const dx = p.hx - ox, dy = p.hy - oy, L = Math.hypot(dx, dy);
      ray.set(new THREE.Vector3(ox, R, -oy), new THREE.Vector3(dx / L, 0, -dy / L));
      const h = ray.intersectObjects(meshes, false)[0];
      across++;
      if (h && h.distance < L - 1e-3) bad.push(`pocket ${p.id} mouth ray (off ${(off * 1000).toFixed(0)} mm) hits ${h.object.name} at ${(h.distance * 100).toFixed(1)} cm < ${(L * 100).toFixed(1)} cm`);
    }
  }
  // no leg, apron board or bead in the column of a hole above the bag bottom (the side pockets drop between the apron boards)
  const under = [];
  // (a part wholly under the drop bag, like a leg, is fine: the bag hangs above it)
  for (const m of meshes) if (m.name === 'leg' || m.name === 'apron' || m.name === 'bead') {
    const b = new THREE.Box3().setFromObject(m);
    if (b.max.y < -0.185) continue;
    for (const p of T.pockets) if (b.max.x > p.hx - p.r && b.min.x < p.hx + p.r && b.max.z > -p.hy - p.r && b.min.z < -p.hy + p.r) under.push(`${m.name} under pocket ${p.id}`);
  }
  ok(!bad.length && !under.length && hitNames.size >= 1 && [...hitNames].every(n => /^pocket-/.test(n)),
    'pockets: rays down each hole reach the drop bag (below the bed); rays from each mouth reach the hole centre unblocked; no leg or apron under a hole',
    `${[...bad, ...under].slice(0, 4).join('; ')} | ${down} down rays hit ${[...hitNames].join(', ')}; ${across} mouth rays clear`);
  const cuts = V.table.userData.cuts;
  ok(cuts.length === 6 && cuts.every(c => c.open[1] - c.open[0] > 0.6 && c.open[1] - c.open[0] < 2 * Math.PI - 0.5), 'pockets: each cut has an open side to the table (the liner and the leather cover leave the mouth free)',
    cuts.map(c => `${((c.open[1] - c.open[0]) * 180 / Math.PI).toFixed(0)} deg`).join(', '));
}

// ── a shot: the contact shadows, the arrows, the cue ─────────────────────────
let sawRoll = 0, arrowBad = 0, arrowN = 0, shadowBad = 0, shadowN = 0, cueN = 0, cueWorst = Infinity, depthOff = 0;
for (let k = 0; k < 2400 && A.G.shots < 3; k++) {
  P.frames(1);
  const S = A.G.S;
  // contact shadows at each ball's contact point
  for (let n = 0; n < 16; n++) {
    const b = V.balls[n], c = V.contact[n];
    if (!b.visible) { if (c.visible) shadowBad++; continue; }
    if (A.drops[n] || Math.abs(b.position.y - R) > 1e-9) continue;   // dropping into a pocket
    shadowN++;
    if (!c.visible || Math.hypot(c.position.x - b.position.x, c.position.z - b.position.z) > 1e-9 || Math.abs(c.position.y - 0.0006) > 1e-9) shadowBad++;
  }
  if (A.phase === 'roll') {
    sawRoll++;
    for (const g of V.arrows) {
      if (!g || !g.visible) continue;
      arrowN++;
      // the nearest visible ball centre to the arrow start
      let best = Infinity;
      for (const b of V.balls) if (b.visible) best = Math.min(best, b.position.distanceTo(g.position));
      if (best > 1e-9) arrowBad++;
      if (g.userData.shaft.material.depthTest !== false) depthOff++;
    }
  }
  if (V.cuePose && V.cue.visible) { cueN++; cueWorst = Math.min(cueWorst, cueClearance(T, S, V.cuePose).min); }
}
ok(shadowN > 1000 && shadowBad === 0, 'shadows: a contact shadow sits exactly under every ball on the cloth (and none under a dropping ball)', `${shadowN} ball frames, ${shadowBad} off`);
ok(sawRoll > 50 && arrowN > 50 && arrowBad === 0 && depthOff === 0, 'vectors: every 3D arrow starts at its ball centre (ball-centre height) and draws over the ball', `${arrowN} arrows in ${sawRoll} rolling frames, ${arrowBad} off centre`);
ok(cueN > 50 && cueWorst >= 0, 'cue: the 3D cue (core/cue.js pose) clears every ball and the rail in the page shots', `${cueN} frames, smallest gap ${(cueWorst * 1000).toFixed(2)} mm`);
{
  // the cue meshes follow the pose
  const Pp = V.cuePose;
  if (Pp) {
    const d = Math.hypot(V.cue.position.x - Pp.tip[0], V.cue.position.y - Pp.tip[2], V.cue.position.z + Pp.tip[1]);
    ok(d < 1e-9, 'cue: the 3D cue tip is at the pose tip', `${d}`);
  } else ok(true, 'cue: no cue at the end of the run (balls rolling)');
}

// ── the shadow cameras ───────────────────────────────────────────────────────
{
  const casters = V.lights.filter(L => L.castShadow), ix = T.hx + T.spec.cushionW, iy = T.hy + T.spec.cushionW;
  let covered = 0, total = 0, texel = 0, biasMm = 0, nbMm = 0;
  for (const L of casters) { L.updateMatrixWorld(true); L.target.updateMatrixWorld(true); L.shadow.updateMatrices(L); }
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 10; j++) {
    const p = new THREE.Vector3(-ix + 2 * ix * i / 20, 0, -iy + 2 * iy * j / 10);
    total++;
    if (casters.some(L => { const q = p.clone().applyMatrix4(L.shadow.camera.matrixWorldInverse).applyMatrix4(L.shadow.camera.projectionMatrix); return Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z > -1 && q.z < 1; })) covered++;
  }
  for (const L of casters) {
    const cam = L.shadow.camera, z = L.position.y;              // the bed is z metres below the lamp
    texel = Math.max(texel, 2 * z * Math.tan(cam.fov * Math.PI / 360) / L.shadow.mapSize.x);
    // a depth bias db (of the [0, 1] depth) moves the test by db (f - n) z^2 / (f n) metres
    biasMm = Math.max(biasMm, Math.abs(L.shadow.bias) * (cam.far - cam.near) * z * z / (cam.far * cam.near) * 1000);
    nbMm = Math.max(nbMm, L.shadow.normalBias * 1000);
  }
  // the contact gap: where the ball bottom is closer than the biases to the cloth, the map sees no blocker
  const gapR = Math.sqrt(2 * R * (biasMm + nbMm) / 1000), discR = 1.25 * R;
  ok(covered === total && texel < 0.0012 && biasMm + nbMm < 1.2 && discR > 2 * gapR,
    'shadows: the shadow cameras cover the whole cloth; texel and bias are about 1 mm at the bed; the contact disc covers the gap the bias leaves under the ball',
    `${casters.length} casters, ${covered}/${total} cloth points, texel ${(texel * 1000).toFixed(2)} mm, bias ${biasMm.toFixed(2)} mm + normal bias ${nbMm.toFixed(2)} mm, gap radius ${(gapR * 1000).toFixed(1)} mm, disc radius ${(discR * 1000).toFixed(1)} mm`);
}
// ── the look ────────────────────────────────────────────────────────────────
{
  const cloth = V.table.getObjectByName('cloth').material, ball = V.balls[3].material;
  const src = t => (t && t.userData && t.userData.url) || '';
  const spot = V.lights[1];
  ok(/artwork\/felt-color\.jpg$/.test(src(cloth.map)) && /artwork\/felt-normal\.jpg$/.test(src(cloth.normalMap)) && /artwork\/ball-smudge-rough\.jpg$/.test(src(ball.roughnessMap)) && ball.clearcoatRoughnessMap && ball.roughnessMap.offset.length() > 0,
    'look: the cloth uses the felt scans and each ball its own patch of the fingerprint and smudge scan', `${src(cloth.map).split('/').pop()}, ${src(ball.roughnessMap).split('/').pop()} offset ${ball.roughnessMap.offset.toArray().map(v => v.toFixed(2))}`);
  ok(spot.intensity <= 13 && V.renderer.toneMappingExposure <= 0.85, 'look: the lamp is dimmer than before (spot 22 -> 13, exposure 1.05 -> 0.85)', `spot ${spot.intensity}, exposure ${V.renderer.toneMappingExposure}`);
}
P.close();
done();
