// ============================================================================
//  OUTBREAK  ·  render/style-flat.js — style 4, the flat map
// ----------------------------------------------------------------------------
//  The world as a flat map in the plane z = 0, facing +z (CONTRACT.md
//  "Flat-map space"). Two projections share one mesh:
//    'equirect'    x = lon / 90, y = lat / 90 (width 4, height 2)
//    'equalearth'  Equal Earth (Savric et al. 2018), scaled to width 4
//  The positions come from geo.js flat() per vertex. The uv of each vertex
//  stays equirectangular (u = (lon + 180) / 360, v = (lat + 90) / 180), so
//  the field textures of render/field.js sample the same way in both.
//  setProj(p) moves every vertex in place (no new GPU objects).
//
//  Layers, all in the style group:
//    map      ShaderMaterial on a lat-lon grid mesh (GRID_STEP deg). Deep
//             navy sea, slate land (field.landMask) with a bright coast edge,
//             NASA city lights in amber, and the infection texture of
//             render/infect.js on infected land (the same pattern as the
//             globes: the uv gives the point on the sphere). Deaths (G)
//             dim the lights. It writes depth at z = 0.
//    grid     LineSegments of the graticule every 30 deg, z = LINE_Z.
//    edge     LineSegments of the map outline (the lon +-180 meridians and
//             the pole lines), z = LINE_Z.
//    coast    LineSegments of the Natural Earth coast rings, z = LINE_Z.
//             A segment that crosses the antimeridian is dropped (a flat map
//             has no wrap).
//  The style draws no city glows and no arcs: render/nodes.js and
//  render/arcs.js (package H) draw those on top, at heights on +z.
//
//  The instance has `proj` (read by render/globe.js for the camera pose).
//  The start projection is ctx.proj when it is 'equalearth', else
//  'equirect'.
//
//  Data (reused by relative path, not copied):
//    ../../storm-globe/data/coast-50m.bin            Natural Earth coast (public domain)
//    ../../ancient-earth/data/present/lights-2k.jpg  NASA city lights (public domain)
//  Both load async. A late load after dispose() is released at once.
//
//  Colours are display values: the shaders do not include the three.js
//  colour-space chunk. No DOM and no three import at module load: THREE
//  comes from ctx, so node can import this file and test the helpers.
//
//  grep -n targets: "export function mapGrid", "export function projectLL",
//                   "export function flatGraticule", "export function flatOutline",
//                   "export function flatCoast", "export function normProj",
//                   "const MAP_FRAG", "const LINE_FRAG", "create(ctx)",
//                   "setProj(p)", "dispose()"
// ============================================================================
import { decodeCoast } from '../../storm-globe/coast.js';
import { flat, EE_SCALE } from '../geo.js';
import { worldPrevalence, tintFor, approach, COAST_URL, LIGHTS_URL } from './style-night.js';
import { INFECT_GLSL, INFECT_EXT, infectUniforms, infectDefines } from './infect.js';

export const SOURCES = [
  { ref: 'Savric, Patterson, Jenny 2018, The Equal Earth map projection, Int J Geogr Inf Sci 33(3):454', url: 'https://doi.org/10.1080/13658816.2018.1504949', note: 'Equal Earth forward formulas, via geo.js flat()' },
  { ref: 'Natural Earth 1:50m land and lakes', url: 'https://www.naturalearthdata.com/', note: 'coast rings, public domain, via storm-globe/data/coast-50m.bin' },
  { ref: 'NASA Earth Observatory, Earth at Night (Black Marble) 2016', url: 'https://earthobservatory.nasa.gov/features/NightLights', note: 'city lights texture, public domain, via ancient-earth/data/present/lights-2k.jpg' },
];

export const PROJS = [
  { id: 'equirect', label: 'Equirectangular' },
  { id: 'equalearth', label: 'Equal Earth' },
];
export const GRID_STEP = 2;        // deg between mesh vertices
export const GRAT_STEP = 30;       // deg between graticule lines
export const LINE_Z = 0.002;       // map units above the plane
export { EE_SCALE };

