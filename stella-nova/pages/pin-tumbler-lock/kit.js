// ============================================================================
//  PIN TUMBLER LOCK  ·  kit.js — materials, shape helpers, parts, explode
// ────────────────────────────────────────────────────────────────────────────
//  Copied from the stirling-engine kit. createBuild() returns a builder B
//  for one lock. scene.js calls B.part and B.mesh with the shape helpers
//  below; main.js poses, explodes, cuts, highlights, tints, fades and
//  disposes the parts through the same builder. Units are millimetres, y is
//  up, the plug axis is the x axis.
//
//  SECTION. A part made with { cut: true } is a shell. Its materials clip
//  away z > 0 with a plane of its own, which moves with the part when it
//  explodes. The faces seen through the cut are back faces; the shader
//  paints them with a section hatch. B.setSection(false) moves the planes
//  far away.
//
//  Added for the lock: brass, nickel and blued steel materials, a part's
//  own explodeFn (an offset that is not one straight line), B.setTint (a
//  calm red on a blocking pin), zyExtrude (a (z, y) outline along x),
//  plugCrown (the top of the plug with round pin chambers), createSpring
//  (a coil whose length changes in place) and clipY (cut an outline at a
//  height, for the key grooves).
//
//  GREP MAP
//    const MAT_DEF ............. material templates by name
//    function cutPatch ......... the back-face section hatch
//    export function lathe ..... a closed (r, y) profile turned round y
//    export function slabXZ .... an outline extruded along y (plates)
//    export function slabYZ .... an outline extruded along x
//    export function zyExtrude . (z, y) points extruded from x0 to x1
//    export function plugCrown . cylinder cap above y = yk with round holes
//    export function createSpring  a helix, setLength(L) moves it in place
//    export function clipY ..... keep the part of an outline above or below y
//    function createBuild ...... the builder
//      B.part / B.mesh ......... parts and their meshes
//      B.applyExplode .......... staggered offsets with an ease (or explodeFn)
//      B.setSection / B.setHighlight / B.setTint / B.setAlpha / B.dispose
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

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
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // walnut: long wavy grain lines over a warm brown
  const wood = canvasTex(512, (g, n) => {
    g.fillStyle = '#5a3a24'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) {
      const y0 = rnd() * n, a = 2 + rnd() * 7, f = 1 + rnd() * 3, ph = rnd() * 6.3;
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '30,16,8' : '120,80,50'},${0.05 + rnd() * 0.16})`;
      g.lineWidth = 0.6 + rnd() * 2.2; g.beginPath();
      for (let x = 0; x <= n; x += 8) { const y = y0 + a * Math.sin(x / n * 6.283 * f + ph); x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    const gr = g.createLinearGradient(0, 0, 0, n); gr.addColorStop(0, 'rgba(255,200,150,0.04)'); gr.addColorStop(1, 'rgba(0,0,0,0.08)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  }, [1, 1]);
  wood.colorSpace = THREE.SRGBColorSpace;
  // wire gauze for the regenerator matrix (alpha: the gaps)
  const gauze = canvasTex(128, (g, n) => {
    g.clearRect(0, 0, n, n);
    g.strokeStyle = '#fff'; g.lineWidth = 3.2;
    for (let i = 0; i <= n; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, n); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(n, i); g.stroke(); }
  }, [10, 6]);
  // turned finish: fine rings for the roughness of lathe parts
  const turned = canvasTex(256, (g, n) => {
    for (let y = 0; y < n; y++) { const v = 150 + 50 * Math.sin(y * 1.7) * Math.sin(y * 0.13) + (rnd() - 0.5) * 30; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, n, 1); }
  }, [1, 8]);
  TEX = { wood, gauze, turned };
  return TEX;
}

// ── materials ──────────────────────────────────────────────────────────────
const MAT_DEF = {
  steel: () => ({ color: 0xdfe3ea, metalness: 1, roughness: 0.16 }),
  turned: () => ({ color: 0xd9dde5, metalness: 1, roughness: 0.3, roughnessMap: TEX.turned }),
  satin: () => ({ color: 0xc4c9d2, metalness: 1, roughness: 0.36 }),
  alu: () => ({ color: 0xc9ced8, metalness: 1, roughness: 0.42, roughnessMap: TEX.turned }),
  brass: () => ({ physical: true, color: 0xd6a85a, metalness: 1, roughness: 0.26, clearcoat: 0.3 }),
  bronze: () => ({ color: 0xb98a52, metalness: 1, roughness: 0.32 }),
  copper: () => ({ color: 0xd08a5e, metalness: 1, roughness: 0.3 }),
  hot: () => ({ color: 0xc0a48a, metalness: 1, roughness: 0.34, roughnessMap: TEX.turned, emissive: 0x000000 }),
  graphite: () => ({ color: 0x3a3d44, metalness: 0.2, roughness: 0.55 }),
  enamel: () => ({ physical: true, color: 0x2c3e58, metalness: 0.25, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.18 }),
  red: () => ({ physical: true, color: 0x8a2a24, metalness: 0.2, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  wood: () => ({ physical: true, color: 0xe8d8c8, map: TEX.wood, metalness: 0, roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.7 }),
  ceramic: () => ({ color: 0xe6dfd2, metalness: 0, roughness: 0.75, emissive: 0x000000 }),
  gauze: () => ({ color: 0xc89a6a, metalness: 1, roughness: 0.35, alphaMap: TEX.gauze, alphaTest: 0.5, side: THREE.DoubleSide }),
  dark: () => ({ color: 0x15171c, metalness: 0.4, roughness: 0.5 }),
  // the lock
  housing: () => ({ physical: true, color: 0xc99a52, metalness: 1, roughness: 0.3, roughnessMap: TEX.turned, clearcoat: 0.15, clearcoatRoughness: 0.4 }),
  plug: () => ({ physical: true, color: 0xe2bd74, metalness: 1, roughness: 0.22, clearcoat: 0.25 }),
  keypin: () => ({ color: 0xe0b060, metalness: 1, roughness: 0.2, emissive: 0x000000 }),
  driver: () => ({ color: 0xd8dde6, metalness: 1, roughness: 0.18, emissive: 0x000000 }),
  nickel: () => ({ physical: true, color: 0xd6d3c9, metalness: 1, roughness: 0.38, clearcoat: 0.2, clearcoatRoughness: 0.35 }),
  spring: () => ({ color: 0xb8bec8, metalness: 1, roughness: 0.3 }),
  blued: () => ({ color: 0x2a3654, metalness: 1, roughness: 0.28 }),
  zinc: () => ({ color: 0xa3a8b1, metalness: 1, roughness: 0.46, roughnessMap: TEX.turned }),
  wafer: () => ({ color: 0xd2d6de, metalness: 0.85, roughness: 0.34, emissive: 0x000000 }),
  black: () => ({ physical: true, color: 0x1a1c22, metalness: 0.3, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
};

// Back faces seen through the section cut: a hatch in screen space, lit by
// nothing, so the cut reads as a flat drawing-office section.
function cutPatch(m) {
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (!gl_FrontFacing) {
        float h = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
        gl_FragColor = vec4(mix(vec3(0.24, 0.20, 0.15), vec3(0.42, 0.36, 0.26), h), gl_FragColor.a);
      }`);
  };
  m.customProgramCacheKey = () => 'cut';
}
function makeMat(name, cutPlane) {
  const def = { ...MAT_DEF[name]() };
  const physical = def.physical; delete def.physical;
  const m = physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);
  if (cutPlane) {
    m.clippingPlanes = [cutPlane];
    if (name !== 'gauze') { m.side = THREE.DoubleSide; m.shadowSide = THREE.FrontSide; cutPatch(m); }
  }
  m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null;
  return m;
}

