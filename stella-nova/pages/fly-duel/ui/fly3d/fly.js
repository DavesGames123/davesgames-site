// ============================================================================
//  FLY DUEL  ·  ui/fly3d/fly.js  ·  the 3D fruit fly character, rig and clips
// ----------------------------------------------------------------------------
//  This module builds one seated Drosophila melanogaster character from
//  procedural geometry (our own; only the fedora is a CC BY model, hat.js)
//  with three.js r160.
//  The anatomy is exaggerated for legibility: large brick-red compound eyes
//  with a hex facet normal map, a tan thorax with dark macrochaetae and rows
//  of microchaetae, a striped abdomen, clear iridescent wings with veins,
//  antennae with a plumose arista, a proboscis, and six legs with coxa,
//  femur, tibia and five tarsomeres. A collar and a hex badge in the fly
//  colour tell fly A from fly B. The insect colours do not change.
//
//  Frame and units. The root origin is the point where the abdomen touches
//  the stool seat. +Y is up, the fly faces +Z, and the fly's left side is +X.
//  One unit is about the seated height of the body without the antennae
//  (the head top is near y = 1.07). The scene scales the root as it needs.
//
//  Rig. The rig holds named joints (JOINT_NAMES), six legs (L1..R3, where 1
//  is the front pair) with an analytic two-bone IK on femur and tibia, hand
//  anchors at each tarsus tip, and a card fan anchor (rig.fan) near the
//  right front hand. The fan frame: +Y runs up the cards, the card faces
//  look along -Z toward the fly, and the card backs look at the opponent.
//
//  Clips. animate(rig, clip, t, opts) sets the full pose from the clip name
//  (or a spec object) and the clip time t in seconds. Each one-shot clip
//  starts and ends at the hold pose, so the scene can cut between clips.
//  opts.prev = { clip, t } and opts.mix (0..1) cross-fade from a previous
//  clip. opts.time is the global time for breathing and the tremor, so
//  that these layers do not jump when a clip changes. Targets are world
//  positions (THREE.Vector3, [x,y,z] or {x,y,z}); spec.space = 'local'
//  gives root-local positions instead. The scene can also pass the clip as
//  a bare name with opts.target, opts.dur (stretch a one-shot clip) and
//  opts.droop or opts.life (set the life).
//
//  Node. The module needs no DOM. The eye textures are DataTextures.
//
//  GREP MAP   (grep -n "^// ---" ui/fly3d/fly.js)
//    // --- constants        LODS, COLOURS, JOINT_NAMES, CLIPS, LEG_DEFS
//    // --- geometry helpers paint, smooth, taperTube, ribbon, mirrorX
//    // --- eye textures     hexEyeTextures (facet colour + normal map)
//    // --- parts            head, eyes, antenna, proboscis, thorax,
//                            abdomen, wing, leg segments, collar
//    // --- buildFly         assembly, materials, rig object, dispose
//    // --- pose             makePose, resetPose, lerpPose, applyPose
//    // --- ik               solveLeg (two-bone IK + tarsus aim)
//    // --- clips            CLIP_FNS: idle think groom reach place tap
//                            push raiseArms slump
//    // --- animate          animate(), countTriangles()
//    // --- hat              FEDORA, addFedora(rig), setHat(rig, on);
//                            the fedora model loads in ui/fly3d/hat.js
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadFedora, fedoraModel, fedoraMeshes } from './hat.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

// --- constants ---------------------------------------------------------------

// Level of detail. The phone LOD keeps the same joints and clips with fewer
// segments, fewer bristles, smaller eye textures and standard materials.
export const LODS = {
  desktop: { sph: [40, 28], eye: [48, 36], lathe: 24, legRad: 10, tube: [5, 8], micro: 220,
    legHairs: 9, tex: 256, physical: true, wingSeg: 72, arista: 7 },
  phone: { sph: [20, 14], eye: [26, 18], lathe: 12, legRad: 6, tube: [3, 4], micro: 40,
    legHairs: 0, tex: 128, physical: false, wingSeg: 36, arista: 4 },
};

// Insect colours (sRGB). three converts them to linear on set().
export const COLOURS = {
  thorax: '#b27e44', thoraxStripe: '#6e4724', thoraxSide: '#c9a06a', chest: '#dcc195',
  abdomen: '#d8b06e', band: '#33200f', belly: '#ead3a3',
  head: '#c99a5c', frons: '#cf6a26', face: '#e4c995', ocellarPatch: '#5b3a1e',
  leg: '#d6aa68', legDark: '#9c6d36', claw: '#24170c',
  eye: '#b3271d', eyeGroove: '#4a0f0b', ocellus: '#2a0c08',
  bristle: '#1a110a', vein: '#5c3d22', proboscis: '#c49c66', labellum: '#e6c690',
  arista: '#3a2615', badgeRim: '#f4efe6',
};

// Every named joint in rig.joints. Leg joints follow the pattern
// `${leg}.coxa|femur|tibia|tarsus|hand` for leg in LEG_NAMES.
export const LEG_NAMES = ['L1', 'R1', 'L2', 'R2', 'L3', 'R3'];
export const LEG_SEGMENTS = ['coxa', 'femur', 'tibia', 'tarsus', 'hand'];
export const JOINT_NAMES = [
  'root', 'body', 'abdomen', 'thorax', 'neck', 'head', 'antenna.L', 'antenna.R',
  'proboscis', 'wing.L', 'wing.R', 'haltere.L', 'haltere.R', 'collar', 'fan',
  ...LEG_NAMES.flatMap(l => LEG_SEGMENTS.map(s => `${l}.${s}`)),
];

// Clip table. duration in s; contact = time the working tarsus touches the
// target; loop clips repeat; hold clips stay in the end pose after duration.
export const CLIPS = {
  idle: { duration: 6, loop: true },
  think: { duration: 2, loop: true },
  groom: { duration: 2.8 },
  reach: { duration: 1.0, contact: 0.48, leg: 'L1' },
  place: { duration: 1.3, contact: 0.66, leg: 'L1' },
  tap: { duration: 0.8, contact: 0.36, leg: 'auto' },
  push: { duration: 1.2, contact: 0.38, release: 0.8, leg: 'auto' },
  raiseArms: { duration: 1.4, hold: true },
  slump: { duration: 1.6, hold: true },
};

// Leg definitions for the left side (x > 0). The right side mirrors x.
// attach is a thorax-local point near the ventral surface (front, +Z).
// Lengths in fly units, exaggerated (real fly legs are long, so this fits).
const LEG_DEFS = [
  { pair: 1, attach: [0.062, 0.300, 0.122], coxaDir: [0.30, -0.42, 0.86], coxa: 0.075,
    femur: 0.255, tibia: 0.245, tarsus: 0.17, rf: 0.030, rt: 0.020 },
  { pair: 2, attach: [0.088, 0.185, 0.128], coxaDir: [0.62, -0.50, 0.60], coxa: 0.062,
    femur: 0.27, tibia: 0.26, tarsus: 0.19, rf: 0.027, rt: 0.018 },
  { pair: 3, attach: [0.082, 0.075, 0.110], coxaDir: [0.58, -0.72, 0.38], coxa: 0.062,
    femur: 0.29, tibia: 0.28, tarsus: 0.20, rf: 0.029, rt: 0.019 },
];

// Fixed body layout (fly units, body-local before the seat shift).
const PETIOLE_Y = 0.44;          // abdomen / thorax joint height
const ABD_TILT = 0.30;           // abdomen tip leans back (rad about X)
const THORAX_C = [0, 0.19, 0];   // thorax ellipsoid centre, thorax-local
const THORAX_R = [0.165, 0.21, 0.195, 0.15]; // x, y, dorsal z, ventral z
const NECK = [0, 0.39, 0.035];  // neck joint, thorax-local
const HEAD_C = [0, 0.10, 0.025]; // head ellipsoid centre, head-local
const HEAD_R = [0.15, 0.125, 0.115];
const HEAD_SCALE = 1.16;        // a big head reads better at table distance

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const col = hex => new THREE.Color(hex);

// --- geometry helpers --------------------------------------------------------

// Write a per-vertex colour attribute. fn(x, y, z, colour, i) sets colour.
function paint(geo, fn) {
  const p = geo.attributes.position, n = p.count;
  const a = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c, i);
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const solid = (geo, hex) => { const k = col(hex); return paint(geo, (x, y, z, c) => c.copy(k)); };

// Give every geometry the same attribute set (position, normal, uv, color)
// so that mergeGeometries accepts them.
function norm(geo) {
  if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}
function merge(list) {
  const g = mergeGeometries(list.map(norm), false);
  for (const x of list) x.dispose();
  return g;
}

// Weld the UV seam of a deformed sphere and recompute smooth normals.
function smoothNormals(geo) {
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-5);
  geo.dispose();
  g.computeVertexNormals();
  return norm(g);
}

const ellipsoid = (rx, ry, rz, w, h) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

// Tapered tube along a Catmull-Rom curve through pts (radius r0 -> r1).
function taperTube(pts, r0, r1, radial, segs) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const fr = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const p = new V3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs; curve.getPointAt(u, p);
    const r = lerp(r0, r1, u), N = fr.normals[i], B = fr.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      pos.push(p.x + r * nx, p.y + r * ny, p.z + r * nz); nor.push(nx, ny, nz); uv.push(u, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Flat ribbon along a 2D polyline in the XY plane at height z, width w(s).
function ribbon(pts, w, z) {
  const pos = [], idx = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const hw = w(i / (n - 1)) / 2;
    pos.push(pts[i].x - ty * hw, pts[i].y + tx * hw, z, pts[i].x + ty * hw, pts[i].y - tx * hw, z);
  }
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return norm(g);
}

