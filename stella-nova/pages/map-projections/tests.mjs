// ============================================================================
//  MAP PROJECTIONS  ·  tests.mjs — node tests.mjs  (no browser, no network)
// ----------------------------------------------------------------------------
//  1. forward formulas against PROJ 9.8 (tests/proj-ref.json, made by
//     tools/proj-ref.py through pyproj)
//  2. inverse round trips, normal, transverse and oblique aspects
//  3. equal-area maps keep the area scale a b constant to 1e-6 (relative)
//  4. conformal maps have a = b to 1e-6, on the sphere and the ellipsoid
//  5. ellipsoid formulas (Mercator, UTM, Lambert conic) and Vincenty
//  Each check prints one line; the run exits 1 on any failure.
// ============================================================================
import fs from 'node:fs';
import * as P from './proj.js';

const HERE = new URL('.', import.meta.url).pathname;
const D = Math.PI / 180;
const ref = JSON.parse(fs.readFileSync(HERE + 'tests/proj-ref.json', 'utf8'));
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fails++; console.log((cond ? 'pass ' : 'FAIL ') + msg); };
const e = v => v.toExponential(1);

// ── 1. forward vs PROJ ──────────────────────────────────────────────────────
// Robinson is defined by a table; PROJ and this page interpolate it with
// different cubics, so between the nodes the tolerance is 2e-3 (0.1% of
// the map height); at the nodes (multiples of 5 deg) it is 1e-6.
console.log(`# forward formulas vs PROJ ${ref.proj} (pyproj ${ref.pyproj})`);
const ACC = {};
for (const c of ref.cases) {
  if (c.key.startsWith('ell-') || c.key === 'web-mercator') continue;
  const st = { lon: c.par.lon ?? 0, lat: c.par.lat ?? 0, lat0: c.par.lat0, lat1: c.par.lat1, lat2: c.par.lat2 };
  if (c.par.lat != null) st.aspect = 'oblique';
  const m = P.makeMap(c.key, st);
  let worst = 0, worstNode = 0, n = 0;
  for (const [lo, la, x, y] of c.rows) {
    const q = m.fwd(lo * D, la * D);
    const err = q ? Math.hypot(q[0] - x, q[1] - y) : Infinity;
    n++;
    if (c.key === 'robinson' && la % 5 === 0) worstNode = Math.max(worstNode, err);
    worst = Math.max(worst, err);
  }
  ACC[c.key] = worst;
  if (c.key === 'robinson') {
    ok(worstNode < 1e-6, `robinson at table nodes: max error ${e(worstNode)} (R = 1)`);
    ok(worst < 2e-3, `robinson between nodes: max error ${e(worst)} (tolerance 2e-3)`);
  } else ok(worst < 1e-9, `${c.key}: ${n} points, max error ${e(worst)} (R = 1)`);
}

// ── 2. inverse round trips ─────────────────────────────────────────────────
console.log('# inverse round trips (great-circle error, radians)');
for (const def of P.PROJ) {
  for (const aspect of ['normal', 'transverse', 'oblique']) {
    if (def.noAspect && aspect !== 'normal') continue;
    const st = Object.assign({}, P.HOME[def.key] || {}, { aspect });
    if (aspect === 'oblique') Object.assign(st, { lon: 20, lat: 35, roll: 10 });
    const m = P.makeMap(def.key, st);
    let n = 0, miss = 0, worst = 0;
    for (let lo = -175; lo <= 175; lo += 10) for (let la = -85; la <= 85; la += 10) {
      const q = m.fwd(lo * D, la * D); if (!q) continue; n++;
      const r = m.inv(q[0], q[1]);
      if (!r) { miss++; continue; }
      worst = Math.max(worst, P.gcDist(lo * D, la * D, r[0], r[1]));
    }
    ok(miss === 0 && worst < 1e-7 && n > 100, `${def.key} ${aspect}: ${n} points, ${miss} missed, max ${e(worst)}`);
  }
}

