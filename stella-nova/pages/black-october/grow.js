// ============================================================================
//  BLACK OCTOBER  ·  grow.js — the layout of the event growth
// ----------------------------------------------------------------------------
//  Each event is one node. The distance of a node from the centre is the time
//  of the event: the radius is a function of time only. Each thread (one
//  incident, for example php2shell) has its own sector of the disc. Its root
//  event is at the middle angle of the sector.
//
//  Plain DLA cannot keep these two rules. In DLA a walker joins the nearest
//  particle at a fixed spacing, and the outer tips screen the inner cluster.
//  An event that is days later than its parent is far from the parent, and a
//  late event with an early parent cannot get through the tips. Thus the walk
//  here sets the angle only:
//    - The events go in time order. A walker starts at the angle of the
//      parent, on the ring of its own time, and walks along that ring until
//      no node is nearer than minGap. The walk stays in the thread sector.
//    - The edge from a parent to a child is a seeded Brownian bridge in angle.
//      Along the edge the radius does not decrease, so each point of a branch
//      is at or after the time of the point before it.
//  The edges are the drawing of a parent link, not events. Only the nodes
//  carry data.
//
//  THE BEFORE BAND. One time scale cannot hold the data: the first event is
//  541 days before the last, and 256 of 297 events are in the last 11 days.
//  Thus the layout has a window. windowStart 'auto' is the first event in
//  the UTC month of the last event (for the ledger: the first October
//  event). Events before the window go in an inner band, from bandIn to
//  bandOut, at even steps in time order (equal times share a radius). The
//  window starts at bandOut + bandGap and keeps radius = time to 1. Between
//  the knots radiusOf is linear, so the radius is monotone in time over the
//  whole set. With no event before the window there is no band, and the
//  layout is the same as with windowStart null (one scale from the first
//  event).
//
//  DOM-free ES module. It runs in the page and in node tests.
//
//  USE
//    const problems = validate(events);          // [] when the data is good
//    A link between threads goes in e.related (ids), not in e.parent: the
//    parent tree stays in one sector.
//    const L = layout(events, { seed: 7, scale: 'sqrt' });
//    L.nodes[i]  { id, ev, thread, parent, depth, t, r, a, x, y }
//    L.edges[k]  { from, to, pts }   pts = Float32Array x,y,x,y,...
//    L.threads   [{ id, root, count, a0, a1 }]
//    L.rings     [{ t, r, label }]    one ring per UTC day in the window
//    L.radiusOf(ms) -> r              the same time scale as the nodes
//    L.tw                             the window start (ms)
//    L.band      null, or { r0, r1, rMain, t0, t1, count, label, months }
//                months = [{ t, r, label 'YYYY-MM' }], monthGap apart
//
//  grep -n targets
//    data rules ............ "export function validate"
//    time to radius ........ "function timeScale"
//    thread sectors ........ "function sectors"
//    angle walk ............ "function placeAngle"
//    Brownian bridge ....... "function bridge"
//    day rings ............. "function dayRings"
//    before band ........... "function windowOf"  "function bandScale"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';

export const KINDS = Object.freeze(['disclosure', 'patch', 'advisory', 'exploitation', 'mitigation', 'takedown',
  'ca-action', 'statement', 'cve', 'correction', 'unrelated-claim', 'other']);
export const CONFIDENCE = Object.freeze(['confirmed', 'reported', 'disputed']);
export const PRECISION = Object.freeze(['minute', 'hour', 'day']);

