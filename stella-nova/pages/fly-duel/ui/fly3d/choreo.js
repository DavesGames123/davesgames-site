// ============================================================================
//  FLY DUEL 3D  ·  choreography  (pure ES module, no DOM, no three.js)
// ----------------------------------------------------------------------------
//  This module changes one decision record of ui/match.js into a timed list
//  of animation steps for the 3D table (ui/fly3d/scene.js). The scene only
//  plays these steps. It does not read the rules.
//
//  A record is { who, before, after, action, idx, values, value, delta,
//  trace, text }. The action is one of land, cast, pass, attack, block
//  (game/rules.js). The steps come from the action and from the difference
//  between record.before and record.after:
//
//    op        fields                     what the table shows
//    think     p, delta, value            the fly looks at its hand, the
//                                         brain map fires
//    lift      p, card, from              a card leaves the fan
//    land      p, card, uid               the lifted land goes to the land row
//    tap       p, uid, colour, colours,   the fly touches a land, the land
//              pays, slot                 turns a little and dims, a mana
//                                         token goes to the lifted card
//    cast      p, card, uid               the lifted creature goes to the row
//    reveal    p, card                    the lifted spell shows its face
//    spark     p, card, to, amount        a hard line from the spell to its
//                                         target ('p0', 'p1' or a uid)
//    hurt      p, uid, amount             damage marked on a creature
//    pump      p, uid, amount             +n/+n this turn
//    token     p, uid, card               a token creature appears
//    draw      p, card                    library -> hand
//    spent     p, card                    the spell goes to the graveyard
//    attack    p, uids                    attackers go forward (and tap)
//    block     p, pairs                   blockers go in front of attackers
//    strike    p, from, to, amount        combat damage, one hit
//    life      p, from, to                a life counter changes
//    die       p, uid, card, token        a creature leaves the battlefield
//    settle    -                          combat ends, creatures go back
//    discard   p, card                    hand limit discard
//    endturn   -                          damage and pumps wear off
//    turn      turn, active               the next turn starts
//    untap     p, uids                    lands and creatures untap
//    pass      p, label                   the fly passes (no attack, ...)
//    win       winner, reason             the game ends
//    beat      from, to                   the turn goes to the other fly:
//                                         both flies settle, the camera
//                                         goes wide, a short hold
//    hold      p, reason                  a short hold after a big play
//                                         (big creature, big hit, lethal)
//    sync      -                          the scene checks its mirror
//    trigger   p, uid, card, when, kind   a card ability starts (enter,
//                                         death, upkeep): the card pulses
//    ramp      p, uid, card               a land goes from the library to
//                                         the battlefield, tapped
//    bounce    p, uid, card, token        a creature goes back to a hand
//    raise     p, card                    graveyard -> hand
//    tapped    p, uid                     an effect taps a creature
//    grow      p, uid, amount             a lasting +n/+n (field pc)
//    counters  p, uid, kind?, n?, set?    dice counters on a permanent
//    roll      p, die, value, i, uid?     a die is thrown, the engine
//                                         value is the result
//
//  Two paths. When record.after carries the event list of game/rules.js
//  (state.events, filled when the log is on), the steps follow the
//  events in order: tap, enter, trigger, damage, life, dies, bounce,
//  tapped, grow, pump, draw, discard, raise (eventPath). Each event names
//  its player, permanent and amount, so no step is a guess. The turn
//  change cuts the event list in two: the events before the first upkeep
//  trigger (or before the last draw of the next fly) end the turn, the
//  rest start the next turn. Without events (an older rules module or
//  the log off) the steps come from the difference between before and
//  after, as before (legacyPath).
//
//  Dice. record.rolls [{ die, value, p?, uid? }] or roll events give
//  roll steps. game/rules.js writes both: a 'roll' event per die (log on)
//  and state.rolls (the dice of the last step, also with the log off).
//  The legacy path reads record.rolls, else record.after.rolls.
//  permanent.counters { kind: n } is in the mirror. A counter event
//  ({ t: 'counter', p, uid, kind, n }, n the change) or a change of
//  counters gives a counters step. A growth counter also gives a grow
//  event (the rules add it to pc).
//
//  Each step is { op, at, dur, ... } in seconds at speed 1. The steps of
//  one record are sorted by at. total is the time when the last step ends.
//
//  The mirror. mirrorOf(state) gives the table as the scene draws it.
//  applyStep(mirror, step) changes the mirror for one step. choreograph()
//  applies every step to a mirror of record.before while it builds the
//  list, so the steps are always the real changes. The test
//  (tests/fly3d.test.mjs) plays whole games and shows that the mirror
//  after the last step equals mirrorOf(record.after).
//
//  Mana. The rules auto-tap lands (game/rules.js pay()): coloured costs
//  first, then generic. A tap step says what the land pays: a colour key
//  of game/cards.js (ui/fly3d/mana.js reads them at run time) or
//  'generic'. colour is the first colour of the land, colours all of them
//  (two for a dual land). The scene draws a generic token as a grey square.
//
//  Pauses. opts.pause multiplies the beat and hold lengths (1 = the
//  standard pause, 0 = no pause). The scene sets it from its speed: at a
//  high speed the pauses are short. A big play is a creature with power
//  BIG_POWER or more, a hit of BIG_HIT or more life, two deaths or more,
//  or a hit that ends the game.
//
//  GREP MAP
//      grep -n 'export const TIMING'       step lengths in seconds
//      grep -n 'export function mirrorOf'  state -> mirror
//      grep -n 'export function applyStep' one step on a mirror
//      grep -n 'export function mirrorDiff' mirror compare (tests, sync)
//      grep -n 'export function choreograph' record -> timed steps
//      grep -n 'function effectSteps'      card effects (damage, draw, ...)
//      grep -n 'function combatSteps'      strikes, life, deaths
//      grep -n 'function endTurnSteps'     discard, turn, untap, draw
//      grep -n 'function eventPath'        steps from state.events
//      grep -n 'function evStep'           one event -> steps
//      grep -n 'export const MOVE_OPS'     ops that move a thing (cut when
//                                          reduced motion is on)
// ============================================================================
import { CARD } from '../../game/cards.js';
import { landProduces, costColours } from './mana.js';

