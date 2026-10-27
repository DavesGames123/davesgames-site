// ============================================================================
//  DRAWER  ·  city-atlas/app/drawer.js — the overlay settings and live wind
// ----------------------------------------------------------------------------
//  The overlay settings drawer: terrain, currents, wind and view groups,
//  their switches and sliders, and the state they write (app/state.js ov).
//  syncLayers puts ov back into the drawer and the foot chips. The live
//  wind comes from Open-Meteo. app/forms.js makes the drawer HTML.
//
//  grep -n targets
//    drawer events ........ "export function buildLayers"
//    drawer from state .... "export function syncLayers"
//    wind status line ..... "export function setWindStatus"
//    overlay on/off ....... "export function setOverlay"
//    wind to the solver ... "export function pushWind"
//    live wind ............ "export async function liveWind"
// ============================================================================

import { LIGHTS } from '../renderer.js';
import { S, ov, lastHour, invalidate } from './state.js';
import { $ } from './dom.js';
import { fmt, compass, clamp, KNOTS } from './text.js';
import { currentSource } from './sources.js';
import { windTop, layersHTML, RAMP } from './forms.js';
import { fillParams, updateClockUI } from './foot.js';

export function buildLayers() {
  const body = $('layersBody');
  body.innerHTML = layersHTML(ov, Object.keys(LIGHTS));
  $('ocLegend').style.background = RAMP;
  $('wdLegend').style.background = RAMP;
  const onSw = (id, fn) => $(id).addEventListener('click', (e) => {
    const b = e.currentTarget;
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    fn(v);
    invalidate(3);
  });
  onSw('swTerrain', (v) => setOverlay('terrain', v));
  onSw('swOcean', (v) => setOverlay('ocean', v));
  onSw('swWind', (v) => setOverlay('wind', v));
  onSw('swContour', (v) => { ov.terrain.contour = v; });
  onSw('swHeat', (v) => { ov.wind.heat = v; });
  onSw('swBreeze', (v) => { ov.wind.seaBreeze = v; pushWind(); });
  onSw('swOrbit', (v) => { ov.view.orbit = v; });
  onSw('swLive', (v) => { ov.wind.live = v; if (v) liveWind(); else { setWindStatus(''); syncLayers(); } fillParams(); });
  $('trExag').addEventListener('input', (e) => { ov.terrain.exag = +e.target.value; syncLayers(); fillParams(); });
  $('ocTime').addEventListener('input', (e) => { S.hour = +e.target.value; updateClockUI(true); });
  let dirT = 0;
  $('wdDir').addEventListener('input', (e) => {
    ov.wind.dirFrom = +e.target.value; ov.wind.live = false; $('swLive').setAttribute('aria-checked', 'false');
    syncLayers(); clearTimeout(dirT); dirT = setTimeout(pushWind, 160); fillParams();
  });
  $('wdSpeed').addEventListener('input', (e) => {
    ov.wind.speed = +e.target.value; ov.wind.live = false; $('swLive').setAttribute('aria-checked', 'false');
    syncLayers(); pushWind(); fillParams();
  });
  let sliceT = 0;
  $('wdSlice').addEventListener('input', (e) => { ov.wind.slice = +e.target.value; syncLayers(); clearTimeout(sliceT); sliceT = setTimeout(pushWind, 160); });
  for (const id of ['vwLight', 'vwColour']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (id === 'vwLight') ov.view.light = b.dataset.v; else ov.view.colour = +b.dataset.v;
      syncLayers();
    });
  }
  syncLayers();
}

