// ============================================================================
//  FLY DUEL  ·  the fly agent, game-free core  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  FlyAgent puts one MushroomBody (brain/mb.js) in a card-game seat. The
//  game functions come in as opts.game = { step, features, isOver,
//  newGame?, legalActions? }, so tests can use a stub game. brain/fly.js
//  binds the real game/rules.js and game/features.js and exports Fly.
//
//  DECISION (choose).  For each legal action a, the fly looks at the
//  afterstate step(state, a) through features(after, me), the "smell" of
//  that board. The MB value of the smell is its approach-minus-avoid
//  drive. A finished afterstate has its true value (+1 win, -1 loss, 0
//  draw) and needs no smell. Softmax at temperature `explore` picks the
//  action (explore 0 = greedy, first best on ties).
//
//  LEARNING.  TD(lambda) on afterstate values, in the fly's own decision
//  sequence x_0, x_1, ... (the opponent moves between two of them).
//      delta_t = r_t + gamma * V(x_{t+1}) - V(x_t)
//  At the end, V(x_{T+1}) is replaced by the final reward: +1 win, -1
//  loss, 0 draw (game turn cap). The DAN signal is danFromDelta(delta).
//  The KC eligibility trace decays by gamma * lambda per own decision.
//  Two ways to drive it. Use one way per game.
//    A. choose(state, legal, { learn: true }) does the step from the last
//       chosen afterstate to the new one. observe(.., reward, false)
//       only adds reward to the next step. At the end of the game call
//       observe(null, finalState, reward, true) on both flies.
//    B. choose without learn. After each own move, when the opponent has
//       moved and this fly must act again, call observe(prevState, state,
//       reward, false): the bootstrap is V(features(state, me)), the smell
//       of the decision board. At the end, observe(.., reward, true).
//  observe(.., true) uses the last pattern once and then clears it, so a
//  second end call does nothing.
//
//  IMAGINED BLOCK (optional, opts.imagine, default false).  Model step,
//  not fly biology. An attack afterstate is the block phase: the outcome
//  depends on the opponent's block, and the 48 features do not show the
//  declared attackers. So a pure afterstate fly cannot tell good attacks
//  from bad ones. With imagine on, the policy scores such an afterstate
//  by the worst MB value over the opponent's legal blocks. TD still
//  learns on the afterstate values. Measured in node (seed 1, training
//  vs greedyBot, eval 200 games with greedy play, checkpoints every
//  1200 or 3000 games): win rate vs greedyBot 0.17-0.28 with imagine
//  (6000 games), 0.02-0.04 without (15000 games). These are dev runs,
//  not the page numbers (train/ measures those).
//
//  SHAPED REWARD (optional, opts.shaping, default 0 = off).  Potential
//  based (Ng, Harada, Russell 1999), so it does not change which policy is
//  best: r_t += gamma * Phi(x_{t+1}) - Phi(x_t), Phi = shaping * (my life
//  - opponent life) / 20, clamped to [-shaping, shaping], Phi(end) = 0.
//
//  EXPORTS   (jump with grep -n "<anchor>" brain/agent.js)
//      FlyAgent ........ "export class FlyAgent"
//      FLY_DEFAULTS .... "export const FLY_DEFAULTS"
//      choose .......... "  choose("        legal actions -> { action, values, trace }
//      observe ......... "  observe("       one TD step / end of game
//      reset ........... "  reset("         new game: clear trace and last
//      buildTrace ...... "  buildTrace("    PN/KC/MBON/DAN arrays for the view
//      calibrationSet .. "export function calibrationSet"  boards from random games
//      toJSON/fromJSON . "  toJSON(" / "static fromJSON("
// ============================================================================
import { MushroomBody, MB_DEFAULTS } from './mb.js';
import { mulberry32, hashSeed } from '../data/rng.js';

export const FLY_DEFAULTS = {
  name: 'Fly A',
  hemisphere: 'A',
  seed: 1,
  sparsity: 0.05,
  gamma: 0.98,        // discount per own decision
  lambda: 0.7,        // eligibility trace decay (times gamma)
  lr: 0.05,           // part of the TD error removed per update (normalised)
  shaping: 0,         // potential-based shaped reward size (0 = off)
  imagine: false,     // score attacks by the worst opponent block (model)
  calibrationGames: 6,// random games for KC thresholds (needs newGame)
  maxCalibration: 1200,
};

const FORMAT = 'fly-duel-fly/1';

// Boards from random self-play, from both seats, for KC calibration.
// Includes one random afterstate per decision, because the fly scores
// afterstates. Deterministic in seed.
export function calibrationSet(game, { seed = 1, games = 6, max = 1200 } = {}) {
  const { newGame, legalActions, step, isOver, features } = game;
  if (!newGame || !legalActions) return null;
  const rng = mulberry32(hashSeed(`fly-cal:${seed}`));
  const out = [];
  for (let g = 0; g < games && out.length < max; g++) {
    let s = newGame({ seed: hashSeed(`fly-cal-game:${seed}:${g}`), first: g & 1 });
    for (let t = 0; t < 2000 && !isOver(s); t++) {
      const legal = legalActions(s);
      if (!legal.length) break;
      const a = legal[Math.floor(rng() * legal.length)];
      const next = step(s, a);
      if (rng() < 0.5) {
        out.push(features(s, s.toAct));
        if (!isOver(next)) out.push(features(next, s.toAct));
      }
      s = next;
    }
  }
  // Even spread when over the cap.
  if (out.length > max) { const k = out.length / max; return Array.from({ length: max }, (_, i) => out[Math.floor(i * k)]); }
  return out;
}

