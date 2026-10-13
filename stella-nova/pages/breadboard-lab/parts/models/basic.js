// ============================================================================
//  BREADBOARD LAB  ·  parts/models/basic.js — small board parts
// ----------------------------------------------------------------------------
//  Leaded parts that plug into holes: resistors, diodes, capacitors, LEDs,
//  transistors, pots, buttons, switches, buzzers, the relay and the small
//  breakout boards. Each builder takes a kit K (models/kit.js) and returns
//  the PartHandle from K.finish.
//
//  Frame: pin 1 at the origin, the board top at y = 0, pins along +X, the
//  "up the board" side at -Z. Leads go 2.5 mm down into the hole.
//
//  RESISTOR BANDS ARE A TEXTURE. The body is a lathe (a dog-bone profile)
//  whose v coordinate runs along the body. A 1 x 128 DataTexture paints the
//  body colour and the bands along v, so a resistor is one draw call for its
//  body. The banded material is cached per (slot material, bands).
//
//  GREP MAP
//    LED_GLOW ............... emissive colour per LED colour
//    bandedMaterial ......... the resistor body texture
//    buildRes / buildDiode / buildFuse ... axial parts
//    buildCapCeramic / buildCapElec / buildInductor / buildLdr / buildThermistor
//    buildLed / buildLedRgb . lenses that glow + halo sprites
//    buildTo92 / buildTo220 . transistor packages
//    buildPot / buildTrimpot  knob turns with pos
//    buildButton / buildSlide  caps and levers that move
//    buildBuzzer / buildRelay / buildCoin / buildUsb / buildRegBoard
//    buildDip ............... DIP-N with notch, dot and marking
// ============================================================================
import { G } from '../schema.js';
import { resistorBands, BAND_HEX, formatOhms } from '../bands.js';
import { mergeGeometries } from './kit.js';

export const LED_GLOW = { red: '#ff2a1a', orange: '#ff7a1a', yellow: '#ffd21a', green: '#3aff4a',
  blue: '#3a7aff', white: '#f4f6ff', ir: '#3a1030' };

// ---------------------------------------------------------------- shared
function axialLeads(K, x0, x1, by, bodyL, r = 0.25, slot = 'legs') {
  const mid = (x0 + x1) / 2;
  const e0 = mid - bodyL / 2, e1 = mid + bodyL / 2;
  const bend = Math.min(0.8, by / 2);
  K.lead([[x0, -2.5, 0], [x0, by - bend, 0], [x0 + bend * 0.3, by - bend * 0.3, 0], [x0 + bend, by, 0], [e0 + 0.2, by, 0]], slot, r);
  K.lead([[x1, -2.5, 0], [x1, by - bend, 0], [x1 - bend * 0.3, by - bend * 0.3, 0], [x1 - bend, by, 0], [e1 - 0.2, by, 0]], slot, r);
}
// straight legs from the hole to height h at each pin
function pinLegs(K, h, w = 0.45) {
  for (const p of K.pinsMm) K.leg(p.x, p.z, h, 'legs', w);
}

const bandCache = new WeakMap();
function bandedMaterial(K, baseMat, bands, slots) {
  const { THREE } = K;
  let per = bandCache.get(baseMat);
  if (!per) { per = new Map(); bandCache.set(baseMat, per); }
  const key = bands.join(',');
  if (per.has(key)) return per.get(key);
  const N = 128, d = new Uint8Array(N * 4);
  const body = '#' + baseMat.color.getHexString();
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    let c = body;
    bands.forEach((b, j) => { if (b !== 'none' && Math.abs(t - slots[j]) < 0.045) c = BAND_HEX[b]; });
    const [r, g, bb] = hexRgb(c);
    d.set([r, g, bb, 255], i * 4);
  }
  const tex = new THREE.DataTexture(d, 1, N, THREE.RGBAFormat);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const m = baseMat.clone();
  m.color = new THREE.Color('#ffffff');
  m.map = tex;
  m.userData.cached = true;
  per.set(key, m);
  return m;
}

