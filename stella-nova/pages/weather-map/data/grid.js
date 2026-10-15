// WEATHER MAP · data/grid.js — model fields on a lat/lon grid over the
// contiguous US, from the Open-Meteo forecast API. No DOM.
//
// One multi-location request: 15 x 28 = 420 points, 2.5 deg, lat 20..55,
// lon -130..-62.5, every 3 h from 6 h back to 48 h ahead. Open-Meteo
// counts each location as one call (free limit 600 per minute and 10 000
// per day), so the grid stays at 2.5 deg and the cache holds it 90 min.
// Attribution: "Weather data by Open-Meteo.com (CC BY 4.0)".
//
// Layout: fields[name][k] is a Float32Array(nLat * nLon) for times[k],
// row-major, index i * nLon + j, lat = lat0 + i * dLat (south to north),
// lon = lon0 + j * dLon (west to east).
//   t2m °C · msl hPa · cloud, cloudLow, cloudHigh 0..1 · precip mm per
//   step · snow cm per step · u10, v10 m/s (east, north)
//
// grep -n targets:
//   GRID_SPEC      the request box and step
//   gridUrl        the Open-Meteo URL for a spec
//   parseOpenMeteoGrid   response array -> grid
//   packGrid / unpackGrid  compact integer JSON (cache and data/sample)
//   sampleGrid     bilinear in space, linear in time
//   gridFrame      a whole field at time t (for texture upload)
//   loadGrid       live, then stale cache, then data/sample

import { fetchJSON, cacheGet, cacheSet, readSampleJSON } from './net.js';

export const ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0)';
export const GRID_SPEC = Object.freeze({ lat0: 20, dLat: 2.5, nLat: 15, lon0: -130, dLon: 2.5, nLon: 28, past: 6, ahead: 48 });
export const GRID_MAX_AGE = 90 * 60 * 1000;
export const FIELDS = ['t2m', 'msl', 'cloud', 'cloudLow', 'cloudHigh', 'precip', 'snow', 'u10', 'v10'];
// Integer scale for packGrid: value = int * Q.
const Q = { t2m: 0.1, msl: 0.1, cloud: 0.01, cloudLow: 0.01, cloudHigh: 0.01, precip: 0.01, snow: 0.01, u10: 0.1, v10: 0.1 };
const VARS = 'temperature_2m,pressure_msl,cloud_cover,cloud_cover_low,cloud_cover_high,precipitation,snowfall,wind_speed_10m,wind_direction_10m';

export function gridPoints(spec = GRID_SPEC) {
  const lats = [], lons = [];
  for (let i = 0; i < spec.nLat; i++) for (let j = 0; j < spec.nLon; j++) {
    lats.push(+(spec.lat0 + i * spec.dLat).toFixed(3));
    lons.push(+(spec.lon0 + j * spec.dLon).toFixed(3));
  }
  return { lats, lons };
}

export function gridUrl(spec = GRID_SPEC) {
  const { lats, lons } = gridPoints(spec);
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') + '&longitude=' + lons.join(',') +
    `&hourly=${VARS}&past_hours=${spec.past}&forecast_hours=${spec.ahead}&temporal_resolution=hourly_3` +
    '&timezone=GMT&timeformat=unixtime&wind_speed_unit=ms';
}

export function parseOpenMeteoGrid(resp, spec = GRID_SPEC) {
  const arr = Array.isArray(resp) ? resp : [resp];
  const n = spec.nLat * spec.nLon;
  if (arr.length !== n) throw new Error(`grid: expected ${n} locations, got ${arr.length}`);
  const times = arr[0].hourly.time.map(s => s * 1000);
  const nt = times.length;
  const fields = {};
  for (const f of FIELDS) fields[f] = Array.from({ length: nt }, () => new Float32Array(n));
  const R = Math.PI / 180;
  for (let p = 0; p < n; p++) {
    const h = arr[p].hourly;
    for (let k = 0; k < nt; k++) {
      const num = (a, d = 0) => (a && a[k] != null ? +a[k] : d);
      fields.t2m[k][p] = num(h.temperature_2m, NaN);
      fields.msl[k][p] = num(h.pressure_msl, NaN);
      fields.cloud[k][p] = num(h.cloud_cover) / 100;
      fields.cloudLow[k][p] = num(h.cloud_cover_low) / 100;
      fields.cloudHigh[k][p] = num(h.cloud_cover_high) / 100;
      fields.precip[k][p] = num(h.precipitation);
      fields.snow[k][p] = num(h.snowfall);
      const s = num(h.wind_speed_10m), d = num(h.wind_direction_10m) * R; // direction the wind comes from
      fields.u10[k][p] = -s * Math.sin(d);
      fields.v10[k][p] = -s * Math.cos(d);
    }
  }
  return { ...spec, times, fields };
}

