// ============================================================================
//  OUTBREAK  ·  render/infect.js — the infection texture of the land
// ----------------------------------------------------------------------------
//  One GLSL chunk (INFECT_GLSL) that every surface style includes, the
//  infection palette (PAL), the shared uniforms, and a pure JS mirror of
//  the shader math, so node tests can check the look without a GPU.
//
//  Inputs per fragment: the field texel f4 (render/field.js) and the land
//  mask value at the fragment.
//    f4.r  g   prevalence glow 0..1 (log scale of I/N)
//    f4.g  d   deaths share 0..1
//    f4.b  fr  the infection front now: 0.5 at the front, > 0.5 inside
//    f4.a  fr0 the front at the field update before (uFieldMix blends
//              fr0 -> fr between two updates, so the front crawls at the
//              frame rate and not in 4 Hz steps)
//  The position p on the unit sphere comes from the uv (contract axes),
//  so the globe and the flat maps get the same pattern.
//
//  The look, from the bottom up:
//    front    s = (fr - 0.5) + frontAmp (fbm(p) - 0.5) + cellAmp (F1 - 0.35)
//             is a signed distance to the front. The mask m =
//             smoothstep(-fw, fw, s), fw = fwidth(s), so the front is a
//             hard edge about 2 device px wide at every zoom. A bright
//             line (edgePx) marks the front, with a red band just inside.
//    ground   deep blood red, brighter with the prevalence.
//    colonies Voronoi cells (cellScale) light up one by one as the
//             prevalence passes each cell's own threshold, brighter at
//             the cell centre, with a hot core in very active places.
//    stipple  dense arterial dots in a screen-sized cell grid (two
//             octaves, about 4-8 px a cell). The dot radius follows the
//             prevalence, so the density follows it too.
//    veins    the Voronoi cell edges (F2 - F1), constant px width: dark
//             cracks while calm, ember-hot while active.
//    scar     the deaths share pulls the land to crimson-black.
//  Healthy land (fr below INF.frMin) gets no infection colour at all.
//  Ignitions (render/ignite.js): IGN_SLOTS uniforms uIgn[k] = (point,
//  age). Each draws a sharp flash at the city, a shockwave ring of
//  constant px width, and a red bloom of the land inside the ring.
//  uBeat (0..1) is the heartbeat: it lifts the front line and band a
//  little, tied to the daily new cases (heartbeat()).
//
//  Phone: the material defines INF_PHONE (infectDefines(phone)): fbm has
//  2 octaves (not 3), no fine vein octave, one stipple octave.
//
//  The JS mirror (ih1, ih3, vnoise, fbm, cellular, frontS, frontMask,
//  shade) follows the GLSL line by line. It uses float64, so values can
//  differ from the GPU in the last bits; the tests check structure and
//  bounds, not exact pixels.
//
//  grep -n targets: "export const PAL", "export const INF", "export const IGN_SLOTS",
//                   "export function hueSat", "export function infectUniforms",
//                   "export function infectDefines", "export function heartbeat",
//                   "export const INFECT_GLSL", "vec3 infectApply", "function ignAt",
//                   "export function frontS", "export function shade"
// ============================================================================

// The infection palette, display RGB 0..1. One red for land, cities,
// arcs and the HUD (style.css --hot is toHex(PAL.arterial)).
export const PAL = {
  blood: [0.42, 0.0, 0.03],      // deep blood: infected ground
  arterial: [1.0, 0.02, 0.07],   // intense saturated red: colonies, dots, cities, flights
  core: [1.0, 0.46, 0.32],       // hot core: the front line, active outbreaks, flashes
  scar: [0.11, 0.0, 0.012],      // burned-out land: crimson-black
};
// The specification of the red (tests/infect.test.mjs checks PAL against it).
export const RED_SPEC = { hue: [-12, 6], sat: 0.9, coreHue: [0, 20], coreSat: 0.6 };

