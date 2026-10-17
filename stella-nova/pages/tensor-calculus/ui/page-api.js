// ============================================================================
//  TENSOR CALCULUS  ·  ui/page-api.js  ·  window.tensorPage  (CORE)
// ----------------------------------------------------------------------------
//  The public API of the page, for LEARN (chapters) and SAVER (phase 2).
//  DOM-free: it needs only an object to put the API on (window in the page,
//  a plain object in node tests).
//
//  A chapter module can load before main.js has finished its boot. So
//  installStub() puts a stub on window.tensorPage first. The stub keeps
//  each call in a queue and gives a promise. attach(impl) runs the queue in
//  order on the real implementation and resolves each promise with the
//  result. After attach(), each call goes to impl at once (the methods
//  still return a promise, so a caller can always await them).
//
//  API  (each method returns a Promise; on() returns the unsubscribe
//  function at once, before and after attach)
//    openEntry(id)            open a LIBRARY entry: its TeX, scene, diagram,
//                             story, vocab, params; loads its trace
//    playTrace(trace, opts)   play an OpTrace in all three views in step;
//                             opts { autoplay = true, step = 0, speed }
//    setView(spec)            layout. spec is one of:
//                               'all'                 TeX, 3D and diagram
//                               'tex' | 'viz' | 'diagram'   one in focus
//                               ['tex', 'viz']        two side by side
//                               { focus: 'viz' }      the same as 'viz'
//                               { style: 'penrose'|'birdtrack'|'network' }
//                             the diagram style can go with any layout:
//                               { views: ['tex','diagram'], style: 'network' }
//    setScene(id, params)     show one VIZ scene. It stays while a trace
//                             plays in the TeX and the diagram (a free
//                             scene) until the next trace or follow()
//    follow()                 the 3D view follows the steps again
//    pickIndex(sym | null)    the Indices lens: highlight sym in all views
//    showExpr(texOrExpr)      typeset an expression in the TeX view and the
//                             diagram, with no trace
//    seek(stepIndex, t)       move the player to step stepIndex at t in 0..1
//    pause() / resume()       the player
//    state()                  a plain copy of the page state (below)
//    on(event, fn)            subscribe; returns an unsubscribe function.
//                             Events: 'step' {index, step}, 'tick' {index,
//                             t}, 'view' {views, mode}, 'pick' {sym},
//                             'entry' {id}, 'trace' {trace}
//
//  STATE  (state() returns a copy)
//    { ready, entryId, views: ['tex','viz','diagram'], mode: 'all'|'pair'|
//      'focus', diagramStyle, scene: {id, params}, pickedIndex, playing,
//      speed, stepIndex, t, stepCount, chapter, isPhone, vizFree, missing }
//
//  SAVER SEAM. impl.internals() gives { store, player, layout, views:
//  { tex, viz, diagram } } to saver/index.js. main.js imports
//  ./saver/index.js with a catch, and calls its installSaver(api,
//  internals) when the module exists. CORE does not set window.snSaver.
//
//  EXPORTS   (grep -n "export" ui/page-api.js)
//      METHODS ........... the names of the API methods
//      installStub(win) .. put the queueing stub on win.tensorPage
//      attach(win, impl) . connect the real implementation, run the queue
// ============================================================================

export const METHODS = Object.freeze(['openEntry', 'playTrace', 'setView', 'setScene', 'pickIndex', 'showExpr', 'seek', 'pause', 'resume', 'follow', 'state', 'on']);

export function installStub(win) {
  if (win.tensorPage && win.tensorPage.__core) return win.tensorPage;
  const queue = [];
  let impl = null;
  const listeners = [];   // on() before attach: kept, then given to impl
  const api = { __core: true, version: 1 };
  for (const m of METHODS) {
    api[m] = (...args) => {
      if (impl && m === 'on') return impl.on(...args);
      if (impl) return Promise.resolve().then(() => impl[m](...args));
      if (m === 'state') return Promise.resolve({ ready: false });
      if (m === 'on') {
        const rec = { args, off: null, dead: false };
        listeners.push(rec);
        return () => { rec.dead = true; if (rec.off) rec.off(); };
      }
      return new Promise((resolve, reject) => queue.push({ m, args, resolve, reject }));
    };
  }
  // Sync read of the state, for code that cannot await (render loops).
  api.stateNow = () => (impl ? impl.state() : { ready: false });
  api.ready = new Promise(res => { api.__resolveReady = res; });
  api.__attach = (real) => {
    impl = real;
    for (const rec of listeners) if (!rec.dead) rec.off = real.on(...rec.args);
    listeners.length = 0;
    // Run the queue in order. One failed call does not stop the rest.
    let chain = Promise.resolve();
    for (const q of queue.splice(0)) {
      chain = chain.then(() => Promise.resolve().then(() => real[q.m](...q.args)).then(q.resolve, q.reject));
    }
    return chain.then(() => { api.__resolveReady(api); return api; });
  };
  win.tensorPage = api;
  return api;
}

export function attach(win, impl) {
  for (const m of METHODS) if (typeof impl[m] !== 'function') throw new Error('tensorPage impl has no method ' + m);
  const api = installStub(win);
  if (impl.internals) api.internals = () => impl.internals();
  return api.__attach(impl);
}
