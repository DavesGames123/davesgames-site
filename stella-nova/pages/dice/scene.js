// ============================================================================
//  DICE LAB  ·  scene.js — renderer, tray, lights, dice meshes and labels
// ----------------------------------------------------------------------------
//  three r160, WebGL. Units are cm, as in physics.js; the felt top is y = 0.
//
//  LOOK. ACES tone mapping, a studio room baked to a PMREM for reflections
//  (a warm softbox above, side strips, a cool rim), one key light with a
//  PCF soft shadow map sized to the tray, a warm fill. The tray is felt
//  (a canvas fibre texture, bump mapped) in a wood rim (a canvas grain
//  texture on rounded boxes) on a dark table.
//
//  DICE. One mesh per die: buildDie(type).mesh, one material per (type,
//  finish, style). The numbers are in the face texture (facetex.js), not
//  on a second surface, so nothing can z-fight. Finishes:
//    resin   physical, clearcoat 0.6        marble  as resin, swirl map
//    metal   metalness 1, roughness 0.28    glass   transmission 1, ior
//    wood    roughness 0.62                         1.5, the ink opaque
//    bone    roughness 0.5                          (transmissionMap)
//  Glass dice also get a caustic-like light spot on the felt: an additive
//  disc offset away from the key light, sharper and brighter as the die
//  comes down. The disc floats 0.02 cm over the felt with polygonOffset
//  -4, -4 and no depth write, so it cannot fight the felt.
//
//  LABELS. A sprite over each die (canvas text, no depth test, constant
//  screen size), so recordings and the saver keep them.
//
//  GREP MAP
//    function studioRoom ........ the reflection room
//    function feltTexture ....... the felt
//    function woodTexture ....... the rim grain
//    export function createScene  the factory
//      sc.setTray ............... felt, rim and shadow box for a tray size
//      sc.dieMaterial ........... one finish of one die type
//      sc.addDie ................ a mesh (+ caustic for glass)
//      sc.label ................. the sprite over a die
//      sc.render ................ the frame
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildDie } from './dice.js';
import { makeAtlas } from './facetex.js';
import { TRAYS, WALL } from './physics.js';

