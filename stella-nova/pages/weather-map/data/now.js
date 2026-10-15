// WEATHER MAP · data/now.js — current conditions for every city in one
// Open-Meteo multi-location call. No DOM.
//
// loadCurrent(cities) -> Map(id -> { t2m, code, wind, gust, rh, feels,
// dir, isDay, time }). The Map also carries .live, .time and .error.
// Each city counts as one Open-Meteo call; the cache holds the set 20 min.
//
// grep -n targets: currentUrl, parseCurrent, loadCurrent

import { fetchJSON, cacheGet, cacheSet, readSampleJSON, CACHE_MS } from './net.js';

const CUR = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day';

export function currentUrl(cities) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + cities.map(c => (+c.lat).toFixed(2)).join(',') +
    '&longitude=' + cities.map(c => (+c.lon).toFixed(2)).join(',') +
    `&current=${CUR}&timezone=GMT&timeformat=unixtime&wind_speed_unit=ms`;
}

const n = v => (v == null ? NaN : +v);

// Returns a plain object { id: record } (JSON-safe for the cache).
export function parseCurrent(resp, cities) {
  const arr = Array.isArray(resp) ? resp : [resp];
  if (arr.length !== cities.length) throw new Error(`current: expected ${cities.length} locations, got ${arr.length}`);
  const out = {};
  cities.forEach((c, k) => {
    const x = arr[k].current || {};
    out[c.id] = {
      t2m: n(x.temperature_2m), feels: n(x.apparent_temperature), rh: n(x.relative_humidity_2m), code: n(x.weather_code),
      wind: n(x.wind_speed_10m), dir: n(x.wind_direction_10m), gust: n(x.wind_gusts_10m), isDay: x.is_day === 1,
      time: x.time ? x.time * 1000 : NaN,
    };
  });
  return out;
}

function toMap(obj, cities, extra) {
  const m = new Map();
  for (const c of cities) if (obj[c.id]) m.set(c.id, obj[c.id]);
  let t = 0;
  for (const v of m.values()) if (v.time > t) t = v.time;
  return Object.assign(m, { time: t }, extra);
}

function keyOf(cities) {
  let h = 0;
  for (const c of cities) for (let i = 0; i < c.id.length; i++) h = (h * 31 + c.id.charCodeAt(i)) | 0;
  return `now:${cities.length}:${h >>> 0}`;
}

export async function loadCurrent(cities, opts = {}) {
  const key = keyOf(cities);
  const hit = !opts.noCache && cacheGet(key, CACHE_MS);
  if (hit) return toMap(hit, cities, { live: true, cached: true });
  let error;
  try {
    const obj = parseCurrent(await fetchJSON(currentUrl(cities), { ...opts, timeout: opts.timeout || 20000 }), cities);
    cacheSet(key, obj);
    return toMap(obj, cities, { live: true });
  } catch (e) { error = String(e && e.message || e); }
  const stale = cacheGet(key, 12 * 3600 * 1000);
  if (stale) return toMap(stale, cities, { live: false, stale: true, error });
  return toMap((await readSampleJSON('current.json', opts)).byId, cities, { live: false, error });
}
