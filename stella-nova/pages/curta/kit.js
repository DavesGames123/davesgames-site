// ============================================================================
//  CURTA  ·  kit.js — a copy of calculators/kit.js (same API), with:
//    TEX.digitsW (white engraved digits on black wheels) and TEX.knurl
//    (a diamond knurl normal map); materials anod (black anodised), alu
//    (machined aluminium), knurl, chrome, blued and digitsW; makeTex() and
//    B.decal() for engraved decals (polygonOffset factor -2, units -6, so
//    they never fight the face under them); and a wedge cutaway: parts made
//    with { cut: true } lose the wedge round azimuth B.cutAz (two planes,
//    clipIntersection), in place of the y > 0 cut of the calculators.
// ────────────────────────────────────────────────────────────────────────────
//  createBuild() returns a builder B for one differential. scene.js makes
//  parts with B.part and meshes with B.mesh; main.js poses, explodes, cuts,
//  highlights, fades and disposes them through the same builder.
//  Units are millimetres, y is up, the axle lies on x.
//
//  PART FRAMES
//    A part is holder > root. holder carries the explode offset in the
//    parent frame (the world, or the carrier for parts that ride in it).
//    root carries the part frame: local +Y on the axis u, local +X on e0,
//    then the spin about local +Y. scene.js makes all turned geometry about
//    local Y, so one frame rule serves every gear and shaft.
//
//  SECTION
//    A part made with { cut: true } clips away a wedge (azimuth B.cutAz
//    +- B.cutHalf, about the y axis; azimuth a: x = r sin a, z = r cos a).
//    The faces seen through the cut are back faces; the shader paints them
//    with a hatch, so a wall reads as a drawing-office section.
//
//  GREP MAP
//    const MAT_DEF ............. material templates by name
//    function cutPatch ......... the back-face section hatch
//    export function lathe ..... a closed (r, y) profile turned round y
//    export function shell ..... a wall of revolution with windows
//    export function slab ...... a flat outline extruded along y
//    function createBuild ...... the builder
//      B.part / B.mesh ......... parts and their meshes
//      B.applyExplode .......... staggered offsets with an ease
//      B.setSection / B.setHighlight / B.setAlpha / B.dispose
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
// the Pascaline stop finger, screen angle (deg, counter-clockwise from +x
// seen from above); scene.js puts the stop and the spokes from it
export const DIAL_STOP = -60;
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
  // A roughness map multiplies the stated roughness, so the texel mean of
  // each map stays near 0.9. A mean near 0.6 (turned) or 0.7 (cast) made
  // the shafts, plates and housing a dark mirror of the studio.
  // turned finish: fine rings for the roughness of lathe parts
  const turned = canvasTex(256, (g, n) => {
    for (let y = 0; y < n; y++) { const v = 228 + 24 * Math.sin(y * 1.7) * Math.sin(y * 0.13) + (rnd() - 0.5) * 22; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, n, 1); }
  }, [1, 8]);
  // cast: blotchy sand-cast roughness
  const cast = canvasTex(256, (g, n) => {
    g.fillStyle = 'rgb(232,232,232)'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) { const v = 190 + rnd() * 65 | 0; g.fillStyle = `rgba(${v},${v},${v},0.5)`; const r = 0.6 + rnd() * 2.2; g.beginPath(); g.arc(rnd() * n, rnd() * n, r, 0, 6.3); g.fill(); }
  }, [3, 3]);
  // friction lining: a waffle of grooves on a warm brown
  const lining = canvasTex(256, (g, n) => {
    g.fillStyle = '#6a4a30'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '40,24,12' : '150,110,70'},${0.15 + rnd() * 0.2})`; g.fillRect(rnd() * n, rnd() * n, 1.5, 1.5); }
    g.strokeStyle = 'rgba(20,12,6,0.85)'; g.lineWidth = 3;
    for (let i = 0; i <= n; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, n); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(n, i); g.stroke(); }
  }, [3, 3]);
  lining.colorSpace = THREE.SRGBColorSpace;
  // digit drum: ten columns, glyph up along the drum axis (+v). Column d is
  // centred on u = (d + 0.5) / 10, that is the drum angle (d + 0.5) 36 deg.
  const digits = canvasTex(1024, (g, n) => {
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#1b1712'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${n * 0.62}px Georgia, 'Times New Roman', serif`;
    for (let d = 0; d < 10; d++) {
      g.save(); g.translate((d + 0.5) * n / 10, n / 2); g.scale(0.15, 1); g.fillText(String(d), 0, n * 0.03); g.restore();
    }
  });
  digits.colorSpace = THREE.SRGBColorSpace;
  // Pascaline dial ring, a map in the plane of RingGeometry (u, v = x, y over
  // the outer radius): digit d at screen angle DIAL_STOP + (d + 0.5) 36 deg.
  const dial = canvasTex(512, (g, n) => {
    const c = n / 2;
    g.fillStyle = '#d9b46a'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#2a1d0e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${n * 0.11}px Georgia, serif`;
    for (let d = 0; d < 10; d++) {
      const a = (DIAL_STOP + (d + 0.5) * 36) * Math.PI / 180, r = c * 0.85;
      g.save(); g.translate(c + r * Math.cos(a), c - r * Math.sin(a)); g.rotate(Math.PI / 2 - a); g.fillText(String(d), 0, 0); g.restore();
      const b = (DIAL_STOP + d * 36) * Math.PI / 180;
      g.strokeStyle = '#2a1d0e'; g.lineWidth = n * 0.008; g.beginPath(); g.moveTo(c + c * 0.74 * Math.cos(b), c - c * 0.74 * Math.sin(b)); g.lineTo(c + c * 0.97 * Math.cos(b), c - c * 0.97 * Math.sin(b)); g.stroke();
    }
  });
  dial.colorSpace = THREE.SRGBColorSpace; dial.wrapS = dial.wrapT = THREE.ClampToEdgeWrapping;
  // result and counter wheels: white engraved digits on black anodising,
  // the same columns as TEX.digits
  const digitsW = canvasTex(1024, (g, n) => {
    g.fillStyle = '#121317'; g.fillRect(0, 0, n, n);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${n * 0.8}px 'Helvetica Neue', Arial, sans-serif`;
    for (let d = 0; d < 10; d++) {
      g.save(); g.translate((d + 0.5) * n / 10, n / 2); g.scale(0.17, 1);
      g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillText(String(d), 0, n * 0.035);
      g.fillStyle = '#f4f1ea'; g.fillText(String(d), 0, n * 0.03);
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(d * n / 10, 0, 2, n);
    }
  });
  digitsW.colorSpace = THREE.SRGBColorSpace;
  // knurl: a diamond grid of pyramids, as a tangent-space normal map
  const knurl = (() => {
    const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), img = g.createImageData ? g.createImageData(n, n) : null;
    if (img && img.data) {
      const P = 16, h = (x, y) => { const u = ((x + y) / P) % 1, v = ((x - y + 4 * n) / P) % 1; return Math.min(Math.abs(u - 0.5), Math.abs(v - 0.5)); };
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = (h(x + 1, y) - h(x - 1, y)) * 6, dy = (h(x, y + 1) - h(x, y - 1)) * 6, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
        img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(48, 2); return t;
  })();
  TEX = { turned, cast, lining, digits, dial, digitsW, knurl };
  return TEX;
}

// ── materials ──────────────────────────────────────────────────────────────
const MAT_DEF = {
  gear: () => ({ color: 0xc3c7cf, metalness: 1, roughness: 0.24 }),
  ring: () => ({ physical: true, color: 0xcfc6b4, metalness: 1, roughness: 0.22, clearcoat: 0.25, clearcoatRoughness: 0.3 }),
  steel: () => ({ color: 0xdfe3ea, metalness: 1, roughness: 0.14 }),
  shaft: () => ({ color: 0xa9aeb6, metalness: 1, roughness: 0.32, roughnessMap: TEX.turned }),
  cast: () => ({ color: 0x7a7e86, metalness: 0.75, roughness: 0.62, roughnessMap: TEX.cast }),
  paint: () => ({ physical: true, color: 0x46566e, metalness: 0.35, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.22 }),
  bronze: () => ({ color: 0xc08e56, metalness: 1, roughness: 0.3 }),
  brass: () => ({ color: 0xd6a85a, metalness: 1, roughness: 0.28 }),
  plate: () => ({ color: 0xd4d8de, metalness: 1, roughness: 0.2, roughnessMap: TEX.turned }),
  lining: () => ({ color: 0xffffff, map: TEX.lining, metalness: 0.05, roughness: 0.85 }),
  spring: () => ({ physical: true, color: 0x6f8cc4, metalness: 1, roughness: 0.3, clearcoat: 0.4 }),
  bolt: () => ({ color: 0x45484f, metalness: 1, roughness: 0.38 }),
  rubber: () => ({ color: 0x18191c, metalness: 0, roughness: 0.88 }),
  alu: () => ({ physical: true, color: 0xc9ced8, metalness: 1, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
  red: () => ({ physical: true, color: 0xa3332b, metalness: 0.2, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  wood: () => ({ physical: true, color: 0x6e4a2c, metalness: 0, roughness: 0.55, roughnessMap: TEX.cast, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
  black: () => ({ physical: true, color: 0x1e2026, metalness: 0.4, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
  ivory: () => ({ color: 0xe8e0cc, metalness: 0.05, roughness: 0.5 }),
  digits: () => ({ color: 0xffffff, map: TEX.digits, metalness: 0.05, roughness: 0.45 }),
  anod: () => ({ physical: true, color: 0x17181d, metalness: 0.55, roughness: 0.4, roughnessMap: TEX.cast, clearcoat: 0.35, clearcoatRoughness: 0.45 }),
  anodRed: () => ({ physical: true, color: 0x8f1f1c, metalness: 0.5, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  machined: () => ({ color: 0xd4d8df, metalness: 1, roughness: 0.26, roughnessMap: TEX.turned }),
  knurl: () => ({ color: 0xc4c9d2, metalness: 1, roughness: 0.34, normalMap: TEX.knurl, normalScale: new THREE.Vector2(0.9, 0.9) }),
  chrome: () => ({ color: 0xe9ecf1, metalness: 1, roughness: 0.07 }),
  blued: () => ({ color: 0x3a4f7a, metalness: 1, roughness: 0.27 }),
  digitsW: () => ({ color: 0xffffff, map: TEX.digitsW, metalness: 0.25, roughness: 0.42 }),
  dial: () => ({ color: 0xffffff, map: TEX.dial, metalness: 0.5, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
};

// Back faces seen through the section cut: a hatch in screen space, lit by
// nothing, so the cut reads as a flat drawing-office section.
// Parts touch on shared faces (a bearing race in its bore, a thrust washer
// on the carrier wall, a spider gear on its seat). Through the cut, the
// hatch back face and the front face of the other part have the same
// depth, so they fought. The hatch moves 0.04 % of its eye distance toward
// the camera and wins. As 1 - z ≈ n f / ((f - n) d) at eye distance d,
// (1 - z) k is that move.
function cutPatch(m) {
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      gl_FragDepth = gl_FragCoord.z;
      if (!gl_FrontFacing) {
        float h = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
        gl_FragColor = vec4(mix(vec3(0.19, 0.205, 0.24), vec3(0.33, 0.345, 0.39), h), gl_FragColor.a);
        gl_FragDepth = gl_FragCoord.z - (1.0 - gl_FragCoord.z) * 4.0e-4;
      }`);
  };
  m.customProgramCacheKey = () => 'cut';
}
function makeMat(name, cutPlane) {
  const def = { ...MAT_DEF[name]() };
  const physical = def.physical; delete def.physical;
  const m = physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);
  if (cutPlane) { m.clippingPlanes = cutPlane; m.clipIntersection = true; m.side = THREE.DoubleSide; m.shadowSide = THREE.FrontSide; cutPatch(m); }
  m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null;
  return m;
}

