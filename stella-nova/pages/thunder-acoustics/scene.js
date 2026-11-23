// ============================================================================
//  THUNDER ACOUSTICS  ·  scene.js — terrain, buildings and the atmosphere
// ----------------------------------------------------------------------------
//  Pure module (no DOM). The scene is a vertical cross-section W x H metres.
//  The ground is a height profile sampled every TERRAIN_DX metres. A
//  building is a rigid box { x, w, h } that stands on the ground at x.
//  The atmosphere is a temperature profile T(z); the sound speed is
//  c(z) = 20.05 sqrt(T + 273.15). Air absorption follows ISO 9613-1.
//
//  grep -n: "export function createScene"  "export function groundAt"
//           "export function solidAt"  "export function sightBlock"
//           "export const PROFILES"  "export function isoAlpha"
//           "export function brush"  "export const PRESETS"
// ============================================================================
import { soundSpeed } from './channel.js';

export const W = 16000, H = 6000, TERRAIN_DX = 10;

export function createScene() {
  return {
    W, H,
    terrain: new Float32Array(Math.round(W / TERRAIN_DX) + 1),
    buildings: [],
    atm: { profile: 'standard', T0: 20, RH: 60 },
  };
}

export function groundAt(sc, x) {
  const t = sc.terrain, f = Math.max(0, Math.min(t.length - 1.0001, x / TERRAIN_DX));
  const i = Math.floor(f), u = f - i;
  return t[i] * (1 - u) + t[i + 1] * u;
}
// Top of the solid (ground or a roof) at x.
export function surfaceAt(sc, x) {
  let g = groundAt(sc, x);
  for (const b of sc.buildings) if (x >= b.x - b.w / 2 && x <= b.x + b.w / 2) g = Math.max(g, b.base + b.h);
  return g;
}
export function solidAt(sc, x, z) { return z < surfaceAt(sc, x); }
// Set the base of each building to the ground under its centre.
export function settle(sc) {
  for (const b of sc.buildings) {
    let lo = Infinity;
    for (let x = b.x - b.w / 2; x <= b.x + b.w / 2; x += TERRAIN_DX) lo = Math.min(lo, groundAt(sc, x));
    b.base = lo;
  }
}

// Raise (sign +1) or lower (-1) the ground with a Gaussian brush.
export function brush(sc, x, sign, radius = 500, amount = 60) {
  const t = sc.terrain;
  const i0 = Math.max(0, Math.floor((x - 3 * radius) / TERRAIN_DX)), i1 = Math.min(t.length - 1, Math.ceil((x + 3 * radius) / TERRAIN_DX));
  for (let i = i0; i <= i1; i++) {
    const d = (i * TERRAIN_DX - x) / radius;
    t[i] = Math.max(0, Math.min(2200, t[i] + sign * amount * Math.exp(-0.5 * d * d)));
  }
  settle(sc);
}
export function hill(sc, x, height, halfWidth) {
  const t = sc.terrain;
  for (let i = 0; i < t.length; i++) {
    const d = (i * TERRAIN_DX - x) / halfWidth;
    t[i] += height * Math.exp(-0.5 * d * d * 2.2);
  }
}

// Temperature profiles T(z) in deg C. z in metres above sea level 0.
export const PROFILES = {
  standard: { name: 'Standard atmosphere', note: 'T falls 6.5 K per km. c falls with height, so rays bend up and a shadow zone forms far from the flash.', T: (T0, z) => T0 - 0.0065 * z },
  isothermal: { name: 'Isothermal', note: 'c is the same at every height. Rays are straight lines.', T: (T0) => T0 },
  inversion: { name: 'Surface inversion', note: 'T rises 12 K over the first 400 m, then falls. Rays that go up bend back to the ground: the sound is ducted far.', T: (T0, z) => z < 400 ? T0 + 12 * z / 400 : T0 + 12 - 0.0065 * (z - 400) },
  superadiabatic: { name: 'Strong lapse', note: 'T falls 9.8 K per km, the dry adiabatic rate. Rays bend up more and the shadow comes closer.', T: (T0, z) => T0 - 0.0098 * z },
};
export function tempAt(sc, z) { return (PROFILES[sc.atm.profile] || PROFILES.standard).T(sc.atm.T0, z); }
export function cAt(sc, z) { return soundSpeed(tempAt(sc, z)); }
// Mean slowness 1/c on the straight path from height za to zb.
export function slowness(sc, za, zb) {
  const n = 8;
  let s = 0;
  for (let i = 0; i < n; i++) s += 1 / cAt(sc, za + (zb - za) * (i + 0.5) / n);
  return s / n;
}

