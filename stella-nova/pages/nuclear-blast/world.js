// ============================================================================
//  NUCLEAR BLAST  ·  world.js — terrain, procedural city, ground decals
// ----------------------------------------------------------------------------
//  Five made-up places (TERRAINS): a modern metro on a river and a bay, a
//  low wooden town on a river delta, a desert test range, a coral
//  atoll and an arctic coast. None is a real city. Water is an analytic
//  function, written twice (waterJS and WATER_GLSL) so the buildings and
//  the ground shader agree.
//
//  THE GROUND is one large quad with a ShaderMaterial. The effect rings,
//  the fallout contours, the scorch, the raised dust at the shock front
//  and the roads are all drawn in its fragment shader, from:
//    uLut ... a 512 x 1 float texture over log ground range: log10 of the
//             peak overpressure (psi), the arrival time (s), the radiant
//             exposure (cal/cm^2) and the prompt dose (rem). buildLut().
//    uFall .. an 8-bit texture of log10 H+1 dose rate in the wind frame.
//             buildFallout().
//  No ring geometry lies on the ground, so there is nothing to z-fight.
//
//  THE CITY is one InstancedBufferGeometry of unit boxes. Per box: aBox
//  (x, z, width, depth), aInfo (height, strength psi, kind, seed), aYaw,
//  and aFx (peak psi, arrival s, exposure cal/cm^2), set from the LUT when
//  the burst changes. The vertex shader drops a box to rubble when the
//  shock reaches it with more than its strength (rough values after G&D
//  Ch. V: wood frame ~5 psi, masonry 6-9, concrete 10-24), and the
//  fragment shader chars and lights fires where the exposure passes the
//  ignition values of G&D Table 7.40 (10-20 cal/cm^2).
//
//  GREP MAP
//    const TERRAINS ........... the five places
//    function waterJS ......... water mask (JS twin of WATER_GLSL)
//    function genCity ......... building boxes for a place
//    function buildLut ........ the effects over ground range
//    function buildFallout .... the dose-rate texture
//    const GROUND_FS .......... ground shader: terrain, roads, decals
//    const CITY_VS / CITY_FS .. buildings: collapse, windows, char, fire
//    function createWorld ..... the factory; world.setPlace / setBurst
// ============================================================================
import * as THREE from 'three';
import * as E from './effects.js';
import { NOISE, LIGHT, FOG } from './glsl.js';

// kinds: 0 wood house, 1 masonry, 2 concrete mid-rise, 3 tower, 4 shed, 5 test tower
export const KIND_NAMES = ['wood-frame house', 'masonry building', 'concrete mid-rise', 'high-rise', 'industrial shed', 'steel test tower'];
export const TERRAINS = {
  metro: { name: 'Metro', sub: 'Modern city on a river and a bay', ground: 0, water: 1, grid: 0.38, block: 120, road: 20, R: 8500, sub2: 13000 },
  delta: { name: 'River city', sub: 'Low wooden town on a delta', ground: 1, water: 2, grid: 0.12, block: 70, road: 9, R: 4200, sub2: 6500 },
  desert: { name: 'Test range', sub: 'Desert flat with a shot tower', ground: 2, water: 0, grid: 0, block: 0, road: 0, R: 0, sub2: 0 },
  atoll: { name: 'Atoll', sub: 'Coral reef islets in a lagoon', ground: 3, water: 3, grid: 0, block: 0, road: 0, R: 0, sub2: 0 },
  tundra: { name: 'Arctic coast', sub: 'Snow, ice and a frozen bay', ground: 4, water: 4, grid: 0, block: 0, road: 0, R: 0, sub2: 0 },
};

