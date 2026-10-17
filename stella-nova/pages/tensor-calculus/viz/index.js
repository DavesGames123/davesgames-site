// ============================================================================
//  TENSOR CALCULUS  ·  viz/index.js  ·  the 3D view  (VIZ package)
// ----------------------------------------------------------------------------
//  createViz(canvas, opts) -> api          (three r160, importmap 'three')
//
//  PUBLIC API  (CONTRACT.md "VIZ API")
//    setScene(id, params)  show scene id with params (see SCENE_IDS and
//                          sceneInfo(id).params). Leaves step mode. The
//                          camera glides to the scene camera.
//    play(step, t)         draw an OpTrace Step at progress t in 0..1.
//                          stepScene(step) picks the scene; the scene reads
//                          step.numeric, so the numbers are the trace's.
//    setTime(s)            set the scene clock (seconds). With
//                          opts.externalClock the clock moves only here.
//    resize()              read the canvas CSS size again
//    pickIndex(sym)        the Indices lens: sym bright, the rest faded.
//                          null clears it.
//    scenes                the scene ids (SCENE_IDS), menu order
//    saverShots            [{ scene, params, camera, seconds, label }],
//                          calm wide shots for SAVER (shots.js)
//    dispose()             stop and free the GPU and DOM objects
//  EXTRAS
//    setParams(p)          merge params into the current scene
//    setCamera(cam, ms)    { pos, target, fov, orbit }; ms = glide time
//    setShot(shot, ms)     a saverShots item: scene, params and camera
//    setOrbit(degPerSec)   slow auto orbit (0 stops it)
//    setSpeed(k)           clock speed for the internal clock
//    setViewOffset(x, y)   shift the picture (CSS px), for saver framing
//    sceneInfo(id)         { id, label, blurb, params, camera }
//    state()               { scene, params, time, t, pick, step kind }
//    readouts()            the numbers the scene shows (pairing, angles..)
//    on('readout', fn)     fn(reads) once per frame; returns an off()
//    render()              draw one frame now
//    start() / stop()      the internal animation loop
//
//  OPTIONS  { labelHost: element for the HTML labels (default: parent of
//    the canvas), coarse: touch profile (default: (pointer:coarse)),
//    autoStart: true, externalClock: false, speed: 1, scene, params,
//    bloom: true on desktop, orbit: 0 }
//
//  PIPELINE  Each frame the scene writes a display list (dl.js): lit
//  opaque triangles, lit see-through triangles, thick lines and labels.
//  The three typed arrays go to the GPU as interleaved buffers with no
//  copy (InterleavedBuffer on the DL array). Lines are instanced quads in
//  screen space, with an anti-aliased edge and the scene fog (LINE_VS,
//  LINE_FS). Labels are HTML in an overlay, placed by projection.
//  Desktop: an EffectComposer with an MSAA target, a weak bloom and
//  OutputPass. Touch: direct render with antialias, no bloom.
//
//  grep -n targets: "export function createViz", "LINE_VS", "LINE_FS",
//    "function syncTris", "function syncLines", "function placeLabels",
//    "function frame(", "function setScene", "function play(", "CSS ="
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DL } from './dl.js';
import { SCENES, SCENE_IDS, frameScene, paramsFor, sceneInfo } from './registry.js';
import { SAVER_SHOTS } from './shots.js';
import { stepScene } from './trace-map.js';
import { LOOK } from './look.js';

export { SCENE_IDS, SAVER_SHOTS, sceneInfo, stepScene };

