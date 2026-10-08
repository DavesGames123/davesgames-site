// ============================================================================
//  OUTBREAK  ·  render/nodes.js — city markers and first-infection rings (H)
// ----------------------------------------------------------------------------
//  createNodes(ctx) -> { setMode(mode), update(frame), dispose(), pool, glow }
//  A layer on top of every style. render/globe.js loads it with a dynamic
//  import and gives it the shared ctx (root = the layer group). Two parts:
//    markers  Points, one crisp circle per node, in screen px. The size
//             comes from markerPx(level, cityPop): a city with no
//             infection is a small dim grey dot; the prevalence I/N
//             (frame.prev, log scale by glowLevel) makes it larger and
//             red. A thin lighter outline rims an infected marker. A city
//             that had its epidemic and is now low (sim.firstDay >= 0)
//             turns muted teal. Flat colour, normal blending, a 1 px
//             antialiased edge, no halo and no pulse. The shown level
//             follows the target with a smooth approach, so a jump in
//             prevalence does not snap.
//    rings    Points, RING_POOL slots. A `first` event in frame.events
//             starts one thin ring at the destination: it grows from the
//             marker to RING_PX CSS px and fades out in RING_DUR wall
//             seconds. A new sim starts a ring at each node that is
//             already infected (the seed).
//  On the globe, both shaders hide a node on the far side of the unit
//  sphere, so the layer is correct also on a style that writes no depth.
//
//  Flat mode: positions use ctx.proj when the core sets it, else
//  'equirect'.
//
//  No DOM and no three import at module load: THREE comes from ctx, so
//  node can import this file and test the pure helpers.
//
//  grep -n targets: "export function glowLevel", "export function markerPx",
//                   "export function approach", "export function ringState",
//                   "export function createRingPool", "const MARK_VERT",
//                   "const RING_FRAG", "export function createNodes",
//                   "function burst", "dispose()"
// ============================================================================

import { needThree } from './arcs.js';

export const SOURCES = [];

export const NODE_H = 0.003;           // height of the markers above the surface
export const RING_POOL = 32, RING_DUR = 1.6, RING_PX = 30;
export const GLOW_RATE = 2.5;          // 1/s, approach rate of the shown level
export const PREV_LO = 1e-7, PREV_HI = 1e-1;
export const MARK_IDLE = [1.8, 3], MARK_HOT = [3.5, 12];   // CSS px ranges

// ── pure helpers (tested in tests/nodes.test.mjs) ───────────────────────
// Prevalence I/N -> 0..1 on a log scale from PREV_LO to PREV_HI.
export function glowLevel(prev) {
  if (!(prev > PREV_LO)) return 0;
  return Math.min(1, Math.log10(prev / PREV_LO) / Math.log10(PREV_HI / PREV_LO));
}

// Marker diameter in CSS px. level = glowLevel of the prevalence (0..1).
// An idle city is 1.8-3 px by its population; an infected one grows from
// 3.5 px to 12 px with the level. Monotone in level for every city.
export function markerPx(level, cityPop = 1e6) {
  const u = Math.min(1, Math.max(0, (Math.log10(Math.max(1, cityPop)) - 5) / 2.5));
  const idle = MARK_IDLE[0] + (MARK_IDLE[1] - MARK_IDLE[0]) * u;
  const l = Math.min(1, Math.max(0, +level || 0));
  if (l <= 0) return idle;
  return Math.max(idle, MARK_HOT[0] + (MARK_HOT[1] - MARK_HOT[0]) * l);
}

// Smooth approach of cur to target in dt seconds (exponential, no snap).
export function approach(cur, target, dt, rate = GLOW_RATE) {
  return target + (cur - target) * Math.exp(-rate * Math.max(0, dt));
}

// Ring at age (s): { px (CSS px diameter), alpha }, or null when it is over.
export function ringState(age, dur = RING_DUR, from = 6) {
  if (!(age >= 0) || age >= dur) return null;
  const u = age / dur;
  return { px: from + (RING_PX - from) * (1 - (1 - u) ** 3), alpha: (1 - u) ** 2 };
}

