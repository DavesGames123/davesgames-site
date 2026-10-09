// ============================================================================
//  BIOME PARTS  ·  evalnums.js — the eval table on the page
// ----------------------------------------------------------------------------
//  DATA. "Repo" columns: Biome-S1 release/hf/eval_results.json and
//  eval_results_perturbed.json (FreeCAD 1.1, 100 goals per suite; success =
//  Done and IoU >= 0.99). "This page" columns: tools/biome-parts/eval.mjs on
//  the same goal streams (test-data/eval.json, make_ref.py) against the JS
//  session, 2026-10-08, the random actions from a different random stream.
// ============================================================================
export const EVAL_ROWS = [
  { name: 'Training-like, level 1', items: '1', repo: 100, js: 100, repoP: 100, jsP: 99 },
  { name: 'Training-like, level 2', items: '2', repo: 100, js: 100, repoP: 98, jsP: 99 },
  { name: 'Training-like, level 3', items: '2–5', repo: 100, js: 100, repoP: 98, jsP: 99 },
  { name: 'Held-out pairings (comp)', items: '3–5', repo: 90, js: 85, repoP: 96, jsP: 91 },
  { name: 'Boss box then mirror (comp2)', items: '3–5', repo: 100, js: 100, repoP: 95, jsP: 100 },
  { name: 'Pocket then pattern (comp3)', items: '3–5', repo: 100, js: 100, repoP: 99, jsP: 99 },
  { name: 'Longer goals (len)', items: '6–7', repo: 100, js: 100, repoP: 88, jsP: 89 },
  { name: 'Longer goals (len2)', items: '8–9', repo: 100, js: 100, repoP: 97, jsP: 95 },
  { name: 'Longer goals (len3)', items: '11', repo: 100, js: 100, repoP: 95, jsP: 92 },
];
export const EVAL_NOTE = 'Repo: Biome-S1 results (release/hf), credit Shiv Shanmugam. This page: the same seeds run through the browser port and the JavaScript session; "20% random" replaces each command with a random valid one with probability 0.2. The repo also reports 100% on 13 and 15 items and 95% on 17 (60 goals each).';
