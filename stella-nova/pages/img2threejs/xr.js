// ============================================================================
//  IMG2THREEJS  ·  xr.js — the models in VR and AR
// ────────────────────────────────────────────────────────────────────────────
//  Wires lib/xr-view.js to the page. The whole scene is the model; the
//  factories are in decimetres, so life size is scale 0.1 (unit). Table size
//  makes the model 0.35 m tall. The page loop runs on requestAnimationFrame
//  and renders on demand, so update() marks the frame dirty.
//
//  HEADSET PANEL  next model, next pass, explode / assemble, size, reset, exit.
//  BUTTONS        #xrSec shows when the device has VR or AR and a model has
//                 loaded (S.ready).
//
//  GREP MAP
//    function bounds ............ model box for placement
//    export const xr = attachXR .. options and panel actions
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../lib/xr-view.js';

const K = window.__img2;
const { S } = K;
const $ = id => document.getElementById(id);
let support = { vr: false, ar: false };

// The model box in model units (dm), floor up.
function bounds() {
  const b = new THREE.Box3();
  if (S.model) b.setFromObject(S.model);
  if (b.isEmpty()) b.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  b.min.y = Math.min(b.min.y, 0);
  return b;
}
function showSection() { $('xrSec').hidden = !((support.vr || support.ar) && S.ready); }

export const xr = attachXR({
  renderer: K.renderer, scene: K.scene, camera: K.camera, controls: K.controls,
  bounds, unit: 0.1, tableHeight: 0.35,
  vrButton: $('bVR'), arButton: $('bAR'),
  title: 'Image to Three.js',
  actions: [
    { label: () => 'Model: ' + K.MODELS[S.m].title, run: () => K.setModel((S.m + 1) % K.MODELS.length) },
    { label: () => 'Pass ' + (S.p + 1) + ' / 8', run: () => K.setPass(S.p + 1) },
    { label: () => S.explodeTo > 0.5 ? 'Assemble' : 'Explode', run: () => K.setExplode(S.explodeTo < 0.5) },
  ],
  update() { K.dirty(); },
  onExit() { K.dirty(); K.frame(); },
  onSupport(s) { support = s; showSection(); },
});

if (!S.ready) {
  const t = setInterval(() => { if (S.ready) { clearInterval(t); showSection(); } }, 250);
}