// a dog-bone lathe along +X, length L, radius r, centred at (cx, cy, 0)
function dogbone(K, L, r, n = 25) {
  const { THREE } = K;
  const pts = [];
  pts.push(new THREE.Vector2(0.001, 0));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bulge = Math.max(Math.exp(-(((t - 0.1) / 0.09) ** 2)), Math.exp(-(((t - 0.9) / 0.09) ** 2)));
    const end = Math.min(1, Math.min(t, 1 - t) / 0.03);
    pts.push(new THREE.Vector2(r * (0.86 + 0.14 * bulge) * Math.sqrt(Math.max(0.05, end)), t * L));
  }
  pts.push(new THREE.Vector2(0.001, L));
  const g = new THREE.LatheGeometry(pts, K.seg(14));
  // lathe v runs over the profile points: re-map v to t along the body
  const uv = g.attributes.uv, P = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setY(i, P.getY(i) / L);
  g.translate(0, -L / 2, 0);
  g.rotateZ(-Math.PI / 2);              // axis +Y -> +X
  return g;
}

// ---------------------------------------------------------------- axial
export function buildRes(K) {
  const span = K.pinsMm[1].x;
  const pm = K.params.pmax || 0.25;
  const L = pm >= 1 ? 11 : pm >= 0.5 ? 9 : pm <= 0.125 ? 3.6 : 6.3;
  const r = pm >= 1 ? 2.2 : pm >= 0.5 ? 1.6 : pm <= 0.125 ? 0.9 : 1.2;
  const by = r + 1.5;
  axialLeads(K, 0, span, by, L, 0.23);
  const bands = resistorBands(K.params.r, K.params.tol);
  const slots = bands.length === 5 ? [0.2, 0.31, 0.42, 0.53, 0.8] : [0.24, 0.36, 0.48, 0.78];
  const body = K.mesh(dogbone(K, L, r), 'body', { x: span / 2, y: by });
  let banded = bandedMaterial(K, K.mat('body'), bands, slots);
  body.material = banded;
  K.onDamage(kind => { if (!kind || kind === 'dead-pin') body.material = banded; });
  const h = K.finish({ bands, caption: formatOhms(K.params.r) + 'Ω' });
  const setLook = h.setLook;
  h.setLook = (slotKey, material) => {
    setLook(slotKey, material);
    if (slotKey === 'body' && material) { banded = bandedMaterial(K, material, bands, slots); if (!h.damage) body.material = banded; }
  };
  return h;
}

export function buildDiode(K) {
  const span = K.pinsMm[1].x;
  const glass = (K.def.model.kind || 'glass') === 'glass';
  const L = glass ? 3.8 : 5.2, r = glass ? 0.9 : 1.35;
  const by = r + 1.4;
  axialLeads(K, 0, span, by, L, glass ? 0.22 : 0.4);
  const cx = span / 2;
  K.put(K.cyl(r, r, L, 14), 'body', { rz: Math.PI / 2, x: cx, y: by });
  // band at the cathode end (+X)
  K.put(K.cyl(r * 1.04, r * 1.04, L * 0.16, 14, true), 'band', { rz: Math.PI / 2, x: cx + L * 0.34, y: by });
  return K.finish();
}

export function buildFuse(K) {
  const span = K.pinsMm[1].x;
  const L = span - 3, r = 2.1, by = r + 1.6, cx = span / 2;
  axialLeads(K, 0, span, by, L, 0.3);
  const glass = K.mesh(K.cyl(r, r, L * 0.78, 18, true), 'body', { rz: Math.PI / 2, x: cx, y: by });
  K.put(K.cyl(r * 1.08, r * 1.08, L * 0.12, 18), 'metal', { rz: Math.PI / 2, x: cx - L * 0.44, y: by });
  K.put(K.cyl(r * 1.08, r * 1.08, L * 0.12, 18), 'metal', { rz: Math.PI / 2, x: cx + L * 0.44, y: by });
  const fil = K.mesh(K.cyl(0.08, 0.08, L * 0.8, 5), '@tin', { rz: Math.PI / 2, x: cx, y: by }, { pick: false });
  let smoky = null;
  K.onDamage(kind => {
    fil.visible = kind !== 'blown' && kind !== 'burnt';
    if (kind === 'blown') {
      if (!smoky) smoky = K.own(new K.THREE.MeshStandardMaterial({ color: 0x3a3330, transparent: true, opacity: 0.75, roughness: 0.4 }));
      glass.material = smoky;
    }
  });
  return K.finish();
}

