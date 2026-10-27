// ============================================================================
//  LEO CATALOG  ·  view/weather.js — NOAA storm fetch and the wind layer
// ----------------------------------------------------------------------------
//  Two weather parts, both started by boot:
//    fetchStorms   tries each STORM_URLS source (core/storms.js) and drives
//                  the STM gauge and the boot log. It returns the parsed
//                  storms, or null when every source fails, the parse fails
//                  or no storm is active. main.js adds them to the catalog.
//    wind layer    the analytical wind model (core/wind.js) traced once into
//                  one LineSegments mesh in earthRoot (shaders/streamline.*);
//                  per frame only the flowTime uniform moves. The mesh shows
//                  while OVERLAY.weather is on.
//
//  initWeather(ctx) gives the module the page state:
//    earthRoot, SH (shader sources), OVERLAY, isMobile
//
//  grep -n targets: "export async function fetchStorms",
//  "export function initWeather", "function buildStreamlineMesh",
//  "export async function loadWeather", "export function updateWindFlow",
//  "export function setWeatherVisible"
// ============================================================================
import * as THREE from 'three';
import { STORM_URLS, parseStorms } from '../core/storms.js';
import { CYCLONES, traceStreamlines } from '../core/wind.js';
import { splash, setGauge } from './boot-ui.js';

// Fetch active tropical cyclones from NOAA (trying direct then CORS proxies).
export async function fetchStorms() {
  setGauge('storms', 25);
  let j = null;
  for (let i = 0; i < STORM_URLS.length; i++) {
    try {
      const res = await fetch(STORM_URLS[i], { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP '+res.status);
      j = await res.json();
      setGauge('storms', 60 + i * 13);
      break;
    } catch (e) { setGauge('storms', 25 + (i+1) * 15); }
  }
  if (!j) {
    setGauge('storms', 100, { fail: true });
    splash('noaa storms: blocked', 'err');
    return null;
  }
  let storms;
  try { storms = parseStorms(j); } catch (e) { splash('noaa storms: parse fail', 'err'); return null; }
  setGauge('storms', 100, { done: true });
  if (storms.length === 0) {
    splash('noaa storms: 0 active (off-season)', 'ok');
    return null;
  }
  splash(`storms ${storms.length}`, 'ok');
  return storms;
}

let ctx = null;
let NUM_STREAMS = 0, STREAM_STEPS = 0;
let streamMesh = null;
let streamMat  = null;
export function initWeather(c) {
  ctx = c;
  NUM_STREAMS  = c.isMobile ? 10000 : 30000;
  STREAM_STEPS = c.isMobile ? 24    : 40;
}

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
    vertexShader: ctx.SH['shaders/streamline.vert.glsl'],
    fragmentShader: ctx.SH['shaders/streamline.frag.glsl'],
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  streamMesh = new THREE.LineSegments(geom, streamMat);
  streamMesh.frustumCulled = false;
  streamMesh.visible = !!ctx.OVERLAY.weather;
  ctx.earthRoot.add(streamMesh);
}

// Boot the weather layer: advance its gauges, then trace the streamline mesh.
export async function loadWeather() {
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
export function updateWindFlow(dt) {
  if (!streamMat || !streamMesh) return;
  streamMesh.visible = !!ctx.OVERLAY.weather;
  if (!ctx.OVERLAY.weather) return;
  streamMat.uniforms.flowTime.value += dt * 0.000025;
}

// The weather checkbox: show or hide the mesh at once (once it exists).
export function setWeatherVisible(on) { if (streamMesh) streamMesh.visible = on; }
