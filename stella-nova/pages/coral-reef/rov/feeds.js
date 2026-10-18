// ============================================================================
//  CORAL REEF  ·  ROV  ·  the feed set: one camera feed per ROV of the squad
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should be able to see the camera from all
//  three ROV's on the right side". This set holds one feed.js feed for each
//  vehicle (2 to 4), each with its own HUD canvas, and spends the old render
//  budget of ONE feed on all of them:
//
//  LIVE. One shared rate (feed.js liveRate at the profile fps, with its
//  governor) says when a live frame is due; at most one live frame per main
//  frame, as before. A smooth weighted round robin gives the frame to one
//  active feed: the main feed (the selected ROV) has weight 3, each other
//  feed weight 1. Desktop, 30 fps and 3 ROVs: main 18 fps, others 6 fps
//  each, 30 scene renders a second in all (the old cost). A hidden card
//  (setActiveIds, the phone shows one card) gets no frames, so the shown
//  feeds share the full rate.
//  SIZE. With 3 or 4 feeds every render target is 0.75 x the profile size
//  (feedSizeFor), so the pixels per second are under the old ones too.
//  SSTV. Each feed has its own link (its own noise seed). The set lets one
//  feed start a capture (a render and one read back) per main frame
//  (o.gate of feed.js). One module worker (feed-worker.js) encodes for all
//  the feeds: the messages carry the stream key.
//
//  USE
//    const set = createFeedSet(THREE, { renderer, scene, getVehicle(id),
//      info(v) -> { depth, heading, time, task }, ids: [1, 2, 3], main: 1,
//      mode, size: { w, h, fps }, fps, document, dpr, worker, seed, speed,
//      hold, noise, adapt, budgetMs, beforeCapture, afterCapture });
//    set.update(dt)            each frame (createROVs.update calls it)
//    set.sync(ids)             the vehicles changed (2 to 4)
//    set.setVehicle(id)        the main feed (the selected ROV)
//    set.setActiveIds(ids)     the feeds whose cards show (others: no renders)
//    set.feedOf(id), set.ids   one feed of feed.js, the stream ids
//    set.stats                 { renders, perId: { id: n }, captures }
//  The single-feed API stays for the saver and the old callers: canvas,
//  vehicle, live, mode, setMode, setActive, present, pictureRect, hud,
//  liveFrames, rate, dispose. They act on the main feed (setMode and
//  setActive on all).
//
//  grep -n targets
//    "export const FEED_WEIGHT"       the weights of the round robin
//    "export function feedSizeFor"    the render size for n feeds
//    "export function liveShares"     the fps of each feed (pure)
//    "export function createScheduler"  the smooth weighted round robin
//    "function makePort"              one feed worker for all streams
//    "export function createFeedSet"
// ============================================================================
import { createFeed, liveRate } from './feed.js';
import { rovColour } from './hud.js';

export const FEED_WEIGHT = { main: 3, other: 1 };

// The render size of each feed when n feeds share the budget.
export function feedSizeFor(size, n) {
  const w = (size && (size.w ?? size[0])) || 320, h = (size && (size.h ?? size[1])) || 240, fps = (size && size.fps) || 30;
  const k = n >= 3 ? 0.75 : 1;
  return { w: Math.round(w * k / 4) * 4, h: Math.round(h * k / 4) * 4, fps };
}

// The live frames a second of each active feed (pure): fps times its
// weight over the sum of the active weights.
export function liveShares(ids, main, fps, active = ids) {
  const on = ids.filter(id => active.includes(id));
  const wsum = on.reduce((s, id) => s + (id === main ? FEED_WEIGHT.main : FEED_WEIGHT.other), 0);
  const out = {};
  for (const id of ids) out[id] = on.includes(id) && wsum ? fps * (id === main ? FEED_WEIGHT.main : FEED_WEIGHT.other) / wsum : 0;
  return out;
}

// Smooth weighted round robin: each pick adds every weight to its credit,
// takes the largest credit and subtracts the total from it. Over W picks a
// feed of weight w gets exactly w picks, spread out.
export function createScheduler() {
  const cur = new Map();
  return {
    pick(cands) {
      let tot = 0, best = null;
      for (const c of cands) {
        const v = (cur.get(c.id) || 0) + c.w;
        cur.set(c.id, v); tot += c.w;
        if (best == null || v > cur.get(best)) best = c.id;
      }
      if (best != null) cur.set(best, cur.get(best) - tot);
      return best;
    },
    forget(id) { cur.delete(id); },
    reset() { cur.clear(); },
  };
}

// One feed worker for all the streams.
function makePort(o) {
  if (o.worker === false || typeof Worker === 'undefined') return null;
  let w = null;
  try { w = new Worker(new URL('./feed-worker.js', import.meta.url), { type: 'module' }); } catch { return null; }
  const ears = new Map();
  const port = {
    dead: false,
    post(m, tr) { if (port.dead) throw new Error('feed worker stopped'); w.postMessage(m, tr); },
    listen(stream, fn) { ears.set(stream, fn); },
    drop(stream) { ears.delete(stream); },
    terminate() { port.dead = true; try { w.terminate(); } catch { /* gone */ } ears.clear(); },
  };
  w.onmessage = (e) => { const f = ears.get(e.data && e.data.stream); if (f) f(e.data); };
  w.onerror = () => {
    // every feed goes to the main-thread encode (feed.js onResult)
    port.dead = true;
    for (const f of ears.values()) { try { f({ id: '*', error: 'feed worker error' }); } catch { /* next */ } }
  };
  return port;
}

