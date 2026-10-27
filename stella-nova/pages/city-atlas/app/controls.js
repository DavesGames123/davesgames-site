// ============================================================================
//  CONTROLS  ·  city-atlas/app/controls.js — buttons, keys and page events
// ----------------------------------------------------------------------------
//  The city strip (previous, atlas, next, play, settings, about), the chips,
//  the keys, the idle fade of the text, the touch guards, resize and the URL
//  hash. The orbit input on the map is app/orbit.js.
//
//    Left / Right   previous / next city        Space   play / pause (clock and orbit)
//    T  C  W        terrain / currents / wind    L       overlay settings
//    M              atlas (city menu)            I       about sheet
//    Esc            close the open sheet
//
//  grep -n targets
//    city strip text ...... "export function syncControls"
//    play / pause ......... "export function setPlaying"
//    next city ............ "export function step"
//    idle fade ............ "export function wake"
//    all bindings ......... "export function bindInput"
//    keys ................. "'keydown'"
//    tap while idle ....... "tapWhileIdle"
//    resize ............... "const onResize"
// ============================================================================

import { S, ov, IDLE_MS } from './state.js';
import { $, device, captionEl, atlasEl, layersEl, scrim, scrubEl } from './dom.js';
import { ICON_PAUSE, ICON_PLAY } from './text.js';
import { bindScrub } from './foot.js';
import { setCaption, setAtlas, setLayers, syncScrim, markAtlas, bindSheetDrag } from './sheets.js';
import { setOverlay } from './drawer.js';
import { bindOrbit } from './orbit.js';
import { relayout } from './layout.js';
import { switchTo } from './switch.js';

export function syncControls() {
  $('locName').textContent = S.cities[S.locIndex]?.title ?? '';
  $('locCount').textContent = `${S.locIndex + 1} / ${S.cities.length}`;
  const p = $('play');
  p.innerHTML = S.playing ? ICON_PAUSE : ICON_PLAY;
  p.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  markAtlas();
}
export function setPlaying(v) { S.playing = v; syncControls(); }
export function step(d) { switchTo((S.locIndex + d + S.cities.length) % S.cities.length); }

let idleTimer = 0;
export function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (atlasEl.hidden && layersEl.hidden) document.body.classList.add('idle'); }, IDLE_MS);
}

export function bindInput() {
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('play').addEventListener('click', () => setPlaying(!S.playing));
  $('info').addEventListener('click', () => setCaption(captionEl.hidden));
  $('where').addEventListener('click', () => setAtlas(atlasEl.hidden));
  $('layersBtn').addEventListener('click', () => setLayers(layersEl.hidden));
  $('chipTerrain').addEventListener('click', () => setOverlay('terrain', !ov.terrain.on));
  $('chipOcean').addEventListener('click', () => setOverlay('ocean', !ov.ocean.on));
  $('chipWind').addEventListener('click', () => setOverlay('wind', !ov.wind.on));
  bindScrub(scrubEl);
  $('capClose').addEventListener('click', () => setCaption(false));
  $('atlasClose').addEventListener('click', () => setAtlas(false));
  $('layersClose').addEventListener('click', () => setLayers(false));
  scrim.addEventListener('click', () => { setAtlas(false); setCaption(false); if (device().phone) setLayers(false); });
  bindSheetDrag(captionEl, $('capGrip'), () => setCaption(false));
  bindSheetDrag(atlasEl, $('atlasGrip'), () => setAtlas(false));
  bindSheetDrag(layersEl, $('layersGrip'), () => setLayers(false));

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input')) return;
    wake();
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === ' ' || e.code === 'Space') { if (e.target.closest?.('button')) return; e.preventDefault(); setPlaying(!S.playing); }
    else if (k === 'i') setCaption(captionEl.hidden);
    else if (k === 'm') setAtlas(atlasEl.hidden);
    else if (k === 'l') setLayers(layersEl.hidden);
    else if (k === 't') setOverlay('terrain', !ov.terrain.on);
    else if (k === 'c') setOverlay('ocean', !ov.ocean.on);
    else if (k === 'w') setOverlay('wind', !ov.wind.on);
    else if (e.key === 'Escape') { setCaption(false); setAtlas(false); setLayers(false); }
  });

  // a touch on the faded text first only wakes it, it does not press a button
  let tapWhileIdle = false;
  window.addEventListener('pointerdown', (e) => {
    tapWhileIdle = e.pointerType !== 'mouse' && document.body.classList.contains('idle');
  }, { capture: true, passive: true });
  for (const strip of [$('controls'), $('chips')]) {
    strip.addEventListener('click', (e) => {
      if (tapWhileIdle) { e.stopPropagation(); e.preventDefault(); tapWhileIdle = false; }
    }, { capture: true });
  }
  for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'wheel']) window.addEventListener(ev, wake, { passive: true });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => {
    const inSheet = captionEl.contains(e.target) || atlasEl.contains(e.target) || layersEl.contains(e.target);
    if (!inSheet) e.preventDefault();
  }, { passive: false });

  let rz = 0;
  const onResize = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { relayout(); syncScrim(); }); };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  window.addEventListener('hashchange', () => {
    const i = S.cities.findIndex((c) => c.id === location.hash.slice(1));
    if (i >= 0 && i !== S.locIndex) switchTo(i);
  });
  document.addEventListener('visibilitychange', () => { S.lastT = null; });
  bindOrbit();
}
