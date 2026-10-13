// ============================================================================
//  BREADBOARD LAB  ·  parts/models/instruments.js — DMM, scope, logic analyzer
// ----------------------------------------------------------------------------
//  Instruments are models for the probes of the document (Probe.type 'dmm',
//  'scope', 'logic'). They have no pins. `leads` gives the jack positions
//  where the view hangs the probe leads (part-local mm).
//
//  THE DMM DRAWS ITS OWN DIGITS. setState takes the probe frame
//  { kind:'dmm', value, unit, overload, fuse } (bare, or wrapped as
//  { probe } the way the view passes it) and shows 4 digits with an
//  SI prefix lamp (µ m k M) and a unit lamp (V A Ω). setSettings turns the
//  dial to the mode. The scope and the analyzer screens are canvases that the
//  UI draws on (screens.main); in node they are plain dark glass.
//
//  GREP MAP
//    dmmText ................ value -> { text, prefix } in 4 digits
//    buildDmm ............... boot, face, dial, segment display, jacks
//    buildScope ............. case, screen canvas, knobs, BNC jacks ch1..ch4
//    buildLogic ............. pod with a 10-pin header and a status LED
// ============================================================================
import { segDisplay } from './segments.js';
import { makeScreen } from '../labels.js';

const PREFIX = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ']];
// 4 significant digits that fit in 4 cells (plus the point) and the prefix
export function dmmText(value, unit) {
  if (value == null || !Number.isFinite(value)) return { text: ' OL ', prefix: '' };
  const a = Math.abs(value);
  let pre = '', s = 1;
  if (a !== 0) for (const [m, p] of PREFIX) { if (a >= m * 0.9999 || m === 1e-6) { pre = p; s = m; break; } }
  if (unit === 'V' && pre === 'k') { pre = ''; s = 1; }
  const v = value / s;
  const intDigits = Math.max(1, Math.floor(Math.log10(Math.max(1, Math.abs(v)))) + 1);
  const dec = Math.max(0, 4 - intDigits - (v < 0 ? 1 : 0));
  let text = v.toFixed(dec);
  if (text.replace(/[-.]/g, '').length > 4) text = v.toFixed(Math.max(0, dec - 1));
  return { text, prefix: pre };
}

const lamp = (K, color) => {   // a small indicator that can glow
  const m = K.own(new K.THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }));
  m.emissive = new K.THREE.Color(color); m.emissiveIntensity = 0;
  return m;
};

