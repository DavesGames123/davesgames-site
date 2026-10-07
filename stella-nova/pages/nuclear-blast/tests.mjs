// ============================================================================
//  NUCLEAR BLAST EFFECTS  ·  tests.mjs — node stella-nova/pages/nuclear-blast/tests.mjs
// ----------------------------------------------------------------------------
//  Checks effects.js against published reference values. Each line names
//  the source and the tolerance. Tolerances follow the accuracy that the
//  source states (G&D curves are read to about 10%; the summary tables are
//  rounded to 2 figures; G&D 8.33 gives the radiation curves to a factor
//  of 2).
//    blast ....... the worked examples of G&D 3.72-3.77, and the 20/5/1 psi
//                  ground ranges of the Wikipedia summary table
//    fireball .... G&D 2.127 radii, the Mach stem example of G&D 2.34
//    thermal ..... G&D 7.85 example (pulse), burn ranges of the Nuclear
//                  Weapons FAQ 5.1 and the Wikipedia summary table
//    radiation ... 1 Gy and 10 Gy slant ranges of the Wikipedia table
//    fallout ..... the G&D 9.98 worked example (10 MT, 30 mph)
//    cloud ....... G&D Table 2.12 (rise of a 1 Mt cloud)
//    shape ....... monotone curves, round trips of the inverse functions
//    map ......... the 5 psi ring on the place map: its on-screen radius at
//                  two zooms and two latitudes equals R / metresPerPixel
//    seams ....... places.js mendSeams: a water line at a WorldCover tile
//                  edge goes (London, 0 deg E, land cover and water); a
//                  river four pixels wide stays
// ============================================================================
import * as E from './effects.js';
import * as G from './geo.js';
import { mendSeams } from './places.js';
import { parseCity, inflate } from '../city-atlas/data.js';
import fs from 'node:fs';

const FT = 0.3048, MI = 1609.344;
let fail = 0, n = 0;
function check(name, got, want, tol) {
  n++;
  const err = Math.abs(got - want) / Math.abs(want), pass = err <= tol;
  if (!pass) fail++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}: ${fmt(got)} vs ${fmt(want)} (${(err * 100).toFixed(1)}%, tol ${(tol * 100).toFixed(0)}%)`);
}
function ok(name, c) { n++; if (!c) fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}`); }
const fmt = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3);

// ── blast: G&D worked examples ───────────────────────────────────────────
check('G&D 3.72 free air, 1 kt at 1,360 ft (psi)', E.psi(E.freeAir1kt(1360 * FT)), 4.2, 0.05);
check('G&D 3.73b 100 kt, h 2,320 ft, d 1,860 ft (psi)', E.psi(E.overpressure(1860 * FT, 100, 2320 * FT)), 50, 0.15);
{
  const h = E.optimumHeight(4 * E.PSI, 125);
  check('G&D 3.73c 125 kt, max range of 4 psi (ft)', E.rangeFor(4 * E.PSI, 125, h) / FT, 13000, 0.05);
  check('G&D 3.73c 125 kt, burst height for it (ft)', h / FT, 5500, 0.25);
}
check('G&D 3.75 160 kt, h 3,000 ft, d 6,000 ft, dynamic (psi)', E.psi(E.dynamicPressure(6000 * FT, 160, 3000 * FT)), 3, 0.15);
check('G&D 3.76 160 kt, h 3,000 ft, d 4,000 ft, duration (s)', E.positiveDuration(4000 * FT, 160, 3000 * FT), 1.0, 0.15);
check('G&D 3.77b 1 MT, h 5,000 ft, 10 mi, arrival (s)', E.arrivalTime(10 * MI, 1000, 5000 * FT), 40, 0.05);
// High-pressure end: the DNA fit is meant for p < ~1,000 psi. Report it, wide.
check('G&D 3.73a 80 kt, h 860 ft, reach of 1,000 psi (ft) [edge of fit]', E.rangeFor(1000 * E.PSI, 80, 860 * FT) / FT, 475, 0.45);
check('G&D 3.56.1 reflection factor, weak shock', E.reflectionFactor(1), 2, 0.001);
check('G&D 3.56.1 reflection factor, strong shock', E.reflectionFactor(1e9), 8, 0.001);
check('G&D 2.34 Mach stem, 1 MT at 6,500 ft (mi)', E.machStemRange(1000, 6500 * FT) / MI, 1.3, 0.1);

