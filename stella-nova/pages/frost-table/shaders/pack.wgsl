// ═══════════════════════════════════════════════════════════════════════════
//  FROST TABLE  ·  a WGSL port of the Astrotechs frost library (HLSL, URP).
//  Each helper names the HLSL file it ports. The HLSL code reads material
//  properties; this port turns them into constants at the material defaults
//  from SpreadingFrost.shader, or into function arguments. A cell maps its
//  tile to a floor patch in metres, x right and z up the screen, so the
//  floor normal is +y. The palette swatches arrive as sRGB; lin() converts
//  them to linear light before the shade model reads them.
// ═══════════════════════════════════════════════════════════════════════════
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct FrostU {
    size: vec2f, time: f32, pixelScale: f32,
    ink: vec4f, tone: vec4f, cream: vec4f,
    exposure: f32, sparkle: f32, glow: f32, pad1: f32,
    k: vec4f,
};
@group(0) @binding(0) var<uniform> u: FrostU;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}

// Tile coordinates: x right, y up, -0.5..0.5 across the short side.
fn fuv(fp: vec2f) -> vec2f {
    let p = fp / max(u.pixelScale, 0.001);
    let n = (p - 0.5 * u.size) / max(min(u.size.x, u.size.y), 1.0);
    return vec2f(n.x, -n.y);
}
// Tile point to floor metres. s is the metres across one tile.
fn toM(p: vec2f, s: f32) -> vec3f { return vec3f(p.x * s, 0.0, p.y * s); }
// A descending smoothstep. WGSL leaves smoothstep(hi, lo, x) undefined, and
// the HLSL uses that form often, so this helper gives the same curve.
fn sdown(hi: f32, lo: f32, x: f32) -> f32 { return 1.0 - smoothstep(lo, hi, x); }
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

