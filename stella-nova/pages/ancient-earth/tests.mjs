// ============================================================================
//  ANCIENT EARTH  ·  tests.mjs  ·  node tests.mjs (from this directory)
// ----------------------------------------------------------------------------
//  1. recon.js against pygplates 1.0 (tests/expected.json, written by
//     build/build_data.py): 20 present-day places at 14 ages, and the
//     absolute rotation of every plate at every 5 Myr from 0 to 540 Ma.
//     Tolerance: 0.001 deg for the places, 0.01 km for the rotations.
//  2. The time scale (timescale.js) against the ICS chart as served by
//     Macrostrat (tests/ics.json): every Phanerozoic unit, its boundaries
//     and its colour.
//  3. The data files: they load, the sizes match meta.json, and decoded
//     values are sane (Himalaya high, Mariana deep, coast distances).
//  4. Fossils: our reconstruction of PBDB sites against PBDB's own
//     PALEOMAP paleo-coordinates (a different code path; median check).
//  5. world.js: the climate curve, the ice age dip, caption coverage.
//  6. saver.js: every journey's pins ride a plate for its whole run, and
//     the age path runs from the start age down to today.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { Plates, RotationModel, poleQuat, rotate, gcKm, llToVec } from './recon.js';
import { EONS, ERAS, PERIODS, EPOCHS, ageToX, xToAge, unitAt } from './timescale.js';
import { prepareDem, decodeElev, elevAt } from './data.js';
import { climateAt, captionAt, NAMES } from './world.js';
import { JOURNEYS, ageAt, RUN } from './saver.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const J = f => JSON.parse(fs.readFileSync(path.join(HERE, f)));
const B = f => new Uint8Array(fs.readFileSync(path.join(HERE, f)));
let fails = 0, passes = 0;
const ok = (cond, name, info = '') => { if (cond) { passes++; console.log('  ok   ' + name + (info ? '  ' + info : '')); } else { fails++; console.log('  FAIL ' + name + (info ? '  ' + info : '')); } };

// ── 1. reconstruction ───────────────────────────────────────────────────────
console.log('1. recon.js vs pygplates');
const meta = J('data/meta.json'), rotJ = J('data/rotations.json'), polyJ = J('data/polygons.json'), raster = B('data/plateidx.bin');
const P = new Plates(rotJ, polyJ, raster, meta.raster);
const ex = J('tests/expected.json');
let worstDeg = 0, worstKm = 0, n = 0, skipped = 0;
for (const pt of ex.points) {
  for (const [t, la, lo] of pt.at) {
    const k = pt.poly === 255 ? -1 : pt.poly;
    if (k < 0 || !P.alive(k, t)) { skipped++; continue; }
    const r = P.reconstruct(pt.lat, pt.lon, t, k);
    const km = gcKm(r.v, llToVec(la, lo));
    worstKm = Math.max(worstKm, km); worstDeg = Math.max(worstDeg, km / 111.195); n++;
  }
}
ok(worstDeg < 0.001, `places: ${n} place-ages within 0.001 deg`, `worst ${worstDeg.toExponential(2)} deg (${(worstKm * 1000).toFixed(2)} m), ${skipped} skipped (crust not in the model at that age)`);
ok(ex.points.every(p => p.plate === polyJ.poly[p.poly]?.p || p.poly === 255), 'raster polygon plate = pygplates partition plate');
const rot = new RotationModel(rotJ);
let worstR = 0, nr = 0;
for (const [p, t, la, lo, an] of ex.poles) {
  const q = rot.rotationAt(p, t), r = poleQuat(la, lo, an);
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) worstR = Math.max(worstR, gcKm(rotate(q, v), rotate(r, v)));
  nr++;
}
ok(worstR < 0.01, `rotations: ${nr} plate-ages within 0.01 km`, `worst ${(worstR * 1000).toFixed(2)} m`);
// round trip: present -> past -> present
// (where reconstructed polygons overlap, p must be one of the answers)
let rt = 0, amb = 0;
for (const pt of ex.points) for (const t of [50, 200, 400]) {
  const r = P.reconstruct(pt.lat, pt.lon, t); if (!r) continue;
  const b = P.unreconstruct(r.lat, r.lon, t);
  const all = b ? [b, ...b.others] : [];
  if (all.length > 1) amb++;
  rt = Math.max(rt, all.length ? Math.min(...all.map(c => gcKm(llToVec(c.lat, c.lon), llToVec(pt.lat, pt.lon)))) : 1e9);
}
ok(rt < 0.01, 'unreconstruct(reconstruct(p)) returns p', `worst ${(rt * 1000).toFixed(2)} m, ${amb} with overlapping polygons`);

