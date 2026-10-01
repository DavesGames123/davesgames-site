// ============================================================================
//  MATERIAL STUDIO  ·  export/format.js — number text for files and the UI
// ────────────────────────────────────────────────────────────────────────────
//  f writes a number with at most 4 decimals for the engine text files
//  (Unity YAML, Unreal Python, Godot .tres). fmtSize writes a byte count
//  as B, KB or MB for the panel and the toasts.
//
//  GREP TARGETS
//      f  fmtSize
// ============================================================================
/** A number with at most 4 decimals, as text. */
export const f = v => (Math.round(v * 10000) / 10000).toString();
/** A byte count as B, KB or MB. */
export const fmtSize = n => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
