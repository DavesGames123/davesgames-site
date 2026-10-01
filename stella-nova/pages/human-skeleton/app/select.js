// ============================================================================
//  HUMAN SKELETON  ·  app/select.js — selection and step
// ────────────────────────────────────────────────────────────────────────────
//  S.sel is the selected bone, or -1. select() sets the glow of the bone in
//  the BoneState texture, opens the card, marks the list row, and moves the
//  camera if the bone is covered. step() selects the next visible bone in
//  list order. boneCentre gives the bone centre as the user sees it, with
//  the layout offset and the drag offset.
//
//  GREP MAP
//    function boneCentre                             world centre of a bone
//    function setHi                                  glow and hover flags
//    function select / clearSelection                the selection
//    function step / onScreen                        previous and next bone
// ============================================================================
import * as THREE from 'three';
import { camera } from './stage.js';
import { S, dirty } from './state.js';
import { ensureVisible } from './camera.js';
import { showCard, hideCard, isolate, focusBone, syncList } from '../main.js';

export function boneCentre(i, out = new THREE.Vector3()) {
  const b = S.bones[i];
  out.set(b.c[0] + S.cur.off[i * 3] + S.dOff[i * 3], b.c[1] + S.cur.off[i * 3 + 1] + S.dOff[i * 3 + 1], b.c[2] + S.cur.off[i * 3 + 2] + S.dOff[i * 3 + 2]);
  // on the tray the bone turns about c, and its box centre is c + lay.c
  if (S.mode === 'catalogue' && S.cat && !S.tr) out.add(new THREE.Vector3(...b.lay.c));
  return out;
}
export function setHi(i, k, v) { if (i >= 0) { S.state.setK(3, i, k, v); S.state.dirty(); } }
export function select(i, opts = {}) {
  if (i < 0 || i >= S.n) return;
  if (S.sel >= 0 && S.sel !== i) setHi(S.sel, 0, 0);
  S.sel = i;
  setHi(i, 0, 1);
  showCard();
  syncList(opts.scroll !== false);
  if (S.iso >= 0 && S.iso !== i) isolate(i);
  else if (opts.fly) focusBone(i);
  else requestAnimationFrame(() => ensureVisible(i));
  dirty();
}
export function clearSelection() {
  if (S.sel >= 0) setHi(S.sel, 0, 0);
  S.sel = -1;
  hideCard();
  syncList(false);
  dirty();
}
export function step(dir) {
  const list = S.bones.filter(b => S.vis[b.i]).map(b => b.i);
  if (!list.length) return;
  const k = list.indexOf(S.sel);
  const j = list[(k < 0 ? 0 : k + dir + list.length) % list.length];
  select(j, { fly: S.iso < 0 && !onScreen(j) });
}
function onScreen(i) {
  const p = boneCentre(i).project(camera);
  return Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9 && p.z < 1;
}
