// ============================================================================
//  BREADBOARD LAB  ·  parts/models/bench.js — parts on the mat, modules
// ----------------------------------------------------------------------------
//  Free parts sit on the mat (y = 0 is the mat here). Their pins are sockets:
//  a binding post, a lead end, a header socket. The socket mouth is at the
//  pin's y, so a wire end lands on it.
//
//  Also here: the board modules with a header row (joystick, keypad, the old
//  inventory modules), because they share the "PCB on a header" build.
//
//  ANIMATION. The motor turns its wheel at the sim speed but capped at
//  40 rad/s on screen (a real 1000 rad/s only aliases at 60 fps). The servo
//  horn follows vis.angle in degrees (0..180). The speaker cone moves with
//  vis.amp. The lamp filament glows with vis.b.
//
//  GREP MAP
//    buildSupply / buildFuncgen ... instruments with segment readouts and posts
//    buildBattery9v / buildPack / buildSolar / buildShield
//    buildSpeaker / buildMotor / buildServo / buildLamp
//    buildJoystick / buildKeypad
//    buildModule ............ PCB on a header row (or 2 x 4 grid), top feature
//    leadTo ................. a wire lead from a body to a socket end
// ============================================================================
import { G } from '../schema.js';
import { segDisplay } from './segments.js';
import { EMIT, emissiveFor } from '../../core/light.js';

const glowMat = (K, color, base = 0x202020) => {
  const m = K.own(new K.THREE.MeshStandardMaterial({ color: base, roughness: 0.35 }));
  m.emissive = new K.THREE.Color(color); m.emissiveIntensity = 0;
  return m;
};
// an indicator lamp at the EMIT.lamp level of core/light.js, or off
const lampOn = (m, on) => { m.emissiveIntensity = on ? emissiveFor(m.emissive, 1, EMIT.lamp) : 0; };
function display(K, digits, h, on, x, y, z, faceFront = true) {
  const d = segDisplay(K.THREE, { digits, h, w: h * 0.55, gap: h * 0.3, on, off: '#1c1210' });
  d.mesh.position.set(x - d.width / 2, y, z);
  if (faceFront) { d.mesh.rotation.x = Math.PI / 2; }
  K.group.add(d.mesh);
  K.own(d.mesh.geometry); K.own(d.mesh.material);
  return d;
}
// a binding post facing +Z at (x, y, z), ring material id
function post(K, x, y, z, ring) {
  K.put(K.cyl(4, 4, 5, 18), ring, { rx: Math.PI / 2, x, y, z: z - 2.5 });
  K.put(K.cyl(1.6, 1.6, 7, 12), 'metal', { rx: Math.PI / 2, x, y, z: z - 3 });
  K.put(K.cyl(0.9, 0.9, 0.3, 10), '@board-hole', { rx: Math.PI / 2, x, y, z: z + 0.52 });
}
// a lead from a body point to a socket end that lies on the mat
function leadTo(K, from, to, slotOrMat) {
  const mid = [(from[0] + to[0]) / 2, Math.max(from[1], to[1]) + 2, (from[2] + to[2]) / 2];
  K.lead([from, mid, [to[0], to[1] + 0.2, to[2] - 3], [to[0], to[1], to[2] - 1.2]], slotOrMat, 0.7);
  K.put(K.cyl(0.9, 0.9, 3, 10), '@tin', { rx: Math.PI / 2, x: to[0], y: to[1], z: to[2] - 0.6 });
}
const fmt4 = (v, dec) => {
  let s = Math.abs(v).toFixed(dec);
  while (s.replace('.', '').length > 4 && dec > 0) s = Math.abs(v).toFixed(--dec);
  return (v < 0 ? '-' : '') + s;
};

