// ============================================================================
//  ROCHE LIMIT  ·  saver-plan.js — the shot plan and the reel (no DOM)
// ----------------------------------------------------------------------------
//  app/cuts.js plays the shot plan (screensaver and the Director view);
//  app/saver.js plays the reel; tests.mjs checks both.
//
//  THE REEL. A BAG is a seeded shuffle of takes: the six first stories,
//  the presets of roll.js and as many fresh random rolls (roll: true). A
//  random roll gets its seed from the saver's own seeded random function,
//  and rollFor() draws again until checkSpec() passes, the body differs
//  from the take before, and the planet differs from the last RECENT
//  takes. nextTake skips a bag entry whose planet is one of the last
//  RECENT, when a later entry can play. The same take never plays twice
//  in a row. A new bag starts when one runs out.
//
//  THE EVENTS. A take is one run. Its story moves through four PHASES,
//  read from the run (app/cuts.js "function eventsNow"):
//    approach  before the slow motion starts
//    crack     the slow motion is on (pacing.js: the moon stretches, the
//              first grains go, or a pass reaches its pericentre)
//    torn      under 75% of the moon is still in one piece (app/story.js)
//    ring      the debris has had time for a first lap round the planet
//  and one more event, IMPACT: the first grain hits the planet.
//
//  THE SHOTS. Each SHOTS entry is a kind of shot, with the phases where
//  it can play. scope names the subject that the shot frames (shot-geom.js
//  "THE SUBJECT"): orbit, moon, tide, cluster, stream, ring or impact.
//  fill is the part of the clear band that the subject fills in its tight
//  direction (0.42 to 0.68: no extreme close-up, and room for the
//  subject to grow before followGoal catches up). elW and elT are the
//  elevations for a wide band (16:9) and a tall band (the 9:16 column).
//  dAz turns a subject with no axis from the reel's view azimuth. drift
//  turns the view slowly (deg/s), dolly changes the fill over the shot
//  (at most 10%). warp multiplies the sim speed (a time-lapse); opm caps
//  it in orbits per wall minute (a calm shot of a moving subject). needs:
//  a trait of the run that the shot needs.
//  Before 2026-10-13 the shots were offsets of the story camera with
//  push-ins of up to 55%, a view from the planet's surface and a ride with
//  one grain. The user found them "too close up, aggressive", made for a
//  wide frame, and "much of the time the camera focuses on nothing".
//  THE CUTS. A shot lasts CUT_MIN to CUT_MAX s. It ends at its own
//  seeded length, or earlier (but not before CUT_MIN) when the story
//  reaches a new phase or the first impact: the cut goes to a shot of the
//  new phase. pickShot never plays the same kind twice in a row, and in
//  one take it plays a kind again only when the phase has no other. The
//  take ends after two ring shots, after TAKE_MAX s, or after STALL s in
//  the approach (a weak roll). A take that loops (the Director view on
//  the page) never ends.
//
//  grep -n targets: "export const RUNS", "export const SHOTS",
//  "export function pickShot", "export function shotDone",
//  "export function newTake", "export function takeStep",
//  "export function makeBag", "export function rollFor",
//  "export function nextTake"
// ============================================================================
import { BODIES } from './physics.js';
import { PRESETS, rollRun, checkSpec } from './roll.js';
import { PRIMARIES } from './facts.js';

const B = BODIES;
export const CUT_MIN = 5, CUT_MAX = 12;
export const TAKE_MAX = 50, STALL = 22;
export const PHASES = ['approach', 'crack', 'torn', 'ring'];

// The first stories. spec: overrides of the scenario's run spec
// (scenarios.js specFor). Each spiral starts 4% outside its fluid limit
// and drifts to 0.72 of it. planet: for the reel's planet rule.
export const RUNS = [
  { key: 'saturn', scen: 'saturn', planet: 'saturn', title: 'An icy moon becomes Saturn’s rings', spec: {} },
  { key: 'phobos', scen: 'close', planet: 'mars', title: 'Phobos, 20 to 50 million years from now',
    spec: { q: B.mars.rho / B.phobos.rho, d: 3.25, d1: 2.25, orbits: 0.8, style: 3, planetName: 'Mars', Rkm: B.mars.R, rhoS: B.phobos.rho, J2: B.mars.J2, flattening: 0.006 } },
  { key: 'earth', scen: 'close', planet: 'earth', title: 'If the Moon came too close to Earth',
    spec: { q: B.earth.rho / B.moon.rho, d: 3.0, d1: 2.1, orbits: 0.8, style: 4, planetName: 'Earth', Rkm: B.earth.R, rhoS: B.moon.rho, J2: B.earth.J2, flattening: 0.0034 } },
  { key: 'ice', scen: 'close', planet: 'icegiant', title: 'A loose moon as dense as its ice giant', spec: {} },
  { key: 'comet', scen: 'flyby', planet: 'jupiter', title: 'A comet torn into a string of pearls', spec: {} },
  { key: 'compare', scen: 'compare', planet: 'icegiant', title: 'A loose moon and a rough moon on one orbit', spec: {} },
];
// Fresh random rolls in one bag (as many as there are presets).
export const ROLL_SLOTS = PRESETS.length;
// takes in a row with no planet in common, where the bag allows it
export const RECENT = 3;

