// ============================================================================
//  FLY DUEL  ·  node tests for the size and place of the deck boxes
//  (node tests/fly3d-boxsize.test.mjs)
// ----------------------------------------------------------------------------
//  The 1600x900 capture of 2026-10-12 showed the deck box of your seat
//  over the dock (play), the box of the other fly under the count of its
//  library ("31" over "AMBER/ROT"), and a box that filled a corner of a
//  watch shot. ui/fly3d/hall.js BOX now gives a flat box of real size
//  beside the library, off the mat.
//
//    world    each box in use: a little larger than a card, lower than
//             0.35, beside the library and the graveyard, off the mat
//    seat     first person, both seats, at 1600x900 (the full canvas and
//             the old right inset), 1920x1080 and 390x760: each box
//             covers at most 3 % of the frame, it is not in the near
//             field of the camera, and no box touches the library count
//    watch    the wide shot: no box touches the library count
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const THREE = await import('three');
const rules = await import('../game/rules.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
const { MAT } = await import('../ui/fly3d/hall.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const hit = (a, b) => !!(a && b) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const f = r => (r ? [r.x, r.y, r.w, r.h].map(Math.round).join(',') : 'none');

const boxes = sc => { const out = []; sc.world.hall.table.traverse(o => { if (o.name === 'deck-box' && o.visible) out.push(o); }); return out; };
// screen rect (px) of world points, clipped to the frame; null when none is in front
function rectOf(cam, pts, w, h) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v = new THREE.Vector3();
  for (const q of pts) {
    v.copy(q).project(cam);
    if (v.z > 1) continue;
    const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
const corners = b => [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
// the corners of each mesh of an object, in its own frame (a turned box
// gives its true outline, not the larger world-axis box)
function meshCorners(o) {
  const out = [];
  o.traverse(m => {
    if (!m.isMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    for (const c of corners(m.geometry.boundingBox)) out.push(m.localToWorld(c));
  });
  return out;
}
// the four corners of a sprite (it faces the camera)
function spritePts(cam, s) {
  const r = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const p = s.getWorldPosition(new THREE.Vector3());
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => p.clone().addScaledVector(r, a * s.scale.x / 2).addScaledVector(u, b * s.scale.y / 2));
}
function views(sc, w, h) {
  sc.scene.updateMatrixWorld(true); sc.camera.updateMatrixWorld();
  const cam = sc.camera;
  const bx = boxes(sc).map(b => ({ seat: b.userData.seat, rect: rectOf(cam, meshCorners(b), w, h), dist: cam.position.distanceTo(b.getWorldPosition(new THREE.Vector3())) }));
  const labels = sc.world.piles.map(pl => (pl.label.visible && pl.n > 0 ? rectOf(cam, spritePts(cam, pl.label), w, h) : null));
  return { bx, labels };
}

const sc0 = createDuelScene(null, { headless: true });
await sc0.ready;
sc0.setState(rules.newGame({ seed: 3, decks: ['pollen', 'amber-pollen'] }));
sc0.scene.updateMatrixWorld(true);
// --- world -------------------------------------------------------------------------
for (const b of boxes(sc0)) {
  const p = b.userData.seat;
  const s = new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3());
  const foot = [Math.min(s.x, s.z), Math.max(s.x, s.z)];
  ok(foot[0] >= TABLE.cardW + 0.02 && foot[0] <= TABLE.cardW + 0.3 && foot[1] >= TABLE.cardH + 0.02 && foot[1] <= TABLE.cardH + 0.3, `world seat ${p}: the box is a little larger than a card (${foot.map(x => x.toFixed(2)).join(' x ')})`);
  ok(s.y <= 0.35 && s.y >= 0.2, `world seat ${p}: the box is low (${s.y.toFixed(2)} high)`);
  const c = b.getWorldPosition(new THREE.Vector3());
  const u = p === 0 ? c.x : -c.x, v = p === 0 ? c.z : -c.z;
  ok(u - foot[0] / 2 > MAT.u && v > TABLE.graveV - 0.3 && v < TABLE.deckV + 0.3, `world seat ${p}: the box lies beside the library and the graveyard, off the mat (u ${u.toFixed(2)}, v ${v.toFixed(2)})`);
}
sc0.dispose();

// --- seat ----------------------------------------------------------------------------
for (const [w, h, inset] of [[1600, 900, 0], [1600, 900, 496], [1920, 1080, 0], [390, 760, 0]]) {
  const sc = createDuelScene({ clientWidth: w, clientHeight: h }, { headless: true });
  await sc.ready;
  sc.setState(rules.newGame({ seed: 3, decks: ['pollen', 'amber-pollen'] }));
  sc.setClear({ r: inset, frame: null });
  for (const seat of [0, 1]) {
    const tag = `${w}x${h}${inset ? ` (right inset ${inset})` : ''} seat ${seat}`;
    sc.setFirstPerson(seat);
    for (let k = 0; k < 60; k++) sc.render(1 / 30);
    const V = views(sc, w, h);
    ok(V.bx.length === 2, `${tag}: two boxes in use`);
    for (const b of V.bx) {
      const area = b.rect ? b.rect.w * b.rect.h / (w * h) : 0;
      ok(area <= 0.03, `${tag}: the box of seat ${b.seat} covers ${(100 * area).toFixed(1)} % of the frame (at most 3 %, rect ${f(b.rect)})`);
      ok(b.dist >= 3.5, `${tag}: the box of seat ${b.seat} is out of the near field (${b.dist.toFixed(2)} from the camera)`);
      const on = V.labels.map((r, p) => (hit(b.rect, r) ? p : -1)).filter(p => p >= 0);
      ok(on.length === 0, `${tag}: the box of seat ${b.seat} ${f(b.rect)} is off the library counts (${on.map(p => `seat ${p} at ${f(V.labels[p])}`).join(', ')})`);
    }
  }
  sc.dispose();
}

// --- watch: the wide shot ---------------------------------------------------------
{
  const [w, h] = [1600, 838];
  const sc = createDuelScene({ clientWidth: w, clientHeight: h }, { headless: true });
  await sc.ready;
  sc.setState(rules.newGame({ seed: 3, decks: ['amber-pollen', 'moss-rot'] }));
  sc.setCamera('script');
  for (const az of [-1.57, 0, 1.57]) {
    sc.shoot('wide', 0, { cut: true }); sc.world.cam.az = az; sc.render(1e-4);
    const V = views(sc, w, h);
    const bad = V.bx.filter(b => V.labels.some(r => hit(b.rect, r)));
    ok(bad.length === 0, `watch wide az ${az}: no box touches a library count (${bad.map(b => `seat ${b.seat} ${f(b.rect)}`).join(', ')}; counts ${V.labels.map(f).join(' ')})`);
  }
  sc.dispose();
}

console.log(`fly3d-boxsize: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
