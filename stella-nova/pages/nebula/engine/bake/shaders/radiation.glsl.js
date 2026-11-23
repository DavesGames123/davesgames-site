// radiation.glsl.js: the fragment shells of StarRays and AmbientScan (WebGL2).
// Owner: row A5. Spec: nebula-spec.md 2.8, 2.13.4, 2.6 item 3, 2.2 (LA, LB, IonH, RadH, Amb).
//
// Exports (grep -n "^export"):
//   RAYS_HALF_FS   StarRays at half resolution. MRT: 0 = IonH (B_min, B_He, G_FUV, 0), 1 = RadH (a_rad.xyz, 0)
//   RAYS_FULL_FS   StarRays at full resolution. MRT: 0 = LA (B_min, B_He, tau_dom, dom), 1 = LB (I_sc.rgb, G_FUV)
//   AMB_FS         AmbientScan. 0 = Amb (mean of exp(-tau) over the 6 axis directions, capped at 600 px)
//
// Each shell draws one z-layer of a 3D target. The texel is int3(int2(gl_FragCoord.xy), _Slice).
// One draw adds one star. The accumulators ping-pong: the shell reads the previous sum at the same
// texel with FETCH3D (_AccA, _AccB) and writes the new sum. _First = 1 writes the start values
// LA = (60000, 60000, 0, -1), LB = 0 (IonH = (60000, 60000, 0, 0), RadH = 0) and ignores _AccA, _AccB.
//
// Uniforms of the rays shells (radiation.js sets them):
//   _Box (px), _Cell (px of one texel), _StarPx (px, y up, z = depth), _Q = (Qhat, Qhat1, QhatFUV, influence px),
//   _Lum = (teffK, logL), _StepPx, _MaxSteps, _Index (dominant index of this star), _First, _Slice.
//   RAYS_FULL_FS only: _ScatBand = comp.dustBand (the band b of the default palette, 2.11.1) for the scatter path.
// The shell moves the star to the minimum x image of the voxel, so a ray never crosses more than
// half the box in x. The shared MarchToStar wraps each sample in x.
// Half floats: every output is clamped to 60000 (half max 65504), so no inf or NaN gets into min or the JFA.

import { STAR_COLOUR } from '../../shaders/star-colour.glsl.js';
import { NEBULA_MATH } from '../../shaders/nebula-math.glsl.js';

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler3D;
#define NM_HAS_OPT
uniform highp sampler3D _Opt;
`;

const RAYS_UNIFORMS = `
uniform highp sampler3D _AccA;
uniform highp sampler3D _AccB;
uniform int _Slice;
uniform int _First;
uniform vec3 _Box;
uniform vec3 _Cell;
uniform vec3 _StarPx;
uniform vec4 _Q;
uniform vec2 _Lum;
uniform float _StepPx;
uniform int _MaxSteps;
uniform float _Index;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
`;

// Shared part of both rays shells: the march and the per-star terms of 2.8.
const RAYS_CORE = `
const float RAD_CLAMP = 60000.0;
const float F_O = 0.1;                       // [O III] budget share (2.8)
const float C_RAD = 0.001153;                // radiation push constant (2.6 item 3)
const float G_HG = 0.6;                      // HG asymmetry (2.8)
const float FUV_ALBEDO = 0.4;                // FUV dust albedo for the scatter octave of G_FUV (volume body)

struct StarTerms { bool hit; float B; float BHe; float tau; float rl; float3 dir; };

// The terms of this star at voxel centre p. hit is false beyond the influence radius.
StarTerms StarAt(float3 p)
{
    StarTerms st;
    float3 s = _StarPx;
    s.x = p.x + Wrap(s.x - p.x + 0.5 * _Box.x, _Box.x) - 0.5 * _Box.x;   // minimum x image
    float3 toS = s - p;
    float dist = length(toS);
    st.hit = dist <= _Q.w;
    st.dir = toS / max(dist, 0.001);
    st.rl = dist / NM_PX_PER_L;
    st.B = RAD_CLAMP; st.BHe = RAD_CLAMP; st.tau = 0.0;
    if (!st.hit) return st;
    float2 rt = MarchToStar(p, s, _Box, _StepPx, _MaxSteps);
    float att = exp(-4.0 * rt.y);
    st.B = min(rt.x / max(_Q.x * att, 1.0e-20), RAD_CLAMP);
    st.BHe = _Q.y > 0.0 ? min((0.1 / F_O) * rt.x / max(_Q.y * att, 1.0e-20), RAD_CLAMP) : RAD_CLAMP;
    st.tau = min(rt.y, RAD_CLAMP);
    return st;
}