export const SHOTS = {
  wide:    { phases: ['approach'], min: 5, max: 9, scope: 'orbit', fill: 0.66, elW: 0.30, elT: 0.95, dAz: 0, drift: 1.0, dolly: 0.06 },
  top:     { phases: ['approach', 'ring'], min: 5, max: 8, scope: 'orbit', fill: 0.64, elW: 0.95, elT: 1.20, dAz: 0.25, drift: 1.0, dolly: 0.05 },
  close:   { phases: ['crack'], min: 6, max: 10, scope: 'moon', fill: 0.42, elW: 0.22, elT: 0.85, drift: 0.8, dolly: 0.08, opm: 1.2 },
  tide:    { phases: ['crack'], min: 5, max: 9, scope: 'tide', fill: 0.62, elW: 0.30, elT: 0.95, drift: 0.8, dolly: 0.05, opm: 1.5 },
  cluster: { phases: ['torn'], min: 5, max: 8, scope: 'cluster', fill: 0.50, elW: 0.75, elT: 1.00, drift: 0.8, dolly: 0.05, opm: 2 },
  stream:  { phases: ['torn'], min: 5, max: 9, scope: 'stream', fill: 0.64, elW: 0.35, elT: 1.00, dAz: 0.4, drift: 1.2, dolly: 0.05, opm: 4 },
  ring:    { phases: ['ring'], min: 6, max: 12, scope: 'ring', fill: 0.66, elW: 0.55, elT: 1.05, dAz: 0.4, drift: 1.5, dolly: 0.06 },
  skim:    { phases: ['ring'], min: 5, max: 9, scope: 'ring', fill: 0.66, elW: 0.14, elT: 0.60, dAz: -0.75, drift: 1.0, dolly: 0.04 },
  lapse:   { phases: ['ring'], min: 6, max: 11, scope: 'ring', fill: 0.68, elW: 0.80, elT: 1.20, dAz: 0.3, drift: 1.0, dolly: -0.08, warp: 1.6 },
  impact:  { phases: [], min: 5, max: 8, needs: 'surface', scope: 'impact', fill: 0.55, drift: 0.6, dolly: 0.05, opm: 2 },
};
export const KINDS = Object.keys(SHOTS);

// physics.js rng is mulberry32; this one is the old LCG of the reel, kept
// so a saver seed gives the same order as before for the stories
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// What a run allows. surface: a planet big enough to stand on (not a
// white dwarf or a neutron star).
export function traitsOf(spec) {
  const P = spec && spec.planet ? PRIMARIES[spec.planet] : null;
  return { surface: !(P && P.compact) && !(spec && (spec.style === 9 || spec.style === 10)) };
}

// A shot of the phase: a kind not played just before, and one not yet
// played in this take when the phase has one. rnd: the take's random.
export function pickShot(rnd, phase, prev = null, used = new Set(), traits = { surface: true }) {
  const ok = k => (!SHOTS[k].needs || traits[SHOTS[k].needs]);
  let c = phase === 'impact' ? ['impact'].filter(ok) : KINDS.filter(k => SHOTS[k].phases.includes(phase) && ok(k));
  if (!c.length) c = ['wide'];
  const fresh = c.filter(k => k !== prev && !used.has(k)), notPrev = c.filter(k => k !== prev);
  const pool = fresh.length ? fresh : notPrev.length ? notPrev : c;
  const kind = pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
  const S = SHOTS[kind];
  return Object.assign({ kind, phase: phase === 'impact' ? 'impact' : phase, len: S.min + (S.max - S.min) * rnd(), side: rnd() < 0.5 ? -1 : 1 }, S);
}

