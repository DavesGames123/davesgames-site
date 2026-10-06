// ============================================================================
//  DATA  ·  numbers from the 4DCodeBench paper (ES module, data only)
// ----------------------------------------------------------------------------
//  Source: Shen, Kovacic, Kulits et al., "4DCodeBench: Benchmarking Agents on
//  Inverse Graphics of Dynamic Scenes", arXiv:2610.03715v1 (2 Oct 2026).
//  Every value here is transcribed from the paper. Nothing is estimated.
//  The benchmark repository and datasets carry no licence, so this site
//  uses only these facts, never their code, videos or renders.
//
//  grep -n targets
//    leaderboard ......... "export const LEADERBOARD"   (Fig. 4)
//    VQA accuracy ........ "vqaPct"                      (Fig. 5)
//    composition ......... "export const COMPOSITION"   (Fig. 3)
//    strategies .......... "export const STRATEGIES"    (Sec. 4.4)
//    human study ......... "export const HUMAN"         (Sec. 3.2, 4.1)
//    category effects .... "export const EFFECTS"       (Fig. 7, Sec. 4.3)
//    reasoning ........... "export const REASONING"     (Sec. 4.5)
// ============================================================================

export const PAPER = {
  title: '4DCodeBench: Benchmarking Agents on Inverse Graphics of Dynamic Scenes',
  authors: 'Shen, Kovačič, Kulits, Wang, Li, Tenenbaum, Yuille, Chen & Wu',
  arxiv: 'https://arxiv.org/abs/2610.03715',
  site: 'https://4dcodebench.com',
  code: 'https://github.com/4DCodeBench/4DCodeBench',
  scenes: 200, real: 100, synthetic: 100, models: 18,
  executable: 0.901,          // fraction of submissions fully executable
  maxFps: 60, maxRealFrames: 300,
};

// Fig. 4, sorted by Overall. humanElo is null for Opus 5.5 (not in the
// human study). Family scores are in [0, 1], higher is better. Overall is
// the mean of perceptual, dyn2d, geom25, geom3d, dyn3d. vqaPct is the mean
// per-scene VQA accuracy of Fig. 5 (the table rounds it to two places).
const F = ['humanElo', 'vlmElo', 'vqa', 'perceptual', 'dyn2d', 'geom25', 'geom3d', 'dyn3d', 'overall'];
const ROWS = [
  ['6-Astra [Max]', 'proprietary', 1634, 1732, 0.88, 0.91, 0.60, 0.79, 0.92, 0.73, 0.79, 87.6],
  ['Opus-5.5 [High]', 'proprietary', null, 1556, 0.83, 0.88, 0.56, 0.77, 0.94, 0.75, 0.78, 82.8],
  ['6-Astra [High]', 'proprietary', 1586, 1685, 0.85, 0.90, 0.55, 0.77, 0.92, 0.69, 0.77, 85.0],
  ['Fable-5.1 [High]', 'proprietary', 1394, 1391, 0.79, 0.86, 0.52, 0.74, 0.90, 0.68, 0.74, 78.8],
  ['6-Astra [Low]', 'proprietary', 1393, 1433, 0.78, 0.88, 0.48, 0.75, 0.90, 0.63, 0.73, 78.2],
  ['Opus-5 [High]', 'proprietary', 1389, 1361, 0.76, 0.85, 0.51, 0.73, 0.86, 0.64, 0.72, 76.4],
  ['5.6-Luna [Max]', 'proprietary', 1072, 1224, 0.67, 0.83, 0.42, 0.70, 0.86, 0.53, 0.67, 67.3],
  ['5.6-Sol [High]', 'proprietary', 1119, 1171, 0.67, 0.83, 0.36, 0.63, 0.85, 0.56, 0.65, 67.4],
  ['Gemini-3.8 [High]', 'proprietary', 1072, 1037, 0.63, 0.81, 0.36, 0.63, 0.84, 0.56, 0.64, 62.7],
  ['DeepSeek-V4.1 [High]', 'open', 912, 886, 0.50, 0.78, 0.34, 0.62, 0.77, 0.48, 0.60, 50.0],
  ['Qwen-3.8 [XHigh]', 'open', 1092, 1061, 0.58, 0.71, 0.34, 0.55, 0.71, 0.50, 0.56, 58.0],
  ['5.6-Terra [High]', 'proprietary', 917, 911, 0.48, 0.79, 0.23, 0.52, 0.77, 0.43, 0.55, 48.4],
  ['GLM-5.3 [Max]', 'open', 733, 670, 0.30, 0.69, 0.20, 0.51, 0.60, 0.36, 0.47, 29.5],
  ['Muse-Glimmer [High]', 'open', 505, 345, 0.11, 0.61, 0.11, 0.47, 0.68, 0.33, 0.44, 11.0],
  ['MiMo-V2.5 [Def]', 'open', 676, 569, 0.25, 0.69, 0.12, 0.48, 0.57, 0.31, 0.43, 24.6],
  ['MiniMax-M3 [Def]', 'open', 725, 554, 0.18, 0.52, 0.11, 0.35, 0.44, 0.26, 0.34, 17.9],
  ['Mistral-3.5', 'open', 361, 138, 0.01, 0.46, 0.02, 0.41, 0.42, 0.26, 0.32, 1.3],
  ['Gemma-4-31B', 'open', 422, 275, 0.06, 0.51, 0.00, 0.13, 0.17, 0.13, 0.19, 5.6],
];
// Fig. 8, same row order as ROWS. The paper averages unrounded family
// scores, so these differ by up to 0.01 from means of the rounded Fig. 4
// values (Astra [Max]: 0.91 here, 0.915 from Fig. 4).
const FIG8_STATIC = [0.91, 0.91, 0.91, 0.88, 0.89, 0.86, 0.85, 0.84, 0.82, 0.77, 0.71, 0.78, 0.65, 0.65, 0.63, 0.48, 0.44, 0.34];
const FIG8_DYNAMIC = [0.67, 0.65, 0.62, 0.60, 0.55, 0.57, 0.48, 0.46, 0.46, 0.41, 0.42, 0.33, 0.28, 0.22, 0.22, 0.19, 0.14, 0.07];
export const LEADERBOARD = ROWS.map(([model, access, ...v], i) => {
  const r = { model, access };
  F.forEach((k, i) => { r[k] = v[i]; });
  r.vqaPct = v[F.length];
  r.static = FIG8_STATIC[i];                    // Fig. 8 blue dot
  r.dynamic = FIG8_DYNAMIC[i];                  // Fig. 8 orange dot
  return r;
});
export const FAMILIES = [
  { key: 'perceptual', label: 'Perceptual', measure: 'DINOv3 similarity to the reference video', on: 'all scenes' },
  { key: 'dyn2d', label: '2D Dynamics', measure: 'Dynamic IoU of moving objects; Flow and Track2D on real videos', on: 'all scenes' },
  { key: 'geom25', label: '2.5D Geometry', measure: 'depth error against estimated depth', on: 'real videos' },
  { key: 'geom3d', label: '3D Geometry', measure: 'Chamfer distance at frame 0 (Scene 3D)', on: 'synthetic scenes' },
  { key: 'dyn3d', label: '3D Dynamics', measure: 'Trajectory DTW (Lagrangian) and EMD step (Eulerian)', on: 'synthetic scenes' },
];

