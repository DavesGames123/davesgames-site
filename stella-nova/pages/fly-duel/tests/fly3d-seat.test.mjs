// ============================================================================
//  FLY DUEL  ·  node tests for the play-mode API of the 3D table
//  (node tests/fly3d-seat.test.mjs)
// ----------------------------------------------------------------------------
//  Checks setFirstPerson, pickPermanent, pickCard and highlight of
//  ui/fly3d/scene.js (the API that ui/play/play.js codes against):
//
//    seat       the camera sits behind the human seat, its own mat (on a
//               phone: its creature and land rows) and the other fly in
//               the frame (16:9 and a phone), and it
//               stays there while records play; null gives the camera
//               back
//    picks      a permanent and a hand card under a screen point, a miss
//    highlight  rings for eligible, attackers, blockers and targets, a
//               list form, clear
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
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
const { MAT } = await import('../ui/fly3d/hall.js');
const { TOKENS, FLY } = await import('../ui/tokens.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const seatPos = (p, u, y, v) => (p === 0 ? new THREE.Vector3(u, TABLE.y + y, v) : new THREE.Vector3(-u, TABLE.y + y, -v));
const inFrame = (cam, w, m = 0.99) => { const v = w.clone().project(cam); return Math.abs(v.x) < m && Math.abs(v.y) < m && v.z < 1; };

async function playSome(sc, M, n) {
  let r, k = 0;
  while (k++ < n && (r = M.next())) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let i = 0; i < 6000 && !done; i++) { sc.render(1 / 30); await null; }
  }
}

