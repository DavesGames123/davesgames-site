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
  TEX = { geneva, perlage, grain, links };
  return TEX;
}

const MAT_DEF = {
  gilt: () => ({ color: 0xe8be72, metalness: 1, roughness: 0.32, roughnessMap: TEX.grain }),
  giltPlate: () => ({ color: 0xe2b766, metalness: 1, roughness: 0.4, roughnessMap: TEX.perlage }),
  giltBridge: () => ({ color: 0xe6bc6c, metalness: 1, roughness: 0.36, roughnessMap: TEX.geneva }),
  brass: () => ({ color: 0xd9a95a, metalness: 1, roughness: 0.36 }),
  rhodium: () => ({ color: 0xc4c9d2, metalness: 1, roughness: 0.38, roughnessMap: TEX.geneva }),
  plate: () => ({ color: 0xaab0bb, metalness: 1, roughness: 0.48, roughnessMap: TEX.perlage }),
  steel: () => ({ color: 0xe9ebf0, metalness: 1, roughness: 0.14 }),
  satin: () => ({ color: 0xd6d9e0, metalness: 1, roughness: 0.3, roughnessMap: TEX.grain }),
  blued: () => ({ color: 0x2a4fc8, metalness: 1, roughness: 0.26 }),
  glucydur: () => ({ color: 0xf2a878, metalness: 1, roughness: 0.24 }),
  gold: () => ({ color: 0xf3c86a, metalness: 1, roughness: 0.18, roughnessMap: TEX.grain }),
  darkRotor: () => ({ color: 0x5b5f6a, metalness: 1, roughness: 0.3, roughnessMap: TEX.geneva }),
  spring: () => ({ color: 0xb8c6e0, metalness: 1, roughness: 0.28, side: THREE.DoubleSide }),
  hair: () => ({ color: 0xdfe6f4, metalness: 1, roughness: 0.2, side: THREE.DoubleSide }),
  chain: () => ({ color: 0x8a90a0, metalness: 1, roughness: 0.35, roughnessMap: TEX.links, side: THREE.DoubleSide }),
  ruby: () => ({ physical: true, color: 0xb3102c, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, ior: 1.76, specularIntensity: 1, emissive: 0x3a0008 }),
  slot: () => ({ color: 0x06070c, roughness: 0.7 }),
};
function makeMat(name, extra) {
  const def = { ...MAT_DEF[name](), ...(extra || {}) };
  const physical = def.physical; delete def.physical;
  return physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);
}

const v2 = p => new THREE.Vector2(p[0], p[1]);
export function shapeOf(outline, holes = []) {
  const s = new THREE.Shape(outline.map(v2));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(v2)));
  return s;
}
export const circ = (r, n = 48, c = [0, 0]) => G.circlePoly(r, n, c);
export const hole = (r, n = 32, c = [0, 0]) => G.circlePoly(r, n, c).reverse();
export const bevelFor = m => Math.min(0.025, m * 0.12);

// ── the builder ─────────────────────────────────────────────────────────────
export function createBuild() {
  finishTextures();
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
    if (!p.mats[name]) { const m = makeMat(name); m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null; p.mats[name] = m; }
    return p.mats[name];
  };
  B.add = (p, ...ms) => {
    for (const m of ms) {
      m.traverse(o => {
        if (!o.isMesh) return;
        if (o.userData.matName) o.material = B.matFor(p, o.userData.matName);
        if (o.userData.dialMat) { p.mats.__dial = o.userData.dialMat; o.userData.dialMat.userData.baseEmissive = o.userData.dialMat.emissive.clone(); }
        o.userData.part = p.info;
        o.castShadow = o.userData.noShadow ? false : true; o.receiveShadow = true;
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
      depth: Math.max(0.005, z1 - z0 - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 6,
    });
    g.translate(0, 0, z0 + b);
    return mesh(g, matName);
  };
  B.cyl = (r, z0, z1, matName, seg = 28, r1 = r) => {
    const g = new THREE.CylinderGeometry(r1, r, z1 - z0, seg);
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
    if (style === 'poker') return [[[[-0.24, -len * 0.12], [0.24, -len * 0.12], [0.12, len], [-0.12, len]], []]];
    return [];
  };

  // the enamel dial face at z (facing -z), with a canvas painted by style
  B.dialFace = (R, z, holes, paint) => {
    const N = COARSE ? 1024 : 2048, cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d'), s = N / (2 * R);
    g.translate(N / 2, N / 2); g.scale(s, s);
    paint(g, R);
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