// ── shape helpers ──────────────────────────────────────────────────────────
// lathe(runs): a closed profile in (r, y), counter-clockwise (up the
// outside, in across the top, down the inside). Each run turns as its own
// smooth band, so the corners between runs stay sharp.
export function lathe(runs, seg = 64) {
  const parts = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i].slice(), next = runs[(i + 1) % runs.length];
    run.push(next[0]);
    const pts = run.map(p => new THREE.Vector2(Math.max(1e-4, p[0]), p[1]));
    parts.push(new THREE.LatheGeometry(pts, seg));
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  parts.forEach(p => p.dispose());
  return g;
}
// a tube wall: inner radius a, outer b, from y0 to y1
export const tubeWall = (a, b, y0, y1, seg) => lathe([[[b, y0]], [[b, y1]], [[a, y1]], [[a, y0]]], seg);
// a solid cylinder about y
export const rod = (r, y0, y1, seg = 32) => lathe([[[r, y0]], [[r, y1]], [[0, y1]], [[0, y0]]], seg);
// a rounded box outline (x, y)
export function rrect(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
export const circlePath = (r, cx = 0, cy = 0, hole = true) => { const p = hole ? new THREE.Path() : new THREE.Shape(); p.absarc(cx, cy, r, 0, Math.PI * 2, hole); return p; };
function extrude(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 40 });
  g.translate(0, 0, bevel);
  return g;
}
// a shape drawn as (x, -z) extruded up y from y0 by h (plates, flanges)
export function slabXZ(shape, y0, h, bevel = 0.8) {
  const g = extrude(shape, h, bevel);
  g.rotateX(-Math.PI / 2);             // shape (x, y) -> (x, -z); extrusion z -> +y
  g.translate(0, y0, 0);
  return g;
}
// a shape drawn as (-z, y) extruded along +x from x0 by w (webs, bearings)
export function slabYZ(shape, x0, w, bevel = 0.6) {
  const g = extrude(shape, w, bevel);
  g.rotateY(Math.PI / 2);              // shape (x, y) -> (-z, y); extrusion z -> +x
  g.translate(x0, 0, 0);
  return g;
}
// a pipe along a polyline with round corners; with an inside wall
export function pipePath(pts, bend) {
  const V = pts.map(p => new THREE.Vector3(...p)), path = new THREE.CurvePath();
  let cur = V[0].clone();
  for (let i = 1; i < V.length; i++) {
    const a = V[i], last = i === V.length - 1;
    if (last) { path.add(new THREE.LineCurve3(cur, a.clone())); break; }
    const din = a.clone().sub(V[i - 1]).normalize(), dout = V[i + 1].clone().sub(a).normalize();
    const p0 = a.clone().addScaledVector(din, -bend), p1 = a.clone().addScaledVector(dout, bend);
    path.add(new THREE.LineCurve3(cur, p0));
    path.add(new THREE.QuadraticBezierCurve3(p0, a.clone(), p1));
    cur = p1;
  }
  return path;
}
export function hollowPipe(path, rIn, rOut, segs = 120) {
  const o = new THREE.TubeGeometry(path, segs, rOut, 24, false);
  const i = new THREE.TubeGeometry(path, segs, rIn, 24, false);
  // flip the inside wall: its normals point at the pipe's axis
  const idx = i.index.array;
  for (let k = 0; k < idx.length; k += 3) { const t = idx[k]; idx[k] = idx[k + 2]; idx[k + 2] = t; }
  const n = i.attributes.normal.array; for (let k = 0; k < n.length; k++) n[k] = -n[k];
  // end rings join the two walls
  const ends = [];
  for (const [u, dir] of [[0, -1], [1, 1]]) {
    const p = path.getPointAt(u), t = path.getTangentAt(u).normalize();
    const ring = new THREE.RingGeometry(rIn, rOut, 24);
    ring.lookAt(t.clone().multiplyScalar(dir)); ring.translate(p.x, p.y, p.z);
    ends.push(ring);
  }
  const g = mergeGeometries([o, i, ...ends].map(q => q.toNonIndexed()), false);
  [o, i, ...ends].forEach(q => q.dispose());
  return g;
}
// a crank web: a disc on x. holes: [psi, radius, hole radius], psi the
// angle from the pin direction (+y) toward +z, as the crank turns
export function discWeb(R, x0, w, holes = []) {
  const s = new THREE.Shape(); s.absarc(0, 0, R, 0, Math.PI * 2, false);
  for (const [a, rr, hr] of holes) s.holes.push(circlePath(hr, -Math.sin(a) * rr, Math.cos(a) * rr));
  return slabYZ(s, x0, w, 0.5);
}

