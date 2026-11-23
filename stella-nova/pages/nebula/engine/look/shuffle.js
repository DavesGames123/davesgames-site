// shuffle.js: the look space of the shuffle panel (docs/pass3-shuffle.md S2-S4). Pure: no DOM, no GL.
// Node-testable (tools/test-shuffle.mjs).
//
// A look is one complete composition object. The panel draws relative parameter values per group from a
// PCG32 stream (the pcg32 of bake/forcing.js), and derive() writes them into a deep copy of the base
// composition. Randomness chooses parameter values only. No draw reaches a shader, a voxel or a pixel.
//
// grep -n targets: "export const GROUPS", "export const PARAMS", "export function drawGroup",
//                  "export function derive", "export function check", "export function stageOf",
//                  "export function canonical", "export function lookCode", "export function deriveCode", "const MEMBERS", "const PALETTES",
//                  "function anchor", "function trimPalette", "export function validateImport",
//                  "export const TOP", "export function shownOrder", "const SOURCE_NAME", "const DISTINCT".
//
// Stages (S3.5), earliest first. A: phase A (full bake). B: phase B from Snap. P: pre-light and the
// exposure trim. C: the star catalogue. D: compositor uniforms and the overlay. stageOf() compares key
// subsets of two compositions, so a new key cannot be missed: an unknown top-level key counts as stage B.

import { pcg32 } from '../bake/forcing.js';

export const GROUPS = ['composition', 'sources', 'physics', 'filaments', 'palette', 'stars', 'exposure', 'overlay'];
export const GROUP_LABEL = {
  composition: 'Composition', sources: 'Sources', physics: 'Physics', filaments: 'Filaments',
  palette: 'Palette', stars: 'Stars', exposure: 'Exposure', overlay: 'Map overlay',
};
export const STAGES = ['A', 'B', 'P', 'C', 'D'];
const STREAM0 = 1000;   // 1000..1007 Shuffle all, 1016..1023 one group, 1032..1039 the draws; forcing uses 54
const MAX_TRIES = 32;

// ---- Tables of S2 ----

// Cluster memberships of S2.3 (rows of spec 2.1). teffK: the luminosity-weighted member Teff [I].
const MEMBERS = {
  A: { label: 'O3 + 2 O5 + O7', qhat: 68538, logQ1: 49.27, logQfuv: 50.09, logL: 6.14, teffK: 42000 },
  B: { label: 'O3 + O5', qhat: 50060, logQ1: 49.16, logQfuv: 49.91, logL: 5.98, teffK: 43500 },
  C: { label: '3 O5', qhat: 44907, logQ1: 49.07, logQfuv: 49.98, logL: 5.98, teffK: 41500 },
  D: { label: 'O3 + 3 O7', qhat: 45618, logQ1: 49.07, logQfuv: 49.90, logL: 6.00, teffK: 41000 },
  E: { label: '2 O3 + O5', qhat: 85151, logQ1: 49.40, logQfuv: 50.12, logL: 6.20, teffK: 43800 },
  F: { label: 'O5 + 4 O7', qhat: 29005, logQ1: 48.74, logQfuv: 49.86, logL: 5.91, teffK: 38800 },
  G: { label: 'O3 + O5 + 2 O7', qhat: 57078, logQ1: 49.18, logQfuv: 50.01, logL: 6.08, teffK: 42000 },
};
// Embedded hot star rows (the b0L and b0R rows of today's composition).
const HOT = {
  'B0 V': { logQ0: 47.9, logQ1: 44.9, logQfuv: 48.6, logL: 4.4, teffK: 30000, influencePx: 900 },
  'O9.5 V': { logQ0: 47.56, logQ1: 45.12, logQfuv: 48.5, logL: 4.6, teffK: 32000, influencePx: 1000 },
};
// New palettes of S2.6 (linear sRGB; the bake normalizes each to luma 1).
const PALETTES = {
  hoo: { He: [0.20, 0.85, 0.95], H: [1.00, 0.42, 0.12], Front: [1.00, 0.50, 0.20], PAH: [0.55, 0.40, 0.22],
    H2: [0.55, 0.32, 0.14], Shock: [1.00, 0.48, 0.22], Ejecta: [0.95, 0.62, 0.38], scatterBias: [0.75, 0.85, 1.15], dustBand: 1.0 },
  // MIRI: the mid-infrared look. Ionized gas is a dim slate grey, and warm dust (PAH, H2) carries the colour.
  miri: { He: [0.30, 0.42, 0.50], H: [0.35, 0.45, 0.55], Front: [1.00, 0.55, 0.30], PAH: [1.00, 0.40, 0.15],
    H2: [0.85, 0.32, 0.12], Shock: [0.95, 0.58, 0.36], Ejecta: [0.90, 0.70, 0.55], scatterBias: [0.75, 0.85, 1.15], dustBand: 0.3 },
  // The Hubble palette after the usual hue processing (gold H-alpha, teal [O III], rust [S II]). The raw
  // SHO map of the base composition puts H-alpha in pure green, so shuffles draw this form instead.
  hubble: { He: [0.12, 0.62, 0.85], H: [1.00, 0.80, 0.32], Front: [1.00, 0.50, 0.20], PAH: [0.62, 0.42, 0.20],
    H2: [0.65, 0.36, 0.14], Shock: [1.00, 0.55, 0.28], Ejecta: [1.00, 0.72, 0.45], scatterBias: [0.75, 0.85, 1.15], dustBand: 1.0 },
  bicolour: { He: [0.25, 0.75, 0.90], H: [0.95, 0.75, 0.30], Front: [1.00, 0.55, 0.22], PAH: [0.60, 0.45, 0.25],
    H2: [0.70, 0.40, 0.18], Shock: [1.00, 0.62, 0.35], Ejecta: [1.00, 0.78, 0.55], scatterBias: [0.75, 0.85, 1.15], dustBand: 0.8 },
  // Fantasy palettes (the user, 2026-11-20: "add more variations on the palettes that look more
  // fantastical in addition to the realistic options"). The same physics drives each channel; only the
  // colour of each channel changes. Every hue stays out of the hazard band of rule H3 (349-13 deg),
  // so hostile red markers still read on the gas.
  aurora: { He: [0.10, 1.00, 0.60], H: [0.55, 0.25, 1.00], Front: [0.70, 1.00, 0.85], PAH: [0.95, 0.20, 0.75],
    H2: [0.35, 0.20, 0.90], Shock: [0.20, 0.90, 0.90], Ejecta: [0.80, 0.60, 1.00], scatterBias: [0.70, 1.00, 1.10], dustBand: 0.8 },
  ember: { He: [1.00, 0.75, 0.20], H: [1.00, 0.45, 0.08], Front: [1.00, 0.90, 0.55], PAH: [0.90, 0.35, 0.05],
    H2: [0.60, 0.25, 0.05], Shock: [1.00, 0.25, 0.70], Ejecta: [1.00, 0.85, 0.60], scatterBias: [1.10, 0.90, 0.75], dustBand: 1.0 },
  abyss: { He: [0.20, 0.50, 1.00], H: [0.05, 0.60, 0.70], Front: [0.75, 0.95, 1.00], PAH: [0.50, 0.30, 0.90],
    H2: [0.15, 0.20, 0.60], Shock: [0.30, 1.00, 1.00], Ejecta: [0.60, 0.80, 1.00], scatterBias: [0.70, 0.85, 1.20], dustBand: 0.6 },
  orchid: { He: [0.85, 0.40, 1.00], H: [1.00, 0.20, 0.65], Front: [1.00, 0.75, 0.90], PAH: [0.70, 0.45, 0.95],
    H2: [0.50, 0.15, 0.50], Shock: [0.30, 0.90, 1.00], Ejecta: [1.00, 0.70, 0.95], scatterBias: [0.90, 0.80, 1.20], dustBand: 0.8 },
  verdigris: { He: [0.20, 0.95, 0.55], H: [0.10, 0.70, 0.75], Front: [1.00, 0.90, 0.60], PAH: [0.85, 0.45, 0.15],
    H2: [0.55, 0.35, 0.10], Shock: [0.60, 1.00, 0.30], Ejecta: [0.80, 1.00, 0.75], scatterBias: [0.80, 1.05, 0.95], dustBand: 0.9 },
  prism: { He: [0.10, 0.90, 1.00], H: [0.95, 0.15, 0.80], Front: [1.00, 0.85, 0.30], PAH: [1.00, 0.50, 0.10],
    H2: [0.45, 0.20, 0.95], Shock: [0.55, 1.00, 0.25], Ejecta: [0.80, 0.90, 1.00], scatterBias: [0.80, 0.90, 1.15], dustBand: 0.8 },
};
// The palette families: realistic (from real filter sets) and fantasy (free colour, same physics).
export const PALETTES_REAL = ['nircam', 'hubble', 'hoo', 'miri', 'bicolour'];
export const PALETTES_FANTASY = ['aurora', 'ember', 'abyss', 'orchid', 'verdigris', 'prism'];
// PALETTE_NAMES: the palettes a shuffle draws. PALETTE_CHOICES: the palettes the select offers (raw SHO too).
export const PALETTE_NAMES = [...PALETTES_REAL, ...PALETTES_FANTASY];
// withPalette(comp, name): a copy of comp whose palette table holds `name` (the built-in palettes of
// composition.json stay; the palettes above are added on demand). The page palette menu uses it.
export function withPalette(c, name) {
  if (!name || (c.palette && c.palette[name]) || !PALETTES[name]) return c;
  return { ...c, palette: { ...c.palette, [name]: JSON.parse(JSON.stringify(PALETTES[name])) } };
}
export const PALETTE_CHOICES =[...PALETTE_NAMES, 'sho'];
const CHANNELS = ['He', 'H', 'Front', 'PAH', 'H2', 'Shock', 'Ejecta'];
const LATTICES = ['32x32x64', '40x40x80', '48x48x96'];
// Plain names of the sources that the panel can switch off or steer.
const SOURCE_NAME = {
  rn: 'Reflection nebula star', b0L: 'Left hot star', b0R: 'Right hot star', ro: 'Runaway star',
  hubjet: 'Hub jet', hh901: 'Jet HH 901', hh902: 'Jet HH 902', k1: 'Dense core sink',
};

