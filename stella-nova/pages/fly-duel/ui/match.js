// ============================================================================
//  FLY DUEL  ·  match controller  (pure ES module, no DOM)
// ----------------------------------------------------------------------------
//  Plays one game between two agents, one decision per next() call. The
//  hero and section 07 each own one Match. The rules module (game/rules.js)
//  is passed in, so this file has no static import of another package.
//
//  An agent is { name, kind: 'fly' | 'bot', choose(state, legal, rng) ->
//  { action, values?, scores?, trace? } }. values are MB values of each
//  afterstate; scores are what the policy ranked (brain/agent.js: equal
//  to values, or the imagined-block value for an attack). agentFromFly() wraps brain/fly.js;
//  agentFromBot() wraps a game/bots.js bot.
//
//  The DAN burst on the page comes from the TD error of the fly, per fly:
//    delta = r + gamma * V(this afterstate) - V(previous afterstate)
//  with r = 0 during play and r = +1 win, -1 loss, 0 draw at the end.
//  This is the signal the model would use to learn. In the show the
//  weights do not change (learning is off), the page says so.
//
//  GREP MAP
//      grep -n 'export function agentFromFly'  fly -> agent
//      grep -n 'export function agentFromBot'  bot -> agent
//      grep -n 'export class Match'            the controller
//      grep -n '  next('                       one decision
//      grep -n '  finish('                     terminal TD errors
// ============================================================================

export function agentFromFly(fly, name, { explore = 0 } = {}) {
  return {
    name, kind: 'fly', fly,
    gamma: fly?.gamma ?? fly?.opts?.gamma ?? 1,
    choose(state, legal, rng) { return fly.choose(state, legal, { explore, rng }); },
  };
}

export function agentFromBot(bot, name) {
  return { name, kind: 'bot', gamma: 1, choose(state, legal) { return { action: bot(state, legal) }; } };
}

// A small seeded generator, so the Match has no import of data/rng.js.
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Match {
  // rules: the game/rules.js module namespace. agents: [A, B].
  constructor(rules, agents, { seed = 1, decks = ['amber', 'moss'], names = null } = {}) {
    this.rules = rules; this.agents = agents; this.decks = decks;
    this.names = names || agents.map(a => a.name);
    this.reset(seed);
  }

  reset(seed = this.seed + 1) {
    this.seed = seed >>> 0;
    this.rng = rng32(this.seed ^ 0x9e3779b9);
    const first = this.seed & 1;
    let st;
    try { st = this.rules.newGame({ seed: this.seed, decks: this.decks, first, names: this.names }); }
    catch { st = this.rules.newGame({ seed: this.seed, decks: this.decks, first }); }
    this.state = st;
    this.history = [];       // one record per decision
    this.prevV = [null, null];
    this.result = null;
    return this;
  }

  over() { return this.result || this.rules.isOver(this.state) || null; }

  // One decision. Returns the record, or null when the game is over.
  next() {
    if (this.over()) return null;
    const s = this.state, who = s.toAct;
    const legal = this.rules.legalActions(s);
    if (!legal.length) return null;
    const ag = this.agents[who];
    const t0 = performanceNow();
    const res = ag.choose(s, legal, this.rng) || {};
    const ms = performanceNow() - t0;
    let action = res.action ?? legal[0];
    let idx = legal.indexOf(action);
    if (idx < 0 && this.rules.actionKey) { const k = this.rules.actionKey(action); idx = legal.findIndex(a => this.rules.actionKey(a) === k); }
    const values = res.values ? Array.from(res.values) : null;
    // scores: what the policy ranked (values, or imagined-block values)
    const scores = res.scores ? Array.from(res.scores) : values;
    const value = values && idx >= 0 ? values[idx] : (res.value ?? null);
    let delta = null;
    if (ag.kind === 'fly' && value != null && this.prevV[who] != null) delta = ag.gamma * value - this.prevV[who];
    if (value != null) this.prevV[who] = value;
    let text = '';
    try { text = this.rules.describe(action, s); } catch { text = action.type; }
    const after = this.rules.step(s, action);
    const rec = { i: this.history.length, who, before: s, after, legal, action, idx, values, scores, value, delta, trace: res.trace || null, text, ms };
    this.history.push(rec);
    this.state = after;
    const end = this.rules.isOver(after);
    if (end) this.finish(end);
    return rec;
  }

  // Terminal TD errors: r - V(last afterstate) for each fly.
  finish(end) {
    this.result = end;
    this.finalDelta = [0, 1].map(p => {
      const r = end.winner === -1 ? 0 : end.winner === p ? 1 : -1;
      return this.prevV[p] == null ? null : r - this.prevV[p];
    });
  }
}

function performanceNow() { return (globalThis.performance && performance.now()) || Date.now(); }
