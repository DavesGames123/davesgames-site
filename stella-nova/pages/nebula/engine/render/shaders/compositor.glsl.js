// compositor.glsl.js: the WebGL2 shell of the star map compositor (the oblique march). Row A9.
// Spec: nebula-spec.md 3.1, 3.4.1, 6.5 (artifact difference), 7.4 (table). Revision 3.
//
// The shell declares the uniforms of 6.5, the volume samplers, the _Data texture and the data macros.
// Then it appends STAR_COLOUR, NEBULA_MATH (row A2) and COMPOSITE (shared/starmap-composite.hlsli,
// generated). program() in js/gl/context.js puts PRELUDE after the "#version" line.
//
// Volume set (3.2): _Vol RGBA16F, _SkinD R8, _SkinA RGBA8 (3D, LINEAR, x repeat, y and z clamp).
// Strand store (3.2.2): _StrandSeg RGBA16F 1024 wide, _StrandBin RGBA8 512 x 729 (NEAREST, texelFetch).
// _Data: RGBA32F, 256 x 4, read by texelFetch (3.4.1).
//   row 0: stars, 2 texels each (128 stars), nearest first   row 1: objects, 4 texels each (16 used)
//   row 2: star light of this frame (F_r, F_g, F_b, F_lum), one texel per star (11.3, lightcurve.js)
//   row 3: fog circles 0-15 (x, y, r, 0)
// Skin and strand look (palette, mask, weights) are uniforms, so a skin palette change needs no rebake.
//
// Artifact-only uniforms (not in Unity): _TimeY (page clock, s), _StarAnim (1 when the star light curves
//   and the flares run), _TargetSize (draw target px),
//   _Layers (gas, embedded stars, catalogue stars, deep stars), _Flags (objects, gray, sRGB out, 0).
//
// Grep targets: COMPOSITOR_SHELL, compositorSource, specOn, COMPOSITOR_FS

import { STAR_COLOUR } from '../../shaders/star-colour.glsl.js';
import { NEBULA_MATH } from '../../shaders/nebula-math.glsl.js';
import { COMPOSITE } from '../../shaders/composite.glsl.js';
import { constDecl } from '../lab-consts.js';

export const COMPOSITOR_SHELL = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

uniform highp sampler3D _Vol;
uniform highp sampler3D _SkinD;
uniform highp sampler3D _SkinA;
// Lab round 3: the fine box atlas (RG8). For each box k: _FineBO (px origin, on), _FineBE (px size),
// _FineBD (ship dims, atlas x cell), _FineBC (sigMax, luma log2 lo, hi), _FineBL / _FineBH (blend faces).
// _FineOn = (on, blend px, box count, 0), _FineAtlas = (atlas dims, box count).
uniform highp sampler3D _FineM;
uniform vec4 _FineBO[3]; uniform vec4 _FineBE[3]; uniform vec4 _FineBD[3]; uniform vec4 _FineBC[3];
uniform vec4 _Hot[16]; uniform vec4 _HotOn; uniform vec4 _LabStars;   // lab part 3
uniform highp sampler3D _LabNoise; uniform vec4 _LabErode; uniform vec4 _LabErode2; uniform vec4 _LabCirrus; uniform vec4 _LabMisc;   // lab part 5
uniform vec4 _LabZ[12]; uniform vec4 _Proto[12]; uniform vec4 _ProtoOn;   // cold filament section   // lab zone colours from the palette (lab-zones.js)
uniform vec4 _LabTint; uniform vec4 _LabAcc; uniform vec4 _LabR3; uniform vec4 _LabR4;   // lab part 5 rounds 2, 3, 4
uniform vec4 _FineBL[3]; uniform vec4 _FineBH[3]; uniform vec4 _FineOn; uniform vec4 _FineAtlas;
uniform highp sampler2D _StrandSeg;
uniform highp sampler2D _StrandBin;
uniform highp sampler2D _Data;

uniform float _ScrollX;
uniform vec4 _View;
uniform float _DustBand;
uniform float _E0;
uniform vec3 _VolDims;
uniform vec2 _VolDec;
uniform vec3 _SkinLo;
uniform vec3 _SkinHi;
uniform vec2 _StrandFamily;
uniform float _StrandAbsorb;
uniform float _ExposureOffsetEv;
uniform float _ExposureTrimEv;
uniform float _AnimScale;
uniform float _DebugView;
uniform vec2 _DebugZ;
uniform float _FogChromaLoss;
uniform float _FogCount;
uniform vec4 _DeepGlow;
uniform float _Dither;
uniform float _StretchOff;
uniform float _StarCount;
uniform float _ObjectCount;

