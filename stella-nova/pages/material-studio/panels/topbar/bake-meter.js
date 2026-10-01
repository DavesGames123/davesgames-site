// ============================================================================
//  MATERIAL STUDIO  ·  panels/topbar/bake-meter.js — bake progress bar and bake time sparkline
// ────────────────────────────────────────────────────────────────────────────
//  meterStart and meterDone follow bake:start and bake:done. The last 24
//  bake times stay in localStorage and show as a sparkline.
//
//  GREP TARGETS
//      meter meterStart meterDone drawSpark
// ============================================================================
import { $ } from '../ctx.js';
import { lsGet, lsSet } from '../util.js';

export const meter = { t0: 0, hist: lsGet('bakeHist', []) };

export function meterStart() {
  meter.t0 = performance.now();
  meter.bar?.classList.add('busy'); meter.bar?.classList.remove('err');
  if (meter.bar) meter.bar.firstChild.style.width = '0%';
}
export function meterDone(maps) {
  const ms = maps && maps.ms != null ? maps.ms : performance.now() - meter.t0;
  meter.bar?.classList.remove('busy');
  if (meter.bar) meter.bar.firstChild.style.width = '100%';
  meter.hist.push(+ms.toFixed(1)); meter.hist = meter.hist.slice(-24); lsSet('bakeHist', meter.hist);
  const st = $('bake-status');
  if (st) {
    const a = meter.hist, avg = a.reduce((x, y) => x + y, 0) / a.length;
    st.title = `last ${ms.toFixed(1)} ms · avg ${avg.toFixed(1)} · min ${Math.min(...a).toFixed(1)} · max ${Math.max(...a).toFixed(1)} (${a.length} bakes)`;
  }
  drawSpark();
}
export function drawSpark() {
  const cv = meter.spark; if (!cv) return;
  const c = cv.getContext('2d'), a = meter.hist, W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  if (!a.length) return;
  const mx = Math.max(16, ...a);
  const bw = W / 24;
  a.forEach((v, i) => {
    const hh = Math.max(2, (v / mx) * (H - 2));
    c.fillStyle = v > 250 ? '#ff9a4a' : v > 60 ? '#ffc832' : '#64c864';
    c.globalAlpha = i === a.length - 1 ? 1 : 0.55;
    c.fillRect(W - (a.length - i) * bw + 1, H - hh, bw - 2, hh);
  });
  c.globalAlpha = 1;
}
