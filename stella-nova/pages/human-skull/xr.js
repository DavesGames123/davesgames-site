// ============================================================================
//  HUMAN SKULL  ·  xr.js — the skull in VR and AR
// ────────────────────────────────────────────────────────────────────────────
//  This module wires lib/xr-view.js to the page. The whole scene is the
//  model. The data is in millimetres, so life size is scale 0.001 (unit).
//  Table size makes the shown parts and their floor 0.35 m tall.
//
//  THE PAGE   main.js keeps its state private and gives the debug object
//             window.__skull (S, stage, parts, setArrangement, setExplode,
//             select, isolate). This module reads that object, so main.js
//             does not change. The page loop runs on requestAnimationFrame;
//             in a session the lib calls it from the XR frame loop. The
//             loop renders every frame, so update() needs no dirty flag.
//  BASE       the base of the model box is the page floor (S.floorY), so the
//             shadow floor lands on the real floor or table. In VR at life
//             size the lib puts that base LIFT_M above the floor (lifeY), so
//             the skull floats at the height of a standing head. In AR at
//             life size the skull sits on the surface the viewer picks. The
//             lib places the model again on a size change.
//  SHADOW     the key light's shadow camera has its box in world units. The
//             lib scales the scene, so update() scales that box by the scene
//             scale each frame, and onExit() puts the page values back.
//  CLIP       the page camera clips at 10 .. 20000 mm. The lib holds the
//             session near and far planes in metres (lib CLIP).
//  BUTTONS    #xrSec shows when the device has VR or AR and the parts are
//             loaded (S.ready).
//
//  HEADSET PANEL  size switch, layout, Explode / Reconstruct, part names on
//                 hover, show all parts, reset, exit.
//  PICK           the controller ray hits the shown (not ghost) part meshes
//                 with a Raycaster in world space. As on the desktop: the
//                 first select picks a part, the second isolates it, and a
//                 select on the isolated part shows all again. No GPU pick
//                 render is used, because three replaces the camera with
//                 the XR camera.
//
//  GREP MAP
//    const LIFT_M ................... life-size head height in VR
//    function bounds ................ model box for placement
//    function pickRay ............... ray to part
//    function scaleShadow ........... shadow box at the scene scale
//    export const xr = attachXR ..... options and panel actions
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../lib/xr-view.js';

const K = window.__skull;
const { S, stage } = K;
const $ = id => document.getElementById(id);

const LIFT_M = 1.45;   // floor to the base of the model box at life size in VR (m)
const ORDER = ['anatomy', 'symmetry', 'region', 'tray'];
const LABEL = { anatomy: 'Anatomy', symmetry: 'Symmetry', region: 'Region', tray: 'Catalogue' };
let names = true, support = { vr: false, ar: false };

// The box of the shown parts, in mm, from the page floor up.
const box = new THREE.Box3(), v = new THREE.Vector3();
function bounds() {
  box.makeEmpty();
  for (const p of K.parts) {
    if (p.U.uGhost.value > 0.5) continue;
    const r = p.size * 0.42;
    box.expandByPoint(v.copy(p.mesh.position).addScalar(-r));
    box.expandByPoint(v.copy(p.mesh.position).addScalar(r));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-90, -110, -100), new THREE.Vector3(90, 110, 100));
  box.min.y = Math.min(box.min.y, S.floorY);
  return box.clone();
}

const caster = new THREE.Raycaster();
// The first shown part along the ray, or -1. The ray is in room (world)
// space, and the part meshes carry the scene transform in matrixWorld.
function pickRay(ray) {
  if (!S.ready) return -1;
  stage.scene.updateMatrixWorld();
  caster.ray.copy(ray);
  const meshes = [];
  for (const p of K.parts) if (p.U.uGhost.value < 0.5) meshes.push(p.mesh);
  const h = caster.intersectObjects(meshes, false)[0];
  return h ? h.object.userData.part : -1;
}

// The page sets the shadow box in mm. In a session it must be in metres.
const sc = stage.key.shadow.camera, KEYS = ['left', 'right', 'top', 'bottom', 'near', 'far'];
let base = null, wrote = null;
function scaleShadow() {
  const s = stage.scene.scale.x;
  if (!base || KEYS.some(k => sc[k] !== wrote[k])) base = Object.fromEntries(KEYS.map(k => [k, sc[k]]));
  for (const k of KEYS) sc[k] = base[k] * s;
  wrote = Object.fromEntries(KEYS.map(k => [k, sc[k]]));
  sc.updateProjectionMatrix();
}
function restoreShadow() {
  if (base && !KEYS.some(k => sc[k] !== wrote[k])) { Object.assign(sc, base); sc.updateProjectionMatrix(); }
  base = wrote = null;
}

function showSection() { $('xrSec').hidden = !((support.vr || support.ar) && S.ready); }

export const xr = attachXR({
  renderer: stage.renderer, scene: stage.scene, camera: stage.camera, controls: stage.controls,
  bounds, unit: 0.001, lifeY: LIFT_M, tableHeight: 0.35,
  vrButton: $('bVR'), arButton: $('bAR'),
  title: 'Human skull',
  actions: [
    { label: () => 'Layout: ' + LABEL[S.arr], run: () => K.setArrangement(ORDER[(ORDER.indexOf(S.arr) + 1) % ORDER.length]) },
    { label: () => S.e > 0.02 ? 'Reconstruct' : 'Explode', run: () => K.setExplode(S.e > 0.02 ? 0 : 1, { animate: true }) },
    { label: () => names ? 'Part names: on' : 'Part names: off', on: () => names, run: () => { names = !names; } },
    { label: () => S.iso >= 0 ? 'Show all parts' : 'Pick a part twice to isolate', run: () => { if (S.iso >= 0) K.isolate(-1, { fly: false }); } },
  ],
  onRay(ray, kind) {
    const i = pickRay(ray);
    if (kind === 'hover') return names && i >= 0 ? K.parts[i].m.name : null;
    if (i < 0) return false;
    if (i === S.sel) K.isolate(S.iso === i ? -1 : i, { fly: false });
    else K.select(i);
    return true;
  },
  update() { scaleShadow(); },
  onExit() { restoreShadow(); },
  onSupport(s) { support = s; showSection(); },
});


// The parts load after the module runs: show the buttons once they are in.
if (!S.ready) {
  const t = setInterval(() => { if (S.ready) { clearInterval(t); showSection(); } }, 250);
}
