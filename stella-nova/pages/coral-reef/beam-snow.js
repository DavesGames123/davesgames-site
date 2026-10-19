// ============================================================================
//  CORAL REEF  ·  beam-snow.js  ·  dense marine snow in the lamp cones
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "there's not nearly enough marine snow in
//  the volume lights, it isn't rendering at all swirling and showing the
//  volume of the water". The ambient snow (lib/marine-snow.js) fills a
//  box round the eye. This layer puts many flakes in the first BEAM_SNOW
//  .len m of each lamp cone, so the beams show the particles and you can
//  read depth and motion in the water.
//
//  The parts (all in the vertex shader, from a seed and the time):
//    spawn ....... flake j of lamp i lives BS_LIFE s, then it comes again
//                  at a new place (bsHash of its seed and its epoch). The
//                  place is uniform in the cone volume (s ~ cube root),
//                  in the frame of the lamp now.
//    world lock .. the lamp moved since the spawn: the flake goes back by
//                  the lamp velocity (uBsLampV) times its age, and its
//                  offset turns back by the lamp turn rate (uBsLampW). So
//                  a flake stays in the water while the ROV moves past it.
//    motion ...... two RK2 steps from the spawn through bsVel: the current,
//                  a small sink, and a curl swirl. The swirl is two
//                  octaves of ABC flow (a Beltrami field: curl u = k u, so
//                  u = curl(u / k)). The prop wash makes it stronger round
//                  the ROV: v = curl(phi A) = phi u + grad(phi) x A, with
//                  phi = 1 + w exp(-r^2 / 2 R^2). The field has no
//                  divergence anywhere (bsVelJS, the tests).
//    light ....... shaders.js SNOW_LIGHT msLight: the exact beam light
//                  (spotRad: cone, distance falloff, water; shadowTap;
//                  the near-lamp fade; BEAM_PHASE forward scatter). A
//                  flake out of all cones gets only the dim sky trace.
//    matter ...... real particulate sizes (bsSizeJS: many sub-mm silt
//                  specks, fewer 1-5 mm flocs and pellets, rare cm flocs
//                  and mucus strings); the size picks the cell of the
//                  aggregate atlas (porous flocs, fibres, strings, beads)
//                  that MARINE_SNOW_FS samples. Flocs and strings tumble.
//    lens ........ the thin-lens disc of lib/marine-snow.js: near flakes
//                  show their shape or a soft bokeh disc, mid flakes are
//                  small sparkles, far flakes are fine dust.
//    draw ........ MARINE_SNOW_FS (no soft, no post tone map): additive,
//                  depth test, no depth write, in the scene. So it draws
//                  into the HDR scene target before the volume and the
//                  composite tone map, and into the ROV feeds.
//
//  BUDGET (BEAM_SNOW, per lamp; up to 4 lamps): desktop 2400, laptop-low
//  1400, phone 700, phone-min 360 flakes. One instanced quad each.
//
//  USE
//    const B = createBeamSnow(THREE, { profile, uniforms: waterU(), snow: snowFx });
//    scene.add(B.mesh);  each frame after updateLamps(): B.update(dt, t, origin, cur)
//
//  grep -n targets
//    "export const BEAM_SNOW", "export function abcJS", "export function bsVelJS",
//    "export function bsHashJS", "export function bsFlakeJS",
//    "export function bsLightJS", "export const BEAM_SNOW_VS",
//    "export function createBeamSnow"
// ============================================================================
import { SNOW_LIGHT, NOISE2, WATER, MAX_SPOTS } from './shaders.js';
import { MARINE_SNOW_FS, MS_CELL_BASE, MS_CELL_COUNT } from '../../lib/marine-snow.js';
import { snowLight } from './volume.js';