// ── palette and output ──────────────────────────────────────────────────────
fn lin(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
fn inkL() -> vec3f { return lin(u.ink.rgb); }
fn deepL() -> vec3f { return lin(u.tone.rgb); }    // _FrostDeep
fn whiteL() -> vec3f { return lin(u.cream.rgb); }  // _FrostWhite
// Three-stop ramp ink, deep, white for the scalar views. Linear output.
fn ramp(hh: f32) -> vec3f {
    let h = sat(hh);
    let lo = mix(inkL(), deepL(), smoothstep(0.02, 0.55, h));
    return mix(lo, whiteL(), smoothstep(0.5, 0.98, h));
}
// URP applies ACES after the frost shader. The table does the same step here
// (Narkowicz fit), then encodes to display gamma.
fn aces(x: vec3f) -> vec3f {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn toDisp(c: vec3f) -> vec3f { return pow(aces(max(c, vec3f(0.0)) * u.exposure * 0.95), vec3f(1.0 / 2.2)); }
fn present(c: vec3f) -> vec4f { return vec4f(toDisp(c), 1.0); }
// Scalar views skip the tone curve, so the ramp keeps its saturation.
fn show(c: vec3f) -> vec4f { return vec4f(pow(clamp(c * u.exposure, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0); }
// Red corner on the cells that show a removed approach.
fn failMark(p: vec2f, c: vec4f) -> vec4f {
    let d = p.x - p.y + 0.84;
    let tri = sdown(0.0, -0.004, d);
    let stripe = (1.0 - smoothstep(0.004, 0.012, abs(d + 0.035))) * (1.0 - tri);
    return vec4f(mix(c.rgb, vec3f(0.92, 0.26, 0.2), max(tri * 0.9, stripe * 0.8)), 1.0);
}

// ── FrostHash.hlsl ──────────────────────────────────────────────────────────
// Float-only hashes (fract and dot chains), stable across GPU targets.
fn hash13(pin: vec3f) -> f32 {
    var p3 = fract(pin * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn hash33(pin: vec3f) -> vec3f {
    var p3 = fract(pin * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// ── FrostNoise.hlsl ─────────────────────────────────────────────────────────
// Value noise with smoothstep weights, a two-octave sum (lacunarity 2.03,
// per-octave offset), and the ridge fold that drives the veins and ferns.
fn vnoise(p: vec3f) -> f32 {
    let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
    let c000 = hash13(i + vec3f(0.0, 0.0, 0.0)); let c100 = hash13(i + vec3f(1.0, 0.0, 0.0));
    let c010 = hash13(i + vec3f(0.0, 1.0, 0.0)); let c110 = hash13(i + vec3f(1.0, 1.0, 0.0));
    let c001 = hash13(i + vec3f(0.0, 0.0, 1.0)); let c101 = hash13(i + vec3f(1.0, 0.0, 1.0));
    let c011 = hash13(i + vec3f(0.0, 1.0, 1.0)); let c111 = hash13(i + vec3f(1.0, 1.0, 1.0));
    let x00 = mix(c000, c100, w.x); let x10 = mix(c010, c110, w.x);
    let x01 = mix(c001, c101, w.x); let x11 = mix(c011, c111, w.x);
    return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}
fn fbm(p0: vec3f) -> f32 {
    var p = p0; var s = 0.0; var a = 0.5;
    for (var o: i32 = 0; o < 2; o++) { s += a * vnoise(p); p = p * 2.03 + vec3f(17.1, 9.7, 3.3); a *= 0.5; }
    return s;
}
fn ridge(p: vec3f) -> f32 { return 1.0 - abs(2.0 * fbm(p) - 1.0); }

// ── FrostField.hlsl ─────────────────────────────────────────────────────────
// The field config holds the material values the HLSL reads from the CBUFFER.
// cband is _CoverageBand times _FrostEdgeWidth.
struct FieldCfg { veinFreq: f32, veinSharp: f32, veinDepth: f32, fingerAmp: f32, noiseScale: f32, cband: f32, ageDist: f32 };
fn cfgDefault() -> FieldCfg { return FieldCfg(1.3, 3.0, 0.35, 1.0, 1.5, 0.12, 1.5); }
struct FrostSample { coverage: f32, age: f32, ahead: f32, front: f32 };

// Bounded vein bulge in metres. It ADDS to the radial front; it does not warp
// the domain, so the coverage band keeps one width in world space.
fn veinBias(pM: vec3f, c: FieldCfg) -> f32 {
    let v = sat(pow(ridge(pM * c.veinFreq), c.veinSharp));
    return (v - 0.35) * c.veinDepth;
}
// Crisp dendrite fingers: one coarse ridged arm term, one value-noise term.
fn finger(pM: vec3f, c: FieldCfg) -> f32 {
    let arm = pow(ridge(pM * 6.0 * c.noiseScale), 3.0);
    let micro = vnoise(pM * 20.0 * c.noiseScale);
    return ((arm - 0.40) * 0.10 + (micro - 0.5) * 0.05) * c.fingerAmp;
}
// The noise-free radial front, the cheap test before any noise runs.
fn radialFront(pM: vec3f, front: f32) -> f32 { return front - length(pM); }
// Sample the field. Only the boundary ring (|radial| < band) runs the noise;
// the weight w fades the noise to zero at the ring edge, so no step shows.
fn fieldSample(pM: vec3f, radial: f32, c: FieldCfg) -> FrostSample {
    let band = c.cband * 0.5 + 0.65 * c.veinDepth + 0.15 * c.fingerAmp;
    var front = radial; var fing = 0.0;
    if (abs(radial) < band) {
        let w = 1.0 - smoothstep(band * 0.75, band, abs(radial));
        fing = finger(pM, c) * w;
        front = radial + veinBias(pM, c) * w;
    }
    var s: FrostSample;
    s.front = front;
    s.coverage = smoothstep(-c.cband * 0.5, c.cband * 0.5, front + fing);
    s.age = sat(front / max(c.ageDist, 1e-3));
    s.ahead = -front - fing;
    return s;
}
// A sample from a front value that a cell built itself.
fn sampleFrom(front: f32, cband: f32, ageDist: f32) -> FrostSample {
    return FrostSample(smoothstep(-cband * 0.5, cband * 0.5, front), sat(front / ageDist), -front, front);
}
// Lead, mid and full weights across the coverage ramp.
fn bandWeights(cov: f32, lead: f32, mid: f32) -> vec3f {
    let toMid = smoothstep(0.0, max(lead, 1e-3), cov);
    let toFull = smoothstep(lead, max(mid, lead + 1e-3), cov);
    let full = smoothstep(mid, 1.0, cov);
    return vec3f(sat(toMid - toFull), sat(toFull - full), full);
}

// ── FrostColdfront.hlsl ─────────────────────────────────────────────────────
// Three moisture bands ahead of the ice. ahead is the metres of bare floor
// still ahead of the ice; each band rises as ahead falls.
struct ColdFront { chill: f32, sweat: f32, hoar: f32 };
fn coldEval(ahead: f32, notFrost: f32) -> ColdFront {
    return ColdFront(sdown(1.0, 0.4, ahead) * notFrost, sdown(0.7, 0.2, ahead) * notFrost, sdown(0.35, 0.0, ahead) * notFrost);
}

// ── FrostRind.hlsl ──────────────────────────────────────────────────────────
// edge is 0 at a border and 1 mid-face. The crust hugs the border.
fn hugF(edge: f32) -> f32 { return pow(max(1.0 - edge, 0.0), 1.5); }
fn edgeCore(edge: f32) -> f32 { return sdown(0.30, 0.0, edge); }
struct Rind { albedo: vec3f, opacity: f32, body: f32 };
fn rindEval(pM: vec3f, cov: f32, age: f32, edge: f32) -> Rind {
    let hug = hugF(edge); let ec = edgeCore(edge);
    let fern = pow(ridge(pM * 14.0), 3.0);
    var r: Rind;
    r.albedo = mix(deepL(), whiteL(), 0.35 + age * 0.25 + hug * 0.25 + ec * 0.3 + fern * 0.15);
    r.opacity = min(1.0, cov * (0.26 + age * 0.12 + hug * 0.38 + ec * 0.28 + fern * 0.08));
    r.body = 0.35 + 0.65 * hug + 0.3 * ec;
    return r;
}

// ── FrostMicrofacet.hlsl ────────────────────────────────────────────────────
// Triangular micro-facet lattice. The square grid is skewed by tan30 into
// triangles; three nested levels add tilt, each faded out by its screen
// footprint. Level 0 is an irregular Voronoi F1 lattice (jittered centres).
// The HLSL calls fwidth inside; WGSL needs derivatives in uniform control
// flow, so each entry point takes fwidth once and passes footprint in.
// lvMask picks levels (7 = all); the HLSL always runs all three.
struct Micro { normal: vec3f, facetId: f32, tilt: vec2f, coarseId: f32, vis: vec3f };
fn microLevels(pM: vec3f, n: vec3f, triId: f32, amp: f32, cellSize: f32, jitter: f32, coarseScale: f32, footprint: f32, lvMask: u32) -> Micro {
    let an = abs(n);
    var q = pM.xy;
    if (an.x > an.y && an.x > an.z) { q = pM.yz; } else if (an.y > an.z) { q = pM.xz; }
    let sk0 = vec2f(q.x - q.y * 0.57735, q.y * 1.1547) / cellSize;
    var tilt = vec2f(0.0); var fineId = vec3f(0.0); var wsum = 0.0; var coarseVis = 1.0;
    var cid = 0.0; var vis3 = vec3f(0.0);
    for (var lv: i32 = 0; lv < 3; lv++) {
        let scale = pow(2.0, f32(lv));
        let triSize = cellSize / scale;
        var vis = smoothstep(1.0, 3.5, triSize / max(footprint, 1e-5));
        vis3[lv] = vis;
        if ((lvMask & (1u << u32(lv))) == 0u) { vis = 0.0; }
        let w = pow(0.55, f32(lv));
        if (lv == 0) {
            let skc = sk0 / max(coarseScale, 1e-3);
            let baseCell = floor(skc); let fc = fract(skc);
            var bestD = 1e9; var bestCell = baseCell;
            for (var gy: i32 = -1; gy <= 1; gy++) {
                for (var gx: i32 = -1; gx <= 1; gx++) {
                    let nb = vec2f(f32(gx), f32(gy));
                    let cellId = baseCell + nb;
                    let jit = (hash33(vec3f(cellId, an.x * 10.0 + an.z * 7.0)).xy - 0.5) * jitter;
                    let dv = nb + 0.5 + jit - fc;
                    let dist = dot(dv, dv);
                    if (dist < bestD) { bestD = dist; bestCell = cellId; }
                }
            }
            let id0 = vec3f(bestCell, 0.0) + an * 10.0;
            tilt += (hash33(id0).xy - 0.5) * 2.0 * w * vis;
            coarseVis = vis3.x; wsum += w; cid = hash13(id0 + 1.7);
            continue;
        }
        let sk = sk0 * scale; let cell = floor(sk); let f = fract(sk);
        let hc = select(0.0, 1.0, f.x + f.y > 1.0);
        let id = vec3f(cell, hc) + an * 10.0 + f32(lv) * 37.0;
        tilt += (hash33(id).xy - 0.5) * 2.0 * w * vis;
        if (lv == 2) { fineId = id; }
        wsum += w;
    }
    tilt /= wsum;
    let axis = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), an.x > 0.9);
    let tt = normalize(cross(n, axis)); let b = cross(n, tt);
    var m: Micro;
    m.normal = normalize(n + (tt * tilt.x + b * tilt.y) * 0.13 * amp);
    m.facetId = mix(0.5, hash13(fineId + 3.0 + triId * 13.0), coarseVis);
    m.tilt = tilt; m.coarseId = cid; m.vis = vis3;
    return m;
}
fn microFacets(pM: vec3f, n: vec3f, triId: f32, amp: f32, cellSize: f32, jitter: f32, coarseScale: f32, footprint: f32) -> Micro {
    return microLevels(pM, n, triId, amp, cellSize, jitter, coarseScale, footprint, 7u);
}

// ── FrostBRDF.hlsl ──────────────────────────────────────────────────────────
// Gem lobe with three per-channel powers: red widest, blue tightest, so a
// highlight fringes like a prism. _GemSharpness is 2.0 (material default).
fn gemSpecS(ndh: f32, shininess: f32, sharp: f32) -> vec3f {
    let x = max(ndh, 0.0); let s = shininess * sharp;
    return vec3f(pow(x, s * 0.85), pow(x, s * 1.25), pow(x, s * 1.90));
}
fn gemSpec(ndh: f32, shininess: f32) -> vec3f { return gemSpecS(ndh, shininess, 2.0); }
fn schlick(ndv: f32, f0: f32) -> f32 { let x = sat(1.0 - ndv); return f0 + (1.0 - f0) * x * x * x * x * x; }

// ── FrostSparkle.hlsl ───────────────────────────────────────────────────────
// Very tight lobes on the micro-facet normal. u.sparkle is _Sparkle.
fn sparkleGlint(nm: vec3f, h: vec3f, facetId: f32, cov: f32) -> f32 {
    return pow(max(dot(nm, h), 0.0), 1400.0) * cov * 5.0 * (0.4 + 1.2 * facetId) * u.sparkle;
}
fn keyGlint(nm: vec3f, h: vec3f, facetId: f32, t: f32) -> f32 {
    let twinkle = 0.5 + 0.5 * sin(t * 3.0 + facetId * 50.0);
    return pow(max(dot(nm, h), 0.0), 900.0) * twinkle * 1.2 * u.sparkle;
}

// ── FrostTone.hlsl ──────────────────────────────────────────────────────────
// Fake sky: dark floor to bright top, linear radiance, no tone curve.
fn envColor(dir: vec3f) -> vec3f {
    let t = dir.y * 0.5 + 0.5;
    return mix(vec3f(0.02, 0.03, 0.05), vec3f(0.45, 0.62, 0.85), t * t);
}

// ── the floor the frost lands on (original) ─────────────────────────────────
// 1.5 m by 1 m steel plates in staggered rows. edge stands in for the HLSL
// curvature signal: 0 at a plate seam, 1 mid-plate. triId stands in for the
// primitive id: two triangles per plate. A few plates are painted amber or
// teal, so the cold front has colour to drain.
fn plateUV(pM: vec3f) -> vec4f {
    let row = floor(pM.z);
    let gx = pM.x / 1.5 + 0.5 * (row - 2.0 * floor(row * 0.5));
    return vec4f(fract(gx), fract(pM.z), floor(gx), row);
}
fn tileAt(pM: vec3f) -> vec4f {
    let pl = plateUV(pM); let f = pl.xy; let c = pl.zw;
    let d = min(min(f.x, 1.0 - f.x) * 1.5, min(f.y, 1.0 - f.y));
    let hc = select(0.0, 1.0, f.x + f.y > 1.0);
    let prim = (c.x * 57.0 + c.y * 131.0) * 2.0 + hc;
    return vec4f(smoothstep(0.0, 0.1, d), hash13(vec3f(prim, prim * 0.37, 3.0)), d, hash13(vec3f(c, 4.0)));
}
fn floorAlbedo(pM: vec3f) -> vec3f {
    let ti = tileAt(pM); let h = ti.w;
    var c = mix(vec3f(0.07, 0.075, 0.085), vec3f(0.16, 0.165, 0.18), h);
    if (h > 0.8) { c = vec3f(0.48, 0.2, 0.025); } else if (h < 0.16) { c = vec3f(0.03, 0.2, 0.2); }
    let seam = smoothstep(0.012, 0.035, ti.z);
    let grain = vnoise(vec3f(pM.x * 38.0, pM.z * 5.0, 1.0));
    let rq = abs(plateUV(pM).xy - 0.5) * vec2f(1.5, 1.0) - vec2f(0.68, 0.43);
    let rivet = 1.0 - smoothstep(0.012, 0.02, length(rq));
    c = c * (0.82 + 0.3 * grain) * mix(0.22, 1.0, seam) + rivet * 0.05;
    return c + inkL() * 0.6;
}

// ── FrostShade.hlsl ─────────────────────────────────────────────────────────
// The whole frosted-surface model: crust, cold front, snow, micro-facets, gem
// specular, inner surface, subsurface and sparkle. It returns linear HDR.
// Ported with these changes: one main light (no shadow map, no URP additional
// lights); the faceted flat normal is the floor normal (a plane has one face);
// a mask m gates the aspects the way the _Tog* material floats do.
const T_COLD: u32 = 1u;   const T_TINT: u32 = 2u;   const T_SNOW: u32 = 4u;
const T_MICRO: u32 = 8u;  const T_ENV: u32 = 16u;   const T_GEM: u32 = 32u;
const T_INNER: u32 = 64u; const T_SSS: u32 = 128u;  const T_SPARK: u32 = 256u;
const T_EDGE: u32 = 512u; const T_BASE: u32 = 1024u; const T_BODY: u32 = 2048u;
const T_ALL: u32 = 4095u;
fn tg(m: u32, b: u32) -> f32 { return select(0.0, 1.0, (m & b) != 0u); }

const SKY_COL: vec3f = vec3f(0.16, 0.22, 0.32);
const GND_COL: vec3f = vec3f(0.035, 0.045, 0.065);
const KEY_DIR: vec3f = vec3f(0.24938, 0.79801, 0.54863);   // normalize(0.25, 0.8, 0.55)
const KEY_COL: vec3f = vec3f(0.30, 0.38, 0.52);
const SNOW_COL: vec3f = vec3f(0.94, 0.96, 1.0);
const AMB_K: f32 = 0.6;          // _AmbientBoost
const SSS_AMT: f32 = 1.0;        // _SSSAmount
const FACET_CELL: f32 = 0.12;    // _FacetCellSize (m)
const FACET_AMP: f32 = 1.5;      // _FacetAmp
const FACET_JIT: f32 = 0.85;     // _FacetJitter
const FACET_COARSE: f32 = 1.0;   // _FacetCoarseScale
const LAMP: vec3f = vec3f(1.0, 0.96, 0.9);
const VIEW: vec3f = vec3f(0.0, 0.99287, -0.11915);         // normalize(0, 1, -0.12)

// The main light circles slowly, so the glints travel on hover.
fn keyL(t: f32) -> vec3f { let a = t * 0.35 + 0.8; return normalize(vec3f(0.36 * cos(a), 1.0, 0.36 * sin(a) + 0.14)); }
fn safeNorm(x: vec3f) -> vec3f { return x * inverseSqrt(max(dot(x, x), 1e-8)); }

struct SIn {
    pM: vec3f, n: vec3f, v: vec3f, base: vec3f,
    edge: f32, triId: f32, cov: f32, age: f32, ahead: f32, fp: f32,
    L: vec3f, lamp: vec3f, t: f32, cfm: vec3f, snow: f32,
};
fn surfIn(pM: vec3f, fs: FrostSample, t: f32, fp: f32) -> SIn {
    let ti = tileAt(pM);
    var s: SIn;
    s.pM = pM; s.n = vec3f(0.0, 1.0, 0.0); s.v = VIEW; s.base = floorAlbedo(pM);
    s.edge = ti.x; s.triId = ti.y; s.cov = fs.coverage; s.age = fs.age; s.ahead = fs.ahead;
    s.fp = fp; s.L = keyL(t); s.lamp = LAMP; s.t = t; s.cfm = vec3f(1.0); s.snow = 0.5;
    return s;
}
// The bare floor under the main light and the ambient, with no frost.
fn bareLit(s: SIn) -> vec3f {
    let amb0 = mix(GND_COL, SKY_COL, s.n.y * 0.5 + 0.5);
    return s.base * (amb0 * AMB_K + s.lamp * max(dot(s.n, s.L), 0.0));
}

// Cold-front recolour: drain the colour, wet it, dust the ridges with hoar.
fn coldRecolor(albedo0: vec3f, cf: ColdFront, pM: vec3f, nv: vec3f) -> vec3f {
    var albedo = albedo0;
    let lum = dot(albedo, vec3f(0.3, 0.59, 0.11));
    let dew = pow(ridge(pM * 26.0), 2.0);
    let chilled = mix(vec3f(lum), deepL() * lum * 1.6, 0.35) * (0.92 + dew * 0.12);
    albedo = mix(albedo, chilled, cf.chill * 0.55);
    albedo = albedo * (1.0 - cf.sweat * 0.10);
    let upness = sat(nv.y * 0.6 + 0.55);
    let crevice = pow(ridge(pM * 11.0), 2.0);
    albedo = mix(albedo, mix(deepL(), whiteL(), 0.7), cf.hoar * (0.2 + 0.35 * upness + 0.45 * crevice) * 0.38);
    return albedo;
}

fn frostShade(s: SIn, m: u32) -> vec3f {
    let cov = s.cov; let age = s.age; let pM = s.pM; let v = s.v; let nv = normalize(s.n);
    let amb_k = AMB_K; let cryst = max(amb_k, 0.4);
    var cf = coldEval(s.ahead, 1.0 - cov);
    let tc = tg(m, T_COLD);
    cf.chill *= tc * s.cfm.x; cf.sweat *= tc * s.cfm.y; cf.hoar *= tc * s.cfm.z;
    let cfSum = cf.chill + cf.sweat + cf.hoar;

    // Bare early-out: no ice here. The cold front still recolours the base.
    if (cov < 0.002) {
        let amb0 = mix(GND_COL, SKY_COL, nv.y * 0.5 + 0.5);
        var baseCol = s.base;
        if (cfSum > 0.001) { baseCol = coldRecolor(s.base, cf, pM, nv); }
        return baseCol * (amb0 * amb_k + s.lamp * max(dot(nv, s.L), 0.0)) * tg(m, T_BASE);
    }

    let n = nv;
    let mic = microFacets(pM, n, s.triId, FACET_AMP, FACET_CELL, FACET_JIT, FACET_COARSE, s.fp);
    let nm = normalize(mix(n, mic.normal, tg(m, T_MICRO)));
    let mfid = mic.facetId;

    let r = rindEval(pM, cov, age, s.edge);
    let rind = r.body; let hug = hugF(s.edge); let ec = edgeCore(s.edge);
    // frost_a: how much of the frost look this pixel wears.
    let frost_a = sat(cov * (0.18 + 0.14 * age + 0.42 * hug + 0.30 * ec));
    let tintThick = sat(hug + ec);
    let bands = bandWeights(cov, 0.33, 0.66);
    let bandTint = bands.x * 0.7 + bands.y * 0.9 + bands.z * 1.0;
    let tint_a = frost_a * mix(0.35, 1.0, tintThick) * tg(m, T_TINT) * bandTint;
    var albedo = mix(s.base, r.albedo * (0.92 + s.triId * 0.16), tint_a);

    // Dry snow.
    let upface = sat(nv.y);
    if (s.snow > 0.001 && tg(m, T_SNOW) > 0.5) {
        let bank = pow(sat(1.0 - s.edge * 1.6), 1.3);
        let grain = vnoise(pM * 70.0) * 0.5 + 0.5;
        let snow_col = SNOW_COL * (0.85 + grain * 0.2);
        let drift = cov * upface * bank * smoothstep(0.1, 0.9, age * (0.6 + 0.6 * s.snow)) * s.snow;
        albedo = mix(albedo, snow_col, min(sat(drift * 1.4), 0.95));
        let dust = cov * upface * smoothstep(0.45, 0.8, vnoise(pM * 3.0 + 3.0)) * s.snow * 0.35 * age;
        albedo = mix(albedo, snow_col, dust);
    }
    if (cfSum > 0.001) { albedo = coldRecolor(albedo, cf, pM, nv); }

    let ndv = max(dot(nm, v), 0.0);
    let fres = pow(1.0 - ndv, 2.5);
    let fres_n = pow(1.0 - max(dot(n, v), 0.0), 2.5);
    let refl = reflect(-v, nm);

    let amb = mix(GND_COL, SKY_COL, n.y * 0.5 + 0.5);
    var color = albedo * (amb + KEY_COL * max(dot(n, KEY_DIR), 0.0) * 0.55) * amb_k;
    var crystal = vec3f(0.0);
    let te = tg(m, T_EDGE);
    crystal += vec3f(0.55, 0.75, 1.0) * ec * cov * 0.10 * amb_k * te;
    crystal += vec3f(0.35, 0.55, 0.85) * fres_n * cf.sweat * 0.18 * amb_k;

    // Crystal reflection and the inner second surface.
    let env = envColor(refl) * cov * rind * cryst * tg(m, T_ENV);
    crystal += env * (0.10 + fres * 0.55);
    let key_h = safeNorm(KEY_DIR + v);
    crystal += gemSpec(dot(nm, key_h), 260.0) * KEY_COL * cov * rind * 1.6 * (0.6 + 0.8 * mfid) * cryst * tg(m, T_GEM);
    let fid3 = hash33(vec3f(s.triId * 97.0, s.triId * 31.0 + 5.0, 7.0));
    let inner = normalize(nm + (fid3 * 2.0 - 1.0) * 0.6);
    let t_dir = refract(-v, nm, 0.76);
    let refl_i = reflect(t_dir, inner);
    let ti = tg(m, T_INNER);
    crystal += envColor(refl_i) * cov * rind * 0.35 * (1.0 - fres) * cryst * ti;
    crystal += gemSpec(dot(inner, key_h), 120.0) * KEY_COL * cov * rind * 0.8 * cryst * ti;

    // Subsurface palette and the depth proxy (thick).
    let thick = 0.30 + 0.45 * age + 0.35 * ec + 0.25 * hug;
    let sss_col = mix(vec3f(0.50, 0.74, 1.0), vec3f(0.88, 0.94, 1.0), sat(age * 0.5 + ec * 0.4));
    let shin = mix(18.0, 420.0, cov);

    // Main light.
    let L = s.L; let lampCol = s.lamp; let shadow = 1.0;
    let h = safeNorm(L + v);
    let diff = max(dot(n, L), 0.0);
    let specGem = gemSpec(dot(nm, h), shin) * cov * rind * 2.2 * (0.5 + 1.0 * mfid) * tg(m, T_GEM);
    let specBase = pow(max(dot(n, h), 0.0), 18.0) * (0.15 + cf.sweat * 0.2) * (1.0 - cov);
    let specIn = gemSpec(dot(inner, h), 140.0) * cov * rind * 0.9 * ti;
    color += lampCol * shadow * (albedo * diff + specBase);
    crystal += lampCol * shadow * (specGem + specIn);
    crystal += vec3f(0.85, 0.93, 1.0) * ec * cov * shadow * 0.35 * te;
    crystal += vec3f(0.55, 0.72, 0.95) * cov * shadow * (0.05 + age * 0.08 + hug * 0.10) * (1.0 - fres * 0.5) * tg(m, T_BODY);
    crystal += vec3f(0.55, 0.80, 1.0) * fres * cov * rind * 0.6 * shadow * te;

    let tsss = tg(m, T_SSS);
    let sss_l = normalize(L + n * 0.35);
    let forward = pow(max(dot(v, -sss_l), 0.0), 2.5) * 0.9 + 0.25;
    crystal += sss_col * lampCol * forward * mix(shadow, 1.0, 0.35) * cov * thick * 0.85 * SSS_AMT * tsss;
    let wrap = dot(n, KEY_DIR) * 0.5 + 0.5;
    crystal += sss_col * (KEY_COL * wrap * 0.55 + SKY_COL * 0.35) * cov * thick * cryst * SSS_AMT * tsss;

    let tsp = tg(m, T_SPARK);
    crystal += vec3f(1.0, 0.98, 0.92) * sparkleGlint(nm, h, mfid, cov) * rind * shadow * tsp;
    crystal += vec3f(0.95, 0.98, 1.0) * keyGlint(nm, key_h, mfid, s.t) * cov * rind * amb_k * tsp;

    return color * tg(m, T_BASE) + crystal * frost_a;
}

// FrostDecalFrost (FrostShade.hlsl): a thin veil plus the crystal highlights
// only, premultiplied, so a painted marking stays legible under the ice.
fn decalFrost(s: SIn, strength: f32) -> vec4f {
    let cov = s.cov;
    if (cov < 0.002 || strength < 1e-4) { return vec4f(0.0); }
    let mic = microFacets(s.pM, normalize(s.n), s.triId, FACET_AMP, FACET_CELL, FACET_JIT, FACET_COARSE, s.fp);
    let nm = mic.normal; let mfid = mic.facetId;
    let fres = pow(1.0 - max(dot(nm, s.v), 0.0), 2.5);
    let h = safeNorm(s.L + s.v); let key_h = safeNorm(KEY_DIR + s.v);
    var sheen = gemSpec(dot(nm, h), 260.0) * s.lamp * (0.6 + 0.8 * mfid) * 1.6;
    sheen += gemSpec(dot(nm, key_h), 260.0) * KEY_COL * (0.6 + 0.8 * mfid);
    sheen += envColor(reflect(-s.v, nm)) * fres * 0.6;
    sheen += whiteL() * fres * 0.30;
    sheen += vec3f(1.0, 0.98, 0.92) * sparkleGlint(nm, h, mfid, cov);
    sheen += vec3f(0.95, 0.98, 1.0) * keyGlint(nm, key_h, mfid, s.t);
    sheen *= cov;
    let veil = mix(deepL(), whiteL(), 0.35);
    let st = sat(strength);
    let aTint = sat(cov * 0.28) * st;
    return vec4f(veil * aTint + sheen * st, aTint);
}

// ── FrostMelt.hlsl ──────────────────────────────────────────────────────────
// The melt recedes from the frozen edge inward. resist is 1 at the seed and
// 0 at the edge, roughened by a ridged break-up; energy is the progress plus
// the local heat. since = energy - resist gives the wet then dry stages, so
// the melt keeps no state. Defaults: patch 0.9, noise scale 2.5, wet band
// 0.18, dry band 0.4.
struct Melt { keep: f32, wet: f32 };
fn meltBreakup(pM: vec3f, scale: f32) -> f32 {
    let f = max(scale, 1e-3);
    return sat(0.6 * ridge(pM * f) + 0.3 * ridge(pM * f * 2.03));
}
fn meltResist(pM: vec3f, front: f32, pch: f32, scale: f32) -> f32 {
    let radialN = length(pM) / max(front, 1e-3);
    let br = (meltBreakup(pM, scale) - 0.5) * pch * 0.5;
    return sat((1.0 - radialN) + br);
}
fn meltEval(pM: vec3f, front: f32, progress: f32, heat: f32, wetBand: f32, dryBand: f32, pch: f32, scale: f32) -> Melt {
    let resist = meltResist(pM, front, pch, scale);
    let wb = max(wetBand, 1e-3); let db = max(dryBand, 1e-3);
    let span = 1.0 + wb + db;
    let since = sat(progress) * span + heat - resist;
    return Melt(1.0 - smoothstep(0.0, wb, since), smoothstep(0.0, wb * 0.5, since) * (1.0 - smoothstep(wb, wb + db, since)));
}
// One term of FrostFireHeat: src.xy is the source in metres on the floor,
// src.z its radius. The HLSL sums up to eight hazard sources; a cell sums its
// own few.
fn heatTerm(pM: vec3f, src: vec3f, radiusMul: f32, falloff: f32) -> f32 {
    let r = max(src.z * radiusMul, 1e-3);
    let t = sat(1.0 - length(pM.xz - src.xy) / r);
    return pow(t, max(falloff, 1e-3));
}
// The wet sheen from FrostForwardPass.hlsl: a just-melted point reads dark
// and shiny, then dries to the bare floor. _MeltWetShine is 0.85.
fn wetComposite(lit: vec3f, s: SIn, wet: f32, cov: f32) -> vec3f {
    if (wet <= 0.001) { return lit; }
    let hw = safeNorm(s.L + s.v);
    let specW = pow(max(dot(s.n, hw), 0.0), 200.0);
    let fresW = pow(1.0 - max(dot(s.n, s.v), 0.0), 4.0);
    let wetCol = s.lamp * specW * 2.2 + envColor(reflect(-s.v, s.n)) * fresW * 0.5;
    let share = sat(sat(wet * 0.85) - cov);
    return mix(lit, wetCol, share);
}
// One loop of the zone: grow (x = front 0..1), hold, melt (y = progress).
// Derived from time only, so a bare zone re-freezes with no reset.
fn frostCycle(t: f32, period: f32, off: f32) -> vec2f {
    let a = fract(t / period + off);
    return vec2f(smoothstep(0.0, 0.4, a), smoothstep(0.55, 0.9, a));
}
// The front for the grow-only cells: out from the seed, hold, restart.
fn growFront(t: f32, period: f32, off: f32, rMax: f32) -> f32 {
    return mix(0.15, rMax, smoothstep(0.0, 0.75, fract(t / period + off)));
}

// ── FrostVignette.shader ────────────────────────────────────────────────────
// Screen frost that grows in from the edges (or out from the centre in the
// badge mode). The boundary is a two-octave domain warp plus a fine ridge
// jitter; the body is fern veins. Triangles appear only as a fine facet glint.
// Colours here are display values, the way the UI overlay writes them.
struct VigCfg { intensity: f32, reach: f32, tendril: f32, soft: f32, cellSize: f32, maxA: f32, sparkle: f32, flit: f32, radial: f32, sparkMode: f32, triCov: f32 };
fn vigDefault() -> VigCfg { return VigCfg(1.0, 0.35, 0.6, 0.06, 0.16, 0.3, 0.5, 0.5, 0.0, 0.0, 0.0); }
// The fix: each facet pulses on its own slow sine phase.
fn facetSparkle(P: vec2f, cs: f32, t: f32) -> f32 {
    let g = P / max(cs * 0.30, 1e-4);
    let sk = vec2f(g.x - g.y * 0.57735, g.y * 1.1547);
    let cell = floor(sk); let f = fract(sk);
    let hc = select(0.0, 1.0, f.x + f.y > 1.0);
    let id = hash13(vec3f(cell, hc + 0.37));
    let tw = 0.5 + 0.5 * sin(t * 1.5 + id * 6.28318);
    return pow(tw, 12.0);
}
// BEFORE (reconstructed): the old code hashed a moving value with
// fract(sin(x) * k). A tiny change in x jumps the result, so it strobes.
fn facetStrobe(P: vec2f, cs: f32, t: f32) -> f32 {
    let g = P / max(cs * 0.30, 1e-4);
    let sk = vec2f(g.x - g.y * 0.57735, g.y * 1.1547);
    let cell = floor(sk); let f = fract(sk);
    let hc = select(0.0, 1.0, f.x + f.y > 1.0);
    let id = hash13(vec3f(cell, hc + 0.37));
    let tw = fract(sin(id * 91.7 + t * 1.5) * 43758.5453);
    return pow(tw, 12.0);
}
// BEFORE (reconstructed): coverage decided per coarse triangle. Each triangle
// tests the field at its centroid, so the front steps in a triangle grid.
fn triCoverage(P: vec2f, c: VigCfg, inner: f32) -> vec2f {
    let size = c.cellSize * 0.55;
    let g = P / size;
    let sk = vec2f(g.x - g.y * 0.57735, g.y * 1.1547);
    let cell = floor(sk); let f = fract(sk);
    let hc = select(0.0, 1.0, f.x + f.y > 1.0);
    let cen = cell + select(vec2f(1.0 / 3.0), vec2f(2.0 / 3.0), hc > 0.5);
    let gy = cen.y / 1.1547; let gx = cen.x + gy * 0.57735;
    let uvc = vec2f(gx, gy) * size;
    let field = length(abs(uvc - 0.5) * 2.0) + (hash13(vec3f(cell, hc)) - 0.5) * 0.14;
    return vec2f(step(inner, field), sat((field - inner) / 0.6));
}
fn vignette(uv: vec2f, t: f32, c: VigCfg) -> vec4f {
    let P = uv;   // aspect 1 in a square tile
    let p3 = vec3f(P / max(c.cellSize, 1e-4), 7.3);
    let warpLo = vec2f(fbm(p3 * 0.7), fbm(p3 * 0.7 + 31.4)) - 0.5;
    let warpHi = vec2f(fbm(p3 * 3.3), fbm(p3 * 3.3 + 12.7)) - 0.5;
    let uvw = uv + warpLo * (c.tendril * 0.28) + warpHi * (c.tendril * 0.07);
    var cov = 0.0; var depth = 0.0;
    if (c.radial > 0.5) {
        let rr = length((uvw - 0.5) * 2.0);
        let discR = mix(0.05, 0.95, c.intensity);
        let soft = 0.04 + c.soft;
        cov = sdown(discR + soft, discR - soft, rr);
        depth = sat((discR - rr) / 0.6);
    } else {
        var field = length(abs(uvw - 0.5) * 2.0);
        field += (ridge(p3 * 5.0) - 0.5) * 0.07;
        let inner = mix(1.25, 0.5, sat(c.reach));
        let soft = 0.02 + c.soft;
        cov = smoothstep(inner, inner + soft, field);
        depth = sat((field - inner) / 0.6);
        if (c.triCov > 0.5) { let tc = triCoverage(P, c, inner); cov = tc.x; depth = tc.y; }
    }
    let fern = pow(ridge(p3 * 2.0), 3.0);
    let hug = pow(1.0 - sat(depth), 1.5);
    // The vignette material defaults are Frost Deep (0.40, 0.62, 0.95) and
    // Frost White (0.70, 0.83, 1.0); these scales map the swatches onto them.
    let vDeep = u.tone.rgb * vec3f(0.71, 0.8, 1.0);
    let vWhite = u.cream.rgb * vec3f(0.75, 0.86, 1.0);
    var col = mix(vDeep, vWhite, sat(0.30 + depth * 0.25 + hug * 0.25 + fern * 0.30));
    let lum = max(col.r, max(col.g, col.b));
    col = mix(col, vec3f(lum), 0.15);
    var sp = facetSparkle(P, c.cellSize, t);
    if (c.sparkMode > 0.5) { sp = facetStrobe(P, c.cellSize, t); }
    col += sp * c.sparkle * cov;
    let opac = 0.18 + 0.40 * hug + 0.30 * fern;
    var a = cov * sat(opac) * c.maxA;
    if (c.radial > 0.5) {
        var flit = 0.0;
        for (var i: i32 = 0; i < 6; i++) {
            let fk = f32(i);
            let phase = floor(t * 0.6 + fk);
            let r = hash33(vec3f(fk * 13.1, fk * 7.7, phase));
            let life = fract(t * 0.6 + fk);
            flit += sdown(0.03, 0.0, length(uv - r.xy)) * sin(life * 3.14159);
        }
        flit *= c.flit;
        col += vWhite * flit * 0.6;
        a = sat(a + flit * 0.5);
    } else {
        a *= c.intensity;
    }
    return vec4f(col, sat(a));
}
// The game view under the screen frost (original): a lit floor, display space.
fn screenBg(p: vec2f, t: f32) -> vec3f {
    let pM = toM(p + vec2f(t * 0.01, 0.0), 5.0);
    var s = surfIn(pM, FrostSample(0.0, 0.0, 9.0, -9.0), t, 0.03);
    let spot = exp(-dot(p, p) * 4.0);
    let g = dot(bareLit(s), vec3f(0.3, 0.59, 0.11));
    return toDisp(mix(vec3f(g), bareLit(s), 0.4) * (0.2 + 0.6 * spot) + inkL());
}

// ── FrostSprite.shader ──────────────────────────────────────────────────────
// A procedural sprite stands in for the texture: a radiation trefoil with red
// blades and an amber hub and ring. Display-space rgb plus alpha.
fn spriteTex(q: vec2f, aa: f32) -> vec4f {
    let r = length(q); let a = atan2(q.y, q.x);
    let seg = TAU / 3.0;
    let rel = abs(fract((a - PI * 0.5) / seg + 0.5) - 0.5) * seg;
    let blade = max(max(0.12 - r, r - 0.36), sin(min(rel, 1.5) - PI / 6.0) * r);
    let hub = r - 0.07;
    let ring = abs(r - 0.43) - 0.028;
    let dAmb = min(hub, ring);
    let d = min(blade, dAmb);
    let al = 1.0 - smoothstep(-aa, aa, d);
    let rgb = select(vec3f(0.86, 0.13, 0.09), vec3f(1.0, 0.72, 0.1), dAmb < blade);
    return vec4f(rgb * (0.9 + 0.1 * sdown(0.45, 0.0, r)), al);
}
// Min and max sprite alpha a reach away, in eight directions.
fn alphaMinMax(q: vec2f, reach: f32, aa: f32) -> vec2f {
    let d = reach * 0.70710678;
    var o = array<vec2f, 8>(vec2f(reach, 0.0), vec2f(-reach, 0.0), vec2f(0.0, reach), vec2f(0.0, -reach),
                            vec2f(d, d), vec2f(-d, d), vec2f(d, -d), vec2f(-d, -d));
    var lo = 1.0; var hi = 0.0;
    for (var i: i32 = 0; i < 8; i++) { let a = spriteTex(q + o[i], aa).a; lo = min(lo, a); hi = max(hi, a); }
    return vec2f(lo, hi);
}
// The FrostSprite fragment. fillDeep is the Frost Blue (0.14, 0.26, 0.52);
// edgeCol is the Outline Cyan (0.25, 0.85, 1.0). naive = 1 swaps the two-step
// fade for one direct lerp, the path the HLSL avoids.
fn frostSprite(q: vec2f, cov: f32, t: f32, aa: f32, reachUv: f32, strength: f32, naive: f32) -> vec4f {
    let tex = spriteTex(q, aa);
    let c = sat(cov);
    let fillDeep = mix(vec3f(0.14, 0.26, 0.52), u.tone.rgb * 0.5, 0.5);
    let lum = dot(tex.rgb, vec3f(0.299, 0.587, 0.114));
    var fill = mix(tex.rgb, vec3f(lum), sat(c * 2.0));
    fill = mix(fill, fillDeep, sat(c * 2.0 - 1.0));
    if (naive > 0.5) { fill = mix(tex.rgb, fillDeep, c); }
    fill = mix(fill, vec3f(0.55, 0.72, 0.92), c * 0.15);
    let mm = alphaMinMax(q, reachUv * c, aa);
    let edgeSig = max(sat(tex.a - mm.x), sat(mm.y - tex.a));
    let band = smoothstep(0.50, 0.85, edgeSig);
    let lip = smoothstep(0.78, 0.96, edgeSig);
    let outlineCol = mix(vec3f(0.25, 0.85, 1.0), vec3f(0.92, 0.98, 1.0), lip * 0.7);
    let pulse = 0.80 + 0.20 * sin(t * 2.0);
    let outline = sat(band * c * strength * pulse);
    let rgb = mix(fill, outlineCol, outline);
    let fillA = tex.a * mix(1.0, 0.30, c);
    return vec4f(rgb, max(fillA, outline));
}

// ── zone footprint (original) ───────────────────────────────────────────────
// A frost zone as a smooth union of soft ellipses, for irregular rooms.
fn sdEllipse(p: vec2f, r: vec2f) -> f32 {
    let k0 = length(p / r); let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = sat(0.5 + 0.5 * (b - a) / k); return mix(b, a, h) - k * h * (1.0 - h); }
fn footprintSd(q: vec2f, t: f32, soft: f32) -> f32 {
    var d = 1e5;
    for (var i: i32 = 0; i < 5; i++) {
        let fi = f32(i);
        let h = hash33(vec3f(fi, 3.0, 11.0));
        let c = vec2f(cos(fi * 2.4 + 0.3), sin(fi * 2.4 + 0.3)) * (0.08 + 0.2 * h.x) + vec2f(0.0, 0.02 * sin(t * 0.7 + fi));
        let r = vec2f(0.12 + 0.12 * h.y, 0.07 + 0.08 * h.z) * (1.0 + 0.08 * sin(t * 0.5 + fi * 1.7));
        let e = sdEllipse(rot2(fi * 1.3 + 0.2 * sin(t * 0.3)) * (q - c), r);
        d = smin(d, e, soft);
    }
    return d;
}

// ── the 56 cells ─────────────────────────────────────────────────────────────
@fragment fn fs_radial_front(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // FrostRadialFront only: distance from the seed, no veins, no fingers.
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.veinDepth = 0.0; c.fingerAmp = 0.0; c.cband = 0.12 * mix(0.5, 4.0, k.x);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.34, 2.9)), c);
  return present(frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL));
}

@fragment fn fs_vein_bulge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // FrostVeinBias adds (v - 0.35) * depth to the radial front. The band keeps
  // one width everywhere, so the edge stays crisp.
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.fingerAmp = 0.0;
  c.veinDepth = mix(0.05, 0.8, k.x); c.veinFreq = mix(0.6, 2.4, k.y); c.cband = 0.12 * mix(0.5, 4.0, k.z);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.34, 2.9)), c);
  return present(frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL));
}

