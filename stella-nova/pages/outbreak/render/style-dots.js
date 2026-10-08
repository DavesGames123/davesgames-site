// ============================================================================
//  OUTBREAK  ·  render/style-dots.js — style 3, the dot-matrix globe
// ----------------------------------------------------------------------------
//  A globe drawn as a dot matrix. FIB_N Fibonacci points cover the sphere at
//  equal spacing. About 29 % of them fall on land, so about 21k land dots
//  show. Three layers, all in the style group:
//    base    a dark sphere at r = BASE_R. It writes depth, so the far side
//            dots are hidden. A soft fresnel rim lights the limb.
//    dots    THREE.Points at r = DOT_R. The vertex shader samples
//            field.landMask at the dot (vertex texture fetch) and decides
//            land or ocean. Land dots take their colour and size from
//            field.texture: R = prevalence glow, G = deaths share. Ocean
//            dots are small and dim, so the sphere outline stays visible.
//            Infected dots pulse slowly.
//    atmos   back-face sphere at r = ATMOS_R, additive, a thin rim glow.
//  The dot size follows the camera distance: the shader gets uScale, the
//  drawing-buffer height over 2 tan(fov / 2), so a dot covers a fixed part
//  of the dot spacing at every zoom.
//
//  Before setWorld() fills the land mask, every dot reads as ocean. The
//  textures are the same objects after the fill, so nothing is swapped.
//  The style draws no city glows and no arcs: render/nodes.js and
//  render/arcs.js (package H) draw those on top.
//
//  No DOM and no three import at module load: THREE comes from ctx, so node
//  can import this file and test the pure helpers below.
//
//  grep -n targets: "export function fibSphere", "export function dotSpacing",
//                   "export function pointScale", "export function dotColor",
//                   "export function landAt", "const DOT_VERT", "const DOT_FRAG",
//                   "const BASE_FRAG", "create(ctx)", "dispose()",
//                   "export const SHADERS"
// ============================================================================

export const SOURCES = [
  { ref: 'Gonzalez 2010, Measurement of areas on a sphere using Fibonacci and latitude-longitude lattices, Math Geosci 42:49', url: 'https://doi.org/10.1007/s11004-009-9257-x', note: 'Fibonacci lattice for equal-area dot placement' },
  { ref: 'Natural Earth 1:50m land', url: 'https://www.naturalearthdata.com/', note: 'land mask through render/field.js, public domain' },
];

export const FIB_N = 72000, BASE_R = 0.996, DOT_R = 1.002, ATMOS_R = 1.05;
export const DOT_FILL = 0.62;            // dot diameter / dot spacing on land
export const SIZE_MIN = 1.0, SIZE_MAX = 14;

const DEG = Math.PI / 180;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// ── pure helpers (tested in tests/style-dots.test.mjs) ──────────────────
// n Fibonacci points on a sphere of radius r, in the contract's axes
// (x = cos lat cos lon, y = sin lat, z = -cos lat sin lon).
//   -> { pos: Float32Array(3n), uv: Float32Array(2n) (u = (lon+180)/360, v = (lat+90)/180), n }
export function fibSphere(n = FIB_N, r = DOT_R) {
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n;                  // cell centres, no dot at a pole
    const lat = Math.asin(y);
    let lon = (i * GOLDEN) % (2 * Math.PI);
    if (lon > Math.PI) lon -= 2 * Math.PI;
    const c = Math.cos(lat);
    pos[i * 3] = r * c * Math.cos(lon); pos[i * 3 + 1] = r * y; pos[i * 3 + 2] = -r * c * Math.sin(lon);
    uv[i * 2] = (lon / DEG + 180) / 360; uv[i * 2 + 1] = (lat / DEG + 90) / 180;
  }
  return { pos, uv, n };
}

// Mean distance between neighbour dots on a sphere of radius r.
export function dotSpacing(n = FIB_N, r = DOT_R) {
  return r * Math.sqrt(4 * Math.PI / n);
}

