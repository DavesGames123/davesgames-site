// ============================================================================
//  FLY DUEL 3D  ·  the convention hall  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  The duel is a feature match at a card convention (CONTRACT.md, user
//  direction 2026-10-11: "a convention table not a proper card table
//  foldling table with mana mats and other flies nearby engaged in fake
//  other games"). This module builds the hall around the two players:
//
//    table     one long folding table: a laminate top with a dark edge
//              band, two folding metal leg frames with braces
//    chairs    a folding metal chair at each seat
//    mats      a rubber playmat per fly, printed with our own zones (LANDS,
//              CREATURES, LIBRARY, GRAVE, LIFE) and a wing-vein and
//              honeycomb print in the seat colour. No marks of any card
//              game publisher.
//    deck box  a box in the seat colour beside each library
//    hall      a carpet floor, far walls, a dark ceiling with a grid of
//              fluorescent panels, a pairings board and hanging banners
//              (our own event name, "FLY DUEL OPEN")
//    extras    rows of other folding tables. A pair of cheap flies sits at
//              each one and plays its own fake game: they shuffle, tap
//              cards, roll dice, think and cheer, each on its own clock.
//    crowd     20 to 60 standing flies around the feature table. Their
//              heads follow the focus point of the scene. react() makes
//              them buzz their wings, raise their front legs or lean in
//              on big events. Some hold a small flag in a seat colour.
//
//  Cheap flies. One low-poly fly is cut in parts (body, head, wings, front
//  legs, flag), and each part is one InstancedMesh for all extras and the
//  whole crowd. A pose is a few numbers per fly (lean, head yaw and pitch,
//  leg lift, wing buzz), so a frame writes only instance matrices. About
//  560 triangles per fly.
//
//  Places. The crowd stands in the sector away from the camera side of
//  the scene (world +x and the line behind seat 0), so it frames the
//  table and does not stand between the camera and the cards. The extra
//  tables stand behind the crowd and behind the cameras.
//
//  Phone (coarse): 16 crowd flies, two extra tables, no shadow casters in
//  the hall, smaller textures. Reduced motion: the fake games stand still,
//  the heads turn at once, a reaction has no wing beat.
//
//  API
//      buildHall({ coarse, reduced, seed, layout }) -> { group, table,
//        room, mats, inlay, chairs, deckBoxes, crowd, extras, update(dt,
//        { focus, time }), react(kind, { side, strength }), stats(),
//        dispose() }
//      layout: { y, halfLen, halfDepth, seatV, seatTop, seatPos(p, u, y, v) }
//      react kinds: 'lean' (look in), 'buzz' (wings), 'cheer' (legs up and
//      wings), 'gasp' (lean back). side: the seat that the event favours
//      (flag holders of that seat cheer harder) or -1.
//      HALL: hall sizes (the scene tests keep the camera inside it).
//      CROWD_SECTOR: the azimuth range of the crowd (radians, atan2(x, z)).
//
//  GREP MAP
//      grep -n 'export const HALL'          hall sizes and counts
//      grep -n 'function laminateCanvas'    table top print
//      grep -n 'function matCanvas'         the playmat print
//      grep -n 'function buildFoldingTable' table, legs, braces
//      grep -n 'function buildChair'        folding chair
//      grep -n 'function buildRoomShell'    floor, walls, ceiling, panels
//      grep -n 'function pairingsCanvas'    the pairings board sheet
//      grep -n 'function lowFlyParts'       the cheap fly geometry
//      grep -n 'class FlyHerd'              instanced flies and poses
//      grep -n 'function extrasController'  fake games at other tables
//      grep -n 'function crowdController'   the watching crowd
//      grep -n 'export function buildHall'  assembly
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOKENS, FLY, SANS, MONO } from '../tokens.js';

export const HALL = {
  wall: 30,            // half size of the hall floor (x and z)
  ceiling: 15,         // ceiling height
  crowd: [44, 16],     // crowd flies: desktop, phone
  crowdR: [7.4, 10.8], // crowd ring radii
  crowdScale: 1.3,     // a standing crowd fly is about as tall as a seated player
  extraTables: [6, 2], // other tables: desktop, phone
};
// The crowd stands in this azimuth range (atan2(x, z), radians): the -x
// side and the back of seat 1. The cameras look from +x and from +z.
export const CROWD_SECTOR = [2.5, 5.9];

const TAU = Math.PI * 2;

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}
function tex(cv, { srgb = true, repeat = null, aniso = 8 } = {}) {
  if (!cv) return null;
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shade(hex, k) {
  const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString();
}

// --------------------------------------------------------------- prints
// Table laminate: a light warm grey with a fine speckle (a real folding
// table top), drawn once and repeated.
function laminateCanvas(size) {
  const cv = makeCanvas(size, size);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d'), r = rng(41);
  g.fillStyle = '#d9d5cc'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size / 18; i++) {
    g.fillStyle = r() < 0.5 ? '#c4bfb4' : '#e6e3dc';
    g.fillRect(r() * size, r() * size, 1 + r(), 1 + r());
  }
  return cv;
}

// Carpet: a dark blue-grey with a small repeat of our own (a dotted grid
// and a thin diagonal), the usual hall carpet.
function carpetCanvas(size) {
  const cv = makeCanvas(size, size);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d'), r = rng(77);
  g.fillStyle = '#262c3a'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size / 10; i++) { g.fillStyle = r() < 0.5 ? '#202632' : '#2d3445'; g.fillRect(r() * size, r() * size, 1, 1); }
  g.strokeStyle = '#3b4357'; g.lineWidth = 2;
  for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(k * size / 4, 0); g.lineTo(k * size / 4 + size / 4, size); g.stroke(); }
  g.fillStyle = '#5a4a3a';
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) g.fillRect(x * size / 8 + size / 16 - 2, y * size / 8 + size / 16 - 2, 4, 4);
  return cv;
}

