// generate.js — random belt maps in the grammar of the Starward Belt chart.
// No DOM, no GPU. generateMap(seed) returns a map object (contract M in
// data.js). The same seed always gives the same map.
//
// Steps, in order:
//   belt      a long band at a random lean, and the WORLD that holds it
//   stations  Poisson-disk places along the band, one hub in the middle third
//   routes    Gabriel graph, then long chords, then a trim to the count
//   hatch     smooth disc chains in open gaps between the stations
//   clouds    dust gaussians at the belt ends, the hatches and the stations
//   tiers     spoof at the hub, engine on long jumps, haznav through dust
//   labels    the least crowded of 16 places round each station
//   tags      the least crowded point along each route
//
// World units match data.js. Label offsets are CSS px at the fit zoom.
//
// grep: function generateMap  function randomSeed  function makeRng
//       function makeBelt  function placeStations  function buildRoutes
//       function placeHatch  function placeClouds  function assignTiers
//       function assignIcons  function placeLabels  function placeTags  FIT_REF

import { TIERS } from './data.js';
import { ICONS } from './icons.js';
import { makeNamer, beltName } from './names.js';

const SEED_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const RING = 78;             // approach ring radius, world units
const MIN_GAP = 185;         // min distance between stations, world units
const CLEAR = 40;            // a route must pass this far from other stations
const HATCH_RING_GAP = 12;   // hatch edge to approach ring, world units
const FIT_REF = Math.min(1400 / 900, 900 / 1750);   // desktop fit zoom of the original
const REF_LEN = 1809;        // belt axis length of the original

// Overlay sizes, CSS px at fit (see overlay.js).
const OUTER = { m: 17.5, l: 30.5 };
const LABEL_CH = 10.0;       // Chakra Petch 500, 9.5px, 0.5em letter gap, measured
const LABEL_HH = 6;          // label half height
const TAG_H = 15;
const TAG_CH = 12.5 * 0.58;

// ── random numbers ─────────────────────────────────────────────────────────

// cyrb128 string hash into four 32-bit words, then sfc32.
function makeRng(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  let a = (h1 ^ h2 ^ h3 ^ h4) >>> 0, b = (h2 ^ h1) >>> 0, c = (h3 ^ h1) >>> 0, d = (h4 ^ h1) >>> 0;
  const f = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) f();
  const rng = {
    f,
    range: (lo, hi) => lo + (hi - lo) * f(),
    int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(f() * arr.length)],
    chance: p => f() < p,
    weighted(arr, wf) {
      let s = 0;
      for (const x of arr) s += wf(x);
      let r = f() * s;
      for (const x of arr) { r -= wf(x); if (r <= 0) return x; }
      return arr[arr.length - 1];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(f() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
  return rng;
}

// Six characters from an alphabet without 0/O, 1/I/L.
export function randomSeed() {
  let s = '';
  const buf = new Uint32Array(6);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 2 ** 32);
  for (let i = 0; i < 6; i++) s += SEED_CHARS[buf[i] % SEED_CHARS.length];
  return s;
}

// ── geometry ───────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// Distance from point p to segment ab, and the segment parameter there.
function segPoint(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const s = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return { d: Math.hypot(a.x + dx * s - p.x, a.y + dy * s - p.y), s };
}