export const LINE_VS = /* glsl */`
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aC;
attribute float aW;
uniform vec2 uRes;
uniform float uPR;
varying vec4 vC;
varying float vY;
varying float vHw;
varying float vDepth;
void main() {
  vec4 a = modelViewMatrix * vec4(aA, 1.0);
  vec4 b = modelViewMatrix * vec4(aB, 1.0);
  float nz = -0.02;
  if (a.z > nz && b.z > nz) { gl_Position = vec4(4.0, 4.0, 4.0, 1.0); return; }
  if (a.z > nz) a = mix(a, b, (a.z - nz) / (a.z - b.z));
  if (b.z > nz) b = mix(b, a, (b.z - nz) / (b.z - a.z));
  vec4 ca = projectionMatrix * a;
  vec4 cb = projectionMatrix * b;
  vec2 sa = ca.xy / ca.w * 0.5 * uRes;
  vec2 sb = cb.xy / cb.w * 0.5 * uRes;
  vec2 d = sb - sa;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = 0.5 * aW * uPR;
  float ext = hw + 1.0;
  bool atB = position.x > 0.5;
  vec4 c = atB ? cb : ca;
  vec2 off = nrm * position.y * ext + dir * (atB ? 1.0 : -1.0) * min(hw, 0.5 * L + 0.5);
  c.xy += off * 2.0 / uRes * c.w;
  gl_Position = c;
  vC = aC;
  vY = position.y * ext;
  vHw = hw;
  vDepth = -(atB ? b.z : a.z);
}`;

export const LINE_FS = /* glsl */`
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec4 vC;
varying float vY;
varying float vHw;
varying float vDepth;
void main() {
  float hw = max(vHw, 0.5);
  float cov = clamp(hw + 0.5 - abs(vY), 0.0, 1.0) * min(1.0, vHw * 2.0);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(mix(vC.rgb, uFogColor, f), vC.a * cov);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CSS = `
