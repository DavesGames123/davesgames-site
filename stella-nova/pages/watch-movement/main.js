// ============================================================================
//  WATCH MOVEMENT  ·  main.js — the scene, the explode, the controls
// ────────────────────────────────────────────────────────────────────────────
//  movement.js gives the outlines, the arbor positions and every angle.
//  This module extrudes the outlines into three.js meshes (units: mm, z out
//  of the caseback), poses them each frame from M.pose(), and spreads the
//  layers along z for the exploded view.
//
//  LAYERS  (explode offset = spread * EXPLODE_MM * k)
//    hands -3.2 · dial -2.3 · motion works -1.3 · plate 0 · train 1
//    balance 1.9 · bridges 2.8 · balance cock 3.7
//  The pallet lever stays in the train layer, so it still works the escape
//  wheel when the movement is apart. Screws lift a little above their
//  bridges; the barrel cover lifts off to show the mainspring; the stem
//  slides out of the pendant.
//
//  GREP MAP
//    function buildMovement ...... every part, layer by layer
//    function poseScene .......... angles and explode offsets per frame
//    function springRibbon ....... mainspring and hairspring (dynamic)
//    function dialTexture ........ the dial art (canvas)
//    function finishTextures ..... Geneva stripes, perlage, circular grain
//    const VIEWS ................. camera presets
//    const INFO .................. the text of the part card
//    function occlusion .......... framing around the panel and the dock
//    function frame .............. the loop
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as G from './geom.js';
import lever from './calibres/lever.js';
// the lever calibre under the names this scene was written against
const M = {
  ...G, CAL: lever.CAL, LAYOUT: lever.L, createState: lever.createState, pose: lever.pose, periods: lever.periods,
  step: (s, dt, ratchetTurn = 0) => lever.step(s, dt, -ratchetTurn / G.TAU),
  stonePolys: g => lever.ESC.stonePolys(g), escapeProfile: () => G.escapeProfile(15, lever.CAL.escape.Ra, lever.CAL.escape.Rf),
};

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const { CAL, LAYOUT: L, TAU } = M;
const D = Math.PI / 180;
const Z = CAL.z;
const EXPLODE_MM = 9;

// ── renderer, scene, light ─────────────────────────────────────────────────
const canvas = $('view');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
catch (e) { $('nogl').hidden = false; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.75 : 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
camera.up.set(0, 0, 1);
camera.position.set(30, -60, 70);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 14; controls.maxDistance = 320;
controls.target.set(0, 0, 1);

const key = new THREE.DirectionalLight(0xfff0dc, 1.9);
key.position.set(28, -18, 70);
key.castShadow = true;
key.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 10, far: 220 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x9db6ff, 0.9);
rim.position.set(-50, 40, -30);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x2a1e10, 0.35));

// ── finishes: Geneva stripes, perlage, circular grain (roughness maps) ─────
function canvasTex(n, fn, repeat, offset = 0) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = Math.max(0, Math.min(255, fn(x / n, y / n) * 255)), i = (y * n + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat); t.offset.set(offset, offset);
  t.anisotropy = 4;
  return t;
}
function finishTextures() {
  // Geneva stripes: two 2.2 mm stripes per tile, arcs of a turning disc
  const geneva = canvasTex(256, (u, v) => {
    const xl = (u * 2 % 1) - 0.5, y = v * 2 % 1;
    const r = Math.hypot(xl * 1.1, y + 0.9);
    const edge = Math.abs(xl) > 0.47 ? 0.25 : 0;
    return 0.36 + 0.07 * Math.sin(r * 70) + edge * 0.4;
  }, 1 / 4.4);
  // perlage: overlapping grained spots on a 1.1 mm grid, later spots on top
  const perlage = canvasTex(256, (u, v) => {
    const s = 1 / 4, R = 0.36;
    let best = -1, val = 0.5;
    const ci = Math.floor(u / s), cj = Math.floor(v / s);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const cx = (i + 0.5 + 0.5 * (j & 1)) * s, cy = (j + 0.5) * s;
      const dx = u - cx, dy = v - cy, d = Math.hypot(dx, dy);
      const order = j * 64 + i;
      if (d < R * s * 1.6 && order > best) { best = order; val = 0.44 + 0.05 * Math.sin(Math.atan2(dy, dx) * 22) + (d > R * s * 1.45 ? 0.12 : 0); }
    }
    return val;
  }, 1 / 4.4);
  // circular grain for the wheels, centred on each arbor
  const grain = canvasTex(512, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 18;
    return 0.42 + 0.12 * Math.sin(r * 55) + 0.06 * Math.sin(r * 13.0 + 1.7);
  }, 1 / 18, 0.5);
  return { geneva, perlage, grain };
}
const TEX = finishTextures();

const std = o => new THREE.MeshStandardMaterial(o);
const MAT = {
  gilt: std({ color: 0xe8be72, metalness: 1, roughness: 0.32, roughnessMap: TEX.grain }),
  brass: std({ color: 0xd9a95a, metalness: 1, roughness: 0.36 }),
  rhodium: std({ color: 0xc4c9d2, metalness: 1, roughness: 0.38, roughnessMap: TEX.geneva }),
  plate: std({ color: 0xaab0bb, metalness: 1, roughness: 0.48, roughnessMap: TEX.perlage }),
  steel: std({ color: 0xe9ebf0, metalness: 1, roughness: 0.14 }),
  satin: std({ color: 0xd6d9e0, metalness: 1, roughness: 0.3, roughnessMap: TEX.grain }),
  blued: std({ color: 0x2a4fc8, metalness: 1, roughness: 0.26 }),
  glucydur: std({ color: 0xf2a878, metalness: 1, roughness: 0.24 }),
  spring: std({ color: 0xb8c6e0, metalness: 1, roughness: 0.28, side: THREE.DoubleSide }),
  hair: std({ color: 0xdfe6f4, metalness: 1, roughness: 0.2, side: THREE.DoubleSide }),
  ruby: new THREE.MeshPhysicalMaterial({ color: 0xb3102c, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, ior: 1.76, specularIntensity: 1, emissive: 0x3a0008 }),
  slot: std({ color: 0x06070c, roughness: 0.7 }),
  dial: null,
};

