// ============================================================================
//  PROTEIN VIEWER  ·  app/loop.js — the render loop and the page teardown
// ────────────────────────────────────────────────────────────────────────────
//  frame() draws only when S.dirty is set or the camera moves. post.js
//  draws the scene, AO and composite, then the overlay scene goes on top.
//  pagehide stops the loop and releases the GPU objects.
//
//  GREP MAP
//    function frame                        one animation frame
//    pagehide                              stop and dispose
// ============================================================================
import * as R from '../reps.js';
import { ease } from './env.js';
import { S, dirty } from './state.js';
import { camera, clearGroup, controls, envRT, matAtom, matCartoon, matLine, matMark, matSurface, mol, over, overlay, post, renderer, scene } from './stage.js';
import { placeLabels } from './labels.js';
import { hoverTick } from './pointer.js';
import { occ, occlusion, resize } from './camera.js';

window.addEventListener('resize', dirty);

// ── loop ──────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
export function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // framing eases toward the clear area
  const o = occlusion();
  for (const k in occ) {
    const d = o[k] - occ[k];
    if (Math.abs(d) > 0.5) { occ[k] += d * Math.min(1, dt * 9); S.dirty = true; } else if (d) { occ[k] = o[k]; S.dirty = true; }
  }
  if (S.fly) {
    const f = S.fly;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = ease(f.t);
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.lerpVectors(f.t0, f.t1, k);
    camera.position.copy(controls.target).addScaledVector(dir, f.d0 + (f.d1 - f.d0) * k);
    if (f.t >= 1) S.fly = null;
    S.dirty = true;
  }
  controls.autoRotate = S.spin && !S.fly;
  if (controls.update(dt)) S.dirty = true;
  if (S.spin) S.dirty = true;
  hoverTick();
  // In a VR or AR session, lib/xr-view.js draws the scene for both eyes.
  // post.js draws to the screen with a full-screen pass, which a stereo
  // view can not use, and the near and far planes here are in Å.
  if (S.xr) { S.dirty = false; return; }
  if (!S.dirty) return;
  S.dirty = false;
  if (!resize()) return;
  // near and far planes round the molecule; fog round the camera target
  const dC = camera.position.distanceTo(S.bound.c), dT = camera.position.distanceTo(controls.target);
  camera.near = Math.max(0.2, dC - S.bound.r * 1.6);
  camera.far = dC + S.bound.r * 1.6 + 20;
  camera.updateProjectionMatrix();
  const Rf = Math.max(8, Math.min(S.bound.r, dT * 0.6));
  post.render(scene, camera, [dT - Rf * 0.15, dT + Rf * 1.25]);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(overlay, camera);
  renderer.autoClear = true;
  placeLabels();
  S.frames++;
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try {
    clearGroup(mol); clearGroup(over); clearGroup(overlay);
    R.disposeGeoCache(); post.dispose(); envRT.dispose();
    for (const m of [matAtom, matCartoon, matSurface, matMark, ...Object.values(matLine)]) m.dispose();
    controls.dispose(); renderer.dispose(); renderer.forceContextLoss();
  } catch (e) { /* the page is going */ }
});