export const INF = {
  frontScale: 9,        // fbm frequency on the unit sphere (blobs of about 700 km)
  frontAmp: 0.30,       // fbm push of the front, field units (+-0.15)
  cellScale: 26,        // colony cells, about 245 km
  cellAmp: 0.22,        // cell push of the front
  fineScale: 78,        // second vein octave (desktop)
  stipPx: 5,            // target stipple cell size in px
  stipR: 0.42,          // dot radius at prevalence 1, in cell units
  edgePx: 1.3,          // half width of the front line, px
  crackPx: 0.7,         // half width of a vein, px
  bandW: 0.10,          // red band inside the front, field units
  fwMax: 0.05,          // largest fwidth(s) used (far zoom)
  frMin: 0.08,          // fr below this: no infection work, no colour (s < -(edgePx + 1) fwMax there)
};
export const IGN_SLOTS = 8;                       // uIgn array size (a phone fills 4)
export const IGN = { dur: 2.4, flash: 0.28, r0: 0.004, r1: 0.06, flashR: 0.006, ringPx: 1.2 };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fract = x => x - Math.floor(x);
const mixN = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// HSV hue (degrees, -180..180, 0 = red) and saturation of an RGB colour.
export function hueSat(c) {
  const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
  let h = 0;
  if (dl > 0) {
    if (mx === r) h = 60 * (((g - b) / dl) % 6);
    else if (mx === g) h = 60 * ((b - r) / dl + 2);
    else h = 60 * ((r - g) / dl + 4);
  }
  if (h > 180) h -= 360;
  return { hue: h, sat: mx > 0 ? dl / mx : 0, val: mx };
}
export const toHex = c => '#' + c.map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

// The heartbeat: a lub-dub pulse, tied to the daily new cases.
//   incPerPop: new infections today / world population.
//   -> { bpm, amp } : no new cases, no beat; 1e-4 a day or more, full.
export function heartbeat(incPerPop) {
  if (!(incPerPop > 1e-9)) return { bpm: 0, amp: 0 };
  const k = clamp(Math.log10(incPerPop / 1e-9) / 5, 0, 1);
  return { bpm: 44 + 50 * k, amp: 0.25 + 0.75 * k };
}
// Pulse shape at phase 0..1 of one beat: a sharp lub, then a smaller dub.
export function beatShape(ph) {
  ph = fract(ph);
  const lub = Math.exp(-(((ph - 0.04) / 0.035) ** 2)), dub = 0.55 * Math.exp(-(((ph - 0.22) / 0.04) ** 2));
  return Math.min(1, lub + dub);
}

// Shared uniforms: render/globe.js keeps one set in ctx.infect and every
// style links the same objects, so one update reaches all of them.
export function infectUniforms(THREE, ctx) {
  if (ctx && ctx.infect && ctx.infect.uniforms) return ctx.infect.uniforms;
  const V4 = THREE && THREE.Vector4;
  const ign = [];
  for (let k = 0; k < IGN_SLOTS; k++) ign.push(V4 ? new V4(0, 1, 0, -1) : { x: 0, y: 1, z: 0, w: -1 });
  return { uIgn: { value: ign }, uBeat: { value: 0 }, uFieldMix: { value: 1 }, uAny: { value: 0 } };
}
export function infectDefines(phone) { return phone ? { INF_PHONE: 1 } : {}; }

const f = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = c => `vec3(${c.map(f).join(', ')})`;

