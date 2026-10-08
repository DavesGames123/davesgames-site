// ============================================================================
//  MAP PROJECTIONS  ·  tests.mjs — node tests.mjs  (no browser, no network)
// ----------------------------------------------------------------------------
//  1. forward formulas against PROJ 9.8 (tests/proj-ref.json, made by
//     tools/proj-ref.py through pyproj)
//  2. inverse round trips, normal, transverse and oblique aspects
//  3. equal-area maps keep the area scale a b constant to 1e-6 (relative)
//  4. conformal maps have a = b to 1e-6, on the sphere and the ellipsoid
//  5. ellipsoid formulas (Mercator, UTM, Lambert conic) and Vincenty
//  6. clipping: antimeridian cut, pole closure, small-circle edge (geo.js)
//  7. the card math: every h, k and s that cards.js states as TeX, written
//     here again as JS, against the numerical Jacobian (proj.js
//     distortion), to 1e-5 relative, on a 30 x 15 degree grid
//  8. the outlines of the unusual maps (van der Grinten circle, August
//     pole, Larrivee pole line, the Werner heart)
//  9. phones: the canvas pixel ratio cap (render.js mapDpr), and the
//     phone rules in style.css and index.html (no browser: text checks)
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

// ── 6. clipping ────────────────────────────────────────────────────────────
const G = await import('./geo.js').catch(err => { console.log('FAIL geo.js did not load: ' + err.message); fails++; return null; });
if (G) {
  console.log('# clipping (geo.js)');
  const ringDeg = pts => pts.map(([lo, la]) => P.vec(lo * D, la * D));
  const areaOf = pieces => pieces.reduce((s, pc) => { let a = 0; const q = pc.xy; for (let i = 0, n = q.length / 2; i < n; i++) { const j = (i + 1) % n; a += q[2 * i] * q[2 * j + 1] - q[2 * j] * q[2 * i + 1]; } return s + a / 2; }, 0);
  const frame = (key, st) => G.frameOf(P.makeMap(key, st), { k: 1, x: 0, y: 0, sy: 1 });   // raw units, y up
  // A box across the antimeridian, 170 E to 170 W, 10 S to 10 N.
  const box = ringDeg([[170, -10], [180, -10], [-170, -10], [-170, 10], [180, 10], [170, 10]]);
  {
    const f = frame('equirectangular', {});
    const out = G.clipPolygon([box], [f]);
    const xs = out.map(pc => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < pc.xy.length; i += 2) { lo = Math.min(lo, pc.xy[i]); hi = Math.max(hi, pc.xy[i]); } return [lo, hi]; });
    const a = areaOf(out), exact = 20 * D * 20 * D;
    ok(out.length === 2 && xs.some(([lo, hi]) => Math.abs(hi - Math.PI) < 1e-9) && xs.some(([lo]) => Math.abs(lo + Math.PI) < 1e-9),
      `a box over the antimeridian is cut into ${out.length} pieces that end at x = +-pi`);
    ok(Math.abs(a / exact - 1) < 0.01, `the two pieces keep the area: ${a.toFixed(5)} vs ${exact.toFixed(5)} (great-circle edges vs parallels)`);
    const f2 = frame('equirectangular', { lon: 180 });
    const out2 = G.clipPolygon([box], [f2]);
    ok(out2.length === 1, `centred on 180 the same box is one piece (${out2.length})`);
    const lines = G.clipLine(box.concat([box[0]]), [f]);
    const jump = lines.some(l => { for (let i = 2; i < l.xy.length; i += 2) if (Math.abs(l.xy[i] - l.xy[i - 2]) > Math.PI) return true; return false; });
    ok(lines.length >= 2 && !jump, `the box outline as a line: ${lines.length} runs (the east side splits at the start point), no segment jumps across the map`);
  }
  {
    // A ring around the south pole (walks west at 70 S): Antarctica's case.
    const ring = []; for (let lo = 180; lo > -180; lo -= 5) ring.push([lo, -70]);
    const f = frame('equirectangular', { lon: 37 });
    const out = G.clipPolygon([ringDeg(ring)], [f]);
    const a = areaOf(out), exact = 2 * Math.PI * (Math.PI / 2 - 70 * D);   // the strip below -70 in plate carree
    ok(out.length <= 2 && Math.abs(a / exact - 1) < 0.01, `a pole ring is closed along the pole: ${out.length} piece(s) side by side, area ${a.toFixed(4)} vs ${exact.toFixed(4)}`);
    const f2 = frame('mollweide', { lon: 0 });
    const o2 = G.clipPolygon([ringDeg(ring)], [f2]);
    ok(o2.length === 1 && areaOf(o2) > 0, `on Mollweide, a ring that starts on the cut gives one piece and no slivers: ${o2.length}, area ${areaOf(o2).toFixed(4)} > 0`);
    const fo = frame('orthographic', { lon: 0, lat: -90, aspect: 'normal' });
    const o3 = G.clipPolygon([ringDeg(ring)], [fo]);
    const r3 = Math.cos(70 * D), disc = Math.PI * r3 * r3;
    ok(o3.length >= 1 && Math.abs(areaOf(o3) / disc - 1) < 0.01, `seen from below the south pole it is a disc: area ${areaOf(o3).toFixed(4)} vs ${disc.toFixed(4)}`);
  }
  {
    // Small-circle edge: a big box on the orthographic map from (0, 0) is
    // cut by the horizon; every point of the result lies inside the disc.
    const big = ringDeg([[-120, -30], [120, -30], [120, 30], [-120, 30]]);
    const f = frame('orthographic', { lon: 0, lat: 0, aspect: 'oblique' });
    const out = G.clipPolygon([big], [f]);
    let rmax = 0; for (const pc of out) for (let i = 0; i < pc.xy.length; i += 2) rmax = Math.max(rmax, Math.hypot(pc.xy[i], pc.xy[i + 1]));
    ok(out.length >= 1 && rmax <= 1 + 1e-9, `the horizon cut keeps the polygon in the disc: ${out.length} piece(s), max radius ${rmax.toFixed(9)}`);
  }
  {
    // Interrupted map: a box over the lobe edge at 40 W (north) is cut in two.
    const b = ringDeg([[-50, 10], [-30, 10], [-30, 30], [-50, 30]]);
    const out = G.clipPolygon([b], [frame('goode', {})]);
    ok(out.length === 2, `Goode: a box over the 40 W interruption becomes ${out.length} pieces`);
  }
}

