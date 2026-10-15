// data (DATA package): bulletin decoding on saved WPC fixtures, grid
// sampling, the WMO code table, the city list, radar tile maths, and the
// loaders' live and fallback paths with a fake fetch (no network).
// ok(name, cond, info). Run alone: node tests/data.test.mjs
import { readFileSync } from 'node:fs';
import {
  decodePos, decodeValid, issuanceOf, parseCodsus, parseCodsusAll, pickNewest, mergeForecasts,
  frontsAt, frontsBracket, loadFronts, loadFrontsLive, FRONT_TYPES,
} from '../data/fronts.js';
import {
  gridUrl, parseOpenMeteoGrid, packGrid, unpackGrid, sampleGrid, gridFrame, timeBracket, gridBounds, loadGrid,
} from '../data/grid.js';
import { WMO, codeText, parseForecast, loadForecast } from '../data/forecast.js';
import { CITIES, CITY_BY_ID, STATES, nearestCity } from '../data/cities.js';
import { tileUrl, tilesForBounds, lonLatToTile, parseRadarList, MAX_ZOOM, loadRadar } from '../data/radar.js';
import { parseCurrent, currentUrl, loadCurrent } from '../data/now.js';

const S = new URL('../data/sample/', import.meta.url);
const fx = name => readFileSync(new URL(name, S), 'utf8');
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const iso = t => (Number.isFinite(t) ? new Date(t).toISOString() : String(t));
const count = set => set.fronts.reduce((m, f) => ((m[f.type] = (m[f.type] || 0) + 1), m), {});
const failFetch = () => Promise.reject(new Error('offline (test)'));

