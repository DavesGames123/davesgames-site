// ============================================================================
//  FLY DUEL  ·  play mode checks  (node tests/play.test.mjs)
// ----------------------------------------------------------------------------
//  The play agent owns this file. No browser (user ban): it drives the
//  pure parts of play mode.
//      train/human.js         the human seat
//      ui/play/model.js       gestures -> actions
//      ui/play/controller.js  coin, mulligan, turn flow, fly decisions
//      ui/play/layout.js      breakpoints and the hand fan
//  Full games: a scripted human plays through the gesture model (select,
//  confirm, perm, player, primary) against the pretrained fly and against
//  greedyBot. Every legal action of many real states must come out of the
//  gesture model with the same key.
//
//  GREP MAP   (grep -n "^// ---" tests/play.test.mjs)
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const rules = await import('../game/rules.js');
const cards = await import('../game/cards.js');
const { CARD, DECKS } = cards;
const { greedyBot, randomBot } = await import('../game/bots.js');
const { mulberry32 } = await import('../data/rng.js');
const { createHuman, checkAction, matchLegal, scriptedHuman } = await import('../train/human.js');
const { createInteraction, paidLands, phaseSteps, whyNot, manaByColour, costParts } = await import('../ui/play/model.js');
const { createPlayController, flyKeeps, top3, deckColours } = await import('../ui/play/controller.js');
const { layoutFor, fanLayout, TOUCH } = await import('../ui/play/layout.js');
const { agentFromFly, agentFromBot } = await import('../ui/match.js');

const canon = a => a.type === 'attack' ? 'attack:' + a.attackers.slice().sort((x, y) => x - y).join(',')
  : a.type === 'block' ? 'block:' + a.blocks.slice().sort((p, q) => p[0] - q[0]).map(q => q[0] + '>' + q[1]).join(',')
    : rules.actionKey(a);

// The gestures that make one action, sent to a fresh interaction model.
function viaGestures(ix, state, seat, a) {
  ix.sync(state);
  const hand = state.players[seat].hand;
  let r;
  if (a.type === 'land' || a.type === 'cast') {
    ix.select(hand.indexOf(a.card));
    r = ix.confirm();
    if (a.target !== undefined) {
      ok(!r.commit && ix.mode() === 'target', `target mode for ${a.card}`);
      r = typeof a.target === 'string' ? ix.player(+a.target.slice(1)) : ix.perm(a.target);
    }
  } else if (a.type === 'pass') r = ix.primary();
  else if (a.type === 'attack') { for (const u of a.attackers) ix.perm(u); r = ix.primary(); }
  else if (a.type === 'block') { for (const [at, b] of a.blocks) { ix.perm(b); ix.perm(at); } r = ix.primary(); }
  return r && r.commit;
}

// --------------------------------------------------------------- 1 human seat
{
  const h = createHuman({ name: 'You', rules });
  const s = rules.newGame({ seed: 5, first: 0 });
  let threw = false;
  try { h.choose(s, rules.legalActions(s)); } catch { threw = true; }
  ok(threw, 'choose with an empty queue throws');
  ok(!h.submit({ type: 'attack', attackers: [] }, s).ok, 'an attack in main is refused');
  ok(!h.ready, 'a refused action is not queued');
  ok(h.submit({ type: 'pass' }, s).ok && h.ready, 'pass is queued');
  const legal = rules.legalActions(s);
  ok(h.choose(s, legal).action === legal.find(a => a.type === 'pass'), 'choose returns the object from legal[]');
  ok(!checkAction(rules, s, null).ok, 'checkAction refuses null');
  ok(matchLegal(rules, [{ type: 'attack', attackers: [3, 1] }], { type: 'attack', attackers: [1, 3] }) !== null, 'attack sets match in any order');
  const sh = scriptedHuman(rules, greedyBot(), 'S');
  ok(sh.decide(s).ok && sh.ready, 'scriptedHuman queues its bot action');
}

