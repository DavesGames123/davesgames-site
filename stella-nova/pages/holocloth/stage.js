// ============================================================================
//  THIN-FILM CLOTH  ·  stage.js — renderer, scenes, cloth mesh, bubbles, export
// ----------------------------------------------------------------------------
//  Stage owns the three.js side. The cloth physics runs in the worker
//  (simhost.js); each frame the stage sends one 'step' message and copies
//  the answer into the cloth geometry. The stage never moves a particle
//  itself: grabs, pins and cuts go to the worker as events.
//
//  SCENES (const SCENES)
//    hang    a curtain pinned at its two top corners, in a breeze
//    drape   the cloth falls onto a sphere, a rounded cube or a bust
//    float   no gravity, the cloth turns in slow swirls
//    bubble  soap bubbles (fabric.js bubbleMaterial), no cloth
//
//  FRAMING. setInsets({ l, r, t, b }) gives the part of the screen that
//  the controls (or the screensaver plate) cover. The camera zooms out and
//  shifts its view offset so the subject sits in the clear part.
//
//  GREP MAP
//    grep -n 'export const SCENES'   scene presets and camera homes
//    grep -n 'setScene('             builds the cloth for a scene
//    grep -n 'onSim('                worker answers -> geometry
//    grep -n 'tick('                 one frame
//    grep -n 'pick('                 ray tests for the hand
//    grep -n 'exportPNG'             the high-resolution still
//    grep -n 'setInsets'             framing around the GUI
//    grep -n 'flyTo'                 camera moves (screensaver)
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lightProbe, buildCyc, buildProps, keyDirection, keyColor } from './studio.js';
import { clothMaterial, bubbleMaterial, lutTexture } from './fabric.js';
import { createSim } from './simhost.js';
import { FABRICS } from './xpbd.js';
import { SOAP } from './film.js';

export const SCENES = {
  hang:   { label: 'Hang', plane: 'xy', size: [1.2, 1.2], center: [0, 1.78, 0], pins: 'corners', wind: 3.0, turb: 0.55, gravity: true, cam: { pos: [1.5, 1.3, 3.0], target: [0, 1.15, 0] } },
  drape:  { label: 'Drape', plane: 'xz', size: [1.4, 1.4], prop: true, wind: 0, turb: 0.15, gravity: true, cam: { pos: [1.6, 1.25, 2.3], target: [0, 0.42, 0] } },
  float:  { label: 'Float', plane: 'xz', size: [1.1, 1.1], center: [0, 1.1, 0], tilt: 0.5, wind: 0, turb: 0.9, gravity: false, cam: { pos: [0.8, 1.35, 2.7], target: [0, 1.1, 0] } },
  bubble: { label: 'Bubble', bubble: true, cam: { pos: [0.2, 1.15, 2.5], target: [0, 1.15, 0] } },
};
const LUT_OPTS = { nd: 192, nc: 24, dMax: 1200 };