// ── shape helpers (all about local Y) ──────────────────────────────────────
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
// a polygon with every corner sharp
export const poly = (pts, seg) => lathe(pts.map(p => [p]), seg);
export const tube = (a, b, y0, y1, seg) => poly([[b, y0], [b, y1], [a, y1], [a, y0]], seg);
export const rod = (r, y0, y1, seg = 32) => poly([[r, y0], [r, y1], [0, y1], [0, y0]], seg);
export const merge = gs => { const m = mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g), false); gs.forEach(g => g.dispose()); return m; };

// shell(rows, nPhi, hole): a wall of revolution about local Y. rows are
// { y, ro, ri } samples from bottom to top; hole(y, phi) true cuts a window
// (phi from local +X toward local −Z, the right-hand sense about +Y). The
// window edges get side walls, and the two ends get annular caps.
export function shell(rows, nPhi, hole = () => false) {
  const P = [], N = [];
  const at = (r, y, f) => [r * Math.cos(f), y, -r * Math.sin(f)];
  const quad = (a, b, c, d) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const nr = rows.length - 1;
  const open = [];
  for (let i = 0; i < nr; i++) {
    open.push([]);
    for (let j = 0; j < nPhi; j++) open[i].push(!hole((rows[i].y + rows[i + 1].y) / 2, (j + 0.5) / nPhi * Math.PI * 2));
  }
  const keep = (i, j) => i >= 0 && i < nr && open[i][(j + nPhi) % nPhi];
  for (let i = 0; i < nr; i++) for (let j = 0; j < nPhi; j++) {
    if (!open[i][j]) continue;
    const f0 = j / nPhi * Math.PI * 2, f1 = (j + 1) / nPhi * Math.PI * 2, a = rows[i], b = rows[i + 1];
    quad(at(a.ro, a.y, f0), at(a.ro, a.y, f1), at(b.ro, b.y, f1), at(b.ro, b.y, f0));     // outside
    quad(at(a.ri, a.y, f1), at(a.ri, a.y, f0), at(b.ri, b.y, f0), at(b.ri, b.y, f1));     // inside
    if (!keep(i - 1, j)) quad(at(a.ri, a.y, f0), at(a.ri, a.y, f1), at(a.ro, a.y, f1), at(a.ro, a.y, f0));
    if (!keep(i + 1, j)) quad(at(b.ro, b.y, f0), at(b.ro, b.y, f1), at(b.ri, b.y, f1), at(b.ri, b.y, f0));
    if (!keep(i, j - 1)) quad(at(a.ri, a.y, f0), at(a.ro, a.y, f0), at(b.ro, b.y, f0), at(b.ri, b.y, f0));
    if (!keep(i, j + 1)) quad(at(a.ro, a.y, f1), at(a.ri, a.y, f1), at(b.ri, b.y, f1), at(b.ro, b.y, f1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return smoothShell(g);
}
// shell normals: average each vertex over faces that share its position and
// face within 40°, so the round walls shade smooth and the edges stay sharp
function smoothShell(g) {
  const pos = g.attributes.position, n = g.attributes.normal, map = new Map(), key = i => `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
  for (let i = 0; i < pos.count; i++) { const k = key(i); if (!map.has(k)) map.set(k, []); map.get(k).push(i); }
  const out = new Float32Array(n.count * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), s = new THREE.Vector3();
  for (const list of map.values()) for (const i of list) {
    a.fromBufferAttribute(n, i); s.set(0, 0, 0);
    for (const j of list) { b.fromBufferAttribute(n, j); if (a.dot(b) > 0.76) s.add(b); }
    s.normalize(); out[i * 3] = s.x; out[i * 3 + 1] = s.y; out[i * 3 + 2] = s.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

// slab(shape, y0, h): a flat outline in (x, −z) extruded up local Y
export function slab(shape, y0, h, bevel = 0.6) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 48 });
  g.translate(0, 0, bevel);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}
// a canvas texture (w x h px) drawn by draw(g, w, h), sRGB, clamped
export function makeTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export const circle = (r, cx = 0, cy = 0, hole = true) => { const p = hole ? new THREE.Path() : new THREE.Shape(); p.absarc(cx, cy, r, 0, Math.PI * 2, hole); return p; };
// a hexagon bolt head about local Y
export const hex = (r, y0, h) => { const s = new THREE.Shape(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; i ? s.lineTo(r * Math.cos(a), r * Math.sin(a)) : s.moveTo(r, 0); } s.closePath(); return slab(s, y0, h, 0.4); };

// ── the builder ────────────────────────────────────────────────────────────
const Y = new THREE.Vector3(0, 1, 0);
export function frameQuat(u, e0) {
  const U = new THREE.Vector3(...u), E = new THREE.Vector3(...e0), Z = E.clone().cross(U);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(E, U, Z));
}
export function createBuild() {
  textures();
  const root = new THREE.Group();
  const parts = {}, pickables = [], owned = [];
  const B = { root, parts, pickables, alpha: 1, section: true };

  // o: { info, label, labelAt [x,y,z] in the part frame, explode [dx,dy,dz]
  // in the parent frame, st and en (the explode span where the part moves,
  // 0..1), cut, parent, u, e0, at }
  B.part = (id, o = {}) => {
    const holder = new THREE.Group(), r = new THREE.Group();
    holder.add(r); (o.parent || root).add(holder);
    if (o.at) r.position.set(...o.at);
    const q0 = frameQuat(o.u || [0, 1, 0], o.e0 || [1, 0, 0]);
    r.quaternion.copy(q0);
    const plane = o.cut ? [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)] : null;
    const p = { id, holder, root: r, q0, info: o.info || id, label: o.label || null, labelAt: o.labelAt || [0, 0, 0], labelWorld: !!o.labelWorld, explode: o.explode || [0, 0, 0], st: o.st || 0, en: o.en || 1, plane, world: !o.parent, mats: {}, hl: 0, spinQ: new THREE.Quaternion() };
    p.spin = th => { p.spinQ.setFromAxisAngle(Y, th); r.quaternion.copy(q0).multiply(p.spinQ); };
    parts[id] = p;
    if (plane) setPlanes(p);
    return p;
  };
  B.mat = (p, name) => p.mats[name] || (p.mats[name] = makeMat(name, p.plane));
  B.mesh = (p, geom, matName, o = {}) => {
    const m = new THREE.Mesh(geom, B.mat(p, matName));
    m.castShadow = o.shadow !== false; m.receiveShadow = true;
    m.userData.part = p.info;
    if (o.shadow === false) m.userData.noShadow = true;
    owned.push(geom);
    (o.parent || p.root).add(m);
    if (o.pick !== false) pickables.push(m);
    return m;
  };

  // the wedge: points with azimuth in (cutAz - cutHalf, cutAz + cutHalf)
  // are on the negative side of both planes, so they are clipped
  B.cutAz = 95; B.cutHalf = 62; B.section = false;
  const dirAz = (a, v) => v.set(Math.sin(a * Math.PI / 180), 0, Math.cos(a * Math.PI / 180));
  const setPlanes = q => {
    const [p1, p2] = q.plane;
    dirAz(B.cutAz - B.cutHalf + 90, p1.normal).negate(); dirAz(B.cutAz + B.cutHalf - 90, p2.normal).negate();
    p1.constant = p2.constant = B.section ? 0 : 1e5;
  };
  B.applyExplode = e => {
    for (const id in parts) {
      const q = parts[id], k = ease((e - q.st) / (q.en - q.st));
      q.holder.position.set(q.explode[0] * k, q.explode[1] * k, q.explode[2] * k);
    }
  };
  B.setSection = (on, az) => { B.section = on; if (az != null) B.cutAz = az; for (const id in parts) if (parts[id].plane) setPlanes(parts[id]); };
  // an engraved decal material for one part (tex from makeTex)
  B.decal = (p, key, tex, o = {}) => p.mats[key] || (p.mats[key] = (() => {
    const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, metalness: o.metalness ?? 0.2, roughness: o.roughness ?? 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    if (p.plane) { m.clippingPlanes = p.plane; m.clipIntersection = true; }
    m.userData.baseEmissive = m.emissive.clone(); m.userData.decal = true;
    return m;
  })());
  // a label sits at labelAt: a world offset from the part's explode place
  // (labelWorld), or a point of the part frame that ignores the part's spin
  const tmp = new THREE.Vector3(), tq = new THREE.Vector3();
  B.labelPoint = q => {
    if (q.labelWorld) return q.holder.getWorldPosition(tmp).add(tq.set(...q.labelAt));
    return q.holder.localToWorld(tmp.set(...q.labelAt).applyQuaternion(q.q0).add(q.root.position));
  };
  const GLOW = new THREE.Color(0xffc870);
  B.setHighlight = (p, v) => {
    for (const k in p.mats) {
      const m = p.mats[k];
      if (!m.emissive) continue;
      m.emissive.copy(m.userData.baseEmissive || new THREE.Color(0)).lerp(GLOW, v * 0.4);
    }
  };
  B.setAlpha = a => {
    const fade = a < 0.999;
    root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.userData.decal) { m.opacity = a; return; }
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
