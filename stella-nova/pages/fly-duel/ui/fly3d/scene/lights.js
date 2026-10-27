// ============================================================================
//  FLY DUEL 3D  ·  the hall lights  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. buildLights() adds the hemisphere fill,
//  the one shadow key light, and the cool and warm rim lights.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export function buildLights'  key, rim, fill
// ============================================================================
import * as THREE from 'three';
import { TABLE as T } from './table.js';


// ---------------------------------------------------------------- lights
// The hall light: fluorescent panels over every table. A cool white
// hemisphere fill and one high key light (the only shadow light, its
// shadow box fits the feature table). A warm low rim from the camera
// side keeps the flies apart from the dark floor. Crisp: no bloom.
export function buildLights(scene, W, coarse) {
  const hemi = new THREE.HemisphereLight(0xeef3ff, 0x2a2f3a, 1.25);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xf4f7ff, 2.4);
  key.position.set(2.5, 14, 3.5);
  key.target.position.set(0, T.y, 0);
  key.castShadow = !coarse;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera;
  sc.left = -6.5; sc.right = 6.5; sc.top = 6.5; sc.bottom = -6.5; sc.near = 4; sc.far = 22;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9);
  rim.position.set(-6, 8, -5);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffe2c4, 0.55);
  rim2.position.set(7, 4, 6);
  scene.add(rim2);
  return { hemi, key, rim, rim2 };
}
