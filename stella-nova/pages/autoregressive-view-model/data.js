// ============================================================================
//  AUTOREGRESSIVE VIEW MODEL  ·  data.js — numbers from the paper
// ----------------------------------------------------------------------------
//  Zhou, Rota Bulo, Rozumny, Zauss, Hedman, Keetha, Torr, Rupprecht,
//  Vedaldi, Kontschieder. "Autoregressive View Model". arXiv:2611.23417v2
//  (Meta, University of Oxford), 2026. Licence of the paper: CC BY 4.0.
//  Tables 2 to 6 and 8 are copied from the PDF text (v2). null = "n.a.".
//  Keep every paper number in this file; the page builds its tables here.
//
//  grep -n: "export const PAPER"  "export const T2"  "export const T3"
//           "export const T4"  "export const T5"  "export const T6"  "export const T8"
// ============================================================================

export const PAPER = {
  title: 'Autoregressive View Model',
  authors: 'Jensen (Jinghao) Zhou, Samuel Rota Bulo, Denis Rozumny, Duncan Zauss, Peter Hedman, Nikhil Keetha, Philip Torr, Christian Rupprecht, Andrea Vedaldi, Peter Kontschieder',
  orgs: 'Meta · University of Oxford',
  arxiv: '2611.23417', url: 'https://arxiv.org/abs/2611.23417', site: 'https://autoregressive-view-model.github.io/main.html',
  date: '18 November 2026 (v2, 20 November 2026)', licence: 'CC BY 4.0',
  params: '14 billion', data: '≈ 6M labelled scenes + ≈ 2M unlabelled video clips',
};