export class FlyAgent {
  constructor(connectome, opts = {}) {
    const { game, mb, calibration, ...rest } = opts;
    if (!game || !game.step || !game.features || !game.isOver) throw new Error('FlyAgent: opts.game needs step, features, isOver');
    this.game = game;
    this.opts = { ...FLY_DEFAULTS, ...rest };
    this.connectome = connectome;
    this.name = this.opts.name;
    const o = this.opts;
    if (mb) this.mb = mb;
    else {
      const cal = calibration || calibrationSet(game, { seed: hashSeed(`${o.hemisphere}:${o.seed}`), games: o.calibrationGames, max: o.maxCalibration });
      // Every MB_DEFAULTS key in opts goes to the mushroom body.
      const mbOpts = {};
      for (const k of Object.keys(MB_DEFAULTS)) if (o[k] !== undefined) mbOpts[k] = o[k];
      this.mb = new MushroomBody(connectome, { ...mbOpts, calibration: cal && cal.length ? cal : undefined });
    }
    this.rng = mulberry32(hashSeed(`fly-act:${o.hemisphere}:${o.seed}`));
    this.me = 0;
    this.last = null;        // { kc, phi } of the last chosen afterstate
    this.mode = 'A';         // 'A' learn in choose, 'B' learn in observe
    this.pendingR = 0;       // reward from observe in way A, for the next step
    this.lastTurn = -1;
    this.lastLearn = null;   // { delta, target, dan (per compartment), danNeurons }
    this.decisions = 0;
    this.updates = 0;
  }

  // Potential for the shaped reward. 0 when off or at the end.
  phi(state, me = this.me) {
    const sh = this.opts.shaping;
    if (!sh || !state || !state.players) return 0;
    if (this.game.isOver(state)) return 0;
    const d = ((state.players[me]?.life ?? 0) - (state.players[1 - me]?.life ?? 0)) / 20;
    return sh * Math.max(-1, Math.min(1, d));
  }

  // New game: forget the last pattern and clear the trace.
  reset() { this.last = null; this.lastTurn = -1; this.pendingR = 0; this.mb.clearTrace(); }

  // One TD update toward target from the last pattern (uses the trace).
  _learnTo(target) {
    const mb = this.mb, last = this.last;
    const v = mb.valueOfKc(last.kc);
    const delta = target - v;
    const dan = mb.danFromDelta(delta);
    const res = mb.learn(null, dan, this.opts.lr, last.kc);
    this.updates++;
    this.lastLearn = { delta, target, before: v, after: mb.valueOfKc(last.kc), dan, danNeurons: mb.danNeurons(dan), clamped: res.clamped };
    return this.lastLearn;
  }

  // Score each afterstate, pick one. ctx: { explore = 0, rng, learn =
  // false, trace = true, epsilon = 0 }. Returns { action, index, values
  // (MB value per option), scores (what the policy used: values, or the
  // imagined block values), probs, trace, learned }.
  choose(state, legal, ctx = {}) {
    const { explore = 0, rng = this.rng, learn = false, trace = true, epsilon = 0 } = ctx;
    if (!legal || !legal.length) throw new Error('FlyAgent.choose: no legal action');
    const { step, isOver, features } = this.game;
    const mb = this.mb, me = state.toAct;
    if (state.turn != null && state.turn < this.lastTurn) this.reset();
    this.me = me;
    const n = legal.length;
    const values = new Array(n), kcs = new Array(n), afters = new Array(n), feats = new Array(n), terminal = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const after = step(state, legal[i]);
      afters[i] = after;
      const over = isOver(after);
      if (over) {
        terminal[i] = 1;
        values[i] = over.winner === me ? 1 : over.winner === -1 ? 0 : -1;
      } else {
        const f = features(after, me);
        feats[i] = f;
        const kc = mb.kcActivity(mb.encode(f)).slice();
        kcs[i] = kc;
        values[i] = mb.valueOfKc(kc);
      }
    }
    // Imagined block (opts.imagine, off by default). Model, not biology:
    // when an action hands the opponent a block choice, score it by the
    // worst value over the opponent's blocks. TD still learns on values.
    const scores = this.opts.imagine ? values.map((v, i) => this._imagine(afters[i], me, v, terminal[i])) : values;
    // policy
    let best = 0;
    for (let i = 1; i < n; i++) if (scores[i] > scores[best]) best = i;
    const probs = new Array(n).fill(0);
    let index = best;
    if (explore > 0) {
      let z = 0;
      for (let i = 0; i < n; i++) { probs[i] = Math.exp((scores[i] - scores[best]) / explore); z += probs[i]; }
      for (let i = 0; i < n; i++) probs[i] /= z;
      let u = rng(), acc = 0;
      index = n - 1;
      for (let i = 0; i < n; i++) { acc += probs[i]; if (u < acc) { index = i; break; } }
    } else probs[best] = 1;
    if (epsilon > 0 && rng() < epsilon) index = Math.floor(rng() * n);