// ---------------------------------------------------------------- radial
export function buildCapCeramic(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2;
  const r = 2.6, by = 5.2;
  K.lead([[0, -2.5, 0], [0, 1.5, 0], [cx - 1.2, by - 1.2, 0]], 'legs', 0.22);
  K.lead([[x1, -2.5, 0], [x1, 1.5, 0], [cx + 1.2, by - 1.2, 0]], 'legs', 0.22);
  const disc = K.sphere(r, 16, 10, Math.PI);
  disc.scale(1, 1, 0.42);
  K.put(disc, 'body', { x: cx, y: by + 0.6 });
  const c = K.params.c;
  const code = (() => {             // the 3-digit pF code, 104 = 100 nF
    const pf = c * 1e12;
    if (pf < 10) return String(Math.round(pf));
    const e = Math.floor(Math.log10(pf)) - 1;
    return String(Math.round(pf / 10 ** e)).slice(0, 2) + e;
  })();
  K.label(code, 3.4, 1.6, { rx: Math.PI / 2, x: cx, y: by + 0.6, z: r * 0.43 + 0.02 }, { color: '#2b2416', weight: 700 });
  return K.finish({ caption: code });
}

export function buildCapElec(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2;
  const cuf = K.params.c * 1e6, v = K.params.vmax || 16;
  const dia = Math.max(4, Math.min(13, 4 + 2.2 * Math.log10(1 + cuf * v / 40)));
  const h = Math.max(5, Math.min(26, dia * 1.6));
  const r = dia / 2, y0 = 0.6;
  pinLegs(K, y0 + 0.5);
  K.put(K.cyl(r, r, h, 24), 'body', { x: cx, y: y0 + h / 2 });
  // the stripe: a partial cylinder on the − side (+X)
  const st = new K.THREE.CylinderGeometry(r + 0.03, r + 0.03, h * 0.94, K.seg(8), 1, true, Math.PI / 2 - 0.42, 0.84);
  K.put(st, 'stripe', { x: cx, y: y0 + h / 2 });
  const top = K.mesh(K.cyl(r * 0.92, r * 0.92, 0.3, 24), 'metal', { x: cx, y: y0 + h + 0.1 });
  K.onDamage(kind => {
    if (kind === 'vented') { top.scale.set(1, 6, 1); top.position.y = y0 + h + 0.6; }
    else { top.scale.set(1, 1, 1); top.position.y = y0 + h + 0.1; }
  });
  return K.finish();
}

export function buildInductor(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2;
  pinLegs(K, 1);
  K.put(K.cyl(3.4, 3.4, 1.2, 20), 'body', { x: cx, y: 1.6 });
  K.put(K.cyl(3.4, 3.4, 1.2, 20), 'body', { x: cx, y: 6.4 });
  K.put(K.cyl(1.6, 1.6, 5, 12), 'body', { x: cx, y: 4 });
  K.put(K.cyl(3.0, 3.0, 3.6, 20), 'winding', { x: cx, y: 4 });
  return K.finish();
}

export function buildLdr(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2, y = 6;
  pinLegs(K, y);
  K.put(K.cyl(2.6, 2.6, 1.6, 20), 'body', { x: cx, y: y + 0.8 });
  // the serpentine track on the face
  for (let i = -2; i <= 2; i++) K.put(K.box(3.4 - Math.abs(i) * 0.5, 0.06, 0.28), 'track', { x: cx, y: y + 1.63, z: i * 0.75 });
  K.put(K.cyl(2.7, 2.7, 0.15, 20, true), 'legs', { x: cx, y: y + 1.5 });
  return K.finish();
}

export function buildThermistor(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2, y = 6;
  K.lead([[0, -2.5, 0], [0, y - 2, 0], [cx - 0.5, y, 0]], 'legs', 0.2);
  K.lead([[x1, -2.5, 0], [x1, y - 2, 0], [cx + 0.5, y, 0]], 'legs', 0.2);
  const s = K.sphere(1.7, 14, 10);
  s.scale(1, 1.2, 0.7);
  K.put(s, 'body', { x: cx, y: y + 0.6 });
  return K.finish();
}

