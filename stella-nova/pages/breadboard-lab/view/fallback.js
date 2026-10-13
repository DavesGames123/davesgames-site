// ============================================================================
//  BREADBOARD LAB  ·  view/fallback.js — plain models when PARTS has none
// ----------------------------------------------------------------------------
//  The view builds boards, parts, wires and instruments with the PARTS
//  builders (CONTRACT 4.3). This file gives simple stand-ins with the same
//  handle shape, for three cases: before the PARTS modules load, when a
//  builder throws for one def, and in the node tests. A stand-in part is a
//  box over its pins with legs; a stand-in board is a white block with one
//  InstancedMesh of holes and the rail lines.
//
//  Everything takes THREE as an argument and builds in node (no DOM).
//
//  GREP MAP
//    fallbackBoard ........ body, holes (InstancedMesh), rail stripes
//    fallbackPart ......... box over the pin bounds, legs or sockets, glow
//    fallbackWirePath ..... the arch / flat / free paths of CONTRACT 3.10
//    fallbackWire ......... a tube along a polyline
//    dataTexture .......... a procedural RGBA texture (no canvas needed)
// ============================================================================
import { BOARD_H, BOARD_TYPES, G, holeList, holeLocal, pinLocal } from '../core/space.js';

export function dataTexture(THREE, size, fn, o = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = fn(x / (size - 1), y / (size - 1), x, y);
    const i = (y * size + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3] ?? 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (o.srgb && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = o.mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = !!o.mip;
  t.needsUpdate = true;
  return t;
}

export function fallbackBoard(THREE, board, ctx = {}) {
  const bt = BOARD_TYPES[board.type];
  const [W, D, H] = bt.size;
  const object = new THREE.Group();
  object.name = 'board-' + board.id;
  const own = [];
  const mk = (geo, mat) => { own.push(geo, mat); return new THREE.Mesh(geo, mat); };
  const body = mk(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial({ color: 0xeeeee6, roughness: 0.62 }));
  body.position.y = H / 2;
  body.receiveShadow = true;
  object.add(body);
  const list = holeList(board.type);
  const holeGeo = new THREE.BoxGeometry(1.05, 0.12, 1.05);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x23242a });
  own.push(holeGeo, holeMat);
  const holes = new THREE.InstancedMesh(holeGeo, holeMat, list.length);
  const m = new THREE.Matrix4();
  list.forEach((l, i) => { const p = holeLocal(board.type, l); m.makeTranslation(p.x, H + 0.03, p.z); holes.setMatrixAt(i, m); });
  holes.instanceMatrix.needsUpdate = true;
  holes.userData.holeIds = list;
  object.add(holes);
  if (bt.railHoles) {
    const lineGeo = new THREE.PlaneGeometry(W - 6, 0.5);
    own.push(lineGeo);
    const red = new THREE.MeshBasicMaterial({ color: 0xd63b3b }), blue = new THREE.MeshBasicMaterial({ color: 0x2f80d6 });
    own.push(red, blue);
    for (const [z, mat] of [[-24.4, blue], [-18.8, red], [18.8, red], [24.4, blue]]) {
      const s = new THREE.Mesh(lineGeo, mat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(0, H + 0.02, z);
      object.add(s);
    }
  }
  const groove = mk(new THREE.BoxGeometry(W - 4, 0.2, 2.2), new THREE.MeshBasicMaterial({ color: 0xc9c9c0 }));
  groove.position.y = H + 0.01;
  object.add(groove);
  return { object, holes, pickables: [body], fallback: true, dispose() { for (const o of own) o.dispose(); } };
}

const GLOW = { red: 0xff2a1a, orange: 0xff7a1a, yellow: 0xffd21a, green: 0x3dff4a, blue: 0x3a7bff, white: 0xffffff, ir: 0x551111 };

