// ============================================================================
//  OUTBREAK  ·  render/style-night.js — style 1, the night globe (default)
// ----------------------------------------------------------------------------
//  A dark globe seen at night. Five layers, all in the style group:
//    globe   ShaderMaterial on a unit SphereGeometry. Dark ocean, slightly
//            lighter land (field.landMask), a soft glow on the ocean side of
//            each coast (a ring of landMask taps), NASA city lights tinted
//            amber, and a red shift of the lights where the prevalence field
//            (field.texture R) is high. The deaths share (field.texture G)
//            dims the lights of a place. A fresnel rim lights the limb.
//    coast   LineSegments of the Natural Earth coast rings at r = 1.0012,
//            additive teal, faded at the limb. Lakes at half brightness.
//    atmos   back-face sphere at r = 1.08, additive; its glow peaks at the
//            limb and fades out. Its colour moves from blue to rose as the
//            world prevalence rises.
//    stars   Points drawn at infinity (depth = far plane), so they do not
//            depend on the camera far plane and the globe hides them.
//  The style draws no city glows and no arcs: render/nodes.js and
//  render/arcs.js (package H) draw those on top of every style.
//
//  Data (reused by relative path, not copied):
//    ../../ancient-earth/data/present/lights-2k.jpg   NASA city lights (public domain)
//    ../../storm-globe/data/coast-50m.bin             Natural Earth coast (public domain)
//  Both load async. Until they arrive, the globe shows without lights and
//  coast lines. A late load after dispose() is released at once.
//
//  Colours are display values: the shaders do not include the three.js
//  colour-space chunk, so the renderer output space does not change them.
//
//  No DOM and no three import at module load: THREE comes from ctx, so node
//  can import this file and test the pure helpers below.
//
//  grep -n targets: "export function toSphere", "export function coastSegments",
//                   "export function starField", "export function worldPrevalence",
//                   "export function approach", "const GLOBE_FRAG", "const ATMOS_FRAG",
//                   "const COAST_VERT", "const STAR_VERT", "create(ctx)", "dispose()"
// ============================================================================
import { decodeCoast } from '../../storm-globe/coast.js';
import { makeRng } from '../rng.js';

export const SOURCES = [
  { ref: 'NASA Earth Observatory, Earth at Night (Black Marble) 2016', url: 'https://earthobservatory.nasa.gov/features/NightLights', note: 'city lights texture, public domain, via ancient-earth/data/present/lights-2k.jpg' },
  { ref: 'Natural Earth 1:50m land and lakes', url: 'https://www.naturalearthdata.com/', note: 'coast rings, public domain, via storm-globe/data/coast-50m.bin' },
];

export const LIGHTS_URL = new URL('../../ancient-earth/data/present/lights-2k.jpg', import.meta.url);
export const COAST_URL = new URL('../../storm-globe/data/coast-50m.bin', import.meta.url);
export const COAST_R = 1.0012, ATMOS_R = 1.08, STAR_COUNT = 1600, STAR_SEED = 0x5eed1;

const DEG = Math.PI / 180;

// ── pure helpers (tested in tests/style-night.test.mjs) ─────────────────
// The contract's globe axes: x = cos lat cos lon, y = sin lat, z = -cos lat sin lon.
export function toSphere(lat, lon, r = 1) {
  const a = lat * DEG, b = lon * DEG, c = Math.cos(a);
  return [r * c * Math.cos(b), r * Math.sin(a), -r * c * Math.sin(b)];
}

