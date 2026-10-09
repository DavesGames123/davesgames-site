// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · view3d/models.js — procedural guitar, violin and bow
// ────────────────────────────────────────────────────────────────────────────
//  buildModel(inst) makes one generic instrument from code: no image or
//  mesh file, no brand name, logo or branded headstock shape. The guitar
//  builder makes the steel-string (dreadnought style) and the classical
//  guitar from one parameter table. The violin builder makes the arched
//  plates, f-holes, scroll, pegs, bridge, tailpiece, chinrest and a bow.
//
//  Frame: metres. The bridge (saddle top or violin bridge top) is at x = 0,
//  the nut at x = +L. The top faces +z. y is across the strings and string
//  0 (lowest pitch) has the largest y.
//
//  The returned model has the string anchors that strings3d.js reads:
//    model.strings[i] = { bridge, nut, radius, kind, after: [V3], head: [V3] }
//    model.stopPoint(i, fret)  where a finger stops string i (V3)
//    model.fretX(n)            x of fret n (violin: semitone stop n)
//    model.focus               camera targets: centre, soundhole, fretboard
//    model.bow                 violin only: { group, place(i, s, b, P, dir, up) }
//
//  SECTION MAP   (grep -n "<anchor>" models.js)
//    materials ............ "function materials"
//    mesh helpers ......... "function loft", "function taperedBox", "function outline"
//    guitar table ......... "const GUITARS"
//    guitar builder ....... "function buildGuitar"
//    guitar headstock ..... "function guitarHead"
//    violin builder ....... "function buildViolin"
//    violin arch .......... "function makeArch"
//    f-holes .............. "function fHole"
//    scroll ............... "function scroll"
//    violin bridge ........ "function violinBridge"
//    bow .................. "function buildBow"
//    public entry ......... "export function buildModel"
// ════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { texture } from './textures.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- materials
function materials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  return {
    spruce: phys({ map: texture('spruce'), roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.65 }),
    violinTop: phys({ map: texture('violinTop'), roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.16, envMapIntensity: 0.75 }),
    rosewood: phys({ map: texture('rosewood'), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.7 }),
    mahogany: phys({ map: texture('mahogany'), roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    ebony: std({ map: texture('ebony'), roughness: 0.35 }),
    maple: std({ map: texture('maple'), roughness: 0.6 }),
    flame: phys({ map: texture('flame'), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }),
    rosette: std({ map: texture('rosette'), roughness: 0.4 }),
    tortoise: phys({ map: texture('tortoise'), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
    pearl: phys({ map: texture('pearl'), roughness: 0.2, clearcoat: 1, sheen: 0.6, sheenColor: new THREE.Color(0xd8f0ff) }),
    hole: std({ map: texture('hole'), roughness: 1 }),
    holeWall: std({ color: 0x1a0f08, roughness: 1, side: THREE.BackSide }),
    binding: std({ color: 0xeee4cf, roughness: 0.35 }),
    bone: std({ color: 0xf2ecdc, roughness: 0.4 }),
    black: std({ color: 0x040302, roughness: 0.9 }),
    fretWire: std({ color: 0xdedbd2, metalness: 1, roughness: 0.22 }),
    chrome: std({ color: 0xe8e9ec, metalness: 1, roughness: 0.15 }),
    gold: std({ color: 0xd9b26a, metalness: 1, roughness: 0.3 }),
    cream: std({ color: 0xf1e8d2, roughness: 0.3 }),
    hair: std({ color: 0xf3ecdb, roughness: 0.85, side: THREE.DoubleSide }),
    stick: phys({ map: texture('mahogany'), color: 0xb06a48, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }),
    gut: std({ color: 0x2a2622, roughness: 0.7 }),
  };
}

// ---------------------------------------------------------- mesh helpers
/**
 * Loft through rings of points (each an array of V3, same length).
 * closed: the ring wraps around. caps: fan caps at the first/last ring.
 * The winding is flipped when needed so normals point away from the ring
 * centroids (rings must be about convex).
 */
function loft(rings, { closed = true, capStart = false, capEnd = false, uScale = 1, vScale = 1 } = {}) {
  const R = rings.length, C = rings[0].length;
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let r = 0; r < R; r++) {
    if (r > 0) along += rings[r][0].distanceTo(rings[r - 1][0]);
    let around = 0;
    for (let c = 0; c < C + (closed ? 1 : 0); c++) {
      const p = rings[r][c % C];
      if (c > 0) around += p.distanceTo(rings[r][(c - 1) % C]);
      pos.push(p.x, p.y, p.z);
      uv.push(along * uScale, around * vScale);
    }
  }
  const W = C + (closed ? 1 : 0);
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const a = r * W + c, b = a + 1, d = a + W, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  // orientation test on the middle quad
  const rm = Math.floor((R - 1) / 2), cm = Math.floor((W - 1) / 2);
  const ctr = new THREE.Vector3();
  for (const p of rings[rm]) ctr.add(p);
  ctr.divideScalar(C);
  const P = (i) => V3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const a = rm * W + cm;
  const n = new THREE.Vector3().subVectors(P(a + W), P(a)).cross(new THREE.Vector3().subVectors(P(a + 1), P(a)));
  const flip = n.dot(new THREE.Vector3().subVectors(P(a), ctr)) < 0;
  if (flip) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const capRing = (ring, outward) => {
    const c0 = pos.length / 3;
    const m = new THREE.Vector3();
    for (const p of ring) m.add(p);
    m.divideScalar(ring.length);
    pos.push(m.x, m.y, m.z); uv.push(0, 0);
    for (const p of ring) { pos.push(p.x, p.y, p.z); uv.push(0, 0); }
    const tri = [];
    for (let k = 0; k < ring.length; k++) tri.push(c0, c0 + 1 + k, c0 + 1 + ((k + 1) % ring.length));
    const n0 = new THREE.Vector3().subVectors(ring[0], m).cross(new THREE.Vector3().subVectors(ring[1], m));
    if (n0.dot(outward) < 0) for (let i = 0; i < tri.length; i += 3) { const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; }
    idx.push(...tri);
  };
  const ringC = (ring) => ring.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(ring.length);
  if (capStart) capRing(rings[0], ringC(rings[0]).sub(ringC(rings[1])));
  if (capEnd) capRing(rings[R - 1], ringC(rings[R - 1]).sub(ringC(rings[R - 2])));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Box from x0 to x1, width w0..w1 (y), top at z = ztop(x), bottom at ztop(x) - th. */
function taperedBox(x0, x1, w0, w1, ztop, th, uvs = 8) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) + 0.5;
    const x = lerp(x0, x1, t);
    const w = lerp(w0, w1, t);
    p.setXYZ(i, x, p.getY(i) * w, ztop(x) + (p.getZ(i) - 0.5) * th);
  }
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.abs(x1 - x0) * uvs, uv.getY(i) * Math.max(w0, w1) * uvs);
  g.computeVertexNormals();
  return g;
}

/**
 * Closed outline from half widths [(s, w)] (s from the tail end), as
 * Vector2 in instrument x, y. Counter-clockwise. corners: indices into
 * half where the outline has a sharp point (violin corners); the curve is
 * smooth between corners.
 */
