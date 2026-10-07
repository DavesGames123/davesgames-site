// ============================================================================
//  IMAGE WORLDS  ·  viewer.js — the splat, the meshes, the light and the loop
// ────────────────────────────────────────────────────────────────────────────
//  three.js r185 (vendor/three@0.185.1) and Spark 2.3.1
//  (vendor/spark@2.3.1): Spark 2 needs three >= 0.180, so this page does
//  not use the site's r160 copy. GLTFLoader r185 is in three-addons/.
//
//  WORLD TRANSFORM  (upstream SplatRenderer and WorldCollider)
//    worldGroup: position (0, groundOffset, 0), rotation x = PI when flip_y
//    (World Labs SPZ files are in OpenCV axes, y down), scale metricScale.
//    The splat and the collider mesh are children of worldGroup. The
//    objects and the camera are in the y-up world.
//  SPAWN  (upstream spawn.ts) eye at (0, 1.85, -0.5), looking down -z. A
//    manifest entry can set start { position, target } instead.
//  LIGHT  a sun from scene.json sun.rotation (upstream
//    sunPositionFromRotation), the world panorama as the environment when
//    there is one, else RoomEnvironment. Shadows fall on the collider mesh
//    through a ShadowMaterial (upstream shadow catcher), Full quality only.
//  QUALITY  (QUALITY below) the splat file (100k / 500k / full_res), the
//    pixel ratio, Spark maxStdDev and the LoD splat budget.
//  LOADING  every file is read through its ENTRY (worlds.js): bytes are
//    joined at their real size, then given to Spark as fileBytes.
//  RENDER  every frame while the page is visible. The view can be moved
//    (setInsets top, bottom, left) so the world centres in the part of the
//    canvas that the panel, the sheet, the dock or the saver plate leave clear.
//
//  EXPORTS  createViewer({ canvas, onStatus }) -> viewer (see the return)
//  grep -n: "const QUALITY", "async function open", "async function loadSplat",
//           "function frame", "function dispose", "function snapshot"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { GLTFLoader } from './three-addons/loaders/GLTFLoader.js';
import { parseSplatHeader, HEAD_BYTES } from './splat-header.js';
import { pickSplat } from './worlds.js';
import { createControls, EYE } from './controls.js';
import { createObjects } from './objects.js';
import { createAudio } from './audio.js';
import { createGround } from './ground.js';

export const QUALITY = {
  low: { label: 'Phone', splat: 'low', dpr: 1, maxStdDev: Math.sqrt(6.5), lod: 0.5, shadows: false },
  mid: { label: 'Balanced', splat: 'mid', dpr: 1.5, maxStdDev: Math.sqrt(7), lod: 1, shadows: false },
  high: { label: 'Full', splat: 'high', dpr: 2, maxStdDev: Math.sqrt(8), lod: 1.6, shadows: true },
};
export const SPAWN = new THREE.Vector3(0, 1.85, -0.5);

export function sunPosition([rx, ry, rz]) {
  let x = 0, y = 10, z = 0;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
}

