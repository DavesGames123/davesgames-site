// ============================================================================
//  POOL PHYSICS  ·  view/scene3d.js — the 3D table (three.js r160)
// ----------------------------------------------------------------------------
//  The same table as core/table.js, in metres: the green cloth with the six
//  pocket holes, the cushions cut at the jaw angles, mahogany rails with
//  pearl diamonds, leather pockets, the apron and legs on a dark floor, a
//  three-shade lamp over the table (three spot lights with soft shadows),
//  the numbered balls and the cue. Overlays: the aim line, the ghost ball
//  and the velocity / acceleration arrows.
//  Axes: table (x, y, z up) -> three (X = x, Y = z, Z = -y). A ball
//  orientation (w, x, y, z) of core/physics.js -> three (w, x, z, -y).
//
//  createScene(canvas, T, { phone }) -> V or null (no WebGL)
//    V.resize(w, h, dpr)   V.render()   V.pick(px, py) -> { x, y } or null
//    V.setBalls(list)      list: [{ n, x, y, q, on, drop: { p, hx, hy } }]
//    V.setCue({ x, y, phi, a, b, back, alpha })   or null
//    V.setOverlay({ aim, ghost, arrows: [{ from, vec, m }] })
//    V.camMode(mode) 'auto' | 'broadcast' | 'behind' | 'overhead' | 'free'
//    V.focus({ phase, cx, cy, phi })   where the auto camera looks
//    V.update(dt)          the camera spring
//    V.onUserOrbit         set by main: the user moved the camera
//
//  grep -n targets: "function ballTexture", "function clothTexture",
//  "function buildTable", "function buildLamp", "function buildCue",
//  "function camTarget", "export function createScene"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { diamonds, ballColor, isStripe, cushionPolys } from '../core/table.js';

const TEX = new URL('../tex/', import.meta.url).href;
export const BED_Y = 0;            // the cloth (three Y)
const CUSH_H = 0.042, RAIL_TOP = 0.048, APRON = 0.2;

const canvas2d = (w, h) => {
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext && c.getContext('2d');
    return g ? { c, g } : null;
  } catch (e) { return null; }
};

