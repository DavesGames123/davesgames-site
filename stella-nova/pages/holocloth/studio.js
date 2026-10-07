// ============================================================================
//  THIN-FILM CLOTH  ·  studio.js — the procedural photo studio
// ----------------------------------------------------------------------------
//  Everything the cloth reflects and sits in is made here, from code:
//
//  1. lightProbe()  an HDR equirect light probe of a studio: a warm-grey
//     room, a warm key softbox, a cool fill, two strip lights behind and a
//     round top light. It returns the sharp map and five blurred copies
//     stacked in one tall texture (the "probe atlas"). The cloth shader
//     picks two levels by roughness and blends them (fabric.js envAt).
//     The blur is three box passes per row and per column, with the row
//     radius scaled by 1/cos(latitude), so a blur covers a near-constant
//     solid angle.
//  2. buildCyc()    a sweep (floor curving up into the back wall), the
//     backdrop of a product photo.
//  3. buildProps()  the drape shapes: sphere, rounded cube and a bust
//     made of a plinth, chest, shoulders, neck and head primitives. Each
//     prop also returns its collider list for xpbd.js, with the same
//     sizes, so the mesh and the collision agree.
//
//  Direction convention (the shader uses the same):
//    u = atan(z, x) / 2pi + 0.5,  v = acos(y) / pi
//
//  GREP MAP
//    grep -n 'const LIGHTS'          the studio lights
//    grep -n 'export function lightProbe'  probe atlas build
//    grep -n 'export function buildCyc'    the sweep
//    grep -n 'export function buildProps'  props + colliders
// ============================================================================
import * as THREE from 'three';

export const PROBE = { w: 384, h: 192, levels: 6, radii: [0, 2, 5, 11, 24, 52] };

// Softboxes: azimuth and elevation of the centre (deg), half width and half
// height (deg), radiance, colour. The key is warm, the fill cool, the rims
// neutral and pale teal, so the film colours have contrast to pick up.
const LIGHTS = [
  { az: 38, el: 32, hw: 22, hh: 15, L: 9.0, c: [1.0, 0.87, 0.72] },     // key
  { az: -112, el: 12, hw: 26, hh: 18, L: 2.2, c: [0.62, 0.77, 1.0] },   // fill
  { az: 158, el: 14, hw: 3.5, hh: 32, L: 14, c: [1.0, 0.98, 0.95] },    // rim strip
  { az: -160, el: 18, hw: 3.0, hh: 30, L: 9, c: [0.62, 1.0, 0.94] },    // rim strip, teal
  { az: 0, el: 82, hw: 14, hh: 14, L: 4.0, c: [1.0, 1.0, 1.0], round: true },
];

const D2R = Math.PI / 180;
function dirOf(u, v) {
  const phi = (u - 0.5) * 2 * Math.PI, th = v * Math.PI;
  return [Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi)];
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Radiance of the studio in one direction (linear RGB).
export function studioRadiance(d) {
  const y = d[1];
  // room: dark ceiling, a lighter band at the horizon, warm-grey floor
  const hz = Math.exp(-Math.abs(y) * 5.5);
  let r, g, b;
  if (y >= 0) { const k = 0.035 + 0.11 * hz; r = k * 1.04; g = k; b = k * 0.95; }
  else { const k = 0.09 + 0.09 * hz; r = k * 1.08; g = k * 1.0; b = k * 0.88; }
  const az = Math.atan2(d[2], d[0]) / D2R, el = Math.asin(Math.max(-1, Math.min(1, y))) / D2R;
  for (const s of LIGHTS) {
    let da = ((az - s.az + 540) % 360) - 180;
    da *= Math.cos(el * D2R);                  // angular width on the sphere
    const de = el - s.el;
    let m;
    if (s.round) m = 1 - smooth(s.hw * 0.8, s.hw, Math.hypot(da, de));
    else m = (1 - smooth(s.hw * 0.85, s.hw, Math.abs(da))) * (1 - smooth(s.hh * 0.85, s.hh, Math.abs(de)));
    if (m <= 0) continue;
    // a softbox is brighter at its centre than at its rim
    const fall = s.round ? 1 : 0.75 + 0.25 * (1 - Math.abs(de) / s.hh);
    r += m * s.L * s.c[0] * fall; g += m * s.L * s.c[1] * fall; b += m * s.L * s.c[2] * fall;
  }
  return [r, g, b];
}

// Box blur of one channel line, radius rad, wrap or clamp at the ends.
function boxLine(src, dst, n, stride, off, rad, wrap) {
  if (rad < 1) { for (let i = 0; i < n; i++) dst[off + i * stride] = src[off + i * stride]; return; }
  const at = i => src[off + (wrap ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))) * stride];
  let s = 0; for (let i = -rad; i <= rad; i++) s += at(i);
  const inv = 1 / (2 * rad + 1);
  for (let i = 0; i < n; i++) { dst[off + i * stride] = s * inv; s += at(i + rad + 1) - at(i - rad); }
}

