// jfa.glsl.js: the fragment shells of the jump flood on the ionization front (WebGL2).
// Owner: row A5. Spec: nebula-spec.md 2.13.5, 2.11.3, 2.2 (Seed, Jd, Jr).
//
// Exports (grep -n "^export"):
//   JFA_INIT_FS     _LA -> Seed: linear zero crossing of f = log B_min (zero set B_min = 1) toward each
//                   of the 6 neighbours.
//                   The nearer crossing on each axis is an axis intercept of the local front plane.
//                   Seed = (offset xyz px from the voxel centre to the foot point on that plane, valid)
//   JFA_JUMP_FS     _Src -> Seed: self and 26 neighbours at _K voxels; keep the seed nearest to this voxel
//   JFA_RESOLVE_FS  _Src, _LA -> Jd = (seed offset xyz px, d px). Two iterations: Newton onto the
//                   front, foot on the tangent plane, Newton onto the front again (42 trilinear reads
//                   of _LA). Newton uses f with the trilinear second-order error removed (FGrad).
//                   d = sign(f) |offset|, clamped to +-256. If a step is too long (a clamp jump in B),
//                   the refinement stops and keeps the last good point.
//                   d < 0 on the ionized side (f < 0). No seed: offset 0 and d = sign(f) 256
//   JFA_CURV_FS     _Jd -> Jr = 2 / max(|lap d|, 1/200), clamped to [4, 400] px
//
// Distances are in px, because the cells are anisotropic. The seeds are offsets relative to the voxel
// centre, so RGBA16F holds them with 0.125 px precision at 256 px. x is periodic. y and z are open:
// a neighbour outside the grid is skipped (Init, Jump) or replaced by the edge voxel (Curv).
// The integer x wrap below uses a compare, not the remainder operator, because |_K| < the grid width.

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler3D;
uniform int _Slice;
uniform ivec3 _Dims;
uniform vec3 _Cell;
out vec4 oA;

int WrapX(int x) { return x < 0 ? x + _Dims.x : (x >= _Dims.x ? x - _Dims.x : x); }
bool InYZ(int3 n) { return n.y >= 0 && n.z >= 0 && n.y < _Dims.y && n.z < _Dims.z; }
int3 Texel() { return int3(int2(gl_FragCoord.xy), _Slice); }

// The front function. Its zero set is B_min = 1, the same as f = B_min - 1 (2.13.5). The log form
// interpolates better: B grows as r^3 in uniform gas and jumps to the 60000 clamp in a shadow,
// and the linear interpolation of log B moves the zero much less than that of B - 1.
float FOfB(float b) { return log(max(b, 1.0e-6)); }
`;

export const JFA_INIT_FS = HEAD + `
uniform highp sampler3D _LA;

float FAt(int3 n) { return FOfB(FETCH3D(_LA, n).x); }

void main()
{
    int3 c = Texel();
    float f = FAt(c);
    // Per axis: the signed px distance q to the nearer of the two linear zero crossings, as 1 / q.
    // 0 means no crossing on that axis.
    float3 inv = float3(0.0, 0.0, 0.0);
    float3 bestQ = float3(1.0e9, 1.0e9, 1.0e9);
    for (int i = 0; i < 6; i++)
    {
        int axis = i / 2;
        int sgn = (i - 2 * axis) == 0 ? 1 : -1;
        int3 n = c;
        if (axis == 0) n.x = WrapX(c.x + sgn);
        if (axis == 1) n.y = c.y + sgn;
        if (axis == 2) n.z = c.z + sgn;
        if (!InYZ(n)) continue;
        float fn = FAt(n);
        if ((f < 0.0) == (fn < 0.0)) continue;
        float t = max(f / (f - fn), 0.001);                     // 0 at c, 1 at n
        float cellA = axis == 0 ? _Cell.x : (axis == 1 ? _Cell.y : _Cell.z);
        float q = float(sgn) * t * cellA;
        if (axis == 0 && abs(q) < bestQ.x) { bestQ.x = abs(q); inv.x = 1.0 / q; }
        if (axis == 1 && abs(q) < bestQ.y) { bestQ.y = abs(q); inv.y = 1.0 / q; }
        if (axis == 2 && abs(q) < bestQ.z) { bestQ.z = abs(q); inv.z = 1.0 / q; }
    }
    float m2 = dot(inv, inv);
    // The crossings are the axis intercepts of the local front plane x/qx + y/qy + z/qz = 1.
    // The seed is the foot of the perpendicular from the voxel centre: inv / |inv|^2.
    oA = m2 > 0.0 ? float4(inv / m2, 1.0) : float4(0.0, 0.0, 0.0, 0.0);
}
`;

export const JFA_JUMP_FS = HEAD + `
uniform highp sampler3D _Src;
uniform int _K;

void main()
{
    int3 c = Texel();
    float best = 1.0e9;
    float3 off = float3(0.0, 0.0, 0.0);
    for (int dz = -1; dz <= 1; dz++)
    for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++)
    {
        int3 n = int3(WrapX(c.x + dx * _K), c.y + dy * _K, c.z + dz * _K);
        if (!InYZ(n)) continue;
        float4 s = FETCH3D(_Src, n);
        if (s.w < 0.5) continue;
        // Offset from this voxel centre to the seed of n. The x step is k cells, the minimum image,
        // because k cells is less than half the box.
        float3 o = float3(float(dx * _K), float(dy * _K), float(dz * _K)) * _Cell + s.xyz;
        float l = dot(o, o);
        if (l < best) { best = l; off = o; }
    }
    oA = best < 1.0e8 ? float4(off, 1.0) : float4(0.0, 0.0, 0.0, 0.0);
}
`;

export const JFA_RESOLVE_FS = HEAD + `
uniform highp sampler3D _Src;
uniform highp sampler3D _LA;