// Is the shot over? el: seconds in it. ev: { phase (the story's phase
// now), impactNew (the first impact, not shown yet) }.
export function shotDone(sh, el, ev) {
  if (el >= CUT_MAX) return true;
  if (el < CUT_MIN) return false;
  const ph = sh.phase === 'impact' ? sh.from : sh.phase;
  if (ev.phase && PHASES.indexOf(ev.phase) > PHASES.indexOf(ph)) return true;
  if (ev.impactNew && sh.kind !== 'impact') return true;
  return el >= sh.len;
}

// A take: the shot clock of one run. loop: never end (the Director view).
export function newTake(rnd, traits, loop = false) {
  return { rnd, traits, loop, t: 0, el: 0, shot: null, prev: null, used: new Set(), ringShots: 0, impactShown: false, shots: [], done: false };
}
function takeOver(tk, ev) {
  if (tk.loop) return false;
  return tk.ringShots >= 2 || tk.t >= TAKE_MAX || (ev.phase === 'approach' && tk.t >= STALL);
}
function startShot(tk, sh) {
  tk.shot = sh; tk.el = 0; tk.prev = sh.kind; tk.used.add(sh.kind); tk.shots.push(sh);
  if (sh.kind === 'impact') tk.impactShown = true;
}
// Advance the take by dt s with the events ev. Returns 'cut' when a new
// shot starts, 'end' when the take is over, else null.
export function takeStep(tk, dt, ev) {
  if (tk.done) return 'end';
  if (!tk.shot) { startShot(tk, pickShot(tk.rnd, ev.phase || 'approach', null, tk.used, tk.traits)); return 'cut'; }
  tk.t += dt; tk.el += dt;
  const impactNew = !!ev.impact && !tk.impactShown && !!tk.traits.surface;
  if (!shotDone(tk.shot, tk.el, { phase: ev.phase, impactNew })) return null;
  if (tk.shot.phase === 'ring') tk.ringShots++;
  if (takeOver(tk, ev)) { tk.done = true; return 'end'; }
  // a looping take in the ring phase may play its kinds again
  if (tk.loop && ev.phase === 'ring' && tk.ringShots % 3 === 0) tk.used.clear();
  const sh = pickShot(tk.rnd, impactNew ? 'impact' : ev.phase, tk.prev, tk.used, tk.traits);
  sh.from = ev.phase;   // an impact shot cuts when the story moves on from here
  startShot(tk, sh);
  return 'cut';
}

// ── the reel ──────────────────────────────────────────────────────────────
// A seeded order of the stories, the presets and ROLL_SLOTS fresh rolls.
// nextTake skips over an entry that clashes with the take before.
export function makeBag(rnd, last = null) {
  const a = [
    ...RUNS.map(r => Object.assign({ kind: 'story' }, r)),
    ...PRESETS.map(p => ({ kind: 'preset', key: p.key, preset: p.key, planet: p.planet, body: p.body })),
    ...Array.from({ length: ROLL_SLOTS }, (_, i) => ({ kind: 'roll', key: 'roll-' + i, roll: true, planet: null })),
  ];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// last: { key, planet, body, recent: [planets of the last RECENT takes] }
function clash(x, last) { return x.key === last.key || (!!x.planet && (last.recent || [last.planet]).includes(x.planet)); }

// A fresh valid random roll whose planet and body differ from last's.
export function rollFor(rnd, last = null, tries = 40) {
  let spec = null;
  for (let i = 0; i < tries; i++) {
    spec = rollRun(1 + Math.floor(rnd() * 999999));
    if (checkSpec(spec)) continue;
    if (last && ((last.recent || [last.planet]).includes(spec.planet) || spec.body === last.body)) continue;
    return spec;
  }
  return spec;
}

// The next take of the reel state rs = { rnd, bag, last }. Returns the
// bag entry; a roll entry gets its spec (entry.spec) here. Updates last.
export function nextTake(rs) {
  if (!rs.bag || !rs.bag.length) rs.bag = makeBag(rs.rnd, rs.last);
  // the first entry that does not clash with the take before (a roll
  // never does: rollFor draws another planet), else the first
  let i = rs.last ? rs.bag.findIndex(x => !clash(x, rs.last)) : 0;
  if (i < 0) i = 0;
  let e = rs.bag.splice(i, 1)[0];
  if (e.roll) {
    const spec = rollFor(rs.rnd, rs.last);
    e = Object.assign({}, e, { spec, planet: spec.planet, body: spec.body, seed: spec.seed });
  }
  const recent = [e.planet, ...(rs.last && rs.last.recent ? rs.last.recent : [])].filter(Boolean).slice(0, RECENT);
  rs.last = { key: e.key, planet: e.planet, body: e.body || null, recent };
  return e;
}
