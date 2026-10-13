// ============================================================================
//  WASM-4 ARCADE  ·  props.js — the things on the desk
// ----------------------------------------------------------------------------
//  buildProps(root) adds them to root and returns { keyboard, cans, papers }.
//  All are original shapes with canvas textures. The cans carry generic
//  words ("COLA", "LIME"), no real brand, logo or trademark.
//
//    keyboard  a 60 % board with a separate arrow cluster, one mesh per key
//              (64 keys). The top face of each key maps to its cell of one
//              legend atlas. The game keys have colours: arrows green, X and
//              Z orange, the second player keys blue, R red, Esc yellow.
//              keyboard.press(code, down) moves a key by KeyboardEvent.code;
//              keyboard.update(dt) eases the keys.
//    cans      three drink cans: two stand, one lies on its side
//    papers    four crumpled paper balls: an icosahedron pushed out by a
//              noise of its direction, flat shaded
//    cup       a pen cup with two pencils; a loose pen
//    notes     two sticky notes: one on the TV shell, one on the desk
//
//  grep -n targets  "export function buildProps"  "const ROWS"
//                   "function buildKeyboard"  "function buildCan"
//                   "function buildPaper"  "function buildCup"  "function stickyNote"
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeCanvas, canvasTex, noise2, rng } from './tex.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
const shadowAll = g => { g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g; };

