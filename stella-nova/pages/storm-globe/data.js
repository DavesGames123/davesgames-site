// ============================================================================
//  STORM GLOBE  ·  data.js  ·  the snapshot: build, load and live refresh
// ----------------------------------------------------------------------------
//  No DOM. One snapshot = snapshot.json (storms, events, wind meta) plus
//  winds.bin (GFS frames, grib.js packFrames).
//
//  Where a snapshot comes from:
//    data/live/     written at deploy time by tools/snapshot.mjs (the pages
//                   workflow). Not in git. Fresh within about 2 h.
//    data/sample/   committed, clearly dated, used when data/live/ is
//                   missing. The page says "sample" on screen.
//  Then the browser refreshes what it can fetch itself (all send CORS):
//    JTWC RSS and .tcw   storms outside the NHC basins, every 6 h
//    NASA EONET          events (fires, volcanoes, floods, storms)
//    GFS on AWS          the wind frames, when the snapshot is older than
//                        STALE_H (the browser decodes GRIB2 with grib.js)
//  NHC sends no CORS header, so the Atlantic and NHC Pacific storms come
//  only from the snapshot. tools/snapshot.mjs fetches them at deploy time.
//
//  Never size a buffer from content-length (the live site gzips): readAll
//  joins the chunks at their real size.
//
//  grep -n targets
//    feed urls ......... "export const URLS"
//    build (deploy) .... "export async function buildSnapshot"
//    load (browser) .... "export async function loadSnapshot"
//    live storms ....... "export async function fetchLiveStorms"
//    live events ....... "export async function fetchLiveEvents"
//    live winds ........ "export async function fetchLiveWinds"
// ============================================================================
import { parseNhcCurrent, unzip, nhcForecast, nhcBestTrack, parseJtwcRss, parseTcw, parseEonet, mergeStorms, eventScore } from './sources.js';
import { fetchGfsFrames, packFrames, unpackFrames } from './grib.js';

export const URLS = {
  nhc: 'https://www.nhc.noaa.gov/CurrentStorms.json',
  jtwc: 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss',
  eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events',
};
export const EONET_QUERIES = [
  'status=open&category=severeStorms,floods,landslides,dustHaze,tempExtremes,snow,drought,earthquakes&days=60',
  'status=open&category=volcanoes',
  'status=open&category=wildfires&days=14',
];
export const STALE_H = 12;           // older snapshots get live GFS frames
const H = 3600e3;

export async function readAll(res, onProgress) {
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const rd = res.body.getReader(), parts = [];
  let n = 0;
  const hint = +res.headers.get('content-length') || 0;   // progress only
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); n += value.length;
    if (onProgress && hint) onProgress(Math.min(1, n / hint));
  }
  const out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── storms ───────────────────────────────────────────────────────────────
export async function fetchNhcStorms(f = fetch, log = () => {}) {
  const r = await f(URLS.nhc); if (!r.ok) throw new Error('nhc ' + r.status);
  const storms = parseNhcCurrent(await r.json());
  for (const s of storms) {
    try {
      if (s.gis.forecast) {
        const z = await unzip(await readAll(await f(s.gis.forecast)));
        const { forecast, cone } = nhcForecast(z, s.time);
        s.forecast = forecast; s.cone = cone; s.coneKind = cone ? 'nhc' : null;
      }
      if (s.gis.best) s.track = nhcBestTrack(await unzip(await readAll(await f(s.gis.best))));
    } catch (e) { log('nhc gis ' + s.id + ': ' + e.message); }
    if (!s.track.length || s.track[s.track.length - 1].t < s.time) s.track.push({ t: s.time, lat: s.lat, lon: s.lon, vmax: s.vmax, p: s.pmin });
    delete s.gis;
  }
  return storms;
}
export async function fetchLiveStorms(f = fetch, log = () => {}) {
  const r = await f(URLS.jtwc); if (!r.ok) throw new Error('jtwc ' + r.status);
  const items = parseJtwcRss(await r.text()), out = [];
  for (const it of items) {
    try {
      const q = await f(it.tcw); if (!q.ok) throw new Error(q.status);
      const s = parseTcw(await q.text(), it.id);
      if (s) out.push(s);
    } catch (e) { log('jtwc ' + it.id + ': ' + e.message); }
  }
  return out;
}

// ── events ───────────────────────────────────────────────────────────────
export async function fetchLiveEvents(f = fetch, log = () => {}) {
  const all = [];
  for (const q of EONET_QUERIES) {
    try {
      const r = await f(URLS.eonet + '?' + q); if (!r.ok) throw new Error(r.status);
      all.push(...parseEonet(await r.json()));
    } catch (e) { log('eonet ' + q.slice(0, 40) + ': ' + e.message); }
  }
  const seen = new Set(), ev = all.filter(e => !seen.has(e.id) && seen.add(e.id));
  const fires = ev.filter(e => e.cat === 'wildfires').sort((a, b) => (b.mag || 0) - (a.mag || 0)).slice(0, 60);
  return [...ev.filter(e => e.cat !== 'wildfires'), ...fires].sort((a, b) => eventScore(b) - eventScore(a));
}