// ---------------------------------------------------------------- supply
export function buildSupply(K) {
  const W = 110, D = 78, H = 62;
  const cx = 2 * G - 30, cz = -D / 2 - 5;
  K.put(K.rbox(W, H, D, 4, 3), 'body', { x: cx, y: 0, z: cz });
  K.put(K.box(W - 6, H - 8, 1), 'face', { x: cx, y: H / 2 + 1, z: -4.6 });
  post(K, 0, 16, 0, '@abs-red');
  post(K, 4 * G, 16, 0, '@abs-black');
  const vD = display(K, 4, 11, '#ff4a1a', cx - 22, 44, -4.0);
  const aD = display(K, 4, 11, '#3aff6a', cx + 22, 44, -4.0);
  // knobs (voltage, current)
  const knobs = [];
  for (const kx of [cx - 22, cx + 2]) {
    const pivot = new K.THREE.Group(); pivot.position.set(kx, 18, -4); K.group.add(pivot);
    K.mesh(K.cyl(6, 6.5, 8, 22), 'knob', { rx: Math.PI / 2, z: 4 }, { parent: pivot });
    K.mesh(K.box(0.8, 4, 0.4), '@silk-white', { y: 2.5, z: 8.1 }, { parent: pivot, pick: false });
    knobs.push(pivot);
  }
  const ccM = glowMat(K, '#ff3020'), cvM = glowMat(K, '#30ff50'), outM = glowMat(K, '#ffb020');
  K.mesh(K.cyl(1.6, 1.6, 1, 12), null, { rx: Math.PI / 2, x: cx + 34, y: 50, z: -4 }, { material: ccM, pick: false });
  K.mesh(K.cyl(1.6, 1.6, 1, 12), null, { rx: Math.PI / 2, x: cx + 34, y: 42, z: -4 }, { material: cvM, pick: false });
  const outBtn = K.mesh(K.rbox(12, 6, 3, 1), null, { rx: Math.PI / 2, x: cx - 40, y: 16, z: -1.5 }, { material: outM });
  K.label(['V', ''], 6, 6, { rx: Math.PI / 2, x: cx - 22 + 24, y: 50, z: -3.9 }, { color: '#cfd2d6' });
  K.label(['A', ''], 6, 6, { rx: Math.PI / 2, x: cx + 22 + 24, y: 50, z: -3.9 }, { color: '#cfd2d6' });
  K.label('CC  CV', 10, 3, { rx: Math.PI / 2, x: cx + 34, y: 34, z: -3.9 }, { color: '#cfd2d6' });
  K.label('OUTPUT', 14, 3, { rx: Math.PI / 2, x: cx - 40, y: 9, z: -3.9 }, { color: '#cfd2d6' });
  const setKnobs = p => {
    knobs[0].rotation.z = -(p.v / 30) * 4.7 + 2.35;
    knobs[1].rotation.z = -(Math.log10(p.ilim / 0.001) / Math.log10(3000)) * 4.7 + 2.35;
  };
  setKnobs(K.params);
  K.onParams(setKnobs);
  const show = (v, a, cc, on) => {
    vD.setText(fmt4(v, 2)); aD.setText(fmt4(a, 3));
    lampOn(ccM, on && cc); lampOn(cvM, on && !cc); lampOn(outM, on);
  };
  show(K.params.v, 0, false, K.params.on);
  K.onState(f => {
    const v = (f && f.vis) || {};
    const on = v.on ?? K.params.on;
    show(on ? (v.v ?? K.params.v) : K.params.v, on ? (v.a ?? 0) : 0, !!v.cc, on);
  });
  return K.finish({ interact: { kind: 'toggle', key: 'on', meshes: [outBtn] }, readouts: { v: vD, a: aD } });
}

