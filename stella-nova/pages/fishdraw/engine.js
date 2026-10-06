// ============================================================================
//  FISHDRAW  ·  engine.js — the shim around the upstream fishdraw.js
// ----------------------------------------------------------------------------
//  fishdraw by Lingdong Huang, 2021 (MIT, see LICENSE-fishdraw.txt).
//  https://github.com/LingDong-/fishdraw, commit a514372. The file
//  fishdraw.js in this folder is a byte-for-byte copy of the upstream file.
//  This module is our own code. It does not change the upstream file.
//
//  LOAD. fishdraw.js is a Node script with top-level functions and a global
//  PRNG state (let jsr). makeEngine(src) puts the source text in the body of
//  new Function() and adds a footer that returns the functions and two
//  accessors: setJsr() sets the PRNG state, and resetNoise() empties the
//  lazy Perlin table. Each engine has its own state, so the page, a worker
//  and a node test can each make one. The upstream guard
//  `typeof module != "undefined"` is false in a browser and in an ES module,
//  so the upstream CLI part does not run.
//
//  DETERMINISM. The upstream CLI runs one fish per process: it sets
//  jsr = str_to_seed(name), calls generate_params(), then fish(). The first
//  noise() call fills the Perlin table from rand(). drawFish() makes the
//  same sequence: setJsr, resetNoise, generate_params, fish, reframe,
//  cleanup. So a name with no edits gives the upstream polylines. With
//  edits, generate_params() still runs first, so the noise stream of the
//  fish stays the same and only the edited fields change the drawing.
//
//  No DOM here. The worker (worker.js), the saver and tests.mjs import it.
//
//  GREP MAP
//    grep -n 'export function makeEngine'   the new Function() shim
//    grep -n 'export function drawFish'     one fish, upstream order
//    grep -n 'export const PARAMS'          every field of generate_params()
//    grep -n 'export const GROUPS'          the panel groups
//    grep -n 'export function sanitize'     clamp, round, fin index order
//    grep -n 'export function mutate'       small random changes
//    grep -n 'export function randomName'   a binomen from a seed number
//    grep -n 'export function encodeShare'  the share link hash
//    grep -n 'export function decodeShare'  the share link hash, read
//    grep -n 'export function flatten'      polylines to typed arrays
//    grep -n 'export function upstreamCSV'  the upstream csv format
// ============================================================================

export const UPSTREAM = {
  name: 'fishdraw', author: 'Lingdong Huang', year: 2021, licence: 'MIT',
  url: 'https://github.com/LingDong-/fishdraw', commit: 'a514372',
};

// The names the footer exports from the upstream scope.
const EXPORTS = ['main', 'generate_params', 'default_params', 'fish', 'reframe', 'cleanup',
  'draw_svg', 'draw_svg_anim', 'draw_ps', 'binomen', 'str_to_seed', 'put_text'];

// ── makeEngine ──────────────────────────────────────────────────────────────
// src: the text of fishdraw.js. Returns the upstream functions plus setJsr,
// getJsr and resetNoise. The body is sloppy mode, as upstream expects.
export function makeEngine(src) {
  const footer = `\n;return {${EXPORTS.join(',')},` +
    'setJsr:function(v){jsr=v},getJsr:function(){return jsr},resetNoise:function(){perlin=null}};';
  // eslint-disable-next-line no-new-func
  return new Function(src + footer)();
}

// ── drawFish ────────────────────────────────────────────────────────────────
// E: an engine. name: the seed string (also the label). params: a full or
// partial params object, or null for the generated one. label: true draws
// "name." under the fish in the upstream Hershey letters.
// Returns { name, seed, base, params, polylines }. base is generate_params()
// for the name; params is what fish() drew with.
export function drawFish(E, name, params = null, label = true) {
  const seed = E.str_to_seed(name);
  E.setJsr(seed);
  E.resetNoise();
  const base = E.generate_params();
  const p = params ? sanitize(Object.assign({}, base, params)) : base;
  const drawing = E.fish(p);
  const polylines = E.cleanup(E.reframe(drawing, 20, label ? name + '.' : ''));
  return { name, seed, base, params: p, polylines };
}

// The generated params of a name, with no drawing.
export function baseParams(E, name) {
  E.setJsr(E.str_to_seed(name));
  E.resetNoise();
  return E.generate_params();
}

