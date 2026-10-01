// ============================================================================
//  HUMAN SKELETON  ·  app/inspect.js — isolate and focus
// ────────────────────────────────────────────────────────────────────────────
//  isolate() keeps one bone solid and turns the other bones into fresnel
//  ghosts. The camera flies to the bone, and the old camera pose is kept
//  for exitIsolate(true). focusBone and focusRegion fly the camera to one
//  bone or to the bounds of a region, from a good direction for the hands
//  and the feet.
//
//  GREP MAP
//    function isolate / exitIsolate                  ghost the other bones
//    function focusBone / focusRegion                camera flights
// ============================================================================
import * as THREE from 'three';
import * as L from '../layout.js';
import { camera, controls } from './stage.js';
import { S } from './state.js';
import { fitDist, flyTo, fitView } from './camera.js';
import { refreshVisibility } from './visibility.js';
import { boneCentre, setHi } from './select.js';
import { showCard } from './card.js';
import { syncList } from './list.js';
import { syncRead } from './controls.js';

export function isolate(i) {
  if (i < 0) return;
  if (S.iso < 0) S.isoBack = { t: controls.target.clone(), p: camera.position.clone() };
  S.iso = i;
  if (S.sel !== i) { if (S.sel >= 0) setHi(S.sel, 0, 0); S.sel = i; setHi(i, 0, 1); syncList(true); }
  for (const g of S.groups.values()) g.ghost.visible = true;
  setHi(i, 0, 0.18);
  refreshVisibility(false);
  const b = S.bones[i];
  flyTo(boneCentre(i), fitDist(b.r * 1.15), 1.0);
  showCard();
  syncRead();
}
export function exitIsolate(back) {
  S.iso = -1;
  for (const g of S.groups.values()) g.ghost.visible = false;
  refreshVisibility(false);
  if (back && S.isoBack) flyTo(S.isoBack.t, S.isoBack.p.distanceTo(S.isoBack.t), 0.9, S.isoBack.p.clone().sub(S.isoBack.t).normalize());
  S.isoBack = null;
  if (S.sel >= 0) { setHi(S.sel, 0, 1); showCard(); }
  syncRead();
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
