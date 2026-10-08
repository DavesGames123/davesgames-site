// ============================================================================
//  OUTBREAK  ·  render/style-holo.js — style 5, the hologram globe
// ----------------------------------------------------------------------------
//  A cyan wireframe globe, as from a projector in a situation room. Six
//  layers, all in the style group:
//    core    ShaderMaterial on a SphereGeometry at r = CORE_R. Nearly black,
//            it writes depth, so the arcs and city glows of package H on the
//            far side stay hidden. Land (field.landMask) shows as a cyan dot
//            grid with a bright edge at the coast. Infected land carries
//            the infection texture of render/infect.js (the same red as
//            every style). A thin fresnel rim completes the look. No
//            scanlines, no scan band, no flicker: the style is calm.
//    grid    LineSegments of the graticule (every 15 deg) at r = GRID_R.
//            Equator and prime meridian are brighter.
//    coast   LineSegments of the Natural Earth coast rings at r = COAST_R.
//    rings   two tilted orbit rings with ticks, which turn very slowly
//            (about 1.2 and 0.8 deg per second).
//    halo    back-face shell at r = HALO_R, additive, thin glow at the limb.
//  The line layers do not test depth: the far half shows as a dim ghost
//  through the globe (the shader dims each vertex by its facing).
//  The holo colour moves from cyan to rose as the world prevalence rises
//  (the same log tint as the night style).
//
//  The style draws no city glows and no arcs: render/nodes.js and
//  render/arcs.js (package H) draw those on top of every style.
//
//  Data (reused by relative path, not copied):
//    ../../storm-globe/data/coast-50m.bin   Natural Earth coast (public domain)
//  It loads async. Until it arrives, the globe shows without coast lines.
//  A late load after dispose() is released at once.
//
//  Colours are display values: the shaders do not include the three.js
//  colour-space chunk. No DOM and no three import at module load: THREE
//  comes from ctx, so node can import this file and test the helpers.
//
//  grep -n targets: "export function graticuleSegments", "export function ringSegments",
//                   "export function holoColor", "const CORE_FRAG", "const LINE_VERT",
//                   "const HALO_FRAG", "create(ctx)", "dispose()"
// ============================================================================
import { decodeCoast } from '../../storm-globe/coast.js';
import { toSphere, coastSegments, worldPrevalence, tintFor, approach, COAST_URL } from './style-night.js';
import { INFECT_GLSL, INFECT_EXT, infectUniforms, infectDefines } from './infect.js';

export const SOURCES = [
  { ref: 'Natural Earth 1:50m land and lakes', url: 'https://www.naturalearthdata.com/', note: 'coast rings, public domain, via storm-globe/data/coast-50m.bin' },
];

export const CORE_R = 0.985, GRID_R = 1.0, COAST_R = 1.0015, HALO_R = 1.06;
export const RING_R = [1.16, 1.24], RING_TILT = [18, -27];  // degrees about x, then z

const DEG = Math.PI / 180;

// ── pure helpers (tested in tests/style-holo.test.mjs) ──────────────────
// Graticule on a sphere of radius r: parallels every step deg (no poles),
// meridians every step deg from -90 + step to 90 - step, each cut into
// segDeg pieces. bright: 1 for the equator and the prime meridian, else 0.5.
//   -> { pos: Float32Array (6 per segment), bright: Float32Array (2 per segment), n }
export function graticuleSegments(step = 15, r = GRID_R, segDeg = 2) {
  const pos = [], bright = [];
  const push = (a, b, w) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); bright.push(w, w); };
  for (let lat = -90 + step; lat < 90 - 1e-9; lat += step) {
    const w = Math.abs(lat) < 1e-9 ? 1 : 0.5;
    const k = Math.ceil(360 * Math.cos(lat * DEG) / segDeg) || 1;
    for (let s = 0; s < k; s++) push(toSphere(lat, -180 + 360 * s / k, r), toSphere(lat, -180 + 360 * (s + 1) / k, r), w);
  }
  const top = 90 - step, k = Math.ceil(2 * top / segDeg);
  for (let lon = -180; lon < 180 - 1e-9; lon += step) {
    const w = Math.abs(lon) < 1e-9 ? 1 : 0.5;
    for (let s = 0; s < k; s++) push(toSphere(-top + 2 * top * s / k, lon, r), toSphere(-top + 2 * top * (s + 1) / k, lon, r), w);
  }
  return { pos: Float32Array.from(pos), bright: Float32Array.from(bright), n: bright.length / 2 };
}