// ── 7. the card math ───────────────────────────────────────────────────────
// Cylinders and world maps: normal aspect on lon 0, so l is the longitude.
// Azimuthals: polar aspect on the north pole, so c = pi/2 - phi, h is the
// radial scale and k the scale round the centre. Conics: the HOME view, so
// l is the longitude from its centre and n, rho come from its parallels.
console.log('# the card math (cards.js scale) vs the numerical Jacobian');
{
  const { cos, sin, tan, sqrt, log, PI, pow } = Math, sec = x => 1 / cos(x), c45 = cos(PI / 4);
  const mollTheta = p => { let t = p; for (let i = 0; i < 60; i++) { const f = 2 * t + sin(2 * t) - PI * sin(p), d = 2 + 2 * cos(2 * t); if (Math.abs(d) < 1e-14) break; t -= f / d; } return t; };
  const conicOf = key => {
    const H = P.HOME[key], p1 = H.lat1 * D, p2 = H.lat2 * D, tq = p => tan(PI / 4 + p / 2);
    if (key === 'albers') { const n = (sin(p1) + sin(p2)) / 2, C = cos(p1) ** 2 + 2 * n * sin(p1); return { n, rho: p => sqrt(C - 2 * n * sin(p)) / n }; }
    if (key === 'lambert-conformal') { const n = log(cos(p1) / cos(p2)) / log(tq(p2) / tq(p1)), F = cos(p1) * pow(tq(p1), n) / n; return { n, rho: p => F / pow(tq(p), n) }; }
    const n = (cos(p1) - cos(p2)) / (p2 - p1), G = cos(p1) / n + p1; return { n, rho: p => G - p };
  };
  const cyl = (f) => ({ st: { aspect: 'normal', lon: 0, lat: 0 }, f });
  const az = (f) => ({ st: { aspect: 'normal', lon: 0, lat: 90 }, az: true, f: (l, p) => f(PI / 2 - p) });
  const con = (key, f) => ({ st: Object.assign({}, P.HOME[key], { aspect: 'normal' }), conic: true, f: (l, p) => { const c = conicOf(key); return f(c.n * c.rho(p) / cos(p)); } });
  const EXP = {
    mercator: cyl((l, p) => ({ h: sec(p), k: sec(p), s: sec(p) ** 2 })),
    'web-mercator': cyl((l, p) => ({ h: sec(p), k: sec(p), s: sec(p) ** 2 })),
    'transverse-mercator': cyl((l, p) => { const B = cos(p) * sin(l), k = 1 / sqrt(1 - B * B); return { h: k, k }; }),
    equirectangular: cyl((l, p) => ({ h: 1, k: sec(p), s: sec(p) })),
    'lambert-cylindrical': cyl((l, p) => ({ h: cos(p), k: sec(p), s: 1 })),
    'gall-peters': cyl((l, p) => ({ h: cos(p) / c45, k: c45 / cos(p), s: 1 })),
    'hobo-dyer': cyl((l, p) => { const c = cos(37.5 * D); return { h: cos(p) / c, k: c / cos(p), s: 1 }; }),
    werner: cyl(() => ({ k: 1, s: 1 })),
    mollweide: cyl((l, p) => ({ k: 2 * Math.SQRT2 * cos(mollTheta(p)) / (PI * cos(p)), s: 1 })),
    hammer: cyl(() => ({ s: 1 })),
    'equal-earth': cyl(() => ({ s: 1 })),
    'eckert-iv': cyl(() => ({ s: 1 })),
    sinusoidal: cyl((l, p) => ({ h: sqrt(1 + l * l * sin(p) ** 2), k: 1, s: 1 })),
    goode: cyl(() => ({ s: 1 })),
    orthographic: az(c => ({ h: cos(c), k: 1 })),
    stereographic: az(c => ({ h: sec(c / 2) ** 2, k: sec(c / 2) ** 2 })),
    gnomonic: az(c => ({ h: sec(c) ** 2, k: sec(c) })),
    'azimuthal-equidistant': az(c => ({ h: 1, k: c / sin(c) })),
    'lambert-azimuthal': az(c => ({ h: cos(c / 2), k: sec(c / 2), s: 1 })),
    albers: con('albers', k => ({ h: 1 / k, k, s: 1 })),
    'lambert-conformal': con('lambert-conformal', k => ({ h: k, k })),
    'equidistant-conic': con('equidistant-conic', k => ({ h: 1, k })),
    bonne: cyl(() => ({ k: 1, s: 1 })),
    polyconic: cyl(() => ({ k: 1 })),
  };
  EXP.bonne.st = Object.assign({}, P.HOME.bonne, { aspect: 'normal' });
  for (const [key, X] of Object.entries(EXP)) {
    const m = P.makeMap(key, X.st), lon0 = X.st.lon || 0;
    let worst = 0, n = 0;
    for (let lo = -150; lo <= 150; lo += 30) for (let la = X.az ? 30 : -75; la <= 75; la += 15) {
      if (key === 'gnomonic' && la < 35) continue;
      const L = (lon0 + lo) * D, p = la * D, t = P.distortion(m, L, p); if (!t) continue;
      const want = X.f(lo * D, p);
      for (const q of ['h', 'k', 's']) if (q in want) worst = Math.max(worst, Math.abs(t[q] - want[q]) / want[q]);
      n++;
    }
    ok(n > 20 && worst < 1e-5, `${key}: card scale factors at ${n} points, max relative error ${e(worst)}`);
  }
}

