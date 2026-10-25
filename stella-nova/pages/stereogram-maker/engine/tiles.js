// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/tiles.js — seamless pattern tiles
// ----------------------------------------------------------------------------
//  The tiles come from the pattern-designer engine (read-only import of
//  ../../pattern-designer/). A tile is the pattern on a square board of
//  1000 x 1000 design units, drawn with export.js drawItems on Raster2D.
//
//  WRAP. A stereogram repeats its tile across and down, so the tile must
//  wrap with no seam. On a square board most grid and tiling patterns
//  already wrap: their cells divide the board, and a motif that crosses
//  a cell edge meets its neighbour at fixed points. Those tiles have
//  wrap 'native'. Patterns that do not wrap (flows, radial and organic
//  forms) are drawn at half size and mirrored 2x2, so each edge meets its
//  own mirror image. Those tiles have wrap 'mirror'. The TILES table
//  holds the wrap mode measured at 128 px. At draw time a native tile is
//  measured again and mirrored when it has a seam at that size (the
//  returned wrap field says which). engine/tests.mjs checks every tile.
//
//  seamError(img) = the mean colour step across the wrap edges divided
//  by the mean step between neighbour pixels inside the tile. A value
//  near 1 or less means that the wrap edge looks like any other column.
//
//  grep -n targets: "export const TILES", "export function tilesFromPatterns",
//                   "export function seamError", "function drawPattern",
//                   "function dotTile"
// ============================================================================
import { byId } from '../../pattern-designer/patterns/index.js';
import { run, defaults } from '../../pattern-designer/engine.js';
import { PALETTES } from '../../pattern-designer/palettes.js';
import { drawItems, applyMode } from '../../pattern-designer/export.js';
import { Raster2D } from './raster2d.js';
import { hash3, DOT_PALETTE } from './sirds.js';

// One pick: the pattern, the palette, the density D (density.js; below 1
// opens up line patterns for a tile of about 128 px), the style mode
// (export.js applyMode) and slider values. The wrap mode is measured
// once (tools: engine/tests.mjs prints it) and written in WRAP.
const palById = id => PALETTES.find(p => p.id === id) || PALETTES[0];
const T = (pattern, palette, D = 1, mode = 'auto', params = null) => ({ pattern, palette, D, mode, params });
const PICKS = [
  // grid
  T('arc-lattice', 'riso-teal', 0.8), T('split-squares', 'midcentury'), T('running-bond', 'terracotta'),
  T('dot-interference', 'cobalt', 0.6), T('basket-weave', 'clay'), T('module-grid', 'primaries'),
  T('plus-field', 'synth', 0.7),
  // flow
  T('curl-streams', 'tide', 0.6), T('flow-ribbons', 'aurora', 0.6), T('contour-bands', 'ochre'),
  T('vortex-lines', 'ember', 0.5), T('field-hairs', 'moss', 0.5), T('topo-lines', 'slate', 0.5),
  // radial, noise
  T('phase-rings', 'magma', 0.6), T('pursuit-polygons', 'citrus', 1.2), T('screen-dots', 'process', 0.6),
  T('tone-hatch', 'sepia', 0.5), T('signal-bars', 'swiss'),
  // isometric
  T('cube-stacks', 'deco', 0.7), T('terraces', 'dune', 0.7), T('iso-relief', 'glacier', 0.7),
  T('tumbling-blocks', 'nouveau'), T('iso-towers', 'eighties', 0.7),
  // distortion
  T('lens-grid', 'safe-vibrant', 0.6), T('twirl-checker', 'gold-black'), T('sine-stripes', 'lagoon', 0.7),
  T('pulled-dots', 'berry', 0.7), T('bound-rings', 'seventies'),
  // organic, physics
  T('morphogen', 'malachite'), T('soft-cells', 'coral-reef', 0.8), T('lava-blobs', 'sorbet'),
  T('circle-pack', 'okabe-dark', 1.3), T('coral-reach', 'kelp', 0.8),
  // tilings
  T('rhomb-inflation', 'lapis', 0.8), T('nested-truchet', 'riso'), T('mirror-truchet', 'red-duo'),
  T('diagonal-paths', 'blueprint', 0.7), T('hex-arcs', 'neon', 0.6), T('triangle-wang', 'woodblock'),
  T('star-rosettes', 'victorian', 0.8), T('cairo-tiles', 'pistachio'), T('herringbone', 'carbon'),
  // textile
  T('sett-plaid', 'forest-floor'), T('bled-bands', 'indigo-duo'), T('twill-check', 'rust'),
  T('flame-chevron', 'tangerine'), T('diamond-overcheck', 'harbour'),
  // op art, paths, meshes
  T('turning-squares', 'electric', 0.7), T('wave-bands', 'acid'), T('maze-walls', 'chalk', 0.7),
  T('delaunay-mesh', 'arcade', 0.7), T('lead-glass', 'safe-bright'), T('rect-split', 'signal'),
  T('crackle', 'basalt', 0.7),
];
// Measured wrap modes (seamError < 1.6 on the square board: 'native').
const WRAP = {
  'arc-lattice': 'native', 'split-squares': 'mirror', 'running-bond': 'mirror',
  'dot-interference': 'native', 'basket-weave': 'mirror', 'module-grid': 'mirror',
  'plus-field': 'native', 'curl-streams': 'mirror', 'flow-ribbons': 'mirror',
  'contour-bands': 'mirror', 'vortex-lines': 'mirror', 'field-hairs': 'mirror',
  'topo-lines': 'mirror', 'phase-rings': 'mirror', 'pursuit-polygons': 'mirror',
  'screen-dots': 'mirror', 'tone-hatch': 'mirror', 'signal-bars': 'native',
  'cube-stacks': 'native', 'terraces': 'native', 'iso-relief': 'mirror',
  'tumbling-blocks': 'mirror', 'iso-towers': 'mirror', 'lens-grid': 'native',
  'twirl-checker': 'mirror', 'sine-stripes': 'native', 'pulled-dots': 'native',
  'bound-rings': 'native', 'morphogen': 'native', 'soft-cells': 'mirror', 'lava-blobs': 'mirror',
  'circle-pack': 'native', 'coral-reach': 'native', 'rhomb-inflation': 'mirror',
  'nested-truchet': 'mirror', 'mirror-truchet': 'mirror', 'diagonal-paths': 'mirror',
  'hex-arcs': 'mirror', 'triangle-wang': 'mirror', 'star-rosettes': 'mirror',
  'cairo-tiles': 'mirror', 'herringbone': 'mirror', 'sett-plaid': 'native',
  'bled-bands': 'mirror', 'twill-check': 'native', 'flame-chevron': 'mirror',
  'diamond-overcheck': 'mirror', 'turning-squares': 'native', 'wave-bands': 'mirror',
  'maze-walls': 'mirror', 'delaunay-mesh': 'native', 'lead-glass': 'mirror',
  'rect-split': 'native', 'crackle': 'native',
};

