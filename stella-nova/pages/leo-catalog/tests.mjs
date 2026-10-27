// ============================================================================
//  LEO CATALOG  ·  tests.mjs — node stella-nova/pages/leo-catalog/tests.mjs
// ----------------------------------------------------------------------------
//  Checks the core/ modules (no DOM, no browser, no network):
//    format ..... time, delta and rate strings; the two log-scale sliders
//                 map to their stated values and invert
//    tle ........ classify; isISS; parseTLE skips bad triples; the demo catalog
//                 elements (pinned from the pre-split main.js); liveState
//                 is NaN where SGP4 has no solution; mergeParsed dedupes,
//                 caps and forces the class
//    tle-fetch .. the source order is snapshot, live-site snapshot,
//                 CelesTrak; a working snapshot sends nothing to CelesTrak;
//                 a 403 from CelesTrak stops every later CelesTrak request;
//                 a 200 without TLE lines is an error
//    wind ....... sampleWindAt values (pinned from the pre-split main.js);
//                 traceStreamlines fills every vertex on the 1.012 shell
//    info ....... the curated match, the class fallbacks, escaped HTML,
//                 the storm rows
//    search ..... name or NORAD substring, the class order, the cap,
//                 escaped result HTML
//    storms ..... the NOAA feed parse, the storm record, the source order
//    geo ........ ECEF to scene axes; lat/lon on the sphere; |sun| = 1
//  fetch is a local stub. This file never sends a request to CelesTrak (it
//  IP-bans for 2 h). satellite.js loads from vendor/ into globalThis; "three"
//  resolves to vendor/ through a loader hook, as the index.html importmap does.
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const VENDOR = fileURLToPath(new URL('../../vendor/', import.meta.url));
vm.runInThisContext(fs.readFileSync(VENDOR + 'satellite.js@5.0.0/dist/satellite.min.js', 'utf8'));
const THREE_URL = new URL('../../vendor/three@0.160.0/build/three.module.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : n(s, c); }`));

const F = await import('./core/format.js');
const T = await import('./core/tle.js');
const W = await import('./core/wind.js');
const I = await import('./core/info.js');
const G = await import('./core/geo.js');
const SR = await import('./core/search.js');
const ST = await import('./core/storms.js');

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (process.argv.includes('-v')) console.log('ok  ', msg); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── format ──────────────────────────────────────────────────────────────────
ok(F.fmtTime(new Date(Date.UTC(2026, 0, 5, 3, 4, 5))) === '2026-01-05 03:04:05Z', 'fmtTime pads to UTC');
ok(same([59999, 60000, -3599000, 3600000, -86400000 * 3.25].map(F.fmtDelta), ['+0m', '+1m', '−59m', '+1.0h', '−3.3d']), 'fmtDelta m / h / d');
ok(same([0.5, 3, 250, 1234, 98765].map(F.fmtRate), ['0.50×', '3.0×', '250×', '1.2k×', '99k×']), 'fmtRate bands');
ok(F.fmt(NaN) === '—' && F.fmt(1.25, 1) === '1.3' && F.fmt(Infinity, 0) === '—', 'fmt dash for non-finite');
ok(F.escHtml(`<a href="x">'&'</a>`) === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;', 'escHtml');
const RANGE = 365 * 86400 * 1000;
const f2o = [0, 0.25, 0.5, 0.75, 1].map(f => F.fracToOffsetMs(f, RANGE));
ok(same(f2o, [-31536000000, -346484222.7983865, 0, 346484222.7983865, 31536000000]), 'time slider: edges = range, centre = NOW');
let inv = 0;
for (let i = 0; i <= 100; i++) inv = Math.max(inv, Math.abs(F.offsetMsToFrac(F.fracToOffsetMs(i / 100, RANGE), RANGE) - i / 100));
ok(inv < 1e-9, `time slider inverts (${inv.toExponential(1)})`);
ok(F.offsetMsToFrac(10 * RANGE, RANGE) === 1 && F.offsetMsToFrac(-10 * RANGE, RANGE) === 0, 'time slider clamps');
ok(same([0, 1 / 6, 0.5, 1].map(F.rateFracToSpeed).map(v => +v.toPrecision(12)), [0.1, 1, 100, 100000]), 'rate slider stops');
ok(near(F.rateSpeedToFrac(F.rateFracToSpeed(0.37)), 0.37), 'rate slider inverts');

// ── tle ─────────────────────────────────────────────────────────────────────
const cls = ['STARLINK-1007', 'ISS (ZARYA)', 'CSS (TIANHE)', 'FENGYUN 1C DEB', 'COSMOS 2251 DEBRIS', 'SL-16 R/B', 'ATLAS BOOSTER', 'GOES 16'].map(T.classify);
ok(same(cls, ['starlink', 'station', 'station', 'debris', 'debris', 'rocket', 'rocket', 'payload']), 'classify by name');
ok(same([{ noradId: 25544, name: 'X' }, { noradId: 1, name: 'ISS (NAUKA)' }, { noradId: 2, name: 'zarya' }, { noradId: 3, name: 'MISSION' }].map(T.isISS), [true, true, true, false]), 'isISS by id or name');
const demo = T.demoDataset();
ok(same(demo.map(p => [p.name, p.cat, p.noradId]), [['ISS (ZARYA)', 'station', 25544], ['TIANGONG', 'station', 48274], ['HUBBLE SPACE TELESCOPE', 'payload', 20580]]), 'demo catalog records');
const OE = [
  { periodMin: 92.97353157613647, apogee: 420.99261560363266, perigee: 419.3147974572603, incDeg: 51.64000000000001 },
  { periodMin: 92.23511889670061, apogee: 385.696130814501, perigee: 382.52463679149787, incDeg: 41.47 },
  { periodMin: 95.51432780213527, apogee: 545.161121254595, perigee: 541.7446244933444, incDeg: 28.470000000000002 },
];
demo.forEach((p, i) => { const e = T.orbitalElements(p.satrec); ok(Object.keys(OE[i]).every(k => near(e[k], OE[i][k], 1e-12)), `${p.name}: elements pinned`); });
ok(T.orbitalElements(null) === null, 'orbitalElements(null)');
const tleText = ['ISS (ZARYA)',
  '1 25544U 98067A   26138.50000000  .00012345  00000+0  22345-3 0  9991',
  '2 25544  51.6400 123.4567 0001234  12.3456 347.6543 15.49000000400001',
  'BROKEN', 'x not a line', 'y not a line',
  'HUBBLE SPACE TELESCOPE',
  '1 20580U 90037B   26138.50000000  .00001234  00000+0  12345-4 0  9993',
  '2 20580  28.4700  45.6789 0002468 123.4567 236.5432 15.09000000400003'].join('\r\n');
const parsed = T.parseTLE(tleText);
ok(same(parsed.map(p => p.noradId), [25544, 20580]), 'parseTLE keeps good triples, skips a bad one, strips CR');
const live = T.liveState(demo[0].satrec, new Date(Date.UTC(2026, 4, 18, 12)));
ok(live.alt > 380 && live.alt < 460 && Math.abs(live.lat) <= 51.7 && live.speed > 7.5 && live.speed < 7.8, `ISS live state (alt ${live.alt.toFixed(0)} km, ${live.speed.toFixed(2)} km/s)`);
const dead = T.liveState(demo[0].satrec, new Date(Date.UTC(2035, 0, 1)));
ok([dead.alt, dead.lat, dead.lon, dead.speed].every(Number.isNaN), 'liveState NaN with no SGP4 solution');
{
  const sats = [], known = new Set();
  const a = T.mergeParsed(sats, known, T.demoDataset(), 2, 'station');
  const b = T.mergeParsed(sats, known, T.demoDataset(), 5);
  ok(a === 2 && b === 1 && sats.length === 3, 'mergeParsed caps then dedupes');
  ok(same(sats.map(s => s.cat), ['station', 'station', 'payload']), 'mergeParsed forceCat on its own group only');
}

// ── tle-fetch (stub fetch; no network) ──────────────────────────────────────
{
  const TF = await import('./core/tle-fetch.js');
  const urls = TF.urlsForGroup('stations');
  ok(urls.length === 3 && urls[0] === new URL('./data/stations.txt', import.meta.url).href
    && urls[1] === 'https://davesgames.io/stella-nova/pages/leo-catalog/data/stations.txt'
    && urls[2] === 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', 'source order: snapshot, site, CelesTrak');
  const calls = [];
  const realFetch = globalThis.fetch;
  let mode = 'tle';
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    if (mode === '403') return new Response('blocked', { status: 403 });
    if (mode === 'notice') return new Response('GP data has not updated since your last download');
    return new Response(tleText);
  };
  const text = await TF.fetchTLE(urls[0]);
  ok(T.parseTLE(text).length === 2 && same(calls, [urls[0]]), 'snapshot read sends nothing to CelesTrak');
  mode = 'notice';
  let err = null; try { await TF.fetchTLE(urls[1]); } catch (e) { err = e.message; }
  ok(err === 'no TLE in response', '200 without TLE lines is an error');
  mode = '403'; calls.length = 0;
  err = null; try { await TF.fetchTLE(urls[2]); } catch (e) { err = e.message; }
  ok(err === 'HTTP 403' && calls.length === 1, 'CelesTrak 403 fails');
  err = null; try { await TF.fetchTLE(TF.urlsForGroup('active')[2]); } catch (e) { err = e.message; }
  ok(err === 'CelesTrak blocked' && calls.length === 1, 'after a 403 no later CelesTrak request goes out');
  mode = 'tle';
  ok(T.parseTLE(await TF.fetchTLE(TF.urlsForGroup('active')[0])).length === 2, 'snapshots still load after the block');
  ok(calls.filter(u => u.startsWith('https://celestrak.org/')).length === 1, 'one CelesTrak call in total (to the stub)');
  globalThis.fetch = realFetch;
}

// ── wind ────────────────────────────────────────────────────────────────────
const WIND = [
  [0, 0, { u: -5.348044249908434, v: 1.7730260698883316, speed: 5.634287776062058 }],
  [45, -30, { u: 47.02454075109574, v: 26.204446179333615, speed: 53.83289359134484 }],
  [-60, 120, { u: -3.884155934628051, v: 14.69823485873889, speed: 15.202788404998385 }],
  [55, -170, { u: 17.42395081095494, v: 44.20761811230463, speed: 47.51744480741722 }],
  [-89, 179, { u: -3.008352563671927, v: 1.3610287594000394, speed: 3.301906181475401 }],
];
for (const [la, lo, w] of WIND) { const s = W.sampleWindAt(la, lo); ok(near(s.u, w.u, 1e-12) && near(s.v, w.v, 1e-12) && near(s.speed, w.speed, 1e-12), `wind at ${la},${lo} pinned`); }
ok(W.CYCLONES.length === 13, '13 pressure centres');
{
  const prog = [];
  const b = W.traceStreamlines(1100, 24, f => prog.push(f));
  let off = 0, seg = 0;
  for (let v = 0; v < b.arclens.length; v++) {
    off = Math.max(off, Math.abs(Math.hypot(b.positions[v * 3], b.positions[v * 3 + 1], b.positions[v * 3 + 2]) - 1.012));
    if (b.streamIds[v] !== Math.floor(v / 48) || b.segPos[v] < 0 || b.segPos[v] > 1) seg++;
  }
  ok(b.arclens.length === 1100 * 24 * 2 && off < 1e-6 && seg === 0, `streamlines on the shell (${off.toExponential(1)}), ids and segPos in range`);
  ok(same(prog, [0, 1024 / 1100]), 'trace progress every 1024 lines');
}

// ── info ────────────────────────────────────────────────────────────────────
const at = new Date(Date.UTC(2026, 4, 18, 12));
ok(I.describeObject(demo[0]).wiki === 'International_Space_Station', 'ISS curated entry');
ok(I.describeObject({ name: 'NOBODY', cat: 'debris' }).wiki === 'Space_debris' && I.describeObject({ name: 'NOBODY', cat: 'payload' }).wiki === 'Satellite', 'class fallbacks');
const panel = I.infoPanelHTML({ ...demo[2], name: 'HUBBLE <b>' }, at);
ok(panel.includes('HUBBLE &lt;b&gt;') && panel.includes('<span class="k">norad id</span><span class="v">20580</span>') && panel.includes('CATNR=20580'), 'info panel escapes the name, has rows and links');
const chip = I.chipBodyHTML({ ...demo[0], notable: 'dock & go' }, at);
ok(chip.startsWith('<div class="ch-row"><span class="k">NORAD</span><span class="v">25544</span></div>') && chip.includes('<span class="v dyn">') && chip.endsWith('dock &amp; go</span></div>'), 'chip rows, dyn values, escaped event');
const storm = { _isStorm: true, satrec: null, name: 'HU Alpha', cat: 'storm', noradId: null, _stormData: { lat: 22.5, lon: -71.25, classification: 'HU', wind: 95 } };
ok(I.chipBodyHTML(storm, at) === '<div class="ch-row"><span class="k">CLASS</span><span class="v">HU</span></div><div class="ch-row"><span class="k">LAT</span><span class="v dyn">22.50°</span></div><div class="ch-row"><span class="k">LON</span><span class="v dyn">-71.25°</span></div><div class="ch-row"><span class="k">WIND</span><span class="v">95 kt</span></div><div class="ch-row"><span class="k">SRC</span><span class="v">NOAA NHC</span></div>', 'storm chip rows');
ok(!I.infoPanelHTML(storm, at).includes('n2yo') && I.infoPanelHTML(storm, at).includes('Tropical_cyclone'), 'storm panel: no NORAD links');

// ── search ──────────────────────────────────────────────────────────────────
{
  const cat = [
    { name: 'STARLINK-1', cat: 'starlink', noradId: 44 }, { name: 'X <DEB>', cat: 'debris', noradId: 25 },
    { name: 'ISS (ZARYA)', cat: 'station', noradId: 25544 }, { name: 'NOAA 19', cat: 'payload', noradId: 33591 },
    { name: 'HU Alpha', cat: 'storm', noradId: null },
  ];
  ok(same(SR.searchCatalog(cat, '  ').length, 0) && same(SR.searchCatalog(cat, '').length, 0), 'blank query, no matches');
  ok(same(SR.searchCatalog(cat, '25').map(m => m.idx), [2, 1]), 'NORAD substring; station ranks before debris');
  ok(same(SR.searchCatalog(cat, 'a').map(m => m.cat), ['station', 'payload', 'starlink', 'storm']), 'rank: station, payload, starlink, storm');
  const many = Array.from({ length: 250 }, (_, i) => ({ name: 'OBJ ' + i, cat: 'payload', noradId: i + 1 }));
  ok(SR.searchCatalog(many, 'obj').length === SR.SEARCH_MAX, 'at most SEARCH_MAX matches');
  ok(SR.searchResultsHTML([]) === '<div class="search-empty">no matches</div>', 'no-match HTML');
  ok(SR.searchResultsHTML(SR.searchCatalog(cat, 'deb')).includes('data-idx="1"') && SR.searchResultsHTML(SR.searchCatalog(cat, 'deb')).includes('X &lt;DEB&gt;'), 'result HTML escapes the name');
}

// ── storms ──────────────────────────────────────────────────────────────────
{
  const feed = { activeStorms: [
    { name: 'Alpha', classification: 'hu', intensity: '95', latitudeNumeric: 22.5, longitudeNumeric: -71.25 },
    { binNumber: 'EP2', latitude: '14.1', longitude: '-120.7' }, { name: 'Bad', latitude: 'x' }] };
  const st = ST.parseStorms(feed);
  ok(same(st, [{ lat: 22.5, lon: -71.25, name: 'Alpha', classification: 'HU', wind: 95 },
    { lat: 14.1, lon: -120.7, name: 'EP2', classification: '', wind: null }]), 'parseStorms: numeric or text fields, bad position dropped');
  ok(same(ST.parseStorms({}), []), 'parseStorms: no activeStorms');
  const r = ST.stormRecord(st[1]);
  ok(r.name === 'STORM EP2' && r.cat === 'storm' && r._isStorm && r.satrec === null && r._stormData === st[1], 'stormRecord');
  ok(ST.STORM_URLS.length === 3 && ST.STORM_URLS[0] === 'https://www.nhc.noaa.gov/CurrentStorms.json' && ST.STORM_URLS.slice(1).every(u => u.endsWith(encodeURIComponent(ST.STORM_URLS[0]))), 'storm sources: direct, then two proxies');
}

// ── geo ─────────────────────────────────────────────────────────────────────
{
  const v = G.ecefToScene(1, 2, 3, { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
  ok(near(v.x, 1 / 6378.137) && near(v.y, 3 / 6378.137) && near(v.z, -2 / 6378.137), 'ECEF (x,y,z) -> scene (x,z,-y)');
  const e = G.latLonToVec3(0, 90, 2);
  ok(near(e.x, 0, 1e-12) && near(e.y, 0) && near(e.z, -2), 'lon 90E is scene -Z');
  ok(near(G.latLonToVec3(90, 0, 1).y, 1), 'north pole is scene +Y');
  const s = G.sunDirEcef(new Date(Date.UTC(2026, 5, 21, 12)));
  ok(near(s.length(), 1) && s.y > 0.39 && s.y < 0.40, `June solstice sun at +23.4° (y ${s.y.toFixed(4)})`);
}

console.log(`${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
