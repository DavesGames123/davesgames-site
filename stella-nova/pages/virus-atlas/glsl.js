// ============================================================================
//  VIRUS ATLAS  ·  glsl.js — the shaders of every representation (strings)
// ----------------------------------------------------------------------------
//  No three.js: plain GLSL ES 3.00 strings, so a script can rewrite them
//  for naga. view.js and reps.js build the materials (three.js adds the
//  #version line, the matrices and the position attribute).
//
//  COMMON (every vertex shader)
//    texture reads: uBeads (RGBA32F, x y z + chain code), uAux (RGBA8,
//      trace.js: burial, chain fraction, break count, ribbon), uOps (3
//      texels per copy), uUnits (2 texels per unit), uChainCol (RGBA8)
//    unitMove(k, ch)  the motion of one unit (one chain of one copy):
//      assembly (uAsm, by delay), explode (uExMode: 0 stored 5-fold
//      directions, 1 the nearest axis in uAx, 2 radial), peel (uPeelMode,
//      see peelKey), breathing.
//    peelKey  0 plane (camera side), 1 latitude from the pole, 2 copy
//      order, 3 radius shell (outer first), 4 spiral, 5 random tiles.
//      A unit lifts off when its key passes uPeelD (width uPeelW).
//    schemeColor  colors.js beadColor in GLSL (uColMode = colors.js MODE)
//    lighting  uKey, uKeyCol, uFill, uAmb, uRimK, uSpecK (colors.js LIGHTS)
//
//  REPRESENTATIONS
//    BEAD_VS / BEAD_FS   impostor spheres: beads, space-filling (large
//                        beads, baked burial darkening + crevice shade)
//                        and toon (bands + ink rim) by uRadMul, uAO, uToon
//    GLOW_FS             the same quads as soft additive points (glow)
//    TUBE_VS / TUBE_FS   Catmull-Rom tube through the beads of each run,
//                        flat ribbon on helix and strand (trace.js)
//    BLOB_VS / BLOB_FS   ray-cast ellipsoids on a box (blobs.js)
//    NODE_VS / EDGE_VS / CAGE_FS  the lattice: glowing nodes and lines
//
//  grep -n targets: "const COMMON", "export const BEAD_VS", "export const BEAD_FS",
//    "export const GLOW_FS", "export const TUBE_VS", "export const TUBE_FS",
//    "export const BLOB_VS", "export const BLOB_FS", "export const NODE_VS",
//    "export const EDGE_VS", "export const CAGE_FS", "const LIGHT_FS"
// ============================================================================

const COMMON = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uBeads, uAux, uOps, uUnits, uChainCol;
uniform int uNB, uStride, uNChains, uColMode, uHiK, uNCopies, uNBead, uPeelMode, uExMode, uNAx;
uniform float uRad, uAsm, uSpread, uFly, uJitter, uExplode, uPeelD, uPeelW, uPeelOn, uSpiral,
  uSliceD, uSliceOn, uSlab, uBreath, uTime, uSway, uSwayH, uSwayBase, uDim, uRadialR, uFade, uGather;
uniform vec3 uPeelN, uSliceN, uOffset, uCopy;
uniform vec3 uAx[15];
uniform vec3 uRamp[5];
uniform vec3 uDiv[3];
uniform vec3 uSS[3];
uniform vec3 uCls[8];
const float PI = 3.14159265;
const float HYD[8] = float[8](1.0, 0.32, 0.0, 0.04, 0.6, 0.15, 0.25, 0.5);

vec4 fetchT(sampler2D t, int i) { return texelFetch(t, ivec2(i & 2047, i >> 11), 0); }
float hash(int n) { return fract(sin(float(n % 100003) * 12.9898 + float(n / 100003) * 78.233) * 43758.5453); }
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
vec3 ramp5(float t) { float f = clamp(t, 0.0, 1.0) * 4.0; int i = int(min(floor(f), 3.0)); return mix(uRamp[i], uRamp[i + 1], f - float(i)); }
vec3 ramp3(float t) { float f = clamp(t, 0.0, 1.0) * 2.0; int i = int(min(floor(f), 1.0)); return mix(uDiv[i], uDiv[i + 1], f - float(i)); }

