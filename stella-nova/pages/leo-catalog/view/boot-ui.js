// ============================================================================
//  LEO CATALOG  ·  view/boot-ui.js — boot log, acquisition strip, load rows
// ----------------------------------------------------------------------------
//  The DOM that reports boot progress. No three.js, no catalog state: main.js
//  calls in with text, percentages and counts.
//    #splash-lines  the title card log (last 3 lines)
//    #acq           the strip at the top: a segment per TLE group, an object
//                   counter, the latest log line, one chip per subsystem
//                   (GEO, CAT, STM, WND, STR)
//    #load-rows     the persistent load-status panel, one row per group;
//                   each row change is mirrored into its strip segment
//    #stat-status   the status readout
//  tweenNumber and playIntro run on requestAnimationFrame; both skip the
//  animation under prefers-reduced-motion.
//
//  grep -n targets: "export function splash", "export function setGauge",
//  "function acqSegAdd", "function catalogGaugeRecompute",
//  "export function tweenNumber", "export function retrigger",
//  "export function playIntro", "export function showStrip",
//  "export function finishAcquisition", "export function setStatus",
//  "export function addLoadRow", "export function setLoadStatus"
// ============================================================================
// Boot has two surfaces. #splash is a short title card over the scene; it
// lifts as soon as the Earth map is ready (see revealScene). #acq is the strip
// at the top that stays up while TLE groups land on the visible globe: one
// segment per group, an object counter, the latest log line, and one chip per
// subsystem (GEO, CAT, STM, WND, STR).
export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const splashLines = document.getElementById('splash-lines');
const acqEl      = document.getElementById('acq');
const acqLine    = document.getElementById('acq-line');
const acqSegsEl  = document.getElementById('acq-segs');
export const acqCountEl = document.getElementById('acq-count');
const acqTitle   = document.getElementById('acq-title');

// Log one boot line: append it to the splash log (last 3 kept) and make it the
// strip's current line, re-running the strip's line-in animation.
export function splash(msg, cls = '') {
  if (splashLines && splashLines.isConnected) {
    const div = document.createElement('div');
    div.className = 'ln ' + cls;
    div.textContent = msg;
    splashLines.appendChild(div);
    while (splashLines.childElementCount > 3) splashLines.firstChild.remove();
  }
  if (acqLine) {
    acqLine.textContent = msg;
    acqLine.className = 'acq-line ' + cls;
    void acqLine.offsetWidth;
    acqLine.classList.add('in');
  }
}

// Subsystem chips. pct > 0 marks the chip busy; {done} or {fail} marks the
// finish. Callers pass percentages from when these were dial gauges; only the
// state is shown now.
export function setGauge(name, pct, state) {
  const el = acqEl && acqEl.querySelector(`[data-sys="${name}"]`);
  if (!el) return;
  const st = state && state.fail ? 'fail' : state && state.done ? 'ok' : pct > 0 ? 'busy' : 'idle';
  if (el.dataset.state !== st) el.dataset.state = st;
}

// Group segments, mirrored from the load-status panel by addLoadRow and
// setLoadStatus. The CAT chip is done when every segment is ok or fail.
const acqSegs = new Map(); // group → element
function acqSegAdd(group) {
  if (!acqSegsEl || acqSegs.has(group)) return;
  const seg = document.createElement('span');
  seg.className = 'seg loading';
  seg.title = group;
  seg.style.setProperty('--i', acqSegs.size);
  acqSegsEl.appendChild(seg);
  acqSegs.set(group, seg);
  catalogGaugeRecompute();
}
function acqSegSet(group, status) {
  const seg = acqSegs.get(group);
  if (!seg) return;
  seg.className = 'seg ' + status;
  catalogGaugeRecompute();
}
function catalogGaugeRecompute() {
  let done = 0;
  acqSegs.forEach(s => { if (s.classList.contains('ok') || s.classList.contains('fail')) done++; });
  setGauge('catalog', acqSegs.size ? 1 + 99 * done / acqSegs.size : 0,
           acqSegs.size && done === acqSegs.size ? { done: true } : null);
}