// --------------------------------------------------------------- 2 model basics
{
  let s = rules.newGame({ seed: 11, first: 0, decks: ['amber', 'moss'] });
  const ix = createInteraction({ rules, CARD, seat: 0, names: ['You', 'Fly B'] });
  ix.sync(s);
  let v = ix.view();
  ok(v.mode === 'main' && v.mine, 'seat 0 starts in main');
  ok(v.primary.kind === 'pass' && v.primary.label === 'End turn', 'no creatures: the button says End turn');
  ok(v.phase.steps[0].now && v.phase.yours, 'phase bar: Main is now, your turn');
  const li = s.players[0].hand.findIndex(id => CARD[id].type === 'land');
  ok(li >= 0, 'opening hand has a land (seed 11)');
  ix.select(li);
  v = ix.view();
  ok(v.selected === li && v.primary.kind === 'play' && /^Play /.test(v.primary.label), 'a selected land makes the button Play <name>');
  const r = ix.primary();
  ok(r.commit && r.commit.type === 'land', 'the button plays the land');
  s = rules.step(s, r.commit);
  ix.sync(s);
  ok(ix.view().selected === null, 'a new state drops the selection');
  const li2 = s.players[0].hand.findIndex(id => CARD[id].type === 'land');
  if (li2 >= 0) {
    ix.select(li2);
    ok(/one land per turn/.test(ix.view().prompt), 'second land: the prompt says one land per turn');
    ok(!ix.confirm().commit, 'second land cannot be played');
  }
  ok(ix.secondary().commit === null && ix.view().selected === null, 'secondary cancels the selection');
  ok(phaseSteps(s, 1).yours === false, 'phase bar of the other seat');
  ok(costParts({ generic: 2, amber: 1, moss: 0 }).map(q => q.join(':')).join(' ') === 'generic:2 amber:1', 'costParts order');
  ok(costParts({ generic: 0, amber: 1, tide: 2 }).length === 2, 'costParts reads a colour it does not know');
}

// --------------------------------------------------------------- 3 auto-tap preview
{
  let s = rules.newGame({ seed: 2, first: 0 });
  for (let i = 0; i < 3; i++) s = rules.withPermanent(s, 0, 'amber-ridge');
  s = { ...s, players: s.players.map((p, i) => i === 0 ? { ...p, hand: ['heat-pulse', 'ember-mantis', 'cinder-ant'] } : p) };
  const ix = createInteraction({ rules, CARD, seat: 0 });
  ix.sync(s);
  ix.select(1);
  const v = ix.view();
  ok(v.preview.length === 3, `Ember Mantis (cost 3) previews 3 paid lands (got ${v.preview.length})`);
  const cast = rules.legalActions(s).find(a => a.card === 'cinder-ant');
  ok(paidLands(rules, s, cast).length === 1, 'paidLands for a 1-cost card is 1');
  ix.select(1); ix.select(0);
  const r = ix.confirm();
  ok(!r.commit && ix.view().mode === 'target', 'Heat Pulse asks for a target');
  ok(ix.view().targetPlayers.includes(1), 'the opposing player is a target');
  ok(ix.player(0).commit === null, 'you are not a legal target of Heat Pulse');
  const r2 = ix.player(1);
  ok(r2.commit && r2.commit.target === 'p1', 'tapping the opponent sends the cast');
  ok(manaByColour(CARD, s.players[0])[0].total === 3, 'manaByColour counts lands');
  const duo = manaByColour({ d: { id: 'd', type: 'land', mana: ['dew', 'rot'] }, b: { id: 'b', type: 'land', mana: ['dew'] } },
    { battlefield: [{ id: 'd', tapped: false }, { id: 'b', tapped: true }, { id: 'd', tapped: true }] });
  ok(duo.length === 2 && duo[0].kind === 'dew/rot' && duo[0].up === 1 && duo[0].total === 2, 'a dual land is its own stack');
  ok(whyNot(rules, CARD, s, 0, 'magma-beetle', rules.legalActions(s)) !== '', 'whyNot names a reason');
}

