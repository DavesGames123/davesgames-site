// ============================================================================
//  MOLECULES  ·  view3d.js — the 3D molecule (three.js r160)
// ────────────────────────────────────────────────────────────────────────────
//  new View3D(canvas, { labels }) draws one chem.js model in one WebGL
//  canvas. The page makes one for the main view and a second one for the
//  compare view, and disposes the second one when compare closes.
//
//  Styles: 'ball' (ball and stick, 0.27 x van der Waals radius), 'space'
//  (van der Waals spheres), 'stick' (licorice), 'wire' (lines). A double
//  or triple bond is two or three thinner cylinders side by side in the
//  plane of a neighbour atom, so no two surfaces coincide. Each bond is
//  two half cylinders in the colours of its atoms.
//  No z-fighting: halos are larger, translucent shells with depthWrite off;
//  labels are DOM elements over the canvas (no depth at all); the 2D ink
//  labels in the saver are sprites with depthTest off.
//
//  The 3D coordinates are turned (Horn quaternion fit, no mirror) to best
//  match the 2D drawing, so both views open in the same orientation.
//  setMorph(t) moves the atoms from the flat drawing (t = 0) to the 3D
//  structure (t = 1); setReveal(k) shows the first k bonds of the drawing
//  order (draw2d.js drawOrder); setInk(v) blends to a thin white drawing.
//
//  grep -n targets
//    fit of 3D to 2D ...... "function hornRotation"
//    geometry build ....... "rebuild()"
//    per-frame matrices ... "updateMatrices()"
//    halos ................ "updateHalos()"
//    picking .............. "pickAt("
//    measurements ......... "measureLabels("
//    export ............... "toGLB(" "toPNG("
//    teardown ............. "dispose()"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { el, placeHydrogens } from './chem.js';
import { drawOrder } from './draw2d.js';