export const BEAM_SNOW = {
  desktop: { perLamp: 2400, len: 12 },
  'laptop-low': { perLamp: 1400, len: 11 },
  phone: { perLamp: 700, len: 9 },
  'phone-min': { perLamp: 360, len: 8 },
};
export const BS_LIFE = 5;                    // s, the life of one flake
export const BS_SWIRL = 0.05;                // m/s, the swirl speed scale
export const BS_K = [2 * Math.PI / 6, Math.PI];   // the two swirl wave numbers (periods 6 m, 2 m)
export const BS_EDDY_PERIOD = 6;             // the origin offset mod this (both periods divide it)
export const BS_WASH = 3, BS_WASH_R = 2;     // the prop wash: phi weight per m/s of the ROV, radius (m)
export const BS_SINK = 0.002;                // m/s
export const BS_SIZE = 1.8, BS_GAIN = 9;     // the flakes: size and light over the ambient snow
// The size of real marine snow (the user: "marine snow should actually
// have particulate matter in it?"): a power law, n(d) ~ d^-3 from 0.3 mm
// to 30 mm, so P(D > d) = ((d / dmin)^-2 - c) / (1 - c). About 91 % are
// sub-mm silt specks, 8 % are 1-5 mm flocs and pellets, 0.4 % are over
// 5 mm (big flocs and mucus strings), 0.1 % over 1 cm. The size picks the
// type and so the aggregate atlas cell (lib/marine-snow.js makeSnowAtlas).
export const BS_DMIN = 0.0003, BS_DMAX = 0.03;
export function bsSizeJS(u) { const c = (BS_DMIN / BS_DMAX) ** 2; return BS_DMIN / Math.sqrt(1 - u * (1 - c)); }
// d (m, real), ux (0..1) -> type: 0 mote / silt, 1 floc, 2 string, 3 pellet
export function bsTypeJS(d, ux) { return d < 0.001 ? 0 : d < 0.005 ? (ux < 0.7 ? 1 : 3) : (ux < 0.6 ? 1 : 2); }