// Step lengths in seconds at speed 1. gap is the time from one step to the
// next when the steps are in sequence.
export const TIMING = {
  think: 0.75, lift: 0.8, land: 0.6, tap: 0.85, tapGap: 0.26, cast: 0.6,
  reveal: 0.45, spark: 0.4, hurt: 0.9, pump: 0.6, token: 0.5, draw: 0.55,
  drawGap: 0.2, spent: 0.55, attack: 0.65, block: 0.6, strike: 0.45,
  life: 0.7, die: 0.65, settle: 0.45, discard: 0.5, endturn: 0.1,
  turn: 0.45, untap: 0.4, pass: 0.45, win: 3.2, sync: 0,
  beat: 1.25, hold: 0.8,
  trigger: 0.55, ramp: 0.6, bounce: 0.6, raise: 0.6, tapped: 0.5, grow: 0.6,
  counters: 0.55, roll: 1.4,
};
// Big plays (see the header): they get a hold step.
export const BIG_POWER = 4, BIG_HIT = 4;

// Ops that move a card or a token. With reduced motion their dur is 0 (a
// cut) and the time between steps stays, so each change is still seen.
export const MOVE_OPS = new Set(['lift', 'land', 'tap', 'cast', 'reveal', 'draw', 'spent',
  'attack', 'block', 'strike', 'die', 'settle', 'discard', 'untap', 'token', 'spark',
  'ramp', 'bounce', 'raise', 'tapped', 'roll']);

const power = perm => (CARD[perm.id]?.power || 0) + (perm.pp || 0) + (perm.pc || 0);
const toughness = perm => (CARD[perm.id]?.toughness || 0) + (perm.pt || 0) + (perm.pc || 0);
const hasKw = (id, w) => !!CARD[id]?.keywords?.includes(w);
// counters { kind: n } -> a stable string ('' for none)
export const countersKey = c => (c ? Object.keys(c).filter(k => c[k]).sort().map(k => `${k}${c[k]}`).join(',') : '');
const cloneCounters = c => { const k = countersKey(c); return k ? Object.fromEntries(Object.entries(c).filter(([, v]) => v)) : null; };

// ---------------------------------------------------------------- mirror
// The part of a state that the table shows. Plain data.
export function mirrorOf(state) {
  return {
    turn: state.turn, active: state.active,
    result: state.result ? { winner: state.result.winner, reason: state.result.reason } : null,
    players: state.players.map(pl => ({
      life: pl.life,
      library: pl.library.length,
      hand: pl.hand.slice(),
      battlefield: pl.battlefield.map(x => ({ uid: x.uid, id: x.id, tapped: !!x.tapped, dmg: x.dmg | 0, pp: x.pp | 0, pt: x.pt ?? (x.pp | 0), pc: x.pc | 0, counters: cloneCounters(x.counters) })),
      graveyard: pl.graveyard.slice(),
    })),
    held: [null, null],          // the card a fly holds up (land or cast)
    combat: { attackers: (state.combat?.attackers || []).slice(), blocks: [] },
  };
}

const permOf = (m, uid) => {
  for (let p = 0; p < 2; p++) {
    const x = m.players[p].battlefield.find(y => y.uid === uid);
    if (x) return { p, x };
  }
  return null;
};

