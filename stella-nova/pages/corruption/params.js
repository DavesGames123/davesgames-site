// ============================================================================
//  CORRUPTION  ·  params.js — the parameter schema, the seeded shuffle and the
//  uniform layout (no DOM, no GPU: node and Deno import it)
// ----------------------------------------------------------------------------
//  PARAMS is the one list of the look parameters. Each row gives the panel
//  section, the panel range, the default and the shuffle range. main.js makes
//  the panel from it, shuffle() draws a new set from it, and packUniforms()
//  writes the set into the GPU uniform block.
//
//  UNIFORM_FIELDS is the uniform block, in the order of struct U in
//  shaders/corruption.wgsl. tests.mjs reads the WGSL struct and compares.
//
//  GREP MAP
//    grep -n 'export const PARAMS'          the parameter rows
//    grep -n 'export const MODES'           the spread modes
//    grep -n 'export function shuffle'      a new random set from a seed
//    grep -n 'export function spreadAt'     the animated spread value
//    grep -n 'export const UNIFORM_FIELDS'  the uniform block layout
//    grep -n 'export function packUniforms' params + camera -> Float32Array
//    grep -n 'export function scenePoints'  tendril spines and shard poses
//    grep -n 'export function fitSrc'       the origin across a model change
// ============================================================================

// mulberry32: a small seeded generator, the same sequence on every engine
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [id, section, label, min, max, step, default, shuffleLo, shuffleHi, unit]
const ROWS = [
  ['spread',    'infect',    'Spread',            0,    1,    0.01,  0.44, 0.3,  0.7,  ''],
  ['pulse',     'infect',    'Pulse',             0,    1,    0.01,  0.25, 0,    0.8,  ''],
  ['edgeNoise', 'infect',    'Front noise',       0,    0.8,  0.01,  0.35, 0.1,  0.75, ''],
  ['noiseFreq', 'infect',    'Front detail',      0.5,  5,    0.05,  1.8,  0.8,  4.2,  ''],
  ['voxel',     'surface',   'Voxel size',        0.025, 0.16, 0.005, 0.06, 0.035, 0.12, 'm'],
  ['growth',    'surface',   'Crust growth',      0,    1,    0.01,  0.55, 0.15, 0.95, ''],
  ['holes',     'surface',   'Holes',             0,    0.7,  0.01,  0.18, 0,    0.5,  ''],
  ['jitter',    'surface',   'Stutter',           0,    1,    0.01,  0.3,  0,    0.9,  ''],
  ['char',      'surface',   'Char',              0,    1,    0.01,  0.85, 0.55, 1,    ''],
  ['cracks',    'surface',   'Cracks',            0,    1,    0.01,  0.6,  0.1,  1,    ''],
  ['sparks',    'surface',   'Red sparks',        0,    0.5,  0.005, 0.07, 0.02, 0.2,  ''],
  ['code',      'surface',   'Surface code',      0,    1,    0.01,  0.4,  0,    0.9,  ''],
  ['rim',       'glow',      'Front glow',        0,    8,    0.05,  3.2,  1.2,  6.5,  ''],
  ['rimWidth',  'glow',      'Front width',       0.01, 0.3,  0.005, 0.07, 0.03, 0.2,  'm'],
  ['hue',       'glow',      'Red shift',         -1,   1,    0.01,  0,    -0.45, 0.45, ''],
  ['bloom',     'glow',      'Bloom',             0,    1.5,  0.01,  0.55, 0.25, 1.1,  ''],
  ['parts',     'particles', 'Polyhedra',         0,    6000, 50,    1600, 500,  4000, ''],
  ['partSize',  'particles', 'Polyhedron size',   0.01, 0.09, 0.001, 0.028, 0.016, 0.05, 'm'],
  ['flow',      'particles', 'Flow',              0.1,  2,    0.01,  0.7,  0.3,  1.5,  ''],
  ['swarm',     'particles', 'Swarm',             0,    1,    0.01,  0.35, 0,    0.9,  ''],
  ['glyphs',    'particles', 'Zeros and ones',    0,    3000, 50,    700,  250,  1800, ''],
  ['glyphSize', 'particles', 'Digit size',        0.02, 0.14, 0.002, 0.05, 0.03, 0.09, 'm'],
  ['flip',      'particles', 'Bit flips',         0,    12,   0.1,   4,    0.5,  10,   '/s'],
  ['tendrils',  'sdf',       'Tendrils',          0,    6,    1,     3,    0,    6,    ''],
  ['reach',     'sdf',       'Tendril reach',     0.4,  3,    0.05,  1.7,  0.8,  2.6,  'm'],
  ['shards',    'sdf',       'Shards',            0,    8,    1,     4,    0,    8,    ''],
  ['studio',    'scene',     'Studio light',      0,    1.5,  0.01,  0.55, 0.3,  0.9,  ''],
  ['exposure',  'scene',     'Exposure',          0.4,  2.2,  0.01,  1.1,  0.9,  1.3,  ''],
];
export const PARAMS = ROWS.map(([id, section, label, min, max, step, def, lo, hi, unit]) =>
  ({ id, section, label, min, max, step, def, lo, hi, unit }));