export function createFeedSet(THREE, o = {}) {
  const ids0 = (o.ids && o.ids.length ? o.ids : [1]).slice();
  const base = o.size || null;
  const FPS = o.fps || (base && base.fps) || 30;
  const rate = liveRate({ fps: FPS, min: o.minFps || Math.min(10, FPS), budgetMs: o.budgetMs ?? 3, adapt: o.adapt });
  const sched = createScheduler();
  const port = makePort(o);
  const feeds = new Map();           // id -> { feed, last }
  let main = o.main ?? ids0[0], mode = o.mode || 'r36', clock = 0, gateFree = true, size = feedSizeFor(base, ids0.length);
  let activeAll = true, shown = null;  // shown: ids whose cards show (null: all)
  const stats = { renders: 0, perId: {}, captures: 0, frames: 0 };
  const gate = () => { if (!gateFree) return false; gateFree = false; stats.captures++; return true; };

  function make(id) {
    const f = createFeed(THREE, Object.assign({}, o, {
      vehicle: id, mode, size, fps: FPS, rate, drive: 'external', gate, port, stream: id,
      seed: (o.seed ?? 1) * 31 + id * 7, colour: rovColour(id), compact: id !== main,
      worker: port ? true : o.worker,
    }));
    if (f.vehicle !== id) f.setVehicle(id);
    feeds.set(id, { feed: f, last: clock });
    stats.perId[id] = stats.perId[id] || 0;
    return f;
  }
  function applyActive() {
    for (const [id, r] of feeds) r.feed.setActive(activeAll && (!shown || shown.includes(id)));
  }
  function sync(ids) {
    ids = ids.slice();
    const want = feedSizeFor(base, ids.length);
    // a size change (2 <-> 3 feeds) makes the feeds again
    if (want.w !== size.w || want.h !== size.h) { for (const [id, r] of feeds) { r.feed.dispose(); if (port) port.drop(id); sched.forget(id); } feeds.clear(); size = want; }
    for (const [id, r] of [...feeds]) if (!ids.includes(id)) { r.feed.dispose(); if (port) port.drop(id); sched.forget(id); feeds.delete(id); }
    for (const id of ids) if (!feeds.has(id)) make(id);
    if (!feeds.has(main)) setMain(ids[0]);
    applyActive();
    return set;
  }
  function setMain(id) {
    if (!feeds.has(id)) return;
    main = id;
    for (const [k, r] of feeds) r.feed.setLook({ compact: k !== main });
  }
  function update(dt) {
    clock += dt;
    gateFree = true;
    for (const r of feeds.values()) r.feed.update(dt);
    const M = feeds.get(main);
    if (!M || !M.feed.live) return;
    if (!rate.tick(dt)) return;
    const cands = [];
    for (const [id, r] of feeds) if (r.feed.active && r.feed.live) cands.push({ id, w: id === main ? FEED_WEIGHT.main : FEED_WEIGHT.other });
    const id = sched.pick(cands);
    if (id == null) return;
    const r = feeds.get(id);
    if (r.feed.liveFrame(clock - r.last)) { stats.renders++; stats.perId[id] = (stats.perId[id] || 0) + 1; }
    r.last = clock;
  }

  const mainFeed = () => (feeds.get(main) || feeds.values().next().value || {}).feed;
  const set = {
    rate, stats, update, sync,
    feedOf: (id) => (feeds.get(id) || {}).feed || null,
    get ids() { return [...feeds.keys()]; },
    get main() { return main; },
    get size() { return Object.assign({}, size); },
    setActiveIds(list) { shown = list ? list.slice() : null; applyActive(); },
    // the single-feed API (the saver, rov/index.js focusOn, old callers)
    get canvas() { const f = mainFeed(); return f ? f.canvas : null; },
    get vehicle() { return main; },
    setVehicle(id) { setMain(id); },
    get live() { const f = mainFeed(); return !!(f && f.live); },
    get mode() { const f = mainFeed(); return f ? f.mode : mode; },
    setMode(m) { mode = m; for (const r of feeds.values()) r.feed.setMode(m); if (m === 'live') { rate.reset(); sched.reset(); } },
    setSpeed(s) { for (const r of feeds.values()) r.feed.setSpeed(s); },
    setActive(v) { activeAll = !!v; applyActive(); },
    get active() { return activeAll; },
    present(rect, op) { const f = mainFeed(); return f ? f.present(rect, op) : false; },
    pictureRect(r) { const f = mainFeed(); return f ? f.pictureRect(r) : r; },
    hud() { const f = mainFeed(); return f ? f.hud() : null; },
    get liveFrames() { let n = 0; for (const r of feeds.values()) n += r.feed.liveFrames; return n; },
    get link() { const f = mainFeed(); return f ? f.link : null; },
    get picture() { const f = mainFeed(); return f ? f.picture : null; },
    dispose() { for (const r of feeds.values()) r.feed.dispose(); feeds.clear(); if (port) port.terminate(); },
  };
  for (const id of ids0) make(id);
  setMain(main);
  return set;
}