// One step on a mirror. Changes the mirror and returns it. Unknown ops and
// display-only ops (think, reveal, spark, pass, sync) change nothing.
export function applyStep(m, s) {
  const pl = s.p != null ? m.players[s.p] : null;
  switch (s.op) {
    case 'lift': {
      const i = s.from != null && pl.hand[s.from] === s.card ? s.from : pl.hand.indexOf(s.card);
      if (i >= 0) pl.hand.splice(i, 1);
      m.held[s.p] = s.card;
      break;
    }
    case 'land':
    case 'cast':
      m.held[s.p] = null;
      pl.battlefield.push(newPerm(s.uid, s.card, !!s.tapped));
      break;
    case 'token':
      pl.battlefield.push(newPerm(s.uid, s.card, !!s.tapped));
      break;
    case 'ramp':
      pl.battlefield.push(newPerm(s.uid, s.card, true));
      pl.library = Math.max(0, pl.library - 1);
      break;
    case 'bounce': {
      const i = pl.battlefield.findIndex(y => y.uid === s.uid);
      if (i >= 0) pl.battlefield.splice(i, 1);
      if (!s.token) pl.hand.push(s.card);
      m.combat.attackers = m.combat.attackers.filter(u => u !== s.uid);
      break;
    }
    case 'raise': {
      const i = pl.graveyard.indexOf(s.card);
      if (i >= 0) pl.graveyard.splice(i, 1);
      pl.hand.push(s.card);
      break;
    }
    case 'tapped': {
      const f = permOf(m, s.uid);
      if (f) f.x.tapped = true;
      break;
    }
    case 'grow': {
      const f = permOf(m, s.uid);
      if (f) f.x.pc += s.amount;
      break;
    }
    case 'counters': {
      const f = permOf(m, s.uid);
      if (!f) break;
      const c = { ...(f.x.counters || {}) };
      if (s.set) { for (const k of Object.keys(c)) delete c[k]; Object.assign(c, s.set); }
      else if (s.kind) c[s.kind] = (c[s.kind] | 0) + (s.n | 0);
      f.x.counters = cloneCounters(c);
      break;
    }
    case 'tap': {
      const x = pl.battlefield.find(y => y.uid === s.uid);
      if (x) x.tapped = true;
      break;
    }
    case 'untap':
      for (const x of pl.battlefield) if (s.uids.includes(x.uid)) x.tapped = false;
      break;
    case 'hurt': {
      const f = permOf(m, s.uid);
      if (f) f.x.dmg += s.amount;
      break;
    }
    case 'strike': {
      if (typeof s.to === 'number') { const f = permOf(m, s.to); if (f) f.x.dmg += s.amount; }
      break;
    }
    case 'pump': {
      const f = permOf(m, s.uid);
      if (f) { f.x.pp += s.amount; f.x.pt += s.tough ?? s.amount; }
      break;
    }
    case 'life': pl.life = s.to; break;
    case 'die': {
      const i = pl.battlefield.findIndex(y => y.uid === s.uid);
      if (i >= 0) pl.battlefield.splice(i, 1);
      if (!s.token) pl.graveyard.push(s.card);
      m.combat.attackers = m.combat.attackers.filter(u => u !== s.uid);
      m.combat.blocks = m.combat.blocks.filter(q => q[0] !== s.uid && q[1] !== s.uid);
      break;
    }
    case 'draw': pl.hand.push(s.card); pl.library = Math.max(0, pl.library - 1); break;
    case 'spent': m.held[s.p] = null; pl.graveyard.push(s.card); break;
    case 'discard': {
      const i = pl.hand.indexOf(s.card);
      if (i >= 0) pl.hand.splice(i, 1);
      pl.graveyard.push(s.card);
      break;
    }
    case 'attack':
      // an attacker with alert does not tap (s.keep)
      for (const x of pl.battlefield) if (s.uids.includes(x.uid) && !(s.keep || []).includes(x.uid)) x.tapped = true;
      m.combat.attackers = s.uids.slice();
      break;
    case 'block': m.combat.blocks = s.pairs.map(q => q.slice()); break;
    case 'settle': m.combat = { attackers: [], blocks: [] }; break;
    case 'endturn':
      for (const q of m.players) for (const x of q.battlefield) { x.dmg = 0; x.pp = 0; x.pt = 0; }
      m.combat = { attackers: [], blocks: [] };
      break;
    case 'turn': m.turn = s.turn; m.active = s.active; break;
    case 'win': m.result = { winner: s.winner, reason: s.reason }; break;
    default: break;
  }
  return m;
}

// Differences between two mirrors as short strings ([] = same). held and
// combat are display state and are not compared.
export function mirrorDiff(a, b) {
  const out = [];
  if (a.turn !== b.turn) out.push(`turn ${a.turn} != ${b.turn}`);
  if (a.active !== b.active) out.push(`active ${a.active} != ${b.active}`);
  if (!!a.result !== !!b.result || (a.result && a.result.winner !== b.result.winner)) out.push('result');
  for (let p = 0; p < 2; p++) {
    const x = a.players[p], y = b.players[p];
    if (x.life !== y.life) out.push(`p${p} life ${x.life} != ${y.life}`);
    if (x.library !== y.library) out.push(`p${p} library ${x.library} != ${y.library}`);
    if (x.hand.join() !== y.hand.join()) out.push(`p${p} hand [${x.hand}] != [${y.hand}]`);
    if (x.graveyard.join() !== y.graveyard.join()) out.push(`p${p} graveyard [${x.graveyard}] != [${y.graveyard}]`);
    const bf = z => z.battlefield.map(q => `${q.uid}:${q.id}:${q.tapped ? 'T' : 'u'}:${q.dmg}:${q.pp}:${q.pt}:${q.pc}${q.counters ? ':' + countersKey(q.counters) : ''}`).join(' ');
    if (bf(x) !== bf(y)) out.push(`p${p} battlefield ${bf(x)} != ${bf(y)}`);
  }
  return out;
}

