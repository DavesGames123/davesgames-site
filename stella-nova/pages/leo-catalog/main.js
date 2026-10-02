// ============================================================================
//  LEO CATALOG  ·  live low-Earth-orbit satellite catalog on a 3D globe
// ----------------------------------------------------------------------------
//  Loads real TLE orbital element sets (a same-origin snapshot of CelesTrak,
//  see tools/tle-snapshot.sh), propagates every object
//  with SGP4 (satellite.js) each frame, and draws them as point-sprite glyphs
//  around a shader-shaded Earth. A time slider scrubs the propagation epoch, so
//  the whole catalog can be run forward or back. Overlays add orbit trails,
//  city labels, live storms (NOAA), and an analytical wind-flow streamline field.
//
//  SCENE GRAPH
//  -----------
//      scene
//        ├─ earthRoot (group, holds everything that spins with Earth)
//        │    ├─ earthMesh      SphereGeometry + day/night ShaderMaterial
//        │    │                              source: shaders/earth.*.glsl
//        │    ├─ satPoints      one THREE.Points, PERF_CAP glyphs
//        │    │                              source: shaders/satellite.*.glsl
//        │    ├─ streamMesh     wind streamlines (LineSegments, GPU-animated)
//        │    │                              source: shaders/streamline.*.glsl
//        │    └─ trailLine + stationTrails   orbit paths (THREE.Line)
//        ├─ atmosphere shell    fresnel glow   source: shaders/atmosphere.*.glsl
//        └─ stars               THREE.Points backdrop
//
//  PER-FRAME PIPELINE   (function animate)
//  ---------------------------------------
//      SIM.time += dt·speed ─▶ propagateAll()  SGP4 → ECEF → scene positions
//                                   │  (writes the satPoints position buffer)
//                                   ▼
//      sun direction ─▶ earth uniforms ; controls.update() ; render
//                                   ▼
//      HTML overlays reprojected: city / station / sat labels, chip, reticle
//
//  COORDINATE FRAMES
//      ECEF   +X=lon0, +Y=lon90E, +Z=north      (satellite.js output)
//      scene  +X=lon0, +Y=north,  -Z=lon90E     (ecefToScene remaps)
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      shader load .......... "loadShaders"        fetch .glsl before build
//      constants ............ "// CONSTANTS"       scene scale, categories, SIM
//      splash / strip ....... "// SPLASH LOGGER"   title card, #acq strip, tweens
//      three.js base ........ "// THREE.JS BASE"   renderer, camera, controls
//      earth map ............ "function buildEarthMap"  canvas-drawn continents
//      coord helpers ........ "function latLonToVec3"   frame conversions
//      satellites ........... "// SATELLITES"      point cloud + attributes
//      arrival .............. "function stampBirths"    fall-in times, ping rings
//      propagation .......... "function propagateAll"   SGP4 every frame
//      storms ............... "function loadStorms"  NOAA active cyclones
//      wind field ........... "function sampleWindAt"  analytical wind model
//      streamlines .......... "function traceStreamline"  RK2 trace + GPU comet
//      cities ............... "function buildCityLabels"  tiered LOD labels
//      station labels ....... "function rebuildStationLabels"  always-on labels
//      sat labels ........... "function updateSatLabels"  pooled LOD labels
//      orbit trails ......... "function buildTrailFor"  selected + station paths
//      filters / overlays ... "// FILTERS"         checkbox wiring
//      picking .............. "function pickAt"    hover/lock chip + reticle
//      tle loader ........... "function fetchTLE"    snapshot/CelesTrak fetch
//      tle sources .......... "TLE_SNAPSHOT_DIRS"   source order per group
//      object info .......... "OBJECT_KNOWLEDGE"   curated descriptions panel
//      fly-to ............... "function flyTo"     animated camera moves
//      search ............... "function doSearch"  name/NORAD search
//      time control ......... "// TIME CONTROL"    scrub + rate sliders
//      boot ................. "function boot"      load groups, then reveal
//      main loop ............ "function animate"   the per-frame update
//      xr ................... "function startXR"   VR/AR via xr.js + lib/xr-view.js
//      screensaver .......... "window.snSaver"     shell saver hook: slow orbit + tour
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadShaders } from '../../lib/shaders.js';
import { wireXR } from './xr.js';

// Shader source lives in real .glsl files under shaders/. Fetch it all before
// building any material, so init runs in the original synchronous order.
const SH = await loadShaders(import.meta.url, [
  'shaders/earth.vert.glsl',
  'shaders/earth.frag.glsl',
  'shaders/atmosphere.vert.glsl',
  'shaders/atmosphere.frag.glsl',
  'shaders/satellite.vert.glsl',
  'shaders/satellite.frag.glsl',
  'shaders/streamline.vert.glsl',
  'shaders/streamline.frag.glsl',
]);

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
// Earth radius sets the scene scale: 1 scene unit = 1 Earth radius. MU is the
// gravitational parameter for orbital-element math. PERF_CAP bounds the object
// count so mobile stays interactive.
const EARTH_R_KM   = 6378.137;
const KM_TO_SCENE  = 1.0 / EARTH_R_KM;
const MU           = 398600.4418;
const IS_MOBILE    = window.matchMedia('(max-width: 880px)').matches;
const PERF_CAP     = IS_MOBILE ? 3500 : 12000;

// Object classes. CAT_INDEX maps each to the glyph id the satellite shader draws;
// CAT_COLOR and CAT_SIZE give per-class sprite colour and pixel size.
const CATEGORIES = ['starlink','payload','station','rocket','debris','storm'];
// Glyph indices used by the shader
const CAT_INDEX  = { payload:0, station:1, rocket:2, debris:3, storm:4, starlink:5 };
const CAT_COLOR  = {
  starlink: new THREE.Color(0x4fdc7a),  // bright green
  payload:  new THREE.Color(0x5ad7ff),  // cyan
  station:  new THREE.Color(0xf5f5f0),  // off-white
  rocket:   new THREE.Color(0xffb030),  // amber
  debris:   new THREE.Color(0xff5a5a),  // red
  storm:    new THREE.Color(0x5ad7ff),  // cyan ring
};
const CAT_SIZE = {
  starlink: 9.0,
  payload:  11.0,
  station:  18.0,
  rocket:   11.0,
  debris:   7.0,
  storm:    22.0,
};

// FILTER toggles which classes are shown; OVERLAY toggles the extra layers;
// highlightCat dims every other class while one is hovered or locked.
const FILTER  = { starlink:true, payload:true, station:true, rocket:true, debris:true, storm:true };
const OVERLAY = { trails:true, cities:true, weather:false, satlabels:true };
let highlightCat = null;

// Simulation clock. time is the propagation epoch; base is "now" (the slider
// centre); range is the maximum scrub each way; speed multiplies real time.
const SIM = {
  time:  new Date(),
  base:  new Date(),
  range: 365 * 86400 * 1000,   // ±1 year max scrub
  speed: 3,
  playing: true,
};

// Logarithmic slider mapping — fine seconds/minutes near NOW, days/months at edges.
// offset = sign(s) * (exp(|s|*K) - 1) / (exp(K) - 1) * range,  s = frac*2 - 1 ∈ [-1, 1]
const SLIDER_K     = 9;
const SLIDER_KM1   = Math.exp(SLIDER_K) - 1;
// Slider fraction [0,1] to a signed time offset in ms. The exponential curve
// gives fine control near NOW (centre) and days/months toward the edges.
function fracToOffsetMs(frac) {
  const s = frac * 2 - 1;
  return Math.sign(s) * (Math.exp(Math.abs(s) * SLIDER_K) - 1) / SLIDER_KM1 * SIM.range;
}
// Inverse of fracToOffsetMs: a time offset back to a slider fraction.
function offsetMsToFrac(offsetMs) {
  const r = Math.max(-1, Math.min(1, offsetMs / SIM.range));
  const s = Math.sign(r) * Math.log(1 + Math.abs(r) * SLIDER_KM1) / SLIDER_K;
  return (s + 1) / 2;
}

let splashGone = false;

// ═══════════════════════════════════════════════════════════════════
// SPLASH LOGGER + ACQUISITION STRIP
// ═══════════════════════════════════════════════════════════════════
// Boot has two surfaces. #splash is a short title card over the scene; it
// lifts as soon as the Earth map is ready (see revealScene). #acq is the strip
// at the top that stays up while TLE groups land on the visible globe: one
// segment per group, an object counter, the latest log line, and one chip per
// subsystem (GEO, CAT, STM, WND, STR).
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const splashLines = document.getElementById('splash-lines');
const acqEl      = document.getElementById('acq');
const acqLine    = document.getElementById('acq-line');
const acqSegsEl  = document.getElementById('acq-segs');
const acqCountEl = document.getElementById('acq-count');
const acqTitle   = document.getElementById('acq-title');

// Log one boot line: append it to the splash log (last 3 kept) and make it the
// strip's current line, re-running the strip's line-in animation.
function splash(msg, cls = '') {
  if (splashLines && splashLines.isConnected) {
    const div = document.createElement('div');
    div.className = 'ln ' + cls;
    div.textContent = msg;
    splashLines.appendChild(div);
    while (splashLines.childElementCount > 3) splashLines.firstChild.remove();
  }
  if (acqLine) {
    acqLine.textContent = msg;
    acqLine.className = 'acq-line ' + cls;
    void acqLine.offsetWidth;
    acqLine.classList.add('in');
  }
}

// Subsystem chips. pct > 0 marks the chip busy; {done} or {fail} marks the
// finish. Callers pass percentages from when these were dial gauges; only the
// state is shown now.
function setGauge(name, pct, state) {
  const el = acqEl && acqEl.querySelector(`[data-sys="${name}"]`);
  if (!el) return;
  const st = state && state.fail ? 'fail' : state && state.done ? 'ok' : pct > 0 ? 'busy' : 'idle';
  if (el.dataset.state !== st) el.dataset.state = st;
}

// Group segments, mirrored from the load-status panel by addLoadRow and
// setLoadStatus. The CAT chip is done when every segment is ok or fail.
const acqSegs = new Map(); // group → element
function acqSegAdd(group) {
  if (!acqSegsEl || acqSegs.has(group)) return;
  const seg = document.createElement('span');
  seg.className = 'seg loading';
  seg.title = group;
  seg.style.setProperty('--i', acqSegs.size);
  acqSegsEl.appendChild(seg);
  acqSegs.set(group, seg);
  catalogGaugeRecompute();
}
function acqSegSet(group, status) {
  const seg = acqSegs.get(group);
  if (!seg) return;
  seg.className = 'seg ' + status;
  catalogGaugeRecompute();
}
function catalogGaugeRecompute() {
  let done = 0;
  acqSegs.forEach(s => { if (s.classList.contains('ok') || s.classList.contains('fail')) done++; });
  setGauge('catalog', acqSegs.size ? 1 + 99 * done / acqSegs.size : 0,
           acqSegs.size && done === acqSegs.size ? { done: true } : null);
}

// Count a number element up (or down) to target over ~0.7 s with an ease-out
// curve. A new call on the same element takes over from the shown value.
const tweens = new Map(); // element → { from, to, t0 }
function tweenNumber(el, to) {
  if (!el) return;
  const shown = Number(String(el.textContent).replace(/[^0-9]/g, '')) || 0;
  if (REDUCED_MOTION || shown === to) { el.textContent = to.toLocaleString(); return; }
  const had = tweens.size > 0;
  tweens.set(el, { from: shown, to, t0: performance.now() });
  if (!had) requestAnimationFrame(stepTweens);
}
function stepTweens(now) {
  tweens.forEach((tw, el) => {
    const k = Math.min(1, (now - tw.t0) / 700);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(tw.from + (tw.to - tw.from) * e).toLocaleString();
    if (k >= 1) tweens.delete(el);
  });
  if (tweens.size) requestAnimationFrame(stepTweens);
}

// Re-run a one-shot CSS animation class on an element.
function retrigger(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Resolve the splash logo from random glyphs to its text, left to right, over
// ~0.9 s. Resolves when the minimum title-card time has passed.
function playIntro() {
  const logo = document.getElementById('splash-logo');
  const MIN_MS = REDUCED_MOTION ? 200 : 1500;
  if (logo && !REDUCED_MOTION) {
    const final = logo.textContent;
    const GLYPHS = '<>/\\|#*+=01';
    const t0 = performance.now();
    const step = (now) => {
      const k = (now - t0) / 900;
      let out = '';
      for (let i = 0; i < final.length; i++) {
        const lockAt = (i + 1) / final.length;
        out += (final[i] === ' ' || k >= lockAt) ? final[i]
             : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      logo.textContent = out;
      if (k < 1) requestAnimationFrame(step);
      else logo.textContent = final;
    };
    requestAnimationFrame(step);
  }
  return new Promise(r => setTimeout(r, MIN_MS));
}

// ═══════════════════════════════════════════════════════════════════
// THREE.JS BASE
// ═══════════════════════════════════════════════════════════════════
// Renderer, scene, perspective camera pulled back from the globe, and orbit
// controls (rotate/zoom, no pan) constrained so the camera stays near Earth.
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: !IS_MOBILE, alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth/window.innerHeight, 0.001, 100);
camera.position.set(0, 0.5, 3.4);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.45;
controls.minDistance = 1.05;
controls.maxDistance = 8;
controls.enablePan = false;

const earthRoot = new THREE.Group();
scene.add(earthRoot);

// ── Earth canvas texture (continents + grid baked in, halos for glow) ──
let earthMesh = null;
const earthUniforms = {
  uMap: { value: null },
  uSunDir: { value: new THREE.Vector3(1, 0, 0) },
};

// Build the Earth texture by drawing the world-atlas coastline data and a
// lat/lon grid into a 2D canvas, then wrap it on a sphere with the day/night
// shader. Runs at boot; drives the GEODESY gauge as it fetches and draws.
async function buildEarthMap() {
  splash('fetch continents (110m)');
  setGauge('geo', 10);
  const res = await fetch(new URL('../../vendor/world-atlas@2.0.2/land-110m.json', import.meta.url));
  if (!res.ok) throw new Error('HTTP '+res.status);
  setGauge('geo', 40);
  const topo = await res.json();
  const land = topojson.feature(topo, topo.objects.land);
  setGauge('geo', 60);

  const W = IS_MOBILE ? 2048 : 4096;
  const H = IS_MOBILE ? 1024 : 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Sea — deep navy
  ctx.fillStyle = '#020816';
  ctx.fillRect(0, 0, W, H);

  // Lat/lon grid (baked in, halo glow)
  function drawLat(d) { const y = (90-d)/180*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  function drawLon(d) { const x = (d+180)/360*W; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(120, 240, 150, 0.13)';
  ctx.lineWidth = W / 500;
  for (let lat = -75; lat <= 75; lat += 15) drawLat(lat);
  for (let lon = -180; lon < 180; lon += 15) drawLon(lon);
  ctx.strokeStyle = 'rgba(140, 220, 160, 0.42)';
  ctx.lineWidth = Math.max(1, W / 2000);
  for (let lat = -75; lat <= 75; lat += 15) if (lat !== 0) drawLat(lat);
  for (let lon = -180; lon < 180; lon += 15) if (lon !== 0 && lon !== -180) drawLon(lon);
  ctx.strokeStyle = 'rgba(180, 250, 200, 0.78)';
  ctx.lineWidth = W / 1100;
  drawLat(0); drawLon(0); drawLon(180); drawLon(-180);

  // Continents
  // Trace a set of polygon rings (in lon/lat) into the equirectangular canvas.
  function drawRings(rings, op) {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const x = (p[0]+180)/360*W;
        const y = (90-p[1])/180*H;
        if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      });
      ctx.closePath();
    }
    if (op === 'fill') ctx.fill();
    else if (op === 'stroke') ctx.stroke();
  }
  // Visit every polygon in the land geometry, calling fn with its rings.
  function walkLand(fn) {
    function walk(g) {
      if (!g) return;
      if (g.type === 'Polygon') fn(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(fn);
    }
    if (land.type === 'FeatureCollection') land.features.forEach(f => walk(f.geometry));
    else if (land.type === 'Feature') walk(land.geometry);
    else walk(land);
  }
  ctx.fillStyle = 'rgba(38, 110, 58, 0.95)';
  walkLand(rings => drawRings(rings, 'fill'));
  ctx.strokeStyle = 'rgba(150, 255, 180, 0.42)';
  ctx.lineWidth = W / 450; ctx.lineJoin = 'round';
  walkLand(rings => drawRings(rings, 'stroke'));
  ctx.strokeStyle = '#b8ffd0';
  ctx.lineWidth = Math.max(1, W / 1500);
  walkLand(rings => drawRings(rings, 'stroke'));

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  earthUniforms.uMap.value = tex;

  const earthGeo = new THREE.SphereGeometry(0.999, 128, 96);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: SH['shaders/earth.vert.glsl'],
    fragmentShader: SH['shaders/earth.frag.glsl'],
  });
  earthMesh = new THREE.Mesh(earthGeo, earthMat);
  earthRoot.add(earthMesh);
  setGauge('geo', 100, { done: true });
  splash('earth map ok', 'ok');
}