// Mirror in x and repair the triangle winding (no negative object scale).
function mirrorX(geo) {
  const g = geo.clone(); g.scale(-1, 1, 1);
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return g;
}

// Point and outward normal on an axis ellipsoid (centre c, radii r) in the
// direction d from the centre.
function onEllipsoid(c, r, d) {
  const t = 1 / Math.hypot(d[0] / r[0], d[1] / r[1], d[2] / r[2]);
  const p = new V3(d[0] * t, d[1] * t, d[2] * t);
  const n = new V3(p.x / (r[0] * r[0]), p.y / (r[1] * r[1]), p.z / (r[2] * r[2])).normalize();
  return { p: p.add(new V3(...c)), n };
}

// One curved, tapered bristle (macrochaeta) that lifts off the surface and
// lies back along `lay` (projected onto the surface tangent plane).
function bristle(p, n, lay, len, r0, L) {
  const b = lay.clone().addScaledVector(n, -lay.dot(n)).normalize();
  const pts = [
    p.clone().addScaledVector(n, -0.004),
    p.clone().addScaledVector(n, len * 0.28).addScaledVector(b, len * 0.18),
    p.clone().addScaledVector(n, len * 0.46).addScaledVector(b, len * 0.58),
    p.clone().addScaledVector(n, len * 0.44).addScaledVector(b, len * 1.0),
  ];
  return taperTube(pts, r0, r0 * 0.18, L.tube[0], L.tube[1]);
}

// --- eye textures ------------------------------------------------------------

// A tileable hex lattice of ommatidia, 7 columns x 8 rows per tile. Each
// facet is a small dome in the normal map and has its own colour shade.
// The grooves between facets are dark and flat. Data row 0 is v = 0, so
// +row is the tangent +Y that three uses for the normal map.
const HEX_W = 7, HEX_H = 8, HEX_RH = Math.sqrt(3) / 2;
function hexEyeTextures(size, seed) {
  const colour = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  const base = col(COLOURS.eye).convertLinearToSRGB(), groove = col(COLOURS.eyeGroove).convertLinearToSRGB();
  const shade = new Float32Array(HEX_W * HEX_H), rnd = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0; i < shade.length; i++) shade[i] = 0.88 + 0.18 * rnd();
  const tileH = HEX_H * HEX_RH;
  const mod = (a, m) => ((a % m) + m) % m;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = ((px + 0.5) / size) * HEX_W, v = ((py + 0.5) / size) * tileH;
    let best = 1e9, bc = 0, br = 0, bdx = 0, bdy = 0;
    const r0 = Math.floor(v / HEX_RH);
    for (let r = r0 - 1; r <= r0 + 2; r++) {
      const off = mod(r, 2) ? 0.5 : 0, cy = r * HEX_RH, c0 = Math.round(u - off);
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        const dx = u - (c + off), dy = v - cy, d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; bc = c; br = r; bdx = dx; bdy = dy; }
      }
    }
    const hd = Math.max(Math.abs(bdx), Math.abs(bdx * 0.5 + bdy * HEX_RH), Math.abs(bdx * 0.5 - bdy * HEX_RH)) / 0.5;
    const k = (py * size + px) * 4;
    let nx = 0, ny = 0, nz = 1, cr, cg, cb;
    if (hd < 0.84) {
      const s = shade[mod(br, HEX_H) * HEX_W + mod(bc, HEX_W)];
      const lift = 1 + 0.08 * (1 - hd); // a little brighter at the dome centre
      cr = base.r * s * lift; cg = base.g * s * lift; cb = base.b * s * lift;
      nx = bdx * 1.5; ny = bdy * 1.5;
    } else {
      cr = groove.r; cg = groove.g; cb = groove.b;
    }
    const l = Math.hypot(nx, ny, nz);
    normal[k] = Math.round((nx / l * 0.5 + 0.5) * 255);
    normal[k + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
    normal[k + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
    normal[k + 3] = 255;
    colour[k] = Math.round(clamp(cr, 0, 1) * 255);
    colour[k + 1] = Math.round(clamp(cg, 0, 1) * 255);
    colour[k + 2] = Math.round(clamp(cb, 0, 1) * 255);
    colour[k + 3] = 255;
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(colour, true), normalMap: mk(normal, false) };
}

// --- parts -------------------------------------------------------------------

// Head capsule (eyes are separate). Head-local, centre HEAD_C.
function headGeo(L) {
  const g = smoothNormals(ellipsoid(...HEAD_R, ...L.sph).translate(...HEAD_C));
  const head = col(COLOURS.head), frons = col(COLOURS.frons), face = col(COLOURS.face), patch = col(COLOURS.ocellarPatch);
  return paint(g, (x, y, z, c) => {
    const lx = x - HEAD_C[0], ly = y - HEAD_C[1], lz = z - HEAD_C[2];
    c.copy(head);
    const front = smooth(0.0, 0.07, lz);
    c.lerp(face, front * smooth(0.0, -0.05, ly));                         // pale lower face
    c.lerp(frons, front * smooth(-0.02, 0.03, ly) * smooth(0.1, 0.05, Math.abs(lx))); // orange frons
    c.lerp(patch, smooth(0.09, 0.12, ly) * smooth(0.05, 0.02, Math.abs(lx)) * smooth(0.05, 0.0, Math.abs(lz))); // ocellar triangle
  });
}

// One compound eye: an ellipsoid with a Lambert azimuthal UV map about its
// outward axis, so the hex facets sit evenly over the visible half.
const EYE_R = [0.088, 0.128, 0.112], EYE_FACETS = 9.5; // facets per unit of rho
function eyeGeo(L, side) {
  const g = new THREE.SphereGeometry(1, L.eye[0], L.eye[1]);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * side, y = p.getY(i), z = p.getZ(i);
    const th = Math.acos(clamp(x, -1, 1)), rho = 2 * Math.sin(th / 2), phi = Math.atan2(y, z);
    uv.setXY(i, 0.5 + (rho * Math.cos(phi) * EYE_FACETS) / HEX_W, 0.5 + (rho * Math.sin(phi) * EYE_FACETS) / (HEX_H * HEX_RH));
  }
  g.scale(...EYE_R);
  g.computeVertexNormals();
  return g;
}

function ocelliGeo(L) {
  const parts = [[0, 0.222, 0.045], [0.022, 0.217, 0.012], [-0.022, 0.217, 0.012]]
    .map(c => new THREE.SphereGeometry(0.012, 10, 8).translate(...c));
  return merge(parts);
}

// Head bristles: verticals, postverticals, ocellars and three orbitals per
// side along the inner eye margin. Directions are from the head centre.
function headBristles(L) {
  const list = [];
  const back = new V3(0, 0.6, -1), up = new V3(0, 1, 0.2);
  for (const s of [1, -1]) {
    const spots = [
      [[0.55 * s, 0.75, -0.35], back, 0.085, 0.0050], // inner vertical
      [[0.8 * s, 0.55, -0.4], new V3(s, 0.2, -1), 0.075, 0.0045], // outer vertical
      [[0.12 * s, 0.8, -0.55], new V3(-s, 0.4, -1), 0.06, 0.0038], // postvertical
      [[0.13 * s, 0.98, 0.12], new V3(s * 0.8, 0.3, 1), 0.06, 0.0038], // ocellar
      [[0.42 * s, 0.82, 0.38], up, 0.06, 0.0038], // orbitals
      [[0.45 * s, 0.68, 0.55], up, 0.055, 0.0035],
      [[0.46 * s, 0.5, 0.7], new V3(0, 1, 0.5), 0.05, 0.0032],
    ];
    for (const [d, lay, len, r] of spots) {
      const { p, n } = onEllipsoid(HEAD_C, HEAD_R, d);
      list.push(bristle(p, n, lay, len, r, L));
    }
  }
  return merge(list);
}

// Antenna, antenna-local: scape and pedicel run forward (+Z), the large
// third segment (funiculus) hangs down, and the plumose arista points out
// and forward. side = +1 left, -1 right.
function antennaGeo(L, side) {
  const tan = col(COLOURS.head), orange = col('#d98a45'), dark = col(COLOURS.arista);
  const scape = solid(new THREE.CylinderGeometry(0.011, 0.013, 0.028, L.legRad, 1).rotateX(Math.PI / 2).translate(0, 0, 0.014), COLOURS.head);
  const pedicel = solid(ellipsoid(0.016, 0.015, 0.017, 14, 10).translate(0, -0.002, 0.034), '#b98443');
  const funic = paint(ellipsoid(0.018, 0.034, 0.021, 16, 12).translate(0, -0.03, 0.046), (x, y, z, c) => c.copy(orange).lerp(tan, smooth(-0.06, 0.0, y)));
  const a0 = new V3(0.014 * side, -0.016, 0.052);
  const aristaPts = [a0, new V3(0.04 * side, -0.004, 0.08), new V3(0.07 * side, 0.016, 0.11), new V3(0.095 * side, 0.03, 0.14)];
  const parts = [scape, pedicel, funic, solid(taperTube(aristaPts, 0.0045, 0.0012, L.tube[0], L.tube[1] + 2), COLOURS.arista)];
  const curve = new THREE.CatmullRomCurve3(aristaPts);
  for (let i = 0; i < L.arista; i++) {
    const u = 0.25 + (0.7 * i) / L.arista, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    for (const dir of i % 2 ? [1] : [1, -1]) {
      const out = new V3(0, dir, 0.2 * dir).addScaledVector(t, 0.45).normalize();
      const len = (dir > 0 ? 0.028 : 0.018) * (1 - 0.5 * u);
      parts.push(solid(taperTube([p.clone(), p.clone().addScaledVector(out, len * 0.5), p.clone().addScaledVector(out, len)], 0.0016, 0.0005, 3, 2), COLOURS.arista));
    }
  }
  void dark;
  return merge(parts);
}

