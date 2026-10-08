// ============================================================================
//  OUTBREAK  ·  director.js — the shot director of the Auto mode (no DOM)
// ----------------------------------------------------------------------------
//  The screensaver (saver.js, in the shell) and the on-page Auto button
//  use the same director. The director selects a disease, a seed city and
//  a public-health response for each run. Then it cuts the run into shots
//  of 5-12 s of wall time. Each shot has a kind, a style, a camera state
//  (camera.js) and a simulation speed in days per second.
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
//           active, D }
//  shot = { kind, dur, style, cam, follow, simSpeed, title, spin, drift }
//    spin    degrees of heading per second (main.js may ignore it)
//    drift   degrees of longitude per second (main.js may ignore it)
//
//  Rules of the cut:
//    - The first shot of a run is 'origin' (the seed city).
//    - A burned-out view, or a run longer than maxShots, gives the
//      'aftermath' shot. When the aftermath shot ends, tick returns
//      restart = true until the caller calls newRun().
//    - A new active policy gives a 'policy' shot. A new first infection
//      of a city gives an 'export' shot. The other kinds come from a
//      seeded weighted choice. The same kind never comes two times in a
//      row (except 'aftermath', which holds).
//    - Two runs in a row never have the same disease (seeded bag).
//  Same seed and same view sequence give the same shots.
//
//  The plate is the shell label plate (lib/screensaver.js): text, TeX and
//  parameters. It never has a `code` field (the user does not want code
//  on non-shader plates, see memory saver-no-code-pages).
//
//  grep -n targets: "export const SHOT_KINDS", "export const DISEASE_IDS",
//    "const ROUTE", "const REGION_VIEW", "export function createDirector",
//    "function newRun", "function chooseKind", "function makeShot",
//    "function plate", "const SCENARIOS", "FALLBACK_TEX"
// ============================================================================
import { makeRng } from './rng.js';
import { POLICY_DEFS, defaultPolicies } from './policies.js';

