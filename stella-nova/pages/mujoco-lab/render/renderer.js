// ============================================================================
//  MUJOCO LAB  ·  render/renderer.js — three.js renderer for a MuJoCo sim
// ----------------------------------------------------------------------------
//  createMjRenderer(canvas, sim, opts) builds a scene from mjModel once and
//  copies mjData into it each frame. It does not step the physics. The page
//  gives THREE (r139 global or r160 module). README.md has the API.
//
//  The scene: scene > root (MuJoCo z-up turned to three y-up) > geom
//  meshes, skins, flexes and the overlay pools. Geom matrices are written
//  from geom_xmat / geom_xpos into matrix.elements (matrixAutoUpdate off).
//
//  GREP MAP
//    export function createMjRenderer .. entry
//    function buildModel ............... geoms, materials, skins, flexes
//    function makeMaterial ............. MuJoCo material -> MeshStandardMaterial
//    function setLook .................. theme, lights, fog, floor grid
//    function update ................... mjData -> scene, no allocation
//    function rotateTorque ............. Ctrl-drag rotation spring
//    function pick ..................... raycast to a body
//    function beginPerturb ............. mouse spring start / drag / end
//    function attachPointer ............ orbit, pan, zoom, pinch, perturb
// ============================================================================
import * as K from '../../../widgets/sim-kit/core.js';
import { lightById } from '../../../widgets/sim-kit/stage3d.js';
import { GEOM, geomGeometry, geomColor, matTexId, makeTextures, gridTexture, skinBuild, flexBuild } from './geoms.js';
import { createPools, drawOverlays } from './overlays.js';
import { createCamCtl } from './camera.js';

export const DEFAULT_FLAGS = {
  contactPoints: false, contactForces: false, jointAxes: false, com: false, inertia: false, actuators: false,
  tendons: true, constraints: false, frames: false, transparent: false, wireframe: false, perturb: true,
};
const DATA_VIEWS = ['geom_xpos', 'geom_xmat', 'xpos', 'xmat', 'xquat', 'xipos', 'ximat', 'xanchor', 'xaxis', 'subtree_com', 'cvel',
  'xfrc_applied', 'actuator_force', 'qpos', 'site_xpos', 'site_xmat', 'wrap_xpos', 'wrap_obj', 'ten_wrapadr', 'ten_wrapnum', 'flexvert_xpos', 'cam_xpos', 'cam_xmat'];
const MODEL_VIEWS = ['jnt_type', 'jnt_limited', 'jnt_range', 'jnt_qposadr', 'body_inertia', 'body_mass', 'body_parentid', 'body_subtreemass',
  'actuator_trntype', 'actuator_trnid', 'tendon_width', 'tendon_rgba', 'eq_type', 'eq_obj1id', 'eq_obj2id', 'eq_objtype', 'eq_data', 'eq_active0', 'cam_fovy'];

