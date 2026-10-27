// ============================================================================
//  LEO CATALOG  ·  core/wind.js — analytical wind field and streamline trace
// ----------------------------------------------------------------------------
//  A climatological wind model, not data. Three parts sum per sample:
//    1. three-cell zonal base: trade winds (0-30°), westerlies (30-60°),
//       polar easterlies (60-90°)
//    2. planetary-wave perturbations: stationary Rossby-wave-like
//       meridional and zonal variation
//    3. cyclonic features: fixed semi-permanent lows and highs (Aleutian,
//       Icelandic, Bermuda, Pacific, and so on)
//  sampleWindAt returns (u, v) in km/h and the speed. Sub-microsecond per
//  sample, so the boot traces every streamline on the CPU once and the
//  streamline shader animates them with one uniform.
//
//  Streamline buffers (traceStreamlines): 2 vertices per step, steps per
//  line. position xyz on the r = 1.012 shell (scene frame), arclen, streamId,
//  speed (km/h) and segPos (0..1 along the line, for the comet shader).
//
//  No DOM and no three.js. Math.random seeds each line, in line order.
//
//  grep -n targets: "export const CYCLONES", "export function sampleWindAt",
//  "function traceStreamline", "export function traceStreamlines"
// ============================================================================

export const CYCLONES = [
  // {lat, lon, r (degrees), str (km/h), spin: +1 cyclonic-N / -1 anticyclonic-N}
  // Northern hemisphere semi-permanent features
  { lat:  55, lon: -170, r: 26, str:  24, spin: +1 },   // Aleutian Low
  { lat:  60, lon:  -30, r: 24, str:  22, spin: +1 },   // Icelandic Low
  { lat:  32, lon:  -60, r: 30, str:  18, spin: -1 },   // Bermuda High
  { lat:  30, lon: -140, r: 32, str:  20, spin: -1 },   // Pacific High
  { lat:  35, lon:  -25, r: 26, str:  16, spin: -1 },   // Azores High
  { lat:  28, lon:   75, r: 26, str:  22, spin: +1 },   // South Asian monsoon Low
  { lat:  10, lon:  165, r: 22, str:  18, spin: +1 },   // Tropical W Pacific
  // Southern hemisphere
  { lat: -60, lon:   30, r: 28, str:  22, spin: -1 },   // Sub-Antarctic low (S spins CW)
  { lat: -55, lon:  140, r: 30, str:  24, spin: -1 },
  { lat: -60, lon:  -90, r: 28, str:  22, spin: -1 },
  { lat: -30, lon:  -90, r: 28, str:  18, spin: +1 },   // S Pacific High (S highs spin CCW)
  { lat: -30, lon:  100, r: 28, str:  16, spin: +1 },   // S Indian High
  { lat: -32, lon:    5, r: 26, str:  16, spin: +1 },   // S Atlantic High
];

// Evaluate the analytical wind field at a lat/lon: the three-cell zonal base,
// planetary-wave perturbations, and the semi-permanent cyclones sum into a
// (u,v) vector and its speed. Cheap enough to call per streamline step.
export function sampleWindAt(lat, lon) {
  // ─── 1. Three-cell zonal base
  // u_base is symmetric about equator, alternates sign 3× per hemisphere
  // v_base is antisymmetric (toward equator in Hadley/Polar, away in Ferrel)
  const absLat = Math.abs(lat);
  const cellPhase = absLat * Math.PI / 30;       // period = 60°
  const baseMag   = -Math.sin(cellPhase) * 22;   // ±22 km/h
  const u = baseMag;                              // zonal
  let v = baseMag * Math.sign(lat);              // meridional, sign-mirrored

  // ─── 2. Planetary-wave perturbations
  // Multi-mode Fourier series over longitude, latitude-windowed by Gaussian envelopes
  const lonR = lon * Math.PI / 180;
  let du = 0, dv = 0;
  // Mid-latitude wave train
  du += 7  * Math.sin(2 * lonR + 0.5)  * Math.exp(-Math.pow((lat - 35) / 32, 2));
  du += 6  * Math.sin(3 * lonR - 1.2)  * Math.exp(-Math.pow((lat + 35) / 32, 2));
  du += 4  * Math.sin(5 * lonR + 2.3)  * Math.exp(-Math.pow(lat / 55, 2));
  // Tropical perturbation
  du -= 5  * Math.cos(4 * lonR - 0.8)  * Math.exp(-Math.pow(lat / 18, 2));
  // Subtropical jet meanders
  dv += 6  * Math.cos(2 * lonR - 0.3)  * Math.exp(-Math.pow((lat - 30) / 22, 2));
  dv += 5  * Math.cos(4 * lonR + 1.7)  * Math.exp(-Math.pow((lat + 35) / 22, 2));
  dv -= 5  * Math.cos(3 * lonR - 0.8)  * Math.exp(-Math.pow((lat - 50) / 28, 2));
  dv += 4  * Math.sin(5 * lonR + 0.6)  * Math.exp(-Math.pow(lat / 40, 2));

  // ─── 3. Cyclonic features
  let cu = 0, cv = 0;
  for (let i = 0; i < CYCLONES.length; i++) {
    const c = CYCLONES[i];
    const dlat = lat - c.lat;
    let dlon = lon - c.lon;
    if (dlon >  180) dlon -= 360;
    if (dlon < -180) dlon += 360;
    const d2 = dlat * dlat + dlon * dlon;
    const r2 = c.r * c.r;
    if (d2 > 9 * r2) continue;                  // outside ~3× radius
    const falloff = Math.exp(-d2 / r2);
    const ang = Math.atan2(dlat, dlon);          // rad, from +east axis CCW
    // Tangent direction (CCW perp to radial); spin flips it
    cu += -Math.sin(ang) * c.str * falloff * c.spin;
    cv +=  Math.cos(ang) * c.str * falloff * c.spin;
  }

  const finalU = u + du + cu;
  const finalV = v + dv + cv;
  const speed = Math.sqrt(finalU * finalU + finalV * finalV);
  return { u: finalU, v: finalV, speed };
}

