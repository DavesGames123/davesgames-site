// ============================================================================
//  HUMAN SKULL  ·  stage.js — renderer, studio light, floor, camera, framing
// ────────────────────────────────────────────────────────────────────────────
//  createStage() owns everything that is not a bone:
//    renderer   WebGL on a transparent canvas; the CSS backdrop shows through.
//               ACES tone mapping, sRGB output, VSM soft shadows.
//    studio     a room of soft boxes made here in code (no HDRI). The PMREM
//               generator turns it into the image-based light. One room per
//               theme: dark is a low-key room, light is a bright white cove.
//    lights     a key light (casts the shadow) where the main soft box is,
//               and a cool rim light opposite. Units are millimetres.
//    floor      a shadow catcher. It draws a soft pool of light and the
//               shadow; the edge fades out. The specimen tray sits on it.
//    camera     OrbitControls; flights on a spherical arc; fit() frames a
//               box in the part of the canvas that the panel, the bars, the
//               dock and the phone card leave clear (camera.setViewOffset).
//
//  GREP MAP
//    function makeStudio ....... the procedural room for the PMREM light
//    function makeFloor ........ the shadow catcher and its light pool
//    st.setTheme ............... swap the room, floor and exposure
//    st.fitBox ................. distance and target to frame a box
//    st.fitSpheres ............. the same for part spheres (the layouts)
//    st.flyTo .................. a camera flight on a spherical arc
//    function occlusion ........ overlay margins round the canvas
//    st.frame .................. per-frame camera, resize, render
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
export const easeInOut = t => t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const D = Math.PI / 180, TAU = Math.PI * 2;

// the key light direction (towards the light); the studio puts its main
// soft box on the same line, so the reflections and the shadow agree
export const KEY_DIR = new THREE.Vector3(-0.5, 1.0, 0.62).normalize();

// ── the studio room for image-based light ──────────────────────────────────
function makeStudio(theme) {
  const dark = theme === 'dark';
  const room = new THREE.Scene();
  const own = [];
  const emit = (c, k) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }); own.push(m); return m; };
  // walls: a vertical gradient on a sphere through vertex colours
  const sg = new THREE.SphereGeometry(10, 48, 24); own.push(sg);
  const col = [], p = sg.attributes.position;
  const top = new THREE.Color(dark ? 0x2b2a2c : 0xf4f1ec).multiplyScalar(dark ? 0.4 : 1.0);
  const mid = new THREE.Color(dark ? 0x1b1b1f : 0xe6e0d6).multiplyScalar(dark ? 0.22 : 0.78);
  const low = new THREE.Color(dark ? 0x2a211a : 0xcbbfae).multiplyScalar(dark ? 0.2 : 0.6);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10, c = new THREE.Color();
    if (y > 0) c.lerpColors(mid, top, Math.pow(y, 0.8)); else c.lerpColors(mid, low, Math.pow(-y, 0.6));
    col.push(c.r, c.g, c.b);
  }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const wm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }); own.push(wm);
  room.add(new THREE.Mesh(sg, wm));
  // soft boxes: [w, h, position dir, distance, colour, strength]
  const boxes = [
    [5.5, 3.6, KEY_DIR.clone(), 6, 0xfff1e0, dark ? 7.5 : 6],                 // key, upper front left
    [9, 7, new THREE.Vector3(0.1, 1, 0.1), 7, 0xfdf8f2, dark ? 0.9 : 2.4],         // overhead
    [2.2, 7, new THREE.Vector3(0.85, 0.25, -0.75), 6.5, dark ? 0xc9d8ff : 0xffffff, dark ? 5.5 : 3],   // rim, back right
    [4, 3, new THREE.Vector3(0.9, 0.1, 0.6), 7, 0xfff6ea, dark ? 0.6 : 1.6],       // fill card, right
    [12, 12, new THREE.Vector3(0, -1, 0.1), 6, dark ? 0x3a2a1c : 0xd9cbb5, dark ? 0.35 : 0.9],    // floor bounce
  ];
  for (const [w, h, dir, dist, c, k] of boxes) {
    const g = new THREE.PlaneGeometry(w, h); own.push(g);
    const m = new THREE.Mesh(g, emit(c, k));
    m.position.copy(dir.clone().normalize().multiplyScalar(dist));
    m.lookAt(0, 0, 0);
    room.add(m);
  }
  return { room, dispose: () => own.forEach(o => o.dispose()) };
}