// ── blast: summary table (ground ranges, km) ─────────────────────────────
const TABLE = [[1, 200, 0.2, 0.6, 1.7], [20, 540, 0.6, 1.7, 4.7], [1000, 2000, 2.4, 6.2, 17], [20000, 5400, 6.4, 17, 47]];
for (const [W, h, a, b, c] of TABLE) {
  check(`table ${W} kt / ${h} m, 20 psi (km)`, E.rangeFor(20 * E.PSI, W, h) / 1000, a, 0.2);
  check(`table ${W} kt / ${h} m, 5 psi (km)`, E.rangeFor(5 * E.PSI, W, h) / 1000, b, 0.1);
  check(`table ${W} kt / ${h} m, 1 psi (km)`, E.rangeFor(1 * E.PSI, W, h) / 1000, c, 0.1);
}

// ── fireball ───────────────────────────────────────────────────────────────
check('G&D 2.127 breakaway, 20 kt air (ft)', E.fireballSizes(20, 1e4).breakaway / FT, 100 * 20 ** 0.4, 0.001);
check('G&D 2.127 breakaway, 20 kt contact (ft)', E.fireballSizes(20, 0).breakaway / FT, 145 * 20 ** 0.4, 0.02);
check('G&D 2.120 shock at breakaway, 20 kt: ~15 ms (s)', E.arrivalOfRadius(E.fireballSizes(20, 1e4).breakaway, 20), 0.015, 0.25);
check('G&D 2.03 fireball of 1 MT: about 5,700 ft across (ft)', 2 * E.fireballSizes(1000, 1e5).max / FT, 5700, 0.15);
check('G&D 2.128 no local fallout above, 1 MT (ft)', E.falloutCeiling(1000) / FT, 2900, 0.03);

// ── thermal ──────────────────────────────────────────────────────────────
check('G&D 7.85 t_max, 500 kt (s)', E.thermalPeakTime(500), 0.64, 0.02);
check('G&D 7.85 power at 1 s, 500 kt (kt/s)', E.thermalPower(1, 500), 60.8, 0.1);
check('G&D 7.85 energy fraction by 1 s, 500 kt', E.pulseEnergy(1 / E.thermalPeakTime(500)), 0.40, 0.1);
check('G&D 7.84 energy fraction by 10 t_max', E.pulseEnergy(10), 0.80, 0.12);
{
  let e1 = 0; const W = 20, tm = E.tThermalMin(W);
  for (let i = 0; i < 4000; i++) { const t = (i + 0.5) * tm * 4 / 4000; e1 += E.firstPulse(t, W) * tm * 4 / 4000; }
  check('G&D 7.03 first pulse share of the thermal energy, 20 kt', e1 / (0.35 * W), 0.01, 0.2);
}
check('G&D 7.101 contact surface burst partition', E.thermalPartition(100, 0), 0.18, 0.001);
const BURNS = [[20, 540, 1, 4.3], [20, 540, 2, 3.2], [20, 540, 3, 2.7], [1000, 2000, 1, 18], [1000, 2000, 2, 14.4], [1000, 2000, 3, 12], [20000, 5400, 1, 52], [20000, 5400, 2, 45], [20000, 5400, 3, 39]];
for (const [W, h, d, km] of BURNS) check(`FAQ 5.1 ${d}° burn, ${W} kt (km)`, E.thermalRange(E.burnThreshold(d, W), W, h) / 1000, km, 0.2);
check('table 1 kt / 200 m, 3° burn (km)', E.thermalRange(E.burnThreshold(3, 1), 1, 200) / 1000, 0.6, 0.15);
check('table 1 kt / 200 m, 1° burn (km)', E.thermalRange(E.burnThreshold(1, 1), 1, 200) / 1000, 1.1, 0.15);

// ── initial radiation (slant ranges, km) ────────────────────────────────
const RADT = [[1, 0.8, 1.2], [20, 1.4, 1.8], [1000, 2.3, 2.9], [20000, 4.7, 5.4]];
for (const [W, lethal, ars] of RADT) {
  check(`table ${W} kt, 10 Gy slant (km)`, E.promptSlant(1000, W) / 1000, lethal, 0.2);
  check(`table ${W} kt, 1 Gy slant (km)`, E.promptSlant(100, W) / 1000, ars, 0.2);
}