// ── the GLSL chunk ───────────────────────────────────────────────────────
// Include after the uniform declarations of uField and uLand. Call
//   col = infectApply(col, uv, landRaw, texture2D(uField, uv));
export const INFECT_GLSL = /* glsl */`
uniform vec4 uIgn[${IGN_SLOTS}];
uniform float uBeat;
uniform float uFieldMix;
uniform float uAny;
#define INF_BLOOD ${v3(PAL.blood)}
#define INF_ART ${v3(PAL.arterial)}
#define INF_CORE ${v3(PAL.core)}
#define INF_SCAR ${v3(PAL.scar)}
#ifdef INF_PHONE
#define INF_OCT 2
#else
#define INF_OCT 3
#endif
float ih1(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 ih3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float ivn(vec3 p) {
  vec3 i = floor(p); vec3 q = fract(p); q = q * q * (3.0 - 2.0 * q);
  float a = mix(mix(ih1(i), ih1(i + vec3(1.0, 0.0, 0.0)), q.x), mix(ih1(i + vec3(0.0, 1.0, 0.0)), ih1(i + vec3(1.0, 1.0, 0.0)), q.x), q.y);
  float b = mix(mix(ih1(i + vec3(0.0, 0.0, 1.0)), ih1(i + vec3(1.0, 0.0, 1.0)), q.x), mix(ih1(i + vec3(0.0, 1.0, 1.0)), ih1(i + vec3(1.0, 1.0, 1.0)), q.x), q.y);
  return mix(a, b, q.z);
}
float ifbm(vec3 p) {
  float a = 0.5; float s = 0.0; float w = 0.0;
  for (int k = 0; k < INF_OCT; k++) { s += a * ivn(p); w += a; p = p * 2.03 + 17.1; a *= 0.5; }
  return s / w;
}
// Voronoi: F1, F2, and a hash of the nearest cell
vec3 icell(vec3 p) {
  vec3 i = floor(p); vec3 q = fract(p);
  float f1 = 8.0; float f2 = 8.0; float id = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = ih3(i + o);
        float d = length(o + 0.15 + 0.7 * h - q);
        if (d < f1) { f2 = f1; f1 = d; id = h.z; } else if (d < f2) { f2 = d; }
      }
    }
  }
  return vec3(f1, f2, id);
}
// stipple dot coverage in a 3D cell grid of scale S; aw = cell units per px
float istip(vec3 p, float S, float r, float aw) {
  vec3 c = p * S; vec3 i = floor(c);
  vec3 h = ih3(i + 3.1);
  float d = length(fract(c) - (0.3 + 0.4 * h));
  return 1.0 - smoothstep(r - aw, r + aw, d);
}
vec3 infP(vec2 uv) {
  float lon = (uv.x * 2.0 - 1.0) * 3.14159265;
  float lat = (uv.y - 0.5) * 3.14159265;
  float c = cos(lat);
  return vec3(c * cos(lon), sin(lat), -c * sin(lon));
}
// ignitions: rgb = additive glow, a = bloom of the land
vec4 ignAt(vec3 p, float pw, float landC) {
  vec3 glow = vec3(0.0); float bloom = 0.0;
  for (int k = 0; k < ${IGN_SLOTS}; k++) {
    vec4 q = uIgn[k];
    if (q.w < 0.0 || q.w > ${f(IGN.dur)}) continue;
    float u = q.w / ${f(IGN.dur)};
    float dist = length(p - q.xyz);
    float R = ${f(IGN.r0)} + ${f(IGN.r1 - IGN.r0)} * (1.0 - (1.0 - u) * (1.0 - u) * (1.0 - u));
    float fade = (1.0 - u) * (1.0 - u);
    float rw = ${f(IGN.ringPx)} * pw;
    float ring = 1.0 - smoothstep(rw - pw, rw + pw, abs(dist - R));
    glow += INF_CORE * ring * fade * (0.55 + 0.45 * landC);
    bloom = max(bloom, (1.0 - smoothstep(0.0, R, dist)) * fade * landC);
    float fl = clamp(1.0 - q.w / ${f(IGN.flash)}, 0.0, 1.0);
    float fr = ${f(IGN.flashR)} + 2.0 * pw;
    glow += mix(INF_CORE, vec3(1.0), 0.6) * fl * fl * (1.0 - smoothstep(fr - pw, fr + pw, dist)) * 1.6;
  }
  return vec4(glow, bloom);
}
vec3 infectApply(vec3 col, vec2 uv, float landRaw, vec4 f4) {
  if (uAny < 0.5) return col;
  vec3 p = infP(uv);
  float pw = max(length(fwidth(p)), 1e-6);
  float fwl = max(fwidth(landRaw), 1e-4);
  float landC = smoothstep(0.5 - fwl, 0.5 + fwl, landRaw);
  vec4 ig = ignAt(p, pw, landC);
  col = mix(col, INF_ART * 0.85, ig.a * 0.55);
  float fr = mix(f4.a, f4.b, uFieldMix);
  if (fr > ${f(INF.frMin)} && landRaw > 0.0) {
    float g = clamp(f4.r, 0.0, 1.0);
    float dd = clamp(f4.g, 0.0, 1.0);
    float n = ifbm(p * ${f(INF.frontScale)});
    vec3 c = icell(p * ${f(INF.cellScale)});
    float s = (fr - 0.5) + (n - 0.5) * ${f(INF.frontAmp)} + (c.x - 0.35) * ${f(INF.cellAmp)};
    float fw = clamp(fwidth(s), 1e-5, ${f(INF.fwMax)});
    float m = smoothstep(-fw, fw, s);
    // ground and colonies
    vec3 inf = INF_BLOOD * (0.55 + 0.45 * g);
    float colony = smoothstep(c.z * 0.9, c.z * 0.9 + 0.08, g);
    vec3 cc = mix(INF_BLOOD, INF_ART, 0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.6, c.x)));
    inf = mix(inf, cc * (0.6 + 0.4 * g), colony);
    inf += INF_CORE * smoothstep(0.7, 1.0, g) * colony * (1.0 - smoothstep(0.0, 0.35, c.x)) * 0.6;
    // stipple: about stipPx px cells, two octaves blended by the zoom
    float L = log2(1.0 / (${f(INF.stipPx)} * pw));
    float S0 = exp2(floor(L));
    float r = ${f(INF.stipR)} * sqrt(g);
#ifdef INF_PHONE
    float sd = istip(p, S0, r, S0 * pw);
#else
    float sd = mix(istip(p, S0, r, S0 * pw), istip(p, 2.0 * S0, r, 2.0 * S0 * pw), fract(L));
#endif
    inf = mix(inf, INF_ART, sd * 0.9);
    // deaths: crimson-black scar
    inf = mix(inf, INF_SCAR, dd * 0.85);
    // veins: the cell edges, constant px width
    float cw = ${f(INF.cellScale)} * pw * 1.5;
    float crack = (1.0 - smoothstep(${f(INF.crackPx)} * cw - cw, ${f(INF.crackPx)} * cw + cw, c.y - c.x)) * smoothstep(3.0, 8.0, 1.0 / (${f(INF.cellScale)} * pw));
#ifndef INF_PHONE
    vec3 c2 = icell(p * ${f(INF.fineScale)});
    float cw2 = ${f(INF.fineScale)} * pw * 1.5;
    float crack2 = (1.0 - smoothstep(${f(INF.crackPx)} * cw2 - cw2, ${f(INF.crackPx)} * cw2 + cw2, c2.y - c2.x)) * smoothstep(12.0, 30.0, 1.0 / (${f(INF.fineScale)} * pw));
    crack = max(crack, crack2 * 0.6);
#endif
    vec3 crackCol = mix(INF_SCAR * 0.5, INF_CORE, g * g * (1.0 - dd));
    inf = mix(inf, crackCol, crack * 0.9);
    col = mix(col, inf, m * landC);
    // the front: a bright line and a red band just inside
    float edge = 1.0 - smoothstep(${f(INF.edgePx)} * fw - fw, ${f(INF.edgePx)} * fw + fw, abs(s));
    float band = m * (1.0 - smoothstep(0.0, ${f(INF.bandW)}, s));
    float act = max(g, 0.3);
    col += INF_CORE * edge * (0.9 + 0.5 * uBeat) * act * landC;
    col += INF_ART * band * 0.35 * (1.0 + 0.6 * uBeat) * g * landC;
  }
  col += ig.rgb;
  return col;
}
`;