// ── 2. time scale ───────────────────────────────────────────────────────────
console.log('2. time scale vs ICS (Macrostrat)');
const ics = J('tests/ics.json');
for (const [key, mine] of [['eons', EONS], ['eras', ERAS], ['periods', PERIODS], ['epochs', EPOCHS]]) {
  const ref = ics[key].filter(u => u[1] < 538.8);
  const bad = [];
  for (const [name, top, base, col] of ref) {
    const m = mine.find(u => u[0] === name);
    if (!m) { bad.push(name + ' missing'); continue; }
    if (Math.abs(m[1] - top) > 1e-6 || Math.abs(m[2] - base) > 1e-6) bad.push(`${name} ${m[1]}-${m[2]} vs ${top}-${base}`);
    if (m[3].toLowerCase() !== col.toLowerCase()) bad.push(`${name} colour ${m[3]} vs ${col}`);
  }
  ok(!bad.length, `${key}: ${ref.length} Phanerozoic units, boundaries and colours`, bad.join('; '));
}
let rtx = 0;
for (let t = 0; t <= 540; t += 0.5) rtx = Math.max(rtx, Math.abs(xToAge(ageToX(t)) - t));
ok(rtx < 1e-9, 'bar mapping ageToX / xToAge round trip', `worst ${rtx.toExponential(1)} Myr`);
ok(unitAt(PERIODS, 65.99)[0] === 'Paleogene' && unitAt(PERIODS, 66.01)[0] === 'Cretaceous' && unitAt(PERIODS, 0)[0] === 'Quaternary', 'unitAt: K-Pg at 66.0 Ma, 0 Ma in the Quaternary');

// ── 3. data files ───────────────────────────────────────────────────────────
console.log('3. data files');
const M = meta.dem, chunks = M.files.map(f => B('data/' + f));
const dem = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
chunks.reduce((o, c) => (dem.set(c, o), o + c.length), 0);
ok(dem.length === M.w * M.h * M.times.length, `dem chunks: ${M.files.length} files, ${M.times.length} frames of ${M.w}x${M.h}`, dem.length + ' bytes');
ok(chunks.every((c, i) => c.length === Math.min(M.chunk, M.times.length - i * M.chunk) * M.w * M.h), `each chunk holds ${M.chunk} frames (the last the rest)`);
ok(!fs.existsSync(path.join(HERE, 'data/dem.bin')), 'no stale data/dem.bin next to the chunks');
ok(M.times[0] === 0 && M.times[M.times.length - 1] === 540 && M.times.every((t, i) => !i || t > M.times[i - 1]), 'frame ages rise from 0 to 540 Ma');
ok(raster.length === meta.raster.w * meta.raster.h && raster.every(v => v === 255 || v < polyJ.poly.length), `plateidx.bin: ${meta.raster.w}x${meta.raster.h}, indices < ${polyJ.poly.length} or 255`);
const everest = elevAt(dem, M, 0, 28, 87), pacific = elevAt(dem, M, 0, -30, -130), paris = elevAt(dem, M, 0, 48.9, 2.3);
ok(everest > 3000 && pacific < -3500 && paris > 0 && paris < 500, 'decoded 0 Ma heights', `Tibet ${everest.toFixed(0)} m, South Pacific ${pacific.toFixed(0)} m, Paris ${paris.toFixed(0)} m`);
ok(decodeElev(0) === -9000 && decodeElev(255) === 6000 && decodeElev(128) === 0, 'code ends: 0 = -9000 m, 128 = 0 m, 255 = +6000 m');
const rg = prepareDem(dem.subarray(0, M.w * M.h), { ...M, times: [0] });
const inland = (la, lo) => rg[2 * ((la + 90) * 360 + lo + 180) + 1] * 16;
ok(inland(49, 2) < 400 && inland(23, 15) > 800, 'coast distance', `Paris ${inland(49, 2)} km, central Sahara ${inland(23, 15)} km`);
const over = J('data/overlays.json'), cities = J('data/cities.json'), foss = J('data/fossils.json'), bounds = J('data/boundaries.json');
ok(over.coast.length > 100 && over.coast.every(r => r.length % 2 === 1 && r.length >= 5), `overlays: ${over.coast.length} coast runs, ${over.borders.length} border runs`);
ok(cities.rows.length > 5000 && cities.rows[0][4] >= cities.rows[100][4], `cities: ${cities.rows.length} places, sorted by population`);
ok(bounds.times[0] === 0 && bounds.frames.length === bounds.times.length, `boundaries: ${bounds.frames.length} frames, ${bounds.times[0]}-${bounds.times[bounds.times.length - 1]} Ma`);
const lut = J('data/biome-lut.json'), lutAt = (T, W) => { const a = Math.max(0, Math.min(lut.nT - 1, Math.floor((T - lut.T0) / (lut.T1 - lut.T0) * lut.nT))), b = Math.max(0, Math.min(lut.nW - 1, Math.floor(W * lut.nW))); return lut.rgb.slice((a * lut.nW + b) * 3, (a * lut.nW + b) * 3 + 3); };
const ice = lutAt(-30, 0.5), desert = lutAt(22, 0), forest = lutAt(26, 0.95);
ok(lut.rgb.length === lut.nT * lut.nW * 3 && ice[2] > 0.5 && desert[0] > desert[2] * 1.4 && forest[1] > forest[2] && forest[1] < 0.06,
  `biome-lut: ${lut.nT}x${lut.nW}, ice white, dry warm land tan, wet warm land dark green`, `ice ${ice.map(v => v.toFixed(2))}, desert ${desert.map(v => v.toFixed(2))}, forest ${forest.map(v => v.toFixed(3))}`);
