// ============================================================================
//  PLANET COLLISION  ·  scenarios.js — presets and the random draw
// ----------------------------------------------------------------------------
//  A scenario is the input of build.js buildScenario(sc, N, seed):
//    bodies   [{ key (data.js BODIES), massScale?, spinH? (hours),
//               layers? (a composition that replaces the data.js one) }]
//             bodies[0] is the target, bodies[1] the impactor
//    impact   { vRel (impact speed over the mutual escape speed) or vKms,
//               b (sin of the impact angle, 0 = head-on), d0 (start
//               distance over R1 + R2) }
//    fmin     the floor share of particles for the smaller body (default 0.12)
//  Each preset also has: key, title, sub (one line), src (the paper it
//  follows, or 'hypothetical'), and tags (shot hints for the saver).
//
//  The parameters of a paper are rounded, and the bodies are this page's
//  Tillotson models, not the papers' ANEOS models (CONTRACT.md
//  "Simplifications").
//
//  RANDOM DRAW (fn randomScenario). One seed sets every choice:
//    target      a real body, mass x 0.7-1.4 in half the draws
//    impactor    a real body of 0.8 % to 100 % of the target mass, or a
//                twin of the target (one draw in ten)
//    composition per body: as measured, iron-rich, core-poor, basaltic,
//                an ice shell, or dry (fn composition)
//    angle       b = sqrt(U): the isotropic flux of impactors, so 45 degrees
//                is the most probable angle (Shoemaker 1962)
//    speed       1-2.6 v_esc, and one draw in eight 2.6-4 v_esc
//    spins       none, or a period of 3-30 h, one in five retrograde
//  The title is made from the draw ("An iron-rich Mars grazes a
//  fast-spinning Venus"). The same seed gives the same scenario.
//
//  grep -n targets: "export const PRESETS", "export function randomScenario",
//  "export function presetByKey", "export function composition",
//  "export function titleOf"
// ============================================================================
import { rng } from './build.js';
import { BODIES } from './data.js';

