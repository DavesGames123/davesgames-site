// ============================================================================
//  OUTBREAK  ·  director.js — the shot director of the Auto mode (no DOM)
// ----------------------------------------------------------------------------
//  The screensaver (saver.js, in the shell) and the on-page Auto button
//  use the same director. The director selects a disease, a seed city and
//  a public-health response for each run. Then it cuts the run into shots
//  of SHOT_S (8-12 s) of wall time. Each shot has one clear subject, a
//  kind, a style, a camera state (camera.js) and a simulation speed in
//  days per second. The motion is calm: a shot turns or drifts at most
//  CALM_DEG_S degrees per second, and the style holds for the full run.
//
//  createDirector({ seed, calm = 0.7, styles, D, texFor, rules }) -> Director
//    seed     uint32. The director stream is makeRng(seed ^ 0x9e3779b9),
//             so the director never touches the model stream.
//    calm     0..1. A higher calm gives longer shots and slower time.
//    styles   style ids, or globe.styles ([{ id, label }]).
//    D        the parsed nodes (data.js). newRun needs D for a seed node.
//    texFor   equations.js texFor (optional). Without it the plate uses
//             the SEIR equations in FALLBACK_TEX.
//    rules    equations.js RULES (optional), passed through to the plate.
//
//  Director = {
//    newRun() -> { diseaseId, seedNode, policies, startDayOfYear, style, scenario }
//    tick(now, view) -> { shot, changed, restart }   now in seconds
//    plate(view, disease) -> { title, sub, params, lines, tex, rules }
//    force(kind)   the next tick starts a shot of this kind (snSaver.cut)
//    state()       a plain copy of the director state (snSaver.debug)
//  }
//  view = { day, burnedOut, totals, reff, hottest, newestFirst, topRegion,
//           active, D, and from main.js (stats.js): sim, growth, exporter,
//           tipped, curve, hud, regionStats }   the stats are optional
//  shot = { kind, dur, style, cam, camEnd, follow, simSpeed, title, spin,
//           drift, hud, subject }
//    camEnd  { alt, tilt } or null: main.js eases to it over the shot
//            (a push in or a pull back)
//    follow  { kind: 'node' | 'event' | 'front', id } or null; 'front'
//            flies on to each new city the infection reaches
//    hud     'curve' or null: the saver HUD draws the curve large
//    subject the node or region the plate sub line names, live
//    spin    degrees of heading per second, |spin| <= CALM_DEG_S
//    drift   degrees of longitude per second, |drift| <= CALM_DEG_S
//
//  The shots, from the real sim state:
//    origin   the cold open: tight on the seed city at day 0, slow time,
//             a slow pull out
//    front    the infection reaches a new region (the newest city reached
//             in a region not reached at the cut before, and the city
//             that seeded it); the camera follows the front
//    surge    push in on the fastest-growing city (stats growth: the
//             doubling time over the last 3 days)
//    export   high over the hub with the most infected flights out in
//             the last 10 days
//    tipping  a continent tips over (half its cities reached, or 1e-3
//             infected): start on it, pull back to the whole globe
//    curve    the peak of daily new cases has passed, or R_eff fell
//             below 1: wide, with the curve large on the HUD
//    erupt, network, region, flat, policy, aftermath as before
//
//  Rules of the cut:
//    - The first shot of a run is 'origin' (the seed city).
//    - A burned-out view, or a run longer than maxShots, gives the
//      'aftermath' shot. When the aftermath shot ends, tick returns
//      restart = true until the caller calls newRun().
//    - Events cut: once a shot has run SHOT_S[0] (8 s), a waiting event
//      (a new policy, a tipped region, a new region, the curve moment)
//      cuts at once; else the shot runs to its end (at most 12 s). So
//      the cuts land on events.
//    - Otherwise the kind comes from a seeded weighted choice over the
//      kinds the state allows. The same kind never comes two times in a
//      row (except 'aftermath', which holds).
//    - Two runs in a row never have the same disease (seeded bag).
//    - restartClock(now): saver.js calls it when a faded cut comes on
//      screen, so the shot runs its full length from there.
//  Same seed and same view sequence give the same shots.
//
//  The plate is the shell label plate (lib/screensaver.js): text, TeX and
//  parameters. The sub line names what the shot shows with live numbers
//  (for example "Lagos · cases doubling every 3.1 days"), and the lines
//  carry day, infected now, cases today, cases, deaths, cities and
//  countries reached. It never has a `code` field (the user does not want code
//  on non-shader plates, see memory saver-no-code-pages).
//
//  grep -n targets: "export const SHOT_KINDS", "export const DISEASE_IDS",
//    "const ROUTE", "const REGION_VIEW", "export function createDirector",
//    "function newRun", "function pending", "function newRegion",
//    "function chooseKind", "function makeShot", "function subLine",
//    "function tick", "function plate", "const SCENARIOS", "FALLBACK_TEX"
// ============================================================================
import { makeRng } from './rng.js';
import { POLICY_DEFS, defaultPolicies } from './policies.js';
import { fmtDays } from './stats.js';

