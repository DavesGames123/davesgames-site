// ============================================================================
//  ROCHE LIMIT  ·  roll.js — random runs and the named presets (no DOM)
// ----------------------------------------------------------------------------
//  rollRun(seed) builds a run spec from a seed: the same seed gives the
//  same run (the page puts it in the URL as ?seed=). PRESETS are named
//  runs from the same space, with some choices fixed. app/runs.js starts
//  the spec; tests.mjs checks that every roll is physically valid.
//
//  THE SPACE. A CHOICE picks, each with a seeded random draw:
//    planet    10 primaries (facts.js PRIMARIES): Saturn, Jupiter, Uranus,
//              Neptune, Earth, Mars, the hot Jupiter WASP-12b, a brown
//              dwarf, a white dwarf (Sirius B) and a neutron star
//    body      9 kinds (facts.js SMALL): icy, rocky, fluid moon, comet,
//              contact binary, binary asteroid, a moon with a core, a train
//              of fragments, two moons
//    material  rigid, fluid, loose, cohesive (physics.js MATERIALS)
//    spin      sync, prograde (fast), retrograde, tumbling
//    orbit     decay (a spiral, as the first scenarios), eccentric plunge,
//              flyby (parabolic, or a little hyperbolic), inclined decay,
//              retrograde (a backward spiral; for a binary: a capture on a
//              backward parabolic pass), grazing (the pericentre at the
//              surface: part of the body hits the planet)
//  plus the numbers: the body's density from its range, the mass ratio,
//  the separation, the start and end of the spiral, the pericentre, the
//  eccentricity, the tilt.
//
//  VALID RUNS. buildRoll keeps the fluid Roche limit at least 1.25 radii
//  of the primary (above the surface) by moving the density in its range,
//  or it draws again. A spiral starts 3-8% outside the fluid limit and ends
//  where its material breaks (D1_FRAC of the limit: the bound mass
//  sweep of app/env.js REF_SWEEP), but not under the surface. A pass has
//  its pericentre inside the limit and above the surface, except the
//  grazing pass and the capture. checkSpec() says what is wrong with a
//  spec, or null.
//
//  THE WORLD UNIT. The page draws in units of the planet radius. A white
//  dwarf has a density ratio q = rho_p / rho_s near 1e6, so its Roche limit
//  is about 240 of its radii, too far out to frame with the planet. Above
//  Q_REF the world unit is the radius of a ball with the primary's mass
//  and the density Q_REF rho_s: the tide, the orbit and the limit are the
//  same, and the primary draws with radius bodyR = (Q_REF / q)^(1/3) world
//  units. spec.q is then Q_REF. The readouts divide by bodyR, so they give
//  true radii; spec.Rkm is km per world unit.
//
//  THE MOON'S SIZE. s = R_s / R_p (world) = S_K q^(1/3), so M_s / M_p =
//  S_K^3 = 1e-3 for every primary (the planet does not move in the model).
//  The Roche limit does not depend on the moon's size.
//
//  grep -n targets: "export const Q_REF", "export const D1_FRAC",
//  "export function rollChoice", "export function buildRoll",
//  "export function rollRun", "export const PRESETS",
//  "export function presetSpec", "export function checkSpec",
//  "function titleOf", "function storyOf"
// ============================================================================
import { K_FLUID, K_RIGID, rng as mulberry } from './physics.js';
import { PRIMARIES, PRIMARY_KEYS, SMALL, SMALL_KEYS } from './facts.js';

export const Q_REF = 4;
export const S_K = 0.1;
export const ORBITS = ['decay', 'eccentric', 'flyby', 'inclined', 'retrograde', 'grazing'];
export const SPINS = ['sync', 'prograde', 'retrograde', 'tumbling'];
export const MATERIAL_KEYS = ['rigid', 'fluid', 'loose', 'cohesive'];
// the spiral ends at this share of the fluid limit: past the breakup of
// the material (app/env.js REF_SWEEP: fluid 0.92-0.95, rigid 0.70-0.75,
// cohesive 0.65-0.70 for a circular orbit after 3 orbits)
export const D1_FRAC = { fluid: 0.72, loose: 0.66, rigid: 0.6, cohesive: 0.55 };

