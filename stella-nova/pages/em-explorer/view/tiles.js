// ============================================================================
//  VIEW TILES  ·  the tile store: requests, priority, cancel, LRU, fallback
// ----------------------------------------------------------------------------
//  The store knows nothing about GL or the DOM. The viewer gives it three
//  functions: load(desc, signal) -> Promise<{ data, width, height }>,
//  upload(result, desc) -> texture, free(texture). Each frame the viewer
//  calls want(list) with every tile it wants, lowest prio first. The store
//  starts the best requests up to maxInFlight, aborts requests that nobody
//  wanted for abortMs, and frees the least recently used textures above
//  maxTiles. A failed request waits retryMs before the next attempt.
//
//  Keys: key = vol|scale|plane|index|tu|tv (one tile of one slice),
//  posKey = vol|scale|plane|tu|tv (the same place on any slice). nearest()
//  finds a loaded tile at the same place on a near slice, so a slice step
//  shows the old slice until the new one lands (no black holes).
//
//  GREP MAP
//    grep -n 'want('      frame request list, start and abort
//    grep -n 'nearest('   same place, near slice fallback
//    grep -n 'evict('     LRU free above maxTiles
//    grep -n 'tileKey'    key builders
// ============================================================================

export const tileKey = (vol, s, plane, index, tu, tv) => `${vol}|${s}|${plane}|${index}|${tu}|${tv}`;
export const posKey = (vol, s, plane, tu, tv) => `${vol}|${s}|${plane}|${tu}|${tv}`;

export class TileStore {
  constructor(o) {
    this.load = o.load; this.upload = o.upload; this.free = o.free || (() => {});
    this.maxInFlight = o.maxInFlight ?? 10;
    this.maxTiles = o.maxTiles ?? 600;
    this.abortMs = o.abortMs ?? 350;
    this.retryMs = o.retryMs ?? 2500;
    this.now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.onLoad = o.onLoad || (() => {});
    this.tiles = new Map();     // key -> tile
    this.byPos = new Map();     // posKey -> Map(index -> tile)
    this.flight = new Map();    // key -> { ctl, desc, lastWanted }
    this.failed = new Map();    // key -> time of failure
    this.frame = 0;
    this.loadedCount = 0; this.errorCount = 0;
  }

  get(key) {
    const t = this.tiles.get(key);
    if (t) t.used = this.frame;
    return t;
  }
  has(key) { return this.tiles.has(key); }

  // A loaded tile at the same place within maxD slice steps, nearest first.
  // skip: an index to leave out (the exact tile, to draw the old one under it).
  nearest(pk, index, maxD = 3, skip = null) {
    const m = this.byPos.get(pk);
    if (!m) return null;
    let best = null, bd = maxD + 1;
    for (const [i, t] of m) {
      if (i === skip) continue;
      const d = Math.abs(i - index);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) best.used = this.frame;
    return best;
  }

  // descs: [{ key, posKey, index, prio, ... }] lowest prio first (the store
  // sorts a copy). Starts what fits; aborts stale requests.
  want(descs) {
    this.frame++;
    const now = this.now();
    for (const d of descs) {
      const f = this.flight.get(d.key);
      if (f) { f.lastWanted = now; f.desc.prio = d.prio; }
    }
    for (const [key, f] of this.flight) {
      if (now - f.lastWanted > this.abortMs) { f.ctl.abort(); this.flight.delete(key); }
    }
    let room = this.maxInFlight - this.flight.size;
    if (room <= 0) return;
    const list = descs.slice().sort((a, b) => a.prio - b.prio);
    for (const d of list) {
      if (room <= 0) break;
      if (this.tiles.has(d.key) || this.flight.has(d.key)) continue;
      const ft = this.failed.get(d.key);
      if (ft !== undefined && now - ft < this.retryMs) continue;
      this._start(d, now); room--;
    }
  }

  _start(desc, now) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : { signal: {}, abort() {} };
    const f = { ctl, desc, lastWanted: now };
    this.flight.set(desc.key, f);
    let p;
    try { p = Promise.resolve(this.load(desc, ctl.signal)); } catch (e) { p = Promise.reject(e); }
    p.then(res => {
      if (this.flight.get(desc.key) !== f) return;      // aborted or cleared
      this.flight.delete(desc.key);
      this.failed.delete(desc.key);
      const tex = this.upload(res, desc);
      const t = { key: desc.key, posKey: desc.posKey, index: desc.index, desc, tex,
        w: res ? res.width : 0, h: res ? res.height : 0, born: this.now(), used: this.frame };
      this.tiles.set(desc.key, t);
      let m = this.byPos.get(desc.posKey);
      if (!m) this.byPos.set(desc.posKey, m = new Map());
      m.set(desc.index, t);
      this.loadedCount++;
      this.evict();
      this.onLoad(t);
    }, err => {
      if (this.flight.get(desc.key) !== f) return;
      this.flight.delete(desc.key);
      if (err && err.name === 'AbortError') return;
      this.failed.set(desc.key, this.now());
      this.errorCount++;
      this.lastError = err;
      this.onLoad(null);
    });
  }

  evict() {
    if (this.tiles.size <= this.maxTiles) return 0;
    const list = [...this.tiles.values()].filter(t => t.used < this.frame).sort((a, b) => a.used - b.used);
    let n = 0;
    for (const t of list) {
      if (this.tiles.size <= this.maxTiles) break;
      this._drop(t); n++;
    }
    return n;
  }

  _drop(t) {
    this.tiles.delete(t.key);
    const m = this.byPos.get(t.posKey);
    if (m) { m.delete(t.index); if (!m.size) this.byPos.delete(t.posKey); }
    if (t.tex) this.free(t.tex);
  }

  clear() {
    for (const f of this.flight.values()) f.ctl.abort();
    this.flight.clear();
    for (const t of [...this.tiles.values()]) this._drop(t);
    this.failed.clear();
  }

  stats() { return { inFlight: this.flight.size, tiles: this.tiles.size, loaded: this.loadedCount, errors: this.errorCount }; }
}
