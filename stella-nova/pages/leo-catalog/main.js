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
//        │    ├─ streamMesh     wind streamlines (view/weather.js, GPU-animated)
//        │    │                              source: shaders/streamline.*.glsl
//        │    └─ trailLine + stationTrails   orbit paths (view/trails.js)
//        ├─ satPoints           one THREE.Points, PERF_CAP glyphs (view/sat-cloud.js)
//        │                                   source: shaders/satellite.*.glsl
//        ├─ ping rings          four camera-facing arrival rings
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
//  CORE MODULES   (pure parts, node-tested by tests.mjs)
//      core/format.js ....... time, delta and rate text; the slider scales
//      core/tle.js .......... classify, parseTLE, demo catalog, elements, merge
//      core/tle-fetch.js .... snapshot/CelesTrak fetch, cache, source order
//      core/wind.js ......... analytical wind model + RK2 streamline trace
//      core/info.js ......... curated descriptions, chip and panel HTML
//      core/geo.js .......... frame conversions, sun direction
//      core/search.js ....... name/NORAD search, rank order, result HTML
//      core/storms.js ....... NOAA feed URLs, storm parse, storm records
//
//  VIEW MODULES   (DOM and three.js parts; main.js passes them state)
//      view/boot-ui.js ...... splash log, #acq strip, load rows, status, tweens
//      view/sat-cloud.js .... point cloud buffers, fall-in, pings, SGP4 pass
//      view/earth.js ........ Earth map texture, placeholder, atmosphere, stars
//      view/labels.js ....... city, station and sat HTML labels (per frame)
//      view/trails.js ....... orbit loops: the selected object and the stations
//      view/saver.js ........ window.snSaver: slow orbit, tour and label plate
//      view/time-control.js . scrub slider, transport buttons, rate, readouts
//      view/search.js ....... search box, quick tags, result clicks
//      view/weather.js ...... NOAA storm fetch; wind streamline mesh
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      shader load .......... "loadShaders"        fetch .glsl before build
//      constants ............ "// CONSTANTS"       categories, filters, SIM
//      three.js base ........ "// THREE.JS BASE"   renderer, camera, controls
//      satellites ........... "initCloud"         page state for view/sat-cloud.js
//      propagation rate ..... "PROP_HZ"           SGP4 pass rate, XR override
//      storms ............... "function loadStorms"  NOAA cyclones into the catalog
//      labels ............... "initLabels"        page state for view/labels.js
//      orbit trails ......... "initTrails"        page state for view/trails.js
//      filters / overlays ... "// FILTERS"         checkbox wiring
//      picking .............. "function pickAt"    hover/lock chip + reticle
//      object info .......... "function showObjectInfo"  right-hand panel
//      fly-to ............... "function flyTo"     animated camera moves
//      search ............... "initSearch"        wires view/search.js
//      time control ......... "initTimeControl"   wires view/time-control.js
//      tle groups ........... "function fetchGroup"  load rows, merge order
//      boot ................. "function boot"      load groups, then reveal
//      main loop ............ "function animate"   the per-frame update
//      xr ................... "function startXR"   VR/AR via xr.js + lib/xr-view.js
//      screensaver .......... "installSaver"      page state for view/saver.js
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadShaders } from '../../lib/shaders.js';
import { wireXR } from './xr.js';
import { fmtRate, rateSpeedToFrac } from './core/format.js';
import { parseTLE, demoDataset, mergeParsed } from './core/tle.js';
import { fetchTLE, urlsForGroup } from './core/tle-fetch.js';
import { stormRecord } from './core/storms.js';
import { chipBodyHTML, infoPanelHTML, INFO_EMPTY_HTML } from './core/info.js';
import { latLonToVec3, ecefToScene, sunDirEcef } from './core/geo.js';
import { earthUniforms, buildEarthMap, addBackdrop } from './view/earth.js';
import { installSaver } from './view/saver.js';
import { CAT_COLOR, initCloud, positions, satMat, satPoints, buildPointCloud, rebuildAttributesFromSats,
         stampBirths, markRevealed, pingGlobe, updatePings, propagateAll } from './view/sat-cloud.js';
import { fetchStorms, initWeather, loadWeather, updateWindFlow, setWeatherVisible } from './view/weather.js';
import { initSearch } from './view/search.js';
import { initTimeControl, applyRate, advanceClock, showTime, btnPlay, btnNow } from './view/time-control.js';
import { initTrails, maybeRebuildTrail, toggleChipTrail, rebuildStationTrails, maybeRebuildStationTrails } from './view/trails.js';
import { initLabels, buildCityLabels, updateCityLabels, hideCityLabels, rebuildStationLabels, updateStationLabels,
         buildSatLabelPool, updateSatLabels, clearSatLabels } from './view/labels.js';
import { REDUCED_MOTION, splash, tweenNumber, retrigger, playIntro, acqCountEl, showStrip, finishAcquisition,
         setStatus, addLoadRow, hasLoadRow, setLoadStatus, stopLoadDot } from './view/boot-ui.js';

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

// The Earth sphere, its placeholder shell, the atmosphere and the stars
// (view/earth.js). buildEarthMap() runs at boot and drops the shell.
const fallbackShell = addBackdrop(scene, earthRoot, SH, IS_MOBILE);


// ═══════════════════════════════════════════════════════════════════
// SATELLITES  (point cloud, arrival, pings and SGP4: view/sat-cloud.js)
// ═══════════════════════════════════════════════════════════════════
// sats is the master catalog array, shared by index with the point cloud's
// GPU attribute buffers.
let sats = [];
initCloud({
  scene, renderer, camera, SH, FILTER, SIM,
  sats: () => sats, selectedIdx: () => selectedIdx, highlightCat: () => highlightCat,
});