function outline(half, xTail, n = 220, corners = []) {
  const side = (sg) => half.map(([s, w]) => V3(xTail + s, sg * w, 0));
  const cut = [0, ...corners, half.length - 1];
  const segs = [];
  const right = side(-1), left = side(1).reverse();
  const total = (pts) => { let l = 0; for (let k = 1; k < pts.length; k++) l += pts[k].distanceTo(pts[k - 1]); return l; };
  const pieces = [];
  for (let c = 0; c < cut.length - 1; c++) pieces.push(right.slice(cut[c], cut[c + 1] + 1));
  const lc = cut.map((k) => half.length - 1 - k).reverse();
  for (let c = 0; c < lc.length - 1; c++) pieces.push(left.slice(lc[c], lc[c + 1] + 1));
  const len = pieces.reduce((a, p) => a + total(p), 0);
  const out = [];
  for (const p of pieces) {
    const m = Math.max(4, Math.round((n * total(p)) / len));
    const curve = p.length > 2 ? new THREE.CatmullRomCurve3(p, false, 'centripetal') : new THREE.LineCurve3(p[0], p[1]);
    const pts = curve.getSpacedPoints(m);
    for (let k = 0; k < pts.length - 1; k++) out.push(new THREE.Vector2(pts[k].x, pts[k].y));
  }
  segs.push(out);
  return out;
}

function offsetOutline(pts, d) {
  // inward offset by d (CCW outline: inward normal is the left normal)
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    out.push(new THREE.Vector2(pts[i].x - (ty / l) * d, pts[i].y + (tx / l) * d));
  }
  return out;
}

function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/** Wall between an outline at z = ztop(x) and z = zbot(x). */
function wall(pts, ztop, zbot, uvs = 6) {
  const top = pts.map((p) => V3(p.x, p.y, ztop(p.x, p.y)));
  const bot = pts.map((p) => V3(p.x, p.y, zbot(p.x, p.y)));
  const g = loft([top, bot], { closed: true, uScale: uvs * 4, vScale: uvs });
  // swap uv so the grain (texture u) runs around the outline
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  return g;
}

function flatShape(pts, holes = []) {
  const s = new THREE.Shape(pts);
  for (const h of holes) s.holes.push(new THREE.Path(h));
  return s;
}

function scaleUV(g, su, sv = su) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

function circle(cx, cy, r, n = 64, cw = false) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (cw ? -1 : 1) * (k / n) * Math.PI * 2;
    pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}

function cylinderBetween(a, b, r, mat, seg = 12) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  const m = mesh(g, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
  return m;
}

function stringRadius(gauge, fallback) {
  const m = /([.\d]+)/.exec(gauge || '');
  if (m && gauge.startsWith('.')) return (parseFloat(m[1]) * 0.0254) / 2;
  return fallback;
}
function stringKind(material) {
  const m = (material || '').toLowerCase();
  if (m.includes('bronze')) return 'bronze';
  if (m.includes('nylon') && !m.includes('wound') && !m.includes('floss')) return 'nylon';
  if (m.includes('plain steel')) return 'steel';
  return 'silver';
}

// ------------------------------------------------------------ guitar table
const GUITARS = {
  steel: {
    bodyLen: 0.508, joinFret: 14, depthTail: 0.121, depthNeck: 0.1,
    // half widths of a dreadnought-style body from the tail end (m)
    half: [[0, 0], [0.006, 0.07], [0.025, 0.14], [0.06, 0.183], [0.115, 0.199], [0.17, 0.192], [0.225, 0.166],
      [0.27, 0.142], [0.305, 0.136], [0.35, 0.141], [0.405, 0.147], [0.45, 0.141], [0.485, 0.112], [0.5, 0.068], [0.508, 0]],
    holeX: 0.155, holeR: 0.0505,
    fbNut: 0.0435, fbSlope: 0.031, fbTop: 0.0068, fbThick: 0.0065,
    nutSpan: 0.0365, saddleSpan: 0.054, saddleTop: 0.0125, nutAbove: 0.0015,
    neckDepth: [0.0205, 0.0235], headAngle: 14, headLen: 0.19,
    pickguard: true, inlays: [3, 5, 7, 9, 12, 15, 17, 19], bridge: 'pin', tuners: 'chrome',
    top: 'spruce', back: 'rosewood', neck: 'mahogany', board: 'rosewood',
  },
  classical: {
    bodyLen: 0.485, joinFret: 12, depthTail: 0.1, depthNeck: 0.093,
    half: [[0, 0], [0.006, 0.065], [0.025, 0.13], [0.06, 0.172], [0.11, 0.185], [0.16, 0.176], [0.21, 0.148],
      [0.25, 0.122], [0.28, 0.118], [0.32, 0.128], [0.37, 0.14], [0.415, 0.136], [0.45, 0.112], [0.474, 0.07], [0.485, 0]],
    holeX: 0.18, holeR: 0.043,
    fbNut: 0.052, fbSlope: 0.025, fbTop: 0.0068, fbThick: 0.0065,
    nutSpan: 0.042, saddleSpan: 0.058, saddleTop: 0.0138, nutAbove: 0.0017,
    neckDepth: [0.021, 0.0235], headAngle: 12, headLen: 0.185,
    pickguard: false, inlays: [], bridge: 'tie', tuners: 'gold',
    top: 'spruce', back: 'rosewood', neck: 'mahogany', board: 'ebony',
  },
};

