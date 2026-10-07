// ============================================================================
//  THIN-FILM CLOTH  ·  fabric.js — the cloth and soap-bubble shaders
// ----------------------------------------------------------------------------
//  Two three.js ShaderMaterials, written for this page:
//
//  clothMaterial(probe, lut)
//    The film: thickness d over the cloth = d0 (1 + dv pour(uv)) / a^s
//      pour   a domain-warped value noise in -1..1 (the uneven coat)
//      a      the area ratio from the solver (stretch thins the film)
//      s      0 or 1 (the "stretch thins the film" switch)
//    Specular: the film table (film.js buildLUT) at (d, cos theta) is the
//    Fresnel term. It scales two light paths:
//      probe  the studio probe along a reflection vector bent for the
//             anisotropy, at a blur level from the roughness
//      key    an analytic key light with anisotropic GGX (Burley's D,
//             height-correlated Smith visibility), the brushed streak
//    Diffuse: the substrate tint (a dye under silk and rubber, zero for a
//    metal) times what the film lets through, 1 - mean(F).
//    Print: an ink layer in uv space, matte, over the film on the front.
//    Overlay: the "film thickness" teaching view: a ramp from 0 to dMax
//    with a contour every 100 nm.
//
//  bubbleMaterial(probe, lut, side)
//    A soap film on a wobbling sphere. Thickness: drainage (thick at the
//    base, thin at the top) plus swirls that move with time; the top can
//    thin to a black film. Output is premultiplied: colour = F * probe,
//    alpha = mean(F), so the light it does not reflect passes through.
//
//  GREP MAP
//    grep -n 'const COMMON'          probe sampling, film lookup, noise
//    grep -n 'export function clothMaterial'
//    grep -n 'export function bubbleMaterial'
//    grep -n 'export function lutTexture'
//    grep -n 'filmThickness'         the thickness field in GLSL
// ============================================================================
import * as THREE from 'three';

