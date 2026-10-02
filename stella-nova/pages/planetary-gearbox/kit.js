// ============================================================================
//  PLANETARY GEARBOX  ·  kit.js — materials, shape helpers, parts, explode
// ────────────────────────────────────────────────────────────────────────────
//  createBuild() returns a builder B for one gear set. scene.js calls B.part
//  and B.mesh with the shape helpers below; main.js poses, explodes,
//  highlights, tints, fades and disposes the parts through the same builder.
//  Units are millimetres. The gear axis is z (layout.js), y is up.
//
//  A part is two groups: holder (the explode offset along z) and root (the
//  pose: the turn about z, and for a planet its place on the carrier).
//
//  GREP MAP
//    const MAT_DEF ............. material templates by name
//    export function lathe ..... a closed (r, z) profile turned round z
//    export function gearGeom .. a toothed outline extruded along z
//    export function slabXY .... any outline extruded along z
//    function createBuild ...... the builder
//      B.part / B.mesh ......... parts and their meshes
//      B.applyExplode .......... windowed offsets with an ease (layout.js)
//      B.setHighlight / B.setRole / B.setAlpha / B.setPartAlpha / B.dispose
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { explodeK } from './layout.js';

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
  // turned finish: fine rings, for the roughness of shafts and drums
  const turned = canvasTex(256, (g, n) => {
    for (let y = 0; y < n; y++) { const v = 150 + 50 * Math.sin(y * 1.7) * Math.sin(y * 0.13) + (rnd() - 0.5) * 30; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, n, 1); }
  }, [1, 8]);
  // ground flank: fine streaks across the face of a gear
  const ground = canvasTex(256, (g, n) => {
    g.fillStyle = 'rgb(120,120,120)'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) { const v = 90 + rnd() * 90; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 30, 1); }
  }, [3, 3]);
  // friction lining: dark speckle
  const lining = canvasTex(128, (g, n) => {
    g.fillStyle = '#3a2a20'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1400; i++) { const v = rnd(); g.fillStyle = v < 0.5 ? 'rgba(20,12,8,0.6)' : 'rgba(150,110,80,0.35)'; g.fillRect(rnd() * n, rnd() * n, 1.5, 1.5); }
  }, [4, 1]);
  lining.colorSpace = THREE.SRGBColorSpace;
  TEX = { turned, ground, lining };
  return TEX;
}

// ── materials ──────────────────────────────────────────────────────────────
const MAT_DEF = {
  sun: () => ({ physical: true, color: 0xe8c98a, metalness: 1, roughness: 0.36, roughnessMap: TEX.ground, clearcoat: 0.25, clearcoatRoughness: 0.3 }),
  planet: () => ({ color: 0xe6e9ef, metalness: 1, roughness: 0.38, roughnessMap: TEX.ground }),
  ring: () => ({ color: 0xaab1bd, metalness: 1, roughness: 0.4, roughnessMap: TEX.turned }),
  web: () => ({ color: 0x8c939f, metalness: 1, roughness: 0.5, roughnessMap: TEX.turned }),
  carrier: () => ({ physical: true, color: 0x24508f, metalness: 0.3, roughness: 0.36, clearcoat: 0.8, clearcoatRoughness: 0.16 }),
  pin: () => ({ color: 0xf0f2f6, metalness: 1, roughness: 0.2 }),
  shaft: () => ({ color: 0xd4d8e0, metalness: 1, roughness: 0.26, roughnessMap: TEX.turned }),
  drum: () => ({ physical: true, color: 0x8a6a3e, metalness: 0.9, roughness: 0.3, roughnessMap: TEX.turned, clearcoat: 0.3 }),
  brass: () => ({ physical: true, color: 0xd6a85a, metalness: 1, roughness: 0.26, clearcoat: 0.3 }),
  band: () => ({ color: 0x4a4f5a, metalness: 0.7, roughness: 0.45 }),
  lining: () => ({ color: 0xffffff, map: TEX.lining, metalness: 0, roughness: 0.9 }),
  dark: () => ({ color: 0x15171c, metalness: 0.4, roughness: 0.5 }),
};
function makeMat(name) {
  const def = { ...MAT_DEF[name]() };
  const physical = def.physical; delete def.physical;
  const m = physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);
  m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null;
  return m;
}