// --------------------------------------------------------------- 4 attack and block with undo
{
  let s = rules.newGame({ seed: 3, first: 0 });
  s = rules.withPermanent(s, 0, 'hive-soldier');
  s = rules.withPermanent(s, 0, 'dune-wasp');
  s = rules.withPermanent(s, 0, 'root-sentinel');
  s = rules.withPermanent(s, 1, 'bark-toad');
  s = rules.withPermanent(s, 1, 'drift-seed');
  s = rules.step(s, { type: 'pass' });
  ok(s.phase === 'attack', 'pass goes to attack');
  const me = s.players[0].battlefield.filter(x => CARD[x.id].type === 'creature');
  const ix = createInteraction({ rules, CARD, seat: 0 });
  ix.sync(s);
  ok(ix.view().eligibleAttackers.length === 2, 'two can attack (the wall cannot)');
  ok(ix.perm(me[2].uid).error, 'a thick creature is refused with a reason');
  ix.perm(me[0].uid);
  ok(ix.view().primary.label === 'Attack with 1', 'Attack with 1');
  ix.allAttack();
  ok(ix.view().attackers.length === 2, 'All selects both');
  ix.undo();
  ok(ix.view().attackers.length === 1, 'undo takes back All');
  ix.perm(me[0].uid);
  ok(ix.view().primary.label === 'No attack', 'toggle off: No attack');
  ix.allAttack();
  const at = ix.primary().commit;
  ok(at && at.attackers.length === 2, 'attack with both');
  s = rules.step(s, at);
  ok(s.phase === 'block' && s.toAct === 1, 'block step for seat 1');
  const ib = createInteraction({ rules, CARD, seat: 1 });
  ib.sync(s);
  const [toad, seed] = s.players[1].battlefield.map(x => x.uid);
  const [soldier, wasp] = me.map(x => x.uid);
  ok(ib.perm(toad).commit === null && ib.view().pendingBlocker === toad, 'tap a blocker: it waits');
  ib.perm(soldier);
  ok(ib.view().blocks.length === 1, 'then tap the attacker: one block');
  ok(ib.assign(toad, wasp).error, 'a creature with no wings cannot block wings');
  ok(!ib.assign(seed, wasp).error, 'Drift Seed (wings) blocks the wasp');
  ok(ib.view().primary.label === 'Confirm 2 blocks', 'Confirm 2 blocks');
  ib.undo();
  ok(ib.view().blocks.length === 1, 'undo takes back a block');
  ib.perm(toad);
  ok(ib.view().blocks.length === 0, 'tap an assigned blocker: it comes off');
  ib.perm(soldier); ib.perm(toad);
  ok(ib.view().blocks.length === 1, 'attacker first, then blocker, also blocks');
  const bl = ib.primary().commit;
  ok(bl && checkAction(rules, s, bl).ok, 'the block action is legal');
}

