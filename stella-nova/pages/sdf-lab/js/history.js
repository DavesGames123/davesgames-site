// ============================================================================
//  SDF FORGE  ·  history.js — undo and redo
// ----------------------------------------------------------------------------
//  PURE. One stack of applied edits, one stack of undone ones (Forge's
//  history model). Nothing here touches the GPU or the page.
//
//  TWO RECORD KINDS
//    'set'  a list of changes { id, path, before, after }. A parameter edit,
//           a gizmo drag, a rename. Small, and the common case.
//    'doc'  the whole document before and after, as JSON text. A create, a
//           delete, a regroup, a modifier added or moved, an example loaded.
//           A document is a few kilobytes (it carries no triangles, like a
//           Forge record carries no mesh), so a snapshot is cheap and exact.
//
//  COALESCING IS MARKED, NOT GUESSED. A drag writes a value every frame. The
//  caller brackets the run with begin(key) and end(), and every 'set' pushed
//  between them with the same key merges into one record. A merge keeps the
//  FIRST before and the LAST after, so one undo returns the press point. A
//  record pushed with { merge: true } also merges with the record before it
//  when it names the same paths within MERGE_MS, for a typed value or a held
//  arrow key that has no press to mark.
//
//  A NO-OP IS NOT AN EDIT. A drag that returns to its press point leaves a
//  record whose before equals its after; it is dropped.
//
//  THE LIMIT IS A MEMORY BOUND. Past LIMIT records the oldest goes.
//
//  GREP MAP
//    class History ...... push / begin / end / undo / redo / canUndo / clear
//    applyRecord ........ apply one record forward or back to a document
// ============================================================================
import * as D from './doc.js';

export const LIMIT = 400;
export const MERGE_MS = 700;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = r => r.kind === 'set' ? r.changes.map(c => c.id + ':' + c.path).join('|') : null;

export class History {
  constructor() { this.done = []; this.undone = []; this.open = null; this.rev = 0; }
  begin(key) { this.open = { key, rec: null }; }
  end() {
    if (this.open && this.open.rec && this.isNoop(this.open.rec)) {
      const i = this.done.lastIndexOf(this.open.rec);
      if (i >= 0) this.done.splice(i, 1);
    }
    this.open = null;
  }
  isNoop(r) { return r.kind === 'set' ? r.changes.every(c => same(c.before, c.after)) : r.before === r.after; }
  // Push a record. Returns false when it was a no-op.
  push(rec, opt = {}) {
    rec.t = opt.now ?? Date.now();
    this.rev++;
    if (rec.kind === 'set') {
      const top = this.done[this.done.length - 1];
      const inDrag = this.open && this.open.rec && this.open.rec === top && keyOf(top) === keyOf(rec);
      const timed = opt.merge && top && top.merge && keyOf(top) === keyOf(rec) && rec.t - top.t < MERGE_MS;
      if (inDrag || timed) {
        top.changes.forEach((c, i) => { c.after = rec.changes[i].after; });
        top.t = rec.t;
        if (!this.open && this.isNoop(top)) this.done.pop();
        this.undone = [];
        return true;
      }
      rec.merge = !!opt.merge;
    }
    if (this.isNoop(rec) && !this.open) return false;
    this.done.push(rec);
    if (this.open) this.open.rec = rec;
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
    return true;
  }
  canUndo() { return this.done.length > 0; }
  canRedo() { return this.undone.length > 0; }
  undo(doc) {
    const r = this.done.pop();
    if (!r) return null;
    this.undone.push(r); this.rev++;
    return { doc: applyRecord(doc, r, -1), rec: r };
  }
  redo(doc) {
    const r = this.undone.pop();
    if (!r) return null;
    this.done.push(r); this.rev++;
    return { doc: applyRecord(doc, r, +1), rec: r };
  }
  clear() { this.done = []; this.undone = []; this.open = null; this.rev++; }
}

// Apply a record. dir +1 is redo, -1 is undo. Returns the document, which is a
// NEW object for a 'doc' record, so the caller must keep the return value.
export function applyRecord(doc, r, dir) {
  if (r.kind === 'doc') return D.fromJSON(dir > 0 ? r.after : r.before);
  const list = dir > 0 ? r.changes : r.changes.slice().reverse();
  for (const c of list) D.setPath(doc, c.id, c.path, dir > 0 ? c.after : c.before);
  return doc;
}
// Is a record a structure change (a shader rebuild)?
export const isStructuralRecord = r => r.kind === 'doc' || r.changes.some(c => D.isStructural(c.path));
