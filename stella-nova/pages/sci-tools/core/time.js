// ============================================================================
//  SCIENCE TOOLKIT  ·  core/time.js  ·  Julian dates
// ----------------------------------------------------------------------------
//  Calendar date <-> Julian Date by Meeus, Astronomical Algorithms, 2nd ed.
//  (1998), ch. 7: the Julian calendar before 1582 October 15 and the
//  Gregorian calendar after, unless a calendar is forced. Years use
//  astronomical numbering (1 BC = year 0). Greenwich mean sidereal time
//  is Meeus eq. 12.4 (IAU 1982). Times are UT; the difference to TT
//  (about 69 s in 2026) and leap seconds are not applied.
//
//  GREP MAP
//    grep -n "export function toJD"
//    grep -n "export function fromJD"
//    grep -n "export function parseDate"
//    grep -n "export function gmst"
// ============================================================================

export const MJD0 = 2400000.5;

// y, m, d (d may have a fraction) -> JD. cal: 'auto' | 'gregorian' | 'julian'.
export function toJD(y, m, d, cal = 'auto') {
  if (m <= 2) { y -= 1; m += 12; }
  const greg = cal === 'gregorian' || (cal === 'auto' && (y > 1582 || (y === 1582 && (m > 10 || (m === 10 && d >= 15))) || (y === 1583 && m > 12)));
  let B = 0;
  if (greg) { const A = Math.floor(y / 100); B = 2 - A + Math.floor(A / 4); }
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

// JD -> { y, m, d (with fraction), h, mi, s }. Gregorian from JD 2299161.
export function fromJD(jd, cal = 'auto') {
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  let A = z;
  if (cal === 'gregorian' || (cal === 'auto' && z >= 2299161)) { const al = Math.floor((z - 1867216.25) / 36524.25); A = z + 1 + al - Math.floor(al / 4); }
  const B = A + 1524, C = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * C), E = Math.floor((B - D) / 30.6001);
  const day = B - D - Math.floor(30.6001 * E) + f;
  const m = E < 14 ? E - 1 : E - 13, y = m > 2 ? C - 4716 : C - 4715;
  let secs = Math.round(f * 86400 * 1000) / 1000;
  let dd = Math.floor(day);
  if (secs >= 86400) { secs -= 86400; dd += 1; }
  const h = Math.floor(secs / 3600), mi = Math.floor((secs - h * 3600) / 60), s = secs - h * 3600 - mi * 60;
  return { y, m, d: day, day: dd, h, mi, s };
}

// "2000-01-01T12:00:00Z", "1957-10-04.81", "-4712-01-01 12:00", "333-01-27 12:00".
export function parseDate(text) {
  const t = String(text).trim().replace(/\s*(Z|UTC|UT)$/i, '');
  const m = /^([-+]?\d{1,6})-(\d{1,2})-(\d{1,2}(?:\.\d+)?)(?:[T\s]+(\d{1,2})(?::(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?)?)?$/.exec(t);
  if (!m) throw new Error('Write the date as YYYY-MM-DD, with an optional time hh:mm:ss (UT), or a decimal day: 1957-10-04.81.');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) throw new Error('The month must be from 1 to 12.');
  if (d < 1 || d >= 32) throw new Error('The day is out of range.');
  const h = Number(m[4] || 0), mi = Number(m[5] || 0), s = Number(m[6] || 0);
  if (h > 24 || mi > 59 || s >= 61) throw new Error('The time is out of range.');
  if (m[3].includes('.') && m[4]) throw new Error('Use a decimal day or a time, not both.');
  return { y, m: mo, d: d + (h + mi / 60 + s / 3600) / 24 };
}

// Greenwich mean sidereal time in degrees (0..360) at JD (UT).
export function gmst(jd) {
  const T = (jd - 2451545) / 36525;
  const th = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - T ** 3 / 38710000;
  return ((th % 360) + 360) % 360;
}

export const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekday = (jd) => WEEKDAY[(Math.floor(jd + 1.5) % 7 + 7) % 7];