// Dark placeholder globe shown until the real Earth texture is built (or if the
// continent fetch fails); removed once buildEarthMap() succeeds.
const fallbackShell = new THREE.Mesh(
  new THREE.SphereGeometry(0.992, 64, 48),
  new THREE.MeshBasicMaterial({ color: 0x010906 })
);
earthRoot.add(fallbackShell);

// Atmosphere fresnel
// A slightly larger back-side sphere with the atmosphere shader adds a rim glow.
{
  const g = new THREE.SphereGeometry(1.055, 64, 48);
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x5fb872) } },
    vertexShader: SH['shaders/atmosphere.vert.glsl'],
    fragmentShader: SH['shaders/atmosphere.frag.glsl'],
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.BackSide, depthWrite: false,
  });
  scene.add(new THREE.Mesh(g, m));
}

// Stars
// Scatter points on a large sphere around the scene as a fixed star backdrop.
{
  const N = IS_MOBILE ? 800 : 1500;
  const pos = new Float32Array(N*3);
  for (let i = 0; i < N; i++) {
    const u = Math.random(), v = Math.random();
    const th = 2*Math.PI*u, ph = Math.acos(2*v-1);
    const r = 40 + Math.random()*10;
    pos[i*3+0] = r*Math.sin(ph)*Math.cos(th);
    pos[i*3+1] = r*Math.cos(ph);
    pos[i*3+2] = r*Math.sin(ph)*Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    color: 0xfff5d8, size: 0.015, sizeAttenuation: true,
    transparent: true, opacity: 0.5, depthWrite: false,
  });
  const stars = new THREE.Points(g, m);
  stars.name = 'stars';   // xr.js hides it in AR
  scene.add(stars);
}

// ── Helpers ──
// Coord convention: world +X = lon 0 (Greenwich), world +Y = north pole,
// world -Z = lon +90 (east). So +Z faces Americas → camera at +Z sees east go right.
function latLonToVec3(latDeg, lonDeg, r) {
  const lat = latDeg * Math.PI/180;
  const lon = lonDeg * Math.PI/180;
  return new THREE.Vector3(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    -r * Math.cos(lat) * Math.sin(lon),
  );
}
function ecefToScene(x, y, z, out) {
  // ECEF: +X=lon0, +Y=lon90, +Z=northpole.  Scene: +X=lon0, +Y=northpole, -Z=lon90.
  out.set(x * KM_TO_SCENE, z * KM_TO_SCENE, -y * KM_TO_SCENE);
  return out;
}
// Sun direction in the scene frame for a given date: a low-precision solar
// ephemeris in ECI, rotated into ECEF by GMST, then remapped to scene axes.
// Feeds the Earth shader's day/night terminator.
function sunDirEcef(date) {
  const t = (date.getTime() - Date.UTC(2000,0,1,12,0,0)) / 86400000;
  const L = (280.46 + 0.9856474*t) * Math.PI/180;
  const g = (357.528 + 0.9856003*t) * Math.PI/180;
  const lambda = L + (1.915*Math.sin(g) + 0.020*Math.sin(2*g)) * Math.PI/180;
  const eps = 23.439 * Math.PI/180;
  const xEci = Math.cos(lambda);
  const yEci = Math.cos(eps) * Math.sin(lambda);
  const zEci = Math.sin(eps) * Math.sin(lambda);
  const gmst = satellite.gstime(date);
  const cg = Math.cos(gmst), sg = Math.sin(gmst);
  const xEc =  cg*xEci + sg*yEci;
  const yEc = -sg*xEci + cg*yEci;
  const zEc =  zEci;
  return new THREE.Vector3(xEc, zEc, -yEc).normalize();
}
// Local east/north/radial basis at a lat/lon on the sphere (scene frame).
function tangentAt(latDeg, lonDeg) {
  const lat = latDeg * Math.PI/180;
  const lon = lonDeg * Math.PI/180;
  const cl = Math.cos(lat), sl = Math.sin(lat);
  const cn = Math.cos(lon), sn = Math.sin(lon);
  const rx = cl*cn, ry = sl, rz = -cl*sn;
  let ex = -rz, ey = 0, ez = -rx;
  const eL = Math.hypot(ex, ey, ez);
  if (eL > 1e-9) { ex/=eL; ey/=eL; ez/=eL; }
  const nx = ry*ez - rz*ey;
  const ny = rz*ex - rx*ez;
  const nz = rx*ey - ry*ex;
  return { east:[ex,ey,ez], north:[nx,ny,nz], radial:[rx,ry,rz] };
}

// ═══════════════════════════════════════════════════════════════════
// SATELLITES
// ═══════════════════════════════════════════════════════════════════
// sats is the master catalog array. The typed arrays are the GPU attribute
// buffers, one entry per object, shared by index with sats. HIDE parks an
// off-screen or filtered object far away instead of removing it.
let sats = [];
let positions, sizesAttr, colorsAttr, alphasAttr, glyphAttr, birthAttr;
let satGeo, satMat, satPoints;
const HIDE = -10000;

// Classify an object into a display category from its name.
function classify(name) {
  const n = name.toUpperCase();
  if (/^STARLINK/.test(n))                                return 'starlink';
  if (/ISS \(ZARYA|TIANGONG|TIANHE|MIR|CSS \(/.test(n))   return 'station';
  if (/ DEB( |$)|DEBRIS/.test(n))                         return 'debris';
  if (/ R\/B|ROCKET BODY| BOOSTER/.test(n))               return 'rocket';
  return 'payload';
}
// Parse a two-line-element text block into satellite records (name + SGP4
// satrec + NORAD id + category), skipping malformed or unparseable triples.
function parseTLE(text) {
  const lines = text.replace(/\r/g,'').split('\n');
  const out = [];
  for (let i = 0; i+2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i+1], l2 = lines[i+2];
    if (!name || !l1 || !l2 || l1[0] !== '1' || l2[0] !== '2') continue;
    try {
      const satrec = satellite.twoline2satrec(l1, l2);
      if (satrec.error) continue;
      const noradId = parseInt(l1.substring(2, 7).trim(), 10);
      out.push({ satrec, name, cat: classify(name), noradId, notable: null });
    } catch (e) {}
  }
  return out;
}

// Allocate the fixed-size point cloud and its dynamic attribute buffers once,
// then build the THREE.Points with the satellite shader. Frustum culling is
// off because positions are updated on the GPU-facing buffer every frame.
function buildPointCloud() {
  const N = PERF_CAP;
  positions  = new Float32Array(N*3).fill(HIDE);
  colorsAttr = new Float32Array(N*3);
  sizesAttr  = new Float32Array(N);
  alphasAttr = new Float32Array(N);
  glyphAttr  = new Float32Array(N);
  birthAttr  = new Float32Array(N).fill(1e9);
  satGeo = new THREE.BufferGeometry();
  satGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  satGeo.setAttribute('aColor',   new THREE.BufferAttribute(colorsAttr, 3).setUsage(THREE.DynamicDrawUsage));
  satGeo.setAttribute('aSize',    new THREE.BufferAttribute(sizesAttr, 1).setUsage(THREE.DynamicDrawUsage));
  satGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(alphasAttr, 1).setUsage(THREE.DynamicDrawUsage));
  satGeo.setAttribute('aGlyph',   new THREE.BufferAttribute(glyphAttr, 1).setUsage(THREE.DynamicDrawUsage));
  satGeo.setAttribute('aBirth',   new THREE.BufferAttribute(birthAttr, 1).setUsage(THREE.DynamicDrawUsage));

  satMat = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: renderer.getPixelRatio() }, uTime: { value: 0 } },
    vertexShader: SH['shaders/satellite.vert.glsl'],
    fragmentShader: SH['shaders/satellite.frag.glsl'],
    transparent: true, depthWrite: false,
  });
  satPoints = new THREE.Points(satGeo, satMat);
  satPoints.frustumCulled = false;
  scene.add(satPoints);
}

// Refresh the per-object colour and glyph buffers from the current catalog.
// Called after any load that changes the set of objects or their categories.
function rebuildAttributesFromSats() {
  for (let i = 0; i < sats.length; i++) {
    const c = CAT_COLOR[sats[i].cat];
    colorsAttr[i*3+0] = c.r;
    colorsAttr[i*3+1] = c.g;
    colorsAttr[i*3+2] = c.b;
    glyphAttr[i] = CAT_INDEX[sats[i].cat];
  }
  satGeo.attributes.aColor.needsUpdate = true;
  satGeo.attributes.aGlyph.needsUpdate = true;
}

// Give sats[from..to) a landing time in the next `spread` seconds, so a group
// rains in over a short window instead of all at once. The satellite shader
// runs the fall-in animation from these times (see satellite.vert.glsl).
// Before revealScene the globe is covered, so nothing is stamped; the reveal
// stamps every object that arrived during the title card.
function stampBirths(from, to, spread = 1.8) {
  if (!revealed) return;
  const now = performance.now() / 1000;
  for (let i = from; i < to; i++) birthAttr[i] = now + Math.random() * spread;
  satGeo.attributes.aBirth.needsUpdate = true;
}

// Ping rings: camera-facing rings that grow out from the globe rim and fade,
// one per landed TLE group. A small pool is reused; pingGlobe takes the next.
const PING_S = 1.6;
let revealed = false;
const pings = [];
for (let i = 0; i < 4; i++) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.012, 160),
    new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false;
  scene.add(m);
  pings.push({ mesh: m, t0: -1 });
}
let pingNext = 0;
function pingGlobe(color = 0x66e0ff) {
  if (!revealed) return;
  const p = pings[pingNext++ % pings.length];
  p.mesh.material.color.set(color);
  p.t0 = performance.now() / 1000;
  p.mesh.visible = true;
}
function updatePings(tSec) {
  for (const p of pings) {
    if (!p.mesh.visible) continue;
    const k = (tSec - p.t0) / PING_S;
    if (k >= 1) { p.mesh.visible = false; continue; }
    const e = 1 - Math.pow(1 - k, 3);
    p.mesh.quaternion.copy(camera.quaternion);
    p.mesh.scale.setScalar(1.0 + 0.9 * e);
    p.mesh.material.opacity = 0.7 * (1 - k);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROPAGATION
// ═══════════════════════════════════════════════════════════════════
// Propagation runs at PROP_HZ, not every frame, to cap SGP4 cost; _tmp avoids
// per-object allocation.
const _tmp = new THREE.Vector3();
let lastPropTime = 0;
const PROP_HZ = IS_MOBILE ? 12 : 20;
const PROP_DT = 1000 / PROP_HZ;
// The propagation interval in use. xr.js lowers it in a headset session.
let propDt = PROP_DT;

// Propagate every object to SIM.time and write its scene position, size, and
// alpha into the attribute buffers. Filtered objects are parked at HIDE; storms
// sit at a fixed lat/lon and pulse; everything else runs through SGP4 to ECEF.
function propagateAll() {
  const date = SIM.time;
  const gmst = satellite.gstime(date);
  const animTime = performance.now();
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i];
    if (!FILTER[s.cat]) {
      positions[i*3+0] = HIDE; positions[i*3+1] = HIDE; positions[i*3+2] = HIDE;
      alphasAttr[i] = 0; sizesAttr[i] = 0; continue;
    }
    if (s._isStorm) {
      const v = latLonToVec3(s._stormData.lat, s._stormData.lon, 1.022);
      positions[i*3+0] = v.x; positions[i*3+1] = v.y; positions[i*3+2] = v.z;
      let alpha = 1.0;
      if (highlightCat && highlightCat !== 'storm') alpha = 0.08;
      alphasAttr[i] = alpha;
      sizesAttr[i] = CAT_SIZE.storm + Math.sin(animTime/600) * 3;
      continue;
    }
    const pv = satellite.propagate(s.satrec, date);
    if (!pv.position) {
      positions[i*3+0] = HIDE; positions[i*3+1] = HIDE; positions[i*3+2] = HIDE;
      alphasAttr[i] = 0; sizesAttr[i] = 0; continue;
    }
    const ecef = satellite.eciToEcf(pv.position, gmst);
    ecefToScene(ecef.x, ecef.y, ecef.z, _tmp);
    positions[i*3+0] = _tmp.x;
    positions[i*3+1] = _tmp.y;
    positions[i*3+2] = _tmp.z;
    let alpha = 1.0;
    if (highlightCat && highlightCat !== s.cat) alpha = 0.08;
    if (i === selectedIdx) alpha = 1.0;
    alphasAttr[i] = alpha;
    sizesAttr[i] = (i === selectedIdx) ? CAT_SIZE[s.cat] * 1.6 : CAT_SIZE[s.cat];
  }
  satGeo.attributes.position.needsUpdate = true;
  satGeo.attributes.aSize.needsUpdate    = true;
  satGeo.attributes.aAlpha.needsUpdate   = true;
}

