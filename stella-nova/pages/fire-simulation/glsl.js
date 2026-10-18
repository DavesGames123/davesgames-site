// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/glsl.js — WebGL2 fallback passes
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). GLSL ES 3.00 copies of the WGSL passes in
//  wgsl.js: each "compute" pass is a full-target triangle, and
//  gl_FragCoord gives the texel (i, j). Same rules, same order. The step
//  uniform is uP[5] (STEP_FIELDS order, 4 per vec4) and uSw[32] swirls; a
//  multigrid level is uL[2] (w, h, color, omega | gc, cw, ch, cgc).
//
//  GLSL.<pass> for pass in: curl force div smooth restrict prolong project
//  advect mac resample emit render, and GLSL.vs (the shared vertex shader)
//  grep -n targets: "const HEAD", "force:", "mac:", "render:"
// ============================================================================

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;
const STEP = `
uniform vec4 uP[5];
uniform vec4 uSw[32];
#define P_dt uP[0].x
#define P_h uP[0].y
#define P_nx uP[0].z
#define P_ny uP[0].w
#define P_lift uP[1].x
#define P_accel uP[1].y
#define P_gravity uP[1].z
#define P_eps uP[1].w
#define P_visc uP[2].x
#define P_drag uP[2].y
#define P_wind uP[2].z
#define P_floorH uP[2].w
#define P_pertX uP[3].x
#define P_pertY uP[3].y
#define P_kappa uP[3].z
#define P_fireCool uP[3].w
#define P_smokeCool uP[4].x
#define P_nSwirl uP[4].y
#define P_spin uP[4].z
#define P_flameT uP[4].w
`;
const LEVEL = `
uniform vec4 uL[2];
#define L_w uL[0].x
#define L_h uL[0].y
#define L_color uL[0].z
#define L_omega uL[0].w
#define L_gc uL[1].x
#define L_cw uL[1].y
#define L_ch uL[1].z
`;
const COMMON = `
out vec4 o;
float sstep(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec4 ld(sampler2D t, int i, int j) { return texelFetch(t, ivec2(i, j), 0); }
`;
const IJ = `  int i = int(gl_FragCoord.x); int j = int(gl_FragCoord.y);\n`;
const BORDER = `
float borderU(int i, int j) {
  int ny = int(P_ny);
  if (j == 0) return 0.0;
  if (j == ny - 1) return ld(A, i, ny - 2).x;
  return ld(A, 1, j).x;
}
float borderV(int i, int j) {
  int nx = int(P_nx);
  if (j <= 1) return 0.0;
  return ld(A, i == 0 ? 1 : nx - 2, j).y;
}
float sampleA(int c, float x, float y, float ox, float oy) {
  float gx = clamp(x / P_h - ox, 0.0, P_nx - 1.001);
  float gy = clamp(y / P_h - oy, 0.0, P_ny - 1.001);
  int i0 = int(floor(gx)); int j0 = int(floor(gy));
  float tx = gx - float(i0); float ty = gy - float(j0);
  float a = ld(A, i0, j0)[c]; float b = ld(A, i0 + 1, j0)[c];
  float d = ld(A, i0, j0 + 1)[c]; float e = ld(A, i0 + 1, j0 + 1)[c];
  return (1.0 - tx) * (1.0 - ty) * a + tx * (1.0 - ty) * b + (1.0 - tx) * ty * d + tx * ty * e;
}
`;