export function createViewer({ canvas, onStatus = () => {}, quality = 'mid' }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e13);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
  camera.position.copy(SPAWN);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = roomEnv; scene.environmentIntensity = 1;
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0001; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { near: 0.5, far: 30, left: -12, right: 12, top: 12, bottom: -12 });
  scene.add(sun, sun.target);

  const worldGroup = new THREE.Group(); worldGroup.name = 'world';
  scene.add(worldGroup);

  const S = {
    world: null, quality: QUALITY[quality] ? quality : 'mid', splatKey: null, splat: null, spark: null, collider: null, ground: createGround({ plane: true }),
    show: { splat: true, meshes: true }, insets: { t: 0, b: 0, l: 0 }, gen: 0, loading: false, info: null, panoTex: null,
    running: true, last: performance.now(), frames: 0, error: '', autoRotate: 0, director: null,
  };
  const audio = createAudio();
  const groundAt = (x, y, z) => S.ground.groundAt(x, y, z);
  const blockAt = (eye, d) => {
    const feet = eye.y - EYE, p = { x: eye.x, z: eye.z, y: feet + 0.6 };
    if (S.ground.blockAt(p, d)) return true;
    p.y = feet + 1.25; return S.ground.blockAt(p, d);
  };
  const objects = createObjects({ THREE, GLTFLoader, scene, groundAt, onImpact: (o, k) => audio.hit(o.id, k) });
  const ray = new THREE.Raycaster();
  const controls = createControls({
    THREE, OrbitControls, camera, dom: canvas, joy: document.getElementById('joy'), groundAt, blockAt,
    onTap: (x, y) => {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(x / r.width * 2 - 1, -(y / r.height) * 2 + 1), camera);
      const o = S.show.meshes ? objects.pick(ray.ray) : null;
      if (o) { objects.poke(o); onStatus({ kind: 'poke', name: o.name }); }
    },
    onUser: () => onStatus({ kind: 'user' }),
  });

  function makeSpark() {
    if (S.spark) { scene.remove(S.spark); if (S.spark.dispose) S.spark.dispose(); }
    const q = QUALITY[S.quality];
    S.spark = new SparkRenderer({ renderer, maxStdDev: q.maxStdDev, enableLod: true, lodSplatScale: q.lod });
    scene.add(S.spark);
  }
  function applyQuality() {
    const q = QUALITY[S.quality];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.dpr));
    renderer.shadowMap.enabled = q.shadows; sun.castShadow = q.shadows;
    if (S.collider) S.collider.visible = q.shadows;
    scene.traverse(n => { if (n.material && n.isMesh) [].concat(n.material).forEach(m => { m.needsUpdate = true; }); });
    resize();
  }

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // A portrait screen keeps a 62 degree horizontal view: the vertical
    // fov opens up (to 100 at most) instead of the sides closing in.
    if (!S.director) camera.fov = w < h ? Math.min(100, 2 * Math.atan(Math.tan(31 * Math.PI / 180) * h / w) * 180 / Math.PI) : 70;
    const cy = S.insets.t + (h - S.insets.t - S.insets.b) / 2, cx = S.insets.l + (w - S.insets.l) / 2;
    if (Math.abs(cy - h / 2) > 0.5 || Math.abs(cx - w / 2) > 0.5) camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  async function loadSplat(world, my) {
    const pick = pickSplat(world, QUALITY[S.quality].splat);
    if (!pick) { S.info = null; return null; }
    if (S.splat && S.splatKey === world.slug + ':' + pick.key) return S.info;
    onStatus({ kind: 'load', what: 'splat', name: pick.entry.path, p: 0 });
    const head = pick.entry.size && pick.entry.size < HEAD_BYTES ? null : await pick.entry.head(HEAD_BYTES).catch(() => null);
    const bytes = await pick.entry.bytes(p => onStatus({ kind: 'load', what: 'splat', name: pick.entry.path, p }));
    if (my !== S.gen) return null;
    const info = await parseSplatHeader(head || bytes.subarray(0, HEAD_BYTES), bytes.length, pick.entry.path);
    if (info.warn) console.warn('image-worlds: ' + pick.entry.path + ': ' + info.warn);
    const mesh = new SplatMesh({ fileBytes: bytes, fileType: info.format, fileName: pick.entry.path.split('/').pop() });
    await mesh.initialized;
    if (my !== S.gen) { mesh.dispose(); return null; }
    if (S.splat) { worldGroup.remove(S.splat); S.splat.dispose(); }
    S.splat = mesh; S.splatKey = world.slug + ':' + pick.key;
    mesh.visible = S.show.splat;
    worldGroup.add(mesh);
    S.info = { ...info, key: pick.key, bytes: bytes.length, file: pick.entry.path };
    return S.info;
  }

  async function loadCollider(world, my) {
    if (S.collider) { worldGroup.remove(S.collider); S.collider.traverse(n => { if (n.isMesh) n.geometry.dispose(); }); S.collider = null; }
    S.ground = createGround({ plane: !(world.scene && world.scene.groundPlaneColliderEnabled === false) });
    if (!world.collider) return;
    try {
      const b = await world.collider.bytes();
      const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
      if (my !== S.gen) return;
      const op = world.scene && typeof world.scene.shadowCatcherOpacity === 'number' ? world.scene.shadowCatcherOpacity : 0.5;
      const mat = new THREE.ShadowMaterial({ color: new THREE.Color((world.scene && world.scene.shadowCatcherColor) || '#000000'), opacity: op, transparent: true, depthWrite: false });
      const root = gltf.scene;
      root.traverse(n => { if (n.isMesh) { const old = [].concat(n.material); old.forEach(m => m.dispose()); n.material = mat; n.receiveShadow = true; n.castShadow = false; } });
      worldGroup.add(root); S.collider = root; root.visible = QUALITY[S.quality].shadows;
      worldGroup.updateMatrixWorld(true);
      // Bake the collider into world space for the ground grid.
      const pos = [], idx = []; let base = 0;
      root.traverse(n => {
        if (!n.isMesh) return;
        const g = n.geometry, p = g.attributes.position, v = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld); pos.push(v.x, v.y, v.z); }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
        else for (let i = 0; i < p.count; i++) idx.push(base + i);
        base += p.count;
      });
      S.ground = createGround({ positions: new Float32Array(pos), index: new Uint32Array(idx), plane: !(world.scene && world.scene.groundPlaneColliderEnabled === false) });
    } catch (e) { console.warn('image-worlds: skipped collider ' + world.collider.path + ': ' + (e.message || e)); }
  }

  async function loadEnvironment(world, my) {
    if (S.panoTex) { S.panoTex.dispose(); S.panoTex = null; }
    scene.environment = roomEnv;
    const sc = world.scene || {}, sunRec = sc.sun || {};
    sun.intensity = typeof sunRec.intensity === 'number' ? sunRec.intensity : 1;
    sun.position.fromArray(sunPosition(sunRec.rotation || [0, 0, 0]));
    scene.environmentIntensity = typeof sunRec.environmentIntensity === 'number' ? sunRec.environmentIntensity : 1;
    if (!world.pano) return;
    try {
      const tex = await new THREE.TextureLoader().loadAsync(world.pano.href());
      if (my !== S.gen) { tex.dispose(); return; }
      tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
      S.panoTex = pmrem.fromEquirectangular(tex).texture; tex.dispose();
      scene.environment = S.panoTex;
    } catch (e) { console.warn('image-worlds: skipped panorama: ' + (e.message || e)); }
  }

  function toStart(world) {
    const st = world && world.start;
    controls.resetTo(st ? new THREE.Vector3(...st.position) : SPAWN, 0, -0.12);
    if (st) controls.lookAt(new THREE.Vector3(...st.target));
  }
  async function open(world, { keepCamera = false } = {}) {
    const my = ++S.gen;
    S.loading = true; S.error = '';
    if (S.world && S.world !== world) { for (const e of entriesOf(S.world)) e.release(); }
    S.world = world;
    scene.background.set(world.background || '#0c0e13');
    const sm = world.semantics;
    worldGroup.position.set(0, sm.groundOffset || 0, 0);
    worldGroup.rotation.set(sm.flipY ? Math.PI : 0, 0, 0);
    worldGroup.scale.setScalar(sm.metricScale || 1);
    worldGroup.updateMatrixWorld(true);
    if (S.splat && !S.splatKey.startsWith(world.slug + ':')) { worldGroup.remove(S.splat); S.splat.dispose(); S.splat = null; S.splatKey = null; }
    objects.clear();
    audio.setWorld(world);
    if (!keepCamera) toStart(world);
    try {
      await loadEnvironment(world, my);
      await loadCollider(world, my);
      const info = await loadSplat(world, my);
      if (my !== S.gen) return null;
      onStatus({ kind: 'load', what: 'meshes', p: 0 });
      await objects.load(world, p => onStatus({ kind: 'load', what: 'meshes', p }));
      for (const o of objects.list) audio.addEmitter(o.id, o.obj.sfx);
      objects.group.visible = S.show.meshes;
      if (my !== S.gen) return null;
      S.loading = false;
      onStatus({ kind: 'ready', world, info });
      return info;
    } catch (e) {
      if (my !== S.gen) return null;
      S.loading = false; S.error = e.message || String(e);
      onStatus({ kind: 'error', world, error: S.error });
      throw e;
    }
  }
  const entriesOf = w => [w.source, ...(w.sourceVersions || []), w.thumbnail, w.pano, w.plate, w.collider, ...Object.values(w.splats || {}), ...(w.ambient || []), ...(w.objects || []).flatMap(o => [o.model, o.thumb, ...o.sfx])].filter(Boolean);

  async function setQuality(q) {
    if (!QUALITY[q] || q === S.quality) return;
    S.quality = q; makeSpark(); applyQuality();
    if (S.world) { const my = S.gen; await loadSplat(S.world, my); onStatus({ kind: 'ready', world: S.world, info: S.info }); }
  }
  function setShow(k, v) {
    S.show[k] = !!v;
    if (k === 'splat' && S.splat) S.splat.visible = S.show.splat;
    if (k === 'meshes') objects.group.visible = S.show.meshes;
  }

  // ── loop ─────────────────────────────────────────────────────────────────
  function frame(now) {
    if (!S.running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - S.last) / 1000); S.last = now;
    if (S.director) S.director(dt, now);
    else controls.update(dt);
    objects.update(dt);
    audio.update(camera, objects.positions());
    renderer.render(scene, camera);
    S.frames++;
  }

  // A small JPEG of the current view (the sample's thumbnail and source
  // image come from here): render once more and read the canvas at once.
  function snapshot(w = 640, q = 0.85) {
    renderer.render(scene, camera);
    const c = document.createElement('canvas'), h = Math.round(w * canvas.height / canvas.width);
    c.width = w; c.height = h; c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return c.toDataURL('image/jpeg', q);
  }

  function dispose() {
    S.running = false; S.gen++;
    controls.dispose(); audio.dispose(); objects.clear();
    if (S.splat) S.splat.dispose();
    if (S.spark && S.spark.dispose) S.spark.dispose();
    if (S.world) for (const e of entriesOf(S.world)) e.release();
    pmrem.dispose(); roomEnv.dispose(); if (S.panoTex) S.panoTex.dispose();
    renderer.dispose();
  }

  makeSpark(); applyQuality();
  requestAnimationFrame(frame);
  return {
    THREE, renderer, scene, camera, controls, objects, audio, worldGroup, S,
    open, setQuality, setShow, resize, snapshot, dispose, toStart: () => toStart(S.world),
    setInsets(t, b, l = 0) { if (Math.abs(t - S.insets.t) < 1 && Math.abs(b - S.insets.b) < 1 && Math.abs(l - S.insets.l) < 1) return; S.insets = { t, b, l }; resize(); },
    setDirector(fn) { S.director = fn; controls.enabled = !fn; },
    get quality() { return S.quality; },
    state: () => ({ world: S.world && S.world.slug, loading: S.loading, error: S.error, quality: S.quality, splat: S.info, frames: S.frames, meshes: objects.list.length, audio: audio.state(), mode: controls.mode, tris: S.ground.tris }),
  };
}
