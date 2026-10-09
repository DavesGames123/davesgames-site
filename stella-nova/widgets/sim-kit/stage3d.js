// ============================================================================
//  SIM KIT STAGE 3D  ·  widgets/sim-kit/stage3d.js
// ----------------------------------------------------------------------------
//  createStage(opts) builds the three.js stage of a 3D sim kit page: the
//  renderer, the scene, the lights, the floor, the camera and its orbit
//  controls, a spring camera for the screensaver, a pointer that grabs
//  and throws bodies, and the theme look. It uses the global THREE of the
//  page (vendor/three@0.139.2 build/three.min.js, a classic script), so
//  the upstream Ten Minute Physics code and this module share one THREE.
//
//  The look follows the sim kit theme (core.THEMES): the background, the
//  fog, the floor and the grid take the theme colours. setLook() also
//  takes a lighting preset (LIGHTS), a floor style (FLOORS) and a material
//  finish (FINISHES) for material().
//
//  The view: the stage canvas covers the window. fit(rect) moves the
//  principal point to the centre of the clear rect (CSS px), so the scene
//  sits beside the panel or inside the saver band without a resize.
//
//  No WebGL (or a test DOM): the renderer is null, render() does nothing,
//  and stage.gl is false. The physics and the GUI still run.
//
//  createStage({ THREE, parent, phone, fov, near, far, floorSize,
//                shadows, controls, xr, target, camera: [x, y, z] })
//  returns stage = {
//    THREE, renderer, scene, camera, controls, gl, canvas,
//    setLook({ theme, light, floor, fog, finish }), look,
//    material(color, finish?)   cached MeshStandard / Toon material
//    fit(rect | null), resize(), render(),
//    cam: { auto, goal: { pos, target }, set(pos, target), snap(), track }
//    tick(dt)                   the spring camera (when cam.auto)
//    grab({ pick(ray) -> { id, point } | null, move(id, point, vel),
//           drop(id, vel) })    pointer drag and throw on the canvas
//    shadowBox(r, cx, cz)       key light shadow frustum around the scene
//    dispose()
//  }
//
//  grep -n targets
//    lighting presets ..... "export const LIGHTS"
//    floor styles ......... "export const FLOORS"
//    finishes ............. "export const FINISHES"
//    entry ................ "export function createStage"
//    theme look ........... "function setLook"
//    view offset .......... "function fit"
//    spring camera ........ "function tick"
//    pointer throw ........ "function grab"
// ============================================================================
import * as K from './core.js';