export const PARAM = Object.fromEntries(PARAMS.map(p => [p.id, p]));
export const INT_PARAMS = new Set(['parts', 'glyphs', 'tendrils', 'shards']);

// spread over time: hold at the slider value, breathe round it, or sweep the
// whole model from clean to fully corrupt and back (an infection loop)
export const MODES = [
  { id: 'hold', label: 'Hold' },
  { id: 'breathe', label: 'Breathe' },
  { id: 'sweep', label: 'Sweep' },
];

export function defaults() {
  const o = {};
  for (const p of PARAMS) o[p.id] = p.def;
  o.mode = 'sweep';
  o.backdrop = 'void';
  o.src = [0.35, 1.2, 0.45];   // the infection origin, in model units
  return o;
}

const snap = (p, v) => {
  const q = Math.round((v - p.min) / p.step) * p.step + p.min;
  const r = Math.min(p.max, Math.max(p.min, q));
  return INT_PARAMS.has(p.id) ? Math.round(r) : +r.toFixed(4);
};
export const clampParam = (id, v) => snap(PARAM[id], v);

// shuffle(seed): a completely new set. Every row is drawn in its shuffle
// range; a few rows get a coin flip to an extreme so that sets differ in
// kind, not only in degree (no code, no tendrils, a full swarm, and so on).
export function shuffle(seed, bound = { c: [0, 1, 0], r: 1 }) {
  const r = rng(seed);
  const o = defaults();
  for (const p of PARAMS) o[p.id] = snap(p, p.lo + (p.hi - p.lo) * r());
  if (r() < 0.25) o.code = 0;
  if (r() < 0.2) o.tendrils = 0;
  if (r() < 0.2) o.swarm = snap(PARAM.swarm, 0.85 + 0.15 * r());
  if (r() < 0.3) o.holes = 0;
  o.mode = MODES[Math.floor(r() * MODES.length)].id;
  o.backdrop = r() < 0.6 ? 'void' : 'studio';
  // the origin: a point on a sphere round the model, kept above the floor
  const th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1);
  const d = bound.r * (0.55 + 0.35 * r());
  o.src = [bound.c[0] + d * Math.sin(ph) * Math.cos(th),
           Math.max(0.05, bound.c[1] + d * Math.cos(ph)),
           bound.c[2] + d * Math.sin(ph) * Math.sin(th)];
  return o;
}

// the spread value that the shader gets at time t (seconds)
export function spreadAt(P, t) {
  if (P.mode === 'hold') return P.spread;
  if (P.mode === 'breathe') return Math.min(1, Math.max(0, P.spread + 0.12 * Math.sin(t * 0.45)));
  const c = (t / 22) % 1;                          // 22 s per sweep
  const s = c < 0.75 ? c / 0.75 : 1 - (c - 0.75) / 0.25;
  return P.spread * (0.15 + 0.85 * s * s * (3 - 2 * s)) * 1.35;
}

// the red emissive colour, shifted toward crimson (<0) or orange (>0)
export function emissive(hue) {
  const h = hue * 0.05;                            // +-0.05 of a turn round red
  const c = k => 0.5 + 0.5 * Math.cos(2 * Math.PI * (h + k));
  const rgb = [c(0), c(-1 / 3), c(1 / 3)].map(v => v * v * v);
  const m = Math.max(...rgb);
  return rgb.map(v => v / m);
}

