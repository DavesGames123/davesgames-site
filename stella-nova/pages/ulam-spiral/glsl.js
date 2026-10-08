// ============================================================================
//  ULAM SPIRAL  ·  glsl.js — the GLSL ES 3.00 sources (WebGL2)
// ----------------------------------------------------------------------------
//  SHAPES is the GPU twin of layouts.js: the same maps, with the same
//  names and a "g" prefix. Integers only where layouts.js uses integers.
//  GLSL ES leaves integer / and % undefined for negative operands, so the
//  code divides and takes remainders of non-negative values only, and
//  uses >> 1 for a floor halving.
//
//  CLASSES is the GPU twin of numtheory.js "classify": the class byte of
//  n per highlight mode, from the prime bitset (usampler2D, odd-only
//  bits, R32UI) and the arithmetic bytes (R8, n < uArithN).
//
//  Programs (render.js builds them):
//    FIELD_FS   one pass per pixel for the lattice shapes: pixel -> cell
//               -> n -> class -> colour. Zoomed out, a box filter over
//               the cells under the pixel (exact up to uBoxMax cells per
//               side, then over the pyramid blocks)
//    PYR_FS     level 0 of the density pyramid: the mean colour of each
//               block of B0 x B0 cells (render.js makes the mip levels)
//    POINT_VS   the point shapes, the 3D shapes and every morph: n from
//               gl_VertexID, position from the shape map, colour from n
//    POINT_FS   dot, glow and square sprites
//    BLUR_FS, COMP_FS   the bloom and the final mix with the background
//    TF_VS      transform feedback of gPos for the self-test
//
//  GREP MAP
//    grep -n 'MODE_'              the class byte per highlight mode
//    grep -n 'ivec2 gSqPos'       square spiral (and every other gXxxPos)
//    grep -n 'vec3 gPos'          n -> world position, any shape
//    grep -n 'int gIdx'           lattice cell -> index k, any shape
//    grep -n 'vec4 shade'         class -> colour and strength
//    grep -n 'FIELD_FS'           the per-pixel lattice pass
//    grep -n 'vec4 boxCells'      the exact box filter over the cells
//    grep -n 'vec4 boxPyr'        the box filter over the pyramid blocks
//    grep -n 'vec4 boxJitter'     the stratified fallback
//    grep -n 'PYR_FS'             the pyramid level-0 pass
// ============================================================================

export const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;
`;

// --- shapes ---------------------------------------------------------------
export const SHAPES_GLSL = `
#define SQ3 0.8660254037844386
#define TAU 6.283185307179586
uniform uint uStart;
uniform int uCw, uRot, uW, uL, uCut;
uniform float uK, uAng, uG;
uniform uvec2 uKFx, uAngFx;   // fract(K) and ang/360 as 64-bit fixed point (hi, lo)

// The high 32 bits of a * b (GLSL ES 3.00 has no umulExtended).
uint gMulHi(uint a, uint b) {
  uint a0 = a & 0xffffu, a1 = a >> 16u, b0 = b & 0xffffu, b1 = b >> 16u;
  uint p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  uint mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  return p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u);
}
// fract(n * f) for f in 64-bit fixed point: exact to 2^-24 at any n.
float gFracMul(uint n, uvec2 f) { uint t = n * f.x + gMulHi(n, f.y); return float(t >> 8u) / 16777216.0; }
// The turns K sqrt(n), mod 1: sqrt(n) = s + (n - s^2) / (sqrt(n) + s).
float gSacksTurn(uint n) {
  float fn = float(n);
  uint s = uint(sqrt(fn));
  for (int i = 0; i < 2; i++) { if (s * s > n) s--; }
  for (int i = 0; i < 2; i++) { if ((s + 1u) * (s + 1u) <= n) s++; }
  float fr = float(n - s * s) / (sqrt(fn) + float(s));
  return fract(gFracMul(s, uKFx) + uK * fr);
}

bool gLattice(int s) { return s <= 14; }
bool gHexKind(int s) { return s >= 12 && s <= 14; }
uint gStartOf(int s) { return (s == 11 || s == 14) ? 0u : uStart; }

ivec2 gOrient(ivec2 p) {
  if (uCw == 1) p.y = -p.y;
  for (int i = 0; i < 3; i++) { if (i >= uRot) break; p = ivec2(-p.y, p.x); }
  return p;
}
ivec2 gUnorient(ivec2 p) {
  for (int i = 0; i < 3; i++) { if (i >= uRot) break; p = ivec2(p.y, -p.x); }
  if (uCw == 1) p.y = -p.y;
  return p;
}
int gIsqrt(int v) {
  int s = int(sqrt(float(v)));
  for (int i = 0; i < 3; i++) { if (s * s > v) s--; }
  for (int i = 0; i < 3; i++) { if ((s + 1) * (s + 1) <= v) s++; }
  return s;
}