// One row per parameter: { id, g (group), label, kind, lo, hi, q, values, pTrue, def, unit, why }.
// def is the relative value that gives back today's composition (or the nearest regular form of it).
const R = (g, id, label, kind, a, b, qn, def, unit, why) => {
  const r = { g, id, label, kind, def, unit: unit || '', why: why || '' };
  if (kind === 'lattice') { r.values = a; r.draw = a; } else if (kind === 'bool') r.pTrue = a; else if (kind !== 'seed') { r.lo = a; r.hi = b; r.q = qn; }
  return r;
};
export const PARAMS = [
  // Composition: where the cloud features sit, and their sizes (S2.2).
  R('composition', 'f1aDx', 'Main filament start, x shift', 'lin', -100, 150, 10, 0, 'px', 'main filament start, from (150, 120)'),
  R('composition', 'f1aDy', 'Main filament start, y shift', 'lin', -60, 80, 10, 0, 'px'),
  R('composition', 'f1bDx', 'Main filament end, x shift', 'lin', -150, 50, 10, 0, 'px', 'main filament end, from (1850, 850)'),
  R('composition', 'f1bDy', 'Main filament end, y shift', 'lin', -100, 100, 10, 0, 'px'),
  R('composition', 'f1Size', 'Main filament width', 'lin', 35, 55, 5, 45, 'px', 'Herschel filaments have a near-constant width'),
  R('composition', 'f1Contrast', 'Main filament contrast', 'lin', 3, 5, 0.5, 4),
  R('composition', 'tHub', 'Hub place along the filament', 'lin', 0.55, 0.75, 0.01, 0.67, '', 'the hub sits on F1'),
  R('composition', 'offHub', 'Hub offset across the filament', 'lin', -20, 20, 5, 10, 'px'),
  R('composition', 'hubSize', 'Hub size', 'log', 85, 135, 5, 110, 'px'),
  R('composition', 'hubContrast', 'Hub contrast', 'lin', 5.5, 8.5, 0.5, 7),
  R('composition', 'f2Len', 'Feeder 1 length', 'lin', 500, 750, 10, 650, 'px', 'feeder filament from the hub'),
  R('composition', 'f2Ang', 'Feeder 1 angle', 'lin', 140, 175, 5, 155, 'deg'),
  R('composition', 'f2Size', 'Feeder 1 width', 'lin', 20, 32, 1, 25, 'px'),
  R('composition', 'f3Len', 'Feeder 2 length', 'lin', 380, 560, 10, 480, 'px', 'feeder filament from the hub'),
  R('composition', 'f3Ang', 'Feeder 2 angle', 'lin', 235, 270, 5, 255, 'deg'),
  R('composition', 'f3Size', 'Feeder 2 width', 'lin', 20, 32, 1, 28, 'px'),
  R('composition', 'tCore', 'Dense core place along the filament', 'lin', 0.25, 0.45, 0.01, 0.36, '', 'rule: hub minus core at least 0.2'),
  R('composition', 'coreContrast', 'Dense core contrast', 'lin', 2.5, 4, 0.5, 3),
  R('composition', 'yTopC', 'Cliff height', 'lin', 400, 460, 5, 430, 'px', 'the envelope reads it at step 0'),
  R('composition', 'yTopM', 'Cliff tilt', 'lin', -60, -20, 5, -40, 'px/1000'),
  R('composition', 'cliffX0', 'Cliff start x', 'lin', 1850, 2050, 10, 1900, 'px'),
  R('composition', 'cliffX1', 'Cliff end x', 'lin', 3750, 3950, 10, 3900, 'px'),
  R('composition', 'cliffContrast', 'Cliff contrast', 'lin', 1.6, 2.4, 0.1, 2),
  R('composition', 'pilN', 'Pillar count', 'lattice', [2, 3, 4], 0, 0, 3, '', 'a regular row of pillars'),
  R('composition', 'pilXc', 'Pillar row centre', 'lin', 2600, 3100, 10, 2830, 'px'),
  R('composition', 'pilS', 'Pillar spacing', 'lin', 280, 420, 10, 350, 'px', 'rule: heads at least 2.5 sizes apart'),
  ...[0, 1, 2, 3].flatMap((k) => [
    R('composition', 'pilH' + k, `Pillar ${k + 1} head height`, 'lin', 38, 71, 1, [53, 38, 59, 45][k], 'px', 'the front meets the heads first'),
    R('composition', 'pilA' + k, `Pillar ${k + 1} size`, 'lin', 40, 60, 5, 50, 'px'),
    R('composition', 'pilC' + k, `Pillar ${k + 1} contrast`, 'lin', 4.5, 7.5, 0.5, 6),
    R('composition', 'pilP' + k, `Pillar ${k + 1} depth`, 'lattice', [0.95, 0.975], 0, 0, [0.975, 0.95, 0.975, 0.95][k]),
  ]),
  R('composition', 'g1X', 'Globule x', 'lin', 2150, 3700, 10, 2300, 'px', 'cometary globule in the cavity'),
  R('composition', 'g1H', 'Globule height', 'lin', 260, 480, 10, 350, 'px', 'above the cliff top'),
  R('composition', 'g1Size', 'Globule size', 'lin', 22, 38, 2, 30, 'px'),
  R('composition', 'g1Contrast', 'Globule contrast', 'lin', 6, 10, 0.5, 8, '', 'implosion needs a dense seed'),
  R('composition', 'wrX', 'WR bubble x', 'lin', 4650, 5250, 10, 4930, 'px'),
  R('composition', 'wrY', 'WR bubble y', 'lin', 480, 760, 10, 610, 'px'),
  // Sources: which objects exist, clusters, Q, winds, jets (S2.3).
  ...['rn', 'b0L', 'b0R', 'ro', 'hubjet', 'hh901', 'hh902', 'k1'].map((id) =>
    R('sources', 'has_' + id, SOURCE_NAME[id], 'bool', 0.8, 0, 0, true, '', 'the object exists in the bake')),
  R('sources', 'cl1Member', 'Cluster members', 'lattice', Object.keys(MEMBERS), 0, 0, 'A', '', 'sets Q and L of cl1'),
  R('sources', 'cl1X', 'Cluster x', 'lin', 2600, 3300, 10, 2950, 'px', 'above the box'),
  R('sources', 'cl1Reach', 'Cluster height', 'lin', 0.2, 1.0, 0.05, 0.45, '',
    'y = 1210 + share x (Stromgren reach - 1210): rule H10 couples the height to the photon budget'),
  R('sources', 'cl1P', 'Cluster depth', 'lattice', [0.875, 0.9, 0.925], 0, 0, 0.9),
  R('sources', 'wrV', 'WR wind speed', 'lin', 12, 20, 1, 16),
  R('sources', 'wrR', 'WR wind radius', 'lin', 18, 32, 1, 25, 'px'),
  R('sources', 'wrRho', 'WR wind density', 'log', 0.03, 0.08, 0.01, 0.05),
  R('sources', 'b0LType', 'Left hot star type', 'lattice', ['B0 V', 'O9.5 V'], 0, 0, 'B0 V'),
  R('sources', 'b0LX', 'Left hot star x', 'lin', 400, 800, 10, 560, 'px', 'rule: at least 300 px from the hub'),
  R('sources', 'b0LY', 'Left hot star y', 'lin', 500, 800, 10, 640, 'px'),
  R('sources', 'b0RType', 'Right hot star type', 'lattice', ['O9.5 V', 'B0 V'], 0, 0, 'O9.5 V'),
  R('sources', 'b0RX', 'Right hot star x', 'lin', 3950, 4400, 10, 4150, 'px'),
  R('sources', 'b0RY', 'Right hot star y', 'lin', 200, 400, 10, 260, 'px'),
  R('sources', 'rnX', 'Reflection star x', 'lin', 3400, 3750, 10, 3560, 'px'),
  R('sources', 'rnY', 'Reflection star y', 'lin', 260, 340, 10, 300, 'px'),
  R('sources', 'roX', 'Runaway start x', 'lin', 5350, 5650, 10, 5550, 'px'),
  R('sources', 'roY', 'Runaway start y', 'lin', 250, 450, 10, 300, 'px'),
  R('sources', 'roDir', 'Runaway direction', 'lin', 60, 120, 5, 90, 'deg'),
  R('sources', 'roV', 'Runaway speed', 'lin', 3, 5, 0.5, 4),
  ...[['hubjet', 40, 85, 60, 15, 12, 0.5, 450], ['hh901', -20, 30, 5, 0, 16, 1, 400], ['hh902', 140, 190, 165, 0, 14, 1.1, 350]]
    .flatMap(([id, lo, hi, ax, ti, v, per, L]) => [
      R('sources', id + 'Axis', `${SOURCE_NAME[id]} axis`, 'lin', lo, hi, 5, ax, 'deg'),
      R('sources', id + 'Tilt', `${SOURCE_NAME[id]} tilt`, 'lin', -20, 20, 5, ti, 'deg'),
      R('sources', id + 'V', `${SOURCE_NAME[id]} speed`, 'lin', 10, 18, 1, v),
      R('sources', id + 'Per', `${SOURCE_NAME[id]} knot period`, 'lin', 0.4, 1.2, 0.05, per, '', 'knot spacing = v P pxPerL'),
      R('sources', id + 'Len', `${SOURCE_NAME[id]} lobe length`, 'lin', 300, 500, 10, L, 'px', 'rule H8: the lobe stays in the box'),
    ]),
  R('sources', 'hh901X', 'Jet HH 901 place on the cliff', 'lin', 2200, 3700, 10, 2620, 'px', 'a jet from a cliff peak'),
  R('sources', 'hh901D', 'Jet HH 901 depth under the cliff top', 'lin', 10, 40, 5, 20, 'px'),
  R('sources', 'hh902X', 'Jet HH 902 place on the cliff', 'lin', 2200, 3700, 10, 3380, 'px'),
  R('sources', 'hh902D', 'Jet HH 902 depth under the cliff top', 'lin', 10, 40, 5, 30, 'px'),
  // Physics: turbulence, forcing seed, phase-B length, gravity (S2.4).
  R('physics', 'mach', 'Turbulent Mach', 'lin', 4.5, 7.5, 0.25, 6, '', 'gate H2: sigma_s 1.2-1.6'),
  R('physics', 'bandLo', 'Forcing scale, small end', 'lin', 420, 650, 10, 500, 'px'),
  R('physics', 'bandRatio', 'Forcing scale range', 'lin', 2.6, 3.6, 0.1, 3.2),
  R('physics', 'zeta', 'Solenoidal share (zeta)', 'lin', 0.25, 0.5, 0.05, 0.4),
  R('physics', 'seed', 'Forcing seed', 'seed', 0, 0, 0, 20261119, '', 'the mode table and the OU stream'),
  R('physics', 'TB', 'Phase-B length', 'lin', 8, 12, 0.5, 10, 't_u'),
  R('physics', 'tffHub', 'Hub free-fall time', 'lin', 5, 8, 0.25, 6, 't_u', 'GM = GM_6 (6 / t_ff)^2'),
  R('physics', 'tffK1', 'Dense core free-fall time', 'lin', 5, 8, 0.25, 6, 't_u'),
  // Filaments: families, density, width, striations (S2.5, on the strand block of today's bake).
  R('filaments', 'famS', 'Streamer tubes (S)', 'bool', 0.85, 0, 0, true, '', 'off: the page draws no tubes'),
  R('filaments', 'famF', 'Flow tubes (F)', 'bool', 0.85, 0, 0, true, '', 'off: the page draws no tubes'),
  R('filaments', 'lattice', 'Seed lattice', 'lattice', LATTICES, 0, 0, '40x40x80', '', 'a regular lattice, never random seeds'),
  R('filaments', 'maxStrands', 'Tube budget', 'lattice', [12000, 16000, 20000, 26000, 32000], 0, 0, 20000),
  R('filaments', 'width', 'Tube width', 'lin', 0.5, 1.0, 0.05, 0.7, 'texel', 'FWHM stays 1-4 px'),
  R('filaments', 'striK', 'Striation strength', 'lin', 0.10, 0.20, 0.01, 0.15, '', 'used only when the base has striations on'),
  R('filaments', 'waveAmp', 'Striation wave height', 'lin', 0.10, 0.20, 0.01, 0.15),
  R('filaments', 'waveLam', 'Striation wavelength', 'lin', 45, 80, 5, 60, 'px'),
  // Palette (S2.6).
  { ...R('palette', 'name', 'Palette', 'lattice', PALETTE_CHOICES, 0, 0, 'nircam'), draw: PALETTE_NAMES },
  R('palette', 'hue', 'Hue trim', 'lin', -8, 8, 1, 0, 'deg', 'rule H3: no channel in the hazard hue band'),
  R('palette', 'sat', 'Saturation trim', 'lin', 0.8, 1.2, 0.05, 1),
  R('palette', 'dust', 'Dust band', 'lin', 0.3, 1.0, 0.05, 1, '', 'NIRCam about 0.13, Hubble visible 1.0'),
  ...['He', 'Front', 'PAH', 'H2', 'Shock'].map((c) => R('palette', 'gain' + c, `${c} gain`, 'lin', 0.75, 1.25, 0.05, 1)),
  // Stars (S2.7, the catalogue rows).
  R('stars', 'fieldKeep', 'Spiked field stars', 'lin', 0.7, 1.0, 0.05, 0.9, '', 'share of field cells with a bright star'),
  R('stars', 'varCap', 'Twinkle strength', 'lin', 0.3, 0.8, 0.05, 0.6, 'mag', 'cap of the amplitude law'),
  R('stars', 'timeBase', 'Display time base', 'lin', 1.0, 2.5, 0.1, 1.5, 's', 'tau_d = base (tau / 300 s)^0.25'),
  R('stars', 'spikeGain', 'Spike strength', 'lin', 0.6, 1.4, 0.05, 1),
  // Exposure (S2.8).
  R('exposure', 'offsetEv', 'Exposure offset', 'lin', -0.75, 0.75, 0.05, 0, 'EV', 'gas and stars move together'),
  R('exposure', 'targetY', 'Target display Y', 'lin', 0.82, 0.95, 0.01, 0.9, '', 'E0 is solved for it'),
  R('exposure', 'fog', 'Fog of intel', 'bool', 0.3, 0, 0, false),
  R('exposure', 'fogLoss', 'Fog chroma loss', 'lattice', [0.35, 0.45, 0.65], 0, 0, 0.45),
  // Map overlay (S2.9). "On" is a checkbox, never shuffled.
  R('overlay', 'contrast', 'Overlay contrast', 'lin', 0.6, 1.0, 0.05, 1, '', 'opacity of glyphs and labels'),
  // Rows added after the first release. They draw after the older rows of their group, so a look code
  // of the first release keeps the values of its older rows.
  R('stars', 'fieldCell', 'Field star spacing', 'lattice', [300, 350, 400, 450, 500], 0, 0, 400, 'px',
    'one bright field star per cell of a regular lattice: the count goes as 1 / spacing^2'),
  R('stars', 'fieldDmShift', 'Field star brightness', 'lin', -0.75, 0.75, 0.25, 0, 'mag',
    'shifts the magnitude band of the spiked field stars; minus is brighter'),
  // pTrue 1: a shuffle never hides the map. The user can switch it off with the checkbox (stage D).
  R('overlay', 'on', 'Map overlay shown', 'bool', 1.0, 0, 0, true, '', 'route glyphs, lanes and labels over the nebula'),
];
// The rows a card shows first, in this order. The other rows are under "Show all". Display order only:
// the draw order stays the table order.
export const TOP = {
  composition: ['pilN', 'hubSize', 'yTopC', 'wrX'],
  sources: ['cl1Member', 'cl1X', 'cl1Reach', 'b0LType'],
  physics: ['mach', 'zeta', 'bandLo', 'seed'],
  filaments: ['lattice', 'maxStrands', 'width', 'striK'],
  palette: ['name', 'hue', 'sat', 'dust'],
  stars: ['fieldCell', 'fieldDmShift', 'varCap', 'spikeGain'],
  exposure: ['offsetEv', 'targetY', 'fog', 'fogLoss'],
  overlay: ['on', 'contrast'],
};
export const PARAM_BY_ID = Object.fromEntries(PARAMS.map((p) => [p.id, p]));
export const paramsOf = (g) => PARAMS.filter((p) => p.g === g);
export function shownOrder(g) {
  const top = TOP[g] || [];
  const ps = paramsOf(g);
  const rank = (p) => (top.includes(p.id) ? top.indexOf(p.id) : top.length + ps.indexOf(p));
  return ps.slice().sort((a, b) => rank(a) - rank(b));
}