// ---------------------------------------------------------- guitar builder
function buildGuitar(inst, M) {
  const P = GUITARS[inst.key];
  const L = inst.scaleM;
  const n = inst.strings.length;
  const root = new THREE.Group();
  root.name = 'guitar';
  const fretX = (k) => L * 2 ** (-k / 12);
  const xJoin = fretX(P.joinFret);
  const xTail = xJoin - P.bodyLen;
  const depth = (x) => lerp(P.depthTail, P.depthNeck, (x - xTail) / P.bodyLen);
  const out = outline(P.half, xTail);

  // top with the sound hole; rosette ring; dark hole
  const hole = circle(P.holeX, 0, P.holeR, 72, true);
  const top = new THREE.ShapeGeometry(flatShape(out, [hole]), 64);
  scaleUV(top, 1.6, 2.2);
  root.add(mesh(top, M[P.top]));
  const ros = new THREE.RingGeometry(P.holeR + 0.002, P.holeR + 0.017, 96, 1);
  ros.translate(P.holeX, 0, 0.0002);
  const rosM = mesh(ros, M.rosette, { cast: false });
  root.add(rosM);
  const holeFloor = new THREE.CircleGeometry(P.holeR * 1.6, 48);
  holeFloor.translate(P.holeX, 0, -depth(P.holeX) + 0.004);
  root.add(mesh(holeFloor, M.hole, { cast: false }));
  const wallG = new THREE.CylinderGeometry(P.holeR, P.holeR, 0.004, 72, 1, true);
  wallG.rotateX(Math.PI / 2);
  wallG.translate(P.holeX, 0, -0.002);
  root.add(mesh(wallG, M.holeWall, { cast: false }));

  // sides, back, binding
  root.add(mesh(wall(out, () => 0, (x) => -depth(x)), M[P.back]));
  const back = new THREE.ShapeGeometry(flatShape(out), 64);
  back.rotateX(Math.PI);
  const bp = back.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setZ(i, -depth(bp.getX(i)));
  back.computeVertexNormals();
  scaleUV(back, 1.6, 2.2);
  root.add(mesh(back, M[P.back]));
  const bindPts = (z) => out.map((p) => V3(p.x, p.y, typeof z === 'function' ? z(p.x) : z));
  for (const z of [-0.0012, (x) => -depth(x) + 0.0012]) {
    const c = new THREE.CatmullRomCurve3(bindPts(z), true);
    root.add(mesh(new THREE.TubeGeometry(c, 400, 0.0021, 8, true), M.binding));
  }

  // pickguard: hugs the rosette on the treble side (y < 0)
  if (P.pickguard) {
    const r0 = P.holeR + 0.019, pts = [];
    const a0 = -0.25, a1 = -1.95, K = 40;
    for (let k = 0; k <= K; k++) { const a = lerp(a0, a1, k / K); pts.push(new THREE.Vector2(P.holeX + r0 * Math.cos(a), r0 * Math.sin(a))); }
    for (let k = K; k >= 0; k--) {
      const t = k / K, a = lerp(a0, a1, t);
      const r = r0 + 0.05 * Math.sin(Math.PI * Math.pow(t, 0.65)) ** 0.8;
      pts.push(new THREE.Vector2(P.holeX + r * Math.cos(a - 0.12 * Math.sin(Math.PI * t)), r * Math.sin(a - 0.12 * Math.sin(Math.PI * t))));
    }
    const pg = new THREE.ShapeGeometry(new THREE.Shape(pts), 24);
    pg.translate(0, 0, 0.0004);
    scaleUV(pg, 3);
    root.add(mesh(pg, M.tortoise, { cast: false }));
  }

  // fretboard
  const fbW = (x) => P.fbNut + P.fbSlope * (L - x);
  const lastFret = inst.frets;
  const xEnd = fretX(lastFret) - 0.005;
  const board = taperedBox(xEnd, L, fbW(xEnd), fbW(L), () => P.fbTop, P.fbThick, 6);
  root.add(mesh(board, M[P.board]));
  // frets
  for (let k = 1; k <= lastFret; k++) {
    const x = fretX(k);
    const g = new THREE.CylinderGeometry(0.00115, 0.00115, fbW(x) - 0.0006, 10);
    g.translate(x, 0, P.fbTop);
    root.add(mesh(g, M.fretWire));
  }
  // inlays (pearl dots, two at 12)
  for (const k of P.inlays) {
    const x = (fretX(k - 1) + fretX(k)) / 2;
    const ys = k === 12 ? [-0.0115, 0.0115] : [0];
    for (const y of ys) {
      const g = new THREE.CircleGeometry(0.0029, 24);
      g.translate(x, y, P.fbTop + 0.00015);
      root.add(mesh(g, M.pearl, { cast: false }));
    }
  }
  // nut
  const nutTop = P.fbTop + P.nutAbove;
  root.add(mesh(taperedBox(L, L + 0.005, fbW(L), fbW(L), () => nutTop, nutTop - (P.fbTop - P.fbThick), 4), M.bone));

  // neck shaft (half ellipse under the board) with heel and volute
  const ha = (P.headAngle * Math.PI) / 180;
  const headFace = (x) => nutTop - 0.002 - Math.tan(ha) * (x - L);
  const zBot = P.fbTop - P.fbThick;
  const rings = [];
  const X0 = xJoin - 0.002, X1 = L + 0.045, NR = 40, NA = 18;
  for (let r = 0; r <= NR; r++) {
    const x = lerp(X0, X1, r / NR);
    const w = fbW(Math.min(x, L)) / 2 - 0.0002;
    let d = lerp(P.neckDepth[0], P.neckDepth[1], smooth(L, xJoin + 0.1, x));
    d += (depth(xJoin) - 0.008 - d) * smooth(xJoin + 0.075, xJoin + 0.004, x);
    let zt = zBot;
    if (x > L) { zt = Math.min(zBot, headFace(x) - 0.002); d = lerp(d, 0.011, smooth(L, L + 0.04, x)); }
    const ring = [];
    for (let a = 0; a <= NA; a++) {
      const th = (a / NA) * Math.PI;
      const heel = smooth(xJoin + 0.07, xJoin, x);
      const ww = w * (1 - 0.25 * heel * Math.sin(th) ** 4);
      ring.push(V3(x, ww * Math.cos(th), zt - d * Math.pow(Math.sin(th), 0.85)));
    }
    rings.push(ring);
  }
  root.add(mesh(loft(rings, { closed: false, capEnd: true, uScale: 6, vScale: 12 }), M[P.neck]));
  // neck top lid between the board end at the nut and the headstock (covers the open half ellipse)
  const lid = new THREE.PlaneGeometry(0.05, fbW(L) - 0.0004);
  lid.translate(L + 0.025, 0, 0);
  const lp = lid.attributes.position;
  for (let i = 0; i < lp.count; i++) lp.setZ(i, Math.min(zBot, headFace(lp.getX(i)) - 0.002) - 0.0002);
  lid.computeVertexNormals();
  root.add(mesh(lid, M[P.neck]));

  // bridge and saddle
  const yS = (i) => P.saddleSpan / 2 - (i * P.saddleSpan) / (n - 1);
  const yN = (i) => P.nutSpan / 2 - (i * P.nutSpan) / (n - 1);
  const bridgeH = P.bridge === 'pin' ? 0.0085 : 0.009;
  const bShape = P.bridge === 'pin'
    ? [[-0.0165, -0.062], [-0.012, -0.079], [0.008, -0.081], [0.0135, -0.064], [0.0135, 0.064], [0.008, 0.081], [-0.012, 0.079], [-0.0165, 0.062]]
    : [[-0.018, -0.091], [0.012, -0.091], [0.013, -0.04], [0.013, 0.04], [0.012, 0.091], [-0.018, 0.091]];
  const bg = new THREE.ExtrudeGeometry(new THREE.Shape(bShape.map(([x, y]) => new THREE.Vector2(x, y))),
    { depth: bridgeH - 0.0016, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0012, bevelSegments: 3, curveSegments: 16 });
  bg.translate(0, 0, 0.0008);
  scaleUV(bg, 8);
  root.add(mesh(bg, M[P.board]));
  if (P.bridge === 'tie') {
    root.add(mesh(taperedBox(-0.018, -0.006, 0.18, 0.18, () => bridgeH + 0.0024, 0.0024, 8), M[P.board]));
    // a cream stripe on the tie block
    root.add(mesh(taperedBox(-0.0145, -0.0115, 0.181, 0.181, () => bridgeH + 0.0025, 0.0024, 8), M.cream));
  }
  const saddleTop = P.saddleTop;
  root.add(mesh(taperedBox(-0.0015, 0.0015, P.saddleSpan + 0.016, P.saddleSpan + 0.016, () => saddleTop, saddleTop - bridgeH + 0.001), M.bone));

  // strings: anchors
  const strings = [];
  for (let i = 0; i < n; i++) {
    const s = inst.strings[i];
    const r = stringRadius(s.gauge, 0.0004);
    const kind = stringKind(s.material);
    const bridge = V3(0, yS(i), saddleTop + r);
    const nut = V3(L, yN(i), nutTop + r);
    let after;
    if (P.bridge === 'pin') {
      const pin = V3(-0.0095, yS(i), bridgeH + 0.0012);
      after = [bridge, pin];
      const pg = new THREE.CylinderGeometry(0.0027, 0.0021, 0.004, 16);
      pg.rotateX(Math.PI / 2);
      pg.translate(-0.0095, yS(i), bridgeH + 0.0008);
      root.add(mesh(pg, M.cream));
      const dot = new THREE.CircleGeometry(0.0011, 12);
      dot.translate(-0.0095, yS(i), bridgeH + 0.0028 + 0.00005);
      root.add(mesh(dot, M.pearl, { cast: false }));
    } else {
      after = [bridge, V3(-0.0075, yS(i), bridgeH + 0.0025 + r), V3(-0.0125, yS(i), bridgeH + 0.0026 + r), V3(-0.012, yS(i) - 0.0025, bridgeH + 0.0026 + r)];
    }
    strings.push({ bridge, nut, radius: r, kind, after, head: null, name: s.name });
  }

  // headstock, tuners, string paths to the posts
  guitarHead(root, M, P, inst, L, nutTop, ha, strings, yN);

  const fretTop = P.fbTop + 0.00115;
  function stopPoint(i, fret) {
    const s = strings[i];
    if (fret <= 0) return s.nut.clone();
    const x = fretX(fret);
    const t = x / L;
    const y = lerp(s.bridge.y, s.nut.y, t);
    return V3(x, y, fretTop + s.radius);
  }
  return {
    root, strings, stopPoint, fretX, L,
    focus: {
      centre: V3((xTail + L + P.headLen) / 2, 0, -0.03),
      soundhole: V3(P.holeX * 0.65, 0, 0.01),
      fretboard: V3(fretX(4), 0, 0.01),
    },
    radius: (L + P.headLen - xTail) / 2,
    fretTop,
    bow: null,
  };
}

