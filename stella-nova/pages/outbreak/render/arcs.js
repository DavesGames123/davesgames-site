// ============================================================================
//  OUTBREAK  ·  render/arcs.js — air-route arcs, comets and planes (package H)
// ----------------------------------------------------------------------------
//  createArcs(ctx) -> { setMode(mode), update(frame), dispose() }
//  A layer on top of every style. render/globe.js loads it with a dynamic
//  import and gives it the shared ctx (root = the layer group). Three parts:
//    network  LineSegments, one arched polyline per air edge (net.air).
//             Each edge keeps a heat. An infected flight on the edge adds
//             heat, and the heat decays with time constant HEAT_TAU (wall
//             seconds). A cold edge is a faint blue line. A hot edge glows
//             orange to white, with a pulse that runs from a to b.
//    comets   Points, a fixed pool of POOL comets with TRAIL points each.
//             frame.events gives the infected flights (air and land).
//             A `first` event gets a bright gold comet. A `blocked` event
//             (quarantine) gets a cyan comet and no heat. Ambient flights
//             come from net.air.flow with a visual RNG (never the model
//             stream), so the network moves before the epidemic.
//    planes   InstancedMesh, one small chevron at the head of each comet,
//             turned along the path and flat on the surface.
//  On the globe, the shaders and the plane code hide a point when the
//  unit sphere is between the camera and the point, so the layer is
//  correct also on a style that writes no depth.
//
//  Flat mode: the layer uses ctx.proj when the core sets it, else
//  'equirect'. An edge that crosses the antimeridian is not drawn on a
//  flat map (geo.arcAt does not wrap), and its comets do not show.
//
//  No DOM and no three import at module load: THREE comes from ctx, so
//  node can import this file and test the pure helpers.
//
//  grep -n targets: "export function createHeat", "export function createCometPool",
//                   "export function eventKind", "export function flightDur",
//                   "export function flowCdf", "export function pickEdge",
//                   "export function trailPoint", "export function edgeLookup",
//                   "export function occluded", "const LINE_VERT", "const COMET_VERT",
//                   "export function createArcs", "function spawn", "dispose()"
// ============================================================================
import { makeRng } from '../rng.js';

export const SOURCES = [];

export const POOL = 512, TRAIL = 12;
export const ARC_SEG = 20;              // segments per network edge
export const LIFT_AIR = 0.11, LIFT_LAND = 0.03;
export const HEAT_TAU = 8;              // s, heat decay time constant
export const HEAT_MAX = 2;
export const HEAT_INFECTED = 0.3, HEAT_FIRST = 0.9;
export const AMBIENT_RATE = 9;          // ambient comets per wall second
export const MAX_EVENTS_FRAME = 48;     // non-first events drawn per frame
export const TRAIL_STEP = 0.028;        // t between trail points
export const PLANE_SIZE = 0.013;
export const VISUAL_SEED = 0xa4c5f1;

export const KIND = { ambient: 0, infected: 1, first: 2, blocked: 3 };
export const PRIO = [0, 1, 2, 1];
// colour and head size (world units) by kind
const KIND_COL = [[0.45, 0.62, 1.0], [1.0, 0.38, 0.14], [1.0, 0.86, 0.42], [0.3, 0.92, 1.0]];
const KIND_A = [0.32, 0.95, 1.0, 0.8];
const KIND_SIZE = [0.008, 0.013, 0.02, 0.011];

// ── pure helpers (tested in tests/arcs.test.mjs) ────────────────────────
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

// Fixed comet pool, struct of arrays. alloc(prio, now) gives a free slot.
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
        if (s >= 0) p.live[s] = 0, p.count--;
      }
      if (s < 0) return -1;
      p.live[s] = 1; p.count++; p.prio[s] = prio; p.born[s] = now; p.t[s] = 0;
      return s;
    },
    free(s) { if (p.live[s]) { p.live[s] = 0; p.count--; } },
    clear() { p.live.fill(0); p.count = 0; },
  };
  return p;
}