// ---------------------------------------------------------------- LEDs
function ledLens(K, cx, y0, slotPrefer) {
  const { THREE } = K;
  const r = 2.5, h = 5.4, n = 10;
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(2.9, 0), new THREE.Vector2(2.9, 1.0), new THREE.Vector2(r, 1.0)];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(r * Math.cos(a) + 0.001, h - r + r * Math.sin(a))); }
  K.mat('lens', slotPrefer);
  const lens = K.mesh(new THREE.LatheGeometry(pts, K.seg(20)), 'lens', { x: cx, y: y0 });
  return { lens, top: [cx, y0 + h - 1.5, 0] };
}
export function buildLed(K) {
  const col = K.params.color || 'red';
  const cx = K.pinsMm[1].x / 2, y0 = 3;
  // anode leg is longer: a kink shows it
  K.lead([[0, -2.5, 0], [0, y0 + 0.5, 0]], 'legs', 0.25);
  K.lead([[K.pinsMm[1].x, -2.5, 0], [K.pinsMm[1].x, y0 + 0.5, 0]], 'legs', 0.25);
  K.put(K.box(0.9, 1.6, 0.35), 'legs', { x: cx + 0.55, y: y0 + 1.6 });     // the anvil inside
  K.put(K.box(0.5, 1.3, 0.35), 'legs', { x: cx - 0.55, y: y0 + 1.5 });
  const { lens, top } = ledLens(K, cx, y0, col === 'white' ? 'led-white' : 'led-' + col);
  const gl = K.glow(lens, LED_GLOW[col] || LED_GLOW.red, 16, top);
  K.onParams(p => { const c = p.color || 'red'; K.setGlow(gl, gl.b, LED_GLOW[c]); });
  K.onState(f => K.setGlow(gl, f && f.vis ? (f.vis.b ?? (f.vis.leds && f.vis.leds.main) ?? 0) : 0));
  return K.finish();
}
export function buildLedRgb(K) {
  const xs = K.pinsMm.map(p => p.x);
  const cx = (xs[0] + xs[3]) / 2, y0 = 3;
  xs.forEach((x, i) => K.lead([[x, -2.5, 0], [x, y0 - 1, 0], [cx + (x - cx) * 0.35, y0 + 0.5, 0]], 'legs', 0.24 + (i === 1 ? 0.02 : 0)));
  const { lens, top } = ledLens(K, cx, y0, 'led-diffuse');
  const gl = K.glow(lens, '#000000', 18, top);
  const c = new K.THREE.Color();
  K.onState(f => {
    const L = (f && f.vis && f.vis.leds) || {};
    const r = Math.min(1.5, L.r || 0), g = Math.min(1.5, L.g || 0), b = Math.min(1.5, L.b || 0);
    const m = Math.max(r, g, b);
    if (m <= 0.01) { K.setGlow(gl, 0); return; }
    c.setRGB(r / m, g / m, b / m);
    K.setGlow(gl, m, '#' + c.getHexString());
  });
  return K.finish();
}

