// ============================================================================
//  HUMAN SKELETON  ·  app/layouts.js — modes, explode amount, transitions
// ────────────────────────────────────────────────────────────────────────────
//  The mode is radial, regional or catalogue. S.amt holds one explode
//  amount per region, so one region can open while the others stay put.
//  target() gives the layout offsets for the visible bones (layout.js).
//  retarget() starts a transition from the bones as they are now: S.from
//  is the present pose, S.to the target, and S.delay the stagger. The loop
//  moves S.cur from S.from to S.to.
//
//  GREP MAP
//    function aspect / perBoneAmt / target           the layout target
//    function exploded                               any region open
//    function retarget                               start a transition
//    function setMode / explode / reconstruct        mode changes
//    function setAmount / toggleRegionExplode        explode amounts
// ============================================================================
import * as L from '../layout.js';
import { REDUCED } from './env.js';
import { S, dirty } from './state.js';
import { clearRect, fitView, fitShadow } from './camera.js';
import { setTraysOn, buildTrays } from './tray.js';
import { syncUI } from '../main.js';
import { exitIsolate, focusRegion } from './inspect.js';

function aspect() { const c = clearRect(); return Math.max(0.5, Math.min(2.6, (c.x1 - c.x0) / Math.max(1, c.y1 - c.y0))); }
function perBoneAmt() {
  const a = new Float32Array(S.n);
  for (const b of S.bones) a[b.i] = S.amt[S.regionIx.get(b.region)];
  return a;
}
// layout target for the present mode; visible bones only
function target() {
  const n = S.n, off = new Float32Array(n * 3), q = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) q[i * 4 + 3] = 1;
  let cat = null;
  if (S.mode === 'catalogue') {
    cat = L.catalogue(S.P, S.vis, S.regions, S.sort, aspect());
    off.set(cat.off); q.set(cat.q);
  } else {
    const a = perBoneAmt();
    (S.mode === 'regional' ? L.regional : L.radial)(S.P, a, 1, off);
    L.liftToFloor(S.P, off, S.vis);
  }
  return { off, q, cat };
}
export function exploded() { return S.mode === 'catalogue' || S.amt.some(x => x > 0); }
// start a transition from the bones as they are now to the new target
export function retarget(stagger, reverse = false, fit = true) {
  const t = target();
  S.from.off.set(S.cur.off); S.from.q.set(S.cur.q);
  S.to.off.set(t.off); S.to.q.set(t.q);
  S.cat = t.cat;
  const kind = S.mode === 'assembled' ? 'radial' : S.mode;
  if (stagger && !REDUCED) {
    let rank = null;
    if (S.mode === 'catalogue' && t.cat) {
      rank = new Float32Array(S.n);
      const order = S.bones.map(b => b.i).sort((a, c) => (t.off[a * 3 + 2] + S.bones[a].c[2]) - (t.off[c * 3 + 2] + S.bones[c].c[2]) || (t.off[a * 3] + S.bones[a].c[0]) - (t.off[c * 3] + S.bones[c].c[0]));
      order.forEach((i, k) => { rank[i] = k; });
    }
    S.delay.set(L.delays(S.P, kind, reverse, rank));
    S.tr = { t: 0, dur: 0.85, end: Math.max(...S.delay) + 0.85 };
  } else {
    S.delay.fill(0);
    S.tr = { t: 0, dur: REDUCED ? 0.01 : 0.22, end: REDUCED ? 0.01 : 0.22 };
  }
  setTraysOn(S.mode === 'catalogue');
  if (S.mode === 'catalogue' && t.cat) buildTrays(t.cat);
  fitShadow();
  if (fit && S.iso < 0) fitView(false, t.off);
  syncUI(); dirty();
}
export function setMode(m, opts = {}) {
  if (m === 'assembled') { reconstruct(); return; }
  const wasCat = S.mode === 'catalogue';
  S.mode = m;
  if (m !== 'catalogue') {
    S.lastMode = m;
    if (!S.amt.some(x => x > 0) || wasCat) S.amt.fill(S.amount || 1);
  }
  if (S.iso >= 0) exitIsolate(false);
  retarget(opts.stagger !== false);
}
export function explode() { setMode(S.lastMode || 'radial'); }
export function reconstruct() {
  if (S.iso >= 0) exitIsolate(false);
  if (S.mode === 'catalogue') S.mode = S.lastMode || 'radial';
  S.amt.fill(0);
  retarget(true, true);
}
export function setAmount(v) {
  S.amount = v;
  if (S.mode === 'catalogue') S.mode = S.lastMode;
  S.amt.fill(v);
  retarget(false, false, false);
}
export function toggleRegionExplode(rid) {
  const k = S.regionIx.get(rid);
  if (S.mode === 'catalogue') { S.mode = S.lastMode; S.amt.fill(0); }
  S.amt[k] = S.amt[k] > 0 ? 0 : Math.max(0.6, S.amount || 1);
  // the shared bones of a pair of regions read better together
  retarget(true, S.amt[k] === 0, false);
  focusRegion(rid);
}
