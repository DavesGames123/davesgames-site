// ============================================================================
//  FLY DUEL  ·  node tests for the thrown and counter dice  (node tests/fly3d-dice.test.mjs)
// ----------------------------------------------------------------------------
//  Checks ui/fly3d/dice3d.js (Dice Lab shapes, Rapier throws, the label
//  swap, the scripted tumble, counter dice) and the roll and counter steps
//  of the 3D table.
//
//    relabel   the top face gets the engine value, the labels stay one
//              permutation
//    rapier    Dice Lab physics: one seed gives one throw, the dice rest
//              on the tray floor inside the tray, the face reader of Dice
//              Lab reads the engine value on top of each die after the
//              label swap, for many seeds and values (d6, d20)
//    scripted  without Rapier the tumble ends with the value on top
//    counters  a d6 for 1..6, a d20 over 6, the die turns to a new value
//    scene     a record with rolls throws dice on the mat; a permanent
//              with counters carries counter dice
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
const { createDice, relabel, dieType, DIE_S } = await import('../ui/fly3d/dice3d.js');
const { buildDie, readDie } = await import('../../dice/dice.js');
const { TRAYS } = await import('../../dice/physics.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const settle = async (D, secs) => { for (let k = 0; k < secs * 30; k++) { D.update(1 / 30); if (k % 10 === 0) await null; } };

// --- relabel ---------------------------------------------------------------------
{
  const L = buildDie('d20').faces.map(f => f.label);
  let bad = 0;
  for (let top = 0; top < 20; top++) for (let v = 1; v <= 20; v++) {
    const R = relabel(L, top, v);
    if (R[top] !== String(v) || R.slice().sort().join() !== L.slice().sort().join()) bad++;
  }
  ok(bad === 0, `relabel: top face shows the value and labels stay a permutation (${bad} bad of 400)`);
  ok(dieType(20) === 'd20' && dieType(6) === 'd6' && dieType(7) === 'd6' && dieType(100) === 'd6', 'dieType maps sides to Dice Lab types');
}

// --- rapier throws ------------------------------------------------------------------
{
  const D = createDice({ physics: true });
  const mode = await D.ready;
  ok(mode === 'rapier', `Rapier loads in node (${mode})`);
  if (mode === 'rapier') {
    let wrong = 0, out = 0, swapped = 0, n = 0, cocked = 0;
    const [tw, td] = TRAYS.medium;
    for (let seed = 1; seed <= 24; seed++) {
      const rolls = [{ die: 20, value: 1 + (seed * 7) % 20 }, { die: 6, value: 1 + (seed * 5) % 6 }];
      let res = null;
      D.roll(rolls, { p: seed % 2, seed }).then(r => { res = r; });
      // after the playback (at most 2.2 s), before the fade
      await settle(D, 2.4);
      const tops = D.topLabels();
      if (tops.join() !== rolls.map(r => String(r.value)).join()) { wrong++; if (wrong < 3) console.error('tops', tops, rolls); }
      // each die rests on the tray floor, inside the tray
      const g = D.group.children[D.group.children.length - 1];
      for (const m of g.children) {
        const p = m.position;
        if (Math.abs(p.x) > tw / 2 || Math.abs(p.z) > td / 2 || p.y < 0 || p.y > 2.5) out++;
      }
      await settle(D, 2.5);
      ok(res && res.length === 2, `seed ${seed}: the roll resolves with two results`);
      for (const r of res || []) { n++; if (r.landed !== String(r.value)) swapped++; if (r.cocked) cocked++; if (r.mode !== 'rapier') wrong++; }
    }
    ok(wrong === 0, `rapier: the engine value is on top of every die after the swap (${wrong} wrong)`);
    ok(out === 0, `rapier: dice rest on the floor of the tray (${out} out)`);
    ok(swapped > n / 2, `rapier: physics picks the landing face, the label swap shows the engine value (${swapped} of ${n} swapped)`);
    console.log(`  rapier: ${n} dice, ${swapped} relabelled, ${cocked} cocked after rethrows`);
    // one seed, one throw: two throws with one seed land on the same faces
    const a = [], b = [];
    D.roll([{ die: 20, value: 3 }], { seed: 99 }).then(r => a.push(r[0].face));
    await settle(D, 5);
    D.roll([{ die: 20, value: 3 }], { seed: 99 }).then(r => b.push(r[0].face));
    await settle(D, 5);
    ok(a.length && a[0] === b[0], `rapier: one seed gives one throw (faces ${a} / ${b})`);
    ok(D.stats().thrown === 0, 'thrown dice leave the mat after the hold');
  }
  D.dispose();
}

// --- scripted tumble ------------------------------------------------------------------
{
  const D = createDice({ physics: false });
  ok(await D.ready === 'scripted', 'without physics: scripted');
  let wrong = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rolls = [{ die: 20, value: seed }, { die: 6, value: 1 + seed % 6 }];
    let res = null;
    D.roll(rolls, { seed }).then(r => { res = r; });
    await settle(D, 1.3);
    if (D.topLabels().join() !== rolls.map(r => String(r.value)).join()) wrong++;
    await settle(D, 2.4);
    if (!res || res.some(r => r.mode !== 'scripted' || r.landed !== String(r.value))) wrong++;
  }
  ok(wrong === 0, `scripted tumble ends with the value on top (${wrong} wrong)`);
  const R = createDice({ physics: false, reduced: true });
  await R.ready;
  R.roll([{ die: 6, value: 4 }], { seed: 3 });
  R.update(0);
  ok(R.topLabels()[0] === '4', 'reduced motion: the die shows the value at once');
  D.dispose(); R.dispose();
}