// ---------------------------------------------------------------- packages
export function buildTo92(K) {
  const { THREE } = K;
  const xs = K.pinsMm.map(p => p.x), cx = (xs[0] + xs[xs.length - 1]) / 2, y0 = 4;
  xs.forEach(x => K.lead([[x, -2.5, 0], [x, y0 - 1.4, 0], [cx + (x - cx) * 0.5, y0 + 0.2, 0]], 'legs', 0.22));
  const s = new THREE.Shape();
  const r = 2.4;
  const a1 = Math.asin(0.55), a2 = Math.PI - a1;        // the flat cut at y = 0.55 r
  s.moveTo(r * Math.cos(a1), r * Math.sin(a1));
  s.absarc(0, 0, r, a1, a2, true);                        // clockwise: the round back
  s.lineTo(r * Math.cos(a1), r * Math.sin(a1));
  const g = new THREE.ExtrudeGeometry(s, { depth: 4.8, bevelEnabled: false, curveSegments: K.seg(10) });
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);                    // the flat face looks toward +Z
  K.put(g, 'body', { x: cx, y: y0, z: -0.6 });
  K.label(K.def.model.label || '', 4.2, 1.6, { rx: Math.PI / 2, x: cx, y: y0 + 3, z: 0.74 }, { color: '#cfd2d6' });
  return K.finish();
}
export function buildTo220(K) {
  const xs = K.pinsMm.map(p => p.x), cx = (xs[0] + xs[2]) / 2, y0 = 5;
  xs.forEach(x => K.lead([[x, -2.5, 0], [x, y0 + 0.4, 0]], 'legs', 0.35));
  K.put(K.box(10, 9, 4.4), 'body', { x: cx, y: y0 + 4.5, z: 0.2 });
  const tab = K.rbox(10, 6.4, 1.3, 0.6);
  K.put(tab, 'tab', { x: cx, y: y0 + 7.2, z: -1.4 });
  K.put(K.cyl(1.8, 1.8, 1.4, 14), '@board-hole', { rx: Math.PI / 2, x: cx, y: y0 + 11.6, z: -1.4 });
  K.label(K.def.model.label || '', 8, 2.4, { rx: Math.PI / 2, x: cx, y: y0 + 5, z: 2.42 }, { color: '#cfd2d6' });
  return K.finish();
}

// ---------------------------------------------------------------- pots
const potAngle = pos => (0.5 - Math.max(0, Math.min(1, pos))) * (270 * Math.PI / 180);
export function buildPot(K) {
  const { THREE } = K;
  const cx = 2 * G, cz = -3.5 * G, y0 = 2;
  for (const p of K.pinsMm) K.lead([[p.x, -2.5, 0], [p.x, y0 - 0.5, 0], [p.x, y0 - 0.3, cz + 6.5]], 'legs', 0.4);
  K.put(K.cyl(8, 8, 6.5, 28), 'body', { x: cx, y: y0 + 3.25, z: cz });
  K.put(K.cyl(3.5, 3.5, 4, 18), 'metal', { x: cx, y: y0 + 8.5, z: cz });
  const pivot = new THREE.Group();
  pivot.position.set(cx, y0 + 10.5, cz);
  K.group.add(pivot);
  // the pointer is a ridge on the knob top (same mesh: one draw call)
  const kg = K.cyl(5.8, 6.2, 8, 24); kg.translate(0, 4, 0);
  const ridge = K.box(1.1, 0.6, 4.4); ridge.translate(0, 8.3, -3);
  const knob = K.mesh(mergeGeometries(K.THREE, [kg, ridge]), 'knob', null, { parent: pivot });
  kg.dispose(); ridge.dispose();
  const set = p => { pivot.rotation.y = potAngle(p.pos); };
  set(K.params);
  K.onParams(set);
  return K.finish({ interact: { kind: 'knob', key: 'pos', meshes: [knob] } });
}
export function buildTrimpot(K) {
  const { THREE } = K;
  const cx = G, y0 = 0.6;
  pinLegs(K, y0 + 0.5);
  K.put(K.box(6.6, 4.6, 6.8), 'body', { x: cx, y: y0 + 2.3, z: -1 });
  const pivot = new THREE.Group();
  pivot.position.set(cx, y0 + 4.6, -1);
  K.group.add(pivot);
  const rg = K.cyl(2.4, 2.4, 0.9, 18); rg.translate(0, 0.45, 0);
  const bar = K.box(3.4, 0.35, 0.7); bar.translate(0, 1.05, 0);
  const rotor = K.mesh(mergeGeometries(K.THREE, [rg, bar]), 'knob', null, { parent: pivot });
  rg.dispose(); bar.dispose();
  const set = p => { pivot.rotation.y = potAngle(p.pos); };
  set(K.params);
  K.onParams(set);
  return K.finish({ interact: { kind: 'knob', key: 'pos', meshes: [rotor] } });
}

