// ============================================================================
//  STORM GLOBE  ·  tests.mjs
// ----------------------------------------------------------------------------
//    node tests.mjs           parsers (fixtures/), GRIB2, pack, sample
//  No test fetches a live source: every input is a file in fixtures/.
//
//  grep -n targets: "section('", "function check"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './sources.js';
import * as G from './grib.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = n => new Uint8Array(fs.readFileSync(path.join(HERE, 'fixtures', n)));
const fxt = n => fs.readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
let pass = 0, fail = 0;
function section(name) { console.log('\n' + name); }
function check(name, ok, info = '') {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${info ? '  (' + info + ')' : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const iso = t => new Date(t).toISOString().slice(0, 16) + 'Z';

// ── NHC ──────────────────────────────────────────────────────────────────
section('NHC CurrentStorms.json and GIS zips (fixtures from 2026-10-06 21 UTC)');
{
  const st = S.parseNhcCurrent(JSON.parse(fxt('nhc-current.json')));
  check('two active storms', st.length === 2, st.map(s => s.id).join(','));
  const r = st.find(s => s.id === 'ep182026');
  check('Rachel: 70 kt, 979 hPa, 20.5N 120.1W', r && r.vmax === 70 && r.pmin === 979 && r.lat === 20.5 && r.lon === -120.1);
  check('Rachel: moving 275 deg at 7 kt', r && r.dir === 275 && r.spd === 7);
  check('Rachel: forecast zip link', r && /ep182026_5day_039\.zip$/.test(r.gis.forecast));
  const z = await S.unzip(fx('nhc-ep182026-5day-039.zip'));
  check('5-day zip has 15 files', z.size === 15, z.size + ' files');
  const { forecast, cone } = S.nhcForecast(z, r.time);
  check('forecast: 9 points, tau 0..120', forecast.length === 9 && forecast[0].tau === 0 && forecast[8].tau === 120);
  check('forecast tau 0 at 2026-10-06T18:00Z', iso(forecast[0].t) === '2026-10-06T18:00Z', iso(forecast[0].t));
  check('forecast tau 120 at 28.5N 117.0W, 35 kt', near(forecast[8].lat, 28.5, 1e-6) && near(forecast[8].lon, -117, 1e-6) && forecast[8].vmax === 35);
  check('forecast tau 120 MSLP 9999 read as missing', forecast[8].p === null);
  check('cone ring with > 100 points', cone && cone.length > 100, cone && cone.length + ' pts');
  const lats = cone.map(p => p[1]);
  check('cone spans 20..29 N', Math.min(...lats) < 20.6 && Math.max(...lats) > 28.5, Math.min(...lats).toFixed(1) + '..' + Math.max(...lats).toFixed(1));
  const bt = S.nhcBestTrack(await S.unzip(fx('nhc-ep182026-best-pts.zip')));
  check('best track: 48 fixes, oldest first', bt.length === 48 && bt[0].t < bt[47].t, bt.length + '');
  check('best track first fix 2026-09-25T00Z 9.2N 92.6W', iso(bt[0].t) === '2026-09-25T00:00Z' && bt[0].lat === 9.2 && bt[0].lon === -92.6);
  check('best track last fix 70 kt 979 hPa', bt[47].vmax === 70 && bt[47].p === 979);
}

// ── JTWC ─────────────────────────────────────────────────────────────────
section('JTWC RSS and .tcw (fixtures from 2026-10-07 01 UTC)');
{
  const items = S.parseJtwcRss(fxt('jtwc.rss'));
  const ids = items.map(i => i.id).sort().join(',');
  check('RSS: four warnings with JMV data, the TCFA left out', ids === 'ep1526,ep1826,wp2626,wp2726', ids);
  check('RSS: names', items.find(i => i.id === 'wp2626').name === 'Choi-wan' && items.find(i => i.id === 'wp2726').name === 'Koguma');
  const s = S.parseTcw(fxt('wp2726.tcw'), 'wp2726');
  check('tcw: id and name', s.id === 'wp2726' && s.name === 'Koguma');
  check('tcw: warning time 2026-10-06T18Z', iso(s.time) === '2026-10-06T18:00Z', iso(s.time));
  check('tcw: 14.7N 164.5E, 50 kt, 995 hPa', s.lat === 14.7 && s.lon === 164.5 && s.vmax === 50 && s.pmin === 995);
  check('tcw: 9 forecast points to tau 120', s.forecast.length === 9 && s.forecast[8].tau === 120);
  check('tcw: tau 120 at 25.5N 145.8E, 105 kt', s.forecast[8].lat === 25.5 && s.forecast[8].lon === 145.8 && s.forecast[8].vmax === 105);
  check('tcw: R34 45/40/45/55 nm', s.r34 && s.r34.join('/') === '45/40/45/55');
  check('tcw: 15 history fixes (duplicate dropped), oldest 8.1N 167.9E', s.track.length === 15 && s.track[0].lat === 8.1 && s.track[0].lon === 167.9, s.track.length + '');
  check('tcw: movement 295 deg at 13 kt', s.dir === 295 && s.spd === 13);
  check('atcfId wp2726 -> wp272026', S.atcfId('wp2726') === 'wp272026');
  const m = S.mergeStorms([s]);
  check('merge: derived cone for a JTWC storm', m[0].coneKind === 'derived' && m[0].cone.length > 20);
  const rN = S.parseNhcCurrent(JSON.parse(fxt('nhc-current.json'))).find(q => q.id === 'ep182026');
  const rJ = { ...s, id: 'ep1826', agency: 'JTWC', name: 'Rachel', time: rN.time + 3600e3, track: [{ t: 1, lat: 0, lon: 0, vmax: 20, p: null }] };
  const mm = S.mergeStorms([rJ], [rN]);
  check('merge: NHC wins its basin over a newer JTWC report', mm.length === 1 && mm[0].agency === 'NHC' && mm[0].track.length === 1 + rN.track.length);
}

// ── EONET ────────────────────────────────────────────────────────────────
section('NASA EONET v3 (fixture trimmed from 2026-10-06 queries)');
{
  const ev = S.parseEonet(JSON.parse(fxt('eonet-events.json')));
  check('9 events', ev.length === 9, ev.length + '');
  const cats = [...new Set(ev.map(e => e.cat))].sort().join(',');
  check('three categories', cats === 'severeStorms,volcanoes,wildfires', cats);
  const k = ev.find(e => /Koguma/.test(e.title));
  check('Koguma: last point 14.7N 164.5E, 50 kts', k && k.lat === 14.7 && k.lon === 164.5 && k.mag === 50 && k.unit === 'kts');
  check('every event has a time and a path', ev.every(e => isFinite(e.t) && e.path.length >= 1));
  const storms = [{ name: 'Koguma' }];
  check('dedupe drops the EONET copy of a TC', S.dedupeEvents(ev, storms).every(e => !/Koguma/.test(e.title)));
  check('volcano outranks a small fire', S.eventScore({ cat: 'volcanoes' }) > S.eventScore({ cat: 'wildfires', mag: 5000 }));
}

// ── categories and cones ─────────────────────────────────────────────────
section('Saffir-Simpson categories and the derived cone');
{
  const c = [33, 34, 63, 64, 82, 83, 95, 96, 112, 113, 136, 137].map(S.category).join(',');
  check('category thresholds 34/64/83/96/113/137 kt', c === '-1,0,0,1,1,2,2,3,3,4,4,5', c);
  check('typhoon word west of the date line', S.stormKind('EP', 80, null, 25, 166) === 'Typhoon');
  check('hurricane word in the East Pacific', S.stormKind('EP', 70, null, 20, -120) === 'Hurricane');
  check('cone radius 72 h = 99 nm, 30 h = 46 nm', S.coneRadiusNm(72) === 99 && near(S.coneRadiusNm(30), 46, 1e-9));
}

// ── GRIB2 and GFS ────────────────────────────────────────────────────────
section('GRIB2 decode (GFS 2026-10-06 12Z f000, UGRD 10 m, 1.0 deg)');
{
  const idx = G.parseIdx(fxt('gfs-2026100612-f000-excerpt.idx'));
  const u = G.findIdx(idx, 'UGRD', '10 m above ground');
  check('idx: UGRD 10 m at byte 34787334..34866229', u && u.off === 34787334 && u.end === 34866229);
  const g = G.decodeGrib2(fx('gfs-2026100612-f000-ugrd10m.grb2'));
  check('grid 360 x 181, 90N 0E start, scan 0', g.grid.ni === 360 && g.grid.nj === 181 && g.grid.la1 === 90 && g.grid.lo1 === 0 && g.grid.scan === 0);
  check('template 5.3 decoded, 65160 values, all finite', g.values.length === 65160 && g.values.every(isFinite));
  check('reference time 2026-10-06T12Z, parameter 2.2 (u wind)', iso(g.ref) === '2026-10-06T12:00Z' && g.param.cat === 2 && g.param.num === 2);
  // Open-Meteo's GFS endpoint gave 5.37 m/s from 119 deg at 40N 30W and
  // 7.09 m/s from 202 deg at 0N 0E for this hour (asked 2026-10-06):
  // u = -s sin(dir) = -4.70 and +2.66 m/s.
  const a = G.sampleGrid(g, g.values, 40, -30), b = G.sampleGrid(g, g.values, 0, 0);
  check('u at 40N 30W matches an independent GFS reading (-4.70)', near(a, -4.70, 0.35), a.toFixed(2));
  check('u at 0N 0E matches an independent GFS reading (+2.66)', near(b, 2.66, 0.35), b.toFixed(2));
  const grid = { nx: 144, ny: 73 }, r = G.regrid(g, grid);
  check('regrid to 2.5 deg keeps the mean', near(r.reduce((s, x) => s + x, 0) / r.length, g.values.reduce((s, x) => s + x, 0) / g.values.length, 0.3));
  const fr = [{ u: r, v: r.map(x => -x), p: new Float32Array(r.length).fill(98765) }];
  const back = G.unpackFrames(G.packFrames(fr, grid), grid, 1)[0];
  let e = 0; for (let i = 0; i < r.length; i++) e = Math.max(e, Math.abs(Math.max(-63.5, Math.min(63.5, r[i])) - back.u[i]));
  check('pack/unpack: u within half a step (0.25 m/s)', e <= 0.25 + 1e-6, e.toFixed(3));
  check('pack/unpack: p 987.65 hPa -> 988', back.p[0] === 988);
}

// ── committed sample ─────────────────────────────────────────────────────
section('Committed sample snapshot (data/sample/)');
{
  const meta = JSON.parse(fs.readFileSync(path.join(HERE, 'data/sample/snapshot.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(HERE, 'data/sample/winds.bin'));
  const w = meta.winds;
  check('marked as sample, dated', meta.sample === true && /^\d{4}-\d\d-\d\dT/.test(meta.made), meta.made);
  check('winds.bin size = frames x 3 x nx x ny', bin.length === w.times.length * 3 * w.grid.nx * w.grid.ny, bin.length + ' B');
  check('frame times 6 h apart, ascending', w.times.every((t, i) => !i || Date.parse(t) - Date.parse(w.times[i - 1]) === 6 * 3600e3));
  check('at least one storm with a track and a forecast', meta.storms.some(s => s.track.length > 1 && s.forecast.length > 1));
}

// ── summary ──────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
