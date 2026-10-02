// ============================================================================
//  PLANET FORGE  ·  xr.js — the planet in VR and AR
// ----------------------------------------------------------------------------
//  This module wires lib/xr-view.js to the page. The page loads three r128
//  as a global script (no importmap), so the lib gets opts.THREE. main.js
//  runs in an async function (it fetches the atmosphere shader first) and
//  then sets window.__forge = { ren, scn, cam, dr }; this module waits for
//  it. The other controls are page buttons, so the panel rows click them.
//
//  THE MODEL  the whole scene: the planet (radius 1), its atmosphere shell
//             and the scan ring, in a box of half-size R_FIT. The star field
//             (radius 15 .. 95) hides in a session, because it would shrink
//             with the model.
//  SIZES      'table' (default) the planet is TABLE_M across. 'room' (the
//             lib life size, renamed) it is ROOM_M across, ROOM_Y above the
//             floor.
//  LOOP       main.js anim runs on requestAnimationFrame; in a session the
//             lib runs it from the XR frame, so the planet keeps its spin and
//             a generation paints live on the sphere.
//
//  HEADSET PANEL  size, next planet type (generate), new seed (generate),
//                 atmosphere on or off, spin on or off, reset, exit.
//
//  GREP MAP
//    const TABLE_M .................. sizes
//    function generate .............. click the page Generate button
//    attachXR({ ..................... options and panel actions
// ============================================================================
import { attachXR } from '../../lib/xr-view.js';

const T = window.THREE;
const el = id => document.getElementById(id);
const TABLE_M = 0.45;   // table size: planet diameter in metres
const ROOM_M = 2.4;     // room size: planet diameter in metres
const ROOM_Y = 0.2;     // room size: base height above the floor (m)
const R_FIT = 1.06;     // planet and atmosphere radius, model units

for (let i = 0; i < 300 && !window.__forge; i++) await new Promise(r => setTimeout(r, 100));
const F = window.__forge;
if (F) wire(F);

function wire({ ren, scn, cam, dr }) {
  const stars = scn.children.filter(o => o.isPoints);
  const typeSel = el('sel-type');
  const typeName = () => typeSel.options[typeSel.selectedIndex].text;
  const busy = () => el('btn-gen').disabled;
  function generate() { if (!busy()) el('btn-gen').click(); }
  let spin = true;

  const xr = attachXR({
    THREE: T, renderer: ren, scene: scn, camera: cam,
    bounds: () => new T.Box3(new T.Vector3(-R_FIT, -R_FIT, -R_FIT), new T.Vector3(R_FIT, R_FIT, R_FIT)),
    tableHeight: TABLE_M, lifeHeight: ROOM_M, lifeY: ROOM_Y, sizeLabels: { life: 'room' },
    vrButton: el('bVR'), arButton: el('bAR'), vrLabel: 'VR', arLabel: 'AR',
    title: 'Planet forge',
    hideInXR: stars,
    actions: [
      { label: () => busy() ? 'Generating…' : typeName() + '  ·  next type', run: () => {
        if (busy()) return;
        typeSel.selectedIndex = (typeSel.selectedIndex + 1) % typeSel.options.length;
        const m = el('m-sel-type'); if (m) m.value = typeSel.value;
        generate();
      } },
      { label: () => 'New seed  ·  #' + el('inp-seed').value, run: () => { if (busy()) return; el('btn-rand').click(); generate(); } },
      { label: () => 'Atmosphere: ' + el('btn-atmo').textContent.toLowerCase(), on: () => el('btn-atmo').classList.contains('active'), run: () => el('btn-atmo').click() },
      { label: () => spin ? 'Spin: on' : 'Spin: off', on: () => spin, run: () => { spin = !spin; dr.d = !spin; } },
    ],
    onExit() { spin = true; dr.d = false; },
    onSupport(s) { el('xrSec').hidden = !(s.vr || s.ar); },
  });
  xr.setSize('table');
}