@fragment fn fs_vein_warp_fail(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // Reconstruction of the removed approach. FrostField.hlsl records that a
  // multiplicative warp stretched the band and grew long tendrils. Here the
  // vein term scales the front, so the reach grows with the front itself.
  let pM = toM(uv, 4.0);
  let fr = growFront(t, 12.0, 0.34, 2.9);
  let v = sat(pow(ridge(pM * mix(0.6, 2.4, k.y)), 3.0));
  let fs = sampleFrom(fr * (1.0 + mix(0.6, 2.6, k.x) * (v - 0.35)) - length(pM), 0.12, 1.5);
  return failMark(uv, present(frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL)));
}

@fragment fn fs_dendrite_fingers(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault();
  c.fingerAmp = mix(0.5, 4.0, k.x); c.noiseScale = mix(0.8, 3.0, k.y); c.veinDepth = mix(0.0, 0.7, k.z);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.34, 2.9)), c);
  return present(frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL));
}

@fragment fn fs_band_early_out(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // Inside and outside the ring the field is settled, so the noise is skipped.
  // The bright rim of the ring is where w fades the noise to zero.
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.veinDepth = mix(0.1, 0.7, k.x); c.fingerAmp = mix(0.3, 2.5, k.y);
  let radial = radialFront(pM, growFront(t, 12.0, 0.34, 2.9));
  let fs = fieldSample(pM, radial, c);
  let col = frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL);
  let band = c.cband * 0.5 + 0.65 * c.veinDepth + 0.15 * c.fingerAmp;
  let inB = 1.0 - step(band, abs(radial));
  let w = 1.0 - smoothstep(band * 0.75, band, abs(radial));
  let grey = vec3f(dot(col, vec3f(0.3, 0.59, 0.11)));
  var o = mix(grey * 0.5, col + vec3f(0.35, 0.16, 0.03) * (0.25 + 0.6 * (1.0 - w)), inB);
  o += vec3f(0.9, 0.5, 0.15) * (1.0 - smoothstep(0.0, 0.03, abs(abs(radial) - band))) * 0.8;
  return present(o);
}