// ----------------------------------------------------------- choreograph
// record -> { who, kind, steps, total }. opts.reduced: dur 0 on MOVE_OPS.
// opts.timing: override TIMING values.
export function choreograph(rec, opts = {}) {
  const T = { ...TIMING, ...(opts.timing || {}) };
  const reduced = !!opts.reduced;
  const pause = Number.isFinite(opts.pause) ? Math.max(0, opts.pause) : 1;
  const B = rec.before, A = rec.after, act = rec.action || { type: 'pass' };
  const p = rec.who ?? B.toAct;
  const m = mirrorOf(B);
  const steps = [];
  let t = 0;
  const ctx = {
    T, m, A, B, steps, pause,
    get t() { return t; },
    // Add a step at the cursor, apply it, move the cursor by gap.
    emit(op, fields = {}, gap = T[op] ?? 0, dur = T[op] ?? 0) {
      const s = { op, at: round(t), dur: reduced && MOVE_OPS.has(op) ? 0 : dur, ...fields };
      steps.push(s);
      applyStep(m, s);
      t += gap;
      return s;
    },
    wait(dt) { t += dt; },
  };

  ctx.emit('think', { p, delta: num(rec.delta), value: num(rec.value), idx: rec.idx ?? -1, bot: !rec.trace });

  if (useEvents(A)) eventPath(ctx, p, act, rec);
  else legacyPath(ctx, p, act, rec);
  // Anything not yet explained (for safety): draws and life. These steps
  // carry fallback: true. The test requires that none occur.
  for (let q = 0; q < 2; q++) {
    const drawn = A.players[q].hand.slice(m.players[q].hand.length);
    if (sameStart(A.players[q].hand, m.players[q].hand)) for (const c of drawn) ctx.emit('draw', { p: q, card: c, fallback: true }, T.drawGap, T.draw);
    if (A.players[q].life !== m.players[q].life) ctx.emit('life', { p: q, from: m.players[q].life, to: A.players[q].life, fallback: true });
  }
  if (A.result && !m.result) ctx.emit('win', { winner: A.result.winner, reason: A.result.reason });
  ctx.emit('sync', {}, 0, 0);

  steps.sort((a, b) => a.at - b.at);
  let total = 0;
  for (const s of steps) total = Math.max(total, s.at + s.dur);
  total = Math.max(total, t);
  return { who: p, kind: act.type, steps, total: round(total), mirror: m };
}


// ---------------------------------------------------------- legacy path
// Steps from the difference between before and after (no event list).
function legacyPath(ctx, p, act, rec) {
  const { m, A, B } = ctx;
  if (act.type === 'land') {
    const from = B.players[p].hand.indexOf(act.card);
    ctx.emit('lift', { p, card: act.card, from });
    ctx.emit('land', { p, card: act.card, uid: newUid(m, A, p, act.card) });
  } else if (act.type === 'cast') {
    castSteps(ctx, p, act);
  } else if (act.type === 'pass') {
    ctx.emit('pass', { p, label: 'combat' });
  } else if (act.type === 'attack') {
    if (!act.attackers.length) ctx.emit('pass', { p, label: 'no attack' });
    else {
      ctx.emit('attack', { p, uids: act.attackers.slice() });
      // No blocker can block: the rules resolve combat at once.
      if (A.phase !== 'block' || A.turn !== B.turn || A.result) combatSteps(ctx, []);
    }
  } else if (act.type === 'block') {
    if (act.blocks.length) ctx.emit('block', { p, pairs: act.blocks.map(q => q.slice()) });
    else ctx.emit('pass', { p, label: 'no block' });
    combatSteps(ctx, act.blocks);
  }

  // Dice: record.rolls, else the rolls of the step (state.rolls of
  // game/rules.js, filled also with the log off). Counters: one counters
  // step per permanent that changed.
  const rolls = Array.isArray(rec.rolls) ? rec.rolls : Array.isArray(A.rolls) ? A.rolls : [];
  rolls.forEach((r, i) => ctx.emit('roll', { p: r.p ?? p, die: r.die, value: r.value, i, uid: r.uid ?? null, why: r.why ?? null }, ctx.T.roll * 0.6, ctx.T.roll));
  counterSync(ctx);
  // lasting growth (pc) that changed: a grow step
  for (let q = 0; q < 2; q++) {
    for (const y of A.players[q].battlefield) {
      const x = m.players[q].battlefield.find(z => z.uid === y.uid);
      if (x && (y.pc | 0) !== (x.pc | 0)) ctx.emit('grow', { p: q, uid: y.uid, amount: (y.pc | 0) - (x.pc | 0) });
    }
  }

  // Turn change: discards, then the next turn, untap, draw.
  bigPlaySteps(ctx, p, act, B);
  if (A.turn !== m.turn || (A.result && A.result.reason === 'turn cap')) endTurnSteps(ctx);
}

// ----------------------------------------------------------- event path
// The rules module fills state.events when its log is on. An empty list
// is a real "nothing happened" when logOn is true.
function useEvents(A) { return Array.isArray(A.events) && (A.logOn === true || A.events.length > 0); }

