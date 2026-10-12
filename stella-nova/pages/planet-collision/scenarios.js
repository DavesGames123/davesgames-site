// ============================================================================
//  PLANET COLLISION  ·  scenarios.js — presets and the random draw
// ----------------------------------------------------------------------------
//  A scenario is the input of build.js buildScenario(sc, N, seed):
//    bodies   [{ key (data.js BODIES), massScale?, spinH? (hours) }]
//             bodies[0] is the target, bodies[1] the impactor
//    impact   { vRel (impact speed over the mutual escape speed) or vKms,
//               b (sin of the impact angle, 0 = head-on), d0 (start
//               distance over R1 + R2) }
//    fmin     the floor share of particles for the smaller body (default 0.12)
//  Each preset also has: key, title, sub (one line), src (the paper it
//  follows, or 'hypothetical'), and tags for the page (saver shot types).
//
//  The parameters of a paper are rounded, and the bodies are this page's
//  Tillotson models, not the papers' ANEOS models (CONTRACT.md
//  "Simplifications").
//
//  grep -n targets: "export const PRESETS", "export function randomScenario",
//  "export function presetByKey"
// ============================================================================
import { rng } from './build.js';
import { BODIES } from './data.js';

export const PRESETS = [
  {
    key: 'theia', title: 'Theia makes the Moon', sub: 'a Mars-size body strikes the proto-Earth at 45 degrees',
    bodies: [{ key: 'protoEarth' }, { key: 'theia' }], impact: { vRel: 1.0, b: 0.7, d0: 1.3 },
    src: 'Canup (2004) Icarus 168, 433: gamma 0.11-0.14, b 0.7, v_imp = v_esc', tags: ['disk', 'graze'],
  },
  {
    key: 'moon-earth', title: 'The Moon falls on Earth', sub: 'near head-on, at the mutual escape speed',
    bodies: [{ key: 'earth', spinH: 23.934 }, { key: 'moon' }], impact: { vRel: 1.0, b: 0.25, d0: 1.4 },
    src: 'hypothetical', tags: ['splash', 'crater'],
  },
  {
    key: 'moon-graze', title: 'The Moon grazes Earth', sub: 'a shallow hit: the Moon is torn into a debris arc',
    bodies: [{ key: 'earth', spinH: 23.934 }, { key: 'moon' }], impact: { vRel: 1.05, b: 0.85, d0: 1.4 },
    src: 'hypothetical', tags: ['graze', 'arc'],
  },
  {
    key: 'mars-earth', title: 'Mars hits Earth', sub: 'a planet one tenth of Earth\'s mass, at 30 degrees',
    bodies: [{ key: 'earth', spinH: 23.934 }, { key: 'mars', spinH: 24.623 }], impact: { vRel: 1.1, b: 0.5, d0: 1.3 },
    src: 'hypothetical', tags: ['splash', 'disk'],
  },
  {
    key: 'venus-earth', title: 'Venus meets Earth', sub: 'two near-equal planets merge',
    bodies: [{ key: 'earth' }, { key: 'venus' }], impact: { vRel: 1.0, b: 0.4, d0: 1.25 }, fmin: 0.3,
    src: 'hypothetical (compare Canup 2012, equal-mass giant impacts)', tags: ['merge', 'spiral'],
  },
  {
    key: 'half-earths', title: 'Two half-Earths', sub: 'equal halves spiral into one planet',
    bodies: [{ key: 'earth', massScale: 0.55 }, { key: 'earth', massScale: 0.48 }], impact: { vRel: 1.1, b: 0.55, d0: 1.25 }, fmin: 0.3,
    src: 'after Canup (2012) Science 338, 1052: gamma 0.4-0.5, v_imp near v_esc; rounded', tags: ['merge', 'spiral', 'disk'],
  },
  {
    key: 'synestia', title: 'Fast spin, fast impactor', sub: 'a 2.3 h Earth takes a small body at 20 km/s',
    bodies: [{ key: 'earth', spinH: 2.3 }, { key: 'mars', massScale: 0.47 }], impact: { vKms: 20, b: 0.3, d0: 1.5 },
    src: 'after Cuk & Stewart (2012) Science 338, 1047: day 2.3 h, impactor about 0.05 M_E, 20 km/s; rounded', tags: ['splash', 'vapour'],
  },
  {
    key: 'mercury', title: 'Mercury\'s hit-and-run', sub: 'a glancing blow strips mantle, the core flies on',
    bodies: [{ key: 'venus' }, { key: 'mercury' }], impact: { vRel: 1.6, b: 0.7, d0: 1.4 },
    src: 'after Asphaug & Reufer (2014) Nature Geoscience 7, 564: hit-and-run, v about 1.5 v_esc; rounded', tags: ['hit-run', 'arc'],
  },
  {
    key: 'pluto-charon', title: 'Pluto and Charon', sub: 'an icy oblique hit leaves a binary',
    bodies: [{ key: 'pluto', massScale: 0.7 }, { key: 'pluto', massScale: 0.4 }], impact: { vRel: 1.0, b: 0.8, d0: 1.3 }, fmin: 0.3,
    src: 'after Canup (2005) Science 307, 546: gamma 0.3-0.5, b 0.75-0.95, v_imp near v_esc; rounded', tags: ['graze', 'binary'],
  },
  {
    key: 'vesta-ceres', title: 'Vesta hits Ceres', sub: 'two asteroids at a main-belt speed of 5 km/s',
    bodies: [{ key: 'ceres', spinH: 9.074 }, { key: 'vesta', spinH: 5.342 }], impact: { vKms: 5, b: 0.4, d0: 1.5 },
    src: 'hypothetical (mean main-belt impact speed about 5 km/s, Bottke et al. 1994 Icarus 107, 255)', tags: ['splash', 'ice'],
  },
  {
    key: 'ceres-mars', title: 'Ceres hits Mars', sub: 'a dwarf planet at 12 km/s',
    bodies: [{ key: 'mars', spinH: 24.623 }, { key: 'ceres' }], impact: { vKms: 12, b: 0.5, d0: 1.5 },
    src: 'hypothetical', tags: ['splash', 'crater', 'ice'],
  },
  {
    key: 'earth-head-on', title: 'Mars, head-on', sub: 'straight in at twice the escape speed',
    bodies: [{ key: 'earth' }, { key: 'mars' }], impact: { vRel: 2.0, b: 0.0, d0: 1.4 },
    src: 'hypothetical', tags: ['splash', 'vapour'],
  },
];

