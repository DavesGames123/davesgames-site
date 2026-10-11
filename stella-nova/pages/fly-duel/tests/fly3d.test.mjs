// ============================================================================
//  FLY DUEL  ·  node tests for the 3D table  (node tests/fly3d.test.mjs)
// ----------------------------------------------------------------------------
//  Checks ui/fly3d/choreo.js and ui/fly3d/scene.js without a browser.
//  three.js runs in node without a renderer: the test builds the scene
//  graph, plays whole matches through it and counts meshes and triangles.
//
//    choreo   whole bot games: after the steps of each record the mirror
//             equals mirrorOf(record.after) (no fallback steps), steps are
//             sorted, every cast taps exactly its cost (amber, moss and
//             generic shares), each op kind occurs, reduced motion cuts
//             every move and keeps the timing.
//    scene    headless build, the card objects follow the mirror after
//             every record, the triangle budget (desktop < 400k, phone
//             < 150k), no warning, the stand-in fly runs every clip, the
//             real fly.js is used when it is there.
//  Exit code 1 on any failure.
//
//  GREP MAP   (grep -n "^// ---" tests/fly3d.test.mjs)
// ============================================================================
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

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
const { CARD } = await import('../game/cards.js');
const { randomBot, greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { choreograph, mirrorOf, applyStep, mirrorDiff, TIMING, MOVE_OPS } = await import('../ui/fly3d/choreo.js');
const { createDuelScene, TABLE, PLACEHOLDER_FLY } = await import('../ui/fly3d/scene.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
function rngf(s) { let a = s >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function botMatch(seed) {
  const mk = i => ((seed + i) % 3 === 0 ? agentFromBot(randomBot(rngf(seed * 7 + i)), 'random') : agentFromBot(greedyBot(), 'greedy'));
  return new Match(rules, [mk(0), mk(1)], { seed });
}
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.map(String).join(' ')); };

// --- choreo: whole games ------------------------------------------------------
{
  const ops = {};
  let recs = 0, drift = 0, fallback = 0, unsorted = 0, badCost = 0, badDur = 0, landsOk = 0, reducedBad = 0;
  for (let g = 1; g <= 50; g++) {
    const M = botMatch(g);
    let r;
    while ((r = M.next())) {
      recs++;
      const c = choreograph(r);
      for (const s of c.steps) ops[s.op] = (ops[s.op] || 0) + 1;
      const d = mirrorDiff(c.mirror, mirrorOf(r.after));
      if (d.length) { drift++; if (drift < 4) console.error('drift', g, r.i, r.text, d); }
      if (c.steps.some(s => s.fallback)) fallback++;
      for (let i = 1; i < c.steps.length; i++) if (c.steps[i].at < c.steps[i - 1].at) { unsorted++; break; }
      if (c.steps.some(s => !(s.dur >= 0) || !(s.at >= 0) || s.at + s.dur > c.total + 1e-9)) badDur++;
      // replay the steps on a fresh mirror: same end state
      const m2 = mirrorOf(r.before);
      for (const s of c.steps) applyStep(m2, s);
      if (mirrorDiff(m2, mirrorOf(r.after)).length) drift++;
      if (r.action.type === 'cast') {
        const card = CARD[r.action.card], taps = c.steps.filter(s => s.op === 'tap');
        const n = k => taps.filter(s => s.pays === k).length;
        if (taps.length !== card.cost.generic + card.cost.amber + card.cost.moss || n('amber') !== card.cost.amber
          || n('moss') !== card.cost.moss || n('generic') !== card.cost.generic) badCost++;
        if (taps.some(s => s.colour !== CARD[r.before.players[r.who].battlefield.find(x => x.uid === s.uid).id].produces)) badCost++;
      }
      if (r.action.type === 'land') {
        const ls = c.steps.filter(s => s.op === 'lift' || s.op === 'land');
        if (ls.length === 2 && ls[1].uid > 0) landsOk++;
      }
      if (recs % 7 === 0) {
        const red = choreograph(r, { reduced: true });
        if (red.steps.length !== c.steps.length || red.steps.some((s, i) => s.at !== c.steps[i].at || (MOVE_OPS.has(s.op) ? s.dur !== 0 : s.dur !== c.steps[i].dur))) reducedBad++;
      }
    }
  }
  ok(recs > 2000, `played ${recs} records`);
  ok(drift === 0, `mirror equals record.after for every record (drift ${drift})`);
  ok(fallback === 0, `no fallback steps (${fallback})`);
  ok(unsorted === 0, 'steps sorted by time');
  ok(badDur === 0, 'every step inside total, no negative time');
  ok(badCost === 0, `each cast taps its cost, colour by colour (${badCost} bad)`);
  ok(landsOk === (ops.land || 0) && landsOk > 0, 'each land play lifts and lays a land with its uid');
  ok(reducedBad === 0, 'reduced motion: moves cut to 0 s, timing kept');
  for (const op of ['think', 'lift', 'land', 'tap', 'cast', 'reveal', 'spark', 'hurt', 'token', 'draw', 'spent', 'attack',
    'block', 'strike', 'life', 'die', 'settle', 'discard', 'endturn', 'turn', 'untap', 'pass', 'win', 'sync']) {
    ok((ops[op] || 0) > 0, `op ${op} occurs (${ops[op] || 0})`);
  }
  ok(Object.keys(TIMING).length > 20, 'TIMING table');
}

// --- choreo: one hand-made record ---------------------------------------------
{
  // Fly A has three amber lands and casts a 1+amber creature: two taps,
  // one amber and one generic, then the creature enters.
  let s = rules.newGame({ seed: 9, first: 0 });
  for (let i = 0; i < 3; i++) s = rules.withPermanent(s, 0, 'amber-ridge');
  s.players[0].hand = ['hive-soldier', ...s.players[0].hand.slice(1)];
  const a = { type: 'cast', card: 'hive-soldier' };
  const after = rules.step(s, a);
  const c = choreograph({ who: 0, before: s, after, action: a, trace: null });
  const taps = c.steps.filter(x => x.op === 'tap');
  ok(taps.length === 2 && taps[0].pays === 'amber' && taps[1].pays === 'generic', 'hive soldier: amber then generic tap');
  ok(c.steps.findIndex(x => x.op === 'lift') < c.steps.findIndex(x => x.op === 'tap'), 'the card is lifted before the lands tap');
  ok(c.steps.some(x => x.op === 'cast' && x.uid === after.players[0].battlefield.at(-1).uid), 'cast names the new uid');
  ok(mirrorDiff(c.mirror, mirrorOf(after)).length === 0, 'hand-made cast: mirror ok');
}

// --- scene: headless build and whole matches ----------------------------------
const C = existsSync(new URL('../data/connectome.json', import.meta.url)) ? JSON.parse(readFileSync(new URL('../data/connectome.json', import.meta.url), 'utf8')) : null;
// Every card object stays above the table top band (no card starts at
// the world origin or falls through the table) and has finite numbers.
let badPos = 0;
function posCheck(sc) {
  const Z = sc.world.Z;
  const all = [...Z.hand[0], ...Z.hand[1], ...Z.grave[0], ...Z.grave[1], ...Z.perms.values(), ...Z.held.filter(Boolean)];
  for (const o of all) {
    const p = o.mesh.position;
    if (!Number.isFinite(p.x + p.y + p.z) || p.y < TABLE.y - 0.05) { badPos++; if (badPos < 4) console.error('card below the table', o.id, p.toArray()); }
  }
}
async function runGame(sc, M, check) {
  sc.setState(M.state);
  sc.setSpeed(8);
  let r, n = 0, stuck = 0, maxTris = 0;
  while ((r = M.next())) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let k = 0; k < 5000 && !done; k++) { sc.render(0.1); await null; if (k % 3 === 0) posCheck(sc); }
    if (!done) stuck++;
    n++;
    const st = sc.stats();
    maxTris = Math.max(maxTris, st.tris);
    check(st, sc.world.mirror, r);
  }
  return { n, stuck, maxTris };
}
{
  const sc = createDuelScene(null, { headless: true, connectomes: C ? [C, C] : null });
  const info = await sc.ready;
  const hasFly = existsSync(new URL('../ui/fly3d/fly.js', import.meta.url));
  ok(info.fly === (hasFly ? 'fly.js' : 'placeholder'), `fly module in use: ${info.fly}`);
  if (C && existsSync(new URL('../ui/fly3d/brain3d.js', import.meta.url))) ok(info.brain === true, 'brain maps built from the connectome');
  ok(sc.scene.getObjectByName('table') && sc.scene.getObjectByName('room') && sc.scene.getObjectByName('cards'), 'table, room and card groups');
  let zoneBad = 0, pipBad = 0;
  const check = (st, m) => {
    const handOk = st.hand[0] === m.players[0].hand.length && st.hand[1] === m.players[1].hand.length;
    const graveOk = st.grave[0] === m.players[0].graveyard.length && st.grave[1] === m.players[1].graveyard.length;
    const permOk = st.perms === m.players[0].battlefield.length + m.players[1].battlefield.length;
    if (!(handOk && graveOk && permOk)) zoneBad++;
    const untapped = m.players.reduce((n, p) => n + p.battlefield.filter(x => !x.tapped && CARD[x.id].type === 'land').length, 0);
    if (st.pips !== untapped) pipBad++;
  };
  let total = 0, maxTris = 0;
  for (const seed of [5, 12]) {
    const res = await runGame(sc, botMatch(seed), check);
    ok(res.stuck === 0, `seed ${seed}: every record finishes`);
    total += res.n; maxTris = Math.max(maxTris, res.maxTris);
  }
  ok(total > 60, `scene played ${total} records`);
  ok(zoneBad === 0, `card objects follow the mirror (hand, graveyard, battlefield) (${zoneBad} bad)`);
  ok(pipBad === 0, `one mana pip per untapped land (${pipBad} bad)`);
  ok(maxTris < 400000, `desktop triangles ${maxTris} < 400k`);
  ok(badPos === 0, `cards stay on or above the table top (${badPos} bad samples)`);
  const st = sc.stats();
  ok(st.meshes > 100, `meshes ${st.meshes}`);
  sc.dispose();
}
{
  const sc = createDuelScene(null, { headless: true, coarse: true, connectomes: C ? [C, C] : null });
  await sc.ready;
  const res = await runGame(sc, botMatch(21), () => {});
  ok(res.maxTris < 150000, `phone triangles ${res.maxTris} < 150k`);
  ok(sc.world.lights.key.castShadow === false, 'phone: no shadow light');
  sc.dispose();
}
{
  // reduced motion: the same match plays to the end
  const sc = createDuelScene(null, { headless: true, reduced: true });
  await sc.ready;
  const res = await runGame(sc, botMatch(33), () => {});
  ok(res.stuck === 0 && res.n > 10, 'reduced motion: a whole match plays');
  sc.dispose();
}