// ---------------------------------------------------------------- switches
export function buildButton(K) {
  const big = (K.def.model.size || 6) >= 12;
  const ps = K.pinsMm;
  const cx = (ps[0].x + ps[1].x) / 2, cz = (ps[0].z + ps[2].z) / 2;
  const w = big ? 12 : 6, h = big ? 3.8 : 3.5;
  for (const p of ps) K.lead([[p.x, -2.5, p.z], [p.x, 0.6, p.z], [p.x, 1.2, cz + (p.z - cz) * (w / 2 - 0.3) / Math.abs(p.z - cz)]], 'legs', 0.3);
  K.put(K.box(w, h, w), 'body', { x: cx, y: 0.3 + h / 2, z: cz });
  if (big) K.put(K.box(w + 0.2, 0.35, w + 0.2), 'metal', { x: cx, y: 0.3 + h + 0.15, z: cz });
  const capR = big ? 5.6 : 1.75, capH = big ? 3 : 1.6;
  const prefer = big ? 'abs-' + (K.params.cap || 'red') : undefined;
  K.mat('cap', prefer);
  const base = 0.3 + h + (big ? 0.35 : 0);
  const cap = K.mesh(K.cyl(capR, capR * 1.04, capH, big ? 28 : 16), 'cap', { x: cx, y: base + capH / 2 });
  const set = p => { cap.position.y = base + capH / 2 - (p.pressed ? (big ? 0.9 : 0.5) : 0); };
  set(K.params);
  K.onParams(set);
  return K.finish({ interact: { kind: 'press', key: 'pressed', meshes: [cap] } });
}
export function buildSlide(K) {
  const cx = G, y0 = 0.5;
  pinLegs(K, y0 + 0.5);
  K.put(K.box(8.6, 3.4, 4.4), 'body', { x: cx, y: y0 + 1.7 });
  K.put(K.box(8.8, 0.3, 4.6), 'metal', { x: cx, y: y0 + 3.55 });
  const lever = K.mesh(K.box(1.6, 3.2, 1.6), 'cap', { y: y0 + 3.7 + 1.6 });
  const set = p => { lever.position.x = cx + (p.pos ? 1.3 : -1.3); };
  set(K.params);
  K.onParams(set);
  return K.finish({ interact: { kind: 'toggle', key: 'pos', meshes: [lever] } });
}

// ---------------------------------------------------------------- sound, relay
export function buildBuzzer(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2, y0 = 0.5, h = 9.5;
  pinLegs(K, y0 + 0.5);
  K.put(K.cyl(6, 6, h, 30), 'body', { x: cx, y: y0 + h / 2 });
  // the top: a seal sticker (active) or the dark sound port ring (passive)
  K.put(K.cyl(4.6, 4.6, 0.12, 24), K.def.model.active ? 'label' : '@abs-dark', { x: cx, y: y0 + h + 0.06 });
  K.put(K.cyl(0.9, 0.9, 0.14, 12), '@board-hole', { x: cx, y: y0 + h + 0.1 });
  K.label('+', 1.6, 1.6, { x: cx - 3.8, y: y0 + h + 0.1 }, { color: '#e9e9e4' });
  // sound is the view's job (WebAudio); the root object is never moved here
  return K.finish();
}
export function buildRelay(K) {
  const cx = 3 * G, cz = -2 * G, w = 19, d = 15.5, h = 15.3;
  pinLegs(K, 0.6);
  K.put(K.box(w, h, d), 'body', { x: cx, y: h / 2 + 0.3, z: cz });
  K.label(['5V RELAY', 'SPDT 10A'], 14, 6, { x: cx, y: h + 0.32, z: cz }, { color: '#f4f4f0' });
  const lamp = K.mesh(K.cyl(0.9, 0.9, 0.3, 12), '@abs-dark', { x: cx + 7.5, y: h + 0.45, z: cz + 6 }, { pick: false });
  const own = K.own(new K.THREE.MeshStandardMaterial({ color: 0x401010, roughness: 0.3 }));
  lamp.material = own;
  own.emissive = new K.THREE.Color('#ff3a2a');
  own.emissiveIntensity = 0;
  K.onState(f => { own.emissiveIntensity = f && f.vis && f.vis.on ? 2.2 : 0; });
  return K.finish();
}

