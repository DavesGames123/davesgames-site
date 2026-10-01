// ============================================================================
//  LEO CATALOG  ·  xr.js — the globe and its satellites in VR and AR
// ----------------------------------------------------------------------------
//  This module wires lib/xr-view.js to the page. main.js calls wireXR(ctx)
//  once the catalog is loaded, so the headset buttons show only then.
//
//  THE MODEL  the whole scene. 1 scene unit = 1 Earth radius. The model box
//             is the LEO shell, a cube of half-size SHELL_R (1.35 Earth
//             radii, about 2200 km altitude). MEO and GEO objects (GPS,
//             Galileo, GEO payloads) sit outside this box, as on the desktop.
//  SIZES      'table' (default) the shell is TABLE_M tall: Earth is about
//             0.6 m across. 'life' in the panel is the room size: the shell
//             is ROOM_M tall and stands on the floor, and the viewer stands
//             in the LEO band between the ground and the shell. The lib
//             keeps the base in place on a size change, which can put the
//             head inside the Earth, so update() places the model again
//             after each size change.
//  LOOP       main.js animate() runs on requestAnimationFrame. The lib calls
//             it from the XR frame loop, so SGP4 propagation and the clock
//             keep running. In a session the propagation rate drops to
//             XR_PROP_HZ, and the HTML labels (cities, sat labels) stop,
//             because the headset can not show the DOM. onExit restores
//             both.
//  PICK       the controller ray hits the point cloud with a Raycaster in
//             room space (no GPU pick render). The Points threshold is in
//             model units (Earth radii), so HIT_M is divided by the world
//             scale. Each hand has its own hover cache. Hover names the
//             object.
//             The lib shows that name on the panel status line, so the
//             page sets no status of its own. Select shows the orbit trail.
//             A locked desktop chip is paused for the session, so camera
//             tracking does not move the restored camera.
//
//  GREP MAP
//    const SHELL_R .................. model box
//    function rayHit ................ ray to satellite index
//    export function wireXR ......... options and panel actions
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../lib/xr-view.js';

const SHELL_R = 1.35;        // LEO shell half-size in Earth radii
const TABLE_M = 0.8;         // table size: shell height in metres
const ROOM_M = 3.5;          // room size: shell height in metres. Placed
                             // 1.5 m out, the head is 1.16 Earth radii from
                             // the centre: inside the LEO band.
const XR_PROP_HZ = 10;       // SGP4 rate in a session
const HIT_M = 0.012;         // ray hit radius in metres (room space)
const PICK_R = 8;             // raycast bounding sphere, Earth radii (GEO is 6.6)
const HOVER_MS = 60;         // hover pick at most this often per hand
const SPEEDS = [1, 100, 1000, 10000];

// The last name a hover found, from either hand (for tests).
let lastHover = null;
export const hoverName = () => lastHover;

