// ============================================================================
//  WATCH MOVEMENT  ·  wear.js — finishes in the shader, wear from photos
// ────────────────────────────────────────────────────────────────────────────
//  applyFinish(material, o) patches a MeshStandardMaterial or
//  MeshPhysicalMaterial so its fragment shader builds, in the object's own
//  millimetres (no UVs needed):
//    o.finish  perlage | geneva | circular | sunray | brushed | leather |
//              weave | none      the watchmaker's decoration of the part
//    o.wear    0..1   scratches, from a photographic scratch map at two scales
//    o.prints  0..1   fingerprints and smudges, from photographic maps
//    o.depth   scale of the bump (1 = the default relief)
//  Each pattern gives a height h (mm, for a bump: the normal tilts with its
//  screen-space slope) and a roughness change. Fine detail fades out where
//  it is smaller than a pixel, so it never shimmers. The plane of the
//  pattern follows the part's main axis (the largest normal component).
//
//  WEAR MAPS  (textures/, CC0 photographs from ambientCG, see README.md)
//    wear-prints.jpg, wear-scratches.jpg, wear-smudges.jpg: one grey
//    channel each, black = clean. Every patched material gets the same
//    uniform objects (WEAR_TEX). They hold a 1 x 1 black texture until the
//    photos load, so the first frames draw clean metal, and the marks show
//    in every part at once when the load completes. A part rotates and
//    shifts the maps by its seed, so neighbouring parts do not repeat.
//    The marks also raise the clearcoat roughness, so prints on a
//    lacquered plate sit on the lacquer. The textures live as long as the
//    GL context; lib/gpu-guard.js frees the context on a page swap.
//
//  GREP MAP
//    const GLSL ................ hashes, noise, the finishes, the wear
//    const WEAR_FILES .......... the photo for each wear uniform
//    function loadWearTextures . the one async load
//    function applyFinish ...... the material patch
// ============================================================================

import * as THREE from 'three';

const GLSL = /* glsl */`
uniform float uWear, uPrints, uDepth, uSeed;
uniform sampler2D uPrintTex, uScratchTex, uSmudgeTex;
varying vec3 vFinP;
varying vec3 vFinN;
float fh1(vec2 p) { p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 fh2(vec2 p) { float a = fh1(p); return vec2(a, fh1(p + a + 17.1)); }
float fnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh1(i), fh1(i + vec2(1, 0)), u.x), mix(fh1(i + vec2(0, 1)), fh1(i + vec2(1, 1)), u.x), u.y);
}
// a groove pattern of period P along x, faded where P is under ~2 pixels
float fgroove(float x, float P) { float w = fwidth(x) / P; return sin(x * 6.2831853 / P) * (1.0 - smoothstep(0.25, 0.6, w)); }

// the finishes: x = height (mm), y = roughness change
vec2 ffinish(vec2 uv, vec3 p) {
  vec2 r = vec2(0.0);
#if FINISH == 1
  // perlage: spots on an offset grid, the later spot on top
  float s = 1.05, R = 0.78; vec2 c = floor(uv / s);
  float bo = -1.0, rho = 0.0; vec2 q = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = c + vec2(i, j);
    vec2 o = (cc + vec2(0.5 + 0.5 * mod(cc.y, 2.0), 0.5)) * s + (fh2(cc) - 0.5) * 0.08;
    float d = length(uv - o), ord = cc.y * 4096.0 + cc.x;
    if (d < R && ord > bo) { bo = ord; rho = d; q = uv - o; }
  }
  float ang = atan(q.y, q.x);
  r.x = 0.0012 * fgroove(rho, 0.018) + 0.0009 * fgroove(rho + 0.004 * sin(ang * 3.0), 0.041) - 0.003 * (1.0 - rho * rho / (R * R));
  r.y = 0.05 * (rho / R) - 0.02;
#elif FINISH == 2
  // Geneva stripes: 2.6 mm bands. Each band is a shallow trough, so the
  // light falls across it as a soft bright stripe; within it, the arcs of
  // the turning wheel show as a fine sheen at two scales.
  float W = 2.6, xl = mod(uv.x, W) - W * 0.5, yl = mod(uv.y, 7.0);
  float rho = length(vec2(xl, yl + 9.0));
  r.x = 0.0035 * (xl / W) * (xl / W) * 4.0 + 0.0011 * fgroove(rho, 0.022) + 0.0005 * fgroove(rho, 0.3);
  r.y = 0.05 * (0.5 + 0.5 * fgroove(rho, 0.3)) - 0.02;
#elif FINISH == 3
  // circular graining about the part's own centre
  float rho = length(p.xy);
  r.x = 0.0010 * fgroove(rho + 0.002 * fnoise(p.xy * 3.0), 0.016) + 0.0006 * fgroove(rho, 0.07);
  r.y = 0.03 * fnoise(vec2(rho * 2.0, 0.0)) - 0.015;
#elif FINISH == 4
  // sunray: fine radial brushing about the centre
  float a = atan(p.y, p.x);
  r.x = 0.0009 * fgroove(a, 0.004);              // about 1,570 radial lines
  r.y = 0.02 * fnoise(vec2(a * 40.0, 0.0)) - 0.01;
#elif FINISH == 5
  // linear brushing along x
  float n = fnoise(vec2(uv.y * 90.0, uv.x * 0.6)) + 0.5 * fnoise(vec2(uv.y * 260.0, uv.x * 1.3));
  r.x = 0.0012 * (n - 0.75) * (1.0 - smoothstep(0.3, 0.8, fwidth(uv.y) * 90.0));
  r.y = 0.04 * (n - 0.75);
#elif FINISH == 6
  // leather: a fine pebble of cells and a few creases
  vec2 c = floor(uv / 0.35); float dmin = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 cc = c + vec2(i, j), o = (cc + fh2(cc)) * 0.35; dmin = min(dmin, length(uv - o)); }
  float crease = smoothstep(0.03, 0.0, abs(fnoise(uv * 0.35) - 0.5)) * 0.6;
  r.x = 0.012 * smoothstep(0.0, 0.2, dmin) - 0.01 * crease;
  r.y = 0.08 * smoothstep(0.0, 0.2, dmin) + 0.1 * crease;
#elif FINISH == 7
  // Milanese mesh: interlaced wires
  float a = sin(uv.x * 6.2831853 / 0.7), b = sin((uv.y + 0.175 * step(0.0, a)) * 6.2831853 / 0.35);
  r.x = 0.03 * abs(a) * (0.6 + 0.4 * b);
  r.y = 0.12 * (1.0 - abs(a));
#endif
  return r;
}
// A wear map in the part's plane: tile mm per repeat, turned and shifted
// by the part's seed and a per-map constant k.
vec2 fwuv(vec2 uv, float tile, float k) {
  float a = fract(uSeed * 7.31 + k) * 6.2831853, c = cos(a), s = sin(a);
  return mat2(c, s, -s, c) * uv / tile + vec2(fract(uSeed * 3.7 + k * 1.3), fract(uSeed * 5.1 + k * 2.9));
}
vec2 finW = vec2(0.0);   // the wear part of fAll, for the clearcoat
vec2 fwear(vec2 uv) {
  vec2 r = vec2(0.0);
  if (uWear > 0.0) {
    // one scratch photo at two scales: a 30 mm tile and a finer 11 mm tile
    float s1 = texture2D(uScratchTex, fwuv(uv, 30.0, 0.11)).r;
    float s2 = texture2D(uScratchTex, fwuv(uv, 11.0, 0.53)).r;
    float s = smoothstep(0.04, 0.5, max(s1, 0.7 * s2) * (0.4 + 0.6 * uWear));
    r.x -= 0.004 * s; r.y += 0.32 * s * uWear;
  }
  if (uPrints > 0.0) {
    // fingerprints about 12 mm across (a 110 mm tile), smudges on 70 mm
    float f = texture2D(uPrintTex, fwuv(uv, 110.0, 0.29)).r;
    float sm = texture2D(uSmudgeTex, fwuv(uv, 70.0, 0.71)).r;
    r.y += uPrints * (0.45 * f + 0.15 * sm);
    r.x += uPrints * 0.0006 * f;
  }
  return r;
}
// Mikkelsen's bump, with the screen derivatives left unnormalized so a
// height in mm tilts the normal by its true slope at any zoom
vec3 fPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = dFdx(surf_pos), vSigmaY = dFdy(surf_pos), vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  if (abs(fDet) < 1e-12) return surf_norm;
  return normalize(abs(fDet) * surf_norm - vGrad);
}
vec2 fAll() {
  vec3 n = abs(vFinN), p = vFinP;
  vec2 uv = n.z >= n.x && n.z >= n.y ? p.xy : n.y >= n.x ? p.xz : p.yz;
  finW = fwear(uv);
  return ffinish(uv, p) + finW;
}
`;

