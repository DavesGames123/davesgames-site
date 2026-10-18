// ============================================================================
//  CORAL SPECIES  ·  species.js  ·  the species list, the growth pace, the
//  camera framing and the saver plan (DOM-free, node tests import it)
// ----------------------------------------------------------------------------
//  The species come from pages/coral-reef/reef.js SPECIES (read only), so a
//  new species there shows here with no change. One colony of the chosen
//  species grows ONCE from a seed on the rock (base.js). The page asks the
//  reef worker for cap / GROW_S particles per second, so a full colony
//  takes about GROW_S seconds at speed 1, whatever its size. When the
//  colony is full it stays; nothing here starts a new growth by itself.
//
//  grep -n targets
//    species list ......... "export const SPECIES_LIST"
//    colony size .......... "export function sizeFor"
//    growth rate .......... "export function rateFor"
//    age estimate ......... "export function ageYears"
//    colony stats ......... "export function colonyStats"
//    camera sample ........ "export function frameSample"
//    plate clear area ..... "export function saverClear"
//    saver plan ........... "export function saverPlan"
//    saver shot pose ...... "export function shotPose"
// ============================================================================
import { SPECIES, SPECIES_IDS } from '../coral-reef/reef.js';

export const GROW_S = 90;            // s for a full colony at speed 1 (the brief: 60 to 120 s)
export const SAVER_GROW_S = 55;      // s per colony in the saver
export const SAVER_HOLD_S = 9;       // s the full colony stays on screen before the next one
export const SAVER_GRADIENTS = ['reef', 'viridis', 'inferno', 'aurora', 'ice', 'magma', 'plasma', 'ember', 'turbo', 'spectral'];
export const SAVER_MODES = ['natural', 'age', 'age', 'depth', 'height', 'flow', 'light'];

// Typical linear extension (m per year), for the age of a colony of a height.
export const EXT_RATE = { staghorn: 0.12, fan: 0.03, table: 0.08, boulder: 0.008, finger: 0.025 };

export const SPECIES_LIST = SPECIES_IDS.map(id => ({ id, label: SPECIES[id].label, latin: SPECIES[id].latin, form: SPECIES[id].form }));

// A short name for the dock button.
export function shortName(id) {
  const s = SPECIES[id]; if (!s) return id;
  return s.label.replace(/ coral$/i, '').replace(/^Finger leather$/i, 'Finger');
}

// The colony size (m) in the size range of the species: u in 0..1.
export function sizeFor(id, u = 0.55) {
  const sp = SPECIES[id] || SPECIES[SPECIES_IDS[0]];
  return sp.size[0] + (sp.size[1] - sp.size[0]) * Math.min(1, Math.max(0, u));
}

// Particles per second so that cap particles take seconds (speed 1).
export function rateFor(cap, seconds = GROW_S) {
  return Math.max(2, (cap || 0) / Math.max(1, seconds));
}

// The age that a colony of height h (m) has at the typical extension rate.
export function ageYears(id, h) {
  return Math.max(0, h) / (EXT_RATE[id] || 0.05);
}
export function ageText(years) {
  if (years < 1) return `${Math.max(0, Math.round(years * 12))} months`;
  return `${years.toFixed(years < 10 ? 1 : 0)} years`;
}