// ── water: JS and GLSL twins ─────────────────────────────────────────────
// returns > 0 on water. kind 1: river + bay (east); 2: delta channels + sea
// (south); 3: lagoon and ocean except the reef islets; 4: frozen bay (east)
export function waterJS(kind, x, z) {
  if (kind === 1) {
    const rz = 1700 + 900 * Math.sin(x / 2600) + 380 * Math.sin(x / 1100 + 1.0);
    const river = 170 - Math.abs(z - rz);
    const bay = x - (7600 + 900 * Math.sin(z / 3100) + 300 * Math.sin(z / 900));
    return Math.max(river, bay);
  }
  if (kind === 2) {
    let w = z - (4600 + 500 * Math.sin(x / 1700));
    for (let k = -2; k <= 2; k++) {
      const cz = k * 1350 + 260 * Math.sin(x / 820 + k * 1.7) + 120 * Math.sin(x / 330 + k);
      w = Math.max(w, (k === 0 ? 120 : 75) - Math.abs(z - cz));
    }
    return w;
  }
  if (kind === 3) {
    const dx = x + 9000, r = Math.hypot(dx, z), a = Math.atan2(z, dx);
    // passes in the reef: the reef top drops under water there
    const gap = Math.sin(a * 9.0 + 0.6) > 0.55 ? 600 : 0;
    const reef = 340 - Math.abs(r - 9000 - 260 * Math.sin(a * 5.0)) - gap;
    const islet = 420 - Math.hypot(x, z);
    return -Math.max(reef, islet);
  }
  if (kind === 4) return x - (14000 + 1500 * Math.sin(z / 5000));
  return -1;
}
const WATER_GLSL = /* glsl */`
float waterAt(int kind, vec2 p){
  float x = p.x, z = p.y;
  if (kind == 1) {
    float rz = 1700.0 + 900.0 * sin(x / 2600.0) + 380.0 * sin(x / 1100.0 + 1.0);
    float river = 170.0 - abs(z - rz);
    float bay = x - (7600.0 + 900.0 * sin(z / 3100.0) + 300.0 * sin(z / 900.0));
    return max(river, bay);
  }
  if (kind == 2) {
    float w = z - (4600.0 + 500.0 * sin(x / 1700.0));
    for (int k = -2; k <= 2; k++) {
      float fk = float(k);
      float cz = fk * 1350.0 + 260.0 * sin(x / 820.0 + fk * 1.7) + 120.0 * sin(x / 330.0 + fk);
      w = max(w, (k == 0 ? 120.0 : 75.0) - abs(z - cz));
    }
    return w;
  }
  if (kind == 3) {
    float dx = x + 9000.0, r = length(vec2(dx, z)), a = atan(z, dx);
    float gap = sin(a * 9.0 + 0.6) > 0.55 ? 600.0 : 0.0;
    float reef = 340.0 - abs(r - 9000.0 - 260.0 * sin(a * 5.0)) - gap;
    float islet = 420.0 - length(p);
    return -max(reef, islet);
  }
  if (kind == 4) return x - (14000.0 + 1500.0 * sin(z / 5000.0));
  return -1.0;
}`;