export const DEFAULTS = Object.freeze({
  seed: 1,
  scale: 'sqrt',     // 'linear' or 'sqrt' (sqrt opens the dense first hours)
  inner: 0.06,       // radius of T0; the centre stays clear for the title
  minGap: 0.012,     // the shortest distance between two nodes (unit disc)
  sectorGap: 0.05,   // radians between two thread sectors
  walkSteps: 600,    // the longest angle walk of one event
  bridgeStep: 0.008, // radial length of one bridge segment
  wiggle: 0.55,      // bridge amplitude, as a part of the parent-child angle room
  windowStart: 'auto', // 'auto', null (no band), a time in ms or an ISO string
  bandIn: 0.05,      // radius of the first event before the window
  bandOut: 0.17,     // radius of the last event before the window
  bandGap: 0.03,     // empty ring between the band and the window
  monthGap: 0.01,    // the shortest radial step between two month rings
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

const DAY = 86400000;

// The data rules. The check tool and the tests use the same function.
export function validate(events) {
  const out = [], byId = new Map(), roots = new Map();
  if (!Array.isArray(events)) return ['events is not an array'];
  for (const e of events) {
    if (!e || typeof e.id !== 'string' || !e.id) { out.push('an event has no id'); continue; }
    if (byId.has(e.id)) out.push(`${e.id}: id is not unique`);
    byId.set(e.id, e);
  }
  for (const e of byId.values()) {
    const at = `${e.id}:`;
    if (typeof e.thread !== 'string' || !e.thread) out.push(`${at} no thread`);
    if (!Number.isFinite(Date.parse(e.t))) out.push(`${at} t is not a date`);
    if (!PRECISION.includes(e.tPrecision)) out.push(`${at} tPrecision "${e.tPrecision}"`);
    if (!KINDS.includes(e.kind)) out.push(`${at} kind "${e.kind}"`);
    if (!CONFIDENCE.includes(e.confidence)) out.push(`${at} confidence "${e.confidence}"`);
    if (typeof e.title !== 'string' || !e.title || e.title.length > 90) out.push(`${at} title is empty or longer than 90`);
    if (!Array.isArray(e.sources) || !e.sources.length) out.push(`${at} no sources`);
    if (e.related != null && (!Array.isArray(e.related) || e.related.some(r => !byId.has(r) || r === e.id))) out.push(`${at} related ${JSON.stringify(e.related)} names an unknown event`);
    else for (const s of e.sources) if (!s || !/^https?:\/\/\S+$/.test(s.url || '')) out.push(`${at} source url "${s && s.url}"`);
    if (e.parent == null) {
      if (roots.has(e.thread)) out.push(`${at} second root of thread ${e.thread} (first ${roots.get(e.thread)})`);
      else roots.set(e.thread, e.id);
      continue;
    }
    const p = byId.get(e.parent);
    if (!p) { out.push(`${at} parent ${e.parent} does not exist`); continue; }
    if (p.thread !== e.thread) out.push(`${at} parent ${p.id} is in thread ${p.thread}, not ${e.thread}`);
    if (Date.parse(e.t) < Date.parse(p.t)) out.push(`${at} is before its parent ${p.id}`);
  }
  const threads = new Set([...byId.values()].map(e => e.thread));
  for (const th of threads) if (!roots.has(th)) out.push(`thread ${th} has no root`);
  // A parent chain that comes back to itself has no root on its path.
  for (const e of byId.values()) {
    const seen = new Set();
    for (let c = e; c && c.parent != null; c = byId.get(c.parent)) {
      if (seen.has(c.id)) { out.push(`${e.id}: parent chain has a loop`); break; }
      seen.add(c.id);
    }
  }
  return out;
}

// Time to radius. u is 0 at T0 and 1 at the last event.
export function timeScale(t0, t1, o) {
  const span = Math.max(t1 - t0, 1);
  return ms => {
    const u = Math.min(Math.max((ms - t0) / span, 0), 1);
    return o.inner + (1 - o.inner) * (o.scale === 'linear' ? u : Math.sqrt(u));
  };
}

// One sector per thread, in the order of the root times. The width of a
// sector is sqrt(count) + 1, so a large thread gets room and a small thread
// does not go to a hair.
export function sectors(threads, o) {
  const w = threads.map(th => Math.sqrt(th.count) + 1), sum = w.reduce((a, b) => a + b, 0);
  const room = Math.PI * 2 - o.sectorGap * threads.length;
  let a = -Math.PI / 2 + o.sectorGap / 2;
  threads.forEach((th, i) => { th.a0 = a; th.a1 = a + room * w[i] / sum; a = th.a1 + o.sectorGap; });
  return threads;
}

function gauss(rand) {
  const u = rand() || 1e-12, v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// The angle walk of one event on its time ring. It returns the first free
// angle, or the angle with the most room when no angle is free.
function placeAngle(r, a, th, placed, rand, o) {
  const margin = Math.min(o.minGap / Math.max(r, 1e-3), (th.a1 - th.a0) / 2);
  const lo = th.a0 + margin, hi = th.a1 - margin;
  const step = o.minGap / Math.max(r, 1e-3);
  let best = a, bestRoom = -1;
  a = Math.min(Math.max(a, lo), hi);
  for (let k = 0; k < o.walkSteps; k++) {
    const room = roomAt(r, a, placed, o.minGap);
    if (room >= o.minGap) return a;
    if (room > bestRoom) { bestRoom = room; best = a; }
    a += gauss(rand) * step * (1 + k / 40);
    if (a < lo) a = lo + (lo - a) % Math.max(hi - lo, 1e-9);
    if (a > hi) a = hi - (a - hi) % Math.max(hi - lo, 1e-9);
  }
  return best;
}

// The distance from (r, a) to the nearest placed node, capped at gap.
function roomAt(r, a, placed, gap) {
  const x = r * Math.cos(a), y = r * Math.sin(a);
  let d = gap;
  for (const n of placed) {
    if (Math.abs(n.r - r) >= d) continue;
    d = Math.min(d, Math.hypot(n.x - x, n.y - y));
  }
  return d;
}

// The edge from parent to child: radius goes linearly from rp to rc, angle
// is the linear path plus a Brownian bridge (zero at both ends).
function bridge(p, c, th, rand, o) {
  const n = Math.max(2, Math.ceil((c.r - p.r) / o.bridgeStep) + 1);
  const b = new Float64Array(n);
  for (let k = 1; k < n; k++) b[k] = b[k - 1] + gauss(rand);
  const end = b[n - 1];
  let peak = 1e-9;
  for (let k = 0; k < n; k++) { b[k] -= end * k / (n - 1); peak = Math.max(peak, Math.abs(b[k])); }
  const amp = o.wiggle * Math.min(Math.abs(c.a - p.a) + o.minGap * 3 / Math.max(c.r, 1e-3), (th.a1 - th.a0) / 2);
  const pts = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const s = k / (n - 1), r = p.r + (c.r - p.r) * s;
    let a = p.a + (c.a - p.a) * s + (k === 0 || k === n - 1 ? 0 : amp * b[k] / peak);
    a = Math.min(Math.max(a, th.a0), th.a1);
    pts[k * 2] = r * Math.cos(a); pts[k * 2 + 1] = r * Math.sin(a);
  }
  pts[0] = p.x; pts[1] = p.y; pts[n * 2 - 2] = c.x; pts[n * 2 - 1] = c.y;
  return pts;
}

// One ring per UTC midnight between t0 and t1.
export function dayRings(t0, t1, radiusOf) {
  const out = [];
  for (let t = Math.ceil(t0 / DAY) * DAY; t <= t1; t += DAY) {
    out.push({ t, r: radiusOf(t), label: new Date(t).toISOString().slice(0, 10) });
  }
  return out;
}

// The window start in ms, or null. 'auto' is the first event in the UTC
// month of the last event. order is sorted by t.
export function windowOf(order, w) {
  if (w == null || !order.length) return null;
  if (w === 'auto') {
    const last = new Date(order[order.length - 1].t);
    const m0 = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1);
    return order.find(x => x.t >= m0).t;
  }
  const ms = typeof w === 'number' ? w : Date.parse(w);
  return Number.isFinite(ms) ? ms : null;
}

// The scale with a band: knots at the distinct times before the window
// (even radius steps from bandIn to bandOut), then the window start at
// bandOut + bandGap, then main(ms) for the window. Linear between knots.
export function bandScale(preTimes, tw, main, o) {
  const ts = [...new Set(preTimes)].sort((a, b) => a - b), m = ts.length;
  const rs = ts.map((_, i) => m === 1 ? o.bandOut : o.bandIn + (o.bandOut - o.bandIn) * i / (m - 1));
  ts.push(tw); rs.push(o.bandOut + o.bandGap);
  return ms => {
    if (ms >= tw) return main(ms);
    if (ms <= ts[0]) return rs[0];
    let i = 1;
    while (ts[i] < ms) i++;
    return rs[i - 1] + (rs[i] - rs[i - 1]) * (ms - ts[i - 1]) / (ts[i] - ts[i - 1]);
  };
}

// One ring per UTC month start before the window, dropped when it is nearer
// than monthGap to the ring before it or to the window start.
function monthRings(t0, tw, radiusOf, o) {
  const out = [], d = new Date(t0), rw = radiusOf(tw);
  for (let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); t < tw;) {
    const r = radiusOf(t), prev = out.length ? out[out.length - 1].r : -Infinity;
    if (r - prev >= o.monthGap && rw - r >= o.monthGap / 2) out.push({ t, r, label: new Date(t).toISOString().slice(0, 7) });
    const n = new Date(t); t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
  }
  return out;
}