export const PRESETS = [
  {
    key: 'moon-earth', title: 'The Moon crashes into Earth', sub: 'near head-on, at the mutual escape speed',
    bodies: [{ key: 'earth', spinH: 23.934 }, { key: 'moon' }], impact: { vRel: 1.0, b: 0.25, d0: 1.4 },
    src: 'hypothetical', tags: ['splash', 'crater'],
  },
  {
    key: 'theia', title: 'Theia makes the Moon', sub: 'a Mars-size body strikes the proto-Earth at 45 degrees',
    bodies: [{ key: 'protoEarth' }, { key: 'theia' }], impact: { vRel: 1.0, b: 0.7, d0: 1.3 },
    src: 'Canup (2004) Icarus 168, 433: gamma 0.11-0.14, b 0.7, v_imp = v_esc', tags: ['disk', 'graze'],
  },
  {
    key: 'synestia', title: 'Synestia', sub: 'two half-Earths at high energy: a spinning, vapour-rich mass forms',
    bodies: [{ key: 'earth', massScale: 0.52, spinH: 5 }, { key: 'earth', massScale: 0.5 }], impact: { vRel: 1.45, b: 0.45, d0: 1.3 }, fmin: 0.3,
    src: 'after Lock & Stewart (2017) JGR Planets 122, 950: high-energy, high-angular-momentum impacts make synestias; parameters illustrative', tags: ['vapour', 'disk', 'merge'],
  },
  {
    key: 'hit-run', title: 'Hit and run', sub: 'a Mars-size body grazes Earth fast and flies on, stripped',
    bodies: [{ key: 'earth', spinH: 23.934 }, { key: 'mars' }], impact: { vRel: 1.45, b: 0.72, d0: 1.3 },
    src: 'after Asphaug, Agnor & Williams (2006) Nature 439, 155: hit-and-run for oblique hits a little over v_esc; rounded', tags: ['hit-run', 'arc'],
  },
  {
    key: 'mars-graze', title: 'Mars-sized grazing impact', sub: 'a shallow hit at the escape speed: a long arc of melt',
    bodies: [{ key: 'earth', spinH: 23.934 }, { key: 'mars', spinH: 24.623 }], impact: { vRel: 1.0, b: 0.9, d0: 1.3 },
    src: 'hypothetical (compare Canup 2004, b 0.7-0.9)', tags: ['graze', 'arc', 'disk'],
  },
  {
    key: 'mercury', title: 'Mercury loses its mantle', sub: 'a glancing blow strips rock, the iron core flies on',
    bodies: [{ key: 'venus' }, { key: 'mercury' }], impact: { vRel: 1.6, b: 0.7, d0: 1.4 },
    src: 'after Asphaug & Reufer (2014) Nature Geoscience 7, 564: hit-and-run, v about 1.5 v_esc; rounded', tags: ['hit-run', 'arc'],
  },
  {
    key: 'pluto-charon', title: 'Pluto and Charon', sub: 'an icy oblique hit leaves a binary',
    bodies: [{ key: 'pluto', massScale: 0.7 }, { key: 'pluto', massScale: 0.4 }], impact: { vRel: 1.0, b: 0.8, d0: 1.3 }, fmin: 0.3,
    src: 'after Canup (2005) Science 307, 546: gamma 0.3-0.5, b 0.75-0.95, v_imp near v_esc; rounded', tags: ['graze', 'binary'],
  },
  {
    key: 'two-earths', title: 'Two Earths head-on', sub: 'equal planets, straight in at 1.3 times the escape speed',
    bodies: [{ key: 'earth' }, { key: 'earth' }], impact: { vRel: 1.3, b: 0.0, d0: 1.3 }, fmin: 0.3,
    src: 'hypothetical', tags: ['splash', 'vapour', 'merge'],
  },
  {
    key: 'rheasilvia', title: 'Vesta’s Rheasilvia blow', sub: 'a 66 km body hits Vesta at 5.4 km/s and 30 degrees',
    bodies: [{ key: 'vesta', spinH: 5.342 }, { key: 'vesta', massScale: 0.002 }], impact: { vKms: 5.4, b: 0.5, d0: 2.2 }, fmin: 0.055,
    src: 'after Jutzi et al. (2013) Nature 494, 207: a 66 km impactor at 5.4 km/s; here with no material strength (a fluid Vesta)', tags: ['splash', 'crater'],
  },
  {
    key: 'ceres-mars', title: 'Ceres hits Mars', sub: 'a dwarf planet at 12 km/s',
    bodies: [{ key: 'mars', spinH: 24.623 }, { key: 'ceres' }], impact: { vKms: 12, b: 0.5, d0: 1.5 },
    src: 'hypothetical', tags: ['splash', 'crater', 'ice'],
  },
  {
    key: 'moon-graze', title: 'The Moon grazes Earth', sub: 'a shallow hit: the Moon is torn into a debris arc',
    bodies: [{ key: 'earth', spinH: 23.934 }, { key: 'moon' }], impact: { vRel: 1.05, b: 0.85, d0: 1.4 },
    src: 'hypothetical', tags: ['graze', 'arc'],
  },
  {
    key: 'mars-earth', title: 'Mars hits Earth', sub: 'a planet one tenth of Earth’s mass, at 30 degrees',
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
    key: 'fast-spin', title: 'Fast spin, fast impactor', sub: 'a 2.3 h Earth takes a small body at 20 km/s',
    bodies: [{ key: 'earth', spinH: 2.3 }, { key: 'mars', massScale: 0.47 }], impact: { vKms: 20, b: 0.3, d0: 1.5 },
    src: 'after Cuk & Stewart (2012) Science 338, 1047: day 2.3 h, impactor about 0.05 M_E, 20 km/s; rounded', tags: ['splash', 'vapour'],
  },
  {
    key: 'vesta-ceres', title: 'Vesta hits Ceres', sub: 'two asteroids at a main-belt speed of 5 km/s',
    bodies: [{ key: 'ceres', spinH: 9.074 }, { key: 'vesta', spinH: 5.342 }], impact: { vKms: 5, b: 0.4, d0: 1.5 },
    src: 'hypothetical (mean main-belt impact speed about 5 km/s, Bottke et al. 1994 Icarus 107, 255)', tags: ['splash', 'ice'],
  },
  {
    key: 'earth-head-on', title: 'Mars, head-on', sub: 'straight in at twice the escape speed',
    bodies: [{ key: 'earth' }, { key: 'mars' }], impact: { vRel: 2.0, b: 0.0, d0: 1.4 },
    src: 'hypothetical', tags: ['splash', 'vapour'],
  },
];

export function presetByKey(k) { return PRESETS.find(p => p.key === k) || PRESETS[0]; }

// ── composition ─────────────────────────────────────────────────────────
// A variant of the data.js layers of a body, or null (as measured).
// Returns { layers, word } (word: the adjective for the title, '' for none).
export const VARIANTS = ['real', 'ironRich', 'corePoor', 'basaltic', 'icy', 'dry'];
export function composition(key, variant) {
  const L = BODIES[key].layers, f = k => (L.find(l => l[0] === k) || [k, 0])[1];
  const iron = f('iron'), ice = f('ice');
  const rock = L.filter(l => l[0] !== 'iron' && l[0] !== 'ice').map(l => l[0])[0] || 'basalt';
  const make = (fi, rk, fc) => {
    const out = [];
    if (fi > 0) out.push(['iron', fi]);
    if (1 - fi - fc > 0) out.push([rk, 1 - fi - fc]);
    if (fc > 0) out.push(['ice', fc]);
    return out;
  };
  switch (variant) {
    case 'ironRich': return iron > 0 && iron < 0.6 ? { layers: make(Math.min(0.7, 1.8 * iron), rock, ice), word: 'iron-rich' } : null;
    case 'corePoor': return iron > 0.05 ? { layers: make(0.4 * iron, rock, ice), word: 'core-poor' } : null;
    case 'basaltic': return rock === 'granite' ? { layers: make(iron, 'basalt', ice), word: 'basaltic' } : null;
    case 'icy': return ice === 0 && iron < 0.5 ? { layers: make(iron * 0.8, rock, 0.25), word: 'icy' } : null;
    case 'dry': return ice > 0 ? { layers: make(iron, 'basalt', 0), word: 'dry' } : null;
    default: return null;
  }
}

