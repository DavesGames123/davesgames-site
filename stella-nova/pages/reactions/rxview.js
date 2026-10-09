// ============================================================================
//  REACTIONS  ·  rxview.js — one shared 3D view of a reaction step (three r160)
// ----------------------------------------------------------------------------
//  The page makes ONE RxView and reuses it for every hover, tap, builder
//  preview and saver shot: no new WebGL context per step. It draws a scene
//  of rxanim.js: instanced spheres for the atoms, instanced cylinders for
//  the bonds (two or three thin ones side by side for a double or triple
//  bond), and translucent amber shells round the reaction centre.
//  Bond colours: a bond that breaks is red while it stretches, a bond that
//  forms is green while it grows, the rest are grey. Labels (the product
//  and the by-products: H2O, NaBr) are DOM elements over the canvas.
//  The Molecule Explorer's View3D (molecules/view3d.js) draws one fixed
//  molecule; this view needs atoms that move between molecules and bonds
//  that come and go, so it is its own small class. Colours and radii come
//  from molecules/chem.js (el), the intro from molecules/drawlift.js.
//
//  view.setScene(scene)  view.play(t0)  view.pause()  view.seek(t)
//  view.frame(dt)        advances and draws (call from rAF)
//  view.setRect(r)       frame the subject in a sub-rectangle (saver band)
//  view.still(rec)       a one-molecule still (the step pane)
//  view.thumb(rec, w, h) a still of one molecule that fills a w x h card
//                        (orthographic, longest axis across: treefit.js
//                        principal3 and frameBox). It gives a data URL
//                        and puts the scene that played back in place.
//  view.snapshot(w, h)   the current frame as a data URL
//  view.lite = true      fewer sphere segments (phones)
//
//  GREP MAP
//    grep -n 'setScene('   grep -n 'draw('   grep -n 'snapshot('
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { el, decode } from '../molecules/chem.js';
import { principal3, frameBox } from './treefit.js';