// The playmat print (our own design). Seat space: u across (-W/2..W/2),
// v from the centre line (v0) to the seat (v1). The canvas x grows with
// u, the canvas y grows with v, so the seat edge is at the bottom.
export const MAT = { u: 2.95, v0: 0.18, v1: 3.08 };
function matCanvas(colour, label, zones, px) {
  const W = px, H = Math.round(px * (MAT.v1 - MAT.v0) / (2 * MAT.u));
  const cv = makeCanvas(W, H);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d');
  const X = u => (u + MAT.u) / (2 * MAT.u) * W, Y = v => (v - MAT.v0) / (MAT.v1 - MAT.v0) * H, S = W / (2 * MAT.u);
  // base: a dark tint of the seat colour, a soft vignette band is not
  // used (crisp), only flat tints
  g.fillStyle = shade(colour, 0.13); g.fillRect(0, 0, W, H);
  // honeycomb print
  g.strokeStyle = shade(colour, 0.24); g.lineWidth = Math.max(1, W / 900);
  const hr = W / 34;
  for (let row = -1; row < H / (hr * 1.5) + 1; row++) {
    for (let col = -1; col < W / (hr * 1.732) + 1; col++) {
      const cx = col * hr * 1.732 + (row % 2 ? hr * 0.866 : 0), cy = row * hr * 1.5;
      g.beginPath();
      for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * hr, cy + Math.sin(a) * hr); }
      g.stroke();
    }
  }
  // a big wing, drawn with veins, across the right half
  g.save();
  g.translate(W * 0.62, H * 0.52); g.rotate(-0.18);
  g.strokeStyle = shade(colour, 0.42); g.lineWidth = Math.max(1.5, W / 520);
  g.beginPath(); g.moveTo(-W * 0.3, 0);
  g.bezierCurveTo(-W * 0.1, -H * 0.42, W * 0.25, -H * 0.36, W * 0.33, -H * 0.05);
  g.bezierCurveTo(W * 0.3, H * 0.2, W * 0.0, H * 0.24, -W * 0.3, 0); g.stroke();
  for (let k = 1; k <= 5; k++) {
    g.beginPath(); g.moveTo(-W * 0.3, 0);
    g.quadraticCurveTo(W * 0.0, -H * (0.3 - k * 0.07), W * (0.33 - k * 0.012), -H * (0.06 - k * 0.045));
    g.stroke();
  }
  g.restore();
  // border in the seat colour
  g.strokeStyle = colour; g.lineWidth = Math.max(3, W / 260);
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
  // zones: thin solid outlines and small caps labels
  g.lineWidth = Math.max(2, W / 520);
  g.font = `700 ${Math.round(W / 62)}px ${SANS}`; g.textBaseline = 'top';
  for (const z of zones) {
    g.strokeStyle = shade(colour, 0.85); g.fillStyle = shade(colour, 0.9);
    if (z.round) {
      g.beginPath(); g.arc(X(z.u), Y(z.v), z.r * S, 0, TAU); g.stroke();
      g.textAlign = 'center'; g.fillText(z.label, X(z.u), Y(z.v) + z.r * S + 6);
    } else {
      const x0 = X(z.u0), y0 = Y(z.v0), w = (z.u1 - z.u0) * S, h = (z.v1 - z.v0) * S;
      g.strokeRect(x0, y0, w, h);
      g.textAlign = 'left'; g.fillText(z.label, x0 + 8, y0 + 6);
    }
  }
  // the event mark and the seat name, bottom left (at the seat)
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = colour; g.font = `800 ${Math.round(W / 40)}px ${SANS}`;
  g.fillText(label, X(-MAT.u) + W * 0.02, H - H * 0.04);
  g.fillStyle = shade(colour, 0.7); g.font = `600 ${Math.round(W / 70)}px ${MONO}`;
  g.fillText('FLY DUEL OPEN · FEATURE TABLE', X(-MAT.u) + W * 0.02, H - H * 0.04 - W / 32);
  return cv;
}

// ------------------------------------------------------------ the table
// A folding table: the top is a box (laminate on top, a dark band on the
// four sides), with a thin metal apron under the edge and two folding
// leg frames. Origin at the floor under the table centre, the long side
// along x.
function buildFoldingTable({ len, depth, y, mats, shadows }) {
  const g = new THREE.Group(); g.name = 'folding-table';
  const th = 0.09;
  const top = new THREE.Mesh(new THREE.BoxGeometry(len, th, depth), [mats.edge, mats.edge, mats.laminate, mats.under, mats.edge, mats.edge]);
  top.position.y = y - th / 2;
  top.receiveShadow = true; top.castShadow = shadows;
  top.name = 'table-top';
  g.add(top);
  const apronH = 0.12;
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(len - 0.3, apronH, 0.04), mats.metal);
    a.position.set(0, y - th - apronH / 2, s * (depth / 2 - 0.12)); g.add(a);
  }
  // leg frames: two legs joined by a foot bar and a cross bar, folded at
  // a small angle, one brace from the frame to the centre of the apron
  const legH = y - th - 0.02;
  const legGeo = new THREE.CylinderGeometry(0.045, 0.045, legH, 8);
  const barGeo = new THREE.CylinderGeometry(0.035, 0.035, depth - 0.5, 8); barGeo.rotateX(Math.PI / 2);
  const braceLen = Math.hypot(len * 0.22, legH * 0.55);
  const braceGeo = new THREE.CylinderGeometry(0.025, 0.025, braceLen, 6);
  for (const sx of [-1, 1]) {
    const frame = new THREE.Group();
    frame.position.set(sx * (len / 2 - 0.45), 0, 0);
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mats.metal);
      leg.position.set(0, legH / 2, sz * (depth / 2 - 0.25)); leg.castShadow = shadows; frame.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), mats.foot);
      foot.position.set(0, 0.02, sz * (depth / 2 - 0.25)); frame.add(foot);
    }
    const cross = new THREE.Mesh(barGeo, mats.metal); cross.position.y = 0.32; frame.add(cross);
    const cross2 = new THREE.Mesh(barGeo, mats.metal); cross2.position.y = legH - 0.04; frame.add(cross2);
    frame.rotation.z = sx * 0.06;
    g.add(frame);
    const brace = new THREE.Mesh(braceGeo, mats.metal);
    brace.position.set(sx * (len / 2 - 0.45 - len * 0.11), legH * 0.72, 0);
    brace.rotation.z = sx * Math.atan2(len * 0.22, legH * 0.55);
    g.add(brace);
  }
  return g;
}

