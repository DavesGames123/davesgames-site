// ============================================================================
//  MAXWELL'S EQUATIONS  ·  kit.js — the drawing parts every scene shares
// ----------------------------------------------------------------------------
//  Colours, crisp lines, glass shells, glowing dots, instanced arrows and
//  tubes. The colours are the math colours of lib/sci.css, so a symbol in
//  the TeX and its object on the canvas have one colour:
//      E  #ff9a62 (.m2)    B  #62c4ff (.m1)    rho  #e889dc (.m4)
//      J  #ffd666 (.m5)    boundary, d, surfaces  #86dc7c (.m3)
//      A, F, star  #a8a4ff (.m6)
//
//  Every LineMaterial goes in LINE_MATS, so the stage can give them the
//  canvas size on a resize (fat lines need the resolution).
//
//  GREP MAP   (grep -n "<anchor>" kit.js)
//    "export const COL"        colours
//    "export function lines"   fat line segments from polylines
//    "export function shellMat"  glass shell with a rim (fresnel)
//    "export function dots"    round points in px
//    "export function arrows"  an instanced arrow field
//    "export function setArrow" one arrow instance
//    "export function ease"    easing
// ============================================================================
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export { THREE };
export const COL = { E: '#ff9a62', B: '#62c4ff', S: '#86dc7c', Q: '#e889dc', J: '#ffd666', A: '#a8a4ff', ink: '#eef2f4', dim: '#7f8ea0' };
export const LINE_MATS = new Set();
export const RES = new THREE.Vector2(1, 1);

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
export const ease5 = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;

// Polylines ([[x,y,z], ...] lists) to one LineSegments2. opts: color,
// width (px), opacity, dashed { dash, gap }, colors (a function
// (lineIndex, pointIndex) -> [r,g,b] for vertex colours), clip (planes).
export function linePositions(polys, closed = false) {
  let n = 0;
  for (const P of polys) n += Math.max(0, P.length - 1) + (closed && P.length > 2 ? 1 : 0);
  const pos = new Float32Array(n * 6);
  let o = 0;
  for (const P of polys) {
    const m = P.length - 1 + (closed && P.length > 2 ? 1 : 0);
    for (let i = 0; i < m; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      pos[o++] = a[0]; pos[o++] = a[1]; pos[o++] = a[2];
      pos[o++] = b[0]; pos[o++] = b[1]; pos[o++] = b[2];
    }
  }
  return pos;
}
export function lineMat({ color = '#ffffff', width = 1.5, opacity = 1, dashed = null, vertexColors = false, clip = null, depthTest = true, additive = false } = {}) {
  const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity, vertexColors, depthTest, depthWrite: false,
    dashed: !!dashed, dashSize: dashed ? dashed.dash : 1, gapSize: dashed ? dashed.gap : 0, dashScale: 1 });
  if (additive) m.blending = THREE.AdditiveBlending;
  if (clip) { m.clippingPlanes = clip; m.clipping = true; }
  m.resolution.copy(RES);
  LINE_MATS.add(m);
  return m;
}
export function lines(polys, opts = {}) {
  const g = new LineSegmentsGeometry();
  g.setPositions(linePositions(polys, opts.closed));
  if (opts.colors) {
    const col = [];
    polys.forEach((P, li) => {
      const m = P.length - 1 + (opts.closed && P.length > 2 ? 1 : 0);
      for (let i = 0; i < m; i++) { col.push(...opts.colors(li, i)); col.push(...opts.colors(li, (i + 1) % P.length)); }
    });
    g.setColors(col);
  }
  const L = new LineSegments2(g, lineMat({ ...opts, vertexColors: !!opts.colors }));
  if (opts.dashed) L.computeLineDistances();
  L.frustumCulled = false;
  return L;
}
// Replace the polylines of a LineSegments2 in place.
export function setLines(L, polys, closed = false) {
  const pos = linePositions(polys, closed);
  if (!pos.length) { L.visible = false; return; }
  L.visible = true;
  L.geometry.setPositions(pos);
  if (L.material.dashed) L.computeLineDistances();
}

