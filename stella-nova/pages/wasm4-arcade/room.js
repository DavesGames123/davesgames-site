// ============================================================================
//  WASM-4 ARCADE  ·  room.js — the 3D room: desk, TV, console, cart rack
// ----------------------------------------------------------------------------
//  buildRoom() -> the three.js scene of the page, with no renderer and no
//  DOM events (view3d.js adds those). Units are centimetres. The desk top
//  is y = 0, +y is up, the camera looks along -z at the front of the desk.
//  Sizes are a little larger than real so the parts read on a phone.
//
//    desk      a wood top (DIM.desk) on two legs and a drawer unit, a back
//              wall with a poster, a floor
//    tv        a cream CRT set: front shell with a square hole (ExtrudeGeometry
//              with a hole), body, rear tube housing, feet, grille, knobs,
//              power LED, a rabbit-ear antenna. tv.glass is the curved
//              screen mesh; view3d.js gives it the CRT material (screen.js).
//    console   the WASM-4 console: body, a slot housing on top, a stripe of
//              the four default palette colours, power and reset buttons
//              (pick targets), an LED. con.slot is the centre of a seated cart.
//    rack      a stepped stand of DIM.rack.rows x DIM.rack.cols cart slots;
//              rack.slots[i] is the centre of cart i when it stands there
//    lamp      a desk lamp with the warm spot light that makes the shadows
//    props     keyboard, cans, paper balls, a pen cup, a pen, sticky notes
//              (props.js)
//    lights    hemisphere fill, the lamp spot, a soft front fill, and the
//              screen glow (a point light that view3d.js tints each frame)
//
//  frameFor(mode, aspect, fov) -> { pos, target }: a camera that fits the
//  key points of a view ('tv': the TV fills the frame; 'desk': TV, console,
//  rack and keyboard) in a viewport of that aspect. Pure maths, tested.
//
//  No two parts have coplanar faces that face the same way: shells are
//  inset by 0.5 cm, decals lie 0.04 cm out and use polygonOffset.
//
//  grep -n targets
//    "export const DIM"        "export function buildRoom"   "function buildTV"
//    "function buildConsole"   "function buildRack"          "function buildDesk"
//    "function buildLamp"      "export function frameFor"    "export const KEYPOINTS"
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeCanvas, canvasTex, noise2, rng } from './tex.js';
import { buildProps } from './props.js';

export const DIM = {
  desk: { x0: -88, x1: 88, z0: -46, z1: 36, th: 4, legH: 70 },
  wallZ: -49,
  tv: { w: 60, h: 56, y0: 2, zFront: 12, zBack: -37, hole: 42, holeY: 33 },
  console: { x: -54, z: 15, w: 30, h: 7, d: 20 },
  rack: { x: 52, z: 25, cols: 5, rows: 4, dx: 8.4, dy: 5.5, dz: 4.4, lean: -0.1 },
  cart: { w: 7.6, h: 9, t: 1.5, sink: 4 },
};

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...o });
const decal = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.7, transparent: !!o.transparent, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });

function shadow(m, cast = true, receive = true) {
  m.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return m;
}

