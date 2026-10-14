// ============================================================================
//  BREADBOARD LAB  ·  core/store.js — edits, undo and redo
// ----------------------------------------------------------------------------
//  Every edit of the document is an Op (CONTRACT 4.1). applyOp is pure: it
//  returns a NEW document and leaves the old one as it was. Untouched arrays
//  and items are shared between the two, so a reader can find what changed
//  by reference (the view rebuilds only items whose object changed).
//
//  applyOp also returns the inverse op, so undo is "apply the inverse".
//  The inverse restores the document exactly (deep-equal), including the
//  index of a removed item and the id counter (doc.nextId).
//
//  topology = the edit can change which nodes connect (CONTRACT 4.1). Then
//  main.js rebuilds the netlist; else it only patches params in the sim.
//
//  Removal cascades: a removed board takes its parts and the wires on its
//  holes; a removed part takes its wires and its program; probe leads on
//  removed things go to null. The inverse puts all of it back.
//
//  GREP MAP
//    findItem / locate ...... id → kind, array, index
//    opAdd / opRemove ....... add (with index) and cascading remove
//    opMove ................. place of a board, part or probe
//    opSet / setPath ........ copy-on-write path writes ('params.r', 'via.0')
//    setTopology ............ which set paths change connectivity
//    opProgram / opMeta ..... MCU programs, title / notes / sim / nextId
//    applyOp ................ dispatcher, batch
//    createStore ............ history, merge window (600 ms), history:false, newId, load
//    snapshot / restore ..... the document with its undo and redo stacks
// ============================================================================
import { COLLECTION, ID_RE, PREFIX, idNumber, kindOfId, lookupDef } from './doc.js';
import { parseHoleId } from './space.js';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const KINDS = Object.keys(COLLECTION);
export const MERGE_MS = 600;

export function locate(doc, id) {
  const kind = kindOfId(id);
  if (!kind) return null;
  const coll = COLLECTION[kind];
  const arr = doc[coll] || [];
  const index = arr.findIndex(it => it && it.id === id);
  return index < 0 ? null : { kind, coll, index, item: arr[index] };
}
export const findItem = (doc, id) => { const l = locate(doc, id); return l ? l.item : null; };

function replaceAt(doc, coll, index, item) {
  const arr = doc[coll].slice();
  arr[index] = item;
  return { ...doc, [coll]: arr };
}

const endOnPart = (e, ids) => !!(e && e.part && ids.has(e.part));
const endOnBoard = (e, ids) => { if (!e || !e.hole) return false; const h = parseHoleId(e.hole); return !!(h && ids.has(h.board)); };

// ── add ────────────────────────────────────────────────────────────────────
function opAdd(doc, op) {
  const { kind, item } = op;
  if (!COLLECTION[kind]) throw new Error(`add: unknown kind "${kind}"`);
  if (!isObj(item) || typeof item.id !== 'string') throw new Error('add: item needs an id');
  if (!ID_RE[kind].test(item.id)) throw new Error(`add: id "${item.id}" does not fit kind ${kind}`);
  if (locate(doc, item.id)) throw new Error(`add: id "${item.id}" exists`);
  const coll = COLLECTION[kind];
  const arr = doc[coll].slice();
  const at = Number.isInteger(op.index) ? Math.max(0, Math.min(arr.length, op.index)) : arr.length;
  arr.splice(at, 0, clone(item));
  const out = { ...doc, [coll]: arr };
  const inverse = { op: 'remove', ids: [item.id] };
  const n = idNumber(item.id);
  if (kind !== 'material' && kind !== 'customPart' && n >= doc.nextId) { out.nextId = n + 1; inverse.nextId = doc.nextId; }
  return { doc: out, inverse, topology: kind !== 'material' };
}

