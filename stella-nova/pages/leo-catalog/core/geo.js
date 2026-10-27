// ============================================================================
//  LEO CATALOG  ·  core/geo.js — frame conversions and the sun direction
// ----------------------------------------------------------------------------
//  COORDINATE FRAMES
//      ECEF   +X=lon0, +Y=lon90E, +Z=north      (satellite.js output, km)
//      scene  +X=lon0, +Y=north,  -Z=lon90E     (1 unit = 1 Earth radius)
//  So +Z faces the Americas, and a camera at +Z sees east go right.
//
//  sunDirEcef is a low-precision solar ephemeris in ECI, rotated into ECEF
//  by GMST (satellite.gstime, the global satellite.js), then remapped to
//  scene axes. It feeds the Earth shader's day/night terminator.
//
//  grep -n targets: "export const KM_TO_SCENE", "export function latLonToVec3",
//  "export function ecefToScene", "export function sunDirEcef"
// ============================================================================
import * as THREE from 'three';
import { EARTH_R_KM } from './tle.js';

export const KM_TO_SCENE = 1.0 / EARTH_R_KM;

export function latLonToVec3(latDeg, lonDeg, r) {
  const lat = latDeg * Math.PI/180;
  const lon = lonDeg * Math.PI/180;
  return new THREE.Vector3(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    -r * Math.cos(lat) * Math.sin(lon),
  );
}
export function ecefToScene(x, y, z, out) {
  // ECEF: +X=lon0, +Y=lon90, +Z=northpole.  Scene: +X=lon0, +Y=northpole, -Z=lon90.
  out.set(x * KM_TO_SCENE, z * KM_TO_SCENE, -y * KM_TO_SCENE);
  return out;
}
export function sunDirEcef(date) {
  const t = (date.getTime() - Date.UTC(2000,0,1,12,0,0)) / 86400000;
  const L = (280.46 + 0.9856474*t) * Math.PI/180;
  const g = (357.528 + 0.9856003*t) * Math.PI/180;
  const lambda = L + (1.915*Math.sin(g) + 0.020*Math.sin(2*g)) * Math.PI/180;
  const eps = 23.439 * Math.PI/180;
  const xEci = Math.cos(lambda);
  const yEci = Math.cos(eps) * Math.sin(lambda);
  const zEci = Math.sin(eps) * Math.sin(lambda);
  const gmst = satellite.gstime(date);
  const cg = Math.cos(gmst), sg = Math.sin(gmst);
  const xEc =  cg*xEci + sg*yEci;
  const yEc = -sg*xEci + cg*yEci;
  const zEc =  zEci;
  return new THREE.Vector3(xEc, zEc, -yEc).normalize();
}
