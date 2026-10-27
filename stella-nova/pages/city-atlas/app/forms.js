// ============================================================================
//  FORMS  ·  city-atlas/app/forms.js — HTML of the foot and the drawer
// ----------------------------------------------------------------------------
//  The parameter row and the note line of the foot, and the overlay settings
//  drawer (switches, sliders, segmented buttons), as strings from the city
//  meta m and the overlay state ov (app/state.js). No DOM: app/foot.js and
//  app/drawer.js put the strings in the page.
//
//  grep -n targets
//    one parameter ........ "export const param"
//    foot parameters ...... "export function paramsHTML"
//    foot note line ....... "export function notesHTML"
//    colour scale top ..... "export const windTop"
//    drawer controls ...... "export const sw"
//    drawer body .......... "export function layersHTML"
// ============================================================================

import { esc, fmt, compass, KNOTS } from './text.js';
import { currentSource } from './sources.js';

export const param = (v, label, extra = '') => `<div class="p"><span class="v">${v}</span>${extra}<small>${esc(label)}</small></div>`;

export function paramsHTML(m, ov) {
  const b = m.buildings;
  const parts = [param(`${fmt(b.count)}`, 'buildings'), param(`<i class="sym">h</i><sub>max</sub> = ${fmt(b.tallest)} m`, 'tallest')];
  if (ov.ocean.on && m.current) {
    parts.push(param('<i class="sym">t</i> = <span id="pTime"></span>', 'current data'));
    parts.push(param(`<i class="sym m1">u</i><sub>max</sub> = ${fmt(m.curMax * KNOTS, 1)} kn`, 'fastest water'));
  }
  if (ov.wind.on) parts.push(param(`<i class="sym">U</i> = ${fmt(ov.wind.speed, 1)} m/s ${compass(ov.wind.dirFrom)}`, ov.wind.live ? 'live wind' : 'wind'));
  if (ov.terrain.on) parts.push(param(`× ${fmt(ov.terrain.exag, 1)}`, 'relief'));
  return parts.join('');
}

export function notesHTML(m, ov) {
  const what = [];
  if (ov.terrain.on) what.push('real relief, sea floor in blue');
  if (ov.ocean.on) what.push(m.current ? 'streaks follow the surface current' : 'no current data here');
  if (ov.wind.on) what.push('streaks follow a simulated wind');
  if (!what.length) what.push('drag to orbit, pick an overlay below');
  const cs = currentSource(m);
  const src = ['© OpenStreetMap contributors · Overture Maps · ESA WorldCover'];
  if (ov.ocean.on && cs) src.push(cs.short);
  if (ov.wind.on && ov.wind.live) src.push('Open-Meteo');
  const line = what.join('; ');
  return `${esc(m.region)}. ${esc(line[0].toUpperCase() + line.slice(1))}.<span class="src">${esc(src.join(' · '))}</span>`;
}

// The top of the wind colour scale (m/s).
export const windTop = (ov) => Math.max(ov.wind.speed * 2.2, 2.5);

// ─── overlay settings drawer ────────────────────────────────────────────────
export const sw = (id, on, label) => `<button class="sw" id="${id}" type="button" role="switch" aria-checked="${on}" aria-label="${esc(label)}"></button>`;
const range = (id, label, min, max, step, val) =>
  `<label class="row"><span>${esc(label)}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}Out"></output></label>`;
const seg = (id, label, opts, cur) => `<div class="row two"><span>${esc(label)}</span><span class="seg" id="${id}">${opts.map(([v, t]) =>
  `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${esc(t)}</button>`).join('')}</span></div>`;
export const RAMP = 'linear-gradient(90deg, rgb(20,41,115), rgb(26,140,217) 25%, rgb(77,217,166) 50%, rgb(250,219,89) 75%, rgb(255,247,230))';

// lights: the light names of renderer.js LIGHTS.
export function layersHTML(ov, lights) {
  return `
  <section class="lg" data-k="terrain" id="lgTerrain">
    <h3>Terrain ${sw('swTerrain', ov.terrain.on, 'Terrain')}</h3>
    <p class="why">Real elevation and sea floor, draped and lit, with the buildings standing on it.</p>
    ${range('trExag', 'Exaggeration', 1, 6, 0.25, ov.terrain.exag)}
    <div class="row two"><span>Contours</span>${sw('swContour', ov.terrain.contour, 'Contour lines')}</div>
    <p class="src">Terrain Tiles on AWS (terrarium) · ESA WorldCover</p>
  </section>
  <section class="lg" data-k="ocean" id="lgOcean">
    <h3>Currents ${sw('swOcean', ov.ocean.on, 'Currents')}</h3>
    <p class="why" id="ocWhy"></p>
    ${range('ocTime', 'Time', 0, 48, 1, 0)}
    <div class="legend" id="ocLegend"></div><div class="ticks" id="ocTicks"></div>
    <p class="src" id="ocSrc"></p>
  </section>
  <section class="lg" data-k="wind" id="lgWind">
    <h3>Wind ${sw('swWind', ov.wind.on, 'Wind')}</h3>
    <p class="why">A simplified 2D flow simulation around the buildings and hills. Speeds are relative.</p>
    <div class="row two"><span>Live wind</span>${sw('swLive', ov.wind.live, 'Live wind from Open-Meteo')}</div>
    <div class="status" id="wdStatus"></div>
    ${range('wdDir', 'From', 0, 359, 1, ov.wind.dirFrom)}
    ${range('wdSpeed', 'Speed', 1, 20, 0.5, ov.wind.speed)}
    ${range('wdSlice', 'Slice height', 5, 150, 5, ov.wind.slice)}
    <div class="row two"><span>Speed map</span>${sw('swHeat', ov.wind.heat, 'Wind speed map')}</div>
    <div class="row two"><span>Sea breeze</span>${sw('swBreeze', ov.wind.seaBreeze, 'Sea breeze')}</div>
    <div class="legend" id="wdLegend"></div><div class="ticks" id="wdTicks"></div>
    <p class="src">Lattice Boltzmann D2Q9 on WebGPU · default wind: ERA5 2025 rose via Open-Meteo (CC BY 4.0)</p>
  </section>
  <section class="lg" data-k="view" id="lgView">
    <h3>View</h3>
    ${seg('vwLight', 'Light', lights.map((k) => [k, k[0].toUpperCase() + k.slice(1)]), ov.view.light)}
    ${seg('vwColour', 'Colour', [[2, 'Facade'], [0, 'Height'], [1, 'Use']], ov.view.colour)}
    <div class="row two"><span>Slow orbit</span>${sw('swOrbit', ov.view.orbit, 'Slow orbit when idle')}</div>
  </section>`;
}