const FAM_NAME = { grid: 'Grid', flow: 'Flow', radial: 'Radial', texture: 'Noise', iso: 'Isometric', distort: 'Distortion', organic: 'Organic', physics: 'Physics', geometric: 'Geometric', opart: 'Op art', botanical: 'Botanical', paths: 'Paths and mazes', mesh: 'Cells and meshes', textile: 'Textile', tiling: 'Tilings' };
export const TILES = PICKS.filter(p => byId(p.pattern)).map(p => {
  const pat = byId(p.pattern);
  return { id: 'pd-' + p.pattern, name: pat.name, family: pat.family, familyName: FAM_NAME[pat.family] || pat.family, pattern: p.pattern, palette: palById(p.palette).id, D: p.D, mode: p.mode, params: p.params, wrap: WRAP[p.pattern] || null };
});


// Draw one pattern on a square of n px. Returns an Image.
function drawPattern(pick, n, seed) {
  const pat = byId(pick.pattern);
  if (!pat) throw new Error('tiles: unknown pattern ' + pick.pattern);
  const P = Object.assign(defaults(pat), pick.params || {});
  const r = run(pat, P, seed, 1000, 1000, undefined, pick.D && pick.D !== 1 ? { D: pick.D } : null);
  const items = applyMode(r.items, pick.mode || 'auto');
  const g = new Raster2D(n, n), pal = palById(pick.palette);
  g.fillStyle = pal.bg; g.fillRect(0, 0, n, n);
  g.setTransform(n / 1000, 0, 0, n / 1000, 0, 0);
  drawItems(g, items, { palette: pal, lw: Math.max(2, 1.0 * 1000 / n) });
  return { w: n, h: n, data: g.data };
}

// Mirror an Image 2x2 into a tile twice its size.
function mirror2(img) {
  const { w, h } = img, W = 2 * w, H = 2 * h, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x < w ? x : W - 1 - x, sy = y < h ? y : H - 1 - y, i = 4 * (y * W + x), j = 4 * (sy * w + sx);
    d[i] = img.data[j]; d[i + 1] = img.data[j + 1]; d[i + 2] = img.data[j + 2]; d[i + 3] = 255;
  }
  return { w: W, h: H, data: d };
}
// Nearest-neighbour resize (used to stretch a square tile to w x h).
function resize(img, w, h) {
  if (img.w === w && img.h === h) return img;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = 4 * (Math.min(img.h - 1, Math.floor((y + 0.5) * img.h / h)) * img.w + Math.min(img.w - 1, Math.floor((x + 0.5) * img.w / w))), i = 4 * (y * w + x);
    d[i] = img.data[j]; d[i + 1] = img.data[j + 1]; d[i + 2] = img.data[j + 2]; d[i + 3] = 255;
  }
  return { w, h, data: d };
}