export function buildFuncgen(K) {
  const W = 100, D = 70, H = 48;
  const cx = 1.5 * G - 28, cz = -D / 2 - 5;
  K.put(K.rbox(W, H, D, 4, 3), 'body', { x: cx, y: 0, z: cz });
  K.put(K.box(W - 6, H - 8, 1), 'face', { x: cx, y: H / 2 + 1, z: -4.6 });
  post(K, 0, 14, 0, '@abs-red');
  post(K, 3 * G, 14, 0, '@abs-black');
  const fD = display(K, 6, 9, '#4ac8ff', cx - 8, 34, -4.0);
  const pivot = new K.THREE.Group(); pivot.position.set(cx - 30, 14, -4); K.group.add(pivot);
  K.mesh(K.cyl(7, 7.5, 8, 22), 'knob', { rx: Math.PI / 2, z: 4 }, { parent: pivot });
  const waveM = { sine: glowMat(K, '#4ac8ff'), square: glowMat(K, '#4ac8ff'), tri: glowMat(K, '#4ac8ff'), dc: glowMat(K, '#4ac8ff') };
  ['sine', 'square', 'tri', 'dc'].forEach((w, i) => {
    K.mesh(K.box(5, 2.2, 1), null, { x: cx + 32, y: 40 - i * 6, z: -4 }, { material: waveM[w], pick: false });
  });
  K.label(['SIN', 'SQR', 'TRI', 'DC'], 8, 22, { rx: Math.PI / 2, x: cx + 41, y: 31, z: -3.9 }, { color: '#cfd2d6', align: 'left' });
  K.label('OUT    COM', 18, 3, { rx: Math.PI / 2, x: 1.5 * G, y: 6, z: -3.9 }, { color: '#cfd2d6' });
  const fmtF = f => f >= 1e5 ? String(Math.round(f)) : f >= 1 ? String(Number(f.toPrecision(6))) : f.toFixed(4);
  const set = p => {
    fD.setText(fmtF(p.freq).slice(0, 7));
    for (const w in waveM) lampOn(waveM[w], w === p.wave);
    pivot.rotation.z = -Math.log10(Math.max(0.01, p.freq) / 0.01) / 8 * 4.7 + 2.35;
  };
  set(K.params);
  K.onParams(set);
  return K.finish({ readouts: { f: fD } });
}