export default async function run(ok) {
  // --- position tokens
  const p = t => JSON.stringify(decodePos(t));
  ok('pos: 4-digit 3897 -> 38N 97W', p('3897') === '[38,-97]', p('3897'));
  ok('pos: 5-digit 3-digit west lon 58143 -> 58N 143W', p('58143') === '[58,-143]', p('58143'));
  ok('pos: 5-digit 26104 -> 26N 104W', p('26104') === '[26,-104]');
  ok('pos: low lon 6633 -> 66N 33W', p('6633') === '[66,-33]');
  ok('pos: 7-digit hi-res 7181475 -> 71.8N 147.5W', p('7181475') === '[71.8,-147.5]', p('7181475'));
  ok('pos: 7-digit leading-zero lon 4860792 -> 48.6N 79.2W', p('4860792') === '[48.6,-79.2]', p('4860792'));
  ok('pos: lon past 180W is east (50190 -> 170E)', p('50190') === '[50,170]', p('50190'));
  ok('pos: bad lengths and text are null', decodePos('123') === null && decodePos('123456') === null && decodePos('WK') === null);

  // --- times
  const iss = issuanceOf(fx('fixture-asus01.txt'));
  ok('issuance from WMO header + date line', iso(iss) === '2026-10-15T16:27:00.000Z', iso(iss));
  ok('valid MMDDHH (analysis) 101515Z', iso(decodeValid('101515Z', iss)) === '2026-10-15T15:00:00.000Z');
  ok('valid DDHHMM (forecast) 160600Z', iso(decodeValid('160600Z', iss)) === '2026-10-16T06:00:00.000Z');
  ok('valid DDHHMM across a month end', iso(decodeValid('010600Z', Date.UTC(2026, 9, 31, 22))) === '2026-11-01T06:00:00.000Z');
  ok('issuance: UTC day past local date across a month end',
    iso(issuanceOf('FSUS02 KWBC 010320\n1120 PM EDT SAT OCT 31 2026\n')) === '2026-11-01T03:20:00.000Z');

  // --- ASUS01 fixture (low-res)
  const a1 = parseCodsus(fx('fixture-asus01.txt'));
  const c1 = count(a1);
  ok('asus01: valid time', iso(a1.valid) === '2026-10-15T15:00:00.000Z', iso(a1.valid));
  ok('asus01: 13 highs, 16 lows', a1.highs.length === 13 && a1.lows.length === 16, `${a1.highs.length}/${a1.lows.length}`);
  ok('asus01: front counts by type', c1.COLD === 9 && c1.WARM === 3 && c1.STNRY === 5 && c1.OCFNT === 5 && c1.TROF === 25, JSON.stringify(c1));
  ok('asus01: only contract front types', a1.fronts.every(f => FRONT_TYPES.includes(f.type)));
  ok('asus01: nothing skipped', a1.skipped === 0, String(a1.skipped));
  ok('asus01: first high 1027 hPa at 72N 148W', a1.highs[0].hPa === 1027 && a1.highs[0].lat === 72 && a1.highs[0].lon === -148);
  ok('asus01: 976 hPa low at 55N 156W', a1.lows.some(l => l.hPa === 976 && l.lat === 55 && l.lon === -156));
  const cold1 = a1.fronts.find(f => f.type === 'COLD');
  ok('asus01: first cold front has 5 points', cold1.pts.length === 5 && cold1.pts[0][0] === 37 && cold1.pts[0][1] === -63, JSON.stringify(cold1.pts));
  ok('asus01: repeated points dropped (12 tokens -> 11 points)', a1.fronts.filter(f => f.type === 'STNRY')[1].pts.length === 11);
  ok('asus01: every front has >= 2 points in range', a1.fronts.every(f => f.pts.length >= 2 && f.pts.every(([la, lo]) => la >= 0 && la <= 90 && lo >= -180 && lo <= 180)));

  // --- ASUS02 fixture (hi-res, wrapped lines)
  const a2 = parseCodsus(fx('fixture-asus02.txt'));
  ok('asus02: wrapped HIGHS/LOWS lines read (13/16)', a2.highs.length === 13 && a2.lows.length === 16, `${a2.highs.length}/${a2.lows.length}`);
  ok('asus02: same front counts as asus01', JSON.stringify(count(a2)) === JSON.stringify(c1), JSON.stringify(count(a2)));
  ok('asus02: hi-res first high 71.8N 147.5W', a2.highs[0].lat === 71.8 && a2.highs[0].lon === -147.5);
  const st2 = a2.fronts.filter(f => f.type === 'STNRY')[1];
  ok('asus02: wrapped front line continues (12 points)', st2.pts.length === 12 && near(st2.pts[11][0], 40.4) && near(st2.pts[11][1], -94.8), JSON.stringify(st2.pts.at(-1)));
  ok('asus02: highs within 1 deg of asus01', a2.highs.every((h, i) => Math.abs(h.lat - a1.highs[i].lat) <= 1 && Math.abs(h.lon - a1.highs[i].lon) <= 1));

  // --- FSUS02 fixtures (two progs per bulletin)
  const fA = parseCodsusAll(fx('fixture-fsus02-12-24.txt'));
  const fB = parseCodsusAll(fx('fixture-fsus02-36-48.txt'));
  ok('fsus02 a: 12 h and 24 h progs', fA.length === 2 && fA[0].hour === 12 && fA[1].hour === 24);
  ok('fsus02 a: valid 16/06Z and 16/18Z', iso(fA[0].valid) === '2026-10-16T06:00:00.000Z' && iso(fA[1].valid) === '2026-10-16T18:00:00.000Z', fA.map(s => iso(s.valid)).join(' '));
  ok('fsus02 a: 12 h prog 3 highs, 3 lows, 15 fronts', fA[0].highs.length === 3 && fA[0].lows.length === 3 && fA[0].fronts.length === 15, `${fA[0].highs.length}/${fA[0].lows.length}/${fA[0].fronts.length}`);
  ok('fsus02 a: strength WK read', fA[0].fronts.filter(f => f.strength === 'WK').length === 6);
  ok('fsus02 a: 3-digit west lon in prog (45106)', fA[0].highs[0].lat === 45 && fA[0].highs[0].lon === -106);
  ok('fsus02 b: 36 h and 48 h progs', fB.length === 2 && fB[0].hour === 36 && iso(fB[1].valid) === '2026-10-17T12:00:00.000Z');
  const merged = mergeForecasts([...fB, ...fA]);
  ok('mergeForecasts: 4 progs sorted by valid', merged.length === 4 && merged.every((s, i) => !i || s.valid > merged[i - 1].valid));

  // --- frontsAt / frontsBracket
  const set = { analysis: a1, forecasts: merged };
  ok('frontsAt: before first -> analysis', frontsAt(set, a1.valid - 1e7) === a1);
  ok('frontsAt: held set between progs', frontsAt(set, merged[0].valid + 3600e3) === merged[0]);
  ok('frontsAt: after last -> last prog', frontsAt(set, Date.UTC(2027, 0, 1)) === merged[3]);
  const br = frontsBracket(set, (a1.valid + merged[0].valid) / 2);
  ok('frontsBracket: midway u = 0.5', br.a === a1 && br.b === merged[0] && near(br.u, 0.5));
  ok('frontsAt: empty set is null', frontsAt(null, 0) === null && frontsBracket({}, 0) === null);

  // --- live fronts loader with a fake fetch
  const list = (wmo, ids) => ({ '@graph': ids.map(([id, t]) => ({ id, wmoCollectiveId: wmo, issuanceTime: t })) });
  const prod = { a1: fx('fixture-asus01.txt'), fa: fx('fixture-fsus02-12-24.txt'), fb: fx('fixture-fsus02-36-48.txt') };
  const asked = [];
  const fakeFetch = url => {
    asked.push(url);
    const body = url.endsWith('/locations/SUS') ? list('ASUS01', [['old', '2026-10-15T13:00:00+00:00'], ['a1', '2026-10-15T16:27:00+00:00']])
      : url.endsWith('/locations/SRP') ? list('FSUS02', [['fb', '2026-10-15T17:18:00+00:00'], ['fa', '2026-10-15T17:20:00+00:00'], ['x', '2026-10-15T04:00:00+00:00']])
      : { productText: prod[url.split('/').pop()], issuanceTime: '2026-10-15T17:00:00+00:00' };
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
  };
  const live = await loadFrontsLive({ fetch: fakeFetch });
  ok('loadFrontsLive: newest analysis picked, 4 progs', live.live && live.analysis.fronts.length === 47 && live.forecasts.length === 4, `${live.forecasts.length}`);
  ok('loadFrontsLive: 5 requests, old ids not fetched', asked.length === 5 && !asked.some(u => u.endsWith('/old') || u.endsWith('/x')), asked.length + '');
  ok('pickNewest: sorts by issuance', pickNewest(list('ASUS01', [['b', '2026-01-01T00:00:00Z'], ['c', '2026-01-02T00:00:00Z']]), 'ASUS01')[0].id === 'c');
  const fb = await loadFronts({ fetch: failFetch, noCache: true });
  ok('loadFronts: offline -> sample, live false', fb.live === false && fb.analysis.fronts.length > 0 && Array.isArray(fb.forecasts) && !!fb.error, fb.error);

  // --- grid: synthetic linear field is reproduced exactly
  const spec = { lat0: 20, dLat: 2.5, nLat: 3, lon0: -100, dLon: 5, nLon: 4, past: 0, ahead: 6 };
  const resp = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    const lat = 20 + i * 2.5, lon = -100 + j * 5;
    resp.push({ hourly: {
      time: [1e9, 1e9 + 10800],
      temperature_2m: [lat + 0.1 * lon, lat + 0.1 * lon + 3],
      pressure_msl: [1000 + i, 1001 + i], cloud_cover: [50, 100], cloud_cover_low: [0, 10], cloud_cover_high: [20, 30],
      precipitation: [0, 1.5], snowfall: [0, 0],
      wind_speed_10m: [5, 5], wind_direction_10m: [j % 2 ? 270 : 0, 90],
    } });
  }
  const g = parseOpenMeteoGrid(resp, spec);
  const T0 = 1e12, T1 = T0 + 10800e3;
  ok('grid: times in ms', g.times[0] === T0 && g.times[1] === T1);
  ok('grid: row-major lat then lon', near(g.fields.t2m[0][1 * 4 + 2], 22.5 - 9, 1e-4));
  ok('grid: bilinear exact on a linear field', near(sampleGrid(g, 't2m', 21.3, -93.7, T0), 21.3 - 9.37, 1e-4), String(sampleGrid(g, 't2m', 21.3, -93.7, T0)));
  ok('grid: linear in time', near(sampleGrid(g, 't2m', 21.3, -93.7, T0 + 5400e3), 21.3 - 9.37 + 1.5, 1e-4));
  ok('grid: clamps outside the box', near(sampleGrid(g, 't2m', 0, -200, T0), 20 - 10, 1e-4) && near(sampleGrid(g, 't2m', 90, 0, T1 + 1e9), 25 - 8.5 + 3, 1e-4));
  ok('grid: cloud as 0..1', near(g.fields.cloud[1][0], 1));
  ok('grid: wind from north -> v < 0, from west -> u > 0', near(g.fields.v10[0][0], -5, 1e-5) && near(g.fields.u10[0][0], 0, 1e-5) && near(g.fields.u10[0][1], 5, 1e-5));
  ok('grid: missing field is NaN', Number.isNaN(sampleGrid(g, 'nope', 20, -100, T0)));
  const gf = gridFrame(g, 'msl', T0 + 10800e3 / 2);
  ok('gridFrame: whole field at t', gf.length === 12 && near(gf[0], 1000.5) && near(gf[11], 1002.5));
  const tb = timeBracket([0, 10, 20], 15);
  ok('timeBracket', tb.k0 === 1 && tb.k1 === 2 && near(tb.u, 0.5));
  const rt = unpackGrid(JSON.parse(JSON.stringify(packGrid(g))));
  ok('packGrid round trip within the scale', rt.fields.t2m.every((a, k) => a.every((v, p) => near(v, g.fields.t2m[k][p], 0.051))));
  ok('parseOpenMeteoGrid: wrong location count throws', (() => { try { parseOpenMeteoGrid(resp.slice(1), spec); return false; } catch { return true; } })());
  ok('gridUrl: 420 points, hourly_3, no email', (gridUrl().match(/latitude=([^&]+)/)[1].split(',').length === 420) && gridUrl().includes('temporal_resolution=hourly_3') && !gridUrl().includes('@'));

  // --- grid sample snapshot
  const gs = await loadGrid({ fetch: failFetch, noCache: true });
  const b = gridBounds(gs);
  ok('grid sample: 15 x 28 over the CONUS box', gs.nLat === 15 && gs.nLon === 28 && b.lat0 === 20 && b.lat1 === 55 && b.lon0 === -130 && b.lon1 === -62.5, JSON.stringify(b));
  ok('grid sample: live false with an error', gs.live === false && !!gs.error);
  ok('grid sample: >= 16 times, 3 h apart', gs.times.length >= 16 && gs.times.every((t, i) => !i || t - gs.times[i - 1] === 10800e3));
  const allIn = (f, lo, hi) => gs.fields[f].every(a => a.length === 420 && a.every(v => v >= lo && v <= hi));
  ok('grid sample: plausible t2m, msl, cloud, wind', allIn('t2m', -50, 55) && allIn('msl', 940, 1070) && allIn('cloud', 0, 1) && allIn('u10', -60, 60));
  const kc = CITY_BY_ID.get('kc');
  ok('grid sample: Kansas City temperature sample is finite', Number.isFinite(sampleGrid(gs, 't2m', kc.lat, kc.lon, gs.times[2])));

  // --- WMO code table
  const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  ok('WMO: every Open-Meteo code has text and icon', codes.every(c => WMO[c] && codeText(c).text !== 'Unknown' && codeText(c).icon));
  ok('WMO: clear day vs night icon', codeText(0, true).icon === 'clear-day' && codeText(0, false).icon === 'clear-night' && codeText(0, 0).icon === 'clear-night');
  ok('WMO: overcast has one icon day and night', codeText(3, false).icon === 'overcast');
  ok('WMO: 95 thunderstorms, 75 heavy snow', codeText(95).text === 'Thunderstorms' && codeText(75).icon === 'heavy-snow');
  ok('WMO: unknown code', codeText(42).text === 'Unknown');

  // --- forecast sample
  const fsj = JSON.parse(fx('forecast.json'));
  const f = parseForecast(fsj.response);
  ok('forecast: 48 hourly, 10 daily', f.hourly.length === 48 && f.daily.length === 10, `${f.hourly.length}/${f.daily.length}`);
  ok('forecast: daily max >= min, sunrise < sunset', f.daily.every(d => d.max >= d.min && d.sunrise < d.sunset));
  ok('forecast: current fields finite', ['t2m', 'feels', 'rh', 'wind', 'msl'].every(k => Number.isFinite(f.current[k])));
  const fo = await loadForecast(40, -100, 'America/Chicago', { fetch: failFetch, noCache: true });
  ok('loadForecast: offline -> sample named by sampleOf', fo.live === false && fo.sampleOf && fo.sampleOf.name === 'Kansas City');

  // --- cities
  const ids = new Set(CITIES.map(c => c.id));
  ok('cities: about 150, ids unique', CITIES.length >= 140 && CITIES.length <= 180 && ids.size === CITIES.length, String(CITIES.length));
  ok('cities: all 50 states, DC and PR', STATES.length === 52 && STATES.includes('PR') && STATES.includes('DC'), STATES.length + '');
  ok('cities: rank 1..3, every rank used', [1, 2, 3].every(r => CITIES.some(c => c.rank === r)) && CITIES.every(c => c.rank >= 1 && c.rank <= 3));
  ok('cities: valid IANA zones', CITIES.every(c => { try { new Intl.DateTimeFormat('en-US', { timeZone: c.tz }); return true; } catch { return false; } }));
  ok('cities: coordinates in US ranges', CITIES.every(c => c.lat > 17 && c.lat < 72 && c.lon > -170 && c.lon < -64));
  ok('nearestCity', nearestCity(40.7, -74.0).id === 'nyc' && nearestCity(0, 0, 5) === null);

  // --- radar
  const fr = { time: 0, path: '/v2/radar/abc' };
  ok('tileUrl: zoom clamped to 7, x wraps', tileUrl(fr, 9, 300, 5) === `https://tilecache.rainviewer.com/v2/radar/abc/256/7/44/5/2/1_1.png`, tileUrl(fr, 9, 300, 5));
  ok('tileUrl: options', tileUrl(fr, 3, -1, 2, { size: 512, smooth: 0, snow: 0, host: 'https://h' }) === 'https://h/v2/radar/abc/512/3/7/2/2/0_0.png');
  const t0 = lonLatToTile(0, 0, 1);
  ok('lonLatToTile: origin at zoom 1', near(t0.x, 1) && near(t0.y, 1, 1e-9));
  const tiles = tilesForBounds({ lat0: 20, lat1: 55, lon0: -130, lon1: -62.5 }, 4);
  ok('tilesForBounds: CONUS at zoom 4 = 4 x 3 tiles', tiles.length === 12 && MAX_ZOOM === 7, String(tiles.length));
  const rl = parseRadarList(JSON.parse(fx('radar.json')));
  ok('parseRadarList: ms times, sorted', rl.frames.length > 0 && rl.frames[0].time > 1e12 && rl.frames.every((x, i) => !i || x.time > rl.frames[i - 1].time));
  const ro = await loadRadar({ fetch: failFetch, noCache: true });
  ok('loadRadar: offline -> no frames, live false', ro.live === false && ro.frames.length === 0);

  // --- current conditions
  const cj = JSON.parse(fx('current.json'));
  ok('current sample: every city present', CITIES.every(c => cj.byId[c.id] && Number.isFinite(cj.byId[c.id].t2m)));
  ok('parseCurrent: count mismatch throws', (() => { try { parseCurrent([{}], CITIES.slice(0, 2)); return false; } catch { return true; } })());
  ok('currentUrl: one point per city', currentUrl(CITIES).match(/latitude=([^&]+)/)[1].split(',').length === CITIES.length);
  const cm = await loadCurrent(CITIES, { fetch: failFetch, noCache: true });
  ok('loadCurrent: offline -> Map from sample, live false', cm instanceof Map && cm.size === CITIES.length && cm.live === false && cm.get('chi').code >= 0);

  // --- sample size budget
  const man = JSON.parse(fx('manifest.json'));
  const total = Object.values(man.bytes).reduce((a, x) => a + x, 0);
  ok('sample: total under 2 MB', total < 2e6, `${total} B`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let fails = 0, runs = 0;
  const ok = (name, cond, info = '') => { runs++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? ' · ' + info : ''}`); if (!cond) fails++; };
  await run(ok);
  console.log(fails ? `${fails} of ${runs} failed` : `all ${runs} passed`);
  if (fails) process.exit(1);
}