const FLAT = 1.45;      // angstrom per 2D bond length in the flat drawing
const STYLE = {
  ball: { atom: z => 0.27 * el(z).vdw, bond: 0.105, multi: [0.072, 0.115], tri: [0.058, 0.15] },
  stick: { atom: () => 0.172, bond: 0.17, multi: [0.1, 0.12], tri: [0.075, 0.16] },
  space: { atom: z => el(z).vdw, bond: 0, multi: [0, 0], tri: [0, 0] },
  wire: { atom: () => 0.12, bond: 0, multi: [0, 0.09], tri: [0, 0.12] },
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// Rotation (no mirror) that best maps points A onto points B (Horn 1987):
// the top eigenvector of a 4x4 symmetric matrix, by Jacobi sweeps.
export function hornRotation(A, B) {
  let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < A.length; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += A[i][r] * B[i][c];
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += N[p][q] * N[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(N[p][q]) < 1e-15) continue;
      const th = (N[q][q] - N[p][p]) / (2 * N[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const a = N[k][p], b = N[k][q]; N[k][p] = c * a - s * b; N[k][q] = s * a + c * b; }
      for (let k = 0; k < 4; k++) { const a = N[p][k], b = N[q][k]; N[p][k] = c * a - s * b; N[q][k] = s * a + c * b; }
      for (let k = 0; k < 4; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
    }
  }
  let best = 0; for (let k = 1; k < 4; k++) if (N[k][k] > N[best][best]) best = k;
  const [w, x, y, z] = [V[0][best], V[1][best], V[2][best], V[3][best]];
  return new THREE.Quaternion(x, y, z, w).normalize();
}

export class View3D {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.labelsEl = opts.labels || null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pm.fromScene(new RoomEnvironment(this.renderer), 0.04);
    pm.dispose();
    this.scene.environment = this.envRT.texture;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
    this.scene.add(this.camera);
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-0.6, 0.9, 1); this.camera.add(key, key.target); key.target.position.set(0, 0, -1);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.5); rim.position.set(0.8, -0.3, -0.6); this.camera.add(rim, rim.target); rim.target.position.set(0, 0, -1);
    this.scene.add(new THREE.HemisphereLight(0xeef2ff, 0x202432, 0.45));
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.1, rotateSpeed: 0.85, zoomSpeed: 1.0, screenSpacePanning: true, autoRotateSpeed: 1.2 });
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.enabled = opts.interactive !== false;
    this.mat = new THREE.MeshPhysicalMaterial({ roughness: 0.34, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.55 });
    this.haloMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false });
    this.lineMat = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false });
    this.sphereGeo = new THREE.SphereGeometry(1, 36, 22);
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true).translate(0, 0.5, 0);
    this.style = 'ball'; this.showH = true; this.morph = 1; this.reveal = null; this.ink = 0; this.labelMode = 'none';
    this.hl = { hover: null, sel: null, groups: [] };
    this.rect = null; this.M = null; this.dirty = true; this.measure = null;
    this.inkColor = new THREE.Color(0xf4f1e8);
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this._labelPool = [];
  }

  // ── model ────────────────────────────────────────────────────────────────
  setModel(M) {
    this.M = M;
    const N = M.N;
    // flat 2D positions (all atoms; H from the 2D hydrogen layout)
    const h2 = placeHydrogens(M).xy;
    this.flat = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) { this.flat[3 * i] = h2[2 * i] * FLAT; this.flat[3 * i + 1] = -h2[2 * i + 1] * FLAT; this.flat[3 * i + 2] = 0; }
    // 3D, turned to match the drawing (heavy atoms)
    this.real = new Float32Array(3 * N);
    if (M.xyz) {
      const A = [], B = [];
      for (let i = 0; i < M.n; i++) { A.push([M.xyz[3 * i], M.xyz[3 * i + 1], M.xyz[3 * i + 2]]); B.push([this.flat[3 * i], this.flat[3 * i + 1], 0]); }
      let q = new THREE.Quaternion();
      if (M.n >= 3) {
        const ca = A.reduce((s, p) => [s[0] + p[0] / A.length, s[1] + p[1] / A.length, s[2] + p[2] / A.length], [0, 0, 0]);
        const cb = B.reduce((s, p) => [s[0] + p[0] / B.length, s[1] + p[1] / B.length, 0], [0, 0, 0]);
        q = hornRotation(A.map(p => [p[0] - ca[0], p[1] - ca[1], p[2] - ca[2]]), B.map(p => [p[0] - cb[0], p[1] - cb[1], 0]));
      }
      for (let i = 0; i < N; i++) {
        _v.set(M.xyz[3 * i], M.xyz[3 * i + 1], M.xyz[3 * i + 2]).applyQuaternion(q);
        this.real[3 * i] = _v.x; this.real[3 * i + 1] = _v.y; this.real[3 * i + 2] = _v.z;
      }
    } else this.real.set(this.flat);
    // centre both on the 3D centroid of the shown atoms
    for (const P of [this.real, this.flat]) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < N; i++) { cx += P[3 * i]; cy += P[3 * i + 1]; cz += P[3 * i + 2]; }
      cx /= N; cy /= N; cz /= N;
      for (let i = 0; i < N; i++) { P[3 * i] -= cx; P[3 * i + 1] -= cy; P[3 * i + 2] -= cz; }
    }
    this.pos = new Float32Array(3 * N);
    this.measure = null;
    this.rebuild();
    this.fit(true);
  }
  setStyle(s) { if (this.style !== s) { this.style = s; this.rebuild(); this.fit(false); } }
  setShowH(v) { if (this.showH !== v) { this.showH = v; this.rebuild(); } }
  setMorph(t) { this.morph = t; this.dirty = true; }
  setReveal(k) { this.reveal = k; this.dirty = true; }
  setInk(v) { this.ink = v; this.dirty = true; this.paintColors(); this._spritesDirty = true; }
  setSpin(v) { this.controls.autoRotate = v; this.dirty = true; }
  setLabels(mode) { this.labelMode = mode; this.dirty = true; }
  setHighlight(h) { Object.assign(this.hl, h); this.updateHalos(); this.dirty = true; }
  setRect(r) { this.rect = r; this.fit(false); }

  visibleAtom(i) { return this.showH || i < this.M.n; }

  // ── geometry ─────────────────────────────────────────────────────────────
  rebuild() {
    const M = this.M; if (!M) return;
    for (const c of [...this.group.children]) { this.group.remove(c); if (c.geometry && c.geometry !== this.sphereGeo && c.geometry !== this.cylGeo) c.geometry.dispose(); if (c.material && c.material.map) { c.material.map.dispose(); c.material.dispose(); } }
    const st = STYLE[this.style];
    this.atomIdx = []; for (let i = 0; i < M.N; i++) if (this.visibleAtom(i)) this.atomIdx.push(i);
    this.atoms = new THREE.InstancedMesh(this.sphereGeo, this.mat, Math.max(1, this.atomIdx.length));
    this.atoms.count = this.atomIdx.length; this.atoms.frustumCulled = false;
    this.atoms.visible = this.style !== 'wire';
    this.group.add(this.atoms);
    // bond segments: [bond, line offset index, half (0 a side, 1 b side)]
    this.segs = [];
    if (st.bond > 0) for (let k = 0; k < M.bonds.length; k++) {
      const b = M.bonds[k]; if (!this.visibleAtom(b.a) || !this.visibleAtom(b.b)) continue;
      const lines = b.ml ? 1 : b.o === 2 ? 2 : b.o === 3 ? 3 : 1;
      for (let l = 0; l < lines; l++) for (let half = 0; half < 2; half++) this.segs.push([k, l, half, lines]);
    }
    this.bondMesh = new THREE.InstancedMesh(this.cylGeo, this.mat, Math.max(1, this.segs.length));
    this.bondMesh.count = this.segs.length; this.bondMesh.frustumCulled = false;
    this.group.add(this.bondMesh);
    // wire: line segments, two per bond line
    if (this.style === 'wire') {
      let n = 0; for (const b of M.bonds) if (this.visibleAtom(b.a) && this.visibleAtom(b.b)) n += (b.o === 2 ? 2 : b.o === 3 ? 3 : 1) * 2;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      this.wire = new THREE.LineSegments(g, this.lineMat);
      this.wire.frustumCulled = false;
      this.group.add(this.wire);
    } else this.wire = null;
    // halos
    this.halo = new THREE.InstancedMesh(this.sphereGeo, this.haloMat, Math.max(1, M.N * 2 + 8));
    this.haloB = new THREE.InstancedMesh(this.cylGeo, this.haloMat, Math.max(1, M.bonds.length * 2 + 8));
    this.halo.count = 0; this.haloB.count = 0; this.halo.renderOrder = 2; this.haloB.renderOrder = 2;
    // colour buffers from the start, so the first program has instance colours
    this.halo.setColorAt(0, _c.set('#ffffff')); this.haloB.setColorAt(0, _c.set('#ffffff'));
    this.halo.raycast = () => {}; this.haloB.raycast = () => {};
    this.halo.frustumCulled = false; this.haloB.frustumCulled = false;
    this.group.add(this.halo, this.haloB);
    // hydrogen bonds: a row of small dots from the donor H to the acceptor
    this.hbDots = [];
    for (const [d, a] of M.hb || []) {
      let from = d, best = Infinity;
      for (const h of M.hOf[d]) { const q = dist3(M.xyz, h, a); if (q < best) { best = q; from = h; } }
      this.hbDots.push([from, a]);
    }
    this.dots = new THREE.InstancedMesh(this.sphereGeo, this.mat, Math.max(1, this.hbDots.length * 8));
    this.dots.count = this.hbDots.length * 8; this.dots.raycast = () => {}; this.dots.frustumCulled = false;
    this.hbDots.forEach((_, k) => { for (let j = 0; j < 8; j++) this.dots.setColorAt(k * 8 + j, _c.set('#c8ccd8')); });
    this.group.add(this.dots);
    // ink labels (sprites) for the saver drawing
    this.sprites = [];
    for (let i = 0; i < M.n; i++) {
      if (M.z[i] === 6 && !M.q[i]) continue;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(el(M.z[i]).sym + (M.hOf[i].length ? 'H' + (M.hOf[i].length > 1 ? sub(M.hOf[i].length) : '') : '')), depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
      s.renderOrder = 5; s.userData.atom = i; s.visible = false;
      this.group.add(s); this.sprites.push(s);
    }
    this.paintColors();
    this.updateHalos();
    this.dirty = true;
  }
  paintColors() {
    const M = this.M; if (!M || !this.atoms) return;
    const ink = this.ink;
    this.atomIdx.forEach((i, k) => { _c.set(el(M.z[i]).color).lerp(this.inkColor, ink); this.atoms.setColorAt(k, _c); });
    if (this.atoms.instanceColor) this.atoms.instanceColor.needsUpdate = true;
    this.segs.forEach(([b, , half], k) => { const bd = M.bonds[b]; _c.set(el(M.z[half ? bd.b : bd.a]).color).lerp(this.inkColor, ink); this.bondMesh.setColorAt(k, _c); });
    if (this.bondMesh.instanceColor) this.bondMesh.instanceColor.needsUpdate = true;
    this.dirty = true;
  }
  radius(i) {
    const r = STYLE[this.style].atom(this.M.z[i]);
    const ink = this.ink;
    return ink ? r * (1 - ink) + 0.07 * ink : r;
  }
  // current positions (morph between the flat drawing and 3D)
  updatePositions() {
    const t = this.morph, e = t * t * (3 - 2 * t);
    const N = this.M.N, P = this.pos, F = this.flat, R = this.real;
    for (let i = 0; i < 3 * N; i++) P[i] = F[i] + (R[i] - F[i]) * e;
  }
  atomRevealed(i) {
    if (this.reveal == null) return 1;
    return this._atomP ? this._atomP[i] : 1;
  }
  computeReveal() {
    const M = this.M;
    if (this.reveal == null) { this._bondP = null; this._atomP = null; return; }
    const ord = drawOrder(M), bp = new Float32Array(M.bonds.length), ap = new Float32Array(M.N);
    ord.forEach((o, k) => { bp[o.b] = Math.max(0, Math.min(1, this.reveal - k)); });
    if (!ord.length) ap.fill(Math.min(1, this.reveal + 1));
    ord.forEach((o, k) => {
      const b = M.bonds[o.b];
      if (k === 0) ap[o.from] = Math.min(1, this.reveal + 1);
      if (bp[o.b] > 0) ap[o.from] = Math.max(ap[o.from], 1);
      if (bp[o.b] >= 1) ap[o.from === b.a ? b.b : b.a] = 1;
    });
    for (let k = M.nShown; k < M.bonds.length; k++) { const b = M.bonds[k]; bp[k] = ap[b.a]; ap[b.b] = ap[b.a]; }
    this._bondP = bp; this._atomP = ap;
  }
  bondFrame(k) {
    // a unit vector perpendicular to bond k, in the plane of a neighbour
    const M = this.M, b = M.bonds[k], P = this.pos;
    const ax = P[3 * b.a], ay = P[3 * b.a + 1], az = P[3 * b.a + 2];
    const d = new THREE.Vector3(P[3 * b.b] - ax, P[3 * b.b + 1] - ay, P[3 * b.b + 2] - az).normalize();
    let ref = null;
    for (const [c, o] of [[b.a, b.b], [b.b, b.a]]) for (const e of M.nb[c]) {
      if (e.to === o) continue;
      const v = new THREE.Vector3(P[3 * e.to] - P[3 * c], P[3 * e.to + 1] - P[3 * c + 1], P[3 * e.to + 2] - P[3 * c + 2]);
      v.addScaledVector(d, -v.dot(d));
      if (v.lengthSq() > 1e-4) { ref = v.normalize(); break; }
      if (ref) break;
    }
    if (!ref) { ref = new THREE.Vector3(0, 0, 1).cross(d); if (ref.lengthSq() < 1e-4) ref.set(1, 0, 0).cross(d); ref.normalize(); }
    // for a ring bond, point the offset at the ring centre side
    return { d, n: ref };
  }
  updateMatrices() {
    const M = this.M, st = STYLE[this.style], P = this.pos;
    this.updatePositions();
    this.computeReveal();
    const ink = this.ink;
    this.atomIdx.forEach((i, k) => {
      const rv = this.atomRevealed(i);
      const r = this.radius(i) * rv;
      _m.compose(_v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]), _q.identity(), _s.set(r, r, r));
      this.atoms.setMatrixAt(k, _m);
    });
    this.atoms.instanceMatrix.needsUpdate = true;
    this.atoms.boundingSphere = null;      // InstancedMesh caches it for raycasts
    const frames = new Map();
    const fr = k => { if (!frames.has(k)) frames.set(k, this.bondFrame(k)); return frames.get(k); };
    const offsets = (lines, spec) => lines === 1 ? [0] : lines === 2 ? [-spec[1], spec[1]] : [-spec[1] * 1.3, 0, spec[1] * 1.3];
    this.segs.forEach(([k, l, half, lines], s) => {
      const b = M.bonds[k];
      let br = lines === 1 ? st.bond : lines === 2 ? st.multi[0] : st.tri[0];
      if (b.h && this.style === 'ball') br *= 0.85;
      if (b.ml) br *= 0.55;                     // a metal-ligand bond: thinner
      if (ink) br = br * (1 - ink) + 0.035 * ink;
      const off = offsets(lines, lines === 3 ? st.tri : st.multi)[l] * (ink ? 1 - 0.45 * ink : 1);
      const { d, n } = fr(k);
      const a0 = new THREE.Vector3(P[3 * b.a], P[3 * b.a + 1], P[3 * b.a + 2]).addScaledVector(n, off);
      const b0 = new THREE.Vector3(P[3 * b.b], P[3 * b.b + 1], P[3 * b.b + 2]).addScaledVector(n, off);
      let prog = this._bondP ? this._bondP[k] : 1;
      const len = a0.distanceTo(b0);
      // the half on the a side runs a -> mid; the b side mid -> b
      let from, to;
      const mid = a0.clone().lerp(b0, 0.5);
      if (half === 0) { from = a0; to = a0.clone().lerp(b0, Math.min(0.5, prog)); }
      else { from = mid; to = a0.clone().lerp(b0, Math.max(0.5, prog)); if (prog <= 0.5) to = mid.clone(); }
      // reveal draws from the atom that the walk reached first
      const L = from.distanceTo(to);
      if (L < 1e-4 || len < 1e-4) { _m.makeScale(0, 0, 0); this.bondMesh.setMatrixAt(s, _m); return; }
      _q.setFromUnitVectors(UP, _v.copy(to).sub(from).normalize());
      _m.compose(from, _q, _s.set(br, L, br));
      this.bondMesh.setMatrixAt(s, _m);
    });
    this.bondMesh.instanceMatrix.needsUpdate = true;
    this.bondMesh.boundingSphere = null;
    if (this.wire) {
      const pos = this.wire.geometry.attributes.position.array, col = this.wire.geometry.attributes.color.array;
      let w = 0;
      for (let k = 0; k < M.bonds.length; k++) {
        const b = M.bonds[k]; if (!this.visibleAtom(b.a) || !this.visibleAtom(b.b)) continue;
        const lines = b.o === 2 ? 2 : b.o === 3 ? 3 : 1, offs = offsets(lines, lines === 3 ? st.tri : st.multi);
        const { n } = fr(k);
        for (let l = 0; l < lines; l++) {
          const a = [P[3 * b.a] + n.x * offs[l], P[3 * b.a + 1] + n.y * offs[l], P[3 * b.a + 2] + n.z * offs[l]];
          const c = [P[3 * b.b] + n.x * offs[l], P[3 * b.b + 1] + n.y * offs[l], P[3 * b.b + 2] + n.z * offs[l]];
          const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
          for (const [p, q, z] of [[a, m, b.a], [m, c, b.b]]) {
            _c.set(el(M.z[z]).color);
            pos.set(p, w * 3); pos.set(q, w * 3 + 3);
            col.set([_c.r, _c.g, _c.b], w * 3); col.set([_c.r, _c.g, _c.b], w * 3 + 3);
            w += 2;
          }
        }
      }
      this.wire.geometry.attributes.position.needsUpdate = true;
      this.wire.geometry.attributes.color.needsUpdate = true;
      this.wire.geometry.setDrawRange(0, w);
    }
    // ink sprites: the heteroatom labels of the flat drawing
    for (const s of this.sprites) {
      const i = s.userData.atom, a = ink * this.atomRevealed(i);
      s.visible = a > 0.01;
      if (!s.visible) continue;
      s.position.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
      const sc = 0.55; s.scale.set(sc * s.material.map.userData.aspect, sc, 1);
      s.material.opacity = a;
    }
    (this.hbDots || []).forEach(([f, t], k) => {
      for (let j = 0; j < 8; j++) {
        const u = (j + 1) / 9, vis = this.visibleAtom(f) ? 1 : 0;
        _v.set(P[3 * f] + (P[3 * t] - P[3 * f]) * u, P[3 * f + 1] + (P[3 * t + 1] - P[3 * f + 1]) * u, P[3 * f + 2] + (P[3 * t + 2] - P[3 * f + 2]) * u);
        const r = 0.045 * vis * this.atomRevealed(t);
        _m.compose(_v, _q.identity(), _s.set(r, r, r)); this.dots.setMatrixAt(k * 8 + j, _m);
      }
    });
    if (this.dots) this.dots.instanceMatrix.needsUpdate = true;
    this.positionHalos();
  }
  // ── halos ────────────────────────────────────────────────────────────────
  updateHalos() {
    const M = this.M; if (!M || !this.halo) return;
    const items = [], bitems = [];
    for (const g of this.hl.groups || []) { for (const a of g.atoms) items.push([a, g.color, 1.42]); for (const k of bondsWithin(M, g.atoms)) bitems.push([k, g.color]); }
    for (const [h, col, sc] of [[this.hl.sel, '#4f8cff', 1.55], [this.hl.hover, '#ffc23a', 1.6]]) {
      if (!h) continue;
      for (const a of h.atoms || []) items.push([a, col, sc]);
      for (const k of h.bonds || []) bitems.push([k, col]);
    }
    this._haloItems = items.filter(([a]) => this.visibleAtom(a)).slice(0, this.halo.instanceMatrix.count);
    this._haloBItems = bitems.filter(([k]) => this.visibleAtom(M.bonds[k].a) && this.visibleAtom(M.bonds[k].b)).slice(0, this.haloB.instanceMatrix.count);
    this._haloItems.forEach(([, col], k) => this.halo.setColorAt(k, _c.set(col)));
    this._haloBItems.forEach(([, col], k) => this.haloB.setColorAt(k, _c.set(col)));
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
    if (this.haloB.instanceColor) this.haloB.instanceColor.needsUpdate = true;
    this.halo.count = this._haloItems.length; this.haloB.count = this._haloBItems.length;
    this.dirty = true;
  }
  positionHalos() {
    const P = this.pos, M = this.M;
    (this._haloItems || []).forEach(([a, , sc], k) => {
      const r = Math.max(this.radius(a) * (this.style === 'space' ? 1.08 : sc), 0.32);
      _m.compose(_v.set(P[3 * a], P[3 * a + 1], P[3 * a + 2]), _q.identity(), _s.set(r, r, r));
      this.halo.setMatrixAt(k, _m);
    });
    (this._haloBItems || []).forEach(([k], s) => {
      const b = M.bonds[k];
      const from = new THREE.Vector3(P[3 * b.a], P[3 * b.a + 1], P[3 * b.a + 2]), to = new THREE.Vector3(P[3 * b.b], P[3 * b.b + 1], P[3 * b.b + 2]);
      const L = from.distanceTo(to), r = this.style === 'space' ? 0 : 0.27;
      _q.setFromUnitVectors(UP, to.clone().sub(from).normalize());
      _m.compose(from, _q, _s.set(r, L, r));
      this.haloB.setMatrixAt(s, _m);
    });
    this.halo.instanceMatrix.needsUpdate = true; this.haloB.instanceMatrix.needsUpdate = true;
  }

  // ── camera ───────────────────────────────────────────────────────────────
  bounds() {
    const P = this.real, M = this.M;
    let r = 0;
    for (let i = 0; i < M.N; i++) r = Math.max(r, Math.hypot(P[3 * i], P[3 * i + 1], P[3 * i + 2]) + (this.style === 'space' ? el(M.z[i]).vdw : 0.5));
    // the flat drawing can be wider than the 3D structure
    if (this.morph < 1) for (let i = 0; i < M.N; i++) r = Math.max(r, Math.hypot(this.flat[3 * i], this.flat[3 * i + 1]) + 0.5);
    return Math.max(1.2, r);
  }
  fit(resetDir) {
    if (!this.M) return;
    const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1;
    const rect = this.rect || { x: 0, y: 0, w: W, h: H };
    const R = this.bounds();
    const fov = this.camera.fov * Math.PI / 180;
    const aspect = W / H;
    // distance so a sphere of radius R fits the rect (vertical and horizontal)
    const dv = R / Math.sin(fov / 2) / Math.max(0.05, rect.h / H);
    const dh = R / Math.sin(Math.atan(Math.tan(fov / 2) * aspect)) / Math.max(0.05, rect.w / W);
    const dist = Math.max(dv, dh) * 1.04 * (this.zoom || 1);
    const dir = resetDir ? new THREE.Vector3(0, 0, 1) : this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    if (resetDir) this.camera.up.set(0, 1, 0);
    this.camera.near = Math.max(0.05, dist - R * 2.5); this.camera.far = dist + R * 3;
    this.applyOffset();
    this.dirty = true;
  }
  applyOffset() {
    const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1;
    const r = this.rect;
    if (r) this.camera.setViewOffset(W, H, W / 2 - (r.x + r.w / 2), H / 2 - (r.y + r.h / 2), W, H);
    else this.camera.clearViewOffset();
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }
  resize() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (!W || !H) return false;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.round(W * pr) || this.canvas.height !== Math.round(H * pr)) {
      this.renderer.setSize(W, H, false);
      // a new pane size refits the molecule (the direction stays)
      if (this.M) this.fit(false); else this.applyOffset();
      this.dirty = true;
    }
    return true;
  }
  frame(dt = 1 / 60) {
    if (!this.M || this.disposed) return false;
    if (!this.resize()) return false;
    if (this.controls.update(dt)) this.dirty = true;
    if (this.controls.autoRotate) this.dirty = true;
    if (!this.dirty) return false;
    this.dirty = false;
    const dist = this.camera.position.length(), R = this.bounds();
    this.camera.near = Math.max(0.05, dist - R * 2.5); this.camera.far = dist + R * 3; this.camera.updateProjectionMatrix();
    this.updateMatrices();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    return true;
  }

  // ── picking ──────────────────────────────────────────────────────────────
  pickAt(clientX, clientY) {
    if (!this.M) return null;
    const rc = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - rc.left) / rc.width * 2 - 1, -(clientY - rc.top) / rc.height * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const objs = [this.atoms]; if (this.segs.length) objs.push(this.bondMesh);
    let hit = ray.intersectObjects(objs, false)[0];
    if (!hit && this.style === 'wire') {
      // wire: nearest atom within 14 px
      let best = null, bd = 14;
      for (const i of this.atomIdx) { const s = this.screenOf(i); const d = Math.hypot(s.x - (clientX - rc.left), s.y - (clientY - rc.top)); if (d < bd) { bd = d; best = i; } }
      return best == null ? null : { atom: best };
    }
    if (!hit) return null;
    if (hit.object === this.atoms) return { atom: this.atomIdx[hit.instanceId] };
    return { bond: this.segs[hit.instanceId][0] };
  }
  screenOf(i) {
    const P = this.pos;
    _v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).applyMatrix4(this.group.matrixWorld).project(this.camera);
    return { x: (_v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - _v.y) / 2 * this.canvas.clientHeight, z: _v.z };
  }
  // Labels for the hovered atom or bond: lengths of its bonds, and the
  // angles at the atom (at most 4).
  setMeasure(m) { this.measure = m; this.dirty = true; }
  measureLabels() {
    const M = this.M, P = this.real, out = [];
    const m = this.measure; if (!m || this.morph < 0.99) return out;
    const len = (a, b) => Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
    const ang = (a, c, b) => {
      const u = [P[3 * a] - P[3 * c], P[3 * a + 1] - P[3 * c + 1], P[3 * a + 2] - P[3 * c + 2]], v = [P[3 * b] - P[3 * c], P[3 * b + 1] - P[3 * c + 1], P[3 * b + 2] - P[3 * c + 2]];
      const d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
      return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
    };
    if (m.bond != null) {
      const b = M.bonds[m.bond];
      out.push({ at: [b.a, b.b], text: len(b.a, b.b).toFixed(3) + ' Å', cls: 'len' });
    } else if (m.atom != null) {
      const a = m.atom;
      const nbs = M.nb[a].filter(e => this.visibleAtom(e.to)).map(e => e.to);
      for (const t of nbs) out.push({ at: [a, t], text: len(a, t).toFixed(2) + ' Å', cls: 'len' });
      let k = 0;
      for (let i = 0; i < nbs.length && k < 4; i++) for (let j = i + 1; j < nbs.length && k < 4; j++, k++) out.push({ at: [a, nbs[i], nbs[j]], text: ang(nbs[i], a, nbs[j]).toFixed(1) + '°', cls: 'ang' });
    }
    return out;
  }
  placeLabels() {
    const L = this.labelsEl; if (!L) return;
    const M = this.M, items = [];
    if (this.labelMode !== 'none' && this.morph > 0.99 && !this.ink) {
      for (const i of this.atomIdx) {
        if (this.labelMode === 'hetero' && (M.z[i] === 6 || M.z[i] === 1)) continue;
        items.push({ at: [i], text: this.labelMode === 'index' ? el(M.z[i]).sym + (i + 1) : el(M.z[i]).sym, cls: 'el' });
      }
    }
    items.push(...this.measureLabels());
    while (this._labelPool.length < items.length) { const d = document.createElement('div'); L.appendChild(d); this._labelPool.push(d); }
    this._labelPool.forEach((d, k) => {
      const it = items[k];
      if (!it) { d.style.display = 'none'; return; }
      let x = 0, y = 0, z = 0;
      if (it.at.length === 3) {
        // the angle label sits on the bisector, 0.55 of the shorter bond out
        const c = this.screenOf(it.at[0]), a = this.screenOf(it.at[1]), b = this.screenOf(it.at[2]);
        const ux = a.x - c.x, uy = a.y - c.y, vx = b.x - c.x, vy = b.y - c.y;
        const la = Math.hypot(ux, uy) || 1, lb = Math.hypot(vx, vy) || 1;
        let bx = ux / la + vx / lb, by = uy / la + vy / lb; const bl = Math.hypot(bx, by) || 1;
        const r = Math.min(la, lb) * 0.5;
        x = c.x + bx / bl * r; y = c.y + by / bl * r; z = c.z;
      } else {
        for (const i of it.at) { const s = this.screenOf(i); x += s.x / it.at.length; y += s.y / it.at.length; z += s.z / it.at.length; }
      }
      d.style.display = z > 1 ? 'none' : '';
      d.className = 'l3 ' + it.cls;
      if (d.textContent !== it.text) d.textContent = it.text;
      d.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    });
  }

  // ── export ───────────────────────────────────────────────────────────────
  toPNG(scale = 2) {
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(4, pr * scale));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.updateMatrices();
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.dirty = true;
    return url;
  }
  // A binary glTF 2.0 of the current style: one mesh with vertex colours.
  toGLB() {
    this.updateMatrices();
    const pos = [], nor = [], col = [], idx = [];
    const add = (geo, mat4, color) => {
      const p = geo.attributes.position, n = geo.attributes.normal, base = pos.length / 3;
      const nm = new THREE.Matrix3().getNormalMatrix(mat4);
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(mat4); pos.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.push(_v.x, _v.y, _v.z);
        col.push(color.r, color.g, color.b);
      }
      const ix = geo.index; for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    };
    const lo = new THREE.SphereGeometry(1, 20, 14), cyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0);
    const mm = new THREE.Matrix4(), cc = new THREE.Color();
    for (let k = 0; k < this.atoms.count; k++) { this.atoms.getMatrixAt(k, mm); this.atoms.getColorAt(k, cc); add(lo, mm, cc); }
    for (let k = 0; k < this.bondMesh.count; k++) { this.bondMesh.getMatrixAt(k, mm); if (mm.determinant() === 0) continue; this.bondMesh.getColorAt(k, cc); add(cyl, mm, cc); }
    lo.dispose(); cyl.dispose();
    return glb(pos, nor, col, idx, this.M.name);
  }
  dispose() {
    this.disposed = true;
    try {
      for (const c of [...this.group.children]) { if (c.geometry && c.geometry !== this.sphereGeo && c.geometry !== this.cylGeo) c.geometry.dispose(); if (c.material && c.material.map) { c.material.map.dispose(); c.material.dispose(); } }
      this.sphereGeo.dispose(); this.cylGeo.dispose(); this.mat.dispose(); this.haloMat.dispose(); this.lineMat.dispose();
      this.envRT.dispose(); this.controls.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    } catch (e) { /* going away */ }
    if (this.labelsEl) this.labelsEl.textContent = '';
  }
}