// Fixed ring pool: start(node, now) takes a free slot or the oldest one.
export function createRingPool(n = RING_POOL) {
  const p = {
    n, node: new Int32Array(n).fill(-1), t0: new Float64Array(n),
    start(node, now) {
      let s = -1, old = Infinity;
      for (let i = 0; i < n; i++) {
        if (p.node[i] < 0) { s = i; break; }
        if (p.t0[i] < old) { old = p.t0[i]; s = i; }
      }
      p.node[s] = node; p.t0[s] = now;
      return s;
    },
    expire(now, dur = RING_DUR) { for (let i = 0; i < n; i++) if (p.node[i] >= 0 && now - p.t0[i] >= dur) p.node[i] = -1; },
    clear() { p.node.fill(-1); },
    get live() { let k = 0; for (let i = 0; i < n; i++) if (p.node[i] >= 0) k++; return k; },
  };
  return p;
}

// ── shaders ──────────────────────────────────────────────────────────────
const VIS = /* glsl */`
uniform float uGlobe;
float vis(vec3 w) {
  return (uGlobe > 0.5 && dot(normalize(w), cameraPosition - w) <= 0.0) ? 0.0 : 1.0;
}`;

const MARK_VERT = /* glsl */`
attribute float aPx;
attribute float aGlow;
attribute float aPast;
uniform float uPr;
varying float vGlow;
varying float vPast;
varying float vR;
varying float vS;
${VIS}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float v = vis(w.xyz);
  vGlow = aGlow; vPast = aPast;
  vR = aPx * uPr * 0.5;
  vS = ceil(aPx * uPr) + 2.0;
  gl_PointSize = v > 0.0 ? vS : 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MARK_FRAG = /* glsl */`