const RED = new THREE.Color('#ff5a4a'), GREEN = new THREE.Color('#5be39a'), GREY = new THREE.Color('#9aa3b5'), INK = new THREE.Color('#f4f1e8');
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class RxView {
  constructor(canvas, opts = {}) {
    this.canvas = canvas; this.labelsEl = opts.labels || null;
    this.lite = !!opts.lite;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lite, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(this.lite ? 1.5 : 2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene3 = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
    this.scene3.add(this.camera);
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-0.6, 0.9, 1); this.camera.add(key, key.target); key.target.position.set(0, 0, -1);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.7); rim.position.set(0.8, -0.3, -0.6); this.camera.add(rim, rim.target); rim.target.position.set(0, 0, -1);
    this.scene3.add(new THREE.HemisphereLight(0xeef2ff, 0x202432, 1.1));
    this.group = new THREE.Group(); this.scene3.add(this.group);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.1, rotateSpeed: 0.85, screenSpacePanning: true, autoRotateSpeed: 1.4 });
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('start', () => { this.userCam = true; });
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.0 });
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false });
    const seg = this.lite ? [14, 10] : [28, 18];
    this.sphereGeo = new THREE.SphereGeometry(1, seg[0], seg[1]);
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, this.lite ? 8 : 14, 1, true).translate(0, 0.5, 0);
    this.S = null; this.t = 0; this.playing = false; this.loop = false; this.rect = null;
    this.camDist = 20; this.camTarget = new THREE.Vector3(); this.userCam = false; this.labelEls = [];
    this.onEnd = null;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }

  // ── scene ────────────────────────────────────────────────────────────────
  setScene(S) {
    this.S = S; this.t = 0; this.userCam = false;
    for (const m of [this.atomMesh, this.bondMesh, this.haloMesh]) if (m) { this.group.remove(m); m.dispose(); }
    const U = S.U, nb = S.bonds.length * 3;
    this.atomMesh = new THREE.InstancedMesh(this.sphereGeo, this.mat, U);
    this.haloMesh = new THREE.InstancedMesh(this.sphereGeo, this.haloMat, Math.max(1, U));
    this.bondMesh = new THREE.InstancedMesh(this.cylGeo, this.mat, Math.max(1, nb));
    for (const m of [this.atomMesh, this.haloMesh, this.bondMesh]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; this.group.add(m); }
    this.atomCol = Array.from(S.z, z => new THREE.Color(el(z).color));
    this.rad = Array.from(S.z, z => 0.27 * el(z).vdw);
    for (let u = 0; u < U; u++) this.atomMesh.setColorAt(u, this.atomCol[u]);
    this.bondMesh.setColorAt(0, GREY);
    this.labelEls.forEach(e => e.remove()); this.labelEls = [];
    this.group.rotation.set(0, 0, 0);
    this.draw(true);
  }
  // a still of one record: a scene with one input and no change
  still(rec, { orient = false } = {}) {
    const M = decode(rec), U = M.N;
    if (orient) M.xyz = principal3(M.xyz, U);
    const bonds = M.bonds.map(b => ({ a: b.a, b: b.b, oR: b.o, oP: b.o, kind: 'keep' }));
    const pos = new Float32Array(3 * U); let c = [0, 0, 0];
    for (let i = 0; i < U; i++) for (let d = 0; d < 3; d++) c[d] += M.xyz[3 * i + d] / U;
    for (let i = 0; i < U; i++) for (let d = 0; d < 3; d++) pos[3 * i + d] = M.xyz[3 * i + d] - c[d];
    const alpha = new Float32Array(bonds.length).fill(1), order = Float32Array.from(bonds, b => b.oR);
    const S = { U, z: M.z, bonds, centre: new Uint8Array(U), T: 1, phases: { t0: 0, tA: 0, tS: 0, tR: 0, tD: 0 }, still: true,
      at: () => ({ pos, alpha, order, ink: 0, morph: 1, reveal: null, phase: 'turn', labels: [] }) };
    this.setScene(S);
  }
  play(t0 = 0) { this.t = t0; this.playing = true; }
  pause() { this.playing = false; }
  seek(t) { this.t = t; this.draw(); }
  setRect(r) { this.rect = r; this.resize(); }

  // ── frame ────────────────────────────────────────────────────────────────
  frame(dt) {
    if (!this.S) return;
    this.resize();
    if (this.playing) {
      this.t += dt;
      if (this.t >= this.S.T) { if (this.loop) this.t = 0; else { this.t = this.S.T; this.playing = false; if (this.onEnd) this.onEnd(); } }
    }
    const turning = this.S.still || this.t >= this.S.phases.tD;
    if (turning && !this.userCam) this.group.rotation.y += dt * 0.35;
    this.controls.update();
    this.draw();
  }
  draw(snap = false) {
    const S = this.S; if (!S) return;
    const f = S.at(this.t), P = f.pos, ink = f.ink;
    // atoms
    const intro = f.phase === 'intro';
    let cx = 0, cy = 0, cz = 0;
    for (let u = 0; u < S.U; u++) { cx += P[3 * u] / S.U; cy += P[3 * u + 1] / S.U; cz += P[3 * u + 2] / S.U; }
    let R = 1;
    for (let u = 0; u < S.U; u++) R = Math.max(R, Math.hypot(P[3 * u] - cx, P[3 * u + 1] - cy, P[3 * u + 2] - cz) + 0.6);
    this.group.position.set(-cx, -cy, -cz);
    // the group turns about the scene centre: shift its pivot
    this.group.position.applyAxisAngle(UP, this.group.rotation.y);
    for (let u = 0; u < S.U; u++) {
      let r = this.rad[u];
      // in the drawing, hydrogens that the formula hides shrink away
      if (ink > 0) r = r * (1 - ink) + (S.z[u] === 1 ? 0.0 : 0.11) * ink;
      if (intro && f.reveal != null && !this.atomShown(u, f)) r = 0;
      _v.set(P[3 * u], P[3 * u + 1], P[3 * u + 2]); _s.setScalar(Math.max(1e-4, r));
      this.atomMesh.setMatrixAt(u, _m.compose(_v, _q.identity(), _s));
      if (ink > 0) this.atomMesh.setColorAt(u, _c.copy(this.atomCol[u]).lerp(INK, ink)); else this.atomMesh.setColorAt(u, this.atomCol[u]);
      const h = S.centre[u] && !intro && f.phase !== 'turn' ? r * 1.9 : 0;
      _s.setScalar(Math.max(1e-4, h));
      this.haloMesh.setMatrixAt(u, _m.compose(_v, _q.identity(), _s));
    }
    this.haloMat.opacity = 0.18 + 0.14 * (0.5 + 0.5 * Math.sin(this.t * 6));
    // bonds
    let n = 0;
    const tS = S.phases.tA, tR = S.phases.tR;
    S.bonds.forEach((b, i) => {
      const a = f.alpha[i]; if (a <= 0.01) return;
      _a.set(P[3 * b.a], P[3 * b.a + 1], P[3 * b.a + 2]); _b.set(P[3 * b.b], P[3 * b.b + 1], P[3 * b.b + 2]);
      const len = _a.distanceTo(_b); if (len < 1e-4) return;
      const o = Math.max(1, Math.round(f.order[i]));
      const w0 = (ink > 0 ? 0.105 * (1 - ink) + 0.05 * ink : 0.105) * (b.kind === 'form' || b.kind === 'break' ? Math.max(0.25, a) : 1);
      const dir = _v.subVectors(_b, _a).normalize();
      _q.setFromUnitVectors(UP, dir);
      // side offset for a double or triple bond: any vector across the bond
      const side = new THREE.Vector3(0, 0, 1).cross(dir); if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(dir); side.normalize();
      let col = GREY;
      if (ink > 0) col = _c.copy(GREY).lerp(INK, ink);
      else if (b.kind === 'break' && this.t > tS - 0.3 && this.t < tR) col = RED;
      else if (b.kind === 'form' && this.t < tR + 1.2) col = GREEN;
      else if (b.kind === 'change' && this.t > tS && this.t < tR + 0.8) col = GREEN;
      const offs = o === 1 ? [0] : o === 2 ? [-0.11, 0.11] : [-0.15, 0, 0.15];
      const w = o === 1 ? w0 : o === 2 ? w0 * 0.68 : w0 * 0.55;
      for (const d of offs) {
        if (n >= this.bondMesh.count) break;
        const p = _s.copy(_a).addScaledVector(side, d);
        this.bondMesh.setMatrixAt(n, _m.compose(p, _q, new THREE.Vector3(w, len, w)));
        this.bondMesh.setColorAt(n, col);
        n++;
      }
    });
    for (let k = n; k < this.bondMesh.count; k++) this.bondMesh.setMatrixAt(k, _m.makeScale(0, 0, 0));
    for (const m of [this.atomMesh, this.haloMesh, this.bondMesh]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // camera: keep the whole scene in view, eased
    const want = R / Math.sin(this.camera.fov * Math.PI / 360) * 1.02;
    this.camDist = snap ? want : this.camDist + (want - this.camDist) * 0.06;
    if (!this.userCam) { this.camera.position.set(0, 0, this.camDist); this.camera.lookAt(0, 0, 0); this.controls.target.set(0, 0, 0); }
    this.camera.near = Math.max(0.05, this.camDist * 0.2); this.camera.far = this.camDist * 4; this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene3, this.camera);
    this.placeLabels(f);
  }
  atomShown(u, f) {
    // an atom shows once a drawn bond reaches it (or it has no bonds)
    const S = this.S;
    if (!S._nb) { S._nb = Array.from({ length: S.U }, () => []); S.bonds.forEach((b, i) => { S._nb[b.a].push(i); S._nb[b.b].push(i); }); }
    const list = S._nb[u];
    if (!list.length) return f.reveal > 0;
    return list.some(i => f.alpha[i] > 0.05);
  }
  placeLabels(f) {
    if (!this.labelsEl) return;
    const L = f.labels || [];
    while (this.labelEls.length < L.length) { const d = document.createElement('div'); d.className = 'l3'; this.labelsEl.appendChild(d); this.labelEls.push(d); }
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.labelEls.forEach((d, i) => {
      const l = L[i];
      if (!l || !l.text || l.alpha <= 0.02) { d.style.opacity = '0'; return; }
      _v.set(l.pos[0], l.pos[1], l.pos[2]); this.group.localToWorld(_v); _v.project(this.camera);
      d.textContent = l.text; d.classList.toggle('main', !!l.main);
      d.style.opacity = String(l.alpha);
      d.style.transform = `translate(${((_v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - _v.y) / 2 * H + 18).toFixed(1)}px) translate(-50%, 0)`;
    });
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const key = w + 'x' + h + JSON.stringify(this.rect);
    if (key === this._rk) return;
    this._rk = key;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const r = this.rect;
    if (r) this.camera.setViewOffset(w, h, w / 2 - (r.x + r.w / 2), h / 2 - (r.y + r.h / 2), w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
  // a still of one molecule framed to fill a w x h card (CSS px); the
  // image has dpr x the pixels. The scene that was playing comes back.
  thumb(rec, w, h, dpr = 2) {
    const prev = this.S ? { S: this.S, t: this.t, playing: this.playing, rot: this.group.rotation.y, userCam: this.userCam } : null;
    this.still(rec, { orient: true });
    // the still scene is centred: the group sits at the origin, unturned
    this.group.rotation.set(0, 0, 0); this.group.position.set(0, 0, 0);
    const f = this.S.at(0), fr = frameBox(f.pos, this.rad, w / h);
    let R = 1; for (let u = 0; u < this.S.U; u++) R = Math.max(R, Math.abs(f.pos[3 * u + 2]) + this.rad[u]);
    const o = this.ortho;
    o.left = -fr.hw; o.right = fr.hw; o.top = fr.hh; o.bottom = -fr.hh; o.near = 0.1; o.far = 4 * R + 10;
    o.position.set(fr.cx, fr.cy, 2 * R + 5); o.lookAt(fr.cx, fr.cy, 0); o.updateProjectionMatrix(); o.updateMatrixWorld();
    // the lights ride on the perspective camera: point it the same way
    const cp = this.camera.position.clone(), cq = this.camera.quaternion.clone();
    this.camera.position.set(0, 0, this.camDist); this.camera.lookAt(0, 0, 0); this.camera.updateMatrixWorld();
    const url = this.snapshot(Math.max(2, Math.round(w * dpr)), Math.max(2, Math.round(h * dpr)), o);
    this.camera.position.copy(cp); this.camera.quaternion.copy(cq); this.camera.updateMatrixWorld();
    if (prev) { this.setScene(prev.S); this.t = prev.t; this.playing = prev.playing; this.group.rotation.y = prev.rot; this.userCam = prev.userCam; this.draw(true); }
    return url;
  }
  snapshot(w = 240, h = 150, cam = this.camera) {
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const asp = this.camera.aspect;
    if (cam === this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0x000000, 0); this.renderer.clear(); this.renderer.render(this.scene3, cam);
    const px = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    this.renderer.setRenderTarget(null); rt.dispose();
    if (cam === this.camera) { this.camera.aspect = asp; this.camera.updateProjectionMatrix(); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  dispose() {
    this.controls.dispose(); this.renderer.dispose();
    for (const g of [this.sphereGeo, this.cylGeo]) g.dispose();
    this.mat.dispose(); this.haloMat.dispose();
  }
}
