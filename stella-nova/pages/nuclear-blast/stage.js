// ============================================================================
//  NUCLEAR BLAST  ·  stage.js — renderer, sky, light, post effects, camera
// ----------------------------------------------------------------------------
//  createStage() makes a WebGL2 renderer on #view, a Y-up scene in metres
//  (ground zero at the origin), a sky dome, the shared light uniforms (st.U,
//  see glsl.js), an HDR chain and an orbit camera:
//
//    RenderPass (MSAA HalfFloat) -> DistortPass -> SoftBloom -> OutputPass
//
//  DistortPass bends the image by an offset field that st.dscene draws into
//  st.distRT at half size: the shock shells and the heat haze (blast.js).
//  Each material applies the exposure (U.uExpo, glsl.js outCol), so the
//  bloom threshold is in display units. The exposure adapts like an eye: it falls fast in the flash and comes
//  back slowly (function adapt).
//
//  Every material in the page is a ShaderMaterial that reads st.U, so the
//  sun, the sky light, the fog and the fireball light are set in one place.
//  The camera near and far planes follow the camera distance (the view goes
//  from a 2 m fireball to a 100 km cloud), so no log depth buffer is needed.
//
//  GREP MAP
//    const SKY_FS ........... the sky dome shader (gradient, sun, stars, flash)
//    const DISTORT .......... the distortion pass
//    class SoftBloom ........ round bloom: a mip chain, 13-tap down, tent up
//    const TOD .............. day, sunset and night presets
//    function createStage ... the factory
//      st.setTOD ............ time of day
//      st.flyTo / st.place .. camera moves on spherical arcs
//      function occlusion ... the part of the canvas the panels cover
//      function adapt ....... the exposure
//      st.frame ............. per-frame camera, planes, resize, render
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { NOISE } from './glsl.js';

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const D = Math.PI / 180, TAU = Math.PI * 2;

// ── sky ──────────────────────────────────────────────────────────────────
const SKY_VS = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */`
${NOISE}
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uStars;
uniform vec3 uFbDir; uniform vec3 uFbGlow; uniform vec3 uFogFlash; uniform vec3 uGroundCol; uniform float uExpo;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  // at and below the horizon: the haze, the same colour as the fog on the
  // far ground, so the two meet with no line
  col = mix(uGroundCol + uFogFlash, col, smoothstep(-0.002, 0.06, h));
  // sun disc and its glow
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 900.0) * 30.0 + pow(s, 12.0) * 0.18);
  // stars, faint, above the haze
  if (uStars > 0.0 && h > 0.02) {
    vec3 q = d * 420.0; vec3 c = floor(q);
    float r = hash13(c), tw = 0.6 + 0.4 * sin(r * 80.0);
    float st = step(0.9965, r) * smoothstep(0.55, 0.0, length(fract(q) - 0.5)) * tw;
    col += vec3(0.8, 0.85, 1.0) * st * uStars * smoothstep(0.02, 0.2, h);
  }
  // the flash: light scattered in the air around the fireball
  float f = max(dot(d, uFbDir), 0.0);
  col += uFbGlow * (pow(f, 60.0) * 2.0 + pow(f, 6.0) * 0.35) + uFogFlash * (1.0 - abs(h)) * 0.5;
  gl_FragColor = vec4(min(col * uExpo, vec3(10.0)), 1.0);
}`;

