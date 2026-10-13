// ============================================================================
//  BREADBOARD LAB  ·  parts/models/kit.js — the model building kit
// ----------------------------------------------------------------------------
//  Every part model is built with one kit. The kit takes THREE as an argument
//  (it never imports three), so models build in node and in the page alike.
//
//  STATIC GEOMETRY MERGES PER SLOT. `put` bakes a transform into a geometry
//  and queues it under a material slot. `finish` merges each queue into one
//  mesh, so a DIP-16 is four draw calls (body, legs, marks, label), not
//  twenty. Parts that move (a knob, a shaft, a button cap, a lens that glows)
//  use `mesh`, which keeps them separate.
//
//  A LENS THAT GLOWS OWNS ITS MATERIAL. Cached materials are shared by every
//  part, so `glow` clones the slot material once for that mesh. setLook on
//  the slot clones the new material again. dispose frees only owned things.
//
//  FIXED DETAILS MERGE. Bits drawn in a fixed preset ('@board-hole', '@tin')
//  join one vertex-coloured mesh (plus one for metal bits), not one mesh per
//  preset. So a part stays at 2..5 draw calls; 60 parts fit the view budget.
//
//  DAMAGE IS A LOOK. setDamage('burnt'|'vented'|'blown') puts the char preset
//  on every slot that is not metal and darkens glows; null puts the slot
//  materials back. A model may add its own reaction (`onDamage`).
//
//  GREP MAP
//    createKit .............. K = createKit(THREE, def, part, ctx)
//    K.put / K.mesh ......... static (merged) vs dynamic meshes
//    K.rbox / K.cyl / K.box . geometry makers (rounded box is an extrusion)
//    K.lead / K.leg ......... wire leads along a polyline, straight pins
//    K.label ................ a printed text quad (null in node)
//    K.glow / K.setGlow ..... emissive lenses and halo sprites
//    K.finish ............... merge, pins, the PartHandle (setLook, setDamage, dispose)
//    mergeGeometries ........ indexed merge of position, normal, uv (+ colour)
//    detailMaterials ........ the shared vertex-colour detail materials
//    haloTexture ............ the radial glow sprite (DataTexture, cached)
//    countTriangles ......... used by the tests and the budget readout
// ============================================================================
import { G, resolveParams, pinGrid } from '../schema.js';
import { makeMaterial, presetById } from '../materials.js';
import { labelPlane } from '../labels.js';
import { sweepArrays } from '../wire.js';

const METAL_SLOTS = new Set(['legs', 'pins', 'metal', 'terminal', 'shaft', 'contacts', 'tab', 'gold']);

// colors: optional THREE.Color per geometry -> a vertex colour attribute
export function mergeGeometries(THREE, geoms, colors = null) {
  let nv = 0, ni = 0;
  for (const g of geoms) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = colors ? new Float32Array(nv * 3) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      pos[(vo + i) * 3] = P.getX(i); pos[(vo + i) * 3 + 1] = P.getY(i); pos[(vo + i) * 3 + 2] = P.getZ(i);
      if (N) { nrm[(vo + i) * 3] = N.getX(i); nrm[(vo + i) * 3 + 1] = N.getY(i); nrm[(vo + i) * 3 + 2] = N.getZ(i); }
      if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
    }
    if (col) { const c = colors[geoms.indexOf(g)]; for (let i = 0; i < P.count; i++) { col[(vo + i) * 3] = c.r; col[(vo + i) * 3 + 1] = c.g; col[(vo + i) * 3 + 2] = c.b; } }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = i + vo;
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

export function countTriangles(object) {
  let n = 0;
  object.traverse(o => {
    if (o.isSprite) { n += 2; return; }
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const t = (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3;
    n += t * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(n);
}

const halos = new WeakMap();
export function haloTexture(THREE) {
  let t = halos.get(THREE);
  if (t) return t;
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 2.2) * (0.6 + 0.4 * Math.exp(-r * r * 30));
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
  }
  t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  halos.set(THREE, t);
  return t;
}

// Small fixed-colour details ('@preset' queues) of a part merge into at most
// two meshes, with the preset colours as vertex colours: one dielectric, one
// metal. That keeps a part at 2..5 draw calls.
const detailMats = new WeakMap();
export function detailMaterials(THREE) {
  let d = detailMats.get(THREE);
  if (!d) {
    d = {
      plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 1 }),
    };
    d.plain.name = 'detail-plain'; d.metal.name = 'detail-metal';
    detailMats.set(THREE, d);
  }
  return d;
}

