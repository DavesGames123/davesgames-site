// ============================================================================
//  STORM GLOBE  ·  sources.js  ·  parsers for the storm and event feeds
// ----------------------------------------------------------------------------
//  No DOM. The browser (data.js) and the deploy tool (tools/snapshot.mjs)
//  use the same parsers. tests.mjs runs them on the files in fixtures/.
//
//  Feeds and their parsers:
//    NHC CurrentStorms.json ......... parseNhcCurrent
//    NHC GIS zips (5day, best track)  unzip, parseShp, parseDbf,
//                                     nhcForecast, nhcBestTrack
//    JTWC RSS and .tcw warnings ..... parseJtwcRss, parseTcw
//    NASA EONET v3 events ........... parseEonet
//  Storm objects from every feed have one form (see "STORM FORM" below),
//  and mergeStorms joins them by ATCF id.
//
//  Times are epoch milliseconds (UTC). Winds are knots (kt), as the
//  agencies give them. Longitudes are -180..180.
//
//  grep -n targets
//    storm form ......... "STORM FORM"
//    zip reader ......... "export async function unzip"
//    shapefile .......... "export function parseShp"
//    tcw warning ........ "export function parseTcw"
//    category ........... "export function category"
//    merge .............. "export function mergeStorms"
//    derived cone ....... "export function derivedCone"
// ============================================================================

// STORM FORM
//   { id, name, basin, agency, cls, vmax, pmin, lat, lon, time, dir, spd,
//     track:    [{ t, lat, lon, vmax, p, type }]   observed fixes, oldest first
//     forecast: [{ t, lat, lon, vmax, p, tau }]     tau 0 = the latest fix
//     cone:     [[lon, lat], ...] | null            NHC cone (outer ring)
//     coneKind: 'nhc' | 'derived' | null
//     r34:      [ne, se, sw, nw] nm | null           34 kt wind radii now
//     source:   short credit text }

export const KT = 0.514444;            // m/s per knot
const H = 3600e3;

export function lonWrap(lon) { return lon >= -180 && lon <= 180 ? lon : ((lon + 540) % 360) - 180; }
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase()); }

// Saffir-Simpson category from 1-min sustained wind (kt): -1 depression,
// 0 tropical storm, 1..5 hurricane categories.
export function category(kt) {
  if (!(kt >= 34)) return -1;
  if (kt < 64) return 0;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
}
// The word for a storm of this strength in its basin.
// The basin word follows the position when it is known: a storm that
// crosses the date line from the East Pacific becomes a typhoon.
export function basinAt(basin, lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) return String(basin || '').toUpperCase();
  if (lat < 0) return 'SH';
  if (lon >= 100 || lon <= -180) return 'WP';
  if (lon >= 40 && lon < 100) return 'IO';
  return String(basin || '').toUpperCase();     // AL, EP, CP: all 'Hurricane'
}
export function stormKind(basin, kt, cls, lat, lon) {
  const c = category(kt);
  basin = basinAt(basin, lat, lon);
  if (cls === 'PTC' || cls === 'EX') return 'Post-tropical cyclone';
  if (cls === 'SS' || cls === 'SD' || cls === 'STS') return c < 0 ? 'Subtropical depression' : 'Subtropical storm';
  if (c < 0) return 'Tropical depression';
  if (c === 0) return 'Tropical storm';
  const b = String(basin || '').toUpperCase();
  if (b === 'WP') return kt >= 130 ? 'Super typhoon' : 'Typhoon';
  if (b === 'IO' || b === 'SH' || b === 'SI' || b === 'SP' || b === 'NI') return 'Cyclone';
  return 'Hurricane';
}

// ── NHC CurrentStorms.json ───────────────────────────────────────────────
export function parseNhcCurrent(json) {
  const list = (json && json.activeStorms) || [];
  return list.map(s => {
    const basin = String(s.id || '').slice(0, 2).toUpperCase();
    const t = Date.parse(s.lastUpdate || (s.publicAdvisory && s.publicAdvisory.issuance) || '');
    return {
      id: String(s.id).toLowerCase(), name: titleCase(s.name), basin, agency: 'NHC', cls: s.classification,
      vmax: +s.intensity, pmin: +s.pressure, lat: +s.latitudeNumeric, lon: +s.longitudeNumeric, time: t,
      dir: s.movementDir == null ? null : +s.movementDir, spd: s.movementSpeed == null ? null : +s.movementSpeed,
      track: [], forecast: [], cone: null, coneKind: null, r34: null, source: 'NHC',
      gis: {
        forecast: s.forecastTrack && s.forecastTrack.zipFile || (s.trackCone && s.trackCone.zipFile) || null,
        best: s.bestTrackGIS && s.bestTrackGIS.zipFile || null,
      },
    };
  });
}