// ═══════════════════════════════════════════════════════════════════
// STORMS (NOAA)
// ═══════════════════════════════════════════════════════════════════
// Fetch active tropical cyclones from NOAA (trying direct then CORS proxies)
// and add each as a storm-category marker parked at its lat/lon.
async function loadStorms() {
  setGauge('storms', 25);
  const urls = [
    'https://www.nhc.noaa.gov/CurrentStorms.json',
    'https://corsproxy.io/?url=' + encodeURIComponent('https://www.nhc.noaa.gov/CurrentStorms.json'),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.nhc.noaa.gov/CurrentStorms.json'),
  ];
  let j = null, lastErr = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP '+res.status);
      j = await res.json();
      setGauge('storms', 60 + i * 13);
      break;
    } catch (e) { lastErr = e; setGauge('storms', 25 + (i+1) * 15); }
  }
  if (!j) {
    setGauge('storms', 100, { fail: true });
    splash('noaa storms: blocked', 'err');
    return;
  }
  try {
    const arr = j.activeStorms || [];
    const storms = arr.map(s => ({
      lat: parseFloat(s.latitudeNumeric ?? s.latitude),
      lon: parseFloat(s.longitudeNumeric ?? s.longitude),
      name: s.name || s.binNumber || 'STORM',
      classification: (s.classification || s.intensity || '').toUpperCase(),
      wind: s.intensity ? parseInt(s.intensity, 10) : null,
    })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (storms.length === 0) {
      setGauge('storms', 100, { done: true });
      splash('noaa storms: 0 active (off-season)', 'ok');
      return;
    }
    setGauge('storms', 100, { done: true });
    splash(`storms ${storms.length}`, 'ok');
    const first = sats.length;
    for (const st of storms) {
      if (sats.length >= PERF_CAP) break;
      sats.push({
        satrec: null, _isStorm: true,
        name: `${st.classification || 'STORM'} ${st.name}`,
        cat: 'storm', noradId: null, notable: null,
        _stormData: st,
      });
    }
    rebuildAttributesFromSats();
    stampBirths(first, sats.length, 0.6);
    updateCounts();
  } catch (e) {
    splash('noaa storms: parse fail', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════════
// WIND FLOW FIELD — analytical climatological model
// ═══════════════════════════════════════════════════════════════════
// Three components combined per sample:
//   1. Three-cell zonal base — trade winds (0-30°), westerlies (30-60°), polar easterlies (60-90°)
//   2. Planetary-wave perturbations — stationary Rossby-wave-like meridional/zonal variation
//   3. Cyclonic features — fixed semi-permanent lows/highs (Aleutian, Icelandic, Bermuda, Pacific, etc)
// Returns (u, v) in km/h scale and a derived speed magnitude. Sub-microsecond per sample.
// ═══════════════════════════════════════════════════════════════════
const CYCLONES = [
  // {lat, lon, r (degrees), str (km/h), spin: +1 cyclonic-N / -1 anticyclonic-N}
  // Northern hemisphere semi-permanent features
  { lat:  55, lon: -170, r: 26, str:  24, spin: +1 },   // Aleutian Low
  { lat:  60, lon:  -30, r: 24, str:  22, spin: +1 },   // Icelandic Low
  { lat:  32, lon:  -60, r: 30, str:  18, spin: -1 },   // Bermuda High
  { lat:  30, lon: -140, r: 32, str:  20, spin: -1 },   // Pacific High
  { lat:  35, lon:  -25, r: 26, str:  16, spin: -1 },   // Azores High
  { lat:  28, lon:   75, r: 26, str:  22, spin: +1 },   // South Asian monsoon Low
  { lat:  10, lon:  165, r: 22, str:  18, spin: +1 },   // Tropical W Pacific
  // Southern hemisphere
  { lat: -60, lon:   30, r: 28, str:  22, spin: -1 },   // Sub-Antarctic low (S spins CW)
  { lat: -55, lon:  140, r: 30, str:  24, spin: -1 },
  { lat: -60, lon:  -90, r: 28, str:  22, spin: -1 },
  { lat: -30, lon:  -90, r: 28, str:  18, spin: +1 },   // S Pacific High (S highs spin CCW)
  { lat: -30, lon:  100, r: 28, str:  16, spin: +1 },   // S Indian High
  { lat: -32, lon:    5, r: 26, str:  16, spin: +1 },   // S Atlantic High
];

// Evaluate the analytical wind field at a lat/lon: the three-cell zonal base,
// planetary-wave perturbations, and the semi-permanent cyclones sum into a
// (u,v) vector and its speed. Cheap enough to call per streamline step.
function sampleWindAt(lat, lon) {
  // ─── 1. Three-cell zonal base
  // u_base is symmetric about equator, alternates sign 3× per hemisphere
  // v_base is antisymmetric (toward equator in Hadley/Polar, away in Ferrel)
  const absLat = Math.abs(lat);
  const cellPhase = absLat * Math.PI / 30;       // period = 60°
  const baseMag   = -Math.sin(cellPhase) * 22;   // ±22 km/h
  const u = baseMag;                              // zonal
  let v = baseMag * Math.sign(lat);              // meridional, sign-mirrored

  // ─── 2. Planetary-wave perturbations
  // Multi-mode Fourier series over longitude, latitude-windowed by Gaussian envelopes
  const lonR = lon * Math.PI / 180;
  let du = 0, dv = 0;
  // Mid-latitude wave train
  du += 7  * Math.sin(2 * lonR + 0.5)  * Math.exp(-Math.pow((lat - 35) / 32, 2));
  du += 6  * Math.sin(3 * lonR - 1.2)  * Math.exp(-Math.pow((lat + 35) / 32, 2));
  du += 4  * Math.sin(5 * lonR + 2.3)  * Math.exp(-Math.pow(lat / 55, 2));
  // Tropical perturbation
  du -= 5  * Math.cos(4 * lonR - 0.8)  * Math.exp(-Math.pow(lat / 18, 2));
  // Subtropical jet meanders
  dv += 6  * Math.cos(2 * lonR - 0.3)  * Math.exp(-Math.pow((lat - 30) / 22, 2));
  dv += 5  * Math.cos(4 * lonR + 1.7)  * Math.exp(-Math.pow((lat + 35) / 22, 2));
  dv -= 5  * Math.cos(3 * lonR - 0.8)  * Math.exp(-Math.pow((lat - 50) / 28, 2));
  dv += 4  * Math.sin(5 * lonR + 0.6)  * Math.exp(-Math.pow(lat / 40, 2));

  // ─── 3. Cyclonic features
  let cu = 0, cv = 0;
  for (let i = 0; i < CYCLONES.length; i++) {
    const c = CYCLONES[i];
    const dlat = lat - c.lat;
    let dlon = lon - c.lon;
    if (dlon >  180) dlon -= 360;
    if (dlon < -180) dlon += 360;
    const d2 = dlat * dlat + dlon * dlon;
    const r2 = c.r * c.r;
    if (d2 > 9 * r2) continue;                  // outside ~3× radius
    const falloff = Math.exp(-d2 / r2);
    const ang = Math.atan2(dlat, dlon);          // rad, from +east axis CCW
    // Tangent direction (CCW perp to radial); spin flips it
    cu += -Math.sin(ang) * c.str * falloff * c.spin;
    cv +=  Math.cos(ang) * c.str * falloff * c.spin;
  }

  const finalU = u + du + cu;
  const finalV = v + dv + cv;
  const speed = Math.sqrt(finalU * finalU + finalV * finalV);
  return { u: finalU, v: finalV, speed };
}

// ═══════════════════════════════════════════════════════════════════
// STREAMLINE MESH — pre-traced through analytical field, GPU-animated
// ═══════════════════════════════════════════════════════════════════
const NUM_STREAMS  = IS_MOBILE ? 10000 : 30000;
const STREAM_STEPS = IS_MOBILE ? 24    : 40;
let   streamMesh = null;
let   streamMat  = null;

// RK2 trace through the analytical field. Writes 2 verts per segment.
// Trace one streamline from a random seed point through the wind field with an
// RK2 (midpoint) integrator, writing two vertices per step into the shared line
// buffers. segPos is the 0..1 position along the line, used by the comet shader.
function traceStreamline(streamId, vi, positions, arclens, streamIds, speeds, segPos) {
  let lat = -84 + Math.random() * 168;
  let lon = -180 + Math.random() * 360;
  const r = 1.012;
  let arclen = 0;
  let latR = lat * Math.PI / 180;
  let lonR = lon * Math.PI / 180;
  let prevX = Math.cos(latR) * Math.cos(lonR) * r;
  let prevY = Math.sin(latR) * r;
  let prevZ = -Math.cos(latR) * Math.sin(lonR) * r;
  let prevArclen = 0;
  let prevSpeed = 0;
  const stepGain = 0.05;
  for (let k = 0; k < STREAM_STEPS; k++) {
    // RK2 midpoint
    const w1 = sampleWindAt(lat, lon);
    const cosLat1 = Math.max(0.15, Math.cos(lat * Math.PI / 180));
    const dlatMid = w1.v * stepGain * 0.5;
    const dlonMid = w1.u * stepGain * 0.5 / cosLat1;
    let latMid = lat + dlatMid;
    let lonMid = lon + dlonMid;
    if (lonMid >  180) lonMid -= 360;
    if (lonMid < -180) lonMid += 360;
    const w2 = sampleWindAt(latMid, lonMid);
    const cosLat2 = Math.max(0.15, Math.cos(latMid * Math.PI / 180));
    lat += w2.v * stepGain;
    lon += w2.u * stepGain / cosLat2;
    if (lon >  180) lon -= 360;
    if (lon < -180) lon += 360;
    if (lat >  86) lat =  86;
    if (lat < -86) lat = -86;
    latR = lat * Math.PI / 180;
    lonR = lon * Math.PI / 180;
    const x = Math.cos(latR) * Math.cos(lonR) * r;
    const y = Math.sin(latR) * r;
    const z = -Math.cos(latR) * Math.sin(lonR) * r;
    const dx = x - prevX, dy = y - prevY, dz = z - prevZ;
    arclen += Math.sqrt(dx*dx + dy*dy + dz*dz);
    const fracPrev = k / STREAM_STEPS;
    const fracNow  = (k + 1) / STREAM_STEPS;
    positions[vi*3+0] = prevX; positions[vi*3+1] = prevY; positions[vi*3+2] = prevZ;
    arclens[vi] = prevArclen; streamIds[vi] = streamId; speeds[vi] = prevSpeed; segPos[vi] = fracPrev;
    vi++;
    positions[vi*3+0] = x; positions[vi*3+1] = y; positions[vi*3+2] = z;
    arclens[vi] = arclen;     streamIds[vi] = streamId; speeds[vi] = w2.speed; segPos[vi] = fracNow;
    vi++;
    prevX = x; prevY = y; prevZ = z;
    prevArclen = arclen;
    prevSpeed = w2.speed;
  }
  return vi;
}

// Trace every streamline into one big buffer and build the LineSegments mesh
// with the streamline shader. Traced once; animation is purely a shader uniform.
function buildStreamlineMesh() {
  const segCount  = NUM_STREAMS * STREAM_STEPS;
  const vertCount = segCount * 2;
  const positions = new Float32Array(vertCount * 3);
  const arclens   = new Float32Array(vertCount);
  const streamIds = new Float32Array(vertCount);
  const speeds    = new Float32Array(vertCount);
  const segPos    = new Float32Array(vertCount);
  let vi = 0;
  for (let s = 0; s < NUM_STREAMS; s++) {
    vi = traceStreamline(s, vi, positions, arclens, streamIds, speeds, segPos);
    if ((s & 1023) === 0) setGauge('streams', (s / NUM_STREAMS) * 100);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('arclen',   new THREE.BufferAttribute(arclens, 1));
  geom.setAttribute('streamId', new THREE.BufferAttribute(streamIds, 1));
  geom.setAttribute('speed',    new THREE.BufferAttribute(speeds, 1));
  geom.setAttribute('segPos',   new THREE.BufferAttribute(segPos, 1));
  streamMat = new THREE.ShaderMaterial({
    uniforms: { flowTime: { value: 0 } },
    vertexShader: SH['shaders/streamline.vert.glsl'],
    fragmentShader: SH['shaders/streamline.frag.glsl'],
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  streamMesh = new THREE.LineSegments(geom, streamMat);
  streamMesh.frustumCulled = false;
  streamMesh.visible = !!OVERLAY.weather;
  earthRoot.add(streamMesh);
}

function initWindFlowField() { /* nothing to allocate up front */ }

// Boot the weather layer: advance its gauges, then trace the streamline mesh.
async function loadWeather() {
  splash('wind model: 3-cell zonal + planetary waves');
  setGauge('weather', 35);
  await new Promise(r => setTimeout(r, 30));
  setGauge('weather', 70);
  await new Promise(r => setTimeout(r, 30));
  setGauge('weather', 100, { done: true });
  splash(`wind model: ${CYCLONES.length} pressure centers active`, 'ok');
  splash(`tracing ${NUM_STREAMS} × ${STREAM_STEPS} streamlines…`);
  setGauge('streams', 0);
  // Yield once so the gauge update paints before the heavy synchronous trace
  await new Promise(r => setTimeout(r, 0));
  buildStreamlineMesh();
  setGauge('streams', 100, { done: true });
  splash(`streamlines: ${(NUM_STREAMS * STREAM_STEPS / 1000).toFixed(0)}k segments`, 'ok');
}

// Per-frame: just advance the shader phase. ~0 CPU cost.
function updateWindFlow(dt) {
  if (!streamMat || !streamMesh) return;
  streamMesh.visible = !!OVERLAY.weather;
  if (!OVERLAY.weather) return;
  streamMat.uniforms.flowTime.value += dt * 0.000025;
}

// ═══════════════════════════════════════════════════════════════════
// CITIES (tiered LOD)
// ═══════════════════════════════════════════════════════════════════
const CITIES = [
  ['Tokyo',         35.68,  139.65, 5], ['Delhi',         28.61,   77.21, 5],
  ['Shanghai',      31.23,  121.47, 5], ['New York',      40.71,  -74.00, 5],
  ['Mexico City',   19.43,  -99.13, 5], ['Sao Paulo',    -23.55,  -46.63, 5],
  ['Cairo',         30.04,   31.24, 5], ['Mumbai',        19.08,   72.88, 5],
  ['Beijing',       39.90,  116.41, 5], ['London',        51.51,   -0.13, 5],
  ['Moscow',        55.76,   37.62, 5], ['Lagos',          6.46,    3.41, 5],
  ['Los Angeles',   34.05, -118.24, 4], ['Buenos Aires', -34.60,  -58.38, 4],
  ['Istanbul',      41.01,   28.98, 4], ['Jakarta',       -6.21,  106.85, 4],
  ['Seoul',         37.57,  126.98, 4], ['Bangkok',       13.76,  100.50, 4],
  ['Paris',         48.86,    2.35, 4], ['Tehran',        35.69,   51.39, 4],
  ['Dubai',         25.27,   55.30, 4],
  ['Sydney',       -33.87,  151.21, 3], ['Singapore',      1.35,  103.82, 3],
  ['Hong Kong',     22.32,  114.17, 3], ['Madrid',        40.42,   -3.70, 3],
  ['Rome',          41.90,   12.49, 3], ['Chicago',       41.88,  -87.63, 3],
  ['Berlin',        52.52,   13.40, 3], ['Toronto',       43.65,  -79.38, 3],
  ['Johannesburg', -26.20,   28.05, 3],
  ['Rio de Janeiro',-22.91,  -43.17, 2], ['Lima',         -12.05,  -77.04, 2],
  ['Bogota',         4.71,  -74.07, 2], ['Nairobi',       -1.29,   36.82, 2],
  ['Cape Town',    -33.92,   18.42, 2], ['Auckland',     -36.85,  174.76, 2],
];
// Create one HTML label per city and cache its world position for projection.
const cityElements = [];
function buildCityLabels() {
  for (const [name, lat, lon, tier] of CITIES) {
    const el = document.createElement('div');
    el.className = 'city-label tier-' + tier;
    el.textContent = name;
    document.body.appendChild(el);
    const worldPos = latLonToVec3(lat, lon, 1.005);
    cityElements.push({ name, lat, lon, tier, worldPos, el });
  }
}
// TIER_THRESHOLD sets how close the camera must be for each city tier to show;
// _camN and _cv are scratch vectors reused every frame.
const _camN = new THREE.Vector3();
const _cv   = new THREE.Vector3();
const TIER_THRESHOLD = { 5: 8.5, 4: 4.5, 3: 3.2, 2: 2.0 };

// Position and fade city labels each frame: hide those beyond their tier range
// or on the far side of the globe; fade the rest by distance and facing angle.
function updateCityLabels() {
  const camDist = camera.position.length();
  const cityModeEl = document.getElementById('stat-citymode');
  if (!OVERLAY.cities || !splashGone) {
    for (const c of cityElements) c.el.classList.remove('visible');
    if (cityModeEl) cityModeEl.textContent = 'OFF';
    return;
  }
  if (cityModeEl) {
    cityModeEl.textContent = camDist < 2.0 ? 'NEAR' : camDist < 3.5 ? 'MID' : 'FAR';
  }
  _camN.copy(camera.position).normalize();
  for (const c of cityElements) {
    const threshold = TIER_THRESHOLD[c.tier] || 8.5;
    if (camDist > threshold) { c.el.classList.remove('visible'); continue; }
    _cv.copy(c.worldPos);
    const facing = _cv.clone().normalize().dot(_camN);
    if (facing < 0.05) { c.el.classList.remove('visible'); continue; }
    _cv.project(camera);
    if (_cv.z > 1) { c.el.classList.remove('visible'); continue; }
    const x = (_cv.x*0.5+0.5) * window.innerWidth;
    const y = (-_cv.y*0.5+0.5) * window.innerHeight;
    c.el.style.left = x + 'px';
    c.el.style.top  = y + 'px';
    const fade = Math.min(1, (threshold - camDist) / 0.7);
    c.el.style.opacity = String(fade * Math.min(1, facing * 3));
    c.el.classList.add('visible');
  }
}

// ═══════════════════════════════════════════════════════════════════
// STATION LABELS (always visible — ISS, Tiangong, CSS)
// ═══════════════════════════════════════════════════════════════════
// Station labels are always shown (not gated by zoom). Rebuild the label set
// from the current catalog; clicking one flies the camera to that station.
const stationLabels = [];
function rebuildStationLabels() {
  // Remove old labels
  for (const sl of stationLabels) sl.el.remove();
  stationLabels.length = 0;
  // Create one per station satellite
  for (let i = 0; i < sats.length; i++) {
    if (sats[i].cat !== 'station') continue;
    const el = document.createElement('div');
    el.className = 'station-label';
    const upper = sats[i].name.toUpperCase();
    const isISS = sats[i].noradId === 25544 || /\bISS\b|ZARYA/.test(upper);
    if (isISS) el.classList.add('iss');
    const short = sats[i].name.replace(/\s*\(.*\)\s*/g, '').trim();
    el.textContent = isISS ? 'ISS · INTL SPACE STATION' : short;
    const idx = i;
    el.addEventListener('click', (e) => { e.stopPropagation(); flyToSat(idx); });
    document.body.appendChild(el);
    stationLabels.push({ idx, el, isISS });
  }
}
// Reposition station labels each frame, hiding any parked object or one hidden
// behind the Earth (a ray/sphere occlusion test against the unit globe).
function updateStationLabels() {
  if (!splashGone) {
    for (const sl of stationLabels) sl.el.classList.remove('visible');
    return;
  }
  const camPos = camera.position;
  for (const sl of stationLabels) {
    const idx = sl.idx;
    if (idx >= sats.length) { sl.el.classList.remove('visible'); continue; }
    // Stations should always be labeled — don't respect FILTER.station here.
    const px = positions[idx*3+0];
    const py = positions[idx*3+1];
    const pz = positions[idx*3+2];
    if (px < -5000) { sl.el.classList.remove('visible'); continue; }
    // Earth occlusion: cast a ray from camera to satellite and check whether
    // the line passes through the Earth sphere (radius 1) between the two endpoints.
    const dx = px - camPos.x, dy = py - camPos.y, dz = pz - camPos.z;
    const satDist = Math.hypot(dx, dy, dz);
    if (satDist > 1e-6) {
      const nx = dx/satDist, ny = dy/satDist, nz = dz/satDist;
      // Parameter t at the point on the ray nearest the origin
      const t = -(camPos.x*nx + camPos.y*ny + camPos.z*nz);
      const cx = camPos.x + nx*t;
      const cy = camPos.y + ny*t;
      const cz = camPos.z + nz*t;
      const perpDist = Math.hypot(cx, cy, cz);
      if (perpDist < 0.998 && t > 0 && t < satDist) {
        sl.el.classList.remove('visible'); continue;
      }
    }
    _cv.set(px, py, pz).project(camera);
    if (_cv.z > 1) { sl.el.classList.remove('visible'); continue; }
    const x = (_cv.x*0.5+0.5) * window.innerWidth;
    const y = (-_cv.y*0.5+0.5) * window.innerHeight;
    sl.el.style.left = x + 'px';
    sl.el.style.top  = y + 'px';
    sl.el.classList.add('visible');
  }
}

// ═══════════════════════════════════════════════════════════════════
// SAT LABELS — LOD (zoom-based, for debris analysis)
// Pool of HTML labels reassigned each frame to the nearest sats in view.
// ═══════════════════════════════════════════════════════════════════
// A fixed pool of reusable label elements. Each frame the pool is assigned to
// the nearest in-view satellites, so at most SAT_LABEL_POOL_SIZE show at once.
const SAT_LABEL_POOL_SIZE = 30;
const satLabelPool = [];
function buildSatLabelPool() {
  for (let i = 0; i < SAT_LABEL_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'sat-label';
    document.body.appendChild(el);
    const entry = { el, assignedIdx: -1 };
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (entry.assignedIdx >= 0) {
        lockChipTo(entry.assignedIdx);
        flyToSat(entry.assignedIdx);
      }
    });
    satLabelPool.push(entry);
  }
}
// Zoom-gated satellite labelling for debris analysis. Reassignment (which sats
// get a label) runs at ~5 Hz to stop the text strobing; repositioning of the
// already-chosen labels runs every frame so they track motion.
const _proj = new THREE.Vector3();
let satLabelLastTick = 0;
let satLabelLastReassign = 0;
function updateSatLabels() {
  const now = performance.now();
  // Reposition every frame (cheap projection); reassign which sats get labels
  // only at 5 Hz so the text doesn't strobe.
  const reassign = (now - satLabelLastReassign) > 200;
  if (!splashGone || !OVERLAY.satlabels) {
    for (const sl of satLabelPool) { sl.el.classList.remove('visible'); sl.assignedIdx = -1; }
    return;
  }
  const camDist = camera.position.length();
  // Below this distance, start labeling; closer = more labels
  if (camDist > 3.0) {
    for (const sl of satLabelPool) { sl.el.classList.remove('visible'); sl.assignedIdx = -1; }
    return;
  }
  // Gather candidates: project all visible sats, filter by NDC bounds + facing
  const W = window.innerWidth, H = window.innerHeight;
  const camX = camera.position.x, camY = camera.position.y, camZ = camera.position.z;
  if (reassign) {
    satLabelLastReassign = now;
    const candidates = [];
    for (let i = 0; i < sats.length; i++) {
      if (!FILTER[sats[i].cat]) continue;
      if (sats[i].cat === 'station') continue; // always-labeled separately
      const px = positions[i*3+0], py = positions[i*3+1], pz = positions[i*3+2];
      if (px < -5000) continue;
      const dx = px - camX, dy = py - camY, dz = pz - camZ;
      const distSq = dx*dx + dy*dy + dz*dz;
      _proj.set(px, py, pz).project(camera);
      if (_proj.z > 1 || _proj.x < -1 || _proj.x > 1 || _proj.y < -1 || _proj.y > 1) continue;
      candidates.push({ idx: i, distSq, sx: _proj.x, sy: _proj.y });
    }
    candidates.sort((a, b) => a.distSq - b.distSq);
    const chosen = [];
    const MIN_PX_DIST = 60;
    const minDx2 = (MIN_PX_DIST / W * 2) ** 2;
    const minDy2 = (MIN_PX_DIST / H * 2) ** 2;
    outer: for (const c of candidates) {
      if (chosen.length >= SAT_LABEL_POOL_SIZE) break;
      for (const k of chosen) {
        const dx = c.sx - k.sx, dy = c.sy - k.sy;
        if (dx*dx/minDx2 + dy*dy/minDy2 < 1) continue outer;
      }
      chosen.push(c);
    }
    for (let i = 0; i < satLabelPool.length; i++) {
      const sl = satLabelPool[i];
      if (i >= chosen.length) {
        sl.el.classList.remove('visible'); sl.assignedIdx = -1; continue;
      }
      const c = chosen[i];
      const s = sats[c.idx];
      if (sl.assignedIdx !== c.idx) {
        sl.el.textContent = s.name.length > 24 ? s.name.slice(0,22)+'…' : s.name;
        sl.assignedIdx = c.idx;
      }
      sl.el.style.left = ((c.sx*0.5+0.5)*W) + 'px';
      sl.el.style.top  = ((-c.sy*0.5+0.5)*H) + 'px';
      sl.el.classList.add('visible');
    }
  } else {
    // Cheap per-frame reproject so labels track sat motion smoothly
    for (let i = 0; i < satLabelPool.length; i++) {
      const sl = satLabelPool[i];
      const idx = sl.assignedIdx;
      if (idx < 0 || idx >= sats.length) { sl.el.classList.remove('visible'); continue; }
      const px = positions[idx*3+0], py = positions[idx*3+1], pz = positions[idx*3+2];
      if (px < -5000) { sl.el.classList.remove('visible'); continue; }
      _proj.set(px, py, pz).project(camera);
      if (_proj.z > 1 || _proj.x < -1 || _proj.x > 1 || _proj.y < -1 || _proj.y > 1) {
        sl.el.classList.remove('visible'); continue;
      }
      sl.el.style.left = ((_proj.x*0.5+0.5)*W) + 'px';
      sl.el.style.top  = ((-_proj.y*0.5+0.5)*H) + 'px';
      sl.el.classList.add('visible');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ORBIT TRAIL (selected sat)
// ═══════════════════════════════════════════════════════════════════
// Orbit trail for the selected object: one closed loop sampled over one period.
let trailLine = null;
let trailLastBuildTime = 0;
let trailLastIdx = -1;
let chipTrailEnabled = true;
// Rebuild the selected object's trail by propagating it across one orbital
// period and stringing the points into a line.
function buildTrailFor(idx) {
  if (idx < 0 || idx >= sats.length) return;
  const s = sats[idx];
  if (!s.satrec || s._isStorm) return;
  const periodMin = (2*Math.PI) / s.satrec.no;
  const N = 96;
  const pts = [];
  const baseT = SIM.time.getTime();
  for (let i = 0; i <= N; i++) {
    const t = new Date(baseT + (i/N) * periodMin * 60000);
    const pv = satellite.propagate(s.satrec, t);
    if (!pv.position) continue;
    const gmst = satellite.gstime(t);
    const ecef = satellite.eciToEcf(pv.position, gmst);
    const v = new THREE.Vector3();
    ecefToScene(ecef.x, ecef.y, ecef.z, v);
    pts.push(v);
  }
  if (trailLine) {
    earthRoot.remove(trailLine);
    trailLine.geometry.dispose();
    trailLine = null;
  }
  if (pts.length < 2) return;
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0x5ad7ff, transparent: true, opacity: 0.55,
  });
  trailLine = new THREE.Line(geom, mat);
  earthRoot.add(trailLine);
}
// Rebuild the selected trail only when the selection changes or sim time has
// drifted far enough that the old loop is stale.
function maybeRebuildTrail() {
  if (!OVERLAY.trails || !chipTrailEnabled) {
    if (trailLine) { earthRoot.remove(trailLine); trailLine.geometry.dispose(); trailLine = null; }
    return;
  }
  if (selectedIdx < 0) {
    if (trailLine) { earthRoot.remove(trailLine); trailLine.geometry.dispose(); trailLine = null; }
    return;
  }
  const dtSinceBuild = SIM.time.getTime() - trailLastBuildTime;
  if (selectedIdx !== trailLastIdx || Math.abs(dtSinceBuild) > 300000) {
    buildTrailFor(selectedIdx);
    trailLastIdx = selectedIdx;
    trailLastBuildTime = SIM.time.getTime();
  }
}

// Always-on orbital trails for every station (ISS, Tiangong, Dragon, Cygnus, etc.)
// Every station gets a permanent orbit loop (ISS drawn brighter). Rebuilt from
// the catalog and refreshed periodically as SGP4 drifts.
const stationTrails = [];
let lastStationTrailBuild = -Infinity;
function rebuildStationTrails() {
  for (const st of stationTrails) {
    earthRoot.remove(st.line);
    st.line.geometry.dispose();
    st.line.material.dispose();
  }
  stationTrails.length = 0;
  for (let i = 0; i < sats.length; i++) {
    if (sats[i].cat !== 'station') continue;
    const s = sats[i];
    if (!s.satrec || s._isStorm) continue;
    const periodMin = (2*Math.PI) / s.satrec.no;
    const N = 96;
    const pts = [];
    const baseT = SIM.time.getTime();
    for (let k = 0; k <= N; k++) {
      const t = new Date(baseT + (k/N) * periodMin * 60000);
      const pv = satellite.propagate(s.satrec, t);
      if (!pv.position) continue;
      const gmst = satellite.gstime(t);
      const ecef = satellite.eciToEcf(pv.position, gmst);
      const v = new THREE.Vector3();
      ecefToScene(ecef.x, ecef.y, ecef.z, v);
      pts.push(v);
    }
    if (pts.length < 2) continue;
    const upper = s.name.toUpperCase();
    const isISS = s.noradId === 25544 || /\bISS\b|ZARYA/.test(upper);
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: isISS ? 0xffd070 : 0xe8e8d8,
      transparent: true,
      opacity: isISS ? 0.65 : 0.32,
    });
    const line = new THREE.Line(geom, mat);
    earthRoot.add(line);
    stationTrails.push({ idx: i, line, isISS });
  }
  lastStationTrailBuild = SIM.time.getTime();
}
function maybeRebuildStationTrails() {
  // Rebuild every 60 sec of sim time so the closed loops stay accurate as
  // SGP4 drifts; also catches the case where stations were added later.
  const elapsed = SIM.time.getTime() - lastStationTrailBuild;
  if (Math.abs(elapsed) > 60000) rebuildStationTrails();
}

// ═══════════════════════════════════════════════════════════════════
// FILTERS + OVERLAYS
// ═══════════════════════════════════════════════════════════════════
// Category filter rows: the checkbox toggles visibility; clicking the row locks
// or unlocks a highlight, and hovering previews it while nothing is locked.
let lockedHighlight = null;
document.querySelectorAll('.filter-row[data-cat]').forEach(row => {
  const cat = row.dataset.cat;
  const cb = row.querySelector('input[type=checkbox]');
  cb.addEventListener('change', () => { FILTER[cat] = cb.checked; });
  cb.addEventListener('click', (e) => e.stopPropagation());
  row.addEventListener('click', (e) => {
    if (e.target.matches('input')) return;
    if (lockedHighlight === cat) {
      lockedHighlight = null;
      highlightCat = null;
    } else {
      lockedHighlight = cat;
      highlightCat = cat;
    }
    document.querySelectorAll('.filter-row[data-cat]').forEach(r => {
      r.classList.toggle('locked', r.dataset.cat === lockedHighlight);
    });
  });
  row.addEventListener('pointerenter', () => {
    if (!lockedHighlight) highlightCat = cat;
  });
  row.addEventListener('pointerleave', () => {
    if (!lockedHighlight) highlightCat = null;
  });
});
// Overlay checkboxes: toggle each optional layer and do any layer-specific
// cleanup when it is switched off.
document.querySelectorAll('.filter-row[data-overlay]').forEach(row => {
  const k = row.dataset.overlay;
  const cb = row.querySelector('input[type=checkbox]');
  cb.addEventListener('change', () => {
    OVERLAY[k] = cb.checked;
    if (k === 'weather' && streamMesh) streamMesh.visible = cb.checked;
    if (k === 'cities' && !cb.checked) for (const c of cityElements) c.el.classList.remove('visible');
    if (k === 'trails') maybeRebuildTrail();
    if (k === 'satlabels' && !cb.checked) {
      for (const sl of satLabelPool) { sl.el.classList.remove('visible'); sl.assignedIdx = -1; }
    }
  });
});
// Recount objects per category and update the panel counters.
function updateCounts() {
  const c = {starlink:0, payload:0, station:0, rocket:0, debris:0, storm:0};
  for (const s of sats) c[s.cat]++;
  for (const k of Object.keys(c)) {
    const el = document.getElementById('cnt-'+k);
    if (!el) continue;
    if (el.textContent !== c[k].toLocaleString()) retrigger(el.closest('.filter-row'), 'bump');
    tweenNumber(el, c[k]);
  }
  tweenNumber(document.getElementById('stat-count'), sats.length);
  tweenNumber(acqCountEl, sats.length);
}

// ═══════════════════════════════════════════════════════════════════
// PICKING (hover chip / lock chip / target reticle)
// ═══════════════════════════════════════════════════════════════════
// Picking state: selectedIdx is the locked object, hoveredIdx the one under the
// pointer, chipLocked whether the info chip is pinned. The raycaster hit-tests
// the point cloud; the chip and reticle are the HTML overlays that follow it.
let selectedIdx = -1;
let hoveredIdx  = -1;
let chipLocked  = false;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const chip = document.getElementById('chip');
const chipClose = document.getElementById('chip-close');
const chipHint  = chip.querySelector('.ch-hint');
const reticle = document.getElementById('target-reticle');
const reticleLabel = reticle.querySelector('.tr-label');

// Raycast the point cloud under a screen coordinate and return the nearest
// object index, or -1. The hit threshold scales with camera distance and widens
// on a first miss so glyphs stay easy to click.
function pickAt(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  // Generous threshold so clicking near any visible glyph hits. Scales with
  // camera distance to keep the screen-pixel hit area roughly constant.
  const dist = camera.position.length();
  raycaster.params.Points.threshold = Math.max(0.06, 0.025 * dist);
  raycaster.setFromCamera(mouse, camera);
  let hits = raycaster.intersectObject(satPoints, false);
  // Fallback: if no hit, try again even wider
  if (hits.length === 0) {
    raycaster.params.Points.threshold = Math.max(0.12, 0.05 * dist);
    raycaster.setFromCamera(mouse, camera);
    hits = raycaster.intersectObject(satPoints, false);
  }
  if (hits.length === 0) return -1;
  // Prefer hit closest to the ray
  let best = hits[0];
  for (const h of hits) if (h.distanceToRay < best.distanceToRay) best = h;
  return best.index;
}
// Format a number to d decimals, or an em dash when it is not finite.
function fmt(v, d=1) { return Number.isFinite(v) ? v.toFixed(d) : '—'; }
// Escape a string for safe insertion into innerHTML.
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Derive period, apogee, perigee, and inclination from an SGP4 satrec.
function orbitalElements(satrec) {
  if (!satrec) return null;
  const periodMin = (2*Math.PI) / satrec.no;
  const n = satrec.no / 60;
  const a = Math.pow(MU / (n*n), 1/3);
  const e = satrec.ecco;
  return {
    periodMin,
    apogee:  a*(1+e) - EARTH_R_KM,
    perigee: a*(1-e) - EARTH_R_KM,
    incDeg:  satrec.inclo * 180/Math.PI,
  };
}
// Populate the info chip for one object: storm fields for storms, live orbital
// readouts (altitude, lat/lon, velocity, elements) for satellites.
function fillChip(idx) {
  if (idx < 0 || idx >= sats.length) return false;
  const s = sats[idx];
  chip.querySelector('.ch-name').textContent = s.name;
  chip.querySelector('.ch-cat').textContent  = s.cat.toUpperCase();
  const body = chip.querySelector('.ch-body');
  if (s._isStorm) {
    const st = s._stormData;
    body.innerHTML =
      `<div class="ch-row"><span class="k">CLASS</span><span class="v">${escHtml(st.classification || '—')}</span></div>` +
      `<div class="ch-row"><span class="k">LAT</span><span class="v dyn">${fmt(st.lat, 2)}°</span></div>` +
      `<div class="ch-row"><span class="k">LON</span><span class="v dyn">${fmt(st.lon, 2)}°</span></div>` +
      `<div class="ch-row"><span class="k">WIND</span><span class="v">${st.wind ? st.wind+' kt' : '—'}</span></div>` +
      `<div class="ch-row"><span class="k">SRC</span><span class="v">NOAA NHC</span></div>`;
    return true;
  }
  const oe = orbitalElements(s.satrec);
  const pv = satellite.propagate(s.satrec, SIM.time);
  let alt = NaN, lat = NaN, lon = NaN, speed = NaN;
  if (pv.position) {
    const gmst = satellite.gstime(SIM.time);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    alt = geo.height;
    lat = geo.latitude * 180/Math.PI;
    lon = geo.longitude * 180/Math.PI;
    if (pv.velocity) speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  }
  body.innerHTML =
    `<div class="ch-row"><span class="k">NORAD</span><span class="v">${s.noradId}</span></div>` +
    `<div class="ch-row"><span class="k">ALT</span><span class="v dyn">${fmt(alt, 0)} km</span></div>` +
    `<div class="ch-row"><span class="k">LAT / LON</span><span class="v dyn">${fmt(lat, 1)}° / ${fmt(lon, 1)}°</span></div>` +
    `<div class="ch-row"><span class="k">VEL</span><span class="v dyn">${fmt(speed, 2)} km/s</span></div>` +
    `<div class="ch-row"><span class="k">INC</span><span class="v">${fmt(oe.incDeg, 1)}°</span></div>` +
    `<div class="ch-row"><span class="k">PERIOD</span><span class="v">${fmt(oe.periodMin, 1)} min</span></div>` +
    `<div class="ch-row"><span class="k">APO / PER</span><span class="v">${fmt(oe.apogee, 0)} / ${fmt(oe.perigee, 0)} km</span></div>` +
    (s.notable ? `<div class="ch-row"><span class="k">EVENT</span><span class="v">${escHtml(s.notable)}</span></div>` : '');
  return true;
}
// Show the floating chip next to the pointer while hovering (unless locked).
function showHoverChip(clientX, clientY, idx) {
  if (chipLocked) return;
  if (idx < 0) { chip.style.display = 'none'; return; }
  if (!fillChip(idx)) { chip.style.display = 'none'; return; }
  chip.style.display = 'block';
  chip.style.left = (clientX + 14) + 'px';
  chip.style.top  = (clientY + 14) + 'px';
  chip.classList.remove('locked');
  chipHint.textContent = 'click to lock';
  chipClose.style.display = 'none';
}
// Pin the chip to an object: mark it selected, show the reticle and trail, and
// fill the detailed info panel.
function lockChipTo(idx) {
  if (idx < 0) { unlockChip(); return; }
  selectedIdx = idx;
  if (!fillChip(idx)) { chip.style.display = 'none'; return; }
  chip.style.display = 'block';
  chip.classList.add('locked');
  chipLocked = true;
  chipHint.textContent = 'locked';
  chipClose.style.display = 'inline';
  reticleLabel.textContent = 'LOCKED · ' + sats[idx].cat.toUpperCase();
  maybeRebuildTrail();
  showObjectInfo(idx);
}
// Clear the selection, hide the chip/reticle/trail, and ease the camera back
// to looking at Earth's centre.
function unlockChip() {
  chipLocked = false;
  selectedIdx = -1;
  chip.style.display = 'none';
  chip.classList.remove('locked');
  reticle.classList.remove('visible');
  maybeRebuildTrail();
  showObjectInfo(-1);
  if (controls.target.lengthSq() > 0.0001) {
    flyTo(camera.position.clone(), new THREE.Vector3(0, 0, 0), 600);
  }
}
chipClose.addEventListener('click', (e) => { e.stopPropagation(); unlockChip(); });

// Chip buttons: toggle the selected object's trail, or fly the camera to it.
const chipTrailBtn = document.getElementById('chip-trail');
const chipFocusBtn = document.getElementById('chip-focus');
chipTrailBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  chipTrailEnabled = !chipTrailEnabled;
  chipTrailBtn.classList.toggle('active', chipTrailEnabled);
  maybeRebuildTrail();
});
chipFocusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (selectedIdx < 0) return;
  flyToSat(selectedIdx);
});