// square spiral
int gSqRing(int k) {
  int r = int(ceil((sqrt(float(k) + 1.0) - 1.0) * 0.5));
  for (int i = 0; i < 4; i++) { if ((2 * r + 1) * (2 * r + 1) <= k) r++; }
  for (int i = 0; i < 4; i++) { if (r > 0 && (2 * r - 1) * (2 * r - 1) > k) r--; }
  return r;
}
ivec2 gSqPos(int k) {
  if (k == 0) return ivec2(0);
  int r = gSqRing(k), t = k - (2 * r - 1) * (2 * r - 1), s = 2 * r;
  if (t < s) return ivec2(r, -r + 1 + t);
  if (t < 2 * s) return ivec2(r - 1 - (t - s), r);
  if (t < 3 * s) return ivec2(-r, r - 1 - (t - 2 * s));
  return ivec2(-r + 1 + (t - 3 * s), -r);
}
int gSqIdx(ivec2 p) {
  int r = max(abs(p.x), abs(p.y));
  if (r == 0) return 0;
  int m = (2 * r - 1) * (2 * r - 1);
  if (p.x == r && p.y > -r) return m + p.y + r - 1;
  if (p.y == r) return m + 2 * r + (r - 1 - p.x);
  if (p.x == -r) return m + 4 * r + (r - 1 - p.y);
  return m + 6 * r + (p.x + r - 1);
}
// rectangle with core length uL
int gRectCount(int r) { return r < 0 ? 0 : (uL + 2 * r) * (2 * r + 1); }
ivec2 gRectPos(int k) {
  if (k < uL) return ivec2(k, 0);
  float L = float(uL), B = 2.0 * L + 2.0;
  int r = max(1, int(floor((-B + sqrt(max(0.0, B * B - 16.0 * (L - float(k))))) / 8.0)));
  for (int i = 0; i < 4; i++) { if (gRectCount(r) <= k) r++; }
  for (int i = 0; i < 4; i++) { if (r > 1 && gRectCount(r - 1) > k) r--; }
  int t = k - gRectCount(r - 1), xr = uL - 1 + r, side = 2 * r, top = uL + 2 * r - 1;
  if (t < side) return ivec2(xr, -r + 1 + t);
  if (t < side + top) return ivec2(xr - 1 - (t - side), r);
  if (t < 2 * side + top) return ivec2(-r, r - 1 - (t - side - top));
  return ivec2(-r + 1 + (t - 2 * side - top), -r);
}
int gRectIdx(ivec2 p) {
  if (p.y == 0 && p.x >= 0 && p.x < uL) return p.x;
  int r = max(abs(p.y), p.x < 0 ? -p.x : p.x - (uL - 1));
  if (r <= 0) return -1;
  int m = gRectCount(r - 1), xr = uL - 1 + r, side = 2 * r, top = uL + 2 * r - 1;
  if (p.x == xr && p.y > -r) return m + p.y + r - 1;
  if (p.y == r) return m + side + (xr - 1 - p.x);
  if (p.x == -r) return m + side + top + (r - 1 - p.y);
  return m + 2 * side + top + (p.x + r - 1);
}
// diamond
ivec2 gDiaPos(int k) {
  if (k == 0) return ivec2(0);
  int r = max(1, int(floor((1.0 + sqrt(max(0.0, 2.0 * float(k) - 1.0))) * 0.5)));
  for (int i = 0; i < 4; i++) { if (1 + 2 * r * (r + 1) <= k) r++; }
  for (int i = 0; i < 4; i++) { if (r > 1 && 1 + 2 * (r - 1) * r > k) r--; }
  int t = k - (1 + 2 * r * (r - 1)), i = t / r, j = t - i * r;
  if (i == 0) return ivec2(r - j, j);
  if (i == 1) return ivec2(-j, r - j);
  if (i == 2) return ivec2(-r + j, -j);
  return ivec2(j, -r + j);
}
int gDiaIdx(ivec2 p) {
  int r = abs(p.x) + abs(p.y);
  if (r == 0) return 0;
  int m = 1 + 2 * r * (r - 1);
  if (p.x > 0 && p.y >= 0) return m + p.y;
  if (p.x <= 0 && p.y > 0) return m + r - p.x;
  if (p.x < 0 && p.y <= 0) return m + 2 * r - p.y;
  return m + 3 * r + p.x;
}
// octagon, corner cut uCut / 8
int gOctM(int r) { return r < 0 ? 0 : r + (uCut * r) / 8; }
int gOctCount(int r) {
  if (r < 0) return 0;
  int e = 2 * r - gOctM(r);
  return (2 * r + 1) * (2 * r + 1) - 2 * e * (e + 1);
}
int gOctCnt(int r, int d) {
  int m = gOctM(r), m0 = gOctM(r - 1);
  int lenA = m - r + 1, topN = min(m - r, r - 1), topLo = r - topN;
  int n = min(max(d + r, 0), lenA) + min(max(d - topLo, 0), topN);
  for (int s = m0 + 1; s <= m; s++) {
    int len = 2 * r - 1 - s, lo = s - 2 * r + 2;
    if (len > 0 && d > lo) n += min(len, (d - lo + 1) / 2);
  }
  return n;
}
ivec2 gOctPos(int k) {
  if (k == 0) return ivec2(0);
  float c = 1.0 - float(uCut) / 8.0, A = 4.0 - 2.0 * c * c;
  int r = max(1, int(floor(sqrt(float(k) / A))) - 1);
  for (int i = 0; i < 6; i++) { if (gOctCount(r) <= k) r++; }
  for (int i = 0; i < 6; i++) { if (r > 1 && gOctCount(r - 1) > k) r--; }
  int t = k - gOctCount(r - 1), q = (gOctCount(r) - gOctCount(r - 1)) / 4;
  int qi = t / q, j = t - qi * q;
  int lo = -r, hi = r;
  for (int i = 0; i < 18; i++) {
    if (lo >= hi) break;
    int mid = (lo + hi) >> 1;
    if (gOctCnt(r, mid + 1) > j) hi = mid; else lo = mid + 1;
  }
  int d = lo, m = gOctM(r), topN = min(m - r, r - 1);
  ivec2 p;
  if (d <= m - 2 * r) p = ivec2(r, d + r);
  else if (topN > 0 && d >= r - topN) p = ivec2(r - d, r);
  else { int s = ((m - d) & 1) == 0 ? m : m - 1; p = ivec2((s - d) >> 1, (s + d) >> 1); }
  for (int i = 0; i < 3; i++) { if (i >= qi) break; p = ivec2(-p.y, p.x); }
  return p;
}
int gOctIdx(ivec2 p) {
  int r = max(abs(p.x), abs(p.y));
  if (r == 0) return 0;
  for (int i = 0; i < 64; i++) { if (abs(p.x) + abs(p.y) <= gOctM(r)) break; r++; }
  int qi = 0;
  for (int i = 0; i < 3; i++) { if (p.x > 0 && p.y >= 0) break; p = ivec2(p.y, -p.x); qi++; }
  int q = (gOctCount(r) - gOctCount(r - 1)) / 4;
  return gOctCount(r - 1) + qi * q + gOctCnt(r, p.y - p.x);
}
// concentric squares: each ring starts at (r, 0)
ivec2 gConPos(int k) {
  if (k == 0) return ivec2(0);
  int r = gSqRing(k), t = k - (2 * r - 1) * (2 * r - 1), n8 = 8 * r;
  int tu = t + r - 1; if (tu >= n8) tu -= n8;
  return gSqPos((2 * r - 1) * (2 * r - 1) + tu);
}
int gConIdx(ivec2 p) {
  int r = max(abs(p.x), abs(p.y));
  if (r == 0) return 0;
  int m = (2 * r - 1) * (2 * r - 1), t = gSqIdx(p) - m - (r - 1);
  if (t < 0) t += 8 * r;
  return m + t;
}
// Klauber triangle, Cantor diagonals, rows, snake rows
ivec2 gKlaPos(int k) { int j = gIsqrt(k); return ivec2(k - j * j - j, -j); }
int gKlaIdx(ivec2 p) { int j = -p.y; if (j < 0 || abs(p.x) > j) return -1; return j * j + j + p.x; }
ivec2 gCanPos(int k) {
  int w = int(floor((sqrt(8.0 * float(k) + 1.0) - 1.0) * 0.5));
  for (int i = 0; i < 3; i++) { if (w * (w + 1) / 2 > k) w--; }
  for (int i = 0; i < 3; i++) { if ((w + 1) * (w + 2) / 2 <= k) w++; }
  int y = k - w * (w + 1) / 2; return ivec2(w - y, y);
}
int gCanIdx(ivec2 p) { if (p.x < 0 || p.y < 0) return -1; int s = p.x + p.y; return s * (s + 1) / 2 + p.y; }
ivec2 gRowPos(int k) { int j = k / uW; return ivec2(k - j * uW, -j); }
int gRowIdx(ivec2 p) { if (p.x < 0 || p.x >= uW || p.y > 0) return -1; return -p.y * uW + p.x; }
ivec2 gSnkPos(int k) { int j = k / uW, i = k - j * uW; return ivec2((j & 1) == 1 ? uW - 1 - i : i, -j); }
int gSnkIdx(ivec2 p) { if (p.x < 0 || p.x >= uW || p.y > 0) return -1; int j = -p.y; return j * uW + ((j & 1) == 1 ? uW - 1 - p.x : p.x); }
// Hilbert curve and Z-order on a 2^16 side
ivec2 gHilPos(uint d) {
  uint x = 0u, y = 0u, t = d;
  for (int b = 0; b < 16; b++) {
    uint s = 1u << uint(b), rx = (t >> 1u) & 1u, ry = (t ^ rx) & 1u;
    if (ry == 0u) { if (rx == 1u) { x = s - 1u - x; y = s - 1u - y; } uint tmp = x; x = y; y = tmp; }
    x += s * rx; y += s * ry; t >>= 2u;
  }
  return ivec2(x, y);
}
int gHilIdx(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x > 32767 || p.y > 32767) return -1;
  uint x = uint(p.x), y = uint(p.y), d = 0u, N = 65536u;
  for (int b = 15; b >= 0; b--) {
    uint s = 1u << uint(b), rx = (x & s) > 0u ? 1u : 0u, ry = (y & s) > 0u ? 1u : 0u;
    d += s * s * ((3u * rx) ^ ry);
    if (ry == 0u) { if (rx == 1u) { x = N - 1u - x; y = N - 1u - y; } uint tmp = x; x = y; y = tmp; }
  }
  return d > 2147483647u ? -1 : int(d);
}
ivec2 gZPos(uint d) {
  uint x = 0u, y = 0u;
  for (int b = 0; b < 16; b++) { x |= ((d >> uint(2 * b)) & 1u) << uint(b); y |= ((d >> uint(2 * b + 1)) & 1u) << uint(b); }
  return ivec2(x, y);
}
int gZIdx(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x > 32767 || p.y > 32767) return -1;
  uint d = 0u, x = uint(p.x), y = uint(p.y);
  for (int b = 0; b < 16; b++) { d |= ((x >> uint(b)) & 1u) << uint(2 * b); d |= ((y >> uint(b)) & 1u) << uint(2 * b + 1); }
  return d > 2147483647u ? -1 : int(d);
}
// hexagonal spiral, axial (q, r)
const ivec2 HD[6] = ivec2[6](ivec2(1, 0), ivec2(0, 1), ivec2(-1, 1), ivec2(-1, 0), ivec2(0, -1), ivec2(1, -1));
ivec2 gHexPos(int k) {
  if (k == 0) return ivec2(0);
  int R = max(1, int(floor(sqrt(float(k) / 3.0))));
  for (int i = 0; i < 4; i++) { if (1 + 3 * R * (R + 1) <= k) R++; }
  for (int i = 0; i < 4; i++) { if (R > 1 && 1 + 3 * R * (R - 1) > k) R--; }
  int t = k - (1 + 3 * R * (R - 1)) + 1; if (t >= 6 * R) t -= 6 * R;
  int i = t / R, j = t - i * R;
  return R * HD[i] + j * HD[(i + 2) - ((i + 2) / 6) * 6];
}
int gHexIdx(ivec2 p) {
  int R = (abs(p.x) + abs(p.y) + abs(p.x + p.y)) >> 1;
  if (R == 0) return 0;
  for (int i = 0; i < 6; i++) {
    ivec2 a = HD[i], b = HD[(i + 2) - ((i + 2) / 6) * 6], d = p - R * a;
    int j = b.x != 0 ? d.x * b.x : d.y * b.y;
    if (j >= 0 && j < R && d == j * b) { int t = i * R + j - 1; if (t < 0) t += 6 * R; return 1 + 3 * R * (R - 1) + t; }
  }
  return -1;
}
// triangular spiral: legs 1, 2, 3, ... along E, NW, SW
const ivec2 TE[3] = ivec2[3](ivec2(1, 0), ivec2(-1, 1), ivec2(0, -1));
const ivec2 TA[3] = ivec2[3](ivec2(-1, -1), ivec2(2, -1), ivec2(-1, 2));
const ivec2 TB[3] = ivec2[3](ivec2(0, 0), ivec2(1, 0), ivec2(-1, 2));
ivec2 gTriPos(int k) {
  if (k == 0) return ivec2(0);
  int j = max(1, int(floor((sqrt(8.0 * float(k) + 1.0) - 1.0) * 0.5)));
  for (int i = 0; i < 3; i++) { if (j * (j + 1) / 2 < k) j++; }
  for (int i = 0; i < 3; i++) { if (j > 1 && (j - 1) * j / 2 >= k) j--; }
  int s = k - (j - 1) * j / 2, T = (j - 1) / 3, u = (j - 1) - 3 * T;
  return T * TA[u] + TB[u] + s * TE[u];
}
int gTriIdx(ivec2 p) {
  if (p == ivec2(0)) return 0;
  for (int u = 0; u < 3; u++) {
    ivec2 e = TE[u], v = p - TB[u];
    int T = v.x * e.y - v.y * e.x;
    if (T < 0) continue;
    ivec2 w = v - T * TA[u];
    int s = e.x != 0 ? w.x * e.x : w.y * e.y, j = 3 * T + u + 1;
    if (s >= 1 && s <= j && w == s * e) return (j - 1) * j / 2 + s;
  }
  return -1;
}