@fragment fn fs_coverage_view(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // FrostForwardPass writes smoothstep(0,.5), (.25,.75), (.5,1) of coverage
  // to r, g, b. The table maps the three steps onto the ink, deep and white.
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.12 * mix(2.0, 9.0, k.x); c.fingerAmp = mix(0.5, 3.0, k.y);
  let cv = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.34, 2.9)), c).coverage;
  var o = mix(inkL(), deepL() * 0.35, smoothstep(0.0, 0.5, cv));
  o = mix(o, deepL(), smoothstep(0.25, 0.75, cv));
  o = mix(o, whiteL(), smoothstep(0.5, 1.0, cv));
  return show(o);
}

@fragment fn fs_age_view(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // FrostForwardPass age view: (age * 0.3, age * 0.6, age).
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.ageDist = mix(0.5, 3.0, k.x); c.veinDepth = mix(0.0, 0.8, k.y);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.34, 2.9)), c);
  let a = fs.age * fs.coverage;
  return vec4f(pow(vec3f(a * 0.3, a * 0.6, a), vec3f(0.8)) * u.exposure, 1.0);
}

@fragment fn fs_frost_surface(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.veinDepth = mix(0.1, 0.7, k.x); c.fingerAmp = mix(0.3, 3.0, k.y); c.cband = 0.2;
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 14.0, 0.38, 3.0)), c);
  var s = surfIn(pM, fs, t, px * 4.0); s.snow = k.z;
  return present(frostShade(s, T_ALL));
}

