// ============================================================================
//  CORAL REEF  ·  fauna/glow.js  ·  how the photophores of an animal glow
// ----------------------------------------------------------------------------
//  DOM-free. The user said (2026-10-18): "the bioluminescence across
//  organisms is poorly done. bloom on textures please". The light comes
//  from the photophore map on the body (gen/mesh.js dots and organ,
//  fauna/glsl.js phoMask). This module gives each glowing animal, each
//  frame, the four levels of its photophores (the iGlow instance vec4):
//    x steady .... the display glow: a slow breath, dim in a lamp beam
//    y counter ... counter-illumination: the ventral photophores send down
//                  as much light as comes down from above (the twilight
//                  zone), so the belly does not show as a dark shape
//    z flash ..... a startle flash when an ROV comes near or its lamp
//                  hits the animal; it decays over `decay` seconds
//    w wave ...... the phase (cycles) of the flash wave along the wave
//                  coordinate of the map (along the body, round the
//                  Atolla ring: its "burglar alarm" pinwheel)
//  Real animals stop most of their display glow in a bright light, and a
//  photophore does not show in a lamp beam: dim(lamp) takes the steady
//  level and part of the flash down.
//
//  API
//    glowParams(sp) -> null | { colour, k, steady, breath, counter, wave,
//                     decay, startR, touch, peak }   (per species, cached)
//    downwelling(uDown, y) ... the downwelling light at world height y: the
//                     twin of the sky term of shaders.js WATER
//    counterLevel(down, peak) the counter level that makes the mean belly
//                     emission equal to the downwelling luminance
//    lampAt(p, rovs) ......... 0 .. about 1: how much ROV lamp light is at p
//    dim(lamp) ............... the share of the display glow left in a beam
//    createGlowState(cap) -> { step(i, P, o) -> [x, y, z, w], flash, reset(i) }
//
//  grep -n targets: "export function glowParams", "export function counterLevel",
//  "export function lampAt", "export function createGlowState"
// ============================================================================
import { hex } from './gen/mesh.js';

export const SURF_Y = 55;
// shaders.js WATER: sky = vec3(0.10, 0.30, 0.52) * uDown * exp(-(SURF_Y - y) * 0.03)
export const SKY = [0.10, 0.30, 0.52];
export const SKY_LUM = 0.2126 * SKY[0] + 0.7152 * SKY[1] + 0.0722 * SKY[2];
export const SKY_K = 0.03;
// the emissive gain of the fauna materials (uGlowK) and the mean cover of
// the dots in a photophore band (fauna/glsl.js phoMask, radius 0.3 cells)
export const GLOW_GAIN = 2.0;
export const COVER = 0.25;
const TAU = Math.PI * 2;

// the behaviour of each kind of glowing animal (sp.glow fields override)
const KIND = {
  fish: { steady: 0.7, breath: 0.12, counter: true, wave: 2.5, decay: 0.9, startR: 3 },
  angler: { steady: 0.9, breath: 0.08, counter: false, wave: 0, decay: 1.5, startR: 2.5 },
  jelly: { steady: 0.25, breath: 0.1, counter: false, wave: 1.2, decay: 5, startR: 4 },
  sipho: { steady: 0.3, breath: 0.07, counter: false, wave: 0.8, decay: 2, startR: 3 },
  squid: { steady: 0.5, breath: 0.1, counter: true, wave: 1.5, decay: 1.5, startR: 3 },
  ceph: { steady: 0.45, breath: 0.08, counter: false, wave: 1, decay: 2.5, startR: 3 },
  cucumber: { steady: 0.15, breath: 0.06, counter: false, wave: 0.7, decay: 3, startR: 3 },
  pen: { steady: 0, breath: 0.05, counter: false, wave: 0.5, decay: 3, startR: 1.4, touch: true },
  other: { steady: 0.5, breath: 0.1, counter: false, wave: 1, decay: 1.5, startR: 3 },
};
function kindOf(sp) {
  const f = sp.family || '', gen = sp.model && sp.model.gen;
  if (f === 'anglerfish') return 'angler';
  if (gen === 'fish' || f === 'fish') return 'fish';
  if (gen === 'medusa' || f === 'jellyfish') return 'jelly';
  if (gen === 'sipho') return 'sipho';
  if (f === 'squid') return 'squid';
  if (gen === 'ceph') return 'ceph';
  if (gen === 'cucumber') return 'cucumber';
  if (gen === 'seapen') return 'pen';
  return 'other';
}
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// keyed by the species object: generated ids repeat across seeds
const cache = new WeakMap();
export function glowParams(sp) {
  if (!sp) return null;
  if (cache.has(sp)) return cache.get(sp);
  const mg = sp.model && sp.model.p && sp.model.p.glow;
  const g = sp.glow || (mg ? { colour: mg.colour, k: mg.k } : null);
  let P = null;
  if (g) {
    P = Object.assign({ colour: g.colour ?? 0x40a0ff, k: g.k ?? 1 }, KIND[kindOf(sp)], g);
    // the luminance of the brightest photophore (the vertex glow is colour x k x 3)
    P.peak = lum(hex(mg && mg.colour != null ? mg.colour : P.colour)) * (mg && mg.k != null ? mg.k : P.k) * 3;
  }
  cache.set(sp, P);
  return P;
}

