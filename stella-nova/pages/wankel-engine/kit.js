// ============================================================================
//  WANKEL ENGINE  ·  kit.js — materials, shape helpers, parts, explode
// ────────────────────────────────────────────────────────────────────────────
//  createBuild() returns a builder B for one engine. scene.js calls B.part
//  and B.mesh with the shape helpers below. main.js poses, explodes,
//  highlights, fades and disposes the parts through the same builder.
//  Units are mm. z is the shaft axis and points at the front of the engine.
//
//  PARTS. A part is a holder group (its explode offset) round a root group
//  (its pose). o.parent puts the holder inside another group or part root,
//  so a seal explodes in the frame of its rotor, and a part under a
//  mirrored rotor unit explodes mirrored.
//
//  EXPLODE. Each part moves by o.explode = [dx, dy, dz] (mm, in its parent
//  frame) inside its own window o.win = [e0, e1] of the explode value. The
//  windows put the parts in an order: a part leaves only after the parts in
//  its way have left (scene.js EXPLODE ORDER).
//
//  GREP MAP
//    const MAT_DEF ............. material templates by name
//    export function extrudeZ .. an outline with holes, extruded along z
//    export function lathe ..... a closed (r, z) profile turned round z
//    function createBuild ...... the builder
//      B.part / B.mesh ......... parts and their meshes
//      B.applyExplode .......... windowed offsets with an ease
//      B.setHighlight / B.setAlpha / B.dispose
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer:coarse)').matches;

// ── textures (procedural, made here) ───────────────────────────────────────
let TEX = null;
function canvasTex(n, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  draw(c.getContext('2d'), n);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4;
  return t;
}
function textures() {
  if (TEX) return TEX;
  let s = 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // cast aluminium: a fine speckle for the roughness of the housings
  const cast = canvasTex(256, (g, n) => {
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const v = 150 + (rnd() - 0.5) * 70; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, [0.02, 0.02]);
  // ground finish: fine lines for the shaft, the gears and the rotor faces
  const ground = canvasTex(256, (g, n) => {
    for (let y = 0; y < n; y++) { const v = 140 + 45 * Math.sin(y * 1.9) * Math.sin(y * 0.11) + (rnd() - 0.5) * 34; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, n, 1); }
  }, [0.03, 0.03]);
  TEX = { cast, ground };
  return TEX;
}

// ── materials ──────────────────────────────────────────────────────────────
const MAT_DEF = {
  alu: () => ({ color: 0xbfc5cf, metalness: 1, roughness: 0.48, roughnessMap: TEX.cast }),
  iron: () => ({ color: 0x9aa0aa, metalness: 0.75, roughness: 0.44, roughnessMap: TEX.ground }),
  rotor: () => ({ color: 0x9e9a94, metalness: 0.6, roughness: 0.46, roughnessMap: TEX.ground }),
  running: () => ({ color: 0xeef1f6, metalness: 1, roughness: 0.08, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  steel: () => ({ color: 0xdfe3ea, metalness: 1, roughness: 0.2, roughnessMap: TEX.ground }),
  gear: () => ({ color: 0xcfd4dc, metalness: 1, roughness: 0.26, roughnessMap: TEX.ground }),
  blued: () => ({ physical: true, color: 0x3a4c78, metalness: 1, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2 }),
  bronze: () => ({ color: 0xc28e55, metalness: 1, roughness: 0.3 }),
  carbon: () => ({ color: 0x2b2d33, metalness: 0.5, roughness: 0.36 }),
  seal: () => ({ color: 0x9aa3b4, metalness: 1, roughness: 0.22 }),
  ceramic: () => ({ color: 0xf0ece4, metalness: 0, roughness: 0.32 }),
  hex: () => ({ color: 0xd2d6dd, metalness: 1, roughness: 0.25 }),
  red: () => ({ physical: true, color: 0x8a2a24, metalness: 0.25, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  pipe: () => ({ color: 0x9a7a5a, metalness: 1, roughness: 0.4 }),
  dark: () => ({ color: 0x15171c, metalness: 0.4, roughness: 0.5 }),
  soot: () => ({ color: 0x3b3a3a, metalness: 0.6, roughness: 0.55 }),
};
function makeMat(name) {
  const def = { ...MAT_DEF[name]() };
  const physical = def.physical; delete def.physical;
  const m = physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);
  m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null;
  return m;
}

// ── shape helpers ──────────────────────────────────────────────────────────
const v2 = p => new THREE.Vector2(p[0], p[1]);
const area = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
const ccw = pts => area(pts) < 0 ? pts.slice().reverse() : pts;
export function circle(r, n = 64, c = [0, 0]) { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return out; }
// an outline with holes (lists of [x, y]) extruded from z0 to z1, with a
// small bevel on the outline edges
export function extrudeZ(outline, holes, z0, z1, bevel = 0.8) {
  const s = new THREE.Shape(ccw(outline).map(v2));
  for (const h of holes || []) s.holes.push(new THREE.Path(ccw(h).reverse().map(v2)));
  const b = Math.min(bevel, (z1 - z0) * 0.3);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, z1 - z0 - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, z0 + b);
  // smooth normals over the many side faces of a curved outline; corners
  // sharper than 35 degrees stay sharp. The caps keep their true normal.
  const sm = toCreasedNormals(g, 35 * Math.PI / 180);   // the same object when g has no index
  flattenCaps(sm);
  return sm;
}
// A cap triangle (face normal on +z or -z) gets its true normal back, so the
// bevel smoothing does not tilt the light across a flat face (watch kit.js).
function flattenCaps(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let t = 0; t < p.length; t += 9) {
    const ux = p[t + 3] - p[t], uy = p[t + 4] - p[t + 1], uz = p[t + 5] - p[t + 2];
    const vx = p[t + 6] - p[t], vy = p[t + 7] - p[t + 1], vz = p[t + 8] - p[t + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx, L = Math.hypot(fx, fy, fz);
    if (!L || Math.abs(fz) < L * 0.9999) continue;
    const s = Math.sign(fz);
    for (let k = 0; k < 9; k += 3) { n[t + k] = 0; n[t + k + 1] = 0; n[t + k + 2] = s; }
  }
  g.attributes.normal.needsUpdate = true;
}
// lathe(runs): a closed profile in (r, z), each run turned as its own
// smooth band so the corners between runs stay sharp. The axis is z.
export function lathe(runs, seg = 64) {
  const parts = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i].slice(), next = runs[(i + 1) % runs.length];
    run.push(next[0]);
    const g = new THREE.LatheGeometry(run.map(p => new THREE.Vector2(Math.max(1e-4, p[0]), p[1])), seg);
    g.rotateX(Math.PI / 2);          // lathe axis y -> z
    parts.push(g);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  parts.forEach(p => p.dispose());
  return g;
}
export const tube = (a, b, z0, z1, seg = 64) => lathe([[[b, z0]], [[b, z1]], [[a, z1]], [[a, z0]]], seg);
export const rod = (r, z0, z1, seg = 40) => lathe([[[r, z0]], [[r, z1]], [[0, z1]], [[0, z0]]], seg);
export const merge = gs => { const m = mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g), false); gs.forEach(g => g.dispose()); return m; };

