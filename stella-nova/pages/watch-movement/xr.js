// ============================================================================
//  WATCH MOVEMENT  ·  xr.js — a timepiece in VR and AR
// ────────────────────────────────────────────────────────────────────────────
//  wireXR() connects lib/xr-view.js to a timepiece page. watch-movement and
//  watch-randomizer both use it: they share stage.js and cards.js, and each
//  page gives its own panel actions.
//
//  THE MODEL  stage.root holds the piece. The scene is in millimetres. The
//             watch stands upright: y is 12 o'clock, and +z (the movement
//             side) faces the viewer.
//  SIZES      'table' the piece is TABLE_H (0.5 m) tall. A 40 mm watch is
//                     about 12 times its true size.
//             'true'  the lib life size: unit 0.001 (mm to metres). The base
//                     sits TRUE_Y above the floor in VR (lifeY), or at chest
//                     height in AR, so a watch does not lie on the floor.
//             A piece 150 mm or taller (wall, mantel, regulator) opens at
//             true size. A smaller piece opens at table size.
//  IN XR      the movement keeps running. The key light stops casting
//             shadows (its shadow box is in millimetres and the stereo view
//             needs the time). The lib holds the session near and far planes
//             in metres, also after stage.setShadowExtent sets a near plane
//             in millimetres on a model swap (lib CLIP).
//  PICK       the controller ray hits the visible pickables (cards.pick does
//             the same from a screen point). Hover glows the part and names
//             it on the panel. Select pins its card and glows it.
//  EXIT       the lib restores the camera, its near and far planes, the
//             controls and stage.root. This module restores the shadows,
//             the explode target and the time rate of the moment of entry.
//
//  GREP MAP
//    export function wireXR ....... options
//    function realBox ............. the piece box in stage.root units
//    function pickRay ............. ray to part
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../lib/xr-view.js';
import { vis } from './cards.js';

const TABLE_H = 0.5;          // metres, the piece height at table size
const TRUE_Y = 0.8;           // metres, the base height at true size in VR
const TRUE_MIN = 150;         // mm: a piece this tall opens at true size

// o: { stage, cards, get, $, title, actions, getExplode, setExplode, getRate, setRate }
//   get()  -> { B, PARTS, alpha } of the shown piece (the cards' getter)
//   actions: extra panel rows for the page, after the lib size row and the
//            explode, time rows
export function wireXR(o) {
  const { stage, cards, get, $ } = o;
  const { renderer, scene, camera, controls, root, key } = stage;
  let saved = null, hoverId = null;

  // The piece box in stage.root units (mm), with stage.root at identity.
  const box = new THREE.Box3();
  function realBox() {
    const cur = get();
    if (!cur) return box.set(new THREE.Vector3(-20, -20, -5), new THREE.Vector3(20, 20, 5)).clone();
    const p = root.position.clone(), q = root.quaternion.clone(), s = root.scale.clone();
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    box.setFromObject(cur.B.root);
    root.position.copy(p); root.quaternion.copy(q); root.scale.copy(s);
    root.updateMatrixWorld(true);
    return box.clone();
  }
  const ray = new THREE.Raycaster();
  function pickRay(r) {
    const cur = get();
    if (!cur || cur.alpha < 0.6) return null;
    ray.set(r.origin, r.direction);
    const hit = ray.intersectObjects(cur.B.pickables.filter(vis), false)[0];
    if (!hit) return null;
    const id = hit.object.userData.part;
    if (!cur.PARTS[id]) return null;
    return { id, obj: hit.object, local: hit.object.worldToLocal(hit.point.clone()) };
  }

  const RATES = [1, 60, 0];
  const rateName = r => r === 0 ? 'paused' : r === 1 ? 'real time' : '×' + r;
  const xr = attachXR({
    renderer, scene, camera, controls, root,
    bounds: realBox, unit: 0.001, lifeY: TRUE_Y, tableHeight: TABLE_H, sizeLabels: { life: 'true' },
    vrButton: $('bVR'), arButton: $('bAR'),
    title: o.title,
    actions: [
      { label: () => o.getExplode() > 0.05 ? 'Assemble' : 'Explode', run: () => o.setExplode(o.getExplode() > 0.05 ? 0 : 0.9) },
      { label: () => 'Time: ' + rateName(o.getRate()), run: () => { const i = RATES.indexOf(o.getRate()); o.setRate(RATES[(i + 1) % RATES.length]); } },
      ...(o.actions || []),
    ],
    onRay(r, kind) {
      const hit = pickRay(r);
      if (kind === 'hover') { if (hit && hoverId == null) hoverId = hit.id; return hit ? get().PARTS[hit.id].name : null; }
      if (hit) { cards.setPin(hit); return true; }
      return false;
    },
    // after the hover pass, before the page frame: glow the hovered part
    update() { cards.C.hover = hoverId; hoverId = null; },
    onEnter() {
      // the piece is not placed yet: this sets the size of the first placement
      xr.setSize(realBox().getSize(new THREE.Vector3()).y >= TRUE_MIN ? 'life' : 'table');
      saved = { shadow: key.castShadow, explode: o.getExplode(), rate: o.getRate() };
      key.castShadow = false;
    },
    onExit() {
      if (saved) { key.castShadow = saved.shadow; o.setExplode(saved.explode); o.setRate(saved.rate); }
      saved = null;
      cards.C.hover = null;
    },
    onSupport(s) { const sec = $('xrSec'); if (sec) sec.hidden = !(s.vr || s.ar); },
  });
  // a new piece changes the size: place it again once it has settled
  xr.replace = () => setTimeout(() => { if (xr.presenting) xr.reset(); }, 1300);
  return xr;
}