// ── zip (stored and deflate) ─────────────────────────────────────────────
// Returns Map name -> Uint8Array. Reads the central directory, so a data
// descriptor flag does not matter. Deflate goes through the platform
// DecompressionStream('deflate-raw') (browsers, Node 18+, Deno).
export async function unzip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip: no end record');
  const n = dv.getUint16(e + 10, true);
  let o = dv.getUint32(e + 16, true);
  const out = new Map();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('zip: bad central record');
    const method = dv.getUint16(o + 10, true), csize = dv.getUint32(o + 20, true);
    const nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true);
    const lho = dv.getUint32(o + 42, true);
    const name = new TextDecoder().decode(b.subarray(o + 46, o + 46 + nl));
    o += 46 + nl + xl + cl;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = b.subarray(start, start + csize);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflateRaw(raw));
  }
  return out;
}
async function inflateRaw(raw) {
  const ds = new DecompressionStream('deflate-raw');
  const ab = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}

// ── shapefile and dBase ──────────────────────────────────────────────────
// parseShp -> [{ type, parts: [[[x, y], ...], ...] }]  (points: one part, one point)
export function parseShp(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  let o = 100;
  while (o + 8 <= b.length) {
    const len = dv.getInt32(o + 4, false) * 2;
    const r = o + 8, type = dv.getInt32(r, true);
    if (type === 1) out.push({ type, parts: [[[dv.getFloat64(r + 4, true), dv.getFloat64(r + 12, true)]]] });
    else if (type === 3 || type === 5) {
      const np = dv.getInt32(r + 36, true), nn = dv.getInt32(r + 40, true);
      const idx = []; for (let i = 0; i < np; i++) idx.push(dv.getInt32(r + 44 + 4 * i, true));
      idx.push(nn);
      const p0 = r + 44 + 4 * np, parts = [];
      for (let i = 0; i < np; i++) {
        const pts = [];
        for (let k = idx[i]; k < idx[i + 1]; k++) pts.push([dv.getFloat64(p0 + 16 * k, true), dv.getFloat64(p0 + 16 * k + 8, true)]);
        parts.push(pts);
      }
      out.push({ type, parts });
    } else out.push({ type, parts: [] });
    o = r + len;
  }
  return out;
}
// parseDbf -> [{ FIELD: 'text', ... }]  (values trimmed, as text)
export function parseDbf(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(4, true), hl = dv.getUint16(8, true), rl = dv.getUint16(10, true);
  const f = [];
  for (let o = 32; b[o] !== 0x0d && o < hl; o += 32) {
    let nm = ''; for (let i = 0; i < 11 && b[o + i]; i++) nm += String.fromCharCode(b[o + i]);
    f.push([nm, b[o + 16]]);
  }
  const rows = [];
  const dec = new TextDecoder('latin1');
  for (let r = 0; r < n; r++) {
    let p = hl + r * rl + 1; const row = {};
    for (const [nm, ln] of f) { row[nm] = dec.decode(b.subarray(p, p + ln)).trim(); p += ln; }
    rows.push(row);
  }
  return rows;
}
function pickFile(files, re) { for (const [k, v] of files) if (re.test(k)) return v; return null; }
// 'DDHHMM' style "06/1800" with the month and year of a reference time.
function validTime(lbl, ref) {
  const m = /(\d\d)\/(\d\d)(\d\d)/.exec(lbl || ''); if (!m) return NaN;
  const d = new Date(ref); let y = d.getUTCFullYear(), mo = d.getUTCMonth();
  if (+m[1] < d.getUTCDate() - 20) mo++;            // the forecast runs into the next month
  else if (+m[1] > d.getUTCDate() + 20) mo--;
  return Date.UTC(y, mo, +m[1], +m[2], +m[3]);
}
// NHC 5-day forecast zip -> { forecast, cone }
export function nhcForecast(files, issued) {
  const pts = pickFile(files, /_5day_pts\.dbf$/i), pgn = pickFile(files, /_5day_pgn\.shp$/i);
  const forecast = [];
  if (pts) {
    const rows = parseDbf(pts);
    const r0 = rows.find(r => +r.TAU === 0) || rows[0];
    const t0 = r0 ? validTime(r0.VALIDTIME, issued || Date.now()) : NaN;
    for (const r of rows) {
      const tau = +r.TAU, p = +r.MSLP;
      forecast.push({ t: t0 + tau * H, tau, lat: +r.LAT, lon: lonWrap(+r.LON), vmax: +r.MAXWIND, p: p > 0 && p < 2000 ? p : null, type: r.STORMTYPE });
    }
    forecast.sort((a, b) => a.tau - b.tau);
  }
  let cone = null;
  if (pgn) {
    const sh = parseShp(pgn);
    let best = null;
    for (const s of sh) for (const part of s.parts) if (!best || part.length > best.length) best = part;
    if (best) cone = best.map(([x, y]) => [lonWrap(x), y]);
  }
  return { forecast, cone };
}
// NHC best-track zip -> track fixes, oldest first
export function nhcBestTrack(files) {
  const pts = pickFile(files, /_pts\.dbf$/i);
  if (!pts) return [];
  return parseDbf(pts).map(r => {
    const d = String(r.DTG).replace(/\.0$/, '');
    const t = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10));
    const p = +r.MSLP;
    return { t, lat: +r.LAT, lon: lonWrap(+r.LON), vmax: +r.INTENSITY, p: p > 0 && p < 2000 ? p : null, type: r.STORMTYPE };
  }).filter(f => isFinite(f.t) && isFinite(f.lat)).sort((a, b) => a.t - b.t);
}