// ---- Seeds (S3.1) ----

export const toHex = (u) => (u >>> 0).toString(16).padStart(8, '0');
export function groupSeedOf(master, i) { return pcg32(master >>> 0, STREAM0 + i).nextU32(); }
export function nextGroupSeed(seed, i) { return pcg32(seed >>> 0, STREAM0 + 16 + i).nextU32(); }
export function nextMaster(master) { return pcg32(master >>> 0, 999).nextU32(); }
export function lookCode(seeds) { return seeds.map((s) => (s == null ? 'default' : toHex(s))).join('.'); }

// ---- Draw (S3.2) ----

function decimalsOf(qn) { const s = String(qn); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
export function quantize(v, qn) { return Number((Math.round(v / qn) * qn).toFixed(decimalsOf(qn))); }
function drawParam(rng, p) {
  const u = rng.nextU32() / 4294967296;
  if (p.kind === 'lin') return quantize(p.lo + u * (p.hi - p.lo), p.q);
  if (p.kind === 'log') return quantize(Math.exp(Math.log(p.lo) + u * (Math.log(p.hi) - Math.log(p.lo))), p.q);
  if (p.kind === 'lattice') return p.draw[Math.min(p.draw.length - 1, Math.floor(u * p.draw.length))];
  if (p.kind === 'bool') return u < p.pTrue;
  if (p.kind === 'seed') return rng.nextU32();
  throw new Error('[shuffle] unknown kind ' + p.kind);
}
export function defaultsOf(g) { return Object.fromEntries(paramsOf(g).map((p) => [p.id, p.def])); }

// drawGroup(g, seed, base, rel): the relative values of group g from its seed. Every row draws in table
// order, also the rows of a source that is off, so the stream position of each row is fixed (SH4).
// A draw that breaks a hard rule of its own group is drawn again from the same stream, at most 32
// times. Returns { values, tries, kept: the rule that made the group keep its values, or null }.
// DISTINCT: a row whose drawn value must differ from the current look, so one press of the group's
// Shuffle always gives a visible change (a palette shuffle that draws the same palette is drawn again).
const DISTINCT = { palette: (base, rel) => (rel && rel.palette ? rel.palette.name : base.paletteName || 'nircam') };
export function drawGroup(g, seed, base, rel) {
  const rng = pcg32(seed >>> 0, STREAM0 + 32 + GROUPS.indexOf(g));
  const before = new Set(check(derive(base, rel)).map((h) => h.rule + h.what));
  const same = DISTINCT[g] ? DISTINCT[g](base, rel) : null;
  let last = null;
  for (let t = 1; t <= MAX_TRIES; t++) {
    const values = {};
    for (const p of paramsOf(g)) values[p.id] = drawParam(rng, p);
    if (same != null && values.name === same) { last = { rule: 'D1', what: 'same palette as now' }; continue; }
    const hits = check(derive(base, { ...rel, [g]: values })).filter((h) => !before.has(h.rule + h.what));
    if (!hits.length) return { values, tries: t, kept: null };
    last = hits[0];
  }
  return { values: rel[g] || null, tries: MAX_TRIES, kept: last ? `${last.rule} (${last.what})` : 'H?' };
}

// ---- Derive (S3.3) ----

const clone = (o) => JSON.parse(JSON.stringify(o));
const r4 = (v) => Number(v.toFixed(4));
const featOf = (c, id) => c.features.find((f) => f.id === id);
const srcOf = (c, id) => c.sources.find((s) => s.id === id);
export function yTopAt(comp, x) { const t = comp.envelope.yTop; return t[0] + t[1] * (x - t[2]) / t[3]; }
// H10: the highest cluster y from which the cavity (rho about 0.35 [I]) still ionizes down to the cliff top.
export function stromgrenTop(comp, x, qhat) { return yTopAt(comp, x) + 10 * Math.cbrt(3 * qhat / (0.35 * 0.35)) - 100; }

// derive(base, rel) -> composition. rel[g] null = the group keeps the base values (look code "default").
export function derive(base, rel) {
  const c = clone(base);
  const v = (g) => rel && rel[g];
  const C = v('composition'), Sx = v('sources'), P = v('physics'), F = v('filaments');
  const Pa = v('palette'), St = v('stars'), E = v('exposure'), O = v('overlay');
  if (C) {
    const F1 = featOf(c, 'F1');
    F1.a = [150 + C.f1aDx, 120 + C.f1aDy, F1.a[2]];
    F1.b = [1850 + C.f1bDx, 850 + C.f1bDy, F1.b[2]];
    F1.size = C.f1Size; F1.contrast = C.f1Contrast;
    const dx = F1.b[0] - F1.a[0], dy = F1.b[1] - F1.a[1], len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const hub = featOf(c, 'hub');
    const hx = Math.round(F1.a[0] + C.tHub * dx + C.offHub * nx), hy = Math.round(F1.a[1] + C.tHub * dy + C.offHub * ny);
    hub.a = [hx, hy, hub.a[2]]; hub.size = C.hubSize; hub.contrast = C.hubContrast;
    const arm = (id, L, ang, size) => {
      const f = featOf(c, id); const r = ang * Math.PI / 180;
      f.a = [hx, hy, f.a[2]];
      f.b = [Math.round(hx + L * Math.cos(r)), Math.round(hy + L * Math.sin(r)), f.b[2]];
      f.size = size;
    };
    arm('F2', C.f2Len, C.f2Ang, C.f2Size); arm('F3', C.f3Len, C.f3Ang, C.f3Size);
    const core = featOf(c, 'core1');
    core.a = [Math.round(F1.a[0] + C.tCore * dx), Math.round(F1.a[1] + C.tCore * dy), core.a[2]];
    core.contrast = C.coreContrast;
    c.envelope.yTop[0] = C.yTopC; c.envelope.yTop[1] = C.yTopM;
    const cliff = featOf(c, 'cliff');
    cliff.x[0] = C.cliffX0; cliff.x[1] = C.cliffX1; cliff.contrast = C.cliffContrast;
    c.envelope.cavM.x[0] = C.cliffX0; c.envelope.cavM.x[1] = C.cliffX1;
    // Pillars: a regular row x_k = xc + (k - (n - 1) / 2) s, heads h_k above yTop(x_k).
    const tmpl = featOf(c, 'pil1');
    const at = c.features.indexOf(tmpl);
    c.features = c.features.filter((f) => !/^pil\d$/.test(f.id));
    const pils = [];
    for (let k = 0; k < C.pilN; k++) {
      const x = Math.round(C.pilXc + (k - (C.pilN - 1) / 2) * C.pilS);
      pils.push({ ...clone(tmpl), id: 'pil' + (k + 1), a: [x, Math.round(yTopAt(c, x) + C['pilH' + k]), C['pilP' + k]],
        size: C['pilA' + k], contrast: C['pilC' + k] });
    }
    c.features.splice(at, 0, ...pils);
    const g1 = featOf(c, 'g1');
    g1.a = [C.g1X, Math.round(yTopAt(c, C.g1X) + C.g1H), g1.a[2]]; g1.size = C.g1Size; g1.contrast = C.g1Contrast;
    const wr = srcOf(c, 'wr'); wr.pos = [C.wrX, C.wrY, wr.pos[2]];
  }
  if (Sx) {
    const cl = srcOf(c, 'cl1'); const m = MEMBERS[Sx.cl1Member];
    Object.assign(cl, { qhat: m.qhat, logQ1: m.logQ1, logQfuv: m.logQfuv, logL: m.logL, teffK: m.teffK });
    const reach = Math.min(1500, stromgrenTop(c, Sx.cl1X, m.qhat));
    cl.pos = [Sx.cl1X, Math.round((1210 + Sx.cl1Reach * Math.max(0, reach - 1210)) / 10) * 10, Sx.cl1P];
    const wr = srcOf(c, 'wr'); Object.assign(wr.wind, { v: Sx.wrV, rPx: Sx.wrR, rho: Sx.wrRho });
    for (const [id, tk, xk, yk] of [['b0L', 'b0LType', 'b0LX', 'b0LY'], ['b0R', 'b0RType', 'b0RX', 'b0RY']]) {
      const s = srcOf(c, id); Object.assign(s, HOT[Sx[tk]]); s.pos = [Sx[xk], Sx[yk], s.pos[2]];
    }
    const rn = srcOf(c, 'rn'); rn.pos = [Sx.rnX, Sx.rnY, rn.pos[2]];
    const ro = srcOf(c, 'ro'); ro.pos = [Sx.roX, Sx.roY, ro.pos[2]];
    const r = Sx.roDir * Math.PI / 180;
    ro.move = { dir: [r4(Math.cos(r)), r4(Math.sin(r)), 0], v: Sx.roV };
    for (const id of ['hubjet', 'hh901', 'hh902']) {
      const j = srcOf(c, id).jet;
      Object.assign(j, { axisDeg: Sx[id + 'Axis'], tiltDeg: Sx[id + 'Tilt'], v: Sx[id + 'V'], period: Sx[id + 'Per'], lobePx: Sx[id + 'Len'] });
    }
    for (const id of ['hh901', 'hh902']) { const s = srcOf(c, id); s.pos = [Sx[id + 'X'], s.pos[1], s.pos[2]]; s._depth = Sx[id + 'D']; }
  }
  if (P) {
    const f = c.forcing;
    f.mach = P.mach; f.zeta = P.zeta;
    const hi = Math.round(P.bandLo * P.bandRatio / 10) * 10;
    f.lambdaPx = [P.bandLo, hi];
    f.peakPx = Math.round(Math.sqrt(P.bandLo * hi) / 10) * 10;
    f.ouT = Number(((f.peakPx / c.units.pxPerL) / (2 * P.mach)).toFixed(1));
    c.seed = P.seed >>> 0;
    const st = c.steps.U;
    st.B = 2 * Math.round(P.TB / (2 * st.dtB));
    srcOf(c, 'hub').sink.gm = Math.round(925 * Math.pow(6 / P.tffHub, 2));
    srcOf(c, 'k1').sink.gm = Math.round(400 * Math.pow(6 / P.tffK1, 2));
  }
  if (F) {
    // The page draws no strand tubes (the user rejected them as streaks), so the tube flags keep the base value.
    // The rows still draw, so older look codes keep the values of the rows after them.
    c.strands.S = base.strands.S !== false && !!F.famS; c.strands.F = base.strands.F !== false && !!F.famF;
    c.strands.lattice = F.lattice.split('x').map(Number);
    c.strands.maxStrands = F.maxStrands; c.strands.widthTexel = F.width;
    // A base with the striations off (iterations 0, wave amp 0: the lab look) keeps them off.
    if (base.striations.iterations > 0) { c.striations.k = F.striK; c.striations.wave.amp = F.waveAmp; c.striations.wave.lambdaPx = F.waveLam; }
  }
  if (Pa) {
    if (!c.palette[Pa.name]) c.palette[Pa.name] = clone(PALETTES[Pa.name]);
    c.paletteName = Pa.name;
    c.palette[Pa.name] = trimPalette(c.palette[Pa.name], Pa.hue, Pa.sat);
    c.palette[Pa.name].dustBand = Pa.dust;
    c.paletteTrim = { hueDeg: Pa.hue, sat: Pa.sat, gain: { He: Pa.gainHe, Front: Pa.gainFront, PAH: Pa.gainPAH, H2: Pa.gainH2, Shock: Pa.gainShock } };
    const w = c.weights, bw = base.weights;
    w.eHe = r4(bw.eHe * Pa.gainHe); w.eFr = r4(bw.eFr * Pa.gainFront); w.ePAH = r4(bw.ePAH * Pa.gainPAH);
    w.eH2 = r4(bw.eH2 * Pa.gainH2); w.eH2s = r4(bw.eH2s * Pa.gainH2); w.eSh = r4(bw.eSh * Pa.gainShock);
  }
  if (St) c.stars = { fieldKeep: St.fieldKeep, varCapMag: St.varCap, timeBaseSec: St.timeBase, spikeGain: St.spikeGain,
    fieldCellPx: St.fieldCell ?? 400, fieldDmShift: St.fieldDmShift ?? 0 };
  if (E) {
    c.exposure.targetY = E.targetY;
    c.display = { ...(c.display || {}), exposureOffsetEv: E.offsetEv, fog: { on: !!E.fog, loss: E.fogLoss } };
  }
  // overlay.on is written only when it is off, so the export of a look with the map on keeps its old text.
  if (O) c.display = { ...(c.display || {}), overlay: O.on === false ? { contrast: O.contrast, on: false } : { contrast: O.contrast } };
  // Existence (sources group): a removed source is left out of the list, never written as null.
  if (Sx) c.sources = c.sources.filter((s) => !(('has_' + s.id) in Sx) || Sx['has_' + s.id]);
  anchor(c, base);
  return c;
}

// The anchor pass: items tied to another item follow it, whatever group moved it (S2.3 derived values).
function anchor(c, base) {
  const hub = featOf(c, 'hub'), core = featOf(c, 'core1');
  for (const s of c.sources) {
    if (s.id === 'hub' || s.id === 'hubjet') s.pos = hub.a.slice();
    if (s.id === 'k1') s.pos = core.a.slice();
    if (s.id === 'hh901' || s.id === 'hh902') {
      const b = srcOf(base, s.id);
      const depth = s._depth != null ? s._depth : Math.round(yTopAt(base, b.pos[0]) - b.pos[1]);
      delete s._depth;
      s.pos = [s.pos[0], Math.round(yTopAt(c, s.pos[0]) - depth), s.pos[2]];
    }
    if (s.jet) {
      const j = s.jet, st = c.steps.U;
      j.spacingPx = Math.round(j.v * j.period * c.units.pxPerL);
      j.step = st.A + st.B - Math.round(j.lobePx / (j.v * c.units.pxPerL * st.dtB));
    }
  }
}

// ---- Palette trims in Oklab (S2.6) ----

function lin2oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklab2lin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
function trimPalette(pal, hueDeg, sat) {
  const out = clone(pal);
  if (!hueDeg && sat === 1) return out;
  const r = hueDeg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  for (const ch of CHANNELS) {
    if (!out[ch]) continue;
    const [L, a, b] = lin2oklab(out[ch]);
    const rgb = oklab2lin([L, sat * (a * cs - b * sn), sat * (a * sn + b * cs)]);
    out[ch] = rgb.map((x) => r4(Math.max(0, x)));
  }
  return out;
}
const enc = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
// HSV hue (deg) and chroma of the sRGB encode of a linear colour, normalized to max 1 (spec 2.11.1 table).
export function srgbHue(rgb) {
  const mx0 = Math.max(...rgb, 1e-9);
  const [r, g, b] = rgb.map((x) => enc(Math.min(1, x / mx0)));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-9) return { hue: 0, chroma: 0 };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { hue: h, chroma: d };
}