// --------------------------------------------------------- guitar headstock
function guitarHead(root, M, P, inst, L, nutTop, ha, strings, yN) {
  const n = strings.length;
  const pivot = V3(L + 0.004, 0, nutTop - 0.0025);
  const hdir = V3(Math.cos(ha), 0, -Math.sin(ha));
  const nrm = V3(Math.sin(ha), 0, Math.cos(ha));
  const W = (u, y, w) => pivot.clone().addScaledVector(hdir, u).add(V3(0, y, 0)).addScaledVector(nrm, w);
  // generic paddle: flares from the nut, round shoulders, a shallow arch on top
  const len = P.headLen;
  const half = (u) => lerp(0.028, 0.043, smooth(0, len * 0.85, u));
  const pts = [];
  const K = 30;
  for (let k = 0; k <= K; k++) { const u = (k / K) * (len - 0.012); pts.push(new THREE.Vector2(u, -half(u))); }
  for (let k = 0; k <= 16; k++) {
    const a = -Math.PI / 2 + (k / 16) * Math.PI;
    const ry = half(len);
    pts.push(new THREE.Vector2(len - 0.012 + 0.012 * Math.cos(a) * 0.9 + 0.006 * Math.cos(a) ** 2 * 0, ry * Math.sin(a)));
  }
  for (let k = K; k >= 0; k--) { const u = (k / K) * (len - 0.012); pts.push(new THREE.Vector2(u, half(u))); }
  const th = 0.0135;
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: th, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 24 });
  scaleUV(g, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const w = W(p.getX(i), p.getY(i), p.getZ(i) - th);
    p.setXYZ(i, w.x, w.y, w.z);
  }
  g.computeVertexNormals();
  const head = mesh(g, [M.rosewood, M[P.neck]]);
  root.add(head);

  // tuners: 3 per side; low strings on the +y side, low E nearest the nut
  const us = [0.05, 0.09, 0.13];
  const knob = P.tuners === 'gold' ? M.gold : M.chrome;
  for (let i = 0; i < n; i++) {
    const side = i < n / 2 ? 1 : -1;
    const k = i < n / 2 ? i : n - 1 - i;
    const u = us[k];
    const y = side * (half(u) - 0.011);
    const base = W(u, y, 0);
    const postTop = W(u, y, 0.011);
    root.add(cylinderBetween(W(u, y, -0.0005), W(u, y, 0.0018), 0.0048, knob, 20));
    root.add(cylinderBetween(base, postTop, 0.0028, knob, 14));
    // housing under the head, shaft and button at the side
    const hous = mesh(new THREE.BoxGeometry(0.013, 0.012, 0.008), knob);
    hous.position.copy(W(u, side * (half(u) - 0.008), -th - 0.0045));
    hous.quaternion.setFromUnitVectors(V3(0, 0, 1), nrm);
    root.add(hous);
    const sx = W(u, side * (half(u) - 0.002), -th - 0.0045), sx2 = W(u, side * (half(u) + 0.012), -th - 0.0045);
    root.add(cylinderBetween(sx, sx2, 0.0016, knob, 10));
    const btn = mesh(new THREE.SphereGeometry(1, 20, 14), P.tuners === 'gold' ? M.cream : knob);
    btn.scale.set(0.0035, 0.009, 0.0075);
    btn.position.copy(W(u, side * (half(u) + 0.019), -th - 0.0045));
    btn.quaternion.setFromUnitVectors(V3(0, 0, 1), nrm);
    root.add(btn);
    // string path: nut -> post (wraps on the side of the post nearer the centre)
    const s = strings[i];
    const wrap = W(u, y - side * 0.0029, 0.0065);
    s.head = [s.nut.clone(), wrap];
    const coil = [];
    for (let q = 0; q <= 10; q++) {
      const a = (q / 10) * Math.PI * 2;
      coil.push(W(u, y - side * 0.0029 * Math.cos(a), 0.0065 - q * 0.0003).addScaledVector(hdir, 0.0029 * Math.sin(a)));
    }
    s.coil = coil;
  }
}

// ----------------------------------------------------------- violin builder
const VIOLIN = {
  bodyLen: 0.356, xTop: 0.195,
  // corner tips at index 7 (lower) and 13 (upper)
  half: [[0, 0], [0.004, 0.042], [0.018, 0.078], [0.045, 0.1], [0.08, 0.1035], [0.11, 0.099], [0.127, 0.0915], [0.1385, 0.0905],
    [0.146, 0.074], [0.16, 0.0605], [0.178, 0.0555], [0.197, 0.0585], [0.212, 0.069], [0.2185, 0.0825],
    [0.232, 0.0785], [0.255, 0.0815], [0.28, 0.0835], [0.312, 0.0775], [0.336, 0.06], [0.351, 0.032], [0.356, 0]],
  corners: [7, 13],
  archTop: 0.0155, archBack: 0.0145, edge: 0.0035, rib: 0.031,
  fbEnd: 0.058, fbNutW: 0.0235, fbEndW: 0.042, fbR: 0.042,
  nutSpan: 0.0165, bridgeSpan: 0.034, bridgeTop: 0.0478, bridgeR: 0.042,
};

/**
 * Arched plate. The arch is the solution phi of the Poisson equation
 * -lap(phi) = 1 inside the outline (phi = 0 on the edge), the shape of a
 * membrane under even pressure, normalised and shaped by prof(). The mesh
 * is a fan grid around a centre; heights come from phi.
 * Returns { geo, height(x, y) } (height is 0 outside).
 */
