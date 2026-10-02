// ============================================================================
//  PROTEIN FOLDING  ·  xr.js — the folding replicas in VR and AR
// ----------------------------------------------------------------------------
//  initXR() wires lib/xr-view.js to the page. main.js calls it at boot with
//  the stage objects and the actions it owns. The whole scene is the model:
//  the grid of replicas. A chain has no life size, so the lib uses its table
//  size only: the largest side of the grid is 0.7 m.
//
//  The page loop (frame in main.js) runs on requestAnimationFrame and draws
//  with one plain renderer.render, so in a session the lib runs it from the
//  XR frame and three draws it for both eyes. The page camera is in Å; the
//  lib holds the session near and far planes in metres (lib CLIP).
//
//  HEADSET PANEL run or pause, restart the fold, next protein, reset, exit.
//  HOVER         the controller ray against a sphere round each replica
//                names the replica and its Q (Go) or the chain (HP).
//
//  GREP MAP
//    function cube .................. model box for placement
//    function pickReplica ........... ray to replica
//    export function initXR ......... options and panel actions
// ============================================================================
import * as THREE from 'three';
import { attachXR } from '../../lib/xr-view.js';

// A cube round the replica box: the lib scales the box height to the table
// size, so the largest side of the grid is the table size.
function cube(b) {
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()), h = Math.max(s.x, s.y, s.z) / 2;
  return new THREE.Box3(c.clone().subScalar(h), c.clone().addScalar(h));
}

// ctx: renderer, scene, camera, controls, S, $, bounds() (replica box in
// scene units), cell (replica cell size), setRunning, restart, loadPreset,
// PRESETS
export function initXR(ctx) {
  const { renderer, scene, camera, controls, S, $ } = ctx;
  const inv = new THREE.Matrix4(), c = new THREE.Vector3(), q = new THREE.Vector3();

  // The replica whose sphere the ray passes through first, or -1. The ray is
  // in room space; the replicas are in scene space.
  function pickReplica(ray) {
    scene.updateMatrixWorld();
    const r = ray.clone().applyMatrix4(inv.copy(scene.matrixWorld).invert());
    const rad = ctx.cell() * 0.45;
    let best = -1, bt = Infinity;
    S.views.forEach((v, k) => {
      c.copy(v.group.position);
      if (r.distanceSqToPoint(c) > rad * rad) return;
      const t = r.closestPointToPoint(c, q).distanceTo(r.origin);
      if (t < bt) { bt = t; best = k; }
    });
    return best;
  }
  function replicaName(k) {
    if (S.kind === 'hp') return k === 0 ? 'Coldest replica' : 'Best fold found';
    const o = S.sims[k]?.frame?.obs;
    return `Replica ${k + 1}` + (o ? ` · Q ${o.Q.toFixed(2)} · RMSD ${o.rmsd.toFixed(1)} Å` : '');
  }
  function nextPreset() {
    const k = Math.max(0, ctx.PRESETS.findIndex(p => p.id === S.preset?.id));
    ctx.loadPreset(ctx.PRESETS[(k + 1) % ctx.PRESETS.length].id);
    if (xr.presenting) requestAnimationFrame(() => xr.reset());
  }

  const xr = attachXR({
    renderer, scene, camera, controls,
    bounds: () => cube(ctx.bounds()), tableHeight: 0.7,
    vrButton: $('bVR'), arButton: $('bAR'),
    title: 'Protein folding',
    actions: [
      { label: () => S.running ? 'Pause the fold' : 'Run the fold', on: () => S.running, run: () => ctx.setRunning(!S.running) },
      { label: 'Restart the fold', run: () => ctx.restart() },
      { label: () => (S.preset ? S.preset.name : 'Protein') + '  ·  next ▶', run: nextPreset },
    ],
    onRay(ray, kind) {
      if (kind !== 'hover') return false;
      const k = pickReplica(ray);
      return k >= 0 ? replicaName(k) : null;
    },
    onSupport(s) { $('xrSec').hidden = !(s.vr || s.ar); },
  });
  return xr;
}
