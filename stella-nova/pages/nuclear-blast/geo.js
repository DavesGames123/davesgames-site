// ============================================================================
//  NUCLEAR BLAST  ·  geo.js — map projection and ring geometry (no DOM)
// ----------------------------------------------------------------------------
//  The place map (mapview.js) is a Web Mercator map in CSS pixels: at zoom z
//  the world is 256 * 2^z px wide. The scale on the ground at latitude phi
//  is metresPerPixel(phi, z) = 2 pi R cos(phi) / (256 * 2^z). A ring of
//  radius R metres is drawn as a geodesic circle: points at distance R on
//  the sphere from ground zero, each projected. Near ground zero its screen
//  radius is R / metresPerPixel. tests.mjs checks that at two zooms and two
//  latitudes.
//
//  The 3D scene works in local metres: x east, z south (so north is -z),
//  origin at ground zero. toLocal() and fromLocal() convert with an
//  equirectangular tangent plane, good to well under 1% within 50 km.
//
//  GREP MAP
//    function project / unproject ...... lon, lat <-> world px at zoom z
//    function metresPerPixel ........... ground scale at a latitude
//    function destination .............. the point at a distance and bearing
//    function ringPath ................. a geodesic circle as lon, lat points
//    function toLocal / fromLocal ...... lon, lat <-> local metres
//    function niceScale ................ a round length for the scale bar
// ============================================================================

export const R_EARTH = 6378137;           // m, the WGS 84 radius Web Mercator uses
const D2R = Math.PI / 180, MAXLAT = 85.05112878;

// lon, lat (deg) -> world px at zoom z
export function project(lon, lat, z) {
  const s = 256 * Math.pow(2, z), la = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * D2R;
  return { x: (lon + 180) / 360 * s, y: (1 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / Math.PI) / 2 * s };
}
export function unproject(x, y, z) {
  const s = 256 * Math.pow(2, z), lon = x / s * 360 - 180;
  const n = Math.PI * (1 - 2 * y / s);
  return { lon, lat: Math.atan(Math.sinh(n)) / D2R };
}
export function metresPerPixel(lat, z) { return 2 * Math.PI * R_EARTH * Math.cos(lat * D2R) / (256 * Math.pow(2, z)); }

// the point at distance d (m) and bearing b (deg from north) on the sphere
export function destination(lon, lat, d, b) {
  const p1 = lat * D2R, l1 = lon * D2R, a = d / R_EARTH, br = b * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(a) + Math.cos(p1) * Math.sin(a) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(a) * Math.cos(p1), Math.cos(a) - Math.sin(p1) * Math.sin(p2));
  return { lon: ((l2 / D2R + 540) % 360) - 180, lat: p2 / D2R };
}
// great-circle distance (m)
export function distance(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function ringPath(lon, lat, R, n = 128) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(destination(lon, lat, R, i / n * 360));
  return out;
}
// local tangent plane: x east, z south (metres)
export function toLocal(lon, lat, lon0, lat0) {
  return { x: (lon - lon0) * D2R * R_EARTH * Math.cos(lat0 * D2R), z: -(lat - lat0) * D2R * R_EARTH };
}
export function fromLocal(x, z, lon0, lat0) {
  return { lon: lon0 + x / (D2R * R_EARTH * Math.cos(lat0 * D2R)), lat: lat0 - z / (D2R * R_EARTH) };
}
// a round length (m) near target for the scale bar
export function niceScale(target) {
  const p = Math.pow(10, Math.floor(Math.log10(target))), k = target / p;
  return (k >= 5 ? 5 : k >= 2 ? 2 : 1) * p;
}
