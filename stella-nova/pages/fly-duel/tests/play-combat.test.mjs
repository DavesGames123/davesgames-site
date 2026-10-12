// ============================================================================
//  FLY DUEL  ·  node tests for combat clicks in play mode
//  (node tests/play-combat.test.mjs)
// ----------------------------------------------------------------------------
//  User (2026-10-12, verbatim): "i shold actully have to click each
//  creature i' m in cobat with".
//
//    attack   ui/play/model.js: no attacker is chosen for you; each click
//             on your creature adds it or takes it off; the small button
//             is Undo (never "All"); the confirmed action is one of the
//             engine options of game/rules.js legalActions
//    block    click your untapped creature, then the attacker it blocks
//             (or the other way); blockTargets names what the next click
//             can pair; a click on an assigned blocker takes it off; the
//             confirmed action is an engine option
//    arrows   ui/fly3d/scene.js highlight({ blocks }) draws one arrow per
//             block, from the blocker toward the attacker; highlight(null)
//             takes them off
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

const rules = await import('../game/rules.js');
const { CARD } = await import('../game/cards.js');
const { createInteraction } = await import('../ui/play/model.js');
const { matchLegal } = await import('../train/human.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const engineHas = (s, a) => !!matchLegal(rules, rules.legalActions(s), a);

// ------------------------------------------------------------- attack
let s = rules.newGame({ seed: 3, first: 0 });
s = rules.withPermanent(s, 0, 'hive-soldier');
s = rules.withPermanent(s, 0, 'dune-wasp');
s = rules.withPermanent(s, 0, 'root-sentinel');
s = rules.withPermanent(s, 1, 'bark-toad');
s = rules.withPermanent(s, 1, 'drift-seed');
s = rules.step(s, { type: 'pass' });
ok(s.phase === 'attack', 'the state is in the attack step');
const [soldier, wasp] = s.players[0].battlefield.filter(x => CARD[x.id].type === 'creature').map(x => x.uid);
const ix = createInteraction({ rules, CARD, seat: 0 });
ix.sync(s);
let v = ix.view();
ok(v.mode === 'attack' && v.attackers.length === 0, 'no attacker is chosen for you');
ok(v.primary.label === 'No attack', `the confirm button says No attack with no clicks (${v.primary.label})`);
ok(v.secondary && v.secondary.kind === 'undo' && !/all/i.test(v.secondary.label), `the small button is Undo, not All (${v.secondary && v.secondary.label})`);
ix.secondary(); ix.secondary();
ok(ix.view().attackers.length === 0, 'the small button never selects every attacker');
ok(/click each creature/i.test(ix.view().prompt), `the prompt asks for a click per creature (${ix.view().prompt})`);
ix.perm(soldier);
ok(String(ix.view().attackers) === String([soldier]), 'one click: one attacker');
let a = ix.primary().commit;
ok(a && a.type === 'attack' && String(a.attackers) === String([soldier]) && engineHas(s, a), 'confirm sends that one attacker, an engine option');
ix.perm(soldier);
ok(ix.view().attackers.length === 0, 'a second click takes it off');
ix.perm(wasp); ix.perm(soldier);
a = ix.primary().commit;
ok(a && String(a.attackers) === String([soldier, wasp].sort((x, y) => x - y)) && engineHas(s, a), 'two clicks: both attack, an engine option');
ix.secondary();
ok(ix.view().attackers.length === 1, 'Undo takes back the last click');
ok(ix.perm(s.players[1].battlefield[0].uid).error, 'a click on a creature of the other fly is refused in the attack step');

// -------------------------------------------------------------- block
s = rules.step(s, { type: 'attack', attackers: [soldier, wasp] });
ok(s.phase === 'block' && s.toAct === 1, 'the state is in the block step of seat 1');
const [toad, seed] = s.players[1].battlefield.map(x => x.uid);
const ib = createInteraction({ rules, CARD, seat: 1 });
ib.sync(s);
v = ib.view();
ok(v.blocks.length === 0 && v.primary.label === 'No blocks' && v.secondary.kind === 'undo', 'no block is chosen for you');
ib.perm(toad);
v = ib.view();
ok(v.pendingBlocker === toad && String(v.blockTargets) === String([soldier]), `a waiting blocker names the attackers it can block (${v.blockTargets})`);
ok(/attacker it blocks/.test(v.prompt), 'the prompt asks for the attacker');
ib.perm(soldier);
v = ib.view();
ok(v.blocks.length === 1 && v.blocks[0][0] === soldier && v.blocks[0][1] === toad && v.blockTargets.length === 0, 'the click on the attacker makes the pair');
ib.perm(wasp);
v = ib.view();
ok(v.pendingAttacker === wasp && String(v.blockTargets) === String([seed]), `attacker first: blockTargets lists the blockers that can block it (${v.blockTargets})`);
ib.perm(seed);
let b = ib.primary().commit;
ok(b && b.type === 'block' && b.blocks.length === 2 && engineHas(s, b), 'confirm sends two blocks, an engine option');
ib.perm(toad);
ok(ib.view().blocks.length === 1, 'a click on an assigned blocker takes its block off');
b = ib.primary().commit;
ok(b && b.blocks.length === 1 && b.blocks[0][1] === seed && engineHas(s, b), 'confirm sends the one block left, an engine option');

// ------------------------------------------------------------- arrows
const THREE = await import('three');
const { createDuelScene } = await import('../ui/fly3d/scene.js');
const { FLY } = await import('../ui/tokens.js');
const canvas = { clientWidth: 960, clientHeight: 540, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) };
const sc = createDuelScene(canvas, { headless: true });
await sc.ready;
sc.setState(s);
sc.setFirstPerson(1);
for (let i = 0; i < 20; i++) sc.render(1 / 30);
ok(sc.stats().arrows === 0, 'no arrow with no blocks');
sc.highlight({ seat: 1, mode: 'block', eligible: [toad, seed], attackers: [], blocks: [[soldier, toad]], targets: [], pending: [] });
sc.render(1 / 30);
ok(sc.stats().arrows === 1, `one block: one arrow (${sc.stats().arrows})`);
const g = sc.world.arrows.children.find(x => x.visible);
const Z = sc.world.Z;
const from = Z.perms.get(toad).mesh.position, to = Z.perms.get(soldier).mesh.position;
const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
const want = to.clone().sub(from).setY(0).normalize();
ok(dir.setY(0).normalize().dot(want) > 0.98, 'the arrow points from the blocker to the attacker');
ok(g.position.distanceTo(from) < g.position.distanceTo(to), 'the arrow starts at the blocker');
ok('#' + g.children[0].material.color.getHexString() === FLY[1], 'the arrow has the colour of the blocker seat');
sc.highlight({ seat: 1, mode: 'block', eligible: [], attackers: [], blocks: [[soldier, toad], [wasp, seed]], targets: [], pending: [] });
sc.render(1 / 30);
ok(sc.stats().arrows === 2, 'two blocks: two arrows');
sc.highlight(null);
sc.render(1 / 30);
ok(sc.stats().arrows === 0, 'highlight(null) takes the arrows off');
sc.dispose();

console.log(`play-combat: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