// Proboscis, proboscis-local: it hangs down (-Y) from under the head and
// ends in the two pale lobes of the labellum.
function proboscisGeo(L) {
  const prof = [[0, 0], [0.026, 0.004], [0.028, 0.03], [0.022, 0.06], [0.017, 0.085], [0.0, 0.09]].map(([r, y]) => new THREE.Vector2(r, y));
  const stem = solid(new THREE.LatheGeometry(prof, L.lathe).rotateX(Math.PI), COLOURS.proboscis);
  const lobes = [1, -1].map(s => solid(ellipsoid(0.017, 0.016, 0.024, 14, 10).translate(0.012 * s, -0.095, 0.006), COLOURS.labellum));
  return merge([stem, ...lobes]);
}

// Thorax, thorax-local, joint at the petiole. The back (-Z, dorsal) is a
// higher dome than the chest (+Z, ventral). The scutellum is the shield at
// the lower back. Two faint dorsocentral stripes run down the back.
function thoraxGeo(L) {
  const g = new THREE.SphereGeometry(1, ...L.sph);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const taper = 1 - 0.16 * Math.max(0, y) ** 2;
    p.setXYZ(i, x * THORAX_R[0] * taper + THORAX_C[0], y * THORAX_R[1] + THORAX_C[1], z * (z < 0 ? THORAX_R[2] : THORAX_R[3]) * taper + THORAX_C[2]);
  }
  const body = smoothNormals(g);
  const scut = smoothNormals(ellipsoid(0.085, 0.05, 0.06, L.sph[0] >> 1, L.sph[1] >> 1).rotateX(-0.5).translate(0, 0.045, -0.125));
  const base = col(COLOURS.thorax), stripe = col(COLOURS.thoraxStripe), sideC = col(COLOURS.thoraxSide), chest = col(COLOURS.chest);
  const tint = (x, y, z, c) => {
    const dz = z - THORAX_C[2];
    c.copy(base);
    const dorsal = smooth(0.0, -0.1, dz);
    c.lerp(stripe, 0.45 * dorsal * Math.exp(-(((Math.abs(x) - 0.045) / 0.017) ** 2)));
    c.lerp(sideC, smooth(0.08, 0.14, Math.abs(x)) * 0.6);
    c.lerp(chest, smooth(0.02, 0.1, dz));
  };
  paint(body, tint); paint(scut, (x, y, z, c) => c.copy(base).lerp(stripe, 0.25));
  return merge([body, scut]);
}

// Macrochaetae of the notum: the classic paired bristles (humeral,
// notopleural, presutural, supra-alar, postalar, dorsocentral, scutellar).
// Spots are (lateral, longitudinal) fractions of the thorax radii on the
// back. Bristles lie back toward the abdomen (-Y here).
const NOTUM_SPOTS = [
  // [fx, fy, len, r, name]
  [0.88, 0.55, 0.10, 0.0052], // humeral (postpronotal)
  [0.78, 0.68, 0.085, 0.0048],
  [0.97, 0.22, 0.11, 0.0052], // notopleural
  [0.96, 0.05, 0.10, 0.0050],
  [0.72, 0.30, 0.11, 0.0052], // presutural
  [0.82, -0.10, 0.12, 0.0055], // supra-alar
  [0.78, -0.38, 0.12, 0.0055],
  [0.70, -0.62, 0.13, 0.0058], // postalar
  [0.33, 0.12, 0.13, 0.0058], // anterior dorsocentral
  [0.33, -0.38, 0.15, 0.0062], // posterior dorsocentral
];
function notumBristles(L) {
  const list = [];
  const lay = new V3(0, -1, -0.15);
  for (const s of [1, -1]) {
    for (const [fx, fy, len, r] of NOTUM_SPOTS) {
      const d = [fx * s, fy, -Math.sqrt(Math.max(0.02, 1 - fx * fx - fy * fy))];
      const { p, n } = onEllipsoid(THORAX_C, [THORAX_R[0], THORAX_R[1], THORAX_R[2]], d);
      list.push(bristle(p, n, lay.clone().add(new V3(0.15 * s * fx, 0, 0)), len, r, L));
    }
    // scutellars: anterior pair and the long apical pair that cross.
    const sc = [[0.07 * s, 0.07, -0.165, new V3(0.3 * s, -1, -0.4), 0.12], [0.03 * s, 0.025, -0.175, new V3(-0.35 * s, -1, -0.5), 0.17]];
    for (const [x, y, z, ly, len] of sc) list.push(bristle(new V3(x, y, z), new V3(0.2 * Math.sign(x), -0.2, -1).normalize(), ly, len, 0.0062, L));
  }
  return merge(list);
}

// Microchaetae: short hairs in loose rows on the scutum, one InstancedMesh.
function microMatrices(L, rnd) {
  const out = [], q = new THREE.Quaternion(), m = new THREE.Matrix4(), Y = new V3(0, 1, 0);
  const rows = 9, n = L.micro;
  for (let i = 0; i < n; i++) {
    const row = i % rows, fx = ((row / (rows - 1)) * 2 - 1) * 0.62 + (rnd() - 0.5) * 0.05;
    const fy = 0.62 - 1.2 * (Math.floor(i / rows) / Math.ceil(n / rows)) + (rnd() - 0.5) * 0.06;
    const d = [fx, fy, -Math.sqrt(Math.max(0.05, 1 - fx * fx - fy * fy))];
    const { p, n: nn } = onEllipsoid(THORAX_C, [THORAX_R[0], THORAX_R[1], THORAX_R[2]], d);
    const dir = nn.clone().multiplyScalar(0.45).add(new V3(0, -1, -0.1)).normalize();
    q.setFromUnitVectors(Y, dir);
    const s = 0.8 + 0.4 * rnd();
    m.compose(p.addScaledVector(nn, -0.002), q, new V3(s, s, s));
    out.push(m.clone());
  }
  return out;
}

// Abdomen, abdomen-local: hangs down (-Y) from the petiole. Six visible
// tergites, each with a dark band at its posterior edge on the back and the
// sides. The last two are dark (as in the male). The belly is pale.
const ABD_LEN = 0.47, ABD_R = 0.168, ABD_SEGS = [0.1, 0.27, 0.43, 0.58, 0.72, 0.85, 1.0];
function abdomenGeo(L) {
  const prof = [];
  const N = 56;
  for (let i = 0; i <= N; i++) {
    const s = i / N, u = 0.13 + 0.87 * s;
    let r = ABD_R * Math.sin(Math.PI * u) ** 0.62;
    for (const b of ABD_SEGS.slice(0, -1)) r *= 1 - 0.045 * Math.exp(-(((s - b) / 0.014) ** 2));
    prof.push(new THREE.Vector2(i === N ? 0 : r, s * ABD_LEN));
  }
  const g = new THREE.LatheGeometry(prof, L.lathe + 8);
  g.rotateX(Math.PI); // +Y -> -Y (z flips too; the lathe is round)
  g.scale(1, 1, 0.94);
  const base = col(COLOURS.abdomen), band = col(COLOURS.band), belly = col(COLOURS.belly);
  return norm(paint(g, (x, y, z, c) => {
    const s = -y / ABD_LEN, ang = Math.atan2(x, z); // ang 0 = belly (+Z)
    const around = smooth(0.7, 1.25, Math.abs(ang)); // 0 belly .. 1 back and sides
    let k = 0;
    for (let i = 1; i < ABD_SEGS.length; i++) {
      const a = ABD_SEGS[i - 1], b = ABD_SEGS[i];
      if (s >= a && s < b) { const f = (s - a) / (b - a); k = i >= 5 ? 1 : smooth(0.5, 0.62, f); }
    }
    c.copy(base).lerp(band, k * around).lerp(belly, (1 - around) * 0.8);
  }));
}