function makeArch(out, centre, A, K = 26, sign = 1, uvs = 4) {
  const n = out.length;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of out) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const hc = 0.0022;
  x0 -= 2 * hc; y0 -= 2 * hc;
  const GX = Math.ceil((x1 - x0) / hc) + 3, GY = Math.ceil((y1 - y0) / hc) + 3;
  const inside = new Uint8Array(GX * GY), phi = new Float64Array(GX * GY);
  for (let j = 0; j < GY; j++) {
    const y = y0 + j * hc;
    for (let i = 0; i < GX; i++) {
      const x = x0 + i * hc;
      let c = false;
      for (let k = 0, l = n - 1; k < n; l = k++) {
        const a = out[k], b = out[l];
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      inside[j * GX + i] = c ? 1 : 0;
    }
  }
  const f = hc * hc;
  for (let it = 0; it < 500; it++) {
    for (let j = 1; j < GY - 1; j++) {
      for (let i = 1; i < GX - 1; i++) {
        const q = j * GX + i;
        if (!inside[q]) continue;
        const v = 0.25 * (phi[q - 1] + phi[q + 1] + phi[q - GX] + phi[q + GX] + f);
        phi[q] += 1.9 * (v - phi[q]);
      }
    }
  }
  let mx = 0;
  for (const v of phi) mx = Math.max(mx, v);
  for (let q = 0; q < phi.length; q++) phi[q] /= mx;
  const prof = (p) => {
    const base = Math.pow(Math.min(1, p), 0.62);
    const channel = 0.11 * Math.exp(-(((p - 0.075) / 0.045) ** 2)) * (1 - Math.exp(-p * 60));
    return base - channel;
  };
  function phiAt(x, y) {
    const fx = (x - x0) / hc, fy = (y - y0) / hc;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= GX - 1 || j >= GY - 1) return 0;
    const tx = fx - i, ty = fy - j, q = j * GX + i;
    return (phi[q] * (1 - tx) + phi[q + 1] * tx) * (1 - ty) + (phi[q + GX] * (1 - tx) + phi[q + GX + 1] * tx) * ty;
  }
  const height = (x, y) => sign * A * prof(Math.max(0, phiAt(x, y)));
  const pos = [], uv = [], idx = [];
  pos.push(centre.x, centre.y, height(centre.x, centre.y)); uv.push(centre.x * uvs, centre.y * uvs);
  for (let k = 1; k <= K; k++) {
    const r = Math.pow(k / K, 0.8);
    for (let j = 0; j < n; j++) {
      const p = out[j];
      const x = centre.x + (p.x - centre.x) * r, y = centre.y + (p.y - centre.y) * r;
      pos.push(x, y, k === K ? 0 : height(x, y)); uv.push(x * uvs, y * uvs);
    }
  }
  for (let j = 0; j < n; j++) idx.push(0, 1 + j, 1 + ((j + 1) % n));
  for (let k = 1; k < K; k++) {
    for (let j = 0; j < n; j++) {
      const a = 1 + (k - 1) * n + j, b = 1 + (k - 1) * n + ((j + 1) % n);
      const c = a + n, d = b + n;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (sign < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, height };
}

/** One f-hole (bass side, y > 0), mirrored with my = -1. Lifted onto the arch. */
function fHole(height, zLift, my, mat) {
  const g = new THREE.Group();
  const E1 = new THREE.Vector2(0.036, 0.0205), E2 = new THREE.Vector2(-0.037, 0.041);
  const C1 = new THREE.Vector2(0.018, 0.0175), C2 = new THREE.Vector2(-0.016, 0.045);
  const curve = new THREE.CubicBezierCurve(E1, C1, C2, E2);
  const left = [], right = [];
  const K = 48;
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const p = curve.getPoint(t), d = curve.getTangent(t);
    const w = 0.0009 + 0.0022 * Math.pow(Math.sin(Math.PI * t), 0.6) + 0.0006 * smooth(0.75, 1, t);
    // wings: the outer edge bulges near the ends
    const wo = w + 0.0022 * Math.exp(-(((t - 0.2) / 0.07) ** 2)) + 0.0026 * Math.exp(-(((t - 0.82) / 0.07) ** 2));
    left.push(new THREE.Vector2(p.x - d.y * wo, p.y + d.x * wo));
    right.push(new THREE.Vector2(p.x + d.y * w, p.y - d.x * w));
  }
  const pts = [...left, ...right.reverse()];
  const geos = [new THREE.ShapeGeometry(new THREE.Shape(pts), 1)];
  for (const [E, r] of [[E1, 0.0031], [E2, 0.0041]]) { const c = new THREE.CircleGeometry(r, 24); c.translate(E.x, E.y, 0); geos.push(c); }
  // notches at the middle
  for (const s of [1, -1]) {
    const p = curve.getPoint(0.5), d = curve.getTangent(0.5);
    const nx = -d.y * s, ny = d.x * s;
    const tri = new THREE.Shape([
      new THREE.Vector2(p.x + nx * 0.0012 + d.x * 0.0009, p.y + ny * 0.0012 + d.y * 0.0009),
      new THREE.Vector2(p.x + nx * 0.0038, p.y + ny * 0.0038),
      new THREE.Vector2(p.x + nx * 0.0012 - d.x * 0.0009, p.y + ny * 0.0012 - d.y * 0.0009),
    ]);
    geos.push(new THREE.ShapeGeometry(tri));
  }
  for (const geo of geos) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) * my;
      p.setXYZ(i, x, y, height(x, y) + zLift);
    }
    if (my < 0) { const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
    geo.computeVertexNormals();
    g.add(mesh(geo, mat, { cast: false }));
  }
  return g;
}

/** Scroll volute in the (u, n) plane of a local frame W(u, y, n). */
function scroll(W, M, centre, rho0, theta0, turns) {
  const b = 0.115;
  const T = turns * Math.PI * 2;
  const NS = 150, NC = 20;
  const rings = [];
  const rhoAt = (t) => rho0 * Math.exp(-b * t);
  for (let k = 0; k <= NS; k++) {
    const t = (k / NS) * T;
    const th = theta0 + t;
    const rho = rhoAt(t);
    const tau = Math.max(0.0012, 0.86 * (rho - rhoAt(t + Math.PI * 2)));
    const hw = 0.0058 + 0.0052 * Math.min(1, rho / rho0) - 0.0012 * smooth(0.85, 1, k / NS);
    const ring = [];
    for (let c = 0; c < NC; c++) {
      const ph = (c / NC) * Math.PI * 2;
      const cr = Math.cos(ph), sr = Math.sin(ph);
      const ro = (tau / 2) * Math.sign(cr) * Math.pow(Math.abs(cr), 0.35);
      const yo = hw * Math.sign(sr) * Math.pow(Math.abs(sr), 0.35);
      // a fluted groove on the outer face of the first turn
      const flute = (cr > 0.5 && t < Math.PI * 2.2) ? -0.0008 * Math.pow(Math.cos((yo / hw) * Math.PI / 2), 2) * 0 : 0;
      const rr = rho - tau / 2 + ro + flute;
      ring.push(W(centre.u + rr * Math.cos(th), yo, centre.n + rr * Math.sin(th)));
    }
    rings.push(ring);
  }
  return mesh(loft(rings, { closed: true, capEnd: true, capStart: true, uScale: 8, vScale: 8 }), M.flame);
}