// True when segment ab crosses the box (cx, cy, hw, hh). Liang-Barsky clip.
function segHitsBox(a, b, cx, cy, hw, hh) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const edges = [[-dx, a.x - (cx - hw)], [dx, cx + hw - a.x], [-dy, a.y - (cy - hh)], [dy, cy + hh - a.y]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

// Overlap depth of two boxes, 0 when apart.
function boxOverlap(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
  const ox = ahw + bhw - Math.abs(ax - bx), oy = ahh + bhh - Math.abs(ay - by);
  return ox > 0 && oy > 0 ? Math.min(ox, oy) : 0;
}

// Overlap depth of a box and a circle, 0 when apart.
function boxCircle(cx, cy, hw, hh, px, py, r) {
  const dx = Math.max(0, Math.abs(px - cx) - hw), dy = Math.max(0, Math.abs(py - cy) - hh);
  const d = Math.hypot(dx, dy);
  return d < r ? r - d : 0;
}

// Points of a route: a straight chord, or the quadratic bow the overlay draws.
// A positive bend bows toward (-dy, dx) of from -> to.
function routePoint(a, b, bend, t) {
  if (!bend) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const cx = (a.x + b.x) / 2 - (dy / L) * bend * 2, cy = (a.y + b.y) / 2 + (dx / L) * bend * 2;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
}

// A route as a list of short segments, for hit tests.
function routeSegs(a, b, bend) {
  if (!bend) return [[a, b]];
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(routePoint(a, b, bend, i / 12));
  const out = [];
  for (let i = 0; i < 12; i++) out.push([pts[i], pts[i + 1]]);
  return out;
}

// ── belt ───────────────────────────────────────────────────────────────────

// The belt axis runs from a (the lower end) to b. lean > 0 leans to the
// right as it rises, like the original.
function makeBelt(rng) {
  const len = rng.range(1500, 1900);
  const deg = rng.range(55, 80);
  const lean = rng.chance(0.5) ? 1 : -1;
  const lateral = Math.round(rng.range(220, 300));
  const ang = (deg * Math.PI) / 180;
  const ax = lean * Math.cos(ang) * len, ay = -Math.sin(ang) * len;
  const mx = 340, my = 150;
  const w = Math.round(Math.abs(ax) + 2 * mx), h = Math.round(Math.abs(ay) + 2 * my);
  const a = { x: Math.round(lean > 0 ? mx : mx + Math.abs(ax)), y: Math.round(my + Math.abs(ay)) };
  const b = { x: Math.round(a.x + ax), y: Math.round(a.y + ay) };
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  return {
    WORLD: { w, h },
    RAIL: { a, b, spacing: 118, lateral },
    len: L, ux, uy, vx: -uy, vy: ux, lean, deg,
    // (t, d) -> world. t runs 0..1 from a to b, d across the axis.
    at(t, d) { return { x: a.x + ux * L * t + -uy * d, y: a.y + uy * L * t + ux * d }; },
    // world -> (t, d)
    local(p) {
      const rx = p.x - a.x, ry = p.y - a.y;
      return { t: (rx * ux + ry * uy) / L, d: rx * -uy + ry * ux };
    },
  };
}

// ── stations ───────────────────────────────────────────────────────────────

// Best-candidate Poisson disk along the band. The two end stations and the
// hub go first, so the belt always reads end to end around one centre.
function placeStations(rng, belt, n) {
  const lat = belt.RAIL.lateral * 0.95;
  for (let attempt = 0; attempt < 40; attempt++) {
    const pts = [];
    const put = (t, d, hub = false) => { const p = belt.at(t, d); p.t = t; p.d = d; p.hub = hub; pts.push(p); };
    put(rng.range(0.44, 0.58), rng.range(-0.4, 0.4) * lat, true);
    put(rng.range(0.12, 0.17), rng.range(-0.45, 0.45) * lat);
    put(rng.range(0.84, 0.89), rng.range(-0.45, 0.45) * lat);
    let ok = true;
    while (pts.length < n && ok) {
      let best = null, bestScore = -Infinity;
      for (let c = 0; c < 40; c++) {
        const t = rng.range(0.13, 0.88), d = rng.range(-1, 1) * lat;
        const p = belt.at(t, d);
        let m = Infinity;
        for (const q of pts) m = Math.min(m, dist(p, q));
        if (m < MIN_GAP + 2) continue;
        // Far from the rest is good, the band edge a little less so.
        const score = Math.min(m, 340) - 25 * Math.abs(d) / lat + rng.range(0, 40);
        if (score > bestScore) { bestScore = score; best = { t, d }; }
      }
      if (best) put(best.t, best.d); else ok = false;   // no fit: try again
    }
    if (pts.length === n) {
      // The hub must sit in the middle third of the stations along the axis.
      const ts = pts.map(p => p.t).sort((x, y) => x - y);
      const hubT = pts[0].t, rank = ts.indexOf(hubT);
      if (rank >= Math.floor(n / 3) && rank <= Math.ceil((2 * n) / 3) - 1) return pts;
    }
  }
  return null;
}

// ── routes ─────────────────────────────────────────────────────────────────

// Nearest other station to a straight route, with where along it.
function nearest(P, i, j) {
  let best = { d: Infinity, k: -1, s: 0 };
  for (let k = 0; k < P.length; k++) {
    if (k === i || k === j) continue;
    const r = segPoint(P[k], P[i], P[j]);
    if (r.d < best.d) best = { d: r.d, k, s: r.s };
  }
  return best;
}

// Least clearance from a bent route to the other stations.
function bentClear(P, i, j, bend) {
  let m = Infinity;
  for (const [a, b] of routeSegs(P[i], P[j], bend)) {
    for (let k = 0; k < P.length; k++) {
      if (k === i || k === j) continue;
      m = Math.min(m, segPoint(P[k], a, b).d);
    }
  }
  return m;
}

// Bend that bows a long chord away from the one station it grazes, or null.
function bowAway(P, i, j) {
  const nb = nearest(P, i, j);
  if (nb.d >= CLEAR) return 0;
  const a = P[i], b = P[j], q = P[nb.k];
  const L = dist(a, b);
  const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
  const side = (q.x - a.x) * nx + (q.y - a.y) * ny;       // + when q is on the bend side
  const s = nb.s, bow = 4 * s * (1 - s);
  if (bow < 0.6) return null;
  const need = (58 - Math.abs(side)) / bow;
  if (need > 72) return null;
  const bend = Math.round(-Math.sign(side || 1) * Math.max(30, need));
  return bentClear(P, i, j, bend) >= 50 ? bend : null;
}

function connected(n, edges) {
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) { adj[e.i].push(e.j); adj[e.j].push(e.i); }
  const seen = new Set([0]), stack = [0];
  while (stack.length) for (const k of adj[stack.pop()]) if (!seen.has(k)) { seen.add(k); stack.push(k); }
  return seen.size === n;
}