export function syncLayers() {
  invalidate(3);
  if (!$('lgTerrain')) return;
  const meta = S.meta;
  const set = (id, v) => { const b = $(id); if (b) b.setAttribute('aria-checked', String(!!v)); };
  set('swTerrain', ov.terrain.on); set('swOcean', ov.ocean.on); set('swWind', ov.wind.on);
  set('swContour', ov.terrain.contour); set('swHeat', ov.wind.heat); set('swBreeze', ov.wind.seaBreeze);
  set('swOrbit', ov.view.orbit); set('swLive', ov.wind.live);
  $('lgTerrain').classList.toggle('on', ov.terrain.on);
  $('lgOcean').classList.toggle('on', ov.ocean.on);
  $('lgWind').classList.toggle('on', ov.wind.on);
  $('trExag').value = String(ov.terrain.exag);
  $('trExagOut').textContent = `× ${fmt(ov.terrain.exag, 2)}`;
  $('wdDir').value = String(Math.round(ov.wind.dirFrom));
  $('wdDirOut').textContent = `${Math.round(ov.wind.dirFrom)}° ${compass(ov.wind.dirFrom)}`;
  $('wdSpeed').value = String(ov.wind.speed);
  $('wdSpeedOut').textContent = `${fmt(ov.wind.speed, 1)} m/s`;
  $('wdSlice').value = String(ov.wind.slice);
  $('wdSliceOut').textContent = `${ov.wind.slice} m`;
  const top = windTop(ov);
  $('wdTicks').innerHTML = `<span>0</span><span>${fmt(top / 4, 1)}</span><span>${fmt(top, 1)} m/s</span>`;   // square-root scale
  for (const id of ['vwLight', 'vwColour']) {
    const cur = id === 'vwLight' ? ov.view.light : ov.view.colour;
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(cur)));
  }
  if (meta) {
    const has = !!meta.current;
    $('swOcean').disabled = !has;
    $('ocTime').disabled = !has;
    $('ocTime').max = String(lastHour());
    const cs = currentSource(meta);
    $('ocWhy').textContent = has ? 'Two days of hourly surface currents as streaks on the water. Brighter is faster.' : 'No open ocean model in this atlas covers the water here.';
    $('ocSrc').textContent = cs ? cs.short : '';
    const t = meta.curTop || 0.5;
    $('ocTicks').innerHTML = has ? `<span>0</span><span>${fmt(t / 2, 2)}</span><span>${fmt(t, 2)} m/s · ${fmt(t * KNOTS, 1)} kn</span>` : '';
  }
  for (const [k, id] of [['terrain', 'chipTerrain'], ['ocean', 'chipOcean'], ['wind', 'chipWind']]) $(id).setAttribute('aria-pressed', String(ov[k].on));
  $('chipOcean').disabled = !!meta && !meta.current;
}

export function setWindStatus(text, err = false) {
  const s = $('wdStatus');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('err', err);
}

export function setOverlay(k, v) {
  if (k === 'ocean' && v && S.meta && !S.meta.current) v = false;
  ov[k].on = v;
  if (k === 'wind' && v) pushWind();
  syncLayers();
  fillParams();
}

export function pushWind() {
  S.renderer?.setWind({ dirFrom: ov.wind.dirFrom, speed: ov.wind.speed, slice: ov.wind.slice, seaBreeze: ov.wind.seaBreeze ? 1 : 0 });
  invalidate(3);
}

// LIVE WIND. Open-Meteo forecast API, current 10 m wind. CORS, no key, CC BY 4.0.
// A city's answer is kept for 10 minutes.
const liveCache = new Map();
export async function liveWind() {
  const meta = S.meta;
  if (!meta) return;
  const id = meta.id;
  setWindStatus('Fetching the current wind…');
  try {
    let r = liveCache.get(id);
    if (!r || Date.now() - r.at > 10 * 60e3) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${meta.lat}&longitude=${meta.lon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      r = { at: Date.now(), speed: j.current.wind_speed_10m, dir: j.current.wind_direction_10m, time: j.current.time };
      liveCache.set(id, r);
    }
    if (!ov.wind.live || S.meta.id !== id) return;
    ov.wind.dirFrom = Math.round(r.dir);
    ov.wind.speed = clamp(Math.round(r.speed * 2) / 2, 1, 20);
    ov.wind.liveInfo = r;
    setWindStatus(`Now: ${fmt(r.speed, 1)} m/s from ${compass(r.dir)} (${Math.round(r.dir)}°), ${r.time.replace('T', ' ')} UTC · Open-Meteo`);
    pushWind();
  } catch (err) {
    ov.wind.live = false;
    setWindStatus(`Live wind not available (${err.message}). The wind stays at the setting.`, true);
  }
  syncLayers();
  fillParams();
}