// The steps from the event list of record.after (see the header).
function eventPath(ctx, p, act, rec) {
  const { T, m, A, B } = ctx;
  const E = A.events;
  const turned = A.turn !== B.turn;
  // The turn change cuts the list: upkeep triggers and the turn draw of
  // the next fly come after it.
  let cut = E.length;
  if (turned) {
    const iu = E.findIndex(e => e.t === 'trigger' && e.when === 'upkeep');
    const last = E[E.length - 1];
    if (iu >= 0) cut = iu;
    else if (last && last.t === 'draw' && last.p === A.active) cut = E.length - 1;
  }
  const st = {
    p, act, lib: [B.players[0].library.slice(), B.players[1].library.slice()],
    wantLand: false, wantCast: false, spell: null, spent: false, combat: false,
    slot: 0, taps: E.filter(e => e.t === 'tap').length, tapping: false,
    src: null, damaged: new Set(), usedAtt: new Set(), pairs: [], rolled: false,
  };
  const rollEvents = E.some(e => e.t === 'roll');
  const recRolls = () => {
    if (st.rolled || rollEvents || !Array.isArray(rec.rolls)) return;
    st.rolled = true;
    rec.rolls.forEach((r, i) => ctx.emit('roll', { p: r.p ?? p, die: r.die, value: r.value, i, uid: r.uid ?? null, why: r.why ?? null }, T.roll * 0.6, T.roll));
    if (rec.rolls.length) ctx.wait(T.roll * 0.4);
  };

  if (act.type === 'land') {
    ctx.emit('lift', { p, card: act.card, from: B.players[p].hand.indexOf(act.card) });
    st.wantLand = true;
  } else if (act.type === 'cast') {
    const card = CARD[act.card];
    ctx.emit('lift', { p, card: act.card, from: B.players[p].hand.indexOf(act.card) });
    st.src = { card: act.card, uid: null };
    if (card.type === 'creature') st.wantCast = true;
    else st.spell = act.card;
    if (!st.taps) startEffects(ctx, st, recRolls);
  } else if (act.type === 'pass') {
    ctx.emit('pass', { p, label: A.phase === 'attack' && !turned ? 'combat' : 'end turn' });
  } else if (act.type === 'attack') {
    if (!act.attackers.length) ctx.emit('pass', { p, label: 'no attack' });
    else {
      const keep = act.attackers.filter(u => { const x = m.players[p].battlefield.find(y => y.uid === u); return x && hasKw(x.id, 'alert'); });
      ctx.emit('attack', { p, uids: act.attackers.slice(), keep });
      st.combat = A.phase !== 'block' || turned || !!A.result;
    }
  } else if (act.type === 'block') {
    if (act.blocks.length) ctx.emit('block', { p, pairs: act.blocks.map(q => q.slice()) });
    else ctx.emit('pass', { p, label: 'no block' });
    st.combat = true;
    st.pairs = act.blocks.map(q => q.slice());
  }
  if (act.type !== 'cast') recRolls();

  for (let i = 0; i < cut; i++) evStep(ctx, st, E[i], recRolls);
  if (st.tapping) endTaps(ctx, st, recRolls);
  if (st.spell && !st.spent) { ctx.emit('spent', { p, card: st.spell }); st.spent = true; }
  if (st.combat) { ctx.wait(T.strike); ctx.emit('settle', {}); }
  counterSync(ctx);
  bigPlaySteps(ctx, p, act, B);
  if (turned || (A.result && A.result.reason === 'turn cap')) {
    ctx.emit('endturn', {});
    if (turned) {
      const q = m.active;
      if (ctx.pause > 0) { const d = round(T.beat * ctx.pause); ctx.emit('beat', { from: q, to: A.active }, d, d); }
      ctx.emit('turn', { turn: A.turn, active: A.active });
      const n = A.active;
      const uids = m.players[n].battlefield.filter(x => x.tapped).map(x => x.uid);
      if (uids.length) ctx.emit('untap', { p: n, uids });
      st.combat = false; st.src = null;
      for (let i = cut; i < E.length; i++) evStep(ctx, st, E[i], recRolls);
      counterSync(ctx);
    }
  }
}

// After the last tap: the card goes down or shows its face.
function endTaps(ctx, st, recRolls) {
  st.tapping = false;
  ctx.wait(Math.max(0, ctx.T.tap - ctx.T.tapGap));
  startEffects(ctx, st, recRolls);
}
function startEffects(ctx, st, recRolls) {
  if (st.spell) { ctx.emit('reveal', { p: st.p, card: st.spell }); recRolls(); }
}

// Is the creature uid dead by damage or toughness now (a sweep death)?
function lethal(m, uid) {
  const f = permOf(m, uid);
  if (!f || CARD[f.x.id]?.type !== 'creature') return false;
  const t = toughness(f.x);
  return t <= 0 || f.x.dmg >= t;
}

