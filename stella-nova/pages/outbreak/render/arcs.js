// ============================================================================
//  OUTBREAK  ·  render/arcs.js — the air network, the planes and their trails
// ----------------------------------------------------------------------------
//  createArcs(ctx) -> { setMode(mode), update(frame), dispose(), heat, pool, limits }
//  A layer on top of every style. render/globe.js loads it with a dynamic
//  import and gives it the shared ctx (root = the layer group). Three parts:
//    network  LineSegments, one low arch per air edge (net.air), always on.
//             The lines are hairlines (1 device px) at a low alpha, so the
//             dense web reads as structure. Each edge keeps a heat: an
//             infected flight adds heat, and the heat decays with the time
//             constant HEAT_TAU. A hot edge turns to the infection colour.
//             No pulse and no wave run along the lines.
//    trails   Mesh, one ribbon of TRAIL_PTS points for each flight slot.
//             The ribbon follows the plane along its arc: bright at the
//             plane, fading back over TRAIL_S wall seconds of path. After
//             arrival the ribbon drains into the destination. The width is
//             constant in screen px (the vertex shader offsets each point
//             along the screen normal), with a 1 px antialiased edge.
//             Infected flights glow in the infection colour, ambient
//             flights stay dim blue-grey.
//    planes   Points, one airliner silhouette for each flight slot. The
//             fragment shader draws the shape as a distance field, turned
//             along the screen direction of travel, with a thin dark
//             outline. The size is constant in screen px.
//  Flights come from frame.events (infected, first, blocked) and from an
//  ambient stream drawn from net.air.flow with a visual RNG (never the
//  model stream). The flight count has a hard cap (limits.flights). A
//  departure gate keeps HUB_GAP wall seconds between two departures of
//  one city, and an edge carries one flight at a time, so planes do not
//  pile at the hubs. A first arrival always flies; it can evict a lower
//  flight. A gated infected event still heats its edge.
//
//  Phone: limitsFor({ phone }) gives a smaller flight cap, a lower ambient
//  rate and smaller planes. render/globe.js sets ctx.phone.
//
//  On the globe, every shader hides a point when the unit sphere is between
//  the camera and the point, so the layer is correct also on a style that
//  writes no depth. Flat mode uses ctx.proj when the core sets it, else
//  'equirect'. An edge that crosses the antimeridian is not drawn on a flat
//  map (geo.arcAt does not wrap), and no flight uses it there.
//
//  No DOM and no three import at module load: THREE comes from ctx, so
//  node can import this file and test the pure helpers.
//
//  grep -n targets: "export const LIMITS", "export function limitsFor",
//                   "export function createHeat", "export function createCometPool",
//                   "export function createGate", "export function eventKind",
//                   "export function flightDur", "export function flowCdf",
//                   "export function pickEdge", "export function trailSpan",
//                   "export function trailAlpha", "export function flightDone",
//                   "export function edgeLookup",
//                   "export function occluded", "const LINE_VERT", "const TRAIL_VERT",
//                   "const PLANE_FRAG", "export function createArcs", "function spawn",
//                   "dispose()"
// ============================================================================
import { makeRng } from '../rng.js';

export const SOURCES = [];

export const LIMITS = {
  desktop: { flights: 72, ambientRate: 3.2, planePx: 10, trailPx: 2.2 },
  phone: { flights: 32, ambientRate: 1.4, planePx: 9, trailPx: 2 },
};
export const POOL = LIMITS.desktop.flights;   // the largest flight pool
export const TRAIL_PTS = 16;                  // points on one trail ribbon
export const TRAIL_S = 1.2;                   // s of path behind a plane
export const ARC_SEG = 24;                    // segments per network edge
export const LIFT_AIR = 0.07, LIFT_LAND = 0.02;
export const HEAT_TAU = 10;                   // s, heat decay time constant
export const HEAT_MAX = 2;
export const HEAT_INFECTED = 0.35, HEAT_FIRST = 1;
export const HUB_GAP = 0.45;                  // s between two departures of one city
export const MAX_EVENTS_FRAME = 4;            // non-first events taken per frame
export const VISUAL_SEED = 0xa4c5f1;