// A rounded rectangle path centred on (cx, cy).
export function rrect(path, w, h, r, cx = 0, cy = 0) {
  const x = cx - w / 2, y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

// ------------------------------------------------------------------ textures
function woodTexture() {
  const W = 1024, H = 512, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const n = noise2(7), r = rng(11);
  g.fillStyle = '#8a5a36'; g.fillRect(0, 0, W, H);
  // planks along x, grain lines that wander
  for (let p = 0; p < 4; p++) {
    const y0 = p * H / 4, tint = 0.9 + r() * 0.2;
    g.fillStyle = `rgba(${Math.round(120 * tint)},${Math.round(78 * tint)},${Math.round(46 * tint)},0.55)`;
    g.fillRect(0, y0, W, H / 4);
    for (let l = 0; l < 46; l++) {
      const yy = y0 + r() * H / 4, amp = 2 + r() * 6, ph = r() * 50;
      g.strokeStyle = `rgba(${50 + r() * 30},${28 + r() * 16},${14 + r() * 10},${0.12 + r() * 0.22})`;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      for (let x = 0; x <= W; x += 16) { const y = yy + amp * (n(x / 90 + ph, yy / 40) - 0.5) * 2; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(30,16,8,0.5)'; g.fillRect(0, y0, W, 2);
  }
  // a few knots
  for (let k = 0; k < 5; k++) {
    const x = r() * W, y = r() * H, rr = 5 + r() * 9;
    const gr = g.createRadialGradient(x, y, 1, x, y, rr * 2.2);
    gr.addColorStop(0, 'rgba(50,26,12,0.85)'); gr.addColorStop(0.5, 'rgba(80,46,22,0.45)'); gr.addColorStop(1, 'rgba(80,46,22,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr * 2.4, rr, 0, 0, Math.PI * 2); g.fill();
  }
  return cv;
}

function wallTexture() {
  const W = 512, H = 512, cv = makeCanvas(W, H), g = cv.getContext('2d'), r = rng(23);
  g.fillStyle = '#34464f'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.035})`; g.fillRect(r() * W, r() * H, 2, 2); }
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * W, r() * H, 2, 2); }
  return cv;
}

// An original pixel poster in the four default WASM-4 colours: a rocket.
function posterTexture() {
  const W = 320, H = 400, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const P = ['#e0f8cf', '#86c06c', '#306850', '#071821'];
  g.fillStyle = P[3]; g.fillRect(0, 0, W, H);
  const r = rng(5);
  for (let i = 0; i < 70; i++) { g.fillStyle = r() < 0.7 ? P[2] : P[1]; const s = r() < 0.85 ? 4 : 8; g.fillRect(Math.floor(r() * 40) * 8, Math.floor(r() * 36) * 8, s, s); }
  const art = [
    '.....33.....', '....3003....', '....3003....', '...300003...', '...301103...', '...301103...',
    '...300003...', '...300003...', '..33000033..', '.3330000333.', '.33.3223.33.', '....2112....', '.....11.....',
  ];
  const px = 16, ox = (W - 12 * px) / 2, oy = 70, MAP = { 0: P[0], 1: P[2], 2: P[1], 3: P[1] };
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    g.fillStyle = MAP[ch];
    g.fillRect(ox + x * px, oy + y * px, px, px);
  }));
  g.fillStyle = P[0]; g.font = 'bold 34px ui-monospace, Menlo, monospace'; g.textAlign = 'center';
  g.fillText('160 x 160', W / 2, 330);
  g.fillStyle = P[1]; g.font = 'bold 18px ui-monospace, Menlo, monospace';
  g.fillText('FOUR COLOURS  64 KB', W / 2, 362);
  g.strokeStyle = P[0]; g.lineWidth = 6; g.strokeRect(10, 10, W - 20, H - 20);
  return cv;
}

function labelText(text, w, h, o = {}) {
  const cv = makeCanvas(w, h), g = cv.getContext('2d');
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = o.color || '#222'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = o.font || `bold ${Math.round(h * 0.6)}px ui-sans-serif, system-ui, sans-serif`;
  g.fillText(text, w / 2, h / 2 + (o.dy || 0));
  return cv;
}

// --------------------------------------------------------------------- desk
function buildDesk(root) {
  const D = DIM.desk, w = D.x1 - D.x0, d = D.z1 - D.z0;
  const wood = canvasTex(THREE, woodTexture());
  const top = new THREE.Mesh(new RoundedBoxGeometry(w, D.th, d, 2, 0.8), std(0xffffff, { map: wood, roughness: 0.55 }));
  top.position.set((D.x0 + D.x1) / 2, -D.th / 2, (D.z0 + D.z1) / 2);
  top.name = 'deskTop';
  top.receiveShadow = true; top.castShadow = true;
  root.add(top);
  const dark = std(0x4a2f1d, { roughness: 0.7 });
  // legs at the right, a drawer unit at the left
  for (const z of [D.z0 + 6, D.z1 - 6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(5, D.legH, 5), dark);
    leg.position.set(D.x1 - 7, -D.th - D.legH / 2, z); root.add(leg);
  }
  const unit = new THREE.Mesh(new THREE.BoxGeometry(44, D.legH, d - 8), dark);
  unit.position.set(D.x0 + 26, -D.th - D.legH / 2, (D.z0 + D.z1) / 2 - 2); root.add(unit);
  const drawerM = std(0x6b4429, { roughness: 0.6 }), knobM = std(0xc9b58a, { metalness: 0.6, roughness: 0.35 });
  for (let i = 0; i < 3; i++) {
    const dr = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 1.2), drawerM);
    dr.position.set(D.x0 + 26, -D.th - 12 - i * 22.5, D.z1 - 5.4); root.add(dr);
    const kb = new THREE.Mesh(new THREE.BoxGeometry(8, 1.4, 1.4), knobM);
    kb.position.set(D.x0 + 26, -D.th - 12 - i * 22.5, D.z1 - 4.1); root.add(kb);
  }
  // wall, skirting, floor
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(520, 300), std(0xffffff, { map: canvasTex(THREE, wallTexture(), { repeat: [6, 3.5] }), roughness: 0.92 }));
  wall.position.set(0, 60, DIM.wallZ); wall.receiveShadow = true; wall.name = 'wall'; root.add(wall);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(520, 10, 1.5), std(0xd9d2c4));
  skirt.position.set(0, -D.th - D.legH + 5, DIM.wallZ + 0.75); root.add(skirt);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(520, 300), std(0x2a211b, { roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -D.th - D.legH, 60); floor.receiveShadow = true; root.add(floor);
  // poster on the wall, right of the TV
  const pst = new THREE.Mesh(new THREE.PlaneGeometry(32, 40), new THREE.MeshStandardMaterial({ map: canvasTex(THREE, posterTexture()), roughness: 0.8 }));
  pst.position.set(70, 62, DIM.wallZ + 0.3); pst.rotation.z = 0.025; root.add(pst);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(34, 42, 0.2), std(0x111111));
  frame.position.set(70, 62, DIM.wallZ + 0.1); frame.rotation.z = 0.025; root.add(frame);
  return { top };
}

// ----------------------------------------------------------------------- TV
function buildTV(root) {
  const T = DIM.tv, g = new THREE.Group(); g.name = 'tv';
  const cream = std(0xd9cdb4, { roughness: 0.5 }), cream2 = std(0xe6dcc8, { roughness: 0.45 });
  const cy = T.y0 + T.h / 2;
  // front shell: rounded rect with the square screen hole, bevelled
  const bv = 0.6, depth = 4;
  const sh = rrect(new THREE.Shape(), T.w - 2 * bv, T.h - 2 * bv, 3.4);
  sh.holes.push(rrect(new THREE.Path(), T.hole + 2 * bv, T.hole + 2 * bv, 2.4, 0, T.holeY - cy));
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 3, curveSegments: 8 }), cream2);
  shell.position.set(0, cy, T.zFront - bv - depth);
  shell.name = 'tvShell'; g.add(shell);
  // body behind the shell (inset 0.5 so no side face is shared)
  const bodyD = T.zFront - 3 - (-14);
  const body = new THREE.Mesh(new RoundedBoxGeometry(T.w - 1, T.h - 1, bodyD, 3, 2.5), cream);
  body.position.set(0, cy, T.zFront - 3 - bodyD / 2); g.add(body);
  // tube housing at the back
  const rear = new THREE.Mesh(new RoundedBoxGeometry(44, 42, 24, 3, 4), cream);
  rear.position.set(0, cy + 1, -14 - 10); g.add(rear);
  const vents = std(0x2a2620, { roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 0.6), vents);
    v.position.set(0, cy + 8 - i * 3, -36.1 + 0.2); g.add(v);
  }
  // glass: a square plane bulged forward; screen.js draws the round corners
  const gg = new THREE.PlaneGeometry(T.hole, T.hole, 28, 28), p = gg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i) / (T.hole / 2), ny = p.getY(i) / (T.hole / 2);
    p.setZ(i, 1.5 * (1 - 0.5 * nx * nx) * (1 - 0.5 * ny * ny) - 0.375);
  }
  gg.computeVertexNormals();
  const glass = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0x0c0d0c }));
  glass.position.set(0, T.holeY, T.zFront - 2.2);
  glass.name = 'tvGlass'; glass.userData.pick = { type: 'screen' };
  g.add(glass);
  // grille, brand plate, knobs, LED
  const grille = std(0x3a342b, { roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(13, 0.7, 0.4), grille);
    s.position.set(-20, 4.4 + i * 1.6, T.zFront + 0.05); g.add(s);
  }
  const brand = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.4), decal(canvasTex(THREE, labelText('TUBE · 160', 256, 48, { color: '#6b5f4c', font: 'bold 30px ui-sans-serif, system-ui, sans-serif' })), { transparent: true }));
  brand.position.set(0, 6.8, T.zFront + 0.04); g.add(brand);
  const knobM = std(0x3b2f25, { roughness: 0.4 }), capM = std(0xb7ab92, { metalness: 0.5, roughness: 0.3 });
  for (const [x, r] of [[17, 1.9], [24.5, 1.5]]) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, 1.6, 24), knobM);
    k.rotation.x = Math.PI / 2; k.position.set(x, 7, T.zFront + 0.75); g.add(k);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.3, 16), capM);
    c.rotation.x = Math.PI / 2; c.position.set(x, 7, T.zFront + 1.6); g.add(c);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x33ff66, emissiveIntensity: 1.6 }));
  led.position.set(11.2, 7, T.zFront + 0.15); led.name = 'tvLed'; g.add(led);
  // feet
  const foot = std(0x2a2620);
  for (const [x, z] of [[-24, 6], [24, 6], [-18, -32], [18, -32]]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, T.y0, 16), foot);
    f.position.set(x, T.y0 / 2, z); g.add(f);
  }
  // rabbit-ear antenna on the tube housing
  const top = cy + 1 + 21;
  const base = new THREE.Mesh(new THREE.SphereGeometry(3.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x2a2620, { roughness: 0.4 }));
  base.position.set(4, top, -24); g.add(base);
  const rodM = std(0xcfd3d6, { metalness: 0.9, roughness: 0.25 });
  for (const s of [-1, 1]) {
    const L = 30, rod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, L, 8), rodM);
    const dir = new THREE.Vector3(s * 0.55, 1, -0.25).normalize();
    rod.position.set(4, top + 2.4, -24).addScaledVector(dir, L / 2);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(rod);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), rodM);
    tip.position.set(4, top + 2.4, -24).addScaledVector(dir, L); g.add(tip);
  }
  root.add(shadow(g));
  glass.castShadow = false;
  return { group: g, glass, led, holeY: T.holeY, front: T.zFront };
}

// ------------------------------------------------------------------ console
function buildConsole(root) {
  const C = DIM.console, g = new THREE.Group(); g.name = 'console';
  g.position.set(C.x, 0, C.z);
  const body = new THREE.Mesh(new RoundedBoxGeometry(C.w, C.h, C.d, 3, 1.6), std(0xe8e3d8, { roughness: 0.45 }));
  body.position.y = C.h / 2; g.add(body);
  // slot housing on top, a black opening
  const hous = new THREE.Mesh(new RoundedBoxGeometry(12.6, 1.6, 4.6, 2, 0.6), std(0x3a3640, { roughness: 0.5 }));
  hous.position.set(0, C.h + 0.6, -1); g.add(hous);
  const open = new THREE.Mesh(new THREE.PlaneGeometry(DIM.cart.w + 0.8, DIM.cart.t + 0.6), new THREE.MeshBasicMaterial({ color: 0x050505, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  open.rotation.x = -Math.PI / 2; open.position.set(0, C.h + 1.4 + 0.04, -1); g.add(open);
  // palette stripe on the front
  const P = [0xe0f8cf, 0x86c06c, 0x306850, 0x071821];
  P.forEach((c, i) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), decal(null, { color: c }));
    s.position.set(-11 + i * 3, C.h * 0.62, C.d / 2 + 0.04); g.add(s);
  });
  const name = new THREE.Mesh(new THREE.PlaneGeometry(10, 2), decal(canvasTex(THREE, labelText('WASM-4', 256, 52, { color: '#4b3f63', font: 'bold 40px ui-monospace, Menlo, monospace' })), { transparent: true }));
  name.position.set(-6.4, C.h * 0.3, C.d / 2 + 0.04); g.add(name);
  // buttons (pick targets) and LED
  const btn = (x, color, kind) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.2, 20), std(color, { roughness: 0.35 }));
    b.rotation.x = Math.PI / 2; b.position.set(x, C.h * 0.45, C.d / 2 + 0.3);
    b.userData.pick = { type: 'button', kind }; b.name = 'btn-' + kind; g.add(b);
    return b;
  };
  const bPower = btn(7, 0xc7473b, 'power'), bReset = btn(11.2, 0x8a8577, 'reset');
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3322, emissiveIntensity: 2 }));
  led.position.set(3.2, C.h * 0.62, C.d / 2 + 0.12); g.add(led);
  // a cable from the back to the TV
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(C.x + 8, 1, C.z - C.d / 2), new THREE.Vector3(C.x + 10, 0.6, C.z - C.d / 2 - 12), new THREE.Vector3(-26, 0.6, -20), new THREE.Vector3(-26, 8, -30)]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.45, 6), std(0x1a1a1a, { roughness: 0.6 }));
  root.add(shadow(cable));
  root.add(shadow(g));
  const slot = new THREE.Vector3(C.x, C.h + 1.4 + DIM.cart.h / 2 - DIM.cart.sink, C.z - 1);
  return { group: g, slot, led, buttons: { power: bPower, reset: bReset } };
}

// --------------------------------------------------------------------- rack
// A stepped stand: one extruded stair profile, so no faces are shared.
function buildRack(root) {
  const R = DIM.rack, W = R.cols * R.dx + 2.4;
  const sh = new THREE.Shape(); sh.moveTo(0, 0);
  for (let r = 0; r < R.rows; r++) { const h = 1.2 + r * R.dy; sh.lineTo(r * R.dz, h); sh.lineTo((r + 1) * R.dz, h); }
  sh.lineTo(R.rows * R.dz, 0); sh.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false });
  const rack = new THREE.Mesh(geo, std(0x5b3c5e, { roughness: 0.5 }));
  rack.rotation.y = Math.PI / 2;
  rack.position.set(R.x - W / 2, 0, R.z + R.dz / 2);
  rack.name = 'rack'; root.add(shadow(rack));
  const slots = [];
  for (let r = 0; r < R.rows; r++) for (let c = 0; c < R.cols; c++) {
    const y = 1.2 + r * R.dy + DIM.cart.h / 2 * Math.cos(R.lean);
    slots.push(new THREE.Vector3(R.x + (c - (R.cols - 1) / 2) * R.dx, y + 0.1, R.z - r * R.dz - 0.6));
  }
  return { mesh: rack, slots, lean: R.lean };
}

// --------------------------------------------------------------------- lamp
function buildLamp(root) {
  const g = new THREE.Group(); g.name = 'lamp';
  const metal = std(0x2c5d54, { roughness: 0.35, metalness: 0.3 }), chrome = std(0xd0d0d0, { metalness: 0.9, roughness: 0.25 });
  const bx = -74, bz = -36;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.6, 1.8, 28), metal); base.position.set(bx, 0.9, bz); g.add(base);
  const j1 = new THREE.Vector3(bx, 1.8, bz), j2 = new THREE.Vector3(bx + 6, 36, bz + 6), j3 = new THREE.Vector3(bx + 26, 44, bz + 22);
  const arm = (a, b) => {
    const d = b.clone().sub(a), L = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, L, 10), chrome);
    m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(m);
  };
  arm(j1, j2); arm(j2, j3);
  for (const j of [j2, j3]) { const s = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), metal); s.position.copy(j); g.add(s); }
  const aim = new THREE.Vector3(-34, 0, 10);
  const head = new THREE.Mesh(new THREE.ConeGeometry(6, 9, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c5d54, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide }));
  const hd = aim.clone().sub(j3).normalize();
  head.position.copy(j3).addScaledVector(hd, 3.5);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), hd); g.add(head);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 10), new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 2.2 }));
  bulb.position.copy(j3).addScaledVector(hd, 6); g.add(bulb);
  shadow(g); bulb.castShadow = false; head.castShadow = true;
  root.add(g);
  const spot = new THREE.SpotLight(0xffd3a0, 2.6, 0, 0.78, 0.55, 0);
  spot.position.copy(j3).addScaledVector(hd, 6.5);
  spot.target.position.copy(aim);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 5; spot.shadow.camera.far = 260;
  spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.4;
  root.add(spot, spot.target);
  return { group: g, spot, bulb };
}

// -------------------------------------------------------------------- room
export const KEYPOINTS = {
  tv: [[-31, 0, 13], [31, 0, 13], [-31, 58, 13], [31, 58, 13], [-31, 58, -20], [31, 58, -20]],
  desk: [[-31, 58, 13], [31, 58, 13], [-69, 0, 26], [-69, 14, 5], [-39, 0, 26], [74, 0, 28], [74, 28, 11], [31, 0, 28], [-20, 0, 33], [20, 0, 33]],
};

export function buildRoom() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10161b);
  const root = new THREE.Group(); scene.add(root);
  const desk = buildDesk(root);
  const tv = buildTV(root);
  const con = buildConsole(root);
  const rack = buildRack(root);
  const lamp = buildLamp(root);
  const props = buildProps(root);
  const hemi = new THREE.HemisphereLight(0xa8b8d8, 0x3a2a1e, 0.85);
  const fill = new THREE.DirectionalLight(0xdfe6ff, 0.55);
  fill.position.set(60, 120, 160);
  const glow = new THREE.PointLight(0x9fe0b0, 0, 130, 0);
  glow.position.set(0, DIM.tv.holeY, DIM.tv.zFront + 14);
  scene.add(hemi, fill, glow);
  return { scene, root, desk, tv, con, rack, lamp, props, lights: { hemi, fill, glow, spot: lamp.spot } };
}

// ------------------------------------------------------------------ framing
// The camera for a view: look along a fixed direction, then find the
// shortest distance where every key point projects inside +-margin of NDC,
// and centre the points. Returns world positions as Vector3.
const VIEWS = {
  tv: { pitch: 0.12, yaw: 0, margin: 0.94 },
  desk: { pitch: 0.42, yaw: 0, margin: 0.92 },
};
export function frameFor(mode, aspect, fov = 34, pts = KEYPOINTS[mode]) {
  const v = VIEWS[mode] || VIEWS.tv;
  const cam = new THREE.PerspectiveCamera(fov, aspect, 1, 5000);
  const P = pts.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const target = P.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length);
  const dir = new THREE.Vector3(Math.sin(v.yaw) * Math.cos(v.pitch), Math.sin(v.pitch), Math.cos(v.yaw) * Math.cos(v.pitch));
  const place = d => { cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.updateMatrixWorld(); };
  const ndc = () => P.map(p => p.clone().project(cam));
  const fits = d => { place(d); return ndc().every(q => Math.abs(q.x) <= v.margin && Math.abs(q.y) <= v.margin && q.z < 1); };
  let d = 0;
  for (let it = 0; it < 4; it++) {
    let lo = 20, hi = 4000;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    d = hi; place(d);
    const q = ndc();
    const cx = (Math.min(...q.map(a => a.x)) + Math.max(...q.map(a => a.x))) / 2;
    const cy = (Math.min(...q.map(a => a.y)) + Math.max(...q.map(a => a.y))) / 2;
    const hh = d * Math.tan(fov * Math.PI / 360), right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    target.addScaledVector(right, cx * hh * aspect).addScaledVector(up, cy * hh);
  }
  place(d);
  return { pos: cam.position.clone(), target: target.clone(), fov };
}
