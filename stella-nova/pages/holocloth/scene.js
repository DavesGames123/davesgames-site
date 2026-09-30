// ============================================================================
//  HOLOCLOTH  ·  scene.js
//  Ported from upstream src/scene.ts (github.com/dmitrykurash/holocloth).
//  Copyright (c) 2026 Dmitry Kurash, MIT License, see LICENSE.
//  Port changes:
//    - TypeScript types and access modifiers are removed.
//    - The frame delta comes from the animation-loop time, not THREE.Clock
//      (Clock is deprecated in r185 and logs a console warning).
//    - Touch: a second finger never starts a grab, so a one-finger orbit can
//      turn into a two-finger pinch. The hover raycast is off on touch.
//    - setViewInsets() shifts the camera view off-center, so the cloth sits in
//      the part of the canvas that the panel and the dock do not cover.
//    - probePoint() returns the screen position of a cloth vertex, for the
//      headless render check.
//    - The DEV-only window.__holo hook is removed.
//
//  Renderer, lights, cloth mesh, grab and decal drag, post chain
//  (MSAA HDR -> DOF -> bloom -> tone map -> grain), and PNG export.
//    grep -n 'GrainShader'        the film grain pass
//    grep -n 'applyParams'        panel values into the engine
//    grep -n 'applyPerfProfile'   render scale, MSAA, cloth resolution
//    grep -n 'onPointerDown'      grab, decal drag, focus pick
//    grep -n 'exportPNG'          the high-resolution PNG export
//    grep -n 'tick = '            the frame loop
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ClothSim } from './cloth.js';
import { createHoloMaterial } from './holoMaterial.js';
import { SurfaceLayer } from './decals.js';
import { normalMapFromImage } from './textures.js';
import { MacroDofPass } from './dofPass.js';
import { BAKED_POSE } from './bakedPose.js';

const TONE_MAPPINGS = {
  AgX: THREE.AgXToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Neutral: THREE.NeutralToneMapping,
};

const CLOTH_LONG_SIDE = 3;
const CLOTH_SEGMENTS = 48;
const WHITE = new THREE.Color(0xffffff);
const HOVER_NONE = typeof matchMedia === 'function' && matchMedia('(hover:none)').matches;