// ── remove ─────────────────────────────────────────────────────────────────
function opRemove(doc, op) {
  const ids = new Set((op.ids || []).filter(id => locate(doc, id)));
  const boards = new Set([...ids].filter(id => kindOfId(id) === 'board'));
  for (const p of doc.parts) if (p.place && p.place.on && boards.has(p.place.on)) ids.add(p.id);
  const parts = new Set([...ids].filter(id => kindOfId(id) === 'part'));
  for (const w of doc.wires) {
    if (endOnPart(w.a, parts) || endOnPart(w.b, parts) || endOnBoard(w.a, boards) || endOnBoard(w.b, boards)) ids.add(w.id);
  }
  let out = doc;
  const restore = [];                               // inverse ops in apply order
  let topology = false;
  // Leads first (they must point back after the items return).
  const leadFix = [];
  for (const m of doc.probes) {
    if (ids.has(m.id) || !isObj(m.leads)) continue;
    for (const [name, e] of Object.entries(m.leads)) {
      if (e && (endOnPart(e, parts) || endOnBoard(e, boards))) leadFix.push({ id: m.id, name, old: e });
    }
  }
  for (const f of leadFix) {
    const r = opSet(out, { op: 'set', id: f.id, path: 'leads.' + f.name, value: null });
    out = r.doc;
  }
  const programs = [];
  for (const pid of parts) if (doc.programs && doc.programs[pid] !== undefined) programs.push({ id: pid, program: doc.programs[pid] });
  if (programs.length) {
    const pr = { ...out.programs };
    for (const p of programs) delete pr[p.id];
    out = { ...out, programs: pr };
  }
  // Items, collection by collection, with their original indexes.
  for (const kind of KINDS) {
    const coll = COLLECTION[kind];
    const removed = [];
    const keep = [];
    doc[coll].forEach((it, index) => { if (ids.has(it.id)) removed.push({ index, item: it }); else keep.push(it); });
    if (!removed.length) continue;
    if (kind !== 'material') topology = true;
    // keep entries that a lead fix replaced (leads live on probes)
    out = { ...out, [coll]: kind === 'probe' ? out.probes.filter(it => !ids.has(it.id)) : keep };
    for (const r of removed) restore.push({ op: 'add', kind, item: r.item, index: r.index });
  }
  // The order of re-adds: each collection ascending by index.
  for (const p of programs) restore.push({ op: 'program', id: p.id, program: p.program });
  for (const f of leadFix) restore.push({ op: 'set', id: f.id, path: 'leads.' + f.name, value: f.old });
  if (leadFix.length) topology = true;
  if (Number.isFinite(op.nextId)) { restore.push({ op: 'meta', nextId: out.nextId }); out = { ...out, nextId: op.nextId }; }
  else restore.push({ op: 'meta', nextId: doc.nextId });
  return { doc: out, inverse: { op: 'batch', ops: restore }, topology };
}

// ── move ───────────────────────────────────────────────────────────────────
function opMove(doc, op) {
  const loc = locate(doc, op.id);
  if (!loc) throw new Error(`move: no item "${op.id}"`);
  if (!isObj(op.place)) throw new Error('move: place is missing');
  const { kind, item } = loc;
  if (kind === 'board') {
    const old = { x: item.x, z: item.z, rot: item.rot };
    const nb = { ...item };
    for (const k of ['x', 'z', 'rot']) if (op.place[k] !== undefined) nb[k] = k === 'rot' ? ((op.place.rot % 4) + 4) % 4 : op.place[k];
    return { doc: replaceAt(doc, loc.coll, loc.index, nb), inverse: { op: 'move', id: op.id, place: old }, topology: true };
  }
  if (kind !== 'part' && kind !== 'probe') throw new Error(`move: a ${kind} has no place`);
  const old = clone(item.place) || {};
  const place = { ...old, ...clone(op.place) };
  if (place.rot !== undefined) place.rot = ((place.rot % 4) + 4) % 4;
  const ni = { ...item, place };
  let topology = kind === 'part';
  if (kind === 'part' && !old.on && !place.on) {
    const wired = doc.wires.some(w => (w.a && w.a.part === item.id) || (w.b && w.b.part === item.id));
    topology = wired;
  }
  return { doc: replaceAt(doc, loc.coll, loc.index, ni), inverse: { op: 'move', id: op.id, place: old }, topology };
}