// ── geometry helpers ───────────────────────────────────────────────────────
const v2 = p => new THREE.Vector2(p[0], p[1]);
function shapeOf(outline, holes = []) {
  const s = new THREE.Shape(outline.map(v2));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(v2)));
  return s;
}
const pickables = [];
function mesh(geo, mat, part) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.part = part; m.userData.base = mat;
  pickables.push(m);
  return m;
}
// an outline extruded from z0 to z1, with a small bevel to catch the light
function slab(outline, holes, z0, z1, mat, part, bev = 0.025) {
  const b = Math.min(bev, (z1 - z0) * 0.3);
  const g = new THREE.ExtrudeGeometry(shapeOf(outline, holes), {
    depth: Math.max(0.005, z1 - z0 - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 6,
  });
  g.translate(0, 0, z0 + b);
  return mesh(g, mat, part);
}
function cyl(r, z0, z1, mat, part, seg = 28) {
  const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg);
  g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2);
  return mesh(g, mat, part);
}
const circ = (r, n = 48, c = [0, 0]) => M.circlePoly(r, n, c);
const ring = (r0, r1, z0, z1, mat, part) => slab(circ(r1, 64), [circ(r0, 40).reverse()], z0, z1, mat, part);
const local = (p, o) => [p[0] - o[0], p[1] - o[1]];
// a stadium from a to b, width w
function capsule(a, b, w, n = 10) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), out = [];
  for (let i = 0; i <= n; i++) out.push([b[0] + w / 2 * Math.cos(ang - Math.PI / 2 + Math.PI * i / n), b[1] + w / 2 * Math.sin(ang - Math.PI / 2 + Math.PI * i / n)]);
  for (let i = 0; i <= n; i++) out.push([a[0] + w / 2 * Math.cos(ang + Math.PI / 2 + Math.PI * i / n), a[1] + w / 2 * Math.sin(ang + Math.PI / 2 + Math.PI * i / n)]);
  return out;
}
const bevelFor = m => Math.min(0.025, m * 0.12);

// ── parts and layers ────────────────────────────────────────────────────────
const LAYER_K = { hands: -3.2, dial: -2.3, motion: -1.3, plate: 0, train: 1, balance: 1.9, bridges: 2.8, cock: 3.7 };
const layers = {};
for (const k in LAYER_K) { layers[k] = new THREE.Group(); scene.add(layers[k]); }
const parts = {};       // id -> { id, name, root, layer, label }
// a part: a group at (x, y) inside a layer; `lift` adds explode height in units
function part(id, name, layer, at = [0, 0], opts = {}) {
  const root = new THREE.Group();
  root.position.set(at[0], at[1], 0);
  const holder = new THREE.Group();          // carries the per-part explode lift
  holder.add(root);
  layers[layer].add(holder);
  const p = { id, name, layer, root, holder, at, lift: opts.lift || 0, slide: opts.slide || null, label: opts.label || null, labelZ: opts.labelZ ?? 0, labelAt: opts.labelAt || null };
  parts[id] = p;
  return p;
}
const add = (p, ...ms) => { for (const m of ms) p.root.add(m); return p; };

// ── dynamic spring ribbons ─────────────────────────────────────────────────
// n points along a curve, each a vertical pair (z0, z1); update(fn) moves
// them, fn(s) -> [x, y] for s in 0..1
function springRibbon(n, z0, z1, mat, part) {
  const pos = new Float32Array(n * 2 * 3), nor = new Float32Array(n * 2 * 3), idx = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(idx);
  const m = mesh(g, mat, part);
  m.frustumCulled = false;
  m.userData.update = fn => {
    let px = 0, py = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = fn(i / (n - 1));
      const [nx, ny] = fn(Math.min(1, (i + 1) / (n - 1)));
      let tx = nx - x, ty = ny - y; if (i === n - 1) { tx = x - px; ty = y - py; }
      const tl = Math.hypot(tx, ty) || 1, ox = ty / tl, oy = -tx / tl;
      const k = i * 6;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z0; pos[k + 3] = x; pos[k + 4] = y; pos[k + 5] = z1;
      nor[k] = nor[k + 3] = ox; nor[k + 1] = nor[k + 4] = oy; nor[k + 2] = nor[k + 5] = 0;
      px = x; py = y;
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere();
  };
  return m;
}

// ── the dial (canvas texture on a face turned toward -z) ────────────────────
function dialTexture() {
  const N = COARSE ? 1024 : 2048, R = 18.6, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), s = N / (2 * R);
  g.translate(N / 2, N / 2); g.scale(s, s);       // mm, origin at the centre, y down
  const bg = g.createRadialGradient(-3, -5, 1, 0, 0, R);
  bg.addColorStop(0, '#fbf8f0'); bg.addColorStop(1, '#ece5d6');
  g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  const ink = '#1d1b22';
  g.strokeStyle = ink; g.fillStyle = ink;
  // railway minute track
  g.lineWidth = 0.09;
  for (const r of [16.55, 17.45]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a);
    g.lineWidth = i % 5 ? 0.07 : 0.16;
    g.beginPath(); g.moveTo(ca * 16.55, sa * 16.55); g.lineTo(ca * 17.45, sa * 17.45); g.stroke();
  }
  // Roman numerals, bottoms toward the centre
  const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.font = '500 2.55px "STIX Two Text","Times New Roman",Georgia,serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    if (i === 6) continue;                         // the seconds sub-dial sits at 6
    const a = i / 12 * TAU;
    g.save(); g.rotate(a); g.translate(0, -14.35); g.scale(i === 0 ? 1 : 0.94, 1.2); g.fillText(RN[i], 0, 0); g.restore();
  }
  // small seconds
  const sy = 10.25;
  g.lineWidth = 0.07;
  for (const r of [3.35, 3.95]) { g.beginPath(); g.arc(0, sy, r, 0, TAU); g.stroke(); }
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a);
    const r0 = i % 5 ? 3.55 : 3.35;
    g.lineWidth = i % 5 ? 0.05 : 0.1;
    g.beginPath(); g.moveTo(ca * r0, sy + sa * r0); g.lineTo(ca * 3.95, sy + sa * 3.95); g.stroke();
  }
  g.font = '1.0px "STIX Two Text","Times New Roman",Georgia,serif';
  for (let i = 1; i <= 6; i++) { const a = i / 6 * TAU; g.fillText(String(i * 10), Math.sin(a) * 2.6, sy - Math.cos(a) * 2.6); }
  g.font = '600 1.15px Inter,Helvetica,Arial,sans-serif';
  g.fillText('STELLA  NOVA', 0, -6.0);
  g.font = '0.7px Inter,Helvetica,Arial,sans-serif';
  g.fillStyle = '#6b6672';
  g.fillText('LEVER  ·  18 000 A/h', 0, -4.7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(1 / (2 * R), 1 / (2 * R)); t.offset.set(0.5, 0.5);
  return t;
}

// ── build ───────────────────────────────────────────────────────────────────
const dyn = {};            // dynamic meshes: mainspring, hairspring
const S = {
  watch: M.createState(nowSeconds(), 0.85),
  rate: 1, lastRate: 1, explode: 0, explodeTarget: 0.6, winding: false, windStart: 0,
  showDial: true, showBridges: true, showLabels: !PHONE_Q.matches, sel: null,
};
function nowSeconds() { const d = new Date(); return ((d.getHours() % 12) * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000); }

