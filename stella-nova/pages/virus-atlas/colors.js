// ============================================================================
//  VIRUS ATLAS  ·  colors.js — colour schemes, palettes and light rigs
// ----------------------------------------------------------------------------
//  No DOM and no three.js: tests.mjs runs this file in Node. All colours
//  are 0..1 sRGB triples (the shaders write them out as they are).
//
//  SCHEMES  what decides the colour of a bead (or tube, blob, node):
//    protein    the role of the entity: each main protein its own colour,
//               antibodies grey, receptors gold, sugars pale green
//    chain      one hue per chain
//    copy       one hue per symmetry copy (asymmetric unit)
//    radius     distance from the centre: depth rings of the shell
//    structure  helix, strand, coil
//    residue    residue class: hydrophobic, polar, +, -, G P C, ...
//    hydro      hydropathy from the class (a coarse scale: the files keep
//               the class, not the residue name)
//    rainbow    N end (blue) to C end (red) along each chain
//    burial     buried (dark) to exposed (bright), from trace.js burial
//  MODE gives the shader mode number of each scheme.
//
//  PALETTES  the colour sets each scheme draws from: atlas (the default),
//  goodsell (soft watercolour tints in the style of David Goodsell's
//  cell paintings), neon, ember, ice.
//
//  LIGHTS  light rigs (view-space key and fill, ambient, rim, specular,
//  background): studio (default), rim, top, warm, cold, noir.
//
//  beadColor(scheme, pal, ctx) is the shader colour function in JS, so
//  tests.mjs can check that every scheme maps into [0, 1].
//
//  grep -n targets: "export const SCHEMES", "export const PALETTES",
//    "export const LIGHTS", "export function chainColors",
//    "export function beadColor", "export function paletteUniforms"
// ============================================================================

export const SCHEMES = [
  { id: 'protein', label: 'By protein' },
  { id: 'chain', label: 'By chain' },
  { id: 'copy', label: 'By symmetry copy' },
  { id: 'radius', label: 'By radius (depth rings)' },
  { id: 'structure', label: 'By secondary structure' },
  { id: 'residue', label: 'By residue type' },
  { id: 'hydro', label: 'By hydropathy' },
  { id: 'rainbow', label: 'Rainbow, N to C end' },
  { id: 'burial', label: 'Buried or exposed' },
];
export const MODE = { protein: 0, chain: 0, copy: 1, structure: 2, residue: 3, radius: 4, hydro: 5, rainbow: 6, burial: 7 };
// class (format.js CLASS) -> hydropathy 0 (water-loving) .. 1 (oily)
export const HYDRO = [1.0, 0.32, 0.0, 0.04, 0.6, 0.15, 0.25, 0.5];

const H = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
export const hex01 = H;