// Trace one streamline from a random seed point through the wind field with an
// RK2 (midpoint) integrator, writing two vertices per step into the shared line
// buffers b at vertex vi. Returns the next free vertex.
function traceStreamline(streamId, vi, steps, b) {
  const { positions, arclens, streamIds, speeds, segPos } = b;
  let lat = -84 + Math.random() * 168;
  let lon = -180 + Math.random() * 360;
  const r = 1.012;
  let arclen = 0;
  let latR = lat * Math.PI / 180;
  let lonR = lon * Math.PI / 180;
  let prevX = Math.cos(latR) * Math.cos(lonR) * r;
  let prevY = Math.sin(latR) * r;
  let prevZ = -Math.cos(latR) * Math.sin(lonR) * r;
  let prevArclen = 0;
  let prevSpeed = 0;
  const stepGain = 0.05;
  for (let k = 0; k < steps; k++) {
    // RK2 midpoint
    const w1 = sampleWindAt(lat, lon);
    const cosLat1 = Math.max(0.15, Math.cos(lat * Math.PI / 180));
    const dlatMid = w1.v * stepGain * 0.5;
    const dlonMid = w1.u * stepGain * 0.5 / cosLat1;
    let latMid = lat + dlatMid;
    let lonMid = lon + dlonMid;
    if (lonMid >  180) lonMid -= 360;
    if (lonMid < -180) lonMid += 360;
    const w2 = sampleWindAt(latMid, lonMid);
    const cosLat2 = Math.max(0.15, Math.cos(latMid * Math.PI / 180));
    lat += w2.v * stepGain;
    lon += w2.u * stepGain / cosLat2;
    if (lon >  180) lon -= 360;
    if (lon < -180) lon += 360;
    if (lat >  86) lat =  86;
    if (lat < -86) lat = -86;
    latR = lat * Math.PI / 180;
    lonR = lon * Math.PI / 180;
    const x = Math.cos(latR) * Math.cos(lonR) * r;
    const y = Math.sin(latR) * r;
    const z = -Math.cos(latR) * Math.sin(lonR) * r;
    const dx = x - prevX, dy = y - prevY, dz = z - prevZ;
    arclen += Math.sqrt(dx*dx + dy*dy + dz*dz);
    const fracPrev = k / steps;
    const fracNow  = (k + 1) / steps;
    positions[vi*3+0] = prevX; positions[vi*3+1] = prevY; positions[vi*3+2] = prevZ;
    arclens[vi] = prevArclen; streamIds[vi] = streamId; speeds[vi] = prevSpeed; segPos[vi] = fracPrev;
    vi++;
    positions[vi*3+0] = x; positions[vi*3+1] = y; positions[vi*3+2] = z;
    arclens[vi] = arclen;     streamIds[vi] = streamId; speeds[vi] = w2.speed; segPos[vi] = fracNow;
    vi++;
    prevX = x; prevY = y; prevZ = z;
    prevArclen = arclen;
    prevSpeed = w2.speed;
  }
  return vi;
}

// Trace count streamlines of steps segments each into new typed arrays.
// onProgress(fraction) runs every 1024 lines (the boot gauge).
export function traceStreamlines(count, steps, onProgress) {
  const vertCount = count * steps * 2;
  const b = {
    positions: new Float32Array(vertCount * 3),
    arclens:   new Float32Array(vertCount),
    streamIds: new Float32Array(vertCount),
    speeds:    new Float32Array(vertCount),
    segPos:    new Float32Array(vertCount),
  };
  let vi = 0;
  for (let s = 0; s < count; s++) {
    vi = traceStreamline(s, vi, steps, b);
    if ((s & 1023) === 0 && onProgress) onProgress(s / count);
  }
  return b;
}