function buildMovement() {
  const c = CAL;

  // PLATE
  const plate = part('plate', 'Main plate', 'plate', [0, 0], { label: 'Main plate', labelZ: 0, labelAt: [-13.5, -10] });
  add(plate, slab(circ(c.plateR, 160), [], -c.plateT, 0, MAT.plate, 'plate', 0.06));
  add(plate, ring(c.plateR - 0.6, c.plateR, -0.02, 0.04, MAT.satin, 'plate'));
  const plateJewels = [L.C, L.T, L.F, L.E, L.P, L.Bal];
  for (const j of plateJewels) {
    add(plate, slab(circ(0.62, 32, j), [circ(0.13, 12, j).reverse()], -0.02, 0.1, MAT.ruby, 'jewel'));
  }

  // GOING TRAIN
  const bar = part('barrel', 'Barrel', 'train', L.B, { label: 'Barrel', labelZ: Z.barrelHi });
  add(bar,
    slab(M.wheelProfile(c.barrel.N, c.barrel.m), [circ(6.95, 96).reverse()], Z.barrelLo, Z.barrelLo + 0.32, MAT.gilt, 'barrel', bevelFor(c.barrel.m)),
    slab(circ(7.25, 120), [circ(6.95, 120).reverse()], Z.barrelLo + 0.3, Z.barrelHi - 0.12, MAT.gilt, 'barrel'),
    slab(circ(6.96, 96), [circ(1.25, 32).reverse()], Z.barrelLo, Z.barrelLo + 0.14, MAT.gilt, 'barrel'));
  const cover = part('barrelCover', 'Barrel cover', 'train', L.B, { lift: 0.55 });
  add(cover, slab(circ(7.25, 120), [circ(1.25, 32).reverse()], Z.barrelHi - 0.14, Z.barrelHi, MAT.gilt, 'barrel', 0.03));
  const arbor = part('barrelArbor', 'Barrel arbor', 'train', L.B);
  add(arbor, cyl(1.15, Z.barrelLo + 0.1, Z.barrelHi, MAT.steel, 'mainspring', 32), cyl(0.55, -0.4, Z.bridgeHi + 0.05, MAT.steel, 'mainspring'));
  const springPart = part('mainspring', 'Mainspring', 'train', L.B, { label: 'Mainspring', labelZ: Z.barrelHi });
  dyn.mainspring = springRibbon(1400, Z.barrelLo + 0.25, Z.barrelHi - 0.2, MAT.spring, 'mainspring');
  add(springPart, dyn.mainspring);

  const wheelPart = (id, name, at, wheelN, wheelM, pinN, pinM, zw, zp, spokes, label) => {
    const p = part(id, name, 'train', at, { label, labelZ: Math.max(zw, zp) + 0.3 });
    const R = M.pitchR(wheelM, wheelN), Rf = R - 1.6 * wheelM;
    add(p,
      slab(M.wheelProfile(wheelN, wheelM), spokes ? M.spokeWindows(spokes.rIn, Rf - spokes.rim, spokes.n, spokes.w).map(w => w.reverse()) : [], zw - 0.13, zw + 0.13, MAT.gilt, id, bevelFor(wheelM)),
      slab(M.pinionProfile(pinN, pinM), [], zp - 0.17, zp + 0.17, MAT.steel, id, 0.01),
      cyl(spokes ? spokes.rIn * 0.75 : 0.5, zw - 0.17, zw + 0.17, MAT.steel, id));
    return p;
  };
  const center = wheelPart('center', 'Centre wheel', L.C, c.center.N, c.center.m, c.center.p, c.barrel.m, Z.center, Z.barrelTeeth, { rIn: 1.05, rim: 0.45, n: 4, w: 0.5 }, 'Centre wheel');
  add(center, cyl(0.32, -c.plateT, Z.bridgeHi + 0.05, MAT.steel, 'center'));
  const third = wheelPart('third', 'Third wheel', L.T, c.third.N, c.third.m, c.third.p, c.center.m, Z.third, Z.center, { rIn: 0.9, rim: 0.4, n: 4, w: 0.42 }, 'Third wheel');
  add(third, cyl(0.22, 0, Z.bridgeHi + 0.05, MAT.steel, 'third'));
  const fourth = wheelPart('fourth', 'Fourth wheel', L.F, c.fourth.N, c.fourth.m, c.fourth.p, c.third.m, Z.fourth, Z.third, { rIn: 0.8, rim: 0.38, n: 4, w: 0.4 }, 'Fourth wheel');
  add(fourth, cyl(0.22, Z.dialLo - 0.45, Z.bridgeHi + 0.05, MAT.steel, 'fourth'));

  const esc = part('escape', 'Escape wheel', 'train', L.E, { label: 'Escape wheel', labelZ: Z.escape + 0.4 });
  add(esc,
    slab(M.escapeProfile(), M.spokeWindows(0.55, 1.42, 5, 0.3).map(w => w.reverse()), Z.escape - 0.11, Z.escape + 0.11, MAT.steel, 'escape', 0.012),
    slab(M.pinionProfile(c.escape.p, c.fourth.m), [], Z.fourth - 0.17, Z.fourth + 0.17, MAT.steel, 'escape', 0.01),
    cyl(0.4, Z.escape - 0.15, Z.escape + 0.15, MAT.steel, 'escape'),
    cyl(0.2, 0, Z.bridgeHi + 0.05, MAT.steel, 'escape'));

  // PALLET LEVER (train layer, so it keeps working the escape wheel apart)
  const lever = part('pallet', 'Pallet lever', 'train', L.P, { label: 'Pallet lever', labelZ: Z.fork + 0.5 });
  const stones = M.stonePolys(0).map(s => s.map(p => local(p, L.P)));
  const u = M.pol(1, L.psi);
  const forkEnd = [u[0] * c.forkLen, u[1] * c.forkLen];
  for (const s of stones) {
    const base = [(s[1][0] + s[2][0]) / 2, (s[1][1] + s[2][1]) / 2];
    add(lever, slab(capsule([0, 0], base, 0.5), [], Z.fork - 0.1, Z.fork + 0.06, MAT.steel, 'pallet', 0.015));
    add(lever, slab(s, [], Z.fork - 0.16, Z.fork + 0.2, MAT.ruby, 'pallet', 0.01));
  }
  const nrm = [-u[1], u[0]];
  add(lever, slab(capsule([0, 0], [u[0] * (c.forkLen - 0.45), u[1] * (c.forkLen - 0.45)], 0.42), [], Z.fork - 0.1, Z.fork + 0.06, MAT.steel, 'pallet', 0.015));
  for (const sg of [1, -1]) {                   // the fork horns around the impulse jewel
    const a = [forkEnd[0] - u[0] * 0.5 + nrm[0] * sg * 0.32, forkEnd[1] - u[1] * 0.5 + nrm[1] * sg * 0.32];
    const b = [forkEnd[0] + u[0] * 0.35 + nrm[0] * sg * 0.42, forkEnd[1] + u[1] * 0.35 + nrm[1] * sg * 0.42];
    add(lever, slab(capsule(a, b, 0.26), [], Z.fork - 0.1, Z.fork + 0.06, MAT.steel, 'pallet', 0.015));
  }
  add(lever, slab(circ(0.55, 24), [], Z.fork - 0.1, Z.fork + 0.06, MAT.steel, 'pallet', 0.015), cyl(0.18, 0, Z.palletCockHi + 0.05, MAT.steel, 'pallet'));

  // BALANCE (its own layer)
  const bal = part('balance', 'Balance wheel', 'balance', L.Bal, { label: 'Balance wheel', labelZ: Z.balance + 0.6 });
  add(bal, slab(circ(c.balR, 140), [circ(c.balR - 0.45, 140).reverse()], Z.balance - 0.2, Z.balance + 0.2, MAT.glucydur, 'balance', 0.04));
  for (let k = 0; k < 3; k++) {
    const a = 90 * D + k * 120 * D;
    add(bal, slab(capsule([0, 0], M.pol(c.balR - 0.3, a), 0.55), [], Z.balance - 0.08, Z.balance + 0.08, MAT.glucydur, 'balance', 0.02));
  }
  const screwGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 14); screwGeo.rotateZ(Math.PI / 2);
  for (let k = 0; k < 14; k++) {
    const a = (k + 0.5) / 14 * TAU, m = mesh(screwGeo, k % 7 === 3 ? MAT.steel : MAT.gilt, 'balance');
    m.position.set(...M.pol(c.balR + 0.19, a), Z.balance); m.rotation.z = a;
    bal.root.add(m);
  }
  add(bal,
    cyl(0.17, 0.35, Z.cockLo + 0.15, MAT.steel, 'balance'),
    cyl(0.55, Z.hairspring - 0.1, Z.hairspring + 0.12, MAT.steel, 'hairspring'),
    slab(circ(c.jewelR + 0.35, 40), [], Z.fork - 0.45, Z.fork - 0.3, MAT.steel, 'balance', 0.015),
    cyl(0.5, Z.fork + 0.2, Z.fork + 0.35, MAT.steel, 'balance'));
  const jewelPin = cyl(0.11, Z.fork - 0.3, Z.fork + 0.12, MAT.ruby, 'balance', 12);
  jewelPin.position.set(...M.pol(c.jewelR, L.psi + Math.PI), 0);
  bal.root.add(jewelPin);
  const hs = part('hairspring', 'Hairspring', 'balance', L.Bal, { label: 'Hairspring', labelZ: Z.hairspring + 0.3 });
  dyn.hairspring = springRibbon(13 * 48, Z.hairspring - 0.07, Z.hairspring + 0.07, MAT.hair, 'hairspring');
  add(hs, dyn.hairspring);

  // BRIDGES
  const feetBB = [M.pol(8.5, 200 * D), M.pol(8.45, 95 * D)].map(p => [L.B[0] + p[0], L.B[1] + p[1]]);
  const bb = part('barrelBridge', 'Barrel bridge', 'bridges', [0, 0], { label: 'Barrel bridge', labelZ: Z.bridgeHi });
  const bbOutline = M.hullOfCircles([[L.B, 8.1], [L.C, 1.7], ...feetBB.map(f => [f, 1.15])]);
  add(bb, slab(bbOutline, [circ(0.62, 24, L.B).reverse()], Z.bridgeLo, Z.bridgeHi, MAT.rhodium, 'barrelBridge', 0.06));
  for (const f of feetBB) add(bb, slab(circ(1.0, 32, f), [], 0, Z.bridgeLo, MAT.rhodium, 'barrelBridge', 0));
  add(bb, slab(circ(0.62, 24, L.C), [circ(0.13, 12, L.C).reverse()], Z.bridgeHi - 0.05, Z.bridgeHi + 0.06, MAT.ruby, 'jewel'));

  const feetTB = [[-6.0, -10.4], [1.0, -15.8]];
  const tb = part('trainBridge', 'Train bridge', 'bridges', [0, 0], { label: 'Train bridge', labelZ: Z.bridgeHi });
  const tbOutline = M.hullOfCircles([[L.T, 1.7], [L.F, 1.8], [L.E, 1.3], ...feetTB.map(f => [f, 1.35])]);
  add(tb, slab(tbOutline, [], Z.bridgeLo, Z.bridgeHi, MAT.rhodium, 'trainBridge', 0.06));
  for (const f of feetTB) add(tb, slab(circ(1.05, 32, f), [], 0, Z.bridgeLo, MAT.rhodium, 'trainBridge', 0));
  for (const j of [L.T, L.F, L.E]) {
    add(tb, slab(circ(0.95, 32, j), [], Z.bridgeHi - 0.02, Z.bridgeHi + 0.06, MAT.gilt, 'trainBridge', 0.02));
    add(tb, slab(circ(0.55, 24, j), [circ(0.12, 12, j).reverse()], Z.bridgeHi + 0.04, Z.bridgeHi + 0.12, MAT.ruby, 'jewel'));
  }

  const pc = part('palletCock', 'Pallet cock', 'bridges', [0, 0], { label: null });
  add(pc, slab(M.hullOfCircles([[L.P, 0.95], [L.palletFoot, 0.95]]), [], Z.bridgeLo, Z.palletCockHi, MAT.rhodium, 'palletCock', 0.05));
  add(pc, slab(circ(0.8, 24, L.palletFoot), [], 0, Z.bridgeLo, MAT.rhodium, 'palletCock', 0));
  add(pc, slab(circ(0.5, 24, L.P), [circ(0.1, 12, L.P).reverse()], Z.palletCockHi - 0.03, Z.palletCockHi + 0.07, MAT.ruby, 'jewel'));

  // ratchet, crown wheel, click on the barrel bridge
  const rat = part('ratchet', 'Ratchet wheel', 'bridges', L.B, { label: 'Ratchet', labelZ: Z.ratchet + 0.4 });
  add(rat, slab(M.wheelProfile(c.ratchet.N, c.ratchet.m), [], Z.ratchet - 0.17, Z.ratchet + 0.17, MAT.satin, 'ratchet', 0.02));
  const crw = part('crownWheel', 'Crown wheel', 'bridges', L.CW, { label: 'Crown wheel', labelZ: Z.ratchet + 0.4 });
  add(crw, slab(M.wheelProfile(c.crown.N, c.crown.m), [], Z.ratchet - 0.17, Z.ratchet + 0.17, MAT.satin, 'crownWheel', 0.02));
  const clk = part('click', 'Click', 'bridges', L.click);
  const tip = local([L.B[0] + Math.cos(246 * D) * 4.02, L.B[1] + Math.sin(246 * D) * 4.02], L.click);
  add(clk, slab(capsule([0, 0], tip, 0.55), [], Z.ratchet - 0.15, Z.ratchet + 0.1, MAT.steel, 'click', 0.02),
    slab(circ(0.55, 20), [], Z.ratchet + 0.1, Z.ratchet + 0.32, MAT.blued, 'click', 0.03));
  const clickSpring = part('clickSpring', 'Click spring', 'bridges', L.click);
  const arc = []; for (let i = 0; i <= 24; i++) { const a = (150 + i * 3.6) * D; arc.push([Math.cos(a) * 2.1 + 1.0, Math.sin(a) * 2.1 + 1.6]); }
  const arcIn = arc.map(([x, y]) => { const dx = x - 1.0, dy = y - 1.6, l = Math.hypot(dx, dy); return [1.0 + dx * (l - 0.14) / l, 1.6 + dy * (l - 0.14) / l]; }).reverse();
  add(clickSpring, slab(arc.concat(arcIn), [], Z.ratchet - 0.12, Z.ratchet + 0.04, MAT.steel, 'click', 0));

  // stem, winding pinion, crown (the stem slides out with the explode)
  const zStem = Z.ratchet + 0.17 + M.pitchR(c.winding.m, c.winding.N) - 0.12;
  const yPin = L.CW[1] + M.pitchR(c.crown.m, c.crown.N);
  const stem = part('stem', 'Winding stem and crown', 'bridges', [0, 0], { slide: 7, label: 'Crown', labelZ: zStem + 2.6, labelAt: [0, 21] });
  const spin = new THREE.Group(); spin.position.set(0, 0, zStem); stem.root.add(spin);
  stem.spin = spin;
  const along = (geo, y0) => { geo.rotateX(-Math.PI / 2); geo.translate(0, y0, 0); return geo; };
  const wp = slab(M.pinionProfile(c.winding.N, c.winding.m), [], 0, 0.5, MAT.steel, 'stem', 0.01);
  along(wp.geometry, yPin - 0.25); spin.add(wp);
  const rod = new THREE.CylinderGeometry(0.42, 0.42, 19.8 - (yPin + 0.25), 20);
  rod.translate(0, (19.8 + yPin + 0.25) / 2, 0);
  spin.add(mesh(rod, MAT.steel, 'stem'));
  const crownM = slab(M.gearProfile(36, 0.13, { t: 0.5, ha: 0.6, hf: 0.6, seg: 3 }), [], 0, 2.5, MAT.brass, 'stem', 0.04);
  along(crownM.geometry, 19.8); spin.add(crownM);
  const dome = new THREE.SphereGeometry(2.2, 32, 12, 0, TAU, 0, Math.PI / 2);
  dome.scale(1, 0.35, 1); dome.translate(0, 22.3, 0);
  spin.add(mesh(dome, MAT.brass, 'stem'));

  // BALANCE COCK (own layer, top)
  const cock = part('cock', 'Balance cock', 'cock', [0, 0], { label: 'Balance cock', labelZ: Z.cockHi });
  add(cock, slab(M.hullOfCircles([[L.Bal, 1.35], [L.cockFoot, 2.25]]), [circ(0.5, 20, L.Bal).reverse()], Z.cockLo, Z.cockHi, MAT.rhodium, 'cock', 0.08));
  add(cock, slab(circ(1.95, 40, L.cockFoot), [], 0, Z.cockLo, MAT.rhodium, 'cock', 0));
  add(cock, slab(circ(1.05, 40, L.Bal), [circ(0.62, 30, L.Bal).reverse()], Z.cockHi - 0.02, Z.cockHi + 0.14, MAT.gilt, 'cock', 0.03));
  add(cock, slab(circ(0.55, 24, L.Bal), [circ(0.12, 12, L.Bal).reverse()], Z.cockHi - 0.02, Z.cockHi + 0.08, MAT.ruby, 'jewel'));
  const regTip = [L.Bal[0] + Math.cos(52 * D) * 6.3, L.Bal[1] + Math.sin(52 * D) * 6.3];
  add(cock, slab(capsule(L.Bal, regTip, 0.32), [circ(0.75, 24, L.Bal).reverse()], Z.cockHi + 0.14, Z.cockHi + 0.24, MAT.steel, 'cock', 0.02));
  // the hairspring stud hangs from the cock at the outer end of the spring
  const studAt = [L.Bal[0] + Math.cos(60 * D) * 3.75, L.Bal[1] + Math.sin(60 * D) * 3.75];
  add(cock, slab(circ(0.28, 16, studAt), [], Z.hairspring - 0.12, Z.cockLo, MAT.steel, 'cock', 0));

  // SCREWS (blued, slotted), lifted above their bridges in the explode
  const screws = part('screws', 'Bridge screws', 'bridges', [0, 0], { lift: 0.45 });
  const cockScrews = part('cockScrew', 'Cock screw', 'cock', [0, 0], { lift: 0.45 });
  const screw = (p, at, z, r = 0.62) => {
    const head = cyl(r, z, z + 0.36, MAT.blued, 'screws', 28); head.position.set(at[0], at[1], 0);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(r * 2.05, 0.13, 0.14), MAT.slot);
    slot.position.set(at[0], at[1], z + 0.32); slot.rotation.z = (at[0] * 7.1 + at[1] * 3.3) % TAU;
    p.root.add(head, slot);
  };
  for (const f of feetBB) screw(screws, f, Z.bridgeHi);
  screw(screws, [L.B[0] + Math.cos(300 * D) * 6.0, L.B[1] + Math.sin(300 * D) * 6.0], Z.bridgeHi);
  for (const f of feetTB) screw(screws, f, Z.bridgeHi);
  screw(screws, L.palletFoot, Z.palletCockHi, 0.5);
  screw(screws, L.B, Z.ratchet + 0.17, 1.1);
  screw(screws, L.CW, Z.ratchet + 0.17, 0.75);
  screw(cockScrews, L.cockFoot, Z.cockHi, 0.9);

  // MOTION WORKS (dial side)
  const cannon = part('cannon', 'Cannon pinion', 'motion', L.C, { label: 'Cannon pinion', labelZ: Z.cannon - 0.6 });
  add(cannon, slab(M.pinionProfile(c.cannon.N, c.cannon.m), [], Z.cannon - 0.15, Z.cannon + 0.15, MAT.steel, 'cannon', 0.01),
    cyl(0.48, Z.dialLo - 0.62, Z.cannon, MAT.steel, 'cannon'));
  const mw = part('minuteWheel', 'Minute wheel', 'motion', L.M, { label: 'Minute wheel', labelZ: Z.minute - 0.6 });
  add(mw, slab(M.wheelProfile(c.minute.N, c.minute.m), M.spokeWindows(0.6, M.pitchR(c.minute.m, c.minute.N) - 1.6 * c.minute.m - 0.32, 4, 0.36).map(w => w.reverse()), Z.minute - 0.12, Z.minute + 0.12, MAT.brass, 'minuteWheel', 0.015),
    slab(M.pinionProfile(c.minute.p, c.minute.pm), [], Z.hour - 0.17, Z.minute - 0.1, MAT.steel, 'minuteWheel', 0.01),
    cyl(0.18, Z.hour - 0.3, -c.plateT, MAT.steel, 'minuteWheel'));
  const hw = part('hourWheel', 'Hour wheel', 'motion', L.C, { label: 'Hour wheel', labelZ: Z.hour - 0.8 });
  add(hw, slab(M.wheelProfile(c.hour.N, c.hour.m), M.spokeWindows(1.15, M.pitchR(c.hour.m, c.hour.N) - 1.6 * c.hour.m - 0.3, 4, 0.4).map(w => w.reverse()), Z.hour - 0.12, Z.hour + 0.12, MAT.brass, 'hourWheel', 0.015),
    ring(0.52, 0.85, Z.dialLo - 0.35, Z.hour, MAT.brass, 'hourWheel'));

  // DIAL
  MAT.dial = new THREE.MeshPhysicalMaterial({ map: dialTexture(), roughness: 0.4, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 });
  const dial = part('dial', 'Dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
  const dialHoles = [circ(1.0, 24).reverse(), circ(0.45, 16, L.F).reverse()];
  add(dial, slab(circ(18.6, 180), dialHoles, Z.dialLo + 0.01, Z.dialHi, MAT.brass, 'dial', 0.05));
  // the enamel face: one shape turned to face -z, so the art reads unmirrored
  const face = new THREE.ShapeGeometry(shapeOf(circ(18.3, 180), dialHoles.map(h => h.map(([x, y]) => [-x, y]))), 8);
  face.rotateY(Math.PI); face.translate(0, 0, Z.dialLo);
  const faceMesh = mesh(face, MAT.dial, 'dial'); faceMesh.castShadow = false;
  add(dial, faceMesh);
  add(dial, ring(18.25, 18.6, Z.dialLo - 0.02, Z.dialHi, MAT.gilt, 'dial'));

  // HANDS (Breguet style, blued steel); built pointing to 12 (+y)
  const breguet = (len, pomme, w) => {
    const bar = [[-w * 0.6, -len * 0.18], [w * 0.6, -len * 0.18], [w * 0.5, pomme - 0.9], [-w * 0.5, pomme - 0.9]];
    const tipP = [[-w * 0.45, pomme + 0.5], [w * 0.45, pomme + 0.5], [0, len]];
    return { bar, tipP, ring: [circ(0.95, 36, [0, pomme]), circ(0.62, 36, [0, pomme]).reverse()] };
  };
  const handPart = (id, name, at, z, shape, hubR) => {
    const p = part(id, name, 'hands', at, { label: null });
    add(p, slab(shape.bar, [], z, z + 0.09, MAT.blued, id, 0.01), slab(shape.tipP, [], z, z + 0.09, MAT.blued, id, 0.01),
      slab(shape.ring[0], [shape.ring[1]], z, z + 0.09, MAT.blued, id, 0.01), cyl(hubR, z - 0.05, z + 0.12, MAT.blued, id));
    return p;
  };
  handPart('hourHand', 'Hour hand', [0, 0], Z.dialLo - 0.35, breguet(9.6, 7.0, 0.42), 1.0);
  handPart('minuteHand', 'Minute hand', [0, 0], Z.dialLo - 0.6, breguet(14.6, 11.5, 0.32), 0.72);
  const sec = part('secondHand', 'Seconds hand', 'hands', L.F, { label: null });
  add(sec, slab([[-0.09, -1.1], [0.09, -1.1], [0.05, 3.7], [-0.05, 3.7]], [], Z.dialLo - 0.3, Z.dialLo - 0.22, MAT.blued, 'secondHand', 0),
    cyl(0.36, Z.dialLo - 0.34, Z.dialLo - 0.18, MAT.blued, 'secondHand'));
}
buildMovement();