export const SHOT_KINDS = ['origin', 'export', 'erupt', 'network', 'region', 'flat', 'policy', 'aftermath'];

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
const SPEED = { origin: 2, export: 2.5, erupt: 4, network: 8, region: 6, flat: 10, policy: 4, aftermath: 3 };

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
    seenPolicies: new Set(), seenFirst: new Set(), lastKind: null, forced: null, log: [],
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
    Object.assign(st, {
      run: st.run + 1, shots: 0, maxShots: 12 + rng.int(6), shot: null, t0: 0, end: 0, done: false,
      diseaseId, seedNode, style, scenario: sc.id, seenPolicies: new Set(), seenFirst: new Set(),
      lastKind: null, forced: null,
    });
    return { diseaseId, seedNode, policies, startDayOfYear: rng.int(365), style, scenario: sc.id, scenarioName: sc.name };
  }

  const firstKey = e => `${e.day}:${e.from}:${e.to}`;

  function chooseKind(view) {
    if (st.shots === 0) return 'origin';
    if (view.burnedOut || st.shots >= st.maxShots) return 'aftermath';
    if (st.forced) { const k = st.forced; st.forced = null; if (k !== 'flat' || hasFlat) return k; }
    const cases = (view.totals && view.totals.cases) || 0;
    const active = view.active || {};
    if (Object.keys(active).some(id => !st.seenPolicies.has(id)) && st.lastKind !== 'policy') return 'policy';
    const ev = view.newestFirst;
    if (ev && !st.seenFirst.has(firstKey(ev)) && st.lastKind !== 'export' && rng.next() < 0.7) return 'export';
    const c = [];
    if (cases < 300) c.push(['origin', 1.5]);
    if (view.hottest >= 0) c.push(['erupt', cases > 100 ? 2 : 0.6]);
    if (cases > 300) c.push(['network', 2.5]);
    if (cases > 1000 && view.topRegion >= 0) c.push(['region', 2]);
    if (cases > 3000 && hasFlat) c.push(['flat', 1.2]);
    if (cases <= 300) c.push(['network', 0.8]);
    const pool = c.filter(([k]) => k !== st.lastKind);
    const list = pool.length ? pool : c;
    let r = rng.next() * list.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of list) { if ((r -= w) < 0) return k; }
    return list[list.length - 1][0];
  }

  const node = (view, i) => { const d = view.D || D; return d && d.nodes && i >= 0 ? d.nodes[i] : null; };

  function makeShot(kind, view) {
    const dur = clamp(5.5 + 4.5 * calm + 2 * rng.next() + (kind === 'origin' || kind === 'aftermath' ? 1 : 0), 5, 12);
    const speed = SPEED[kind] * (1.3 - 0.6 * calm);
    const turn = (rng.next() < 0.5 ? -1 : 1) * (1.5 + 2 * (1 - calm));
    const s = { kind, dur, style: st.style, cam: null, follow: null, simSpeed: speed, title: '', spin: 0, drift: 0 };
    const regions = (view.D || D || {}).regions || [];
    if (kind === 'origin') {
      const n = node(view, st.seedNode) || node(view, view.hottest);
      s.cam = n ? { lat: n.lat, lon: n.lon, alt: 0.55 + 0.2 * rng.next(), tilt: 28 + 12 * rng.next(), heading: rng.next() * 360 } : { lat: 20, lon: 0, alt: 1.6, tilt: 0, heading: 0 };
      s.follow = n ? { kind: 'node', id: n.i } : null;
      s.spin = turn; s.title = n ? `First cases in ${n.name}` : 'First cases';
    } else if (kind === 'export') {
      const e = view.newestFirst, a = node(view, e && e.from), b = node(view, e && e.to);
      if (e) st.seenFirst.add(firstKey(e));
      if (a && b) {
        const m = midpoint(a, b);
        s.cam = { lat: m.lat, lon: m.lon, alt: clamp(0.5 + 1.4 * m.ang, 0.6, 2.4), tilt: 12, heading: 0 };
        s.follow = { kind: 'event', id: e.edge, from: e.from, to: e.to };
        s.title = e.kind === 'land' ? `Over land: ${a.name} to ${b.name}` : `By air: ${a.name} to ${b.name}`;
      } else {
        const n = b || a;
        s.cam = n ? { lat: n.lat, lon: n.lon, alt: 1, tilt: 10, heading: 0 } : { lat: 20, lon: 0, alt: 2, tilt: 0, heading: 0 };
        s.title = n ? `First cases in ${n.name}` : 'A new city';
      }
      s.simSpeed *= 0.8;
    } else if (kind === 'erupt') {
      const n = node(view, view.hottest);
      s.cam = n ? { lat: n.lat, lon: n.lon, alt: 0.5 + 0.25 * rng.next(), tilt: 30 + 10 * rng.next(), heading: rng.next() * 360 } : { lat: 0, lon: 0, alt: 1.5, tilt: 0, heading: 0 };
      s.follow = n ? { kind: 'node', id: n.i } : null;
      s.spin = turn; s.title = n ? `Most infections now: ${n.name}` : 'The epidemic grows';
    } else if (kind === 'network') {
      s.cam = { lat: (rng.next() - 0.5) * 60, lon: rng.next() * 360 - 180, alt: 2.2 + 0.6 * rng.next(), tilt: 0, heading: 0 };
      s.drift = turn * 1.5; s.title = 'The travel network carries it';
      if (globes.length > 1 && rng.next() < 0.3) s.style = globes.filter(g => g !== st.style)[rng.int(globes.length - 1)];
    } else if (kind === 'region') {
      const ri = clamp(view.topRegion | 0, 0, REGION_VIEW.length - 1), v = REGION_VIEW[ri];
      s.cam = { lat: v.lat, lon: v.lon, alt: v.alt, tilt: 15 + 10 * rng.next(), heading: (rng.next() - 0.5) * 30 };
      s.drift = turn * 0.6; s.title = `${regions[ri] || 'Region'}: most active infections`;
    } else if (kind === 'flat') {
      s.style = 'flat';
      s.cam = { lat: 0, lon: 0, alt: 2.4 + 0.4 * rng.next(), tilt: 0, heading: 0 };
      s.title = 'The whole world on one map';
    } else if (kind === 'policy') {
      const ids = Object.keys(view.active || {}).filter(id => !st.seenPolicies.has(id));
      for (const id of Object.keys(view.active || {})) st.seenPolicies.add(id);
      const n = node(view, view.hottest);
      s.cam = n ? { lat: n.lat, lon: n.lon, alt: 1.2, tilt: 10, heading: 0 } : { lat: 20, lon: 0, alt: 2, tilt: 0, heading: 0 };
      s.drift = turn * 0.5;
      const names = ids.map(id => policyName[id] || id);
      s.title = names.length ? `Policy starts: ${names.slice(0, 2).join(', ')}` : 'The response holds';
    } else {
      s.cam = { lat: 15 + (rng.next() - 0.5) * 30, lon: rng.next() * 360 - 180, alt: 2.6, tilt: 0, heading: 0 };
      s.drift = turn; s.simSpeed = view.burnedOut ? 0 : speed;
      s.title = `After the epidemic: day ${Math.floor(view.day || 0)}`;
    }
    s.cam.lon = wrapLon(s.cam.lon);
    return s;
  }

  function tick(now, view) {
    view = view || {};
    if (st.done) return { shot: st.shot, changed: false, restart: true };
    if (st.shot && now < st.end && !(st.forced && st.shot.kind !== 'aftermath')) return { shot: st.shot, changed: false, restart: false };
    if (st.shot && st.shot.kind === 'aftermath') { st.done = true; return { shot: st.shot, changed: false, restart: true }; }
    const kind = chooseKind(view);
    const shot = makeShot(kind, view);
    st.shot = shot; st.t0 = now; st.end = now + shot.dur; st.shots++; st.lastKind = kind;
    st.log.push(kind); if (st.log.length > 64) st.log.shift();
    return { shot, changed: true, restart: false };
  }

  function plate(view, disease) {
    view = view || {};
    const t = view.totals || {}, d = disease || null;
    const params = [];
    if (d) {
      params.push({ sym: 'R_0', name: 'basic reproduction number', value: (+d.R0).toFixed(1), cls: 'm1' });
      if (d.latent > 0) params.push({ sym: '\\sigma^{-1}', name: 'latent period', value: `${d.latent} d`, cls: 'm2' });
      params.push({ sym: '\\gamma^{-1}', name: 'infectious period', value: `${d.infectious} d`, cls: 'm3' });
      params.push({ sym: '\\mathrm{IFR}', name: 'infection fatality ratio', value: `${+(d.ifr * 100).toPrecision(2)} %`, cls: 'm4' });
    }
    if (Number.isFinite(view.reff)) params.push({ sym: 'R_{\\mathrm{eff}}', name: 'now', value: view.reff.toFixed(2), cls: 'm5' });
    const lines = [`Day ${Math.floor(view.day || 0)} · ${fmtCount(t.cases)} infections · ${fmtCount(t.deaths)} deaths`];
    const act = Object.keys(view.active || {}).map(id => policyName[id] || id);
    lines.push(act.length ? `Policies in force: ${act.join(', ')}` : 'No policies in force');
    lines.push('A toy metapopulation model, not a forecast. Values are approximate and illustrative.');
    let tex = null;
    if (d && typeof texFor === 'function') { try { tex = texFor(d); } catch (e) { tex = null; } }
    if (typeof tex === 'string') tex = [tex];
    if (!Array.isArray(tex) || !tex.length) tex = FALLBACK_TEX.slice();
    const out = {
      title: d ? d.name : 'Outbreak',
      sub: st.shot ? st.shot.title : 'A simulated epidemic on the travel network',
      params, lines, tex,
    };
    if (rules) out.rules = rules;
    return out;
  }

  return {
    newRun, tick, plate,
    force(kind) { if (!SHOT_KINDS.includes(kind)) return false; st.forced = kind; if (kind === 'aftermath') st.shots = st.maxShots; return true; },
    state: () => ({
      run: st.run, shots: st.shots, maxShots: st.maxShots, diseaseId: st.diseaseId, seedNode: st.seedNode,
      style: st.style, scenario: st.scenario, done: st.done, kind: st.shot && st.shot.kind,
      title: st.shot && st.shot.title, end: st.end, log: st.log.slice(),
    }),
  };
}
