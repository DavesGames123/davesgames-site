// ============================================================================
//  ANCIENT EARTH  ·  globe.js  ·  the three.js globe
// ----------------------------------------------------------------------------
//  One WebGL 2 canvas. Draw order:
//    stars (world-fixed points) -> earth (shaders.js EARTH_FRAG) -> sky
//    shell (in-scatter for rays that miss the planet, additive) -> overlay
//    lines, fossil points, pins and trails (depth-tested against the earth,
//    raised 0.15-0.4% of the radius, so nothing z-fights the surface).
//  The globe group holds the earth and every overlay; its Y spin is the
//  "slow rotation". The camera orbits (OrbitControls).
//
//  Axes: a point at (lat, lon) is (cos lat sin lon, sin lat, cos lat cos
//  lon) in the globe group. The DEM is in paleo-coordinates, so the earth
//  shader reads it at the fragment's own lat/lon. Things on present-day
//  crust ride their plate: a 256x1 float texture holds one quaternion per
//  polygon (recon.js), and the vertex shaders rotate by it (RIDE).
//
//  The plate tint needs the polygon under each paleo point: a 720x360
//  target gets one point per present-day 0.5 deg land cell, drawn at its
//  reconstructed place (IDX_*). The earth shader reads that map.
//
//  grep -n targets
//    set the age ........... "setAge("
//    quaternion texture .... "function updateQuats"
//    overlay lines ......... "function lineGeometry"
//    index map ............. "renderIndex("
//    sun direction ......... "sunDir("
//    picking ............... "pick("
//    screen projection ..... "project("
//    pins and trails ....... "addPin("
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as SH from './shaders.js';
import { framesAt, prepareDem } from './data.js';

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
export function llToThree(lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R;
  return new THREE.Vector3(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r);
}