// A folding chair. Origin at the floor under the seat centre, the sitter
// faces +z. Seat top at seatTop.
function buildChair({ seatTop, mats, shadows }) {
  const g = new THREE.Group(); g.name = 'folding-chair';
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.07, 1.2), mats.chairSeat);
  seat.position.y = seatTop - 0.035; seat.castShadow = shadows; seat.receiveShadow = true; g.add(seat);
  const backH = 1.15;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.42, 0.06), mats.chairSeat);
  back.position.set(0, seatTop + backH - 0.25, -0.78); back.rotation.x = -0.1; back.castShadow = shadows; g.add(back);
  const tube = (len, r = 0.035) => new THREE.CylinderGeometry(r, r, len, 8);
  // back posts, from the floor to the top of the back
  const postLen = seatTop + backH;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(tube(postLen), mats.metal);
    post.position.set(s * 0.6, postLen / 2, -0.7); post.rotation.x = -0.1; post.castShadow = shadows; g.add(post);
    // front legs: slanted from the seat front to the floor ahead
    const fl = Math.hypot(seatTop, 0.35);
    const front = new THREE.Mesh(tube(fl), mats.metal);
    front.position.set(s * 0.6, seatTop / 2, 0.42); front.rotation.x = Math.atan2(0.35, seatTop); g.add(front);
    const foot = new THREE.Mesh(tube(1.4, 0.03), mats.metal);
    foot.rotation.x = Math.PI / 2; foot.position.set(s * 0.6, 0.04, -0.05); g.add(foot);
  }
  return g;
}

// ------------------------------------------------------------- the room
function buildRoomShell({ coarse, shadows }) {
  const room = new THREE.Group(); room.name = 'room';
  const H = HALL;
  const carpet = tex(carpetCanvas(coarse ? 256 : 512), { repeat: [18, 18] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * H.wall, 2 * H.wall), new THREE.MeshStandardMaterial({ map: carpet, color: carpet ? 0xffffff : 0x262c3a, roughness: 0.97 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor';
  room.add(floor);
  // walls: four planes facing in, a darker band at the foot
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x343a48, roughness: 0.9 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.8 });
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(2 * H.wall, H.ceiling), wallMat);
    w.position.set(Math.sin(a) * H.wall, H.ceiling / 2, Math.cos(a) * H.wall);
    w.rotation.y = a + Math.PI; room.add(w);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(2 * H.wall, 1.2), footMat);
    f.position.set(Math.sin(a) * (H.wall - 0.02), 0.6, Math.cos(a) * (H.wall - 0.02));
    f.rotation.y = a + Math.PI; room.add(f);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * H.wall, 2 * H.wall), new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H.ceiling; room.add(ceil);
  // fluorescent panels: a grid of bright flat panels in a thin frame
  const step = 6, n = Math.floor(H.wall * 2 / step);
  const panelGeo = new THREE.PlaneGeometry(2.4, 1.1);
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4f8ff') });
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, n * n);
  panels.name = 'ceiling-panels';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  let i = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    m.compose(new THREE.Vector3(-H.wall + step / 2 + a * step, H.ceiling - 0.02, -H.wall + step / 2 + b * step), q, new THREE.Vector3(1, 1, 1));
    panels.setMatrixAt(i++, m);
  }
  room.add(panels);
  return room;
}

// The pairings board: a sheet of pairings (fake fly ids, our own format).
function pairingsCanvas(px, seed) {
  const W = px, H = Math.round(px * 1.3);
  const cv = makeCanvas(W, H);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d'), r = rng(seed);
  g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#111'; g.font = `800 ${Math.round(W / 14)}px ${SANS}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('ROUND 3 PAIRINGS', W * 0.06, H * 0.03);
  g.font = `600 ${Math.round(W / 30)}px ${MONO}`;
  for (let k = 0; k < 22; k++) {
    const y = H * 0.12 + k * H * 0.038;
    if (k % 2) { g.fillStyle = '#e4e1d8'; g.fillRect(W * 0.04, y - 2, W * 0.92, H * 0.038); }
    g.fillStyle = '#222';
    const t = k + 1, a = 1000 + Math.floor(r() * 8999), b = 1000 + Math.floor(r() * 8999);
    g.fillText(`${String(t).padStart(2, ' ')}  FLY-${a}  vs  FLY-${b}`, W * 0.06, y);
  }
  return cv;
}