// A ring of radius r in the xz plane (y = 0), n segments, with a radial
// tick every tickDeg deg (length tick, outward). Ticks every 90 deg are
// twice as long. The caller tilts the ring with its object rotation.
//   -> { pos, bright, n } as above (ring 0.7, ticks 1)
export function ringSegments(r, n = 256, tickDeg = 10, tick = 0.025) {
  const pos = [], bright = [];
  const at = (a, rr) => [rr * Math.cos(a), 0, -rr * Math.sin(a)];
  for (let s = 0; s < n; s++) {
    const p = at(2 * Math.PI * s / n, r), q = at(2 * Math.PI * (s + 1) / n, r);
    pos.push(...p, ...q); bright.push(0.7, 0.7);
  }
  const nt = Math.round(360 / tickDeg);
  for (let s = 0; s < nt; s++) {
    const deg = s * tickDeg, a = deg * DEG, len = deg % 90 === 0 ? 2 * tick : tick;
    pos.push(...at(a, r), ...at(a, r + len)); bright.push(1, 1);
  }
  return { pos: Float32Array.from(pos), bright: Float32Array.from(bright), n: bright.length / 2 };
}

// The line colour for a tint 0 (cyan) .. 1 (rose). Returns [r, g, b].
export function holoColor(tint) {
  const k = Math.min(1, Math.max(0, tint || 0)) * 0.8;
  const c0 = [0.25, 0.9, 1.0], c1 = [1.0, 0.38, 0.62];
  return c0.map((v, i) => v + (c1[i] - v) * k);
}

// ── shaders (GLSL for three.js ShaderMaterial) ───────────────────────────
const CORE_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vec4 mv = viewMatrix * wp;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CORE_FRAG = /* glsl */`
uniform sampler2D uLand;
uniform sampler2D uField;
uniform vec2 uTexel;
uniform vec3 uColor;
uniform float uHasLand;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vY;
${INFECT_GLSL}
float landAt(vec2 o) { return texture2D(uLand, vUv + o * uTexel).r; }
void main() {
  float land = uHasLand * landAt(vec2(0.0));
  // coast edge: the mean of a ring of taps is near 0.5 at a coast
  float m = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785398;
    m += landAt(vec2(cos(a), sin(a)) * 2.0);
  }
  m /= 8.0;
  float edge = uHasLand * (1.0 - abs(2.0 * m - 1.0));
  // land as a dot grid, one dot per degree of lon and lat
  vec2 g = fract(vUv * vec2(360.0, 180.0)) - 0.5;
  float dotv = 1.0 - smoothstep(0.18, 0.32, length(g));

  vec3 col = vec3(0.0, 0.012, 0.022);
  col += uColor * land * (0.035 + 0.16 * dotv);
  col += uColor * edge * 0.22;

  // infected land: the infection texture
  col = infectApply(col, vUv, land, texture2D(uField, vUv));

  float mu = max(dot(vN, vV), 0.0);
  col += uColor * pow(1.0 - mu, 4.0) * 0.3;
  gl_FragColor = vec4(col, 1.0);
}`;

// Lines: the facing of each vertex is the dot of its outward direction
// (the position from the centre) with the view direction. Far vertices
// keep uGhost of their brightness.
const LINE_VERT = /* glsl */`
attribute float aBright;
uniform float uGhost;
varying float vA;
varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vec4 mv = viewMatrix * wp;
  vec3 n = normalize(mat3(viewMatrix) * wp.xyz);
  float mu = dot(n, normalize(-mv.xyz));
  vA = aBright * mix(uGhost, 1.0, smoothstep(-0.12, 0.2, mu));
  gl_Position = projectionMatrix * mv;
}`;

const LINE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uGain;
varying float vA;
varying float vY;
void main() {
  gl_FragColor = vec4(uColor * vA * uGain, 1.0);
}`;

const HALO_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// Back faces: n.v runs from -1 (centre) to 0 (outer edge); the limb of the
// globe sits near n.v = -uLimb. The glow is a thin band just outside it;
// the core hides the part inside the limb.
const HALO_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uLimb;
varying vec3 vN;
varying vec3 vV;
void main() {
  float x = clamp(-dot(vN, vV) / uLimb, 0.0, 1.0);
  float g = pow(x, 6.0);
  gl_FragColor = vec4(uColor * g * 0.35, 1.0);
}`;