export const SHOT_KINDS = ['origin', 'front', 'surge', 'export', 'tipping', 'curve', 'erupt', 'network', 'region', 'flat', 'policy', 'aftermath'];
export const EVENT_KINDS = ['policy', 'tipping', 'front', 'curve'];   // kinds that cut a shot early (after SHOT_S[0])
export const SHOT_S = [8, 12];       // s, the length of every shot
export const CALM_DEG_S = 1.5;       // deg/s, the largest spin or drift of a shot

// The preset ids are fixed by CONTRACT.md (diseases.js). The route of each
// preset is also fixed there; the director uses it to select a plausible
// seed city and a response.
export const DISEASE_IDS = ['flu-seasonal', 'flu-1918', 'measles', 'covid-ancestral', 'covid-variant',
  'sars', 'ebola', 'cholera', 'dengue', 'malaria', 'plague'];
const ROUTE = {
  'flu-seasonal': 'resp', 'flu-1918': 'resp', measles: 'resp', 'covid-ancestral': 'resp',
  'covid-variant': 'resp', sars: 'resp', ebola: 'contact', cholera: 'water', dengue: 'vector',
  malaria: 'vector', plague: 'flea',
};

// A look point for each World Bank region (index as in data/nodes.json).
const REGION_VIEW = [
  { lat: 22, lon: 118, alt: 1.5 },  // East Asia and Pacific
  { lat: 50, lon: 30, alt: 1.6 },   // Europe and Central Asia
  { lat: -8, lon: -65, alt: 1.5 },  // Latin America and Caribbean
  { lat: 27, lon: 25, alt: 1.3 },   // Middle East and North Africa
  { lat: 42, lon: -97, alt: 1.3 },  // North America
  { lat: 22, lon: 79, alt: 1.0 },   // South Asia
  { lat: 2, lon: 22, alt: 1.3 },    // Sub-Saharan Africa
];

// Simulation speed of each kind, days per second at calm 0.5.
const SPEED = { origin: 1.2, front: 3, surge: 3, export: 2.5, tipping: 6, curve: 9, erupt: 4, network: 8, region: 6, flat: 10, policy: 4, aftermath: 3 };

const FALLBACK_TEX = [
  '\\dot S = -\\beta \\frac{S I}{N}, \\quad \\dot E = \\beta \\frac{S I}{N} - \\sigma E, \\quad \\dot I = \\sigma E - \\gamma I',
  'R_{\\mathrm{eff}} = R_0 \\, m_{\\mathrm{policy}} \\, \\frac{S}{N}',
];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const RAD = Math.PI / 180;
const wrapLon = lon => ((lon + 540) % 360) - 180;

// Great-circle midpoint and angle (radians) of two { lat, lon }.
function midpoint(a, b) {
  const v = p => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.sin(p.lat * RAD), -Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD)];
  const p = v(a), q = v(b), m = [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
  const n = Math.hypot(m[0], m[1], m[2]) || 1;
  const ang = Math.acos(clamp(p[0] * q[0] + p[1] * q[1] + p[2] * q[2], -1, 1));
  if (n < 1e-6) return { lat: a.lat, lon: a.lon, ang };
  return { lat: Math.asin(clamp(m[1] / n, -1, 1)) / RAD, lon: Math.atan2(-m[2], m[0]) / RAD, ang };
}

// Compact people count: 950, 12.4 k, 3.1 M, 1.2 bn.
export function fmtCount(n) {
  n = Math.max(0, n || 0);
  if (n < 1e3) return String(Math.round(n));
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + ' k';
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' M';
  return (n / 1e9).toFixed(2) + ' bn';
}