// ── the builder ────────────────────────────────────────────────────────────
export function createBuild() {
  textures();
  const root = new THREE.Group();
  const parts = {}, pickables = [], owned = [], extras = [];
  const B = { root, parts, pickables, alpha: 1, section: true };

  // a part: holder (explode offset) > root (pose). o: { info, label,
  // labelAt [x,y,z] in the part frame, explode [dx,dy,dz], st (stagger 0..0.4),
  // cut (a section shell) }
  B.part = (id, o = {}) => {
    const holder = new THREE.Group(), r = new THREE.Group();
    holder.add(r); root.add(holder);
    const plane = o.cut ? new THREE.Plane(new THREE.Vector3(0, 0, -1), 0) : null;
    const p = { id, holder, root: r, info: o.info || id, label: o.label || null, labelAt: o.labelAt || [0, 0, 0], explode: o.explode || [0, 0, 0], explodeFn: o.explodeFn || null, st: o.st || 0, plane, mats: {}, hl: 0 };
    parts[id] = p;
    return p;
  };
  // a mesh that is not a part (an overlay): kept, faded and disposed
  B.extra = m => { root.add(m); extras.push(m); m.userData.overlay = true; m.userData.op = m.material.opacity; return m; };
  B.mat = (p, name) => p.mats[name] || (p.mats[name] = makeMat(name, p.plane));
  B.mesh = (p, geom, matName, o = {}) => {
    const m = new THREE.Mesh(geom, B.mat(p, matName));
    m.castShadow = o.shadow !== false; m.receiveShadow = true;
    m.userData.part = p.info;
    owned.push(geom);
    (o.parent || p.root).add(m);
    if (o.pick !== false) pickables.push(m);
    return m;
  };

  // explode: each part leaves after its stagger, with a smooth ease
  B.applyExplode = e => {
    for (const id in parts) {
      const q = parts[id], k = ease((e - q.st) / (1 - q.st));
      if (q.explodeFn) q.explodeFn(e, q.holder.position);
      else q.holder.position.set(q.explode[0] * k, q.explode[1] * k, q.explode[2] * k);
      if (q.plane) q.plane.constant = B.section ? q.holder.position.z : 1e5;
    }
  };
  B.setSection = on => { B.section = on; for (const id in parts) if (parts[id].plane) parts[id].plane.constant = on ? parts[id].holder.position.z : 1e5; };
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
  // a calm base colour on one part (a blocking pin), kept under the glow
  B.setTint = (p, col) => {
    for (const k in p.mats) { const m = p.mats[k]; if (!m.emissive) continue; m.userData.baseEmissive = col.clone(); if (!p.hl) m.emissive.copy(col); }
  };
  // a calm heat colour on the hot parts: base emissive, kept under the glow
  B.setHeat = (ids, col) => {
    for (const id of ids) { const p = parts[id]; if (!p) continue; for (const k in p.mats) { const m = p.mats[k]; if (m.emissive && (k === 'hot' || k === 'ceramic')) { m.userData.baseEmissive = col.clone(); if (!p.hl) m.emissive.copy(col); } } }
  };
  B.setAlpha = a => {
    const fade = a < 0.999;
    root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (o.userData.overlay) { m.opacity = a * o.userData.op; return; }
      if (m.transparent !== fade) { m.transparent = fade; m.depthWrite = !fade || a > 0.5; m.needsUpdate = true; }
      m.opacity = a;
      o.castShadow = !fade && !o.userData.noShadow;
    });
    B.alpha = a;
  };
  B.dispose = () => {
    root.removeFromParent();
    for (const g of owned) g.dispose();
    for (const m of extras) { m.geometry.dispose(); m.material.dispose(); }
    for (const id in parts) for (const k in parts[id].mats) parts[id].mats[k].dispose();
  };
  B.coarse = COARSE;
  return B;
}

