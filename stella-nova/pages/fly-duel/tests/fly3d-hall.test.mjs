// ============================================================================
//  FLY DUEL  ·  node tests for the hall crowd  (node tests/fly3d-hall.test.mjs)
// ----------------------------------------------------------------------------
//  Checks the crowd of ui/fly3d/hall.js without a browser (buildHall with
//  the layout of scene.js TABLE):
//    fans      half the crowd supports Fly A and half Fly B (+-1), the
//              flags show both seat colours (read from the flag instance
//              colours), as many of each (+-1), and each colour stands in
//              both halves of the crowd sector
//    react     a cheer for seat 0: the Fly A fans cheer (legs up, wings)
//              and wave their flags, the Fly B fans groan (no wings, head
//              down); a cheer for seat 1 turns it round; it all ends
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
const { buildHall, CROWD_SECTOR } = await import('../ui/fly3d/hall.js');
const { TABLE: T } = await import('../ui/fly3d/scene.js');
const { FLY } = await import('../ui/tokens.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };

const seatPos = (p, u, y, v, out = new THREE.Vector3()) => (p === 0 ? out.set(u, T.y + y, v) : out.set(-u, T.y + y, -v));
export const LAYOUT = { y: T.y, halfLen: T.halfLen, halfDepth: T.halfDepth, seatV: T.seatV, seatTop: T.seatTop, seatPos };

const hexOf = c => '#' + c.getHexString();
const az = P => { let a = Math.atan2(P.pos.x, P.pos.z); if (a < 0) a += 2 * Math.PI; return a; };

// --- fans --------------------------------------------------------------------------
for (const coarse of [false, true]) for (const seed of [7, 11, 123]) {
  const tag = `${coarse ? 'phone' : 'desktop'} seed ${seed}`;
  const hall = buildHall({ coarse, seed, layout: LAYOUT });
  const { herd, n, fx } = hall.crowd;
  const fanN = [0, 1].map(s => fx.filter(f => f.fan === s).length);
  ok(fanN[0] + fanN[1] === n && Math.abs(fanN[0] - fanN[1]) <= 1, `${tag}: fans split ${fanN.join('/')} of ${n}`);
  // flag colours, read from the instance colours of the flag mesh
  const mid = (CROWD_SECTOR[0] + CROWD_SECTOR[1]) / 2;
  const count = [{ lo: 0, hi: 0 }, { lo: 0, hi: 0 }];
  const c = new THREE.Color();
  let wrong = 0;
  herd.pose.forEach((P, i) => {
    if (P.flagIdx < 0) return;
    herd.flags.getColorAt(P.flagIdx, c);
    const h = hexOf(c), s = h === hexOf(new THREE.Color(FLY[0])) ? 0 : h === hexOf(new THREE.Color(FLY[1])) ? 1 : -1;
    if (s < 0 || s !== fx[i].fan) { wrong++; return; }
    count[s][az(P) < mid ? 'lo' : 'hi']++;
  });
  const a = count[0].lo + count[0].hi, b = count[1].lo + count[1].hi;
  ok(wrong === 0, `${tag}: each flag is in the colour of its holder's fly (${wrong} wrong)`);
  ok(a > 0 && b > 0 && Math.abs(a - b) <= 1 && a + b === herd.flags.count, `${tag}: flags Fly A ${a}, Fly B ${b} of ${herd.flags.count}`);
  ok(count[0].lo > 0 && count[0].hi > 0 && count[1].lo > 0 && count[1].hi > 0, `${tag}: both colours in both halves of the crowd (${JSON.stringify(count)})`);
  hall.dispose();
}

// --- react -------------------------------------------------------------------------
for (const side of [0, 1]) {
  const hall = buildHall({ coarse: false, seed: 7, layout: LAYOUT });
  const { herd, n, fx } = hall.crowd;
  for (let k = 0; k < 30; k++) hall.update(1 / 30);
  const hp0 = herd.pose.map(P => P.hp);
  hall.react('cheer', { side, strength: 1 });
  let cheerMax = 0, groanBuzz = 0, groanDown = 0, waved = 0;
  const flagM = new THREE.Matrix4(), seen = new Map();
  for (let k = 0; k < 24; k++) {
    hall.update(1 / 30);
    const up = fx.filter(f => f.fan === side && herd.pose[f.i].legL > 0.3 && herd.pose[f.i].buzz > 0.2).length;
    cheerMax = Math.max(cheerMax, up);
    for (const f of fx) if (f.fan === 1 - side) {
      const P = herd.pose[f.i];
      if (P.buzz > 0) groanBuzz++;
      if (P.hp > hp0[f.i] + 0.15) groanDown = Math.max(groanDown, 1);
    }
    // the flags of the fans of `side` swing: their matrices change frame to frame
    for (const f of fx) if (f.flagSide === side) {
      herd.flags.getMatrixAt(herd.pose[f.i].flagIdx, flagM);
      const e = flagM.elements.slice(0, 3).join();
      if (seen.has(f.i) && seen.get(f.i) !== e) waved++;
      seen.set(f.i, e);
    }
  }
  const fans = fx.filter(f => f.fan === side).length;
  ok(cheerMax > fans * 0.6, `cheer for ${side}: its fans cheer (${cheerMax} of ${fans})`);
  ok(groanBuzz === 0 && groanDown, `cheer for ${side}: the other fans groan, no wings (${groanBuzz} buzz frames), heads down`);
  ok(waved > 10, `cheer for ${side}: the flags of its fans wave (${waved})`);
  for (let k = 0; k < 120; k++) hall.update(1 / 30);
  ok(herd.pose.slice(0, n).every(P => P.buzz === 0 && P.wave === 0), `cheer for ${side}: the reaction ends`);
  hall.dispose();
}

console.log(`fly3d-hall: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