// ----------------------------------------------------------------- keyboard
const U = 2.0;   // one key unit in cm
// [legend, KeyboardEvent.code, width in units]
export const ROWS = [
  [['Esc', 'Escape'], ['1', 'Digit1'], ['2', 'Digit2'], ['3', 'Digit3'], ['4', 'Digit4'], ['5', 'Digit5'], ['6', 'Digit6'], ['7', 'Digit7'], ['8', 'Digit8'], ['9', 'Digit9'], ['0', 'Digit0'], ['-', 'Minus'], ['=', 'Equal'], ['Bksp', 'Backspace', 2]],
  [['Tab', 'Tab', 1.5], ['Q', 'KeyQ'], ['W', 'KeyW'], ['E', 'KeyE'], ['R', 'KeyR'], ['T', 'KeyT'], ['Y', 'KeyY'], ['U', 'KeyU'], ['I', 'KeyI'], ['O', 'KeyO'], ['P', 'KeyP'], ['[', 'BracketLeft'], [']', 'BracketRight'], ['\\', 'Backslash', 1.5]],
  [['Caps', 'CapsLock', 1.75], ['A', 'KeyA'], ['S', 'KeyS'], ['D', 'KeyD'], ['F', 'KeyF'], ['G', 'KeyG'], ['H', 'KeyH'], ['J', 'KeyJ'], ['K', 'KeyK'], ['L', 'KeyL'], [';', 'Semicolon'], ["'", 'Quote'], ['Enter', 'Enter', 2.25]],
  [['Shift', 'ShiftLeft', 2.25], ['Z', 'KeyZ'], ['X', 'KeyX'], ['C', 'KeyC'], ['V', 'KeyV'], ['B', 'KeyB'], ['N', 'KeyN'], ['M', 'KeyM'], [',', 'Comma'], ['.', 'Period'], ['/', 'Slash'], ['Shift', 'ShiftRight', 2.75]],
  [['Ctrl', 'ControlLeft', 1.25], ['Fn', 'Fn', 1.25], ['Alt', 'AltLeft', 1.25], ['', 'Space', 7.25], ['Alt', 'AltRight', 1.25], ['Menu', 'ContextMenu', 1.25], ['Ctrl', 'ControlRight', 1.5]],
];
// the arrow cluster: [legend, code, column (units from the left), row]
const ARROWS = [['▲', 'ArrowUp', 16.5, 3], ['◀', 'ArrowLeft', 15.5, 4], ['▼', 'ArrowDown', 16.5, 4], ['▶', 'ArrowRight', 17.5, 4]];
const CAP = {
  game: ['#86d9a2', '#14301f', ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']],
  xz: ['#ffb35c', '#3a1d00', ['KeyX', 'KeyZ']],
  p2: ['#9cc7ff', '#0e2240', ['KeyE', 'KeyS', 'KeyD', 'KeyF', 'KeyA', 'Tab']],
  reset: ['#ff8a7a', '#3d0d06', ['KeyR']],
  esc: ['#ffe27a', '#3a2c00', ['Escape']],
};
const MODS = new Set(['Backspace', 'Tab', 'CapsLock', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'Fn', 'AltLeft', 'AltRight', 'ContextMenu', 'ControlRight']);
export function capStyle(code) {
  for (const k in CAP) if (CAP[k][2].includes(code)) return { bg: CAP[k][0], ink: CAP[k][1] };
  return MODS.has(code) ? { bg: '#b9b2a5', ink: '#2a2620' } : { bg: '#ece6da', ink: '#2e2a24' };
}

export function keyList() {
  const out = [];
  ROWS.forEach((row, r) => { let x = 0; for (const [leg, code, w = 1] of row) { out.push({ leg, code, w, x, r }); x += w; } });
  for (const [leg, code, x, r] of ARROWS) out.push({ leg, code, w: 1, x, r });
  return out;
}

function buildKeyboard(root) {
  const keys = keyList(), g = new THREE.Group(); g.name = 'keyboard';
  const N = 10, CS = 102, cv = makeCanvas(N * CS, N * CS), c = cv.getContext('2d');
  keys.forEach((k, i) => {
    const cx = (i % N) * CS, cy = Math.floor(i / N) * CS, st = capStyle(k.code);
    c.fillStyle = st.bg; c.fillRect(cx, cy, CS, CS);
    c.save(); c.translate(cx + CS / 2, cy + CS / 2); c.scale(1 / k.w, 1);
    c.fillStyle = st.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
    const big = k.leg.length === 1;
    c.font = `${big ? 'bold 50' : '600 30'}px ui-sans-serif, system-ui, sans-serif`;
    c.fillText(k.leg, 0, 2);
    c.restore();
  });
  const atlas = canvasTex(THREE, cv);
  const topM = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55 });
  const sideM = new Map();
  const W = 18.5 * U + 1.6, D = 5 * U + 1.6;
  const base = new THREE.Mesh(new RoundedBoxGeometry(W, 1.8, D, 2, 0.6), std(0x2f2c33, { roughness: 0.5 }));
  base.position.set(0, 0.9, 0); g.add(base);
  const map = new Map();
  keys.forEach((k, i) => {
    const kw = k.w * U - 0.32, geo = new THREE.BoxGeometry(kw, 1.0, U - 0.32);
    // top face (+y) = vertices 8..11; map its uv to cell i of the atlas
    const uv = geo.attributes.uv, u0 = (i % N) / N, v0 = 1 - (Math.floor(i / N) + 1) / N;
    for (let j = 8; j < 12; j++) uv.setXY(j, u0 + uv.getX(j) / N, v0 + uv.getY(j) / N);
    const st = capStyle(k.code);
    if (!sideM.has(st.bg)) sideM.set(st.bg, std(new THREE.Color(st.bg).multiplyScalar(0.8), { roughness: 0.55 }));
    const sm = sideM.get(st.bg);
    const m = new THREE.Mesh(geo, [sm, sm, topM, sm, sm, sm]);
    const x = -W / 2 + 0.8 + (k.x + k.w / 2) * U, z = -D / 2 + 0.8 + (k.r + 0.5) * U;
    m.position.set(x, 1.8 + 0.5, z);
    m.userData.rest = m.position.y; m.userData.down = 0; m.userData.target = 0;
    m.name = 'key-' + k.code;
    g.add(m); map.set(k.code, m);
  });
  g.position.set(0, 0, 24); g.rotation.y = -0.03;
  root.add(shadowAll(g));
  return {
    group: g, keys: map, size: [W, D],
    press(code, down) { const m = map.get(code); if (m) m.userData.target = down ? 1 : 0; },
    update(dt) {
      const k = 1 - Math.exp(-dt * 40);
      for (const m of map.values()) {
        const u = m.userData; if (u.down === u.target) continue;
        u.down += (u.target - u.down) * k; if (Math.abs(u.down - u.target) < 0.01) u.down = u.target;
        m.position.y = u.rest - 0.55 * u.down;
      }
    },
  };
}

