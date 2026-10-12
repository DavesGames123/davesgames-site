// ============================================================================
//  FLY DUEL  ·  play mode, the gesture model  (ES module, no DOM, pure)
// ----------------------------------------------------------------------------
//  The human seat turns taps, drags and keys into one game action. This
//  file holds all of that logic, with no DOM, so node tests can drive it.
//  The DOM layers (ui/play/hand.js, board2d.js, play.js, and the 3D table
//  when it gives pick functions) only send gestures here and draw view().
//
//  GESTURES  (each returns { commit: action | null, error?: string })
//      select(i)      tap a hand card: it rises and shows its paid lands
//      play(i)        drag a hand card up, or tap the selected card again
//      confirm()      play the selected card
//      perm(uid)      tap a permanent (target, attacker, blocker)
//      player(p)      tap a player (scorecard or life die) as a target
//      primary()      the big button: the label is in view().primary
//      secondary()    the small button beside it (All / Cancel / Undo)
//      undo()         take back one attack or block change (not sent yet)
//      cancel()       drop the selected card or the target choice
//      allAttack()    every creature that can attack
//      assign(b, a)   block attacker a with blocker b (drag b onto a)
//
//  MODES  (view().mode)
//      wait     the fly acts            main     your main phase
//      target   choose a target         attack   declare attackers
//      block    declare blockers        over     the game is over
//
//  An action is sent only by commit. Attack and block maps stay local
//  until the primary button confirms them, so undo() can take them back.
//  Mana: the rules engine taps lands itself (auto-tap). paidLands() steps
//  the action and lists the lands that changed to tapped, so the UI shows
//  the true lands, not a guess.
//
//  Colours are read from the cards (cost keys and land `produces`), not
//  from a fixed list, so decks of more colours work with no change here.
//
//  GREP MAP
//      grep -n 'export function createInteraction'  the gesture model
//      grep -n 'export function paidLands'           auto-tap preview
//      grep -n 'export function phaseSteps'          the phase bar
//      grep -n 'export function whyNot'              reason a card is dark
//      grep -n 'export function manaByColour'        pips per colour
//      grep -n '  function view'                     the view model
// ============================================================================

const sortNum = (a, b) => a - b;

// The lands that an action taps, read from the state after the action.
export function paidLands(rules, state, action, seat = state.toAct) {
  let after;
  try { after = rules.step(state, action); } catch { return []; }
  const was = new Map(state.players[seat].battlefield.map(x => [x.uid, x.tapped]));
  const out = [];
  for (const x of after.players[seat].battlefield) if (was.get(x.uid) === false && x.tapped) out.push(x.uid);
  return out;
}

// Untapped and total lands per mana colour, in a stable order (the order
// the colours first appear on the battlefield). [{ kind, up, total, id,
// colours }]. A dual land (card.mana = [a, b]) is its own stack 'a/b':
// it pays one of the two, so it is not counted twice.
export function manaByColour(CARD, player) {
  const rows = new Map();
  for (const x of player.battlefield) {
    const c = CARD[x.id];
    if (!c || c.type !== 'land') continue;
    const colours = Array.isArray(c.mana) && c.mana.length ? c.mana : [c.produces || c.colour || 'generic'];
    const kind = colours.join('/');
    let r = rows.get(kind);
    if (!r) { r = { kind, up: 0, total: 0, id: c.id, colours: colours.slice() }; rows.set(kind, r); }
    r.total++;
    if (!x.tapped) r.up++;
  }
  return [...rows.values()];
}

// Cost as a list of [kind, n]: generic first, then each colour in the
// order of the cost object.
export function costParts(cost) {
  const out = [];
  if (!cost) return out;
  if ((cost.generic | 0) > 0) out.push(['generic', cost.generic | 0]);
  for (const k of Object.keys(cost)) if (k !== 'generic' && (cost[k] | 0) > 0) out.push([k, cost[k] | 0]);
  return out;
}

// Why a hand card cannot be played now: '' when it can.
export function whyNot(rules, CARD, state, seat, id, legal) {
  const c = CARD[id];
  if (!c) return 'unknown card';
  if (state.result) return 'the game is over';
  if (state.toAct !== seat) return 'wait for your turn';
  if (state.phase !== 'main') return 'cards are played in your main phase';
  if ((legal || []).some(a => a.card === id)) return '';
  const me = state.players[seat];
  if (c.type === 'land') return me.landPlayed ? 'one land per turn' : 'cannot play it now';
  const pool = rules.manaPool(me);
  const need = [];
  let spare = 0;
  for (const k of Object.keys(pool)) spare += pool[k];
  for (const [k, n] of costParts(c.cost)) {
    if (k === 'generic') continue;
    const have = pool[k] | 0;
    if (have < n) need.push(`${n - have} ${k}`);
    spare -= Math.min(have, n);
  }
  if (need.length) return `needs ${need.join(' and ')} mana`;
  if (spare < (c.cost.generic | 0)) return `needs ${(c.cost.generic | 0) - spare} more mana`;
  return 'no legal target';
}