// Smallest angle between two routes that share a station, in degrees.
function tightAngle(P, edges, e) {
  let m = 180;
  for (const f of edges) {
    if (f === e) continue;
    let c = -1, o1, o2;
    if (f.i === e.i) { c = e.i; o1 = e.j; o2 = f.j; }
    else if (f.j === e.i) { c = e.i; o1 = e.j; o2 = f.i; }
    else if (f.i === e.j) { c = e.j; o1 = e.i; o2 = f.j; }
    else if (f.j === e.j) { c = e.j; o1 = e.i; o2 = f.i; }
    if (c < 0) continue;
    const a1 = Math.atan2(P[o1].y - P[c].y, P[o1].x - P[c].x);
    const a2 = Math.atan2(P[o2].y - P[c].y, P[o2].x - P[c].x);
    let d = Math.abs(a1 - a2) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    m = Math.min(m, d);
  }
  return m;
}

function buildRoutes(rng, belt, P) {
  const n = P.length;
  const hub = 0;
  const key = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const has = new Set();
  const edges = [];
  const add = (i, j, kind, bend = 0) => {
    const e = { i, j, kind, bend, len: dist(P[i], P[j]) };
    edges.push(e); has.add(key(i, j));
    return e;
  };

  // Gabriel graph: no third station inside the circle on the route diameter.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const mx = (P[i].x + P[j].x) / 2, my = (P[i].y + P[j].y) / 2, r = dist(P[i], P[j]) / 2;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        if (k !== i && k !== j && Math.hypot(P[k].x - mx, P[k].y - my) < r * 0.98) ok = false;
      }
      if (ok && nearest(P, i, j).d >= CLEAR) add(i, j, 'base');
    }
  }

  // Chords: longer jumps that cross the graph, some across the hub.
  const target = clamp(Math.round(n * 2.2 + rng.range(-1, 1.5)), 18, 26);
  const cand = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (has.has(key(i, j))) continue;
      const L = dist(P[i], P[j]);
      if (L < 300 || L > 0.44 * belt.len) continue;
      const bend = bowAway(P, i, j);
      if (bend === null) continue;
      if (bend && L < 450) continue;
      const nearHub = i !== hub && j !== hub && segPoint(P[hub], P[i], P[j]).d < 160;
      cand.push({ i, j, L, bend, w: (nearHub ? 3 : 1) * (bend ? 1.5 : 1) * (L / 400) });
    }
  }
  const nChords = rng.int(3, 6);
  let bent = 0;
  for (let c = 0; c < nChords && cand.length; c++) {
    const pick = rng.weighted(cand, x => x.w);
    cand.splice(cand.indexOf(pick), 1);
    if (pick.bend && bent >= 1) { c--; continue; }
    const e = add(pick.i, pick.j, 'chord', pick.bend);
    if (tightAngle(P, edges, e) < 11) { edges.pop(); has.delete(key(pick.i, pick.j)); c--; continue; }
    if (pick.bend) bent++;
  }

  // Keep every station on at least two routes.
  const deg = () => { const d = new Array(n).fill(0); for (const e of edges) { d[e.i]++; d[e.j]++; } return d; };
  for (let k = 0; k < n; k++) {
    if (deg()[k] >= 2) continue;
    const opts = [];
    for (let j = 0; j < n; j++) {
      if (j === k || has.has(key(k, j))) continue;
      if (nearest(P, k, j).d >= CLEAR) opts.push({ j, L: dist(P[k], P[j]) });
    }
    opts.sort((x, y) => x.L - y.L);
    if (opts.length) add(k, opts[0].j, 'fill');
  }

  // The hub keeps at most four routes, like Darkside's three: its routes
  // all turn spoof red, and more of them would flood the chart.
  const hubRoutes = () => edges.filter(e => e.i === hub || e.j === hub).sort((x, y) => y.len - x.len);
  for (const e of hubRoutes()) {
    if (hubRoutes().length <= 4) break;
    const d = deg();
    if (d[e.i === hub ? e.j : e.i] <= 2) continue;
    const rest = edges.filter(f => f !== e);
    if (!connected(n, rest)) continue;
    edges.splice(edges.indexOf(e), 1); has.delete(key(e.i, e.j));
  }

  // Too many: drop long base routes that are not needed to stay connected.
  const byLen = edges.filter(e => e.kind === 'base').sort((x, y) => y.len - x.len);
  for (const e of byLen) {
    if (edges.length <= target) break;
    const d = deg();
    if (d[e.i] <= 2 || d[e.j] <= 2) continue;
    const rest = edges.filter(f => f !== e);
    if (!connected(n, rest)) continue;
    edges.splice(edges.indexOf(e), 1); has.delete(key(e.i, e.j));
  }
  // Too few: add the shortest clear chords left.
  if (edges.length < target) {
    const more = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (has.has(key(i, j))) continue;
        const L = dist(P[i], P[j]);
        if (i === hub || j === hub) continue;
        if (L < 0.55 * belt.len && nearest(P, i, j).d >= CLEAR) more.push({ i, j, L });
      }
    }
    more.sort((x, y) => x.L - y.L);
    for (const m of more) {
      if (edges.length >= target) break;
      const e = add(m.i, m.j, 'chord');
      if (tightAngle(P, edges, e) < 11) { edges.pop(); has.delete(key(m.i, m.j)); }
    }
  }
  // Last guard: join parts that the clearance rule cut apart.
  while (!connected(n, edges)) {
    const seen = new Set([0]), stack = [0];
    const adj = Array.from({ length: n }, () => []);
    for (const e of edges) { adj[e.i].push(e.j); adj[e.j].push(e.i); }
    while (stack.length) for (const k of adj[stack.pop()]) if (!seen.has(k)) { seen.add(k); stack.push(k); }
    let best = null;
    for (const i of seen) for (let j = 0; j < n; j++) {
      if (seen.has(j)) continue;
      const L = dist(P[i], P[j]) + (nearest(P, i, j).d < CLEAR ? 1e4 : 0);
      if (!best || L < best.L) best = { i, j, L };
    }
    add(best.i, best.j, 'fill');
  }
  return edges;
}