// ── the style ────────────────────────────────────────────────────────────
function create(ctx) {
  const { THREE } = ctx;
  const owned = [];
  const own = o => { owned.push(o); return o; };
  let disposed = false;

  const group = new THREE.Group();
  group.name = 'style-holo';
  if (ctx.root) ctx.root.add(group);

  const blank = own(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  blank.needsUpdate = true;
  const field = ctx.field || null;
  const pop = ctx.D && ctx.D.nodes ? ctx.D.nodes.reduce((s, n) => s + n.pop, 0) : 0;
  const landTex = field && field.landMask ? field.landMask : blank;
  const lw = landTex.image && landTex.image.width > 1 ? landTex.image.width : 1024;
  const lh = landTex.image && landTex.image.height > 1 ? landTex.image.height : 512;

  const c0 = holoColor(0);
  const color = new THREE.Color(c0[0], c0[1], c0[2]);   // shared by every layer
  const shared = { uColor: { value: color } };

  // core
  const coreU = {
    ...shared,
    uLand: { value: landTex },
    uField: { value: field && field.texture ? field.texture : blank },
    uTexel: { value: new THREE.Vector2(1 / lw, 1 / lh) },
    uHasLand: { value: landTex === blank ? 0 : 1 },
    ...infectUniforms(THREE, ctx),
  };
  const core = new THREE.Mesh(
    own(new THREE.SphereGeometry(CORE_R, 160, 80)),
    own(new THREE.ShaderMaterial({ uniforms: coreU, vertexShader: CORE_VERT, fragmentShader: CORE_FRAG,
      defines: infectDefines(ctx.phone), extensions: INFECT_EXT })),
  );
  core.name = 'holo-core';
  core.renderOrder = 0;
  group.add(core);

  // line layers share one vertex and fragment pair, with their own gain
  const lineMat = (gain, ghost) => own(new THREE.ShaderMaterial({
    uniforms: { ...shared, uGain: { value: gain }, uGhost: { value: ghost } },
    vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const lines = (seg, mat, name, order) => {
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(seg.pos, 3));
    geo.setAttribute('aBright', new THREE.BufferAttribute(seg.bright, 1));
    const l = new THREE.LineSegments(geo, mat);
    l.name = name; l.renderOrder = order; l.frustumCulled = false;
    return l;
  };

  group.add(lines(graticuleSegments(), lineMat(0.32, 0.12), 'holo-grid', 1));

  const rings = new THREE.Group();
  rings.name = 'holo-rings';
  const ringMat = lineMat(0.45, 0.25);
  const ringObjs = RING_R.map((r, k) => {
    const pivot = new THREE.Group();
    if (pivot.rotation) { pivot.rotation.x = RING_TILT[k] * DEG; pivot.rotation.z = RING_TILT[k] * 0.5 * DEG; }
    const l = lines(ringSegments(r), ringMat, `holo-ring-${k}`, 3);
    pivot.add(l);
    rings.add(pivot);
    return l;
  });
  group.add(rings);

  const haloU = { ...shared, uLimb: { value: Math.sqrt(1 - 1 / (HALO_R * HALO_R)) } };
  const halo = new THREE.Mesh(
    own(new THREE.SphereGeometry(HALO_R, 96, 48)),
    own(new THREE.ShaderMaterial({
      uniforms: haloU, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })),
  );
  halo.name = 'holo-halo';
  halo.renderOrder = 4;
  group.add(halo);

  // coast lines (async)
  const coastMat = lineMat(0.85, 0.1);
  const coastReady = (async () => {
    const r = await fetch(COAST_URL);
    if (!r.ok) throw new Error(`coast: HTTP ${r.status}`);
    const seg = coastSegments(decodeCoast(await r.arrayBuffer()), COAST_R);
    if (disposed) return;
    group.add(lines(seg, coastMat, 'holo-coast', 2));
  })().catch(e => { if (!disposed) console.warn('outbreak holo style:', e.message); });

  let tint = 0;
  return {
    group,
    coastReady,
    update(frame) {
      if (disposed || !frame) return;
      const t = frame.t || 0, dt = frame.dt || 0;
      if (field) {
        if (field.texture && coreU.uField.value !== field.texture) coreU.uField.value = field.texture;
        if (field.landMask && coreU.uLand.value !== field.landMask) { coreU.uLand.value = field.landMask; coreU.uHasLand.value = 1; }
      }
      tint = approach(tint, tintFor(worldPrevalence(frame.sim, pop)), dt, 1.5);
      const c = holoColor(tint);
      color.r = c[0]; color.g = c[1]; color.b = c[2];
      // the rings turn in opposite senses, about 1.2 and 0.8 deg per second
      if (ringObjs[0].rotation) { ringObjs[0].rotation.y = t * 0.021; ringObjs[1].rotation.y = -t * 0.014; }
    },
    get tint() { return tint; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      for (const o of owned) o.dispose();
      owned.length = 0;
    },
  };
}

export default { id: 'holo', label: 'Hologram', mode: 'globe', create };

// The GLSL sources, for an offline compile check (naga after a 450 rewrite).
export const SHADERS = {
  core: [CORE_VERT, CORE_FRAG], line: [LINE_VERT, LINE_FRAG], halo: [HALO_VERT, HALO_FRAG],
};
