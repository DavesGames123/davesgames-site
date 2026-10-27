// main.js — City Atlas page: 3D city, plate text, overlays, atlas, saver.
//
// renderer.js draws the city into #map with WebGPU. worker.js loads each
// city file off the main thread. This file boots the page; the modules in
// app/ do the rest, one concern each:
//
//   state.js    shared state (S, ov, cam), timing constants, invalidate
//   dom.js      page elements, device class, session store, page mark
//   text.js     formats: escape, numbers, compass, coordinates, clock stamp
//   sources.js  dataset credits and the about sheet text
//   forms.js    HTML of the foot parameters, the note line and the drawer
//   view.js     harbour bearing, first view, contour step, ease
//   quality.js  quality levels, pixel budgets, governor rule
//   tour.js     saver shots, shader extracts, plate content
//   foot.js     head, foot, time bar, place labels
//   sheets.js   about sheet, atlas, drawer open/close, scrim, grip drag
//   drawer.js   overlay settings, wind to the solver, live wind (Open-Meteo)
//   controls.js city strip, chips, keys, idle fade, resize, URL hash
//   orbit.js    orbit camera input on the map
//   layout.js   canvas size, render scale, quality governor
//   loader.js   worker requests, GPU slots, idle preload
//   switch.js   the city switch with a short fade
//   loop.js     the frame loop, render on demand, WebGPU fallback
//   saver.js    the screensaver tour (window.snSaver)
//   debug.js    the debug handle (window.__cityAtlas)
//
//   Left / Right   previous / next city        Space   play / pause (clock and orbit)
//   T  C  W        terrain / currents / wind    L       overlay settings
//   M              atlas (city menu)            I       about sheet
//   Esc            close the open sheet         double-click   reset the view
//   Drag to orbit, wheel or pinch to zoom, right-drag or two fingers to pan.
//   #<id> in the URL picks a city.
//
// grep: async function start  function buildOverlay (app/foot.js)  function buildLayers (app/drawer.js)
//       function switchTo (app/switch.js)  function frame (app/loop.js)  function bindOrbit (app/orbit.js)
//       function liveWind (app/drawer.js)  function governor (app/layout.js)  window.snSaver (app/saver.js)

import { S, DEFAULT_ID } from './app/state.js';
import { $, canvas, device, storeGet, pageMark } from './app/dom.js';
import { buildLayers } from './app/drawer.js';
import { bindInput, syncControls, wake } from './app/controls.js';
import { relayout } from './app/layout.js';
import { requestCity } from './app/loader.js';
import { switchTo } from './app/switch.js';
import { frame, showFallback } from './app/loop.js';
import { installSaver } from './app/saver.js';
import { installDebug, bootLog } from './app/debug.js';

S.playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;

async function start() {
  bootLog.start = performance.now();
  const mark = pageMark();
  $('cat').textContent = mark.text;
  if (mark.color) document.documentElement.style.setProperty('--c', mark.color);
  bindInput();
  buildLayers();
  wake();
  const res = await fetch(new URL('data/index.json', import.meta.url));
  const cities = S.cities = await res.json();
  const want = location.hash.slice(1) || storeGet() || DEFAULT_ID;
  const at = (id) => cities.findIndex((c) => c.id === id);
  S.locIndex = at(want) >= 0 ? at(want) : Math.max(0, at(DEFAULT_ID));
  syncControls();
  S.worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
  requestCity(S.locIndex).catch(() => {});
  try {
    const mod = await import('./renderer.js');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.renderer = await mod.createRenderer(canvas, { mobile: device().phone, msaa: !device().phone && dpr < 1.5, timing: /[?&]gputime\b/.test(location.search) });
    bootLog.renderer = performance.now();
  } catch (err) {
    console.warn('city-atlas: WebGPU renderer unavailable', err?.message ?? err);
    S.renderer = null;
    showFallback();
  }
  relayout();
  await switchTo(S.locIndex, { initial: true });
  requestAnimationFrame(frame);
}

const started = start();
installSaver(started);
installDebug();
