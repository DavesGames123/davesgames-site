// ============================================================================
//  BREADBOARD LAB  ·  parts/models/generic.js — data templates (custom parts)
// ----------------------------------------------------------------------------
//  A custom part is data only, so its model is a template id plus numbers
//  (CONTRACT 3.5): dip, sip-module, axial, radial, box, to92, to220,
//  cylinder, header-board. Sizes are in mm. Every template places itself
//  from the part's pins, so any pin layout gets a sensible body.
//
//  GREP MAP
//    pinBox ................. bbox and centre of the pins (mm)
//    buildAxial ............. a body between the first two pins, colour bands
//    buildRadial / buildCylinder ... a standing can over the pins
//    buildBox ............... a rounded box over the pins (the fallback too)
//    buildHeaderBoard ....... a PCB with female sockets at the pins
//    buildSip ............... sip-module mapped onto the module builder
// ============================================================================
import { BAND_HEX } from '../bands.js';
import { buildModule } from './bench.js';

const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function pinBox(K) {
  const ps = K.pinsMm;
  if (!ps.length) return { x0: -2, x1: 2, z0: -2, z1: 2, cx: 0, cz: 0 };
  const xs = ps.map(p => p.x), zs = ps.map(p => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}
function legsTo(K, y) {
  if (K.def.mount === 'free') return;
  for (const p of K.pinsMm) K.leg(p.x, p.z, y, 'legs', 0.5);
}
const firstSlot = K => (K.def.slots[0] && K.def.slots[0].key) || 'body';
const slotOr = (K, key) => (K.def.slots.some(s => s.key === key) ? key : firstSlot(K));

export function buildAxial(K) {
  const m = K.def.model;
  const ps = K.pinsMm;
  const a = ps[0] || { x: 0, z: 0 }, b = ps[1] || { x: 4 * 2.54, z: 0 };
  const len = num(m.len, 6, 1, 60), r = num(m.dia, 2.4, 0.5, 20) / 2;
  const by = r + 1.4;
  const ang = Math.atan2(b.z - a.z, b.x - a.x);
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const e0 = [mx - dx * len / 2, by, mz - dz * len / 2], e1 = [mx + dx * len / 2, by, mz + dz * len / 2];
  if (K.def.mount !== 'free') {
    K.lead([[a.x, -2.5, a.z], [a.x, by, a.z], e0], slotOr(K, 'legs'), 0.25);
    K.lead([[b.x, -2.5, b.z], [b.x, by, b.z], e1], slotOr(K, 'legs'), 0.25);
  }
  K.put(K.cyl(r, r, Math.min(len, Math.max(1, L)), 16), slotOr(K, 'body'), { rz: Math.PI / 2, ry: -ang, x: mx, y: by, z: mz });
  const bands = Array.isArray(m.bands) ? m.bands.slice(0, 6) : [];
  bands.forEach((c, i) => {
    const t = (i + 1) / (bands.length + 1) - 0.5;
    const g = K.cyl(r * 1.03, r * 1.03, len * 0.08, 16, true);
    K.mesh(g, null, { rz: Math.PI / 2, ry: -ang, x: mx + dx * t * len, y: by, z: mz + dz * t * len },
      { material: K.own(new K.THREE.MeshStandardMaterial({ color: BAND_HEX[c] || c || '#888888', roughness: 0.5 })), pick: false });
  });
  return K.finish();
}

export function buildRadial(K) {
  const m = K.def.model, bb = pinBox(K);
  const r = num(m.dia, 6, 1, 60) / 2, h = num(m.h, 8, 1, 80);
  legsTo(K, 1);
  K.put(K.cyl(r, r, h, 24), slotOr(K, 'body'), { x: bb.cx, y: 0.6 + h / 2, z: bb.cz });
  return K.finish();
}
export function buildCylinder(K) {
  const m = K.def.model, bb = pinBox(K);
  const r = num(m.dia, 10, 1, 200) / 2, h = num(m.h, 10, 0.5, 200);
  legsTo(K, 0.5);
  K.put(K.cyl(r, r, h, 28), slotOr(K, 'body'), { x: bb.cx, y: h / 2, z: bb.cz });
  return K.finish();
}
export function buildBox(K) {
  const m = K.def.model, bb = pinBox(K);
  const w = num(m.w, Math.max(5, bb.x1 - bb.x0 + 3), 1, 400), d = num(m.d, Math.max(5, bb.z1 - bb.z0 + 3), 1, 400);
  const h = num(m.h, 5, 0.5, 200), rr = num(m.r, 0.8, 0, 20);
  legsTo(K, 0.8);
  K.put(K.rbox(w, h, d, rr), slotOr(K, 'body'), { x: bb.cx, y: K.def.mount === 'free' ? 0 : 0.5, z: bb.cz });
  if (m.label) K.label(String(m.label), w * 0.8, Math.min(d * 0.5, 6), { x: bb.cx, y: (K.def.mount === 'free' ? 0 : 0.5) + h + 0.02, z: bb.cz }, { color: '#e9e9e4' });
  return K.finish();
}
export function buildHeaderBoard(K) {
  const m = K.def.model, bb = pinBox(K);
  const w = num(m.w, bb.x1 - bb.x0 + 8, 4, 400), d = num(m.d, bb.z1 - bb.z0 + 10, 4, 400);
  K.put(K.rbox(w, 1.6, d, 1.2), slotOr(K, 'pcb'), { x: bb.cx, y: 0.4, z: bb.cz - (d - (bb.z1 - bb.z0)) / 2 + 2.5 });
  for (const p of K.pinsMm) {
    const y = p.y || 10;
    K.put(K.box(2.5, y - 2, 2.5), '@abs-black', { x: p.x, y: 2 + (y - 2) / 2, z: p.z });
    K.put(K.box(0.9, 0.1, 0.9), '@board-hole', { x: p.x, y: y + 0.05, z: p.z });
  }
  if (m.label) K.label(String(m.label), w * 0.7, 4, { x: bb.cx, y: 2.02, z: bb.cz - d / 2 + 6 }, { color: '#f4f4f0' });
  return K.finish();
}
export function buildSip(K) {
  // the module builder reads model.bodyW / bodyD / top / label
  return buildModule(K);
}
