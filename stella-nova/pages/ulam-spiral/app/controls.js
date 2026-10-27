// ============================================================================
//  ULAM SPIRAL  ·  app/controls.js — shape, mode, home, walk, go-to
// ----------------------------------------------------------------------------
//  The actions that the panel, the dock, the keys and saver.js share. A
//  shape change morphs (S.morphOn) or jumps; shapeChanged resets what
//  depends on the shape (tile, hover, rays, thumbnails, minimap, pi).
//
//  GREP MAP
//    grep -n 'export function setShape'      morph or jump to a shape
//    grep -n 'export function shapeChanged'  reset after a shape change
//    grep -n 'export function setMode'       the highlight mode
//    grep -n 'export function goHome'        the home view
//    grep -n 'export function toggleWalk'    start or stop the walk
//    grep -n 'export function gotoNumber'    parse "1e12+39" and fly there
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { toast } from './dom.js';
import { fmt } from './format.js';
import { is3D } from './camera.js';
import { startOf, bboxOf, fitCam, homeCam, home3 } from './framing.js';
import { startMorph, startWalk, stopWalk, flyTo } from './motion.js';
import { computeRays } from './overlay.js';
import { showReadout, updateStatus } from './readout.js';
import { syncModeUI, syncShapeUI } from './panel.js';

const M = T.MODE;

export function setShape(b, opts = {}) {
  if (b === S.shape && !S.morph) return;
  if (b.lattice === 'gauss') S.mode = M.gauss; else if (b.lattice === 'eisen') S.mode = M.eisen;
  else if (S.mode === M.gauss || S.mode === M.eisen) S.mode = M.primes;
  syncModeUI();
  const animate = opts.morph != null ? opts.morph : S.morphOn;
  if (animate && rt.R) startMorph(b, opts.dur, opts);
  else {
    S.morph = null; S.shape = b;
    if (is3D(b)) S.cam3 = home3(b); else { S.cam = homeCam(b); S.cam3 = null; }
    shapeChanged();
  }
  syncShapeUI(b);
}
export function shapeChanged() {
  S.tile.have = null; S.hover = null; S.sel = null; rt.piAt = -1; showReadout(null);
  computeRays(); rt.thumbsDirty = true; rt.miniAt = 0; S.dirty = true;
  updateStatus();
}
// A Gaussian or Eisenstein mode needs its lattice; an index-numbered
// lattice may show any other mode.
export function setMode(id) {
  if (id === M.gauss && S.shape.lattice !== 'gauss') { S.mode = id; setShape(L.SHAPE.gauss); return; }
  if (id === M.eisen && S.shape.lattice !== 'eisen') { S.mode = id; setShape(L.SHAPE.eisen); return; }
  S.mode = id;
  if (id >= M.divisors && id <= M.totient && rt.R && rt.R.arith.mode !== id) rt.worker.postMessage({ type: 'arith', mode: id });
  S.tile.have = null; rt.thumbsDirty = true; S.dirty = true; rt.miniAt = 0;
  syncModeUI(); updateStatus();
}

export function goHome() { stopWalk(); if (is3D(S.shape)) { S.cam3 = home3(S.shape); S.dirty = true; } else flyTo(homeCam(), 1.2); }
export function toggleWalk() {
  if (S.walk) { stopWalk(); return; }
  if (!is3D(S.shape)) { const st = startOf(); S.cam = { ...S.cam, ...fitCam(bboxOf(S.shape, st, st + 9, 20), 0.6) }; S.cam.z = Math.min(S.cam.z, 60); }
  startWalk();
}
export function gotoNumber(txt) {
  let n;
  try {
    const t = String(txt).trim().replace(/[, _]/g, '');
    const m = /^(\d+(?:\.\d+)?)e(\d+)([+-]\d+)?$/i.exec(t);
    n = m ? Math.round(+m[1] * 10 ** +m[2]) + (m[3] ? +m[3] : 0) : /^\d+$/.test(t) ? Number(t) : NaN;
  } catch (e) { n = NaN; }
  if (!Number.isSafeInteger(n) || n < 0) { toast('Enter a whole number up to 9×10¹⁵'); return; }
  const sh = S.shape;
  if (n < startOf()) { toast(`This shape starts at ${startOf()}`); return; }
  const p = L.posOf(sh, n, S.P);
  if (!p) return;
  if (is3D(sh)) { const c = S.cam3 || home3(sh); S.cam3 = { ...c, tx: p[0], ty: p[1], tz: p[2], dist: 40 }; S.dirty = true; }
  else {
    const [wx, wy] = L.isLattice(sh) ? L.worldOf(sh, p[0], p[1]) : p;
    // close enough that the label of n fits its cell (labels need 5.5 px type)
    flyTo({ x: wx, y: wy, z: Math.max(46, 0.58 * String(n).length * 7 / 0.86) }, 2.2);
    S.sel = { n, w: [wx, wy], cell: L.isLattice(sh) ? p : null };
    showReadout(S.sel);
  }
  if (n > S.limit) toast(`${fmt(n)} is past the sieve: Miller–Rabin tiles`);
}
