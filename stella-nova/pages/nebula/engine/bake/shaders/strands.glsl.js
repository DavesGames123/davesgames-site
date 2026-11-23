// strands.glsl.js: the WebGL2 shells of the strand trace (spec 2.10.1), and the strand fetch text
// for the slab shell (A7).
// Owner: row A6. Spec: nebula-spec.md 2.2 (StrandPts), 2.10.1, 7.4 (table).
//
// Exports (grep -n "^export"):
//   STRAND_SEED_FS    seed draw: one texel per slot; writes the launch point and the strand code
//   STRAND_S_FS       S step draw (photoevaporation streamers, RK2 on Vel); one draw per point index
//   STRAND_F_FS       F step draw (Hessian filament spines); one draw per point index
//   STRAND_FETCH_GLSL helper text for the slab shell: tile and segment fetch from strandTiles and strandSegs
//
// Target of every trace draw: strandPos1, RGBA32F 512 x 183. Texel (col, row) is slot row * 512 + col.
// Slots 93312 and higher are padding and write 0.
// History: strandPts, RGBA32F 512 x 5856, layout [point][slot]: row = point * 183 + slot / 512,
// column = slot % 512. strands.js copies each draw result into rows 183 p .. 183 p + 182.
// The draws read strandPts and strandPos0 (the seeds) and write strandPos1, so no draw reads its target.
//
// Texel value (x, y, z px, w). w = 0 is not valid. A valid point has w = code + weight / (1 + weight):
//   code 1 = S, H channel; 2 = S, He channel; 3 = F, PAH emission and absorption; 4 = F, absorption only.
// Every valid point of one slot has the same w. strands.js decodes it (decodeStrandW).
// x is not wrapped: a trace that crosses the seam keeps a continuous x. The texture read wraps it
// (Vel and IonH use REPEAT in x).

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler3D; precision highp sampler2D;
uniform highp sampler3D _Vel;      // (u, v, w, rho), RGBA16F, linear, x repeat
uniform highp sampler3D _IonH;     // (B_min, B_He, G_FUV, -), RGBA16F, linear, x repeat
uniform highp sampler2D _Pts;      // strandPts history, RGBA32F, nearest
uniform highp sampler2D _Seed;     // strandPos0: the seed of each slot, RGBA32F, nearest
uniform vec3 _Box;                 // box size px (5760, 1080, 1920)
uniform vec3 _Cell;                // tier cell size px (Vel grid)
uniform vec3 _Lattice;             // seed lattice px (40, 40, 80)
uniform ivec3 _LatticeN;           // seed lattice counts (144, 27, 24)
uniform int _Point;                // point index that this draw writes
uniform int _From;                 // point index that this draw steps from (-1: the seed)
uniform int _Prev;                 // point index before _From, for the F direction (-1: none)
uniform float _StepPx;             // S trace step length px (5)
uniform float _StepPxF;            // F trace step length px (10, attempt 2: tubes up to 310 px)
uniform float _DirSign;            // F: +1 forward, -1 backward (first step only)
uniform float _GRef;               // G_ref = QhatFUV(cl1) / 60^2
uniform float _GDiss;              // G_diss = 3.364
uniform float _RhoStop;            // S stop density (1e-3)
uniform int _EnableS;
uniform int _EnableF;
uniform float _KappaSeed;          // ridge seed threshold (0.03)
uniform float _KappaKeep;          // ridge trace threshold (0.015)
uniform float _SBand;              // S seed band |B_min - 1| (0.12)
uniform float _FlowRho;            // V family: seed weight smoothstep(_FlowRho, 8 _FlowRho, rho), trace stop rho (0.5)
out vec4 o;

const int SLOTS = 93312;
const int COLS = 512;
const int ROWS = 183;

