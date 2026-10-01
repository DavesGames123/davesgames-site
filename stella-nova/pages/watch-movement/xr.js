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
//             'true'  the true size (1 mm = 1 mm). The base sits at table
//                     height in VR, or at chest height in AR, so a watch
//                     does not lie on the floor.
//             A piece 150 mm or taller (wall, mantel, regulator) opens at
//             true size. A smaller piece opens at table size.
//             The lib places by a box and scales by its height (table
//             mode). bounds() gives the true box for 'table'. For 'true',
//             it gives a box TABLE_H / 0.001 mm tall from the same base, so
//             the lib scale comes out as 0.001 (mm to metres). The lib's
//             own life mode puts the base on the floor, which is wrong for
//             a 40 mm watch, so no unit is passed and this size row
//             replaces the lib one.
//  IN XR      the movement keeps running. The key light stops casting
//             shadows (its shadow box is in millimetres and the stereo view
//             needs the time). The camera near and far planes go to
//             0.02 m and 100 m each frame, because three takes the XR depth
//             range from the page camera and stage.setShadowExtent sets a
//             near plane in millimetres (1 mm units: near 1 = 1 m).
//  PICK       the controller ray hits the visible pickables (cards.pick does
//             the same from a screen point). Hover glows the part and names
//             it on the panel. Select pins its card and glows it.
//  EXIT       the lib restores the camera, the controls and stage.root. This
//             module restores the shadows, the near and far planes, the
//             explode target and the time rate of the moment of entry.
//
//  GREP MAP
//    export function wireXR ....... options
//    function realBox ............. the piece box in stage.root units
//    function bounds .............. the placement box for each size
//    function pickRay ............. ray to part
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../lib/xr-view.js';
import { vis } from './cards.js';

const TABLE_H = 0.5;          // metres, the piece height at table size
const TRUE_MIN = 150;         // mm: a piece this tall opens at true size
const XR_NEAR = 0.02, XR_FAR = 100;

// o: { stage, cards, get, $, title, actions, getExplode, setExplode, getRate, setRate }
//   get()  -> { B, PARTS, alpha } of the shown piece (the cards' getter)
//   actions: extra panel rows for the page, after the size and the
//            explode, time rows
export function wireXR(o) {
  const { stage, cards, get, $ } = o;
  const { renderer, scene, camera, controls, root, key } = stage;
  let size = 'table';
  let saved = null, hoverId = null, pageNear = camera.near, pageFar = camera.far;

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
  function bounds() {
    const b = realBox();
    if (size === 'true') b.max.y = b.min.y + TABLE_H / 0.001;
    return b;
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
    bounds, tableHeight: TABLE_H,
    vrButton: $('bVR'), arButton: $('bAR'),
    title: o.title,
    actions: [
      { label: () => size === 'true' ? 'Size: true  ·  switch to table' : 'Size: table  ·  switch to true', run: () => { size = size === 'true' ? 'table' : 'true'; xr.reset(); } },
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
    // after the hover pass, before the page frame: glow the hovered part,
    // and keep the XR depth range (a model swap resets the near plane)
    update() {
      cards.C.hover = hoverId; hoverId = null;
      if (camera.near !== XR_NEAR || camera.far !== XR_FAR) {
        pageNear = camera.near; pageFar = camera.far;
        camera.near = XR_NEAR; camera.far = XR_FAR; camera.updateProjectionMatrix();
      }
    },
    onEnter() {
      const h = realBox().getSize(new THREE.Vector3()).y;
      size = h >= TRUE_MIN ? 'true' : 'table';
      saved = { shadow: key.castShadow, explode: o.getExplode(), rate: o.getRate() };
      key.castShadow = false;
      pageNear = camera.near; pageFar = camera.far;
    },
    onExit() {
      if (saved) { key.castShadow = saved.shadow; o.setExplode(saved.explode); o.setRate(saved.rate); }
      saved = null;
      camera.near = pageNear; camera.far = pageFar; camera.updateProjectionMatrix();
      cards.C.hover = null;
    },
    onSupport(s) { const sec = $('xrSec'); if (sec) sec.hidden = !(s.vr || s.ar); },
  });
  // a new piece changes the size: place it again once it has settled
  xr.replace = () => setTimeout(() => { if (xr.presenting) xr.reset(); }, 1300);
  return xr;
}
