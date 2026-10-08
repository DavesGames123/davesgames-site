// ============================================================================
//  ROCHE LIMIT  ·  scenarios.js — what the page can run
// ----------------------------------------------------------------------------
//  A scenario gives the start of a run: the orbit kind (spiral, flyby,
//  compare, circular), the orbit size in planet radii, the density ratio
//  q = rho_p / rho_s, the material, the planet look, the camera, the speed
//  (orbits per minute of wall time) and the planet's real size (for times
//  and speeds in physical units).
//  The gallery on the page shows SCENARIOS in this order; the first is the
//  default: "How Saturn got its rings". Its moon starts at 2.24 Saturn
//  radii, 4% outside the fluid limit (2.15), and the drag takes it to 1.65
//  in 0.8 orbit. It crosses the limit after 0.24 orbit and starts to shed
//  after 0.56 orbit (Deno probe, N = 8192, 2026-10-08). pacing.js runs the
//  approach at 4x the set speed, so the breakup starts about 3 s after the
//  start on a fast GPU (tests.mjs, test 8). Before 2026-10-08 the moon
//  started at 2.7 and took 4 orbits to reach 1.7: about 25 s to the first
//  shed grains.
//  The drag stands in for tidal decay. It is far faster than in nature
//  (millions of years); the page says so next to the time warp.
//  flattening: the drawn shape of the planet (Saturn 0.098); the physics
//  uses J2 only.
//  Every scenario starts in an inertial planet view, slightly above the
//  ring plane, at a moderate speed; the follow camera is opt-in.
//  REAL holds the real bodies (physics.js BODIES).
//  The moon is drawn larger than real moons (R_s / R_p = S_RATIO, or 0.08
//  for Saturn): the Roche limit does not depend on the moon's size.
//
//  grep -n targets: "export const SCENARIOS", "export const REAL",
//  "export const SATURN_RINGS", "export function specFor", "STORY"
// ============================================================================
import { BODIES, K_FLUID } from './physics.js';

const B = BODIES;
export const S_RATIO = 0.12;     // R_s / R_p on screen and in the sim

// Today's main rings of Saturn, inner and outer edge in km (NASA Saturnian
// rings fact sheet), and the Cassini Division between B and A.
export const SATURN_RINGS = [
  { name: 'C ring', r0: 74658, r1: 92000 },
  { name: 'B ring', r0: 92000, r1: 117580 },
  { name: 'Cassini Division', r0: 117580, r1: 122170 },
  { name: 'A ring', r0: 122170, r1: 136775 },
];

// Narration, one line per phase. {P}: the planet's name.
export const STORY = [
  { key: 'approach', text: 'An icy moon spirals toward {P}.', short: 'Spiral in' },
  { key: 'cross', text: 'It crosses the Roche limit: {P}’s tide now beats the moon’s own gravity.', short: 'Cross the limit' },
  { key: 'torn', text: 'The moon is torn apart into a stream of ice.', short: 'Torn apart' },
  { key: 'ring', text: 'The debris spreads into a ring in {P}’s equator.', short: 'A ring' },
];

export const SCENARIOS = [
  { key: 'saturn', name: 'Saturn’s rings', blurb: 'How an icy moon may have become Saturn’s rings.',
    kind: 'spiral', d: 2.24, d1: 1.65, orbits: 0.8, q: B.saturn.rho / 1.0, J2: B.saturn.J2, s: 0.08, material: 'fluid',
    style: 5, flattening: 0.098, planetName: 'Saturn', Rkm: B.saturn.R, rhoS: 1.0, rings: true, speed: 6, el: 0.22, color: 4,
    hint: 'A Titan-class icy moon (density 1.0 g/cm³) spirals in, as tides and the young ring’s pull drain its orbit (here millions of times faster than in nature). Inside the Roche limit (2.15 Saturn radii for this density) Saturn’s tide tears it apart, and the ice spreads into a ring where the real rings are.' },
  { key: 'close', name: 'A moon too close', blurb: 'A moon spirals inward and crosses its Roche limit.',
    kind: 'spiral', d: 2.55, d1: 1.75, orbits: 0.9, q: 1, material: 'fluid', style: 0, planetName: 'the planet', speed: 6, color: 4,
    hint: 'A loose moon as dense as its planet starts outside the Roche limit (2.44 planet radii) and spirals in. Watch it stretch, cross the limit, shed from both ends and wind into a ring.' },
  { key: 'flyby', name: 'A comet’s close pass', blurb: 'A loose comet swings past Jupiter and breaks into a string of pearls.',
    kind: 'flyby', peri: 1.6, e: 1, q: 2.65, material: 'fluid', style: 2, planetName: 'Jupiter', Rkm: B.jupiter.R, rhoS: 0.5, speed: 3, color: 4,
    hint: 'A comet passes 1.6 Jupiter radii from the centre, as Shoemaker-Levy 9 did in July 1992. The tide pulls it into a stream; the stream’s own gravity then gathers it into a chain of clumps.' },
  { key: 'compare', name: 'Fluid vs solid moon', blurb: 'Two moons on one orbit: one flows, one holds.',
    kind: 'compare', d: 2.0, q: 1, materials: ['fluid', 'rigid'], style: 0, planetName: 'the planet', speed: 4, color: 0,
    hint: 'Two moons on one orbit at 2.0 planet radii, half an orbit apart: a fluid pile (no friction) and a rough pile (friction 0.6). The fluid limit for this density is 2.44, the rigid limit 1.26. The fluid moon sheds; the rough one keeps its shape.' },
  { key: 'bodies', name: 'Real moons today', blurb: 'Phobos, Pan, Io and our Moon: how close to breaking are they?',
    kind: 'real', body: 'phobos', speed: 3, color: 0 },
];