// Wing outline (wing units: hinge near 0, tip at x = 1, leading edge +y).
function wingPoint(th) {
  const x = 0.52 + 0.48 * Math.cos(th);
  let y = 0.205 * Math.sin(th);
  y *= y > 0 ? 0.82 : 1.12;
  y *= 0.22 + 0.78 * smooth(0.0, 0.32, x);
  return new THREE.Vector2(x, y - 0.012 * (1 - x));
}
// Membrane and veins: costa along the front margin, longitudinal veins
// L2-L5 from the base to the margin, L6 short, crossveins ACV and PCV.
function wingGeos(L, len) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= L.wingSeg; i++) {
    const p = wingPoint((i / L.wingSeg) * TAU);
    i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y);
  }
  const membrane = new THREE.ShapeGeometry(shape, 1);
  const bez = (o, c, e, s) => new THREE.Vector2(
    (1 - s) ** 2 * o.x + 2 * (1 - s) * s * c.x + s * s * e.x,
    (1 - s) ** 2 * o.y + 2 * (1 - s) * s * c.y + s * s * e.y);
  const V = (x, y) => new THREE.Vector2(x, y);
  const veins = {
    L2: [V(0.1, 0.015), V(0.4, 0.09), wingPoint(1.15)],
    L3: [V(0.1, 0.0), V(0.55, 0.06), wingPoint(0.38)],
    L4: [V(0.11, -0.02), V(0.55, -0.04), wingPoint(-0.28)],
    L5: [V(0.12, -0.04), V(0.5, -0.13), wingPoint(-1.2)],
    L6: [V(0.12, -0.055), V(0.25, -0.1), V(0.36, -0.14)],
  };
  const parts = [];
  const vpts = {};
  for (const [k, [o, c, e]] of Object.entries(veins)) {
    const pts = []; for (let i = 0; i <= 16; i++) pts.push(bez(o, c, e, i / 16));
    vpts[k] = pts;
    for (const z of [0.0025, -0.0025]) parts.push(ribbon(pts, s => lerp(0.016, 0.008, s), z));
  }
  const costa = []; for (let i = 0; i <= 24; i++) costa.push(wingPoint(lerp(Math.PI - 0.45, -0.28, i / 24)));
  for (const z of [0.0025, -0.0025]) parts.push(ribbon(costa, s => lerp(0.02, 0.011, s), z));
  const cross = (a, sa, b, sb) => [vpts[a][Math.round(sa * 16)], vpts[b][Math.round(sb * 16)]];
  for (const [p0, p1] of [cross('L3', 0.42, 'L4', 0.4), cross('L4', 0.7, 'L5', 0.62)]) {
    const pts = [p0, p0.clone().lerp(p1, 0.5), p1];
    for (const z of [0.0025, -0.0025]) parts.push(ribbon(pts, () => 0.011, z));
  }
  const veinGeo = merge(parts).scale(len, len, 1);
  membrane.scale(len, len, 1);
  return { membrane: norm(membrane), veins: veinGeo };
}

// Leg segments, all along +Y from the joint.
function latheSeg(profile, L, colourFn) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), L.legRad);
  return paint(norm(g), colourFn);
}
function legGeos(def, L) {
  const leg = col(COLOURS.leg), dark = col(COLOURS.legDark), claw = col(COLOURS.claw);
  const knuckle = (yl, len) => (x, y, z, c) => c.copy(leg).lerp(dark, Math.max(smooth(0.035, 0, y), smooth(len - 0.03, len, y)) * 0.55);
  const cl = def.coxa, cf = def.femur, ct = def.tibia, cs = def.tarsus, rf = def.rf, rt = def.rt;
  const coxa = latheSeg([[0, -0.01], [0.036, 0.0], [0.04, cl * 0.4], [0.031, cl * 0.9], [0, cl + 0.005]], L, knuckle(0, cl));
  const femur = latheSeg([[0, -0.012], [0.022, 0.0], [0.024, 0.03], [rf * 0.9, 0.06], [rf, cf * 0.4], [rf * 0.82, cf * 0.85], [rf * 0.78, cf * 0.97], [0, cf + 0.01]], L, knuckle(0, cf));
  const tibia = latheSeg([[0, -0.006], [rt * 0.9, 0.0], [rt, ct * 0.3], [rt * 0.8, ct * 0.95], [rt * 0.88, ct], [0, ct + 0.006]], L, knuckle(0, ct));
  const fr = [0.36, 0.17, 0.15, 0.13, 0.19];
  const tarsus = []; let y = 0;
  for (let i = 0; i < 5; i++) {
    const l = cs * fr[i], r = rt * (0.78 - 0.06 * i);
    tarsus.push(latheSeg([[0, y - 0.003], [r * 0.85, y], [r, y + l * 0.5], [r * 0.8, y + l], [0, y + l + 0.003]], L, (x, yy, z, c) => c.copy(leg).lerp(dark, 0.25 * i / 4)));
    y += l;
  }
  // Claws and pulvilli at the tip: two hooked claws and two pale pads.
  for (const s of [1, -1]) {
    const pts = [new V3(0.004 * s, y - 0.006, 0), new V3(0.012 * s, y + 0.008, 0.002), new V3(0.012 * s, y + 0.014, 0.012)];
    tarsus.push(solid(taperTube(pts, 0.0035, 0.001, 4, 3), COLOURS.claw));
    tarsus.push(solid(ellipsoid(0.007, 0.005, 0.006, 8, 6).translate(0.005 * s, y + 0.001, -0.004), '#e8d0a6'));
  }
  void claw;
  const out = { coxa, femur, tibia, tarsus: merge(tarsus), hairs: null };
  if (L.legHairs) {
    const hairs = [];
    const rnd = mulberry32(def.pair * 977);
    for (const [seg, len, r] of [['femur', cf, rf], ['tibia', ct, rt]]) {
      for (let i = 0; i < L.legHairs; i++) {
        const yy = len * (0.15 + 0.8 * (i / L.legHairs)), a = rnd() * TAU;
        const n = new V3(Math.cos(a), 0, Math.sin(a));
        const tip = n.clone().multiplyScalar(0.55).add(new V3(0, 1, 0)).normalize();
        const p0 = n.clone().multiplyScalar(r * 0.8).setY(yy);
        hairs.push({ seg, g: taperTube([p0, p0.clone().addScaledVector(tip, 0.02), p0.clone().addScaledVector(tip, 0.04)], 0.0028, 0.0006, 3, 2) });
      }
    }
    out.hairs = {
      femur: merge(hairs.filter(h => h.seg === 'femur').map(h => h.g)),
      tibia: merge(hairs.filter(h => h.seg === 'tibia').map(h => h.g)),
    };
  }
  return out;
}

// Haltere: a thin stalk with a round knob, haltere-local along -Y.
function haltereGeo(L) {
  const stalk = solid(new THREE.CylinderGeometry(0.004, 0.006, 0.05, 6, 1).translate(0, -0.025, 0), COLOURS.thoraxSide);
  const knob = solid(ellipsoid(0.014, 0.017, 0.014, 10, 8).translate(0, -0.058, 0), COLOURS.belly);
  return merge([stalk, knob]);
}

// --- buildFly ----------------------------------------------------------------

/**
 * Build one fly.
 * @param {{ colour?: string|number, seed?: number, lod?: 'desktop'|'phone',
 *           detail?: 'high'|'low', lowDetail?: boolean,
 *           tableY?: number, tableZ?: number }} opts
 *   colour: collar and badge colour (fly A cyan, fly B magenta).
 *   tableY / tableZ: table top height and near edge (root-local) for the
 *   middle-leg rest pose. Defaults 0.42 and 0.26.
 * @returns {{ root: THREE.Group, rig: object, dispose: () => void }}
 */