// ── the uniform block (struct U in shaders/corruption.wgsl) ────────────────
// [name, floats]. Every row is 4, 2+1+1 or 16 floats, so every field sits on
// its natural alignment and the WGSL struct has no hidden padding.
export const UNIFORM_FIELDS = [
  ['size', 2], ['time', 1], ['pixelScale', 1],
  ['ink', 4], ['tone', 4], ['cream', 4],
  ['exposure', 1], ['studio', 1], ['glow', 1], ['amount', 1],
  ['k', 4],          // x model kind (0 sdf, 1 mesh), y sdf model id, z backdrop (0 void, 1 studio), w sample count
  ['viewProj', 16],
  ['cam', 4],        // xyz camera position, w seed
  ['camR', 4],       // camera right, w aspect
  ['camU', 4],       // camera up, w tan(fov/2)
  ['camF', 4],       // camera forward, w principal point shift (ndc y)
  ['src', 4],        // xyz origin, w reach at spread 1
  ['shape', 4],      // voxel, front detail, front noise, rim width
  ['surf', 4],       // sparks, cracks, code, char
  ['grow', 4],       // growth, holes, stutter, pulse
  ['emis', 4],       // rgb red, w rim intensity
  ['sdfx', 4],       // tendrils, reach, shards, flow
  ['fx', 4],         // -, -, -, bloom (x, y, z unused: no screen-space effect)
  ['bound', 4],      // model centre xyz, radius
  ['part', 4],       // polyhedra, glyphs, polyhedron size, swarm
  ['part2', 4],      // digit size, flip rate, -, -
  ['mat', 4],        // mesh base colour rgb, w metalness
  ['mat2', 4],       // roughness, panel lines, -, -
  ['pick', 4],       // pick ray origin
  ['pickD', 4],      // pick ray direction
  ['pts', 208],      // tendril spines, tendril bounds, shard poses (scenePoints)
];
export const UNIFORM_FLOATS = UNIFORM_FIELDS.reduce((s, [, n]) => s + n, 0);
export const UNIFORM_OFFSET = (() => {
  const o = {}; let s = 0;
  for (const [n, k] of UNIFORM_FIELDS) { o[n] = s; s += k; }
  return o;
})();

// the reach of the infection at spread 1: past the far side of the model
export const reachFor = bound => bound.r * 2.0 + 0.3;

// packUniforms(P, view, extra) -> Float32Array. view = { w, h, pixelScale,
// viewProj (16), cam, camR, camU, camF, aspect, tanHalf }. extra = { time,
// amount, kind, sdfId, samples, bound, mat, mat2, seed, pick, pickD }.
export function packUniforms(P, view, x, out = new Float32Array(UNIFORM_FLOATS)) {
  const O = UNIFORM_OFFSET;
  const put = (name, arr) => { for (let i = 0; i < arr.length; i++) out[O[name] + i] = arr[i]; };
  const E = emissive(P.hue);
  put('size', [view.w, view.h]); out[O.time] = x.time; out[O.pixelScale] = view.pixelScale || 1;
  const studio = P.backdrop === 'studio';
  put('ink', studio ? [0.075, 0.085, 0.1, 1] : [0.02, 0.022, 0.03, 1]);
  put('tone', [0.25, 0.85, 0.95, 1]);
  put('cream', [1.0, 0.93, 0.84, 1]);
  out[O.exposure] = P.exposure; out[O.studio] = P.studio; out[O.glow] = P.bloom; out[O.amount] = x.amount;
  put('k', [x.kind, x.sdfId, studio ? 1 : 0, x.samples]);
  put('viewProj', view.viewProj);
  put('cam', [...view.cam, x.seed % 997]);
  put('camR', [...view.camR, view.aspect]);
  put('camU', [...view.camU, view.tanHalf]);
  put('camF', [...view.camF, view.shiftY || 0]);
  put('src', [...P.src, reachFor(x.bound)]);
  put('shape', [P.voxel, P.noiseFreq, P.edgeNoise, P.rimWidth]);
  put('surf', [P.sparks, P.cracks, P.code, P.char]);
  put('grow', [P.growth, P.holes, P.jitter, P.pulse]);
  put('emis', [...E, P.rim]);
  put('sdfx', [P.tendrils, P.reach, P.shards, P.flow]);
  put('fx', [0, 0, 0, P.bloom]);
  put('bound', [...x.bound.c, x.bound.r]);
  put('part', [P.parts, P.glyphs, P.partSize, P.swarm]);
  put('part2', [P.glyphSize, P.flip, 0, 0]);
  put('mat', x.mat || [0.6, 0.6, 0.62, 0.2]);
  put('mat2', x.mat2 || [0.4, 0, 0, 0]);
  put('pick', x.pick || [0, 0, 0, 0]);
  put('pickD', x.pickD || [0, 0, -1, 0]);
  put('pts', scenePoints(P, x.bound, x.time, x.amount, x.seed));
  return out;
}