// ── springs: positions from the state ─────────────────────────────────────
function poseSprings(p) {
  // mainspring: wound, the coils hug the arbor; run down, they lie on the wall
  const w = Math.max(0, Math.min(1, p.reserve / CAL.reserveTurns));
  const ra = 4.1 + (1.45 - 4.1) * w, rb = 6.75 + (3.7 - 6.75) * w, turns = 7 + 6 * w;
  const arb = p.ratchet, drum = p.barrel;
  dyn.mainspring.userData.update(s => {
    let r;
    if (s < 0.03) r = 1.18 + (ra - 1.18) * (s / 0.03);
    else if (s > 0.97) r = rb + (6.92 - rb) * ((s - 0.97) / 0.03);
    else r = ra + (rb - ra) * ((s - 0.03) / 0.94);
    const a = arb * (1 - s) + drum * s + turns * TAU * s;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  // hairspring: the inner end turns with the balance, the outer end is held
  const N = 13, r0 = 0.62, r1 = 3.75, th0 = 60 * D - N * TAU;
  dyn.hairspring.userData.update(s => {
    const r = r0 + (r1 - r0) * s, a = th0 + N * TAU * s + p.balance * (1 - s);
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

// ── per-frame pose ────────────────────────────────────────────────────────
const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', center: 'center', third: 'third', fourth: 'fourth', escape: 'escape', pallet: 'fork', balance: 'balance', ratchet: 'ratchet', crownWheel: 'crown', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
let lastRatchet = null, clickRock = 0;
function poseScene(p, e) {
  for (const id in ROT) parts[id].root.rotation.z = p[ROT[id]];
  parts.hourHand.root.rotation.z = p.hands.hour;
  parts.minuteHand.root.rotation.z = p.hands.minute;
  parts.secondHand.root.rotation.z = p.hands.second;
  parts.stem.spin.rotation.y = p.stem;
  // the click rides over each ratchet tooth while the crown winds
  if (lastRatchet !== null && p.ratchet !== lastRatchet) clickRock = 1;
  lastRatchet = p.ratchet;
  const tooth = ((-p.ratchet / (TAU / CAL.ratchet.N)) % 1 + 1) % 1;
  parts.click.root.rotation.z = clickRock * 0.09 * (1 - tooth);
  clickRock *= 0.9;
  for (const k in layers) layers[k].position.z = e * EXPLODE_MM * LAYER_K[k];
  for (const id in parts) {
    const q = parts[id];
    q.holder.position.z = e * EXPLODE_MM * q.lift;
    if (q.slide) q.holder.position.y = e * q.slide;
  }
  poseSprings(p);
}

// ── labels ────────────────────────────────────────────────────────────────
const labelEls = [];
for (const id in parts) {
  const q = parts[id]; if (!q.label) continue;
  const el = document.createElement('div'); el.className = 'lb'; el.innerHTML = `<i></i>${q.label}`;
  $('labels').appendChild(el);
  labelEls.push({ q, el });
}
const tmp = new THREE.Vector3();
// a label sits at the part's outer edge toward the camera's right
function placeLabels(w, h) {
  const on = S.showLabels && S.explode > 0.2;
  const opacity = on ? Math.min(1, (S.explode - 0.2) * 4) : 0;
  for (const { q, el } of labelEls) {
    const hidden = !q.holder.parent.visible || !q.root.visible;
    if (!on || hidden) { el.style.opacity = 0; continue; }
    const at = q.labelAt || q.at;
    q.holder.localToWorld(tmp.set(at[0], at[1], q.labelZ)).project(camera);
    if (tmp.z > 1) { el.style.opacity = 0; continue; }
    el.style.opacity = opacity;
    el.style.transform = `translate(${((tmp.x + 1) / 2 * w).toFixed(1)}px,${((1 - tmp.y) / 2 * h).toFixed(1)}px) translate(-50%,-50%)`;
  }
}

// ── part card ─────────────────────────────────────────────────────────────
const PER = M.periods();
const fmtP = s => s >= 3600 ? `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} h` : s >= 60 ? `${(s / 60).toFixed(s % 60 ? 1 : 0)} min` : `${s} s`;
const INFO = {
  plate: ['Main plate', 'Ø 36.6 mm · perlage finish', 'The base of the movement. Every arbor turns between a jewel in the plate and a jewel in a bridge above it. The spotted perlage finish is decoration.'],
  jewel: ['Jewel bearing', 'synthetic ruby', 'Each pivot turns in a hole in a ruby. Ruby is hard and smooth, so the steel pivots wear slowly and need little oil.'],
  barrel: ['Barrel', `80 teeth · module 0.19 · 1 turn in ${fmtP(PER.barrel)}`, 'A drum that holds the mainspring. The spring turns the drum, and the teeth on its rim drive the centre pinion. This is the slowest wheel of the going train.'],
  mainspring: ['Mainspring', `about ${(CAL.reserveTurns * 8).toFixed(0)} h of power`, 'A long steel ribbon coiled round the barrel arbor. Wound, its coils wrap the arbor; as it runs down, they open out against the barrel wall.'],
  center: ['Centre wheel', `80 teeth · pinion 10 · 1 turn per hour`, 'It sits at the centre of the movement. Its arbor comes through the dial and carries the cannon pinion and the minute hand.'],
  third: ['Third wheel', `75 teeth · pinion 10 · 1 turn in ${fmtP(PER.third)}`, 'The middle stage of the train. Its pinion takes power from the centre wheel and its wheel drives the fourth pinion.'],
  fourth: ['Fourth wheel', `80 teeth · pinion 10 · 1 turn per minute`, 'Its arbor carries the small seconds hand at 6 o\'clock. 80/10 × 75/10 = 60, so it turns 60 times for each turn of the centre wheel.'],
  escape: ['Escape wheel', `15 club teeth · pinion 8 · 1 turn in ${PER.escape} s`, 'The last wheel of the train. The pallet stones let it go one half tooth per beat: 30 beats per turn, 5 beats per second.'],
  pallet: ['Pallet lever', `±${(CAL.forkBank / D).toFixed(0)}° between the banking pins`, 'The Swiss lever. Its two ruby stones lock and release the escape wheel, and its fork takes and gives the impulse at the balance roller jewel.'],
  balance: ['Balance wheel', `Ø ${(CAL.balR * 2).toFixed(0)} mm · 2.5 Hz · 18,000 beats per hour`, 'The regulator of the watch. With the hairspring it swings at a fixed rate. The screws on its rim set its inertia, and so its rate.'],
  hairspring: ['Hairspring', '13 coils', 'A fine flat spiral. The inner end turns with the balance, the outer end is held in the stud on the cock. It is the spring of the oscillator.'],
  barrelBridge: ['Barrel bridge', 'Geneva stripes', 'It holds the upper pivots of the barrel arbor and the centre wheel. The ratchet and the crown wheel sit on top of it.'],
  trainBridge: ['Train bridge', 'Geneva stripes', 'It holds the upper pivots of the third, fourth and escape wheels in jewels set in gold chatons.'],
  palletCock: ['Pallet cock', '', 'A small bridge for the upper pivot of the pallet lever.'],
  cock: ['Balance cock', 'with regulator index', 'A bridge with one foot, so the balance can be seen and adjusted. The index moves the regulator to make the watch run faster or slower.'],
  ratchet: ['Ratchet wheel', '50 teeth', 'It sits square on the barrel arbor. When the crown winds, the ratchet turns the arbor and winds the spring.'],
  crownWheel: ['Crown wheel', '24 teeth', 'It takes the turn of the winding pinion on the stem and gives it to the ratchet wheel.'],
  click: ['Click', '', 'A pawl on a spring. It lets the ratchet turn one way only, so the mainspring cannot unwind back through the crown.'],
  stem: ['Stem and crown', 'winding pinion 16', 'Turn the crown and the stem turns the winding pinion, the crown wheel, the ratchet and the barrel arbor.'],
  screws: ['Screws', 'blued steel', 'Heat-blued steel screws hold the bridges to the plate.'],
  cannon: ['Cannon pinion', '12 leaves · 1 turn per hour', 'A friction fit on the centre arbor carries the minute hand. It drives the minute wheel.'],
  minuteWheel: ['Minute wheel', '36 teeth · pinion 10', 'It turns once in 3 hours. Its pinion drives the hour wheel.'],
  hourWheel: ['Hour wheel', '40 teeth · 1 turn in 12 h', 'A tube round the cannon pinion that carries the hour hand: 36/12 × 40/10 = 12.'],
  dial: ['Dial', 'enamel', 'Small seconds at 6, Roman numerals and a railway minute track.'],
  hourHand: ['Hour hand', 'Breguet style', 'On the hour wheel. One turn in 12 hours.'],
  minuteHand: ['Minute hand', 'Breguet style', 'On the cannon pinion. One turn per hour.'],
  secondHand: ['Seconds hand', '', 'On the fourth wheel arbor. It moves in five small steps each second, one per beat.'],
};
const ALIAS = { barrelCover: 'barrel', barrelArbor: 'mainspring', cockScrew: 'screws', clickSpring: 'click' };
const hlCache = new Map();
function hlMat(m) {
  if (!hlCache.has(m)) { const h = m.clone(); h.emissive = new THREE.Color(0xffc870); h.emissiveIntensity = 0.28; hlCache.set(m, h); }
  return hlCache.get(m);
}
function select(id) {
  id = ALIAS[id] || id;
  S.sel = id;
  for (const m of pickables) m.material = (id && (ALIAS[m.userData.part] || m.userData.part) === id) ? hlMat(m.userData.base) : m.userData.base;
  const info = INFO[id];
  $('card').hidden = !info;
  if (info) { $('cardName').textContent = info[0]; $('cardSpec').textContent = info[1]; $('cardText').textContent = info[2]; }
  document.querySelectorAll('#train tr[data-part]').forEach(tr => tr.classList.toggle('sel', tr.dataset.part === id));
}
$('cardClose').addEventListener('click', () => select(null));

// tap to pick (a short tap, not the end of an orbit drag)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; hideHint(); });
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 6 || dt > 500) return;
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickables.filter(m => m.visible && m.parent && visibleUp(m)), false)[0];
  select(hit ? hit.object.userData.part : null);
});
const visibleUp = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };

// ── train table ───────────────────────────────────────────────────────────
function buildTable() {
  const c = CAL, rows = [
    ['barrel', 'Barrel', c.barrel.N, '—', PER.barrel],
    ['center', 'Centre', c.center.N, c.center.p, PER.center],
    ['third', 'Third', c.third.N, c.third.p, PER.third],
    ['fourth', 'Fourth', c.fourth.N, c.fourth.p, PER.fourth],
    ['escape', 'Escape', c.escape.N, c.escape.p, PER.escape],
    ['balance', 'Balance', '—', '—', PER.balance],
  ];
  $('train').innerHTML = '<tr><th>wheel</th><th>teeth</th><th>pinion</th><th>1 turn</th></tr>' +
    rows.map(r => `<tr data-part="${r[0]}"><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[0] === 'balance' ? '2.5 Hz' : fmtP(r[4])}</td></tr>`).join('');
  $('train').querySelectorAll('tr[data-part]').forEach(tr => tr.addEventListener('click', () => select(tr.dataset.part)));
}
buildTable();

// ── views ─────────────────────────────────────────────────────────────────
const mid = [(L.E[0] + L.P[0]) / 2, (L.E[1] + L.P[1]) / 2];
const VIEWS = {
  caseback: { pos: [10, -44, 64], target: [0, 0, 1.5], explode: 0, bridges: true },
  dial: { pos: [6, 30, -70], target: [0, 0, -2], explode: 0, dial: true },
  exploded: { pos: [86, -82, 52], target: [0, 0, 3], explode: 0.9, bridges: true, dial: true },
  escapement: { pos: [mid[0] + 12, mid[1] - 15, 19], target: [mid[0] + 0.6, mid[1] + 0.6, 1.3], explode: 0, bridges: false, rate: 0.05 },
};
let fly = null;
function setView(name) {
  const v = VIEWS[name]; if (!v) return;
  fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.pos), t1: new THREE.Vector3(...v.target) };
  setExplode(v.explode);
  if (v.bridges !== undefined) setShow('bridges', v.bridges);
  if (v.dial !== undefined) setShow('dial', v.dial);
  if (v.rate !== undefined) setRate(v.rate);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ──────────────────────────────────────────────────────────────