export function buildFly(opts = {}) {
  const { colour = '#39d0f0', seed = 1, tableY = 0.42, tableZ = 0.26 } = opts;
  // lod; the scene may also say detail: 'low' or lowDetail: true.
  const lod = opts.lod ?? (opts.lowDetail || opts.detail === 'low' ? 'phone' : 'desktop');
  const L = LODS[lod] || LODS.desktop;
  const rnd = mulberry32((seed >>> 0) || 1);
  const owned = { geos: [], mats: [], texs: [] };
  const G = g => (owned.geos.push(g), g);
  const M = m => (owned.mats.push(m), m);

  // Materials. The cuticle uses vertex colours. On desktop it has a light
  // clearcoat and sheen, so the bristly thorax catches the rim light.
  const Std = L.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const physicalExtra = L.physical ? { clearcoat: 0.3, clearcoatRoughness: 0.45, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffe2b0') } : {};
  const cuticle = M(new Std({ vertexColors: true, roughness: 0.52, metalness: 0, ...physicalExtra, name: 'fly.cuticle' }));
  const bristleMat = M(new THREE.MeshStandardMaterial({ color: COLOURS.bristle, roughness: 0.35, name: 'fly.bristle' }));
  const tex = hexEyeTextures(L.tex, seed);
  owned.texs.push(tex.map, tex.normalMap);
  const eyeMat = M(new Std({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.32,
    ...(L.physical ? { clearcoat: 0.7, clearcoatRoughness: 0.18 } : {}), name: 'fly.eye' }));
  const ocellusMat = M(new Std({ color: COLOURS.ocellus, roughness: 0.15, ...(L.physical ? { clearcoat: 1 } : {}), name: 'fly.ocellus' }));
  const membraneMat = M(new THREE.MeshPhysicalMaterial({
    color: '#f2f6ff', transparent: true, opacity: 0.26, roughness: 0.12, metalness: 0,
    iridescence: 1, iridescenceIOR: 1.55, iridescenceThicknessRange: [180, 620],
    side: THREE.DoubleSide, depthWrite: false, name: 'fly.wing',
  }));
  const veinMat = M(new THREE.MeshStandardMaterial({ color: COLOURS.vein, roughness: 0.5, side: THREE.DoubleSide, name: 'fly.vein' }));
  const flyColour = new THREE.Color(colour);
  const collarMat = M(new Std({ color: flyColour, roughness: 0.3, metalness: 0.1, ...(L.physical ? { clearcoat: 0.8, clearcoatRoughness: 0.2 } : {}), name: 'fly.collar' }));
  const rimMat = M(new THREE.MeshStandardMaterial({ color: COLOURS.badgeRim, roughness: 0.35, name: 'fly.badgeRim' }));

  const joints = {};
  const J = (name, parent, pos = [0, 0, 0]) => {
    const o = new THREE.Object3D(); o.name = `fly.${name}`; o.position.set(...pos);
    parent.add(o); joints[name] = o; return o;
  };
  const mesh = (geo, mat, parent, shadow = true) => {
    const m = new THREE.Mesh(G(geo), mat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  };

  const root = new THREE.Group(); root.name = 'fly'; joints.root = root;
  const body = J('body', root);
  const abdomen = J('abdomen', body, [0, PETIOLE_Y, -0.01]);
  mesh(abdomenGeo(L), cuticle, abdomen);
  const thorax = J('thorax', body, [0, PETIOLE_Y, 0]);
  mesh(thoraxGeo(L), cuticle, thorax);
  mesh(notumBristles(L), bristleMat, thorax, false);
  const coneGeo = G(new THREE.ConeGeometry(0.0032, 0.03, 3, 1, true).translate(0, 0.015, 0));
  const micro = new THREE.InstancedMesh(coneGeo, bristleMat, L.micro);
  microMatrices(L, rnd).forEach((m, i) => micro.setMatrixAt(i, m));
  micro.instanceMatrix.needsUpdate = true; micro.name = 'fly.microchaetae';
  thorax.add(micro);

  // Collar ring at the neck and a hex badge on the chest, in the fly colour.
  const collar = J('collar', thorax, [0, 0.372, 0.03]);
  mesh(new THREE.TorusGeometry(0.088, 0.022, L.legRad, L.lathe * 2).rotateX(Math.PI / 2), collarMat, collar);
  const badge = new THREE.Object3D(); badge.position.set(0, -0.058, 0.118); badge.rotation.x = -0.32; collar.add(badge);
  mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.014, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 6), rimMat, badge);
  mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.016, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 6).translate(0, 0, 0.002), collarMat, badge);

  // Head.
  const neck = J('neck', thorax, NECK);
  const head = J('head', neck);
  head.scale.setScalar(HEAD_SCALE);
  mesh(headGeo(L), cuticle, head);
  for (const s of [1, -1]) {
    const e = mesh(eyeGeo(L, s), eyeMat, head);
    e.position.set(0.098 * s, HEAD_C[1] + 0.008, HEAD_C[2] + 0.012);
    e.rotation.y = -0.22 * s; // eyes turn a little to the front
  }
  mesh(ocelliGeo(L), ocellusMat, head, false);
  mesh(headBristles(L), bristleMat, head, false);
  for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
    const a = J(`antenna.${n}`, head, [0.026 * s, HEAD_C[1] + 0.012, HEAD_C[2] + 0.104]);
    a.scale.setScalar(1.3); // antennae a little larger than life
    mesh(antennaGeo(L, s), cuticle, a, false);
  }
  const prob = J('proboscis', head, [0, HEAD_C[1] - 0.085, HEAD_C[2] + 0.06]);
  mesh(proboscisGeo(L), cuticle, prob, false);

  // Wings and halteres.
  const wingLen = 0.62;
  const wg = wingGeos(L, wingLen);
  const wgR = { membrane: mirrorX(wg.membrane), veins: mirrorX(wg.veins) };
  for (const [s, n, geo] of [[1, 'L', wg], [-1, 'R', wgR]]) {
    const w = J(`wing.${n}`, thorax, [0.088 * s, 0.27, -0.142]);
    const mm = mesh(geo.membrane, membraneMat, w, false); mm.renderOrder = 2;
    mesh(geo.veins, veinMat, w, true);
    const h = J(`haltere.${n}`, thorax, [0.1 * s, 0.13, -0.11]);
    mesh(haltereGeo(L), cuticle, h, false);
  }

  // Legs.
  const legs = [], hands = {};
  const Y = new V3(0, 1, 0);
  for (const def of LEG_DEFS) {
    const geos = legGeos(def, L);
    for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
      const name = `${side}${def.pair}`;
      const attach = new V3(def.attach[0] * s, def.attach[1], def.attach[2]);
      const coxa = J(`${name}.coxa`, thorax, attach.toArray());
      const cdir = new V3(def.coxaDir[0] * s, def.coxaDir[1], def.coxaDir[2]).normalize();
      coxa.quaternion.setFromUnitVectors(Y, cdir);
      mesh(geos.coxa.clone(), cuticle, coxa);
      const femur = J(`${name}.femur`, coxa, [0, def.coxa, 0]);
      mesh(geos.femur.clone(), cuticle, femur);
      const tibia = J(`${name}.tibia`, femur, [0, def.femur, 0]);
      mesh(geos.tibia.clone(), cuticle, tibia);
      const tarsus = J(`${name}.tarsus`, tibia, [0, def.tibia, 0]);
      mesh(geos.tarsus.clone(), cuticle, tarsus);
      const hand = J(`${name}.hand`, tarsus, [0, def.tarsus, 0]);
      if (geos.hairs) { mesh(geos.hairs.femur.clone(), bristleMat, femur, false); mesh(geos.hairs.tibia.clone(), bristleMat, tibia, false); }
      const leg = { name, side: s, pair: def.pair, coxa, femur, tibia, tarsus, hand,
        len: { coxa: def.coxa, femur: def.femur, tibia: def.tibia, tarsus: def.tarsus }, coxaQ: coxa.quaternion.clone() };
      legs.push(leg); hands[name] = hand;
    }
    for (const g of [geos.coxa, geos.femur, geos.tibia, geos.tarsus]) g.dispose();
    if (geos.hairs) { geos.hairs.femur.dispose(); geos.hairs.tibia.dispose(); }
  }

  // Card fan anchor (root child, follows the right front hand).
  const fan = J('fan', root);

  // Put the lowest point of the abdomen on the seat (root y = 0). A full
  // breath swells the abdomen down by `sink`; applyPose lifts the body by
  // the same amount, so the abdomen stays on the seat while it breathes.
  const lowest = b => {
    abdomen.rotation.set(ABD_TILT, 0, 0); abdomen.scale.set(...breathScale(b));
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(abdomen.children[0]).min.y;
  };
  const seatY = -lowest(0), sink = lowest(0) - lowest(1);
  body.position.y = seatY;

  const rig = {
    root, joints, legs, hands, fan, lod, colour: flyColour, seed,
    carry: hands.L1,                 // the hand that carries a card to the table
    phase: rnd() * TAU,              // idle phase offset
    life: 1,                         // 0..1, set by setLife
    rest: makeRest(tableY, tableZ), seatY, sink,
    _P: makePose(), _Pb: makePose(), _scale: 1,
    setLife(v) { rig.life = clamp(Number.isFinite(v) ? v : 1, 0, 1); },
    setRest({ tableY: ty = rig.rest.tableY, tableZ: tz = rig.rest.tableZ } = {}) { rig.rest = makeRest(ty, tz); },
  };
  rig.poses = { hold: () => animate(rig, 'idle', 0) };
  if (opts.hat === 'fedora') addFedora(rig);
  animate(rig, 'idle', 0);

  const dispose = () => {
    root.removeFromParent();
    for (const g of owned.geos) g.dispose();
    for (const m of owned.mats) m.dispose();
    for (const t of owned.texs) t.dispose();
    micro.dispose?.();
    rig.hat?.dispose();
  };
  return { root, rig, dispose };
}

// Rest targets (root-local). hold = card grip of the front legs; table =
// middle tarsi flat on the table; seat = hind tarsi on the stool.
// The claws stand a little past the tarsus tip; rest goals lift by CLAW so
// the claws touch the surface and do not cut into it.
const CLAW = 0.012;
function makeRest(tableY, tableZ) {
  return {
    tableY, tableZ,
    headC: new V3(0, 0.97, 0.06),
    legs: {
      L1: { goal: new V3(0.095, 0.63, 0.37), tdir: new V3(-0.55, 0.62, 0.25), pole: new V3(1, -0.4, -0.2) },
      R1: { goal: new V3(-0.055, 0.61, 0.375), tdir: new V3(0.5, 0.7, 0.2), pole: new V3(-1, -0.4, -0.2) },
      L2: { goal: new V3(0.36, tableY + CLAW, tableZ + 0.2), tdir: new V3(0.3, -0.2, 1), pole: new V3(0.8, 1, -0.3) },
      R2: { goal: new V3(-0.36, tableY + CLAW, tableZ + 0.2), tdir: new V3(-0.3, -0.2, 1), pole: new V3(-0.8, 1, -0.3) },
      L3: { goal: new V3(0.33, CLAW, 0.1), tdir: new V3(0.55, -0.3, 0.55), pole: new V3(0.8, 1, -0.6) },
      R3: { goal: new V3(-0.33, CLAW, 0.1), tdir: new V3(-0.55, -0.3, 0.55), pole: new V3(-0.8, 1, -0.6) },
    },
  };
}

// --- pose --------------------------------------------------------------------

