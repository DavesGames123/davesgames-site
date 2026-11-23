// hydro.glsl.js: the WebGL2 shells of the hydro bake (spec 2.3-2.7, 2.10.2, 2.13.2, 2.13.3).
// Owner: row A4. Unity twin: StarMapHydro.compute (row U3).
//
// Exports (grep -n "^export"):
//   HYDRO_FS = { Init, Normalize, Force, Sources, Sweep, AddFeatures, Striate, GasCopy, GasCopyH, Diagnose }
//   SRC_ROWS, FEAT_ROWS, MAX_SRC, MAX_FEAT   layouts of the source and feature data textures
//
// Each shell is a fragment shader for runSlicePass (one draw per z layer).
// The texel of a draw is ivec3(ivec2(gl_FragCoord.xy), _Slice).
// Order of the text: "#version 300 es", then (by program()) PRELUDE, then the shell declarations,
// then STAR_COLOUR and NEBULA_MATH (the shared math of row A2), then the shell functions and main.
// The shells read every bake field with FETCH3D, except the trilinear reads of F, IonH and RadH.
//
// Source texture _Src (RGBA32F 2D, MAX_SRC columns, SRC_ROWS rows; one column per source):
//   row 0 (x, y, z px, p)                row 1 (qhat, qhat1, qhatFuv, influencePx)
//   row 2 (wind v, wind rPx, wind rho, ejecta 0/1)
//   row 3 (jet axis deg, jet tilt deg, jet v, has jet 0/1)
//   row 4 (jet period, duty, jet start time, precession deg)
//   row 5 (sink GM, softening l, rho max, sink start time; GM 0 = no sink)
//   row 6 (move dir xyz, move v)         row 7 (wind start time, accretion radius l, accretion rate, has wind 0/1)
// Rows 0-6 are the Src struct of 2.13.3 and 2.6 item 4. Row 7 holds the values that the struct has no slot for.
//
// Feature texture _Feat (RGBA32F 2D, MAX_FEAT columns, FEAT_ROWS rows; one column per feature):
//   row 0 (shape 0 filament / 1 clump / 2 halfspace, contrast, size px, tier step)
//   row 1 (A x, y, z px, 0)   row 2 (B x, y, z px, 0)
//   row 3 (x0, x1, x edge w, y soft)   row 4 (z0, z1, z soft, 0)   (halfspace only)

export const MAX_SRC = 32, SRC_ROWS = 8, MAX_FEAT = 16, FEAT_ROWS = 5;