export function layout(events, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const problems = validate(events);
  if (problems.length) throw new Error('black-october data: ' + problems.slice(0, 5).join('; '));
  const rand = rng(o.seed);
  const order = events.map((e, i) => ({ e, i, t: Date.parse(e.t) }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
  const t0 = order.length ? order[0].t : 0, t1 = order.length ? order[order.length - 1].t : 0;
  const w = windowOf(order, o.windowStart);
  const pre = w == null ? [] : order.filter(x => x.t < w).map(x => x.t);
  let radiusOf, band = null, tw = t0;
  if (pre.length) {
    tw = w;
    const rMain = o.bandOut + o.bandGap;
    radiusOf = bandScale(pre, tw, timeScale(tw, t1, { ...o, inner: rMain }), o);
    band = { r0: o.bandIn, r1: o.bandOut, rMain, t0, t1: tw,
      count: pre.length, label: 'before ' + MONTHS[new Date(tw).getUTCMonth()], months: monthRings(t0, tw, radiusOf, o) };
  } else {
    if (w != null) tw = Math.min(w, t0);
    radiusOf = timeScale(tw, t1, o);
  }

  const byThread = new Map();
  for (const { e, t } of order) {
    if (!byThread.has(e.thread)) byThread.set(e.thread, { id: e.thread, root: null, count: 0, t: Infinity });
    const th = byThread.get(e.thread);
    th.count++;
    if (e.parent == null) { th.root = e.id; th.t = t; }
  }
  const threads = sectors([...byThread.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1)), o);
  const thOf = new Map(threads.map(th => [th.id, th]));

  const nodes = [], edges = [], byId = new Map();
  for (const { e, t } of order) {
    const th = thOf.get(e.thread), r = radiusOf(t);
    const p = e.parent == null ? null : byId.get(e.parent);
    const a = placeAngle(r, p ? p.a : (th.a0 + th.a1) / 2, th, nodes, rand, o);
    const n = { id: e.id, ev: e, thread: e.thread, parent: p ? p.id : null, depth: p ? p.depth + 1 : 0,
      t, r, a, x: r * Math.cos(a), y: r * Math.sin(a) };
    nodes.push(n); byId.set(n.id, n);
    if (p) edges.push({ from: p.id, to: n.id, pts: bridge(p, n, th, rand, o) });
  }
  return { nodes, edges, threads, rings: dayRings(tw, t1, radiusOf), t0, t1, tw, band, radiusOf, byId, opts: o };
}