export const KIND = { ambient: 0, infected: 1, first: 2, blocked: 3 };
export const PRIO = [0, 1, 2, 1];
// colour, plane alpha, trail alpha and trail width factor by kind
// infected = PAL.arterial and first = PAL.core of render/infect.js (one red on the page)
export const KIND_COL = [[0.58, 0.68, 0.86], [1.0, 0.02, 0.07], [1.0, 0.46, 0.32], [0.42, 0.84, 1.0]];
const PLANE_A = [0.55, 1, 1, 0.9];
const TRAIL_A = [0.22, 0.9, 1, 0.6];
const TRAIL_W = [0.8, 1, 1.3, 0.9];
const INFECT = KIND_COL[1];

// ── pure helpers (tested in tests/arcs.test.mjs) ────────────────────────
export function limitsFor(opts = {}) { return { ...(opts.phone ? LIMITS.phone : LIMITS.desktop) }; }

// Per-edge heat. bump adds and clamps; decay multiplies by exp(-dt / tau).
export function createHeat(n, tau = HEAT_TAU, max = HEAT_MAX) {
  const h = new Float32Array(n);
  let hot = false;
  return {
    h,
    get hot() { return hot; },
    bump(e, amt) { if (e >= 0 && e < n) { h[e] = Math.min(max, h[e] + amt); hot = true; } },
    decay(dt) {
      if (!hot || !(dt > 0)) return;
      const f = Math.exp(-dt / tau);
      let any = false;
      for (let i = 0; i < n; i++) { const v = h[i] * f; h[i] = v < 1e-3 ? 0 : v; if (v >= 1e-3) any = true; }
      hot = any;
    },
    clear() { h.fill(0); hot = false; },
  };
}

// Fixed flight pool, struct of arrays. alloc(prio, now) gives a free slot.
// When the pool is full, it evicts the lowest-priority slot (the oldest
// of those). A priority-0 request evicts nothing; a higher one evicts a
// slot of lower or equal priority. -1 = no slot.
export function createCometPool(size = POOL) {
  const p = {
    size,
    live: new Uint8Array(size), kind: new Uint8Array(size), prio: new Uint8Array(size),
    born: new Float64Array(size), t: new Float64Array(size), dur: new Float64Array(size),
    a: new Int32Array(size), b: new Int32Array(size), edge: new Int32Array(size), lift: new Float32Array(size),
    count: 0,
    alloc(prio, now) {
      let s = -1;
      if (p.count < size) { for (let i = 0; i < size; i++) if (!p.live[i]) { s = i; break; } }
      else if (prio > 0) {
        let bp = 256, bb = Infinity;
        for (let i = 0; i < size; i++) {
          if (p.prio[i] < bp || (p.prio[i] === bp && p.born[i] < bb)) { bp = p.prio[i]; bb = p.born[i]; s = i; }
        }
        if (bp > prio) s = -1;
        if (s >= 0) { p.onEvict && p.onEvict(s); p.live[s] = 0; p.count--; }
      }
      if (s < 0) return -1;
      p.live[s] = 1; p.count++; p.prio[s] = prio; p.born[s] = now; p.t[s] = 0;
      return s;
    },
    free(s) { if (p.live[s]) { p.live[s] = 0; p.count--; } },
    clear() { p.live.fill(0); p.count = 0; },
    onEvict: null,
  };
  return p;
}

// Departure gate: pass(node, now) is true when the node had no departure
// in the last `gap` seconds, and then records this one.
export function createGate(n, gap = HUB_GAP) {
  const last = new Float64Array(n).fill(-Infinity);
  return {
    gap,
    pass(i, now, force = false) {
      if (!(i >= 0 && i < n)) return false;
      if (!force && now - last[i] < gap) return false;
      last[i] = now; return true;
    },
    clear() { last.fill(-Infinity); },
  };
}

export function eventKind(ev) {
  if (ev.blocked) return KIND.blocked;
  return ev.first ? KIND.first : KIND.infected;
}

