// ============================================================================
//  STRANGE ATTRACTORS  ·  xr.js — the attractor in VR and AR
// ----------------------------------------------------------------------------
//  This module wires lib/xr-view.js to the page. The page loads three r128
//  as a global script (no importmap), so the lib gets opts.THREE. main.js is
//  a classic script: its top-level renderer, scene, camera, geo, cfg, sel and
//  cur are global bindings, and this module reads them.
//
//  THE MODEL  the whole scene: the tracer line segments. bounds() is the box
//             of the vertices drawn now (geo draw range), so each system
//             gets its own size.
//  SIZES      'table' (default) the attractor is TABLE_M tall. 'room' (the
//             lib life size, renamed) it is ROOM_M tall, ROOM_Y above the
//             floor, so the viewer can stand in the flow.
//  LOOP       main.js frame runs on requestAnimationFrame; in a session the
//             lib runs it from the XR frame, so the tracers keep flowing.
//             The page orbits its own camera; the XR view ignores that.
//
//  HEADSET PANEL  size, next system, pause or run the flow, randomize the
//                 parameters, colour mode, reset, exit.
//
//  GREP MAP
//    const TABLE_M .................. sizes
//    function bounds ................ box of the drawn tracers
//    export const xr = attachXR ..... options and panel actions
// ============================================================================
import { attachXR } from '../../lib/xr-view.js';

const T = window.THREE;
const el = id => document.getElementById(id);
const TABLE_M = 0.6;    // table size: attractor height in metres
const ROOM_M = 2.2;     // room size: attractor height in metres
const ROOM_Y = 0.3;     // room size: base height above the floor (m)
const MODES = ['speed', 'spectrum', 'mono'];
let pausedSpeed = null;  // the flow speed while the panel pauses the flow

// The box of the vertices drawn this frame (two per segment).
function bounds() {
  const a = geo.attributes.position.array, n = Math.min(geo.drawRange.count, a.length / 3);
  const b = new T.Box3();
  for (let i = 0; i < n; i += 7) b.expandByPoint(new T.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
  return b;
}
// The flow takes a moment to fill a new shape: place it again after that.
function replace() { setTimeout(() => { if (xr.presenting) xr.reset(); }, 1500); }
function nextSystem() {
  const k = Object.keys(ATTRACTORS);
  sel.value = k[(k.indexOf(cur) + 1) % k.length];
  sel.dispatchEvent(new Event('change'));
  replace();
}
function setPaused(p) {
  if (p && pausedSpeed == null) { pausedSpeed = cfg.speed; cfg.speed = 0; }
  else if (!p && pausedSpeed != null) { cfg.speed = pausedSpeed; pausedSpeed = null; }
}

export const xr = attachXR({
  THREE: T, renderer, scene, camera,
  bounds, tableHeight: TABLE_M, lifeHeight: ROOM_M, lifeY: ROOM_Y, sizeLabels: { life: 'room' },
  vrButton: el('bVR'), arButton: el('bAR'),
  title: 'Strange attractors',
  actions: [
    { label: () => ATTRACTORS[cur].name + '  ·  next', run: nextSystem },
    { label: () => pausedSpeed != null ? 'Run the flow' : 'Pause the flow', on: () => pausedSpeed != null, run: () => setPaused(pausedSpeed == null) },
    { label: 'Randomize the parameters', run: () => { el('btnRand').click(); replace(); } },
    { label: () => 'Colour: ' + cfg.colMode + '  ·  next', run: () => {
      const m = MODES[(MODES.indexOf(cfg.colMode) + 1) % MODES.length];
      el('colMode').querySelector(`[data-m="${m}"]`).click();
    } },
  ],
  onExit() { setPaused(false); },
  onSupport(s) { el('xrSec').hidden = !(s.vr || s.ar); },
});
xr.setSize('table');
