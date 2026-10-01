// ============================================================================
//  WATCH MOVEMENT  ·  kit.js — the toolkit every movement scene builds with
// ────────────────────────────────────────────────────────────────────────────
//  createBuild() returns a builder B for one movement. A scene module
//  (scenes/<id>.js) calls B.layer, B.part and the shape helpers to make its
//  parts; main.js then poses, explodes, highlights, fades and disposes them
//  through the same builder. Units are millimetres; z is the watch axis
//  (out of the caseback), y points to 12 o'clock.
//
//  MATERIALS
//    Each part gets its own clone of each material it uses (B.add does the
//    swap), so one part can glow or fade without the others. Textures are
//    shared by every build and never disposed.
//
//  GREP MAP
//    function finishTextures .... Geneva stripes, perlage, grain, chain links
//    const MAT_DEF .............. the material templates by name
//    function createBuild ....... the builder
//      B.part / B.add ........... parts, explode lift and slide, labels
//      B.slab / B.cyl / B.ring .. extruded outlines, cylinders, rings
//      B.ribbon / B.path ........ springs (flat) and the fusee chain (3D)
//      B.screw .................. blued slotted screw
//      B.dialFace ............... enamel dial art (canvas) by style
//      B.hand ................... hand outlines by style
//      B.applyExplode / B.setHighlight / B.setAlpha / B.dispose
// ============================================================================
import * as THREE from 'three';
import * as G from './geom.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyFinish } from './wear.js';
const { TAU, D, pol } = G;
const COARSE = matchMedia('(pointer:coarse)').matches;

// ── finishes (roughness maps, in mm through the extrude caps' UVs) ─────────
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
let TEX = null;
function finishTextures() {
  if (TEX) return TEX;
  const geneva = canvasTex(256, (u, v) => {
    const xl = (u * 2 % 1) - 0.5, y = v * 2 % 1, r = Math.hypot(xl * 1.1, y + 0.9);
    return 0.36 + 0.07 * Math.sin(r * 70) + (Math.abs(xl) > 0.47 ? 0.1 : 0);
  }, 1 / 4.4);
  const perlage = canvasTex(256, (u, v) => {
    const s = 1 / 4, R = 0.36, ci = Math.floor(u / s), cj = Math.floor(v / s);
    let best = -1, val = 0.5;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const cx = (i + 0.5 + 0.5 * (j & 1)) * s, cy = (j + 0.5) * s, dx = u - cx, dy = v - cy, d = Math.hypot(dx, dy);
      if (d < R * s * 1.6 && j * 64 + i > best) { best = j * 64 + i; val = 0.44 + 0.05 * Math.sin(Math.atan2(dy, dx) * 22) + (d > R * s * 1.45 ? 0.12 : 0); }
    }
    return val;
  }, 1 / 4.4);
  const grain = canvasTex(512, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 18;
    return 0.42 + 0.12 * Math.sin(r * 55) + 0.06 * Math.sin(r * 13.0 + 1.7);
  }, 1 / 18, 0.5);
  // fusee chain: links along u, one link per 0.5 mm (repeat set per mesh)
  const links = canvasTex(128, (u, v) => {
    const x = (u * 2) % 1, y = v;
    const plate = Math.abs(y - 0.5) < 0.38 ? 1 : 0;
    const rivet = Math.hypot(x - 0.12, y - 0.5) < 0.1 || Math.hypot(x - 0.88, y - 0.5) < 0.1 ? 0.25 : 0;
    const gap = x > 0.47 && x < 0.53 ? 0.6 : 0;
    return plate ? 0.25 + rivet + gap : 0.9;
  }, 1);
  // wood: rings across u, light figure along v (a 40 mm tile)
  const wood = canvasTex(256, (u, v) => {
    const r = u * 22 + 0.6 * Math.sin(v * 6.3 + Math.sin(u * 9) * 1.5) + 0.25 * Math.sin(v * 31);
    return 0.5 + 0.28 * Math.sin(r * Math.PI * 2) * Math.sin(r * 1.7) + 0.06 * Math.sin(v * 80 + u * 13);
  }, 1 / 40);
  // leather: a fine pebble (roughness), 6 mm tile
  const leather = canvasTex(128, (u, v) => {
    let n = 0;
    for (const [f, a] of [[9, 0.5], [17, 0.3], [33, 0.2]]) n += a * Math.sin(u * f * 6.3 + Math.sin(v * f * 4.1) * 2) * Math.sin(v * f * 6.3 + Math.cos(u * f * 3.7) * 2);
    return 0.62 + 0.22 * n;
  }, 1 / 6);
  TEX = { geneva, perlage, grain, links, wood, leather };
  return TEX;
}