// ── city generation ──────────────────────────────────────────────────────
function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// strength: peak overpressure (psi) that brings the building down
const STRENGTH = [[3.5, 5.5], [6, 9], [10, 16], [14, 24], [3, 5], [40, 60]];
export function genCity(key, maxN = 20000, seed = 7) {
  const T = TERRAINS[key], rnd = mulberry(seed), out = [];
  const add = (x, z, w, d, h, kind, yaw) => {
    if (out.length >= maxN) return;
    // keep the whole footprint dry
    const r = Math.max(w, d) * 0.6;
    if (waterJS(T.water, x, z) > -r * 0.5) return;
    const s = STRENGTH[kind];
    out.push([x, z, w, d, h, s[0] + (s[1] - s[0]) * rnd(), kind, rnd(), yaw]);
  };
  if (key === 'metro' || key === 'delta') {
    const B = T.block, rd = T.road, ca = Math.cos(T.grid), sa = Math.sin(T.grid), N = Math.ceil(T.sub2 / B);
    const old = key === 'delta';
    // blocks from the centre out, so a cap on the count trims the edge
    const blocks = [];
    for (let gi = -N; gi <= N; gi++) for (let gj = -N; gj <= N; gj++) { const u = (gi + 0.5) * B, v = (gj + 0.5) * B; blocks.push([u, v, Math.hypot(u, v)]); }
    blocks.sort((p, q) => p[2] - q[2]);
    const gridCap = maxN * 0.8;
    for (const [u, v] of blocks) {
      if (out.length >= gridCap) break;
      const cx = u * ca - v * sa, cz = u * sa + v * ca, r = Math.hypot(cx, cz);
      if (r > T.sub2) continue;
      const edge = T.R * (1 + 0.12 * Math.sin(Math.atan2(cz, cx) * 3 + 1));
      const dens = r < edge ? 0.93 - 0.25 * r / edge : 0.5 * Math.exp(-(r - edge) / (0.25 * T.R));
      if (rnd() > dens) continue;
      if (rnd() < (old ? 0.03 : 0.06)) continue;       // a park or a square
      const inner = B - rd;
      // lots per side: towers take a whole block
      const core = !old && r < 1800 && rnd() < 0.75;
      const n = core ? 2 : old ? 3 + (rnd() < 0.5 ? 1 : 0) : r < 4500 ? 2 : 3;
      const lot = inner / n;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        if (rnd() < (core ? 0.3 : 0.12)) continue;
        const lu = u - inner / 2 + (a + 0.5) * lot, lv = v - inner / 2 + (b + 0.5) * lot;
        const x = lu * ca - lv * sa, z = lu * sa + lv * ca;
        const w = lot * (0.62 + 0.3 * rnd()), d = lot * (0.62 + 0.3 * rnd());
        let h, kind;
        if (old) {
          if (r < 900 && rnd() < 0.12) { kind = 2; h = 10 + 14 * rnd(); }
          else if (rnd() < 0.08) { kind = 1; h = 7 + 6 * rnd(); }
          else { kind = 0; h = 4 + 4 * rnd(); }
        } else if (core) { kind = 3; h = 45 + 230 * Math.pow(rnd(), 2.2) * (1.15 - r / 2000); }
        else if (r < 4500) { kind = rnd() < 0.55 ? 2 : 1; h = (kind === 2 ? 14 : 8) + 26 * Math.pow(rnd(), 2) * (1.3 - r / 4500); }
        else if (rnd() < 0.08) { kind = 4; h = 7 + 6 * rnd(); }
        else { kind = rnd() < 0.7 ? 0 : 1; h = 5 + 5 * rnd(); }
        add(x, z, core ? w * 0.85 : w, core ? d * 0.85 : d, h, kind, T.grid);
      }
    }
    // suburbs: houses with random turn, sparser with range
    for (let i = 0; i < maxN * 0.35 && out.length < maxN; i++) {
      const r = T.R * 0.85 + (T.sub2 - T.R * 0.85) * Math.pow(rnd(), 0.8), a = rnd() * Math.PI * 2;
      if (rnd() > Math.exp(-(r - T.R) / (0.6 * T.R))) continue;
      const x = r * Math.cos(a), z = r * Math.sin(a), s = old ? 9 : 13;
      add(x, z, s * (0.8 + 0.5 * rnd()), s * (0.8 + 0.5 * rnd()), (old ? 4 : 5) + 3 * rnd(), 0, rnd() * Math.PI);
    }
  } else if (key === 'desert') {
    add(0, 0, 6, 6, 30, 5, 0);                         // the shot tower
    for (let i = 0; i < 28; i++) {                      // scattered huts and bunkers
      const r = 800 + 9000 * Math.pow(rnd(), 0.7), a = rnd() * Math.PI * 2;
      add(r * Math.cos(a), r * Math.sin(a), 8 + 10 * rnd(), 6 + 8 * rnd(), 3 + 3 * rnd(), rnd() < 0.5 ? 1 : 4, rnd() * Math.PI);
    }
  } else if (key === 'atoll') {
    for (let i = 0; i < 400 && out.length < 80; i++) {
      const a = (rnd() - 0.5) * 1.2, r = 9000 + 260 * Math.sin(a * 5) + (rnd() - 0.5) * 300;
      add(-9000 + r * Math.cos(a), r * Math.sin(a), 8 + 6 * rnd(), 6 + 5 * rnd(), 3 + 2 * rnd(), rnd() < 0.7 ? 0 : 4, rnd() * Math.PI);
    }
  } else if (key === 'tundra') {
    for (let i = 0; i < 20; i++) { const r = 3000 + 9000 * rnd(), a = rnd() * Math.PI * 2; add(r * Math.cos(a), r * Math.sin(a), 8, 6, 3.5, 4, rnd() * Math.PI); }
  }
  return out;
}

// ── effects over ground range ───────────────────────────────────────────
export const LUT_N = 512, LUT_R0 = 1, LUT_R1 = 2e6;
// o: { W, h, V (km) }. Columns (log10): psi, arrival s, cal/cm^2, rem.
export function buildLut(o) {
  const { W, h, V } = o, data = new Float32Array(LUT_N * 4), l0 = Math.log(LUT_R0), l1 = Math.log(LUT_R1);
  for (let i = 0; i < LUT_N; i++) {
    const r = Math.exp(l0 + (l1 - l0) * i / (LUT_N - 1)), D = Math.hypot(r, h);
    data[i * 4] = Math.log10(Math.max(1e-6, E.psi(E.overpressure(r, W, h))));
    data[i * 4 + 1] = Math.log10(Math.max(1e-6, E.arrivalTime(r, W, h)));
    data[i * 4 + 2] = Math.log10(Math.max(1e-6, E.thermalFluence(D, W, h, V)));
    data[i * 4 + 3] = Math.log10(Math.max(1e-6, E.promptDose(D, W)));
  }
  return data;
}
export function lutAt(data, r) {
  const l0 = Math.log(LUT_R0), l1 = Math.log(LUT_R1), u = (Math.log(Math.max(r, LUT_R0)) - l0) / (l1 - l0) * (LUT_N - 1);
  const i = Math.max(0, Math.min(LUT_N - 2, Math.floor(u))), f = Math.max(0, Math.min(1, u - i)), o = [];
  for (let k = 0; k < 4; k++) o.push(Math.pow(10, data[i * 4 + k] * (1 - f) + data[(i + 1) * 4 + k] * f));
  return o;   // [psi, ta, Q, rem]
}