// gl_PointSize = world size x pointScale / view depth.
export function pointScale(bufferH, fovDeg) {
  return bufferH / (2 * Math.tan(fovDeg * DEG / 2));
}

// The land test of the shader, on a CPU mask (Uint8Array W x H, row 0 south).
export function landAt(mask, W, H, u, v) {
  const i = Math.min(W - 1, Math.max(0, Math.floor(u * W))), j = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
  return mask[j * W + i] > 0;
}

// The land dot colour of DOT_VERT, in JS: glow 0..1 (prevalence), dead 0..1.
// Calm teal -> amber -> hot red-white; the deaths share greys it out.
export function dotColor(glow, dead = 0) {
  const g = Math.min(1, Math.max(0, glow)), d = Math.min(1, Math.max(0, dead));
  const base = [0.22, 0.52, 0.62], amber = [1.0, 0.62, 0.18], hot = [1.0, 0.16, 0.10], white = [1.0, 0.85, 0.75];
  const mix = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
  const s = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  let c = mix(base, amber, s(0.0, 0.35, g));
  c = mix(c, hot, s(0.35, 0.8, g));
  c = mix(c, white, s(0.9, 1.0, g) * 0.5);
  const grey = [0.30, 0.27, 0.32];
  return mix(c, grey, d * 0.6);
}

// ── shaders ──────────────────────────────────────────────────────────────
const DOT_VERT = /* glsl */`
uniform sampler2D uLand;
uniform sampler2D uField;
uniform float uScale;
uniform float uWorld;
uniform float uTime;
attribute vec2 aUv;
attribute float aPhase;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float land = step(0.5, textureLod(uLand, aUv, 0.0).r);
  vec4 f = textureLod(uField, aUv, 0.0);
  float g = f.r * land;
  float d = f.g * land;
  vec3 base = vec3(0.22, 0.52, 0.62);
  vec3 c = mix(base, vec3(1.0, 0.62, 0.18), smoothstep(0.0, 0.35, g));
  c = mix(c, vec3(1.0, 0.16, 0.10), smoothstep(0.35, 0.8, g));
  c = mix(c, vec3(1.0, 0.85, 0.75), smoothstep(0.9, 1.0, g) * 0.5);
  c = mix(c, vec3(0.30, 0.27, 0.32), d * 0.6);
  float pulse = 1.0 + 0.25 * g * sin(uTime * 2.4 + aPhase);
  vec3 ocean = vec3(0.10, 0.20, 0.30);
  vColor = mix(ocean, c * (0.75 + 0.6 * g) * pulse, land);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec3 toCam = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
  float facing = clamp(dot(n, toCam), 0.0, 1.0);
  vAlpha = mix(0.35, 1.0, land) * smoothstep(0.0, 0.25, facing);
  float k = mix(0.38, 1.0 + 0.7 * g, land) * pulse;
  gl_PointSize = clamp(uWorld * k * uScale / max(1e-3, -mv.z), 1.0, 14.0);
  gl_Position = projectionMatrix * mv;
}`;

