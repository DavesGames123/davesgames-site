// ============================================================================
//  FLY DUEL  ·  the human seat  (ES module, no DOM, pure)
// ----------------------------------------------------------------------------
//  A human player in the agent shape of ui/match.js: { name, kind,
//  gamma, choose(state, legal, rng) -> { action } }. The human does not
//  decide inside choose(). The play UI (ui/play/) collects the gestures,
//  makes one action, and calls submit(action). The controller
//  (ui/play/controller.js) then calls Match.next(), and choose() gives
//  back the queued action.
//
//  A human action does not have to be one of the legalActions() options.
//  legalActions() lists at most 16 attack and 16 block options for the fly
//  (game/rules.js MAX_OPTIONS). A human can name any attacker subset and
//  any block map that step() accepts. checkAction() asks step() itself,
//  so the human seat obeys the same rules as the fly, with no copy of them.
//
//  scriptedHuman() is a test seam: a "human" that picks with a bot
//  function, and goes through the same submit() path. Node tests use it to
//  play full games against the fly.
//
//  GREP MAP
//      grep -n 'export function createHuman'    the human agent
//      grep -n 'export function checkAction'    step() as the judge
//      grep -n 'export function matchLegal'     same action in legal[]
//      grep -n 'export function scriptedHuman'  bot-driven test human
// ============================================================================

// The human agent. opts.rules: the game/rules.js module (for checkAction).
export function createHuman({ name = 'You', rules = null } = {}) {
  const queue = [];
  const agent = {
    name, kind: 'human', gamma: 1,
    // true when an action waits for choose()
    get ready() { return queue.length > 0; },
    // Queue one action. With rules, an action that step() refuses is not
    // queued: the result is { ok: false, error }.
    submit(action, state = null) {
      if (rules && state) {
        const c = checkAction(rules, state, action);
        if (!c.ok) return c;
      }
      queue.push(action);
      return { ok: true };
    },
    clear() { queue.length = 0; },
    choose(state, legal) {
      if (!queue.length) throw new Error('human: no action submitted');
      const action = queue.shift();
      const same = rules ? matchLegal(rules, legal, action) : null;
      return { action: same || action };
    },
  };
  return agent;
}

// Is the action legal in this state? step() is pure, so a trial step is
// safe. Returns { ok, error?, after? }.
export function checkAction(rules, state, action) {
  if (!action || typeof action.type !== 'string') return { ok: false, error: 'no action' };
  if (rules.isOver(state)) return { ok: false, error: 'the game is over' };
  try {
    const after = rules.step(state, action);
    return { ok: true, after };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// The object in legal[] with the same actionKey, or null. Attack and
// block lists are compared as sets (the order of the pairs is free).
export function matchLegal(rules, legal, action) {
  const key = canonKey(rules, action);
  for (const a of legal || []) if (canonKey(rules, a) === key) return a;
  return null;
}

function canonKey(rules, a) {
  if (a.type === 'attack') return 'attack:' + a.attackers.slice().sort((x, y) => x - y).join(',');
  if (a.type === 'block') return 'block:' + a.blocks.slice().sort((p, q) => p[0] - q[0]).map(q => q[0] + '>' + q[1]).join(',');
  return rules.actionKey ? rules.actionKey(a) : JSON.stringify(a);
}

// A test human: bot(state, legal) -> action, sent through submit().
export function scriptedHuman(rules, bot, name = 'Script') {
  const h = createHuman({ name, rules });
  h.decide = (state) => {
    const legal = rules.legalActions(state);
    return h.submit(bot(state, legal), state);
  };
  return h;
}