// ── 8. the outlines of the unusual maps ────────────────────────────────────
console.log('# unusual maps: outlines');
{
  const raw = key => P.BY_KEY[key].build({}).raw;
  const vdg = raw('van-der-grinten'), aug = raw('august'), lar = raw('larrivee'), wer = raw('werner');
  let rim = 0; for (let la = -89; la <= 89; la += 1) for (const s of [-1, 1]) { const [x, y] = vdg(s * Math.PI, la * D); rim = Math.max(rim, Math.abs(Math.hypot(x, y) - Math.PI)); }
  ok(rim < 1e-9, `van der grinten: the meridians at +-180 lie on the circle of radius pi (max off ${e(rim)})`);
  const eq = [-170, -90, -30, 45, 120].every(lo => { const [x, y] = vdg(lo * D, 0); return Math.abs(x - lo * D) < 1e-12 && y === 0; });
  ok(eq, 'van der grinten: the equator is x = lambda, y = 0');
  const pole = aug(1.3, Math.PI / 2);
  ok(Math.abs(pole[0]) < 1e-12 && Math.abs(pole[1] - 8 / 3) < 1e-12, `august: the North Pole maps to (0, 8/3) (${pole.map(v => v.toFixed(12)).join(', ')})`);
  const lp = lar(2, Math.PI / 2);
  // cos(pi/2) is 6e-17 in floats, and its square root 8e-9
  ok(Math.abs(lp[0] - 1) < 1e-7, `larrivee: the pole is a line with x = lambda / 2 (off ${e(Math.abs(lp[0] - 1))})`);
  const wp = wer(2, Math.PI / 2), ws = wer(0, -Math.PI / 2);
  ok(Math.hypot(...wp) < 1e-12 && Math.abs(ws[1] + Math.PI) < 1e-12, 'werner: the North Pole is the notch of the heart, the South Pole its tip at y = -pi');
}