// --- scene: real frame rate around a token and a death -----------------------
{
  // Find a game with a token step, then play it at speed 2 and 30 frames a
  // second up to two records past the token, with the position check on
  // every frame.
  let seed = 0, upTo = -1;
  for (let g = 1; g < 60 && upTo < 0; g++) {
    const M = botMatch(g); let r;
    while ((r = M.next())) if (choreograph(r).steps.some(x => x.op === 'token')) { seed = g; upTo = r.i + 2; break; }
  }
  ok(upTo > 0, `a game with a token (seed ${seed})`);
  const sc = createDuelScene(null, { headless: true });
  await sc.ready;
  const M = botMatch(seed);
  sc.setState(M.state); sc.setSpeed(2);
  const before = badPos, clips = {};
  let r;
  while ((r = M.next()) && r.i <= upTo) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let k = 0; k < 20000 && !done; k++) {
      sc.render(1 / 30); await null; posCheck(sc);
      for (const f of sc.world.flies) clips[f.spec.name] = (clips[f.spec.name] || 0) + 1;
    }
  }
  for (const c of ['idle', 'think', 'reach', 'place', 'tap', 'groom']) ok(clips[c] > 0, `fly clip ${c} plays (${clips[c] || 0} frames)`);
  ok(badPos === before, `30 fps play: cards stay on or above the table top (${badPos - before} bad samples)`);
  sc.dispose();
}