function studioRoom() {
  const sc = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pos = room.geometry.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 500, k = 0.03 + 0.05 * Math.max(0, y) + 0.015 * Math.max(0, -y); col.push(k * 1.04, k, k * 0.96); }
  room.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sc.add(room);
  const panel = (w, h, c, I, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(I), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m);
  };
  panel(340, 220, 0xfff1dc, 4.2, 60, 300, 120);
  panel(50, 420, 0xffffff, 2.6, -360, 60, 80);
  panel(50, 420, 0xfff4e8, 2.0, 360, 40, 40);
  panel(300, 80, 0xbcd0ff, 3.0, 0, 100, -400);
  panel(160, 160, 0xffffff, 2.0, -200, 300, -180);
  return sc;
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
// felt: a base colour, per-pixel fibre noise and a few longer fibres
function feltTexture(rgb, bump) {
  return canvasTex(512, 512, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    let s = 1234567;
    const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < w * h; i++) {
      const n = (r() + r() + r()) / 3 - 0.5;
      const k = bump ? 0.5 + n * 0.9 : 1 + n * 0.22;
      d[i * 4] = bump ? 255 * k : rgb[0] * k; d[i * 4 + 1] = bump ? 255 * k : rgb[1] * k; d[i * 4 + 2] = bump ? 255 * k : rgb[2] * k; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = bump ? 0.18 : 0.035; g.lineWidth = 1;
    for (let i = 0; i < 1600; i++) {
      const x = r() * w, y = r() * h, a = r() * Math.PI * 2, l = 4 + r() * 12;
      g.strokeStyle = r() < 0.5 ? '#fff' : '#000';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 1) * l / 2, y + Math.sin(a + 1) * l / 2, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }, !bump);
}
function woodTexture() {
  return canvasTex(1024, 128, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ring = Math.sin(y * 0.22 + Math.sin(x * 0.006) * 4 + Math.sin(x * 0.031 + y * 0.05) * 0.8) * 0.5 + 0.5;
      const fine = Math.sin(x * 0.9 + y * 3.1) * 0.03 + (Math.sin(y * 1.7 + x * 0.02) * 0.5 + 0.5) * 0.08;
      const k = 0.62 + ring * 0.28 + fine;
      const i = (y * w + x) * 4;
      d[i] = 118 * k + 20; d[i + 1] = 70 * k + 8; d[i + 2] = 38 * k + 4; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}
function causticTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x - w / 2) / (w / 2), v = (y - h / 2) / (h / 2), r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      // a bright rim with soft spokes: what a faceted lens throws
      const ring = Math.exp(-((r - 0.62) ** 2) / 0.012) * 0.8 + Math.exp(-(r * r) / 0.05) * 0.9;
      const spokes = 0.55 + 0.45 * Math.pow(Math.abs(Math.cos(a * 5 + r * 3)), 6);
      const k = Math.max(0, ring * spokes) * Math.max(0, 1 - r);
      const i = (y * w + x) * 4;
      d[i] = 255 * k; d[i + 1] = 245 * k; d[i + 2] = 225 * k; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function createScene({ canvas, coarse = false, onNoGL } = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { if (onNoGL) onNoGL(); throw e; }
  const dpr = () => Math.min(devicePixelRatio || 1, coarse ? 1.75 : 2, Math.max(1, 3200 / Math.max(1, canvas.clientWidth)));
  renderer.setPixelRatio(dpr());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioRoom(), 0.02).texture;
  pmrem.dispose();
  const bgc = document.createElement('canvas'); bgc.width = 32; bgc.height = 256;
  { const g = bgc.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#15141a'); gr.addColorStop(0.55, '#0b0a0e'); gr.addColorStop(1, '#060508'); g.fillStyle = gr; g.fillRect(0, 0, 32, 256); }
  const bg = new THREE.CanvasTexture(bgc); bg.colorSpace = THREE.SRGBColorSpace;
  scene.background = bg;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 2000);
  camera.position.set(0, 52, 46);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.minDistance = 6; controls.maxDistance = 160;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xfff4e6, 0x20160e, 0.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
  key.position.set(-18, 46, 22);
  key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0xc8d8ff, 0.45);
  fill.position.set(30, 20, -26); scene.add(fill);
  // a spot for the glass shot (off unless the saver turns it on)
  const spot = new THREE.SpotLight(0xfff0d8, 0, 120, 0.42, 0.6, 1.2);
  spot.position.set(-24, 22, 8); spot.castShadow = false; scene.add(spot); scene.add(spot.target);

  // the table under the tray
  const table = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.9, metalness: 0 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -1.2; table.receiveShadow = true;
  scene.add(table);

  const feltMap = feltTexture([22, 74, 58], false), feltBump = feltTexture(null, true);
  const feltMat = new THREE.MeshStandardMaterial({ map: feltMap, bumpMap: feltBump, bumpScale: 0.6, roughness: 0.96, metalness: 0, envMapIntensity: 0.35 });
  const woodMap = woodTexture();
  const woodMat = new THREE.MeshPhysicalMaterial({ map: woodMap, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.28, envMapIntensity: 0.8 });
  const tray = new THREE.Group(); scene.add(tray);
  let dims = TRAYS.medium;

  function setTray(name) {
    dims = TRAYS[name] || dims;
    tray.children.slice().forEach(m => { tray.remove(m); m.geometry.dispose(); });
    const [w, d] = dims, t = 2, H = WALL;
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(w, d), feltMat);
    felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true;
    feltMap.repeat.set(w / 12, d / 12); feltBump.repeat.set(w / 12, d / 12);
    felt.name = 'felt';
    tray.add(felt);
    const base = new THREE.Mesh(new RoundedBoxGeometry(w + 2 * t + 0.4, 1.2, d + 2 * t + 0.4, 3, 0.5), woodMat);
    base.position.y = -0.8; base.receiveShadow = true; tray.add(base);
    const rail = (x, z, lx, lz) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(lx, H + 0.4, lz, 4, 0.7), woodMat);
      m.position.set(x, H / 2 - 0.2, z); m.castShadow = true; m.receiveShadow = true; tray.add(m);
    };
    rail(-(w / 2 + t / 2), 0, t, d + 2 * t);
    rail(w / 2 + t / 2, 0, t, d + 2 * t);
    rail(0, -(d / 2 + t / 2), w, t);
    rail(0, d / 2 + t / 2, w, t);
    const S = Math.max(w, d) * 0.62 + 4;
    Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 5, far: 140 });
    key.shadow.camera.updateProjectionMatrix();
  }
  setTray('medium');

  // ── dice ─────────────────────────────────────────────────────────────────
  const geos = new Map(), mats = new Map();
  function dieGeometry(type) {
    if (geos.has(type)) return geos.get(type);
    const m = buildDie(type).mesh, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setIndex(m.index);
    g.computeBoundingSphere();
    geos.set(type, g);
    return g;
  }
  function tex(c, srgb) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  function dieMaterial(type, finish = 'resin', style = 'numbers') {
    const key2 = `${type}|${finish}|${style}`;
    if (mats.has(key2)) return mats.get(key2);
    const A = makeAtlas(buildDie(type), finish, style);
    const map = tex(A.color, true), hmap = tex(A.height, false);
    let m;
    const common = { map, bumpMap: hmap, bumpScale: 1.6 };
    switch (finish) {
      case 'metal': m = new THREE.MeshPhysicalMaterial({ ...common, metalness: 1, roughness: 0.24, envMapIntensity: 2.4, clearcoat: 0.2 }); break;
      case 'glass': m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.04, metalness: 0, transmission: 1, transmissionMap: hmap, thickness: 1.4, ior: 1.52, attenuationColor: new THREE.Color().setRGB(...A.finish.base.map(v => v / 255), THREE.SRGBColorSpace), attenuationDistance: 3.5, specularIntensity: 1, envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.03 }); break;
      case 'wood': m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.6 }); break;
      case 'bone': m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0xfff4dc), envMapIntensity: 0.7 }); break;
      case 'marble': m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.1, envMapIntensity: 0.9 }); break;
      default: m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.14, envMapIntensity: 0.85 });
    }
    m.userData.finish = finish;
    mats.set(key2, m);
    return m;
  }
  const causticTex = causticTexture();
  const causticGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const diceGroup = new THREE.Group(); scene.add(diceGroup);
  const fxGroup = new THREE.Group(); scene.add(fxGroup);
  const labelGroup = new THREE.Group(); scene.add(labelGroup);

  function addDie(type, finish, style) {
    const mesh = new THREE.Mesh(dieGeometry(type), dieMaterial(type, finish, style));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { type, finish };
    diceGroup.add(mesh);
    if (finish === 'glass') {
      const cm = new THREE.Mesh(causticGeo, new THREE.MeshBasicMaterial({ map: causticTex, color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }));
      cm.position.y = 0.02; cm.renderOrder = 2;
      const tint = new THREE.Color().setRGB(...makeAtlas(buildDie(type), 'glass').finish.base.map(v => v / 255), THREE.SRGBColorSpace);
      cm.material.color.copy(tint).lerp(new THREE.Color(1, 1, 1), 0.55);
      fxGroup.add(cm); mesh.userData.caustic = cm;
    }
    return mesh;
  }
  function clearDice() {
    for (const m of diceGroup.children.slice()) diceGroup.remove(m);
    for (const m of fxGroup.children.slice()) { fxGroup.remove(m); m.material.dispose(); }
    for (const s of labelGroup.children.slice()) { labelGroup.remove(s); s.material.map.dispose(); s.material.dispose(); }
  }
  const kdir = new THREE.Vector3();
  // place the caustic of a glass die: on the felt, away from the key light
  function updateCaustics(boost = 1) {
    const L = spot.intensity > 0 ? spot.position : key.position;
    for (const m of diceGroup.children) {
      const c = m.userData.caustic; if (!c) continue;
      kdir.copy(m.position).sub(L).normalize();
      const h = Math.max(0, m.position.y), R = buildDie(m.userData.type).R;
      const t = (h + R * 0.6) / Math.max(0.2, -kdir.y);
      c.position.set(m.position.x + kdir.x * t, 0.02, m.position.z + kdir.z * t);
      const s = R * (1.5 + h * 0.12);
      c.scale.set(s, 1, s * (1 + Math.hypot(kdir.x, kdir.z) * 0.6));
      c.rotation.y = Math.atan2(kdir.x, kdir.z);
      c.material.opacity = Math.min(1, 0.85 / (1 + h * 0.25)) * boost;
    }
  }

  // ── labels ───────────────────────────────────────────────────────────────
  function label(text, { cocked = false, dim = false, kept = true } = {}) {
    const c = document.createElement('canvas'), dp = 2; c.width = 160 * dp; c.height = 64 * dp;
    const g = c.getContext('2d'); g.scale(dp, dp);
    g.font = "600 26px Inter, system-ui, sans-serif";
    const w = Math.min(150, g.measureText(text).width + 26);
    const x = (160 - w) / 2;
    g.fillStyle = cocked ? 'rgba(120,52,20,0.92)' : 'rgba(10,10,14,0.82)';
    g.strokeStyle = cocked ? '#ffb070' : kept ? 'rgba(255,236,200,0.5)' : 'rgba(255,255,255,0.18)';
    g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(x, 10, w, 40, 12); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(80 - 7, 50); g.lineTo(80, 58); g.lineTo(80 + 7, 50); g.fill();
    g.fillStyle = cocked ? '#ffd8b0' : kept && !dim ? '#fff6e6' : 'rgba(255,255,255,0.45)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 80, 31);
    if (!kept) { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(80 - w / 2 + 10, 31); g.lineTo(80 + w / 2 - 10, 31); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
    s.center.set(0.5, 0.05); s.renderOrder = 10;
    labelGroup.add(s);
    return s;
  }
  // with sizeAttenuation off, a sprite of scale k is k / tan(fov / 2) in
  // NDC, so k = 2 px tan(fov / 2) / h gives px CSS pixels at any height
  function scaleLabels(h) {
    const px = Math.max(30, Math.min(46, h * 0.05));
    const k = 2 * px * Math.tan(camera.fov * Math.PI / 360) / Math.max(200, h);
    for (const s of labelGroup.children) s.scale.set(k * 2.5 * (s.userData.k || 1), k * (s.userData.k || 1), 1);
  }

  let viewOffset = null;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(dpr());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (viewOffset) camera.setViewOffset(w, h, viewOffset.x, viewOffset.y, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function setViewOffset(o) { viewOffset = o; }
  function render() {
    scaleLabels(canvas.clientHeight);
    renderer.render(scene, camera);
  }
  function dispose() {
    // lib/gpu-guard.js loses the context; a second loss logs a warning
    try { renderer.dispose(); } catch (e) { /* gone */ }
  }
  return {
    THREE, renderer, scene, camera, controls, key, fill, spot, hemi, tray, table, felt: feltMat, wood: woodMat,
    diceGroup, fxGroup, labelGroup, setTray, dieMaterial, dieGeometry, addDie, clearDice, updateCaustics, label,
    resize, render, dispose, setViewOffset, get dims() { return dims; },
  };
}