// ── distortion + exposure ───────────────────────────────────────────────
const DISTORT = {
  uniforms: { tDiffuse: { value: null }, tDist: { value: null }, uAmt: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform sampler2D tDist; uniform float uAmt;
varying vec2 vUv;
void main(){
  vec4 d = texture2D(tDist, vUv);
  vec2 o = d.xy * uAmt;
  float a = length(o);
  vec3 c;
  c.r = texture2D(tDiffuse, vUv + o * (1.0 + 2.0 * a)).r;
  c.g = texture2D(tDiffuse, vUv + o).g;
  c.b = texture2D(tDiffuse, vUv + o * (1.0 - 2.0 * a)).b;
  // the shock shell is a little brighter where light bends through it
  c *= 1.0 + d.z;
  gl_FragColor = vec4(c, 1.0);
}`,
};


// ── bloom ────────────────────────────────────────────────────────────────
// UnrealBloomPass cuts its Gaussian at one sigma, so a very bright ball
// gets a square halo. This bloom halves the image six times with a 13-tap
// filter (the first step keeps only light above the threshold), then adds
// each level back up with a 3x3 tent: the halo stays round.
const FSQ_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BLOOM_DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh; uniform float uFirst; varying vec2 vUv;
vec3 s(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main(){
  vec3 c = s(0.0, 0.0) * 0.125 + (s(-2.0, 2.0) + s(2.0, 2.0) + s(-2.0, -2.0) + s(2.0, -2.0)) * 0.03125
         + (s(0.0, 2.0) + s(-2.0, 0.0) + s(2.0, 0.0) + s(0.0, -2.0)) * 0.0625
         + (s(-1.0, 1.0) + s(1.0, 1.0) + s(-1.0, -1.0) + s(1.0, -1.0)) * 0.125;
  if (uFirst > 0.5) { float b = max(c.r, max(c.g, c.b)); c *= max(0.0, b - uThresh) / max(b, 1e-4); }
  gl_FragColor = vec4(c, 1.0);
}`;
const BLOOM_UP = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
vec3 s(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * uTexel * uRadius).rgb; }
void main(){
  vec3 c = s(0.0, 0.0) * 4.0 + (s(-1.0, 0.0) + s(1.0, 0.0) + s(0.0, -1.0) + s(0.0, 1.0)) * 2.0
         + s(-1.0, -1.0) + s(1.0, -1.0) + s(-1.0, 1.0) + s(1.0, 1.0);
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;
const BLOOM_MIX = /* glsl */`
uniform sampler2D tBase; uniform sampler2D tBloom; uniform float uStrength; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(tBase, vUv).rgb + texture2D(tBloom, vUv).rgb * uStrength, 1.0); }`;
class SoftBloom extends Pass {
  constructor(strength = 0.5, threshold = 0.9, levels = 6) {
    super();
    this.strength = strength; this.threshold = threshold; this.radius = 1;
    this.mips = Array.from({ length: levels }, () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.sizes = this.mips.map(() => [1, 1]); this.src = [1, 1];
    const mk = (fs, u, add) => new THREE.ShaderMaterial({ vertexShader: FSQ_VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NoBlending, transparent: !!add });
    this.down = mk(BLOOM_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: threshold }, uFirst: { value: 0 } });
    this.up = mk(BLOOM_UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }, true);
    this.mix = mk(BLOOM_MIX, { tBase: { value: null }, tBloom: { value: null }, uStrength: { value: strength } });
    this.quad = new FullScreenQuad(null);
  }
  setSize(w, h) {
    this.src = [w, h];
    let W = w, H = h;
    for (let i = 0; i < this.mips.length; i++) { W = Math.max(1, W >> 1); H = Math.max(1, H >> 1); this.mips[i].setSize(W, H); this.sizes[i] = [W, H]; }
  }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    let src = readBuffer.texture, sz = this.src;
    this.quad.material = this.down;
    for (let i = 0; i < this.mips.length; i++) {
      const u = this.down.uniforms; u.tSrc.value = src; u.uTexel.value.set(1 / sz[0], 1 / sz[1]); u.uFirst.value = i === 0 ? 1 : 0; u.uThresh.value = this.threshold;
      renderer.setRenderTarget(this.mips[i]); this.quad.render(renderer);
      src = this.mips[i].texture; sz = this.sizes[i];
    }
    this.quad.material = this.up;
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const u = this.up.uniforms, s1 = this.sizes[i + 1]; u.tSrc.value = this.mips[i + 1].texture; u.uTexel.value.set(1 / s1[0], 1 / s1[1]); u.uRadius.value = this.radius;
      renderer.setRenderTarget(this.mips[i]); this.quad.render(renderer);
    }
    this.mix.uniforms.tBase.value = readBuffer.texture; this.mix.uniforms.tBloom.value = this.mips[0].texture; this.mix.uniforms.uStrength.value = this.strength;
    this.quad.material = this.mix;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
    renderer.autoClear = ac;
  }
  dispose() { this.mips.forEach(m => m.dispose()); this.down.dispose(); this.up.dispose(); this.mix.dispose(); this.quad.dispose(); }
}

// ── time of day ──────────────────────────────────────────────────────────
// sun: azimuth and elevation (deg); level: sun irradiance; sky colours linear.
export const TOD = {
  day: { az: 140, el: 48, sun: [1.0, 0.96, 0.9], level: 1, zenith: [0.13, 0.27, 0.55], horizon: [0.55, 0.66, 0.78], amb: [0.32, 0.38, 0.48], gnd: [0.12, 0.11, 0.09], fog: [0.5, 0.6, 0.72], stars: 0, lights: 0 },
  sunset: { az: 250, el: 4, sun: [1.0, 0.52, 0.24], level: 0.55, zenith: [0.05, 0.08, 0.2], horizon: [0.85, 0.42, 0.2], amb: [0.16, 0.14, 0.2], gnd: [0.07, 0.05, 0.04], fog: [0.48, 0.3, 0.22], stars: 0.15, lights: 0.6 },
  night: { az: 300, el: 30, sun: [0.25, 0.3, 0.42], level: 0.035, zenith: [0.004, 0.007, 0.018], horizon: [0.018, 0.025, 0.05], amb: [0.012, 0.016, 0.03], gnd: [0.004, 0.004, 0.006], fog: [0.02, 0.028, 0.05], stars: 1, lights: 1 },
};