// Fig. 3. Counts of scenes that contain each matter family (a scene can
// contain several), then percentages per split.
export const COMPOSITION = {
  families: [
    { key: 'rigid', label: 'Rigid / articulated', real: 88, synthetic: 70 },
    { key: 'deformable', label: 'Deformable', real: 23, synthetic: 55 },
    { key: 'codim', label: 'Co-dimensional (cloth, rope)', real: 20, synthetic: 19 },
    { key: 'flowing', label: 'Flowing (grains, fluids)', real: 29, synthetic: 25 },
  ],
  objects: { real: { single: 18, many: 82 }, synthetic: { single: 16, many: 84 } },
  materials: { real: { single: 36, many: 64 }, synthetic: { single: 32, many: 68 } },
  motion: { real: { passive: 41, driven: 59 }, synthetic: { passive: 55, driven: 45 } },
  multiObjectPct: 83, multiMaterialPct: 66,
};

// Sec. 4.4 and Table A4: how agents implement motion.
export const STRATEGIES = {
  overall: [
    { key: 'analytic', label: 'Analytic motion', pct: 67 },
    { key: 'custom', label: 'Custom simulation', pct: 19 },
    { key: 'blender', label: 'Blender physics', pct: 10 },
    { key: 'keyframe', label: 'Keyframing', pct: 3 },
  ],
  notes: [
    { model: 'Opus-5.5 [High]', text: 'custom simulation in 61% of its solutions' },
    { model: '6-Astra [Low]', text: 'analytic motion in 85%' },
    { model: '5.6-Terra [High]', text: 'analytic motion in 100%' },
  ],
};

// Sec. 3.2 and 4.1, Fig. 2.
export const HUMAN = {
  judgments: 3587, participants: 76, models: 17, aboutSamePct: 10.5,
  spearmanHumanVlm: 0.980, pearsonHumanVlm: 0.993, r2: 0.985, slope: 1.22,
  sharedComparisons: 916, agreePct: 89.3, kappa: 0.761,
  humanHumanAgreePct: 92.1, humanHumanKappa: 0.816,
  humanEloVsOverallSpearman: 0.96,
  // Single VLM judgments versus Elo gap between the two models.
  // The paper gives no value inside 50 points, only 'near chance'.
  nearChanceWithin: 50,
  agreeByGap: [{ gap: 132, pct: 75 }, { gap: 343, pct: 90 }],
};

// Fig. 7, standardized effects quoted in Sec. 4.3.
export const EFFECTS = [
  { contrast: 'Real − synthetic', metric: 'VQA', d: -0.73 },
  { contrast: 'Real − synthetic', metric: 'Perceptual', d: -0.88 },
  { contrast: 'Multiple − single matter', metric: 'VQA', d: -0.57 },
  { contrast: 'Multiple − single matter', metric: 'Perceptual', d: -0.39 },
  { contrast: 'Co-dimensional', metric: '2D Dynamics', d: -0.35 },
  { contrast: 'Co-dimensional', metric: '2.5D Geometry', d: -0.76 },
  { contrast: 'Driven − passive', metric: 'VQA', d: -0.30 },
  { contrast: 'Driven − passive', metric: '3D Geometry', d: 0.46 },
  { contrast: 'Flowing', metric: '3D Dynamics', d: -0.21, weak: true },
];

// Sec. 4.5: GPT-6 Astra at three reasoning efforts.
export const REASONING = [
  { effort: 'Low', overall: 0.73, dyn2d: 0.48, dyn3d: 0.63, vqaPct: 78.2 },
  { effort: 'High', overall: 0.77, dyn2d: 0.55, dyn3d: 0.69, vqaPct: 85.0 },
  { effort: 'Max', overall: 0.79, dyn2d: 0.60, dyn3d: 0.73, vqaPct: 87.6 },
];
