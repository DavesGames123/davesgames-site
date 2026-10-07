// ============================================================================
//  ROCHE LIMIT  ·  scenarios.js — what the page can run
// ----------------------------------------------------------------------------
//  A scenario gives the start of a run: the orbit kind (circular, flyby,
//  spiral, compare), the orbit size in planet radii, the density ratio
//  q = rho_p / rho_s, the material, the planet style, the camera and the
//  time warp. main.js copies it into the panel, and the panel can change it.
//  Every scenario starts in an inertial planet or top view at a low time
//  warp; the follow camera is opt-in (the user found motion nauseating).
//  REAL holds the real bodies. Their densities and distances come from
//  physics.js BODIES. The satellite is drawn at R_s / R_p = 0.12 for every
//  body: the Roche limit does not depend on the satellite size.
//
//  grep -n targets: "export const SCENARIOS", "export const REAL",
//  "export function specFor"
// ============================================================================
import { BODIES, K_FLUID } from './physics.js';

const B = BODIES;
export const S_RATIO = 0.12;     // R_s / R_p on screen and in the sim

export const SCENARIOS = [
  { key: 'moon', name: 'Moon inside the limit', short: 'Moon', kind: 'circular', d: 1.9, q: 1, material: 'fluid', style: 0, cam: 'planet', warp: 2,
    hint: 'A fluid rubble moon on a circular orbit at 1.9 planet radii, inside its fluid Roche limit (2.44 for equal densities). It stretches toward the planet, sheds grains from its two tips and the stream winds into a ring.' },
  { key: 'flyby', name: 'Comet flyby', short: 'Flyby', kind: 'flyby', peri: 1.6, e: 1, q: 2.65, material: 'fluid', style: 2, cam: 'planet', warp: 2,
    hint: 'A loose comet passes a Jupiter-like planet on a parabola, closest at 1.6 R_p, as Shoemaker-Levy 9 did in July 1992. The tide pulls it into a stream; the stream\'s own gravity then gathers it into a string of clumps.' },
  { key: 'spiral', name: 'Spiral through the limit', short: 'Spiral', kind: 'spiral', d: 3.1, d1: 1.2, orbits: 7, q: 1, material: 'rigid', style: 1, cam: 'planet', warp: 3,
    hint: 'A slow drag (tidal decay, in a few orbits instead of millions of years) moves a rough moon inward from 3.1 R_p. Watch the bound mass hold, then fall as the moon crosses its limit.' },
  { key: 'ring', name: 'Ring formation (long)', short: 'Ring', kind: 'circular', d: 1.55, q: 1, material: 'fluid', style: 1, cam: 'top', warp: 5, nScale: 0.5, ringBlend: 0.9,
    hint: 'A long run at high time warp with fewer grains: a moon deep inside the limit comes apart, and Keplerian shear winds the debris into a full ring in some tens of orbits. Gaps and clumps form where the grains still pull on each other.' },
  { key: 'compare', name: 'Fluid and rigid', short: 'Compare', kind: 'compare', d: 2.0, q: 1, materials: ['fluid', 'rigid'], style: 0, cam: 'planet', warp: 2,
    hint: 'Two moons on one orbit at 2.0 R_p, half an orbit apart: a fluid pile (no friction) and a rough pile (friction 0.6, rolling resistance). The fluid limit for this density is 2.44, the rigid limit 1.26. The fluid moon sheds; the rough one keeps its shape.' },
  { key: 'bodies', name: 'Real bodies', short: 'Real', kind: 'real', body: 'phobos', warp: 2,
    hint: 'Real pairs with their real density ratio and distance.' },
];

export const REAL = {
  phobos: { name: 'Phobos at Mars', kind: 'circular', d: B.phobos.a / B.mars.R, q: B.mars.rho / B.phobos.rho, J2: B.mars.J2, style: 3, material: 'rigid', rhoS: B.phobos.rho,
    note: 'Phobos orbits at 2.76 Mars radii, inside its fluid Roche limit (3.12) but outside the rigid one (1.61). A loose pile would shed; friction and strength hold the real moon. Tides bring it inward by about 2 m per century.' },
  pan: { name: 'Pan in the rings of Saturn', kind: 'circular', d: B.pan.a / B.saturn.R, q: B.saturn.rho / B.pan.rho, J2: B.saturn.J2, style: 1, material: 'rigid', rhoS: B.pan.rho,
    note: 'Pan orbits in the Encke gap at 2.22 Saturn radii, at 70% of its fluid Roche limit. At that density only a body with friction or cement can hold; ring particles that stray here cannot gather into a moon.' },
  io: { name: 'Io at Jupiter', kind: 'circular', d: B.io.a / B.jupiter.R, q: B.jupiter.rho / B.io.rho, J2: B.jupiter.J2, style: 2, material: 'fluid', rhoS: B.io.rho, cam: 'planet',
    note: 'Io is denser than Jupiter and orbits at 5.9 Jupiter radii, three times its fluid Roche limit (1.76). Even a fluid Io keeps its shape; the tide only raises a bulge.' },
  sl9: { name: 'Shoemaker-Levy 9 at Jupiter', kind: 'flyby', peri: B.sl9.peri / B.jupiter.R, e: 1, q: B.jupiter.rho / B.sl9.rho, J2: B.jupiter.J2, style: 2, material: 'fluid', rhoS: B.sl9.rho,
    note: 'In July 1992 the comet passed about 1.6 Jupiter radii from the centre (published estimates run from 1.3 to 1.6), deep inside its fluid limit of 3.4. It came out as a chain of more than 20 fragments that hit Jupiter in July 1994.' },
  moon: { name: 'The Moon at 2.6 Earth radii', kind: 'circular', d: 2.6, q: B.earth.rho / B.moon.rho, J2: B.earth.J2, style: 4, material: 'fluid', rhoS: B.moon.rho,
    note: 'A thought test: the Moon moved to 2.6 Earth radii (16,600 km), inside its fluid Roche limit of 2.88 Earth radii (18,381 km). Earth would get a ring.' },
};

// The full run spec for the scenario and the panel state. Distances in R_p.
export function specFor(sc, ui) {
  if (sc.kind === 'real') {
    const r = REAL[ui.body || sc.body];
    return Object.assign({ key: 'bodies', body: ui.body || sc.body, s: S_RATIO, cam: r.cam || 'planet' }, r, pick(ui, r.kind));
  }
  const base = { key: sc.key, kind: sc.kind, s: S_RATIO, style: sc.style, cam: sc.cam, q: sc.q, material: sc.material, d: sc.d, peri: sc.peri, e: sc.e, J2: 0 };
  if (sc.kind === 'spiral') Object.assign(base, { d1: sc.d1, orbits: sc.orbits });
  if (sc.kind === 'compare') base.materials = sc.materials;
  return Object.assign(base, pick(ui, sc.kind));
}
function pick(ui, kind) {
  const o = {};
  for (const k of ['q', 'material', 'J2', 'mu', 'coh']) if (ui[k] !== undefined) o[k] = ui[k];
  if (kind === 'flyby') { if (ui.peri !== undefined) o.peri = ui.peri; if (ui.e !== undefined) o.e = ui.e; }
  else if (ui.d !== undefined) o.d = ui.d;
  return o;
}
// The start distance of a flyby: well outside the fluid limit.
export function flybyStart(spec) { return Math.max(1.5 * K_FLUID * Math.cbrt(spec.q), spec.peri + 2.5); }