int SlotOf() { ivec2 t = ivec2(gl_FragCoord.xy); return t.y * COLS + t.x; }
ivec2 HistTexel(int point, int slot) { return ivec2(slot & 511, point * ROWS + (slot >> 9)); }
vec4 Hist(int point, int slot) { return texelFetch(_Pts, HistTexel(point, slot), 0); }
vec4 SeedOf(int slot) { return texelFetch(_Seed, ivec2(slot & 511, slot >> 9), 0); }
float CodeOf(float w) { return floor(w); }
float EncodeW(float code, float weight) { float c = max(weight, 0.0); return code + min(c / (1.0 + c), 0.999); }

vec3 Uvw(vec3 p) { return p / _Box; }
vec4 VelAt(vec3 p) { return textureLod(_Vel, Uvw(p), 0.0); }
vec4 IonAt(vec3 p) { return textureLod(_IonH, Uvw(p), 0.0); }
float RhoAt(vec3 p) { return textureLod(_Vel, Uvw(p), 0.0).w; }
bool InBoxYZ(vec3 p) { return p.y >= 0.0 && p.y <= _Box.y && p.z >= 0.0 && p.z <= _Box.z; }

// Hessian of rho in cell units (central differences, step 1 cell).
// d = diagonal (xx, yy, zz), e = off-diagonal (xy, xz, yz).
// g = gradient in cell units (central differences).
void Hessian(vec3 p, out float r0, out vec3 g, out vec3 d, out vec3 e)
{
    vec3 c = _Cell;
    r0 = RhoAt(p);
    vec3 dx = vec3(c.x, 0.0, 0.0), dy = vec3(0.0, c.y, 0.0), dz = vec3(0.0, 0.0, c.z);
    float xp = RhoAt(p + dx), xm = RhoAt(p - dx), yp = RhoAt(p + dy), ym = RhoAt(p - dy), zp = RhoAt(p + dz), zm = RhoAt(p - dz);
    g = 0.5 * vec3(xp - xm, yp - ym, zp - zm);
    d.x = xp + xm - 2.0 * r0;
    d.y = yp + ym - 2.0 * r0;
    d.z = zp + zm - 2.0 * r0;
    e.x = 0.25 * (RhoAt(p + dx + dy) - RhoAt(p + dx - dy) - RhoAt(p - dx + dy) + RhoAt(p - dx - dy));
    e.y = 0.25 * (RhoAt(p + dx + dz) - RhoAt(p + dx - dz) - RhoAt(p - dx + dz) + RhoAt(p - dx - dz));
    e.z = 0.25 * (RhoAt(p + dy + dz) - RhoAt(p + dy - dz) - RhoAt(p - dy + dz) + RhoAt(p - dy - dz));
}

// Eigenvalues of a symmetric 3 x 3 matrix, l.x <= l.y <= l.z (closed form, trigonometric).
vec3 Eigenvalues(vec3 d, vec3 e)
{
    float p1 = e.x * e.x + e.y * e.y + e.z * e.z;
    float q = (d.x + d.y + d.z) / 3.0;
    vec3 dq = d - vec3(q);
    float p2 = dot(dq, dq) + 2.0 * p1;
    if (p2 < 1e-20) return vec3(q);
    float p = sqrt(p2 / 6.0);
    vec3 bd = dq / p; vec3 be = e / p;
    float det = bd.x * (bd.y * bd.z - be.z * be.z) - be.x * (be.x * bd.z - be.z * be.y) + be.y * (be.x * be.z - bd.y * be.y);
    float r = clamp(0.5 * det, -1.0, 1.0);
    float phi = acos(r) / 3.0;
    float l3 = q + 2.0 * p * cos(phi);
    float l1 = q + 2.0 * p * cos(phi + 2.0943951);
    float l2 = 3.0 * q - l1 - l3;
    return vec3(l1, l2, l3);
}

