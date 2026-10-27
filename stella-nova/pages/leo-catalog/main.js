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
//  COORDINATE FRAMES   (core/geo.js)
//      ECEF   +X=lon0, +Y=lon90E, +Z=north      (satellite.js output)
//      scene  +X=lon0, +Y=north,  -Z=lon90E     (ecefToScene remaps)
//
//  MODULES   (pure parts, node-tested by tests.mjs)
//      core/format.js ....... time, delta and rate text; the slider scales
//      core/tle.js .......... classify, parseTLE, demo catalog, elements, merge
//      core/tle-fetch.js .... snapshot/CelesTrak fetch, cache, source order
//      core/wind.js ......... analytical wind model + RK2 streamline trace
//      core/info.js ......... curated descriptions, chip and panel HTML
//      core/geo.js .......... frame conversions, sun direction
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      shader load .......... "loadShaders"        fetch .glsl before build
//      constants ............ "// CONSTANTS"       categories, filters, SIM
//      splash / strip ....... "// SPLASH LOGGER"   title card, #acq strip, tweens
//      three.js base ........ "// THREE.JS BASE"   renderer, camera, controls
//      earth map ............ "function buildEarthMap"  canvas-drawn continents
//      satellites ........... "// SATELLITES"      point cloud + attributes
//      arrival .............. "function stampBirths"    fall-in times, ping rings
//      propagation .......... "function propagateAll"   SGP4 every frame
//      storms ............... "function loadStorms"  NOAA active cyclones
//      streamlines .......... "function buildStreamlineMesh"  GPU comet mesh
//      cities ............... "function buildCityLabels"  tiered LOD labels
//      station labels ....... "function rebuildStationLabels"  always-on labels
//      sat labels ........... "function updateSatLabels"  pooled LOD labels
//      orbit trails ......... "function buildTrailFor"  selected + station paths
//      filters / overlays ... "// FILTERS"         checkbox wiring
//      picking .............. "function pickAt"    hover/lock chip + reticle
//      object info .......... "function showObjectInfo"  right-hand panel
//      fly-to ............... "function flyTo"     animated camera moves
//      search ............... "function doSearch"  name/NORAD search
//      time control ......... "// TIME CONTROL"    scrub + rate sliders
//      tle groups ........... "function fetchGroup"  load rows, merge order
//      boot ................. "function boot"      load groups, then reveal
//      main loop ............ "function animate"   the per-frame update
//      xr ................... "function startXR"   VR/AR via xr.js + lib/xr-view.js
//      screensaver .......... "window.snSaver"     shell saver hook: slow orbit + tour
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadShaders } from '../../lib/shaders.js';
import { wireXR } from './xr.js';
import { fmt, fmtTime, fmtDelta, fmtRate, escHtml, fracToOffsetMs, offsetMsToFrac, rateFracToSpeed, rateSpeedToFrac } from './core/format.js';
import { EARTH_R_KM, parseTLE, demoDataset, orbitalElements, mergeParsed } from './core/tle.js';
import { fetchTLE, urlsForGroup } from './core/tle-fetch.js';
import { CYCLONES, traceStreamlines } from './core/wind.js';
import { chipBodyHTML, infoPanelHTML, INFO_EMPTY_HTML } from './core/info.js';
import { latLonToVec3, ecefToScene, sunDirEcef } from './core/geo.js';

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
// 1 scene unit = 1 Earth radius (core/geo.js). PERF_CAP bounds the object
// count so mobile stays interactive.
const IS_MOBILE    = window.matchMedia('(max-width: 880px)').matches;
const PERF_CAP     = IS_MOBILE ? 3500 : 12000;

// Object classes. CAT_INDEX maps each to the glyph id the satellite shader draws;
// CAT_COLOR and CAT_SIZE give per-class sprite colour and pixel size.
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

