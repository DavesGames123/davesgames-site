// ============================================================================
//  PARTICLE COLLIDER  ·  stage.js — renderer, bloom, camera, framing
// ----------------------------------------------------------------------------
//  One WebGL renderer draws the optional 3D view of the event (millimetres):
//  tracks and deposits, with thin hardware outlines when the viewer turns
//  them on. st.use(scene, o) sets the scene and the camera limits. The camera near and far planes follow the orbit distance
//  each frame, so near and far views keep their depth precision.
//
//  POST  EffectComposer: RenderPass, OverlayPass (the event layer with a
//  hue-keeping soft clip), UnrealBloomPass, OutputPass (three r160 addons). The bloom runs at a lower resolution on phones (quality tier).
//
//  FRAMING (grep -n 'function occlusion')
//  Each panel that covers the canvas (o.occluders) and the saver plate band
//  (o.band() -> { t, b, l?, r? } px) pushes the view centre into the clear part with
//  camera.setViewOffset, as on the wave-membrane and geneva-cams pages.
//
//  GREP MAP
//    st.flyTo / st.place / st.use ... camera moves, scene swap
//    function occlusion ............. clear area of the canvas
//    st.frame ....................... controls, resize, render
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// The event layer renders into its own HDR target and joins the scene
// through a soft clip that keeps the hue: o / (1 + max(o) / K). Where a
// hundred tracks meet at the vertex the sum stays coloured, never white;
// a faint line passes almost unchanged. Where the clipped light is hot, the
// weaker channels fall (a power on the normalised colour), so the sum
// keeps its hue. The bloom then runs on the result. main.js sets uK, the
// exposure and the bloom per event (st.overlayK, st.setLook).
class OverlayPass extends Pass {
  constructor(camera) {
    super();
    this.scene = null; this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tBase: { value: null }, tOver: { value: null }, uK: { value: 1.5 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // After the clip, where the light is hot, the normalised colour is raised
      // to a power above 1: the strongest channel stays, the weaker ones fall,
      // so a sum of many colours stays a colour and not white.
      fragmentShader: 'uniform sampler2D tBase, tOver; uniform float uK; varying vec2 vUv; void main(){ vec4 b = texture2D(tBase, vUv); vec3 o = texture2D(tOver, vUv).rgb; float m = max(max(o.r, o.g), o.b); vec3 c = o / (1.0 + m / uK); float cm = m / (1.0 + m / uK); if (cm > 1e-4) { float hot = smoothstep(0.3, 0.95, cm / uK); c = cm * pow(c / cm, vec3(1.0 + 1.8 * hot)); } gl_FragColor = vec4(b.rgb + c, b.a); }',
      depthTest: false, depthWrite: false,
    });
    this.fsq = new FullScreenQuad(this.mat);
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    if (this.scene) renderer.render(this.scene, this.camera);
    renderer.setClearColor(cc, ca);
    this.mat.uniforms.tBase.value = readBuffer.texture; this.mat.uniforms.tOver.value = this.rt.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }
}

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const D = Math.PI / 180, TAU = Math.PI * 2;

