// ============================================================================
//  FOUR-STROKE ENGINE  ·  stage.js — renderer, light, camera, orbit, framing
// ────────────────────────────────────────────────────────────────────────────
//  From watch-movement/stage.js. createStage() makes the WebGL renderer on a
//  transparent canvas, a studio environment for reflections, a key light
//  with shadows, a Y-up camera on OrbitControls, the gentle orbit, camera
//  flights on spherical arcs, and framing that shifts the view into the part
//  that the panels leave clear. Changes from the watch version:
//    - local clipping is on (the section cut of the castings, kit.js)
//    - o.occluders is a list (the controls panel and the analysis panel)
//    - st.setDpr(cap) sets the pixel-ratio cap (the screensaver lowers it)
//
//  GREP MAP
//    function createStage ...... the factory
//      st.flyTo / st.fitTo ..... camera moves (spherical arc / distance ease)
//      st.setShadowExtent ...... shadow box for the model's size
//      function occlusion ...... the screen edges the panels cover
//      st.frame ................ per-frame camera update, resize, render
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const D = Math.PI / 180, TAU = Math.PI * 2;

// A photographer's studio for reflections: a dark room, a large key
// softbox above the front, two tall strips at the sides, a cool rim panel
// behind and a warm floor bounce. Polished metal mirrors these shapes, so
// its highlights read as long, soft-edged bands instead of a grey room.
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
  panel(34, 22, 0xfff3e2, 5.0, 6, 28, 26);      // key softbox, above the front
  panel(5, 46, 0xffffff, 3.6, -36, 4, 10);      // strip, left
  panel(5, 46, 0xfff8f0, 2.6, 36, 0, 6);        // strip, right
  panel(30, 8, 0xbcd0ff, 4.0, 0, 10, -40);      // rim, behind
  panel(60, 30, 0x8a6a48, 0.5, 0, -40, 0);      // floor bounce
  panel(16, 16, 0xffffff, 2.5, -20, 30, -18);   // a small top-back kicker
  return sc;
}

