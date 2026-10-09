// ============================================================================
//  LEGGED ROBOT GYM  ·  scene.js — the THREE view of the MuJoCo robots
// ----------------------------------------------------------------------------
//  Z is up, as in MuJoCo, so a sim position goes into THREE unchanged.
//  Each visual geom of the MJCF (contype 0, conaffinity 0, type mesh) gets
//  one THREE mesh. Its vertices are baked into the geom frame once: MuJoCo
//  moves a mesh to its centre of mass (mesh_pos, mesh_quat), so a file
//  vertex v goes to conj(mesh_quat) (v - mesh_pos). Each frame the mesh
//  matrix is d.geom_xmat and d.geom_xpos, plus the robot offset.
//
//  LAYOUT ON THE CANVAS
//    The panels and the dock cover parts of the canvas. occlusion() reads
//    their rects (and the saver plate band) and setViewOffset moves the
//    view centre into the clear part, as on the geneva-cams page.
//
//  GREP MAP
//    export function createView ... renderer, camera, lights, floor, loop
//      view.addRobot .............. meshes + joint glow for one Sim
//      rv.update .................. per-frame pose from MjData
//      rv.setXray ................. x-ray look, joint torque glow
//      view.foot .................. footprint decals (instanced)
//      view.arrow ................. the push arrow
//      view.hud ................... a 2D canvas drawn over the 3D view
//      function occlusion ......... the canvas area each panel covers
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { unpack } from './robot.js';

const FOOT_N = 96;