// --------------------------------------------------------------- 5 every legal action is reachable
{
  const counts = {};
  let states = 0, checked = 0, bad = 0;
  for (let g = 0; g < 40; g++) {
    const rng = mulberry32(1000 + g);
    const bot = randomBot(rng);
    const decks = g % 2 ? ['amber', 'moss'] : ['moss', 'amber'];
    let s = rules.newGame({ seed: 77 + g, first: g & 1, decks });
    while (!rules.isOver(s)) {
      const legal = rules.legalActions(s);
      states++;
      for (const a of legal) {
        const ix = createInteraction({ rules, CARD, seat: s.toAct });
        const got = viaGestures(ix, s, s.toAct, a);
        checked++;
        counts[a.type] = (counts[a.type] || 0) + 1;
        if (!got || canon(got) !== canon(a)) { bad++; if (bad < 5) console.error('  unreachable', canon(a), '->', got && canon(got)); }
      }
      s = rules.step(s, bot(s, legal));
    }
  }
  // every deck of game/cards.js (five colours and the mixed decks, when
  // they exist): one game each, against the next deck in the menu order
  const ids = (cards.DECK_ORDER || Object.keys(DECKS)).filter(k => DECKS[k]);
  for (let d = 0; d < ids.length; d++) {
    const bot = randomBot(mulberry32(900 + d));
    let s = rules.newGame({ seed: 300 + d, first: d & 1, decks: [ids[d], ids[(d + 1) % ids.length]] });
    while (!rules.isOver(s)) {
      const legal = rules.legalActions(s);
      states++;
      for (const a of legal) {
        const got = viaGestures(createInteraction({ rules, CARD, seat: s.toAct }), s, s.toAct, a);
        checked++;
        counts[a.type] = (counts[a.type] || 0) + 1;
        if (!got || canon(got) !== canon(a)) { bad++; if (bad < 5) console.error('  unreachable', ids[d], canon(a), '->', got && canon(got)); }
      }
      s = rules.step(s, bot(s, legal));
    }
  }
  ok(bad === 0, `every legal action reachable by gestures (${checked} actions in ${states} states, ${ids.length} decks, ${bad} bad)`);
  for (const t of ['land', 'cast', 'pass', 'attack', 'block']) ok(counts[t] > 0, `action type ${t} was seen and checked`);
  const tgt = { player: 0, creature: 0 };
  // targeted casts in both target kinds were part of the check
  let s = rules.newGame({ seed: 4, first: 0 });
  for (let i = 0; i < 4; i++) s = rules.withPermanent(s, 0, 'amber-ridge');
  s = rules.withPermanent(s, 1, 'bark-toad');
  s = { ...s, players: s.players.map((p, i) => i === 0 ? { ...p, hand: ['kiln-burst'] } : p) };
  for (const a of rules.legalActions(s)) if (a.type === 'cast') typeof a.target === 'string' ? tgt.player++ : tgt.creature++;
  ok(tgt.player === 1 && tgt.creature === 1, 'Kiln Burst targets the player and the creature');
  for (const a of rules.legalActions(s)) ok(canon(viaGestures(createInteraction({ rules, CARD, seat: 0 }), s, 0, a)) === canon(a), `reach ${canon(a)}`);
}

// --------------------------------------------------------------- 6 controller: coin, mulligan, flow
{
  const opp = agentFromBot(greedyBot(), 'greedy bot');
  const pc = createPlayController({ rules, CARD, opponent: opp, humanSeat: 0, seed: 9, decks: ['amber', 'moss'] });
  ok(pc.need() === 'coin', 'starts at the coin');
  const c = pc.coin('heads');
  ok(c.first === 0 || c.first === 1, 'coin names a first seat');
  ok(pc.state.active === c.first, 'the coin winner goes first');
  const pc2 = createPlayController({ rules, CARD, opponent: agentFromBot(greedyBot(), 'g'), seed: 9, decks: ['amber', 'moss'] });
  ok(pc2.coin('heads').first === c.first, 'the coin is seeded');
  ok(pc.need() === 'mulligan', 'then the mulligan');
  const n0 = pc.state.players[0].hand.length;
  pc.mulligan();
  ok(pc.state.players[0].hand.length === n0 - 1, 'mulligan deals one card less');
  ok(pc.state.players[0].hand.length + pc.state.players[0].library.length === 40, 'mulligan keeps 40 cards');
  pc.mulligan(); pc.mulligan();
  ok(!pc.mulligan() && pc.state.players[0].hand.length === 4, 'three mulligans at most, floor 4');
  ok(pc.keep() && pc.need() !== 'mulligan', 'keep starts the game');
  ok(pc.state.log.some(l => /mulligan/.test(l)), 'the log names the mulligans');
  ok(flyKeeps(CARD, ['amber-ridge', 'amber-ridge', 'cinder-ant', 'cinder-ant', 'cinder-ant', 'cinder-ant', 'cinder-ant']), 'fly keeps 2 lands');
  ok(!flyKeeps(CARD, Array(7).fill('amber-ridge')), 'fly sends back 7 lands');
  ok(pc.submit({ type: 'attack', attackers: [] }).ok === false, 'a wrong action is refused');
  ok(deckColours(CARD, DECKS.amber).join() === 'amber', 'deckColours amber');
  ok(deckColours(CARD, { list: [['amber-ridge', 8], ['moss-hollow', 8]] }).join() === 'amber,moss', 'deckColours of a two-colour list');
}