export const REAL = {
  phobos: { name: 'Phobos at Mars', kind: 'circular', d: B.phobos.a / B.mars.R, q: B.mars.rho / B.phobos.rho, J2: B.mars.J2, style: 3, material: 'rigid', rhoS: B.phobos.rho, planetName: 'Mars', Rkm: B.mars.R,
    note: 'Phobos orbits at 2.76 Mars radii, inside its fluid Roche limit (3.12) but outside the rigid one (1.61). A loose pile would shed; friction and strength hold the real moon. Tides bring it inward by about 2 m per century.' },
  pan: { name: 'Pan in the rings of Saturn', kind: 'circular', d: B.pan.a / B.saturn.R, q: B.saturn.rho / B.pan.rho, J2: B.saturn.J2, style: 5, material: 'rigid', rhoS: B.pan.rho, planetName: 'Saturn', Rkm: B.saturn.R, rings: true,
    note: 'Pan orbits in the Encke gap at 2.22 Saturn radii, at 70% of its fluid Roche limit. At that density only a body with friction or cement can hold; ring particles that stray here cannot gather into a moon.' },
  io: { name: 'Io at Jupiter', kind: 'circular', d: B.io.a / B.jupiter.R, q: B.jupiter.rho / B.io.rho, J2: B.jupiter.J2, style: 2, material: 'fluid', rhoS: B.io.rho, planetName: 'Jupiter', Rkm: B.jupiter.R,
    note: 'Io is denser than Jupiter and orbits at 5.9 Jupiter radii, three times its fluid Roche limit (1.76). Even a fluid Io keeps its shape; the tide only raises a bulge.' },
  sl9: { name: 'Shoemaker-Levy 9 at Jupiter', kind: 'flyby', peri: B.sl9.peri / B.jupiter.R, e: 1, q: B.jupiter.rho / B.sl9.rho, J2: B.jupiter.J2, style: 2, material: 'fluid', rhoS: B.sl9.rho, planetName: 'Jupiter', Rkm: B.jupiter.R,
    note: 'In July 1992 the comet passed about 1.6 Jupiter radii from the centre (published estimates run from 1.3 to 1.6), deep inside its fluid limit of 3.4. It came out as a chain of more than 20 fragments that hit Jupiter in July 1994.' },
  moon: { name: 'The Moon at 2.6 Earth radii', kind: 'circular', d: 2.6, q: B.earth.rho / B.moon.rho, J2: B.earth.J2, style: 4, material: 'fluid', rhoS: B.moon.rho, planetName: 'Earth', Rkm: B.earth.R,
    note: 'A thought test: the Moon moved to 2.6 Earth radii (16,600 km), inside its fluid Roche limit of 2.88 Earth radii (18,381 km). Earth would get a ring.' },
};

// The full run spec for the scenario and the Advanced settings. Distances
// in R_p. A scenario with no real planet uses a Saturn-sized planet and an
// icy moon (1 g/cm^3) for the physical units.
export function specFor(sc, ui) {
  let base;
  if (sc.kind === 'real') {
    const r = REAL[ui.body || sc.body];
    base = Object.assign({ key: 'bodies', body: ui.body || sc.body, s: S_RATIO, cam: 'planet', speed: sc.speed, color: sc.color }, r);
  } else {
    base = { key: sc.key, kind: sc.kind, s: sc.s || S_RATIO, style: sc.style, cam: 'planet', q: sc.q, material: sc.material, d: sc.d, peri: sc.peri, e: sc.e,
      J2: sc.J2 || 0, flattening: sc.flattening || 0, planetName: sc.planetName, Rkm: sc.Rkm, rhoS: sc.rhoS, rings: sc.rings, speed: sc.speed, el: sc.el, color: sc.color };
    if (sc.kind === 'spiral') Object.assign(base, { d1: sc.d1, orbits: sc.orbits });
    if (sc.kind === 'compare') base.materials = sc.materials;
  }
  if (!base.Rkm) { base.Rkm = B.saturn.R; base.unitsNote = 'units for a Saturn-sized planet'; }
  if (!base.rhoS) base.rhoS = 1.0;
  return Object.assign(base, pick(ui, base.kind));
}
function pick(ui, kind) {
  const o = {};
  for (const k of ['q', 'material', 'J2', 'mu', 'coh']) if (ui[k] !== undefined) o[k] = ui[k];
  if (kind === 'flyby') { if (ui.peri !== undefined) o.peri = ui.peri; if (ui.e !== undefined) o.e = ui.e; }
  else if (ui.d !== undefined) o.d = ui.d;
  return o;
}
// The start distance of a flyby: 25% outside the fluid limit, so the
// comet starts whole and reaches the limit in about 0.3 T_q (it was 1.5
// d_fluid and at least peri + 2.5 before 2026-10-08).
export function flybyStart(spec) { return Math.max(1.25 * K_FLUID * Math.cbrt(spec.q), spec.peri + 1.0); }