// ── winds ────────────────────────────────────────────────────────────────
export function windMeta(res, grid, sample) {
  return {
    file: 'winds.bin', grid, cycle: new Date(res.cycle).toISOString(),
    times: res.times.map(t => new Date(t).toISOString()), kinds: res.kinds,
    fields: ['u10', 'v10', 'mslp'], enc: { uv: 'int8 x 0.5 m/s', p: 'int8 hPa - 1000' },
    source: 'NOAA GFS 1.0 deg (AWS open data), regridded', sample: !!sample,
  };
}
export async function fetchLiveWinds(opt) {
  return fetchGfsFrames(opt);
}

// ── deploy build ─────────────────────────────────────────────────────────
// opt: { fetch, now, grid: { nx, ny }, past, ahead, sample, log }
// Returns { json, bin } or throws when the winds fail (storms and events
// that fail are left empty and noted in json.notes).
export async function buildSnapshot(opt) {
  const f = opt.fetch || fetch, log = opt.log || (() => {}), notes = [];
  const made = new Date(opt.now || Date.now()).toISOString();
  let nhc = [], jtwc = [], events = [];
  try { nhc = await fetchNhcStorms(f, log); } catch (e) { notes.push('NHC: ' + e.message); }
  try { jtwc = await fetchLiveStorms(f, log); } catch (e) { notes.push('JTWC: ' + e.message); }
  try { events = await fetchLiveEvents(f, log); } catch (e) { notes.push('EONET: ' + e.message); }
  const res = await fetchGfsFrames({ fetch: f, now: opt.now, grid: opt.grid, past: opt.past, ahead: opt.ahead, onProgress: opt.onProgress });
  const json = {
    version: 1, made, sample: !!opt.sample,
    sources: {
      storms: 'NHC CurrentStorms.json and GIS (public domain); JTWC warnings (public domain)',
      events: 'NASA EONET v3 (public domain)',
      winds: 'NOAA GFS via AWS open data (public domain)',
    },
    notes,
    winds: windMeta(res, opt.grid, opt.sample),
    storms: mergeStorms(nhc, jtwc).map(compactStorm),
    events: events.map(compactEvent),
  };
  return { json, bin: packFrames(res.frames, opt.grid) };
}
// Coordinates to 0.01 deg, cones to at most 240 points, event paths to
// their last 40 points: the JSON stays small.
const r2 = x => (x == null || !isFinite(x)) ? x : Math.round(x * 100) / 100;
export function compactStorm(s) {
  const fix = q => ({ ...q, lat: r2(q.lat), lon: r2(q.lon) });
  let cone = s.cone;
  if (cone && cone.length > 240) { const k = Math.ceil(cone.length / 240); cone = cone.filter((_, i) => i % k === 0); }
  return { ...s, lat: r2(s.lat), lon: r2(s.lon), track: s.track.map(fix), forecast: s.forecast.map(fix), cone: cone && cone.map(([a, b]) => [r2(a), r2(b)]) };
}
export function compactEvent(e) {
  return { ...e, lat: r2(e.lat), lon: r2(e.lon), path: e.path.slice(-40).map(([t, a, b]) => [t, r2(a), r2(b)]) };
}

// ── browser load ─────────────────────────────────────────────────────────
// Tries each base in order ('data/live/', 'data/sample/'). Returns
// { base, meta, frames, times: [ms] } for the first that loads.
export async function loadSnapshot(bases, f = fetch, onProgress) {
  let last = null;
  for (const base of bases) {
    try {
      const r = await f(base + 'snapshot.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(base + ' ' + r.status);
      const meta = await r.json();
      const w = meta.winds;
      const b = await f(base + w.file, { cache: 'no-cache' });
      if (!b.ok) throw new Error(base + w.file + ' ' + b.status);
      const bytes = await readAll(b, onProgress);
      const count = w.times.length, need = count * 3 * w.grid.nx * w.grid.ny;
      if (bytes.length < need) throw new Error(`winds.bin short: ${bytes.length} < ${need}`);
      return { base, meta, frames: unpackFrames(new Int8Array(bytes.buffer, bytes.byteOffset, need), w.grid, count), times: w.times.map(Date.parse) };
    } catch (e) { last = e; }
  }
  throw last || new Error('no snapshot');
}
// Hours between the snapshot's newest analysis and now.
export function snapshotAgeH(meta, now = Date.now()) {
  return (now - Date.parse(meta.winds.cycle)) / H;
}