// ── pure helpers (tested in tests/style-flat.test.mjs) ──────────────────
export function normProj(p) { return p === 'equalearth' ? 'equalearth' : 'equirect'; }

// The map mesh as a lat-lon grid. Vertex (i, j): lon = -180 + i step,
// lat = -90 + j step. The positions use proj; the uv is equirectangular.
//   -> { pos: Float32Array(3V), uv: Float32Array(2V), ll: Float32Array(2V) (lon, lat),
//        index: Uint32Array, nx, ny }   (nx, ny = vertex counts)
export function mapGrid(proj = 'equirect', step = GRID_STEP) {
  const nx = Math.round(360 / step) + 1, ny = Math.round(180 / step) + 1, V = nx * ny;
  const ll = new Float32Array(2 * V), uv = new Float32Array(2 * V);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, lon = -180 + 360 * i / (nx - 1), lat = -90 + 180 * j / (ny - 1);
      ll[2 * k] = lon; ll[2 * k + 1] = lat;
      uv[2 * k] = i / (nx - 1); uv[2 * k + 1] = j / (ny - 1);
    }
  }
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let o = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // counter-clockwise seen from +z (east = +x, north = +y)
      index[o++] = a; index[o++] = b; index[o++] = d;
      index[o++] = a; index[o++] = d; index[o++] = c;
    }
  }
  return { pos: projectLL(ll, proj, 0), uv, ll, index, nx, ny };
}

// (lon, lat) pairs -> Float32Array of xyz on the map at height z.
export function projectLL(ll, proj = 'equirect', z = 0, out = null) {
  const n = ll.length / 2, o = out || new Float32Array(3 * n), p = normProj(proj);
  for (let k = 0; k < n; k++) {
    const q = flat(ll[2 * k + 1], ll[2 * k], z, p);
    o[3 * k] = q[0]; o[3 * k + 1] = q[1]; o[3 * k + 2] = q[2];
  }
  return o;
}

// Segment builder: lon-lat polylines cut into pieces of at most segDeg.
function segs() {
  const ll = [], bright = [];
  return {
    ll, bright,
    line(lo0, la0, lo1, la1, w, segDeg) {
      const k = Math.max(1, Math.ceil(Math.hypot(lo1 - lo0, la1 - la0) / segDeg));
      for (let s = 0; s < k; s++) {
        const t0 = s / k, t1 = (s + 1) / k;
        ll.push(lo0 + (lo1 - lo0) * t0, la0 + (la1 - la0) * t0, lo0 + (lo1 - lo0) * t1, la0 + (la1 - la0) * t1);
        bright.push(w, w);
      }
    },
    done() { return { ll: Float32Array.from(ll), bright: Float32Array.from(bright), n: bright.length / 2 }; },
  };
}

// Graticule: parallels and meridians every step deg, inside the outline.
// bright: 1 for the equator and the prime meridian, else 0.5.
//   -> { ll: Float32Array (4 per segment: lon, lat, lon, lat), bright (2 per segment), n }
export function flatGraticule(step = GRAT_STEP, segDeg = 2) {
  const b = segs();
  for (let lat = -90 + step; lat < 90 - 1e-9; lat += step) b.line(-180, lat, 180, lat, Math.abs(lat) < 1e-9 ? 1 : 0.5, segDeg);
  for (let lon = -180 + step; lon < 180 - 1e-9; lon += step) b.line(lon, -90, lon, 90, Math.abs(lon) < 1e-9 ? 1 : 0.5, segDeg);
  return b.done();
}

// The outline of the map: the meridians at lon -180 and 180 and the pole
// lines. In Equal Earth the side meridians curve and the pole lines are
// shorter than the equator.
export function flatOutline(segDeg = 2) {
  const b = segs();
  b.line(-180, -90, -180, 90, 1, segDeg);
  b.line(180, -90, 180, 90, 1, segDeg);
  b.line(-180, 90, 180, 90, 1, segDeg);
  b.line(-180, -90, 180, -90, 1, segDeg);
  return b.done();
}

