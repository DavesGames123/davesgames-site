// ============================================================================
//  MATERIAL STUDIO  ·  store.js — the single app state and the event bus
// ────────────────────────────────────────────────────────────────────────────
//  One mutable `state` object, one event bus, one undo history. Modules read
//  state directly and change it through the setters below, which emit the
//  matching event. Event names and payloads are listed in contract.js EVENTS.
//
//  CONTENTS  (grep -n the name to jump)
//      state ............... the app state (shape documented on the object)
//      on / off / once / emit  the event bus
//      setView / setEnv .... merge a patch, emit view:changed / env:changed
//      setRes .............. change bake resolution, emit res:changed
//      select .............. set the selection, emit graph:select
//      toast ............... emit a toast message
//      setGraphIO .......... the graph module registers serialize/deserialize
//      checkpoint .......... push an undo step after a graph edit
//      undo / redo ......... restore a step, emit graph:changed
//      canUndo / canRedo / resetHistory
//
//  UNDO MODEL
//      History holds serialized graph JSON strings. The graph module calls
//      checkpoint(label) AFTER each finished edit. A slider drag passes
//      {merge:key}: consecutive checkpoints with the same key replace the top
//      step, so one drag is one undo step. Undo and redo call the registered
//      deserialize(json) to rebuild state.graph, then emit graph:changed with
//      reason 'undo' or 'redo'. Until setGraphIO runs, a deep JSON clone is used.
// ============================================================================
import { DEFAULT_SETTINGS, DEFAULT_SCALARS, emptyGraph } from './contract.js';

/**
 * The app state. Modules own the fields named after them.
 * @type {{
 *   graph: any,                      live graph (graph.js object, serializes to contract Graph)
 *   registry: Map<string, import('./contract.js').NodeDef>,
 *   selection: string[],             selected node ids
 *   settings: {res:number, tiling:number, seed:number},
 *   maps: import('./contract.js').MaterialMaps|null,   last bake result
 *   scalars: import('./contract.js').Scalars,
 *   compiled: any,                   last compileGraph result (compile.js)
 *   view: {mesh:string, debug:string, tonemap:string, exposure:number,
 *          displacement:boolean, parallax:boolean, uvScale:number,
 *          autoRotate:boolean, wireframe:boolean, subdiv:number, background:string},
 *   env: {preset:string, rotation:number, intensity:number, background:'hdri'|'blur'|'color',
 *         blur:number, bgColor:string, lights:Array<{type:'dir'|'point', color:string,
 *         intensity:number, dir?:number[], pos?:number[]}>},
 *   ui: Object<string, any>,         free UI flags (panels, mobile, sheet)
 *   gpu: {ok:boolean, reason:string} mirror of gpu.js status
 * }}
 */
export const state = {
  graph: null,
  registry: new Map(),
  selection: [],
  settings: { ...DEFAULT_SETTINGS },
  maps: null,
  scalars: { ...DEFAULT_SCALARS },
  compiled: null,
  view: {
    mesh: 'sphere', debug: 'lit', tonemap: 'aces', exposure: 0,
    displacement: false, parallax: true, uvScale: 1,
    autoRotate: false, wireframe: false, subdiv: 128, background: 'env',
  },
  env: {
    preset: 'studio', rotation: 0, intensity: 1, background: 'blur', blur: 0.35,
    bgColor: '#1a1f2a', lights: [],
  },
  ui: {},
  gpu: { ok: false, reason: 'not started' },
};

// ------------------------------------------------------------ event bus
const handlers = new Map();

/** Subscribe. Returns an unsubscribe function.
 *  @param {string} evt @param {(payload:any)=>void} fn @returns {()=>void} */
export function on(evt, fn) {
  if (!handlers.has(evt)) handlers.set(evt, new Set());
  handlers.get(evt).add(fn);
  return () => off(evt, fn);
}
/** @param {string} evt @param {Function} fn */
export function off(evt, fn) { handlers.get(evt)?.delete(fn); }
/** Subscribe for one call. @param {string} evt @param {Function} fn */
export function once(evt, fn) { const u = on(evt, p => { u(); fn(p); }); return u; }
/**
 * Call each handler of `evt` with `payload`. A handler that throws is logged
 * and does not stop the other handlers. '*' handlers get (evt, payload).
 * @param {string} evt @param {*} [payload]
 */