function violinBridge(M, height, ys, zString) {
  const R = VIOLIN.bridgeR;
  const z0 = Math.min(height(0, 0.0165), height(0, -0.0165)) - 0.0006;
  const top = (y) => VIOLIN.bridgeTop - (y * y) / (2 * R) - 0.0001;
  const s = new THREE.Shape();
  s.moveTo(-0.0205, z0);
  s.lineTo(-0.0095, z0);
  s.quadraticCurveTo(-0.004, z0 + 0.0002, 0, z0 + 0.0085);
  s.quadraticCurveTo(0.004, z0 + 0.0002, 0.0095, z0);
  s.lineTo(0.0205, z0);
  s.lineTo(0.0205, z0 + 0.003);
  s.quadraticCurveTo(0.0155, z0 + 0.0115, 0.0185, z0 + 0.019);
  s.quadraticCurveTo(0.022, z0 + 0.025, 0.0205, top(0.0205));
  for (let k = 1; k <= 24; k++) { const y = 0.0205 - (k / 24) * 0.041; s.lineTo(y, top(y)); }
  s.quadraticCurveTo(-0.022, z0 + 0.025, -0.0185, z0 + 0.019);
  s.quadraticCurveTo(-0.0155, z0 + 0.0115, -0.0205, z0 + 0.003);
  s.lineTo(-0.0205, z0);
  const heart = new THREE.Path();
  heart.absellipse(0, z0 + 0.0175, 0.0021, 0.0026, 0, Math.PI * 2, true);
  s.holes.push(heart);
  for (const sg of [1, -1]) {
    const k = new THREE.Path();
    k.absellipse(sg * 0.0105, z0 + 0.016, 0.0013, 0.0042, 0, Math.PI * 2, true, sg * 0.35);
    s.holes.push(k);
  }
  const th = 0.0042;
  const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: false, curveSegments: 16 });
  const p = g.attributes.position;
  const zt = VIOLIN.bridgeTop;
  for (let i = 0; i < p.count; i++) {
    const y = p.getX(i), z = p.getY(i), d = p.getZ(i);
    const taper = 1 - 0.68 * smooth(z0, zt, z);
    p.setXYZ(i, (d - th / 2) * taper - 0.0004 * smooth(z0, zt, z), y, z);
  }
  g.computeVertexNormals();
  scaleUV(g, 30);
  return mesh(g, M.maple);
}

