// prelight.glsl.js: the WebGL2 shells of the pre-light stage (spec 2.13.6, 3.2) and the Preview
// kernel (2.12). Row A7. Revision 3: it replaces slab.glsl.js.
//
// WHAT: four fragment shells. They hold only texture reads, uniforms and loops. All the physics
//   comes from the shared text NEBULA_MATH (row A2): MediumVolume, MediumMid, SkinTerms, StepWeight,
//   FrontSharpenOffset, NIonFromSeed, KSeedOf, Wrap and PalNorm.
// ORDER of each fragment source: "#version 300 es", PRELUDE (program() adds it), precision,
//   uniforms, the NM_* defines, STAR_COLOUR, NEBULA_MATH, then this shell code.
//
// EXPORTS (grep -n "^export"):
//   STATS_FS      every 4th voxel per axis into 2 RGBA32F targets: (j rgb, sigma), (A_E, A_P, A_2, d).
//                 The CPU takes the percentiles of 3.2 from the readback.
//   PRELIGHT_FS   one voxel of the tier grid per fragment, one draw per z-layer. Target 0: Vol
//                 (RGBA16F) = (j x _VolScale, sigma x _SigScale). Target 1: SkinD (R8) = d code.
//   SKINPACK_FS   one cell of the half grid per fragment: SkinA (RGBA8) = log2 codes of A_E, A_P, A_2, rho_n.
//   PREVIEW_FS    the Preview kernel of 2.12: full depth 0-1920, straight z columns, one sample per texel.
//
// UNIFORMS (grep -n "^uniform" in the strings below)
//   _Opt _S _LA _LB _Amb _Jd _Jr   bake 3D textures, LINEAR, x repeat, y and z clamp (2.1)
//   _BoxPx (5760, 1080, 1920)      _LADims   texel dims of _LA, for the nearest read of the dominant star
//   _CellPx (px per voxel of the output grid)  _Step (4 for Stats, 1 for Prelight, 2 for SkinPack)
//   _VolScale _SigScale _SkinLo _SkinHi   the store scales of 3.2 (Prelight and SkinPack)
//   _OutDims _Exposure _DustBand   the Preview kernel
//   _SrcPos[24] _SrcQ[24] _SrcCount   light sources: (x, y, z px, Qhat), (QhatFUV, 0, 0, 0)
//   _JetPos[4] _JetAxis[4] _JetCount  jet lobe boxes: (x, y, z px, lobe px), (axis xyz, half width px)
//   _PalHe _PalH _PalFront _PalPAH _PalH2 _PalShock _PalEjecta _ScatterBias _CIsrf
//   _MaskA _MaskB _WVolA _WVolB _WSkinA _WSkinB   (the NM_* contract of nebula-math.hlsli)

import { STAR_COLOUR } from '../../shaders/star-colour.glsl.js';
import { NEBULA_MATH } from '../../shaders/nebula-math.glsl.js';

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler3D; precision highp sampler2D;
`;

// Palette, channel mask and weights as uniforms. The shared text reads them through the NM_* names.
const LOOK_UNIFORMS = `
uniform vec3 _PalHe; uniform vec3 _PalH; uniform vec3 _PalFront; uniform vec3 _PalPAH;
uniform vec3 _PalH2; uniform vec3 _PalShock; uniform vec3 _PalEjecta; uniform vec3 _ScatterBias; uniform vec3 _CIsrf;
uniform vec4 _MaskA; uniform vec4 _MaskB;
uniform vec4 _WVolA; uniform vec4 _WVolB; uniform vec4 _WSkinA; uniform vec4 _WSkinB;
#define NM_PAL_HE _PalHe
#define NM_PAL_H _PalH
#define NM_PAL_FRONT _PalFront
#define NM_PAL_PAH _PalPAH
#define NM_PAL_H2 _PalH2
#define NM_PAL_SHOCK _PalShock
#define NM_PAL_EJECTA _PalEjecta
#define NM_SCATTER_BIAS _ScatterBias
#define NM_C_ISRF _CIsrf
#define NM_MASK_A _MaskA
#define NM_MASK_B _MaskB
#define NM_W_VOL_A _WVolA
#define NM_W_VOL_B _WVolB
#define NM_W_SKIN_A _WSkinA
#define NM_W_SKIN_B _WSkinB
`;

const SAMPLE_UNIFORMS = `
uniform highp sampler3D _Opt; uniform highp sampler3D _S; uniform highp sampler3D _LA; uniform highp sampler3D _LB;
uniform highp sampler3D _Amb; uniform highp sampler3D _Jd; uniform highp sampler3D _Jr;
uniform vec3 _BoxPx; uniform ivec3 _LADims;
uniform vec4 _SrcPos[24]; uniform vec4 _SrcQ[24]; uniform int _SrcCount;
uniform vec4 _JetPos[4]; uniform vec4 _JetAxis[4]; uniform int _JetCount;
`;

// The shell side of 2.13.0: SampleAt and the jet mask. Values go to the shared functions only.
const SAMPLE_AT = `
float3 UvwOf(float3 p) { return p / _BoxPx; }

