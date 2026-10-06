// ============================================================================
//  LINE ART  ·  themes.js — paper and ink palettes (no DOM)
// ----------------------------------------------------------------------------
//  Each theme: paper color, ink color, the paper texture, an optional glow
//  (neon and amber: a soft halo under the ink), and dark (true when the UI
//  chrome must be light-on-dark). The paper texture is drawn by plotter.js
//  function drawPaper:
//    grain      fine noise and soft clouds (paper)
//    grid       a drafting grid (blueprint)
//    fibers     grain with long fibers (kraft)
//    none       flat color, a light vignette only
// ============================================================================
export const THEMES = [
  { key: 'cream', name: 'Ink on cream', paper: '#f1ebdd', ink: '#1d1a16', texture: 'grain', dark: false },
  { key: 'blueprint', name: 'Blueprint', paper: '#163a6b', ink: '#eef4ff', texture: 'grid', grid: 'rgba(170,205,255,0.13)', dark: true },
  { key: 'neon', name: 'Neon on black', paper: '#06070a', ink: '#5dffc8', glow: '#1bffb0', texture: 'none', dark: true },
  { key: 'graphite', name: 'Graphite', paper: '#f6f5f2', ink: '#3b3f46', texture: 'grain', dark: false },
  { key: 'riso', name: 'Riso pink', paper: '#f5efe4', ink: '#f2357a', texture: 'grain', dark: false },
  { key: 'kraft', name: 'Kraft', paper: '#c9a57a', ink: '#24170c', texture: 'fibers', dark: false },
  { key: 'chalk', name: 'Chalkboard', paper: '#1f2b27', ink: '#e9efe8', texture: 'grain', dark: true },
  { key: 'amber', name: 'Amber scope', paper: '#0c0905', ink: '#ffb54a', glow: '#ff8a00', texture: 'none', dark: true },
  { key: 'violet', name: 'Ultraviolet', paper: '#120d24', ink: '#c9b6ff', glow: '#7d5cff', texture: 'none', dark: true },
];

export function themeByKey(k) { return THEMES.find(t => t.key === k) || THEMES[0]; }