export function fallbackPart(THREE, def, part, ctx = {}) {
  const pins = (def.pins || []).map(p => ({ name: p.name, l: pinLocal(def, p, part.params), socket: !!p.socket }));
  const free = def.mount === 'free';
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const p of pins) { minX = Math.min(minX, p.l.x); maxX = Math.max(maxX, p.l.x); minZ = Math.min(minZ, p.l.z); maxZ = Math.max(maxZ, p.l.z); }
  const m = def.model || {};
  const w = Math.max(m.w || 0, maxX - minX + 2.2, 3), d = Math.max(m.d || 0, maxZ - minZ + 2.2, 3);
  const h = m.h || (free ? 12 : def.category === 'ics' ? 3.5 : 4);
  const object = new THREE.Group();
  object.name = 'part-' + def.id;
  const own = [];
  const matOf = ctx.materials || (() => new THREE.MeshStandardMaterial({ color: 0x9a9aa2 }));
  const slotKey = (def.slots && def.slots[0] && def.slots[0].key) || 'body';
  const slotDefault = (def.slots && def.slots[0] && def.slots[0].default) || 'abs-grey';
  const looks = part.looks || {};
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  own.push(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, matOf(looks[slotKey] || slotDefault));
  body.position.set((minX + maxX) / 2, (free ? 0 : 1.2) + h / 2, (minZ + maxZ) / 2);
  body.castShadow = true;
  object.add(body);
  const legGeo = free ? new THREE.BoxGeometry(1.6, 1.2, 1.6) : new THREE.CylinderGeometry(0.25, 0.25, 4.2, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: free ? 0x222226 : 0xc9ccd1, metalness: free ? 0 : 1, roughness: 0.35 });
  own.push(legGeo, legMat);
  const outPins = [];
  if (pins.length) {
    // One InstancedMesh for all legs: one draw call per part.
    const legs = new THREE.InstancedMesh(legGeo, legMat, pins.length);
    const mm = new THREE.Matrix4();
    pins.forEach((p, i) => { mm.makeTranslation(p.l.x, free ? h + 0.6 : -0.6, p.l.z); legs.setMatrixAt(i, mm); });
    legs.instanceMatrix.needsUpdate = true;
    object.add(legs);
  }
  for (const p of pins) outPins.push({ name: p.name, local: new THREE.Vector3(p.l.x, free ? h + 1.2 : 0, p.l.z) });
  let glowMat = null;
  if (def.visual === 'led' || def.visual === 'lamp' || def.visual === 'leds') {
    glowMat = new THREE.MeshStandardMaterial({ color: 0x552222, emissive: 0x000000, roughness: 0.2, transparent: true, opacity: 0.85 });
    own.push(glowMat);
    body.material = glowMat;
  }
  const baseColor = new THREE.Color();
  const screens = {};
  if ((def.visual === 'meter' || def.category === 'instruments') && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const c2 = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    const sg = new THREE.PlaneGeometry(w * 0.7, w * 0.35);
    const sm = new THREE.MeshBasicMaterial({ map: texture });
    own.push(sg, sm, texture);
    const scr = new THREE.Mesh(sg, sm);
    scr.rotation.x = -Math.PI / 2;
    scr.position.set(body.position.x, h + 0.05, body.position.z - d * 0.2);
    object.add(scr);
    screens.main = { canvas, ctx: c2, texture };
  }
  let damage = null;
  const handle = {
    object, pins: outPins, pickables: [body], slots: { [slotKey]: [body] }, screens, fallback: true,
    setLook(slot, mat) { if (slot === slotKey && !glowMat && mat) body.material = mat; },
    setState(f) {
      if (!glowMat) return;
      const vis = f && f.vis;
      let b = vis ? (vis.b ?? (vis.on ? 1 : 0)) : 0;
      if (vis && vis.leds) b = Math.max(0, ...Object.values(vis.leds));
      const col = GLOW[(vis && vis.color) || (part.params && part.params.color) || 'red'] ?? GLOW.red;
      baseColor.setHex(col);
      glowMat.emissive.copy(baseColor).multiplyScalar(damage ? 0 : Math.min(1.5, b) * 1.6);
    },
    setDamage(kind) {
      damage = kind || null;
      if (glowMat) glowMat.color.setHex(damage ? 0x1a1310 : 0x552222);
      else body.material = damage ? charMat() : matOf(looks[slotKey] || slotDefault);
    },
    dispose() { for (const o of own) o.dispose(); if (char) char.dispose(); },
  };
  let char = null;
  const charMat = () => (char || (char = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 1 })));
  if (def.interact) handle.interact = { kind: def.interact.kind, meshes: [body], key: def.interact.key };
  if (def.category === 'instruments') {
    const names = def.id === 'inst-dmm' ? ['red', 'black'] : def.id === 'inst-scope' ? ['ch1', 'ch2', 'ch3', 'ch4', 'gnd'] : ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'gnd'];
    handle.leads = {};
    names.forEach((n, i) => { handle.leads[n] = new THREE.Vector3(body.position.x - w * 0.4 + (w * 0.8) * (names.length === 1 ? 0.5 : i / (names.length - 1)), h * 0.6, body.position.z + d / 2); });
  }
  return handle;
}

// CONTRACT 3.10: arch rises 3 mm, top min(25, 3 + 0.25 · len) above the
// higher end; flat is 0.8 mm up with one bend; free goes through the bends.
export function fallbackWirePath(a, b, style = 'arch', via = []) {
  if (style === 'flat') {
    const y = Math.max(a[1], b[1]) + 0.8;
    return [a, [a[0], y, a[2]], [b[0], y, a[2]], [b[0], y, b[2]], b];
  }
  const a1 = [a[0], a[1] + 3, a[2]], b1 = [b[0], b[1] + 3, b[2]];
  if (style === 'free') return [a, a1, ...(via || []), b1, b];
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const top = Math.max(a[1], b[1]) + Math.min(25, 3 + 0.25 * len);
  const pts = [a, a1];
  const n = 12;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const base = a1[1] + (b1[1] - a1[1]) * t;
    pts.push([a[0] + (b[0] - a[0]) * t, base + (top - base) * Math.sin(Math.PI * t), a[2] + (b[2] - a[2]) * t]);
  }
  pts.push(b1, b);
  return pts;
}

export function fallbackWire(THREE, { points, color = '#d63b3b', gauge = 22 }) {
  const r = 0.8 * Math.pow(1.122, (22 - gauge) / 2);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.45 });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.castShadow = true;
  function setPoints(pts) {
    mesh.geometry.dispose();
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...pts[i - 1]), new THREE.Vector3(...pts[i])));
    mesh.geometry = pts.length >= 2 ? new THREE.TubeGeometry(path, Math.max(8, pts.length * 3), r, 6, false) : new THREE.BufferGeometry();
  }
  setPoints(points || []);
  return { object: mesh, insulation: mesh, setPoints, setColor(c) { mat.color.set(c); }, dispose() { mesh.geometry.dispose(); mat.dispose(); mesh.removeFromParent(); }, fallback: true };
}

export { BOARD_H, G };