// ── PARAMS ──────────────────────────────────────────────────────────────────
// Every field of generate_params() and default_params(). kind: 'enum'
// (opts are the labels of 0, 1, ...), 'bool', 'int' or 'float'. min and
// max are the ranges of the upstream generator (rndtri bounds), so a slider
// stays in the shapes the engine was made for. step sets the rounding.
const E_ = (key, group, label, opts) => ({ key, group, label, kind: 'enum', opts, min: 0, max: opts.length - 1, step: 1 });
const B_ = (key, group, label) => ({ key, group, label, kind: 'bool', min: 0, max: 1, step: 1 });
const I_ = (key, group, label, min, max) => ({ key, group, label, kind: 'int', min, max, step: 1 });
const F_ = (key, group, label, min, max, step) => ({ key, group, label, kind: 'float', min, max, step });

export const GROUPS = [
  { id: 'body', label: 'Body' },
  { id: 'skin', label: 'Scales and pattern' },
  { id: 'dorsal', label: 'Dorsal fin' },
  { id: 'wing', label: 'Pectoral fin' },
  { id: 'pelvic', label: 'Pelvic fin' },
  { id: 'anal', label: 'Anal fin' },
  { id: 'tail', label: 'Tail and finlets' },
  { id: 'head', label: 'Head and jaw' },
  { id: 'eye', label: 'Eye' },
  { id: 'whisk', label: 'Barbels and teeth' },
];

export const PARAMS = [
  E_('body_curve_type', 'body', 'Profile', ['Sine', 'Bean']),
  F_('body_curve_amount', 'body', 'Curve', 0.5, 0.98, 0.01),
  F_('body_length', 'body', 'Length', 200, 420, 1),
  F_('body_height', 'body', 'Height', 45, 150, 1),

  E_('scale_type', 'skin', 'Scales', ['Diamond', 'Cycloid', 'Hatched', 'Smooth']),
  F_('scale_scale', 'skin', 'Scale size', 0.8, 1.5, 0.01),
  E_('pattern_type', 'skin', 'Pattern', ['None', 'Spots', 'Mottle', 'Bands', 'Speckle']),
  F_('pattern_scale', 'skin', 'Pattern size', 0.5, 2, 0.01),

  E_('dorsal_texture_type', 'dorsal', 'Rays', ['Fine', 'Spined']),
  E_('dorsal_type', 'dorsal', 'Shape', ['Rounded', 'Swept']),
  F_('dorsal_length', 'dorsal', 'Height', 30, 180, 1),
  I_('dorsal_start', 'dorsal', 'Start', 7, 16),
  I_('dorsal_end', 'dorsal', 'End', 19, 28),

  E_('wing_texture_type', 'wing', 'Rays', ['Fine', 'Spined']),
  E_('wing_type', 'wing', 'Shape', ['Rounded', 'Long']),
  F_('wing_length', 'wing', 'Length', 40, 350, 1),
  F_('wing_width', 'wing', 'Root width', 7, 50, 0.5),
  F_('wing_y', 'wing', 'Root height', 0.45, 0.85, 0.01),
  I_('wing_start', 'wing', 'Upper root', 5, 8),
  I_('wing_end', 'wing', 'Lower root', 5, 8),

  E_('pelvic_texture_type', 'pelvic', 'Rays', ['Fine', 'Spined']),
  E_('pelvic_type', 'pelvic', 'Shape', ['Rounded', 'Narrow']),
  F_('pelvic_length', 'pelvic', 'Length', 30, 140, 1),
  I_('pelvic_start', 'pelvic', 'Start', 7, 12),
  I_('pelvic_end', 'pelvic', 'End', 9, 15),

  E_('anal_texture_type', 'anal', 'Rays', ['Fine', 'Spined']),
  E_('anal_type', 'anal', 'Shape', ['Rounded', 'Swept']),
  F_('anal_length', 'anal', 'Length', 20, 80, 1),
  I_('anal_start', 'anal', 'Start', 16, 23),
  I_('anal_end', 'anal', 'End', 25, 30),

  E_('tail_type', 'tail', 'Tail', ['Wavy', 'Round', 'Forked', 'Notched', 'Swallow', 'Lunate']),
  F_('tail_length', 'tail', 'Tail length', 50, 180, 1),
  E_('finlet_type', 'tail', 'Finlets', ['None', 'Finlets', 'Adipose', 'Second dorsal']),

  E_('neck_type', 'head', 'Gill line', ['Forward', 'Back']),
  F_('nose_height', 'head', 'Snout height', -50, 35, 0.5),
  F_('head_length', 'head', 'Snout length', 20, 35, 0.1),
  I_('head_texture_amount', 'head', 'Head lines', 30, 160),
  I_('mouth_size', 'head', 'Mouth', 6, 11),
  F_('jaw_size', 'head', 'Jaw size', 0.7, 1.4, 0.01),
  F_('jaw_open', 'head', 'Jaw open', 0, 1.5, 0.01),

  E_('eye_type', 'eye', 'Eye', ['Plain', 'Ringed']),
  F_('eye_size', 'eye', 'Eye size', 8, 28, 0.1),

  B_('has_moustache', 'whisk', 'Upper barbels'),
  I_('moustache_length', 'whisk', 'Upper length', 10, 40),
  B_('has_beard', 'whisk', 'Chin barbels'),
  I_('beard_length', 'whisk', 'Chin length', 20, 50),
  B_('has_teeth', 'whisk', 'Teeth'),
  F_('teeth_length', 'whisk', 'Tooth length', 5, 15, 0.1),
  F_('teeth_space', 'whisk', 'Tooth gap', 3, 6, 0.05),
];
export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map(d => [d.key, d]));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Round v to the decimals of step (4 at most), so a share link holds it.
export function roundTo(v, step) {
  const d = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  return +(+v).toFixed(d);
}