function makePose() {
  const legs = {};
  for (const n of LEG_NAMES) legs[n] = { goal: new V3(), tdir: new V3(), pole: new V3(), alt: new V3(), altW: 0 };
  return {
    bodyPitch: 0, bodyYaw: 0, bodyRoll: 0, lift: 0,
    thoraxPitch: 0, thoraxYaw: 0, thoraxRoll: 0, abdPitch: 0, breathe: 0,
    headPitch: 0, headYaw: 0, headRoll: 0,
    antLPitch: 0, antLSpread: 0, antRPitch: 0, antRSpread: 0, proboscis: 0,
    wingLSweep: 0, wingLStroke: 0, wingLPitch: 0, wingRSweep: 0, wingRStroke: 0, wingRPitch: 0,
    wingDroop: 0, haltere: 0, fanTilt: 0, legs,
  };
}
const NUM_KEYS = Object.keys(makePose()).filter(k => k !== 'legs');

// The base pose: hold the cards, sit, breathe. Life adds wing droop, a
// lower head and (at 25 % life or less) a small tremor. opts.shake ===
// false in animate() stops the tremor (reduced motion).
function resetPose(rig, P, time) {
  const life = rig.life, low = 1 - life, ph = rig.phase;
  for (const k of NUM_KEYS) P[k] = 0;
  P.thoraxPitch = 0.08 + 0.06 * low;
  P.breathe = 0.5 + 0.5 * Math.sin((time * TAU) / 3.4 + ph);
  P.headPitch = 0.06 + 0.12 * low;
  P.antLPitch = P.antRPitch = 0.1 * low;
  // Healthy wings lie in a neat V over the abdomen. Low life lets them
  // hang apart and away from the back.
  P.wingLSweep = P.wingRSweep = lerp(-1.2, -1.02, low);
  P.wingLStroke = P.wingRStroke = 0.45 * low;
  P.wingLPitch = P.wingRPitch = 0.45 * low;
  P.fanTilt = 0.47;
  if (life <= 0.25 + 1e-9 && rig._shake !== false) {
    const a = 0.012 + 0.03 * (0.25 - life) * 4;
    P.bodyRoll += a * Math.sin(time * 29 + ph) * 0.6;
    P.headRoll += a * Math.sin(time * 41 + 1.3);
    P.antLSpread += a * 2 * Math.sin(time * 37); P.antRSpread -= a * 2 * Math.sin(time * 33 + 0.5);
  }
  for (const n of LEG_NAMES) {
    const r = rig.rest.legs[n], l = P.legs[n];
    l.goal.copy(r.goal); l.tdir.copy(r.tdir); l.pole.copy(r.pole); l.alt.set(0, 0, 0); l.altW = 0;
  }
  return P;
}

function lerpPose(A, B, w) {
  for (const k of NUM_KEYS) A[k] = lerp(A[k], B[k], w);
  for (const n of LEG_NAMES) {
    const a = A.legs[n], b = B.legs[n];
    a.goal.lerp(b.goal, w); a.tdir.lerp(b.tdir, w); a.pole.lerp(b.pole, w); a.alt.lerp(b.alt, w); a.altW = lerp(a.altW, b.altW, w);
  }
  return A;
}

const breathScale = b => [1 + 0.035 * b, 1 + 0.015 * b, 1 + 0.05 * b];
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0), AZ = new V3(0, 0, 1);
function wingQuat(q, side, sweep, stroke, pitch, droop) {
  // tilt the folded wing back over the abdomen, then stroke (about body Y),
  // sweep (about the wing normal) and pitch (about the span).
  q.setFromAxisAngle(AX, 0.32 - droop);
  q.multiply(_q2.setFromAxisAngle(AY, stroke * side));
  q.multiply(_q2.setFromAxisAngle(AZ, sweep * side));
  q.multiply(_q2.setFromAxisAngle(AX, pitch));
  return q;
}

const _v = new V3(), _w = new V3(), _hp = new V3();
function applyPose(rig, P) {
  const j = rig.joints;
  j.body.rotation.set(P.bodyPitch, P.bodyYaw, P.bodyRoll, 'YXZ');
  j.body.position.x = 0; j.body.position.z = 0;
  j.abdomen.rotation.set(ABD_TILT + P.abdPitch, 0, 0);
  const b = P.breathe;
  j.abdomen.scale.set(...breathScale(b));
  j.body.position.y = rig.seatY + rig.sink * b;
  j.thorax.rotation.set(P.thoraxPitch, P.thoraxYaw, P.thoraxRoll, 'YXZ');
  j.thorax.position.y = PETIOLE_Y + P.lift;
  j.head.rotation.set(P.headPitch, P.headYaw, P.headRoll, 'YXZ');
  j['antenna.L'].rotation.set(-0.35 + P.antLPitch, 0.25 + P.antLSpread, 0, 'YXZ');
  j['antenna.R'].rotation.set(-0.35 + P.antRPitch, -0.25 - P.antRSpread, 0, 'YXZ');
  const pr = clamp(P.proboscis, 0, 1);
  j.proboscis.rotation.x = lerp(-1.25, -0.15, pr);
  j.proboscis.scale.setScalar(lerp(0.55, 1, pr));
  wingQuat(j['wing.L'].quaternion, 1, P.wingLSweep, P.wingLStroke, P.wingLPitch, P.wingDroop);
  wingQuat(j['wing.R'].quaternion, -1, P.wingRSweep, P.wingRStroke, P.wingRPitch, P.wingDroop);
  j['haltere.L'].rotation.x = j['haltere.R'].rotation.x = 0.4 + P.haltere;

  const root = rig.root;
  root.updateMatrixWorld(true);
  rig._scale = _v.setFromMatrixScale(root.matrixWorld).x || 1;

  // Resolve head-frame goals (groom) into root-local space after FK.
  for (const leg of rig.legs) {
    const l = P.legs[leg.name];
    if (l.altW > 0) {
      _w.copy(l.alt).applyMatrix4(j.head.matrixWorld);
      root.worldToLocal(_w);
      l.goal.lerp(_w, l.altW);
    }
    solveLeg(rig, leg, l.goal, l.tdir, l.pole);
  }
  root.updateMatrixWorld(true);

  // Fan anchor: near the right front hand, tilted so the card faces look
  // up at the fly. It turns with the thorax.
  const fan = rig.fan;
  rig.hands.R1.getWorldPosition(_hp); root.worldToLocal(_hp);
  fan.position.copy(_hp).add(_v.set(0.075, 0.03, 0.01));
  _e.set(P.thoraxPitch * 0.5 + P.bodyPitch, P.thoraxYaw + P.bodyYaw, 0, 'YXZ');
  fan.quaternion.setFromEuler(_e).multiply(_q.setFromAxisAngle(AX, P.fanTilt));
  fan.updateMatrixWorld(true);
}

// --- ik ----------------------------------------------------------------------

const _g = new V3(), _td = new V3(), _pole = new V3(), _S = new V3(), _A = new V3(), _K = new V3(),
  _dir = new V3(), _bend = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4(),
  _qp = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qs = new THREE.Quaternion();

// World quaternion whose +Y is yDir and whose +Z leans to zHint.
function basisQuat(q, yDir, zHint) {
  _y.copy(yDir).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-10) _z.set(_y.y, _y.z, _y.x).cross(_y);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return q.setFromRotationMatrix(_m);
}

// Two-bone IK. Femur and tibia put the ankle at goal - tarsus * tdir, the
// knee bends toward the pole, and the tarsus points along tdir, so the
// tarsus tip (hand) lands on the goal when the goal is in reach. Returns
// the miss distance in root units.
function solveLeg(rig, leg, goalLocal, tdirLocal, poleLocal) {
  const root = rig.root, s = rig._scale;
  _g.copy(goalLocal).applyMatrix4(root.matrixWorld);
  _td.copy(tdirLocal).transformDirection(root.matrixWorld);
  _pole.copy(poleLocal).transformDirection(root.matrixWorld);
  const a = leg.len.femur * s, b = leg.len.tibia * s, c = leg.len.tarsus * s;
  leg.femur.getWorldPosition(_S);
  _A.copy(_g).addScaledVector(_td, -c);
  _dir.subVectors(_A, _S);
  let d = _dir.length();
  if (d < 1e-9) { _dir.copy(_pole); d = 1e-9; }
  _dir.normalize();
  const dc = clamp(d, Math.abs(a - b) + 1e-6 * s, a + b - 1e-6 * s);
  const cosA = clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _bend.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir));
  if (_bend.lengthSq() < 1e-10) _bend.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
  _bend.normalize();
  _K.copy(_S).addScaledVector(_dir, a * cosA).addScaledVector(_bend, a * sinA);
  const ankle = _A.copy(_S).addScaledVector(_dir, dc);
  basisQuat(_qf, _v.subVectors(_K, _S), _bend);
  basisQuat(_qt, _v.subVectors(ankle, _K), _bend);
  basisQuat(_qs, _td, _bend);
  leg.coxa.getWorldQuaternion(_qp);
  leg.femur.quaternion.copy(_qp.invert()).multiply(_qf);
  leg.tibia.quaternion.copy(_qf).invert().multiply(_qt);
  leg.tarsus.quaternion.copy(_qt).invert().multiply(_qs);
  return Math.max(0, d - dc) / s;
}

// --- clips -------------------------------------------------------------------

// Envelope: 0 before t0, rises to 1 at t1, holds, falls to 0 from t2 to t3.
const env = (t, t0, t1, t2, t3) => smooth(t0, t1, t) * (1 - smooth(t2, t3, t));
const _tgt = new V3(), _to = new V3(), _tmp = new V3();

