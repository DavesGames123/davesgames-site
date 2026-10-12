// ============================================================================
//  FLY DUEL 3D  ·  the d20 life dice  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  Each fly keeps its life on a twenty-sided die on its playmat, as players
//  do at a card store. The die is an icosahedron with a number on each of
//  its 20 faces. Opposite faces add to 21, as on a real d20. The numbers
//  are drawn on one canvas atlas (5 x 4 cells), one triangle per cell.
//
//  Life 1 to 20: one die shows the life on its top face. Life over 20:
//  the first die shows 20 and a second die shows the rest (up to 20 more).
//  Life 0 or less: the die shows 1 and turns dark red. A plate in front of
//  the die always shows the exact number, so the life reads at a glance
//  and stays true over 40 or under 1.
//
//  On a change the die hops and rolls to the new face (eased slerp plus
//  extra turns that end at the new face). On damage it also wobbles and
//  its edges flash red for a short time. Reduced motion: it turns at once.
//
//  The number on a top face reads upright from the seat: faceQuat(n, yaw)
//  turns face n to +Y and the top of its number to -Z (away from the
//  viewer at +Z) before the yaw.
//
//  API
//      d20Faces() -> [{ n, normal: [x,y,z], centre, up }] x 20 (pure)
//      faceQuat(n, out?) -> THREE.Quaternion, face n up, number upright
//      lifeFaces(life) -> { main, extra, dead } (pure)
//      createD20({ colour, ink, size, reduced }) -> { group, mesh,
//        set(value, { instant, hurt }), update(dt), top(), dispose }
//      createLifeDice({ colour, size, reduced }) -> { group, set(life,
//        { instant }), update(dt), life, faces(), dispose }
//
//  GREP MAP
//      grep -n 'export function d20Faces'      face numbers and normals
//      grep -n 'export function faceQuat'      face n to the top
//      grep -n 'export function lifeFaces'     life -> die faces
//      grep -n 'function atlas'                the number canvas
//      grep -n 'export function createD20'     one die with roll and wobble
//      grep -n 'export function createLifeDice' one or two dice and a plate
// ============================================================================
import * as THREE from 'three';
import { TOKENS, MONO } from '../tokens.js';

// ------------------------------------------------------------- faces
let FACES = null;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function baseGeometry() {
  const g0 = new THREE.IcosahedronGeometry(1, 0);
  return g0.index ? g0.toNonIndexed() : g0;
}
// The 20 faces of the base icosahedron in geometry order, with numbers.
// Numbering: walk the faces from the top normal down (then by angle), give
// the next free face k = 1..10 and its opposite face 21 - k.
export function d20Faces() {
  if (FACES) return FACES;
  const g = baseGeometry(), pos = g.attributes.position;
  const faces = [];
  for (let i = 0; i < 20; i++) {
    _a.fromBufferAttribute(pos, 3 * i); _b.fromBufferAttribute(pos, 3 * i + 1); _c.fromBufferAttribute(pos, 3 * i + 2);
    const centre = new THREE.Vector3().add(_a).add(_b).add(_c).multiplyScalar(1 / 3);
    const normal = centre.clone().normalize();
    const up = _a.clone().sub(centre).normalize();
    faces.push({ i, n: 0, normal: normal.toArray(), centre: centre.toArray(), up: up.toArray() });
  }
  g.dispose();
  const order = faces.slice().sort((p, q) => (q.normal[1] - p.normal[1]) || (Math.atan2(p.normal[2], p.normal[0]) - Math.atan2(q.normal[2], q.normal[0])));
  let k = 1;
  for (const f of order) {
    if (f.n) continue;
    f.n = k;
    let best = null, bd = 2;
    // the opposite face: its normal is the negative of this normal
    for (const o of faces) { if (o.n) continue; const e = Math.hypot(o.normal[0] + f.normal[0], o.normal[1] + f.normal[1], o.normal[2] + f.normal[2]); if (e < bd) { bd = e; best = o; } }
    if (best) best.n = 21 - k;
    k++;
  }
  FACES = faces;
  return faces;
}
const faceOf = n => d20Faces().find(f => f.n === n);

// Quaternion that puts face n on top with the top of its number to -Z.
const Y = new THREE.Vector3(0, 1, 0), NZ = new THREE.Vector3(0, 0, -1);
export function faceQuat(n, out = new THREE.Quaternion()) {
  const f = faceOf(Math.min(20, Math.max(1, Math.round(n) || 1)));
  out.setFromUnitVectors(_a.fromArray(f.normal), Y);
  const up = _b.fromArray(f.up).applyQuaternion(out);
  up.y = 0; up.normalize();
  const ang = Math.atan2(up.x, -up.z);   // angle from -Z about +Y
  const spin = new THREE.Quaternion().setFromAxisAngle(Y, ang);
  return out.premultiply(spin);
}

