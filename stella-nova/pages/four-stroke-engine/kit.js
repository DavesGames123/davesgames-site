// ============================================================================
//  FOUR-STROKE ENGINE  ·  kit.js — the builder the engine scene uses
// ────────────────────────────────────────────────────────────────────────────
//  createBuild() returns a builder B for one engine. scene.js calls B.part
//  and B.add to make the parts, then main.js poses, explodes, highlights,
//  fades and disposes them through B. Units are mm.
//
//  PART TREE
//    B.root → part.root (explode offset) → part.holder (the pose) → meshes
//
//  SECTION CUT
//    A casting (block, head, pan, cover) keeps only the half behind the
//    plane z = 0. A second mesh draws the casting's back faces in a flat
//    cut colour with the same clip, so the cut reads as a solid face. The
//    explode moves castings in x and y only, so the plane stays valid.
//    A polygon offset pulls the cut mesh nearer, so it does not z-fight
//    with the faces that touch it (B.add).
//
//  GREP MAP
//    const MAT_DEF .............. the material templates by name
//    function createBuild ....... the builder
//      B.part / B.add ........... parts, explode offsets, labels
//      B.setSection ............. the section cut on or off
//      B.applyExplode / B.setHighlight / B.setAlpha / B.dispose
//    export function exYZ / exXZ  extrude a 2D outline along x or along y
//    export function gearShape .. a toothed outline (sprockets, ring gear)
// ============================================================================
import * as THREE from 'three';

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
export const CUT = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);   // keeps z ≤ 0

const MAT_DEF = {
  iron:    { color: 0x6c7078, metalness: 0.55, roughness: 0.62 },      // cast-iron block
  head:    { color: 0xaeb2b9, metalness: 0.8, roughness: 0.46 },       // aluminium head
  // alu, forged, steel: the studio is dark with one large softbox. At a low
  // roughness, these metals mirror the dark room, so the crank, the rods and
  // the cams read near black and the pistons read as a white blob. A higher
  // roughness spreads the softbox over each face, so the parts read as metal.
  alu:     { color: 0xc9ccd2, metalness: 0.8, roughness: 0.5 },        // pistons
  forged:  { color: 0xa8adb5, metalness: 1, roughness: 0.55 },         // crank, rods
  steel:   { color: 0xb4b9c1, metalness: 1, roughness: 0.42 },         // cams, journals
  bright:  { color: 0xdfe1e5, metalness: 1, roughness: 0.16 },         // valves, pins
  spring:  { color: 0x3f7a92, metalness: 0.75, roughness: 0.32 },      // painted valve springs
  dark:    { color: 0x3a3d45, metalness: 0.6, roughness: 0.48 },       // chain guides, bolts
  chain:   { color: 0x8c9199, metalness: 1, roughness: 0.3 },
  paint:   { color: 0x8c1f25, metalness: 0.25, roughness: 0.58 },      // cam cover
  pan:     { color: 0x2a2d34, metalness: 0.45, roughness: 0.55 },
  gasket:  { color: 0xb87a43, metalness: 0.9, roughness: 0.32 },
  ceramic: { color: 0xece8df, metalness: 0, roughness: 0.32 },
  ring:    { color: 0x55585f, metalness: 0.9, roughness: 0.3 },        // piston rings
};
const CUT_COLOR = 0xb4563a;