export function presetByKey(k) { return PRESETS.find(p => p.key === k) || PRESETS[0]; }

// A random scenario from a seed: target and impactor from real bodies,
// impact angle, speed, spins. The same seed gives the same scenario.
const TARGETS = ['earth', 'venus', 'protoEarth', 'mars', 'mercury', 'pluto', 'ceres'];
export function randomScenario(seed) {
  const R = rng(seed * 7919 + 13);
  const pick = a => a[Math.floor(R() * a.length)];
  const t = pick(TARGETS), Mt = BODIES[t].mass;
  const imps = Object.keys(BODIES).filter(k => k !== t && BODIES[k].mass <= Mt * 1.0001 && BODIES[k].mass >= Mt * 0.005);
  const i = pick(imps);
  const b = Math.round(100 * 0.95 * Math.pow(R(), 0.7)) / 100;
  const vRel = Math.round(100 * (1 + 1.5 * R() * R())) / 100;
  const spin = () => (R() < 0.5 ? null : Math.round(10 * (3 + 30 * R())) / 10 * (R() < 0.2 ? -1 : 1));
  const ratio = BODIES[i].mass / Mt;
  return {
    key: 'random-' + seed, title: BODIES[i].name + ' hits ' + BODIES[t].name,
    sub: 'random draw ' + seed + ': b ' + b.toFixed(2) + ', ' + vRel.toFixed(2) + ' v_esc',
    bodies: [{ key: t, spinH: spin() }, { key: i, spinH: spin() }],
    impact: { vRel, b, d0: 1.35 }, fmin: ratio > 0.3 ? 0.3 : 0.12,
    src: 'hypothetical (random draw)', tags: b > 0.6 ? ['graze'] : ['splash'],
  };
}