// Coast rings -> segment pairs on a sphere of radius r.
//   rings: [{ kind: 0 land | 1 lake, pts: Float32Array (lon, lat) pairs }]
//   -> { pos: Float32Array (6 per segment), bright: Float32Array (2 per segment), n }
// Polygon-cut artefacts are not coasts, so the helper drops them: segments
// along the antimeridian (both ends at |lon| > 179.99) and segments below
// lat -89.9 (the closing edge of Antarctica). A segment longer than
// maxStep degrees is cut into parts so its chords stay near the surface.
export function coastSegments(rings, r = COAST_R, maxStep = 1.5) {
  const pos = [], bright = [];
  for (const ring of rings) {
    const p = ring.pts, n = p.length / 2, b = ring.kind ? 0.5 : 1;
    for (let i = 0; i < n - 1; i++) {
      const lo0 = p[i * 2], la0 = p[i * 2 + 1], lo1 = p[i * 2 + 2], la1 = p[i * 2 + 3];
      if (Math.abs(lo0) > 179.99 && Math.abs(lo1) > 179.99) continue;
      if (la0 < -89.9 && la1 < -89.9) continue;
      let dl = lo1 - lo0;
      if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
      const len = Math.hypot(dl * Math.cos((la0 + la1) * 0.5 * DEG), la1 - la0);
      const k = Math.max(1, Math.ceil(len / maxStep));
      let prev = toSphere(la0, lo0, r);
      for (let s = 1; s <= k; s++) {
        const t = s / k, cur = toSphere(la0 + (la1 - la0) * t, lo0 + dl * t, r);
        pos.push(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2]);
        bright.push(b, b);
        prev = cur;
      }
    }
  }
  return { pos: Float32Array.from(pos), bright: Float32Array.from(bright), n: bright.length / 2 };
}

// Stars on the unit sphere from a visual RNG stream (never the model's).
//   -> { dir: Float32Array (3 per star), size: Float32Array, bright: Float32Array }
export function starField(n = STAR_COUNT, seed = STAR_SEED) {
  const rng = makeRng(seed), dir = new Float32Array(n * 3), size = new Float32Array(n), bright = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = 2 * rng.next() - 1, a = 2 * Math.PI * rng.next(), c = Math.sqrt(1 - y * y);
    dir[i * 3] = c * Math.cos(a); dir[i * 3 + 1] = y; dir[i * 3 + 2] = c * Math.sin(a);
    const m = rng.next();
    size[i] = 1 + 2.2 * m * m * m;          // few large stars
    bright[i] = 0.25 + 0.75 * Math.pow(rng.next(), 2.5);
  }
  return { dir, size, bright };
}

// World prevalence I / population, from a sim (model.js) and the nodes.
// Returns 0 for a missing sim, so the style draws before the first run.
export function worldPrevalence(sim, pop) {
  if (!sim || !sim.I) return 0;
  let i = 0;
  for (let k = 0; k < sim.I.length; k++) i += sim.I[k];
  return pop > 0 ? i / pop : 0;
}

// The tint the atmosphere and rim use: 0 (calm blue) .. 1 (rose), on a log
// scale, so 1 in 100 000 shows and 1 in 20 is full.
export function tintFor(prev) {
  if (!(prev > 1e-5)) return 0;
  return Math.min(1, Math.log10(prev / 1e-5) / Math.log10(0.05 / 1e-5));
}

// First-order approach to a target with a time constant tau (s); frame-rate
// independent, no snaps.
export function approach(cur, target, dt, tau = 1.5) {
  if (!(dt > 0)) return cur;
  return target + (cur - target) * Math.exp(-dt / tau);
}