import { STAR_COLOUR } from '../../shaders/star-colour.glsl.js';
import { NEBULA_MATH } from '../../shaders/nebula-math.glsl.js';

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler3D; precision highp sampler2D;
uniform ivec3 _Dims; uniform int _Slice; uniform vec3 _Cell; uniform vec3 _Box;
// Lab nest (LAB-DESIGN 3): _Origin is the px origin of a fine box, _Ext its size. Both are 0 on the coarse grid.
uniform vec3 _Origin; uniform vec3 _Ext;
`;

// Shell helpers (artifact side). Smoothstep with edge0 > edge1 is not defined in GLSL,
// so the shells use Ss, which accepts both orders.
const HELPERS = `
float Ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float Band(float x, float a, float b, float w) { return Ss(a - w, a + w, x) * (1.0 - Ss(b - w, b + w, x)); }
float MinImageX(float dx) { return Wrap(dx + 2880.0, 5760.0) - 2880.0; }
ivec3 TexelOf() { return ivec3(ivec2(gl_FragCoord.xy), _Slice); }
vec3 PosOf(ivec3 c) { return (vec3(c) + vec3(0.5, 0.5, 0.5)) * _Cell + _Origin; }
// Index rule of 2.13.2: x wraps, y and z clamp.
ivec3 Cl(ivec3 c)
{
    int x = c.x;
    if (x < 0) x += _Dims.x;
    if (x >= _Dims.x) x -= _Dims.x;
    return ivec3(x, clamp(c.y, 0, _Dims.y - 1), clamp(c.z, 0, _Dims.z - 1));
}
// Capsule distance from p to the segment a-b, with the minimum-image x offset (2.1).
// Returns (r, t, e.y, unused): t in [0, 1] along the segment, e = p - closest point.
vec4 Capsule(vec3 p, vec3 a, vec3 b)
{
    vec3 d = p - a; d.x = MinImageX(d.x);
    vec3 ab = b - a;
    float t = clamp(dot(d, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
    vec3 e = d - t * ab;
    return vec4(length(e), t, e.y, 0.0);
}
`;

const FEAT_FN = `
uniform highp sampler2D _Feat; uniform int _FeatCount; uniform vec4 _YTop;
float YTop(float x) { return _YTop.x + _YTop.y * (x - _YTop.z) / _YTop.w; }
float FeatProfile(int i, vec3 p)
{
    vec4 h = texelFetch(_Feat, ivec2(i, 0), 0);
    vec3 a = texelFetch(_Feat, ivec2(i, 1), 0).xyz;
    if (h.x < 0.5)
    {
        vec3 b = texelFetch(_Feat, ivec2(i, 2), 0).xyz;
        float r = Capsule(p, a, b).x;
        return 1.0 / (1.0 + r * r / (h.z * h.z));
    }
    if (h.x < 1.5)
    {
        vec3 d = p - a; d.x = MinImageX(d.x);
        return pow(1.0 + dot(d, d) / (h.z * h.z), -2.5);
    }
    vec4 xb = texelFetch(_Feat, ivec2(i, 3), 0);
    vec4 zb = texelFetch(_Feat, ivec2(i, 4), 0);
    float yt = YTop(p.x);
    return Band(p.x, xb.x, xb.y, xb.z) * (1.0 - Ss(yt - xb.w, yt + xb.w, p.y)) * Band(p.z, zb.x, zb.y, zb.z);
}
// rho += rho (contrast - 1) profile, for every feature whose tier step is "step", in list order.
float FeatScale(vec3 p, float step)
{
    float s = 1.0;
    for (int i = 0; i < 16; i++)
    {
        if (i >= _FeatCount) break;
        vec4 h = texelFetch(_Feat, ivec2(i, 0), 0);
        if (abs(h.w - step) > 0.5) continue;
        s *= 1.0 + (h.y - 1.0) * FeatProfile(i, p);
    }
    return s;
}
`;

// Striation shell around the F1 axis (2.10.2): 1.2 to 3.5 r_flat, upper side only.
// The mask has soft edges of 0.1 r_flat, so the standing wave has no hard step.
const SHELL_FN = `
uniform vec3 _F1A; uniform vec3 _F1B; uniform float _F1R; uniform vec2 _Shell;
float ShellMask(vec3 p)
{
    vec4 c = Capsule(p, _F1A, _F1B);
    float q = c.x / _F1R;
    float m = Ss(_Shell.x - 0.1, _Shell.x + 0.1, q) * (1.0 - Ss(_Shell.y - 0.1, _Shell.y + 0.1, q));
    return m * Ss(0.0, 0.2 * _F1R, c.z);
}
`;

function shell(decl, body, fns = '') {
  return HEAD + decl + '\n' + STAR_COLOUR + '\n' + NEBULA_MATH + '\n' + HELPERS + fns + '\n' + body;
}

// ---- Init (step 0): envelope, step-0 features, F1 inflow (2.4). MRT: U, S, X. ----
const Init = shell(`
uniform vec4 _RhoBase; uniform vec4 _CavX; uniform vec4 _CavY; uniform vec4 _Tail;
uniform vec3 _InA; uniform vec3 _InB; uniform vec4 _InR; uniform float _Scale;
layout(location = 0) out vec4 oU; layout(location = 1) out vec4 oS; layout(location = 2) out vec4 oX;
`, `
void main()
{
    ivec3 c = TexelOf();
    vec3 p = PosOf(c);
    float base = _RhoBase.x + _RhoBase.y * Ss(_RhoBase.z, _RhoBase.w, p.z);
    float yt = YTop(p.x);
    float cav = 1.0 - _CavX.w * Band(p.x, _CavX.x, _CavX.y, _CavX.z) * Ss(yt + _CavY.x, yt + _CavY.y, p.y);
    float tail = 1.0 - _Tail.w * Band(p.x, _Tail.x, _Tail.y, _Tail.z);
    float rho = base * cav * tail * FeatScale(p, 0.0) * _Scale;
    // F1 inflow: u += -speed rperp_hat Ss(r2, r1, r) Ss(0, r0, r). _InR = (speed, r0, r1, r2).
    vec3 d = p - _InA; d.x = MinImageX(d.x);
    vec3 ab = _InB - _InA;
    float t = clamp(dot(d, ab) / dot(ab, ab), 0.0, 1.0);
    vec3 e = d - t * ab;
    float r = length(e);
    vec3 u = vec3(0.0, 0.0, 0.0);
    if (r > 0.001) u = -_InR.x * (e / r) * Ss(_InR.w, _InR.z, r) * Ss(0.0, _InR.y, r);
    rho = max(rho, RHO_FLOOR);
    oU = vec4(rho, rho * u.x, rho * u.y, rho * u.z);
    oS = vec4(1.0, 0.0, 0.0, 1.0);
    oX = vec4(0.0, 0.0, 0.0, 0.0);
}
`, FEAT_FN);

// ---- Normalize: scale rho and momentum by _Scale, so that the box mean of rho is 1. ----
const Normalize = shell(`
uniform highp sampler3D _U; uniform float _Scale;
layout(location = 0) out vec4 oU;
`, `
void main() { oU = FETCH3D(_U, TexelOf()) * _Scale; }
`);

// ---- Force: f = forceAmp sum_m amp (re cos(k . x) - im sin(k . x)) on the F grid (2.5). ----
const Force = shell(`
uniform highp sampler2D _Modes; uniform float _ForceAmp;
layout(location = 0) out vec4 oF;
`, `
void main()
{
    vec3 p = PosOf(TexelOf());
    vec3 f = vec3(0.0, 0.0, 0.0);
    LOOP for (int m = 0; m < 256; m++)
    {
        vec4 k = texelFetch(_Modes, ivec2(3 * m, 0), 0);
        vec3 re = texelFetch(_Modes, ivec2(3 * m + 1, 0), 0).xyz;
        vec3 im = texelFetch(_Modes, ivec2(3 * m + 2, 0), 0).xyz;
        float ph = dot(k.xyz, p);
        f += k.w * (re * cos(ph) - im * sin(ph));
    }
    oF = vec4(f * _ForceAmp, 0.0);
}
`);

// ---- Sources: 2.6 items 1-8 in order. MRT: U, S, X. ----
const Sources = shell(`
uniform highp sampler3D _U; uniform highp sampler3D _S; uniform highp sampler3D _X;
uniform highp sampler3D _F; uniform highp sampler3D _IonH; uniform highp sampler3D _RadH;
uniform highp sampler2D _Src; uniform int _SrcCount;
uniform float _Time; uniform float _Dt; uniform float _ForceRamp; uniform int _HasIon; uniform int _HasRad;
uniform vec3 _CellL; uniform float _HalfDiag; uniform float _PxPerL;
layout(location = 0) out vec4 oU; layout(location = 1) out vec4 oS; layout(location = 2) out vec4 oX;
`, `
vec4 SrcRow(int i, int r) { return texelFetch(_Src, ivec2(i, r), 0); }
vec3 Vel(ivec3 c) { vec4 u = FETCH3D(_U, Cl(c)); return u.yzw / max(u.x, RHO_FLOOR); }
void main()
{
    ivec3 c = TexelOf();
    vec3 p = PosOf(c);
    vec3 uvw = p / _Box;
    vec3 uvwL = _Ext.x > 0.0 ? (p - _Origin) / _Ext : uvw;   // IonH, RadH live on the grid of this box
    vec4 U = FETCH3D(_U, c);
    vec4 S = FETCH3D(_S, c);
    float x = FETCH3D(_X, c).x;
    float rho = max(U.x, RHO_FLOOR);
    vec3 u = U.yzw / rho;
    float dt = _Dt;

    // 1. Forcing, radiation push and sink gravity (sink pull gated by 1 - x).
    vec3 acc = vec3(0.0, 0.0, 0.0);
    if (_ForceRamp > 0.0) acc += _ForceRamp * SAMPLE3D(_F, uvw).xyz;
    if (_HasRad != 0) acc += SAMPLE3D(_RadH, uvwL).xyz;
    for (int i = 0; i < 32; i++)
    {
        if (i >= _SrcCount) break;
        vec4 sk = SrcRow(i, 5);
        if (sk.x <= 0.0 || _Time < sk.w - 0.000001) continue;
        vec3 d = SrcRow(i, 0).xyz - p; d.x = MinImageX(d.x);
        d /= _PxPerL;
        float e2 = sk.y * sk.y;
        acc += sk.x * d * pow(dot(d, d) + e2, -1.5) * (1.0 - x);
    }
    u += dt * acc;

    // 2. Accretion inside accL of a sink, above rho max. Velocity stays, so momentum scales with rho.
    for (int i = 0; i < 32; i++)
    {
        if (i >= _SrcCount) break;
        vec4 sk = SrcRow(i, 5);
        if (sk.x <= 0.0 || _Time < sk.w - 0.000001) continue;
        vec4 r7 = SrcRow(i, 7);
        vec3 d = SrcRow(i, 0).xyz - p; d.x = MinImageX(d.x);
        if (length(d) / _PxPerL < r7.y && rho > sk.z) rho -= (rho - sk.z) * r7.z * dt;
    }

    // 4. Wind stamps (4 samples along the step path; a moving source moves its centre).
    // The stamp radius is at least the half cell diagonal, so a stamp always holds one voxel centre.
    for (int i = 0; i < 32; i++)
    {
        if (i >= _SrcCount) break;
        vec4 r7 = SrcRow(i, 7);
        if (r7.w < 0.5 || _Time < r7.x - 0.000001) continue;
        vec4 w = SrcRow(i, 2);
        vec4 mv = SrcRow(i, 6);
        vec3 p0 = SrcRow(i, 0).xyz;
        float rw = max(w.y, _HalfDiag);
        float best = 1.0e9; vec3 bestD = vec3(0.0, 0.0, 0.0);
        for (int s = 0; s < 4; s++)
        {
            float ts = _Time + dt * float(s) / 3.0;
            vec3 cen = p0 + mv.xyz * (mv.w * _PxPerL * (ts - r7.x));
            vec3 d = p - cen; d.x = MinImageX(d.x);
            float r = length(d);
            if (r < best) { best = r; bestD = d; }
        }
        if (best < rw)
        {
            rho = w.z;
            u = (best > 0.001) ? w.x * bestD / best : vec3(0.0, 0.0, 0.0);
            S.x = 0.0; S.z = w.w; S.w = 0.0;
        }
    }

    // 5. Jet stamps: cylinder of radius 1.5 l and half-length 3 l along +-a, while frac((t - t0) / P) < duty.
    for (int i = 0; i < 32; i++)
    {
        if (i >= _SrcCount) break;
        vec4 j3 = SrcRow(i, 3);
        if (j3.w < 0.5) continue;
        vec4 j4 = SrcRow(i, 4);
        if (_Time < j4.z - 0.000001) continue;
        if (frac((_Time - j4.z) / j4.x) >= j4.y) continue;
        vec3 d = p - SrcRow(i, 0).xyz; d.x = MinImageX(d.x);
        float rad = max(1.5 * _PxPerL, _HalfDiag);
        float hl = max(3.0 * _PxPerL, _HalfDiag);
        float tl = radians(j3.y);
        for (int s = 0; s < 4; s++)
        {
            float ts = _Time + dt * float(s) / 3.0;
            float ang = radians(j3.x + j4.w * sin(2.0 * NM_PI * ts / (8.0 * j4.x)));
            vec3 a = vec3(cos(ang) * cos(tl), sin(ang) * cos(tl), -sin(tl));
            float sa = dot(d, a);
            float pr = length(d - sa * a);
            if (abs(sa) <= hl && pr <= rad)
            {
                u = j3.z * (sa >= 0.0 ? 1.0 : -1.0) * a;
                rho = max(rho, 0.5);
                break;
            }
        }
    }

    // 6. Ionization: x relaxes to x_t = 1 - smoothstep(0.97, 1.03, B_min).
    if (_HasIon != 0)
    {
        float bmin = SAMPLE3D(_IonH, uvwL).x;
        float xt = 1.0 - smoothstep(0.97, 1.03, bmin);
        x += (xt - x) * min(1.0, dt / 0.05);
    }

    // 7. Tracers: chi_sh from compression, chi_pah dies in ionized gas (2.3).
    vec3 ux1 = Vel(c + ivec3(1, 0, 0)); vec3 ux0 = Vel(c - ivec3(1, 0, 0));
    vec3 uy1 = Vel(c + ivec3(0, 1, 0)); vec3 uy0 = Vel(c - ivec3(0, 1, 0));
    vec3 uz1 = Vel(c + ivec3(0, 0, 1)); vec3 uz0 = Vel(c - ivec3(0, 0, 1));
    float divu = (ux1.x - ux0.x) / (2.0 * _CellL.x) + (uy1.y - uy0.y) / (2.0 * _CellL.y) + (uz1.z - uz0.z) / (2.0 * _CellL.z);
    // Fixer round 3: no chi_sh source while the driving is on (gain 1 - _ForceRamp). The shocks of the
    // driven turbulence decay with the 0.3 time scale, so they do not fill the display.
    S.y = saturate(S.y + dt * ((1.0 - _ForceRamp) * 0.5 * max(0.0, -divu - 0.5) * (1.0 - S.y) - S.y / 0.3));
    S.w = S.w * exp(-4.0 * x * dt);

    // 8. Clamps.
    rho = max(rho, RHO_FLOOR);
    float sp = length(u);
    if (sp > 20.0) u *= 20.0 / sp;
    oU = vec4(rho, rho * u.x, rho * u.y, rho * u.z);
    oS = saturate(S);
    oX = vec4(saturate(x), 0.0, 0.0, 0.0);
}
`);

// ---- Sweep: one MUSCL-Hancock + HLLE sweep along _Axis (2.13.2). MRT: U, S. ----
const Sweep = shell(`
uniform highp sampler3D _U; uniform highp sampler3D _S; uniform highp sampler3D _X;
uniform int _Axis; uniform float _DtDx; uniform vec3 _Poly;
layout(location = 0) out vec4 oU; layout(location = 1) out vec4 oS;
`, `
// Lab (LAB-DESIGN.md 5.1): polytropic neutral gas. _Poly = (gamma - 1, rhoC, floor). The neutral term is
// clamp((rho / rhoC)^(gamma - 1), floor, 1): dense neutral gas gets softer, thin gas stays isothermal (1).
// _Poly = (0, 1, 1) gives Cs2 of the shared text exactly.
float Cs2P(float x, float chiEj, float rho)
{
    float n = clamp(pow(max(rho, RHO_FLOOR) / _Poly.y, _Poly.x), _Poly.z, 1.0);
    return n * (1.0 - x) + 64.0 * x + 99.0 * chiEj * (1.0 - x);
}
vec4 Perm(vec4 v)
{
    if (_Axis == 1) return vec4(v.x, v.z, v.w, v.y);
    if (_Axis == 2) return vec4(v.x, v.w, v.y, v.z);
    return v;
}
vec4 Unperm(vec4 v)
{
    if (_Axis == 1) return vec4(v.x, v.w, v.y, v.z);
    if (_Axis == 2) return vec4(v.x, v.z, v.w, v.y);
    return v;
}
// Look-dev r2 (spec deviation of 2.13.2): y and z are walls, not clamped copies. With the clamp, the
// ghost cell is a copy of the edge cell, momentum included. Where the driving pushed gas into the box,
// the ghost fed the edge cell without limit, so straight columns of gas flowed in from the y edges
// (mass drift +71 %, the smear columns on screen). A ghost is now the mirror cell with the normal
// momentum negated, so the HLLE mass flux through the wall is zero. x still wraps.
// March fix round 1: y is an outflow edge with no inflow (a diode), not a wall. At the wall the driving
// piled gas up against the top of the box: a dense layer 2 voxels high that the march showed as a bright
// band with a straight lower edge along the top of the frame. A y ghost is now a copy of the edge cell,
// and its normal momentum is clamped to point out of the box, so gas can leave and none flows in.
// z keeps the mirror wall.
ivec3 Ghost(ivec3 c, out float flip)
{
    flip = 1.0;
    int n = (_Axis == 1) ? _Dims.y : _Dims.z;
    int i = (_Axis == 1) ? c.y : c.z;
    if (_Axis == 1 && (i < 0 || i >= n)) { flip = (i < 0) ? -2.0 : 2.0; return Cl(c); }
    if (_Axis != 0 && (i < 0 || i >= n))
    {
        flip = -1.0;
        i = (i < 0) ? -1 - i : 2 * n - 1 - i;
        if (_Axis == 1) c.y = i; else c.z = i;
    }
    return Cl(c);
}
vec4 GhostU(ivec3 c)
{
    float f; ivec3 g = Ghost(c, f);
    vec4 u = Perm(FETCH3D(_U, g));
    if (f < -1.5) u.y = min(u.y, 0.0);          // y outflow below the box: no inflow
    else if (f > 1.5) u.y = max(u.y, 0.0);      // y outflow above the box: no inflow
    else u.y *= f;
    return u;
}
void main()
{
    ivec3 c = TexelOf();
    ivec3 st = (_Axis == 0) ? ivec3(1, 0, 0) : ((_Axis == 1) ? ivec3(0, 1, 0) : ivec3(0, 0, 1));
    float f1; float f3;
    ivec3 c1 = Ghost(c - st, f1); ivec3 c3 = Ghost(c + st, f3);
    vec4 U0 = GhostU(c - 2 * st); vec4 U1 = GhostU(c - st); vec4 U2 = Perm(FETCH3D(_U, c));
    vec4 U3 = GhostU(c + st); vec4 U4 = GhostU(c + 2 * st);
    vec4 S1 = FETCH3D(_S, c1); vec4 S2 = FETCH3D(_S, c); vec4 S3 = FETCH3D(_S, c3);
    float C1 = Cs2P(FETCH3D(_X, c1).x, S1.z, U1.x);
    float C2 = Cs2P(FETCH3D(_X, c).x, S2.z, U2.x);
    float C3 = Cs2P(FETCH3D(_X, c3).x, S3.z, U3.x);
    vec2 fm = vec2(0.0, 0.0);
    vec4 Un = SweepCell(U0, U1, U2, U3, U4, C1, C2, C3, _DtDx, fm);
    vec4 Sn = SweepSpecies(S1, S2, S3, max(U2.x, RHO_FLOOR), Un.x, fm, _DtDx);
    oU = Unperm(Un);
    oS = Sn;
}
`);

// ---- AddFeatures: the features of this step (cliff, pil1..pil3, g1 at 360), then the striation wave. ----
// Added mass is at rest: momentum stays, so the velocity falls by the added contrast.
const AddFeatures = shell(`
uniform highp sampler3D _U; uniform float _Step; uniform int _Wave; uniform float _WaveAmp; uniform float _WaveLambda;
layout(location = 0) out vec4 oU;
`, `
void main()
{
    ivec3 c = TexelOf();
    vec3 p = PosOf(c);
    vec4 U = FETCH3D(_U, c);
    float s = FeatScale(p, _Step);
    if (_Wave != 0)
    {
        vec4 cap = Capsule(p, _F1A, _F1B);
        float sAxis = cap.y * length(_F1B - _F1A);
        s *= 1.0 + _WaveAmp * ShellMask(p) * cos(2.0 * NM_PI * sAxis / _WaveLambda);
    }
    oU = vec4(max(U.x * s, RHO_FLOOR), U.yzw);
}
`, FEAT_FN + SHELL_FN);

// ---- Striate: one iteration of field-aligned diffusion in the F1 shell (2.10.2). ----
// rho += k div(b (b . grad rho)), flux form on x and y faces, k = D dt / dx^2, cells in xy are square.
// The face mask is the smaller of the two cell masks, so no flux crosses the shell edge.
const Striate = shell(`
uniform highp sampler3D _U; uniform vec2 _B; uniform float _K;
layout(location = 0) out vec4 oU;
`, `
float R(ivec3 c) { return FETCH3D(_U, Cl(c)).x; }
float M(ivec3 c) { return ShellMask(PosOf(Cl(c))); }
// Flux b_n (b . grad rho) on the face between c and c + n (n = x or y unit step).
float FaceFlux(ivec3 c, ivec3 n, ivec3 t, float bn, float bt)
{
    float m = min(M(c), M(c + n));
    if (m <= 0.0) return 0.0;
    float gn = R(c + n) - R(c);
    float gt = 0.25 * (R(c + t) - R(c - t) + R(c + n + t) - R(c + n - t));
    return m * bn * (bn * gn + bt * gt);
}
void main()
{
    ivec3 c = TexelOf();
    vec4 U = FETCH3D(_U, c);
    if (M(c) <= 0.0) { oU = U; return; }
    ivec3 ex = ivec3(1, 0, 0); ivec3 ey = ivec3(0, 1, 0);
    float fxp = FaceFlux(c, ex, ey, _B.x, _B.y);
    float fxm = FaceFlux(c - ex, ex, ey, _B.x, _B.y);
    float fyp = FaceFlux(c, ey, ex, _B.y, _B.x);
    float fym = FaceFlux(c - ey, ey, ex, _B.y, _B.x);
    float rho = max(U.x, RHO_FLOOR);
    float rn = max(rho + _K * (fxp - fxm + fyp - fym), RHO_FLOOR);
    oU = vec4(rn, U.yzw * (rn / rho));
}
`, SHELL_FN);

// ---- GasCopy: Opt = (rho, rho chi_d), Vel = (u, v, w, rho), full resolution. MRT: Opt, Vel. ----
// Foreground cap (3.2, C3): in front of the route plane the slabs hold only the thin blister front.
// _FgCap = (rho cap, z0, z1, 0): rho is at most the cap for z < z0, and the cap goes to no limit at z1.
// Pass 3 volume body: _Contrast = (gamma, mu, 0, 0). The neutral gas gets the log-density width of the
// design Mach number back: ln rho' = ln rho + (1 - x) (gamma - 1) (ln rho - mu), mu = the mean ln rho of the
// Diagnose pass. The 10-20 px HLLE grid smooths the density peaks, so the measured width is below the
// width that the forcing sets (2.5). Ionized gas (c_i = 8) has a Mach number near M / 8 and a narrow
// width, so it keeps its density. Vel keeps the momentum over the original rho.
const GasCopy = shell(`
uniform highp sampler3D _U; uniform highp sampler3D _S; uniform highp sampler3D _X; uniform vec4 _FgCap; uniform vec4 _Contrast;
uniform vec3 _Dust;
layout(location = 0) out vec4 oOpt; layout(location = 1) out vec4 oVel;
`, `
void main()
{
    ivec3 c = TexelOf();
    vec4 U = FETCH3D(_U, c);
    float rho0 = max(U.x, RHO_FLOOR);
    float xion = clamp(FETCH3D(_X, c).x, 0.0, 1.0);
    float rho = exp(log(rho0) + (1.0 - xion) * (_Contrast.x - 1.0) * (log(rho0) - _Contrast.y));
    float zc = PosOf(c).z;
    float cap = _FgCap.x / max(1.0 - Ss(_FgCap.y, _FgCap.z, zc), 0.0001);
    rho = min(rho, cap);
    // Lab round 4: an fp16 guard. The fine L box resolves the sink wells, and the gas there collapses to
    // rho 1e4-1e5 (the coarse grid smooths it to about 1e3). After the contrast stretch, rho chi_d went over the
    // RG16F limit (65504), Opt became Inf and chiD = Opt.y / rho became NaN, so the hub left an empty hole in
    // the ship grid. 16000 x the 3x dust cap stays under the limit. sigma is then 110 per px: opaque in 1 px.
    rho = min(rho, 16000.0);
    float cd = FETCH3D(_S, c).x;
    // Lab (LAB-DESIGN.md 5.2): dense neutral gas holds grown, ice-coated grains. _Dust = (k, rho1, rho2):
    // the V-band opacity per unit rho chi_d rises by 1 + k (1 - x) smoothstep(rho1, rho2, rho), k <= 2 (cap 3x).
    // Opt.y feeds the light stage and SampleAt (chiD = Opt.y / rho), so the shadows and the image agree.
    cd *= 1.0 + _Dust.x * (1.0 - xion) * Ss(_Dust.y, _Dust.z, rho);
    oOpt = vec4(rho, rho * cd, 0.0, 0.0);
    oVel = vec4(U.yzw / rho0, rho);
}
`);

// ---- GasCopyH: OptH = the mean (rho, rho chi_d) of the 2 x 2 x 2 child cells. _Dims = the full grid. ----
const GasCopyH = shell(`
uniform highp sampler3D _U; uniform highp sampler3D _S;
layout(location = 0) out vec4 oOpt;
`, `
void main()
{
    ivec3 h = TexelOf();
    vec2 acc = vec2(0.0, 0.0);
    for (int k = 0; k < 2; k++) for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++)
    {
        ivec3 c = Cl(2 * h + ivec3(i, j, k));
        float rho = max(FETCH3D(_U, c).x, RHO_FLOOR);
        acc += vec2(rho, rho * FETCH3D(_S, c).x);
    }
    oOpt = vec4(min(acc * 0.125, vec2(60000.0, 60000.0)), 0.0, 0.0);   // lab round 4: the fp16 guard of GasCopy
}
`);

// ---- Diagnose: per-column sums along z in a fixed order (level 1 of the two-level sum). ----
// MRT, 2D targets nx x ny:
//   o0 = (sum rho, count rho > 0.3, sum ln rho, sum (ln rho)^2)      (the last three where rho > 0.3)
//   o1 = (count rho > 0.5, sum Mach^2 where rho > 0.5, sum |rho(x + 1) - rho(x)|, sum rho chi_d)
//   o2 = (sum rho m, sum m) with m the striation shell mask
const Diagnose = shell(`
uniform highp sampler3D _U; uniform highp sampler3D _S; uniform highp sampler3D _X;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
`, `
void main()
{
    ivec2 xy = ivec2(gl_FragCoord.xy);
    vec4 a = vec4(0.0, 0.0, 0.0, 0.0); vec4 b = vec4(0.0, 0.0, 0.0, 0.0); vec2 sh = vec2(0.0, 0.0);
    LOOP for (int k = 0; k < 256; k++)
    {
        if (k >= _Dims.z) break;
        ivec3 c = ivec3(xy, k);
        vec4 U = FETCH3D(_U, c);
        float rho = max(U.x, RHO_FLOOR);
        float rx = max(FETCH3D(_U, Cl(c + ivec3(1, 0, 0))).x, RHO_FLOOR);
        a.x += rho;
        if (rho > 0.3) { float l = log(rho); a.y += 1.0; a.z += l; a.w += l * l; }
        if (rho > 0.5)
        {
            vec3 u = U.yzw / rho;
            float c2 = Cs2(FETCH3D(_X, c).x, FETCH3D(_S, c).z);
            b.x += 1.0; b.y += dot(u, u) / c2;
        }
        b.z += abs(rx - rho);
        b.w += rho * FETCH3D(_S, c).x;
        float m = ShellMask(PosOf(c));
        sh += vec2(rho * m, m);
    }
    o0 = a; o1 = b; o2 = vec4(sh, 0.0, 0.0);
}
`, SHELL_FN);

export const HYDRO_FS = { Init, Normalize, Force, Sources, Sweep, AddFeatures, Striate, GasCopy, GasCopyH, Diagnose };