const DOT_FRAG = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float a = vAlpha * (1.0 - smoothstep(0.55, 1.0, r2));
  gl_FragColor = vec4(vColor, a);
}`;

const BASE_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BASE_FRAG = /* glsl */`
uniform float uHeat;
varying vec3 vN;
varying vec3 vV;
void main() {
  float fr = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 3.0);
  vec3 rim = mix(vec3(0.10, 0.35, 0.50), vec3(0.55, 0.18, 0.15), uHeat);
  gl_FragColor = vec4(vec3(0.012, 0.02, 0.035) + rim * fr * 0.6, 1.0);
}`;

const ATMOS_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ATMOS_FRAG = /* glsl */`
uniform float uHeat;
varying vec3 vN;
varying vec3 vV;
void main() {
  float c = clamp(-dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float a = pow(c, 6.0) * 0.55;
  vec3 col = mix(vec3(0.20, 0.60, 0.85), vec3(0.95, 0.35, 0.25), uHeat);
  gl_FragColor = vec4(col * a, 1.0);
}`;

// ── the style ────────────────────────────────────────────────────────────
function create(ctx) {
  const { THREE } = ctx;
  const owned = [];
  const own = o => { owned.push(o); return o; };
  let disposed = false;

  const group = new THREE.Group();
  group.name = 'style-dots';
  if (ctx.root) ctx.root.add(group);

  const blank = own(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  blank.needsUpdate = true;
  const field = ctx.field || null;
  const pop = ctx.D && ctx.D.nodes ? ctx.D.nodes.reduce((s, n) => s + n.pop, 0) : 0;

  // base sphere
  const bU = { uHeat: { value: 0 } };
  const base = new THREE.Mesh(
    own(new THREE.SphereGeometry(BASE_R, 96, 48)),
    own(new THREE.ShaderMaterial({ uniforms: bU, vertexShader: BASE_VERT, fragmentShader: BASE_FRAG })),
  );
  base.name = 'dots-base';
  base.renderOrder = 0;
  group.add(base);

  // dots
  const fib = fibSphere(FIB_N, DOT_R);
  const phase = new Float32Array(fib.n);
  for (let i = 0; i < fib.n; i++) phase[i] = (i * 2.399963) % 6.283185;
  const dGeo = own(new THREE.BufferGeometry());
  dGeo.setAttribute('position', new THREE.BufferAttribute(fib.pos, 3));
  dGeo.setAttribute('aUv', new THREE.BufferAttribute(fib.uv, 2));
  dGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const dU = {
    uLand: { value: field && field.landMask ? field.landMask : blank },
    uField: { value: field && field.texture ? field.texture : blank },
    uScale: { value: 500 },
    uWorld: { value: dotSpacing(FIB_N, DOT_R) * DOT_FILL },
    uTime: { value: 0 },
  };
  const dots = new THREE.Points(dGeo, own(new THREE.ShaderMaterial({
    uniforms: dU, vertexShader: DOT_VERT, fragmentShader: DOT_FRAG,
    transparent: true, depthWrite: false,
  })));
  dots.name = 'dots-points';
  dots.frustumCulled = false;
  dots.renderOrder = 1;
  group.add(dots);

  // atmosphere rim
  const aU = { uHeat: { value: 0 } };
  const atmos = new THREE.Mesh(
    own(new THREE.SphereGeometry(ATMOS_R, 64, 32)),
    own(new THREE.ShaderMaterial({
      uniforms: aU, vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })),
  );
  atmos.name = 'dots-atmos';
  atmos.renderOrder = 2;
  group.add(atmos);

  let heat = 0;
  const bufH = () => {
    const r = ctx.renderer;
    if (r && r.domElement && r.domElement.height) return r.domElement.height;
    return 1000;
  };
  return {
    group,
    update(frame) {
      if (disposed || !frame) return;
      dU.uTime.value = frame.t || 0;
      if (field) {
        if (field.texture && dU.uField.value !== field.texture) dU.uField.value = field.texture;
        if (field.landMask && dU.uLand.value !== field.landMask) dU.uLand.value = field.landMask;
      }
      const fov = ctx.camera && ctx.camera.fov ? ctx.camera.fov : 35;
      dU.uScale.value = pointScale(bufH(), fov);
      // world prevalence -> rim heat, eased
      let target = 0;
      const sim = frame.sim;
      if (sim && sim.I && pop > 0) {
        let I = 0;
        for (let i = 0; i < sim.I.length; i++) I += sim.I[i];
        target = Math.min(1, Math.max(0, Math.log10(Math.max(1e-9, I / pop) / 1e-7) / 5));
      }
      const dt = Math.max(0, frame.dt || 0);
      heat += (target - heat) * (1 - Math.exp(-dt / 1.5));
      bU.uHeat.value = heat; aU.uHeat.value = heat;
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

export default { id: 'dots', label: 'Dots', mode: 'globe', create };

// The GLSL sources, for an offline compile check.
export const SHADERS = {
  dots: [DOT_VERT, DOT_FRAG], base: [BASE_VERT, BASE_FRAG], atmos: [ATMOS_VERT, ATMOS_FRAG],
};
