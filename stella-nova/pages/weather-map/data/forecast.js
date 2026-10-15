// WEATHER MAP · data/forecast.js — full forecast for one point (current,
// 48 h hourly, 10 days) from Open-Meteo, and the WMO weather code table.
// No DOM.
//
// Units: °C, m/s, mm, hPa, %, epoch ms. daily[].date is local midnight
// of that day in tz, as epoch ms.
//
// grep -n targets: WMO, codeText, forecastUrl, parseForecast,
//   loadForecast

import { fetchJSON, cacheGet, cacheSet, readSampleJSON, CACHE_MS } from './net.js';

export const ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0)';

// WMO 4677 subset used by Open-Meteo. [text, day icon, night icon]
export const WMO = {
  0: ['Clear', 'clear-day', 'clear-night'],
  1: ['Mostly clear', 'mostly-clear-day', 'mostly-clear-night'],
  2: ['Partly cloudy', 'partly-cloudy-day', 'partly-cloudy-night'],
  3: ['Overcast', 'overcast'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Light freezing drizzle', 'freezing-rain'],
  57: ['Freezing drizzle', 'freezing-rain'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'heavy-rain'],
  66: ['Light freezing rain', 'freezing-rain'],
  67: ['Freezing rain', 'freezing-rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'heavy-snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'showers-day', 'showers-night'],
  81: ['Showers', 'showers-day', 'showers-night'],
  82: ['Heavy showers', 'heavy-rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'heavy-snow'],
  95: ['Thunderstorms', 'thunder'],
  96: ['Thunderstorms with hail', 'thunder-hail'],
  99: ['Severe thunderstorms with hail', 'thunder-hail'],
};

// isDay: true/1 for day (default), false/0 for night.
export function codeText(code, isDay = true) {
  const e = WMO[code];
  if (!e) return { text: 'Unknown', icon: 'unknown' };
  const night = isDay === false || isDay === 0;
  return { text: e[0], icon: night && e[2] ? e[2] : e[1] };
}

const CUR = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,is_day,precipitation,cloud_cover';
const HOURLY = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,is_day';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max';

export function forecastUrl(lat, lon, tz) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${(+lat).toFixed(3)}&longitude=${(+lon).toFixed(3)}` +
    `&timezone=${encodeURIComponent(tz || 'auto')}&timeformat=unixtime&wind_speed_unit=ms` +
    `&current=${CUR}&hourly=${HOURLY}&forecast_hours=48&daily=${DAILY}&forecast_days=10`;
}

const ms = s => (s == null ? NaN : s * 1000);
const n = v => (v == null ? NaN : +v);

export function parseForecast(j) {
  const c = j.current || {}, h = j.hourly || {}, d = j.daily || {};
  const current = {
    time: ms(c.time), t2m: n(c.temperature_2m), feels: n(c.apparent_temperature), rh: n(c.relative_humidity_2m),
    code: n(c.weather_code), wind: n(c.wind_speed_10m), dir: n(c.wind_direction_10m), gust: n(c.wind_gusts_10m),
    msl: n(c.pressure_msl), isDay: c.is_day === 1, precip: n(c.precipitation), cloud: n(c.cloud_cover),
  };
  const hourly = (h.time || []).map((t, k) => ({
    time: ms(t), t2m: n(h.temperature_2m?.[k]), feels: n(h.apparent_temperature?.[k]), pop: n(h.precipitation_probability?.[k]),
    precip: n(h.precipitation?.[k]), code: n(h.weather_code?.[k]), wind: n(h.wind_speed_10m?.[k]),
    rh: n(h.relative_humidity_2m?.[k]), isDay: h.is_day?.[k] === 1,
  }));
  const daily = (d.time || []).map((t, k) => ({
    date: ms(t), code: n(d.weather_code?.[k]), max: n(d.temperature_2m_max?.[k]), min: n(d.temperature_2m_min?.[k]),
    pop: n(d.precipitation_probability_max?.[k]), sum: n(d.precipitation_sum?.[k]), sunrise: ms(d.sunrise?.[k]),
    sunset: ms(d.sunset?.[k]), uv: n(d.uv_index_max?.[k]), windMax: n(d.wind_speed_10m_max?.[k]), gustMax: n(d.wind_gusts_10m_max?.[k]),
  }));
  return { lat: j.latitude, lon: j.longitude, elevation: j.elevation, tz: j.timezone, tzAbbr: j.timezone_abbreviation, current, hourly, daily };
}

export async function loadForecast(lat, lon, tz, opts = {}) {
  const key = `fc:${(+lat).toFixed(2)},${(+lon).toFixed(2)}`;
  const hit = !opts.noCache && cacheGet(key, CACHE_MS);
  if (hit) return { ...hit, live: true, cached: true };
  let error;
  try {
    const f = parseForecast(await fetchJSON(forecastUrl(lat, lon, tz), opts));
    if (!f.daily.length || !f.hourly.length) throw new Error('forecast: empty response');
    cacheSet(key, f);
    return { ...f, live: true };
  } catch (e) { error = String(e && e.message || e); }
  const stale = cacheGet(key, 12 * 3600 * 1000);
  if (stale) return { ...stale, live: false, stale: true, error };
  // The sample is one fixed place; sampleOf names it so the card can say so.
  const s = await readSampleJSON('forecast.json', opts);
  return { ...parseForecast(s.response), live: false, sampleOf: s.place, error };
}
