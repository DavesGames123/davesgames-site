// ============================================================================
//  HUMAN SKELETON  ·  app/loop.js — the frame loop and the page teardown
// ────────────────────────────────────────────────────────────────────────────
//  frame() runs once per animation frame. It eases occ toward the clear
//  part, moves a camera flight, moves the explode transition, runs the
//  drag springs and the appear fade, and writes the bone poses into the
//  BoneState texture. It renders only when S.dirty is set. On pagehide the
//  loop stops and the GPU objects are released.
//
//  GREP MAP
//    let last / raf / running                        loop state
//    const loopHook                                  per-frame screensaver tick
//    function frame                                  the loop
//    window.addEventListener('pagehide'              release on page exit
// ============================================================================
import * as L from '../layout.js';
import { REDUCED, clamp01, easeIO, ease } from './env.js';
import { renderer, scene, envRT, camera, key, floor, poolTex, pool, trays, controls } from './stage.js';
import { T, S } from './state.js';
import { occ, occlusion, resize, fitShadow } from './camera.js';
import { placeLabels } from './tray.js';
import { pickRT } from './pick.js';
import { dVelZero, hoverPick } from './pointer.js';

let last = performance.now(), raf = 0, running = true;
// The screensaver sets tick(dt): it runs after the occ ease, before the fly.
// It sets upload when it moves a bone through S.dOff (the lift of a push-in).
export const loopHook = { tick: null, upload: false };
const _q = new Float32Array(4);
export function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let upload = false;
  // framing eases toward the clear area
  const o = occlusion();
  for (const k in occ) {
    const d = o[k] - occ[k];
    if (Math.abs(d) > 0.5) { occ[k] += d * Math.min(1, dt * 9); S.dirty = true; } else if (d) { occ[k] = o[k]; S.dirty = true; }
  }
  if (loopHook.tick) loopHook.tick(dt);
  if (S.fly) {
    const f = S.fly;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = easeIO(f.t);
    controls.target.lerpVectors(f.t0, f.t1, k);
    const u = f.u1 ? f.u0.clone().lerp(f.u1, k).normalize() : camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(u, f.r0 + (f.r1 - f.r0) * k);
    if (f.t >= 1) S.fly = null;
    S.dirty = true;
  }
  if (S.ready) {
    // explode transition
    if (S.tr) {
      const tr = S.tr;
      tr.t += dt;
      for (let i = 0; i < S.n; i++) {
        const k = easeIO(clamp01((tr.t - S.delay[i]) / tr.dur));
        for (let a = 0; a < 3; a++) S.cur.off[i * 3 + a] = S.from.off[i * 3 + a] + (S.to.off[i * 3 + a] - S.from.off[i * 3 + a]) * k;
        L.slerp(S.from.q, i * 4, S.to.q, i * 4, k, S.cur.q, i * 4);
      }
      for (const m of trays.children) m.material.opacity = (S.traysOn ? ease(clamp01(tr.t / Math.max(0.3, tr.end * 0.6))) : 1 - ease(clamp01(tr.t / 0.35))) * (m.isLineSegments ? 0.55 : 1);
      if (tr.t >= tr.end) { S.tr = null; if (!S.traysOn) for (const m of trays.children) m.visible = false; fitShadow(); }
      else for (const m of trays.children) m.visible = true;
      upload = true;
    }
    // drag springs
    for (const i of S.springing) {
      let e = 0;
      for (let a = 0; a < 3; a++) {
        const k = i * 3 + a;
        S.dVel[k] += (-70 * S.dOff[k] - 9 * S.dVel[k]) * dt;
        S.dOff[k] += S.dVel[k] * dt;
        e += Math.abs(S.dOff[k]) + Math.abs(S.dVel[k]) * 0.05;
      }
      if (e < 1e-5) { S.dOff.fill(0, i * 3, i * 3 + 3); dVelZero(i); S.springing.delete(i); }
      upload = true;
    }
    if (S.drag || loopHook.upload) { upload = true; loopHook.upload = false; }
    // dissolve in as groups arrive
    for (const b of S.bones) {
      if (!S.loaded[b.i] || S.appear[b.i] >= 1) continue;
      S.appear[b.i] = REDUCED ? 1 : clamp01((now - b.appearAt) / 650);
      upload = true;
    }
    if (upload) {
      for (let i = 0; i < S.n; i++) {
        S.state.set(0, i, S.cur.off[i * 3] + S.dOff[i * 3], S.cur.off[i * 3 + 1] + S.dOff[i * 3 + 1], S.cur.off[i * 3 + 2] + S.dOff[i * 3 + 2], S.appear[i]);
        _q.set(S.cur.q.subarray(i * 4, i * 4 + 4));
        S.state.set(1, i, _q[0], _q[1], _q[2], _q[3]);
      }
      S.state.dirty();
      S.dirty = true;
    }
  }
  controls.autoRotate = S.show.spin && !S.fly && !S.drag;
  if (controls.update(dt)) S.dirty = true;
  if (S.show.spin) S.dirty = true;
  // hover pick, once a frame, while the mouse is still
  hoverPick();
  if (!S.dirty) return;
  S.dirty = false;
  if (!resize()) return;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  placeLabels();
  S.frames++;
  if (!T.firstFrame) T.firstFrame = performance.now();
  if (!T.firstBones && S.groups.size) T.firstBones = performance.now();
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try {
    for (const g of S.groups.values()) g.geo.dispose();
    if (S.mats) for (const k of ['bone', 'depth', 'ghost', 'pick']) S.mats[k].dispose();
    if (S.state) S.state.dispose();
    for (const c of trays.children) { c.geometry.dispose(); c.material.dispose(); }
    floor.geometry.dispose(); floor.material.dispose(); pool.geometry.dispose(); pool.material.dispose(); poolTex.dispose();
    pickRT.dispose(); envRT.dispose(); key.shadow.map && key.shadow.map.dispose();
    controls.dispose(); renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
  } catch (e) { /* the page is going */ }
});