export function downwelling(uDown, y) { return Math.max(0, uDown) * Math.exp(-Math.max(0, SURF_Y - y) * SKY_K); }
export function counterLevel(down, peak) { return peak > 0 && down > 0 ? down * SKY_LUM / (peak * COVER * GLOW_GAIN) : 0; }

// the lamp light at p (world m) from rovs [{ p, look }]: a cone of about
// 25 degrees, falling off with distance (6 m: half)
export function lampAt(p, rovs) {
  if (!rovs) return 0;
  let L = 0;
  for (const r of rovs) {
    if (!r || !r.p || !r.look) continue;
    const dx = p[0] - r.p[0], dy = p[1] - r.p[1], dz = p[2] - r.p[2], d = Math.hypot(dx, dy, dz);
    if (d > 30 || d < 1e-3) continue;
    const ll = Math.hypot(r.look[0], r.look[1], r.look[2]) || 1;
    const c = (dx * r.look[0] + dy * r.look[1] + dz * r.look[2]) / (d * ll);
    const t = Math.min(1, Math.max(0, (c - 0.82) / 0.13)), cone = t * t * (3 - 2 * t);
    L += cone / (1 + (d / 6) * (d / 6));
  }
  return L;
}
export function dim(lamp) { return 1 / (1 + 4 * Math.max(0, lamp)); }

// the per-animal flash state (index = the sim slot)
export function createGlowState(cap) {
  const flash = new Float32Array(cap), wave = new Float32Array(cap), refr = new Float32Array(cap), prevD = new Float32Array(cap).fill(1e9);
  const out = [0, 0, 0, 0];
  // o: { dt, t, phase (0..1), d (nearest ROV, m), lamp, startle (sim.glow), down }
  function step(i, P, o) {
    const dt = o.dt || 0;
    flash[i] *= Math.exp(-dt / Math.max(0.05, P.decay));
    wave[i] += dt * P.wave; if (wave[i] > 1000) wave[i] -= 1000;
    refr[i] -= dt;
    const near = o.d < P.startR, closing = prevD[i] - o.d > 0.002;
    const hit = refr[i] <= 0 && ((near && (closing || o.d < P.startR * 0.5)) || (!P.touch && (o.lamp > 0.5 || o.startle > 0.5)));
    if (hit) { flash[i] = 1; wave[i] = 0; refr[i] = P.decay * 2 + 2; }
    prevD[i] = o.d;
    const dm = dim(o.lamp);
    out[0] = P.steady * (0.8 + 0.2 * Math.sin(TAU * (o.t * P.breath + o.phase))) * dm;
    out[1] = P.counter ? counterLevel(o.down, P.peak) : 0;
    out[2] = flash[i] * 2.5 * Math.sqrt(dm);
    out[3] = wave[i];
    return out;
  }
  function reset(i) { flash[i] = 0; wave[i] = 0; refr[i] = 0; prevD[i] = 1e9; }
  return { step, reset, flash, wave };
}