// --------------------------------------------------------------------- cans
function canTexture(word, bg, ink, seed) {
  const W = 512, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d'), r = rng(seed);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.moveTo(0, 150);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, 150 + 16 * Math.sin(x / W * Math.PI * 4 + r()));
  g.lineTo(W, 172); for (let x = W; x >= 0; x -= 8) g.lineTo(x, 172 + 12 * Math.sin(x / W * Math.PI * 4 + 1)); g.fill();
  g.fillStyle = ink; g.font = 'italic 900 78px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const x of [W * 0.25, W * 0.75]) g.fillText(word, x, 92);
  g.font = '600 20px ui-sans-serif, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const x of [W * 0.25, W * 0.75]) g.fillText('355 ml · fizzy', x, 214);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 10, W, 4); g.fillRect(0, H - 14, W, 4);
  return cv;
}
function lidTexture() {
  const S = 128, cv = makeCanvas(S, S), g = cv.getContext('2d');
  g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#8d9196'; g.lineWidth = 5; g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#9fa3a8'; g.beginPath(); g.ellipse(S / 2, S * 0.36, 16, 26, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5c6066'; g.beginPath(); g.ellipse(S / 2, S * 0.66, 14, 18, 0, 0, Math.PI * 2); g.fill();
  return cv;
}
function buildCan(root, o) {
  const g = new THREE.Group(); g.name = 'can';
  const side = new THREE.MeshStandardMaterial({ map: canvasTex(THREE, canTexture(o.word, o.bg, o.ink, o.seed)), metalness: 0.35, roughness: 0.35 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.85, roughness: 0.3 });
  const lid = new THREE.MeshStandardMaterial({ map: canvasTex(THREE, lidTexture()), metalness: 0.8, roughness: 0.32 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 11, 40), [side, metal, metal]);
  body.position.y = 0.6 + 5.5; g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 3.3, 0.9, 40), [metal, lid, metal]);
  neck.position.y = 0.6 + 11 + 0.45; g.add(neck);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 2.6, 0.6, 40), metal);
  foot.position.y = 0.3; g.add(foot);
  if (o.lying) { g.rotation.z = Math.PI / 2; g.position.set(o.x, 3.3, o.z); g.rotateX(o.roll || 0); }
  else g.position.set(o.x, 0, o.z);
  g.rotation.y = o.ry || 0;
  root.add(shadowAll(g));
  return g;
}

// ------------------------------------------------------------------- papers
function buildPaper(root, x, z, r, seed) {
  const geo = new THREE.IcosahedronGeometry(r, 3), p = geo.attributes.position, n = noise2(seed), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const a = Math.atan2(v.z, v.x) * 3.3 + 10, b = Math.acos(Math.max(-1, Math.min(1, v.y))) * 4.2 + 10;
    const s = 0.78 + 0.42 * n(a * 1.7, b * 1.7) + 0.1 * n(a * 5, b * 5);
    p.setXYZ(i, v.x * r * s, v.y * r * s * 0.92, v.z * r * s);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, std(0xefebe0, { roughness: 0.95, flatShading: true }));
  m.position.set(x, r * 0.78, z); m.rotation.set(seed, seed * 2, seed * 0.5);
  m.name = 'paper';
  root.add(shadowAll(m));
  return m;
}

