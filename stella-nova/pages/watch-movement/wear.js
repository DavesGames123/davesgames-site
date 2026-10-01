// ============================================================================
//  WATCH MOVEMENT  ·  wear.js — procedural finishes and wear in the shader
// ────────────────────────────────────────────────────────────────────────────
//  applyFinish(material, o) patches a MeshStandardMaterial or
//  MeshPhysicalMaterial so its fragment shader builds, in the object's own
//  millimetres (no UVs needed):
//    o.finish  perlage | geneva | circular | sunray | brushed | leather |
//              weave | none      the watchmaker's decoration of the part
//    o.wear    0..1   fine scratches at two scales
//    o.prints  0..1   fingerprints (oval ridged prints) and soft smudges
//    o.depth   scale of the bump (1 = the default relief)
//  Each pattern gives a height h (mm, for a bump: the normal tilts with its
//  screen-space slope) and a roughness change. Fine detail fades out where
//  it is smaller than a pixel, so it never shimmers. The plane of the
//  pattern follows the part's main axis (the largest normal component).
//
//  GREP MAP
//    const GLSL ................ hashes, noise, the finishes, the wear
//    function applyFinish ...... the material patch
// ============================================================================

const GLSL = /* glsl */`
uniform float uWear, uPrints, uDepth, uSeed;
varying vec3 vFinP;
varying vec3 vFinN;
float fh1(vec2 p) { p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 fh2(vec2 p) { float a = fh1(p); return vec2(a, fh1(p + a + 17.1)); }
float fnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh1(i), fh1(i + vec2(1, 0)), u.x), mix(fh1(i + vec2(0, 1)), fh1(i + vec2(1, 1)), u.x), u.y);
}
float ffbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * fnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
// a groove pattern of period P along x, faded where P is under ~2 pixels
float fgroove(float x, float P) { float w = fwidth(x) / P; return sin(x * 6.2831853 / P) * (1.0 - smoothstep(0.25, 0.6, w)); }

// one random scratch per cell of size s: returns the groove depth (0..1)
float fscratch(vec2 uv, float s, float density, float width) {
  vec2 c = floor(uv / s);
  float best = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = c + vec2(i, j), r = fh2(cc * 1.37 + 3.1);
    if (r.x > density) continue;
    vec2 o = (cc + fh2(cc + 9.7)) * s;
    float a = r.y * 6.2831853, L = s * (0.5 + 1.4 * fh1(cc + 4.2));
    vec2 d = vec2(cos(a), sin(a)), q = uv - o;
    float t = clamp(dot(q, d), -L, L), dist = length(q - d * t);
    float taper = 1.0 - pow(abs(t) / L, 2.0);
    float pw = max(width, fwidth(uv.x) * 0.7);
    best = max(best, taper * (1.0 - smoothstep(0.0, pw, dist)) * (0.35 + 0.65 * fh1(cc + 2.0)) * (width / pw));
  }
  return best;
}
// fingerprints: sparse oval prints with ridges, broken up by noise
float fprint(vec2 uv) {
  float s = 16.0; vec2 c = floor(uv / s);
  float best = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = c + vec2(i, j);
    if (fh1(cc + 11.0) > 0.45) continue;
    vec2 o = (cc + 0.2 + 0.6 * fh2(cc + 5.0)) * s, q = uv - o;
    float a = fh1(cc + 1.3) * 6.2831853, ca = cos(a), sa = sin(a);
    q = vec2(ca * q.x + sa * q.y, -sa * q.x + ca * q.y) / vec2(4.2, 5.6);
    float d = length(q);
    if (d > 1.0) continue;
    float ridge = 0.5 + 0.5 * fgroove(d * 5.0 + 0.25 * fnoise(uv * 1.3), 0.45);      // ridges 0.45 mm apart
    float m = (1.0 - smoothstep(0.55, 1.0, d)) * smoothstep(0.25, 0.75, fnoise(uv * 0.9 + cc));
    best = max(best, m * (0.45 + 0.55 * ridge));
  }
  return best;
}
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
vec2 fwear(vec2 uv) {
  vec2 r = vec2(0.0);
  if (uWear > 0.0) {
    float s1 = fscratch(uv, 2.2, 0.55 * uWear, 0.006), s2 = fscratch(uv * 1.0 + 31.0, 7.5, 0.35 * uWear, 0.012), s3 = fscratch(uv * 1.0 + 77.0, 0.9, 0.5 * uWear, 0.003);
    float s = max(max(s1, s2 * 1.2), s3 * 0.7);
    r.x -= 0.004 * s; r.y += 0.22 * s * uWear;
  }
  if (uPrints > 0.0) {
    float f = fprint(uv), sm = smoothstep(0.55, 0.85, ffbm(uv * 0.08 + 3.0));
    r.y += uPrints * (0.3 * f + 0.1 * sm);
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
  return ffinish(uv, p) + fwear(uv);
}
`;

const FIN = { none: 0, perlage: 1, geneva: 2, circular: 3, sunray: 4, brushed: 5, leather: 6, weave: 7 };

export function applyFinish(m, o = {}) {
  const fin = FIN[o.finish || 'none'] || 0, wear = o.wear || 0, prints = o.prints || 0;
  if (!fin && !wear && !prints) return m;
  const key = `fin${fin}w${wear > 0 ? 1 : 0}p${prints > 0 ? 1 : 0}`;
  m.customProgramCacheKey = () => key;
  m.userData.finishUniforms = { uWear: { value: wear }, uPrints: { value: prints }, uDepth: { value: o.depth ?? 1 }, uSeed: { value: o.seed ?? 0.37 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.finishUniforms);
    sh.vertexShader = 'varying vec3 vFinP;\nvarying vec3 vFinN;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFinP = position;\n  vFinN = normal;');
    sh.fragmentShader = `#define FINISH ${fin}\n` + GLSL + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  vec2 finHR = fAll();\n  roughnessFactor = clamp(roughnessFactor + finHR.y, 0.02, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = fPerturb(-vViewPosition, normal, vec2(dFdx(finHR.x), dFdy(finHR.x)) * 1.0 * uDepth, faceDirection);');
  };
  return m;
}