export function packGrid(g) {
  const fields = {};
  for (const f of FIELDS) if (g.fields[f]) fields[f] = g.fields[f].map(a => Array.from(a, v => (Number.isFinite(v) ? Math.round(v / Q[f]) : null)));
  const { lat0, dLat, nLat, lon0, dLon, nLon } = g;
  return { v: 1, lat0, dLat, nLat, lon0, dLon, nLon, times: g.times, q: Q, fields, fetched: g.fetched };
}

export function unpackGrid(p) {
  if (!p || p.v !== 1) throw new Error('grid: unknown pack version');
  const fields = {};
  for (const f of Object.keys(p.fields)) {
    const q = p.q[f];
    fields[f] = p.fields[f].map(a => Float32Array.from(a, v => (v == null ? NaN : v * q)));
  }
  const { lat0, dLat, nLat, lon0, dLon, nLon, times, fetched } = p;
  return { lat0, dLat, nLat, lon0, dLon, nLon, times, fields, fetched };
}

function bilinear(a, g, lat, lon) {
  const fi = Math.min(g.nLat - 1, Math.max(0, (lat - g.lat0) / g.dLat));
  const fj = Math.min(g.nLon - 1, Math.max(0, (lon - g.lon0) / g.dLon));
  const i0 = Math.min(g.nLat - 2, Math.floor(fi)), j0 = Math.min(g.nLon - 2, Math.floor(fj));
  const di = fi - i0, dj = fj - j0, W = g.nLon;
  const v00 = a[i0 * W + j0], v01 = a[i0 * W + j0 + 1], v10 = a[(i0 + 1) * W + j0], v11 = a[(i0 + 1) * W + j0 + 1];
  return (v00 * (1 - dj) + v01 * dj) * (1 - di) + (v10 * (1 - dj) + v11 * dj) * di;
}

// { k0, k1, u }: times[k0] <= t <= times[k1]; clamped at the ends.
export function timeBracket(times, t) {
  const n = times.length;
  if (!n) return { k0: 0, k1: 0, u: 0 };
  if (t <= times[0]) return { k0: 0, k1: 0, u: 0 };
  if (t >= times[n - 1]) return { k0: n - 1, k1: n - 1, u: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  return { k0: lo, k1: hi, u: (t - times[lo]) / (times[hi] - times[lo]) };
}

export function sampleGrid(g, field, lat, lon, t) {
  const f = g && g.fields && g.fields[field];
  if (!f || !f.length) return NaN;
  const { k0, k1, u } = timeBracket(g.times, t);
  const a = bilinear(f[k0], g, lat, lon);
  return u ? a + (bilinear(f[k1], g, lat, lon) - a) * u : a;
}

export function gridFrame(g, field, t, out) {
  const f = g.fields[field], n = g.nLat * g.nLon;
  const o = out || new Float32Array(n);
  const { k0, k1, u } = timeBracket(g.times, t);
  const a = f[k0], b = f[k1];
  for (let p = 0; p < n; p++) o[p] = a[p] + (b[p] - a[p]) * u;
  return o;
}

export function gridBounds(g) {
  return { lat0: g.lat0, lat1: g.lat0 + (g.nLat - 1) * g.dLat, lon0: g.lon0, lon1: g.lon0 + (g.nLon - 1) * g.dLon };
}

export async function loadGridLive(opts = {}) {
  const spec = opts.spec || GRID_SPEC;
  const g = parseOpenMeteoGrid(await fetchJSON(gridUrl(spec), { ...opts, timeout: opts.timeout || 30000 }), spec);
  g.fetched = Date.now();
  return g;
}

export async function loadGrid(opts = {}) {
  const hit = !opts.noCache && cacheGet('grid', GRID_MAX_AGE);
  if (hit) { try { return { ...unpackGrid(hit), live: true, cached: true }; } catch { /* rebuild */ } }
  let error;
  try {
    const g = await loadGridLive(opts);
    cacheSet('grid', packGrid(g));
    return { ...g, live: true };
  } catch (e) { error = String(e && e.message || e); }
  // A failed refresh keeps the last grid of this session before the sample.
  const stale = cacheGet('grid', 12 * 3600 * 1000);
  if (stale) { try { return { ...unpackGrid(stale), live: false, stale: true, error }; } catch { /* sample */ } }
  return { ...unpackGrid(await readSampleJSON('grid.json', opts)), live: false, error };
}