// A seeded random function: the seed is mixed (murmur3 fmix32) first, so
// seeds 41 and 42 give unrelated runs, then physics.js rng (mulberry32).
// A plain LCG gave near copies for neighbour seeds (2026-10-11).
export function mixSeed(h) {
  h = (h ^ 0x9e3779b9) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
export function rng(seed) { return mulberry(mixSeed(seed >>> 0)); }
const lerp = (r, a, b) => a + (b - a) * r;
const pick = (rnd, a) => a[Math.min(a.length - 1, Math.floor(rnd() * a.length))];

// The materials and orbits that fit each kind of body.
const MATS = {
  icy: MATERIAL_KEYS, rocky: ['rigid', 'loose', 'cohesive', 'fluid'], fluid: ['fluid'], comet: ['loose', 'fluid', 'cohesive'],
  contact: ['rigid', 'loose', 'cohesive'], binary: ['rigid', 'loose', 'cohesive'], core: ['fluid', 'loose'], train: ['fluid', 'loose'], two: MATERIAL_KEYS,
};
const ORBS = { train: ['flyby', 'eccentric', 'grazing'], two: ['decay', 'inclined', 'retrograde'] };

// A random choice: planet, body, material, spin, orbit.
export function rollChoice(rnd) {
  const planet = pick(rnd, PRIMARY_KEYS), body = pick(rnd, SMALL_KEYS);
  let orbit = pick(rnd, ORBS[body] || ORBITS);
  if (orbit === 'grazing' && PRIMARIES[planet].compact) orbit = 'eccentric';
  return { planet, body, material: pick(rnd, MATS[body]), spin: pick(rnd, SPINS), orbit };
}

// The run spec of a choice ch, with the numbers drawn from rnd. Fixed
// numbers in ch win: rhoS, d, d1, peri (true radii), e, inc (deg), k
// (spin factor), layout fields, title, name.
export function buildRoll(ch, rnd) {
  const P = PRIMARIES[ch.planet], B = SMALL[ch.body];
  if (!P || !B) throw new Error('buildRoll: unknown planet or body');
  let orbit = ch.orbit;
  if (orbit === 'grazing' && P.compact) orbit = 'eccentric';
  const material = ch.material || (B.material || pick(rnd, MATS[ch.body]));
  // the density: in range, and the fluid limit at least 1.25 true radii
  // (1.6 for a pass, so the pericentre fits between the surface and it)
  let rhoS = ch.rhoS ?? lerp(rnd(), B.rho[0], B.rho[1]);
  const need = orbit === 'decay' || orbit === 'inclined' || (orbit === 'retrograde' && ch.body !== 'binary') ? 1.25 : 1.6;
  const rhoMax = P.rho / Math.pow(need / K_FLUID, 3);
  if (ch.rhoS === undefined && rhoS > rhoMax) rhoS = Math.max(B.rho[0], Math.min(rhoMax, B.rho[1]));
  const qTrue = P.rho / rhoS;
  const qSim = Math.min(qTrue, Q_REF), bodyR = Math.cbrt(qSim / qTrue);
  const Lf = K_FLUID * Math.cbrt(qSim), LfTrue = Lf / bodyR;
  const s = Math.max(0.06, Math.min(0.16, S_K * Math.cbrt(qSim)));
  const spec = {
    key: 'roll', roll: true, kind: 'spiral', s, style: P.style, cam: 'planet', q: qSim, qTrue, bodyR, material,
    J2: P.J2 || 0, flattening: P.flattening || 0, planetName: planetPhrase(ch.planet), radiiName: radiiOf(ch.planet), Rkm: P.R / bodyR, Rtrue: P.R,
    rhoS, rings: !!P.rings, color: 4, el: ch.el ?? lerp(rnd(), 0.16, 0.42), tint: B.tint, choice: Object.assign({}, ch, { orbit }),
    layout: layoutOf(ch, rnd), spin: spinOf(ch, rnd), planet: ch.planet, body: ch.body, orbitKind: orbit,
  };
  const surf = 1.12 * bodyR + 1.5 * s;      // the spiral never ends under the surface
  if (orbit === 'decay' || orbit === 'inclined' || (orbit === 'retrograde' && ch.body !== 'binary')) {
    spec.kind = 'spiral';
    // a binary starts where it is bound (initial.js: separation at most
    // 0.6 r_H): about twice the fluid limit; the Hill radius at the fluid
    // limit is only some 1.7 moon radii
    spec.d = ch.d ?? Lf * (ch.body === 'binary' ? lerp(rnd(), 1.9, 2.1) : lerp(rnd(), 1.03, 1.08));
    let f1 = D1_FRAC[material] * lerp(rnd(), 0.95, 1.05);
    if (ch.body === 'core') f1 = Math.max(f1, 0.78);
    spec.d1 = ch.d1 ?? Math.max(Lf * f1, surf);
    spec.orbits = material === 'fluid' ? 0.8 : 0.95;
    spec.speed = 6;
    if (orbit === 'inclined') spec.inc = (ch.inc ?? lerp(rnd(), 15, 60)) * Math.PI / 180;
    if (orbit === 'retrograde') spec.inc = (ch.inc ?? lerp(rnd(), 145, 175)) * Math.PI / 180;
  } else if (orbit === 'retrograde') {
    // a binary on a backward parabolic pass, outside the limit of each
    // body: the tide splits the pair at the pericentre (Agnor and
    // Hamilton 2006 for Triton). It starts at 3 pericentres, where the
    // pair is bound (initial.js caps the separation at 0.6 r_H there).
    spec.kind = 'flyby'; spec.e = ch.e ?? 1; spec.peri = (ch.peri !== undefined ? ch.peri * bodyR : Lf * lerp(rnd(), 1.1, 1.3));
    spec.r0 = 3 * spec.peri; spec.inc = (ch.inc ?? lerp(rnd(), 150, 170)) * Math.PI / 180; spec.speed = 3; spec.paceAtPeri = true; spec.capture = true;
    spec.layout.sep = 6;
  } else {
    spec.kind = 'flyby';
    if (orbit === 'eccentric') spec.e = ch.e ?? lerp(rnd(), 0.4, 0.85);
    else if (orbit === 'flyby') spec.e = ch.e ?? (rnd() < 0.7 ? 1 : lerp(rnd(), 1.02, 1.25));
    else spec.e = ch.e ?? lerp(rnd(), 0.6, 1);
    const hard = material === 'rigid' || material === 'cohesive';
    if (ch.peri !== undefined) spec.peri = ch.peri * bodyR;
    else if (orbit === 'grazing') spec.peri = bodyR * lerp(rnd(), 0.85, 1.05);
    else spec.peri = Math.max(1.3 * bodyR + s, Lf * (hard ? lerp(rnd(), 0.4, 0.6) : lerp(rnd(), 0.45, 0.75)));
    spec.speed = spec.e < 1 ? 4 : 3;
    spec.paceAtPeri = true;
    if (ch.body === 'binary') spec.r0 = 2.2 * Lf;
  }
  if (spec.layout.type === 'two' && spec.kind !== 'spiral') spec.layout.type = 'single';
  spec.ringExt = Math.max(3.6, 1.25 * (spec.kind === 'flyby' ? spec.peri + 1.5 : spec.d));
  // a tilted orbit puts its debris out of the plane of the ring layer
  if (spec.inc && Math.abs(Math.sin(spec.inc)) > 0.2) spec.noRingLayer = true;
  spec.LfTrue = LfTrue;
  spec.title = ch.title || titleOf(spec, ch, P, B);
  spec.name = ch.name || spec.title;
  spec.caption = captionOf(spec, P, B);
  spec.storyText = storyOf(spec, ch);
  spec.hint = ch.hint || `${spec.caption}. ${B.ex ? 'Real example: ' + B.ex + '.' : ''}`;
  return spec;
}

function layoutOf(ch, rnd) {
  const t = SMALL[ch.body].layout, L = Object.assign({ type: t }, ch.layout || {});
  if (t === 'contact') L.ratio ??= lerp(rnd(), 0.4, 1);
  if (t === 'binary') { L.ratio ??= lerp(rnd(), 0.2, 0.7); L.sep ??= lerp(rnd(), 2.2, 3.5); L.tilt ??= lerp(rnd(), 0, 0.6); }
  if (t === 'train') { L.k ??= 5 + Math.floor(rnd() * 5); L.gap ??= lerp(rnd(), 2.2, 3.2); L.w ??= Array.from({ length: L.k }, (_, i) => i === 0 ? 1.6 : lerp(rnd(), 0.5, 1.4)); }
  if (t === 'core') { L.frac ??= lerp(rnd(), 0.25, 0.35); L.factor ??= lerp(rnd(), 2.5, 3.5); }
  if (t === 'two') { L.ratio ??= lerp(rnd(), 0.5, 0.85); L.d2 ??= lerp(rnd(), 1.08, 1.16); L.phi ??= (rnd() < 0.5 ? -1 : 1) * lerp(rnd(), 0.35, 0.8); }
  return L;
}
function spinOf(ch, rnd) {
  const mode = ch.spin || 'sync';
  const k = ch.k ?? (mode === 'prograde' ? lerp(rnd(), 1.5, 2.4) : mode === 'retrograde' ? lerp(rnd(), 0.6, 1.5) : mode === 'tumbling' ? lerp(rnd(), 0.8, 2) : 1);
  return { mode, k };
}
function planetPhrase(k) {
  const P = PRIMARIES[k];
  if (k === 'hotjup') return 'WASP-12b';
  return P.name.startsWith('a ') ? 'the ' + P.name.slice(2) : P.name;
}
function radiiOf(k) { const P = PRIMARIES[k]; return (P.short || P.name).replace(/^the /, '') + ' radii'; }
const an = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;

// A short title for a roll, as a caption under a clip.
function titleOf(spec, ch, P, B) {
  const sp = spec.spin.mode, Pn = P.name;
  const adj = sp === 'tumbling' ? 'tumbling ' : sp === 'prograde' ? 'fast-spinning ' : sp === 'retrograde' ? 'backward-spinning ' : '';
  let subj;
  if (ch.body === 'two') subj = `Two ${adj}${spec.material === 'fluid' ? 'molten' : 'rubble'} moons`;
  else if (ch.body === 'train') subj = `A train of ${spec.layout.k} comet fragments`;
  else subj = an(adj + SMALL[ch.body].name);
  subj = subj.charAt(0).toUpperCase() + subj.slice(1);
  const pl = ch.body === 'two';
  const o = spec.orbitKind;
  if (o === 'retrograde' && spec.capture) return `A binary splits at ${Pn}: one half is caught on a backward orbit`;
  if (o === 'decay') return `${subj} ${pl ? 'spiral' : 'spirals'} into ${Pn}`;
  if (o === 'inclined') return `${subj} on a ${Math.round(spec.inc * 180 / Math.PI)}° tilted orbit ${pl ? 'fall' : 'falls'} into ${Pn}`;
  if (o === 'retrograde') return `${subj} ${pl ? 'circle' : 'circles'} ${Pn} backwards and ${pl ? 'fall' : 'falls'} in`;
  if (o === 'eccentric') return `${subj} ${pl ? 'plunge' : 'plunges'} past ${Pn}`;
  if (o === 'grazing') return `${subj} ${pl ? 'skim' : 'skims'} ${Pn}`;
  return `${subj} ${pl ? 'swing' : 'swings'} past ${Pn}`;
}
function captionOf(spec, P, B) {
  const r = spec.radiiName, u = spec.bodyR;
  const where = spec.kind === 'flyby' ? `closest pass ${(spec.peri / u).toFixed(2)} ${r}` : `from ${(spec.d / u).toFixed(2)} to ${(spec.d1 / u).toFixed(2)} ${r}`;
  return `${P.short || P.name.replace(/^a /, '')}: ρ ${P.rho < 100 ? P.rho.toFixed(2) : P.rho.toExponential(1)} g/cm³ · ${B.name}, ρ ${spec.rhoS.toFixed(2)} g/cm³, ${spec.material} · Roche limit ${spec.LfTrue < 100 ? spec.LfTrue.toFixed(2) : spec.LfTrue.toFixed(0)} ${r} · ${where}`;
}
// Story lines by layout: { approach, cross, torn, ring } ({P}: the planet).
function storyOf(spec, ch) {
  const t = spec.layout.type, o = {};
  if (t === 'two') { o.approach = 'Two moons spiral toward {P}, one inside the other.'; o.torn = 'The inner moon is torn apart first.'; o.ring = 'Both moons end as streams of rubble round {P}.'; }
  if (t === 'contact') { o.approach = 'A two-lobed body falls toward {P}.'; o.torn = 'The tide pulls the two lobes apart at the neck, then tears them.'; }
  if (t === 'binary') {
    o.approach = 'A binary pair falls toward {P}.';
    o.torn = spec.capture ? 'At the closest pass the tide splits the pair.' : 'The tide pulls the pair apart.';
    o.ring = spec.capture ? 'One body can stay on a backward orbit round {P}; the other can escape.' : undefined;
  }
  if (t === 'core') { o.approach = 'A moon with a dense rocky core spirals toward {P}.'; o.torn = 'The light mantle is stripped first; the dense core holds on longer.'; o.ring = 'The mantle spreads into a ring; the core can stay whole, deeper in.'; }
  if (t === 'train') { o.approach = 'A train of fragments falls toward {P}.'; o.torn = 'The fragments stretch into streams of rubble.'; }
  if (spec.orbitKind === 'grazing') o.ring = 'Debris rains onto {P}: each grain that hits flashes on the surface.';
  if (spec.spin.mode === 'tumbling' && !o.approach) o.approach = 'A tumbling body falls toward {P}.';
  if (spec.spin.mode === 'retrograde' && !o.approach) o.approach = 'A body that spins backwards falls toward {P}.';
  return o;
}

// A random run. seed: an integer (the URL value).
export function rollRun(seed) {
  const rnd = rng(seed);
  const ch = rollChoice(rnd);
  const spec = buildRoll(ch, rnd);
  spec.seed = seed >>> 0;
  return spec;
}

// ── the named presets ─────────────────────────────────────────────────────
// Numbers: rhoS in g/cm^3, peri in true radii of the primary, inc in deg.
export const PRESETS = [
  { key: 'sl9', name: 'Shoemaker-Levy 9 hits Jupiter', planet: 'jupiter', body: 'train', material: 'fluid', spin: 'tumbling', k: 0.6, orbit: 'grazing', rhoS: 0.5, peri: 0.88, e: 0.98, layout: { k: 9 },
    title: 'A train of comet fragments hits Jupiter, as Shoemaker-Levy 9 did in 1994',
    hint: 'In July 1992 Jupiter’s tide broke comet Shoemaker-Levy 9 into some 21 pieces. Two years later the train came back on an orbit that hit the planet. Here 9 rubble fragments (0.5 g/cm³, Asphaug and Benz 1996) fall in one after the other; each grain that hits flashes. The real train was millions of km long; this one is short, to fit the view.' },
  { key: 'phobos30', name: 'Phobos in 30 million years', planet: 'mars', body: 'rocky', material: 'loose', spin: 'sync', orbit: 'decay', rhoS: 1.876,
    title: 'Phobos, some 30 million years from now',
    hint: 'Tides bring Phobos about 2 m closer to Mars each century. In some 20 to 50 million years (Efroimsky and Lainey 2007; Black and Mittal 2015) it reaches its Roche limit. A rubble Phobos (1.876 g/cm³) with loose grains breaks into a ring here; the drag is millions of times faster than the real tide.' },
  { key: 'wd', name: 'A rubble pile at a white dwarf', planet: 'wdwarf', body: 'rocky', material: 'loose', spin: 'tumbling', k: 1, orbit: 'eccentric', rhoS: 2.0, e: 0.85,
    title: 'An asteroid falls toward a white dwarf and is torn into a stream',
    hint: 'Many white dwarfs show rock in their atmospheres: asteroids that came too close and were torn apart (WD 1145+017 has a disintegrating one in transit). Sirius B (1.018 solar masses, 0.0086 solar radii, Bond et al. 2017) has a density near 2 million g/cm³; its Roche limit for rock (2 g/cm³) is about 1.5 million km, some 250 times its radius. The white dwarf lights the scene.' },
  { key: 'twomoons', name: 'Two moons cross the limit', planet: 'uranus', body: 'two', material: 'fluid', spin: 'sync', orbit: 'decay', rhoS: 1.0, layout: { ratio: 0.7, d2: 1.12, phi: -0.6 },
    title: 'Two icy moons spiral into Uranus and cross the Roche limit',
    hint: 'Two loose icy moons (1.0 g/cm³) spiral in, the second on a wider orbit. Each one breaks where its own limit is: the inner one first. The two feel each other’s gravity too.' },
  { key: 'triton', name: 'A retrograde capture like Triton', planet: 'neptune', body: 'binary', material: 'rigid', spin: 'sync', orbit: 'retrograde', rhoS: 2.061, inc: 157, layout: { ratio: 0.6 },
    title: 'A binary splits at Neptune: one half is caught on a backward orbit, like Triton',
    hint: 'Triton orbits Neptune backwards, at 157° to its equator. Agnor and Hamilton (2006) showed how it could be caught: a binary passed close to Neptune, the tide split it, one body stayed and the other flew off. On a parabolic pass, one half ends bound and one unbound. Triton: 2.061 g/cm³ (NASA).' },
  { key: 'twolobes', name: 'A two-lobed comet at Saturn', planet: 'saturn', body: 'contact', material: 'loose', spin: 'sync', orbit: 'flyby', rhoS: 0.533, e: 1, peri: 1.25, layout: { ratio: 0.7 },
    title: 'A two-lobed comet like 67P swings past Saturn and comes apart',
    hint: 'Comet 67P is two lobes joined at a neck (0.533 g/cm³, Pätzold et al. 2016). On a close pass the tide first pulls at the neck. Here the pass is at 1.25 Saturn radii, inside the fluid limit for this density (2.6).' },
  { key: 'didymos', name: 'A binary asteroid grazes Earth', planet: 'earth', body: 'binary', material: 'rigid', spin: 'sync', orbit: 'flyby', rhoS: 2.4, e: 1, peri: 1.7, layout: { ratio: 0.4, sep: 2.6, tilt: 0.3 },
    title: 'A Didymos-like binary asteroid passes 4,500 km above Earth',
    hint: 'Didymos and its moon Dimorphos (about 2.4 g/cm³) are a rubble pile with a moonlet. A pass at 1.7 Earth radii (4,500 km above the surface) is inside the fluid limit (3.2 Earth radii): the pair splits and both bodies stretch. Dimorphos is drawn larger than it is, to show the grains.' },
  { key: 'mantle', name: 'A moon loses its mantle', planet: 'jupiter', body: 'core', material: 'fluid', spin: 'sync', orbit: 'decay', rhoS: 1.94, layout: { frac: 0.3, factor: 3 },
    title: 'A Ganymede-like moon spirals into Jupiter: the ice is stripped, the core holds',
    hint: 'Ganymede is ice over rock (1.94 g/cm³). The denser the material, the closer its Roche limit, so the icy mantle comes off first, and the rocky core lasts longer. The core grains here have 3 times the density of the mantle grains.' },
  { key: 'tumbler', name: 'A tumbling comet at Jupiter', planet: 'jupiter', body: 'comet', material: 'loose', spin: 'tumbling', k: 1.8, orbit: 'flyby', rhoS: 0.5, e: 1, peri: 1.5,
    title: 'A tumbling comet swings past Jupiter and breaks into a string of clumps',
    hint: 'Comet nuclei often tumble about no fixed axis. Spin adds to the tide on one side, so a tumbling comet sheds unevenly. Pass at 1.5 Jupiter radii; fluid limit 3.4.' },
  { key: 'neutron', name: 'A neutron star shreds an asteroid', planet: 'nstar', body: 'rocky', material: 'rigid', spin: 'sync', orbit: 'eccentric', rhoS: 2.0, e: 0.7,
    title: 'An asteroid plunges past a neutron star and is shredded',
    hint: 'A neutron star of 1.44 solar masses and 13 km radius (PSR J0030+0451, Miller et al. 2019) has a density near 3×10¹⁴ g/cm³. Its Roche limit for rock (2 g/cm³) is about 1.7 million km: tides act far from the star. There G M / (c² r) is a few parts in a million, so Newton’s tide is enough.' },
  { key: 'browndwarf', name: 'A molten moon at a brown dwarf', planet: 'bdwarf', body: 'fluid', material: 'fluid', spin: 'sync', orbit: 'decay', rhoS: 3.0,
    title: 'A molten moon spirals into a brown dwarf',
    hint: 'A brown dwarf of 60 Jupiter masses packed into 0.8 Jupiter radii has a density near 150 g/cm³. A molten rocky moon (3.0 g/cm³) breaks at about 9 of its radii.' },
  { key: 'hotjup', name: 'The last moon of a hot Jupiter', planet: 'hotjup', body: 'icy', material: 'fluid', spin: 'sync', orbit: 'decay', rhoS: 0.6,
    title: 'The last icy moon of the hot Jupiter WASP-12b spirals in',
    hint: 'WASP-12b (1.47 Jupiter masses, 1.90 Jupiter radii, Collins et al. 2017) is a puffed-up gas giant close to its star, with a density near 0.27 g/cm³. Only a very light moon has its Roche limit outside such a planet.' },
  { key: 'spinner', name: 'A fast-spinning moon at Saturn', planet: 'saturn', body: 'icy', material: 'fluid', spin: 'prograde', k: 2.2, orbit: 'decay', rhoS: 0.9,
    title: 'A fast-spinning icy moon spirals into Saturn',
    hint: 'A moon that spins faster than it orbits gets a centrifugal push on top of the tide, so it sheds sooner. Here it spins 2.2 times per orbit.' },
  { key: 'tilted', name: 'A moon on a tilted orbit at Earth', planet: 'earth', body: 'icy', material: 'fluid', spin: 'sync', orbit: 'inclined', rhoS: 1.0, inc: 35,
    title: 'An icy moon on a 35° tilted orbit falls into Earth',
    hint: 'A tilted orbit round an oblate planet turns slowly (the J2 term). The debris stream leaves the equator plane; the page does not draw a ring layer for it.' },
  { key: 'skim', name: 'A comet skims Saturn', planet: 'saturn', body: 'comet', material: 'fluid', spin: 'sync', orbit: 'grazing', rhoS: 0.5, peri: 0.95, e: 0.9,
    title: 'A comet skims Saturn: part of it hits the cloud tops',
    hint: 'A pericentre just under the cloud tops: the side of the comet nearest Saturn hits the planet, and each grain flashes as it hits. The rest is torn into a stream.' },
];

// The spec of a preset (the same every time: its own fixed seed).
export function presetSpec(key) {
  const i = PRESETS.findIndex(p => p.key === key);
  if (i < 0) return null;
  const p = PRESETS[i];
  const spec = buildRoll(p, rng(9001 + 17 * i));
  spec.preset = p.key; spec.name = p.name;
  return spec;
}

// What is wrong with a spec (a string), or null.
export function checkSpec(sp) {
  const nums = ['q', 's', 'bodyR', 'rhoS', 'Rkm', 'speed', 'el'];
  for (const k of nums) if (!Number.isFinite(sp[k])) return `${k} is not a number`;
  const Lf = K_FLUID * Math.cbrt(sp.q), Lr = K_RIGID * Math.cbrt(sp.q), R = sp.bodyR;
  if (sp.q > Q_REF + 1e-9) return 'q above Q_REF';
  if (!(sp.s > 0 && sp.s < 0.2)) return 's out of range';
  if (sp.orbitKind !== 'grazing' && Lf / R < 1.2) return `fluid limit ${(Lf / R).toFixed(2)} radii, under 1.2`;
  if (sp.kind === 'spiral') {
    if (!(sp.d > Lf && sp.d < (sp.layout && sp.layout.type === 'binary' ? 2.2 : 1.1) * Lf)) return `spiral start ${(sp.d / Lf).toFixed(3)} d_fluid`;
    if (!(sp.d1 < Lf && sp.d1 > R)) return `spiral end ${(sp.d1 / Lf).toFixed(3)} d_fluid, ${(sp.d1 / R).toFixed(2)} radii`;
  } else if (sp.kind === 'flyby') {
    if (!(sp.e > 0 && sp.e < 1.5)) return `eccentricity ${sp.e}`;
    if (sp.capture) { if (!(sp.peri > Lf && sp.peri < 1.4 * Lf)) return 'capture pericentre not just outside the limit'; }
    else if (sp.orbitKind === 'grazing') { if (!(sp.peri < 1.1 * R && sp.peri > 0.8 * R)) return 'grazing pericentre not at the surface'; }
    else if (!(sp.peri < Lf && sp.peri > R)) return `pericentre ${(sp.peri / Lf).toFixed(3)} d_fluid, ${(sp.peri / R).toFixed(2)} radii`;
    if (sp.e < 1) { const apo = sp.peri * (1 + sp.e) / (1 - sp.e); if (apo < 1.05 * sp.peri) return 'apocentre too close'; }
  } else return `kind ${sp.kind}`;
  if (!sp.title || sp.title.length > 110) return 'title missing or too long';
  if (!(Lr < Lf)) return 'limits out of order';
  return null;
}
