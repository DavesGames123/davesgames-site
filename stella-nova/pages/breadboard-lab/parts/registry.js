// ============================================================================
//  BREADBOARD LAB  ·  parts/registry.js — the part definition registry
// ----------------------------------------------------------------------------
//  The registry holds the built-in defs and the custom defs of the document.
//  A built-in def is frozen and cannot be removed or replaced. A custom def
//  passes validateDef first; `add` of an id that exists replaces the custom
//  def (the part editor saves this way).
//
//  `list(category)` keeps insertion order, so the LIBRARY panel shows the
//  parts in the order the def files give.
//
//  GREP MAP
//    createRegistry ......... reg.get / list / add / remove / validate / categories
//    deepFreeze ............. built-ins are read-only
// ============================================================================
import { CATEGORIES, validateDef } from './schema.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export function createRegistry(builtins = []) {
  const map = new Map();
  const builtin = new Set();
  for (const d of builtins) {
    const errors = validateDef(d);
    if (errors.length) throw new Error(`built-in part ${d && d.id} is invalid:\n  ` + errors.join('\n  '));
    if (map.has(d.id)) throw new Error(`duplicate built-in part id ${d.id}`);
    map.set(d.id, deepFreeze(d));
    builtin.add(d.id);
  }
  const reg = {
    categories: CATEGORIES.slice(),
    get: id => map.get(id) || null,
    has: id => map.has(id),
    isBuiltin: id => builtin.has(id),
    list(category) {
      const all = [...map.values()];
      return category ? all.filter(d => d.category === category) : all;
    },
    validate: def => validateDef(def),
    add(def) {
      const errors = validateDef(def);
      if (def && builtin.has(def.id)) errors.push(`${def.id}: a built-in part has this id`);
      if (errors.length) return { ok: false, errors };
      map.set(def.id, def);
      return { ok: true, errors: [] };
    },
    remove(id) {
      if (builtin.has(id) || !map.has(id)) return false;
      map.delete(id);
      return true;
    },
  };
  return reg;
}
