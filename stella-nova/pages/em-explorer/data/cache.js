// Byte-capped LRU for the em-explorer DATA package.
// A Map keeps insertion order, so the first key is the least recently
// used. get() moves a key to the end. set() evicts from the front until
// the total is at or below the cap. The newest entry always stays.

export class ByteLRU {
  constructor(cap) {
    this.cap = cap;
    this.bytes = 0;
    this.map = new Map();
  }
  get size() { return this.map.size; }
  has(key) { return this.map.has(key); }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }
  set(key, value, bytes) {
    const old = this.map.get(key);
    if (old) { this.bytes -= old.bytes; this.map.delete(key); }
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    this.trim(key);
  }
  delete(key) {
    const e = this.map.get(key);
    if (!e) return false;
    this.bytes -= e.bytes;
    this.map.delete(key);
    return true;
  }
  setCap(cap) { this.cap = cap; this.trim(); }
  trim(keep) {
    if (keep === undefined) { for (const k of this.map.keys()) keep = k; }
    for (const [k, e] of this.map) {
      if (this.bytes <= this.cap) break;
      if (k === keep) continue;
      this.map.delete(k);
      this.bytes -= e.bytes;
    }
  }
  clear() { this.map.clear(); this.bytes = 0; }
}