// --------------------------------------------------------------- 7 full games, scripted human vs fly and vs greedy
let fly = null;
{
  const pre = existsSync(join(ROOT, 'data/pretrained.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8')) : null;
  try {
    const { Fly } = await import('../brain/fly.js');
    const file = pre?.wiring?.B?.file || 'data/connectome.json';
    const C = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
    fly = pre?.B ? Fly.fromJSON(C, pre.B) : new Fly(C, { name: 'Fly B', hemisphere: 'B' });
  } catch (e) { console.error('  fly did not load:', e.message); }
  ok(!!fly, 'the pretrained fly loads');

  const runGame = (oppAgent, seed, humanSeat, policy) => {
    const decks = seed % 2 ? ['amber', 'moss'] : ['moss', 'amber'];
    const pc = createPlayController({ rules, CARD, opponent: oppAgent, humanSeat, seed, decks });
    pc.coin(seed % 3 ? 'heads' : 'tails');
    pc.keep();
    const ix = createInteraction({ rules, CARD, seat: humanSeat });
    let guard = 0, human = 0, flyRecs = 0, topOk = true;
    while (pc.need() !== 'over' && guard++ < 3000) {
      if (pc.need() === 'human') {
        const s = pc.state;
        const want = policy(s, rules.legalActions(s));
        const act = viaGestures(ix, s, humanSeat, want);
        const r = pc.submit(act);
        if (!r.ok) { ok(false, `human action refused: ${r.error}`); break; }
        human++;
      } else {
        const rec = pc.flyStep();
        flyRecs++;
        if (oppAgent.kind === 'fly' && (!rec.top || !rec.top.length || rec.top.filter(t => t.chosen).length !== 1)) topOk = false;
      }
    }
    return { pc, human, flyRecs, topOk, guard };
  };

  const greedyPolicy = greedyBot();
  let finished = 0, wins = 0, total = 0, tops = true;
  if (fly) {
    for (let g = 0; g < 6; g++) {
      const r = runGame(agentFromFly(fly, 'Fly B'), 200 + g, g & 1, greedyPolicy);
      total++;
      if (r.pc.result) finished++;
      if (r.pc.result && r.pc.result.winner === (g & 1)) wins++;
      tops = tops && r.topOk;
      ok(r.human > 0 && r.flyRecs > 0, `game ${g}: both seats acted (${r.human} human, ${r.flyRecs} fly)`);
    }
    ok(finished === total, `scripted human vs pretrained fly: ${finished}/${total} games end`);
    ok(tops, 'every fly decision has a top-3 list with one chosen move');
    console.log(`  info: scripted greedy human won ${wins}/${total} against the pretrained fly`);
  }
  let fin2 = 0;
  for (let g = 0; g < 6; g++) {
    const rng = mulberry32(500 + g);
    const r = runGame(agentFromBot(greedyBot(), 'greedy bot'), 300 + g, g & 1, randomBot(rng));
    if (r.pc.result) fin2++;
  }
  ok(fin2 === 6, `scripted random human vs greedyBot: ${fin2}/6 games end`);
}

// --------------------------------------------------------------- 8 top3
{
  const rec = { legal: [{ type: 'pass' }, { type: 'land', card: 'amber-ridge' }, { type: 'land', card: 'moss-hollow' }, { type: 'pass' }],
    scores: [0.1, 0.5, -0.2, 0.3], idx: 2, before: rules.newGame({ seed: 1 }) };
  const t = top3(rules, rec);
  ok(t.length === 3 && t[0].i === 1 && t[1].i === 3, 'top3 sorts by score');
  ok(t[2].i === 2 && t[2].chosen, 'top3 keeps the chosen move when it is not in the best three');
  ok(top3(rules, { legal: [{ type: 'pass' }] }).length === 0, 'top3 of a bot record is empty');
}