// ── hatch ──────────────────────────────────────────────────────────────────

// One smooth blob: a chain of discs. Crescents curl and taper, teardrops
// swell in the middle, short blobs are three discs.
function makeBlob(rng, cx, cy) {
  const type = rng.weighted(['crescent', 'teardrop', 'blob'], t => ({ crescent: 4, teardrop: 4, blob: 2 })[t]);
  const prof = { crescent: [0.65, 1, 0.95, 0.78, 0.48], teardrop: [0.6, 1, 0.94, 0.55], blob: [0.8, 1, 0.7] }[type];
  const R = type === 'teardrop' ? rng.range(54, 66) : rng.range(44, 54);
  const turn = (type === 'crescent' ? rng.range(14, 26) : rng.range(3, 12)) * (rng.chance(0.5) ? 1 : -1) * Math.PI / 180;
  let ang = rng.range(0, Math.PI * 2);
  const step = type === 'teardrop' ? 0.95 : 1.05;
  const pts = [];
  let x = 0, y = 0;
  for (let i = 0; i < prof.length; i++) {
    pts.push([x, y, R * prof[i]]);
    const s = (R * (prof[i] + (prof[i + 1] || prof[i])) / 2) * step;
    x += Math.cos(ang) * s; y += Math.sin(ang) * s;
    ang += turn;
  }
  // Centre the chain on (cx, cy).
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p[0]; sy += p[1]; }
  sx /= pts.length; sy /= pts.length;
  const k = Math.round(type === 'teardrop' ? rng.range(52, 60) : rng.range(40, 50));
  return { type, k, discs: pts.map(([px, py, r]) => [Math.round(cx + px - sx), Math.round(cy + py - sy), Math.round(r)]) };
}