// One event of game/rules.js -> steps.
function evStep(ctx, st, e, recRolls) {
  const { T, m } = ctx;
  if (st.tapping && e.t !== 'tap') endTaps(ctx, st, recRolls);
  const card = id => CARD[id] || {};
  switch (e.t) {
    case 'tap': {
      st.tapping = true;
      const f = permOf(m, e.uid);
      const cs = f ? landProduces(CARD[f.x.id]) : [];
      ctx.emit('tap', { p: e.p, uid: e.uid, colour: cs[0] || 'generic', colours: cs, pays: e.pays || 'generic', slot: st.slot++, of: st.taps }, T.tapGap, T.tap);
      break;
    }
    case 'enter': {
      const k = card(e.id);
      const tapped = !!k.entersTapped;
      if (st.wantLand && e.id === st.act.card) { st.wantLand = false; ctx.emit('land', { p: e.p, card: e.id, uid: e.uid, tapped }); }
      else if (st.wantCast && e.id === st.act.card) {
        st.wantCast = false; st.src = { card: e.id, uid: e.uid };
        ctx.emit('cast', { p: e.p, card: e.id, uid: e.uid });
        recRolls();
      } else if (k.type === 'land') ctx.emit('ramp', { p: e.p, card: e.id, uid: e.uid, from: takeLand(st, e.p, e.id) });
      else ctx.emit('token', { p: e.p, uid: e.uid, card: e.id, tapped: false }, T.token * 0.5, T.token);
      break;
    }
    case 'trigger':
      st.src = { card: e.id, uid: e.uid ?? null };
      ctx.emit('trigger', { p: e.p, uid: e.uid ?? null, card: e.id, when: e.when, kind: e.kind }, T.trigger * 0.7, T.trigger);
      break;
    case 'damage': {
      const n = e.n | 0;
      if (st.combat) {
        const hit = combatSource(m, st, e);
        // combat damage lands together (one damage step of the rules):
        // the strikes follow each other closely, settle waits for them
        if (hit) { ctx.emit('strike', { p: hit.p, from: hit.from, to: e.uid ?? 'p' + e.p, amount: n }, 0.07, T.strike); if (e.uid != null) st.damaged.add(e.uid); break; }
      }
      const to = e.uid ?? 'p' + e.p;
      if (e.uid == null) st.faceHit = e.p;
      ctx.emit('spark', { p: 1 - e.p, card: st.src?.card ?? null, src: st.src?.uid ?? null, to, amount: n }, T.spark * 0.75, T.spark);
      if (e.uid != null) { ctx.emit('hurt', { p: e.p, uid: e.uid, amount: n }, 0.3, T.hurt); st.damaged.add(e.uid); }
      break;
    }
    case 'life': {
      // A loss with no damage event (drain, a death trigger): a spark from
      // the source to the player first, so the hit is seen.
      if (!st.combat && (e.n | 0) < 0 && st.faceHit !== e.p && st.src) {
        ctx.emit('spark', { p: 1 - e.p, card: st.src.card, src: st.src.uid, to: 'p' + e.p, amount: -(e.n | 0) }, T.spark * 0.75, T.spark);
      }
      st.faceHit = null;
      const from = m.players[e.p].life;
      ctx.emit('life', { p: e.p, from, to: from + (e.n | 0) }, st.combat ? 0.07 : 0.45, T.life);
      break;
    }
    case 'dies': {
      if (st.spell && !st.spent && lethal(m, e.uid)) { ctx.emit('spent', { p: st.p, card: st.spell }); st.spent = true; }
      if (!st.combat && !st.damaged.has(e.uid) && !lethal(m, e.uid) && st.src) ctx.emit('spark', { p: st.p, card: st.src.card, src: st.src.uid, to: e.uid, amount: 0 }, T.spark * 0.75, T.spark);
      ctx.emit('die', { p: e.p, uid: e.uid, card: e.id, token: !!card(e.id).token, cause: st.combat ? 'combat' : 'effect' }, 0.2, T.die);
      break;
    }
    case 'bounce':
      if (st.src) ctx.emit('spark', { p: st.p, card: st.src.card, src: st.src.uid, to: e.uid, amount: 0 }, T.spark * 0.75, T.spark);
      ctx.emit('bounce', { p: e.p, uid: e.uid, card: e.id, token: !!card(e.id).token });
      break;
    case 'tapped':
      if (st.src) ctx.emit('spark', { p: st.p, card: st.src.card, src: st.src.uid, to: e.uid, amount: 0 }, T.spark * 0.75, T.spark);
      ctx.emit('tapped', { p: e.p, uid: e.uid });
      break;
    case 'grow': ctx.emit('grow', { p: e.p, uid: e.uid, amount: e.n | 0 }, 0.18, T.grow); break;
    case 'pump': ctx.emit('pump', { p: e.p, uid: e.uid, amount: e.pp | 0, tough: e.pt ?? e.pp | 0 }, 0.18, T.pump); break;
    case 'draw':
      for (let k = 0; k < (e.n || 1); k++) ctx.emit('draw', { p: e.p, card: st.lib[e.p].shift() ?? null }, T.drawGap, T.draw);
      break;
    case 'discard': ctx.emit('discard', { p: e.p, card: e.id }, 0.25, T.discard); break;
    case 'raise': ctx.emit('raise', { p: e.p, card: e.id }); break;
    case 'roll': ctx.emit('roll', { p: e.p ?? st.p, die: e.die, value: e.value, i: 0, uid: e.uid ?? null, why: e.why ?? null }, T.roll * 0.6, T.roll); break;
    case 'counter': case 'counters':
      if (e.uid != null && e.kind) ctx.emit('counters', { p: e.p, uid: e.uid, kind: e.kind, n: e.n | 0 });
      break;
    default: break;
  }
}

// The library card that a ramp takes (the first land with this id).
function takeLand(st, p, id) {
  const i = st.lib[p].indexOf(id);
  if (i >= 0) st.lib[p].splice(i, 1);
  return 'library';
}

