// ============================================================================
//  OUTBREAK  ·  render/style-marble.js — style 2, the Blue Marble globe
// ----------------------------------------------------------------------------
//  A daylight globe with a sun. Three layers, all in the style group:
//    globe   ShaderMaterial on a unit SphereGeometry. NASA Blue Marble on the
//            day side with Lambert light from the sun and a specular glint on
//            the ocean (field.landMask selects the ocean). The night side
//            shows the NASA city lights, dim. Infected land carries the
//            infection texture of render/infect.js on both sides (hard
//            front, blood-red ground, colonies, stipple, veins); the deaths
//            share (field.texture G) turns it crimson-black.
//            A soft terminator band goes orange at dusk.
//    atmos   back-face sphere at r = 1.06, additive; it glows at the limb and
//            is bright only on the sun side. It moves to rose as the world
//            prevalence rises.
//    stars   Points at the far plane, from the night style's starField.
//
//  The sun: a fixed sun in world space puts half of all camera shots in the
//  dark. So the sun follows the camera at an offset (SUN_AZ east of the view
//  direction, SUN_EL above it). The view is mostly lit, and the terminator
//  shows at one side. The sun direction eases (approach), so a camera cut
//  does not make the light snap.
//
//  Data (reused by relative path, not copied):
//    ../../ancient-earth/data/present/color-2k.jpg   NASA Blue Marble (public domain)
//    ../../ancient-earth/data/present/lights-2k.jpg  NASA city lights (public domain)
//  Both load async. Until they arrive, a flat ocean and land colour from the
//  land mask shows. A late load after dispose() is released at once.
//
//  Colours are display values: the shaders do not include the three.js
//  colour-space chunk. The Blue Marble jpg is sampled as is (sRGB in, sRGB
//  out), so no colour-space setting on the texture is necessary.
//
//  No DOM and no three import at module load: THREE comes from ctx, so node
//  can import this file and test the pure helpers below.
//
//  grep -n targets: "export function sunFrom", "export function slerpDir",
//                   "const GLOBE_FRAG", "const ATMOS_FRAG", "create(ctx)",
//                   "dispose()", "export const SHADERS"
// ============================================================================
import { starField, worldPrevalence, tintFor, approach } from './style-night.js';
import { INFECT_GLSL, INFECT_EXT, infectUniforms, infectDefines } from './infect.js';

export const SOURCES = [
  { ref: 'NASA Earth Observatory, Blue Marble Next Generation (Stockli et al. 2005)', url: 'https://earthobservatory.nasa.gov/features/BlueMarble', note: 'day colour texture, public domain, via ancient-earth/data/present/color-2k.jpg' },
  { ref: 'NASA Earth Observatory, Earth at Night (Black Marble) 2016', url: 'https://earthobservatory.nasa.gov/features/NightLights', note: 'city lights texture, public domain, via ancient-earth/data/present/lights-2k.jpg' },
];

export const COLOR_URL = new URL('../../ancient-earth/data/present/color-2k.jpg', import.meta.url);
export const LIGHTS_URL = new URL('../../ancient-earth/data/present/lights-2k.jpg', import.meta.url);
export const ATMOS_R = 1.06, SUN_AZ = 38, SUN_EL = 18, SUN_TAU = 1.2;

const DEG = Math.PI / 180;

// ── pure helpers (tested in tests/style-marble.test.mjs) ────────────────
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [1, 0, 0];
}

// The sun direction (unit, world space) for a camera at camPos looking at
// the globe centre. The sun sits az degrees east of the view direction
// (about world +y) and el degrees above the view plane. A camera on the
// axis (pole) uses +z as its east reference, so the result is never NaN.
export function sunFrom(camPos, az = SUN_AZ, el = SUN_EL) {
  const v = norm(camPos || [0, 0, 1]);
  let east = [v[2], 0, -v[0]];                 // y x v: east of v about +y
  if (Math.hypot(east[0], east[2]) < 1e-6) east = [0, 0, 1];
  east = norm(east);
  // north in the view frame: v x east
  const north = norm([v[1] * east[2] - v[2] * east[1], v[2] * east[0] - v[0] * east[2], v[0] * east[1] - v[1] * east[0]]);
  const ca = Math.cos(az * DEG), sa = Math.sin(az * DEG), ce = Math.cos(el * DEG), se = Math.sin(el * DEG);
  return norm([
    v[0] * ca * ce + east[0] * sa * ce + north[0] * se,
    v[1] * ca * ce + east[1] * sa * ce + north[1] * se,
    v[2] * ca * ce + east[2] * sa * ce + north[2] * se,
  ]);
}

