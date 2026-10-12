// ============================================================================
//  FLY DUEL  ·  node tests for the Cancel control of play mode
//  (node tests/play-cancel.test.mjs)
// ----------------------------------------------------------------------------
//  The 1600x900 capture of 2026-10-12 (play, a target for Dawn Blessing)
//  showed two Cancel buttons at once: the small button and the big dock
//  button. ui/play/model.js view() gives the labels of both buttons.
//
//    target   choosing a target: one Cancel (the big button), no small
//             button; the big button and secondary() both cancel
//    main     a selected card: the big button casts it, the small button
//             is the one Cancel
//    combat   the small button is Undo
//  Exit code 1 on any failure.
// ============================================================================
const rules = await import('../game/rules.js');
const { CARD } = await import('../game/cards.js');
const { createInteraction } = await import('../ui/play/model.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const cancels = v => [v.primary, v.secondary].filter(b => b && /cancel/i.test(b.label)).length;

let s = rules.newGame({ seed: 2, first: 0 });
for (let i = 0; i < 3; i++) s = rules.withPermanent(s, 0, 'amber-ridge');
s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, hand: ['heat-pulse', 'ember-mantis', 'cinder-ant'] } : p)) };

// main: a selected card
{
  const ix = createInteraction({ rules, CARD, seat: 0 });
  ix.sync(s);
  ix.select(0);
  const v = ix.view();
  ok(v.mode === 'main' && /^Cast /.test(v.primary.label), `main: the big button casts the selected card (${v.primary.label})`);
  ok(cancels(v) === 1 && v.secondary?.kind === 'cancel', `main: one Cancel, the small button (${cancels(v)})`);
}

// target: Heat Pulse asks for a target
{
  const ix = createInteraction({ rules, CARD, seat: 0 });
  ix.sync(s);
  ix.select(0);
  const r = ix.confirm();
  const v = ix.view();
  ok(!r.commit && v.mode === 'target', 'target: Heat Pulse asks for a target');
  ok(cancels(v) === 1, `target: one Cancel control shows (${cancels(v)}: big "${v.primary?.label}", small "${v.secondary?.label ?? 'none'}")`);
  ok(v.primary.kind === 'cancel' && v.secondary == null, 'target: the big button is Cancel and there is no small button');
  ix.primary();
  ok(ix.view().mode === 'main', 'target: the big button cancels the target choice (the card stays selected)');
  ix.confirm();
  ok(ix.view().mode === 'target', 'target: again');
  ix.secondary();
  ok(ix.view().mode === 'main', 'target: secondary() (Escape) still cancels');
}

// combat: the small button is Undo, no Cancel
{
  let c = rules.newGame({ seed: 3, first: 0 });
  c = rules.withPermanent(c, 0, 'hive-soldier');
  c = rules.step(c, { type: 'pass' });
  const ix = createInteraction({ rules, CARD, seat: 0 });
  ix.sync(c);
  const v = ix.view();
  ok(v.mode === 'attack' && v.secondary?.kind === 'undo' && cancels(v) === 0, `combat: the small button is Undo (${v.secondary?.label}), no Cancel`);
}

console.log(`play-cancel: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