// LUT (film.js layout: RGBA float rows of cos theta) to a half float texture.
export function lutTexture(L) {
  const h = new Uint16Array(L.data.length);
  for (let i = 0; i < h.length; i++) h[i] = THREE.DataUtils.toHalfFloat(L.data[i]);
  const t = new THREE.DataTexture(h, L.nd, L.nc, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.LinearSRGBColorSpace; t.generateMipmaps = false; t.needsUpdate = true;
  t.userData = { nd: L.nd, nc: L.nc, dMax: L.dMax };
  return t;
}

const COMMON = /* glsl */`
uniform sampler2D uProbe;
uniform vec3 uProbeInfo;     // width, height of one level, level count
uniform sampler2D uLut;
uniform vec3 uLutInfo;       // nd, nc, dMax
const float PI = 3.14159265;

vec3 probeLevel(vec2 uv, float level) {
  float h = uProbeInfo.y, n = uProbeInfo.z;
  float v = clamp(uv.y, 0.5 / h, 1.0 - 0.5 / h);
  return texture(uProbe, vec2(uv.x, (v + level) / n)).rgb;
}
vec3 envAt(vec3 d, float lod) {
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
  float l = clamp(lod, 0.0, uProbeInfo.z - 1.0), l0 = floor(l);
  return mix(probeLevel(uv, l0), probeLevel(uv, min(l0 + 1.0, uProbeInfo.z - 1.0)), l - l0);
}
vec3 filmF(float d, float c) {
  vec2 uv = vec2(clamp(d / uLutInfo.z, 0.0, 1.0) * (uLutInfo.x - 1.0) + 0.5, clamp(c, 0.0, 1.0) * (uLutInfo.y - 1.0) + 0.5);
  return texture(uLut, uv / uLutInfo.xy).rgb;
}
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// domain-warped value noise, about -1..1
float pour(vec2 p) {
  vec2 q = vec2(vnoise(p * 1.3 + 1.7), vnoise(p * 1.3 + vec2(8.3, 2.9)));
  p += 1.6 * q;
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 0.37; a *= 0.5; }
  return s / 0.9375 * 2.0 - 1.0;
}
vec3 ramp(float x) {           // the thickness overlay: ink, teal, sand, white
  x = clamp(x, 0.0, 1.0);
  vec3 a = vec3(0.06, 0.05, 0.16), b = vec3(0.05, 0.42, 0.48), c = vec3(0.86, 0.74, 0.42), e = vec3(0.98, 0.97, 0.93);
  return x < 0.4 ? mix(a, b, x / 0.4) : x < 0.75 ? mix(b, c, (x - 0.4) / 0.35) : mix(c, e, (x - 0.75) / 0.25);
}
`;

const CLOTH_VERT = /* glsl */`
attribute vec3 aTan;
attribute float aRatio;
varying vec3 vW; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vRatio;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vT = normalize(mat3(modelMatrix) * aTan);
  vUv = uv; vRatio = aRatio;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CLOTH_FRAG = /* glsl */`
${COMMON}
uniform float uD0, uDv, uStrain, uTime, uOverlay, uPrintOn;
uniform vec2 uRough;
uniform vec3 uTint, uKeyDir, uKeyCol;
uniform sampler2D uPrint;
uniform vec4 uPrintRect;
varying vec3 vW; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vRatio;

float filmThickness() {
  float d = uD0 * (1.0 + uDv * pour(vUv * 3.2 + vec2(0.0, uTime * 0.004)));
  return d / pow(max(vRatio, 0.05), uStrain);
}

void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(cameraPosition - vW);
  vec3 T = normalize(vT - N * dot(vT, N)), B = cross(N, T);
  float nv = max(dot(N, V), 1e-3);
  float d = filmThickness();

  if (uOverlay > 0.5) {
    float lines = smoothstep(0.035, 0.0, abs(fract(d / 100.0) - 0.5) - 0.465);
    float lit = 0.45 + 0.55 * max(dot(N, uKeyDir), 0.0);
    gl_FragColor = vec4(ramp(d / uLutInfo.z) * lit * (1.0 - 0.6 * lines), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }

  // ink: matte, printed on the front face only
  float ink = 0.0; vec3 inkCol = vec3(0.0);
  if (uPrintOn > 0.5 && gl_FrontFacing) {
    vec2 p = (vUv - uPrintRect.xy) / uPrintRect.zw + 0.5;
    if (all(greaterThanEqual(p, vec2(0.0))) && all(lessThanEqual(p, vec2(1.0)))) { vec4 s = texture(uPrint, p); ink = s.a; inkCol = s.rgb; }
  }

  float ax = max(uRough.x, 0.02), ay = max(uRough.y, 0.02);
  float aniso = (ay - ax) / (ay + ax);
  vec3 adir = aniso >= 0.0 ? T : B;
  vec3 aT = cross(adir, V), aN = cross(aT, adir);
  vec3 bentN = normalize(mix(N, aN, abs(aniso) * clamp(4.0 * sqrt(ax * ay), 0.0, 1.0)));
  vec3 R = reflect(-V, bentN);
  float lod = sqrt(sqrt(ax * ay)) * (uProbeInfo.z - 1.0) * 1.15;

  vec3 F = filmF(d, nv);
  vec3 spec = F * envAt(R, lod);

  vec3 L = normalize(uKeyDir), H = normalize(L + V);
  float nl = max(dot(N, L), 0.0);
  if (nl > 0.0) {
    float th = dot(T, H) / ax, bh = dot(B, H) / ay, nh = dot(N, H);
    float k = th * th + bh * bh + nh * nh;
    float D = 1.0 / (PI * ax * ay * k * k);
    float lv = nl * length(vec3(ax * dot(T, V), ay * dot(B, V), nv));
    float ll = nv * length(vec3(ax * dot(T, L), ay * dot(B, L), nl));
    float Vis = 0.5 / max(lv + ll, 1e-4);
    spec += filmF(d, max(dot(V, H), 0.0)) * D * Vis * nl * uKeyCol;
  }
  float through = 1.0 - dot(F, vec3(0.3333));
  vec3 irr = envAt(N, uProbeInfo.z - 1.0) + uKeyCol * nl / PI;
  vec3 col = spec + uTint * through * irr;
  // ink sits on top: a dielectric varnish (4% specular) over the ink colour
  col = mix(col, inkCol * irr + 0.04 * envAt(R, uProbeInfo.z * 0.6), ink);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function clothMaterial(probe, lut) {
  return new THREE.ShaderMaterial({
    name: 'thin-film cloth',
    vertexShader: CLOTH_VERT, fragmentShader: CLOTH_FRAG, side: THREE.DoubleSide,
    uniforms: {
      uProbe: { value: probe.atlas }, uProbeInfo: { value: new THREE.Vector3(probe.w, probe.h, probe.levels) },
      uLut: { value: lut }, uLutInfo: { value: new THREE.Vector3(lut.userData.nd, lut.userData.nc, lut.userData.dMax) },
      uD0: { value: 400 }, uDv: { value: 0.3 }, uStrain: { value: 1 }, uTime: { value: 0 }, uOverlay: { value: 0 },
      uRough: { value: new THREE.Vector2(0.2, 0.2) }, uTint: { value: new THREE.Color(0, 0, 0) },
      uKeyDir: { value: new THREE.Vector3(0.5, 0.6, 0.5).normalize() }, uKeyCol: { value: new THREE.Color(2.4, 2.1, 1.8) },
      uPrint: { value: null }, uPrintOn: { value: 0 }, uPrintRect: { value: new THREE.Vector4(0.5, 0.5, 0.6, 0.6) },
    },
  });
}

const BUBBLE_VERT = /* glsl */`
uniform float uTime, uPoke;
uniform vec3 uPokeDir;
varying vec3 vW; varying vec3 vN; varying vec3 vO;
void main() {
  vec3 n = normalize(position);
  // low modes of a vibrating drop: l = 2 and l = 3 shapes, plus a dent
  // that rings after a poke
  float w = 0.035 * sin(uTime * 2.1) * (3.0 * n.y * n.y - 1.0)
          + 0.022 * sin(uTime * 3.3 + 1.0) * n.x * n.z * 3.0
          + 0.015 * sin(uTime * 4.7 + 2.0) * n.y * (5.0 * n.x * n.x - 1.0)
          - uPoke * sin(uTime * 9.0) * pow(max(dot(n, uPokeDir), 0.0), 6.0) * 0.12;
  vec3 p = position * (1.0 + w);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz; vN = normalize(mat3(modelMatrix) * n); vO = n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BUBBLE_FRAG = /* glsl */`
${COMMON}
uniform float uTime, uAge, uOverlay;
varying vec3 vW; varying vec3 vN; varying vec3 vO;
void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(cameraPosition - vW);
  float nv = abs(dot(N, V));
  // drainage: the film runs down, thick at the base and thin at the top
  float drop = pow(0.5 * (1.0 - vO.y), 1.3);
  float top = mix(160.0, 12.0, uAge);
  vec2 sw = vec2(atan(vO.z, vO.x) * 1.2 + uTime * 0.05, vO.y * 3.0 - uTime * 0.03);
  float d = mix(top, 1050.0, drop) * (1.0 + 0.32 * pour(sw * 1.7 + 0.2 * vec2(sin(uTime * 0.2), cos(uTime * 0.17))));
  if (uOverlay > 0.5) { gl_FragColor = vec4(ramp(d / uLutInfo.z) * 0.8, 0.8); return; }
  vec3 F = filmF(d, nv);
  vec3 R = reflect(-V, N);
  vec3 col = F * envAt(R, 0.3);
  float a = clamp(dot(F, vec3(0.3333)), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function bubbleMaterial(probe, lut, side) {
  return new THREE.ShaderMaterial({
    name: 'soap film', vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG, side,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uProbe: { value: probe.atlas }, uProbeInfo: { value: new THREE.Vector3(probe.w, probe.h, probe.levels) },
      uLut: { value: lut }, uLutInfo: { value: new THREE.Vector3(lut.userData.nd, lut.userData.nc, lut.userData.dMax) },
      uTime: { value: 0 }, uAge: { value: 0.3 }, uPoke: { value: 0 }, uPokeDir: { value: new THREE.Vector3(0, 0, 1) }, uOverlay: { value: 0 },
    },
  });
}

// The source of the film lookup, for the screensaver plate.
export const FILM_GLSL = COMMON.slice(COMMON.indexOf('vec3 filmF'), COMMON.indexOf('float hash12'));