// ── 9. phones ──────────────────────────────────────────────────────────────
console.log('# phones: pixel ratio, targets, overflow');
{
  const { mapDpr } = await import('./render.js');
  ok([[3, 2], [2.625, 2], [2, 2], [1.5, 1.5], [1, 1], [0.5, 1], [undefined, 1]].every(([d, w]) => mapDpr(d) === w),
    'mapDpr: a DPR 3 phone draws at 2, so the map canvas has 4/9 of the pixels; DPR below 1 draws at 1');
  // 430 x 932 css px phone, DPR 3: two full-stage canvases (map, tools) at 4 B a pixel
  const mb = d => 2 * 430 * 932 * d * d * 4 / 1e6;
  ok(mb(mapDpr(3)) < 14, `mapDpr: the two stage canvases on a 430 x 932 DPR 3 phone hold ${mb(mapDpr(3)).toFixed(1)} MB, not ${mb(3).toFixed(1)} MB`);
  const css = fs.readFileSync(HERE + 'style.css', 'utf8'), html = fs.readFileSync(HERE + 'index.html', 'utf8');
  const bodyRules = [...css.matchAll(/(^|\})\s*body\s*\{([^}]*)\}/g)].map(m => m[2]).join(';');
  ok(!/overflow-x/.test(bodyRules) && /html\{overflow-x:hidden\}/.test(css), 'style.css: overflow-x is on html only, never on body (sticky elements)');
  const touch = css.slice(css.indexOf('/* TOUCH'), css.indexOf('/* PHONE'));
  const mins = [...touch.matchAll(/min-height:(\d+)px/g)].map(m => +m[1]), hs = [...touch.matchAll(/(?:^|[;{])\s*(?:width|height):(\d+)px/g)].map(m => +m[1]).filter(v => v > 30);
  ok(mins.length >= 8 && mins.every(v => v >= 40) && hs.every(v => v >= 44), `style.css TOUCH: every min-height is 40 px or more (${mins.join(', ')}), button sizes 44 px`);
  const rems = [...css.slice(css.indexOf('/* TOUCH')).matchAll(/font-size:([\d.]+)rem/g)].map(m => +m[1]);
  ok(rems.every(v => v * 16 >= 12), `style.css TOUCH and PHONE: all text 12 px or more (smallest ${(Math.min(...rems) * 16).toFixed(1)} px)`);
  const vp = (html.match(/<meta name="viewport" content="([^"]*)"/) || [])[1] || '';
  ok(/width=device-width/.test(vp) && /viewport-fit=cover/.test(vp) && !/user-scalable=no|maximum-scale=1\b/.test(vp), `index.html viewport: "${vp}"`);
  ok(/touch-action:none/.test(css.match(/#stage\{[^}]*\}/)[0]) && /touch-action:none/.test(css.match(/#globeBox\{[^}]*\}/)[0]), 'style.css: the stage and the globe set touch-action: none (pinch goes to the map)');
}

console.log(`\n${checks - fails}/${checks} checks passed`);
// Accuracy table for the report.
console.log('max |error| vs PROJ (R = 1): ' + Object.entries(ACC).map(([k, v]) => `${k} ${v.toExponential(0)}`).join(', '));
process.exit(fails ? 1 : 0);
