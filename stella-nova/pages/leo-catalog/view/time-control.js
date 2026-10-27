// ============================================================================
//  LEO CATALOG  ·  view/time-control.js — sim clock UI: scrub, transport, rate
// ----------------------------------------------------------------------------
//  The bottom time bar. All of it reads and writes the SIM clock object that
//  main.js owns (time, base, range, speed, playing).
//    #slider        log-scale scrub around NOW (core/format.js); a drag
//                   pauses playback
//    #btn-play      play / pause; #btn-now recentres on now; #btn-rewind
//                   steps one day back
//    #rate-slider   SIM.speed = 0.1 x 10^(6 frac), 0.1x .. 100000x
//    readouts       #tc-time (with the delta from NOW), #mobile-time and
//                   #stat-time-pill, written by showTime() after each render
//
//  grep -n targets: "export function initTimeControl", "function dragSlider",
//  "function setTransport", "function setSliderPos", "export function applyRate",
//  "export function advanceClock", "export function showTime"
// ============================================================================
import { fmtTime, fmtDelta, fmtRate, fracToOffsetMs, offsetMsToFrac, rateFracToSpeed, rateSpeedToFrac } from '../core/format.js';

let SIM = null;
const slider = document.getElementById('slider');
const sliderHandle = document.getElementById('slider-handle');
const tcTime = document.getElementById('tc-time');
const mobileTime = document.getElementById('mobile-time');
export const btnPlay = document.getElementById('btn-play');
export const btnNow = document.getElementById('btn-now');
const btnRewind = document.getElementById('btn-rewind');
const rateSlider = document.getElementById('rate-slider');
const rateHandle = document.getElementById('rate-slider-handle');
const rateValue  = document.getElementById('rate-value');
const statTimePill = document.getElementById('stat-time-pill');

// Pointer drag on a slider track: onX(clientX) on press and on each move
// while pressed; onDown runs first on the press. Returns the pressed state.
function dragSlider(el, onX, onDown) {
  let dragging = false;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    if (onDown) onDown();
    onX(e.clientX);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => { if (dragging) onX(e.clientX); });
  el.addEventListener('pointerup', (e) => {
    dragging = false;
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
  });
  return () => dragging;
}
// Fraction of a track under clientX, unclamped.
const trackFrac = (el, x) => { const rect = el.getBoundingClientRect(); return (x - rect.left) / rect.width; };

// Show the transport state: the play button class and icon, and the
// scrubbing style on the time readout while paused.
function setTransport(playing, icon) {
  btnPlay.classList.toggle('playing', playing);
  btnPlay.innerHTML = icon;
  tcTime.classList.toggle('scrubbing', !playing);
}

// Move the time handle to pointer x and set SIM.time from the log-scale mapping.
function setSliderPos(x) {
  const frac = Math.max(0, Math.min(1, trackFrac(slider, x)));
  sliderHandle.style.left = (frac * 100) + '%';
  SIM.time = new Date(SIM.base.getTime() + fracToOffsetMs(frac, SIM.range));
}

// Apply a rate-slider fraction: set SIM.speed, move the handle, update the label.
export function applyRate(frac) {
  frac = Math.max(0, Math.min(1, frac));
  SIM.speed = rateFracToSpeed(frac);
  rateHandle.style.left = (frac * 100) + '%';
  rateValue.textContent = fmtRate(SIM.speed);
}

let sliderDragging = () => false;
// Wire the time bar to the SIM clock and show the default rate (3x).
export function initTimeControl(sim) {
  SIM = sim;
  // Time slider drag: pause playback and scrub SIM.time as the handle moves.
  sliderDragging = dragSlider(slider, setSliderPos, () => {
    SIM.playing = false;
    setTransport(false, '&#x25B6;');
  });
  // Transport buttons: play/pause, jump to NOW (recentre), and rewind one day.
  btnPlay.addEventListener('click', () => {
    SIM.playing = !SIM.playing;
    setTransport(SIM.playing, SIM.playing ? '&#x25B6;' : '&#x23F8;');
  });
  btnNow.addEventListener('click', () => {
    SIM.base = new Date();
    SIM.time = new Date(SIM.base);
    sliderHandle.style.left = '50%';
    SIM.playing = true;
    setTransport(true, '&#x25B6;');
  });
  btnRewind.addEventListener('click', () => {
    SIM.time = new Date(SIM.time.getTime() - 86400000);
    const offset = SIM.time.getTime() - SIM.base.getTime();
    const frac = offsetMsToFrac(offset, SIM.range);
    sliderHandle.style.left = (Math.max(0, Math.min(1, frac)) * 100) + '%';
  });
  applyRate(rateSpeedToFrac(SIM.speed)); // init from default SIM.speed (3×)
  // Rate slider drag: set playback speed from the pointer x.
  dragSlider(rateSlider, x => applyRate(trackFrac(rateSlider, x)));
}

// Per frame, before the render: run the clock dt ms of real time at
// SIM.speed, and move the time handle unless the user holds it.
export function advanceClock(dt) {
  if (!SIM.playing) return;
  SIM.time = new Date(SIM.time.getTime() + dt * SIM.speed);
  if (!sliderDragging()) {
    const offset = SIM.time.getTime() - SIM.base.getTime();
    const frac = offsetMsToFrac(offset, SIM.range);
    sliderHandle.style.left = (frac * 100) + '%';
  }
}

// Per frame, after the render: write the time readouts.
export function showTime() {
  const t = fmtTime(SIM.time);
  const delta = SIM.time.getTime() - SIM.base.getTime();
  tcTime.innerHTML = `${t}<span class="delta">${fmtDelta(delta)}</span>`;
  mobileTime.textContent = t;
  if (statTimePill) statTimePill.textContent = t;
}