// An equirectangular ball decal: the colour, the stripe band, two number
// circles on the equator (as printed on a real set).
function ballTexture(n) {
  const k = canvas2d(512, 256);
  if (!k) return null;
  const { c, g } = k, col = ballColor(n);
  g.fillStyle = isStripe(n) ? '#f2efe6' : col; g.fillRect(0, 0, 512, 256);
  if (isStripe(n)) { g.fillStyle = col; g.fillRect(0, 128 - 52, 512, 104); }
  if (n > 0) {
    for (const u of [128, 384]) {
      g.fillStyle = '#f7f4ea'; g.beginPath(); g.arc(u, 128, 30, 0, 2 * Math.PI); g.fill();
      g.fillStyle = '#111'; g.font = `bold ${n > 9 ? 30 : 36}px Inter, Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), u, 130);
      if (n === 6 || n === 9) { g.fillRect(u - 9, 152, 18, 3); }
    }
  } else {
    // the cue ball: a few small red dots (a "measles" pattern) show the spin
    g.fillStyle = '#c0392b';
    for (const [u, v] of [[64, 128], [192, 128], [320, 128], [448, 128], [128, 40], [384, 216], [0, 0]]) { g.beginPath(); g.arc(u, v, 6, 0, 2 * Math.PI); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Fine cloth: a mid green with fibre noise (worsted wool, like a pro cloth).
function clothTexture(rng) {
  const k = canvas2d(256, 256);
  if (!k) return null;
  const { c, g } = k, img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const n = (rng() - 0.5) * 18 + (rng() - 0.5) * 8;
    img.data[4 * i] = 18 + n * 0.4; img.data[4 * i + 1] = 108 + n; img.data[4 * i + 2] = 68 + n * 0.6; img.data[4 * i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 12);
  return t;
}

function leatherTexture(rng) {
  const k = canvas2d(128, 128);
  if (!k) return null;
  const { c, g } = k, img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const n = (rng() - 0.5) * 22; img.data[4 * i] = 34 + n; img.data[4 * i + 1] = 24 + n * 0.8; img.data[4 * i + 2] = 20 + n * 0.6; img.data[4 * i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rngOf(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// table (x, y) polygon -> a THREE.Shape in the same plane
const shapeOf = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; };
// extrude a plan shape up from y0 by h (three Y)
function slab(shape, y0, h, mat, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 24 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function buildTable(T, mats, phone) {
  const grp = new THREE.Group(), cw = T.spec.cushionW, rw = T.spec.railW;
  const ix = T.hx + cw, iy = T.hy + cw, ox = ix + rw, oy = iy + rw;
  // the bed: the cloth to the cushion backs, with the pocket holes
  const bed = shapeOf([[-ix, -iy], [ix, -iy], [ix, iy], [-ix, iy]]);
  for (const p of T.pockets) { const h = new THREE.Path(); h.absarc(p.hx, p.hy, p.r, 0, 2 * Math.PI, true); bed.holes.push(h); }
  const bg = new THREE.ShapeGeometry(bed, 32); bg.rotateX(-Math.PI / 2);
  const bedMesh = new THREE.Mesh(bg, mats.cloth); bedMesh.receiveShadow = true; grp.add(bedMesh);
  // a slate edge under the cloth
  grp.add(slab(shapeOf([[-ix, -iy], [ix, -iy], [ix, iy], [-ix, iy]]), -0.03, 0.0295, mats.slate));
  // cushions
  for (const q of cushionPolys(T)) grp.add(slab(shapeOf(q), 0, CUSH_H, mats.cushion));
  // the rail top: the outer outline with the inner line notched at the pockets
  const inner = [], step = 0.004, cut = p => (p.kind === 'corner' ? p.r + 0.012 : p.r + 0.006);
  const perim = [[-ix, -iy], [ix, -iy], [ix, iy], [-ix, iy], [-ix, -iy]];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = perim[k], [bx, by] = perim[k + 1], L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / step);
    for (let i = 0; i < n; i++) {
      let x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
      for (const p of T.pockets) { const dx = x - p.hx, dy = y - p.hy, d = Math.hypot(dx, dy), r = cut(p); if (d < r) { x = p.hx + dx / (d || 1) * r; y = p.hy + dy / (d || 1) * r; } }
      inner.push([x, y]);
    }
  }
  const rail = new THREE.Shape(); const rr = 0.03;
  rail.moveTo(-ox + rr, -oy); rail.lineTo(ox - rr, -oy); rail.quadraticCurveTo(ox, -oy, ox, -oy + rr); rail.lineTo(ox, oy - rr); rail.quadraticCurveTo(ox, oy, ox - rr, oy);
  rail.lineTo(-ox + rr, oy); rail.quadraticCurveTo(-ox, oy, -ox, oy - rr); rail.lineTo(-ox, -oy + rr); rail.quadraticCurveTo(-ox, -oy, -ox + rr, -oy);
  rail.holes.push(shapeOf(inner.slice().reverse()));
  grp.add(slab(rail, CUSH_H - 0.004, RAIL_TOP - CUSH_H + 0.004, mats.wood, 0.004));
  // the apron (a frame down from the rail) and six legs
  const ap = shapeOf([[-ox, -oy], [ox, -oy], [ox, oy], [-ox, oy]]);
  ap.holes.push(shapeOf([[-ox + 0.05, -oy + 0.05], [-ox + 0.05, oy - 0.05], [ox - 0.05, oy - 0.05], [ox - 0.05, -oy + 0.05]]));
  grp.add(slab(ap, -APRON, APRON + CUSH_H - 0.006, mats.wood));
  const floorY = -T.spec.bedH;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, -floorY - APRON, 0.13), mats.wood);
    leg.position.set(x * (ox - 0.12), floorY + (-floorY - APRON) / 2, z * (oy - 0.12));
    leg.castShadow = !phone; leg.receiveShadow = true; grp.add(leg);
  }
  // pockets: a leather cup under each hole and a leather rim on the rail
  for (const p of T.pockets) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.9, 0.16, 32, 1, true), mats.leatherIn);
    cup.position.set(p.hx, -0.08, -p.hy); grp.add(cup);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.9, 32), mats.leatherIn);
    bottom.rotation.x = -Math.PI / 2; bottom.position.set(p.hx, -0.16, -p.hy); grp.add(bottom);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(cut(p) + 0.004, 0.009, 10, 40, Math.PI * (p.kind === 'corner' ? 1.5 : 1)), mats.leather);
    rim.rotation.x = -Math.PI / 2;
    // open toward the table
    rim.rotation.z = p.kind === 'corner' ? Math.atan2(p.sy, p.sx) - Math.PI * 0.75 : (p.sy > 0 ? 0 : Math.PI);
    rim.position.set(p.hx, RAIL_TOP - 0.004, -p.hy); rim.castShadow = true; grp.add(rim);
  }
  // diamonds
  const dg = new THREE.OctahedronGeometry(0.009, 0); dg.scale(1, 0.18, 0.62);
  for (const q of diamonds(T)) {
    const d = new THREE.Mesh(dg, mats.pearl);
    d.position.set(q.x, RAIL_TOP + 0.0012, -q.y);
    if (q.side === 'short') d.rotation.y = Math.PI / 2;
    grp.add(d);
  }
  // the floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), mats.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; floor.receiveShadow = true; grp.add(floor);
  return grp;
}

// A three-shade billiard lamp: a dark metal bar, three cone shades with warm
// emissive bulbs, a spot light under each.
function buildLamp(scene, phone) {
  const grp = new THREE.Group(), body = new THREE.Group(), y = 1.0;
  grp.add(body);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d2a22, metalness: 0.6, roughness: 0.45 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.05), metal); bar.position.set(0, y + 0.16, 0); body.add(bar);
  const lights = [];
  [-0.55, 0, 0.55].forEach((x, k) => {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.19, 0.16, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x14402c, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }));
    shade.position.set(x, y + 0.07, 0); body.add(shade);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
    bulb.rotation.x = Math.PI / 2; bulb.position.set(x, y + 0.005, 0); body.add(bulb);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12), metal); rod.position.set(x, y + 0.2, 0); body.add(rod);
    const L = new THREE.SpotLight(0xfff0dc, phone ? 26 : 22, 4, 1.05, 0.75, 1.4);
    L.position.set(x, y - 0.01, 0); L.target.position.set(x * 1.15, 0, 0);
    const shadow = !phone || k === 1;
    L.castShadow = shadow;
    if (shadow) { L.shadow.mapSize.set(phone ? 1024 : 1536, phone ? 1024 : 1536); L.shadow.bias = -0.00015; L.shadow.normalBias = 0.002; L.shadow.radius = 4; L.shadow.camera.near = 0.3; L.shadow.camera.far = 3; }
    grp.add(L, L.target); lights.push(L);
  });
  scene.add(grp);
  return { lights, body };
}

// The cue: tip, ferrule, maple shaft, ebony butt with a ring and a bumper.
// Built along +x from the tip at x = 0. 147 cm long.
function buildCue(mats) {
  const grp = new THREE.Group();
  const part = (r0, r1, len, x0, mat) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 24); g.rotateZ(-Math.PI / 2); g.translate(x0 + len / 2, 0, 0);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; grp.add(m); return m;
  };
  part(0.0063, 0.0064, 0.008, 0, mats.tip);
  part(0.0064, 0.0065, 0.022, 0.008, mats.ferrule);
  part(0.0065, 0.0105, 0.72, 0.03, mats.maple);
  part(0.0105, 0.011, 0.02, 0.75, mats.ferrule);
  part(0.011, 0.0145, 0.70, 0.77, mats.ebony);
  part(0.0145, 0.0146, 0.01, 1.47, mats.tip);
  return grp;
}

export function createScene(canvas, T, { phone = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, powerPreference: 'high-performance' });
  } catch (e) { return null; }
  if (!renderer.getContext()) return null;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090b);
  scene.fog = new THREE.Fog(0x07090b, 5, 11);
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.05, 30);
  camera.position.set(0, 2.1, 2.3);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.5; controls.maxDistance = 6.5; controls.maxPolarAngle = 1.42;
  controls.target.set(0, 0, 0);

  const rng = rngOf(7), loader = new THREE.TextureLoader();
  const tex = (f, srgb = true, rep = [1, 1]) => {
    try {
      const t = loader.load(TEX + f);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4;
      return t;
    } catch (e) { return null; }
  };
  const wood = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tex('mahogany-color.jpg', true, [1.6, 1.6]), normalMap: tex('mahogany-normal.jpg', false, [1.6, 1.6]), roughnessMap: tex('mahogany-rough.jpg', false, [1.6, 1.6]), roughness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  const clothMap = clothTexture(rng);
  const mats = {
    wood,
    cloth: new THREE.MeshPhysicalMaterial({ color: clothMap ? 0xffffff : 0x146b43, map: clothMap, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x3fa070) }),
    cushion: new THREE.MeshPhysicalMaterial({ color: clothMap ? 0xe8f2ea : 0x136640, map: clothMap, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x3fa070) }),
    slate: new THREE.MeshStandardMaterial({ color: 0x2c2f31, roughness: 0.8 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x2a1e18, map: leatherTexture(rng), roughness: 0.55 }),
    leatherIn: new THREE.MeshStandardMaterial({ color: 0x0b0807, roughness: 0.9, side: THREE.DoubleSide }),
    pearl: new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.25, iridescence: 0.6, clearcoat: 1 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.85 }),
    tip: new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.9 }),
    ferrule: new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.35 }),
    maple: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex('maple-color.jpg', true, [6, 0.2]), roughness: 0.4 }),
    ebony: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex('ebony-color.jpg', true, [4, 0.2]), roughness: 0.35 }),
  };
  scene.add(buildTable(T, mats, phone));
  const { lights, body: lampBody } = buildLamp(scene, phone);
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x1a120c, 0.35));

  // balls
  const geo = new THREE.SphereGeometry(T.R, phone ? 32 : 48, phone ? 20 : 32);
  const balls = [], qBase = [];
  for (let n = 0; n < 16; n++) {
    // the decal number faces up at rest, each ball turned a little about the vertical
    qBase.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (n * 2.39996) % (2 * Math.PI), 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)));
    const map = ballTexture(n);
    const mat = new THREE.MeshPhysicalMaterial({ color: map ? 0xffffff : ballColor(n), map, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 });
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.visible = false;
    scene.add(m); balls.push(m);
  }
  const cue = buildCue(mats); cue.visible = false; scene.add(cue);

  // overlays
  const ovl = new THREE.Group(); scene.add(ovl);
  const aimMat = new THREE.LineDashedMaterial({ color: 0x62c4ff, dashSize: 0.025, gapSize: 0.018, transparent: true, opacity: 0.9 });
  const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const aimLine = new THREE.Line(aimGeo, aimMat); aimLine.visible = false; ovl.add(aimLine);
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(T.R, 24, 16), new THREE.MeshBasicMaterial({ color: 0x62c4ff, wireframe: true, transparent: true, opacity: 0.45 }));
  ghost.visible = false; ovl.add(ghost);
  const arrowPool = [];
  const colorOf = m => ({ m1: 0x62c4ff, m2: 0xff9a62, m3: 0x86dc7c, m4: 0xe889dc, m5: 0xffd666, m6: 0xa8a4ff })[m] || 0xffffff;
  function arrow(k) {
    if (arrowPool[k]) return arrowPool[k];
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.024, 12), shaft.material);
    g.add(shaft, head); g.userData = { shaft, head }; ovl.add(g); arrowPool[k] = g;
    return g;
  }
  const up = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

  const V = { renderer, scene, camera, controls, balls, lights, lamp: lampBody, mode: 'auto', onUserOrbit: null };
  let w = 1, h = 1;
  let lastSize = '';
  V.resize = (W, H, dpr) => {
    // the same size again would reset the drawing buffer (the saver calls it every frame)
    const key = `${Math.round(W)}x${Math.round(H)}@${dpr}`;
    if (key === lastSize) return;
    lastSize = key;
    w = Math.max(1, W); h = Math.max(1, H);
    renderer.setPixelRatio(Math.min(dpr || 1, phone ? 1.75 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  V.setBalls = list => {
    for (let n = 0; n < 16; n++) balls[n].visible = false;
    for (const b of list) {
      const m = balls[b.n];
      let x = b.x, y = b.y, Y = T.R;
      if (b.drop) { const p = b.drop.p; if (p >= 1) continue; x += (b.drop.hx - x) * Math.min(1, p * 1.6); y += (b.drop.hy - y) * Math.min(1, p * 1.6); Y = T.R - 0.16 * p * p; }
      m.visible = true;
      m.position.set(x, BED_Y + Y, -y);
      if (b.q) m.quaternion.set(b.q[1], b.q[3], -b.q[2], b.q[0]).multiply(qBase[b.n]); else m.quaternion.copy(qBase[b.n]);
    }
  };
  V.setCue = c => {
    if (!c) { cue.visible = false; return; }
    cue.visible = true;
    const d = new THREE.Vector3(Math.cos(c.phi), 0, -Math.sin(c.phi)), right = new THREE.Vector3(Math.sin(c.phi), 0, Math.cos(c.phi));
    const elev = 0.07;
    // tip point on the ball face, then back along the cue axis
    const face = new THREE.Vector3(c.x, BED_Y + T.R, -c.y).addScaledVector(right, -(c.a || 0) * T.R * 0.98).addScaledVector(up, (c.b || 0) * T.R * 0.98).addScaledVector(d, -Math.sqrt(Math.max(0, 1 - (c.a || 0) ** 2 - (c.b || 0) ** 2)) * T.R);
    const axis = d.clone().multiplyScalar(-Math.cos(elev)).addScaledVector(up, Math.sin(elev)).normalize();
    cue.position.copy(face).addScaledVector(axis, c.back || 0.02);
    tmpQ.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);
    cue.quaternion.copy(tmpQ);
    cue.traverse(o => { if (o.material) { o.material.transparent = (c.alpha ?? 1) < 1; o.material.opacity = c.alpha ?? 1; } });
  };
  V.setOverlay = o => {
    o = o || {};
    if (o.aim) {
      const [a, b] = o.aim, pos = aimGeo.attributes.position;
      pos.setXYZ(0, a[0], BED_Y + 0.0015, -a[1]); pos.setXYZ(1, b[0], BED_Y + 0.0015, -b[1]); pos.needsUpdate = true;
      aimLine.computeLineDistances(); aimLine.visible = true; aimMat.opacity = o.aimAlpha ?? 0.9;
    } else aimLine.visible = false;
    if (o.ghost) { ghost.visible = true; ghost.position.set(o.ghost[0], BED_Y + T.R, -o.ghost[1]); ghost.material.opacity = 0.45 * (o.ghostAlpha ?? 1); } else ghost.visible = false;
    const A = o.arrows || [];
    for (let k = 0; k < arrowPool.length; k++) if (arrowPool[k]) arrowPool[k].visible = false;
    A.forEach((r, k) => {
      const L = Math.hypot(r.vec[0], r.vec[1]);
      if (L < 0.01) return;
      const g = arrow(k), { shaft, head } = g.userData;
      shaft.material.color.setHex(colorOf(r.m));
      const len = Math.max(0.03, L);
      shaft.scale.set(1, len - 0.024, 1); shaft.position.set(0, (len - 0.024) / 2, 0); head.position.set(0, len - 0.012, 0);
      g.position.set(r.from[0], BED_Y + T.R * 2 + 0.004, -r.from[1]);
      tmpV.set(r.vec[0] / L, 0, -r.vec[1] / L); g.quaternion.setFromUnitVectors(up, tmpV);
      g.visible = true;
    });
  };
  // the camera: presets and the auto director
  let focus = { phase: 'idle', cx: 0, cy: 0, phi: 0 };
  V.focus = f => { focus = Object.assign(focus, f); };
  V.camMode = m => { V.mode = m; };
  let userOrbit = false;
  controls.addEventListener('start', () => { userOrbit = true; if (V.mode !== 'free') { V.mode = 'free'; if (V.onUserOrbit) V.onUserOrbit(); } });
  controls.addEventListener('end', () => { userOrbit = false; });
  function camTarget() {
    const asp = w / h, fov = camera.fov * Math.PI / 180;
    const fitX = (T.hx + 0.25) / Math.tan(Math.atan(Math.tan(fov / 2) * asp)), fitY = (T.hy + 0.25) / Math.tan(fov / 2);
    let mode = V.mode;
    if (mode === 'auto') mode = focus.phase === 'aim' || focus.phase === 'plan' ? 'behind' : 'broadcast';
    if (mode === 'behind') {
      const d = [Math.cos(focus.phi), Math.sin(focus.phi)];
      return { p: [focus.cx - d[0] * 1.05, 0.42, -(focus.cy - d[1] * 1.05)], t: [focus.cx + d[0] * 0.55, 0.0, -(focus.cy + d[1] * 0.55)] };
    }
    lampBody.visible = mode !== 'overhead';
    if (mode === 'overhead') { const dist = Math.max(fitX, fitY) * 1.02; return asp >= 1 ? { p: [0, dist, 0.001], t: [0, 0, 0] } : { p: [0.001, dist * 1.15, 0], t: [0, 0, 0], roll: true }; }
    if (asp < 0.9) {
      // a portrait pane: along the table from behind the head rail
      const dist = (T.hy + 0.3) / Math.tan(Math.atan(Math.tan(fov / 2) * asp)) * 1.05 + T.hx;
      return { p: [-dist * 0.82, dist * 0.62, 0], t: [0.1, 0, 0] };
    }
    const dist = Math.max(fitX, fitY * 1.4) * 1.02;
    return { p: [0, dist * 0.72, dist * 0.72], t: [0, -0.05, 0] };
  }
  V.snapCamera = () => { const c = camTarget(); camera.position.set(...c.p); controls.target.set(...c.t); camera.up.set(0, 1, 0); controls.update(); };
  V.update = dt => {
    if (V.mode !== 'free' && !userOrbit) {
      const c = camTarget(), k = 1 - Math.exp(-dt / 0.55);
      camera.position.x += (c.p[0] - camera.position.x) * k; camera.position.y += (c.p[1] - camera.position.y) * k; camera.position.z += (c.p[2] - camera.position.z) * k;
      controls.target.x += (c.t[0] - controls.target.x) * k; controls.target.y += (c.t[1] - controls.target.y) * k; controls.target.z += (c.t[2] - controls.target.z) * k;
    }
    controls.update();
  };
  V.render = () => renderer.render(scene, camera);
  // a tap on the cloth: the table point under the pointer
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BED_Y + T.R)), hit = new THREE.Vector3();
  V.pick = (px, py) => {
    ray.setFromCamera(new THREE.Vector2(px / w * 2 - 1, -(py / h) * 2 + 1), camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, y: -hit.z };
  };
  V.dispose = () => { renderer.dispose(); };
  return V;
}