// ── JS mirror (tests) ────────────────────────────────────────────────────
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const fr3 = a => [fract(a[0]), fract(a[1]), fract(a[2])];
export function ih1(p) {
  p = fr3([p[0] * 0.1031, p[1] * 0.1031, p[2] * 0.1031]);
  const d = p[0] * (p[2] + 31.32) + p[1] * (p[1] + 31.32) + p[2] * (p[0] + 31.32);
  p = [p[0] + d, p[1] + d, p[2] + d];
  return fract((p[0] + p[1]) * p[2]);
}
export function ih3(p) {
  p = fr3([p[0] * 0.1031, p[1] * 0.1030, p[2] * 0.0973]);
  const d = p[0] * (p[1] + 33.33) + p[1] * (p[0] + 33.33) + p[2] * (p[2] + 33.33);
  p = [p[0] + d, p[1] + d, p[2] + d];
  return fr3([(p[0] + p[1]) * p[2], (p[0] + p[0]) * p[1], (p[1] + p[0]) * p[0]]);
}
export function vnoise(p) {
  const i = p.map(Math.floor), q0 = p.map(fract), q = q0.map(x => x * x * (3 - 2 * x));
  const h = (x, y, z) => ih1([i[0] + x, i[1] + y, i[2] + z]);
  const a = mixN(mixN(h(0, 0, 0), h(1, 0, 0), q[0]), mixN(h(0, 1, 0), h(1, 1, 0), q[0]), q[1]);
  const b = mixN(mixN(h(0, 0, 1), h(1, 0, 1), q[0]), mixN(h(0, 1, 1), h(1, 1, 1), q[0]), q[1]);
  return mixN(a, b, q[2]);
}
export function fbm(p, oct = 3) {
  let a = 0.5, s = 0, w = 0;
  for (let k = 0; k < oct; k++) { s += a * vnoise(p); w += a; p = p.map(x => x * 2.03 + 17.1); a *= 0.5; }
  return s / w;
}
export function cellular(p) {
  const i = p.map(Math.floor), q = p.map(fract);
  let f1 = 8, f2 = 8, id = 0;
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const h = ih3([i[0] + x, i[1] + y, i[2] + z]);
    const d = Math.hypot(x + 0.15 + 0.7 * h[0] - q[0], y + 0.15 + 0.7 * h[1] - q[1], z + 0.15 + 0.7 * h[2] - q[2]);
    if (d < f1) { f2 = f1; f1 = d; id = h[2]; } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}