// --- stand-in fly ---------------------------------------------------------------
{
  const { root, rig, dispose } = PLACEHOLDER_FLY.buildFly({ colour: '#39d0f0', seed: 1 });
  const g = new THREE.Group(); g.add(root); g.updateMatrixWorld(true);
  let finite = true;
  for (const c of ['idle', 'think', 'groom', 'reach', 'place', 'tap', 'push', 'raiseArms', 'slump']) {
    for (const t of [0, 0.3, 0.9, 2]) {
      PLACEHOLDER_FLY.animate(rig, { name: c, target: new THREE.Vector3(0.3, 0.6, 1.2) }, t, { time: t, hand: new THREE.Vector3(0, 1.2, 0.8) });
      root.updateMatrixWorld(true);
      root.traverse(o => { if (o.isMesh && !o.matrixWorld.elements.every(Number.isFinite)) finite = false; });
    }
  }
  ok(finite, 'stand-in fly: every clip gives finite poses');
  ok(rig.legs.length === 6 && rig.wings.length === 2 && rig.antennae.length === 2, 'stand-in rig: 6 legs, 2 wings, 2 antennae');
  dispose();
}

// --- layout numbers ---------------------------------------------------------------
{
  const inTable = (u, v) => Math.hypot(u, v) < TABLE.felt;
  ok(inTable(TABLE.rowHalf + TABLE.cardW / 2, TABLE.landV + TABLE.cardH / 2), 'land row on the felt');
  ok(inTable(TABLE.deckU + TABLE.cardW / 2, TABLE.deckV + TABLE.cardH / 2), 'library on the felt');
  ok(inTable(TABLE.graveU + TABLE.cardW / 2, TABLE.graveV + TABLE.cardH / 2), 'graveyard on the felt');
  ok(inTable(Math.abs(TABLE.lifeU) + 0.36, TABLE.lifeV + 0.36), 'life drum on the felt');
  ok(Math.abs(TABLE.lifeU) - 0.36 > TABLE.rowHalf + TABLE.cardW / 2, 'life drum clear of the land row');
  ok(TABLE.graveU - TABLE.cardW / 2 > TABLE.rowHalf + TABLE.cardW / 2 - 0.01, 'graveyard clear of the creature row');
  ok(TABLE.seatV - 0.78 < TABLE.r && TABLE.seatV > TABLE.r + 0.3, 'stools tuck under the table edge');
}

console.warn = realWarn;
ok(warns.length === 0, `no warnings (${warns.length}) ${warns.slice(0, 3).join(' | ')}`);
console.log(`fly3d: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