// Pointer move: throttle picking to ~20 Hz; between picks just move the chip.
let hoverThrottle = 0;
canvas.addEventListener('pointermove', (e) => {
  if (chipLocked) return;
  const now = performance.now();
  if (now - hoverThrottle < 50) {
    chip.style.left = (e.clientX + 14) + 'px';
    chip.style.top  = (e.clientY + 14) + 'px';
    return;
  }
  hoverThrottle = now;
  const idx = pickAt(e.clientX, e.clientY);
  hoveredIdx = idx;
  showHoverChip(e.clientX, e.clientY, idx);
});
canvas.addEventListener('pointerleave', () => {
  if (!chipLocked) chip.style.display = 'none';
});

// Click vs drag: remember where the press started, and on release treat it as a
// pick only if the pointer barely moved (otherwise it was a globe rotation).
let pointerDownPos = null;
canvas.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointerDownPos) return;
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  const dragged = Math.hypot(dx, dy) > 8;
  pointerDownPos = null;
  if (dragged) return; // user was rotating the globe
  const idx = pickAt(e.clientX, e.clientY);
  if (idx >= 0) { lockChipTo(idx); flyToSat(idx); }
  // Don't unlock on empty-space clicks; use the × button on the chip.
});

// Keep the locked chip beside the selected object as it moves (desktop only).
function updateChipPositionLocked() {
  if (!chipLocked || selectedIdx < 0) return;
  const px = positions[selectedIdx*3+0];
  const py = positions[selectedIdx*3+1];
  const pz = positions[selectedIdx*3+2];
  if (px < -5000) return;
  _cv.set(px, py, pz).project(camera);
  if (_cv.z > 1) return;
  if (!IS_MOBILE) {
    const sx = (_cv.x*0.5+0.5) * window.innerWidth;
    const sy = (-_cv.y*0.5+0.5) * window.innerHeight;
    chip.style.left = (sx + 36) + 'px';
    chip.style.top  = (sy - 30) + 'px';
  }
}
// Position the targeting reticle over the selected object, hiding it when the
// object is off-screen or behind the camera.
function updateReticle() {
  if (!chipLocked || selectedIdx < 0) {
    reticle.classList.remove('visible');
    return;
  }
  const px = positions[selectedIdx*3+0];
  const py = positions[selectedIdx*3+1];
  const pz = positions[selectedIdx*3+2];
  if (px < -5000) { reticle.classList.remove('visible'); return; }
  _cv.set(px, py, pz).project(camera);
  if (_cv.z > 1) { reticle.classList.remove('visible'); return; }
  const x = (_cv.x*0.5+0.5) * window.innerWidth;
  const y = (-_cv.y*0.5+0.5) * window.innerHeight;
  reticle.style.left = x + 'px';
  reticle.style.top  = y + 'px';
  reticle.classList.add('visible');
}
setInterval(() => { if (chipLocked && selectedIdx >= 0) fillChip(selectedIdx); }, 500);