function toLocal(rig, p, space, out) {
  if (p == null) return null;
  if (Array.isArray(p)) out.set(p[0], p[1], p[2]); else out.set(p.x, p.y, p.z);
  if (space !== 'local') { rig.root.updateWorldMatrix(true, false); rig.root.worldToLocal(out); }
  return out;
}

// Turn the head toward a root-local point by weight w.
function look(rig, P, p, w) {
  const h = rig.rest.headC;
  const dx = p.x - h.x, dy = p.y - h.y, dz = p.z - h.z;
  P.headYaw += w * clamp(Math.atan2(dx, Math.max(0.05, dz)), -0.7, 0.7);
  P.headPitch += w * clamp(Math.atan2(-dy, Math.hypot(dx, dz)) - 0.06, -0.5, 0.75);
}

// Lean the body toward a far target so the front leg can reach it.
function leanFor(rig, P, leg, p, w) {
  const d = Math.hypot(p.x - leg.side * 0.1, p.y - 0.78, p.z - 0.2);
  const lean = clamp((d - 0.42) / 0.3, 0, 1) * 0.42;
  P.thoraxPitch += w * lean;
  P.thoraxYaw += w * clamp(Math.atan2(p.x, Math.max(0.1, p.z)) * 0.35, -0.3, 0.3);
}

// Move one leg from its rest goal along an arc to p, by weight e (0..1).
function arcTo(P, name, p, e, arc, tdirTo) {
  const l = P.legs[name];
  l.goal.lerp(p, e).y += arc * Math.sin(Math.PI * e);
  if (tdirTo) l.tdir.lerp(tdirTo, e).normalize();
}

const DOWN_FWD = new V3(0, -0.55, 0.84).normalize();
const pickLeg = (spec, p, pair) => {
  if (spec.leg && spec.leg !== 'auto') return spec.leg;
  if (pair === 2) return p.x >= 0 ? 'L2' : 'R2';
  return p.x < -0.18 ? 'R1' : 'L1';
};

const CLIP_FNS = {
  idle(rig, P, t) {
    const ph = rig.phase;
    P.headYaw += 0.13 * Math.sin(t * 0.7 + ph) * Math.sin(t * 0.23 + 1);
    P.headPitch += 0.04 * Math.sin(t * 1.1 + ph);
    P.antLPitch += 0.06 * Math.sin(t * 2.3 + ph); P.antRPitch += 0.06 * Math.sin(t * 2.1 + ph + 1);
    P.legs.L1.goal.y += 0.012 * Math.sin(t * 1.4 + ph); P.legs.R1.goal.y += 0.012 * Math.sin(t * 1.4 + ph);
    // a small wing flick now and then
    const f = Math.max(0, Math.sin(t * 1.05 + ph)) ** 24;
    P.wingLSweep += 0.25 * f; P.wingRSweep += 0.25 * f;
  },
  think(rig, P, t) {
    const e = smooth(0, 0.35, t);
    P.headPitch += 0.3 * e; P.headRoll += 0.16 * e * Math.sin(0.6 + t * 0.8); P.headYaw += -0.08 * e;
    const burst = smooth(0.1, 0.4, Math.sin(t * TAU * 0.8)) * e;
    P.antLSpread += 0.14 * burst * Math.sin(t * TAU * 7.5);
    P.antRSpread += 0.14 * burst * Math.sin(t * TAU * 6.5 + 1);
    P.antLPitch -= 0.15 * e; P.antRPitch -= 0.15 * e;
    P.proboscis += 0.5 * e * Math.max(0, Math.sin(t * TAU * 0.5)) ** 3;
    for (const n of ['L1', 'R1']) { P.legs[n].goal.y += 0.06 * e; P.legs[n].goal.z -= 0.04 * e; }
    P.thoraxPitch += 0.05 * e;
  },
  groom(rig, P, t, spec, dur) {
    // The free front leg rubs the left eye and antenna; the head leans in.
    const e = env(t, 0, 0.45, dur - 0.5, dur);
    const l = P.legs.L1, w = (t - 0.45) * TAU * 2.1;
    l.alt.set(0.12 + 0.03 * Math.cos(w), 0.11 + 0.035 * Math.sin(w), 0.13);
    l.altW = e;
    l.tdir.lerp(_tmp.set(-0.5, 0.3, -0.8), e).normalize();
    l.pole.lerp(_tmp.set(1, -1, 0.3), e);
    P.headRoll += 0.25 * e; P.headYaw += 0.18 * e; P.headPitch += 0.1 * e;
    P.antLPitch += 0.35 * e * (0.5 + 0.5 * Math.sin(w));
    P.thoraxYaw += 0.08 * e;
  },
  reach(rig, P, t, spec, dur, c) {
    const p = toLocal(rig, spec.target ?? rig.fan.position, spec.target ? spec.space : 'local', _tgt) ?? rig.fan.position;
    const leg = pickLeg(spec, p, 1), lg = rig.legs.find(x => x.name === leg);
    const e = env(t, 0, c, c + 0.08, dur);
    leanFor(rig, P, lg, p, e);
    arcTo(P, leg, p, e, 0.05, DOWN_FWD);
    look(rig, P, p, 0.7 * e);
  },
  place(rig, P, t, spec, dur, c) {
    const p = toLocal(rig, spec.target, spec.space, _tgt);
    if (!p) return;
    const leg = pickLeg(spec, p, 1), lg = rig.legs.find(x => x.name === leg);
    const e = env(t, 0, c, c + 0.12, dur);
    leanFor(rig, P, lg, p, e);
    arcTo(P, leg, p, e, 0.14, DOWN_FWD);
    look(rig, P, p, 0.8 * e);
    P.antLPitch -= 0.2 * e; P.antRPitch -= 0.2 * e;
  },
  tap(rig, P, t, spec, dur, c) {
    const p = toLocal(rig, spec.target, spec.space, _tgt);
    if (!p) return;
    const leg = pickLeg(spec, p, 2);
    const e = env(t, 0, c, c + 0.06, dur);
    arcTo(P, leg, p, e, 0.12, _to.set(Math.sign(p.x || 1) * 0.15, -0.5, 0.85).normalize());
    look(rig, P, p, 0.45 * e);
    P.thoraxRoll += -0.05 * Math.sign(p.x || 1) * e;
  },
  push(rig, P, t, spec, dur, c) {
    const p = toLocal(rig, spec.target, spec.space, _tgt);
    if (!p) return;
    const to = spec.to ? toLocal(rig, spec.to, spec.space, _to) : _to.copy(p).add(_tmp.set(0, 0, 0.28));
    const r = CLIPS.push.release;
    const leg = pickLeg(spec, p, 1), lg = rig.legs.find(x => x.name === leg);
    const e = env(t, 0, c, r, dur);
    const k = smooth(c, r, t);
    const q = _tmp.copy(p).lerp(to, k);
    leanFor(rig, P, lg, q, e);
    P.thoraxPitch += 0.08 * k * e;
    arcTo(P, leg, q, e, 0.06 * (1 - k), DOWN_FWD);
    look(rig, P, q, 0.6 * e);
  },
  raiseArms(rig, P, t) {
    const e = smooth(0, 0.5, t), b = smooth(0.25, 0.6, t);
    for (const [n, s] of [['L1', 1], ['R1', -1]]) {
      const l = P.legs[n];
      l.goal.lerp(_tmp.set(0.3 * s, 1.18 + 0.03 * Math.sin(t * 9), 0.24), e);
      l.tdir.lerp(_to.set(0.3 * s, 1, 0.1), e).normalize();
      l.pole.lerp(_to.set(s, -0.6, -0.4), e);
    }
    P.headPitch -= 0.3 * e; P.lift += 0.02 * e * (0.5 + 0.5 * Math.sin(t * 7));
    P.thoraxPitch -= 0.1 * e;
    const buzz = Math.sin(t * TAU * 10);
    P.wingLSweep = P.wingRSweep = lerp(P.wingLSweep, -0.3, b);
    P.wingLStroke = P.wingRStroke = lerp(P.wingLStroke, 0.85 * buzz, b);
    P.wingLPitch = P.wingRPitch = lerp(P.wingLPitch, 0.5 * Math.cos(t * TAU * 10), b);
    P.haltere += 0.6 * b * Math.sin(t * TAU * 10 + Math.PI);
    P.antLPitch -= 0.3 * e; P.antRPitch -= 0.3 * e; P.antLSpread += 0.15 * e; P.antRSpread += 0.15 * e;
  },
  slump(rig, P, t) {
    const e = smooth(0, 1.4, t);
    P.thoraxPitch += 0.42 * e; P.headPitch += 0.5 * e; P.headRoll += 0.12 * e;
    P.antLPitch += 0.55 * e; P.antRPitch += 0.55 * e; P.proboscis += 0.6 * e;
    P.wingLSweep = P.wingRSweep = lerp(P.wingLSweep, -1.0, e);
    P.wingLStroke = P.wingRStroke = lerp(P.wingLStroke, 0.3, e);
    P.wingDroop += 0.55 * e; // the thorax leans forward; the wings still hang down
    P.wingLPitch = P.wingRPitch = lerp(P.wingLPitch, 0.6, e);
    P.breathe = 0.5 + 0.5 * Math.sin(t * 1.3);
    const ty = rig.rest.tableY, tz = rig.rest.tableZ;
    for (const [n, s] of [['L1', 1], ['R1', -1]]) {
      const l = P.legs[n];
      l.goal.lerp(_tmp.set(0.16 * s, ty, tz + 0.12), e);
      l.tdir.lerp(_to.set(-0.2 * s, -0.25, 1), e).normalize();
      l.pole.lerp(_to.set(s, 0.4, -0.5), e);
    }
  },
};