// ── sanitize ────────────────────────────────────────────────────────────────
// Clamps each known field to a safe range, rounds int, enum and bool
// fields, and keeps each fin end at least two points after its start (the
// engine slices the body curve from start to end). Float fields keep their
// value when they are in range, so generated params pass through unchanged.
export function sanitize(p) {
  const o = Object.assign({}, p);
  for (const d of PARAMS) {
    let v = +o[d.key];
    if (!Number.isFinite(v)) continue;
    if (d.kind === 'float') {
      // The upstream generator stays in [min, max]; a hand edit may go a
      // little past, never far.
      const span = d.max - d.min;
      o[d.key] = clamp(v, d.min - span * 0.25, d.max + span * 0.25);
    } else {
      o[d.key] = clamp(Math.round(v), d.min, d.max);
    }
  }
  if (o.nose_height != null) o.nose_height = clamp(o.nose_height, -60, 45);
  if (o.dorsal_end - o.dorsal_start < 3) o.dorsal_end = Math.min(28, o.dorsal_start + 3);
  if (o.pelvic_end - o.pelvic_start < 2) o.pelvic_end = Math.min(15, o.pelvic_start + 2);
  if (o.anal_end - o.anal_start < 3) o.anal_end = Math.min(30, o.anal_start + 3);
  return o;
}