// The phase bar. Steps of the cut-down turn, with the one that is now.
// [{ key, label, now, done }]  plus whose turn it is.
export function phaseSteps(state, seat) {
  const keys = [['main', 'Main'], ['attack', 'Attack'], ['block', 'Block'], ['end', 'End']];
  const at = state.result ? 4 : keys.findIndex(k => k[0] === state.phase);
  return {
    yours: state.active === seat,
    turn: state.turn,
    steps: keys.map(([key, label], i) => ({ key, label, now: i === at, done: at >= 0 && i < at })),
  };
}

// --------------------------------------------------------------- the model
export function createInteraction({ rules, CARD, seat = 0, names = null }) {
  let S = null;              // the game state now
  let legal = [];
  let sel = null;            // selected hand index
  let targeting = null;      // { id, actions: Map(targetKey -> action) }
  let atk = new Set();       // declared attackers (uid)
  let blocks = new Map();    // attacker uid -> blocker uid
  let pendB = null, pendA = null;
  let hist = [];             // undo snapshots
  let err = '';

  const tkey = t => (typeof t === 'string' ? t : 'u' + t);
  const mine = () => !!S && !S.result && S.toAct === seat;
  const me = () => S.players[seat];
  const foe = () => S.players[1 - seat];
  const permOf = uid => {
    for (const p of S.players) { const x = p.battlefield.find(y => y.uid === uid); if (x) return x; }
    return null;
  };
  const isCreature = x => x && CARD[x.id]?.type === 'creature';
  const name = p => (names && names[p]) || (p === seat ? 'You' : 'Opponent');

  function reset() {
    sel = null; targeting = null; atk = new Set(); blocks = new Map();
    pendB = null; pendA = null; hist = []; err = '';
  }

  // A new state from the controller. Each step() returns a new object,
  // so a new object means a new decision: drop the local choices.
  function sync(state) {
    if (state === S) return;
    S = state;
    legal = S && !S.result ? rules.legalActions(S) : [];
    reset();
  }

  function mode() {
    if (!S) return 'wait';
    if (S.result) return 'over';
    if (S.toAct !== seat) return 'wait';
    if (S.phase === 'main') return targeting ? 'target' : 'main';
    return S.phase;   // attack | block
  }

  const ok = (commit = null) => { err = ''; return { commit }; };
  const fail = e => { err = e; return { commit: null, error: e }; };
  const snap = () => { hist.push({ atk: [...atk], blocks: [...blocks], pendB, pendA }); if (hist.length > 64) hist.shift(); };

  const actionsFor = id => legal.filter(a => (a.type === 'land' || a.type === 'cast') && a.card === id);

  // ---------------------------------------------------------- hand cards
  function select(i) {
    if (!S) return fail('no game');
    const id = me().hand[i];
    if (id === undefined) return fail('no such card');
    targeting = null;
    sel = sel === i ? null : i;
    if (sel === null) return ok();
    const why = mode() === 'main' ? whyNot(rules, CARD, S, seat, id, legal) : '';
    return why ? { commit: null, error: (err = why) } : ok();
  }

  function play(i = sel) {
    if (mode() !== 'main' && mode() !== 'target') return fail(mine() ? 'cards are played in your main phase' : 'wait for your turn');
    const id = me().hand[i];
    if (id === undefined) return fail('select a card first');
    const acts = actionsFor(id);
    if (!acts.length) { sel = i; return fail(whyNot(rules, CARD, S, seat, id, legal)); }
    sel = i;
    if (acts.length === 1 && acts[0].target === undefined) return ok(acts[0]);
    targeting = { id, actions: new Map(acts.map(a => [tkey(a.target), a])) };
    return ok();
  }

  const confirm = () => play(sel);

  function cancel() {
    if (targeting) { targeting = null; return ok(); }
    sel = null; pendA = null; pendB = null;
    return ok();
  }

  // ------------------------------------------------------------- targets
  function chooseTarget(t) {
    const a = targeting?.actions.get(tkey(t));
    if (!a) return fail('not a legal target');
    return ok(a);
  }

  // --------------------------------------------------------- permanents
  function perm(uid) {
    const m = mode();
    if (m === 'target') return chooseTarget(uid);
    if (m === 'attack') return toggleAttacker(uid);
    if (m === 'block') return blockTap(uid);
    return fail(m === 'wait' ? 'wait for your turn' : '');
  }

  function player(p) {
    if (mode() === 'target') return chooseTarget('p' + p);
    return fail('');
  }

  // ------------------------------------------------------------- attack
  const eligibleAttackers = () => (mode() === 'attack' ? me().battlefield.filter(rules.canAttack).map(x => x.uid) : []);

  function toggleAttacker(uid) {
    if (!eligibleAttackers().includes(uid)) {
      const x = permOf(uid);
      if (!x || !me().battlefield.includes(x)) return fail('attack with your own creatures');
      if (!isCreature(x)) return fail('only creatures attack');
      return fail(x.tapped ? 'it is tapped' : CARD[x.id].keywords?.includes('thick') ? 'thick: it cannot attack' : 'it entered this turn');
    }
    snap();
    if (atk.has(uid)) atk.delete(uid); else atk.add(uid);
    return ok();
  }

  function allAttack() {
    if (mode() !== 'attack') return fail('');
    snap();
    const el = eligibleAttackers();
    atk = el.every(u => atk.has(u)) ? new Set() : new Set(el);
    return ok();
  }

  // -------------------------------------------------------------- block
  const incoming = () => (S && S.combat ? S.combat.attackers.slice() : []);
  const eligibleBlockers = () => (mode() === 'block' ? me().battlefield.filter(x => isCreature(x) && !x.tapped).map(x => x.uid) : []);

  function assign(b, a) {
    if (mode() !== 'block') return fail('');
    const B = me().battlefield.find(x => x.uid === b);
    const A = foe().battlefield.find(x => x.uid === a);
    if (!B || !eligibleBlockers().includes(b)) return fail('block with your own untapped creatures');
    if (!A || !incoming().includes(a)) return fail('block an attacking creature');
    if (!rules.canBlock(B, A)) return fail('only creatures with wings can block it');
    snap();
    for (const [k, v] of blocks) if (v === b) blocks.delete(k);
    blocks.set(a, b);
    pendA = null; pendB = null;
    return ok();
  }

  function blockTap(uid) {
    const mineB = eligibleBlockers().includes(uid);
    const isAtk = incoming().includes(uid);
    if (mineB) {
      // tap an assigned blocker again: take it off
      for (const [k, v] of blocks) {
        if (v === uid && pendB !== uid) { snap(); blocks.delete(k); pendB = null; return ok(); }
      }
      if (pendA !== null) return assign(uid, pendA);
      pendB = pendB === uid ? null : uid;
      return ok();
    }
    if (isAtk) {
      if (pendB !== null) return assign(pendB, uid);
      pendA = pendA === uid ? null : uid;
      return ok();
    }
    return fail('tap one of your untapped creatures, then the attacker it blocks');
  }

  function undo() {
    const h = hist.pop();
    if (!h) { if (targeting || sel !== null) return cancel(); return fail('nothing to undo'); }
    atk = new Set(h.atk); blocks = new Map(h.blocks); pendB = h.pendB; pendA = h.pendA;
    return ok();
  }

  // ------------------------------------------------------------ buttons
  function primary() {
    const m = mode();
    if (m === 'main') {
      if (sel !== null && actionsFor(me().hand[sel]).length) return confirm();
      return ok({ type: 'pass' });
    }
    if (m === 'target') return cancel();
    if (m === 'attack') return ok({ type: 'attack', attackers: [...atk].sort(sortNum) });
    if (m === 'block') return ok({ type: 'block', blocks: [...blocks].sort((p, q) => p[0] - q[0]) });
    return fail('');
  }

  function secondary() {
    const m = mode();
    if (m === 'attack') return allAttack();
    if (m === 'block') return undo();
    if (m === 'main' && sel !== null) return cancel();
    if (m === 'target') return cancel();
    return fail('');
  }

  // --------------------------------------------------------------- view
  function primaryOf(m) {
    if (m === 'wait') return { label: S ? `${name(S.toAct)} is thinking` : 'Loading', enabled: false, tone: 'wait' };
    if (m === 'over') return { label: 'New game', enabled: true, tone: 'go', kind: 'new' };
    if (m === 'target') return { label: 'Cancel', enabled: true, tone: 'quiet', kind: 'cancel' };
    if (m === 'main') {
      if (sel !== null) {
        const id = me().hand[sel];
        const acts = actionsFor(id);
        if (acts.length) return { label: `${CARD[id].type === 'land' ? 'Play' : 'Cast'} ${CARD[id].name}`, enabled: true, tone: 'go', kind: 'play' };
      }
      const canAtk = me().battlefield.some(rules.canAttack);
      return { label: canAtk ? 'To combat' : 'End turn', enabled: true, tone: canAtk ? 'go' : 'next', kind: 'pass' };
    }
    if (m === 'attack') return atk.size
      ? { label: `Attack with ${atk.size}`, enabled: true, tone: 'attack', kind: 'attack' }
      : { label: 'No attack', enabled: true, tone: 'next', kind: 'attack' };
    if (m === 'block') return blocks.size
      ? { label: `Confirm ${blocks.size} block${blocks.size > 1 ? 's' : ''}`, enabled: true, tone: 'go', kind: 'block' }
      : { label: 'No blocks', enabled: true, tone: 'next', kind: 'block' };
    return { label: '', enabled: false };
  }

  function secondaryOf(m) {
    if (m === 'attack') {
      const el = eligibleAttackers();
      return el.length ? { label: el.every(u => atk.has(u)) ? 'Clear' : 'All', kind: 'all', enabled: true } : null;
    }
    if (m === 'block') return { label: 'Undo', kind: 'undo', enabled: hist.length > 0 };
    if ((m === 'main' && sel !== null) || m === 'target') return { label: 'Cancel', kind: 'cancel', enabled: true };
    return null;
  }

  function promptOf(m) {
    if (!S) return 'Setting up the table.';
    if (m === 'over') {
      const w = S.result.winner;
      return w < 0 ? `Draw (${S.result.reason}).` : w === seat ? `You win (${S.result.reason}).` : `${name(w)} wins (${S.result.reason}).`;
    }
    if (m === 'wait') return S.phase === 'block' ? `${name(S.toAct)} chooses blocks.` : `${name(S.toAct)} takes a turn.`;
    if (m === 'target') return `Choose a target for ${CARD[targeting.id].name}.`;
    if (m === 'main') {
      if (sel !== null) { const id = me().hand[sel]; const w = whyNot(rules, CARD, S, seat, id, legal); return w ? `${CARD[id].name}: ${w}.` : `Drag it up or tap it again to play ${CARD[id].name}.`; }
      return me().landPlayed ? 'Cast cards, then go to combat.' : 'Play a land, cast cards, then go to combat.';
    }
    if (m === 'attack') return 'Tap creatures to attack. Tap again to take one back.';
    if (m === 'block') {
      if (pendB !== null) return 'Now tap the attacker it blocks.';
      if (pendA !== null) return 'Now tap your creature that blocks it.';
      return 'Tap your creature, then the attacker it blocks.';
    }
    return '';
  }

  function view() {
    const m = mode();
    const hand = S ? me().hand.map((id, i) => {
      const acts = m === 'main' || m === 'target' ? actionsFor(id) : [];
      return { i, id, playable: acts.length > 0, targeted: acts.some(a => a.target !== undefined), selected: sel === i };
    }) : [];
    let preview = [];
    if (S && sel !== null && (m === 'main' || m === 'target')) {
      const acts = actionsFor(me().hand[sel]);
      if (acts.length && acts[0].type === 'cast') preview = paidLands(rules, S, acts[0], seat);
    }
    const targets = targeting ? [...targeting.actions.values()].map(a => a.target) : [];
    return {
      mode: m, mine: mine(), seat,
      prompt: promptOf(m), error: err,
      primary: primaryOf(m), secondary: secondaryOf(m),
      hand, selected: sel, preview,
      targets,
      targetUids: targets.filter(t => typeof t === 'number'),
      targetPlayers: targets.filter(t => typeof t === 'string').map(t => +t.slice(1)),
      attackers: [...atk].sort(sortNum), eligibleAttackers: eligibleAttackers(),
      blocks: [...blocks].sort((p, q) => p[0] - q[0]), eligibleBlockers: eligibleBlockers(),
      incoming: incoming(), pendingBlocker: pendB, pendingAttacker: pendA,
      canUndo: hist.length > 0 || targeting !== null || sel !== null,
      phase: S ? phaseSteps(S, seat) : null,
    };
  }

  return {
    sync, view, mode, select, play, confirm, cancel, perm, player, primary, secondary,
    undo, allAttack, assign, toggleAttacker,
    get state() { return S; }, get legal() { return legal; },
  };
}