const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.08 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    // sinless hash (Dave Hoskins style): sin-based hashes lose precision at
    // large arguments on some ANGLE backends (Chrome on Windows/Metal) and
    // collapse into marching bands — this one stays white noise everywhere
    float gHash(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // coords wrapped to keep magnitudes float32-safe; time is a hash
      // dimension, not an offset, so no pattern travels between frames
      vec2 p = mod(gl_FragCoord.xy, 1024.0);
      float n = gHash(vec3(p, mod(uTime * 120.0, 512.0))) - 0.5;
      c.rgb += n * uAmount;
      gl_FragColor = c;
    }
  `,
};

export class HoloApp {
  constructor(host, opts = {}) {
    this.host = host;
    this.bumpSource = null;
    this.thumbCache = new WeakMap();
    this.perfProfile = 'High';
    this.clothSegments = CLOTH_SEGMENTS;
    this.currentPR = Math.min(window.devicePixelRatio, 2);
    this.background = new THREE.Color('#0b0c12');
    this.lastTime = null;
    this.elapsed = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.dragPlane = new THREE.Plane();
    this.grabbing = false;
    this.grabPointerId = null;
    this.draggingDecal = false;
    this.decalGrabOffset = { u: 0, v: 0 };
    this.pickingFocus = false;
    this.focusVertex = null;
    this.pickReleaseId = null;
    this.spaceHeld = false;
    this.focusTmp = new THREE.Vector3();
    this.editMode = false;
    this.prevUseImage = false;
    this.hoverCursor = 'default';
    this.params = null;
    this.disposed = false;
    this.clothAspect = 1;
    this.touches = new Set();
    this.insets = { l: 0, r: 0, t: 0, b: 0 };
    this.insetFn = null;

    /** App-level hook: fired when a decal is selected or resized via wheel. */
    this.onDecalSelect = null;
    /** App-level hook: any uploaded image (cloth/decal/bump) changed. */
    this.onImagesChanged = null;
    /** App-level hook: fired once the focus pick ends. */
    this.onPickEnd = null;

    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA happens on the composer's render target
      powerPreference: 'high-performance',
      stencil: false,
      alpha: true, // transparent-background export
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.background;
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
    this.camera.position.set(...BAKED_POSE.camera);

    // image-based lighting from a neutral studio room
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    pmrem.dispose();

    // accent rims for specular interest — cool one side, warm the other
    const rimA = new THREE.DirectionalLight(0x7fd4ff, 1.1);
    rimA.position.set(-4, 2.5, -3);
    const rimB = new THREE.DirectionalLight(0xff9ad5, 0.9);
    rimB.position.set(4.5, -1.5, -2.5);
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(1.5, 3, 4);
    this.scene.add(rimA, rimB, key);

    // surface layer (uploaded graphics) + cloth
    this.surface = new SurfaceLayer();
    const holo = createHoloMaterial(this.surface.texture);
    this.holoMaterial = holo.material;
    this.holoUniforms = holo.uniforms;
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    if (this.holoMaterial.roughnessMap) this.holoMaterial.roughnessMap.anisotropy = maxAniso;
    this.surface.texture.anisotropy = maxAniso;

    this.clothMesh = new THREE.Mesh(undefined, this.holoMaterial);
    this.clothMesh.frustumCulled = false;
    // hidden until the app has loaded its assets and calls reveal()
    this.clothMesh.visible = false;
    this.buildCloth(1);
    this.scene.add(this.clothMesh);

    // interaction listeners BEFORE OrbitControls so grabs win the pointer
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 30;
    // one finger orbits, two fingers pinch to zoom and pan
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.target.set(...BAKED_POSE.target);
    this.controls.update();

    // post: MSAA + half-float HDR chain, bloom, tonemap+sRGB, grain
    const rt = new THREE.WebGLRenderTarget(width, height, {
      samples: 8,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.dofPass = new MacroDofPass(this.scene, this.camera);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.18, 0.85, 1.0);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GrainShader);
    this.composer.addPass(this.grainPass);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(host);

    if (opts.performance) this.applyPerfProfile(opts.performance);
    this.renderer.setAnimationLoop(this.tick);
  }

  /** (Re)build the sim + geometry for a given aspect ratio (w/h). */
  buildCloth(aspect) {
    this.clothAspect = aspect;
    const w = aspect >= 1 ? CLOTH_LONG_SIDE : CLOTH_LONG_SIDE * aspect;
    const h = aspect >= 1 ? CLOTH_LONG_SIDE / aspect : CLOTH_LONG_SIDE;
    const segs = this.clothSegments;
    const segX = aspect >= 1 ? segs : Math.max(10, Math.round(segs * aspect));
    const segY = aspect >= 1 ? Math.max(10, Math.round(segs / aspect)) : segs;
    this.sim = new ClothSim(w, h, segX, segY);
    const geo = new THREE.PlaneGeometry(w, h, segX, segY);
    const posAttr = new THREE.BufferAttribute(this.sim.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    this.cavityAttr = new THREE.BufferAttribute(new Float32Array(this.sim.count), 1);
    this.cavityAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCavity', this.cavityAttr);
    geo.computeVertexNormals();
    const old = this.clothMesh.geometry;
    this.clothMesh.geometry = geo;
    this.clothGeometry = geo;
    if (old) old.dispose();
    this.holoUniforms.uClothSize.value.set(w, h);
    this.focusVertex = null; // vertex indices are invalid after a rebuild
    this.cancelInteraction();
  }

  /** Fully tear down any in-flight grab/decal drag (e.g. cloth rebuilt). */
  cancelInteraction() {
    if (this.grabPointerId !== null &&
        this.renderer.domElement.hasPointerCapture(this.grabPointerId)) {
      this.renderer.domElement.releasePointerCapture(this.grabPointerId);
    }
    this.grabbing = false;
    this.draggingDecal = false;
    this.grabPointerId = null;
    this.sim.endGrab();
    // buildCloth also runs in the constructor, before controls exist
    if (this.controls) this.controls.enabled = true;
  }

  applyParams(p) {
    this.params = p;
    if (p.performance !== this.perfProfile) this.applyPerfProfile(p.performance);
    const m = this.holoMaterial;
    m.color.set(p.material.baseColor);
    m.roughness = p.material.roughness;
    m.metalness = p.material.metalness;
    m.clearcoat = p.material.clearcoat;
    m.clearcoatRoughness = p.material.coatRoughness;
    m.sheen = p.material.sheen;
    // sheen fibers carry the dye color, halfway toward white at the rim
    m.sheenColor.set(p.material.baseColor).lerp(WHITE, 0.5);
    m.iridescence = p.material.iridescence;
    m.normalScale.set(p.material.bump, p.material.bump);
    if (m.normalMap) m.normalMap.repeat.set(p.material.bumpTiling, p.material.bumpTiling);
    // material.envMapIntensity is ignored when lighting comes from
    // scene.environment — the renderer reads scene.environmentIntensity
    this.scene.environmentIntensity = p.render.environment;

    const u = this.holoUniforms;
    u.uHoloIntensity.value = p.material.holoIntensity;
    u.uHoloScale.value = p.material.holoScale;
    u.uBandFreq.value = p.material.bandFreq;
    u.uSaturation.value = p.material.saturation;
    u.uHueShift.value = p.material.hueShift;
    u.uSparkle.value = p.material.sparkle;
    u.uSpecTint.value = p.material.specTint;
    u.uSurfaceOpacity.value = p.images.opacity;
    u.uCornerRound.value = p.images.cornerRadius;

    this.background.set(p.render.background);
    this.renderer.toneMappingExposure = p.render.exposure;
    const tm = TONE_MAPPINGS[p.render.toneMapping] ?? THREE.AgXToneMapping;
    if (this.renderer.toneMapping !== tm) this.renderer.toneMapping = tm;
    this.bloomPass.strength = p.render.bloom;
    this.bloomPass.threshold = p.render.bloomThreshold;
    this.grainPass.uniforms.uAmount.value = p.render.noise;
    u.uCavityAmount.value = p.render.occlusion ? p.render.occlusionStrength : 0;
    this.dofPass.enabled = p.render.dof;
    this.dofPass.setParams(p.render.dofAperture * 1e-2, p.render.dofBlur, p.render.dofRange * 0.5);

    this.editMode = p.images.edit;
    this.controls.enableZoom = !this.editMode;

    // the useImage toggle doubles as the image-as-cloth state indicator;
    // edge-triggered so a stale false from a mid-upload render can't wipe
    // a freshly set image
    if (this.prevUseImage && !p.images.useImage && this.surface.clothImage) {
      this.removeClothImage();
    }
    this.prevUseImage = p.images.useImage;

    // sliders drive the selected decal
    const sel = this.surface.selected;
    if (sel && (sel.scale !== p.images.scale || sel.rotation !== p.images.rotation)) {
      sel.scale = p.images.scale;
      sel.rotation = p.images.rotation;
      this.surface.redraw();
    }
  }

  resetCloth() {
    this.sim.reset();
    this.clothGeometry.attributes.position.needsUpdate = true;
    this.clothGeometry.computeVertexNormals();
  }

  poke() {
    this.sim.poke(1);
  }

  addDecal(img) {
    const item = this.surface.addDecal(img);
    this.onDecalSelect?.(item.scale, item.rotation);
    this.onImagesChanged?.();
  }

  setClothImage(img) {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    this.surface.setClothImage(img);
    if (this.surface.setAspect(aspect)) this.rebindSurfaceTexture();
    this.buildCloth(aspect);
    this.onImagesChanged?.();
  }

  clearImages() {
    this.surface.clear();
    if (this.surface.setAspect(1)) this.rebindSurfaceTexture();
    this.buildCloth(1);
    this.onImagesChanged?.();
  }

  /** Drop only the cloth image (decals stay), back to the square cloth. */
  removeClothImage() {
    this.surface.setClothImage(null);
    if (this.surface.setAspect(1)) this.rebindSurfaceTexture();
    this.buildCloth(1);
    this.onImagesChanged?.();
  }

  get hasClothImage() {
    return this.surface.clothImage !== null;
  }

  /** Show the cloth once the app's assets are in place. */
  reveal() {
    this.clothMesh.visible = true;
  }

  /** Small data-URL preview of an image, cached per element. */
  thumbnailOf(img) {
    let url = this.thumbCache.get(img);
    if (url) return url;
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const scale = 96 / Math.max(iw, ih);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    url = c.toDataURL('image/png');
    this.thumbCache.set(img, url);
    return url;
  }

  getClothThumbnail() {
    return this.surface.clothImage ? this.thumbnailOf(this.surface.clothImage) : null;
  }

  getDecalThumbnails() {
    return this.surface.decals.map((d) => this.thumbnailOf(d.img));
  }

  removeDecal(index) {
    const d = this.surface.decals[index];
    if (!d) return;
    this.surface.decals.splice(index, 1);
    if (this.surface.selected === d) this.surface.selected = null;
    this.surface.redraw();
    this.onImagesChanged?.();
  }

  /** Capture image state for the version manager. */
  snapshotImages() {
    return {
      clothImage: this.surface.clothImage,
      decals: this.surface.decals.map((d) => ({ ...d })),
    };
  }

  /** Restore a version's image state (cloth image + decals). */
  restoreImages(s) {
    this.surface.clothImage = s.clothImage;
    this.surface.decals = s.decals.map((d) => ({ ...d }));
    this.surface.selected = null;
    let aspect = 1;
    if (s.clothImage) {
      const iw = s.clothImage.naturalWidth || s.clothImage.width || 1;
      const ih = s.clothImage.naturalHeight || s.clothImage.height || 1;
      aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    }
    if (this.surface.setAspect(aspect)) this.rebindSurfaceTexture();
    if (aspect !== this.clothAspect) this.buildCloth(aspect);
    this.onImagesChanged?.();
  }

  /**
   * Quality/performance trade-off: render scale, MSAA samples, and cloth
   * resolution. 'High' matches the original behavior.
   */
  applyPerfProfile(profile) {
    this.perfProfile = profile;
    const dpr = window.devicePixelRatio;
    this.currentPR = profile === 'Low' ? 1 : profile === 'Medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    const samples = profile === 'Low' ? 0 : profile === 'Medium' ? 4 : 8;
    const segs = profile === 'Low' ? 28 : profile === 'Medium' ? 36 : 48;
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.currentPR);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.currentPR);
    // MSAA sample count lives on the composer's ping-pong targets; force
    // reallocation so the new count takes effect
    this.composer.renderTarget1.samples = samples;
    this.composer.renderTarget2.samples = samples;
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.setSize(w, h);
    if (segs !== this.clothSegments) {
      this.clothSegments = segs;
      this.buildCloth(this.clothAspect);
    }
  }

  /** Swap the cloth's bump/normal map; null removes it entirely. */
  setBumpMap(img) {
    const old = this.holoMaterial.normalMap;
    let tex = null;
    if (img) {
      tex = normalMapFromImage(img);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const tiling = this.params?.material.bumpTiling ?? 3;
      tex.repeat.set(tiling, tiling);
    }
    this.bumpSource = img;
    this.holoMaterial.normalMap = tex;
    // map presence changes the shader program
    if (!!old !== !!tex) this.holoMaterial.needsUpdate = true;
    if (old) old.dispose();
    this.onImagesChanged?.();
  }

  get hasBumpMap() {
    return this.bumpSource !== null;
  }

  getBumpThumbnail() {
    return this.bumpSource ? this.thumbnailOf(this.bumpSource) : null;
  }

  /** After SurfaceLayer recreates its texture, point the shader at it. */
  rebindSurfaceTexture() {
    this.surface.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.holoUniforms.uSurfaceMap.value = this.surface.texture;
  }

  /** Render one frame at high resolution and download it as a PNG. */
  exportPNG(transparent = false) {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const normalPR = this.currentPR;
    const exportPR = Math.min(4, Math.max(2, 3200 / Math.max(w, h)));
    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.setPixelRatio(exportPR);
    this.composer.setPixelRatio(exportPR);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    if (transparent) {
      this.scene.background = this.background;
      this.renderer.setClearColor(0x000000, 1);
    }
    this.renderer.setPixelRatio(normalPR);
    this.composer.setPixelRatio(normalPR);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const a = document.createElement('a');
    a.href = url;
    const tag = transparent ? 'holocloth-nobg' : 'holocloth';
    a.download = `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
  }

  /**
   * Port addition. fn(w, h) returns the canvas margins in CSS px that other
   * elements cover: { l, r, t, b }. The frame loop eases toward them.
   */
  setViewInsets(fn) {
    this.insetFn = fn;
  }

  /**
   * Port addition. On a narrow (portrait) screen the upstream start view
   * crops the drape at the sides, because the camera fov is vertical. Move
   * the camera to aim at the center of the drape, and move it back along its
   * view line until the drape's bounding sphere fits across.
   */
  fitStartView() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const aspect = w / h;
    if (aspect >= 0.9) return;
    this.clothGeometry.computeBoundingSphere();
    const bs = this.clothGeometry.boundingSphere;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect;
    const need = (bs.radius * 0.9) / tanH;
    this.controls.target.copy(bs.center);
    this.camera.position.copy(bs.center).addScaledVector(dir, need);
    this.controls.update();
  }

  /** Port addition. Client coordinates of cloth vertex i (default: middle). */
  probePoint(i = -1) {
    const n = this.sim.count;
    const k = i < 0 ? Math.floor(this.sim.rows / 2) * this.sim.cols + Math.floor(this.sim.cols / 2) : i;
    const p = this.sim.positions;
    const v = new THREE.Vector3(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height, count: n };
  }

  updatePointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  raycastCloth() {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    this.clothGeometry.computeBoundingSphere();
    const hits = this.raycaster.intersectObject(this.clothMesh, false);
    return hits.length > 0 ? hits[0] : null;
  }

  /** One-shot: next click on the cloth becomes the DOF focal point. */
  startPickFocus() {
    this.pickingFocus = true;
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  /** Back to auto focus (orbit target). */
  clearPickFocus() {
    this.focusVertex = null;
  }

  /** Hold Space + left-drag = pan (design-tool style). */
  onKeyDown = (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
        t.tagName === 'BUTTON' || t.isContentEditable)) return;
    e.preventDefault();
    this.spaceHeld = true;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    if (!this.grabbing && !this.draggingDecal && !this.pickingFocus) {
      this.renderer.domElement.style.cursor = 'grab';
    }
  };

  onKeyUp = (e) => {
    if (e.code !== 'Space') return;
    this.spaceHeld = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  };

  onWindowBlur = () => {
    // cmd-tab away mid-hold: never leave pan mode stuck on
    this.spaceHeld = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  };

  onPointerDown = (e) => {
    if (e.pointerType === 'touch') this.touches.add(e.pointerId);
    if (e.button !== 0 || this.grabbing || this.draggingDecal) return;
    // port: a second finger belongs to the pinch, never to a grab
    if (e.pointerType === 'touch' && this.touches.size > 1) return;
    this.updatePointer(e);
    if (this.pickingFocus) {
      this.pickingFocus = false;
      this.renderer.domElement.style.cursor = 'default';
      const pick = this.raycastCloth();
      if (pick) {
        // nearest cloth vertex — the focal point rides the fabric
        const p = this.sim.positions;
        let best = 0;
        let bestD2 = Infinity;
        for (let i = 0; i < this.sim.count; i++) {
          const dx = p[i * 3] - pick.point.x;
          const dy = p[i * 3 + 1] - pick.point.y;
          const dz = p[i * 3 + 2] - pick.point.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
        this.focusVertex = best;
      }
      this.onPickEnd?.(!!pick);
      // swallow this click so it neither grabs nor orbits
      this.pickReleaseId = e.pointerId;
      this.controls.enabled = false;
      return;
    }
    // Space held: step aside so OrbitControls pans with the left button
    if (this.spaceHeld) return;
    const hit = this.raycastCloth();
    if (!hit) return;

    if (this.editMode) {
      if (!hit.uv) return;
      const d = this.surface.hitTest(hit.uv.x, hit.uv.y);
      if (!d) return; // no decal under pointer: let OrbitControls rotate
      this.surface.selected = d;
      this.draggingDecal = true;
      this.decalGrabOffset.u = d.u - hit.uv.x;
      this.decalGrabOffset.v = d.v - hit.uv.y;
      this.grabPointerId = e.pointerId;
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.renderer.domElement.style.cursor = 'move';
      this.onDecalSelect?.(d.scale, d.rotation);
      return;
    }

    const radius = this.params?.physics.grabRadius ?? 0.45;
    if (!this.sim.startGrab(hit.point, radius)) return;
    this.grabbing = true;
    this.grabPointerId = e.pointerId;
    this.controls.enabled = false;
    // drag on a camera-facing plane through the grab point
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  onPointerMove = (e) => {
    const active = this.grabbing || this.draggingDecal;
    if (active && e.pointerId !== this.grabPointerId) return;
    this.updatePointer(e);
    if (this.draggingDecal) {
      const hit = this.raycastCloth();
      const sel = this.surface.selected;
      if (hit?.uv && sel) {
        sel.u = hit.uv.x + this.decalGrabOffset.u;
        sel.v = hit.uv.y + this.decalGrabOffset.v;
        this.surface.redraw();
      }
      return;
    }
    if (!this.grabbing) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
      this.sim.moveGrab(target);
    }
  };

  onPointerUp = (e) => {
    this.touches.delete(e.pointerId);
    if (e.pointerId === this.pickReleaseId) {
      this.pickReleaseId = null;
      this.controls.enabled = true;
      return;
    }
    const active = this.grabbing || this.draggingDecal;
    if (!active || e.pointerId !== this.grabPointerId) return;
    this.grabbing = false;
    this.draggingDecal = false;
    this.grabPointerId = null;
    this.sim.endGrab();
    this.controls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    }
    this.renderer.domElement.style.cursor = this.hoverCursor;
  };

  onWheel = (e) => {
    if (!this.editMode) return;
    const sel = this.surface.selected;
    if (!sel) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sel.scale = THREE.MathUtils.clamp(sel.scale * Math.exp(-e.deltaY * 0.0012), 0.02, 2.5);
    this.surface.redraw();
    this.onDecalSelect?.(sel.scale, sel.rotation);
  };

  onResize() {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  /** Port addition: shift the view so the cloth centers in the clear area. */
  updateViewOffset() {
    if (!this.insetFn) return;
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const o = this.insetFn(w, h);
    const s = this.insets;
    let moved = false;
    for (const k of ['l', 'r', 't', 'b']) {
      const next = s[k] + (o[k] - s[k]) * 0.18;
      if (Math.abs(next - s[k]) > 0.01) moved = true;
      s[k] = Math.abs(o[k] - next) < 0.05 ? o[k] : next;
    }
    const ox = (s.r - s.l) / 2, oy = (s.b - s.t) / 2;
    // zoom out in proportion to the clear area, so the cloth fits in it
    const zoom = Math.max(0.4, Math.min(1, (w - s.l - s.r) / w, (h - s.t - s.b) / h));
    if (!moved && this.camera.view && this.camera.view.offsetX === ox && this.camera.view.offsetY === oy &&
        this.camera.view.fullWidth === w && this.camera.view.fullHeight === h && this.camera.zoom === zoom) return;
    this.camera.zoom = zoom;
    this.camera.setViewOffset(w, h, ox, oy, w, h);
  }

  tick = (time) => {
    if (this.disposed) return;
    const now = (time ?? performance.now()) / 1000;
    const dt = this.lastTime === null ? 0 : Math.max(0, now - this.lastTime);
    this.lastTime = now;
    this.elapsed += dt;
    this.grainPass.uniforms.uTime.value = this.elapsed % 61.7;

    this.updateViewOffset();

    if (this.params) {
      this.sim.step(dt, this.params.physics);
      this.clothGeometry.attributes.position.needsUpdate = true;
      this.clothGeometry.computeVertexNormals();
    }

    if (this.params?.render.occlusion) {
      this.sim.computeCavity(
        this.clothGeometry.attributes.normal.array,
        this.cavityAttr.array,
      );
      this.cavityAttr.needsUpdate = true;
    }
    if (this.params?.render.dof) {
      // picked focal point rides the fabric; otherwise focus the orbit target
      let focusDist;
      if (this.focusVertex !== null && this.focusVertex < this.sim.count) {
        const p = this.sim.positions;
        const i = this.focusVertex * 3;
        this.focusTmp.set(p[i], p[i + 1], p[i + 2]);
        focusDist = this.camera.position.distanceTo(this.focusTmp);
      } else {
        focusDist = this.camera.position.distanceTo(this.controls.target);
      }
      this.dofPass.setFocus(focusDist);
    }

    // hover cursor feedback (skip while dragging/picking/panning; off on Low
    // and, in the port, off on touch screens that have no hover)
    if (!HOVER_NONE && !this.grabbing && !this.draggingDecal && !this.pickingFocus && !this.spaceHeld &&
        this.perfProfile !== 'Low') {
      const hit = this.raycastCloth();
      let cursor = 'default';
      if (hit) {
        cursor = this.editMode
          ? hit.uv && this.surface.hitTest(hit.uv.x, hit.uv.y) ? 'move' : 'default'
          : 'grab';
      }
      if (cursor !== this.hoverCursor) {
        this.hoverCursor = cursor;
        this.renderer.domElement.style.cursor = cursor;
      }
    }

    this.controls.update();
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.controls.dispose();
    this.dofPass.dispose();
    this.composer.dispose();
    this.clothGeometry.dispose();
    this.holoMaterial.dispose();
    this.surface.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry && obj.geometry !== this.clothGeometry) obj.geometry.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
  }
}
