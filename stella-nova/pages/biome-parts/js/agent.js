// ============================================================================
//  BIOME PARTS  ·  agent.js — Taiga-S1 driving the session, step by step
// ----------------------------------------------------------------------------
//  PURE. The policy loop of freecad_s1/rollout.py over fcsim.Session: read the
//  state, list the valid actions, run the model once, take the argmax (or an
//  override), step. The page, the worker, the saver and the tests share it.
//
//  GREP MAP
//    decide ........... one forward pass: scores, done logits, active item
//    Episode .......... a live build: reset / think / act / result
//    runEpisode ....... a whole episode, optionally with injected random
//                       actions (the repo's --perturb robustness test)
// ============================================================================
import { encodeState, encodeActions } from './featurize.js';
import { forward, softmaxT } from './model.js';
import { Session, buildTarget, stepBudget, sameTape } from './fcsim.js';

export function decide(M, S) {
  const state = S.state();
  const actions = S.validActions(state);
  const T = encodeState(state, S.goal);
  const out = forward(M, T, encodeActions(actions));
  const probs = softmaxT(out.logits, 1);
  const calib = softmaxT(out.logits, M.cfg.temperature || 1);
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (out.logits[i] > out.logits[best]) best = i;
  return { state, actions, logits: out.logits, probs, calib, done: out.done.slice(0, -1), endDone: out.done[out.done.length - 1], active: out.active, choice: actions[best], tokens: T.n };
}

// A live build. think() runs the model on the current state; act(a) applies
// a (the model's choice unless the user or the perturbation picked another).
export class Episode {
  constructor(M, goal, start = { doc_open: true, workbench: 'PartDesignWorkbench', body: false }, opt = {}) {
    this.M = M; this.goal = goal; this.start = start;
    this.target = opt.target || buildTarget(goal);
    this.S = new Session(); this.S.reset(goal, start);
    this.budget = stepBudget(goal, start) * (opt.perturb ? 2 : 1);
    this.steps = 0; this.log = []; this.agree = 0; this.policySteps = 0; this.outcome = null; this.overrides = 0;
    this.expert = this.S.expert();
  }
  think() { return (this.last = decide(this.M, this.S)); }
  // kind: 'model' | 'user' | 'noise'
  act(action, kind = 'model', d = this.last) {
    const expert = this.expert;
    if (kind === 'model') { this.agree += +expert.includes(action); this.policySteps++; }
    if (kind === 'user') this.overrides++;
    const info = this.S.step(action);
    this.steps++;
    this.log.push({ step: this.steps, action, kind, onPlan: info.on_plan, error: info.error,
      score: d ? d.calib[d.actions.indexOf(action)] ?? null : null, top: d ? d.choice : null, active: d ? d.active : null });
    this.expert = this.S.expert();
    if (info.done) { this.outcome = 'done'; return info; }
    if (!this.expert.length) { this.outcome = 'unrecoverable'; return info; }
    if (this.steps >= this.budget) { this.outcome = 'budget'; return info; }
    return info;
  }
  get finished() { return this.outcome !== null; }
  result(iouFn = null) {
    const sol = this.S.solid();
    let match = false, iou = 0;
    if (this.outcome === 'done' && sol) {
      if (sameTape(sol.ops, this.target.ops)) { match = true; iou = 1; }
      else if (iouFn) { iou = iouFn(sol.ops, this.target.ops); match = iou >= 0.99; }
    }
    const success = this.outcome === 'done' && match;
    return { success, outcome: success ? 'success' : this.outcome === 'done' ? 'wrong_geometry' : this.outcome, iou, steps: this.steps,
      budget: this.budget, agreement: this.agree / Math.max(this.policySteps, 1), deviations: this.policySteps - this.agree, overrides: this.overrides };
  }
}

export function runEpisode(M, goal, start, opt = {}) {
  const ep = new Episode(M, goal, start, opt);
  const rnd = opt.rng || Math.random;
  while (!ep.finished) {
    const d = ep.think();
    if (opt.perturb && rnd() < opt.perturb) {
      const pool = d.actions.filter(a => a !== 'Done');
      ep.act(pool[Math.floor(rnd() * pool.length)], 'noise', d);
    } else ep.act(d.choice, 'model', d);
    if (opt.onStep) opt.onStep(ep, d);
  }
  return { ...ep.result(opt.iouFn), log: opt.keepLog ? ep.log : undefined, ep: opt.keepEpisode ? ep : undefined };
}