// ── fallout texture ──────────────────────────────────────────────────────
// Wind frame: x downwind, y crosswind. Levels below the smallest table rate
// whose contour fits inside 800 km are not drawn.
export function buildFallout(o, NX = 256, NY = 112) {
  const { W, h, wind, fission } = o;
  if (E.falloutShare(W, h) <= 0) return null;
  let minRate = 1;
  for (const row of [...E.FALLOUT].reverse()) { if (E.falloutContour(row.rate, W, wind).d <= 8e5) { minRate = row.rate; break; } minRate = row.rate; }
  const C = E.falloutContour(minRate, W, wind);
  const x0 = -C.g * 1.15, x1 = C.d * 1.04;
  const ymax = Math.max(C.g, C.w) * 1.08;
  const data = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = x0 + (x1 - x0) * (i + 0.5) / NX, y = -ymax + 2 * ymax * (j + 0.5) / NY;
    const R = E.falloutRate(x, y, W, wind, fission, h);
    data[j * NX + i] = R < minRate * 0.999 ? 0 : Math.round(Math.max(1, Math.min(255, (Math.log10(R) + 0.5) / 4.5 * 255)));
  }
  return { data, NX, NY, x0, x1, ymax, minRate };
}

// ── shaders ──────────────────────────────────────────────────────────────
const LUT_GLSL = /* glsl */`
uniform sampler2D uLut; uniform vec2 uLutR;
vec4 lutAt(float r){
  float u = (log(max(r, 1.0)) - uLutR.x) / (uLutR.y - uLutR.x) * ${LUT_N - 1}.0;
  float i = floor(clamp(u, 0.0, ${LUT_N - 2}.0)); float f = clamp(u - i, 0.0, 1.0);
  return mix(texelFetch(uLut, ivec2(int(i), 0), 0), texelFetch(uLut, ivec2(int(i) + 1, 0), 0), f);
}`;

const GROUND_VS = /* glsl */`
varying vec3 vP;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const GROUND_FS = /* glsl */`
${NOISE}
${LIGHT}
${FOG}
${WATER_GLSL}
${LUT_GLSL}
uniform int uGround; uniform int uWater; uniform float uGrid; uniform vec2 uBlock; uniform float uCityR;
uniform float uTime; uniform float uBurst; uniform float uTmax; uniform float uFront; uniform float uFrontPsi; uniform float uCrater;
uniform float uRingR[8]; uniform vec3 uRingC[8]; uniform float uRingA[8]; uniform float uRingDash[8];
uniform sampler2D uFall; uniform float uFallOn; uniform vec4 uFallBox; uniform vec2 uWindDir; uniform float uFallFront;
uniform float uPick; uniform vec2 uPickP; uniform float uLights; uniform float uClock;
varying vec3 vP;

vec3 terrain(vec2 p, out float wet, out float rough){
  float n = fbm2(p * 0.0021), n2 = vnoise2(p * 0.03), n3 = vnoise2(p * 0.25);
  wet = 0.0; rough = 1.0;
  vec3 c;
  if (uGround == 0) c = mix(vec3(0.20, 0.22, 0.17), vec3(0.28, 0.27, 0.22), n) * (0.9 + 0.2 * n2);
  else if (uGround == 1) c = mix(vec3(0.24, 0.23, 0.15), vec3(0.30, 0.31, 0.18), n) * (0.85 + 0.25 * n2);
  else if (uGround == 2) c = mix(vec3(0.55, 0.45, 0.33), vec3(0.64, 0.55, 0.42), n) * (0.9 + 0.15 * n2) * (0.93 + 0.1 * n3);
  else if (uGround == 3) c = vec3(0.78, 0.74, 0.62) * (0.92 + 0.12 * n2);
  else c = mix(vec3(0.80, 0.84, 0.90), vec3(0.92, 0.94, 0.97), n) * (0.95 + 0.06 * n2);
  // the city: concrete blocks and darker roads on a turned grid
  if (uCityR > 0.0) {
    float r = length(p), edge = uCityR * (1.0 + 0.12 * sin(atan(p.y, p.x) * 3.0 + 1.0)) * 1.5;
    float city = 1.0 - smoothstep(edge * 0.75, edge, r);
    if (city > 0.0) {
      float ca = cos(uGrid), sa = sin(uGrid);
      vec2 g = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
      vec2 f = abs(fract(g / uBlock.x) - 0.5) * uBlock.x;              // distance to the block centre lines
      float hw = (uBlock.x - uBlock.y) * 0.5;
      vec2 aw = max(fwidth(g), vec2(0.5));
      float road = max(smoothstep(hw - aw.x, hw + aw.x, f.x), smoothstep(hw - aw.y, hw + aw.y, f.y));
      // far away the grid is finer than a pixel: use its mean
      float share = 1.0 - (hw * hw * 4.0) / (uBlock.x * uBlock.x);
      road = mix(road, share, smoothstep(0.08, 0.3, max(aw.x, aw.y) / uBlock.x));
      vec3 blockC = (uGround == 1 ? vec3(0.27, 0.25, 0.21) : vec3(0.22, 0.22, 0.215)) * (0.8 + 0.3 * hash12(floor(g / uBlock.x)));
      vec3 roadC = uGround == 1 ? vec3(0.36, 0.31, 0.24) : vec3(0.11, 0.115, 0.12);
      vec3 cc = mix(blockC, roadC, road);
      // street lights at night
      float lamp = road * step(0.5, uLights) * smoothstep(0.35, 0.0, length(fract(g / 30.0) - 0.5)) * 0.5;
      c = mix(c, cc, city);
      wet = lamp * city;
    }
  }
  return c;
}