// ---------------------------------------------------------------- small boards
export function buildCoin(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2;
  pinLegs(K, 1);
  K.put(K.cyl(11, 11, 4, 36), 'body', { x: cx, y: 2.5 });
  K.put(K.cyl(10, 10, 3.2, 36), 'cell', { x: cx, y: 3.4 });
  K.put(K.box(3, 0.4, 16), 'legs', { x: cx, y: 5.1, ry: 0.3 });
  K.label('+  CR2032  3V', 14, 3, { x: cx, y: 5.02, z: 4.5 }, { color: '#2b2b2b' });
  return K.finish();
}
export function buildUsb(K) {
  const x1 = K.pinsMm[1].x, cx = x1 / 2, cz = -4.5;
  for (let i = 0; i <= 4; i++) K.leg(i * G, 0, 3.4, 'legs', 0.6);
  K.put(K.box(5 * G, 2.5, 2.5), '@abs-black', { x: cx, y: 1.25 });
  K.put(K.rbox(14, 1.6, 13, 1), 'pcb', { x: cx, y: 2.5, z: cz + 1.5 });
  K.put(K.rbox(7.6, 2.8, 5.4, 0.8), 'metal', { x: cx, y: 4.1, z: cz - 2.6 });
  K.label(['VBUS  D-  D+  ID  GND'], 13, 2, { x: cx, y: 4.12, z: -0.4 }, { color: '#f4f4f0', font: 'mono' });
  return K.finish();
}
export function buildRegBoard(K) {
  const cx = G, cz = -2.4 * G;
  pinLegs(K, 3.4, 0.6);
  K.put(K.box(3 * G, 2.5, 2.5), '@abs-black', { x: cx, y: 1.25 });
  K.put(K.rbox(11, 1.6, 13, 0.8), 'pcb', { x: cx, y: 2.5, z: cz + 1 });
  K.put(K.box(6.5, 1.7, 3.5), 'body', { x: cx, y: 4.95, z: cz - 0.8 });
  K.put(K.box(3, 0.3, 1.6), 'metal', { x: cx, y: 4.2, z: cz - 3.4 });
  K.put(K.box(1.6, 1.2, 0.8), '@ceramic-tan', { x: cx - 3.5, y: 4.7, z: cz + 3 });
  K.put(K.box(1.6, 1.2, 0.8), '@ceramic-tan', { x: cx + 3.5, y: 4.7, z: cz + 3 });
  K.label('IN GND OUT', 9, 1.6, { x: cx, y: 4.12, z: -0.6 }, { color: '#f4f4f0', font: 'mono' });
  return K.finish();
}

// ---------------------------------------------------------------- DIP
export function buildDip(K) {
  const n = K.def.model.pins || K.pinsMm.length;
  const h = n / 2;
  const L = h * G + 0.6, W = 6.35, H = 3.3, y0 = 0.8;
  const cx = (h - 1) * G / 2, cz = -1.5 * G;
  for (const p of K.pinsMm) {
    const sgn = p.z < cz ? -1 : 1;        // the side of the body this pin is on
    K.put(K.box(0.46, 2.5 + 2.2, 0.25), 'legs', { x: p.x, y: (-2.5 + 2.2) / 2, z: p.z });
    K.put(K.box(1.4, 0.25, Math.abs(p.z - (cz + sgn * W / 2)) + 0.2), 'legs', { x: p.x, y: 2.1, z: (p.z + cz + sgn * W / 2) / 2 });
  }
  K.put(K.rbox(L, H, W, 0.35, 2), 'body', { x: cx, y: y0 });
  // pin-1 notch (a dark half disc) and dot
  const notch = K.cyl(1.0, 1.0, 0.06, 14);
  K.put(notch, '@board-hole', { x: cx - L / 2 + 0.05, y: y0 + H + 0.01, z: cz });
  K.put(K.cyl(0.45, 0.45, 0.05, 10), '@abs-dark', { x: -0.3, y: y0 + H + 0.01, z: -0.9 });
  K.label(K.def.model.label || '', L * 0.8, W * 0.55, { x: cx + 0.4, y: y0 + H + 0.02, z: cz }, { color: '#d7d7d2', font: 'mono', weight: 600 });
  return K.finish();
}
