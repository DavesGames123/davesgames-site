// ============================================================================
//  RESONANCE 3D  ·  xr.js — the knot in VR and AR
// ----------------------------------------------------------------------------
//  This module wires lib/xr-view.js to the page. The page loads three r128
//  as a global script (no importmap), so the lib gets opts.THREE. main.js
//  gives the objects in window.__res3d; the controls are page buttons, so
//  the panel rows click them.
//
//  THE MODEL  the whole scene: the knot inside the cube of half-size S,
//             the axes and their labels (out to 1.3 S).
//  SIZES      'table' (default) the cube is TABLE_M tall. 'room' (the lib
//             life size, renamed) the cube is ROOM_M tall, ROOM_Y above the
//             floor, so the viewer can walk round the knot.
//  CAMERA     the lib renders with the page perspective camera. The page
//             can show an orthographic view; onEnter turns it off (the XR
//             view is always perspective) and onExit turns it back on.
//  LOOP       main.js frame runs on requestAnimationFrame; in a session the
//             lib runs it from the XR frame, so the knot keeps tracing.
//
//  HEADSET PANEL  size, next knot, play or stop the triad, phase drift on or
//                 off, reset, exit.
//
//  GREP MAP
//    const TABLE_M .................. sizes
//    function nextKnot .............. next preset button
//    export const xr = attachXR ..... options and panel actions
// ============================================================================
import { attachXR } from '../../lib/xr-view.js';

const R = window.__res3d, THREE = window.THREE;
const $ = id => document.getElementById(id);
const TABLE_M = 0.5;    // table size: cube height in metres
const ROOM_M = 2.0;     // room size: cube height in metres
const ROOM_Y = 0.3;     // room size: base height above the floor (m)
const E = 1.3;          // model half-size in S units (axis labels at 1.3 S)
let wasOrtho = false, drift = null;

function nextKnot() {
  const b = [...document.querySelectorAll('#presets button')];
  const i = b.findIndex(x => x.classList.contains('on'));
  b[(i + 1) % b.length].click();
}
// Phase drift: set the three phase rates (as the page sliders do), or zero.
function setDrift(on) {
  const v = on ? [0.03, -0.021, 0.017] : [0, 0, 0];
  ['rateX', 'rateY', 'rateZ'].forEach((id, k) => { const el = $(id); el.value = v[k]; el.dispatchEvent(new Event('input')); });
}
const drifting = () => !!(R.G.pRateX || R.G.pRateY || R.G.pRateZ);

export const xr = attachXR({
  THREE, renderer: R.renderer, scene: R.scene, camera: R.camera,
  bounds: () => new THREE.Box3(new THREE.Vector3(-E * R.S, -E * R.S, -E * R.S), new THREE.Vector3(E * R.S, E * R.S, E * R.S)),
  tableHeight: TABLE_M, lifeHeight: ROOM_M, lifeY: ROOM_Y, sizeLabels: { life: 'room' },
  vrButton: $('bVR'), arButton: $('bAR'), vrLabel: 'VIEW IN VR', arLabel: 'VIEW IN AR',
  title: 'Resonance 3D',
  actions: [
    { label: () => `Knot ${R.G.A} : ${R.G.B} : ${R.G.C}  ·  next`, run: nextKnot },
    { label: () => R.G.playing ? 'Stop the triad' : 'Play the triad', on: () => R.G.playing, run: () => $('soundBtn').click() },
    { label: () => drifting() ? 'Phase drift: on' : 'Phase drift: off', on: drifting, run: () => setDrift(!drifting()) },
  ],
  onEnter() {
    wasOrtho = $('projBtn').classList.contains('on');
    if (wasOrtho) $('projBtn').click();
    drift = [R.G.pRateX, R.G.pRateY, R.G.pRateZ];
  },
  onExit() {
    if (wasOrtho && !$('projBtn').classList.contains('on')) $('projBtn').click();
    // put back the phase rates of the moment of entry
    if (drift) ['rateX', 'rateY', 'rateZ'].forEach((id, k) => { const el = $(id); if (+el.value !== drift[k]) { el.value = drift[k]; el.dispatchEvent(new Event('input')); } });
    drift = null;
  },
  onSupport(s) { $('xrSec').hidden = !(s.vr || s.ar); },
});
xr.setSize('table');