@fragment fn fs_chill_drain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.3;
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6) + (k.x - 0.5)), c);
  var s = surfIn(pM, fs, t, px * 4.0); s.cfm = vec3f(1.0, 0.0, 0.0);
  let cf = coldEval(fs.ahead, 1.0 - fs.coverage);
  if (uv.x < 0.0) { return show(ramp(cf.chill * 0.8 + fs.coverage) * smoothstep(0.0, 0.008, abs(uv.x))); }
  return present(frostShade(s, T_ALL));
}

@fragment fn fs_sweat_wet(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.3;
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6) + (k.x - 0.5)), c);
  var s = surfIn(pM, fs, t, px * 4.0); s.cfm = vec3f(0.0, 1.0, 0.0);
  let cf = coldEval(fs.ahead, 1.0 - fs.coverage);
  if (uv.x < 0.0) { return show(ramp(cf.sweat * 0.8 + fs.coverage) * smoothstep(0.0, 0.008, abs(uv.x))); }
  return present(frostShade(s, T_ALL));
}

@fragment fn fs_hoar_dust(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.3;
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6) + (k.x - 0.5)), c);
  var s = surfIn(pM, fs, t, px * 4.0); s.cfm = vec3f(0.0, 0.0, 1.0);
  let cf = coldEval(fs.ahead, 1.0 - fs.coverage);
  if (uv.x < 0.0) { return show(ramp(cf.hoar * 0.8 + fs.coverage) * smoothstep(0.0, 0.008, abs(uv.x))); }
  return present(frostShade(s, T_ALL));
}