// Eigenvector of eigenvalue lam, in cell units: the largest cross product of two rows of (H - lam I).
vec3 Eigenvector(vec3 d, vec3 e, float lam)
{
    vec3 r0 = vec3(d.x - lam, e.x, e.y);
    vec3 r1 = vec3(e.x, d.y - lam, e.z);
    vec3 r2 = vec3(e.y, e.z, d.z - lam);
    vec3 c0 = cross(r0, r1), c1 = cross(r0, r2), c2 = cross(r1, r2);
    float n0 = dot(c0, c0), n1 = dot(c1, c1), n2 = dot(c2, c2);
    vec3 v = c0; float n = n0;
    if (n1 > n) { v = c1; n = n1; }
    if (n2 > n) { v = c2; n = n2; }
    if (n < 1e-30) return vec3(0.0);
    return v * inversesqrt(n);
}

// Ridge test (pass 3 filaments, pass3-filaments.md F4.3): l1, l2 < -kappa rho and |l3| < 0.8 |l2|.
// dir = spine direction px (unit), sign free. corr = the Newton step back onto the ridge in the plane
// at right angles to the spine, px, at most half a cell. The seed uses _KappaSeed. A trace step uses
// _KappaKeep (half of it), so a tube crosses a weak stretch of ridge (hysteresis).
bool RidgeFrame(vec3 p, float kappa, out vec3 dir, out vec3 corr)
{
    float r0; vec3 g; vec3 d; vec3 e;
    Hessian(p, r0, g, d, e);
    vec3 l = Eigenvalues(d, e);
    dir = vec3(0.0); corr = vec3(0.0);
    if (!(r0 > 0.0)) return false;
    if (!(l.x < -kappa * r0 && l.y < -kappa * r0 && abs(l.z) < 0.8 * abs(l.y))) return false;
    vec3 v = Eigenvector(d, e, l.z) * _Cell;      // cell units to px
    float n = length(v);
    if (n < 1e-20) return false;
    dir = v / n;
    vec3 e1 = Eigenvector(d, e, l.x), e2 = Eigenvector(d, e, l.y);
    vec3 dc = -(dot(e1, g) / l.x) * e1 - (dot(e2, g) / l.y) * e2;      // cells
    vec3 cp = dc * _Cell;
    float cl = length(cp), cMax = 0.5 * min(_Cell.x, min(_Cell.y, _Cell.z));
    corr = (cl > cMax) ? cp * (cMax / cl) : cp;
    return true;
}
bool Ridge(vec3 p, out vec3 dir) { vec3 c; return RidgeFrame(p, _KappaKeep, dir, c); }
// V family (code 5, attempt 2): the tangent is the frozen velocity. A V tube stops where rho < _FlowRho.
bool FlowDir(vec3 p, out vec3 dir)
{
    vec4 v = VelAt(p);
    float n = length(v.xyz);
    dir = vec3(0.0);
    if (n < 1e-6 || !(v.w >= _FlowRho)) return false;
    dir = v.xyz / n;
    return true;
}
bool TubeDir(vec3 p, bool flow, out vec3 dir) { if (flow) return FlowDir(p, dir); return Ridge(p, dir); }

// The sign rule for the first F step: the component with the largest magnitude is positive.
vec3 Canonical(vec3 v)
{
    vec3 a = abs(v);
    float s = (a.x >= a.y && a.x >= a.z) ? v.x : ((a.y >= a.z) ? v.y : v.z);
    return s < 0.0 ? -v : v;
}