// --- counter dice ------------------------------------------------------------------
{
  const D = createDice({ physics: false });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.784));
  card.rotation.x = -Math.PI / 2; card.position.set(1, 2, 1);
  const top = c => { const q = c.mesh.quaternion; const d = buildDie(c.type); return d.faces[readDie(d, [q.x, q.y, q.z, q.w]).face].label; };
  D.setCounters(7, { charge: 3 }, card); D.update(0.016);
  let c = D.counterDice(7);
  ok(c.length === 1 && c[0].type === 'd6' && top(c[0]) === '3', `a d6 shows 3 counters (${c.map(top)})`);
  ok(Math.abs(c[0].mesh.position.y - 2) < 0.4 && c[0].mesh.position.distanceTo(card.position) < 0.6, 'the counter die stands on the card');
  D.setCounters(7, { charge: 5 }, card);
  await settle(D, 0.8);
  c = D.counterDice(7);
  ok(top(c[0]) === '5', `the die turns to the new value (${top(c[0])})`);
  D.setCounters(7, { charge: 9, shield: 2 }, card);
  await settle(D, 0.8);
  c = D.counterDice(7);
  ok(c.length === 2 && c.find(x => x.kind === 'charge').type === 'd20' && top(c.find(x => x.kind === 'charge')) === '9' && top(c.find(x => x.kind === 'shield')) === '2', 'a d20 over 6, one die per kind');
  D.setCounters(7, null);
  ok(D.counterDice(7).length === 0 && D.stats().counters === 0, 'counters gone: dice gone');
  D.dispose();
}

// --- scene: roll and counter steps -------------------------------------------------------
{
  const rules = await import('../game/rules.js');
  const { createDuelScene } = await import('../ui/fly3d/scene.js');
  const { choreograph } = await import('../ui/fly3d/choreo.js');
  const sc = createDuelScene(null, { headless: true });
  await sc.ready;
  await sc.world.dice.ready;
  const s = rules.newGame({ seed: 5, first: 0 });
  sc.setState(s);
  // one record: a pass with two rolls (the engine value is the result)
  const legal = rules.legalActions(s);
  const act = legal.find(a => a.type === 'pass') || legal[0];
  const after = rules.step(s, act);
  const rec = { who: 0, before: s, after, action: act, trace: null, rolls: [{ die: 20, value: 17 }, { die: 6, value: 6 }] };
  const plan = choreograph(rec);
  ok(plan.steps.filter(x => x.op === 'roll').length === 2, 'choreo: two roll steps from record.rolls');
  let done = false, peak = 0, tops = null;
  sc.play(rec).then(() => { done = true; });
  for (let k = 0; k < 600 && !(done && !sc.world.dice.rolling); k++) {
    sc.render(1 / 30); await null;
    const t = sc.world.dice.stats().thrown;
    if (t > peak) peak = t;
    if (k === 100) tops = sc.world.dice.topLabels();
  }
  ok(peak === 2, `scene: two dice thrown on the mat (${peak})`);
  ok(tops && tops.includes('17') && tops.includes('6'), `scene: the engine values are on top (${tops})`);
  // a permanent with counters gets a counter die (setState and a step)
  const { CARD } = await import('../game/cards.js');
  const cid = Object.keys(CARD).find(id => CARD[id].type === 'creature' && !CARD[id].token);
  const s2 = rules.withPermanent(rules.newGame({ seed: 6, first: 0 }), 0, cid);
  const perm = s2.players[0].battlefield[s2.players[0].battlefield.length - 1];
  perm.counters = { charge: 4 };
  sc.setState(s2); sc.render(1 / 30);
  const cd = sc.world.dice.counterDice(perm.uid);
  ok(cd.length === 1 && cd[0].value === 4, `scene: a counter die shows the counters of a permanent (${JSON.stringify(cd.map(c => c.value))})`);
  const s3 = structuredClone(s2); s3.players[0].battlefield.find(x => x.uid === perm.uid).counters = null;
  sc.setState(s3); sc.render(1 / 30);
  ok(sc.world.dice.counterDice(perm.uid).length === 0, 'scene: no counters, no counter die');
  sc.dispose();
}

console.log(`fly3d-dice: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