// The slider mappings (log scale, fine near NOW) live in core/format.js.

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
  let j = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP '+res.status);
      j = await res.json();
      setGauge('storms', 60 + i * 13);
      break;
    } catch (e) { setGauge('storms', 25 + (i+1) * 15); }
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
// STREAMLINE MESH — pre-traced through analytical field, GPU-animated
// ═══════════════════════════════════════════════════════════════════
const NUM_STREAMS  = IS_MOBILE ? 10000 : 30000;
const STREAM_STEPS = IS_MOBILE ? 24    : 40;
let   streamMesh = null;
let   streamMat  = null;

// Trace every streamline through the analytical wind field (core/wind.js)
// into one big buffer and build the LineSegments mesh with the streamline
// shader. Traced once; animation is purely a shader uniform.
function buildStreamlineMesh() {
  const { positions, arclens, streamIds, speeds, segPos } =
    traceStreamlines(NUM_STREAMS, STREAM_STEPS, f => setGauge('streams', f * 100));
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
// Populate the info chip for one object: storm fields for storms, live orbital
// readouts (altitude, lat/lon, velocity, elements) for satellites.
function fillChip(idx) {
  if (idx < 0 || idx >= sats.length) return false;
  const s = sats[idx];
  chip.querySelector('.ch-name').textContent = s.name;
  chip.querySelector('.ch-cat').textContent  = s.cat.toUpperCase();
  chip.querySelector('.ch-body').innerHTML = chipBodyHTML(s, SIM.time);
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
// TLE LOADER  (fetch, cache and source order: core/tle-fetch.js)
// ═══════════════════════════════════════════════════════════════════
// NORAD ids already in sats, so each dedupe check is O(1).
const knownIds = new Set();

// ═══════════════════════════════════════════════════════════════════
// OBJECT INFO PANEL  (replaces encyclopedia)
// ═══════════════════════════════════════════════════════════════════
// The info panel shows a curated description plus live orbital elements for the
// selected object; the banner is a legacy element kept only as a stub target.
const infoBody = document.getElementById('info-body');
const banner = document.getElementById('banner');

// Render the full info panel for an object: category, name, description, live
// elements, and external reference links. Empty prompt when nothing selected.
function showObjectInfo(idx) {
  if (!infoBody) return;
  if (idx < 0 || idx >= sats.length) {
    infoBody.innerHTML = INFO_EMPTY_HTML;
    return;
  }
  infoBody.innerHTML = infoPanelHTML(sats[idx], SIM.time);
}
// Refresh dynamic orbit values periodically while locked
setInterval(() => { if (chipLocked && selectedIdx >= 0) showObjectInfo(selectedIdx); }, 800);

// The legacy banner: its close button clears the selection.
function hideBanner() {
  if (banner) banner.classList.remove('visible');
  unlockChip();
}
if (banner) {
  const btn = document.getElementById('banner-close');
  if (btn) btn.addEventListener('click', hideBanner);
}
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


// Move the time handle to pointer x and set SIM.time from the log-scale mapping.
let sliderDragging = false;
function setSliderPos(x) {
  const rect = slider.getBoundingClientRect();
  let frac = (x - rect.left) / rect.width;
  frac = Math.max(0, Math.min(1, frac));
  sliderHandle.style.left = (frac * 100) + '%';
  SIM.time = new Date(SIM.base.getTime() + fracToOffsetMs(frac, SIM.range));
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
  const frac = offsetMsToFrac(offset, SIM.range);
  sliderHandle.style.left = (Math.max(0, Math.min(1, frac)) * 100) + '%';
});
// Continuous log-scale rate slider: SIM.speed = 0.1 × 10^(frac × 6), see core/format.js.
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
buildCityLabels();
buildSatLabelPool();

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
  const first = sats.length;
  const n = mergeParsed(sats, knownIds, parsed, PERF_CAP, opts.forceCat || null);
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
      const frac = offsetMsToFrac(offset, SIM.range);
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
    let live = 'SGP4 has no solution at this time.', alt = '—';
    if (pv.position) {
      const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(SIM.time));
      const v = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : NaN;
      alt = fmt(geo.height, 0) + ' km';
      live = 'Now: lat ' + fmt(geo.latitude * D, 1) + '°, lon ' + fmt(geo.longitude * D, 1) + '°, |v| ' + fmt(v, 2) + ' km/s';
    }
    const nObj = sats.reduce((c, q) => c + (q.satrec ? 1 : 0), 0);
    // params, new TeX for the element formulas (the page has no TeX or math
    // colour classes, so no rules), and the plain eq fallback.
    label({
      title: s.name,
      sub: 'NORAD ' + s.noradId + ', ' + CAT_NAME[s.cat] + ', TLE epoch ' + ep.toISOString().slice(0, 10),
      params: [
        { sym: 'h', name: 'altitude now', value: alt },
        { sym: 'a', name: 'semi-major axis', value: fmt(a, 0) + ' km' },
        { sym: 'e', name: 'eccentricity', value: r.ecco.toFixed(5) },
        { sym: 'i', name: 'inclination', value: fmt(oe.incDeg, 2) + '°' },
        { sym: 'T', name: 'period', value: fmt(oe.periodMin, 1) + ' min' },
      ],
      lines: [live,
        'Sim ' + SIM.time.toISOString().slice(0, 16).replace('T', ' ') + ' UTC, ' + fmtRate(SIM.speed) + ', ' + nObj.toLocaleString() + ' objects'],
      tex: ['n = \\frac{2\\pi}{T}, \\qquad a = \\left(\\frac{\\mu}{n^2}\\right)^{1/3}',
        'r_{\\text{apo}},\\ r_{\\text{peri}} = a\\,(1 \\pm e) - R_\\oplus',
        '\\text{TLE} \\xrightarrow{\\text{SGP4}} (\\vec r, \\vec v)_{\\text{ECI}} \\to \\text{ECEF at GMST}'],
      eq: ['n = 2π / T,   a = (μ / n²)^1/3',
           'r_apo, r_peri = a (1 ± e) − R⊕',
           'TLE → SGP4 → r, v (ECI) → ECEF at GMST'],
      anchor: orbitAnchor,
    });
  };
  // The orbit in focus on screen, for the shell's label plate. Earth (radius
  // 1 in scene units) sits at the origin, and the orbit lies inside the
  // sphere of radius a (1 + e) / R_earth. The centre is the projected
  // origin; the radius is that sphere's silhouette, fpx tan(asin(R / d)),
  // with d the camera distance. The key point is the object itself, from
  // the positions buffer that propagateAll() fills (satPoints space). When
  // the camera is inside that sphere, the anchor is the object alone.
  const _ov = new THREE.Vector3();
  const orbitAnchor = () => {
    if (selectedIdx < 0 || !sats[selectedIdx] || !sats[selectedIdx].satrec) return null;
    const rr = sats[selectedIdx].satrec, R = Math.pow(398600.4418 / Math.pow(rr.no / 60, 2), 1 / 3) * (1 + rr.ecco) / EARTH_R_KM;
    const b = renderer.domElement.getBoundingClientRect(), d = camera.position.length();
    const P = v => { v.project(camera); return v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1 ? null : { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height }; };
    const pts = [];
    const k = selectedIdx * 3;
    if (positions && Math.abs(positions[k]) < 1e3) {
      satPoints.updateMatrixWorld();
      const q = P(_ov.set(positions[k], positions[k + 1], positions[k + 2]).applyMatrix4(satPoints.matrixWorld));
      if (q) pts.push(q);
    }
    // A high orbit (GEO, Molniya) holds the camera: anchor on the object.
    if (d <= R * 1.02) return pts.length ? { x: pts[0].x, y: pts[0].y, r: 14, pts } : null;
    const c = P(_ov.set(0, 0, 0));
    if (!c) return null;
    const fpx = (b.height / 2) / Math.tan(camera.fov * Math.PI / 360);
    return { x: c.x, y: c.y, r: fpx * Math.tan(Math.asin(R / d)), pts: pts.length ? pts : [c] };
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