// ── shaders (GLSL for three.js ShaderMaterial) ───────────────────────────
const GLOBE_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const GLOBE_FRAG = /* glsl */`
uniform sampler2D uLights;
uniform sampler2D uLand;
uniform sampler2D uField;
uniform vec2 uTexel;
uniform float uTime;
uniform float uTint;
uniform float uHasLand;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
float landAt(vec2 o) { return texture2D(uLand, vUv + o * uTexel).r; }
void main() {
  float land = mix(0.0, landAt(vec2(0.0)), uHasLand);
  // coast halo: the mean of two rings of taps; it is near 0.5 at a coast
  float m = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785398;
    vec2 d = vec2(cos(a), sin(a));
    m += landAt(d * 2.5) + landAt(d * 6.0);
  }
  m /= 16.0;
  float coast = uHasLand * (1.0 - abs(2.0 * m - 1.0));
  vec3 ocean = vec3(0.006, 0.014, 0.034);
  vec3 ground = vec3(0.022, 0.030, 0.048);
  vec3 col = mix(ocean, ground, land);
  col += vec3(0.05, 0.32, 0.46) * coast * coast * (1.0 - 0.6 * land) * 0.55;

  vec4 f = texture2D(uField, vUv);
  float prev = clamp(f.r, 0.0, 1.0);
  float dead = clamp(f.g, 0.0, 1.0);
  float pulse = 0.82 + 0.18 * sin(uTime * 2.2 + vUv.x * 40.0 + vUv.y * 23.0);

  float li = texture2D(uLights, vUv).r;
  li = pow(li, 1.5) * 1.9 * (1.0 - 0.65 * dead);
  vec3 warm = vec3(1.0, 0.70, 0.36);
  vec3 sick = vec3(1.0, 0.17, 0.24);
  vec3 lightCol = mix(warm, sick, smoothstep(0.02, 0.5, prev));
  col += lightCol * li * mix(1.0, pulse, step(0.02, prev));
  // a red haze over infected land, so places with few lights still show
  col += vec3(0.85, 0.06, 0.12) * prev * (0.25 + 0.35 * pulse) * (0.3 + 0.7 * land);

  float mu = max(dot(vN, vV), 0.0);
  float rim = pow(1.0 - mu, 3.0);
  vec3 rimCol = mix(vec3(0.20, 0.50, 1.0), vec3(1.0, 0.32, 0.40), uTint * 0.7);
  col += rimCol * rim * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMOS_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// Back faces: n.v runs from -1 (centre) to 0 (outer edge). The planet limb
// sits near n.v = -sqrt(1 - (1 / ATMOS_R)^2), about -0.38 at r = 1.08.
const ATMOS_FRAG = /* glsl */`
uniform float uTint;
uniform float uLimb;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
void main() {
  float g = clamp(-dot(vN, vV) / uLimb, 0.0, 1.0);
  g = g * g * g;
  vec3 c = mix(vec3(0.18, 0.46, 1.0), vec3(1.0, 0.28, 0.42), uTint * 0.75);
  float breathe = 1.0 + 0.12 * uTint * sin(uTime * 1.3);
  gl_FragColor = vec4(c * g * 0.85 * breathe, 1.0);
}`;

const COAST_VERT = /* glsl */`
attribute float aBright;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * position);
  float mu = dot(n, normalize(-mv.xyz));
  vA = aBright * smoothstep(0.0, 0.35, mu);
  gl_Position = projectionMatrix * mv;
}`;

const COAST_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uGain;
varying float vA;
void main() { gl_FragColor = vec4(uColor * vA * uGain, 1.0); }`;

const STAR_VERT = /* glsl */`
attribute float aSize;
attribute float aBright;
uniform float uPx;
varying float vB;
void main() {
  vec3 d = mat3(viewMatrix) * position;
  vec4 p = projectionMatrix * vec4(d, 1.0);
  p.z = p.w * 0.99999;
  gl_Position = p;
  gl_PointSize = aSize * uPx;
  vB = aBright;
}`;

const STAR_FRAG = /* glsl */`
uniform float uFade;
varying float vB;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r) * vB * uFade;
  gl_FragColor = vec4(vec3(0.78, 0.85, 1.0) * a, 1.0);
}`;