function buildViolin(inst, M) {
  const V = VIOLIN;
  const L = inst.scaleM;
  const n = inst.strings.length;
  const root = new THREE.Group();
  root.name = 'violin';
  const xTail = V.xTop - V.bodyLen;
  const out = outline(V.half, xTail, 300, V.corners);
  const centre = new THREE.Vector2(xTail + 0.18, 0);
  const ribOut = offsetOutline(out, 0.0025);

  // plates: arched top and back, edge bands, ribs, purfling
  const topA = makeArch(out, centre, V.archTop, 30, 1, 5);
  root.add(mesh(topA.geo, M.violinTop));
  const zEdgeB = -V.edge;
  const zRibB = zEdgeB - V.rib;
  const zBack = zRibB - V.edge;
  const backA = makeArch(out, centre, V.archBack, 30, -1, 3);
  backA.geo.translate(0, 0, zBack);
  root.add(mesh(backA.geo, M.flame));
  root.add(mesh(wall(out, () => 0, () => zEdgeB), M.flame));
  root.add(mesh(wall(out, () => zRibB, () => zBack), M.flame));
  root.add(mesh(wall(ribOut, () => zEdgeB, () => zRibB), M.flame));
  // undersides of the overhanging edges (thin flat rings)
  for (const z of [zEdgeB, zRibB]) {
    const ring = new THREE.ShapeGeometry(flatShape(out, [ribOut.slice().reverse()]), 1);
    ring.translate(0, 0, z);
    if (z === zEdgeB) ring.rotateX(0); // faces +z; seen from below it is dark anyway
    root.add(mesh(ring, M.flame));
  }
  // purfling on top and back
  for (const [h, zoff, sg] of [[topA.height, 0.00035, 1], [(x, y) => zBack + backA.height(x, y), -0.00035, -1]]) {
    const a = offsetOutline(out, 0.0036), b = offsetOutline(out, 0.0049);
    const ra = a.map((p) => V3(p.x, p.y, h(p.x, p.y) + zoff));
    const rb = b.map((p) => V3(p.x, p.y, h(p.x, p.y) + zoff));
    const pos = [], idx = [];
    for (let j = 0; j < ra.length; j++) pos.push(ra[j].x, ra[j].y, ra[j].z, rb[j].x, rb[j].y, rb[j].z);
    const N = ra.length;
    for (let j = 0; j < N; j++) {
      const p0 = 2 * j, p1 = 2 * ((j + 1) % N);
      if (sg > 0) idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); else idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    root.add(mesh(g, M.black, { cast: false }));
  }
  // f-holes
  root.add(fHole(topA.height, 0.0004, 1, M.black));
  root.add(fHole(topA.height, 0.0004, -1, M.black));

  // fingerboard (ebony, curved top)
  const fbTopC = (x) => lerp(0.0205, 0.0405, (L - x) / (L - V.fbEnd));
  const fbW = (x) => lerp(V.fbNutW, V.fbEndW, (L - x) / (L - V.fbEnd));
  const fbZ = (x, y) => fbTopC(x) - (y * y) / (2 * V.fbR);
  const fbBot = (x) => fbTopC(x) - (fbW(x) / 2) ** 2 / (2 * V.fbR) - 0.0042;
  const fbRings = [];
  for (let r = 0; r <= 24; r++) {
    const x = lerp(V.fbEnd, L + 0.0004, r / 24);
    const w = fbW(x) / 2;
    const ring = [];
    for (let c = 0; c <= 10; c++) { const y = w - (c / 10) * 2 * w; ring.push(V3(x, y, fbZ(x, y))); }
    ring.push(V3(x, -w, fbBot(x)), V3(x, w, fbBot(x)));
    fbRings.push(ring);
  }
  root.add(mesh(loft(fbRings, { closed: true, capStart: true, capEnd: true, uScale: 6, vScale: 6 }), M.ebony));

  // neck shaft and heel
  const neckRings = [];
  for (let r = 0; r <= 30; r++) {
    const x = lerp(V.xTop - 0.003, L + 0.002, r / 30);
    const w = fbW(x) / 2 - 0.0003;
    const zt = fbBot(x);
    let d = lerp(0.0175, 0.0195, smooth(L, V.xTop + 0.03, x));
    d += (zt - zRibB + 0.001 - d) * smooth(V.xTop + 0.035, V.xTop, x);
    const ring = [];
    for (let a = 0; a <= 16; a++) {
      const th = (a / 16) * Math.PI;
      ring.push(V3(x, w * Math.cos(th), zt - d * Math.pow(Math.sin(th), 0.8)));
    }
    neckRings.push(ring);
  }
  root.add(mesh(loft(neckRings, { closed: false, uScale: 6, vScale: 12 }), M.flame));

  // nut
  const nutTop = fbTopC(L) + 0.0006;
  root.add(mesh(taperedBox(L, L + 0.006, fbW(L), fbW(L) * 0.97, () => nutTop, nutTop - fbBot(L), 6), M.ebony));

  // pegbox and scroll in a local frame tilted down from the nut
  const tilt = 0.2;
  const O = V3(L + 0.006, 0, nutTop - 0.0015);
  const hdir = V3(Math.cos(tilt), 0, -Math.sin(tilt));
  const nrm = V3(Math.sin(tilt), 0, Math.cos(tilt));
  const W = (u, y, w) => O.clone().addScaledVector(hdir, u).add(V3(0, y, 0)).addScaledVector(nrm, w);
  const PB = 0.078, depthPB = 0.024;
  const halfW = (u) => lerp(0.0122, 0.0105, u / PB);
  const cheek = (sg) => {
    const rings = [];
    for (let r = 0; r <= 8; r++) {
      const u = (r / 8) * PB;
      const hw = halfW(u);
      const d = depthPB * (1 - 0.15 * smooth(PB * 0.6, PB, u));
      const yi = sg * (hw - 0.0042), yo = sg * hw;
      rings.push([W(u, yi, 0), W(u, yo, 0), W(u, yo, -d), W(u, yi, -d)]);
    }
    return mesh(loft(rings, { closed: true, capStart: true, uScale: 6, vScale: 6 }), M.flame);
  };
  root.add(cheek(1), cheek(-1));
  const floorR = [];
  for (let r = 0; r <= 8; r++) {
    const u = (r / 8) * PB;
    const hw = halfW(u) - 0.0041;
    const d = depthPB * (1 - 0.15 * smooth(PB * 0.6, PB, u));
    floorR.push([W(u, hw, -d + 0.0045), W(u, hw, -d), W(u, -hw, -d), W(u, -hw, -d + 0.0045)]);
  }
  root.add(mesh(loft(floorR, { closed: true, uScale: 6, vScale: 6 }), M.flame));
  // dark inside of the pegbox
  const inside = new THREE.PlaneGeometry(PB, 0.016);
  const ip = inside.attributes.position;
  for (let i = 0; i < ip.count; i++) { const w = W(ip.getX(i) + PB / 2, ip.getY(i), -depthPB + 0.0047); ip.setXYZ(i, w.x, w.y, w.z); }
  inside.computeVertexNormals();
  root.add(mesh(inside, M.ebony, { cast: false }));
  // volute: starts at the back of the pegbox end and curls forward, up and in
  const sc = { u: PB + 0.0165, n: -0.0095 };
  const v0 = { u: PB - 0.001 - sc.u, n: -depthPB + 0.0015 - sc.n };
  root.add(scroll(W, M, sc, Math.hypot(v0.u, v0.n), Math.atan2(v0.n, v0.u), 2.35));

  // strings: bridge arc, nut, tailpiece
  const yB = (i) => V.bridgeSpan / 2 - (i * V.bridgeSpan) / (n - 1);
  const yN = (i) => V.nutSpan / 2 - (i * V.nutSpan) / (n - 1);
  const bridgeZ = (y) => V.bridgeTop - (y * y) / (2 * V.bridgeR);
  root.add(violinBridge(M, topA.height));

  // tailpiece
  const tp0 = -0.05, tp1 = xTail + 0.013;
  const tpRings = [];
  for (let r = 0; r <= 18; r++) {
    const t = r / 18;
    const x = lerp(tp0, tp1, t);
    const hw = lerp(0.0185, 0.0105, Math.pow(t, 0.9));
    const zb = lerp(topA.height(tp0, 0) + 0.0075, topA.height(tp1, 0) + 0.0045, Math.pow(t, 1.2));
    const ring = [];
    for (let c = 0; c <= 12; c++) {
      const a = (c / 12) * Math.PI;
      ring.push(V3(x, hw * Math.cos(a), zb + 0.0062 * Math.pow(Math.sin(a), 0.5)));
    }
    tpRings.push(ring);
  }
  root.add(mesh(loft(tpRings, { closed: true, capStart: true, capEnd: true, uScale: 6, vScale: 6 }), M.ebony));
  const tpTopZ = topA.height(tp0, 0) + 0.0075 + 0.0062;
  // fine tuner on the E string
  const eY = -0.0105 * 1.5 + 0.0003;
  root.add(cylinderBetween(V3(-0.064, eY, tpTopZ - 0.001), V3(-0.064, eY, tpTopZ + 0.0085), 0.0018, M.chrome));
  const lever = mesh(new THREE.BoxGeometry(0.02, 0.006, 0.004), M.chrome);
  lever.position.set(-0.062, eY, tpTopZ + 0.0015);
  root.add(lever);
  // saddle, tailgut, end button
  root.add(mesh(taperedBox(xTail - 0.0015, xTail + 0.0055, 0.034, 0.034, () => 0.0015, 0.004, 8), M.ebony));
  const gut = new THREE.CatmullRomCurve3([V3(tp1 + 0.002, 0, topA.height(tp1, 0) + 0.006), V3(xTail + 0.007, 0, 0.0052), V3(xTail + 0.002, 0, 0.0045), V3(xTail - 0.003, 0, -0.004), V3(xTail - 0.004, 0, -0.019)]);
  root.add(mesh(new THREE.TubeGeometry(gut, 24, 0.0012, 8), M.gut));
  const btn = mesh(new THREE.SphereGeometry(0.0055, 20, 14), M.ebony);
  btn.scale.set(0.9, 1, 1);
  btn.position.set(xTail - 0.0085, 0, (zEdgeB + zRibB) / 2);
  root.add(btn, cylinderBetween(V3(xTail - 0.004, 0, (zEdgeB + zRibB) / 2), V3(xTail + 0.002, 0, (zEdgeB + zRibB) / 2), 0.0033, M.ebony));

  // chinrest on the bass (+y) side of the tailpiece
  const prof = [[0, 0.0062], [0.5, 0.006], [0.8, 0.0068], [0.94, 0.0084], [1, 0.0092], [1.035, 0.0085], [1.02, 0.004], [0.9, 0.0004], [0, 0]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), 48);
  lathe.rotateX(Math.PI / 2);
  lathe.scale(0.029, 0.025, 1);
  const crX = xTail + 0.024, crY = 0.04;
  lathe.translate(crX, crY, topA.height(crX, crY) + 0.0075);
  scaleUV(lathe, 4);
  root.add(mesh(lathe, M.ebony));
  // two short barrels clamp over the tail rib under the cup; a foot block under the cup
  const ribX = (y) => ribOut.filter((p) => p.x < xTail + 0.06 && Math.abs(p.y - y) < 0.004).reduce((m, p) => Math.min(m, p.x), xTail + 0.06);
  for (const by of [crY - 0.016, crY + 0.012]) {
    const bx = ribX(by) - 0.0024;
    root.add(cylinderBetween(V3(bx, by, zRibB + 0.008), V3(bx, by, zEdgeB - 0.002), 0.0021, M.chrome));
  }
  const foot = new THREE.CylinderGeometry(0.009, 0.011, 0.0075, 24);
  foot.rotateX(Math.PI / 2);
  foot.scale(1.4, 1, 1);
  foot.translate(crX, crY, topA.height(crX, crY) + 0.0038);
  root.add(mesh(foot, M.ebony));

  // pegs: D and G on +y (heads on +y), A and E on -y
  const pegU = [0.044, 0.016, 0.03, 0.058];
  const pegSide = [1, 1, -1, -1];
  const strings = [];
  for (let i = 0; i < n; i++) {
    const s = inst.strings[i];
    const r = [0.00042, 0.0004, 0.00036, 0.00013][i] || 0.0003;
    const kind = stringKind(s.material);
    const bridge = V3(0, yB(i), bridgeZ(yB(i)) + r);
    const nut = V3(L, yN(i), nutTop + r);
    const tail = V3(tp0 - 0.008, yB(i) * 0.62, tpTopZ + r);
    const after = i === n - 1 ? [bridge, V3(-0.06, eY, tpTopZ + 0.006)] : [bridge, tail];
    const u = pegU[i], sg = pegSide[i];
    const pegN = -0.0115;
    const shaftA = W(u, -sg * 0.0125, pegN), shaftB = W(u, sg * 0.0165, pegN);
    root.add(cylinderBetween(shaftA, shaftB, 0.0032, M.ebony, 14));
    root.add(cylinderBetween(W(u, sg * 0.0158, pegN), W(u, sg * 0.0185, pegN), 0.0046, M.cream, 18));
    const head = mesh(new THREE.SphereGeometry(1, 22, 16), M.ebony);
    head.scale.set(0.0042, 0.0115, 0.0105);
    head.position.copy(W(u, sg * 0.029, pegN));
    head.quaternion.setFromUnitVectors(V3(1, 0, 0), hdir);
    root.add(head);
    const dot = mesh(new THREE.SphereGeometry(0.0016, 12, 8), M.pearl);
    dot.scale.set(1.6, 1, 1);
    dot.position.copy(W(u, sg * 0.029, pegN)).addScaledVector(hdir, 0.0033);
    root.add(dot);
    const head3 = [nut.clone(), W(u, yN(i) * 0.6, pegN + 0.0034)];
    strings.push({ bridge, nut, radius: r, kind, after, head: head3, name: s.name });
  }

  const fretX = (k) => L * 2 ** (-k / 12);
  function stopPoint(i, fret) {
    const s = strings[i];
    if (fret <= 0) return s.nut.clone();
    const x = fretX(fret);
    const t = x / L;
    const y = lerp(s.bridge.y, s.nut.y, t);
    return V3(x, y, fbZ(x, y) + s.radius);
  }
  const bow = buildBow(M);
  root.add(bow.group);
  return {
    root, strings, stopPoint, fretX, L,
    focus: {
      centre: V3((xTail + L + 0.11) / 2, 0, 0.0),
      soundhole: V3(0.02, 0, 0.035),
      fretboard: V3(fretX(5), 0, 0.03),
    },
    radius: (L + 0.11 - xTail) / 2 + 0.04,
    bow,
    bridgeR: V.bridgeR,
  };
}