export const GLSL = {
  vs: `#version 300 es
void main() {
  float x = float((gl_VertexID << 1) & 2); float y = float(gl_VertexID & 2);
  gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}`,

  curl: HEAD + STEP + `uniform sampler2D A;\n` + COMMON + `
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny);
  float w = 0.0;
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    float vr = ld(A, i + 1, j).y + ld(A, i + 1, j + 1).y;
    float vl = ld(A, i - 1, j).y + ld(A, i - 1, j + 1).y;
    float ut = ld(A, i, j + 1).x + ld(A, i + 1, j + 1).x;
    float ub = ld(A, i, j - 1).x + ld(A, i + 1, j - 1).x;
    w = ((vr - vl) - (ut - ub)) * (0.25 / P_h);
  }
  o = vec4(w, 0.0, 0.0, 0.0);
}`,

  force: HEAD + STEP + `uniform sampler2D A;\nuniform sampler2D W;\nuniform sampler2D SRC;\n` + COMMON + BORDER + `
float lw(int i, int j) { return ld(W, i, j).x; }
float confW(float t) { return sstep(0.02, 0.1, t) * (1.0 - sstep(0.5, 0.85, t)); }
float viscW(float t) { return sstep(0.35, 0.9, t); }
vec2 conf(int ci, int cj) {
  int nx = int(P_nx); int ny = int(P_ny);
  if (ci < 1 || cj < 1 || ci > nx - 2 || cj > ny - 2) return vec2(0.0);
  float wc = lw(ci, cj); float wt = confW(ld(A, ci, cj).z);
  if (!(wt > 0.0) || wc == 0.0) return vec2(0.0);
  float gx = (abs(lw(ci + 1, cj)) - abs(lw(ci - 1, cj))) * (0.5 / P_h);
  float gy = (abs(lw(ci, cj + 1)) - abs(lw(ci, cj - 1))) * (0.5 / P_h);
  float len = sqrt(gx * gx + gy * gy) + 1e-5;
  float s = P_eps * P_h * wt * wc;
  return vec2(s * gy / len, -(s * gx) / len);
}
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny);
  vec4 a = ld(A, i, j);
  o = vec4(0.0, 0.0, a.z, 0.0);
  vec2 cc = conf(i, j);
  int ns = int(P_nSwirl);
  if (i >= 1 && j >= 1 && j <= ny - 2) {
    float u = a.x;
    vec4 al = ld(A, i - 1, j);
    float tu = 0.5 * (al.z + a.z);
    float av = P_visc * viscW(tu);
    if (av > 0.0) {
      float ur = ld(A, min(i + 1, nx - 1), j).x;
      u += av * (0.25 * (al.x + ur + ld(A, i, j - 1).x + ld(A, i, j + 1).x) - u);
    }
    u += P_dt * 0.5 * (conf(i - 1, j).x + cc.x);
    vec4 s0 = ld(SRC, i - 1, j); vec4 s1 = ld(SRC, i, j);
    float sr = 0.5 * (s0.x + s1.x);
    u += 0.5 * (s0.z + s1.z) + P_pertX * sr;
    float x = float(i) * P_h; float yc = (float(j) + 0.5) * P_h;
    for (int q = 0; q < 32; q++) {
      if (q >= ns) break;
      vec4 s = uSw[q]; float rx = x - s.x; float ry = yc - s.y;
      float r2 = rx * rx + ry * ry; float R2 = s.w * s.w;
      if (r2 < R2) { float m = 1.0 - r2 / R2; u += P_dt * P_spin * m * m * ry * s.z; }
    }
    u -= u * P_drag * (1.0 - sstep(0.0, 0.1, tu));
    if (yc < P_floorH) u = 0.0;
    if ((i == 1 && P_wind > 0.0) || (i == nx - 1 && P_wind < 0.0)) u += (P_wind - u) * 0.2;
    o.x = u;
  } else o.x = borderU(i, j);
  if (i >= 1 && i <= nx - 2 && j >= 2) {
    float v = a.y;
    vec4 ab = ld(A, i, j - 1);
    float tv = 0.5 * (ab.z + a.z);
    float av = P_visc * viscW(tv);
    if (av > 0.0) {
      float vt = ld(A, i, min(j + 1, ny - 1)).y;
      v += av * (0.25 * (ld(A, i - 1, j).y + ld(A, i + 1, j).y + ab.y + vt) - v);
    }
    v += (P_lift * tv - v) * P_accel + P_gravity * P_dt;
    v += P_dt * 0.5 * (conf(i, j - 1).y + cc.y);
    vec4 s0 = ld(SRC, i, j - 1); vec4 s1 = ld(SRC, i, j);
    float sr = 0.5 * (s0.x + s1.x);
    v += 0.5 * (s0.w + s1.w) + P_pertY * sr;
    float jet = max(s0.y, s1.y);
    if (jet > 0.0) v = max(v, jet);
    float xc = (float(i) + 0.5) * P_h; float y = float(j) * P_h;
    for (int q = 0; q < 32; q++) {
      if (q >= ns) break;
      vec4 s = uSw[q]; float rx = xc - s.x; float ry = y - s.y;
      float r2 = rx * rx + ry * ry; float R2 = s.w * s.w;
      if (r2 < R2) { float m = 1.0 - r2 / R2; v -= P_dt * P_spin * m * m * rx * s.z; }
    }
    if (y < P_floorH) v = 0.0;
    o.y = v;
  } else o.y = borderV(i, j);
}`,

  div: HEAD + STEP + `uniform sampler2D B;\nuniform sampler2D Q;\n` + COMMON + `
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny);
  o = vec4(0.0);
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    vec4 b = ld(B, i, j);
    o = vec4(ld(Q, i, j).x, (ld(B, i + 1, j).x - b.x) + (ld(B, i, j + 1).y - b.y), 0.0, 0.0);
  }
}`,

  smooth: HEAD + LEVEL + `uniform sampler2D X;\n` + COMMON + `
void main() {
` + IJ + `  int W = int(L_w); int H = int(L_h);
  vec4 c = ld(X, i, j);
  float p = c.x;
  if (i >= 1 && j >= 1 && i <= W - 2 && j <= H - 2 && ((i + j) & 1) == int(L_color)) {
    float m = float((i == 1 ? 1 : 0) + (i == W - 2 ? 1 : 0) + (j == H - 2 ? 1 : 0));
    float n = (j == 1 ? 3.0 : 4.0) - L_gc * m;
    float sum = ld(X, i - 1, j).x + ld(X, i + 1, j).x + ld(X, i, j + 1).x;
    if (j > 1) sum += ld(X, i, j - 1).x;
    p = (1.0 - L_omega) * p + L_omega * (sum - c.y) / n;
  }
  o = vec4(p, c.y, 0.0, 0.0);
}`,

  restrict: HEAD + LEVEL + `uniform sampler2D X;\n` + COMMON + `
float res(int x, int y) {
  int W = int(L_w); int H = int(L_h);
  vec4 c = ld(X, x, y);
  float m = float((x == 1 ? 1 : 0) + (x == W - 2 ? 1 : 0) + (y == H - 2 ? 1 : 0));
  float n = (y == 1 ? 3.0 : 4.0) - L_gc * m;
  float sum = ld(X, x - 1, y).x + ld(X, x + 1, y).x + ld(X, x, y + 1).x;
  if (y > 1) sum += ld(X, x, y - 1).x;
  return c.y - (sum - n * c.x);
}
void main() {
  int I = int(gl_FragCoord.x); int J = int(gl_FragCoord.y);
  int CW = int(L_cw); int CH = int(L_ch);
  float f = 0.0;
  if (I >= 1 && J >= 1 && I <= CW - 2 && J <= CH - 2) {
    float s = 0.0; float c = 0.0;
    for (int y = 2 * J - 1; y <= 2 * J; y++) for (int x = 2 * I - 1; x <= 2 * I; x++) {
      if (x <= int(L_w) - 2 && y <= int(L_h) - 2) { s += res(x, y); c += 1.0; }
    }
    if (c > 0.0) f = s * 4.0 / c;
  }
  o = vec4(0.0, f, 0.0, 0.0);
}`,

  prolong: HEAD + LEVEL + `uniform sampler2D X;\nuniform sampler2D C;\n` + COMMON + `
void main() {
  int x = int(gl_FragCoord.x); int y = int(gl_FragCoord.y);
  int W = int(L_w); int H = int(L_h);
  vec4 c = ld(X, x, y);
  if (x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2) {
    int I = (x + 1) >> 1; int J = (y + 1) >> 1;
    int I2 = (x & 1) == 1 ? I - 1 : I + 1;
    int J2 = (y & 1) == 1 ? J - 1 : J + 1;
    if (J2 == 0) J2 = 1;
    c.x += 0.5625 * ld(C, I, J).x + 0.1875 * (ld(C, I2, J).x + ld(C, I, J2).x) + 0.0625 * ld(C, I2, J2).x;
  }
  o = vec4(c.x, c.y, 0.0, 0.0);
}`,

  project: HEAD + STEP + `uniform sampler2D B;\nuniform sampler2D Q;\n` + COMMON + `
float lp(int i, int j) { return ld(Q, i, j).x; }
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny);
  o = ld(B, i, j);
  if (i >= 1 && j >= 1 && j <= ny - 2) o.x -= (i <= nx - 2 ? lp(i, j) : 0.0) - (i >= 2 ? lp(i - 1, j) : 0.0);
  if (i >= 1 && i <= nx - 2 && j >= 2) o.y -= (j <= ny - 2 ? lp(i, j) : 0.0) - lp(i, j - 1);
}`,

  advect: HEAD + STEP + `uniform sampler2D A;\n` + COMMON + BORDER + `
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny);
  vec4 a = ld(A, i, j);
  o = vec4(0.0);
  float h = P_h; float dt = P_dt;
  if (i >= 1 && j >= 1 && j <= ny - 2) {
    float vb = 0.25 * (ld(A, i - 1, j).y + a.y + ld(A, i - 1, j + 1).y + ld(A, i, j + 1).y);
    o.x = sampleA(0, float(i) * h - dt * a.x, (float(j) + 0.5) * h - dt * vb, 0.0, 0.5);
  } else o.x = borderU(i, j);
  if (i >= 1 && i <= nx - 2 && j >= 2) {
    float ub = 0.25 * (ld(A, i, j - 1).x + a.x + ld(A, i + 1, j - 1).x + ld(A, i + 1, j).x);
    o.y = sampleA(1, (float(i) + 0.5) * h - dt * ub, float(j) * h - dt * a.y, 0.5, 0.0);
  } else o.y = borderV(i, j);
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    float uc = 0.5 * (a.x + ld(A, i + 1, j).x); float vc = 0.5 * (a.y + ld(A, i, j + 1).y);
    o.z = sampleA(2, (float(i) + 0.5) * h - dt * uc, (float(j) + 0.5) * h - dt * vc, 0.5, 0.5);
  }
}`,

  mac: HEAD + STEP + `uniform sampler2D A;\nuniform sampler2D B;\nuniform sampler2D SRC;\n` + COMMON + `
float sampleZ(sampler2D T, int c, float x, float y) {
  float gx = clamp(x / P_h - 0.5, 0.0, P_nx - 1.001);
  float gy = clamp(y / P_h - 0.5, 0.0, P_ny - 1.001);
  int i0 = int(floor(gx)); int j0 = int(floor(gy));
  float tx = gx - float(i0); float ty = gy - float(j0);
  return (1.0 - tx) * (1.0 - ty) * ld(T, i0, j0)[c] + tx * (1.0 - ty) * ld(T, i0 + 1, j0)[c] + (1.0 - tx) * ty * ld(T, i0, j0 + 1)[c] + tx * ty * ld(T, i0 + 1, j0 + 1)[c];
}
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny);
  vec4 b = ld(B, i, j);
  float t = 0.0;
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) {
    vec4 a = ld(A, i, j); float h = P_h; float dt = P_dt;
    float uc = 0.5 * (a.x + ld(A, i + 1, j).x); float vc = 0.5 * (a.y + ld(A, i, j + 1).y);
    float xc = (float(i) + 0.5) * h; float yc = (float(j) + 0.5) * h;
    float back = sampleZ(B, 2, xc + dt * uc, yc + dt * vc);
    float tn = b.z + 0.5 * (a.z - back);
    float gx = clamp((xc - dt * uc) / h - 0.5, 0.0, P_nx - 1.001);
    float gy = clamp((yc - dt * vc) / h - 0.5, 0.0, P_ny - 1.001);
    int qi = int(floor(gx)); int qj = int(floor(gy));
    float t00 = ld(A, qi, qj).z; float t10 = ld(A, qi + 1, qj).z; float t01 = ld(A, qi, qj + 1).z; float t11 = ld(A, qi + 1, qj + 1).z;
    tn = clamp(tn, min(min(t00, t10), min(t01, t11)), max(max(t00, t10), max(t01, t11)));
    if (P_kappa > 0.0) tn += P_kappa * (0.25 * (ld(A, i - 1, j).z + ld(A, i + 1, j).z + ld(A, i, j - 1).z + ld(A, i, j + 1).z) - a.z);
    tn = max(0.0, tn - (tn < P_flameT ? P_smokeCool : P_fireCool));
    float sp = ld(SRC, i, j).x;
    for (int k = 1; k <= 4; k++) { float s = float(k) * 0.25; sp = max(sp, sampleZ(SRC, 0, xc - s * dt * uc, yc - s * dt * vc)); }
    t = max(tn, sp);
  }
  o = vec4(b.x, b.y, t, 0.0);
}`,

  resample: HEAD + STEP + `uniform sampler2D A;\nuniform vec4 uR;\n` + COMMON + `
float sampleOld(int c, float x, float y, float ox, float oy) {
  float gx = clamp(x / uR.z - ox, 0.0, uR.x - 1.001);
  float gy = clamp(y / uR.z - oy, 0.0, uR.y - 1.001);
  int i0 = int(floor(gx)); int j0 = int(floor(gy));
  float tx = gx - float(i0); float ty = gy - float(j0);
  return (1.0 - tx) * (1.0 - ty) * ld(A, i0, j0)[c] + tx * (1.0 - ty) * ld(A, i0 + 1, j0)[c] + (1.0 - tx) * ty * ld(A, i0, j0 + 1)[c] + tx * ty * ld(A, i0 + 1, j0 + 1)[c];
}
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny); float h = P_h;
  o = vec4(0.0);
  o.x = sampleOld(0, float(i) * h, (float(j) + 0.5) * h, 0.0, 0.5);
  o.y = sampleOld(1, (float(i) + 0.5) * h, float(j) * h, 0.5, 0.0);
  if (i >= 1 && j >= 1 && i <= nx - 2 && j <= ny - 2) o.z = sampleOld(2, (float(i) + 0.5) * h, (float(j) + 0.5) * h, 0.5, 0.5);
}`,

  emit: HEAD + STEP + `uniform sampler2D A;\nuniform sampler2D LUT;\nuniform vec4 uE;\n` + COMMON + `
void main() {
` + IJ + `  int nx = int(P_nx); int ny = int(P_ny);
  vec3 acc = vec3(0.0);
  if (uE.x < 1.5) {
    int n = int(uE.y);
    for (int b = -2; b <= 2; b++) for (int a = -2; a <= 2; a++) {
      float t = clamp(ld(A, clamp(i + 2 * a, 0, nx - 1), clamp(j + 2 * b, 0, ny - 1)).z, 0.0, 1.0);
      int q = int(t * float(n - 1) + 0.5);
      if (uE.x < 0.5) { vec4 gl = texelFetch(LUT, ivec2(q, 1), 0); acc += gl.rgb * gl.a; }
      else { vec4 c = texelFetch(LUT, ivec2(q, 0), 0); acc += c.rgb * min(1.0, 3.5 * t); }
    }
  }
  o = vec4(acc / 25.0, 0.0);
}`,

  render: HEAD + `
uniform vec4 uV[6];
uniform sampler2D A;
uniform sampler2D EM;
uniform sampler2D LUT;
out vec4 o;
vec4 bicubic(vec2 uv) {
  vec2 size = uV[1].zw;
  vec2 tc = uv * size - 0.5;
  vec2 ic = floor(tc); vec2 f = tc - ic;
  vec2 f2 = f * f; vec2 f3 = f2 * f;
  vec2 w0 = (1.0 / 6.0) * ((1.0 - f) * (1.0 - f) * (1.0 - f));
  vec2 w1 = (1.0 / 6.0) * (3.0 * f3 - 6.0 * f2 + 4.0);
  vec2 w2 = (1.0 / 6.0) * (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0);
  vec2 w3 = (1.0 / 6.0) * f3;
  vec2 g0 = w0 + w1; vec2 g1 = w2 + w3;
  vec2 p0 = (ic - 1.0 + w1 / g0 + 0.5) / size;
  vec2 p1 = (ic + 1.0 + w3 / g1 + 0.5) / size;
  vec4 a = textureLod(A, vec2(p0.x, p0.y), 0.0);
  vec4 b = textureLod(A, vec2(p1.x, p0.y), 0.0);
  vec4 c = textureLod(A, vec2(p0.x, p1.y), 0.0);
  vec4 d = textureLod(A, vec2(p1.x, p1.y), 0.0);
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}
void main() {
  float px = gl_FragCoord.x; float py = uV[0].w - gl_FragCoord.y;
  vec3 col = mix(uV[3].rgb, uV[2].rgb, clamp(py / uV[0].w, 0.0, 1.0));
  float x = (px - uV[0].x) / uV[0].z; float y = (uV[0].y - py) / uV[0].z;
  if (x >= 0.0 && y >= 0.0 && x <= uV[1].x && y <= uV[1].y) {
    vec2 uv = vec2(x / uV[1].x, y / uV[1].y);
    vec4 s = bicubic(uv);
    int n = int(uV[5].x);
    float mode = uV[4].y;
    float t = clamp(s.z, 0.0, 1.0);
    if (mode > 1.5) t = clamp(length(s.xy) * uV[4].w, 0.0, 1.0);
    int q = int(t * float(n - 1) + 0.5);
    vec4 lc = texelFetch(LUT, ivec2(q, 0), 0);
    float al = lc.a;
    if (mode > 0.5) al = mode > 1.5 ? 1.0 : min(1.0, 3.5 * t);
    col = mix(col, lc.rgb, al);
    if (mode < 1.5) col += uV[4].x * 0.7 * textureLod(EM, uv, 0.0).rgb;
  }
  col = mix(col, uV[2].rgb, uV[4].z);
  o = vec4(min(col, vec3(1.0)), 1.0);
}`,
};
