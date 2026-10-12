// ============================================================================
//  FLY DUEL  ·  node tests for the d20 life dice  (node tests/fly3d-d20.test.mjs)
// ----------------------------------------------------------------------------
//  Checks ui/fly3d/d20.js without a browser:
//    faces     20 faces, numbers 1..20 once each, opposite faces add to 21
//    faceQuat  face n is on top and the top of its number points to -Z
//    life      lifeFaces for 0, 1..20, 21..40, 45, NaN
//    die       set() rolls to the face, update() lands on it, the top face
//              read from the pose equals the value, no NaN while it rolls
//    dice      createLifeDice: a second die only over 20, plate exists,
//              reduced motion turns at once
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
const { d20Faces, faceQuat, lifeFaces, createD20, createLifeDice } = await import('../ui/fly3d/d20.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };

// --- faces -----------------------------------------------------------------------
const F = d20Faces();
ok(F.length === 20, '20 faces');
ok(F.map(f => f.n).sort((a, b) => a - b).join() === Array.from({ length: 20 }, (_, i) => i + 1).join(), 'numbers 1..20 once each');
let oppBad = 0;
for (const f of F) {
  const o = F.find(g => g.n === 21 - f.n);
  if (Math.hypot(o.normal[0] + f.normal[0], o.normal[1] + f.normal[1], o.normal[2] + f.normal[2]) > 1e-6) oppBad++;
}
ok(oppBad === 0, 'opposite faces add to 21');

// --- faceQuat -----------------------------------------------------------------------
let qBad = 0;
for (let n = 1; n <= 20; n++) {
  const q = faceQuat(n), f = F.find(g => g.n === n);
  const nrm = new THREE.Vector3(...f.normal).applyQuaternion(q), up = new THREE.Vector3(...f.up).applyQuaternion(q);
  if (nrm.y < 0.9999 || up.z > -0.999 || Math.abs(up.x) > 1e-6) { qBad++; console.error('faceQuat', n, nrm.toArray(), up.toArray()); }
}
ok(qBad === 0, 'faceQuat: face up, number upright toward the seat');

// --- lifeFaces -------------------------------------------------------------------
ok(JSON.stringify(lifeFaces(0)) === '{"main":1,"extra":null,"dead":true}', 'life 0: face 1, dead');
ok(lifeFaces(-3).dead && lifeFaces(NaN).dead, 'life < 0 and NaN: dead');
let lf = 0;
for (let v = 1; v <= 20; v++) if (lifeFaces(v).main !== v || lifeFaces(v).extra !== null) lf++;
for (let v = 21; v <= 40; v++) if (lifeFaces(v).main !== 20 || lifeFaces(v).extra !== v - 20) lf++;
ok(lf === 0, 'life 1..40 maps to one or two faces');
ok(lifeFaces(45).extra === 20, 'life over 40: second die stays on 20 (the plate shows 45)');

// --- one die rolls and lands ----------------------------------------------------
const die = createD20({ size: 0.3 });
let nan = 0, topBad = 0;
for (const v of [20, 13, 1, 7, 7, 19, 2]) {
  die.set(v, { hurt: v < 10 });
  for (let k = 0; k < 90; k++) { die.update(1 / 60); if (!die.spinner.quaternion.toArray().every(Number.isFinite) || !Number.isFinite(die.spinner.position.y)) nan++; }
  if (die.top() !== v || die.rolling) { topBad++; console.error('top', v, die.top()); }
}
ok(nan === 0, 'die: no NaN while it rolls');
ok(topBad === 0, 'die: the top face of the pose equals the value after the roll');
die.set(5);
die.update(0.2);
ok(die.rolling && die.spinner.position.y > 0.3 * 0.8, 'die: hops while it rolls');
die.dispose();
const rd = createD20({ reduced: true });
rd.set(17); ok(!rd.rolling && rd.top() === 17, 'reduced motion: turns at once');
rd.dispose();

// --- two dice and the plate ----------------------------------------------------
const L = createLifeDice({ colour: '#39d0f0', label: 'A' });
L.set(20);
ok(L.faces()[0] === 20 && L.faces()[1] === null && !L.dice[1].group.visible, 'life 20: one die');
L.set(26); for (let k = 0; k < 120; k++) L.update(1 / 60);
ok(L.faces()[0] === 20 && L.faces()[1] === 6 && L.dice[1].group.visible, 'life 26: second die on 6');
L.set(3); for (let k = 0; k < 120; k++) L.update(1 / 60);
ok(L.faces()[1] === null && L.dice[0].top() === 3 && L.life === 3, 'life 3: one die on 3');
ok(L.group.getObjectByName('life-plate'), 'plate with the exact number');
let tris = 0; L.group.traverse(o => { if (o.isMesh && o.visible) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
ok(tris < 100, `dice triangles ${tris}`);
L.dispose();

console.log(`fly3d-d20: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
