// lab/presets.js - the CT lab parameter defaults, the preset gallery and the display windows.
// Pure data and small helpers. No DOM. node tests import this file.
//
// grep handles:
//   DEFAULTS, PRESETS, GROUPS, WINDOWS, presetById, paramsFor, workFor, RESCAN_KEYS, RECON_KEYS

export const DEFAULTS = Object.freeze({
  phantom: 'shepp-logan-modified', n: 256,
  beam: 'parallel', views: 360, arc: 180, detectors: 0,
  dose: 0, poly: false, kVp: 120, motion: 0, deadPixels: 0, gain: 0, mar: false,
  algo: 'fbp', filter: 'ram-lak', cutoff: 1, iters: 30, relax: 0, tv: 0,
  window: 'auto', cmap: 'grey', cmapReverse: false, cmapGamma: 1, diffMap: 'coolwarm',
  compare: '', seed: 7,
});

// Parameters whose change needs a new scan, a new reconstruction, or only a redraw.
export const RESCAN_KEYS = ['phantom', 'n', 'beam', 'views', 'arc', 'detectors', 'dose', 'poly', 'kVp',
  'motion', 'deadPixels', 'gain', 'mar', 'seed'];
export const RECON_KEYS = ['algo', 'filter', 'cutoff', 'iters', 'relax', 'tv', 'compare'];

export function workFor(prev, next) {
  if (RESCAN_KEYS.some((k) => prev[k] !== next[k])) return 'scan';
  if (RECON_KEYS.some((k) => prev[k] !== next[k])) return 'recon';
  return 'draw';
}

export const GROUPS = [
  ['basics', 'The basics'],
  ['sampling', 'How many views'],
  ['physics', 'Dose and physics'],
  ['artefacts', 'Artefacts'],
  ['algorithms', 'Algorithms'],
  ['objects', 'Things to scan'],
  ['clinical', 'Clinical windows'],
  ['make', 'Make your own'],
];

// Display windows. HU windows apply to phantoms in 1/cm; raw windows to Shepp-Logan.
export const WINDOWS = [
  { id: 'auto', label: 'Full range', auto: true },
  { id: 'brain', label: 'Brain', level: 40, width: 80, hu: true },
  { id: 'stroke', label: 'Stroke', level: 35, width: 30, hu: true },
  { id: 'subdural', label: 'Subdural', level: 75, width: 215, hu: true },
  { id: 'soft', label: 'Soft tissue', level: 40, width: 400, hu: true },
  { id: 'lung', label: 'Lung', level: -600, width: 1500, hu: true },
  { id: 'bone', label: 'Bone', level: 500, width: 2000, hu: true },
  { id: 'metal', label: 'Metal', level: 3000, width: 12000, hu: true },
  { id: 'sl-soft', label: 'Shepp-Logan soft', level: 1.02, width: 0.06, hu: false },
];

const P = (id, group, label, blurb, params, extra = {}) => ({ id, group, label, blurb, params, ...extra });

