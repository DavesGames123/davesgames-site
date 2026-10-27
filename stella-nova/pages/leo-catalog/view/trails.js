// ============================================================================
//  LEO CATALOG  ·  view/trails.js — orbit trails (selected object, stations)
// ----------------------------------------------------------------------------
//  Each trail is one closed THREE.Line in earthRoot: SGP4 run across one
//  orbital period T = 2 pi / n from SIM.time, in ORBIT_STEPS + 1 points.
//    selected   one cyan loop for the selected object. It is rebuilt when the
//               selection changes or SIM.time drifts 5 min from the last
//               build, and dropped when the trails overlay or the chip TRAIL
//               button is off.
//    stations   a loop per station-class object (ISS brighter). Rebuilt from
//               the catalog, and again whenever SIM.time drifts 60 s.
//
//  initTrails(ctx) gives the module the page state:
//    earthRoot, SIM, OVERLAY, sats(), selectedIdx()
//
//  grep -n targets: "export function initTrails", "function orbitPoints",
//  "function buildTrailFor", "export function maybeRebuildTrail",
//  "export function toggleChipTrail", "export function rebuildStationTrails",
//  "export function maybeRebuildStationTrails"
// ============================================================================
import * as THREE from 'three';
import { ecefToScene } from '../core/geo.js';
import { isISS } from '../core/tle.js';

let ctx = null;
export function initTrails(c) { ctx = c; }

const ORBIT_STEPS = 96;
// One orbital period of a satrec from baseT (ms), in the scene frame. Steps
// where SGP4 has no solution are left out.
function orbitPoints(satrec, baseT) {
  const periodMin = (2*Math.PI) / satrec.no;
  const pts = [];
  for (let i = 0; i <= ORBIT_STEPS; i++) {
    const t = new Date(baseT + (i/ORBIT_STEPS) * periodMin * 60000);
    const pv = satellite.propagate(satrec, t);
    if (!pv.position) continue;
    const ecef = satellite.eciToEcf(pv.position, satellite.gstime(t));
    pts.push(ecefToScene(ecef.x, ecef.y, ecef.z, new THREE.Vector3()));
  }
  return pts;
}

// Orbit trail for the selected object: one closed loop sampled over one period.
let trailLine = null;
let trailLastBuildTime = 0;
let trailLastIdx = -1;
let chipTrailEnabled = true;
function dropTrail() {
  if (trailLine) { ctx.earthRoot.remove(trailLine); trailLine.geometry.dispose(); trailLine = null; }
}
// Rebuild the selected object's trail by propagating it across one orbital
// period and stringing the points into a line.
function buildTrailFor(idx) {
  const sats = ctx.sats();
  if (idx < 0 || idx >= sats.length) return;
  const s = sats[idx];
  if (!s.satrec || s._isStorm) return;
  const pts = orbitPoints(s.satrec, ctx.SIM.time.getTime());
  dropTrail();
  if (pts.length < 2) return;
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0x5ad7ff, transparent: true, opacity: 0.55,
  });
  trailLine = new THREE.Line(geom, mat);
  ctx.earthRoot.add(trailLine);
}
// Rebuild the selected trail only when the selection changes or sim time has
// drifted far enough that the old loop is stale.
export function maybeRebuildTrail() {
  const selectedIdx = ctx.selectedIdx(), SIM = ctx.SIM;
  if (!ctx.OVERLAY.trails || !chipTrailEnabled || selectedIdx < 0) { dropTrail(); return; }
  const dtSinceBuild = SIM.time.getTime() - trailLastBuildTime;
  if (selectedIdx !== trailLastIdx || Math.abs(dtSinceBuild) > 300000) {
    buildTrailFor(selectedIdx);
    trailLastIdx = selectedIdx;
    trailLastBuildTime = SIM.time.getTime();
  }
}
// The chip TRAIL button: flip the selected trail on or off. Returns the new
// state; the caller then runs maybeRebuildTrail().
export function toggleChipTrail() { return (chipTrailEnabled = !chipTrailEnabled); }

// Always-on orbital trails for every station (ISS, Tiangong, Dragon, Cygnus, etc.)
// Every station gets a permanent orbit loop (ISS drawn brighter). Rebuilt from
// the catalog and refreshed periodically as SGP4 drifts.
const stationTrails = [];
let lastStationTrailBuild = -Infinity;
export function rebuildStationTrails() {
  const { earthRoot, SIM } = ctx, sats = ctx.sats();
  for (const st of stationTrails) {
    earthRoot.remove(st.line);
    st.line.geometry.dispose();
    st.line.material.dispose();
  }
  stationTrails.length = 0;
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i];
    if (s.cat !== 'station' || !s.satrec || s._isStorm) continue;
    const pts = orbitPoints(s.satrec, SIM.time.getTime());
    if (pts.length < 2) continue;
    const iss = isISS(s);
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: iss ? 0xffd070 : 0xe8e8d8,
      transparent: true,
      opacity: iss ? 0.65 : 0.32,
    });
    const line = new THREE.Line(geom, mat);
    earthRoot.add(line);
    stationTrails.push({ idx: i, line, isISS: iss });
  }
  lastStationTrailBuild = SIM.time.getTime();
}
export function maybeRebuildStationTrails() {
  // Rebuild every 60 sec of sim time so the closed loops stay accurate as
  // SGP4 drifts; also catches the case where stations were added later.
  const elapsed = ctx.SIM.time.getTime() - lastStationTrailBuild;
  if (Math.abs(elapsed) > 60000) rebuildStationTrails();
}