// ---- Hard rules (S3.4). check(c) -> [{ rule, what }] ----

export function check(c) {
  const hits = [];
  const hit = (rule, what) => hits.push({ rule, what });
  const st = c.steps.U, u = c.units;
  if (st.dtA * (u.vCap + 1) > 0.75 || st.dtB * (u.vCap + u.ci) > 0.75 || st.dtB * (u.vCap + u.cw) > 0.75) hit('H1', 'CFL');
  const sig = Math.sqrt(Math.log(1 + 0.43 * 0.43 * c.forcing.mach * c.forcing.mach));
  if (sig < 1.2 || sig > 1.6) hit('H2', `predicted sigma_s ${sig.toFixed(2)} (needs 1.2-1.6)`);
  const pal = c.palette[c.paletteName || 'nircam'];
  if (pal) for (const ch of CHANNELS) {
    if (!pal[ch]) continue;
    const { hue, chroma } = srgbHue(pal[ch]);
    if (chroma > 0.05 && (hue >= 349.2 || hue <= 13.2)) hit('H3', `${ch} hue ${hue.toFixed(1)} deg is in the hazard band`);
  }
  const pils = c.features.filter((f) => /^pil\d$/.test(f.id));
  for (const f of pils) {
    const h = f.a[1] - yTopAt(c, f.a[0]);
    if (h < 37 || h > 72 || f.contrast < 3.5) hit('H4', `${f.id} head ${h.toFixed(0)} px above the cliff`);
  }
  for (let i = 1; i < pils.length; i++) {
    if (Math.abs(pils[i].a[0] - pils[i - 1].a[0]) < 2.5 * Math.max(pils[i].size, pils[i - 1].size)) hit('H4', 'pillar heads too close');
  }
  if (c.features.length > 16 || c.sources.length > 32) hit('H5', 'feature or source count');
  // 8 = the slots of the runtime _Hot table (render/lab-consts.js): cl1, cl2, cl3 and five stars.
  if (c.sources.filter((s) => s.qMode && s.qMode !== 'none').length > 8) hit('H5', 'more than 8 light sources');
  for (const s of c.sources) {
    if (s.kind === 'DistantCluster') continue;   // cl1, cl2, cl3 sit above the top edge
    const [x, y, p] = s.pos;
    if (!(y > 0 && y < 1080 && p >= 0.8 && p <= 1 && x >= 0 && x < 5760)) hit('H6', `${s.id} outside the box`);
  }
  const cl = srcOf(c, 'cl1');
  if (!cl || cl.pos[1] <= 1200) hit('H6', 'cl1 must be above y 1200');
  const hub = featOf(c, 'hub'), core = featOf(c, 'core1'), F1 = featOf(c, 'F1');
  const tOf = (pt) => { const dx = F1.b[0] - F1.a[0], dy = F1.b[1] - F1.a[1]; return ((pt[0] - F1.a[0]) * dx + (pt[1] - F1.a[1]) * dy) / (dx * dx + dy * dy); };
  if (tOf(hub.a) - tOf(core.a) < 0.195) hit('H7', 'hub and core too close along F1');
  const b0L = srcOf(c, 'b0L');
  if (b0L && Math.hypot(b0L.pos[0] - hub.a[0], b0L.pos[1] - hub.a[1]) < 300) hit('H7', 'b0L within 300 px of the hub');
  const g1 = featOf(c, 'g1');
  for (const f of pils) {
    if (Math.hypot(g1.a[0] - f.a[0], g1.a[1] - f.a[1]) < 150) hit('H7', 'g1 within 150 px of a pillar head');
    for (const id of ['hh901', 'hh902']) {
      const s = srcOf(c, id); if (s && Math.hypot(s.pos[0] - f.a[0], s.pos[1] - f.a[1]) < 80) hit('H7', `${id} within 80 px of a pillar head`);
    }
  }
  for (const s of c.sources) {
    if (!s.jet) continue;
    const j = s.jet, r = j.axisDeg * Math.PI / 180;
    const inBox = (x, y) => x > 40 && x < 5720 && y > 40 && y < 1040;
    if (!inBox(s.pos[0] + j.lobePx * Math.cos(r), s.pos[1] + j.lobePx * Math.sin(r))) hit('H8', `${s.id} lobe leaves the box`);
    if (j.step <= st.A) hit('H8', `${s.id} jet starts before phase B`);
  }
  if (cl) {
    const yMax = stromgrenTop(c, cl.pos[0], cl.qhat);
    if (cl.pos[1] > yMax) hit('H10', `cl1 y ${cl.pos[1]} is above the reach ${yMax.toFixed(0)} of its photon budget`);
  }
  return hits;
}

