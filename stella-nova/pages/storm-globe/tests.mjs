// ============================================================================
//  STORM GLOBE  ·  tests.mjs
// ----------------------------------------------------------------------------
//    node tests.mjs           parsers (fixtures/), GRIB2, pack, sample,
//                             time slider maths, camera, detectors, the
//                             camera framing rule and smoothing limits
//    deno run -A tests.mjs    the same, plus the GPU solver tests in
//                             tests-solver.mjs (Deno has navigator.gpu)
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

// ── time slider, storms in time, sun, camera, detectors ──────────────────
section('Time slider maths, storms in time, the sun, the camera, the detectors');
{
  const { bracket, sliderToTime, timeToSlider, ticks, stormAt, stormPath, vortexFor, subsolar, relLabel, SLIDER_MAX } = await import('./timeline.js');
  const CAM = await import('./camera.js');
  const { findLows, findJets } = await import('./detect.js');
  const COL = await import('./colour.js');
  const h = 3600e3, T0 = Date.UTC(2026, 9, 6, 0);
  const times = [0, 6, 12, 18].map(k => T0 + k * h);
  const b1 = bracket(times, T0 + 9 * h), b2 = bracket(times, T0 - h), b3 = bracket(times, T0 + 30 * h);
  check('bracket: 09 h -> frames 1, 2, f 0.5', b1.a === 1 && b1.b === 2 && near(b1.f, 0.5, 1e-12));
  check('bracket clamps before and after', b2.a === 0 && b2.f === 0 && b3.a === 2 && b3.b === 3 && b3.f === 1);
  check('bracket at a frame time: f 0', bracket(times, T0 + 12 * h).a === 2 && bracket(times, T0 + 12 * h).f === 0);
  const t0 = times[0], t1 = times[3];
  check('slider 0 / max -> ends', sliderToTime(0, t0, t1) === t0 && sliderToTime(SLIDER_MAX, t0, t1) === t1);
  check('slider round trip within one step (64.8 s)', [0, 1, 333, 999].every(v => timeToSlider(sliderToTime(v, t0, t1), t0, t1) === v));
  check('slider clamps out-of-range values', sliderToTime(-50, t0, t1) === t0 && timeToSlider(t1 + h, t0, t1) === SLIDER_MAX);
  const tk = ticks(T0 - 3 * h, T0 + 27 * h);
  check('ticks: every 6 h, a day mark at 00 UTC', tk.length === 5 && tk.filter(k => k.kind === 'day').length === 2 && tk[0].t === T0, tk.map(k => k.kind).join(','));
  check('relative labels', relLabel(T0, T0) === 'data time' && relLabel(T0 + 18 * h, T0) === '+18 h' && relLabel(T0 - 6 * h, T0) === '−6 h');
  const s = S.mergeStorms([S.parseTcw(fxt('wp2726.tcw'), 'wp2726')])[0];
  const p = stormPath(s), tLast = s.time;
  const a = stormAt(s, tLast);
  check('stormAt at the warning time = the warning fix', near(a.lat, 14.7, 1e-6) && near(a.lon, 164.5, 1e-6) && a.vmax === 50 && !a.fc);
  const m = stormAt(s, tLast + 6 * h);
  check('stormAt +6 h: between tau 0 and tau 12, forecast flag on', m.fc && m.lat > 14.7 && m.lat < 15.6 && m.lon < 164.5 && m.lon > 163.1 && near(m.vmax, 52.5, 1e-9), `${m.lat.toFixed(2)}N ${m.lon.toFixed(2)}E ${m.vmax} kt`);
  check('stormAt: motion toward WNW at about 9 kt', m.dir > 280 && m.dir < 310 && m.spdKt > 7 && m.spdKt < 11, `${m.dir.toFixed(0)} deg ${m.spdKt.toFixed(1)} kt`);
  const end = p[p.length - 1].t;
  check('stormAt fades out over 6 h after the last point, then null', near(stormAt(s, end + 3 * h).w, 0.5, 1e-9) && stormAt(s, end + 7 * h) === null);
  check('stormAt before the first fix - 6 h: null', stormAt(s, p[0].t - 7 * h) === null);
  const cell = 2 * Math.PI / 512, v = vortexFor(a, s, cell);
  check('vortex: rmax >= 1.6 cells, rout from the R34 radii, alpha in 0.3..0.9', v.rmax >= 1.6 * cell - 1e-12 && v.rout > v.rmax * 2 && v.alpha >= 0.3 && v.alpha <= 0.9, `rmax ${(v.rmax * 6371).toFixed(0)} km, rout ${(v.rout * 6371).toFixed(0)} km, alpha ${v.alpha.toFixed(2)}`);
  check('vortex: pressure from the warning (995 hPa)', v.pc === 995);
  const sol = subsolar(Date.UTC(2026, 5, 21, 12)), eq = subsolar(Date.UTC(2026, 2, 20, 12));
  check('subsolar point, 21 June 12 UTC: 23.4N near 0E', near(sol.lat, 23.44, 0.3) && Math.abs(sol.lon) < 1.5, `${sol.lat.toFixed(2)} ${sol.lon.toFixed(2)}`);
  // equinox 2026-03-20 14:46 UTC; equation of time that day about -7.5 min -> +1.9 deg
  check('subsolar point, 20 March 12 UTC: within 0.1 deg of the equator, lon +1.9 +- 0.3', Math.abs(eq.lat) < 0.1 && near(eq.lon, 1.9, 0.3), `${eq.lat.toFixed(2)} ${eq.lon.toFixed(2)}`);
  const A = { lat: 20, lon: -120, alt: 0.3, tilt: 40, heading: 0 }, B = { lat: 15, lon: 165, alt: 0.4, tilt: 30, heading: 20 };
  const f = CAM.flight(A, B);
  const fa = f.at(0), fb = f.at(1), fm = f.at(0.5);
  check('flight starts at a and ends at b', near(fa.lat, 20, 1e-9) && near(fa.lon, -120, 1e-9) && near(fb.lat, 15, 1e-6) && near(fb.lon, 165, 1e-6) && near(fb.alt, 0.4, 1e-9));
  check('flight midpoint is on the great circle and higher than both ends', near(CAM.arc(A, fm) + CAM.arc(fm, B), CAM.arc(A, B), 1e-6) && fm.alt > 0.4, `alt ${fm.alt.toFixed(2)}, arc ${(CAM.arc(A, B) / Math.PI * 180).toFixed(0)} deg, ${f.dur.toFixed(1)} s`);
  check('flight eases: no speed at the ends', CAM.arc(f.at(0), f.at(0.01)) < CAM.arc(f.at(0.5), f.at(0.51)) / 50);
  const bs = CAM.basis(A, 16 / 10, { x: 0.2, y: -0.1 }), q = CAM.project(bs, CAM.unit(A.lat, A.lon));
  check('the camera target projects to the principal point', near(q.x, 0.2, 1e-9) && near(q.y, -0.1, 1e-9) && q.front);
  const pk = CAM.pick(bs, 0.5, 0.3), back = pk && CAM.project(bs, CAM.unit(pk.lat, pk.lon));
  check('pick and project are inverse', back && near(back.x, 0.5, 1e-9) && near(back.y, 0.3, 1e-9));
  check('altForRadius: a wider cap needs more altitude', CAM.altForRadius(0.1) < CAM.altForRadius(0.5));
  const meta = JSON.parse(fs.readFileSync(path.join(HERE, 'data/sample/snapshot.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(HERE, 'data/sample/winds.bin'));
  const fr = G.unpackFrames(new Int8Array(bin.buffer, bin.byteOffset, bin.length), meta.winds.grid, meta.winds.times.length);
  const k0 = meta.winds.times.findIndex(t => Date.parse(t) >= Date.parse(meta.winds.cycle));
  const here = meta.storms.map(q => stormAt(q, Date.parse(meta.winds.cycle)) || q);
  const lows = findLows(fr[k0], meta.winds.grid, here), jets = findJets(fr[k0], meta.winds.grid, here);
  const km = (x, y) => Math.acos(Math.min(1, Math.sin(x.lat * Math.PI / 180) * Math.sin(y.lat * Math.PI / 180) + Math.cos(x.lat * Math.PI / 180) * Math.cos(y.lat * Math.PI / 180) * Math.cos((x.lon - y.lon) * Math.PI / 180))) * 6371;
  check('detector: lows below 990 hPa, none within 900 km of a storm', lows.length > 0 && lows.every(l => l.hpa < 990 && here.every(s2 => km(l, s2) > 900)), lows.map(l => `${l.hpa}hPa@${l.lat},${l.lon}`).join(' '));
  check('detector: wind maxima above 20 m/s', jets.every(j => j.wind > 20));
  const xs = COL.SS_MARKS.map(q => COL.speedToX(q.ms));
  check('legend: Saffir-Simpson marks in order inside the bar', xs.every((x, i) => x > 0 && x < 1 && (!i || x > xs[i - 1])), xs.map(x => x.toFixed(2)).join(' '));
  check('colour LUT: 4 rows of 256 RGBA, magma ends black to pale yellow', COL.lutBytes().length === 4096 && COL.magma(0).join() === '0,0,4' && COL.magma(1).join() === '252,253,191');
}

// ── camera framing rule and smoothing limits ─────────────────────────────
section('Camera: the minimum altitude rule, flight limits, springs');
{
  const CAM = await import('./camera.js');
  const D = Math.PI / 180;
  const portrait = { w: 390, h: 550, H: 844 }, landscape = { w: 844, h: 300, H: 390 }, desk = { w: 624, h: 551, H: 800 };
  const aP = CAM.minAlt(portrait), aD = CAM.minAlt(desk);
  check('minimum altitude: a portrait phone needs more than a computer', aP > aD * 1.3, `phone ${aP.toFixed(2)}, computer ${aD.toFixed(2)} Earth radii`);
  // the rule itself: at minAlt the edge of the narrow side is MIN_R_KM away
  const r = CAM.MIN_R_KM.auto / CAM.R_KM, a = aP, fill = portrait.w / portrait.H;
  const seen = Math.atan2(Math.sin(r), 1 + a - Math.cos(r));
  check('minimum altitude: MIN_R_KM.auto reaches the edge of the narrow side', near(Math.tan(seen), Math.tan(CAM.FOV * D / 2) * fill, 1e-9), `${CAM.MIN_R_KM.auto} km`);
  check('minimum altitude: the user floor is lower than the automatic floor', CAM.minAlt(portrait, 'user') < aP && CAM.minAlt(portrait, 'user') > 0.3, CAM.minAlt(portrait, 'user').toFixed(2));
  check('minimum altitude: landscape phone uses the clear height', near(CAM.minAlt(landscape), CAM.frameAlt(CAM.MIN_R_KM.auto, { w: 300, h: 300, H: 390 }), 1e-12));
  // flights: sample the angular speed and acceleration of the target point
  const worst = (A, B) => {
    const f = CAM.flight(A, B), n = 2000; let vmax = 0, amax = 0, prev = null;
    for (let i = 1; i < n; i++) {
      const v = CAM.arc(f.at((i - 1) / n), f.at(i / n)) * n / f.dur;
      if (prev != null) amax = Math.max(amax, Math.abs(v - prev) * n / f.dur);
      vmax = Math.max(vmax, v); prev = v;
    }
    return { vmax, amax, dur: f.dur };
  };
  const cases = [[{ lat: 20, lon: -120, alt: 0.8, tilt: 34, heading: 0 }, { lat: 15, lon: 60, alt: 0.9, tilt: 30, heading: 20 }],
    [{ lat: 20, lon: -60, alt: 1, tilt: 30, heading: 0 }, { lat: 25, lon: -45, alt: 1.1, tilt: 30, heading: 0 }],
    [{ lat: -60, lon: 120, alt: 1.2, tilt: 20, heading: 0 }, { lat: 40, lon: -170, alt: 2.8, tilt: 0, heading: 0 }]];
  const ws = cases.map(([A, B]) => worst(A, B));
  check('flights: peak angular speed <= FLY.omega', ws.every(w => w.vmax <= CAM.FLY.omega * 1.01), ws.map(w => (w.vmax / D).toFixed(1) + ' deg/s').join(', ') + ` (limit ${(CAM.FLY.omega / D).toFixed(1)})`);
  check('flights: peak angular acceleration <= FLY.alpha', ws.every(w => w.amax <= CAM.FLY.alpha * 1.02), ws.map(w => w.amax.toFixed(3)).join(', ') + ` rad/s^2 (limit ${CAM.FLY.alpha})`);
  check('flights: durations inside FLY.minDur..maxDur', ws.every(w => w.dur >= CAM.FLY.minDur && w.dur <= CAM.FLY.maxDur), ws.map(w => w.dur.toFixed(1) + ' s').join(', '));
  // spring: a step answer without overshoot, settled in about 6 / omega
  const sp = { x: 0, v: 0 }; let over = 0;
  for (let i = 0; i < 240; i++) { CAM.spring(sp, 1, 5, 1 / 60); over = Math.max(over, sp.x - 1); }
  check('spring: no overshoot, settles', over <= 1e-9 && near(sp.x, 1, 1e-3), `overshoot ${over.toExponential(1)}, x ${sp.x.toFixed(5)}`);
  const sp2 = { x: 0, v: 0 }; CAM.spring(sp2, 1, 5, 0.1); CAM.spring(sp2, 1, 5, 0.1);
  check('spring: a long frame (0.1 s) stays stable', sp2.x > 0 && sp2.x < 1);
  // follow: a storm that turns 90 deg at a fix. main.js followStop aims
  // ahead by the spring lag (2 / omega s of motion); the same here
  const at = i => (i < 300 ? { lat: 0, lon: i * 0.02 } : { lat: (i - 300) * 0.02, lon: 6 });
  const fo = CAM.follower({ lat: 0, lon: 0 }); let vm = 0, maxErr = 0, tgt = at(0);
  for (let i = 0; i < 600; i++) {
    tgt = at(i); const aim = at(i + Math.round(2 / 1.8 * 60));
    const before = fo.p; const c = CAM.follow(fo, CAM.unit(aim.lat, aim.lon), 1.8, 1 / 60, 0.35);
    vm = Math.max(vm, Math.acos(Math.min(1, CAM.v3.dot(before, fo.p))) * 60);
    if (i > 120) maxErr = Math.max(maxErr, CAM.arc(c, tgt));
  }
  check('follow: angular speed <= vmax', vm <= 0.35 + 1e-6, (vm / D).toFixed(2) + ' deg/s');
  check('follow: with the lead, cuts the 90 deg turn by under 0.75 deg (smooth, no jerk)', maxErr < 0.75 * D, (maxErr / D).toFixed(2) + ' deg');
  const fz = CAM.follower({ lat: 10, lon: 10 }); let lastD = 1e9, mono = true;
  for (let i = 0; i < 400; i++) { const c = CAM.follow(fz, CAM.unit(0, 0), 1.8, 1 / 60); const d = CAM.arc(c, { lat: 0, lon: 0 }); if (d > lastD + 1e-12) mono = false; lastD = d; }
  check('follow: a still target is reached without overshoot', mono && lastD < 0.01 * D, (lastD / D).toExponential(1) + ' deg');
}

// ── GPU solver (Deno) ────────────────────────────────────────────────────
let gpuNote = '';
if (typeof navigator !== 'undefined' && navigator.gpu) {
  const { runSolverTests } = await import('./tests-solver.mjs');
  await runSolverTests({ section, check, near });
} else gpuNote = '  (GPU solver tests skipped: no navigator.gpu; run deno run -A tests.mjs)';

// ── summary ──────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed${gpuNote}`);
if (fail) process.exitCode = 1;