// o: { castShadow }
export function createBuild() {
  const root = new THREE.Group();
  const B = { root, parts: {}, pickables: [], castings: [] };

  // a part: o = { info, label, ex: [x, y, z] explode offset in mm, delay 0..1, labelAt: [x, y, z] in the holder }
  B.part = (id, o = {}) => {
    const r = new THREE.Group(), holder = new THREE.Group();
    r.add(holder); root.add(r);
    const p = { id, root: r, holder, info: o.info || id, label: o.label || null, ex: new THREE.Vector3(...(o.ex || [0, 0, 0])), delay: o.delay || 0,
      labelAt: new THREE.Vector3(...(o.labelAt || [0, 0, 0])), mats: {}, meshes: [], hl: 0, casting: !!o.casting };
    B.parts[id] = p;
    return p;
  };
  const matFor = (p, name) => {
    if (!p.mats[name]) {
      const m = new THREE.MeshStandardMaterial({ ...MAT_DEF[name] });
      if (p.casting) { m.clippingPlanes = [CUT]; m.clipShadows = true; }
      m.userData.baseOpacity = 1;
      p.mats[name] = m;
    }
    return p.mats[name];
  };
  // add a mesh to a part. g: geometry, or a ready mesh (InstancedMesh). o = { parent, pos, rot, pick }
  B.add = (p, g, matName, o = {}) => {
    const mesh = g.isMesh ? g : new THREE.Mesh(g, matFor(p, matName));
    if (g.isMesh) mesh.material = matFor(p, matName);
    if (o.pos) mesh.position.set(...o.pos);
    if (o.rot) mesh.rotation.set(...o.rot);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.part = p.info;
    (o.parent || p.holder).add(mesh);
    p.meshes.push(mesh);
    if (o.pick !== false) B.pickables.push(mesh);
    if (p.casting) {
      // The cut mesh shares each face plane with the faces that touch it: the
      // inner faces where two boxes of one casting meet, and the contact faces
      // between block, gasket, head, cover and pan. Without an offset, these
      // face pairs z-fight in stripes on the cut. The offset moves the cut mesh
      // a few depth units nearer, so the cut colour wins on each shared plane.
      if (!p.mats.cut) {
        p.mats.cut = new THREE.MeshBasicMaterial({ color: CUT_COLOR, side: THREE.BackSide, clippingPlanes: [CUT], polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 });
        p.mats.cut.userData.baseOpacity = 1;
      }
      const cap = new THREE.Mesh(mesh.geometry, p.mats.cut);
      cap.position.copy(mesh.position); cap.rotation.copy(mesh.rotation); cap.scale.copy(mesh.scale);
      cap.userData.part = p.info;
      mesh.parent.add(cap);
      B.castings.push(cap);
    }
    return mesh;
  };
  // a transparent mesh with its own material (the gas), not pickable, no shadow
  B.addGlow = (p, g, color, opacity) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    m.userData.baseOpacity = opacity; m.userData.glow = true;
    const mesh = new THREE.Mesh(g, m);
    p.holder.add(mesh); p.mats['glow' + p.meshes.length] = m; p.meshes.push(mesh);
    return mesh;
  };

  B.section = true;
  B.setSection = on => {
    B.section = on;
    for (const id in B.parts) {
      const p = B.parts[id]; if (!p.casting) continue;
      for (const k in p.mats) { const m = p.mats[k]; if (k === 'cut') continue; m.clippingPlanes = on ? [CUT] : []; m.needsUpdate = true; }
    }
    for (const c of B.castings) c.visible = on;
  };

  // explode: e 0..1; each part starts after its delay, so the outer parts lead
  B.applyExplode = e => {
    for (const id in B.parts) {
      const p = B.parts[id];
      const k = ease((e - p.delay * 0.4) / 0.6);
      p.root.position.copy(p.ex).multiplyScalar(k);
    }
  };
  B.setHighlight = (p, v) => {
    for (const k in p.mats) { const m = p.mats[k]; if (m.emissive) m.emissive.setRGB(0.55 * v, 0.36 * v, 0.12 * v); }
  };
  B.alpha = 1;
  B.setAlpha = a => {
    B.alpha = a;
    for (const id in B.parts) for (const k in B.parts[id].mats) {
      const m = B.parts[id].mats[k], fade = a < 0.999;
      m.opacity = m.userData.baseOpacity * a;
      if (!m.userData.glow && m.transparent !== fade) { m.transparent = fade; m.needsUpdate = true; }
    }
  };
  const tmp = new THREE.Vector3();
  B.labelPoint = p => p.holder.localToWorld(tmp.copy(p.labelAt));
  B.dispose = () => {
    root.parent && root.parent.remove(root);
    const geos = new Set();
    root.traverse(o => { if (o.geometry) geos.add(o.geometry); });
    for (const g of geos) g.dispose();
    for (const id in B.parts) for (const k in B.parts[id].mats) B.parts[id].mats[k].dispose();
  };
  return B;
}

// ── geometry helpers ────────────────────────────────────────────────────────
// a THREE.Shape from [[a, b], ...] with optional holes (each [[a, b], ...] or a circle {c: [a, b], r}).
// ExtrudeGeometry fixes the hole direction only for a counter-clockwise
// outline, so the outline is made counter-clockwise and each hole clockwise.
export function shapeOf(pts, holes = []) {
  let v = pts.map(([a, b]) => new THREE.Vector2(a, b));
  if (THREE.ShapeUtils.isClockWise(v)) v = v.reverse();
  const s = new THREE.Shape(v);
  for (const h of holes) {
    const path = new THREE.Path();
    if (h.r) path.absarc(h.c[0], h.c[1], h.r, 0, Math.PI * 2, true);
    else { let hv = h.map(([a, b]) => new THREE.Vector2(a, b)); if (!THREE.ShapeUtils.isClockWise(hv)) hv = hv.reverse(); path.setFromPoints(hv); }
    s.holes.push(path);
  }
  return s;
}
// extrude an outline drawn in the (z, y) plane along x, centred on x = 0
export function exYZ(shape, len, curve = 24) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: curve });
  g.translate(0, 0, -len / 2);
  // (a, b, e) → (x = e, y = b, z = −a): a proper rotation, so zy() gives a = −z
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  return g;
}
// points given as (z, y) for exYZ
export const zy = pts => pts.map(([z, y]) => [-z, y]);
// extrude an outline drawn in the (x, z) plane along +y, from y = 0 to y = h
export function exXZ(shape, h, curve = 24) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: curve });
  g.rotateX(-Math.PI / 2);      // (a, b, e) → (x = a, y = e, z = −b)
  return g;
}
export const xz = pts => pts.map(([x, z]) => [x, -z]);
// a cylinder along x
export const cylX = (r, len, seg = 36, r2 = r) => new THREE.CylinderGeometry(r2, r, len, seg).rotateZ(-Math.PI / 2);
// a toothed outline: n teeth, root and tip radius, in (a, b)
export function gearPts(n, rRoot, rTip, k = 0.42) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, s = Math.PI * 2 / n;
    for (const [f, r] of [[0, rRoot], [0.5 - k / 2 - 0.06, rRoot], [0.5 - k / 2, rTip], [0.5 + k / 2, rTip], [0.5 + k / 2 + 0.06, rRoot]]) {
      const a = a0 + f * s; pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return pts;
}