// ── 3 and 4. distortion ────────────────────────────────────────────────────
console.log('# equal area (a b constant) and conformality (a = b)');
function grid(m, fn) {
  let worst = 0, n = 0;
  for (let lo = -165; lo <= 165; lo += 15) for (let la = -75; la <= 75; la += 15) {
    const q = m.fwd(lo * D, la * D); if (!q) continue;
    // stay off the cut and the lobe edges, where one side is the other lobe
    const v = P.apply(m.M, P.vec(lo * D, la * D)), l = Math.atan2(v[1], v[0]), p = Math.asin(v[2]);
    if (m.rects.some(r => Math.abs(l - r[0]) < 0.02 || Math.abs(l - r[1]) < 0.02 || Math.abs(p - r[2]) < 0.02 || Math.abs(p - r[3]) < 0.02)) continue;
    const t = P.distortion(m, lo * D, la * D); if (!t) continue;
    worst = Math.max(worst, fn(t)); n++;
  }
  return { worst, n };
}
for (const def of P.PROJ) {
  if (def.prop !== 'equal-area' && def.prop !== 'conformal') continue;
  for (const aspect of def.noAspect ? ['normal'] : ['normal', 'oblique']) {
    const st = Object.assign({}, P.HOME[def.key] || {}, { aspect });
    if (aspect === 'oblique') Object.assign(st, { lon: -40, lat: 25, roll: 30 });
    const m = P.makeMap(def.key, st);
    if (def.prop === 'equal-area') {
      const s0 = P.distortion(m, st.lon * D || 0.1, 0.1).s;
      const g = grid(m, t => Math.abs(t.s / s0 - 1));
      ok(g.worst < 1e-6 && g.n > 50, `${def.key} ${aspect}: area scale constant over ${g.n} points, max deviation ${e(g.worst)}`);
    } else {
      const g = grid(m, t => t.a / t.b - 1);
      ok(g.worst < 1e-6 && g.n > 50, `${def.key} ${aspect}: a/b - 1 over ${g.n} points, max ${e(g.worst)}`);
    }
  }
}
// The compromise maps must NOT pass either test (a sanity check of the test).
{
  const m = P.makeMap('robinson'), g = grid(m, t => Math.abs(t.s - 1)), c = grid(m, t => t.a / t.b - 1);
  ok(g.worst > 0.1 && c.worst > 0.1, `robinson is neither: area deviation ${g.worst.toFixed(2)}, a/b - 1 up to ${c.worst.toFixed(2)}`);
}