// Jet lobe mask (2.11.2): 1 inside the box of each jet (both lobes), with a soft 20 px edge.
float MJet(float3 p)
{
    float m = 0.0;
    for (int j = 0; j < 4; j++)
    {
        if (j >= _JetCount) break;
        float3 r = p - _JetPos[j].xyz;
        r.x = Wrap(r.x + 2880.0, 5760.0) - 2880.0;
        float s = dot(r, _JetAxis[j].xyz);
        float q = length(r - s * _JetAxis[j].xyz);
        float lobe = _JetPos[j].w; float hw = _JetAxis[j].w;
        float inS = 1.0 - smoothstep(lobe - 10.0, lobe + 10.0, abs(s));
        float inQ = 1.0 - smoothstep(hw - 10.0, hw + 10.0, q);
        m = max(m, inS * inQ);
    }
    return m;
}

// One point. Reads: Jd, Jr at pos; Opt, S, LA at q (the front-sharpened point when shift is true, else
// pos: SampleAtNoShift of 2.13.6); LB, Amb at pos; LA (nearest) at the seed; Opt, S at the seed + 3 px
// toward the neutral side.
SampleState SampleAt(float3 posPx, bool shift)
{
    SampleState s;
    float3 p = float3(Wrap(posPx.x, 5760.0), posPx.y, posPx.z);
    s.pos = p;
    float4 jd = SAMPLE3D(_Jd, UvwOf(p));
    s.seedOff = jd.xyz; s.d = jd.w;
    s.rc = max(SAMPLE3D(_Jr, UvwOf(p)).x, 1.0);
    s.nIon = NIonFromSeed(s.seedOff, s.d);
    // Look-dev r1: the normal from the gradient of d over one cell on each side, so it is smooth.
    float3 gd = float3(SAMPLE3D(_Jd, UvwOf(p + float3(10.0, 0.0, 0.0))).w - SAMPLE3D(_Jd, UvwOf(p - float3(10.0, 0.0, 0.0))).w,
                       SAMPLE3D(_Jd, UvwOf(p + float3(0.0, 10.0, 0.0))).w - SAMPLE3D(_Jd, UvwOf(p - float3(0.0, 10.0, 0.0))).w,
                       0.5 * (SAMPLE3D(_Jd, UvwOf(p + float3(0.0, 0.0, 20.0))).w - SAMPLE3D(_Jd, UvwOf(p - float3(0.0, 0.0, 20.0))).w));
    if (dot(gd, gd) > 0.09 * 400.0) s.nIon = -normalize(gd);
    s.seedPos = p + s.seedOff;
    float3 q = p;
    if (shift) q = p + FrontSharpenOffset(s.d, s.rc, s.nIon);
    float2 opt = SAMPLE3D(_Opt, UvwOf(q)).xy;
    float4 sp = SAMPLE3D(_S, UvwOf(q));
    float4 la = SAMPLE3D(_LA, UvwOf(q));
    s.rho = max(opt.x, RHO_FLOOR);
    s.chiD = max(opt.y, 0.0) / s.rho;
    s.chiSh = max(sp.y, 0.0); s.chiEj = max(sp.z, 0.0); s.chiPah = max(sp.w, 0.0);
    s.bMin = la.x; s.bHe = la.y; s.tauDom = la.z; s.dom = la.w;
    float4 lb = SAMPLE3D(_LB, UvwOf(p));
    s.isc = max(lb.xyz, float3(0.0, 0.0, 0.0)); s.gFuv = max(lb.w, 0.0);
    s.amb = SAMPLE3D(_Amb, UvwOf(p)).x;
    // Skin budgets at the seed (2.11.3). The dominant index is read NEAREST, so it is never a blend.
    float3 sd = s.seedPos;
    float3 cf = UvwOf(sd) * float3(_LADims);
    int3 ci = int3(int(floor(Wrap(cf.x, float(_LADims.x)))), int(floor(cf.y)), int(floor(cf.z)));
    ci = clamp(ci, int3(0, 0, 0), _LADims - int3(1, 1, 1));
    float4 laS = FETCH3D(_LA, ci);
    int k = int(floor(laS.w + 0.5));
    float sE = 0.0; float sF = 0.0;
    if (k >= 0 && k < _SrcCount && abs(s.d) < 255.0)
    {
        float3 r = _SrcPos[k].xyz - sd;
        r.x = Wrap(r.x + 2880.0, 5760.0) - 2880.0;
        float rl2 = dot(r, r) * 0.01;                              // r^2 in l^2 (l = 10 px)
        float cospsi = max(0.0, dot(s.nIon, r * rsqrt(max(dot(r, r), 0.000001))));
        float geo = cospsi / max(rl2, 1.0);
        float tauS = max(SAMPLE3D(_LA, UvwOf(sd)).z, 0.0);           // LINEAR: no voxel steps
        sE = _SrcPos[k].w * exp(-4.0 * tauS) * geo;
        sF = _SrcQ[k].x * exp(-3.0 * tauS) * geo;
    }
    s.sEuv = sE; s.sFuv = sF;
    float3 pn = sd - 3.0 * s.nIon;                                 // 3 px toward the neutral side
    s.rhoN = max(SAMPLE3D(_Opt, UvwOf(pn)).x, RHO_FLOOR);
    s.chiPN = max(SAMPLE3D(_S, UvwOf(pn)).w, 0.0);
    s.kSeed = KSeedOf(sd.z);
    s.mJet = MJet(p);
    return s;
}

