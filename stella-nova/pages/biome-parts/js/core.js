// ============================================================================
//  BIOME PARTS  ·  core.js — one live build, as messages
// ----------------------------------------------------------------------------
//  PURE. A Runner owns the model and one Episode (agent.js). Every method
//  takes and returns plain objects, so the same Runner runs in the worker
//  (worker.js) and, when module workers are missing, on the main thread
//  (brain.js). The saver director and the node soak test call it directly.
//
//  MESSAGES
//    start({ goal, start, perturb })  -> view    a new build
//    think()                          -> view    one forward pass
//    act({ action, kind })            -> view    one step
//    view                             { step, budget, finished, outcome, result,
//                                       decision, tree, selection, recent, shape,
//                                       ops, edit, progress, expert, log tail }
//
//  GREP MAP
//    class Runner ........ start / think / act / view
//    summarizeDecision ... scores sorted for the bars, done checks
//    sketchView .......... the sketch in edit, for the 2D overlay
// ============================================================================
import { loadModel } from './model.js';
import { Episode } from './agent.js';
import { analyze } from './fcsim.js';
import { iou } from './part.js';

const iouFn = (a, b) => {
  const A = analyze(a), B = analyze(b);
  const lo = [0, 1, 2].map(i => Math.min(A.bbox[0][i], B.bbox[0][i]) - 1), hi = [0, 1, 2].map(i => Math.max(A.bbox[1][i], B.bbox[1][i]) + 1);
  return iou(a, b, { lo, hi }, 48);
};

export function summarizeDecision(d, expert) {
  const rows = d.actions.map((a, i) => ({ a, p: d.calib[i], p1: d.probs[i], z: d.logits[i], teacher: expert.includes(a) }));
  rows.sort((x, y) => y.z - x.z);
  return { rows, choice: d.choice, done: d.done, endDone: d.endDone, active: d.active, tokens: d.tokens };
}
function sketchView(S) {
  if (!S.meta.edit) return null;
  const sk = S.obj(S.meta.edit);
  return sk ? { name: sk.name, frame: sk.frame, geos: sk.geos, nCons: sk.cons.length } : null;
}

export class Runner {
  constructor(M) { this.M = M; this.ep = null; this.d = null; }
  static fromBuffers(buf, config) { return new Runner(loadModel(buf, config)); }
  start({ goal, start, perturb = 0 }) {
    this.ep = new Episode(this.M, goal, start, { perturb });
    this.d = null; this._res = null;
    return this.view();
  }
  think() {
    if (!this.ep || this.ep.finished) return this.view();
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.d = this.ep.think();
    this.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    return this.view();
  }
  act({ action, kind = 'model' }) {
    if (!this.ep || this.ep.finished) return this.view();
    if (!this.d) this.think();
    const a = action || this.d.choice;
    const info = this.ep.act(a, kind, this.d);
    this.lastInfo = info;
    this.d = null;
    return this.view();
  }
  // The IoU fallback runs once per finished build (cached).
  result() {
    if (!this.ep) return null;
    if (this.ep.finished) return this._res || (this._res = this.ep.result(iouFn));
    return this.ep.result(null);
  }
  view() {
    const ep = this.ep;
    if (!ep) return null;
    const S = ep.S, st = S.state();
    const sol = S.solid();
    const v = {
      goal: ep.goal, step: ep.steps, budget: ep.budget, finished: ep.finished, outcome: ep.outcome,
      decision: this.d ? summarizeDecision(this.d, ep.expert) : null, ms: this.ms || 0,
      tree: st.tree.map(n => ({ name: n.name, type: n.type, depth: n.depth, tip: !!n.num.tip, valid: n.num.valid !== 0, edit: !!n.num.in_edit, consumed: !!n.num.consumed })),
      selection: st.selection.map(s => ({ kind: s.kind, object: s.object, count: s.count })),
      recent: st.recent, shape: st.shape, workbench: st.workbench, docOpen: st.doc_open, hasBody: st.has_body, undo: st.undo_available,
      ops: sol ? sol.ops : [], bbox: sol ? sol.A.bbox : null, tipOk: !!sol,
      target: { ops: ep.target.ops, bbox: ep.target.A.bbox },
      edit: sketchView(S), progress: S.progress(), expert: ep.expert, dirty: S.meta.dirty,
      last: ep.log.length ? ep.log[ep.log.length - 1] : null, logLen: ep.log.length,
    };
    if (ep.finished) v.result = this.result();
    return v;
  }
  log() { return this.ep ? this.ep.log.slice() : []; }
}