// ── shape helpers ──────────────────────────────────────────────────────────
// lathe(runs): a closed profile in (r, z), counter-clockwise in (r, z) seen
// with r to the right. Each run turns as its own smooth band, so the corners
// between runs stay sharp. phi0/phiLen turn only part of the circle.
export function lathe(runs, seg = 64, phi0 = 0, phiLen = Math.PI * 2) {
  const parts = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i].slice(), next = runs[(i + 1) % runs.length];
    run.push(next[0]);
    const pts = run.map(p => new THREE.Vector2(Math.max(1e-4, p[0]), p[1]));
    parts.push(new THREE.LatheGeometry(pts, seg, phi0, phiLen));
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  parts.forEach(p => p.dispose());
  g.rotateX(Math.PI / 2);   // lathe axis y -> z; lathe angle 0 then points down (-y)
  return g;
}
// a tube wall about z: inner radius a, outer b, from z0 to z1, small chamfers
export const tubeWall = (a, b, z0, z1, seg = 96, ch = 0.5) => lathe([[[b - ch, z0], [b, z0 + ch]], [[b, z1 - ch], [b - ch, z1]], [[a + ch, z1], [a, z1 - ch]], [[a, z0 + ch], [a + ch, z0]]], seg);
// a solid shaft about z with chamfered ends
export const rod = (r, z0, z1, seg = 40, ch = 0.6) => lathe([[[0, z0], [r - ch, z0], [r, z0 + ch]], [[r, z1 - ch], [r - ch, z1]], [[0, z1]]], seg);
export const circlePath = (r, cx = 0, cy = 0, hole = true) => { const p = hole ? new THREE.Path() : new THREE.Shape(); p.absarc(cx, cy, r, 0, Math.PI * 2, hole); return p; };
// any outline (THREE.Shape in x, y) extruded along +z from z0 by d
export function slabXY(shape, z0, d, bevel = 0.5, curveSegments = 48) {
  const bv = Math.min(bevel, d / 4);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * bv, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelSegments: 1, curveSegments });
  g.translate(0, 0, z0 + bv);
  return g;
}
// a toothed outline (gears.js toothOutline points) as a shape, with holes
export function outlineShape(pts, holes = []) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(h);
  return s;
}
export const merge = gs => { const m = mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g), false); gs.forEach(g => g.dispose()); return m; };

// ── the builder ────────────────────────────────────────────────────────────
export function createBuild() {
  textures();
  const root = new THREE.Group();
  const parts = {}, pickables = [], owned = [], pitch = [];
  const B = { root, parts, pickables, pitch, alpha: 1 };

  // a part: holder (explode) > root (pose). o: the layout.js entry
  B.part = (id, o = {}) => {
    const holder = new THREE.Group(), r = new THREE.Group();
    holder.add(r); root.add(holder);
    const p = { id, holder, root: r, info: o.info || id, label: o.label || null, labelAt: o.labelAt || [0, 0, 0], L: o, k: 0, ga: 1, mats: {}, hl: 0 };
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
  // a pitch circle drawn on a gear face (shown with the Pitch circles toggle)
  B.pitchCircle = (p, r, z, col, parent) => {
    const n = Math.max(64, Math.round(r * 2)), pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z)); }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: true }));
    l.renderOrder = 2; l.userData.noShadow = true; l.visible = false;
    owned.push(g); pitch.push(l);
    (parent || p.root).add(l);
    return l;
  };

  // explode: each part moves inside its own window (layout.js ex.win)
  B.applyExplode = e => {
    for (const id in parts) {
      const q = parts[id];
      q.k = explodeK(q.L, e);
      q.holder.position.z = q.L.ex.dz * q.k;
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
  // a role tint (input / held / output) as the base emissive of a part
  B.setRole = (p, col) => {
    for (const k in p.mats) { const m = p.mats[k]; if (!m.emissive || k === 'lining') continue; m.userData.baseEmissive = col.clone(); if (!p.hl) m.emissive.copy(col); }
  };
  B.setPitch = on => { for (const l of pitch) l.visible = on; };
  // opacity: the whole set (B.alpha, for the cross-fade) times the part's
  // own ghost value (p.ga: a see-through part in the face views)
  const applyAlpha = p => {
    const a = B.alpha * p.ga, fade = a < 0.999;
    p.root.traverse(o => {
      if (o.isLine) { o.material.opacity = 0.95 * a; return; }
      if (!o.isMesh) return;
      const m = o.material;
      if (m.transparent !== fade) { m.transparent = fade; m.needsUpdate = true; }
      m.depthWrite = !fade || a > 0.5;
      m.opacity = a;
      o.castShadow = !fade && !o.userData.noShadow;
    });
  };
  B.setAlpha = a => { B.alpha = a; for (const id in parts) applyAlpha(parts[id]); };
  B.setPartAlpha = (p, a) => { p.ga = a; applyAlpha(p); };
  B.dispose = () => {
    root.removeFromParent();
    for (const g of owned) g.dispose();
    for (const l of pitch) l.material.dispose();
    for (const id in parts) for (const k in parts[id].mats) parts[id].mats[k].dispose();
  };
  B.coarse = COARSE;
  return B;
}