export const PALETTES = {
  atlas: { label: 'Atlas',
    main: ['#ec7a5c', '#f2c14e', '#5fb7ea', '#8fd17f', '#c592f0', '#f193b8', '#79d8c9', '#e0a35b', '#9db4ff', '#d6e36a'],
    antibody: '#8e97ab', receptor: '#e7c45d', glycan: '#dcefc6', nucleic: '#ff9f43',
    ramp: ['#213a9e', '#29a8bd', '#9fd08a', '#eecb73', '#fff2e0'], div: ['#2f8fd8', '#e9e4d8', '#e8743b'],
    ss: ['#9eadc7', '#ee5c73', '#f9cc4d'], copy: [0.08, 0.5, 0.95],
    cls: ['#ebe6d6', '#73cc8c', '#598cfa', '#f25952', '#9e9ea8', '#ff9e40', '#d9f2cc', '#c9c9c9'] },
  goodsell: { label: 'Goodsell',
    main: ['#f2a48c', '#f5d59a', '#9fc6e3', '#b7d9a4', '#d0b6e6', '#f4bfd0', '#a9ded5', '#e8c49b', '#bcc8f2', '#e2e8a8'],
    antibody: '#b9bccb', receptor: '#f0dc9c', glycan: '#e6f2d8', nucleic: '#f4b183',
    ramp: ['#6c7fbf', '#8fc0d6', '#c8e0b8', '#f2d9a6', '#fbeee2'], div: ['#87b4dd', '#f3eee4', '#eda383'],
    ss: ['#c8cdd8', '#f0a3ae', '#f6dc9a'], copy: [0.05, 0.32, 0.96],
    cls: ['#f2ead8', '#b4dfbd', '#a9c0f0', '#f2aaa6', '#cfcfd6', '#f6c592', '#e8f3de', '#dcdcdc'] },
  neon: { label: 'Neon',
    main: ['#ff3d8b', '#ffe23d', '#28d7ff', '#5dff6e', '#b45cff', '#ff7a2e', '#2effd1', '#ff5ce1', '#6c8cff', '#d8ff3d'],
    antibody: '#7a7f99', receptor: '#ffd23d', glycan: '#c8ffb0', nucleic: '#ff8a1f',
    ramp: ['#3a0ca3', '#7209b7', '#f72585', '#4cc9f0', '#e8fbff'], div: ['#00e5ff', '#f0f0ff', '#ff2e88'],
    ss: ['#7f86b8', '#ff2e88', '#ffe23d'], copy: [0.55, 0.85, 1.0],
    cls: ['#f2f2ff', '#5dff6e', '#28a8ff', '#ff3d5e', '#9a9ab8', '#ff8a1f', '#c8ffb0', '#c0c0d0'] },
  ember: { label: 'Ember',
    main: ['#f2542d', '#f5a031', '#ffd166', '#c8553d', '#ff8c61', '#e0b04f', '#b23a48', '#ffb38a', '#f7e3af', '#d9733f'],
    antibody: '#8d8478', receptor: '#ffd166', glycan: '#efe6c8', nucleic: '#ffef9f',
    ramp: ['#2b0f0a', '#7a1f12', '#d1491f', '#f5a031', '#fff1c9'], div: ['#3d5a80', '#efe7da', '#e4572e'],
    ss: ['#a89a8c', '#f2542d', '#ffd166'], copy: [0.02, 0.62, 0.98],
    cls: ['#f7ecd8', '#e0b04f', '#d9733f', '#b23a48', '#9a8f86', '#ffef9f', '#efe6c8', '#c6bdb3'] },
  ice: { label: 'Ice',
    main: ['#8ecae6', '#219ebc', '#cde7f0', '#7bdff2', '#b2f7ef', '#a0c4ff', '#bde0fe', '#90e0ef', '#caf0f8', '#48cae4'],
    antibody: '#8a94a8', receptor: '#e9f5db', glycan: '#e7f6f2', nucleic: '#ffd6a5',
    ramp: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#f1fbff'], div: ['#0077b6', '#eef4f8', '#f4a261'],
    ss: ['#9fb3c8', '#4cc9f0', '#e0fbfc'], copy: [0.5, 0.42, 0.98],
    cls: ['#eef6fb', '#7bdff2', '#4895ef', '#f28482', '#a3b1c2', '#ffd6a5', '#e7f6f2', '#cdd6df'] },
};

// key and fill are view-space directions (x right, y up, z toward the
// viewer); a key with z < 0 lights from behind (a rim light).
export const LIGHTS = {
  studio: { label: 'Studio', key: [-0.45, 0.65, 0.62], keyCol: [1, 1, 1], fill: [0.6, -0.2, 0.5], amb: 0.22, rim: 0.32, spec: 0.22, bg: '#05070c' },
  rim: { label: 'Back light', key: [0.35, 0.55, -0.4], keyCol: [0.95, 0.97, 1], fill: [-0.3, -0.2, 0.9], amb: 0.3, rim: 1.0, spec: 0.1, bg: '#03050a' },
  top: { label: 'Top light', key: [0.05, 1.0, 0.25], keyCol: [1, 0.98, 0.94], fill: [0, -0.6, 0.6], amb: 0.2, rim: 0.4, spec: 0.3, bg: '#06070b' },
  warm: { label: 'Warm', key: [-0.6, 0.45, 0.65], keyCol: [1, 0.86, 0.68], fill: [0.7, 0.0, 0.4], amb: 0.24, rim: 0.45, spec: 0.18, bg: '#0b0706' },
  cold: { label: 'Cold', key: [0.5, 0.6, 0.6], keyCol: [0.75, 0.88, 1], fill: [-0.6, -0.3, 0.5], amb: 0.2, rim: 0.5, spec: 0.3, bg: '#03070e' },
  noir: { label: 'Noir', key: [-0.95, 0.25, 0.3], keyCol: [1, 1, 1], fill: [0.9, 0.1, 0.2], amb: 0.07, rim: 0.6, spec: 0.35, bg: '#020203' },
};