@fragment fn fs_coldfront_recolor(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.3; c.veinDepth = mix(0.0, 0.7, k.y);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6) + (k.x - 0.5)), c);
  return present(frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL));
}

@fragment fn fs_barrier_feather(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // FrostForwardPass overlay: composite = max(coverage, barrier), then the
  // frost colour blends over the bare plate by that composite.
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.3;
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6) + (k.x - 0.5)), c);
  let s = surfIn(pM, fs, t, px * 4.0);
  let cf = coldEval(fs.ahead, 1.0 - fs.coverage);
  let barrier = sat(cf.hoar * 0.85 + cf.sweat * 0.35) * 0.7;
  let comp = max(fs.coverage, barrier);
  let frost = frostShade(s, T_ALL) + deepL() * barrier * 0.12;
  return present(mix(bareLit(s), frost, comp));
}

@fragment fn fs_lead_band(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.12 * mix(3.0, 10.0, k.x);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6)), c);
  let col = frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL);
  let w = bandWeights(fs.coverage, 0.33, 0.66).x;
  return present(mix(col * 0.35, col + mix(deepL(), whiteL(), 0.3) * 0.55, w));
}

@fragment fn fs_mid_band(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.12 * mix(3.0, 10.0, k.x);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6)), c);
  let col = frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL);
  let w = bandWeights(fs.coverage, 0.33, 0.66).y;
  return present(mix(col * 0.35, col + mix(deepL(), whiteL(), 0.6) * 0.55, w));
}

@fragment fn fs_full_band(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  var c = cfgDefault(); c.cband = 0.12 * mix(3.0, 10.0, k.x);
  let fs = fieldSample(pM, radialFront(pM, growFront(t, 12.0, 0.3, 1.6)), c);
  let col = frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL);
  let b = bandWeights(fs.coverage, 0.33, 0.66);
  let ringC = deepL() * 0.25 * b.x + deepL() * 0.6 * b.y;
  return present(mix(col * 0.35 + ringC, col + whiteL() * 0.3, b.z));
}

@fragment fn fs_tri_lattice(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let q = uv * mix(20.0, 5.0, k.x);
  let sk = vec2f(q.x - q.y * 0.57735, q.y * 1.1547);
  let cell = floor(sk); let f = fract(sk);
  let hc = select(0.0, 1.0, f.x + f.y > 1.0);
  let id = vec3f(cell, hc) + vec3f(0.0, 10.0, 0.0) + 37.0;
  let tl = (hash33(id).xy - 0.5) * 2.0 * mix(0.1, 0.6, k.y);
  let n = normalize(vec3f(tl.x, 1.0, tl.y));
  let L = keyL(t);
  let e = min(min(f.x, f.y), abs(1.0 - f.x - f.y) * 0.7071);
  let lit = mix(0.15, 1.0, pow(max(dot(n, L), 0.0), 6.0)) + gemSpec(dot(n, safeNorm(L + VIEW)), 60.0).x * 0.6;
  var o = ramp(0.2 + 0.7 * lit) * (0.8 + 0.4 * hash13(id + 3.0));
  o = mix(o, whiteL() * 0.9, (1.0 - smoothstep(0.0, 0.05, e)) * 0.6);
  return show(o);
}

@fragment fn fs_voronoi_crystals(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let q = uv * mix(12.0, 4.0, k.y);
  let sk = vec2f(q.x - q.y * 0.57735, q.y * 1.1547);
  let baseCell = floor(sk); let fc = fract(sk);
  var bestD = 1e9; var bestCell = baseCell; var secD = 1e9;
  for (var gy: i32 = -1; gy <= 1; gy++) { for (var gx: i32 = -1; gx <= 1; gx++) {
    let nb = vec2f(f32(gx), f32(gy)); let cellId = baseCell + nb;
    let jit = (hash33(vec3f(cellId, 7.0)).xy - 0.5) * mix(0.0, 1.0, k.x);
    let dv = nb + 0.5 + jit - fc; let dist = dot(dv, dv);
    if (dist < bestD) { secD = bestD; bestD = dist; bestCell = cellId; } else if (dist < secD) { secD = dist; }
  } }
  let tl = (hash33(vec3f(bestCell, 0.0) + vec3f(0.0, 10.0, 0.0)).xy - 0.5) * 0.8;
  let n = normalize(vec3f(tl.x, 1.0, tl.y));
  let L = keyL(t);
  let lit = pow(max(dot(n, L), 0.0), 4.0) + gemSpec(dot(n, safeNorm(L + VIEW)), 40.0).z * 0.8;
  var o = ramp(0.15 + 0.75 * lit);
  // F1 alone gives the cell; the seam shading here uses F2 - F1 for display only.
  o = mix(o, whiteL(), (1.0 - smoothstep(0.0, 0.08, sqrt(secD) - sqrt(bestD))) * 0.7);
  o *= 0.85 + 0.3 * sqrt(bestD);
  return show(o);
}

@fragment fn fs_lod_levels(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let S = mix(0.25, 1.2, k.x);
  let pM = toM(uv, S);
  let col = i32(clamp(floor((uv.x + 0.5) * 3.0), 0.0, 2.0));
  let m = microLevels(pM, vec3f(0.0, 1.0, 0.0), 0.3, mix(0.5, 3.0, k.y), FACET_CELL, FACET_JIT, FACET_COARSE, px * S, 1u << u32(col));
  // Tilt scaled back to -1..1 for the one level shown (weights 1, 0.55, 0.3).
  let tn = m.tilt * 1.8525 / pow(0.55, f32(col));
  let L = keyL(t);
  let g = gemSpec(dot(m.normal, safeNorm(L + VIEW)), 200.0).y;
  var o = mix(deepL() * 0.45, whiteL(), sat(0.5 + 0.5 * tn.x)) * (0.55 + 0.45 * sat(0.5 + 0.5 * tn.y)) + g * 0.6;
  let sep = 1.0 - smoothstep(0.0, 0.006, abs(fract((uv.x + 0.5) * 3.0 + 0.5) - 0.5) / 3.0);
  o = mix(o, inkL(), sep * 0.9);
  return show(o);
}

@fragment fn fs_footprint_fade(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // The bars at the base show each level visibility (fwidth footprint).
  let S = mix(0.6, 9.0, 0.5 + 0.5 * sin(t * mix(0.2, 0.9, k.x) - 1.2));
  let pM = toM(uv, S);
  let s = surfIn(pM, FrostSample(1.0, 0.8, -1.0, 2.0), t, px * S);
  let m = microFacets(pM, s.n, s.triId, FACET_AMP, FACET_CELL, FACET_JIT, FACET_COARSE, px * S);
  let L = keyL(t);
  let g = sparkleGlint(m.normal, safeNorm(L + VIEW), m.facetId, 1.0);
  var o = mix(deepL() * 0.4, whiteL() * 0.9, sat(0.5 + 0.5 * m.tilt.x)) * (0.6 + 0.4 * sat(0.5 + 0.5 * m.tilt.y)) + g;
  let bx = (uv.x + 0.4) / 0.8;
  if (uv.y < -0.42 && bx > 0.0 && bx < 1.0) {
    let li = i32(clamp(floor(bx * 3.0), 0.0, 2.0));
    let v = m.vis[li];
    let fy = (uv.y + 0.48) / 0.05;
    o = mix(o * 0.3, select(inkL(), whiteL(), fy < v), step(0.0, fy) * step(fy, 1.0) * step(0.08, fract(bx * 3.0)));
  }
  return present(o);
}

@fragment fn fs_facet_normals(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let S = mix(0.8, 3.0, k.y);
  let pM = toM(uv, S);
  let m = microFacets(pM, vec3f(0.0, 1.0, 0.0), tileAt(pM).y, FACET_AMP * mix(0.5, 3.0, k.x), FACET_CELL, FACET_JIT, FACET_COARSE, px * S);
  let nm = m.normal;
  // x lean runs deep to white, z lean sets the brightness.
  var o = mix(deepL() * 0.55, whiteL(), sat(0.5 + nm.x * 2.6));
  o *= 0.35 + 0.9 * sat(0.5 + nm.z * 2.6);
  return show(o);
}

@fragment fn fs_sparkle_glint(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let S = mix(1.0, 3.5, k.x);
  let pM = toM(uv, S);
  var s = surfIn(pM, FrostSample(1.0, 0.7, -1.0, 2.0), t, px * S);
  s.base = inkL() * 2.0 + deepL() * 0.04;
  s.edge = 1.0;
  let body = frostShade(s, T_TINT | T_BASE | T_BODY | T_SSS | T_MICRO) * mix(0.2, 1.2, k.y);
  let m = microFacets(pM, s.n, s.triId, FACET_AMP, FACET_CELL, FACET_JIT, FACET_COARSE, px * S);
  let h = safeNorm(s.L + s.v);
  let g = sparkleGlint(m.normal, h, m.facetId, 1.0);
  return present(body + vec3f(1.0, 0.98, 0.92) * g * 1.6);
}