float3 VoxelCentre()
{
    int3 c = int3(int2(gl_FragCoord.xy), _Slice);
    return (float3(float(c.x), float(c.y), float(c.z)) + float3(0.5, 0.5, 0.5)) * _Cell;
}
`;

export const RAYS_HALF_FS = HEAD + RAYS_UNIFORMS + STAR_COLOUR + '\n' + NEBULA_MATH + '\n' + RAYS_CORE + `
void main()
{
    int3 c = int3(int2(gl_FragCoord.xy), _Slice);
    float4 a = float4(RAD_CLAMP, RAD_CLAMP, 0.0, 0.0);
    float4 b = float4(0.0, 0.0, 0.0, 0.0);
    if (_First == 0) { a = FETCH3D(_AccA, c); b = FETCH3D(_AccB, c); }
    float3 p = VoxelCentre();
    StarTerms st = StarAt(p);
    if (st.hit)
    {
        float r2 = max(st.rl * st.rl, 1.0);
        a.x = min(a.x, st.B);
        a.y = min(a.y, st.BHe);
        a.z = min(a.z + _Q.z * exp(-3.0 * st.tau) / r2, RAD_CLAMP);
        float3 push = -st.dir * (C_RAD * _Q.z * exp(-st.tau) / r2);   // away from the star
        b.xyz = clamp(b.xyz + push, float3(-RAD_CLAMP, -RAD_CLAMP, -RAD_CLAMP), float3(RAD_CLAMP, RAD_CLAMP, RAD_CLAMP));
    }
    oA = a;
    oB = b;
}
`;

export const RAYS_FULL_FS = HEAD + RAYS_UNIFORMS + 'uniform float _ScatBand;\n' + STAR_COLOUR + '\n' + NEBULA_MATH + '\n' + RAYS_CORE + `
void main()
{
    int3 c = int3(int2(gl_FragCoord.xy), _Slice);
    float4 a = float4(RAD_CLAMP, RAD_CLAMP, 0.0, -1.0);
    float4 b = float4(0.0, 0.0, 0.0, 0.0);
    if (_First == 0) { a = FETCH3D(_AccA, c); b = FETCH3D(_AccB, c); }
    float3 p = VoxelCentre();
    StarTerms st = StarAt(p);
    if (st.hit)
    {
        float r2 = max(st.rl * st.rl, 1.0);
        if (st.B < a.x) { a.x = st.B; a.z = st.tau; a.w = _Index; }    // argmin over the stars
        a.y = min(a.y, st.BHe);
        float3 F = StarColour(_Lum.x) * pow(10.0, _Lum.y - 4.0);       // 2.8: colour x 10^(logL - 4)
        float mu = st.dir.z;                                           // > 0 for gas in front of the star
        // Volume body (pass 3): the light that the march sees is in the display band b, so its path from the
        // star takes the band extinction b K too (the march already applies b K on the path to the eye).
        // Multiple scattering: octaves n = 0, 1, 2 with weight 0.5^n, extinction 0.5^n and HG g 0.5^n, so
        // a cloud body shades from its lit side into the core and does not stop at a thin shell.
        float3 kb = _ScatBand * NM_DUST_K * st.tau;
        float3 sc = exp(-kb) * HG(mu, G_HG)
                  + 0.5 * exp(-0.5 * kb) * HG(mu, 0.5 * G_HG)
                  + 0.25 * exp(-0.25 * kb) * HG(mu, 0.25 * G_HG);
        float3 isc = F / max(4.0 * NM_PI * st.rl * st.rl, 1.0) * sc;
        b.xyz = min(b.xyz + isc, float3(RAD_CLAMP, RAD_CLAMP, RAD_CLAMP));
        // FUV that dust scatters (albedo about 0.4) reaches deeper into the PDR than the direct beam: one
        // octave at half the optical depth. It feeds the PAH and H2 volume terms through the depth of the PDR.
        b.w = min(b.w + _Q.z * (exp(-3.0 * st.tau) + FUV_ALBEDO * exp(-1.5 * st.tau)) / r2, RAD_CLAMP);
    }
    oA = a;
    oB = b;
}
`;

// AmbientScan (2.8): tau_V along +-x, +-y, +-z from each Amb voxel, capped at _CapPx.
// The steps are one Amb cell long on each axis. Samples outside the box in y or z read empty gas.
// x wraps (periodic box).
export const AMB_FS = HEAD + `
uniform int _Slice;
uniform vec3 _Box;
uniform vec3 _Cell;
uniform float _CapPx;
out vec4 oA;
` + STAR_COLOUR + '\n' + NEBULA_MATH + `
float AxisTau(float3 p, float3 dir, float stepPx)
{
    int n = max(1, int(ceil(_CapPx / stepPx)));
    float ds = _CapPx / float(n);
    float tau = 0.0;
    LOOP for (int i = 0; i < 256; i++)
    {
        if (i >= n) break;
        float3 q = p + dir * ((float(i) + 0.5) * ds);
        if (q.y < 0.0 || q.z < 0.0 || q.y > _Box.y || q.z > _Box.z) break;
        q.x = Wrap(q.x, _Box.x);
        tau += NM_KV * SAMPLE3D(_Opt, q / _Box).y * ds;
    }
    return tau;
}

void main()
{
    int3 c = int3(int2(gl_FragCoord.xy), _Slice);
    float3 p = (float3(float(c.x), float(c.y), float(c.z)) + float3(0.5, 0.5, 0.5)) * _Cell;
    float s = exp(-AxisTau(p, float3(1.0, 0.0, 0.0), _Cell.x)) + exp(-AxisTau(p, float3(-1.0, 0.0, 0.0), _Cell.x))
            + exp(-AxisTau(p, float3(0.0, 1.0, 0.0), _Cell.y)) + exp(-AxisTau(p, float3(0.0, -1.0, 0.0), _Cell.y))
            + exp(-AxisTau(p, float3(0.0, 0.0, 1.0), _Cell.z)) + exp(-AxisTau(p, float3(0.0, 0.0, -1.0), _Cell.z));
    oA = float4(s / 6.0, 0.0, 0.0, 1.0);
}
`;