// ── CPU copies of the shader maths (the tests use them) ───────────────────
// ABC flow: u = (sin a + 0.6 cos c, 0.8 sin b + cos a, 0.6 sin c + 0.8 cos b)
export function abcJS(p, k, t) {
  const a = k * p[2] + 0.11 * t, b = k * p[0] + 0.08 * t + 1.7, c = k * p[1] + 0.07 * t + 4.1;
  return [Math.sin(a) + 0.6 * Math.cos(c), 0.8 * Math.sin(b) + Math.cos(a), 0.6 * Math.sin(c) + 0.8 * Math.cos(b)];
}
// p: render space; o: { cur [x, y, z], sink, eddyO [x, y, z], c (the wash
// centre), w (the wash weight), amp }
export function bsVelJS(p, t, o) {
  const pw = [p[0] + o.eddyO[0], p[1] + o.eddyO[1], p[2] + o.eddyO[2]];
  const u1 = abcJS(pw, BS_K[0], t), u2 = abcJS(pw, BS_K[1], t * 1.6);
  const r = [p[0] - o.c[0], p[1] - o.c[1], p[2] - o.c[2]], g = o.w * Math.exp(-(r[0] ** 2 + r[1] ** 2 + r[2] ** 2) / (2 * BS_WASH_R ** 2));
  const phi = 1 + g, gp = r.map(v => -g * v / BS_WASH_R ** 2);
  const u = [0, 1, 2].map(k => u1[k] + 0.5 * u2[k]), A = [0, 1, 2].map(k => u1[k] / BS_K[0] + 0.5 * u2[k] / BS_K[1]);
  const cx = [gp[1] * A[2] - gp[2] * A[1], gp[2] * A[0] - gp[0] * A[2], gp[0] * A[1] - gp[1] * A[0]];
  const amp = o.amp ?? BS_SWIRL;
  return [0, 1, 2].map(k => o.cur[k] + (k === 1 ? -o.sink : 0) + amp * (phi * u[k] + cx[k]));
}
const M1 = 1597334673, M2 = 3812015801, M3 = 2798796415;
export function bsHashJS(seed, ep) {
  const e = ep >>> 0;
  let x = (Math.floor(seed[0] * 65535) + Math.imul(e, M1)) >>> 0, y = (Math.floor(seed[1] * 65535) + Math.imul(e, M2)) >>> 0, z = (Math.floor(seed[2] * 65535) + Math.imul(e, M3)) >>> 0;
  const h = (x ^ y ^ z) >>> 0;
  x = Math.imul(h, M1) >>> 0; y = Math.imul(h, M2) >>> 0; z = Math.imul(h, M3) >>> 0;
  return [x / 4294967295, y / 4294967295, z / 4294967295];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
function rotv(v, th) {
  const a = Math.hypot(...th); if (a < 1e-5) return v.slice();
  const k = th.map(x => x / a), c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [0, 1, 2].map(i => v[i] * c + kv[i] * s + k[i] * d * (1 - c));
}
// seed: [x, y, z, lamp + phase]; lamp: { P, D, cosOuter, V, W }; o: the
// bsVelJS options without c and w; len (m). -> { p, a (age 0..1), env, s, r }
export function bsFlakeJS(seed, t, lamp, o, len = 12) {
  const x = t / BS_LIFE + (seed[3] - Math.floor(seed[3])), ep = Math.floor(x), a = x - ep, tau = a * BS_LIFE;
  const h = bsHashJS(seed, ep), D = lamp.D, co = lamp.cosOuter, ta = Math.sqrt(Math.max(1 - co * co, 0)) / Math.max(co, 0.05);
  const s = 0.3 + (len - 0.3) * Math.cbrt(h[0]), r = s * ta * 1.1 * Math.sqrt(h[1]), ph = 2 * Math.PI * h[2];
  const up = Math.abs(D[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], b1 = norm(cross(D, up)), b2 = cross(D, b1);
  const off = [0, 1, 2].map(k => D[k] * s + (b1[k] * Math.cos(ph) + b2[k] * Math.sin(ph)) * r);
  const ro = rotv(off, lamp.W.map(v => -v * tau));
  const P0 = [0, 1, 2].map(k => lamp.P[k] - lamp.V[k] * tau + ro[k]);
  const c0 = [0, 1, 2].map(k => lamp.P[k] - D[k] * 0.6), w = BS_WASH * Math.hypot(...lamp.V);
  // two midpoint (RK2) steps of tau / 2 from the spawn; the wash centre
  // goes back with the lamp
  let p = P0.slice(), tt = t - tau;
  const hs = 0.5 * tau, cAt = back => c0.map((v, k) => v - lamp.V[k] * back);
  for (let j = 0; j < 2; j++) {
    const v1 = bsVelJS(p, tt, { ...o, c: cAt(t - tt), w });
    const m = p.map((v, k) => v + v1[k] * 0.5 * hs);
    const v2 = bsVelJS(m, tt + 0.5 * hs, { ...o, c: cAt(t - tt - 0.5 * hs), w });
    p = p.map((v, k) => v + v2[k] * hs); tt += hs;
  }
  const sm = (e0, e1, v) => { const u = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
  return { p, a, env: sm(0, 0.12, a) * (1 - sm(0.75, 1, a)), s, r, P0, tau };
}
// The light on a flake at p (shaders.js spotRad + SNOW_LIGHT, one lamp,
// no shadow). lamp: { P, D, cosOuter, cosInner, rad (radiance), range },
// eye: the camera place; fogK: m^-1 (one channel); sky: the light from above.
export function bsLightJS(p, eye, lamp, fogK = 0.07, sky = 0) {
  const d = lamp.P.map((v, k) => v - p[k]), dist = Math.max(Math.hypot(...d), 0.05), L = d.map(v => v / dist);
  const ca = -(L[0] * lamp.D[0] + L[1] * lamp.D[1] + L[2] * lamp.D[2]);
  const sm = (e0, e1, v) => { const u = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
  let cone = sm(lamp.cosOuter, lamp.cosInner, ca); cone *= 0.8 + 0.2 * sm(lamp.cosInner, 1, ca);
  const range = lamp.range ?? 42, att = cone / (1 + 0.06 * dist * dist) * (1 - sm(range * 0.55, range, dist));
  const rad = lamp.rad * att * Math.exp(-dist * fogK);
  const vv = eye.map((v, k) => v - p[k]), vl = Math.hypot(...vv) || 1, V = vv.map(v => v / vl);
  return snowLight({ rad, shadow: 1, dl: dist, cosV: -(L[0] * V[0] + L[1] * V[1] + L[2] * V[2]), cosAx: ca, cosIn: lamp.cosInner, sky, skyPhase: 1 }) * Math.exp(-vl * fogK);
}

// ── GLSL (three.js ShaderMaterial, GLSL3) ─────────────────────────────────
const F = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const V4 = a => `vec4(${a.map(F).join(', ')})`;
export const BEAM_SNOW_VS = NOISE2 + WATER + /* glsl */`
in vec4 aSeed;
in vec4 aRand;
uniform vec4 uBsLampV[${MAX_SPOTS}];
uniform vec4 uBsLampW[${MAX_SPOTS}];
uniform vec4 uBsK;
uniform vec4 uBsDrift;
uniform vec3 uBsEddyO;
uniform float uBsTime;
uniform vec4 uMsLens;
uniform vec4 uMsPx;
uniform vec4 uMsTypeK;
uniform vec4 uMsSizeK;
uniform vec4 uMsTintA;
uniform vec4 uMsTintB;
uniform vec4 uMsG;
uniform vec2 uMsView;
out vec3 vMsCol;
out vec4 vMsQuad;
out vec4 vMsRot;
out vec4 vMsCell;
// aSeed: xyz the seed, w the lamp + the life phase. uBsLampV: xyz the lamp
// velocity (m/s), w on. uBsLampW: xyz the lamp turn rate (rad/s).
// uBsK: x beam length (m), y life (s), z swirl (m/s), w wash weight per m/s.
// uBsDrift: xyz the current (m/s), w sink (m/s). uBsEddyO: origin mod ${BS_EDDY_PERIOD} m.
// uMsTintA.w: the gain.
float msHG(float g, float c) { float d = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (12.566371 * d * sqrt(d)); }
float msPhase(float c) { return min(mix(msHG(uMsG.x, c), msHG(uMsG.y, c), uMsG.z), uMsG.w); }
${SNOW_LIGHT}
vec3 bsHash(vec3 s, float ep) {
  uvec3 q = uvec3(floor(s * 65535.0)) + uint(ep) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return vec3(q) / 4294967295.0;
}
vec3 bsAbc(vec3 p, float k, float t) {
  float a = k * p.z + 0.11 * t, b = k * p.x + 0.08 * t + 1.7, c = k * p.y + 0.07 * t + 4.1;
  return vec3(sin(a) + 0.6 * cos(c), 0.8 * sin(b) + cos(a), 0.6 * sin(c) + 0.8 * cos(b));
}
// the flow: current + sink + curl(phi A) (no divergence, see bsVelJS)
vec3 bsVel(vec3 p, float t, vec3 c, float w) {
  vec3 pw = p + uBsEddyO;
  vec3 u1 = bsAbc(pw, ${F(BS_K[0])}, t), u2 = bsAbc(pw, ${F(BS_K[1])}, t * 1.6);
  vec3 r = p - c;
  float g = w * exp(-dot(r, r) / ${F(2 * BS_WASH_R * BS_WASH_R)});
  vec3 gp = -g * r / ${F(BS_WASH_R * BS_WASH_R)};
  vec3 A = u1 / ${F(BS_K[0])} + 0.5 * u2 / ${F(BS_K[1])};
  return uBsDrift.xyz - vec3(0.0, uBsDrift.w, 0.0) + uBsK.z * ((1.0 + g) * (u1 + 0.5 * u2) + cross(gp, A));
}
vec3 bsRot(vec3 v, vec3 th) {
  float a = length(th);
  if (a < 1e-5) return v;
  vec3 k = th / a;
  return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
}
const vec4 MS_CB = ${V4(MS_CELL_BASE)};
const vec4 MS_CN = ${V4(MS_CELL_COUNT)};
void main() {
  float li = floor(aSeed.w);
  int i = int(li);
  vec4 LV = uBsLampV[min(i, ${MAX_SPOTS - 1})];
  vMsCol = vec3(0.0); vMsQuad = vec4(0.0); vMsRot = vec4(1.0, 0.0, 1.0, 1.0); vMsCell = vec4(0.0, 0.0, 1.0, 1.0);
  if (li >= uSpotN || LV.w < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // the spawn: a new place each life, uniform in the cone
  float x = uBsTime / uBsK.y + fract(aSeed.w);
  float ep = floor(x), a = x - ep, tau = a * uBsK.y;
  vec3 h = bsHash(aSeed.xyz, ep);
  vec3 D = uSpotD[i].xyz;
  float co = uSpotD[i].w, ta = sqrt(max(1.0 - co * co, 0.0)) / max(co, 0.05);
  float s = 0.3 + (uBsK.x - 0.3) * pow(h.x, 0.3333333), r = s * ta * 1.1 * sqrt(h.y), ph = 6.2831853 * h.z;
  vec3 up = abs(D.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 b1 = normalize(cross(D, up)), b2 = cross(D, b1);
  vec3 off = D * s + (b1 * cos(ph) + b2 * sin(ph)) * r;
  // the world lock, then RK2 advection from the spawn
  vec3 P0 = uSpotP[i].xyz - LV.xyz * tau + bsRot(off, -uBsLampW[i].xyz * tau);
  vec3 c0 = uSpotP[i].xyz - D * 0.6;
  float w = uBsK.w * length(LV.xyz);
  vec3 q = P0;
  float hs = 0.5 * tau, tt = uBsTime - tau;
  for (int j = 0; j < 2; j++) {
    vec3 m = q + bsVel(q, tt, c0 - LV.xyz * (uBsTime - tt), w) * (0.5 * hs);
    q += bsVel(m, tt + 0.5 * hs, c0 - LV.xyz * (uBsTime - tt - 0.5 * hs), w) * hs;
    tt += hs;
  }
  float env = smoothstep(0.0, 0.12, a) * (1.0 - smoothstep(0.75, 1.0, a));
  // the type, the cell, the size (lib/marine-snow.js, larger)
  // the real size (power law, bsSizeJS), then the type from the size
  float dReal = ${F(BS_DMIN)} / sqrt(1.0 - aRand.z * (1.0 - ${F((BS_DMIN / BS_DMAX) ** 2)}));
  float ty = dReal < 0.001 ? 0.0 : (dReal < 0.005 ? (aRand.x < 0.7 ? 1.0 : 3.0) : (aRand.x < 0.6 ? 1.0 : 2.0));
  vec4 oh = vec4(equal(vec4(ty), vec4(0.0, 1.0, 2.0, 3.0)));
  float cn = dot(MS_CN, oh);
  float cell = dot(MS_CB, oh) + min(floor(aRand.y * cn), cn - 1.0);
  float size = dReal * dot(uMsSizeK, oh) * ${F(BS_SIZE)};
  vec4 mv = viewMatrix * vec4(q, 1.0);
  float z = -mv.z;
  vec3 dq = cameraPosition - q;
  float dist = length(dq);
  vec3 V = dq / max(dist, 1e-4);
  vec3 tint = mix(uMsTintB.rgb, uMsTintA.rgb, oh.x) * (1.0 - 0.45 * oh.w);
  // the lens: near flakes are bokeh discs, far flakes are tiny and dim
  float zc = max(z, 0.04);
  float sPx = size * uMsLens.x / zc;
  float coc = min(uMsLens.y * uMsLens.x * abs(1.0 / uMsLens.z - 1.0 / zc), uMsPx.y);
  float d2 = sPx * sPx + coc * coc;
  float dPx = clamp(sqrt(d2), uMsPx.x, uMsPx.y);
  float sE = max(sPx, uMsPx.x);
  float cover = min(sPx * sPx / (dPx * dPx), 1.0);
  float coverS = min(sPx * sPx / (sE * sE), 1.0);
  float bok = coc * coc / max(d2, 1e-8);
  vec4 cNow = projectionMatrix * mv;
  float R = 0.5 * dPx;
  vec2 cq = position.xy;
  cNow.xy += cq * R * 2.0 / uMsView * cNow.w;
  // turn and tumble (flat flocs and strings change shape edge-on)
  float spin = (aRand.w - 0.5) * (0.4 + 0.8 * oh.y + 0.6 * oh.z);
  float th = fract(aRand.w * 7.13) * 6.2831853 + uBsTime * spin;
  float sq = 1.0 - dot(vec4(0.0, 0.65, 0.8, 0.5), oh) * (0.5 - 0.5 * cos(uBsTime * spin * 1.3 + aRand.x * 37.0));
  vMsRot = vec4(cos(th), sin(th), max(sq, 0.25), z);
  vMsQuad = vec4(cq.x, cq.y, 0.0, bok);
  vMsCell = vec4(vec2(mod(cell, 4.0), floor(cell / 4.0)) * 0.25, min(sE / dPx, 1.0), cover / max(coverS, 1e-6));
  float k = uMsTintA.w * ${F(BS_GAIN / 7)} * coverS * env * smoothstep(0.04, 0.12, z);
  vMsCol = k > 0.0 ? msLight(q, V) * tint * k * exp(-dist * uFogK) : vec3(0.0);
  if (k <= 0.0) cNow = vec4(0.0, 0.0, 2.0, 1.0);
  gl_Position = cNow;
}`;
export const BEAM_SNOW_FS = MARINE_SNOW_FS;

// ── the three.js object ───────────────────────────────────────────────────
// o: profile, uniforms (the page water uniforms: uSpotN, uSpotP, uSpotD,
// uSpotC, the shadows, uFogK ...), snow (the lib/marine-snow.js object:
// its atlas, tints and phase are shared), seed
export function bsInstances(per, lamps = MAX_SPOTS, seed = 7) {
  let a = (seed * 2654435761) >>> 0;
  const R = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = per * lamps, s = new Float32Array(n * 4), r = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    s[i * 4] = R(); s[i * 4 + 1] = R(); s[i * 4 + 2] = R(); s[i * 4 + 3] = Math.floor(i / per) + Math.min(R(), 0.9999);
    r[i * 4] = R(); r[i * 4 + 1] = R(); r[i * 4 + 2] = R(); r[i * 4 + 3] = R();
  }
  return { seed: s, rand: r, n };
}
export function createBeamSnow(THREE, o = {}) {
  const prof = BEAM_SNOW[o.profile] || BEAM_SNOW.desktop, per = o.perLamp ?? prof.perLamp, N = per * MAX_SPOTS;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = bsInstances(per, MAX_SPOTS, o.seed ?? 7);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(inst.seed, 4));
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(inst.rand, 4));
  g.instanceCount = 0;
  const W = o.uniforms || {}, SU = o.snow ? o.snow.uniforms : {};
  const v4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);
  const own = {
    uBsLampV: { value: [0, 1, 2, 3].map(() => v4()) },
    uBsLampW: { value: [0, 1, 2, 3].map(() => v4()) },
    uBsK: { value: v4(o.len ?? prof.len, BS_LIFE, BS_SWIRL, BS_WASH) },
    uBsDrift: { value: v4(0, 0, 0, BS_SINK) },
    uBsEddyO: { value: new THREE.Vector3() },
    uBsTime: { value: 0 },
    uMsLens: { value: v4(900, 0.006, 2.5, 0) },
    uMsPx: { value: v4(1.6, o.maxPx ?? 24, 0, 0) },
    uMsView: { value: new THREE.Vector2(1, 1) },
    uMsFrag: { value: v4(0, 0.3, 0, 1) },
    uMsDepth: { value: null },
  };
  for (const k of ['uMsTypeK', 'uMsSizeK', 'uMsTintA', 'uMsTintB', 'uMsG', 'uMsAtlas', 'uMsCam']) own[k] = SU[k] || { value: k === 'uMsAtlas' ? null : k === 'uMsG' ? v4(0.8, -0.3, 0.3, 1.2) : k === 'uMsCam' ? v4(0.1, 100, 1, 0) : v4(1, 1, 1, k === 'uMsTintA' ? 7 : 1) };
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: BEAM_SNOW_VS, fragmentShader: BEAM_SNOW_FS,
    uniforms: Object.assign({}, W, own), transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'beam-snow'; mesh.frustumCulled = false; mesh.renderOrder = 10;
  const tmp = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, scene, cam) => {
    const rt = renderer.getRenderTarget();
    if (rt) tmp.set(rt.width, rt.height); else renderer.getDrawingBufferSize(tmp);
    const u = mat.uniforms;
    u.uMsView.value.copy(tmp);
    if (cam.isPerspectiveCamera) u.uMsLens.value.x = tmp.y * 0.5 / (Math.tan(cam.fov * Math.PI / 360) / (cam.zoom || 1));
    mat.uniformsNeedUpdate = true;
  };
  // the lamp motion (world m/s, rad/s), smoothed; a jump resets it
  const st = { P: [], D: [], V: [0, 1, 2, 3].map(() => [0, 0, 0]), Wr: [0, 1, 2, 3].map(() => [0, 0, 0]), n: -1, enabled: true, lamps: 0 };
  const B = {
    mesh, geometry: g, material: mat, uniforms: mat.uniforms, perLamp: per, count: N, state: st,
    get enabled() { return st.enabled; },
    setEnabled(on) { st.enabled = !!on; mesh.visible = st.enabled && st.lamps > 0; },
    // after the page set the lamp uniforms of this frame; origin [ox, oz]; cur [x, y, z] m/s
    update(dt, t, origin = [0, 0], cur = [0, 0, 0]) {
      const n = Math.min(MAX_SPOTS, (W.uSpotN && W.uSpotN.value) | 0), U = mat.uniforms;
      const e = 1 - Math.exp(-Math.max(dt, 0) / 0.3), reset = n !== st.n;
      for (let i = 0; i < n; i++) {
        const sp = W.uSpotP.value[i], sd = W.uSpotD.value[i], sc = W.uSpotC.value[i];
        const P = [sp.x + origin[0], sp.y, sp.z + origin[1]], D = [sd.x, sd.y, sd.z];
        const pp = st.P[i], pd = st.D[i];
        if (!reset && pp && dt > 1e-4 && Math.hypot(P[0] - pp[0], P[1] - pp[1], P[2] - pp[2]) < 3) {
          const w = cross(pd, D);
          for (let k = 0; k < 3; k++) { st.V[i][k] += ((P[k] - pp[k]) / dt - st.V[i][k]) * e; st.Wr[i][k] += (w[k] / dt - st.Wr[i][k]) * e; }
        } else { st.V[i] = [0, 0, 0]; st.Wr[i] = [0, 0, 0]; }
        st.P[i] = P; st.D[i] = D;
        const on = Math.max(sc.x, sc.y, sc.z) > 1e-6 ? 1 : 0;
        U.uBsLampV.value[i].set(st.V[i][0], st.V[i][1], st.V[i][2], on);
        U.uBsLampW.value[i].set(st.Wr[i][0], st.Wr[i][1], st.Wr[i][2], 0);
      }
      st.n = n; st.lamps = n;
      U.uBsTime.value = t;
      U.uBsDrift.value.set(cur[0], cur[1], cur[2], BS_SINK);
      const pm = v => ((v % BS_EDDY_PERIOD) + BS_EDDY_PERIOD) % BS_EDDY_PERIOD;
      U.uBsEddyO.value.set(pm(origin[0]), 0, pm(origin[1]));
      g.instanceCount = per * n;
      mesh.visible = st.enabled && n > 0;
      return B;
    },
    dispose() { g.dispose(); mat.dispose(); },
  };
  return B;
}
