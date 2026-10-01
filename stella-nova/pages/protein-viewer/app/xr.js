// ============================================================================
//  PROTEIN VIEWER  ·  app/xr.js — the structure in VR and AR
// ────────────────────────────────────────────────────────────────────────────
//  This module wires lib/xr-view.js to the page. The whole scene is the
//  model. A protein has no life size, so the lib uses its table size only:
//  the largest extent of the structure (the bound sphere) is 0.6 m.
//
//  IN A SESSION  S.xr is set. loop.js then skips post.js (its full-screen
//                pass can not draw two eyes) and the Å near and far planes,
//                and the lib draws the scene. layers.js uses one step less
//                sphere detail, and the layers are built again on entry and
//                on exit.
//  CAMERA        three takes the XR camera relative to the parent of the
//                page camera. The page camera is a child of the scene (its
//                two lights ride on it), and the lib scales the scene. So on
//                entry the camera leaves the scene and its lights go to a
//                rig that follows the head; on exit they go back.
//  HEADSET PANEL next and previous preset, style, colour, residue names on
//                hover, reset, exit.
//  PICK          the controller ray against the pickable atom spheres
//                (S.pick, S.pickOver), as pickAt() does on the screen. Hover
//                names the residue; select selects it.
//
//  GREP MAP
//    function bounds ................ model box for placement
//    function pickRay ............... ray to atom
//    function lightsTo .............. move the camera lights
//    export const xr = attachXR ..... options and panel actions
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../../lib/xr-view.js';
import { PRESETS } from '../presets.js';
import { $ } from './env.js';
import { S, resLabel, dirty } from './state.js';
import { renderer, scene, camera, controls } from './stage.js';
import { rebuild } from './layers.js';
import { paint } from './paint.js';
import { loadPreset } from './load.js';
import { select } from './select.js';

let names = true;

// A cube round the bound sphere: the lib scales the box height to the
// table size, so the largest extent of any turn of the model is 0.6 m.
function bounds() {
  const c = S.bound.c, r = S.bound.r;
  return new THREE.Box3(new THREE.Vector3(c.x - r, c.y - r, c.z - r), new THREE.Vector3(c.x + r, c.y + r, c.z + r));
}

const inv = new THREE.Matrix4();
// The first atom sphere along the ray, or -1. The ray is in room space;
// S.wpos is in scene space, so the ray goes through the inverse scene
// transform.
function pickRay(ray) {
  if (!S.ready || !S.wpos) return -1;
  scene.updateMatrixWorld();
  const r = ray.clone().applyMatrix4(inv.copy(scene.matrixWorld).invert());
  const o = r.origin, d = r.direction, w = S.wpos;
  let best = -1, bestT = Infinity;
  for (const set of [...S.pickOver, ...S.pick]) {
    const { idx, rad } = set;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const vx = w[3 * i] - o.x, vy = w[3 * i + 1] - o.y, vz = w[3 * i + 2] - o.z;
      const t = vx * d.x + vy * d.y + vz * d.z;
      if (t <= 0) continue;
      const p2 = vx * vx + vy * vy + vz * vz - t * t, rr = rad[k];
      if (p2 >= rr * rr) continue;
      const tt = t - Math.sqrt(rr * rr - p2);
      if (tt < bestT) { bestT = tt; best = i; }
    }
  }
  return best;
}
function atomName(i) {
  const s = S.s, a = s.atoms[i], r = s.residues[a.res];
  return `${r.chainId}:${resLabel(r)} · ${a.name}${s.meta.af ? ' · pLDDT ' + a.b.toFixed(0) : ''}`;
}
function setHoverRes(ri) {
  if (ri === S.hoverRes) return;
  S.hoverRes = ri; paint();
}

// ── camera lights ───────────────────────────────────────────────────────────
// The rig holds the camera lights while the camera is out of the scene. Its
// matrix puts it at the head, in scene space, each XR frame.
const rig = new THREE.Group();
rig.matrixAutoUpdate = false;
let saved = null;
function lightsTo(from, to) {
  const lights = from.children.filter(c => c.isLight);
  const move = [...lights, ...lights.map(l => l.target).filter(t => t && t.parent === from)];
  for (const c of move) to.add(c);
}
function onEnter() {
  saved = { near: camera.near, far: camera.far };
  scene.remove(camera);
  lightsTo(camera, rig);
  scene.add(rig);
  camera.near = 0.01; camera.far = 100; camera.updateProjectionMatrix();
  S.xr = true;
  if (S.s) rebuild();
}
function onExit() {
  lightsTo(rig, camera);
  scene.remove(rig);
  scene.add(camera);
  if (saved) { camera.near = saved.near; camera.far = saved.far; camera.updateProjectionMatrix(); saved = null; }
  S.xr = false;
  setHoverRes(-1);
  if (S.s) rebuild();
  dirty();
}
const head = new THREE.Matrix4();
function update() {
  const c = renderer.xr.getCamera();
  scene.updateMatrixWorld();
  head.copy(scene.matrixWorld).invert().multiply(c.matrixWorld);
  rig.matrix.copy(head);
  rig.matrixWorldNeedsUpdate = true;
}

// ── presets ─────────────────────────────────────────────────────────────────
function step(dir) {
  const k = Math.max(0, PRESETS.findIndex(p => p.id === S.preset?.id));
  const p = PRESETS[(k + dir + PRESETS.length) % PRESETS.length];
  loadPreset(p.id).then(() => { if (xr.presenting) xr.reset(); });
}

export const xr = attachXR({
  renderer, scene, camera, controls,
  bounds, tableHeight: 0.6,
  vrButton: $('bVR'), arButton: $('bAR'),
  title: 'Protein structure',
  actions: [
    { label: () => (S.preset ? S.preset.title : 'Structure') + '  ·  next ▶', run: () => step(1) },
    { label: '◀  Previous structure', run: () => step(-1) },
    { label: () => 'Style: ' + $('dockRepV').textContent + '  ·  next', run: () => $('dockRep').click() },
    { label: () => 'Colour: ' + $('dockColorV').textContent + '  ·  next', run: () => $('dockColor').click() },
    { label: () => names ? 'Residue names: on' : 'Residue names: off', on: () => names, run: () => { names = !names; if (!names) setHoverRes(-1); } },
  ],
  onRay(ray, kind) {
    const i = pickRay(ray);
    if (kind === 'hover') {
      if (!names) return null;
      setHoverRes(i >= 0 ? S.s.atoms[i].res : -1);
      return i >= 0 ? atomName(i) : null;
    }
    if (i >= 0) { select(i, { ensure: false, scroll: false }); return true; }
    return false;
  },
  update, onEnter, onExit,
  onSupport: syncSection,
});

// The section shows when the device has WebXR and a structure is loaded.
let support = null;
function syncSection(s) {
  if (s) support = s;
  const show = !!support && (support.vr || support.ar) && S.ready;
  $('xrSec').hidden = !show;
  if (!show && support && (support.vr || support.ar)) requestAnimationFrame(() => syncSection());
}