// Wall seconds of a flight: short hops 2.6 s, the longest about 6.8 s.
export function flightDur(km, kind = KIND.infected) {
  const d = 2.6 + Math.min(1, Math.max(0, km) / 16000) * 4.2;
  return kind === KIND.first ? d * 1.15 : d;
}

// Cumulative flow for ambient picks.
export function flowCdf(flow) {
  const c = new Float64Array(flow.length);
  let s = 0;
  for (let i = 0; i < flow.length; i++) { s += flow[i] > 0 ? flow[i] : 0; c[i] = s; }
  return c;
}
// Edge index for u in [0, 1) by the cdf (binary search). -1 when empty.
export function pickEdge(cdf, u) {
  const n = cdf.length;
  if (!n || !(cdf[n - 1] > 0)) return -1;
  const x = u * cdf[n - 1];
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] > x) hi = m; else lo = m + 1; }
  return lo;
}

// The lit part of the arc of a flight at progress t (0 at take-off, 1 at
// arrival, > 1 while the trail drains). head = the plane, tail = TRAIL_S
// wall seconds of path behind it. Both in [0, 1].
export function trailSpan(t, dur, trailS = TRAIL_S) {
  const tl = trailS / Math.max(1e-3, dur);
  return { head: Math.min(1, Math.max(0, t)), tail: Math.min(1, Math.max(0, t - tl)) };
}
// Alpha factor of trail point k of n (0 = at the plane).
export function trailAlpha(k, n = TRAIL_PTS) { return (1 - k / Math.max(1, n - 1)) ** 1.4; }
// The flight is over when its trail has drained into the destination.
export function flightDone(t, dur, trailS = TRAIL_S) { return t - trailS / Math.max(1e-3, dur) >= 1; }

// Map an undirected node pair to its air edge index.
export function edgeLookup(air) {
  const m = new Map();
  if (!air) return m;
  for (let e = 0; e < air.n; e++) {
    const lo = Math.min(air.a[e], air.b[e]), hi = Math.max(air.a[e], air.b[e]);
    m.set(lo * 65536 + hi, e);
  }
  return m;
}
export const pairKey = (a, b) => Math.min(a, b) * 65536 + Math.max(a, b);

// True when the unit sphere hides point p from camera c (globe mode).
export function occluded(c, p, r = 0.9975) {
  const d0 = p[0] - c[0], d1 = p[1] - c[1], d2 = p[2] - c[2];
  const dd = d0 * d0 + d1 * d1 + d2 * d2;
  if (!(dd > 0)) return false;
  const t = -(c[0] * d0 + c[1] * d1 + c[2] * d2) / dd;
  if (!(t > 0 && t < 1)) return false;
  const q0 = c[0] + t * d0, q1 = c[1] + t * d1, q2 = c[2] + t * d2;
  return q0 * q0 + q1 * q1 + q2 * q2 < r * r;
}

// ── shaders ──────────────────────────────────────────────────────────────
const OCCL = /* glsl */`
uniform float uGlobe;
float occl(vec3 p) {
  if (uGlobe < 0.5) return 1.0;
  vec3 d = p - cameraPosition;
  float t = -dot(cameraPosition, d) / dot(d, d);
  if (t > 0.0 && t < 1.0) { vec3 q = cameraPosition + t * d; if (dot(q, q) < 0.995) return 0.0; }
  return 1.0;
}`;

// network: base alpha by flow, the heat turns it to the infection colour
const LINE_VERT = /* glsl */`
attribute float aHeat;
attribute float aBase;
varying float vA;
varying float vHeat;
${OCCL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vA = occl(w.xyz) * aBase;
  vHeat = aHeat;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LINE_FRAG = /* glsl */`