// the moisture index of the shader and of the table build must be the same formula
const wetJs = fs.readFileSync(path.join(HERE, 'surface.js'), 'utf8').match(/float wetIndex\(float[\s\S]*?return/)[0].match(/\d+\.\d+/g).map(Number);
const wetPy = fs.readFileSync(path.join(HERE, 'build/build_present.py'), 'utf8').match(/wet = \([\s\S]*?\)\)/)[0].replace(/\*\* 2/g, '').match(/\d+(?:\.\d+)?/g).map(Number);
ok(JSON.stringify(wetJs) === JSON.stringify(wetPy), 'wetIndex in surface.js matches build_present.py', wetJs.join(' '));
for (const f of ['color-2k.jpg', 'color-4k.jpg', 'relief-2k.png', 'lights-2k.jpg']) ok(fs.statSync(path.join(HERE, 'data/present', f)).size < 800e3, `present/${f} under 800 KB`);
let total = 0;
const walk = d => { for (const f of fs.readdirSync(d)) { const q = path.join(d, f), st = fs.statSync(q); if (st.isDirectory()) walk(q); else total += st.size; } };
walk(path.join(HERE, 'data'));
ok(total < 25e6, 'shipped data under 25 MB', (total / 1e6).toFixed(2) + ' MB');

// ── 4. fossils vs PBDB PALEOMAP coordinates ─────────────────────────────────
console.log('4. fossils vs PBDB');
const diffs = [];
for (const r of foss.rows) {
  const [, , maxMa, minMa, la, lo, k, , pla, pln] = r;
  if (k === 255 || pla == null) continue;
  const t = (maxMa + minMa) / 2;
  const q = P.reconstruct(la, lo, t, k); if (!q) continue;
  diffs.push(gcKm(q.v, llToVec(pla, pln)) / 111.195);
}
diffs.sort((a, b) => a - b);
const med = diffs[diffs.length >> 1], p90 = diffs[Math.floor(diffs.length * 0.9)];
ok(diffs.length > 3000 && med < 1.5, `${diffs.length} sites: median difference to PBDB paleo-coordinates < 1.5 deg`, `median ${med.toFixed(2)} deg, 90th percentile ${p90.toFixed(2)} deg`);

// ── 5. world ────────────────────────────────────────────────────────────────
console.log('5. world.js');
let finite = true;
for (let t = 0; t <= 540; t += 0.5) { const c = climateAt(t); finite = finite && isFinite(c.gmst) && isFinite(c.teq) && c.dT >= 16 && c.dT <= 50; }
ok(finite, 'climate curve finite, gradient in 16-50 K');
ok(Math.abs(climateAt(0.021).sea + 120) < 0.5 && Math.abs(climateAt(0).sea) < 0.5 && Math.abs(climateAt(1).sea) < 1e-6, 'sea level dip only at the Last Glacial Maximum', `0 Ma ${climateAt(0).sea.toFixed(2)} m, 21 ka ${climateAt(0.021).sea.toFixed(1)} m`);
let gap = [];
for (let t = 0; t <= 540; t += 0.25) if (!captionAt(t).title) gap.push(t);
ok(!gap.length, 'captions cover 0-540 Ma', gap.slice(0, 5).join(', '));
ok(NAMES.every(([, , from, to]) => from > to), 'ancient names have age windows');

// ── 6. saver journeys ───────────────────────────────────────────────────────
console.log('6. saver journeys');
const bad = [];
for (const J of JOURNEYS) for (const [n, la, lo] of J.pins) {
  const k = P.polyAt(la, lo);
  for (let t = 0; t <= J.a0; t += Math.max(0.01, J.a0 / 50)) if (!P.reconstruct(la, lo, t, k)) { bad.push(`${J.title}: ${n} at ${t.toFixed(2)} Ma`); break; }
}
ok(JOURNEYS.length >= 12 && JOURNEYS.length <= 20 && !bad.length, `${JOURNEYS.length} journeys, every pin on a plate from its start age to today`, bad.join('; '));
let mono = true;
for (const J of JOURNEYS) { let last = Infinity; for (let k = 0; k <= 1; k += 0.01) { const a = ageAt(J.a0, k); mono = mono && a <= last + 1e-9; last = a; } mono = mono && ageAt(J.a0, 0) === J.a0 && ageAt(J.a0, RUN) === 0 && ageAt(J.a0, 1) === 0; }
ok(mono, 'journey age path falls from the start age to 0 Ma and holds today');
ok(new Set(JOURNEYS.map(j => j.title)).size === JOURNEYS.length, 'journey titles are unique');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