// ── fallout: G&D 9.98 (10 MT surface burst, 30 mph; 100% fission rates) ──
const v30 = 30 * 0.44704;
check('G&D 9.97 wind factor F at 30 mph', E.windFactor(30), 1.25, 0.001);
check('G&D 9.98 H+1 rate 100 mi downwind (rad/h)', E.falloutCentreline(100 * MI, 1e4, v30), 1800, 0.15);
check('G&D 9.98 H+1 rate 200 mi downwind (rad/h)', E.falloutCentreline(200 * MI, 1e4, v30), 620, 0.15);
check('G&D 9.98 H+1 rate 300 mi downwind (rad/h)', E.falloutCentreline(300 * MI, 1e4, v30), 360, 0.15);
check('G&D 9.98 50% fission, 100 mi (rad/h)', E.falloutCentreline(100 * MI, 1e4, v30, 0.5), 900, 0.15);
check('G&D 9.98 arrival at 100 mi (h)', E.falloutArrival(100 * MI, 1e4, v30), 2.6, 0.15);
check('G&D 9.26 one-week dose factor, entry 3 h', E.falloutDose(1, 3, 3 + 168), 2.3, 0.05);
check('G&D 9.15 seven-ten rule', E.doseRateAt(1000, 7) / 1000, 0.1, 0.05);
{
  const C = E.falloutContour(1000, 1000, 15 * 0.44704);
  check('G&D Table 9.93 1,000 rad/h downwind, 1 MT (mi)', C.d / MI, 1.8 * 1000 ** 0.45, 0.001);
  ok('fallout: 1,000 rad/h at 0.8 d is inside, at 1.05 d is outside', E.falloutRate(0.8 * C.d, 0, 1000, 15 * 0.44704) >= 1000 && E.falloutRate(1.05 * C.d, 0, 1000, 15 * 0.44704) < 1000);
  ok('fallout: none upwind past the ground-zero circle', E.falloutRate(-3 * C.g - 5e4, 0, 1000, 15 * 0.44704) === 0);
  ok('fallout: none above the 180 W^0.4 ft ceiling', E.falloutRate(1e4, 0, 1000, 7, 1, E.falloutCeiling(1000) * 1.01) === 0);
}

// ── cloud: G&D Table 2.12 (1 MT, height above the burst) ────────────────
for (const [mi, min] of [[2, 0.3], [4, 0.7], [6, 1.1], [10, 2.5], [12, 3.8]]) check(`G&D Table 2.12 1 MT cloud at ${min} min (mi)`, E.cloudTop(min * 60, 1000, 0) / MI, mi, 0.2);
check('G&D 9.98 / Fig. 2.16 cloud radius, 10 MT (mi)', E.cloudRadius(1e4) / MI, 21, 0.001);
check('observed cloud top, 15 MT surface burst (km)', E.cloudTopFinal(15000) / 1000, 40, 0.1);

// ── shape ────────────────────────────────────────────────────────────────
{
  let mono = true, prev = Infinity;
  for (let r = 50; r < 5e4; r *= 1.05) { const p = E.overpressure(r, 100, 0); if (p > prev * 1.0001) mono = false; prev = p; }
  ok('surface burst overpressure falls with range', mono);
  let rt = 0;
  for (const t of [1e-5, 1e-3, 0.1, 3, 60]) rt = Math.max(rt, Math.abs(E.arrivalOfRadius(E.shockRadius(t, 300), 300) - t) / t);
  ok(`shock radius and arrival time round trip (worst ${(rt * 100).toFixed(4)}%)`, rt < 1e-6);
  let fb = true, last = 0;
  for (let t = 1e-6; t < 30; t *= 1.3) { const r = E.fireballRadius(t, 300, 600); if (r < last - 1e-9) fb = false; last = r; }
  ok('fireball radius never shrinks', fb);
  const x = 1.7; ok('pulse peaks at t_max', E.pulseShape(1) > E.pulseShape(0.95) && E.pulseShape(1) > E.pulseShape(1.05) && Math.abs(E.pulseShape(1) - 1) < 1e-12 && E.pulseShape(x) < 1);
  const S = E.summary(300, E.optimumHeight(5 * E.PSI, 300));
  ok('summary: 20 psi < 5 psi < 1 psi and 3° burn < 1° burn', S.psi20 < S.psi5 && S.psi5 < S.psi1 && S.burn3 < S.burn1);
}


