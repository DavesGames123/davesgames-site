// ============================================================================
//  BREADBOARD LAB  ·  core/bus.js — the event bus
// ----------------------------------------------------------------------------
//  One bus connects the store, the view, the UI and main.js (CONTRACT 3.4).
//  Handlers run in the order they were added. A handler that throws does not
//  stop the others: the bus logs the error and goes on. A handler that is
//  removed while an emit runs does not get that emit.
//
//  GREP MAP
//    createBus ........ on / once / emit / off / clear / count
// ============================================================================

export function createBus() {
  const lists = new Map();

  function on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('bus.on: handler must be a function');
    let list = lists.get(type);
    if (!list) { list = []; lists.set(type, list); }
    const rec = { fn, live: true };
    list.push(rec);
    return () => off(type, rec);
  }

  function off(type, rec) {
    const list = lists.get(type);
    if (!list) return;
    const i = list.indexOf(rec);
    if (i >= 0) { list[i].live = false; list.splice(i, 1); }
    if (!list.length) lists.delete(type);
  }

  function once(type, fn) {
    const stop = on(type, payload => { stop(); fn(payload); });
    return stop;
  }

  function emit(type, payload) {
    const list = lists.get(type);
    if (!list) return 0;
    let n = 0;
    for (const rec of list.slice()) {
      if (!rec.live) continue;
      n++;
      try { rec.fn(payload); }
      catch (err) { if (typeof console !== 'undefined') console.error(`bus handler for "${type}" failed`, err); }
    }
    return n;
  }

  return {
    on, once, emit,
    off(type, fn) {                     // remove by function, for callers that kept no handle
      const list = lists.get(type);
      const rec = list && list.find(r => r.fn === fn);
      if (rec) off(type, rec);
    },
    count(type) { return (lists.get(type) || []).length; },
    clear() { for (const list of lists.values()) for (const r of list) r.live = false; lists.clear(); },
  };
}