// ── 5. ellipsoid and geodesy ───────────────────────────────────────────────
console.log('# ellipsoid (WGS84, metres) and geodesics');
const E = P.WGS84, ell = { e2: E.e2 };
const caseOf = k => ref.cases.find(c => c.key === k);
{
  let w = 0, wi = 0;
  for (const [lo, la, x, y] of caseOf('ell-mercator').rows) {
    const q = P.mercEll(lo * D, la * D), b = P.mercEllInv(x, y);
    w = Math.max(w, Math.hypot(q[0] - x, q[1] - y)); wi = Math.max(wi, Math.hypot(b[0] / D - lo, b[1] / D - la));
  }
  ok(w < 1e-6 && wi < 1e-10, `ellipsoidal Mercator: forward ${e(w)} m, inverse ${e(wi)} deg`);
  let ww = 0;
  for (const [lo, la, x, y] of caseOf('web-mercator').rows) ww = Math.max(ww, Math.hypot(E.a * lo * D - x, E.a * Math.asinh(Math.tan(la * D)) - y));
  ok(ww < 1e-6, `Web Mercator (EPSG:3857, spherical formula on WGS84 lat/lon): ${e(ww)} m`);
}
{
  let w = 0, wi = 0;
  for (const [lo, la, x, y] of caseOf('ell-utm33').rows) {
    const q = P.tmEll(lo * D, la * D, 15 * D, 0.9996);
    w = Math.max(w, Math.hypot(q[0] + 500000 - x, q[1] - y));
    const b = P.tmEllInv(x - 500000, y, 15 * D, 0.9996);
    wi = Math.max(wi, Math.hypot(b[0] / D - lo, b[1] / D - la));
  }
  ok(w < 1e-6 && wi < 1e-11, `UTM zone 33 (Kruger n^6): forward ${e(w)} m, inverse ${e(wi)} deg`);
  let w2 = 0;
  for (const [lo, la, x, y] of caseOf('ell-tm-wide').rows) { const q = P.tmEll(lo * D, la * D); w2 = Math.max(w2, Math.hypot(q[0] - x, q[1] - y)); }
  ok(w2 < 1e-3, `transverse Mercator up to 40 deg from the central meridian: ${e(w2)} m`);
  const u = P.utm(-74.0445 * D, 40.6892 * D);   // the Statue of Liberty
  ok(u.zone === 18 && u.hemi === 'N', `utm(): New York is zone ${u.zone}${u.hemi}`);
}
{
  const c = caseOf('ell-lcc'), L = P.lccEll(39 * D, 33 * D, 45 * D);
  let w = 0; for (const [lo, la, x, y] of c.rows) { const q = L.fwd((lo + 96) * D, la * D); w = Math.max(w, Math.hypot(q[0] - x, q[1] - y)); }
  ok(w < 1e-6, `ellipsoidal Lambert conformal conic (33, 45): ${e(w)} m`);
}
{
  // Conformal on the ellipsoid: the ground metric is M dphi, N cos(phi) dlon.
  const fns = [['Mercator', (l, p) => P.mercEll(l, p)], ['transverse Mercator', (l, p) => P.tmEll(l, p)], ['Lambert conformal conic', P.lccEll(39 * D, 33 * D, 45 * D).fwd]];
  for (const [name, f] of fns) {
    let w = 0;
    for (let lo = -30; lo <= 30; lo += 10) for (let la = -60; la <= 70; la += 10) {
      if (name.startsWith('Lambert') && la < 0) continue;
      const t = P.distortion(null, lo * D, la * D, ell, f); w = Math.max(w, t.a / t.b - 1);
    }
    ok(w < 1e-6, `ellipsoidal ${name} is conformal on WGS84: a/b - 1 <= ${e(w)}`);
  }
  // Web Mercator is not: the spherical formula on ellipsoidal latitudes.
  const t = P.distortion(null, 0, 0.0, ell, (l, p) => [l, Math.asinh(Math.tan(p))]);
  ok(Math.abs(t.a / t.b - 1 - E.e2 / (1 - E.e2)) < 1e-6, `Web Mercator on WGS84 is not conformal: a/b = ${(t.a / t.b).toFixed(5)} at the equator (1/(1 - e^2) = ${(1 / (1 - E.e2)).toFixed(5)})`);
}
{
  let w = 0, wb = 0;
  for (const [a, b, c, d, m, az] of ref.geod) { const v = P.vincenty(a * D, b * D, c * D, d * D); w = Math.max(w, Math.abs(v.m - m)); wb = Math.max(wb, Math.abs(v.brg / D - az)); }
  ok(w < 1e-3 && wb < 1e-8, `Vincenty vs PROJ geodesic (4 pairs): ${e(w)} m, bearing ${e(wb)} deg`);
  const gc = P.gcDist(-74.006 * D, 40.7128 * D, 139.6917 * D, 35.6895 * D) * P.R_EARTH;
  ok(Math.abs(gc - 10848) < 15, `great circle New York - Tokyo on the sphere: ${gc.toFixed(0)} km`);
  const r = P.rhumb(-74.006 * D, 40.7128 * D, 139.6917 * D, 35.6895 * D);
  ok(r.dist * P.R_EARTH > gc, `rhumb line New York - Tokyo is longer: ${(r.dist * P.R_EARTH).toFixed(0)} km`);
  const cap = [];
  for (let i = 0; i < 360; i++) cap.push(-i * D, -60 * D);   // walk west at 60 S: the cap around the pole
  const exact = 2 * Math.PI * (1 - Math.sin(60 * D));
  ok(Math.abs(P.sphArea(cap) / exact - 1) < 2e-3, `sphArea of the cap south of 60 S: ${P.sphArea(cap).toFixed(5)} sr (exact ${exact.toFixed(5)}; chords cut the small circle)`);
}

console.log(`\n${checks - fails}/${checks} checks passed`);
// Accuracy table for the report.
console.log('max |error| vs PROJ (R = 1): ' + Object.entries(ACC).map(([k, v]) => `${k} ${v.toExponential(0)}`).join(', '));
process.exit(fails ? 1 : 0);