// ── random helpers ──────────────────────────────────────────────────────────
// mulberry32: a small seeded PRNG for our own choices (the engine has its
// own xorshift in fishdraw.js).
export function mulberry(a) {
  a >>>= 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// FNV-1a of a string, for cache keys and seed mixing.
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── randomName ──────────────────────────────────────────────────────────────
// The upstream binomen() from a PRNG state. Upstream main() seeds it with
// ~~(Math.random()*10000); any nonzero 32-bit number works.
export function randomName(E, n) {
  E.setJsr((n >>> 0) || 0x5EED);
  return E.binomen();
}
// A relative: the genus of base and a new species name from n.
export function relativeName(E, base, n) {
  const genus = String(base).split(/\s+/)[0] || 'Pisces';
  const sp = randomName(E, n).split(/\s+/)[1] || 'novus';
  return genus + ' ' + sp;
}

// ── mutate ──────────────────────────────────────────────────────────────────
// spread 0..1. Each field takes part with chance 0.3 + spread, so a small
// mutation changes a few fields. A numeric field moves by a normal step of
// spread * range / 2.
// An enum field changes with chance spread * 0.35, a bool with spread * 0.2.
// Locked keys (a Set) do not change. Returns sanitized, rounded params.
export function mutate(p, spread, rnd, locked = null) {
  const o = Object.assign({}, p);
  for (const d of PARAMS) {
    if (locked && locked.has(d.key)) continue;
    if (rnd() > 0.3 + spread) continue;
    const v = +o[d.key];
    if (d.kind === 'float' || d.kind === 'int') {
      const nv = clamp(v + gauss(rnd) * spread * (d.max - d.min) * 0.5, d.min, d.max);
      o[d.key] = roundTo(nv, d.step);
    } else if (d.kind === 'enum') {
      if (rnd() < spread * 0.35) o[d.key] = Math.floor(rnd() * d.opts.length);
    } else if (rnd() < spread * 0.2) o[d.key] = v ? 0 : 1;
  }
  return sanitize(o);
}

// Copies the fields of one group from fresh into p, except locked keys.
export function takeGroup(p, fresh, group, locked = null) {
  const o = Object.assign({}, p);
  for (const d of PARAMS) if (d.group === group && !(locked && locked.has(d.key))) o[d.key] = fresh[d.key];
  return sanitize(o);
}
// Copies the locked keys of keep into p.
export function applyLocks(p, keep, locked) {
  if (!locked || !locked.size) return p;
  const o = Object.assign({}, p);
  for (const k of locked) if (k in keep) o[k] = keep[k];
  return sanitize(o);
}
// Linear blend of two params objects: floats and ints blend, enums and
// bools switch at t = 0.5.
export function blendParams(a, b, t) {
  if (t <= 0) return sanitize(a);
  if (t >= 1) return sanitize(b);
  const o = Object.assign({}, a);
  for (const d of PARAMS) {
    const x = +a[d.key], y = +b[d.key];
    if (d.kind === 'float') o[d.key] = roundTo(x + (y - x) * t, d.step);
    else if (d.kind === 'int') o[d.key] = Math.round(x + (y - x) * t);
    else o[d.key] = t < 0.5 ? x : y;
  }
  return sanitize(o);
}

// The fields of p that differ from base. The page rounds each edit to the
// step of its field (slider, mutate), so the rounded value is exact.
export function diffParams(p, base) {
  const o = {};
  for (const d of PARAMS) {
    if (!(d.key in p) || +p[d.key] === +base[d.key]) continue;
    o[d.key] = roundTo(p[d.key], d.kind === 'float' ? Math.min(d.step, 0.0001) : 1);
  }
  return o;
}

// ── share link ──────────────────────────────────────────────────────────────
// The hash holds a URLSearchParams string. f is the fish name; p the
// changed fields as key:value pairs with a comma between them. Other keys
// (mode, grid, theme, page) pass through as strings.
//   #f=Xipola+nare&p=body_length:312,eye_type:1&m=single&t=cream
export function encodeShare(state) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (v == null || v === '') continue;
    if (k === 'p') {
      const s = Object.entries(v).filter(([key]) => PARAM_BY_KEY[key]).map(([key, x]) => key + ':' + x).join(',');
      if (s) q.set('p', s);
    } else q.set(k, String(v));
  }
  return q.toString();
}
export function decodeShare(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const out = {};
  for (const [k, v] of q) {
    if (k === 'p') {
      const p = {};
      for (const pair of v.split(',')) {
        const [key, x] = pair.split(':');
        if (PARAM_BY_KEY[key] && x !== undefined && Number.isFinite(+x)) p[key] = +x;
      }
      out.p = p;
    } else out[k] = v;
  }
  return out;
}

// ── flat arrays ─────────────────────────────────────────────────────────────
// polylines [[[x,y],..],..] to { xy: Float64Array, offs: Uint32Array,
// lens: Float64Array (length of each polyline), total, bbox }.
// offs[i] is the first point index of polyline i; offs[n] = point count.
export function flatten(polylines) {
  let n = 0;
  for (const pl of polylines) n += pl.length;
  const xy = new Float64Array(n * 2), offs = new Uint32Array(polylines.length + 1), lens = new Float64Array(polylines.length);
  let k = 0, total = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  polylines.forEach((pl, i) => {
    offs[i] = k;
    let L = 0;
    for (let j = 0; j < pl.length; j++) {
      const x = pl[j][0], y = pl[j][1];
      xy[k * 2] = x; xy[k * 2 + 1] = y; k++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (j) L += Math.hypot(x - pl[j - 1][0], y - pl[j - 1][1]);
    }
    lens[i] = L; total += L;
  });
  offs[polylines.length] = k;
  return { xy, offs, lens, total, bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
export function unflatten(f) {
  const out = [];
  for (let i = 0; i + 1 < f.offs.length; i++) {
    const pl = [];
    for (let k = f.offs[i]; k < f.offs[i + 1]; k++) pl.push([f.xy[k * 2], f.xy[k * 2 + 1]]);
    out.push(pl);
  }
  return out;
}

// ── upstream text formats ───────────────────────────────────────────────────
// The same strings as the upstream CLI: --format json and --format csv.
export function upstreamJSON(polylines) { return JSON.stringify(polylines); }
export function upstreamCSV(polylines) { return polylines.map(x => x.flat().join(',')).join('\n'); }
// The upstream --speed n sets speed = 0.005 / n seconds per unit.
export function smilSpeed(unitsPerSecond) { return 1 / Math.max(1, unitsPerSecond); }
