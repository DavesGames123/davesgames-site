// ============================================================================
//  CORAL REEF  ·  GLSL of the scene (DOM-free strings, three.js r160)
// ----------------------------------------------------------------------------
//  three.js ShaderMaterial adds the version line, the precision, the
//  matrices (modelMatrix, viewMatrix, projectionMatrix, cameraPosition)
//  and position / normal / uv. tests.mjs wraps each shader as Vulkan
//  GLSL 450 and checks it with naga (no browser on this machine).
//
//  Float textures are declared highp (particle data) or mediump (the
//  caustic map, values up to 24): the GLSL ES 3.00 default for a
//  sampler2D is lowp, which a phone GPU can honour.
//
//  The water (WATER): fog that takes the red first, the caustic map (a
//  render target from CAUSTIC_VS / CAUSTIC_FS: the mesh-area method of
//  pages/photon-caustics, a grid of sun rays refracted by a tiled sum of
//  waves; the light at a floor point is the ratio of the cell area before
//  and after the refraction), and a sun with a sky and a ground light.
//
//  CORAL_VS / CORAL_FS: the SDF meshes of coral-sdf.js. Per-vertex gid
//  reads two per-particle textures:
//    uPartA (rgba) = natural r g b, colour t
//    uPartB (rgba) = birth s, radius, sway level * 2 + tip, height over base
//  A new particle grows out of the surface (the vertex moves in along the
//  normal while it is young) and glows. The fragment shader adds the
//  species detail: corallite cups (Worley cells) on staghorn and table
//  corals, the brain valleys (the same groove() as coral-sdf.js, so the
//  light and the mesh agree), fine pores on fans, velvet on soft corals.
//  Light: wrap diffuse, a transmission term (light through thin parts),
//  rim light, caustics, fog.
//
//  POLYP_VS / POLYP_FS: instanced polyps (a cup and eight tentacles) that
//  open and close, and sway with the current.
//
//  GROUND_*, ROCK_*, DECOR_*: the real seabed (sand and reef rock by the
//  rock mask), the SDF rocks (triplanar reef-rock texture, turf and
//  coralline algae), the scanned models (Poly Haven, CC0).
//
//  grep -n targets
//    shared water ........... "export const WATER"
//    noise (same as JS) ..... "export const NOISE"
//    caustic map ............ "export const CAUSTIC_VS"
//    coral surface .......... "export const CORAL_VS"
//    polyps ................. "export const POLYP_VS"
//    seabed ................. "export const GROUND_VS"
//    rocks .................. "export const ROCK_FS"
//    models ................. "export const DECOR_FS"
// ============================================================================

export const SURFACE_Y = 120;

// Noise that matches terrain.js noise3 (the same integer hash).
export const NOISE = /* glsl */`
float hashI(ivec3 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + uint(c.z) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}
float noise3(vec3 p) {
  vec3 fl = floor(p); ivec3 i = ivec3(fl); vec3 f = p - fl;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hashI(i), b = hashI(i + ivec3(1, 0, 0)), c = hashI(i + ivec3(0, 1, 0)), d = hashI(i + ivec3(1, 1, 0));
  float e = hashI(i + ivec3(0, 0, 1)), g = hashI(i + ivec3(1, 0, 1)), h = hashI(i + ivec3(0, 1, 1)), k = hashI(i + ivec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
vec3 hash33(vec3 p) {
  uvec3 q = uvec3(ivec3(floor(p))) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return vec3(q) / 4294967295.0;
}
// Worley distances F1, F2 in a unit cell lattice.
vec2 worley(vec3 p) {
  vec3 i = floor(p), f = p - i;
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + hash33(i + o) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
// Brain coral valleys: 0 on a ridge, 1 in a valley (coral-sdf.js groove).
float groove(vec3 p) {
  float f = noise3(vec3(p.x * 0.16 + 3.1, p.y * 0.16, p.z * 0.16)) * 3.4 + noise3(vec3(p.x * 0.55, p.y * 0.55 + 5.0, p.z * 0.55)) * 0.35;
  float s = abs(sin(f * 6.2831853));
  float t = min(1.0, s / 0.42);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}
// Bump mapping from screen derivatives of a height h (Mikkelsen 2010).
vec3 bumpN(vec3 N, vec3 P, float h, float k) {
  vec3 dx = dFdx(P), dy = dFdy(P);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dy, N), r2 = cross(N, dx);
  float det = dot(dx, r1);
  vec3 g = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * N - g * k);
}`;

