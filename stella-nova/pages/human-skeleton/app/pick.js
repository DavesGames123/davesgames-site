// ============================================================================
//  HUMAN SKELETON  ·  app/pick.js — GPU picking
// ────────────────────────────────────────────────────────────────────────────
//  pickAt renders the bones into a small target round the tap point. The
//  pick material writes the bone row + 1 as a colour. A view offset of a
//  copy of the main camera gives the small target. The nearest coloured
//  pixel inside the radius gives the bone, or -1.
//
//  GREP MAP
//    const pickRT / let pickBuf                      the target and readback
//    function pickAt                                 bone under a point
// ============================================================================
import * as THREE from 'three';
import { COARSE } from './env.js';
import { canvas, renderer, scene, camera, pickCam } from './stage.js';
import { S } from './state.js';

export const pickRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
let pickBuf = new Uint8Array(4);
export function pickAt(cx, cy, r = COARSE ? 22 : 4) {
  if (!S.ready || !S.groups.size) return -1;
  const cr = canvas.getBoundingClientRect();
  const px = Math.round(cx - cr.left), py = Math.round(cy - cr.top);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const size = 2 * r + 1;
  if (pickRT.width !== size) { pickRT.setSize(size, size); pickBuf = new Uint8Array(size * size * 4); }
  pickCam.copy(camera);
  pickCam.layers.set(1);
  const ox = camera.view ? camera.view.offsetX : 0, oy = camera.view ? camera.view.offsetY : 0;
  pickCam.setViewOffset(w, h, ox + px - r, oy + py - r, size, size);
  pickCam.updateProjectionMatrix();
  scene.overrideMaterial = S.mats.pick;
  renderer.setRenderTarget(pickRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, pickCam);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  renderer.readRenderTargetPixels(pickRT, 0, 0, size, size, pickBuf);
  let best = -1, bd = Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4;
    const id = pickBuf[k] + pickBuf[k + 1] * 256;
    if (!id) continue;
    // readRenderTargetPixels rows run bottom up
    const d = (x - r) ** 2 + (size - 1 - y - r) ** 2;
    if (d < bd && d <= r * r) { bd = d; best = id - 1; }
  }
  return best;
}