    // learning: step from the last chosen afterstate to this one
    let learned = null;
    const gamma = this.opts.gamma;
    const chosenTerminal = !!terminal[index];
    const phiNew = chosenTerminal ? 0 : this.phi(afters[index], me);
    this.mode = learn ? 'A' : 'B';
    if (learn && this.last) {
      const r = this.pendingR + gamma * phiNew - this.last.phi;
      this.pendingR = 0;
      learned = this._learnTo(chosenTerminal ? values[index] + r : r + gamma * values[index]);
      // the value changed: rescore the chosen pattern for the trace view
      if (!chosenTerminal) values[index] = mb.valueOfKc(kcs[index]);
    }
    if (chosenTerminal) {
      // Way A: the step to the end is done. Way B: keep the last pattern
      // for observe(.., true).
      if (learn) { this.last = null; this.pendingR = 0; this.mb.clearTrace(); }
    } else {
      // A live trace means mid-game (reset clears it), in both ways A and B.
      mb.traceStep(kcs[index], mb.eligN > 0 ? gamma * this.opts.lambda : 0);
      this.last = { kc: kcs[index], phi: phiNew };
    }
    this.lastTurn = state.turn ?? -1;
    this.decisions++;

    const out = { action: legal[index], index, values, scores, probs, learned, trace: null };
    if (trace) out.trace = this.buildTrace(feats[index] || (chosenTerminal ? safeFeatures(features, afters[index], me) : null), { me, index, values, probs, terminal: chosenTerminal });
    return out;
  }

  _imagine(after, me, v, isTerminal) {
    const { legalActions, step, isOver, features } = this.game;
    if (isTerminal || !legalActions || after.toAct === me || after.phase !== 'block') return v;
    const mb = this.mb;
    let worst = Infinity;
    for (const b of legalActions(after)) {
      const s2 = step(after, b), over = isOver(s2);
      const w = over ? (over.winner === me ? 1 : over.winner === -1 ? 0 : -1) : mb.valueOfKc(mb.kcActivity(mb.encode(features(s2, me))));
      if (w < worst) worst = w;
    }
    return worst === Infinity ? v : worst;
  }

  // PN, KC, MBON and DAN arrays of one board, for the brain view.
  // DAN = the last learning signal (per DAN neuron, burst only), or zeros.
  buildTrace(feat, extra = {}) {
    const mb = this.mb;
    const ev = feat ? mb.evaluate(feat) : { pn: new Float32Array(mb.nPN), kc: new Uint16Array(0), mbon: new Float32Array(mb.nMBON), value: 0 };
    const L = this.lastLearn;
    return {
      ...extra,
      fly: this.name, hemisphere: mb.hemisphere,
      features: feat ? Float32Array.from(feat) : null,
      glomeruli: mb._glom.slice(),
      pn: ev.pn, kc: ev.kc, mbon: ev.mbon, value: ev.value,
      valence: mb.valence, kActive: mb.k, kcLive: mb.nLive,
      delta: L ? L.delta : 0,
      danCompartment: L ? L.dan.slice() : new Float32Array(mb.compartments.length),
      dan: L ? L.danNeurons.slice() : new Float32Array(mb.nDAN),
    };
  }

  // End of game (both ways), or one step in way B. reward: +1 win, -1
  // loss, 0 draw or none. Returns the learning record, or null.
  observe(prevState, state, reward = 0, done = false) {
    if (done) {
      if (!this.last) { this.reset(); return null; }
      const res = this._learnTo(this.pendingR + reward - this.last.phi);
      this.reset();
      return res;
    }
    if (this.mode === 'A' || !this.last) { this.pendingR += reward; return null; }
    const mb = this.mb, me = this.me, g = this.opts.gamma;
    const v = mb.valueOfKc(mb.kcActivity(mb.encode(this.game.features(state, me))));
    const res = this._learnTo(this.pendingR + reward + g * this.phi(state, me) - this.last.phi + g * v);
    this.pendingR = 0;
    return res;
  }

  toJSON() {
    return { format: FORMAT, name: this.name, opts: this.opts, decisions: this.decisions, updates: this.updates, mb: this.mb.toJSON() };
  }

  static fromJSON(connectome, json, game, Cls = FlyAgent) {
    if (!json || json.format !== FORMAT) throw new Error(`FlyAgent.fromJSON: format ${json && json.format} is not ${FORMAT}`);
    const mb = MushroomBody.fromJSON(connectome, json.mb);
    const f = new Cls(connectome, { ...json.opts, game, mb });
    f.decisions = json.decisions | 0; f.updates = json.updates | 0;
    return f;
  }
}

function safeFeatures(features, s, me) { try { return features(s, me); } catch { return null; } }