@fragment fn fs_key_twinkle(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let S = mix(1.0, 3.5, k.x);
  let pM = toM(uv, S);
  var s = surfIn(pM, FrostSample(1.0, 0.7, -1.0, 2.0), t, px * S);
  s.base = inkL() * 2.0 + deepL() * 0.04; s.edge = 1.0;
  // The key half-vector is fixed, so a slow view sway walks the lobe instead.
  s.v = normalize(vec3f(-0.25 + 0.12 * sin(t * 0.3), 0.8, -0.55 + 0.12 * cos(t * 0.23)));
  let body = frostShade(s, T_TINT | T_BASE | T_BODY | T_SSS | T_MICRO) * mix(0.2, 1.2, k.y);
  let m = microFacets(pM, s.n, s.triId, FACET_AMP, FACET_CELL, FACET_JIT, FACET_COARSE, px * S);
  let g = keyGlint(m.normal, safeNorm(KEY_DIR + s.v), m.facetId, t);
  return present(body + vec3f(0.95, 0.98, 1.0) * g * 2.0);
}

@fragment fn fs_gem_prism(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // An ice dome, so the lobe has room to spread. Red uses power 0.85 s,
  // green 1.25 s, blue 1.9 s: a red skirt round a blue-white core.
  let r = length(uv);
  let dome = sat(1.0 - r / 0.44);
  let n0 = normalize(vec3f(uv.x * 2.2, 1.0, uv.y * 2.2));
  let pM = toM(uv, 1.6);
  let m = microFacets(pM, n0, 0.4, FACET_AMP * mix(0.0, 1.5, k.y), FACET_CELL, FACET_JIT, FACET_COARSE, px * 1.6);
  let L = normalize(vec3f(0.5 * cos(t * 0.4 + 2.2), 1.0, 0.5 * sin(t * 0.4 + 2.2)));
  let h = safeNorm(L + VIEW);
  let sp = gemSpecS(dot(m.normal, h), 60.0, mix(0.6, 4.0, k.x));
  let body = ramp(0.12 + 0.35 * pow(1.0 - dome, 3.0)) * 0.6 + deepL() * 0.08 * dome;
  var o = mix(inkL() * 1.4, body + sp * LAMP * 1.8, smoothstep(0.0, 0.02, dome));
  o += deepL() * (1.0 - smoothstep(0.0, 0.012, abs(r - 0.44))) * 0.4;
  return present(o);
}

@fragment fn fs_fern_veins(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, mix(0.6, 2.0, k.x));
  let fern = pow(ridge(pM * 14.0), mix(1.0, 6.0, k.y));
  let fine = pow(ridge(pM * 31.0 + 5.0), 4.0);
  return show(ramp(fern * 0.95 + fine * 0.08));
}

@fragment fn fs_edge_hug(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 2.5);
  let ti = tileAt(pM);
  let edge = smoothstep(0.0, mix(0.1, 0.5, k.x), ti.z);
  let hug = hugF(edge); let ec = edgeCore(edge);
  var o = mix(inkL(), deepL() * 0.7, hug);
  o = mix(o, whiteL(), ec * 0.9);
  o += pow(ridge(pM * 14.0), 3.0) * hug * deepL() * 0.3;
  return show(o);
}

@fragment fn fs_rind_albedo(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 2.5);
  let ti = tileAt(pM);
  // age runs 0 to 1 from left to right; k0 shifts it.
  let r = rindEval(pM, 1.0, sat(uv.x + 0.5 + (k.x - 0.5)), ti.x);
  let L = keyL(t);
  let o = r.albedo * (mix(GND_COL, SKY_COL, 1.0) * AMB_K + LAMP * max(L.y, 0.0) * mix(0.3, 1.0, k.y)) * (0.92 + ti.y * 0.16);
  return present(o * 0.75);
}

@fragment fn fs_rind_opacity(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 2.5);
  let ti = tileAt(pM);
  let cov = mix(0.3, 1.0, k.y);
  let r = rindEval(pM, cov, k.x, ti.x);
  let s = surfIn(pM, FrostSample(cov, k.x, -1.0, 2.0), t, px * 2.5);
  let crust = r.albedo * (SKY_COL * AMB_K + LAMP * max(s.L.y, 0.0));
  return present(mix(bareLit(s), crust, r.opacity));
}

@fragment fn fs_subsurface(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // thick = 0.30 + 0.45 age + 0.35 core + 0.25 hug: thicker at seams and with age.
  let pM = toM(uv, 2.5);
  var s = surfIn(pM, FrostSample(1.0, k.x, -1.0, 2.0), t, px * 2.5);
  let o = frostShade(s, T_SSS) * mix(1.0, 5.0, k.y);
  return present(o + inkL() * 0.5);
}

@fragment fn fs_inner_surface(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 2.0);
  var s = surfIn(pM, FrostSample(1.0, k.x, -1.0, 2.0), t, px * 2.0);
  let o = frostShade(s, T_INNER | T_MICRO) * mix(2.0, 9.0, k.y);
  return present(o + inkL() * 0.5);
}

@fragment fn fs_sky_reflection(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let r = length(uv);
  let dome = sat(1.0 - r / 0.44);
  let pM = toM(uv, 1.8);
  let n0 = normalize(vec3f(uv.x * 3.2, 1.0, uv.y * 3.2));
  let m = microFacets(pM, n0, 0.7, FACET_AMP * mix(0.0, 2.0, k.x), FACET_CELL, FACET_JIT, FACET_COARSE, px * 1.8);
  let v = normalize(vec3f(0.35 * sin(t * 0.25), 0.55, -1.0));
  let refl = reflect(-v, m.normal);
  let fres = pow(1.0 - max(dot(m.normal, v), 0.0), 2.5);
  let env = envColor(refl) * (0.6 + fres * 0.6) * mix(0.8, 2.2, k.y);
  var o = mix(inkL() * 1.4, env + deepL() * 0.05, smoothstep(0.0, 0.02, dome));
  o += whiteL() * (1.0 - smoothstep(0.0, 0.01, abs(r - 0.44))) * 0.25;
  return present(o);
}

@fragment fn fs_snow_drift(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 3.0);
  var s = surfIn(pM, FrostSample(1.0, mix(0.3, 1.0, k.y), -1.0, 2.0), t, px * 3.0);
  s.snow = mix(0.2, 1.0, k.x);
  return present(frostShade(s, T_ALL));
}

@fragment fn fs_melt_resist(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let res = meltResist(pM, 2.1, mix(0.0, 1.8, k.x), mix(1.0, 5.0, k.y));
  var o = ramp(res * 0.95);
  let iso = abs(fract(res * 8.0 + 0.5) - 0.5) / max(fwidth(res * 8.0), 1e-4);
  o = mix(o, whiteL(), (1.0 - smoothstep(0.0, 1.2, iso)) * 0.35 * step(0.02, res));
  return show(o);
}

@fragment fn fs_melt_breakup(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let b = meltBreakup(pM, mix(1.0, 5.0, k.x));
  return show(ramp(pow(b, 2.0)));
}

@fragment fn fs_outside_in(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let c = cfgDefault();
  let prog = fract(t / 12.0 + 0.35);
  let fs0 = fieldSample(pM, radialFront(pM, 2.1), c);
  let ms = meltEval(pM, 2.1, prog, 0.0, mix(0.06, 0.4, k.y), 0.4, mix(0.0, 1.8, k.x), 2.5);
  var fs = fs0; fs.coverage *= ms.keep;
  return present(frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL));
}

@fragment fn fs_wet_then_dry(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let prog = fract(t / 12.0 + 0.35);
  let fs0 = fieldSample(pM, radialFront(pM, 2.1), cfgDefault());
  let ms = meltEval(pM, 2.1, prog, 0.0, mix(0.06, 0.4, k.x), mix(0.1, 0.8, k.y), 0.9, 2.5);
  let cov = fs0.coverage * ms.keep;
  var o = floorAlbedo(pM) * 0.8;
  o = mix(o, deepL() * 0.55, ms.wet * (1.0 - cov));
  o = mix(o, whiteL() * 0.9, cov);
  return show(o);
}

@fragment fn fs_wet_sheen(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let prog = fract(t / 12.0 + 0.35);
  let fs0 = fieldSample(pM, radialFront(pM, 2.1), cfgDefault());
  let ms = meltEval(pM, 2.1, prog, 0.0, mix(0.06, 0.4, k.x), mix(0.1, 0.8, k.y), 0.9, 2.5);
  var fs = fs0; fs.coverage *= ms.keep;
  var s = surfIn(pM, fs, t, px * 4.0);
  s.v = normalize(vec3f(0.0, 1.0, -0.12));
  s.L = normalize(vec3f(0.12 * cos(t * 0.4), 1.0, 0.12 * sin(t * 0.4) - 0.05));
  let lit = frostShade(s, T_ALL);
  return present(wetComposite(lit, s, ms.wet, fs.coverage));
}

@fragment fn fs_hazard_heat(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // FrostFireHeat sums every live source into the melt energy, so two
  // overlapping sources clear more than either alone.
  let pM = toM(uv, 4.0);
  let fs0 = fieldSample(pM, radialFront(pM, 3.2), cfgDefault());
  var heat = 0.0; var glow = 0.0;
  for (var i: i32 = 0; i < 3; i++) {
    let fi = f32(i);
    let a = t * (0.25 + 0.08 * fi) + fi * 2.1;
    let src = vec3f(vec2f(cos(a), sin(a * 1.3)) * (0.5 + 0.35 * fi), mix(0.5, 1.4, k.y));
    heat += heatTerm(pM, src, 1.0, mix(0.3, 2.5, k.z));
    glow += exp(-dot(pM.xz - src.xy, pM.xz - src.xy) * 30.0);
  }
  heat *= mix(0.6, 5.0, k.x);
  let ms = meltEval(pM, 3.2, 0.0, heat, 0.18, 0.4, 0.9, 2.5);
  var fs = fs0; fs.coverage *= ms.keep;
  let s = surfIn(pM, fs, t, px * 4.0);
  let lit = wetComposite(frostShade(s, T_ALL), s, ms.wet, fs.coverage);
  return present(lit + vec3f(1.0, 0.45, 0.12) * glow * 1.5);
}