// ctx (from main.js):
//   renderer, scene, camera, controls, stars, satPoints(), sats(),
//   SIM, OVERLAY, FILTER, el: { play, now }, setFilter(cat, on),
//   setOverlay(key, on), applySpeed(x), fmtRate(x), setPropHz(hz),
//   getSel() -> { idx, locked }, setSel({ idx, locked }), refreshTrail()
export function wireXR(ctx) {
  const ray = new THREE.Raycaster();
  // Hover cache, one entry per hand. The lib passes no hand id, so a ray
  // matches the entry with the nearest origin (hands are centimetres apart).
  const hov = [{ o: new THREE.Vector3(1e9, 0, 0), at: 0, idx: -1 }, { o: new THREE.Vector3(-1e9, 0, 0), at: 0, idx: -1 }];
  let saved = null, lastSize = null;

  // The nearest object along the ray, or -1. satPoints carries the scene
  // transform in its matrixWorld, so the room-space ray works as it is.
  // three tests the threshold in model units, so HIT_M (metres) is divided
  // by the world scale.
  function rayHit(r) {
    const pts = ctx.satPoints();
    if (!pts) return -1;
    // three rejects a ray that misses geometry.boundingSphere. The first
    // raycast computes and caches it, and if that ran while the points were
    // parked at -10000 (before propagation), the sphere is a point there and
    // every later ray misses. A fixed sphere of PICK_R holds every orbit.
    const g = pts.geometry, bs = g.boundingSphere;
    if (!bs || bs.radius < 2 || bs.center.lengthSq() > 1) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PICK_R);
    ray.ray.copy(r);
    pts.updateWorldMatrix(true, false);
    ray.params.Points.threshold = HIT_M / pts.matrixWorld.getMaxScaleOnAxis();
    const hits = ray.intersectObject(pts, false);
    if (!hits.length) return -1;
    let best = hits[0];
    for (const h of hits) if (h.distanceToRay < best.distanceToRay) best = h;
    return best.index;
  }
  const nameOf = i => { const s = ctx.sats()[i]; return s ? s.name : null; };

  const xr = attachXR({
    renderer: ctx.renderer, scene: ctx.scene, camera: ctx.camera, controls: ctx.controls,
    bounds: () => new THREE.Box3(new THREE.Vector3(-SHELL_R, -SHELL_R, -SHELL_R), new THREE.Vector3(SHELL_R, SHELL_R, SHELL_R)),
    lifeHeight: ROOM_M, tableHeight: TABLE_M,
    vrButton: document.getElementById('bVR'), arButton: document.getElementById('bAR'),
    title: 'LEO catalog',
    hideInAR: ctx.stars ? [ctx.stars] : [],
    actions: [
      { label: () => ctx.SIM.playing ? 'Pause time' : 'Play time', on: () => ctx.SIM.playing, run: () => ctx.el.play.click() },
      { label: () => 'Speed: ' + ctx.fmtRate(ctx.SIM.speed), run: () => {
        const i = SPEEDS.findIndex(s => s > ctx.SIM.speed * 1.01);
        ctx.applySpeed(SPEEDS[i < 0 ? 0 : i]);
      } },
      { label: 'Jump to now', run: () => ctx.el.now.click() },
      { label: () => ctx.FILTER.starlink ? 'Starlink: on' : 'Starlink: off', on: () => ctx.FILTER.starlink, run: () => ctx.setFilter('starlink', !ctx.FILTER.starlink) },
      { label: () => ctx.FILTER.debris ? 'Debris: on' : 'Debris: off', on: () => ctx.FILTER.debris, run: () => ctx.setFilter('debris', !ctx.FILTER.debris) },
      { label: () => ctx.OVERLAY.trails ? 'Orbit trail: on' : 'Orbit trail: off', on: () => ctx.OVERLAY.trails, run: () => ctx.setOverlay('trails', !ctx.OVERLAY.trails) },
    ],
    onRay(r, kind) {
      if (kind === 'hover') {
        const now = performance.now();
        const h = hov[0].o.distanceToSquared(r.origin) <= hov[1].o.distanceToSquared(r.origin) ? hov[0] : hov[1];
        if (now - h.at >= HOVER_MS || h.o.distanceToSquared(r.origin) > 0.0004) { h.at = now; h.idx = rayHit(r); }
        h.o.copy(r.origin);
        const name = h.idx >= 0 ? nameOf(h.idx) : null;
        if (name) lastHover = name;
        return name;
      }
      const i = rayHit(r);
      if (i < 0) return false;
      ctx.setSel({ idx: i, locked: false });
      ctx.refreshTrail();
      return true;
    },
    onEnter() {
      saved = { sel: ctx.getSel(), cities: ctx.OVERLAY.cities, satlabels: ctx.OVERLAY.satlabels };
      if (saved.sel.locked) ctx.setSel({ idx: saved.sel.idx, locked: false });
      ctx.setOverlay('cities', false, true);
      ctx.setOverlay('satlabels', false, true);
      ctx.setPropHz(XR_PROP_HZ);
    },
    update() {
      if (lastSize !== null && xr.size !== lastSize) xr.reset();
      lastSize = xr.size;
    },
    onExit() {
      lastSize = null;
      ctx.setPropHz(0);
      if (!saved) return;
      ctx.setOverlay('cities', saved.cities, true);
      ctx.setOverlay('satlabels', saved.satlabels, true);
      ctx.setSel(saved.sel);
      ctx.refreshTrail();
      saved = null;
    },
    onSupport(s) { const p = document.getElementById('xr-panel'); if (p) p.hidden = !(s.vr || s.ar); },
  });
  xr.setSize('table');
  return xr;
}
