// ============================================================================
//  MAXWELL'S EQUATIONS  ·  stage.js — renderer, camera, light and the frame
// ----------------------------------------------------------------------------
//  One WebGL renderer for all scenes. A scene is a THREE.Group that the
//  stage shows or hides. The stage owns:
//    renderer      antialiased, ACES tone map, local clipping on
//    composer      MSAA render target, a soft bloom, the output pass
//    camera        perspective; flyTo() eases it to a pose; OrbitControls
//                  turn it, and a slow drift turns it when the reader is idle
//    light         a room environment (PMREM) plus a key and a rim light
//    labels        HTML labels that follow 3D points
//    occlusion     setViewOffset frames the subject in the free part of the
//                  canvas (the phone sheet covers the lower part)
//
//  GREP MAP   (grep -n "<anchor>" stage.js)
//    "export function createStage"  "function resize"  "function flyTo"
//    "function frame"  "function addLabel"  "function setOcclusion"
// ============================================================================
import { THREE, LINE_MATS, RES, DPR, ease5 } from './kit.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createStage(canvas, { labelsEl = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x07090d, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const key = new THREE.DirectionalLight(0xfff1e0, 1.4); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9cc8ff, 0.9); rim.position.set(-4, 2, -5); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x8fa6c8, 0x0a0c10, 0.35));

  // A faint floor disc gives depth without a grid.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 96), new THREE.ShaderMaterial({
    uniforms: {}, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vU; void main(){ vU = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vU; void main(){ float r = length(vU) / 9.0; float a = 0.22 * (1.0 - smoothstep(0.0, 1.0, r)); gl_FragColor = vec4(vec3(0.10, 0.13, 0.18), a); }',
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.2;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 200);
  camera.position.set(4, 2.6, 5.5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.minDistance = 1.5; controls.maxDistance = 22;
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;

  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.55, 0.62);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const S = {
    renderer, scene, camera, controls, composer, bloom,
    w: 1, h: 1, occ: { t: 0, b: 0, l: 0, r: 0 }, fly: null, idle: 0, drift: 0.04,
    labels: [], tick: null, running: true, last: performance.now(), t: 0, fade: 1, fadeTarget: 1,
    paused: false, saver: false, saverTick: null,
  };
  let lastInput = performance.now();
  for (const ev of ['pointerdown', 'wheel', 'touchstart']) canvas.addEventListener(ev, () => { lastInput = performance.now(); S.fly = null; }, { passive: true });

  // Black veil for fades between steps.
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float uA; void main(){ gl_FragColor = vec4(0.027, 0.035, 0.05, uA); }',
  }));
  veil.frustumCulled = false; veil.renderOrder = 1e6;
  scene.add(veil);

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, w * h > 1.6e6 ? 1.5 : 2);
    if (w === S.w && h === S.h && dpr === S.dpr) return;
    S.w = w; S.h = h; S.dpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.setSize(w * dpr, h * dpr);
    RES.set(w * dpr, h * dpr);
    DPR.value = dpr;
    for (const m of LINE_MATS) m.resolution.copy(RES);
    applyView();
  }
  // Occlusion in CSS px of the canvas: the free area is the canvas minus
  // t (top), b (bottom), l, r. The camera centre moves to its centre.
  function setOcclusion(o) { S.occ = { t: 0, b: 0, l: 0, r: 0, ...o }; applyView(); }
  function applyView() {
    const { w, h, occ } = S;
    camera.aspect = w / h;
    const fw = Math.max(1, w - occ.l - occ.r), fh = Math.max(1, h - occ.t - occ.b);
    // A shorter free area shows the subject a little smaller, so it fits.
    // The saver fits its own camera distance to the band, so it keeps zoom 1.
    camera.zoom = S.saver ? 1 : Math.max(0.6, Math.min(1, fh / h + 0.18));
    camera.setViewOffset(w, h, (occ.r - occ.l) / 2, (occ.b - occ.t) / 2, w, h);
    camera.updateProjectionMatrix();
    S.free = { fw, fh };
  }

  // Ease the camera to { pos, target } in dur seconds.
  function flyTo(pose, dur = 1.6) {
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    S.fly = { p0, t0, p1: new THREE.Vector3(...pose.pos), t1: new THREE.Vector3(...pose.target || [0, 0, 0]), k: 0, dur };
    if (dur <= 0) { camera.position.copy(S.fly.p1); controls.target.copy(S.fly.t1); S.fly = null; controls.update(); }
  }

  function addLabel(el, fn) { S.labels.push({ el, fn }); return el; }
  function clearLabels() { for (const L of S.labels) L.el.remove(); S.labels = []; }
  const _v = new THREE.Vector3();
  function placeLabels() {
    for (const L of S.labels) {
      const p = L.fn();
      if (!p) { L.el.style.opacity = 0; continue; }
      _v.set(p[0], p[1], p[2]).project(camera);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      L.el.style.opacity = vis ? (p[3] ?? 1) : 0;
      L.el.style.transform = `translate(${((_v.x + 1) / 2 * S.w).toFixed(1)}px, ${((1 - _v.y) / 2 * S.h).toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
  // Screen point (CSS px) of a world point.
  function project(p) {
    _v.set(p[0], p[1], p[2]).project(camera);
    return [(_v.x + 1) / 2 * S.w, (1 - _v.y) / 2 * S.h, _v.z];
  }

  const camQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  function frame(now) {
    if (!S.running) return;
    requestAnimationFrame(frame);
    resize();
    let dt = Math.min(0.05, (now - S.last) / 1000);
    S.last = now;
    if (S.paused) dt = 0;
    S.t += dt;
    if (S.fly) {
      const f = S.fly; f.k = Math.min(1, f.k + dt / f.dur);
      const e = ease5(f.k);
      camera.position.lerpVectors(f.p0, f.p1, e);
      controls.target.lerpVectors(f.t0, f.t1, e);
      if (f.k >= 1) S.fly = null;
    } else if (!S.saver && now - lastInput > 6000 && S.drift) {
      // a slow drift round the vertical axis when the reader is idle
      const a = S.drift * dt, t = controls.target;
      const x = camera.position.x - t.x, z = camera.position.z - t.z;
      camera.position.x = t.x + x * Math.cos(a) - z * Math.sin(a);
      camera.position.z = t.z + x * Math.sin(a) + z * Math.cos(a);
    }
    controls.update();
    if (S.tick) S.tick(dt, S.t);
    if (S.saverTick) S.saverTick(dt);
    camQ.copy(camera.quaternion);
    scene.traverse(o => {
      if (!o.userData.billboard || !o.visible) return;
      o.parent.getWorldQuaternion(parentQ);
      o.quaternion.copy(parentQ.invert().multiply(camQ));
    });
    S.fade += (S.fadeTarget - S.fade) * Math.min(1, dt * 6);
    veil.material.uniforms.uA.value = 1 - S.fade;
    veil.visible = S.fade < 0.999;
    composer.render();
    placeLabels();
  }
  requestAnimationFrame(frame);

  Object.assign(S, { resize, setOcclusion, flyTo, addLabel, clearLabels, project, canvas });
  return S;
}