function setExplode(x) {
  S.explodeTarget = x;
  $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%';
  $('dockExplode').classList.toggle('on', x > 0.3);
}
$('explode').addEventListener('input', e => setExplode(+e.target.value));
$('assemble').addEventListener('click', () => setExplode(0));
$('burst').addEventListener('click', () => setExplode(0.9));
$('dockExplode').addEventListener('click', () => setExplode(S.explodeTarget > 0.3 ? 0 : 0.85));

function setRate(r) {
  if (r > 0) S.lastRate = r;
  S.rate = r;
  document.querySelectorAll('#rates button, #dockRates button').forEach(b => b.classList.toggle('on', +b.dataset.rate === r));
  $('dockPlay').textContent = r ? '❚❚' : '▶'; $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
  $('rateNote').textContent = r === 0 ? 'Paused. Winding still works.'
    : r < 1 ? 'Slow motion. Watch the lever unlock a tooth, the impulse along the stone, the drop, and the lock on the other stone.'
    : r === 1 ? 'Real time: 5 beats a second. The seconds hand moves in five small steps.'
    : 'Fast. The balance now swings faster than the screen can draw, so it looks still or jumps (aliasing). The wheel train stays exact.';
}
document.querySelectorAll('#rates button, #dockRates button').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rate)));
$('dockPlay').addEventListener('click', () => setRate(S.rate ? 0 : S.lastRate));

