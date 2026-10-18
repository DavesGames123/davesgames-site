// ============================================================================
//  CORAL REEF  ·  fine-view.js  ·  which mesh of a colony shows (DOM-free)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the corals get reconstructed over and over
//  in front of my very eyes instead of staying totally locked in". Each
//  colony has a coarse mesh (always there) and, near the cameras, a fine
//  mesh of its own (coral-sdf.js). This file keeps ONE full mesh of each
//  colony on screen at all times:
//    - a new fine mesh builds hidden (scene.js setFineGate). The worker
//      event { k, state: 'complete' } asks scene.js to show it
//      (showFine). The flush that shows it lists k in takeShown(); then
//      the coarse mesh of k hides (a negative radius in the data texture,
//      sent to the GPU at the next render).
//    - the event { k, state: 'drop' } shows the coarse mesh of k first,
//      then scene.js dropFine(k) removes the fine group after one more
//      render.
//  main.js and tests/lock.test.mjs use it.
//
//    const FV = createFineView({ scene, reef: () => mirror, now: () => ms });
//    FV.onFine(list)     the worker 'fine' message list
//    FV.afterFlush()     after scene.flushChunks (each frame)
//    FV.has(k)           true: the fine mesh of k shows, its coarse hides
//    FV.reset()          a new reef (gen)
//
//  grep -n targets: "export function createFineView", "function coarseFor"
// ============================================================================

export function createFineView({ scene, reef, now = () => 0 } = {}) {
  const shown = new Set();
  // Show (on) or hide the coarse mesh of colony k: the sign of the radius
  // of its particles in the data texture (scene.js), uploaded at once.
  function coarseFor(k, on) {
    if (on) { if (!shown.delete(k)) return; } else { if (shown.has(k)) return; shown.add(k); }
    const R = reef && reef();
    if (!scene || !R) return;
    const col = R.col;
    scene.setParticles(0, R.count, (g, A, B, o) => { if (col[g] === k) B[o + 1] = on ? Math.abs(B[o + 1]) : -Math.abs(B[o + 1]); });
    scene.uploadParticles(now(), true);
  }
  return {
    shown,
    has: k => shown.has(k),
    reset() { shown.clear(); },
    onFine(list) {
      for (const e of list || []) {
        if (e.state === 'complete') { if (scene) scene.showFine(e.k); }
        else if (e.state === 'drop') { coarseFor(e.k, true); if (scene) scene.dropFine(e.k); }
      }
    },
    afterFlush() {
      if (!scene || !scene.takeShown) return;
      for (const k of scene.takeShown()) coarseFor(k, false);
    },
  };
}
