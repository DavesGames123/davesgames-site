// ============================================================================
//  NEBULA  ·  look.js — the look state of the page: shuffle, palette, history
// ----------------------------------------------------------------------------
//  A look is one full composition object. createLook(base) keeps the base
//  composition, the relative values of each shuffle group (rel) and a master
//  seed, and derive(base, rel) of engine/look/shuffle.js makes the look.
//  Randomness picks parameter values only (the engine rule).
//
//  The page shuffles every group of the engine look space except two:
//    overlay   the route map of the star map artifact, which this page drops
//    exposure  kept, but its "fog of intel" switch is forced off (the fog
//              needs the map coverage)
//
//  Palettes. PALETTE_INFO names each engine palette for people. swatch(name)
//  gives five sRGB colours of the palette (the He, H, Front, PAH and H2
//  channels, each scaled to a peak of 1) for the palette buttons.
//
//  No DOM and no GL here, so tests.mjs runs it in node.
//
//  grep -n targets: "export function createLook", "export const PALETTE_INFO",
//                   "export function swatch", "function shuffleAll",
//                   "function setPalette", "function fromQuery"
// ============================================================================
import {
  GROUPS, drawGroup, derive, check, groupSeedOf, nextMaster, defaultsOf, withPalette,
  PALETTES_REAL, PALETTES_FANTASY, toHex,
} from './engine/look/shuffle.js';

// Groups that a full shuffle draws, in the engine group order (the seed stream
// of each group is its index in GROUPS, so a master seed gives the same look
// on every machine).
export const SHUFFLE_GROUPS = GROUPS.filter((g) => g !== 'overlay');

// Names for people. kind: 'real' (from a real filter set) or 'fantasy'.
export const PALETTE_INFO = {
  nircam: { name: 'Webb', kind: 'real', note: 'JWST NIRCam near-infrared' },
  hubble: { name: 'Hubble', kind: 'real', note: 'the Hubble palette, gold and teal' },
  hoo: { name: 'Red + teal', kind: 'real', note: 'H-alpha and O III bicolour' },
  bicolour: { name: 'Bicolour', kind: 'real', note: 'a soft two-filter blend' },
  miri: { name: 'Mid-IR', kind: 'real', note: 'JWST MIRI: warm dust carries the colour' },
  sho: { name: 'Raw SHO', kind: 'real', note: 'S II, H-alpha, O III mapped straight to RGB' },
  aurora: { name: 'Aurora', kind: 'fantasy', note: 'green and violet' },
  ember: { name: 'Ember', kind: 'fantasy', note: 'fire and gold' },
  abyss: { name: 'Abyss', kind: 'fantasy', note: 'deep blues' },
  orchid: { name: 'Orchid', kind: 'fantasy', note: 'magenta and lilac' },
  verdigris: { name: 'Verdigris', kind: 'fantasy', note: 'copper green and rust' },
  prism: { name: 'Prism', kind: 'fantasy', note: 'every hue at once' },
};
export const PALETTE_ORDER = [...PALETTES_REAL, 'sho', ...PALETTES_FANTASY].filter((n) => PALETTE_INFO[n]);

const enc = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const hex2 = (v) => Math.round(255 * Math.min(1, Math.max(0, v))).toString(16).padStart(2, '0');

// swatch(base, name) -> ['#rrggbb' x 5]: the He, H, Front, PAH, H2 colours.
export function swatch(base, name) {
  const c = withPalette(base, name);
  const pal = c.palette && c.palette[name];
  if (!pal) return [];
  return ['He', 'H', 'Front', 'PAH', 'H2'].filter((k) => pal[k]).map((k) => {
    const v = pal[k], m = Math.max(1e-6, ...v);
    return '#' + v.map((x) => hex2(enc(x / m))).join('');
  });
}

const randomSeed = () => {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; } catch (e) { return (Math.random() * 4294967296) >>> 0; }
};

// createLook(base, { master }) -> the look state
//   comp()            the current composition
//   paletteName()     the palette of the current look
//   shuffleAll()      a new nebula: every group of SHUFFLE_GROUPS from the next master seed
//   shufflePalette()  a new palette and trim only (stage P on a live bake)
//   setPalette(name)  one named palette, the trims of the look stay
//   back()            the look before the last change (false when there is none)
//   reset()           the base composition
//   code()            a short text for a link: master seed and palette
//   fromQuery(q)      a look from ?look=<hex>&pal=<name>; false when q has neither
export function createLook(base, opts = {}) {
  let master = opts.master != null ? opts.master >>> 0 : randomSeed();
  let rel = {};
  let palSeed = master ^ 0x9e3779b9;
  const hist = [];
  const push = () => { hist.push({ rel, master }); if (hist.length > 50) hist.shift(); };
  const comp = () => derive(base, rel);
  const paletteName = () => (rel.palette ? rel.palette.name : base.paletteName || 'nircam');

  function drawAll(m) {
    const next = {};
    for (const g of SHUFFLE_GROUPS) {
      const r = drawGroup(g, groupSeedOf(m, GROUPS.indexOf(g)), base, next);
      if (!r.kept && r.values) next[g] = r.values;
    }
    if (next.exposure) next.exposure = { ...next.exposure, fog: false };
    return next;
  }
  function shuffleAll() {
    push();
    master = nextMaster(master);
    rel = drawAll(master);
    return comp();
  }
  function shufflePalette() {
    push();
    palSeed = nextMaster(palSeed);
    const r = drawGroup('palette', palSeed, base, rel);
    if (!r.kept && r.values) rel = { ...rel, palette: r.values };
    return comp();
  }
  function setPalette(name) {
    if (!PALETTE_INFO[name] || name === paletteName()) return null;
    push();
    rel = { ...rel, palette: { ...(rel.palette || defaultsOf('palette')), name } };
    return comp();
  }
  function back() {
    const h = hist.pop();
    if (!h) return false;
    rel = h.rel; master = h.master;
    return comp();
  }
  function reset() { push(); rel = {}; return comp(); }
  function code() {
    const p = paletteName();
    const shuffled = Object.keys(rel).some((g) => g !== 'palette');
    return { look: shuffled ? toHex(master) : null, pal: p };
  }
  function fromQuery(q) {
    const lk = q.get('look'), pal = q.get('pal');
    let hit = false;
    if (lk && /^[0-9a-f]{1,8}$/i.test(lk)) { master = parseInt(lk, 16) >>> 0; rel = drawAll(master); hit = true; }
    if (pal && PALETTE_INFO[pal]) { rel = { ...rel, palette: { ...(rel.palette || defaultsOf('palette')), name: pal } }; hit = true; }
    return hit;
  }
  return {
    comp, paletteName, shuffleAll, shufflePalette, setPalette, back, reset, code, fromQuery,
    canBack: () => hist.length > 0,
    master: () => master,
    problems: () => check(comp()),
  };
}