function setShow(what, on) {
  if (what === 'dial') { S.showDial = on; layers.dial.visible = layers.hands.visible = on; $('tDial').classList.toggle('on', on); }
  if (what === 'bridges') {
    S.showBridges = on; layers.cock.visible = on;
    for (const id of ['barrelBridge', 'trainBridge', 'palletCock', 'screws', 'ratchet', 'crownWheel', 'click', 'clickSpring']) parts[id].holder.visible = on;
    $('tBridges').classList.toggle('on', on);
  }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
}
$('tDial').addEventListener('click', () => setShow('dial', !S.showDial));
$('tBridges').addEventListener('click', () => setShow('bridges', !S.showBridges));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));

const windBtn = $('wind');
const windOn = e => { e.preventDefault(); S.winding = true; windBtn.classList.add('on'); try { windBtn.setPointerCapture(e.pointerId); } catch (x) {} };
const windOff = () => { S.winding = false; windBtn.classList.remove('on'); };
windBtn.addEventListener('pointerdown', windOn);
windBtn.addEventListener('pointerup', windOff);
windBtn.addEventListener('pointercancel', windOff);
windBtn.addEventListener('lostpointercapture', windOff);
windBtn.addEventListener('contextmenu', e => e.preventDefault());

// panel, sheet and dock (the wave-membrane pattern)
const panel = $('panel'), dockPanel = $('dockPanel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  dockPanel.classList.toggle('on', open); dockPanel.setAttribute('aria-expanded', String(open));
}
$('gear').addEventListener('click', () => setOpen(true));
dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
$('panelClose').addEventListener('click', () => setOpen(false));
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
});
grip.addEventListener('pointercancel', () => { gripY = null; });
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
setTimeout(hideHint, 9000);

