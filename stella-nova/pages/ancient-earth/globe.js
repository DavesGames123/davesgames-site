// ============================================================================
//  ANCIENT EARTH  ·  globe.js  ·  the three.js globe
// ----------------------------------------------------------------------------
//  One WebGL 2 canvas. Per frame: stars -> planet (surface.js PLANET_FRAG,
//  reads the baked surface) -> sky shell (in-scatter where the ray misses
//  the planet, additive) -> overlay lines, fossils, pins and trails, raised
//  0.12-0.4% of the radius above the surface, so nothing z-fights it.
//
//  The surface bake renders the colour, the sea-glint weight, the slopes
//  and the land mask into equirectangular targets, in two passes (height,
//  then colour; surface.js). It runs only when the age, the colour mode,
//  the tint or the data change, never per frame at rest:
//    moving, older than PAIR_MIN Ma   the two DEM frames around the age
//                                     each bake once into a small cached
//                                     target (CACHE_N kept); the planet
//                                     mixes them, so a play costs one small
//                                     bake per 5 Myr crossed
//    moving, younger                  one small bake of the exact age per
//                                     frame (the ice age sea level and the
//                                     city lights change within a frame)
//    stopped for 250 ms               one big bake of the exact age
//  Small: 1024 x 512 (a phone 512 x 256). Big: 2048 x 1024 (a phone
//  1024 x 512). The cloud fields bake once.
//
//  Progressive data: the DEM layers arrive by chunk (data.js DemStream,
//  uploaded layer by layer in "uploadLayers("); setAge uses the nearest
//  frames already in. Lines, fossils, the polygon raster and the city
//  lights attach later ("attachLazy("); each feature is off until its data
//  is in.
//
//  The drawing buffer size comes from lib/render-scale.js (a pixel budget,
//  then a factor that the frame rate lowers), through a proxy canvas.
//
//  Axes: a point at (lat, lon) is (cos lat sin lon, sin lat, cos lat cos
//  lon) in the globe group. Present-day things ride their plate by a
//  256x1 float texture of one quaternion per polygon (shaders.js RIDE).
//
//  grep -n targets
//    set the age ........... "setAge("
//    bake scheduling ....... "updateBake("
//    one bake .............. "bakeInto("
//    DEM layer upload ...... "uploadLayers("
//    lazy layers ........... "attachLazy("
//    render scale .......... "RenderScale"
//    quaternion texture .... "updateQuats("
//    sun direction ......... "sunDir("
//    picking ............... "pick("
//    pins and trails ....... "addPin("
//    GPU release ........... "dispose("
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as SH from './shaders.js';
import * as SF from './surface.js';
import { framesAt } from './data.js';
import { climateAt } from './world.js';

const PAIR_MIN = 6, CACHE_N = 6;
const D2R = Math.PI / 180;
export const MODES = ['realistic', 'hypsometric', 'grey', 'magma', 'viridis', 'inferno', 'turbo', 'outline'];

// Colour map stops: matplotlib magma, viridis, inferno (CC0) and turbo
// (Google, Apache-2.0), sampled at 16 points, sRGB hex.
const CMAPS = {
  magma: '0000040b092420114b3b0f7057157e721f818c2981a8327dc43c75de4968f1605dfa7f5efe9f6dfebf84fddea0fcfdbf',
  viridis: '440154481a6c472f7d41448739568c31688e2a788e23888e1f988b22a88435b77954c5687ad151a5db36d2e21bfde725',
  inferno: '0000040c0826240c4f420a685d126e781c6d932667ae305cc73e4cdd513aed6925f8850ffca50afac62df2e661fcffa4',
  turbo: '30123b4143a74771e93e9bfe22c5e21ae4b646f88488ff4eb9f635e1dd37faba39fd8d27f05b12d63506af18017a0403',
};
export function cmapRGB(name, x) {
  const s = CMAPS[name], n = s.length / 6, f = Math.max(0, Math.min(1, x)) * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
  const c = k => [0, 2, 4].map(o => parseInt(s.substr(k * 6 + o, 2), 16));
  const a = c(i), b = c(i + 1);
  return a.map((v, j) => Math.round(v + (b[j] - v) * u));
}
export const CONTINENT_COLORS = {
  'North America': '#e0794a', 'South America': '#7fb85a', 'Europe': '#5a8fd6', 'Asia': '#d9b44a', 'Africa': '#c8584f',
  'Oceania': '#55b8b0', 'Antarctica': '#d8dde6', 'Ocean': '#8a8f9a', 'Seven seas (open ocean)': '#8a8f9a',
};
// Distinct plate colours: hues by the golden angle over the plate order.
export function plateColor(rank) {
  const h = (rank * 137.508) % 360, s = 0.55 + 0.25 * ((rank * 7) % 3) / 2, l = 0.5 + 0.12 * ((rank * 5) % 3 - 1);
  return new THREE.Color().setHSL(h / 360, s, l);
}

function threeOf(v) { return new THREE.Vector3(v[1], v[2], v[0]); }
const _pw = new THREE.Vector3(), _pl = new THREE.Vector3();
export function llToThreeInto(o, lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R;
  return o.set(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r);
}
export function llToThree(lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R;
  return new THREE.Vector3(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r);
}