export const WATER = /* glsl */`
uniform float uTime, uCaust, uFogDen, uCaustTile, uCaustScale;
uniform vec3 uFogDeep, uFogShallow, uSun;
uniform vec2 uCur;
uniform mediump sampler2D uCaustTex;
// The caustic map: light ratio E (mean about 1) at a floor point. A
// little chromatic spread (the map is sampled three times).
vec3 causticAt(vec3 w, vec3 n) {
  if (uCaust < 0.5) return vec3(1.0);
  vec2 q = (w.xz - uSun.xz / max(0.2, -uSun.y) * (${SURFACE_Y.toFixed(1)} - w.y) * 0.04) / uCaustTile;
  vec2 dq = vec2(0.0035, 0.0021);
  vec3 e = vec3(texture(uCaustTex, q - dq).r, texture(uCaustTex, q).r, texture(uCaustTex, q + dq).r) * uCaustScale;
  e = min(log2(1.0 + e), vec3(3.2));       // E = 1 stays 1; a fold (E up to 24) is a bright line, not a white blot
  float up = clamp(n.y * 0.7 + 0.3, 0.0, 1.0);
  float depth = clamp(1.0 - (${SURFACE_Y.toFixed(1)} - w.y) / 300.0, 0.3, 1.0);
  return mix(vec3(1.0), e, up * depth);
}
vec3 fogCol(float y) { return mix(uFogDeep, uFogShallow, clamp((y + 20.0) / 170.0, 0.0, 1.0)); }
vec3 underwater(vec3 col, vec3 w) {
  float d = length(w - cameraPosition);
  col *= exp(-d * uFogDen * vec3(0.55, 0.2, 0.12));
  float f = exp(-d * uFogDen);
  return mix(fogCol(mix(w.y, cameraPosition.y, 0.5)), col, f);
}
vec3 skyLight(vec3 n) { return mix(vec3(0.035, 0.07, 0.10), vec3(0.26, 0.42, 0.52), n.y * 0.5 + 0.5); }`;

// ── caustic map ─────────────────────────────────────────────────────────────
// A grid over one tile, drawn 9 times (offsets -1..1 tiles), so light that
// leaves the tile comes back in from the next one. Waves are periodic in
// the tile: integer wave numbers times 2 pi / L.
export const CAUSTIC_VS = /* glsl */`
precision highp float;
in vec2 aUv;
in vec2 aOff;
uniform vec4 uWave[6];
uniform float uL, uD, uT;
uniform vec3 uSunDir;
out vec2 vOld, vNew;
vec3 hg(vec2 p) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec4 w = uWave[i];
    vec2 k = w.xy * 6.2831853 / uL;
    float om = sqrt(9.81 * length(k) * 6.0);
    float a = dot(k, p) - om * uT + w.w;
    r.x += w.z * sin(a); r.yz += w.z * cos(a) * k;
  }
  return r;
}
void main() {
  vec2 p = (aUv + aOff) * uL;
  vec3 s = hg(p);
  vec3 N = normalize(vec3(-s.y, 1.0, -s.z));
  vec3 T = refract(uSunDir, N, 1.0 / 1.333), T0 = refract(uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  vec2 Q = p + T.xz * ((uD + s.x) / -T.y);
  vOld = p + T0.xz * (uD / -T0.y); vNew = Q;
  gl_Position = vec4(Q / uL * 2.0 - 1.0, 0.0, 1.0);
}`;
export const CAUSTIC_FS = /* glsl */`
precision highp float;
in vec2 vOld, vNew;
uniform float uGain;
out vec4 oCol;
float area(vec2 a, vec2 b) { return abs(a.x * b.y - a.y * b.x); }
void main() {
  float a0 = area(dFdx(vOld), dFdy(vOld)), a1 = area(dFdx(vNew), dFdy(vNew));
  float E = min(24.0, a0 / max(a1, 1e-9));
  oCol = vec4(vec3(E * uGain), 1.0);
}`;