// ---------------------------------------------------------------- batteries
export function buildBattery9v(K) {
  const bx = G, bz = -45;
  K.put(K.rbox(26.5, 17.5, 46, 2), 'body', { x: bx, y: 0, z: bz });
  K.put(K.box(26.6, 17.6, 10), 'band', { x: bx, y: 8.75, z: bz - 12 });
  K.put(K.rbox(24, 8, 6, 1.5), '@abs-black', { x: bx, y: 4.7, z: bz + 26 });   // the snap
  K.put(K.cyl(2.2, 2.2, 3, 12), 'metal', { rx: Math.PI / 2, x: bx - 6.3, y: 9, z: bz + 23 });
  K.put(K.cyl(3.0, 3.0, 3, 6), 'metal', { rx: Math.PI / 2, x: bx + 6.3, y: 9, z: bz + 23 });
  K.label('9V', 12, 8, { x: bx, y: 17.52, z: bz + 4 }, { color: '#f2f2ee', weight: 800 });
  leadTo(K, [bx - 4, 6, bz + 29], [K.pinsMm[0].x, K.pinsMm[0].y, 0], '@abs-red');
  leadTo(K, [bx + 4, 6, bz + 29], [K.pinsMm[1].x, K.pinsMm[1].y, 0], '@abs-black');
  return K.finish();
}
export function buildPack(K) {
  const n = K.def.model.cells || 2;
  const W = n * 15 + 3, D = 58, bx = G, bz = -D / 2 - 18;
  K.put(K.rbox(W, 8, D, 2), 'body', { x: bx, y: 0, z: bz });
  for (let i = 0; i < n; i++) {
    const x = bx - W / 2 + 9 + i * 15;
    K.put(K.cyl(7.2, 7.2, 48, 20), 'cell', { rx: Math.PI / 2, x, y: 8.4, z: bz });
    K.put(K.cyl(2.5, 2.5, 1.6, 12), 'metal', { rx: Math.PI / 2, x, y: 8.4, z: bz + (i % 2 ? -24.8 : 24.8) });
  }
  leadTo(K, [bx - 3, 4, bz + D / 2], [K.pinsMm[0].x, K.pinsMm[0].y, 0], '@abs-red');
  leadTo(K, [bx + 3, 4, bz + D / 2], [K.pinsMm[1].x, K.pinsMm[1].y, 0], '@abs-black');
  return K.finish();
}
export function buildSolar(K) {
  const W = 80, D = 60, bx = G, bz = -D / 2 - 8;
  K.put(K.rbox(W, 3, D, 1.5), 'body', { x: bx, y: 0.5, z: bz });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    K.put(K.box(W / 4 - 2, 0.3, D / 3 - 2), 'cell', { x: bx - W / 2 + (i + 0.5) * W / 4, y: 3.6, z: bz - D / 2 + (j + 0.5) * D / 3 });
  }
  for (const p of K.pinsMm) {
    K.put(K.box(4, 4, 6), '@abs-black', { x: p.x, y: 2, z: -3 });
    K.put(K.cyl(1.0, 1.0, 1, 10), 'metal', { x: p.x, y: p.y, z: 0 });
  }
  return K.finish();
}
export function buildShield(K) {
  const W = 100, D = 30, bx = 1.0 * G, bz = -D / 2 + 3;
  K.put(K.rbox(W, 1.6, D, 1.5), 'pcb', { x: bx, y: 1, z: bz });
  K.put(K.box(78, 12, 22), 'body', { x: bx - 6, y: 2.6 + 6, z: bz - 2 });
  K.put(K.cyl(9, 9, 65, 22), 'cell', { rz: Math.PI / 2, x: bx - 6, y: 2.6 + 10, z: bz - 2 });
  K.put(K.box(3 * G, 7.4, 2.5), '@abs-black', { x: bx, y: 2.6 + 3.7, z: 0 });
  for (const p of K.pinsMm) K.put(K.box(0.9, 0.2, 0.9), '@board-hole', { x: p.x, y: p.y + 0.02, z: 0 });
  const sw = K.mesh(K.box(3, 2.5, 2), '@abs-white', { x: bx + 40, y: 4, z: bz - 10 });
  const ledM = glowMat(K, '#3aff4a');
  K.mesh(K.box(1.6, 0.6, 0.8), null, { x: bx + 40, y: 3, z: bz + 6 }, { material: ledM, pick: false });
  const set = p => { sw.position.x = bx + 40 + (p.on ? 0.8 : -0.8); lampOn(ledM, p.on); };
  set(K.params); K.onParams(set);
  return K.finish({ interact: { kind: 'toggle', key: 'on', meshes: [sw] } });
}