export function createMjRenderer(canvas, sim, opts = {}) {
  const THREE = opts.THREE || globalThis.THREE;
  if (!THREE) throw new Error('createMjRenderer: no THREE');
  const phone = !!opts.phone;
  const SRGB = THREE.SRGBColorSpace;
  const rgb = (c, r, g, b) => (SRGB ? c.setRGB(r, g, b, SRGB) : c.setRGB(r, g, b));

  // ---- renderer -------------------------------------------------------------------
  let renderer = null, own = false, error = null;
  if (opts.renderer !== undefined) renderer = opts.renderer;
  else {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context: opts.context, antialias: !phone, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
      own = true;
    } catch (e) { renderer = null; error = e; }
  }
  if (renderer) {
    if (own) renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, phone ? 1.5 : 2));
    renderer.shadowMap.enabled = opts.shadows !== false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  // r155+ physical light units: scale the legacy intensities by pi
  const LS = renderer && renderer.useLegacyLights === false ? Math.PI : 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  const root = new THREE.Group(); root.name = 'mujoco'; root.rotation.x = -Math.PI / 2;
  scene.add(root);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = opts.shadows !== false;
  const sm = phone ? 1024 : 2048; key.shadow.mapSize.set(sm, sm);
  const fill = new THREE.DirectionalLight(0x99aaff, 0.3), rim = new THREE.DirectionalLight(0xffffff, 0.25);
  scene.add(hemi, key, key.target, fill, rim);
  const fog = new THREE.Fog(0x000000, 10, 40);

  const pools = createPools(THREE);
  for (const p of pools.list) root.add(p.mesh);
  const cam = createCamCtl(THREE, camera);

  const flags = Object.assign({}, DEFAULT_FLAGS, opts.flags || {});
  let groups = (opts.groups || [1, 1, 1, 0, 0, 0]).slice();
  let look = Object.assign({ theme: 'night', light: 'studio', fog: true, floor: 'theme' }, { theme: opts.theme, light: opts.light, fog: opts.fog, floor: opts.floor });
  for (const k of Object.keys(look)) if (look[k] === undefined) delete look[k];
  look = Object.assign({ theme: 'night', light: 'studio', fog: true, floor: 'theme' }, look);

  // per-model state
  let S = null, m = null, d = null;
  const V = {};
  let meshes = [], dynamic = [], pickables = [], skins = [], flexes = [], mats = [], textures = [], geoCache = new Map(), floorMats = [];
  let floorTex = null, peak = new Float64Array(0), cf = null, sc = {}, extent = 1;
  const hl = new Map();     // base material -> highlight clone
  let selected = -1;
  const pert = { body: -1, mode: null, local: [0, 0, 0], anchor: new Float64Array(3), target: new Float64Array(3), q: new Float64Array(4), k: 1 };
  const X = { m: null, d: null, V, mj: null, cf: null, flags, sc, peak, flexes, pert, tmp: new Float64Array(6) };
  let W = 1, H = 1;
  const tv = new THREE.Vector3(), tv2 = new THREE.Vector3();

  function refreshViews() {
    for (const k of DATA_VIEWS) { try { V[k] = d[k]; } catch (e) { V[k] = null; } }
    for (const k of MODEL_VIEWS) { try { V[k] = m[k]; } catch (e) { V[k] = null; } }
  }
  const stale = () => !V.xpos || V.xpos.length === 0;

  // ---- materials ------------------------------------------------------------------------
  function makeMaterial(g, uvOK, planeSize) {
    const col = geomColor(m, g), mat = m.geom_matid[g];
    const P = { roughness: 0.55, metalness: 0.05 };
    let map = null;
    if (mat >= 0) {
      const sh = m.mat_shininess[mat], rf = m.mat_reflectance[mat];
      const mr = m.mat_roughness ? m.mat_roughness[mat] : -1, mm = m.mat_metallic ? m.mat_metallic[mat] : -1;
      P.roughness = mr >= 0 ? mr : Math.min(0.95, Math.max(0.12, 1 - 0.75 * sh));
      P.metalness = mm >= 0 ? mm : Math.min(0.6, rf * 0.8);
      const tid = matTexId(m, mat), T = tid >= 0 ? textures[tid] : null;
      if (T) {
        if (T.type === 0 && T.tex && uvOK) {
          map = T.tex.clone(); map.needsUpdate = true;
          const rx = m.mat_texrepeat[2 * mat], ry = m.mat_texrepeat[2 * mat + 1], uni = m.mat_texuniform[mat];
          if (uni && planeSize) map.repeat.set(rx * 2 * planeSize[0], ry * 2 * planeSize[1]); else map.repeat.set(rx, ry);
          textures.push({ tex: map });
        } else if (T.type !== 2) { for (let k = 0; k < 3; k++) col[k] *= T.mean[k]; }
      }
    }
    const material = new THREE.MeshStandardMaterial(Object.assign(P, { map, transparent: col[3] < 0.999, opacity: col[3], depthWrite: col[3] >= 0.999 }));
    rgb(material.color, col[0], col[1], col[2]);
    if (mat >= 0 && m.mat_emission[mat] > 0) { rgb(material.emissive, col[0], col[1], col[2]); material.emissiveIntensity = m.mat_emission[mat]; }
    material.userData.base = { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite };
    mats.push(material);
    return material;
  }
  function floorMaterial(size) {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
    material.userData.floor = size;
    mats.push(material); floorMats.push(material);
    return material;
  }
  const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), r = x / p; return (r < 2 ? 1 : r < 5 ? 2 : 5) * p; };

  // ---- build -----------------------------------------------------------------------------------
  function clearModel() {
    for (const o of meshes) root.remove(o);
    for (const s of skins) { root.remove(s.mesh); s.geometry.dispose(); }
    for (const f of flexes) if (f.mesh) { root.remove(f.mesh); f.geometry.dispose(); }
    for (const g of geoCache.values()) g.dispose();
    for (const x of mats) { x.dispose(); }
    for (const x of hl.values()) x.dispose();
    for (const t of textures) t.tex && t.tex.dispose();
    if (floorTex) floorTex.dispose();
    if (cf) { try { cf.delete(); } catch (e) { /* freed */ } }
    meshes = []; dynamic = []; pickables = []; skins = []; flexes = []; mats = []; textures = []; floorMats = []; geoCache = new Map(); hl.clear();
    floorTex = null; cf = null; selected = -1; pert.body = -1;
    X.flexes = flexes;
  }

  function buildModel() {
    clearModel();
    if (!S) return;
    m = S.m; d = S.d; refreshViews();
    const st = m.stat;
    extent = st.extent || 1;
    const ms = st.meansize || 0.1 * extent, vs = m.vis.scale, vm = m.vis.map;
    Object.assign(sc, {
      meansize: ms, extent,
      contactWidth: Math.max(vs.contactwidth * ms, 0.004 * extent), contactHeight: Math.max(vs.contactheight * ms, 0.002 * extent),
      forceWidth: vs.forcewidth * ms, forceScale: vm.force / Math.max(1e-9, st.meanmass || 1),
      jointLength: vs.jointlength * ms, jointWidth: vs.jointwidth * ms, frameLength: vs.framelength * ms, frameWidth: vs.framewidth * ms,
      com: vs.com * ms * 0.5, actLength: (vs.actuatorlength || 0.7) * ms, actWidth: (vs.actuatorwidth || 0.2) * ms * 0.5,
    });
    peak = new Float64Array(m.nu); X.peak = peak;
    X.m = m; X.d = d; X.mj = S.mj; cf = new S.mj.DoubleBuffer(6); X.cf = cf;
    camera.near = Math.max(1e-4, (vm.znear || 0.01) * extent); camera.far = (vm.zfar || 50) * extent * 2; camera.updateProjectionMatrix();
    textures = makeTextures(THREE, m).map(t => t);
    const big = Math.max(10, extent * 8);
    floorTex = null;
    for (let g = 0; g < m.ngeom; g++) {
      const t = m.geom_type[g];
      const geo = geomGeometry(THREE, m, g, geoCache, { big, phone });
      if (!geo) continue;
      const body = m.geom_bodyid[g], plane = t === GEOM.PLANE;
      const psize = plane ? geo.userData.plane : null;
      const material = plane && body === 0 && look.floor === 'theme' ? floorMaterial(psize) : makeMaterial(g, !!geo.attributes.uv, psize);
      const mesh = new THREE.Mesh(geo, material);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = !plane; mesh.receiveShadow = true;
      mesh.userData = { geom: g, body, group: m.geom_group[g], alpha: geomColor(m, g)[3], base: material };
      mesh.name = S.geomNames ? S.geomNames[g] : '';
      writeMatrix(mesh, g);
      root.add(mesh); meshes.push(mesh);
      if (body !== 0) { dynamic.push(mesh); pickables.push(mesh); }
    }
    for (let s = 0; s < (m.nskin || 0); s++) {
      const sk = skinBuild(THREE, m, s), mat = m.skin_matid[s];
      const c = mat >= 0 ? [m.mat_rgba[4 * mat], m.mat_rgba[4 * mat + 1], m.mat_rgba[4 * mat + 2], m.mat_rgba[4 * mat + 3]] : [m.skin_rgba[4 * s], m.skin_rgba[4 * s + 1], m.skin_rgba[4 * s + 2], m.skin_rgba[4 * s + 3]];
      const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, transparent: c[3] < 1, opacity: c[3] });
      rgb(material.color, c[0], c[1], c[2]);
      material.userData.base = { transparent: c[3] < 1, opacity: c[3], depthWrite: true };
      mats.push(material);
      sk.mesh = new THREE.Mesh(sk.geometry, material); sk.mesh.frustumCulled = false; sk.mesh.castShadow = sk.mesh.receiveShadow = true;
      sk.group = m.skin_group ? m.skin_group[s] : 0;
      root.add(sk.mesh); skins.push(sk);
    }
    for (let f = 0; f < (m.nflex || 0); f++) {
      const fx = flexBuild(THREE, m, f), mat = m.flex_matid ? m.flex_matid[f] : -1;
      const c = mat >= 0 ? [m.mat_rgba[4 * mat], m.mat_rgba[4 * mat + 1], m.mat_rgba[4 * mat + 2], m.mat_rgba[4 * mat + 3]] : [m.flex_rgba[4 * f], m.flex_rgba[4 * f + 1], m.flex_rgba[4 * f + 2], m.flex_rgba[4 * f + 3]];
      fx.color = c;
      fx.group = m.flex_group ? m.flex_group[f] : 0;
      if (fx.geometry) {
        const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, side: THREE.DoubleSide, transparent: c[3] < 1, opacity: c[3] });
        rgb(material.color, c[0], c[1], c[2]);
        material.userData.base = { transparent: c[3] < 1, opacity: c[3], depthWrite: true };
        mats.push(material);
        fx.mesh = new THREE.Mesh(fx.geometry, material); fx.mesh.frustumCulled = false; fx.mesh.castShadow = fx.mesh.receiveShadow = true;
        root.add(fx.mesh);
      }
      flexes.push(fx);
    }
    X.flexes = flexes;
    applyGroups(); applyLook(); applyMatFlags();
    resetCamera();
    update();
  }

  function writeMatrix(mesh, g) {
    const P = V.geom_xpos, R = V.geom_xmat, e = mesh.matrix.elements, o = 9 * g;
    e[0] = R[o]; e[1] = R[o + 3]; e[2] = R[o + 6]; e[3] = 0;
    e[4] = R[o + 1]; e[5] = R[o + 4]; e[6] = R[o + 7]; e[7] = 0;
    e[8] = R[o + 2]; e[9] = R[o + 5]; e[10] = R[o + 8]; e[11] = 0;
    e[12] = P[3 * g]; e[13] = P[3 * g + 1]; e[14] = P[3 * g + 2]; e[15] = 1;
    mesh.matrixWorldNeedsUpdate = true;
  }

  // ---- look -------------------------------------------------------------------------------------------
  function applyLook() {
    const t = K.themeById(look.theme), li = lightById(look.light);
    scene.background = scene.background && scene.background.isColor ? scene.background.set(t.bg) : new THREE.Color(t.bg);
    if (renderer) renderer.setClearColor(scene.background, 1);
    fog.color.set(t.bg); scene.fog = look.fog ? fog : null;
    hemi.color.set(li.sky); hemi.groundColor.set(li.ground); hemi.intensity = li.hemi * LS;
    key.color.set(li.key); key.intensity = li.keyI * LS;
    fill.color.set(li.fill); fill.intensity = li.fillI * LS;
    rim.color.set(li.rim); rim.intensity = li.rimI * LS;
    if (floorMats.length) {
      const base = K.mixHex(t.bg, t.bg2, t.dark ? 0.7 : 0.5);
      if (floorTex) floorTex.dispose();
      floorTex = gridTexture(THREE, base, K.mixHex(base, t.wall, t.dark ? 0.13 : 0.18), K.mixHex(base, t.accent, 0.4), 5, phone ? 128 : 256);
      const cell = niceStep(Math.max(0.05, extent / 3));
      for (const fm of floorMats) {
        const [w, h] = fm.userData.floor, map = floorTex.clone(); map.needsUpdate = true;
        map.repeat.set(2 * w / (5 * cell), 2 * h / (5 * cell));
        if (fm.map) fm.map.dispose();
        fm.map = map; fm.color.set(0xffffff); fm.needsUpdate = true;
      }
    }
    // the key light and its shadow box scale with the model
    const r = extent * 1.4, ks = key.shadow, kc = ks.camera;
    kc.left = -r; kc.right = r; kc.top = r; kc.bottom = -r; kc.near = 0.05 * extent; kc.far = 12 * extent;
    kc.updateProjectionMatrix();
    ks.bias = -0.0005; ks.normalBias = 0.006 * extent; ks.radius = 3;
    fill.position.set(-4, 2.5, -2).multiplyScalar(extent); rim.position.set(-1, 3, -5).multiplyScalar(extent);
  }
  function setLook(L) {
    const prevFloor = look.floor;
    Object.assign(look, L || {});
    if (L && L.floor && L.floor !== prevFloor && S) { buildModel(); return look; }
    applyLook();
    return look;
  }

  function applyMatFlags() {
    const all = mats.concat([...hl.values()]);
    for (const x of all) {
      const b = x.userData.base || { transparent: false, opacity: 1, depthWrite: true };
      x.transparent = b.transparent || flags.transparent;
      x.opacity = flags.transparent ? Math.min(b.opacity, 0.35) : b.opacity;
      x.depthWrite = flags.transparent ? false : b.depthWrite;
      x.wireframe = !!flags.wireframe;
      x.needsUpdate = true;
    }
    for (const mesh of meshes) mesh.castShadow = !flags.transparent && m.geom_type[mesh.userData.geom] !== GEOM.PLANE;
  }
  function applyGroups() {
    for (const mesh of meshes) mesh.visible = !!groups[mesh.userData.group] && mesh.userData.alpha > 0;
    pickables = meshes.filter(x => x.visible && x.userData.body > 0);
    for (const s of skins) s.mesh.visible = !!groups[s.group];
    for (const f of flexes) if (f.mesh) f.mesh.visible = !!groups[f.group];
  }

  // ---- per frame ------------------------------------------------------------------------------------------
  function update() {
    if (!S || S.disposed) return;
    if (stale()) refreshViews();
    for (let i = 0; i < dynamic.length; i++) writeMatrix(dynamic[i], dynamic[i].userData.geom);
    for (let i = 0; i < skins.length; i++) if (skins[i].mesh.visible) skins[i].update(d);
    for (let i = 0; i < flexes.length; i++) flexes[i].update(d);
    if (pert.body > 0) {
      const b = pert.body, XP = V.xpos, XM = V.xmat, l = pert.local, o = 9 * b;
      for (let k = 0; k < 3; k++) pert.anchor[k] = XP[3 * b + k] + XM[o + 3 * k] * l[0] + XM[o + 3 * k + 1] * l[1] + XM[o + 3 * k + 2] * l[2];
      if (pert.mode === 'rotate') rotateTorque();
    }
    drawOverlays(pools, X);
    applyCam();
    // the key light follows the view centre
    const L = cam.lookat;
    key.target.position.set(L[0], L[2], -L[1]);
    key.position.set(L[0] + 2.2 * extent, L[2] + 4 * extent, -L[1] + 1.8 * extent);
    if (look.fog) { fog.near = cam.distance * 2.5; fog.far = cam.distance * 9 + extent * 4; }
  }
  function applyCam() { if (S) cam.apply(m, d, V, W / H); }

  // simulate-like rotation spring: torque = I (K e - 2 sqrt(K) w)
  function rotateTorque() {
    const b = pert.body, q = V.xquat, t = pert.q;
    const bw = q[4 * b], bx = -q[4 * b + 1], by = -q[4 * b + 2], bz = -q[4 * b + 3];
    let w = t[0] * bw - t[1] * bx - t[2] * by - t[3] * bz, x = t[0] * bx + t[1] * bw + t[2] * bz - t[3] * by;
    let y = t[0] * by - t[1] * bz + t[2] * bw + t[3] * bx, z = t[0] * bz + t[1] * by - t[2] * bx + t[3] * bw;
    if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
    const s = Math.hypot(x, y, z), ang = s > 1e-12 ? 2 * Math.atan2(s, w) / s : 2;
    const I = V.body_inertia, Imax = Math.max(I[3 * b], I[3 * b + 1], I[3 * b + 2], V.body_subtreemass[b] * sc.meansize * sc.meansize * 0.1);
    const Kk = 100 * pert.k, D = 2 * Math.sqrt(Kk), cv = V.cvel, F = V.xfrc_applied, o = 6 * b;
    F[o] = 0; F[o + 1] = 0; F[o + 2] = 0;
    F[o + 3] = Imax * (Kk * ang * x - D * cv[o]); F[o + 4] = Imax * (Kk * ang * y - D * cv[o + 1]); F[o + 5] = Imax * (Kk * ang * z - D * cv[o + 2]);
  }

  function render() {
    update();
    if (renderer) renderer.render(scene, camera);
  }
  function resize(w, h) {
    W = Math.max(1, w || (canvas && canvas.clientWidth) || globalThis.innerWidth || 1);
    H = Math.max(1, h || (canvas && canvas.clientHeight) || globalThis.innerHeight || 1);
    if (renderer) renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    applyCam();
  }

  // ---- cameras ------------------------------------------------------------------------------------------------
  function resetCamera() {
    if (!S) return;
    const c = S.entry && S.entry.camera, st = m.stat, g = m.vis.global;
    cam.set({ fovy: g.fovy || 45 });
    if (c) cam.set({ azimuth: c.azimuth, elevation: c.elevation, distance: c.distance, lookat: c.lookat });
    else cam.set({ azimuth: g.azimuth, elevation: g.elevation, distance: 1.5 * st.extent, lookat: [st.center[0], st.center[1], st.center[2]] });
    applyCam();
  }
  function setCamera(p) {
    cam.set(p);
    if (p.mode === 'track' && p.body == null && cam.body <= 0) cam.body = selected > 0 ? selected : 1;
    applyCam();
    return cam.get();
  }

  // ---- picking and perturbation ---------------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hitV = new THREE.Vector3();
  function rayAt(x, y) {
    applyCam();
    root.updateMatrixWorld(true);
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  const toMj = (v, out = [0, 0, 0]) => { out[0] = v.x; out[1] = -v.z; out[2] = v.y; return out; };
  const toThree = (p, out = new THREE.Vector3()) => out.set(p[0], p[2], -p[1]);
  function pick(x, y) {
    if (!S) return null;
    const hits = rayAt(x, y).intersectObjects(pickables, false);
    for (const h of hits) {
      const b = h.object.userData.body;
      if (b > 0) return { body: b, geom: h.object.userData.geom, name: S.bodyNames[b] || 'body ' + b, point: toMj(h.point), distance: h.distance };
    }
    return null;
  }
  function select(b) {
    for (const mesh of meshes) mesh.material = mesh.userData.base;
    selected = b > 0 ? b : -1;
    if (selected > 0) {
      const t = K.themeById(look.theme);
      for (const mesh of meshes) {
        if (mesh.userData.body !== selected) continue;
        let c = hl.get(mesh.userData.base);
        if (!c) {
          c = mesh.userData.base.clone(); c.userData = mesh.userData.base.userData;
          c.emissive = new THREE.Color(t.accent); c.emissiveIntensity = 0.35;
          hl.set(mesh.userData.base, c);
        }
        mesh.material = c;
      }
      applyMatFlags();
    }
    return selected;
  }
  function beginPerturb(hit, rotate) {
    if (!S || !hit || hit.body <= 0) return false;
    const b = hit.body;
    pert.body = b; pert.mode = rotate ? 'rotate' : 'translate';
    pert.local = S.worldToLocal(b, hit.point);
    for (let k = 0; k < 3; k++) { pert.anchor[k] = hit.point[k]; pert.target[k] = hit.point[k]; }
    camera.getWorldDirection(tv);
    plane.setFromNormalAndCoplanarPoint(tv, toThree(hit.point, tv2));
    if (rotate) {
      S.clearPerturb();
      const q = V.xquat; for (let k = 0; k < 4; k++) pert.q[k] = q[4 * b + k];
    } else S.perturb(b, pert.local, hit.point, pert.k);
    return true;
  }
  function dragPerturb(x, y, dx, dy) {
    if (pert.body <= 0) return;
    if (pert.mode === 'translate') {
      if (!rayAt(x, y).ray.intersectPlane(plane, hitV)) return;
      toMj(hitV, pert.target);
      S.setPerturbTarget([pert.target[0], pert.target[1], pert.target[2]]);
    } else {
      // world rotation about the camera up (dx) and right (dy) axes, pre-multiplied
      const rot = (ax, a) => {
        const s = Math.sin(a / 2), c = Math.cos(a / 2), q = pert.q;
        const aw = c, axx = ax[0] * s, ayy = ax[1] * s, azz = ax[2] * s;
        const w = aw * q[0] - axx * q[1] - ayy * q[2] - azz * q[3], x2 = aw * q[1] + axx * q[0] + ayy * q[3] - azz * q[2];
        const y2 = aw * q[2] - axx * q[3] + ayy * q[0] + azz * q[1], z2 = aw * q[3] + axx * q[2] - ayy * q[1] + azz * q[0];
        const n = Math.hypot(w, x2, y2, z2); q[0] = w / n; q[1] = x2 / n; q[2] = y2 / n; q[3] = z2 / n;
      };
      rot(cam.upv, dx * 0.01); rot(cam.right, dy * 0.01);
    }
  }
  function endPerturb() {
    if (pert.body <= 0) return;
    if (pert.mode === 'rotate') { const F = V.xfrc_applied, o = 6 * pert.body; for (let k = 0; k < 6; k++) F[o + k] = 0; }
    else S.clearPerturb();
    pert.body = -1; pert.mode = null;
  }

  // ---- pointer --------------------------------------------------------------------------------------------------------
  let detach = () => {};
  function attachPointer() {
    if (!canvas || typeof canvas.addEventListener !== 'function' || opts.interact === false) return;
    if (canvas.style) canvas.style.touchAction = 'none';
    const pts = new Map();
    let mode = null, pinch = 0, mid = [0, 0];
    const local = e => { const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 }; return [e.clientX - r.left, e.clientY - r.top]; };
    const twoState = () => { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    const down = e => {
      const p = local(e); pts.set(e.pointerId, p);
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      if (pts.size === 2) { if (mode === 'perturb') endPerturb(); mode = 'pinch'; twoState(); return; }
      if (pts.size > 2) return;
      if (e.button === 2 || e.shiftKey) { mode = 'pan'; return; }
      const hit = e.button === 0 ? pick(p[0], p[1]) : null;
      if (hit && beginPerturb(hit, e.ctrlKey || e.metaKey)) mode = 'perturb'; else mode = 'orbit';
      e.preventDefault && e.preventDefault();
    };
    const move = e => {
      const prev = pts.get(e.pointerId); if (!prev) return;
      const p = local(e), dx = p[0] - prev[0], dy = p[1] - prev[1];
      pts.set(e.pointerId, p);
      if (mode === 'orbit') { if (cam.mode !== 'model') cam.orbit(dx, dy); }
      else if (mode === 'pan') { if (cam.mode !== 'model') cam.pan(dx, dy, H); }
      else if (mode === 'perturb') dragPerturb(p[0], p[1], dx, dy);
      else if (mode === 'pinch' && pts.size === 2) {
        const pp = pinch, pm = mid; twoState();
        if (cam.mode !== 'model') { if (pinch > 1 && pp > 1) cam.zoom(pp / pinch); cam.pan(mid[0] - pm[0], mid[1] - pm[1], H); }
      }
    };
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (mode === 'perturb') endPerturb();
      mode = pts.size === 1 ? 'orbit' : null;
    };
    const wheel = e => { e.preventDefault && e.preventDefault(); if (cam.mode !== 'model') cam.zoom(Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.002)); };
    const dbl = e => {
      const p = local(e), hit = pick(p[0], p[1]);
      select(hit ? hit.body : -1);
      if (hit && cam.mode === 'track') cam.body = hit.body;
      if (opts.onSelect) opts.onSelect(hit ? { body: hit.body, name: hit.name, point: hit.point } : null);
    };
    const ctx = e => e.preventDefault && e.preventDefault();
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('dblclick', dbl); canvas.addEventListener('contextmenu', ctx);
    detach = () => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('dblclick', dbl); canvas.removeEventListener('contextmenu', ctx);
    };
  }

  // ---- public ------------------------------------------------------------------------------------------------------------
  const R = {
    THREE, renderer, scene, camera, root, gl: !!renderer, error, flags, pools,
    get sim() { return S; },
    get look() { return look; },
    get selected() { return selected; },
    get perturbing() { return pert.body > 0 ? pert.mode : null; },
    get cameraNames() { return S ? Array.from({ length: m.ncam }, (_, i) => S.mj.mj_id2name(m, S.mj.mjtObj.mjOBJ_CAMERA.value, i) || 'camera ' + i) : []; },
    get meshes() { return meshes; },
    setSim(s) { S = s; buildModel(); return R; },
    update, render, resize, setLook, resetCamera, setCamera, getCamera: () => cam.get(),
    setFlags(p) {
      const mf = ('transparent' in p && p.transparent !== flags.transparent) || ('wireframe' in p && p.wireframe !== flags.wireframe);
      Object.assign(flags, p);
      if (mf) applyMatFlags();
      return flags;
    },
    setGroups(g) { groups = g.slice(); applyGroups(); return groups; },
    pick, select, beginPerturb, dragPerturb, endPerturb, toMj, toThree,
    stats() {
      let tri = 0;
      for (const x of meshes) if (x.visible) { const g = x.geometry; tri += (g.index ? g.index.count : g.attributes.position.count) / 3; }
      for (const s of skins) tri += s.nf;
      for (const f of flexes) if (f.geometry) tri += f.geometry.index.count / 3;
      return { geoms: m ? m.ngeom : 0, meshes: meshes.length, dynamic: dynamic.length, skins: skins.length, flexes: flexes.length, instances: pools.count(), triangles: Math.round(tri) };
    },
    dispose() {
      detach(); endPerturb(); clearModel(); pools.dispose();
      if (renderer && own) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); }
      S = null;
    },
  };
  resize(opts.width, opts.height);
  attachPointer();
  if (sim) R.setSim(sim); else applyLook();
  return R;
}
