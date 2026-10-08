// ============================================================================
//  OUTBREAK  ·  render/ignite.js — city ignitions (no DOM, no three)
// ----------------------------------------------------------------------------
//  An ignition is the moment the infection lands in a city. render/globe.js
//  owns one bus (ctx.ignite) and sets bus.now (wall seconds) each frame.
//    - render/arcs.js fires it when an infected plane arrives: a first
//      arrival at full power, an infected arrival in a city that already
//      has cases at ARRIVAL_POWER. A first event that gets no flight fires
//      at once.
//    - render/globe.js fires the seed cities of a new sim, and the first
//      events itself when no arcs layer handles them.
//    - render/nodes.js reads new fires (since(cursor)) and draws a sharp
//      flash and a shockwave ring in screen px at the city.
//    - The surface styles read slots(): uIgn[k] = (point on the unit
//      sphere, age in s). render/infect.js draws the flash, a thin ring on
//      the ground and a red bloom of the land inside it.
//  One node fires at most once per NODE_GAP seconds. Phones keep a smaller
//  pool and fill fewer shader slots (limitsFor).
//
//  grep -n targets: "export const IGNITE", "export function igniteLimits",
//                   "export function igniteState", "export function createIgnition",
//                   "slots(", "since("
// ============================================================================
import { IGN, IGN_SLOTS } from './infect.js';

export const IGNITE = {
  dur: IGN.dur,          // s, the life of one ignition (land bloom and ring)
  flash: IGN.flash,      // s, the sharp flash at the start
  ringPx: 64,            // CSS px, the largest shockwave ring (desktop)
  ringPxPhone: 44,
  arrivalPower: 0.4,     // an infected plane into a city that has cases
  nodeGap: 0.6,          // s, one node fires at most once in this time
};
export const ARRIVAL_POWER = IGNITE.arrivalPower;

export function igniteLimits(phone) {
  return phone ? { pool: 10, slots: 4, ringPx: IGNITE.ringPxPhone } : { pool: 24, slots: IGN_SLOTS, ringPx: IGNITE.ringPx };
}

// The look of an ignition at age (s) with power 0..1, or null when over.
//   flash 0..1 (a quadratic fall over IGNITE.flash), ringPx (CSS px
//   diameter, from the marker out), ringA (alpha), bloom (0..1 land).
export function igniteState(age, power = 1, opts = {}) {
  const dur = IGNITE.dur, maxPx = opts.ringPx || IGNITE.ringPx, from = opts.from || 6;
  if (!(age >= 0) || age >= dur) return null;
  const u = age / dur, p = Math.max(0, Math.min(1, power));
  const fl = Math.max(0, 1 - age / IGNITE.flash);
  return {
    u,
    flash: fl * fl * (0.4 + 0.6 * p),
    ringPx: from + (maxPx * (0.35 + 0.65 * p) - from) * (1 - (1 - u) ** 3),
    ringA: (1 - u) ** 2 * (0.45 + 0.55 * p),
    bloom: (1 - u) ** 2 * p,
  };
}

export function createIgnition({ phone = false } = {}) {
  const L = igniteLimits(phone), n = L.pool;
  const node = new Int32Array(n).fill(-1), t0 = new Float64Array(n), power = new Float32Array(n);
  const last = new Map();
  const log = [];                 // fires since the start: { node, t0, power }
  let base = 0;                   // log index of log[0]
  const bus = {
    now: 0, n, limits: L, node, t0, power,
    fire(i, pw = 1) {
      if (!(i >= 0)) return -1;
      const lt = last.get(i);
      if (lt !== undefined && bus.now - lt < IGNITE.nodeGap && bus.now >= lt) return -1;
      last.set(i, bus.now);
      let s = -1, old = Infinity;
      for (let k = 0; k < n; k++) {
        if (node[k] < 0) { s = k; break; }
        if (t0[k] < old) { old = t0[k]; s = k; }
      }
      node[s] = i; t0[s] = bus.now; power[s] = pw;
      log.push({ node: i, t0: bus.now, power: pw });
      if (log.length > 256) { log.splice(0, 128); base += 128; }
      return s;
    },
    expire() { for (let k = 0; k < n; k++) if (node[k] >= 0 && !(bus.now - t0[k] < IGNITE.dur && bus.now >= t0[k])) node[k] = -1; },
    get live() { let c = 0; for (let k = 0; k < n; k++) if (node[k] >= 0) c++; return c; },
    // fires after cursor -> { list, cursor }
    since(cursor = 0) {
      const from = Math.max(0, cursor - base);
      return { list: log.slice(from), cursor: base + log.length };
    },
    // Fill out[k] (objects with x, y, z, w) with the newest live fires of
    // power >= 0.5 (an arrival in a city with cases only rings, it does
    // not bloom the land): xyz = point(node) on the unit sphere, w = age;
    // the rest w = -1.
    slots(point, out, count = L.slots) {
      const live = [];
      for (let k = 0; k < n; k++) if (node[k] >= 0 && power[k] >= 0.5 && bus.now - t0[k] < IGNITE.dur && bus.now >= t0[k]) live.push(k);
      live.sort((a, b) => t0[b] - t0[a]);
      const m = Math.min(count, out.length);
      for (let j = 0; j < out.length; j++) {
        const o = out[j];
        if (j < m && j < live.length) {
          const k = live[j], p = point(node[k]);
          o.x = p[0]; o.y = p[1]; o.z = p[2]; o.w = bus.now - t0[k];
        } else o.w = -1;
      }
      return Math.min(m, live.length);
    },
    clear() { node.fill(-1); last.clear(); },
  };
  return bus;
}