// ── coral ───────────────────────────────────────────────────────────────────
export const PART = /* glsl */`
uniform float uTime;
uniform vec2 uCur;
uniform highp sampler2D uPartA, uPartB;
ivec2 partCoord(float g) { float gg = max(g, 0.0); return ivec2(int(mod(gg, 128.0)), int(floor(gg / 128.0))); }`;

export const CORAL_VS = /* glsl */`
${PART}
in float aGid;
uniform float uSwayK, uCount, uMode;
out vec3 vN, vW, vL, vNat;
out float vT, vGlow, vTip;
void main() {
  ivec2 tc = partCoord(aGid);
  vec4 A = texelFetch(uPartA, tc, 0), B = texelFetch(uPartB, tc, 0);
  float age = uTime - B.x;
  float g = clamp(age / 1.4, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g);
  vec3 p = position - normal * B.y * (1.0 - g) * 0.85;
  vec4 w = modelMatrix * vec4(p, 1.0);
  float lvl = floor(B.z * 0.5), tip = B.z - lvl * 2.0;
  float amp = lvl / 4.0, h = B.w;
  float ph = aGid * 0.0137;
  float wave = sin(uTime * 1.05 + ph - h * 0.07) + 0.35 * sin(uTime * 2.3 + ph * 1.7 - h * 0.11);
  vec2 dir = normalize(uCur + vec2(0.0001)) * 0.8 + vec2(cos(ph * 6.0), sin(ph * 6.0)) * 0.3;
  w.xz += dir * wave * amp * uSwayK * pow(max(h, 0.0) * 0.045, 1.5);
  vW = w.xyz; vL = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vNat = pow(A.rgb, vec3(2.2));        // the natural colours are sRGB-like values: to linear
  vT = (uMode > 0.5 && uMode < 1.5) ? max(aGid, 0.0) / max(1.0, uCount - 1.0) : A.a;
  vGlow = exp(-max(age, 0.0) / 1.6);
  vTip = tip;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const CORAL_FS = /* glsl */`
${WATER}
${NOISE}
uniform sampler2D uLut;
uniform float uMode, uBleach, uSpecies, uDetail;
in vec3 vN, vW, vL, vNat;
in float vT, vGlow, vTip;
out vec4 oCol;
// species: 0 staghorn, 1 fan, 2 table, 3 boulder (brain), 4 finger
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  vec3 lutC = texture(uLut, vec2(clamp(vT, 0.0, 1.0) * 0.992 + 0.004, 0.5)).rgb;
  vec3 base = uMode < 0.5 ? vNat : lutC;
  float bl = uMode < 0.5 ? uBleach : uBleach * 0.35;
  base = mix(base, vec3(0.88, 0.88, 0.84), bl * 0.88);
  float h = 0.0, ao = 1.0, thin = 0.35, sheen = 0.0;
  float sp = uSpecies;
  if (uDetail > 0.5) {
    if (sp < 0.5 || (sp > 1.5 && sp < 2.5)) {
      // corallites: raised cups with a dark pit (Acropora)
      float f = sp < 0.5 ? 4.2 : 5.0;
      vec2 c = worley(vL * f);
      float rim = smoothstep(0.12, 0.26, c.x) * (1.0 - smoothstep(0.30, 0.46, c.x));
      float pit = 1.0 - smoothstep(0.06, 0.2, c.x);
      h = rim * 0.6 - pit * 0.9 + (c.y - c.x) * 0.15;
      ao = 1.0 - pit * 0.55;
      base *= 0.86 + 0.28 * rim;
      thin = sp < 0.5 ? 0.25 + 0.6 * vTip : 0.3;
    } else if (sp < 1.5) {
      // sea fan: fine pores, light through the web
      vec2 c = worley(vL * 9.0);
      float pore = 1.0 - smoothstep(0.08, 0.22, c.x);
      h = -pore * 0.5; ao = 1.0 - pore * 0.35; thin = 1.0;
    } else if (sp < 3.5) {
      // brain coral: valleys and fine septa across them
      float gv = groove(vL);
      float sep = 0.5 + 0.5 * sin(dot(vL, vec3(7.1, 5.3, 6.7)) + noise3(vL * 0.9) * 6.0);
      h = -gv * 1.2 + (1.0 - gv) * sep * 0.15;
      ao = 1.0 - gv * 0.5;
      base = mix(base, base * vec3(0.72, 0.82, 0.62), gv * 0.6);
      thin = 0.2;
    } else {
      // soft coral: velvet of polyps, a sheen
      float v = noise3(vL * 7.0) * 0.6 + noise3(vL * 15.0) * 0.4;
      h = v * 0.5; ao = 0.85 + 0.15 * v; thin = 0.55; sheen = 0.6;
    }
    n = bumpN(n, vW, h, sp > 2.5 && sp < 3.5 ? 0.9 : 0.55);
  }
  vec3 L = normalize(-uSun);
  float ndl = dot(n, L);
  float wrap = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  vec3 cau = causticAt(vW, n);
  vec3 sss = base * base * 1.6;                                  // subsurface: deeper, richer colour
  float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * thin + thin * 0.25 * clamp(-ndl, 0.0, 1.0);
  vec3 col = base * skyLight(n) * ao * 1.4;
  col += base * wrap * vec3(0.95, 1.0, 1.0) * 0.95 * cau;
  col += sss * trans * vec3(0.9, 1.0, 0.95) * 0.9;
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += rim * (0.10 + sheen * 0.2) * mix(vec3(0.45, 0.75, 0.85), base, 0.5);
  vec3 hot = uMode < 0.5 ? mix(vNat, vec3(1.0, 0.92, 0.78), 0.6) : texture(uLut, vec2(0.995, 0.5)).rgb;
  col += hot * vGlow * 1.2 * (1.0 - uBleach);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

