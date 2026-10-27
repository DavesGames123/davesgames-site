// ============================================================================
//  LEO CATALOG  ·  view/intro-camera.js — the camera swing-in at reveal
// ----------------------------------------------------------------------------
//  The camera swings in from far out and to the side to the default view.
//  Spherical coordinates about the origin, eased with a quintic ease-out
//  over INTRO_MS. Any user drag (OrbitControls 'start') cancels the move.
//    initIntroCamera   remember the default view as the end, park the
//                      camera at the start (r 7.5, +0.35 phi, -1.5 theta)
//    startIntroCamera  at reveal: swing, or jump to the end under
//                      prefers-reduced-motion
//    stepIntroCamera   per frame, before controls.update()
//
//  grep -n targets: "export function initIntroCamera",
//  "export function startIntroCamera", "export function stepIntroCamera"
// ============================================================================
import * as THREE from 'three';

const INTRO_MS = 2600;
let camera = null, introEnd = null, introStart = null;
const _introSph = new THREE.Spherical();
let introT0 = -1;

export function initIntroCamera(cam, controls) {
  camera = cam;
  introEnd = new THREE.Spherical().setFromVector3(camera.position);
  introStart = new THREE.Spherical(7.5, introEnd.phi + 0.35, introEnd.theta - 1.5);
  camera.position.setFromSpherical(introStart);
  controls.addEventListener('start', () => { introT0 = -1; });
}
export function startIntroCamera(reducedMotion) {
  if (reducedMotion) camera.position.setFromSpherical(introEnd);
  else introT0 = performance.now();
}
export function stepIntroCamera(now) {
  if (introT0 < 0) return;
  const k = Math.min(1, (now - introT0) / INTRO_MS);
  const e = 1 - Math.pow(1 - k, 5);
  _introSph.set(
    introStart.radius + (introEnd.radius - introStart.radius) * e,
    introStart.phi    + (introEnd.phi    - introStart.phi)    * e,
    introStart.theta  + (introEnd.theta  - introStart.theta)  * e);
  camera.position.setFromSpherical(_introSph);
  if (k >= 1) introT0 = -1;
}
