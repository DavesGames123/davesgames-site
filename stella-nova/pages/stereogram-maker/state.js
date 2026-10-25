// ============================================================================
//  STEREOGRAM MAKER  ·  state.js — the page state and its link form (no DOM)
// ----------------------------------------------------------------------------
//  One plain object holds everything that makes a stereogram:
//    src   what gives the depth: kind 'model' | 'text' | 'shape' | 'depth'
//          | 'photo', and the fields of each kind, plus relief and lift
//    pat   what fills the picture: kind 'tile' | 'dots' | 'colour' |
//          'image', the tile id, the seed, the dot density, the palette
//    view  how to look at it: wall or cross, eye separation (cm), mu,
//          guide dots, smooth edges (oversample 2), size, turntable
//  encodeState writes the state as a short query string for the page hash
//  (the shell copies the page hash into its own URL, and lib/share-url.js
//  maps that to a share URL). decodeState reads it back, clamps every
//  number and keeps only known ids. An uploaded image never goes in the
//  link: a 'depth', 'photo' or 'image' state falls back to the defaults.
//
//  grep -n targets: "export const DEFAULT_STATE", "export function encodeState",
//                   "export function decodeState", "DOT_PALETTE_IDS"
// ============================================================================

export const DEFAULT_STATE = {
  src: { kind: 'model', id: '', yaw: 0, pitch: 0, fit: 0.82, text: 'Look closer', face: 'serif', shape: 'torus',
         invert: false, soft: 4, relief: 0.85, lift: 0.1, ref: '' },
  pat: { kind: 'tile', id: '', seed: 1, density: 0.5, palette: 0, ref: '' },
  view: { mode: 'wall', eyeSep: 6.35, mu: 0.3333, guides: true, smooth: true, size: 'fit', frames: 36, speed: 12, dot: 1 },
};

// The pattern-designer palettes (pages/pattern-designer/palettes.js) that
// the coloured dots offer, by id. Bright, distinct inks fuse best.
export const DOT_PALETTE_IDS = ['riso-fluor', 'process', 'clay', 'blueprint', 'riso-teal', 'terracotta', 'letterpress', 'newsprint', 'riso', 'carbon'];

export const FACES = ['serif', 'sans', 'bevel'];

export function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

const LIMITS = {
  yaw: [-180, 180], pitch: [-80, 80], fit: [0.4, 1], relief: [0.2, 1], lift: [0, 0.5], soft: [0, 12],
  seed: [1, 99999], density: [0.2, 0.8], palette: [0, DOT_PALETTE_IDS.length - 1],
  eyeSep: [4.5, 7.5], mu: [0.12, 0.45], frames: [12, 72], speed: [4, 24], dot: [1, 4],
};
const num = (v, k, d) => { const x = parseFloat(v); if (!Number.isFinite(x)) return d; const [a, b] = LIMITS[k]; return x < a ? a : x > b ? b : x; };
const r3 = x => Math.round(x * 1000) / 1000;

// The link form. Keys are short, so a link stays readable.
export function encodeState(s) {
  const q = new URLSearchParams();
  const k = s.src.kind === 'depth' || s.src.kind === 'photo' ? 'model' : s.src.kind;
  q.set('k', k);
  if (k === 'model') { q.set('m', s.src.id); q.set('y', r3(s.src.yaw)); q.set('p', r3(s.src.pitch)); q.set('f', r3(s.src.fit)); }
  if (k === 'text') { q.set('tx', s.src.text); q.set('tf', s.src.face); }
  if (k === 'shape') q.set('sh', s.src.shape);
  q.set('r', r3(s.src.relief)); q.set('l', r3(s.src.lift));
  const pk = s.pat.kind === 'image' ? 'tile' : s.pat.kind;
  q.set('pk', pk);
  if (pk === 'tile') q.set('t', s.pat.id);
  if (pk === 'dots') q.set('dn', r3(s.pat.density));
  if (pk === 'colour') q.set('pl', s.pat.palette);
  q.set('s', s.pat.seed);
  q.set('e', s.view.mode === 'cross' ? 'c' : 'w');
  q.set('es', r3(s.view.eyeSep)); q.set('mu', r3(s.view.mu));
  q.set('g', s.view.guides ? 1 : 0); q.set('o', s.view.smooth ? 1 : 0);
  q.set('z', s.view.size);
  if (s.view.dot > 1) q.set('d', s.view.dot);
  return q.toString();
}

// known: { models: Set, tiles: Set, shapes: Set, sizes: Set }. Returns null
// when the string holds no state (no 'k' key).
export function decodeState(str, known) {
  const q = new URLSearchParams(String(str || '').replace(/^#/, ''));
  if (!q.has('k')) return null;
  const s = cloneState(DEFAULT_STATE), g = key => q.get(key);
  const kind = g('k');
  if (kind === 'text') { s.src.kind = 'text'; s.src.text = String(g('tx') || s.src.text).slice(0, 24); if (FACES.includes(g('tf'))) s.src.face = g('tf'); }
  else if (kind === 'shape' && known.shapes.has(g('sh'))) { s.src.kind = 'shape'; s.src.shape = g('sh'); }
  else {
    s.src.kind = 'model';
    if (known.models.has(g('m'))) s.src.id = g('m');
    s.src.yaw = num(g('y'), 'yaw', 0); s.src.pitch = num(g('p'), 'pitch', 0); s.src.fit = num(g('f'), 'fit', s.src.fit);
  }
  s.src.relief = num(g('r'), 'relief', s.src.relief); s.src.lift = num(g('l'), 'lift', s.src.lift);
  const pk = g('pk');
  s.pat.kind = pk === 'dots' || pk === 'colour' ? pk : 'tile';
  if (known.tiles.has(g('t'))) s.pat.id = g('t');
  s.pat.density = num(g('dn'), 'density', s.pat.density);
  s.pat.palette = Math.round(num(g('pl'), 'palette', 0));
  s.pat.seed = Math.round(num(g('s'), 'seed', 1));
  s.view.mode = g('e') === 'c' ? 'cross' : 'wall';
  s.view.eyeSep = num(g('es'), 'eyeSep', s.view.eyeSep); s.view.mu = num(g('mu'), 'mu', s.view.mu);
  s.view.guides = g('g') !== '0'; s.view.smooth = g('o') !== '0';
  if (known.sizes.has(g('z'))) s.view.size = g('z');
  s.view.dot = Math.round(num(g('d'), 'dot', 1));
  return s;
}