// a shape in (x, y) extruded along +z from z0 by d (upright plates)
export function slabXY(shape, z0, d, bevel = 0.8) {
  const g = extrude(shape, d, bevel);
  g.translate(0, 0, z0);
  return g;
}
// turn a geometry made about y so that its axis lies on x
export const alongX = g => { g.rotateZ(-Math.PI / 2); return g; };
export const merge = gs => { const m = mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g), false); gs.forEach(g => g.dispose()); return m; };

// ── lock helpers ───────────────────────────────────────────────────────────
// (z, y) points, a closed outline, extruded from x0 to x1. Optional holes
// are (z, y) point lists. Normals keep edges sharper than 35°.
export function zyExtrude(pts, x0, x1, holes = []) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(-z, y))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false, curveSegments: 8 });
  g.rotateY(Math.PI / 2); g.translate(x0, 0, 0);
  const c = toCreasedNormals(g, 35 * Math.PI / 180); g.dispose();
  return c;
}
// points on a circle of radius r about (cz, cy), from angle a0 to a1
export const arcPts = (r, a0, a1, n, cz = 0, cy = 0) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cz + r * Math.cos(a), cy + r * Math.sin(a)]; });

// a triangle soup with a wanted normal per vertex; flips any triangle whose
// winding disagrees with its normal
function soup(pos, nrm) {
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
    const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * nrm[i] + cy * nrm[i + 1] + cz * nrm[i + 2] < 0) for (const a of [pos, nrm]) for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