// Lighting presets: hemisphere sky/ground, key colour and strength, fill.
export const LIGHTS = [
  { id: 'studio', label: 'Studio', sky: '#dfe8ff', ground: '#3a3f4a', hemi: 0.55, key: '#ffffff', keyI: 1.05, fill: '#9fb8ff', fillI: 0.35, rim: '#ffffff', rimI: 0.25 },
  { id: 'sunset', label: 'Sunset', sky: '#ffcf9e', ground: '#3b2230', hemi: 0.5, key: '#ffb070', keyI: 1.15, fill: '#7a6cff', fillI: 0.35, rim: '#ff7a59', rimI: 0.35 },
  { id: 'moon', label: 'Moonlight', sky: '#9fb6ff', ground: '#0d1220', hemi: 0.35, key: '#cfe0ff', keyI: 0.85, fill: '#3a4f9a', fillI: 0.3, rim: '#7fa8ff', rimI: 0.45 },
  { id: 'neon', label: 'Neon', sky: '#ff5fd2', ground: '#101030', hemi: 0.4, key: '#7af7ff', keyI: 0.95, fill: '#ff4fa3', fillI: 0.55, rim: '#b26bff', rimI: 0.6 },
  { id: 'overcast', label: 'Overcast', sky: '#f2f4f7', ground: '#5c6470', hemi: 0.85, key: '#ffffff', keyI: 0.55, fill: '#dfe6ee', fillI: 0.3, rim: '#ffffff', rimI: 0.1 },
  { id: 'forge', label: 'Forge', sky: '#ffb36b', ground: '#1e0d06', hemi: 0.4, key: '#ff9a4a', keyI: 1.1, fill: '#ff5530', fillI: 0.35, rim: '#ffd27a', rimI: 0.45 },
];
export const FLOORS = [
  { id: 'grid', label: 'Grid' }, { id: 'plain', label: 'Plain' }, { id: 'checker', label: 'Checker' }, { id: 'glass', label: 'Glossy' }, { id: 'none', label: 'None' },
];
export const FINISHES = [
  { id: 'gloss', label: 'Gloss', rough: 0.28, metal: 0.05 },
  { id: 'matte', label: 'Matte', rough: 0.85, metal: 0.0 },
  { id: 'metal', label: 'Metal', rough: 0.32, metal: 0.75 },
  { id: 'toon', label: 'Toon', toon: true },
  { id: 'clay', label: 'Clay', rough: 1.0, metal: 0.0, sheen: true },
];
export const lightById = id => LIGHTS.find(l => l.id === id) || LIGHTS[0];
export const finishById = id => FINISHES.find(f => f.id === id) || FINISHES[0];
// Ready-made schema controls for the look group.
export function lightControl(value = 'studio', extra = {}) {
  return Object.assign({ key: 'light', type: 'choice', label: 'Lighting', seg: false, value, options: LIGHTS.map(l => ({ id: l.id, label: l.label })) }, extra);
}
export function floorControl(value = 'grid', extra = {}) {
  return Object.assign({ key: 'floor', type: 'choice', label: 'Floor', seg: false, value, options: FLOORS.map(f => ({ id: f.id, label: f.label })), random: { weights: { grid: 4, plain: 2, checker: 2, glass: 2, none: 1 } } }, extra);
}
export function finishControl(value = 'gloss', extra = {}) {
  return Object.assign({ key: 'finish', type: 'choice', label: 'Material', seg: false, value, options: FINISHES.map(f => ({ id: f.id, label: f.label })), random: { weights: { gloss: 4, matte: 2, metal: 2, toon: 1, clay: 1 } } }, extra);
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createStage(opts = {}) {
  const THREE = opts.THREE || globalThis.THREE;
  const phone = !!opts.phone;
  const parent = opts.parent || (typeof document !== 'undefined' ? document.body : null);
  const stage = { THREE, gl: false, renderer: null, canvas: null, look: null };

  // ---- renderer (null without WebGL) -------------------------------------
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: 'high-performance', alpha: false });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, phone ? 1.5 : 2));
    renderer.shadowMap.enabled = opts.shadows !== false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Linear output, as the upstream demos: theme hex colours read as set.
    if (opts.xr) renderer.xr.enabled = true;
    stage.gl = true;
  } catch (e) { renderer = null; }
  stage.renderer = renderer;
  const canvas = renderer ? renderer.domElement : (typeof document !== 'undefined' ? document.createElement('canvas') : { width: 1, height: 1 });
  canvas.id = canvas.id || 'view';
  if (canvas.classList) canvas.classList.add('sk-stage');
  stage.canvas = canvas;
  if (parent && parent.appendChild) parent.insertBefore ? parent.insertBefore(canvas, parent.firstChild) : parent.appendChild(canvas);

  // ---- scene, camera, lights ----------------------------------------------------
  const scene = new THREE.Scene();
  stage.scene = scene;
  const camera = new THREE.PerspectiveCamera(opts.fov || 50, 1, opts.near || 0.02, opts.far || 200);
  const c0 = opts.camera || [0, 1.6, 5];
  camera.position.set(c0[0], c0[1], c0[2]);
  stage.camera = camera;
  const target0 = new THREE.Vector3().fromArray(opts.target || [0, 0.6, 0]);
  camera.lookAt(target0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(3.5, 6, 3);
  key.castShadow = true;
  const sm = phone ? 1024 : 2048;
  key.shadow.mapSize.set(sm, sm);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(0x99aaff, 0.3); fill.position.set(-4, 2.5, -2);
  const rim = new THREE.DirectionalLight(0xffffff, 0.25); rim.position.set(-1, 3, -5);
  scene.add(hemi, key, key.target, fill, rim);
  stage.lights = { hemi, key, fill, rim };
  function shadowBox(r = 4, cx = 0, cz = 0) {
    const sc = key.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = 20 + 2 * r;
    key.target.position.set(cx, 0, cz);
    key.position.set(cx + 0.55 * 6, 6 + r * 0.5, cz + 0.45 * 6);
    sc.updateProjectionMatrix && sc.updateProjectionMatrix();
  }
  shadowBox(opts.shadowR || 4);
  stage.shadowBox = shadowBox;

  // ---- floor ----------------------------------------------------------------------
  const FS = opts.floorSize || 40;
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x334, roughness: 0.9, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FS, FS, 1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor';
  scene.add(floor);
  let grid = null, checkerTex = null;
  stage.floor = floor;
  function checker(a, b) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext && c.getContext('2d'); if (!x) return null;
    x.fillStyle = a; x.fillRect(0, 0, 64, 64); x.fillStyle = b; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(FS / 1, FS / 1);
    t.magFilter = THREE.NearestFilter; t.anisotropy = 4;
    return t;
  }

  // ---- look ----------------------------------------------------------------------------
  const mats = new Map();
  function material(color, finish) {
    const f = finishById(finish || (stage.look && stage.look.finish) || 'gloss');
    const k = color + '|' + f.id;
    let m = mats.get(k);
    if (m) return m;
    const col = new THREE.Color(color);
    if (f.toon) m = new THREE.MeshToonMaterial({ color: col });
    else m = new THREE.MeshStandardMaterial({ color: col, roughness: f.rough, metalness: f.metal });
    mats.set(k, m);
    return m;
  }
  stage.material = material;

  function setLook(L) {
    L = Object.assign({ theme: 'night', light: 'studio', floor: 'grid', fog: true, finish: 'gloss' }, stage.look || {}, L || {});
    stage.look = L;
    const t = K.themeById(L.theme), li = lightById(L.light);
    const bg = new THREE.Color(t.bg);
    scene.background = bg;
    if (renderer) renderer.setClearColor(bg, 1);
    scene.fog = L.fog ? new THREE.Fog(t.bg, opts.fogNear || 9, opts.fogFar || 30) : null;
    hemi.color.set(li.sky); hemi.groundColor.set(li.ground); hemi.intensity = li.hemi;
    key.color.set(li.key); key.intensity = li.keyI;
    fill.color.set(li.fill); fill.intensity = li.fillI;
    rim.color.set(li.rim); rim.intensity = li.rimI;
    // floor: a shade between the background and its second tone
    const base = K.mixHex(t.bg, t.bg2, t.dark ? 0.7 : 0.5), alt = K.mixHex(base, t.dark ? '#ffffff' : '#000000', 0.07);
    floor.visible = L.floor !== 'none';
    floorMat.map = null;
    if (checkerTex) { checkerTex.dispose(); checkerTex = null; }
    floorMat.color.set(L.floor === 'checker' ? '#ffffff' : base);
    floorMat.roughness = L.floor === 'glass' ? 0.12 : 0.9;
    floorMat.metalness = L.floor === 'glass' ? 0.35 : 0;
    if (L.floor === 'checker') { checkerTex = checker(base, alt); floorMat.map = checkerTex; }
    floorMat.needsUpdate = true;
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
    if (L.floor === 'grid') {
      grid = new THREE.GridHelper(FS, FS * 2, new THREE.Color(t.accent), new THREE.Color(K.mixHex(base, t.wall, 0.22)));
      grid.material.transparent = true; grid.material.opacity = 0.55; grid.position.y = 0.002;
      scene.add(grid);
    }
    for (const m of mats.values()) m.dispose();
    mats.clear();
    return L;
  }
  stage.setLook = setLook;

  // ---- controls ----------------------------------------------------------------------
  let controls = null;
  if (opts.controls !== false && THREE.OrbitControls && renderer) {
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.zoomSpeed = 1.2; controls.panSpeed = 0.6;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.copy(target0); controls.update();
  }
  stage.controls = controls;

  // ---- view -------------------------------------------------------------------------
  let W = 1, H = 1, rect = null;
  function resize() {
    W = Math.max(1, globalThis.innerWidth || 1); H = Math.max(1, globalThis.innerHeight || 1);
    if (renderer) renderer.setSize(W, H, true);
    camera.aspect = W / H;
    fit(rect);
  }
  // rect: the clear area in CSS px { x, y, w, h }; the view centre moves
  // there and the vertical field fits its height.
  function fit(r) {
    rect = r || null;
    if (!rect) { camera.clearViewOffset(); camera.aspect = W / H; camera.updateProjectionMatrix(); return; }
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  stage.resize = resize; stage.fit = fit;
  stage.size = () => ({ W, H, rect });

  // ---- spring camera (screensaver) --------------------------------------------------
  const cam = {
    auto: false,
    goal: { pos: camera.position.clone(), target: target0.clone() },
    cur: target0.clone(), vel: new THREE.Vector3(), tvel: new THREE.Vector3(),
    k: 2.2,
    set(pos, target) { if (pos) this.goal.pos.copy(pos); if (target) this.goal.target.copy(target); },
    snap() { camera.position.copy(this.goal.pos); this.cur.copy(this.goal.target); this.vel.set(0, 0, 0); this.tvel.set(0, 0, 0); camera.lookAt(this.cur); },
  };
  stage.cam = cam;
  const tmp = new THREE.Vector3();
  // A critically damped spring toward the goal: x'' = k^2 (g - x) - 2k x'.
  function spring(x, v, g, k, dt) {
    tmp.subVectors(g, x).multiplyScalar(k * k).addScaledVector(v, -2 * k);
    v.addScaledVector(tmp, dt); x.addScaledVector(v, dt);
  }
  function tick(dt) {
    if (cam.auto) {
      const h = Math.min(dt, 1 / 30), n = Math.max(1, Math.ceil(dt / h));
      for (let i = 0; i < n; i++) { spring(camera.position, cam.vel, cam.goal.pos, cam.k, dt / n); spring(cam.cur, cam.tvel, cam.goal.target, cam.k * 1.2, dt / n); }
      camera.up.set(0, 1, 0);
      camera.lookAt(cam.cur);
    } else if (controls) controls.update();
  }
  stage.tick = tick;
  stage.setAuto = on => {
    cam.auto = !!on;
    if (controls) controls.enabled = !on;
    if (on) { cam.cur.copy(controls ? controls.target : target0); cam.goal.pos.copy(camera.position); cam.goal.target.copy(cam.cur); }
    else if (controls) { controls.target.copy(cam.cur); controls.update(); }
  };

  // ---- pointer: grab and throw ------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3();
  function rayAt(e) {
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: W, height: H };
    ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  stage.rayAt = rayAt;
  function grab(h) {
    let held = null, last = null, lastT = 0;
    const vel = new THREE.Vector3();
    const down = e => {
      if (cam.auto || e.button > 0) return;
      const p = h.pick(rayAt(e));
      if (!p) return;
      held = p.id; last = p.point.clone(); lastT = performance.now(); vel.set(0, 0, 0);
      const n = new THREE.Vector3(); camera.getWorldDirection(n);
      plane.setFromNormalAndCoplanarPoint(n.negate(), p.point);
      if (controls) controls.enabled = false;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      e.preventDefault && e.preventDefault();
      if (h.start) h.start(held, p.point);
    };
    const move = e => {
      if (held == null) return;
      if (!rayAt(e).ray.intersectPlane(plane, hit)) return;
      const now = performance.now(), dt = Math.max(0.008, (now - lastT) / 1000);
      vel.subVectors(hit, last).multiplyScalar(1 / dt).clampLength(0, 25);
      last.copy(hit); lastT = now;
      h.move(held, hit, vel);
    };
    const up = () => {
      if (held == null) return;
      const id = held; held = null;
      if (controls && !cam.auto) controls.enabled = true;
      h.drop(id, vel.clone());
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return { get held() { return held; } };
  }
  stage.grab = grab;

  stage.render = () => { if (renderer) renderer.render(scene, camera); };
  stage.dispose = () => {
    for (const m of mats.values()) m.dispose();
    mats.clear();
    if (controls) controls.dispose();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); }
  };
  if (typeof addEventListener === 'function') addEventListener('resize', resize);
  setLook(opts.look || {});
  resize();
  return stage;
}