// ── random draw ─────────────────────────────────────────────────────────
const TARGETS = ['earth', 'earth', 'venus', 'protoEarth', 'mars', 'mars', 'mercury', 'moon', 'pluto', 'ceres', 'vesta'];
const NAME = { protoEarth: 'the proto-Earth', earth: 'Earth', moon: 'the Moon' };
const nameOf = k => NAME[k] || BODIES[k].name;

// The words of a draw -> a title. d: { t, i, adjT, adjI, theta, vRel, twin }
export function titleOf(d) {
  const verb = d.theta < 18 ? 'slams head-on into' : d.theta < 42 ? 'strikes' : d.theta < 62 ? 'hits' : 'grazes';
  const art = w => (/^[aeiouAEIOU]/.test(w) ? 'An ' : 'A ');
  const np = (k, adj) => {
    const n = nameOf(k).replace(/^the /, '');
    if (!adj.length) return nameOf(k);
    const w = adj.join(' ') + ' ' + n;
    return art(w).trim().toLowerCase() + ' ' + w;
  };
  let s = np(d.i, d.adjI);
  if (d.twin) s = (d.adjI.length ? np(d.i, d.adjI) : 'A second ' + nameOf(d.i).replace(/^the /, ''));
  s = s[0].toUpperCase() + s.slice(1);
  const fast = d.vRel >= 2.6 ? ' at a blistering speed' : '';
  return `${s} ${verb} ${np(d.t, d.adjT)}${fast}`;
}

export function randomScenario(seed) {
  const R = rng(seed * 7919 + 13);
  const pick = a => a[Math.floor(R() * a.length)];
  const t = pick(TARGETS);
  const sT = R() < 0.5 ? 1 : Math.round(100 * Math.exp(Math.log(0.7) + R() * Math.log(2))) / 100;
  const Mt = BODIES[t].mass * sT;
  const twin = R() < 0.1;
  let i = t, sI = 1;
  if (twin) sI = Math.round(100 * sT * (0.5 + 0.5 * R())) / 100;
  else {
    const imps = Object.keys(BODIES).filter(k => k !== t && BODIES[k].mass <= Mt * 1.0001 && BODIES[k].mass >= Mt * 0.008);
    i = imps.length ? pick(imps) : t;
    sI = R() < 0.5 ? 1 : Math.round(100 * (0.7 + 0.6 * R())) / 100;
    sI = Math.min(sI, Mt / BODIES[i].mass);
  }
  const cT = composition(t, R() < 0.55 ? 'real' : pick(VARIANTS)), cI = composition(i, R() < 0.45 ? 'real' : pick(VARIANTS));
  const b = Math.min(0.97, Math.round(100 * Math.sqrt(R())) / 100);
  const vRel = R() < 0.125 ? Math.round(100 * (2.6 + 1.4 * R())) / 100 : Math.round(100 * (1 + 1.6 * R() * R())) / 100;
  const spin = () => {
    if (R() < 0.5) return null;
    const P = Math.round(10 * Math.exp(Math.log(3) + R() * Math.log(10))) / 10;
    return R() < 0.2 ? -P : P;
  };
  const wT = spin(), wI = spin();
  const d0 = Math.round(100 * (1.2 + 0.2 * R())) / 100;
  const theta = Math.asin(b) * 180 / Math.PI;
  const adjT = [], adjI = [];
  if (sT < 0.85) adjT.push('small'); else if (sT > 1.15) adjT.push('big');
  if (wT && Math.abs(wT) < 8) adjT.push(wT < 0 ? 'backward-spinning' : 'fast-spinning');
  if (cT) adjT.push(cT.word);
  if (sI < 0.85 && !twin) adjI.push('small'); else if (sI > 1.15) adjI.push('big');
  if (cI) adjI.push(cI.word);
  const ratio = BODIES[i].mass * sI / Mt;
  const body = (key, s, w, c) => Object.assign({ key, spinH: w }, s !== 1 ? { massScale: s } : {}, c ? { layers: c.layers } : {});
  return {
    key: 'random-' + seed, title: titleOf({ t, i, adjT, adjI, theta, vRel, twin }),
    sub: `random draw ${seed}: ${theta.toFixed(0)} degrees, ${vRel.toFixed(2)} v_esc, mass ratio ${ratio < 0.01 ? ratio.toFixed(3) : ratio.toFixed(2)}`,
    bodies: [body(t, sT, wT, cT), body(i, sI, wI, cI)],
    impact: { vRel, b, d0 }, fmin: ratio > 0.3 ? 0.3 : 0.12,
    src: 'hypothetical (random draw)', tags: b > 0.6 ? ['graze'] : ['splash'],
    draw: { t, i, sT, sI, cT: cT ? cT.word : 'as measured', cI: cI ? cI.word : 'as measured', b, theta, vRel, wT, wI, twin, ratio },
  };
}