// ISO 9613-1 pure-tone air absorption in dB per metre.
//   f Hz, Tc deg C, RH percent, pa kPa
export function isoAlpha(f, Tc = 20, RH = 50, pa = 101.325) {
  const T = Tc + 273.15, T0 = 293.15, T01 = 273.16, pr = 101.325;
  const psat = pr * Math.pow(10, -6.8346 * Math.pow(T01 / T, 1.261) + 4.6151);
  const h = RH * psat / pa;
  const prr = pa / pr;
  const frO = prr * (24 + 4.04e4 * h * (0.02 + h) / (0.391 + h));
  const frN = prr * Math.pow(T / T0, -0.5) * (9 + 280 * h * Math.exp(-4.170 * (Math.pow(T / T0, -1 / 3) - 1)));
  const f2 = f * f;
  return 8.686 * f2 * (1.84e-11 / prr * Math.sqrt(T / T0)
    + Math.pow(T / T0, -2.5) * (0.01275 * Math.exp(-2239.1 / T) / (frO + f2 / frO)
      + 0.1068 * Math.exp(-3352.0 / T) / (frN + f2 / frN)));
}

// Line of sight from a to b. Returns null if clear, else the obstruction
// point of the largest blockage { x, z, d } (d = path excess over the top
// of the blocking surface, as a single knife edge).
export function sightBlock(sc, ax, az, bx, bz, step = 40) {
  const L = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.ceil(L / step));
  let worst = null, worstH = 0;
  for (let i = 1; i < n; i++) {
    const u = i / n, x = ax + (bx - ax) * u, z = az + (bz - az) * u;
    const s = surfaceAt(sc, x);
    if (s > z && s - z > worstH) { worstH = s - z; worst = { x, z: s }; }
  }
  if (!worst) return null;
  worst.d = Math.hypot(worst.x - ax, worst.z - az) + Math.hypot(bx - worst.x, bz - worst.z) - L;
  return worst;
}

// Ready-made scenes. Each sets the terrain, buildings, atmosphere, the
// stroke and the microphone.
export const PRESETS = {
  plain: {
    name: 'Open plain', note: 'Flat ground and a standard atmosphere. The reference case.',
    build(sc) { sc.atm.profile = 'standard'; },
    stroke: [[5200, 4300], [6100, 2200], [5600, 0]], mic: [9500, 2], seed: 11,
  },
  ridge: {
    name: 'Ridge shadow', note: 'A 700 m ridge stands between the flash and the microphone. The direct sound diffracts over the crest.',
    build(sc) { sc.atm.profile = 'standard'; hill(sc, 8600, 700, 900); },
    stroke: [[4200, 4400], [5000, 2300], [4600, 0]], mic: [10400, 2], seed: 23,
  },
  valley: {
    name: 'Valley echoes', note: 'Two valley walls send late echoes back to a microphone on the valley floor.',
    build(sc) { sc.atm.profile = 'standard'; hill(sc, 3600, 900, 1100); hill(sc, 12200, 1000, 1200); },
    stroke: [[6600, 4500], [7400, 2600], [7000, 0]], mic: [9300, 2], seed: 5,
  },
  inversion: {
    name: 'Night inversion', note: 'Warm air above cool ground bends the sound back down. Thunder carries farther.',
    build(sc) { sc.atm.profile = 'inversion'; sc.atm.T0 = 12; },
    stroke: [[2600, 4300], [3300, 2100], [3000, 0]], mic: [12500, 2], seed: 31,
  },
  urban: {
    name: 'Urban blocks', note: 'Rows of 20 to 60 m buildings around the microphone scatter and screen the sound.',
    build(sc) {
      sc.atm.profile = 'standard';
      let r = 7;
      for (let x = 8200; x < 11800; x += 160) { r = (r * 9301 + 49297) % 233280; if (Math.abs(x - 9800) > 60) sc.buildings.push({ x, w: 90, h: 20 + 40 * r / 233280 }); }
    },
    stroke: [[5400, 4200], [6000, 2300], [6200, 0]], mic: [9800, 2], seed: 41,
  },
};
export function applyPreset(sc, key) {
  const P = PRESETS[key] || PRESETS.plain;
  sc.terrain.fill(0); sc.buildings.length = 0; sc.atm.profile = 'standard'; sc.atm.T0 = 20;
  P.build(sc); settle(sc);
  return P;
}