function placeHatch(rng, belt, P, edges) {
  const want = rng.weighted([1, 2, 3], c => ({ 1: 25, 2: 55, 3: 20 })[c]);
  const ts = P.map(p => belt.local(p).t);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const out = [];
  for (let h = 0; h < want; h++) {
    let best = null, bestScore = Infinity;
    const tries = !out.length && h === want - 1 ? 400 : 90;
    for (let c = 0; c < tries; c++) {
      // Most tries go between the stations, near the axis, like the original.
      const t = rng.chance(0.8) ? rng.range(t0 + 0.04, t1 - 0.04) : rng.range(0.06, 0.94);
      const d = rng.range(-0.6, 0.6) * belt.RAIL.lateral;
      const p = belt.at(t, d);
      const blob = makeBlob(rng, p.x, p.y);
      let ok = true, score = 0;
      for (const [x, y, r] of blob.discs) {
        const q = belt.local({ x, y });
        if (Math.abs(q.d) + r > belt.RAIL.lateral + 60 || q.t < 0.04 || q.t > 0.96) { ok = false; break; }
        for (const s of P) if (Math.hypot(s.x - x, s.y - y) - r < RING + HATCH_RING_GAP) { ok = false; break; }
        if (!ok) break;
        for (const o of out) for (const [ox, oy, or] of o.discs) if (Math.hypot(ox - x, oy - y) < r + or + 70) ok = false;
        if (!ok) break;
        // Routes over a hatch are allowed but costly: the original keeps them clear.
        for (const e of edges) {
          for (const [a, b] of routeSegs(P[e.i], P[e.j], e.bend)) {
            const g = segPoint({ x, y }, a, b).d - r;
            if (g < 0) score += 10 - g * 0.3;
            else if (g < 18) score += 1;
          }
        }
      }
      if (!ok) continue;
      const q = belt.local(p);
      score += 5 * Math.abs(q.d) / belt.RAIL.lateral + (q.t < t0 || q.t > t1 ? 8 : 0) + rng.range(0, 2);
      if (score < bestScore) { bestScore = score; best = blob; }
    }
    // Every map keeps one hatch, even over a route.
    if (best && (bestScore < 40 || (!out.length && h === want - 1))) out.push(best);
  }
  return out.map((b, i) => ({ id: `${b.type}-${i + 1}`, k: b.k, discs: b.discs }));
}

// ── clouds ─────────────────────────────────────────────────────────────────

function placeClouds(rng, belt, P, hatch) {
  const n = rng.int(7, 12);
  const out = [];
  const cloud = (t, d, rx, ry, w) => {
    const p = belt.at(t, d);
    out.push({ x: Math.round(p.x), y: Math.round(p.y), rx: Math.round(rx), ry: Math.round(ry), w: +w.toFixed(2) });
  };
  const lat = belt.RAIL.lateral;
  // The ends of the belt: heavy dust, like the tail below Olivera.
  cloud(rng.range(0.03, 0.12), rng.range(-0.3, 0.3) * lat, rng.range(180, 220), rng.range(110, 140), rng.range(0.9, 1.1));
  cloud(rng.range(0.14, 0.24), rng.range(-0.35, 0.35) * lat, rng.range(170, 220), rng.range(100, 140), rng.range(0.9, 1.1));
  cloud(rng.range(0.82, 0.92), rng.range(-0.3, 0.3) * lat, rng.range(170, 210), rng.range(100, 130), rng.range(0.85, 1.0));
  // One cloud on each hatch, so the hazard sits in dust.
  for (const h of hatch) {
    if (out.length >= n) break;
    let sx = 0, sy = 0;
    for (const [x, y] of h.discs) { sx += x; sy += y; }
    const q = belt.local({ x: sx / h.discs.length, y: sy / h.discs.length });
    cloud(q.t + rng.range(-0.02, 0.02), q.d * 0.6, rng.range(160, 200), rng.range(90, 120), rng.range(0.9, 1.0));
  }
  // The rest near stations, in random order.
  const order = rng.shuffle(P.map((_, i) => i));
  for (const i of order) {
    if (out.length >= n) break;
    const q = belt.local(P[i]);
    cloud(clamp(q.t + rng.range(-0.035, 0.035), 0.05, 0.95), q.d * rng.range(0.4, 0.9), rng.range(120, 210), rng.range(70, 120), rng.range(0.6, 1.0));
  }
  return out.slice(0, 16);
}