// Ease a unit direction toward a target with a time constant tau (s):
// approach on each component, then normalise. Frame-rate independent to
// first order; a near-opposite target still turns (no zero vector).
export function slerpDir(cur, target, dt, tau = SUN_TAU) {
  const k = dt > 0 ? Math.exp(-dt / tau) : 1;
  const m = [target[0] + (cur[0] - target[0]) * k, target[1] + (cur[1] - target[1]) * k, target[2] + (cur[2] - target[2]) * k];
  return Math.hypot(m[0], m[1], m[2]) < 1e-6 ? norm(target) : norm(m);
}

// ── shaders (GLSL for three.js ShaderMaterial) ───────────────────────────
const GLOBE_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const GLOBE_FRAG = /* glsl */`
uniform sampler2D uDay;
uniform sampler2D uLights;
uniform sampler2D uLand;
uniform sampler2D uField;
uniform vec3 uSun;
uniform float uTime;
uniform float uTint;
uniform float uHasDay;
uniform float uHasLand;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vV;
${INFECT_GLSL}
void main() {
  vec3 n = normalize(vW);
  vec3 v = normalize(vV);
  float land = uHasLand * texture2D(uLand, vUv).r;
  vec3 flatCol = mix(vec3(0.03, 0.10, 0.24), vec3(0.20, 0.27, 0.14), land);
  vec3 day = mix(flatCol, texture2D(uDay, vUv).rgb, uHasDay);

  float ndl = dot(n, uSun);
  float lit = smoothstep(-0.08, 0.25, ndl);
  float diff = max(ndl, 0.0);
  vec3 col = day * (0.04 + 1.05 * diff);

  // ocean glint (Blinn-Phong), only where the land mask says ocean
  vec3 h = normalize(uSun + v);
  float spec = pow(max(dot(n, h), 0.0), 60.0) * (1.0 - land) * lit;
  col += vec3(1.0, 0.92, 0.78) * spec * 0.45;

  // dusk band at the terminator
  float dusk = exp(-ndl * ndl * 90.0);
  col += vec3(0.55, 0.22, 0.05) * dusk * 0.18;

  // city lights on the night side
  float li = texture2D(uLights, vUv).r;
  col += vec3(1.0, 0.72, 0.40) * pow(li, 1.6) * 1.1 * (1.0 - lit);

  // the infection texture, by day and by night (it glows: no sun term)
  col = infectApply(col, vUv, land, texture2D(uField, vUv));

  // fresnel rim, toward the sun side
  float mu = max(dot(n, v), 0.0);
  float rim = pow(1.0 - mu, 5.0) * (0.25 + 0.75 * lit);
  vec3 rimCol = mix(vec3(0.35, 0.62, 1.0), vec3(1.0, 0.36, 0.44), uTint * 0.7);
  col += rimCol * rim * 0.3;
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMOS_VERT = /* glsl */`
varying vec3 vW;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Back faces: n.v runs from -1 (centre) to 0 (outer edge). The planet limb
// sits near n.v = -sqrt(1 - (1 / ATMOS_R)^2).
const ATMOS_FRAG = /* glsl */`
uniform vec3 uSun;
uniform float uTint;
uniform float uLimb;
varying vec3 vW;
varying vec3 vV;
void main() {
  vec3 n = normalize(vW);
  float g = clamp(-dot(n, normalize(vV)) / uLimb, 0.0, 1.0);
  g = g * g * g;
  float lit = smoothstep(-0.35, 0.4, dot(-n, uSun));
  vec3 c = mix(vec3(0.30, 0.58, 1.0), vec3(1.0, 0.32, 0.45), uTint * 0.7);
  gl_FragColor = vec4(c * g * (0.12 + 0.95 * lit), 1.0);
}`;

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
varying float vB;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r) * vB * 0.7;
  gl_FragColor = vec4(vec3(0.85, 0.88, 1.0) * a, 1.0);
}`;

// ── the style ────────────────────────────────────────────────────────────
function create(ctx) {
  const { THREE } = ctx;
  const owned = [];
  const own = o => { owned.push(o); return o; };
  let disposed = false;

  const group = new THREE.Group();
  group.name = 'style-marble';
  if (ctx.root) ctx.root.add(group);

  const blank = own(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  blank.needsUpdate = true;

  const field = ctx.field || null;
  const pop = ctx.D && ctx.D.nodes ? ctx.D.nodes.reduce((s, n) => s + n.pop, 0) : 0;
  const landTex = field && field.landMask ? field.landMask : blank;
  const camPos = () => {
    const p = ctx.camera && ctx.camera.position;
    return p ? [p.x, p.y, p.z] : [0, 0, 1];
  };
  let sun = sunFrom(camPos());

  const sunVec = new THREE.Vector3(sun[0], sun[1], sun[2]);
  const gU = {
    uDay: { value: blank },
    uLights: { value: blank },
    uLand: { value: landTex },
    uField: { value: field && field.texture ? field.texture : blank },
    uSun: { value: sunVec },
    uTime: { value: 0 },
    uTint: { value: 0 },
    uHasDay: { value: 0 },
    uHasLand: { value: landTex === blank ? 0 : 1 },
    ...infectUniforms(THREE, ctx),
  };
  const globe = new THREE.Mesh(
    own(new THREE.SphereGeometry(1, 160, 80)),
    own(new THREE.ShaderMaterial({ uniforms: gU, vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG,
      defines: infectDefines(ctx.phone), extensions: INFECT_EXT })),
  );
  globe.name = 'marble-globe';
  globe.renderOrder = 0;
  group.add(globe);

  const aU = { uSun: { value: sunVec }, uTint: { value: 0 }, uLimb: { value: Math.sqrt(1 - 1 / (ATMOS_R * ATMOS_R)) } };
  const atmos = new THREE.Mesh(
    own(new THREE.SphereGeometry(ATMOS_R, 96, 48)),
    own(new THREE.ShaderMaterial({
      uniforms: aU, vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })),
  );
  atmos.name = 'marble-atmos';
  atmos.renderOrder = 2;
  group.add(atmos);

  const sf = starField(1200, 0x5eed2);
  const sGeo = own(new THREE.BufferGeometry());
  sGeo.setAttribute('position', new THREE.BufferAttribute(sf.dir, 3));
  sGeo.setAttribute('aSize', new THREE.BufferAttribute(sf.size, 1));
  sGeo.setAttribute('aBright', new THREE.BufferAttribute(sf.bright, 1));
  const px = ctx.renderer && ctx.renderer.getPixelRatio ? ctx.renderer.getPixelRatio() : 1;
  const stars = new THREE.Points(sGeo, own(new THREE.ShaderMaterial({
    uniforms: { uPx: { value: px } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));
  stars.name = 'marble-stars';
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  group.add(stars);

  // textures (async)
  const aniso = ctx.renderer && ctx.renderer.capabilities ? Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()) : 1;
  const loadTex = (url, onTex, what) => {
    if (!THREE.TextureLoader) return;
    new THREE.TextureLoader().load(String(url), tex => {
      if (disposed) { tex.dispose(); return; }
      own(tex);
      tex.anisotropy = aniso;
      onTex(tex);
    }, undefined, () => { if (!disposed) console.warn(`outbreak marble style: ${what} did not load`); });
  };
  loadTex(COLOR_URL, t => { gU.uDay.value = t; gU.uHasDay.value = 1; }, 'Blue Marble');
  loadTex(LIGHTS_URL, t => { gU.uLights.value = t; }, 'city lights');

  let tint = 0;
  return {
    group,
    get sun() { return sun.slice(); },
    update(frame) {
      if (disposed || !frame) return;
      const dt = frame.dt || 0;
      gU.uTime.value = frame.t || 0;
      if (field) {
        if (field.texture && gU.uField.value !== field.texture) gU.uField.value = field.texture;
        if (field.landMask && gU.uLand.value !== field.landMask) { gU.uLand.value = field.landMask; gU.uHasLand.value = 1; }
      }
      sun = slerpDir(sun, sunFrom(camPos()), dt);
      sunVec.set(sun[0], sun[1], sun[2]);
      tint = approach(tint, tintFor(worldPrevalence(frame.sim, pop)), dt, 1.5);
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

export default { id: 'marble', label: 'Marble', mode: 'globe', create };

// The GLSL sources, for an offline compile check (naga after a 450 rewrite).
export const SHADERS = {
  globe: [GLOBE_VERT, GLOBE_FRAG], atmos: [ATMOS_VERT, ATMOS_FRAG], stars: [STAR_VERT, STAR_FRAG],
};