// Coast rings (decodeCoast) -> lon-lat segments for a flat map. Drops the
// polygon-cut artefacts (segments along the antimeridian, and below lat
// -89.9) and every segment that crosses the antimeridian (|dlon| > 180).
// A segment longer than maxStep deg is cut, so Equal Earth bends it.
export function flatCoast(rings, maxStep = 1.5) {
  const b = segs();
  for (const ring of rings) {
    const p = ring.pts, n = p.length / 2, w = ring.kind ? 0.5 : 1;
    for (let i = 0; i < n - 1; i++) {
      const lo0 = p[i * 2], la0 = p[i * 2 + 1], lo1 = p[i * 2 + 2], la1 = p[i * 2 + 3];
      if (Math.abs(lo0) > 179.99 && Math.abs(lo1) > 179.99) continue;
      if (la0 < -89.9 && la1 < -89.9) continue;
      if (Math.abs(lo1 - lo0) > 180) continue;
      b.line(lo0, la0, lo1, la1, w, maxStep);
    }
  }
  return b.done();
}

// ── shaders (GLSL for three.js ShaderMaterial) ───────────────────────────
const MAP_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MAP_FRAG = /* glsl */`
uniform sampler2D uLand;
uniform sampler2D uField;
uniform sampler2D uLights;
uniform vec2 uTexel;
uniform float uTime;
uniform float uTint;
uniform float uHasLand;
varying vec2 vUv;
${INFECT_GLSL}
float landAt(vec2 o) { return texture2D(uLand, vUv + o * uTexel).r; }
void main() {
  float land = uHasLand * landAt(vec2(0.0));
  float m = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785398;
    m += landAt(vec2(cos(a), sin(a)) * 1.5);
  }
  m /= 8.0;
  float edge = uHasLand * (1.0 - abs(2.0 * m - 1.0));

  // sea: navy, a little lighter at the equator; land: slate
  float lat = (vUv.y - 0.5) * 3.14159;
  vec3 sea = mix(vec3(0.006, 0.016, 0.04), vec3(0.012, 0.035, 0.075), cos(lat));
  vec3 col = mix(sea, vec3(0.05, 0.065, 0.085), land);
  vec3 coastC = mix(vec3(0.25, 0.8, 1.0), vec3(1.0, 0.45, 0.55), uTint);
  col += coastC * edge * 0.18;

  vec4 f = texture2D(uField, vUv);
  float prev = clamp(f.r, 0.0, 1.0);
  float dead = clamp(f.g, 0.0, 1.0);
  col = infectApply(col, vUv, land, f);
  float lights = texture2D(uLights, vUv).r;
  col += vec3(1.0, 0.72, 0.38) * lights * lights * 0.9 * (1.0 - 0.7 * dead) * (1.0 - 0.6 * prev);
  col += vec3(1.0, 0.16, 0.10) * lights * prev * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const LINE_VERT = /* glsl */`