// o: { canvas, occluders: [elements], coarse, reduced, onNoGL }
export function createStage(o) {
  const { canvas } = o, occluders = (o.occluders || []).filter(Boolean);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { if (o.onNoGL) o.onNoGL(); throw e; }
  let dprCap = o.coarse ? 1.75 : 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(o.room ? new RoomEnvironment(renderer) : studioScene(), 0.02).texture;
  const root = new THREE.Group();
  scene.add(root);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 6000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 12; controls.maxDistance = 360;

  const key = new THREE.DirectionalLight(0xfff5ea, 1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(o.coarse ? 1024 : 2048, o.coarse ? 1024 : 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9db6ff, 0.9);
  scene.add(rim, new THREE.HemisphereLight(0xc8d4ff, 0x2a1e10, 0.35));

  const st = {
    THREE, renderer, scene, root, camera, controls, key,
    orbit: !o.reduced, orbitAmt: 0, orbitK: 1, idle: 99, dragging: false, fly: null, fit: null, slow: false,
  };

  // the key light and its shadow box scale with the model (R: its radius)
  st.setShadowExtent = R => {
    const s = R / 18;
    key.position.set(34 * s, 52 * s, 70 * s); rim.position.set(-50 * s, -30 * s, -40 * s);
    Object.assign(key.shadow.camera, { left: -2 * R, right: 2 * R, top: 2 * R, bottom: -2 * R, near: 5 * s, far: 280 * s });
    key.shadow.camera.updateProjectionMatrix();
    controls.minDistance = R * 0.6; controls.maxDistance = R * 22;
    // depth precision follows the near plane: a 300 mm clock needs a farther one
    camera.near = Math.max(0.5, R * 0.04); camera.far = R * 300; camera.updateProjectionMatrix();
  };
  st.setShadowExtent(18);

  // a flight along a spherical arc round the target
  st.flyTo = ({ az, el, r, target }) => {
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    let th = az * D; while (th - s0.theta > Math.PI) th -= TAU; while (s0.theta - th > Math.PI) th += TAU;
    st.fly = { t: 0, s0, s1: new THREE.Spherical(r, (90 - el) * D, th), t0: controls.target.clone(), t1: target.clone() };
    st.fit = null; st.idle = -2;
  };
  // ease the distance and the target after a swap, keeping the direction
  st.fitTo = (r, target) => {
    st.fit = { t: 0, r0: camera.position.clone().sub(controls.target).length(), r1: r, t0: controls.target.clone(), t1: target.clone() };
    st.fly = null;
  };
  st.place = ({ az, el, r, target }) => {
    controls.target.copy(target);
    camera.position.setFromSpherical(new THREE.Spherical(r, (90 - el) * D, az * D)).add(target);
  };
  // move target and camera together (keeps the view)
  st.shift = dz => { if (dz && !st.fly && !st.fit) { controls.target.z += dz; camera.position.z += dz; } };

  controls.addEventListener('start', () => { st.dragging = true; st.fly = null; st.fit = null; if (st.onStart) st.onStart(); });
  controls.addEventListener('end', () => { st.dragging = false; st.idle = 0; });
  canvas.addEventListener('pointerdown', () => { st.idle = 0; });
  canvas.addEventListener('wheel', () => { st.idle = 0; st.fit = null; }, { passive: true });

  // framing: shift the view into the area the panel leaves clear
  const occ = { l: 0, r: 0, t: 0, b: 0 };
  function occlusion(w, h) {
    const out = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect();
    for (const el of occluders) {
      if (getComputedStyle(el).display === 'none') continue;
      const q = el.getBoundingClientRect();
      const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) out.b = Math.max(out.b, cr.bottom - y0); else out.t = Math.max(out.t, y1 - cr.top); }
      else { if (x0 + x1 < cr.left * 2 + w) out.l = Math.max(out.l, x1 - cr.left); else out.r = Math.max(out.r, cr.right - x0); }
    }
    return out;
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.zoom = Math.min(1, Math.max(0.72, camera.aspect / 1.3));
    const ob = occlusion(w, h);
    for (const k in occ) occ[k] += (ob[k] - occ[k]) * 0.25;
    camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
    camera.updateProjectionMatrix();
  }

  const sph = new THREE.Spherical();
  st.frame = dt => {
    st.idle += dt;
    if (st.fly) {
      st.fly.t = Math.min(1, st.fly.t + dt / 1.3);
      const k = ease(st.fly.t), s0 = st.fly.s0, s1 = st.fly.s1;
      controls.target.lerpVectors(st.fly.t0, st.fly.t1, k);
      sph.set(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + (s1.theta - s0.theta) * k);
      camera.position.setFromSpherical(sph).add(controls.target);
      if (st.fly.t >= 1) st.fly = null;
    } else if (st.fit) {
      st.fit.t = Math.min(1, st.fit.t + dt / 1.2);
      const k = ease(st.fit.t);
      const off = camera.position.clone().sub(controls.target).setLength(st.fit.r0 + (st.fit.r1 - st.fit.r0) * k);
      controls.target.lerpVectors(st.fit.t0, st.fit.t1, k);
      camera.position.copy(controls.target).add(off);
      if (st.fit.t >= 1) st.fit = null;
    }
    const want = st.orbit && !st.dragging && !st.fly && st.idle > 2.5 ? (st.slow ? 0.3 : 1) : 0;
    st.orbitAmt += (want - st.orbitAmt) * Math.min(1, dt * (want > st.orbitAmt ? 0.6 : 4));
    controls.autoRotate = st.orbitAmt > 0.002;
    controls.autoRotateSpeed = -0.5 * st.orbitAmt * st.orbitK;   // orbitK: screensaver calm
    controls.update(dt);
    resize();
    renderer.render(scene, camera);
  };
  st.setDpr = cap => { dprCap = cap; renderer.setPixelRatio(Math.min(devicePixelRatio, cap)); };
  st.dispose = () => { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {} };
  return st;
}