.tc-viz-labels{position:absolute;pointer-events:none;overflow:hidden;z-index:2;font-family:'STIX Two Text',Georgia,serif;contain:strict}
.tc-vl{position:absolute;left:0;top:0;white-space:nowrap;line-height:1.1;will-change:transform;
  text-shadow:0 0 3px #05060a,0 0 6px #05060a,0 0 10px rgba(5,6,10,.8);font-variant-numeric:tabular-nums}
.tc-vl.hi{font-weight:600}
.tc-vl sup,.tc-vl sub{font-size:.72em;line-height:0}
.tc-vl .tc-ud{display:inline-flex;flex-direction:column;vertical-align:middle;font-size:.72em;line-height:1.05;margin-left:.05em}
.tc-vl .tc-ud sup,.tc-vl .tc-ud sub{font-size:1em;vertical-align:baseline;line-height:1.05}
.tc-vl .tc-mat{display:inline-flex;align-items:center;gap:.25em}
.tc-vl .tc-mat-n{margin-right:.3em}
.tc-vl .tc-br{font-size:2.4em;font-weight:200;opacity:.75;transform:scaleX(.6)}
.tc-vl .tc-grid2,.tc-vl .tc-grid3,.tc-vl .tc-grid4{display:inline-grid;column-gap:.7em;row-gap:.05em;text-align:right}
.tc-vl .tc-grid2{grid-template-columns:repeat(2,auto)}
.tc-vl .tc-grid3{grid-template-columns:repeat(3,auto)}
.tc-vl .tc-grid4{grid-template-columns:repeat(4,auto)}
.tc-vl .tc-note{font-family:Inter,system-ui,sans-serif;font-size:.78em;opacity:.8}
`;

function injectCSS(doc) {
  if (doc.getElementById('tc-viz-css')) return;
  const s = doc.createElement('style');
  s.id = 'tc-viz-css'; s.textContent = CSS;
  doc.head.appendChild(s);
}

export function createViz(canvas, opts = {}) {
  const doc = canvas.ownerDocument || document;
  const win = doc.defaultView || window;
  const coarse = opts.coarse ?? !!(win.matchMedia && win.matchMedia('(pointer:coarse)').matches);
  const useBloom = opts.bloom ?? !coarse;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !useBloom, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(LOOK.fog, 0.035);
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.05, 200);

  // background: a vertical gradient
  {
    const c = doc.createElement('canvas'); c.width = 2; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, LOOK.bg[0]); gr.addColorStop(1, LOOK.bg[1]);
    g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  }
  // soft light: sky and floor, a key light, a rim light, a room environment
  scene.add(new THREE.HemisphereLight(0xc8d6ff, 0x1a1c28, 0.9));
  const key = new THREE.DirectionalLight(0xfff2e0, 1.6); key.position.set(-4, 8, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.6); rim.position.set(5, 3, -6); scene.add(rim);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.06, envMapIntensity: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.0, envMapIntensity: 0.35,
    transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const lineMat = new THREE.ShaderMaterial({
    vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false,
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uPR: { value: 1 }, uFogColor: { value: new THREE.Color(LOOK.fog) }, uFogDensity: { value: 0.035 } },
  });

  const dl = new DL();
  dl.lineScale = coarse ? 1.25 : 1;

  // ---- triangle batches: one interleaved buffer on the DL array
  function triMesh(mat, order) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    m.frustumCulled = false; m.renderOrder = order; scene.add(m);
    return { mesh: m, arr: null, ib: null };
  }
  const solid = triMesh(solidMat, 0), glass = triMesh(glassMat, 1);
  function syncTris(T, buf) {
    if (T.arr !== buf.a) {
      T.mesh.geometry.dispose();
      const g = new THREE.BufferGeometry();
      const ib = new THREE.InterleavedBuffer(buf.a, 10).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      g.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
      g.setAttribute('color', new THREE.InterleavedBufferAttribute(ib, 4, 6));
      T.mesh.geometry = g; T.arr = buf.a; T.ib = ib;
    }
    const ib = T.ib;
    if (ib.clearUpdateRanges) { ib.clearUpdateRanges(); ib.addUpdateRange(0, Math.max(10, buf.n * 10)); }
    ib.needsUpdate = true;
    T.mesh.geometry.setDrawRange(0, buf.n);
    T.mesh.visible = buf.n > 0;
  }

  // ---- lines: instanced quads, one instance per segment
  const lineQuad = new THREE.InstancedBufferGeometry();
  lineQuad.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  lineQuad.setIndex([0, 1, 2, 0, 2, 3]);
  const lines = { mesh: new THREE.Mesh(lineQuad, lineMat), arr: null, ib: null };
  lines.mesh.frustumCulled = false; lines.mesh.renderOrder = 2; scene.add(lines.mesh);
  function syncLines(buf) {
    const g = lines.mesh.geometry;
    if (lines.arr !== buf.a) {
      const ib = new THREE.InstancedInterleavedBuffer(buf.a, 11).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aA', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      g.setAttribute('aB', new THREE.InterleavedBufferAttribute(ib, 3, 3));
      g.setAttribute('aC', new THREE.InterleavedBufferAttribute(ib, 4, 6));
      g.setAttribute('aW', new THREE.InterleavedBufferAttribute(ib, 1, 10));
      if (lines.ib) lines.mesh.geometry.dispose();
      lines.arr = buf.a; lines.ib = ib;
    }
    const ib = lines.ib;
    if (ib.clearUpdateRanges) { ib.clearUpdateRanges(); ib.addUpdateRange(0, Math.max(11, buf.n * 11)); }
    ib.needsUpdate = true;
    g.instanceCount = buf.n;
    lines.mesh.visible = buf.n > 0;
  }

  // ---- labels: an HTML overlay over the canvas
  injectCSS(doc);
  const host = opts.labelHost || canvas.parentElement || doc.body;
  if (host !== doc.body && win.getComputedStyle && win.getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const overlay = doc.createElement('div');
  overlay.className = 'tc-viz-labels';
  overlay.setAttribute('aria-hidden', 'true');
  host.appendChild(overlay);
  const pool = [];
  const v3 = new THREE.Vector3();
  function placeLabels(list) {
    const w = view.w, h = view.h;
    for (let i = 0; i < list.length; i++) {
      const L = list[i];
      let el = pool[i];
      if (!el) { el = doc.createElement('div'); el.className = 'tc-vl'; overlay.appendChild(el); pool[i] = el; el._h = el._c = el._s = el._a = el._cl = null; }
      let x, y, ok = true;
      if (L.screen) { x = L.screen[0] * w; y = L.screen[1] * h; }
      else {
        v3.set(L.p[0], L.p[1], L.p[2]).project(camera);
        ok = v3.z < 1 && v3.z > -1;
        x = (v3.x * 0.5 + 0.5) * w; y = (0.5 - v3.y * 0.5) * h;
      }
      if (el._h !== L.html) { el.innerHTML = L.html; el._h = L.html; }
      const c = L.c || '#eceef2';
      if (el._c !== c) { el.style.color = c; el._c = c; }
      if (el._s !== L.size) { el.style.fontSize = L.size + 'px'; el._s = L.size; }
      const a = ok ? L.a : 0;
      if (el._a !== a) { el.style.opacity = a; el._a = a; }
      const cl = 'tc-vl' + (L.hi ? ' hi' : '') + (L.cls ? ' ' + L.cls : '');
      if (el._cl !== cl) { el.className = cl; el._cl = cl; }
      const ax = L.anchor === 'l' ? '0' : L.anchor === 'r' ? '-100%' : '-50%';
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(${ax},-50%)`;
      el.style.display = '';
    }
    for (let i = list.length; i < pool.length; i++) if (pool[i].style.display !== 'none') pool[i].style.display = 'none';
  }

  // ---- post
  let composer = null, bloom = null;
  if (useBloom) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.28, 0.5, 0.88);
    const bloomSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w, h) => bloomSize(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ---- camera and controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8; controls.panSpeed = 0.7;
  controls.minDistance = 1.2; controls.maxDistance = 40;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.autoRotateSpeed = 0;
  let glide = null;
  controls.addEventListener('start', () => { glide = null; });

  function setCamera(cam, ms = 1200) {
    if (!cam) return;
    const to = { pos: new THREE.Vector3(...cam.pos), target: new THREE.Vector3(...cam.target), fov: cam.fov ?? camera.fov };
    if (cam.orbit != null) setOrbit(cam.orbit);
    if (!ms) { camera.position.copy(to.pos); controls.target.copy(to.target); camera.fov = to.fov; camera.updateProjectionMatrix(); glide = null; return; }
    glide = { t0: performance.now(), ms, from: { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov }, to };
  }
  function stepGlide(now) {
    if (!glide) return;
    let u = Math.min(1, (now - glide.t0) / glide.ms);
    u = u * u * (3 - 2 * u);
    camera.position.lerpVectors(glide.from.pos, glide.to.pos, u);
    controls.target.lerpVectors(glide.from.target, glide.to.target, u);
    camera.fov = glide.from.fov + (glide.to.fov - glide.from.fov) * u;
    camera.updateProjectionMatrix();
    if (u >= 1) glide = null;
  }
  function setOrbit(degPerSec) {
    controls.autoRotate = !!degPerSec;
    controls.autoRotateSpeed = (degPerSec || 0) / 6;   // three: 2.0 = 30 s per turn = 12 deg/s
  }

  // ---- state
  const st = {
    id: SCENES[opts.scene] ? opts.scene : 'upper-lower',
    params: {}, time: 0, t: null, step: null, speed: opts.speed ?? 1, pick: null,
  };
  st.params = paramsFor(st.id, opts.params || {});
  setCamera(SCENES[st.id].camera, 0);
  if (opts.orbit) setOrbit(opts.orbit);
  const listeners = new Set();

  const view = { w: 1, h: 1, pr: 1, ox: 0, oy: 0 };
  function resize() {
    const w = Math.max(1, canvas.clientWidth || canvas.width || 1), h = Math.max(1, canvas.clientHeight || canvas.height || 1);
    const dpr = win.devicePixelRatio || 1;
    const maxPx = coarse ? 1920 * 1080 : 2560 * 1440;
    let pr = Math.min(dpr, 2);
    if (w * h * pr * pr > maxPx) pr = Math.sqrt(maxPx / (w * h));
    view.w = w; view.h = h; view.pr = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); }
    camera.aspect = w / h;
    if (view.ox || view.oy) camera.setViewOffset(w, h, view.ox, view.oy, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    lineMat.uniforms.uRes.value.set(w * pr, h * pr);
    lineMat.uniforms.uPR.value = pr;
    overlay.style.left = canvas.offsetLeft + 'px'; overlay.style.top = canvas.offsetTop + 'px';
    overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
  }
  function setViewOffset(ox = 0, oy = 0) { view.ox = ox; view.oy = oy; resize(); }

  function frame() {
    const S = SCENES[st.id];
    dl.reset(st.pick, st.time);
    frameScene(st.id, dl, { params: st.params, time: st.time, t: st.t, step: st.step, stepKind: st.step && st.step.kind, aspect: view.w / view.h });
    const fd = dl.fog ?? S.fog ?? 0.035;
    scene.fog.density = fd; lineMat.uniforms.uFogDensity.value = fd;
    syncTris(solid, dl.solid); syncTris(glass, dl.glass); syncLines(dl.lines);
    if (composer) composer.render(); else renderer.render(scene, camera);
    placeLabels(dl.labels);
    for (const fn of listeners) { try { fn(dl.reads); } catch (e) { /* a listener error must not stop the view */ } }
  }

  let raf = 0, last = 0, running = false;
  function loop(now) {
    raf = win.requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (doc.hidden || view.w < 2) return;
    if (!opts.externalClock) st.time += dt * st.speed;
    stepGlide(now);
    controls.update();
    frame();
  }
  function start() { if (running) return; running = true; last = 0; raf = win.requestAnimationFrame(loop); }
  function stop() { running = false; win.cancelAnimationFrame(raf); }

  function setScene(id, params = {}) {
    if (!SCENES[id]) return false;
    const changed = id !== st.id;
    st.id = id; st.params = paramsFor(id, params); st.step = null; st.t = null;
    if (changed) setCamera(SCENES[id].camera, 1200);
    return true;
  }
  function play(step, t = 0) {
    const m = stepScene(step, SCENES);
    const changed = m.scene !== st.id;
    if (changed || st.step !== step) { st.params = paramsFor(m.scene, m.params); }
    st.id = m.scene; st.step = step; st.t = Math.max(0, Math.min(1, +t || 0));
    if (changed) setCamera(SCENES[m.scene].camera, 1000);
  }

  resize();
  const ro = win.ResizeObserver ? new win.ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(canvas);
  if (opts.autoStart !== false) start();

  const api = {
    scenes: SCENE_IDS.slice(),
    saverShots: SAVER_SHOTS.map(s => ({ ...s, params: { ...s.params }, camera: { ...s.camera } })),
    setScene, play,
    setTime(s) { st.time = +s || 0; },
    resize,
    pickIndex(sym) { st.pick = sym || null; },
    dispose() {
      stop(); if (ro) ro.disconnect();
      controls.dispose();
      solid.mesh.geometry.dispose(); glass.mesh.geometry.dispose(); lines.mesh.geometry.dispose();
      solidMat.dispose(); glassMat.dispose(); lineMat.dispose(); envTex.dispose();
      if (scene.background && scene.background.dispose) scene.background.dispose();
      if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); if (bloom) bloom.dispose(); }
      renderer.dispose();
      overlay.remove(); listeners.clear();
    },
    setParams(p) { st.params = { ...st.params, ...p }; },
    setCamera, setOrbit,
    setShot(shot, ms = 1600) {
      if (!shot) return;
      setScene(shot.scene, shot.params || {});
      setCamera(shot.camera || SCENES[shot.scene].camera, ms);
    },
    setSpeed(k) { st.speed = +k || 0; },
    setViewOffset,
    sceneInfo,
    state: () => ({ scene: st.id, params: { ...st.params }, time: st.time, t: st.t, pick: st.pick, stepKind: st.step ? st.step.kind : null }),
    readouts: () => ({ ...dl.reads }),
    on(ev, fn) { if (ev !== 'readout') return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    render: () => frame(),
    start, stop,
    three: { THREE, renderer, scene, camera, controls },
  };
  return api;
}