// ── the floor: shadow catcher with a pool of light ─────────────────────────
function makeFloor() {
  const g = new THREE.PlaneGeometry(4000, 4000);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.ShadowMaterial({ transparent: true, depthWrite: false });
  m.toneMapped = false;
  const U = {
    uPool: { value: new THREE.Color() }, uPoolA: { value: 0 }, uShade: { value: new THREE.Color() }, uShadeA: { value: 0.5 },
    uR: { value: new THREE.Vector2(200, 700) }, uC: { value: new THREE.Vector2() },
  };
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFloor;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFloor = (modelMatrix * vec4(transformed, 1.0)).xz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vFloor; uniform vec3 uPool; uniform float uPoolA; uniform vec3 uShade; uniform float uShadeA; uniform vec2 uR; uniform vec2 uC;`)
      .replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', `
float sh = (1.0 - getShadowMask()) * uShadeA;
float r = length(vFloor - uC);
float fall = 1.0 - smoothstep(uR.x, uR.y, r);
float pool = uPoolA * (1.0 - smoothstep(0.0, uR.y * 0.9, r));
float a = max(pool, sh) * fall;
vec3 c = mix(uPool, uShade, sh / max(a, 1e-4) * fall);
gl_FragColor = vec4(c, a);`);
  };
  m.customProgramCacheKey = () => 'skull-floor';
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.renderOrder = -2;
  return { mesh, U };
}

// o: { canvas, coarse, reduced, occluders(): Element[], onNoGL }
export function createStage(o) {
  const { canvas } = o;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { if (o.onNoGL) o.onNoGL(); throw e; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, o.coarse ? 1.75 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const root = new THREE.Group();
  scene.add(root);

  const camera = new THREE.PerspectiveCamera(28, 1, 10, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.rotateSpeed = o.coarse ? 0.7 : 0.6;
  controls.minDistance = 120; controls.maxDistance = 3200;
  controls.enablePan = !o.coarse;
  controls.screenSpacePanning = true;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  // key light with a soft VSM shadow, and a cool rim
  const key = new THREE.DirectionalLight(0xfff3e6, 2.2);
  key.castShadow = true;
  const sm = o.coarse ? 1024 : 2048;
  key.shadow.mapSize.set(sm, sm);
  key.shadow.radius = o.coarse ? 14 : 22;
  key.shadow.blurSamples = o.coarse ? 12 : 24;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xc8d6ff, 0.8);
  rim.position.set(500, 260, -600);
  scene.add(rim);

  const floor = makeFloor();
  scene.add(floor.mesh);

  const st = {
    THREE, renderer, scene, root, camera, controls, key, rim, floor,
    orbit: !o.reduced, orbitAmt: 0, idle: 0, dragging: false, fly: null, theme: null, env: null,
  };

  // ── themes ────────────────────────────────────────────────────────────────
  const THEMES = {
    dark: { exposure: 0.9, key: 3.0, rim: 1.2, env: 0.8, pool: 0x3a3127, poolA: 0.3, shade: 0x000000, shadeA: 0.48 },
    light: { exposure: 0.92, key: 2.2, rim: 0.3, env: 0.85, pool: 0xffffff, poolA: 0.0, shade: 0x4a3a2a, shadeA: 0.26 },
  };
  st.envIntensity = 1;
  st.setTheme = theme => {
    if (st.theme === theme) return;
    st.theme = theme;
    const T = THEMES[theme];
    const studio = makeStudio(theme);
    const rt = pmrem.fromScene(studio.room, 0.035);
    studio.dispose();
    if (st.env) st.env.dispose();
    st.env = rt;
    scene.environment = rt.texture;
    renderer.toneMappingExposure = T.exposure;
    key.intensity = T.key; rim.intensity = T.rim;
    st.envIntensity = T.env;
    floor.U.uPool.value.set(T.pool); floor.U.uPoolA.value = T.poolA;
    floor.U.uShade.value.set(T.shade); floor.U.uShadeA.value = T.shadeA;
    if (st.onTheme) st.onTheme(theme);
  };

  // ── the floor and the shadow box follow the layout ────────────────────────
  // box: THREE.Box3 of the parts (current and target, merged by the caller)
  const shadowBox = { c: new THREE.Vector3(), r: 300 };
  st.setFloor = (y, box) => {
    floor.mesh.position.y = y;
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 + 40;
    floor.U.uC.value.set(c.x, c.z);
    floor.U.uR.value.set(r * 0.9, r * 2.2);
    // the shadow box must hold the parts and their shadow on the floor
    const fc = new THREE.Vector3(c.x, (y + box.max.y) / 2, c.z);
    const fr = Math.max(r, (box.max.y - y) * 0.75) * 1.35;
    if (Math.abs(fr - shadowBox.r) > 1 || fc.distanceTo(shadowBox.c) > 1) {
      shadowBox.c.copy(fc); shadowBox.r = fr;
      key.target.position.copy(fc);
      key.position.copy(fc).addScaledVector(KEY_DIR, fr * 2.2);
      Object.assign(key.shadow.camera, { left: -fr, right: fr, top: fr, bottom: -fr, near: fr * 0.5, far: fr * 4 });
      key.shadow.camera.updateProjectionMatrix();
    }
  };

  // ── camera ────────────────────────────────────────────────────────────────
  const clear = { l: 0, r: 0, t: 0, b: 0 };     // eased overlay margins (px)
  // distance and target that frame box (seen from az/el) in the clear area
  st.fitBox = (box, az, el, margin = 1.12) => {
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, (90 - el) * D, az * D));
    const fwd = dir.clone().negate(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const c = box.getCenter(new THREE.Vector3());
    let hx = 0, hy = 0, hz = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      hx = Math.max(hx, Math.abs(p.dot(right))); hy = Math.max(hy, Math.abs(p.dot(up))); hz = Math.max(hz, Math.abs(p.dot(fwd)));
    }
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    const ob = occlusion(w, h);
    const cw = Math.max(80, w - ob.l - ob.r), ch = Math.max(80, h - ob.t - ob.b);
    const tn = Math.tan(camera.fov / 2 * D);
    const d = Math.max(hx * margin / (tn * cw / h), hy * margin / (tn * ch / h)) + hz;
    return { az, el, r: Math.min(controls.maxDistance, Math.max(controls.minDistance, d)), target: c };
  };
  // the same, for a list of spheres [{ c: Vector3, r }]: tighter than a box,
  // and the target is the middle of what the camera sees, not of the box
  st.fitSpheres = (list, az, el, margin = 1.08) => {
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, (90 - el) * D, az * D));
    const fwd = dir.clone().negate(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const { c, r } of list) {
      const v = [c.dot(right), c.dot(up), c.dot(fwd)];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k] - r); hi[k] = Math.max(hi[k], v[k] + r); }
    }
    const mid = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), hx = (hi[0] - lo[0]) / 2, hy = (hi[1] - lo[1]) / 2, hz = (hi[2] - lo[2]) / 2;
    const target = right.clone().multiplyScalar(mid[0]).addScaledVector(up, mid[1]).addScaledVector(fwd, mid[2]);
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    const ob = occlusion(w, h);
    const cw = Math.max(80, w - ob.l - ob.r), ch = Math.max(80, h - ob.t - ob.b);
    const tn = Math.tan(camera.fov / 2 * D);
    const d = Math.max(hx * margin / (tn * cw / h), hy * margin / (tn * ch / h)) + hz;
    return { az, el, r: Math.min(controls.maxDistance, Math.max(controls.minDistance, d)), target };
  };
  st.flyTo = ({ az, el, r, target }, dur = 1.4) => {
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    let th = az * D;
    while (th - s0.theta > Math.PI) th -= TAU;
    while (s0.theta - th > Math.PI) th += TAU;
    st.fly = { t: 0, dur: o.reduced ? 0.01 : dur, s0, s1: new THREE.Spherical(r, (90 - el) * D, th), t0: controls.target.clone(), t1: target.clone() };
    st.idle = -1.5;
  };
  // keep the direction, change distance and target
  st.flyKeep = (r, target, dur = 1.2) => {
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    st.flyTo({ az: s.theta / D, el: 90 - s.phi / D, r, target }, dur);
  };
  st.place = ({ az, el, r, target }) => {
    controls.target.copy(target);
    camera.position.setFromSpherical(new THREE.Spherical(r, (90 - el) * D, az * D)).add(target);
  };
  st.view = () => { const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); return { az: s.theta / D, el: 90 - s.phi / D, r: s.radius }; };

  controls.addEventListener('start', () => { st.dragging = true; st.fly = null; if (st.onStart) st.onStart(); });
  controls.addEventListener('end', () => { st.dragging = false; st.idle = 0; });
  canvas.addEventListener('wheel', () => { st.idle = 0; st.fly = null; }, { passive: true });

  // the overlays that cover the canvas: each one becomes a margin on the
  // side it hugs (wide and low: bottom; tall and left: left; and so on)
  function occlusion(w, h) {
    const out = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect();
    for (const el of o.occluders()) {
      if (!el || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const q = el.getBoundingClientRect();
      const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) out.b = Math.max(out.b, cr.bottom - y0); else out.t = Math.max(out.t, y1 - cr.top); }
      else { if (x0 + x1 < cr.left * 2 + w) out.l = Math.max(out.l, x1 - cr.left); else out.r = Math.max(out.r, cr.right - x0); }
    }
    // never let overlays take more than 60% of either axis
    const sx = Math.min(1, w * 0.6 / Math.max(1, out.l + out.r)), sy = Math.min(1, h * 0.6 / Math.max(1, out.t + out.b));
    out.l *= sx; out.r *= sx; out.t *= sy; out.b *= sy;
    return out;
  }
  st.occlusion = () => occlusion(canvas.clientWidth, canvas.clientHeight);
  let lastW = 0, lastH = 0;
  function resize(dt) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (w !== lastW || h !== lastH) { renderer.setSize(w, h, false); lastW = w; lastH = h; }
    camera.aspect = w / h;
    const ob = occlusion(w, h), k = Math.min(1, dt * 8);
    for (const s in clear) clear[s] += (ob[s] - clear[s]) * k;
    camera.setViewOffset(w, h, (clear.l - clear.r) / -2, (clear.t - clear.b) / -2, w, h);
    camera.updateProjectionMatrix();
  }

  const sph = new THREE.Spherical();
  st.frame = dt => {
    st.idle += dt;
    if (st.fly) {
      const f = st.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = easeInOut(f.t);
      controls.target.lerpVectors(f.t0, f.t1, k);
      sph.set(f.s0.radius + (f.s1.radius - f.s0.radius) * k, f.s0.phi + (f.s1.phi - f.s0.phi) * k, f.s0.theta + (f.s1.theta - f.s0.theta) * k);
      camera.position.setFromSpherical(sph).add(controls.target);
      if (f.t >= 1) st.fly = null;
    }
    const want = st.orbit && !st.dragging && !st.fly && st.idle > 3 && !st.hold ? 1 : 0;
    st.orbitAmt += (want - st.orbitAmt) * Math.min(1, dt * (want > st.orbitAmt ? 0.5 : 5));
    controls.autoRotate = st.orbitAmt > 0.002;
    controls.autoRotateSpeed = -0.32 * st.orbitAmt;
    controls.update(dt);
    resize(dt);
    renderer.render(scene, camera);
  };
  st.dispose = () => {
    try {
      controls.dispose();
      if (st.env) st.env.dispose();
      pmrem.dispose();
      floor.mesh.geometry.dispose(); floor.mesh.material.dispose();
      key.shadow.map && key.shadow.map.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    } catch (e) {}
  };
  return st;
}