// physical: MeshPhysicalMaterial; finish: the shader decoration (wear.js).
// Gilt parts are lacquered (a clearcoat over the metal); satin steel is
// brushed, so its highlight stretches across the brushing (anisotropy).
const LACQUER = { physical: true, clearcoat: 0.55, clearcoatRoughness: 0.14 };
const MAT_DEF = {
  gilt: () => ({ ...LACQUER, color: 0xe8be72, metalness: 1, roughness: 0.3, finish: 'circular' }),
  giltPlate: () => ({ ...LACQUER, color: 0xe2b766, metalness: 1, roughness: 0.36, finish: 'perlage' }),
  giltBridge: () => ({ ...LACQUER, color: 0xe6bc6c, metalness: 1, roughness: 0.32, finish: 'geneva' }),
  brass: () => ({ ...LACQUER, color: 0xd9a95a, metalness: 1, roughness: 0.3, clearcoat: 0.35 }),
  rhodium: () => ({ physical: true, color: 0xc9ced7, metalness: 1, roughness: 0.3, finish: 'geneva' }),
  plate: () => ({ physical: true, color: 0xb4bac4, metalness: 1, roughness: 0.4, finish: 'perlage' }),
  steel: () => ({ physical: true, color: 0xe9ebf0, metalness: 1, roughness: 0.12 }),
  satin: () => ({ physical: true, color: 0xd6d9e0, metalness: 1, roughness: 0.3, anisotropy: 0.55, finish: 'brushed' }),
  blued: () => ({ physical: true, color: 0x2a4fc8, metalness: 1, roughness: 0.22, clearcoat: 0.3, clearcoatRoughness: 0.1 }),
  glucydur: () => ({ physical: true, color: 0xf2a878, metalness: 1, roughness: 0.24, finish: 'circular' }),
  gold: () => ({ physical: true, color: 0xf3c86a, metalness: 1, roughness: 0.14 }),
  darkRotor: () => ({ physical: true, color: 0x5b5f6a, metalness: 1, roughness: 0.3, finish: 'geneva' }),
  spring: () => ({ color: 0xb8c6e0, metalness: 1, roughness: 0.28, side: THREE.DoubleSide }),
  hair: () => ({ color: 0xdfe6f4, metalness: 1, roughness: 0.2, side: THREE.DoubleSide }),
  chain: () => ({ color: 0x8a90a0, metalness: 1, roughness: 0.35, roughnessMap: TEX.links, side: THREE.DoubleSide }),
  ruby: () => ({ physical: true, color: 0xb3102c, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.76, specularIntensity: 1, emissive: 0x3a0008 }),
  slot: () => ({ color: 0x06070c, roughness: 0.7 }),
  // case and clock materials
  polished: () => ({ physical: true, color: 0xe9ebf0, metalness: 1, roughness: 0.07 }),
  // glass: no transmission (that draws the whole scene a second time each
  // frame). Black, so it adds only its reflections; opacity is how much it
  // dims what is behind it (see makeMat)
  glass: () => ({ physical: true, glass: 0.06, color: 0x000000, metalness: 0, roughness: 0.015, ior: 1.6, specularIntensity: 1, envMapIntensity: 1.25 }),
  wood: () => ({ physical: true, color: 0x8a5a33, metalness: 0, roughness: 0.5, roughnessMap: TEX.wood, map: TEX.wood, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  leather: () => ({ physical: true, color: 0x5a3a24, metalness: 0, roughness: 0.62, sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0x806050, finish: 'leather' }),
  paint: () => ({ physical: true, color: 0xb02a2a, metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }),
  lume: () => ({ color: 0xe8f0d0, roughness: 0.6, emissive: 0x3a4a20 }),
  black: () => ({ physical: true, color: 0x15161a, metalness: 0.6, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.15 }),
  mesh: () => ({ physical: true, color: 0xd6d9e0, metalness: 1, roughness: 0.28, finish: 'weave' }),
  thread: () => ({ physical: true, color: 0xe6dcc6, metalness: 0, roughness: 0.8, sheen: 0.6, sheenRoughness: 0.5, sheenColor: 0xffffff }),
};
// how much a material shows wear when a build asks for it ([scratches,
// prints]); movement parts sit behind glass and show little
const WEAR = {
  polished: [0.85, 0.9], satin: [0.7, 0.6], gold: [0.6, 0.8], brass: [0.5, 0.6], steel: [0.35, 0.5], black: [0.7, 0.8], paint: [0.6, 0.6],
  wood: [0.5, 0.3], leather: [0.25, 0.2], glass: [0.45, 1.0], mesh: [0.4, 0.5], blued: [0.2, 0.2],
  rhodium: [0.1, 0.08], plate: [0.08, 0.05], gilt: [0.08, 0.04], giltPlate: [0.08, 0], giltBridge: [0.1, 0.05], glucydur: [0.1, 0],
};
let seedN = 0;
function makeMat(name, extra, wear = 0) {
  const def = { ...MAT_DEF[name](), ...(extra || {}) };
  for (const k of ['color', 'sheenColor', 'emissive']) if (typeof def[k] === 'string') def[k] = new THREE.Color(def[k]);
  const physical = def.physical, finish = def.finish, glass = def.glass; delete def.physical; delete def.finish; delete def.glass;
  const m = physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);
  // glass blends as premultiplied: its reflections add in full, and the
  // scene behind it dims by the opacity
  if (glass) Object.assign(m, { transparent: true, opacity: glass, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, userData: { glass } });
  const w = WEAR[name] || [0, 0];
  return applyFinish(m, { finish, wear: w[0] * wear, prints: w[1] * wear, seed: (seedN++ % 97) * 0.173 });
}

const v2 = p => new THREE.Vector2(p[0], p[1]);
export function shapeOf(outline, holes = []) {
  const s = new THREE.Shape(outline.map(v2));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(v2)));
  return s;
}
// a circle with at least enough sides for its size (no visible facets)
const sidesFor = r => Math.max(48, Math.min(360, Math.round(r * 18)));
export const circ = (r, n = 48, c = [0, 0]) => G.circlePoly(r, Math.max(n, sidesFor(r)), c);
export const hole = (r, n = 32, c = [0, 0]) => G.circlePoly(r, Math.max(n, sidesFor(r)), c).reverse();
export const bevelFor = m => Math.min(0.025, m * 0.12);