// ── polyps ──────────────────────────────────────────────────────────────────
// Template attribute aT: x angle of the tentacle (or of the cup vertex),
// y s along the tentacle (0..1), z side (-1, 1: the ribbon edge; the cup
// uses it for the ring radius), w kind (0 cup wall, 1 cup top, 2 tentacle).
export const POLYP_VS = /* glsl */`
${PART}
in vec4 aT;
in vec3 iPos, iNrm;
in vec2 iData;
uniform float uSize, uKeep, uSwayK, uCount, uMode, uExtend;
out vec3 vW, vN, vNat;
out float vS, vT, vKind, vGlow;
void main() {
  vKind = aT.w; vS = aT.y;
  if (iData.y > uKeep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  ivec2 tc = partCoord(iData.x);
  vec4 A = texelFetch(uPartA, tc, 0), B = texelFetch(uPartB, tc, 0);
  float age = uTime - B.x;
  float grow = clamp((age - 0.6) / 1.5, 0.0, 1.0);
  vec3 nn = normalize(iNrm);
  vec3 t = normalize(cross(nn, abs(nn.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(nn, t);
  float ph = iData.y * 71.0;
  float open = 0.5 + 0.5 * sin(uTime * 0.42 + ph) * 0.7 + 0.5 * sin(uTime * 0.17 + ph * 1.9) * 0.3;
  float e = uExtend * (0.18 + 0.82 * smoothstep(0.2, 0.8, open)) * grow;
  vec3 lp;
  float a = aT.x;
  vec2 d = vec2(cos(a), sin(a));
  if (aT.w < 0.5) {
    lp = vec3(d.x * aT.z, aT.y * 0.5, d.y * aT.z);          // cup wall: radius aT.z, height s * 0.5
  } else if (aT.w < 1.5) {
    lp = vec3(d.x * aT.z, 0.5 - (1.0 - aT.z) * 0.15, d.y * aT.z);
  } else {
    float s = aT.y, len = 2.2 * e;
    float rad = 0.62 + s * len * 0.85, up = 0.5 + s * len * 0.8 - s * s * len * 0.35;
    vec2 pd = vec2(-d.y, d.x);
    float wdt = 0.13 * (1.0 - 0.8 * s) * (0.5 + 0.5 * e);
    lp = vec3(d.x * rad + pd.x * aT.z * wdt, up, d.y * rad + pd.y * aT.z * wdt);
  }
  float size = uSize * (0.75 + 0.5 * fract(ph)) * (0.25 + 0.75 * grow);
  vec3 off = (t * lp.x + nn * lp.y + b * lp.z) * size;
  vec4 w = modelMatrix * vec4(iPos + off, 1.0);
  // the current bends the tentacles
  float sw = aT.w > 1.5 ? aT.y * aT.y * e : 0.0;
  w.xz += (normalize(uCur + vec2(0.0001)) * (0.6 + 0.4 * sin(uTime * 1.3 + ph))) * sw * size * 0.9 * uSwayK;
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * (aT.w > 1.5 ? normalize(t * d.x + b * d.y + nn * 0.6) : (aT.w > 0.5 ? nn : t * d.x + b * d.y)));
  vNat = pow(A.rgb, vec3(2.2));        // the natural colours are sRGB-like values: to linear
  vT = (uMode > 0.5 && uMode < 1.5) ? iData.x / max(1.0, uCount - 1.0) : A.a;
  vGlow = exp(-max(age, 0.0) / 2.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const POLYP_FS = /* glsl */`