// Raw B_min, trilinear, at a px position. x repeats (the sampler wraps), y and z clamp.
float BLin(float3 q, float3 box) { return SAMPLE3D(_LA, q / box).x; }

// f and grad f at q, from 7 trilinear reads of B (q and +-1 cell on each axis).
// Trilinear reconstruction has a second-order error: at the fraction t of a cell on axis i, it is
// t (1 - t) / 2 h_i^2 B_ii too high. B grows as r^3, so B_ii is large at the front, and the error
// moves the zero by up to 2 px at 40 px cells. The function removes this error with the central
// second difference h_i^2 B_ii, then takes f = log B, so the Newton step finds the zero of the
// smooth field. The correction is limited to half of B, so that a clamp jump cannot make B negative.
// Returns (grad f, corrected f).
float4 FGrad(float3 q, float3 box)
{
    float b0 = BLin(q, box);
    float3 bp = float3(BLin(q + float3(_Cell.x, 0.0, 0.0), box), BLin(q + float3(0.0, _Cell.y, 0.0), box), BLin(q + float3(0.0, 0.0, _Cell.z), box));
    float3 bm = float3(BLin(q - float3(_Cell.x, 0.0, 0.0), box), BLin(q - float3(0.0, _Cell.y, 0.0), box), BLin(q - float3(0.0, 0.0, _Cell.z), box));
    float3 t = fract(q / _Cell - float3(0.5, 0.5, 0.5));
    float3 d2 = bp + bm - 2.0 * b0;                             // h_i^2 B_ii
    float corr = clamp(dot(t * (float3(1.0, 1.0, 1.0) - t) * 0.5, d2), -0.5 * b0, 0.5 * b0);
    float3 g = float3(FOfB(bp.x) - FOfB(bm.x), FOfB(bp.y) - FOfB(bm.y), FOfB(bp.z) - FOfB(bm.z)) / (2.0 * _Cell);
    return float4(g, FOfB(b0 - corr));
}

void main()
{
    int3 c = Texel();
    float f = FOfB(FETCH3D(_LA, c).x);
    float sg = f < 0.0 ? -1.0 : 1.0;
    float4 s = FETCH3D(_Src, c);
    if (s.w < 0.5) { oA = float4(0.0, 0.0, 0.0, 256.0 * sg); return; }
    // Foot-point refinement, two iterations. The seed is a point sample of the front, l px to the
    // side of the true foot point, so |offset| is too long by about l^2 / (2 |d|).
    // Each iteration: (1) one Newton step along grad f puts the point on the front; (2) the point
    // moves to the foot of the perpendicular on the tangent plane there; (3) one more Newton step
    // puts it back on the front. On a front of radius R, each iteration multiplies the side error
    // by about |d| / R. A step longer than its limit (a clamp jump in B) stops the refinement and
    // keeps the last good point.
    float3 box = _Cell * float3(float(_Dims.x), float(_Dims.y), float(_Dims.z));
    float3 p = (float3(float(c.x), float(c.y), float(c.z)) + float3(0.5, 0.5, 0.5)) * _Cell;
    float3 off = s.xyz;
    float cellMax = max(_Cell.x, max(_Cell.y, _Cell.z));
    for (int it = 0; it < 2; it++)
    {
        float4 fg0 = FGrad(p + off, box);
        float g0l = dot(fg0.xyz, fg0.xyz);
        if (g0l < 1.0e-12) break;
        float3 on = off - fg0.xyz * (fg0.w / g0l);
        if (length(on - off) > 0.5 * cellMax) on = off;
        float4 fgn = FGrad(p + on, box);
        float gnl = dot(fgn.xyz, fgn.xyz);
        if (gnl < 1.0e-12) { off = on; break; }
        float3 n0 = fgn.xyz * rsqrt(gnl);                       // toward the neutral side
        float dp = dot(-on, n0);                                // signed distance to the plane
        if (dp * sg <= 0.0) { off = on; break; }
        float3 o1 = -dp * n0;                                   // foot on the plane
        if (length(o1 - on) > 2.0 * cellMax) { off = on; break; }
        float4 fg1 = FGrad(p + o1, box);
        float g1l = dot(fg1.xyz, fg1.xyz);
        float3 o2 = g1l > 1.0e-12 ? o1 - fg1.xyz * (fg1.w / g1l) : o1;
        off = length(o2 - o1) < 0.5 * cellMax ? o2 : o1;
    }
    float dist = length(off);
    oA = float4(off, sg * min(dist, 256.0));
}
`;

export const JFA_CURV_FS = HEAD + `
uniform highp sampler3D _Jd;

float DAt(int3 n)
{
    n.x = WrapX(n.x);
    n.y = clamp(n.y, 0, _Dims.y - 1);
    n.z = clamp(n.z, 0, _Dims.z - 1);
    return FETCH3D(_Jd, n).w;
}

void main()
{
    int3 c = Texel();
    float d = DAt(c);
    float lap = (DAt(c + int3(1, 0, 0)) + DAt(c - int3(1, 0, 0)) - 2.0 * d) / (_Cell.x * _Cell.x)
              + (DAt(c + int3(0, 1, 0)) + DAt(c - int3(0, 1, 0)) - 2.0 * d) / (_Cell.y * _Cell.y)
              + (DAt(c + int3(0, 0, 1)) + DAt(c - int3(0, 0, 1)) - 2.0 * d) / (_Cell.z * _Cell.z);
    float rc = clamp(2.0 / max(abs(lap), 1.0 / 200.0), 4.0, 400.0);
    oA = float4(rc, 0.0, 0.0, 1.0);
}
`;