function density(clouds, belt, p) {
  let s = 0;
  for (const c of clouds) {
    const dx = p.x - c.x, dy = p.y - c.y;
    const u = dx * belt.ux + dy * belt.uy, v = dx * belt.vx + dy * belt.vy;
    s += c.w * Math.exp(-(u * u) / (2 * c.rx * c.rx) - (v * v) / (2 * c.ry * c.ry));
  }
  return s;
}

// ── tiers and costs ────────────────────────────────────────────────────────

function assignTiers(rng, belt, P, edges, hatch, clouds) {
  const E = edges.length;
  const hub = 0;
  const left = new Set(edges);
  const take = (list, n, tier) => {
    for (const e of list) { if (n <= 0) break; if (left.has(e)) { e.tier = tier; left.delete(e); n--; } }
  };
  // Spoof: every hub route, then the routes that pass close to the hub.
  const hubEdges = edges.filter(e => e.i === hub || e.j === hub);
  const nS = Math.max(hubEdges.length, Math.round(E * rng.range(0.17, 0.24)));
  take(hubEdges, hubEdges.length, 'spoof');
  const nearHub = edges.filter(e => left.has(e))
    .map(e => ({ e, d: segPoint(P[hub], P[e.i], P[e.j]).d }))
    .filter(x => x.d < 190).sort((x, y) => x.d - y.d).map(x => x.e);
  take(nearHub, nS - hubEdges.length, 'spoof');
  // Engine: bent routes, then the longest jumps.
  const nE = Math.round(E * rng.range(0.17, 0.24));
  const eng = edges.filter(e => left.has(e)).sort((x, y) => (y.bend ? 1e4 : 0) + y.len - (x.bend ? 1e4 : 0) - x.len);
  take(eng.filter(e => e.len > 380 || e.bend), nE, 'engine');
  // Haznav: the routes through the most dust or past a hatch.
  const score = e => {
    let s = 0;
    for (let k = 1; k < 8; k++) s += density(clouds, belt, routePoint(P[e.i], P[e.j], e.bend, k / 8));
    s /= 7;
    for (const h of hatch) {
      for (const [x, y, r] of h.discs) {
        if (segPoint({ x, y }, P[e.i], P[e.j]).d < r + 45) { s += 0.8; break; }
      }
    }
    return s + rng.range(0, 0.15);
  };
  const nH = Math.round(E * rng.range(0.17, 0.24));
  const haz = edges.filter(e => left.has(e) && e.len > 200).map(e => ({ e, s: score(e) })).sort((x, y) => y.s - x.s).map(x => x.e);
  take(haz, nH, 'haznav');
  for (const e of left) e.tier = 'none';
  for (const e of edges) {
    e.cost = clamp(Math.round(e.len / 50 + rng.pick([-0.6, 0, 0, 0, 0.6])), 4, 14);
  }
}

// ── icons ──────────────────────────────────────────────────────────────────

// The hub keeps the hex cluster. The rest get distinct glyphs while they
// last, then the least used glyph that no route neighbour has.
function assignIcons(rng, P, edges) {
  const keys = Object.keys(ICONS);
  const hubKey = keys.includes('darkside') ? 'darkside' : keys[0];
  const pool = rng.shuffle(keys.filter(k => k !== hubKey));
  const use = Object.fromEntries(keys.map(k => [k, 0]));
  const icon = new Array(P.length);
  icon[0] = hubKey; use[hubKey]++;
  const nb = P.map(() => new Set());
  for (const e of edges) { nb[e.i].add(e.j); nb[e.j].add(e.i); }
  for (let i = 1; i < P.length; i++) {
    const bad = new Set([...nb[i]].map(j => icon[j]).filter(Boolean));
    const opts = pool.filter(k => !bad.has(k));
    const list = opts.length ? opts : pool;
    let best = list[0];
    for (const k of list) if (use[k] < use[best]) best = k;
    icon[i] = best; use[best]++;
  }
  return icon;
}

// ── labels and tags ────────────────────────────────────────────────────────

const labelHalfW = name => (name.length * LABEL_CH - 4.75) / 2 + 1;
const tagHalfW = cost => (String(cost).length + 1) * TAG_CH / 2 + 3;