// ── set ────────────────────────────────────────────────────────────────────
// Writes value at path inside obj with copy-on-write. Returns the new object,
// the old value, and the depth of the first container that did not exist.
export function setPath(obj, segs, value) {
  let created = -1;
  const write = (node, i) => {
    const key = segs[i];
    const isArr = Array.isArray(node);
    const copy = isArr ? node.slice() : { ...node };
    if (i === segs.length - 1) {
      const old = copy[key];
      if (value === undefined) { if (isArr) copy[key] = undefined; else delete copy[key]; }
      else copy[key] = value;
      return { node: copy, old };
    }
    let child = copy[key];
    if (child === undefined || child === null || typeof child !== 'object') {
      if (created < 0) created = i;
      child = /^\d+$/.test(segs[i + 1]) ? [] : {};
    }
    const r = write(child, i + 1);
    copy[key] = r.node;
    return { node: copy, old: created >= 0 ? undefined : r.old };
  };
  const r = write(obj, 0);
  return { obj: r.node, old: r.old, created };
}

export function getPath(obj, path) {
  let v = obj;
  for (const s of String(path).split('.')) { if (v === null || v === undefined) return undefined; v = v[s]; }
  return v;
}

export function setTopology(doc, kind, item, path, ctx) {
  const head = path.split('.')[0];
  switch (kind) {
    case 'wire': return head === 'a' || head === 'b';
    case 'probe': return head === 'leads' || head === 'type' || path === 'settings.mode' || head === 'settings' && path.split('.').length === 1;
    case 'board': return head === 'params' || head === 'type';
    case 'customPart': return true;
    case 'material': return false;
    case 'part': {
      if (head === 'def' || head === 'place') return true;
      if (head !== 'params') return false;
      const key = path.split('.')[1];
      if (key === undefined) return true;
      const def = lookupDef(doc, ctx && ctx.registry, item.def);
      const pd = def && Array.isArray(def.params) ? def.params.find(p => p.key === key) : null;
      return !!(pd && pd.geometric);
    }
    default: return false;
  }
}

function opSet(doc, op, ctx) {
  const loc = locate(doc, op.id);
  if (!loc) throw new Error(`set: no item "${op.id}"`);
  if (typeof op.path !== 'string' || !op.path) throw new Error('set: path is missing');
  const segs = op.path.split('.');
  if (segs[0] === 'id') throw new Error('set: the id cannot change');
  const r = setPath(loc.item, segs, clone(op.value));
  const inverse = r.created >= 0
    ? { op: 'set', id: op.id, path: segs.slice(0, r.created + 1).join('.'), value: undefined }
    : { op: 'set', id: op.id, path: op.path, value: clone(r.old) };
  return { doc: replaceAt(doc, loc.coll, loc.index, r.obj), inverse, topology: setTopology(doc, loc.kind, loc.item, op.path, ctx) };
}

// ── program / meta ─────────────────────────────────────────────────────────
function opProgram(doc, op) {
  if (!locate(doc, op.id)) throw new Error(`program: no part "${op.id}"`);
  const programs = { ...(doc.programs || {}) };
  const old = programs[op.id];
  if (op.program === null || op.program === undefined) delete programs[op.id];
  else programs[op.id] = clone(op.program);
  return { doc: { ...doc, programs }, inverse: { op: 'program', id: op.id, program: old === undefined ? null : clone(old) }, topology: false };
}

function opMeta(doc, op) {
  const out = { ...doc };
  const inv = { op: 'meta' };
  for (const k of ['title', 'notes']) if (op[k] !== undefined) { inv[k] = doc[k]; out[k] = String(op[k]); }
  if (isObj(op.sim)) { inv.sim = clone(doc.sim); out.sim = { ...doc.sim, ...clone(op.sim) }; }
  if (Number.isFinite(op.nextId)) { inv.nextId = doc.nextId; out.nextId = op.nextId; }
  if (op.view !== undefined) { inv.view = doc.view === undefined ? null : clone(doc.view); if (op.view === null) delete out.view; else out.view = clone(op.view); }
  return { doc: out, inverse: inv, topology: false };
}

// ── dispatcher ─────────────────────────────────────────────────────────────
export function applyOp(doc, op, ctx = {}) {
  if (!isObj(op)) throw new Error('op is not an object');
  switch (op.op) {
    case 'add': return opAdd(doc, op);
    case 'remove': return opRemove(doc, op);
    case 'move': return opMove(doc, op);
    case 'set': return opSet(doc, op, ctx);
    case 'program': return opProgram(doc, op);
    case 'meta': return opMeta(doc, op);
    case 'batch': {
      let cur = doc, topology = false;
      const inv = [];
      for (const sub of op.ops || []) {
        const r = applyOp(cur, sub, ctx);
        cur = r.doc; topology = topology || r.topology;
        inv.push(r.inverse);
      }
      return { doc: cur, inverse: { op: 'batch', ops: inv.reverse() }, topology };
    }
    default: throw new Error(`unknown op "${op.op}"`);
  }
}