export function emit(evt, payload) {
  for (const fn of [...(handlers.get(evt) || [])]) {
    try { fn(payload); } catch (e) { console.error(`[store] ${evt} handler`, e); }
  }
  for (const fn of [...(handlers.get('*') || [])]) {
    try { fn(evt, payload); } catch (e) { console.error('[store] * handler', e); }
  }
}

// ------------------------------------------------------------ setters
/** Merge a patch into state.view and emit view:changed. */
export function setView(patch) { Object.assign(state.view, patch); emit('view:changed', state.view); }
/** Merge a patch into state.env and emit env:changed. */
export function setEnv(patch) { Object.assign(state.env, patch); emit('env:changed', state.env); }
/** Set the bake resolution. The graph settings follow. Emits res:changed. */
export function setRes(res) {
  res = Number(res);
  if (!(res > 0) || res === state.settings.res) return;
  state.settings.res = res;
  emit('res:changed', { res });
}
/** Set the selection and emit graph:select. @param {string[]} ids */
export function select(ids) { state.selection = [...ids]; emit('graph:select', { ids: state.selection }); }
/** Show a toast. @param {string} message @param {'info'|'ok'|'warn'|'error'} [kind] @param {number} [ms] */
export function toast(message, kind = 'info', ms) { emit('toast', { message, kind, ms }); }

// ------------------------------------------------------------ undo history
const io = {
  serialize: g => JSON.stringify(g),
  deserialize: json => JSON.parse(json),
};
/**
 * The graph module registers its converters here.
 * @param {{serialize:(graph:any)=>object|string, deserialize:(json:object|string)=>any}} fns
 *   serialize returns contract Graph JSON (object or string);
 *   deserialize takes that JSON and returns the live graph.
 */
export function setGraphIO(fns) {
  if (fns.serialize) io.serialize = g => { const j = fns.serialize(g); return typeof j === 'string' ? j : JSON.stringify(j); };
  if (fns.deserialize) io.deserialize = json => fns.deserialize(JSON.parse(json));
}

const LIMIT = 200;
let past = [];     // [{json, label, merge}] the top is the current graph
let future = [];

function historyEvent(label) {
  emit('history:changed', { canUndo: canUndo(), canRedo: canRedo(), label: label || '' });
}

/**
 * Record the current state.graph as a new undo step. Call AFTER an edit.
 * @param {string} label  short text for the history, for example 'Add Noise'
 * @param {{merge?:string}} [opts]  same merge key as the top step: replace it
 */
export function checkpoint(label, opts = {}) {
  if (!state.graph) return;
  const json = io.serialize(state.graph);
  const top = past[past.length - 1];
  if (top && top.json === json) return;
  if (opts.merge && top && top.merge === opts.merge) { top.json = json; top.label = label; }
  else { past.push({ json, label, merge: opts.merge || null }); if (past.length > LIMIT) past.shift(); }
  future = [];
  historyEvent(label);
}

/** Forget history and make the current graph the base step (after a load). */
export function resetHistory() {
  past = state.graph ? [{ json: io.serialize(state.graph), label: 'load', merge: null }] : [];
  future = [];
  historyEvent('load');
}

export const canUndo = () => past.length > 1;
export const canRedo = () => future.length > 0;

/** Step back one edit. Returns false when there is nothing to undo. */
export function undo() {
  if (!canUndo()) return false;
  const step = past.pop(); future.push(step);
  state.graph = io.deserialize(past[past.length - 1].json);
  emit('graph:changed', { reason: 'undo' });
  historyEvent(step.label);
  return true;
}
/** Step forward one edit. Returns false when there is nothing to redo. */
export function redo() {
  if (!canRedo()) return false;
  const step = future.pop(); past.push(step);
  state.graph = io.deserialize(step.json);
  emit('graph:changed', { reason: 'redo' });
  historyEvent(step.label);
  return true;
}

/** Fallback graph before graph.js loads: a contract Graph JSON object. */
export function blankGraph() { return emptyGraph(); }

/** The store as one object (ctx.store). */
export const store = {
  state, on, off, once, emit, setView, setEnv, setRes, select, toast,
  setGraphIO, checkpoint, resetHistory, undo, redo, canUndo, canRedo, blankGraph,
};
export default store;
