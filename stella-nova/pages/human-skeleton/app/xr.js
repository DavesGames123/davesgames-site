// ============================================================================
//  HUMAN SKELETON  ·  app/xr.js — the skeleton in VR and AR
// ────────────────────────────────────────────────────────────────────────────
//  This module wires lib/xr-view.js to the page. The whole scene is the
//  model. The data is in metres with the feet at y 0, so life size is scale
//  1 and the skeleton stands on the real floor. Table size is 0.45 m tall.
//
//  The page loop (app/loop.js) runs on requestAnimationFrame. In a session
//  the lib calls those callbacks from the XR frame loop. update() sets
//  S.dirty each XR frame, because the headset needs a new image every frame
//  and the loop renders only when S.dirty is set.
//
//  HEADSET PANEL  size switch, Explode / Assemble, explode mode, bone names
//                 on hover, reset, exit.
//  PICK           the controller ray selects the first bone whose triangles
//                 it meets (app/pick.js, on the CPU, so the XR camera does
//                 not matter). The normal select() glows the bone.
//
//  GREP MAP
//    function bounds ................ model box for placement
//    function pickRay ............... ray to bone
//    const xr = attachXR ............ options and panel actions
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../../lib/xr-view.js';
import * as L from '../layout.js';
import { $ } from './env.js';
import { renderer, scene, camera, controls } from './stage.js';
import { S } from './state.js';
import { exploded, explode, reconstruct, setMode } from './layouts.js';
import { select } from './select.js';
import { pickRay as pickSceneRay } from './pick.js';

const NEXT_MODE = { radial: 'regional', regional: 'catalogue', catalogue: 'radial' };
const MODE_LABEL = { radial: 'Radial', regional: 'Regions', catalogue: 'Tray', assembled: 'Assembled' };
let names = true;

// The box of the shown bones at their target offsets, in metres.
function bounds() {
  if (!S.P) return new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, 1.7, 0.2));
  const off = S.to ? S.to.off : new Float32Array(S.n * 3);
  const vis = S.vis && S.vis.some(Boolean) ? S.vis : new Uint8Array(S.n).fill(1);
  const b = L.bounds(S.P, off, vis, null, true);
  return new THREE.Box3(new THREE.Vector3(...b.lo), new THREE.Vector3(...b.hi));
}

const inv = new THREE.Matrix4();
// The first bone along the ray, or -1. The ray is in room space; the bones
// are in scene space, so the ray goes through the inverse scene transform.
// The pick is the page pick (app/pick.js) on the real triangles, with a
// tolerance of 0.7 deg for the hand tremor.
export function pickRay(ray) {
  if (!S.ready) return -1;
  scene.updateMatrixWorld();
  const r = ray.clone().applyMatrix4(inv.copy(scene.matrixWorld).invert());
  r.direction.normalize();
  const h = pickSceneRay(r.origin, r.direction, 0.012);
  return h ? h.i : -1;
}

export const xr = attachXR({
  renderer, scene, camera, controls,
  bounds, unit: 1, tableHeight: 0.45,
  vrButton: $('bVR'), arButton: $('bAR'),
  title: 'Human skeleton',
  actions: [
    { label: () => exploded() ? 'Assemble' : 'Explode', run: () => { if (exploded()) reconstruct(); else explode(); } },
    { label: () => 'Mode: ' + MODE_LABEL[S.mode === 'assembled' ? S.lastMode || 'radial' : S.mode], run: () => setMode(NEXT_MODE[S.mode] || 'radial') },
    { label: () => names ? 'Bone names: on' : 'Bone names: off', on: () => names, run: () => { names = !names; } },
  ],
  onRay(ray, kind) {
    const i = pickRay(ray);
    if (kind === 'hover') return names && i >= 0 ? S.bones[i].name : null;
    if (i >= 0) { select(i); return true; }
    return false;
  },
  update() { S.dirty = true; },
  onExit() { S.dirty = true; },
  onSupport(s) { $('xrSec').hidden = !(s.vr || s.ar); },
});