// --------------------------------------------------------------------- bow
/**
 * Bow in its own frame: the hair runs along local +x at z = 0 from the frog
 * (x = 0.035) to the tip (x = 0.715); the stick is above (+z).
 * place(P, dir, up, b) puts hair point x = b at world P.
 */
function buildBow(M) {
  const g = new THREE.Group();
  g.name = 'bow';
  const LEN = 0.73;
  const stickZ = (x) => lerp(0.0185, 0.0085, x / LEN) - 0.0055 * Math.sin((Math.PI * x) / LEN);
  const stickR = (x) => lerp(0.0043, 0.0027, Math.pow(x / LEN, 0.9));
  const rings = [];
  for (let k = 0; k <= 80; k++) {
    const x = lerp(-0.012, LEN - 0.012, k / 80);
    const r = stickR(Math.max(0, x));
    const ring = [];
    const oct = x < 0.3; // octagonal near the frog
    for (let c = 0; c < (oct ? 8 : 14); c++) {
      const a = (c / (oct ? 8 : 14)) * Math.PI * 2 + (oct ? Math.PI / 8 : 0);
      ring.push(V3(x, r * Math.cos(a), stickZ(Math.max(0, x)) + r * Math.sin(a)));
    }
    rings.push(ring);
  }
  // the ring point count changes at x = 0.3, so loft two parts
  const cut = rings.findIndex((r) => r.length === 14);
  g.add(mesh(loft(rings.slice(0, cut), { closed: true, capStart: true, uScale: 30, vScale: 30 }), M.stick));
  g.add(mesh(loft(rings.slice(cut - 1).map((r, i) => (i === 0 ? resample(r, 14) : r)), { closed: true, uScale: 30, vScale: 30 }), M.stick));
  // head (tip): a wedge from the stick down to the hair, ivory face
  const tipRings = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const x = lerp(LEN - 0.03, LEN, t);
    const zt = stickZ(LEN - 0.012) + 0.0035 * Math.sin(Math.PI * t * 0.9) + 0.002;
    const zb = lerp(stickZ(LEN - 0.03) - 0.002, -0.0012, Math.pow(t, 0.6));
    const hw = 0.0029 - 0.0006 * t;
    tipRings.push([V3(x, hw, zt), V3(x, -hw, zt), V3(x, -hw, zb), V3(x, hw, zb)]);
  }
  g.add(mesh(loft(tipRings, { closed: true, capEnd: true, capStart: true }), M.stick));
  g.add(mesh(taperedBox(LEN - 0.0015, LEN + 0.0012, 0.0052, 0.0046, (x) => lerp(stickZ(LEN - 0.012) + 0.006, 0.0035, 0.5) - 0.001, 0.016, 8), M.cream));
  // frog
  const frog = taperedBox(0.004, 0.058, 0.0115, 0.0105, (x) => stickZ(x) - 0.002, 0.0195, 20);
  g.add(mesh(frog, M.ebony));
  const eye = new THREE.CircleGeometry(0.0021, 18);
  eye.rotateX(Math.PI / 2);
  eye.translate(0.03, 0.00585, stickZ(0.03) - 0.008);
  g.add(mesh(eye, M.pearl, { cast: false }));
  const eye2 = eye.clone(); eye2.rotateZ(Math.PI); eye2.translate(0.06, 0, 0);
  g.add(mesh(eye2, M.pearl, { cast: false }));
  g.add(mesh(taperedBox(0.0555, 0.059, 0.0118, 0.0118, () => 0.0016, 0.0042, 20), M.chrome)); // ferrule
  // button (adjuster) and winding
  g.add(cylinderBetween(V3(-0.03, 0, stickZ(0)), V3(-0.012, 0, stickZ(0)), 0.0042, M.ebony, 8));
  g.add(cylinderBetween(V3(-0.033, 0, stickZ(0)), V3(-0.029, 0, stickZ(0)), 0.0043, M.chrome, 16));
  g.add(cylinderBetween(V3(0.07, 0, stickZ(0.07)), V3(0.115, 0, stickZ(0.115)), 0.0041, M.chrome, 16));
  // hair ribbon
  const hairG = new THREE.PlaneGeometry(0.68, 0.0095, 40, 1);
  hairG.translate(0.375, 0, 0);
  g.add(mesh(hairG, M.hair));
  g.visible = false;
  const R = new THREE.Matrix4();
  function place(P, dir, up, b) {
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    R.makeBasis(dir, side, up);
    g.quaternion.setFromRotationMatrix(R);
    g.position.copy(P).addScaledVector(dir, -b);
  }
  return { group: g, place, hair: [0.035, 0.715] };
}

function resample(ring, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * ring.length;
    const a = ring[Math.floor(t) % ring.length], b = ring[(Math.floor(t) + 1) % ring.length];
    out.push(a.clone().lerp(b, t - Math.floor(t)));
  }
  return out;
}

// ----------------------------------------------------------------- public
/** Build the 3D model for an engine instrument (INSTRUMENTS[key]). */
export function buildModel(inst, M = materials()) {
  const m = inst.key === 'violin' ? buildViolin(inst, M) : buildGuitar(inst, M);
  m.key = inst.key;
  m.materials = M;
  return m;
}
export { materials, stringKind, stringRadius };