// ---- Stage of a change (S3.5), by key subsets ----

const DISPLAY_KEYS = ['display', 'look'];
const CATALOGUE_KEYS = ['stars'];
const PRELIGHT_KEYS = ['palette', 'paletteName', 'paletteTrim', 'weights', 'dustBand', 'exposure', 'seats', 'regions'];
function keyA(c) {
  const st = c.steps.U;
  return JSON.stringify({
    seed: c.seed, units: c.units, envelope: c.envelope, forcing: c.forcing, A: st.A, dtA: st.dtA,
    striations: { ...c.striations, wave: null },
    features: c.features.filter((f) => !(f.step > 0)),
    sinks: c.sources.filter((s) => s.sink && !(s.sink.step > 0)),
  });
}
function keyB(c) {
  const rest = {};
  for (const k of Object.keys(c)) if (![...DISPLAY_KEYS, ...CATALOGUE_KEYS, ...PRELIGHT_KEYS].includes(k)) rest[k] = c[k];
  return JSON.stringify({ ...rest, strands: { ...c.strands, S: null, F: null } });
}
const keyOf = (c, keys) => JSON.stringify(keys.map((k) => (c[k] === undefined ? null : c[k])));
// stageOf(a, b): the earliest stage that reads a change from a to b, or null for no change.
export function stageOf(a, b) {
  if (!a) return 'A';
  if (keyA(a) !== keyA(b)) return 'A';
  if (keyB(a) !== keyB(b)) return 'B';
  if (keyOf(a, PRELIGHT_KEYS) !== keyOf(b, PRELIGHT_KEYS) || a.strands.S !== b.strands.S || a.strands.F !== b.strands.F) return 'P';
  if (keyOf(a, CATALOGUE_KEYS) !== keyOf(b, CATALOGUE_KEYS)) return 'C';
  if (keyOf(a, DISPLAY_KEYS) !== keyOf(b, DISPLAY_KEYS)) return 'D';
  return null;
}