for (const [w, h] of [[960, 540], [390, 760]]) {
  const tag = `${w}x${h}`;
  const canvas = { clientWidth: w, clientHeight: h, getBoundingClientRect: () => ({ left: 10, top: 20, width: w, height: h }) };
  const sc = createDuelScene(canvas, { headless: true });
  await sc.ready;
  const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 8 });
  sc.setState(M.state); sc.setSpeed(2);
  for (const seat of [0, 1]) {
    ok(sc.setFirstPerson(seat) === seat && sc.stats().firstPerson === seat && sc.stats().shot === 'seat', `${tag} seat ${seat}: first person on`);
    for (let k = 0; k < 60; k++) sc.render(1 / 30);
    const cam = sc.camera;
    const behind = seat === 0 ? cam.position.z > TABLE.seatV : cam.position.z < -TABLE.seatV;
    ok(behind && cam.position.y > TABLE.y + 1.5, `${tag} seat ${seat}: camera above and behind the seat (${cam.position.toArray().map(v => v.toFixed(1))})`);
    // A wide frame shows the whole width of your mat. A phone frame (the
    // tall seat pose makes the other fly larger) shows your creature row
    // end to end and your land row; the mat corners may leave the frame.
    const tall = w < h;
    const want = tall
      ? [seatPos(seat, -TABLE.rowHalf, 0, TABLE.creatureV), seatPos(seat, TABLE.rowHalf, 0, TABLE.creatureV), seatPos(seat, 0, 0, TABLE.landV), seatPos(1 - seat, 0, 1.2, TABLE.seatV - 0.2)]
      : [seatPos(seat, -MAT.u + 0.3, 0, MAT.v0 + 0.2), seatPos(seat, MAT.u - 0.3, 0, MAT.v0 + 0.2), seatPos(seat, 0, 0, MAT.v1 - 0.4), seatPos(1 - seat, 0, 1.2, TABLE.seatV - 0.2)];
    const out = want.filter(p => !inFrame(cam, p)).length;
    ok(out === 0, `${tag} seat ${seat}: ${tall ? 'creature and land rows' : 'own mat'} and the other fly in the frame (${out} out)`);
  }
  sc.setFirstPerson(0);
  await playSome(sc, M, 12);
  ok(sc.stats().shot === 'seat' && sc.stats().firstPerson === 0, `${tag}: first person holds while records play (${sc.stats().shot})`);
  sc.setCamera('auto');
  ok(sc.stats().shot === 'seat', `${tag}: setCamera in first person waits for the end of first person`);

  // picks: project the centre of a permanent and of a hand card
  const toClient = p => { const v = p.clone().project(sc.camera); return [10 + (v.x * 0.5 + 0.5) * w, 20 + (1 - (v.y * 0.5 + 0.5)) * h]; };
  const Z = sc.world.Z, mirror = sc.world.mirror;
  for (let k = 0; k < 30; k++) sc.render(1 / 30);
  let picked = 0, tried = 0;
  for (let p = 0; p < 2; p++) for (const x of mirror.players[p].battlefield) {
    const o = Z.perms.get(x.uid);
    if (!o) continue;
    // the card centre may lie under another card of its stack: aim at the
    // exposed top edge of a stacked land, the centre of a creature
    o.mesh.updateMatrixWorld();
    const at = o.mesh.localToWorld(new THREE.Vector3(0, 0.3, 0));
    if (!inFrame(sc.camera, at, 0.95)) continue;
    tried++;
    const hit = sc.pickPermanent(...toClient(at));
    if (hit && hit.uid === x.uid && hit.seat === p && hit.id === x.id) picked++;
  }
  ok(tried > 2 && picked >= tried - 1, `${tag}: pickPermanent finds the card under the point (${picked} of ${tried})`);
  ok(sc.pickPermanent(10 + w / 2, 20 + 2) === null || sc.pickPermanent(10 + w / 2, 20 + 2).uid == null, `${tag}: no permanent at the top of the frame`);
  // hand cards of the first-person seat
  let cards = 0, cardsOk = 0;
  Z.hand[0].forEach((o, i) => {
    o.mesh.updateMatrixWorld();
    const at = o.mesh.localToWorld(new THREE.Vector3(i === Z.hand[0].length - 1 ? 0 : -0.18, 0.25, 0));
    if (!inFrame(sc.camera, at, 0.98)) return;
    cards++;
    const c = sc.pickCard(...toClient(at));
    if (c && c.seat === 0 && c.id === o.id) cardsOk++;
  });
  ok(cardsOk > 0 && cardsOk >= cards - 2, `${tag}: pickCard finds hand cards (${cardsOk} of ${cards})`);

  // highlight
  const uids = mirror.players[0].battlefield.map(x => x.uid), opp = mirror.players[1].battlefield.map(x => x.uid);
  ok(uids.length > 1 && opp.length > 0, `${tag}: permanents for the highlight test (${uids.length}, ${opp.length})`);
  sc.highlight({ seat: 0, mode: 'attack', eligible: uids.slice(1), attackers: [uids[0]], blocks: [], targets: [opp[0]], pending: [] });
  sc.render(1 / 30);
  const ring = u => { const o = Z.perms.get(u); return o.ring.visible ? '#' + o.ring.material.color.getHexString() : null; };
  ok(ring(uids[0]) === FLY[0], `${tag}: attacker ring in the seat colour (${ring(uids[0])})`);
  ok(uids.slice(1).every(u => ring(u) === TOKENS.ink2), `${tag}: eligible rings`);
  ok(ring(opp[0]) === TOKENS.app, `${tag}: target ring (${ring(opp[0])})`);
  ok(JSON.stringify(sc.stats().highlight) !== '{}', `${tag}: stats().highlight ${JSON.stringify(sc.stats().highlight)}`);
  sc.highlight([opp[0]], 'pending'); sc.render(1 / 30);
  ok(ring(opp[0]) === TOKENS.ink, `${tag}: list form sets a kind`);
  sc.highlight(null); sc.render(1 / 30);
  ok([...uids, ...opp].every(u => ring(u) === null), `${tag}: highlight(null) clears every ring`);

  ok(sc.setFirstPerson(null) === null && sc.stats().firstPerson === null && sc.stats().shot !== 'seat' && sc.stats().camera === 'auto', `${tag}: first person off, the mode set in first person applies (${sc.stats().camera})`);
  sc.dispose();
}

console.log(`fly3d-seat: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
