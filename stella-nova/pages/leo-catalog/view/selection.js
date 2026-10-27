// ============================================================================
//  LEO CATALOG  ·  view/selection.js — picking, chip, reticle, info, fly-to
// ----------------------------------------------------------------------------
//  The selection state and everything that shows it:
//    pick      raycast the point cloud under the pointer; the hit threshold
//              scales with camera distance and widens on a first miss
//    chip      #chip floats by the pointer on hover (picks at most every
//              50 ms) and locks on a click that is not a drag (> 8 px).
//              Locked, it follows the object (desktop) and refreshes at 2 Hz
//    reticle   #target-reticle over the locked object
//    panel     #info-body: description, live elements, links (core/info.js)
//    fly-to    a cubic in/out camera move; one at a time. flyToSat aims at
//              the object from 0.9 Earth radii outside it, looking at the
//              Earth's centre, and locks the chip
//
//  initSelection(ctx) wires the DOM: ctx = { camera, controls, canvas, SIM,
//  sats(), isMobile }. selectedIdx and chipLocked are live exports.
//
//  grep -n targets: "export let selectedIdx", "export function setSelection",
//  "function pickAt", "function fillChip", "function showHoverChip",
//  "export function lockChipTo", "export function unlockChip",
//  "export function updateChipPositionLocked", "export function updateReticle",
//  "function showObjectInfo", "function hideBanner", "export function flyToSat",
//  "export function flyTo", "export function initSelection"
// ============================================================================
import * as THREE from 'three';
import { chipBodyHTML, infoPanelHTML, INFO_EMPTY_HTML } from '../core/info.js';
import { latLonToVec3, ecefToScene } from '../core/geo.js';
import { positions, satPoints } from './sat-cloud.js';
import { maybeRebuildTrail, toggleChipTrail } from './trails.js';

let ctx = null;
let camera = null, controls = null, canvas = null, SIM = null, IS_MOBILE = false;

// ── PICKING (hover chip / lock chip / target reticle) ──
// _cv is a scratch vector for the chip and reticle projections.
const _cv = new THREE.Vector3();
// Picking state: selectedIdx is the locked object, chipLocked whether the info
// chip is pinned. Both are live exports; other modules change them only with
// setSelection. The raycaster hit-tests the point cloud; the chip and reticle
// are the HTML overlays that follow it.
export let selectedIdx = -1;
export let chipLocked  = false;
export function setSelection(idx, locked) { selectedIdx = idx; chipLocked = locked; }
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
  const sats = ctx.sats();
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
export function lockChipTo(idx) {
  if (idx < 0) { unlockChip(); return; }
  selectedIdx = idx;
  if (!fillChip(idx)) { chip.style.display = 'none'; return; }
  chip.style.display = 'block';
  chip.classList.add('locked');
  chipLocked = true;
  chipHint.textContent = 'locked';
  chipClose.style.display = 'inline';
  reticleLabel.textContent = 'LOCKED · ' + ctx.sats()[idx].cat.toUpperCase();
  maybeRebuildTrail();
  showObjectInfo(idx);
}
// Clear the selection, hide the chip/reticle/trail, and ease the camera back
// to looking at Earth's centre.
export function unlockChip() {
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

// Keep the locked chip beside the selected object as it moves (desktop only).
export function updateChipPositionLocked() {
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
export function updateReticle() {
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

// ── OBJECT INFO PANEL  (replaces encyclopedia) ──
// The info panel shows a curated description plus live orbital elements for the
// selected object; the banner is a legacy element kept only as a stub target.
const infoBody = document.getElementById('info-body');
const banner = document.getElementById('banner');

// Render the full info panel for an object: category, name, description, live
// elements, and external reference links. Empty prompt when nothing selected.
function showObjectInfo(idx) {
  if (!infoBody) return;
  const sats = ctx.sats();
  if (idx < 0 || idx >= sats.length) {
    infoBody.innerHTML = INFO_EMPTY_HTML;
    return;
  }
  infoBody.innerHTML = infoPanelHTML(sats[idx], SIM.time);
}

// The legacy banner: its close button clears the selection.
function hideBanner() {
  if (banner) banner.classList.remove('visible');
  unlockChip();
}
// Fly the camera to an object: propagate its current position, place the camera
// just outside it, still aimed at Earth's centre, and lock the chip onto it.
export function flyToSat(idx) {
  const sats = ctx.sats();
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
export const isFlying = () => flyToFrameId !== null;
export function flyTo(targetPos, lookAt, dur = 1500) {
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

// Wire the chip, the canvas pointer and the banner, and start the chip and
// panel refresh timers (500 ms and 800 ms while locked).
export function initSelection(c) {
  ctx = c;
  ({ camera, controls, canvas, SIM } = c);
  IS_MOBILE = c.isMobile;
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
    showHoverChip(e.clientX, e.clientY, pickAt(e.clientX, e.clientY));
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
  setInterval(() => { if (chipLocked && selectedIdx >= 0) fillChip(selectedIdx); }, 500);
  // Refresh dynamic orbit values periodically while locked
  setInterval(() => { if (chipLocked && selectedIdx >= 0) showObjectInfo(selectedIdx); }, 800);
  if (banner) {
    const btn = document.getElementById('banner-close');
    if (btn) btn.addEventListener('click', hideBanner);
  }
}
