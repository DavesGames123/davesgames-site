// ============================================================================
//  OUTBREAK  ·  render/nodes.js — city glows and ring bursts (package H)
// ----------------------------------------------------------------------------
//  createNodes(ctx) -> { setMode(mode), update(frame), dispose() }
//  A layer on top of every style. render/globe.js loads it with a dynamic
//  import and gives it the shared ctx (root = the layer group). Two parts:
//    glows   Points, one per node, just above the surface. The size comes
//            from the city population (log). A node with no infection is
//            a dim warm dot. The local prevalence I/N (frame.prev) sets a
//            red-orange glow on a log scale (glowLevel), which also makes
//            the dot larger and pulse. A node that had its epidemic and is
//            now low (sim.firstDay >= 0, glow near 0) shows a cool teal.
//            The shown glow follows the target with a smooth approach, so
//            a jump in prevalence does not snap.
//    rings   InstancedMesh of RING_POOL flat rings, tangent to the surface.
//            A `first` event in frame.events starts a ring burst at the
//            destination node. A new sim starts a burst at each node that
//            is already infected (the seed). A ring grows and fades out in
//            RING_DUR wall seconds.
//  On the globe, the glow shader and the ring code hide a node on the far
//  side of the unit sphere, so the layer is correct also on a style that
//  writes no depth.
//
//  Flat mode: positions use ctx.proj when the core sets it, else
//  'equirect'.
//
//  No DOM and no three import at module load: THREE comes from ctx, so
//  node can import this file and test the pure helpers.
//
//  grep -n targets: "export function glowLevel", "export function nodeSize",
//                   "export function approach", "export function ringState",
//                   "export function createRingPool", "const GLOW_VERT",
//                   "export function createNodes", "function burst", "dispose()"
// ============================================================================

import { needThree } from './arcs.js';

export const SOURCES = [];

export const NODE_H = 0.003;          // height of the glows above the surface
export const RING_H = 0.002;
export const RING_POOL = 48, RING_DUR = 2.4;
export const RING_R0 = 0.01, RING_R1 = 0.13;
export const GLOW_RATE = 4;           // 1/s, approach rate of the shown glow
export const PREV_LO = 1e-7, PREV_HI = 1e-1;

// ── pure helpers (tested in tests/arcs.test.mjs) ────────────────────────
// Prevalence I/N -> 0..1 on a log scale from PREV_LO to PREV_HI.
export function glowLevel(prev) {
  if (!(prev > PREV_LO)) return 0;
  return Math.min(1, Math.log10(prev / PREV_LO) / Math.log10(PREV_HI / PREV_LO));
}

// World size of a node glow from its city population.
export function nodeSize(cityPop) {
  const u = Math.min(1, Math.max(0, (Math.log10(Math.max(1, cityPop)) - 5) / 2.5));
  return 0.006 + 0.011 * u;
}

// Smooth approach of cur to target in dt seconds (exponential, no snap).
export function approach(cur, target, dt, rate = GLOW_RATE) {
  return target + (cur - target) * Math.exp(-rate * Math.max(0, dt));
}

// Ring at age (s): { scale, alpha }, or null when it is over.
export function ringState(age, dur = RING_DUR) {
  if (!(age >= 0) || age >= dur) return null;
  const u = age / dur;
  return { scale: RING_R0 + (RING_R1 - RING_R0) * (1 - (1 - u) ** 3), alpha: (1 - u) ** 2 };
}

// Fixed ring pool: start(node, now) takes a free slot or the oldest one.
export function createRingPool(n = RING_POOL) {
  const p = {
    n, node: new Int32Array(n).fill(-1), t0: new Float64Array(n), gold: new Uint8Array(n),
    start(node, now, gold = 1) {
      let s = -1, old = Infinity;
      for (let i = 0; i < n; i++) {
        if (p.node[i] < 0) { s = i; break; }
        if (p.t0[i] < old) { old = p.t0[i]; s = i; }
      }
      p.node[s] = node; p.t0[s] = now; p.gold[s] = gold ? 1 : 0;
      return s;
    },
    expire(now, dur = RING_DUR) { for (let i = 0; i < n; i++) if (p.node[i] >= 0 && now - p.t0[i] >= dur) p.node[i] = -1; },
    clear() { p.node.fill(-1); },
    get live() { let k = 0; for (let i = 0; i < n; i++) if (p.node[i] >= 0) k++; return k; },
  };
  return p;
}

// ── shaders ──────────────────────────────────────────────────────────────
const GLOW_VERT = /* glsl */`
attribute float aSize;
attribute float aGlow;
attribute float aPast;
uniform float uPx;
uniform float uGlobe;
uniform float uTime;
varying float vGlow;
varying float vPast;
varying float vVis;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * w;
  vVis = 1.0;
  if (uGlobe > 0.5 && dot(normalize(w.xyz), cameraPosition - w.xyz) <= 0.0) vVis = 0.0;
  vGlow = aGlow;
  vPast = aPast;
  float pulse = 1.0 + 0.18 * aGlow * sin(uTime * 3.0 + position.x * 40.0 + position.y * 23.0);
  float s = aSize * (1.0 + 1.8 * aGlow) * pulse;
  gl_PointSize = vVis > 0.0 ? max(1.5, s * uPx / max(0.01, -mv.z)) : 0.0;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */`
