// ui/hud.js — Mandelbulber page: the HUD line, the peek line, the progress bar and the failure text.
//
// showHud writes the sample count, the time per sample and the status into the HUD, the
// peek bar of the phone sheet and the Image section of the panel. The status is a short
// flash message (2.5 s), else "compiling…", else the last engine status (compileStatus).
// fail shows a message in place of the canvas when the data or the renderer does not start.
//
// grep: let compileStatus  function setStatus  function flash  let msPerSample  function setMsPerSample
//       function showHud  function fail

import { $, stage, hud } from './dom.js';
import { engine, info, targetSamples } from './state.js';
import { progressEl, sampleLine } from './panel.js';
import { renderPaused } from './loop.js';

export let compileStatus = '';
let flashText = '', flashUntil = 0;
export function setStatus(s) { compileStatus = s; }

export function flash(s) { flashText = s; flashUntil = performance.now() + 2500; showHud(); }

export let msPerSample = 0;
export function setMsPerSample(v) { msPerSample = v; }

export function showHud() {
  const n = info?.samples ?? 0;
  // progress inside the running sample, shown when one sample takes long enough to notice
  const part = info && !info.done && n < targetSamples.value && info.sampleMs > 300 && info.progress > 0
    ? ` · sample ${n + 1}: ${Math.round(info.progress * 100)}%` : '';
  $('hudSamples').textContent = engine ? `${n} / ${targetSamples.value} spp${part}` : '';
  $('hudMs').textContent = engine && msPerSample ? `${msPerSample.toFixed(1)} ms/sample` : '';
  const st = performance.now() < flashUntil ? flashText : (info?.compiling ? 'compiling…' : compileStatus);
  $('hudStatus').textContent = st;
  hud.classList.toggle('err', /error|fail/i.test(st) || !!info?.stale);
  $('peekText').textContent = engine ? `${n} / ${targetSamples.value} spp${msPerSample ? ` · ${msPerSample.toFixed(0)} ms` : ''}${renderPaused() ? ' · paused' : ''}` : st;
  if (progressEl) {
    progressEl.firstChild.style.width = `${Math.min(100, 100 * (n + (part ? info.progress : 0)) / targetSamples.value)}%`;
    progressEl.classList.toggle('done', n >= targetSamples.value);
    sampleLine.textContent = engine
      ? `${n} of ${targetSamples.value} samples${part}${msPerSample ? ` · ${msPerSample.toFixed(1)} ms per sample` : ''}${info?.compiling ? ' · compiling' : ''}`
      : (compileStatus || 'no renderer');
  }
}

export function fail(msg) {
  stage.classList.add('nogpu');
  $('fallback').textContent = msg;
  compileStatus = msg;
  showHud();
}