// Height, width and the count of one colony k of a reef or a mirror.
export function colonyStats(reef, k = 0) {
  const c = reef && reef.colonies[k];
  if (!c) return { count: 0, height: 0, width: 0 };
  let top = c.base[1], x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  for (let g = 0; g < reef.count; g++) {
    if (reef.col[g] !== k) continue;
    n++;
    const x = reef.px[g], y = reef.py[g], z = reef.pz[g];
    if (y > top) top = y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { count: n, height: top - c.base[1], width: n ? Math.max(x1 - x0, z1 - z0) : 0 };
}

// The sample for lib/action-camera.js: up to max particles (a stride over
// the colony) and the seed point, weighted 3, so a young colony frames on
// the rock and not on a dot. The rock radius rr keeps a floor: the base
// stays in the frame.
export function frameSample(reef, base, max = 3000, out) {
  const n = reef ? reef.count : 0, st = Math.max(1, Math.ceil(n / max)), m = Math.ceil(n / st) + 4;
  const pos = out && out.pos && out.pos.length >= m * 3 ? out.pos : new Float32Array(m * 3);
  const mass = out && out.mass && out.mass.length >= m ? out.mass : new Float32Array(m);
  let k = 0;
  for (let g = 0; g < n; g += st, k++) { pos[k * 3] = reef.px[g]; pos[k * 3 + 1] = reef.py[g]; pos[k * 3 + 2] = reef.pz[g]; mass[k] = 1; }
  // the base: four points round the seed (the rock), so the frame holds it
  const rr = 0.55;
  for (let q = 0; q < 4; q++, k++) {
    const a = q * Math.PI / 2;
    pos[k * 3] = base[0] + Math.cos(a) * rr; pos[k * 3 + 1] = base[1] - 0.1; pos[k * 3 + 2] = base[2] + Math.sin(a) * rr; mass[k] = 3 + n / 400;
  }
  return { pos, mass, count: k };
}

// The clear area of the saver: the plateBand of lib/saver-clear.js
// ({ t, b, w } or null) in a frame of w x h. A plate column narrower than
// the frame (the 9:16 column on a wide screen) clears the sides too.
export function saverClear(band, w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (!band) { o.t = 0.16 * h; o.b = 0.22 * h; return o; }
  o.t = band.t; o.b = band.b;
  if (band.w && band.w < w - 2) { o.l = o.r = (w - band.w) / 2; }
  return o;
}

function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// The saver plan: n stages. Each stage is one species that grows once
// (grow s) and stays (hold s), then the next. Every species comes before
// a species comes again, and no species twice in a row. Each stage has
// its own seed, gradient, colour mode, current and a list of calm shots
// (each 8 to 12 s: an azimuth speed, an elevation and a zoom).
export function saverPlan(seed = 1, { n = 10, ids = SPECIES_IDS, grow = SAVER_GROW_S, hold = SAVER_HOLD_S, calm = 0.7 } = {}) {
  const rand = mulberry(seed);
  const order = [];
  let last = null;
  while (order.length < n) {
    const d = shuffle(ids.slice(), rand);
    if (d.length > 1 && d[0] === last) [d[0], d[1]] = [d[1], d[0]];
    for (const id of d) if (order.length < n) order.push(id);
    last = order[order.length - 1];
  }
  let g = -1;
  return order.map((id, i) => {
    let gi; do { gi = Math.floor(rand() * SAVER_GRADIENTS.length); } while (gi === g && SAVER_GRADIENTS.length > 1);
    g = gi;
    const total = grow + hold, shots = [];
    let t = 0, az = rand() * Math.PI * 2;
    const dir = rand() < 0.5 ? -1 : 1;
    while (t < total) {
      const len = 8 + rand() * 4;
      const spin = dir * (0.05 + 0.06 * rand()) * (1.2 - 0.5 * calm);   // rad/s: one turn in 60 to 140 s
      shots.push({ t0: t, len, az0: az, spin, elev: 0.12 + 0.42 * rand(), zoom: 0.9 + 0.35 * rand() });
      az += spin * len;
      t += len;
    }
    return {
      i, species: id, seed: ((seed * 1009 + i * 7919) >>> 0) || 1, gradient: SAVER_GRADIENTS[gi],
      reversed: rand() < 0.15, mode: SAVER_MODES[Math.floor(rand() * SAVER_MODES.length)],
      current: Math.floor(rand() * 360), grow, hold, total, shots,
    };
  });
}

// The camera pose of stage s at time t (s from its start): { az, elev,
// zoom, shot }. The angles are continuous across the shots (a shot starts
// at the azimuth where the last one ended); the elevation and the zoom
// ease to the new shot in its first 4 s, so the moves stay calm.
export function shotPose(stage, t) {
  const S = stage.shots;
  let i = 0;
  while (i < S.length - 1 && t >= S[i + 1].t0) i++;
  const s = S[i], p = S[Math.max(0, i - 1)];
  const u = Math.min(1, Math.max(0, (t - s.t0) / 4)), e = u * u * (3 - 2 * u);
  const tt = Math.max(0, t - s.t0);
  return { i, az: s.az0 + s.spin * tt, elev: p.elev + (s.elev - p.elev) * e, zoom: p.zoom + (s.zoom - p.zoom) * e, shot: s };
}

export { SPECIES, SPECIES_IDS };