// life -> what the dice show. main: the face of die 1, extra: the face of
// die 2 or null, dead: life <= 0.
export function lifeFaces(life) {
  const v = Math.round(Number.isFinite(life) ? life : 0);
  if (v <= 0) return { main: 1, extra: null, dead: true };
  if (v <= 20) return { main: v, extra: null, dead: false };
  return { main: 20, extra: Math.min(20, v - 20), dead: false };
}

// ------------------------------------------------------------- atlas
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}
const CELL = 128, COLS = 5, ROWS = 4;
// Triangle of a cell in canvas px: apex at the top (vertex 0, the 'up' of
// the face), base at the bottom.
const triOf = (i) => {
  const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL, m = 6;
  const h = (CELL - 2 * m), w = h * 2 / Math.sqrt(3);
  const cx = x + CELL / 2;
  return [[cx, y + m], [cx - w / 2, y + m + h], [cx + w / 2, y + m + h]];
};
// One canvas: each face triangle in the die colour, its number in ink.
// 6 and 9 get a bar under the number.
function atlas(colour, ink) {
  const cv = makeCanvas(CELL * COLS, CELL * ROWS);
  const g = cv?.getContext?.('2d');
  if (!g) return null;
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, cv.width, cv.height);
  for (const f of d20Faces()) {
    const t = triOf(f.i);
    g.fillStyle = colour; g.beginPath(); g.moveTo(...t[0]); g.lineTo(...t[1]); g.lineTo(...t[2]); g.closePath(); g.fill();
    const cx = t[0][0], cy = t[0][1] + (t[1][1] - t[0][1]) * 0.64;
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${f.n >= 10 ? 40 : 46}px ${MONO}`;
    g.fillText(String(f.n), cx, cy);
    if (f.n === 6 || f.n === 9) g.fillRect(cx - 12, cy + 24, 24, 4);
  }
  return cv;
}
// UVs of the non-indexed geometry: vertex 0, 1, 2 of face i go to the
// apex, the left and the right corner of cell i. The base geometry winds
// faces counter-clockwise from outside, so vertex 1 is at the left of the
// apex as seen from outside.
function uvGeometry() {
  const g = baseGeometry(), uv = new Float32Array(2 * 60);
  const W = CELL * COLS, H = CELL * ROWS;
  for (let i = 0; i < 20; i++) {
    const t = triOf(i);
    for (let k = 0; k < 3; k++) { uv[2 * (3 * i + k)] = t[k][0] / W; uv[2 * (3 * i + k) + 1] = 1 - t[k][1] / H; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------- one die
const easeIO = t => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
let seedN = 1;
export function createD20({ colour = TOKENS.flyA, ink = '#0b0d12', size = 0.28, reduced = false } = {}) {
  const cv = atlas(colour, ink);
  const tex = cv ? new THREE.CanvasTexture(cv) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; }
  const geo = uvGeometry();
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : new THREE.Color(colour), roughness: 0.32, metalness: 0.05, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.name = 'd20';
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#0b0d12') });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 10), edgeMat);
  edges.scale.setScalar(1.002);
  mesh.add(edges);
  const group = new THREE.Group(); group.name = 'd20-die';
  const spinner = new THREE.Group(); group.add(spinner); spinner.add(mesh);
  spinner.scale.setScalar(size);
  // the icosahedron rests on a face: its in-radius is 0.7947 of the radius
  const rest = 0.7947 * size;
  spinner.position.y = rest;
  const st = { value: 1, from: new THREE.Quaternion(), to: faceQuat(1), t: 1, dur: 0.9, axis: new THREE.Vector3(1, 0, 0), turns: 0, wob: 0, flash: 0, dead: false };
  spinner.quaternion.copy(st.to);
  const red = new THREE.Color(TOKENS.dmg || '#ff5a5a'), dark = new THREE.Color('#0b0d12'), deadTint = new THREE.Color('#7a2020');
  const _q = new THREE.Quaternion();
  let rs = (seedN++ * 2654435761) >>> 0;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  function set(v, { instant = false, hurt = false, dead = false } = {}) {
    const n = Math.min(20, Math.max(1, Math.round(v) || 1));
    st.dead = dead;
    mat.color.copy(dead ? deadTint : new THREE.Color(tex ? 0xffffff : colour));
    if (n === st.value && !instant) { if (hurt) { st.wob = 1; st.flash = 0.6; } return; }
    st.value = n;
    faceQuat(n, st.to);
    if (instant || reduced) { st.t = 1; spinner.quaternion.copy(st.to); st.wob = 0; return; }
    st.from.copy(spinner.quaternion); st.t = 0;
    st.axis.set(rnd() - 0.5, 0, rnd() - 0.5).normalize();
    st.turns = 1 + Math.floor(rnd() * 2);
    if (hurt) { st.wob = 1; st.flash = 0.9; }
  }
  function update(dt) {
    if (st.t < 1) {
      st.t = Math.min(1, st.t + dt / st.dur);
      const e = easeIO(st.t);
      spinner.quaternion.slerpQuaternions(st.from, st.to, e);
      // extra whole turns about a level axis that end at the new face
      _q.setFromAxisAngle(st.axis, (1 - e) * st.turns * Math.PI * 2);
      spinner.quaternion.premultiply(_q);
      spinner.position.y = rest + size * 2.2 * 4 * e * (1 - e);
    } else spinner.position.y = rest;
    if (st.wob > 0) {
      st.wob = Math.max(0, st.wob - dt * 1.6);
      const a = Math.sin((1 - st.wob) * 26) * 0.16 * st.wob;
      group.rotation.set(a, 0, a * 0.6);
    } else group.rotation.set(0, 0, 0);
    if (st.flash > 0) { st.flash = Math.max(0, st.flash - dt); edgeMat.color.copy(red); } else edgeMat.color.copy(dark);
  }
  // The number on the top face now (from the pose, not the target).
  function top() {
    let best = 0, bn = 1;
    for (const f of d20Faces()) { const y = _c.fromArray(f.normal).applyQuaternion(spinner.quaternion).y; if (y > best) { best = y; bn = f.n; } }
    return bn;
  }
  function dispose() { geo.dispose(); mat.dispose(); tex?.dispose(); edges.geometry.dispose(); edgeMat.dispose(); group.parent?.remove(group); }
  return { group, mesh, spinner, set, update, top, dispose, get value() { return st.value; }, get rolling() { return st.t < 1; } };
}

// ----------------------------------------------------------- life dice
// One or two dice and a plate with the exact life. The plate is a canvas
// plane on the mat in front of the dice (or a flat colour in node).
export function createLifeDice({ colour = TOKENS.flyA, size = 0.28, reduced = false, label = '' } = {}) {
  const group = new THREE.Group(); group.name = 'life-dice';
  const a = createD20({ colour, size, reduced }), b = createD20({ colour, size: size * 0.8, reduced });
  a.group.position.set(-size * 0.2, 0, 0);
  b.group.position.set(size * 2.1, 0, -size * 0.3);
  b.group.visible = false;
  group.add(a.group, b.group);
  const cv = makeCanvas(256, 96), g = cv?.getContext?.('2d');
  const tex = g ? new THREE.CanvasTexture(cv) : null;
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const plateMat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : new THREE.Color(TOKENS.panel || '#151a24') });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(size * 2.6, size * 0.98), plateMat);
  plate.rotation.x = -Math.PI / 2; plate.position.set(size * 0.45, 0.004, size * 1.55);
  plate.name = 'life-plate';
  group.add(plate);
  let life = null;
  function drawPlate(v, col) {
    if (!g) return;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = colour; g.fillRect(0, 0, 10, 96);
    g.fillStyle = '#8f98ab'; g.font = `600 22px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label ? `${label} LIFE` : 'LIFE', 22, 26);
    g.fillStyle = col; g.font = `800 56px ${MONO}`; g.textAlign = 'right';
    g.fillText(String(v), 240, 58);
    tex.needsUpdate = true;
  }
  function set(v, { instant = false } = {}) {
    v = Math.round(Number.isFinite(v) ? v : 0);
    const first = life == null, hurt = !first && v < life;
    const F = lifeFaces(v);
    a.set(F.main, { instant: first || instant, hurt, dead: F.dead });
    if (F.extra != null) { const was = b.group.visible; b.group.visible = true; b.set(F.extra, { instant: !was || instant, hurt }); }
    else b.group.visible = false;
    drawPlate(v, first ? (TOKENS.ink || '#e8ecf3') : v < life ? (TOKENS.dmg || '#ff5a5a') : v > life ? (TOKENS.heal || '#6fe08a') : (TOKENS.ink || '#e8ecf3'));
    life = v;
  }
  let calm = 0;
  function update(dt) {
    a.update(dt); if (b.group.visible) b.update(dt);
    if (life != null && !a.rolling && calm >= 0) { calm += dt; if (calm > 1.4) { drawPlate(life, TOKENS.ink || '#e8ecf3'); calm = -1; } }
  }
  const set2 = (v, o) => { calm = 0; set(v, o); };
  return {
    group, dice: [a, b], plate, set: set2, update,
    get life() { return life; },
    faces: () => [a.value, b.group.visible ? b.value : null],
    dispose() { a.dispose(); b.dispose(); plate.geometry.dispose(); plateMat.dispose(); tex?.dispose(); group.parent?.remove(group); },
  };
}