uniform float uPr;
varying float vGlow;
varying float vPast;
varying float vR;
varying float vS;
void main() {
  float r = length(gl_PointCoord - 0.5) * vS;
  float disc = clamp(vR - r + 0.5, 0.0, 1.0);
  if (disc <= 0.0) discard;
  float rim = clamp(r - (vR - 1.1 * uPr) + 0.5, 0.0, 1.0);
  vec3 idle = vec3(0.70, 0.74, 0.80);
  vec3 past = vec3(0.42, 0.70, 0.68);
  vec3 hot = vec3(0.94, 0.27, 0.22);
  float k = step(0.001, vGlow);
  vec3 base = mix(idle, past, vPast);
  vec3 col = mix(base, hot, k);
  col = mix(col, vec3(1.0, 0.80, 0.74), rim * k * 0.85);
  float a = mix(0.42 + 0.3 * vPast, 0.95, k);
  gl_FragColor = vec4(col, a * disc);
}`;

const RING_VERT = /* glsl */`
attribute float aPx;
attribute float aA;
uniform float uPr;
varying float vA;
varying float vR;
varying float vS;
${VIS}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vA = aA * vis(w.xyz);
  vR = aPx * uPr * 0.5;
  vS = ceil(aPx * uPr) + 3.0;
  gl_PointSize = vA > 0.0 ? vS : 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const RING_FRAG = /* glsl */`
uniform float uPr;
uniform vec3 uColor;
varying float vA;
varying float vR;
varying float vS;
void main() {
  float r = length(gl_PointCoord - 0.5) * vS;
  float half_w = 0.65 * uPr;
  float a = vA * clamp(half_w - abs(r - vR) + 0.5, 0.0, 1.0);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

// ── the layer ────────────────────────────────────────────────────────────
export function createNodes(ctx) {
  const { THREE, D, geo, root } = ctx;
  needThree(THREE, ['BufferGeometry', 'BufferAttribute', 'ShaderMaterial', 'Points', 'Color', 'Group']);
  const nodes = D && D.nodes ? D.nodes : [];
  const N = nodes.length;
  let mode = 'globe', lastProj = 'globe';
  const projMode = () => (mode === 'flat' ? (ctx.proj === 'equalearth' ? 'equalearth' : 'equirect') : 'globe');

  const pos = new Float32Array(N * 3), px = new Float32Array(N), glow = new Float32Array(N), past = new Float32Array(N);
  const city = Float64Array.from(nodes, n => n.cityPop || n.pop || 1);
  for (let i = 0; i < N; i++) px[i] = markerPx(0, city[i]);
  const g = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3), pxAttr = new THREE.BufferAttribute(px, 1);
  const glowAttr = new THREE.BufferAttribute(glow, 1), pastAttr = new THREE.BufferAttribute(past, 1);
  g.setAttribute('position', posAttr);
  g.setAttribute('aPx', pxAttr);
  g.setAttribute('aGlow', glowAttr);
  g.setAttribute('aPast', pastAttr);
  const U = { uPr: { value: 1 }, uGlobe: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: MARK_VERT, fragmentShader: MARK_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false; points.renderOrder = 14; points.name = 'nodes-markers';

  const rPos = new Float32Array(RING_POOL * 3), rPx = new Float32Array(RING_POOL), rA = new Float32Array(RING_POOL);
  const rg = new THREE.BufferGeometry();
  const rPosAttr = new THREE.BufferAttribute(rPos, 3), rPxAttr = new THREE.BufferAttribute(rPx, 1), rAAttr = new THREE.BufferAttribute(rA, 1);
  rg.setAttribute('position', rPosAttr);
  rg.setAttribute('aPx', rPxAttr);
  rg.setAttribute('aA', rAAttr);
  const RU = { uPr: U.uPr, uGlobe: U.uGlobe, uColor: { value: new THREE.Color(1.0, 0.55, 0.45) } };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: RU, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
  });
  const rings = new THREE.Points(rg, ringMat);
  rings.frustumCulled = false; rings.renderOrder = 15; rings.name = 'nodes-rings';
  const pool = createRingPool(RING_POOL);

  const group = new THREE.Group(); group.name = 'nodes';
  group.add(points); group.add(rings);
  root.add(group);

  function place() {
    const pm = projMode();
    for (let i = 0; i < N; i++) {
      const p = geo.project(nodes[i].lat, nodes[i].lon, NODE_H, pm);
      pos[3 * i] = p[0]; pos[3 * i + 1] = p[1]; pos[3 * i + 2] = p[2];
    }
    posAttr.needsUpdate = true;
  }
  place();

  let now = 0, lastSim = null;
  function burst(i) { if (i >= 0 && i < N) pool.start(i, now); }

  const layer = {
    group, pool, glow, px,
    setMode(m) {
      const nm = m === 'flat' ? 'flat' : 'globe';
      if (nm === mode && lastProj === projMode()) return;
      mode = nm; lastProj = projMode();
      U.uGlobe.value = mode === 'globe' ? 1 : 0;
      place();
    },
    update(frame = {}) {
      const dt = Math.max(0, Math.min(0.1, +frame.dt || 0));
      now += dt;
      if (frame.mode && (frame.mode === 'flat') !== (mode === 'flat')) layer.setMode(frame.mode);
      const sim = frame.sim || null, prev = frame.prev || null;
      if (sim !== lastSim) {
        lastSim = sim; pool.clear(); glow.fill(0); past.fill(0);
        if (sim && sim.firstDay) for (let i = 0; i < N; i++) if (sim.firstDay[i] >= 0) burst(i);
      }
      if (frame.events) for (const ev of frame.events) if (ev.first && !ev.blocked) burst(ev.to);
      for (let i = 0; i < N; i++) {
        const tg = prev ? glowLevel(prev[i]) : 0;
        glow[i] = tg > 0 ? approach(glow[i], tg, dt) : (glow[i] < 0.01 ? 0 : approach(glow[i], 0, dt));
        const hadIt = sim && sim.firstDay && sim.firstDay[i] >= 0;
        past[i] = approach(past[i], hadIt && tg < 0.15 ? 1 : 0, dt, 1);
        px[i] = markerPx(glow[i], city[i]);
      }
      glowAttr.needsUpdate = true; pastAttr.needsUpdate = true; pxAttr.needsUpdate = true;
      const renderer = ctx.renderer;
      U.uPr.value = renderer && renderer.getPixelRatio ? renderer.getPixelRatio() : 1;

      // rings
      pool.expire(now);
      const pm = projMode();
      for (let s = 0; s < RING_POOL; s++) {
        const i = pool.node[s];
        const st = i >= 0 ? ringState(now - pool.t0[s], RING_DUR, px[i] + 2) : null;
        if (!st) { rA[s] = 0; continue; }
        const p = geo.project(nodes[i].lat, nodes[i].lon, NODE_H, pm);
        rPos[3 * s] = p[0]; rPos[3 * s + 1] = p[1]; rPos[3 * s + 2] = p[2];
        rPx[s] = st.px; rA[s] = 0.9 * st.alpha;
      }
      rPosAttr.needsUpdate = true; rPxAttr.needsUpdate = true; rAAttr.needsUpdate = true;
    },
    dispose() {
      root.remove(group);
      g.dispose(); mat.dispose();
      rg.dispose(); ringMat.dispose();
    },
  };
  return layer;
}

// The GLSL sources, for an offline compile check (naga after a 450 rewrite).
export const SHADERS = { marker: [MARK_VERT, MARK_FRAG], ring: [RING_VERT, RING_FRAG] };
