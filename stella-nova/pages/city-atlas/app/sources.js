// ============================================================================
//  SOURCES  ·  city-atlas/app/sources.js — credits and the about sheet text
// ----------------------------------------------------------------------------
//  Who made each dataset and under what terms. The foot line, the overlay
//  groups and the about sheet read these, so they cannot disagree. Each
//  function takes the city meta and returns text or HTML. No DOM.
//
//  grep -n targets
//    current credits ...... "export function currentSource"
//    credits section ...... "export function sourcesHTML"
//    about sheet body ..... "export function captionHTML"
// ============================================================================

import { esc, LINK, fmt, compass, stamp, hoursOf, KNOTS } from './text.js';

// { short, html } of the current models of city meta m, or null.
export function currentSource(m) {
  const c = m?.current;
  if (!c) return null;
  const parts = [];
  if (c.tidal) {
    if (c.tidal.agency === 'Marine Institute') parts.push({ short: 'Marine Institute NEATL · CC BY 4.0', html: `Currents near the city: ${esc(c.tidal.modelLong || 'Marine Institute NEATL')}, © Irish Marine Institute, ${LINK('https://erddap.marine.ie/erddap/griddap/IMI_NEATL.html', 'Marine Institute ERDDAP')}, ${LINK('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}. Changes: hourly surface currents resampled to this map's grid.` });
    else parts.push({ short: `NOAA ${c.tidal.model} · public domain`, html: `Currents near the city: ${esc(c.tidal.modelLong || 'NOAA ' + c.tidal.model)}, ${LINK('https://tidesandcurrents.noaa.gov/models.html', 'NOAA NOS CO-OPS')}. U.S. Government work, public domain.` });
  }
  if (c.sources.includes('HYCOM')) parts.push({ short: 'HYCOM ESPC-D-V02', html: `${c.tidal ? 'Currents offshore' : 'Currents'}: Navy ESPC-D-V02 global HYCOM analysis, 1/12° (cells of about 4 to 9 km), hourly surface velocity, from ${LINK('https://www.hycom.org/dataserver/espc-d-v02', 'HYCOM.org')} (U.S. Navy, FNMOC; freely available). It resolves the regional current and the tide, not the harbour channels; near the coast its field is carried a short way into the harbour and fades out over 3 km.` });
  return { short: parts.map((p) => p.short).join(' + '), html: parts.map((p) => `<li>${p.html}</li>`).join('') };
}

export function sourcesHTML(m) {
  const items = [];
  items.push(`<li>Buildings, water and place names: ${LINK('https://overturemaps.org/', 'Overture Maps Foundation')} release 2026-09-23.1, ${LINK('https://opendatacommons.org/licenses/odbl/1-0/', 'ODbL 1.0')}. Includes © ${LINK('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors')} and the other sources that ${LINK('https://docs.overturemaps.org/attribution/', 'Overture lists')}. The building and water data of this page are a derived database under the same licence.</li>`);
  items.push(`<li>Land cover: © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover consortium, ${LINK('https://esa-worldcover.org/', 'esa-worldcover.org')}, ${LINK('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}.</li>`);
  items.push(`<li>Elevation and sea floor: ${LINK('https://registry.opendata.aws/terrain-tiles/', 'Terrain Tiles on AWS')} (Mapzen terrarium). United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey. Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration. Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers. United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved. Canada terrain data contains information licensed under the Open Government Licence – Canada. Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017. Full list: ${LINK('https://github.com/tilezen/joerd/blob/master/docs/attribution.md', 'terrain tile attribution')}.</li>`);
  const cs = currentSource(m);
  if (cs) items.push(cs.html);
  items.push(`<li>Default wind (2025 wind rose): ERA5 reanalysis via the ${LINK('https://open-meteo.com/', 'Open-Meteo')} historical API. Live wind: Open-Meteo forecast API. Weather data by Open-Meteo.com, ${LINK('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}.</li>`);
  items.push(`<li>Idea: ${LINK('https://github.com/opengeos/GeoLibre', 'GeoLibre')} by Qiusheng Wu (opengeos, MIT), which shows open buildings and terrarium terrain in the browser. This page uses none of its code.</li>`);
  items.push('<li>Renderer, wind solver, current streaks and design: Dave, for Stella Nova.</li>');
  return `<section id="capCredits" class="credits"><h3>Credits and licences</h3><ul>${items.join('')}</ul></section>`;
}

export function captionHTML(m) {
  const b = m.buildings, w = m.wind;
  const paras = [`<p>${esc(m.blurb)}</p>`];
  const facts = [
    ['Buildings in the disc', `${fmt(b.count)} (radius ${fmt(m.r, 1)} km)`],
    ['With a mapped height', `${fmt(100 * b.tagged / Math.max(1, b.count))} %`],
    ['Tallest (mapped)', `${fmt(b.tallest)} m`],
    ['Over 100 m', fmt(b.over100)],
    ['Highest ground (12 km square)', `${fmt(m.terrain.max)} m`],
    ['Deepest water (64 km square)', `${fmt(-Math.min(0, m.terrain.deepest))} m`],
    ['Prevailing wind, 2025', `from ${compass(w.prevail.dir)}, mean ${fmt(w.mean, 1)} m/s`],
  ];
  if (m.current) facts.push(['Fastest surface water', `${fmt(m.curMax * KNOTS, 1)} kn (${fmt(m.curMax, 2)} m/s)`]);
  paras.push(`<div class="facts">${facts.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`);
  paras.push('<p><b>Buildings</b> stand on their real footprints and heights. Their roofs, floors, windows and materials are made up by the page from the footprint, the height and the use alone (gable and hip roofs on small rectangles, parapets and rooftop plant on flat roofs, tiers on some towers), so they show the kind of building, not the real facade. Colour: Facade shows the materials; Height and Use colour the walls by those instead.</p>');
  paras.push('<h3 class="sub">The overlays</h3>');
  paras.push('<p><b>Terrain</b> lifts the ground and the sea floor to their real heights, with a vertical exaggeration. Land shows contour lines; water is darker where it is deeper, and the relief of the sea floor shows through it.</p>');
  paras.push(m.current
    ? `<p><b>Currents</b> plays two days of hourly surface currents (${esc(stamp(m, 0))} to ${esc(stamp(m, hoursOf(m)))}). Each streak moves along the current; brighter and yellower is faster. The streak speed on screen is compressed (it grows with the 0.6 power of the real speed), so slack water still moves.</p>`
    : '<p><b>Currents</b>: no open ocean model in this atlas covers the water here, so this overlay is off for this city.</p>');
  paras.push(`<p><b>Wind</b> is a simplified simulation, not a forecast. Two nested 2D lattice Boltzmann solvers run on your GPU: a coarse one over 12 km, where hills higher than about ${fmt((m.groundRef || 0) + 160)} m are walls and the land and the city add drag, and a fine one over the buildings (cells of about ${fmt(2 * m.fHalf / 640)} m), where every building taller than the slice height is a wall. The fine solver takes its inflow from the coarse one. It shows channelling along streets, wakes and vortex shedding behind towers, and the slower wind over the city than over water. It has no vertical motion and no heat, and its Reynolds number is far below the real one, so the speeds are only relative. The optional sea breeze adds a weak push from the sea toward the land.</p>`);
  paras.push('<h3 class="sub">Controls</h3><p>Drag to orbit. Wheel or pinch to zoom. Right-drag or two fingers to pan. Double-click to reset. Keys: T, C and W turn the overlays on and off; L opens their settings; Left and Right change the city.</p>');
  paras.push(sourcesHTML(m));
  return paras.join('');
}