// the wear photos, shared by every material (see WEAR MAPS above)
const WEAR_FILES = { uPrintTex: 'wear-prints.jpg', uScratchTex: 'wear-scratches.jpg', uSmudgeTex: 'wear-smudges.jpg' };
const WEAR_TEX = {};
for (const k in WEAR_FILES) {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true;
  WEAR_TEX[k] = { value: t };
}
let wearLoad = null;
function loadWearTextures() {
  if (wearLoad) return wearLoad;
  const L = new THREE.TextureLoader();
  wearLoad = Promise.all(Object.entries(WEAR_FILES).map(([k, f]) => L.loadAsync(new URL('./textures/' + f, import.meta.url).href).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
    WEAR_TEX[k].value = t;
  }))).catch(e => console.warn('wear textures did not load', e));
  return wearLoad;
}
export const wearTexturesReady = () => loadWearTextures();

const FIN = { none: 0, perlage: 1, geneva: 2, circular: 3, sunray: 4, brushed: 5, leather: 6, weave: 7 };

export function applyFinish(m, o = {}) {
  const fin = FIN[o.finish || 'none'] || 0, wear = o.wear || 0, prints = o.prints || 0;
  if (!fin && !wear && !prints) return m;
  const key = `fin${fin}w${wear > 0 ? 1 : 0}p${prints > 0 ? 1 : 0}`;
  m.customProgramCacheKey = () => key;
  if (wear || prints) loadWearTextures();
  m.userData.finishUniforms = { uWear: { value: wear }, uPrints: { value: prints }, uDepth: { value: o.depth ?? 1 }, uSeed: { value: o.seed ?? 0.37 }, ...WEAR_TEX };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.finishUniforms);
    sh.vertexShader = 'varying vec3 vFinP;\nvarying vec3 vFinN;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFinP = position;\n  vFinN = normal;');
    sh.fragmentShader = `#define FINISH ${fin}\n` + GLSL + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  vec2 finHR = fAll();\n  roughnessFactor = clamp(roughnessFactor + finHR.y, 0.02, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = fPerturb(-vViewPosition, normal, vec2(dFdx(finHR.x), dFdy(finHR.x)) * 1.0 * uDepth, faceDirection);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoatRoughness = clamp(material.clearcoatRoughness + finW.y, 0.0525, 1.0);\n#endif');
  };
  return m;
}