// the SDF set pieces for the shader (u.pts, 52 vec4):
//   0..29   6 tendril spines x 5 points (xyz, capsule radius). Each one rises
//           from the deck round the model, sways, and curls in at the tip.
//   30..35  a bounding sphere per tendril (centre, radius)
//   36..51  8 shards x 2: (centre xyz, size), (yaw, pitch, kind 0..2, 0)
export function scenePoints(P, bound, time, amount, seed) {
  const out = new Array(208).fill(0);
  const r = rng((seed >>> 0) ^ 0x9e3779b9);
  const n = Math.max(1, P.tendrils);
  for (let i = 0; i < 6; i++) {
    const h = [r(), r(), r()];
    const ang = (i / n) * Math.PI * 2 + h[0] * 1.3;
    const br = bound.r * (0.95 + 0.6 * h[1]);
    const b = [bound.c[0] + Math.cos(ang) * br, -0.05, bound.c[2] + Math.sin(ang) * br];
    const H = P.reach * (0.6 + 0.5 * h[2]) * Math.min(1, Math.max(0, amount * 1.8));
    for (let s = 0; s < 5; s++) {
      const t = s / 4;
      const sw = 0.32 * t;
      const k = (i * 5 + s) * 4;
      out[k] = b[0] + Math.sin(t * 3 + time * 0.7 + h[0] * 6) * sw + (bound.c[0] - b[0]) * 0.4 * t * t;
      out[k + 1] = b[1] + H * t;
      out[k + 2] = b[2] + Math.cos(t * 2.3 + time * 0.6 + h[1] * 6) * sw + (bound.c[2] - b[2]) * 0.4 * t * t;
      out[k + 3] = 0.17 + (0.04 - 0.17) * t;
    }
    // the bound: the centre of the spine and the farthest point + radius
    const c = [0, 1, 2].map(j => { let a = 0; for (let s = 0; s < 5; s++) a += out[(i * 5 + s) * 4 + j]; return a / 5; });
    let rad = 0;
    for (let s = 0; s < 5; s++) { const k = (i * 5 + s) * 4; rad = Math.max(rad, Math.hypot(out[k] - c[0], out[k + 1] - c[1], out[k + 2] - c[2]) + out[k + 3]); }
    out.splice((30 + i) * 4, 4, c[0], c[1], c[2], rad + 0.02);
  }
  const sr = rng((seed >>> 0) ^ 0x51ed270b);
  const ns = Math.max(1, P.shards);
  for (let i = 0; i < 8; i++) {
    const h = [sr(), sr(), sr()];
    const a = time * 0.22 * (0.6 + h[0]) + (i * Math.PI * 2) / ns;
    const R = bound.r * (1.25 + 0.35 * h[1]);
    const k = (36 + i * 2) * 4;
    out[k] = bound.c[0] + Math.cos(a) * R;
    out[k + 1] = bound.c[1] + 0.25 + Math.sin(time * 0.5 + h[2] * 6) * 0.45 + (h[1] - 0.5) * 0.8;
    out[k + 2] = bound.c[2] + Math.sin(a) * R;
    out[k + 3] = 0.06 + 0.07 * h[2];
    out[k + 4] = time * (0.4 + h[2]); out[k + 5] = time * 0.3 + h[0] * 3; out[k + 6] = i % 3;
  }
  return out;
}

// keep the origin in the same place relative to the model: the offset from
// the old bound centre, in bound radii, goes onto the new bound
export function fitSrc(src, from, to) {
  return [0, 1, 2].map(i => to.c[i] + (src[i] - from.c[i]) / from.r * to.r).map((v, i) => (i === 1 ? Math.max(0.05, v) : v));
}

// the URL form of a set: only the seed and the model travel; edits after a
// shuffle stay local (the seed names a set, it does not store edits)
export function readQuery(search) {
  const q = new URLSearchParams(search || '');
  const seed = q.has('seed') ? (parseInt(q.get('seed'), 10) >>> 0) : null;
  return { seed, model: q.get('model') || null };
}