// Count a number element up (or down) to target over ~0.7 s with an ease-out
// curve. A new call on the same element takes over from the shown value.
const tweens = new Map(); // element → { from, to, t0 }
export function tweenNumber(el, to) {
  if (!el) return;
  const shown = Number(String(el.textContent).replace(/[^0-9]/g, '')) || 0;
  if (REDUCED_MOTION || shown === to) { el.textContent = to.toLocaleString(); return; }
  const had = tweens.size > 0;
  tweens.set(el, { from: shown, to, t0: performance.now() });
  if (!had) requestAnimationFrame(stepTweens);
}
function stepTweens(now) {
  tweens.forEach((tw, el) => {
    const k = Math.min(1, (now - tw.t0) / 700);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(tw.from + (tw.to - tw.from) * e).toLocaleString();
    if (k >= 1) tweens.delete(el);
  });
  if (tweens.size) requestAnimationFrame(stepTweens);
}

// Re-run a one-shot CSS animation class on an element.
export function retrigger(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Resolve the splash logo from random glyphs to its text, left to right, over
// ~0.9 s. Resolves when the minimum title-card time has passed.
export function playIntro() {
  const logo = document.getElementById('splash-logo');
  const MIN_MS = REDUCED_MOTION ? 200 : 1500;
  if (logo && !REDUCED_MOTION) {
    const final = logo.textContent;
    const GLYPHS = '<>/\\|#*+=01';
    const t0 = performance.now();
    const step = (now) => {
      const k = (now - t0) / 900;
      let out = '';
      for (let i = 0; i < final.length; i++) {
        const lockAt = (i + 1) / final.length;
        out += (final[i] === ' ' || k >= lockAt) ? final[i]
             : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      logo.textContent = out;
      if (k < 1) requestAnimationFrame(step);
      else logo.textContent = final;
    };
    requestAnimationFrame(step);
  }
  return new Promise(r => setTimeout(r, MIN_MS));
}

// Power on the strip when the title card lifts.
export function showStrip() { if (acqEl) acqEl.classList.add('on'); }

// Close the strip: flash it green, then slide it away. count is the catalog
// size; ping runs at the flash (the globe ring).
export function finishAcquisition(count, ping) {
  if (!acqEl) return;
  acqTitle.textContent = count ? 'CATALOG NOMINAL' : 'CATALOG OFFLINE';
  acqEl.classList.add('done');
  ping();
  setTimeout(() => acqEl.classList.add('off'), 2600);
}

// Set the status readout text and colour class.
const statusEl = document.getElementById('stat-status');
export function setStatus(text, cls) { statusEl.className = cls; statusEl.innerHTML = text; }

// Load-status panel: a persistent row per TLE group showing load/ok/fail/retry
// and the object count, mirrored into the #acq strip segments.
const loadRowsEl = document.getElementById('load-rows');
const loadDotEl  = document.getElementById('load-dot');
const loadRows = new Map();
export function addLoadRow(group) {
  const row = document.createElement('div');
  row.className = 'load-row lr-in';
  row.style.setProperty('--i', loadRows.size);
  row.innerHTML =
    `<span class="lr-name">${group}</span>` +
    `<span class="lr-status loading">load</span>` +
    `<span class="lr-count">—</span>`;
  loadRowsEl.appendChild(row);
  loadRows.set(group, row);
  acqSegAdd(group); // strip mirror
}
export function setLoadStatus(group, status, count) {
  const row = loadRows.get(group);
  if (!row) return;
  const st = row.querySelector('.lr-status');
  const cn = row.querySelector('.lr-count');
  st.className = 'lr-status ' + status;
  st.textContent = status;
  if (count !== undefined) cn.textContent = `+${count.toLocaleString()}`;
  retrigger(row, 'lr-flash');
  acqSegSet(group, status);
}
export const hasLoadRow = group => loadRows.has(group);
export function stopLoadDot() { if (loadDotEl) loadDotEl.style.animation = 'none'; }