// ── JTWC ─────────────────────────────────────────────────────────────────
// RSS -> [{ id: 'wp2726', title, tcw }] for every warning with JMV 3.0 data
export function parseJtwcRss(xml) {
  const out = [], seen = new Set();
  const re = /<b>\s*([^<]*?\b(\d\d[A-Z])\s*\(([^)]+)\)[^<]*)[\s\S]*?href='([^']+?\/(\w{2}\d{4})\.tcw)'/g;
  let m;
  while ((m = re.exec(xml))) {
    if (seen.has(m[5])) continue; seen.add(m[5]);
    out.push({ id: m[5].toLowerCase(), title: m[1].replace(/\s+/g, ' ').trim(), name: titleCase(m[3]), tcw: m[4] });
  }
  return out;
}
function llTenths(s) {
  const m = /^(\d+)([NS])(\d+)([EW])$/.exec(s.trim()); if (!m) return null;
  const lat = +m[1] / 10 * (m[2] === 'S' ? -1 : 1), lon = +m[3] / 10 * (m[4] === 'W' ? -1 : 1);
  return [lat, lonWrap(lon)];
}
const BASIN_OF = { W: 'WP', E: 'EP', C: 'CP', A: 'IO', B: 'IO', S: 'SH', P: 'SH', L: 'AL' };
// A JTWC .tcw file (JMV 3.0 track lines, then the warning text with the
// six-hourly fix history at the end) -> storm form
export function parseTcw(text, id = '') {
  const L = text.split(/\r?\n/);
  const h = L.find(l => /^\d{10}\s+\d\d[A-Z]\s/.test(l));
  if (!h) return null;
  const hp = h.trim().split(/\s+/);
  const dtg = hp[0], t0 = Date.UTC(+dtg.slice(0, 4), +dtg.slice(4, 6) - 1, +dtg.slice(6, 8), +dtg.slice(8, 10));
  const code = hp[1], name = titleCase(hp[2]);
  const basin = BASIN_OF[code.slice(2)] || 'WP';
  const sid = (id || (basin.toLowerCase() + code.slice(0, 2) + dtg.slice(2, 4))).toLowerCase();
  const forecast = []; let r34 = null;
  for (const l of L) {
    const m = /^T(\d{3})\s+(\d+[NS])\s+(\d+[EW])\s+(\d+)(.*)$/.exec(l.trim());
    if (!m) continue;
    const ll = llTenths(m[2] + m[3]); if (!ll) continue;
    const tau = +m[1];
    forecast.push({ t: t0 + tau * H, tau, lat: ll[0], lon: ll[1], vmax: +m[4], p: null });
    if (tau === 0) {
      const q = /R034\s+(\d+)\s+NE\s+QD\s+(\d+)\s+SE\s+QD\s+(\d+)\s+SW\s+QD\s+(\d+)\s+NW/.exec(m[5]);
      if (q) r34 = [+q[1], +q[2], +q[3], +q[4]];
    }
  }
  const track = [];
  for (const l of L) {
    const m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s+(\d+[NS]\d+[EW])\s+(\d+)\s*$/.exec(l.trim());
    if (!m) continue;
    const t = Date.UTC(2000 + +m[2], +m[3] - 1, +m[4], +m[5]);
    const mm = /^(\d+[NS])(\d+[EW])$/.exec(m[6]); const ll = mm && llTenths(mm[1] + mm[2]);
    if (!ll) continue;
    if (track.length && track[track.length - 1].t === t) continue;
    track.push({ t, lat: ll[0], lon: ll[1], vmax: +m[7], p: null });
  }
  const pm = /MINIMUM CENTRAL PRESSURE AT \d+Z IS (\d+) MB/.exec(text);
  const now = forecast[0] || track[track.length - 1];
  if (!now) return null;
  const pmin = pm ? +pm[1] : null;
  if (pmin && track.length && track[track.length - 1].t === t0) track[track.length - 1].p = pmin;
  if (forecast[0]) forecast[0].p = pmin;
  const lastTrack = track.length ? track[track.length - 1] : null;
  if (!lastTrack || lastTrack.t < t0) track.push({ t: t0, lat: now.lat, lon: now.lon, vmax: now.vmax, p: pmin });
  return {
    id: sid, name, basin, agency: 'JTWC', cls: null, vmax: now.vmax, pmin, lat: now.lat, lon: now.lon, time: t0,
    dir: isFinite(+hp[5]) ? +hp[5] : null, spd: isFinite(+hp[6]) ? +hp[6] : null,
    track, forecast, cone: null, coneKind: null, r34, source: 'JTWC',
  };
}
// JTWC ids are bbNNyy (wp2726); NHC ids are bbNNyyyy (ep182026).
export function atcfId(id) {
  const m = /^([a-z]{2})(\d\d)(\d\d|\d{4})$/.exec(String(id).toLowerCase());
  if (!m) return String(id).toLowerCase();
  return m[1] + m[2] + (m[3].length === 2 ? '20' + m[3] : m[3]);
}