// A bevel step can be smaller than the crease angle (3 segments make 30
// degree steps). Then toCreasedNormals smooths the flat cap into the bevel,
// and the rim normals of the cap tilt by up to 17 degrees. The cap is a few
// long triangles, so the tilt spreads across the plate as diagonal light
// streaks. flattenCaps gives each cap triangle (face normal on +z or -z)
// its true normal again. The bevel keeps its smooth normals.
// The geometry is non-indexed, so each triangle has its own 3 normals.
function flattenCaps(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let t = 0; t < p.length; t += 9) {
    const ux = p[t + 3] - p[t], uy = p[t + 4] - p[t + 1], uz = p[t + 5] - p[t + 2];
    const vx = p[t + 6] - p[t], vy = p[t + 7] - p[t + 1], vz = p[t + 8] - p[t + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const L = Math.hypot(fx, fy, fz);
    if (!L || Math.abs(fz) < L * 0.9999) continue;
    const s = Math.sign(fz);
    for (let k = 0; k < 9; k += 3) { n[t + k] = 0; n[t + k + 1] = 0; n[t + k + 2] = s; }
  }
  g.attributes.normal.needsUpdate = true;
}

// ── the builder ─────────────────────────────────────────────────────────────
// opts.palette: { materialName: { color, roughness, metalness, ... } }
// overrides the templates for this build only (the randomizer's finishes)
export function createBuild(opts = {}) {
  finishTextures();
  const palette = opts.palette || {};
  const root = new THREE.Group();
  const layers = {}, layerK = {}, parts = {}, pickables = [], owned = [];
  const B = { root, layers, parts, pickables, alpha: 1 };

  B.layer = (name, k) => { const g = new THREE.Group(); root.add(g); layers[name] = g; layerK[name] = k; return g; };

  // a part: a group at (x, y) inside a layer. lift adds explode height in
  // layer units; slide moves it in the plane (mm at full explode).
  B.part = (id, layer, at = [0, 0], o = {}) => {
    const r = new THREE.Group(); r.position.set(at[0], at[1], 0);
    const holder = new THREE.Group(); holder.add(r);
    (o.parent ? o.parent.root : layers[layer]).add(holder);
    const p = { id, layer, root: r, holder, at, lift: o.lift || 0, slide: o.slide || null, label: o.label || null, labelZ: o.labelZ ?? 0, labelAt: o.labelAt || null, info: o.info || id, mats: {}, hl: 0, hlTarget: 0 };
    parts[id] = p;
    return p;
  };
  B.matFor = (p, name) => {
    if (!p.mats[name]) { const m = makeMat(name, palette[name], opts.wear || 0); m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null; p.mats[name] = m; }
    return p.mats[name];
  };
  B.add = (p, ...ms) => {
    for (const m of ms) {
      m.traverse(o => {
        if (!o.isMesh) return;
        if (o.userData.matName) o.material = B.matFor(p, o.userData.matName);
        if (o.userData.dialMat) { p.mats.__dial = o.userData.dialMat; o.userData.dialMat.userData.baseEmissive = o.userData.dialMat.emissive.clone(); }
        o.userData.part = p.info;
        o.castShadow = !o.userData.noShadow && !o.material?.userData.glass; o.receiveShadow = true;
        pickables.push(o);
      });
      p.root.add(m);
    }
    return p;
  };
  const mesh = (geo, matName) => {
    const m = new THREE.Mesh(geo, null); m.userData.matName = matName; owned.push(geo); return m;
  };
  B.mesh = mesh;
  // an outline extruded from z0 to z1, with a small bevel to catch the light
  B.slab = (outline, holes, z0, z1, matName, bev = 0.025) => {
    const b = Math.min(bev, (z1 - z0) * 0.3);
    const g = new THREE.ExtrudeGeometry(shapeOf(outline, holes || []), {
      depth: Math.max(0.005, z1 - z0 - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: b > 0.04 ? 3 : 2, curveSegments: 6,
    });
    g.translate(0, 0, z0 + b);
    // smooth normals across the many small side faces of a curved outline;
    // corners sharper than 35 degrees stay sharp
    const sm = toCreasedNormals(g, 35 * Math.PI / 180); g.dispose();
    flattenCaps(sm);
    return mesh(sm, matName);
  };
  B.cyl = (r, z0, z1, matName, seg = 28, r1 = r) => {
    const g = new THREE.CylinderGeometry(r1, r, z1 - z0, Math.max(seg, Math.min(96, Math.round(r * 24))));
    g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2);
    return mesh(g, matName);
  };
  B.ring = (r0, r1, z0, z1, matName, c = [0, 0]) => B.slab(circ(r1, 72, c), [hole(r0, 48, c)], z0, z1, matName);
  B.jewel = (at, z, r = 0.55) => B.slab(circ(r, 28, at), [hole(r * 0.22, 12, at)], z - 0.05, z + 0.07, 'ruby', 0.02);

  // a flat ribbon of n points: fn(s) -> [x, y]; the ribbon spans z0..z1
  B.ribbon = (n, z0, z1, matName) => {
    const pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const m = mesh(g, matName); m.frustumCulled = false;
    m.userData.update = fn => {
      let px = 0, py = 0;
      for (let i = 0; i < n; i++) {
        const [x, y] = fn(i / (n - 1));
        let tx, ty;
        if (i < n - 1) { const q = fn((i + 1) / (n - 1)); tx = q[0] - x; ty = q[1] - y; } else { tx = x - px; ty = y - py; }
        const tl = Math.hypot(tx, ty) || 1, ox = ty / tl, oy = -tx / tl, k = i * 6;
        pos[k] = pos[k + 3] = x; pos[k + 1] = pos[k + 4] = y; pos[k + 2] = z0; pos[k + 5] = z1;
        nor[k] = nor[k + 3] = ox; nor[k + 1] = nor[k + 4] = oy; nor[k + 2] = nor[k + 5] = 0;
        px = x; py = y;
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
      g.computeBoundingSphere();
    };
    return m;
  };
  // a 3D strip along a path: fn(s) -> [x, y, z]; width w across, normal to
  // both the tangent and the watch axis (a chain standing on edge)
  B.path = (n, w, matName, uvLen = 1) => {
    const pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const m = mesh(g, matName); m.frustumCulled = false;
    m.userData.update = (fn, uOffset = 0) => {
      let acc = 0, prev = null;
      for (let i = 0; i < n; i++) {
        const p = fn(i / (n - 1)), q = fn(Math.min(1, (i + 1) / (n - 1))), o = i === n - 1 ? fn((i - 1) / (n - 1)) : null;
        let tx = q[0] - p[0], ty = q[1] - p[1];
        if (o) { tx = p[0] - o[0]; ty = p[1] - o[1]; }
        const tl = Math.hypot(tx, ty) || 1, ox = ty / tl, oy = -tx / tl, k = i * 6;
        if (prev) acc += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
        prev = p;
        pos[k] = pos[k + 3] = p[0]; pos[k + 1] = pos[k + 4] = p[1]; pos[k + 2] = p[2] - w / 2; pos[k + 5] = p[2] + w / 2;
        nor[k] = nor[k + 3] = ox; nor[k + 1] = nor[k + 4] = oy; nor[k + 2] = nor[k + 5] = 0;
        uv[i * 4] = uv[i * 4 + 2] = (acc + uOffset) / uvLen; uv[i * 4 + 1] = 0; uv[i * 4 + 3] = 1;
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.uv.needsUpdate = true;
      g.computeBoundingSphere();
    };
    return m;
  };

  // a blued slotted screw head at (x, y), seated at z
  B.screw = (p, at, z, r = 0.62) => {
    const head = B.cyl(r, z, z + 0.36, 'blued', 28); head.position.set(at[0], at[1], 0);
    const slot = mesh(new THREE.BoxGeometry(r * 2.05, 0.13, 0.14), 'slot');
    slot.position.set(at[0], at[1], z + 0.32); slot.rotation.z = (at[0] * 7.1 + at[1] * 3.3) % TAU;
    slot.userData.noShadow = true;
    B.add(p, head, slot);
  };

  // hands, built pointing to 12 (+y), as lists of [outline, holes]
  B.hand = (style, len, w) => {
    if (typeof style === 'function') return style(len, w);   // a style defined by the caller
    if (style === 'breguet') {
      const pomme = len * 0.73;
      return [[[[-w * 0.6, -len * 0.18], [w * 0.6, -len * 0.18], [w * 0.5, pomme - 0.9], [-w * 0.5, pomme - 0.9]], []],
        [[[-w * 0.45, pomme + 0.5], [w * 0.45, pomme + 0.5], [0, len]], []],
        [circ(0.95, 36, [0, pomme]), [hole(0.62, 36, [0, pomme])]]];
    }
    if (style === 'dauphine') return [[[[0, -len * 0.16], [w, len * 0.12], [0, len], [-w, len * 0.12]], []]];
    if (style === 'baton') return [[[[-w / 2, -len * 0.15], [w / 2, -len * 0.15], [w / 2, len], [-w / 2, len]], []]];
    if (style === 'needle') return [[[[-w / 2, -len * 0.3], [w / 2, -len * 0.3], [w * 0.25, len], [-w * 0.25, len]], []]];
    if (style === 'beetle') {          // the English beetle: a pierced body under a short tip
      const body = [], b = len * 0.62;
      for (let i = 0; i <= 40; i++) { const a = i / 40 * TAU; body.push([Math.sin(a) * 1.6, b + Math.cos(a) * 1.25]); }
      return [[[[-0.22, 0], [0.22, 0], [0.16, b - 1.2], [-0.16, b - 1.2]], []],
        [body.reverse(), [hole(0.5, 20, [-0.62, b + 0.1]), hole(0.5, 20, [0.62, b + 0.1]), hole(0.32, 16, [0, b - 0.55])]],
        [[[-0.35, b + 1.1], [0.35, b + 1.1], [0, len]], []]];
    }
    if (style === 'leaf') {                       // a slim leaf, widest at 60%
      const out = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24, y = -len * 0.12 + t * len * 1.12; out.push([w * 1.1 * Math.sin(Math.PI * Math.pow(t, 0.9)), y]); }
      for (let i = 24; i >= 0; i--) { const t = i / 24, y = -len * 0.12 + t * len * 1.12; out.push([-w * 1.1 * Math.sin(Math.PI * Math.pow(t, 0.9)), y]); }
      return [[out, []]];
    }
    if (style === 'spade') {                      // a bar with a teardrop spade near the tip
      const b = len * 0.7, sp = [];
      for (let i = 0; i <= 20; i++) { const a = Math.PI + Math.PI * i / 20; sp.push([Math.cos(a) * w * 2.2, b + Math.sin(a) * w * 1.8]); }
      sp.push([0, b + w * 5.2]);
      return [[[[-w / 2, -len * 0.15], [w / 2, -len * 0.15], [w / 2, b], [-w / 2, b]], []], [sp, []], [[[-w * 0.3, b + w * 5], [w * 0.3, b + w * 5], [0, len]], []]];
    }
    if (style === 'sword') return [[[[-w * 0.7, -len * 0.14], [w * 0.7, -len * 0.14], [w * 0.9, len * 0.82], [0, len], [-w * 0.9, len * 0.82]], []]];
    if (style === 'cathedral') {                  // a pierced, gothic window near the tip
      const b = len * 0.55;
      return [[[[-w * 0.5, -len * 0.15], [w * 0.5, -len * 0.15], [w * 0.4, b], [-w * 0.4, b]], []],
        [[[-w * 2.2, b], [w * 2.2, b], [w * 1.6, len * 0.85], [0, len], [-w * 1.6, len * 0.85]], [hole(w * 0.7, 16, [-w * 0.85, b + len * 0.12]), hole(w * 0.7, 16, [w * 0.85, b + len * 0.12]), hole(w * 0.6, 16, [0, len * 0.8])]]];
    }
    if (style === 'poker') return [[[[-0.24, -len * 0.12], [0.24, -len * 0.12], [0.12, len], [-0.12, len]], []]];
    return [];
  };

  // the enamel dial face at z (facing -z), with a canvas painted by style
  B.dialFace = (R, z, holes, paint) => {
    const N = COARSE ? 1024 : 2048, cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d'), s = N / (2 * R);
    g.translate(N / 2, N / 2); g.scale(s, s);
    // The painters work in mm, so a dial font is about 1 unit tall. At that
    // size some browsers (Chrome on Android) round each glyph advance to a
    // whole unit and the letters spread apart ("STELLA N OVA"). This proxy
    // sets every font TEXT_K times larger and draws the text scaled down by
    // TEXT_K, so the layout runs at a normal size.
    const TEXT_K = 64;
    const tg = new Proxy(g, {
      get(t, k) {
        if (k === 'fillText') return (str, x, y) => { t.save(); t.translate(x, y); t.scale(1 / TEXT_K, 1 / TEXT_K); t.fillText(str, 0, 0); t.restore(); };
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) { t[k] = k === 'font' ? String(v).replace(/([\d.]+)px/, (m, n) => `${+n * TEXT_K}px`) : v; return true; },
    });
    paint(tg, R);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.repeat.set(1 / (2 * R), 1 / (2 * R)); t.offset.set(0.5, 0.5);
    owned.push(t);
    const geo = new THREE.ShapeGeometry(shapeOf(circ(R, 180), holes.map(h => h.map(([x, y]) => [-x, y]))), 8);
    geo.rotateY(Math.PI); geo.translate(0, 0, z);
    const m = new THREE.Mesh(geo, null);
    owned.push(geo);
    m.userData.matName = null;
    m.userData.dialMat = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.4, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 });
    m.material = m.userData.dialMat;
    m.userData.noShadow = true;
    return m;
  };

  // drop a part from view and from picking (it stays in parts for poses)
  B.hidePart = id => {
    const q = parts[id]; if (!q) return;
    q.holder.visible = false; q.removed = true;
    const gone = new Set(); q.holder.traverse(o => gone.add(o));
    for (let i = pickables.length - 1; i >= 0; i--) if (gone.has(pickables[i])) pickables.splice(i, 1);
  };

  // ── per-frame and lifetime ───────────────────────────────────────────────
  const tmp = new THREE.Vector3();
  B.applyExplode = (e, unit) => {
    for (const k in layers) layers[k].position.z = e * unit * layerK[k];
    for (const id in parts) {
      const q = parts[id];
      q.holder.position.z = e * unit * q.lift;
      if (q.slide) { q.holder.position.x = e * q.slide[0]; q.holder.position.y = e * q.slide[1]; }
    }
  };
  B.labelPoint = q => q.holder.localToWorld(tmp.set(...(q.labelAt || q.at), q.labelZ));
  const GLOW = new THREE.Color(0xffc870);
  B.setHighlight = (p, v) => {
    for (const k in p.mats) {
      const m = p.mats[k];
      if (!m.emissive) continue;
      m.emissive.copy(m.userData.baseEmissive || new THREE.Color(0)).lerp(GLOW, v * 0.42);
    }
  };
  B.setAlpha = a => {
    const fade = a < 0.999;
    root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      // glass is always blended and casts no shadow; while fading, normal
      // blending lets its reflections fade with the rest
      if (m.userData.glass) { m.opacity = m.userData.glass * a; m.blending = fade ? THREE.NormalBlending : THREE.CustomBlending; return; }
      if (m.transparent !== fade) { m.transparent = fade; m.depthWrite = !fade || a > 0.5; m.needsUpdate = true; }
      m.opacity = a;
      o.castShadow = !fade && !o.userData.noShadow;
    });
    B.alpha = a;
  };
  B.dispose = () => {
    root.removeFromParent();
    for (const o of owned) o.dispose();
    for (const id in parts) for (const k in parts[id].mats) parts[id].mats[k].dispose();
    root.traverse(o => { if (o.isMesh && o.userData.dialMat) o.userData.dialMat.dispose(); });
  };
  return B;
}