// Sixteen label places round a station: below, above, the four hanging
// corners, left and right, each at a near and a far gap. The prior cost
// favours the places the original chart uses most.
function labelSpots(R, hw) {
  const out = [];
  for (const [g, gp] of [[4, 0], [13, 2]]) {
    const vy = R + g + LABEL_HH;
    out.push({ dx: 0, dy: vy, p: 0 + gp });
    out.push({ dx: 0, dy: -vy, p: 2 + gp });
    out.push({ dx: -hw * 0.8, dy: vy, p: 0.8 + gp });
    out.push({ dx: hw * 0.8, dy: vy, p: 1.2 + gp });
    out.push({ dx: hw * 0.8, dy: -vy, p: 1 + gp });
    out.push({ dx: -hw * 0.8, dy: -vy, p: 1.6 + gp });
    out.push({ dx: R + g + hw, dy: 0, p: 3.5 + gp });
    out.push({ dx: -(R + g + hw), dy: 0, p: 3.5 + gp });
  }
  return out;
}

// Scene in fit px: stations, route polylines, tags, hatch discs, bounds.
function fitScene(belt, P, nodes, edges, hatch, F) {
  const S = P.map((p, i) => ({ x: p.x * F, y: p.y * F, R: OUTER[nodes[i].size], ring: RING * F }));
  const segs = edges.map(e => routeSegs(S[e.i], S[e.j], e.bend * F));
  const discs = hatch.flatMap(h => h.discs.map(([x, y, r]) => ({ x: x * F, y: y * F, r: r * F })));
  return { S, segs, discs, W: belt.WORLD.w * F, H: belt.WORLD.h * F };
}

// Cost of a label box at (x, y) for station i.
function labelCost(sc, i, x, y, hw, labels, tags) {
  const hh = LABEL_HH;
  let c = 0;
  if (x - hw < 4 || x + hw > sc.W - 4 || y - hh < 4 || y + hh > sc.H - 4) c += 1000;
  for (let k = 0; k < sc.S.length; k++) {
    const s = sc.S[k];
    c += 60 * boxCircle(x, y, hw, hh, s.x, s.y, s.R + 3);
    if (k !== i) {
      // Crossing another approach ring is fine in the original, but mild.
      const d = Math.hypot(Math.max(0, Math.abs(s.x - x) - hw), Math.max(0, Math.abs(s.y - y) - hh));
      if (d < s.ring) c += 1.5;
    }
  }
  for (const segs of sc.segs) {
    for (const [a, b] of segs) if (segHitsBox(a, b, x, y, hw + 2, hh + 2)) { c += 30; break; }
  }
  for (const t of tags) c += 40 * boxOverlap(x, y, hw, hh, t.x, t.y, t.hw + 2, TAG_H / 2 + 2);
  for (const d of sc.discs) c += 2 * boxCircle(x, y, hw, hh, d.x, d.y, d.r);
  for (const l of labels) if (l && l.i !== i) c += 60 * boxOverlap(x, y, hw + 3, hh + 3, l.x, l.y, l.hw, LABEL_HH);
  return c;
}

function placeLabels(sc, nodes, tags, prev) {
  const labels = prev ? prev.slice() : new Array(nodes.length).fill(null);
  const order = nodes.map((_, i) => i).sort((a, b) => (nodes[b].size === 'l') - (nodes[a].size === 'l') || b - a);
  for (let pass = 0; pass < 3; pass++) {
    for (const i of order) {
      const s = sc.S[i], hw = labelHalfW(nodes[i].name);
      let best = null, bestC = Infinity;
      for (const sp of labelSpots(s.R, hw)) {
        const c = labelCost(sc, i, s.x + sp.dx, s.y + sp.dy, hw, labels, tags) + sp.p;
        if (c < bestC) { bestC = c; best = sp; }
      }
      labels[i] = { i, x: s.x + best.dx, y: s.y + best.dy, hw, dx: best.dx, dy: best.dy, cost: bestC };
    }
  }
  return labels;
}

