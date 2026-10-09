// ============================================================================
//  SCIENCE TOOLKIT  ·  core/geo.js  ·  coordinates and distances
// ----------------------------------------------------------------------------
//  parseCoord()  "51.4779, -0.0015", "51°28′40.4″N 0°0′5.3″W",
//                "51 28 40.4 N 0 0 5.3 W", "51°28.673'N, 0°0.088'W"
//  dms(), ddm()  decimal degrees to text
//  haversine()   great-circle distance on a sphere (mean radius
//                R1 = 6371.0088 km, IUGG)
//  vincenty()    geodesic distance and azimuths on the WGS 84 ellipsoid
//                (T. Vincenty, Survey Review 23, 88 (1975), inverse
//                formula); it fails to converge only for nearly antipodal
//                points, and then the tool says so
//
//  GREP MAP
//    grep -n "export function parseCoord"
//    grep -n "export function haversine"
//    grep -n "export function vincenty"
// ============================================================================

export const R_MEAN = 6371008.8;
export const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const rad = Math.PI / 180;

function oneAngle(s, kind) {
  let t = s.trim().toUpperCase();
  let sign = 1;
  const hem = /([NSEW])$/.exec(t) || /^([NSEW])/.exec(t);
  if (hem) {
    if ((hem[1] === 'N' || hem[1] === 'S') && kind === 'lon') throw new Error('A longitude cannot have N or S.');
    if ((hem[1] === 'E' || hem[1] === 'W') && kind === 'lat') throw new Error('A latitude cannot have E or W.');
    if (hem[1] === 'S' || hem[1] === 'W') sign = -1;
    t = t.replace(/[NSEW]/, '').trim();
  }
  t = t.replace(/−/g, '-');
  if (t.startsWith('-')) { sign *= -1; t = t.slice(1); }
  const parts = t.split(/[°º˚d'′’"″”:\s]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some(v => !Number.isFinite(v))) throw new Error(`Cannot read the angle "${s}".`);
  if (parts.length > 3) throw new Error(`"${s}" has too many parts.`);
  const [D, M = 0, S = 0] = parts;
  if (M >= 60 || S >= 60) throw new Error(`Minutes and seconds must be below 60 in "${s}".`);
  const v = sign * (D + M / 60 + S / 3600);
  if (kind === 'lat' && Math.abs(v) > 90) throw new Error('A latitude must be from −90 to 90.');
  if (kind === 'lon' && Math.abs(v) > 180) throw new Error('A longitude must be from −180 to 180.');
  return v;
}

// "lat, lon" in any common form -> [lat, lon] in degrees.
export function parseCoord(text) {
  const t = String(text).trim();
  let a, b;
  const comma = t.split(/\s*[,;]\s*/);
  if (comma.length === 2) [a, b] = comma;
  else {
    const m = /^(.*?[NS])\s*(.+[EW])$/i.exec(t) || /^(.*?)\s+([-+]?[\d.]+)$/.exec(t);
    if (!m) throw new Error('Write the point as "lat, lon", for example 51.4779, -0.0015 or 51°28′40″N 0°0′5″W.');
    [, a, b] = m;
  }
  return [oneAngle(a, 'lat'), oneAngle(b, 'lon')];
}

export function dms(v, pos = 'N', neg = 'S', places = 2) {
  const s = v < 0 ? neg : pos, a = Math.abs(v);
  let d = Math.floor(a), m = Math.floor((a - d) * 60), sec = ((a - d) * 60 - m) * 60;
  if (Number(sec.toFixed(places)) >= 60) { sec = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}′${sec.toFixed(places).padStart(places + 3, '0')}″${s}`;
}
export function ddm(v, pos = 'N', neg = 'S') {
  const s = v < 0 ? neg : pos, a = Math.abs(v), d = Math.floor(a);
  return `${d}°${((a - d) * 60).toFixed(4)}′${s}`;
}

export function haversine([la1, lo1], [la2, lo2], R = R_MEAN) {
  const p1 = la1 * rad, p2 = la2 * rad, dp = p2 - p1, dl = (lo2 - lo1) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing([la1, lo1], [la2, lo2]) {
  const p1 = la1 * rad, p2 = la2 * rad, dl = (lo2 - lo1) * rad;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

export function midpoint([la1, lo1], [la2, lo2]) {
  const p1 = la1 * rad, p2 = la2 * rad, l1 = lo1 * rad, dl = (lo2 - lo1) * rad;
  const bx = Math.cos(p2) * Math.cos(dl), by = Math.cos(p2) * Math.sin(dl);
  const p = Math.atan2(Math.sin(p1) + Math.sin(p2), Math.hypot(Math.cos(p1) + bx, by));
  const l = l1 + Math.atan2(by, Math.cos(p1) + bx);
  return [p / rad, ((l / rad + 540) % 360) - 180];
}

export function vincenty([la1, lo1], [la2, lo2], { a, f } = WGS84) {
  const b = a * (1 - f), L = (lo2 - lo1) * rad;
  const U1 = Math.atan((1 - f) * Math.tan(la1 * rad)), U2 = Math.atan((1 - f) * Math.tan(la2 * rad));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, it = 0, sinS, cosS, sig, sinA, cos2A, cos2Sm;
  for (; it < 200; it++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sinS = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (sinS === 0) return { s: 0, az1: 0, az2: 0, it };
    cosS = sU1 * sU2 + cU1 * cU2 * cl;
    sig = Math.atan2(sinS, cosS);
    sinA = cU1 * cU2 * sl / sinS;
    cos2A = 1 - sinA * sinA;
    cos2Sm = cos2A !== 0 ? cosS - 2 * sU1 * sU2 / cos2A : 0;
    const C = f / 16 * cos2A * (4 + f * (4 - 3 * cos2A));
    const prev = lam;
    lam = L + (1 - C) * f * sinA * (sig + C * sinS * (cos2Sm + C * cosS * (-1 + 2 * cos2Sm * cos2Sm)));
    if (Math.abs(lam - prev) < 1e-13) break;
  }
  if (it >= 200) throw new Error('Vincenty did not converge: the points are nearly antipodal.');
  const u2 = cos2A * (a * a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sinS * (cos2Sm + B / 4 * (cosS * (-1 + 2 * cos2Sm * cos2Sm) - B / 6 * cos2Sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2Sm * cos2Sm)));
  const s = b * A * (sig - dS);
  const sl = Math.sin(lam), cl = Math.cos(lam);
  const az1 = Math.atan2(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl), az2 = Math.atan2(cU1 * sl, -sU1 * cU2 + cU1 * sU2 * cl);
  return { s, az1: (az1 / rad + 360) % 360, az2: (az2 / rad + 360) % 360, it };
}