// ── derived cone (for storms without an official cone) ───────────────────
// The NHC cone is the area swept by circles whose radius at each forecast
// hour is the 2/3-probability track error of recent seasons. derivedCone
// builds the same shape from these radii (NHC Atlantic, 2025 season, nm).
// It is not an agency product: the page labels it as derived.
export const CONE_NM = [[0, 0], [12, 26], [24, 39], [36, 53], [48, 67], [60, 81], [72, 99], [96, 145], [120, 205]];
export function coneRadiusNm(tau) {
  for (let i = 1; i < CONE_NM.length; i++) if (tau <= CONE_NM[i][0]) {
    const [a, ra] = CONE_NM[i - 1], [b, rb] = CONE_NM[i];
    return ra + (rb - ra) * (tau - a) / (b - a);
  }
  return CONE_NM[CONE_NM.length - 1][1];
}
// Returns a ring [[lon, lat], ...]: left edge out, a cap round the last
// point, right edge back. Small-circle offsets on the sphere.
export function derivedCone(fc) {
  if (!fc || fc.length < 2) return null;
  const R = 3440.065, D = Math.PI / 180;
  const pts = fc.map(f => ({ lat: f.lat, lon: f.lon, r: Math.max(8, coneRadiusNm(f.tau)) / R }));
  const off = (p, brg, d) => {
    const la = p.lat * D, lo = p.lon * D;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(brg));
    const lo2 = lo + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return [lonWrap(lo2 / D), la2 / D];
  };
  const bearing = (a, b) => {
    const la1 = a.lat * D, la2 = b.lat * D, dl = (b.lon - a.lon) * D;
    return Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl));
  };
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const b = i < pts.length - 1 ? bearing(pts[i], pts[i + 1]) : bearing(pts[i - 1], pts[i]);
    left.push(off(pts[i], b - Math.PI / 2, pts[i].r));
    right.push(off(pts[i], b + Math.PI / 2, pts[i].r));
  }
  const last = pts[pts.length - 1], bl = bearing(pts[pts.length - 2], last), cap = [];
  for (let k = 1; k < 12; k++) cap.push(off(last, bl - Math.PI / 2 + Math.PI * k / 12, last.r));
  const back = []; for (let k = 11; k > 0; k--) back.push(off(pts[0], bl + Math.PI / 2 + Math.PI * k / 12, pts[0].r));
  return [...left, ...cap, ...right.reverse(), ...back];
}