// ── map: the ring on screen (geo.js) ─────────────────────────────────────
// A 100 kt burst at the best height for 5 psi. On the map the ring is a
// geodesic circle; its mean screen radius (north, east, south, west points,
// projected) must equal R / metresPerPixel. The equator check also compares
// with the plain scale 2 pi R_E / 256 / 2^z.
{
  const W = 100, R = E.rangeFor(5 * E.PSI, W, E.optimumHeight(5 * E.PSI, W));
  for (const lat of [0, 60]) for (const z of [9, 13]) {
    const lon = 10, c = G.project(lon, lat, z);
    let sum = 0;
    for (const b of [0, 90, 180, 270]) { const q = G.destination(lon, lat, R, b), p = G.project(q.lon, q.lat, z); sum += Math.hypot(p.x - c.x, p.y - c.y); }
    const want = R / G.metresPerPixel(lat, z);
    check(`map: 5 psi ring (${(R / 1000).toFixed(2)} km) on screen, lat ${lat}°, zoom ${z} (px)`, sum / 4, want, 0.01);
  }
  check('map: metres per pixel at the equator, zoom 0', G.metresPerPixel(0, 0), 2 * Math.PI * 6378137 / 256, 1e-9);
  check('map: 60° N doubles the screen size of a ring', (R / G.metresPerPixel(60, 11)) / (R / G.metresPerPixel(0, 11)), 2, 0.001);
  const q = G.destination(10, 45, R, 37), back = G.distance(10, 45, q.lon, q.lat);
  check('map: destination and distance round trip (m)', back, R, 1e-6);
  const p = G.project(-73.99, 40.72, 12), u = G.unproject(p.x, p.y, 12);
  ok('map: project and unproject round trip', Math.abs(u.lon + 73.99) < 1e-9 && Math.abs(u.lat - 40.72) < 1e-9);
  const L = G.toLocal(q.lon, q.lat, 10, 45);
  check('map: local tangent plane distance at 4 km (m)', Math.hypot(L.x, L.z), R, 0.005);
}

// ── seams: one-pixel water lines in the City Atlas rasters (places.js) ──
{
  const N = 16, a = new Uint8Array(N * N).fill(30);
  for (let r = 0; r < N; r++) { a[r * N + 5] = 80; for (let q = 9; q < 13; q++) a[r * N + q] = 80; }
  const m = mendSeams(a, N, v => v === 80);
  let col5 = 0, river = 0;
  for (let r = 0; r < N; r++) { col5 += a[r * N + 5] === 80; for (let q = 9; q < 13; q++) river += a[r * N + q] === 80; }
  ok(`seams: a one-pixel line of water goes, a four-pixel river stays (mended ${m}, river ${river}/${4 * N})`, m === 1 && col5 === 0 && river === 4 * N);
  const file = new URL('../city-atlas/data/london.bin', import.meta.url);
  const c = parseCity(await inflate(fs.readFileSync(file))), A = c.arrays, M = c.meta;
  const half = M.grid.outer.half, x0 = (0 - M.lon) * Math.PI / 180 * G.R_EARTH * Math.cos(M.lat * Math.PI / 180);
  const q = Math.floor((x0 + half) / (2 * half) * 512);
  const wetCol = arr => { let k = 0; for (let r = 0; r < 512; r++) k += arr[r * 512 + q] === 80; return k / 512; };
  const before = wetCol(A.lc_out), mended = mendSeams(A.lc_out, 512, v => v === 80), after = wetCol(A.lc_out);
  const qw = Math.floor((x0 + half) / (2 * half) * 1024);
  const wetW = () => { let k = 0; for (let r = 0; r < 1024; r++) k += A.wf_out[r * 1024 + qw] > 0; return k / 1024; };
  const bw = wetW(), mw = mendSeams(A.wf_out, 1024, v => v > 0), aw = wetW();
  ok(`seams: London water fraction at 0° E, column ${qw} wet ${(bw * 100).toFixed(0)}% -> ${(aw * 100).toFixed(0)}% (${mw} mended)`, bw > 0.85 && aw < 0.2 && mw === 1);
  ok(`seams: London land cover at 0° E, column ${q} water ${(before * 100).toFixed(0)}% -> ${(after * 100).toFixed(0)}% (${mended} mended)`, before > 0.85 && after < 0.2 && mended >= 1 && mended <= 3);
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