// lattice cell of index k, any lattice shape
ivec2 gLatPos(int sh, int k) {
  if (sh == 0) return gOrient(gSqPos(k));
  if (sh == 1) return gOrient(gRectPos(k));
  if (sh == 2) return gOrient(gDiaPos(k));
  if (sh == 3) return gOrient(gOctPos(k));
  if (sh == 4) return gOrient(gConPos(k));
  if (sh == 5) return gKlaPos(k);
  if (sh == 6) return gCanPos(k);
  if (sh == 7) return gRowPos(k);
  if (sh == 8) return gSnkPos(k);
  if (sh == 9) return gHilPos(uint(k));
  if (sh == 10) return gZPos(uint(k));
  if (sh == 11) return gSqPos(k);
  if (sh == 13) return gTriPos(k);
  return gHexPos(k);
}
// index k of a lattice cell, -1 when no number sits there
int gIdx(int sh, ivec2 p) {
  if (sh == 0) return gSqIdx(gUnorient(p));
  if (sh == 1) return gRectIdx(gUnorient(p));
  if (sh == 2) return gDiaIdx(gUnorient(p));
  if (sh == 3) return gOctIdx(gUnorient(p));
  if (sh == 4) return gConIdx(gUnorient(p));
  if (sh == 5) return gKlaIdx(p);
  if (sh == 6) return gCanIdx(p);
  if (sh == 7) return gRowIdx(p);
  if (sh == 8) return gSnkIdx(p);
  if (sh == 9) return gHilIdx(p);
  if (sh == 10) return gZIdx(p);
  if (sh == 11) return gSqIdx(p);
  if (sh == 13) return gTriIdx(p);
  return gHexIdx(p);
}
vec2 gWorld(int sh, ivec2 c) { return gHexKind(sh) ? vec2(float(c.x) + 0.5 * float(c.y), float(c.y) * SQ3) : vec2(c); }