export function seamError(img) {
  const { w, h, data: d } = img;
  const diff = (i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
  let seam = 0, inner = 0, ns = 0, ni = 0;
  for (let y = 0; y < h; y++) {
    seam += diff(4 * (y * w + w - 1), 4 * (y * w)); ns++;
    for (let x = 0; x < w - 1; x++) { inner += diff(4 * (y * w + x), 4 * (y * w + x + 1)); ni++; }
  }
  for (let x = 0; x < w; x++) {
    seam += diff(4 * ((h - 1) * w + x), 4 * x); ns++;
    for (let y = 0; y < h - 1; y++) { inner += diff(4 * (y * w + x), 4 * ((y + 1) * w + x)); ni++; }
  }
  return (seam / ns) / Math.max(1e-6, inner / ni);
}

// Dot and noise tiles (family 'dots').
function dotTile(kind, w, h, seed) {
  const d = new Uint8ClampedArray(w * h * 4), pal = DOT_PALETTE.map(c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; });
  // Value noise on a lattice that wraps at the tile size.
  const cell = Math.max(2, Math.round(Math.min(w, h) / 12)), gx = Math.max(1, Math.round(w / cell)), gy = Math.max(1, Math.round(h / cell));
  const lat = (i, j, s) => hash3(((i % gx) + gx) % gx, ((j % gy) + gy) % gy, seed + s) / 4294967296;
  const vn = (x, y, s) => {
    const u = x / w * gx, v = y / h * gy, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = fu * fu * (3 - 2 * fu), b = fv * fv * (3 - 2 * fv);
    return (lat(i, j, s) * (1 - a) + lat(i + 1, j, s) * a) * (1 - b) + (lat(i, j + 1, s) * (1 - a) + lat(i + 1, j + 1, s) * a) * b;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x), r = hash3(x, y, seed);
    let c;
    if (kind === 'dots-bw') { const v = r & 1 ? 0 : 255; c = [v, v, v]; }
    else if (kind === 'dots-color') c = pal[r % pal.length];
    else if (kind === 'noise-gray') { const v = 255 * (0.65 * vn(x, y, 1) + 0.35 * (r / 4294967296)); c = [v, v, v]; }
    else if (kind === 'noise-color') { const t = vn(x, y, 1), k = Math.floor(t * pal.length * 0.999), q = 0.6 + 0.4 * (r / 4294967296); c = pal[k].map(v => v * q); }
    else { const v = vn(x, y, 1) > 0.5 ? 30 : 230; const q = (r / 4294967296) * 40; c = [v + q, v * 0.9 + q, v * 0.7 + q]; }
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return { w, h, data: d };
}
export const DOT_TILES = [
  { id: 'dots-bw', name: 'Random dots', family: 'dots', wrap: 'native' },
  { id: 'dots-color', name: 'Coloured dots', family: 'dots', wrap: 'native' },
  { id: 'noise-gray', name: 'Grey noise', family: 'dots', wrap: 'native' },
  { id: 'noise-color', name: 'Colour noise', family: 'dots', wrap: 'native' },
  { id: 'noise-blots', name: 'Ink blots', family: 'dots', wrap: 'native' },
];

// The tiles for a list of ids. size: px (a number) or { w, h }.
// An id is a TILES id ('pd-...'), a DOT_TILES id, or a bare pattern id
// (then the wrap mode is measured with seamError).
export function tilesFromPatterns(ids, size = 128, seed = 1) {
  const w = Math.max(8, Math.round(typeof size === 'number' ? size : size.w)), h = Math.max(8, Math.round(typeof size === 'number' ? size : size.h || size.w));
  const n = Math.max(w, h);
  return (ids || TILES.map(t => t.id)).map(id => {
    const dot = DOT_TILES.find(t => t.id === id);
    if (dot) return Object.assign(dotTile(id, w, h, seed), { id, name: dot.name, family: 'dots', wrap: 'native' });
    let rec = TILES.find(t => t.id === id);
    if (!rec) {
      const pid = String(id).replace(/^pd-/, ''), pat = byId(pid);
      if (!pat) throw new Error('tilesFromPatterns: unknown id ' + id);
      rec = { id: 'pd-' + pid, name: pat.name, family: pat.family, pattern: pid, palette: 'bone', wrap: null, mode: 'auto' };
    }
    let img;
    let wrap = rec.wrap;
    if (!wrap) { img = drawPattern(rec, n, seed); wrap = seamError(img) < 1.6 ? 'native' : 'mirror'; if (wrap === 'mirror') img = null; }
    if (!img && wrap === 'native') {
      // A native tile can get a seam at a size where the cells round to
      // a different count. Measure it, and mirror when it is visible.
      img = drawPattern(rec, n, seed);
      if (seamError(img) >= 1.6) { img = null; wrap = 'mirror'; }
    }
    if (!img) img = mirror2(drawPattern(rec, Math.ceil(n / 2), seed));
    img = resize(img, w, h);
    return Object.assign(img, { id: rec.id, name: rec.name, family: rec.family, wrap });
  });
}