// --------------------------------------------------------------- 9 layout breakpoints and the fan
{
  const p = layoutFor(390, 844, { coarse: true });
  ok(p.kind === 'phone' && p.score === 'compact', '390 x 844 is phone, compact scorecards');
  ok(p.target >= TOUCH && p.button.h >= 44, 'phone targets are 44 px or more');
  ok(p.hand.w >= 80 && p.hand.w <= 108, `phone hand card width ${p.hand.w}`);
  ok(layoutFor(844, 390, { coarse: true }).kind === 'phone-land', '844 x 390 coarse is phone-land');
  ok(layoutFor(768, 1024, { coarse: true }).kind === 'tablet', '768 is tablet');
  ok(layoutFor(1440, 900).kind === 'desktop' && layoutFor(1440, 900).hover, '1440 is desktop with hover');
  ok(layoutFor(320, 568, { coarse: true }).zoom.w <= 320 - 16 + 1 || layoutFor(320, 568).zoom.w === 220, 'zoom fits a small phone');
  for (const n of [1, 5, 7, 10]) {
    const f = fanLayout(n, { width: 390, cardW: p.hand.w });
    ok(f.cards.length === n, `fan of ${n}`);
    const right = f.cards[n - 1].x + p.hand.w;
    ok(f.scroll || right <= 390, `fan of ${n} fits 390 px or scrolls (right edge ${right})`);
    for (let i = 1; i < n; i++) ok(f.cards[i].x - f.cards[i - 1].x >= p.hand.w * 0.42 - 1, `fan of ${n}: card ${i} shows at least 42%`);
  }
  ok(fanLayout(12, { width: 390, cardW: 98 }).scroll, 'twelve cards on a phone scroll');
  const s = fanLayout(5, { width: 800, cardW: 120, selected: 2 });
  ok(s.cards[2].y < 0 && s.cards[2].rot === 0, 'the selected card rises and stands straight');
  ok(s.cards[0].rot < 0 && s.cards[4].rot > 0, 'the fan turns out from the centre');
}

// --------------------------------------------------------------- 10 IP and look greps on play files
{
  const files = ['ui/play/model.js', 'ui/play/controller.js', 'ui/play/layout.js', 'train/human.js']
    .concat(['ui/play/play.js', 'ui/play/hand.js', 'ui/play/board2d.js', 'ui/play/inspector.js', 'ui/play/play.css', 'ui/play/dev.html'].filter(f => existsSync(join(ROOT, f))));
  for (const f of files) {
    const t = readFileSync(join(ROOT, f), 'utf8');
    ok(!/Beleren|MPlantin|Matrix Bold|Planeswalker/.test(t), `${f}: no WotC fonts or names`);
    ok(t.split('\n').every(l => !/Wizards of the Coast/.test(l) || /[Nn]ot affiliated/.test(l)), `${f}: WotC named only in the not-affiliated line`);
    ok(!/shadowBlur|filter:\s*blur|text-shadow|backdrop-filter/.test(t), `${f}: no soft glow`);
    ok(!/box-shadow:[^;]*\d+px\s+\d+px\s+[1-9]/.test(t), `${f}: box-shadow only as a hard ring`);
  }
  if (existsSync(join(ROOT, 'ui/play/play.css'))) ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(readFileSync(join(ROOT, 'ui/play/play.css'), 'utf8')), 'play.css has the [hidden] rule');
}