export class Stage {
  constructor(host, { phone = false } = {}) {
    this.host = host; this.phone = phone;
    this.state = { scene: 'hang', object: 'sphere', fabric: 'foil', d0: null, dv: null, strain: true, overlay: false, gravity: true, wind: 3.0, turb: 0.55, windDir: 20, tearing: false, selfContact: true };
    this.events = []; this.busy = false; this.ready = false; this.luts = {}; this.lutData = {};
    this.insets = { l: 0, r: 0, t: 0, b: 0 };
    this.stats = { ms: 0, err: 0, sim: '' };
    this.time = 0; this.bubbleT = 0; this.flight = null; this.paused = false;
    this.listeners = new Set();
  }
  on(fn) { this.listeners.add(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  async init() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.host.appendChild(r.domElement);
    r.domElement.id = 'gl';
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0.03, 0.028, 0.027);
    const cam = this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
    const ctl = this.controls = new OrbitControls(cam, r.domElement);
    ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.minDistance = 0.6; ctl.maxDistance = 7;
    ctl.maxPolarAngle = 1.5; ctl.minAzimuthAngle = -1.35; ctl.maxAzimuthAngle = 1.35; ctl.screenSpacePanning = true;

    // studio
    this.probe = lightProbe();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromEquirectangular(this.probe.equirect).texture; pm.dispose();
    const key = this.key = new THREE.DirectionalLight(keyColor(), 2.0);
    key.position.copy(keyDirection().multiplyScalar(6)); key.castShadow = true;
    const S = key.shadow; S.mapSize.set(this.phone ? 1024 : 2048, this.phone ? 1024 : 2048);
    Object.assign(S.camera, { left: -2.2, right: 2.2, top: 2.6, bottom: -1.2, near: 1, far: 14 }); S.camera.updateProjectionMatrix();
    S.bias = -0.0004; S.normalBias = 0.02; S.radius = 5;
    scene.add(key);
    scene.add(buildCyc());
    this.props = buildProps();
    for (const p of Object.values(this.props)) { p.group.visible = false; scene.add(p.group); }

    // cloth mesh (the geometry is sized at each setScene)
    this.cloth = new THREE.Mesh(new THREE.BufferGeometry(), null);
    this.cloth.castShadow = true; this.cloth.frustumCulled = false;
    scene.add(this.cloth);
    // pins: small brass beads
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.3 }), 96);
    this.beads.count = 0; this.beads.frustumCulled = false; scene.add(this.beads);
    this.pinIds = new Int32Array(0);

    // the worker and the first film tables
    this.sim = createSim();
    this.sim.onmessage = m => this.onSim(m);
    this.sim.onfallback = () => { this.stats.sim = 'page thread'; this.emit({ type: 'sim' }); };
    this.stats.sim = this.sim.kind;
    await Promise.all([this.lut(this.state.fabric), this.lut('soap')]);
    this.material = clothMaterial(this.probe, this.luts[this.state.fabric]);
    this.cloth.material = this.material;
    this.cloth.customDepthMaterial = undefined;
    this.buildBubbles();
    this.raycaster = new THREE.Raycaster();
    this.setScene(this.state.scene);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.ready = true;
  }

  // A film table from the worker, cached by key ('soap' or a fabric key).
  lut(key) {
    if (this.luts[key]) return Promise.resolve(this.luts[key]);
    if (this.lutWait && this.lutWait[key]) return this.lutWait[key];
    this.lutWait = this.lutWait || {};
    const film = key === 'soap' ? SOAP : FABRICS[key].film;
    return (this.lutWait[key] = new Promise(res => {
      (this.lutRes = this.lutRes || {})[key] = res;
      this.sim.post({ op: 'lut', key, film: { n: film.n, sub: film.sub }, opts: LUT_OPTS });
    }));
  }

  onSim(m) {
    if (m.op === 'lut') {
      this.lutData[m.key] = m.lut; this.luts[m.key] = lutTexture(m.lut);
      const res = this.lutRes && this.lutRes[m.key]; if (res) res(this.luts[m.key]);
      return;
    }
    if (m.op !== 'frame') return;
    this.busy = false;
    if (m.gen !== undefined && m.gen !== this.gen) return;
    const g = this.cloth.geometry, A = g.attributes;
    if (!A.position || A.position.count * 3 !== m.x.length) return;
    A.position.array.set(m.x); A.normal.array.set(m.nrm); A.aTan.array.set(m.tan); A.aRatio.array.set(m.ratio);
    A.position.needsUpdate = A.normal.needsUpdate = A.aTan.needsUpdate = A.aRatio.needsUpdate = true;
    if (m.tris) g.setIndex(new THREE.BufferAttribute(m.tris, 1));
    if (m.pins) this.pinIds = m.pins;
    g.computeBoundingSphere();
    this.stats.ms = m.ms; this.stats.err = m.err;
    this.lastX = m.x;
    this.placeBeads();
  }

  placeBeads() {
    const X = this.lastX; if (!X) return;
    const M = new THREE.Matrix4(), n = Math.min(this.pinIds.length, 96);
    for (let i = 0; i < n; i++) { const k = 3 * this.pinIds[i]; M.makeTranslation(X[k], X[k + 1], X[k + 2]); this.beads.setMatrixAt(i, M); }
    this.beads.count = n; this.beads.instanceMatrix.needsUpdate = true;
  }

  // ── scenes ───────────────────────────────────────────────────────────────
  setScene(key, opts = {}) {
    const st = this.state; st.scene = key;
    if (opts.object) st.object = opts.object;
    const sc = SCENES[key];
    if (!opts.keepAir) { st.wind = sc.wind ?? 0; st.turb = sc.turb ?? 0; st.gravity = sc.gravity ?? true; }
    for (const [k, p] of Object.entries(this.props)) p.group.visible = !!sc.prop && k === st.object;
    this.bubbles.visible = !!sc.bubble;
    this.cloth.visible = !sc.bubble;
    this.beads.visible = !sc.bubble;
    if (!opts.keepCamera) this.home(0);
    if (sc.bubble) { this.emit({ type: 'scene' }); return; }
    const nx = this.phone ? 34 : 44, ny = nx;
    const prop = sc.prop ? this.props[st.object] : null;
    const center = sc.center || [0, (prop ? prop.top : 0.6) + 0.32, 0];
    const pins = sc.pins === 'corners' ? [0, nx - 1] : [];
    this.gen = (this.gen || 0) + 1;
    this.makeGeometry(nx, ny);
    this.busy = false; this.events = [];
    this.sim.post({ op: 'init', cfg: {
      nx, ny, size: sc.size, center, plane: sc.plane, fabric: st.fabric, gravity: st.gravity ? -9.81 : 0,
      colliders: prop ? prop.colliders : [], selfContact: st.selfContact, substeps: this.phone ? 8 : 10, pins, tilt: sc.tilt || (prop ? 0.04 : 0),
    } });
    this.busy = true;
    this.applyFilm();
    this.emit({ type: 'scene' });
  }
  makeGeometry(nx, ny) {
    const n = nx * ny, g = new THREE.BufferGeometry();
    const uv = new Float32Array(2 * n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; uv[2 * k] = i / (nx - 1); uv[2 * k + 1] = 1 - j / (ny - 1); }
    const dyn = (a, s) => new THREE.BufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(new Float32Array(3 * n), 3));
    g.setAttribute('normal', dyn(new Float32Array(3 * n), 3));
    g.setAttribute('aTan', dyn(new Float32Array(3 * n), 3));
    g.setAttribute('aRatio', dyn(new Float32Array(n).fill(1), 1));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.cloth.geometry.dispose(); this.cloth.geometry = g;
    this.pinIds = new Int32Array(0); this.beads.count = 0; this.lastX = null;
  }
  setObject(key) { this.state.object = key; if (this.state.scene === 'drape') this.setScene('drape', { keepAir: true, keepCamera: true }); }
  async setFabric(key) {
    this.state.fabric = key; this.state.d0 = null; this.state.dv = null;
    this.events.push(['fabric', key]);
    await this.lut(key);
    this.material.uniforms.uLut.value = this.luts[key];
    this.applyFilm();
    this.emit({ type: 'fabric' });
  }
  // Film uniforms from the fabric, with the user's overrides.
  applyFilm() {
    const f = FABRICS[this.state.fabric], u = this.material.uniforms, st = this.state;
    u.uD0.value = st.d0 ?? f.film.d0; u.uDv.value = st.dv ?? f.film.dv;
    u.uStrain.value = st.strain ? 1 : 0; u.uOverlay.value = st.overlay ? 1 : 0;
    u.uRough.value.set(f.rough[0], f.rough[1]); u.uTint.value.setRGB(...f.tint);
    for (const m of this.bubbleMats || []) m.uniforms.uOverlay.value = st.overlay ? 1 : 0;
  }
  film() { const f = FABRICS[this.state.fabric]; return { d0: this.state.d0 ?? f.film.d0, dv: this.state.dv ?? f.film.dv, n: f.film.n, sub: f.film.sub }; }
  reset() { this.setScene(this.state.scene, { keepAir: true, keepCamera: true }); }

  // ── bubbles ──────────────────────────────────────────────────────────────
  buildBubbles() {
    const g = this.bubbles = new THREE.Group(); g.visible = false;
    const geo = new THREE.SphereGeometry(1, 96, 64);
    this.bubbleMats = [];
    this.bubbleList = [[0, 1.15, 0, 0.42, 0.0], [-0.72, 1.55, -0.55, 0.17, 2.1], [0.66, 0.78, -0.3, 0.12, 4.2]].map(([x, y, z, r, ph]) => {
      const b = new THREE.Group(); b.position.set(x, y, z); b.scale.setScalar(r);
      const back = new THREE.Mesh(geo, bubbleMaterial(this.probe, this.luts.soap, THREE.BackSide));
      const front = new THREE.Mesh(geo, bubbleMaterial(this.probe, this.luts.soap, THREE.FrontSide));
      back.renderOrder = 1; front.renderOrder = 2; b.add(back, front);
      this.bubbleMats.push(back.material, front.material);
      g.add(b);
      return { group: b, home: new THREE.Vector3(x, y, z), r, ph, mats: [back.material, front.material], poke: 0 };
    });
    this.scene.add(g);
  }
  poke(i, dirWorld) {
    const b = this.bubbleList[i]; if (!b) return;
    b.poke = 1; const d = dirWorld.clone().normalize();
    for (const m of b.mats) m.uniforms.uPokeDir.value.copy(d);
  }

  // ── hand API (events to the worker) ─────────────────────────────────────
  grab(p, radius) { this.events.push(['grab', p.x, p.y, p.z, radius || (this.phone ? 0.07 : 0.055)]); }
  grabMove(p) { this.events.push(['move', p.x, p.y, p.z]); }
  drop() { this.events.push(['drop']); }
  pinAt(p) { this.events.push(['pin', p.x, p.y, p.z]); }
  cutAt(p) { this.events.push(['cut', p.x, p.y, p.z]); }
  clearPins() { this.events.push(['clearPins']); }

  // Ray test at a point in normalised device coordinates.
  pick(ndc) {
    const rc = this.raycaster; rc.setFromCamera(ndc, this.camera);
    if (this.bubbles.visible) {
      const hits = rc.intersectObjects(this.bubbleList.map(b => b.group.children[1]), false);
      if (hits.length) return { kind: 'bubble', point: hits[0].point, index: this.bubbleList.findIndex(b => b.group.children[1] === hits[0].object), ray: rc.ray.direction.clone() };
      return null;
    }
    if (!this.cloth.visible || !this.cloth.geometry.index) return null;
    const hits = rc.intersectObject(this.cloth, false);
    return hits.length ? { kind: 'cloth', point: hits[0].point.clone() } : null;
  }

  // ── frame ────────────────────────────────────────────────────────────────
  tick(dt) {
    if (!this.ready) return;
    dt = Math.min(1 / 30, Math.max(1 / 240, dt));
    this.time += dt;
    const st = this.state, sc = SCENES[st.scene];
    if (!sc.bubble && !this.busy && !this.paused) {
      const a = st.windDir * Math.PI / 180;
      this.busy = true;
      this.sim.post({ op: 'step', dt, gravity: st.gravity ? -9.81 : 0, tearing: st.tearing, wind: { speed: st.wind, dir: [Math.sin(a), 0, Math.cos(a)], turb: st.turb }, events: this.events });
      this.events = [];
    }
    this.material.uniforms.uTime.value = this.time;
    if (sc.bubble) this.tickBubbles(dt);
    this.tickFlight(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  tickBubbles(dt) {
    this.bubbleT += dt;
    const t = this.bubbleT;
    for (const b of this.bubbleList) {
      b.poke = Math.max(0, b.poke - dt * 0.9);
      const p = b.group.position;
      p.set(b.home.x + 0.06 * Math.sin(0.31 * t + b.ph), b.home.y + 0.05 * Math.sin(0.47 * t + 1.3 * b.ph), b.home.z + 0.04 * Math.cos(0.23 * t + b.ph));
      b.group.rotation.y = 0.05 * t + b.ph;
      // the film drains over about a minute, then starts over
      const age = ((t + 17 * b.ph) / 70) % 1;
      for (const m of b.mats) { m.uniforms.uTime.value = t + b.ph * 10; m.uniforms.uAge.value = age; m.uniforms.uPoke.value = b.poke; }
    }
  }

  // ── camera ───────────────────────────────────────────────────────────────
  home(seconds = 0.9) { const c = SCENES[this.state.scene].cam; this.flyTo(c.pos, c.target, seconds); }
  // Ease the camera to a position and target over some seconds (0 = cut).
  flyTo(pos, target, seconds = 1) {
    const P = new THREE.Vector3(...pos), T = new THREE.Vector3(...target);
    if (seconds <= 0) { this.camera.position.copy(P); this.controls.target.copy(T); this.flight = null; this.controls.update(); return; }
    this.flight = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: P, t1: T, s: 0, d: seconds };
  }
  tickFlight(dt) {
    const f = this.flight; if (!f) return;
    f.s = Math.min(1, f.s + dt / f.d);
    const e = f.s * f.s * (3 - 2 * f.s);
    this.camera.position.lerpVectors(f.p0, f.p1, e); this.controls.target.lerpVectors(f.t0, f.t1, e);
    if (f.s >= 1) this.flight = null;
  }

  // ── framing around the GUI ─────────────────────────────────────────────
  setInsets(ins) { this.insets = { l: 0, r: 0, t: 0, b: 0, ...ins }; this.resize(); }
  resize() {
    const W = this.host.clientWidth || window.innerWidth, H = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(W, H, false);
    this.renderer.domElement.style.width = W + 'px'; this.renderer.domElement.style.height = H + 'px';
    const c = this.camera, I = this.insets;
    c.aspect = W / H;
    const cw = Math.max(80, W - I.l - I.r), ch = Math.max(80, H - I.t - I.b);
    // zoom out until the subject fits the clear box, then centre it there
    c.zoom = Math.min(1, Math.min(cw / W, ch / H) * 1.04);
    const sx = (I.l - I.r) / 2, sy = (I.t - I.b) / 2;
    if (sx || sy) c.setViewOffset(W, H, -sx, -sy, W, H); else c.clearViewOffset();
    c.updateProjectionMatrix();
  }

  // ── print on the cloth ─────────────────────────────────────────────────
  // src: an image or canvas (null removes). The print is fitted into a
  // square, centred, scale 0..1 of the cloth width.
  setPrint(src, scale = 0.6) {
    const u = this.material.uniforms;
    if (!src) { u.uPrintOn.value = 0; return; }
    const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, k = S / Math.max(w, h);
    g.drawImage(src, (S - w * k) / 2, (S - h * k) / 2, w * k, h * k);
    if (u.uPrint.value) u.uPrint.value.dispose();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    u.uPrint.value = t; u.uPrintOn.value = 1; u.uPrintRect.value.set(0.5, 0.5, scale, scale);
  }
  setPrintScale(s) { this.material.uniforms.uPrintRect.value.z = s; this.material.uniforms.uPrintRect.value.w = s; }

  // ── PNG export ────────────────────────────────────────────────────────
  // Renders one frame at a higher pixel ratio (long side up to `long` px,
  // capped by the GPU), reads the canvas, then restores the size.
  exportPNG(long = 3600) {
    const r = this.renderer, W = this.host.clientWidth, H = this.host.clientHeight;
    const max = Math.min(r.capabilities.maxTextureSize, 8192);
    const pr0 = r.getPixelRatio(), pr = Math.min(long, max) / Math.max(W, H);
    r.setPixelRatio(pr); r.setSize(W, H, false);
    this.renderer.domElement.style.width = W + 'px'; this.renderer.domElement.style.height = H + 'px';
    r.render(this.scene, this.camera);
    const p = new Promise(res => r.domElement.toBlob(b => res(b), 'image/png'));
    r.setPixelRatio(pr0); this.resize();
    return p.then(b => ({ blob: b, width: Math.round(W * pr), height: Math.round(H * pr) }));
  }

  // Interference colours at normal incidence, 0..dMax nm (for the legend).
  filmStrip(key = this.state.fabric) {
    const L = this.lutData[key]; if (!L) return null;
    const row = (L.nc - 1) * L.nd * 4;
    const out = [];
    for (let i = 0; i < L.nd; i++) out.push([L.data[row + 4 * i], L.data[row + 4 * i + 1], L.data[row + 4 * i + 2]]);
    return { colors: out, dMax: L.dMax };
  }
}
