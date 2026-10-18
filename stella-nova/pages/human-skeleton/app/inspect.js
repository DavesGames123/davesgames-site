// ============================================================================
//  HUMAN SKELETON  ·  app/inspect.js — isolate and focus
// ────────────────────────────────────────────────────────────────────────────
//  isolate() keeps one bone solid with a soft rim, and turns the other
//  bones into fresnel ghosts, or hides them (S.isoHide). The camera flies
//  to frame the bone (camera.js frameBone), and the old camera pose is
//  kept for exitIsolate(true). The chip (chip.js) shows while it lasts. focusBone and focusRegion fly the camera to one
//  bone or to the bounds of a region, from a good direction for the hands
//  and the feet.
//
//  GREP MAP
//    const ISO_GLOW                                  rim of the isolated bone
//    function isolate / exitIsolate                  ghost the other bones
//    function setIsoHide                             ghost or hide the others
//    function focusBone / focusRegion                camera flights
// ============================================================================
import * as THREE from 'three';
import * as L from '../layout.js';
import { camera, controls } from './stage.js';
import { S } from './state.js';
import { fitDist, flyTo, fitView, frameBone } from './camera.js';
import { refreshVisibility } from './visibility.js';
import { boneCentre, setHi } from './select.js';
import { showCard } from './card.js';
import { syncList } from './list.js';
import { syncRead } from './controls.js';
import { syncChip } from './chip.js';

// Glow of the isolated bone: a soft rim (render.js: the fresnel term of
// the picked glow), not the full glow of a selection.
const ISO_GLOW = 0.3;
export function isolate(i) {
  if (i < 0 || S.saver) return;
  if (S.iso < 0) S.isoBack = { t: controls.target.clone(), p: camera.position.clone() };
  S.iso = i;
  if (S.sel !== i) { if (S.sel >= 0) setHi(S.sel, 0, 0); S.sel = i; syncList(true); }
  for (const g of S.groups.values()) g.ghost.visible = !S.isoHide;
  setHi(i, 0, ISO_GLOW);
  refreshVisibility(false);
  showCard();
  syncChip();
  frameBone(i);
  syncRead();
}
// Show all. back: fly to the view from before the isolation.
export function exitIsolate(back) {
  if (S.iso < 0) return;
  S.iso = -1;
  for (const g of S.groups.values()) g.ghost.visible = false;
  refreshVisibility(false);
  if (back && S.isoBack) flyTo(S.isoBack.t, S.isoBack.p.distanceTo(S.isoBack.t), 0.9, S.isoBack.p.clone().sub(S.isoBack.t).normalize());
  S.isoBack = null;
  if (S.sel >= 0) { setHi(S.sel, 0, 1); showCard(); }
  syncChip();
  syncRead();
}
// Ghost (false) or hide (true) the other bones. The choice stays for the
// next isolation.
export function setIsoHide(hide) {
  S.isoHide = !!hide;
  if (S.iso < 0) { syncChip(); return; }
  for (const g of S.groups.values()) g.ghost.visible = !S.isoHide;
  refreshVisibility(false);
  syncChip();
}
export function focusBone(i) {
  const b = S.bones[i];
  flyTo(boneCentre(i), fitDist(Math.max(b.r * 2.2, 0.06)), 0.9);
}
export function focusRegion(rid) {
  if (rid === 'all') { fitView(false); return; }
  const want = rid === 'skull' ? new Set(['skull', 'teeth', 'hyoid', 'ear']) : new Set([rid]);
  const bd = L.bounds(S.P, S.to.off, S.vis, b => want.has(b.region));
  const dir = /^foot/.test(rid) ? new THREE.Vector3(0.25, 0.9, 0.55) : /^hand/.test(rid) ? new THREE.Vector3(rid.endsWith('-l') ? 0.2 : -0.2, 0.05, 1) : null;
  if (S.mode === 'catalogue') { flyTo(new THREE.Vector3(...bd.c), fitDist(bd.r * 1.05), 0.9); return; }
  flyTo(new THREE.Vector3(...bd.c), fitDist(bd.r * 1.05), 0.9, dir ? dir.normalize() : null);
}
