// ============================================================================
//  LEO CATALOG  ·  view/labels.js — city, station and satellite HTML labels
// ----------------------------------------------------------------------------
//  Three label layers over the canvas, reprojected every frame by animate():
//    cities     a fixed list in four tiers; a tier shows once the camera is
//               inside its TIER_THRESHOLD distance, faded by distance and by
//               how far the city faces away
//    stations   one label per station-class object, always on, hidden only
//               when the Earth occludes it (ray/sphere test, unit globe)
//    sat labels a pool of SAT_LABEL_POOL_SIZE elements, zoom-gated (camera
//               inside 3 Earth radii). The pool goes to the nearest in-view
//               objects at most every 200 ms, 60 px apart; between those
//               reassignments the chosen labels only move.
//  Objects parked at HIDE (x < -5000) never get a label.
//
//  initLabels(ctx) gives the module the page state, as xr.js gets it:
//    camera, OVERLAY, FILTER, sats(), positions(), splashGone(),
//    flyToSat(idx), lockChipTo(idx)
//
//  grep -n targets: "export function initLabels", "const CITIES",
//  "export function buildCityLabels", "export function updateCityLabels",
//  "export function hideCityLabels", "export function rebuildStationLabels",
//  "export function updateStationLabels", "export function buildSatLabelPool",
//  "export function clearSatLabels", "export function updateSatLabels"
// ============================================================================
import * as THREE from 'three';
import { latLonToVec3 } from '../core/geo.js';
import { isISS } from '../core/tle.js';

let ctx = null;
export function initLabels(c) { ctx = c; }

// ── CITIES (tiered LOD) ──
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
export function hideCityLabels() { for (const c of cityElements) c.el.classList.remove('visible'); }
export function buildCityLabels() {
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
export function updateCityLabels() {
  const { camera, OVERLAY } = ctx, splashGone = ctx.splashGone();
  const camDist = camera.position.length();
  const cityModeEl = document.getElementById('stat-citymode');
  if (!OVERLAY.cities || !splashGone) {
    hideCityLabels();
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

// ── STATION LABELS (always visible — ISS, Tiangong, CSS) ──
// Station labels are always shown (not gated by zoom). Rebuild the label set
// from the current catalog; clicking one flies the camera to that station.
const stationLabels = [];
export function rebuildStationLabels() {
  const sats = ctx.sats();
  // Remove old labels
  for (const sl of stationLabels) sl.el.remove();
  stationLabels.length = 0;
  // Create one per station satellite
  for (let i = 0; i < sats.length; i++) {
    if (sats[i].cat !== 'station') continue;
    const el = document.createElement('div');
    el.className = 'station-label';
    const iss = isISS(sats[i]);
    if (iss) el.classList.add('iss');
    const short = sats[i].name.replace(/\s*\(.*\)\s*/g, '').trim();
    el.textContent = iss ? 'ISS · INTL SPACE STATION' : short;
    const idx = i;
    el.addEventListener('click', (e) => { e.stopPropagation(); ctx.flyToSat(idx); });
    document.body.appendChild(el);
    stationLabels.push({ idx, el, isISS: iss });
  }
}
// Reposition station labels each frame, hiding any parked object or one hidden
// behind the Earth (a ray/sphere occlusion test against the unit globe).
export function updateStationLabels() {
  const { camera } = ctx, splashGone = ctx.splashGone(), sats = ctx.sats(), positions = ctx.positions();
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

// ── SAT LABELS — LOD (zoom-based, for debris analysis) ──
// Pool of HTML labels reassigned each frame to the nearest sats in view.
// A fixed pool of reusable label elements. Each frame the pool is assigned to
// the nearest in-view satellites, so at most SAT_LABEL_POOL_SIZE show at once.
const SAT_LABEL_POOL_SIZE = 30;
const satLabelPool = [];
// Hide every pooled label and drop its assignment.
export function clearSatLabels() { for (const sl of satLabelPool) { sl.el.classList.remove('visible'); sl.assignedIdx = -1; } }
export function buildSatLabelPool() {
  for (let i = 0; i < SAT_LABEL_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'sat-label';
    document.body.appendChild(el);
    const entry = { el, assignedIdx: -1 };
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (entry.assignedIdx >= 0) {
        ctx.lockChipTo(entry.assignedIdx);
        ctx.flyToSat(entry.assignedIdx);
      }
    });
    satLabelPool.push(entry);
  }
}
// Zoom-gated satellite labelling for debris analysis. Reassignment (which sats
// get a label) runs at ~5 Hz to stop the text strobing; repositioning of the
// already-chosen labels runs every frame so they track motion.
const _proj = new THREE.Vector3();
let satLabelLastReassign = 0;
export function updateSatLabels() {
  const { camera, OVERLAY, FILTER } = ctx, splashGone = ctx.splashGone(), sats = ctx.sats(), positions = ctx.positions();
  const now = performance.now();
  // Reposition every frame (cheap projection); reassign which sats get labels
  // only at 5 Hz so the text doesn't strobe.
  const reassign = (now - satLabelLastReassign) > 200;
  if (!splashGone || !OVERLAY.satlabels) {
    clearSatLabels();
    return;
  }
  const camDist = camera.position.length();
  // Below this distance, start labeling; closer = more labels
  if (camDist > 3.0) {
    clearSatLabels();
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