// Table 2, generation capacity, one starting image as context.
// D = DL3DV-Benchmark, Ws / Wd = WorldScore static / dynamic.
export const T2 = {
  cols: [
    ['camD', 'Camera', 'D', 1], ['camWs', 'Camera', 'Ws', 1], ['rotD', 'Rot. err.', 'D', -1], ['rotWs', 'Rot. err.', 'Ws', -1],
    ['trD', 'Trans. err.', 'D', -1], ['trWs', 'Trans. err.', 'Ws', -1], ['obj', 'Object', 'Ws', 1], ['text', 'Text', 'Ws', 1],
    ['aesD', 'Aesthetic', 'D', 1], ['aesWs', 'Aesthetic', 'Ws', 1], ['imgD', 'Imaging', 'D', 1], ['imgWs', 'Imaging', 'Ws', 1],
    ['fid', 'FID', 'D', -1], ['vmaf', 'VMAF', 'D', 1], ['dsim', 'DreamSim', 'D', -1], ['acc', 'Motion acc.', 'Wd', 1], ['deg', 'Dyn. degree', 'Wd', 1], ['smooth', 'Smoothness', 'Wd', 1],
  ],
  rows: [
    ['GEN3C', 'view', [68.92, 83.74, 8.22, 1.55, 0.091, 0.087, 40.62, 33.09, 0.463, 0.496, 44.69, 51.95, 57.26, 13.42, 0.328, null, null, null]],
    ['Gen3R', 'view', [82.55, null, 3.25, null, 0.059, null, null, null, 0.540, null, 62.84, null, 26.33, 14.83, 0.139, null, null, null]],
    ['SEVA', 'view', [97.07, 68.94, 0.56, 1.66, 0.011, 0.177, null, null, 0.531, 0.542, 63.12, 59.82, 25.04, 19.08, 0.124, null, null, null]],
    ['LingBot-World', 'world', [58.45, 3.91, 8.17, 36.23, 0.099, 0.464, 38.75, 54.07, 0.544, 0.602, 63.88, 65.34, 25.04, 11.91, 0.121, 68.75, 35.55, 36.59]],
    ['HY-WorldPlay 1.5', 'world', [15.86, 3.16, 19.23, 18.71, 0.283, 0.484, 26.25, 41.41, 0.546, 0.502, 64.70, 53.64, 35.71, 12.86, 0.151, 57.48, 26.28, 76.54]],
    ['DreamX-World', 'world', [61.73, 2.09, 8.83, 23.97, 0.107, 0.478, 42.50, 41.48, 0.524, 0.558, 59.48, 60.88, 37.07, 12.44, 0.172, 53.31, 27.65, 63.68]],
    ['AVM', 'avm', [96.48, 70.67, 0.65, 1.71, 0.013, 0.172, 41.88, 39.65, 0.544, 0.580, 65.40, 61.56, 18.69, 20.47, 0.109, 66.36, 24.88, 67.72]],
  ],
  show: ['camD', 'camWs', 'fid', 'vmaf', 'text', 'acc', 'deg', 'smooth'],
};
// Table 3, sparse reconstruction from seven posed images (DL3DV).
export const T3 = {
  cols: [['PSNR', 1], ['SSIM', 1], ['LPIPS', -1], ['VPR', 1], ['SP', 1], ['3D Cons.', 1]],
  rows: [['GEN3C', [14.98, 0.413, 0.441, 0.76, 0.44, 66.77]], ['Gen3R', [14.30, 0.387, 0.423, 0.90, 0.63, 65.01]],
    ['SEVA', [23.91, 0.754, 0.106, 0.95, 0.75, 72.01]], ['AVM', [24.14, 0.769, 0.100, 0.95, 0.83, 73.01]]],
};
// Table 4, 4D reconstruction from a synchronised video (MultiCam).
// Mat. Pix. in thousands.
export const T4 = {
  cols: [['PSNR', 1], ['SSIM', 1], ['LPIPS', -1], ['Mat. Pix. (k)', 1], ['VPR', 1], ['SP', 1], ['3D Cons.', 1]],
  rows: [['ReCamMaster', [13.53, 0.494, 0.457, 377.79, 0.77, 0.47, 57.547]], ['AVM', [21.16, 0.747, 0.171, 450.19, 0.89, 0.63, 64.034]]],
};
// Table 5, revisit consistency over generated history (WorldScore Ws).
export const T5 = {
  cols: [['PSNR', 1], ['SSIM', 1], ['LPIPS', -1], ['VPR', 1], ['SP', 1], ['3D Cons.', 1]],
  rows: [['LingBot-World', [11.06, 0.412, 0.697, 0.49, 0.12, 57.00]], ['HY-WorldPlay 1.5', [10.70, 0.411, 0.891, 0.13, null, 15.76]],
    ['DreamX-World', [12.29, 0.409, 0.727, 0.40, 0.07, 47.86]], ['AVM', [28.04, 0.836, 0.136, 0.92, 0.77, 53.13]]],
};
// Table 6, ablations. CC camera control (D), VQ FID (D), DY motion acc.
// (Wd), SR sparse-reconstruction PSNR (D), LC revisit PSNR (Ws).
export const T6 = {
  cols: [['CC', 1], ['VQ (FID)', -1], ['DY', 1], ['SR', 1], ['LC', 1]],
  rows: [['AVM', [96.48, 18.69, 66.36, 24.14, 28.04]],
    ['Base model', [97.12, 19.86, 66.98, 24.32, 28.53]], ['Causal init model', [88.90, 34.86, 56.41, 18.97, 10.12]],
    ['No per-sample CFG distillation', [93.12, 18.34, 67.21, 22.30, 28.12]],
    ['No retrieval (L_rtr = 0)', [null, null, null, null, 11.13]], ['L_win = 21', [96.54, 18.88, 66.25, 24.07, 28.04]], ['L_win = 15', [96.31, 19.02, 66.17, 23.98, 28.00]]],
};
// Table 8, retrieval policies (app. E).
export const T8 = {
  cols: [['Mean L_rtr', 1], ['Overlap (%)', 1], ['Empty (%)', -1]],
  rows: [['Greedy nearest', [5.3, 73.0, 0.0]], ['Spatial', [3.5, 65.1, 22.0]], ['Spatial + angular', [6.5, 84.4, 0.0]]],
};