// the same formula as hsv() in glsl.js
export function hsv(h, s, v) {
  const f = o => { const k = Math.max(0, Math.min(1, Math.abs((((h * 6 + o) % 6) + 6) % 6 - 3) - 1)); return v * (1 + (k - 1) * s); };
  return [f(0), f(4), f(2)];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cl = t => t < 0 ? 0 : t > 1 ? 1 : t;
// stops: list of 0..1 triples, t in 0..1 (clamped)
export function ramp(stops, t) {
  const f = cl(t) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f));
  return mix(stops[i], stops[i + 1], f - i);
}

// One colour per chain for the protein and chain schemes (the shader
// reads them from a texture). tint: one colour for every chain (the
// spikes of a virion). -> [[r, g, b, show]] per chain.
export function chainColors(info, scheme, palKey = 'atlas', opts = {}) {
  const pal = PALETTES[palKey] || PALETTES.atlas, ents = info.entities, mainIx = {};
  let nMain = 0;
  ents.forEach((e, i) => { if (e.role === 'main') mainIx[i] = nMain++; });
  return info.chains.map((c, i) => {
    const e = ents[c[2]];
    let col;
    if (scheme === 'chain') { const s = pal.copy; col = hsv((i * 0.618034 + s[0]) % 1, Math.min(1, s[1] + 0.08), s[2] * 0.85); }
    else if (opts.tint != null) col = H(pal.main[opts.tint % pal.main.length]);
    else if (e.role === 'main') col = H(pal.main[(mainIx[c[2]] + (opts.shift || 0)) % pal.main.length]);
    else col = H(pal[e.role] || '#cccccc');
    return [col[0], col[1], col[2], opts.hide && opts.hide[e.role] ? 0 : 1];
  });
}

// The uniform values of a palette (0..1 triples).
export function paletteUniforms(palKey) {
  const p = PALETTES[palKey] || PALETTES.atlas;
  return { ramp: p.ramp.map(H), div: p.div.map(H), ss: p.ss.map(H), cls: p.cls.map(H), copy: p.copy.slice() };
}

// The colour the shader gives one bead. ctx: { chainRgb, k (copy), ss,
// cls, frac (0..1 along the chain), burial (0..1), radiusT (0..1) }
export function beadColor(scheme, palKey, ctx) {
  const U = paletteUniforms(palKey), m = MODE[scheme] ?? 0;
  let c;
  if (m === 1) c = hsv((ctx.k * 0.618034 + U.copy[0]) % 1, U.copy[1], U.copy[2]);
  else if (m === 2) c = U.ss[ctx.ss];
  else if (m === 3) c = U.cls[ctx.cls];
  else if (m === 4) c = ramp(U.ramp, ctx.radiusT);
  else if (m === 5) c = ramp(U.div, HYDRO[ctx.cls]);
  else if (m === 6) c = hsv(0.7 * (1 - cl(ctx.frac)), 0.62, 0.96);
  else if (m === 7) c = ramp(U.ramp, 1 - cl(ctx.burial));
  else c = ctx.chainRgb.slice(0, 3);
  return c;
}
// the value a scheme reads (for the ramp schemes), 0..1
export function schemeValue(scheme, ctx) {
  if (scheme === 'radius') return cl(ctx.radiusT);
  if (scheme === 'hydro') return HYDRO[ctx.cls];
  if (scheme === 'rainbow') return cl(ctx.frac);
  if (scheme === 'burial') return cl(ctx.burial);
  if (scheme === 'copy') return (ctx.k * 0.618034) % 1;
  return 0;
}