// ── the style ────────────────────────────────────────────────────────────
function create(ctx) {
  const { THREE } = ctx;
  const owned = [];               // geometries, materials, textures to dispose
  const own = o => { owned.push(o); return o; };
  let disposed = false;

  const group = new THREE.Group();
  group.name = 'style-night';
  if (ctx.root) ctx.root.add(group);

  // 1x1 stand-ins until the lights load, or when F gives no field
  const blank = own(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  blank.needsUpdate = true;

  const field = ctx.field || null;
  const pop = ctx.D && ctx.D.nodes ? ctx.D.nodes.reduce((s, n) => s + n.pop, 0) : 0;
  const landTex = field && field.landMask ? field.landMask : blank;
  const lw = landTex.image && landTex.image.width > 1 ? landTex.image.width : 1024;
  const lh = landTex.image && landTex.image.height > 1 ? landTex.image.height : 512;

  // globe
  const gU = {
    uLights: { value: blank },
    uLand: { value: landTex },
    uField: { value: field && field.texture ? field.texture : blank },
    uTexel: { value: new THREE.Vector2(1 / lw, 1 / lh) },
    uTime: { value: 0 },
    uTint: { value: 0 },
    uHasLand: { value: landTex === blank ? 0 : 1 },
  };
  const globe = new THREE.Mesh(
    own(new THREE.SphereGeometry(1, 160, 80)),
    own(new THREE.ShaderMaterial({ uniforms: gU, vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG })),
  );
  globe.name = 'night-globe';
  globe.renderOrder = 0;
  group.add(globe);

  // atmosphere
  const aU = { uTint: { value: 0 }, uTime: { value: 0 }, uLimb: { value: Math.sqrt(1 - 1 / (ATMOS_R * ATMOS_R)) } };
  const atmos = new THREE.Mesh(
    own(new THREE.SphereGeometry(ATMOS_R, 96, 48)),
    own(new THREE.ShaderMaterial({
      uniforms: aU, vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })),
  );
  atmos.name = 'night-atmos';
  atmos.renderOrder = 2;
  group.add(atmos);

  // stars
  const sf = starField();
  const sGeo = own(new THREE.BufferGeometry());
  sGeo.setAttribute('position', new THREE.BufferAttribute(sf.dir, 3));
  sGeo.setAttribute('aSize', new THREE.BufferAttribute(sf.size, 1));
  sGeo.setAttribute('aBright', new THREE.BufferAttribute(sf.bright, 1));
  const px = ctx.renderer && ctx.renderer.getPixelRatio ? ctx.renderer.getPixelRatio() : 1;
  const sU = { uPx: { value: px }, uFade: { value: 1 } };
  const stars = new THREE.Points(sGeo, own(new THREE.ShaderMaterial({
    uniforms: sU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));
  stars.name = 'night-stars';
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  group.add(stars);

  // coast lines (async)
  const cU = { uColor: { value: new THREE.Color(0.25, 0.85, 1.0) }, uGain: { value: 0.55 } };
  const cMat = own(new THREE.ShaderMaterial({
    uniforms: cU, vertexShader: COAST_VERT, fragmentShader: COAST_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const coastReady = (async () => {
    const r = await fetch(COAST_URL);
    if (!r.ok) throw new Error(`coast: HTTP ${r.status}`);
    const seg = coastSegments(decodeCoast(await r.arrayBuffer()));
    if (disposed) return;
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(seg.pos, 3));
    geo.setAttribute('aBright', new THREE.BufferAttribute(seg.bright, 1));
    const lines = new THREE.LineSegments(geo, cMat);
    lines.name = 'night-coast';
    lines.renderOrder = 1;
    group.add(lines);
  })().catch(e => { if (!disposed) console.warn('outbreak night style:', e.message); });

  // city lights (async)
  if (THREE.TextureLoader) {
    new THREE.TextureLoader().load(String(LIGHTS_URL), tex => {
      if (disposed) { tex.dispose(); return; }
      own(tex);
      tex.anisotropy = ctx.renderer && ctx.renderer.capabilities ? Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()) : 1;
      gU.uLights.value = tex;
    }, undefined, () => { if (!disposed) console.warn('outbreak night style: city lights did not load'); });
  }

  let tint = 0;
  return {
    group,
    coastReady,
    update(frame) {
      if (disposed || !frame) return;
      const t = frame.t || 0;
      gU.uTime.value = t; aU.uTime.value = t;
      if (field) {          // F may swap textures on a resize of the field
        if (field.texture && gU.uField.value !== field.texture) gU.uField.value = field.texture;
        if (field.landMask && gU.uLand.value !== field.landMask) { gU.uLand.value = field.landMask; gU.uHasLand.value = 1; }
      }
      tint = approach(tint, tintFor(worldPrevalence(frame.sim, pop)), frame.dt || 0, 1.5);
      gU.uTint.value = tint; aU.uTint.value = tint;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      for (const o of owned) o.dispose();
      owned.length = 0;
    },
  };
}

export default { id: 'night', label: 'Night', mode: 'globe', create };

// The GLSL sources, for an offline compile check (naga after a 450 rewrite).
export const SHADERS = {
  globe: [GLOBE_VERT, GLOBE_FRAG], atmos: [ATMOS_VERT, ATMOS_FRAG],
  coast: [COAST_VERT, COAST_FRAG], stars: [STAR_VERT, STAR_FRAG],
};