// Who deals a combat damage event. A creature in a block pair is hit by
// its partner. The defending player is hit by an attacker that is not
// blocked (or has crush), one hit per attacker, the same power first.
function combatSource(m, st, e) {
  const att = m.active, def = 1 - att;
  const pairs = st.pairs.length ? st.pairs : m.combat.blocks;
  if (e.uid != null) {
    const a = pairs.find(q => q[1] === e.uid), b = pairs.find(q => q[0] === e.uid);
    if (a) return { p: att, from: a[0] };
    if (b) return { p: def, from: b[1] };
    return null;
  }
  if (e.p !== def) return null;
  const blocked = new Set(pairs.map(q => q[0]));
  const live = m.combat.attackers.filter(u => !st.usedAtt.has(u)).map(u => m.players[att].battlefield.find(x => x.uid === u)).filter(Boolean)
    .filter(x => !blocked.has(x.uid) || hasKw(x.id, 'crush'));
  const pick = live.find(x => power(x) === (e.n | 0)) || live[0];
  if (!pick) return null;
  st.usedAtt.add(pick.uid);
  return { p: att, from: pick.uid };
}

// Counters that changed with no counter event: one counters step per
// permanent with the new set.
function counterSync(ctx) {
  const { m, A } = ctx;
  for (let q = 0; q < 2; q++) {
    for (const y of A.players[q].battlefield) {
      const x = m.players[q].battlefield.find(z => z.uid === y.uid);
      if (!x || countersKey(x.counters) === countersKey(y.counters)) continue;
      ctx.emit('counters', { p: q, uid: y.uid, set: cloneCounters(y.counters) || {} });
    }
  }
}

function newPerm(uid, id, tapped) { return { uid, id, tapped, dmg: 0, pp: 0, pt: 0, pc: 0, counters: null }; }

// --------------------------------------------------------------- casting
function castSteps(ctx, p, act) {
  const { T, m, A, B } = ctx;
  const card = CARD[act.card];
  const from = B.players[p].hand.indexOf(act.card);
  ctx.emit('lift', { p, card: act.card, from });
  // Lands that this cast taps, in battlefield order, and what each pays.
  const before = B.players[p].battlefield, after = A.players[p].battlefield;
  const tapped = before.filter(x => !x.tapped && CARD[x.id].type === 'land' && after.some(y => y.uid === x.uid && y.tapped));
  // Coloured needs from the cost (every colour key of game/cards.js, not
  // only amber and moss). A dual land pays the first of its colours that
  // is still needed. Single-colour lands pay first, so a dual land is kept
  // for the colour that only it can pay.
  const need = new Map(costColours(card.cost));
  let slot = 0;
  const pays = new Map();
  for (const pass of [1, 2]) {
    for (const x of tapped) {
      const cs = landProduces(CARD[x.id]);
      if ((pass === 1) !== (cs.length <= 1) || pays.has(x.uid)) continue;
      const c = cs.find(k => (need.get(k) | 0) > 0);
      if (c) { need.set(c, need.get(c) - 1); pays.set(x.uid, c); }
    }
  }
  for (const x of tapped) {
    const cs = landProduces(CARD[x.id]);
    ctx.emit('tap', { p, uid: x.uid, colour: cs[0] || 'generic', colours: cs, pays: pays.get(x.uid) || 'generic', slot: slot++, of: tapped.length }, T.tapGap, T.tap);
  }
  if (tapped.length) ctx.wait(Math.max(0, T.tap - T.tapGap));
  if (card.type === 'creature') {
    ctx.emit('cast', { p, card: card.id, uid: newUid(m, A, p, card.id) });
    if (card.effect) effectSteps(ctx, p, card, undefined);
  } else {
    ctx.emit('reveal', { p, card: card.id });
    effectSteps(ctx, p, card, act.target);
    ctx.emit('spent', { p, card: card.id });
  }
  deathSteps(ctx);
}

// The visible result of a card effect (rules.js resolveEffect).
function effectSteps(ctx, p, card, target) {
  const { m, A, T } = ctx;
  const e = card.effect, q = 1 - p;
  switch (e.kind) {
    case 'damage':
      ctx.emit('spark', { p, card: card.id, to: target, amount: e.amount });
      if (typeof target === 'string') {
        const tp = +target.slice(1);
        ctx.emit('life', { p: tp, from: m.players[tp].life, to: m.players[tp].life - e.amount });
      } else {
        const f = permOf(m, target);
        if (f) ctx.emit('hurt', { p: f.p, uid: target, amount: e.amount }, T.strike, T.hurt);
      }
      break;
    case 'heal':
      ctx.emit('life', { p, from: m.players[p].life, to: m.players[p].life + e.amount });
      break;
    case 'draw': {
      const have = m.players[p].hand.length;
      const drawn = A.players[p].hand.slice(have, have + e.amount);
      for (const c of drawn) ctx.emit('draw', { p, card: c }, T.drawGap, T.draw);
      if (drawn.length) ctx.wait(T.draw - T.drawGap);
      break;
    }
    case 'pump':
      if (target != null) ctx.emit('pump', { p, uid: target, amount: e.amount });
      break;
    case 'destroy': {
      ctx.emit('spark', { p, card: card.id, to: target, amount: 0 });
      const f = permOf(m, target);
      if (f) ctx.emit('die', { p: f.p, uid: target, card: f.x.id, token: !!CARD[f.x.id].token, cause: 'destroy' });
      break;
    }
    case 'token': {
      const known = new Set(m.players[p].battlefield.map(x => x.uid));
      const made = A.players[p].battlefield.filter(x => !known.has(x.uid) && x.id === e.token).slice(0, e.amount);
      for (const x of made) ctx.emit('token', { p, uid: x.uid, card: x.id }, T.token * 0.5, T.token);
      if (made.length) ctx.wait(T.token * 0.5);
      break;
    }
    default: break;
  }
}