const charMats = new WeakMap();
function charMaterial(THREE) {
  let m = charMats.get(THREE);
  if (!m) { m = makeMaterial(THREE, presetById('char')); charMats.set(THREE, m); }
  return m;
}

export function createKit(THREE, def, part, ctx = {}) {
  const quality = ctx.quality === 'low' ? 'low' : 'high';
  const q = quality === 'low' ? 0.5 : 1;
  const params = resolveParams(def, part && part.params);
  const looks = (part && part.looks) || {};
  const matOf = ctx.materials || (id => makeMaterial(THREE, presetById(id) || presetById('abs-grey')));
  const group = new THREE.Group();
  group.name = def.id;
  const queues = new Map();           // slot -> geometry[]
  const slots = {};                    // slot -> mesh[]
  const pickables = [];
  const owned = { geoms: new Set(), mats: new Set(), textures: new Set() };
  const glows = [];                    // { mesh, color, halo, base }
  const base = {};                     // slot -> material
  let damage = null;
  let stateFn = null, damageFn = null, paramsFn = null;

  const slotDefault = key => {
    const s = (def.slots || []).find(x => x.key === key);
    return s ? s.default : key;
  };
  // the material of a slot: the part's look, else `prefer` (a colour param
  // such as the LED colour), else the slot default. '@id' is a fixed preset
  // that is not a slot (hole black, a red post ring).
  function mat(slot, prefer) {
    if (slot[0] === '@') return matOf(slot.slice(1));
    if (!base[slot]) base[slot] = matOf(looks[slot] || prefer || slotDefault(slot));
    return base[slot];
  }
  const seg = n => Math.max(4, Math.round(n * q));
  // pins in part-local mm (rot 0): [{ name, x, z, y }]
  const pinsMm = (def.pins || []).map(p => { const g = pinGrid(def, p, params); return { name: p.name, x: g.x * G, z: g.z * G, y: p.y || 0 }; });

  function xform(geom, t = {}) {
    if (t.sx || t.sy || t.sz) geom.scale(t.sx || 1, t.sy || 1, t.sz || 1);
    if (t.rx) geom.rotateX(t.rx);
    if (t.rz) geom.rotateZ(t.rz);
    if (t.ry) geom.rotateY(t.ry);
    geom.translate(t.x || 0, t.y || 0, t.z || 0);
    return geom;
  }
  function put(geom, slot, t) {
    xform(geom, t);
    if (!queues.has(slot)) queues.set(slot, []);
    queues.get(slot).push(geom);
  }
  function register(mesh, slot, pick = true) {
    if (slot && slot[0] !== '@') { (slots[slot] || (slots[slot] = [])).push(mesh); mesh.userData.slot = slot; }
    if (pick) pickables.push(mesh);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (mesh.geometry) owned.geoms.add(mesh.geometry);
    return mesh;
  }
  // a separate mesh; `parent` may be a pivot group. Scale and rotation bake
  // into the geometry; the translation goes on mesh.position, so a model can
  // move the mesh later (a cap that presses, a lever that slides).
  function mesh(geom, slot, t, opts = {}) {
    if (t) xform(geom, { ...t, x: 0, y: 0, z: 0 });
    const m = new THREE.Mesh(geom, slot ? mat(slot) : opts.material);
    if (t) m.position.set(t.x || 0, t.y || 0, t.z || 0);
    if (opts.material) { m.material = opts.material; if (opts.own) owned.mats.add(opts.material); }
    (opts.parent || group).add(m);
    return register(m, slot, opts.pick !== false);
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, n = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg(n), 1, open);
  const sphere = (r, n = 16, m = 12, thetaLen = Math.PI) => new THREE.SphereGeometry(r, seg(n), Math.max(3, seg(m)), 0, Math.PI * 2, 0, thetaLen);
  // rounded-corner box: w (x) by d (z), height h, base at y = 0, centred in x and z
  function rbox(w, h, d, r = 1, n = 3) {
    const rr = Math.max(0.01, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
    const s = new THREE.Shape();
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    s.moveTo(x0 + rr, y0);
    s.lineTo(x1 - rr, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rr);
    s.lineTo(x1, y1 - rr); s.quadraticCurveTo(x1, y1, x1 - rr, y1);
    s.lineTo(x0 + rr, y1); s.quadraticCurveTo(x0, y1, x0, y1 - rr);
    s.lineTo(x0, y0 + rr); s.quadraticCurveTo(x0, y0, x0 + rr, y0);
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: Math.max(1, Math.round(n * q)) });
    g.rotateX(-Math.PI / 2);          // extrusion (+Z) becomes +Y; the shape is symmetric in z
    return g;
  }
  // a lead (round wire) along a polyline [[x,y,z],...]
  function leadGeom(points, r = 0.25, n = 6) {
    const a = sweepArrays(points, r, Math.max(4, Math.round(n * q)));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(a.pos.length / 3 * 2).fill(0), 2));
    g.setIndex(a.idx);
    return g;
  }
  function lead(points, slot = 'legs', r = 0.25) { put(leadGeom(points, r), slot); }
  // a straight square pin from y0 to y1 at (x, z)
  function leg(x, z, y1, slot = 'legs', w = 0.5, y0 = -2.5) {
    put(box(w, y1 - y0, w), slot, { x, y: (y0 + y1) / 2, z });
  }
  function label(lines, w, d, t = {}, opts = {}) {
    if (ctx.labels === false) return null;
    const m = labelPlane(THREE, lines, w, d, opts);
    if (!m) return null;
    xform(m.geometry, t);
    (opts.parent || group).add(m);
    owned.geoms.add(m.geometry); owned.mats.add(m.material);
    if (m.material.map) owned.textures.add(m.material.map);
    return m;
  }
  // an emissive mesh: owns a clone of its slot material
  function glow(m, color, haloSize = 0, haloPos = null) {
    const own = m.material.clone();
    own.emissive = new THREE.Color(color);
    own.emissiveIntensity = 0;
    m.material = own; owned.mats.add(own);
    m.userData.glow = true;
    const gl = { mesh: m, color, halo: null, b: 0 };
    if (haloSize > 0) {
      const sm = new THREE.SpriteMaterial({ map: haloTexture(THREE), color: new THREE.Color(color), transparent: true,
        opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const sp = new THREE.Sprite(sm);
      sp.scale.set(haloSize, haloSize, 1);
      if (haloPos) sp.position.set(haloPos[0], haloPos[1], haloPos[2]);
      sp.visible = false;
      sp.renderOrder = 3;
      sp.userData.halo = true;
      (m.parent || group).add(sp);
      owned.mats.add(sm);
      gl.halo = sp;
    }
    glows.push(gl);
    return gl;
  }
  // b: 0..1.5 (1 = rated current)
  function setGlow(gl, b, color) {
    const v = damage ? 0 : Math.max(0, Math.min(2, b || 0));
    gl.b = v;
    if (color) { gl.color = color; gl.mesh.material.emissive.set(color); if (gl.halo) gl.halo.material.color.set(color); }
    gl.mesh.material.emissiveIntensity = v * 2.2;
    if (gl.halo) {
      gl.halo.visible = v > 0.02;
      gl.halo.material.opacity = Math.min(1, v * 0.85);
      const s = gl.halo.userData.s0 || (gl.halo.userData.s0 = gl.halo.scale.x);
      gl.halo.scale.setScalar(s * (0.6 + 0.5 * Math.min(1.5, v)));
    }
  }

  function pinsOut() {
    const mounted = def.mount !== 'free';
    return (def.pins || []).map(p => {
      const g = pinGrid(def, p, params);
      const y = mounted && !(part && part.place && part.place.on === null && def.mount === 'either') ? 0 : (p.y || 0);
      return { name: p.name, local: new THREE.Vector3(g.x * G, def.mount === 'free' ? (p.y || 0) : y, g.z * G) };
    });
  }

  function finish(extra = {}) {
    // fixed-colour details: one merged mesh per kind (plain, metal)
    const det = { plain: { g: [], c: [] }, metal: { g: [], c: [] } };
    for (const [slot, list] of queues) {
      if (slot[0] !== '@' || !list.length) continue;
      const spec = presetById(slot.slice(1)) || presetById('abs-grey');
      const kind = spec.metalness >= 0.5 ? 'metal' : 'plain';
      for (const g of list) { det[kind].g.push(g); det[kind].c.push(new THREE.Color(spec.color)); }
      queues.delete(slot);
    }
    const uniform = matOf('abs-red') === matOf('abs-blue');      // a ghost: one material for all
    for (const kind of ['plain', 'metal']) {
      const { g: list, c } = det[kind];
      if (!list.length) continue;
      const g = mergeGeometries(THREE, list, c);
      list.forEach(x => x.dispose());
      const m = new THREE.Mesh(g, uniform ? matOf('abs-grey') : detailMaterials(THREE)[kind]);
      m.name = def.id + ':detail-' + kind;
      m.userData.noChar = kind === 'metal';
      group.add(m);
      register(m, null, true);
    }
    for (const [slot, list] of queues) {
      if (!list.length) continue;
      const g = list.length === 1 ? list[0] : mergeGeometries(THREE, list);
      if (list.length > 1) list.forEach(x => x.dispose());
      const m = new THREE.Mesh(g, mat(slot));
      m.name = def.id + ':' + slot;
      group.add(m);
      register(m, slot, true);
    }
    queues.clear();
    const handle = {
      object: group,
      pins: pinsOut(),
      pickables,
      slots,
      params,
      setLook(slotKey, material) {
        if (!material) return;
        base[slotKey] = material;
        for (const m of slots[slotKey] || []) {
          if (m.userData.glow) {
            const gl = glows.find(x => x.mesh === m);
            const own = material.clone();
            own.emissive = new THREE.Color(gl ? gl.color : '#000000');
            own.emissiveIntensity = m.material.emissiveIntensity;
            owned.mats.delete(m.material); m.material.dispose();
            m.material = own; owned.mats.add(own);
          } else if (!damage || METAL_SLOTS.has(slotKey)) m.material = material;
        }
      },
      setState(frame, dt) {
        if (stateFn) { try { stateFn(frame, dt || 0); } catch (e) { if (ctx.debug) throw e; } }
      },
      setParams(p) {
        Object.assign(params, resolveParams(def, { ...params, ...p }));
        if (paramsFn) paramsFn(params);
      },
      setDamage(kind) {
        damage = kind || null;
        const ch = charMaterial(THREE);
        for (const key in slots) {
          if (METAL_SLOTS.has(key)) continue;
          for (const m of slots[key]) {
            if (m.userData.glow) { m.material.emissiveIntensity = 0; continue; }
            if (m.userData.noChar) continue;
            m.material = damage && damage !== 'dead-pin' ? ch : mat(key);
          }
        }
        for (const m of group.children) {
          if (!m.name || !m.name.endsWith(':detail-plain')) continue;
          m.material = damage && damage !== 'dead-pin' ? ch : (matOf('abs-red') === matOf('abs-blue') ? matOf('abs-grey') : detailMaterials(THREE).plain);
        }
        if (damage) for (const gl of glows) setGlow(gl, 0);
        if (damageFn) damageFn(damage);
      },
      get damage() { return damage; },
      dispose() {
        for (const g of owned.geoms) g.dispose();
        for (const m of owned.mats) m.dispose();
        for (const t of owned.textures) t.dispose();
        if (extra.screens) for (const k in extra.screens) { const s = extra.screens[k]; if (s && s.texture) s.texture.dispose(); }
        group.removeFromParent();
        group.clear();
      },
      ...extra,
    };
    if (handle.interact && handle.interact.meshes) for (const m of handle.interact.meshes) m.userData.interact = handle.interact.key;
    group.userData.handle = handle;
    return handle;
  }

  return {
    THREE, def, part, ctx, quality, q, params, G, group, seg, pinsMm,
    mat, put, mesh, box, cyl, sphere, rbox, lead, leadGeom, leg, label, glow, setGlow, xform,
    own(x) { if (x.isMaterial) owned.mats.add(x); else if (x.isTexture) owned.textures.add(x); else if (x.isBufferGeometry) owned.geoms.add(x); return x; },
    onState(fn) { stateFn = fn; },
    onDamage(fn) { damageFn = fn; },
    onParams(fn) { paramsFn = fn; },
    get damaged() { return damage; },
    finish,
  };
}
