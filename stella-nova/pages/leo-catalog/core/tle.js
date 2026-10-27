// ============================================================================
//  LEO CATALOG  ·  core/tle.js — TLE parse, classes, orbital elements
// ----------------------------------------------------------------------------
//  Two-line element sets to catalog records, and the numbers derived from a
//  record. No DOM and no three.js. SGP4 comes from the global "satellite"
//  (satellite.js, a classic script that index.html loads first).
//
//    record      { satrec, name, cat, noradId, notable }
//    classify    name -> starlink | station | debris | rocket | payload
//    isISS       NORAD 25544, or ISS / ZARYA in the name
//    elements    T = 2 pi / n,  a = (MU / n^2)^(1/3),
//                apogee / perigee = a (1 +- e) - R_earth,  n in rad/s
//    live state  SGP4 at a date -> geodetic altitude, lat, lon and |v|
//    merge       append new records (deduped by NORAD id) up to a cap
//
//  grep -n targets: "export const EARTH_R_KM", "export const MU",
//  "export function classify", "export function isISS", "export function parseTLE",
//  "export function demoDataset", "export function orbitalElements",
//  "export function liveState", "export function mergeParsed"
// ============================================================================

// Earth radius sets the scene scale: 1 scene unit = 1 Earth radius. MU is the
// gravitational parameter for orbital-element math.
export const EARTH_R_KM = 6378.137;
export const MU         = 398600.4418;

// Classify an object into a display category from its name.
export function classify(name) {
  const n = name.toUpperCase();
  if (/^STARLINK/.test(n))                                return 'starlink';
  if (/ISS \(ZARYA|TIANGONG|TIANHE|MIR|CSS \(/.test(n))   return 'station';
  if (/ DEB( |$)|DEBRIS/.test(n))                         return 'debris';
  if (/ R\/B|ROCKET BODY| BOOSTER/.test(n))               return 'rocket';
  return 'payload';
}
// The ISS: its NORAD id, or a name with ISS or ZARYA (the station labels and
// trails draw it brighter).
export function isISS(s) {
  return s.noradId === 25544 || /\bISS\b|ZARYA/.test(s.name.toUpperCase());
}
// Parse a two-line-element text block into satellite records (name + SGP4
// satrec + NORAD id + category), skipping malformed or unparseable triples.
export function parseTLE(text) {
  const lines = text.replace(/\r/g,'').split('\n');
  const out = [];
  for (let i = 0; i+2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i+1], l2 = lines[i+2];
    if (!name || !l1 || !l2 || l1[0] !== '1' || l2[0] !== '2') continue;
    try {
      const satrec = satellite.twoline2satrec(l1, l2);
      if (satrec.error) continue;
      const noradId = parseInt(l1.substring(2, 7).trim(), 10);
      out.push({ satrec, name, cat: classify(name), noradId, notable: null });
    } catch (e) {}
  }
  return out;
}

// Hard-coded fallback catalog (ISS, Tiangong, Hubble) used only when every
// network TLE source fails, so the globe is never empty.
const DEMO_TLES = [
`ISS (ZARYA)
1 25544U 98067A   26138.50000000  .00012345  00000+0  22345-3 0  9991
2 25544  51.6400 123.4567 0001234  12.3456 347.6543 15.49000000400001`,
`TIANGONG
1 48274U 21035A   26138.50000000  .00015432  00000+0  18765-3 0  9990
2 48274  41.4700 234.5678 0002345  34.5678 325.4321 15.62000000300002`,
`HUBBLE SPACE TELESCOPE
1 20580U 90037B   26138.50000000  .00001234  00000+0  12345-4 0  9993
2 20580  28.4700  45.6789 0002468 123.4567 236.5432 15.09000000400003`,
];
export function demoDataset() {
  const out = [];
  for (const block of DEMO_TLES) {
    const ls = block.split('\n');
    try {
      const satrec = satellite.twoline2satrec(ls[1], ls[2]);
      const noradId = parseInt(ls[1].substring(2,7).trim(), 10);
      out.push({ satrec, name: ls[0].trim(), cat: classify(ls[0]), noradId, notable: null });
    } catch (e) {}
  }
  return out;
}

// Derive period, apogee, perigee, and inclination from an SGP4 satrec.
export function orbitalElements(satrec) {
  if (!satrec) return null;
  const periodMin = (2*Math.PI) / satrec.no;
  const n = satrec.no / 60;
  const a = Math.pow(MU / (n*n), 1/3);
  const e = satrec.ecco;
  return {
    periodMin,
    apogee:  a*(1+e) - EARTH_R_KM,
    perigee: a*(1-e) - EARTH_R_KM,
    incDeg:  satrec.inclo * 180/Math.PI,
  };
}

// Propagate a satrec to a date: altitude (km), lat and lon (degrees) and
// speed (km/s). Each value is NaN when SGP4 has no solution at that date.
export function liveState(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  let alt = NaN, lat = NaN, lon = NaN, speed = NaN;
  if (pv.position) {
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    alt = geo.height;
    lat = geo.latitude * 180/Math.PI;
    lon = geo.longitude * 180/Math.PI;
    if (pv.velocity) speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  }
  return { alt, lat, lon, speed };
}

// Append the records of one parsed group to sats, skipping NORAD ids already
// in knownIds, until sats holds cap records. forceCat (if set) replaces each
// added record's category. Returns how many were added.
export function mergeParsed(sats, knownIds, parsed, cap, forceCat = null) {
  let n = 0;
  for (const p of parsed) {
    if (sats.length >= cap) break;
    if (knownIds.has(p.noradId)) continue;
    if (forceCat) p.cat = forceCat;
    sats.push(p);
    knownIds.add(p.noradId);
    n++;
  }
  return n;
}