// ═══════════════════════════════════════════════════════════════════
// TLE LOADER
// ═══════════════════════════════════════════════════════════════════
// Fetch TLE text with an abort-based timeout so a slow source cannot hang boot.
// Responses go into the Cache API for TLE_TTL_MS. CelesTrak updates each group
// about every 2 h and blocks clients that download more often, so a reload in
// that window reads the cache. A stale cache entry is the fallback when the
// network fetch fails.
// CelesTrak sends 403 (IP block) or 429 (rate limit) to a client that
// downloads too much, or it holds the connection with no response. Each new
// request extends the block, so after the first 403, 429, timeout or network
// error this page sends no more requests to CelesTrak.
// The timeout covers the time to the response headers, not the body, so a
// large group on a slow link does not trip it.
const TLE_CACHE   = 'leo-catalog-tle-v1';
const TLE_TTL_MS  = 2 * 60 * 60 * 1000;
const HAS_CACHE   = typeof caches !== 'undefined';
let celestrakBlocked = false;
async function cacheRead(url) {
  if (!HAS_CACHE) return null;
  try {
    const hit = await (await caches.open(TLE_CACHE)).match(url);
    if (!hit) return null;
    const at = Number(hit.headers.get('x-fetched-at')) || 0;
    return { text: await hit.text(), fresh: Date.now() - at < TLE_TTL_MS };
  } catch (e) { return null; }
}
async function cacheWrite(url, text) {
  if (!HAS_CACHE) return;
  try {
    const c = await caches.open(TLE_CACHE);
    await c.put(url, new Response(text, { headers: { 'x-fetched-at': String(Date.now()) } }));
  } catch (e) {}
}
async function fetchTLE(url, timeout = 8000) {
  const cached = await cacheRead(url);
  if (cached && cached.fresh) return cached.text;
  const isCelestrak = url.startsWith('https://celestrak.org/');
  if (isCelestrak && celestrakBlocked) {
    if (cached) return cached.text;
    throw new Error('CelesTrak blocked');
  }
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { mode: 'cors', signal: ctrl.signal });
    clearTimeout(id);
    if (isCelestrak && (res.status === 403 || res.status === 429)) celestrakBlocked = true;
    if (!res.ok) throw new Error('HTTP '+res.status);
    const text = await res.text();
    // CelesTrak answers a rate-limited request with 200 and a plain-text notice.
    if (!/^1 \d/m.test(text)) throw new Error('no TLE in response');
    cacheWrite(url, text);
    return text;
  } catch (e) {
    clearTimeout(id);
    // AbortError is the timeout; TypeError is a network or CORS failure.
    if (isCelestrak && (e.name === 'AbortError' || e.name === 'TypeError')) celestrakBlocked = true;
    if (cached) return cached.text;
    throw e;
  }
}
// NORAD ids already in sats, so each dedupe check is O(1).
const knownIds = new Set();
// Fetch and parse one TLE source, adding new (deduped by NORAD id) objects to
// the catalog up to PERF_CAP; returns how many were added.
async function loadSource(url, notableLabel = null, forceCat = null) {
  const txt = await fetchTLE(url);
  const parsed = parseTLE(txt);
  let added = 0;
  for (const p of parsed) {
    if (sats.length >= PERF_CAP) break;
    if (knownIds.has(p.noradId)) continue;
    if (notableLabel) p.notable = notableLabel;
    if (forceCat)     p.cat = forceCat;
    sats.push(p);
    knownIds.add(p.noradId);
    added++;
  }
  return added;
}
const URL_GP    = (group) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
const URL_CATNR = (n)     => `https://celestrak.org/NORAD/elements/gp.php?CATNR=${n}&FORMAT=tle`;