// ── store ──────────────────────────────────────────────────────────────────
export function createStore(doc, bus, opts = {}) {
  const ctx = { registry: opts.registry || null };
  const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const limit = opts.limit || 400;
  let cur = doc;
  let undoStack = [], redoStack = [];
  let reserved = 0;
  const emit = (ops, topology, source) => { if (bus) bus.emit('doc:change', { ops, topology, source }); };

  function run(ops, source) {
    let topology = false;
    for (const op of ops) { const r = applyOp(cur, op, ctx); cur = r.doc; topology = topology || r.topology; }
    emit(ops, topology, source);
  }

  const store = {
    get doc() { return cur; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get registry() { return ctx.registry; },
    set registry(r) { ctx.registry = r; },

    apply(op, o = {}) {
      let r;
      try { r = applyOp(cur, op, ctx); }
      catch (err) {
        if (bus) bus.emit('toast', { level: 'error', text: 'Edit failed: ' + err.message });
        if (opts.strict) throw err;
        return null;
      }
      cur = r.doc;
      if (o.history === false) {          // momentary edits (a held button): no undo step
        emit([op], r.topology, 'user');
        return r.inverse;
      }
      redoStack = [];
      const t = now();
      const top = undoStack[undoStack.length - 1];
      if (o.merge && top && top.merge === o.merge && t - top.time <= MERGE_MS) {
        const last = top.ops[top.ops.length - 1];
        if (op.op === 'set' && last && last.op === 'set' && last.id === op.id && last.path === op.path) top.ops[top.ops.length - 1] = op;
        else { top.ops.push(op); top.inverses.push(r.inverse); }
        top.time = t;
      } else {
        undoStack.push({ ops: [op], inverses: [r.inverse], merge: o.merge || null, time: t });
        if (undoStack.length > limit) undoStack.shift();
      }
      emit([op], r.topology, 'user');
      return r.inverse;
    },

    // Closes the merge window, so the next merge op starts a new undo step.
    seal() { const top = undoStack[undoStack.length - 1]; if (top) top.merge = null; },

    undo() {
      const e = undoStack.pop();
      if (!e) return false;
      run(e.inverses.slice().reverse(), 'undo');
      redoStack.push(e);
      return true;
    },
    redo() {
      const e = redoStack.pop();
      if (!e) return false;
      // Redo re-applies the forward ops; their inverses may differ in
      // detail (the nextId field), so they are recomputed.
      const inv = [];
      let topology = false;
      for (const op of e.ops) { const r = applyOp(cur, op, ctx); cur = r.doc; inv.push(r.inverse); topology = topology || r.topology; }
      undoStack.push({ ops: e.ops, inverses: inv, merge: null, time: 0 });
      emit(e.ops, topology, 'redo');
      return true;
    },

    load(doc2) {
      cur = doc2;
      undoStack = []; redoStack = []; reserved = 0;
      emit([], true, 'load');
    },

    // A fresh id. Successive calls before the add lands give distinct ids.
    newId(kind) {
      if (!PREFIX[kind]) throw new Error(`newId: unknown kind "${kind}"`);
      let n = Math.max(cur.nextId | 0, reserved, 1);
      while (locate(cur, PREFIX[kind] + n)) n++;
      reserved = n + 1;
      return PREFIX[kind] + n;
    },

    // The whole state (document and history), for a visitor that borrows
    // the bench (the screensaver) and gives it back. Documents are copy-on-
    // write, so the references stay valid.
    snapshot() { return { doc: cur, undo: undoStack.slice(), redo: redoStack.slice(), reserved }; },
    restore(snap) {
      if (!snap || !snap.doc) return;
      cur = snap.doc;
      undoStack = (snap.undo || []).slice(); redoStack = (snap.redo || []).slice(); reserved = snap.reserved || 0;
      emit([], true, 'load');
    },

    find(id) { return findItem(cur, id); },
    history() { return { undo: undoStack.length, redo: redoStack.length }; },
  };
  return store;
}