// The top of the plug: the cylinder r = R above the plane y = yk, from x0
// to x1, with round vertical holes {x, r} at z = 0 (the pin chambers).
// The (x, z) footprint is cut into small triangles and lifted onto the
// cylinder, so the holes are true circles. Closed: crown, floor, hole
// walls and two end faces.
export function plugCrown(x0, x1, R, yk, holes, maxEdge = 0.42) {
  const w = Math.sqrt(R * R - yk * yk);
  const s = new THREE.Shape(); s.moveTo(x0, -w); s.lineTo(x1, -w); s.lineTo(x1, w); s.lineTo(x0, w); s.closePath();
  for (const h of holes) s.holes.push(circlePath(h.r, h.x, 0));
  const pos = [], nrm = [];
  const add = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nrm.push(nx, ny, nz); };
  // crown
  const flat = new THREE.ShapeGeometry(s, 40);
  const top = new TessellateModifier(maxEdge, 12).modify(flat);
  const tp = top.attributes.position;
  for (let i = 0; i < tp.count; i++) { const x = tp.getX(i), z = Math.max(-w, Math.min(w, tp.getY(i))), y = Math.sqrt(R * R - z * z); add(x, y, z, 0, y / R, z / R); }
  top.dispose();
  // floor (the keyway roof)
  const fl = flat.index ? flat.toNonIndexed() : flat, fp = fl.attributes.position;
  for (let i = 0; i < fp.count; i++) add(fp.getX(i), yk, fp.getY(i), 0, -1, 0);
  flat.dispose(); if (fl !== flat) fl.dispose();
  // hole walls: normals point into the hole
  for (const h of holes) {
    const N = 40;
    for (let j = 0; j < N; j++) {
      const a0 = j / N * Math.PI * 2, a1 = (j + 1) / N * Math.PI * 2;
      const P = a => { const x = h.x + h.r * Math.cos(a), z = h.r * Math.sin(a); return [x, z, Math.sqrt(R * R - z * z)]; };
      const [xa, za, ya] = P(a0), [xb, zb, yb] = P(a1);
      const na = [-Math.cos(a0), 0, -Math.sin(a0)], nb = [-Math.cos(a1), 0, -Math.sin(a1)];
      add(xa, yk, za, ...na); add(xb, yk, zb, ...nb); add(xb, yb, zb, ...nb);
      add(xa, yk, za, ...na); add(xb, yb, zb, ...nb); add(xa, ya, za, ...na);
    }
  }
  // end faces
  const seg = new THREE.Shape(arcPts(R, Math.asin(yk / R), Math.PI - Math.asin(yk / R), 48).map(([c, y]) => new THREE.Vector2(c, y)));
  const sg = new THREE.ShapeGeometry(seg).toNonIndexed(), sp = sg.attributes.position;
  for (const [x, nx] of [[x0, -1], [x1, 1]]) for (let i = 0; i < sp.count; i++) add(x, sp.getY(i), sp.getX(i), nx, 0, 0);
  sg.dispose();
  return soup(pos, nrm);
}

