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
//  PICK           the controller ray selects the bone whose centre sphere
//                 (0.6 of the bone radius) it passes through first. The
//                 normal select() glows the bone. No GPU pick render is used,
//                 because three replaces the camera with the XR camera.
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
import { boneCentre, select } from './select.js';

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

const inv = new THREE.Matrix4(), c = new THREE.Vector3(), q = new THREE.Vector3();
// The first bone along the ray, or -1. The ray is in room space; the bones
// are in scene space, so the ray goes through the inverse scene transform.
function pickRay(ray) {
  if (!S.ready) return -1;
  scene.updateMatrixWorld();
  const r = ray.clone().applyMatrix4(inv.copy(scene.matrixWorld).invert());
  let best = -1, bt = Infinity;
  for (const b of S.bones) {
    if (!S.loaded[b.i] || !S.vis[b.i]) continue;
    boneCentre(b.i, c);
    const rad = Math.max(0.012, b.r * 0.6);
    if (r.distanceSqToPoint(c) > rad * rad) continue;
    const t = r.closestPointToPoint(c, q).distanceTo(r.origin);
    if (t < bt) { bt = t; best = b.i; }
  }
  return best;
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