// ---------------------------------------------------------------- output on the mat
export function buildSpeaker(K) {
  const sx = G, sz = -26;
  K.put(K.cyl(20, 20, 4, 36), 'body', { x: sx, y: 2, z: sz });
  const cone = K.mesh(K.cyl(17, 6, 2.2, 32), 'cone', { x: sx, y: 4.2, z: sz });
  K.put(K.cyl(6.2, 6.2, 1.8, 20), '@abs-dark', { x: sx, y: 4.6, z: sz });
  for (const p of K.pinsMm) K.put(K.box(2.4, 1.2, 7), 'metal', { x: p.x, y: p.y - 0.6, z: -3 });
  let t = 0;
  K.onState((f, dt) => {
    t += dt;
    const a = f && f.vis ? Math.min(1, f.vis.amp || 0) : 0;
    cone.position.y = 4.2 + a * 0.35 * Math.sin(t * 70);
  });
  return K.finish();
}
export function buildMotor(K) {
  const { THREE } = K;
  const r = 10, L = 25, cz = 1.5 * G, cy = r + 1;
  K.put(K.box(20, 4, 18), '@abs-dark', { x: 15, y: 2, z: cz });                // cradle
  K.put(K.cyl(r, r, L, 28), 'body', { rz: Math.PI / 2, x: 2 + L / 2, y: cy, z: cz });
  K.put(K.cyl(r * 0.96, r * 0.96, 3, 28), 'cap', { rz: Math.PI / 2, x: 0.5, y: cy, z: cz });
  for (const p of K.pinsMm) K.put(K.box(0.4, 7, 2.2), 'metal', { x: p.x, y: p.y - 3.5, z: p.z });
  K.put(K.cyl(2.6, 2.6, 2, 14), 'body', { rz: Math.PI / 2, x: 2 + L + 1, y: cy, z: cz });
  const pivot = new THREE.Group();
  pivot.position.set(2 + L + 2, cy, cz);
  K.group.add(pivot);
  K.mesh(K.cyl(1, 1, 8, 10), 'shaft', { rz: Math.PI / 2, x: 4 }, { parent: pivot });
  const wheel = K.mesh(K.cyl(9, 9, 2.4, 6), 'wheel', { rz: Math.PI / 2, x: 7 }, { parent: pivot });
  K.mesh(K.box(1.2, 16, 1.8), '@abs-dark', { x: 8.4 }, { parent: pivot, pick: false });
  let ang = 0;
  K.onState((f, dt) => {
    const w = f && f.vis ? (f.vis.omega || 0) : 0;
    ang += Math.max(-40, Math.min(40, w)) * dt;
    pivot.rotation.x = ang;
  });
  return K.finish({ spinner: wheel });
}
export function buildServo(K) {
  const { THREE } = K;
  const bx = G, bz = -45;
  K.put(K.box(23, 22.5, 12.2), 'body', { x: bx, y: 11.25, z: bz });
  K.put(K.box(32.5, 2.5, 12.2), 'body', { x: bx, y: 16, z: bz });
  K.put(K.cyl(5.8, 5.8, 4, 20), 'body', { x: bx + 5.9, y: 24.5, z: bz });
  const pivot = new THREE.Group();
  pivot.position.set(bx + 5.9, 27, bz);
  K.group.add(pivot);
  const horn = K.mesh(K.rbox(4, 1.6, 20, 1.8), 'horn', { y: 0, z: -7 }, { parent: pivot });
  K.mesh(K.cyl(3.2, 3.2, 2.2, 16), 'horn', { y: 0.2 }, { parent: pivot });
  // three-wire cable from the case to the connector at the pins
  const cols = ['@abs-yellow', '@abs-red', '@abs-dark'];
  K.pinsMm.forEach((p, i) => K.lead([[bx - 11, 4, bz + 3 + i * 1.1], [bx - 14, 2, bz + 20], [p.x, 1.4, -14], [p.x, 1.4, -5]], cols[i], 0.5));
  K.put(K.box(3 * G, 2.6, 14), 'cable', { x: G, y: 1.3, z: -7 });
  for (const p of K.pinsMm) K.put(K.box(1, 0.2, 1), '@board-hole', { x: p.x, y: p.y + 0.11, z: 0 });
  K.onState(f => {
    const a = f && f.vis && f.vis.angle != null ? f.vis.angle : 90;
    pivot.rotation.y = ((90 - a) * Math.PI) / 180;
  });
  return K.finish({ horn });
}
export function buildLamp(K) {
  const lx = 1.5 * G, lz = -10;
  K.put(K.rbox(22, 6, 16, 2), 'body', { x: lx, y: 0, z: lz + 4 });
  K.put(K.cyl(4.2, 4.2, 7, 16), 'metal', { x: lx, y: 9.5, z: lz });
  const bulb = K.mesh(K.sphere(5.6, 18, 12), 'glass', { x: lx, y: 18, z: lz });
  bulb.userData.noChar = true;
  const fil = K.mesh(K.cyl(0.25, 0.25, 4, 6), '@tin', { rz: Math.PI / 2, x: lx, y: 18, z: lz }, { pick: false });
  const gl = K.glow(fil, '#ffb050', 34, [lx, 18, lz], { peak: EMIT.led });
  for (const p of K.pinsMm) K.put(K.cyl(1.6, 1.6, 1.4, 12), '@brass', { x: p.x, y: p.y - 0.7, z: 0 });
  K.onState(f => K.setGlow(gl, f && f.vis ? (f.vis.b ?? (f.vis.on ? 1 : 0)) : 0));
  return K.finish();
}

