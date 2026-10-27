// ============================================================================
//  LEO CATALOG  ·  view/sat-cloud.js — the catalog point cloud and SGP4 pass
// ----------------------------------------------------------------------------
//  One THREE.Points of N glyphs (shaders/satellite.*.glsl). Per object:
//    position  scene xyz, written by propagateAll (SGP4 -> ECEF -> scene);
//              HIDE when filtered out or when SGP4 has no solution
//    aColor, aGlyph   from the class (CAT_COLOR, CAT_INDEX), on each load
//    aSize, aAlpha    from the class, the selection and the hover/lock
//                     highlight (others drop to alpha 0.08)
//    aBirth    the fall-in landing time (stampBirths); the shader animates it
//  Storms sit at their lat/lon on a 1.022 shell and pulse in size.
//  Ping rings: four camera-facing rings that grow from the rim and fade, one
//  per landed TLE group. Nothing stamps or pings before markRevealed().
//
//  initCloud(ctx) adds the ping rings and keeps the page state:
//    scene, renderer, camera, SH, FILTER, SIM, sats(), selectedIdx(),
//    highlightCat()
//
//  grep -n targets: "export const CAT_INDEX", "export const CAT_COLOR",
//  "export const CAT_SIZE", "export function initCloud",
//  "export function buildPointCloud", "export function rebuildAttributesFromSats",
//  "export function stampBirths", "export function pingGlobe",
//  "export function updatePings", "export function propagateAll"
// ============================================================================
import * as THREE from 'three';
import { latLonToVec3, ecefToScene } from '../core/geo.js';

// Object classes. CAT_INDEX maps each to the glyph id the satellite shader draws;
// CAT_COLOR and CAT_SIZE give per-class sprite colour and pixel size.
export const CAT_INDEX  = { payload:0, station:1, rocket:2, debris:3, storm:4, starlink:5 };
export const CAT_COLOR  = {
  starlink: new THREE.Color(0x4fdc7a),  // bright green
  payload:  new THREE.Color(0x5ad7ff),  // cyan
  station:  new THREE.Color(0xf5f5f0),  // off-white
  rocket:   new THREE.Color(0xffb030),  // amber
  debris:   new THREE.Color(0xff5a5a),  // red
  storm:    new THREE.Color(0x5ad7ff),  // cyan ring
};
export const CAT_SIZE = {
  starlink: 9.0,
  payload:  11.0,
  station:  18.0,
  rocket:   11.0,
  debris:   7.0,
  storm:    22.0,
};

let ctx = null;
let revealed = false;
export function initCloud(c) { ctx = c; addPings(c.scene); }
// The globe is visible: from now on new objects fall in and groups ping.
export function markRevealed() { revealed = true; }

// The typed arrays are the GPU attribute buffers, one entry per object,
// shared by index with the catalog (ctx.sats()). HIDE parks an off-screen or
// filtered object far away instead of removing it. positions, satMat and
// satPoints are live exports: main.js, the labels and the saver read them.
export let positions = null, satMat = null, satPoints = null;
let sizesAttr, colorsAttr, alphasAttr, glyphAttr, birthAttr, satGeo;
export const HIDE = -10000;

// Allocate the fixed-size point cloud and its dynamic attribute buffers once,
// then build the THREE.Points with the satellite shader. Frustum culling is
// off because positions are updated on the GPU-facing buffer every frame.
export function buildPointCloud(N) {
  const { renderer, SH, scene } = ctx;
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
export function rebuildAttributesFromSats() {
  const sats = ctx.sats();
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
export function stampBirths(from, to, spread = 1.8) {
  if (!revealed) return;
  const now = performance.now() / 1000;
  for (let i = from; i < to; i++) birthAttr[i] = now + Math.random() * spread;
  satGeo.attributes.aBirth.needsUpdate = true;
}

// Ping rings: camera-facing rings that grow out from the globe rim and fade,
// one per landed TLE group. A small pool is reused; pingGlobe takes the next.
const PING_S = 1.6;
const pings = [];
let pingNext = 0;
function addPings(scene) {
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.012, 160),
      new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false;
    scene.add(m);
    pings.push({ mesh: m, t0: -1 });
  }
}
export function pingGlobe(color = 0x66e0ff) {
  if (!revealed) return;
  const p = pings[pingNext++ % pings.length];
  p.mesh.material.color.set(color);
  p.t0 = performance.now() / 1000;
  p.mesh.visible = true;
}
export function updatePings(tSec) {
  const camera = ctx.camera;
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

// _tmp avoids per-object allocation in the SGP4 pass.
const _tmp = new THREE.Vector3();
// Propagate every object to SIM.time and write its scene position, size, and
// alpha into the attribute buffers. Filtered objects are parked at HIDE; storms
// sit at a fixed lat/lon and pulse; everything else runs through SGP4 to ECEF.
export function propagateAll() {
  const { FILTER } = ctx, sats = ctx.sats(), selectedIdx = ctx.selectedIdx(), highlightCat = ctx.highlightCat();
  const date = ctx.SIM.time;
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
