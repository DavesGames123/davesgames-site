#!/usr/bin/env node
// WEATHER MAP · tools/snapshot.mjs — writes the committed fallback data in
// data/sample/. The page loaders read these files when a live source
// fails, and tests/data.test.mjs uses the bulletins as fixtures.
//
// Run from anywhere: node stella-nova/pages/weather-map/tools/snapshot.mjs
// It makes 9 requests: 2 NWS product lists, 4 NWS bulletins, 1 Open-Meteo
// grid (420 locations), 1 Open-Meteo current call (one location per
// city), 1 Open-Meteo forecast, 1 RainViewer list. The User-Agent is the
// site name only, never a personal email.
//
// Output files:
//   asus01.txt    newest analysis bulletin (low-res positions)
//   asus02.txt    newest analysis bulletin (hi-res positions)
//   fsus02-a.txt  newest forecast bulletin
//   fsus02-b.txt  second newest forecast bulletin (the other prog pair)
//   grid.json     packGrid() output
//   current.json  { fetched, byId } for CITIES
//   forecast.json { place, response } raw Open-Meteo forecast for one city
//   radar.json    RainViewer frame list (paths expire; reference only)
//   manifest.json file names, fetch time, byte sizes

import { writeFile, stat } from 'node:fs/promises';
import { API, pickNewest, parseCodsus, parseCodsusAll } from '../data/fronts.js';
import { loadGridLive, packGrid } from '../data/grid.js';
import { currentUrl, parseCurrent } from '../data/now.js';
import { forecastUrl, parseForecast } from '../data/forecast.js';
import { RADAR_URL, parseRadarList } from '../data/radar.js';
import { CITIES, CITY_BY_ID } from '../data/cities.js';
import { fetchJSON, fetchText } from '../data/net.js';

const OUT = new URL('../data/sample/', import.meta.url);
const opts = { headers: { 'User-Agent': 'davesgames.io weather-map', Accept: 'application/json' } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const put = (name, text) => writeFile(new URL(name, OUT), text);

async function bulletin(id) {
  const p = await fetchJSON(`${API}/products/${id}`, opts);
  await wait(400);
  return p.productText;
}

const made = Date.now();
const manifest = { made, source: {}, fronts: { analysis: 'asus01.txt', hires: 'asus02.txt', forecasts: [] } };

// Fronts
const sus = await fetchJSON(`${API}/products/types/COD/locations/SUS`, opts); await wait(400);
const srp = await fetchJSON(`${API}/products/types/COD/locations/SRP`, opts); await wait(400);
const a1 = pickNewest(sus, 'ASUS01')[0], a2 = pickNewest(sus, 'ASUS02')[0], fs = pickNewest(srp, 'FSUS02', 2);
await put('asus01.txt', await bulletin(a1.id));
await put('asus02.txt', await bulletin(a2.id));
for (const [k, f] of fs.entries()) {
  const name = `fsus02-${'ab'[k]}.txt`;
  await put(name, await bulletin(f.id));
  manifest.fronts.forecasts.push(name);
}
manifest.source.fronts = { asus01: a1.issuanceTime, asus02: a2.issuanceTime, fsus02: fs.map(f => f.issuanceTime) };

// Grid
const g = await loadGridLive(opts); await wait(1500);
await put('grid.json', JSON.stringify(packGrid(g)));
manifest.grid = 'grid.json';

// Current conditions
const cur = parseCurrent(await fetchJSON(currentUrl(CITIES), { ...opts, timeout: 30000 }), CITIES); await wait(1000);
await put('current.json', JSON.stringify({ fetched: made, byId: cur }));
manifest.current = 'current.json';

// One full forecast
const kc = CITY_BY_ID.get('kc');
const fj = await fetchJSON(forecastUrl(kc.lat, kc.lon, kc.tz), opts); await wait(400);
parseForecast(fj);
await put('forecast.json', JSON.stringify({ place: { id: kc.id, name: kc.name, state: kc.state, lat: kc.lat, lon: kc.lon, tz: kc.tz }, response: fj }));
manifest.forecast = 'forecast.json';

// Radar list
const rj = JSON.parse(await fetchText(RADAR_URL, opts));
await put('radar.json', JSON.stringify(rj));
manifest.radar = 'radar.json';

// Report
const files = ['asus01.txt', 'asus02.txt', ...manifest.fronts.forecasts, 'grid.json', 'current.json', 'forecast.json', 'radar.json'];
manifest.bytes = {};
let total = 0;
for (const f of files) { const s = (await stat(new URL(f, OUT))).size; manifest.bytes[f] = s; total += s; }
await put('manifest.json', JSON.stringify(manifest, null, 1) + '\n');

const { readFile } = await import('node:fs/promises');
const an = parseCodsus(await readFile(new URL('asus01.txt', OUT), 'utf8'));
const progs = [];
for (const f of manifest.fronts.forecasts) progs.push(...parseCodsusAll(await readFile(new URL(f, OUT), 'utf8')).map(s => `${s.hour}h`));
console.log(`analysis valid ${new Date(an.valid).toISOString()}: ${an.fronts.length} fronts, ${an.highs.length} highs, ${an.lows.length} lows`);
console.log(`forecast progs: ${progs.join(' ')}`);
console.log(`grid ${g.nLat}x${g.nLon}, ${g.times.length} times ${new Date(g.times[0]).toISOString()} .. ${new Date(g.times.at(-1)).toISOString()}`);
console.log(`current: ${Object.keys(cur).length} cities; radar frames: ${parseRadarList(rj).frames.length}`);
for (const f of files) console.log(`  ${f.padEnd(14)} ${String(manifest.bytes[f]).padStart(8)} B`);
console.log(`  total          ${String(total).padStart(8)} B`);
