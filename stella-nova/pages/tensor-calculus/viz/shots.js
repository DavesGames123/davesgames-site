// ============================================================================
//  TENSOR CALCULUS  ·  viz/shots.js  ·  saver shots  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free. SAVER_SHOTS is a list of calm, wide shots for the SAVER
//  package: { scene, params, camera: { pos, target, fov, orbit }, seconds,
//  label }. orbit is a slow auto orbit in degrees per second. Each shot
//  shows its subject in the middle of the frame, so the saver plate can
//  cover the top and the base of the view. tests/viz.test.mjs checks that
//  each shot names a known scene, known params and a finite camera.
//
//  EXPORTS   SAVER_SHOTS
// ============================================================================
import { SCENES, SCENE_IDS } from './registry.js';

export const SAVER_SHOTS = Object.freeze(SCENE_IDS.filter(id => id !== 'components').map(id => ({
  scene: id, params: {}, camera: { ...SCENES[id].camera, orbit: 2 }, seconds: 10, label: SCENES[id].label,
})));