// Response scenarios. Each sets policies on a copy of defaultPolicies().
// trigger = detected cumulative cases worldwide.
const SCENARIOS = [
  { id: 'none', name: 'No response', w: 1, set: () => {} },
  { id: 'slow', name: 'A late response', w: 1.2, set: (p, route) => {
    on(p, 'isolation', 0.6, 5000); on(p, 'distancing', 0.5, 50000); on(p, 'vaccination', 0.5, 20000);
    if (route === 'resp') on(p, 'masks', 0.5, 50000);
  } },
  { id: 'fast', name: 'An early response', w: 1.2, set: (p, route) => {
    on(p, 'isolation', 0.8, 100); on(p, 'quarantine', 0.7, 100); on(p, 'travel', 0.8, 500);
    on(p, 'distancing', 0.6, 2000); on(p, 'vaccination', 0.8, 1000);
    if (route === 'resp') on(p, 'masks', 0.6, 2000);
    if (route === 'vector' || route === 'flea') on(p, 'vectorControl', 0.7, 1000);
    if (route === 'water') on(p, 'cleanWater', 0.7, 1000);
  } },
  { id: 'route', name: 'A response for the route', w: 1, set: (p, route) => {
    if (route === 'vector' || route === 'flea') on(p, 'vectorControl', 0.8, 1000);
    else if (route === 'water') on(p, 'cleanWater', 0.8, 1000);
    else if (route === 'contact') on(p, 'isolation', 0.9, 50);
    else { on(p, 'masks', 0.7, 3000); on(p, 'distancing', 0.6, 3000); }
    on(p, 'borders', 0.5, 10000);
  } },
];
function on(p, id, strength, trigger) { if (p[id]) Object.assign(p[id], { on: true, strength, trigger }); }

const styleIds = styles => (styles && styles.length ? styles : ['night', 'marble', 'dots', 'flat', 'equalearth', 'holo'])
  .map(s => (typeof s === 'string' ? s : s.id));