uniform vec3 _PalHe; uniform vec3 _PalH; uniform vec3 _PalFront; uniform vec3 _PalPAH;
uniform vec3 _PalH2; uniform vec3 _PalShock; uniform vec3 _PalEjecta;
uniform vec4 _MaskA; uniform vec4 _MaskB; uniform vec4 _WSkinA; uniform vec4 _WSkinB;

uniform float _TimeY;
uniform float _StarAnim;
uniform vec2 _TargetSize;
uniform vec4 _Layers;
uniform vec4 _Flags;

#define NM_PAL_HE _PalHe
#define NM_PAL_H _PalH
#define NM_PAL_FRONT _PalFront
#define NM_PAL_PAH _PalPAH
#define NM_PAL_H2 _PalH2
#define NM_PAL_SHOCK _PalShock
#define NM_PAL_EJECTA _PalEjecta
#define NM_MASK_A _MaskA
#define NM_MASK_B _MaskB
#define NM_W_SKIN_A _WSkinA
#define NM_W_SKIN_B _WSkinB

#define VOL(uvw) textureLod(_Vol, (uvw), 0.0)
#define SKIND(uvw) textureLod(_SkinD, (uvw), 0.0)
#define SKINA(uvw) textureLod(_SkinA, (uvw), 0.0)
#define FINEM(uvw) textureLod(_FineM, (uvw), 0.0)
#define LABN(uvw) textureLod(_LabNoise, (uvw), 0.0)
#define STRANDBIN(i) texelFetch(_StrandBin, ivec2((i) - ((i) / 512) * 512, (i) / 512), 0)
#define STRANDSEG(i) texelFetch(_StrandSeg, ivec2((i) - ((i) / 1024) * 1024, (i) / 1024), 0)
#define STAR(i) texelFetch(_Data, ivec2((i), 0), 0)
#define OBJ(i) texelFetch(_Data, ivec2((i), 1), 0)
#define FOGC(i) texelFetch(_Data, ivec2((i), 3), 0)
#define STARVAR(i) texelFetch(_Data, ivec2((i), 2), 0)
#define SM_FLARE_ON (_StarAnim)
#define SM_TIME (_TimeY * _AnimScale)
#define SM_GAS_ON (_Layers.x)
#define SM_EMB_ON (_Layers.y)
#define SM_CAT_ON (_Layers.z)
#define SM_DEEP_ON (_Layers.w)
#define SM_OBJ_ON (_Flags.x)
#define SM_GRAY (_Flags.y)
#define SM_SRGB_OUT (_Flags.z)
`;

// Star pass upscale (artifact only). UpscaleGas reads the linear march target _GasLo at the output pixel P
// (px, pixel centres at +0.5). The march grid has an offset jit (march px). The filter is a 4 x 4 Lanczos-2
// with a clamp to the minimum and maximum of the 2 x 2 nearest texels, so an edge gets no ringing halo.
const UPSCALE = `
float SmLz2(float x)
{
    x = abs(x);
    if (x < 0.0001) return 1.0;
    if (x >= 2.0) return 0.0;
    float p = 3.14159265 * x;
    return 2.0 * sin(p) * sin(0.5 * p) / (p * p);
}
vec3 UpscaleGas(highp sampler2D lo, vec2 P, vec2 loSize, vec2 outSize, vec2 jit)
{
    vec2 u = P * loSize / outSize - 0.5 - jit;
    vec2 f0 = floor(u); vec2 f = u - f0;
    ivec2 i0 = ivec2(f0), hi = ivec2(loSize) - 1;
    vec3 acc = vec3(0.0), mn = vec3(1e30), mx = vec3(-1e30);
    float ws = 0.0;
    for (int j = -1; j <= 2; j++)
    {
        float wy = SmLz2(float(j) - f.y);
        for (int i = -1; i <= 2; i++)
        {
            float w = SmLz2(float(i) - f.x) * wy;
            vec3 c = texelFetch(lo, clamp(i0 + ivec2(i, j), ivec2(0), hi), 0).rgb;
            if (i >= 0 && i <= 1 && j >= 0 && j <= 1) { mn = min(mn, c); mx = max(mx, c); }
            acc += w * c; ws += w;
        }
    }
    return clamp(acc / ws, mn, mx);
}
`;

// Lab stars: the march of the star pass (SM_STARPASS): the linear composite and the 8 tau knots, 3 targets.
// _MarchJit: the sub-pixel offset of the march grid (march px) for the at-rest accumulation. _OutSize: the
// output size, so xs keeps the output aspect when the march size is rounded.
const MAIN_MARCH = `
uniform vec2 _MarchJit;
uniform vec2 _OutSize;
layout(location = 0) out vec4 o_Color;
layout(location = 1) out vec4 o_TauA;
layout(location = 2) out vec4 o_TauB;
void main()
{
    vec2 uv = (gl_FragCoord.xy + _MarchJit) / _TargetSize;
    float xs = uv.x * _OutSize.x * (1080.0 / _OutSize.y); float ys = uv.y * 1080.0;
    vec3 c = vec3(0.0);
    if (!(_View.x > 2600.0 && abs(xs - 0.5 * _View.x) > 1300.0)) c = Composite(xs, ys);
    o_Color = vec4(c, 1.0);
    o_TauA = SmTauA; o_TauB = SmTauB;
}
`;

// Lab stars: the full-resolution pass. The gas, then StarPass, then the display chain SmDisplay.
// _Up.x = 0: the gas is UpscaleGas of _GasLo (march size _Up.w x _LoH, no offset). _Up.x = 1: the gas is
// the seed _GasSeed (UpscaleGas of the reset march, output size) with a cross sharpen of strength _Up.y,
// clamped to the cross minimum and maximum, blended to the running mean _GasHist by _Up.z times a gate on its
// weight sum. So the first offset frames do not show the sparse sample grid. The tau knots are bilinear from
// _TauLoA / _TauLoB (a march with no offset).
const MAIN_FINISH = `
uniform highp sampler2D _GasLo;
uniform highp sampler2D _GasHist;
uniform highp sampler2D _TauLoA;
uniform highp sampler2D _TauLoB;
uniform highp sampler2D _GasSeed;
uniform vec4 _Up;
uniform vec2 _LoSz;
uniform vec4 _Sh;
out vec4 o_Color;
` + UPSCALE + `
// Cross sharpen of strength sharp, clamped to the cross minimum and maximum. _Sh.y = 1 (sweep 5): the
// strength drops with the local contrast (an adaptive sharpen like CAS), so a hard edge gets less.
vec3 CrossSharpen(highp sampler2D t, ivec2 p, float sharp)
{
    ivec2 hi = ivec2(_TargetSize) - 1;
    vec3 e = texelFetch(t, p, 0).rgb;
    if (sharp <= 0.0) return e;
    vec3 b = texelFetch(t, clamp(p + ivec2(0, 1), ivec2(0), hi), 0).rgb;
    vec3 d = texelFetch(t, clamp(p - ivec2(1, 0), ivec2(0), hi), 0).rgb;
    vec3 f = texelFetch(t, clamp(p + ivec2(1, 0), ivec2(0), hi), 0).rgb;
    vec3 h = texelFetch(t, clamp(p - ivec2(0, 1), ivec2(0), hi), 0).rgb;
    vec3 mn = min(min(min(b, d), min(f, h)), e), mx = max(max(max(b, d), max(f, h)), e);
    if (_Sh.y > 0.5) sharp *= 2.0 * clamp(1.0 - (mx.g - mn.g) / max(mx.g + mn.g, 1e-6), 0.0, 1.0);
    return clamp(e + sharp * (e - 0.25 * (b + d + f + h)), mn, mx);
}
vec3 SeedGas(ivec2 p, float sharp) { return CrossSharpen(_GasSeed, p, sharp); }
void main()
{
    float scale = 1080.0 / _TargetSize.y;
    vec2 px = gl_FragCoord.xy;
    float xs = px.x * scale; float ys = px.y * scale;
    if (_View.x > 2600.0 && abs(xs - 0.5 * _View.x) > 1300.0) { o_Color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 uv = px / _TargetSize;
    vec3 gas;
    if (_Up.x < 0.5) gas = UpscaleGas(_GasLo, px, _LoSz, _TargetSize, vec2(0.0));
    else
    {
        vec4 h = (_Up.z > 0.0) ? texelFetch(_GasHist, ivec2(px), 0) : vec4(0.0);
        float a = _Up.z * smoothstep(0.0, 0.15, h.a);
        if (_Sh.x > 0.0 && a > 0.0) h.rgb = CrossSharpen(_GasHist, ivec2(px), _Sh.x * a);
        gas = (a >= 1.0) ? h.rgb : mix(SeedGas(ivec2(px), _Up.y), h.rgb, a);
    }
    vec3 c = gas + StarPass(xs, ys, textureLod(_TauLoA, uv, 0.0), textureLod(_TauLoB, uv, 0.0), scale);
    o_Color = vec4(SmDisplay(c, xs, ys, floor(px)), 1.0);
}
`;

// Sweep 5 (perf/sweep5): the upscale kernel of UpscaleGas. kind 'lz2' (the default) returns the text unchanged;
// 'cr' Catmull-Rom, 'mn' Mitchell-Netravali (B = C = 1/3), 'bl' the bilinear tent. The 2 x 2 clamp stays.
export function upscaleKernel(src, kind) {
  const body = { cr: 'x = abs(x); if (x < 1.0) return 1.5 * x * x * x - 2.5 * x * x + 1.0; if (x < 2.0) return -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0; return 0.0;',
    mn: 'x = abs(x); if (x < 1.0) return (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0; if (x < 2.0) return (-7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0; return 0.0;',
    bl: 'return max(0.0, 1.0 - abs(x));' }[kind];
  if (!body) return src;
  const re = /float SmLz2\(float x\)\n\{[\s\S]*?\n\}/;
  if (!re.test(src)) throw new Error('[compositor] no SmLz2 to replace');
  return src.replace(re, 'float SmLz2(float x)\n{\n    ' + body + '\n}');
}

// The at-rest accumulation of the star pass (artifact only), one output pixel per fragment.
// _Acc = (mode, sigma px, 0, weight cap). Mode 0 (a reset): the output is the seed, UpscaleGas of the march
// (the caller clears the history to 0). Mode 1: the 2 x 2 nearest march texels, at their offset positions (_LoJit), add with
// a Gaussian weight of their distance in output px to the running mean in _Hist (rgb mean, a weight sum).
// The weight sum stops at the cap, so a slow change (the cirrus drift) becomes an exponential blend.
export const RESOLVE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform highp sampler2D _GasLo;
uniform highp sampler2D _Hist;
uniform vec2 _LoSize;
uniform vec2 _LoJit;
uniform vec2 _OutSize;
uniform vec4 _Acc;
out vec4 o_Hist;
` + UPSCALE + `
void main()
{
    vec2 P = gl_FragCoord.xy;
    if (_Acc.x < 0.5) { o_Hist = vec4(UpscaleGas(_GasLo, P, _LoSize, _OutSize, _LoJit), 1.0); return; }
    vec4 h = texelFetch(_Hist, ivec2(P), 0);
    vec2 u = P * _LoSize / _OutSize - 0.5 - _LoJit;
    vec2 f0 = floor(u);
    vec2 k = _OutSize / _LoSize;
    ivec2 hi = ivec2(_LoSize) - 1;
    float inv = 0.5 / (_Acc.y * _Acc.y);
    vec3 s = vec3(0.0); float w = 0.0;
    for (int j = 0; j <= 1; j++)
        for (int i = 0; i <= 1; i++)
        {
            vec2 t = f0 + vec2(float(i), float(j));
            vec2 d = (u - t) * k;
            float wt = exp(-dot(d, d) * inv);
            s += wt * texelFetch(_GasLo, clamp(ivec2(t), ivec2(0), hi), 0).rgb;
            w += wt;
        }
    float W = h.a + w;
    o_Hist = vec4((h.rgb * h.a + s) / max(W, 1e-6), min(W, _Acc.w));
}
`;

const MAIN = `
out vec4 o_Color;
void main()
{
    // Canvas units: the target height is 1080 units (CanvasScaler match = height).
    float scale = 1080.0 / _TargetSize.y;
    vec2 px = gl_FragCoord.xy;
    vec3 c = CompositeDisplay(px.x * scale, px.y * scale, floor(px));
    o_Color = vec4(c, 1.0);
}
`;

// defines: extra "#define" lines (for example the lever SM_BSPLINE8), put before the shared text.
// consts (optional, from labConsts in render/lab-consts.js): each named uniform becomes a "const vec4" with
// the same value, so the compiler can fold the lab paths. The draw then finds no location for that name.
// compositorSource(defines) with no consts gives the same text as before (the prebaked shader sha uses it).
export function compositorSource(defines, consts, starMode) {
  let d = (defines || []).map((n) => `#define ${n}\n`).join('');
  if (starMode) d += '#define SM_STARPASS\n';
  let shell = COMPOSITOR_SHELL;
  for (const [name, values] of Object.entries(consts || {})) {
    const re = new RegExp('uniform vec4 ' + name + '(\\[\\d+\\])?;');
    if (!re.test(shell)) throw new Error('[compositor] no uniform ' + name + ' to specialize');
    shell = shell.replace(re, constDecl(name, values));
  }
  return shell + d + '\n' + STAR_COLOUR + '\n' + NEBULA_MATH + '\n' + COMPOSITE + '\n' + (starMode === 'march' ? MAIN_MARCH : (starMode === 'finish' ? MAIN_FINISH : MAIN));
}

// The specialized source is on by default. ?spec=0 keeps the generic source (all lab values as uniforms).
export function specOn(search) { return !/[?&]spec=0/.test(search || ''); }

export const COMPOSITOR_FS = compositorSource();