// Creatures in the mirror that are not in record.after: they died.
function deathSteps(ctx) {
  const { m, A, T } = ctx;
  let any = false;
  for (let q = 0; q < 2; q++) {
    const keep = new Set(A.players[q].battlefield.map(x => x.uid));
    for (const x of m.players[q].battlefield.slice()) {
      if (keep.has(x.uid)) continue;
      ctx.emit('die', { p: q, uid: x.uid, card: x.id, token: !!CARD[x.id].token, cause: 'damage' }, 0.12, T.die);
      any = true;
    }
  }
  if (any) ctx.wait(T.die - 0.12);
}

// --------------------------------------------------------------- combat
function combatSteps(ctx, blocks) {
  const { m, A, T } = ctx;
  const att = m.active, def = 1 - att;
  const blockOf = new Map(blocks.map(q => [q[0], q[1]]));
  // All hits land together, like the rules (one damage step).
  const hits = [];
  for (const u of m.combat.attackers) {
    const a = m.players[att].battlefield.find(x => x.uid === u);
    if (!a) continue;
    const pa = power(a), bu = blockOf.get(u);
    if (bu === undefined) { if (pa > 0) hits.push({ p: att, from: u, to: 'p' + def, amount: pa }); continue; }
    const b = m.players[def].battlefield.find(x => x.uid === bu);
    if (!b) continue;
    if (pa > 0) hits.push({ p: att, from: u, to: bu, amount: pa });
    const pb = power(b);
    if (pb > 0) hits.push({ p: def, from: bu, to: u, amount: pb });
  }
  hits.forEach((h, i) => ctx.emit('strike', h, i === hits.length - 1 ? T.strike : 0.06));
  // Life after combat (damage to the defender, sap gains).
  for (let q = 0; q < 2; q++) {
    const to = A.players[q].life;
    if (to !== m.players[q].life) ctx.emit('life', { p: q, from: m.players[q].life, to }, 0.1, T.life);
  }
  deathSteps(ctx);
  ctx.emit('settle', {});
}

// ------------------------------------------------------------- end turn
function endTurnSteps(ctx) {
  const { m, A, T } = ctx;
  const q = m.active;
  // Graveyard cards that are still not explained are hand-limit discards.
  for (const c of A.players[q].graveyard.slice(m.players[q].graveyard.length)) ctx.emit('discard', { p: q, card: c }, 0.25, T.discard);
  ctx.emit('endturn', {});
  if (A.turn !== m.turn) {
    // the pass-the-turn beat: both flies settle, the camera goes wide
    if (ctx.pause > 0) { const d = round(T.beat * ctx.pause); ctx.emit('beat', { from: q, to: A.active }, d, d); }
    ctx.emit('turn', { turn: A.turn, active: A.active });
    const n = A.active;
    const up = new Set(A.players[n].battlefield.filter(x => !x.tapped).map(x => x.uid));
    const uids = m.players[n].battlefield.filter(x => x.tapped && up.has(x.uid)).map(x => x.uid);
    if (uids.length) ctx.emit('untap', { p: n, uids });
    const drawn = A.players[n].hand.slice(m.players[n].hand.length);
    for (const c of drawn) ctx.emit('draw', { p: n, card: c }, T.drawGap, T.draw);
    if (drawn.length) ctx.wait(T.draw - T.drawGap);
  }
}

// ------------------------------------------------------------- big plays
// A hold step after a big play (see the header). reason: 'creature',
// 'hit', 'deaths' or 'lethal'.
function bigPlaySteps(ctx, p, act, B) {
  const { T, m, steps } = ctx;
  if (!(ctx.pause > 0)) return;
  let reason = null, who = p;
  const lost = q => B.players[q].life - m.players[q].life;
  const deaths = steps.filter(s => s.op === 'die').length;
  if (m.players.some(q => q.life <= 0)) { reason = 'lethal'; who = m.players[0].life <= 0 ? 0 : 1; }
  else if (lost(0) >= BIG_HIT || lost(1) >= BIG_HIT) { reason = 'hit'; who = lost(0) >= lost(1) ? 0 : 1; }
  else if (deaths >= 2) reason = 'deaths';
  else if (act.type === 'cast' && CARD[act.card]?.type === 'creature' && (CARD[act.card].power | 0) >= BIG_POWER) reason = 'creature';
  if (!reason) return;
  const d = round(T.hold * ctx.pause);
  ctx.emit('hold', { p: who, reason }, d, d);
}

// ----------------------------------------------------------------- utils
// The uid of the new permanent with this card id (not in the mirror yet).
function newUid(m, A, p, id) {
  const known = new Set(m.players[p].battlefield.map(x => x.uid));
  const x = A.players[p].battlefield.find(y => !known.has(y.uid) && y.id === id);
  return x ? x.uid : -1;
}
function sameStart(full, part) { for (let i = 0; i < part.length; i++) if (full[i] !== part[i]) return false; return full.length >= part.length; }
function num(v) { return Number.isFinite(v) ? v : null; }
function round(v) { return Math.round(v * 1000) / 1000; }