function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1c27'; g.fillRect(0, 0, 512, 512);
  // 1 m cell, 0.25 m sub-lines
  g.strokeStyle = 'rgba(160,170,210,0.08)'; g.lineWidth = 2;
  for (let i = 1; i < 4; i++) { const p = i * 128; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
  g.strokeStyle = 'rgba(217,179,106,0.30)'; g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// o: { canvas, occluders: [el], band: () => {t,b}|null, coarse, onNoGL,
//      Renderer (a stand-in for THREE.WebGLRenderer: the node boot test) }
export function createView(o) {
  const { canvas } = o;
  let renderer;
  try { renderer = new (o.Renderer || THREE.WebGLRenderer)({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { if (o.onNoGL) o.onNoGL(); throw e; }
  const dpr = () => Math.min(devicePixelRatio || 1, o.coarse ? 1.6 : 2, Math.max(1, 3000 / Math.max(1, canvas.clientWidth)));
  renderer.setPixelRatio(dpr());
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0c14, 14, 34);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 200);
  camera.up.set(0, 0, 1);
  camera.position.set(2.6, -2.6, 1.4);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.minDistance = 0.6; controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 0, 0.6);

  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x2a2016, 0.9));
  const key = new THREE.DirectionalLight(0xfff3e4, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(o.coarse ? 1024 : 2048, o.coarse ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.5, far: 14 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9db6ff, 1.1);
  scene.add(rim, rim.target);

  const ftex = floorTexture(); ftex.repeat.set(60, 60);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.92, metalness: 0 }));
  floor.receiveShadow = true;
  scene.add(floor);

  // footprints: one instanced disc per step, the oldest is reused
  const fGeo = new THREE.CircleGeometry(1, 20);
  const fMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const feet = new THREE.InstancedMesh(fGeo, fMat, FOOT_N);
  feet.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FOOT_N * 3), 3);
  feet.count = 0; feet.frustumCulled = false; feet.renderOrder = 1;
  scene.add(feet);
  let footNext = 0;
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3(), C = new THREE.Color();

  // push arrow: a shaft and a head, scaled to the push
  const arrow = new THREE.Group();
  const aMat = new THREE.MeshBasicMaterial({ color: 0xff6a7a, transparent: true, opacity: 0.95, depthTest: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 12), aMat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 16), aMat);
  arrow.add(shaft, head); arrow.visible = false; arrow.renderOrder = 5;
  scene.add(arrow);

  // HUD: a 2D canvas over the 3D view, in the same WebGL canvas (the saver
  // records the canvas only)
  const hudC = document.createElement('canvas'); hudC.width = 16; hudC.height = 16;
  const hudT = new THREE.CanvasTexture(hudC); hudT.colorSpace = THREE.SRGBColorSpace;
  const hudM = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: hudT, transparent: true, depthTest: false }));
  const hudScene = new THREE.Scene(); hudScene.add(hudM);
  const hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

  const view = { THREE, renderer, scene, camera, controls, key, floor, robots: [], shadows: true, hudOn: false, hudRect: null, follow: true };

  // ── robot meshes ──────────────────────────────────────────────────────────
  // mj, S (robot.js Sim), visual = ArrayBuffer of visual.bin, off = [x, y]
  view.addRobot = (mj, S, visual, off = [0, 0]) => {
    const m = S.m, V = unpack(visual), group = new THREE.Group(), meshes = [], geos = new Map(), mats = [];
    const OBJ = mj.mjtObj, MESH = mj.mjtGeom.mjGEOM_MESH.value;
    const meshName = i => mj.mj_id2name(m, OBJ.mjOBJ_MESH.value, i) || '';
    const tint = S.key === 'go2' ? null : new THREE.Color(0xb9bcc6);
    for (let g = 0; g < m.ngeom; g++) {
      if (m.geom_type[g] !== MESH || m.geom_contype[g] || m.geom_conaffinity[g]) continue;
      const mi = m.geom_dataid[g], file = S.meshFiles[meshName(mi)], src = file && V[file];
      if (!src) continue;
      let geo = geos.get(mi);
      if (!geo) {
        const p = [m.mesh_pos[3 * mi], m.mesh_pos[3 * mi + 1], m.mesh_pos[3 * mi + 2]];
        const q = new THREE.Quaternion(m.mesh_quat[4 * mi + 1], m.mesh_quat[4 * mi + 2], m.mesh_quat[4 * mi + 3], m.mesh_quat[4 * mi]).invert();
        const pos = new Float32Array(src.v.length), v = new THREE.Vector3();
        for (let k = 0; k < src.v.length; k += 3) { v.set(src.v[k] - p[0], src.v[k + 1] - p[1], src.v[k + 2] - p[2]).applyQuaternion(q); pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z; }
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint16Array(src.t), 1));
        geo.computeVertexNormals(); geo.computeBoundingSphere();
        geos.set(mi, geo);
      }
      const mat = m.geom_matid[g];
      const rgba = mat >= 0 ? [m.mat_rgba[4 * mat], m.mat_rgba[4 * mat + 1], m.mat_rgba[4 * mat + 2]] : [m.geom_rgba[4 * g], m.geom_rgba[4 * g + 1], m.geom_rgba[4 * g + 2]];
      const col = new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
      // the humanoid MJCF uses plain grey: a light satin metal, dark joints
      if (tint) { const lum = col.r + col.g + col.b; col.copy(lum < 0.6 ? new THREE.Color(0x3a3d48) : tint); }
      const sm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.35, envMapIntensity: 0.8 });
      mats.push(sm);
      const mesh = new THREE.Mesh(geo, sm);
      mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh); meshes.push([mesh, g]);
    }
    // joint glow: one sphere per actuated joint at its anchor
    const glow = [], gMat = [];
    for (let i = 0; i < S.NA; i++) {
      const mt = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, depthTest: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mt);
      s.visible = false; s.renderOrder = 4; group.add(s); glow.push(s); gMat.push(mt);
    }
    const xMat = new THREE.MeshBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const wMat = new THREE.MeshBasicMaterial({ color: 0x9cc4ff, wireframe: true, transparent: true, opacity: 0.08, depthWrite: false });
    const wire = meshes.map(([mesh]) => { const w = new THREE.Mesh(mesh.geometry, wMat); w.matrixAutoUpdate = false; w.visible = false; group.add(w); return w; });
    // torque limit per joint for the glow scale
    const lim = [];
    for (let i = 0; i < S.NA; i++) {
      const j = i + 1, a = Math.abs(m.jnt_actfrcrange[2 * j + 1]) || 0, c = Math.abs(m.actuator_ctrlrange[2 * i + 1]) || 0;
      lim.push(a || c || Math.max(20, S.cfg.kps[i] * 0.5));
    }
    scene.add(group);
    const rv = { S, group, off: off.slice(), xray: false, meshes, lim, alpha: 1 };
    rv.setXray = on => {
      rv.xray = on;
      meshes.forEach(([mesh], k) => { mesh.material = on ? xMat : mats[k]; mesh.castShadow = !on; wire[k].visible = on; });
      glow.forEach(s => { s.visible = on; });
    };
    rv.update = () => {
      const d = S.d, X = d.geom_xpos, R = d.geom_xmat, ox = rv.off[0], oy = rv.off[1];
      meshes.forEach(([mesh, g], k) => {
        const r = 9 * g, p = 3 * g;
        mesh.matrix.set(R[r], R[r + 1], R[r + 2], X[p] + ox, R[r + 3], R[r + 4], R[r + 5], X[p + 1] + oy, R[r + 6], R[r + 7], R[r + 8], X[p + 2], 0, 0, 0, 1);
        if (rv.xray) wire[k].matrix.copy(mesh.matrix);
      });
      if (rv.xray) {
        const A = d.xanchor;
        for (let i = 0; i < S.NA; i++) {
          const j = i + 1, u = Math.min(1, Math.abs(S.tau[i]) / rv.lim[i]);
          glow[i].position.set(A[3 * j] + ox, A[3 * j + 1] + oy, A[3 * j + 2]);
          glow[i].scale.setScalar(0.022 + 0.07 * Math.sqrt(u));
          gMat[i].color.setHSL(0.12 - 0.12 * u, 1, 0.45 + 0.25 * u);
        }
      }
    };
    rv.dispose = () => {
      scene.remove(group);
      for (const g of geos.values()) g.dispose();
      mats.forEach(m2 => m2.dispose()); gMat.forEach(m2 => m2.dispose()); xMat.dispose(); wMat.dispose();
      glow.forEach(s => s.geometry.dispose());
      view.robots = view.robots.filter(x => x !== rv);
    };
    rv.update();
    view.robots.push(rv);
    return rv;
  };

  // a footprint at (x, y), heading yaw, radius r, colour hex
  view.foot = (x, y, r, hex) => {
    const i = footNext; footNext = (footNext + 1) % FOOT_N; feet.count = Math.max(feet.count, footNext === 0 ? FOOT_N : footNext);
    M4.compose(V3.set(x, y, 0.002), Q.identity(), S3.set(r, r, 1));
    feet.setMatrixAt(i, M4); feet.setColorAt(i, C.set(hex));
    feet.instanceMatrix.needsUpdate = true; feet.instanceColor.needsUpdate = true;
  };
  view.clearFeet = () => { feet.count = 0; footNext = 0; };
  view.feetVisible = on => { feet.visible = on; };

  // push arrow from p (world) along v (m/s, xy); v null hides it
  view.arrow = (p, v) => {
    if (!v) { arrow.visible = false; return; }
    const L = Math.hypot(v[0], v[1]);
    if (L < 1e-3) { arrow.visible = false; return; }
    const len = 0.25 + 0.55 * L, dx = v[0] / L, dy = v[1] / L;
    arrow.visible = true;
    arrow.position.set(p[0] - dx * (len + 0.25), p[1] - dy * (len + 0.25), p[2]);
    arrow.quaternion.setFromUnitVectors(V3.set(0, 1, 0), new THREE.Vector3(dx, dy, 0));
    shaft.scale.set(1, len, 1); shaft.position.set(0, len / 2, 0);
    head.position.set(0, len + 0.09, 0);
  };

  // HUD: draw(ctx, w, h) in CSS px into the rect { x, y, w, h } (CSS px)
  view.hud = (rect, draw) => {
    view.hudOn = !!rect; view.hudRect = rect;
    if (!rect) return;
    const p = renderer.getPixelRatio(), W = Math.round(rect.w * p), H = Math.round(rect.h * p);
    if (hudC.width !== W || hudC.height !== H) { hudC.width = W; hudC.height = H; hudT.dispose(); hudT.image = hudC; }
    const g = hudC.getContext('2d'); g.setTransform(p, 0, 0, p, 0, 0); g.clearRect(0, 0, rect.w, rect.h);
    draw(g, rect.w, rect.h);
    hudT.needsUpdate = true;
  };

  // ── framing: each panel over the canvas pushes the view the other way ────
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
    const band = o.band && o.band();
    if (band) { out.t = Math.max(out.t, band.t); out.b = Math.max(out.b, band.b); }
    if (o.extra) { const e = o.extra(); if (e) for (const k in e) out[k] = Math.max(out[k], e[k]); }
    return out;
  }
  view.clear = () => ({ ...occ, w: canvas.clientWidth, h: canvas.clientHeight });
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
    camera.zoom = Math.min(1, Math.max(0.35, Math.min(cw / h * 1.25, ch / h)));
    camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
    camera.updateProjectionMatrix();
    hudCam.right = w; hudCam.top = h; hudCam.updateProjectionMatrix();
  }

  // the light, its shadow box and the floor follow point c (world)
  view.track = c => {
    key.position.set(c[0] + 2.2, c[1] - 1.6, 4.2); key.target.position.set(c[0], c[1], 0.3);
    rim.position.set(c[0] - 3, c[1] + 2.5, 2.5); rim.target.position.set(c[0], c[1], 0.5);
    floor.position.set(Math.round(c[0]), Math.round(c[1]), 0);
  };

  view.frame = dt => {
    for (const rv of view.robots) rv.update();
    controls.update(dt);
    resize();
    key.castShadow = view.shadows;
    renderer.autoClear = true;
    renderer.render(scene, camera);
    if (view.hudOn && view.hudRect) {
      const r = view.hudRect, h = canvas.clientHeight;
      hudM.scale.set(r.w, r.h, 1); hudM.position.set(r.x + r.w / 2, h - r.y - r.h / 2, 0);
      renderer.autoClear = false; renderer.clearDepth(); renderer.render(hudScene, hudCam); renderer.autoClear = true;
    }
  };
  view.dispose = () => {
    for (const rv of view.robots.slice()) rv.dispose();
    try { ftex.dispose(); floor.geometry.dispose(); floor.material.dispose(); fGeo.dispose(); fMat.dispose(); hudT.dispose(); controls.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* gone */ }
  };
  return view;
}