${WATER}
uniform sampler2D uLut;
uniform float uMode, uBleach, uFluor;
uniform vec3 uTint;
in vec3 vW, vN, vNat;
in float vS, vT, vKind, vGlow;
out vec4 oCol;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 lutC = texture(uLut, vec2(clamp(vT, 0.0, 1.0) * 0.992 + 0.004, 0.5)).rgb;
  vec3 base = uMode < 0.5 ? mix(vNat, uTint, 0.45) : lutC;
  base = mix(base, vec3(0.9), uBleach * 0.85);
  if (vKind > 1.5) base = mix(base, vec3(1.0, 0.98, 0.92), vS * 0.55);   // light tentacle tips
  if (vKind > 0.5 && vKind < 1.5) base *= 0.55;                          // the mouth disc
  vec3 L = normalize(-uSun), V = normalize(cameraPosition - vW);
  float wrap = clamp((dot(n, L) + 0.6) / 1.6, 0.0, 1.0);
  vec3 col = base * (skyLight(n) * 1.3 + wrap * causticAt(vW, n) * 0.9);
  col += base * pow(clamp(dot(V, -L), 0.0, 1.0), 2.0) * 0.6;           // light through the tentacles
  col += vec3(0.25, 1.0, 0.55) * uFluor * vS * 0.22 * (1.0 - uBleach);  // green fluorescence at the tips
  col += base * vGlow * 0.8;
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