// ── merge ────────────────────────────────────────────────────────────────
// Joins storms from several feeds by ATCF id. NHC wins for its basins (it
// has the official cone); otherwise the newer report wins. Track fixes are
// joined by time. Storms without a cone get a derived one.
export function mergeStorms(...lists) {
  const by = new Map();
  for (const list of lists) for (const s of list || []) {
    if (!s) continue;
    const k = atcfId(s.id), o = by.get(k);
    if (!o) { by.set(k, { ...s, id: k }); continue; }
    const nhcWins = (o.agency === 'NHC') !== (s.agency === 'NHC') ? (s.agency === 'NHC') : (s.time > o.time);
    const a = nhcWins ? { ...s, id: k } : o, b = nhcWins ? o : s;
    const tr = new Map(); for (const f of [...b.track, ...a.track]) tr.set(f.t, f);
    a.track = [...tr.values()].sort((x, y) => x.t - y.t);
    if (!a.forecast.length) a.forecast = b.forecast;
    if (!a.r34) a.r34 = b.r34;
    if (!a.pmin && b.pmin) a.pmin = b.pmin;
    a.source = [...new Set([a.source, b.source])].join(' + ');
    by.set(k, a);
  }
  const out = [...by.values()];
  for (const s of out) {
    if (!s.cone && s.forecast.length > 1) { s.cone = derivedCone(s.forecast); s.coneKind = s.cone ? 'derived' : null; }
    else if (s.cone && !s.coneKind) s.coneKind = 'nhc';
  }
  return out.sort((a, b) => (b.vmax || 0) - (a.vmax || 0));
}

// ── EONET ────────────────────────────────────────────────────────────────
// v3 events -> [{ id, title, cat, catTitle, t, lat, lon, mag, unit, link,
// source, path: [[t, lat, lon]] }]. Polygon geometries give their centroid.
export const EONET_CATS = {
  severeStorms: { label: 'Severe storm', color: '#7fd4ff', shape: 2 },
  wildfires: { label: 'Wildfire', color: '#ff6a3d', shape: 1 },
  volcanoes: { label: 'Volcano', color: '#ff3b5c', shape: 3 },
  floods: { label: 'Flood', color: '#4f8cff', shape: 4 },
  dustHaze: { label: 'Dust and haze', color: '#d9b26b', shape: 4 },
  landslides: { label: 'Landslide', color: '#c08a5a', shape: 3 },
  seaLakeIce: { label: 'Sea and lake ice', color: '#cfe8ff', shape: 4 },
  snow: { label: 'Snow', color: '#ffffff', shape: 4 },
  drought: { label: 'Drought', color: '#e0a040', shape: 4 },
  tempExtremes: { label: 'Temperature extreme', color: '#ff9a62', shape: 4 },
  earthquakes: { label: 'Earthquake', color: '#e889dc', shape: 3 },
  manmade: { label: 'Manmade', color: '#a8a4ff', shape: 4 },
  waterColor: { label: 'Water colour', color: '#64dcc8', shape: 4 },
};
export function parseEonet(json) {
  const out = [];
  for (const e of (json && json.events) || []) {
    const g = e.geometry || []; if (!g.length) continue;
    const path = [];
    for (const q of g) {
      let lat, lon;
      if (q.type === 'Point') { lon = q.coordinates[0]; lat = q.coordinates[1]; }
      else if (q.type === 'Polygon' && q.coordinates[0]) {
        const r = q.coordinates[0]; lon = 0; lat = 0;
        for (const p of r) { lon += p[0]; lat += p[1]; }
        lon /= r.length; lat /= r.length;
      } else continue;
      path.push([Date.parse(q.date), lat, lonWrap(lon), q.magnitudeValue ?? null]);
    }
    if (!path.length) continue;
    path.sort((a, b) => a[0] - b[0]);
    const last = path[path.length - 1], cat = e.categories && e.categories[0] ? e.categories[0].id : 'manmade';
    out.push({
      id: e.id, title: e.title, cat, catTitle: (EONET_CATS[cat] || EONET_CATS.manmade).label,
      t: last[0], t0: path[0][0], lat: last[1], lon: last[2], mag: last[3], unit: g[g.length - 1].magnitudeUnit || null,
      link: e.link || null, source: (e.sources || []).map(s => s.id).join(', '), path: path.map(p => [p[0], p[1], p[2]]),
    });
  }
  return out;
}
// Strength order for the tour: storms by wind, fires by area, volcanoes and
// floods first among the rest (they are few and always notable).
export function eventScore(e) {
  if (e.cat === 'severeStorms') return 50 + (e.mag || 0);
  if (e.cat === 'volcanoes') return 60;
  if (e.cat === 'floods' || e.cat === 'landslides') return 55;
  if (e.cat === 'wildfires') return 10 + Math.log10(1 + (e.mag || 0)) * 8;
  return 20;
}
// Drops EONET severe-storm events that a tropical cyclone already shows.
export function dedupeEvents(events, storms) {
  const names = new Set(storms.map(s => s.name.toLowerCase()));
  return events.filter(e => !(e.cat === 'severeStorms' && [...names].some(n => n && new RegExp('\\b' + n + '\\b', 'i').test(e.title))));
}