@fragment fn fs_heat_falloff(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let fs0 = fieldSample(pM, radialFront(pM, 3.2), cfgDefault());
  let side = select(1.0, -1.0, uv.x < 0.0);
  let fall = select(2.4, 0.45, uv.x < 0.0);
  let rad = mix(0.5, 1.3, k.x) * (0.85 + 0.15 * sin(t * 0.8));
  let heat = heatTerm(pM, vec3f(side * 1.0, 0.0, rad), 1.0, fall) * mix(1.0, 5.0, k.y);
  let ms = meltEval(pM, 3.2, 0.0, heat, 0.18, 0.4, 0.9, 2.5);
  var fs = fs0; fs.coverage *= ms.keep;
  let s = surfIn(pM, fs, t, px * 4.0);
  var o = wetComposite(frostShade(s, T_ALL), s, ms.wet, fs.coverage);
  o += vec3f(1.0, 0.45, 0.12) * exp(-dot(pM.xz - vec2f(side, 0.0), pM.xz - vec2f(side, 0.0)) * 40.0) * 1.5;
  o = mix(o, inkL(), 1.0 - smoothstep(0.0, 0.004, abs(uv.x)));
  return present(o);
}

@fragment fn fs_freeze_melt_loop(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let cy = frostCycle(t, mix(10.0, 30.0, k.x), 0.62);
  let fr = mix(0.1, 2.9, cy.x);
  var c = cfgDefault(); c.fingerAmp = mix(0.3, 3.0, k.y); c.cband = 0.2;
  let fs0 = fieldSample(pM, radialFront(pM, fr), c);
  let ms = meltEval(pM, fr, cy.y, 0.0, 0.18, 0.4, 0.9, 2.5);
  var fs = fs0; fs.coverage *= ms.keep;
  let s = surfIn(pM, fs, t, px * 4.0);
  return present(wetComposite(frostShade(s, T_ALL), s, ms.wet, fs.coverage));
}

@fragment fn fs_edge_vignette(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.reach = mix(0.1, 0.9, k.x); c.tendril = k.y; c.maxA = mix(0.5, 1.0, k.z);
  let v = vignette(uv + 0.5, t, c);
  return vec4f(mix(screenBg(uv, t), v.rgb, v.a), 1.0);
}

@fragment fn fs_proximity_ramp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.intensity = 0.55 + 0.45 * sin(t * mix(0.3, 1.2, k.y) + 0.3);
  c.reach = mix(0.2, 0.9, k.x) * (0.6 + 0.4 * c.intensity); c.maxA = 0.95;
  let v = vignette(uv + 0.5, t, c);
  var o = mix(screenBg(uv, t), v.rgb, v.a);
  // The meter on the right reads the intensity (the zone distance input).
  if (uv.x > 0.43 && uv.x < 0.46 && abs(uv.y) < 0.4) {
    o = select(o * 0.3, u.cream.rgb, uv.y + 0.4 < c.intensity * 0.8);
  }
  return vec4f(o, 1.0);
}

@fragment fn fs_radial_badge(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.radial = 1.0; c.intensity = mix(0.3, 0.9, k.x) * (0.9 + 0.1 * sin(t * 0.8)); c.maxA = 0.85; c.flit = mix(0.0, 1.5, k.y);
  let v = vignette(uv + 0.5, t, c);
  return vec4f(mix(toDisp(inkL() * 1.5 + deepL() * 0.02), v.rgb, v.a), 1.0);
}

@fragment fn fs_tendril_warp(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.tendril = mix(0.6, 1.4, k.x); c.cellSize = mix(0.15, 0.45, k.y); c.reach = 0.72; c.maxA = 0.95; c.soft = 0.01;
  let v = vignette(uv + 0.5, t, c);
  return vec4f(mix(screenBg(uv, t) * 0.7, v.rgb, v.a), 1.0);
}

@fragment fn fs_sparkle_sine(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.reach = 0.75; c.maxA = 0.75; c.sparkle = mix(0.5, 3.0, k.x);
  let v = vignette(uv + 0.5, t, c);
  return vec4f(mix(screenBg(uv, t) * 0.6, v.rgb, v.a), 1.0);
}

@fragment fn fs_sparkle_strobe(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.reach = 0.75; c.maxA = 0.75; c.sparkle = mix(0.5, 3.0, k.x); c.sparkMode = 1.0;
  let v = vignette(uv + 0.5, t, c);
  return failMark(uv, vec4f(mix(screenBg(uv, t) * 0.6, v.rgb, v.a), 1.0));
}

@fragment fn fs_tri_coverage_fail(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.reach = mix(0.3, 0.9, k.x); c.maxA = 0.85; c.triCov = 1.0;
  let v = vignette(uv + 0.5, t, c);
  return failMark(uv, vec4f(mix(screenBg(uv, t), v.rgb, v.a), 1.0));
}

@fragment fn fs_fern_body(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  var c = vigDefault();
  c.cellSize = mix(0.08, 0.3, k.x); c.reach = mix(0.5, 1.0, k.y); c.maxA = 1.0; c.sparkle = 0.0;
  let v = vignette(uv + 0.5, t, c);
  return vec4f(mix(toDisp(inkL() * 1.5), v.rgb, v.a), 1.0);
}

@fragment fn fs_sprite_outline(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let q = uv * 1.1; let aa = px * 1.1;
  let tex = spriteTex(q, aa);
  let mm = alphaMinMax(q, mix(0.005, 0.05, k.x), aa);
  let edgeSig = max(sat(tex.a - mm.x), sat(mm.y - tex.a));
  let inside = sat(tex.a - mm.x); let outside = sat(mm.y - tex.a);
  var o = mix(inkL() * 1.5, lin(tex.rgb) * 0.12, tex.a);
  o = mix(o, deepL(), smoothstep(0.5, 0.85, outside));
  o = mix(o, whiteL(), smoothstep(0.5, 0.85, inside));
  return show(o + deepL() * 0.1 * edgeSig);
}

@fragment fn fs_desat_tint(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  // Coverage runs 0 to 1 from left to right across the tile.
  let top = uv.y > 0.0;
  let q = vec2f(fract(uv.x * 3.0 + 0.5) - 0.5, (uv.y - select(-0.25, 0.25, top)) * 3.0) * 1.12;
  let cov = sat((floor(uv.x * 3.0 + 1.5) + 0.5) / 3.0);
  let bg = toDisp(floorAlbedo(toM(uv, 2.0)) * 0.6);
  let fsp = frostSprite(q, cov, 0.0, px * 3.4, 0.0, 0.0, select(1.0, 0.0, top));
  // The fill colour only; the alpha fade shows in frozen_sprite.
  var o = mix(bg, fsp.rgb, spriteTex(q, px * 3.4).a);
  o = mix(o, u.ink.rgb, 1.0 - smoothstep(0.0, 0.006, abs(uv.y)));
  return vec4f(o * u.exposure, 1.0);
}

@fragment fn fs_outline_pulse(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let q = uv * 1.1;
  let bg = toDisp(floorAlbedo(toM(uv, 2.0)) * 0.5);
  let fsp = frostSprite(q, 1.0, t, px * 1.1, mix(0.01, 0.06, k.x), mix(0.4, 1.0, k.y), 0.0);
  return vec4f(mix(bg, fsp.rgb, fsp.a) * u.exposure, 1.0);
}

@fragment fn fs_frozen_sprite(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let q = uv * 1.1;
  let cov = smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(t * mix(0.3, 1.2, k.y) + 1.4));
  let bg = toDisp(floorAlbedo(toM(uv, 2.0)) * 0.6);
  let fsp = frostSprite(q, cov, t, px * 1.1, mix(0.01, 0.05, k.x), 1.0, 0.0);
  return vec4f(mix(bg, fsp.rgb, fsp.a) * u.exposure, 1.0);
}

@fragment fn fs_decal_sheen(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let S = mix(1.2, 3.0, k.y);
  let pM = toM(uv, S);
  let tex = spriteTex(uv * 1.1, px * 1.1);
  var s = surfIn(pM, FrostSample(1.0, 0.8, -1.0, 2.0), t, px * S);
  s.base = mix(floorAlbedo(pM), lin(tex.rgb) * 0.8, tex.a);
  let under = bareLit(s);
  let d = decalFrost(s, mix(0.2, 1.0, k.x));
  return present(under * (1.0 - d.a) + d.rgb);
}

@fragment fn fs_decal_vs_crust(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 2.0);
  let tex = spriteTex(uv * 1.1, px * 1.1);
  var s = surfIn(pM, FrostSample(1.0, mix(0.4, 1.0, k.x), -1.0, 2.0), t, px * 2.0);
  s.base = mix(floorAlbedo(pM), lin(tex.rgb) * 0.8, tex.a);
  s.edge = 0.25;
  var o = frostShade(s, T_ALL);
  if (uv.x > 0.0) { let d = decalFrost(s, 1.0); o = bareLit(s) * (1.0 - d.a) + d.rgb; }
  o = mix(o, inkL(), 1.0 - smoothstep(0.0, 0.004, abs(uv.x)));
  return present(o);
}

@fragment fn fs_footprint_sdf(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let d = footprintSd(uv, t, mix(0.01, 0.12, k.x));
  let inside = 1.0 - smoothstep(-0.004, 0.004, d);
  var o = mix(inkL() * 1.2, deepL() * 0.35, inside);
  let iso = abs(fract(d * 30.0 + 0.5) - 0.5);
  o = mix(o, mix(deepL(), whiteL(), inside), (1.0 - smoothstep(0.0, 0.08, iso)) * 0.35 * exp(-abs(d) * 8.0));
  o = mix(o, whiteL(), 1.0 - smoothstep(0.0, 0.006, abs(d)));
  return show(o);
}

@fragment fn fs_footprint_frost(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fuv(fp.xy);
  let px = length(fwidth(vec3f(uv.x, 0.0, uv.y)));
  let t = u.time;
  let k = u.k;
  let pM = toM(uv, 4.0);
  let d = footprintSd(uv, t, mix(0.01, 0.12, k.x)) * 4.0;
  var c = cfgDefault(); c.fingerAmp = mix(0.5, 3.0, k.y); c.cband = 0.16; c.veinDepth = 0.15;
  let fs = fieldSample(pM, -d, c);
  return present(frostShade(surfIn(pM, fs, t, px * 4.0), T_ALL));
}