export function buildDmm(K) {
  const { THREE } = K;
  const W = 84, D = 160, H = 34, cx = 0, cz = -D / 2;
  K.put(K.rbox(W, H, D, 10, 4), 'body', { x: cx, y: 0, z: cz });
  K.put(K.rbox(W - 12, 1, D - 16, 6, 3), 'face', { x: cx, y: H, z: cz });
  K.put(K.rbox(W - 22, 1, 30, 3, 2), 'screen', { x: cx, y: H + 1, z: cz - D / 2 + 30 });
  const disp = segDisplay(THREE, { digits: 4, h: 14, w: 7.6, gap: 3.6, on: '#14180c', off: '#a6b86a', y: H + 2.05, slant: 0.08 });
  disp.mesh.position.set(cx - disp.width / 2 - 4, 0, cz - D / 2 + 29);
  K.group.add(disp.mesh); K.own(disp.mesh.geometry); K.own(disp.mesh.material);
  const lamps = {};
  ['µ', 'm', 'k', 'M', 'V', 'A', 'Ω'].forEach((n, i) => {
    const m = lamp(K, '#e8f0d0');
    K.mesh(K.box(3.2, 0.3, 2.2), null, { x: cx + 22 + (i > 3 ? 4 : 0), y: H + 2.1, z: cz - D / 2 + 18 + (i % 4) * 5 }, { material: m, pick: false });
    lamps[n] = m;
  });
  K.label(['µ', 'm', 'k', 'M'], 3, 18, { x: cx + 18.5, y: H + 2.1, z: cz - D / 2 + 25.5 }, { color: '#1d2410' });
  K.label(['V', 'A', 'Ω'], 3, 14, { x: cx + 30.5, y: H + 2.1, z: cz - D / 2 + 23 }, { color: '#1d2410' });
  // the dial
  const pivot = new THREE.Group();
  pivot.position.set(cx, H + 1, cz + 6);
  K.group.add(pivot);
  const dial = K.mesh(K.cyl(17, 18, 6, 32), 'knob', { y: 3 }, { parent: pivot });
  K.mesh(K.box(4, 2, 30), 'knob', { y: 6.5 }, { parent: pivot });
  K.mesh(K.box(1, 0.4, 10), '@silk-white', { y: 7.6, z: -9 }, { parent: pivot, pick: false });
  K.label(['V    A', '', 'Ω    ))) '], 44, 44, { x: cx, y: H + 1.02, z: cz + 6 }, { color: '#e9e9e4', weight: 700 });
  // jacks: A, COM, VΩ along the bottom
  const jz = cz + D / 2 - 18, jy = H + 1;
  const jacks = { redA: [cx - 24, jy, jz], black: [cx, jy, jz], red: [cx + 24, jy, jz] };
  for (const k in jacks) {
    const [x, y, z] = jacks[k];
    K.put(K.cyl(4.6, 4.6, 2, 18), k === 'black' ? '@abs-black' : '@abs-red', { x, y: y + 1, z });
    K.put(K.cyl(2, 2, 2.2, 12), '@board-hole', { x, y: y + 1.1, z });
  }
  K.label('10A      COM      VΩ', 64, 5, { x: cx, y: jy + 0.05, z: jz + 8 }, { color: '#e9e9e4' });
  const MODE_ANGLE = { V: 0.9, A: -0.9, R: 2.3, cont: -2.3 };
  const setSettings = s => { pivot.rotation.y = MODE_ANGLE[(s && s.mode) || 'V'] ?? 0.9; };
  setSettings((K.part && K.part.settings) || { mode: 'V' });
  // a passive LCD: a lit annunciator is dark ink on the green glass
  const UNIT_MODE = { V: 'V', A: 'A', 'Ω': 'R' };
  const show = f0 => {
    const f = f0 && f0.probe !== undefined ? f0.probe : f0;     // the view passes { probe }
    const lit = new Set();
    const setMode = K.part && K.part.settings && K.part.settings.mode;
    if (f && f.kind === 'dmm' && UNIT_MODE[f.unit]) setSettings({ mode: f.unit === 'Ω' && setMode === 'cont' ? 'cont' : UNIT_MODE[f.unit] });
    if (!f || f.kind !== 'dmm') disp.setText('    ');
    else if (f.fuse === 'blown' && f.unit === 'A') disp.setText('FU5E');
    else if (f.overload) disp.setText(' OL ');
    else { const t = dmmText(f.value, f.unit); disp.setText(t.text); if (t.prefix) lit.add(t.prefix); }
    if (f && lamps[f.unit]) lit.add(f.unit);
    for (const k in lamps) lamps[k].color.set(lit.has(k) ? '#14180c' : '#a6b86a');
  };
  K.onState(show);
  show(null);
  const v = n => new THREE.Vector3(...jacks[n]);
  return K.finish({ leads: { red: v('red'), black: v('black'), redA: v('redA') }, display: disp, dial, setSettings });
}