// The skin amplitudes of 3.2 at the seed of s: (A_E, A_P, A_2, rho_n). The hand-over weights wPv and
// wH2v are folded in, the same as SkinTerms does.
float4 SkinAmps(SampleState s)
{
    float rhoN = max(s.rhoN, RHO_FLOOR);
    float wPv = smoothstep(15.0, 30.0, 141.0 / rhoN);
    float dH2 = clamp(775.0 / rhoN, 3.0, 400.0);
    float wH2v = smoothstep(15.0, 30.0, 1.35 * dH2);            // extent d_H2 + w_H2 = 1.35 d_H2
    return float4(max(s.sEuv, 0.0), (1.0 - wPv) * max(s.chiPN, 0.0) * max(s.sFuv, 0.0),
                  0.3 * (1.0 - wH2v) * max(s.sFuv, 0.0), rhoN);
}

// Voxel centre of the output grid, px. _Step: grid step in output voxels per fragment.
uniform vec3 _CellPx; uniform float _Step; uniform int _Slice;
float3 VoxelCentre()
{
    float3 id = float3(floor(gl_FragCoord.xy), float(_Slice));
    return (id * _Step + float3(0.5, 0.5, 0.5) * _Step) * _CellPx;
}
`;

function source(uniforms, main) {
  return HEAD + SAMPLE_UNIFORMS + LOOK_UNIFORMS + uniforms + STAR_COLOUR + '\n' + NEBULA_MATH + '\n' + SAMPLE_AT + main;
}

// Stats (2.13.6): every 4th voxel per axis. _Step = 4, so the sample sits at the voxel 4 id + 1.5,
// inside the block of 4 voxels that it stands for.
export const STATS_FS = source('', `
layout(location = 0) out vec4 oV;
layout(location = 1) out vec4 oA;
void main()
{
    SampleState s = SampleAt(VoxelCentre(), false);
    Medium m = MediumVolume(s);
    oV = float4(m.jVol, m.sigma);
    float4 a = SkinAmps(s);
    oA = float4(a.xyz, s.d);
}
`);

// Prelight (2.13.6): Vol and SkinD at every voxel centre of the tier grid.
export const PRELIGHT_FS = source('uniform float _VolScale; uniform float _SigScale; uniform highp sampler3D _TubeLen;\n', `
layout(location = 0) out vec4 oVol;
layout(location = 1) out vec4 oD;
void main()
{
    SampleState s = SampleAt(VoxelCentre(), false);
    Medium m = MediumVolume(s);
    float2 take = textureLod(_TubeLen, VoxelCentre() / _BoxPx, 0.0).xy;   // (emission share, dust share) of the tubes
    oVol = min(float4(m.jVol * (_VolScale * (1.0 - take.x)), m.sigma * (_SigScale * (1.0 - take.y))), float4(60000.0, 60000.0, 60000.0, 60000.0));
    float c = saturate(2.0 * (s.d + 32.0) / 255.0);           // UNORM8 write rounds to the 0.5 px code
    oD = float4(c, c, c, 1.0);
}
`);

// SkinPack (2.13.6): the log2 codes of the amplitudes on the half grid (_Step = 2).
export const SKINPACK_FS = source('uniform vec3 _SkinLo; uniform vec3 _SkinHi;\n', `
float LogCode(float A, float lo, float hi)
{
    if (A <= 0.0) return 0.0;
    return clamp(1.0 + floor(254.0 * (log2(A) - lo) / (hi - lo) + 0.5), 1.0, 255.0) / 255.0;
}
layout(location = 0) out vec4 oA;
void main()
{
    SampleState s = SampleAt(VoxelCentre(), false);
    float4 a = SkinAmps(s);
    oA = float4(LogCode(a.x, _SkinLo.x, _SkinHi.x), LogCode(a.y, _SkinLo.y, _SkinHi.y),
                LogCode(a.z, _SkinLo.z, _SkinHi.z), LogCode(a.w, -4.0, 7.0));
}
`);

// The Preview kernel (2.12): full depth, one sample at the texel centre, straight z columns, the
// front-sharpened slab march of revision 2 with slab = -1 (every term counts with weight 1).
// _OutDims (1920, 360) covers the whole strip: 3 px per texel.
export const PREVIEW_FS = source('uniform ivec2 _OutDims; uniform float _Exposure; uniform float _DustBand;\n', `
float4 MarchColumn(float xw, float yw, float z0, float z1)
{
    int n = int(ceil((z1 - z0) / 10.0 - 0.001));
    float ds = (z1 - z0) / float(n);
    float3 L = float3(0.0, 0.0, 0.0); float tauV = 0.0;
    SampleState a = SampleAt(float3(xw, yw, z0), true);
    for (int i = 0; i < 256; i++)
    {
        if (i >= n) break;
        float zb = z0 + float(i + 1) * ds;
        SampleState b = SampleAt(float3(xw, yw, zb), true);
        Medium m = MediumMid(a, b);
        float3 jS = SkinTerms(a, b, ds, -1);
        float sig = m.sigma;
        float3 T = exp(-tauV * _DustBand * NM_DUST_K);
        float swt = StepWeight(sig * _DustBand, ds);
        if (a.d * b.d <= 0.0)
        {
            float tc = abs(a.d) / max(abs(a.d) + abs(b.d), 0.0001);
            float sigA = NM_KV * max(a.rho * a.chiD, 0.0);
            swt = ds * exp(-sigA * _DustBand * tc * ds);
        }
        L += T * m.jVol * StepWeight(sig * _DustBand, ds) + T * jS * swt;
        tauV += sig * ds;
        a = b;
    }
    return float4(L, tauV);
}
layout(location = 0) out vec4 oC;
void main()
{
    float2 f = floor(gl_FragCoord.xy) + float2(0.5, 0.5);
    float xw = Wrap(f.x * 5760.0 / float(_OutDims.x), 5760.0);
    float yw = f.y * 1080.0 / float(_OutDims.y);
    float4 r = MarchColumn(xw, yw, 0.0, 1920.0);
    oC = float4(r.xyz * _Exposure, r.w);
}
`);
