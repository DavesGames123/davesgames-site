// ============================================================================
//  WEATHER MAP  ·  astro.js — the sun and local clock (no DOM, runs in node)
// ----------------------------------------------------------------------------
//  sunDir(t)           unit vector to the sun in globe space at epoch ms t.
//                      Low-precision solar position (Astronomical Almanac,
//                      about 0.01 deg in declination, 0.1 deg in longitude
//                      for 1950..2050) and the Greenwich mean sidereal time.
//  subSolar(t)         { lat, lon } of the sub-solar point (deg).
//  gmstRad(t)          Greenwich mean sidereal angle (rad), for the stars.
//  latLonToXYZ(lat, lon, r)  the globe-space convention of CONTRACT.md:
//                      x = cos(lat) cos(lon), y = sin(lat), z = -cos(lat) sin(lon).
//  xyzToLatLon(v)      the inverse, { lat, lon } with lon in [-180, 180].
//  localParts(t, tz)   { y, mo, d, h, mi, s, weekday, tzAbbr } in IANA zone tz.
//
//  grep -n targets: "export function sunDir", "export function subSolar",
//  "export function gmstRad", "export function localParts", "export function latLonToXYZ"
// ============================================================================

const D2R = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

const wrap360 = a => ((a % 360) + 360) % 360;
const wrap180 = a => { const w = wrap360(a + 180) - 180; return w === -180 ? 180 : w; };

export function latLonToXYZ(lat, lon, r = 1) {
  const p = lat * D2R, l = lon * D2R, c = Math.cos(p);
  return [r * c * Math.cos(l), r * Math.sin(p), -r * c * Math.sin(l)];
}

export function xyzToLatLon(v) {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, v[1] / r))) / D2R, lon: wrap180(Math.atan2(-v[2], v[0]) / D2R) };
}

// Greenwich mean sidereal time as an angle (rad).
export function gmstRad(t) {
  const n = (t - J2000_MS) / 86400000;
  return wrap360(280.46061837 + 360.98564736629 * n) * D2R;
}

// The sub-solar point: latitude = solar declination, longitude = right
// ascension minus the sidereal angle.
export function subSolar(t) {
  const n = (t - J2000_MS) / 86400000;
  const L = wrap360(280.460 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  return { lat: dec / D2R, lon: wrap180((ra - gmstRad(t)) / D2R) };
}

export function sunDir(t) {
  const s = subSolar(t);
  return latLonToXYZ(s.lat, s.lon, 1);
}

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', timeZoneName: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

// Wall-clock parts of epoch ms t in IANA zone tz (default UTC). An unknown
// zone falls back to UTC instead of throwing.
export function localParts(t, tz = 'UTC') {
  let parts;
  try { parts = fmt(tz || 'UTC').formatToParts(new Date(t)); }
  catch { parts = fmt('UTC').formatToParts(new Date(t)); }
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return {
    y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second,
    weekday: o.weekday, tzAbbr: o.timeZoneName || 'UTC',
  };
}