vec3 opApply(int k, vec3 p) {
  vec4 r0 = fetchT(uOps, 3 * k), r1 = fetchT(uOps, 3 * k + 1), r2 = fetchT(uOps, 3 * k + 2);
  return vec3(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
}
vec3 opRot(int k, vec3 v) {
  vec4 r0 = fetchT(uOps, 3 * k), r1 = fetchT(uOps, 3 * k + 1), r2 = fetchT(uOps, 3 * k + 2);
  return vec3(dot(r0.xyz, v), dot(r1.xyz, v), dot(r2.xyz, v));
}
// a spike bends on its stalk: more at the top, phase per copy
vec3 swayP(vec3 p, float ph) {
  if (uSway <= 0.0) return p;
  float h = clamp((p.y - uSwayBase) / uSwayH, 0.0, 1.4);
  vec2 bend = uSway * vec2(sin(uTime * 0.83 + ph), sin(uTime * 0.61 + 1.7 * ph));
  p.xz += bend * h * h * uSwayH;
  return p;
}
float peelKey(vec3 c, int k, int u) {
  if (uPeelMode == 0) return dot(c, uPeelN) / max(uRadialR, 1e-3);
  vec3 ch = c / max(length(c), 1e-4);
  float lat = acos(clamp(dot(ch, uPeelN), -1.0, 1.0)) / PI;
  if (uPeelMode == 1) return 1.0 - lat;
  if (uPeelMode == 2) return 1.0 - (float(k) + 0.5) / float(max(uNCopies, 1));
  if (uPeelMode == 3) return length(c) / max(uRadialR, 1e-3);
  if (uPeelMode == 4) {
    vec3 a = normalize(cross(uPeelN, abs(uPeelN.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(uPeelN, a);
    float az = atan(dot(ch, b), dot(ch, a)) / (2.0 * PI) + 0.5;
    return 1.0 - (lat * uSpiral + az) / (uSpiral + 1.0);
  }
  return hash(u * 7 + 3);
}
struct Move { vec3 c; vec3 off; vec3 dir; float e; float s; float ph; };
Move unitMove(int k, int ch) {
  int u = k * uNChains + ch;
  vec4 U0 = fetchT(uUnits, 2 * u), U1 = fetchT(uUnits, 2 * u + 1);
  Move m;
  m.c = U0.xyz; m.dir = U1.xyz; m.ph = U1.w;
  float a = clamp((uAsm - U0.w * uSpread) / (1.0 - uSpread), 0.0, 1.0);
  m.e = a < 0.5 ? 4.0 * a * a * a : 1.0 - pow(-2.0 * a + 2.0, 3.0) / 2.0;
  vec3 ed = m.dir;
  if (uExMode == 1 && uNAx > 0) {
    vec3 ch3 = m.c / max(length(m.c), 1e-4);
    float best = -2.0; vec3 bd = ed;
    for (int j = 0; j < 15; j++) {
      if (j >= uNAx) break;
      float v = dot(uAx[j], ch3);
      if (abs(v) > best) { best = abs(v); bd = v >= 0.0 ? uAx[j] : -uAx[j]; }
    }
    ed = normalize(bd * 0.85 + ch3 * 0.15);
  } else if (uExMode == 2) ed = m.c / max(length(m.c), 1e-4);
  m.off = m.dir * (1.0 - m.e) * uFly + ed * uExplode;
  m.s = 0.0;
  if (uPeelOn > 0.5) {
    m.s = smoothstep(uPeelD, uPeelD + uPeelW, peelKey(m.c, k, u));
    vec3 fl = m.dir * 0.7;
    if (uPeelMode == 1 || uPeelMode == 4) fl += cross(uPeelN, m.c / max(length(m.c), 1e-4)) * 0.6;
    m.off += fl * m.s * uRadialR;
  }
  m.off += m.c * uBreath;
  return m;
}
vec3 schemeColor(int k, int ch, int ss, int cls, float frac, float bur, float radT) {
  vec4 cc = fetchT(uChainCol, ch);
  vec3 col = cc.rgb;
  if (uColMode == 1) col = hsv(fract(float(k) * 0.618034 + uCopy.x), uCopy.y, uCopy.z);
  else if (uColMode == 2) col = uSS[ss];
  else if (uColMode == 3) col = uCls[cls];
  else if (uColMode == 4) col = ramp5(radT);
  else if (uColMode == 5) col = ramp3(HYD[cls]);
  else if (uColMode == 6) col = hsv(0.7 * (1.0 - clamp(frac, 0.0, 1.0)), 0.62, 0.96);
  else if (uColMode == 7) col = ramp5(1.0 - bur);
  // sugars and nucleotides keep their own colours except in the class scheme
  if (cls == 6 && uColMode != 3) col = uCls[6];
  if (cls == 5 && uColMode != 3) col = uCls[5];
  if (uHiK >= 0 && k != uHiK) col *= uDim;
  else if (uHiK >= 0) col = mix(col, vec3(1.0), 0.18);
  return col;
}
float radialT(vec3 w) { return clamp((length(w) / max(uRadialR, 1e-3) - 0.45) / 0.55, 0.0, 1.0); }
float shellShade(vec3 w) { return mix(0.5, 1.0, smoothstep(0.35, 1.0, length(w) / max(uRadialR, 1e-3))); }
float clipOf(vec3 w) {
  if (uSliceOn < 0.5) return -1.0;
  float d = dot(w, uSliceN) - uSliceD;
  return uSlab > 0.0 ? abs(d) - uSlab : d;
}
`;

const LIGHT_FS = /* glsl */`
uniform vec3 uKey, uKeyCol, uFill; uniform float uAmb, uRimK, uSpecK;
uniform vec3 uBg; uniform vec2 uFog;
vec3 lit(vec3 base, vec3 n, float shade) {
  vec3 L = normalize(uKey), F = normalize(uFill);
  float dif = max(dot(n, L), 0.0), fill = max(dot(n, F), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  float rim = pow(1.0 - max(n.z, 0.0), 2.2);
  return base * (uAmb + 0.68 * dif * uKeyCol + 0.18 * fill) * shade + uKeyCol * spec * uSpecK + base * rim * uRimK;
}
vec3 fogged(vec3 c, float z) { return mix(c, uBg, smoothstep(uFog.x, uFog.y, z) * 0.88); }
`;

// ── beads, space-filling, toon ─────────────────────────────────────────────
export const BEAD_VS = COMMON + /* glsl */`
uniform float uRadMul, uRepScale, uSprite;
out vec2 vUV; out vec3 vCol; out vec3 vVC; out float vR; out float vClip; out float vShade; out float vBur;
void main() {
  int i = gl_InstanceID;
  int k = i / uNB;
  int b = (i - k * uNB) * uStride;
  vec4 bd = fetchT(uBeads, b), ax = fetchT(uAux, b);
  int code = int(bd.w + 0.5);
  int ch = code & 4095, fl = code >> 12, cls = (fl >> 2) & 7, ss = fl & 3;
  Move m = unitMove(k, ch);
  vec3 w = opApply(k, swayP(bd.xyz, m.ph));
  vec3 jv = vec3(hash(b * 3 + k * 7919 + 1), hash(b * 3 + k * 7919 + 2), hash(b * 3 + k * 7919 + 3)) - 0.5;
  w += m.off + jv * uJitter * (1.0 - m.e) * (1.0 - m.e);
  // gather: the beads pull in toward their unit centre (the cage and blob morphs)
  w = mix(w, m.c + m.off, uGather);
  vec4 cc = fetchT(uChainCol, ch);
  float rad = uRad * uRadMul * uRepScale * (cls == 6 ? 0.72 : 1.0) * smoothstep(0.0, 0.2, m.e) * (1.0 - m.s) * uFade;
  if (cc.a < 0.5) rad = 0.0;
  vCol = schemeColor(k, ch, ss, cls, ax.g, ax.r, radialT(w - m.c * uBreath));
  vShade = shellShade(w); vBur = ax.r;
  vec3 world = w + uOffset;
  vClip = clipOf(w);
  vec4 vc = modelViewMatrix * vec4(world, 1.0);
  vVC = vc.xyz; vR = rad;
  float sp = uSprite > 1.01 ? uSprite : 1.08;
  vec3 q = vc.xyz + vec3(position.xy * rad * sp, rad);
  gl_Position = projectionMatrix * vec4(q, 1.0);
  vUV = position.xy * (uSprite > 1.01 ? 1.0 : 1.08);
}`;

export const BEAD_FS = /* glsl */`
precision highp float;
uniform mat4 projectionMatrix;
uniform float uSliceOn, uAO, uToon;
` + LIGHT_FS + /* glsl */`
in vec2 vUV; in vec3 vCol; in vec3 vVC; in float vR; in float vClip; in float vShade; in float vBur;
out vec4 outColor;
void main() {
  if (vClip > 0.0 || vR <= 0.0) discard;
  float r2 = dot(vUV, vUV);
  if (r2 > 1.0) discard;
  float z = sqrt(1.0 - r2);
  vec3 n = vec3(vUV, z);
  vec3 vp = vVC + n * vR;
  vec4 cp = projectionMatrix * vec4(vp, 1.0);
  gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
  // baked burial and a crevice shade near the rim, where spheres meet
  float ao = mix(1.0, (0.32 + 0.68 * pow(1.0 - vBur, 1.4)) * (0.6 + 0.4 * z), uAO);
  vec3 col = lit(vCol, n, vShade * ao);
  if (uToon > 0.0) {
    float d = max(dot(n, normalize(uKey)), 0.0);
    float band = d > 0.6 ? 1.0 : d > 0.22 ? 0.72 : 0.45;
    vec3 tc = vCol * (band * 0.85 + 0.15) * mix(1.0, 0.8, vBur);
    tc = mix(tc, vec3(0.03, 0.03, 0.05), smoothstep(0.74, 0.8, r2));
    col = mix(col, tc, uToon);
  }
  float cut = uSliceOn > 0.5 ? smoothstep(-0.9, 0.0, vClip) * 0.35 : 0.0;
  col += vec3(1.0, 0.85, 0.6) * cut;
  outColor = vec4(fogged(col, -vp.z), 1.0);
}`;

// soft additive points: drawn on the bead quads, depth test on, no write
export const GLOW_FS = /* glsl */`
precision highp float;
uniform float uGlow; uniform vec3 uBg; uniform vec2 uFog;
in vec2 vUV; in vec3 vCol; in vec3 vVC; in float vR; in float vClip; in float vShade; in float vBur;
out vec4 outColor;
void main() {
  if (vClip > 0.0 || vR <= 0.0) discard;
  float r2 = dot(vUV, vUV);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 5.0) - 0.0067;
  float f = 1.0 - smoothstep(uFog.x, uFog.y, -vVC.z) * 0.9;
  vec3 c = (vCol * 0.8 + 0.2) * g * uGlow * f * (0.55 + 0.45 * vShade);
  outColor = vec4(c, 1.0);
}`;

// ── tube ───────────────────────────────────────────────────────────────────
// position.x = t along the segment (0..1), position.y = angle (0..2 pi)
export const TUBE_VS = COMMON + /* glsl */`
uniform int uNSeg, uTS;
uniform float uTubeR, uGrow, uRepScale;
out vec3 vN; out vec3 vCol; out vec3 vVC; out float vClip; out float vShade;
vec4 auxAt(int b) { return fetchT(uAux, b); }
int runOf(vec4 a) { return int(a.b * 255.0 + 0.5); }
void main() {
  int i = gl_InstanceID;
  int k = i / uNSeg;
  int j = i - k * uNSeg;
  int s = uTS, b1 = j * s, b2 = b1 + s;
  vN = vec3(0.0, 0.0, 1.0); vCol = vec3(0.0); vVC = vec3(0.0); vClip = 1.0; vShade = 1.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // off screen when not drawn
  if (b2 >= uNBead) return;
  vec4 B1 = fetchT(uBeads, b1), B2 = fetchT(uBeads, b2), A1 = auxAt(b1), A2 = auxAt(b2);
  int c1 = int(B1.w + 0.5), c2 = int(B2.w + 0.5), ch = c1 & 4095;
  if (ch != (c2 & 4095) || runOf(A1) != runOf(A2)) return;
  Move m = unitMove(k, ch);
  vec3 P1 = swayP(B1.xyz, m.ph), P2 = swayP(B2.xyz, m.ph), P0 = 2.0 * P1 - P2, P3 = 2.0 * P2 - P1;
  int b0 = b1 - s, b3 = b2 + s;
  if (b0 >= 0) { vec4 B0 = fetchT(uBeads, b0); if ((int(B0.w + 0.5) & 4095) == ch && runOf(auxAt(b0)) == runOf(A1)) P0 = swayP(B0.xyz, m.ph); }
  if (b3 < uNBead) { vec4 B3 = fetchT(uBeads, b3); if ((int(B3.w + 0.5) & 4095) == ch && runOf(auxAt(b3)) == runOf(A2)) P3 = swayP(B3.xyz, m.ph); }
  float t = position.x, th = position.y, t2 = t * t, t3 = t2 * t;
  vec3 P = 0.5 * (2.0 * P1 + (-P0 + P2) * t + (2.0 * P0 - 5.0 * P1 + 4.0 * P2 - P3) * t2 + (-P0 + 3.0 * P1 - 3.0 * P2 + P3) * t3);
  vec3 T = 0.5 * ((-P0 + P2) + 2.0 * (2.0 * P0 - 5.0 * P1 + 4.0 * P2 - P3) * t + 3.0 * (-P0 + 3.0 * P1 - 3.0 * P2 + P3) * t2);
  T = normalize(T + 1e-6);
  // the guide at each knot points into the curve (into a helix axis, or
  // out of a sheet); an ellipse is the same under N -> -N, so joins match
  vec3 N1 = P0 + P2 - 2.0 * P1, N2 = P1 + P3 - 2.0 * P2;
  if (dot(N1, N2) < 0.0) N2 = -N2;
  vec3 N = mix(N1, N2, t);
  N -= T * dot(N, T);
  if (dot(N, N) < 1e-8) N = cross(T, abs(T.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
  N = normalize(N);
  vec3 Bn = cross(T, N);
  float rb = mix(A1.a, A2.a, t);
  float wide = uTubeR * mix(1.0, 2.3, rb), thick = uTubeR * mix(1.0, 0.7, rb);
  float frac = mix(A1.g, A2.g, t);
  float G = uGrow * 1.08 - 0.04;
  float keep = 1.0 - smoothstep(G - 0.04, G, frac);
  vec4 cc = fetchT(uChainCol, ch);
  float sc = smoothstep(0.0, 0.2, m.e) * (1.0 - m.s) * uFade * keep * smoothstep(0.0, 0.35, uRepScale);
  if (cc.a < 0.5 || sc <= 0.0) return;
  vec3 ofs = N * cos(th) * thick + Bn * sin(th) * wide;
  vec3 nrm = normalize(N * cos(th) * wide + Bn * sin(th) * thick);
  vec3 w = opApply(k, P + ofs * sc) + m.off;
  int fl1 = c1 >> 12, fl2 = c2 >> 12;
  int fl = t < 0.5 ? fl1 : fl2;
  vCol = schemeColor(k, ch, fl & 3, (fl >> 2) & 7, frac, t < 0.5 ? A1.r : A2.r, radialT(w - m.c * uBreath));
  vShade = shellShade(w);
  vClip = clipOf(w);
  vec4 vc = modelViewMatrix * vec4(w + uOffset, 1.0);
  vVC = vc.xyz;
  vN = normalize(mat3(modelViewMatrix) * opRot(k, nrm));
  gl_Position = projectionMatrix * vc;
}`;

export const TUBE_FS = /* glsl */`
precision highp float;
uniform float uSliceOn;
` + LIGHT_FS + /* glsl */`
in vec3 vN; in vec3 vCol; in vec3 vVC; in float vClip; in float vShade;
out vec4 outColor;
void main() {
  if (vClip > 0.0) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 col = lit(vCol, n, vShade);
  outColor = vec4(fogged(col, -vVC.z), 1.0);
}`;

// ── blobs: ellipsoids ray-cast in a box ────────────────────────────────────
export const BLOB_VS = COMMON + /* glsl */`
uniform sampler2D uBlobs;
uniform int uNBl;
uniform float uBlobScale;
flat out vec3 vC; flat out vec3 vA1; flat out vec3 vA2; flat out vec3 vA3; flat out vec3 vCol; flat out float vShade;
out vec3 vVC;
void main() {
  int i = gl_InstanceID;
  int k = i / uNBl;
  int bl = i - k * uNBl;
  vec4 t0 = fetchT(uBlobs, 4 * bl), t1 = fetchT(uBlobs, 4 * bl + 1), t2 = fetchT(uBlobs, 4 * bl + 2), t3 = fetchT(uBlobs, 4 * bl + 3);
  int ch = int(t0.w + 0.5) & 4095;
  Move m = unitMove(k, ch);
  vec4 cc = fetchT(uChainCol, ch);
  float sc = uBlobScale * smoothstep(0.0, 0.2, m.e) * (1.0 - m.s) * uFade;
  vC = vec3(0.0); vA1 = vec3(1.0, 0.0, 0.0); vA2 = vec3(0.0, 1.0, 0.0); vA3 = vec3(0.0, 0.0, 1.0); vCol = vec3(0.0); vShade = 1.0; vVC = vec3(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (cc.a < 0.5 || sc <= 0.001) return;
  vec3 c = opApply(k, swayP(t0.xyz, m.ph)) + m.off;
  if (clipOf(c) > 0.0) return;
  vec3 a1 = opRot(k, t1.xyz) * sc, a2 = opRot(k, t2.xyz) * sc, a3 = opRot(k, t3.xyz) * sc;
  vec3 w = c + position.x * a1 + position.y * a2 + position.z * a3;
  mat3 R = mat3(modelViewMatrix);
  vC = (modelViewMatrix * vec4(c + uOffset, 1.0)).xyz;
  vA1 = R * a1; vA2 = R * a2; vA3 = R * a3;
  // a blob takes the colour of its middle: frac 0.5, burial 0.5
  vCol = schemeColor(k, ch, 0, 0, 0.5, 0.5, radialT(c - m.c * uBreath));
  vShade = shellShade(c);
  vec4 vc = modelViewMatrix * vec4(w + uOffset, 1.0);
  vVC = vc.xyz;
  gl_Position = projectionMatrix * vc;
}`;

export const BLOB_FS = /* glsl */`
precision highp float;
uniform mat4 projectionMatrix;
` + LIGHT_FS + /* glsl */`
flat in vec3 vC; flat in vec3 vA1; flat in vec3 vA2; flat in vec3 vA3; flat in vec3 vCol; flat in float vShade;
in vec3 vVC;
out vec4 outColor;
void main() {
  vec3 d = normalize(vVC);
  vec3 o = -vC;
  vec3 s = vec3(dot(vA1, vA1), dot(vA2, vA2), dot(vA3, vA3));
  vec3 lo = vec3(dot(o, vA1), dot(o, vA2), dot(o, vA3)) / s;
  vec3 ld = vec3(dot(d, vA1), dot(d, vA2), dot(d, vA3)) / s;
  float a = dot(ld, ld), b = dot(lo, ld), c = dot(lo, lo) - 1.0;
  float disc = b * b - a * c;
  if (disc < 0.0) discard;
  float t = (-b - sqrt(disc)) / a;
  if (t < 0.0) discard;
  vec3 P = d * t, q = lo + ld * t;
  vec3 n = normalize(q.x * vA1 / s.x + q.y * vA2 / s.y + q.z * vA3 / s.z);
  vec4 cp = projectionMatrix * vec4(P, 1.0);
  gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
  // soft, flat-ish shading with a dark contour, like a drawn tile
  vec3 col = lit(vCol, n, mix(0.85, 1.0, vShade));
  float edge = smoothstep(0.32, 0.12, max(dot(n, -d), 0.0));
  col = mix(col, col * 0.35, edge);
  outColor = vec4(fogged(col, -P.z), 1.0);
}`;

// ── cage: nodes and edges (additive glow) ─────────────────────────────────
// aP: x y z + unit (-1: a fixed point); aK: size (nm), kind (0 unit, 5 3 2 axis)
export const NODE_VS = COMMON + /* glsl */`
in vec4 aP; in vec2 aK;
uniform float uCage;
out vec2 vUV; out vec3 vCol; out float vZ; out float vA;
vec3 axisCol(float kind) { return kind > 4.5 ? vec3(1.0, 0.42, 0.42) : kind > 2.5 ? vec3(1.0, 0.82, 0.4) : vec3(0.36, 0.78, 1.0); }
void main() {
  vec3 w = aP.xyz * (1.0 + uBreath);
  vec3 col = axisCol(aK.y);
  float sc = uCage * uFade;
  if (aP.w >= 0.0) {
    int u = int(aP.w + 0.5), k = u / uNChains, ch = u - k * uNChains;
    Move m = unitMove(k, ch);
    w = aP.xyz + m.off;
    col = schemeColor(k, ch, 0, 0, 0.5, 0.5, radialT(w));
    sc *= smoothstep(0.0, 0.2, m.e) * (1.0 - m.s);
  }
  if (clipOf(w) > 0.0) sc = 0.0;
  vec4 vc = modelViewMatrix * vec4(w + uOffset, 1.0);
  vec3 q = vc.xyz + vec3(position.xy * aK.x * sc * 2.2, 0.0);
  vUV = position.xy; vCol = col; vZ = -vc.z; vA = sc > 0.0 ? 1.0 : 0.0;
  gl_Position = projectionMatrix * vec4(q, 1.0);
}`;

// aA, aB: the two ends (x y z + unit); aK: width (nm), kind
export const EDGE_VS = COMMON + /* glsl */`
in vec4 aA; in vec4 aB; in vec2 aK;
uniform float uCage;
out vec2 vUV; out vec3 vCol; out float vZ; out float vA;
vec3 endAt(vec4 e, out vec3 col, out float vis) {
  col = vec3(0.75, 0.86, 1.0); vis = 1.0;
  if (e.w < 0.0) return e.xyz * (1.0 + uBreath);
  int u = int(e.w + 0.5), k = u / uNChains, ch = u - k * uNChains;
  Move m = unitMove(k, ch);
  vec3 w = e.xyz + m.off;
  col = schemeColor(k, ch, 0, 0, 0.5, 0.5, radialT(w));
  vis = smoothstep(0.0, 0.2, m.e) * (1.0 - m.s);
  return w;
}
void main() {
  vec3 ca, cb; float va, vb;
  vec3 a = endAt(aA, ca, va), b = endAt(aB, cb, vb);
  // an edge grows out from its middle as the cage comes in
  vec3 mid = 0.5 * (a + b);
  a = mix(mid, a, uCage); b = mix(mid, b, uCage);
  vec4 A = modelViewMatrix * vec4(a + uOffset, 1.0), B = modelViewMatrix * vec4(b + uOffset, 1.0);
  vec4 P = mix(A, B, position.x);
  vec3 along = B.xyz - A.xyz;
  vec3 side = normalize(cross(along, P.xyz) + 1e-6);
  float wv = aK.x * min(va, vb) * uFade * (clipOf(mix(a, b, position.x)) > 0.0 ? 0.0 : 1.0);
  P.xyz += side * position.y * wv;
  vUV = vec2(position.x, position.y); vCol = mix(ca, cb, position.x) * (aK.y > 0.5 ? 0.0 : 1.0) + (aK.y > 0.5 ? vec3(0.85, 0.92, 1.0) : vec3(0.0));
  vZ = -P.z; vA = wv > 0.0 ? 1.0 : 0.0;
  gl_Position = projectionMatrix * P;
}`;

export const CAGE_FS = /* glsl */`
precision highp float;
uniform vec3 uBg; uniform vec2 uFog; uniform float uCageGlow, uIsEdge;
in vec2 vUV; in vec3 vCol; in float vZ; in float vA;
out vec4 outColor;
void main() {
  if (vA <= 0.0) discard;
  float r = uIsEdge > 0.5 ? abs(vUV.y) : length(vUV);
  if (r > 1.0) discard;
  float core = smoothstep(0.42, 0.18, r), halo = exp(-r * r * 3.5);
  float f = 1.0 - smoothstep(uFog.x, uFog.y, vZ) * 0.85;
  vec3 c = (vCol * halo * 0.75 + vec3(1.0) * core * 0.55 * (uIsEdge > 0.5 ? 0.6 : 1.0)) * uCageGlow * f;
  outColor = vec4(c, 1.0);
}`;
