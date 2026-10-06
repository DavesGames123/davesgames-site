// ============================================================================
//  BALL SCREW & LEAD SCREW  ·  stage.js — a copy of differential/stage.js (same API)
//  One addition: o.band(), the saver plate band, counts as an occluder.
// ────────────────────────────────────────────────────────────────────────────
//  createStage() follows the watch-movement stage: a WebGL renderer on a
//  transparent canvas, a studio environment for reflections, a key light
//  with soft shadows, an upright Y-up camera on OrbitControls, a gentle
//  orbit when idle, camera flights on spherical arcs, and framing that
//  shifts the view into the area the panels and the dock leave clear.
//  From the Stirling page: local clipping is on (the section cut), and
//  more than one panel can cover the canvas (o.occluders).
//
//  GREP MAP
//    function studioScene ...... the reflection room
//    function createStage ...... the factory
//      st.flyTo / st.place ..... camera moves
//      function occlusion ...... the part of the canvas each panel covers
//      st.frame ................ per-frame camera, resize, render
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const D = Math.PI / 180, TAU = Math.PI * 2;

// a dark studio: a large warm softbox above the front, two tall strips at
// the sides, a cool rim behind and a warm floor bounce
function studioScene() {
  const sc = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pos = room.geometry.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 50, k = 0.035 + 0.05 * Math.max(0, y) + 0.02 * Math.max(0, -y); col.push(k, k * 1.02, k * 1.08); }
  room.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sc.add(room);
  const panel = (w, h, c, I, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(I), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m);
  };
  panel(34, 22, 0xfff3e2, 5.0, 6, 28, 26);
  panel(5, 46, 0xffffff, 3.6, -36, 4, 10);
  panel(5, 46, 0xfff8f0, 2.6, 36, 0, 6);
  panel(30, 8, 0xbcd0ff, 4.0, 0, 10, -40);
  panel(60, 30, 0x8a6a48, 0.5, 0, -40, 0);
  panel(16, 16, 0xffffff, 2.5, -20, 30, -18);
  return sc;
}