attribute float aBright;
varying float vA;
void main() {
  vA = aBright;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const LINE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uGain;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor * vA * uGain, 1.0);
}`;

// ── the style ────────────────────────────────────────────────────────────
function create(ctx) {
  const { THREE } = ctx;
  const owned = [];
  const own = o => { owned.push(o); return o; };
  let disposed = false;
  let proj = normProj(ctx.proj);

  const group = new THREE.Group();
  group.name = 'style-flat';
  if (ctx.root) ctx.root.add(group);

  const blank = own(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  blank.needsUpdate = true;
  const field = ctx.field || null;
  const pop = ctx.D && ctx.D.nodes ? ctx.D.nodes.reduce((s, n) => s + n.pop, 0) : 0;
  const landTex = field && field.landMask ? field.landMask : blank;
  const lw = landTex.image && landTex.image.width > 1 ? landTex.image.width : 1024;
  const lh = landTex.image && landTex.image.height > 1 ? landTex.image.height : 512;

  // map mesh
  const grid = mapGrid(proj);
  const mGeo = own(new THREE.BufferGeometry());
  const mPos = new THREE.BufferAttribute(grid.pos, 3);
  mGeo.setAttribute('position', mPos);
  mGeo.setAttribute('uv', new THREE.BufferAttribute(grid.uv, 2));
  if (mGeo.setIndex) mGeo.setIndex(new THREE.BufferAttribute(grid.index, 1));
  const mU = {
    uLand: { value: landTex },
    uField: { value: field && field.texture ? field.texture : blank },
    uLights: { value: blank },
    uTexel: { value: new THREE.Vector2(1 / lw, 1 / lh) },
    uTime: { value: 0 },
    uTint: { value: 0 },
    uHasLand: { value: landTex === blank ? 0 : 1 },
    ...infectUniforms(THREE, ctx),
  };
  const map = new THREE.Mesh(mGeo, own(new THREE.ShaderMaterial({ uniforms: mU, vertexShader: MAP_VERT, fragmentShader: MAP_FRAG,
    defines: infectDefines(ctx.phone), extensions: INFECT_EXT })));
  map.name = 'flat-map';
  map.renderOrder = 0;
  map.frustumCulled = false;
  group.add(map);

  // line layers keep their lon-lat source, so setProj can move them
  const lineLayers = [];
  const lineMat = (rgb, gain) => own(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(rgb[0], rgb[1], rgb[2]) }, uGain: { value: gain } },
    vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const addLines = (seg, mat, name, order) => {
    const geo = own(new THREE.BufferGeometry());
    const attr = new THREE.BufferAttribute(projectLL(seg.ll, proj, LINE_Z), 3);
    geo.setAttribute('position', attr);
    geo.setAttribute('aBright', new THREE.BufferAttribute(seg.bright, 1));
    const l = new THREE.LineSegments(geo, mat);
    l.name = name; l.renderOrder = order; l.frustumCulled = false;
    group.add(l);
    lineLayers.push({ ll: seg.ll, attr });
    return l;
  };
  addLines(flatGraticule(), lineMat([0.35, 0.6, 0.85], 0.22), 'flat-grid', 1);
  addLines(flatOutline(), lineMat([0.35, 0.75, 1.0], 0.6), 'flat-edge', 2);
  const coastMat = lineMat([0.25, 0.85, 1.0], 0.6);

  const coastReady = (async () => {
    const r = await fetch(COAST_URL);
    if (!r.ok) throw new Error(`coast: HTTP ${r.status}`);
    const seg = flatCoast(decodeCoast(await r.arrayBuffer()));
    if (disposed) return;
    addLines(seg, coastMat, 'flat-coast', 3);
  })().catch(e => { if (!disposed) console.warn('outbreak flat style:', e.message); });

  if (THREE.TextureLoader) {
    new THREE.TextureLoader().load(String(LIGHTS_URL), tex => {
      if (disposed) { tex.dispose(); return; }
      own(tex);
      mU.uLights.value = tex;
    }, undefined, () => { if (!disposed) console.warn('outbreak flat style: city lights did not load'); });
  }

  let tint = 0;
  const style = {
    group,
    coastReady,
    projs: PROJS,
    get proj() { return proj; },
    get tint() { return tint; },
    setProj(p) {
      const np = normProj(p);
      if (np === proj || disposed) return;
      proj = np;
      projectLL(grid.ll, proj, 0, mPos.array); mPos.needsUpdate = true;
      for (const L of lineLayers) { projectLL(L.ll, proj, LINE_Z, L.attr.array); L.attr.needsUpdate = true; }
    },
    update(frame) {
      if (disposed || !frame) return;
      mU.uTime.value = frame.t || 0;
      if (field) {
        if (field.texture && mU.uField.value !== field.texture) mU.uField.value = field.texture;
        if (field.landMask && mU.uLand.value !== field.landMask) { mU.uLand.value = field.landMask; mU.uHasLand.value = 1; }
      }
      tint = approach(tint, tintFor(worldPrevalence(frame.sim, pop)), frame.dt || 0, 1.5);
      mU.uTint.value = tint;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      for (const o of owned) o.dispose();
      owned.length = 0;
    },
  };
  return style;
}

export default { id: 'flat', label: 'Flat map', mode: 'flat', create };

// The GLSL sources, for an offline compile check (naga after a 450 rewrite).
export const SHADERS = { map: [MAP_VERT, MAP_FRAG], line: [LINE_VERT, LINE_FRAG] };