varying float vGlow;
varying float vPast;
varying float vVis;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0 || vVis <= 0.0) discard;
  float core = exp(-r * r * 9.0);
  float halo = exp(-r * r * 2.5) * (1.0 - r);
  vec3 idle = vec3(1.0, 0.82, 0.55);
  vec3 past = vec3(0.35, 0.95, 0.85);
  vec3 hot = mix(vec3(1.0, 0.3, 0.1), vec3(1.0, 0.85, 0.65), vGlow * vGlow);
  vec3 base = mix(idle, past, vPast);
  float a0 = 0.3 + 0.25 * vPast;
  vec3 col = mix(base, hot, vGlow);
  float a = mix(a0 * core, core + halo * 0.8, vGlow);
  gl_FragColor = vec4(col, a);
}`;

// ── the layer ────────────────────────────────────────────────────────────
export function createNodes(ctx) {
  const { THREE, D, geo, root } = ctx;
  needThree(THREE, ['BufferGeometry', 'BufferAttribute', 'ShaderMaterial', 'Points', 'RingGeometry',
    'InstancedMesh', 'MeshBasicMaterial', 'Matrix4', 'Color', 'Group']);
  const nodes = D && D.nodes ? D.nodes : [];
  const N = nodes.length;
  let mode = 'globe', lastProj = 'globe';
  const projMode = () => (mode === 'flat' ? (ctx.proj === 'equalearth' ? 'equalearth' : 'equirect') : 'globe');

  const pos = new Float32Array(N * 3), size = new Float32Array(N), glow = new Float32Array(N), past = new Float32Array(N);
  for (let i = 0; i < N; i++) size[i] = nodeSize(nodes[i].cityPop || nodes[i].pop || 1);
  const g = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3), glowAttr = new THREE.BufferAttribute(glow, 1), pastAttr = new THREE.BufferAttribute(past, 1);
  g.setAttribute('position', posAttr);
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aGlow', glowAttr);
  g.setAttribute('aPast', pastAttr);
  const U = { uPx: { value: 600 }, uGlobe: { value: 1 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false; points.renderOrder = 11; points.name = 'nodes-glow';

  const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RING_POOL);
  rings.frustumCulled = false; rings.renderOrder = 14; rings.name = 'nodes-rings';
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < RING_POOL; i++) { rings.setMatrixAt(i, zero); rings.setColorAt(i, col.setRGB(0, 0, 0)); }
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
  function burst(i, gold = 1) { if (i >= 0 && i < N) pool.start(i, now, gold); }

  const layer = {
    group, pool, glow,
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
        if (sim && sim.firstDay) for (let i = 0; i < N; i++) if (sim.firstDay[i] >= 0) burst(i, 1);
      }
      if (frame.events) for (const ev of frame.events) if (ev.first && !ev.blocked) burst(ev.to, 1);
      for (let i = 0; i < N; i++) {
        const tg = prev ? glowLevel(prev[i]) : 0;
        glow[i] = approach(glow[i], tg, dt);
        const hadIt = sim && sim.firstDay && sim.firstDay[i] >= 0;
        past[i] = approach(past[i], hadIt && tg < 0.15 ? 1 : 0, dt, 1);
      }
      glowAttr.needsUpdate = true; pastAttr.needsUpdate = true;

      const camera = ctx.camera, renderer = ctx.renderer;
      const hpx = renderer && renderer.domElement && renderer.domElement.height ? renderer.domElement.height : 800;
      const fov = camera && camera.fov ? camera.fov : 35;
      U.uPx.value = hpx / (2 * Math.tan(fov * Math.PI / 360));
      U.uTime.value = now;

      // rings
      pool.expire(now);
      const pm = projMode();
      const c = camera && camera.position ? camera.position : null;
      for (let s = 0; s < RING_POOL; s++) {
        const i = pool.node[s];
        const st = i >= 0 ? ringState(now - pool.t0[s]) : null;
        if (!st) { rings.setMatrixAt(s, zero); continue; }
        const n = nodes[i];
        const p = geo.project(n.lat, n.lon, RING_H, pm);
        const f = geo.frame(n.lat, n.lon, pm);
        if (pm === 'globe' && c && f.n[0] * (c.x - p[0]) + f.n[1] * (c.y - p[1]) + f.n[2] * (c.z - p[2]) <= 0) { rings.setMatrixAt(s, zero); continue; }
        const k = st.scale;
        m4.set(
          f.east[0] * k, f.north[0] * k, f.n[0] * k, p[0],
          f.east[1] * k, f.north[1] * k, f.n[1] * k, p[1],
          f.east[2] * k, f.north[2] * k, f.n[2] * k, p[2],
          0, 0, 0, 1);
        rings.setMatrixAt(s, m4);
        const a = st.alpha;
        rings.setColorAt(s, col.setRGB(1.0 * a, 0.72 * a, 0.35 * a));
      }
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    },
    dispose() {
      root.remove(group);
      g.dispose(); mat.dispose();
      ringGeo.dispose(); ringMat.dispose();
      if (rings.dispose) rings.dispose();
    },
  };
  return layer;
}