// ── ground ──────────────────────────────────────────────────────────────────
export const GROUND_VS = /* glsl */`
in float aMask;
out vec3 vW, vN;
out float vMask;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vMask = aMask;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Triplanar sample helpers, shared by the ground, the rocks and the models.
const TRI = /* glsl */`
vec3 triTex(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture(t, p.zy * s).rgb * w.x + texture(t, p.xz * s).rgb * w.y + texture(t, p.xy * s).rgb * w.z;
}
// a tangent-space normal map, triplanar (whiteout blend)
vec3 triNrm(sampler2D t, vec3 p, vec3 n, float s, float k) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  vec3 tx = texture(t, p.zy * s).xyz * 2.0 - 1.0, ty = texture(t, p.xz * s).xyz * 2.0 - 1.0, tz = texture(t, p.xy * s).xyz * 2.0 - 1.0;
  tx.xy *= k; ty.xy *= k; tz.xy *= k;
  vec3 nx = vec3(0.0, tx.y, tx.x) * sign(n.x), ny = vec3(ty.x, 0.0, ty.y) * sign(n.y), nz = vec3(tz.x, tz.y, 0.0) * sign(n.z);
  return normalize(n + nx * w.x + ny * w.y + nz * w.z);
}`;

export const GROUND_FS = /* glsl */`
${WATER}
${NOISE}
${TRI}
uniform sampler2D uSand, uSandN, uRock, uRockN, uGravel, uGravelN;
uniform float uTex;
in vec3 vW, vN;
in float vMask;
out vec4 oCol;
void main() {
  vec3 n = normalize(vN);
  float nz = noise3(vec3(vW.x * 0.08, 0.3, vW.z * 0.08));
  float m = clamp(vMask + (nz - 0.5) * 0.5, 0.0, 1.0);
  float gr = smoothstep(0.1, 0.45, m) * (1.0 - smoothstep(0.55, 0.85, m));   // gravel around the knolls
  vec3 cs = vec3(0.80, 0.75, 0.62), cr = vec3(0.50, 0.46, 0.38), cg = vec3(0.70, 0.62, 0.52);
  vec3 ns = n, nr = n, ng = n;
  if (uTex > 0.5) {
    cs = texture(uSand, vW.xz * 0.06).rgb * 1.1;
    ns = triNrm(uSandN, vW, n, 0.06, 0.9);
    cr = triTex(uRock, vW, n, 0.05);
    nr = triNrm(uRockN, vW, n, 0.05, 1.0);
    cg = texture(uGravel, vW.xz * 0.09).rgb;
    ng = triNrm(uGravelN, vW, n, 0.09, 1.0);
  }
  vec3 base = mix(cs, cr, smoothstep(0.45, 0.8, m));
  base = mix(base, cg, gr * 0.8);
  vec3 nn = normalize(mix(mix(ns, nr, smoothstep(0.45, 0.8, m)), ng, gr * 0.8));
  // turf algae and a little coralline pink on the knolls
  float alg = smoothstep(0.55, 0.9, nn.y) * smoothstep(0.5, 0.9, m) * noise3(vW * 0.2);
  base = mix(base, vec3(0.30, 0.36, 0.18), alg * 0.55);
  base = mix(base, vec3(0.70, 0.42, 0.50), smoothstep(0.62, 0.8, noise3(vW * 0.33 + 4.0)) * m * 0.5);
  vec3 L = normalize(-uSun);
  float dif = clamp(dot(nn, L), 0.0, 1.0);
  vec3 col = base * (skyLight(nn) * 0.9 + dif * vec3(0.66, 0.74, 0.76) * causticAt(vW, nn) * 1.15);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

export const ROCK_VS = /* glsl */`
out vec3 vW, vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const ROCK_FS = /* glsl */`
${WATER}
${NOISE}
${TRI}
uniform sampler2D uRock, uRockN;
uniform float uTex;
in vec3 vW, vN;
out vec4 oCol;
void main() {
  vec3 n = normalize(vN);
  vec3 base = vec3(0.5, 0.46, 0.38);
  if (uTex > 0.5) { base = triTex(uRock, vW, n, 0.11) * 1.05; n = triNrm(uRockN, vW, n, 0.11, 1.2); }
  float sp = noise3(vW * 0.35);
  base = mix(base, vec3(0.26, 0.33, 0.17), smoothstep(0.5, 0.9, n.y) * smoothstep(0.35, 0.7, sp) * 0.7);   // turf algae on top
  base = mix(base, vec3(0.78, 0.44, 0.54), smoothstep(0.66, 0.8, noise3(vW * 0.6 + 9.0)) * 0.55);          // coralline algae
  float cav = smoothstep(-0.2, 0.6, n.y) * 0.4 + 0.6;
  vec3 L = normalize(-uSun);
  float dif = clamp(dot(n, L), 0.0, 1.0);
  vec3 col = base * (skyLight(n) * cav + dif * vec3(0.66, 0.74, 0.76) * causticAt(vW, n) * 1.15);
  col += pow(1.0 - max(dot(n, normalize(cameraPosition - vW)), 0.0), 4.0) * 0.05 * vec3(0.4, 0.7, 0.8);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;

export const DECOR_VS = /* glsl */`
out vec3 vW, vN;
out vec2 vUv;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const DECOR_FS = /* glsl */`
${WATER}
${NOISE}
${TRI}
uniform sampler2D uMap, uRock, uRockN;
uniform float uHasMap, uTex;
in vec3 vW, vN;
in vec2 vUv;
out vec4 oCol;
void main() {
  vec3 n = normalize(vN);
  vec3 base;
  if (uHasMap > 0.5) base = texture(uMap, vUv).rgb;
  else {
    base = uTex > 0.5 ? triTex(uRock, vW, n, 0.3) * 0.95 : vec3(0.5, 0.47, 0.4);
    if (uTex > 0.5) n = triNrm(uRockN, vW, n, 0.3, 1.0);
    base = mix(base, vec3(0.28, 0.34, 0.18), smoothstep(0.6, 0.95, n.y) * noise3(vW * 0.7) * 0.8);
  }
  vec3 L = normalize(-uSun);
  float dif = clamp(dot(n, L), 0.0, 1.0);
  vec3 col = base * (skyLight(n) + dif * vec3(0.66, 0.74, 0.76) * causticAt(vW, n) * 1.1);
  oCol = linearToOutputTexel(vec4(underwater(col, vW), 1.0));
}`;