// --- animate -----------------------------------------------------------------

function poseFor(rig, P, clip, t, time, opts = {}) {
  const spec = typeof clip === 'string' ? { name: clip } : { ...(clip || { name: 'idle' }) };
  if (spec.target == null && opts.target != null) spec.target = opts.target;
  if (spec.to == null && opts.to != null) spec.to = opts.to;
  const def = CLIPS[spec.name] || CLIPS.idle, fn = CLIP_FNS[spec.name] || CLIP_FNS.idle;
  const dur = def.duration;
  let tt = Number.isFinite(t) ? Math.max(0, t) : 0;
  // opts.dur stretches a one-shot clip to the time the scene gives it.
  if (Number.isFinite(opts.dur) && opts.dur > 0 && !def.loop && !def.hold) tt *= dur / opts.dur;
  if (def.loop) tt %= dur; else if (!def.hold) tt = Math.min(tt, dur);
  resetPose(rig, P, time);
  fn(rig, P, tt, spec, dur, def.contact ?? dur);
  return { spec, def, tt };
}

/**
 * Pose the rig for clip at clip time t (seconds).
 * @param {object} rig  from buildFly
 * @param {string|{name:string, target?, to?, leg?, space?: 'world'|'local'}} clip
 * @param {number} t
 * @param {{ time?: number, prev?: { clip, t: number }, mix?: number,
 *           target?, to?, dur?: number, droop?: number, life?: number,
 *           shake?: boolean }} [opts]
 *   target / to: used when clip is a bare name. dur: stretch a one-shot
 *   clip to this many seconds. droop (0..1) or life (0..20): set the life.
 *   shake: false stops the low-life tremor (the scene sends false with
 *   reduced motion). Omitted, the tremor follows the life.
 * @returns {{ name: string, contact: boolean, done: boolean }}
 */
export function animate(rig, clip, t, opts = {}) {
  const time = Number.isFinite(opts.time) ? opts.time : (Number.isFinite(t) ? t : 0);
  // opts.droop (0 full life .. 1 no life) or opts.life (0..20) set the life.
  if (Number.isFinite(opts.droop)) rig.setLife(1 - opts.droop);
  else if (Number.isFinite(opts.life)) rig.setLife(opts.life / 20);
  rig._shake = opts.shake !== false;
  const { spec, def, tt } = poseFor(rig, rig._P, clip, t, time, opts);
  if (opts.prev && Number.isFinite(opts.mix) && opts.mix < 1) {
    poseFor(rig, rig._Pb, opts.prev.clip, opts.prev.t, time, opts.prev);
    lerpPose(rig._Pb, rig._P, clamp(opts.mix, 0, 1));
    applyPose(rig, rig._Pb);
  } else applyPose(rig, rig._P);
  return {
    name: spec.name,
    contact: def.contact != null && tt >= def.contact && tt < def.duration,
    done: !def.loop && tt >= def.duration,
  };
}

/** Triangles drawn by an object tree (instanced meshes count every copy). */
export function countTriangles(obj) {
  let n = 0;
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry, tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
    n += tri * (o.isInstancedMesh ? o.count : 1);
  });
  return n;
}

// --- hat ---------------------------------------------------------------------

// A fedora for a fly (the opponent in play mode wears it). Head-local
// units: the head capsule centre is HEAD_C, its top about y = 0.225. The
// crown is a lathe with a centre crease and a front pinch; the brim is a
// lathe ring that turns up at the back and the sides and dips at the
// front. A dark band runs round the crown base. addFedora(rig) puts it on
// the head joint and returns { group, source, ready, dispose }; setHat(rig,
// on) shows or hides it. The procedural parts show at once. When
// models/fedora.glb loads (hat.js), addFedora swaps them for the model
// meshes: source changes from 'procedural' to 'model', and ready resolves.
// opts.model = false keeps the procedural fedora.
export const FEDORA = { y: 0.205, crownR: 0.135, crownH: 0.135, brimR: 0.255, tilt: -0.12, felt: '#3a3128', band: '#141210' };

function fedoraGeos(L) {
  const F = FEDORA, seg = Math.max(24, L.sph?.[0] ?? 32);
  // crown profile (r, y), base to top
  const prof = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = F.crownR * (1 - 0.16 * t * t) ;
    prof.push(new THREE.Vector2(r, F.crownH * t));
  }
  prof.push(new THREE.Vector2(0.001, F.crownH));
  const crown = new THREE.LatheGeometry(prof, seg);
  const p = crown.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = y / F.crownH;
    // centre crease: the top dips along the front-back line
    const crease = 0.045 * Math.exp(-((x / (F.crownR * 0.45)) ** 2)) * smooth(0.55, 1.0, h);
    // front pinch: the two sides at the front pull in near the top
    const front = Math.max(0, z / F.crownR);
    const pinch = 1 - 0.22 * front * smooth(0.35, 1.0, h) * Math.min(1, Math.abs(x) / (F.crownR * 0.3));
    p.setXYZ(i, x * pinch, y - crease, z * (1 - 0.06 * h));
  }
  crown.computeVertexNormals();
  crown.translate(0, F.y, 0);
  // brim: a ring from the crown to brimR, up at the back and sides
  const brimProf = [];
  const m = 8;
  for (let i = 0; i <= m; i++) brimProf.push(new THREE.Vector2(F.crownR * 0.98 + (F.brimR - F.crownR * 0.98) * (i / m), 0));
  for (let i = m; i >= 0; i--) brimProf.push(new THREE.Vector2(F.crownR * 0.98 + (F.brimR - F.crownR * 0.98) * (i / m), -0.008));
  const brim = new THREE.LatheGeometry(brimProf, seg);
  const b = brim.attributes.position;
  for (let i = 0; i < b.count; i++) {
    const x = b.getX(i), y = b.getY(i), z = b.getZ(i);
    const r = Math.hypot(x, z), a = Math.atan2(x, z);           // a = 0 at the front (+z)
    const out = Math.max(0, (r - F.crownR) / (F.brimR - F.crownR));
    const up = 0.05 * out * out * (0.6 - 0.6 * Math.cos(a));     // turned up behind and at the sides
    const dip = -0.022 * out * Math.max(0, Math.cos(a)) ** 2;    // snap brim down at the front
    b.setXYZ(i, x, y + up + dip, z);
  }
  brim.computeVertexNormals();
  brim.translate(0, F.y, 0);
  const band = new THREE.CylinderGeometry(F.crownR * 1.012, F.crownR * 1.02, 0.03, seg, 1, true).translate(0, F.y + 0.017, 0);
  return { crown, brim, band };
}

export function addFedora(rig, opts = {}) {
  const head = rig?.joints?.head;
  if (!head) return null;
  if (rig.hat) return rig.hat;
  const L = LODS[rig.lod] || LODS.desktop;
  const g = fedoraGeos(L);
  const felt = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.felt || FEDORA.felt), roughness: 0.88, side: THREE.DoubleSide });
  const bandM = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.band || FEDORA.band), roughness: 0.6, side: THREE.DoubleSide });
  const group = new THREE.Group(); group.name = 'fedora';
  for (const [geo, mat, nm] of [[g.crown, felt, 'fedora-crown'], [g.brim, felt, 'fedora-brim'], [g.band, bandM, 'fedora-band']]) {
    const m = new THREE.Mesh(geo, mat); m.name = nm; m.castShadow = true; m.receiveShadow = true; group.add(m);
  }
  group.rotation.x = FEDORA.tilt;          // tipped a little forward and down
  group.rotation.z = 0.06;                 // and a touch to one side
  head.add(group);
  let own = [...Object.values(g), felt, bandM];   // freed by dispose
  const hat = { group, source: 'procedural', ready: null, dispose: null };
  // Swap the procedural parts for the meshes of models/fedora.glb (hat.js).
  // The model geometry and materials are shared through the cache; only
  // recoloured material clones belong to this hat.
  const swap = (model) => {
    if (!model || rig.hat !== hat || hat.source === 'model') return hat;
    for (const c of [...group.children]) group.remove(c);
    for (const x of own) x.dispose();
    own = [];
    const inner = new THREE.Group(); inner.name = 'fedora-model'; inner.position.y = FEDORA.y - 0.015;   // a little lower than the procedural brim, so the head fills the crown
    for (const m of fedoraMeshes(model)) {
      const tint = m.name === 'fedora-band' ? opts.band : opts.felt;
      if (tint) { m.material = m.material.clone(); m.material.color.set(tint); own.push(m.material); }
      inner.add(m);
    }
    group.add(inner);
    hat.source = 'model';
    return hat;
  };
  hat.dispose = () => { group.removeFromParent(); for (const x of own) x.dispose(); own = []; if (rig.hat === hat) rig.hat = null; };
  rig.hat = hat;
  if (fedoraModel()) swap(fedoraModel());
  else if (opts.model !== false) hat.ready = loadFedora().then(swap);
  return hat;
}

export function setHat(rig, on) {
  if (on) { const h = addFedora(rig); if (h) h.group.visible = true; return !!h; }
  if (rig?.hat) rig.hat.group.visible = false;
  return false;
}
