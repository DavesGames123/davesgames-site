// ============================================================================
//  DLA TERRAIN  ·  world-state.js — the dice, the locks, the URL hash, history
// ----------------------------------------------------------------------------
//  DOM-free (node tests import it). A "world" is the full state that makes
//  one view of the page:
//    { opts (LIB options, with seed), preset (id or null), tod 0..1,
//      playing, weather (WEATHER id), season 0..1, veg { density, conifer,
//      flowers }, water { tint, waves }, cam (null or a camera shot) }
//  cam = { kind: 'orbit', yaw, pitch, distK, tx, tz } (distK = dist /
//        world size, tx tz = target / world size), { kind: 'drone',
//        path: 'ridge' | 'river', pick } (the pick-th longest path) or
//        { kind: 'fly', x, y, z, yaw, pitch } (metres, radians).
//
//  GROUPS   LIB_GROUPS (the 7 OPTIONS groups) + EXTRA_GROUPS (Sky, Time,
//           Season, Vegetation, Water, Camera). Each group has a dice and a
//           lock. rollGroup(world, group, seed, lib, ctx) rolls one group;
//           rollWorld(world, locks, seed, lib, ctx) rolls every group that is
//           not locked. LIB groups use lib.randomOptions(seed, base, group);
//           the full roll uses lib.randomOptions(seed, base) and then puts
//           the keys of the locked groups back.
//  HASH     encodeHash(world, lib) -> '#s=..&p=..&o=..&t=..&w=..&se=..'
//           decodeHash(hash, lib)  -> a partial world (null if no world)
//           p = the preset as it is; b = the nearest preset as the base of
//           o when the options differ. o = the options that differ from
//           the base: key_value pairs joined by '~'. Bool 1 / 0.
//  HISTORY  createHistory(max) -> { push(h), back(), forward(), canBack,
//           canForward, current } of hash strings (the rolled worlds)
//  DEFAULTS VEG0, WATER0, DEFAULT_WEATHER_W (the dice weights)
//
//  grep -n targets: "export const EXTRA_GROUPS", "export function rollGroup",
//  "export function rollWorld", "export function encodeHash",
//  "export function decodeHash", "export function createHistory",
//  "function rollTod", "function rollWeather", "function rollCam"
// ============================================================================

export const LIB_GROUPS = ['World', 'DLA ridges', 'Shape', 'Branched flow', 'Erosion', 'Climate', 'Detail'];
export const EXTRA_GROUPS = ['Sky', 'Time', 'Season', 'Vegetation', 'Water', 'Camera'];
export const ALL_GROUPS = [...LIB_GROUPS, ...EXTRA_GROUPS];
export const VEG0 = Object.freeze({ density: 1, conifer: 0.5, flowers: 0.5 });
export const WATER0 = Object.freeze({ tint: 0.35, waves: 0.4 });