// --------------------------------------------------------------- 11 the DOM screen, end to end (linkedom, optional)
// mountPlay() on a linkedom document: real DOM events on the hand cards,
// the creatures, the life dice and the big button play whole games
// against the pretrained flies. linkedom has no layout and no canvas, so
// this checks the wiring, not the look. It is skipped when linkedom is
// not installed (it is not a page dependency).
{
  const { createRequire } = await import('node:module');
  let parseHTML = null;
  for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
    try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
  }
  if (!parseHTML || !fly) console.log('  skip: DOM end-to-end (linkedom or the fly is missing)');
  else {
    const { window, document } = parseHTML('<!doctype html><html><body><main id="play"></main></body></html>');
    globalThis.window = window; globalThis.document = document;
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (f) => realST(f, 0);          // no waits: pauses are for people
    const errs = [];
    const ow = console.warn, oe = console.error;
    console.warn = (...a) => errs.push(a.join(' '));
    console.error = (...a) => errs.push(a.join(' '));
    const bots = await import('../game/bots.js');
    const { Fly } = await import('../brain/fly.js');
    const pre = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8'));
    const cons = {}, flies = {};
    for (const side of ['A', 'B']) {
      cons[side] = JSON.parse(readFileSync(join(ROOT, pre.wiring?.[side]?.file || 'data/connectome.json'), 'utf8'));
      flies[side] = Fly.fromJSON(cons[side], pre[side]);
    }
    const { mountPlay } = await import('../ui/play/play.js');
    const wait = ms => new Promise(r => realST(r, ms));
    const ev = (el, type) => { const e = new window.Event(type, { bubbles: true }); Object.assign(e, { clientX: 0, clientY: 0, button: 0, pointerId: 1, pointerType: 'touch', detail: 1 }); el.dispatchEvent(e); };
    const tap = el => { ev(el, 'pointerdown'); ev(el, 'pointerup'); };
    for (const [opp, seed] of [['A', 41], ['B', 42], ['bot', 43]]) {
      const root = document.getElementById('play');
      const P = mountPlay(root, { rules, cards, bots, flies, connectomes: cons, sources: { A: 'hemibrain', B: 'FlyWire' }, seed });
      const q = s => root.querySelector(s);
      ev(q(`.pl-seg[data-k="opp"] button[data-v="${opp}"]`), 'click');
      ev(q('.pl-go'), 'click');
      ev(q('[data-call="tails"]'), 'click');
      await wait(2);
      ev(q('.pl-go'), 'click');
      ev(q('[data-keep]'), 'click');
      const pc = P.controller, hs = pc.humanSeat;
      const bot = greedyBot();
      let steps = 0, bad = '', guard = 0;
      const seen = new Set();
      while (pc.need() !== 'over' && guard++ < 6000 && !bad) {
        await wait(1);
        if (pc.need() !== 'human' || P.busy) continue;
        const s = pc.state, n0 = pc.history.length;
        const a = bot(s, rules.legalActions(s));
        seen.add(a.type);
        const handEls = [...root.querySelectorAll('.pl-hc')].filter(e => !e.hidden);
        const perm = u => q(`.pl-perm[data-uid="${u}"]`);
        if (a.type === 'land' || a.type === 'cast') {
          const i = s.players[hs].hand.indexOf(a.card);
          tap(handEls[i]); tap(handEls[i]);
          if (a.target !== undefined) typeof a.target === 'string' ? ev(q(`.pl-sc${+a.target.slice(1)} .hd-life`), 'click') : tap(perm(a.target));
        } else if (a.type === 'pass') ev(q('.pl-pri'), 'click');
        else if (a.type === 'attack') { for (const u of a.attackers) tap(perm(u)); ev(q('.pl-pri'), 'click'); }
        else { for (const [at, b] of a.blocks) { tap(perm(b)); tap(perm(at)); } ev(q('.pl-pri'), 'click'); }
        for (let k = 0; k < 100 && pc.history.length === n0; k++) await wait(1);
        const rec = pc.history[n0];
        if (!rec || rec.who !== hs || canon(rec.action) !== canon(a)) bad = `${canon(a)} -> ${rec ? canon(rec.action) : 'nothing'} (${q('.pl-prompt').textContent})`;
        steps++;
      }
      await wait(5);
      ok(!bad, `DOM game vs ${opp}: every human action went through the screen${bad ? ': ' + bad : ''}`);
      console.log(`  info: DOM game vs ${opp}: ${steps} human actions, types ${[...seen].join(",")}, result ${JSON.stringify(pc.result)}`);
      ok(!!pc.result, `DOM game vs ${opp} ends (${steps} human actions, types ${[...seen].join(',')}, result ${JSON.stringify(pc.result)})`);
      ok(!q('.pl-sheet').hidden && /win|Draw/.test(q('.pl-sheet h2').textContent), 'the result sheet shows');
      ok(q(`.pl-sc${hs} .hd-name`).textContent === 'You', 'your scorecard says You');
      if (opp !== 'bot') ok(q(`.pl-sc${pc.flySeat} .hd-top`).children.length >= 1 && /V [+−]/.test(q(`.pl-sc${pc.flySeat} .hd-vd`).textContent), 'the fly card shows its moves and its value');
      ok((opp === 'A') === (hs === 1), 'against Fly A you sit right (seat 1); else left');
      P.destroy();
    }
    // The same game on a stub 3D table: every table gesture is a click on
    // .pl-table, and pickPermanent() answers with the permanent, or with
    // { uid: null, player } for a tap on a fly or its life die (the shape
    // of ui/fly3d/scene.js). A player target must work from the table.
    {
      let pick = null;
      const scene = {
        pickPermanent: () => pick, setFirstPerson() {}, highlight() {}, setState() {}, setSpeed() {}, resize() {},
        play: () => Promise.resolve(),
      };
      const root = document.getElementById('play');
      const P = mountPlay(root, { rules, cards, bots, flies, connectomes: cons, sources: { A: 'hemibrain', B: 'FlyWire' }, seed: 44, scene, sceneEl: document.createElement('canvas') });
      const q = s => root.querySelector(s);
      const table = q('.pl-table');
      const tapTable = hit => { pick = hit; ev(table, 'click'); pick = null; };
      ev(q('.pl-seg[data-k="opp"] button[data-v="bot"]'), 'click');
      ev(q('.pl-go'), 'click');
      ev(q('[data-call="heads"]'), 'click');
      await wait(2);
      ev(q('.pl-go'), 'click');
      ev(q('[data-keep]'), 'click');
      const pc = P.controller, hs = pc.humanSeat;
      const bot = greedyBot();
      let bad = '', guard = 0, playerTargets = 0, previews = 0, noPreview = 0;
      while (pc.need() !== 'over' && guard++ < 6000 && !bad) {
        await wait(1);
        if (pc.need() !== 'human' || P.busy) continue;
        const s = pc.state, n0 = pc.history.length;
        const legal = rules.legalActions(s);
        // prefer a cast at a player, so the table path for players runs
        const a = legal.find(x => x.type === 'cast' && typeof x.target === 'string') || bot(s, legal);
        const handEls = [...root.querySelectorAll('.pl-hc')].filter(e => !e.hidden);
        if (a.type === 'land' || a.type === 'cast') {
          const i = s.players[hs].hand.indexOf(a.card);
          tap(handEls[i]);
          // the auto-tap preview shows on your scorecard before you cast
          if (a.type === 'cast') { previews++; if (!/class="up pay"/.test(q(`.pl-sc${hs} .hd-mana`).innerHTML)) noPreview++; }
          tap(handEls[i]);
          if (a.target !== undefined) {
            if (typeof a.target === 'string') { playerTargets++; tapTable({ uid: null, player: +a.target.slice(1) }); } else tapTable({ uid: a.target });
          }
        } else if (a.type === 'pass') ev(q('.pl-pri'), 'click');
        else if (a.type === 'attack') { for (const u of a.attackers) tapTable({ uid: u }); ev(q('.pl-pri'), 'click'); }
        else { for (const [at, b] of a.blocks) { tapTable({ uid: b }); tapTable({ uid: at }); } ev(q('.pl-pri'), 'click'); }
        for (let k = 0; k < 100 && pc.history.length === n0; k++) await wait(1);
        const rec = pc.history[n0];
        if (!rec || rec.who !== hs || canon(rec.action) !== canon(a)) bad = `${canon(a)} -> ${rec ? canon(rec.action) : 'nothing'} (${q('.pl-prompt').textContent})`;
      }
      await wait(5);
      ok(!bad, `3D table game: every human action went through table taps${bad ? ': ' + bad : ''}`);
      ok(playerTargets > 0, `3D table game: a tap on a fly or its life die targets that player (${playerTargets} times)`);
      ok(!!pc.result, `3D table game ends (${JSON.stringify(pc.result)})`);
      ok(previews > 0 && noPreview === 0, `3D table game: your scorecard marks the lands to pay for each selected cast (${previews - noPreview} of ${previews})`);
      P.destroy();
    }
    console.warn = ow; console.error = oe;
    globalThis.setTimeout = realST;
    ok(errs.length === 0, `no console error or warn in DOM games (${errs.slice(0, 3).join(' | ')})`);
  }
}

console.log(`play: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