// A hanging banner with our own event name.
function bannerCanvas(px, line1, line2, colour) {
  const W = px, H = Math.round(px * 0.3);
  const cv = makeCanvas(W, H);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d');
  g.fillStyle = '#10131b'; g.fillRect(0, 0, W, H);
  g.fillStyle = colour; g.fillRect(0, 0, W, H * 0.08); g.fillRect(0, H * 0.92, W, H * 0.08);
  g.fillStyle = '#eef0f5'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${Math.round(H * 0.34)}px ${SANS}`; g.fillText(line1, W / 2, H * 0.42);
  g.fillStyle = colour; g.font = `600 ${Math.round(H * 0.15)}px ${MONO}`; g.fillText(line2, W / 2, H * 0.74);
  return cv;
}

// ------------------------------------------------------------ cheap fly
// Parts of one low-poly fly in its own frame (+y up, faces +z, origin at
// the feet for a standing fly or at the seat for a sitting fly). Vertex
// colours carry the insect colours, so one material serves all.
function coloured(geo, hex) {
  const g = geo.index ? geo : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[3 * i] = c.r; a[3 * i + 1] = c.g; a[3 * i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function ell(rx, ry, rz, x, y, z, hex, seg = 10) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(5, Math.round(seg * 0.6)));
  g.scale(rx, ry, rz); g.translate(x, y, z);
  return coloured(g, hex);
}
function rod(a, b, r, hex, seg = 5) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r * 0.8, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return coloured(g, hex);
}
export function lowFlyParts({ standing = true } = {}) {
  const tan = '#c99a5c', ochre = '#a8732f', band = '#33200f', leg = '#9c6d36', eye = '#b3271d';
  const hip = standing ? 0.95 : 0.0;     // abdomen base height
  const body = [
    ell(0.34, 0.44, 0.32, 0, hip + 0.42, -0.06, '#d8b06e'),
    ell(0.35, 0.08, 0.33, 0, hip + 0.3, -0.06, band),
    ell(0.33, 0.08, 0.31, 0, hip + 0.55, -0.06, band),
    ell(0.3, 0.33, 0.28, 0, hip + 1.02, 0.02, '#b27e44'),
  ];
  if (standing) {
    // middle and hind legs to the floor
    for (const s of [-1, 1]) {
      body.push(rod([s * 0.22, hip + 0.85, 0.05], [s * 0.55, 0.45, 0.25], 0.035, leg));
      body.push(rod([s * 0.55, 0.45, 0.25], [s * 0.6, 0.0, 0.35], 0.028, leg));
      body.push(rod([s * 0.2, hip + 0.7, -0.1], [s * 0.5, 0.45, -0.35], 0.035, leg));
      body.push(rod([s * 0.5, 0.45, -0.35], [s * 0.55, 0.0, -0.45], 0.028, leg));
    }
  } else {
    for (const s of [-1, 1]) body.push(rod([s * 0.22, hip + 0.85, 0.05], [s * 0.45, hip + 0.35, 0.55], 0.035, leg));
  }
  const head = [
    ell(0.24, 0.21, 0.21, 0, 0, 0, tan),
    ell(0.15, 0.19, 0.15, -0.18, 0.02, 0.06, eye),
    ell(0.15, 0.19, 0.15, 0.18, 0.02, 0.06, eye),
    rod([-0.05, 0.12, 0.17], [-0.08, 0.3, 0.24], 0.022, ochre, 4),
    rod([0.05, 0.12, 0.17], [0.08, 0.3, 0.24], 0.022, ochre, 4),
  ];
  // one wing: a flat fan, root at the origin, along -z and out to +x
  const ws = new THREE.Shape();
  ws.moveTo(0, 0); ws.bezierCurveTo(0.22, 0.08, 0.85, 0.06, 0.95, -0.1); ws.bezierCurveTo(0.8, -0.28, 0.28, -0.25, 0, -0.05);
  const wing = new THREE.ShapeGeometry(ws, 4);
  wing.rotateY(-Math.PI / 2);  // the wing runs back along -z... then out
  coloured(wing, '#dfe8f2');
  // a front leg: from the shoulder (origin) down and forward, tip at
  // (0, -0.62, 0.18)
  const legG = mergeGeometries([rod([0, 0, 0], [0, -0.32, 0.16], 0.035, leg), rod([0, -0.32, 0.16], [0, -0.62, 0.18], 0.026, leg)]);
  // a flag: a pole along +y from the hand and a small cloth (white, the
  // instance colour tints it to the seat colour; the pole is dark)
  const flag = mergeGeometries([
    rod([0, 0, 0], [0, 0.75, 0], 0.012, '#1a1a1a', 4),
    coloured(new THREE.PlaneGeometry(0.34, 0.22).translate(0.17, 0.62, 0), '#ffffff'),
  ]);
  return {
    body: mergeGeometries(body), head: mergeGeometries(head), wing, leg: legG, flag,
    headAt: [0, hip + 1.5, 0.08], wingAt: [0.12, hip + 1.12, -0.18], legAt: [0.17, hip + 1.02, 0.18], hip,
  };
}

// Instanced flies: n flies, each with body, head, two wings, two front
// legs, and an optional flag. pose[i] = { pos, yaw, scale, lean, hy, hp,
// legL, legR, buzz, wingOpen, flag } (flag: colour or null).
class FlyHerd {
  constructor(parts, n, { shadows = false, name = 'herd', flags = 0 } = {}) {
    this.parts = parts; this.n = n;
    this.group = new THREE.Group(); this.group.name = name;
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.45, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
    const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    this.mats = [solid, wingMat, flagMat];
    const mk = (geo, mat, count, nm) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count)); m.count = count; m.name = nm; m.castShadow = shadows; m.frustumCulled = false; this.group.add(m); return m; };
    this.body = mk(parts.body, solid, n, name + '-body');
    this.head = mk(parts.head, solid, n, name + '-head');
    this.wings = mk(parts.wing, wingMat, 2 * n, name + '-wings');
    this.legs = mk(parts.leg, solid, 2 * n, name + '-legs');
    this.flags = mk(parts.flag, flagMat, flags, name + '-flags');
    this.wings.castShadow = false;
    this.pose = Array.from({ length: n }, () => ({ pos: new THREE.Vector3(), yaw: 0, scale: 1, lean: 0, roll: 0, hy: 0, hp: 0, legL: 0, legR: 0, buzz: 0, flag: null, flagIdx: -1, t: 0 }));
    this._m = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._p = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  setFlag(i, colour, slot) {
    const P = this.pose[i]; P.flag = colour; P.flagIdx = slot;
    this.flags.setColorAt(slot, new THREE.Color(colour));
  }
  // Write every instance matrix from the poses. time: seconds.
  write(time) {
    const { parts } = this, m = this._m, r = this._r, pm = this._p, q = this._q, e = this._e, s = this._s;
    for (let i = 0; i < this.n; i++) {
      const P = this.pose[i];
      q.setFromEuler(e.set(P.lean, P.yaw, P.roll, 'YXZ'));
      pm.compose(P.pos, q, s.setScalar(P.scale));
      this.body.setMatrixAt(i, pm);
      // head
      r.compose(this._v.fromArray(parts.headAt), q.setFromEuler(e.set(P.hp, P.hy, 0, 'YXZ')), s.setScalar(1));
      m.multiplyMatrices(pm, r); this.head.setMatrixAt(i, m);
      // wings: folded back over the abdomen, a buzz opens and beats them
      for (const side of [-1, 1]) {
        const beat = P.buzz > 0 ? P.buzz * (0.5 + 0.5 * Math.sin(time * 70 + i)) : 0;
        const open = 0.2 + 0.9 * beat;
        r.compose(this._v.set(side * parts.wingAt[0], parts.wingAt[1], parts.wingAt[2]),
          q.setFromEuler(e.set(0.55, side * (-0.15 - open), side * -0.35, 'YXZ')), s.set(side, 1, 1));
        m.multiplyMatrices(pm, r); this.wings.setMatrixAt(2 * i + (side > 0 ? 1 : 0), m);
      }
      // front legs: lift turns them up and forward
      for (const side of [-1, 1]) {
        const lift = side < 0 ? P.legL : P.legR;
        r.compose(this._v.set(side * parts.legAt[0], parts.legAt[1], parts.legAt[2]), q.setFromEuler(e.set(-lift * 2.5, 0, side * -0.25 * lift, 'XYZ')), s.setScalar(1));
        m.multiplyMatrices(pm, r); this.legs.setMatrixAt(2 * i + (side > 0 ? 1 : 0), m);
        if (side > 0 && P.flagIdx >= 0) {
          // the flag stands in the right front hand (the leg tip)
          this._p2 = this._p2 || new THREE.Matrix4();
          this._p2.makeTranslation(0, -0.62, 0.18);
          m.multiply(this._p2);
          this._p3 = this._p3 || new THREE.Matrix4();
          this._p3.makeRotationX(lift * 2.5 - 0.1);
          m.multiply(this._p3);
          this.flags.setMatrixAt(P.flagIdx, m);
        }
      }
    }
    for (const k of [this.body, this.head, this.wings, this.legs, this.flags]) k.instanceMatrix.needsUpdate = true;
    if (this.flags.instanceColor) this.flags.instanceColor.needsUpdate = true;
  }
  tris() {
    let t = 0;
    for (const k of [this.body, this.head, this.wings, this.legs, this.flags]) { const g = k.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * k.count; }
    return Math.round(t);
  }
  dispose() {
    for (const g of ['body', 'head', 'wing', 'leg', 'flag']) this.parts[g].dispose();
    for (const x of this.mats) x.dispose();
    for (const k of [this.body, this.head, this.wings, this.legs, this.flags]) k.dispose?.();
  }
}

// ---------------------------------------------------------------- extras
// Fake games at the other tables. Each fly loops through short actions on
// its own clock. A die hops on the table when a fly rolls, a card turns
// when a fly taps it.
const EXTRA_ACTS = ['think', 'shuffle', 'tap', 'roll', 'think', 'tap', 'cheer'];
function extrasController(herd, seats, props, R) {
  const st = seats.map((s, i) => ({ ...s, act: 'think', t: 0, dur: 1 + R() * 3, k: i }));
  function pick(a) {
    a.act = EXTRA_ACTS[Math.floor(R() * EXTRA_ACTS.length)];
    a.t = 0;
    a.dur = { think: 1.5 + R() * 3, shuffle: 1.6 + R(), tap: 0.9, roll: 1.2, cheer: 1.4 }[a.act];
    if (a.act === 'roll' && a.die) a.die.h = 0;
    if (a.act === 'tap' && a.card) a.card.tapTo = a.card.tapTo ? 0 : 1;
  }
  return {
    update(dt, time) {
      for (const a of st) {
        a.t += dt;
        if (a.t > a.dur) pick(a);
        const P = herd.pose[a.i], k = Math.min(1, a.t / a.dur), env = Math.sin(Math.PI * k);
        P.lean = 0.08; P.legL = 0.15; P.legR = 0.15; P.buzz = 0; P.hy = 0; P.hp = 0.35;
        switch (a.act) {
          case 'think': P.hy = 0.25 * Math.sin(time * 0.6 + a.k); P.hp = 0.25; break;
          case 'shuffle': P.legL = 0.35 + 0.15 * Math.sin(time * 16 + a.k); P.legR = 0.35 + 0.15 * Math.sin(time * 16 + a.k + Math.PI); break;
          case 'tap': P.lean = 0.08 + 0.25 * env; P.legR = 0.15 + 0.35 * env; P.hp = 0.5; break;
          case 'roll': P.legR = 0.2 + 0.6 * env; P.hp = 0.45; break;
          case 'cheer': P.legL = P.legR = 0.9 * env; P.buzz = env; P.hp = -0.1; break;
          default: break;
        }
      }
      // props
      for (const c of props.cards) {
        if (c.tapTo == null) continue;
        c.tap = (c.tap || 0) + ((c.tapTo || 0) - (c.tap || 0)) * Math.min(1, dt * 10);
      }
      for (const d of props.dice) if (d.h < 1) d.h = Math.min(1, d.h + dt / 0.9);
      props.write();
    },
  };
}

// ----------------------------------------------------------------- crowd
// The watching crowd. Heads follow the focus. react() starts a short
// envelope on each fly with its own delay, so the reaction runs through
// the crowd and is not one sync jump.
function crowdController(herd, ids, reduced, R) {
  const fx = ids.map((i, k) => ({ i, k, sway: R() * TAU, kind: null, t: 0, dur: 1, delay: 0, gain: 0, side: -1, flagSide: -1 }));
  const _v = new THREE.Vector3();
  return {
    fx,
    react(kind, { side = -1, strength = 1 } = {}) {
      for (const f of fx) {
        f.kind = kind; f.t = 0; f.side = side;
        f.delay = reduced ? 0 : R() * 0.45;
        f.dur = kind === 'cheer' ? 1.8 : kind === 'buzz' ? 1.0 : 1.3;
        const fan = f.flagSide >= 0 && f.flagSide === side;
        f.gain = Math.min(1, strength * (0.55 + 0.45 * R()) * (fan ? 1.25 : 1));
      }
    },
    update(dt, time, focus) {
      for (const f of fx) {
        const P = herd.pose[f.i];
        // idle: weight shift and small head moves
        P.roll = reduced ? 0 : 0.025 * Math.sin(time * 0.7 + f.sway);
        P.lean = 0.05; P.legL = 0.05; P.legR = 0.05; P.buzz = 0;
        // head to the focus, in the fly's own frame
        _v.copy(focus).sub(P.pos);
        const yaw = Math.atan2(_v.x, _v.z) - P.yaw;
        const yawW = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        const dist = Math.hypot(_v.x, _v.z);
        const pitch = Math.atan2(P.pos.y + 2.4 * P.scale - focus.y, dist);
        const hy = Math.max(-1.0, Math.min(1.0, yawW)), hp = Math.max(-0.2, Math.min(0.75, pitch));
        const k = reduced ? 1 : 1 - Math.exp(-dt * (3 + (f.k % 3)));
        P.hy += (hy - P.hy) * k; P.hp += (hp - P.hp) * k;
        if (f.kind) {
          f.t += dt;
          const u = (f.t - f.delay) / f.dur;
          if (u >= 1) f.kind = null;
          else if (u > 0) {
            const env = Math.sin(Math.PI * u) * f.gain;
            if (f.kind === 'lean') P.lean = 0.05 + 0.32 * env;
            if (f.kind === 'gasp') { P.lean = 0.05 - 0.22 * env; P.legL = P.legR = 0.4 * env; }
            if (f.kind === 'buzz') { P.buzz = env; P.lean = 0.05 + 0.12 * env; }
            if (f.kind === 'cheer') { P.legL = P.legR = 0.95 * env; P.buzz = env; P.lean = -0.08 * env; }
          }
        }
        // reduced motion: no wing beat (a fast flicker), the legs and the
        // lean still show the reaction
        if (reduced) P.buzz = 0;
      }
    },
  };
}

// --------------------------------------------------------------- props
// Cards and dice on the extra tables: one InstancedMesh each.
function buildProps(tables, R, coarse) {
  const cardGeo = new THREE.BoxGeometry(0.5, 0.008, 0.7);
  const cardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const dieGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const dieMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const cards = [], dice = [];
  const backs = ['#4b2f6b', '#7a2a2a', '#1f4a6b', '#2f5a2f', '#6b5a2a'];
  for (const t of tables) {
    for (const side of [-1, 1]) {
      const back = backs[Math.floor(R() * backs.length)];
      const n = coarse ? 4 : 7;
      for (let k = 0; k < n; k++) {
        const u = -1.8 + k * 0.62 + (R() - 0.5) * 0.08, v = side * (0.9 + (k % 2) * 0.95);
        cards.push({ t, u, v, rot: (R() - 0.5) * 0.08, colour: k % 3 === 0 ? '#e9e1cf' : back, tap: 0, tapTo: null });
      }
      dice.push({ tab: t, u: 2.6, v: side * 1.2, colour: side < 0 ? '#c43b3b' : '#3b6fc4', h: 1 });
    }
  }
  const cm = new THREE.InstancedMesh(cardGeo, cardMat, cards.length); cm.name = 'extra-cards';
  const dm = new THREE.InstancedMesh(dieGeo, dieMat, dice.length); dm.name = 'extra-dice';
  cards.forEach((c, i) => cm.setColorAt(i, new THREE.Color(c.colour)));
  dice.forEach((d, i) => dm.setColorAt(i, new THREE.Color(d.colour)));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function write() {
    cards.forEach((c, i) => {
      const T = c.t;
      p.set(T.x + Math.cos(T.yaw) * c.u + Math.sin(T.yaw) * c.v, T.y + 0.006, T.z - Math.sin(T.yaw) * c.u + Math.cos(T.yaw) * c.v);
      q.setFromEuler(e.set(0, T.yaw + c.rot + (c.tap || 0) * Math.PI / 2, 0));
      cm.setMatrixAt(i, m.compose(p, q, one));
    });
    // a die hops and turns while its clock h runs from 0 to 1
    dice.forEach((d, i) => {
      const T = d.tab, k = d.h;
      const hop = Math.sin(Math.PI * Math.min(1, k)) * 0.5;
      p.set(T.x + Math.cos(T.yaw) * d.u + Math.sin(T.yaw) * d.v, T.y + 0.1 + hop, T.z - Math.sin(T.yaw) * d.u + Math.cos(T.yaw) * d.v);
      q.setFromEuler(e.set(k * 9, k * 7, 0));
      dm.setMatrixAt(i, m.compose(p, q, one));
    });
    cm.instanceMatrix.needsUpdate = true; dm.instanceMatrix.needsUpdate = true;
  }
  write();
  return {
    cards, dice, meshes: [cm, dm], write,
    dispose() { cardGeo.dispose(); cardMat.dispose(); dieGeo.dispose(); dieMat.dispose(); cm.dispose?.(); dm.dispose?.(); },
  };
}

// ================================================================ build
export function buildHall({ coarse = false, reduced = false, seed = 7, layout } = {}) {
  const L = layout;
  const R = rng(seed);
  const shadows = !coarse;
  const group = new THREE.Group(); group.name = 'hall';
  const disposables = [];
  const keep = x => { disposables.push(x); return x; };

  // shared materials
  const lamTex = keep(tex(laminateCanvas(coarse ? 128 : 256), { repeat: [6, 3] }));
  const mats = {
    laminate: keep(new THREE.MeshStandardMaterial({ map: lamTex, color: lamTex ? 0xffffff : 0xd9d5cc, roughness: 0.55 })),
    edge: keep(new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.5 })),
    under: keep(new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.9 })),
    metal: keep(new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.4, metalness: 0.7 })),
    foot: keep(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 })),
    chairSeat: keep(new THREE.MeshStandardMaterial({ color: 0x4a4f5a, roughness: 0.45, metalness: 0.5 })),
  };

  // ---- room
  const room = buildRoomShell({ coarse, shadows });
  group.add(room);

  // ---- the feature table, chairs, mats, deck boxes
  const table = new THREE.Group(); table.name = 'table';
  table.add(buildFoldingTable({ len: 2 * L.halfLen, depth: 2 * L.halfDepth, y: L.y, mats, shadows }));
  const chairs = [0, 1].map(p => {
    const c = buildChair({ seatTop: L.seatTop, mats, shadows });
    const at = L.seatPos(p, 0, 0, L.seatV + 0.05); c.position.set(at.x, 0, at.z);
    c.rotation.y = p === 0 ? Math.PI : 0;     // the sitter faces the centre
    table.add(c);
    return c;
  });
  const matPx = coarse ? 1024 : 2048;
  const zones = [
    { label: 'LANDS · MANA', u0: -2.2, u1: 2.0, v0: 1.72, v1: 2.98 },
    { label: 'CREATURES', u0: -2.2, u1: 2.0, v0: 0.7, v1: 1.66 },
    { label: 'LIBRARY', u0: 2.06, u1: 2.86, v0: 0.86, v1: 1.82 },
    { label: 'GRAVE', u0: 2.06, u1: 2.86, v0: 0.24, v1: 0.8 },
    { label: 'LIFE', round: true, u: -2.52, v: 1.12, r: 0.34 },
  ];
  const mats3 = [], inlay = [], deckBoxes = [];
  for (let p = 0; p < 2; p++) {
    const cv = matCanvas(FLY[p], p ? 'FLY B' : 'FLY A', zones, matPx);
    const t = keep(tex(cv, { aniso: 8 }));
    const w = 2 * MAT.u, d = MAT.v1 - MAT.v0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), [
      keep(new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.9 })), null, null, null, null, null,
    ]);
    const top = keep(new THREE.MeshStandardMaterial({ map: t, color: t ? 0xffffff : new THREE.Color(shade(FLY[p], 0.2)), roughness: 0.92 }));
    m.material = [m.material[0], m.material[0], top, m.material[0], m.material[0], m.material[0]];
    // mat texture: canvas y grows toward the seat (v). BoxGeometry +y face
    // uv: u along +x, v along -z. Seat 0 (+z): canvas bottom must be at
    // +z, so flipY (the default) gives row 0 at -z. The u axis of seat 0
    // is +x. Seat 1 turns the whole mat by PI.
    const c = L.seatPos(p, 0, 0, (MAT.v0 + MAT.v1) / 2);
    // The mat is 12 mm thick but sits sunk in the table top: its top face
    // is 1 mm above the laminate. Cards rest from 2 mm up (scene.js), so
    // no card goes under the mat.
    m.position.set(c.x, L.y + 0.001 - 0.006, c.z);
    m.rotation.y = p === 0 ? 0 : Math.PI;
    m.receiveShadow = true; m.name = 'playmat';
    table.add(m); mats3.push(m);
    // the seat edge band: bright in the seat colour when that fly acts
    const bandMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(FLY[p]) }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.016, 0.07), bandMat);
    const b = L.seatPos(p, 0, 0, MAT.v1 - 0.035);
    band.position.set(b.x, L.y + 0.0015 - 0.008, b.z); band.rotation.y = m.rotation.y; band.name = 'mat-band';
    table.add(band); inlay.push(bandMat);
    // deck box beside the library
    const boxMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(FLY[p]), roughness: 0.5 }));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.36), boxMat);
    const bp = L.seatPos(p, 2.62, 0, 2.55); box.position.set(bp.x, L.y + 0.31, bp.z); box.rotation.y = m.rotation.y + 0.2;
    box.castShadow = shadows; box.name = 'deck-box';
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.015, 0.37), mats.edge); lid.position.y = 0.2; box.add(lid);
    table.add(box); deckBoxes.push(box);
  }
  group.add(table);

  // ---- pairings board and banners
  const boardTex = keep(tex(pairingsCanvas(coarse ? 256 : 512, seed + 3)));
  const board = new THREE.Group(); board.name = 'pairings-board';
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.4, 0.08), [mats.edge, mats.edge, mats.edge, mats.edge, keep(new THREE.MeshStandardMaterial({ map: boardTex, color: boardTex ? 0xffffff : 0xf3f1ea, roughness: 0.8 })), mats.edge]);
  panel.position.y = 3.6; board.add(panel);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.8, 8), mats.metal); post.position.set(s * 1.75, 2.9, 0); board.add(post); }
  board.position.set(-13.5, 0, 6.5); board.rotation.y = Math.PI / 2 - 0.35;
  group.add(board);
  const banners = [
    ['FLY DUEL OPEN', 'MUSHROOM BODY CIRCUIT · ROUND 3', FLY[0], [-6, 11.2, -16], 0],
    ['FEATURE MATCH', 'TABLE 1 · FLY A vs FLY B', FLY[1], [-16, 11.2, 2], Math.PI / 2],
  ];
  for (const [a, b, col, pos, yaw] of banners) {
    const t = keep(tex(bannerCanvas(coarse ? 512 : 1024, a, b, col)));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.7), keep(new THREE.MeshBasicMaterial({ map: t, color: t ? 0xffffff : 0x10131b, side: THREE.DoubleSide })));
    m.position.set(...pos); m.rotation.y = yaw; m.name = 'banner';
    group.add(m);
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, HALL.ceiling - pos[1] - 1.35, 4), mats.metal); w.position.set(pos[0] + Math.cos(yaw) * s * 4.2, (HALL.ceiling + pos[1] + 1.35) / 2, pos[2] - Math.sin(yaw) * s * 4.2); group.add(w); }
  }

  // ---- extra tables (fake games)
  const slots = [
    { x: 0, z: -13, yaw: 0 }, { x: -11, z: -13, yaw: 0 }, { x: 11, z: -13, yaw: 0 },
    { x: -11, z: 17, yaw: 0 }, { x: 11, z: 17, yaw: 0 }, { x: -18, z: 2, yaw: Math.PI / 2 },
  ].slice(0, HALL.extraTables[coarse ? 1 : 0]);
  const tables = [];
  for (const s of slots) {
    const t = buildFoldingTable({ len: 2 * L.halfLen, depth: 2 * L.halfDepth, y: L.y, mats, shadows: false });
    t.position.set(s.x, 0, s.z); t.rotation.y = s.yaw; t.name = 'extra-table';
    group.add(t);
    for (const side of [-1, 1]) {
      const c = buildChair({ seatTop: L.seatTop, mats, shadows: false });
      const dz = side * (L.seatV + 0.05);
      c.position.set(s.x + Math.sin(s.yaw) * dz, 0, s.z + Math.cos(s.yaw) * dz);
      c.rotation.y = s.yaw + (side > 0 ? Math.PI : 0);
      group.add(c);
    }
    tables.push({ x: s.x, y: L.y, z: s.z, yaw: s.yaw });
  }
  const props = buildProps(tables, R, coarse);
  for (const m of props.meshes) group.add(m);

  // ---- the flies: extras sit, the crowd stands. Two herds (one part set
  // each), so the sitting parts have no floor legs.
  const nCrowd = HALL.crowd[coarse ? 1 : 0];
  const sitParts = lowFlyParts({ standing: false }), standParts = lowFlyParts({ standing: true });
  const nSit = tables.length * 2;
  const sit = new FlyHerd(sitParts, nSit, { name: 'extras', shadows: false });
  const nFlags = Math.round(nCrowd * 0.3);
  const crowdHerd = new FlyHerd(standParts, nCrowd, { name: 'crowd', shadows: false, flags: nFlags });
  group.add(sit.group, crowdHerd.group);
  const FS = 2.0;   // fly scale (as the players)
  const seats = [];
  tables.forEach((t, ti) => {
    for (const side of [-1, 1]) {
      const i = seats.length, P = sit.pose[i];
      const dz = side * L.seatV;
      P.pos.set(t.x + Math.sin(t.yaw) * dz, L.seatTop, t.z + Math.cos(t.yaw) * dz);
      P.yaw = t.yaw + (side > 0 ? Math.PI : 0); P.scale = FS * (0.94 + R() * 0.1);
      const card = props.cards.find(c => c.t === t && Math.sign(c.v) === side);
      const die = props.dice.find(d => d.tab === t && Math.sign(d.v) === side);
      seats.push({ i, card, die, table: ti });
    }
  });
  const extras = extrasController(sit, seats, props, R);

  // crowd places: rows on a ring in CROWD_SECTOR, jittered
  const ids = [];
  const [r0, r1] = HALL.crowdR, [a0, a1] = CROWD_SECTOR;
  const rows = 3, perRow = Math.ceil(nCrowd / rows);
  let flagSlot = 0;
  for (let i = 0; i < nCrowd; i++) {
    const row = i % rows, k = Math.floor(i / rows);
    const r = r0 + row * (r1 - r0) / (rows - 1) + (R() - 0.5) * 0.3;
    const a = a0 + (k + (row % 2) * 0.5 + 0.25) / perRow * (a1 - a0) + (R() - 0.5) * 0.04;
    const P = crowdHerd.pose[i];
    // the table is long in x: stretch the ring along x
    P.pos.set(Math.sin(a) * r * 1.12, 0, Math.cos(a) * r);
    // keep clear of the table corners and the chairs: push out along the
    // ray until the fly is outside the box
    const bx = L.halfLen + 1.7, bz = L.seatV + 1.3;
    while (Math.abs(P.pos.x) < bx && Math.abs(P.pos.z) < bz) P.pos.multiplyScalar(1.05);
    P.yaw = Math.atan2(-P.pos.x, -P.pos.z) + (R() - 0.5) * 0.3;
    P.scale = HALL.crowdScale * (0.88 + R() * 0.22);
    ids.push(i);
  }
  const crowd = crowdController(crowdHerd, ids, reduced, R);
  // flags: the flies nearer seat 0 (+z) wave Fly A, the others Fly B
  for (let i = 0; i < nCrowd && flagSlot < nFlags; i++) {
    if (R() > 0.42) continue;
    const side = crowdHerd.pose[i].pos.z > -1.5 ? 0 : 1;
    crowdHerd.setFlag(i, FLY[side], flagSlot++);
    crowd.fx[i].flagSide = side;
  }
  crowdHerd.flags.count = flagSlot;

  let time = 0;
  const focus = new THREE.Vector3(0, L.y, 0);
  function update(dt, o = {}) {
    time += dt;
    if (o.focus) focus.lerp(o.focus, reduced ? 1 : 1 - Math.exp(-dt * 4));
    extras.update(reduced ? 0 : dt, time);
    crowd.update(dt, time, focus);
    sit.write(time); crowdHerd.write(time);
  }
  update(0);

  return {
    group, table, room, mats: mats3, inlay, chairs, deckBoxes, board,
    crowd: { herd: crowdHerd, n: nCrowd, flags: flagSlot, fx: crowd.fx },
    extras: { herd: sit, n: nSit, tables: tables.length, props },
    focus,
    update,
    react: (kind, o) => crowd.react(kind, o),
    stats: () => ({ crowd: nCrowd, flags: flagSlot, extras: nSit, tables: tables.length, flyTris: crowdHerd.tris() + sit.tris() }),
    dispose() {
      for (const x of disposables) x?.dispose?.();
      sit.dispose(); crowdHerd.dispose(); props.dispose();
      group.traverse(o => { if (o.isMesh && !o.isInstancedMesh) o.geometry?.dispose(); });
    },
  };
}
