// ============================================================================
//  VIEW PLAN  ·  which tiles to load, in which order (pure, no GL, no DOM)
// ----------------------------------------------------------------------------
//  Round 2 (PERF). The viewer and the node load harness both call these, so
//  the measured timeline in NOTES.md is the one the page runs.
//
//  targetScale(vol, plane, nmPerPx, dpr, lodBias) -> scale index
//    one device px shows about one voxel (camera.js chooseScale, fine0For).
//  wantLevels(vol, vw, cam, tgt) -> [{ L, prio, margin }]
//    the levels a view asks for, coarse first:
//      base   the coarsest scale (prio 0, one tile of margin): the backdrop
//             and the minimap
//      first  the finest scale from tgt+3 up that covers the view in at
//             most FIRST_TILES tiles (prio 50): a cheap useful image when
//             the base is far too coarse (jrc_mus-liver base s13)
//      tgt+2  (prio 100), tgt+1 (prio 200): each level costs about a
//             quarter of the next, so the steps add about a third to the
//             bytes and give a sharper image at each step
//      tgt    (prio 300, and 700 for one tile of margin)
//  computeWants(vw, vi, ctx, out)
//    ctx = { vol, cam, dpr, lodBias, volKey, ready }. Appends tile
//    descriptors { key, posKey, index, vol, scale, plane, rect, prio, band }
//    to out. band = the place of the level in wantLevels (TileStore
//    lookahead holds the fine bands until the coarse ones are in). vi = view number (three-plane layout), 40 prio per view.
//    ready: the target is in; then the next and previous slice of the
//    central target tiles follow (prio 2000).
//  chunkGroups(vol, descs) -> [{ si, chunks }]
//    the chunks that the tiles read, by scale (for vol.prefetchIndexes).
//
//  GREP MAP
//    grep -n 'export function wantLevels'
//    grep -n 'export function computeWants'
//    grep -n 'export function chunkGroups'
// ============================================================================
import { PLANES, chooseScale, fine0For, baseScale, visibleTiles, sliceIndex } from './camera.js';
import { tileKey, posKey } from './tiles.js';

export const FIRST_TILES = 4;
// TileStore lookahead: tiles of at most this many bands past the lowest
// open band start (1: two levels share the link at a time).
export const LOOKAHEAD = 1;

export function targetScale(vol, plane, nmPerPx, dpr = 1, lodBias = 1) {
  return chooseScale(vol.scales, plane, nmPerPx / dpr, lodBias, fine0For(vol, plane));
}

export function wantLevels(vol, vw, cam, tgt) {
  const sc = vol.scales, base = baseScale(sc);
  const out = [{ L: base, prio: 0, margin: 1 }];
  if (tgt + 3 < base) {
    let first = -1;
    for (let L = tgt + 3; L < base; L++) {
      if (visibleTiles(vw, cam, sc[L]).length <= FIRST_TILES) { first = L; break; }
    }
    if (first >= 0) out.push({ L: first, prio: 50, margin: 0 });
  }
  if (tgt + 2 < base) out.push({ L: tgt + 2, prio: 100, margin: 0 });
  if (tgt + 1 < base) out.push({ L: tgt + 1, prio: 200, margin: 0 });
  if (tgt < base) { out.push({ L: tgt, prio: 300, margin: 0 }); out.push({ L: tgt, prio: 700, margin: 1 }); }
  return out;
}

export function computeWants(vw, vi, ctx, out) {
  const { vol, cam } = ctx;
  const p = vw.plane, sc = vol.scales, base = baseScale(sc);
  const tgt = targetScale(vol, p, cam.nmPerPx, ctx.dpr || 1, ctx.lodBias || 1);
  const n = PLANES[p].n;
  const vp = vi * 40, seen = new Set();
  const add = (L, prio, margin = 0, band = 0, maxD = Infinity, dIndex = 0) => {
    const idx = sliceIndex(sc[L], p, cam.center[n]) + dIndex;
    if (idx < 0 || idx >= sc[L].size[n]) return;
    for (const t of visibleTiles(vw, cam, sc[L], margin)) {
      if (t.d > maxD) continue;
      const key = tileKey(ctx.volKey, L, p, idx, t.tu, t.tv);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, posKey: posKey(ctx.volKey, L, p, t.tu, t.tv), index: idx,
        vol, scale: L, plane: p, rect: t.rect, prio: prio + vp + t.d, band });
    }
  };
  const levels = wantLevels(vol, vw, cam, tgt);
  levels.forEach((w, i) => add(w.L, w.prio, w.margin, i));
  // adjacent slices of the central tiles, after the rest
  const nb = levels.length;
  if (tgt < base && vi === 0 && ctx.ready) { add(tgt, 2000, 0, nb, 1.6, 1); add(tgt, 2000, 0, nb, 1.6, -1); }
  return out;
}

export function chunkGroups(vol, descs) {
  const by = new Map();
  for (const d of descs) {
    const s = vol.scales[d.scale], a = PLANES[d.plane];
    if (!s) continue;
    let m = by.get(d.scale);
    if (!m) by.set(d.scale, m = new Map());
    const cn = Math.floor(d.index / s.chunk[a.n]);
    const [u0, v0, u1, v1] = d.rect;
    for (let cv = Math.floor(v0 / s.chunk[a.v]); cv * s.chunk[a.v] < v1; cv++) {
      for (let cu = Math.floor(u0 / s.chunk[a.u]); cu * s.chunk[a.u] < u1; cu++) {
        const c = [0, 0, 0]; c[a.u] = cu; c[a.v] = cv; c[a.n] = cn;
        m.set(c.join(','), c);
      }
    }
  }
  return [...by].map(([si, m]) => ({ si, chunks: [...m.values()] }));
}