#define FERMAT_C 0.62
// n -> world position, any shape (lattice shapes: the cell centre)
vec3 gPos(int sh, uint n) {
  uint st = gStartOf(sh);
  int k = int(n - st);
  if (gLattice(sh)) return vec3(gWorld(sh, gLatPos(sh, k)), 0.0);
  float fn = float(n), fk = float(k);
  if (sh == 15) { float q = sqrt(fn), a = TAU * gSacksTurn(n); return vec3(q * cos(a), q * sin(a), 0.0); }
  if (sh == 16) { float tw = float(k - (k / uW) * uW) / float(uW), a = TAU * tw, r = fk / float(uW); return vec3(r * cos(a), r * sin(a), 0.0); }
  if (sh == 17) { float r = FERMAT_C * sqrt(fn), a = TAU * gFracMul(n, uAngFx); return vec3(r * cos(a), r * sin(a), 0.0); }
  if (sh == 18) { float r = sqrt(fn), a = n > 0u ? TAU * fract(log(fn) / log(uG)) : 0.0; return vec3(r * cos(a), r * sin(a), 0.0); }
  if (sh == 19) { float tw = float(k - (k / uW) * uW) / float(uW), a = TAU * tw, R = float(uW) / TAU; return vec3(R * cos(a), R * sin(a), fk / float(uW)); }
  if (sh == 20) { ivec2 c = gSqPos(k); return vec3(vec2(c), -0.5 * float(max(abs(c.x), abs(c.y)))); }
  float q = sqrt(fn), a = TAU * gSacksTurn(n); return vec3(q * cos(a), q * sin(a), -0.7 * q);
}
`;

// --- classes and colours ------------------------------------------------------
export const CLASSES_GLSL = `
uniform usampler2D uPrimes; uniform int uPrimesW; uniform uint uLimit;
uniform sampler2D uArith; uniform int uArithW; uniform uint uArithN;
uniform int uMode;
uniform ivec3 uQuad; uniform int uQuadOn; uniform float uQuadMax;
uniform vec3 uPal[5]; uniform vec3 uPalB[5];
uniform float uCompA, uGain;
uniform vec3 uQuadCol;
uniform vec3 uSweep;          // x, y, radius of the palette sweep front (world)
uniform float uSweepW;

// MODE_ numbers: numtheory.js MODE
#define MODE_PRIMES 0
#define MODE_SOPHIE 4
#define MODE_GAUSS 5
#define MODE_EISEN 6
#define MODE_DIV 7
#define MODE_SPF 8
#define MODE_TOT 9
#define MODE_FIG 10

// 1 prime, 0 not, 2 unknown (above the bitset)
int gIsP(uint n) {
  if (n < 2u) return 0;
  if (n == 2u) return 1;
  if ((n & 1u) == 0u) return 0;
  if (n > uLimit) return 2;
  uint i = (n - 1u) >> 1u, w = i >> 5u, W = uint(uPrimesW);
  uint word = texelFetch(uPrimes, ivec2(int(w % W), int(w / W)), 0).r;
  return int((word >> (i & 31u)) & 1u);
}
bool gIsSq(uint v) { uint s = uint(sqrt(float(v)) + 0.5); for (int i = 0; i < 2; i++) { if (s * s > v) s--; } for (int i = 0; i < 2; i++) { if ((s + 1u) * (s + 1u) <= v) s++; } return s * s == v; }
const uint FIB[46] = uint[46](1u,2u,3u,5u,8u,13u,21u,34u,55u,89u,144u,233u,377u,610u,987u,1597u,2584u,4181u,6765u,10946u,17711u,28657u,46368u,75025u,121393u,196418u,317811u,514229u,832040u,1346269u,2178309u,3524578u,5702887u,9227465u,14930352u,24157817u,39088169u,63245986u,102334155u,165580141u,267914296u,433494437u,701408733u,1134903170u,1836311903u,2971215073u);