// Tag position along each route, from 0.35 to 0.65, clear of stations,
// labels and the tags before it.
function placeTags(sc, edges, labels) {
  const tags = [];
  for (let n = 0; n < edges.length; n++) {
    const e = edges[n];
    const hw = tagHalfW(e.cost), hh = TAG_H / 2;
    let best = 0.5, bestC = Infinity;
    for (let at = 0.35; at <= 0.651; at += 0.03) {
      const p = routePoint(sc.S[e.i], sc.S[e.j], e.bend * sc.F, at);
      let c = Math.abs(at - 0.5) * 8;
      for (const s of sc.S) c += 50 * boxCircle(p.x, p.y, hw, hh, s.x, s.y, s.R + 4);
      for (const l of labels) if (l) c += 40 * boxOverlap(p.x, p.y, hw + 2, hh + 2, l.x, l.y, l.hw, LABEL_HH);
      for (const t of tags) c += 40 * boxOverlap(p.x, p.y, hw + 3, hh + 3, t.x, t.y, t.hw, hh);
      for (const d of sc.discs) c += 1 * boxCircle(p.x, p.y, hw, hh, d.x, d.y, d.r);
      if (c < bestC) { bestC = c; best = at; }
    }
    e.at = +best.toFixed(2);
    const p = routePoint(sc.S[e.i], sc.S[e.j], e.bend * sc.F, e.at);
    tags.push({ x: p.x, y: p.y, hw, cost: bestC });
  }
  return tags;
}

// ── the map ────────────────────────────────────────────────────────────────

const slug = s => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function generateMap(seed) {
  const code = String(seed || '').trim().toUpperCase() || 'SEED';
  const rng = makeRng('starward:' + code);
  const belt = makeBelt(rng);
  // A short belt holds fewer stations, so the gaps stay open.
  const n = rng.int(8, clamp(Math.round(belt.len / 165), 9, 12));
  let P = placeStations(rng, belt, n);
  for (let m = n - 1; !P && m >= 8; m--) P = placeStations(rng, belt, m);

  const edges = buildRoutes(rng, belt, P);
  const hatch = placeHatch(rng, belt, P, edges);
  const clouds = placeClouds(rng, belt, P, hatch);
  assignTiers(rng, belt, P, edges, hatch, clouds);
  const icons = assignIcons(rng, P, edges);

  const bname = beltName(rng);
  const next = makeNamer(rng, [bname.replace(/ward$/, ''), bname]);
  const ids = new Set();
  const nodes = P.map((p, i) => {
    const name = next();
    let id = slug(name);
    while (ids.has(id)) id += '-x';
    ids.add(id);
    return {
      id, name, x: Math.round(p.x), y: Math.round(p.y),
      size: i === 0 ? 'l' : 'm', ring: RING, icon: icons[i], label: { dx: 0, dy: 28 },
    };
  });

  // Labels and tags, in fit px. A longer belt fits at a smaller zoom, so
  // its labels cover more of the world. Two rounds settle both.
  const F = FIT_REF * Math.min(1, REF_LEN / belt.len);
  const sc = fitScene(belt, nodes, nodes, edges, hatch, F);
  sc.F = F;
  for (const e of edges) e.at = 0.5;
  let tags = edges.map(e => { const p = routePoint(sc.S[e.i], sc.S[e.j], e.bend * F, 0.5); return { x: p.x, y: p.y, hw: tagHalfW(e.cost) }; });
  let labels = placeLabels(sc, nodes, tags, null);
  tags = placeTags(sc, edges, labels);
  labels = placeLabels(sc, nodes, tags, labels);
  tags = placeTags(sc, edges, labels);
  nodes.forEach((nd, i) => { nd.label = { dx: Math.round(labels[i].dx), dy: Math.round(labels[i].dy) }; });

  // Route direction: from the station further along the belt, like data.js.
  const tOf = i => belt.local(P[i]).t;
  const routes = edges.map(e => {
    const flip = tOf(e.j) > tOf(e.i);
    const r = {
      from: nodes[flip ? e.j : e.i].id, to: nodes[flip ? e.i : e.j].id,
      tier: e.tier, cost: e.cost, at: flip ? +(1 - e.at).toFixed(2) : e.at,
    };
    // The bow side flips with the direction.
    if (e.bend) r.bend = flip ? -e.bend : e.bend;
    return r;
  }).sort((x, y) => tOf(nodes.findIndex(q => q.id === y.from)) - tOf(nodes.findIndex(q => q.id === x.from)));

  // Nodes from the top of the belt down, like data.js. The hub keeps size 'l'.
  const order = nodes.map((_, i) => i).sort((a, b) => tOf(b) - tOf(a));

  return {
    id: 'seed:' + code,
    seed: code,
    title: { game: `Survey ${code}`, vector: `${bname} Vector`, plateTop: 'Map of the', plate: `${bname} Belt` },
    WORLD: belt.WORLD,
    RAIL: belt.RAIL,
    TIERS,
    NODES: order.map(i => nodes[i]),
    ROUTES: routes,
    HATCH: hatch,
    CLOUDS: clouds,
  };
}