// ═══════════════════════════════════════════════════════════════════
// PROPAGATION
// ═══════════════════════════════════════════════════════════════════
// Propagation (propagateAll, view/sat-cloud.js) runs at PROP_HZ, not every
// frame, to cap SGP4 cost.
let lastPropTime = 0;
const PROP_HZ = IS_MOBILE ? 12 : 20;
const PROP_DT = 1000 / PROP_HZ;
// The propagation interval in use. xr.js lowers it in a headset session.
let propDt = PROP_DT;

// ═══════════════════════════════════════════════════════════════════
// STORMS (NOAA) + WIND LAYER  (view/weather.js)
// ═══════════════════════════════════════════════════════════════════
// Add each active NOAA cyclone as a storm-class record parked at its lat/lon.
async function loadStorms() {
  const storms = await fetchStorms();
  if (!storms) return;
  try {
    const first = sats.length;
    for (const st of storms) {
      if (sats.length >= PERF_CAP) break;
      sats.push(stormRecord(st));
    }
    rebuildAttributesFromSats();
    stampBirths(first, sats.length, 0.6);
    updateCounts();
  } catch (e) {
    splash('noaa storms: parse fail', 'err');
  }
}
initWeather({ earthRoot, SH, OVERLAY, isMobile: IS_MOBILE });

// ═══════════════════════════════════════════════════════════════════
// LABELS  (city, station and sat labels: view/labels.js)
// ═══════════════════════════════════════════════════════════════════
initLabels({
  camera, OVERLAY, FILTER,
  sats: () => sats, positions: () => positions, splashGone: () => splashGone,
  flyToSat: idx => flyToSat(idx), lockChipTo: idx => lockChipTo(idx),
});

// ═══════════════════════════════════════════════════════════════════
// ORBIT TRAILS  (selected object and stations: view/trails.js)
// ═══════════════════════════════════════════════════════════════════
initTrails({ earthRoot, SIM, OVERLAY, sats: () => sats, selectedIdx: () => selectedIdx });

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
    if (k === 'weather') setWeatherVisible(cb.checked);
    if (k === 'cities' && !cb.checked) hideCityLabels();
    if (k === 'trails') maybeRebuildTrail();
    if (k === 'satlabels' && !cb.checked) clearSatLabels();
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
// _cv is a scratch vector for the chip and reticle projections.
const _cv = new THREE.Vector3();
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
  chipTrailBtn.classList.toggle('active', toggleChipTrail());
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
// SEARCH  (search box and quick tags: view/search.js)
// ═══════════════════════════════════════════════════════════════════
initSearch({ sats: () => sats, flyToSat: idx => flyToSat(idx), isMobile: IS_MOBILE });

// ═══════════════════════════════════════════════════════════════════
// TIME CONTROL  (scrub, transport and rate: view/time-control.js)
// ═══════════════════════════════════════════════════════════════════
initTimeControl(SIM);

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

// Allocate scene resources before any data loads.
buildPointCloud(PERF_CAP);
buildCityLabels();
buildSatLabelPool();


// Download one TLE group: try its URLs in order and parse the first that
// works. Returns the parsed records, or null after every URL failed. Touches
// no catalog state, so several groups can download at the same time.
async function fetchGroup(group) {
  if (!hasLoadRow(group)) addLoadRow(group);
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
  markRevealed();
  const sp = document.getElementById('splash');
  sp.classList.add('lift');
  setTimeout(() => sp.remove(), 1100);
  setTimeout(() => { splashGone = true; }, 700);
  document.body.classList.replace('boot-wait', 'boot-in');
  showStrip();
  if (REDUCED_MOTION) camera.position.setFromSpherical(introEnd);
  else introT0 = performance.now();
  stampBirths(0, sats.length, 2.2);
  pingGlobe(0x66e0ff);
}


// Boot sequence: the title card, the Earth map and the catalog start together.
// The scene is revealed when the title card and the Earth map are both done,
// so satellites land on a visible globe. Falls back to the demo dataset if
// every group fails.
async function boot() {
  const intro = playIntro();
  splash('init renderer', 'ok');
  const earth = buildEarthMap(renderer, earthRoot, SH, IS_MOBILE).then(
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
  stopLoadDot();
  setStatus('NOMINAL', 'status-ok');
  await loadWeather();
  splash(`ready :: ${sats.length.toLocaleString()} obj`, 'ok');
  finishAcquisition(sats.length, () => pingGlobe(0x5fb872));
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
    if (k === 'cities' && !on) hideCityLabels();
    if (k === 'satlabels' && !on) clearSatLabels();
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

// The per-frame loop. Advances SIM.time, updates the sun, propagates objects at
// PROP_HZ, tracks the locked object with the camera, reprojects every HTML
// overlay, animates the wind field, renders, and updates the time readouts.
function animate(now) {
  requestAnimationFrame(animate);
  const dt = now - lastFrame;
  lastFrame = now;
  advanceClock(dt);
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
  showTime();
}

// Kick off data loading and start the render loop.
boot();
animate(performance.now());


// ═══════════════════════════════════════════════════════════════════
// SCREENSAVER  (window.snSaver: view/saver.js)
// ═══════════════════════════════════════════════════════════════════
installSaver({
  renderer, camera, controls, canvas, OVERLAY, SIM,
  sats: () => sats, positions: () => positions, satPoints: () => satPoints,
  selectedIdx: () => selectedIdx, select: idx => { selectedIdx = idx; },
  chipLocked: () => chipLocked, unlockChip: () => unlockChip(),
  flyTo: (p, l, ms) => flyTo(p, l, ms), applyRate: f => applyRate(f),
});