// ---------------------------------------------------------------- header modules
function headerRow(K, pcbY, female = false) {
  for (const p of K.pinsMm) K.leg(p.x, p.z, pcbY + 2.2, 'legs', 0.6);
  const xs = K.pinsMm.map(p => p.x), zs = K.pinsMm.map(p => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  K.put(K.box(x1 - x0 + G, female ? 8.5 : 2.5, z1 - z0 + 2.5), '@abs-black', { x: (x0 + x1) / 2, y: female ? pcbY + 1.6 + 4.25 : pcbY - 1.25, z: (z0 + z1) / 2 });
  return { x0, x1, z0, z1 };
}
export function buildJoystick(K) {
  const { THREE } = K;
  const pcbY = 2.5;
  const h = headerRow(K, pcbY);
  const cx = (h.x0 + h.x1) / 2, cz = -17;
  K.put(K.rbox(26, 1.6, 34, 1.5), 'pcb', { x: cx, y: pcbY, z: cz + 2 });
  K.put(K.box(16, 9, 16), 'body', { x: cx, y: pcbY + 1.6 + 4.5, z: cz });
  const pivot = new THREE.Group();
  pivot.position.set(cx, pcbY + 11, cz);
  K.group.add(pivot);
  K.mesh(K.cyl(1.5, 1.5, 8, 10), 'body', { y: 4 }, { parent: pivot });
  const cap = K.mesh(K.cyl(7, 8, 5, 24), 'cap', { y: 9.5 }, { parent: pivot });
  const set = p => {
    pivot.rotation.z = -(p.x - 0.5) * 0.7;
    pivot.rotation.x = (p.y - 0.5) * 0.7;
    pivot.position.y = pcbY + 11 - (p.sw ? 0.8 : 0);
  };
  set(K.params); K.onParams(set);
  K.label('GND +5V VRX VRY SW', 14, 2, { x: cx, y: pcbY + 1.62, z: -2 }, { color: '#f4f4f0', font: 'mono' });
  return K.finish({ interact: { kind: 'knob', key: 'x', keys: ['x', 'y', 'sw'], meshes: [cap] } });
}
export function buildKeypad(K) {
  const pcbY = 1.2;
  const h = headerRow(K, pcbY);
  const cx = (h.x0 + h.x1) / 2;
  K.put(K.box(18, 0.3, 26), 'cable', { x: cx, y: pcbY + 0.15, z: -14 });
  const W = 69, D = 76, mz = -27 - D / 2;
  K.put(K.rbox(W, 1, D, 3), 'body', { x: cx, y: pcbY, z: mz });
  const keys = [], labels = K.def.keyLabels || {};
  for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) {
    const key = `k${r}${c}`;
    const m = K.mesh(K.rbox(13, 1.2, 13, 2), 'cap', { x: cx - W / 2 + 10 + (c - 1) * 16.3, y: pcbY + 1, z: mz - D / 2 + 12 + (r - 1) * 16.5 });
    m.userData.key = key;
    keys.push(m);
    K.label(labels[key] || '', 8, 8, { x: m.position.x, y: pcbY + 2.25, z: m.position.z }, { color: '#1e1f22', weight: 700 });
  }
  const set = p => { for (const m of keys) m.position.y = pcbY + 1 - (p[m.userData.key] ? 0.6 : 0); };
  set(K.params); K.onParams(set);
  return K.finish({ interact: { kind: 'press', key: 'k11', keys: keys.map(m => m.userData.key), meshes: keys, keyOf: m => m.userData.key } });
}
export function buildModule(K) {
  const m = K.def.model;
  const free = K.def.mount === 'free';
  const pcbY = free ? 0.4 : 9;
  const xs = K.pinsMm.map(p => p.x), zs = K.pinsMm.map(p => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs);
  const w = Math.max(m.bodyW || 20, x1 - x0 + 5), d = m.bodyD || 20;
  const cx = (x0 + x1) / 2, cz = free ? z0 - d / 2 + 2.5 : 2.5 - d / 2;
  if (free) {
    K.put(K.box(x1 - x0 + G, 8.5, Math.max(...zs) - z0 + 2.5), '@abs-black', { x: cx, y: pcbY + 1.6 + 4.25, z: (z0 + Math.max(...zs)) / 2 });
    for (const p of K.pinsMm) K.put(K.box(0.9, 0.2, 0.9), '@board-hole', { x: p.x, y: p.y + 0.02, z: p.z });
  } else headerRow(K, pcbY);
  K.put(K.rbox(w, 1.6, d, 1.2), 'pcb', { x: cx, y: pcbY, z: cz });
  const ty = pcbY + 1.6;
  const tz = cz - (free ? 0 : 2);
  switch (m.top) {
    case 'lens':
      K.put(K.box(Math.min(w, d) * 0.62, 4, Math.min(w, d) * 0.62), 'top', { x: cx, y: ty + 2, z: tz });
      K.put(K.cyl(1.2, 1.2, 0.4, 10), '@chrome', { x: cx, y: ty + 4.2, z: tz });
      break;
    case 'screen':
      K.put(K.box(w * 0.92, 2.2, d * 0.78), '@abs-black', { x: cx, y: ty + 1.1, z: tz });
      K.put(K.box(w * 0.86, 0.3, d * 0.72), 'top', { x: cx, y: ty + 2.35, z: tz });
      break;
    case 'coil':
      for (const [sx, sz, lx, lz] of [[0, -0.42, 0.8, 0.04], [0, 0.42, 0.8, 0.04], [-0.4, 0, 0.04, 0.84], [0.4, 0, 0.04, 0.84]]) {
        K.put(K.box(w * lx, 0.1, d * lz * 0.6), 'top', { x: cx + w * sx, y: ty + 0.06, z: tz - d * 0.15 + d * sz * 0.6 });
      }
      K.put(K.box(6, 1.2, 6), 'body', { x: cx, y: ty + 0.6, z: tz + d * 0.3 });
      break;
    case 'antenna':
      K.put(K.box(6, 1.2, 6), 'body', { x: cx, y: ty + 0.6, z: tz + 4 });
      K.put(K.cyl(3.2, 3.2, 10, 14), 'body', { rx: Math.PI / 2, x: cx, y: ty + 4, z: cz - d / 2 - 3 });
      K.put(K.cyl(4, 3.4, 26, 14), 'top', { rx: Math.PI / 2, x: cx, y: ty + 4, z: cz - d / 2 - 21 });
      break;
    default:
      K.put(K.box(Math.min(10, w * 0.4), 1.4, Math.min(10, d * 0.4)), 'body', { x: cx, y: ty + 0.7, z: tz });
  }
  K.put(K.box(1.6, 1.0, 0.8), '@ceramic-tan', { x: cx + w * 0.35, y: ty + 0.5, z: cz + d * 0.3 });
  K.label(m.label || '', Math.min(w * 0.6, 18), 3.2, { x: cx - w * 0.15, y: ty + 0.02, z: cz + d / 2 - 4 }, { color: '#f4f4f0', weight: 700 });
  return K.finish();
}