export function infP(u, v) {
  const lon = (u * 2 - 1) * Math.PI, lat = (v - 0.5) * Math.PI, c = Math.cos(lat);
  return [c * Math.cos(lon), Math.sin(lat), -c * Math.sin(lon)];
}
// The signed front distance s at p for a front value fr (field units).
export function frontS(p, fr, phone = false) {
  const n = fbm(p.map(x => x * INF.frontScale), phone ? 2 : 3);
  const c = cellular(p.map(x => x * INF.cellScale));
  return { s: (fr - 0.5) + (n - 0.5) * INF.frontAmp + (c[0] - 0.35) * INF.cellAmp, c };
}
// The hard front mask for s and its screen derivative fw (fwidth).
export function frontMask(s, fw) { const w = clamp(fw, 1e-5, INF.fwMax); return smoothstep(-w, w, s); }

// The colour of one fragment, as INFECT_GLSL computes it, without
// ignitions and with a given stipple coverage sd (0..1, or null: the
// expected coverage of the dot radius). Returns { m, inf, rgb }.
//   base   the style colour before the infection
//   g, d   prevalence glow and deaths share (field R, G)
//   fr     front value (field B, A blended)
//   s, c   frontS() output; fw the screen derivative of s
//   pw     world units per px; beat 0..1; landC 0..1
export function shade({ base = [0.04, 0.05, 0.068], g = 0, d = 0, fr = 0, s = null, c = null, fw = 0.01, pw = 1e-3,
  beat = 0, landC = 1, sd = null, any = true }) {
  if (!any || !(fr > INF.frMin) || !(landC > 0)) return { m: 0, inf: [0, 0, 0], rgb: base.slice() };
  g = clamp(g, 0, 1); d = clamp(d, 0, 1);
  const w = clamp(fw, 1e-5, INF.fwMax), m = smoothstep(-w, w, s);
  let inf = PAL.blood.map(x => x * (0.55 + 0.45 * g));
  const colony = smoothstep(c[2] * 0.9, c[2] * 0.9 + 0.08, g);
  const cc = mix3(PAL.blood, PAL.arterial, 0.55 + 0.45 * (1 - smoothstep(0, 0.6, c[0])));
  inf = mix3(inf, cc.map(x => x * (0.6 + 0.4 * g)), colony);
  const hot = smoothstep(0.7, 1, g) * colony * (1 - smoothstep(0, 0.35, c[0])) * 0.6;
  inf = add3(inf, PAL.core.map(x => x * hot));
  const cov = sd === null ? Math.min(1, Math.PI * (INF.stipR * Math.sqrt(g)) ** 2) : sd;
  inf = mix3(inf, PAL.arterial, cov * 0.9);
  inf = mix3(inf, PAL.scar, d * 0.85);
  const cw = INF.cellScale * pw * 1.5;
  const crack = (1 - smoothstep(INF.crackPx * cw - cw, INF.crackPx * cw + cw, c[1] - c[0])) * smoothstep(3, 8, 1 / (INF.cellScale * pw));
  const crackCol = mix3(PAL.scar.map(x => x * 0.5), PAL.core, g * g * (1 - d));
  inf = mix3(inf, crackCol, crack * 0.9);
  let rgb = mix3(base, inf, m * landC);
  const edge = 1 - smoothstep(INF.edgePx * w - w, INF.edgePx * w + w, Math.abs(s));
  const band = m * (1 - smoothstep(0, INF.bandW, s));
  const act = Math.max(g, 0.3);
  rgb = add3(rgb, PAL.core.map(x => x * edge * (0.9 + 0.5 * beat) * act * landC));
  rgb = add3(rgb, PAL.arterial.map(x => x * band * 0.35 * (1 + 0.6 * beat) * g * landC));
  return { m, inf, rgb };
}

// The material extensions a style needs for fwidth on WebGL1.
export const INFECT_EXT = { derivatives: true };