export class Globe {
  constructor(canvas, core, plates, dem, opt = {}) {
    this.canvas = canvas; this.core = core; this.plates = plates; this.dem = dem; this.data = core;
    this.lite = !!opt.lite;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lite, powerPreference: 'high-performance', preserveDrawingBuffer: !!opt.keep });
    r.setClearColor(0x000000, 1);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;   // the shaders encode sRGB themselves
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    this.camera.position.set(0, 0.55, 3.6);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.45, zoomSpeed: 0.7, minDistance: 1.22, maxDistance: 9 });
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.t = -1; this.state = { mode: 0, tint: 0, exag: 20, hill: 1, hillAz: 315, hillAlt: 40, clouds: 1, detail: 1, exposure: 0.3, tintK: 0.7 };
    this.sun = { mode: 'view', az: -38, el: 20, day: 172, hour: 12 };
    this.layers = { coast: true, borders: false, terranes: false, bounds: false, grid: true, fossils: true };
    this.time0 = performance.now(); this.lastFrame = this.time0;
    this.cloudT = 0; this.ageRate = 0; this.lastAgeAt = 0;
    this.pins = [];
    this.fossilColors = FOSSIL_COLORS;
    this.stats = { bakes: 0, bakeMs: 0, lastBake: '' };
    this.buildTextures();
    this.buildBake();
    this.buildPlanet();
    this.buildStars();
    this.buildGrid();
    this.setupScale();
  }

  // ── render scale (lib/render-scale.js) ───────────────────────────────────
  // RenderScale sets canvas.width/height; a proxy turns that into a three.js
  // pixel ratio, so the renderer and its viewport stay in step.
  setupScale() {
    const self = this, box = { w: 1, h: 1 };
    this.cssW = 1; this.cssH = 1;
    const proxy = { _w: 1, _h: 1,
      get width() { return this._w; }, set width(v) { this._w = v; box.w = v; self.applyScale(box); },
      get height() { return this._h; }, set height(v) { this._h = v; box.h = v; self.applyScale(box); } };
    this.rs = window.RenderScale ? window.RenderScale.create({ canvas: proxy, cssSize: () => [this.cssW, this.cssH], maxDpr: 2,
      fracDesktop: 1, fracMobile: 1, maxPixels: this.lite ? 0.9e6 : 2.4e6 }) : null;
  }
  applyScale(box) {
    const pr = Math.max(0.3, box.w / Math.max(1, this.cssW));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.pixelRatio = pr;
    if (this.starU) this.starU.uPix.value = pr;
    if (this.fossilU) this.fossilU.uPix.value = pr;
  }

  // ── textures ──────────────────────────────────────────────────────────────
  buildTextures() {
    const m = this.core.meta.dem;
    const dem = this.demTex = new THREE.DataArrayTexture(this.dem.rg, m.w, m.h, m.times.length);
    dem.format = THREE.RGFormat; dem.type = THREE.UnsignedByteType;
    dem.minFilter = dem.magFilter = THREE.LinearFilter;
    dem.wrapS = THREE.RepeatWrapping; dem.wrapT = THREE.ClampToEdgeWrapping;
    dem.generateMipmaps = false; dem.unpackAlignment = 1; dem.needsUpdate = true;
    // quaternions per polygon
    this.qData = new Float32Array(256 * 4);
    const q = this.qTex = new THREE.DataTexture(this.qData, 256, 1, THREE.RGBAFormat, THREE.FloatType);
    q.minFilter = q.magFilter = THREE.NearestFilter; q.needsUpdate = true;
    // palette: row 0 plate colour, row 1 modern continent colour
    const pal = new Uint8Array(256 * 2 * 4), polys = this.plates.poly;
    const ids = [...new Set(polys.map(p => p.p))].sort((a, b) => a - b);
    this.plateRank = new Map(ids.map((id, i) => [id, i]));
    polys.forEach((p, k) => {
      const c = plateColor(this.plateRank.get(p.p)), d = new THREE.Color(CONTINENT_COLORS[p.k] || '#888');
      pal.set([c.r * 255, c.g * 255, c.b * 255, 255], k * 4);
      pal.set([d.r * 255, d.g * 255, d.b * 255, 255], (256 + k) * 4);
    });
    this.palTex = new THREE.DataTexture(pal, 256, 2, THREE.RGBAFormat);
    this.palTex.minFilter = this.palTex.magFilter = THREE.NearestFilter; this.palTex.needsUpdate = true;
    // colour maps, 256 x 4 (magma, viridis, inferno, turbo)
    const lut = new Uint8Array(256 * 4 * 4);
    ['magma', 'viridis', 'inferno', 'turbo'].forEach((n, row) => { for (let i = 0; i < 256; i++) lut.set([...cmapRGB(n, i / 255), 255], (row * 256 + i) * 4); });
    this.cmapTex = new THREE.DataTexture(lut, 256, 4, THREE.RGBAFormat);
    this.cmapTex.minFilter = this.cmapTex.magFilter = THREE.LinearFilter; this.cmapTex.needsUpdate = true;
    // placeholders until the lazy data arrive
    const one = (r, g, b, a) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; };
    this.blackTex = one(0, 0, 0, 255); this.idxNone = one(255, 0, 0, 255);
  }
  // DEM layers [f0, f0 + n) are in this.dem.rg: copy them to the GPU. Before
  // three.js has made the texture, a full upload carries them; after, only
  // those layers go up (texSubImage3D), not the whole 14 MB array.
  uploadLayers(f0, n) {
    const r = this.renderer, gl = r.getContext(), p = r.properties.get(this.demTex), m = this.core.meta.dem;
    if (!p.__webglTexture || this.demTex.needsUpdate) { this.demTex.needsUpdate = true; return; }
    r.state.bindTexture(gl.TEXTURE_2D_ARRAY, p.__webglTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, f0, m.w, m.h, n, gl.RG, gl.UNSIGNED_BYTE, this.dem.rg.subarray(f0 * m.w * m.h * 2, (f0 + n) * m.w * m.h * 2));
  }

  // ── surface bake ─────────────────────────────────────────────────────────
  buildBake() {
    this.bigSize = this.lite ? [1024, 512] : [2048, 1024]; this.smallSize = this.lite ? [512, 256] : [1024, 512];
    this.bakeBig = this.mrt(this.bigSize); this.bakeSmall = this.mrt(this.smallSize);
    const hrt = ([w, h]) => new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.hBig = hrt(this.bigSize); this.hSmall = hrt(this.smallSize);
    this.hU = { uDem: { value: this.demTex }, uLayA: { value: 0 }, uLayB: { value: 0 }, uMix: { value: 0 }, uDetail: { value: 1 } };
    this.bakeU = {
      uH: { value: this.hSmall.texture }, uIdx: { value: this.idxNone }, uPal: { value: this.palTex }, uCmap: { value: this.cmapTex },
      uTeq: { value: 27 }, uDT: { value: 37.5 }, uSea: { value: 0 }, uVeg: { value: 1 }, uTall: { value: 1 }, uGrass: { value: 1 },
      uTintK: { value: 0.7 }, uMode: { value: 0 }, uTint: { value: 0 },
    };
    const quad = new THREE.PlaneGeometry(2, 2);
    const scene = (frag, uniforms) => {
      const m = new THREE.Mesh(quad, new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: SF.QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false }));
      m.frustumCulled = false; const s = new THREE.Scene(); s.add(m); return s;
    };
    this.hScene = scene(SF.HEIGHT_FRAG, this.hU);
    this.bakeScene = scene(SF.BAKE_FRAG, this.bakeU);
    this.cloudScene = scene(SF.CLOUD_FRAG, {});
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const cw = this.lite ? [1024, 512] : [2048, 1024];
    this.cloudRT = new THREE.WebGLRenderTarget(cw[0], cw[1], { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping });
    this.cloudsBaked = false;
    this.cache = new Map();      // DEM frame -> { rt, key, used }
    this.bakeDirty = true; this.bakeBigDirty = true;
  }
  mrt([w, h]) {
    const rt = new THREE.WebGLMultipleRenderTargets(w, h, 2, { depthBuffer: false });
    for (const t of rt.texture) {
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
    }
    return rt;
  }
  // One bake: the height pass into hRt, the colour pass into rt, for DEM
  // frames a, b mixed by f, with the climate cl.
  bakeInto(rt, hRt, a, b, f, cl) {
    const r = this.renderer, t0 = performance.now(), old = r.getRenderTarget(), S = this.state, H = this.hU, U = this.bakeU;
    H.uLayA.value = a; H.uLayB.value = b; H.uMix.value = f; H.uDetail.value = S.detail;
    U.uTeq.value = cl.teq; U.uDT.value = cl.dT; U.uSea.value = cl.sea; U.uVeg.value = cl.veg; U.uTall.value = cl.tall; U.uGrass.value = cl.grass;
    U.uMode.value = S.mode; U.uTint.value = S.tint; U.uTintK.value = S.tintK; U.uH.value = hRt.texture;
    r.setRenderTarget(hRt); r.render(this.hScene, this.quadCam);
    r.setRenderTarget(rt); r.render(this.bakeScene, this.quadCam);
    r.setRenderTarget(old);
    this.stats.bakes++; this.stats.bakeMs = performance.now() - t0;
  }
  show(rtA, rtB = rtA, k = 0) {
    const U = this.planetU;
    U.uA.value = rtA.texture[0]; U.uB.value = rtA.texture[1]; U.uA2.value = rtB.texture[0]; U.uB2.value = rtB.texture[1]; U.uK.value = k;
  }
  cacheKey() { const S = this.state; return [S.mode, S.tint, S.detail, S.tintK, S.tint ? !!this.idxRT : 0].join('|'); }
  // The cached bake of DEM frame i (made now when it is missing or stale).
  frameBake(i) {
    const key = this.cacheKey(), now = performance.now();
    let e = this.cache.get(i);
    if (e && e.key === key) { e.used = now; return e.rt; }
    if (!e) {
      if (this.cache.size >= CACHE_N) {
        let old = null; for (const [k, v] of this.cache) if (!old || v.used < old[1].used) old = [k, v];
        e = old[1]; this.cache.delete(old[0]);
      } else e = { rt: this.mrt(this.smallSize) };
      this.cache.set(i, e);
    }
    const ti = this.core.meta.dem.times[i];
    if (this.state.tint > 0 && this.idxRT) { this.updateQuats(ti); this.renderIndex(); this.updateQuats(this.t); this.idxDirty = true; }
    this.bakeInto(e.rt, this.hSmall, i, i, 0, climateAt(ti));
    e.key = key; e.used = now; this.stats.lastBake = 'frame ' + i;
    return e.rt;
  }
  bakeExact(big) {
    if (this.state.tint > 0 && this.idxRT && this.idxDirty) this.renderIndex();
    const fr = this.fr || { a: 0, b: 0, f: 0 }, rt = big ? this.bakeBig : this.bakeSmall;
    this.bakeInto(rt, big ? this.hBig : this.hSmall, fr.a, fr.b, fr.f, this.climate || climateAt(Math.max(0, this.t)));
    this.show(rt); this.stats.lastBake = big ? 'big' : 'small';
  }
  // Per frame: pick the bake work for this frame (see the header).
  updateBake(now) {
    const moving = now - (this.ageMovedAt || 0) < 250, fr = this.fr;
    if (this.bakeDirty) {
      this.bakeDirty = false;
      if (moving && fr && this.t >= PAIR_MIN && this.dem.loaded[fr.a] && this.dem.loaded[fr.b]) {
        const A = this.frameBake(fr.a), B = fr.b === fr.a ? A : this.frameBake(fr.b);
        this.show(A, B, fr.f);
      } else this.bakeExact(false);
    } else if (this.bakeBigDirty && !moving) { this.bakeBigDirty = false; this.bakeExact(true); }
  }
  bakeClouds() {
    const r = this.renderer, old = r.getRenderTarget();
    r.setRenderTarget(this.cloudRT); r.render(this.cloudScene, this.quadCam); r.setRenderTarget(old);
    this.cloudsBaked = true;
  }

  buildPlanet() {
    const seg = this.lite ? [144, 72] : [192, 96];
    this.planetU = {
      uA: { value: this.blackTex }, uB: { value: this.blackTex }, uA2: { value: this.blackTex }, uB2: { value: this.blackTex }, uK: { value: 0 },
      uCloud: { value: this.cloudRT.texture }, uLights: { value: this.blackTex },
      uSun: { value: new THREE.Vector3(1, 0, 0) }, uRot: { value: new THREE.Matrix3() }, uExag: { value: 20 }, uExposure: { value: 0.3 },
      uHill: { value: 1 }, uHillAz: { value: 315 }, uHillAlt: { value: 40 }, uCloudT: { value: 0 }, uClouds: { value: 1 }, uLightsK: { value: 0 },
      uQuality: { value: this.lite ? 0 : 1 }, uTime: { value: 0 }, uWet: { value: 0 }, uStorm: { value: 0 }, uMode: { value: 0 },
    };
    this.earthU = this.planetU;   // saver.js and main.js read earthU.uExposure
    const mat = new THREE.ShaderMaterial({ uniforms: this.planetU, vertexShader: SF.PLANET_VERT, fragmentShader: SF.PLANET_FRAG });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, seg[0], seg[1]), mat);
    this.group.add(this.earth);
    this.skyU = { uSun: this.planetU.uSun, uExposure: this.planetU.uExposure, uQuality: this.planetU.uQuality, uMap: { value: 0 } };
    const sky = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SH.SKY_VERT, fragmentShader: SH.SKY_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1.0157, 64, 32), sky);
    this.sky.renderOrder = 1;
    this.scene.add(this.sky);
  }

  // ── lazy layers ──────────────────────────────────────────────────────────
  attachLazy(k, v) {
    this.data[k] = v;
    if (k === 'raster') { this.plates.setRaster(v); this.buildIndex(); for (const p of this.pins) this.repin(p); }
    if (k === 'over') this.buildLines();
    if (k === 'fossils') this.buildFossils();
    if (k === 'cities') this.buildLights();
    if (k === 'bounds') { this.boundGeo = new Map(); this.bounds = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial('#ffffff', 0.85, 1.0022)); this.bounds.frustumCulled = false; this.bounds.renderOrder = 4; this.group.add(this.bounds); this.boundIdx = -1; }
    this.applyLayers();
    if (this.t >= 0) this.setAge(this.t, this.climate, true);
  }
  // City lights from Natural Earth places, splatted by population.
  buildLights() {
    const cv = document.createElement('canvas'); cv.width = this.lite ? 1024 : 2048; cv.height = cv.width / 2;
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'lighter';
    const W = cv.width, H = cv.height;
    for (const c of this.data.cities.rows) {
      const pop = c[4]; if (pop < 20000) continue;
      const x = (c[3] + 180) / 360 * W, y = (90 - c[2]) / 180 * H;
      const rad = Math.max(0.8, Math.sqrt(pop) / 900) * W / 2048 * 2.2;
      const a = Math.min(0.9, 0.12 + Math.log10(pop) / 14);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad * 2.2);
      gr.addColorStop(0, `rgba(255,220,170,${a})`); gr.addColorStop(0.35, `rgba(255,170,90,${a * 0.45})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad * 2.2, y - rad * 2.2, rad * 4.4, rad * 4.4);
    }
    const t = this.lightsTex = new THREE.CanvasTexture(cv);
    t.flipY = true;   // canvas row 0 = north; the shader's v = 1 is north
    t.colorSpace = THREE.NoColorSpace; t.wrapS = THREE.RepeatWrapping;
    this.planetU.uLights.value = t;
  }
  buildStars() {
    // A seeded random sky: magnitudes from an exponential count law, and
    // colours from blue-white to orange.
    let s = 7;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const n = this.lite ? 2500 : 5000, pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(th) * 60, u * 60, r * Math.sin(th) * 60], i * 3);
      mag[i] = 6.5 - Math.log(1 + rnd() * 400) / Math.log(400) * 6.5 + 0.8;
      const k = rnd(), c = k < 0.15 ? [0.75, 0.85, 1] : k < 0.7 ? [1, 0.97, 0.92] : k < 0.9 ? [1, 0.88, 0.7] : [1, 0.75, 0.55];
      col.set(c, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starU = { uPix: { value: 1 } };
    const m = new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: SH.STAR_VERT, fragmentShader: SH.STAR_FRAG, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true });
    this.stars = new THREE.Points(g, m);
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
  }

  // ── lines that ride plates ───────────────────────────────────────────────
  lineMaterial(color, opacity, r) {
    return new THREE.ShaderMaterial({
      uniforms: { uQ: { value: this.qTex }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uR: { value: r } },
      vertexShader: SH.RIDE + SH.LINE_VERT, fragmentShader: SH.LINE_FRAG, transparent: true, depthWrite: false,
    });
  }
  // runs: [[poly, lon*100, lat*100, ...], ...]  (closed: repeat the first point)
  lineGeometry(runs, closed = false, colorOf = null) {
    let n = 0;
    for (const r of runs) { const m = (r.length - 1) / 2; n += (closed ? m : m - 1) * 2; }
    const ll = new Float32Array(n * 2), poly = new Float32Array(n), col = new Float32Array(n * 3).fill(1);
    let o = 0;
    for (const r of runs) {
      const k = r[0], m = (r.length - 1) / 2, c = colorOf ? colorOf(r) : null;
      const put = i => { ll[o * 2] = r[2 + 2 * i] / 100 * D2R; ll[o * 2 + 1] = r[1 + 2 * i] / 100 * D2R; poly[o] = k; if (c) col.set(c, o * 3); o++; };
      for (let i = 0; i < m - 1; i++) { put(i); put(i + 1); }
      if (closed && m > 2) { put(m - 1); put(0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('ll', new THREE.BufferAttribute(ll, 2));
    g.setAttribute('poly', new THREE.BufferAttribute(poly, 1));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // three.js counts vertices from 'position'; the shader does not read it
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    // the vertex shader moves the points: never cull the geometry
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    return g;
  }
  buildGrid() {
    const mk = (runs, color, op, r) => { const l = new THREE.LineSegments(this.lineGeometry(runs), this.lineMaterial(color, op, r)); l.frustumCulled = false; l.renderOrder = 3; this.group.add(l); return l; };
    // paleo grid: every 15 deg, fixed to the globe (poly 255)
    const grid = [], eq = [], trop = [];
    for (let la = -75; la <= 75; la += 15) { const run = [255]; for (let lo = -180; lo <= 180; lo += 3) run.push(lo * 100, la * 100); (la === 0 ? eq : grid).push(run); }
    for (let lo = -180; lo < 180; lo += 15) { const run = [255]; for (let la = -90; la <= 90; la += 3) run.push(lo * 100, la * 100); grid.push(run); }
    for (const la of [23.44, -23.44, 66.56, -66.56]) for (let lo = -180; lo < 180; lo += 4) trop.push([255, lo * 100, la * 100, (lo + 2) * 100, la * 100]);
    this.grid = mk(grid, '#a9c4e8', 0.16, 1.0012);
    this.equator = mk(eq, '#ffb46b', 0.75, 1.0013);
    this.tropics = mk(trop, '#ffd28a', 0.3, 1.0013);
  }
  buildLines() {
    const o = this.data.over;
    const mk = (runs, color, op, r, closed, colorOf) => { const l = new THREE.LineSegments(this.lineGeometry(runs, closed, colorOf), this.lineMaterial(color, op, r)); l.frustumCulled = false; l.renderOrder = 3; this.group.add(l); return l; };
    this.coast = mk(o.coast, '#e8f4ff', 0.45, 1.0016);
    this.borders = mk(o.borders, '#ffd9a8', 0.38, 1.0017);
    const rings = [];
    this.plates.poly.forEach((p, k) => p.r.forEach(ring => rings.push([k, ...ring])));
    this.terranes = mk(rings, '#ffffff', 0.5, 1.0018, true, r => { const c = plateColor(this.plateRank.get(this.plates.poly[r[0]].p)); return [c.r, c.g, c.b]; });
  }
  boundaryFrame(i) {
    if (this.boundGeo.has(i)) return this.boundGeo.get(i);
    const TY = [[1, 0.35, 0.3], [1, 0.82, 0.3], [0.45, 0.95, 0.6], [0.8, 0.5, 1], [0.8, 0.8, 0.85]];
    const runs = this.data.bounds.frames[i].map(r => { const q = [255, ...r.slice(1)]; q.type = r[0]; return q; });
    const g = this.lineGeometry(runs, false, r => TY[r.type] || TY[4]);
    this.boundGeo.set(i, g);
    return g;
  }

  // ── paleo polygon index map ──────────────────────────────────────────────
  buildIndex() {
    const R = this.plates, W = R.rw, H = R.rh, pts = [];
    for (let j = 0; j < H; j += 2) for (let i = 0; i < W; i += 2) {
      let k = R.raster[j * W + i];
      if (k === 255) k = R.raster[j * W + i + 1];
      if (k === 255) k = R.raster[(j + 1) * W + i];
      if (k === 255) continue;
      pts.push(-90 + (j + 1) * R.rstep, -180 + (i + 1) * R.rstep, k);
    }
    const n = pts.length / 3, ll = new Float32Array(n * 2), poly = new Float32Array(n);
    for (let i = 0; i < n; i++) { ll[2 * i] = pts[3 * i] * D2R; ll[2 * i + 1] = pts[3 * i + 1] * D2R; poly[i] = pts[3 * i + 2]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('ll', new THREE.BufferAttribute(ll, 2));
    g.setAttribute('poly', new THREE.BufferAttribute(poly, 1));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.ShaderMaterial({ uniforms: { uQ: { value: this.qTex } }, vertexShader: SH.RIDE + SH.IDX_VERT, fragmentShader: SH.IDX_FRAG, depthTest: false, depthWrite: false });
    this.idxPts = new THREE.Points(g, m); this.idxPts.frustumCulled = false;
    this.idxScene = new THREE.Scene(); this.idxScene.add(this.idxPts);
    this.idxRT = new THREE.WebGLRenderTarget(720, 360, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.bakeU.uIdx.value = this.idxRT.texture;
    this.idxDirty = true;
  }
  renderIndex() {
    const r = this.renderer, old = r.getRenderTarget(), oc = r.getClearColor(new THREE.Color()), oa = r.getClearAlpha();
    r.setRenderTarget(this.idxRT); r.setClearColor(0xff0000, 1); r.clear(true, false, false);
    r.render(this.idxScene, this.quadCam);
    r.setRenderTarget(old); r.setClearColor(oc, oa);
    this.idxDirty = false;
  }

  // ── fossils ──────────────────────────────────────────────────────────────
  buildFossils() {
    if (this.fossils) { this.group.remove(this.fossils); this.fossils.geometry.dispose(); }
    const rows = this.data.fossils.rows, n = rows.length, GC = this.fossilColors;
    const ll = new Float32Array(n * 2), poly = new Float32Array(n), age = new Float32Array(n * 2), col = new Float32Array(n * 3), c = new THREE.Color();
    rows.forEach((r, i) => {
      ll[2 * i] = r[4] * D2R; ll[2 * i + 1] = r[5] * D2R; poly[i] = r[6] === 255 ? 254 : r[6];
      age[2 * i] = r[2]; age[2 * i + 1] = r[3];
      c.set(GC[r[1]] || '#fff'); col.set([c.r, c.g, c.b], 3 * i);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('ll', new THREE.BufferAttribute(ll, 2)); g.setAttribute('poly', new THREE.BufferAttribute(poly, 1));
    g.setAttribute('age', new THREE.BufferAttribute(age, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.fossilU = this.fossilU || { uQ: { value: this.qTex }, uT: { value: 0 }, uWin: { value: 2 }, uSize: { value: 7 }, uPix: { value: this.pixelRatio || 1 } };
    const m = new THREE.ShaderMaterial({ uniforms: this.fossilU, vertexShader: SH.RIDE + SH.PTS_VERT, fragmentShader: SH.PTS_FRAG, transparent: true, depthWrite: false });
    this.fossils = new THREE.Points(g, m); this.fossils.frustumCulled = false; this.fossils.renderOrder = 5;
    this.group.add(this.fossils);
  }

  applyLayers() {
    const L = this.layers, v = (o, on) => { if (o) o.visible = on; };
    v(this.coast, L.coast); v(this.borders, L.borders); v(this.terranes, L.terranes);
    v(this.grid, L.grid); v(this.equator, L.grid); v(this.tropics, L.grid);
    v(this.bounds, L.bounds && this.boundsAvailable); v(this.fossils, L.fossils);
  }
  setLayer(k, on) { this.layers[k] = on; this.applyLayers(); }

  // ── age ──────────────────────────────────────────────────────────────────
  updateQuats(t) {
    const q = this.qData, P = this.plates;
    q.fill(0);
    for (let k = 0; k < P.poly.length && k < 254; k++) {
      if (!P.alive(k, t)) continue;
      const r = P.quatOfPoly(k, t);
      q.set([r[1], r[2], r[3], r[0]], k * 4);
    }
    // 254 stays zero: fossils on old sea floor (no polygon) do not show.
    q.set([0, 0, 0, 1], 255 * 4);   // fixed to the paleo grid
    this.qTex.needsUpdate = true;
  }
  // Frames for age t from those loaded; the nearest loaded frame when the
  // pair at t is not in yet.
  framesFor(t) {
    const M = this.core.meta.dem, fr = framesAt(M.times, t), L = this.dem.loaded;
    if (L[fr.a] && L[fr.b]) return fr;
    let best = -1, bd = 1e9;
    for (let i = 0; i < L.length; i++) if (L[i] && Math.abs(M.times[i] - t) < bd) { bd = Math.abs(M.times[i] - t); best = i; }
    return best < 0 ? null : { a: best, b: best, f: 0 };
  }
  markDirty() { this.bakeDirty = true; this.bakeBigDirty = true; }
  setAge(t, climate, force = false) {
    const now = performance.now();
    if (this.t >= 0 && t !== this.t) {
      // age speed (Myr per s), smoothed: it drives the weather churn
      const dt = Math.max(1, now - this.lastAgeAt) / 1000;
      this.ageRate = this.ageRate * 0.8 + 0.2 * Math.min(200, Math.abs(t - this.t) / dt);
      this.lastAgeAt = now;
    }
    this.fr = this.framesFor(t);
    if (climate) {
      this.climate = climate;
      // clouds: warmer worlds are wetter, storm tracks move poleward
      this.planetU.uWet.value = Math.max(0, Math.min(1, (climate.gmst - 14) / 14));
      this.planetU.uStorm.value = Math.max(-1, Math.min(1, (climate.gmst - 18) / 10));
    }
    this.planetU.uLightsK.value = this.lightsTex ? Math.max(0, 1 - t / 0.004) : 0;
    if (t !== this.t || force) {
      if (t !== this.t) { this.updateQuats(t); this.idxDirty = true; }
      this.markDirty(); if (t !== this.t) this.ageMovedAt = now;
    }
    this.t = t;
    if (this.fossilU) this.fossilU.uT.value = t;
    const B = this.data.bounds;
    if (B) {
      const bi = Math.round(t / 5), has = bi < B.times.length && Math.abs(B.times[bi] - t) <= 2.5;
      if (has && this.boundIdx !== bi) { this.bounds.geometry = this.boundaryFrame(bi); this.boundIdx = bi; }
      this.boundsAvailable = has;
    } else this.boundsAvailable = false;
    this.applyLayers();
    for (const p of this.pins) this.placePin(p);
  }
  setStyle(o) {
    Object.assign(this.state, o);
    const S = this.state, U = this.planetU;
    if (Object.keys(o).some(k => ['mode', 'tint', 'detail', 'tintK'].includes(k))) this.markDirty();
    U.uMode.value = S.mode; U.uExag.value = S.exag; U.uHill.value = S.hill; U.uHillAz.value = S.hillAz;
    U.uHillAlt.value = S.hillAlt; U.uClouds.value = S.clouds; U.uExposure.value = S.exposure;
    this.skyU.uMap.value = S.mode === 0 ? 0 : 1;
  }
  // A DEM chunk is in: upload its layers, drop cached bakes that used a
  // stand-in frame, and re-bake if the age now has better frames.
  onDemChunk(f0, n) {
    this.uploadLayers(f0, n);
    for (let i = f0; i < f0 + n; i++) this.cache.delete(i);
    if (this.t >= 0) { const a = this.fr, b = this.framesFor(this.t); if (!a || !b || a.a !== b.a || a.b !== b.b) this.setAge(this.t, this.climate, true); }
  }
  // ── sun ──────────────────────────────────────────────────────────────────
  // 'view': fixed to the camera (az left/right, el up, from the view
  // direction), so the lit face and the terminator stay in view.
  // 'clock': the subsolar point from the day of year (declination) and the
  // hour at longitude 0 (paleo-frame), turned with the globe.
  sunDir(out = new THREE.Vector3()) {
    const S = this.sun;
    if (S.mode === 'clock') {
      const dec = 23.44 * Math.sin(2 * Math.PI * (S.day - 80) / 365.25);
      const lon = (12 - S.hour) * 15;
      out.copy(llToThree(dec, lon)).applyQuaternion(this.group.quaternion);
      return out;
    }
    const cam = this.camera, f = cam.position.clone().normalize();
    const right = new THREE.Vector3().crossVectors(cam.up, f).normalize();
    const up = new THREE.Vector3().crossVectors(f, right).normalize();
    const a = S.az * D2R, e = S.el * D2R;
    return out.copy(f).multiplyScalar(Math.cos(a) * Math.cos(e)).addScaledVector(right, Math.sin(a) * Math.cos(e)).addScaledVector(up, Math.sin(e)).normalize();
  }

  // ── picking and projection ───────────────────────────────────────────────
  // client px -> paleo { lat, lon } on the globe, or null
  pick(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction, b = o.dot(d), c = o.lengthSq() - 1, h = b * b - c;
    if (h < 0) return null;
    const p = o.clone().addScaledVector(d, -b - Math.sqrt(h));
    p.applyQuaternion(this.group.quaternion.clone().invert());
    return { lat: Math.asin(Math.max(-1, Math.min(1, p.y))) / D2R, lon: Math.atan2(p.x, p.z) / D2R };
  }
  // a globe-frame point (THREE.Vector3, radius ~1) -> { x, y, front } in
  // CSS px. Scratch vectors, no allocation: labels call this hundreds of
  // times per draw.
  project(v, out = {}) {
    const w = _pw.copy(v).applyQuaternion(this.group.quaternion);
    const cam = this.camera.position;
    const front = (w.x * (cam.x - w.x) + w.y * (cam.y - w.y) + w.z * (cam.z - w.z)) / (w.length() * Math.hypot(cam.x - w.x, cam.y - w.y, cam.z - w.z));
    w.project(this.camera);
    out.x = (w.x + 1) / 2 * this.cssW; out.y = (1 - w.y) / 2 * this.cssH; out.front = front;
    return out;
  }
  projectLL(lat, lon, r = 1.002, out = {}) { return this.project(llToThreeInto(_pl, lat, lon, r), out); }

  // ── pins ─────────────────────────────────────────────────────────────────
  addPin(lat, lon, color = '#ffcf5a', name = '') {
    const pin = { lat, lon, poly: this.plates.polyAt(lat, lon), color, name, trail: null, mesh: null, path: [] };
    this.buildTrail(pin);
    const mk = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 16, 12), new THREE.MeshBasicMaterial({ color }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.019, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    mk.add(dot, ring); mk.renderOrder = 7;
    pin.mesh = mk; pin.ring = ring;
    this.group.add(mk);
    this.pins.push(pin);
    this.placePin(pin);
    return pin;
  }
  // The pin's path at every 1 Myr back to its polygon's begin age, and the
  // trail line through it.
  buildTrail(pin) {
    const P = this.plates, k = pin.poly;
    if (pin.trail) { this.group.remove(pin.trail); pin.trail.geometry.dispose(); pin.trail.material.dispose(); pin.trail = null; }
    pin.path = [];
    const begin = k >= 0 ? Math.min(540, P.poly[k].b) : 0;
    const pos = [], ages = [];
    for (let t = 0; t <= begin + 1e-9; t += 1) {
      const r = P.reconstruct(pin.lat, pin.lon, t, k);
      if (!r) break;
      pin.path.push([t, r.lat, r.lon]);
      const v = threeOf(r.v).multiplyScalar(1.004); pos.push(v.x, v.y, v.z); ages.push(t);
    }
    if (pos.length > 3) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('age', new THREE.BufferAttribute(new Float32Array(ages), 1));
      const m = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(pin.color) }, uT: { value: this.t } }, vertexShader: SH.TRAIL_VERT, fragmentShader: SH.TRAIL_FRAG, transparent: true, depthWrite: false });
      pin.trail = new THREE.Line(g, m); pin.trail.renderOrder = 6; pin.trail.frustumCulled = false;
      this.group.add(pin.trail);
    }
  }
  // The raster came in after the pin: find its polygon and its trail now.
  repin(p) {
    const k = this.plates.polyAt(p.lat, p.lon);
    if (k === p.poly) return;
    p.poly = k; this.buildTrail(p); this.placePin(p);
  }
  placePin(p) {
    const r = this.plates.reconstruct(p.lat, p.lon, Math.max(0, this.t), p.poly);
    p.now = r;
    p.mesh.visible = !!r;
    if (p.trail) p.trail.material.uniforms.uT.value = this.t;
    if (!r) return;
    const v = threeOf(r.v);
    p.mesh.position.copy(v).multiplyScalar(1.004);
    p.ring.lookAt(v.clone().multiplyScalar(2));
  }
  removePin(p) {
    this.pins = this.pins.filter(q => q !== p);
    for (const o of [p.trail, p.mesh]) if (o) { this.group.remove(o); o.traverse(c => { c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }); }
  }

  // ── frame ────────────────────────────────────────────────────────────────
  resize(w, h) {
    this.cssW = w; this.cssH = h;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.rs) this.rs.resize(); else this.applyScale({ w: w * Math.min(devicePixelRatio || 1, 2), h });
  }
  render(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000); this.lastFrame = now;
    if (this.rs) this.rs.tick(now);
    this.controls.update();
    if (!this.cloudsBaked) this.bakeClouds();
    this.updateBake(now);
    const U = this.planetU;
    U.uTime.value = (now - this.time0) / 1000;
    // weather: the clouds drift slowly at rest and churn while time moves
    if (now - (this.lastAgeAt || 0) > 300) this.ageRate *= 0.9;
    this.cloudT += dt * (0.012 + 0.05 * Math.min(60, this.ageRate));
    U.uCloudT.value = this.cloudT;
    this.sunDir(U.uSun.value);
    this.group.updateMatrixWorld();
    U.uRot.value.setFromMatrix4(this.group.matrixWorld);
    const pulse = 1 + 0.18 * Math.sin(now / 260);
    for (const p of this.pins) p.ring.scale.setScalar(pulse);
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrameAt) this.firstFrameAt = performance.now();
  }
  // Free every GPU object (targets, textures, geometry) and the context.
  dispose() {
    this.controls.dispose();
    const rts = [this.bakeBig, this.bakeSmall, this.hBig, this.hSmall, this.cloudRT, this.idxRT, ...[...this.cache.values()].map(e => e.rt)];
    for (const rt of rts) if (rt) rt.dispose();
    for (const t of [this.demTex, this.qTex, this.palTex, this.cmapTex, this.blackTex, this.idxNone, this.lightsTex]) if (t) t.dispose();
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
const FOSSIL_COLORS = { 'dinosaur': '#ff7b54', 'bird': '#ffd166', 'pterosaur': '#f4a3ff', 'marine reptile': '#4cc9f0', 'trilobite': '#c9b37e', 'early synapsid': '#e07a5f',
  'mammal': '#90e0a8', 'ammonite': '#b8c0ff', 'early tetrapod': '#a3d977', 'armoured fish': '#7fd1c8', 'hominid': '#ffffff' };