const dist3 = (P, a, b) => Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
function bondsWithin(M, atoms) {
  const s = new Set(atoms), out = [];
  for (let k = 0; k < M.bonds.length; k++) if (s.has(M.bonds[k].a) && s.has(M.bonds[k].b)) out.push(k);
  return out;
}
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const sub = n => String(n).split('').map(d => SUBS[+d]).join('');
function labelTexture(text) {
  const c = document.createElement('canvas'), fs = 96;
  const g = c.getContext('2d');
  g.font = `600 ${fs}px Arial, Helvetica, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = fs + 24;
  g.font = `600 ${fs}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(6,7,12,0.85)'; g.beginPath(); g.ellipse(w / 2, c.height / 2, w / 2, c.height / 2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f4f1e8'; g.fillText(text, w / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.userData.aspect = w / c.height;
  return t;
}

// ── GLB writer ──────────────────────────────────────────────────────────────
function glb(pos, nor, col, idx, name) {
  const f32 = a => new Float32Array(a), P = f32(pos), Nn = f32(nor), C = f32(col), I = new Uint32Array(idx);
  const parts = [P, Nn, C, I];
  let off = 0; const views = [];
  for (const a of parts) { views.push({ buffer: 0, byteOffset: off, byteLength: a.byteLength }); off += a.byteLength; off = (off + 3) & ~3; }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  views[0].target = 34962; views[1].target = 34962; views[2].target = 34962; views[3].target = 34963;
  const json = {
    asset: { version: '2.0', generator: 'davesgames.io molecules' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: name || 'molecule' }],
    meshes: [{ name: name || 'molecule', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.4 } }],
    buffers: [{ byteLength: off }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: Nn.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: C.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: I.length, type: 'SCALAR' },
    ],
  };
  const bin = new Uint8Array(off);
  parts.forEach((a, k) => bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), views[k].byteOffset));
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jl = (js.length + 3) & ~3, jsonBuf = new Uint8Array(jl).fill(0x20); jsonBuf.set(js);
  const total = 12 + 8 + jl + 8 + off, out = new DataView(new ArrayBuffer(total));
  out.setUint32(0, 0x46546C67, true); out.setUint32(4, 2, true); out.setUint32(8, total, true);
  out.setUint32(12, jl, true); out.setUint32(16, 0x4E4F534A, true);
  new Uint8Array(out.buffer, 20, jl).set(jsonBuf);
  out.setUint32(20 + jl, off, true); out.setUint32(24 + jl, 0x004E4942, true);
  new Uint8Array(out.buffer, 28 + jl, off).set(bin);
  return new Blob([out.buffer], { type: 'model/gltf-binary' });
}
