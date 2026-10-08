// ============================================================================
//  ROCHE LIMIT  ·  app/quality.js — canvas size and the Auto quality governor
// ----------------------------------------------------------------------------
//  resize() sizes the canvas to the pixel budget of the preset and the
//  render scale. governQuality() changes the scale, the bloom and the
//  step budget once a second.
//
//  grep -n targets
//    canvas size .... "function resize"
//    governor ....... "function governQuality"
//    preset ......... "function setQuality"
// ============================================================================
import { $, PHONE_Q, QUALITY, Q, UI, COARSE } from './env.js';
import { S } from './state.js';

export function resize() {
  if (!S.ren) return;
  const c = $('gpu');
  const dpr = Math.min(window.devicePixelRatio || 1, PHONE_Q.matches ? 1.5 : 2);
  let w = c.clientWidth * dpr, h = c.clientHeight * dpr;
  const maxPx = QUALITY[Q.preset].maxPx * Q.scale * Q.scale, k = Math.min(1, Math.sqrt(maxPx / (w * h)));
  w = Math.round(w * k); h = Math.round(h * k);
  c.width = w; c.height = h;
  S.ren.resize(w, h);
}
// The Auto quality governor, once a second: frames that run long (under
// 52 fps, or a GPU frame over 15 ms) lower the render scale by 10% (down
// to 60%), then switch off the bloom, then halve the steps per frame.
// Three good seconds (59 fps, GPU under 9 ms) step back up. A change waits
// 2 s for the next one.
export function governQuality(now) {
  const w = Q.win;
  if (!w.t0) { w.t0 = now; w.n = 0; }
  w.n++;
  if (now - w.t0 < 1000) return;
  const f = w.n * 1000 / (now - w.t0); w.t0 = now; w.n = 0;
  if (UI.quality !== 'auto' || now < Q.cool || S.saverOn && S.saver && S.saver.fade < 0.5) return;
  const slow = f < 52 || S.gpuMs > 15, good = f >= 59 && S.gpuMs < 9;
  w.good = good ? w.good + 1 : 0;
  if (slow) {
    if (Q.scale > 0.65) { Q.scale = Math.round((Q.scale - 0.1) * 10) / 10; resize(); }
    else if (Q.bloom) Q.bloom = false;
    else S.stepsMax = Math.max(8, S.stepsMax >> 1);
    Q.cool = now + 2000; Q.slowRuns = (Q.slowRuns || 0) + 1;
  } else if (w.good >= 3) {
    if (!Q.bloom && QUALITY[Q.preset].bloom) Q.bloom = true;
    else if (Q.scale < 1) { Q.scale = Math.min(1, Math.round((Q.scale + 0.1) * 10) / 10); resize(); }
    w.good = 0; Q.cool = now + 2000;
  }
}
// A quality preset: grain count (for the next run), pixel budget, bloom.
export function setQuality(name) {
  UI.quality = name;
  Q.preset = name === 'auto' ? ((PHONE_Q.matches || COARSE) ? 'low' : 'medium') : name;
  const P0 = QUALITY[Q.preset];
  Q.scale = 1; Q.bloom = P0.bloom; UI.N = P0.N; $('nSel').value = UI.N;
  resize();
}