// The class byte of n (numtheory.js classify). lat: the lattice number
// for the Gaussian and Eisenstein modes. 255: unknown.
float gClass(uint n, ivec2 lat) {
  if (uMode == MODE_GAUSS || uMode == MODE_EISEN) {
    int a = lat.x, b = lat.y;
    if (uMode == MODE_GAUSS) {
      a = abs(a); b = abs(b);
      if (a > 46000 || b > 46000) return 255.0;
      if (a == 0 || b == 0) { int m = a + b; int p = gIsP(uint(m)); return p == 2 ? 255.0 : float(p == 1 && (m & 3) == 3); }
      int p = gIsP(uint(a * a + b * b)); return p == 2 ? 255.0 : float(p);
    }
    if (abs(a) > 30000 || abs(b) > 30000) return 255.0;
    int N = a * a - a * b + b * b;
    if (N < 2) return 0.0;
    int p = gIsP(uint(N));
    if (p == 2) return 255.0;
    if (p == 1) return 1.0;
    if (a != 0 && b != 0 && a != b) return 0.0;
    int q = int(sqrt(float(N)) + 0.5);
    return float(q * q == N && q - (q / 3) * 3 == 2 && gIsP(uint(q)) == 1);
  }
  if (uMode >= MODE_DIV && uMode <= MODE_TOT) {
    if (n >= uArithN) return 255.0;
    uint W = uint(uArithW);
    return floor(texelFetch(uArith, ivec2(int(n % W), int(n / W)), 0).r * 255.0 + 0.5);
  }
  if (uMode == MODE_FIG) {
    int p = gIsP(n); if (p == 2) return 255.0;
    float v = float(p) * 8.0;
    if (gIsSq(n)) v += 1.0;
    if (n < 536870911u && gIsSq(8u * n + 1u)) v += 2.0;
    for (int i = 0; i < 46; i++) { if (FIB[i] == n) { v += 4.0; break; } if (FIB[i] > n) break; }
    return v;
  }
  if (n < 2u) return n == 1u ? 2.0 : 0.0;
  int p = gIsP(n);
  if (p != 1) return p == 2 ? 255.0 : 0.0;
  if (uMode >= 1 && uMode <= 3) {
    uint g = uint(2 * uMode);
    if ((n > g + 1u && gIsP(n - g) == 1) || gIsP(n + g) == 1) return 3.0;
    return 1.0;
  }
  if (uMode == MODE_SOPHIE) {
    bool sg = gIsP(2u * n + 1u) == 1, sf = n > 2u && gIsP((n - 1u) / 2u) == 1;
    return sg && sf ? 5.0 : sf ? 4.0 : sg ? 3.0 : 1.0;
  }
  return 1.0;
}
// Is n = a k^2 + b k + c for an integer k in [0, uQuadMax]? Returns k or -1.
float gQuadK(uint n) {
  if (uQuadOn == 0 || n > 2000000000u) return -1.0;
  int a = uQuad.x, b = uQuad.y, c = uQuad.z, N = int(n);
  float k0;
  if (a == 0) { if (b == 0) return N == c ? 0.0 : -1.0; k0 = float(N - c) / float(b); }
  else { float D = float(b) * float(b) - 4.0 * float(a) * float(c - N); if (D < 0.0) return -1.0; k0 = (-float(b) + sqrt(D)) / (2.0 * float(a)); }
  int k = int(floor(k0 + 0.5));
  for (int i = -1; i <= 1; i++) {
    int kk = k + i;
    if (kk < 0 || float(kk) > uQuadMax || kk > 46000) continue;
    if (a * kk * kk + b * kk + c == N) return float(kk);
  }
  return -1.0;
}
vec3 palA(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0; int i = int(min(floor(t), 3.0)); float f = t - float(i);
  return mix(uPal[i], uPal[i + 1], f * f * (3.0 - 2.0 * f));
}
vec3 palB(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0; int i = int(min(floor(t), 3.0)); float f = t - float(i);
  return mix(uPalB[i], uPalB[i + 1], f * f * (3.0 - 2.0 * f));
}
float sweepAt(vec2 w) { return uSweep.z > 0.0 ? smoothstep(uSweep.z - uSweepW, uSweep.z, length(w - uSweep.xy)) : 1.0; }
vec3 palW(float t, vec2 w) { return mix(palB(t), palA(t), sweepAt(w)); }
// Colour (premultiplied by strength) of a class byte v; w: world position
// for the palette sweep. a: the strength 0..1 of the mark.
vec4 shadeV(float v, vec2 w) {
  float sw = sweepAt(w);
  #define PAL(t) mix(palB(t), palA(t), sw)
  if (v > 254.5) return vec4(vec3(0.16, 0.17, 0.22), 0.14);
  if (uMode == MODE_DIV) {
    float t = clamp(log2(max(v, 1.0)) / 6.0, 0.0, 1.0);
    return vec4(PAL(t), 0.02 + 0.98 * t * t * t);
  }
  if (uMode == MODE_SPF) {
    if (v > 253.5) return vec4(PAL(1.0), 1.0);
    if (v < 0.5) return vec4(0.0);
    float t = clamp(log2(v) / 7.0, 0.0, 1.0);
    return vec4(PAL(0.1 + 0.75 * t), 0.04 + 0.6 * t * t);
  }
  if (uMode == MODE_TOT) {
    float r = (v - 1.0) / 250.0;
    return vec4(PAL(r), 0.02 + 0.98 * pow(r, 4.0));
  }
  if (uMode == MODE_FIG) {
    float b = v;
    bool pr = b >= 8.0; if (pr) b -= 8.0;
    bool fi = b >= 4.0; if (fi) b -= 4.0;
    bool tr = b >= 2.0; if (tr) b -= 2.0;
    bool sq = b >= 1.0;
    if (fi) return vec4(mix(PAL(1.0), vec3(1.0), 0.35), 1.0);
    if (sq && tr) return vec4(1.0, 1.0, 1.0, 1.0);
    if (sq) return vec4(PAL(0.85), 1.0);
    if (tr) return vec4(PAL(0.45), 0.95);
    if (pr) return vec4(PAL(0.25), 0.28);
    return vec4(PAL(0.0), uCompA);
  }
  if (v < 0.5) return vec4(PAL(0.0), uCompA);
  if (v < 1.5) {
    bool special = uMode >= 1 && uMode <= MODE_SOPHIE;
    return special ? vec4(PAL(0.35), 0.32) : vec4(PAL(0.78), 1.0);
  }
  if (v < 2.5) return vec4(mix(PAL(1.0), vec3(1.0), 0.6), 1.0);   // the number 1
  if (v < 3.5) return vec4(mix(PAL(1.0), vec3(1.0), 0.15), 1.0);
  if (v < 4.5) return vec4(PAL(0.62), 1.0);
  return vec4(vec3(1.0, 0.97, 0.9), 1.0);
}
`;

// --- the per-pixel lattice pass ---------------------------------------------
// FIELD_LIB: the uniforms and the cell helpers that FIELD_FS and PYR_FS
// share. cellColor(c, off, 1.0) is the solid mark of cell c (m = 1): the
// value that the box filter and the pyramid average.
const FIELD_LIB = HEAD + SHAPES_GLSL + CLASSES_GLSL + `
uniform int uShape;
uniform int uStyle;           // 0 cell, 1 dot, 2 glow, 3 soft
uniform float uWalk, uIgnite; // walk: index front (k), ignite length; uWalk < 0: off
uniform int uTileOn; uniform sampler2D uTile; uniform ivec2 uTileOrg, uTileSize;
uniform float uDotR;
out vec4 frag;

