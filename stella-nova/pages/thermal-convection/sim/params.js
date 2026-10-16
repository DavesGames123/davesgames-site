// THERMAL CONVECTION · sim/params.js — parameters, presets, grids and the
// frame plan that sim/ref.js (CPU) and sim/gpu.js (WebGPU) share. No DOM.
//
// Units are free-fall units (CONTRACT.md "Physics"): length = layer depth d,
// velocity = sqrt(g alpha dT d), temperature (T - T_top) / dT, time "tff".
//
// Listing (grep -n "^export" sim/params.js):
//   DEFAULTS            the contract defaults
//   MODES, TOPS         the legal mode and top names
//   RA_RANGE            [1e2, 1e7] clamp range. RA_SLIDER [1e3, 1e7] is the
//                       contract slider; the hexagons preset sits below it.
//   PR_RANGE, MA_RANGE  clamp ranges
//   RA_CRIT             critical Ra (Chandrasekhar 1961) per top boundary
//   GRIDS               quality -> [nx, ny, nz] (dx = dy = dz = 1 / nz)
//   TRACERS             quality -> default tracer count
//   MAX_SUBSTEPS        quality -> substep cap per display frame
//   TIME_RATE           tff of sim time per wall second at speed 1
//   CFL, DT_MAX         the step limits
//   TRACER_LIFE         mean tracer life in tff
//   PRESETS             named looks {id, name, params, palette, view, fromRest}
//   clampParams(p)      a full, clamped copy (missing keys from DEFAULTS)
//   cflDt(vmax, dx)     the largest stable step
//   planFrame(frameDt, speed, vmax, dx, maxSub)  -> {n, dt, simDt}

export const DEFAULTS = Object.freeze({
  Ra: 1e5, Pr: 1, Ma: 80, mode: 'plate', top: 'free',
  burner: Object.freeze({ x: 0.5, y: 0.5, r: 0.12, power: 1.5 }), // x, y, r as fractions of Lx, Ly
  cool: 1, noise: 1e-3, speed: 1, Lx: 4, Ly: 4,
});

export const MODES = ['plate', 'burner', 'sun', 'pan'];
export const TOPS = ['rigid', 'free'];
export const RA_RANGE = [1e2, 1e7];
export const RA_SLIDER = [1e3, 1e7];
export const PR_RANGE = [0.1, 10];
export const MA_RANGE = [0, 200];
export const RA_CRIT = { rigid: 1707.76, free: 1100.65 };

// dx = 1 / nz, so Lx = nx / nz = 4 on every grid.
export const GRIDS = Object.freeze({ 0: [64, 64, 16], 1: [96, 96, 24], 2: [128, 128, 32] });
export const TRACERS = Object.freeze({ 0: 6000, 1: 12000, 2: 20000 });
export const MAX_SUBSTEPS = Object.freeze({ 0: 2, 1: 3, 2: 3 });

export const TIME_RATE = 4;     // tff per wall second at speed 1
export const MAX_FRAME_DT = 0.1; // s: a long frame (tab switch) does not jump the sim
export const CFL = 0.7;          // |u| dt / dx per step
export const DT_MAX = 0.1;       // tff: explicit buoyancy and boundary sources stay accurate
export const TRACER_LIFE = 40;   // tff

export const PRESETS = Object.freeze({
  granulation: { id: 'granulation', name: 'Solar granulation', palette: 'solar', view: 'surface',
    params: { mode: 'sun', Ra: 1e6, Pr: 1, top: 'free', cool: 1 } },
  soup: { id: 'soup', name: 'Soup on a burner', palette: 'broth', view: 'split',
    params: { mode: 'burner', Ra: 2e5, Pr: 7, top: 'free', burner: { x: 0.5, y: 0.5, r: 0.12, power: 1.5 } } },
  benard: { id: 'benard', name: 'Rayleigh–Bénard cells', palette: 'inferno', view: 'split',
    params: { mode: 'plate', Ra: 5e4, Pr: 1, top: 'rigid' } },
  // A thin layer: Ra is small, so surface tension (Ma), not buoyancy, makes the cells.
  hexagons: { id: 'hexagons', name: 'Bénard–Marangoni hexagons', palette: 'broth', view: 'split',
    params: { mode: 'pan', Ra: 300, Pr: 7, Ma: 120, top: 'free', cool: 1 } },
  onset: { id: 'onset', name: 'Onset of convection', palette: 'icefire', view: 'split', fromRest: true,
    params: { mode: 'plate', Ra: 3000, Pr: 1, top: 'rigid' } },
  turbulent: { id: 'turbulent', name: 'Turbulent convection', palette: 'inferno', view: 'split',
    params: { mode: 'plate', Ra: 5e6, Pr: 1, top: 'rigid' } },
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function clampParams(p = {}) {
  const b = Object.assign({}, DEFAULTS.burner, p.burner || {});
  return {
    Ra: clamp(num(p.Ra, DEFAULTS.Ra), RA_RANGE[0], RA_RANGE[1]),
    Pr: clamp(num(p.Pr, DEFAULTS.Pr), PR_RANGE[0], PR_RANGE[1]),
    Ma: clamp(num(p.Ma, DEFAULTS.Ma), MA_RANGE[0], MA_RANGE[1]),
    mode: MODES.includes(p.mode) ? p.mode : DEFAULTS.mode,
    top: TOPS.includes(p.top) ? p.top : DEFAULTS.top,
    burner: {
      x: ((num(b.x, 0.5) % 1) + 1) % 1,
      y: ((num(b.y, 0.5) % 1) + 1) % 1,
      r: clamp(num(b.r, 0.12), 0.03, 0.4),
      power: clamp(num(b.power, 1.5), 0, 4),
    },
    cool: clamp(num(p.cool, DEFAULTS.cool), 0.1, 5),
    noise: clamp(num(p.noise, DEFAULTS.noise), 0, 0.1),
    speed: clamp(num(p.speed, DEFAULTS.speed), 0, 8),
    Lx: num(p.Lx, DEFAULTS.Lx),
    Ly: num(p.Ly, DEFAULTS.Ly),
  };
}

export function cflDt(vmax, dx) {
  const v = Number.isFinite(vmax) ? Math.max(vmax, 1e-9) : 1e9;
  return Math.min(DT_MAX, (CFL * dx) / v);
}

// One display frame: the sim time to cover, cut into n equal substeps of at
// most cflDt. If n would pass maxSub, the frame covers less sim time: a slow
// GPU loses speed, never stability.
export function planFrame(frameDt, speed, vmax, dx, maxSub) {
  const want = clamp(num(frameDt, 0), 0, MAX_FRAME_DT) * clamp(num(speed, 1), 0, 8) * TIME_RATE;
  if (!(want > 0)) return { n: 0, dt: 0, simDt: 0 };
  const lim = cflDt(vmax, dx);
  let n = Math.ceil(want / lim - 1e-9);
  let dt = want / n;
  if (n > maxSub) { n = maxSub; dt = lim; }
  return { n, dt, simDt: n * dt };
}