export function eventKind(ev) {
  if (ev.blocked) return KIND.blocked;
  return ev.first ? KIND.first : KIND.infected;
}

// Wall seconds of a flight: short hops 1.4 s, the longest about 4.2 s.
export function flightDur(km, kind = KIND.infected) {
  const d = 1.4 + Math.min(1, Math.max(0, km) / 16000) * 2.8;
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

// Trail point k (0 = head) of a comet at progress t. The head stops at 1
// and the trail drains into it. Returns { tk, a } (a = alpha factor) or
// null when the point is not shown.
export function trailPoint(t, k, step = TRAIL_STEP) {
  const tk = t - k * step;
  if (tk < 0) return null;
  const a = (1 - k / TRAIL) ** 1.6;
  return { tk: Math.min(1, tk), a };
}
// The comet is done when its last trail point reaches 1.
export const cometDone = t => t - 1 >= (TRAIL - 1) * TRAIL_STEP;

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

const LINE_VERT = /* glsl */`
attribute float aHeat;
attribute float aBase;
attribute float aT;
varying float vA;
varying float vHeat;
varying float vT;
${OCCL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vA = occl(w.xyz) * aBase;
  vHeat = aHeat;
  vT = aT;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LINE_FRAG = /* glsl */`
uniform float uTime;
varying float vA;
varying float vHeat;
varying float vT;
void main() {
  if (vA <= 0.0) discard;
  float h = clamp(vHeat, 0.0, 2.0);
  vec3 cold = vec3(0.32, 0.5, 0.95);
  vec3 hot = mix(vec3(1.0, 0.32, 0.1), vec3(1.0, 0.92, 0.7), clamp(h - 1.0, 0.0, 1.0));
  float pulse = 0.65 + 0.35 * sin(28.0 * vT - 5.0 * uTime);
  float k = clamp(h * 1.4, 0.0, 1.0);
  vec3 col = mix(cold, hot, k);
  float a = vA * (1.0 - k) + k * min(1.0, 0.25 + h * 0.6) * pulse;
  gl_FragColor = vec4(col, a);
}`;

const COMET_VERT = /* glsl */`
attribute vec3 aCol;
attribute float aA;
attribute float aSize;
uniform float uPx;
varying vec3 vCol;
varying float vA;
${OCCL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * w;
  vA = aA * occl(w.xyz);
  vCol = aCol;
  gl_PointSize = vA > 0.0 ? max(1.5, aSize * uPx / max(0.01, -mv.z)) : 0.0;
  gl_Position = projectionMatrix * mv;
}`;
const COMET_FRAG = /* glsl */`
varying vec3 vCol;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0 || vA <= 0.0) discard;
  float core = exp(-r * r * 7.0);
  float halo = (1.0 - r) * 0.35;
  gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.55), vA * (core + halo));
}`;

// ── the layer ────────────────────────────────────────────────────────────
export const NEEDS = ['BufferGeometry', 'BufferAttribute', 'ShaderMaterial', 'LineSegments', 'Points',
  'InstancedMesh', 'MeshBasicMaterial', 'Matrix4', 'Color', 'Group'];
// Throw before any GPU object exists when THREE lacks a class (no leak).
export function needThree(THREE, names) {
  const miss = names.filter(k => !THREE || typeof THREE[k] !== 'function');
  if (miss.length) throw new Error(`THREE lacks ${miss.join(', ')}`);
}

export function createArcs(ctx) {
  const { THREE, net, D } = ctx;
  needThree(THREE, NEEDS);
  const nodes = D && D.nodes ? D.nodes : [];
  const air = net && net.air && net.air.n > 0 ? net.air : { a: [], b: [], flow: [], dist: [], n: 0 };
  const land = net && net.land ? net.land : { a: [], b: [], n: 0 };
  const geo = ctx.geo;
  const root = ctx.root;
  const nE = air.n;

  let mode = 'globe';
  const projMode = () => (mode === 'flat' ? (ctx.proj === 'equalearth' ? 'equalearth' : 'equirect') : 'globe');
  const wraps = (a, b) => Math.abs(nodes[a].lon - nodes[b].lon) > 180;

  const heat = createHeat(nE);
  const lookup = edgeLookup(air);
  const cdf = flowCdf(air.flow);
  const rng = makeRng(VISUAL_SEED);
  const pool = createCometPool(POOL);

  // network lines
  const VPE = 2 * ARC_SEG;
  const lPos = new Float32Array(nE * VPE * 3);
  const lHeat = new Float32Array(nE * VPE);
  const lBase = new Float32Array(nE * VPE);
  const lT = new Float32Array(nE * VPE);
  let fmax = 0;
  for (let e = 0; e < nE; e++) fmax = Math.max(fmax, air.flow[e]);
  const lg = Math.log(1 + fmax);
  const baseOf = new Float32Array(nE);
  for (let e = 0; e < nE; e++) baseOf[e] = 0.035 + 0.1 * (lg > 0 ? Math.log(1 + air.flow[e]) / lg : 0);
  for (let e = 0; e < nE; e++) for (let s = 0; s < ARC_SEG; s++) {
    const v = e * VPE + 2 * s;
    lT[v] = s / ARC_SEG; lT[v + 1] = (s + 1) / ARC_SEG;
  }
  const lineGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(lPos, 3);
  const heatAttr = new THREE.BufferAttribute(lHeat, 1);
  const baseAttr = new THREE.BufferAttribute(lBase, 1);
  lineGeo.setAttribute('position', posAttr);
  lineGeo.setAttribute('aHeat', heatAttr);
  lineGeo.setAttribute('aBase', baseAttr);
  lineGeo.setAttribute('aT', new THREE.BufferAttribute(lT, 1));
  const lineU = { uGlobe: { value: 1 }, uTime: { value: 0 } };
  const lineMat = new THREE.ShaderMaterial({
    uniforms: lineU, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false; lines.renderOrder = 10; lines.name = 'arcs-network';

  // comets
  const NP = POOL * TRAIL;
  const cPos = new Float32Array(NP * 3), cCol = new Float32Array(NP * 3), cA = new Float32Array(NP), cSize = new Float32Array(NP);
  const cometGeo = new THREE.BufferGeometry();
  const cPosAttr = new THREE.BufferAttribute(cPos, 3), cColAttr = new THREE.BufferAttribute(cCol, 3);
  const cAAttr = new THREE.BufferAttribute(cA, 1), cSizeAttr = new THREE.BufferAttribute(cSize, 1);
  cometGeo.setAttribute('position', cPosAttr);
  cometGeo.setAttribute('aCol', cColAttr);
  cometGeo.setAttribute('aA', cAAttr);
  cometGeo.setAttribute('aSize', cSizeAttr);
  const cometU = { uGlobe: { value: 1 }, uPx: { value: 600 } };
  const cometMat = new THREE.ShaderMaterial({
    uniforms: cometU, vertexShader: COMET_VERT, fragmentShader: COMET_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const comets = new THREE.Points(cometGeo, cometMat);
  comets.frustumCulled = false; comets.renderOrder = 12; comets.name = 'arcs-comets';

  // planes: a chevron, nose on +y, wings on x, flat in the xy plane
  const planeGeo = new THREE.BufferGeometry();
  planeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0.6, 0, -0.5, -0.45, 0, 0, -0.15, 0,
    0, 0.6, 0, 0, -0.15, 0, 0.5, -0.45, 0,
  ]), 3));
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const planes = new THREE.InstancedMesh(planeGeo, planeMat, POOL);
  planes.frustumCulled = false; planes.renderOrder = 13; planes.name = 'arcs-planes';
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < POOL; i++) { planes.setMatrixAt(i, zero); planes.setColorAt(i, col.setRGB(0, 0, 0)); }

  const group = new THREE.Group(); group.name = 'arcs';
  group.add(lines); group.add(comets); group.add(planes);
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

  function spawn(kind, a, b, e, isLand, now) {
    if (!nodes[a] || !nodes[b] || a === b) return -1;
    if (mode === 'flat' && wraps(a, b)) return -1;
    const s = pool.alloc(PRIO[kind], now);
    if (s < 0) return -1;
    pool.kind[s] = kind; pool.a[s] = a; pool.b[s] = b; pool.edge[s] = e;
    pool.lift[s] = isLand ? LIFT_LAND : LIFT_AIR;
    const km = isLand ? 400 : (e >= 0 && air.dist[e] > 0 ? air.dist[e] : 6371 * geo.gcDist(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon));
    pool.dur[s] = isLand ? 1.1 : flightDur(km, kind);
    return s;
  }

  let now = 0, acc = 0, lastSim = null, lastHeat = false;
  const cam = [0, 0, 0];

  function onEvents(events) {
    if (!events || !events.length) return;
    let n = 0;
    for (const ev of events) {
      const kind = eventKind(ev);
      if (kind !== KIND.first && n >= MAX_EVENTS_FRAME) continue;
      const isLand = ev.kind === 'land';
      let e = -1;
      if (!isLand) {
        e = ev.edge >= 0 && ev.edge < nE && pairKey(air.a[ev.edge], air.b[ev.edge]) === pairKey(ev.from, ev.to)
          ? ev.edge : (lookup.get(pairKey(ev.from, ev.to)) ?? -1);
        if (kind === KIND.infected) heat.bump(e, HEAT_INFECTED);
        else if (kind === KIND.first) heat.bump(e, HEAT_FIRST);
      }
      if (kind !== KIND.first) n++;
      spawn(kind, ev.from, ev.to, e, isLand, now);
    }
  }

  function drawComets(pm) {
    const p = [0, 0, 0];
    for (let s = 0; s < POOL; s++) {
      const base = s * TRAIL;
      if (!pool.live[s]) {
        for (let k = 0; k < TRAIL; k++) cA[base + k] = 0;
        planes.setMatrixAt(s, zero);
        continue;
      }
      const kind = pool.kind[s], c = KIND_COL[kind], A = nodes[pool.a[s]], B = nodes[pool.b[s]];
      const t = pool.t[s], lift = pool.lift[s];
      for (let k = 0; k < TRAIL; k++) {
        const v = base + k, tp = trailPoint(t, k);
        if (!tp) { cA[v] = 0; continue; }
        const q = geo.arcAt(A, B, tp.tk, lift, pm);
        cPos[3 * v] = q[0]; cPos[3 * v + 1] = q[1]; cPos[3 * v + 2] = q[2];
        cCol[3 * v] = c[0]; cCol[3 * v + 1] = c[1]; cCol[3 * v + 2] = c[2];
        const fadeIn = Math.min(1, t * 12);
        cA[v] = KIND_A[kind] * tp.a * fadeIn;
        cSize[v] = KIND_SIZE[kind] * (0.45 + 0.55 * tp.a);
      }
      // plane at the head while in flight
      if (t >= 1) { planes.setMatrixAt(s, zero); continue; }
      const h = geo.arcAt(A, B, t, lift, pm), h2 = geo.arcAt(A, B, Math.min(1, t + 0.01), lift, pm);
      p[0] = h[0]; p[1] = h[1]; p[2] = h[2];
      if (pm === 'globe' && occluded(cam, p)) { planes.setMatrixAt(s, zero); continue; }
      let fx = h2[0] - h[0], fy = h2[1] - h[1], fz = h2[2] - h[2];
      let fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      let nx = 0, ny = 0, nz = 1;
      if (pm === 'globe') { const r = Math.hypot(h[0], h[1], h[2]) || 1; nx = h[0] / r; ny = h[1] / r; nz = h[2] / r; }
      // side = f x n, then n' = side x f
      let sx = fy * nz - fz * ny, sy = fz * nx - fx * nz, sz = fx * ny - fy * nx;
      const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      nx = sy * fz - sz * fy; ny = sz * fx - sx * fz; nz = sx * fy - sy * fx;
      const sc = PLANE_SIZE * (kind === KIND.first ? 1.5 : kind === KIND.ambient ? 0.75 : 1);
      m4.set(
        sx * sc, fx * sc, nx * sc, h[0],
        sy * sc, fy * sc, ny * sc, h[1],
        sz * sc, fz * sc, nz * sc, h[2],
        0, 0, 0, 1);
      planes.setMatrixAt(s, m4);
      const pa = KIND_A[kind] * Math.min(1, t * 12, (1 - t) * 12);
      planes.setColorAt(s, col.setRGB(0.6 * c[0] * pa + 0.4 * pa, 0.6 * c[1] * pa + 0.4 * pa, 0.6 * c[2] * pa + 0.4 * pa));
    }
    cPosAttr.needsUpdate = true; cColAttr.needsUpdate = true; cAAttr.needsUpdate = true; cSizeAttr.needsUpdate = true;
    planes.instanceMatrix.needsUpdate = true;
    if (planes.instanceColor) planes.instanceColor.needsUpdate = true;
  }

  let lastProj = 'globe';
  buildLines();

  const layer = {
    group, heat, pool,
    setMode(m) {
      const nm = m === 'flat' ? 'flat' : 'globe';
      if (nm === mode && lPos.length && lastProj === projMode()) return;
      mode = nm; lastProj = projMode();
      pool.clear();
      buildLines();
      lineU.uGlobe.value = cometU.uGlobe.value = mode === 'globe' ? 1 : 0;
    },
    update(frame = {}) {
      const dt = Math.max(0, Math.min(0.1, +frame.dt || 0));
      now += dt;
      if (frame.mode && (frame.mode === 'flat') !== (mode === 'flat')) layer.setMode(frame.mode);
      if (frame.sim !== lastSim) { if (lastSim) { heat.clear(); pool.clear(); } lastSim = frame.sim; }
      onEvents(frame.events);
      // ambient traffic (visual RNG only)
      acc += dt * AMBIENT_RATE;
      while (acc >= 1) {
        acc -= 1;
        if (pool.count >= POOL) continue;
        const e = pickEdge(cdf, rng.next());
        if (e < 0) break;
        const fwd = rng.next() < 0.5;
        spawn(KIND.ambient, fwd ? air.a[e] : air.b[e], fwd ? air.b[e] : air.a[e], e, false, now);
      }
      // advance
      for (let s = 0; s < POOL; s++) {
        if (!pool.live[s]) continue;
        pool.t[s] += dt / pool.dur[s];
        if (cometDone(pool.t[s])) pool.free(s);
      }
      heat.decay(dt);
      if (heat.hot || lastHeat) {
        const h = heat.h;
        for (let e = 0; e < nE; e++) { const v = h[e], o = e * VPE; for (let k = 0; k < VPE; k++) lHeat[o + k] = v; }
        heatAttr.needsUpdate = true;
      }
      lastHeat = heat.hot;
      const camera = ctx.camera, renderer = ctx.renderer;
      if (camera && camera.position) { cam[0] = camera.position.x; cam[1] = camera.position.y; cam[2] = camera.position.z; }
      const hpx = renderer && renderer.domElement && renderer.domElement.height ? renderer.domElement.height : 800;
      const fov = camera && camera.fov ? camera.fov : 35;
      cometU.uPx.value = hpx / (2 * Math.tan(fov * Math.PI / 360));
      lineU.uTime.value = now;
      drawComets(projMode());
    },
    dispose() {
      root.remove(group);
      lineGeo.dispose(); lineMat.dispose();
      cometGeo.dispose(); cometMat.dispose();
      planeGeo.dispose(); planeMat.dispose();
      if (planes.dispose) planes.dispose();
      pool.clear();
    },
  };
  return layer;
}