ivec2 cellOf(vec2 wl, out vec2 off) {
  if (!gHexKind(uShape)) { vec2 c = floor(wl + 0.5); off = wl - c; return ivec2(c); }
  float r = wl.y / SQ3, q = wl.x - 0.5 * r, s = -q - r;
  float rq = floor(q + 0.5), rr = floor(r + 0.5), rs = floor(s + 0.5);
  float dq = abs(rq - q), dr = abs(rr - r), ds = abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  off = wl - vec2(rq + 0.5 * rr, rr * SQ3);
  return ivec2(int(rq), int(rr));
}
// The class byte and the quadratic flag of one cell; k: its index.
vec2 cellClass(ivec2 c, out float k) {
  k = -1.0;
  if (uTileOn == 1) {
    ivec2 t = c - uTileOrg;
    if (t.x < 0 || t.y < 0 || t.x >= uTileSize.x || t.y >= uTileSize.y) return vec2(255.0, 0.0);
    vec2 v = texelFetch(uTile, t, 0).rg * 255.0;
    return vec2(floor(v.x + 0.5), floor(v.y + 0.5));
  }
  if (max(abs(c.x), abs(c.y)) > 23000) return vec2(255.0, 0.0);
  int ki = gIdx(uShape, c);
  if (ki < 0) return vec2(-1.0, 0.0);
  k = float(ki);
  uint n = gStartOf(uShape) + uint(ki);
  if (n < gStartOf(uShape)) return vec2(255.0, 0.0);   // wrapped past 2^32
  ivec2 lat = uShape == 14 ? ivec2(c.x + c.y, c.y) : c;
  float q = gQuadK(n);
  return vec2(gClass(n, lat), q >= 0.0 ? 1.0 : 0.0);
}
// The colour of one cell at the offset off (world units from its centre).
vec4 cellColor(ivec2 c, vec2 off, float pxW) {
  float k;
  vec2 cq = cellClass(c, k);
  if (cq.x < 0.0) return vec4(0.0);
  if (uWalk >= 0.0 && k > uWalk) return vec4(0.0);
  vec2 w = gWorld(uShape, c);
  vec4 s = shadeV(cq.x, w);
  // a lit quadratic: its values in the quadratic colour, the rest dimmed
  if (cq.y > 0.5) s = vec4(mix(uQuadCol, vec3(1.0), cq.x == 1.0 ? 0.3 : 0.0), cq.x == 1.0 ? 1.0 : 0.55);
  else if (uQuadOn == 1) s.a *= 0.4;
  float ign = (uWalk >= 0.0 && k >= 0.0) ? exp(-(uWalk - k) / max(uIgnite, 1.0)) : 0.0;
  float a = s.a * (1.0 + 2.5 * ign);
  vec3 col = mix(s.rgb, vec3(1.0, 0.96, 0.88), 0.6 * ign);
  // the mark shape inside the cell, antialiased by the pixel size
  float d = length(off), edge = max(pxW, 1e-4);
  bool hexk = gHexKind(uShape);
  float m;
  if (uStyle == 0) {
    vec2 ao = abs(off);
    float box = hexk ? max(ao.y * 1.1547, ao.x * 0.5 + ao.y * 0.57735) * 0.866 : max(ao.x, ao.y);
    float gap = pxW < 0.08 ? 0.44 : 0.5;
    m = 1.0 - smoothstep(gap - edge, gap, box);
  } else if (uStyle == 1) {
    m = 1.0 - smoothstep(uDotR - edge, uDotR + edge * 0.5, d);
  } else {
    float core = 1.0 - smoothstep(uDotR * 0.55 - edge, uDotR * 0.55 + edge, d);
    float halo = exp(-d * d / (uDotR * uDotR * 0.9));
    m = uStyle == 2 ? max(core, 0.55 * halo) : halo;
  }
  // a cell of a pixel or less is a solid mark (no sub-pixel dot to alias)
  m = mix(m, 1.0, smoothstep(0.3, 0.7, pxW));
  return vec4(col * a * m, a * m);
}
`;

// FIELD_FS: one pass per pixel. The pixel footprint is a square of side
// uPxW (world units). Three regimes, by the footprint size:
//   pxW < 0.7          one sample at the pixel centre, with the mark shape
//                      and the halo of the neighbours
//   0.7 .. uBoxMax     boxCells: every cell under the footprint, weighted
//                      by the area it shares with the footprint (an exact
//                      box filter, no sample stride)
//   > uBoxMax          boxPyr: the same box filter over the blocks of the
//                      pyramid (PYR_FS), exact sums of B0 x B0 cells, or
//                      boxJitter (stratified cell pairs) while the pyramid
//                      is not ready and outside its region
// A fixed sample stride of 2 or 4 cells would read one parity of the
// checkerboard only (all odd n sit on one parity), so the old sub-pixel
// grid lost the prime diagonals or doubled them as the zoom changed.
// The box filter keeps the mean light of a region the same at every zoom.
// Lattice coordinates: square shapes use the cell (x, y); hex shapes use
// axial (q, r), where a cell is a unit square and the footprint is the
// sheared square of the same area (pxW wide, pxW / SQ3 high).
export const FIELD_FS = FIELD_LIB + `
uniform ivec2 uBase;          // the lattice cell next to the camera
uniform vec2 uLocal;          // camera world position minus world(uBase)
uniform vec2 uCenter;         // the camera position on the canvas, device px
uniform float uPxW;           // world units per device px
uniform float uBoxMax;        // largest pxW for the exact cell loop
uniform int uDebug;           // 1: the index k as colour, 2: the class byte, 3: the density (self-test)
uniform int uPyrOn, uPyrAlpha, uPyrB0, uPyrLevels;
uniform sampler2D uPyr; uniform ivec2 uPyrOrg, uPyrSize;

// world offset from world(uBase) -> lattice offset from uBase
vec2 latOf(vec2 wl) {
  if (!gHexKind(uShape)) return wl;
  float r = wl.y / SQ3;
  return vec2(wl.x - 0.5 * r, r);
}
vec4 boxCells(vec2 lc, vec2 h) {
  vec2 lo = lc - h, hi = lc + h;
  ivec2 c0 = ivec2(floor(lo + 0.5)), c1 = ivec2(floor(hi + 0.5));
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 16; j++) {
    int y = c0.y + j; if (y > c1.y) break;
    float wy = min(hi.y, float(y) + 0.5) - max(lo.y, float(y) - 0.5);
    for (int i = 0; i < 16; i++) {
      int x = c0.x + i; if (x > c1.x) break;
      float wx = min(hi.x, float(x) + 0.5) - max(lo.x, float(x) - 0.5);
      acc += cellColor(uBase + ivec2(x, y), vec2(0.0), 1.0) * (wx * wy);
    }
  }
  return acc / (4.0 * h.x * h.y);
}
vec2 hash2(ivec2 p) {
  uint n = uint(p.x + 1073741824) * 1597334673u ^ uint(p.y + 1073741824) * 3812015801u;
  n ^= n >> 16; n *= 2246822519u; n ^= n >> 13; n *= 3266489917u; n ^= n >> 16;
  return vec2(float(n & 65535u), float(n >> 16)) / 65536.0;
}
// 4 x 4 strata over the footprint, one cell pair per stratum at an offset
// from a hash of the lattice cell under the stratum centre: no fixed
// stride, so no parity lock, and the same cells while the camera stands
// still. Each sample takes the cell and its right neighbour. Where the
// path of n steps from cell to neighbour cell (the square spiral, Hilbert,
// rows), the pair holds one odd and one even n, so the odd-only marks
// (primes, unknown n past the sieve) lose most of the parity noise.
vec4 boxJitter(vec2 lc, vec2 h) {
  vec4 acc = vec4(0.0);
  vec2 st = 2.0 * h / 4.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 o = lc - h + vec2(float(i), float(j)) * st;
    ivec2 key = uBase + ivec2(floor(o + 0.5 * st));
    ivec2 c = uBase + ivec2(floor(o + hash2(key * 7 + ivec2(i, j)) * st + 0.5));
    acc += cellColor(c, vec2(0.0), 1.0) + cellColor(c + ivec2(1, 0), vec2(0.0), 1.0);
  }
  return acc / 32.0;
}
// The box filter over pyramid blocks: level L has blocks of B0 2^L cells;
// the footprint covers at most 4 blocks per side. A part of the footprint
// outside the pyramid gets boxJitter.
vec4 boxPyr(vec2 lc, vec2 h) {
  float hm = max(h.x, h.y);
  int L = int(clamp(ceil(log2(2.0 * hm / (4.0 * float(uPyrB0)))), 0.0, float(uPyrLevels - 1)));
  ivec2 sz = max(uPyrSize >> L, ivec2(1));
  vec2 blk = vec2(uPyrSize * uPyrB0) / vec2(sz);
  vec2 p = vec2(uBase - uPyrOrg) + lc + 0.5;
  vec2 u0 = (p - h) / blk, u1 = (p + h) / blk;
  ivec2 t0 = max(ivec2(floor(u0)), ivec2(0)), t1 = min(ivec2(floor(u1)), sz - 1);
  vec4 acc = vec4(0.0);
  float win = 0.0;
  for (int j = 0; j < 7; j++) {
    int y = t0.y + j; if (y > t1.y) break;
    float wy = min(u1.y, float(y + 1)) - max(u0.y, float(y));
    for (int i = 0; i < 7; i++) {
      int x = t0.x + i; if (x > t1.x) break;
      float wx = min(u1.x, float(x + 1)) - max(u0.x, float(x));
      vec4 v = texelFetch(uPyr, ivec2(x, y), L);
      if (uPyrAlpha == 1) v = vec4(0.0, 0.0, 0.0, v.r);
      acc += v * (wx * wy); win += wx * wy;
    }
  }
  float area = (u1.x - u0.x) * (u1.y - u0.y);
  float wout = 1.0 - win / area;
  acc /= area;
  if (wout > 0.002) acc += boxJitter(lc, h) * wout;
  return acc;
}

