// ============================================================================
//  NEURON LAB  ·  shared/stage.js  ·  renderer, bloom, camera springs
// ----------------------------------------------------------------------------
//  Both neuron pages use this module (three r160, WebGL2).
//    - renderer with ACES tone mapping; bloom (UnrealBloomPass) on a fine
//      pointer only: phones get the light path with no post-processing
//    - OrbitControls for the user; a spring camera (az, el, r, target) for
//      the fly-to presets and the screensaver, so the camera has a
//      continuous velocity and never snaps
//    - frame(rect): shifts the projection (setViewOffset) so the scene
//      centre sits in the middle of the clear part of the canvas, and
//      reports the fit factor
//    - release on pagehide: dispose the composer, the renderer, and lose
//      the context (lib/gpu-guard.js does the same for the shell)
//
//  grep -n targets
//    "export function createStage"   the factory
//    "function springStep"           critically damped spring
//    "frame("                        clear-area framing
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// x, v toward target with angular frequency w (critically damped).
function springStep(s, target, w, dt) {
  const a = w * w * (target - s.x) - 2 * w * s.v;
  s.v += a * dt; s.x += s.v * dt;
}

export function createStage({ canvas, coarse = false, onNoGL = null, bloom = { strength: 0.9, radius: 0.55, threshold: 0.18 } } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, alpha: false, powerPreference: 'high-performance' });
  } catch (e) { if (onNoGL) onNoGL(); return null; }
  renderer.setClearColor(0x05070d, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070d, 0.0);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 1e5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8; controls.panSpeed = 0.6;
  let composer = null, bloomPass = null;
  if (!coarse) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), bloom.strength, bloom.radius, bloom.threshold);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }
  const sp = { az: { x: 0.6, v: 0 }, el: { x: 0.25, v: 0 }, r: { x: 1000, v: 0 }, tx: { x: 0, v: 0 }, ty: { x: 0, v: 0 }, tz: { x: 0, v: 0 } };
  const goal = { az: 0.6, el: 0.25, r: 1000, tx: 0, ty: 0, tz: 0 };
  const S = {
    renderer, scene, camera, controls, composer, bloomPass, THREE,
    springOn: false, hold: false, w: 1.6, fit: 1, clear: null, W: 1, H: 1, dpr: 1,
    // fly the camera with springs to { az, el, r, target:[x,y,z] } (radians)
    flyTo(o, w = 1.6) {
      Object.assign(goal, { az: o.az ?? goal.az, el: o.el ?? goal.el, r: o.r ?? goal.r });
      if (o.target) { goal.tx = o.target[0]; goal.ty = o.target[1]; goal.tz = o.target[2]; }
      if (!S.springOn) S.syncFromCamera();
      // take the short way round
      while (goal.az - sp.az.x > Math.PI) goal.az -= 2 * Math.PI;
      while (goal.az - sp.az.x < -Math.PI) goal.az += 2 * Math.PI;
      S.w = w; S.springOn = true;
    },
    goal,
    jump(o) { S.flyTo(o); for (const k in sp) { sp[k].x = goal[k]; sp[k].v = 0; } },
    syncFromCamera() {
      const t = controls.target, d = camera.position.clone().sub(t), r = d.length();
      sp.r.x = r; sp.el.x = Math.asin(Math.max(-1, Math.min(1, d.y / r))); sp.az.x = Math.atan2(d.x, d.z);
      sp.tx.x = t.x; sp.ty.x = t.y; sp.tz.x = t.z; for (const k in sp) sp[k].v = 0;
    },
    stopSpring() { S.springOn = false; },
    // rect: the clear area { x0, y0, x1, y1 } in canvas CSS px, or null for all
    frame(rect) { S.clear = rect; S.applyOffset(); },
    applyOffset() {
      const W = S.W, H = S.H, c = S.clear;
      if (!c) { camera.clearViewOffset(); S.fit = 1; return; }
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
      S.fit = Math.max(0.2, Math.min((c.x1 - c.x0) / W, (c.y1 - c.y0) / H));
    },
    resize() {
      const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
      S.dpr = Math.min(coarse ? 1.75 : 2, window.devicePixelRatio || 1);
      renderer.setPixelRatio(S.dpr); renderer.setSize(W, H, false);
      if (composer) { composer.setPixelRatio(S.dpr); composer.setSize(W, H); }
      camera.aspect = W / H; S.W = W; S.H = H; S.applyOffset(); camera.updateProjectionMatrix();
    },
    update(dt) {
      if (S.springOn) {
        for (const k in sp) springStep(sp[k], goal[k], S.w, Math.min(dt, 0.05));
        const r = sp.r.x, el = sp.el.x, az = sp.az.x;
        controls.target.set(sp.tx.x, sp.ty.x, sp.tz.x);
        camera.position.set(sp.tx.x + r * Math.cos(el) * Math.sin(az), sp.ty.x + r * Math.sin(el), sp.tz.x + r * Math.cos(el) * Math.cos(az));
        camera.lookAt(controls.target);
        // a fly-to ends when it settles; the saver sets hold to keep the springs on
        if (!S.hold) {
          let still = Math.abs(sp.r.v) < 0.02 * sp.r.x && Math.abs(sp.az.v) < 0.003 && Math.abs(sp.el.v) < 0.003;
          for (const k in sp) if (Math.abs(sp[k].x - goal[k]) > (k === 'az' || k === 'el' ? 0.002 : 0.002 * sp.r.x)) still = false;
          if (still) S.springOn = false;
        }
      } else controls.update();
    },
    render() { if (composer) composer.render(); else renderer.render(scene, camera); },
    dispose() {
      try { if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); if (bloomPass) bloomPass.dispose(); } } catch (e) { /* gone */ }
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* lost */ }
    },
  };
  controls.addEventListener('start', () => { S.springOn = false; });
  addEventListener('pagehide', () => S.dispose(), { once: true });
  S.resize();
  return S;
}