export function createDirector({ seed = 1, calm = 0.7, styles, D = null, texFor = null, rules = null } = {}) {
  const rng = makeRng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  calm = clamp(+calm || 0, 0, 1);
  const ids = styleIds(styles);
  const hasFlat = ids.includes('flat');
  const globes = ids.filter(id => id !== 'flat');
  if (!globes.length) globes.push(ids[0] || 'night');
  const policyName = Object.fromEntries(POLICY_DEFS.map(d => [d.id, d.name]));

  let bag = [], lastDisease = null, lastStyle = null;
  const st = {
    run: 0, shots: 0, maxShots: 0, shot: null, t0: 0, end: 0, done: false,
    diseaseId: null, seedNode: -1, style: globes[0], scenario: null,
    seenPolicies: new Set(), seenFirst: new Set(), seenRegions: new Set(), seenTips: new Set(), curve: { peak: false, below: false },
    lastKind: null, forced: null, log: [],
  };

  // Seeded bag: a shuffled copy of every preset; a refill never starts
  // with the disease of the run before.
  function nextDisease() {
    if (!bag.length) {
      bag = rng.shuffle(DISEASE_IDS.slice());
      if (bag[bag.length - 1] === lastDisease) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    let id = bag.pop();
    if (id === lastDisease && bag.length) { const j = bag.length - 1; [id, bag[j]] = [bag[j], id]; }
    lastDisease = id;
    return id;
  }

  function seedNodeFor(route) {
    const nodes = (D && D.nodes) || [];
    if (!nodes.length) return -1;
    const big = nodes.slice().sort((a, b) => b.cityPop - a.cityPop || a.i - b.i).slice(0, 90);
    const fit = {
      vector: n => Math.abs(n.lat) < 25,
      water: n => n.income >= 3,
      flea: n => Math.abs(n.lat) < 45 && n.income >= 2,
      contact: n => n.region === 6,
    }[route];
    const pool = fit ? big.filter(fit) : big.slice(0, 50);
    const list = pool.length ? pool : big;
    return list[rng.int(list.length)].i;
  }

  function newRun() {
    const diseaseId = nextDisease(), route = ROUTE[diseaseId];
    const seedNode = seedNodeFor(route);
    const policies = defaultPolicies();
    const total = SCENARIOS.reduce((s, c) => s + c.w, 0);
    let r = rng.next() * total, sc = SCENARIOS[0];
    for (const c of SCENARIOS) { if ((r -= c.w) < 0) { sc = c; break; } }
    sc.set(policies, route);
    // run style: night is the default look and comes twice as often;
    // never the same style two runs in a row when there is a choice
    const cand = globes.filter(s => s !== lastStyle || globes.length === 1);
    const weights = cand.map(s => (s === 'night' ? 2 : 1));
    let w = rng.next() * weights.reduce((a, b) => a + b, 0), style = cand[0];
    for (let i = 0; i < cand.length; i++) { if ((w -= weights[i]) < 0) { style = cand[i]; break; } }
    lastStyle = style;
    const seedN = D && D.nodes ? D.nodes[seedNode] : null;
    Object.assign(st, {
      run: st.run + 1, shots: 0, maxShots: 12 + rng.int(6), shot: null, t0: 0, end: 0, done: false,
      diseaseId, seedNode, style, scenario: sc.id, seenPolicies: new Set(), seenFirst: new Set(),
      seenRegions: new Set(seedN ? [seedN.region] : []), seenTips: new Set(), curve: { peak: false, below: false }, lastKind: null, forced: null,
    });
    return { diseaseId, seedNode, policies, startDayOfYear: rng.int(365), style, scenario: sc.id, scenarioName: sc.name };
  }

  const firstKey = e => `${e.day}:${e.from}:${e.to}`;
  const node = (view, i) => { const d = view.D || D; return d && d.nodes && i >= 0 ? d.nodes[i] : null; };
  const regionName = (view, r) => (((view.D || D || {}).regions || [])[r]) || 'A region';

  // The event that is waiting for a shot, or null. take = true marks it
  // as shown. A kind that just ran waits for the next cut (never two in a
  // row). Order: policy, tipping, front (a new region), curve.
  function pending(view, take) {
    const active = view.active || {};
    if (st.lastKind !== 'policy' && Object.keys(active).some(id => !st.seenPolicies.has(id))) return { kind: 'policy' };
    const tp = view.tipped;
    if (tp && tp.region >= 0 && !st.seenTips.has(tp.region) && st.lastKind !== 'tipping') {
      if (take) st.seenTips.add(tp.region);
      return { kind: 'tipping', region: tp.region };
    }
    const nr = newRegion(view);
    if (nr && st.lastKind !== 'front') {
      if (take) {
        st.seenFirst.add(firstKey(nr)); st.seenRegions.add(nr.region);
        // regions reached before this one are old news now
        const sim = view.sim, nodes = (view.D || D || {}).nodes;
        if (sim && sim.firstDay && nodes) for (let i = 0; i < nodes.length; i++) if (sim.firstDay[i] >= 0) st.seenRegions.add(nodes[i].region);
      }
      return { kind: 'front', ev: nr };
    }
    const cv = view.curve;
    if (cv && st.lastKind !== 'curve') {
      if (cv.peaked && !st.curve.peak) { if (take) st.curve.peak = true; return { kind: 'curve', why: 'peak' }; }
      if (cv.below1 && !st.curve.below && ((view.totals && view.totals.cases) || 0) > 1000) { if (take) st.curve.below = true; return { kind: 'curve', why: 'below1' }; }
    }
    return null;
  }

  // A region that the infection reached since the director last looked.
  // With the live sim (main.js view): the regions with a reached city
  // that the director has not seen, and in them the newest city reached
  // (sim.firstDay) with the city that seeded it (sim.source). Without it
  // (a stub view): the region of view.newestFirst.
  function newRegion(view) {
    const sim = view.sim, nodes = (view.D || D || {}).nodes;
    if (sim && sim.firstDay && nodes) {
      let best = -1, bd = -1;
      for (let i = 0; i < nodes.length; i++) {
        const d = sim.firstDay[i];
        if (d >= 0 && !st.seenRegions.has(nodes[i].region) && d > bd) { bd = d; best = i; }
      }
      if (best < 0) return null;
      return { day: bd, from: sim.source ? sim.source[best] : -1, to: best, kind: 'air', edge: -1, region: nodes[best].region };
    }
    const ev = view.newestFirst, to = ev ? node(view, ev.to) : null;
    if (!ev || !to || st.seenFirst.has(firstKey(ev)) || st.seenRegions.has(to.region)) return null;
    return { ...ev, region: to.region };
  }

  function chooseKind(view) {
    if (st.shots === 0) return { kind: 'origin' };
    if (view.burnedOut || st.shots >= st.maxShots) return { kind: 'aftermath' };
    if (st.forced) { const k = st.forced; st.forced = null; if (k !== 'flat' || hasFlat) return { kind: k }; }
    const ev = pending(view, true);
    if (ev) return ev;
    const cases = (view.totals && view.totals.cases) || 0;
    const g = view.growth, x = view.exporter;
    const c = [];
    if (g && g.node >= 0 && g.doubling < 30) c.push(['surge', 2.4]);
    if (x && x.node >= 0 && x.count >= 3) c.push(['export', 1.8]);
    if (view.newestFirst && cases > 50) c.push(['front', 1]);
    if (cases < 300) c.push(['origin', 1.5]);
    if (view.hottest >= 0) c.push(['erupt', cases > 100 ? (g ? 0.7 : 2) : 0.6]);
    if (cases > 300) c.push(['network', 1.8]);
    if (cases > 1000 && view.topRegion >= 0) c.push(['region', 1.3]);
    if (cases > 3000 && hasFlat) c.push(['flat', 1]);
    if (cases > 1e5 && view.curve) c.push(['curve', 0.8]);
    if (cases <= 300) c.push(['network', 0.8]);
    const pool = c.filter(([k]) => k !== st.lastKind);
    const list = pool.length ? pool : c;
    let r = rng.next() * list.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of list) { if ((r -= w) < 0) return { kind: k }; }
    return { kind: list[list.length - 1][0] };
  }

  // shot = { kind, dur, style, cam, camEnd?, follow, simSpeed, title, spin,
  //          drift, hud?, subject }. camEnd: main.js eases the altitude
  // and tilt from cam to camEnd over the shot (a push in or a pull back).
  function makeShot(pick, view) {
    const kind = pick.kind;
    const dur = clamp(8 + 2 * calm + 1.5 * rng.next() + (kind === 'origin' || kind === 'aftermath' ? 0.5 : 0), SHOT_S[0], SHOT_S[1]);
    const speed = SPEED[kind] * (1.3 - 0.6 * calm);
    const turn = (rng.next() < 0.5 ? -1 : 1) * (0.5 + 0.7 * (1 - calm));
    const s = { kind, dur, style: st.style, cam: null, camEnd: null, follow: null, simSpeed: speed, title: '', spin: 0, drift: 0, hud: null, subject: {} };
    const wide = { lat: 20, lon: 0, alt: 2, tilt: 0, heading: 0 };
    const close = (n, alt, tilt) => ({ lat: n.lat, lon: n.lon, alt, tilt, heading: rng.next() * 360 });
    if (kind === 'origin') {
      // the cold open: tight on the seed city, slow time, a slow pull out
      const n = node(view, st.seedNode) || node(view, view.hottest);
      s.cam = n ? close(n, 0.26 + 0.06 * rng.next(), 38 + 10 * rng.next()) : { ...wide, alt: 1.6 };
      if (n) s.camEnd = { alt: 0.55 + 0.15 * rng.next(), tilt: 22 };
      s.follow = n ? { kind: 'node', id: n.i } : null;
      s.subject = { node: n ? n.i : -1 };
      s.spin = turn * 0.6; s.title = n ? `First cases in ${n.name}` : 'First cases';
    } else if (kind === 'front') {
      // follow the leading front: the newest city reached, retargeted as
      // new cities ignite (main.js follow kind 'front')
      const e = pick.ev || view.newestFirst, a = node(view, e && e.from), b = node(view, e && e.to);
      if (e && !pick.ev) st.seenFirst.add(firstKey(e));
      if (a && b) {
        const m = midpoint(a, b);
        s.cam = { lat: (m.lat + 2 * b.lat) / 3, lon: b.lon + wrapLon(m.lon - b.lon) / 3, alt: clamp(0.55 + 1.1 * m.ang, 0.65, 1.8), tilt: 18, heading: 0 };
      } else s.cam = b ? close(b, 0.9, 15) : { ...wide };
      s.follow = { kind: 'front', id: b ? b.i : -1, from: a ? a.i : -1 };
      s.subject = { node: b ? b.i : -1, from: a ? a.i : -1, region: b ? b.region : -1, newRegion: !!pick.ev };
      s.title = b ? (pick.ev ? `The front reaches ${regionName(view, b.region)}` : `The front moves: ${b.name}`) : 'The front moves';
      s.simSpeed *= 0.8;
    } else if (kind === 'surge') {
      // push in on the city with the fastest growth (stats.js growth)
      const g = view.growth, n = node(view, g && g.node);
      s.cam = n ? close(n, 0.85 + 0.2 * rng.next(), 25) : { ...wide };
      if (n) s.camEnd = { alt: 0.3 + 0.08 * rng.next(), tilt: 42 + 8 * rng.next() };
      s.follow = n ? { kind: 'node', id: n.i } : null;
      s.subject = { node: n ? n.i : -1 };
      s.spin = turn * 0.8; s.title = n ? `Fastest growth: ${n.name}` : 'The fastest growth';
    } else if (kind === 'export') {
      // exported cases: high over the hub that sends the most infected flights
      const x = view.exporter, n = node(view, x && x.node);
      s.cam = n ? close(n, 1.15 + 0.35 * rng.next(), 20 + 8 * rng.next()) : { ...wide };
      s.follow = n ? { kind: 'node', id: n.i } : null;
      s.subject = { node: n ? n.i : -1 };
      s.drift = turn * 0.5; s.title = n ? `Exported cases: ${n.name}` : 'Exported cases';
    } else if (kind === 'tipping') {
      // a continent tips over: start on it, pull back to the whole globe
      const r = pick.region >= 0 ? pick.region : (view.tipped ? view.tipped.region : view.topRegion);
      const v = REGION_VIEW[clamp(r | 0, 0, REGION_VIEW.length - 1)];
      s.cam = { lat: v.lat, lon: v.lon, alt: 0.8 * v.alt, tilt: 24, heading: (rng.next() - 0.5) * 20 };
      s.camEnd = { alt: 2.7 + 0.3 * rng.next(), tilt: 0 };
      s.subject = { region: r };
      s.drift = turn * 0.4; s.title = `${regionName(view, r)} tips over`;
    } else if (kind === 'curve') {
      // the curve moment: wide, the saver HUD draws the epidemic curve large
      s.cam = { lat: 15 + (rng.next() - 0.5) * 30, lon: rng.next() * 360 - 180, alt: 2.5, tilt: 0, heading: 0 };
      s.hud = 'curve'; s.drift = turn; s.subject = { why: pick.why || 'curve' };
      s.title = pick.why === 'peak' ? 'The curve turns: past the peak' : pick.why === 'below1' ? 'R_eff falls below 1' : 'The epidemic curve';
    } else if (kind === 'erupt') {
      const n = node(view, view.hottest);
      s.cam = n ? close(n, 0.5 + 0.25 * rng.next(), 30 + 10 * rng.next()) : { lat: 0, lon: 0, alt: 1.5, tilt: 0, heading: 0 };
      s.follow = n ? { kind: 'node', id: n.i } : null;
      s.subject = { node: n ? n.i : -1 };
      s.spin = turn; s.title = n ? `Most infections now: ${n.name}` : 'The epidemic grows';
    } else if (kind === 'network') {
      s.cam = { lat: (rng.next() - 0.5) * 60, lon: rng.next() * 360 - 180, alt: 2.2 + 0.6 * rng.next(), tilt: 0, heading: 0 };
      s.drift = turn; s.title = 'The travel network carries it';
    } else if (kind === 'region') {
      const ri = clamp(view.topRegion | 0, 0, REGION_VIEW.length - 1), v = REGION_VIEW[ri];
      s.cam = { lat: v.lat, lon: v.lon, alt: v.alt, tilt: 15 + 10 * rng.next(), heading: (rng.next() - 0.5) * 30 };
      s.subject = { region: ri };
      s.drift = turn * 0.6; s.title = `${regionName(view, ri)}: most active infections`;
    } else if (kind === 'flat') {
      s.style = 'flat';
      s.cam = { lat: 0, lon: 0, alt: 2.4 + 0.4 * rng.next(), tilt: 0, heading: 0 };
      s.title = 'The whole world on one map';
    } else if (kind === 'policy') {
      const ids = Object.keys(view.active || {}).filter(id => !st.seenPolicies.has(id));
      for (const id of Object.keys(view.active || {})) st.seenPolicies.add(id);
      const n = node(view, view.hottest);
      s.cam = n ? { lat: n.lat, lon: n.lon, alt: 1.2, tilt: 10, heading: 0 } : { ...wide };
      s.drift = turn * 0.5;
      const names = ids.map(id => policyName[id] || id);
      s.subject = { policies: names };
      s.title = names.length ? `Policy starts: ${names.slice(0, 2).join(', ')}` : 'The response holds';
    } else {
      s.cam = { lat: 15 + (rng.next() - 0.5) * 30, lon: rng.next() * 360 - 180, alt: 2.6, tilt: 0, heading: 0 };
      s.drift = turn; s.simSpeed = view.burnedOut ? 0 : speed; s.hud = 'curve';
      s.title = `After the epidemic: day ${Math.floor(view.day || 0)}`;
    }
    s.cam.lon = wrapLon(s.cam.lon);
    s.spin = clamp(s.spin, -CALM_DEG_S, CALM_DEG_S);
    s.drift = clamp(s.drift, -CALM_DEG_S, CALM_DEG_S);
    return s;
  }

  function tick(now, view) {
    view = view || {};
    if (st.done) return { shot: st.shot, changed: false, restart: true };
    if (st.shot && st.shot.kind !== 'aftermath' && !st.forced) {
      // cut on an event once the shot has run SHOT_S[0]; else at its end
      const early = now >= st.t0 + SHOT_S[0] && pending(view, false);
      if (now < st.end && !early) return { shot: st.shot, changed: false, restart: false };
    } else if (st.shot && now < st.end && !(st.forced && st.shot.kind !== 'aftermath')) return { shot: st.shot, changed: false, restart: false };
    if (st.shot && st.shot.kind === 'aftermath') { st.done = true; return { shot: st.shot, changed: false, restart: true }; }
    const pick = chooseKind(view);
    const shot = makeShot(pick, view);
    // every region reached by now is known: a later front shot is only
    // for a region reached after this cut
    const sim = view.sim, nodes = (view.D || D || {}).nodes;
    if (sim && sim.firstDay && nodes) for (let i = 0; i < nodes.length; i++) if (sim.firstDay[i] >= 0) st.seenRegions.add(nodes[i].region);
    st.shot = shot; st.t0 = now; st.end = now + shot.dur; st.shots++; st.lastKind = pick.kind;
    st.log.push(pick.kind); if (st.log.length > 64) st.log.shift();
    return { shot, changed: true, restart: false };
  }

  // The live sub line of the plate: what the shot shows, with numbers
  // from the view now (it changes as the shot runs).
  function subLine(view) {
    const s = st.shot;
    if (!s) return 'A simulated epidemic on the travel network';
    const sj = s.subject || {}, n = node(view, sj.node), t = view.totals || {}, h = view.hud || {};
    const where = n ? `${n.name}, ${n.country}` : '';
    const pct = i => { const sim = view.sim, nn = node(view, i); return sim && nn ? sim.I[i] / nn.pop : 0; };
    switch (s.kind) {
      case 'origin': return n ? `${where} · day ${Math.floor(view.day || 0)} · ${fmtCount(t.cases)} cases` : s.title;
      case 'front': {
        const nn = (sj.newRegion ? n : node(view, view.newestFirst ? view.newestFirst.to : sj.node)) || n;
        const reg = sj.region >= 0 ? regionName(view, sj.region) : '';
        return nn ? `${nn.name} · ${sj.newRegion ? `first cases in ${reg}` : 'the newest city reached'} · ${h.cities || 0} cities` : s.title;
      }
      case 'surge': {
        const g = view.growth && view.growth.node === sj.node ? view.growth : null;
        return n ? (g ? `${n.name} · cases doubling every ${fmtDays(g.doubling)}` : `${n.name} · ${(pct(sj.node) * 100).toFixed(2)} % infected now`) : s.title;
      }
      case 'export': {
        const x = view.exporter && view.exporter.node === sj.node ? view.exporter : null;
        return n ? `${n.name} · ${x ? `${Math.round(x.count)} infected flights out in ${x.days} days` : 'infected flights leave the hub'}` : s.title;
      }
      case 'tipping': {
        const R = view.regionStats ? view.regionStats[sj.region] : null;
        return `${regionName(view, sj.region)} tips over · ${R ? `${R.reached} of ${R.cities} cities reached` : `${fmtCount(t.I)} infected now`}`;
      }
      case 'curve': {
        const c = view.curve || {};
        return `${fmtCount(c.inc)} new cases a day · peak ${fmtCount(c.peakInc)} on day ${Math.floor(c.peakDay || 0)} · R_eff ${Number.isFinite(view.reff) ? view.reff.toFixed(2) : '-'}`;
      }
      case 'erupt': return n ? `${n.name} · ${(pct(sj.node) * 100).toFixed(2)} % infected now` : s.title;
      case 'region': {
        const R = view.regionStats ? view.regionStats[sj.region] : null;
        return `${regionName(view, sj.region)} · ${R ? `${fmtCount(R.I)} infected now · ${R.reached} of ${R.cities} cities` : s.title}`;
      }
      case 'network': return `The travel network carries it · ${h.cities || 0} cities in ${h.countries || 0} countries`;
      case 'policy': return s.title;
      case 'aftermath': return `After the epidemic · ${fmtCount(t.cases)} cases · ${fmtCount(t.deaths)} deaths`;
      default: return s.title;
    }
  }

  function plate(view, disease) {
    view = view || {};
    const t = view.totals || {}, d = disease || null, h = view.hud || null;
    const params = [];
    if (d) {
      params.push({ sym: 'R_0', name: 'basic reproduction number', value: (+d.R0).toFixed(1), cls: 'm1' });
      if (d.latent > 0) params.push({ sym: '\\sigma^{-1}', name: 'latent period', value: `${d.latent} d`, cls: 'm2' });
      params.push({ sym: '\\gamma^{-1}', name: 'infectious period', value: `${d.infectious} d`, cls: 'm3' });
      params.push({ sym: '\\mathrm{IFR}', name: 'infection fatality ratio', value: `${+(d.ifr * 100).toPrecision(2)} %`, cls: 'm4' });
    }
    if (Number.isFinite(view.reff)) params.push({ sym: 'R_{\\mathrm{eff}}', name: 'now', value: view.reff.toFixed(2), cls: 'm5' });
    const lines = h
      ? [`Day ${Math.floor(h.day)} · ${fmtCount(h.infected)} infected now · +${fmtCount(h.today)} cases today`,
        `${fmtCount(h.cases)} cases · ${fmtCount(h.deaths)} deaths · ${h.cities} cities in ${h.countries} countries`]
      : [`Day ${Math.floor(view.day || 0)} · ${fmtCount(t.cases)} infections · ${fmtCount(t.deaths)} deaths`];
    const act = Object.keys(view.active || {}).map(id => policyName[id] || id);
    lines.push(act.length ? `Policies in force: ${act.join(', ')}` : 'No policies in force');
    lines.push('A toy metapopulation model, not a forecast. Values are approximate and illustrative.');
    let tex = null;
    if (d && typeof texFor === 'function') { try { tex = texFor(d); } catch (e) { tex = null; } }
    if (typeof tex === 'string') tex = [tex];
    if (!Array.isArray(tex) || !tex.length) tex = FALLBACK_TEX.slice();
    const out = { title: d ? d.name : 'Outbreak', sub: subLine(view), params, lines, tex };
    if (rules) out.rules = rules;
    return out;
  }

  return {
    newRun, tick, plate,
    // a cut that faded in: the shot runs its full length from now
    restartClock(now) { if (st.shot) { const d = st.end - st.t0; st.t0 = now; st.end = now + d; } },
    force(kind) { if (!SHOT_KINDS.includes(kind)) return false; st.forced = kind; if (kind === 'aftermath') st.shots = st.maxShots; return true; },
    state: () => ({
      run: st.run, shots: st.shots, maxShots: st.maxShots, diseaseId: st.diseaseId, seedNode: st.seedNode,
      style: st.style, scenario: st.scenario, done: st.done, kind: st.shot && st.shot.kind,
      title: st.shot && st.shot.title, end: st.end, t0: st.t0, log: st.log.slice(),
    }),
  };
}