void main() {
  vec2 px = gl_FragCoord.xy - uCenter;
  if (uDebug == 2) {
    vec2 off; ivec2 c = cellOf(uLocal + px * uPxW, off); c += uBase;
    float k; vec2 cq = cellClass(c, k);
    frag = vec4(max(cq.x, 0.0) / 255.0, cq.y, cq.x < 0.0 ? 1.0 : 0.0, 1.0);
    return;
  }
  if (uDebug == 1) {
    vec2 off; ivec2 c = cellOf(uLocal + px * uPxW, off); c += uBase;
    int k = gIdx(uShape, c);
    uint u = k < 0 ? 16777215u : uint(k);
    frag = vec4(float(u & 255u), float((u >> 8u) & 255u), float((u >> 16u) & 255u), 255.0) / 255.0;
    return;
  }
  vec4 acc = vec4(0.0);
  float pxW = uPxW;
  vec2 wl = uLocal + px * pxW;
  if (pxW < 0.7) {
    vec2 off;
    ivec2 c = cellOf(wl, off) + uBase;
    acc = cellColor(c, off, pxW);
    if (uStyle >= 2 && pxW < 0.25) {
      // the halo of the neighbours spills into this cell
      for (int n = 0; n < 6; n++) {
        ivec2 dc = gHexKind(uShape) ? HD[n] : (n < 4 ? ivec2(n == 0 ? 1 : n == 1 ? -1 : 0, n == 2 ? 1 : n == 3 ? -1 : 0) : ivec2(0));
        if (dc == ivec2(0)) continue;
        vec2 o2 = off - (gWorld(uShape, c + dc) - gWorld(uShape, c));
        vec4 nb = cellColor(c + dc, o2, pxW);
        acc.rgb += nb.rgb * 0.35;
      }
    }
  } else {
    vec2 lc = latOf(wl);
    vec2 h = 0.5 * pxW * (gHexKind(uShape) ? vec2(1.0, 1.0 / SQ3) : vec2(1.0));
    if (pxW <= uBoxMax) acc = boxCells(lc, h);
    else if (uPyrOn == 1) acc = boxPyr(lc, h);
    else acc = boxJitter(lc, h);
  }
  // Zoomed out, a pixel holds many cells: its mark strength is the local
  // density. d = ln(n) times it is about 1 where the primes are as dense
  // as random numbers of that size (1 / ln n). The colour runs through the
  // palette with d; the light is linear in d (so the mean light does not
  // jump with the zoom) plus the raw density (the brighter centre).
  if (pxW > 0.8 && uMode <= MODE_EISEN && uTileOn == 0) {
    vec2 off0; ivec2 c0 = cellOf(wl, off0) + uBase;
    int k0 = gIdx(uShape, c0);
    float nC = k0 < 0 ? 3.0 : float(gStartOf(uShape)) + float(k0);
    if (uMode == MODE_GAUSS || uMode == MODE_EISEN) nC = float(c0.x * c0.x + c0.y * c0.y) + 3.0;
    float d = acc.a * log(max(nC, 3.0)) * uGain;
    vec2 w0 = gWorld(uShape, c0);
    vec3 dc = palW(clamp(0.25 + 0.16 * d, 0.0, 1.0), w0) * min(0.17 * d + 0.7 * acc.a, 1.2);
    acc.rgb = mix(acc.rgb, dc, smoothstep(0.8, 2.0, pxW));
    acc.a = min(1.0, d * 0.5);
    if (uDebug == 3) { frag = vec4(acc.a, d / 16.0, nC / 1e8, 1.0); return; }
  }
  frag = vec4(acc.rgb, min(acc.a, 1.0));
}
`;

// PYR_FS: level 0 of the density pyramid. One texel = the mean of
// cellColor over B0 x B0 cells, from the lattice cell uPyrOrg + B0 * texel.
// uPyrAlpha 1: the mean light only (R16F, the density modes); 0: RGBA.
// render.js draws it in bands of rows (a budget per frame) and then calls
// generateMipmap: each level halves the side by exact 2 x 2 means.
export const PYR_FS = FIELD_LIB + `
uniform ivec2 uPyrOrg; uniform int uPyrB0, uPyrAlpha;
void main() {
  ivec2 c0 = uPyrOrg + ivec2(gl_FragCoord.xy) * uPyrB0;
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 32; j++) {
    if (j >= uPyrB0) break;
    for (int i = 0; i < 32; i++) {
      if (i >= uPyrB0) break;
      acc += cellColor(c0 + ivec2(i, j), vec2(0.0), 1.0);
    }
  }
  acc /= float(uPyrB0 * uPyrB0);
  frag = uPyrAlpha == 1 ? vec4(acc.a, 0.0, 0.0, 1.0) : acc;
}
`;

export const FULL_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() { vec2 p = P[gl_VertexID]; vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }
`;

