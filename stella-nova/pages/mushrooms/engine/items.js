// ============================================================================
//  MUSHROOM DRAW  ·  engine/items.js — the parts and the draw items
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. PART_NAMES gives the part
//  index of each output line. item() is one draw item: lines, a fill
//  polygon and washes, with a depth z. runs() cuts a sampled line into
//  its runs of visible points.
//
//  GREP MAP
//    grep -n 'export const PART_NAMES'   the part names and their index
//    grep -n 'export function runs'      the visible runs of a sampled line
//    grep -n 'export const item'         one draw item
// ============================================================================

export const PART_NAMES = ['cap', 'marks', 'under', 'stem', 'ring', 'volva', 'ground', 'leaf', 'grass', 'moss'];
export const PIDX = Object.fromEntries(PART_NAMES.map((p, i) => [p, i]));

// ── helpers for items ───────────────────────────────────────────────────────
// Splits a sampled line into runs of visible points.
export function runs(pts, vis, kind, part, out) {
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    if (vis[i]) (cur || (cur = [])).push(pts[i]);
    else { if (cur && cur.length > 1) out.push({ pts: cur, kind, part }); cur = null; }
  }
  if (cur && cur.length > 1) out.push({ pts: cur, kind, part });
}
export const item = (part, z = 0) => ({ part, lines: [], fill: null, washes: [], z });
