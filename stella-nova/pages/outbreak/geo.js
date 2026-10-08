// ============================================================================
//  OUTBREAK  ·  geo.js — sphere and flat-map projections, great-circle arcs
// ----------------------------------------------------------------------------
//  No DOM and no three import. Angles in, degrees; angles out, radians
//  (gcDist) unless the name says otherwise.
//
//  Globe space: unit sphere, y up.
//    x = cos(lat) cos(lon),  y = sin(lat),  z = -cos(lat) sin(lon)
//  This is the frame of THREE.SphereGeometry with an equirectangular
//  texture (u = (lon + 180) / 360).
//
//  Flat-map space: the plane z = 0, facing +z. Width 4 (x in [-2, 2]).
//  Equirectangular: x = lon / 90, y = lat / 90 (height 2).
//  Equal Earth (Savric, Patterson and Jenny 2018) is scaled so that the
//  equator has the same width 4. Height above the map goes on +z.
//
//  Arcs. A globe arc follows the great circle. The height above the
//  surface is lift * angle * sin(pi t), so a long route arches higher. A
//  flat arc is the straight chord between the two projected points, with
//  the same arch on +z. A flat arc does not wrap at the antimeridian.
//
//  GREP MAP
//    grep -n 'export function sphere'     lat, lon, h -> globe xyz
//    grep -n 'export function flat'       lat, lon, h, proj -> map xyz
//    grep -n 'export function project'    mode switch: globe or a flat proj
//    grep -n 'export function frame'      surface normal, north, east
//    grep -n 'export function gcDist'     great-circle angle, radians
//    grep -n 'export function slerpLL'    point on the great circle
//    grep -n 'export function arcPoints'  Float32Array(3n) of an arc
//    grep -n 'export function arcAt'      one point of an arc
//    grep -n 'EE_SCALE'                   Equal Earth width scale
// ============================================================================

export const SOURCES = [
  { ref: 'Savric B, Patterson T, Jenny B (2018). The Equal Earth map projection. Int J Geogr Inf Sci 33(3):454-465.',
    url: 'https://doi.org/10.1080/13658816.2018.1504949',
    note: 'Equal Earth forward polynomial (A1..A4) used by flat()' },
];

const R = Math.PI / 180;
const { sin, cos, asin, atan2, sqrt, abs, PI } = Math;

// Equal Earth constants (Savric et al. 2018, eq. 2).
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = sqrt(3) / 2;
// The raw equator half width is pi / (M A1). Scale it to 2.
export const EE_SCALE = 2 / (PI / (M * A1));

// Raw Equal Earth on the unit sphere, radians in. No scale.
export function equalEarthRaw(lam, phi) {
  const t = asin(M * sin(phi)), t2 = t * t, t6 = t2 * t2 * t2;
  return [lam * cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
          t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
}

export const wrapLon = lon => ((((lon + 180) % 360) + 360) % 360) - 180;

export function sphere(lat, lon, h = 0) {
  const a = lat * R, b = lon * R, r = 1 + h, c = cos(a);
  return [r * c * cos(b), r * sin(a), -r * c * sin(b)];
}

export function flat(lat, lon, h = 0, proj = 'equirect') {
  if (proj === 'equalearth') {
    const p = equalEarthRaw(lon * R, lat * R);
    return [p[0] * EE_SCALE, p[1] * EE_SCALE, h];
  }
  return [lon / 90, lat / 90, h];
}

// mode: 'globe', 'equirect', 'equalearth' ('flat' means 'equirect').
export function project(lat, lon, h = 0, mode = 'globe') {
  if (mode === 'globe') return sphere(lat, lon, h);
  return flat(lat, lon, h, mode === 'equalearth' ? 'equalearth' : 'equirect');
}

// Inverse of sphere() for any non-zero vector: [lat, lon] in degrees.
export function latLonOf(v) {
  return [atan2(v[1], Math.hypot(v[0], v[2])) / R, atan2(-v[2], v[0]) / R];
}

// The local frame at a point: n (up), north and east, as unit vectors.
// Globe: the sphere frame. Flat: n = +z, north = +y, east = +x.
export function frame(lat, lon, mode = 'globe') {
  if (mode !== 'globe') return { n: [0, 0, 1], north: [0, 1, 0], east: [1, 0, 0] };
  const a = lat * R, b = lon * R, sa = sin(a), ca = cos(a), sb = sin(b), cb = cos(b);
  return { n: [ca * cb, sa, -ca * sb], north: [-sa * cb, ca, sa * sb], east: [-sb, 0, -cb] };
}

// Great-circle angle in radians (haversine, good for small angles).
export function gcDist(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * R, p2 = lat2 * R, dp = p2 - p1, dl = (lon2 - lon1) * R;
  const h = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2;
  return 2 * asin(Math.min(1, sqrt(h)));
}

// Unit vector at fraction t along the great circle from a to b. An
// antipodal pair has no single great circle: the path then goes over the
// point 90 degrees away in the plane of a and the globe y axis (or x).
export function slerpUnit(a, b, t) {
  const pa = sphere(a.lat, a.lon), pb = sphere(b.lat, b.lon);
  let d = pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2];
  d = d > 1 ? 1 : d < -1 ? -1 : d;
  const w = Math.acos(d);
  if (w < 1e-9) return pa;
  const s = sin(w);
  if (s < 1e-6) {
    // Antipodal: rotate pa about an axis perpendicular to it.
    let ax = abs(pa[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const k = ax[0] * pa[0] + ax[1] * pa[1] + ax[2] * pa[2];
    ax = [ax[0] - k * pa[0], ax[1] - k * pa[1], ax[2] - k * pa[2]];
    const l = Math.hypot(ax[0], ax[1], ax[2]);
    const q = [ax[0] / l, ax[1] / l, ax[2] / l], th = PI * t;
    return [pa[0] * cos(th) + q[0] * sin(th), pa[1] * cos(th) + q[1] * sin(th), pa[2] * cos(th) + q[2] * sin(th)];
  }
  const fa = sin((1 - t) * w) / s, fb = sin(t * w) / s;
  return [fa * pa[0] + fb * pb[0], fa * pa[1] + fb * pb[1], fa * pa[2] + fb * pb[2]];
}

// [lat, lon] in degrees at fraction t along the great circle.
export function slerpLL(a, b, t) { return latLonOf(slerpUnit(a, b, t)); }

// One point of an arc. lift: peak height as a fraction of the angle (rad).
export function arcAt(a, b, t, lift, mode = 'globe') {
  const ang = gcDist(a.lat, a.lon, b.lat, b.lon), h = lift * ang * sin(PI * t);
  if (mode === 'globe') {
    const u = slerpUnit(a, b, t), r = 1 + h;
    return [u[0] * r, u[1] * r, u[2] * r];
  }
  const proj = mode === 'equalearth' ? 'equalearth' : 'equirect';
  const p = flat(a.lat, a.lon, 0, proj), q = flat(b.lat, b.lon, 0, proj);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, h];
}

// n points (n >= 2) from t = 0 to t = 1, flat [x, y, z, x, y, z, ...].
export function arcPoints(a, b, n, lift, mode = 'globe', out = null) {
  const o = out || new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const p = arcAt(a, b, n > 1 ? i / (n - 1) : 0, lift, mode);
    o[3 * i] = p[0]; o[3 * i + 1] = p[1]; o[3 * i + 2] = p[2];
  }
  return o;
}
