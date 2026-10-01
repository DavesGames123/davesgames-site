// ============================================================================
//  HUMAN SKELETON  ·  app/visibility.js — the visible set and bone flags
// ────────────────────────────────────────────────────────────────────────────
//  A bone is visible when its group has loaded and no toggle hides it (the
//  teeth and cartilage toggles, a hidden region). refreshVisibility writes
//  S.vis and the flag of each bone into the BoneState texture: 0 shown,
//  1 hidden, 2 ghost (isolate). A change of the visible set starts a new
//  layout transition, because the layouts use only the visible bones.
//
//  GREP MAP
//    function shownByToggles                         toggle test for a bone
//    function refreshVisibility                      S.vis and the flags
// ============================================================================
import { S, dirty } from './state.js';
import { clearSelection, syncRead } from '../main.js';
import { retarget } from './layouts.js';

function shownByToggles(b) {
  if (b.type === 'tooth' && !S.show.teeth) return false;
  if (b.type === 'cartilage' && !S.show.cartilage) return false;
  return !S.hiddenRegion.has(b.region);
}
export function refreshVisibility(relayout = true) {
  let changed = false;
  for (const b of S.bones) {
    const v = S.loaded[b.i] && shownByToggles(b) ? 1 : 0;
    if (v !== S.vis[b.i]) { S.vis[b.i] = v; changed = true; }
    const flag = !v ? 1 : S.iso >= 0 && b.i !== S.iso ? 2 : 0;
    S.state.setK(2, b.i, 3, flag);
  }
  S.state.dirty();
  if (S.sel >= 0 && !S.vis[S.sel]) clearSelection();
  if (changed && relayout) retarget(true);
  syncRead();
  dirty();
}