vec3 LatticePoint(int slot)
{
    int nx = _LatticeN.x, ny = _LatticeN.y;
    int i = slot - (slot / nx) * nx;
    int jk = slot / nx;
    int j = jk - (jk / ny) * ny;
    int k = jk / ny;
    return (vec3(float(i), float(j), float(k)) + 0.5) * _Lattice;
}
`;

// Seed draw. S has priority: a lattice point that passes both tests becomes an S strand.
// F seeds (pass3-filaments.md F3.1, F4.2): a ridge point is a seed only where its physical weight
// w_R = smoothstep(0.02, 0.2, kappa) smoothstep(0.3, 3.0, rho), kappa = -l2 / rho, is above the ordered
// (Bayer 4 x 4 x 4) threshold of its lattice cell. Dense, sharp ridges seed at every cell, diffuse gas
// at few, on regular sub-lattices. No hash, no jitter.
export const STRAND_SEED_FS = HEAD + `
int BayerLevel(ivec3 a) { return 4 * (a.x ^ a.z) + 2 * (a.y ^ a.z) + a.z; }
float Bayer3(ivec3 c) { int m = 8 * BayerLevel(c & 1) + BayerLevel((c >> 1) & 1); return (float(m) + 0.5) / 64.0; }
float SeedWeight(vec3 p)
{
    float r0; vec3 g; vec3 d; vec3 e;
    Hessian(p, r0, g, d, e);
    vec3 l = Eigenvalues(d, e);
    float kappa = -l.y / max(r0, 1e-6);
    return smoothstep(0.02, 0.2, kappa) * smoothstep(0.3, 3.0, r0);
}
void main()
{
    int slot = SlotOf();
    o = vec4(0.0);
    if (slot >= SLOTS) return;
    vec3 p = LatticePoint(slot);
    vec4 ion = IonAt(p);
    float bMin = ion.x, bHe = ion.y, g = ion.z;
    if (_EnableS != 0 && abs(bMin - 1.0) < _SBand && g > 0.05 * _GRef && RhoAt(p) >= _RhoStop)
    {
        float code = (bHe < 1.0) ? 2.0 : 1.0;
        o = vec4(p, EncodeW(code, 0.15 * g / _GRef));
        return;
    }
    vec3 dir; vec3 corr;
    int nx = _LatticeN.x, ny = _LatticeN.y;
    ivec3 cell = ivec3(slot - (slot / nx) * nx, (slot / nx) - ((slot / nx) / ny) * ny, (slot / nx) / ny);
    if (_EnableF != 0 && RidgeFrame(p, _KappaSeed, dir, corr) && SeedWeight(p) > Bayer3(cell))
    {
        p += corr;
        float code = (g > 0.2 * _GDiss) ? 3.0 : 4.0;
        o = vec4(p, EncodeW(code, 0.10 * g / _GRef));
        return;
    }
    // V seeds (attempt 2): mass-weighted streamlines. The tube length per volume follows rho, so the dense
    // gas fills with flux tubes along the flow. Weight below every ridge seed, so ridges win the dedupe.
    float rho = RhoAt(p);
    if (_EnableF != 0 && smoothstep(_FlowRho, 8.0 * _FlowRho, rho) > Bayer3(cell) && length(VelAt(p).xyz) > 1e-6)
        o = vec4(p, EncodeW(5.0, 0.001 * min(rho, 9.0)));
}
`;

// S step draw. Point 0 is the launch point. Point p >= 1 is one RK2 (midpoint) step of _StepPx from
// point p - 1 along the frozen velocity. A slot that is not S writes 0, so the S pass sets every row.
export const STRAND_S_FS = HEAD + `
void main()
{
    int slot = SlotOf();
    o = vec4(0.0);
    if (slot >= SLOTS) return;
    if (_From < 0)
    {
        vec4 s = SeedOf(slot);
        float c = CodeOf(s.w);
        if (s.w >= 1.0 && c < 2.5) o = s;
        return;
    }
    vec4 a = Hist(_From, slot);
    float c = CodeOf(a.w);
    if (!(a.w >= 1.0 && c < 2.5)) return;
    vec3 v1 = VelAt(a.xyz).xyz;
    float n1 = length(v1);
    if (n1 < 1e-6) return;
    vec3 m = a.xyz + 0.5 * _StepPx * (v1 / n1);
    vec3 v2 = VelAt(m).xyz;
    float n2 = length(v2);
    if (n2 < 1e-6) return;
    vec3 b = a.xyz + _StepPx * (v2 / n2);
    if (!InBoxYZ(b)) return;
    if (RhoAt(b) < _RhoStop) return;
    o = vec4(b, a.w);
}
`;

// F step draw. Point 16 is the seed. Points 17 .. 31 step forward from p - 1, points 15 .. 0 step
// backward from p + 1, along the eigenvector of l3 (RK2, midpoint). The direction keeps the sign of the
// last step. A slot that is not F keeps its history value (the S pass result or 0).
export const STRAND_F_FS = HEAD + `
void main()
{
    int slot = SlotOf();
    o = vec4(0.0);
    if (slot >= SLOTS) return;
    vec4 seed = SeedOf(slot);
    bool isF = seed.w >= 1.0 && CodeOf(seed.w) > 2.5;
    if (!isF) { o = Hist(_Point, slot); return; }
    if (_From < 0) { o = seed; return; }
    vec4 a = Hist(_From, slot);
    if (!(a.w >= 1.0)) return;
    bool flow = CodeOf(seed.w) > 4.5;
    vec3 ref;
    if (_Prev >= 0)
    {
        vec4 q = Hist(_Prev, slot);
        ref = a.xyz - q.xyz;
    }
    else
    {
        vec3 d0;
        if (!TubeDir(a.xyz, flow, d0)) return;
        ref = _DirSign * (flow ? d0 : Canonical(d0));
    }
    vec3 d1;
    if (!TubeDir(a.xyz, flow, d1)) return;
    if (dot(d1, ref) < 0.0) d1 = -d1;
    vec3 m = a.xyz + 0.5 * _StepPxF * d1;
    vec3 d2;
    if (!TubeDir(m, flow, d2)) return;
    if (dot(d2, d1) < 0.0) d2 = -d2;
    vec3 b = a.xyz + _StepPxF * d2;
    if (!InBoxYZ(b)) return;
    vec3 d3; vec3 c3;
    if (flow) { if (!FlowDir(b, d3)) return; }
    else
    {
        if (!RidgeFrame(b, _KappaKeep, d3, c3)) return;
        b += c3;                                   // corrector: back onto the ridge
    }
    if (!InBoxYZ(b)) return;
    o = vec4(b, a.w);
}
`;

// Strand fetch text for the slab shell (A7). The shell declares nothing of this; include it after the
// prelude. strandSegs: RGBA32F, 4096 texels wide, 2 texels per segment:
//   texel 2 i     = (ax, ay, bx, by) in slab texels (the shell's texel centre is t + 0.5)
//   texel 2 i + 1 = (channel, weight, absorb, slab)
// channel: 0 He, 1 H, 2 Front, 3 PAH, 4 H2, 5 Shock, 6 Ejecta, 7 Scatter (the order of 2.11.1).
// strandTiles: RGBA32F, 4096 texels wide, one texel per tile = (first segment, count, slab, 0).
// The tile of slab texel t is _StrandTileBase + (t.y / 32) * _StrandTilesX + t.x / 32.
// _StrandTileBase and _StrandTilesX come from binStrands().perSlab[slab].
export const STRAND_FETCH_GLSL = `
uniform highp sampler2D _StrandSegs;
uniform highp sampler2D _StrandTiles;
uniform int _StrandTileBase;
uniform int _StrandTilesX;
ivec2 StrandTexel(int i) { return ivec2(i & 4095, i >> 12); }
// (first, count) of the tile that holds slab texel t.
ivec2 StrandTile(ivec2 t)
{
    int idx = _StrandTileBase + (t.y >> 5) * _StrandTilesX + (t.x >> 5);
    vec4 v = texelFetch(_StrandTiles, StrandTexel(idx), 0);
    return ivec2(int(v.x + 0.5), int(v.y + 0.5));
}
void StrandSeg(int i, out vec4 ends, out vec4 data)
{
    ends = texelFetch(_StrandSegs, StrandTexel(2 * i), 0);
    data = texelFetch(_StrandSegs, StrandTexel(2 * i + 1), 0);
}
// Exact distance (texels) from point q to segment a-b.
float StrandDist(vec2 q, vec2 a, vec2 b)
{
    vec2 ab = b - a;
    float l2 = dot(ab, ab);
    float u = l2 > 0.0 ? clamp(dot(q - a, ab) / l2, 0.0, 1.0) : 0.0;
    return length(q - (a + u * ab));
}
`;