// A coil spring along +y from 0 to L: closed, ground ends and open coils
// between. The topology is fixed; setLength(L) rewrites y in place, so the
// wire stays round as the spring compresses.
export function createSpring(Rc, rw, turns, segPerTurn = 22, radial = 7) {
  const n = Math.ceil(turns * segPerTurn) + 1, ringN = radial + 1;
  const pos = new Float32Array(n * ringN * 3), nrm = new Float32Array(n * ringN * 3), tau = new Float32Array(n), sinp = new Float32Array(n * ringN);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * turns, a = t * Math.PI * 2; tau[i] = t;
    for (let j = 0; j < ringN; j++) {
      const ph = j / radial * Math.PI * 2, c = Math.cos(ph), sn = Math.sin(ph), k = (i * ringN + j) * 3;
      pos[k] = (Rc + rw * c) * Math.cos(a); pos[k + 2] = (Rc + rw * c) * Math.sin(a);
      nrm[k] = c * Math.cos(a); nrm[k + 1] = sn; nrm[k + 2] = c * Math.sin(a);
      sinp[i * ringN + j] = sn;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * ringN + j, b = a + ringN;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  const ends = 0.85, pe = 2 * rw * 1.04;
  let lastL = -1;
  const sp = {
    geom: g, solid: (turns + 1) * 2 * rw,
    setLength(L) {
      if (Math.abs(L - lastL) < 1e-4) return;
      lastL = L;
      const H = Math.max(0, L - 2 * rw), mid = turns - 2 * ends;
      const pm = Math.max(pe, (H - 2 * ends * pe) / mid);
      for (let i = 0; i < n; i++) {
        const t = tau[i];
        const yc = t <= ends ? rw + t * pe : t >= turns - ends ? rw + ends * pe + mid * pm + (t - (turns - ends)) * pe : rw + ends * pe + (t - ends) * pm;
        for (let j = 0; j < ringN; j++) pos[(i * ringN + j) * 3 + 1] = yc + rw * sinp[i * ringN + j];
      }
      g.attributes.position.needsUpdate = true;
      g.computeBoundingSphere();
    },
  };
  sp.setLength(1);
  return sp;
}

// Sutherland–Hodgman against one horizontal line: keep the part of a
// closed (x, y) outline above y0 (keepAbove) or below it.
export function clipY(pts, y0, keepAbove) {
  const inside = p => keepAbove ? p[1] >= y0 : p[1] <= y0;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) { const t = (y0 - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, y0]); }
  }
  return out;
}