void main(){
  vec2 p = vP.xz;
  float r = length(p);
  float wet, rough;
  vec3 alb = terrain(p, wet, rough);
  vec3 N = vec3(0.0, 1.0, 0.0);
  float spec = 0.0;
  float wat = waterAt(uWater, p);
  if (wat > 0.0) {
    float sh = smoothstep(0.0, 60.0, wat);
    vec3 wc = uWater == 3 ? mix(vec3(0.05, 0.42, 0.48), vec3(0.02, 0.10, 0.22), smoothstep(0.0, 900.0, wat))
            : uWater == 4 ? vec3(0.70, 0.78, 0.86) : vec3(0.025, 0.06, 0.08);
    alb = mix(alb, wc, sh);
    if (uWater != 4) {
      N = normalize(vec3((vnoise2(p * 0.02 + uClock * 0.05) - 0.5) * 0.12, 1.0, (vnoise2(p.yx * 0.02 - uClock * 0.04) - 0.5) * 0.12));
      spec = sh;
    }
  }
  // effects at this ground range
  vec4 L = lutAt(r);
  float psiP = pow(10.0, L.x), ta = pow(10.0, L.y), Q = pow(10.0, L.z);
  float since = uTime - ta;
  vec3 emis = vec3(0.0);
  if (uBurst > 0.5) {
    // scorch: the pulse is over by about 10 t_max
    float burnt = smoothstep(0.0, uTmax * 6.0, uTime) * smoothstep(8.0, 40.0, Q);
    alb *= mix(1.0, 0.18, burnt * (wat > 0.0 ? 0.0 : 1.0));
    // fires in the burnt zone some seconds after the shock
    if (Q > 12.0 && since > 3.0 && wat <= 0.0) {
      float fl = vnoise(vec3(p * 0.05, uClock * 2.0)) * vnoise2(p * 0.013);
      emis += vec3(1.0, 0.35, 0.08) * smoothstep(0.55, 0.85, fl) * smoothstep(3.0, 30.0, since) * smoothstep(12.0, 30.0, Q) * 0.6;
    }
    // ground scoured near ground zero, and the crater of a surface burst
    alb = mix(alb, vec3(0.42, 0.38, 0.33), smoothstep(30.0, 200.0, psiP) * step(0.0, since) * (wat > 0.0 ? 0.0 : 0.6));
    alb *= 1.0 - 0.75 * (1.0 - smoothstep(uCrater * 0.7, uCrater, r)) * step(0.0, uCrater - 0.001);
    // dust raised behind the shock front where it is strong
    float behind = uFront - r;
    if (behind > 0.0 && uFrontPsi > 1.5) {
      float band = exp(-behind / max(1.0, uFront * 0.06)) * smoothstep(1.5, 8.0, uFrontPsi);
      alb = mix(alb, vec3(0.62, 0.56, 0.47), band * 0.55);
    }
  }
  vec3 col = light(vP, N, alb);
  // sun and fireball glint on water
  if (spec > 0.0) {
    vec3 V = normalize(cameraPosition - vP);
    vec3 H = normalize(uSunDir + V);
    col += uSunCol * pow(max(dot(N, H), 0.0), 300.0) * 6.0 * spec;
    vec3 Lf = normalize(uFbPos - vP); vec3 Hf = normalize(Lf + V);
    col += uFbCol * fbIrr(vP) * pow(max(dot(N, Hf), 0.0), 200.0) * 4.0 * spec;
  }
  col += emis + vec3(1.0, 0.8, 0.5) * wet * 0.06;
  // ── decals: fallout, then rings, then the picked point ──
  vec3 dec = vec3(0.0); float da = 0.0;
  if (uFallOn > 0.5) {
    vec2 q = vec2(dot(p, uWindDir), dot(p, vec2(-uWindDir.y, uWindDir.x)));
    vec2 uv = vec2((q.x - uFallBox.x) / (uFallBox.y - uFallBox.x), (q.y + uFallBox.z) / (2.0 * uFallBox.z));
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && q.x < uFallFront) {
      float v = texture2D(uFall, uv).r;
      if (v > 0.002) {
        float lg = v * 4.5 - 0.5;                       // log10 rad/h at H+1
        float t = clamp((lg - 0.0) / 3.6, 0.0, 1.0);
        vec3 fc = mix(vec3(0.95, 0.86, 0.35), vec3(0.62, 0.12, 0.55), t);
        float iso = abs(fract(lg + 0.5) - 0.5) / max(fwidth(lg), 1e-4);  // a line at each power of ten
        float line = 1.0 - smoothstep(0.6, 1.6, iso);
        dec = mix(dec, fc, 0.5 + 0.45 * line); da = max(da, 0.5 + 0.45 * line);
      }
    }
  }
  float px = max(fwidth(r), 1e-3);
  for (int i = 0; i < 8; i++) {
    if (uRingA[i] <= 0.0) continue;
    float R = uRingR[i], d = abs(r - R) / px;
    float lw = 1.0 - smoothstep(0.9, 2.0, d);
    if (uRingDash[i] > 0.5) lw *= step(0.42, fract(atan(p.y, p.x) / 6.2831853 * 72.0));
    float fill = (r < R ? smoothstep(R - 40.0 * px, R, r) * 0.22 : 0.0);
    float a = max(lw, fill) * uRingA[i];
    dec = mix(dec, uRingC[i], a); da = max(da, a);
  }
  if (uPick > 0.5) {
    float d = length(p - uPickP) / px;
    float a = (1.0 - smoothstep(5.0, 6.5, d)) * smoothstep(3.0, 4.2, d);
    dec = mix(dec, vec3(1.0), a); da = max(da, a);
  }
  // decals: lit like paint by the sky, so they read in day and at night.
  // They take a fifth of the haze: a map of the rings must stay legible
  // from high above, where the ground itself is lost in the haze.
  vec3 decLit = dec * (0.35 + 0.65 * clamp(length(uSunCol) + length(uSkyAmb), 0.0, 1.0)) + dec * 0.25;
  vec3 base = fogMix(col, vP, cameraPosition);
  vec3 decF = mix(decLit, fogMix(decLit, vP, cameraPosition), 0.2);
  gl_FragColor = vec4(outCol(mix(base, decF, da * 0.85)), 1.0);
}`;

const CITY_VS = /* glsl */`
attribute vec4 aBox; attribute vec4 aInfo; attribute vec4 aFx; attribute float aYaw;
uniform float uTime; uniform float uBurst;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec4 vInfo; varying vec4 vFx; varying float vK;
float h1(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  float h = aInfo.x, since = uTime - aFx.y, dmg = aFx.x / aInfo.y;
  float k = (uBurst > 0.5 && since > 0.0 && dmg > 1.0) ? smoothstep(0.0, 0.7 + sqrt(h) * 0.22, since) : 0.0;
  float rub = 0.08 + 0.1 * h1(aInfo.w * 91.0);
  float hh = h * mix(1.0, rub, k);
  vec3 p = position;
  // a damaged but standing box leans a little; a falling one spreads out
  float lean = (uBurst > 0.5 && since > 0.0) ? clamp(dmg - 0.45, 0.0, 0.55) * 0.07 * (1.0 - k) : 0.0;
  float spread = 1.0 + 0.7 * k;
  vec2 lp = vec2(p.x * aBox.z * spread, p.z * aBox.w * spread);
  float c = cos(aYaw), s = sin(aYaw);
  vec2 xz = vec2(c * lp.x - s * lp.y, s * lp.x + c * lp.y) + aBox.xy;
  vec2 away = normalize(aBox.xy + vec2(1e-3, 0.0));
  xz += away * p.y * hh * (lean + 0.4 * k);
  vec3 w = vec3(xz.x, p.y * hh, xz.y);
  vP = w;
  vN = normalize(vec3(c * normal.x - s * normal.z, normal.y, s * normal.x + c * normal.z));
  vL = vec3(position.x * aBox.z * (abs(normal.x) > 0.5 ? 0.0 : 1.0) + position.z * aBox.w * (abs(normal.z) > 0.5 ? 0.0 : 1.0), position.y * h, 0.0);
  vInfo = aInfo; vFx = aFx; vK = k;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const CITY_FS = /* glsl */`
${NOISE}
${LIGHT}
${FOG}
uniform float uTime; uniform float uBurst; uniform float uTmax; uniform float uLights; uniform float uClock;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec4 vInfo; varying vec4 vFx; varying float vK;
void main(){
  int kind = int(vInfo.z + 0.5);
  float seed = vInfo.w;
  vec3 alb = kind == 0 ? vec3(0.42, 0.33, 0.24) : kind == 1 ? vec3(0.45, 0.30, 0.24) : kind == 2 ? vec3(0.46, 0.46, 0.45)
           : kind == 3 ? vec3(0.25, 0.28, 0.31) : kind == 4 ? vec3(0.40, 0.42, 0.44) : vec3(0.30, 0.30, 0.32);
  alb *= 0.8 + 0.4 * fract(seed * 13.7);
  vec3 N = normalize(vN);
  bool wall = abs(N.y) < 0.5;
  if (!wall) alb *= 0.75;
  float since = uTime - vFx.y, Q = vFx.z;
  vec3 emis = vec3(0.0);
  // windows: floors of 3.5 m, bays of 3 m; lights at night until the shock
  if (wall && kind != 5 && vK < 0.5) {
    vec2 g = vec2(vL.x / 3.0, vL.y / 3.5);
    vec2 f = fract(g), id = floor(g);
    float fade = 1.0 - smoothstep(0.25, 0.6, max(fwidth(g.x), fwidth(g.y)));   // no moire far away
    float win = mix(0.25, step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.8), fade) * step(1.0, id.y);
    alb = mix(alb, alb * 0.45 + vec3(0.03, 0.05, 0.07), win * (kind >= 2 ? 0.8 : 0.4));
    float on = step(0.62, hash12(id + seed * 17.0)) * mix(0.38 * 0.5, win, fade) * uLights * (uBurst > 0.5 && since > 0.0 ? 0.0 : 1.0);
    emis += vec3(1.0, 0.72, 0.42) * on * 0.35;
  }
  if (uBurst > 0.5) {
    float burnt = smoothstep(0.0, uTmax * 6.0, uTime) * smoothstep(10.0, 45.0, Q);
    alb *= mix(1.0, 0.16, burnt);
    if (vK > 0.0) alb = mix(alb, vec3(0.33, 0.31, 0.29) * (0.5 + 0.5 * vnoise(vP * 0.4)), vK * 0.8);
    // fires: ignition of G&D Table 7.40 materials, 10 to 20 cal/cm^2
    if (Q > 12.0 && since > 2.0) {
      float fl = vnoise(vec3(vP.xz * 0.12, uClock * 3.0 + seed * 9.0));
      emis += vec3(1.0, 0.36, 0.08) * smoothstep(0.45, 0.9, fl) * smoothstep(2.0, 25.0, since) * smoothstep(12.0, 30.0, Q) * (wall ? 1.0 : 0.6) * 0.9;
    }
  }
  vec3 col = light(vP, N, alb) + emis;
  gl_FragColor = vec4(outCol(fogMix(col, vP, cameraPosition)), 1.0);
}`;

// ── the factory ──────────────────────────────────────────────────────────
export function createWorld(st, o = {}) {
  const U = st.U, maxN = o.maxBuildings || 20000;
  const lutTex = new THREE.DataTexture(new Float32Array(LUT_N * 4), LUT_N, 1, THREE.RGBAFormat, THREE.FloatType);
  lutTex.minFilter = lutTex.magFilter = THREE.NearestFilter; lutTex.needsUpdate = true;
  // fixed size: WebGL2 textures are allocated once (texStorage2D), so a
  // texture must keep the size of its first upload
  const FNX = st.lowQ ? 160 : 256, FNY = st.lowQ ? 72 : 112;
  const fallTex = new THREE.DataTexture(new Uint8Array(FNX * FNY), FNX, FNY, THREE.RedFormat, THREE.UnsignedByteType);
  fallTex.minFilter = fallTex.magFilter = THREE.LinearFilter; fallTex.unpackAlignment = 1; fallTex.needsUpdate = true;
  const common = {
    uSunDir: U.uSunDir, uSunCol: U.uSunCol, uSkyAmb: U.uSkyAmb, uGndAmb: U.uGndAmb, uFbPos: U.uFbPos, uFbCol: U.uFbCol, uFbPow: U.uFbPow, uTauL: U.uTauL,
    uFogCol: U.uFogCol, uFogDen: U.uFogDen, uFogFlash: U.uFogFlash, uExpo: U.uExpo, uClock: U.uClock, uLights: U.uLights,
    uTime: { value: 0 }, uBurst: { value: 0 }, uTmax: { value: 0.1 },
  };
  const gU = {
    ...common, uGround: { value: 0 }, uWater: { value: 1 }, uGrid: { value: 0 }, uBlock: { value: new THREE.Vector2(120, 20) }, uCityR: { value: 0 },
    uFront: { value: 0 }, uFrontPsi: { value: 0 }, uCrater: { value: 0 },
    uLut: { value: lutTex }, uLutR: { value: new THREE.Vector2(Math.log(LUT_R0), Math.log(LUT_R1)) },
    uRingR: { value: new Array(8).fill(0) }, uRingC: { value: Array.from({ length: 8 }, () => new THREE.Color()) }, uRingA: { value: new Array(8).fill(0) }, uRingDash: { value: new Array(8).fill(0) },
    uFall: { value: fallTex }, uFallOn: { value: 0 }, uFallBox: { value: new THREE.Vector4(0, 1, 1, 0) }, uWindDir: { value: new THREE.Vector2(1, 0) }, uFallFront: { value: 1e9 },
    uPick: { value: 0 }, uPickP: { value: new THREE.Vector2() },
  };
  const groundMat = new THREE.ShaderMaterial({ vertexShader: GROUND_VS, fragmentShader: GROUND_FS, uniforms: gU, extensions: { derivatives: true } });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4e6, 4e6).rotateX(-Math.PI / 2), groundMat);
  ground.frustumCulled = false; ground.renderOrder = -10;
  st.scene.add(ground);

  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // drop the bottom face: it lies on the ground and is never seen
  const idx = box.index.array, keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const ny = box.attributes.normal.getY(idx[i]);
    if (ny > -0.5) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(keep); geo.setAttribute('position', box.attributes.position); geo.setAttribute('normal', box.attributes.normal);
  const A = { box: new Float32Array(maxN * 4), info: new Float32Array(maxN * 4), fx: new Float32Array(maxN * 4), yaw: new Float32Array(maxN) };
  geo.setAttribute('aBox', new THREE.InstancedBufferAttribute(A.box, 4));
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(A.info, 4));
  geo.setAttribute('aFx', new THREE.InstancedBufferAttribute(A.fx, 4));
  geo.setAttribute('aYaw', new THREE.InstancedBufferAttribute(A.yaw, 1));
  geo.instanceCount = 0;
  const cityMat = new THREE.ShaderMaterial({ vertexShader: CITY_VS, fragmentShader: CITY_FS, uniforms: common });
  const city = new THREE.Mesh(geo, cityMat);
  city.frustumCulled = false;
  st.scene.add(city);

  const W = { ground, city, gU, cityU: common, place: null, list: [], lut: null, fall: null };
  W.setPlace = key => {
    const T = TERRAINS[key];
    W.place = key;
    gU.uGround.value = T.ground; gU.uWater.value = T.water; gU.uGrid.value = T.grid; gU.uBlock.value.set(T.block || 1, T.road || 0); gU.uCityR.value = T.R;
    W.list = genCity(key, maxN);
    const n = W.list.length;
    W.list.forEach((b, i) => {
      A.box.set([b[0], b[1], b[2], b[3]], i * 4); A.info.set([b[4], b[5], b[6], b[7]], i * 4); A.yaw[i] = b[8];
    });
    geo.instanceCount = n;
    for (const k of ['aBox', 'aInfo', 'aYaw']) geo.attributes[k].needsUpdate = true;
    if (W.lut) applyFx();
  };
  function applyFx() {
    const n = W.list.length;
    for (let i = 0; i < n; i++) {
      const b = W.list[i], v = lutAt(W.lut, Math.hypot(b[0], b[1]));
      A.fx[i * 4] = v[0]; A.fx[i * 4 + 1] = v[1]; A.fx[i * 4 + 2] = v[2]; A.fx[i * 4 + 3] = v[3];
    }
    geo.attributes.aFx.needsUpdate = true;
  }
  // o: { W, h, V, wind m/s, windDir rad, fission }. light: skip the
  // fallout texture (50-100 ms) while a slider is being dragged.
  W.setBurst = (b, light = false) => {
    W.lut = buildLut(b);
    lutTex.image.data.set(W.lut); lutTex.needsUpdate = true;
    applyFx();
    common.uTmax.value = E.thermalPeakTime(b.W);
    const F = E.fireballSizes(b.W, b.h);
    gU.uCrater.value = b.h < F.max * 0.3 ? F.max * 0.18 * (1 - b.h / (F.max * 0.3)) : 0;
    if (light) gU.uWindDir.value.set(Math.cos(b.windDir), Math.sin(b.windDir)); else W.setWind(b);
  };
  W.setWind = b => {
    gU.uWindDir.value.set(Math.cos(b.windDir), Math.sin(b.windDir));
    const f = buildFallout(b, FNX, FNY);
    W.fall = f;
    if (f) {
      fallTex.image.data.set(f.data);
      fallTex.needsUpdate = true;
      gU.uFallBox.value.set(f.x0, f.x1, f.ymax, 0);
    }
  };
  W.setTime = (t, burst) => {
    common.uTime.value = t; common.uBurst.value = burst ? 1 : 0;
  };
  W.waterAt = (x, z) => waterJS(TERRAINS[W.place].water, x, z);
  return W;
}