// the weather dice: most rolls give light that flatters the land
export const DEFAULT_WEATHER_W = Object.freeze({
  fair: 3, 'golden-haze': 3, clear: 1.5, cloudy: 2, overcast: 0.6, fog: 1.1, drizzle: 0.5,
  rain: 0.7, thunderstorm: 1, snow: 0.7, blizzard: 0.25,
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = v => Math.round(v * 1000) / 1000;

export function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed(r = Math.random) { return 1 + Math.floor(r() * 999998); }

function pickWeighted(r, w) {
  const keys = Object.keys(w).filter(k => w[k] > 0);
  let s = 0;
  for (const k of keys) s += w[k];
  let x = r() * s;
  for (const k of keys) { x -= w[k]; if (x <= 0) return k; }
  return keys[keys.length - 1];
}

// a world is cold when its climate makes snow likely
function coldWorld(opts) {
  const lat = Math.abs(opts.latitude ?? 40);
  return (opts.baseTemp ?? 0) < -2 || lat > 55;
}

function rollWeather(r, world, ctx) {
  const w = { ...(ctx.weatherWeights || DEFAULT_WEATHER_W) };
  const cold = coldWorld(world.opts || {}) || (world.season > 0.82 || world.season < 0.05);
  if (!cold) { w.snow = 0; w.blizzard = 0; }
  else { w.snow = (w.snow || 0) * 2; w.blizzard = (w.blizzard || 0) * 1.5; }
  const ids = ctx.weatherIds;
  if (ids) for (const k of Object.keys(w)) if (!ids.includes(k)) delete w[k];
  return pickWeighted(r, w) || 'fair';
}

// Time: the sun height picks the band (golden light most often). With
// ctx.solarPosition the tod comes from the sun elevation at this season
// and latitude, else from fixed clock bands.
const TOD_BANDS = [
  { w: 3.2, elev: [2, 11], am: true }, { w: 3.2, elev: [2, 11], am: false },
  { w: 1.4, elev: [11, 30], am: true }, { w: 1.4, elev: [11, 30], am: false },
  { w: 1.0, elev: [30, 90], am: true },
  { w: 0.9, elev: [-5, 2], am: true }, { w: 0.9, elev: [-5, 2], am: false },
  { w: 0.6, elev: [-30, -10], am: false },
];
const CLOCK = [[0.255, 0.3], [0.7, 0.745], [0.3, 0.42], [0.58, 0.7], [0.42, 0.58], [0.235, 0.255], [0.745, 0.775], [0.82, 0.95]];
export function todForElevation(elev, am, season, lat, solarPosition) {
  // the first tod (from noon toward dawn or dusk) where the sun is at elev
  let best = null, bd = Infinity;
  for (let i = 0; i <= 240; i++) {
    const tod = am ? 0.5 - i / 480 : 0.5 + i / 480;
    const e = solarPosition(tod, season, lat).elevation;
    const d = Math.abs(e - elev);
    if (d < bd) { bd = d; best = tod; }
  }
  return best;
}
function rollTod(r, world, ctx) {
  const i = (() => { let s = 0; for (const b of TOD_BANDS) s += b.w; let x = r() * s; for (let k = 0; k < TOD_BANDS.length; k++) { x -= TOD_BANDS[k].w; if (x <= 0) return k; } return 0; })();
  const b = TOD_BANDS[i];
  if (ctx.solarPosition) {
    const lat = ctx.latitude ?? 46, se = world.season ?? 0.35;
    const peak = ctx.solarPosition(0.5, se, lat).elevation;
    const lo = Math.min(b.elev[0], peak - 1), hi = Math.min(b.elev[1], peak - 0.5);
    if (hi > lo && !(b.elev[1] < -4 && peak < -4)) {
      const tod = todForElevation(lo + (hi - lo) * r(), b.am, se, lat, ctx.solarPosition);
      if (tod !== null) return r3(tod);
    }
  }
  const [a, c] = CLOCK[i];
  return r3(a + (c - a) * r());
}

function rollCam(r) {
  const k = r();
  if (k < 0.45) return { kind: 'drone', path: 'ridge', pick: Math.floor(r() * 6) };
  if (k < 0.7) return { kind: 'drone', path: 'river', pick: Math.floor(r() * 6) };
  return { kind: 'orbit', yaw: r3(r() * Math.PI * 2), pitch: r3(-0.18 - r() * 0.32), distK: r3(0.28 + r() * 0.4), tx: r3((r() - 0.5) * 0.4), tz: r3((r() - 0.5) * 0.4) };
}

export function cloneWorld(w) {
  return {
    opts: { ...(w.opts || {}) }, preset: w.preset ?? null, tod: w.tod ?? 0.3, playing: w.playing ?? true,
    weather: w.weather || 'fair', season: w.season ?? 0.35,
    veg: { ...VEG0, ...(w.veg || {}) }, water: { ...WATER0, ...(w.water || {}) },
    cam: w.cam ? { ...w.cam } : null,
  };
}

// one group, a new world (the input is not changed). ctx = { solarPosition,
// latitude, weatherIds, weatherWeights, coarse }
export function rollGroup(world, group, seed, lib, ctx = {}) {
  const w = cloneWorld(world);
  const r = mulberry(seed ^ 0x5bd1e995);
  if (LIB_GROUPS.includes(group)) {
    let o;
    try { o = lib.randomOptions(seed, { ...w.opts }, group); } catch { o = lib.randomOptions(seed, { ...w.opts }); }
    const out = { ...w.opts };
    for (const d of lib.OPTIONS) if (d.group === group && d.key !== 'n' && o[d.key] !== undefined) out[d.key] = o[d.key];
    w.opts = out; w.preset = null;
  } else if (group === 'Sky') w.weather = rollWeather(r, w, ctx);
  else if (group === 'Time') w.tod = rollTod(r, w, ctx);
  else if (group === 'Season') w.season = r3(r());
  else if (group === 'Vegetation') w.veg = { density: r3(0.45 + 1.35 * r() * r() + 0.3 * r()), conifer: r3(r()), flowers: r3(r()) };
  else if (group === 'Water') w.water = { tint: r3(r()), waves: r3(r() * 0.9) };
  else if (group === 'Camera') w.cam = rollCam(r);
  return w;
}

// every group that is not locked. locks = Set or array of group names.
export function rollWorld(world, locks, seed, lib, ctx = {}) {
  const L = new Set(locks || []);
  const w = cloneWorld(world);
  const libLocked = LIB_GROUPS.filter(g => L.has(g));
  if (libLocked.length < LIB_GROUPS.length) {
    const base = { ...w.opts };
    const o = { ...lib.randomOptions(seed, base) };
    delete o.archetype;
    for (const d of lib.OPTIONS) if (L.has(d.group) && base[d.key] !== undefined) o[d.key] = base[d.key];
    if (base.n !== undefined) o.n = base.n;
    w.opts = o; w.preset = null;
  }
  // Season first: the weather and the time depend on it
  let s = seed;
  for (const g of ['Season', 'Sky', 'Time', 'Vegetation', 'Water', 'Camera']) {
    s = (Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1;
    if (!L.has(g)) Object.assign(w, rollGroup(w, g, s, lib, ctx));
  }
  return w;
}

// ── HASH ───────────────────────────────────────────────────────────────
function optBase(lib, preset) {
  const b = lib.defaults();
  if (preset && lib.PRESETS[preset]) Object.assign(b, lib.PRESETS[preset].opts);
  return b;
}
const encV = v => (typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'number' ? String(+v.toPrecision(6)) : String(v));

function optDiff(lib, opts, baseId) {
  const base = optBase(lib, baseId), diff = [];
  for (const d of lib.OPTIONS) {
    if (d.key === 'seed') continue;
    const v = opts[d.key];
    if (v === undefined || encV(v) === encV(base[d.key])) continue;
    diff.push(d.key + '_' + encodeURIComponent(encV(v)));
  }
  return diff;
}

export function encodeHash(world, lib) {
  const w = world, p = [];
  const seed = w.opts.seed ?? 1;
  p.push('s=' + seed);
  // p = the preset as is; else b = the preset (or none) nearest to the
  // options, so the diff stays short after a group dice
  let diff;
  if (w.preset && lib.PRESETS[w.preset]) { p.push('p=' + encodeURIComponent(w.preset)); diff = optDiff(lib, w.opts, w.preset); }
  else {
    let best = null;
    diff = optDiff(lib, w.opts, null);
    for (const id of Object.keys(lib.PRESETS)) {
      const d = optDiff(lib, w.opts, id);
      if (d.length < diff.length) { diff = d; best = id; }
    }
    if (best) p.push('b=' + encodeURIComponent(best));
  }
  if (diff.length) p.push('o=' + diff.join('~'));
  p.push('t=' + r3(w.tod).toFixed(3));
  if (w.playing === false) p.push('pl=0');
  p.push('w=' + encodeURIComponent(w.weather));
  p.push('se=' + r3(w.season));
  const v = w.veg || VEG0, q = w.water || WATER0;
  if (v.density !== VEG0.density || v.conifer !== VEG0.conifer || v.flowers !== VEG0.flowers) p.push('v=' + [v.density, v.conifer, v.flowers].map(r3).join('_'));
  if (q.tint !== WATER0.tint || q.waves !== WATER0.waves) p.push('wa=' + [q.tint, q.waves].map(r3).join('_'));
  if (w.cam) {
    const c = w.cam;
    const parts = c.kind === 'drone' ? ['d', c.path, c.pick | 0]
      : c.kind === 'fly' ? ['f', Math.round(c.x), Math.round(c.y), Math.round(c.z), r3(c.yaw), r3(c.pitch)]
        : ['o', c.yaw, c.pitch, c.distK, c.tx, c.tz].map(x => (typeof x === 'number' ? r3(x) : x));
    p.push('c=' + parts.join('_'));
  }
  return '#' + p.join('&');
}

export function decodeHash(hash, lib) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return null;
  const q = new Map();
  for (const part of h.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) q.set(part.slice(0, i), part.slice(i + 1));
  }
  if (!q.has('s') && !q.has('p') && !q.has('o')) return null;
  const known = k => (q.has(k) && lib.PRESETS[decodeURIComponent(q.get(k))] ? decodeURIComponent(q.get(k)) : null);
  const preset = known('p');
  const opts = optBase(lib, preset || known('b'));
  const defs = new Map(lib.OPTIONS.map(d => [d.key, d]));
  if (q.has('o') && q.get('o')) {
    for (const kv of q.get('o').split('~')) {
      const i = kv.indexOf('_');
      if (i < 1) continue;
      const k = kv.slice(0, i), raw = decodeURIComponent(kv.slice(i + 1)), d = defs.get(k);
      if (!d) continue;
      if (d.type === 'bool') opts[k] = raw === '1' || raw === 'true';
      else if (d.type === 'range') { const x = +raw; if (Number.isFinite(x)) opts[k] = clamp(x, d.min, d.max); }
      else { const c = d.choices.find(x => String(x) === raw); if (c !== undefined) opts[k] = c; }
    }
  }
  const seed = Math.round(+q.get('s'));
  if (Number.isFinite(seed) && seed >= 1) opts.seed = Math.min(999999, seed);
  const num = (k, d, a = 0, b = 1) => { const x = +q.get(k); return q.has(k) && Number.isFinite(x) ? clamp(x, a, b) : d; };
  const out = { opts, preset, tod: num('t', 0.3), playing: q.get('pl') !== '0', weather: q.has('w') ? decodeURIComponent(q.get('w')) : 'fair', season: num('se', 0.35) };
  if (q.has('v')) { const [a, b, c] = q.get('v').split('_').map(Number); out.veg = { density: clamp(a || 1, 0, 3), conifer: clamp(b ?? 0.5, 0, 1), flowers: clamp(c ?? 0.5, 0, 1) }; }
  if (q.has('wa')) { const [a, b] = q.get('wa').split('_').map(Number); out.water = { tint: clamp(a ?? 0.35, 0, 1), waves: clamp(b ?? 0.4, 0, 1) }; }
  if (q.has('c')) {
    const c = q.get('c').split('_');
    if (c[0] === 'd' && (c[1] === 'ridge' || c[1] === 'river')) out.cam = { kind: 'drone', path: c[1], pick: Math.max(0, Math.round(+c[2]) || 0) };
    else if (c[0] === 'o' && c.length >= 6 && c.slice(1).every(x => Number.isFinite(+x))) {
      out.cam = { kind: 'orbit', yaw: +c[1], pitch: clamp(+c[2], -1.5, 0.3), distK: clamp(+c[3], 0.02, 2), tx: clamp(+c[4], -0.5, 0.5), tz: clamp(+c[5], -0.5, 0.5) };
    } else if (c[0] === 'f' && c.length >= 6 && c.slice(1).every(x => Number.isFinite(+x))) {
      out.cam = { kind: 'fly', x: clamp(+c[1], -1e5, 1e5), y: clamp(+c[2], -1e3, 3e4), z: clamp(+c[3], -1e5, 1e5), yaw: +c[4], pitch: clamp(+c[5], -1.55, 1.55) };
    }
  }
  return out;
}

// ── HISTORY ────────────────────────────────────────────────────────────
export function createHistory(max = 30) {
  const list = [];
  let i = -1;
  return {
    push(h) {
      if (list[i] === h) return;
      list.splice(i + 1);
      list.push(h);
      if (list.length > max) list.shift();
      i = list.length - 1;
    },
    replace(h) { if (i >= 0) list[i] = h; else this.push(h); },
    back() { if (i > 0) i--; return list[i] ?? null; },
    forward() { if (i < list.length - 1) i++; return list[i] ?? null; },
    get canBack() { return i > 0; },
    get canForward() { return i < list.length - 1; },
    get current() { return list[i] ?? null; },
    get size() { return list.length; },
    get index() { return i; },
  };
}