// ---- Export text (S3.8) ----

export function canonical(c) { return JSON.stringify(c, null, 2) + '\n'; }

// Schema check of an imported composition: the keys the bake needs, unique ids, then the blocking rules.
export function validateImport(c) {
  const errs = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['not a JSON object'];
  if (c.version !== 1) errs.push('version: must be 1');
  for (const k of ['units', 'envelope', 'features', 'sources', 'forcing', 'steps', 'palette', 'weights', 'strands', 'striations', 'exposure']) {
    if (!(k in c)) errs.push(`${k}: missing`);
  }
  if (errs.length) return errs;
  const ids = new Set();
  for (const f of c.features) { if (ids.has('f:' + f.id)) errs.push(`features.${f.id}: duplicate id`); ids.add('f:' + f.id); }
  for (const s of c.sources) { if (ids.has('s:' + s.id)) errs.push(`sources.${s.id}: duplicate id`); ids.add('s:' + s.id); }
  for (const id of ['F1', 'hub', 'core1', 'cliff', 'g1', 'pil1']) if (!ids.has('f:' + id)) errs.push(`features.${id}: missing`);
  for (const id of ['cl1', 'wr', 'hub']) if (!ids.has('s:' + id)) errs.push(`sources.${id}: missing`);
  if (c.paletteName && !c.palette[c.paletteName]) errs.push(`palette.${c.paletteName}: missing`);
  if (errs.length) return errs;
  for (const h of check(c)) if (['H1', 'H3', 'H5', 'H6', 'H8'].includes(h.rule)) errs.push(`${h.rule}: ${h.what}`);
  return errs;
}
export const memberLabel = (k) => (MEMBERS[k] ? MEMBERS[k].label : k);

// deriveCode(base, code) -> { comp, rel, groups }: the composition of a look code (lookCode), drawn as the
// panel draws it (ui/shuffle-panel.js drawFrom): each group with a seed, in GROUPS order, then derive().
// It throws when a group keeps its values or check() finds a rule hit. Used by the variant bakes
// (tools/probe-tier.mjs --look) and the Unity variant export (tools/export-unity.mjs --smv).
export function deriveCode(base, code) {
  const parts = String(code).split('.');
  if (parts.length !== GROUPS.length) throw new Error(`[shuffle] a look code needs ${GROUPS.length} parts, got ${parts.length}`);
  const rel = {}, groups = [];
  GROUPS.forEach((g, i) => {
    if (parts[i] === 'default') return;
    const r = drawGroup(g, parseInt(parts[i], 16) >>> 0, base, rel);
    if (r.kept) throw new Error(`[shuffle] group ${g} kept its values (${r.kept})`);
    rel[g] = r.values; groups.push(g);
  });
  const comp = derive(base, rel);
  const hits = check(comp);
  if (hits.length) throw new Error(`[shuffle] rule ${hits[0].rule} (${hits[0].what})`);
  return { comp, rel, groups };
}