// ── the builder ────────────────────────────────────────────────────────────
export function createBuild() {
  textures();
  const root = new THREE.Group();
  const parts = {}, pickables = [], owned = [];
  const B = { root, parts, pickables, alpha: 1 };

  // o: { info, label, labelAt [x,y,z] in the part frame, explode [dx,dy,dz],
  //      win [e0, e1], parent (a THREE.Group or a part) }
  B.part = (id, o = {}) => {
    const holder = new THREE.Group(), r = new THREE.Group();
    holder.add(r);
    const par = o.parent ? (o.parent.root || o.parent) : root;
    par.add(holder);
    const p = { id, holder, root: r, info: o.info || id, label: o.label || null, labelAt: o.labelAt || [0, 0, 0], explode: o.explode || [0, 0, 0], win: o.win || [0, 1], mats: {}, hl: 0 };
    parts[id] = p;
    return p;
  };
  B.mat = (p, name) => p.mats[name] || (p.mats[name] = makeMat(name));
  B.mesh = (p, geom, matName, o = {}) => {
    const m = new THREE.Mesh(geom, B.mat(p, matName));
    m.castShadow = o.shadow !== false; m.receiveShadow = true;
    m.userData.part = p.info;
    owned.push(geom);
    (o.parent || p.root).add(m);
    if (o.pick !== false) pickables.push(m);
    return m;
  };
  B.own = g => { owned.push(g); return g; };

  B.applyExplode = e => {
    for (const id in parts) {
      const q = parts[id], k = ease((e - q.win[0]) / (q.win[1] - q.win[0]));
      q.holder.position.set(q.explode[0] * k, q.explode[1] * k, q.explode[2] * k);
    }
  };
  const tmp = new THREE.Vector3();
  B.labelPoint = q => q.root.localToWorld(tmp.set(...q.labelAt));
  const GLOW = new THREE.Color(0xffc870);
  B.setHighlight = (p, v) => {
    for (const k in p.mats) {
      const m = p.mats[k];
      if (!m.emissive) continue;
      m.emissive.copy(m.userData.baseEmissive || new THREE.Color(0)).lerp(GLOW, v * 0.4);
    }
  };
  // a fade of the whole engine (swap). Meshes with userData.ownAlpha (the
  // gas in the chambers) keep their own opacity times this one.
  B.setAlpha = a => {
    const fade = a < 0.999;
    root.traverse(o => {
      if (!o.isMesh || o.userData.ownAlpha) return;
      const m = o.material;
      if (m.transparent !== fade) { m.transparent = fade; m.depthWrite = !fade || a > 0.5; m.needsUpdate = true; }
      m.opacity = a;
      o.castShadow = !fade && !o.userData.noShadow;
    });
    B.alpha = a;
  };
  B.dispose = () => {
    root.removeFromParent();
    for (const g of owned) g.dispose();
    for (const id in parts) for (const k in parts[id].mats) parts[id].mats[k].dispose();
  };
  B.coarse = COARSE;
  return B;
}
