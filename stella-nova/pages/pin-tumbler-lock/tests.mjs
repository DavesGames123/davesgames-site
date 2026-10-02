// ============================================================================
//  PIN TUMBLER LOCK  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks lock.js for both variants:
//    shear ....... the right key splits every stack on the shear line;
//                  the wrong key and no key leave stacks across it
//    rest ........ with no key, every pin stack or wafer blocks the plug
//    turn ........ the plug turns 90° only when open, else only the clearance
//    sweep ....... over the full insertion: pins move with no jump, springs
//                  never go solid, wafers never press the key's lower edge
//    fit ......... key in the keyway: wards clear the grooves, the tip clears
//                  the end of the plug and the resting pins
//    tip ......... the tip ramp does not change where the right key holds
//    cuts ........ each key keeps the MACS rule; the cam throws the bolt Rc
// ============================================================================
import { makeLock, keyTop, contact, keyX, D } from './lock.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const f = (v, n = 3) => v.toFixed(n);

for (const id of ['pin', 'wafer']) {
  const L = makeLock(id), g = L.g, k = g.key;
  console.log(`\n── ${g.name} ──`);
  // shear
  const R = L.state('right', 1), W = L.state('wrong', 1), N = L.state('none', 0);
  ok(R.open && R.ch.every(q => Math.abs(q.gap) < 1e-9), 'right key: every gap is zero', R.ch.map(q => f(q.gap)).join(' '));
  ok(!W.open && W.blocked >= 2 && W.ch.filter(q => !q.ok).every(q => Math.abs(q.gap) > 0.3), 'wrong key: stacks cross by > 0.3 mm', W.ch.map(q => f(q.gap)).join(' '));
  ok(N.blocked === g.n, 'no key: every stack blocks', N.ch.map(q => f(q.gap)).join(' '));
  if (L.pin) {
    const m = Math.min(...N.ch.map(q => -q.gap));
    ok(m > 0.4, 'no key: each driver crosses the shear line', `least ${f(m)} mm`);
    ok(N.ch.every(q => q.kt < g.Rp && q.kt + g.driverLen > g.Rp), 'no key: key pins below, drivers across');
    const out = Math.min(...g.kLen.map((kl, i) => contact(g, L.bits.right, 1, i) - g.rest));
    ok(out > 0.3, 'right key lifts every pin off its rest', `least ${f(out)} mm`);
    ok(g.pinR < g.holeR && g.holeR < g.chanW, 'pin in chamber, chamber inside the channel', `${g.pinR} < ${g.holeR} < ${g.chanW}`);
  } else {
    ok(N.ch.every(q => q.off === g.rest) && -g.rest < g.grooveY - g.Rp, 'no key: wafers stand out into the lower groove', `${-g.rest} of ${f(g.grooveY - g.Rp, 2)} mm`);
  }
  // turn
  ok(Math.abs(L.state('right', 1, 90 * D).theta - 90 * D) < 1e-12, 'right key turns 90°');
  ok(Math.abs(L.state('wrong', 1, 90 * D).theta - g.clearance) < 1e-12, 'wrong key turns only the clearance', `${f(g.clearance / D, 1)}°`);
  ok(L.state('right', 0.99, 90 * D).theta === 0, 'a key not home does not turn');
  if (L.pin) ok(Math.abs(L.state('right', 1, 90 * D).bolt - g.cam.Rc) < 1e-12, 'cam throws the bolt Rc at 90°', `${g.cam.Rc} mm`);
  // sweep
  for (const key of ['right', 'wrong']) {
    let jump = 0, minSpring = 1e9, maxOver = -1e9, prev = null, minTop = 1e9;
    for (let j = 0; j <= 4000; j++) {
      const s = j / 4000, st = L.state(key, s);
      for (const q of st.ch) {
        const y = L.pin ? q.kb : q.off;
        if (prev) jump = Math.max(jump, Math.abs(y - prev[q.i]));
        minSpring = Math.min(minSpring, q.spring);
        if (!L.pin) { maxOver = Math.max(maxOver, g.winBot + q.off - k.yBot); minTop = Math.min(minTop, g.grooveY - (g.Rp + q.off)); }
      }
      prev = st.ch.map(q => L.pin ? q.kb : q.off);
    }
    const solid = g.spring.turns * g.spring.wire;
    ok(jump < 0.05, `${key}: stacks move smoothly`, `largest step ${f(jump)} mm per ${f(k.travel / 4000, 4)} mm`);
    ok(minSpring > solid + 0.3, `${key}: springs never go solid`, `shortest ${f(minSpring, 2)} vs solid ${f(solid, 2)} mm`);
    if (!L.pin) {
      ok(maxOver < -0.05, `${key}: window clears the key's lower edge`, `${f(-maxOver)} mm`);
      ok(minTop > 0.2, `${key}: wafer stays inside the upper groove`, `${f(minTop)} mm`);
    }
  }
  // fit
  for (const w of g.wards) {
    const gr = k.grooves.find(q => q.side === w.side);
    ok(gr && gr.y0 < w.y0 - 0.05 && gr.y1 > w.y1 + 0.05 && gr.z < w.z - 0.05, `ward on ${w.side > 0 ? '+z' : '−z'} wall rides in the key groove`);
  }
  ok(k.thick / 2 < (L.pin ? g.slotW : g.slot) - 0.1, 'blade clears the keyway walls');
  ok(k.yTop < g.wayTop - 0.1 && k.yBot > (L.pin ? g.wayBot : g.wayBot) + 0.1, 'blade clears the keyway roof and floor');
  ok(keyX(g, 1) - k.len > g.x0 + 0.2, 'key tip clears the end of the plug', `${f(keyX(g, 1) - k.len - g.x0)} mm`);
  ok(L.pin ? k.tipY < g.rest - 0.2 : k.tipY < g.rest + Math.min(...g.winTop) - 0.2, 'key tip passes under the resting stacks');
  // tip ramp does not hold any stack with the right key home
  const noTip = { ...g, key: { ...k, tipLen: 1e-9, tipY: k.yTop } };
  const d = Math.max(...g.X.map((_, i) => Math.abs(contact(g, L.bits.right, 1, i) - contact(noTip, L.bits.right, 1, i))));
  ok(d < 1e-12, 'right key home: no stack sits on the tip ramp', `${d.toExponential(1)} mm`);
  // cuts
  for (const key of ['right', 'wrong']) {
    const b = L.bits[key], m = Math.max(...b.slice(1).map((v, i) => Math.abs(v - b[i])));
    ok(m <= k.macs && b.every(v => v >= 0 && v < k.depths), `${key} key keeps MACS ${k.macs}`, `largest step ${m}`);
  }
  const top = keyTop(g, L.bits.right, g.X[0] - k.shoulder);
  ok(Math.abs(top - k.cut(L.bits.right[0])) < 1e-12, 'cut 1 flat sits at its depth', f(top));
  console.log(`keyspace ${L.keyspace} of ${L.keyspaceRaw}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