// ═══════════════════════════════════════════════════════════════════
// OBJECT INFO PANEL  (replaces encyclopedia)
// ═══════════════════════════════════════════════════════════════════
// The info panel shows a curated description plus live orbital elements for the
// selected object; the banner is a legacy element kept only as a stub target.
const infoBody = document.getElementById('info-body');
const banner = document.getElementById('banner');

// Curated descriptions, returned for the first regex that matches.
// Each entry: [matcher, { description, wiki, [extra fields] }]
const OBJECT_KNOWLEDGE = [
  [/^ISS\b|ZARYA/, {
    desc: 'International Space Station. Football-field-sized, continuously crewed since November 2000. Joint US, Russia, ESA, Japan, Canada project. Orbits ~400 km up at 51.6° inclination, lapping Earth every 92 minutes. Slated for deorbit around 2030.',
    wiki: 'International_Space_Station',
  }],
  [/TIANGONG|TIANHE|WENTIAN|MENGTIAN|CSS \(|SHENZHOU|TIANZHOU/, {
    desc: 'Chinese space station and visiting vehicles. Tiangong is China\'s permanent crewed station — three modules (Tianhe core, Wentian and Mengtian labs) at ~390 km, 41.5° inc. Crewed continuously since June 2022. Shenzhou are crewed taxis; Tianzhou are cargo.',
    wiki: 'Tiangong_space_station',
  }],
  [/^DRAGON|^CREW DRAGON/, {
    desc: 'SpaceX Crew/Cargo Dragon docked to or rendezvousing with ISS. Reusable capsule first crewed in 2020 (Demo-2). Up to 4 crew per flight on Falcon 9.',
    wiki: 'SpaceX_Dragon_2',
  }],
  [/^PROGRESS/, {
    desc: 'Russian Progress cargo spacecraft — an uncrewed Soyuz-derived ferry that resupplies ISS. Burns up on reentry after delivering its load.',
    wiki: 'Progress_(spacecraft)',
  }],
  [/^CYGNUS/, {
    desc: 'Northrop Grumman Cygnus cargo spacecraft. Launches on Antares (or Falcon 9 in recent missions); delivers cargo to ISS then disposes of itself in atmosphere.',
    wiki: 'Cygnus_(spacecraft)',
  }],
  [/^STARLINK/, {
    desc: 'SpaceX Starlink LEO broadband. ~6,500+ active. Two main shells: 550 km @ 53° (bulk) and 600 km @ 70–97° (polar). Launched 20–60 per Falcon 9 since 2019. Provides direct-to-consumer internet via flat phased-array terminals.',
    wiki: 'Starlink',
  }],
  [/^ONEWEB/, {
    desc: 'OneWeb LEO broadband constellation — ~648 satellites at 1,200 km in 87° polar orbit. Targets enterprise, government, aviation, and mobility markets. Owned by Eutelsat after the 2022 merger.',
    wiki: 'OneWeb_satellite_constellation',
  }],
  [/^GPS BIIR|^GPS BIIF|^NAVSTAR/, {
    desc: 'US Air Force GPS navigation satellite. Constellation of 31+ active birds in 6 planes at 20,200 km altitude, 55° inclination, ~12-hour period. Each broadcasts coded ranging signals that civilian and military receivers use to trilateral their position to within meters.',
    wiki: 'GPS_satellite_blocks',
  }],
  [/^GSAT|^GALILEO/, {
    desc: 'European Galileo GNSS satellite. The EU\'s answer to GPS. 23,222 km altitude in 56° inclination MEO — slightly higher than GPS, so the orbit looks ‘weird\' compared to LEO. Provides sub-meter positioning to authorized users via the Public Regulated Service.',
    wiki: 'Galileo_(satellite_navigation)',
  }],
  [/^COSMOS 24|^COSMOS 25(0|1|2|3|4|5)/, {
    desc: 'Russian GLONASS navigation satellite (Cosmos series numbering). ~19,100 km, 64.8° MEO orbit. Provides global navigation; the original Soviet GPS analog, fully restored to operational status in 2011.',
    wiki: 'GLONASS',
  }],
  [/^IRIDIUM/, {
    desc: 'Iridium satphone & data constellation. 66 active birds at 780 km, 86.4° polar. Each spot-beams cellphone-style coverage to a moving footprint on the surface. The 2017–2019 NEXT generation replaced the original 1997 hardware. Famous for the bright pre-NEXT "Iridium flares".',
    wiki: 'Iridium_satellite_constellation',
  }],
  [/HUBBLE|HST|^HST/, {
    desc: 'Hubble Space Telescope. Launched 24 Apr 1990 by STS-31. 2.4 m primary mirror. Five Shuttle servicing missions (1993, 1997, 1999, 2002, 2009) — the first famously corrected a manufacturing flaw in the mirror. Currently ~535 km, 28.5° inc; without a reboost it will reenter sometime in the 2030s.',
    wiki: 'Hubble_Space_Telescope',
  }],
  [/^VANGUARD 1\b/, {
    desc: 'The oldest artificial object still in orbit. Launched 17 Mar 1958 — a 1.46 kg grapefruit-sized solar-cell test article. Its 654 × 3,840 km elliptical orbit means atmospheric drag is essentially nil; predicted to last another ~240 years.',
    wiki: 'Vanguard_1',
  }],
  [/ENVISAT/, {
    desc: 'ENVISAT — 8-tonne ESA environmental observation satellite at 768 km. Lost contact 8 Apr 2012 and never recovered. Largest dead object in heavily populated LEO; it will linger ~150 years and is the #1 collision risk in orbit. Several active-removal mission concepts have targeted it; none flown.',
    wiki: 'Envisat',
  }],
  [/^COSMOS 1408/, {
    desc: 'Russia\'s 15 Nov 2021 ASAT test target — a defunct Tselina-D ELINT bird destroyed by a PL-19 Nudol direct-ascent missile at 480 km. The strike created 1,500+ tracked fragments. ISS crew sheltered in capsules during the closest pass; the cloud still threatens LEO objects.',
    wiki: 'Russian_anti-satellite_weapon_test',
  }],
  [/^FENGYUN 1C/, {
    desc: 'Chinese weather satellite destroyed in the 11 Jan 2007 SC-19 ASAT test at 865 km. The single most debris-generating event in spaceflight history — ~3,500 fragments still tracked. Triggered global condemnation and accelerated debris-mitigation regulation.',
    wiki: '2007_Chinese_anti-satellite_missile_test',
  }],
  [/IRIDIUM 33 DEB|COSMOS 2251 DEB/, {
    desc: 'Fragment from the 10 Feb 2009 Iridium 33 + Cosmos 2251 collision. First catastrophic collision between two intact satellites — 11.7 km/s impact at 789 km over Siberia. ~2,000 trackable fragments produced. Drove the development of conjunction warning services.',
    wiki: 'Satellite_collision',
  }],
  [/^GOES|^METEOSAT|^HIMAWARI|^FY-?[234]/, {
    desc: 'Geostationary weather satellite. ~35,786 km altitude. Sits over a fixed longitude relative to Earth\'s surface, scanning a full disk every 5–15 minutes. The reason your weather forecast has those swirling cloud-top images.',
    wiki: 'Geostationary_orbit',
  }],
  [/^INTELSAT|^SES |^EUTELSAT/, {
    desc: 'Commercial geostationary communications satellite. 35,786 km altitude, equatorial, ~24-hour period — appears motionless from the ground. Carries TV, radio, broadband, and trunked telecom traffic to fixed-position dishes.',
    wiki: 'Communications_satellite',
  }],
  [/^WESTFORD/, {
    desc: 'Westford Needles — 480 million 1.78 cm copper dipole antennas USAF dispersed in 1963 to create an artificial ionospheric reflector for HF radio. Most de-orbited via solar pressure by the 1990s as designed; a few clumped masses failed to disperse and remain at ~3,500 km.',
    wiki: 'Project_West_Ford',
  }],
];

// Pick a description for an object: the first matching curated entry, else a
// category-level fallback (station, rocket, debris, or generic payload).
function describeObject(s) {
  if (s._isStorm) {
    return {
      desc: 'Active tropical cyclone tracked by the NOAA National Hurricane Center. Position updated from the Current Storms feed.',
      wiki: 'Tropical_cyclone',
    };
  }
  for (const [pat, info] of OBJECT_KNOWLEDGE) {
    if (pat.test(s.name)) return info;
  }
  // Fall back to category-level descriptions
  if (s.cat === 'station') return {
    desc: 'Crewed orbital platform or a vehicle visiting one. Stations support continuous human habitation, science research, and Earth observation.',
    wiki: 'Space_station',
  };
  if (s.cat === 'rocket') return {
    desc: 'Spent upper stage left behind after deploying its payload. Typically aluminum-titanium tankage, often still containing residual propellant. Without active deorbiting, these decay over years (LEO) to centuries (high orbit).',
    wiki: 'Spent_upper_stage',
  };
  if (s.cat === 'debris') return {
    desc: 'Tracked space debris — a fragment from a collision, explosion, or anti-satellite test. Each piece is catalogued by USSPACECOM. Even paint flecks at orbital velocity can shatter spacecraft windows.',
    wiki: 'Space_debris',
  };
  // Generic payload
  return {
    desc: 'Earth-orbiting satellite. Use the orbital elements below to gauge its purpose: low circular orbits (~500 km) tend to be Earth observation or comms; mid (~20,000 km) are usually navigation; geosynchronous (~36,000 km) are weather or telecom.',
    wiki: 'Satellite',
  };
}

// Build the orbital-element rows for the info panel (storm or satellite).
function infoOrbitRowsHTML(s) {
  if (s._isStorm) {
    const st = s._stormData;
    return (
      `<div class="info-row"><span class="k">classification</span><span class="v">${escHtml(st.classification || '—')}</span></div>` +
      `<div class="info-row"><span class="k">lat</span><span class="v dyn">${fmt(st.lat, 2)}°</span></div>` +
      `<div class="info-row"><span class="k">lon</span><span class="v dyn">${fmt(st.lon, 2)}°</span></div>` +
      `<div class="info-row"><span class="k">wind</span><span class="v">${st.wind ? st.wind+' kt' : '—'}</span></div>`
    );
  }
  if (!s.satrec) return '';
  const oe = orbitalElements(s.satrec);
  const pv = satellite.propagate(s.satrec, SIM.time);
  let alt = NaN, lat = NaN, lon = NaN, speed = NaN;
  if (pv.position) {
    const gmst = satellite.gstime(SIM.time);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    alt = geo.height;
    lat = geo.latitude * 180/Math.PI;
    lon = geo.longitude * 180/Math.PI;
    if (pv.velocity) speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  }
  return (
    `<div class="info-row"><span class="k">norad id</span><span class="v">${s.noradId}</span></div>` +
    `<div class="info-row"><span class="k">altitude</span><span class="v dyn">${fmt(alt, 0)} km</span></div>` +
    `<div class="info-row"><span class="k">lat / lon</span><span class="v dyn">${fmt(lat, 1)}° / ${fmt(lon, 1)}°</span></div>` +
    `<div class="info-row"><span class="k">velocity</span><span class="v dyn">${fmt(speed, 2)} km/s</span></div>` +
    `<div class="info-row"><span class="k">inclination</span><span class="v">${fmt(oe.incDeg, 1)}°</span></div>` +
    `<div class="info-row"><span class="k">period</span><span class="v">${fmt(oe.periodMin, 1)} min</span></div>` +
    `<div class="info-row"><span class="k">apogee / perigee</span><span class="v">${fmt(oe.apogee, 0)} / ${fmt(oe.perigee, 0)} km</span></div>`
  );
}

// Render the full info panel for an object: category, name, description, live
// elements, and external reference links. Empty prompt when nothing selected.
function showObjectInfo(idx) {
  if (!infoBody) return;
  if (idx < 0 || idx >= sats.length) {
    infoBody.innerHTML = '<div class="info-empty">click any satellite, debris, or station to see details</div>';
    return;
  }
  const s = sats[idx];
  const info = describeObject(s);
  const wikiURL = `https://en.wikipedia.org/wiki/${info.wiki}`;
  const n2yoURL = s.noradId ? `https://www.n2yo.com/satellite/?s=${s.noradId}` : null;
  const cstrURL = s.noradId ? `https://celestrak.org/satcat/tle.php?CATNR=${s.noradId}` : null;
  infoBody.innerHTML =
    `<div class="info-section">` +
      `<span class="info-cat">${s.cat.toUpperCase()}</span>` +
      `<h3 class="info-name">${escHtml(s.name)}</h3>` +
      `<div class="info-desc">${escHtml(info.desc)}</div>` +
    `</div>` +
    `<div class="info-section">` +
      `<div class="info-label">orbital elements</div>` +
      infoOrbitRowsHTML(s) +
    `</div>` +
    `<div class="info-section">` +
      `<div class="info-label">external references</div>` +
      `<div class="info-links">` +
        `<a class="info-link" href="${wikiURL}" target="_blank" rel="noopener">Wikipedia</a>` +
        (n2yoURL ? `<a class="info-link" href="${n2yoURL}" target="_blank" rel="noopener">N2YO live track</a>` : '') +
        (cstrURL ? `<a class="info-link" href="${cstrURL}" target="_blank" rel="noopener">CelesTrak TLE</a>` : '') +
      `</div>` +
    `</div>`;
}
// Refresh dynamic orbit values periodically while locked
setInterval(() => { if (chipLocked && selectedIdx >= 0) showObjectInfo(selectedIdx); }, 800);

// Stubs for a removed encyclopedia/banner feature, kept so existing callers
// (boot, hideBanner, notable events) stay harmless without dead references.
// Stub the encyclopedia/banner pieces so the rest of the code that references them is harmless
function renderNotableList() {}
function showBanner() {}
function hideBanner() {
  if (banner) banner.classList.remove('visible');
  unlockChip();
}
if (banner) {
  const btn = document.getElementById('banner-close');
  if (btn) btn.addEventListener('click', hideBanner);
}
function flyToNotable() {}
// Fly the camera to an object: propagate its current position, place the camera
// just outside it, still aimed at Earth's centre, and lock the chip onto it.
function flyToSat(idx) {
  if (idx < 0 || idx >= sats.length) return;
  const s = sats[idx];
  let target = new THREE.Vector3();
  if (s._isStorm) {
    target.copy(latLonToVec3(s._stormData.lat, s._stormData.lon, 1.022));
  } else {
    const pv = satellite.propagate(s.satrec, SIM.time);
    if (!pv.position) return;
    const gmst = satellite.gstime(SIM.time);
    const ecef = satellite.eciToEcf(pv.position, gmst);
    ecefToScene(ecef.x, ecef.y, ecef.z, target);
  }
  const dir = target.clone().normalize();
  const newPos = dir.multiplyScalar(target.length() + 0.9);
  // Always look at Earth's center so OrbitControls keeps rotating around the globe,
  // never the satellite. The sat sits in the foreground; user can drag to orbit.
  flyTo(newPos, new THREE.Vector3(0, 0, 0), 1400);
  lockChipTo(idx);
}

// flyTo with cancellation — only one animation runs at a time
// Ease the camera position and look-at target from current to given over dur ms
// with a cubic in/out curve, cancelling any in-flight move first.
let flyToFrameId = null;
function flyTo(targetPos, lookAt, dur = 1500) {
  if (flyToFrameId !== null) {
    cancelAnimationFrame(flyToFrameId);
    flyToFrameId = null;
  }
  const sp = camera.position.clone();
  const st = controls.target.clone();
  const tp = targetPos.clone();
  const tl = lookAt.clone();
  const t0 = performance.now();
  function step() {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    camera.position.lerpVectors(sp, tp, e);
    controls.target.lerpVectors(st, tl, e);
    controls.update();
    if (t < 1) flyToFrameId = requestAnimationFrame(step);
    else flyToFrameId = null;
  }
  flyToFrameId = requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let searchTimer = null;

// Search the catalog by name or NORAD id, rank stations and payloads first, and
// render clickable results that fly the camera to the chosen object.
function doSearch(query) {
  if (!searchResults) return;
  if (!query || !query.trim()) { searchResults.innerHTML = ''; return; }
  const q = query.toUpperCase().trim();
  const matches = [];
  for (let i = 0; i < sats.length && matches.length < 100; i++) {
    const s = sats[i];
    const nameU = s.name.toUpperCase();
    if (nameU.includes(q) || (s.noradId && String(s.noradId).includes(q))) {
      matches.push({ idx: i, name: s.name, cat: s.cat });
    }
  }
  if (matches.length === 0) {
    searchResults.innerHTML = `<div class="search-empty">no matches</div>`;
    return;
  }
  // Group: stations + notable first, then payloads, then everything else
  const rank = { station: 0, starlink: 2, payload: 1, rocket: 3, debris: 4, storm: 5 };
  matches.sort((a, b) => (rank[a.cat] ?? 9) - (rank[b.cat] ?? 9));
  searchResults.innerHTML = matches.map(m =>
    `<div class="search-result" data-idx="${m.idx}">
      <span class="sr-name">${escHtml(m.name)}</span>
      <span class="sr-cat">${escHtml(m.cat)}</span>
    </div>`).join('');
  searchResults.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10);
      if (!Number.isFinite(idx)) return;
      flyToSat(idx);
      if (IS_MOBILE) document.getElementById('leftpanel').classList.remove('open');
    });
  });
}
// Debounce typing before searching; Escape clears the box and results.
if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(searchInput.value), 150);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; searchResults.innerHTML = ''; }
  });
}
// Quick-tag buttons run a preset search query.
document.querySelectorAll('.qtag').forEach(b => {
  b.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = b.dataset.q;
    doSearch(b.dataset.q);
    searchInput.focus();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIME CONTROL
// ═══════════════════════════════════════════════════════════════════
const slider = document.getElementById('slider');
const sliderHandle = document.getElementById('slider-handle');
const tcTime = document.getElementById('tc-time');
const mobileTime = document.getElementById('mobile-time');
const btnPlay = document.getElementById('btn-play');
const btnNow = document.getElementById('btn-now');
const btnRewind = document.getElementById('btn-rewind');

// Format a Date as a UTC timestamp string.
function fmtTime(d) {
  const Y = d.getUTCFullYear();
  const M = String(d.getUTCMonth()+1).padStart(2,'0');
  const D = String(d.getUTCDate()).padStart(2,'0');
  const h = String(d.getUTCHours()).padStart(2,'0');
  const m = String(d.getUTCMinutes()).padStart(2,'0');
  const s = String(d.getUTCSeconds()).padStart(2,'0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}Z`;
}
// Format a signed time offset from NOW compactly (minutes, hours, or days).
function fmtDelta(ms) {
  if (Math.abs(ms) < 60000) return '+0m';
  const sign = ms > 0 ? '+' : '−';
  const s = Math.abs(ms) / 1000;
  if (s < 3600)  return `${sign}${(s/60)|0}m`;
  if (s < 86400) return `${sign}${(s/3600).toFixed(1)}h`;
  return `${sign}${(s/86400).toFixed(1)}d`;
}

// Move the time handle to pointer x and set SIM.time from the log-scale mapping.
let sliderDragging = false;
function setSliderPos(x) {
  const rect = slider.getBoundingClientRect();
  let frac = (x - rect.left) / rect.width;
  frac = Math.max(0, Math.min(1, frac));
  sliderHandle.style.left = (frac * 100) + '%';
  SIM.time = new Date(SIM.base.getTime() + fracToOffsetMs(frac));
}
// Time slider drag: pause playback and scrub SIM.time as the handle moves.
slider.addEventListener('pointerdown', (e) => {
  sliderDragging = true;
  SIM.playing = false;
  btnPlay.classList.remove('playing');
  btnPlay.innerHTML = '&#x25B6;';
  tcTime.classList.add('scrubbing');
  setSliderPos(e.clientX);
  slider.setPointerCapture(e.pointerId);
});
slider.addEventListener('pointermove', (e) => {
  if (!sliderDragging) return;
  setSliderPos(e.clientX);
});
slider.addEventListener('pointerup', (e) => {
  sliderDragging = false;
  try { slider.releasePointerCapture(e.pointerId); } catch (_) {}
});
// Transport buttons: play/pause, jump to NOW (recentre), and rewind one day.
btnPlay.addEventListener('click', () => {
  SIM.playing = !SIM.playing;
  btnPlay.classList.toggle('playing', SIM.playing);
  btnPlay.innerHTML = SIM.playing ? '&#x25B6;' : '&#x23F8;';
  tcTime.classList.toggle('scrubbing', !SIM.playing);
});
btnNow.addEventListener('click', () => {
  SIM.base = new Date();
  SIM.time = new Date(SIM.base);
  sliderHandle.style.left = '50%';
  SIM.playing = true;
  btnPlay.classList.add('playing');
  btnPlay.innerHTML = '&#x25B6;';
  tcTime.classList.remove('scrubbing');
});
btnRewind.addEventListener('click', () => {
  SIM.time = new Date(SIM.time.getTime() - 86400000);
  const offset = SIM.time.getTime() - SIM.base.getTime();
  const frac = offsetMsToFrac(offset);
  sliderHandle.style.left = (Math.max(0, Math.min(1, frac)) * 100) + '%';
});
// Continuous log-scale rate slider: SIM.speed = 0.1 × 10^(frac × 6)
//   frac=0    → 0.1×
//   frac=1/6  → 1× (real time)
//   frac=1/2  → 100×
//   frac=2/3  → 1000×
//   frac=1    → 100000×
const RATE_K = 6;
// Log-scale mapping between the rate slider fraction and SIM.speed, and back.
function rateFracToSpeed(frac) { return 0.1 * Math.pow(10, frac * RATE_K); }
function rateSpeedToFrac(speed) { return Math.log10(Math.max(speed, 0.001) / 0.1) / RATE_K; }
// Format the playback rate compactly (×, k×).
function fmtRate(s) {
  if (s < 1)     return s.toFixed(2) + '×';
  if (s < 10)    return s.toFixed(1) + '×';
  if (s < 1000)  return Math.round(s) + '×';
  if (s < 10000) return (s/1000).toFixed(1) + 'k×';
  return Math.round(s/1000) + 'k×';
}
const rateSlider = document.getElementById('rate-slider');
const rateHandle = document.getElementById('rate-slider-handle');
const rateValue  = document.getElementById('rate-value');
// Apply a rate-slider fraction: set SIM.speed, move the handle, update the label.
function applyRate(frac) {
  frac = Math.max(0, Math.min(1, frac));
  SIM.speed = rateFracToSpeed(frac);
  rateHandle.style.left = (frac * 100) + '%';
  rateValue.textContent = fmtRate(SIM.speed);
}
applyRate(rateSpeedToFrac(SIM.speed)); // init from default SIM.speed (3×)
// Rate slider drag: set playback speed from the pointer x.
let rateDragging = false;
function setRateFromX(x) {
  const rect = rateSlider.getBoundingClientRect();
  applyRate((x - rect.left) / rect.width);
}
rateSlider.addEventListener('pointerdown', (e) => {
  rateDragging = true;
  setRateFromX(e.clientX);
  rateSlider.setPointerCapture(e.pointerId);
});
rateSlider.addEventListener('pointermove', (e) => {
  if (rateDragging) setRateFromX(e.clientX);
});
rateSlider.addEventListener('pointerup', (e) => {
  rateDragging = false;
  try { rateSlider.releasePointerCapture(e.pointerId); } catch (_) {}
});

// ═══════════════════════════════════════════════════════════════════
// MOBILE MENU
// ═══════════════════════════════════════════════════════════════════
// Mobile menu buttons: open one side panel and close the other.
document.getElementById('menu-btn').addEventListener('click', () => {
  document.getElementById('leftpanel').classList.toggle('open');
  document.getElementById('rightpanel').classList.remove('open');
});
document.getElementById('menu-btn-right').addEventListener('click', () => {
  document.getElementById('rightpanel').classList.toggle('open');
  document.getElementById('leftpanel').classList.remove('open');
});

// ═══════════════════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════════════════
// Keep renderer, camera aspect, and the sprite pixel-ratio uniform in sync.
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (satMat) satMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
});

// ═══════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════
// Set the status readout text and colour class.
const statusEl = document.getElementById('stat-status');
function setStatus(text, cls) { statusEl.className = cls; statusEl.innerHTML = text; }

// Allocate scene resources before any data loads.
buildPointCloud();
initWindFlowField();
buildCityLabels();
buildSatLabelPool();
renderNotableList();

// Hard-coded fallback catalog (ISS, Tiangong, Hubble) used only when every
// network TLE source fails, so the globe is never empty.
function demoDataset() {
  const tles = [
`ISS (ZARYA)
1 25544U 98067A   26138.50000000  .00012345  00000+0  22345-3 0  9991
2 25544  51.6400 123.4567 0001234  12.3456 347.6543 15.49000000400001`,
`TIANGONG
1 48274U 21035A   26138.50000000  .00015432  00000+0  18765-3 0  9990
2 48274  41.4700 234.5678 0002345  34.5678 325.4321 15.62000000300002`,
`HUBBLE SPACE TELESCOPE
1 20580U 90037B   26138.50000000  .00001234  00000+0  12345-4 0  9993
2 20580  28.4700  45.6789 0002468 123.4567 236.5432 15.09000000400003`,
  ];
  const out = [];
  for (const block of tles) {
    const ls = block.split('\n');
    try {
      const satrec = satellite.twoline2satrec(ls[1], ls[2]);
      const noradId = parseInt(ls[1].substring(2,7).trim(), 10);
      out.push({ satrec, name: ls[0].trim(), cat: classify(ls[0]), noradId, notable: null });
    } catch (e) {}
  }
  return out;
}

// Persistent load-status panel
// Load-status panel: a persistent row per TLE group showing load/ok/fail/retry
// and the object count, mirrored into the #acq strip segments.
const loadRowsEl = document.getElementById('load-rows');
const loadDotEl  = document.getElementById('load-dot');
const loadRows = new Map();
function addLoadRow(group) {
  const row = document.createElement('div');
  row.className = 'load-row lr-in';
  row.style.setProperty('--i', loadRows.size);
  row.innerHTML =
    `<span class="lr-name">${group}</span>` +
    `<span class="lr-status loading">load</span>` +
    `<span class="lr-count">—</span>`;
  loadRowsEl.appendChild(row);
  loadRows.set(group, row);
  acqSegAdd(group); // strip mirror
}
function setLoadStatus(group, status, count) {
  const row = loadRows.get(group);
  if (!row) return;
  const st = row.querySelector('.lr-status');
  const cn = row.querySelector('.lr-count');
  st.className = 'lr-status ' + status;
  st.textContent = status;
  if (count !== undefined) cn.textContent = `+${count.toLocaleString()}`;
  retrigger(row, 'lr-flash');
  acqSegSet(group, status);
}

// Each group has three sources, tried in order:
//   1. data/<group>.txt next to this module. The tle-snapshot workflow
//      downloads it from CelesTrak every 2 h and puts it in the Pages deploy.
//   2. The same file on the live site, for local servers that have no data/.
//      GitHub Pages sends Access-Control-Allow-Origin: *.
//   3. CelesTrak, only when neither snapshot is available.
// So a visitor sends no request to CelesTrak while a snapshot exists.
const TLE_SNAPSHOT_DIRS = [...new Set([
  new URL('data/', import.meta.url).href,
  'https://davesgames.io/stella-nova/pages/leo-catalog/data/',
])];
function urlsForGroup(group) {
  return [...TLE_SNAPSHOT_DIRS.map(d => d + group + '.txt'), URL_GP(group)];
}

// Download one TLE group: try its URLs in order and parse the first that
// works. Returns the parsed records, or null after every URL failed. Touches
// no catalog state, so several groups can download at the same time.
async function fetchGroup(group) {
  if (!loadRows.has(group)) addLoadRow(group);
  let lastErr = null;
  for (const url of urlsForGroup(group)) {
    try {
      return parseTLE(await fetchTLE(url));
    } catch (e) {
      lastErr = e;
    }
  }
  setLoadStatus(group, 'fail', 0);
  splash(`${group}: ${lastErr ? lastErr.message : 'fail'}`, 'err');
  return null;
}

// Add one downloaded group to the catalog: add deduped objects up to
// PERF_CAP, refresh the buffers and counts, and mark the load row ok.
// The first group to merge keeps an object shared by two groups, so the
// merge order sets which forceCat wins and which group gets PERF_CAP room.
function mergeGroup(group, parsed, opts = {}) {
  if (!parsed) return -1;
  const forceCat = opts.forceCat || null;
  let n = 0;
  const first = sats.length;
  for (const p of parsed) {
    if (sats.length >= PERF_CAP) break;
    if (knownIds.has(p.noradId)) continue;
    if (forceCat) p.cat = forceCat;
    sats.push(p);
    knownIds.add(p.noradId);
    n++;
  }
  setLoadStatus(group, 'ok', n);
  splash(`${group} +${n.toLocaleString()}`, n ? 'ok' : '');
  rebuildAttributesFromSats();
  if (n > 0) {
    stampBirths(first, sats.length);
    pingGlobe(CAT_COLOR[sats[first].cat]);
  }
  updateCounts();
  return n;
}

// Both groups download at the same time. The merge order stays stations
// first, then 'active': 'active' also holds the station modules, and the
// first merge keeps them with the 'station' category and PERF_CAP room.
// The 'active' group holds every active payload, so it also holds the
// objects of the old per-constellation groups (starlink, oneweb, gnss, and
// so on). classify() sets the category from the name, so the group does not
// change it. Objects land on the globe as each group merges.
async function loadCatalog() {
  const groups = ['stations', 'active'];
  const downloads = groups.map(fetchGroup);
  mergeGroup('stations', await downloads[0], { forceCat: 'station' });
  rebuildStationLabels();
  rebuildStationTrails();
  mergeGroup('active', await downloads[1]);
}

// Intro camera: swing in from far out and to the side to the default view.
// Spherical coordinates about the origin, eased with a quintic ease-out.
// Any user drag cancels the move.
const INTRO_MS = 2600;
const introEnd = new THREE.Spherical().setFromVector3(camera.position);
const introStart = new THREE.Spherical(7.5, introEnd.phi + 0.35, introEnd.theta - 1.5);
const _introSph = new THREE.Spherical();
let introT0 = -1;
camera.position.setFromSpherical(introStart);
controls.addEventListener('start', () => { introT0 = -1; });
function stepIntroCamera(now) {
  if (introT0 < 0) return;
  const k = Math.min(1, (now - introT0) / INTRO_MS);
  const e = 1 - Math.pow(1 - k, 5);
  _introSph.set(
    introStart.radius + (introEnd.radius - introStart.radius) * e,
    introStart.phi    + (introEnd.phi    - introStart.phi)    * e,
    introStart.theta  + (introEnd.theta  - introStart.theta)  * e);
  camera.position.setFromSpherical(_introSph);
  if (k >= 1) introT0 = -1;
}

// Lift the title card: start the camera swing, power on the panels (CSS
// boot-in), show the #acq strip, and let every object that already arrived
// fall in.
function revealScene() {
  revealed = true;
  const sp = document.getElementById('splash');
  sp.classList.add('lift');
  setTimeout(() => sp.remove(), 1100);
  setTimeout(() => { splashGone = true; }, 700);
  document.body.classList.replace('boot-wait', 'boot-in');
  if (acqEl) acqEl.classList.add('on');
  if (REDUCED_MOTION) camera.position.setFromSpherical(introEnd);
  else introT0 = performance.now();
  stampBirths(0, sats.length, 2.2);
  pingGlobe(0x66e0ff);
}

// Close the strip: flash it green, then slide it away.
function finishAcquisition() {
  if (!acqEl) return;
  acqTitle.textContent = sats.length ? 'CATALOG NOMINAL' : 'CATALOG OFFLINE';
  acqEl.classList.add('done');
  pingGlobe(0x5fb872);
  setTimeout(() => acqEl.classList.add('off'), 2600);
}

// Boot sequence: the title card, the Earth map and the catalog start together.
// The scene is revealed when the title card and the Earth map are both done,
// so satellites land on a visible globe. Falls back to the demo dataset if
// every group fails.
async function boot() {
  const intro = playIntro();
  splash('init renderer', 'ok');
  const earth = buildEarthMap().then(
    () => earthRoot.remove(fallbackShell),
    () => splash('continents failed', 'err'));
  setStatus('FETCH<span class="blink">_</span>', 'status-warn');
  const catalog = loadCatalog();

  await Promise.all([intro, earth]);
  revealScene();
  await catalog;

  if (sats.length === 0) {
    splash('demo dataset', 'err');
    sats = demoDataset();
    for (const d of sats) knownIds.add(d.noradId);
    stampBirths(0, sats.length);
  }
  rebuildAttributesFromSats();
  updateCounts();
  rebuildStationLabels();
  rebuildStationTrails();
  loadStorms();
  if (loadDotEl) loadDotEl.style.animation = 'none';
  setStatus('NOMINAL', 'status-ok');
  await loadWeather();
  splash(`ready :: ${sats.length.toLocaleString()} obj`, 'ok');
  finishAcquisition();
  startXR();
}

// ═══════════════════════════════════════════════════════════════════
// XR  (xr.js wires lib/xr-view.js; this gives it the page state)
// ═══════════════════════════════════════════════════════════════════
// Attach VR and AR once the catalog is loaded. The headset section
// (#xr-panel) stays hidden unless the device supports a session.
function startXR() {
  const cbOf = sel => document.querySelector(sel + ' input[type=checkbox]');
  // silent: change the layer only, not the checkbox (a session-only change)
  const setOverlay = (k, on, silent) => {
    const cb = cbOf(`.filter-row[data-overlay="${k}"]`);
    if (!silent && cb) { if (cb.checked !== on) cb.click(); return; }
    OVERLAY[k] = on;
    if (k === 'cities' && !on) for (const c of cityElements) c.el.classList.remove('visible');
    if (k === 'satlabels' && !on) for (const sl of satLabelPool) { sl.el.classList.remove('visible'); sl.assignedIdx = -1; }
  };
  try {
    const xr = wireXR({
      renderer, scene, camera, controls,
      stars: scene.getObjectByName('stars'),
      satPoints: () => satPoints, sats: () => sats,
      SIM, OVERLAY, FILTER,
      el: { play: btnPlay, now: btnNow },
      setFilter: (cat, on) => { const cb = cbOf(`.filter-row[data-cat="${cat}"]`); if (cb && cb.checked !== on) cb.click(); },
      setOverlay,
      applySpeed: x => applyRate(rateSpeedToFrac(x)),
      fmtRate,
      setPropHz: hz => { propDt = hz > 0 ? 1000 / hz : PROP_DT; },
      getSel: () => ({ idx: selectedIdx, locked: chipLocked }),
      setSel: v => { selectedIdx = v.idx; chipLocked = v.locked; },
      refreshTrail: () => maybeRebuildTrail(),
    });
    // test hook (headless checks drive the session through it)
    window.__leoXR = { xr, SIM, scene, camera, controls, renderer, sats: () => sats, satPoints: () => satPoints };
  } catch (e) { console.warn('xr: not available', e); }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════
let lastFrame = performance.now();
const statTimePill = document.getElementById('stat-time-pill');

// The per-frame loop. Advances SIM.time, updates the sun, propagates objects at
// PROP_HZ, tracks the locked object with the camera, reprojects every HTML
// overlay, animates the wind field, renders, and updates the time readouts.
function animate(now) {
  requestAnimationFrame(animate);
  const dt = now - lastFrame;
  lastFrame = now;
  if (SIM.playing) {
    SIM.time = new Date(SIM.time.getTime() + dt * SIM.speed);
    if (!sliderDragging) {
      const offset = SIM.time.getTime() - SIM.base.getTime();
      const frac = offsetMsToFrac(offset);
      sliderHandle.style.left = (frac * 100) + '%';
    }
  }
  earthUniforms.uSunDir.value.copy(sunDirEcef(SIM.time));
  satMat.uniforms.uTime.value = now / 1000;
  updatePings(now / 1000);
  stepIntroCamera(now);
  controls.update();
  if (sats.length > 0 && now - lastPropTime >= propDt) {
    propagateAll();
    lastPropTime = now;
    maybeRebuildTrail();
    maybeRebuildStationTrails();
  }
  if (chipLocked && selectedIdx >= 0) {
    // Camera tracking: lock controls.target onto the satellite and shift
    // camera.position by the same delta so the user's orbit offset stays
    // constant while the satellite moves. User can still drag to rotate
    // around the sat.
    const sx = positions[selectedIdx*3+0];
    const sy = positions[selectedIdx*3+1];
    const sz = positions[selectedIdx*3+2];
    if (sx > -5000 && !flyToFrameId) {
      const dx = sx - controls.target.x;
      const dy = sy - controls.target.y;
      const dz = sz - controls.target.z;
      controls.target.set(sx, sy, sz);
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }
    updateChipPositionLocked();
    updateReticle();
  }
  // Update HTML overlays every frame so they keep up with sat motion at high SIM speeds
  updateCityLabels();
  updateStationLabels();
  updateSatLabels();
  // Wind flow particles
  updateWindFlow(dt);
  renderer.render(scene, camera);
  const t = fmtTime(SIM.time);
  const delta = SIM.time.getTime() - SIM.base.getTime();
  tcTime.innerHTML = `${t}<span class="delta">${fmtDelta(delta)}</span>`;
  mobileTime.textContent = t;
  if (statTimePill) statTimePill.textContent = t;
}

// Kick off data loading and start the render loop.
boot();
animate(performance.now());


// ═══════════════════════════════════════════════════════════════════
// SCREENSAVER  (window.snSaver, the shell hook in lib/screensaver.js)
// ═══════════════════════════════════════════════════════════════════
// enter() hides every DOM element except canvas#scene: panels, chip,
// reticle, splash and the city, station and sat labels. The clear colour
// becomes opaque black, because the canvas has alpha over the page
// background. The hook waits for boot (startXR sets __leoXR), then turns
// on a slow autoRotate and sets SIM.speed to 240x (calm 0) .. 60x (calm 1),
// so the orbits sweep and the terminator moves. A tour eases the camera
// with flyTo between four views (distance and latitude), about three per
// dwell, each move 7 s long. opts.seed sets the view order. Each move also
// puts one object in focus (its orbit drawn) and names it on the label plate
// with its TLE elements. The hook makes
// no network request: the catalog comes from the boot snapshot. No exit():
// the shell reloads the page on stop.
window.snSaver = { enter(opts) {
  const calm = Math.max(0, Math.min(1, opts && opts.calm != null ? +opts.calm : 0.7));
  const secs = Math.max(20, +(opts && opts.seconds) || 60);
  let seed = ((opts && opts.seed) | 0) >>> 0;
  const st = document.createElement('style');
  st.textContent = 'body>*:not(#scene){display:none!important}canvas#scene{cursor:none}';
  document.head.appendChild(st);
  renderer.setClearColor(0x000000, 1);
  OVERLAY.cities = false; OVERLAY.satlabels = false;
  const VIEWS = [            // radius (scene units, Earth = 1), polar angle
    { r: 3.4, phi: 1.42 }, { r: 2.3, phi: 0.95 }, { r: 2.7, phi: 2.05 }, { r: 4.6, phi: 0.55 },
  ];
  let vi = seed % VIEWS.length;
  // The plate (opts.label) names one object in focus and its TLE elements.
  // Each tour move picks the next class in FOCUS_CATS and a seeded object of
  // that class from the loaded snapshot. selectedIdx (with no chip lock)
  // makes propagateAll() draw the glyph larger and maybeRebuildTrail() draw
  // one orbit of it. The elements come from orbitalElements() and the
  // satrec: a = (μ/n²)^(1/3), T = 2π/n, apogee and perigee a(1 ± e) − R⊕.
  // The live lines come from satellite.propagate() at SIM.time.
  const label = opts && opts.labels !== false && typeof opts.label === 'function' ? opts.label : null;
  const FOCUS_CATS = ['station', 'payload', 'starlink', 'rocket', 'debris'];
  const CAT_NAME = { station: 'crewed station', payload: 'payload', starlink: 'Starlink', rocket: 'rocket body', debris: 'debris' };
  let fi = seed % FOCUS_CATS.length;
  const D = 180 / Math.PI;
  const pickFocus = () => {
    for (let k = 0; k < FOCUS_CATS.length; k++) {
      const cat = FOCUS_CATS[(fi + k) % FOCUS_CATS.length], pool = [];
      for (let i = 0; i < sats.length; i++) if (sats[i].cat === cat && sats[i].satrec && !sats[i]._isStorm) pool.push(i);
      if (!pool.length) continue;
      fi = (fi + k + 1) % FOCUS_CATS.length;
      seed = (seed * 1103515245 + 12345) >>> 0;
      // A station dwell shows the ISS first when the snapshot has it.
      const iss = cat === 'station' ? pool.find(i => sats[i].noradId === 25544) : undefined;
      return iss !== undefined ? iss : pool[seed % pool.length];
    }
    return -1;
  };
  const plate = () => {
    if (!label || selectedIdx < 0 || !sats[selectedIdx] || !sats[selectedIdx].satrec) return;
    const s = sats[selectedIdx], r = s.satrec, oe = orbitalElements(r);
    const a = oe.apogee / 2 + oe.perigee / 2 + EARTH_R_KM;
    const yr = r.epochyr < 57 ? 2000 + r.epochyr : 1900 + r.epochyr;
    const ep = new Date(Date.UTC(yr, 0, 1) + (r.epochdays - 1) * 86400000);
    const pv = satellite.propagate(r, SIM.time);
    let live = 'SGP4 has no solution at this time';
    if (pv.position) {
      const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(SIM.time));
      const v = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : NaN;
      live = 'now · alt ' + fmt(geo.height, 0) + ' km · lat ' + fmt(geo.latitude * D, 1) + '° · lon ' +
        fmt(geo.longitude * D, 1) + '° · |v| ' + fmt(v, 2) + ' km/s';
    }
    const nObj = sats.reduce((c, q) => c + (q.satrec ? 1 : 0), 0);
    label({
      title: s.name,
      sub: 'NORAD ' + s.noradId + ' · ' + CAT_NAME[s.cat] + ' · TLE epoch ' + ep.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      lines: [
        'a = ' + fmt(a, 0) + ' km · e = ' + r.ecco.toFixed(5) + ' · i = ' + fmt(oe.incDeg, 2) + '° · T = ' + fmt(oe.periodMin, 1) + ' min',
        'Ω = ' + fmt(r.nodeo * D, 1) + '° · ω = ' + fmt(r.argpo * D, 1) + '° · M₀ = ' + fmt(r.mo * D, 1) + '° · n = ' + fmt(1440 / oe.periodMin, 3) + ' rev/day',
        'apogee ' + fmt(oe.apogee, 0) + ' km · perigee ' + fmt(oe.perigee, 0) + ' km · μ = 398600.4418 km³/s² · R⊕ = 6378.137 km',
        live,
        'sim ' + SIM.time.toISOString().slice(0, 16).replace('T', ' ') + ' UTC · ' + fmtRate(SIM.speed) + ' · ' + nObj.toLocaleString() + ' objects',
      ],
      eq: ['n = 2π / T,   a = (μ / n²)^1/3',
           'r_apo, r_peri = a (1 ± e) − R⊕',
           'TLE → SGP4 → r, v (ECI) → ECEF at GMST'],
    });
  };
  const focus = () => {
    const idx = pickFocus();
    if (idx < 0) return;
    selectedIdx = idx;
    maybeRebuildTrail();
    plate();
  };
  const tour = () => {
    if (chipLocked) unlockChip();
    focus();
    vi = (vi + 1 + (seed = (seed * 1103515245 + 12345) >>> 0) % 2) % VIEWS.length;
    const sph = new THREE.Spherical().setFromVector3(camera.position);
    const to = new THREE.Vector3().setFromSpherical(new THREE.Spherical(VIEWS[vi].r, VIEWS[vi].phi, sph.theta + 0.6));
    flyTo(to, new THREE.Vector3(0, 0, 0), 7000);
  };
  return new Promise(res => {
    const t0 = performance.now();
    const ready = () => {
      if (!window.__leoXR && performance.now() - t0 < 20000) { setTimeout(ready, 250); return; }
      for (const c of cityElements) c.el.classList.remove('visible');
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8 * (1 - 0.6 * calm);
      SIM.playing = true;
      applyRate(rateSpeedToFrac(240 - 180 * calm));
      setInterval(tour, Math.max(12, secs / 3) * 1000);
      focus();
      if (label) setInterval(plate, 1000);
      res({ canvas, warmupMs: 2500 });
    };
    ready();
  });
} };