// ---------------------------------------------------------------- cup, pens
function pencil(len, color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 6), std(color, { roughness: 0.5 }));
  body.position.y = len / 2; g.add(body);
  const wood = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.4, 6), std(0xe7c79a));
  wood.position.y = len + 0.7; g.add(wood);
  const lead = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.47, 6), std(0x333333));
  lead.position.y = len + 1.4 - 0.47 / 2 + 0.24; g.add(lead);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.7, 12), std(0xb8b8b8, { metalness: 0.7, roughness: 0.3 }));
  band.position.y = -0.35; g.add(band);
  const eraser = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.8, 12), std(0xf08aa0));
  eraser.position.y = -1.1; g.add(eraser);
  return g;
}
function buildCup(root, x, z) {
  const g = new THREE.Group(); g.name = 'cup';
  const prof = [[0, 0], [3.6, 0], [3.9, 9.5], [3.5, 9.5], [3.25, 0.9], [0, 0.9]].map(([a, b]) => new THREE.Vector2(a, b));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), std(0x2f8f8a, { roughness: 0.3 }));
  g.add(cup);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.6, 10, 20, Math.PI), std(0x2f8f8a, { roughness: 0.3 }));
  handle.rotation.z = -Math.PI / 2; handle.position.set(3.7, 4.9, 0); g.add(handle);
  const p1 = pencil(13, 0xf2c230); p1.position.set(-0.8, 1.2, 0.5); p1.rotation.set(0.12, 0, 0.22); g.add(p1);
  const p2 = pencil(12, 0x3d6fd8); p2.position.set(1, 1.2, -0.6); p2.rotation.set(-0.15, 0, -0.18); g.add(p2);
  g.position.set(x, 0, z); g.rotation.y = 2.4;
  root.add(shadowAll(g));
  return g;
}
function buildPen(root, x, z, ry) {
  const g = new THREE.Group(); g.name = 'pen';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 12, 16), std(0x1d3a8a, { roughness: 0.35 }));
  body.rotation.z = Math.PI / 2; g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 4, 16), std(0x111111, { roughness: 0.35 }));
  cap.rotation.z = Math.PI / 2; cap.position.x = 5.2; g.add(cap);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 0.4), std(0xcccccc, { metalness: 0.8, roughness: 0.3 }));
  clip.position.set(5, 0.68, 0); g.add(clip);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 16), std(0x888888, { metalness: 0.7, roughness: 0.3 }));
  tip.rotation.z = Math.PI / 2; tip.position.x = -6.7; g.add(tip);
  g.position.set(x, 0.64, z); g.rotation.y = ry;
  root.add(shadowAll(g));
  return g;
}

// ------------------------------------------------------------- sticky notes
function stickyNote(lines, color = '#ffe873') {
  const S = 256, cv = makeCanvas(S, S), g = cv.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, S, 34);
  g.fillStyle = '#2b2f8a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 40px "Marker Felt", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive';
  lines.forEach((l, i) => g.fillText(l, S / 2, S / 2 + (i - (lines.length - 1) / 2) * 52));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.5), new THREE.MeshStandardMaterial({ map: canvasTex(THREE, cv), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.name = 'note';
  m.receiveShadow = true;
  return m;
}

// --------------------------------------------------------------------- all
export function buildProps(root) {
  const keyboard = buildKeyboard(root);
  const cans = [
    buildCan(root, { word: 'COLA', bg: '#c8202b', ink: '#ffffff', seed: 3, x: -34, z: 29, ry: 0.7 }),
    buildCan(root, { word: 'COLA', bg: '#c8202b', ink: '#ffffff', seed: 4, x: -44, z: -16, ry: -1.2 }),
    buildCan(root, { word: 'LIME', bg: '#3f9a3a', ink: '#f6ffe8', seed: 5, x: 80, z: -12, ry: 0.5, lying: true, roll: 0.9 }),
  ];
  const papers = [[-80, 30, 3.2, 1], [-60, -26, 2.8, 2], [25.5, 32, 3, 3], [82, 16, 3.4, 4], [40, -30, 2.9, 5]].map(([x, z, r, s]) => buildPaper(root, x, z, r, s));
  const cup = buildCup(root, -81, 2);
  const pen = buildPen(root, 6, 33.6, 0.12);
  const n1 = stickyNote(['R = reset', 'Esc = page']);
  n1.position.set(-26, 44, 12.05); n1.rotation.z = 0.08; root.add(n1);
  const n2 = stickyNote(['hi-score', '12,400!'], '#ffb3c7');
  n2.rotation.set(-Math.PI / 2, 0, 0.25); n2.position.set(-27, 0.05, 19); root.add(n2);
  return { keyboard, cans, papers, cup, pen, notes: [n1, n2] };
}