export class Globe {
  constructor(canvas, data, plates, opt = {}) {
    this.canvas = canvas; this.data = data; this.plates = plates;
    this.lite = !!opt.lite;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lite, powerPreference: 'high-performance', preserveDrawingBuffer: !!opt.keep });
    r.setClearColor(0x000000, 1);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;   // the shaders encode sRGB themselves
    this.pixCap = this.lite ? 1.5 : 2;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.pixCap));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    this.camera.position.set(0, 0.55, 3.6);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.45, zoomSpeed: 0.7, minDistance: 1.22, maxDistance: 9 });
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.t = -1; this.state = { mode: 0, tint: 0, exag: 20, hill: 1, hillAz: 315, hillAlt: 40, clouds: 1, detail: 1, exposure: 0.3, tintK: 0.7 };
    this.sun = { mode: 'view', az: -38, el: 20, day: 172, hour: 12 };
    this.time0 = performance.now();
    this.buildTextures();
    this.buildEarth();
    this.buildStars();
    this.buildLines();
    this.buildIndex();
    this.buildFossils();
    this.pins = [];
    this.layers = { coast: true, borders: false, terranes: false, bounds: false, grid: true, fossils: true };
    this.applyLayers();
  }

  // ── textures ──────────────────────────────────────────────────────────────
  buildTextures() {
    const m = this.data.meta.dem;
    const rg = prepareDem(this.data.dem, m);
    const dem = this.demTex = new THREE.DataArrayTexture(rg, m.w, m.h, m.times.length);
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
      const c = plateColor(this.plateRank.get(p.p));
      const d = new THREE.Color(CONTINENT_COLORS[p.k] || '#888');
      pal.set([c.r * 255, c.g * 255, c.b * 255, 255], k * 4);
      pal.set([d.r * 255, d.g * 255, d.b * 255, 255], (256 + k) * 4);
    });
    this.palTex = new THREE.DataTexture(pal, 256, 2, THREE.RGBAFormat);
    this.palTex.minFilter = this.palTex.magFilter = THREE.NearestFilter; this.palTex.needsUpdate = true;
    // colour maps, 256 x 4 (magma, viridis, inferno, turbo)
    const lut = new Uint8Array(256 * 4 * 4);
    ['magma', 'viridis', 'inferno', 'turbo'].forEach((n, row) => {
      for (let i = 0; i < 256; i++) lut.set([...cmapRGB(n, i / 255), 255], (row * 256 + i) * 4);
    });
    this.lutTex = new THREE.DataTexture(lut, 256, 4, THREE.RGBAFormat);
    this.lutTex.minFilter = this.lutTex.magFilter = THREE.LinearFilter; this.lutTex.needsUpdate = true;
    // city lights from Natural Earth places, splatted by population
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
    this.lightsTex = new THREE.CanvasTexture(cv);
    this.lightsTex.flipY = true;   // canvas row 0 = north; the shader's v = 1 is north
    this.lightsTex.colorSpace = THREE.NoColorSpace;
  }

  buildEarth() {
    const seg = this.lite ? [144, 72] : [256, 128];
    this.earthU = {
      uDem: { value: this.demTex }, uIdx: { value: null }, uPal: { value: this.palTex }, uLights: { value: this.lightsTex }, uLut: { value: this.lutTex },
      uLayA: { value: 0 }, uLayB: { value: 0 }, uMix: { value: 0 }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uRot: { value: new THREE.Matrix3() },
      uTime: { value: 0 }, uExag: { value: 20 }, uSea: { value: 0 }, uTeq: { value: 27 }, uDT: { value: 37 }, uVeg: { value: 1 }, uTall: { value: 1 }, uGrass: { value: 1 },
      uLightsK: { value: 0 }, uClouds: { value: 1 }, uExposure: { value: 0.3 }, uMode: { value: 0 }, uTint: { value: 0 }, uHill: { value: 1 }, uHillAz: { value: 315 },
      uHillAlt: { value: 40 }, uTintK: { value: 0.7 }, uDetail: { value: 1 }, uQuality: { value: this.lite ? 0 : 1 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.earthU, vertexShader: SH.EARTH_VERT, fragmentShader: SH.EARTH_FRAG });
    mat.extensions = { derivatives: true };
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, seg[0], seg[1]), mat);
    this.group.add(this.earth);
    this.skyU = { uSun: this.earthU.uSun, uExposure: this.earthU.uExposure, uQuality: this.earthU.uQuality, uMap: { value: 0 } };
    const sky = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SH.SKY_VERT, fragmentShader: SH.SKY_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1.0157, 96, 48), sky);
    this.sky.renderOrder = 1;
    this.scene.add(this.sky);
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
  buildLines() {
    const o = this.data.over;
    const mk = (runs, color, op, r, closed, colorOf) => { const l = new THREE.LineSegments(this.lineGeometry(runs, closed, colorOf), this.lineMaterial(color, op, r)); l.frustumCulled = false; l.renderOrder = 3; this.group.add(l); return l; };
    this.coast = mk(o.coast, '#e8f4ff', 0.45, 1.0016);
    this.borders = mk(o.borders, '#ffd9a8', 0.38, 1.0017);
    // terrane outlines: each ring of each polygon, in its plate colour
    const rings = [];
    this.plates.poly.forEach((p, k) => p.r.forEach(ring => rings.push([k, ...ring])));
    this.terranes = mk(rings, '#ffffff', 0.5, 1.0018, true, r => { const c = plateColor(this.plateRank.get(this.plates.poly[r[0]].p)); return [c.r, c.g, c.b]; });
    // paleo grid: every 15 deg, fixed to the globe (poly 255)
    const grid = [], eq = [];
    for (let la = -75; la <= 75; la += 15) { const run = [255]; for (let lo = -180; lo <= 180; lo += 3) run.push(lo * 100, la * 100); (la === 0 ? eq : grid).push(run); }
    for (let lo = -180; lo < 180; lo += 15) { const run = [255]; for (let la = -90; la <= 90; la += 3) run.push(lo * 100, la * 100); grid.push(run); }
    const trop = [];
    for (const la of [23.44, -23.44, 66.56, -66.56]) { for (let lo = -180; lo < 180; lo += 4) trop.push([255, lo * 100, la * 100, (lo + 2) * 100, la * 100]); }
    this.grid = mk(grid, '#a9c4e8', 0.16, 1.0012);
    this.equator = mk(eq, '#ffb46b', 0.75, 1.0013);
    this.tropics = mk(trop, '#ffd28a', 0.3, 1.0013);
    this.boundGeo = new Map();
    this.bounds = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial('#ffffff', 0.85, 1.0022));
    this.bounds.frustumCulled = false; this.bounds.renderOrder = 4; this.group.add(this.bounds);
  }
  boundaryFrame(i) {
    if (this.boundGeo.has(i)) return this.boundGeo.get(i);
    const TY = [[1, 0.35, 0.3], [1, 0.82, 0.3], [0.45, 0.95, 0.6], [0.8, 0.5, 1], [0.8, 0.8, 0.85]];
    const runs = this.data.bounds.frames[i].map(r => [255, ...r.slice(1)]);
    const g = this.lineGeometry(runs, false, r => TY[this.data.bounds.frames[i][runs.indexOf(r)][0]] || TY[4]);
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
    this.idxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.idxRT = new THREE.WebGLRenderTarget(720, 360, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.earthU.uIdx.value = this.idxRT.texture;
    this.idxDirty = true;
  }
  renderIndex() {
    const r = this.renderer, old = r.getRenderTarget(), oc = r.getClearColor(new THREE.Color()), oa = r.getClearAlpha();
    r.setRenderTarget(this.idxRT); r.setClearColor(0xff0000, 1); r.clear(true, false, false);
    r.render(this.idxScene, this.idxCam);
    r.setRenderTarget(old); r.setClearColor(oc, oa);
    this.idxDirty = false;
  }

  // ── fossils ──────────────────────────────────────────────────────────────
  buildFossils() {
    const F = this.data.fossils, rows = F.rows, n = rows.length;
    const GC = { 'dinosaur': '#ff7b54', 'bird': '#ffd166', 'pterosaur': '#f4a3ff', 'marine reptile': '#4cc9f0', 'trilobite': '#c9b37e', 'early synapsid': '#e07a5f',
      'mammal': '#90e0a8', 'ammonite': '#b8c0ff', 'early tetrapod': '#a3d977', 'armoured fish': '#7fd1c8', 'hominid': '#ffffff' };
    this.fossilColors = GC;
    const ll = new Float32Array(n * 2), poly = new Float32Array(n), age = new Float32Array(n * 2), col = new Float32Array(n * 3);
    rows.forEach((r, i) => {
      ll[2 * i] = r[4] * D2R; ll[2 * i + 1] = r[5] * D2R; poly[i] = r[6] === 255 ? 254 : r[6];
      age[2 * i] = r[2]; age[2 * i + 1] = r[3];
      const c = new THREE.Color(GC[r[1]] || '#fff'); col.set([c.r, c.g, c.b], 3 * i);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('ll', new THREE.BufferAttribute(ll, 2)); g.setAttribute('poly', new THREE.BufferAttribute(poly, 1));
    g.setAttribute('age', new THREE.BufferAttribute(age, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.fossilU = { uQ: { value: this.qTex }, uT: { value: 0 }, uWin: { value: 2 }, uSize: { value: 7 }, uPix: { value: 1 } };
    const m = new THREE.ShaderMaterial({ uniforms: this.fossilU, vertexShader: SH.RIDE + SH.PTS_VERT, fragmentShader: SH.PTS_FRAG, transparent: true, depthWrite: false });
    this.fossils = new THREE.Points(g, m); this.fossils.frustumCulled = false; this.fossils.renderOrder = 5;
    this.group.add(this.fossils);
  }

  applyLayers() {
    const L = this.layers;
    this.coast.visible = L.coast; this.borders.visible = L.borders; this.terranes.visible = L.terranes;
    this.grid.visible = this.equator.visible = this.tropics.visible = L.grid;
    this.bounds.visible = L.bounds; this.fossils.visible = L.fossils;
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
  setAge(t, climate) {
    const m = this.data.meta.dem, fr = framesAt(m.times, t);
    const U = this.earthU;
    U.uLayA.value = fr.a; U.uLayB.value = fr.b; U.uMix.value = fr.f;
    if (climate) {
      U.uTeq.value = climate.teq; U.uDT.value = climate.dT; U.uSea.value = climate.sea;
      U.uVeg.value = climate.veg; U.uTall.value = climate.tall; U.uGrass.value = climate.grass;
    }
    U.uLightsK.value = Math.max(0, 1 - t / 0.004);
    if (t !== this.t) { this.updateQuats(t); this.idxDirty = true; }
    this.t = t;
    this.fossilU.uT.value = t;
    // plate boundaries: the nearest 5 Myr frame, when the model has one
    const B = this.data.bounds, bi = Math.round(t / 5);
    const has = bi < B.times.length && Math.abs(B.times[bi] - t) <= 2.5;
    if (has && this.boundIdx !== bi) { this.bounds.geometry = this.boundaryFrame(bi); this.boundIdx = bi; }
    this.bounds.visible = this.layers.bounds && has;
    this.boundsAvailable = has;
    for (const p of this.pins) this.placePin(p);
  }
  setStyle(o) {
    Object.assign(this.state, o);
    const S = this.state, U = this.earthU;
    U.uMode.value = S.mode; U.uTint.value = S.tint; U.uExag.value = S.exag; U.uHill.value = S.hill; U.uHillAz.value = S.hillAz;
    U.uHillAlt.value = S.hillAlt; U.uClouds.value = S.clouds; U.uDetail.value = S.detail; U.uExposure.value = S.exposure; U.uTintK.value = S.tintK;
    this.skyU.uMap.value = S.mode === 0 ? 0 : 1;
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
  // a globe-frame point (THREE.Vector3, radius ~1) -> { x, y, front } in CSS px
  project(v, out = {}) {
    const w = v.clone().applyQuaternion(this.group.quaternion);
    const cam = this.camera.position;
    const front = w.dot(cam.clone().sub(w).normalize()) / w.length();
    w.project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    out.x = (w.x + 1) / 2 * r.width; out.y = (1 - w.y) / 2 * r.height; out.front = front;
    return out;
  }
  projectLL(lat, lon, r = 1.002) { return this.project(llToThree(lat, lon, r)); }

  // ── pins ─────────────────────────────────────────────────────────────────
  addPin(lat, lon, color = '#ffcf5a', name = '') {
    const P = this.plates, k = P.polyAt(lat, lon);
    const pin = { lat, lon, poly: k, color, name, trail: null, mesh: null, path: [] };
    const begin = k >= 0 ? Math.min(540, P.poly[k].b) : 0;
    const pos = [], ages = [];
    for (let t = 0; t <= begin + 1e-9; t += 1) {
      const r = P.reconstruct(lat, lon, t, k);
      if (!r) break;
      pin.path.push([t, r.lat, r.lon]);
      const v = threeOf(r.v).multiplyScalar(1.004); pos.push(v.x, v.y, v.z); ages.push(t);
    }
    if (pos.length > 3) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('age', new THREE.BufferAttribute(new Float32Array(ages), 1));
      const m = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(color) }, uT: { value: this.t } }, vertexShader: SH.TRAIL_VERT, fragmentShader: SH.TRAIL_FRAG, transparent: true, depthWrite: false });
      pin.trail = new THREE.Line(g, m); pin.trail.renderOrder = 6; pin.trail.frustumCulled = false;
      this.group.add(pin.trail);
    }
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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.pixCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const px = this.renderer.getPixelRatio();
    this.starU.uPix.value = px; this.fossilU.uPix.value = px;
  }
  render(now) {
    this.controls.update();
    const U = this.earthU;
    U.uTime.value = (now - this.time0) / 1000;
    this.sunDir(U.uSun.value);
    this.group.updateMatrixWorld();
    U.uRot.value.setFromMatrix4(this.group.matrixWorld);
    const needIdx = this.state.tint > 0;
    if (needIdx && this.idxDirty) this.renderIndex();
    const pulse = 1 + 0.18 * Math.sin(now / 260);
    for (const p of this.pins) p.ring.scale.setScalar(pulse);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.controls.dispose();
    this.renderer.dispose();
  }
}