export function buildScope(K) {
  const { THREE } = K;
  const W = 190, D = 100, H = 120, cx = 0, cz = -D / 2;
  K.put(K.rbox(W, H, D, 6, 3), 'body', { x: cx, y: 0, z: cz });
  K.put(K.box(W - 8, H - 10, 1), 'face', { x: cx, y: H / 2, z: 0.4 });
  const sw = 110, sh = 72, sx = cx - 30, sy = H / 2 + 12;
  const scr = makeScreen(THREE, 512, 320);
  const screenGeo = new THREE.PlaneGeometry(sw, sh);
  let screenMesh;
  if (scr) {
    const mat = K.own(new THREE.MeshBasicMaterial({ map: scr.texture, toneMapped: false }));
    screenMesh = K.mesh(screenGeo, null, { x: sx, y: sy, z: 1.0 }, { material: mat });
  } else screenMesh = K.mesh(screenGeo, 'screen', { x: sx, y: sy, z: 1.0 });
  K.put(K.box(sw + 6, sh + 6, 1), '@abs-black', { x: sx, y: sy, z: 0.6 });
  // knobs: timebase, 4 x V/div, trigger level
  const knob = (x, y, r) => K.mesh(K.cyl(r, r * 1.05, 6, 20), 'knob', { rx: Math.PI / 2, x, y, z: 3.5 });
  knob(cx + 52, H - 30, 9); knob(cx + 78, H - 30, 7);
  for (let i = 0; i < 4; i++) knob(cx + 36 + (i % 2) * 26, H - 58 - Math.floor(i / 2) * 22, 6);
  // BNC jacks along the bottom
  const leads = {};
  const names = ['ch1', 'ch2', 'ch3', 'ch4', 'gnd'];
  const colors = ['#ffd21a', '#3ad6ff', '#ff4ad2', '#4aff6a', '#cccccc'];
  names.forEach((n, i) => {
    const x = cx - 80 + i * 26, y = 16, z = 1;
    K.put(K.cyl(5, 5, 6, 18), 'metal', { rx: Math.PI / 2, x, y, z: z + 3 });
    K.put(K.cyl(2.2, 2.2, 6.4, 12), '@board-hole', { rx: Math.PI / 2, x, y, z: z + 3.1 });
    const m = lamp(K, colors[i]);
    K.mesh(K.box(8, 1.2, 0.6), null, { x, y: y + 9, z: z + 0.3 }, { material: m, pick: false }).userData.lamp = n;
    m.emissiveIntensity = 0.8;
    leads[n] = new THREE.Vector3(x, y, z + 6);
  });
  K.label('CH1    CH2    CH3    CH4    GND', 130, 5, { rx: Math.PI / 2, x: cx - 28, y: 30, z: 1.0 }, { color: '#cfd2d6' });
  let t = 0;
  K.onState((f, dt) => {
    t += dt;
    if (scr) scr.texture.needsUpdate = true;
  });
  return K.finish({ leads, screens: scr ? { main: scr } : {}, screen: screenMesh });
}

export function buildLogic(K) {
  const { THREE } = K;
  const W = 56, D = 34, H = 13, cx = 0, cz = -D / 2;
  K.put(K.rbox(W, H, D, 4, 3), 'body', { x: cx, y: 0, z: cz });
  K.put(K.rbox(W - 10, 0.4, D - 12, 2, 2), 'face', { x: cx, y: H, z: cz });
  K.put(K.box(26, 2.5, 5), '@abs-black', { x: cx, y: 3, z: 1.5 });
  const leads = {};
  const names = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'gnd'];
  names.forEach((n, i) => {
    const x = cx - 11.43 + i * 2.54 + (i > 7 ? 2.54 : 0);
    K.put(K.box(0.64, 0.64, 6), 'metal', { x, y: 3, z: 3.5 });
    leads[n] = new THREE.Vector3(x, 3, 6.5);
  });
  const st = lamp(K, '#3aff6a');
  K.mesh(K.cyl(1.2, 1.2, 0.6, 12), null, { x: cx + 20, y: H + 0.3, z: cz + 6 }, { material: st, pick: false });
  K.label(['LOGIC 8CH', 'D0 ... D7  GND'], 36, 12, { x: cx, y: H + 0.45, z: cz }, { color: '#e9e9e4' });
  const scr = makeScreen(THREE, 256, 64);
  K.onState(f0 => {
    const f = f0 && f0.probe !== undefined ? f0.probe : f0;
    st.emissiveIntensity = f && f.kind === 'logic' ? 1.8 : 0.2;
  });
  return K.finish({ leads, screens: scr ? { main: scr } : {} });
}