// A glass shell: a faint body and a bright rim where the surface turns
// away from the eye. Double-sided, no depth write, so nested shells read.
export function shellMat({ color = COL.S, opacity = 1, base = 0.05, rim = 0.55, clip = null, side = THREE.DoubleSide } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uBase: { value: base }, uRim: { value: rim } },
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; uniform float uBase; uniform float uRim;
      varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = uBase + uRim * pow(f, 2.2);
        gl_FragColor = vec4(uColor * (0.55 + 0.9 * f), a * uOpacity);
      }`,
    transparent: true, depthWrite: false, side,
  });
  if (clip) { m.clippingPlanes = clip; m.clipping = true; }
  return m;
}

// Round dots, size in CSS px (scaled by the device pixel ratio uniform).
// Per-dot colour and alpha. dots(n) -> THREE.Points with setDot(i, p, rgb, a).
export const DPR = { value: 1 };
export function dots(n, { size = 6, additive = true, depthTest = true, clip = null } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: size }, uDpr: DPR },
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      attribute vec3 color; attribute float alpha; attribute float size;
      uniform float uSize; uniform float uDpr;
      varying vec3 vC; varying float vA;
      void main(){
        vC = color; vA = alpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize * size * uDpr;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      varying vec3 vC; varying float vA;
      void main(){
        #include <clipping_planes_fragment>
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot(q, q);
        if (r > 1.0) discard;
        float core = smoothstep(1.0, 0.55, r);
        gl_FragColor = vec4(vC * (0.7 + 0.6 * (1.0 - r)), vA * core);
      }`,
    transparent: true, depthWrite: false, depthTest, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  if (clip) { m.clippingPlanes = clip; m.clipping = true; }
  const P = new THREE.Points(g, m);
  P.frustumCulled = false;
  P.count = 0;
  P.setDot = (i, p, rgb, a = 1, s = 1) => {
    const pa = g.attributes.position.array, ca = g.attributes.color.array;
    pa[i * 3] = p[0]; pa[i * 3 + 1] = p[1]; pa[i * 3 + 2] = p[2];
    ca[i * 3] = rgb[0]; ca[i * 3 + 1] = rgb[1]; ca[i * 3 + 2] = rgb[2];
    g.attributes.alpha.array[i] = a; g.attributes.size.array[i] = s;
  };
  P.commit = (count) => {
    g.setDrawRange(0, count);
    for (const k of ['position', 'color', 'alpha', 'size']) g.attributes[k].needsUpdate = true;
  };
  return P;
}
export const rgb = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// An instanced arrow field. Unit arrow along +Y from 0 to 1: a shaft and
// a cone head. setArrow places one instance from p along v, length len.
let arrowGeo = null;
function arrowGeometry() {
  if (arrowGeo) return arrowGeo;
  const shaft = new THREE.CylinderGeometry(0.018, 0.018, 0.72, 10, 1, false);
  shaft.translate(0, 0.36, 0);
  const head = new THREE.ConeGeometry(0.065, 0.28, 16, 1, false);
  head.translate(0, 0.86, 0);
  arrowGeo = mergeGeos([shaft, head]);
  return arrowGeo;
}
function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
    const I = g.index.array;
    for (let i = 0; i < I.length; i++) idx[oi + i] = I[i] + ov;
    ov += g.attributes.position.count; oi += I.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
export function arrows(n, { color = COL.E, clip = null, emissive = 0.35, opacity = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: emissive, roughness: 0.45, metalness: 0.1, transparent: opacity < 1, opacity });
  if (clip) { m.clippingPlanes = clip; m.clipping = true; }
  const M = new THREE.InstancedMesh(arrowGeometry(), m, n);
  M.count = 0;
  M.frustumCulled = false;
  return M;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
export function setArrow(M, i, p, v, length, thick = 1) {
  _v.set(v[0], v[1], v[2]);
  const l = _v.length();
  if (l < 1e-9 || length <= 0) { _m.makeScale(0, 0, 0); M.setMatrixAt(i, _m); return; }
  _q.setFromUnitVectors(_y, _v.multiplyScalar(1 / l));
  _s.set(thick, length, thick);
  _p.set(p[0], p[1], p[2]);
  _m.compose(_p, _q, _s);
  M.setMatrixAt(i, _m);
}

// A solid glowing material (tubes, wires, plates).
export function glowMat(color, { emissive = 0.6, rough = 0.35, metal = 0.0, opacity = 1, clip = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: emissive, roughness: rough, metalness: metal, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  if (clip) { m.clippingPlanes = clip; m.clipping = true; }
  return m;
}
export function metalMat(color = '#9aa4b2', { rough = 0.32, metal = 0.85, clip = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal });
  if (clip) { m.clippingPlanes = clip; m.clipping = true; }
  return m;
}

// A charge: a soft glowing sphere with a plus or a minus on it.
export function charge(q, r = 0.075) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), glowMat(COL.Q, { emissive: q > 0 ? 0.9 : 0.35, rough: 0.3 }));
  g.add(s);
  const bar = new THREE.BoxGeometry(r * 1.1, r * 0.22, r * 0.22);
  const ink = new THREE.MeshBasicMaterial({ color: q > 0 ? '#2a0f27' : '#ffe1fa' });
  const h = new THREE.Mesh(bar, ink); h.position.z = r * 0.95; g.add(h);
  if (q > 0) { const v = new THREE.Mesh(bar, ink); v.rotation.z = Math.PI / 2; v.position.z = r * 0.95; g.add(v); }
  g.userData.billboard = true;
  return g;
}

// Dispose a group's geometry and materials.
export function disposeTree(o) {
  o.traverse(c => {
    if (c.geometry && c.geometry !== arrowGeo) c.geometry.dispose();
    if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { LINE_MATS.delete(m); m.dispose(); }); }
  });
}