// ── framing: shift the view into the area the panel and dock leave clear ───
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect();
  for (const el of [panel]) {
    const q = el.getBoundingClientRect();
    const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) o.b = Math.max(o.b, cr.bottom - y0); else o.t = Math.max(o.t, y1 - cr.top); }
    else { if (x0 + x1 < cr.left * 2 + w) o.l = Math.max(o.l, x1 - cr.left); else o.r = Math.max(o.r, cr.right - x0); }
  }
  return o;
}
const occ = { l: 0, r: 0, t: 0, b: 0 };
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // a tall screen sees less width: widen the view so the movement fits
  camera.zoom = Math.min(1, Math.max(0.72, camera.aspect / 1.3));
  const o = occlusion(w, h);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.25;
  camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
  camera.updateProjectionMatrix();
}

// ── readout ───────────────────────────────────────────────────────────────
function fmtClock(sec) {
  sec = ((sec % 43200) + 43200) % 43200;
  const h = Math.floor(sec / 3600) || 12, m = Math.floor(sec / 60) % 60, s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
let readTick = 0;
function readout(p) {
  if (++readTick % 4) return;
  const res = Math.max(0, p.reserve), hrs = res * PER.barrel / 3600;
  const amp = S.watch.amp / D;
  $('read').innerHTML = `<span class="hi">${fmtClock(p.seconds)}</span> <span class="lo">· beat</span> ${p.beats.toLocaleString()}<br>` +
    (S.watch.stopped ? '<span class="bad">stopped · wind the crown</span>' : `<span class="lo">amplitude</span> ${amp.toFixed(0)}° <span class="lo">· ×</span>${S.rate}`);
  $('resBar').style.width = (res / CAL.reserveTurns * 100).toFixed(1) + '%';
  $('resV').textContent = `${hrs.toFixed(1)} h`;
}

// ── loop ──────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // winding: about 1/3 ratchet turn per second while the button is held
  const wind = S.winding ? -dt * 2.1 : 0;
  M.step(S.watch, dt * S.rate, wind);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * 3.2);
  if (Math.abs(S.explodeTarget - S.explode) < 1e-4) S.explode = S.explodeTarget;
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 1.1);
    const k = fly.t * fly.t * (3 - 2 * fly.t);
    camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
    if (fly.t >= 1) fly = null;
  }
  controls.update();
  const p = M.pose(S.watch);
  poseScene(p, S.explode);
  resize();
  renderer.render(scene, camera);
  placeLabels(canvas.clientWidth, canvas.clientHeight);
  readout(p);
}
controls.addEventListener('start', () => { fly = null; hideHint(); });

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
});

// debug and headless checks
window.__watch = { S, M, parts, setView, setRate, setExplode, select, camera, controls };

setRate(1);
setExplode(0);
camera.position.set(70, -66, 70);
controls.target.set(0, 0, 2);
setTimeout(() => setExplode(0.6), 500);
requestAnimationFrame(frame);