uniform vec3 uCold;
uniform vec3 uHot;
varying float vA;
varying float vHeat;
void main() {
  if (vA <= 0.0) discard;
  float k = clamp(vHeat, 0.0, 1.0);
  gl_FragColor = vec4(mix(uCold, uHot, k), mix(vA, 0.5, k));
}`;

// trails: a ribbon of constant screen width (uWidth device px)
const TRAIL_VERT = /* glsl */`
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aA;
attribute float aW;
attribute vec3 aCol;
uniform vec2 uRes;
uniform float uWidth;
varying float vA;
varying float vSide;
varying float vW;
varying vec3 vCol;
${OCCL}
vec2 scr(vec4 c) { return c.xy / c.w * 0.5 * uRes; }
void main() {
  mat4 pv = projectionMatrix * viewMatrix;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 c = pv * w;
  vec2 d = scr(pv * (modelMatrix * vec4(aNext, 1.0))) - scr(pv * (modelMatrix * vec4(aPrev, 1.0)));
  float l = length(d);
  d = l > 1e-4 ? d / l : vec2(1.0, 0.0);
  float W = uWidth * aW + 1.0;
  c.xy += vec2(-d.y, d.x) * aSide * W / uRes * c.w;
  gl_Position = c;
  vA = aA * occl(w.xyz);
  vSide = aSide; vW = W; vCol = aCol;
}`;
const TRAIL_FRAG = /* glsl */`
varying float vA;
varying float vSide;
varying float vW;
varying vec3 vCol;
void main() {
  if (vA <= 0.002) discard;
  float e = 1.0 - abs(vSide);
  float a = vA * clamp(e * vW * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(vCol, vec3(1.0), 0.25 * e * e), a);
}`;

// planes: a point sprite, the airliner as a distance field (nose on +y)
const PLANE_VERT = /* glsl */`
attribute vec3 aAhead;
attribute vec3 aCol;
attribute float aA;
uniform vec2 uRes;
uniform float uSize;
varying vec2 vDir;
varying vec3 vCol;
varying float vA;
${OCCL}
void main() {
  mat4 pv = projectionMatrix * viewMatrix;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 c = pv * w;
  vec4 c2 = pv * (modelMatrix * vec4(aAhead, 1.0));
  vec2 d = (c2.xy / c2.w - c.xy / c.w) * uRes;
  float l = length(d);
  vDir = l > 1e-5 ? d / l : vec2(0.0, 1.0);
  vA = aA * occl(w.xyz);
  vCol = aCol;
  gl_PointSize = vA > 0.0 ? uSize : 0.0;
  gl_Position = c;
}`;
const PLANE_FRAG = /* glsl */`
uniform float uSize;
varying vec2 vDir;
varying vec3 vCol;
varying float vA;
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  if (vA <= 0.0) discard;
  vec2 q = gl_PointCoord - 0.5;
  q.y = -q.y;
  vec2 p = vec2(dot(q, vec2(vDir.y, -vDir.x)), dot(q, vDir));
  p.x = abs(p.x);
  float d = seg(p, vec2(0.0, -0.36), vec2(0.0, 0.40)) - 0.06;
  d = min(d, seg(p, vec2(0.0, 0.06), vec2(0.42, -0.14)) - 0.045);
  d = min(d, seg(p, vec2(0.0, -0.32), vec2(0.16, -0.42)) - 0.03);
  float px = d * uSize;
  float body = clamp(0.5 - px, 0.0, 1.0);
  float edge = clamp(1.7 - px, 0.0, 1.0);
  vec3 col = mix(vec3(0.02, 0.03, 0.05), vCol, body);
  float a = vA * max(body, 0.55 * edge);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col, a);
}`;

// ── the layer ────────────────────────────────────────────────────────────
export const NEEDS = ['BufferGeometry', 'BufferAttribute', 'ShaderMaterial', 'LineSegments', 'Points',
  'Mesh', 'Color', 'Vector2', 'Group'];
// Throw before any GPU object exists when THREE lacks a class (no leak).
export function needThree(THREE, names) {
  const miss = names.filter(k => !THREE || typeof THREE[k] !== 'function');
  if (miss.length) throw new Error(`THREE lacks ${miss.join(', ')}`);
}

export function createArcs(ctx) {
  const { THREE, net, D } = ctx;
  needThree(THREE, NEEDS);
  if (typeof THREE.BufferGeometry.prototype.setIndex !== 'function') throw new Error('THREE lacks BufferGeometry.setIndex');
  const nodes = D && D.nodes ? D.nodes : [];
  const N = nodes.length;
  const air = net && net.air && net.air.n > 0 ? net.air : { a: [], b: [], flow: [], dist: [], n: 0 };
  const geo = ctx.geo;
  const root = ctx.root;
  const nE = air.n;
  const limits = ctx.limits || limitsFor({ phone: !!ctx.phone });
  const PS = limits.flights;

  let mode = 'globe';
  const projMode = () => (mode === 'flat' ? (ctx.proj === 'equalearth' ? 'equalearth' : 'equirect') : 'globe');
  const wraps = (a, b) => Math.abs(nodes[a].lon - nodes[b].lon) > 180;

  const heat = createHeat(nE);
  const lookup = edgeLookup(air);
  const cdf = flowCdf(air.flow);
  const rng = makeRng(VISUAL_SEED);
  const pool = createCometPool(PS);
  const gate = createGate(N, HUB_GAP);
  const busy = new Uint8Array(Math.max(1, nE));
  pool.onEvict = s => { const e = pool.edge[s]; if (e >= 0 && busy[e]) busy[e]--; };

  // network lines
  const VPE = 2 * ARC_SEG;
  const lPos = new Float32Array(nE * VPE * 3);
  const lHeat = new Float32Array(nE * VPE);
  const lBase = new Float32Array(nE * VPE);
  let fmax = 0;
  for (let e = 0; e < nE; e++) fmax = Math.max(fmax, air.flow[e]);
  const lg = Math.log(1 + fmax);
  const baseOf = new Float32Array(nE);
  for (let e = 0; e < nE; e++) baseOf[e] = 0.07 + 0.11 * (lg > 0 ? Math.log(1 + air.flow[e]) / lg : 0);
  const lineGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(lPos, 3);
  const heatAttr = new THREE.BufferAttribute(lHeat, 1);
  const baseAttr = new THREE.BufferAttribute(lBase, 1);
  lineGeo.setAttribute('position', posAttr);
  lineGeo.setAttribute('aHeat', heatAttr);
  lineGeo.setAttribute('aBase', baseAttr);
  const lineU = {
    uGlobe: { value: 1 },
    uCold: { value: new THREE.Color(0.55, 0.66, 0.84) },
    uHot: { value: new THREE.Color(INFECT[0], INFECT[1], INFECT[2]) },
  };
  const lineMat = new THREE.ShaderMaterial({
    uniforms: lineU, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false; lines.renderOrder = 10; lines.name = 'arcs-network';

  // trail ribbons: TRAIL_PTS points per slot, two vertices per point
  const TV = PS * TRAIL_PTS * 2;
  const tPos = new Float32Array(TV * 3), tPrev = new Float32Array(TV * 3), tNext = new Float32Array(TV * 3);
  const tSide = new Float32Array(TV), tA = new Float32Array(TV), tW = new Float32Array(TV), tCol = new Float32Array(TV * 3);
  for (let v = 0; v < TV; v++) tSide[v] = v & 1 ? -1 : 1;
  const idx = [];
  for (let s = 0; s < PS; s++) for (let k = 0; k + 1 < TRAIL_PTS; k++) {
    const v = (s * TRAIL_PTS + k) * 2;
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  const trailGeo = new THREE.BufferGeometry();
  const tPosAttr = new THREE.BufferAttribute(tPos, 3), tPrevAttr = new THREE.BufferAttribute(tPrev, 3), tNextAttr = new THREE.BufferAttribute(tNext, 3);
  const tAAttr = new THREE.BufferAttribute(tA, 1), tWAttr = new THREE.BufferAttribute(tW, 1), tColAttr = new THREE.BufferAttribute(tCol, 3);
  trailGeo.setAttribute('position', tPosAttr);
  trailGeo.setAttribute('aPrev', tPrevAttr);
  trailGeo.setAttribute('aNext', tNextAttr);
  trailGeo.setAttribute('aSide', new THREE.BufferAttribute(tSide, 1));
  trailGeo.setAttribute('aA', tAAttr);
  trailGeo.setAttribute('aW', tWAttr);
  trailGeo.setAttribute('aCol', tColAttr);
  trailGeo.setIndex(idx);
  const res = new THREE.Vector2(1600, 900);
  const trailU = { uGlobe: { value: 1 }, uRes: { value: res }, uWidth: { value: 4 } };
  const trailMat = new THREE.ShaderMaterial({
    uniforms: trailU, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const trails = new THREE.Mesh(trailGeo, trailMat);
  trails.frustumCulled = false; trails.renderOrder = 12; trails.name = 'arcs-trails';

  // planes
  const pPos = new Float32Array(PS * 3), pAhead = new Float32Array(PS * 3), pCol = new Float32Array(PS * 3), pA = new Float32Array(PS);
  const planeGeo = new THREE.BufferGeometry();
  const pPosAttr = new THREE.BufferAttribute(pPos, 3), pAheadAttr = new THREE.BufferAttribute(pAhead, 3);
  const pColAttr = new THREE.BufferAttribute(pCol, 3), pAAttr = new THREE.BufferAttribute(pA, 1);
  planeGeo.setAttribute('position', pPosAttr);
  planeGeo.setAttribute('aAhead', pAheadAttr);
  planeGeo.setAttribute('aCol', pColAttr);
  planeGeo.setAttribute('aA', pAAttr);
  const planeU = { uGlobe: { value: 1 }, uRes: { value: res }, uSize: { value: 20 } };
  const planeMat = new THREE.ShaderMaterial({
    uniforms: planeU, vertexShader: PLANE_VERT, fragmentShader: PLANE_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
  });
  const planes = new THREE.Points(planeGeo, planeMat);
  planes.frustumCulled = false; planes.renderOrder = 13; planes.name = 'arcs-planes';

  const group = new THREE.Group(); group.name = 'arcs';
  group.add(lines); group.add(trails); group.add(planes);
  root.add(group);

  function buildLines() {
    const pm = projMode();
    const tmp = new Float32Array(3 * (ARC_SEG + 1));
    for (let e = 0; e < nE; e++) {
      const a = nodes[air.a[e]], b = nodes[air.b[e]];
      const off = e * VPE;
      const hide = !a || !b || (pm !== 'globe' && wraps(air.a[e], air.b[e]));
      if (!hide) geo.arcPoints(a, b, ARC_SEG + 1, LIFT_AIR, pm, tmp);
      for (let s = 0; s < ARC_SEG; s++) {
        for (let k = 0; k < 2; k++) {
          const v = off + 2 * s + k, q = (s + k) * 3;
          lPos[3 * v] = hide ? 0 : tmp[q]; lPos[3 * v + 1] = hide ? 0 : tmp[q + 1]; lPos[3 * v + 2] = hide ? 0 : tmp[q + 2];
          lBase[v] = hide ? 0 : baseOf[e];
        }
      }
    }
    posAttr.needsUpdate = true; baseAttr.needsUpdate = true;
  }

  function release(s) {
    const e = pool.edge[s];
    if (e >= 0 && busy[e]) busy[e]--;
    pool.free(s);
  }

  // A new flight from a to b on air edge e (-1 = land). Returns the slot or -1.
  function spawn(kind, a, b, e, isLand, now) {
    if (!nodes[a] || !nodes[b] || a === b) return -1;
    if (mode === 'flat' && wraps(a, b)) return -1;
    const first = kind === KIND.first;
    if (!first && e >= 0 && busy[e]) return -1;
    if (!gate.pass(a, now, first)) return -1;
    const s = pool.alloc(PRIO[kind], now);
    if (s < 0) return -1;
    pool.kind[s] = kind; pool.a[s] = a; pool.b[s] = b; pool.edge[s] = e;
    if (e >= 0) busy[e]++;
    pool.lift[s] = isLand ? LIFT_LAND : LIFT_AIR;
    const km = isLand ? 400 : (e >= 0 && air.dist[e] > 0 ? air.dist[e] : 6371 * geo.gcDist(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon));
    pool.dur[s] = isLand ? 2.2 : flightDur(km, kind);
    return s;
  }

  let now = 0, acc = 0, lastSim = null, lastHeat = false;

  function onEvents(events) {
    if (!events || !events.length) return;
    let n = 0;
    for (const ev of events) {
      const kind = eventKind(ev);
      const isLand = ev.kind === 'land';
      let e = -1;
      if (!isLand) {
        e = ev.edge >= 0 && ev.edge < nE && pairKey(air.a[ev.edge], air.b[ev.edge]) === pairKey(ev.from, ev.to)
          ? ev.edge : (lookup.get(pairKey(ev.from, ev.to)) ?? -1);
        if (kind === KIND.infected) heat.bump(e, HEAT_INFECTED);
        else if (kind === KIND.first) heat.bump(e, HEAT_FIRST);
      }
      if (kind !== KIND.first) { if (n >= MAX_EVENTS_FRAME) continue; n++; }
      spawn(kind, ev.from, ev.to, e, isLand, now);
    }
  }

  const ZERO3 = [0, 0, 0];
  function draw(pm) {
    for (let s = 0; s < PS; s++) {
      const tb = s * TRAIL_PTS * 2;
      if (!pool.live[s]) {
        for (let v = tb; v < tb + TRAIL_PTS * 2; v++) tA[v] = 0;
        pA[s] = 0;
        continue;
      }
      const kind = pool.kind[s], c = KIND_COL[kind], A = nodes[pool.a[s]], B = nodes[pool.b[s]];
      const t = pool.t[s], dur = pool.dur[s], lift = pool.lift[s];
      const sp = trailSpan(t, dur);
      const fadeIn = Math.min(1, t * dur / 0.4);
      // ribbon points from the head (k = 0) back to the tail
      let prevP = null;
      for (let k = 0; k < TRAIL_PTS; k++) {
        const tk = sp.head + (sp.tail - sp.head) * k / (TRAIL_PTS - 1);
        const q = geo.arcAt(A, B, tk, lift, pm) || ZERO3;
        const a = TRAIL_A[kind] * trailAlpha(k) * fadeIn;
        for (let j = 0; j < 2; j++) {
          const v = tb + 2 * k + j;
          tPos[3 * v] = q[0]; tPos[3 * v + 1] = q[1]; tPos[3 * v + 2] = q[2];
          tA[v] = a; tW[v] = TRAIL_W[kind];
          tCol[3 * v] = c[0]; tCol[3 * v + 1] = c[1]; tCol[3 * v + 2] = c[2];
        }
        // aPrev / aNext: the neighbours along the ribbon (an end uses itself)
        if (prevP) {
          for (let j = 0; j < 2; j++) {
            const v = tb + 2 * k + j, u = v - 2;
            tPrev[3 * v] = prevP[0]; tPrev[3 * v + 1] = prevP[1]; tPrev[3 * v + 2] = prevP[2];
            tNext[3 * u] = q[0]; tNext[3 * u + 1] = q[1]; tNext[3 * u + 2] = q[2];
          }
        } else {
          for (let j = 0; j < 2; j++) { const v = tb + j; tPrev[3 * v] = q[0]; tPrev[3 * v + 1] = q[1]; tPrev[3 * v + 2] = q[2]; }
        }
        prevP = q;
      }
      for (let j = 0; j < 2; j++) {
        const v = tb + 2 * (TRAIL_PTS - 1) + j;
        tNext[3 * v] = prevP[0]; tNext[3 * v + 1] = prevP[1]; tNext[3 * v + 2] = prevP[2];
      }
      // the plane at the head while in flight
      if (t >= 1) { pA[s] = 0; continue; }
      const h = geo.arcAt(A, B, t, lift, pm), h2 = geo.arcAt(A, B, Math.min(1, t + 0.01), lift, pm);
      pPos[3 * s] = h[0]; pPos[3 * s + 1] = h[1]; pPos[3 * s + 2] = h[2];
      pAhead[3 * s] = h2[0]; pAhead[3 * s + 1] = h2[1]; pAhead[3 * s + 2] = h2[2];
      const pc = kind === KIND.ambient ? [0.86, 0.9, 0.97] : c;
      pCol[3 * s] = pc[0]; pCol[3 * s + 1] = pc[1]; pCol[3 * s + 2] = pc[2];
      pA[s] = PLANE_A[kind] * Math.min(fadeIn, (1 - t) * dur / 0.3, 1);
    }
    tPosAttr.needsUpdate = true; tPrevAttr.needsUpdate = true; tNextAttr.needsUpdate = true;
    tAAttr.needsUpdate = true; tWAttr.needsUpdate = true; tColAttr.needsUpdate = true;
    pPosAttr.needsUpdate = true; pAheadAttr.needsUpdate = true; pColAttr.needsUpdate = true; pAAttr.needsUpdate = true;
  }

  let lastProj = 'globe';
  buildLines();

  function clearFlights() {
    pool.clear(); busy.fill(0); gate.clear();
  }

  const layer = {
    group, heat, pool, limits, busy,
    get trailAlpha() { return tA; },
    get planeAlpha() { return pA; },
    setMode(m) {
      const nm = m === 'flat' ? 'flat' : 'globe';
      if (nm === mode && lPos.length && lastProj === projMode()) return;
      mode = nm; lastProj = projMode();
      clearFlights();
      buildLines();
      lineU.uGlobe.value = trailU.uGlobe.value = planeU.uGlobe.value = mode === 'globe' ? 1 : 0;
    },
    update(frame = {}) {
      const dt = Math.max(0, Math.min(0.1, +frame.dt || 0));
      now += dt;
      if (frame.mode && (frame.mode === 'flat') !== (mode === 'flat')) layer.setMode(frame.mode);
      if (frame.sim !== lastSim) { if (lastSim) { heat.clear(); clearFlights(); } lastSim = frame.sim; }
      onEvents(frame.events);
      // ambient traffic (visual RNG only), evenly spread in time
      acc += dt * limits.ambientRate;
      while (acc >= 1) {
        acc -= 1;
        if (pool.count >= PS) continue;
        const e = pickEdge(cdf, rng.next());
        if (e < 0) break;
        const fwd = rng.next() < 0.5;
        spawn(KIND.ambient, fwd ? air.a[e] : air.b[e], fwd ? air.b[e] : air.a[e], e, false, now);
      }
      // advance
      for (let s = 0; s < PS; s++) {
        if (!pool.live[s]) continue;
        pool.t[s] += dt / pool.dur[s];
        if (flightDone(pool.t[s], pool.dur[s])) release(s);
      }
      heat.decay(dt);
      if (heat.hot || lastHeat) {
        const h = heat.h;
        for (let e = 0; e < nE; e++) { const v = h[e], o = e * VPE; for (let k = 0; k < VPE; k++) lHeat[o + k] = v; }
        heatAttr.needsUpdate = true;
      }
      lastHeat = heat.hot;
      const renderer = ctx.renderer;
      const pr = renderer && renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      const el = renderer && renderer.domElement;
      if (el && el.width && el.height) res.set(el.width, el.height);
      trailU.uWidth.value = limits.trailPx * pr;
      planeU.uSize.value = Math.round(limits.planePx * pr);
      draw(projMode());
    },
    dispose() {
      root.remove(group);
      lineGeo.dispose(); lineMat.dispose();
      trailGeo.dispose(); trailMat.dispose();
      planeGeo.dispose(); planeMat.dispose();
      clearFlights();
    },
  };
  return layer;
}

// The GLSL sources, for an offline compile check (naga after a 450 rewrite).
export const SHADERS = {
  line: [LINE_VERT, LINE_FRAG], trail: [TRAIL_VERT, TRAIL_FRAG], plane: [PLANE_VERT, PLANE_FRAG],
};