export const PRESETS = [
  P('shepp-logan', 'basics', 'Shepp-Logan, the classic',
    'The 1974 test head: ten ellipses, 360 views, filtered back-projection with the Ram-Lak filter.',
    { phantom: 'shepp-logan-modified' }),
  P('sparse-90', 'sampling', '90 views',
    'A quarter of the views. Fine streaks start at the edges of bright objects.',
    { views: 90 }),
  P('sparse-36', 'sampling', '36 views',
    'Each view leaves a streak that the other views cannot cancel.',
    { views: 36 }),
  P('sparse-18', 'sampling', '18 views',
    'Far too few views for FBP. The streaks form a star around every edge.',
    { views: 18 }),
  P('limited-120', 'sampling', 'Limited angle, 120 degrees',
    'Views from only 120 of the 180 degrees. Edges parallel to the missing rays blur away.',
    { arc: 120, views: 240 }),
  P('limited-90', 'sampling', 'Limited angle, 90 degrees',
    'Only half the arc. The missing wedge of the Fourier plane smears the image along one axis.',
    { arc: 90, views: 180 }),
  P('low-dose', 'physics', 'Low dose',
    'Few photons per ray. Photon noise turns into fine streaky grain in the reconstruction.',
    { phantom: 'chest', dose: 3e4, window: 'soft' }),
  P('high-dose', 'physics', 'High dose',
    'A hundred times more photons: the grain falls by about ten times (the square root).',
    { phantom: 'chest', dose: 3e6, window: 'soft' }),
  P('beam-hardening', 'physics', 'Beam hardening (cupping)',
    'A real tube gives many energies. Soft photons stop first, so the middle of a water disc looks too dark.',
    { phantom: 'contrast-detail', poly: true, kVp: 80, window: 'soft', cmap: 'bone' }),
  P('metal-streaks', 'artefacts', 'Metal implant streaks',
    'A steel hip stops almost every photon. The bad rays become bright and dark streaks.',
    { phantom: 'metal-implant', poly: true, kVp: 120, dose: 2e5, window: 'soft' }),
  P('metal-mar', 'artefacts', 'Metal artefact reduction',
    'The same hip. The lab finds the metal, fills its trace in the sinogram by interpolation, then puts the metal back.',
    { phantom: 'metal-implant', poly: true, kVp: 120, dose: 2e5, mar: true, window: 'soft' }),
  P('rings', 'artefacts', 'Rings from a bad detector pixel',
    'One dead element and small gain errors make vertical lines in the sinogram and rings in the image.',
    { phantom: 'walnut', deadPixels: 1, gain: 0.004, dose: 1e6, cmap: 'gold-leaf' }),
  P('motion', 'artefacts', 'Motion during the scan',
    'The head moves 4 mm side to side during the turn. The sinogram curves wobble and edges double.',
    { phantom: 'head', motion: 0.4, beam: 'fan-flat', arc: 360, window: 'brain' }),
  P('fan-flat', 'basics', 'Fan beam, flat detector',
    'A point source and a flat detector, as in a real scanner. Weighted FBP over a full 360 degree turn.',
    { phantom: 'head', beam: 'fan-flat', arc: 360, views: 360, window: 'brain' }),
  P('fan-arc', 'basics', 'Fan beam, curved detector',
    'Clinical scanners curve the detector so every element sits at the same distance from the source.',
    { phantom: 'head', beam: 'fan-arc', arc: 360, views: 360, window: 'bone' }),
  P('filters', 'algorithms', 'FBP filter comparison',
    'Noisy data through five filters. Ram-Lak keeps the sharp edges and the noise; Hann trades both away.',
    { phantom: 'shepp-logan-modified', dose: 2e4, filter: 'hann', compare: 'filters' }),
  P('algorithms', 'algorithms', 'SIRT, CGLS and FBP at 30 views',
    'Few views: the iterative methods use every ray as an equation and suppress the streaks.',
    { phantom: 'shepp-logan-modified', views: 30, algo: 'sirt', iters: 120, compare: 'algorithms' }),
  P('art-kaczmarz', 'algorithms', 'ART, one ray at a time',
    'Kaczmarz projections: the image moves onto one ray equation after another, in random order.',
    { phantom: 'shepp-logan-modified', views: 60, n: 128, algo: 'art', iters: 15 }),
  P('tv-sparse', 'algorithms', 'Total variation at 36 views',
    'SART with total-variation steps prefers flat regions with sharp edges, so it fills the gaps between views.',
    { phantom: 'shepp-logan-modified', views: 36, dose: 1e5, algo: 'sart', iters: 40, tv: 0.02 }),
  P('walnut', 'objects', 'Walnut',
    'A lab micro-CT favourite: thin wrinkled shell, kernel lobes and air gaps, 5 cm across.',
    { phantom: 'walnut', views: 540, dose: 2e6, cmap: 'gold-leaf' }),
  P('suitcase', 'objects', 'Suitcase security scan',
    'An airport scanner view: clothes, a bottle, a laptop with battery cells, keys and coins.',
    { phantom: 'suitcase', beam: 'fan-flat', arc: 360, poly: true, kVp: 140, dose: 5e5, cmap: 'hot-iron', window: 'bone' }),
  P('chest-lung', 'clinical', 'Chest, lung window',
    'Window -600 HU, width 1500: the lung vessels and a small nodule show; soft tissue is flat white.',
    { phantom: 'chest', beam: 'fan-arc', arc: 360, dose: 1e6, window: 'lung' }),
  P('head-brain', 'clinical', 'Head, brain window',
    'Window 40 HU, width 80: grey and white matter separate and the bleed shows bright.',
    { phantom: 'head', beam: 'fan-arc', arc: 360, dose: 4e6, window: 'brain', filter: 'shepp-logan' }),
  P('head-bone', 'clinical', 'Head, bone window',
    'Window 500 HU, width 2000: the skull and its spongy middle layer; the brain is one grey.',
    { phantom: 'head', beam: 'fan-arc', arc: 360, dose: 4e6, window: 'bone' }),
  P('bars', 'objects', 'Resolution bars',
    'Bar groups from 1 to 8 line pairs per cm. Count the groups that still show five bars.',
    { phantom: 'bars', views: 540, window: 'bone' }),
  P('contrast-detail', 'objects', 'Contrast-detail discs',
    'Discs from 0.5% to 8% contrast. With noise, small faint discs vanish first.',
    { phantom: 'contrast-detail', dose: 2e6, window: 'brain', filter: 'shepp-logan' }),
  P('custom', 'make', 'Draw your own',
    'Paint discs and ellipses of real materials, or load a picture, then scan it.',
    { phantom: 'custom', window: 'bone' }),
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

// Full parameter set for a preset: the defaults, then the preset fields.
export function paramsFor(id) {
  return { ...DEFAULTS, ...presetById(id).params };
}