// The probe atlas: levels stacked top to bottom, RGBA half floats.
export function lightProbe() {
  const { w, h, levels, radii } = PROBE;
  const base = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = studioRadiance(dirOf((i + 0.5) / w, (j + 0.5) / h));
    base.set(c, 3 * (j * w + i));
  }
  const atlas = new Uint16Array(w * h * levels * 4);
  const tmp = new Float32Array(w * h * 3), cur = new Float32Array(w * h * 3);
  for (let L = 0; L < levels; L++) {
    cur.set(base);
    const R = radii[L];
    for (let pass = 0; pass < 3 && R > 0; pass++) {
      for (let j = 0; j < h; j++) {
        const lat = Math.abs((j + 0.5) / h - 0.5) * Math.PI;
        const rr = Math.min(w / 2 - 1, Math.round(R / Math.max(0.08, Math.cos(lat))));
        for (let c = 0; c < 3; c++) boxLine(cur, tmp, w, 3, 3 * j * w + c, rr, true);
      }
      for (let i = 0; i < w; i++) for (let c = 0; c < 3; c++) boxLine(tmp, cur, h, 3 * w, 3 * i + c, R, false);
    }
    const o = L * w * h * 4;
    for (let k = 0; k < w * h; k++) {
      atlas[o + 4 * k] = THREE.DataUtils.toHalfFloat(cur[3 * k]);
      atlas[o + 4 * k + 1] = THREE.DataUtils.toHalfFloat(cur[3 * k + 1]);
      atlas[o + 4 * k + 2] = THREE.DataUtils.toHalfFloat(cur[3 * k + 2]);
      atlas[o + 4 * k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(atlas, w, h * levels, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace; tex.generateMipmaps = false; tex.needsUpdate = true;
  // The sharp level alone, as an equirect for PMREM (props and the cyc).
  const eq = new THREE.DataTexture(atlas.slice(0, w * h * 4), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  eq.mapping = THREE.EquirectangularReflectionMapping; eq.magFilter = THREE.LinearFilter; eq.minFilter = THREE.LinearFilter;
  eq.colorSpace = THREE.LinearSRGBColorSpace; eq.flipY = false; eq.needsUpdate = true;
  return { atlas: tex, equirect: eq, ...PROBE };
}

// The key light direction, for the shadow casting light: the key softbox.
export function keyDirection() {
  const s = LIGHTS[0], az = s.az * D2R, el = s.el * D2R;
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}
export function keyColor() { const s = LIGHTS[0]; return new THREE.Color(s.c[0], s.c[1], s.c[2]); }

// The sweep: a floor from z = +front to the curve at z = zc, a quarter
// circle of radius rc up to the back wall, the wall to the top.
export function buildCyc({ width = 18, front = 9, zc = -1.6, rc = 2.2, top = 9 } = {}) {
  const prof = [];
  for (let i = 0; i <= 12; i++) prof.push([front - (front - zc) * i / 12, 0]);
  for (let i = 1; i <= 24; i++) { const a = i / 24 * Math.PI / 2; prof.push([zc - rc * Math.sin(a), rc - rc * Math.cos(a)]); }
  for (let i = 1; i <= 6; i++) prof.push([zc - rc, rc + (top - rc) * i / 6]);
  const nx = 24, pos = [], idx = [];
  for (let p = 0; p < prof.length; p++) for (let i = 0; i <= nx; i++) pos.push((i / nx - 0.5) * width, prof[p][1], prof[p][0]);
  for (let p = 0; p < prof.length - 1; p++) for (let i = 0; i < nx; i++) {
    const a = p * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.30, 0.285, 0.265), roughness: 0.95, metalness: 0, envMapIntensity: 0.55 });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = 'cyc';
  return mesh;
}

// Props for the drape scene. Each returns { group, colliders, top } where
// top is the height the cloth starts above.
export function buildProps() {
  const plaster = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.75, 0.70), roughness: 0.82, metalness: 0 });
  const mk = (geo, x, y, z) => { const m = new THREE.Mesh(geo, plaster); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
  const out = {};
  {
    const r = 0.36, g = new THREE.Group();
    g.add(mk(new THREE.SphereGeometry(r, 64, 40), 0, r, 0));
    out.sphere = { group: g, colliders: [{ type: 'sphere', c: [0, r, 0], r }], top: 2 * r };
  }
  {
    const h = 0.3, rr = 0.03, g = new THREE.Group();
    const geo = roundedBox(2 * h, 2 * h, 2 * h, rr);
    g.add(mk(geo, 0, h, 0));   // axis aligned, the same as its collider
    out.cube = { group: g, colliders: [{ type: 'box', c: [0, h, 0], h: [h, h, h], r: rr }], top: 2 * h };
  }
  {
    const g = new THREE.Group(), cols = [];
    const box = (cx, cy, cz, hx, hy, hz, r) => { g.add(mk(roundedBox(2 * hx, 2 * hy, 2 * hz, r), cx, cy, cz)); cols.push({ type: 'box', c: [cx, cy, cz], h: [hx, hy, hz], r }); };
    const cap = (a, b, r) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
      const m = mk(new THREE.CapsuleGeometry(r, L, 8, 24), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); g.add(m);
      cols.push({ type: 'capsule', a, b, r });
    };
    const sph = (c, r) => { g.add(mk(new THREE.SphereGeometry(r, 48, 32), ...c)); cols.push({ type: 'sphere', c, r }); };
    box(0, 0.17, 0, 0.17, 0.17, 0.17, 0.015);              // plinth
    box(0, 0.42, 0, 0.17, 0.09, 0.10, 0.07);               // chest
    cap([-0.19, 0.50, -0.01], [0.19, 0.50, -0.01], 0.075); // shoulders
    cap([0, 0.52, 0.0], [0, 0.66, 0.01], 0.055);           // neck
    sph([0, 0.76, 0.015], 0.115);                          // head
    sph([0, 0.73, 0.105], 0.035);                          // nose and brow
    out.bust = { group: g, colliders: cols, top: 0.89 };
  }
  return out;
}

// A rounded box geometry: a box whose vertices are pulled onto the rounded
// shape. Built here so no addon is needed.
function roundedBox(w, h, d, r, seg = 6) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position, v = new THREE.Vector3(), hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    const n = v.clone().sub(c); if (n.lengthSq() > 1e-12) n.setLength(r);
    p.setXYZ(i, c.x + n.x, c.y + n.y, c.z + n.z);
  }
  g.computeVertexNormals();
  return g;
}