export function createStage(o) {
  const { canvas } = o;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !o.coarse, alpha: false, powerPreference: 'high-performance' }); }
  catch (e) { if (o.onNoGL) o.onNoGL(); throw e; }
  const tier = o.coarse ? 1 : 2;
  const dpr = () => Math.min(devicePixelRatio || 1, o.coarse ? 1.6 : 2, Math.max(1, 3000 / Math.max(1, canvas.clientWidth)));
  renderer.setPixelRatio(dpr());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x05070c, 1);

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 1e5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.zoomSpeed = 0.9;
  let scene = new THREE.Scene();
  const composer = new EffectComposer(renderer);
  const rp = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.95, 0.55, 0.12);
  const overlay = new OverlayPass(camera);
  composer.addPass(rp); composer.addPass(overlay); composer.addPass(bloom); composer.addPass(new OutputPass());

  const st = { shk: 0, shkT: 0, THREE, renderer, camera, controls, composer, bloom, tier, orbit: !o.reduced, orbitAmt: 0, orbitK: 1, idle: 99, dragging: false, fly: null, near: 0.002, onStart: null };
  st.scene = () => scene;
  // the event layer (display.js group) for the soft-clip overlay; null: none
  st.setOverlay = (sc, k = 1.2) => { overlay.scene = sc; overlay.mat.uniforms.uK.value = k; };
  st.overlayK = k => { overlay.mat.uniforms.uK.value = k; };
  st.shake = a => { if (!o.reduced) { st.shk = Math.max(st.shk, a); st.shkT = 0; } };
  // per-shot exposure and bloom, eased (no pops)
  st.look = { exp: 1, bloom: 0.75, thr: 0.3 }; const look = { exp: 1, bloom: 0.75, thr: 0.3 };
  st.setLook = (exp, bl, thr) => { st.look = { exp, bloom: bl, thr }; };
  st.use = (sc, lim = {}) => {
    scene = sc; rp.scene = sc;
    controls.minDistance = lim.min ?? 10; controls.maxDistance = lim.max ?? 1e5;
    st.near = lim.near ?? 0.002;
    if (lim.bloom) { st.look = { exp: 1, bloom: lim.bloom[0], thr: lim.bloom[2] }; bloom.radius = lim.bloom[1]; }
  };

  st.flyTo = ({ az, el, r, target, t = 1.6 }) => {
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    let th = az * D; while (th - s0.theta > Math.PI) th -= TAU; while (s0.theta - th > Math.PI) th += TAU;
    st.fly = { t: 0, dur: t, s0, s1: new THREE.Spherical(r, (90 - el) * D, th), t0: controls.target.clone(), t1: target.clone(), log: true };
    st.idle = -2;
  };
  st.place = ({ az, el, r, target }) => {
    controls.target.copy(target);
    camera.position.setFromSpherical(new THREE.Spherical(r, (90 - el) * D, az * D)).add(target);
    st.fly = null;
  };
  st.pose = () => { const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); return { az: s.theta / D, el: 90 - s.phi / D, r: s.radius, target: controls.target.clone() }; };

  controls.addEventListener('start', () => { st.dragging = true; st.fly = null; if (st.onStart) st.onStart(); });
  controls.addEventListener('end', () => { st.dragging = false; st.idle = 0; });
  canvas.addEventListener('pointerdown', () => { st.idle = 0; });
  canvas.addEventListener('wheel', () => { st.idle = 0; }, { passive: true });

  const occ = { l: 0, r: 0, t: 0, b: 0 };
  function occlusion(w, h) {
    const out = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect();
    for (const el of o.occluders || []) {
      if (!el || (!el.offsetParent && getComputedStyle(el).position !== 'fixed') || getComputedStyle(el).visibility === 'hidden') continue;
      const q = el.getBoundingClientRect();
      const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) out.b = Math.max(out.b, cr.bottom - y0); else out.t = Math.max(out.t, y1 - cr.top); }
      else { if (x0 + x1 < cr.left * 2 + w) out.l = Math.max(out.l, x1 - cr.left); else out.r = Math.max(out.r, cr.right - x0); }
    }
    const band = o.band && o.band();
    if (band) { out.t = Math.max(out.t, band.t); out.b = Math.max(out.b, band.b); if (band.l) out.l = Math.max(out.l, band.l); if (band.r) out.r = Math.max(out.r, band.r); }
    return out;
  }
  st.clear = () => ({ ...occ });
  let lastDpr = 0, lw = 0, lh = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const p = dpr();
    if (p !== lastDpr || w !== lw || h !== lh) {
      lastDpr = p; lw = w; lh = h;
      renderer.setPixelRatio(p); renderer.setSize(w, h, false);
      composer.setPixelRatio(p); composer.setSize(w, h);
      const k = tier === 1 ? 0.35 : 0.5;
      bloom.resolution.set(Math.round(w * p * k), Math.round(h * p * k));
    }
    const ob = occlusion(w, h);
    for (const k in occ) occ[k] += (ob[k] - occ[k]) * 0.2;
    const cw = Math.max(80, w - occ.l - occ.r), ch = Math.max(80, h - occ.t - occ.b);
    camera.aspect = w / h;
    // fit a subject about as wide as it is tall into the clear area
    const nw = cw / h, gain = 1 + 0.35 * Math.max(0, Math.min(1, (0.9 - nw) / 0.4));
    camera.zoom = Math.min(1, Math.max(0.3, Math.min(nw * gain, ch / h)));
    camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
    const dist = camera.position.distanceTo(controls.target);
    camera.near = Math.max(1e-3, dist * st.near); camera.far = dist * 400 + 10;
    camera.updateProjectionMatrix();
  }
  st.resize = resize;

  const sph = new THREE.Spherical();
  st.frame = dt => {
    st.idle += dt;
    if (st.fly) {
      st.fly.t = Math.min(1, st.fly.t + dt / st.fly.dur);
      const k = ease(st.fly.t), s0 = st.fly.s0, s1 = st.fly.s1;
      controls.target.lerpVectors(st.fly.t0, st.fly.t1, k);
      // radius on a log scale: the ring and a cell differ by 10^3
      const r = Math.exp(Math.log(s0.radius) + (Math.log(s1.radius) - Math.log(s0.radius)) * k);
      sph.set(r, s0.phi + (s1.phi - s0.phi) * k, s0.theta + (s1.theta - s0.theta) * k);
      camera.position.setFromSpherical(sph).add(controls.target);
      if (st.fly.t >= 1) st.fly = null;
    }
    for (const k of ['exp', 'bloom', 'thr']) look[k] += (st.look[k] - look[k]) * Math.min(1, dt * 2.5);
    renderer.toneMappingExposure = look.exp; bloom.strength = look.bloom; bloom.threshold = look.thr;
    const want = st.orbit && !st.dragging && !st.fly && st.idle > 3 ? 1 : 0;
    st.orbitAmt += (want - st.orbitAmt) * Math.min(1, dt * (want > st.orbitAmt ? 0.5 : 4));
    controls.autoRotate = st.orbitAmt > 0.002;
    controls.autoRotateSpeed = -0.35 * st.orbitAmt * st.orbitK;
    controls.update(dt);
    resize();
    // camera shake: a decaying jitter added for this frame only
    let sx = 0, sy = 0, sz = 0;
    if (st.shk > 1e-4) {
      st.shkT += dt; st.shk *= Math.exp(-dt / 0.35);
      const dd = camera.position.distanceTo(controls.target) * st.shk, t = st.shkT;
      sx = dd * Math.sin(t * 61.0) * Math.sin(t * 7.3); sy = dd * Math.sin(t * 53.0 + 1.3) * Math.cos(t * 5.1); sz = dd * Math.sin(t * 47.0 + 2.1) * 0.5;
      camera.position.x += sx; camera.position.y += sy; camera.position.z += sz;
    }
    composer.render(dt);
    camera.position.x -= sx; camera.position.y -= sy; camera.position.z -= sz;
  };
  st.dispose = () => { try { composer.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* gone */ } };
  return st;
}

// a soft vertical gradient for a scene background
export function gradientBackground(top = '#0b1020', mid = '#05070c', bot = '#020305') {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bot);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// a radial glow sprite texture (white core, soft edge)
export function glowTexture(n = 128) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(c);
}