// o: { canvas, occluders: [el], band: () => {t,b}|null, coarse, reduced, onNoGL }
export function createStage(o) {
  const { canvas } = o;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); }
  catch (e) { if (o.onNoGL) o.onNoGL(); throw e; }
  if (!renderer.capabilities.isWebGL2) { if (o.onNoGL) o.onNoGL(); throw new Error('WebGL2 needed'); }
  const low = !!o.coarse;
  const dpr = () => Math.min(devicePixelRatio || 1, low ? 1.5 : 2, Math.max(1, 2800 / Math.max(1, canvas.clientWidth)));
  renderer.setPixelRatio(dpr());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 1e6);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 4; controls.maxDistance = 6e5;
  controls.maxPolarAngle = Math.PI * 0.94;   // may look up from street level; main.js keeps y > 2 m
  controls.zoomSpeed = 1.2;

  // shared uniforms (glsl.js LIGHT and FOG)
  const U = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
    uSkyAmb: { value: new THREE.Color() }, uGndAmb: { value: new THREE.Color() },
    uFbPos: { value: new THREE.Vector3(0, 1e9, 0) }, uFbCol: { value: new THREE.Color(1, 1, 1) }, uFbPow: { value: 0 }, uTauL: { value: 30000 },
    uFogCol: { value: new THREE.Color() }, uFogDen: { value: 2e-5 }, uFogFlash: { value: new THREE.Color(0, 0, 0) },
    uTime: { value: 0 }, uClock: { value: 0 }, uLights: { value: 0 }, uExpo: { value: 1 },
  };

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: U.uSunDir, uSunCol: U.uSunCol,
      uStars: { value: 0 }, uFbDir: { value: new THREE.Vector3(0, 1, 0) }, uFbGlow: { value: new THREE.Color(0, 0, 0) }, uFogFlash: U.uFogFlash,
      uGroundCol: { value: new THREE.Color() }, uExpo: U.uExpo,
    },
  }));
  sky.renderOrder = -1000; sky.frustumCulled = false;
  scene.add(sky);

  // ── post chain ──
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const distortPass = new ShaderPass(DISTORT);
  composer.addPass(distortPass);
  const bloom = new SoftBloom(0.35, 0.95, low ? 5 : 6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const distRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  distortPass.uniforms.tDist.value = distRT.texture;
  const dscene = new THREE.Scene();

  const st = {
    THREE, renderer, scene, dscene, camera, controls, sky, U, bloom, composer, distRT, distortPass,
    orbit: false, orbitK: 1, orbitAmt: 0, idle: 99, dragging: false, fly: null, tod: 'day', todSpec: TOD.day,
    exposure: 1, expoTarget: 1, adaptIn: 1, lowQ: low,
  };

  st.setTOD = name => {
    const T = TOD[name] || TOD.day; st.tod = name; st.todSpec = T;
    U.uSunDir.value.setFromSphericalCoords(1, (90 - T.el) * D, T.az * D);
    U.uSunCol.value.setRGB(...T.sun).multiplyScalar(T.level);
    U.uSkyAmb.value.setRGB(...T.amb); U.uGndAmb.value.setRGB(...T.gnd);
    U.uFogCol.value.setRGB(...T.fog);
    U.uLights.value = T.lights;
    const su = sky.material.uniforms;
    su.uZenith.value.setRGB(...T.zenith); su.uHorizon.value.setRGB(...T.horizon); su.uStars.value = T.stars;
    su.uGroundCol.value.setRGB(...T.fog);
  };
  st.setTOD('day');
  // the haze: visibility V (km) sets the fog and the thermal transmittance
  st.setVisibility = Vkm => { U.uFogDen.value = 1 / (Vkm * 1000 * 8); U.uTauL.value = 1500 * Vkm; };
  st.setVisibility(20);

  st.flyTo = ({ az, el, r, target, t = 1.6 }) => {
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    let th = az * D; while (th - s0.theta > Math.PI) th -= TAU; while (s0.theta - th > Math.PI) th += TAU;
    st.fly = { t: 0, dur: t, s0, s1: new THREE.Spherical(r, (90 - el) * D, th), t0: controls.target.clone(), t1: target.clone() };
    st.idle = -2;
  };
  st.place = ({ az, el, r, target }) => {
    controls.target.copy(target);
    camera.position.setFromSpherical(new THREE.Spherical(r, (90 - el) * D, az * D)).add(target);
    st.fly = null;
  };
  st.dist = () => camera.position.distanceTo(controls.target);
  controls.addEventListener('start', () => { st.dragging = true; st.fly = null; if (st.onStart) st.onStart(); });
  controls.addEventListener('end', () => { st.dragging = false; st.idle = 0; });
  canvas.addEventListener('pointerdown', () => { st.idle = 0; });
  canvas.addEventListener('wheel', () => { st.idle = 0; if (st.onWheel) st.onWheel(); }, { passive: true });

  // framing: each panel that covers the canvas pushes the view the other way
  const occ = { l: 0, r: 0, t: 0, b: 0 };
  function occlusion(w, h) {
    const out = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect();
    for (const el of o.occluders || []) {
      if (!el || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const q = el.getBoundingClientRect();
      const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) out.b = Math.max(out.b, cr.bottom - y0); else out.t = Math.max(out.t, y1 - cr.top); }
      else { if (x0 + x1 < cr.left * 2 + w) out.l = Math.max(out.l, x1 - cr.left); else out.r = Math.max(out.r, cr.right - x0); }
    }
    const band = o.band && o.band();
    if (band) { out.t = Math.max(out.t, band.t); out.b = Math.max(out.b, band.b); }
    return out;
  }
  st.clearRect = () => ({ l: occ.l, r: occ.r, t: occ.t, b: occ.b, w: canvas.clientWidth, h: canvas.clientHeight });
  let lastDpr = 0, lastW = 0, lastH = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const p = dpr();
    if (p !== lastDpr || w !== lastW || h !== lastH) {
      lastDpr = p; lastW = w; lastH = h;
      renderer.setPixelRatio(p); renderer.setSize(w, h, false);
      composer.setPixelRatio(p); composer.setSize(w, h);
      distRT.setSize(Math.max(4, Math.round(w * p / 2)), Math.max(4, Math.round(h * p / 2)));
    }
    const ob = occlusion(w, h);
    for (const k in occ) occ[k] += (ob[k] - occ[k]) * 0.25;
    const cw = Math.max(80, w - occ.l - occ.r), ch = Math.max(80, h - occ.t - occ.b);
    camera.aspect = w / h;
    // fit the clear area: zoom out when it is narrower than the full height
    const nw = cw / h;
    camera.zoom = Math.min(1, Math.max(0.35, Math.min(nw * 1.15, ch / h)));
    camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
  }

  // exposure: an eye that adapts to the light at the subject. L is the
  // irradiance there in suns; the flash closes the eye in a few frames and
  // it opens again over seconds.
  function adapt(dt) {
    const L = Math.max(1e-3, st.todSpec.level * 0.9 + 0.08 + st.adaptIn);
    st.expoTarget = 0.9 / Math.pow(L, 0.62);
    const k = st.expoTarget < st.exposure ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 1.6);
    st.exposure += (st.expoTarget - st.exposure) * k;
    U.uExpo.value = st.exposure;
  }
  st.setExposureNow = () => { st.exposure = st.expoTarget; };

  const sph = new THREE.Spherical();
  st.frame = dt => {
    st.idle += dt;
    if (st.fly) {
      st.fly.t = Math.min(1, st.fly.t + dt / st.fly.dur);
      const k = ease(st.fly.t), s0 = st.fly.s0, s1 = st.fly.s1;
      controls.target.lerpVectors(st.fly.t0, st.fly.t1, k);
      // radius in log space: flights cross several orders of size
      sph.set(Math.exp(Math.log(s0.radius) + (Math.log(s1.radius) - Math.log(s0.radius)) * k), s0.phi + (s1.phi - s0.phi) * k, s0.theta + (s1.theta - s0.theta) * k);
      camera.position.setFromSpherical(sph).add(controls.target);
      if (st.fly.t >= 1) st.fly = null;
    }
    const want = st.orbit && !st.dragging && !st.fly && st.idle > 2.5 ? 1 : 0;
    st.orbitAmt += (want - st.orbitAmt) * Math.min(1, dt * (want > st.orbitAmt ? 0.6 : 4));
    controls.autoRotate = st.orbitAmt > 0.002;
    controls.autoRotateSpeed = -0.35 * st.orbitAmt * st.orbitK;
    controls.update(dt);
    // planes follow the distance and the height of the camera
    const r = st.dist(), hy = Math.max(0.5, camera.position.y);
    camera.near = Math.max(0.3, Math.min(r * 0.02, hy * 0.6, 400));
    camera.far = Math.max(3e5, r * 60);
    sky.scale.setScalar(camera.far * 0.8); sky.position.copy(camera.position);
    resize();
    camera.updateProjectionMatrix();
    adapt(dt);
    // the offset field: shock shells and heat haze
    renderer.setRenderTarget(distRT);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    if (dscene.children.some(c => c.visible)) renderer.render(dscene, camera);
    renderer.setRenderTarget(null);
    composer.render(dt);
  };
  st.dispose = () => { try { composer.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* gone */ } };
  return st;
}