// --- points (point shapes, 3D, morphs) ----------------------------------------
export const POINT_VS = HEAD + SHAPES_GLSL + CLASSES_GLSL + `
uniform int uShape, uShapeB;
uniform uint uN0, uStep; uniform uint uSpan;
uniform float uMorph, uStagger;
uniform mat4 uM;               // world (minus uOrigin) -> clip
uniform vec3 uOrigin;
uniform float uPt;             // dot diameter in world units at depth 1
uniform float uPxPerW;         // device px per world unit (2D) or the focal px (3D)
uniform int uPersp;
uniform float uWalk, uIgnite;
uniform int uPath;
out vec4 vCol;
out float vR;
void main() {
  uint n = uN0 + uint(gl_VertexID) * uStep;
  int sh = uShape;
  uint st = gStartOf(sh);
  vec3 p = gPos(sh, n);
  float k = float(n - st);
  if (uMorph > 0.0) {
    vec3 q = gPos(uShapeB, n);
    float f = float(n - uN0) / float(max(uSpan, 1u));
    float t = clamp(uMorph * (1.0 + uStagger) - f * uStagger, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    p = mix(p, q, t);
  }
  ivec2 lat = ivec2(0);
  if (uMode == MODE_GAUSS || uMode == MODE_EISEN) {
    if (sh == 11) lat = gLatPos(11, int(k));
    else if (sh == 14) { ivec2 c = gLatPos(14, int(k)); lat = ivec2(c.x + c.y, c.y); }
  }
  float v = gClass(n, lat);
  float qk = gQuadK(n);
  vec4 s = shadeV(v, p.xy);
  if (qk >= 0.0) s = vec4(mix(uQuadCol, vec3(1.0), v == 1.0 ? 0.3 : 0.0), v == 1.0 ? 1.0 : 0.6);
  else if (uQuadOn == 1) s.a *= 0.4;
  float ign = uWalk >= 0.0 ? exp(-(uWalk - k) / max(uIgnite, 1.0)) : 0.0;
  bool hide = (uWalk >= 0.0 && k > uWalk) || n < st || v > 254.5;
  vec4 clip = uM * vec4(p - uOrigin, 1.0);
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
  float pxs = uPersp == 1 ? uPxPerW / max(clip.w, 1e-3) : uPxPerW;
  float d = uPt * pxs;
  // the path: one even line in the palette, brighter at the walk front
  if (uPath == 1) { vCol = vec4(palW(0.6, p.xy), 0.32 + 0.5 * ign); gl_PointSize = 1.0; vR = 0.0; return; }
  // A dot below one pixel keeps its area as light: grow it to 1 px, dim it.
  float a = s.a * (1.0 + 2.5 * ign);
  if (d < 1.5) { a *= d * d / 2.25; d = 1.5; }
  vCol = vec4(mix(s.rgb, vec3(1.0, 0.96, 0.88), 0.6 * ign), a * uGain);
  if (s.a <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = min(d * 2.2, 160.0);
  vR = d;
}
`;
export const POINT_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vCol; in float vR;
uniform int uStyle; uniform int uPath;
out vec4 frag;
void main() {
  if (uPath == 1) { frag = vec4(vCol.rgb * vCol.a, vCol.a); return; }
  vec2 q = gl_PointCoord * 2.0 - 1.0;               // the sprite is 2.2 d wide
  float r = length(q) * 1.1;                        // in units of d
  float m;
  if (uStyle == 0) { vec2 a = abs(q) * 1.1; m = 1.0 - smoothstep(0.42, 0.46, max(a.x, a.y)); }
  else if (uStyle == 1) m = 1.0 - smoothstep(0.38, 0.38 + 1.5 / max(vR, 1.0), r);
  else { float core = 1.0 - smoothstep(0.2, 0.2 + 1.2 / max(vR, 1.0), r); float halo = exp(-r * r * 9.0); m = uStyle == 2 ? max(core, 0.6 * halo) : halo; }
  float a = vCol.a * m;
  if (a < 0.002) discard;
  frag = vec4(vCol.rgb * a, a);
}
`;

// --- bloom and the final mix ---------------------------------------------------
export const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 frag;
void main() {
  vec4 c = texture(uSrc, vUv + uTexel * vec2(-0.5, -0.5)) + texture(uSrc, vUv + uTexel * vec2(0.5, -0.5))
         + texture(uSrc, vUv + uTexel * vec2(-0.5, 0.5)) + texture(uSrc, vUv + uTexel * vec2(0.5, 0.5));
  frag = c * 0.25;
}
`;
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uDir; out vec4 frag;
void main() {
  vec4 c = texture(uSrc, vUv) * 0.2270270270;
  c += (texture(uSrc, vUv + uDir * 1.3846153846) + texture(uSrc, vUv - uDir * 1.3846153846)) * 0.3162162162;
  c += (texture(uSrc, vUv + uDir * 3.2307692308) + texture(uSrc, vUv - uDir * 3.2307692308)) * 0.0702702703;
  frag = c;
}
`;
export const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene, uB1, uB2;
uniform vec3 uBg0, uBg1;
uniform float uBloom, uExposure, uBloomT;
uniform vec2 uRes, uCenterUv;
out vec4 frag;
void main() {
  vec2 d = (vUv - uCenterUv) * vec2(uRes.x / uRes.y, 1.0);
  float vig = smoothstep(1.25, 0.15, length(d));
  vec3 bg = mix(uBg1, uBg0, vig);
  vec4 s = texture(uScene, vUv);
  // the bloom keeps only light above the local floor uBloomT, so a dense
  // even field does not turn into haze, while a lone bright mark glows
  vec3 b = max(texture(uB1, vUv).rgb - uBloomT, 0.0) * 0.9 + max(texture(uB2, vUv).rgb - uBloomT * 0.8, 0.0) * 1.3;
  vec3 c = bg * (1.0 - s.a * 0.85) + s.rgb * uExposure + b * uBloom;
  c = 1.0 - exp(-c * 1.35);                          // soft shoulder
  // a little blue noise against banding in the dark gradient
  float nz = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  frag = vec4(c + nz / 255.0, 1.0);
}
`;

// --- self-test: transform feedback of gPos ----------------------------------
export const TF_VS = HEAD + SHAPES_GLSL + `
uniform int uShape; uniform uint uN0, uStep;
out vec3 vPos;
void main() { vPos = gPos(uShape, uN0 + uint(gl_VertexID) * uStep); gl_Position = vec4(0.0); gl_PointSize = 1.0; }
`;
export const TF_FS = `#version 300 es
precision highp float; precision highp int; out vec4 frag; void main() { frag = vec4(0.0); }
`;