// o: { canvas, occluders: [el], coarse, reduced, onNoGL }
export function createStage(o) {
  const { canvas } = o;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { if (o.onNoGL) o.onNoGL(); throw e; }
  // a 2560 px wide window at dpr 2 is 5120 px: cap the drawing buffer
  const dpr = () => Math.min(devicePixelRatio || 1, o.coarse ? 1.75 : 2, Math.max(1, 3200 / Math.max(1, canvas.clientWidth)));
  renderer.setPixelRatio(dpr());
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioScene(), 0.02).texture;
  pmrem.dispose();
  const root = new THREE.Group();
  scene.add(root);

  const camera = new THREE.PerspectiveCamera(30, 1, 2, 8000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 120; controls.maxDistance = 2400;

  const key = new THREE.DirectionalLight(0xfff5ea, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(o.coarse ? 1024 : 2048, o.coarse ? 1024 : 2048);
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.4;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9db6ff, 0.8);
  scene.add(rim, new THREE.HemisphereLight(0xc8d4ff, 0x2a1e10, 0.4));

  const st = { THREE, renderer, scene, root, camera, controls, key, orbit: !o.reduced, orbitAmt: 0, orbitK: 1, idle: 99, dragging: false, fly: null, slow: false };

  // the key light and its shadow box for a model of radius R about c
  st.setShadowExtent = (R, c) => {
    key.position.set(c.x + R * 0.9, c.y + R * 1.5, c.z + R * 1.6); key.target.position.copy(c);
    rim.position.set(-R, -R * 0.5, -R);
    Object.assign(key.shadow.camera, { left: -1.6 * R, right: 1.6 * R, top: 1.6 * R, bottom: -1.6 * R, near: R * 0.5, far: R * 5 });
    key.shadow.camera.updateProjectionMatrix();
    // depth precision follows the near plane: scale it with the model.
    // controls.minDistance is 90 mm (main.js), so 0.02 R (7.8 mm) is safe
    camera.near = Math.max(2, R * 0.02); camera.far = R * 30; camera.updateProjectionMatrix();
  };

  st.flyTo = ({ az, el, r, target, t = 1.4 }) => {
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    let th = az * D; while (th - s0.theta > Math.PI) th -= TAU; while (s0.theta - th > Math.PI) th += TAU;
    st.fly = { t: 0, dur: t, s0, s1: new THREE.Spherical(r, (90 - el) * D, th), t0: controls.target.clone(), t1: target.clone() };
    st.idle = -2;
  };
  st.place = ({ az, el, r, target }) => {
    controls.target.copy(target);
    camera.position.setFromSpherical(new THREE.Spherical(r, (90 - el) * D, az * D)).add(target);
  };
  // move the target and the camera together
  st.shift = v => { if (!st.fly && (v.x || v.y || v.z)) { controls.target.add(v); camera.position.add(v); } };

  controls.addEventListener('start', () => { st.dragging = true; st.fly = null; if (st.onStart) st.onStart(); });
  controls.addEventListener('end', () => { st.dragging = false; st.idle = 0; });
  canvas.addEventListener('pointerdown', () => { st.idle = 0; });
  canvas.addEventListener('wheel', () => { st.idle = 0; }, { passive: true });

  // framing: each panel that covers the canvas pushes the view the other way
  const occ = { l: 0, r: 0, t: 0, b: 0 };
  function occlusion(w, h) {
    const out = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect();
    for (const el of o.occluders || []) {
      if (!el || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const q = el.getBoundingClientRect();
      const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) out.b = Math.max(out.b, cr.bottom - y0); else out.t = Math.max(out.t, y1 - cr.top); }
      else { if (x0 + x1 < cr.left * 2 + w) out.l = Math.max(out.l, x1 - cr.left); else out.r = Math.max(out.r, cr.right - x0); }
    }
    // the saver plate band (o.band() -> { t, b } in CSS px)
    const band = o.band && o.band();
    if (band) { out.t = Math.max(out.t, band.t); out.b = Math.max(out.b, band.b); }
    return out;
  }
  let lastDpr = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const p = dpr(); if (p !== lastDpr) { lastDpr = p; renderer.setPixelRatio(p); }
    renderer.setSize(w, h, false);
    const ob = occlusion(w, h);
    for (const k in occ) occ[k] += (ob[k] - occ[k]) * 0.25;
    const cw = Math.max(80, w - occ.l - occ.r), ch = Math.max(80, h - occ.t - occ.b);
    camera.aspect = w / h;
    // fit the clear area: the model is about as wide as it is tall, so zoom
    // out when the clear width is less than the full height, or it is short.
    // A narrow phone has room above and below: it zooms out a little less.
    const nw = cw / h, gain = 1 + 0.35 * Math.max(0, Math.min(1, (0.9 - nw) / 0.4));
    camera.zoom = Math.min(1, Math.max(0.3, Math.min(nw * gain, ch / h)));
    camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
    camera.updateProjectionMatrix();
  }

  const sph = new THREE.Spherical();
  st.frame = dt => {
    st.idle += dt;
    if (st.fly) {
      st.fly.t = Math.min(1, st.fly.t + dt / st.fly.dur);
      const k = ease(st.fly.t), s0 = st.fly.s0, s1 = st.fly.s1;
      controls.target.lerpVectors(st.fly.t0, st.fly.t1, k);
      sph.set(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + (s1.theta - s0.theta) * k);
      camera.position.setFromSpherical(sph).add(controls.target);
      if (st.fly.t >= 1) st.fly = null;
    }
    const want = st.orbit && !st.dragging && !st.fly && st.idle > 2.5 ? (st.slow ? 0.3 : 1) : 0;
    st.orbitAmt += (want - st.orbitAmt) * Math.min(1, dt * (want > st.orbitAmt ? 0.6 : 4));
    controls.autoRotate = st.orbitAmt > 0.002;
    controls.autoRotateSpeed = -0.45 * st.orbitAmt * st.orbitK;
    controls.update(dt);
    resize();
    renderer.render(scene, camera);
  };
  st.dispose = () => { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {} };
  return st;
}
